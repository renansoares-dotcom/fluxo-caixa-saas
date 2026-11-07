-- =====================================================================
-- Melhoria contínua 3.4 — Recompra de títulos negociados no FIDC (07/11/2026). Pedido do Renan em 20/10: "não depender de
-- lançamento manual quando um título negociado no FIDC é recomprado" (caso 1-34724/1 Mastercola, Negocial).
-- Convenção do fluxo de caixa (a mesma já usada): na cessão a receita do título entra na conta do fundo; na recompra sai
-- da conta escolhida (normalmente a do fundo) em 2.07.11 RECOMPRA/DEVOLUÇÃO DE TÍTULOS NEGOCIADOS; o que o fundo cobrar
-- além do valor do título sai em ENCARGOS (padrão 2.07.08 JUROS DE FOMENTO FUNDOS); o título volta para a carteira da
-- empresa como conta a receber EM ABERTO (mesmo plano, cliente e valor), e a baixa depois vale em qualquer conta.
-- Recompras já lançadas à mão podem ser VINCULADAS (sem criar lançamento novo). Migração ADITIVA.
-- =====================================================================

create table if not exists public.fidc_recompra_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  plano_recompra_id uuid references public.plano_contas(id) on delete set null,
  plano_encargos_id uuid references public.plano_contas(id) on delete set null,
  prazo_dias int not null default 0,                         -- vencimento sugerido do título reaberto: hoje + N (0 = vencimento original)
  atualizado_em timestamptz not null default now()
);
create table if not exists public.fidc_recompras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  lancamento_id uuid not null references public.lancamentos(id) on delete restrict,          -- o título cedido (receita na conta do fundo)
  fundo text,
  data date not null,
  valor_titulo numeric(16,2) not null,
  valor_recompra numeric(16,2) not null check (valor_recompra > 0),
  encargos numeric(16,2) not null default 0,
  conta_id uuid references public.contas(id) on delete set null,                            -- de onde saiu o dinheiro da recompra
  lanc_recompra_id uuid references public.lancamentos(id) on delete set null,
  lanc_encargos_id uuid references public.lancamentos(id) on delete set null,
  lanc_reaberto_id uuid references public.lancamentos(id) on delete set null,               -- o título de volta na carteira
  liquidacao_id uuid references public.fidc_liquidacoes(id) on delete set null,             -- linha do relatório do fundo (tipo recompra)
  vinculada boolean not null default false,                                                 -- lançamentos já existiam (registro manual antigo)
  cancelada boolean not null default false, motivo text, observacao text,
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create unique index if not exists fidc_recompras_ativa on public.fidc_recompras(lancamento_id) where not cancelada;
create index if not exists fidc_recompras_emp on public.fidc_recompras(empresa_id, data desc);
alter table public.fidc_recompra_config enable row level security;
alter table public.fidc_recompras enable row level security;
drop policy if exists fidc_recompra_config_sel on public.fidc_recompra_config; drop policy if exists fidc_recompra_config_ins on public.fidc_recompra_config;
drop policy if exists fidc_recompra_config_upd on public.fidc_recompra_config; drop policy if exists fidc_recompras_sel on public.fidc_recompras;
create policy fidc_recompra_config_sel on public.fidc_recompra_config for select to authenticated using (public.is_membro(empresa_id));
create policy fidc_recompra_config_ins on public.fidc_recompra_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fidc_recompra_config_upd on public.fidc_recompra_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy fidc_recompras_sel on public.fidc_recompras for select to authenticated using (public.is_membro(empresa_id));
grant select, insert, update on public.fidc_recompra_config to authenticated;
grant select on public.fidc_recompras to authenticated;   -- gravação só pelas funções

-- planos em uso (configurado ou o padrão pelo código)
create or replace function public._fidc_recompra_planos(p_empresa uuid, out p_rec uuid, out p_enc uuid, out p_cc uuid)
language sql stable security definer set search_path = public as $$
  select coalesce(c.plano_recompra_id, (select id from plano_contas where empresa_id = p_empresa and codigo = '2.07.11' limit 1)),
         coalesce(c.plano_encargos_id, (select id from plano_contas where empresa_id = p_empresa and codigo = '2.07.08' limit 1)),
         (select id from centros_custo where empresa_id = p_empresa and nome = 'FINANCEIRO' limit 1)
    from (select 1) x left join fidc_recompra_config c on c.empresa_id = p_empresa;
$$;
revoke all on function public._fidc_recompra_planos(uuid) from public, anon, authenticated;

/** registra a recompra. Sem p_lanc_recompra: cria a saída (recompra + encargos). Sem p_lanc_recebido: reabre o título em aberto. */
create or replace function public.fidc_recompra_registrar(p_lancamento uuid, p_data date, p_valor_recompra numeric, p_conta uuid, p_vencimento date,
  p_obs text default null, p_lanc_recompra uuid default null, p_lanc_recebido uuid default null, p_liquidacao uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t lancamentos; r lancamentos; pl record; v_fundo text; v_n int; v_id uuid; v_rec uuid; v_enc uuid; v_reab uuid; v_enc_val numeric := 0;
        v_cli text; v_conta uuid; v_desc text;
begin
  select * into t from lancamentos where id = p_lancamento for update;
  if t.id is null or not pode_editar(t.empresa_id) then raise exception 'Sem permissão.'; end if;
  if (select tipo from plano_contas where id = t.plano_id) <> 'E' or t.status <> 'Pago' then raise exception 'Escolha o título cedido (recebimento pago na conta do fundo).'; end if;
  select nome into v_fundo from fidc_fundos where empresa_id = t.empresa_id and conta_id = t.conta_id limit 1;
  if v_fundo is null and t.fidc_proposta_id is null then raise exception 'Este recebimento não está na conta de um fundo: não é um título cedido.'; end if;
  if exists (select 1 from fidc_recompras where lancamento_id = t.id and not cancelada) then raise exception 'Este título já tem recompra registrada.'; end if;
  if coalesce(p_valor_recompra, 0) <= 0 then raise exception 'Informe o valor da recompra.'; end if;
  select * into pl from _fidc_recompra_planos(t.empresa_id);
  v_cli := coalesce((select nome from favorecidos where id = t.favorecido_id), '');
  v_desc := coalesce(t.descricao, '') || coalesce(' — ' || nullif(v_cli, ''), '');
  v_conta := coalesce(p_conta, t.conta_id);
  perform pg_advisory_xact_lock(hashtext('fidc_recompra:' || t.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_n from fidc_recompras where empresa_id = t.empresa_id;

  if p_lanc_recompra is not null then
    -- vincular a saída que já foi lançada à mão
    select * into r from lancamentos where id = p_lanc_recompra;
    if r.id is null or r.empresa_id <> t.empresa_id or (select tipo from plano_contas where id = r.plano_id) <> 'S' then raise exception 'A saída da recompra escolhida não é um pagamento desta empresa.'; end if;
    if exists (select 1 from fidc_recompras where lanc_recompra_id = r.id and not cancelada) then raise exception 'Essa saída já está vinculada a outra recompra.'; end if;
    v_rec := r.id; v_conta := r.conta_id;
    v_enc_val := greatest(r.valor - t.valor, 0);
  else
    if pl.p_rec is null then raise exception 'Plano 2.07.11 (recompra) não encontrado: escolha nos parâmetros da recompra.'; end if;
    if v_conta is null then raise exception 'Escolha a conta de onde saiu a recompra.'; end if;
    v_enc_val := greatest(round(p_valor_recompra - t.valor, 2), 0);
    if v_enc_val > 0 and pl.p_enc is null then raise exception 'Plano dos encargos não encontrado: escolha nos parâmetros da recompra.'; end if;
    insert into lancamentos(empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, conta_id, valor, origem)
    values (t.empresa_id, p_data, pl.p_rec, left('Recompra ' || v_desc || coalesce(' (' || v_fundo || ')', ''), 300), t.favorecido_id, pl.p_cc, 'Pago', v_conta,
            least(p_valor_recompra, t.valor), 'fidc:recompra:' || v_n)
    returning id into v_rec;
    if v_enc_val > 0 then
      insert into lancamentos(empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, conta_id, valor, origem)
      values (t.empresa_id, p_data, pl.p_enc, left('Encargos da recompra ' || v_desc || coalesce(' (' || v_fundo || ')', ''), 300), t.favorecido_id, pl.p_cc, 'Pago', v_conta, v_enc_val, 'fidc:recompra:' || v_n)
      returning id into v_enc;
    end if;
  end if;

  if p_lanc_recebido is not null then
    if not exists (select 1 from lancamentos where id = p_lanc_recebido and empresa_id = t.empresa_id and plano_id in (select id from plano_contas where empresa_id = t.empresa_id and tipo = 'E')) then
      raise exception 'O recebimento escolhido não é uma entrada desta empresa.'; end if;
    if exists (select 1 from fidc_recompras where lanc_reaberto_id = p_lanc_recebido and not cancelada) then raise exception 'Esse recebimento já está vinculado a outra recompra.'; end if;
    v_reab := p_lanc_recebido;
  else
    insert into lancamentos(empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, conta_id, valor, origem, opc1, opc2, opc3, opc4)
    values (t.empresa_id, coalesce(p_vencimento, p_data), t.plano_id, left(coalesce(t.descricao, '') || ' (recomprado' || coalesce(' da ' || v_fundo, '') || ' em ' || to_char(p_data, 'DD/MM') || ')', 300),
            t.favorecido_id, t.centro_custo_id, 'Em aberto', null, t.valor, 'fidc:recompra:' || v_n || ':titulo', t.opc1, t.opc2, t.opc3, t.opc4)
    returning id into v_reab;
  end if;

  insert into fidc_recompras(empresa_id, numero, lancamento_id, fundo, data, valor_titulo, valor_recompra, encargos, conta_id, lanc_recompra_id, lanc_encargos_id, lanc_reaberto_id,
                             liquidacao_id, vinculada, observacao)
  values (t.empresa_id, v_n, t.id, v_fundo, p_data, t.valor, coalesce((select valor from lancamentos where id = v_rec), p_valor_recompra) + coalesce((select valor from lancamentos where id = v_enc), 0),
          v_enc_val, v_conta, v_rec, v_enc, v_reab, p_liquidacao, p_lanc_recompra is not null, nullif(trim(coalesce(p_obs, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

/** cancela: apaga os lançamentos que a recompra criou (não os vinculados); recusa se algum estiver conciliado ou o título reaberto já recebido */
create or replace function public.fidc_recompra_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare x fidc_recompras;
begin
  select * into x from fidc_recompras where id = p_id for update;
  if x.id is null or not pode_editar(x.empresa_id) then raise exception 'Sem permissão.'; end if;
  if x.cancelada then raise exception 'Recompra já cancelada.'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Informe o motivo.'; end if;
  if not x.vinculada then
    if exists (select 1 from lancamentos where id = x.lanc_reaberto_id and status = 'Pago') then raise exception 'O título reaberto já foi recebido: estorne o recebimento antes.'; end if;
    delete from lancamentos where id in (x.lanc_recompra_id, x.lanc_encargos_id, x.lanc_reaberto_id);    -- conciliado: a trava do lançamento recusa
  end if;
  update fidc_recompras set cancelada = true, motivo = trim(p_motivo), lanc_recompra_id = case when vinculada then lanc_recompra_id end,
         lanc_encargos_id = case when vinculada then lanc_encargos_id end, lanc_reaberto_id = case when vinculada then lanc_reaberto_id end where id = x.id;
end $$;
revoke all on function public.fidc_recompra_registrar(uuid, date, numeric, uuid, date, text, uuid, uuid, uuid), public.fidc_recompra_cancelar(uuid, text) from public, anon;
grant execute on function public.fidc_recompra_registrar(uuid, date, numeric, uuid, date, text, uuid, uuid, uuid), public.fidc_recompra_cancelar(uuid, text) to authenticated;

-- lista com a situação do título reaberto (em aberto, vencido, recebido)
create or replace function public.fidc_recompras_lista(p_empresa uuid)
returns table(id uuid, numero int, data date, fundo text, documento text, cliente text, favorecido_id uuid, valor_titulo numeric, valor_recompra numeric, encargos numeric,
  conta text, vinculada boolean, cancelada boolean, motivo text, observacao text, lancamento_id uuid, lanc_reaberto_id uuid, reaberto_status text, reaberto_venc date,
  recebido_em date, recebido_conta text, criado_por text, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select x.id, x.numero, x.data, x.fundo, t.descricao, f.nome, t.favorecido_id, x.valor_titulo, x.valor_recompra, x.encargos, c.nome, x.vinculada, x.cancelada, x.motivo, x.observacao,
         x.lancamento_id, x.lanc_reaberto_id, ra.status, case when ra.status = 'Em aberto' then ra.data end, case when ra.status = 'Pago' then ra.data end, rc.nome, x.criado_por, x.criado_em
    from fidc_recompras x join lancamentos t on t.id = x.lancamento_id left join favorecidos f on f.id = t.favorecido_id left join contas c on c.id = x.conta_id
    left join lancamentos ra on ra.id = x.lanc_reaberto_id left join contas rc on rc.id = ra.conta_id
   where x.empresa_id = p_empresa and is_membro(p_empresa) order by x.data desc, x.numero desc;
$$;
revoke all on function public.fidc_recompras_lista(uuid) from public, anon;
grant execute on function public.fidc_recompras_lista(uuid) to authenticated;

-- títulos cedidos que podem ser recomprados (busca por documento, cliente ou valor)
create or replace function public.fidc_cedidos_busca(p_empresa uuid, p_busca text)
returns table(id uuid, data date, documento text, cliente text, valor numeric, fundo text, conta text, vencimento date)
language sql stable security definer set search_path = public as $$
  select l.id, l.data, l.descricao, f.nome, l.valor, fu.nome, c.nome,
         (select ft.vencimento from fidc_titulos ft where ft.empresa_id = l.empresa_id and ft.fundo = fu.nome and l.descricao ilike '%' || ft.titulo || '%' limit 1)
    from lancamentos l join plano_contas p on p.id = l.plano_id and p.tipo = 'E' join fidc_fundos fu on fu.empresa_id = l.empresa_id and fu.conta_id = l.conta_id
    left join favorecidos f on f.id = l.favorecido_id left join contas c on c.id = l.conta_id
   where l.empresa_id = p_empresa and is_membro(p_empresa) and l.status = 'Pago'
     and not exists (select 1 from fidc_recompras r where r.lancamento_id = l.id and not r.cancelada)
     and (coalesce(trim(p_busca), '') = '' or l.descricao ilike '%' || trim(p_busca) || '%' or f.nome ilike '%' || trim(p_busca) || '%'
          or replace(l.valor::text, '.', ',') like '%' || trim(p_busca) || '%')
   order by l.data desc limit 40;
$$;
revoke all on function public.fidc_cedidos_busca(uuid, text) from public, anon;
grant execute on function public.fidc_cedidos_busca(uuid, text) to authenticated;

-- pendências: recompras informadas pelo fundo (relatório) e saídas 2.07.11 lançadas à mão, ainda sem registro
create or replace function public.fidc_recompras_pendentes(p_empresa uuid)
returns table(origem text, id uuid, data date, fundo text, documento text, valor numeric, cliente text, sugestao_id uuid, sugestao_doc text, sugestao_valor numeric)
language sql stable security definer set search_path = public as $$
  -- relatório do fundo: linhas tipo recompra sem registro
  select 'fundo'::text, q.id, q.quitacao, q.fundo, q.titulo, q.valor_pago, q.sacado, s.id, s.descricao, s.valor
    from fidc_liquidacoes q
    left join lateral (select l.id, l.descricao, l.valor from lancamentos l join fidc_fundos fu on fu.conta_id = l.conta_id and fu.empresa_id = l.empresa_id
                        where l.empresa_id = q.empresa_id and l.status = 'Pago' and lower(fu.nome) = lower(q.fundo)
                          and regexp_replace(l.descricao, '\D', '', 'g') like '%' || regexp_replace(split_part(q.titulo, '-', 1), '\D', '', 'g') || '%'
                          and not exists (select 1 from fidc_recompras r where r.lancamento_id = l.id and not r.cancelada)
                        order by abs(l.valor - q.valor_face) limit 1) s on true
   where q.empresa_id = p_empresa and is_membro(p_empresa) and q.tipo = 'recompra'
     and not exists (select 1 from fidc_recompras r where r.liquidacao_id = q.id and not r.cancelada)
  union all
  -- saídas em 2.07.11 sem vínculo (recompras lançadas à mão)
  select 'manual'::text, l.id, l.data, fu.nome, l.descricao, l.valor, f.nome, s.id, s.descricao, s.valor
    from lancamentos l join plano_contas p on p.id = l.plano_id and p.codigo = '2.07.11'
    left join fidc_fundos fu on fu.empresa_id = l.empresa_id and fu.conta_id = l.conta_id left join favorecidos f on f.id = l.favorecido_id
    left join lateral (select t.id, t.descricao, t.valor from lancamentos t join plano_contas pt on pt.id = t.plano_id and pt.tipo = 'E'
                        where t.empresa_id = l.empresa_id and t.status = 'Pago' and t.conta_id = l.conta_id and t.data <= l.data
                          and (select string_agg(m[1], '') from regexp_matches(l.descricao, '(\d{3,}/\d+)', 'g') m) is not null
                          and t.descricao ilike '%' || (regexp_match(l.descricao, '(\d{3,}/\d+)'))[1] || '%'
                          and not exists (select 1 from fidc_recompras r where r.lancamento_id = t.id and not r.cancelada)
                        order by t.data desc limit 1) s on true
   where l.empresa_id = p_empresa and is_membro(p_empresa) and l.status = 'Pago' and coalesce(l.origem, '') not like 'fidc:%'
     and not exists (select 1 from fidc_recompras r where r.lanc_recompra_id = l.id and not r.cancelada)
   order by 3 desc;
$$;
revoke all on function public.fidc_recompras_pendentes(uuid) from public, anon;
grant execute on function public.fidc_recompras_pendentes(uuid) to authenticated;

-- conferência: tabelas = 2, funcoes = 5
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('fidc_recompras', 'fidc_recompra_config')) as tabelas,
       (select count(*) from pg_proc where proname in ('fidc_recompra_registrar', 'fidc_recompra_cancelar', 'fidc_recompras_lista', 'fidc_cedidos_busca', 'fidc_recompras_pendentes')) as funcoes;

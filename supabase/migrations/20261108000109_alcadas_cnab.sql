-- =====================================================================
-- Melhoria contínua 3.6 — Alçadas de aprovação de pagamentos e remessa CNAB 240 (08/11/2026)
-- 1) ALÇADAS: faixas de valor (e, se quiser, centro de custo) com quem aprova e quantas aprovações são precisas
--    (dupla aprovação). Cada título marcado numa Autorização de pagamentos cai na sua alçada e é aprovado ou recusado
--    por quem a alçada permite — pela tela ou em lote por Minhas aprovações (celular). Sem alçada cadastrada, vale
--    a regra antiga (o diretor aprova a autorização inteira).
-- 2) REMESSA CNAB 240 (padrão FEBRABAN): dados bancários estruturados do beneficiário (banco, agência, conta, Pix),
--    código de barras do boleto no lançamento e, na conta da empresa, o convênio e o número sequencial do arquivo.
--    O arquivo é montado na tela com os títulos aprovados; aqui ficam o registro e o número sequencial (NSA).
-- Migração ADITIVA (requer o SQL 101, pela função _dir_pode).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_proc where proname = '_dir_pode') then
    raise exception 'Rode antes o SQL 101 (20261107000101_painel_diretoria.sql). Nada foi alterado.';
  end if;
end $$;

-- ---------- alçadas ----------
create table if not exists public.pag_alcadas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 60),
  valor_min numeric(16,2) not null default 0 check (valor_min >= 0),
  valor_max numeric(16,2) check (valor_max is null or valor_max >= valor_min),     -- null = sem teto
  centro_custo_id uuid references public.centros_custo(id) on delete cascade,      -- null = qualquer centro
  papeis text[] not null default '{}',                                              -- perfis que aprovam
  usuarios uuid[] not null default '{}',                                            -- pessoas que aprovam
  aprovacoes smallint not null default 1 check (aprovacoes between 1 and 3),        -- 2 = dupla aprovação
  ordem smallint not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists pag_alcadas_emp on public.pag_alcadas(empresa_id, ordem);

create table if not exists public.pag_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  quem_elabora_nao_aprova boolean not null default true,        -- segregação de funções
  avisar_aprovadores boolean not null default true,
  atualizado_em timestamptz not null default now()
);

alter table public.autorizacao_itens add column if not exists alcada_id uuid references public.pag_alcadas(id) on delete set null;
alter table public.autorizacao_itens add column if not exists situacao text not null default 'pendente';
do $$ begin
  alter table public.autorizacao_itens add constraint autorizacao_itens_situacao_check check (situacao in ('pendente', 'aprovado', 'recusado'));
exception when duplicate_object then null; end $$;

create table if not exists public.pag_aprovacoes (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  item_id uuid not null references public.autorizacao_itens(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  email text,
  aprovado boolean not null,
  motivo text,
  em timestamptz not null default now(),
  unique (item_id, user_id)
);
create index if not exists pag_aprovacoes_item on public.pag_aprovacoes(item_id);

alter table public.pag_alcadas enable row level security;
alter table public.pag_config enable row level security;
alter table public.pag_aprovacoes enable row level security;
drop policy if exists pag_alcadas_sel on public.pag_alcadas;
drop policy if exists pag_alcadas_ins on public.pag_alcadas;
drop policy if exists pag_alcadas_upd on public.pag_alcadas;
drop policy if exists pag_alcadas_del on public.pag_alcadas;
drop policy if exists pag_config_sel on public.pag_config;
drop policy if exists pag_config_ins on public.pag_config;
drop policy if exists pag_config_upd on public.pag_config;
drop policy if exists pag_aprovacoes_sel on public.pag_aprovacoes;
create policy pag_alcadas_sel on public.pag_alcadas for select to authenticated using (public.is_membro(empresa_id));
create policy pag_alcadas_ins on public.pag_alcadas for insert to authenticated with check (public.is_admin(empresa_id));
create policy pag_alcadas_upd on public.pag_alcadas for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy pag_alcadas_del on public.pag_alcadas for delete to authenticated using (public.is_admin(empresa_id));
create policy pag_config_sel on public.pag_config for select to authenticated using (public.is_membro(empresa_id));
create policy pag_config_ins on public.pag_config for insert to authenticated with check (public.is_admin(empresa_id));
create policy pag_config_upd on public.pag_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy pag_aprovacoes_sel on public.pag_aprovacoes for select to authenticated using (public.is_membro(empresa_id));
grant select, insert, update, delete on public.pag_alcadas to authenticated;
grant select, insert, update on public.pag_config to authenticated;
grant select on public.pag_aprovacoes to authenticated;
drop trigger if exists zz_auditoria on public.pag_alcadas;
create trigger zz_auditoria after insert or update or delete on public.pag_alcadas for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('pag_alcada', 'Pagamentos', 'Pagamentos na sua alçada', 'Títulos de uma autorização de pagamentos que dependem da sua aprovação.', false, 11)
on conflict (codigo) do nothing;

create or replace function public._pag_tem_alcadas(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from pag_alcadas where empresa_id = p_empresa and ativo);
$$;

/** alçada de um valor e centro de custo: a mais específica (com centro) vence; depois a de menor ordem */
create or replace function public._pag_alcada(p_empresa uuid, p_valor numeric, p_cc uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from pag_alcadas
   where empresa_id = p_empresa and ativo and p_valor >= valor_min and (valor_max is null or p_valor <= valor_max)
     and (centro_custo_id is null or centro_custo_id = p_cc)
   order by (centro_custo_id is null), ordem, valor_min desc
   limit 1;
$$;

/** a pessoa pode aprovar nesta alçada? */
create or replace function public._pag_pode(p_alcada uuid, p_user uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from pag_alcadas a join membros m on m.empresa_id = a.empresa_id and m.user_id = p_user
                  where a.id = p_alcada and a.ativo and (p_user = any(a.usuarios) or m.papel::text = any(a.papeis)));
$$;
revoke all on function public._pag_tem_alcadas(uuid), public._pag_alcada(uuid, numeric, uuid), public._pag_pode(uuid, uuid) from public, anon;
grant execute on function public._pag_tem_alcadas(uuid), public._pag_alcada(uuid, numeric, uuid), public._pag_pode(uuid, uuid) to authenticated;

/** depois de gravar os itens: põe cada título marcado na sua alçada e avisa quem aprova */
create or replace function public.pag_preparar(p_autorizacao uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a autorizacoes; c pag_config; n int := 0; sem int := 0; r record; v_users uuid[];
begin
  select * into a from autorizacoes where id = p_autorizacao;
  if a.id is null or not pode_editar(a.empresa_id) then raise exception 'Autorização não encontrada.'; end if;
  if not _pag_tem_alcadas(a.empresa_id) then return jsonb_build_object('alcadas', false); end if;
  update autorizacao_itens i set alcada_id = _pag_alcada(a.empresa_id, i.valor_autorizado, l.centro_custo_id), situacao = 'pendente'
    from lancamentos l where l.id = i.lancamento_id and i.autorizacao_id = p_autorizacao and i.autoriza;
  update autorizacao_itens i set alcada_id = _pag_alcada(a.empresa_id, i.valor_autorizado, null), situacao = 'pendente'
   where i.autorizacao_id = p_autorizacao and i.autoriza and i.lancamento_id is null;
  select count(*) filter (where alcada_id is not null), count(*) filter (where alcada_id is null) into n, sem
    from autorizacao_itens where autorizacao_id = p_autorizacao and autoriza;
  select * into c from pag_config where empresa_id = a.empresa_id;
  if coalesce(c.avisar_aprovadores, true) then
    for r in select al.id, al.nome, al.papeis, al.usuarios, count(*) q, sum(i.valor_autorizado) v
               from autorizacao_itens i join pag_alcadas al on al.id = i.alcada_id
              where i.autorizacao_id = p_autorizacao and i.autoriza group by 1, 2, 3, 4 loop
      v_users := array(select distinct u from unnest(r.usuarios || _usuarios_papel(a.empresa_id, r.papeis)) u
                        where not (coalesce(c.quem_elabora_nao_aprova, true) and u = a.created_by));
      perform _notificar_u(a.empresa_id, v_users, 'pag_alcada', 'Autorização nº ' || a.numero || ': ' || r.q || ' título(s) na sua alçada',
        r.nome || ' · R$ ' || translate(to_char(r.v, 'FM999,999,999,990.00'), ',.', '.,') || '. Aprove ou recuse em Minhas aprovações.', '#/aprovacoes', null, false);
    end loop;
  end if;
  return jsonb_build_object('alcadas', true, 'com_alcada', n, 'sem_alcada', sem);
end $$;

/** aprova ou recusa títulos da autorização (p_itens null = todos os pendentes da sua alçada) */
create or replace function public.pag_decidir(p_autorizacao uuid, p_itens uuid[], p_aprovar boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a autorizacoes; c pag_config; i record; v_feitos int := 0; v_pend int; v_aprov int; v_email text;
begin
  select * into a from autorizacoes where id = p_autorizacao;
  if a.id is null or not is_participante(a.empresa_id) then raise exception 'Autorização não encontrada.'; end if;
  if a.status <> 'Pendente' then raise exception 'A autorização nº % já foi %.', a.numero, lower(a.status); end if;
  if not p_aprovar and coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Diga o motivo da recusa.'; end if;
  select * into c from pag_config where empresa_id = a.empresa_id;
  if coalesce(c.quem_elabora_nao_aprova, true) and a.created_by = auth.uid() then raise exception 'Quem elaborou a autorização não aprova os títulos dela (segregação de funções, nos Parâmetros).'; end if;
  select email into v_email from auth.users where id = auth.uid();
  for i in select it.* from autorizacao_itens it where it.autorizacao_id = p_autorizacao and it.autoriza and it.situacao = 'pendente'
             and (p_itens is null or it.id = any(p_itens)) loop
    if i.alcada_id is null then
      if p_itens is not null then raise exception 'O título de % não tem alçada: cadastre uma faixa que cubra o valor.', i.favorecido; end if;
      continue;
    end if;
    if not _pag_pode(i.alcada_id, auth.uid()) then
      if p_itens is not null then raise exception 'O título de % (R$ %) está fora da sua alçada.', i.favorecido, i.valor_autorizado; end if;
      continue;
    end if;
    insert into pag_aprovacoes(empresa_id, item_id, user_id, email, aprovado, motivo) values (a.empresa_id, i.id, auth.uid(), v_email, p_aprovar, nullif(trim(p_motivo), ''))
      on conflict (item_id, user_id) do update set aprovado = excluded.aprovado, motivo = excluded.motivo, em = now();
    if not p_aprovar then update autorizacao_itens set situacao = 'recusado' where id = i.id;
    elsif (select count(*) from pag_aprovacoes where item_id = i.id and aprovado) >= (select aprovacoes from pag_alcadas where id = i.alcada_id) then
      update autorizacao_itens set situacao = 'aprovado' where id = i.id;
    end if;
    v_feitos := v_feitos + 1;
  end loop;
  if v_feitos = 0 then raise exception 'Nenhum título pendente na sua alçada nesta autorização.'; end if;
  -- todos decididos: a autorização fecha
  select count(*) filter (where situacao = 'pendente'), count(*) filter (where situacao = 'aprovado') into v_pend, v_aprov
    from autorizacao_itens where autorizacao_id = p_autorizacao and autoriza;
  if v_pend = 0 then
    update autorizacoes set status = case when v_aprov > 0 then 'Aprovada' else 'Rejeitada' end, aprovado_por = auth.uid(), aprovado_em = now() where id = p_autorizacao;
    perform _notificar_u(a.empresa_id, array[a.created_by], 'pag_alcada', 'Autorização nº ' || a.numero || case when v_aprov > 0 then ' aprovada' else ' recusada' end,
      v_aprov || ' título(s) aprovado(s). A remessa para o banco pode ser gerada.', '#/autorizacao', null, false);
  end if;
  return jsonb_build_object('decididos', v_feitos, 'pendentes', v_pend);
end $$;
revoke all on function public.pag_preparar(uuid), public.pag_decidir(uuid, uuid[], boolean, text) from public, anon;
grant execute on function public.pag_preparar(uuid), public.pag_decidir(uuid, uuid[], boolean, text) to authenticated;

-- com alçadas, a autorização só fica "Aprovada" quando todos os títulos marcados foram decididos nas alçadas
create or replace function public._pag_trava_aprovacao() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Aprovada' and old.status <> 'Aprovada' and _pag_tem_alcadas(new.empresa_id)
     and exists (select 1 from autorizacao_itens where autorizacao_id = new.id and autoriza and alcada_id is not null and situacao = 'pendente') then
    raise exception 'Há títulos aguardando a aprovação nas alçadas. Cada aprovador decide os da sua alçada (Minhas aprovações).';
  end if;
  return new;
end $$;
drop trigger if exists pag_trava_aprovacao on public.autorizacoes;
create trigger pag_trava_aprovacao before update on public.autorizacoes for each row execute function public._pag_trava_aprovacao();

-- ---------- dados para a remessa ----------
alter table public.favorecidos add column if not exists banco_codigo text check (banco_codigo is null or banco_codigo ~ '^\d{3}$');
alter table public.favorecidos add column if not exists agencia text;
alter table public.favorecidos add column if not exists agencia_dv text;
alter table public.favorecidos add column if not exists conta_numero text;
alter table public.favorecidos add column if not exists conta_dv text;
alter table public.favorecidos add column if not exists conta_tipo text check (conta_tipo is null or conta_tipo in ('CC', 'PP'));
alter table public.favorecidos add column if not exists pix_tipo text check (pix_tipo is null or pix_tipo in ('cpf_cnpj', 'email', 'telefone', 'aleatoria'));

alter table public.lancamentos add column if not exists codigo_barras text;   -- boleto: linha digitável (47) ou código de barras (44)

alter table public.contas add column if not exists banco_codigo text check (banco_codigo is null or banco_codigo ~ '^\d{3}$');
alter table public.contas add column if not exists agencia_dv text;
alter table public.contas add column if not exists conta_dv text;
alter table public.contas add column if not exists cnab_convenio text;
alter table public.contas add column if not exists cnab_nsa int not null default 0;
alter table public.contas add column if not exists cnab_layout jsonb not null default '{}'::jsonb;   -- versões do arquivo/lote, finalidade da TED, J-52...

create table if not exists public.pag_remessas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete restrict,
  autorizacao_id uuid references public.autorizacoes(id) on delete set null,
  nsa int not null,
  data_pagamento date not null,
  qtd int not null default 0,
  total numeric(16,2) not null default 0,
  arquivo text,
  nome_arquivo text,
  situacao text not null default 'gerada' check (situacao in ('gerada', 'cancelada')),
  motivo_cancelamento text,
  gerado_por uuid default auth.uid(), gerado_em timestamptz not null default now(),
  unique (conta_id, nsa)
);
create table if not exists public.pag_remessa_itens (
  id bigint generated always as identity primary key,
  remessa_id uuid not null references public.pag_remessas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  item_id uuid references public.autorizacao_itens(id) on delete set null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  forma text not null check (forma in ('credito', 'ted', 'pix', 'boleto')),
  favorecido text,
  valor numeric(16,2) not null
);
create index if not exists pag_remessa_itens_lanc on public.pag_remessa_itens(lancamento_id);
alter table public.pag_remessas enable row level security;
alter table public.pag_remessa_itens enable row level security;
drop policy if exists pag_remessas_sel on public.pag_remessas;
drop policy if exists pag_remessa_itens_sel on public.pag_remessa_itens;
create policy pag_remessas_sel on public.pag_remessas for select to authenticated using (public.is_membro(empresa_id));
create policy pag_remessa_itens_sel on public.pag_remessa_itens for select to authenticated using (public.is_membro(empresa_id));
grant select on public.pag_remessas, public.pag_remessa_itens to authenticated;

/** reserva o próximo número sequencial (NSA) da conta e cria a remessa com os títulos; o arquivo é gravado depois */
create or replace function public.pag_remessa_criar(p_conta uuid, p_autorizacao uuid, p_data date, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ct contas; v_nsa int; v_id uuid; x jsonb; v_lanc uuid; v_qtd int := 0; v_tot numeric := 0;
begin
  select * into ct from contas where id = p_conta;
  if ct.id is null or not pode_editar(ct.empresa_id) then raise exception 'Conta não encontrada.'; end if;
  if ct.banco_codigo is null then raise exception 'Informe o código do banco da conta % (Cadastros › Contas bancárias › Remessa CNAB).', ct.nome; end if;
  if p_data is null or p_data < current_date then raise exception 'A data de pagamento não pode ser no passado.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Nenhum título para a remessa.'; end if;
  update contas set cnab_nsa = cnab_nsa + 1 where id = p_conta returning cnab_nsa into v_nsa;
  insert into pag_remessas(empresa_id, conta_id, autorizacao_id, nsa, data_pagamento) values (ct.empresa_id, p_conta, p_autorizacao, v_nsa, p_data) returning id into v_id;
  for x in select * from jsonb_array_elements(p_itens) loop
    v_lanc := nullif(x ->> 'lancamento_id', '')::uuid;
    if v_lanc is not null and exists (select 1 from pag_remessa_itens ri join pag_remessas r on r.id = ri.remessa_id
                                       where ri.lancamento_id = v_lanc and r.situacao = 'gerada' and r.id <> v_id) then
      raise exception 'O título de % já está numa remessa gerada. Cancele a remessa anterior para gerar de novo.', x ->> 'favorecido';
    end if;
    insert into pag_remessa_itens(remessa_id, empresa_id, item_id, lancamento_id, forma, favorecido, valor)
    values (v_id, ct.empresa_id, nullif(x ->> 'item_id', '')::uuid, v_lanc, x ->> 'forma', x ->> 'favorecido', (x ->> 'valor')::numeric);
    v_qtd := v_qtd + 1; v_tot := v_tot + (x ->> 'valor')::numeric;
  end loop;
  update pag_remessas set qtd = v_qtd, total = v_tot where id = v_id;
  return jsonb_build_object('id', v_id, 'nsa', v_nsa);
end $$;

create or replace function public.pag_remessa_gravar(p_remessa uuid, p_arquivo text, p_nome text) returns void
language plpgsql security definer set search_path = public as $$
declare r pag_remessas;
begin
  select * into r from pag_remessas where id = p_remessa;
  if r.id is null or not pode_editar(r.empresa_id) then raise exception 'Remessa não encontrada.'; end if;
  if r.arquivo is not null then raise exception 'O arquivo desta remessa já foi gravado.'; end if;
  update pag_remessas set arquivo = p_arquivo, nome_arquivo = p_nome where id = p_remessa;
end $$;

create or replace function public.pag_remessa_cancelar(p_remessa uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r pag_remessas;
begin
  select * into r from pag_remessas where id = p_remessa;
  if r.id is null or not pode_editar(r.empresa_id) then raise exception 'Remessa não encontrada.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Diga o motivo do cancelamento.'; end if;
  update pag_remessas set situacao = 'cancelada', motivo_cancelamento = trim(p_motivo) where id = p_remessa;
end $$;
revoke all on function public.pag_remessa_criar(uuid, uuid, date, jsonb), public.pag_remessa_gravar(uuid, text, text), public.pag_remessa_cancelar(uuid, text) from public, anon;
grant execute on function public.pag_remessa_criar(uuid, uuid, date, jsonb), public.pag_remessa_gravar(uuid, text, text), public.pag_remessa_cancelar(uuid, text) to authenticated;

-- ---------- Minhas aprovações: + títulos na alçada (recria a função do SQL 108/091 com o tipo novo) ----------
-- (bloco gerado a partir da versão anterior da função; só acrescenta o tipo 'pagamento')
create or replace function public.minhas_aprovacoes(p_empresa uuid)
returns table(tipo text, id uuid, numero int, titulo text, detalhe text, valor numeric, desde timestamptz, prazo date, urgente boolean, link text, lote boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_participante(p_empresa) then return; end if;
  -- pagamentos antecipados aguardando autorização
  if pode_aprovar_paraquedas(p_empresa) then
    return query select 'pa'::text, x.id, x.numero, x.razao_social, coalesce(x.descricao, ''), x.valor, x.criado_em, x.data_pagamento, x.prioridade = 'urgente', '#/paraquedas'::text, true
      from paraquedas x where x.empresa_id = p_empresa and x.status = 'aguardando';
  end if;
  -- compras: pedidos aguardando aprovação e requisições pendentes
  if pode_aprovar_compra(p_empresa) then
    return query select 'pedido'::text, x.id, x.numero, coalesce(f.nome, 'Fornecedor'), coalesce(x.condicao_pagamento, '') || case when x.plano_id is null then ' · sem classificação: aprovar na tela' else '' end,
           x.total, x.criado_em, x.entrega_prevista, false, '#/compras/pedidos?abrir=' || x.id, x.plano_id is not null
      from compras_pedidos x left join favorecidos f on f.id = x.favorecido_id where x.empresa_id = p_empresa and x.status = 'aguardando';
    return query select 'requisicao'::text, x.id, x.numero, 'Requisição de ' || coalesce(x.solicitante, '—'), coalesce(x.observacao, ''), null::numeric, x.criado_em, x.necessidade, x.prioridade = 'urgente', '#/compras/requisicoes'::text, true
      from compras_requisicoes x where x.empresa_id = p_empresa and x.status = 'pendente';
  end if;
  -- borderôs (só o diretor decide)
  if is_diretor(p_empresa) then
    return query select 'bordero'::text, x.id, x.numero, 'Borderô — ' || coalesce(fu.nome, 'fundo'), x.qtd_titulos || ' título(s) · líquido R$ ' || translate(to_char(x.liquido, 'FM999,999,999,990.00'), ',.', '.,'),
           x.valor_face, x.criado_em, x.data_operacao, false, '#/fidc-propostas?abrir=' || x.id, true
      from fidc_propostas x left join fidc_fundos fu on fu.id = x.fundo_id where x.empresa_id = p_empresa and x.status = 'Pendente';
  end if;
  -- decisão do dia (diretor ou admin)
  if exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('diretor', 'admin')) then
    return query select 'decisao_dia'::text, x.id, x.numero, 'Decisão do dia ' || to_char(x.data, 'DD/MM'), 'Saídas R$ ' || translate(to_char(x.saidas, 'FM999,999,999,990.00'), ',.', '.,') || ' · saldo final R$ ' || translate(to_char(x.saldo_fim, 'FM999,999,999,990.00'), ',.', '.,'),
           x.saidas, x.criado_em, x.data, false, '#/decisao-dia?dia=' || x.data, true
      from decisoes_dia x where x.empresa_id = p_empresa and x.status = 'Pendente';
  end if;
  -- prorrogações pedidas no Portal (admin ou financeiro)
  if pode_editar(p_empresa) then
    return query select 'prorrogacao'::text, x.id, null::int, coalesce(f.nome, 'Cliente'), coalesce(x.documento, '') || ' · de ' || to_char(x.vencimento_atual, 'DD/MM') || ' para ' || to_char(x.nova_data, 'DD/MM') || ' · ' || x.motivo,
           x.valor, x.solicitado_em, x.vencimento_atual, false, '#/portal-clientes'::text, true
      from portal_prorrogacoes x left join favorecidos f on f.id = x.favorecido_id where x.empresa_id = p_empresa and x.status = 'pendente';
  end if;
  -- reajustes de contrato propostos (admin)
  if is_admin(p_empresa) then
    return query select 'reajuste'::text, x.id, c.numero, 'Reajuste — ' || c.objeto, x.indice || ' ' || replace(to_char(x.percentual, 'FM990.00'), '.', ',') || '% · de R$ ' || translate(to_char(x.valor_anterior, 'FM999,999,990.00'), ',.', '.,') || ' para R$ ' || translate(to_char(x.valor_novo, 'FM999,999,990.00'), ',.', '.,'),
           x.valor_novo, x.proposto_em, x.data_base, false, '#/contratos'::text, true
      from contrato_reajustes x join contratos c on c.id = x.contrato_id where x.empresa_id = p_empresa and x.status = 'proposto';
  end if;
  -- receitas de tinta em teste
  if to_regclass('public.tin_versoes') is not null and tin_pode_aprovar(p_empresa) then
    return query select 'receita'::text, v.id, v.numero, r.codigo || ' — ' || r.nome, 'Versão ' || v.numero || ' em teste' || coalesce(' · ' || v.observacao, ''), null::numeric, v.criado_em, null::date, false, '#/tintas/receitas'::text, true
      from tin_versoes v join tin_receitas r on r.id = v.receita_id where v.empresa_id = p_empresa and v.situacao = 'em_teste';
  end if;
  -- artes aprovadas pelo cliente esperando liberação para a produção
  if to_regclass('public.pre_projetos') is not null and pre_pode_liberar(p_empresa) then
    return query select 'arte'::text, x.id, x.numero, x.nome, coalesce(f.nome, '') || case when x.situacao = 'na_clicheria' then ' · clichês recebidos' else ' · aprovada pelo cliente' end,
           null::numeric, x.atualizado_em, x.prazo, false, '#/preimpressao/artes?abrir=' || x.id, true
      from pre_projetos x left join favorecidos f on f.id = x.favorecido_id
     where x.empresa_id = p_empresa and not x.arquivado and (x.situacao = 'aprovada' or (x.situacao = 'na_clicheria' and x.cliche_recebido_em is not null));
  end if;
  -- inspeções da qualidade que esperam a decisão (decide na tela: exige olhar os resultados)
  if to_regclass('public.qual_inspecoes') is not null and qual_pode_decidir(p_empresa) then
    return query select 'inspecao'::text, x.id, x.numero, 'Inspeção ' || x.etapa || coalesce(' — ' || p.descricao, ''), coalesce(x.lote_texto, ''), null::numeric, x.criado_em, x.prazo::date, false, '#/qualidade/inspecoes?abrir=' || x.id, false
      from qual_inspecoes x left join produtos p on p.id = x.produto_id where x.empresa_id = p_empresa and x.situacao = 'em_inspecao';
  end if;
  -- orçamento do centro de custo enviado ao responsável (decide na tela: exige olhar os valores)
  return query select 'orcamento_cc'::text, c.id, a.ano, 'Orçamento ' || a.ano || ' — ' || c.nome, initcap(a.cenario) || ' enviado para a sua aprovação',
         a.total, a.enviado_em, null::date, false, '#/orcamento-cc'::text, false
    from orcamento_cc_aprovacoes a join centros_custo c on c.id = a.centro_custo_id
   where a.empresa_id = p_empresa and a.situacao = 'enviado' and c.responsavel = auth.uid();
  -- títulos de autorização de pagamentos na alçada de quem está logado (decisão em lote: pag_decidir)
  if to_regclass('public.pag_alcadas') is not null then
    return query select 'pagamento'::text, au.id, au.numero, 'Autorização nº ' || au.numero || ' — ' || count(*) || ' título(s) na sua alçada',
           string_agg(distinct al.nome, ' · ') || ' · ' || string_agg(i.favorecido, ', ' order by i.valor_autorizado desc), sum(i.valor_autorizado), au.created_at, min(i.vencimento), false, '#/autorizacao'::text, true
      from autorizacoes au join autorizacao_itens i on i.autorizacao_id = au.id join pag_alcadas al on al.id = i.alcada_id
     where au.empresa_id = p_empresa and au.status = 'Pendente' and i.autoriza and i.situacao = 'pendente' and _pag_pode(i.alcada_id, auth.uid())
       and not exists (select 1 from pag_aprovacoes pa where pa.item_id = i.id and pa.user_id = auth.uid())
       and not (coalesce((select quem_elabora_nao_aprova from pag_config where empresa_id = p_empresa), true) and au.created_by = auth.uid())
     group by au.id, au.numero, au.created_at;
  end if;
end $$;
revoke all on function public.minhas_aprovacoes(uuid) from public, anon;
grant execute on function public.minhas_aprovacoes(uuid) to authenticated;

-- conferência: tabelas = 5, funções = 6
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('pag_alcadas', 'pag_config', 'pag_aprovacoes', 'pag_remessas', 'pag_remessa_itens')) as tabelas,
       (select count(*) from pg_proc where proname in ('pag_preparar', 'pag_decidir', 'pag_remessa_criar', 'pag_remessa_gravar', 'pag_remessa_cancelar', 'minhas_aprovacoes')) as funcoes;

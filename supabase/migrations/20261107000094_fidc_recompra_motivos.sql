-- =====================================================================
-- Recompra por motivo (07/11/2026). Pedido do Renan: "Recompra precisa ser categorizada. A mercadoria pode ser devolução e
-- eu precise recomprar do fundo, pode ter sido inadimplência e o título voltou pra mim, a nota teve erro eu substitui no
-- fundo por outra e a primeira entra como recompra, são inúmeros casos". Decisões: cessão com coobrigação; a dedução da
-- devolução vem da NOTA de devolução (a recompra é só o pagamento ao fundo); o fluxo de caixa continua com a 2.07.11 única e
-- o MOTIVO de cada recompra decide a linha na DRE Gerencial e a contrapartida no motor contábil.
-- Cada motivo (configurável na tela Recompras › Motivos) define:
--   • o que acontece com o título: reabrir (em aberto) · baixar (não volta; parcial = só o saldo volta) · substituir (outro
--     título cedido no lugar) · recebido (o cliente já pagou à empresa: vincula o recebimento) · nenhum (ajuste com o fundo);
--   • o que é exigido: nota de devolução, título substituto, observação; se aceita valor parcial;
--   • a linha da DRE Gerencial: deduções da receita · despesas financeiras · movimentos não operacionais · fora da DRE;
--   • a contrapartida contábil: o de-para da 2.07.11 (padrão) · a conta do cliente · uma conta escolhida.
-- Migração ADITIVA: rodar DEPOIS da 093. Não altera lançamentos nem recompras já registradas (ficam com o motivo inadimplência).
-- =====================================================================

create table if not exists public.fidc_recompra_motivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  descricao text,
  titulo_acao text not null default 'reabrir' check (titulo_acao in ('reabrir', 'baixar', 'substituir', 'recebido', 'nenhum')),
  permite_parcial boolean not null default false,
  exige_nota boolean not null default false,
  exige_substituto boolean not null default false,
  exige_obs boolean not null default false,
  dre_secao text not null default 'receita_bruta' check (dre_secao in ('receita_bruta', 'despesas_financeiras', 'nao_operacionais', 'fora')),
  dre_rotulo text,
  contab_modo text not null default 'plano' check (contab_modo in ('plano', 'cliente', 'conta')),
  contab_conta_id uuid references public.contab_contas(id) on delete set null,
  ativo boolean not null default true,
  ordem int not null default 0,
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
alter table public.fidc_recompra_motivos enable row level security;
drop policy if exists fidc_rm_sel on public.fidc_recompra_motivos; drop policy if exists fidc_rm_ins on public.fidc_recompra_motivos;
drop policy if exists fidc_rm_upd on public.fidc_recompra_motivos; drop policy if exists fidc_rm_del on public.fidc_recompra_motivos;
create policy fidc_rm_sel on public.fidc_recompra_motivos for select to authenticated using (public.is_membro(empresa_id));
create policy fidc_rm_ins on public.fidc_recompra_motivos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fidc_rm_upd on public.fidc_recompra_motivos for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy fidc_rm_del on public.fidc_recompra_motivos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.fidc_recompra_motivos to authenticated;

-- conta contábil escolhida tem de ser da mesma empresa
create or replace function public._fidc_rm_check() returns trigger language plpgsql set search_path = public as $$
begin
  if new.contab_conta_id is not null and not exists (select 1 from contab_contas where id = new.contab_conta_id and empresa_id = new.empresa_id) then
    raise exception 'A conta contábil escolhida não é desta empresa.'; end if;
  if new.contab_modo = 'conta' and new.contab_conta_id is null then raise exception 'Escolha a conta contábil do motivo.'; end if;
  new.atualizado_em := now(); new.atualizado_por := coalesce(auth.jwt() ->> 'email', new.atualizado_por);
  return new;
end $$;
drop trigger if exists fidc_rm_check on public.fidc_recompra_motivos;
create trigger fidc_rm_check before insert or update on public.fidc_recompra_motivos for each row execute function public._fidc_rm_check();

-- recompras: motivo, valor que voltou para a carteira e os vínculos exigidos pelo motivo
alter table public.fidc_recompras add column if not exists motivo_id uuid references public.fidc_recompra_motivos(id) on delete restrict;
alter table public.fidc_recompras add column if not exists valor_reaberto numeric(16,2);
alter table public.fidc_recompras add column if not exists nota_id uuid references public.nfe_notas(id) on delete set null;
alter table public.fidc_recompras add column if not exists rnc_id uuid references public.qual_rnc(id) on delete set null;
alter table public.fidc_recompras add column if not exists titulo_novo_id uuid references public.lancamentos(id) on delete set null;
create index if not exists fidc_recompras_motivo on public.fidc_recompras(motivo_id);
-- taxa de recompra por cliente que gera alerta na Central de Decisões (0 = sem alerta)
alter table public.fidc_recompra_config add column if not exists limite_taxa_cliente numeric(6,2) not null default 10;

/** motivos padrão (não apaga nem altera os que já existem; volta a ativar o que estiver faltando) */
create or replace function public._fidc_rm_padrao(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into fidc_recompra_motivos(empresa_id, codigo, nome, descricao, titulo_acao, permite_parcial, exige_nota, exige_substituto, exige_obs, dre_secao, dre_rotulo, contab_modo, ordem)
  select p_empresa, x.* from (values
    ('inadimplencia', 'Inadimplência', 'O cliente não pagou ao fundo: o título volta para a carteira, em aberto, até o cliente pagar.', 'reabrir', false, false, false, false, 'receita_bruta', '(−) Títulos recomprados por inadimplência', 'plano', 1),
    ('devolucao', 'Devolução de mercadoria', 'O cliente devolveu a mercadoria (total ou parcial): o título não volta, ou volta só o saldo não devolvido. A dedução da receita vem da nota de devolução.', 'baixar', true, true, false, false, 'receita_bruta', '(−) Recompras por devolução de mercadoria', 'plano', 2),
    ('substituicao', 'Substituição de título', 'A nota teve erro ou foi trocada: outro título foi cedido no lugar e o primeiro entra como recompra.', 'substituir', false, false, true, false, 'receita_bruta', '(−) Títulos substituídos no fundo', 'plano', 3),
    ('abatimento', 'Abatimento ou desconto ao cliente', 'Foi concedido abatimento ou desconto: volta para a carteira só o valor que o cliente ainda vai pagar.', 'reabrir', true, false, false, true, 'receita_bruta', '(−) Abatimentos e descontos concedidos', 'plano', 4),
    ('pago_empresa', 'Cliente pagou à empresa', 'O cliente pagou direto à empresa em vez de pagar ao fundo: a recompra é o repasse e o recebimento fica vinculado.', 'recebido', false, false, false, false, 'receita_bruta', '(−) Repasses ao fundo de títulos pagos à empresa', 'plano', 5),
    ('prorrogacao', 'Prorrogação ou renegociação', 'O vencimento foi prorrogado ou o título renegociado com o cliente: volta em aberto com o vencimento novo.', 'reabrir', false, false, false, false, 'receita_bruta', '(−) Títulos recomprados para prorrogação', 'plano', 6),
    ('erro_fundo', 'Erro do fundo ou duplicidade', 'Débito indevido do fundo (erro ou duplicidade), que será devolvido: o título não volta para a carteira.', 'nenhum', false, false, false, true, 'fora', null, 'plano', 7),
    ('outros', 'Outros', 'Qualquer outro caso: descreva na observação.', 'reabrir', true, false, false, true, 'receita_bruta', '(−) Outras recompras de títulos', 'plano', 8)
  ) x(codigo, nome, descricao, titulo_acao, permite_parcial, exige_nota, exige_substituto, exige_obs, dre_secao, dre_rotulo, contab_modo, ordem)
  on conflict (empresa_id, codigo) do update set ativo = true where not fidc_recompra_motivos.ativo;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public._fidc_rm_padrao(uuid) from public, anon, authenticated;
create or replace function public.fidc_recompra_motivos_padrao(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  return public._fidc_rm_padrao(p_empresa);
end $$;
revoke all on function public.fidc_recompra_motivos_padrao(uuid) from public, anon;
grant execute on function public.fidc_recompra_motivos_padrao(uuid) to authenticated;

-- motivos padrão para as empresas que já existem e para as novas
select public._fidc_rm_padrao(id) from public.empresas;
create or replace function public._fidc_rm_empresa_nova() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public._fidc_rm_padrao(new.id); return new; end $$;
drop trigger if exists fidc_rm_empresa_nova on public.empresas;
create trigger fidc_rm_empresa_nova after insert on public.empresas for each row execute function public._fidc_rm_empresa_nova();
-- recompras registradas antes desta migração: inadimplência (o tratamento que tinham)
update public.fidc_recompras r set motivo_id = m.id, valor_reaberto = coalesce(r.valor_reaberto, case when r.lanc_reaberto_id is not null then r.valor_titulo end)
  from public.fidc_recompra_motivos m where m.empresa_id = r.empresa_id and m.codigo = 'inadimplencia' and r.motivo_id is null;

-- registrar com motivo (substitui a versão da 093)
drop function if exists public.fidc_recompra_registrar(uuid, date, numeric, uuid, date, text, uuid, uuid, uuid);
create or replace function public.fidc_recompra_registrar(p_lancamento uuid, p_data date, p_valor_recompra numeric, p_conta uuid, p_vencimento date,
  p_obs text default null, p_lanc_recompra uuid default null, p_lanc_recebido uuid default null, p_liquidacao uuid default null,
  p_motivo uuid default null, p_valor_reaberto numeric default null, p_nota uuid default null, p_rnc uuid default null, p_titulo_novo uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t lancamentos; r lancamentos; pl record; mo fidc_recompra_motivos; v_fundo text; v_n int; v_id uuid; v_rec uuid; v_enc uuid; v_reab uuid; v_enc_val numeric := 0;
        v_cli text; v_conta uuid; v_desc text; v_volta numeric := 0; v_obs text := nullif(trim(coalesce(p_obs, '')), '');
begin
  select * into t from lancamentos where id = p_lancamento for update;
  if t.id is null or not pode_editar(t.empresa_id) then raise exception 'Sem permissão.'; end if;
  if (select tipo from plano_contas where id = t.plano_id) <> 'E' or t.status <> 'Pago' then raise exception 'Escolha o título cedido (recebimento pago na conta do fundo).'; end if;
  select nome into v_fundo from fidc_fundos where empresa_id = t.empresa_id and conta_id = t.conta_id limit 1;
  if v_fundo is null and t.fidc_proposta_id is null then raise exception 'Este recebimento não está na conta de um fundo: não é um título cedido.'; end if;
  if exists (select 1 from fidc_recompras where lancamento_id = t.id and not cancelada) then raise exception 'Este título já tem recompra registrada.'; end if;
  if coalesce(p_valor_recompra, 0) <= 0 then raise exception 'Informe o valor da recompra.'; end if;

  -- motivo: o escolhido, ou inadimplência (o tratamento antigo)
  if p_motivo is not null then select * into mo from fidc_recompra_motivos where id = p_motivo and empresa_id = t.empresa_id;
  else select * into mo from fidc_recompra_motivos where empresa_id = t.empresa_id and codigo = 'inadimplencia'; end if;
  if mo.id is null then raise exception 'Escolha o motivo da recompra.'; end if;
  if not mo.ativo then raise exception 'O motivo "%" está desativado.', mo.nome; end if;
  if mo.exige_obs and v_obs is null then raise exception 'O motivo "%" pede uma observação.', mo.nome; end if;
  if mo.exige_nota and p_nota is null then raise exception 'O motivo "%" pede a nota de devolução.', mo.nome; end if;
  if p_nota is not null and not exists (select 1 from nfe_notas where id = p_nota and empresa_id = t.empresa_id) then raise exception 'A nota escolhida não é desta empresa.'; end if;
  if p_rnc is not null and not exists (select 1 from qual_rnc where id = p_rnc and empresa_id = t.empresa_id) then raise exception 'A RNC escolhida não é desta empresa.'; end if;
  if mo.titulo_acao = 'substituir' or mo.exige_substituto then
    if p_titulo_novo is null then raise exception 'Escolha o título que foi cedido no lugar deste.'; end if;
    if p_titulo_novo = t.id or not exists (select 1 from lancamentos l join plano_contas p on p.id = l.plano_id and p.tipo = 'E'
        where l.id = p_titulo_novo and l.empresa_id = t.empresa_id and l.status = 'Pago') then raise exception 'O título substituto tem de ser outro recebimento cedido desta empresa.'; end if;
  end if;
  if mo.titulo_acao = 'recebido' and p_lanc_recebido is null then raise exception 'Escolha o recebimento do cliente (o motivo "%" vincula o que já foi recebido).', mo.nome; end if;

  -- quanto volta para a carteira
  if mo.titulo_acao = 'reabrir' and p_lanc_recebido is null then
    v_volta := round(coalesce(p_valor_reaberto, t.valor), 2);
    if not mo.permite_parcial and v_volta <> t.valor then raise exception 'O motivo "%" devolve o título inteiro para a carteira.', mo.nome; end if;
    if v_volta <= 0 or v_volta > t.valor then raise exception 'O valor que volta para a carteira tem de ser maior que zero e até o valor do título.'; end if;
  elsif mo.titulo_acao = 'baixar' and mo.permite_parcial then
    v_volta := round(coalesce(p_valor_reaberto, 0), 2);
    if v_volta < 0 or v_volta >= t.valor then raise exception 'O saldo que volta para a carteira tem de ser menor que o valor do título (0 = devolução total).'; end if;
  end if;

  select * into pl from _fidc_recompra_planos(t.empresa_id);
  v_cli := coalesce((select nome from favorecidos where id = t.favorecido_id), '');
  v_desc := coalesce(t.descricao, '') || coalesce(' — ' || nullif(v_cli, ''), '');
  v_conta := coalesce(p_conta, t.conta_id);
  perform pg_advisory_xact_lock(hashtext('fidc_recompra:' || t.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_n from fidc_recompras where empresa_id = t.empresa_id;

  if p_lanc_recompra is not null then
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
    values (t.empresa_id, p_data, pl.p_rec, left('Recompra (' || lower(mo.nome) || ') ' || v_desc || coalesce(' (' || v_fundo || ')', ''), 300), t.favorecido_id, pl.p_cc, 'Pago', v_conta,
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
    v_reab := p_lanc_recebido; v_volta := null;
  elsif v_volta > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, conta_id, valor, origem, opc1, opc2, opc3, opc4)
    values (t.empresa_id, coalesce(p_vencimento, p_data), t.plano_id,
            left(coalesce(t.descricao, '') || ' (recomprado' || coalesce(' da ' || v_fundo, '') || ' em ' || to_char(p_data, 'DD/MM') || case when v_volta < t.valor then ' · saldo' else '' end || ')', 300),
            t.favorecido_id, t.centro_custo_id, 'Em aberto', null, v_volta, 'fidc:recompra:' || v_n || ':titulo', t.opc1, t.opc2, t.opc3, t.opc4)
    returning id into v_reab;
  end if;

  insert into fidc_recompras(empresa_id, numero, lancamento_id, fundo, data, valor_titulo, valor_recompra, encargos, conta_id, lanc_recompra_id, lanc_encargos_id, lanc_reaberto_id,
                             liquidacao_id, vinculada, observacao, motivo_id, valor_reaberto, nota_id, rnc_id, titulo_novo_id)
  values (t.empresa_id, v_n, t.id, v_fundo, coalesce(r.data, p_data), t.valor, coalesce((select valor from lancamentos where id = v_rec), p_valor_recompra) + coalesce((select valor from lancamentos where id = v_enc), 0),
          v_enc_val, v_conta, v_rec, v_enc, v_reab, p_liquidacao, p_lanc_recompra is not null, v_obs, mo.id, nullif(v_volta, 0), p_nota, p_rnc, p_titulo_novo)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.fidc_recompra_registrar(uuid, date, numeric, uuid, date, text, uuid, uuid, uuid, uuid, numeric, uuid, uuid, uuid) from public, anon;
grant execute on function public.fidc_recompra_registrar(uuid, date, numeric, uuid, date, text, uuid, uuid, uuid, uuid, numeric, uuid, uuid, uuid) to authenticated;

/** troca o motivo de uma recompra já registrada (só o motivo e os vínculos; os lançamentos não mudam) */
create or replace function public.fidc_recompra_motivo_trocar(p_id uuid, p_motivo uuid, p_nota uuid default null, p_rnc uuid default null, p_titulo_novo uuid default null, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare x fidc_recompras; mo fidc_recompra_motivos;
begin
  select * into x from fidc_recompras where id = p_id for update;
  if x.id is null or not pode_editar(x.empresa_id) then raise exception 'Sem permissão.'; end if;
  if x.cancelada then raise exception 'Recompra cancelada.'; end if;
  select * into mo from fidc_recompra_motivos where id = p_motivo and empresa_id = x.empresa_id and ativo;
  if mo.id is null then raise exception 'Escolha um motivo ativo.'; end if;
  -- a ação sobre o título tem de bater com o que foi feito (título reaberto, recebido vinculado ou nenhum)
  if (x.lanc_reaberto_id is null) <> (mo.titulo_acao in ('substituir', 'nenhum') or (mo.titulo_acao = 'baixar' and coalesce(x.valor_reaberto, 0) = 0)) then
    raise exception 'O motivo "%" trata o título de outro jeito: cancele e registre a recompra de novo.', mo.nome; end if;
  if mo.exige_nota and coalesce(p_nota, x.nota_id) is null then raise exception 'O motivo "%" pede a nota de devolução.', mo.nome; end if;
  if (mo.titulo_acao = 'substituir' or mo.exige_substituto) and coalesce(p_titulo_novo, x.titulo_novo_id) is null then raise exception 'Escolha o título que foi cedido no lugar.'; end if;
  if mo.exige_obs and nullif(trim(coalesce(p_obs, x.observacao, '')), '') is null then raise exception 'O motivo "%" pede uma observação.', mo.nome; end if;
  update fidc_recompras set motivo_id = mo.id, nota_id = coalesce(p_nota, nota_id), rnc_id = coalesce(p_rnc, rnc_id), titulo_novo_id = coalesce(p_titulo_novo, titulo_novo_id),
         observacao = coalesce(nullif(trim(coalesce(p_obs, '')), ''), observacao) where id = x.id;
end $$;
revoke all on function public.fidc_recompra_motivo_trocar(uuid, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.fidc_recompra_motivo_trocar(uuid, uuid, uuid, uuid, uuid, text) to authenticated;

-- lista com o motivo e os vínculos
drop function if exists public.fidc_recompras_lista(uuid);
create or replace function public.fidc_recompras_lista(p_empresa uuid)
returns table(id uuid, numero int, data date, fundo text, documento text, cliente text, favorecido_id uuid, valor_titulo numeric, valor_recompra numeric, encargos numeric,
  conta text, vinculada boolean, cancelada boolean, motivo text, observacao text, lancamento_id uuid, lanc_reaberto_id uuid, reaberto_status text, reaberto_venc date,
  recebido_em date, recebido_conta text, criado_por text, criado_em timestamptz,
  motivo_id uuid, motivo_nome text, motivo_codigo text, titulo_acao text, valor_reaberto numeric, nota_id uuid, nota_numero int, rnc_id uuid, rnc_numero int,
  titulo_novo_id uuid, titulo_novo_doc text)
language sql stable security definer set search_path = public as $$
  select x.id, x.numero, x.data, x.fundo, t.descricao, f.nome, t.favorecido_id, x.valor_titulo, x.valor_recompra, x.encargos, c.nome, x.vinculada, x.cancelada, x.motivo, x.observacao,
         x.lancamento_id, x.lanc_reaberto_id, ra.status, case when ra.status = 'Em aberto' then ra.data end, case when ra.status = 'Pago' then ra.data end, rc.nome, x.criado_por, x.criado_em,
         x.motivo_id, m.nome, m.codigo, m.titulo_acao, x.valor_reaberto, x.nota_id, n.numero, x.rnc_id, q.numero, x.titulo_novo_id, tn.descricao
    from fidc_recompras x join lancamentos t on t.id = x.lancamento_id left join favorecidos f on f.id = t.favorecido_id left join contas c on c.id = x.conta_id
    left join lancamentos ra on ra.id = x.lanc_reaberto_id left join contas rc on rc.id = ra.conta_id
    left join fidc_recompra_motivos m on m.id = x.motivo_id left join nfe_notas n on n.id = x.nota_id left join qual_rnc q on q.id = x.rnc_id
    left join lancamentos tn on tn.id = x.titulo_novo_id
   where x.empresa_id = p_empresa and is_membro(p_empresa) order by x.data desc, x.numero desc;
$$;
revoke all on function public.fidc_recompras_lista(uuid) from public, anon;
grant execute on function public.fidc_recompras_lista(uuid) to authenticated;

-- busca de títulos cedidos agora devolve o cliente (para sugerir a nota de devolução e a RNC dele)
drop function if exists public.fidc_cedidos_busca(uuid, text);
create or replace function public.fidc_cedidos_busca(p_empresa uuid, p_busca text)
returns table(id uuid, data date, documento text, cliente text, valor numeric, fundo text, conta text, vencimento date, favorecido_id uuid)
language sql stable security definer set search_path = public as $$
  select l.id, l.data, l.descricao, f.nome, l.valor, fu.nome, c.nome,
         (select ft.vencimento from fidc_titulos ft where ft.empresa_id = l.empresa_id and ft.fundo = fu.nome and l.descricao ilike '%' || ft.titulo || '%' limit 1), l.favorecido_id
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

-- notas de devolução para vincular (do cliente do título primeiro); RNCs do cliente
create or replace function public.fidc_recompra_notas(p_empresa uuid, p_favorecido uuid, p_busca text)
returns table(id uuid, numero int, emissao date, parte text, valor numeric, finalidade text, do_cliente boolean)
language sql stable security definer set search_path = public as $$
  select n.id, n.numero, n.emissao, coalesce(case when n.tipo = 'entrada' and not n.emissao_propria then n.emit_nome else n.dest_nome end, n.emit_nome), n.v_nf, n.finalidade,
         n.favorecido_id is not distinct from p_favorecido
    from nfe_notas n
   where n.empresa_id = p_empresa and is_membro(p_empresa) and n.situacao = 'autorizada'
     and (n.finalidade = '4' or n.cfops && array['1201','2201','1202','2202','1410','2410','1411','2411','5201','6201','5202','6202'])
     and (coalesce(trim(p_busca), '') = '' or n.numero::text like trim(p_busca) || '%' or n.emit_nome ilike '%' || trim(p_busca) || '%' or n.dest_nome ilike '%' || trim(p_busca) || '%')
   order by (n.favorecido_id is not distinct from p_favorecido) desc, n.emissao desc limit 30;
$$;
revoke all on function public.fidc_recompra_notas(uuid, uuid, text) from public, anon;
grant execute on function public.fidc_recompra_notas(uuid, uuid, text) to authenticated;

-- DRE Gerencial: as saídas da recompra (2.07.11) por motivo e mês, com os mesmos filtros da DRE
create or replace function public.fidc_recompras_dre(p_empresa uuid, p_ano int, p_status text[] default array['Pago'],
  p_conta uuid default null, p_grupo uuid default null, p_cc uuid default null, p_favorecido uuid default null, p_disp text default null)
returns table(motivo_id uuid, motivo text, dre_secao text, dre_rotulo text, classe_id uuid, mes int, total numeric, qtd bigint)
language sql stable security definer set search_path = public as $$
  select m.id, m.nome, m.dre_secao, coalesce(m.dre_rotulo, '(−) Recompras: ' || lower(m.nome)), f.classe_id, extract(month from f.data)::int, sum(f.valor_sinal), count(*)
    from _lanc_filtrados(p_empresa, make_date(p_ano, 1, 1), make_date(p_ano, 12, 31), p_status, p_conta, p_grupo, p_cc, p_favorecido, p_disp) f
    join fidc_recompras r on r.lanc_recompra_id = f.id and not r.cancelada
    join fidc_recompra_motivos m on m.id = r.motivo_id
   group by 1, 2, 3, 4, 5, 6;
$$;
revoke all on function public.fidc_recompras_dre(uuid, int, text[], uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.fidc_recompras_dre(uuid, int, text[], uuid, uuid, uuid, uuid, text) to authenticated;

-- painel: carteira cedida no ano × recompras, por motivo, por fundo e por cliente (taxa de recompra)
create or replace function public.fidc_recompras_resumo(p_empresa uuid, p_ano int)
returns jsonb language sql stable security definer set search_path = public as $$
  with ced as (
    select l.id, l.favorecido_id, l.valor, fu.nome fundo from lancamentos l join plano_contas p on p.id = l.plano_id and p.tipo = 'E'
      join fidc_fundos fu on fu.empresa_id = l.empresa_id and fu.conta_id = l.conta_id
     where l.empresa_id = p_empresa and l.status = 'Pago' and extract(year from l.data) = p_ano
  ), rec as (
    select r.*, t.favorecido_id from fidc_recompras r join lancamentos t on t.id = r.lancamento_id
     where r.empresa_id = p_empresa and not r.cancelada and extract(year from r.data) = p_ano
  )
  select case when not is_membro(p_empresa) then null else jsonb_build_object(
    'cedido', (select coalesce(sum(valor), 0) from ced),
    'recomprado', (select coalesce(sum(valor_titulo), 0) from rec),
    'encargos', (select coalesce(sum(encargos), 0) from rec),
    'motivos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'codigo', m.codigo, 'qtd', x.qtd, 'valor', x.valor, 'encargos', x.enc) order by x.valor desc)
                 from (select motivo_id, count(*) qtd, sum(valor_titulo) valor, sum(encargos) enc from rec group by 1) x join fidc_recompra_motivos m on m.id = x.motivo_id), '[]'::jsonb),
    'fundos', coalesce((select jsonb_agg(jsonb_build_object('fundo', fundo, 'cedido', ced_v, 'recomprado', rec_v, 'qtd', qtd) order by rec_v desc)
                 from (select coalesce(c.fundo, r.fundo) fundo, coalesce(c.v, 0) ced_v, coalesce(r.v, 0) rec_v, coalesce(r.n, 0) qtd
                         from (select fundo, sum(valor) v from ced group by 1) c full join (select fundo, sum(valor_titulo) v, count(*) n from rec group by 1) r on r.fundo = c.fundo) y), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('favorecido_id', z.fav, 'cliente', fv.nome, 'cedido', z.ced_v, 'recomprado', z.rec_v, 'qtd', z.qtd, 'motivos', z.mot) order by z.rec_v desc)
                 from (select r.favorecido_id fav, sum(r.valor_titulo) rec_v, count(*) qtd,
                              (select coalesce(sum(valor), 0) from ced c where c.favorecido_id is not distinct from r.favorecido_id) ced_v,
                              (select string_agg(distinct m.nome, ', ') from rec r2 join fidc_recompra_motivos m on m.id = r2.motivo_id where r2.favorecido_id is not distinct from r.favorecido_id) mot
                         from rec r group by 1 order by 2 desc limit 15) z left join favorecidos fv on fv.id = z.fav), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.fidc_recompras_resumo(uuid, int) from public, anon;
grant execute on function public.fidc_recompras_resumo(uuid, int) to authenticated;

-- motor contábil: a saída da recompra usa a contrapartida do motivo (o de-para da 2.07.11, a conta do cliente ou a conta escolhida)
create or replace function public.gerar_contabil_financeiro(p_empresa uuid, p_ini date, p_fim date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_apag int; v_lanc int; v_pend jsonb;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  if p_fim < p_ini or p_fim - p_ini > 400 then raise exception 'Período inválido.'; end if;

  drop table if exists _cf;
  create temp table _cf on commit drop as
  select l.id, l.data, l.valor, l.descricao, p.codigo || ' ' || p.nome as classif, p.natureza, p.tipo as ptipo,
         dc.conta_id as banco, dd.conta_id as banco_dest, l.conta_destino_id,
         case when l.conta_destino_id is not null then null
              when rm.modo = 'cliente' then rm.cli
              when rm.modo = 'conta' then rm.conta
              else coalesce(df.conta_id, dp.conta_id) end as contra,
         dp.plano_id is not null as tem_depara, dp.tratamento,
         case
           when dc.conta_id is null then 'Conta bancária sem conta contábil'
           when l.conta_destino_id is not null and dd.conta_id is null then 'Conta de destino sem conta contábil'
           when l.conta_destino_id is null and p.tipo = 'T' then 'Transferência sem conta de destino (ponta antiga)'
           when rm.modo = 'cliente' and rm.cli is null then 'Recompra: cliente sem conta contábil'
           when rm.modo = 'conta' and rm.conta is null then 'Recompra: motivo sem conta contábil'
           when rm.modo in ('cliente', 'conta') then null
           when l.conta_destino_id is null and dp.plano_id is null then 'Classificação sem de-para'
           when l.conta_destino_id is null and coalesce(df.conta_id, dp.conta_id) is null then 'Beneficiário sem conta contábil'
         end as motivo
    from lancamentos l
    join plano_contas p on p.id = l.plano_id
    left join contab_depara_conta dc on dc.conta_bancaria_id = l.conta_id
    left join contab_depara_conta dd on dd.conta_bancaria_id = l.conta_destino_id
    left join contab_depara_plano dp on dp.plano_id = l.plano_id
    left join contab_depara_favorecido df on df.favorecido_id = l.favorecido_id and df.papel = dp.papel
    left join lateral (
      select m.contab_modo modo, m.contab_conta_id conta,
             coalesce((select x.conta_id from contab_depara_favorecido x where x.favorecido_id = l.favorecido_id and x.papel = 'cliente'),
                      (select d2.conta_id from contab_depara_plano d2 join lancamentos tt on tt.plano_id = d2.plano_id where tt.id = r.lancamento_id)) cli
        from fidc_recompras r join fidc_recompra_motivos m on m.id = r.motivo_id
       where r.lanc_recompra_id = l.id and not r.cancelada and m.contab_modo <> 'plano' limit 1) rm on true
   where l.empresa_id = p_empresa and l.status = 'Pago' and l.data between p_ini and p_fim and l.valor <> 0;

  delete from contab_lancamentos where empresa_id = p_empresa and origem = 'financeiro' and data between p_ini and p_fim;
  get diagnostics v_apag = row_count;

  insert into contab_lancamentos(empresa_id, data, historico, origem, origem_id)
    select p_empresa, data, left(coalesce(descricao, '') || ' [' || classif || ']', 300), 'financeiro', id from _cf where motivo is null;
  get diagnostics v_lanc = row_count;

  insert into contab_partidas(lancamento_id, conta_id, debito, credito)
  select cl.id, x.conta, x.d, x.c
    from _cf f join contab_lancamentos cl on cl.origem = 'financeiro' and cl.origem_id = f.id and cl.empresa_id = p_empresa,
    lateral (values
      (case when f.conta_destino_id is not null then f.banco_dest when f.natureza = 'C' then f.banco else f.contra end, abs(f.valor), 0::numeric),
      (case when f.conta_destino_id is not null then f.banco when f.natureza = 'C' then f.contra else f.banco end, 0::numeric, abs(f.valor))
    ) as x(conta, d, c)
   where f.motivo is null;

  select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo, 'qtd', qtd, 'valor', valor, 'exemplos', ex) order by qtd desc), '[]'::jsonb) into v_pend
    from (select motivo, count(*) qtd, round(sum(abs(valor)), 2) valor,
                 (select jsonb_agg(jsonb_build_object('id', id, 'data', data, 'valor', valor, 'classif', classif, 'descricao', descricao))
                    from (select * from _cf g where g.motivo = f.motivo order by abs(valor) desc limit 30) s) ex
            from _cf f where motivo is not null group by motivo) t;

  return jsonb_build_object('apagados', v_apag, 'gerados', v_lanc, 'pendentes', (select count(*) from _cf where motivo is not null), 'pendencias', v_pend);
end $$;
revoke all on function public.gerar_contabil_financeiro(uuid, date, date) from public, anon;
grant execute on function public.gerar_contabil_financeiro(uuid, date, date) to authenticated;

-- conferência: motivos > 0, funcoes = 6
select (select count(*) from public.fidc_recompra_motivos) as motivos,
       (select count(*) from pg_proc where proname in ('fidc_recompra_motivos_padrao', 'fidc_recompra_motivo_trocar', 'fidc_recompra_notas', 'fidc_recompras_dre', 'fidc_recompras_resumo', 'fidc_recompra_registrar')) as funcoes;

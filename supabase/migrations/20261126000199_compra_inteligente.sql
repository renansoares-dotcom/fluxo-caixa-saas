-- 199 — Compras › Compra inteligente: custo líquido de aquisição e questionário de fornecedores, 26/11/2026.
-- Renan: "na reforma tributária será imprescindível a compra e saber onde tem crédito será um diferencial; montar uma cotação
-- que o fornecedor preencha os dados e alimentem a plataforma" ("pode seguir").
--   • a cotação por link (SQL 132) passa a receber os dados fiscais: UF de saída, regime (Simples: % de crédito permitido e se
--     vai recolher IBS/CBS pelo regime regular) e, por item, ICMS, IPI e ICMS-ST; vêm sugeridos pelas notas de entrada do fornecedor;
--   • cada item da requisição tem a destinação (insumo, revenda, uso e consumo, ativo), que decide os créditos;
--   • o mapa compara pelo custo líquido (js/lib/aquisicao.js), com a leitura do PRODEPE e a simulação da reforma;
--   • a atualização cadastral (SQL 198) ganha a versão para fornecedores (Compras › Atualização Cadastral de Fornecedores).
-- Somente acréscimos. Funções sem login: as mesmas 9 (cotacao_link_responder ganha o parâmetro p_fiscal, com valor padrão).

-- ------------------------------------------------------------ dados fiscais da cotação
alter table public.compras_requisicao_itens add column if not exists destinacao text not null default 'insumo';
do $$ begin
  alter table public.compras_requisicao_itens add constraint compras_req_itens_dest_chk check (destinacao in ('insumo', 'revenda', 'uso_consumo', 'ativo'));
exception when duplicate_object then null; end $$;
alter table public.compras_cotacoes add column if not exists uf char(2);
alter table public.compras_cotacoes add column if not exists regime text;
alter table public.compras_cotacoes add column if not exists simples_credito_pct numeric(7,4);
alter table public.compras_cotacoes add column if not exists simples_regular text;
do $$ begin
  alter table public.compras_cotacoes add constraint compras_cot_fiscal_chk check ((uf is null or uf ~ '^[A-Z]{2}$') and (regime is null or regime in ('real', 'presumido', 'simples', 'mei'))
    and (simples_credito_pct is null or simples_credito_pct between 0 and 20) and (simples_regular is null or simples_regular in ('sim', 'nao', 'avaliando')));
exception when duplicate_object then null; end $$;
alter table public.compras_cotacao_itens add column if not exists icms_aliq numeric(7,4);
alter table public.compras_cotacao_itens add column if not exists ipi_aliq numeric(7,4);
alter table public.compras_cotacao_itens add column if not exists st_un numeric(16,4);
alter table public.compras_cotacao_itens add column if not exists fonte_fiscal text;   -- fornecedor | notas | comprador
do $$ begin
  alter table public.compras_cotacao_itens add constraint compras_cot_itens_fiscal_chk check ((icms_aliq is null or icms_aliq between 0 and 40) and (ipi_aliq is null or ipi_aliq between 0 and 400)
    and (st_un is null or st_un >= 0));
exception when duplicate_object then null; end $$;

-- parâmetros da compra inteligente (Compras › Parâmetros)
alter table public.compras_parametros add column if not exists aq_prodepe_saidas_pct numeric(7,4) not null default 100;   -- parcela das saídas com PRODEPE
alter table public.compras_parametros add column if not exists aq_simples_credito_ibs_pct numeric(7,4) not null default 0; -- crédito de CBS/IBS estimado do Simples sem opção pelo regular
alter table public.compras_parametros add column if not exists aq_ciap_meses int not null default 48;
alter table public.compras_parametros add column if not exists aq_ipi_contribuinte boolean not null default true;
alter table public.compras_parametros add column if not exists aq_reforma boolean not null default false;              -- mostrar a reforma no mapa por padrão
do $$ begin
  alter table public.compras_parametros add constraint compras_par_aq_chk check (aq_prodepe_saidas_pct between 0 and 100 and aq_simples_credito_ibs_pct between 0 and 30 and aq_ciap_meses between 1 and 120);
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ histórico fiscal do fornecedor (notas de entrada importadas)
create or replace function public._uf_do_codigo(p text) returns text language sql immutable as $$
  select case p when '11' then 'RO' when '12' then 'AC' when '13' then 'AM' when '14' then 'RR' when '15' then 'PA' when '16' then 'AP' when '17' then 'TO'
    when '21' then 'MA' when '22' then 'PI' when '23' then 'CE' when '24' then 'RN' when '25' then 'PB' when '26' then 'PE' when '27' then 'AL' when '28' then 'SE' when '29' then 'BA'
    when '31' then 'MG' when '32' then 'ES' when '33' then 'RJ' when '35' then 'SP' when '41' then 'PR' when '42' then 'SC' when '43' then 'RS'
    when '50' then 'MS' when '51' then 'MT' when '52' then 'GO' when '53' then 'DF' end;
$$;
create or replace function public._compras_hist_fiscal(p_empresa uuid, p_fav uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (select regexp_replace(coalesce(documento, ''), '\D', '', 'g') as doc from favorecidos where id = p_fav and empresa_id = p_empresa)
  select coalesce(jsonb_agg(x order by x ->> 'emissao' desc), '[]'::jsonb) from (
    select jsonb_build_object('ncm', i.ncm, 'p_icms', i.p_icms, 'ipi_pct', case when i.vprod > 0 then round(coalesce(i.v_ipi, 0) / i.vprod * 100, 2) else 0 end,
      'st_un', case when i.qcom > 0 then round(coalesce(i.v_st, 0) / i.qcom, 4) else 0 end, 'orig', i.orig, 'simples', length(coalesce(i.cst_icms, '')) = 3,
      'uf', public._uf_do_codigo(left(n.chave, 2)), 'emissao', n.emissao, 'xprod', i.xprod) as x
    from nfe_notas n join nfe_itens i on i.nota_id = n.id, f
    where n.empresa_id = p_empresa and n.tipo = 'entrada' and not n.emissao_propria and coalesce(n.situacao, 'autorizada') = 'autorizada'
      and (n.favorecido_id = p_fav or (f.doc <> '' and n.emit_doc = f.doc))
    order by n.emissao desc limit 300) s;
$$;
revoke all on function public._uf_do_codigo(text), public._compras_hist_fiscal(uuid, uuid) from public, anon, authenticated;
grant execute on function public._uf_do_codigo(text) to authenticated;
create or replace function public.compras_hist_fiscal(p_empresa uuid, p_fav uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.pode_comprar(p_empresa) or public.is_membro(p_empresa)) then raise exception 'Sem acesso.'; end if;
  return public._compras_hist_fiscal(p_empresa, p_fav);
end $$;

-- ------------------------------------------------------------ página do fornecedor: abrir e responder com os dados fiscais
create or replace function public.cotacao_link_abrir(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c compras_cotacao_convites; r compras_requisicoes; cfg compras_parametros; q compras_cotacoes; v favorecidos; pf cad_perfil_fiscal; h jsonb := '[]';
begin
  c := _cotacao_convite(p_token);
  if c.id is null then raise exception 'Link de cotação inválido.'; end if;
  select * into r from compras_requisicoes where id = c.requisicao_id;
  select * into cfg from compras_parametros where empresa_id = c.empresa_id;
  select * into q from compras_cotacoes where id = c.cotacao_id;
  select * into v from favorecidos where id = c.favorecido_id;
  select * into pf from cad_perfil_fiscal where empresa_id = c.empresa_id and favorecido_id = c.favorecido_id;
  if c.favorecido_id is not null then h := public._compras_hist_fiscal(c.empresa_id, c.favorecido_id); end if;
  if c.situacao = 'enviado' then update compras_cotacao_convites set situacao = 'aberto', aberto_em = now() where id = c.id; c.situacao := 'aberto'; end if;
  return jsonb_build_object(
    'empresa', (select coalesce(razao_social, nome) from empresas where id = c.empresa_id), 'fornecedor', c.fornecedor, 'numero', r.numero, 'necessidade', r.necessidade,
    'situacao', c.situacao, 'expira_em', c.expira_em, 'vencido', c.expira_em < current_date or r.status not in ('aprovada', 'pendente'), 'mensagem', c.mensagem,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'descricao', i.descricao, 'unidade', i.unidade, 'quantidade', i.quantidade, 'observacao', i.observacao, 'ncm', i.ncm,
                'estimado', case when coalesce(cfg.cotacao_mostra_estimado, false) then i.valor_estimado end,
                'preco', ci.valor_unitario, 'icms_aliq', ci.icms_aliq, 'ipi_aliq', ci.ipi_aliq, 'st_un', ci.st_un) order by i.descricao), '[]')
              from compras_requisicao_itens i left join compras_cotacao_itens ci on ci.cotacao_id = c.cotacao_id and ci.requisicao_item_id = i.id where i.requisicao_id = r.id),
    -- dados fiscais: os já respondidos; senão o perfil do fornecedor; senão as notas de entrada dele (só NCM e alíquotas, sem valores)
    'fiscal', jsonb_build_object('uf', coalesce(q.uf, v.uf, (select x ->> 'uf' from jsonb_array_elements(h) x limit 1)),
      'regime', coalesce(q.regime, pf.regime, case v.regime_tributario when 'Simples Nacional' then 'simples' when 'MEI' then 'mei' when 'Lucro Presumido' then 'presumido' when 'Lucro Real' then 'real' end,
                         case when (select bool_or((x ->> 'simples')::boolean) from jsonb_array_elements(h) x) then 'simples' end),
      'simples_credito_pct', coalesce(q.simples_credito_pct, pf.simples_credito_pct), 'simples_regular', coalesce(q.simples_regular, pf.simples_regular)),
    'historico', (select coalesce(jsonb_agg(jsonb_build_object('ncm', x ->> 'ncm', 'p_icms', x -> 'p_icms', 'ipi_pct', x -> 'ipi_pct', 'st_un', x -> 'st_un', 'orig', x ->> 'orig',
                   'simples', x -> 'simples', 'uf', x ->> 'uf', 'emissao', x ->> 'emissao')), '[]') from jsonb_array_elements(h) x),
    'resposta', (select jsonb_build_object('prazo', q.prazo_entrega_dias, 'condicao', q.condicao_pagamento, 'parcelas', q.parcelas_dias, 'frete', q.frete, 'validade', q.validade, 'observacao', q.observacao,
                                           'respondido_em', c.respondido_em, 'respondido_por', c.respondido_por, 'escolhida', q.escolhida) where q.id is not null),
    'recusa_motivo', c.recusa_motivo);
end $$;

drop function if exists public.cotacao_link_responder(text, jsonb, int, text, int[], numeric, date, text, text, text);
create or replace function public.cotacao_link_responder(p_token text, p_itens jsonb, p_prazo_dias int, p_condicao text, p_parcelas int[], p_frete numeric,
                                                        p_validade date, p_observacao text, p_nome text, p_email text, p_fiscal jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare c compras_cotacao_convites; r compras_requisicoes; v_cot uuid; v_n int; x jsonb; v_avisar uuid[]; fz jsonb := coalesce(p_fiscal, '{}'::jsonb);
begin
  c := _cotacao_convite(p_token);
  if c.id is null then raise exception 'Link de cotação inválido.'; end if;
  select * into r from compras_requisicoes where id = c.requisicao_id;
  if c.situacao = 'cancelado' then raise exception 'Este pedido de cotação foi cancelado pelo comprador.'; end if;
  if c.expira_em < current_date or r.status not in ('aprovada', 'pendente') then raise exception 'O prazo desta cotação terminou.'; end if;
  if exists (select 1 from compras_cotacoes where id = c.cotacao_id and escolhida) then raise exception 'Esta cotação já foi escolhida e não pode mais ser alterada.'; end if;
  if length(trim(coalesce(p_nome, ''))) < 3 then raise exception 'Informe o seu nome.'; end if;
  if p_email is not null and trim(p_email) <> '' and p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe o preço de pelo menos um item.'; end if;
  if coalesce(p_frete, 0) < 0 or coalesce(p_prazo_dias, 0) < 0 or coalesce(p_prazo_dias, 0) > 365 then raise exception 'Frete ou prazo inválido.'; end if;
  if p_parcelas is not null and (array_length(p_parcelas, 1) > 24 or exists (select 1 from unnest(p_parcelas) d where d < 0 or d > 720)) then raise exception 'Parcelas inválidas.'; end if;
  if jsonb_typeof(fz) <> 'object' or length(fz::text) > 2000 then raise exception 'Dados fiscais inválidos.'; end if;
  if coalesce(fz ->> 'uf', '') <> '' and fz ->> 'uf' !~ '^[A-Z]{2}$' then raise exception 'UF inválida.'; end if;
  if coalesce(fz ->> 'regime', '') not in ('', 'real', 'presumido', 'simples', 'mei') then raise exception 'Regime inválido.'; end if;
  if coalesce(fz ->> 'simples_regular', '') not in ('', 'sim', 'nao', 'avaliando') then raise exception 'Resposta inválida sobre o regime regular.'; end if;
  if coalesce(fz ->> 'simples_credito_pct', '') <> '' and ((fz ->> 'simples_credito_pct') !~ '^\d+(\.\d+)?$' or (fz ->> 'simples_credito_pct')::numeric > 20) then raise exception 'Percentual de crédito do Simples inválido.'; end if;
  for x in select * from jsonb_array_elements(p_itens) loop
    if not exists (select 1 from compras_requisicao_itens where id = (x ->> 'item_id')::uuid and requisicao_id = r.id) then raise exception 'Item inválido.'; end if;
    if (x ->> 'valor_unitario')::numeric is null or (x ->> 'valor_unitario')::numeric < 0 or (x ->> 'valor_unitario')::numeric > 1e9 then raise exception 'Preço inválido.'; end if;
    if coalesce((x ->> 'icms_aliq')::numeric, 0) not between 0 and 40 or coalesce((x ->> 'ipi_aliq')::numeric, 0) not between 0 and 400 or coalesce((x ->> 'st_un')::numeric, 0) < 0 then
      raise exception 'Alíquota inválida no item.'; end if;
  end loop;
  v_cot := c.cotacao_id;
  if v_cot is null then
    insert into compras_cotacoes(empresa_id, requisicao_id, favorecido_id, fornecedor, prazo_entrega_dias, condicao_pagamento, parcelas_dias, frete, validade, observacao, convite_id, respondida_pelo_fornecedor, criado_por,
                                 uf, regime, simples_credito_pct, simples_regular)
    values (c.empresa_id, r.id, c.favorecido_id, c.fornecedor, p_prazo_dias, left(nullif(trim(p_condicao), ''), 200), coalesce(p_parcelas, '{28}'), coalesce(p_frete, 0), p_validade,
            left(nullif(trim(p_observacao), ''), 2000), c.id, true, null,
            nullif(fz ->> 'uf', ''), nullif(fz ->> 'regime', ''), nullif(fz ->> 'simples_credito_pct', '')::numeric, nullif(fz ->> 'simples_regular', ''))
    returning id into v_cot;
  else
    update compras_cotacoes set prazo_entrega_dias = p_prazo_dias, condicao_pagamento = left(nullif(trim(p_condicao), ''), 200), parcelas_dias = coalesce(p_parcelas, '{28}'),
           frete = coalesce(p_frete, 0), validade = p_validade, observacao = left(nullif(trim(p_observacao), ''), 2000),
           uf = coalesce(nullif(fz ->> 'uf', ''), uf), regime = coalesce(nullif(fz ->> 'regime', ''), regime),
           simples_credito_pct = case when fz ? 'simples_credito_pct' then nullif(fz ->> 'simples_credito_pct', '')::numeric else simples_credito_pct end,
           simples_regular = case when fz ? 'simples_regular' then nullif(fz ->> 'simples_regular', '') else simples_regular end where id = v_cot;
    delete from compras_cotacao_itens where cotacao_id = v_cot;
  end if;
  insert into compras_cotacao_itens(empresa_id, cotacao_id, requisicao_item_id, valor_unitario, icms_aliq, ipi_aliq, st_un, fonte_fiscal)
  select c.empresa_id, v_cot, (e ->> 'item_id')::uuid, round((e ->> 'valor_unitario')::numeric, 4),
         (e ->> 'icms_aliq')::numeric, (e ->> 'ipi_aliq')::numeric, round((e ->> 'st_un')::numeric, 4), case when e ? 'icms_aliq' then 'fornecedor' end
  from jsonb_array_elements(p_itens) e
  on conflict (cotacao_id, requisicao_item_id) do update set valor_unitario = excluded.valor_unitario, icms_aliq = excluded.icms_aliq, ipi_aliq = excluded.ipi_aliq,
    st_un = excluded.st_un, fonte_fiscal = excluded.fonte_fiscal;
  get diagnostics v_n = row_count;
  update compras_cotacao_convites set situacao = 'respondido', respondido_em = now(), respondido_por = left(trim(p_nome) || coalesce(' <' || nullif(trim(p_email), '') || '>', ''), 200),
         cotacao_id = v_cot, recusa_motivo = null where id = c.id;
  v_avisar := _usuarios_papel(c.empresa_id, array['admin', 'compras']) || coalesce((select array_agg(u.id) from auth.users u where lower(u.email) = lower(c.criado_por)), '{}');
  perform _notificar_u(c.empresa_id, v_avisar, 'cotacao_respondida', c.fornecedor || ' respondeu a cotação da requisição ' || r.numero,
    v_n || ' item(ns) cotado(s)' || coalesce(' · prazo ' || p_prazo_dias || ' dia(s)', ''), '#/compras/requisicoes?abrir=' || r.id, r.id, false);
end $$;
revoke all on function public.cotacao_link_abrir(text), public.cotacao_link_responder(text, jsonb, int, text, int[], numeric, date, text, text, text, jsonb) from public;
grant execute on function public.cotacao_link_abrir(text), public.cotacao_link_responder(text, jsonb, int, text, int[], numeric, date, text, text, text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------ questionário de fornecedores (extensão do SQL 198)
alter table public.cadq_questionarios add column if not exists publico text not null default 'cliente';
do $$ begin
  alter table public.cadq_questionarios add constraint cadq_q_publico_chk check (publico in ('cliente', 'fornecedor'));
exception when duplicate_object then null; end $$;
alter table public.cad_perfil_fiscal add column if not exists simples_credito_pct numeric(7,4);
alter table public.cad_perfil_fiscal add column if not exists atividade text;   -- fornecedor: fabricante, importador, distribuidor, prestador

-- quem pode: cliente → papéis da tela (o vendedor, só a carteira); fornecedor → quem compra
create or replace function public._cadq_pode(p_empresa uuid, p_publico text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_publico = 'fornecedor' then public.pode_comprar(p_empresa) and public._mfa_ok(p_empresa) else public._cadq_usa(p_empresa) end;
$$;
create or replace function public._cadq_ve_q(p_empresa uuid, p_fav uuid, p_publico text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_publico = 'fornecedor' then public.pode_comprar(p_empresa) and public._mfa_ok(p_empresa) else public._cadq_ve(p_empresa, p_fav) end;
$$;
revoke all on function public._cadq_pode(uuid, text), public._cadq_ve_q(uuid, uuid, text) from public, anon;
grant execute on function public._cadq_pode(uuid, text), public._cadq_ve_q(uuid, uuid, text) to authenticated;
drop policy if exists cadq_questionarios_sel on public.cadq_questionarios;
create policy cadq_questionarios_sel on public.cadq_questionarios for select to authenticated using (public._cadq_ve_q(empresa_id, favorecido_id, publico));
drop policy if exists cad_perfil_fiscal_sel on public.cad_perfil_fiscal;
create policy cad_perfil_fiscal_sel on public.cad_perfil_fiscal for select to authenticated
  using (public.is_membro(empresa_id) or public._comp_usa(empresa_id) or public._cadq_ve(empresa_id, favorecido_id) or public.pode_comprar(empresa_id));
create or replace function public.cadq_acesso_publico(p_empresa uuid, p_publico text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usa', public._cadq_pode(p_empresa, p_publico),
    'aplica', case when p_publico = 'fornecedor' then public.pode_comprar(p_empresa) and public._mfa_ok(p_empresa) else public._cadq_aplica(p_empresa) end,
    'admin', coalesce(public.papel_em(p_empresa) = 'admin', false), 'validade_dias', (public._cadq_cfg(p_empresa)).validade_dias, 'mensagem', (public._cadq_cfg(p_empresa)).mensagem);
$$;

drop function if exists public.cadq_gerar(uuid, uuid[], text);
create or replace function public.cadq_gerar(p_empresa uuid, p_favorecidos uuid[], p_mensagem text default null, p_publico text default 'cliente') returns jsonb
language plpgsql security definer set search_path = public as $$
declare f uuid; v favorecidos; q cadq_questionarios; n int; r jsonb := '[]'::jsonb; cfg cadq_config := public._cadq_cfg(p_empresa);
begin
  if coalesce(p_publico, '') not in ('cliente', 'fornecedor') then raise exception 'Público inválido.'; end if;
  if not public._cadq_pode(p_empresa, p_publico) then raise exception 'Sem acesso à atualização cadastral.'; end if;
  if coalesce(array_length(p_favorecidos, 1), 0) = 0 then raise exception 'Escolha pelo menos um cliente.'; end if;
  if array_length(p_favorecidos, 1) > 500 then raise exception 'No máximo 500 clientes por vez.'; end if;
  perform pg_advisory_xact_lock(hashtext('cadq:' || p_empresa::text));
  foreach f in array p_favorecidos loop
    select * into v from favorecidos where id = f and empresa_id = p_empresa;
    if v.id is null then raise exception 'Cliente de outra empresa.'; end if;
    if p_publico = 'cliente' and not public._cadq_ve(p_empresa, f) then raise exception 'O cliente % está fora da sua carteira.', v.nome; end if;
    select * into q from cadq_questionarios where empresa_id = p_empresa and favorecido_id = f and publico = p_publico and situacao in ('enviado', 'aberto') and expira_em >= current_date
      order by criado_em desc limit 1;
    if q.id is not null then
      r := r || jsonb_build_array(jsonb_build_object('id', q.id, 'numero', q.numero, 'favorecido_id', f, 'cliente', q.cliente, 'token', q.token, 'expira_em', q.expira_em, 'novo', false,
        'email', v.email, 'telefone', v.telefone));
      continue;
    end if;
    select coalesce(max(numero), 0) + 1 into n from cadq_questionarios where empresa_id = p_empresa;
    insert into cadq_questionarios(empresa_id, numero, favorecido_id, cliente, expira_em, mensagem, publico)
    values (p_empresa, n, f, coalesce(nullif(trim(v.nome_fantasia), ''), v.nome), current_date + cfg.validade_dias, nullif(trim(coalesce(p_mensagem, cfg.mensagem)), ''), p_publico)
    returning * into q;
    r := r || jsonb_build_array(jsonb_build_object('id', q.id, 'numero', q.numero, 'favorecido_id', f, 'cliente', q.cliente, 'token', q.token, 'expira_em', q.expira_em, 'novo', true,
      'email', v.email, 'telefone', v.telefone));
  end loop;
  return r;
end $$;

create or replace function public.cadq_link_abrir(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q cadq_questionarios := public._cadq_por_token(p_token); v favorecidos; pf cad_perfil_fiscal;
begin
  if q.id is null then raise exception 'Link inválido. Confira se o link foi copiado inteiro ou peça um novo.'; end if;
  select * into v from favorecidos where id = q.favorecido_id;
  select * into pf from cad_perfil_fiscal where empresa_id = q.empresa_id and favorecido_id = q.favorecido_id;
  if q.situacao = 'enviado' then update cadq_questionarios set situacao = 'aberto', aberto_em = now() where id = q.id; q.situacao := 'aberto'; end if;
  return jsonb_build_object(
    'empresa', (select coalesce(razao_social, nome) from empresas where id = q.empresa_id), 'numero', q.numero, 'cliente', q.cliente,
    'publico', q.publico, 'situacao', q.situacao, 'expira_em', q.expira_em, 'vencido', q.expira_em < current_date, 'mensagem', q.mensagem, 'respondido_em', q.respondido_em,
    -- o que já temos, para o cliente conferir (a resposta anterior, se houver, tem prioridade)
    'atual', coalesce(q.resposta, jsonb_build_object(
      'razao_social', v.nome, 'nome_fantasia', v.nome_fantasia, 'documento', v.documento, 'ie', v.ie, 'im', v.im,
      'cep', v.cep, 'logradouro', v.logradouro, 'numero', v.numero, 'complemento', v.complemento, 'bairro', v.bairro, 'municipio', v.municipio, 'uf', v.uf,
      'email_nfe', v.email, 'telefone', v.telefone, 'contribuinte_icms', v.contribuinte_icms,
      'regime', case v.regime_tributario when 'Simples Nacional' then 'simples' when 'MEI' then 'mei' when 'Lucro Presumido' then 'presumido' when 'Lucro Real' then 'real' end,
      'cnae', coalesce(pf.cnae, v.receita_dados ->> 'cnae'), 'destinacao', to_jsonb(coalesce(pf.destinacao, '{}')), 'cred_icms', pf.cred_icms, 'cred_pc', pf.cred_pc,
      'simples_regular', pf.simples_regular, 'especiais', coalesce(pf.especiais, '{}'), 'contato_fiscal', coalesce(pf.contato_fiscal, '{}'), 'contador', coalesce(pf.contador, '{}'),
      'simples_credito_pct', pf.simples_credito_pct, 'atividade', pf.atividade)));
end $$;

create or replace function public.cadq_link_responder(p_token text, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare q cadq_questionarios := public._cadq_por_token(p_token); d jsonb; v_nome text; x text;
begin
  if q.id is null then raise exception 'Link inválido.'; end if;
  if q.situacao = 'cancelado' then raise exception 'Este questionário foi cancelado. Peça um novo link.'; end if;
  if q.situacao in ('aplicado', 'descartado') then raise exception 'Este questionário já foi recebido e conferido. Para mudar alguma informação, peça um novo link.'; end if;
  if q.expira_em < current_date then raise exception 'O prazo deste link terminou em %. Peça um novo link.', to_char(q.expira_em, 'DD/MM/YYYY'); end if;
  if jsonb_typeof(p_dados) <> 'object' or length(p_dados::text) > 30000 then raise exception 'Respostas inválidas.'; end if;
  d := p_dados;
  if coalesce((d ->> 'aceite')::boolean, false) is not true then raise exception 'Marque a declaração de que as informações são verdadeiras.'; end if;
  v_nome := trim(coalesce(d -> 'declarante' ->> 'nome', ''));
  if length(v_nome) < 3 then raise exception 'Informe o nome de quem está respondendo.'; end if;
  foreach x in array array[d ->> 'email_nfe', d -> 'declarante' ->> 'email', d -> 'contato_fiscal' ->> 'email', d -> 'contador' ->> 'email'] loop
    if coalesce(trim(x), '') <> '' and trim(x) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %', x; end if;
  end loop;
  if coalesce(d ->> 'uf', '') <> '' and d ->> 'uf' !~ '^[A-Z]{2}$' then raise exception 'UF inválida.'; end if;
  if coalesce(d ->> 'regime', '') not in ('', 'real', 'presumido', 'simples', 'mei') then raise exception 'Regime inválido.'; end if;
  if coalesce(d ->> 'contribuinte_icms', '') not in ('', '1', '2', '9') then raise exception 'Informe se é contribuinte do ICMS.'; end if;
  if coalesce(d ->> 'simples_credito_pct', '') <> '' and ((d ->> 'simples_credito_pct') !~ '^\d+(\.\d+)?$' or (d ->> 'simples_credito_pct')::numeric > 20) then raise exception 'Percentual de crédito do Simples inválido.'; end if;
  if coalesce(d ->> 'atividade', '') not in ('', 'fabricante', 'importador', 'distribuidor', 'prestador') then raise exception 'Atividade inválida.'; end if;
  update cadq_questionarios set situacao = 'respondido', respondido_em = now(), resposta = d,
    respondido_por = left(v_nome || coalesce(' (' || nullif(trim(d -> 'declarante' ->> 'cargo'), '') || ')', '') || coalesce(' <' || nullif(trim(d -> 'declarante' ->> 'email'), '') || '>', ''), 300)
  where id = q.id;
  perform _notificar_u(q.empresa_id, array_remove(case when q.publico = 'fornecedor' then _usuarios_papel(q.empresa_id, array['admin', 'compras'])
      else _usuarios_papel(q.empresa_id, (public._cadq_cfg(q.empresa_id)).papeis_aplicar) end || array[q.criado_por_id], null),
    'cadastro_reforma', q.cliente || ' respondeu a atualização cadastral' || case when q.publico = 'fornecedor' then ' (fornecedor)' else '' end,
    'Questionário nº ' || q.numero || ' · confira e aplique ao cadastro',
    case when q.publico = 'fornecedor' then '#/compras/cadastro-fornecedores?abrir=' else '#/comercial/cadastro-reforma?abrir=' end || q.id, q.id, false);
end $$;

-- ------------------------------------------------------------ conferir e aplicar (interno)
-- p_campos: chaves da resposta a aplicar. Cadastro (favorecidos): nome_fantasia, ie, im, cep, logradouro, numero, complemento,
-- bairro, municipio, uf, email_nfe, telefone, contribuinte_icms, regime. Perfil fiscal: tipo, destinacao, cred_icms, cred_pc,
-- simples_regular, cnae, especiais, contato_fiscal, contador.
create or replace function public.cadq_aplicar(p_id uuid, p_campos text[]) returns void
language plpgsql security definer set search_path = public as $$
declare q cadq_questionarios; d jsonb; tem boolean := false; c text; v_por text;
begin
  select * into q from cadq_questionarios where id = p_id for update;
  if q.id is null or not (case when q.publico = 'fornecedor' then public.pode_comprar(q.empresa_id) and public._mfa_ok(q.empresa_id) else public._cadq_aplica(q.empresa_id) end) then raise exception 'Sem permissão para aplicar ao cadastro.'; end if;
  if q.situacao not in ('respondido', 'aplicado') then raise exception 'O questionário ainda não foi respondido.'; end if;
  d := q.resposta;
  v_por := coalesce(nullif(trim((select m.nome from membros m where m.empresa_id = q.empresa_id and m.user_id = auth.uid())), ''), auth.jwt() ->> 'email');
  foreach c in array coalesce(p_campos, '{}') loop
    if c not in ('nome_fantasia', 'ie', 'im', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'email_nfe', 'telefone', 'contribuinte_icms', 'regime',
                 'tipo', 'destinacao', 'cred_icms', 'cred_pc', 'simples_regular', 'cnae', 'especiais', 'contato_fiscal', 'contador', 'simples_credito_pct', 'atividade') then raise exception 'Campo inválido: %', c; end if;
  end loop;
  update favorecidos f set
    nome_fantasia = case when 'nome_fantasia' = any(p_campos) then nullif(trim(d ->> 'nome_fantasia'), '') else f.nome_fantasia end,
    ie = case when 'ie' = any(p_campos) then nullif(trim(d ->> 'ie'), '') else f.ie end,
    im = case when 'im' = any(p_campos) then nullif(trim(d ->> 'im'), '') else f.im end,
    cep = case when 'cep' = any(p_campos) then nullif(regexp_replace(coalesce(d ->> 'cep', ''), '\D', '', 'g'), '') else f.cep end,
    logradouro = case when 'logradouro' = any(p_campos) then nullif(trim(d ->> 'logradouro'), '') else f.logradouro end,
    numero = case when 'numero' = any(p_campos) then nullif(trim(d ->> 'numero'), '') else f.numero end,
    complemento = case when 'complemento' = any(p_campos) then nullif(trim(d ->> 'complemento'), '') else f.complemento end,
    bairro = case when 'bairro' = any(p_campos) then nullif(trim(d ->> 'bairro'), '') else f.bairro end,
    municipio = case when 'municipio' = any(p_campos) then nullif(trim(d ->> 'municipio'), '') else f.municipio end,
    uf = case when 'uf' = any(p_campos) then nullif(d ->> 'uf', '') else f.uf end,
    email = case when 'email_nfe' = any(p_campos) then nullif(lower(trim(d ->> 'email_nfe')), '') else f.email end,
    telefone = case when 'telefone' = any(p_campos) then nullif(trim(d ->> 'telefone'), '') else f.telefone end,
    contribuinte_icms = case when 'contribuinte_icms' = any(p_campos) then nullif(d ->> 'contribuinte_icms', '') else f.contribuinte_icms end,
    regime_tributario = case when 'regime' = any(p_campos) then case d ->> 'regime' when 'simples' then 'Simples Nacional' when 'mei' then 'MEI' when 'presumido' then 'Lucro Presumido'
                             when 'real' then 'Lucro Real' else f.regime_tributario end else f.regime_tributario end
  where f.id = q.favorecido_id;
  if p_campos && array['tipo', 'destinacao', 'cred_icms', 'cred_pc', 'simples_regular', 'cnae', 'especiais', 'contato_fiscal', 'contador', 'regime', 'contribuinte_icms', 'simples_credito_pct', 'atividade'] then
    insert into cad_perfil_fiscal(empresa_id, favorecido_id, fonte, questionario_id) values (q.empresa_id, q.favorecido_id, 'questionario', q.id)
    on conflict (empresa_id, favorecido_id) do nothing;
    update cad_perfil_fiscal p set
      tipo = case when 'tipo' = any(p_campos) then nullif(d ->> 'tipo', '') else p.tipo end,
      regime = case when 'regime' = any(p_campos) then nullif(d ->> 'regime', '') else p.regime end,
      destinacao = case when 'destinacao' = any(p_campos) then array(select jsonb_array_elements_text(coalesce(d -> 'destinacao', '[]'))) else p.destinacao end,
      cred_icms = case when 'cred_icms' = any(p_campos) then nullif(d ->> 'cred_icms', '') else p.cred_icms end,
      cred_pc = case when 'cred_pc' = any(p_campos) then nullif(d ->> 'cred_pc', '') else p.cred_pc end,
      simples_regular = case when 'simples_regular' = any(p_campos) then nullif(d ->> 'simples_regular', '') else p.simples_regular end,
      cnae = case when 'cnae' = any(p_campos) then nullif(trim(d ->> 'cnae'), '') else p.cnae end,
      especiais = case when 'especiais' = any(p_campos) then coalesce(d -> 'especiais', '{}') else p.especiais end,
      contato_fiscal = case when 'contato_fiscal' = any(p_campos) then coalesce(d -> 'contato_fiscal', '{}') else p.contato_fiscal end,
      contador = case when 'contador' = any(p_campos) then coalesce(d -> 'contador', '{}') else p.contador end,
      simples_credito_pct = case when 'simples_credito_pct' = any(p_campos) then nullif(d ->> 'simples_credito_pct', '')::numeric else p.simples_credito_pct end,
      atividade = case when 'atividade' = any(p_campos) then nullif(d ->> 'atividade', '') else p.atividade end,
      fonte = 'questionario', questionario_id = q.id, atualizado_por = auth.uid(), atualizado_em = now()
    where p.empresa_id = q.empresa_id and p.favorecido_id = q.favorecido_id;
  end if;
  update cadq_questionarios set situacao = 'aplicado', aplicado_em = now(), aplicado_por = v_por, aplicado_campos = p_campos where id = q.id;
end $$;

create or replace function public.cadq_situacao(p_id uuid, p_acao text, p_obs text default null) returns void
language plpgsql security definer set search_path = public as $$
declare q cadq_questionarios;
begin
  select * into q from cadq_questionarios where id = p_id for update;
  if q.id is null or not public._cadq_ve_q(q.empresa_id, q.favorecido_id, q.publico) then raise exception 'Questionário não encontrado.'; end if;
  if p_acao = 'cancelar' then
    if q.situacao not in ('enviado', 'aberto') then raise exception 'Só dá para cancelar o link que ainda não foi respondido.'; end if;
    update cadq_questionarios set situacao = 'cancelado', obs = nullif(trim(p_obs), '') where id = p_id;
  elsif p_acao = 'descartar' then
    if not (case when q.publico = 'fornecedor' then public.pode_comprar(q.empresa_id) else public._cadq_aplica(q.empresa_id) end) then raise exception 'Sem permissão.'; end if;
    if q.situacao <> 'respondido' then raise exception 'Só dá para descartar uma resposta ainda não aplicada.'; end if;
    if coalesce(trim(p_obs), '') = '' then raise exception 'Informe o motivo do descarte.'; end if;
    update cadq_questionarios set situacao = 'descartado', obs = trim(p_obs) where id = p_id;
  elsif p_acao = 'prorrogar' then
    if q.situacao not in ('enviado', 'aberto') then raise exception 'Só dá para prorrogar o link que ainda não foi respondido.'; end if;
    update cadq_questionarios set expira_em = greatest(expira_em, current_date) + (public._cadq_cfg(q.empresa_id)).validade_dias where id = p_id;
  else raise exception 'Ação inválida.'; end if;
end $$;

-- ------------------------------------------------------------ permissões
do $$ declare f text; begin
  foreach f in array array['public.compras_hist_fiscal(uuid, uuid)', 'public.cadq_acesso_publico(uuid, text)', 'public.cadq_gerar(uuid, uuid[], text, text)',
    'public.cadq_aplicar(uuid, text[])', 'public.cadq_situacao(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.cadq_link_abrir(text), public.cadq_link_responder(text, jsonb) from public;
grant execute on function public.cadq_link_abrir(text), public.cadq_link_responder(text, jsonb) to anon, authenticated;

select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compras_cotacao_itens' and column_name in ('icms_aliq', 'ipi_aliq', 'st_un')) as colunas_fiscais,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cadq_questionarios' and column_name = 'publico') as publico;

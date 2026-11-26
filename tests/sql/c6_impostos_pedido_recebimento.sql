-- Impostos no pedido e no recebimento (SQL 200): o pedido leva os impostos da cotação, o total soma IPI e ST,
-- e o confronto confere ICMS, IPI, ICMS-ST e regime da nota contra o pedido, com tolerância em R$.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into compras_parametros(empresa_id) values (:E) on conflict (empresa_id) do nothing;
update compras_parametros set conf_tol_preco_pct = 2, conf_tol_qtd_pct = 5, conf_tol_valor = 10, conf_bloquear = true, conf_impostos = true, conf_tol_imposto_valor = 50 where empresa_id = :E;
insert into favorecidos(id, empresa_id, tipo, nome) values ('c6000000-0000-0000-0000-0000000000f1', :E, 'FORNECEDORES', 'FORNECEDOR C6');

-- 1) o total do pedido soma IPI e ICMS-ST (rascunho: os itens ainda mudam)
insert into compras_pedidos(id, empresa_id, favorecido_id, data_pedido, parcelas_dias, status, plano_id, uf, regime) values
  ('c6000000-0000-0000-0000-0000000000a1', :E, 'c6000000-0000-0000-0000-0000000000f1', current_date, '{28}', 'rascunho', 'f000000a-0000-0000-0000-000000000000', 'PB', 'real');
insert into compras_pedido_itens(id, empresa_id, pedido_id, descricao, unidade, quantidade, valor_unitario, destinacao, icms_aliq, ipi_aliq, st_un) values
  ('c6000000-0000-0000-0000-0000000000b1', :E, 'c6000000-0000-0000-0000-0000000000a1', 'PL720N', 'KG', 27000, 10.6667, 'insumo', 12, 5, null),
  ('c6000000-0000-0000-0000-0000000000b2', :E, 'c6000000-0000-0000-0000-0000000000a1', 'LUVA', 'PAR', 100, 10, 'uso_consumo', 12, 0, 1.50);
-- 27.000 × 10,6667 = 288.000,90 + IPI 5% 14.400,05 + luvas 1.000 + ST 150 = 303.551,0 (arredondado)
select pg_temp.ok((select total = round(27000 * 10.6667 * 1.05 + 1000 + 150, 2) from compras_pedidos where id = 'c6000000-0000-0000-0000-0000000000a1'), 'total com IPI e ICMS-ST');
select pg_temp.falha($$update compras_pedido_itens set icms_aliq = 150 where id = 'c6000000-0000-0000-0000-0000000000b1'$$, 'alíquota fora de 0 a 100');
select pg_temp.falha($$update compras_pedido_itens set destinacao = 'outra' where id = 'c6000000-0000-0000-0000-0000000000b1'$$, 'destinação fora da lista');
select pg_temp.falha($$update compras_pedidos set regime = 'xx' where id = 'c6000000-0000-0000-0000-0000000000a1'$$, 'regime inválido');
set session_replication_role = replica;   -- aprovação fora da alçada (já testada em outro arquivo)
update compras_pedidos set status = 'aprovado' where id = 'c6000000-0000-0000-0000-0000000000a1';
set session_replication_role = origin;
select pg_temp.falha($$update compras_pedido_itens set ipi_aliq = 0 where id = 'c6000000-0000-0000-0000-0000000000b1'$$, 'imposto não muda depois de aprovado');

-- 2) a nota: ICMS 7% (pedido 12%), IPI 5% (igual), luva com IPI 10% (pedido 0%) e ST de R$ 400 (pedido R$ 150)
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_nome, favorecido_id) values
  ('c6000000-0000-0000-0000-0000000000c1', :E, '25261100000000000000550010000092531000000001', 9253, current_date, 'entrada', false, 'autorizada', 'FORNECEDOR C6', 'c6000000-0000-0000-0000-0000000000f1');
insert into nfe_itens(id, empresa_id, nota_id, n_item, xprod, qcom, vuncom, vprod, cst_icms, v_bc_icms, p_icms, v_icms, v_ipi, v_st) values
  ('c6000000-0000-0000-0000-0000000000d1', :E, 'c6000000-0000-0000-0000-0000000000c1', 1, 'PL720N', 27000, 10.6667, 288000.90, '00', 288000.90, 7, 20160.06, 14400.05, 0),
  ('c6000000-0000-0000-0000-0000000000d2', :E, 'c6000000-0000-0000-0000-0000000000c1', 2, 'LUVA', 100, 10, 1000, '10', 1000, 12, 120, 100, 400);
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
create temp table dv as select public.compras_confrontar('c6000000-0000-0000-0000-0000000000a1', 'c6000000-0000-0000-0000-0000000000c1',
  '[{"pedido_item_id":"c6000000-0000-0000-0000-0000000000b1","nfe_item_id":"c6000000-0000-0000-0000-0000000000d1","quantidade":27000,"valor_unitario":10.6667},
    {"pedido_item_id":"c6000000-0000-0000-0000-0000000000b2","nfe_item_id":"c6000000-0000-0000-0000-0000000000d2","quantidade":100,"valor_unitario":10}]', current_date) d;
-- ICMS 5 pontos a menos sobre 288.000,90 = 14.400,05 de crédito perdido: bloqueia
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "imposto_icms" && @.custo == 14400.05 && @.bloqueia == true)') from dv), 'ICMS menor: crédito perdido e bloqueio');
-- IPI do PL720N igual ao pedido: nada
select pg_temp.ok((select not jsonb_path_exists(d, '$[*] ? (@.tipo == "imposto_ipi" && @.item == "PL720N")') from dv), 'IPI igual não diverge');
-- luva (uso e consumo): IPI 10% a mais = R$ 100, sem crédito → bloqueia (acima de R$ 50)
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "imposto_ipi" && @.item == "LUVA" && @.desembolso == 100 && @.custo == 100 && @.bloqueia == true)') from dv), 'IPI a mais no uso e consumo');
-- luva: ST 400 × esperado 150 = 250 a mais
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "imposto_st" && @.custo == 250)') from dv), 'ICMS-ST a mais');
-- luva: ICMS igual (12%) e uso e consumo — nada de ICMS
select pg_temp.ok((select not jsonb_path_exists(d, '$[*] ? (@.tipo == "imposto_icms" && @.item == "LUVA")') from dv), 'ICMS igual não diverge');

-- 3) abaixo da tolerância só avisa; parâmetro desligado não confere
reset role;
update compras_parametros set conf_tol_imposto_valor = 300 where empresa_id = :E;
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "imposto_st" && @.bloqueia == false)')
  from (select public.compras_confrontar('c6000000-0000-0000-0000-0000000000a1', 'c6000000-0000-0000-0000-0000000000c1',
  '[{"pedido_item_id":"c6000000-0000-0000-0000-0000000000b2","nfe_item_id":"c6000000-0000-0000-0000-0000000000d2","quantidade":100,"valor_unitario":10}]', current_date) d) x), 'abaixo da tolerância: só aviso');
reset role;
update compras_parametros set conf_impostos = false where empresa_id = :E;
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok((select not jsonb_path_exists(d, '$[*] ? (@.tipo starts with "imposto")')
  from (select public.compras_confrontar('c6000000-0000-0000-0000-0000000000a1', 'c6000000-0000-0000-0000-0000000000c1',
  '[{"pedido_item_id":"c6000000-0000-0000-0000-0000000000b1","nfe_item_id":"c6000000-0000-0000-0000-0000000000d1","quantidade":27000,"valor_unitario":10.6667}]', current_date) d) x), 'conferência de impostos desligada');
reset role;
update compras_parametros set conf_impostos = true, conf_tol_imposto_valor = 50 where empresa_id = :E;
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');

-- 4) nota do Simples quando o pedido previa regime normal
reset role;
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_nome) values
  ('c6000000-0000-0000-0000-0000000000c2', :E, '26261100000000000000550010000092541000000001', 9254, current_date, 'entrada', false, 'autorizada', 'FORNECEDOR C6');
insert into nfe_itens(id, empresa_id, nota_id, n_item, xprod, qcom, vuncom, vprod, cst_icms, v_ipi, v_st) values
  ('c6000000-0000-0000-0000-0000000000d3', :E, 'c6000000-0000-0000-0000-0000000000c2', 1, 'PL720N', 1000, 10.6667, 10666.70, '101', 533.34, 0);
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "imposto_regime" && @.custo == 1280.00 && @.bloqueia == true)')
  from (select public.compras_confrontar('c6000000-0000-0000-0000-0000000000a1', 'c6000000-0000-0000-0000-0000000000c2',
  '[{"pedido_item_id":"c6000000-0000-0000-0000-0000000000b1","nfe_item_id":"c6000000-0000-0000-0000-0000000000d3","quantidade":1000,"valor_unitario":10.6667}]', current_date) d) x), 'nota do Simples: crédito de ICMS perdido');

-- 5) recebe a 1ª nota: bloqueia com o efeito dos impostos e alimenta o cotado × realizado
select public.compras_receber('c6000000-0000-0000-0000-0000000000a1', 'c6000000-0000-0000-0000-0000000000c1', current_date,
  '[{"pedido_item_id":"c6000000-0000-0000-0000-0000000000b1","nfe_item_id":"c6000000-0000-0000-0000-0000000000d1","quantidade":27000,"valor_unitario":10.6667},
    {"pedido_item_id":"c6000000-0000-0000-0000-0000000000b2","nfe_item_id":"c6000000-0000-0000-0000-0000000000d2","quantidade":100,"valor_unitario":10}]', '[]', false, null);
create temp table rz as select public.compras_liquido_realizado(:E::uuid, null, null, 'c6000000-0000-0000-0000-0000000000a1') r;
reset role;
select pg_temp.ok((select valor_divergente = 14400.05 + 100 + 250 from compras_bloqueios where nota_id = 'c6000000-0000-0000-0000-0000000000c1' and situacao = 'bloqueada'), 'bloqueio soma os impostos');
select pg_temp.ok((select jsonb_array_length(r) = 2 from rz), 'cotado × realizado do pedido: 2 itens recebidos');
select pg_temp.ok((select jsonb_array_length(public.compras_liquido_realizado(:E::uuid, current_date - 1, current_date + 1, null)) >= 2), 'por período');
select pg_temp.ok((select (x ->> 'icms_pedido')::numeric = 12 and (x ->> 'icms_nota')::numeric = 7 and (x ->> 'ipi_nota')::numeric = 5 and (x ->> 'comparavel')::boolean
  from rz, jsonb_array_elements(r) x where x ->> 'item' = 'PL720N'), 'alíquotas cotadas e da nota');
select pg_temp.ok((select (x ->> 'st_un_nota')::numeric = 4 from rz, jsonb_array_elements(r) x where x ->> 'item' = 'LUVA'), 'ST por unidade da nota');
-- 6) a leitura respeita o acesso
select pg_temp.entrar('00000000-0000-0000-0000-0000000000ff');
select pg_temp.falha($$select public.compras_liquido_realizado('e000000a-0000-0000-0000-000000000000', null, null, null)$$, 'sem acesso');
reset role;
\o
select 'c6 ok';

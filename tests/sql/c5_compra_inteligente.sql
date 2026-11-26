-- Compra inteligente (SQL 199): dados fiscais na cotação por link, histórico das notas de entrada e questionário de fornecedores.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'compras.a@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); perform set_config('request.jwt.claim.sub', '', false); set role anon; end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
grant execute on function pg_temp.ok(boolean, text), pg_temp.falha(text, text) to anon;
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into favorecidos(id, empresa_id, tipo, nome, documento, uf) values ('c5000000-0000-0000-0000-0000000000f1', :E, 'FORNECEDORES', 'FORNECEDOR C5', '12.345.678/0001-95', null);
insert into compras_requisicoes(id, empresa_id, numero, status) values ('c5000000-0000-0000-0000-0000000000a1', :E, 99501, 'aprovada');
insert into compras_requisicao_itens(id, empresa_id, requisicao_id, descricao, unidade, quantidade, ncm, destinacao) values
  ('c5000000-0000-0000-0000-0000000000b1', :E, 'c5000000-0000-0000-0000-0000000000a1', 'RESINA PEBD', 'KG', 1000, '39011092', 'insumo'),
  ('c5000000-0000-0000-0000-0000000000b2', :E, 'c5000000-0000-0000-0000-0000000000a1', 'LUVA', 'UN', 50, '40151900', 'uso_consumo');
-- nota de entrada do fornecedor (pelo CNPJ do emitente), emitida em SE (código 28)
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc) values
  ('c5000000-0000-0000-0000-0000000000d1', :E, '28261112345678000195550010000099511000099510', 99511, '2026-11-10', 'entrada', false, 'autorizada', '12345678000195');
insert into nfe_itens(id, empresa_id, nota_id, n_item, ncm, xprod, qcom, vprod, p_icms, v_ipi, v_st, orig, cst_icms) values
  (gen_random_uuid(), :E, 'c5000000-0000-0000-0000-0000000000d1', 1, '39011092', 'PEBD', 1000, 17000, 12, 0, 0, '0', '00');
create temp table tk(t text, n int); grant all on tk to authenticated, anon;

select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok((select jsonb_array_length(public.compras_hist_fiscal(:E::uuid, 'c5000000-0000-0000-0000-0000000000f1')) = 1), 'histórico pelas notas de entrada');
select pg_temp.ok((public.compras_hist_fiscal(:E::uuid, 'c5000000-0000-0000-0000-0000000000f1') -> 0 ->> 'uf') = 'SE', 'UF pela chave da nota');
insert into tk select public.compras_convidar('c5000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-0000000000f1', null, null), 1;
reset role;
select pg_temp.anon();
select pg_temp.ok((public.cotacao_link_abrir((select t from tk where n = 1)) -> 'fiscal' ->> 'uf') = 'SE', 'UF sugerida para o fornecedor');
select pg_temp.ok((public.cotacao_link_abrir((select t from tk where n = 1)) -> 'historico' -> 0 ->> 'p_icms')::numeric = 12, 'alíquota da última nota');
select pg_temp.ok(not (public.cotacao_link_abrir((select t from tk where n = 1)) -> 'historico' -> 0 ? 'xprod'), 'o fornecedor não vê a descrição das notas');
select pg_temp.falha($$select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"c5000000-0000-0000-0000-0000000000b1","valor_unitario":17,"icms_aliq":99}]', 10, null, null, 0, null, null, 'Ana', null, '{}')$$, 'alíquota absurda');
select pg_temp.falha($$select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"c5000000-0000-0000-0000-0000000000b1","valor_unitario":17}]', 10, null, null, 0, null, null, 'Ana', null, '{"regime":"xx"}')$$, 'regime inválido');
select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"c5000000-0000-0000-0000-0000000000b1","valor_unitario":17,"icms_aliq":12,"ipi_aliq":0,"st_un":0},{"item_id":"c5000000-0000-0000-0000-0000000000b2","valor_unitario":2.5,"icms_aliq":12,"ipi_aliq":5}]',
  10, '28', '{28}', 100, null, null, 'Ana Vendas', null, '{"uf":"SE","regime":"simples","simples_credito_pct":2.5,"simples_regular":"avaliando"}');
-- chamada antiga, sem os dados fiscais, continua funcionando
select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"c5000000-0000-0000-0000-0000000000b1","valor_unitario":16.9,"icms_aliq":12}]', 10, '28', '{28}', 100, null, null, 'Ana Vendas', null);
reset role;
select pg_temp.ok((select uf = 'SE' and regime = 'simples' and simples_credito_pct = 2.5 and simples_regular = 'avaliando' from compras_cotacoes where requisicao_id = 'c5000000-0000-0000-0000-0000000000a1'), 'cabeçalho fiscal gravado e mantido');
select pg_temp.ok((select icms_aliq = 12 and fonte_fiscal = 'fornecedor' and valor_unitario = 16.9 from compras_cotacao_itens ci join compras_cotacoes c on c.id = ci.cotacao_id
  where c.requisicao_id = 'c5000000-0000-0000-0000-0000000000a1' and ci.requisicao_item_id = 'c5000000-0000-0000-0000-0000000000b1'), 'itens com as alíquotas');
select pg_temp.falha($$update compras_requisicao_itens set destinacao = 'outra' where id = 'c5000000-0000-0000-0000-0000000000b1'$$, 'destinação fora da lista');

-- questionário de fornecedores
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
insert into tk select public.cadq_gerar(:E::uuid, array['c5000000-0000-0000-0000-0000000000f1']::uuid[], null, 'fornecedor') -> 0 ->> 'token', 2;
select pg_temp.ok((select publico = 'fornecedor' from cadq_questionarios where favorecido_id = 'c5000000-0000-0000-0000-0000000000f1'), 'questionário de fornecedor');
select pg_temp.ok((public.cadq_gerar(:E::uuid, array['c5000000-0000-0000-0000-0000000000f1']::uuid[], null, 'fornecedor') -> 0 ->> 'novo')::boolean = false, 'reaproveita o link do fornecedor');
reset role;
select pg_temp.anon();
select pg_temp.ok((public.cadq_link_abrir((select t from tk where n = 2)) ->> 'publico') = 'fornecedor', 'a página sabe que é fornecedor');
select pg_temp.falha($$select public.cadq_link_responder((select t from tk where n = 2), '{"aceite":true,"declarante":{"nome":"Ana"},"simples_credito_pct":"99"}')$$, '% do Simples absurdo');
select public.cadq_link_responder((select t from tk where n = 2), '{"aceite":true,"declarante":{"nome":"Ana Vendas"},"regime":"simples","simples_credito_pct":"2.75","simples_regular":"sim","atividade":"fabricante","uf":"SE"}');
reset role;
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select public.cadq_aplicar((select id from cadq_questionarios where favorecido_id = 'c5000000-0000-0000-0000-0000000000f1'), array['regime', 'simples_credito_pct', 'simples_regular', 'atividade', 'uf']);
reset role;
select pg_temp.ok((select simples_credito_pct = 2.75 and atividade = 'fabricante' and simples_regular = 'sim' from cad_perfil_fiscal where favorecido_id = 'c5000000-0000-0000-0000-0000000000f1'), 'perfil do fornecedor');
select pg_temp.ok((select uf = 'SE' and regime_tributario = 'Simples Nacional' from favorecidos where id = 'c5000000-0000-0000-0000-0000000000f1'), 'cadastro do fornecedor');
-- vendedor não gera questionário de fornecedor
select pg_temp.entrar('c3000000-0000-0000-0000-0000000000a1');
select pg_temp.falha($$select public.cadq_gerar('e000000a-0000-0000-0000-000000000000', array['c5000000-0000-0000-0000-0000000000f1']::uuid[], null, 'fornecedor')$$, 'vendas não envia para fornecedor');
reset role;

-- Previsão de tinta (SQL 117): ficha de cores, consumo real, OPs da programação, sobras e insumos.
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
insert into prod_setores(id, empresa_id, nome, ordem) values ('5f000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Impressão Tinta', 1);
insert into produtos(id, empresa_id, codigo, descricao, unidade) values
  ('5f000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'PA-T', 'SACO IMPRESSO T', 'KG'),
  ('5f000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'TN-BASE-T', 'BASE AZUL T', 'KG');
insert into tin_cores(id, empresa_id, codigo, nome) values ('5f000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'AZ-T', 'AZUL T'),
  ('5f000000-0000-0000-0000-0000000000a2', 'e000000a-0000-0000-0000-000000000000', 'VM-T', 'VERMELHO T');
insert into tin_receitas(id, empresa_id, cor_id, codigo, nome) values ('5f000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-0000000000a1', 'R-AZ-T', 'Azul T');
-- regras da Casa de Tintas desligadas só para montar a base do teste
alter table tin_versoes disable trigger user; alter table tin_itens disable trigger user; alter table tin_ordens disable trigger user;
insert into tin_versoes(id, empresa_id, receita_id, numero, situacao, base_kg) values ('5f000000-0000-0000-0000-0000000000b2', 'e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-0000000000b1', 1, 'aprovada', 100);
insert into tin_itens(empresa_id, versao_id, produto_id, quantidade, funcao) values ('e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-0000000000b2', '5f000000-0000-0000-0000-0000000000f2', 80, 'base');
-- OP antiga concluída: 2.000 kg impressos com 20 kg líquidos de azul = 10 g/kg
insert into prod_ordens(id, empresa_id, numero, quantidade, produto_id, status) values ('5f000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', 99301, 2000, '5f000000-0000-0000-0000-0000000000f1', 'concluida');
insert into prod_ordem_etapas(empresa_id, ordem_id, seq, setor_id, qtd_boa, status) values ('e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-0000000000c1', 1, '5f000000-0000-0000-0000-000000000001', 2000, 'concluida');
insert into tin_ordens(empresa_id, numero, versao_id, cor_id, quantidade, ordem_id, situacao, entregue_kg, retorno_kg, lote_codigo, validade) values
  ('e000000a-0000-0000-0000-000000000000', 99301, '5f000000-0000-0000-0000-0000000000b2', '5f000000-0000-0000-0000-0000000000a1', 25, '5f000000-0000-0000-0000-0000000000c1', 'encerrada', 25, 5, 'TI-99301', current_date + 20);
alter table tin_versoes enable trigger user; alter table tin_itens enable trigger user; alter table tin_ordens enable trigger user;
-- OP aberta: 1.000 kg a imprimir em 3 dias; ficha com azul (sem consumo: usa a média real) e vermelho (8 g/kg)
insert into prod_ordens(id, empresa_id, numero, quantidade, produto_id, status) values ('5f000000-0000-0000-0000-0000000000c2', 'e000000a-0000-0000-0000-000000000000', 99302, 1000, '5f000000-0000-0000-0000-0000000000f1', 'liberada');
insert into prod_ordem_etapas(empresa_id, ordem_id, seq, setor_id, qtd_prevista, inicio_previsto) values ('e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-0000000000c2', 1, '5f000000-0000-0000-0000-000000000001', 1000, current_date + 3);
insert into tin_produto_cores(empresa_id, produto_id, cor_id, consumo_g_kg) values
  ('e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-0000000000f1', '5f000000-0000-0000-0000-0000000000a1', null),
  ('e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-0000000000f1', '5f000000-0000-0000-0000-0000000000a2', 8);
insert into tin_previsao_config(empresa_id, setor_impressao_id) values ('e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-000000000001');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select g_kg = 10 from public.tin_consumo_real('e000000a-0000-0000-0000-000000000000') where cor_id = '5f000000-0000-0000-0000-0000000000a1'), 'média real 10 g/kg');
create temp table r as select public.tin_previsao('e000000a-0000-0000-0000-000000000000') j;
create temp table az as select x from r, jsonb_array_elements(j->'cores') x where x->>'codigo' = 'AZ-T';
select pg_temp.ok((select (x->>'necessidade')::numeric = 10 and (x->>'sobra')::numeric = 5 and (x->>'preparar')::numeric = 5 from az), 'azul: 10 kg, sobra 5, preparar 5');
select pg_temp.ok((select (x->>'necessidade')::numeric = 8 from r, jsonb_array_elements(j->'cores') x where x->>'codigo' = 'VM-T'), 'vermelho pela ficha: 8 kg');
select pg_temp.ok((select (x->>'necessidade')::numeric = 4 from r, jsonb_array_elements(j->'insumos') x where x->>'codigo' = 'TN-BASE-T'), 'insumo: 5 kg × 80/100');
select pg_temp.falha($$update tin_previsao_config set horizonte_dias = 0$$, 'horizonte fora da faixa');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$insert into tin_produto_cores(empresa_id, produto_id, cor_id) values ('e000000a-0000-0000-0000-000000000000', '5f000000-0000-0000-0000-0000000000f2', '5f000000-0000-0000-0000-0000000000a1')$$, 'leitura não cadastra');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.tin_previsao('e000000a-0000-0000-0000-000000000000')$$, 'outra empresa');
reset role;
alter table tin_versoes disable trigger user; alter table tin_itens disable trigger user; alter table tin_ordens disable trigger user;
delete from tin_previsao_config; delete from tin_produto_cores where produto_id = '5f000000-0000-0000-0000-0000000000f1'; delete from tin_ordens where numero = 99301;
delete from prod_ordens where numero in (99301, 99302); delete from tin_itens where versao_id = '5f000000-0000-0000-0000-0000000000b2'; delete from tin_versoes where receita_id = '5f000000-0000-0000-0000-0000000000b1';
alter table tin_versoes enable trigger user; alter table tin_itens enable trigger user; alter table tin_ordens enable trigger user;
delete from tin_receitas where codigo = 'R-AZ-T'; delete from tin_cores where codigo in ('AZ-T', 'VM-T'); delete from produtos where codigo in ('PA-T', 'TN-BASE-T'); delete from prod_setores where nome = 'Impressão Tinta';
\o
select 'ok 53 previsão de tinta';

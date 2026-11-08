-- Custo real da OP (SQL 114): material, máquina, manutenção rateada, orçado pela estrutura e preço de venda.
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
-- base: setor 50 R$/h, máquina sem custo próprio, OP de 1.000 kg do produto PA-C com estrutura 1,02 kg de resina por kg
insert into prod_setores(id, empresa_id, nome, custo_hora) values ('5c000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Extrusão Custo', 50);
insert into prod_maquinas(id, empresa_id, setor_id, codigo, nome) values ('5c000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', '5c000000-0000-0000-0000-000000000001', 'EXT-C', 'Extrusora Custo');
insert into produtos(id, empresa_id, codigo, descricao, unidade) values
  ('5c000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'PA-C', 'SACO CUSTO', 'KG'),
  ('5c000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'MP-C', 'RESINA CUSTO', 'KG');
insert into est_custos(produto_id, empresa_id, quantidade, valor, custo_medio) values ('5c000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 1000, 8000, 8);
insert into produto_estrutura(empresa_id, produto_id, componente_id, quantidade, base, perda_pct) values ('e000000a-0000-0000-0000-000000000000', '5c000000-0000-0000-0000-0000000000f1', '5c000000-0000-0000-0000-0000000000f2', 1, 1, 2);
insert into prod_ordens(id, empresa_id, numero, quantidade, produto_id, codigo_produto, status, concluida_em) values ('5c000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', 99002, 1000, '5c000000-0000-0000-0000-0000000000f1', 'PA-C', 'concluida', '2026-10-20 18:00-03');
insert into prod_ordem_etapas(empresa_id, ordem_id, seq, setor_id, maquina_id, horas_previstas) values ('e000000a-0000-0000-0000-000000000000', '5c000000-0000-0000-0000-0000000000c1', 1, '5c000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000a1', 8);
insert into prod_apontamentos(empresa_id, ordem_id, maquina_id, setor_id, inicio, fim, qtd_boa, refugo) values
  ('e000000a-0000-0000-0000-000000000000', '5c000000-0000-0000-0000-0000000000c1', '5c000000-0000-0000-0000-0000000000a1', '5c000000-0000-0000-0000-000000000001', '2026-10-20 08:00-03', '2026-10-20 18:00-03', 980, 50);
-- outra OP na mesma máquina no mês: 10 h (a manutenção do mês se divide meio a meio)
insert into prod_ordens(id, empresa_id, numero, quantidade, status) values ('5c000000-0000-0000-0000-0000000000c2', 'e000000a-0000-0000-0000-000000000000', 99003, 500, 'em_producao');
insert into prod_apontamentos(empresa_id, ordem_id, maquina_id, inicio, fim, qtd_boa) values ('e000000a-0000-0000-0000-000000000000', '5c000000-0000-0000-0000-0000000000c2', '5c000000-0000-0000-0000-0000000000a1', '2026-10-21 08:00-03', '2026-10-21 18:00-03', 500);
insert into prod_consumos(empresa_id, ordem_id, produto_id, quantidade) values ('e000000a-0000-0000-0000-000000000000', '5c000000-0000-0000-0000-0000000000c1', '5c000000-0000-0000-0000-0000000000f2', 1040);
insert into man_equipamentos(id, empresa_id, codigo, nome, maquina_id) values ('5c000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'EQ-C', 'Extrusora Custo', '5c000000-0000-0000-0000-0000000000a1');
insert into man_ordens(empresa_id, numero, equipamento_id, descricao, situacao, inicio, fim, valor_terceiros, solucao) values
  ('e000000a-0000-0000-0000-000000000000', 99002, '5c000000-0000-0000-0000-0000000000d1', 'Revisão', 'concluida', '2026-10-10 08:00-03', '2026-10-10 12:00-03', 1000, 'ok');
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values ('5c000000-0000-0000-0000-0000000000e1', 'e000000a-0000-0000-0000-000000000000', 'CUSTO1', 99002, '2026-10-01', 'saida', true, 'autorizada');
insert into nfe_itens(empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod) values ('e000000a-0000-0000-0000-000000000000', '5c000000-0000-0000-0000-0000000000e1', 1, 'PA-C', '5101', 2000, 30000);
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
create temp table r as select public.prod_custo_op('5c000000-0000-0000-0000-0000000000c1') j;
select pg_temp.ok((select (j->'material'->0->>'valor')::numeric = 8320 and j->'material'->0->>'fonte' = 'custo médio' from r), 'material 1.040 kg × 8');
select pg_temp.ok((select (j->'maquina'->0->>'valor')::numeric = 500 and (j->'maquina'->0->>'custo_hora')::numeric = 50 from r), 'máquina 10 h × 50 (custo do setor)');
select pg_temp.ok((select (j->'manutencao'->0->>'valor')::numeric = 500 from r), 'manutenção rateada pela metade');
select pg_temp.ok((select (j->'orcado'->'material'->0->>'valor')::numeric = 8160 and (j->'orcado'->'maquina'->0->>'valor')::numeric = 400 from r), 'orçado: 1.020 kg × 8 e 8 h × 50');
select pg_temp.ok((select (j->'venda'->>'preco')::numeric = 15 and (j->'producao'->>'bom')::numeric = 980 from r), 'preço médio de venda e quantidade boa');
insert into prod_custo_config(empresa_id, custo_hora_padrao, ratear_manutencao) values ('e000000a-0000-0000-0000-000000000000', 30, false);
select pg_temp.ok((select jsonb_array_length(public.prod_custo_op('5c000000-0000-0000-0000-0000000000c1')->'manutencao')) = 0, 'sem rateio da manutenção');
select pg_temp.ok((select count(*) from public.prod_custo_ops('e000000a-0000-0000-0000-000000000000', '2026-10-01', current_date) as x(j) where j->'ordem'->>'numero' = '99002') = 1, 'lista do período');
select pg_temp.falha($$update prod_custo_config set dias_preco = 1$$, 'janela fora da faixa');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.prod_custo_op('5c000000-0000-0000-0000-0000000000c1')$$, 'outra empresa');
reset role;
delete from prod_custo_config; delete from nfe_notas where chave = 'CUSTO1'; delete from man_ordens where numero = 99002; delete from man_equipamentos where codigo = 'EQ-C';
delete from prod_ordens where numero in (99002, 99003); delete from produto_estrutura where produto_id = '5c000000-0000-0000-0000-0000000000f1';
delete from est_custos where produto_id = '5c000000-0000-0000-0000-0000000000f2'; delete from produtos where codigo in ('PA-C', 'MP-C');
delete from prod_maquinas where codigo = 'EXT-C'; delete from prod_setores where nome = 'Extrusão Custo';
\o
select 'ok 50 custo da OP';

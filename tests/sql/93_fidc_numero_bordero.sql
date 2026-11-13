-- FIDC: a aprovação da proposta feita na plataforma usa o número do borderô do fundo (espelho/comparativo); sem ele, P<nº>;
-- número já usado por outra operação do fundo → P<nº> (SQL 157). Dados FICTÍCIOS.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
insert into contas(id, empresa_id, nome) values ('c930000a-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'FUNDO NUMERO EXEMPLO');
insert into fidc_fundos(id, empresa_id, nome, conta_id) values ('fd930000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Fundo Numero', 'c930000a-0000-0000-0000-000000000001');
insert into plano_contas(id, empresa_id, codigo, nome, tipo, natureza, nivel)
select 'f0000a01-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', '1.01.01', 'VENDAS', 'E', 'C', 2
 where not exists (select 1 from plano_contas where id = 'f0000a01-0000-0000-0000-000000000000');
insert into lancamentos(id, empresa_id, data, plano_id, descricao, documento, status, valor)
select ('a9300000-0000-0000-0000-00000000000' || k)::uuid, 'e000000a-0000-0000-0000-000000000000', '2026-11-03', 'f0000a01-0000-0000-0000-000000000000', 'Título exemplo ' || k, '9300' || k || '-1', 'Em aberto', 100 * k from generate_series(1, 3) k;
insert into fidc_propostas(id, empresa_id, numero, fundo_id, data_operacao, status, qtd_titulos, valor_face, liquido, analise, comparativo) values
  ('b9300000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 9301, 'fd930000-0000-0000-0000-000000000001', '2026-11-03', 'Pendente', 1, 100, 0, '{"espelho":{"bordero":"000008/000002"}}', null),
  ('b9300000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 9302, 'fd930000-0000-0000-0000-000000000001', '2026-11-03', 'Pendente', 1, 200, 0, null, null),
  ('b9300000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', 9303, 'fd930000-0000-0000-0000-000000000001', '2026-11-03', 'Pendente', 1, 300, 0, null, '{"bordero":"000008/000002"}');
insert into fidc_proposta_itens(proposta_id, empresa_id, lancamento_id, documento, sacado, vencimento, valor)
select ('b9300000-0000-0000-0000-00000000000' || k)::uuid, 'e000000a-0000-0000-0000-000000000000', ('a9300000-0000-0000-0000-00000000000' || k)::uuid, '9300' || k || '-1', 'CLIENTE EXEMPLO', '2026-12-03', 100 * k from generate_series(1, 3) k;
select _aprovar_proposta_fidc(('b9300000-0000-0000-0000-00000000000' || k)::uuid, null, 'a0000000-0000-0000-0000-00000000000a') from generate_series(1, 3) k;
select pg_temp.ok((select o.bordero = '000008/000002' and t.bordero = '000008/000002' from fidc_propostas p join fidc_operacoes o on o.id = p.operacao_id join fidc_titulos t on t.operacao_id = o.id where p.numero = 9301), 'espelho do borderô dá o número da operação e dos títulos');
select pg_temp.ok((select o.bordero = 'P9302' from fidc_propostas p join fidc_operacoes o on o.id = p.operacao_id where p.numero = 9302), 'sem borderô do fundo: P<nº>');
select pg_temp.ok((select o.bordero = 'P9303' from fidc_propostas p join fidc_operacoes o on o.id = p.operacao_id where p.numero = 9303), 'número já usado no fundo: P<nº> (não duplica)');
\o
select 'ok 93_fidc_numero_bordero' as resultado;

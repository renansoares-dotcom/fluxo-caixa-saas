-- Notas de débito (SQL 074): juros em 1.02.17 ligados ao título geram a pendência; mora do fundo gera "a decidir"; leitura não altera; outra empresa não vê.
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
insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values ('f0000a17-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', '1.02.17', 'JUROS E MULTAS RECEBIDOS', 'C', 2, 'E'),
  ('f0000a01-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', '1.01.01', 'VENDAS', 'C', 2, 'E');
insert into favorecidos(id, empresa_id, nome, documento) values ('fa00000a-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE TESTE', '11222333000181');
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values ('ab000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '26260000000000000000000000000000000000009001', 9001, '2026-09-16', 'saida', true, 'autorizada');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into lancamentos(id, empresa_id, data, plano_id, valor, status, documento, favorecido_id, conta_id) values
  ('ac000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '2026-10-29', 'f0000a01-0000-0000-0000-000000000000', 1000, 'Pago', '9001-2', 'fa00000a-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000');
insert into lancamentos(empresa_id, data, plano_id, valor, status, documento, juros_de, conta_id) values
  ('e000000a-0000-0000-0000-000000000000', '2026-10-29', 'f0000a17-0000-0000-0000-000000000000', 24.17, 'Pago', '9001-2', 'ac000000-0000-0000-0000-000000000001', 'c000000a-0000-0000-0000-000000000000');
select pg_temp.ok((select count(*) from fiscal_notas_debito) = 1, 'juros recebidos geram a pendência');
select pg_temp.ok((select status = 'pendente' and valor = 24.17 and nf_numero = 9001 and parcela = 2 and nota_id = 'ab000000-0000-0000-0000-000000000001' and cliente_nome = 'CLIENTE TESTE' from fiscal_notas_debito), 'pendência com a nota de origem e o cliente');
-- juros em aberto não geram; ao pagar, geram
insert into lancamentos(id, empresa_id, data, plano_id, valor, status, documento) values ('ac000000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', '2026-10-30', 'f0000a17-0000-0000-0000-000000000000', 5, 'Em aberto', '9001-3');
select pg_temp.ok((select count(*) from fiscal_notas_debito) = 1, 'juros em aberto ainda não geram');
update lancamentos set status = 'Pago', conta_id = 'c000000a-0000-0000-0000-000000000000' where id = 'ac000000-0000-0000-0000-000000000002';
select pg_temp.ok((select count(*) from fiscal_notas_debito) = 2, 'juros pagos geram');
update lancamentos set valor = 6 where id = 'ac000000-0000-0000-0000-000000000002';
select pg_temp.ok((select valor from fiscal_notas_debito where lancamento_id = 'ac000000-0000-0000-0000-000000000002') = 6, 'valor corrigido antes de emitir acompanha');
update fiscal_notas_debito set status = 'emitida', nd_numero = '77' where valor = 6;
insert into lancamentos(id, empresa_id, data, plano_id, valor, status, documento, conta_id) values ('ac000000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', '2026-10-30', 'f0000a17-0000-0000-0000-000000000000', 9, 'Pago', '9001-4', 'c000000a-0000-0000-0000-000000000000');
delete from lancamentos where id = 'ac000000-0000-0000-0000-000000000003';
select pg_temp.ok((select count(*) from fiscal_notas_debito) = 2, 'juros excluído antes de emitir: pendência sai');
-- mora no relatório do fundo → a decidir
insert into fidc_liquidacoes(empresa_id, fundo, titulo, bordero, quitacao, valor_face, mora, valor_pago, tipo) values ('e000000a-0000-0000-0000-000000000000', 'Contato', '9001-1', '', '2026-10-05', 3111, 103.70, 3214.70, 'normal');
insert into fidc_liquidacoes(empresa_id, fundo, titulo, bordero, quitacao, valor_face, mora, valor_pago, tipo) values ('e000000a-0000-0000-0000-000000000000', 'Contato', 'NC1', 'pgto 21/10/2026', '2026-10-21', 30000, 487.23, 5000, 'recompra');
select pg_temp.ok((select count(*) from fiscal_notas_debito where origem = 'fidc' and status = 'a_decidir' and valor = 103.70) = 1, 'mora do fundo vira "a decidir"; recompra não');
reset role;
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from fiscal_notas_debito) = 3, 'leitura vê');
update fiscal_notas_debito set status = 'dispensada';
reset role;
select pg_temp.ok((select count(*) from fiscal_notas_debito where status = 'dispensada') = 0, 'leitura não altera');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from fiscal_notas_debito) = 0, 'B não vê as notas de débito da A');
reset role;
\o
select 'ok 12_notas_debito' as resultado;

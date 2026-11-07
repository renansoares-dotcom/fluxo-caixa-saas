-- Auditoria por registro e alertas de ações sensíveis (SQL 098).
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'admin.a@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;

-- o financeiro (d…) faz as ações; admin e diretor recebem os alertas
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into favorecidos(id, empresa_id, nome, tipo, dados_bancarios) values ('fa340000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'FORNECEDOR AUDITADO', 'FORNECEDORES', 'Banco 1 ag 1 cc 1');
update favorecidos set dados_bancarios = 'Banco 9 ag 9 cc 999' where id = 'fa340000-0000-0000-0000-000000000001';
update favorecidos set observacao = 'só observação' where id = 'fa340000-0000-0000-0000-000000000001';
insert into lancamentos(id, empresa_id, data, plano_id, conta_id, valor, descricao, status) values
  ('ab340000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '2026-10-10', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 500, 'PAGAMENTO AUDITADO', 'Pago'),
  ('ab340000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', '2026-10-10', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 70, 'TITULO EM ABERTO', 'Em aberto');
update lancamentos set valor = 550 where id = 'ab340000-0000-0000-0000-000000000001';
update lancamentos set valor = 80 where id = 'ab340000-0000-0000-0000-000000000002';
delete from lancamentos where id = 'ab340000-0000-0000-0000-000000000002';
reset role;

select pg_temp.ok((select count(*) from audit_alertas where regra = 'banco_beneficiario' and detalhe = 'FORNECEDOR AUDITADO: dados bancários') = 1, 'dados bancários alterados geram alerta (a observação não)');
select pg_temp.ok((select count(*) from audit_alertas where regra = 'valor_pago' and detalhe like 'PAGAMENTO AUDITADO%') = 1, 'valor de lançamento pago alterado');
select pg_temp.ok((select count(*) from audit_alertas where regra = 'valor_pago' and detalhe like 'TITULO%') = 0, 'valor de título em aberto não alerta');
select pg_temp.ok((select count(*) from audit_alertas where regra = 'exclusao' and titulo = 'Exclusão de lançamento' and detalhe like 'TITULO EM ABERTO%') = 1, 'exclusão de lançamento');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'auditoria' and user_id = 'a0000000-0000-0000-0000-00000000000a' and corpo ~ '(FORNECEDOR|PAGAMENTO) AUDITADO|TITULO EM ABERTO') = 3, 'administrador avisado');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'auditoria' and user_id = 'd0000000-0000-0000-0000-00000000000d' and corpo ~ 'AUDITADO|TITULO EM ABERTO') = 0, 'quem fez não é avisado');

-- regra desligada e sistema
insert into audit_alertas_config(empresa_id, regras) values ('e000000a-0000-0000-0000-000000000000', '{"exclusao": false, "banco_beneficiario": true}');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
delete from lancamentos where id = 'ab340000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select count(*) from audit_alertas where regra = 'exclusao' and detalhe like 'PAGAMENTO AUDITADO%') = 0, 'exclusão desligada não alerta');
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);
update favorecidos set dados_bancarios = 'rotina' where id = 'fa340000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from audit_alertas where regra = 'banco_beneficiario' and detalhe like 'FORNECEDOR AUDITADO%') = 1, 'rotina sem usuário não alerta');

-- busca por registro, versões e visto
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select eventos >= 4 and tabela = 'favorecidos' from auditoria_registros('e000000a-0000-0000-0000-000000000000', null, 'FORNECEDOR AUDITADO')), 'acha o registro pelo nome gravado');
select pg_temp.ok((select excluido from auditoria_registros('e000000a-0000-0000-0000-000000000000', 'lancamentos', 'PAGAMENTO AUDITADO')), 'mostra que foi excluído');
select pg_temp.ok(audit_alertas_visto(array(select id from audit_alertas where detalhe ~ '(FORNECEDOR|PAGAMENTO) AUDITADO|TITULO EM ABERTO')) = 3, 'marca como visto');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from auditoria_registros('e000000a-0000-0000-0000-000000000000', null, 'FORNECEDOR')) = 0, 'financeiro não vê a auditoria');
select pg_temp.ok((select count(*) from audit_alertas) = 0, 'financeiro não vê os alertas');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from auditoria_registros('e000000a-0000-0000-0000-000000000000', null, 'FORNECEDOR')) = 0, 'outra empresa não vê');
reset role;
\o
select 'auditoria alertas ok';

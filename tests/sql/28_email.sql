-- E-mail (SQL 092): convite do Portal, arte enviada ao cliente, resposta da prorrogação, aviso com e-mail marcado,
-- modelo desligado, teste só do admin e a fila visível só para o admin.
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
grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.ok((select count(*) from email_padrao()) = 5, 'cinco textos padrão');
-- convite do Portal
insert into portal_convites(empresa_id, favorecido_id, email) values ('e000000a-0000-0000-0000-000000000000', 'ef100000-0000-0000-0000-000000000001', 'Comprador@Cliente.Exemplo');
select pg_temp.ok((select count(*) from email_fila where codigo = 'portal_convite' and para = 'comprador@cliente.exemplo' and campos ->> 'caminho' like 'portal.html?convite=%' and campos ->> 'empresa' = 'Empresa A') = 1, 'convite vai para o e-mail do cliente');
-- resposta da prorrogação (pedido do teste 26)
update portal_prorrogacoes set status = 'aprovada', resposta = 'ok', decidido_em = now() where lancamento_id = 'ab100000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from email_fila where codigo = 'prorrogacao_resposta' and para = 'cliente.aviso@exemplo.com' and campos ->> 'decisao' = 'APROVADA') = 1, 'resposta da prorrogação para quem pediu');
-- arte enviada ao cliente: vai para os usuários ativos do Portal daquele cliente (empresa B, teste 25)
select pg_temp.ok((select count(*) from email_fila where codigo = 'arte_aprovacao' and para = 'compras@cliente-um.exemplo') >= 1, 'arte enviada avisa o usuário do Portal');
select pg_temp.ok((select count(*) from email_fila where codigo = 'arte_aprovacao' and para = 'compras@cliente-dois.exemplo' and campos ->> 'numero' = '1') = 0, 'não avisa o usuário de outro cliente');
-- aviso interno só com e-mail marcado
insert into notif_preferencias(user_id, empresa_id, tipo, push, email) values ('a0000000-0000-0000-0000-00000000000a', 'e000000a-0000-0000-0000-000000000000', 'os_urgente', true, true);
select set_config('request.jwt.claim.sub', 'd0000000-0000-0000-0000-00000000000d', false);
insert into man_ordens(empresa_id, numero, equipamento_id, prioridade, descricao) values ('e000000a-0000-0000-0000-000000000000', 0, 'ec000000-0000-0000-0000-000000000001', 'emergencia', 'Motor queimado');
select pg_temp.ok((select count(*) from email_fila where codigo = 'aviso' and para = 'admin.a@exemplo.com' and (campos ->> 'urgente')::boolean) = 1, 'aviso com e-mail marcado vai por e-mail');
select pg_temp.ok((select count(*) from email_fila where codigo = 'aviso' and para <> 'admin.a@exemplo.com') = 0, 'quem não marcou não recebe e-mail');
-- modelo desligado não entra na fila
insert into email_modelos(empresa_id, codigo, assunto, corpo, ativo) values ('e000000a-0000-0000-0000-000000000000', 'portal_convite', 'x', 'y', false);
insert into portal_convites(empresa_id, favorecido_id, email) values ('e000000a-0000-0000-0000-000000000000', 'ef100000-0000-0000-0000-000000000001', 'outro@cliente.exemplo');
select pg_temp.ok((select count(*) from email_fila where para = 'outro@cliente.exemplo') = 0, 'modelo desligado: não manda');
-- teste e leitura da fila
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok(email_teste('e000000a-0000-0000-0000-000000000000') is not null, 'admin manda o teste');
select pg_temp.ok((select count(*) from email_fila where codigo = 'teste' and para = 'admin.a@exemplo.com') = 1, 'teste para o próprio e-mail');
select pg_temp.ok((select count(*) from email_fila where empresa_id = 'e000000b-0000-0000-0000-000000000000') = 0, 'não vê a fila de outra empresa');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($q$select email_teste('e000000a-0000-0000-0000-000000000000')$q$, 'financeiro não manda teste');
select pg_temp.ok((select count(*) from email_fila) = 0, 'financeiro não lê a fila');
select pg_temp.falha($q$update email_config set ativo = true where empresa_id = 'e000000a-0000-0000-0000-000000000000'; insert into email_config(empresa_id, ativo) values ('e000000a-0000-0000-0000-000000000000', true)$q$, 'financeiro não liga o envio');
reset role;
\o
select 'email ok';

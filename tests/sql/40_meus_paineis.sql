-- Meus Painéis (SQL 104): cada um vê os seus e os compartilhados; só o dono altera.
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

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into paineis(empresa_id, nome, cartoes) values (:E, 'Meu', '[{"t":"kpi_saldo","tam":1}]');
insert into paineis(empresa_id, nome, cartoes, compartilhado) values (:E, 'Modelo do fechamento', '[]', true);
select pg_temp.falha($$insert into paineis(empresa_id, dono, nome) values ('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d', 'X')$$, 'não cria painel em nome de outro');
select pg_temp.falha($$insert into paineis(empresa_id, nome, cartoes) values ('e000000a-0000-0000-0000-000000000000', 'X', '{}')$$, 'cartões precisam ser uma lista');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from paineis) = 1 and (select nome from paineis) = 'Modelo do fechamento', 'vê só o compartilhado');
update paineis set nome = 'mexi' where compartilhado;
select pg_temp.ok((select nome from paineis) = 'Modelo do fechamento', 'não altera o painel de outro');
insert into paineis(empresa_id, nome, cartoes) select empresa_id, nome || ' (cópia)', cartoes from paineis where compartilhado;
select pg_temp.ok((select count(*) from paineis) = 2, 'copia o modelo para si');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from paineis) = 0, 'outra empresa não vê');
reset role;
delete from paineis;

-- Alíquotas da reforma (SQL 072): admin grava; financeiro e leitura só leem; outra empresa não vê.
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
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into trib_aliquotas(empresa_id, ano, cbs, ibs_uf, ibs_mun, situacao, fonte) values ('e000000a-0000-0000-0000-000000000000', 2027, 11.2468, 0.05, 0.05, 'vigente', 'Resolução do Senado (teste)');
update trib_aliquotas set cbs = 11.3 where ano = 2027;
select pg_temp.ok((select cbs from trib_aliquotas where ano = 2027) = 11.3, 'admin ajusta a alíquota');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from trib_aliquotas) = 1, 'financeiro lê');
do $$ begin
  begin insert into trib_aliquotas(empresa_id, ano, fonte) values ('e000000a-0000-0000-0000-000000000000', 2028, 'x'); raise exception 'FALHOU: financeiro gravou';
  exception when insufficient_privilege then null; end;
end $$;
update trib_aliquotas set cbs = 0;
reset role;
select pg_temp.ok((select cbs from trib_aliquotas where ano = 2027) = 11.3, 'financeiro não altera');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from trib_aliquotas) = 1, 'leitura lê');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from trib_aliquotas) = 0, 'B não vê as alíquotas da A');
reset role;
\o
select 'ok 10_trib_aliquotas' as resultado;

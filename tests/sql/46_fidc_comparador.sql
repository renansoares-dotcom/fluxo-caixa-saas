-- Comparador de fundos (SQL 110): parâmetros por empresa; financeiro grava, leitura só lê.
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
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into fidc_comparador_config(empresa_id, cdi_aa, cdi_data) values ('e000000a-0000-0000-0000-000000000000', 13.65, '2026-11-08');
select pg_temp.falha($$update fidc_comparador_config set periodo_meses = 99$$, 'período fora da faixa');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
update fidc_comparador_config set cdi_aa = 1;
select pg_temp.ok((select cdi_aa from fidc_comparador_config) = 13.65, 'leitura não altera');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from fidc_comparador_config) = 0, 'outra empresa não vê');
reset role;
delete from fidc_comparador_config;
\o
select 'ok 46 comparador de fundos';

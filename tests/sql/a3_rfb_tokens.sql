\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'u@t.com')::text, false);
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
-- Receita Federal — token temporário (SQL 170): só a função (service_role) lê e grava; nenhum usuário enxerga
insert into rfb_tokens (credencial, token, expira_em) values ('abc', 'tok-de-teste', now() + interval '1 hour');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.rfb_tokens'::regclass), 'RLS ligada em rfb_tokens');
select pg_temp.ok((select count(*) = 0 from pg_policies where schemaname = 'public' and tablename = 'rfb_tokens'), 'rfb_tokens não tem política (ninguém além da função)');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.rfb_tokens', 'select') and not has_table_privilege('anon', 'public.rfb_tokens', 'select'), 'usuário e visitante sem permissão de leitura');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.rfb_tokens', 'insert') and not has_table_privilege('authenticated', 'public.rfb_tokens', 'update') and not has_table_privilege('authenticated', 'public.rfb_tokens', 'delete'), 'usuário sem permissão de gravação');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha('select token from public.rfb_tokens', 'administrador não lê o token');
select pg_temp.falha($$insert into public.rfb_tokens (credencial, token, expira_em) values ('x', 'y', now())$$, 'administrador não grava token');
reset role;
-- a função renova por cima (mesma credencial)
insert into rfb_tokens (credencial, token, expira_em) values ('abc', 'tok-novo', now() + interval '2 hour') on conflict (credencial) do update set token = excluded.token, expira_em = excluded.expira_em, obtido_em = now();
select pg_temp.ok((select token = 'tok-novo' from rfb_tokens where credencial = 'abc'), 'renovação substitui o token');
delete from rfb_tokens where credencial = 'abc';

-- Perfis por tela e login (SQL 148): perfil por membro (só papéis de menu completo), telas de quem está logado, cópia de permissões e formas de entrar.
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
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into acesso_perfis(id, empresa_id, nome, telas) values ('84000000-0000-0000-0000-0000000000a1', :E, 'Contas a pagar', array['lancamentos', 'autorizacao', 'hoje']);
update membros set perfil_id = '84000000-0000-0000-0000-0000000000a1' where empresa_id = :E and user_id = 'd0000000-0000-0000-0000-00000000000d';
update membros set perfil_id = '84000000-0000-0000-0000-0000000000a1' where empresa_id = :E and user_id = 'f0000000-0000-0000-0000-00000000000f';   -- compras: ignorado
select pg_temp.ok((select perfil_id is null from membros where empresa_id = :E and user_id = 'f0000000-0000-0000-0000-00000000000f'), 'perfil não vale para compras');
select pg_temp.ok((select count(*) from public.membros_perfis(:E) where perfil_id is not null) = 1, 'membros_perfis');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((public.minhas_telas(:E) ->> 'perfil') = 'Contas a pagar' and jsonb_array_length(public.minhas_telas(:E) -> 'telas') = 3, 'minhas telas');
select pg_temp.ok((select count(*) from acesso_perfis) = 1, 'vê o próprio perfil');
select pg_temp.ok((select count(*) from public.membros_perfis(:E)) = 0, 'não vê o perfil dos outros');
update acesso_perfis set telas = array['dashboard'] where id = '84000000-0000-0000-0000-0000000000a1';
select pg_temp.ok((select telas = array['lancamentos', 'autorizacao', 'hoje'] from acesso_perfis where id = '84000000-0000-0000-0000-0000000000a1'), 'financeiro não muda perfil');
select pg_temp.falha($$select public.copiar_permissoes('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-00000000000c')$$, 'só admin copia');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok(public.minhas_telas(:E) is null, 'sem perfil = sem restrição');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select public.copiar_permissoes(:E, 'd0000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-00000000000c', true);
select pg_temp.ok((select papel::text = 'financeiro' and perfil_id = '84000000-0000-0000-0000-0000000000a1' from membros where empresa_id = :E and user_id = 'c0000000-0000-0000-0000-00000000000c'), 'cópia com papel');
select pg_temp.falha($$select public.copiar_permissoes('e000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c')$$, 'não copia admin');
select pg_temp.falha($$select public.copiar_permissoes('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000a')$$, 'não muda a si');
update membros set papel = 'leitura', perfil_id = null where empresa_id = :E and user_id = 'c0000000-0000-0000-0000-00000000000c';
update membros set perfil_id = null where empresa_id = :E and user_id = 'd0000000-0000-0000-0000-00000000000d';
-- formas de entrar: lidas sem login; muda quem é admin
update plataforma_login set google = true where id = 1;
select pg_temp.ok((select google from plataforma_login), 'admin liga o Google');
reset role; set role anon;
select pg_temp.ok((select senha and google from plataforma_login), 'tela de login lê sem login');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
update plataforma_login set microsoft = true where id = 1;
reset role;
select pg_temp.ok((select not microsoft from plataforma_login), 'financeiro não muda');
update plataforma_login set google = false where id = 1;
\o
select 'ok 84 perfis por tela e login';

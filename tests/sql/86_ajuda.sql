-- Ajuda na tela (SQL 150): vídeos por tela (admin cadastra, todos leem), tour pendente/visto por versão e acesso.
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
insert into ajuda_videos(empresa_id, rota, titulo, url) values (:E, 'lancamentos', 'Lançar uma conta', 'https://youtu.be/abcdefghijk');
select pg_temp.falha($$insert into ajuda_videos(empresa_id, rota, titulo, url) values ('e000000a-0000-0000-0000-000000000000', 'x', 'x', 'http://inseguro')$$, 'só https');
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');   -- compras (não é membro pleno, mas é da empresa)
select pg_temp.ok((select count(*) from ajuda_videos where empresa_id = :E) = 1, 'compras vê os vídeos');
select pg_temp.falha($$insert into ajuda_videos(empresa_id, rota, titulo, url) values ('e000000a-0000-0000-0000-000000000000', 'x', 'x', 'https://a')$$, 'só admin cadastra');
select pg_temp.ok(public.ajuda_tour_pendente(:E), 'tour pendente');
select public.ajuda_tour_visto(:E);
select pg_temp.ok(not public.ajuda_tour_pendente(:E), 'visto');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into ajuda_config(empresa_id, tour_versao) values (:E, 2);
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok(public.ajuda_tour_pendente(:E), 'versão nova mostra de novo');
select pg_temp.ok((select count(*) from ajuda_tour_vistos) = 1, 'só vê o próprio');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from ajuda_videos where empresa_id = :E) = 0 and not public.ajuda_tour_pendente(:E), 'outra empresa não vê');
reset role;
delete from ajuda_config where empresa_id = :E;
\o
select 'ok 86 ajuda na tela';

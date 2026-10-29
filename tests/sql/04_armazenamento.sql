-- Regras do armazenamento (anexos): quem participa sobe arquivo na conversa; quem não participa não sobe.
-- Pega o erro "permission denied for function" (função das regras sem permissão para quem está logado).
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
grant execute on all functions in schema pg_temp to authenticated;
insert into storage.buckets(id, name, public) values ('paraquedas', 'paraquedas', false) on conflict do nothing;
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select chat_abrir_direta('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d') as d \gset
insert into storage.objects(bucket_id, name) values ('chat', 'e000000a-0000-0000-0000-000000000000/' || :'d' || '/teste.webm');
insert into storage.objects(bucket_id, name) values ('paraquedas', 'e000000a-0000-0000-0000-000000000000/x/comprovante.pdf');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
do $$ begin
  begin insert into storage.objects(bucket_id, name) values ('chat', 'e000000a-0000-0000-0000-000000000000/' || current_setting('x.d', true) || '/intruso.webm');
    raise exception 'FALHOU: outra empresa subiu arquivo na conversa';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
\o
select 'armazenamento: ok' as resultado;

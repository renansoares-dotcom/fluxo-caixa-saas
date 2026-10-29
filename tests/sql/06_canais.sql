-- Canais privados das Conversas (SQL 064): quem entra em cada canal do tempo real.
\set ON_ERROR_STOP 1
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  set role authenticated;
end $$;
grant execute on function pg_temp.entrar(uuid) to authenticated;
\o /dev/null
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
\o
do $$ declare c uuid; begin
  c := chat_abrir_direta('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d');
  perform set_config('teste.conversa', c::text, false);
  if not _chat_canal_ok('chat-pres-e000000a-0000-0000-0000-000000000000', true) then raise exception 'membro da A sem presença'; end if;
  if not _chat_canal_ok('chat-e000000a-0000-0000-0000-000000000000', false) then raise exception 'membro da A sem avisos'; end if;
  if _chat_canal_ok('chat-e000000a-0000-0000-0000-000000000000', true) then raise exception 'canal de avisos aceitou envio'; end if;
  if not _chat_canal_ok('chat-dig-' || c, true) then raise exception 'participante sem digitando'; end if;
  if _chat_canal_ok('chat-pres-e000000b-0000-0000-0000-000000000000', false) then raise exception 'A entrou na presença da B'; end if;
  if _chat_canal_ok('qualquer-coisa', false) or _chat_canal_ok('chat-pres-xyz', false) then raise exception 'canal desconhecido aceito'; end if;
end $$;
reset role;
\o /dev/null
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
\o
do $$ begin
  if _chat_canal_ok('chat-dig-' || current_setting('teste.conversa'), false) then raise exception 'quem não participa viu o digitando'; end if;
  if not _chat_canal_ok('chat-pres-e000000a-0000-0000-0000-000000000000', false) then raise exception 'leitura da A sem presença'; end if;
end $$;
reset role;
\o /dev/null
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
\o
do $$ begin
  if _chat_canal_ok('chat-dig-' || current_setting('teste.conversa'), false) or _chat_canal_ok('chat-e000000a-0000-0000-0000-000000000000', false) then raise exception 'B entrou em canal da A'; end if;
end $$;
reset role;
\echo 'ok: 06_canais'

-- =====================================================================
-- Conversas — canais de tempo real privados (29/10/2026).
-- O "online" (presença) e o "digitando…" passavam por canais públicos do Realtime: quem soubesse o nome do canal
-- podia escutar. Agora a tela abre os canais como privados e o Realtime só deixa entrar quem estas regras aceitarem:
--  - chat-<empresa>       (avisos de mensagem nova): membro da empresa — as linhas continuam filtradas pelo RLS das tabelas
--  - chat-pres-<empresa>  (quem está online):         membro da empresa
--  - chat-dig-<conversa>  ("digitando…"):              participante da conversa
-- Depois de rodar, desligue em Supabase › Realtime › Settings a opção "Allow public access", para que só canais
-- privados funcionem. Pode rodar mais de uma vez.
-- =====================================================================
create or replace function public._chat_canal_ok(p_topico text, p_enviar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_topico like 'chat-pres-%' then is_membro(_uuid_ou_nulo(substr(p_topico, 11)))
    when p_topico like 'chat-dig-%'  then chat_participa(_uuid_ou_nulo(substr(p_topico, 10)))
    when p_topico ~ '^chat-[0-9a-f-]{36}$' then not p_enviar and is_membro(_uuid_ou_nulo(substr(p_topico, 6)))
    else false end;
$$;
revoke execute on function public._chat_canal_ok(text, boolean) from public, anon;
grant execute on function public._chat_canal_ok(text, boolean) to authenticated, service_role;

do $$ begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'sem o Realtime do Supabase (ambiente de teste): políticas não criadas'; return;
  end if;
  execute 'drop policy if exists chat_canal_ler on realtime.messages';
  execute 'drop policy if exists chat_canal_enviar on realtime.messages';
  execute $p$create policy chat_canal_ler on realtime.messages for select to authenticated
             using (public._chat_canal_ok((select realtime.topic()), false))$p$;
  execute $p$create policy chat_canal_enviar on realtime.messages for insert to authenticated
             with check (public._chat_canal_ok((select realtime.topic()), true))$p$;
end $$;

-- conferência: politicas = 2, funcao = 1
select (select count(*) from pg_policies where schemaname = 'realtime' and policyname like 'chat_canal_%') as politicas,
       (select count(*) from pg_proc where proname = '_chat_canal_ok') as funcao;

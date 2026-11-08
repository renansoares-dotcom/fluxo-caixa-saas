-- Lembrete da arte (SQL 131): primeiro lembrete depois de N dias, intervalo, limite, aviso à equipe, lembrete na hora e parâmetros.
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
insert into favorecidos(id, empresa_id, tipo, nome) values ('67000000-0000-0000-0000-0000000000f1', :E, 'CLIENTES', 'CLIENTE ARTE 67');
insert into auth.users(id, email) values ('67000000-0000-0000-0000-0000000000c1', 'arte67@exemplo.com');
insert into portal_usuarios(empresa_id, user_id, favorecido_id, email, whatsapp, whatsapp_optin_em) values (:E, '67000000-0000-0000-0000-0000000000c1', '67000000-0000-0000-0000-0000000000f1', 'arte67@exemplo.com', '5581999990067', now());
insert into pre_projetos(id, empresa_id, numero, favorecido_id, nome, situacao) values
  ('67000000-0000-0000-0000-0000000000a1', :E, 96701, '67000000-0000-0000-0000-0000000000f1', 'Embalagem 67', 'aguardando_cliente'),
  ('67000000-0000-0000-0000-0000000000a2', :E, 96702, '67000000-0000-0000-0000-0000000000f1', 'Rótulo 67', 'aguardando_cliente'),
  ('67000000-0000-0000-0000-0000000000a3', :E, 96703, '67000000-0000-0000-0000-0000000000f1', 'Recém enviada 67', 'aguardando_cliente');
insert into pre_versoes(empresa_id, projeto_id, numero, caminho, nome, hash, enviada_em) values
  (:E, '67000000-0000-0000-0000-0000000000a1', 1, 'x/a1.pdf', 'a1.pdf', repeat('a', 64), now() - interval '3 days'),
  (:E, '67000000-0000-0000-0000-0000000000a2', 1, 'x/a2.pdf', 'a2.pdf', repeat('b', 64), now() - interval '5 days'),
  (:E, '67000000-0000-0000-0000-0000000000a3', 1, 'x/a3.pdf', 'a3.pdf', repeat('c', 64), now() - interval '1 day');
alter table pre_projetos disable trigger user;
update pre_projetos set situacao = 'aguardando_cliente' where id::text like '67000000%';
alter table pre_projetos enable trigger user;
alter table pre_versoes disable trigger user;
update pre_versoes set enviada_em = case projeto_id when '67000000-0000-0000-0000-0000000000a1' then now() - interval '3 days' when '67000000-0000-0000-0000-0000000000a2' then now() - interval '5 days' else now() - interval '1 day' end
 where projeto_id::text like '67000000%';
alter table pre_versoes enable trigger user;

-- lembrete na hora (a2), depois o agendado
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.pre_lembrar_agora('67000000-0000-0000-0000-0000000000a2')$$, 'leitura não manda');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select public.pre_lembrar_agora('67000000-0000-0000-0000-0000000000a2') = 2), 'e-mail + WhatsApp na hora');
select pg_temp.falha($$select public.pre_lembrar_agora('67000000-0000-0000-0000-0000000000a2')$$, 'dois em 12 horas');
reset role;
-- dia 0: a1 (3 dias) manda; a2 já teve hoje (intervalo); a3 (1 dia) espera
select pg_temp.ok((select public._pre_lembretes(current_date) = 1), 'só a1 hoje');
select pg_temp.ok((select count(*) = 1 from pre_eventos where projeto_id = '67000000-0000-0000-0000-0000000000a1' and tipo = 'lembrete' and not publico), 'evento interno');
select pg_temp.ok((select public._pre_lembretes(current_date) = 0), 'não repete no mesmo dia');
select pg_temp.ok((select public._pre_lembretes(current_date + 2) = 3), '+2 dias: a1, a2 e a3');
select pg_temp.ok((select public._pre_lembretes(current_date + 4) = 3), '+4: a1 e a2 (3º, o limite) e a3');
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'arte_sem_resposta' and ref_id = '67000000-0000-0000-0000-0000000000a2'), 'equipe avisada (a2)');
select pg_temp.ok((select public._pre_lembretes(current_date + 6) = 1), '+6: só a3');
select pg_temp.ok((select count(*) = 3 from email_fila where codigo = 'arte_lembrete' and ref_id = '67000000-0000-0000-0000-0000000000a1'), 'três e-mails para a1');
select pg_temp.ok((select count(*) = 3 from wa_fila where codigo = 'arte_lembrete' and ref_id = '67000000-0000-0000-0000-0000000000a1'), 'três WhatsApp para a1');
-- nova versão enviada zera a contagem; desligado não manda
alter table pre_versoes disable trigger user;
insert into pre_versoes(empresa_id, projeto_id, numero, caminho, nome, hash, enviada_em) values (:E, '67000000-0000-0000-0000-0000000000a1', 2, 'x/a1v2.pdf', 'a1v2.pdf', repeat('d', 64), now());
alter table pre_versoes enable trigger user;
select pg_temp.ok((select public._pre_lembretes(current_date + 2) >= 1), 'nova versão volta a lembrar');
insert into pre_parametros(empresa_id, lembrete_ativo) values (:E, false) on conflict (empresa_id) do update set lembrete_ativo = false;
select pg_temp.ok((select public._pre_lembretes(current_date + 20) = 0), 'desligado');
select pg_temp.falha($$update pre_parametros set prova_de_ok = 4, prova_de_atencao = 3 where empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'faixas do ΔE');
update pre_parametros set lembrete_ativo = true where empresa_id = :E;
\o
select 'ok 67 lembrete da arte';

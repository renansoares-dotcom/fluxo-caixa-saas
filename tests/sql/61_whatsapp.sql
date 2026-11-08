-- WhatsApp (SQL 125): número normalizado, opt-in do Portal e da equipe, espelho do e-mail, avisos, modelo desligado, teste e acesso.
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
select pg_temp.ok(public._wa_numero('(81) 99876-5432') = '5581998765432' and public._wa_numero('+55 81 3721-0000') = '558137210000' and public._wa_numero('123') is null, 'número normalizado');
insert into auth.users(id, email) values ('61000000-0000-0000-0000-0000000000c1', 'cliente.wa@exemplo.com');
insert into favorecidos(id, empresa_id, nome, documento) values ('61000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE WA', '55666777000188');
insert into portal_usuarios(empresa_id, user_id, favorecido_id, email) values ('e000000a-0000-0000-0000-000000000000', '61000000-0000-0000-0000-0000000000c1', '61000000-0000-0000-0000-0000000000f1', 'cliente.wa@exemplo.com');
-- o cliente aceita no Portal
select pg_temp.entrar('61000000-0000-0000-0000-0000000000c1');
select pg_temp.falha($$select public.portal_whatsapp('12', true)$$, 'número inválido');
select public.portal_whatsapp('(81) 99876-5432', true);
select pg_temp.ok((select numero = '5581998765432' and aceito from public.portal_whatsapp_meu()), 'aceito no Portal');
reset role;
-- a mesma mensagem do e-mail vai pelo WhatsApp de quem aceitou
select public._email_enfileirar('e000000a-0000-0000-0000-000000000000', 'entrega_saiu', 'CLIENTE.WA@exemplo.com', '{"notas":"7001","veiculo":"ABC1D23","caminho":"portal.html?aba=entregas"}');
select pg_temp.ok((select count(*) = 1 from email_fila where codigo = 'entrega_saiu' and para = 'cliente.wa@exemplo.com'), 'e-mail na fila');
select pg_temp.ok((select count(*) = 1 from wa_fila where codigo = 'entrega_saiu' and para = '5581998765432' and campos->>'notas' = '7001' and campos->>'empresa' = 'Empresa A'), 'WhatsApp na fila');
-- convite não vai por WhatsApp (o cliente ainda não aceitou nada)
select public._email_enfileirar('e000000a-0000-0000-0000-000000000000', 'portal_convite', 'cliente.wa@exemplo.com', '{}');
select pg_temp.ok((select count(*) = 0 from wa_fila where codigo = 'portal_convite'), 'convite só por e-mail');
-- cliente retira o aceite: não vai mais
select pg_temp.entrar('61000000-0000-0000-0000-0000000000c1');
select public.portal_whatsapp(null, false);
reset role;
select public._email_enfileirar('e000000a-0000-0000-0000-000000000000', 'entrega_feita', 'cliente.wa@exemplo.com', '{"nota":"7001"}');
select pg_temp.ok((select count(*) = 0 from wa_fila where codigo = 'entrega_feita'), 'sem aceite não vai');
-- equipe: número com aceite + aviso marcado WhatsApp
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into wa_contatos(numero, optin_em) values ('5581988887777', now());
insert into notif_preferencias(empresa_id, tipo, push, email, whatsapp) values ('e000000a-0000-0000-0000-000000000000', 'paraquedas', true, false, true)
  on conflict (user_id, empresa_id, tipo) do update set whatsapp = true;
reset role;
insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link) values ('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d', 'paraquedas', 'PA nº 9 autorizado', 'R$ 1.200,00', '#/paraquedas');
insert into notificacoes(empresa_id, user_id, tipo, titulo) values ('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d', 'nd_pendente', 'Sem WhatsApp marcado');
select pg_temp.ok((select count(*) = 1 from wa_fila where codigo = 'aviso' and para = '5581988887777' and campos->>'titulo' = 'PA nº 9 autorizado' and campos->>'caminho' = 'index.html#/paraquedas'), 'aviso marcado vai');
-- modelo desligado não entra
insert into wa_modelos(empresa_id, codigo, template, parametros, ativo) values ('e000000a-0000-0000-0000-000000000000', 'aviso', 'aviso_plataforma', array['empresa', 'titulo', 'texto'], false);
insert into notificacoes(empresa_id, user_id, tipo, titulo) values ('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d', 'paraquedas', 'Outro PA');
select pg_temp.ok((select count(*) = 1 from wa_fila where codigo = 'aviso'), 'modelo desligado');
-- teste: só administrador e com número
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select public.wa_teste('e000000a-0000-0000-0000-000000000000')$$, 'financeiro não manda teste');
select pg_temp.falha($$insert into wa_contatos(user_id, numero) values ('a0000000-0000-0000-0000-00000000000a', '5581911112222')$$, 'número de outra pessoa');
select pg_temp.ok((select count(*) = 0 from wa_fila), 'financeiro não lê a fila');
select pg_temp.falha($$insert into wa_config(empresa_id, ativo) values ('e000000a-0000-0000-0000-000000000000', true)$$, 'financeiro não liga');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha($$select public.wa_teste('e000000a-0000-0000-0000-000000000000')$$, 'admin sem número');
insert into wa_contatos(numero, optin_em) values ('5581977776666', now());
select public.wa_teste('e000000a-0000-0000-0000-000000000000');
insert into wa_config(empresa_id, ativo, phone_number_id) values ('e000000a-0000-0000-0000-000000000000', true, '123456789012345');
select pg_temp.ok((select count(*) = 1 from wa_fila where codigo = 'teste' and para = '5581977776666'), 'teste na fila');
select pg_temp.falha($$update wa_config set phone_number_id = 'abc'$$, 'phone id inválido');
select pg_temp.ok((select count(*) from wa_padrao()) = 6, 'seis modelos sugeridos');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from wa_fila) and (select count(*) = 0 from wa_contatos), 'outra empresa não vê');
reset role;
\o
select 'ok 61 whatsapp';

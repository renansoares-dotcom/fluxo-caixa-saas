-- Reclamação pelo Portal (SQL 128): RNC do cliente, fotos, avisos, 8D no Portal, resposta, avaliação e certificado da NF-e.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', p::text || '@t.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
insert into favorecidos(id, empresa_id, nome, documento) values ('64000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE RECLAMA 64', '64.000.000/0001-01'),
  ('64000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'OUTRO 64', null);
insert into auth.users(id, email) values ('64000000-0000-0000-0000-0000000000c1', 'cli64@exemplo.com'), ('64000000-0000-0000-0000-0000000000c2', 'outro64@exemplo.com');
insert into portal_usuarios(empresa_id, user_id, favorecido_id, email, whatsapp, whatsapp_optin_em) values
  ('e000000a-0000-0000-0000-000000000000', '64000000-0000-0000-0000-0000000000c1', '64000000-0000-0000-0000-0000000000f1', 'cli64@exemplo.com', '5581999990064', now()),
  ('e000000a-0000-0000-0000-000000000000', '64000000-0000-0000-0000-0000000000c2', '64000000-0000-0000-0000-0000000000f2', 'outro64@exemplo.com', null, null);
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, dest_nome, dest_doc) values
  ('64000000-0000-0000-0000-0000000000e1', 'e000000a-0000-0000-0000-000000000000', 'RECL64A', 96401, current_date - 10, 'saida', true, 'autorizada', 'CLIENTE RECLAMA 64', '64000000000101'),
  ('64000000-0000-0000-0000-0000000000e2', 'e000000a-0000-0000-0000-000000000000', 'RECL64B', 96402, current_date - 10, 'saida', true, 'autorizada', 'OUTRO', '11111111000111');
insert into produtos(id, empresa_id, codigo, descricao, unidade) values ('64000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'SAC-64', 'SACOLA 64', 'KG');
insert into prod_ordens(id, empresa_id, numero, quantidade, produto_id) values ('64000000-0000-0000-0000-0000000000c3', 'e000000a-0000-0000-0000-000000000000', 96400, 1000, '64000000-0000-0000-0000-0000000000a1'),
  ('64000000-0000-0000-0000-0000000000c4', 'e000000a-0000-0000-0000-000000000000', 96399, 1000, '64000000-0000-0000-0000-0000000000a1');
insert into prod_bobinas(id, empresa_id, codigo, ordem_id, peso_kg) values ('64000000-0000-0000-0000-0000000000b0', 'e000000a-0000-0000-0000-000000000000', 'B64-M', '64000000-0000-0000-0000-0000000000c4', 600);
insert into prod_bobinas(id, empresa_id, codigo, ordem_id, peso_kg, mae_id, situacao, nota_id) values
  ('64000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', 'B64-1', '64000000-0000-0000-0000-0000000000c3', 250, '64000000-0000-0000-0000-0000000000b0', 'expedida', '64000000-0000-0000-0000-0000000000e1'),
  ('64000000-0000-0000-0000-0000000000b2', 'e000000a-0000-0000-0000-000000000000', 'B64-2', '64000000-0000-0000-0000-0000000000c3', 260, '64000000-0000-0000-0000-0000000000b0', 'expedida', '64000000-0000-0000-0000-0000000000e1');
insert into qual_planos(id, empresa_id, nome, etapa, produto_id, caracteristicas) values ('64000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'Final sacola 64', 'final', '64000000-0000-0000-0000-0000000000a1',
  '[{"nome":"Espessura","tipo":"medida","unidade":"µm","min":28,"max":32},{"nome":"Solda","tipo":"atributo"}]');
insert into qual_inspecoes(empresa_id, etapa, origem, plano_id, produto_id, ordem_id, situacao, resultados, inspetor) values
  ('e000000a-0000-0000-0000-000000000000', 'final', 'op', '64000000-0000-0000-0000-0000000000d1', '64000000-0000-0000-0000-0000000000a1', '64000000-0000-0000-0000-0000000000c3', 'aprovada',
   '[{"nome":"Espessura","valores":[29.5,30.1,30.4]},{"nome":"Solda","defeitos":0}]', 'Inspetor 64'),
  ('e000000a-0000-0000-0000-000000000000', 'final', 'op', '64000000-0000-0000-0000-0000000000d1', '64000000-0000-0000-0000-0000000000a1', '64000000-0000-0000-0000-0000000000c3', 'reprovada', '[]', 'Inspetor 64');

-- o cliente reclama pelo Portal
select pg_temp.entrar('64000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((public.portal_qualidade_cfg('64000000-0000-0000-0000-0000000000f1') ->> 'reclamacao')::boolean, 'reclamação ligada por padrão');
select pg_temp.falha($$select public.portal_reclamar('64000000-0000-0000-0000-0000000000f1', null, null, null, null, null, 'curto')$$, 'descrição curta');
select pg_temp.falha($$select public.portal_reclamar('64000000-0000-0000-0000-0000000000f1', '64000000-0000-0000-0000-0000000000e2', null, null, null, null, 'Nota de outro cliente aqui')$$, 'nota alheia');
select pg_temp.falha($$select public.portal_reclamar('64000000-0000-0000-0000-0000000000f2', null, null, null, null, null, 'Cliente que não é meu')$$, 'cliente alheio');
select pg_temp.falha($$select public.portal_reclamar('64000000-0000-0000-0000-0000000000f1', null, null, null, null, null, 'Foto de outra empresa', array['e000000b-0000-0000-0000-000000000000/portal/64000000-0000-0000-0000-000000000099/x.jpg'])$$, 'foto fora da pasta');
create temp table t64(n int); grant all on t64 to authenticated;
insert into t64 select public.portal_reclamar('64000000-0000-0000-0000-0000000000f1', '64000000-0000-0000-0000-0000000000e1', 'Sacola 64', 'B64-1', 120, 'KG',
  'Solda abrindo nas sacolas do fardo 3, ao encher com 5 kg.', array['e000000a-0000-0000-0000-000000000000/portal/64000000-0000-0000-0000-000000000099/foto1.jpg']);
select pg_temp.ok((select jsonb_array_length(public.portal_reclamacoes('64000000-0000-0000-0000-0000000000f1')) = 1), 'cliente vê a reclamação');
select pg_temp.ok((select (x -> 'fotos' -> 0 ->> 'nome') = 'foto1.jpg' and (x ->> 'nota')::int = 96401 and (x ->> 'quantidade')::numeric = 120 from jsonb_array_elements(public.portal_reclamacoes('64000000-0000-0000-0000-0000000000f1')) x), 'nota, quantidade e foto');
select pg_temp.ok(public._portal_qual_arquivo('e000000a-0000-0000-0000-000000000000/portal/64000000-0000-0000-0000-000000000099/foto1.jpg'), 'cliente vê a foto');
select pg_temp.falha($$select public.portal_reclamacao_avaliar('64000000-0000-0000-0000-0000000000f1', (select id from qual_rnc where numero = (select n from t64) and empresa_id = 'e000000a-0000-0000-0000-000000000000'), true)$$, 'avaliar sem resposta');
select pg_temp.entrar('64000000-0000-0000-0000-0000000000c2');
select pg_temp.ok((select jsonb_array_length(public.portal_reclamacoes('64000000-0000-0000-0000-0000000000f1')) = 0), 'outro cliente não vê');
select pg_temp.ok(not public._portal_qual_arquivo('e000000a-0000-0000-0000-000000000000/portal/64000000-0000-0000-0000-000000000099/foto1.jpg'), 'outro cliente não vê a foto');
reset role;
select pg_temp.ok((select origem = 'cliente' and portal_visivel and quantidade is null and quantidade_cliente = 120 and prazo_resposta = current_date + 2 and nota_id is not null
                     from qual_rnc where numero = (select n from t64) and empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'RNC do cliente');
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'qual_reclamacao' and ref_id = (select id from qual_rnc where numero = (select n from t64) and empresa_id = 'e000000a-0000-0000-0000-000000000000')), 'aviso à equipe');
select pg_temp.ok((select count(*) = 1 from email_fila where codigo = 'reclamacao_recebida' and para = '64000000-0000-0000-0000-0000000000c1@t.com'), 'confirmação ao cliente');

-- a equipe responde
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.qual_responder_cliente((select id from qual_rnc where numero = (select n from t64) and empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'Resposta de quem só lê')$$, 'leitura não responde');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
update qual_rnc set equipe = 'Qualidade e extrusão', acao_imediata = 'Fardos do lote bloqueados', causa = 'Temperatura da solda baixa', prevencao = 'Checklist de setup'
 where numero = (select n from t64) and empresa_id = 'e000000a-0000-0000-0000-000000000000';
select pg_temp.ok((select public.qual_responder_cliente(id, 'Identificamos a temperatura da solda baixa na OP 96400 e trocamos os fardos.') = 2 from qual_rnc where numero = (select n from t64) and empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'e-mail + WhatsApp');
reset role;
select pg_temp.ok((select count(*) = 1 from email_fila where codigo = 'reclamacao_resposta' and para = 'cli64@exemplo.com'), 'e-mail da resposta');
select pg_temp.ok((select count(*) = 1 from wa_fila where codigo = 'reclamacao_resposta' and para = '5581999990064'), 'WhatsApp da resposta');
update qual_rnc set situacao = 'encerrada', eficacia = 'eficaz' where numero = (select n from t64) and empresa_id = 'e000000a-0000-0000-0000-000000000000';

-- o cliente vê o 8D e não aceita: a RNC reabre
select pg_temp.entrar('64000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select x -> 'd8' ->> 'causa' = 'Temperatura da solda baixa' and x ->> 'resposta' like 'Identificamos%' from jsonb_array_elements(public.portal_reclamacoes('64000000-0000-0000-0000-0000000000f1')) x), '8D no Portal');
select pg_temp.falha($$select public.portal_reclamacao_avaliar('64000000-0000-0000-0000-0000000000f1', (select (x ->> 'id')::uuid from jsonb_array_elements(public.portal_reclamacoes('64000000-0000-0000-0000-0000000000f1')) x), false, '')$$, 'não aceita sem motivo');
select public.portal_reclamacao_avaliar('64000000-0000-0000-0000-0000000000f1', (select (x ->> 'id')::uuid from jsonb_array_elements(public.portal_reclamacoes('64000000-0000-0000-0000-0000000000f1')) x), false, 'O problema continua no fardo 5.');
reset role;
select pg_temp.ok((select cliente_aceite = 'nao_aceita' and situacao = 'em_analise' and encerrada_em is null from qual_rnc where numero = (select n from t64) and empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'reaberta');
select pg_temp.ok((select urgente from notificacoes where tipo = 'qual_reclamacao_avaliacao' order by criado_em desc limit 1), 'aviso urgente');
-- 8D escondido
insert into qual_parametros(empresa_id, portal_mostrar_8d) values ('e000000a-0000-0000-0000-000000000000', false) on conflict (empresa_id) do update set portal_mostrar_8d = false;
select pg_temp.entrar('64000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select x -> 'd8' = 'null'::jsonb from jsonb_array_elements(public.portal_reclamacoes('64000000-0000-0000-0000-0000000000f1')) x), '8D escondido');
reset role;
update qual_parametros set portal_mostrar_8d = true, portal_reclamacao = false where empresa_id = 'e000000a-0000-0000-0000-000000000000';
select pg_temp.entrar('64000000-0000-0000-0000-0000000000c1');
select pg_temp.falha($$select public.portal_reclamar('64000000-0000-0000-0000-0000000000f1', null, null, null, null, null, 'Reclamação com o Portal desligado')$$, 'desligado');
reset role;
update qual_parametros set portal_reclamacao = true, certificado_responsavel = 'Ana Qualidade', certificado_cargo = 'Coordenadora' where empresa_id = 'e000000a-0000-0000-0000-000000000000';

-- certificado da nota
select pg_temp.entrar('64000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) = 1 from public.portal_certificados('64000000-0000-0000-0000-0000000000f1')), 'nota com certificado');
create temp table c64 as select public.portal_certificado('64000000-0000-0000-0000-0000000000f1', '64000000-0000-0000-0000-0000000000e1') c;
select pg_temp.ok((select (c ->> 'bobinas')::int = 2 and (c ->> 'kg')::numeric = 510 and c ->> 'responsavel' = 'Ana Qualidade' from c64), 'bobinas e responsável');
select pg_temp.ok((select jsonb_array_length(c -> 'ops') = 2 from c64), 'OP e OP da bobina-mãe');
select pg_temp.ok((select jsonb_array_length(o -> 'inspecoes') = 1 and (o ->> 'expedida')::boolean from c64, jsonb_array_elements(c -> 'ops') o where (o ->> 'numero')::int = 96400), 'só a inspeção aprovada');
select pg_temp.falha($$select public.portal_certificado('64000000-0000-0000-0000-0000000000f1', '64000000-0000-0000-0000-0000000000e2')$$, 'nota sem bobina / alheia');
select pg_temp.entrar('64000000-0000-0000-0000-0000000000c2');
select pg_temp.falha($$select public.portal_certificado('64000000-0000-0000-0000-0000000000f1', '64000000-0000-0000-0000-0000000000e1')$$, 'outro cliente');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select (public.qual_certificado('64000000-0000-0000-0000-0000000000e1') ->> 'bobinas')::int = 2), 'equipe gera');
select pg_temp.falha($$select public.qual_certificado('64000000-0000-0000-0000-0000000000e2')$$, 'nota sem bobina');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.qual_certificado('64000000-0000-0000-0000-0000000000e1')$$, 'outra empresa');
reset role;
\o
select 'ok 64 reclamação pelo portal';

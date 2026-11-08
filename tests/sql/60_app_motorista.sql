-- App do motorista (SQL 124): só as cargas dele, iniciar, chegada, entrega com canhoto, ocorrência, concluir,
-- Portal com a situação da entrega, e-mails ao cliente, perfil motorista fora do financeiro e repetição pelo sync_rpc.
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
-- motorista com login (perfil motorista) e outro motorista
insert into auth.users(id, email) values ('60000000-0000-0000-0000-0000000000a1', 'motorista.um@exemplo.com'), ('60000000-0000-0000-0000-0000000000a2', 'motorista.dois@exemplo.com'),
  ('60000000-0000-0000-0000-0000000000c1', 'cliente.entrega@exemplo.com');
insert into membros(empresa_id, user_id, papel) values ('e000000a-0000-0000-0000-000000000000', '60000000-0000-0000-0000-0000000000a1', 'motorista'),
  ('e000000a-0000-0000-0000-000000000000', '60000000-0000-0000-0000-0000000000a2', 'motorista');
insert into frota_motoristas(id, empresa_id, nome, user_id) values ('60000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', 'JOSÉ MOTORISTA', '60000000-0000-0000-0000-0000000000a1'),
  ('60000000-0000-0000-0000-0000000000b2', 'e000000a-0000-0000-0000-000000000000', 'PEDRO MOTORISTA', '60000000-0000-0000-0000-0000000000a2');
insert into log_veiculos(id, empresa_id, codigo, placa, carga_kg) values ('60000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'TRK-60', 'ABC1D23', 8000);
insert into favorecidos(id, empresa_id, nome, documento) values ('60000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE ENTREGA', '11222333000181');
insert into portal_usuarios(empresa_id, user_id, favorecido_id, email) values ('e000000a-0000-0000-0000-000000000000', '60000000-0000-0000-0000-0000000000c1', '60000000-0000-0000-0000-0000000000f1', 'cliente.entrega@exemplo.com');
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, dest_doc, dest_nome, dest_uf, v_nf, favorecido_id, xml) values
  ('60000000-0000-0000-0000-0000000000e1', 'e000000a-0000-0000-0000-000000000000', '60A', 6001, current_date, 'saida', true, 'autorizada', '11222333000181', 'CLIENTE ENTREGA', 'PE', 1000, '60000000-0000-0000-0000-0000000000f1',
   '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><dest><enderDest><xLgr>RUA DAS FLORES</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><xMun>CARUARU</xMun><CEP>55000000</CEP><fone>8133334444</fone></enderDest></dest><transp><vol><qVol>12</qVol></vol></transp></infNFe></NFe></nfeProc>'),
  ('60000000-0000-0000-0000-0000000000e2', 'e000000a-0000-0000-0000-000000000000', '60B', 6002, current_date, 'saida', true, 'autorizada', '99888777000100', 'OUTRO CLIENTE', 'PE', 500, null, null);
insert into log_cargas(id, empresa_id, data, veiculo_id, motorista_id, status) values
  ('60000000-0000-0000-0000-0000000000c9', 'e000000a-0000-0000-0000-000000000000', current_date, '60000000-0000-0000-0000-0000000000d1', '60000000-0000-0000-0000-0000000000b1', 'pronta');
insert into log_carga_notas(id, empresa_id, carga_id, nota_id, seq) values
  ('60000000-0000-0000-0000-000000000011', 'e000000a-0000-0000-0000-000000000000', '60000000-0000-0000-0000-0000000000c9', '60000000-0000-0000-0000-0000000000e2', 1),
  ('60000000-0000-0000-0000-000000000012', 'e000000a-0000-0000-0000-000000000000', '60000000-0000-0000-0000-0000000000c9', '60000000-0000-0000-0000-0000000000e1', 2);
insert into log_app_config(empresa_id, exigir_canhoto, exigir_recebedor, exigir_km, rastrear_min) values ('e000000a-0000-0000-0000-000000000000', true, true, true, 5);
-- o motorista não é membro pleno: não vê lançamentos nem contas
select pg_temp.entrar('60000000-0000-0000-0000-0000000000a1');
select pg_temp.ok(not public.is_membro('e000000a-0000-0000-0000-000000000000'), 'motorista não é membro pleno');
select pg_temp.ok((select count(*) = 0 from contas), 'não vê contas');
select pg_temp.ok((select count(*) = 0 from log_cargas), 'não lê as cargas direto');
-- as cargas dele, com endereço, telefone e volumes da nota
create temp table mc as select public.log_motorista_cargas() j;
select pg_temp.ok((select jsonb_array_length(j) = 1 from mc), 'uma carga');
select pg_temp.ok((select (j->0->'entregas'->1->>'logradouro') = 'RUA DAS FLORES' and (j->0->'entregas'->1->>'fone') = '8133334444' and (j->0->'entregas'->1->>'volumes')::numeric = 12 and (j->0->>'placa') = 'ABC1D23' from mc), 'endereço, fone, volumes, placa');
-- o outro motorista não vê nem mexe
select pg_temp.entrar('60000000-0000-0000-0000-0000000000a2');
select pg_temp.ok((select jsonb_array_length(public.log_motorista_cargas()) = 0), 'outro motorista não vê');
select pg_temp.falha($$select public.log_motorista_iniciar('60000000-0000-0000-0000-0000000000c9', 1000)$$, 'outro motorista não inicia');
-- iniciar: exige km; repetir não dá erro
select pg_temp.entrar('60000000-0000-0000-0000-0000000000a1');
select pg_temp.falha($$select public.log_motorista_entregar('60000000-0000-0000-0000-000000000011', 'X', null, 'e000000a-0000-0000-0000-000000000000/entregas/60000000-0000-0000-0000-0000000000c9/c.jpg')$$, 'entregar antes de iniciar');
select pg_temp.falha($$select public.log_motorista_iniciar('60000000-0000-0000-0000-0000000000c9')$$, 'sem km');
select public.log_motorista_iniciar('60000000-0000-0000-0000-0000000000c9', 15000);
select public.log_motorista_iniciar('60000000-0000-0000-0000-0000000000c9', 15000);
reset role;
select pg_temp.ok((select status = 'em_rota' and km_saida = 15000 and saida_em is not null from log_cargas where id = '60000000-0000-0000-0000-0000000000c9'), 'em rota');
select pg_temp.ok((select count(*) = 1 from email_fila where codigo = 'entrega_saiu' and para = 'cliente.entrega@exemplo.com' and campos->>'notas' = '6001'), 'e-mail saiu para entrega só ao cliente da nota');
-- Portal: saiu para entrega e uma entrega antes da dele
select pg_temp.entrar('60000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select carga_status = 'em_rota' and situacao = 'pendente' and antes_da_sua = 1 from public.portal_entregas('60000000-0000-0000-0000-0000000000f1')), 'portal: em rota, 1 antes');
-- posição: grava uma e ignora a repetida em menos de 5 min
select pg_temp.entrar('60000000-0000-0000-0000-0000000000a1');
select public.log_motorista_posicao('60000000-0000-0000-0000-0000000000c9', -8.28, -35.97, 15);
select public.log_motorista_posicao('60000000-0000-0000-0000-0000000000c9', -8.29, -35.98, 15);
-- ocorrência na primeira: cliente ausente, não entregue (aviso à logística)
select public.log_motorista_ocorrencia('60000000-0000-0000-0000-0000000000c9', '60000000-0000-0000-0000-000000000011', 'ausente', 'Portão fechado', null, true, null, null, '60000000-0000-0000-0000-0000000000ab');
select public.log_motorista_ocorrencia('60000000-0000-0000-0000-0000000000c9', '60000000-0000-0000-0000-000000000011', 'ausente', 'Portão fechado', null, true, null, null, '60000000-0000-0000-0000-0000000000ab');
select pg_temp.falha($$select public.log_motorista_ocorrencia('60000000-0000-0000-0000-0000000000c9', null, 'outro', '')$$, 'outro sem descrição');
-- entrega: exige recebedor e canhoto na pasta da carga
select pg_temp.falha($$select public.log_motorista_entregar('60000000-0000-0000-0000-000000000012', '', null, 'e000000a-0000-0000-0000-000000000000/entregas/60000000-0000-0000-0000-0000000000c9/c.jpg')$$, 'sem recebedor');
select pg_temp.falha($$select public.log_motorista_entregar('60000000-0000-0000-0000-000000000012', 'MARIA', null, null)$$, 'sem canhoto');
select pg_temp.falha($$select public.log_motorista_entregar('60000000-0000-0000-0000-000000000012', 'MARIA', null, 'e000000a-0000-0000-0000-000000000000/fretes/x.jpg')$$, 'canhoto fora da pasta');
select public.log_motorista_chegada('60000000-0000-0000-0000-000000000012', -8.28, -35.97);
-- pelo sync_rpc (sem internet): mandado duas vezes, uma baixa só
select public.sync_rpc('60000000-0000-0000-0000-00000000aa01', 'log_motorista_entregar', '{"p_carga_nota":"60000000-0000-0000-0000-000000000012","p_recebedor":"MARIA SILVA","p_documento":"123","p_canhoto":"e000000a-0000-0000-0000-000000000000/entregas/60000000-0000-0000-0000-0000000000c9/c.jpg"}');
select public.sync_rpc('60000000-0000-0000-0000-00000000aa01', 'log_motorista_entregar', '{"p_carga_nota":"60000000-0000-0000-0000-000000000012","p_recebedor":"MARIA SILVA","p_documento":"123","p_canhoto":"e000000a-0000-0000-0000-000000000000/entregas/60000000-0000-0000-0000-0000000000c9/c.jpg"}');
-- concluir: km menor recusado
select pg_temp.falha($$select public.log_motorista_concluir('60000000-0000-0000-0000-0000000000c9', 14000)$$, 'km menor');
select public.log_motorista_concluir('60000000-0000-0000-0000-0000000000c9', 15120);
reset role;
select pg_temp.ok((select situacao = 'nao_entregue' from log_carga_notas where id = '60000000-0000-0000-0000-000000000011'), 'primeira não entregue');
select pg_temp.ok((select situacao = 'entregue' and recebedor_nome = 'MARIA SILVA' and baixa_por = 'app' and chegada_em is not null and lat = -8.28 from log_carga_notas where id = '60000000-0000-0000-0000-000000000012'), 'segunda entregue');
select pg_temp.ok((select count(*) = 1 from log_ocorrencias where carga_id = '60000000-0000-0000-0000-0000000000c9'), 'uma ocorrência (repetida ignorada)');
select pg_temp.ok((select count(*) = 1 from log_posicoes where carga_id = '60000000-0000-0000-0000-0000000000c9'), 'uma posição');
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'log_ocorrencia' and empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'aviso da ocorrência');
select pg_temp.ok((select status = 'concluida' and km_real = 120 from log_cargas where id = '60000000-0000-0000-0000-0000000000c9'), 'concluída com 120 km');
select pg_temp.ok((select count(*) = 1 from email_fila where codigo = 'entrega_feita' and campos->>'recebedor' = 'MARIA SILVA'), 'e-mail entregue');
-- Portal: entregue, recebedor e canhoto
select pg_temp.entrar('60000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select situacao = 'entregue' and recebedor = 'MARIA SILVA' and canhoto_path like '%/c.jpg' from public.portal_entregas('60000000-0000-0000-0000-0000000000f1')), 'portal: entregue com canhoto');
select pg_temp.ok(public._log_canhoto_do_portal('e000000a-0000-0000-0000-000000000000/entregas/60000000-0000-0000-0000-0000000000c9/c.jpg'), 'cliente vê o canhoto');
select pg_temp.ok((select count(*) = 0 from public.portal_entregas('60000000-0000-0000-0000-0000000000f1') where numero = 6002), 'não vê a nota de outro cliente');
-- logística resolve a ocorrência; leitura não
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
update log_ocorrencias set resolvida_em = now() where carga_id = '60000000-0000-0000-0000-0000000000c9';
reset role;
select pg_temp.ok((select resolvida_em is null from log_ocorrencias where carga_id = '60000000-0000-0000-0000-0000000000c9'), 'leitura não resolve');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
update log_ocorrencias set resolvida_em = now(), resolvida_por = 'financeiro', resolucao = 'Reentrega amanhã' where carga_id = '60000000-0000-0000-0000-0000000000c9';
select pg_temp.ok((select resolvida_em is not null from log_ocorrencias where carga_id = '60000000-0000-0000-0000-0000000000c9'), 'resolvida');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.log_motorista_iniciar('60000000-0000-0000-0000-0000000000c9', 1)$$, 'outra empresa');
reset role;
\o
select 'ok 60 app do motorista';

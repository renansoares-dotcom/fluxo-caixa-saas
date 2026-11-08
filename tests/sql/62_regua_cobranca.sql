-- Régua de cobrança e PIX (SQL 126): BR Code igual ao da tela, etapas, pausas, cedidos, prorrogação, canais, "Cobrar agora", Portal.
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
-- o mesmo BR Code de js/lib/pix.js (tests/pix.test.js)
select pg_temp.ok(public.pix_brcode('12345678000195', 'Plásticos Exemplo Ltda', 'Caruaru', 1234.5, 'NF 18.211/1')
  = '00020126360014br.gov.bcb.pix01141234567800019552040000530398654071234.505802BR5922PLASTICOS EXEMPLO LTDA6007CARUARU62120508NF1821116304C345', 'BR Code igual ao da tela');
select pg_temp.ok(public._pix_crc16('123456789') = '29B1', 'CRC16');
select pg_temp.ok(public.pix_brcode(null, 'X', 'Y') is null, 'sem chave');
-- base: cliente com e-mail e acesso ao Portal com WhatsApp aceito
insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values ('62000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', '1.01.62', 'VENDAS COB', 'C', 2, 'E');
insert into favorecidos(id, empresa_id, nome, documento, email) values ('62000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE COBRANÇA', '33444555000122', 'financeiro@cliente-cob.exemplo'),
  ('62000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE SEM CONTATO', null, null);
insert into auth.users(id, email) values ('62000000-0000-0000-0000-0000000000c1', 'compras@cliente-cob.exemplo');
insert into portal_usuarios(empresa_id, user_id, favorecido_id, email, whatsapp, whatsapp_optin_em) values ('e000000a-0000-0000-0000-000000000000', '62000000-0000-0000-0000-0000000000c1', '62000000-0000-0000-0000-0000000000f1', 'compras@cliente-cob.exemplo', '5581999990000', now());
insert into lancamentos(id, empresa_id, data, plano_id, favorecido_id, valor, descricao, documento, status) values
  ('62000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', current_date + 3, '62000000-0000-0000-0000-0000000000a1', '62000000-0000-0000-0000-0000000000f1', 1500, 'NF 9001', '9001/1', 'Em aberto'),
  ('62000000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', current_date - 10, '62000000-0000-0000-0000-0000000000a1', '62000000-0000-0000-0000-0000000000f1', 800, 'NF 8950', '8950/2', 'Em aberto'),
  ('62000000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', current_date - 3, '62000000-0000-0000-0000-0000000000a1', '62000000-0000-0000-0000-0000000000f2', 300, 'NF 8999', '8999/1', 'Em aberto'),
  ('62000000-0000-0000-0000-000000000004', 'e000000a-0000-0000-0000-000000000000', current_date - 3, '62000000-0000-0000-0000-0000000000a1', '62000000-0000-0000-0000-0000000000f1', 50, 'NF 9002', '9002/1', 'Em aberto'),
  ('62000000-0000-0000-0000-000000000005', 'e000000a-0000-0000-0000-000000000000', current_date, '62000000-0000-0000-0000-0000000000a1', '62000000-0000-0000-0000-0000000000f1', 900, 'NF 9003', '9003/1', 'Pago');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into cob_config(empresa_id, ativo, pix_chave, pix_nome, pix_cidade, valor_minimo) values ('e000000a-0000-0000-0000-000000000000', true, '12345678000195', 'Empresa A Ltda', 'Caruaru', 100);
select pg_temp.ok(public.cob_etapas_padrao('e000000a-0000-0000-0000-000000000000') = 5 and public.cob_etapas_padrao('e000000a-0000-0000-0000-000000000000') = 0, 'etapas padrão uma vez');
select pg_temp.falha($$insert into cob_etapas(empresa_id, dias, modelo) values ('e000000a-0000-0000-0000-000000000000', 400, 'cob_atraso')$$, 'dias fora da faixa');
reset role;
-- régua de hoje: lembrete (-3) do título 1, atraso (+10) do título 2, atraso (+3) do 3 (sem contato); o 4 fica abaixo do mínimo
select public._cob_regua('e000000a-0000-0000-0000-000000000000');
select pg_temp.ok((select count(distinct lancamento_id) = 3 from cob_envios where lancamento_id::text like '62000000-%'), 'três títulos na régua');
select pg_temp.ok((select count(*) = 2 from cob_envios where lancamento_id = '62000000-0000-0000-0000-000000000001' and etapa_dias = -3 and canal = 'email'), 'lembrete aos dois e-mails');
select pg_temp.ok((select count(*) = 1 from cob_envios where lancamento_id = '62000000-0000-0000-0000-000000000001' and canal = 'whatsapp' and para = '5581999990000'), 'lembrete no WhatsApp aceito');
select pg_temp.ok((select count(*) = 1 from cob_envios where lancamento_id = '62000000-0000-0000-0000-000000000003' and canal = 'sem_contato'), 'cliente sem contato registrado');
select pg_temp.ok((select count(*) = 0 from cob_envios where lancamento_id = '62000000-0000-0000-0000-000000000004'), 'abaixo do valor mínimo');
select pg_temp.ok((select count(*) = 2 from email_fila where codigo = 'cob_atraso' and ref_id = '62000000-0000-0000-0000-000000000002' and (campos->>'dias')::int = 10 and campos->>'pix' like '000201%' and campos->>'valor' = 'R$ 800,00'), 'e-mail de atraso com PIX');
select pg_temp.ok((select count(*) = 1 from wa_fila where codigo = 'cob_lembrete' and campos->>'documento' = '9001/1'), 'WhatsApp do lembrete');
-- rodar de novo no mesmo dia não repete
select public._cob_regua('e000000a-0000-0000-0000-000000000000');
select pg_temp.ok((select count(*) = 7 from cob_envios where lancamento_id::text like '62000000-%'), 'não repete');
-- dias depois (+3 do título 2 já passou; uma etapa antiga não sai depois de uma mais nova)
select pg_temp.ok((select count(*) = 0 from cob_envios where lancamento_id = '62000000-0000-0000-0000-000000000002' and etapa_dias = 3), 'etapa antiga não sai');
-- pausa do cliente: amanhã nada sai para ele
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into cob_pausas(empresa_id, favorecido_id, ate, motivo) values ('e000000a-0000-0000-0000-000000000000', '62000000-0000-0000-0000-0000000000f1', current_date + 10, 'Promessa de pagamento');
reset role;
select public._cob_regua('e000000a-0000-0000-0000-000000000000', current_date + 3);
select pg_temp.ok((select count(*) = 0 from cob_envios where lancamento_id = '62000000-0000-0000-0000-000000000001' and etapa_dias = 0), 'pausado (vencimento do título 1)');
delete from cob_pausas;
-- prorrogação pedida no Portal segura a cobrança do título
insert into portal_prorrogacoes(empresa_id, favorecido_id, lancamento_id, solicitado_por, vencimento_atual, nova_data, valor, motivo, status)
  values ('e000000a-0000-0000-0000-000000000000', '62000000-0000-0000-0000-0000000000f1', '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-0000000000c1', current_date + 3, current_date + 20, 1500, 'Fluxo apertado', 'pendente');
select public._cob_regua('e000000a-0000-0000-0000-000000000000', current_date + 3);
select pg_temp.ok((select count(*) = 0 from cob_envios where lancamento_id = '62000000-0000-0000-0000-000000000001' and etapa_dias = 0), 'prorrogação pendente segura');
delete from portal_prorrogacoes where lancamento_id = '62000000-0000-0000-0000-000000000001';
select public._cob_regua('e000000a-0000-0000-0000-000000000000', current_date + 3);
select pg_temp.ok((select count(*) = 3 from cob_envios where lancamento_id = '62000000-0000-0000-0000-000000000001' and etapa_dias = 0), 'vence hoje sai');
-- Cobrar agora: financeiro sim, uma vez a cada 12 h; leitura não
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok(public.cob_cobrar_agora('62000000-0000-0000-0000-000000000002') = 3, 'cobrar agora: 2 e-mails + WhatsApp');
select pg_temp.falha($$select public.cob_cobrar_agora('62000000-0000-0000-0000-000000000002')$$, '12 horas');
select pg_temp.falha($$select public.cob_cobrar_agora('62000000-0000-0000-0000-000000000005')$$, 'título pago');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.cob_cobrar_agora('62000000-0000-0000-0000-000000000001')$$, 'leitura não cobra');
-- Portal: o cliente gera o PIX do título dele; não do de outro cliente
select pg_temp.entrar('62000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select (public.portal_pix('62000000-0000-0000-0000-0000000000f1', '62000000-0000-0000-0000-000000000002')->>'brcode') like '%54068' || '00.00%'), 'PIX no Portal com o valor');
select pg_temp.falha($$select public.portal_pix('62000000-0000-0000-0000-0000000000f2', '62000000-0000-0000-0000-000000000003')$$, 'título de outro cliente');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from cob_envios), 'outra empresa não vê');
reset role;
\o
select 'ok 62 régua de cobrança';

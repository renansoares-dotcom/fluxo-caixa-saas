-- Portal (SQL 127): boleto do título (linha e arquivo), acesso ao arquivo só do dono, eventos de uso e painel de uso.
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
insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values ('63000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', '1.01.63', 'VENDAS PORTAL', 'C', 2, 'E');
insert into favorecidos(id, empresa_id, nome) values ('63000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'CLIENTE PORTAL 63'), ('63000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'OUTRO 63');
insert into auth.users(id, email) values ('63000000-0000-0000-0000-0000000000c1', 'cli63@exemplo.com'), ('63000000-0000-0000-0000-0000000000c2', 'outro63@exemplo.com');
insert into portal_usuarios(empresa_id, user_id, favorecido_id, email) values ('e000000a-0000-0000-0000-000000000000', '63000000-0000-0000-0000-0000000000c1', '63000000-0000-0000-0000-0000000000f1', 'cli63@exemplo.com'),
  ('e000000a-0000-0000-0000-000000000000', '63000000-0000-0000-0000-0000000000c2', '63000000-0000-0000-0000-0000000000f2', 'outro63@exemplo.com');
insert into lancamentos(id, empresa_id, data, plano_id, favorecido_id, valor, descricao, documento, status) values
  ('63000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', current_date + 10, '63000000-0000-0000-0000-0000000000a1', '63000000-0000-0000-0000-0000000000f1', 1000, 'NF 6301', '6301/1', 'Em aberto');
-- o financeiro anexa o boleto
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$insert into portal_boletos(empresa_id, lancamento_id, linha_digitavel) values ('e000000a-0000-0000-0000-000000000000', '63000000-0000-0000-0000-000000000001', '123')$$, 'linha inválida');
select pg_temp.falha($$insert into portal_boletos(empresa_id, lancamento_id) values ('e000000a-0000-0000-0000-000000000000', '63000000-0000-0000-0000-000000000001')$$, 'sem linha nem arquivo');
insert into portal_boletos(empresa_id, lancamento_id, linha_digitavel, arquivo_path, vencimento) values ('e000000a-0000-0000-0000-000000000000', '63000000-0000-0000-0000-000000000001',
  '23790.12345 60000.123456 78901.234567 8 99990000100000', 'e000000a-0000-0000-0000-000000000000/boletos/63000000-0000-0000-0000-000000000001/boleto.pdf', current_date + 10);
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
update portal_boletos set vencimento = current_date where lancamento_id = '63000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select vencimento = current_date + 10 from portal_boletos where lancamento_id = '63000000-0000-0000-0000-000000000001'), 'leitura não altera');
-- o cliente vê o boleto dele e baixa o arquivo; o outro cliente não
select pg_temp.entrar('63000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select linha_digitavel like '23790%' from public.portal_boletos_meus('63000000-0000-0000-0000-0000000000f1')), 'cliente vê o boleto');
select pg_temp.ok(public._portal_boleto_meu('e000000a-0000-0000-0000-000000000000/boletos/63000000-0000-0000-0000-000000000001/boleto.pdf'), 'arquivo do cliente');
select pg_temp.ok((select count(*) = 0 from portal_boletos), 'não lê a tabela direto');
-- eventos: a mesma aba conta uma vez em 10 minutos; documentos contam sempre
select public.portal_registrar('63000000-0000-0000-0000-0000000000f1', 'entrada');
select public.portal_registrar('63000000-0000-0000-0000-0000000000f1', 'notas');
select public.portal_registrar('63000000-0000-0000-0000-0000000000f1', 'notas');
select public.portal_registrar('63000000-0000-0000-0000-0000000000f1', 'danfe');
select public.portal_registrar('63000000-0000-0000-0000-0000000000f1', 'danfe');
select public.portal_registrar('63000000-0000-0000-0000-0000000000f1', 'boleto', '63000000-0000-0000-0000-000000000001');
select public.portal_registrar('63000000-0000-0000-0000-0000000000f2', 'xml');   -- não é dele: ignorado
select pg_temp.falha($$select public.portal_registrar('63000000-0000-0000-0000-0000000000f1', 'outro')$$, 'tipo inválido');
select pg_temp.entrar('63000000-0000-0000-0000-0000000000c2');
select pg_temp.ok((select count(*) = 0 from public.portal_boletos_meus('63000000-0000-0000-0000-0000000000f1')), 'outro cliente não vê');
select pg_temp.ok(not public._portal_boleto_meu('e000000a-0000-0000-0000-000000000000/boletos/63000000-0000-0000-0000-000000000001/boleto.pdf'), 'outro cliente não baixa');
reset role;
select pg_temp.ok((select count(*) = 5 from portal_eventos where favorecido_id = '63000000-0000-0000-0000-0000000000f1'), 'cinco eventos');
select pg_temp.ok((select count(*) = 0 from portal_eventos where favorecido_id = '63000000-0000-0000-0000-0000000000f2'), 'evento de cliente alheio ignorado');
-- painel de uso
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select dias_com_acesso = 1 and notas = 1 and danfe = 2 and boletos = 1 from public.portal_uso('e000000a-0000-0000-0000-000000000000') where email = 'cli63@exemplo.com'), 'painel de uso');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from public.portal_uso('e000000a-0000-0000-0000-000000000000')), 'outra empresa');
-- título pago: o boleto some do Portal
reset role;
update lancamentos set status = 'Pago' where id = '63000000-0000-0000-0000-000000000001';
select pg_temp.entrar('63000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select count(*) = 0 from public.portal_boletos_meus('63000000-0000-0000-0000-0000000000f1')), 'pago some');
reset role;
\o
select 'ok 63 portal documentos';

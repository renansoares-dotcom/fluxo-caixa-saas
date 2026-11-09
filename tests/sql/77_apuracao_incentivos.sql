-- Apuração etapa 2 (SQL 141): parâmetros por vigência (normalização, validação, acesso) e apuração do mês (fechar, bloquear, reabrir).
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

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');   -- admin
select pg_temp.falha($$insert into fisc_param(empresa_id, vigencia_inicio, prodepe_ativo, prodepe_credito_pct, fonte) values ('e000000a-0000-0000-0000-000000000000', '2026-01-01', true, 0, 'x')$$, 'PRODEPE sem percentual');
select pg_temp.falha($$insert into fisc_param(empresa_id, vigencia_inicio, prodepe_ativo, prodepe_credito_pct) values ('e000000a-0000-0000-0000-000000000000', '2026-01-01', true, 75)$$, 'PRODEPE sem fonte');
insert into fisc_param(empresa_id, vigencia_inicio, prodepe_ativo, prodepe_credito_pct, prodepe_cfops, prodepe_ncm, fecep_pct, fecep_ncm, pc_cfops_credito, fonte)
  values (:E, '2026-01-01', true, 75, array['5101', ' 6.101', '5101'], array['3923.21'], 2, array['4819'], array['5101', '6101'], 'Termo de concessão (teste)');
select pg_temp.ok((select prodepe_cfops = array['5101', '6101'] and prodepe_ncm = array['392321'] and atualizado_por = 'a0000000-0000-0000-0000-00000000000a' from fisc_param where empresa_id = :E), 'listas normalizadas e autor');
select pg_temp.ok(exists(select 1 from auditoria where tabela = 'fisc_param'), 'auditado');

select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro
select pg_temp.ok((select count(*) from fisc_param where empresa_id = :E) = 1, 'financeiro lê os parâmetros');
update fisc_param set pis_pct = 0 where empresa_id = :E;
select pg_temp.ok((select pis_pct from fisc_param where empresa_id = :E) = 1.65, 'financeiro não altera os parâmetros');
insert into fisc_apuracoes(empresa_id, mes, icms_saldo_credor_ant) values (:E, '2026-10-01', 150);
select pg_temp.falha($$insert into fisc_apuracoes(empresa_id, mes) values ('e000000a-0000-0000-0000-000000000000', '2026-09-15')$$, 'mês fora do dia 1');
select pg_temp.falha($$update fisc_apuracoes set situacao = 'fechada' where empresa_id = 'e000000a-0000-0000-0000-000000000000' and mes = '2026-10-01'$$, 'fechar sem resultado');
update fisc_apuracoes set situacao = 'fechada', resultado = '{"icms":{"recolher":10}}' where empresa_id = :E and mes = '2026-10-01';
select pg_temp.ok((select fechada_por = 'd0000000-0000-0000-0000-00000000000d' and fechada_em is not null from fisc_apuracoes where empresa_id = :E and mes = '2026-10-01'), 'fechada com autor');
select pg_temp.falha($$update fisc_apuracoes set icms_outros_debitos = 1 where empresa_id = 'e000000a-0000-0000-0000-000000000000' and mes = '2026-10-01'$$, 'fechada não muda');
select pg_temp.falha($$update fisc_apuracoes set situacao = 'aberta' where empresa_id = 'e000000a-0000-0000-0000-000000000000' and mes = '2026-10-01'$$, 'financeiro não reabre');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update fisc_apuracoes set situacao = 'aberta', resultado = null where empresa_id = :E and mes = '2026-10-01';
select pg_temp.ok((select situacao = 'aberta' and fechada_por is null and resultado is not null from fisc_apuracoes where empresa_id = :E and mes = '2026-10-01'), 'admin reabre; a memória anterior fica');

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');   -- leitura
select pg_temp.ok((select count(*) from fisc_apuracoes where empresa_id = :E) = 0, 'leitura não vê');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');   -- outra empresa
select pg_temp.ok((select count(*) from fisc_param where empresa_id = :E) = 0, 'outra empresa não vê');
reset role;
\o
select 'ok 77 apuração etapa 2';

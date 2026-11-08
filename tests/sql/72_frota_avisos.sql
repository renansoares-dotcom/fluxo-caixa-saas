-- Frota (SQL 136): vencimentos de documento, motorista e preventiva com antecedência, aviso uma vez por fase, VExpenses sem duplicar.
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
insert into log_parametros(empresa_id) values (:E) on conflict (empresa_id) do nothing;
update log_parametros set frota_alerta_ativo = true, frota_alerta_dias = 30, frota_alerta_km = 1000, frota_alerta_papeis = array['financeiro', 'admin'] where empresa_id = :E;
select pg_temp.falha($$update log_parametros set frota_alerta_dias = 0 where empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'antecedência zero');
-- limpa o que outros testes deixaram na frota da empresa A
delete from frota_documentos where empresa_id = :E; delete from frota_planos where empresa_id = :E; update frota_motoristas set ativo = false where empresa_id = :E;
update log_veiculos set situacao = 'inativo' where empresa_id = :E;
insert into log_veiculos(id, empresa_id, codigo, carga_kg, km_atual) values ('72000000-0000-0000-0000-0000000000b1', :E, 'TRK-72', 10000, 150500),
  ('72000000-0000-0000-0000-0000000000b2', :E, 'OFF-72', 10000, 0);
update log_veiculos set situacao = 'inativo' where id = '72000000-0000-0000-0000-0000000000b2';
insert into frota_documentos(id, empresa_id, veiculo_id, tipo, validade) values
  ('72000000-0000-0000-0000-0000000000d1', :E, '72000000-0000-0000-0000-0000000000b1', 'crlv', current_date + 20),     -- aviso
  ('72000000-0000-0000-0000-0000000000d2', :E, '72000000-0000-0000-0000-0000000000b1', 'seguro', current_date - 2),    -- vencido
  ('72000000-0000-0000-0000-0000000000d3', :E, '72000000-0000-0000-0000-0000000000b1', 'seguro', current_date - 400),  -- antigo do mesmo tipo: ignorado
  ('72000000-0000-0000-0000-0000000000d4', :E, '72000000-0000-0000-0000-0000000000b1', 'ipva', current_date + 90),     -- longe
  ('72000000-0000-0000-0000-0000000000d5', :E, '72000000-0000-0000-0000-0000000000b2', 'crlv', current_date - 1);     -- veículo inativo
-- o seguro antigo é mais velho; o mais recente (−2) é o que vale
insert into frota_motoristas(id, empresa_id, nome, cnh_validade, toxicologico_validade) values ('72000000-0000-0000-0000-0000000000e1', :E, 'MOTORISTA 72', current_date + 10, current_date + 200);
insert into frota_planos(id, empresa_id, veiculo_id, descricao, a_cada_km, ultimo_km) values
  ('72000000-0000-0000-0000-0000000000f1', :E, '72000000-0000-0000-0000-0000000000b1', 'Troca de óleo', 10000, 141000),   -- faltam 500 km → aviso
  ('72000000-0000-0000-0000-0000000000f2', :E, '72000000-0000-0000-0000-0000000000b1', 'Pneus', 50000, 120000);           -- faltam 19.500 km
insert into frota_planos(id, empresa_id, veiculo_id, descricao, a_cada_meses, ultima_data) values
  ('72000000-0000-0000-0000-0000000000f3', :E, '72000000-0000-0000-0000-0000000000b1', 'Revisão anual', 12, current_date - 380);   -- vencida por data

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
create temp table v as select * from public.frota_vencimentos(:E);
reset role;
select pg_temp.ok((select count(*) = 5 from v), '5 vencimentos: crlv, seguro, CNH, óleo, revisão');
select pg_temp.ok((select fase = 'vencido' from v where item = 'Seguro'), 'seguro vencido');
select pg_temp.ok((select fase = 'aviso' and dias = 20 from v where item like 'CRLV%'), 'crlv em 20 dias');
select pg_temp.ok((select fase = 'aviso' and falta_km = 500 from v where item = 'Preventiva: Troca de óleo'), 'óleo faltando 500 km');
select pg_temp.ok((select fase = 'vencido' from v where item = 'Preventiva: Revisão anual'), 'revisão vencida por data');
select pg_temp.ok((select origem = 'MOTORISTA 72' from v where item = 'CNH'), 'CNH do motorista');

-- avisa uma vez: leitura não manda; financeiro manda; de novo não repete
select pg_temp.falha($$select public.frota_avisar_agora('e000000a-0000-0000-0000-000000000000')$$, 'leitura não manda');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select public.frota_avisar_agora(:E) = 5), 'manda 5');
select pg_temp.ok((select public.frota_avisar_agora(:E) = 0), 'não repete');
reset role;
select pg_temp.ok((select count(*) = 1 and bool_and(urgente) and bool_and(titulo like 'Frota: 5 vencimento(s)%') from notificacoes where tipo = 'frota_vencimento' and user_id = 'a0000000-0000-0000-0000-00000000000a'), 'um aviso urgente ao admin');
select pg_temp.ok((select count(*) = 0 from notificacoes where tipo = 'frota_vencimento' and user_id = 'd0000000-0000-0000-0000-00000000000d'), 'quem clicou vê na tela, sem aviso');
-- o crlv vence: nova fase, novo aviso; o seguro renovado sai da lista
update frota_documentos set validade = current_date - 1 where id = '72000000-0000-0000-0000-0000000000d1';
insert into frota_documentos(empresa_id, veiculo_id, tipo, validade) values (:E, '72000000-0000-0000-0000-0000000000b1', 'seguro', current_date + 365);
select pg_temp.ok((select public._frota_avisar(:E) = 1), 'crlv vencido avisa de novo');
select pg_temp.ok((select count(*) = 0 from public.frota_vencimentos(:E) where item = 'Seguro'), 'seguro renovado');
-- desligado não avisa
update log_parametros set frota_alerta_ativo = false where empresa_id = :E;
update frota_motoristas set cnh_validade = current_date - 1 where id = '72000000-0000-0000-0000-0000000000e1';
select pg_temp.ok((select public._frota_avisar(:E) = 0), 'desligado');
select public._frota_avisos();   -- a rotina diária roda sem erro

-- VExpenses: mesma referência não entra duas vezes
insert into frota_abastecimentos(empresa_id, veiculo_id, data, km, litros, valor, origem, vexp_ref) values (:E, '72000000-0000-0000-0000-0000000000b1', current_date, 150600, 200, 1200, 'vexpenses', 'vx:abc#1');
select pg_temp.falha($$insert into frota_abastecimentos(empresa_id, veiculo_id, data, km, litros, valor, origem, vexp_ref) values ('e000000a-0000-0000-0000-000000000000', '72000000-0000-0000-0000-0000000000b1', current_date, 150700, 10, 60, 'vexpenses', 'vx:abc#1')$$, 'duplicado');
select pg_temp.falha($$insert into frota_abastecimentos(empresa_id, veiculo_id, data, km, litros, valor, origem) values ('e000000a-0000-0000-0000-000000000000', '72000000-0000-0000-0000-0000000000b1', current_date, 150700, 10, 60, 'outro')$$, 'origem inválida');
\o
select 'ok 72 frota avisos';

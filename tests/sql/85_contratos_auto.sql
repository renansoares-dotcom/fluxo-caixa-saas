-- Contratos automáticos (SQL 149): índices gravados, acumulado de 12 meses, reajuste proposto perto da data-base, parcelas, avisos e acesso.
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
-- 0,5% ao mês de 11/2025 a 10/2026 (12 meses) via a gravação da resposta do Banco Central
select pg_temp.ok(public._indices_gravar('IPCA', (select jsonb_agg(jsonb_build_object('data', to_char(m, 'DD/MM/YYYY'), 'valor', '0,50')) from generate_series('2025-11-01'::date, '2026-10-01', interval '1 month') m)) = 12, 'grava 12 meses');
select pg_temp.ok((public.indice_acumulado('IPCA', '2026-12-15') ->> 'percentual')::numeric = round((power(1.005, 12) - 1) * 100, 4), 'acumulado 11/2025 a 10/2026');
select pg_temp.ok(public.indice_acumulado('IPCA', '2027-01-10') is null, 'falta 11/2026: não calcula');
insert into contratos(id, empresa_id, numero, objeto, parte_nome, valor, periodicidade, dia_vencimento, inicio, fim, aviso_previo_dias, indice, data_base, plano_id, status)
  values ('85000000-0000-0000-0000-0000000000c1', :E, 98501, 'Locação 85', 'LOCADORA 85', 1000, 'mensal', 10, '2025-12-01', '2026-12-31', 30, 'IPCA', '2026-12-01', 'f000000a-0000-0000-0000-000000000000', 'vigente'),
         ('85000000-0000-0000-0000-0000000000c2', :E, 98502, 'Serviço 85', 'FORNECEDOR 85', 500, 'mensal', 5, '2026-01-01', null, 30, 'fixo', '2026-12-01', 'f000000a-0000-0000-0000-000000000000', 'vigente');
update contratos set reajuste_fixo_pct = 5 where id = '85000000-0000-0000-0000-0000000000c2';
select pg_temp.ok((public._contratos_rotina_empresa(:E, '2026-11-10') ->> 'reajustes')::int = 2, 'propõe os dois (30 dias antes)');
select pg_temp.ok((select status = 'proposto' and valor_novo = round(1000 * power(1.005, 12), 2) and fonte like 'Banco Central, série 433%' from contrato_reajustes where contrato_id = '85000000-0000-0000-0000-0000000000c1'), 'IPCA proposto');
select pg_temp.ok((select valor_novo = 525 from contrato_reajustes where contrato_id = '85000000-0000-0000-0000-0000000000c2'), 'fixo 5%');
select pg_temp.ok((select valor from contratos where id = '85000000-0000-0000-0000-0000000000c1') = 1000, 'valor só muda ao aprovar');
select pg_temp.ok((public._contratos_rotina_empresa(:E, '2026-11-11') ->> 'reajustes')::int = 0, 'não propõe de novo');
select pg_temp.ok((select count(*) from lancamentos where contrato_id = '85000000-0000-0000-0000-0000000000c1') = 13, 'parcelas até o fim (12/2025 a 12/2026)');
select pg_temp.ok((select count(*) from lancamentos where contrato_id = '85000000-0000-0000-0000-0000000000c2' and data <= '2027-11-30') = 23, 'indeterminado: até 12 meses à frente');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'contratos' and titulo like 'Aviso prévio%98501%') = 1, 'aviso prévio (fim 31/12 − 30 dias)');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'contratos' and titulo like 'Reajuste proposto%') >= 2, 'aviso dos reajustes');
select public._contratos_rotina_empresa(:E, '2026-11-12');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'contratos' and titulo like 'Aviso prévio%98501%') = 1, 'aviso prévio uma vez');
-- parâmetros
insert into contrato_config(empresa_id, propor_reajuste, gerar_parcelas, avisar) values (:E, false, false, false);
update contratos set data_base = '2027-01-01' where id = '85000000-0000-0000-0000-0000000000c2';
select pg_temp.ok((public._contratos_rotina_empresa(:E, '2026-12-05') ->> 'reajustes')::int = 0, 'desligado não propõe');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((public.contratos_rodar_agora(:E) ->> 'parcelas') is not null, 'admin roda agora');
select pg_temp.ok((select count(*) from indices_economicos where indice = 'IPCA') = 12, 'índices visíveis');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select public.contratos_rodar_agora('e000000a-0000-0000-0000-000000000000')$$, 'financeiro não roda');
select pg_temp.ok((select count(*) from contrato_config) = 0, 'financeiro não vê a configuração');
reset role;
delete from contrato_config where empresa_id = :E;
\o
select 'ok 85 contratos automáticos';

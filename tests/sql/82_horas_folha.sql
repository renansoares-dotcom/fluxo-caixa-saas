-- Horas × folha (SQL 146): ligação operador × colaborador, sugestão por matrícula/nome, horas apontadas sem sobreposição e com limite,
-- horas de contrato proporcionais (admissão, férias), horas extras, operadores sem ligação e acesso só do RH.
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
create or replace function pg_temp.p(p_nome text) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.hf_horas('e000000a-0000-0000-0000-000000000000', '2026-12-01') -> 'pessoas') x where x ->> 'nome' = p_nome
$$;
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into rh_colaboradores(id, empresa_id, matricula, nome, setor, vinculo, situacao, admissao, salario) values
  ('82000000-0000-0000-0000-0000000000c1', :E, '0082', 'JOSÉ 82', 'Extrusão', 'clt', 'ativo', '2025-01-01', 2200),
  ('82000000-0000-0000-0000-0000000000c2', :E, '0083', 'MARIA 82', 'Extrusão', 'clt', 'ativo', '2026-12-16', 2200);
insert into prod_operadores(id, empresa_id, nome, matricula) values ('82000000-0000-0000-0000-0000000000a1', :E, 'Jose 82 op', '82'), ('82000000-0000-0000-0000-0000000000a2', :E, 'MARIA 82', null),
  ('82000000-0000-0000-0000-0000000000a3', :E, 'AVULSO 82', null);
insert into prod_setores(id, empresa_id, nome) values ('82000000-0000-0000-0000-0000000000b1', :E, 'Extrusão 82');
insert into prod_ordens(id, empresa_id, numero, quantidade) values ('82000000-0000-0000-0000-0000000000d1', :E, 98201, 1000);
insert into prod_apontamentos(empresa_id, ordem_id, setor_id, operador_id, inicio, fim) values
  (:E, '82000000-0000-0000-0000-0000000000d1', '82000000-0000-0000-0000-0000000000b1', '82000000-0000-0000-0000-0000000000a1', '2026-12-02 08:00-03', '2026-12-02 12:00-03'),
  (:E, '82000000-0000-0000-0000-0000000000d1', '82000000-0000-0000-0000-0000000000b1', '82000000-0000-0000-0000-0000000000a1', '2026-12-02 10:00-03', '2026-12-02 14:00-03'),   -- sobrepõe 2h
  (:E, '82000000-0000-0000-0000-0000000000d1', '82000000-0000-0000-0000-0000000000b1', '82000000-0000-0000-0000-0000000000a1', '2026-12-03 06:00-03', '2026-12-04 06:00-03'),   -- 24h: limite 12h
  (:E, '82000000-0000-0000-0000-0000000000d1', '82000000-0000-0000-0000-0000000000b1', '82000000-0000-0000-0000-0000000000a2', '2026-12-17 08:00-03', '2026-12-17 16:00-03'),
  (:E, '82000000-0000-0000-0000-0000000000d1', '82000000-0000-0000-0000-0000000000b1', '82000000-0000-0000-0000-0000000000a3', '2026-12-18 08:00-03', '2026-12-18 11:00-03');
insert into rh_horas_extras(empresa_id, colaborador_id, competencia, horas_1, horas_2) values (:E, '82000000-0000-0000-0000-0000000000c1', '2026-12-01', 10, 2);
insert into rh_ferias(empresa_id, colaborador_id, aquisitivo_ini, gozo_ini, dias, pagamento) values (:E, '82000000-0000-0000-0000-0000000000c1', '2025-01-01', '2026-12-17', 15, '2026-12-15');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok(public.hf_sugerir(:E) >= 2, 'sugere por matrícula e por nome');
select pg_temp.ok((select colaborador_id = '82000000-0000-0000-0000-0000000000c1' from prod_operadores where id = '82000000-0000-0000-0000-0000000000a1'), 'matrícula 82 = 0082');
select pg_temp.ok((select colaborador_id = '82000000-0000-0000-0000-0000000000c2' from prod_operadores where id = '82000000-0000-0000-0000-0000000000a2'), 'nome igual');
select pg_temp.ok((pg_temp.p('JOSÉ 82') ->> 'horas_apontadas')::numeric = 18, '6h sem sobreposição + 12h do limite');
select pg_temp.ok((pg_temp.p('JOSÉ 82') ->> 'horas_contrato')::numeric = round(220 * 16 / 31.0, 2) and (pg_temp.p('JOSÉ 82') ->> 'horas_extras')::numeric = 12, 'contrato menos 15 dias de férias; HE');
select pg_temp.ok((pg_temp.p('MARIA 82') ->> 'horas_contrato')::numeric = round(220 * 16 / 31.0, 2) and (pg_temp.p('MARIA 82') ->> 'horas_apontadas')::numeric = 8, 'admitida no meio do mês');
select pg_temp.ok(pg_temp.p('JOSÉ 82') ->> 'setor_prod' = 'Extrusão 82', 'setor da produção');
select pg_temp.ok((select count(*) from jsonb_array_elements(public.hf_horas(:E, '2026-12-01') -> 'operadores_sem_ligacao') x where x ->> 'nome' = 'AVULSO 82' and (x ->> 'horas')::numeric = 3) = 1, 'operador sem ligação');
insert into hf_config(empresa_id, limite_apontamento_h, descontar_ferias) values (:E, 30, false);
select pg_temp.ok((pg_temp.p('JOSÉ 82') ->> 'horas_apontadas')::numeric = 30 and (pg_temp.p('JOSÉ 82') ->> 'horas_contrato')::numeric = 220, 'parâmetros: limite e férias');
select public.hf_ligar('82000000-0000-0000-0000-0000000000a3', '82000000-0000-0000-0000-0000000000c1');
select pg_temp.ok((select colaborador_id is null from prod_operadores where id = '82000000-0000-0000-0000-0000000000a1'), 'ligar outro operador solta o anterior');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro sem RH
select pg_temp.falha($$select public.hf_horas('e000000a-0000-0000-0000-000000000000', '2026-12-01')$$, 'sem RH');
select pg_temp.falha($$select public.hf_ligar('82000000-0000-0000-0000-0000000000a3', null)$$, 'sem RH não liga');
reset role;
\o
select 'ok 82 horas × folha';

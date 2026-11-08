-- OEE (SQL 113): números por máquina e período, paradas planejadas e não planejadas, OS de manutenção, metas.
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
-- base: setor de 20 h/dia, máquina de 100 kg/h, um dia de produção
insert into prod_setores(id, empresa_id, nome, horas_dia) values ('5e000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Extrusão OEE', 20);
insert into prod_maquinas(id, empresa_id, setor_id, codigo, nome, capacidade_kg_h) values ('5e000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', '5e000000-0000-0000-0000-000000000001', 'EXT-OEE', 'Extrusora OEE', 100);
insert into prod_motivos(id, empresa_id, tipo, nome, planejada) values
  ('5e000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', 'parada', 'Setup OEE', true),
  ('5e000000-0000-0000-0000-0000000000b2', 'e000000a-0000-0000-0000-000000000000', 'parada', 'Falta de material OEE', false);
insert into prod_ordens(id, empresa_id, numero, quantidade) values ('5e000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', 99001, 1000);
insert into prod_apontamentos(empresa_id, ordem_id, maquina_id, setor_id, inicio, fim, qtd_boa, refugo) values
  ('e000000a-0000-0000-0000-000000000000', '5e000000-0000-0000-0000-0000000000c1', '5e000000-0000-0000-0000-0000000000a1', '5e000000-0000-0000-0000-000000000001', '2026-10-05 08:00-03', '2026-10-05 18:00-03', 760, 40);
insert into prod_paradas(empresa_id, maquina_id, motivo_id, inicio, fim) values
  ('e000000a-0000-0000-0000-000000000000', '5e000000-0000-0000-0000-0000000000a1', '5e000000-0000-0000-0000-0000000000b1', '2026-10-05 06:00-03', '2026-10-05 08:00-03'),
  ('e000000a-0000-0000-0000-000000000000', '5e000000-0000-0000-0000-0000000000a1', '5e000000-0000-0000-0000-0000000000b2', '2026-10-05 18:00-03', '2026-10-05 21:00-03');
insert into man_equipamentos(id, empresa_id, codigo, nome, maquina_id) values ('5e000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'EQ-OEE', 'Extrusora OEE', '5e000000-0000-0000-0000-0000000000a1');
-- OS lançada depois de concluída (sem parada da produção ligada): entra pelas horas de máquina parada da própria OS
insert into man_ordens(empresa_id, numero, equipamento_id, descricao, situacao, inicio, fim, maquina_parou, parada_inicio, parada_fim, solucao) values
  ('e000000a-0000-0000-0000-000000000000', 99001, '5e000000-0000-0000-0000-0000000000d1', 'Troca de resistência', 'concluida', '2026-10-05 21:00-03', '2026-10-05 22:30-03', true, '2026-10-05 21:00-03', '2026-10-05 22:30-03', 'trocada');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
create temp table r as select public.prod_oee('e000000a-0000-0000-0000-000000000000', '2026-10-05', '2026-10-05', 'dia') j;
create temp table l as select x from r, jsonb_array_elements(j->'linhas') x where x->>'maquina_id' = '5e000000-0000-0000-0000-0000000000a1';
select pg_temp.ok((select (x->>'horas_cal')::numeric = 20 and (x->>'horas_run')::numeric = 10 and (x->>'bom')::numeric = 760 and (x->>'refugo')::numeric = 40 from l), 'calendário, horas e quantidades');
select pg_temp.ok((select (x->>'h_plan')::numeric = 2 and (x->>'h_nao_plan')::numeric = 3 and (x->>'h_os')::numeric = 1.5 and (x->>'qtd_os')::int = 1 from l), 'paradas e OS');
select pg_temp.ok((select count(*) from r, jsonb_array_elements(j->'paradas') p where p->>'motivo' like 'Manutenção%') = 1, 'OS no Pareto');
insert into prod_oee_config(empresa_id, contar_os_manutencao) values ('e000000a-0000-0000-0000-000000000000', false);
select pg_temp.ok((select (x->>'h_os')::numeric from (select jsonb_array_elements(public.prod_oee('e000000a-0000-0000-0000-000000000000', '2026-10-05', '2026-10-05')->'linhas') x) z where x->>'maquina_id' = '5e000000-0000-0000-0000-0000000000a1') = 0, 'OS desligada');
select pg_temp.falha($$select public.prod_oee('e000000a-0000-0000-0000-000000000000', '2026-10-05', '2026-10-05', 'ano')$$, 'agrupamento inválido');
select pg_temp.falha($$update prod_oee_config set meta_oee = 0$$, 'meta fora da faixa');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
update prod_oee_config set meta_oee = 90;
select pg_temp.ok((select meta_oee from prod_oee_config) = 65, 'leitura não altera');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.prod_oee('e000000a-0000-0000-0000-000000000000', '2026-10-05', '2026-10-05')$$, 'outra empresa');
reset role;
delete from prod_oee_config; delete from man_ordens where numero = 99001; delete from man_equipamentos where codigo = 'EQ-OEE';
delete from prod_paradas where maquina_id = '5e000000-0000-0000-0000-0000000000a1'; delete from prod_ordens where numero = 99001;
delete from prod_motivos where nome like '%OEE'; delete from prod_maquinas where codigo = 'EXT-OEE'; delete from prod_setores where nome = 'Extrusão OEE';
\o
select 'ok 49 OEE';

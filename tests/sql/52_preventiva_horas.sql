-- Preventiva por horas e peças críticas (SQL 116): horímetro + apontamentos, ritmo, previsão, percentual e peças.
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
insert into prod_setores(id, empresa_id, nome) values ('5d000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Setor PH');
insert into prod_maquinas(id, empresa_id, setor_id, codigo, nome) values ('5d000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', '5d000000-0000-0000-0000-000000000001', 'MQ-PH', 'Máquina PH');
insert into man_equipamentos(id, empresa_id, codigo, nome, maquina_id, horimetro, horimetro_em) values ('5d000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'EQ-PH', 'Máquina PH', '5d000000-0000-0000-0000-0000000000a1', 1000, current_date - 11);
insert into prod_ordens(id, empresa_id, numero, quantidade) values ('5d000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', 99201, 100);
-- 10 dias de 10 h depois da leitura do horímetro (e um apontamento antes da leitura, que não conta)
insert into prod_apontamentos(empresa_id, ordem_id, maquina_id, inicio, fim)
select 'e000000a-0000-0000-0000-000000000000', '5d000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000a1',
       (current_date - d)::timestamp at time zone 'America/Recife' + interval '8 hours', (current_date - d)::timestamp at time zone 'America/Recife' + interval '18 hours'
  from generate_series(1, 10) d;
insert into prod_apontamentos(empresa_id, ordem_id, maquina_id, inicio, fim) values ('e000000a-0000-0000-0000-000000000000', '5d000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000a1',
  (current_date - 20)::timestamp at time zone 'America/Recife' + interval '8 hours', (current_date - 20)::timestamp at time zone 'America/Recife' + interval '18 hours');
insert into man_planos(id, empresa_id, equipamento_id, nome, a_cada_horas, ultima_horas, pecas) values
  ('5d000000-0000-0000-0000-0000000000e1', 'e000000a-0000-0000-0000-000000000000', '5d000000-0000-0000-0000-0000000000d1', 'Troca de óleo PH', 200, 950, '[]');
select pg_temp.ok(public.man_horas_maquina('5d000000-0000-0000-0000-0000000000d1') = 1100, 'horímetro 1.000 + 100 h apontadas depois da leitura');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
create temp table h as select * from public.man_preventivas_horas('e000000a-0000-0000-0000-000000000000') where plano = 'Troca de óleo PH';
select pg_temp.ok((select desde_ultima = 150 and pct = 75 and fonte = 'horímetro + apontamentos' from h), '150 de 200 h (75%)');
-- ritmo: 110 h apontadas nos últimos 30 dias = 3,67 h/dia → 50 h faltando ≈ 13,6 dias
select pg_temp.ok((select ritmo_h_dia between 3.6 and 3.7 and dias_restantes between 13.4 and 13.8 and previsao = current_date + 14 from h), (select format('ritmo e previsão: %s %s %s', ritmo_h_dia, dias_restantes, previsao) from h));
-- 75% não gera com o padrão de 90%; com 70% gera
select pg_temp.ok(public.man_gerar_preventivas('e000000a-0000-0000-0000-000000000000') = 0 or not exists (select 1 from man_ordens where plano_id = '5d000000-0000-0000-0000-0000000000e1'), 'não gera abaixo de 90%');
reset role;
insert into man_parametros(empresa_id, gerar_horas_pct) values ('e000000a-0000-0000-0000-000000000000', 70) on conflict (empresa_id) do update set gerar_horas_pct = 70;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select public.man_gerar_preventivas('e000000a-0000-0000-0000-000000000000');
select pg_temp.ok(exists (select 1 from man_ordens where plano_id = '5d000000-0000-0000-0000-0000000000e1'), 'gera com 70%');
-- peça crítica
insert into produtos(id, empresa_id, codigo, descricao, unidade) values ('5d000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'PC-PH', 'RESISTÊNCIA PH', 'UN');
insert into man_pecas_criticas(empresa_id, produto_id, equipamento_id, minimo, ponto_pedido) values ('e000000a-0000-0000-0000-000000000000', '5d000000-0000-0000-0000-0000000000f1', '5d000000-0000-0000-0000-0000000000d1', 2, 4);
select pg_temp.falha($$insert into man_pecas_criticas(empresa_id, produto_id, minimo, ponto_pedido) values ('e000000a-0000-0000-0000-000000000000', '5d000000-0000-0000-0000-0000000000f1', 5, 1)$$, 'ponto de pedido abaixo do mínimo');
select pg_temp.ok((select situacao = 'sem_estoque' from public.man_pecas_situacao('e000000a-0000-0000-0000-000000000000') where codigo = 'PC-PH'), 'sem estoque implantado');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$insert into man_pecas_criticas(empresa_id, produto_id, minimo) values ('e000000a-0000-0000-0000-000000000000', '5d000000-0000-0000-0000-0000000000f1', 1)$$, 'leitura não cadastra');
reset role;
select pg_temp.ok(public._man_pecas_avisos() >= 0, 'aviso roda');
delete from man_pecas_criticas where produto_id = '5d000000-0000-0000-0000-0000000000f1'; delete from produtos where codigo = 'PC-PH';
delete from man_ordens where plano_id = '5d000000-0000-0000-0000-0000000000e1'; delete from man_planos where nome = 'Troca de óleo PH';
delete from prod_paradas where maquina_id = '5d000000-0000-0000-0000-0000000000a1'; delete from man_equipamentos where codigo = 'EQ-PH'; delete from prod_ordens where numero = 99201; delete from prod_maquinas where codigo = 'MQ-PH'; delete from prod_setores where nome = 'Setor PH';
update man_parametros set gerar_horas_pct = 90 where empresa_id = 'e000000a-0000-0000-0000-000000000000';
\o
select 'ok 52 preventiva por horas';

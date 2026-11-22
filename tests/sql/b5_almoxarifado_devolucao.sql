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
-- 185 — devolução ao almoxarifado: volta ao custo da saída, no centro de custo que consumiu; avariado não volta; prazo; limites
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
update est_locais set papeis = null where empresa_id = :E::uuid and codigo in ('UC');
insert into alm_config (empresa_id, valor_aprovacao, papeis_almoxarife, papeis_aprovador) values (:E, 5000, '{admin,diretor,compras}', '{admin,diretor}') on conflict (empresa_id) do nothing;
update alm_config set aprovar_proprio = false where empresa_id = :E::uuid;
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values ('b5000000-0000-0000-0000-0000000000a1', :E, 'B5-FITA', 'FITA DE ARQUEAR B5', 'uso_consumo', 'RL');
insert into rh_colaboradores(id, empresa_id, nome, setor, matricula, situacao) values ('b5000000-0000-0000-0000-0000000000c1', :E, 'OPERADORA LIMA', 'Corte e solda', 'B5-1', 'ativo') on conflict do nothing;
create temp view b5 as select (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC') uc, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra;
grant select on b5 to authenticated;
create temp table _b (k text primary key, j jsonb); grant all on _b to authenticated;
select pg_temp.entrar(:CMP::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select :E::uuid, current_date, 'b5000000-0000-0000-0000-0000000000a1', uc, compra, 10, 30, 'NF B5' from b5;

-- pede, entrega 6, e o custo médio muda depois com uma compra mais cara
select pg_temp.entrar(:LEI::uuid);
insert into _b select 'r', public.alm_requisitar(:E::uuid, '[{"produto_id":"b5000000-0000-0000-0000-0000000000a1","quantidade":6}]'::jsonb, 'Fitas para a semana');
reset role;
insert into _b select 'it', to_jsonb(id) from alm_requisicao_itens where requisicao_id = (select (j->>'id')::uuid from _b where k = 'r');
select pg_temp.entrar(:ADM::uuid);
select public.alm_entregar((select (j->>'id')::uuid from _b where k = 'r'), jsonb_build_array(jsonb_build_object('item_id', (select j #>> '{}' from _b where k = 'it'), 'quantidade', 6, 'local_id', (select uc from b5))),
  'b5000000-0000-0000-0000-0000000000c1');
select pg_temp.entrar(:CMP::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select :E::uuid, current_date, 'b5000000-0000-0000-0000-0000000000a1', uc, compra, 10, 60, 'NF B5-2' from b5;
reset role;
insert into _b select 'ei', to_jsonb(ei.id) from alm_entrega_itens ei join alm_entregas en on en.id = ei.entrega_id where en.requisicao_id = (select (j->>'id')::uuid from _b where k = 'r');

-- quem pode
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 1 and bool_and(pode_devolver = 6) from public.alm_devolviveis((select (j->>'id')::uuid from _b where k = 'r'))), 'quem pediu vê o que pode devolver');
select pg_temp.falha(format('select public.alm_devolver(%L, %L::jsonb, %L, null, %L)', (select j->>'id' from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 1)), 'sobrou', 'x'), 'quem só pede não recebe devolução');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.falha(format('select * from public.alm_devolviveis(%L)', (select j->>'id' from _b where k = 'r')), 'outra empresa');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.alm_devolver(%L, %L::jsonb, %L, null, %L)', (select j->>'id' from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 'NaN')), 'sobrou', 'x'), 'quantidade NaN');
select pg_temp.falha(format('select public.alm_devolver(%L, %L::jsonb, %L, null, %L)', (select j->>'id' from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 7)), 'sobrou', 'x'), 'devolver mais que o entregue');
select pg_temp.falha(format('select public.alm_devolver(%L, %L::jsonb, %L)', (select j->>'id' from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 1)), 'sobrou'), 'sem identificar quem devolve');

-- 2 em bom estado voltam ao custo da saída (30), 1 avariado fica como consumo
insert into _b select 'd', public.alm_devolver((select (j->>'id')::uuid from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 2, 'estado', 'boa')), 'Sobrou da semana', 'b5000000-0000-0000-0000-0000000000c1');
insert into _b select 'd2', public.alm_devolver((select (j->>'id')::uuid from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 1, 'estado', 'avariada')), 'Rolo amassado', null, 'OPERADORA LIMA');
reset role;
select pg_temp.ok((select (j->>'valor')::numeric = 60 and (j->>'itens')::int = 1 from _b where k = 'd') and (select (j->>'valor')::numeric = 0 from _b where k = 'd2'), 'devolução de 2 a R$ 30 (custo da saída), não ao custo médio de hoje; avariado sem valor');
select pg_temp.ok((select quantidade = 16 and valor = 780 from est_saldos s join est_locais l on l.id = s.local_id where s.produto_id = 'b5000000-0000-0000-0000-0000000000a1' and l.codigo = 'UC'), 'saldo 4 + 10 + 2 = 16, valor 120 + 600 + 60 = 780: o avariado não voltou ao uso e consumo');
select pg_temp.ok((select quantidade = 1 and valor = 0 from est_saldos s join est_locais l on l.id = s.local_id where s.produto_id = 'b5000000-0000-0000-0000-0000000000a1' and l.codigo = 'AVA'), 'o avariado ficou no local de avariados, sem valor, até o descarte');
select pg_temp.ok((select m.centro_custo_id is not distinct from s.centro_custo_id and t.codigo = 'DEVALM' from est_movimentos m join est_tipos_movimento t on t.id = m.tipo_movimento_id
    join alm_entrega_itens ei on ei.id = (select (j #>> '{}')::uuid from _b where k = 'ei') join est_movimentos s on s.id = ei.movimento_id
   where m.documento like 'DV %' and m.produto_id = 'b5000000-0000-0000-0000-0000000000a1' and m.custo_unitario > 0), 'a devolução volta no mesmo centro de custo da saída, com o tipo Devolução ao almoxarifado');
select pg_temp.ok((select qtd_devolvida = 3 from alm_entrega_itens where id = (select (j #>> '{}')::uuid from _b where k = 'ei')), 'entregue 6, devolvido 3');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.alm_devolver(%L, %L::jsonb, %L, null, %L)', (select j->>'id' from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 4)), 'sobrou', 'x'), 'devolver mais que o que resta');
select pg_temp.falha(format('select public.est_estornar(%L, current_date, %L)', (select movimento_id from alm_entrega_itens where id = (select (j #>> '{}')::uuid from _b where k = 'ei')), 'teste do estorno'), 'estornar a entrega já devolvida em parte');
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select 'e000000a-0000-0000-0000-000000000000', current_date, 'b5000000-0000-0000-0000-0000000000a1', uc, (select id from est_tipos_movimento where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'DEVALM'), 1, 30, 'X' from b5$$, 'devolução lançada à mão no Kardex');

-- recálculo: a devolução acompanha o custo recalculado da saída
reset role;
select public._est_recalc(:E::uuid, 'b5000000-0000-0000-0000-0000000000a1', null);
select pg_temp.ok((select d.custo_unitario = s.custo_unitario from est_movimentos d join alm_devolucao_itens di on di.movimento_id = d.id join alm_entrega_itens e on e.id = di.entrega_item_id
   join est_movimentos s on s.id = e.movimento_id where d.produto_id = 'b5000000-0000-0000-0000-0000000000a1' and di.estado = 'boa' limit 1), 'depois do recálculo, a devolução continua ao custo da saída');
select pg_temp.entrar(:ADM::uuid);

-- prazo
select public.alm_devolucao_salvar(:E::uuid, 1);
reset role;
update alm_entregas set entregue_em = now() - interval '5 days' where requisicao_id = (select (j->>'id')::uuid from _b where k = 'r');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.alm_devolver(%L, %L::jsonb, %L, null, %L)', (select j->>'id' from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 1)), 'sobrou', 'x'), 'devolução fora do prazo');
select pg_temp.falha($$select public.alm_devolucao_salvar('e000000a-0000-0000-0000-000000000000', 0)$$, 'prazo zero');
select public.alm_devolucao_salvar(:E::uuid, null);   -- sem prazo
select public.alm_devolver((select (j->>'id')::uuid from _b where k = 'r'),
  jsonb_build_array(jsonb_build_object('entrega_item_id', (select j #>> '{}' from _b where k = 'ei'), 'quantidade', 1)), 'Sobrou', null, 'OPERADORA LIMA');
select public.alm_devolucao_salvar(:E::uuid, 30);
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 3 from alm_devolucoes where requisicao_id = (select (j->>'id')::uuid from _b where k = 'r')), 'quem pediu vê as devoluções da sua requisição');
reset role;
select pg_temp.ok((select count(*) = 0 from est_saldos s cross join lateral (select coalesce(sum(m.quantidade), 0) q, coalesce(sum(m.valor), 0) v from est_movimentos m
    where m.produto_id = s.produto_id and m.local_id = s.local_id and m.lote_id is not distinct from s.lote_id) x
  where s.empresa_id = :E::uuid and (s.quantidade <> x.q or s.valor <> x.v)), 'nenhuma divergência entre saldos e movimentos');
\o
\echo b5_almoxarifado_devolucao ok

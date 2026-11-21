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
-- 176 — requisição de material ao almoxarifado: pedir, aprovar na exceção, entregar com identificação, balcão, baixa no Kardex
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
update est_locais set papeis = null where empresa_id = :E::uuid and codigo in ('UC', 'INS', 'MAN');   -- outros testes restringem quem movimenta o local
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values
  ('a8000000-0000-0000-0000-0000000000a1', :E, 'A8-PAPEL', 'PAPEL A4 RESMA', 'uso_consumo', 'UN'),
  ('a8000000-0000-0000-0000-0000000000a2', :E, 'A8-TONER', 'TONER IMPRESSORA', 'uso_consumo', 'UN'),
  ('a8000000-0000-0000-0000-0000000000a3', :E, 'A8-LUVA', 'LUVA NITRILICA', 'uso_consumo', 'PAR'),
  ('a8000000-0000-0000-0000-0000000000a4', :E, 'A8-RES', 'RESINA A8', 'materia_prima', 'KG');
insert into rh_colaboradores(id, empresa_id, nome, setor, matricula, situacao, user_id) values
  ('a8000000-0000-0000-0000-0000000000c1', :E, 'LEITORA DA SILVA', 'Administrativo', 'A8-1', 'ativo', :LEI::uuid),
  ('a8000000-0000-0000-0000-0000000000c2', :E, 'OPERADOR SOUZA', 'Extrusão', 'A8-2', 'ativo', null);
insert into crachas(id, empresa_id, colaborador_id, nome, codigo) values ('a8000000-0000-0000-0000-0000000000d1', :E, 'a8000000-0000-0000-0000-0000000000c2', 'OPERADOR SOUZA', 'a8crachaoperador000000001');
create temp view a8 as select (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC') uc, (select id from est_locais where empresa_id = :E::uuid and codigo = 'MP') mp,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra;
grant select on a8 to authenticated;
create temp table _a (k text primary key, j jsonb); grant all on _a to authenticated;
select pg_temp.entrar(:CMP::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select :E::uuid, current_date, p, uc, compra, q, c from a8, (values ('a8000000-0000-0000-0000-0000000000a1'::uuid, 100, 30), ('a8000000-0000-0000-0000-0000000000a2'::uuid, 4, 400), ('a8000000-0000-0000-0000-0000000000a3'::uuid, 50, 2)) x(p, q, c);

-- catálogo: só o que é do almoxarifado; quem só pede não vê custo
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 3 and bool_and(custo is null) and bool_and(etiqueta is not null) from public.alm_catalogo(:E::uuid) where codigo like 'A8-%'), 'catálogo: 3 itens do almoxarifado, sem custo para quem pede; resina fora');
select pg_temp.ok((select saldo = 100 from public.alm_catalogo(:E::uuid) where codigo = 'A8-PAPEL'), 'catálogo mostra o saldo');
select pg_temp.falha($$select * from public.alm_saldos('e000000a-0000-0000-0000-000000000000', array['a8000000-0000-0000-0000-0000000000a1']::uuid[])$$, 'quem só pede não vê saldo por local');

-- qualquer pessoa pede: sem regra, vai direto para o almoxarifado; setor vem do cadastro da pessoa
insert into _a select 'r1', public.alm_requisitar(:E::uuid, '[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":5},{"produto_id":"a8000000-0000-0000-0000-0000000000a3","quantidade":10,"observacao":"tamanho M"}]'::jsonb, 'Reposição do administrativo');
select pg_temp.ok((select j->>'situacao' = 'aberta' and (j->>'numero')::int >= 1 from _a where k = 'r1'), 'pedido comum: aberta, sem aprovação');
select pg_temp.ok((select setor = 'Administrativo' and para_nome = 'LEITORA DA SILVA' and valor_estimado = 170 and origem = 'pedido' from alm_requisicoes where id = (select (j->>'id')::uuid from _a where k = 'r1')), 'setor, pessoa e valor estimado (5×30 + 10×2)');
select pg_temp.falha($$select public.alm_requisitar('e000000a-0000-0000-0000-000000000000', '[]'::jsonb)$$, 'sem item');
select pg_temp.falha($$select public.alm_requisitar('e000000a-0000-0000-0000-000000000000', '[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":0}]'::jsonb)$$, 'quantidade zero');
select pg_temp.falha($$select public.alm_requisitar('e000000a-0000-0000-0000-000000000000', '[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":1},{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":2}]'::jsonb)$$, 'item repetido');
select pg_temp.falha($$select public.alm_requisitar('e000000a-0000-0000-0000-000000000000', '[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":1}]'::jsonb, null, 'a8000000-0000-0000-0000-0000000000c2')$$, 'quem só pede não pede por outra pessoa');
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, null, %L)', (select j->>'id' from _a where k = 'r1'), '[]', 'x'), 'quem pediu não entrega');
select pg_temp.falha($$select public.alm_config_salvar('e000000a-0000-0000-0000-000000000000', 500, '{admin}', '{}', '{admin}', '{}', false, true, null)$$, 'quem só pede não muda parâmetros');

-- parâmetros: valor de aprovação e item controlado
select pg_temp.entrar(:ADM::uuid);
select public.alm_config_salvar(:E::uuid, 500, '{admin,diretor,compras}', '{}', '{admin,diretor}', '{}', false, true, null);
select public.alm_controlar(:E::uuid, 'a8000000-0000-0000-0000-0000000000a2', true);
select pg_temp.falha($$select public.alm_config_salvar('e000000a-0000-0000-0000-000000000000', 500, '{chefe}', '{}', '{admin}', '{}', false, true, null)$$, 'perfil inválido');
select pg_temp.entrar(:LEI::uuid);
insert into _a select 'r2', public.alm_requisitar(:E::uuid, '[{"produto_id":"a8000000-0000-0000-0000-0000000000a2","quantidade":1}]'::jsonb, 'Toner da recepção');
select pg_temp.ok((select j->>'situacao' = 'aprovacao' and j->>'motivo_aprovacao' like 'item controlado: TONER%' from _a where k = 'r2'), 'item controlado pede aprovação');
insert into _a select 'r3', public.alm_requisitar(:E::uuid, '[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":20}]'::jsonb);
select pg_temp.ok((select j->>'situacao' = 'aprovacao' and j->>'motivo_aprovacao' like 'valor estimado de R$ 600,00 acima do limite de R$ 500,00' from _a where k = 'r3'), 'valor acima do limite pede aprovação');
select pg_temp.falha(format('select public.alm_decidir(%L, true)', (select j->>'id' from _a where k = 'r2')), 'quem pediu não aprova');
select pg_temp.ok((select count(*) = 3 from alm_requisicoes), 'quem pediu vê as suas 3');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok((select count(*) = 0 from alm_requisicoes), 'outro usuário comum não vê as dos outros');

-- aprovar e recusar
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, null, %L)', (select j->>'id' from _a where k = 'r2'), '[{"item_id":"00000000-0000-0000-0000-000000000000","quantidade":1}]', 'x'), 'aguardando aprovação não entrega');
select pg_temp.falha(format('select public.alm_decidir(%L, false, null)', (select j->>'id' from _a where k = 'r3')), 'recusa sem motivo');
select public.alm_decidir((select (j->>'id')::uuid from _a where k = 'r3'), false, 'Quantidade acima do consumo do mês');
select public.alm_decidir((select (j->>'id')::uuid from _a where k = 'r2'), true);
select pg_temp.ok((select situacao = 'recusada' and decisao_motivo is not null from alm_requisicoes where id = (select (j->>'id')::uuid from _a where k = 'r3')) and (select situacao = 'aberta' from alm_requisicoes where id = (select (j->>'id')::uuid from _a where k = 'r2')), 'recusada com motivo; aprovada volta para aberta');
reset role;
select pg_temp.ok((select count(*) >= 2 from notificacoes where tipo = 'almoxarifado' and user_id = :LEI::uuid), 'quem pediu foi avisado das decisões');

-- entrega em parte, com identificação; baixa no Kardex com documento RM
select pg_temp.entrar(:CMP::uuid);
select pg_temp.ok((select count(*) = 1 and min(quantidade) = 100 from public.alm_saldos(:E::uuid, array['a8000000-0000-0000-0000-0000000000a1']::uuid[])), 'almoxarife vê o saldo por local');
select pg_temp.ok((public.alm_cracha(:E::uuid, 'a8crachaoperador000000001') ->> 'nome') = 'OPERADOR SOUZA' and (public.alm_cracha(:E::uuid, 'naoexiste') ->> 'achou') = 'false', 'crachá lido acha a pessoa');
create temp table _i as select i.id, i.produto_id from alm_requisicao_itens i where i.requisicao_id = (select (j->>'id')::uuid from _a where k = 'r1'); grant select on _i to authenticated;
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, null, null)', (select j->>'id' from _a where k = 'r1'),
  (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', 1, 'local_id', (select uc from a8))) from _i)::text), 'entrega sem identificar quem retirou');
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, null, %L)', (select j->>'id' from _a where k = 'r1'),
  (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', 999, 'local_id', (select uc from a8))) from _i)::text, 'Fulano'), 'entrega maior que o pedido');
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, null, %L)', (select j->>'id' from _a where k = 'r1'),
  (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', 1, 'local_id', (select mp from a8))) from _i)::text, 'Fulano'), 'local que não é do almoxarifado');
insert into _a select 'e1', public.alm_entregar((select (j->>'id')::uuid from _a where k = 'r1'),
  (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', case when produto_id = 'a8000000-0000-0000-0000-0000000000a1' then 5 else 4 end, 'local_id', (select uc from a8))) from _i),
  'a8000000-0000-0000-0000-0000000000c2', null, true, 'retirou para a recepção');
select pg_temp.ok((select j->>'situacao' = 'parcial' and (j->>'valor')::numeric = 158 from _a where k = 'e1'), 'entrega em parte: 5×30 + 4×2 = 158');
reset role;
select pg_temp.ok((select count(*) = 2 and sum(quantidade) = -9 and bool_and(documento like 'RM %') and bool_and(observacao like '%OPERADOR SOUZA%') from est_movimentos where produto_id in ('a8000000-0000-0000-0000-0000000000a1', 'a8000000-0000-0000-0000-0000000000a3') and quantidade < 0), 'duas saídas no Kardex, com o documento e quem retirou');
select pg_temp.ok((select quantidade = 95 from est_saldos where produto_id = 'a8000000-0000-0000-0000-0000000000a1'), 'saldo baixado');
select pg_temp.ok((select retirou_nome = 'OPERADOR SOUZA' and cracha_lido and entregue_nome is not null from alm_entregas where requisicao_id = (select (j->>'id')::uuid from _a where k = 'r1')), 'entrega registra quem entregou, quem retirou e o crachá');
-- o resto: entrega e conclui
select pg_temp.entrar(:CMP::uuid);
select public.alm_entregar((select (j->>'id')::uuid from _a where k = 'r1'), (select jsonb_agg(jsonb_build_object('item_id', id, 'quantidade', 6, 'local_id', (select uc from a8))) from _i where produto_id = 'a8000000-0000-0000-0000-0000000000a3'), null, 'Maria da recepção');
select pg_temp.ok((select situacao = 'atendida' from alm_requisicoes where id = (select (j->>'id')::uuid from _a where k = 'r1')), 'entregue tudo: atendida');
select pg_temp.falha(format('select public.alm_cancelar(%L, %L)', (select j->>'id' from _a where k = 'r1'), 'teste'), 'atendida não cancela');

-- saldo insuficiente não entrega nada
insert into _a select 'r4', public.alm_requisitar(:E::uuid, '[{"produto_id":"a8000000-0000-0000-0000-0000000000a3","quantidade":500}]'::jsonb, null, 'a8000000-0000-0000-0000-0000000000c2');
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, %L)', (select j->>'id' from _a where k = 'r4'),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', 500, 'local_id', (select uc from a8))) from alm_requisicao_itens i where i.requisicao_id = (select (j->>'id')::uuid from _a where k = 'r4'))::text, 'a8000000-0000-0000-0000-0000000000c2'), 'saldo insuficiente');
select pg_temp.ok((select count(*) = 0 from alm_entregas where requisicao_id = (select (j->>'id')::uuid from _a where k = 'r4')), 'nada ficou gravado da entrega que falhou');
select pg_temp.ok(public.alm_cancelar((select (j->>'id')::uuid from _a where k = 'r4'), 'Sem saldo; pedir compra') = 'cancelada', 'cancelada pelo almoxarife');

-- balcão: registra e entrega na hora; item controlado no balcão fica aguardando aprovação
insert into _a select 'b1', public.alm_balcao(:E::uuid, format('[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":2,"local_id":"%s"}]', (select uc from a8))::jsonb, 'a8000000-0000-0000-0000-0000000000c2', null, true, 'balcão');
select pg_temp.ok((select (j->>'entregue')::boolean and j->>'situacao' = 'atendida' and (j->>'valor')::numeric = 60 from _a where k = 'b1'), 'balcão: pedido e entrega na mesma hora');
select pg_temp.ok((select origem = 'balcao' and setor = 'Extrusão' from alm_requisicoes where id = (select (j->>'id')::uuid from _a where k = 'b1')), 'balcão fica marcado, com o setor de quem retirou');
insert into _a select 'b2', public.alm_balcao(:E::uuid, format('[{"produto_id":"a8000000-0000-0000-0000-0000000000a2","quantidade":1,"local_id":"%s"}]', (select uc from a8))::jsonb, null, 'Visitante José');
select pg_temp.ok((select not (j->>'entregue')::boolean and j->>'situacao' = 'aprovacao' from _a where k = 'b2'), 'item controlado no balcão: aguarda aprovação, nada sai');
select pg_temp.falha(format($$select public.alm_balcao('e000000a-0000-0000-0000-000000000000', '[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":1,"local_id":"%s"}]'::jsonb)$$, (select uc from a8)), 'balcão sem identificar quem retira');

-- parâmetros: crachá obrigatório e balcão desligado
select pg_temp.entrar(:ADM::uuid);
select public.alm_config_salvar(:E::uuid, null, '{admin,diretor,compras}', '{}', '{admin,diretor}', array[:FIN::uuid], true, false, null);
select pg_temp.falha(format($$select public.alm_balcao('e000000a-0000-0000-0000-000000000000', '[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":1,"local_id":"%s"}]'::jsonb, null, 'Zé', true)$$, (select uc from a8)), 'balcão desligado');
insert into _a select 'r5', public.alm_requisitar(:E::uuid, '[{"produto_id":"a8000000-0000-0000-0000-0000000000a1","quantidade":40}]'::jsonb);
select pg_temp.ok((select j->>'situacao' = 'aberta' from _a where k = 'r5'), 'sem limite de valor: 40 resmas não pedem aprovação');
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, null, %L, false)', (select j->>'id' from _a where k = 'r5'),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', 1, 'local_id', (select uc from a8))) from alm_requisicao_itens i where i.requisicao_id = (select (j->>'id')::uuid from _a where k = 'r5'))::text, 'Zé'), 'crachá obrigatório');
select pg_temp.falha(format('select public.alm_cancelar(%L, null)', (select j->>'id' from _a where k = 'r2')), 'cancelar pedido de outra pessoa pede motivo');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok(public.alm_aprovador(:E::uuid) and not public.alm_almoxarife(:E::uuid), 'pessoa nomeada aprovadora, sem ser almoxarife');
select pg_temp.ok((select count(*) >= 6 from alm_requisicoes), 'aprovador vê todas');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from alm_requisicoes) and (select count(*) = 0 from alm_config), 'outra empresa não vê nada');
select pg_temp.falha($$select * from public.alm_catalogo('e000000a-0000-0000-0000-000000000000')$$, 'outra empresa não vê o catálogo');
select pg_temp.falha($$insert into alm_requisicoes (empresa_id, numero) values ('e000000b-0000-0000-0000-000000000000', 1)$$, 'gravação direta bloqueada');
\o
\echo a8_almoxarifado ok

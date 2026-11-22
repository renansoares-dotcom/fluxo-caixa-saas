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
-- 181 — estoque, etapa B4: custo sem login, valor negativo no estorno, bloqueio de contagem para todo movimento, transferência sem centavo,
-- documento em toda entrada, tipos só pelo administrador, almoxarifado sem parâmetros
\set B '''e000000b-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
update est_locais set papeis = null, permite_negativo = false where empresa_id = :E::uuid and codigo in ('MP', 'UC', 'ACA');
delete from est_fechamentos where empresa_id = :E::uuid;
update est_config set dias_retroativos = null, custo_desvio_pct = null, exigir_documento = false where empresa_id = :E::uuid;
update est_inv_config set aprovar_propria = true, apos_contagem = 'recontar', bloquear_movimento = true where empresa_id = :E::uuid;
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote) values
  ('b3000000-0000-0000-0000-0000000000a1', :E, 'B3-EST', 'ITEM DO ESTORNO B3', 'uso_consumo', 'KG', false),
  ('b3000000-0000-0000-0000-0000000000a2', :E, 'B3-TRF', 'ITEM DA TRANSFERENCIA B3', 'uso_consumo', 'UN', false),
  ('b3000000-0000-0000-0000-0000000000a3', :E, 'B3-INV', 'ITEM DE INVENTARIO B3', 'uso_consumo', 'UN', false);
insert into rh_colaboradores(id, empresa_id, nome, setor, matricula, situacao, user_id) values ('b3000000-0000-0000-0000-0000000000c1', :E, 'COMPRADOR B3', 'Compras', 'B3-1', 'ativo', :CMP);
create temp view b3 as select
  (select id from est_locais where empresa_id = :E::uuid and codigo = 'MP') mp, (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC') uc,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'PERDA') perda,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'DEVCLI') devcli;
grant select on b3 to authenticated;
create temp table _g (k text primary key, id uuid, j jsonb); grant all on _g to authenticated;
create function pg_temp.mov(p_prod text, p_local text, p_tipo text, p_qtd numeric, p_custo numeric, p_doc text default 'DOC B3') returns uuid language sql as $$
  insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select 'e000000a-0000-0000-0000-000000000000', current_date, ('b3000000-0000-0000-0000-0000000000' || p_prod)::uuid, case p_local when 'mp' then mp else uc end,
         case p_tipo when 'compra' then compra when 'devcli' then devcli else perda end, p_qtd, p_custo, p_doc from b3 returning id $$;
grant execute on function pg_temp.mov(text, text, text, numeric, numeric, text) to authenticated;

-- ============================================================ 1. custo só para quem consulta o estoque
select pg_temp.ok(not has_function_privilege('anon', 'public._custo_unit(uuid)', 'execute') and not has_function_privilege('authenticated', 'public._custo_unit(uuid)', 'execute'), '_custo_unit só por dentro da plataforma');
select pg_temp.ok((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))
  and p.prosrc ~ '\m(est_custos|est_saldos|est_movimentos|est_fechamento_saldos|produto_fornecedores)\M'), 'nenhuma função que lê custo, saldo ou movimento é executável sem login');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha($$select * from public._custo_unit('b3000000-0000-0000-0000-0000000000a1')$$, 'usuário logado chamando _custo_unit direto');

-- ============================================================ 2. estorno de entrada já consumida em parte: valor nunca negativo
select pg_temp.entrar(:ADM::uuid);
insert into _g(k, id) select 'c1', pg_temp.mov('a1', 'mp', 'compra', 10, 100);
select pg_temp.mov('a1', 'mp', 'compra', 10, 1);
select pg_temp.mov('a1', 'mp', 'perda', -9, null);
select public.est_estornar((select id from _g where k = 'c1'), current_date, 'compra lançada errada');
reset role;
select pg_temp.ok((select quantidade = 1 and valor = 50.50 and custo_medio = 50.5 from est_custos where produto_id = 'b3000000-0000-0000-0000-0000000000a1'), 'sobra 1 un a R$ 50,50 (o custo médio), e não R$ −444,50');
select pg_temp.ok((select custo_unitario = 50.5 and valor = -505 from est_movimentos where estorno_de = (select id from _g where k = 'c1')), 'o estorno saiu ao custo médio corrente');
select public._est_recalc(:E::uuid, 'b3000000-0000-0000-0000-0000000000a1', null);
select pg_temp.ok((select quantidade = 1 and valor = 50.50 from est_custos where produto_id = 'b3000000-0000-0000-0000-0000000000a1'), 'o recálculo dá o mesmo valor');
select pg_temp.ok((select count(*) = 0 from est_custos where empresa_id = :E::uuid and quantidade >= 0 and valor < -0.005), 'nenhum produto da empresa com quantidade positiva e valor negativo');

-- ============================================================ 5. transferência não muda o valor nem em um centavo
select pg_temp.entrar(:ADM::uuid);
select pg_temp.mov('a2', 'mp', 'compra', 3, 3.3333333333);
select public.est_transferir(:E::uuid, current_date, 'b3000000-0000-0000-0000-0000000000a2', (select mp from b3), (select uc from b3), 1);
select public.est_transferir(:E::uuid, current_date, 'b3000000-0000-0000-0000-0000000000a2', (select mp from b3), (select uc from b3), 1);
select public.est_transferir(:E::uuid, current_date, 'b3000000-0000-0000-0000-0000000000a2', (select uc from b3), (select mp from b3), 1);
reset role;
select pg_temp.ok((select quantidade = 3 and valor = 10.00 from est_custos where produto_id = 'b3000000-0000-0000-0000-0000000000a2')
  and (select sum(valor) = 10.00 from est_saldos where produto_id = 'b3000000-0000-0000-0000-0000000000a2')
  and (select count(*) = 0 from (select transferencia_id from est_movimentos where produto_id = 'b3000000-0000-0000-0000-0000000000a2' and transferencia_id is not null group by 1 having sum(valor) <> 0) x), '3 un a R$ 10,00 antes e depois de três transferências; as duas pernas sempre com o mesmo valor');

-- ============================================================ 3. item em contagem: nenhum movimento passa, por nenhum caminho
select pg_temp.entrar(:ADM::uuid);
insert into _g(k, id) select 'c3', pg_temp.mov('a3', 'uc', 'compra', 100, 10);
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, id) select 'inv', public.est_inv_gerar(:E::uuid, (select uc from b3), null, array['b3000000-0000-0000-0000-0000000000a3']::uuid[]);
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select pg_temp.mov('a3', 'uc', 'perda', -1, null)$$, 'lançamento direto de item em contagem');
select pg_temp.falha($$select public.est_transferir('e000000a-0000-0000-0000-000000000000', current_date, 'b3000000-0000-0000-0000-0000000000a3', (select uc from b3), (select mp from b3), 1)$$, 'transferência de item em contagem');
select pg_temp.falha(format('select public.est_estornar(%L, current_date, %L)', (select id from _g where k = 'c3'), 'teste'), 'estorno de item em contagem');
select public.alm_config_salvar(:E::uuid, null, '{admin,diretor,compras}', '{}', '{admin,diretor}', '{}', false, true, null, false);
insert into _g(k, j) select 'r1', public.alm_requisitar(:E::uuid, '[{"produto_id":"b3000000-0000-0000-0000-0000000000a3","quantidade":2}]'::jsonb, 'teste do bloqueio');
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, null, %L, false, null, null)', (select j->>'id' from _g where k = 'r1'),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', 2, 'local_id', (select uc from b3))) from alm_requisicao_itens i where i.requisicao_id = (select (j->>'id')::uuid from _g where k = 'r1'))::text, 'Fulano'), 'entrega de requisição de item em contagem');
reset role;
select pg_temp.ok((select quantidade = 100 from est_saldos where produto_id = 'b3000000-0000-0000-0000-0000000000a3'), 'o saldo do item em contagem não se mexeu');
select pg_temp.entrar(:FIN::uuid);
select public.est_inv_contar(i.id, 90) from est_inv_itens i where contagem_id = (select id from _g where k = 'inv');
select public.est_inv_contar(i.id, 90, 'faltam 10') from est_inv_itens i where contagem_id = (select id from _g where k = 'inv') and situacao = 'recontar';
select public.est_inv_enviar((select id from _g where k = 'inv'));
select pg_temp.ok((select contadores = array[:FIN::uuid] from est_inv_itens where contagem_id = (select id from _g where k = 'inv')), 'quem contou fica guardado por usuário');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.ok(public.est_inv_aprovar((select id from _g where k = 'inv'), true) = 1, 'o ajuste da própria contagem passa pelo bloqueio');
select public.alm_entregar((select (j->>'id')::uuid from _g where k = 'r1'),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', 2, 'local_id', (select uc from b3))) from alm_requisicao_itens i where i.requisicao_id = (select (j->>'id')::uuid from _g where k = 'r1')),
  null, 'Fulano', false, null, null);
reset role;
select pg_temp.ok((select quantidade = 88 from est_saldos where produto_id = 'b3000000-0000-0000-0000-0000000000a3'), 'contagem concluída: o item volta a movimentar (90 − 2)');
update est_inv_config set bloquear_movimento = false where empresa_id = :E::uuid;

-- ============================================================ 8. almoxarifado: quem entrega não retira para si; sem parâmetros não se entrega
select pg_temp.entrar(:CMP::uuid);
insert into _g(k, j) select 'r2', public.alm_requisitar(:E::uuid, '[{"produto_id":"b3000000-0000-0000-0000-0000000000a3","quantidade":1}]'::jsonb, 'para mim');
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, %L, null, false, null, null)', (select j->>'id' from _g where k = 'r2'),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', 1, 'local_id', (select uc from b3))) from alm_requisicao_itens i where i.requisicao_id = (select (j->>'id')::uuid from _g where k = 'r2'))::text,
  'b3000000-0000-0000-0000-0000000000c1'), 'quem atende o almoxarifado entregando para si mesmo');
reset role;
delete from alm_config where empresa_id = :E::uuid;
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.alm_entregar(%L, %L::jsonb, null, %L, false, null, null)', (select j->>'id' from _g where k = 'r2'),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', 1, 'local_id', (select uc from b3))) from alm_requisicao_itens i where i.requisicao_id = (select (j->>'id')::uuid from _g where k = 'r2'))::text, 'Beltrano'), 'entrega sem os parâmetros do almoxarifado definidos');
select public.alm_config_salvar(:E::uuid, null, '{admin,diretor,compras}', '{}', '{admin,diretor}', '{}', false, true, null, false);

-- ============================================================ 6. documento em toda entrada; tipos só pelo administrador
select public.est_travas_salvar(:E::uuid, 60, 50, true);
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select pg_temp.mov('a3', 'uc', 'devcli', 500, null, null)$$, 'devolução de cliente lançada à mão sem documento');
select pg_temp.mov('a3', 'uc', 'devcli', 1, null, 'NF 555');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha($$update est_tipos_movimento set papeis_manual = null where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'SI'$$, 'financeiro liberando saldo inicial para todos');
select pg_temp.falha($$update est_tipos_movimento set documento = 'nenhum' where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'COMPRA'$$, 'financeiro tirando o documento da compra');
select pg_temp.falha($$insert into est_tipos_movimento(empresa_id, codigo, nome, sentido, afeta_custo, documento) values ('e000000a-0000-0000-0000-000000000000', 'B3X', 'Entrada livre', 'E', true, 'nenhum')$$, 'financeiro criando tipo de entrada que forma custo');
update est_tipos_movimento set nome = nome where empresa_id = :E::uuid and codigo = 'COMPRA';   -- o que não é sensível continua com o financeiro
select pg_temp.entrar(:ADM::uuid);
insert into est_tipos_movimento(empresa_id, codigo, nome, sentido, afeta_custo, documento) values (:E::uuid, 'B3Y', 'Bonificação', 'E', false, 'nf');
reset role;
update est_config set dias_retroativos = null, custo_desvio_pct = null, exigir_documento = false where empresa_id = :E::uuid;
select pg_temp.ok(exists (select 1 from pg_trigger where tgname = 'zz_auditoria' and tgrelid = 'public.est_pendencias'::regclass), 'pendência de nota com trilha de auditoria');
select pg_temp.ok((select count(*) = 0 from est_saldos s cross join lateral (select coalesce(sum(m.quantidade), 0) q, coalesce(sum(m.valor), 0) v from est_movimentos m
    where m.produto_id = s.produto_id and m.local_id = s.local_id and m.lote_id is not distinct from s.lote_id) x
  where s.empresa_id = :E::uuid and (s.quantidade <> x.q or s.valor <> x.v)), 'nenhuma divergência entre saldos e movimentos na empresa');
\o
\echo b3_estoque_etapa_b4 ok

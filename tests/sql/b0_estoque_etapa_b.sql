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
-- 178 — estoque, etapa B: quem consulta, recálculo com mês fechado, retroativo automático, custo obrigatório, acesso sem login
\set B '''e000000b-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
update est_locais set papeis = null, permite_negativo = false where empresa_id = :E::uuid and codigo in ('MP', 'UC');
delete from est_fechamentos where empresa_id = :E::uuid;
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote) values
  ('b0000000-0000-0000-0000-0000000000a1', :E, 'B0-RES', 'RESINA B0', 'uso_consumo', 'KG', false),
  ('b0000000-0000-0000-0000-0000000000a2', :E, 'B0-MAS', 'MASTER B0', 'uso_consumo', 'KG', false);
create temp view b0 as select
  (select id from est_locais where empresa_id = :E::uuid and codigo = 'MP') mp, (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC') uc,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'PERDA') perda;
grant select on b0 to authenticated;
create temp table _s (k text, j jsonb); grant all on _s to authenticated;

-- 4. entrada que forma custo exige o custo
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select 'e000000a-0000-0000-0000-000000000000', '2026-06-01', 'b0000000-0000-0000-0000-0000000000a1', mp, compra, 10 from b0$$, 'compra sem custo');

-- sequência em ordem de data: o recálculo tem de dar exatamente o que o motor deu
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select :E::uuid, '2026-06-01', 'b0000000-0000-0000-0000-0000000000a1', mp, compra, 1000, 10 from b0;
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, '2026-06-05', 'b0000000-0000-0000-0000-0000000000a1', mp, perda, -333.3333 from b0;
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select :E::uuid, '2026-06-10', 'b0000000-0000-0000-0000-0000000000a1', mp, compra, 700, 13.3333333 from b0;
select public.est_transferir(:E::uuid, '2026-06-12', 'b0000000-0000-0000-0000-0000000000a1', (select mp from b0), (select uc from b0), 250.5);
select public.est_estornar((select id from est_movimentos where produto_id = 'b0000000-0000-0000-0000-0000000000a1' and quantidade = -333.3333), '2026-06-15', 'teste');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, '2026-06-20', 'b0000000-0000-0000-0000-0000000000a1', uc, perda, -50.25 from b0;
reset role;
create temp view b0_estado as select
  (select jsonb_build_object('q', quantidade, 'v', valor, 'cm', round(custo_medio, 4)) from est_custos where produto_id = 'b0000000-0000-0000-0000-0000000000a1') custo,
  (select jsonb_agg(jsonb_build_object('l', local_id, 'q', quantidade, 'v', valor) order by local_id) from est_saldos where produto_id = 'b0000000-0000-0000-0000-0000000000a1') saldos,
  (select jsonb_agg(jsonb_build_object('q', quantidade, 'cu', round(custo_unitario, 4), 'v', valor, 'cm', round(custo_medio_apos, 4), 's', saldo_local_apos) order by data, criado_em, quantidade desc) from est_movimentos where produto_id = 'b0000000-0000-0000-0000-0000000000a1') movs;
grant select on b0_estado to authenticated;
insert into _s select 'motor', to_jsonb(x) from b0_estado x;
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok(public.est_recalcular(:E::uuid, 'b0000000-0000-0000-0000-0000000000a1') = 7, 'recalcula os 7 movimentos');
insert into _s select 'recalc', to_jsonb(x) from b0_estado x;
select pg_temp.ok((select j from _s where k = 'motor') = (select j from _s where k = 'recalc'), 'recálculo de uma sequência em ordem dá exatamente o que o motor gravou (custo, saldos, valor e saldo de cada linha)');

-- 2. mês fechado: o recálculo não toca em junho
select public.est_fechar_mes(:E::uuid, '2026-06-01');
select pg_temp.entrar(:CMP::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, '2026-07-10', 'b0000000-0000-0000-0000-0000000000a1', mp, perda, -100 from b0;
-- 3. compra com data anterior à saída: recalcula sozinho
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select :E::uuid, '2026-07-02', 'b0000000-0000-0000-0000-0000000000a1', mp, compra, 500, 20 from b0;
reset role;
select pg_temp.ok((select not recalcular from est_custos where produto_id = 'b0000000-0000-0000-0000-0000000000a1'), 'o aviso de recálculo foi atendido no fim da transação');
select pg_temp.ok((select round(m.custo_unitario, 6) = round(x.cm, 6) from est_movimentos m,
  lateral (select (c.valor_antes + 500 * 20) / (c.q_antes + 500) cm from (select sum(quantidade) q_antes, sum(valor) valor_antes from est_movimentos a join est_locais l on l.id = a.local_id
     where a.produto_id = 'b0000000-0000-0000-0000-0000000000a1' and a.data < '2026-07-01' and l.compoe_custo) c) x
  where m.produto_id = 'b0000000-0000-0000-0000-0000000000a1' and m.quantidade = -100), 'a saída de 10/07 passou a sair ao custo médio depois da compra de 02/07');
select pg_temp.ok((select (j->'movs') from _s where k = 'motor') = (select jsonb_agg(jsonb_build_object('q', quantidade, 'cu', round(custo_unitario, 4), 'v', valor, 'cm', round(custo_medio_apos, 4), 's', saldo_local_apos) order by data, criado_em, quantidade desc)
  from est_movimentos where produto_id = 'b0000000-0000-0000-0000-0000000000a1' and data < '2026-07-01'), 'os movimentos de junho (fechado) ficaram como estavam');
select pg_temp.ok((select c.quantidade = (select sum(quantidade) from est_movimentos a join est_locais l on l.id = a.local_id where a.produto_id = c.produto_id and l.compoe_custo)
   and c.valor = (select sum(valor) from est_movimentos a join est_locais l on l.id = a.local_id where a.produto_id = c.produto_id and l.compoe_custo) from est_custos c where c.produto_id = 'b0000000-0000-0000-0000-0000000000a1'), 'custo total = soma dos movimentos');
select pg_temp.ok((select bool_and(s.quantidade = (select sum(quantidade) from est_movimentos a where a.produto_id = s.produto_id and a.local_id = s.local_id)
   and s.valor = (select sum(valor) from est_movimentos a where a.produto_id = s.produto_id and a.local_id = s.local_id)) from est_saldos s where s.produto_id = 'b0000000-0000-0000-0000-0000000000a1'), 'saldo de cada local = soma dos movimentos do local');
select pg_temp.ok((select m.saldo_local_apos = (select quantidade from est_saldos s where s.produto_id = m.produto_id and s.local_id = m.local_id) from est_movimentos m where m.produto_id = 'b0000000-0000-0000-0000-0000000000a1' and m.local_id = (select mp from b0) order by data desc, criado_em desc limit 1), 'saldo no local da última linha = saldo do local');
-- vários movimentos antigos na mesma transação: um recálculo só resolve
begin;
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select :E::uuid, '2026-07-03', 'b0000000-0000-0000-0000-0000000000a1', mp, compra, 10, 21 from b0;
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario) select :E::uuid, '2026-07-04', 'b0000000-0000-0000-0000-0000000000a1', mp, compra, 10, 22 from b0;
select pg_temp.ok((select recalcular from est_custos where produto_id = 'b0000000-0000-0000-0000-0000000000a1'), 'marcado para recalcular durante a transação');
commit;
select pg_temp.ok((select not recalcular from est_custos where produto_id = 'b0000000-0000-0000-0000-0000000000a1'), 'recalculado no commit');
delete from est_fechamentos where empresa_id = :E::uuid;

-- 1. quem consulta o estoque
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) > 0 from est_custos where produto_id = 'b0000000-0000-0000-0000-0000000000a1') and (select count(*) > 0 from est_movimentos where produto_id = 'b0000000-0000-0000-0000-0000000000a1'), 'o perfil Leitura consulta, como já era');
select pg_temp.falha($$select public.est_consulta_salvar('e000000a-0000-0000-0000-000000000000', '{}')$$, 'só o administrador define quem consulta');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select public.est_consulta_salvar('e000000a-0000-0000-0000-000000000000', '{motorista}')$$, 'motorista nunca consulta');
select public.est_consulta_salvar(:E::uuid, '{}');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 0 from est_custos) and (select count(*) = 0 from est_saldos) and (select count(*) = 0 from est_movimentos), 'Leitura desligado: não lê custo, saldo nem movimento');
reset role;
update membros set papel = 'vendas' where empresa_id = :E::uuid and user_id = :LEI::uuid;
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 0 from est_custos) and (select count(*) = 0 from est_saldos), 'Vendas não lê custo nem saldo por padrão');
select pg_temp.entrar(:ADM::uuid);
select public.est_consulta_salvar(:E::uuid, '{leitura,vendas}');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) > 0 from est_custos), 'Vendas liberado pelo parâmetro');
reset role;
update membros set papel = 'motorista' where empresa_id = :E::uuid and user_id = :LEI::uuid;
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) = 0 from est_custos) and (select count(*) = 0 from est_movimentos), 'motorista não lê o estoque em nenhuma configuração');
reset role;
update membros set papel = 'leitura' where empresa_id = :E::uuid and user_id = :LEI::uuid;
select pg_temp.entrar(:ADM::uuid);
select public.est_consulta_salvar(:E::uuid, '{leitura}');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from est_custos where empresa_id = :E::uuid), 'outra empresa não lê');

-- 6. nada do estoque para quem não está logado
reset role;
select pg_temp.ok((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname ~ '^_?(est|alm|etq)_' or p.proname in ('pode_estoque', 'papel_em', 'pode_ver_estoque'))
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 'nenhuma função do estoque é executável sem login');
select pg_temp.ok(has_function_privilege('authenticated', 'public.est_estornar(uuid, date, text)', 'execute') and has_function_privilege('authenticated', 'public.est_transferir(uuid, date, uuid, uuid, uuid, numeric, uuid, uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.alm_requisitar(uuid, jsonb, text, uuid, text, text)', 'execute') and has_function_privilege('authenticated', 'public.alm_cracha(uuid, text)', 'execute'), 'quem está logado continua usando');
\o
\echo b0_estoque_etapa_b ok

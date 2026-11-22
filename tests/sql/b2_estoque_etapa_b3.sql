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
-- 180 — estoque, etapa B3: custo do estorno no recálculo, saída retroativa sem saldo, segunda etapa no inventário, leitura sem função por linha,
-- fechamento só de mês terminado, catálogo e valores da requisição, perfis de perda e requisição, estorno de outro módulo, atalhos de sessão, lote e privilégios
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
update est_inv_config set aprovar_propria = true, apos_contagem = 'recontar', bloquear_movimento = false where empresa_id = :E::uuid;
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote) values
  ('b2000000-0000-0000-0000-0000000000a1', :E, 'B2-EST', 'ITEM DO ESTORNO B2', 'uso_consumo', 'KG', false),
  ('b2000000-0000-0000-0000-0000000000a2', :E, 'B2-RET', 'ITEM RETROATIVO B2', 'uso_consumo', 'KG', false),
  ('b2000000-0000-0000-0000-0000000000a3', :E, 'B2-INT', 'ITEM INTERMEDIARIO B2', 'uso_consumo', 'KG', false),
  ('b2000000-0000-0000-0000-0000000000a4', :E, 'B2-INV', 'ITEM DE INVENTARIO B2', 'uso_consumo', 'UN', false),
  ('b2000000-0000-0000-0000-0000000000a5', :E, 'B2-ACA', 'SACO ACABADO B2', 'produto_acabado', 'KG', false),
  ('b2000000-0000-0000-0000-0000000000b1', :B, 'B2-B', 'ITEM DA OUTRA EMPRESA B2', 'uso_consumo', 'KG', false);
create temp view b2 as select
  (select id from est_locais where empresa_id = :E::uuid and codigo = 'MP') mp, (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC') uc,
  (select id from est_locais where empresa_id = :E::uuid and codigo = 'ACA') aca,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'PERDA') perda,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'SI') si;
grant select on b2 to authenticated;
create temp table _g (k text primary key, id uuid); grant all on _g to authenticated;
insert into _g select 'locb', id from est_locais where empresa_id = :B::uuid limit 1;
create function pg_temp.mov(p_prod text, p_local text, p_tipo text, p_qtd numeric, p_custo numeric, p_dias int) returns uuid language sql as $$
  insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select 'e000000a-0000-0000-0000-000000000000', current_date - p_dias, ('b2000000-0000-0000-0000-0000000000' || p_prod)::uuid,
         case p_local when 'mp' then mp when 'aca' then aca else uc end, case p_tipo when 'compra' then compra when 'si' then si else perda end, p_qtd, p_custo, 'DOC B2' from b2 returning id $$;
grant execute on function pg_temp.mov(text, text, text, numeric, numeric, int) to authenticated;

-- ============================================================ 1. o estorno acompanha o custo recalculado
select pg_temp.entrar(:ADM::uuid);
select pg_temp.mov('a1', 'mp', 'compra', 10, 10, 20);
insert into _g select 's1', pg_temp.mov('a1', 'mp', 'perda', -5, null, 10);
select public.est_estornar((select id from _g where k = 's1'), current_date - 9, 'saída lançada errada');
select pg_temp.mov('a1', 'mp', 'compra', 10, 20, 15);   -- compra com data anterior à saída e ao estorno
reset role;
select pg_temp.ok((select quantidade = 20 and valor = 300 and round(custo_medio, 4) = 15 from est_custos where produto_id = 'b2000000-0000-0000-0000-0000000000a1'), '20 un a R$ 300: o estorno devolveu ao custo recalculado (15), e não ao antigo (10)');
select pg_temp.ok((select custo_unitario = 15 and valor = -75 from est_movimentos where id = (select id from _g where k = 's1'))
  and (select custo_unitario = 15 and valor = 75 from est_movimentos where estorno_de = (select id from _g where k = 's1')), 'saída e estorno com o mesmo custo');
select pg_temp.entrar(:ADM::uuid);
select public.est_recalcular(:E::uuid, 'b2000000-0000-0000-0000-0000000000a1');
reset role;
select pg_temp.ok((select quantidade = 20 and valor = 300 from est_custos where produto_id = 'b2000000-0000-0000-0000-0000000000a1'), 'o recálculo manual mantém R$ 300');

-- ============================================================ 2. saída com data antiga não deixa o saldo negativo em nenhum dia
select pg_temp.entrar(:ADM::uuid);
select pg_temp.mov('a2', 'mp', 'compra', 10, 5, 2);
select pg_temp.falha($$select pg_temp.mov('a2', 'mp', 'perda', -8, null, 30)$$, 'saída de 30 dias atrás, quando não havia saldo');
select pg_temp.mov('a3', 'mp', 'compra', 10, 5, 30);
select pg_temp.mov('a3', 'mp', 'perda', -10, null, 20);
select pg_temp.mov('a3', 'mp', 'compra', 10, 5, 10);
select pg_temp.falha($$select pg_temp.mov('a3', 'mp', 'perda', -5, null, 25)$$, 'saída que deixaria o saldo negativo num dia do meio (10 - 5 - 10)');
select pg_temp.mov('a3', 'mp', 'perda', -5, null, 5);    -- depois da segunda compra: cabe
select pg_temp.mov('a3', 'mp', 'compra', 3, 5, 28);      -- entrada com data antiga sempre cabe
select pg_temp.mov('a3', 'mp', 'perda', -3, null, 25);   -- agora cabe: 13 - 3 - 10 = 0 no pior dia
reset role;
select pg_temp.ok((select quantidade = 10 from est_custos where produto_id = 'b2000000-0000-0000-0000-0000000000a2') and (select quantidade = 5 and valor = 25 from est_custos where produto_id = 'b2000000-0000-0000-0000-0000000000a3'), 'só entrou o que cabia; custo médio intacto (5)');
select pg_temp.ok((select min(saldo_local_apos) >= 0 from est_movimentos where produto_id in ('b2000000-0000-0000-0000-0000000000a2', 'b2000000-0000-0000-0000-0000000000a3')), 'nenhuma linha do Kardex com saldo negativo');

-- ============================================================ 7. perfis, primeiro custo, transferência e atalho de sessão
select pg_temp.entrar(:ADM::uuid);
select public.est_travas_salvar(:E::uuid, 60, 50, true);
update est_tipos_movimento set papeis_manual = '{financeiro,diretor}' where id = (select perda from b2);
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select pg_temp.mov('a3', 'mp', 'perda', -1, null, 0)$$, 'perda por quem não é financeiro nem diretor');
select pg_temp.falha($$select public.est_transferir('e000000a-0000-0000-0000-000000000000', current_date - 100, 'b2000000-0000-0000-0000-0000000000a3', (select mp from b2), (select uc from b2), 1)$$, 'transferência além do limite de dias');
select public.est_transferir(:E::uuid, current_date, 'b2000000-0000-0000-0000-0000000000a3', (select mp from b2), (select uc from b2), 1);
select set_config('app.est_recalculo', 'sim', false);
select pg_temp.falha($$select pg_temp.mov('a3', 'mp', 'compra', 5, 5, -30)$$, 'a variável de sessão não pula a trava de data futura');
select pg_temp.falha($$select pg_temp.mov('a3', 'mp', 'si', 5, 5, 0)$$, 'a variável de sessão não libera saldo inicial para quem compra');
select pg_temp.falha($$update est_movimentos set quantidade = 999 where produto_id = 'b2000000-0000-0000-0000-0000000000a3' returning 1 / 0$$, 'a variável de sessão não deixa alterar movimento');
select set_config('app.est_recalculo', 'nao', false);
reset role;
select pg_temp.ok((select count(*) = 0 from est_movimentos where produto_id = 'b2000000-0000-0000-0000-0000000000a3' and quantidade = 999), 'nenhum movimento alterado');
update est_tipos_movimento set papeis_manual = null where id = (select perda from b2);
update est_config set dias_retroativos = null, custo_desvio_pct = null, exigir_documento = false where empresa_id = :E::uuid;

-- ============================================================ 8. estorno de movimento lançado por outro módulo
select pg_temp.ok((select count(*) > 0 from tin_pesagens p join est_movimentos m on m.id = p.movimento_id where m.empresa_id = :E::uuid and not exists (select 1 from est_movimentos e where e.estorno_de = m.id)), 'há pesagem de tinta com movimento no Kardex (preparação)');
-- o bloqueio em si é exercitado em tests/concorrencia/estoque.sh, com a chamada feita direto (como a tela faz): dentro de uma função de teste o banco não a veria como direta

-- ============================================================ lote e tipo conferem a empresa
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$insert into est_lotes(empresa_id, produto_id, codigo) values ('e000000a-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000b1', 'X')$$, 'lote com produto de outra empresa');
with x as (insert into est_lotes(empresa_id, produto_id, codigo) values (:E::uuid, 'b2000000-0000-0000-0000-0000000000a2', 'B2-L1') returning id) insert into _g select 'l1', id from x;
update est_lotes set codigo = 'B2-L1-CORRIGIDO' where id = (select id from _g where k = 'l1');   -- sem movimentos, corrige
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha(format('update est_tipos_movimento set local_destino_id = %L where id = (select perda from b2)', (select id from _g where k = 'locb')), 'local padrão de outra empresa no tipo');

-- ============================================================ 3. inventário: segregação só pelo administrador, segunda etapa, uma contagem por local
select pg_temp.falha($$update est_inv_config set aprovar_propria = false where empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'financeiro não altera a exceção de aprovação');
update est_inv_config set tolerancia_pct = tolerancia_pct where empresa_id = :E::uuid;   -- o resto dos parâmetros continua com o financeiro
select pg_temp.entrar(:ADM::uuid);
select pg_temp.mov('a4', 'uc', 'compra', 100, 10, 1);
select pg_temp.entrar(:FIN::uuid);
insert into _g select 'inv', public.est_inv_gerar(:E::uuid, (select uc from b2), null, array['b2000000-0000-0000-0000-0000000000a4']::uuid[]);
select public.est_inv_contar(i.id, 50) from est_inv_itens i where contagem_id = (select id from _g where k = 'inv');
select public.est_inv_contar(i.id, 50, 'faltam 50') from est_inv_itens i where contagem_id = (select id from _g where k = 'inv') and situacao = 'recontar';
select public.est_inv_enviar((select id from _g where k = 'inv'));
select pg_temp.falha(format('select public.est_inv_gerar(%L, %L, null, array[%L]::uuid[])', 'e000000a-0000-0000-0000-000000000000', (select uc from b2), 'b2000000-0000-0000-0000-0000000000a4'), 'segunda contagem no local com uma aguardando aprovação');
reset role;
update empresas set mfa_obrigatorio = true where id = :E::uuid;
select pg_temp.entrar(:ADM::uuid);   -- administrador sem a segunda etapa
select pg_temp.falha(format('select public.est_inv_aprovar(%L, true)', (select id from _g where k = 'inv')), 'aprovar inventário sem a verificação em duas etapas');
select pg_temp.falha($$select public.etq_config_salvar('e000000a-0000-0000-0000-000000000000', '{}'::jsonb)$$, 'mudar etiquetas sem a verificação em duas etapas');
select pg_temp.ok(not public.pode_tintas(:E::uuid) and not public.pode_qualidade(:E::uuid) and not public.pode_manutencao(:E::uuid), 'tintas, qualidade e manutenção também pedem a segunda etapa');
select set_config('request.jwt.claims', json_build_object('sub', :ADM, 'role', 'authenticated', 'email', 'outro@t.com', 'aal', 'aal2')::text, false);
select pg_temp.ok(public.est_inv_aprovar((select id from _g where k = 'inv'), true) = 1, 'com a segunda etapa, aprova');
reset role;
update empresas set mfa_obrigatorio = false where id = :E::uuid;
select pg_temp.ok((select quantidade = 50 from est_saldos where produto_id = 'b2000000-0000-0000-0000-0000000000a4'), 'saldo ajustado para 50');

-- ============================================================ 5. fechamento só de mês terminado
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha($$select public.est_fechar_mes('e000000a-0000-0000-0000-000000000000', current_date)$$, 'fechar o mês corrente');

-- ============================================================ 6. requisição só do catálogo do almoxarifado
select pg_temp.entrar(:ADM::uuid);
select pg_temp.mov('a5', 'aca', 'compra', 100, 28.5714, 1);
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha($$select public.alm_requisitar('e000000a-0000-0000-0000-000000000000', '[{"produto_id":"b2000000-0000-0000-0000-0000000000a5","quantidade":1}]'::jsonb, 'quero saber o custo')$$, 'pedir produto acabado pela requisição de material');

-- ============================================================ 4 e 8. leitura por lista de empresas, índice e privilégios
reset role;
select pg_temp.ok((select count(*) = 6 and bool_and(qual like '%est_empresas_que_vejo%') from pg_policies where schemaname = 'public' and cmd = 'SELECT'
  and tablename in ('est_movimentos', 'est_saldos', 'est_custos', 'est_inv_contagens', 'est_inv_itens', 'est_fechamento_saldos')), 'as seis tabelas leem pela lista de empresas, sem função por linha');
select pg_temp.ok(exists (select 1 from pg_indexes where indexname = 'est_mov_emp_data'), 'índice por empresa e data');
select pg_temp.ok((select count(*) = 0 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^(est|alm|etq)_'
  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'truncate') or has_table_privilege('authenticated', c.oid, 'truncate'))), 'visitante sem privilégio nas tabelas do estoque; ninguém trunca');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) > 0 from est_movimentos) and (select count(*) = 0 from est_movimentos where empresa_id = :B::uuid), 'leitura consulta só a própria empresa');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from est_movimentos where empresa_id = :E::uuid) and (select count(*) = 0 from est_custos where empresa_id = :E::uuid), 'outra empresa não lê');
reset role;
select pg_temp.ok((select count(*) = 0 from est_saldos s cross join lateral (select coalesce(sum(m.quantidade), 0) q, coalesce(sum(m.valor), 0) v from est_movimentos m
    where m.produto_id = s.produto_id and m.local_id = s.local_id and m.lote_id is not distinct from s.lote_id) x
  where s.empresa_id = :E::uuid and (s.quantidade <> x.q or s.valor <> x.v)), 'nenhuma divergência entre saldos e movimentos na empresa');
\o
\echo b2_estoque_etapa_b3 ok

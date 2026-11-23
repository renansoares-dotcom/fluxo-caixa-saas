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
-- 192 — aprovação de perda e ajuste acima de um valor
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
update est_locais set papeis = null where empresa_id = :E::uuid and codigo = 'UC';
delete from est_fechamentos where empresa_id = :E::uuid;
update est_ig_inventarios set situacao = 'cancelado' where empresa_id = :E::uuid and situacao = 'aberto';
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values ('b8000000-0000-0000-0000-0000000000a1', :E, 'B8-BOB', 'BOBINA B8', 'uso_consumo', 'KG');
create temp view b8 as select (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC') uc, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'PERDA') perda;
grant select on b8 to authenticated;
create temp table _a (k text primary key, id uuid); grant all on _a to authenticated;
create function pg_temp.perda(q numeric) returns jsonb language sql as $$ select jsonb_build_object('empresa_id', 'e000000a-0000-0000-0000-000000000000', 'data', current_date, 'produto_id', 'b8000000-0000-0000-0000-0000000000a1',
  'local_id', uc, 'tipo_movimento_id', perda, 'quantidade', -q, 'documento', 'B8', 'observacao', 'Bobina danificada') from b8 $$;
grant execute on function pg_temp.perda(numeric) to authenticated;
select pg_temp.entrar(:ADM::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select :E::uuid, current_date, 'b8000000-0000-0000-0000-0000000000a1', uc, compra, 1000, 10, 'NF B8' from b8;

-- desligado: a perda grande entra direto
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, documento) select :E::uuid, current_date, 'b8000000-0000-0000-0000-0000000000a1', uc, perda, -100, 'B8' from b8;
select pg_temp.falha($$select public.est_mov_pedir(pg_temp.perda(50))$$, 'pedir aprovação com a regra desligada');

-- ligar: só o administrador
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha($$select public.est_aprov_salvar('e000000a-0000-0000-0000-000000000000', 500, '{PERDA}', '{admin,diretor,financeiro}')$$, 'financeiro mudando o limite');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select public.est_aprov_salvar('e000000a-0000-0000-0000-000000000000', 'NaN', '{PERDA}', '{admin}')$$, 'limite NaN');
select public.est_aprov_salvar(:E::uuid, 500, '{PERDA,AJ+,AJ-}', '{admin,diretor,financeiro}');

-- abaixo do limite entra direto; acima é barrado e vira pedido
select pg_temp.entrar(:CMP::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, documento) select :E::uuid, current_date, 'b8000000-0000-0000-0000-0000000000a1', uc, perda, -40, 'B8' from b8;
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, documento) select 'e000000a-0000-0000-0000-000000000000', current_date, 'b8000000-0000-0000-0000-0000000000a1', uc, perda, -60, 'B8' from b8$$, 'perda de R$ 600 acima do limite de R$ 500');
select pg_temp.falha($$select public.est_mov_pedir(pg_temp.perda(10))$$, 'pedido de algo que não precisa de aprovação');
select pg_temp.falha($$select public.est_mov_pedir(pg_temp.perda(5000))$$, 'pedido que não passaria nas regras (saldo insuficiente)');
select pg_temp.falha($$select public._est_aprov_registrar(pg_temp.perda(60))$$, 'gravar pedido sem passar pelo lançamento');
insert into _a select 'p', public.est_mov_pedir(pg_temp.perda(60));
reset role;
select pg_temp.ok((select situacao = 'pendente' and valor_estimado = 600 and pedido_por = :CMP::uuid from est_mov_aprovacoes where id = (select id from _a where k = 'p'))
  and (select quantidade = 860 from est_saldos where produto_id = 'b8000000-0000-0000-0000-0000000000a1'), 'pedido pendente de R$ 600, sem mexer no saldo (860)');

-- decidir
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.est_mov_decidir(%L, true)', (select id from _a where k = 'p')), 'compras aprovando');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.falha(format('select public.est_mov_decidir(%L, true)', (select id from _a where k = 'p')), 'outra empresa aprovando');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok(public.est_mov_decidir((select id from _a where k = 'p'), true) = 'aprovado', 'financeiro aprova');
select pg_temp.falha(format('select public.est_mov_decidir(%L, true)', (select id from _a where k = 'p')), 'aprovar duas vezes');
reset role;
select pg_temp.ok((select quantidade = 800 from est_saldos where produto_id = 'b8000000-0000-0000-0000-0000000000a1')
  and (select movimento_id is not null from est_mov_aprovacoes where id = (select id from _a where k = 'p')), 'aprovado: a perda entrou no Kardex (saldo 800)');

-- quem pediu não aprova; recusa com motivo; cancelar o próprio pedido
select pg_temp.entrar(:FIN::uuid);
insert into _a select 'p2', public.est_mov_pedir(pg_temp.perda(70));
select pg_temp.falha(format('select public.est_mov_decidir(%L, true)', (select id from _a where k = 'p2')), 'quem pediu aprovando o próprio');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.est_mov_decidir(%L, false)', (select id from _a where k = 'p2')), 'recusar sem motivo');
select pg_temp.ok(public.est_mov_decidir((select id from _a where k = 'p2'), false, 'Sem laudo da qualidade') = 'recusado', 'recusado com motivo');
select pg_temp.entrar(:CMP::uuid);
insert into _a select 'p3', public.est_mov_pedir(pg_temp.perda(55));
select public.est_mov_cancelar_pedido((select id from _a where k = 'p3'));
reset role;
select pg_temp.ok((select quantidade = 800 from est_saldos where produto_id = 'b8000000-0000-0000-0000-0000000000a1'), 'recusado e cancelado não mexem no saldo');
select pg_temp.entrar(:ADM::uuid);
select public.est_aprov_salvar(:E::uuid, null, '{PERDA,AJ+,AJ-}', '{admin,diretor,financeiro}');
reset role;
select pg_temp.ok((select count(*) = 0 from est_saldos s cross join lateral (select coalesce(sum(m.quantidade), 0) q, coalesce(sum(m.valor), 0) v from est_movimentos m
    where m.produto_id = s.produto_id and m.local_id = s.local_id and m.lote_id is not distinct from s.lote_id) x
  where s.empresa_id = :E::uuid and (s.quantidade <> x.q or s.valor <> x.v)), 'nenhuma divergência entre saldos e movimentos');
\o
\echo b8_estoque_aprovacao ok

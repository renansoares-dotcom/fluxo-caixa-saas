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
-- 179 — estoque, etapa B2: travas do lançamento à mão, estorno ligado à origem, inventário com movimento depois da contagem,
-- lote protegido, custo por RPC, verificação em duas etapas, parâmetros congelados, fechamento com posição, recálculo desde a data, limite do dia
\set B '''e000000b-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
update est_locais set papeis = null, permite_negativo = false where empresa_id = :E::uuid and codigo in ('MP', 'UC', 'DTE');
delete from est_fechamentos where empresa_id = :E::uuid;
update alm_requisicoes set criado_em = criado_em - interval '2 days' where empresa_id = :E::uuid;   -- as requisições dos outros testes não contam no limite do dia
update est_inv_config set aprovar_propria = true, apos_contagem = 'recontar', bloquear_movimento = false where empresa_id = :E::uuid;
insert into est_inv_config(empresa_id, aprovar_propria) values (:E::uuid, true) on conflict (empresa_id) do nothing;
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote) values
  ('b1000000-0000-0000-0000-0000000000a1', :E, 'B1-RES', 'RESINA B1', 'uso_consumo', 'KG', false),
  ('b1000000-0000-0000-0000-0000000000a2', :E, 'B1-TON', 'TONER B1', 'uso_consumo', 'UN', false),
  ('b1000000-0000-0000-0000-0000000000a3', :E, 'B1-INV', 'ITEM DE INVENTARIO B1', 'uso_consumo', 'UN', false),
  ('b1000000-0000-0000-0000-0000000000a4', :E, 'B1-REC', 'ITEM DE RECALCULO B1', 'uso_consumo', 'KG', false),
  ('b1000000-0000-0000-0000-0000000000a5', :E, 'B1-OUT', 'OUTRO ITEM B1', 'uso_consumo', 'KG', false);
insert into est_lotes(id, empresa_id, produto_id, codigo, bloqueado, bloqueio_motivo) values ('b1000000-0000-0000-0000-0000000000f1', :E, 'b1000000-0000-0000-0000-0000000000a5', 'B1-LOTE', true, 'reprovado na inspeção');
create temp view b1 as select
  (select id from est_locais where empresa_id = :E::uuid and codigo = 'MP') mp, (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC') uc,
  (select id from est_locais where empresa_id = :E::uuid and codigo = 'DTE') dte,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'PERDA') perda,
  (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'SI') si;
grant select on b1 to authenticated;
create temp table _g (k text primary key, id uuid, j jsonb); grant all on _g to authenticated;
create function pg_temp.compra(p_prod text, p_local text, p_qtd numeric, p_custo numeric, p_data date, p_doc text) returns uuid language sql as $$
  insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select 'e000000a-0000-0000-0000-000000000000', p_data, ('b1000000-0000-0000-0000-0000000000' || p_prod)::uuid, case p_local when 'mp' then mp else uc end, compra, p_qtd, p_custo, p_doc from b1 returning id $$;
grant execute on function pg_temp.compra(text, text, numeric, numeric, date, text) to authenticated;

-- ============================================================ 1. travas do lançamento à mão
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select public.est_travas_salvar('e000000a-0000-0000-0000-000000000000', 60, 50, true)$$, 'só o administrador altera as travas');
select pg_temp.entrar(:ADM::uuid);
select public.est_travas_salvar(:E::uuid, 60, 50, true);
reset role;
update membros set papel = 'producao' where empresa_id = :E::uuid and user_id = :LEI::uuid;
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha($$select pg_temp.compra('a1', 'mp', 100, 10, current_date, 'NF 1')$$, 'produção não lança compra à mão');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select pg_temp.compra('a1', 'mp', 100, 10, current_date + 400, 'NF 1')$$, 'compra com data futura');
select pg_temp.falha($$select pg_temp.compra('a1', 'mp', 100, 10, '1990-01-01', 'NF 1')$$, 'compra com data de 1990');
select pg_temp.falha($$select pg_temp.compra('a1', 'mp', 100, 10, current_date - 61, 'NF 1')$$, 'compra além dos 60 dias');
select pg_temp.falha($$select pg_temp.compra('a1', 'mp', 100, 10, current_date, null)$$, 'compra sem documento');
insert into _g(k, id) select 'c1', pg_temp.compra('a1', 'mp', 1000, 10, current_date - 30, 'NF 100');
select pg_temp.falha($$select pg_temp.compra('a1', 'mp', 1, 99999, current_date, 'NF 101')$$, 'custo fora da faixa por quem compra');
select pg_temp.falha($$select pg_temp.compra('a1', 'mp', 1, 0.01, current_date, 'NF 101')$$, 'custo de um centavo por quem compra');
select pg_temp.compra('a1', 'mp', 100, 14, current_date, 'NF 102');   -- 40 % acima: dentro da faixa
select pg_temp.entrar(:FIN::uuid);
select pg_temp.compra('a1', 'mp', 100, 30, current_date, 'NF 103');   -- fora da faixa, mas confirmado pelo financeiro
select pg_temp.entrar(:ADM::uuid);
select pg_temp.compra('a1', 'mp', 10, 12, current_date - 200, 'NF 090'); -- o administrador lança além do limite de dias
with x as (insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select :E::uuid, current_date - 10, 'b1000000-0000-0000-0000-0000000000a5', uc, si, 50, 5, 'INV INICIAL' from b1 returning id) insert into _g(k, id) select 'si', id from x;
reset role;
select pg_temp.ok((select quantidade = 1210 from est_custos where produto_id = 'b1000000-0000-0000-0000-0000000000a1'), 'só os 4 lançamentos válidos entraram');

-- ============================================================ 2. estorno
select pg_temp.entrar(:LEI::uuid);   -- produção
select pg_temp.falha(format('select public.est_estornar(%L, current_date, %L)', (select id from _g where k = 'si'), 'teste'), 'produção não estorna saldo inicial');
select pg_temp.falha(format('select public.est_estornar(%L, current_date, %L)', (select id from _g where k = 'c1'), 'teste'), 'produção não estorna compra');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.est_estornar(%L, current_date, null)', (select id from _g where k = 'c1')), 'estorno sem motivo');
select pg_temp.falha(format('select public.est_estornar(%L, current_date - 31, %L)', (select id from _g where k = 'c1'), 'teste'), 'estorno com data anterior ao movimento');
select pg_temp.falha(format('select public.est_estornar(%L, current_date + 3000, %L)', (select id from _g where k = 'c1'), 'teste'), 'estorno com data futura');
with x as (insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date, 'b1000000-0000-0000-0000-0000000000a1', mp, perda, -5 from b1 returning id) insert into _g(k, id) select 'p1', id from x;
insert into _g(k, id) select 'e1', public.est_estornar((select id from _g where k = 'p1'), current_date, 'perda lançada errada');
select pg_temp.falha(format('select public.est_estornar(%L, current_date, %L)', (select id from _g where k = 'e1'), 'voltar'), 'estorno de estorno');

-- saída de requisição: o estorno devolve a quantidade à requisição
select pg_temp.entrar(:ADM::uuid);
select public.alm_config_salvar(:E::uuid, 500, '{admin,diretor,compras}', '{}', '{admin,diretor}', '{}', false, true, null, true);
select pg_temp.entrar(:CMP::uuid);
select pg_temp.compra('a2', 'uc', 100, 30, current_date, 'NF 200');
insert into _g(k, j) select 'r1', public.alm_requisitar(:E::uuid, '[{"produto_id":"b1000000-0000-0000-0000-0000000000a2","quantidade":15}]'::jsonb, 'Toner da recepção');
select public.alm_entregar((select (j->>'id')::uuid from _g where k = 'r1'),
  (select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', 15, 'local_id', (select uc from b1))) from alm_requisicao_itens i where i.requisicao_id = (select (j->>'id')::uuid from _g where k = 'r1')),
  null, 'Fulano da Recepção', false, null, null);
select pg_temp.ok((select situacao = 'atendida' from alm_requisicoes where id = (select (j->>'id')::uuid from _g where k = 'r1')), 'requisição atendida 15/15');
select pg_temp.entrar(:LEI::uuid);   -- produção: movimenta estoque, mas não atende o almoxarifado
select pg_temp.falha(format('select public.est_estornar(%L, current_date, %L)', (select movimento_id from alm_entrega_itens e join alm_entregas n on n.id = e.entrega_id where n.requisicao_id = (select (j->>'id')::uuid from _g where k = 'r1')), 'teste'), 'só o almoxarifado estorna saída de requisição');
select pg_temp.entrar(:CMP::uuid);
select public.est_estornar((select movimento_id from alm_entrega_itens e join alm_entregas n on n.id = e.entrega_id where n.requisicao_id = (select (j->>'id')::uuid from _g where k = 'r1')), current_date, 'entregue por engano');
reset role;
select pg_temp.ok((select r.situacao = 'aberta' from alm_requisicoes r where r.id = (select (j->>'id')::uuid from _g where k = 'r1'))
  and (select qtd_entregue = 0 from alm_requisicao_itens where requisicao_id = (select (j->>'id')::uuid from _g where k = 'r1'))
  and (select estornado_em is not null and estornado_por = :CMP::uuid from alm_entrega_itens e join alm_entregas n on n.id = e.entrega_id where n.requisicao_id = (select (j->>'id')::uuid from _g where k = 'r1'))
  and (select quantidade = 100 from est_saldos where produto_id = 'b1000000-0000-0000-0000-0000000000a2'), 'estorno devolveu o material ao saldo e a requisição voltou a aberta, 0/15');

-- ============================================================ 9. limite da requisição vale para o dia
select pg_temp.entrar(:CMP::uuid);
insert into _g(k, j) select 'l1', public.alm_requisitar(:E::uuid, '[{"produto_id":"b1000000-0000-0000-0000-0000000000a2","quantidade":2}]'::jsonb, 'fatia 1');
select pg_temp.ok((select j->>'situacao' = 'aprovacao' and j->>'motivo_aprovacao' like '%pedidos do dia%' from _g where k = 'l1'), 'R$ 450 de antes + R$ 60: o dia passou de R$ 500 e o pedido pequeno vai para aprovação');
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, j) select 'l2', public.alm_requisitar(:E::uuid, '[{"produto_id":"b1000000-0000-0000-0000-0000000000a2","quantidade":2}]'::jsonb, 'outra pessoa');
select pg_temp.ok((select j->>'situacao' = 'aberta' from _g where k = 'l2'), 'o pedido de outra pessoa, dentro do limite, segue direto');

-- ============================================================ 3. inventário
select pg_temp.entrar(:CMP::uuid);
select pg_temp.compra('a3', 'uc', 100, 10, current_date, 'NF 300');
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, id) select 'inv', public.est_inv_gerar(:E::uuid, (select uc from b1), null, array['b1000000-0000-0000-0000-0000000000a3']::uuid[]);
select public.est_inv_contar(i.id, 90) from est_inv_itens i where contagem_id = (select id from _g where k = 'inv');
select public.est_inv_contar(i.id, 90, 'caixa aberta, faltam 10') from est_inv_itens i where contagem_id = (select id from _g where k = 'inv') and situacao = 'recontar';
select pg_sleep(0.05);
select pg_temp.entrar(:CMP::uuid);
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date, 'b1000000-0000-0000-0000-0000000000a3', uc, perda, -10 from b1;   -- saída depois da contagem
select pg_temp.entrar(:FIN::uuid);
select public.est_inv_enviar((select id from _g where k = 'inv'));
select pg_temp.ok(public.est_inv_aprovar((select id from _g where k = 'inv'), true) = -1, 'item movimentado depois de contado: a aprovação devolve para recontar');
select pg_temp.ok((select situacao = 'aberta' and motivo like '%depois da contagem%' from est_inv_contagens where id = (select id from _g where k = 'inv'))
  and (select situacao = 'recontar' from est_inv_itens where contagem_id = (select id from _g where k = 'inv')), 'contagem reaberta, item para recontar');
reset role;
select pg_temp.ok((select quantidade = 90 from est_saldos where produto_id = 'b1000000-0000-0000-0000-0000000000a3'), 'nenhum ajuste foi feito sobre o saldo velho');
select pg_temp.entrar(:FIN::uuid);
select public.est_inv_contar(i.id, 88, 'recontado depois da saída') from est_inv_itens i where contagem_id = (select id from _g where k = 'inv');
select public.est_inv_enviar((select id from _g where k = 'inv'));
select pg_temp.ok(public.est_inv_aprovar((select id from _g where k = 'inv'), true) = 1, 'recontado: aprova e ajusta');
reset role;
select pg_temp.ok((select quantidade = 88 from est_saldos where produto_id = 'b1000000-0000-0000-0000-0000000000a3'), 'saldo igual ao físico recontado (88)');
-- bloqueio do item em contagem
update est_inv_config set bloquear_movimento = true where empresa_id = :E::uuid;
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, id) select 'inv2', public.est_inv_gerar(:E::uuid, (select uc from b1), null, array['b1000000-0000-0000-0000-0000000000a3']::uuid[]);
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select 'e000000a-0000-0000-0000-000000000000', current_date, 'b1000000-0000-0000-0000-0000000000a3', uc, perda, -1 from b1$$, 'item em contagem com o bloqueio ligado');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date, 'b1000000-0000-0000-0000-0000000000a2', uc, perda, -1 from b1;   -- outro item do mesmo local segue livre
select pg_temp.entrar(:FIN::uuid);
select public.est_inv_contar(i.id, 80) from est_inv_itens i where contagem_id = (select id from _g where k = 'inv2');
select public.est_inv_contar(i.id, 80, 'falta confirmada') from est_inv_itens i where contagem_id = (select id from _g where k = 'inv2') and situacao = 'recontar';
select public.est_inv_enviar((select id from _g where k = 'inv2'));
select pg_temp.ok(public.est_inv_aprovar((select id from _g where k = 'inv2'), true) = 1, 'o ajuste da própria contagem passa pelo bloqueio');
reset role;
select pg_temp.ok((select quantidade = 80 from est_saldos where produto_id = 'b1000000-0000-0000-0000-0000000000a3'), 'saldo ajustado para 80');
update est_inv_config set bloquear_movimento = false where empresa_id = :E::uuid;

-- ============================================================ 4. lote protegido
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$update est_lotes set bloqueado = false where id = 'b1000000-0000-0000-0000-0000000000f1'$$, 'liberar lote bloqueado pela qualidade');
select pg_temp.falha($$update est_lotes set produto_id = 'b1000000-0000-0000-0000-0000000000a1' where id = 'b1000000-0000-0000-0000-0000000000f1'$$, 'trocar o produto do lote');
update est_lotes set lote_fornecedor = 'BRK 123' where id = 'b1000000-0000-0000-0000-0000000000f1';
reset role;
select pg_temp.ok((select bloqueado and produto_id = 'b1000000-0000-0000-0000-0000000000a5' and lote_fornecedor = 'BRK 123' from est_lotes where id = 'b1000000-0000-0000-0000-0000000000f1')
  and (select count(*) = 1 from auditoria where tabela = 'est_lotes' and registro_id = 'b1000000-0000-0000-0000-0000000000f1'), 'lote continua bloqueado; a mudança permitida ficou na auditoria');

-- ============================================================ 5. custo por consulta interna e verificação em duas etapas
update membros set papel = 'motorista' where empresa_id = :E::uuid and user_id = :LEI::uuid;
select pg_temp.entrar(:LEI::uuid);
create temp table _v (k text, ok boolean); grant all on _v to authenticated;
do $$ declare f text; n int; begin
  foreach f in array array['est_reposicao', 'est_inv_abc', 'est_implantacao_situacao'] loop
    begin
      execute format('select count(*) from public.%I(%L)', f, 'e000000a-0000-0000-0000-000000000000') into n;
      insert into _v values (f, n = 0);   -- a curva ABC não dá erro: devolve vazio
    exception when others then insert into _v values (f, true); end;
  end loop;
end $$;
select pg_temp.ok((select count(*) = 3 and bool_and(ok) from _v), 'motorista não consulta reposição, curva ABC nem situação da implantação');
select pg_temp.ok((select count(*) = 0 from est_inv_itens) and (select count(*) = 0 from est_inv_contagens), 'motorista não lê itens de inventário (têm saldo e custo)');
reset role;
update membros set papel = 'leitura' where empresa_id = :E::uuid and user_id = :LEI::uuid;
update empresas set mfa_obrigatorio = true where id = :E::uuid;
select pg_temp.entrar(:ADM::uuid);   -- administrador sem a segunda etapa (aal1)
select pg_temp.ok((select count(*) = 0 from est_custos) and (select count(*) = 0 from est_movimentos), 'sem a verificação em duas etapas, não lê custo nem movimentos');
select pg_temp.falha(format('select public.est_estornar(%L, current_date, %L)', (select id from _g where k = 'c1'), 'teste'), 'sem a verificação em duas etapas, não estorna');
select pg_temp.falha($$select public.est_transferir('e000000a-0000-0000-0000-000000000000', current_date, 'b1000000-0000-0000-0000-0000000000a1', (select mp from b1), (select uc from b1), 1)$$, 'sem a verificação em duas etapas, não transfere');
select pg_temp.falha($$select public.alm_requisitar('e000000a-0000-0000-0000-000000000000', '[{"produto_id":"b1000000-0000-0000-0000-0000000000a2","quantidade":1}]'::jsonb, 'x')$$, 'sem a verificação em duas etapas, não requisita');
select set_config('request.jwt.claims', json_build_object('sub', :ADM, 'role', 'authenticated', 'email', 'u@t.com', 'aal', 'aal2')::text, false);
select pg_temp.ok((select count(*) > 0 from est_custos), 'com a segunda etapa, lê');
reset role;
update empresas set mfa_obrigatorio = false where id = :E::uuid;

-- ============================================================ 6. parâmetros congelados e transferência
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha($$update est_tipos_movimento set sentido = 'S' where id = (select compra from b1)$$, 'inverter o sentido de um tipo com movimentos');
select pg_temp.falha($$update est_tipos_movimento set afeta_custo = false where id = (select compra from b1)$$, 'tirar "forma custo" de um tipo com movimentos');
select pg_temp.falha($$delete from est_tipos_movimento where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'AMOSTRA'$$, 'excluir tipo do sistema');
select pg_temp.falha($$update est_locais set compoe_custo = false where id = (select mp from b1)$$, 'local com movimentos deixa de compor custo');
update est_tipos_movimento set nome = 'Compra de material' where id = (select compra from b1);   -- o que não é estrutural continua editável
update est_tipos_movimento set nome = 'Compra' where id = (select compra from b1);
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select public.est_transferir('e000000a-0000-0000-0000-000000000000', current_date, 'b1000000-0000-0000-0000-0000000000a1', (select mp from b1), (select dte from b1), 7)$$, 'transferir para local que não compõe custo');
select pg_temp.falha($$select public.est_transferir('e000000a-0000-0000-0000-000000000000', current_date + 5, 'b1000000-0000-0000-0000-0000000000a1', (select mp from b1), (select uc from b1), 7)$$, 'transferência com data futura');

-- ============================================================ 7. fechamento
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha($$select public.est_fechar_mes('e000000a-0000-0000-0000-000000000000', (current_date + interval '5 years')::date)$$, 'fechar mês futuro');
select public.est_fechar_mes(:E::uuid, (date_trunc('month', current_date) - interval '1 month')::date);
reset role;
select pg_temp.ok((select count(*) > 0 from est_fechamento_saldos where empresa_id = :E::uuid and mes = (date_trunc('month', current_date) - interval '1 month')::date)
  and (select coalesce(sum(f.quantidade), 0) from est_fechamento_saldos f where f.empresa_id = :E::uuid and f.produto_id = 'b1000000-0000-0000-0000-0000000000a1')
      = (select coalesce(sum(m.quantidade), 0) from est_movimentos m where m.produto_id = 'b1000000-0000-0000-0000-0000000000a1' and m.data < date_trunc('month', current_date)::date)
  and (select coalesce(sum(f.valor), 0) from est_fechamento_saldos f where f.empresa_id = :E::uuid and f.produto_id = 'b1000000-0000-0000-0000-0000000000a1')
      = (select coalesce(sum(m.valor), 0) from est_movimentos m where m.produto_id = 'b1000000-0000-0000-0000-0000000000a1' and m.data < date_trunc('month', current_date)::date),
  'a posição do fim do mês ficou guardada e bate com os movimentos até o último dia');
select pg_temp.ok((select count(*) >= 1 from auditoria where tabela = 'est_fechamentos' and empresa_id = :E::uuid and acao = 'incluiu'), 'fechamento na trilha de auditoria');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.ok((select count(*) > 0 from est_fechamento_saldos), 'quem consulta o estoque lê a posição do fechamento');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.ok((select count(*) = 0 from est_fechamento_saldos where empresa_id = :E::uuid), 'outra empresa não lê');
select pg_temp.entrar(:ADM::uuid);
select public.est_fechar_mes(:E::uuid, (date_trunc('month', current_date) - interval '1 month')::date, true);
reset role;
select pg_temp.ok((select count(*) = 0 from est_fechamento_saldos where empresa_id = :E::uuid and mes >= (date_trunc('month', current_date) - interval '1 month')::date) and (select count(*) >= 1 from auditoria where tabela = 'est_fechamentos' and empresa_id = :E::uuid and acao = 'excluiu'), 'reabrir apaga a posição e também fica na trilha');

-- ============================================================ 8. recálculo a partir da data do movimento
select pg_temp.entrar(:ADM::uuid);
select public.est_travas_salvar(:E::uuid, null, null, false);
select pg_temp.compra('a4', 'mp', 100, 10, current_date - 50, 'NF 1');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date - 45, 'b1000000-0000-0000-0000-0000000000a4', mp, perda, -40 from b1;
select pg_temp.compra('a4', 'mp', 100, 20, current_date - 30, 'NF 2');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date - 20, 'b1000000-0000-0000-0000-0000000000a4', mp, perda, -50 from b1;
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade) select :E::uuid, current_date - 10, 'b1000000-0000-0000-0000-0000000000a4', mp, perda, -30 from b1;
reset role;
create temp table _antes as select id, custo_unitario, valor, custo_medio_apos, saldo_local_apos, xmin::text x from est_movimentos where produto_id = 'b1000000-0000-0000-0000-0000000000a4';
select pg_temp.entrar(:ADM::uuid);
select pg_temp.compra('a4', 'mp', 60, 40, current_date - 25, 'NF 3');   -- data entre a 2ª compra e a 2ª saída
reset role;
select pg_temp.ok((select count(*) = 0 from _antes a join est_movimentos m using (id) where m.data < current_date - 25 and m.xmin::text <> a.x), 'o que veio antes da data do movimento não foi regravado');
select pg_temp.ok((select count(*) = 2 from _antes a join est_movimentos m using (id) where m.data > current_date - 25 and m.xmin::text <> a.x and m.custo_unitario <> a.custo_unitario), 'as duas saídas posteriores foram recalculadas');
create temp table _inc as select jsonb_build_object('c', (select jsonb_build_object('q', quantidade, 'v', valor, 'cm', round(custo_medio, 6)) from est_custos where produto_id = 'b1000000-0000-0000-0000-0000000000a4'),
  's', (select jsonb_agg(jsonb_build_object('q', quantidade, 'v', valor) order by local_id) from est_saldos where produto_id = 'b1000000-0000-0000-0000-0000000000a4'),
  'm', (select jsonb_agg(jsonb_build_object('cu', round(custo_unitario, 6), 'v', valor, 'cm', round(custo_medio_apos, 6), 's', saldo_local_apos) order by data, criado_em) from est_movimentos where produto_id = 'b1000000-0000-0000-0000-0000000000a4')) j;
select public._est_recalc(:E::uuid, 'b1000000-0000-0000-0000-0000000000a4', null);   -- recálculo completo, para comparar
select pg_temp.ok((select j from _inc) = jsonb_build_object('c', (select jsonb_build_object('q', quantidade, 'v', valor, 'cm', round(custo_medio, 6)) from est_custos where produto_id = 'b1000000-0000-0000-0000-0000000000a4'),
  's', (select jsonb_agg(jsonb_build_object('q', quantidade, 'v', valor) order by local_id) from est_saldos where produto_id = 'b1000000-0000-0000-0000-0000000000a4'),
  'm', (select jsonb_agg(jsonb_build_object('cu', round(custo_unitario, 6), 'v', valor, 'cm', round(custo_medio_apos, 6), 's', saldo_local_apos) order by data, criado_em) from est_movimentos where produto_id = 'b1000000-0000-0000-0000-0000000000a4')),
  'recálculo desde a data = recálculo completo (custo, saldos e cada linha)');
select pg_temp.ok((select quantidade = 140 and valor = (select sum(valor) from est_movimentos where produto_id = 'b1000000-0000-0000-0000-0000000000a4') from est_custos where produto_id = 'b1000000-0000-0000-0000-0000000000a4'), 'saldo 140 e valor = soma dos movimentos');

-- conferência geral: saldo de cada produto e local = soma dos movimentos
select pg_temp.ok((select count(*) = 0 from est_saldos s cross join lateral (select coalesce(sum(m.quantidade), 0) q, coalesce(sum(m.valor), 0) v from est_movimentos m
    where m.produto_id = s.produto_id and m.local_id = s.local_id and m.lote_id is not distinct from s.lote_id) x
  where s.empresa_id = :E::uuid and (s.quantidade <> x.q or s.valor <> x.v)), 'nenhuma divergência entre saldos e movimentos na empresa');
-- as travas voltam a ficar desligadas para os testes de datas fixas
update est_config set dias_retroativos = null, custo_desvio_pct = null, exigir_documento = false where empresa_id = :E::uuid;
\o
\echo b1_estoque_etapa_b2 ok

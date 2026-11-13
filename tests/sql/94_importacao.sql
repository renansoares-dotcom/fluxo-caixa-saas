-- Importação de Matéria-Prima (SQL 158): permissões, processo e etapas, câmbio e despesas com título no financeiro,
-- custo final rateado por valor e por peso, variação cambial, recebimento com entrada no estoque, cotações e travas.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'admin.a@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
-- saldo de uma conta: entradas − saídas dos lançamentos pagos, com a transferência única contando nas duas pontas
grant execute on all functions in schema pg_temp to authenticated, anon;
\set E '''e000000a-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set BANCO '''c000000a-0000-0000-0000-000000000000'''
\set P1 '''1a000000-0000-0000-0000-000000000001'''

select _est_configurar(:E);
insert into plano_contas(id, empresa_id, codigo, nome, tipo, natureza, nivel)
select v.id::uuid, :E, v.codigo, v.nome, 'S', 'D', 2
  from (values ('f94a0000-0000-0000-0000-000000000001', '2.01.90', 'MATÉRIA-PRIMA IMPORTADA'), ('f94a0000-0000-0000-0000-000000000002', '2.01.91', 'IMPOSTOS DE IMPORTAÇÃO'),
               ('f94a0000-0000-0000-0000-000000000003', '2.01.92', 'DESPESAS DE IMPORTAÇÃO')) v(id, codigo, nome)
 where not exists (select 1 from plano_contas p where p.empresa_id = :E and p.codigo = v.codigo);
insert into favorecidos(id, empresa_id, nome) values ('ef940000-0000-0000-0000-000000000001', :E, 'EXPORTADOR EXEMPLO PETROCHEM LLC'), ('ef940000-0000-0000-0000-000000000002', :E, 'DESPACHANTE EXEMPLO');
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote) values
  ('d9400000-0000-0000-0000-000000000001', :E, 'MP-IMP-01', 'RESINA PEBD IMPORTADA', 'materia_prima', 'KG', true),
  ('d9400000-0000-0000-0000-000000000002', :E, 'MP-IMP-02', 'MASTERBATCH BRANCO IMPORTADO', 'aditivo', 'KG', false);

-- ---------- permissões e parâmetros ----------
select pg_temp.entrar(:LEI);
select pg_temp.ok(not imp_pode(:E), 'leitura não opera a importação');
select pg_temp.falha($q$insert into imp_processos(empresa_id, favorecido_id) values ('e000000a-0000-0000-0000-000000000000', 'ef940000-0000-0000-0000-000000000001')$q$, 'leitura não cria processo');
select pg_temp.entrar(:FIN);
select pg_temp.ok(imp_pode(:E), 'financeiro opera por padrão');
select pg_temp.falha($q$insert into imp_config(empresa_id) values ('e000000a-0000-0000-0000-000000000000')$q$, 'financeiro não grava os parâmetros');
select pg_temp.entrar(:CMP);
select pg_temp.ok(imp_pode(:E), 'compras opera por padrão');
select pg_temp.entrar(:ADM);
insert into imp_config(empresa_id, plano_mercadoria_id, plano_impostos_id, plano_despesas_id, free_time_padrao)
values (:E, 'f94a0000-0000-0000-0000-000000000001', 'f94a0000-0000-0000-0000-000000000002', 'f94a0000-0000-0000-0000-000000000003', 10);

-- ---------- processo, itens e etapas ----------
select pg_temp.entrar(:CMP);
select pg_temp.falha($q$insert into imp_processos(empresa_id, favorecido_id) values ('e000000a-0000-0000-0000-000000000000', gen_random_uuid())$q$, 'exportador de outra empresa');
insert into imp_processos(id, empresa_id, favorecido_id, referencia, moeda, taxa_prevista, incoterm, chegada_prevista) values (:P1, :E, 'ef940000-0000-0000-0000-000000000001', 'PO-7781', 'USD', 5.2, 'FOB', '2026-12-05');
select pg_temp.ok((select numero = 1 and status = 'negociacao' and free_time_dias = 10 from imp_processos where id = :P1), 'número sequencial, etapa inicial e dias livres dos parâmetros');
select pg_temp.ok((select count(*) = 1 from imp_eventos where processo_id = :P1 and etapa = 'negociacao'), 'abertura no histórico');
insert into imp_itens(id, empresa_id, processo_id, produto_id, descricao, ncm, quantidade, valor_unitario, ordem) values
  ('1b000000-0000-0000-0000-000000000001', :E, :P1, 'd9400000-0000-0000-0000-000000000001', 'RESINA PEBD', '39011010', 20000, 1.20, 1),
  ('1b000000-0000-0000-0000-000000000002', :E, :P1, 'd9400000-0000-0000-0000-000000000002', 'MASTERBATCH BRANCO', '32061910', 5000, 2.00, 2);
update imp_processos set status = 'pedido' where id = :P1;
update imp_processos set status = 'embarcado', data_embarque = '2026-11-20' where id = :P1;
update imp_processos set status = 'chegada', data_chegada = '2026-12-07' where id = :P1;
select pg_temp.ok((select data_pedido = current_date and data_embarque = '2026-11-20' and data_devolucao_container = '2026-12-17' from imp_processos where id = :P1), 'datas das etapas e prazo de devolução do contêiner');
select pg_temp.ok((select count(*) = 4 from imp_eventos where processo_id = :P1), 'cada etapa no histórico');
reset role;
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'importacao' and user_id = 'a0000000-0000-0000-0000-00000000000a'), 'mudança de etapa avisa a equipe');
select pg_temp.falha($q$update imp_processos set status = 'cancelado' where id = '1a000000-0000-0000-0000-000000000001'$q$, 'cancelar exige motivo');

-- ---------- câmbio: previsão, contratação e liquidação com título no financeiro ----------
select pg_temp.entrar(:FIN);
insert into imp_cambios(id, empresa_id, processo_id, tipo, valor_moeda, vencimento) values ('1c000000-0000-0000-0000-000000000001', :E, :P1, 'adiantamento', 10200, '2026-12-01');
select pg_temp.ok((select l.status = 'Em aberto' and l.valor = 53040 and l.data = '2026-12-01' and l.origem = 'importacao' and l.plano_id = 'f94a0000-0000-0000-0000-000000000001'
                     from imp_cambios c join lancamentos l on l.id = c.lancamento_id where c.id = '1c000000-0000-0000-0000-000000000001'), 'câmbio previsto vira título pela taxa prevista');
select pg_temp.falha($q$update imp_cambios set status = 'contratado' where id = '1c000000-0000-0000-0000-000000000001'$q$, 'contratar exige taxa e data');
update imp_cambios set status = 'contratado', taxa = 4.9, data_contratacao = '2026-11-28', contrato = 'CC-001' where id = '1c000000-0000-0000-0000-000000000001';
select pg_temp.ok((select l.valor = 49980 and l.status = 'Em aberto' from imp_cambios c join lancamentos l on l.id = c.lancamento_id where c.id = '1c000000-0000-0000-0000-000000000001'), 'contratação ajusta o título pela taxa contratada');
update imp_cambios set status = 'liquidado', data_liquidacao = '2026-12-01', conta_id = :BANCO where id = '1c000000-0000-0000-0000-000000000001';
select pg_temp.ok((select c.valor_brl = 49980 and l.status = 'Pago' and l.conta_id = 'c000000a-0000-0000-0000-000000000000' and l.data = '2026-12-01'
                     from imp_cambios c join lancamentos l on l.id = c.lancamento_id where c.id = '1c000000-0000-0000-0000-000000000001'), 'liquidação baixa o título na conta');
select pg_temp.falha($q$delete from imp_cambios where id = '1c000000-0000-0000-0000-000000000001'$q$, 'câmbio liquidado não é excluído');
insert into imp_cambios(id, empresa_id, processo_id, tipo, valor_moeda, vencimento, status, taxa, data_contratacao, data_liquidacao, conta_id)
values ('1c000000-0000-0000-0000-000000000002', :E, :P1, 'saldo', 23800, '2026-12-15', 'liquidado', 5.1, '2026-12-10', '2026-12-15', :BANCO);
select pg_temp.ok((select valor_brl = 121380 from imp_cambios where id = '1c000000-0000-0000-0000-000000000002'), 'valor em reais calculado na liquidação');

-- ---------- despesas: imposto recuperável fora do custo, título por categoria ----------
update imp_processos set status = 'registro', taxa_di = 5.0, declaracao = '26/1234567-8', canal = 'verde' where id = :P1;
insert into imp_despesas(empresa_id, processo_id, categoria, valor, vencimento, item_id, descricao) values
  (:E, :P1, 'frete_internacional', 8500, '2026-12-08', null, null), (:E, :P1, 'seguro', 340, '2026-12-08', null, null),
  (:E, :P1, 'ii', 12000, '2026-12-08', null, null), (:E, :P1, 'icms', 30000, '2026-12-08', null, null),
  (:E, :P1, 'siscomex', 154.23, '2026-12-08', null, null), (:E, :P1, 'despachante', 1500, '2026-12-12', null, null),
  (:E, :P1, 'bancaria', 200, '2026-12-01', null, 'tarifa do contrato'), (:E, :P1, 'armazenagem', 500, '2026-12-12', '1b000000-0000-0000-0000-000000000002', 'só o master');
select pg_temp.ok((select not compoe_custo from imp_despesas where processo_id = :P1 and categoria = 'icms') and (select not compoe_custo from imp_despesas where processo_id = :P1 and categoria = 'bancaria')
                  and (select compoe_custo from imp_despesas where processo_id = :P1 and categoria = 'ii'), 'ICMS recuperável e despesa bancária nascem fora do custo; II entra');
select pg_temp.ok((select l.plano_id = 'f94a0000-0000-0000-0000-000000000002' and l.status = 'Em aberto' and l.valor = 12000 from imp_despesas d join lancamentos l on l.id = d.lancamento_id where d.processo_id = :P1 and d.categoria = 'ii')
              and (select l.plano_id = 'f94a0000-0000-0000-0000-000000000003' from imp_despesas d join lancamentos l on l.id = d.lancamento_id where d.processo_id = :P1 and d.categoria = 'despachante'), 'despesa vira título na conta da categoria');
update imp_despesas set pago = true, data_pagamento = '2026-12-08', conta_id = :BANCO where processo_id = :P1 and categoria = 'ii';
select pg_temp.ok((select l.status = 'Pago' and l.conta_id is not null from imp_despesas d join lancamentos l on l.id = d.lancamento_id where d.processo_id = :P1 and d.categoria = 'ii'), 'pagamento da despesa baixa o título');
select pg_temp.falha($q$insert into imp_despesas(empresa_id, processo_id, categoria, valor, item_id) values ('e000000a-0000-0000-0000-000000000000', '1a000000-0000-0000-0000-000000000001', 'outras', 1, gen_random_uuid())$q$, 'item de outro processo');

-- ---------- custo final ----------
select imp_custo(:P1) as "C" \gset
select pg_temp.ok((:'C'::jsonb ->> 'taxa')::numeric = 5 and :'C'::jsonb ->> 'taxa_origem' = 'declaracao' and (:'C'::jsonb ->> 'fob_brl')::numeric = 170000, 'mercadoria pela taxa da declaração');
select pg_temp.ok((:'C'::jsonb ->> 'despesas_custo')::numeric = 22994.23 and (:'C'::jsonb ->> 'despesas_fora')::numeric = 30200 and (:'C'::jsonb ->> 'impostos_recuperaveis')::numeric = 30000, 'despesas dentro e fora do custo');
select pg_temp.ok((:'C'::jsonb -> 'itens' -> 0 ->> 'custo_total')::numeric = 135878.28 and (:'C'::jsonb -> 'itens' -> 0 ->> 'custo_unitario')::numeric = 6.793914, 'rateio por valor: resina');
select pg_temp.ok((:'C'::jsonb -> 'itens' -> 1 ->> 'custo_total')::numeric = 57115.95 and (:'C'::jsonb ->> 'custo_total')::numeric = 192994.23, 'despesa direta no item e total do processo');
select pg_temp.ok((:'C'::jsonb ->> 'variacao_cambial')::numeric = 1360, 'variação cambial fora do custo');
update imp_processos set rateio = 'peso' where id = :P1;
select pg_temp.ok((imp_custo(:P1) -> 'itens' -> 0 ->> 'despesas')::numeric = 17995.38, 'rateio por peso');
update imp_processos set rateio = null where id = :P1;
select pg_temp.entrar(:LEI);
select pg_temp.ok(imp_custo(:P1) is not null, 'leitura consulta o custo');

-- ---------- recebimento com entrada no estoque ----------
select pg_temp.entrar(:CMP);
select pg_temp.falha($q$select imp_receber('1a000000-0000-0000-0000-000000000001', '2026-12-16', '[{"item_id":"1b000000-0000-0000-0000-000000000001","quantidade":20000}]')$q$, 'só recebe depois do desembaraço');
update imp_processos set status = 'desembaracado', data_desembaraco = '2026-12-14' where id = :P1;
select imp_receber(:P1, '2026-12-16', '[{"item_id":"1b000000-0000-0000-0000-000000000001","quantidade":20000,"lote":"LT-778"}]') as "R1" \gset
select pg_temp.ok((:'R1'::jsonb ->> 'movimentos')::int = 1 and (:'R1'::jsonb ->> 'faltam')::int = 1, 'recebimento parcial');
select pg_temp.ok((select status = 'desembaracado' from imp_processos where id = :P1), 'parcial não muda a etapa');
select pg_temp.ok((select m.quantidade = 20000 and m.valor = 135878.28 and m.documento = 'IMP 1' and m.lote_id is not null from est_movimentos m where m.produto_id = 'd9400000-0000-0000-0000-000000000001'), 'entrada no estoque com o custo final e o lote');
select pg_temp.ok((select round(custo_medio, 4) = 6.7939 from est_custos where produto_id = 'd9400000-0000-0000-0000-000000000001'), 'custo médio do produto');
select imp_receber(:P1, '2026-12-17', '[{"item_id":"1b000000-0000-0000-0000-000000000002","quantidade":5000}]', false) as "R2" \gset
select pg_temp.ok((:'R2'::jsonb ->> 'registrados')::int = 1 and (:'R2'::jsonb ->> 'faltam')::int = 0, 'recebimento sem movimentar o estoque');
select pg_temp.ok((select status = 'recebido' and data_recebimento = '2026-12-17' from imp_processos where id = :P1) and (select custo_unitario = 11.42319 from imp_itens where id = '1b000000-0000-0000-0000-000000000002'), 'tudo recebido muda a etapa e grava o custo do item');
select pg_temp.entrar(:LEI);
select pg_temp.falha($q$select imp_receber('1a000000-0000-0000-0000-000000000001', '2026-12-17', '[{"item_id":"1b000000-0000-0000-0000-000000000002","quantidade":1}]')$q$, 'leitura não recebe');

-- ---------- encerramento, travas e exclusão ----------
select pg_temp.entrar(:FIN);
update imp_processos set status = 'encerrado' where id = :P1;
select pg_temp.falha($q$insert into imp_despesas(empresa_id, processo_id, categoria, valor) values ('e000000a-0000-0000-0000-000000000000', '1a000000-0000-0000-0000-000000000001', 'outras', 10)$q$, 'processo encerrado não recebe despesa');
select pg_temp.falha($q$update imp_processos set observacao = 'x' where id = '1a000000-0000-0000-0000-000000000001'$q$, 'processo encerrado não é alterado');
select pg_temp.falha($q$delete from imp_processos where id = '1a000000-0000-0000-0000-000000000001'$q$, 'processo com pagamento não é excluído');
update imp_processos set status = 'recebido' where id = :P1;
select pg_temp.ok((select status = 'recebido' from imp_processos where id = :P1), 'reabrir volta a etapa');
insert into imp_processos(id, empresa_id, favorecido_id) values ('1a000000-0000-0000-0000-000000000002', :E, 'ef940000-0000-0000-0000-000000000001');
insert into imp_cambios(empresa_id, processo_id, valor_moeda, vencimento) values (:E, '1a000000-0000-0000-0000-000000000002', 1000, '2026-12-20');
select pg_temp.ok((select numero = 2 from imp_processos where id = '1a000000-0000-0000-0000-000000000002') and (select lancamento_id is null from imp_cambios where processo_id = '1a000000-0000-0000-0000-000000000002'), 'sem taxa conhecida não nasce título');

-- ---------- cotações ----------
select pg_temp.ok(imp_ptax_gravar(:E, '[{"moeda":"USD","data":"2026-11-12","compra":5.4012,"venda":5.4018,"fonte":"Banco Central"},{"moeda":"usd","data":"2026-11-12","venda":1}]') = 1, 'grava só a cotação válida');
update imp_cambios set observacao = 'com cotação' where processo_id = '1a000000-0000-0000-0000-000000000002';
select pg_temp.ok((select l.valor = 5401.80 from imp_cambios c join lancamentos l on l.id = c.lancamento_id where c.processo_id = '1a000000-0000-0000-0000-000000000002'), 'título previsto pela última cotação');
delete from imp_processos where id = '1a000000-0000-0000-0000-000000000002';
select pg_temp.ok((select count(*) = 0 from lancamentos where descricao like 'IMP 2 %'), 'excluir o processo sem pagamento leva o título em aberto');
select pg_temp.entrar(:LEI);
select pg_temp.falha($q$select imp_ptax_gravar('e000000a-0000-0000-0000-000000000000', '[{"moeda":"USD","data":"2026-11-10","venda":5}]')$q$, 'leitura não grava cotação');
reset role;
select pg_temp.ok((select count(*) from auditoria where tabela = 'imp_processos') > 0, 'auditoria gravada');

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
-- 186 — recebimento conferido: a nota de compra entra pela chegada, com a quantidade conferida, ao custo da nota
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
update est_locais set papeis = null where empresa_id = :E::uuid and codigo = 'UC';
delete from est_fechamentos where empresa_id = :E::uuid; delete from est_fechamento_saldos where empresa_id = :E::uuid;
insert into alm_config (empresa_id, papeis_almoxarife, papeis_aprovador) values (:E, '{admin,diretor,compras}', '{admin,diretor}') on conflict (empresa_id) do update set papeis_almoxarife = '{admin,diretor,compras}';
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, local_padrao_id) values
  ('b6000000-0000-0000-0000-0000000000a1', :E, 'B6-RES', 'RESINA B6', 'uso_consumo', 'KG', (select id from est_locais where empresa_id = :E::uuid and codigo = 'UC'));
insert into produto_fornecedores(empresa_id, produto_id, emit_doc, codigo_fornecedor, fator) values (:E, 'b6000000-0000-0000-0000-0000000000a1', '66555444000133', 'SC-RES', 25);
create temp table _r (k text primary key, id uuid, j jsonb); grant all on _r to authenticated;
create function pg_temp.nota(p_id text, p_num int, p_emissao date, p_qtd numeric, p_valor numeric) returns void language sql as $$
  insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc, emit_nome, v_nf)
  values (('b6000000-0000-0000-0000-0000000000' || p_id)::uuid, 'e000000a-0000-0000-0000-000000000000', 'B6-' || p_num, p_num, p_emissao, 'entrada', false, 'autorizada', '66555444000133', 'FORNECEDOR B6', p_valor + 1);
  insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, xprod, ucom, cfop, qcom, vprod, vuncom) values
    (('b6000000-0000-0000-0000-0000000001' || p_id)::uuid, 'e000000a-0000-0000-0000-000000000000', ('b6000000-0000-0000-0000-0000000000' || p_id)::uuid, 1, 'SC-RES', 'RESINA SACO 25 KG', 'SC', '5101', p_qtd, p_valor, p_valor / p_qtd),
    (('b6000000-0000-0000-0000-0000000002' || p_id)::uuid, 'e000000a-0000-0000-0000-000000000000', ('b6000000-0000-0000-0000-0000000000' || p_id)::uuid, 2, 'SEM-DEPARA', 'ITEM SEM DE-PARA', 'UN', '5101', 2, 1, 0.5);
$$;

-- desligado: nada muda (nota antiga entra pela emissão)
select pg_temp.nota('c1', 9101, current_date - 10, 2, 500);
select pg_temp.entrar(:ADM::uuid);
select pg_temp.ok(public.est_processar_item('b6000000-0000-0000-0000-0000000001c1') = 'ok', 'recebimento desligado: entra pela emissão');
reset role;
select pg_temp.ok((select data = current_date - 10 and quantidade = 50 from est_movimentos where nfe_item_id = 'b6000000-0000-0000-0000-0000000001c1'), 'na data de emissão, 2 sacos × 25 = 50 kg');

-- ligar: só o administrador
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha($$select public.est_receb_salvar('e000000a-0000-0000-0000-000000000000', true, true, 0.5)$$, 'financeiro mudando a entrada das notas');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha($$select public.est_receb_salvar('e000000a-0000-0000-0000-000000000000', true, true, 'NaN')$$, 'tolerância NaN');
select public.est_receb_salvar(:E::uuid, true, true, 0.5, current_date - 5);
reset role;

-- nota emitida antes do início continua pela emissão; a nova fica a receber
select pg_temp.nota('c2', 9102, current_date - 8, 2, 500);
select pg_temp.nota('c3', 9103, current_date - 3, 4, 1000);
select pg_temp.entrar(:ADM::uuid);
select pg_temp.ok(public.est_processar_item('b6000000-0000-0000-0000-0000000001c2') = 'ok', 'nota de antes do início: entra pela emissão');
select pg_temp.ok(public.est_processar_item('b6000000-0000-0000-0000-0000000001c3') = 'a_receber', 'nota nova: fica a receber, sem movimento');
reset role;
select pg_temp.ok(not exists (select 1 from est_movimentos where nfe_item_id = 'b6000000-0000-0000-0000-0000000001c3'), 'nenhum movimento antes da conferência');

-- quem confere: quem atende o almoxarifado; a conferência é cega
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha($$select * from public.est_receb_fila('e000000a-0000-0000-0000-000000000000')$$, 'leitura vendo a fila do recebimento');
select pg_temp.falha($$select public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c3')$$, 'leitura conferindo');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.falha($$select public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c3')$$, 'outra empresa conferindo');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c3')$$, 'perfil Compras conferindo sem estar nomeado entre os almoxarifes');
reset role;
update alm_config set almoxarifes = array[:CMP::uuid] where empresa_id = :E::uuid;   -- nomeado: passa a conferir
select pg_temp.entrar(:CMP::uuid);
select pg_temp.ok((select count(*) = 1 and bool_and(situacao = 'a_receber' and itens = 2) from public.est_receb_fila(:E::uuid) where numero = 9103), 'a nota aparece na fila a receber');
select pg_temp.ok(not exists (select 1 from public.est_receb_fila(:E::uuid) where numero in (9101, 9102)), 'notas de antes do início não aparecem');
insert into _r(k, id) select 'r', public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c3');
select pg_temp.ok(public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c3') = (select id from _r where k = 'r'), 'iniciar de novo retoma a mesma conferência');
select pg_temp.falha($$select * from est_recebimento_itens$$, 'leitura direta dos itens');
select pg_temp.ok((select count(*) = 2 and bool_and(qtd_nota is null) from public.est_receb_itens((select id from _r where k = 'r'))), 'conferência cega: quem confere não vê a quantidade da nota');
select pg_temp.ok((select bool_and(v_nf is null) from public.est_receb_fila(:E::uuid)), 'quem confere não vê o valor da nota na fila');
select pg_temp.ok((select produto_codigo = 'B6-RES' and ucom = 'SC' from public.est_receb_itens((select id from _r where k = 'r')) where n_item = 1), 'o item mostra o produto do de-para e a unidade da nota');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok((select bool_and(qtd_nota is not null) from public.est_receb_itens((select id from _r where k = 'r'))), 'financeiro (fora da conferência) vê a quantidade da nota');
select pg_temp.ok((select count(*) = 2 from nfe_itens where nota_id = 'b6000000-0000-0000-0000-0000000000c3'), 'financeiro lê os itens da nota');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.ok((select count(*) = 0 from nfe_itens where nota_id = 'b6000000-0000-0000-0000-0000000000c3') and (select count(*) = 0 from nfe_notas where id = 'b6000000-0000-0000-0000-0000000000c3'),
  'quem pode conferir não lê a nota nem os itens enquanto a conferência está aberta');
select pg_temp.ok((select numero = 9103 from public.est_receb_nota((select id from _r where k = 'r'))), 'o cabeçalho da conferência vem pela função');
select pg_temp.ok(not exists (select 1 from public.produto_compras(:E::uuid, current_date - 30, current_date) where nota_id = 'b6000000-0000-0000-0000-0000000000c3'), 'as compras do produto não mostram a nota em conferência');
select pg_temp.falha($$select * from public.produto_depara_pendente('e000000a-0000-0000-0000-000000000000', current_date - 30)$$, 'de-para pendente (soma das notas) durante a conferência cega');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok(exists (select 1 from public.produto_compras(:E::uuid, current_date - 30, current_date) where nota_id = 'b6000000-0000-0000-0000-0000000000c3'), 'quem não confere continua vendo a nota nas compras do produto');
select pg_temp.entrar(:CMP::uuid);
insert into _r(k, id) select 'i1', item_id from public.est_receb_itens((select id from _r where k = 'r')) where n_item = 1;
insert into _r(k, id) select 'i2', item_id from public.est_receb_itens((select id from _r where k = 'r')) where n_item = 2;
select pg_temp.falha(format('select public.est_receb_contar(%L, %L)', (select id from _r where k = 'i1'), 'NaN'), 'quantidade NaN');
select pg_temp.falha(format('select public.est_receb_contar(%L, 3, 4)', (select id from _r where k = 'i1')), 'avariado maior que o que chegou');
select public.est_receb_contar((select id from _r where k = 'i1'), 3, 0);   -- a nota diz 4 sacos: faltou 1
select pg_temp.falha(format('select public.est_receb_concluir(%L)', (select id from _r where k = 'r')), 'concluir com item sem conferência');
select pg_temp.falha(format('select public.est_receb_concluir(%L, current_date + 1, null, true)', (select id from _r where k = 'r')), 'chegada com data futura');
select pg_temp.falha(format('select public.est_receb_concluir(%L, current_date - 4, null, true)', (select id from _r where k = 'r')), 'chegada antes da emissão');
reset role;
insert into est_fechamentos(empresa_id, mes) values (:E, date_trunc('month', current_date - 1)::date);
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.est_receb_concluir(%L, current_date - 1, null, true)', (select id from _r where k = 'r')), 'chegada em mês fechado');
reset role;
delete from est_fechamentos where empresa_id = :E::uuid;
select pg_temp.ok((select situacao = 'conferindo' from est_recebimentos where id = (select id from _r where k = 'r')), 'a conferência continua aberta para corrigir a data');
select pg_temp.entrar(:CMP::uuid);
insert into _r(k, j) select 'c', public.est_receb_concluir((select id from _r where k = 'r'), current_date - 1, 'Um saco a menos', true);
reset role;
select pg_temp.ok((select (j->>'divergencias')::int = 2 and (j->>'lancados')::int = 1 from _r where k = 'c'), 'concluída: duas divergências (faltou 1 saco; item sem de-para não chegou) e uma entrada lançada');
select pg_temp.ok((select data = current_date - 1 and quantidade = 75 and custo_unitario = 10 from est_movimentos where nfe_item_id = 'b6000000-0000-0000-0000-0000000001c3'),
  'entrou na data da chegada: 3 sacos × 25 = 75 kg, ao custo da nota (R$ 1.000 / 100 kg = R$ 10)');
select pg_temp.ok((select divergencia like 'faltou 1%' from est_recebimento_itens where id = (select id from _r where k = 'i1')), 'a divergência fica registrada para Compras');
select pg_temp.ok((select (j->>'bloqueado')::boolean and (j->>'valor_bloqueado')::numeric = 251 from _r where k = 'c')
  and (select situacao = 'bloqueada' and valor_divergente = 251 from compras_bloqueios where nota_id = 'b6000000-0000-0000-0000-0000000000c3')
  and (select bloqueio_id is not null from est_recebimentos where id = (select id from _r where k = 'r')),
  'falta de 1 saco (R$ 250) e item que não chegou (R$ 1): o pagamento da nota fica bloqueado em R$ 251, no mesmo bloqueio de Compras');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok((select count(*) >= 2 from jsonb_array_elements(public.compras_confronto_lista(:E::uuid, current_date - 30)) x, jsonb_array_elements(x -> 'divergencias') d
   where x ->> 'numero' = '9103' and d ->> 'tipo' = 'recebimento' and (d ->> 'bloqueia')::boolean), 'a tela de confronto de Compras mostra as divergências da conferência, com o cadeado');
reset role;
select pg_temp.ok(not exists (select 1 from est_movimentos where nfe_item_id = 'b6000000-0000-0000-0000-0000000002c3') and not exists (select 1 from est_pendencias where nfe_item_id = 'b6000000-0000-0000-0000-0000000002c3' and status = 'aberta'), 'item que não chegou não entra nem pendura');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.ok(public.est_processar_item('b6000000-0000-0000-0000-0000000001c3') = 'ja', 'reprocessar não duplica a entrada');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.est_receb_contar(%L, 4)', (select id from _r where k = 'i1')), 'alterar a conferência depois de concluída');
select pg_temp.falha(format('select public.est_receb_concluir(%L)', (select id from _r where k = 'r')), 'concluir duas vezes');
select pg_temp.ok(not exists (select 1 from public.est_receb_fila(:E::uuid) where numero = 9103), 'a nota recebida sai da fila');

-- avariado: chega, mas não entra no estoque
reset role;
select pg_temp.nota('c4', 9104, current_date - 1, 10, 2500);
select pg_temp.entrar(:CMP::uuid);
insert into _r(k, id) select 'r4', public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c4');
select public.est_receb_contar((select item_id from public.est_receb_itens((select id from _r where k = 'r4')) where n_item = 1), 10, 2);
select public.est_receb_contar((select item_id from public.est_receb_itens((select id from _r where k = 'r4')) where n_item = 2), 2, 0);
select public.est_receb_concluir((select id from _r where k = 'r4'));
reset role;
select pg_temp.ok((select quantidade = 200 and custo_unitario = 10 from est_movimentos m join est_locais l on l.id = m.local_id where m.nfe_item_id = 'b6000000-0000-0000-0000-0000000001c4' and l.codigo <> 'AVA'), 'avariado: chegaram 10 sacos, 2 avariados; entram 8 × 25 = 200 kg no local do produto');
select pg_temp.ok((select quantidade = 50 and custo_unitario = 10 from est_movimentos m join est_locais l on l.id = m.local_id where m.nfe_item_id = 'b6000000-0000-0000-0000-0000000001c4' and l.codigo = 'AVA' and not l.compoe_custo),
  'os 2 sacos avariados (50 kg) ficam no local de avariados, fora do custo médio, até a devolução ou o descarte');

-- chegou mais que a nota: entra só o da nota; o excesso fica na divergência
reset role;
select pg_temp.nota('c7', 9107, current_date, 4, 1000);
select pg_temp.entrar(:CMP::uuid);
insert into _r(k, id) select 'r7', public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c7');
select public.est_receb_contar((select item_id from public.est_receb_itens((select id from _r where k = 'r7')) where n_item = 1), 6, 0);
select public.est_receb_concluir((select id from _r where k = 'r7'), current_date, null, true);
reset role;
select pg_temp.ok((select quantidade = 100 and valor = 1000 from est_movimentos where nfe_item_id = 'b6000000-0000-0000-0000-0000000001c7')
  and (select divergencia like 'sobrou 2%' from est_recebimento_itens ri join est_recebimentos r on r.id = ri.recebimento_id where r.nota_id = 'b6000000-0000-0000-0000-0000000000c7' and ri.qtd_nota = 4),
  'chegaram 6 sacos para 4 na nota: entram 100 kg (R$ 1.000), e a sobra de 2 fica para Compras');
select pg_temp.ok(not exists (select 1 from compras_bloqueios where nota_id = 'b6000000-0000-0000-0000-0000000000c7' and valor_divergente > 1), 'sobra não bloqueia o pagamento (só o item que não chegou)');

-- nota sem material: dispensada com motivo
select pg_temp.nota('c5', 9105, current_date, 1, 100);
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select public.est_receb_dispensar('b6000000-0000-0000-0000-0000000000c5', 'x')$$, 'dispensar sem motivo');
select public.est_receb_dispensar('b6000000-0000-0000-0000-0000000000c5', 'Nota de serviço de manutenção, sem material');
select pg_temp.ok((select situacao = 'dispensa_pedida' from public.est_receb_fila(:E::uuid) where numero = 9105), 'a dispensa fica pedida, na fila, até a decisão');
select pg_temp.falha($$select public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c5')$$, 'conferir nota com a dispensa pedida');
select pg_temp.falha(format('select public.est_receb_dispensa_decidir(%L, true)', (select id from est_recebimentos where nota_id = 'b6000000-0000-0000-0000-0000000000c5' and situacao = 'dispensa_pedida')), 'quem confere aprovando a dispensa');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha(format('select public.est_receb_dispensa_decidir(%L, false)', (select id from est_recebimentos where nota_id = 'b6000000-0000-0000-0000-0000000000c5' and situacao = 'dispensa_pedida')), 'recusar sem motivo');
select pg_temp.ok(public.est_receb_dispensa_decidir((select id from est_recebimentos where nota_id = 'b6000000-0000-0000-0000-0000000000c5' and situacao = 'dispensa_pedida'), true) = 'dispensado', 'financeiro aprova a dispensa');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.ok(not exists (select 1 from public.est_receb_fila(:E::uuid) where numero = 9105), 'nota dispensada sai da fila');
select pg_temp.falha($$select public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c5')$$, 'conferir nota dispensada');
reset role;
select pg_temp.nota('c8', 9108, current_date, 1, 100);
select pg_temp.entrar(:CMP::uuid);
select public.est_receb_dispensar('b6000000-0000-0000-0000-0000000000c8', 'Achei que era frete');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok(public.est_receb_dispensa_decidir((select id from est_recebimentos where nota_id = 'b6000000-0000-0000-0000-0000000000c8' and situacao = 'dispensa_pedida'), false, 'É resina: conferir') = 'recusado', 'dispensa recusada');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.ok((select situacao = 'a_receber' from public.est_receb_fila(:E::uuid) where numero = 9108), 'recusada, a nota volta para a fila a receber');

-- conferência aberta (parâmetro): quem confere vê a quantidade da nota
select pg_temp.entrar(:ADM::uuid);
select public.est_receb_salvar(:E::uuid, true, false, 0.5);
reset role;
select pg_temp.nota('c6', 9106, current_date, 1, 100);
select pg_temp.entrar(:CMP::uuid);
insert into _r(k, id) select 'r6', public.est_receb_iniciar('b6000000-0000-0000-0000-0000000000c6');
select pg_temp.ok((select bool_and(qtd_nota is not null) from public.est_receb_itens((select id from _r where k = 'r6'))), 'conferência aberta: a quantidade da nota aparece');
select pg_temp.ok((select receb_desde = current_date - 5 from est_config where empresa_id = :E::uuid), 'religar mantém a data de início');

-- desliga para não afetar os outros testes
select pg_temp.entrar(:ADM::uuid);
select public.est_receb_salvar(:E::uuid, false, true, 0.5);
reset role;
select pg_temp.ok((select count(*) = 0 from est_saldos s cross join lateral (select coalesce(sum(m.quantidade), 0) q, coalesce(sum(m.valor), 0) v from est_movimentos m
    where m.produto_id = s.produto_id and m.local_id = s.local_id and m.lote_id is not distinct from s.lote_id) x
  where s.empresa_id = :E::uuid and (s.quantidade <> x.q or s.valor <> x.v)), 'nenhuma divergência entre saldos e movimentos');
\o
\echo b6_estoque_recebimento ok

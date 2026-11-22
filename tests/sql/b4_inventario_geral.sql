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
-- 182 — inventário geral: abertura com rodízio, congelamento, contagem cega, auditoria cega, terceira contagem, aprovação com ajuste na
-- data de referência e fechamento do mês, acuracidade, e implantação pelo primeiro inventário
\set B '''e000000b-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set PRD '''87000000-0000-0000-0000-0000000000aa'''
\set LEI '''c0000000-0000-0000-0000-00000000000c'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
select public._est_configurar(:E::uuid);
delete from est_fechamentos where empresa_id in (:E::uuid, :B::uuid);
delete from est_fechamento_saldos where empresa_id in (:E::uuid, :B::uuid);
update est_config set dias_retroativos = null, custo_desvio_pct = null, exigir_documento = false where empresa_id in (:E::uuid, :B::uuid);
update est_inv_contagens set situacao = 'cancelada' where situacao in ('aberta', 'em_aprovacao');
delete from est_ig_config where empresa_id in (:E::uuid, :B::uuid);
create temp table _d as select (date_trunc('month', current_date) - interval '1 day')::date ref, (date_trunc('month', current_date) - interval '1 month')::date mes;
grant select on _d to authenticated;
-- dois locais só deste teste, para a lista ter só os itens daqui
insert into est_locais(id, empresa_id, codigo, nome, finalidade) values
  ('b4000000-0000-0000-0000-0000000000e1', :E, 'IG1', 'Depósito IG 1', 'materia_prima'), ('b4000000-0000-0000-0000-0000000000e2', :E, 'IG2', 'Depósito IG 2', 'uso_consumo'),
  ('b4000000-0000-0000-0000-0000000000e3', :B, 'IGB', 'Almoxarifado IG B', 'uso_consumo');
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade, controla_lote, local_padrao_id) values
  ('b4000000-0000-0000-0000-0000000000a1', :E, 'B4-RES', 'RESINA B4', 'uso_consumo', 'KG', false, null),
  ('b4000000-0000-0000-0000-0000000000a2', :E, 'B4-MAS', 'MASTER B4', 'uso_consumo', 'KG', false, null),
  ('b4000000-0000-0000-0000-0000000000a3', :E, 'B4-LUV', 'LUVA B4', 'uso_consumo', 'PAR', false, null),
  ('b4000000-0000-0000-0000-0000000000a4', :E, 'B4-ZER', 'ITEM ZERADO B4', 'uso_consumo', 'UN', false, null),
  ('b4000000-0000-0000-0000-0000000000a5', :E, 'B4-ACH', 'ITEM ACHADO B4', 'uso_consumo', 'UN', false, null),
  ('b4000000-0000-0000-0000-0000000000b1', :B, 'B4-PAP', 'PAPEL A4 B4', 'uso_consumo', 'CX', false, 'b4000000-0000-0000-0000-0000000000e3'),
  ('b4000000-0000-0000-0000-0000000000b2', :B, 'B4-TON', 'TONER B4', 'uso_consumo', 'UN', false, 'b4000000-0000-0000-0000-0000000000e3');
create temp view b4 as select (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'COMPRA') compra, (select id from est_tipos_movimento where empresa_id = :E::uuid and codigo = 'PERDA') perda;
grant select on b4 to authenticated;
create temp table _g (k text primary key, id uuid, j jsonb); grant all on _g to authenticated;
create function pg_temp.mov(p_prod text, p_local text, p_qtd numeric, p_custo numeric, p_data date) returns uuid language sql as $$
  insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento)
  select 'e000000a-0000-0000-0000-000000000000', p_data, ('b4000000-0000-0000-0000-0000000000' || p_prod)::uuid, ('b4000000-0000-0000-0000-0000000000' || p_local)::uuid,
         case when p_qtd > 0 then compra else perda end, p_qtd, case when p_qtd > 0 then p_custo end, 'DOC B4' from b4 returning id $$;
grant execute on function pg_temp.mov(text, text, numeric, numeric, date) to authenticated;
create function pg_temp.item(p_local text, p_prod text) returns uuid language sql security definer as $$
  select i.id from est_ig_itens i join est_ig_locais l on l.id = i.ig_local_id join est_ig_inventarios g on g.id = l.inventario_id
   where g.situacao = 'aberto' and l.local_id = ('b4000000-0000-0000-0000-0000000000' || p_local)::uuid and i.produto_id = ('b4000000-0000-0000-0000-0000000000' || p_prod)::uuid $$;
create function pg_temp.igl(p_local text) returns uuid language sql security definer as $$
  select l.id from est_ig_locais l join est_ig_inventarios g on g.id = l.inventario_id where g.situacao = 'aberto' and l.local_id = ('b4000000-0000-0000-0000-0000000000' || p_local)::uuid $$;
grant execute on function pg_temp.item(text, text), pg_temp.igl(text) to authenticated;

select pg_temp.entrar(:ADM::uuid);
select pg_temp.mov('a1', 'e1', 100, 10, (select ref - 20 from _d));
select pg_temp.mov('a2', 'e1', 50, 20, (select ref - 20 from _d));
select pg_temp.mov('a3', 'e2', 10, 5, (select ref - 20 from _d));
select pg_temp.mov('a4', 'e2', 5, 3, (select ref - 20 from _d));
select pg_temp.mov('a4', 'e2', -5, null, (select ref - 10 from _d));
select pg_temp.mov('a1', 'e1', 7, 10, current_date);   -- compra de hoje, depois da referência e antes do congelamento: entra no saldo de comparação (controle de corte)
select pg_temp.mov('a2', 'e1', 10, 40, current_date);  -- compra de hoje mais cara: o ajuste na referência tem de sair pelo custo da referência (20), não pelo de hoje

-- ============================================================ abrir: permissões, rodízio e lista
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.est_ig_abrir(%L, %L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', (select ref from _d), '[]'), 'compras não abre o inventário geral');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha(format('select public.est_ig_abrir(%L, %L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', current_date + 1,
  '[{"local_id":"b4000000-0000-0000-0000-0000000000e1","responsavel_id":"f0000000-0000-0000-0000-00000000000f"}]'), 'data de referência futura');
select pg_temp.falha(format('select public.est_ig_abrir(%L, %L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', (select ref from _d),
  '[{"local_id":"b4000000-0000-0000-0000-0000000000e1","responsavel_id":"f0000000-0000-0000-0000-00000000000f"}]'), 'um local só, sem outra pessoa para auditar');
select pg_temp.falha(format('select public.est_ig_abrir(%L, %L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', (select ref from _d),
  '[{"local_id":"b4000000-0000-0000-0000-0000000000e1","responsavel_id":"f0000000-0000-0000-0000-00000000000f","auditor_id":"f0000000-0000-0000-0000-00000000000f"}]'), 'quem conta auditando o próprio local');
select pg_temp.falha(format('select public.est_ig_abrir(%L, %L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', (select ref from _d),
  '[{"local_id":"b4000000-0000-0000-0000-0000000000e1","responsavel_id":"c0000000-0000-0000-0000-00000000000c","auditor_id":"f0000000-0000-0000-0000-00000000000f"}]'), 'contador sem perfil de estoque');
insert into _g(k, id) select 'ig', public.est_ig_abrir(:E::uuid, (select ref from _d),
  '[{"local_id":"b4000000-0000-0000-0000-0000000000e1","responsavel_id":"f0000000-0000-0000-0000-00000000000f"},{"local_id":"b4000000-0000-0000-0000-0000000000e2","responsavel_id":"87000000-0000-0000-0000-0000000000aa"}]'::jsonb, 'Inventário do dia 01');
select pg_temp.ok((select count(*) = 2 and bool_and(situacao = 'contando') from est_ig_locais where inventario_id = (select id from _g where k = 'ig'))
  and (select auditor_id = :PRD::uuid from est_ig_locais where local_id = 'b4000000-0000-0000-0000-0000000000e1' and inventario_id = (select id from _g where k = 'ig'))
  and (select auditor_id = :CMP::uuid from est_ig_locais where local_id = 'b4000000-0000-0000-0000-0000000000e2' and inventario_id = (select id from _g where k = 'ig')), 'rodízio: cada um audita o local do outro');
select pg_temp.ok((select not implantacao and referencia = (select ref from _d) from est_ig_inventarios where id = (select id from _g where k = 'ig')), 'inventário comum, com a data de referência');
select pg_temp.falha(format('select public.est_ig_abrir(%L, %L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', (select ref from _d),
  '[{"local_id":"b4000000-0000-0000-0000-0000000000e1","responsavel_id":"f0000000-0000-0000-0000-00000000000f","auditor_id":"87000000-0000-0000-0000-0000000000aa"}]'), 'segundo inventário geral aberto');
reset role;
select pg_temp.ok((select count(*) = 4 from est_ig_itens where inventario_id = (select id from _g where k = 'ig'))
  and (select saldo_ref = 107 and custo = 10 from est_ig_itens where id = pg_temp.item('e1', 'a1'))
  and (select saldo_ref = 60 and custo = 20 from est_ig_itens where id = pg_temp.item('e1', 'a2'))
  and (select saldo_ref = 0 from est_ig_itens where id = pg_temp.item('e2', 'a4')), '4 itens: saldo do congelamento (107 e 60, com as compras de hoje), custo da data de referência e o item zerado que se movimentou');

-- ============================================================ contagem cega: ninguém lê a tabela de itens
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha($$select * from est_ig_itens$$, 'leitura direta dos itens do inventário');
select pg_temp.ok((select count(*) = 2 and bool_and(papel = 'contador' and quantidade is null and contado is null and auditado is null) from public.est_ig_lista(pg_temp.igl('e1'))), 'quem conta recebe os 2 itens do local, sem quantidades');
select pg_temp.falha(format('select * from public.est_ig_lista(%L)', pg_temp.igl('e2')), 'lista do local que ainda não é minha vez de auditar');
select pg_temp.falha(format('select * from public.est_ig_detalhe(%L)', (select id from _g where k = 'ig')), 'contador vendo o resultado com o saldo do sistema');
select pg_temp.entrar(:LEI::uuid);
select pg_temp.falha(format('select * from public.est_ig_lista(%L)', pg_temp.igl('e1')), 'perfil sem estoque pedindo a lista');

-- ============================================================ congelamento
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select pg_temp.mov(%L, %L, 1, 10, current_date)', 'a1', 'e1'), 'lançamento em local congelado');
select pg_temp.falha($$select public.est_transferir('e000000a-0000-0000-0000-000000000000', current_date, 'b4000000-0000-0000-0000-0000000000a1', 'b4000000-0000-0000-0000-0000000000e1', (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'MP'), 1)$$, 'transferência saindo de local congelado');
select pg_temp.falha($$select public.est_fechar_mes('e000000a-0000-0000-0000-000000000000', (select mes from _d))$$, 'fechar o mês com inventário geral aberto');

-- ============================================================ contar
select pg_temp.entrar(:PRD::uuid);
select pg_temp.falha(format('select public.est_ig_contar(%L, 100)', pg_temp.item('e1', 'a1')), 'outra pessoa contando o local do comprador');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.est_ig_contar(%L, %L)', pg_temp.item('e1', 'a1'), 'NaN'), 'quantidade NaN na contagem');
select public.est_ig_contar(pg_temp.item('e1', 'a1'), 107);
select pg_temp.falha(format('select public.est_ig_concluir_contagem(%L)', pg_temp.igl('e1')), 'concluir com item sem contagem');
select public.est_ig_contar(pg_temp.item('e1', 'a2'), 56);
select pg_temp.ok(public.est_ig_concluir_contagem(pg_temp.igl('e1')) = 'auditando', 'contagem concluída: o local vai para a auditoria');
select pg_temp.falha(format('select public.est_ig_contar(%L, 57)', pg_temp.item('e1', 'a2')), 'quem contou mexendo na contagem depois de concluir');
select pg_temp.entrar(:PRD::uuid);
select public.est_ig_contar(pg_temp.item('e2', 'a3'), 10);
insert into _g(k, id) select 'ach', public.est_ig_incluir(pg_temp.igl('e2'), 'b4000000-0000-0000-0000-0000000000a5');
select public.est_ig_contar((select id from _g where k = 'ach'), 3);
select pg_temp.ok(public.est_ig_concluir_contagem(pg_temp.igl('e2'), true) = 'auditando', 'o item não encontrado fica com zero; o achado entrou na lista');

-- ============================================================ auditoria cega (amostra de 100% por padrão)
select pg_temp.ok((select count(*) = 2 and bool_and(papel = 'auditor' and quantidade is null and contado is null) from public.est_ig_lista(pg_temp.igl('e1'))), 'o auditor recebe a amostra sem ver a contagem');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.est_ig_contar(%L, 100)', pg_temp.item('e1', 'a1')), 'quem contou auditando o próprio local');
select pg_temp.entrar(:PRD::uuid);
select public.est_ig_contar(pg_temp.item('e1', 'a1'), 107);
select pg_temp.falha(format('select public.est_ig_concluir_auditoria(%L)', pg_temp.igl('e1')), 'concluir auditoria com item da amostra em branco');
select public.est_ig_contar(pg_temp.item('e1', 'a2'), 58);   -- o contador disse 56
select pg_temp.ok(public.est_ig_concluir_auditoria(pg_temp.igl('e1')) = 'terceira', 'contagem 56 × auditoria 58: terceira contagem');
select pg_temp.entrar(:CMP::uuid);
select public.est_ig_contar(pg_temp.item('e2', 'a3'), 10);
select public.est_ig_contar(pg_temp.item('e2', 'a4'), 0);
select public.est_ig_contar((select id from _g where k = 'ach'), 3);
select pg_temp.ok(public.est_ig_concluir_auditoria(pg_temp.igl('e2')) = 'concluido', 'auditoria bate com a contagem: local concluído');

-- ============================================================ terceira contagem, feita pelos dois
select pg_temp.ok((select count(*) = 1 and bool_and(papel = 'terceira' and contado = 56 and auditado = 58) from public.est_ig_lista(pg_temp.igl('e1'))), 'na terceira contagem os dois veem as duas quantidades do item divergente');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha(format('select public.est_ig_terceira(%L, 57, %L)', pg_temp.item('e1', 'a2'), 'saco aberto'), 'terceira contagem por quem não contou nem auditou');
select pg_temp.falha(format('select public.est_ig_aprovar(%L)', (select id from _g where k = 'ig')), 'aprovar com local em terceira contagem');
select pg_temp.entrar(:PRD::uuid);
select pg_temp.falha(format('select public.est_ig_terceira(%L, 57)', pg_temp.item('e1', 'a2')), 'terceira contagem sem justificativa');
select pg_temp.ok(public.est_ig_terceira(pg_temp.item('e1', 'a2'), 57, 'saco aberto, pesado de novo') = 'confirmar', 'um registra a terceira contagem: falta o outro confirmar');
select pg_temp.falha(format('select public.est_ig_terceira(%L, 57)', pg_temp.item('e1', 'a2')), 'a mesma pessoa confirmando a própria terceira contagem');
select pg_temp.ok((select situacao = 'terceira' from est_ig_locais where id = pg_temp.igl('e1')) and (select bool_and(situacao = 'aguarda_outro' and not feito) from public.est_ig_lista(pg_temp.igl('e1'))), 'o local não conclui com a terceira contagem de um só');
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select * from public.est_ig_detalhe(%L)', (select id from _g where k = 'ig')), 'quem conta vendo o resultado antes de o seu local terminar');
select pg_temp.ok((select bool_and(situacao = 'confirmar' and quantidade = 57) from public.est_ig_lista(pg_temp.igl('e1'))), 'o outro vê a quantidade proposta para confirmar');
select pg_temp.ok(public.est_ig_terceira(pg_temp.item('e1', 'a2'), 57) = 'concluido', 'confirmada pelos dois: item resolvido e local concluído');

-- local concluído: movimento de hoje volta a passar; com data até a referência, só depois de aprovar
select pg_temp.entrar(:ADM::uuid);
select pg_temp.mov('a1', 'e1', 1, 10, current_date);
select pg_temp.falha(format('select pg_temp.mov(%L, %L, 1, 10, %L)', 'a1', 'e1', (select ref from _d)), 'movimento com data até a referência antes da aprovação');

-- ============================================================ resultado, acuracidade e aprovação
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok((select count(*) = 5 from public.est_ig_detalhe((select id from _g where k = 'ig')))
  and (select diferenca = -3 and valor = -60 and final = 57 from public.est_ig_detalhe((select id from _g where k = 'ig')) where codigo = 'B4-MAS')
  and (select diferenca = 3 and incluido from public.est_ig_detalhe((select id from _g where k = 'ig')) where codigo = 'B4-ACH'), 'resultado: falta de 3 kg de master (R$ 60) e sobra de 3 do item achado');
select pg_temp.ok((select itens = 2 and itens_certos = 1 and pct_itens = 50 and auditados = 2 and divergiu_auditoria = 1 from public.est_ig_acuracidade((select id from _g where k = 'ig')) where local_id = 'b4000000-0000-0000-0000-0000000000e1')
  and (select itens = 3 and divergiu_auditoria = 0 from public.est_ig_acuracidade((select id from _g where k = 'ig')) where local_id = 'b4000000-0000-0000-0000-0000000000e2'), 'acuracidade por local');
select pg_temp.falha(format('select public.est_ig_aprovar(%L)', (select id from _g where k = 'ig')), 'sobra sem custo: pede o custo ou a confirmação');
select public.est_ig_custo((select id from _g where k = 'ach'), 4);
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.est_ig_aprovar(%L)', (select id from _g where k = 'ig')), 'compras aprovando o inventário');
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, j) select 'apr', public.est_ig_aprovar((select id from _g where k = 'ig'));
select pg_temp.ok((select (j->>'ajustes')::int = 2 and (j->>'valor')::numeric = -48 and (j->>'mes_fechado')::boolean and not (j->>'implantacao')::boolean from _g where k = 'apr'), '2 ajustes (−R$ 60 e +R$ 12) e o mês fechado');
reset role;
select pg_temp.ok((select count(*) = 2 and bool_and(data = (select ref from _d) and documento like 'IG %') from est_movimentos where produto_id in ('b4000000-0000-0000-0000-0000000000a2', 'b4000000-0000-0000-0000-0000000000a5') and documento like 'IG %')
  and (select custo_unitario = 20 and valor = -60 from est_movimentos where produto_id = 'b4000000-0000-0000-0000-0000000000a2' and documento like 'IG %'), 'os ajustes entraram na data de referência, pelo custo da referência (20), não pelo de hoje');
select pg_temp.ok((select quantidade = 57 from est_saldos where produto_id = 'b4000000-0000-0000-0000-0000000000a2') and (select quantidade = 3 and valor = 12 from est_saldos where produto_id = 'b4000000-0000-0000-0000-0000000000a5')
  and (select quantidade = 108 from est_saldos where produto_id = 'b4000000-0000-0000-0000-0000000000a1'), 'saldos: master 57, achado 3 a R$ 4, resina 107 + 1 de depois do congelamento');
select pg_temp.ok(exists (select 1 from est_fechamentos where empresa_id = :E::uuid and mes = (select mes from _d))
  and (select sum(quantidade) = 47 from est_fechamento_saldos where empresa_id = :E::uuid and mes = (select mes from _d) and produto_id = 'b4000000-0000-0000-0000-0000000000a2')
  and (select sum(quantidade) = 100 from est_fechamento_saldos where empresa_id = :E::uuid and mes = (select mes from _d) and produto_id = 'b4000000-0000-0000-0000-0000000000a1'), 'a posição guardada no fechamento é o inventário (master 47, resina 100)');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select pg_temp.mov(%L, %L, 1, 10, %L)', 'a1', 'e1', (select ref from _d)), 'depois de aprovado, o mês está fechado');
select pg_temp.mov('a1', 'e1', 1, 10, current_date);   -- e o local voltou a movimentar
reset role;
delete from est_fechamentos where empresa_id = :E::uuid; delete from est_fechamento_saldos where empresa_id = :E::uuid;

-- número inválido não entra no Kardex
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select pg_temp.mov(%L, %L, %L, 10, current_date)', 'a1', 'e1', 'NaN'), 'quantidade NaN no lançamento');
select pg_temp.falha(format('select pg_temp.mov(%L, %L, 1, %L, current_date)', 'a1', 'e1', 'NaN'), 'custo NaN no lançamento');

-- ============================================================ cancelar
select pg_temp.entrar(:FIN::uuid);
insert into _g(k, id) select 'ig2', public.est_ig_abrir(:E::uuid, current_date,
  '[{"local_id":"b4000000-0000-0000-0000-0000000000e1","responsavel_id":"f0000000-0000-0000-0000-00000000000f","auditor_id":"87000000-0000-0000-0000-0000000000aa"}]'::jsonb);
select pg_temp.falha(format('select public.est_ig_cancelar(%L, %L)', (select id from _g where k = 'ig2'), 'x'), 'cancelar sem motivo');
select pg_temp.falha(format('select public.est_ig_trocar(%L, %L, null)', pg_temp.igl('e1'), '87000000-0000-0000-0000-0000000000aa'), 'tirar o auditor de um local que tem auditoria');
select pg_temp.falha(format('select public.est_inv_gerar(%L, %L)', 'e000000a-0000-0000-0000-000000000000', 'b4000000-0000-0000-0000-0000000000e1'), 'contagem cíclica em local do inventário geral');
select public.est_ig_trocar(pg_temp.igl('e1'), :PRD::uuid, :CMP::uuid);
select pg_temp.ok((select responsavel_id = :PRD::uuid and auditor_id = :CMP::uuid from est_ig_locais where inventario_id = (select id from _g where k = 'ig2')), 'troca de quem conta e de quem audita');
select public.est_ig_cancelar((select id from _g where k = 'ig2'), 'aberto por engano');
select pg_temp.entrar(:ADM::uuid);
select pg_temp.mov('a1', 'e1', 1, 10, current_date);   -- cancelado: descongela
select pg_temp.falha($$select public.est_ig_config_salvar('e000000b-0000-0000-0000-000000000000', '{}'::jsonb)$$, 'parâmetros de outra empresa');

-- ============================================================ implantação pelo primeiro inventário (empresa B, sem auditoria por parâmetro)
reset role;
update est_config set implantado_em = null, automatico = false where empresa_id = :B::uuid;
insert into membros(empresa_id, user_id, papel) values (:B, :FIN, 'financeiro') on conflict do nothing;
select pg_temp.entrar(:ADB::uuid);
select public.est_ig_config_salvar(:B::uuid, '{"amostra_pct":0,"amostra_classe_a":false,"amostra_divergentes":false,"aprovar_quem_contou":false}'::jsonb);
insert into _g(k, id) select 'igb', public.est_ig_abrir(:B::uuid, (select ref from _d), '[{"local_id":"b4000000-0000-0000-0000-0000000000e3","responsavel_id":"d0000000-0000-0000-0000-00000000000d"}]'::jsonb);
select pg_temp.ok((select implantacao from est_ig_inventarios where id = (select id from _g where k = 'igb')) and (select auditor_id is null from est_ig_locais where inventario_id = (select id from _g where k = 'igb')), 'empresa sem estoque implantado: o inventário é de implantação; sem auditoria por parâmetro');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.ok((select count(*) = 2 from public.est_ig_lista(pg_temp.igl('e3'))), 'a lista vem dos produtos que têm o local como padrão');
select public.est_ig_contar(pg_temp.item('e3', 'b1'), 12);
select public.est_ig_contar(pg_temp.item('e3', 'b2'), 4);
select pg_temp.ok(public.est_ig_concluir_contagem(pg_temp.igl('e3')) = 'concluido', 'sem auditoria: a contagem conclui o local');
select pg_temp.falha(format('select public.est_ig_aprovar(%L, true)', (select id from _g where k = 'igb')), 'quem contou aprovando');
select pg_temp.entrar(:ADB::uuid);
select public.est_ig_custo(pg_temp.item('e3', 'b1'), 25);
select public.est_ig_custo(pg_temp.item('e3', 'b2'), 300);
insert into _g(k, j) select 'aprb', public.est_ig_aprovar((select id from _g where k = 'igb'));
reset role;
select pg_temp.ok((select (j->>'implantacao')::boolean and (j->>'ajustes')::int = 2 and (j->>'valor')::numeric = 1500 from _g where k = 'aprb')
  and (select implantado_em = (select ref from _d) from est_config where empresa_id = :B::uuid)
  and (select count(*) = 2 from est_movimentos m join est_tipos_movimento t on t.id = m.tipo_movimento_id where m.empresa_id = :B::uuid and m.documento like 'IG %' and t.codigo = 'SI')
  and (select quantidade = 12 and valor = 300 from est_saldos where produto_id = 'b4000000-0000-0000-0000-0000000000b1'), 'o contado virou saldo inicial (R$ 1.500) e o estoque ficou implantado na data de referência');
delete from est_fechamentos where empresa_id = :B::uuid; delete from est_fechamento_saldos where empresa_id = :B::uuid;
delete from membros where empresa_id = :B::uuid and user_id = :FIN::uuid;
select pg_temp.ok((select count(*) = 0 from est_saldos s cross join lateral (select coalesce(sum(m.quantidade), 0) q, coalesce(sum(m.valor), 0) v from est_movimentos m
    where m.produto_id = s.produto_id and m.local_id = s.local_id and m.lote_id is not distinct from s.lote_id) x
  where s.empresa_id in (:E::uuid, :B::uuid) and (s.quantidade <> x.q or s.valor <> x.v)), 'nenhuma divergência entre saldos e movimentos');
\o
\echo b4_inventario_geral ok

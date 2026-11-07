-- Qualidade (SQL 087): entrada da nota com plano vai para a quarentena e abre a inspeção (amostra pela tabela), nada sai da
-- quarentena nem do reprovado sem a qualidade, decisão parcial (aprovado ao destino, reprovado ao local Reprovado + RNC),
-- sucata pela RNC, devolução ao fornecedor baixa do Reprovado, lote bloqueado não sai, estorno cancela a inspeção, busca
-- pelas notas sem estoque, bobina bloqueada até a liberação, inspeção final da OP, quem decide e isolamento.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'teste@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
create or replace function pg_temp.saldo(p_prod uuid, p_local text) returns numeric language sql as $$
  select coalesce(sum(s.quantidade), 0) from est_saldos s join est_locais l on l.id = s.local_id where s.produto_id = p_prod and l.codigo = p_local $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- empresa B (estoque implantado no teste 14): resina RES-1 pelo de-para F-RES (saco de 25 kg) e saco acabado SACO-1
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((qual_configurar('e000000b-0000-0000-0000-000000000000') ->> 'faixas')::int = 15, 'tabela de amostragem de partida (15 faixas)');
select pg_temp.ok((qual_configurar('e000000b-0000-0000-0000-000000000000') ->> 'faixas')::int = 0, 'não duplica');
select pg_temp.ok((select local_quarentena_id is not null and local_reprovado_id is not null from qual_parametros where empresa_id = 'e000000b-0000-0000-0000-000000000000'), 'locais Quarentena e Reprovado');
insert into qual_planos(id, empresa_id, nome, etapa, produto_id, caracteristicas, exige_laudo) values
  ('ca000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'Recebimento de resina', 'recebimento', 'bb000000-0000-0000-0000-000000000001',
   '[{"nome":"Índice de fluidez","tipo":"medida","unidade":"g/10min","nominal":2,"min":1.8,"max":2.2},{"nome":"Contaminação visual","tipo":"atributo"}]', true);
reset role;

-- entrada: 4 sacos × 25 = 100 kg → quarentena, com a inspeção aberta (lote de 100 → amostra 20)
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc, emit_nome) values ('cb000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'Q1', 8001, '2026-11-03', 'entrada', false, 'autorizada', '99888777000100', 'FORNECEDOR EXEMPLO');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod) values ('cc000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'cb000000-0000-0000-0000-000000000001', 1, 'F-RES', '5101', 4, 1000);
select pg_temp.ok(pg_temp.saldo('bb000000-0000-0000-0000-000000000001', 'QUA') = 100, 'entrada foi para a quarentena');
select pg_temp.ok((select i.situacao = 'pendente' and i.amostra = 20 and i.ac = 0 and l.codigo = 'MP' and i.origem = 'nfe' and i.plano_id = 'ca000000-0000-0000-0000-000000000001'
                     from qual_inspecoes i join est_locais l on l.id = i.local_destino_id where i.nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), 'inspeção: amostra 20 e destino MP');

select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($q$select est_transferir('e000000b-0000-0000-0000-000000000000', current_date, 'bb000000-0000-0000-0000-000000000001',
  (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'QUA'), (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'MP'), 10,
  (select lote_id from est_movimentos where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'))$q$, 'nada sai da quarentena sem a decisão');
select pg_temp.falha($q$update qual_inspecoes set situacao = 'aprovada' where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'$q$, 'aprovar só pela função');
select pg_temp.falha($q$update qual_inspecoes set situacao = 'cancelada' where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'$q$, 'não cancela inspeção com material na quarentena');
select pg_temp.falha($q$select qual_decidir((select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), 'reprovada', 0, null)$q$, 'reprovação exige motivo');

-- decisão parcial: 80 aprovados (vão para MP), 20 reprovados (local Reprovado) + RNC do fornecedor
select pg_temp.ok((qual_decidir((select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), 'aprovada_concessao', 80, 'Um saco úmido') ->> 'rnc_id') is not null, 'decisão abre a RNC');
select pg_temp.ok(pg_temp.saldo('bb000000-0000-0000-0000-000000000001', 'QUA') = 0 and pg_temp.saldo('bb000000-0000-0000-0000-000000000001', 'REP') = 20, 'quarentena zerada; 20 no Reprovado');
select pg_temp.ok((select qtd_aprovada = 80 and qtd_reprovada = 20 and decidida_em is not null from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), 'quantidades da decisão gravadas');
select pg_temp.ok((select origem = 'fornecedor' and quantidade = 20 and numero >= 1 and prazo is not null from qual_rnc where inspecao_id = (select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001')), 'RNC do fornecedor com prazo');
select pg_temp.falha($q$select qual_decidir((select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), 'aprovada', null, null)$q$, 'não decide duas vezes');
select pg_temp.falha($q$insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade)
  select 'e000000b-0000-0000-0000-000000000000', current_date, 'bb000000-0000-0000-0000-000000000001', (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'REP'),
         (select lote_id from est_movimentos where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), (select id from est_tipos_movimento where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'PERDA'), -20$q$, 'reprovado só sai pela RNC');
select pg_temp.falha($q$update qual_rnc set situacao = 'encerrada' where inspecao_id = (select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001')$q$, 'não encerra sem disposição');

-- disposição: sucatear → PERDA do local Reprovado
select pg_temp.ok(qual_dispor((select id from qual_rnc where inspecao_id = (select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001')), 'sucatear', null, 'Saco úmido') = 'executada', 'sucata executada');
select pg_temp.ok(pg_temp.saldo('bb000000-0000-0000-0000-000000000001', 'REP') = 0, 'Reprovado zerado pela perda');
select pg_temp.falha($q$update qual_rnc set disposicao = 'usar_como_esta' where inspecao_id = (select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001')$q$, 'disposição executada não muda');
update qual_rnc set situacao = 'encerrada', causa = 'Armazenagem do fornecedor' where inspecao_id = (select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001');
select pg_temp.ok((select encerrada_em is not null from qual_rnc where inspecao_id = (select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000001')), 'RNC encerrada');
reset role;

-- devolução ao fornecedor: segunda nota toda reprovada; a NF de devolução (CFOP 5201) baixa do Reprovado
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc, emit_nome) values ('cb000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'Q2', 8002, '2026-11-04', 'entrada', false, 'autorizada', '99888777000100', 'FORNECEDOR EXEMPLO');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod) values ('cc000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'cb000000-0000-0000-0000-000000000002', 1, 'F-RES', '5101', 2, 500);
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select qual_decidir((select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000002'), 'reprovada', 0, 'Índice de fluidez 3,1 (máx. 2,2)');
select pg_temp.ok(pg_temp.saldo('bb000000-0000-0000-0000-000000000001', 'REP') = 50, '50 kg reprovados');
select pg_temp.ok(qual_dispor((select id from qual_rnc where inspecao_id = (select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000002')), 'devolver_fornecedor', null, null) = 'aguardando_nf_devolucao', 'aguarda a NF de devolução');
reset role;
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, dest_doc) values ('cb000000-0000-0000-0000-000000000003', 'e000000b-0000-0000-0000-000000000000', 'Q3', 950, '2026-11-05', 'saida', true, 'autorizada', '99888777000100');
insert into est_regras_cfop(empresa_id, cfop, sentido, tipo_movimento_id, prioridade)
select 'e000000b-0000-0000-0000-000000000000', '201', 'saida', id, 10 from est_tipos_movimento where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'DEVFOR'
 and not exists (select 1 from est_regras_cfop where empresa_id = 'e000000b-0000-0000-0000-000000000000' and cfop = '201' and sentido = 'saida');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod) values ('cc000000-0000-0000-0000-000000000003', 'e000000b-0000-0000-0000-000000000000', 'cb000000-0000-0000-0000-000000000003', 1, 'RES-1', '5201', 50, 500);
select pg_temp.ok(pg_temp.saldo('bb000000-0000-0000-0000-000000000001', 'REP') = 0, 'NF de devolução baixou do Reprovado');
select pg_temp.ok((select disposicao_executada_em is not null from qual_rnc where inspecao_id = (select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000002')), 'RNC: devolução executada pela nota');

-- lote bloqueado não sai; liberado sai
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select qual_bloquear('e000000b-0000-0000-0000-000000000000', 'lote', (select lote_id from est_movimentos where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), true, 'Reclamação de cliente: gel no filme');
select pg_temp.falha($q$insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade)
  select 'e000000b-0000-0000-0000-000000000000', current_date, 'bb000000-0000-0000-0000-000000000001', (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'MP'),
         (select lote_id from est_movimentos where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), (select id from est_tipos_movimento where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'REQPROD'), -10$q$, 'lote bloqueado não vai para a produção');
select qual_bloquear('e000000b-0000-0000-0000-000000000000', 'lote', (select lote_id from est_movimentos where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), false, null);
insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade)
  select 'e000000b-0000-0000-0000-000000000000', current_date, 'bb000000-0000-0000-0000-000000000001', (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'MP'),
         (select lote_id from est_movimentos where nfe_item_id = 'cc000000-0000-0000-0000-000000000001'), (select id from est_tipos_movimento where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'REQPROD'), -10;
select pg_temp.ok((select count(*) from qual_bloqueios where empresa_id = 'e000000b-0000-0000-0000-000000000000' and tipo = 'lote') = 2, 'histórico do bloqueio e da liberação');
reset role;

-- estorno da entrada em quarentena cancela a inspeção
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc, emit_nome) values ('cb000000-0000-0000-0000-000000000004', 'e000000b-0000-0000-0000-000000000000', 'Q4', 8004, '2026-11-05', 'entrada', false, 'autorizada', '99888777000100', 'FORNECEDOR EXEMPLO');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod) values ('cc000000-0000-0000-0000-000000000004', 'e000000b-0000-0000-0000-000000000000', 'cb000000-0000-0000-0000-000000000004', 1, 'F-RES', '5101', 1, 250);
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select est_estornar((select id from est_movimentos where nfe_item_id = 'cc000000-0000-0000-0000-000000000004'), current_date, 'Nota lançada em duplicidade');
select pg_temp.ok((select situacao from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000004') = 'cancelada', 'estorno cancela a inspeção');
reset role;

-- nota antiga (antes da implantação, sem movimento): "Buscar notas de entrada" abre a inspeção sem mexer no estoque
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc, emit_nome) values ('cb000000-0000-0000-0000-000000000005', 'e000000b-0000-0000-0000-000000000000', 'Q5', 7990, '2026-10-20', 'entrada', false, 'autorizada', '99888777000100', 'FORNECEDOR EXEMPLO');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod) values ('cc000000-0000-0000-0000-000000000005', 'e000000b-0000-0000-0000-000000000000', 'cb000000-0000-0000-0000-000000000005', 1, 'F-RES', '5101', 8, 2000);
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok(qual_gerar_recebimento('e000000b-0000-0000-0000-000000000000', '2026-10-01') >= 1, 'inspeção pela nota antiga');
select pg_temp.ok(qual_gerar_recebimento('e000000b-0000-0000-0000-000000000000', '2026-10-01') = 0, 'não duplica');
select pg_temp.ok((select quantidade = 200 and movimento_id is null from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000005'), '8 sacos = 200 kg, sem movimento');
select pg_temp.ok((qual_decidir((select id from qual_inspecoes where nfe_item_id = 'cc000000-0000-0000-0000-000000000005'), 'aprovada', null, null) ->> 'estoque') = 'sem_estoque', 'aprovação sem estoque');

-- produção: plano de liberação do primeiro material; bobina nasce bloqueada e não é expedida até a liberação
insert into qual_planos(empresa_id, nome, etapa, produto_id, liberacao_primeira, caracteristicas) values
  ('e000000b-0000-0000-0000-000000000000', 'Liberação de setup do saco', 'processo', 'bb000000-0000-0000-0000-000000000002', true, '[{"nome":"Espessura","tipo":"medida","unidade":"µm","nominal":50,"min":47,"max":53}]'),
  ('e000000b-0000-0000-0000-000000000000', 'Inspeção final do saco', 'final', 'bb000000-0000-0000-0000-000000000002', false, '[]');
insert into prod_ordens(id, empresa_id, numero, produto_id, quantidade) values ('cd000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 9201, 'bb000000-0000-0000-0000-000000000002', 1000);
insert into prod_bobinas(id, empresa_id, codigo, ordem_id, peso_kg) values ('ce000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'B9201-001', 'cd000000-0000-0000-0000-000000000001', 120);
insert into prod_bobinas(id, empresa_id, codigo, ordem_id, peso_kg) values ('ce000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'B9201-002', 'cd000000-0000-0000-0000-000000000001', 118);
select pg_temp.ok((select count(*) from prod_bobinas where ordem_id = 'cd000000-0000-0000-0000-000000000001' and qualidade = 'bloqueada') = 2, 'bobinas nascem bloqueadas');
select pg_temp.ok((select count(*) from qual_inspecoes where ordem_id = 'cd000000-0000-0000-0000-000000000001' and origem = 'liberacao') = 1, 'uma inspeção de liberação por OP');
select pg_temp.falha($q$update prod_bobinas set situacao = 'expedida' where id = 'ce000000-0000-0000-0000-000000000001'$q$, 'bobina bloqueada não é expedida');
select pg_temp.falha($q$update prod_bobinas set qualidade = 'liberada' where id = 'ce000000-0000-0000-0000-000000000001'$q$, 'bloqueio só muda pela qualidade');
select qual_decidir((select id from qual_inspecoes where ordem_id = 'cd000000-0000-0000-0000-000000000001' and origem = 'liberacao'), 'aprovada', null, null);
select pg_temp.ok((select count(*) from prod_bobinas where ordem_id = 'cd000000-0000-0000-0000-000000000001' and qualidade = 'liberada') = 2, 'liberação solta as bobinas');
reset role;
insert into prod_bobinas(id, empresa_id, codigo, ordem_id, peso_kg) values ('ce000000-0000-0000-0000-000000000003', 'e000000b-0000-0000-0000-000000000000', 'B9201-003', 'cd000000-0000-0000-0000-000000000001', 121);
select pg_temp.ok((select qualidade from prod_bobinas where id = 'ce000000-0000-0000-0000-000000000003') = 'liberada', 'depois da liberação a bobina nasce liberada');
update prod_bobinas set situacao = 'expedida' where id = 'ce000000-0000-0000-0000-000000000001';
update prod_ordens set status = 'concluida' where id = 'cd000000-0000-0000-0000-000000000001';
select pg_temp.ok((select count(*) from qual_inspecoes where ordem_id = 'cd000000-0000-0000-0000-000000000001' and etapa = 'final') = 1, 'OP concluída abre a inspeção final');

-- quem decide (empresa A): compras registra, mas não decide; leitura não registra; parâmetro muda quem decide
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select qual_configurar('e000000a-0000-0000-0000-000000000000');
insert into qual_inspecoes(id, empresa_id, etapa, produto_id, quantidade) values ('cf000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'recebimento', 'aa000000-0000-0000-0000-000000000002', 10);
select pg_temp.ok((select numero = 1 and prazo > now() from qual_inspecoes where id = 'cf000000-0000-0000-0000-000000000001'), 'numeração por empresa e prazo');
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
update qual_inspecoes set situacao = 'em_inspecao', resultados = '[{"nome":"Tamanho","ok":true}]' where id = 'cf000000-0000-0000-0000-000000000001';
select pg_temp.falha($q$select qual_decidir('cf000000-0000-0000-0000-000000000001', 'aprovada', null, null)$q$, 'compras não decide');
select pg_temp.ok((select inspecionada_em is not null from qual_inspecoes where id = 'cf000000-0000-0000-0000-000000000001'), 'compras registrou a inspeção');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($q$insert into qual_inspecoes(empresa_id, etapa, produto_id) values ('e000000a-0000-0000-0000-000000000000', 'recebimento', 'aa000000-0000-0000-0000-000000000002')$q$, 'leitura não registra');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update qual_parametros set papeis_decisao = array['compras'] where empresa_id = 'e000000a-0000-0000-0000-000000000000';
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok((qual_decidir('cf000000-0000-0000-0000-000000000001', 'aprovada', null, null) ->> 'situacao') = 'aprovada', 'quem decide é configurável');
select pg_temp.ok((select count(*) from qual_inspecoes where empresa_id = 'e000000b-0000-0000-0000-000000000000') = 0, 'outra empresa não vê');
reset role;

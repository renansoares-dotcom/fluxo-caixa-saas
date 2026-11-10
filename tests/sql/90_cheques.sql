-- Controle de Cheques (SQL 154): configurar padrão; receber com título e avulso; depósito, compensação, devolução, reapresentação,
-- resgate, cobrança e perda; repasse a fornecedor; cheque no borderô do FIDC (aprovação e devolução pelo fundo);
-- cheques próprios (talão, emissão, compensação, cancelamento, sustação, folha inutilizada); permissões.
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
create or replace function pg_temp.saldo(p_conta uuid) returns numeric language sql as $$
  select coalesce(sum(case when l.conta_destino_id = p_conta then l.valor
                           when p.tipo = 'T' then -l.valor
                           when p.natureza = 'C' then l.valor else -l.valor end), 0)
    from lancamentos l join plano_contas p on p.id = l.plano_id
   where l.status = 'Pago' and (l.conta_id = p_conta or l.conta_destino_id = p_conta);
$$;
create or replace function pg_temp.chq(p_num text) returns uuid language sql as $$
  select id from chq_cheques where numero = p_num and situacao <> 'cancelado' and empresa_id = 'e000000a-0000-0000-0000-000000000000';
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;
\set E '''e000000a-0000-0000-0000-000000000000'''
\set BANCO '''c000000a-0000-0000-0000-000000000000'''

-- planos usados (só cria o que ainda não existe na empresa A)
insert into plano_contas(id, empresa_id, codigo, nome, tipo, natureza, nivel)
select v.id::uuid, :E, v.codigo, v.nome, v.tipo, v.natureza, 2
  from (values ('f900000a-0000-0000-0000-000000000001', '3.02.01', 'TRANSFERÊNCIA ENVIADA', 'T', 'D'),
               ('f900000a-0000-0000-0000-000000000002', '1.05.01', 'RECEITAS DE CHEQUES', 'E', 'C'),
               ('f900000a-0000-0000-0000-000000000003', '1.02.06', 'CHEQUES DEVOLVIDOS DE CLIENTES', 'E', 'C'),
               ('f900000a-0000-0000-0000-000000000004', '1.02.08', 'CHEQUE DEVOLVIDO FORNECEDOR', 'E', 'C'),
               ('f900000a-0000-0000-0000-000000000005', '2.07.13', 'CHEQUES DEVOLVIDOS DE FORNECEDORES', 'S', 'D'),
               ('f900000a-0000-0000-0000-000000000006', '1.02.17', 'JUROS E MULTAS RECEBIDOS', 'E', 'C'),
               ('f900000a-0000-0000-0000-000000000007', '2.07.90', 'ESTORNO DE CHEQUE DEVOLVIDO', 'S', 'D'),
               ('f900000a-0000-0000-0000-000000000008', '2.07.91', 'TARIFAS BANCÁRIAS', 'S', 'D')) v(id, codigo, nome, tipo, natureza)
 where not exists (select 1 from plano_contas p where p.empresa_id = :E and p.codigo = v.codigo);
insert into plano_contas(id, empresa_id, codigo, nome, tipo, natureza, nivel)
select 'f0000a01-0000-0000-0000-000000000000', :E, '1.01.01', 'VENDAS', 'E', 'C', 2
 where not exists (select 1 from plano_contas where id = 'f0000a01-0000-0000-0000-000000000000');
insert into favorecidos(id, empresa_id, nome) values
  ('ef900000-0000-0000-0000-000000000001', :E, 'CLIENTE DO CHEQUE EXEMPLO'),
  ('ef900000-0000-0000-0000-000000000002', :E, 'FORNECEDOR DO CHEQUE EXEMPLO');
insert into lancamentos(id, empresa_id, data, plano_id, descricao, favorecido_id, status, valor, documento) values
  ('a9000000-0000-0000-0000-000000000001', :E, '2026-11-20', 'f0000a01-0000-0000-0000-000000000000', 'NF 9001/1', 'ef900000-0000-0000-0000-000000000001', 'Em aberto', 1000, '9001/1'),
  ('a9000000-0000-0000-0000-000000000002', :E, '2026-11-25', 'f0000a01-0000-0000-0000-000000000000', 'NF 9001/2', 'ef900000-0000-0000-0000-000000000001', 'Em aberto', 500, '9001/2'),
  ('a9000000-0000-0000-0000-000000000003', :E, '2026-11-18', 'f000000a-0000-0000-0000-000000000000', 'BOLETO FORNECEDOR 1', 'ef900000-0000-0000-0000-000000000002', 'Em aberto', 300, 'F-1'),
  ('a9000000-0000-0000-0000-000000000004', :E, '2026-11-19', 'f000000a-0000-0000-0000-000000000000', 'BOLETO FORNECEDOR 2', 'ef900000-0000-0000-0000-000000000002', 'Em aberto', 800, 'F-2'),
  ('a9000000-0000-0000-0000-000000000005', :E, '2026-11-21', 'f000000a-0000-0000-0000-000000000000', 'BOLETO FORNECEDOR 3', 'ef900000-0000-0000-0000-000000000002', 'Em aberto', 450, 'F-3');

-- ---------- permissões e configuração ----------
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($q$select chq_configurar_padrao('e000000a-0000-0000-0000-000000000000')$q$, 'leitura não configura');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($q$select chq_receber('e000000a-0000-0000-0000-000000000000', null, '2026-11-10', '[{"banco":"001","numero":"1","valor":10,"bom_para":"2026-11-10"}]')$q$, 'sem configurar não recebe');
select chq_configurar_padrao(:E);
select chq_configurar_padrao(:E);
select pg_temp.ok((select count(*) from contas where empresa_id = :E and tipo = 'Cheques') = 2, 'configurar padrão cria as duas contas uma vez só');
select pg_temp.ok((select conta_carteira_id is not null and conta_emitidos_id is not null and plano_transferencia_id is not null and plano_avulso_id is not null
                      and plano_devolvido_receber_id is not null and plano_fidc_devolvido_id is not null and plano_repasse_entrada_id is not null
                      and plano_repasse_pagar_id is not null and plano_juros_id is not null from chq_config where empresa_id = :E), 'sugere as contas do plano');
update chq_config set plano_estorno_id = (select id from plano_contas where empresa_id = :E and codigo = '2.07.90'),
                      plano_tarifa_id = (select id from plano_contas where empresa_id = :E and codigo = '2.07.91') where empresa_id = :E;
select pg_temp.ok((select plano_estorno_id is not null from chq_config where empresa_id = :E), 'financeiro grava os parâmetros');
select conta_carteira_id as "CART", conta_emitidos_id as "EMIT" from chq_config where empresa_id = :E \gset
select pg_temp.saldo(:BANCO) as "B0" \gset

-- ---------- receber ----------
select pg_temp.falha($q$select chq_receber('e000000a-0000-0000-0000-000000000000', 'ef900000-0000-0000-0000-000000000001', '2026-11-10',
  '[{"banco":"001","agencia":"1234","conta":"555","numero":"100","valor":900,"bom_para":"2026-11-20"}]', array['a9000000-0000-0000-0000-000000000001']::uuid[])$q$, 'cheque menor que o título não baixa');
select chq_receber(:E, 'ef900000-0000-0000-0000-000000000001', '2026-11-10',
  '[{"banco":"001","agencia":"1234","conta":"555","numero":"100","valor":1000,"bom_para":"2026-11-12","emitente":"Emitente Exemplo","emitente_doc":"123.456.789-09"},
    {"banco":"001","agencia":"1234","conta":"555","numero":"101","valor":600,"bom_para":"2026-12-10"}]',
  array['a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002']::uuid[]) as "REC1" \gset
select pg_temp.ok((select count(*) = 2 and bool_and(status = 'Pago' and conta_id = :'CART' and data = '2026-11-10') from lancamentos where id in ('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000002')), 'títulos baixados na conta Cheques em carteira');
select pg_temp.ok(pg_temp.saldo(:'CART') = 1600, 'carteira = soma dos cheques (sobra de 100 entra como avulso)');
select pg_temp.ok((select emitente_doc = '12345678909' and situacao = 'carteira' from chq_cheques where id = pg_temp.chq('100')), 'cheque em carteira, documento só com dígitos');
select pg_temp.falha($q$select chq_receber('e000000a-0000-0000-0000-000000000000', null, '2026-11-10', '[{"banco":"001","agencia":"1234","conta":"555","numero":"100","valor":50,"bom_para":"2026-11-12"}]')$q$, 'não cadastra o mesmo cheque duas vezes');
select chq_receber(:E, 'ef900000-0000-0000-0000-000000000001', '2026-11-10',
  '[{"banco":"237","numero":"200","valor":400,"bom_para":"2026-11-11"},{"banco":"237","numero":"201","valor":250,"bom_para":"2026-11-11"},
    {"banco":"237","numero":"202","valor":700,"bom_para":"2026-11-11"},{"banco":"237","numero":"203","valor":300,"bom_para":"2026-11-11"},
    {"banco":"237","numero":"204","valor":800,"bom_para":"2026-11-11"},{"banco":"237","numero":"205","valor":150,"bom_para":"2026-11-11"}]') as "REC2" \gset
select pg_temp.ok(pg_temp.saldo(:'CART') = 4200, 'recebimento avulso entra na carteira');
select chq_editar(pg_temp.chq('205'), '{"bom_para":"2026-11-12","observacao":"corrigido"}');
select pg_temp.ok((select bom_para = '2026-11-12' and observacao = 'corrigido' and valor = 150 from chq_cheques where id = pg_temp.chq('205')), 'edita dados do cheque em carteira');

-- cancelar um recebimento devolve os títulos
select chq_receber(:E, 'ef900000-0000-0000-0000-000000000001', '2026-11-10', '[{"banco":"341","numero":"900","valor":10,"bom_para":"2026-11-11"}]') as "REC3" \gset
select chq_cancelar_recebimento(:'REC3', 'digitado errado');
select pg_temp.ok(pg_temp.saldo(:'CART') = 4200 and (select situacao = 'cancelado' from chq_cheques where numero = '900'), 'recebimento cancelado sai da carteira');
select chq_receber(:E, null, '2026-11-10', '[{"banco":"341","numero":"900","valor":10,"bom_para":"2026-11-11"}]') as "REC4" \gset
select chq_cancelar_recebimento(:'REC4', 'teste do número reaproveitado');

-- ---------- depósito, compensação, devolução, reapresentação ----------
select pg_temp.falha(format($q$select chq_depositar('e000000a-0000-0000-0000-000000000000', array[%L]::uuid[], 'c000000a-0000-0000-0000-000000000000', '2026-11-12')$q$, pg_temp.chq('101')), 'pré-datado não deposita antes do bom para');
select pg_temp.falha(format($q$select chq_depositar('e000000a-0000-0000-0000-000000000000', array[%L]::uuid[], %L, '2026-11-12')$q$, pg_temp.chq('100'), :'CART'), 'não deposita na própria carteira');
select chq_depositar(:E, array[pg_temp.chq('100'), pg_temp.chq('200')], :BANCO, '2026-11-12') as "DEP1" \gset
select pg_temp.ok((select numero = 1 and qtd = 2 and valor = 1400 from chq_depositos where id = :'DEP1'), 'borderô de depósito nº 1');
select pg_temp.ok(pg_temp.saldo(:'CART') = 2800 and pg_temp.saldo(:BANCO) = :B0 + 1400, 'depósito é transferência da carteira para o banco');
select chq_compensar(array[pg_temp.chq('100')], '2026-11-13');
select pg_temp.falha(format($q$select chq_deposito_cancelar(%L)$q$, :'DEP1'), 'não cancela depósito com cheque já compensado');
select chq_devolver(pg_temp.chq('200'), '2026-11-13', '11', 5.50);
select pg_temp.ok((select situacao = 'devolvido' and devolucoes = 1 and alinea = '11' and origem_devolucao = 'deposito' from chq_cheques where id = pg_temp.chq('200')), 'cheque devolvido pelo banco');
select pg_temp.ok(pg_temp.saldo(:'CART') = 3200 and pg_temp.saldo(:BANCO) = :B0 + 1000 - 5.50, 'devolução volta o valor para a carteira e debita a tarifa');
select chq_depositar(:E, array[pg_temp.chq('200')], :BANCO, '2026-11-16') as "DEP2" \gset
select pg_temp.ok((select count(*) from chq_eventos where cheque_id = pg_temp.chq('200') and tipo = 'reapresentado') = 1, 'reapresentação registrada no histórico');
select chq_devolver(pg_temp.chq('200'), '2026-11-17', '12');
select pg_temp.falha(format($q$select chq_depositar('e000000a-0000-0000-0000-000000000000', array[%L]::uuid[], 'c000000a-0000-0000-0000-000000000000', '2026-11-18')$q$, pg_temp.chq('200')), 'segunda devolução não reapresenta');

-- resgate com juros
select chq_resgatar(pg_temp.chq('200'), :BANCO, '2026-11-19', 12);
select pg_temp.ok((select situacao = 'resgatado' and encerrado_em = '2026-11-19' from chq_cheques where id = pg_temp.chq('200')), 'cheque resgatado pelo cliente');
select pg_temp.ok(pg_temp.saldo(:'CART') = 2800 and pg_temp.saldo(:BANCO) = :B0 + 1000 - 5.50 + 400 + 12, 'resgate leva o valor ao banco, com os juros');

-- cobrança e perda
select chq_depositar(:E, array[pg_temp.chq('201'), pg_temp.chq('205')], :BANCO, '2026-11-12') as "DEP3" \gset
select chq_devolver(pg_temp.chq('201'), '2026-11-13', '21');
select chq_devolver(pg_temp.chq('205'), '2026-11-13', '21');
select pg_temp.falha(format($q$select chq_cobrar(%L, '2026-11-14', '2026-11-30')$q$, pg_temp.chq('100')), 'só devolvido vai para cobrança');
select chq_cobrar(pg_temp.chq('201'), '2026-11-14', '2026-11-30');
select pg_temp.ok((select q.situacao = 'cobranca' and l.status = 'Em aberto' and l.valor = 250 and l.data = '2026-11-30' and l.favorecido_id = 'ef900000-0000-0000-0000-000000000001' and p.codigo = '1.02.06'
                     from chq_cheques q join lancamentos l on l.id = q.lanc_cobranca_id join plano_contas p on p.id = l.plano_id where q.id = pg_temp.chq('201')), 'cobrança abre título a receber contra o cliente');
select chq_perda(pg_temp.chq('205'), '2026-11-14', 'cliente encerrou as atividades');
select pg_temp.ok(pg_temp.saldo(:'CART') = 2400 and (select situacao = 'perda' from chq_cheques where id = pg_temp.chq('205')), 'cobrança e perda tiram o cheque da carteira');

-- ---------- repasse a fornecedor ----------
select pg_temp.falha(format($q$select chq_repassar('e000000a-0000-0000-0000-000000000000', array[%L]::uuid[], 'ef900000-0000-0000-0000-000000000002', '2026-11-12', array['a9000000-0000-0000-0000-000000000004']::uuid[])$q$, pg_temp.chq('203')), 'cheque menor que o título a pagar não repassa');
select chq_repassar(:E, array[pg_temp.chq('203')], 'ef900000-0000-0000-0000-000000000002', '2026-11-12', array['a9000000-0000-0000-0000-000000000003']::uuid[]);
select pg_temp.ok((select status = 'Pago' and conta_id = :'CART' from lancamentos where id = 'a9000000-0000-0000-0000-000000000003') and pg_temp.saldo(:'CART') = 2100, 'repasse paga o título do fornecedor pela carteira');
select chq_devolver(pg_temp.chq('203'), '2026-11-20', '11');
select pg_temp.ok(pg_temp.saldo(:'CART') = 2400 and (select count(*) from lancamentos where empresa_id = :E and origem = 'cheques' and status = 'Em aberto' and favorecido_id = 'ef900000-0000-0000-0000-000000000002' and valor = 300) = 1,
  'repassado que voltou: cheque na carteira e dívida de novo com o fornecedor');

-- ---------- FIDC: cheque dentro da proposta de borderô ----------
reset role;
insert into contas(id, empresa_id, nome) values ('c900000a-0000-0000-0000-000000000001', :E, 'FUNDO DOS CHEQUES');
insert into fidc_fundos(id, empresa_id, nome, conta_id) values ('fd900000-0000-0000-0000-000000000001', :E, 'Fundo Cheques', 'c900000a-0000-0000-0000-000000000001');
insert into fidc_propostas(id, empresa_id, numero, fundo_id, data_operacao, status, qtd_titulos, valor_face, liquido)
values ('b9000000-0000-0000-0000-000000000001', :E, 9154, 'fd900000-0000-0000-0000-000000000001', '2026-11-12', 'Pendente', 2, 1300, 0);
insert into fidc_proposta_itens(proposta_id, empresa_id, cheque_id, documento, sacado, vencimento, valor) values
  ('b9000000-0000-0000-0000-000000000001', :E, pg_temp.chq('101'), 'CH 101', 'CLIENTE DO CHEQUE EXEMPLO', '2026-12-10', 600),
  ('b9000000-0000-0000-0000-000000000001', :E, pg_temp.chq('202'), 'CH 202', 'CLIENTE DO CHEQUE EXEMPLO', '2026-11-11', 700);
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha(format($q$select chq_depositar('e000000a-0000-0000-0000-000000000000', array[%L]::uuid[], 'c000000a-0000-0000-0000-000000000000', '2026-11-12')$q$, pg_temp.chq('202')), 'cheque em proposta pendente não deposita');
select pg_temp.falha(format($q$select chq_cancelar_recebimento(%L, 'tentativa indevida')$q$, :'REC1'), 'recebimento com cheque em proposta não cancela');
reset role;
select _aprovar_proposta_fidc('b9000000-0000-0000-0000-000000000001', null, 'a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) = 2 and bool_and(situacao = 'fidc' and fundo = 'Fundo Cheques' and fidc_proposta_id = 'b9000000-0000-0000-0000-000000000001') from chq_cheques where id in (pg_temp.chq('101'), pg_temp.chq('202'))), 'aprovação marca os cheques como enviados ao FIDC');
select pg_temp.ok(pg_temp.saldo(:'CART') = 1100 and pg_temp.saldo('c900000a-0000-0000-0000-000000000001') = 1300, 'cheques saem da carteira para a conta do fundo');
select pg_temp.ok((select count(*) from fidc_titulos where bordero = 'P9154' and titulo in ('CH 101', 'CH 202')) = 2, 'cheques entram na carteira cedida do fundo');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select chq_compensar(array[pg_temp.chq('202')], '2026-11-13');
select chq_devolver(pg_temp.chq('101'), '2026-12-11', '11');
select pg_temp.ok((select origem_devolucao = 'fidc' and situacao = 'devolvido' from chq_cheques where id = pg_temp.chq('101')) and pg_temp.saldo(:'CART') = 1700, 'cheque devolvido pelo fundo volta à carteira');

-- ---------- cheques próprios ----------
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($q$insert into chq_taloes(empresa_id, conta_id, numero_ini, numero_fim) values ('e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 1, 20)$q$, 'leitura não cadastra talão');
select pg_temp.ok((select count(*) from chq_cheques where empresa_id = :E) > 0, 'leitura consulta os cheques');
select pg_temp.falha(format($q$select chq_compensar(array[%L]::uuid[], '2026-11-13')$q$, pg_temp.chq('204')), 'leitura não movimenta');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($q$insert into chq_cheques(empresa_id, recebimento, banco, numero, valor, bom_para, recebido_em) values ('e000000a-0000-0000-0000-000000000000', gen_random_uuid(), '1', '1', 1, current_date, current_date)$q$, 'cheque só entra pela função');
insert into chq_taloes(empresa_id, conta_id, numero_ini, numero_fim) values (:E, :BANCO, 500, 519);
select pg_temp.saldo(:BANCO) as "B1" \gset
select pg_temp.falha($q$select chq_emitir('e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', null, 'ef900000-0000-0000-0000-000000000002', null, 700, '2026-11-12', '2026-11-30', array['a9000000-0000-0000-0000-000000000004']::uuid[])$q$, 'cheque próprio precisa do valor exato dos títulos');
select chq_emitir(:E, :BANCO, null, 'ef900000-0000-0000-0000-000000000002', 'Fornecedor do Cheque Exemplo', 800, '2026-11-12', '2026-11-30', array['a9000000-0000-0000-0000-000000000004']::uuid[]) as "EM1" \gset
select pg_temp.ok((select numero = 500 and talao_id is not null and situacao = 'emitido' and bom_para = '2026-11-30' from chq_emitidos where id = :'EM1'), 'usa a primeira folha livre do talão');
select pg_temp.ok((select status = 'Pago' and conta_id = :'EMIT' and data = '2026-11-12' from lancamentos where id = 'a9000000-0000-0000-0000-000000000004') and pg_temp.saldo(:'EMIT') = -800 and pg_temp.saldo(:BANCO) = :B1, 'emissão baixa o título na conta de cheques emitidos, sem mexer no banco');
select chq_emitido_compensar(:'EM1', '2026-12-01');
select pg_temp.ok(pg_temp.saldo(:'EMIT') = 0 and pg_temp.saldo(:BANCO) = :B1 - 800 and (select situacao = 'compensado' from chq_emitidos where id = :'EM1'), 'compensação tira o dinheiro do banco');
select pg_temp.falha(format($q$select chq_emitido_cancelar(%L, 'não pode mais')$q$, :'EM1'), 'compensado não cancela');
select chq_emitir(:E, :BANCO, null, 'ef900000-0000-0000-0000-000000000002', null, 450, '2026-11-12', null, array['a9000000-0000-0000-0000-000000000005']::uuid[]) as "EM2" \gset
select pg_temp.ok((select numero = 501 from chq_emitidos where id = :'EM2'), 'próxima folha');
select chq_emitido_cancelar(:'EM2', 'fornecedor pediu PIX', true);
select pg_temp.ok((select situacao = 'sustado' from chq_emitidos where id = :'EM2') and (select status = 'Em aberto' and conta_id is null and data = '2026-11-21' from lancamentos where id = 'a9000000-0000-0000-0000-000000000005'), 'sustar devolve o título em aberto, no vencimento original');
select pg_temp.falha($q$select chq_emitir('e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 501, null, null, 10, '2026-11-12', null, '{}', 'f000000a-0000-0000-0000-000000000000')$q$, 'folha sustada não é reutilizada');
select pg_temp.falha($q$select chq_emitir('e000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', null, null, null, 10, '2026-11-12', null)$q$, 'cheque sem título exige a conta do plano');
select chq_emitir(:E, :BANCO, null, null, 'Ao portador', 90, '2026-11-12', null, '{}', 'f000000a-0000-0000-0000-000000000000', 'adiantamento') as "EM3" \gset
select pg_temp.ok((select numero = 502 from chq_emitidos where id = :'EM3') and pg_temp.saldo(:'EMIT') = -90, 'cheque avulso lança a despesa');
select chq_emitido_devolver(:'EM3', '2026-11-14', '11');
select chq_emitido_cancelar(:'EM3', 'devolvido e substituído');
select pg_temp.ok(pg_temp.saldo(:'EMIT') = 0 and (select situacao = 'cancelado' from chq_emitidos where id = :'EM3'), 'cancelar o avulso apaga a despesa');
select chq_folha_inutilizar(:E, :BANCO, 503, 'folha rasurada');
select chq_emitir(:E, :BANCO, null, null, null, 20, '2026-11-12', null, '{}', 'f000000a-0000-0000-0000-000000000000') as "EM4" \gset
select pg_temp.ok((select numero = 504 from chq_emitidos where id = :'EM4'), 'folha inutilizada é pulada');
reset role;
select pg_temp.ok((select count(*) from chq_eventos where empresa_id = :E and emitido_id is not null) >= 8 and (select count(*) from auditoria where tabela = 'chq_cheques') > 0, 'histórico e auditoria gravados');

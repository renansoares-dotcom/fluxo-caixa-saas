-- Checklist do fechamento (SQL 107): prazo em dia útil, tarefas, quem marca, fechar/reabrir e trava dos lançamentos.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, false);
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

-- dias úteis (feriados nacionais, carnaval, Sexta-feira Santa, Corpus Christi)
select pg_temp.ok(_fech_prazo('2026-10', 1) = '2026-11-03', 'D+1 de outubro pula Finados');
select pg_temp.ok(_fech_prazo('2026-10', 0) = '2026-10-30', 'D+0 = último dia útil do mês');
select pg_temp.ok(_fech_prazo('2027-01', 6) = '2027-02-10', 'carnaval de 2027 (8 e 9/02) não conta');
select pg_temp.ok(not _eh_dia_util('2027-03-26'), 'Sexta-feira Santa de 2027');

-- financeiro monta o modelo padrão; compras não
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.falha($$select fechamento_modelo_padrao('e000000a-0000-0000-0000-000000000000')$$, 'compras não monta o checklist');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok(fechamento_modelo_padrao(:E) = 10, 'modelo padrão com 10 tarefas');
select pg_temp.falha($$select fechamento_modelo_padrao('e000000a-0000-0000-0000-000000000000')$$, 'não duplica o modelo');
insert into fechamento_modelos(empresa_id, titulo, dia_util, responsavel, ordem) values (:E, 'Conciliar o caixa físico', 2, 'c0000000-0000-0000-0000-00000000000c', 11);

-- leitura gera as tarefas do mês (idempotente)
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok(fechamento_gerar(:E, '2026-09') = 11, 'gera 11 tarefas');
select pg_temp.ok(fechamento_gerar(:E, '2026-09') = 0, 'não duplica');
select pg_temp.ok((select prazo from fechamento_tarefas where mes = '2026-09' and titulo = 'Conciliar o caixa físico') = '2026-10-02', 'prazo D+2 de setembro');
-- leitura é responsável só pela própria tarefa
select id as t_caixa from fechamento_tarefas where mes = '2026-09' and titulo = 'Conciliar o caixa físico' \gset
select id as t_dre from fechamento_tarefas where mes = '2026-09' and titulo like 'Revisar a DRE%' \gset
select fechamento_marcar(:'t_caixa', 'feita', 'contado com o caixa');
select pg_temp.ok((select situacao from fechamento_tarefas where id = :'t_caixa') = 'feita', 'responsável marca a própria tarefa');
select pg_temp.falha($$select fechamento_marcar('$$ || :'t_dre' || $$', 'feita')$$, 'leitura não marca tarefa do financeiro');
update fechamento_tarefas set situacao = 'feita';
select pg_temp.ok((select count(*) from fechamento_tarefas where situacao = 'feita') = 1, 'tarefa não muda direto na tabela');
select pg_temp.falha($$select fechamento_fechar('e000000a-0000-0000-0000-000000000000', '2026-09')$$, 'leitura não fecha o mês');

-- financeiro marca "não se aplica" (exige motivo); fechar exige papel do parâmetro (padrão: admin e diretor)
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select fechamento_marcar('$$ || :'t_dre' || $$', 'nao_aplica', '')$$, 'não se aplica pede motivo');
select fechamento_marcar(:'t_dre', 'nao_aplica', 'DRE enviada na reunião');
select pg_temp.falha($$select fechamento_fechar('e000000a-0000-0000-0000-000000000000', '2026-09', '[]', 'justificativa bem longa')$$, 'financeiro não fecha pelo padrão');

-- lançamentos de setembro (antes de fechar)
reset role;
insert into lancamentos(id, empresa_id, data, plano_id, conta_id, valor, descricao, status) values
  ('aa000107-0000-0000-0000-000000000001', :E, '2026-09-10', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 50, 'pago em setembro', 'Pago'),
  ('aa000107-0000-0000-0000-000000000002', :E, '2026-09-20', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 70, 'em aberto de setembro', 'Em aberto');

-- administrador fecha: com pendência exige justificativa
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha($$select fechamento_fechar('e000000a-0000-0000-0000-000000000000', '2026-09', '[]', null)$$, 'pendência sem justificativa');
select pg_temp.falha($$select fechamento_fechar('e000000a-0000-0000-0000-000000000000', to_char(current_date, 'YYYY-MM'), '[]', 'justificativa bem longa')$$, 'não fecha o mês corrente');
select fechamento_fechar(:E, '2026-09', '[{"k":"ext","titulo":"Extratos"}]', 'extratos conferidos à mão com o banco');
select pg_temp.ok((select situacao from fechamento_meses where mes = '2026-09') = 'fechado', 'mês fechado');
select pg_temp.ok(fech_mes_fechado(:E, '2026-09-15'), 'fech_mes_fechado');
select pg_temp.falha($$select fechamento_marcar('$$ || :'t_caixa' || $$', 'pendente')$$, 'checklist travado com o mês fechado');
select pg_temp.falha($$select fechamento_fechar('e000000a-0000-0000-0000-000000000000', '2026-09', '[]', 'justificativa bem longa')$$, 'não fecha duas vezes');

-- trava dos lançamentos pagos do mês
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$update lancamentos set valor = 51 where id = 'aa000107-0000-0000-0000-000000000001'$$, 'valor travado');
select pg_temp.falha($$delete from lancamentos where id = 'aa000107-0000-0000-0000-000000000001'$$, 'exclusão travada');
select pg_temp.falha($$insert into lancamentos(empresa_id, data, plano_id, conta_id, valor, status) values ('e000000a-0000-0000-0000-000000000000', '2026-09-30', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 1, 'Pago')$$, 'não lança pago no mês fechado');
select pg_temp.falha($$update lancamentos set status = 'Pago' where id = 'aa000107-0000-0000-0000-000000000002'$$, 'não baixa com data no mês fechado');
update lancamentos set descricao = 'pago em setembro (obs)' where id = 'aa000107-0000-0000-0000-000000000001';
update lancamentos set status = 'Pago', data = '2026-10-05' where id = 'aa000107-0000-0000-0000-000000000002';
reset role;
select pg_temp.ok((select descricao from lancamentos where id = 'aa000107-0000-0000-0000-000000000001') = 'pago em setembro (obs)', 'descrição continua livre');
select pg_temp.ok((select status from lancamentos where id = 'aa000107-0000-0000-0000-000000000002') = 'Pago', 'baixa com data fora do mês fechado');

-- reabrir: perfil do parâmetro e motivo
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select fechamento_reabrir('e000000a-0000-0000-0000-000000000000', '2026-09', 'nota chegou depois do fechamento')$$, 'financeiro não reabre pelo padrão');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha($$select fechamento_reabrir('e000000a-0000-0000-0000-000000000000', '2026-09', 'curto')$$, 'motivo curto');
select fechamento_reabrir(:E, '2026-09', 'nota de despesa de setembro chegou depois');
update lancamentos set valor = 51 where id = 'aa000107-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select valor from lancamentos where id = 'aa000107-0000-0000-0000-000000000001') = 51, 'reaberto: volta a alterar');
select pg_temp.ok((select count(*) from fechamento_eventos where mes = '2026-09' and acao in ('fechou', 'reabriu')) = 2, 'histórico de fechar e reabrir');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'fechamento' and user_id = 'd0000000-0000-0000-0000-00000000000d') = 2, 'financeiro avisado do fechamento e da reabertura');

-- lembretes: tarefa manual que vence hoje, responsável avisado uma vez por dia
insert into fechamento_config(empresa_id) values (:E);
update fechamento_tarefas set prazo = current_date where id = :'t_dre';
update fechamento_tarefas set situacao = 'pendente' where id = :'t_dre';
select pg_temp.ok(_fech_lembretes() >= 1, 'lembra a tarefa que vence hoje');
select pg_temp.ok(_fech_lembretes() = 0, 'um aviso por dia');

-- outra empresa
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from fechamento_tarefas) = 0, 'outra empresa não vê');
select pg_temp.falha($$select fechamento_gerar('e000000a-0000-0000-0000-000000000000', '2026-10')$$, 'outra empresa não gera');

reset role;
delete from lancamentos where id::text like 'aa000107%';
delete from notificacoes where tipo = 'fechamento';
delete from fechamento_eventos; delete from fechamento_meses; delete from fechamento_tarefas; delete from fechamento_modelos; delete from fechamento_config;
\o
select 'ok 43 checklist do fechamento';

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
-- Análise de Problemas (SQL 172): Pareto, Ishikawa, 5 porquês e 5W2H — abertura, análise, plano de ação, eficácia, avisos e permissões
\set A '''a0000000-0000-0000-0000-00000000000a'''
\set F '''d0000000-0000-0000-0000-00000000000d'''
\set C '''f0000000-0000-0000-0000-00000000000f'''
\set L '''c0000000-0000-0000-0000-00000000000c'''
\set B '''b0000000-0000-0000-0000-00000000000b'''
create temp table tp (k text primary key, id uuid); grant all on tp to authenticated;
delete from notificacoes where tipo = 'problema';

-- leitura não abre; compras abre para si (sem aviso para quem abriu)
select pg_temp.entrar(:L);
select pg_temp.falha($$select prob_abrir('e000000a-0000-0000-0000-000000000000', '{"titulo":"Atraso na entrega"}')$$, 'leitura não abre problema');
reset role;
select pg_temp.entrar(:C);
select pg_temp.falha($$select prob_abrir('e000000a-0000-0000-0000-000000000000', '{"titulo":"abc"}')$$, 'título curto');
select pg_temp.falha($$select prob_abrir('e000000a-0000-0000-0000-000000000000', '{"titulo":"Atraso na entrega","responsavel_id":"b0000000-0000-0000-0000-00000000000b"}')$$, 'responsável de outra empresa');
insert into tp select 'p1', prob_abrir(:E, '{"titulo":"Atraso na entrega dos pedidos","area":"Logística","gravidade":"alta"}');
reset role;
select pg_temp.ok((select numero = 1 and situacao = 'aberto' and responsavel_id = :C and area = 'Logística' and aberto_por = :C from prob_problemas where id = (select id from tp where k = 'p1')), 'problema 1 aberto, responsável é quem abriu');
select pg_temp.ok((select count(*) = 0 from notificacoes where tipo = 'problema'), 'quem abre para si não recebe aviso');

-- financeiro abre com o administrador como responsável: aviso para o administrador
select pg_temp.entrar(:F);
insert into tp select 'p2', prob_abrir(:E, jsonb_build_object('titulo', 'Refugo alto na extrusora 2', 'responsavel_id', :A, 'origem_tipo', 'pareto', 'origem_ref', 'Refugos · Bolha instável'));
reset role;
select pg_temp.ok((select numero = 2 and responsavel_id = :A and origem_tipo = 'pareto' from prob_problemas where id = (select id from tp where k = 'p2')), 'problema 2 com responsável e origem');
select pg_temp.ok((select count(*) = 1 from notificacoes where tipo = 'problema' and user_id = :A and titulo like 'Problema nº 2%'), 'responsável avisado');

select pg_temp.entrar(:L);
select pg_temp.ok((select count(*) >= 3 from prob_pessoas(:E)) and (select count(*) = 3 from prob_pessoas(:E) where user_id in (:A, :F, :C)) and (select count(*) = 0 from prob_pessoas(:E) where papel = 'leitura') and (select bool_and(nome is not null) from prob_pessoas(:E)), 'pessoas que podem ser responsáveis: admin, financeiro e compras, com nome');
reset role;
select pg_temp.entrar(:B);
select pg_temp.ok((select count(*) = 0 from prob_pessoas(:E)), 'empresa B não lista as pessoas da A');
reset role;
-- tabela não aceita gravação direta; outra empresa não vê nem altera
select pg_temp.entrar(:A);
select pg_temp.falha($$insert into prob_problemas(empresa_id, numero, titulo) values ('e000000a-0000-0000-0000-000000000000', 99, 'direto na tabela')$$, 'sem gravação direta');
select pg_temp.falha($$update prob_problemas set situacao = 'encerrado'$$, 'sem alteração direta');
reset role;
select pg_temp.ok((select count(*) = 2 from prob_problemas where situacao = 'aberto'), 'nada mudou');
select pg_temp.entrar(:B);
select pg_temp.ok((select count(*) = 0 from prob_problemas), 'empresa B não vê os problemas da A');
select pg_temp.falha(format($$select prob_salvar(%L, '{"causa_raiz":"x"}')$$, (select id from tp where k = 'p1')), 'empresa B não altera');
reset role;

-- análise: Ishikawa e 5 porquês tiram o problema de "aberto"; leitura não grava
select pg_temp.entrar(:L);
select pg_temp.ok((select count(*) = 2 from prob_problemas), 'leitura enxerga');
select pg_temp.falha(format($$select prob_salvar(%L, '{"causa_raiz":"x"}')$$, (select id from tp where k = 'p1')), 'leitura não grava a análise');
reset role;
select pg_temp.entrar(:F);
select prob_salvar((select id from tp where k = 'p1'), '{"ishikawa":[{"categoria":"Método","causas":[{"texto":"Sem roteiro de carga","provavel":true}]},{"categoria":"Máquina","causas":[{"texto":"Caminhão quebrado","provavel":true}]}]}');
reset role;
select pg_temp.ok((select situacao = 'em_analise' and jsonb_array_length(ishikawa) = 2 and causa_raiz is null from prob_problemas where id = (select id from tp where k = 'p1')), 'Ishikawa gravado: em análise');
select pg_temp.entrar(:F);
select pg_temp.falha(format($$select prob_salvar(%L, '{"responsavel_id":"d0000000-0000-0000-0000-00000000000d"}')$$, (select id from tp where k = 'p1')), 'quem não conduz não troca o responsável');
select pg_temp.falha(format($$select prob_encerrar(%L, 'eficaz', null)$$, (select id from tp where k = 'p1')), 'quem não conduz não encerra');
reset role;
select pg_temp.entrar(:C);
select pg_temp.falha(format($$select prob_encerrar(%L, 'eficaz', null)$$, (select id from tp where k = 'p1')), 'não encerra sem causa raiz');
select prob_salvar((select id from tp where k = 'p1'), '{"porques":[{"partida":"Caminhão quebrado","respostas":["Faltou manutenção","Peça em falta","Orçamento negado"],"causa":"Orçamento de manutenção insuficiente"}],"causa_raiz":"Orçamento de manutenção insuficiente"}');
select pg_temp.falha(format($$select prob_encerrar(%L, 'eficaz', null)$$, (select id from tp where k = 'p1')), 'não encerra sem ação concluída');

-- 5W2H: validações, numeração, aviso ao responsável e situação do problema
select pg_temp.falha(format($$select prob_acao_salvar(%L, null, '{"o_que":"Rever orçamento","responsavel_id":"a0000000-0000-0000-0000-00000000000a"}')$$, (select id from tp where k = 'p1')), 'ação sem prazo');
select pg_temp.falha(format($$select prob_acao_salvar(%L, null, '{"o_que":"Rever orçamento","prazo":"2026-12-10"}')$$, (select id from tp where k = 'p1')), 'ação sem responsável');
select pg_temp.falha(format($$select prob_acao_salvar(%L, null, '{"o_que":"Rever orçamento","prazo":"2026-12-10","inicio":"2026-12-20","responsavel_nome":"João"}')$$, (select id from tp where k = 'p1')), 'início depois do prazo');
insert into tp select 'a1', prob_acao_salvar((select id from tp where k = 'p1'), null, '{"o_que":"Rever o orçamento de manutenção","por_que":"Peças em falta param a frota","onde":"Diretoria","prazo":"2026-12-10","responsavel_id":"a0000000-0000-0000-0000-00000000000a","como":"Reunião com a diretoria","custo_previsto":"1500"}');
insert into tp select 'a2', prob_acao_salvar((select id from tp where k = 'p1'), null, '{"o_que":"Contratar oficina de apoio","prazo":"2026-12-15","responsavel_nome":"Oficina externa"}');
reset role;
select pg_temp.ok((select situacao = 'em_acao' from prob_problemas where id = (select id from tp where k = 'p1')), 'com ação, o problema fica em ação');
select pg_temp.ok((select numero = 1 and custo_previsto = 1500 and responsavel_nome is not null and situacao = 'pendente' from prob_acoes where id = (select id from tp where k = 'a1')) and (select numero = 2 and responsavel_id is null and responsavel_nome = 'Oficina externa' from prob_acoes where id = (select id from tp where k = 'a2')), 'ações 1 e 2 gravadas');
select pg_temp.ok((select count(*) = 1 from notificacoes where tipo = 'problema' and user_id = :A and titulo like 'Nova ação para você%' and ref_id = (select id from tp where k = 'a1')), 'responsável da ação avisado');

-- andamento: só o responsável da ação ou quem conduz
select pg_temp.entrar(:F);
select pg_temp.falha(format($$select prob_acao_situacao(%L, 'concluida', '{}')$$, (select id from tp where k = 'a1')), 'terceiro não conclui a ação');
reset role;
select pg_temp.entrar(:C);
select pg_temp.falha(format($$select prob_encerrar(%L, 'eficaz', null)$$, (select id from tp where k = 'p1')), 'não encerra com ação em aberto');
select pg_temp.falha(format($$select prob_acao_situacao(%L, 'cancelada', '{}')$$, (select id from tp where k = 'a2')), 'cancelar ação pede motivo');
select pg_temp.ok(prob_acao_situacao((select id from tp where k = 'a2'), 'cancelada', '{"evidencia":"Oficina própria resolve"}') = 'em_acao', 'ação 2 cancelada: ainda há ação aberta');
reset role;
select pg_temp.entrar(:A);
select pg_temp.ok(prob_acao_situacao((select id from tp where k = 'a1'), 'em_andamento', '{}') = 'em_acao', 'em andamento');
select pg_temp.ok(prob_acao_situacao((select id from tp where k = 'a1'), 'concluida', '{"evidencia":"Orçamento aprovado em ata","custo_real":"1800"}') = 'verificacao', 'todas concluídas: verificação');
select pg_temp.falha(format($$select prob_acao_salvar(%L, %L, '{"o_que":"Outra coisa","prazo":"2026-12-10","responsavel_nome":"x"}')$$, (select id from tp where k = 'p1'), (select id from tp where k = 'a1')), 'ação concluída não é alterada');
reset role;
select pg_temp.ok((select situacao = 'concluida' and concluida_em is not null and custo_real = 1800 from prob_acoes where id = (select id from tp where k = 'a1')), 'ação concluída com evidência e custo real');
select pg_temp.ok((select count(*) = 1 from notificacoes where tipo = 'problema' and user_id = :C and titulo like '%ações concluídas'), 'quem conduz é avisado para verificar a eficácia');

-- eficácia: não eficaz volta para a análise; eficaz encerra
select pg_temp.entrar(:C);
select pg_temp.falha(format($$select prob_encerrar(%L, null, null)$$, (select id from tp where k = 'p1')), 'eficácia obrigatória');
select pg_temp.falha(format($$select prob_encerrar(%L, 'nao_eficaz', null)$$, (select id from tp where k = 'p1')), 'não eficaz pede o que foi verificado');
select pg_temp.ok(prob_encerrar((select id from tp where k = 'p1'), 'nao_eficaz', 'Os atrasos continuaram em dezembro') = 'em_analise', 'não eficaz: volta para a análise');
select pg_temp.ok(prob_encerrar((select id from tp where k = 'p1'), 'eficaz', 'Sem atraso em janeiro') = 'encerrado', 'eficaz: encerrado');
select pg_temp.falha(format($$select prob_salvar(%L, '{"causa_raiz":"outra"}')$$, (select id from tp where k = 'p1')), 'encerrado não aceita alteração');
select pg_temp.falha(format($$select prob_reabrir(%L, 'voltou a acontecer')$$, (select id from tp where k = 'p1')), 'compras não reabre');
reset role;
select pg_temp.ok((select situacao = 'encerrado' and eficacia = 'eficaz' and encerrado_em is not null and encerrado_por is not null from prob_problemas where id = (select id from tp where k = 'p1')), 'encerramento registrado');
select pg_temp.ok((select count(*) >= 8 from prob_diario where problema_id = (select id from tp where k = 'p1') and tipo = 'sistema'), 'diário registra os passos');
select pg_temp.entrar(:A);
select prob_reabrir((select id from tp where k = 'p1'), 'Voltou a acontecer em fevereiro');
select prob_acao_reabrir((select id from tp where k = 'a1'));
select prob_comentar((select id from tp where k = 'p1'), 'Conferir com a logística na segunda.');
reset role;
select pg_temp.ok((select situacao = 'em_acao' and eficacia is null from prob_problemas where id = (select id from tp where k = 'p1')) and (select situacao = 'pendente' from prob_acoes where id = (select id from tp where k = 'a1')), 'reaberto, com a ação de volta');
select pg_temp.ok((select count(*) = 1 from prob_diario where problema_id = (select id from tp where k = 'p1') and tipo = 'comentario'), 'comentário no diário');

-- cancelar o problema cancela as ações abertas
select pg_temp.entrar(:A);
select pg_temp.falha(format($$select prob_cancelar(%L, 'x')$$, (select id from tp where k = 'p1')), 'cancelar pede motivo');
select prob_cancelar((select id from tp where k = 'p1'), 'Aberto em duplicidade');
reset role;
select pg_temp.ok((select situacao = 'cancelado' from prob_problemas where id = (select id from tp where k = 'p1')) and (select count(*) = 0 from prob_acoes where problema_id = (select id from tp where k = 'p1') and situacao in ('pendente', 'em_andamento')), 'cancelado com as ações');

-- parâmetros: só administrador ou diretor; sem exigir eficácia, encerra direto
select pg_temp.entrar(:F);
select pg_temp.falha($$select prob_config_salvar('e000000a-0000-0000-0000-000000000000', '{"dias_aviso":5}')$$, 'financeiro não altera os parâmetros');
reset role;
select pg_temp.entrar(:A);
select pg_temp.falha($$select prob_config_salvar('e000000a-0000-0000-0000-000000000000', '{"categorias":["A","B"]}')$$, 'menos de 3 categorias');
select prob_config_salvar(:E, '{"exige_eficacia":false,"exige_causa":false,"dias_aviso":3,"categorias":["Método","Máquina","Pessoas","Material"]}');
insert into tp select 'a3', prob_acao_salvar((select id from tp where k = 'p2'), null, jsonb_build_object('o_que', 'Trocar a matriz', 'prazo', (current_date + 2)::text, 'responsavel_id', :F));
insert into tp select 'a4', prob_acao_salvar((select id from tp where k = 'p2'), null, jsonb_build_object('o_que', 'Calibrar o anel de ar', 'prazo', (current_date - 3)::text, 'responsavel_id', :F));
reset role;
select pg_temp.ok((select dias_aviso = 3 and not exige_eficacia and jsonb_array_length(categorias) = 4 and exige_acao from prob_config where empresa_id = :E), 'parâmetros gravados');

-- avisos de prazo: lembrete uma vez, cobrança do atraso uma vez (e para o dono do problema)
delete from notificacoes where tipo = 'problema';
select pg_temp.ok(_prob_avisos() = 2, 'um lembrete e uma cobrança');
select pg_temp.ok((select count(*) = 1 from notificacoes where user_id = :F and titulo like 'Ação vence em%') and (select count(*) = 2 from notificacoes where titulo like 'Ação atrasada há 3 dia(s)' and user_id in (:F, :A)), 'lembrete ao responsável; atraso ao responsável e ao dono do problema');
select pg_temp.ok(_prob_avisos() = 0 or extract(isodow from (now() at time zone 'America/Recife')::date) = 1, 'não repete no mesmo dia');
select pg_temp.ok((select lembrado_em is not null from prob_acoes where id = (select id from tp where k = 'a3')) and (select cobrado_em is not null from prob_acoes where id = (select id from tp where k = 'a4')), 'datas dos avisos gravadas');
select pg_temp.entrar(:F);
select prob_acao_situacao((select id from tp where k = 'a3'), 'concluida', '{}');
select prob_acao_situacao((select id from tp where k = 'a4'), 'concluida', '{}');
reset role;
select pg_temp.entrar(:A);
select pg_temp.ok(prob_encerrar((select id from tp where k = 'p2'), null, null) = 'encerrado', 'sem exigir causa e eficácia, encerra');
reset role;

-- Pareto com dado da plataforma
insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values ('f0000a72-0000-0000-0000-000000000000', :E, '1.01.72', 'VENDAS TESTE 172', 'C', 2, 'E') on conflict do nothing;
insert into favorecidos(id, empresa_id, nome, documento) values ('fa0000a7-0000-0000-0000-000000000001', :E, 'CLIENTE DEVEDOR 172', '11444777000161'), ('fa0000a7-0000-0000-0000-000000000002', :E, 'CLIENTE PEQUENO 172', '22555888000102') on conflict do nothing;
insert into lancamentos(empresa_id, data, plano_id, conta_id, valor, descricao, favorecido_id, status) values
  (:E, '2026-03-10', 'f0000a72-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 900, 'título vencido 1', 'fa0000a7-0000-0000-0000-000000000001', 'Em aberto'),
  (:E, '2026-03-20', 'f0000a72-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 600, 'título vencido 2', 'fa0000a7-0000-0000-0000-000000000001', 'Em aberto'),
  (:E, '2026-03-15', 'f0000a72-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 200, 'título vencido 3', 'fa0000a7-0000-0000-0000-000000000002', 'Em aberto'),
  (:E, '2026-03-18', 'f0000a72-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 5000, 'título pago', 'fa0000a7-0000-0000-0000-000000000002', 'Pago');
select pg_temp.entrar(:F);
select pg_temp.ok((select valor = 1500 and qtd = 2 from prob_pareto(:E, 'vencidos', '2026-03-01', '2026-03-31') where nome = 'CLIENTE DEVEDOR 172') and (select valor = 200 from prob_pareto(:E, 'vencidos', '2026-03-01', '2026-03-31') where nome = 'CLIENTE PEQUENO 172'), 'vencidos por cliente, sem o título pago');
select pg_temp.falha($$select * from prob_pareto('e000000a-0000-0000-0000-000000000000', 'inexistente', '2026-03-01', '2026-03-31')$$, 'fonte desconhecida');
select pg_temp.falha($$select * from prob_pareto('e000000a-0000-0000-0000-000000000000', 'paradas', '2026-03-31', '2026-03-01')$$, 'período invertido');
select pg_temp.ok((select count(*) >= 0 from prob_pareto(:E, 'paradas', '2026-01-01', '2026-12-31')) and (select count(*) >= 0 from prob_pareto(:E, 'refugos', '2026-01-01', '2026-12-31')) and (select count(*) >= 0 from prob_pareto(:E, 'falhas', '2026-01-01', '2026-12-31'))
  and (select count(*) >= 0 from prob_pareto(:E, 'rnc_produto', '2026-01-01', '2026-12-31')) and (select count(*) >= 0 from prob_pareto(:E, 'rnc_custo', '2026-01-01', '2026-12-31')) and (select count(*) >= 0 from prob_pareto(:E, 'devolucoes', '2026-01-01', '2026-12-31')), 'as demais fontes respondem');
reset role;
select pg_temp.entrar(:C);
select pg_temp.falha($$select * from prob_pareto('e000000a-0000-0000-0000-000000000000', 'vencidos', '2026-03-01', '2026-03-31')$$, 'compras não consulta os títulos vencidos');
reset role;
select pg_temp.entrar(:B);
select pg_temp.falha($$select * from prob_pareto('e000000a-0000-0000-0000-000000000000', 'falhas', '2026-03-01', '2026-03-31')$$, 'empresa B não consulta o Pareto da A');
reset role;
delete from lancamentos where descricao like 'título vencido %' or descricao = 'título pago';
delete from notificacoes where tipo = 'problema';

-- SQL 173: anexos e fontes novas do Pareto
select pg_temp.ok((select not public and file_size_limit = 10485760 from storage.buckets where id = 'problemas'), 'bucket privado de 10 MB');
select pg_temp.ok((select count(*) = 3 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'problemas_arq_%'), 'políticas do bucket');
select pg_temp.entrar(:F);
insert into tp select 'p3', prob_abrir(:E, '{"titulo":"Problema para os anexos"}');
insert into tp select 'a9', prob_acao_salvar((select id from tp where k = 'p3'), null, '{"o_que":"Ação com evidência","prazo":"2027-01-10","responsavel_nome":"Terceiro"}');
select pg_temp.falha(format($$select prob_anexar(%L, null, 'outra/pasta/foto.jpg', 'foto.jpg')$$, (select id from tp where k = 'p3')), 'caminho fora da pasta do problema');
select pg_temp.falha(format($$select prob_anexar(%L, %L, %L, 'foto.jpg')$$, (select id from tp where k = 'p3'), (select id from tp where k = 'a1'), :E::text || '/' || (select id from tp where k = 'p3') || '/1-foto.jpg'), 'ação de outro problema');
insert into tp select 'x1', prob_anexar((select id from tp where k = 'p3'), (select id from tp where k = 'a9'), :E::text || '/' || (select id from tp where k = 'p3') || '/1-foto.jpg', 'foto do anel.jpg', 'image/jpeg', 120000);
reset role;
select pg_temp.ok((select nome = 'foto do anel.jpg' and acao_id is not null and criado_por = :F and criado_por_nome is not null from prob_anexos where id = (select id from tp where k = 'x1')), 'anexo registrado na ação');
select pg_temp.ok((select count(*) = 1 from prob_diario where problema_id = (select id from tp where k = 'p3') and texto like 'Anexo incluído: foto do anel.jpg (ação 1).'), 'anexo no diário');
select pg_temp.entrar(:L);
select pg_temp.ok((select count(*) = 1 from prob_anexos where problema_id = (select id from tp where k = 'p3')), 'leitura enxerga o anexo');
select pg_temp.falha(format($$select prob_anexar(%L, null, %L, 'x.pdf')$$, (select id from tp where k = 'p3'), :E::text || '/' || (select id from tp where k = 'p3') || '/2-x.pdf'), 'leitura não anexa');
reset role;
select pg_temp.entrar(:C);
select pg_temp.falha(format($$select prob_anexo_excluir(%L)$$, (select id from tp where k = 'x1')), 'terceiro não exclui o anexo');
select pg_temp.falha($$insert into prob_anexos(empresa_id, problema_id, caminho, nome) select empresa_id, id, 'x', 'y' from prob_problemas limit 1$$, 'sem gravação direta de anexo');
reset role;
select pg_temp.entrar(:B);
select pg_temp.ok((select count(*) = 0 from prob_anexos), 'empresa B não vê os anexos');
reset role;
select pg_temp.entrar(:F);
select pg_temp.ok(prob_anexo_excluir((select id from tp where k = 'x1')) like '%/1-foto.jpg', 'quem enviou exclui e recebe o caminho');
select pg_temp.ok((select count(*) >= 0 from prob_pareto(:E, 'entregas_atraso', '2026-01-01', '2026-12-31')) and (select count(*) >= 0 from prob_pareto(:E, 'ocorrencias', '2026-01-01', '2026-12-31')), 'fontes da logística respondem');
reset role;
-- pedido de compra atrasado: previsto para 10/03, recebido em 15/03 (atrasado); outro previsto para 20/03 e recebido em 18/03 (no prazo)
alter table compras_pedidos disable trigger user; alter table compras_recebimentos disable trigger user;
insert into compras_pedidos(id, empresa_id, numero, favorecido_id, data_pedido, entrega_prevista, total, status) values
  ('c0170000-0000-0000-0000-000000000001', :E, 91731, 'fa0000a7-0000-0000-0000-000000000001', '2026-03-01', '2026-03-10', 100, 'recebido'),
  ('c0170000-0000-0000-0000-000000000002', :E, 91732, 'fa0000a7-0000-0000-0000-000000000001', '2026-03-01', '2026-03-20', 100, 'recebido'),
  ('c0170000-0000-0000-0000-000000000003', :E, 91733, 'fa0000a7-0000-0000-0000-000000000002', '2026-03-01', '2026-03-12', 100, 'enviado'),
  ('c0170000-0000-0000-0000-000000000004', :E, 91734, 'fa0000a7-0000-0000-0000-000000000002', '2026-03-01', '2026-03-12', 100, 'cancelado');
insert into compras_recebimentos(empresa_id, pedido_id, data) values (:E, 'c0170000-0000-0000-0000-000000000001', '2026-03-15'), (:E, 'c0170000-0000-0000-0000-000000000002', '2026-03-18');
alter table compras_pedidos enable trigger user; alter table compras_recebimentos enable trigger user;
select pg_temp.entrar(:C);
select pg_temp.ok((select valor = 1 from prob_pareto(:E, 'atraso_fornecedor', '2026-03-01', '2026-03-31') where nome = 'CLIENTE DEVEDOR 172') and (select valor = 1 from prob_pareto(:E, 'atraso_fornecedor', '2026-03-01', '2026-03-31') where nome = 'CLIENTE PEQUENO 172')
  and (select count(*) = 2 from prob_pareto(:E, 'atraso_fornecedor', '2026-03-01', '2026-03-31')), 'pedido recebido depois do previsto e pedido vencido sem receber contam; no prazo e cancelado não');
reset role;
alter table compras_pedidos disable trigger user; alter table compras_recebimentos disable trigger user;
delete from compras_recebimentos where pedido_id::text like 'c0170000-%'; delete from compras_pedidos where id::text like 'c0170000-%';
alter table compras_pedidos enable trigger user; alter table compras_recebimentos enable trigger user;
delete from notificacoes where tipo = 'problema';

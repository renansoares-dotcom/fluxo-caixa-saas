-- Manutenção (SQL 086): equipamentos pelas máquinas, preventiva por dias e por horas de apontamento, parada de manutenção
-- no terminal abre OS, OS que para a máquina abre e fecha a parada (sem OS duplicada), conclusão atualiza o plano,
-- peça antes da implantação do estoque, OS encerrada trava horas, isolamento (leitura não cria; outra empresa não vê).
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
grant execute on all functions in schema pg_temp to authenticated, anon;

-- produção da empresa A: setor, máquina, motivo de parada de manutenção, OP com 95 h de apontamento
insert into prod_setores(id, empresa_id, nome) values ('d1000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Extrusão MAN');
insert into prod_maquinas(id, empresa_id, setor_id, codigo, nome) values ('d1000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000001', 'EXT-91', 'EXTRUSORA 91');
insert into prod_motivos(id, empresa_id, tipo, nome) values ('d1000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', 'parada', 'Manutenção corretiva MAN');
insert into prod_ordens(id, empresa_id, numero, quantidade) values ('d1000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', 9101, 1000);
insert into prod_apontamentos(empresa_id, ordem_id, maquina_id, inicio, fim) values
  ('e000000a-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-0000000000a1', now() - interval '10 days', now() - interval '10 days' + interval '50 hours'),
  ('e000000a-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-0000000000a1', now() - interval '5 days', now() - interval '5 days' + interval '45 hours');
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values ('d1000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'PEC-9001', 'ROLAMENTO 6205', 'peca_manutencao', 'PC');
insert into produto_fornecedores(empresa_id, produto_id, emit_doc, codigo_fornecedor, fator, ultimo_preco, ultima_compra) values ('e000000a-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-0000000000d1', '12312312000112', '6205', 1, 37.5, '2026-10-01');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((man_configurar('e000000a-0000-0000-0000-000000000000') ->> 'equipamentos')::int >= 1, 'máquinas viram equipamentos');
select pg_temp.ok((man_configurar('e000000a-0000-0000-0000-000000000000') ->> 'equipamentos')::int = 0, 'não duplica');
select pg_temp.ok((select count(*) from man_falhas where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 18, 'catálogo de falhas de partida');
select pg_temp.ok((select criticidade from man_equipamentos where maquina_id = 'd1000000-0000-0000-0000-0000000000a1') = 'A', 'máquina de produção nasce crítica');
select pg_temp.ok(man_horas_maquina((select id from man_equipamentos where maquina_id = 'd1000000-0000-0000-0000-0000000000a1')) = 95, '95 h pelos apontamentos');

-- planos: por dias (nunca executado) e por horas (100 h; com 95 h já gera)
insert into man_planos(id, empresa_id, equipamento_id, nome, tipo, a_cada_dias, checklist, exige_parada)
select 'd1000000-0000-0000-0000-0000000000e1', empresa_id, id, 'Lubrificação geral', 'lubrificacao', 30, array['Engraxar mancais', 'Conferir nível do redutor'], false from man_equipamentos where maquina_id = 'd1000000-0000-0000-0000-0000000000a1';
insert into man_planos(id, empresa_id, equipamento_id, nome, a_cada_horas, ultima_horas)
select 'd1000000-0000-0000-0000-0000000000e2', empresa_id, id, 'Troca de filtros e correias', 100, 0 from man_equipamentos where maquina_id = 'd1000000-0000-0000-0000-0000000000a1';
select pg_temp.ok(man_gerar_preventivas('e000000a-0000-0000-0000-000000000000') = 2, 'duas preventivas geradas');
select pg_temp.ok(man_gerar_preventivas('e000000a-0000-0000-0000-000000000000') = 0, 'não duplica OS aberta do plano');
select pg_temp.ok((select jsonb_array_length(checklist) from man_ordens where plano_id = 'd1000000-0000-0000-0000-0000000000e1') = 2, 'checklist do plano na OS');

-- concluir a lubrificação: plano com a última execução e horas de máquina gravadas
update man_ordens set situacao = 'concluida' where plano_id = 'd1000000-0000-0000-0000-0000000000e1';
select pg_temp.ok((select ultima_data from man_planos where id = 'd1000000-0000-0000-0000-0000000000e1') = current_date, 'plano: última execução');
select pg_temp.ok((select horas_maquina from man_ordens where plano_id = 'd1000000-0000-0000-0000-0000000000e1') = 95, 'OS: horas de máquina na conclusão');
select pg_temp.falha($$insert into man_os_horas(empresa_id, ordem_id, tecnico, horas) select empresa_id, id, 'X', 1 from man_ordens where plano_id = 'd1000000-0000-0000-0000-0000000000e1'$$, 'OS encerrada não recebe horas');

-- preventiva que para a máquina: ao executar abre a parada da produção (sem abrir outra OS) e ao concluir fecha
update man_ordens set situacao = 'em_execucao', maquina_parou = true where plano_id = 'd1000000-0000-0000-0000-0000000000e2';
select pg_temp.ok((select count(*) from prod_paradas where maquina_id = 'd1000000-0000-0000-0000-0000000000a1' and fim is null) = 1, 'OS abriu a parada da máquina');
select pg_temp.ok((select count(*) from man_ordens where origem = 'parada') = 0, 'a parada da própria OS não abre outra OS');
select pg_temp.ok((select situacao from man_equipamentos where maquina_id = 'd1000000-0000-0000-0000-0000000000a1') = 'em_manutencao', 'equipamento em manutenção');
update man_ordens set situacao = 'concluida' where plano_id = 'd1000000-0000-0000-0000-0000000000e2';
select pg_temp.ok((select count(*) from prod_paradas where maquina_id = 'd1000000-0000-0000-0000-0000000000a1' and fim is null) = 0, 'conclusão fechou a parada');
select pg_temp.ok((select situacao from man_equipamentos where maquina_id = 'd1000000-0000-0000-0000-0000000000a1') = 'operando', 'equipamento volta a operar');
select pg_temp.ok((select ultima_horas from man_planos where id = 'd1000000-0000-0000-0000-0000000000e2') = 95, 'plano por horas: horas da execução');

-- parada de manutenção no terminal abre a OS corretiva sozinha
insert into prod_paradas(empresa_id, maquina_id, motivo_id, observacao) values ('e000000a-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-0000000000a1', 'd1000000-0000-0000-0000-0000000000b1', 'Barulho no redutor');
select pg_temp.ok((select count(*) from man_ordens where origem = 'parada' and situacao = 'solicitada' and prioridade = 'emergencia' and maquina_parou) = 1, 'parada no terminal abriu OS de emergência');
select pg_temp.ok((select situacao from man_equipamentos where maquina_id = 'd1000000-0000-0000-0000-0000000000a1') = 'parado', 'equipamento parado');
-- peça antes da implantação do estoque: registrada pelo último custo, sem baixar saldo
select man_consumir_peca((select id from man_ordens where origem = 'parada'), 'd1000000-0000-0000-0000-0000000000d1', 2);
select pg_temp.ok((select custo from man_os_pecas where produto_id = 'd1000000-0000-0000-0000-0000000000d1') = 75, 'peça pelo último custo (2 × 37,50)');
select pg_temp.ok((select count(*) from est_movimentos where produto_id = 'd1000000-0000-0000-0000-0000000000d1') = 0, 'sem estoque implantado não baixa saldo');
insert into man_os_horas(empresa_id, ordem_id, tecnico, horas) select empresa_id, id, 'Mecânico 1', 2.5 from man_ordens where origem = 'parada';
update man_ordens set situacao = 'concluida', falha_id = (select id from man_falhas where codigo = 'MEC-ROL' and empresa_id = 'e000000a-0000-0000-0000-000000000000'), causa = 'Falta de graxa', solucao = 'Troca do rolamento' where origem = 'parada';
select pg_temp.ok((select fim from prod_paradas where observacao = 'Barulho no redutor') is not null, 'conclusão fechou a parada do terminal');
select pg_temp.ok((select numero from man_ordens where origem = 'parada') = 3, 'numeração sequencial da OS');
reset role;

-- leitura vê, mas não abre OS; outra empresa não vê
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from man_ordens) = 3, 'leitura vê as OS');
select pg_temp.falha($$insert into man_ordens(empresa_id, equipamento_id, descricao) select empresa_id, id, 'x' from man_equipamentos limit 1$$, 'leitura não abre OS');
select pg_temp.falha($$select man_gerar_preventivas('e000000a-0000-0000-0000-000000000000')$$, 'leitura não gera preventivas');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from man_ordens) = 0, 'B não vê as OS da A');
select pg_temp.falha($$select man_consumir_peca((select id from man_ordens limit 1), 'd1000000-0000-0000-0000-0000000000d1', 1)$$, 'B não consome peça na OS da A');
reset role;
\o
select 'ok 22_manutencao' as resultado;

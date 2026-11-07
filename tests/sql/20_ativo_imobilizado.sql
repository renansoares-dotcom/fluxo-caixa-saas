-- Ativo Imobilizado (SQL 084): classes padrão, numeração e plaqueta, depreciação mês a mês (início no mês seguinte,
-- implantação de bem antigo, revisão de vida útil, pró-rata), lançamento contábil que fecha, sequência e trava dos meses,
-- baixa com lançamento, candidatos pela NF-e, inventário e isolamento (leitura não grava; outra empresa não vê).
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

-- contas contábeis fictícias da empresa A
insert into contab_contas(id, empresa_id, classificacao, descricao, nivel, tipo, natureza) values
  ('af000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', '1.2.30.100.0001', 'MAQUINAS E EQUIPAMENTOS', 5, 'A', 'D'),
  ('af000000-0000-0000-0000-0000000000c2', 'e000000a-0000-0000-0000-000000000000', '1.2.30.900.0001', '(-) DEPREC. ACUM. MAQUINAS', 5, 'A', 'C'),
  ('af000000-0000-0000-0000-0000000000c3', 'e000000a-0000-0000-0000-000000000000', '3.1.10.500.0001', 'DEPRECIACAO', 5, 'A', 'D'),
  ('af000000-0000-0000-0000-0000000000c4', 'e000000a-0000-0000-0000-000000000000', '3.3.10.100.0001', 'CUSTO DO IMOBILIZADO BAIXADO', 5, 'A', 'D'),
  ('af000000-0000-0000-0000-0000000000cb', 'e000000b-0000-0000-0000-000000000000', '1.2.30.100.0001', 'MAQUINAS B', 5, 'A', 'D');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok(af_classes_padrao('e000000a-0000-0000-0000-000000000000') = 11, '11 classes padrão');
select pg_temp.ok(af_classes_padrao('e000000a-0000-0000-0000-000000000000') = 0, 'classes padrão não duplicam');
select pg_temp.ok((select taxa_fiscal from af_classes where codigo = 'VCG' and empresa_id = 'e000000a-0000-0000-0000-000000000000') = 25, 'caminhões 25% a.a.');
select pg_temp.ok((select not deprecia from af_classes where codigo = 'TER' and empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'terreno não deprecia');
update af_classes set conta_ativo_id = 'af000000-0000-0000-0000-0000000000c1', conta_deprec_id = 'af000000-0000-0000-0000-0000000000c2', conta_despesa_id = 'af000000-0000-0000-0000-0000000000c3'
 where codigo = 'MAQ' and empresa_id = 'e000000a-0000-0000-0000-000000000000';
select pg_temp.falha($$update af_classes set conta_ativo_id = 'af000000-0000-0000-0000-0000000000cb' where codigo = 'MAQ' and empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'conta de outra empresa');
update af_parametros set conta_custo_baixa_id = 'af000000-0000-0000-0000-0000000000c4', prefixo = 'IPL' where empresa_id = 'e000000a-0000-0000-0000-000000000000';

-- bem 1: extrusora nova, 120.000, 10 anos, adquirida em 15/01 (deprecia a partir de fevereiro)
insert into af_bens(id, empresa_id, descricao, classe_id, data_aquisicao, valor_aquisicao, vida_util_meses, taxa_fiscal)
select 'af000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', 'EXTRUSORA TESTE', id, '2026-01-15', 120000, 120, 10 from af_classes where codigo = 'MAQ' and empresa_id = 'e000000a-0000-0000-0000-000000000000';
-- bem 2: implantação de máquina de 2020 com 72 meses já depreciados (72.000) até 31/12/2025
insert into af_bens(id, empresa_id, descricao, classe_id, data_aquisicao, valor_aquisicao, vida_util_meses, taxa_fiscal, data_corte, deprec_inicial, meses_iniciais)
select 'af000000-0000-0000-0000-0000000000b2', 'e000000a-0000-0000-0000-000000000000', 'IMPRESSORA ANTIGA', id, '2020-01-01', 120000, 120, 10, '2025-12-31', 72000, 72 from af_classes where codigo = 'MAQ' and empresa_id = 'e000000a-0000-0000-0000-000000000000';
select pg_temp.ok((select plaqueta from af_bens where id = 'af000000-0000-0000-0000-0000000000b1') = 'IPL-000001', 'plaqueta com prefixo e número');
select pg_temp.ok((select numero from af_bens where id = 'af000000-0000-0000-0000-0000000000b2') = 2, 'numeração sequencial');
select pg_temp.ok((select count(*) from af_movimentos where tipo = 'aquisicao') = 2, 'aquisição no histórico');
select pg_temp.falha($$insert into af_bens(empresa_id, descricao, classe_id, data_aquisicao, valor_aquisicao, vida_util_meses, data_corte)
  select 'e000000a-0000-0000-0000-000000000000', 'X', id, '2020-01-01', 1, 12, '2025-12-15' from af_classes where codigo = 'MAQ' and empresa_id = 'e000000a-0000-0000-0000-000000000000'$$, 'data de corte fora do fim do mês');

-- janeiro: bem 1 ainda não deprecia; bem 2 = 48.000 ÷ 48 = 1.000
select pg_temp.ok((af_calcular('e000000a-0000-0000-0000-000000000000', '2026-01-01', true) ->> 'total')::numeric = 1000, 'janeiro = 1.000 (só o bem implantado)');
select pg_temp.ok((af_calcular('e000000a-0000-0000-0000-000000000000', '2026-02-01', true) ->> 'total')::numeric = 2000, 'fevereiro = 2.000');
select pg_temp.ok((select valor from af_depreciacoes where bem_id = 'af000000-0000-0000-0000-0000000000b1' and competencia = '2026-02-01') = 1000, 'bem novo: 1.000 em fevereiro');
select pg_temp.ok((select sum(p.debito) from contab_partidas p join contab_lancamentos l on l.id = p.lancamento_id where l.origem = 'depreciacao' and l.data = '2026-02-28') = 2000, 'lançamento contábil de fevereiro');
select pg_temp.ok((select sum(p.debito - p.credito) from contab_partidas p join contab_lancamentos l on l.id = p.lancamento_id where l.origem = 'depreciacao') = 0, 'débitos = créditos');
-- recalcular o mesmo mês não duplica
select af_calcular('e000000a-0000-0000-0000-000000000000', '2026-02-01', true);
select pg_temp.ok((select count(*) from contab_lancamentos where origem = 'depreciacao') = 2, 'recalcular não duplica o lançamento');
-- meses em sequência
select pg_temp.falha($$select af_calcular('e000000a-0000-0000-0000-000000000000', '2026-04-01', true)$$, 'abril sem março');
-- prévia não grava
select af_calcular('e000000a-0000-0000-0000-000000000000', '2026-03-01', false);
select pg_temp.ok((select count(*) from af_calculos where competencia = '2026-03-01') = 0, 'prévia não grava');

-- revisão de vida útil do bem 1 para 60 meses (prospectiva): março = (120.000 − 1.000) ÷ (60 − 1)
update af_bens set vida_util_meses = 60 where id = 'af000000-0000-0000-0000-0000000000b1';
select pg_temp.ok((select count(*) from af_movimentos where tipo = 'revisao') = 1, 'revisão no histórico');
-- transferência de local vai para o histórico
update af_bens set local = 'Extrusão — linha 1', responsavel = 'Encarregado' where id = 'af000000-0000-0000-0000-0000000000b1';
select pg_temp.ok((select count(*) from af_movimentos where tipo = 'transferencia') = 1, 'transferência no histórico');

-- fechar fevereiro (janeiro antes), travar o valor; financeiro não reabre
select pg_temp.falha($$select af_fechar('e000000a-0000-0000-0000-000000000000', '2026-02-01', true)$$, 'fechar fevereiro com janeiro aberto');
select af_fechar('e000000a-0000-0000-0000-000000000000', '2026-01-01', true);
select af_fechar('e000000a-0000-0000-0000-000000000000', '2026-02-01', true);
select pg_temp.falha($$update af_bens set valor_aquisicao = 130000 where id = 'af000000-0000-0000-0000-0000000000b1'$$, 'valor travado após mês fechado');
select pg_temp.falha($$select af_calcular('e000000a-0000-0000-0000-000000000000', '2026-02-01', true)$$, 'mês fechado não recalcula');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select af_fechar('e000000a-0000-0000-0000-000000000000', '2026-02-01', false)$$, 'financeiro não reabre');
-- baixa do bem 2 por venda em 20/03 (no mês da baixa, pela regra "mês seguinte", não deprecia)
select pg_temp.falha($$update af_bens set situacao = 'baixado', baixa_data = '2026-03-20' where id = 'af000000-0000-0000-0000-0000000000b2'$$, 'baixa só pela função');
select pg_temp.falha($$select af_baixar('af000000-0000-0000-0000-0000000000b2', '2026-02-10', 'venda', 50000, 'venda')$$, 'baixa em mês fechado');
select af_baixar('af000000-0000-0000-0000-0000000000b2', '2026-03-20', 'venda', 50000, 'Vendida para terceiro');
select pg_temp.ok((af_calcular('e000000a-0000-0000-0000-000000000000', '2026-03-01', true) ->> 'total')::numeric = round(119000 / 59.0, 2), 'março = revisão de vida do bem 1');
select pg_temp.ok((select count(*) from af_depreciacoes where bem_id = 'af000000-0000-0000-0000-0000000000b2' and competencia = '2026-03-01') = 0, 'bem baixado não deprecia no mês da baixa');
select pg_temp.ok((select p.credito from contab_partidas p join contab_lancamentos l on l.id = p.lancamento_id where l.data = '2026-03-20' and p.conta_id = 'af000000-0000-0000-0000-0000000000c1') = 120000, 'baixa: crédito do custo');
select pg_temp.ok((select p.debito from contab_partidas p join contab_lancamentos l on l.id = p.lancamento_id where l.data = '2026-03-20' and p.conta_id = 'af000000-0000-0000-0000-0000000000c2') = 74000, 'baixa: débito da depreciação acumulada');
select pg_temp.ok((select p.debito from contab_partidas p join contab_lancamentos l on l.id = p.lancamento_id where l.data = '2026-03-20' and p.conta_id = 'af000000-0000-0000-0000-0000000000c4') = 46000, 'baixa: custo do bem baixado = valor líquido');
select af_desfazer_baixa('af000000-0000-0000-0000-0000000000b2', 'Venda cancelada');
select pg_temp.ok((select situacao from af_bens where id = 'af000000-0000-0000-0000-0000000000b2') = 'em_uso', 'baixa desfeita');
select af_baixar('af000000-0000-0000-0000-0000000000b2', '2026-03-20', 'venda', 50000, 'Vendida para terceiro');

-- pró-rata por dia: bem que entra em uso em 16/03 → 16/31 do mês
update af_parametros set regra_inicio = 'pro_rata_dia' where empresa_id = 'e000000a-0000-0000-0000-000000000000';
insert into af_bens(id, empresa_id, descricao, classe_id, data_aquisicao, valor_aquisicao, vida_util_meses)
select 'af000000-0000-0000-0000-0000000000b3', 'e000000a-0000-0000-0000-000000000000', 'REBOBINADEIRA', id, '2026-03-16', 120000, 120 from af_classes where codigo = 'MAQ' and empresa_id = 'e000000a-0000-0000-0000-000000000000';
select pg_temp.ok(exists (select 1 from jsonb_array_elements(af_calcular('e000000a-0000-0000-0000-000000000000', '2026-03-01', false) -> 'itens') x
                          where x ->> 'plaqueta' = 'IPL-000003' and (x ->> 'valor')::numeric = round(1000 * round(16 / 31.0, 4), 2)), 'pró-rata por dia');

-- candidatos pela NF-e de entrada (NCM 8477, valor unitário acima do mínimo)
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, emit_nome, emit_doc, finalidade)
values ('af000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'CHAVE-AF-1', 991, '2026-03-05', 'entrada', false, 'FORNECEDOR MAQUINAS', '00000000000191', '1');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, xprod, ncm, qcom, vprod, v_icms) values
  ('af000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'af000000-0000-0000-0000-0000000000f1', 1, 'M1', 'SELADORA', '84778010', 1, 30000, 3600),
  ('af000000-0000-0000-0000-0000000000f3', 'e000000a-0000-0000-0000-000000000000', 'af000000-0000-0000-0000-0000000000f1', 2, 'P1', 'ROLAMENTO', '84821010', 10, 900, 108);
select pg_temp.ok((select count(*) from af_candidatos('e000000a-0000-0000-0000-000000000000', '2026-03-01', '2026-03-31') where origem = 'nfe') = 1, 'candidato: só a máquina (peça barata fica fora)');
insert into af_ignorados(empresa_id, origem, ref_id, motivo) values ('e000000a-0000-0000-0000-000000000000', 'nfe', 'af000000-0000-0000-0000-0000000000f2', 'teste');
select pg_temp.ok((select count(*) from af_candidatos('e000000a-0000-0000-0000-000000000000', '2026-03-01', '2026-03-31') where origem = 'nfe') = 0, 'candidato ignorado some');

-- inventário: bem 1 e 3 esperados; acha o 1 em outro local
insert into af_inventarios(id, empresa_id, descricao, data_inicio) values ('af000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'Inventário anual', '2026-03-31');
insert into af_inventario_itens(empresa_id, inventario_id, bem_id, local_encontrado, estado) values
  ('e000000a-0000-0000-0000-000000000000', 'af000000-0000-0000-0000-0000000000a1', 'af000000-0000-0000-0000-0000000000b1', 'Impressão', 'bom');
select pg_temp.ok((af_concluir_inventario('af000000-0000-0000-0000-0000000000a1') ->> 'nao_encontrados')::int = 1, 'inventário: 1 não encontrado');
select pg_temp.ok((select resumo ->> 'local_divergente' from af_inventarios where id = 'af000000-0000-0000-0000-0000000000a1')::int = 1, 'inventário: local divergente');
select pg_temp.falha($$insert into af_inventario_itens(empresa_id, inventario_id, bem_id) values ('e000000a-0000-0000-0000-000000000000', 'af000000-0000-0000-0000-0000000000a1', 'af000000-0000-0000-0000-0000000000b3')$$, 'inventário concluído não recebe itens');
reset role;

-- leitura vê, mas não grava nem calcula
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from af_bens) = 3, 'leitura vê os bens');
update af_bens set local = 'x' where id = 'af000000-0000-0000-0000-0000000000b1';
select pg_temp.falha($$insert into af_bens(empresa_id, descricao, classe_id, data_aquisicao, valor_aquisicao, vida_util_meses) select empresa_id, 'X', classe_id, data_aquisicao, 1, 12 from af_bens limit 1$$, 'leitura não cadastra');
select pg_temp.ok((select local from af_bens where id = 'af000000-0000-0000-0000-0000000000b1') = 'Extrusão — linha 1', 'leitura não alterou');
select pg_temp.falha($$select af_calcular('e000000a-0000-0000-0000-000000000000', '2026-04-01', true)$$, 'leitura não calcula');
select pg_temp.falha($$insert into af_depreciacoes(empresa_id, calculo_id, bem_id, competencia, meses, valor, acumulada) select empresa_id, calculo_id, bem_id, '2030-01-01', 1, 1, 1 from af_depreciacoes limit 1$$, 'ninguém grava depreciação direto');
reset role;
-- outra empresa não vê
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from af_bens) = 0, 'B não vê os bens da A');
select pg_temp.ok((select count(*) from af_depreciacoes) = 0, 'B não vê as depreciações da A');
select pg_temp.falha($$select af_candidatos('e000000a-0000-0000-0000-000000000000', '2026-01-01', '2026-12-31')$$, 'B não lê candidatos da A');
reset role;
\o
select 'ok 20_ativo_imobilizado' as resultado;

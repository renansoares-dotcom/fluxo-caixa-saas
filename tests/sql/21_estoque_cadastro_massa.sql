-- Estoque — cadastro em massa (SQL 085): regras de classificação de partida, famílias FERRAM e NAOEST, regra "qualquer CFOP",
-- cadastro de produtos e de-paras numa transação (código automático, fator, último custo), item que não é estoque não movimenta,
-- prontidão sem gravar e isolamento (leitura não cadastra; outra empresa não usa).
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
create or replace function pg_temp.res(p jsonb, p_sent text, p_res text) returns int language sql as $$
  select coalesce(sum((x ->> 'itens')::int), 0)::int from jsonb_array_elements(p -> 'resumo') x where x ->> 'sentido' = p_sent and x ->> 'resultado' = p_res $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- notas de entrada da empresa A: o mesmo grau de resina de dois fornecedores (saco de 25 kg e kg) e a conta de energia
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc, emit_nome, finalidade) values
  ('c5000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'CM-1', 7001, '2026-10-05', 'entrada', false, 'autorizada', '11111111000111', 'DISTRIBUIDORA DE RESINAS', '1'),
  ('c5000000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 'CM-2', 7002, '2026-10-06', 'entrada', false, 'autorizada', '22222222000122', 'PETROQUÍMICA', '1'),
  ('c5000000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', 'CM-3', 7003, '2026-10-07', 'entrada', false, 'autorizada', '33333333000133', 'DISTRIBUIDORA DE ENERGIA', '1');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, xprod, ncm, cfop, ucom, qcom, vprod) values
  ('c6000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-000000000001', 1, 'R2022', 'PEBD 2022N SC 25KG', '39011010', '5101', 'SC', 40, 10000),
  ('c6000000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-000000000002', 1, '000123', 'POLIETILENO BAIXA DENSIDADE 2022N', '39011010', '6101', 'KG', 2000, 19000),
  ('c6000000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', 'c5000000-0000-0000-0000-000000000003', 1, 'ENE', 'ENERGIA ELETRICA', '27160000', '5252', 'KWH', 50000, 42000);

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok(est_cadastro_padrao('e000000a-0000-0000-0000-000000000000') = 16, '16 regras de classificação de partida');
select pg_temp.ok(est_cadastro_padrao('e000000a-0000-0000-0000-000000000000') = 0, 'não duplica');
select pg_temp.ok((select count(*) from est_familias where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo in ('FERRAM', 'NAOEST')) = 2, 'famílias FERRAM e NAOEST');
select pg_temp.ok(exists (select 1 from est_regras_cfop r join est_familias f on f.id = r.familia_id where r.empresa_id = 'e000000a-0000-0000-0000-000000000000' and r.cfop = '*' and f.codigo = 'NAOEST' and r.tipo_movimento_id is null), 'regra "qualquer CFOP" da família NAOEST');
select pg_temp.ok((select palavras[1] from est_classif_regras where empresa_id = 'e000000a-0000-0000-0000-000000000000' and ordem = 12) = 'SERVICO', 'palavras em maiúscula');

-- antes: os três itens sem produto (sem gravar nada)
select pg_temp.ok(pg_temp.res(est_prontidao('e000000a-0000-0000-0000-000000000000', '2026-10-01'), 'entrada', 'sem_produto') >= 3, 'prontidão: sem de-para');
select pg_temp.ok((select count(*) from est_pendencias where empresa_id = 'e000000a-0000-0000-0000-000000000000' and nfe_item_id::text like 'c6000000%') = 0, 'prontidão não grava pendências');

-- cadastro em massa: a resina (dois fornecedores, fator 25 no saco) e a energia como "não é estoque"
select pg_temp.ok((est_cadastro_massa('e000000a-0000-0000-0000-000000000000', jsonb_build_array(
  jsonb_build_object('descricao', 'Pebd 2022n', 'unidade', 'kg', 'ncm', '39011010', 'familia_id', (select id from est_familias where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'RESINA'),
    'itens', jsonb_build_array(jsonb_build_object('emit_doc', '11111111000111', 'codigo_fornecedor', 'R2022', 'descricao', 'PEBD 2022N SC 25KG', 'unidade', 'SC', 'fator', 25),
                               jsonb_build_object('emit_doc', '22222222000122', 'codigo_fornecedor', '000123', 'descricao', 'POLIETILENO BAIXA DENSIDADE 2022N', 'unidade', 'KG', 'fator', 1))),
  jsonb_build_object('nao_estoque', true, 'itens', jsonb_build_array(jsonb_build_object('emit_doc', '33333333000133', 'codigo_fornecedor', 'ENE', 'descricao', 'ENERGIA ELETRICA', 'unidade', 'KWH')))
)) ->> 'depara')::int = 3, 'três de-paras gravados');
select pg_temp.ok((select descricao from produtos where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'RES-0001') = 'PEBD 2022N', 'código automático pela família e descrição em maiúscula');
select pg_temp.ok((select unidade from produtos where codigo = 'RES-0001' and empresa_id = 'e000000a-0000-0000-0000-000000000000') = 'KG', 'unidade do produto');
select pg_temp.ok((select fator from produto_fornecedores where codigo_fornecedor = 'R2022') = 25, 'fator do saco');
select pg_temp.ok((select round(ultimo_preco, 2) from produto_fornecedores where codigo_fornecedor = 'R2022') = 10, 'último custo na unidade do produto (10.000 ÷ 1.000 kg)');
select pg_temp.ok(exists (select 1 from produtos where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'NAO-ESTOQUE'), 'produto genérico do que não é estoque');
-- depois: a resina movimenta (compra) e a energia não movimenta
select pg_temp.ok(pg_temp.res(est_prontidao('e000000a-0000-0000-0000-000000000000', '2026-10-05'), 'entrada', 'ok') >= 2, 'prontidão: resina pronta');
select pg_temp.ok(pg_temp.res(est_prontidao('e000000a-0000-0000-0000-000000000000', '2026-10-05'), 'entrada', 'nao_movimenta') >= 1, 'prontidão: energia não movimenta');
select pg_temp.ok(est_processar_item('c6000000-0000-0000-0000-000000000003') = 'nao_movimenta', 'o motor do estoque concorda: energia não movimenta');
-- de novo não duplica; código repetido é recusado
select pg_temp.ok((est_cadastro_massa('e000000a-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('produto_id', (select id from produtos where codigo = 'RES-0001' and empresa_id = 'e000000a-0000-0000-0000-000000000000'),
  'itens', jsonb_build_array(jsonb_build_object('emit_doc', '11111111000111', 'codigo_fornecedor', 'R2022', 'fator', 25))))) ->> 'ja_existiam')::int = 1, 'de-para que já existe não duplica');
select pg_temp.falha($$select est_cadastro_massa('e000000a-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('codigo', 'RES-0001', 'descricao', 'X', 'familia_id', (select id from est_familias where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'RESINA'))))$$, 'código repetido');
-- espelho do Iniflex: a linha se liga ao produto quando o código é trocado para o do Iniflex
reset role;
insert into estoque_espelhos(id, empresa_id, data_ref) values ('c7000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', '2026-10-31');
insert into estoque_espelho_itens(empresa_id, espelho_id, codigo, descricao, deposito, quantidade) values ('e000000a-0000-0000-0000-000000000000', 'c7000000-0000-0000-0000-000000000001', 'MP0457', 'PEBD 2022N', 'ALMOX', 500);
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update produtos set codigo = 'MP0457' where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'RES-0001';
select pg_temp.ok((select produto_id from estoque_espelho_itens where codigo = 'MP0457') = (select id from produtos where codigo = 'MP0457' and empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'espelho ligado ao trocar o código');
reset role;

-- leitura não cadastra; outra empresa não usa a família da A
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select est_cadastro_massa('e000000a-0000-0000-0000-000000000000', '[{"nao_estoque": true}]'::jsonb)$$, 'leitura não cadastra');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select est_cadastro_massa('e000000b-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object('descricao', 'X', 'familia_id', (select id from est_familias where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'RESINA' limit 1))))$$, 'família de outra empresa');
select pg_temp.falha($$select est_prontidao('e000000a-0000-0000-0000-000000000000', '2026-01-01')$$, 'B não lê a prontidão da A');
reset role;
\o
select 'ok 21_estoque_cadastro_massa' as resultado;

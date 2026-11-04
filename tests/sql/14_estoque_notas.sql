-- Estoque pelas notas (SQL 077): automático desligado até a implantação; implantação pelo espelho; entrada de fornecedor pelo de-para
-- com fator, custo líquido e lote; saída pelo código; CFOP que não movimenta; pendências (sem produto, sem regra, saldo); cancelamento estorna.
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
create or replace function pg_temp.falha(p_sql text, p_trecho text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if position(p_trecho in sqlerrm) > 0 then return; end if;
    raise exception 'FALHOU: % (erro inesperado: %)', p_msg, sqlerrm;
  end;
  raise exception 'FALHOU: % (não bloqueou)', p_msg;
end $$;

-- empresa B (limpa) para não misturar com o teste 13
insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values
  ('bb000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'RES-1', 'RESINA EXEMPLO', 'materia_prima', 'KG'),
  ('bb000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'SACO-1', 'SACO EXEMPLO', 'produto_acabado', 'KG');
insert into produto_fornecedores(empresa_id, produto_id, emit_doc, codigo_fornecedor, fator) values ('e000000b-0000-0000-0000-000000000000', 'bb000000-0000-0000-0000-000000000001', '99888777000100', 'F-RES', 25);
insert into estoque_espelhos(id, empresa_id, data_ref) values ('be000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', '2026-10-31');
insert into estoque_espelho_itens(empresa_id, espelho_id, produto_id, codigo, deposito, quantidade, custo_unitario, valor) values
  ('e000000b-0000-0000-0000-000000000000', 'be000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000001', 'RES-1', 'ALMOX', 1000, 10, 10000),
  ('e000000b-0000-0000-0000-000000000000', 'be000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000002', 'SACO-1', 'EXPED', 500, 20, 10000),
  ('e000000b-0000-0000-0000-000000000000', 'be000000-0000-0000-0000-000000000001', null, 'NAO-CAD', 'EXPED', 5, 1, 5);

-- antes da implantação: nota nova não movimenta
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values ('bc000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'B1', 1, '2026-10-30', 'saida', true, 'autorizada');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod) values ('bd000000-0000-0000-0000-000000000001', 'e000000b-0000-0000-0000-000000000000', 'bc000000-0000-0000-0000-000000000001', 1, 'SACO-1', '5101', 10, 300);
select pg_temp.ok((select count(*) from est_movimentos where empresa_id = 'e000000b-0000-0000-0000-000000000000') = 0, 'automático desligado antes da implantação');

select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select est_implantar('e000000b-0000-0000-0000-000000000000', 'be000000-0000-0000-0000-000000000001', '2026-10-31',
  jsonb_build_object('ALMOX', (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'MP'),
                     'EXPED', (select id from est_locais where empresa_id = 'e000000b-0000-0000-0000-000000000000' and codigo = 'ACA')), false);
select pg_temp.ok((select count(*) from est_movimentos where empresa_id = 'e000000b-0000-0000-0000-000000000000') = 2, 'saldo inicial: 2 linhas cadastradas (a sem cadastro fica de fora)');
select pg_temp.ok((select lote_id is not null from est_movimentos where produto_id = 'bb000000-0000-0000-0000-000000000001'), 'resina implantada com lote SI');
select pg_temp.ok((select implantado_em = '2026-11-01' and automatico from est_config where empresa_id = 'e000000b-0000-0000-0000-000000000000'), 'automático liga no dia seguinte');
select pg_temp.falha($q$select est_implantar('e000000b-0000-0000-0000-000000000000', 'be000000-0000-0000-0000-000000000001', '2026-10-31', '{}'::jsonb)$q$, 'já foi implantado', 'implanta uma vez só');
reset role;

-- entrada de fornecedor (CFOP do fornecedor 5101 = nossa 1101): 4 sacos × 25 = 100 kg; custo líquido sem ICMS/PIS/Cofins
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_doc, emit_nome) values ('bc000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'B2', 7001, '2026-11-02', 'entrada', false, 'autorizada', '99888777000100', 'FORNECEDOR EXEMPLO');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod, v_icms, v_pis, v_cofins) values
  ('bd000000-0000-0000-0000-000000000002', 'e000000b-0000-0000-0000-000000000000', 'bc000000-0000-0000-0000-000000000002', 1, 'F-RES', '5101', 4, 1400, 168, 23.10, 106.40),
  ('bd000000-0000-0000-0000-000000000003', 'e000000b-0000-0000-0000-000000000000', 'bc000000-0000-0000-0000-000000000002', 2, 'F-OUTRO', '5101', 1, 50, 0, 0, 0),
  ('bd000000-0000-0000-0000-000000000004', 'e000000b-0000-0000-0000-000000000000', 'bc000000-0000-0000-0000-000000000002', 3, 'F-RES', '5949', 1, 10, 0, 0, 0);
select pg_temp.ok((select quantidade = 100 and custo_unitario = 11.025 and documento like 'NF 7001%' and lote_id is not null from est_movimentos where nfe_item_id = 'bd000000-0000-0000-0000-000000000002'), 'entrada pelo de-para: 100 kg a 11,025 (1.102,50 / 100)');
select pg_temp.ok((select custo_medio from est_custos where produto_id = 'bb000000-0000-0000-0000-000000000001') = round(11102.5 / 1100, 10), 'custo médio após a compra');
select pg_temp.ok((select motivo = 'sem_produto' and mensagem like '%sem de-para%' from est_pendencias where nfe_item_id = 'bd000000-0000-0000-0000-000000000003'), 'item sem de-para vira pendência');
select pg_temp.ok((select count(*) from est_movimentos where nfe_item_id = 'bd000000-0000-0000-0000-000000000004') = 0 and (select count(*) from est_pendencias where nfe_item_id = 'bd000000-0000-0000-0000-000000000004') = 0, 'CFOP 949: não movimenta e não pendura');

-- saída: venda baixa o acabado; saldo insuficiente vira pendência; CFOP sem regra vira pendência
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values ('bc000000-0000-0000-0000-000000000003', 'e000000b-0000-0000-0000-000000000000', 'B3', 2, '2026-11-03', 'saida', true, 'autorizada');
insert into nfe_itens(id, empresa_id, nota_id, n_item, cprod, cfop, qcom, vprod) values
  ('bd000000-0000-0000-0000-000000000005', 'e000000b-0000-0000-0000-000000000000', 'bc000000-0000-0000-0000-000000000003', 1, 'SACO-1', '6101', 120, 3600),
  ('bd000000-0000-0000-0000-000000000006', 'e000000b-0000-0000-0000-000000000000', 'bc000000-0000-0000-0000-000000000003', 2, 'SACO-1', '5101', 9999, 3600),
  ('bd000000-0000-0000-0000-000000000007', 'e000000b-0000-0000-0000-000000000000', 'bc000000-0000-0000-0000-000000000003', 3, 'SACO-1', '5551', 1, 10);
select pg_temp.ok((select quantidade = -120 and custo_unitario = 20 from est_movimentos where nfe_item_id = 'bd000000-0000-0000-0000-000000000005'), 'venda baixa 120 kg ao custo médio');
select pg_temp.ok((select motivo = 'saldo' from est_pendencias where nfe_item_id = 'bd000000-0000-0000-0000-000000000006'), 'saldo insuficiente vira pendência (a nota entra)');
select pg_temp.ok((select motivo = 'sem_regra' from est_pendencias where nfe_item_id = 'bd000000-0000-0000-0000-000000000007'), 'CFOP sem regra vira pendência');
select pg_temp.ok((select count(*) from nfe_itens where nota_id = 'bc000000-0000-0000-0000-000000000003') = 3, 'a importação da nota não trava');

-- de-para criado depois: reprocessar resolve
insert into produto_fornecedores(empresa_id, produto_id, emit_doc, codigo_fornecedor, fator) values ('e000000b-0000-0000-0000-000000000000', 'bb000000-0000-0000-0000-000000000001', '99888777000100', 'F-OUTRO', 1);
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok(est_processar_item('bd000000-0000-0000-0000-000000000003') = 'ok', 'reprocessa após o de-para');
select pg_temp.ok(est_processar_item('bd000000-0000-0000-0000-000000000003') = 'ja', 'não duplica');
reset role;
select pg_temp.ok((select status = 'resolvida' from est_pendencias where nfe_item_id = 'bd000000-0000-0000-0000-000000000003'), 'pendência resolvida');

-- cancelamento estorna
update nfe_notas set situacao = 'cancelada' where id = 'bc000000-0000-0000-0000-000000000003';
select pg_temp.ok((select sum(quantidade) from est_movimentos where nota_id = 'bc000000-0000-0000-0000-000000000003') = 0, 'nota cancelada: movimentos estornados');
select pg_temp.ok((select quantidade from est_saldos where produto_id = 'bb000000-0000-0000-0000-000000000002') = 500, 'saldo do acabado volta');
select pg_temp.ok((select count(*) from est_pendencias where nota_id = 'bc000000-0000-0000-0000-000000000003' and status = 'aberta') = 0, 'pendências da nota cancelada resolvidas');

-- permissões
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from est_pendencias) = 0, 'A não vê as pendências da B');
reset role;
\o
select 'ok 14_estoque_notas' as resultado;

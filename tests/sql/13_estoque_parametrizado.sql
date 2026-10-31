-- Estoque parametrizado (SQL 075): parametrização padrão, custo médio ponderado móvel, saldo por local, trava de negativo,
-- lote obrigatório, transferência, estorno, kardex imutável, fechamento do mês, recálculo, cadastro pelas notas de saída e permissões. Dados FICTÍCIOS.
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

-- empresa nova nasce parametrizada (gatilho); as dos testes foram criadas depois da migração
select pg_temp.ok((select count(*) from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000') >= 12, 'locais padrão');
select pg_temp.ok((select count(*) from est_familias where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 16, 'famílias padrão');
select pg_temp.ok((select count(*) from est_tipos_movimento where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 18, 'tipos de movimento padrão');
select pg_temp.ok((select count(*) from est_regras_cfop where empresa_id = 'e000000a-0000-0000-0000-000000000000') > 30, 'regras por CFOP padrão');
select public._est_configurar('e000000a-0000-0000-0000-000000000000');
select pg_temp.ok((select count(*) from est_familias where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 16, 'rodar de novo não duplica');
select pg_temp.ok((select local_padrao_id is not null from est_familias where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'SEMI'), 'semiacabado vai para em processo');

insert into produtos(id, empresa_id, codigo, descricao, tipo, unidade) values
  ('aa000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'PEBD-01', 'RESINA EXEMPLO', 'materia_prima', 'KG'),
  ('aa000000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 'LUVA-01', 'LUVA EXEMPLO', 'uso_consumo', 'PAR');
select pg_temp.ok((select controla_lote and tipo_sped = '01' and local_padrao_id is not null from produtos where id = 'aa000000-0000-0000-0000-000000000001'), 'resina: família, tipo 01, lote e local da matéria-prima');
select pg_temp.ok((select tipo_sped = '07' from produtos where id = 'aa000000-0000-0000-0000-000000000002'), 'uso e consumo: tipo 07');
update produtos set familia_id = (select id from est_familias where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'EPI') where id = 'aa000000-0000-0000-0000-000000000002';
select pg_temp.ok((select tipo_sped = '07' and local_padrao_id = (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'UC') from produtos where id = 'aa000000-0000-0000-0000-000000000002'), 'troca de família leva o local');
insert into est_lotes(id, empresa_id, produto_id, codigo, lote_fornecedor) values ('ab000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'aa000000-0000-0000-0000-000000000001', 'L1', 'FORN-123');

create temp view ids as select
  (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'MP') mp,
  (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'UC') uc,
  (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'QUA') qua,
  (select id from est_tipos_movimento where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'COMPRA') compra,
  (select id from est_tipos_movimento where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'REQPROD') req,
  (select id from est_tipos_movimento where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'REQINT') reqint;
grant select on ids to authenticated;

select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');   -- compras movimenta
insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-01', 'aa000000-0000-0000-0000-000000000001', mp, 'ab000000-0000-0000-0000-000000000001', compra, 1000, 8 from ids;
insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-05', 'aa000000-0000-0000-0000-000000000001', mp, 'ab000000-0000-0000-0000-000000000001', compra, 500, 11 from ids;
reset role;
select pg_temp.ok((select custo_medio = 9 and quantidade = 1500 and valor = 13500 from est_custos where produto_id = 'aa000000-0000-0000-0000-000000000001'), 'custo médio ponderado: (8.000 + 5.500) / 1.500 = 9');
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-06', 'aa000000-0000-0000-0000-000000000001', mp, 'ab000000-0000-0000-0000-000000000001', req, -300 from ids;
reset role;
select pg_temp.ok((select custo_unitario = 9 and valor = -2700 and saldo_local_apos = 1200 from est_movimentos where quantidade = -300), 'saída ao custo médio');
select pg_temp.ok((select quantidade = 1200 and valor = 10800 from est_saldos where produto_id = 'aa000000-0000-0000-0000-000000000001'), 'saldo do local');

select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.falha($q$insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-07', 'aa000000-0000-0000-0000-000000000001', mp, 'ab000000-0000-0000-0000-000000000001', req, -5000 from ids$q$, 'Saldo insuficiente', 'saldo negativo bloqueado');
select pg_temp.falha($q$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-07', 'aa000000-0000-0000-0000-000000000001', mp, compra, 10, 9 from ids$q$, 'controla lote', 'lote obrigatório');
select pg_temp.falha($q$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-07', 'aa000000-0000-0000-0000-000000000002', uc, compra, -1 from ids$q$, 'entrada com quantidade negativa', 'sinal conferido pelo tipo');
-- transferência para a quarentena, ao custo médio
select est_transferir('e000000a-0000-0000-0000-000000000000', '2026-10-08', 'aa000000-0000-0000-0000-000000000001', (select mp from ids), (select qua from ids), 200, 'ab000000-0000-0000-0000-000000000001');
reset role;
select pg_temp.ok((select quantidade from est_saldos s join est_locais l on l.id = s.local_id where s.produto_id = 'aa000000-0000-0000-0000-000000000001' and l.codigo = 'QUA') = 200, 'transferência entra no destino');
select pg_temp.ok((select custo_medio = 9 and quantidade = 1200 from est_custos where produto_id = 'aa000000-0000-0000-0000-000000000001'), 'transferência não muda o custo nem o total');
-- kardex imutável; estorno
select pg_temp.falha($q$update est_movimentos set quantidade = 1 where quantidade = -300$q$, 'use o estorno', 'movimento não se altera');
select pg_temp.falha($q$delete from est_movimentos where quantidade = -300$q$, 'use o estorno', 'movimento não se exclui');
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select est_estornar((select id from est_movimentos where quantidade = -300), '2026-10-09', 'teste');
select pg_temp.falha($q$select est_estornar((select id from est_movimentos where quantidade = -300))$q$, 'já estornado', 'estorno uma vez só');
reset role;
select pg_temp.ok((select quantidade = 1500 and valor = 13500 from est_custos where produto_id = 'aa000000-0000-0000-0000-000000000001'), 'estorno devolve ao custo da saída');
-- leitura não movimenta nem altera parâmetro
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from est_movimentos) = 6, 'leitura vê o kardex');
select pg_temp.falha($q$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-10', 'aa000000-0000-0000-0000-000000000002', uc, compra, 1, 1 from ids$q$, 'row-level security', 'leitura não movimenta');
update est_locais set nome = 'X' where codigo = 'MP';
reset role;
select pg_temp.ok((select count(*) from est_locais where nome = 'X') = 0, 'leitura não altera local');
-- local restrito por papel
update est_locais set papeis = array['producao'] where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'UC';
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.falha($q$insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-10', 'aa000000-0000-0000-0000-000000000002', uc, compra, 10, 5 from ids$q$, 'não movimenta o local', 'papel fora da lista do local');
reset role;
-- fechamento do mês
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select est_fechar_mes('e000000a-0000-0000-0000-000000000000', '2026-10-15');
select pg_temp.falha($q$insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', '2026-10-20', 'aa000000-0000-0000-0000-000000000001', mp, 'ab000000-0000-0000-0000-000000000001', compra, 10, 9 from ids$q$, 'está fechado', 'mês fechado não aceita movimento');
select pg_temp.falha($q$select est_fechar_mes('e000000a-0000-0000-0000-000000000000', '2026-10-01', true)$q$, 'administrador reabre', 'financeiro não reabre');
-- recálculo cronológico: entrada retroativa (novembro aberto) depois de uma saída
insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade)
  select 'e000000a-0000-0000-0000-000000000000', '2026-11-03', 'aa000000-0000-0000-0000-000000000001', mp, 'ab000000-0000-0000-0000-000000000001', req, -100 from ids;
insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', '2026-11-02', 'aa000000-0000-0000-0000-000000000001', mp, 'ab000000-0000-0000-0000-000000000001', compra, 1500, 13 from ids;
select pg_temp.ok(est_recalcular('e000000a-0000-0000-0000-000000000000', 'aa000000-0000-0000-0000-000000000001') = 8, 'recalcula os 8 movimentos');
reset role;
select pg_temp.ok((select custo_unitario = 11 from est_movimentos where quantidade = -100), 'saída de 03/11 ao custo depois da compra de 02/11: (13.500 + 19.500) / 3.000 = 11');
select pg_temp.ok((select quantidade = 2900 and valor = 31900 from est_custos where produto_id = 'aa000000-0000-0000-0000-000000000001'), 'custo após o recálculo');
select pg_temp.ok((select sum(quantidade) from est_saldos where produto_id = 'aa000000-0000-0000-0000-000000000001') = 2900, 'saldos refeitos');

-- produtos das notas de saída: venda cadastra (tipo 04, Produto acabado); remessa e nota de terceiro não
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao) values
  ('ac000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'CH1', 1, '2026-09-01', 'saida', true, 'autorizada'),
  ('ac000000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 'CH2', 2, '2026-09-02', 'saida', true, 'cancelada'),
  ('ac000000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', 'CH3', 3, '2026-09-03', 'entrada', false, 'autorizada');
insert into nfe_itens(empresa_id, nota_id, n_item, cprod, xprod, cfop, ucom, ncm) values
  ('e000000a-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 1, 'SACO-01', 'SACO EXEMPLO', '5101', 'kg', '39232190'),
  ('e000000a-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 2, 'SACO-02', 'SACO EXEMPLO 2', '6101', 'UN', '39232190'),
  ('e000000a-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 3, 'MOLDE-1', 'MOLDE EM CONSERTO', '5915', 'UN', null),
  ('e000000a-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000001', 4, 'PEBD-01', 'RESINA REVENDIDA', '5102', 'KG', null),
  ('e000000a-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000002', 1, 'SACO-03', 'CANCELADA', '5101', 'UN', null),
  ('e000000a-0000-0000-0000-000000000000', 'ac000000-0000-0000-0000-000000000003', 1, 'SACO-04', 'TERCEIRO', '5101', 'UN', null);
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.falha($q$select est_produtos_das_notas('e000000a-0000-0000-0000-000000000000')$q$, 'cadastra em lote', 'compras não cadastra em lote');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok(est_produtos_das_notas('e000000a-0000-0000-0000-000000000000') = 2, 'cadastra os 2 produtos vendidos novos');
select pg_temp.ok(est_produtos_das_notas('e000000a-0000-0000-0000-000000000000') = 0, 'rodar de novo não duplica');
select pg_temp.ok((select bool_and(tipo_sped = '04' and origem = 'nfe_saida' and local_padrao_id is not null and familia_id is not null) and min(unidade) = 'KG' from produtos where codigo like 'SACO-%'), 'tipo 04, família e local do acabado');
reset role;
-- isolamento
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from est_movimentos) = 0 and (select count(*) from est_saldos) = 0 and (select count(*) from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000') = 0, 'B não vê o estoque da A');
select pg_temp.ok((select count(*) from est_locais) >= 12, 'B tem a própria parametrização');
reset role;
\o
select 'ok 13_estoque_parametrizado' as resultado;

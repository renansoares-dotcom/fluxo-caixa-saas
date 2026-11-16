import test from 'node:test';
import assert from 'node:assert/strict';
import { mesesDevidos, prazoMes, nomeArquivo, resumoMes, alertas, fimMes, mesNome, fluxoCaixa, titulosAbertos, notasEmitidas, faturamento, vendasPorCliente, contratosPeriodo, paraPlanilhas, GERADORES, mesesCobertos, contasAbertasNoMes, contasDoRma, nomeExtrato, extratoConta } from '../js/lib/rma.js';

test('meses, prazo e nome padronizado do arquivo', () => {
  assert.deepEqual(mesesDevidos('2026-04-01', '2026-11-16'), ['2026-10-01', '2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01', '2026-05-01', '2026-04-01']);
  assert.deepEqual(mesesDevidos('2026-11-01', '2026-11-16'), []); assert.deepEqual(mesesDevidos('2025-12-01', '2026-02-03'), ['2026-01-01', '2025-12-01']);
  assert.equal(prazoMes('2026-10-01', 20), '2026-11-20'); assert.equal(prazoMes('2026-12-01', 5), '2027-01-05');
  assert.equal(fimMes('2026-02-01'), '2026-02-28'); assert.equal(fimMes('2028-02-01'), '2028-02-29'); assert.equal(mesNome('2026-04-01'), 'abril de 2026');
  assert.equal(nomeArquivo('iplamm', '2026-10-01', { codigo: '04', arquivo: 'Fluxo_de_Caixa' }, 'pdf'), 'IPLAMM_RMA_2026-10_04_Fluxo_de_Caixa.pdf');
  assert.equal(nomeArquivo('', '2026-04-01', { codigo: '06', arquivo: 'Extratos Bancários' }, '.XLSX', 2), 'EMPRESA_RMA_2026-04_06_Extratos_Bancarios_2.xlsx');
});
test('situação do mês e alertas de prazo', () => {
  const docs = [{ id: 'a', obrigatorio: true }, { id: 'b', obrigatorio: true }, { id: 'c', obrigatorio: false }];
  const E = (st) => st.map((s, i) => ({ mes: '2026-10-01', documento_id: 'abc'[i], status: s }));
  assert.equal(resumoMes(null, [], docs, '2026-11-16').situacao, 'nao_aberto');
  const r = resumoMes({ prazo: '2026-11-20', status: 'aberto' }, E(['pronto', 'pendente', 'pendente']), docs, '2026-11-16');
  assert.deepEqual([r.situacao, r.faltam, r.dias, r.pct], ['andamento', 1, 4, 33]);
  assert.equal(resumoMes({ prazo: '2026-11-20', status: 'aberto' }, E(['pronto', 'nao_aplica', 'pendente']), docs, '2026-11-16').situacao, 'pronto');
  assert.equal(resumoMes({ prazo: '2026-11-10', status: 'aberto' }, E(['pronto', 'pronto', 'pronto']), docs, '2026-11-16').situacao, 'atrasado');
  assert.equal(resumoMes({ prazo: '2026-11-10', status: 'enviado' }, [], docs, '2026-11-16').situacao, 'enviado');
  const cfg = { ativo: true, mes_inicio: '2026-08-01', dia_entrega: 20, dias_aviso: 5 };
  const A = alertas(cfg, [{ mes: '2026-08-01', prazo: '2026-09-20', status: 'enviado' }, { mes: '2026-10-01', prazo: '2026-11-20', status: 'aberto' }], E(['pronto', 'pendente', 'pendente']), docs, '2026-11-16');
  assert.deepEqual(A.map(a => a.mes + ':' + a.nivel), ['2026-10-01:medio', '2026-09-01:alto']);
  assert.match(A[0].texto, /faltam 1 documento/); assert.match(A[1].texto, /pacote não foi aberto/);
  assert.deepEqual(alertas({ ...cfg, ativo: false }, [], [], docs, '2026-11-16'), []);
});
const planos = [{ id: 'r', codigo: '1.01', nome: 'VENDAS', tipo: 'E' }, { id: 'f', codigo: '2.01', nome: 'FORNECEDORES', tipo: 'S', pai_id: 'g' }, { id: 'g', codigo: '2', nome: 'SAÍDAS', tipo: 'S' }, { id: 't', codigo: '9', nome: 'TRANSFERÊNCIA', tipo: 'T' }];
test('fluxo de caixa: pagos do mês, sem transferências, com o saldo das contas', () => {
  const L = [{ plano_id: 'r', status: 'Pago', data: '2026-10-05', valor: 1000 }, { plano_id: 'r', status: 'Pago', data: '2026-10-31', valor: 500 }, { plano_id: 'f', status: 'Pago', data: '2026-10-10', valor: 400 },
    { plano_id: 't', status: 'Pago', data: '2026-10-10', valor: 9999 }, { plano_id: 'r', status: 'Em aberto', data: '2026-10-12', valor: 77 }, { plano_id: 'r', status: 'Pago', data: '2026-11-01', valor: 88 }];
  const r = fluxoCaixa('2026-10-01', L, planos, [{ conta_id: 'c', nome: 'BANCO', saldo_pago: 200 }], [{ conta_id: 'c', nome: 'BANCO', saldo_pago: 1300 }], 'EXEMPLO');
  assert.deepEqual(r.totais, { entradas: 1500, saidas: 400, saldo_inicial: 200, saldo_final: 1300 });
  assert.deepEqual(r.tabelas[2].linhas, [['2.01', 'FORNECEDORES', 'SAÍDAS', 400]]); assert.equal(r.notas.length, 1); assert.equal(r.periodo, 'Competência: outubro de 2026');
  assert.equal(fluxoCaixa('2026-10-01', L, planos, [{ conta_id: 'c', nome: 'B', saldo_pago: 0 }], [{ conta_id: 'c', nome: 'B', saldo_pago: 900 }]).notas.length, 2);
});
test('contas a pagar e a receber no fim do mês', () => {
  const L = [{ plano_id: 'r', status: 'Em aberto', data: '2026-11-10', emissao: '2026-10-20', valor: 100, favorecido_id: 'x' },   // a vencer
    { plano_id: 'r', status: 'Em aberto', data: '2026-10-01', emissao: '2026-09-01', valor: 50 },                                  // vencido até 30
    { plano_id: 'f', status: 'Em aberto', data: '2026-06-30', emissao: '2026-06-01', valor: 30 },                                  // vencido +90
    { plano_id: 'f', status: 'Pago', data: '2026-11-05', emissao: '2026-10-15', valor: 70 },                                       // pago depois
    { plano_id: 'f', status: 'Pago', data: '2026-10-20', emissao: '2026-10-01', valor: 999 },                                      // pago no mês: fora
    { plano_id: 'f', status: 'Em aberto', data: '2026-12-01', emissao: '2026-11-03', valor: 999 },                                 // emitido depois: fora
    { plano_id: 't', status: 'Em aberto', data: '2026-10-01', emissao: '2026-10-01', valor: 999 }];
  const r = titulosAbertos('2026-10-01', L, planos, { x: 'CLIENTE X' });
  assert.deepEqual(r.totais, { receber: 150, pagar: 100, qtd_receber: 2, qtd_pagar: 2 });
  assert.deepEqual(r.tabelas[0].linhas, [['A vencer', 100, 0], ['Vencido até 30 dias', 50, 0], ['Vencido há mais de 90 dias', 0, 30], ['Liquidado depois do mês', 0, 70]]);
  assert.equal(r.tabelas[1].linhas[1][1], 'CLIENTE X'); assert.equal(r.periodo, 'Posição em 31/10/2026');
});
const N = (numero, emissao, v, x = {}) => ({ tipo: 'saida', emissao_propria: true, situacao: 'autorizada', finalidade: 1, cfops: ['5101'], numero, serie: '1', emissao, v_nf: v, v_icms: v * 0.18, dest_nome: 'CLIENTE A', dest_doc: '1', dest_uf: 'PE', ...x });
const notas = [N(10, '2026-10-02T10:00:00', 1000), N(11, '2026-10-02T15:00:00', 500, { dest_nome: 'CLIENTE B', dest_doc: '2' }), N(12, '2026-10-20', 300, { situacao: 'cancelada' }), N(13, '2026-10-21', 200, { cfops: ['5949'] }),
  N(14, '2026-10-22', 80, { finalidade: 4, cfops: ['5201'] }), N(15, '2026-11-01', 9999), N(16, '2026-10-05', 9999, { tipo: 'entrada' }), N(17, '2026-10-31T23:00:00', 250, { cfops: ['6101'] })];
test('notas emitidas, faturamento e vendas por cliente', () => {
  const e = notasEmitidas('2026-10-01', notas); assert.deepEqual(e.totais, { qtd: 6, autorizadas: 5, canceladas: 1, valor: 2030 }); assert.equal(e.tabelas[0].linhas[0][1], '10/1');
  const f = faturamento('2026-10-01', notas); assert.deepEqual(f.totais, { bruto: 1750, impostos: 315, liquido: 1435, notas: 3 });
  assert.deepEqual(f.tabelas[0].linhas[3].slice(1), [1, 80]); assert.deepEqual(f.tabelas[0].linhas[4].slice(1), [1, 200]); assert.deepEqual(f.tabelas[2].linhas, [['02/10/2026', 2, 1500], ['31/10/2026', 1, 250]]);
  const v = vendasPorCliente('2026-10-01', notas); assert.deepEqual(v.tabelas[0].linhas, [['CLIENTE A', '1', 'PE', 2, 1250, 71.43], ['CLIENTE B', '2', 'PE', 1, 500, 28.57]]);
  assert.equal(faturamento('2026-09-01', notas).totais.bruto, 0);
});
test('contratos do período e planilhas', () => {
  const C = [{ numero: '1', status: 'vigente', inicio: '2026-10-05', criado_em: '2026-10-01', atualizado_em: '2026-10-05', natureza: 'pagar', valor: 100, parte_nome: 'A' },
    { numero: '2', status: 'vigente', inicio: '2025-01-01', criado_em: '2025-01-01', atualizado_em: '2026-10-12T10:00:00Z', natureza: 'pagar', valor: 50, parte_nome: 'B' },
    { numero: '3', status: 'rescindido', inicio: '2025-01-01', criado_em: '2025-01-01', atualizado_em: '2026-10-30', encerrado_em: '2026-10-30', natureza: 'receber', valor: 10, parte_nome: 'C' },
    { numero: '4', status: 'rascunho', inicio: '2026-10-07', criado_em: '2026-10-01', atualizado_em: '2026-10-07' }, { numero: '5', status: 'vigente', inicio: '2024-01-01', criado_em: '2024-01-01', atualizado_em: '2026-09-01' }];
  const r = contratosPeriodo('2026-10-01', C); assert.deepEqual(r.totais, { firmados: 1, alterados: 1, encerrados: 1 }); assert.deepEqual(r.tabelas[0].linhas.map(l => l[0] + l[2]), ['Firmado1', 'Alterado2', 'Rescindido3']);
  assert.match(contratosPeriodo('2026-07-01', C).tabelas[0].linhas[0][0], /Sem contratos/);
  const P = paraPlanilhas(fluxoCaixa('2026-10-01', [], planos, [], [], 'EXEMPLO')); assert.equal(P.length, 4); assert.equal(P[0].linhas[0][0], 'EXEMPLO'); assert.deepEqual(P[1].linhas[4], ['Código', 'Conta', 'Grupo', 'Valor (R$)']);
  assert.deepEqual(Object.keys(GERADORES), ['fluxo_caixa', 'titulos', 'faturamento', 'notas_emitidas', 'vendas', 'contratos']);
});
test('fechamento do banco: meses cobertos, contas que faltam e extrato conciliado da conta', () => {
  assert.deepEqual(mesesCobertos('2026-04-01', '2026-06-30'), ['2026-04-01', '2026-05-01', '2026-06-01']);
  assert.deepEqual(mesesCobertos('2026-04-01', '2026-06-29'), ['2026-04-01', '2026-05-01']); assert.deepEqual(mesesCobertos('2026-04-01', '2026-04-15'), []);
  const contas = [{ id: 'b', nome: 'BRADESCO' }, { id: 'i', nome: 'ITAÚ' }, { id: 'x', nome: 'BLOQUEIO JUDICIAL' }, { id: 'z', nome: 'VELHA', ativo: false }], cfg = { contas_fora: ['x'] };
  assert.deepEqual(contasDoRma(contas, cfg).map(c => c.id), ['b', 'i']);
  assert.deepEqual(contasAbertasNoMes('2026-04-01', contas, [{ conta_id: 'b', ate: '2026-04-30' }, { conta_id: 'i', ate: '2026-04-29' }], cfg).map(c => c.id), ['i']);
  assert.deepEqual(contasAbertasNoMes('2026-04-01', contas, [{ conta_id: 'b', ate: '2026-10-31' }, { conta_id: 'i', ate: '2026-04-30' }], cfg), []);
  assert.equal(nomeExtrato('IPLAMM', '2026-04-01', { codigo: '06' }, { nome: 'Bradesco  Conta Movimento' }), 'IPLAMM_RMA_2026-04_06_Extrato_Bradesco_Conta_Movimento.pdf');
  const pl = [{ id: 'r', codigo: '1.01', nome: 'VENDAS', natureza: 'C' }, { id: 'f', codigo: '2.01', nome: 'FORNECEDORES', natureza: 'D' }, { id: 't', codigo: '9', nome: 'TRANSFERÊNCIA', natureza: 'D' }];
  const L = [{ plano_id: 'r', status: 'Pago', data: '2026-04-02', valor: 1000, conta_id: 'b', favorecido_id: 'c', descricao: 'NF 10', created_at: '1' }, { plano_id: 'f', status: 'Pago', data: '2026-04-02', valor: 300, conta_id: 'b', created_at: '2' },
    { plano_id: 't', status: 'Pago', data: '2026-04-10', valor: 200, conta_id: 'b', conta_destino_id: 'i' }, { plano_id: 't', status: 'Pago', data: '2026-04-11', valor: 50, conta_id: 'i', conta_destino_id: 'b' },
    { plano_id: 'r', status: 'Em aberto', data: '2026-04-12', valor: 999, conta_id: 'b' }, { plano_id: 'r', status: 'Pago', data: '2026-05-01', valor: 999, conta_id: 'b' }, { plano_id: 'r', status: 'Pago', data: '2026-04-05', valor: 999, conta_id: 'i' }];
  const e = extratoConta('2026-04-01', contas[0], L, pl, { c: 'CLIENTE A' }, 100, { ate: '2026-04-30', saldo_banco: 650, por: 'Renan', em: '2026-05-04', pendentes: 0 }, 'EXEMPLO');
  assert.deepEqual(e.totais, { saldo_inicial: 100, entradas: 1050, saidas: 500, saldo_final: 650, qtd: 4, diferenca: 0 });
  assert.deepEqual(e.tabelas[2].linhas.map(l => l[6]), [1100, 800, 600, 650]); assert.equal(e.tabelas[2].linhas[0][1], 'CLIENTE A — NF 10'); assert.match(e.tabelas[2].linhas[3][1], /Transferência recebida/);
  assert.equal(e.notas.length, 1); assert.equal(e.periodo, 'BRADESCO — 01/04/2026 a 30/04/2026'); assert.equal(e.tabelas[0].linhas[1][1], 'Conciliado e fechado');
  const d = extratoConta('2026-04-01', contas[0], L, pl, {}, 100, { ate: '2026-04-30', saldo_banco: 640 }); assert.equal(d.totais.diferenca, -10); assert.equal(d.notas.length, 2);
  const o = extratoConta('2026-04-01', contas[0], L, pl, {}, 100, { ate: '2026-10-31', saldo_banco: 5 }); assert.equal(o.totais.diferenca, null); assert.equal(o.tabelas[0].linhas.length, 3);
  assert.match(extratoConta('2026-07-01', contas[0], [], pl, {}, 30).tabelas[2].linhas[0][1], /Sem movimento/);
});

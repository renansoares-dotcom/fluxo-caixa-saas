import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../js/lib/fidc-comparador.js';

const perto = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);

test('taxas', () => {
  perto(K.taxaEf(200, 10200, 30), 0.02);
  assert.equal(K.taxaEf(10, 5, 30), 0);
  perto(K.anual(0.01), 0.12682503, 1e-6);
  perto(K.mensal(K.anual(0.0123)), 0.0123);
});

test('histórico por fundo, ponderado pelo valor antecipado × prazo', () => {
  const ops = [
    { fundo: 'A', data: '2026-10-05', valor_face: 10200, custo_total: 200, prazo_medio: 30 },   // 2,0% a.m.
    { fundo: 'A', data: '2026-09-05', valor_face: 20300, custo_total: 300, prazo_medio: 30 },   // 1,5% a.m.
    { fundo: 'B', data: '2026-10-10', valor_face: 10100, custo_total: 100, prazo_medio: 15 },   // 2,0% a.m.
    { fundo: 'B', data: '2025-01-10', valor_face: 999, custo_total: 9, prazo_medio: 10 },       // fora do período
  ];
  const H = K.historico(ops, { meses: 12, hoje: '2026-11-08' });
  assert.equal(H.meses[0], '2025-12'); assert.equal(H.meses[11], '2026-11');
  const A = H.fundos.find(f => f.fundo === 'A');
  perto(A.taxa, 500 / (10000 + 20000), 1e-9); assert.equal(A.n, 2); assert.equal(A.ultima, '2026-10-05');
  perto(A.serie[9], 0.015); perto(A.serie[10], 0.02); assert.equal(A.serie[11], null);
  assert.equal(H.fundos[0].fundo, 'A', 'o mais barato primeiro');
  assert.equal(H.fundos.find(f => f.fundo === 'B').n, 1);
});

test('curva por prazo', () => {
  const ops = [
    { fundo: 'A', data: '2026-10-05', valor_face: 10200, custo_total: 200, prazo_medio: 25 },
    { fundo: 'B', data: '2026-10-05', valor_face: 10150, custo_total: 150, prazo_medio: 28 },
    { fundo: 'A', data: '2026-10-05', valor_face: 10300, custo_total: 300, prazo_medio: 70 },
  ];
  const C = K.curvaPrazo(ops, [30, 60]);
  assert.deepEqual(C.fundos, ['A', 'B']);
  assert.equal(C.linhas[0].faixa, 'até 30 dias'); assert.equal(C.linhas[0].melhor, 'B');
  assert.equal(C.linhas[2].faixa, 'acima de 60'); assert.equal(C.linhas[2].melhor, 'A'); assert.equal(C.linhas[2].valores[1], null);
});

test('distribuir: limite, título recusado e consolidação pela tarifa fixa', () => {
  const fundos = [{ id: 'x', nome: 'X', taxa: 0.02, fixo: 100, lim: 25000 }, { id: 'y', nome: 'Y', taxa: 0.021, fixo: 100, lim: Infinity }, { id: 'z', nome: 'Z', taxa: 0.015, fixo: 1000, lim: Infinity, maxPrazo: 40 }];
  const T = [{ id: 1, valor: 20000, prazo: 30 }, { id: 2, valor: 10000, prazo: 60 }, { id: 3, valor: 1000, prazo: 30 }];
  const custoTit = (fu, t) => (fu.maxPrazo && t.prazo > fu.maxPrazo ? null : t.valor * fu.taxa * t.prazo / 30);
  const custoLote = (fu, ts) => fu.fixo + ts.reduce((s, t) => s + custoTit(fu, t), 0);
  const R = K.distribuir({ fundos, titulos: T, custoTit, custoLote, disponivel: (fu) => fu.lim });
  // Z é o mais barato por título, mas a tarifa fixa de 1.000 não compensa: os títulos de Z vão para X/Y
  assert.ok(!R.grupos.some(g => g.fu.id === 'z'));
  // com tarifa fixa igual, juntar tudo em Y (um borderô só) sai mais barato que dividir entre X e Y
  assert.deepEqual(R.grupos.map(g => g.fu.id), ['y']); assert.equal(R.custo, 100 + 400 * 1.05 + 420 + 21);
  // sem tarifa fixa, cada título fica no mais barato com limite: X recebe até 25.000
  const sem = K.distribuir({ fundos: fundos.map(f => ({ ...f, fixo: 0 })), titulos: T, custoTit, custoLote: (fu, ts) => ts.reduce((s, t) => s + custoTit(fu, t), 0), disponivel: (fu) => fu.lim });
  for (const g of sem.grupos) if (g.fu.id === 'x') assert.ok(g.face <= 25000);
  assert.ok(sem.grupos.some(g => g.fu.id === 'z'), 'Z sem tarifa fixa fica com o título de 30 dias');
  assert.equal(R.semFundo.length, 0);
  assert.equal(R.unico.fu.id, 'y', 'só Y aceita o lote inteiro (X sem limite, Z recusa 60 dias)');
  assert.ok(R.custo <= R.unico.custo + 1e-9);
  // nenhum fundo aceita
  const R2 = K.distribuir({ fundos, titulos: [{ id: 9, valor: 50, prazo: 30 }], custoTit: () => null, custoLote });
  assert.equal(R2.semFundo.length, 1); assert.equal(R2.unico, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../js/lib/custo-op.js';

const perto = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);
// o mesmo caso do teste SQL 50
const J = { ordem: { id: 'o1', numero: 99002, quantidade: 1000, produto: 'PA-C SACO' }, producao: { bom: 980, refugo: 50 },
  material: [{ codigo: 'MP-C', valor: 8320, fonte: 'custo médio' }], tinta: [], maquina: [{ valor: 500, custo_hora: 50 }], manutencao: [{ valor: 500 }],
  orcado: { material: [{ valor: 8160 }], maquina: [{ valor: 400 }], tem_estrutura: true }, venda: { preco: 15, dias: 90 } };

test('custo real, orçado, desvio e margem', () => {
  const r = K.resumir(J);
  assert.equal(r.total, 9320); perto(r.custoKg, 9320 / 980); perto(r.orcado.custoKg, 8.56);
  perto(r.desvio, 9320 / 980 / 8.56 - 1); perto(r.receita, 14700); perto(r.margem, 5380); perto(r.margemPct, 5380 / 14700);
  perto(r.refugoPct, 50 / 1030);
  assert.equal(r.sit, 'acima');            // 11% acima do orçado, tolerância 10%
  assert.equal(K.resumir(J, { tolerancia_pct: 15 }).sit, 'ok');
  assert.equal(K.resumir(J, { tolerancia_pct: 15, margem_minima_pct: 40 }).sit, 'margem');
  assert.deepEqual(r.alertas, []);
});

test('alertas e totais', () => {
  const r = K.resumir({ ordem: { quantidade: 100 }, producao: { bom: 0 }, material: [{ codigo: 'X', fonte: 'sem custo', valor: 0 }], maquina: [{ valor: 0, custo_hora: 0 }], orcado: { tem_estrutura: false }, venda: { dias: 90 } });
  assert.equal(r.custoKg, null); assert.equal(r.sit, null);
  assert.equal(r.alertas.length, 5);
  const T = K.totais([K.resumir(J), K.resumir({ ...J, producao: { bom: 1000, refugo: 0 }, manutencao: [] })]);
  assert.equal(T.ops, 2); assert.equal(T.total, 9320 + 8820); assert.equal(T.bom, 1980); assert.equal(T.acima, 1);
  perto(T.margemPct, (14700 + 15000 - 18140) / 29700);
});

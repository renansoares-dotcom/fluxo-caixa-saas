import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ponderar, classe, notaAtraso, selo } from '../js/lib/iqf.js';
const W = { qualidade: 40, entrega: 35, preco: 25 };
test('ponderação igual à do banco', () => {
  assert.equal(ponderar({ qualidade: 25, entrega: 35, preco: 0 }, W), 22.3);
  assert.equal(ponderar({ entrega: 100 }, W), 100);
  assert.equal(ponderar({ qualidade: 80, preco: 100 }, W), 87.7);
  assert.equal(ponderar({}, W), null);
  assert.equal(ponderar({ qualidade: 25, entrega: 100 }, { qualidade: 1, entrega: 0, preco: 0 }), 25);
});
test('classes e atraso', () => {
  assert.equal(classe(100, 4), 'A'); assert.equal(classe(85, 4), 'B'); assert.equal(classe(79.9, 4), 'C'); assert.equal(classe(100, 1), 'N');
  assert.equal(classe(85, 4, { iqf_faixa_a: 85 }), 'A');
  assert.equal(notaAtraso(5), 70); assert.equal(notaAtraso(2), 100); assert.equal(notaAtraso(20), 0); assert.equal(notaAtraso(-3), 100);
  assert.match(selo({ iqf: 92.5, classe: 'A' }), /IQF 92,5 · A/); assert.match(selo(null), /sem histórico/);
});

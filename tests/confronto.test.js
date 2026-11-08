import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situacaoNota, resumo, podeLiberar, filtrar } from '../js/lib/confronto.js';

const L = [
  { nota_id: 1, pedidos: [{ id: 'p' }], divergencias: [{ tipo: 'preco', bloqueia: true }], bloqueio: { situacao: 'bloqueada' } },
  { nota_id: 2, pedidos: [{ id: 'p' }], divergencias: [{ tipo: 'preco', bloqueia: true }], bloqueio: { situacao: 'liberada' } },
  { nota_id: 3, pedidos: [{ id: 'p' }], divergencias: [{ tipo: 'entrega', bloqueia: false }], bloqueio: null },
  { nota_id: 4, pedidos: [{ id: 'p' }], divergencias: [{ tipo: 'parcial' }], bloqueio: null },
  { nota_id: 5, pedidos: [], divergencias: [], bloqueio: null },
];
test('situação de cada nota', () => {
  assert.deepEqual(L.map(situacaoNota), ['bloqueada', 'liberada', 'divergente', 'ok', 'sem_pedido']);
  assert.deepEqual(filtrar(L, 'pendentes').map(n => n.nota_id), [1, 3, 5]);
  assert.equal(filtrar(L, 'todas').length, 5);
  assert.deepEqual(filtrar(L, 'liberada').map(n => n.nota_id), [2]);
});
test('resumo das divergências', () => {
  const r = resumo([{ texto: 'a', valor: 450, bloqueia: true }, { texto: 'b', valor: 100.005, bloqueia: 'true' }, { texto: 'c', bloqueia: false }]);
  assert.equal(r.bloqueia, true); assert.equal(r.valor, 550.01); assert.deepEqual(r.bloqueantes, ['a', 'b']); assert.deepEqual(r.avisos, ['c']);
  assert.equal(resumo([]).bloqueia, false);
});
test('quem libera', () => {
  assert.ok(podeLiberar('admin', [])); assert.ok(podeLiberar('financeiro'));
  assert.ok(!podeLiberar('compras')); assert.ok(podeLiberar('compras', ['compras']));
});

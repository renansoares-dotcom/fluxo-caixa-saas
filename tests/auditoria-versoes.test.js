// Auditoria por registro (10.3): versões reconstruídas pela auditoria (para trás desde o registro atual ou para frente) e diferenças.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versoes, diferencas } from '../js/lib/auditoria-versoes.js';

const E = [
  { id: 1, criado_em: '2026-11-01T10:00:00Z', acao: 'incluiu', depois: { id: 'x', valor: 100, status: 'Em aberto', descricao: 'A' } },
  { id: 2, criado_em: '2026-11-02T10:00:00Z', acao: 'alterou', campos: ['valor'], antes: { valor: 100 }, depois: { valor: 120 } },
  { id: 3, criado_em: '2026-11-03T10:00:00Z', acao: 'alterou', campos: ['status', 'descricao'], antes: { status: 'Em aberto', descricao: 'A' }, depois: { status: 'Pago', descricao: 'B' } },
];
test('versões para trás a partir do registro atual', () => {
  const V = versoes(E, { id: 'x', valor: 120, status: 'Pago', descricao: 'B', conta_id: 'c1' });
  assert.equal(V.length, 3);
  assert.deepEqual([V[0].estado.valor, V[0].estado.status, V[0].estado.conta_id], [100, 'Em aberto', 'c1']);
  assert.deepEqual([V[1].estado.valor, V[1].estado.descricao], [120, 'A']);
  assert.deepEqual([V[2].estado.status, V[2].estado.descricao], ['Pago', 'B']);
});
test('versões para frente quando o registro foi excluído', () => {
  const V = versoes([...E, { id: 4, criado_em: '2026-11-04T10:00:00Z', acao: 'excluiu', antes: { id: 'x', valor: 120, status: 'Pago', descricao: 'B' } }], null);
  assert.equal(V[3].excluido, true); assert.equal(V[1].estado.valor, 120); assert.equal(V[0].estado.descricao, 'A');
  assert.equal(V[2].estado.descricao, 'B');
});
test('sem inclusão registrada: as versões antigas recebem os valores de antes', () => {
  const V = versoes(E.slice(1), null);
  assert.equal(V[0].estado.valor, 120); assert.equal(V[0].estado.status, 'Em aberto'); assert.equal(V[1].estado.status, 'Pago');
});
test('diferenças entre duas versões ignoram os carimbos', () => {
  assert.deepEqual(diferencas({ a: 1, b: 2, updated_at: 'x' }, { a: 1, b: 3, updated_at: 'y' }), ['b']);
  assert.deepEqual(diferencas({ a: 1 }, { a: 1 }, true), ['a']);
});

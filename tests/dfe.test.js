import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrar, prazoConclusiva, podeManifestar } from '../js/lib/dfe.js';
const L = [
  { id: 1, situacao: 'resumo', situacao_nfe: 'autorizada', manifestacao: 'ciencia', emissao: '2026-11-01' },
  { id: 2, situacao: 'xml_disponivel', situacao_nfe: 'autorizada', manifestacao: null, emissao: '2026-11-01' },
  { id: 3, situacao: 'importada', situacao_nfe: 'autorizada', manifestacao: 'confirmacao', emissao: '2026-10-01' },
  { id: 4, situacao: 'resumo', situacao_nfe: 'cancelada', manifestacao: null, emissao: '2026-11-01' },
  { id: 5, situacao: 'ignorada', situacao_nfe: 'autorizada', manifestacao: null, emissao: '2026-11-01' }];
test('filtros', () => {
  assert.deepEqual(filtrar(L, 'pendentes').map(d => d.id), [1, 2]);
  assert.deepEqual(filtrar(L, 'manifestar').map(d => d.id), [1, 2]);
  assert.deepEqual(filtrar(L, 'importada').map(d => d.id), [3]);
  assert.equal(filtrar(L, 'todas').length, 5);
});
test('prazo da conclusiva', () => {
  const p = prazoConclusiva(L[0], new Date('2026-11-08T12:00:00Z'));
  assert.equal(p.ate, '2027-04-30'); assert.equal(p.dias, 173);
  assert.equal(prazoConclusiva(L[2]), null); assert.equal(prazoConclusiva(L[3]), null);
  assert.ok(podeManifestar(L[1])); assert.ok(!podeManifestar(L[2])); assert.ok(!podeManifestar(L[3]));
  assert.ok(!podeManifestar({ ...L[1], emissao: '2025-01-01' }));
});

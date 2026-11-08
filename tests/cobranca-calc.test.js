import test from 'node:test';
import assert from 'node:assert/strict';
import { aging, diasAtraso, faixaDe } from '../js/lib/cobranca-calc.js';

test('dias e faixa', () => {
  assert.equal(diasAtraso('2026-11-01', '2026-11-08'), 7);
  assert.equal(diasAtraso('2026-11-10', '2026-11-08'), -2);
  assert.equal(faixaDe(0), 'vencer'); assert.equal(faixaDe(15), 'd15'); assert.equal(faixaDe(16), 'd30'); assert.equal(faixaDe(91), 'm90');
});

test('aging por faixa e por cliente', () => {
  const r = aging([
    { favorecido_id: 'a', favorecido_nome: 'A', data: '2026-11-20', valor: 1000 },
    { favorecido_id: 'a', favorecido_nome: 'A', data: '2026-10-30', valor: 500 },
    { favorecido_id: 'b', favorecido_nome: 'B', data: '2026-07-01', valor: 2000 }], '2026-11-08');
  assert.equal(r.total, 3500);
  assert.equal(r.faixas.find(f => f.k === 'vencer').valor, 1000);
  assert.equal(r.faixas.find(f => f.k === 'd15').valor, 500);
  assert.equal(r.faixas.find(f => f.k === 'm90').valor, 2000);
  assert.equal(r.vencido, 2500);
  assert.equal(r.pessoas[0].id, 'b');
  assert.equal(r.pessoas[0].maior, 130);
  assert.equal(Math.round(r.atrasoMedio), Math.round((9 * 500 + 130 * 2000) / 2500));
});

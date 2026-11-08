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

import { lerBoleto, vencimentoDoFator, mod10, barrasDaLinha } from '../js/lib/cobranca-calc.js';
test('boleto bancário: dígitos, vencimento e valor', () => {
  const l = '00190.50095 40144.816069 06809.350314 3 37370000000100';
  assert.deepEqual(lerBoleto(l, new Date('2008-01-01')), { ok: true, tipo: 'bancario', vencimento: '2007-12-31', valor: 1 });
  assert.equal(lerBoleto(l.replace('40144', '40145')).ok, false);            // erro de digitação num campo
  assert.equal(lerBoleto(l.replace(' 3 ', ' 4 ')).ok, false);                // dígito geral
  assert.equal(lerBoleto('123').ok, false);
  const b = barrasDaLinha(l.replace(/\D/g, ''));
  assert.equal(b.length, 44); assert.equal(lerBoleto(b, new Date('2008-01-01')).vencimento, '2007-12-31');
});
test('fator de vencimento com a virada de 2025', () => {
  assert.equal(vencimentoDoFator(9999, new Date('2025-02-01')), '2025-02-21');
  assert.equal(vencimentoDoFator(1000, new Date('2025-03-01')), '2025-02-22');
  assert.equal(vencimentoDoFator(1000, new Date('2000-07-01')), '2000-07-03');
  assert.equal(vencimentoDoFator(0), null);
});
test('arrecadação (48 dígitos, módulo 10)', () => {
  const barras0 = '836' + '0' + '00000012345' + '0179' + '0000000000000000000000001';   // DV geral na 4ª posição
  const barras = barras0.slice(0, 3) + mod10(barras0.slice(0, 3) + barras0.slice(4)) + barras0.slice(4);
  const linha = [0, 1, 2, 3].map(i => { const x = barras.slice(i * 11, i * 11 + 11); return x + mod10(x); }).join('');
  assert.deepEqual(lerBoleto(linha), { ok: true, tipo: 'arrecadacao', valor: 123.45 });
  assert.equal(lerBoleto(linha.slice(0, 5) + ((+linha[5] + 1) % 10) + linha.slice(6)).ok, false);
});

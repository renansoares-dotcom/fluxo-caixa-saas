import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../js/lib/caixa-cenarios.js';

const addDias = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('normalizar completa e limita as premissas', () => {
  const p = K.normalizar({ receber_pct: '92,5', receber_atraso_dias: 500, pagar_pct: -3, eventos: [{ data: '2026-12-01', valor: 1000 }, { data: 'x', valor: 1 }] });
  assert.equal(p.receber_pct, 92.5); assert.equal(p.receber_atraso_dias, 180); assert.equal(p.pagar_pct, 0);
  assert.equal(p.forecast, true); assert.equal(p.compromissos, true); assert.equal(p.eventos.length, 1); assert.equal(p.rj.ativo, false);
});

test('ajustarLanc aplica %, atraso e vencidos', () => {
  const p = K.normalizar({ receber_pct: 90, receber_atraso_dias: 10, vencidos_receber_pct: 50, pagar_pct: 100, pagar_atraso_dias: 5 });
  assert.deepEqual(K.ajustarLanc(p, '2026-11-20', 1000, '2026-11-08', addDias), { data: '2026-11-30', v: 900 });
  assert.deepEqual(K.ajustarLanc(p, '2026-11-01', 1000, '2026-11-08', addDias), { data: '2026-11-01', v: 500, vencido: true });
  assert.deepEqual(K.ajustarLanc(p, '2026-11-20', -400, '2026-11-08', addDias), { data: '2026-11-25', v: -400 });
});

test('simularRJ: linear sem juros, Price com juros e carência', () => {
  const a = K.simularRJ({ ativo: true, passivo: 1200000, desagio_pct: 50, parcelas: 60, inicio: '2027-03', dia: 31 });
  assert.equal(a.liquido, 600000); assert.equal(a.parcela, 10000); assert.equal(a.primeira, '2027-03-31'); assert.equal(a.cronograma[1].data, '2027-04-30');
  assert.equal(a.cronograma.length, 60); assert.equal(a.ultima, '2032-02-29');
  const b = K.simularRJ({ ativo: true, passivo: 100000, parcelas: 12, juros_aa_pct: 12, carencia_meses: 6, inicio: '2027-01', dia: 10 });
  assert.equal(b.primeira, '2027-07-10');
  assert.ok(b.parcela > 100000 / 12 * 1.05 && b.parcela < 100000 / 12 * 1.15, 'juros capitalizados na carência + Price');
  assert.equal(K.simularRJ({ ativo: false, passivo: 1, inicio: '2027-01' }).parcela, 0);
});

test('validar e montarLista', () => {
  assert.ok(K.validar({ nome: '', premissas: {} }).length);
  assert.ok(K.validar({ nome: 'RJ', premissas: { rj: { ativo: true, passivo: 0 } } }).some(e => /passivo/.test(e)));
  assert.deepEqual(K.validar({ nome: 'Ok', premissas: {} }), []);
  const l = K.montarLista([{ id: 'x', tipo: 'pessimista', nome: 'Pessimista', ordem: 3, premissas: { receber_pct: 80 } }, { id: 'y', tipo: 'personalizado', nome: 'RJ março', ordem: 10, premissas: {} }]);
  assert.deepEqual(l.map(c => c.nome), ['Base', 'Otimista', 'Pessimista', 'RJ março']);
  assert.equal(l.find(c => c.tipo === 'pessimista').premissas.receber_pct, 80);
});

test('comparar e resumoPremissas', () => {
  const C = K.comparar([{ nome: 'A', semanas: [{ ini: '1', saldo: 100 }, { ini: '2', saldo: 40 }] }, { nome: 'B', semanas: [{ ini: '1', saldo: 100 }, { ini: '2', saldo: 120 }] }], 50);
  assert.equal(C[0].primeira.ini, '2'); assert.equal(C[0].maxFalta, 10); assert.equal(C[1].primeira, null); assert.equal(C[1].saldoFinal, 120);
  assert.equal(K.resumoPremissas({}), 'como está');
  assert.match(K.resumoPremissas(K.PADROES[2].premissas), /recebe 92%.*atraso de 15 dias/);
});

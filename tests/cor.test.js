import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, rgbToHex, rgbToLab, labToRgb, deltaE2000, classificaDE, paresProva, recolorFactory } from '../js/lib/cor.js';
const perto = (a, b, t = 0.01) => Math.abs(a - b) <= t;

test('sRGB ↔ Lab (D65)', () => {
  const w = rgbToLab([255, 255, 255]); assert.ok(perto(w[0], 100, 0.01) && perto(w[1], 0, 0.01) && perto(w[2], 0, 0.01));
  const r = rgbToLab([255, 0, 0]); assert.ok(perto(r[0], 53.24, 0.02) && perto(r[1], 80.09, 0.03) && perto(r[2], 67.2, 0.03));
  for (const h of ['#c8102e', '#f1c400', '#1d1d1b', '#0a8ed3']) assert.equal(rgbToHex(labToRgb(rgbToLab(hexToRgb(h)))), h);
  assert.equal(hexToRgb('xyz'), null);
});

test('ΔE2000 nos pares de referência de Sharma, Wu e Dalal (2005)', () => {
  const P = [[[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425], [[50, 0, 0], [50, -1, 2], 2.3669], [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082], [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195], [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644]];
  for (const [a, b, e] of P) assert.ok(perto(deltaE2000(a, b), e, 0.0001), `${a} × ${b}: ${deltaE2000(a, b)} ≠ ${e}`);
  assert.equal(deltaE2000([50, 10, 10], [50, 10, 10]), 0);
});

test('prova de cor: pares, ΔE e recoloração', () => {
  const T = { t1: { codigo: 'T-186', nome: 'Vermelho', lab_l: 45, lab_a: 66, lab_b: 36 }, t2: { codigo: 'T-7406', nome: 'Amarelo', hex: '#f1c400' } };
  const P = paresProva([{ nome: '186 C', pantone: 'Pantone 186 C', hex: '#c8102e', tin_cor_id: 't1' }, { nome: '7406', hex: '#f1c400', tin_cor_id: 't2' }, { nome: 'Preto', hex: '#1d1d1b' }], T);
  assert.equal(P.length, 3); assert.ok(P[0].medido && P[0].de > 2); assert.equal(P[1].de, 0); assert.equal(P[2].tinta, null); assert.equal(P[2].de, null);
  const rec = recolorFactory(P);
  assert.equal(rgbToHex(rec(200, 16, 46)), P[0].para_hex);                 // a cor exata vira a tinta real
  assert.deepEqual(rec(255, 255, 255), [255, 255, 255]);                   // longe das cores: não muda
  assert.equal(classificaDE(0.8).txt, 'imperceptível'); assert.equal(classificaDE(4).cls, 'neg'); assert.equal(classificaDE(2.5).txt, 'perceptível'); assert.equal(classificaDE(2.5, { ok: 3 }).txt, 'aceitável');
});

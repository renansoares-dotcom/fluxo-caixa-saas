// Conciliação sugerida (3.2): nota de confiança por critério e faixas configuráveis; leitura do extrato CNAB 240 (segmento E).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confianca, configConc } from '../js/lib/conc-confianca.js';
import { lerCNAB240, ehCNAB240 } from '../js/lib/cnab-extrato.js';

test('nota de confiança: mesmo valor, mesmo dia e único candidato é alta', () => {
  const r = confianca({ tipo: 'exato', dd: 0, af: 0, unico: true });
  assert.equal(r.nota, 85); assert.equal(r.faixa, 'alta');
  assert.ok(r.motivos.some(m => m.includes('mesma data')));
});
test('nota de confiança: distância em dias desconta; texto e documento somam', () => {
  assert.equal(confianca({ tipo: 'exato', dd: 2, af: 0, unico: true }).faixa, 'media');
  assert.equal(confianca({ tipo: 'exato', dd: 2, af: 2, unico: true }).nota, 93);
  assert.equal(confianca({ tipo: 'baixa', dd: 0, doc: true, unico: true }).faixa, 'alta');
  assert.equal(confianca({ tipo: 'exato', dd: 0, af: 3, doc: true, unico: true }).nota, 100);   // limitada a 100
});
test('nota de confiança: ambíguo sem texto cai para conferir; com texto não perde pontos', () => {
  assert.equal(confianca({ tipo: 'exato', dd: 0, af: 0, unico: false }).faixa, 'baixa');
  assert.equal(confianca({ tipo: 'exato', dd: 0, af: 1, unico: false }).nota, 87);
});
test('grupos: relatório do ERP é alta; vários movimentos fora de relatório perde pontos', () => {
  assert.equal(confianca({ tipo: 'grupo', relatorio: true, dd: 0, unico: true }).faixa, 'alta');
  assert.equal(confianca({ tipo: 'grupo', dd: 0, variosMov: true }).faixa, 'baixa');
});
test('pesos e faixas configuráveis', () => {
  const cfg = configConc({ conf_alta: 95, conf_media: 70, pesos: { mesmo_dia: 30 } });
  const r = confianca({ tipo: 'exato', dd: 0, af: 0, unico: true }, cfg);
  assert.equal(r.nota, 95); assert.equal(r.faixa, 'alta');
  assert.equal(confianca({ tipo: 'exato', dd: 1, unico: true }, cfg).faixa, 'media');
  assert.equal(configConc({}).diasExato, 3); assert.equal(configConc({ dias_baixa: 10 }).diasBaixa, 10);
});

// ---- CNAB 240: monta linhas de 240 posições pelo layout FEBRABAN
const linha = (campos) => { const a = Array(240).fill(' '); for (const [ini, s] of campos) for (let k = 0; k < s.length; k++) a[ini - 1 + k] = s[k]; return a.join(''); };
const num = (v, n) => String(Math.round(v * 100)).padStart(n, '0');
const det = (seq, dt, v, dc, hist, doc) => linha([[1, '237'], [4, '0001'], [8, '3'], [9, String(seq).padStart(5, '0')], [14, 'E'], [53, '01234'], [59, '000000012345'], [71, '6'],
  [109, 'DPV'], [135, dt], [143, dt], [151, num(v, 18)], [169, dc], [170, '101'], [173, '0123'], [177, hist.padEnd(25)], [202, doc.padStart(39, '0')]]);
const ARQ = [
  linha([[1, '237'], [4, '0000'], [8, '0'], [73, 'PLASTICOS EXEMPLO LTDA']]),
  linha([[1, '237'], [4, '0001'], [8, '1'], [9, 'E'], [10, '04'], [53, '01234'], [59, '000000012345'], [71, '6'], [143, '31102026'], [151, num(1000, 18)], [169, 'C']]),
  det(1, '03112026', 1500.5, 'C', 'PIX RECEBIDO CLIENTE A', '778'),
  det(2, '03112026', 320.1, 'D', 'TARIFA BANCARIA', '0'),
  det(3, '04112026', 320.1, 'D', 'TARIFA BANCARIA', '0'),
  linha([[1, '237'], [4, '0001'], [8, '5'], [143, '04112026'], [151, num(1860.3, 18)], [169, 'C'], [171, '000005']]),
  linha([[1, '237'], [4, '9999'], [8, '9']]),
].join('\r\n');

test('CNAB 240: lê o lote com movimentos, sinal, documento e saldo final', () => {
  assert.equal(ehCNAB240(ARQ), true); assert.equal(ehCNAB240('<OFX>'), false);
  const [x] = lerCNAB240(ARQ);
  assert.equal(x.banco, '237'); assert.equal(x.agencia, '1234'); assert.equal(x.conta, '123456');
  assert.equal(x.itens.length, 3);
  assert.deepEqual([x.itens[0].data, x.itens[0].valor, x.itens[0].documento], ['2026-11-03', 1500.5, '778']);
  assert.equal(x.itens[1].valor, -320.1);
  assert.equal(x.inicio, '2026-11-03'); assert.equal(x.fim, '2026-11-04');
  assert.equal(x.saldo, 1860.3); assert.equal(x.saldoData, '2026-11-04'); assert.equal(x.formato, 'cnab240');
  assert.notEqual(x.itens[1].fitid, x.itens[2].fitid);   // tarifas iguais em dias diferentes
  assert.ok(x.itens[0].fitid.startsWith('cnab:2026-11-03|1500.50|778|'));
});
test('CNAB 240: recusa retorno de cobrança (segmento T)', () => {
  const cob = ARQ.replace(/^(.{13})E/m, '$1T').split('\r\n'); cob[2] = cob[2].slice(0, 13) + 'T' + cob[2].slice(14);
  assert.throws(() => lerCNAB240(cob.join('\r\n')), /não é de extrato/);
});

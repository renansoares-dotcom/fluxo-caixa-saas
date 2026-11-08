import test from 'node:test';
import assert from 'node:assert/strict';
import { troca, sequenciar, distribuir, totalTrocas } from '../js/lib/programacao-calc.js';

const cfg = { troca_cor_min: 20, limpeza_escuro_claro_min: 40, janela_entrega_dias: 3 };
const AM = { id: 'am', esc: 10 }, AZ = { id: 'az', esc: 60 }, PT = { id: 'pt', esc: 95 };
const it = (id, entrega, cores, extra = {}) => ({ id, numero: +id.replace(/\D/g, '') || 0, entrega, prioridade: 3, cores, horas: 6, ...extra });

test('troca: cores novas e limpeza do escuro para o claro', () => {
  assert.equal(troca(null, it('a', null, [AM]), cfg), 20);
  assert.equal(troca(it('a', null, [AM]), it('b', null, [AM, AZ]), cfg), 20);
  assert.equal(troca(it('a', null, [PT]), it('b', null, [AM]), cfg), 60);
  assert.equal(troca(it('a', null, [AM]), it('b', null, []), cfg), 0);
});

test('sequenciar: dentro da janela, do claro para o escuro', () => {
  const r = sequenciar([it('p1', '2026-11-10', [PT]), it('p2', '2026-11-11', [AM]), it('p3', '2026-11-12', [AM, AZ])], cfg);
  assert.deepEqual(r.fila.map(x => x.id), ['p2', 'p3', 'p1']);
  assert.ok(r.trocaTotal < r.trocaBase, 'economiza troca');
  assert.equal(r.economiaMin, r.trocaBase - r.trocaTotal);
});

test('sequenciar: fora da janela a entrega manda; urgente não espera', () => {
  const r = sequenciar([it('p1', '2026-11-10', [PT]), it('p2', '2026-11-20', [AM])], cfg);
  assert.deepEqual(r.fila.map(x => x.id), ['p1', 'p2']);
  const u = sequenciar([it('p1', '2026-11-10', [PT], { prioridade: 1 }), it('p2', '2026-11-10', [AM])], cfg);
  assert.equal(u.fila[0].id, 'p1');
});

test('sequenciar: bloqueadas no fim', () => {
  const r = sequenciar([it('p1', '2026-11-09', [AM], { bloqueada: true }), it('p2', '2026-11-15', [AM])], cfg);
  assert.deepEqual(r.fila.map(x => x.id), ['p2', 'p1']);
  assert.equal(totalTrocas(r.fila, cfg), r.trocaTotal);
});

test('distribuir: enche o dia, passa para o seguinte e marca atraso', () => {
  const d = distribuir([it('a', '2026-11-10', [], { horas: 6 }), it('b', '2026-11-10', [], { horas: 6 }), it('c', '2026-11-30', [], { horas: 25 })], '2026-11-10', 10);
  assert.deepEqual(d.map(x => [x.inicio, x.fim]), [['2026-11-10', '2026-11-10'], ['2026-11-11', '2026-11-11'], ['2026-11-12', '2026-11-14']]);
  assert.deepEqual(d.map(x => x.atrasa), [false, true, false]);
});

test('sequenciar: a cor não faz a mais urgente atrasar', () => {
  const itens = [it('p1', '2026-11-10', [PT], { horas: 8 }), it('p2', '2026-11-11', [AM], { horas: 8 })];
  assert.equal(sequenciar(itens, cfg, null, { inicio: '2026-11-10', horasDia: 10 }).fila[0].id, 'p1');
  assert.equal(sequenciar(itens, cfg, null, { inicio: '2026-11-08', horasDia: 10 }).fila[0].id, 'p2');
});

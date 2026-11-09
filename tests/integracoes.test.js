import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordenar, resumo, haQuanto, textoEsperado } from '../js/lib/integracoes.js';
const L = [{ codigo: 'a', situacao: 'ok' }, { codigo: 'b', situacao: 'desligada' }, { codigo: 'c', situacao: 'falha' }, { codigo: 'd', situacao: 'atrasada' }, { codigo: 'e', situacao: 'sem_dados' }];
test('ordem e resumo', () => {
  assert.deepEqual(ordenar(L).map(x => x.codigo), ['d', 'c', 'e', 'a', 'b']);
  assert.deepEqual(resumo(L), { atencao: 2, atrasadas: 1, falhas: 1, ok: 1, total: 4 });
});
test('tempo e esperado', () => {
  const t = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(haQuanto(null, t), 'nunca'); assert.equal(haQuanto('2026-11-11T11:59:30Z', t), 'agora');
  assert.equal(haQuanto('2026-11-11T11:30:00Z', t), 'há 30 min'); assert.equal(haQuanto('2026-11-11T07:00:00Z', t), 'há 5 h'); assert.equal(haQuanto('2026-11-08T12:00:00Z', t), 'há 3 dias');
  assert.equal(textoEsperado({ max_dias: 0 }), 'sem prazo'); assert.equal(textoEsperado({ max_dias: 1 }), 'todo dia útil'); assert.equal(textoEsperado({ max_dias: 3 }), 'a cada 3 dias úteis');
});

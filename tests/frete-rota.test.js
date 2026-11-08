import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumo, textoSugestao } from '../js/lib/frete-rota.js';
const R = [
  { rota: 'RECIFE / PE', proprio: { peso_kg: 6000, custo: 1200, rs_t: 200 }, terceiro: { peso_kg: 3000, custo: 450, rs_t: 150 }, dif_pct: -25, sugestao: 'terceirizar', economia: 300 },
  { rota: 'CARUARU / PE', proprio: { peso_kg: 5000, custo: 180, rs_t: 36 }, terceiro: { peso_kg: 5000, custo: 900, rs_t: 180 }, dif_pct: 400, sugestao: 'frota_propria', economia: 720 },
  { rota: 'NATAL/RN', proprio: { peso_kg: null, custo: null, rs_t: null }, terceiro: { peso_kg: 0, custo: 2000, rs_t: null }, dif_pct: null, sugestao: 'sem_base', economia: 0 },
];
test('resumo das rotas', () => {
  const s = resumo(R);
  assert.equal(s.rotas, 3); assert.equal(s.comparaveis, 2); assert.equal(s.terceirizar, 1); assert.equal(s.frota, 1);
  assert.equal(s.economia, 1020); assert.equal(s.rs_t_proprio, 125.45); assert.equal(s.rs_t_terceiro, 168.75);
  assert.equal(resumo([]).rs_t_proprio, null);
});
test('textos', () => {
  assert.equal(textoSugestao(R[0]), 'terceiro sai 25% mais barato por tonelada');
  assert.equal(textoSugestao(R[1]), 'frota própria sai 80% mais barata por tonelada');
  assert.equal(textoSugestao(R[2]), 'sem peso nas notas');
  assert.equal(textoSugestao({ sugestao: 'sem_base', proprio: { rs_t: 10 }, terceiro: {} }), 'só frota própria nesta rota');
});

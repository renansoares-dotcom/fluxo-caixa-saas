import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvaABC, situacao, acaoSugerida, visitasDevidas, km, montarRota, diasUteis, CFG_PADRAO } from '../js/lib/comercial-geo.js';

test('curva ABC: o cliente que cruza a faixa ainda entra nela', () => {
  const r = curvaABC([{ id: 'a', valor: 50 }, { id: 'b', valor: 30 }, { id: 'c', valor: 10 }, { id: 'd', valor: 6 }, { id: 'e', valor: 4 }, { id: 'z', valor: 0 }]);
  assert.deepEqual(r.lista.map(x => x.classe).join(''), 'AABBC');   // antes: 0, 50, 80, 90, 96
  assert.equal(r.porId.z, undefined); assert.equal(r.total, 100);
  assert.equal(r.resumo.A.n, 2); assert.equal(r.resumo.A.pct, 80); assert.equal(r.resumo.C.pct, 4);
  assert.equal(r.lista[4].acum_pct, 100);
  assert.deepEqual(curvaABC([{ id: 'x', valor: 10 }], { abc_a_pct: 70, abc_b_pct: 90 }).lista[0].classe, 'A');
});

test('situação pelos parâmetros', () => {
  const h = '2026-11-08';
  assert.equal(situacao({ primeira: '2025-01-01', ultima: '2026-04-01', intervalo: 30 }, h), 'inativo');
  assert.equal(situacao({ primeira: '2025-01-01', ultima: '2026-09-20', intervalo: 30 }, h), 'esfriando');   // 49 d > 45
  assert.equal(situacao({ primeira: '2025-01-01', ultima: '2026-09-20', intervalo: 30 }, h, { ...CFG_PADRAO, esfriando_fator: 2 }), 'ativo');
  assert.equal(situacao({ primeira: '2026-10-01', ultima: '2026-11-01', intervalo: 31 }, h), 'novo');
  assert.equal(situacao({}, h), 'sem');
});

test('ação sugerida pela classe', () => {
  const h = '2026-11-08';
  assert.deepEqual(acaoSugerida({ classe: 'A', st: 'esfriando', desde: 49, intervalo: 30 }, h), { tipo: 'visita', ate: '2026-11-11', texto: 'Visitar (cliente A): sem comprar há 49 dias (o normal é a cada 30)' });
  assert.equal(acaoSugerida({ classe: 'C', st: 'inativo', desde: 200 }, h).tipo, 'whatsapp');
  assert.equal(acaoSugerida({ classe: 'C', st: 'inativo', desde: 200 }, h).ate, '2026-11-22');
  assert.equal(acaoSugerida({ classe: 'B', st: 'ativo' }, h), null);
});

test('visitas devidas pela frequência da classe', () => {
  const L = visitasDevidas([{ id: 1, classe: 'A', ultima_visita: '2026-10-01' }, { id: 2, classe: 'A', ultima_visita: '2026-10-20' }, { id: 3, classe: 'C' }, { id: 4 }], '2026-11-08');
  assert.deepEqual(L.map(x => x.id), [1, 3]); assert.equal(L[0].dias_sem_visita, 38);
});

test('rotas: distância, dias por limite e 2-opt', () => {
  const caruaru = { lat: -8.2849, lng: -35.9699 }, recife = { lat: -8.0476, lng: -34.877 };
  assert.ok(Math.abs(km(caruaru, recife) - 122) < 6);
  const P = [{ id: 'r', ...recife }, { id: 'g', lat: -8.89, lng: -36.49 }, { id: 'c', ...caruaru }, { id: 's', lat: -8.33, lng: -36.14 }, { id: 'x' }];
  const R = montarRota(caruaru, P, { ...CFG_PADRAO, visitas_por_dia: 2, km_por_dia: 300 });
  assert.equal(R.semLocal.length, 1); assert.equal(R.dias.flatMap(d => d.paradas).length, 4);
  assert.ok(R.dias.every(d => d.paradas.length <= 2 && (d.km <= 300 || d.paradas.length === 1)));   // uma visita sozinha pode passar do limite
  assert.equal(R.dias[0].paradas[0].id, 'c'); assert.equal(R.dias[0].paradas[0].km, 0);
  assert.deepEqual(diasUteis('2026-11-06', 3), ['2026-11-06', '2026-11-09', '2026-11-10']);
  const R2 = montarRota(caruaru, P, { ...CFG_PADRAO, raio_km: 130 });
  assert.deepEqual(R2.foraRaio.map(x => x.id), ['r']); assert.equal(R2.dias.flatMap(d => d.paradas).length, 3);
});

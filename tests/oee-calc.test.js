import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../js/lib/oee-calc.js';

const perto = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);
// o mesmo dia do teste SQL 49: 20 h de calendário, 2 h de setup, 10 h apontadas, 800 kg em 100 kg/h, 3 h + 1,5 h paradas
const L = { maquina_id: 'm1', per: '2026-10-05', horas_cal: 20, horas_run: 10, bom: 760, refugo: 40, h_plan: 2, h_nao_plan: 3, h_os: 1.5, qtd_os: 1, capacidade: 100 };

test('índices e perdas', () => {
  const x = K.indices(L);
  assert.equal(x.tPlan, 18); perto(x.D, 10 / 18); perto(x.P, 0.8); perto(x.Q, 0.95); perto(x.oee, 10 / 18 * 0.8 * 0.95);
  assert.equal(x.naoPlan, 4.5); perto(x.perdas.naoApont, 3.5); perto(x.perdas.velocidade, 2); perto(x.perdas.qualidade, 0.4); perto(x.perdas.efetivo, 7.6);
  // as perdas somam o tempo planejado
  const p = x.perdas; perto(p.naoPlan + p.naoApont + p.velocidade + p.qualidade + p.efetivo, x.tPlan);
  assert.equal(K.maiorPerda(p).nome, 'paradas não planejadas');
});

test('casos limite', () => {
  const sem = K.indices({ ...L, capacidade: 0 });
  assert.equal(sem.P, null); assert.equal(sem.oee, null);
  const vazio = K.indices({ horas_cal: 0 });
  assert.equal(vazio.D, null); assert.equal(vazio.Q, null);
  // apontou mais do que o tempo planejado: limita a 100%
  const x = K.indices({ ...L, horas_run: 30, bom: 5000, refugo: 0 });
  assert.equal(x.D, 1); assert.equal(x.P, 1); assert.equal(x.Q, 1);
});

test('agrupamentos, metas e Pareto', () => {
  const linhas = [L, { ...L, per: '2026-10-06', bom: 400, refugo: 0, horas_run: 5 }, { ...L, maquina_id: 'm2', capacidade: 50 }];
  assert.equal(K.porMaquina(linhas).length, 2); assert.deepEqual(K.porPeriodo(linhas).map(p => p.per), ['2026-10-05', '2026-10-06']);
  const m1 = K.porMaquina(linhas).find(m => m.maquina_id === 'm1');
  assert.equal(m1.horas_cal, 40); assert.equal(m1.bom, 1160);
  assert.equal(K.situacao(0.66, 65), 'ok'); assert.equal(K.situacao(0.6, 65, 10), 'atencao'); assert.equal(K.situacao(0.5, 65, 10), 'abaixo'); assert.equal(K.situacao(null, 65), null);
  assert.equal(K.metaMaquina({ meta_oee: 65, metas_maquina: { m2: 50 } }, 'm2'), 50); assert.equal(K.metaMaquina({ meta_oee: 65, metas_maquina: {} }, 'm1'), 65);
  const P = K.pareto([{ motivo: 'A', horas: 1, qtd: 1 }, { motivo: 'B', horas: 3, qtd: 2 }, { motivo: 'A', horas: 1, qtd: 1 }, { motivo: 'C', horas: 0 }]);
  assert.deepEqual(P.map(x => x.motivo), ['B', 'A']); perto(P[0].pct, 0.6); perto(P[1].acum, 1); assert.equal(P[1].qtd, 2);
  assert.equal(K.preparar({ linhas: [{ maquina_id: 'm1' }] }, [{ id: 'm1', capacidade_kg_h: 120 }])[0].capacidade, 120);
});

// Indicadores de logística: prazo, devolução, ocupação, km, custo sobre as notas e frente à meta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indicadores, frenteMeta, mesesAte } from '../js/lib/logistica-indicadores.js';

const veiculos = [{ id: 'v1', carga_kg: 10000, comp_m: 5, larg_m: 2, alt_m: 2, situacao: 'disponivel' }];
const cargas = [{ id: 'c1', data: '2026-10-05', veiculo_id: 'v1', status: 'concluida', peso_kg: 8000, volume_m3: 16, km_previsto: 400, km_real: 440 },
  { id: 'c2', data: '2026-10-12', veiculo_id: 'v1', status: 'concluida', peso_kg: 6000, volume_m3: 10, km_previsto: 200, km_real: 200 },
  { id: 'c3', data: '2026-09-30', veiculo_id: 'v1', status: 'concluida', peso_kg: 9000 }];
const nota = (emissao, v_nf, dest_nome = 'CLIENTE A') => ({ emissao, v_nf, dest_nome });
const cnotas = [
  { carga_id: 'c1', situacao: 'entregue', entregue_em: '2026-10-06T10:00:00Z', nota: nota('2026-10-04', 50000) },
  { carga_id: 'c1', situacao: 'entregue', entregue_em: '2026-10-09T10:00:00Z', nota: nota('2026-10-02', 30000, 'CLIENTE B') },   // 7 dias: atrasou
  { carga_id: 'c2', situacao: 'entregue', entregue_em: '2026-10-13T10:00:00Z', nota: nota('2026-10-11', 20000) },
  { carga_id: 'c2', situacao: 'devolvida', nota: nota('2026-10-11', 5000) },
];
const B = { cargas, cnotas, veiculos, fretes: [{ data: '2026-10-20', valor: 1000, status: 'pago', carga_id: null }], abast: [], manut: [{ veiculo_id: 'v1', data: '2026-10-10', valor: 2000 }], multas: [], locacao: {}, diasAtraso: 3 };

test('nível de serviço, ocupação e km', () => {
  const k = indicadores('2026-10', B);
  assert.equal(k.cargas, 2); assert.equal(k.notas, 4); assert.equal(k.entregues, 3);
  assert.equal(k.prazo_pct, 66.7); assert.equal(k.lead_dias, 3.7); assert.equal(k.devol_pct, 25);
  assert.equal(k.ocupacao_pct, 70); assert.equal(k.ocupacao_vol_pct, 65);
  assert.equal(k.entregas_carga, 2); assert.equal(k.km_carga, 320); assert.equal(k.desvio_km_pct, 6.7);
  assert.deepEqual(k.atrasos.map(a => a.nome), ['CLIENTE B']);
});
test('custo logístico sobre as notas entregues', () => {
  const k = indicadores('2026-10', B);
  assert.equal(k.custo_total, 3000); assert.equal(k.valor_entregue, 100000); assert.equal(k.custo_pct, 3); assert.equal(k.custo_kg, 0.21); assert.equal(k.custo_entrega, 1000);
});
test('frente à meta e meses', () => {
  assert.equal(frenteMeta(96, 95), 'ok'); assert.equal(frenteMeta(88, 95), 'warn'); assert.equal(frenteMeta(70, 95), 'neg');
  assert.equal(frenteMeta(4, 5, 'menor'), 'ok'); assert.equal(frenteMeta(5.4, 5, 'menor'), 'warn'); assert.equal(frenteMeta(8, 5, 'menor'), 'neg');
  assert.equal(frenteMeta(null, 5), null);
  assert.deepEqual(mesesAte('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
});

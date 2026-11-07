// Casa de Tintas: escala, andamento da pesagem, correção de proporção, custo teórico, ΔE76/ΔE00, medição, indicadores, alertas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/lib/tintas.js';

const V = { base_kg: 100, viscosidade_alvo: 22, viscosidade_tol: 2, delta_e_max: 1.5 };
const IT = [{ id: 'b', seq: 1, produto_id: 'pb', quantidade: 60 }, { id: 'p', seq: 2, produto_id: 'pp', quantidade: 25 }, { id: 's', seq: 3, produto_id: 'ps', quantidade: 15 }];

test('composição, escala e custo teórico', () => {
  const c = T.composicao(IT, 100);
  assert.equal(c.fecha, true); assert.deepEqual(c.linhas.map(l => l.pct), [60, 25, 15]);
  assert.equal(T.prevista(IT[0], V, 20), 12);
  const ct = T.custoTeorico(IT, { pb: 10, pp: 40, ps: 6 });
  assert.equal(ct.custoKg, 16.9); assert.equal(ct.faltam, 0);
  assert.equal(T.custoTeorico(IT, { pb: 10 }).faltam, 2);
});

test('andamento da pesagem e correção de proporção', () => {
  const P = [{ item_id: 'b', pesada: 12.1, custo: 121 }, { item_id: 'p', pesada: 5.3, custo: 212 }, { item_id: 's', pesada: 1, custo: 6, situacao: 'estornada' }];
  const a = T.andamento(IT, P, V, 20, 2);
  assert.deepEqual(a.linhas.map(l => l.status), ['ok', 'acima', 'falta']);
  assert.equal(a.linhas[1].desvio, 6); assert.equal(a.proxima.item.id, 's'); assert.equal(a.completa, false);
  assert.equal(a.total, 17.4); assert.equal(a.custo, 333);
  const c = T.correcaoProporcao(a, 20);
  assert.equal(c.nova, 21.2); assert.equal(c.item.id, 'p'); assert.equal(c.acrescimo, 1.2);
  const b = T.andamento(IT, P, V, 21.2, 2);
  assert.deepEqual(b.linhas.map(l => l.status), ['abaixo', 'ok', 'falta'], 'com a nova quantidade a base fica abaixo e é completada');
  assert.equal(b.linhas[0].falta, 0.62);
  assert.equal(T.correcaoProporcao(b, 21.2), null);
});

test('ΔE CIE76 e CIEDE2000 (dados de Sharma et al.)', () => {
  assert.equal(T.deltaE76({ l: 50, a: 0, b: 0 }, { l: 53, a: 4, b: 0 }), 5);
  assert.equal(T.deltaE00({ l: 50, a: 2.6772, b: -79.7751 }, { l: 50, a: 0, b: -82.7485 }), 2.0425);
  assert.equal(T.deltaE00({ l: 50, a: 0, b: 0 }, { l: 50, a: -1, b: 2 }), 2.3669);
  assert.equal(T.deltaE00({ l: 50, a: 2.5, b: 0 }, { l: 56, a: -27, b: -3 }), 31.903);
  assert.equal(T.deltaE00({ l: 60.2574, a: -34.0099, b: 36.2677 }, { l: 60.4626, a: -34.1751, b: 39.4387 }), 1.2644);
});

test('medição contra a versão', () => {
  assert.equal(T.medicaoOk({ viscosidade: 26, delta_e: 0.9 }, V).ok, false);
  assert.equal(T.medicaoOk({ viscosidade: 22.5, delta_e: 0.8 }, V).ok, true);
  assert.equal(T.medicaoOk({ viscosidade: 22.5, delta_e: 1.6 }, V).deOk, false);
  assert.equal(T.medicaoOk({}, V).ok, false, 'medição vazia não vale');
});

test('indicadores e alertas', () => {
  const O = [{ id: 'o1', cor_id: 'c1', situacao: 'aprovada', aprovada_em: '2026-11-03T10:00:00Z', quantidade_real: 21.7, custo_total: 361.28, retorno_kg: 4 },
    { id: 'o2', cor_id: 'c1', situacao: 'entregue', aprovada_em: '2026-11-04T10:00:00Z', quantidade_real: 10, custo_total: 170, concessao: 'x' },
    { id: 'o3', cor_id: 'c2', situacao: 'em_ajuste', criado_em: '2026-11-01T10:00:00Z', atualizado_em: '2026-11-01T10:00:00Z' }];
  const M = [{ ordem_id: 'o1', ok: false }, { ordem_id: 'o1', ok: true }, { ordem_id: 'o2', ok: true }];
  const P = [{ desvio_pct: 1, criado_em: '2026-11-03T09:00:00Z' }, { desvio_pct: -3, fora_tolerancia: true, criado_em: '2026-11-03T09:10:00Z' }, { ajuste: true, criado_em: '2026-11-03T09:20:00Z' }];
  const i = T.indicadores(O, P, M, { de: '2026-11-01T00:00:00Z', ate: '2026-11-07T23:59:59Z' });
  assert.equal(i.ordens, 2); assert.equal(i.kg, 31.7); assert.equal(i.custoKg, 16.76); assert.equal(i.primeira, 0.5);
  assert.equal(i.desvioMedio, 2); assert.equal(i.foraTol, 0.5); assert.equal(i.ajustes, 1); assert.equal(i.abertas, 1); assert.equal(i.sobraKg, 4);
  const al = T.alertas({ ordens: O, sobras: [{ validade: '2026-11-01', quantidade: 3 }, { validade: '2026-11-10', quantidade: 5 }], hoje: '2026-11-07', agora: new Date('2026-11-07T12:00:00Z').getTime() });
  assert.deepEqual(al.map(a => a.k), ['paradas', 'ajuste', 'vencidas', 'vencendo']);
});

test('balança: peso das linhas mais comuns', async () => {
  const { pesoDaLinha } = await import('../js/lib/balanca.js');
  assert.equal(pesoDaLinha('ST,GS,+  012.345kg'), 12.345);
  assert.equal(pesoDaLinha('P 12,340 kg'), 12.34);
  assert.equal(pesoDaLinha('  1250 g'), 1.25);
  assert.equal(pesoDaLinha('ERRO'), null);
});

// Qualidade: avaliação das medições, Cpk, sugestão de decisão, IQF, indicadores, Pareto, fila e alertas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../js/lib/qualidade.js';

const CAR = [
  { nome: 'Espessura', tipo: 'medida', unidade: 'µm', nominal: 50, min: 47, max: 53, critica: true },
  { nome: 'Largura', tipo: 'medida', unidade: 'mm', min: 598, max: 602 },
  { nome: 'Manchas', tipo: 'atributo' },
];

test('dentro: limites abertos e valor vazio', () => {
  assert.equal(Q.dentro({ min: 1, max: 2 }, 1.5), true);
  assert.equal(Q.dentro({ min: 1, max: 2 }, 2.1), false);
  assert.equal(Q.dentro({ min: 1 }, 99), true);
  assert.equal(Q.dentro({ max: 2 }, ''), null);
});

test('estatística: média, desvio, fora, Cp e Cpk com 5 medições', () => {
  const e = Q.estatistica(CAR[0], [49, 50, 51, 50, 50]);
  assert.equal(e.n, 5); assert.equal(e.media, 50); assert.equal(e.fora, 0);
  assert.equal(e.dp, 0.7071);
  assert.equal(e.cp, 1.41); assert.equal(e.cpk, 1.41);
  assert.equal(Q.estatistica(CAR[0], [50, 51]).cpk, null, 'menos de 5 medições: sem Cpk');
});

test('avaliar e sugerir: aprova, reprova por Re, por crítica e pede o laudo', () => {
  const insp = { ac: 1, re: 2 };
  const ok = Q.avaliar(CAR, [{ nome: 'Espessura', valores: [50, 49] }, { nome: 'Largura', valores: [600] }, { nome: 'Manchas', defeitos: 0 }]);
  assert.equal(ok.defeitos, 0); assert.equal(ok.completas, true);
  assert.equal(Q.sugestao(insp, ok).decisao, 'aprovada');
  assert.equal(Q.sugestao(insp, ok, { exigeLaudo: true }).decisao, null, 'sem laudo não sugere aprovar');
  const um = Q.avaliar(CAR, [{ nome: 'Espessura', valores: [50] }, { nome: 'Largura', valores: [603] }, { nome: 'Manchas', defeitos: 0 }]);
  assert.equal(Q.sugestao(insp, um).decisao, 'aprovada', '1 defeito ≤ Ac 1');
  const dois = Q.avaliar(CAR, [{ nome: 'Espessura', valores: [50] }, { nome: 'Largura', valores: [603] }, { nome: 'Manchas', defeitos: 1 }]);
  assert.equal(Q.sugestao(insp, dois).decisao, 'reprovada', '2 defeitos ≥ Re 2');
  const crit = Q.avaliar(CAR, [{ nome: 'Espessura', valores: [55] }, { nome: 'Largura', valores: [600] }, { nome: 'Manchas', defeitos: 0 }]);
  assert.equal(Q.sugestao({ ac: 5, re: 6 }, crit).decisao, 'reprovada', 'crítica fora reprova mesmo com aceite alto');
  const falta = Q.avaliar(CAR, [{ nome: 'Espessura', valores: [50] }]);
  assert.equal(Q.sugestao(insp, falta).decisao, null);
});

test('IQF e ranking de fornecedores', () => {
  const L = [{ etapa: 'recebimento', fornecedor_id: 'f1', situacao: 'aprovada' }, { etapa: 'recebimento', fornecedor_id: 'f1', situacao: 'aprovada_concessao' },
    { etapa: 'recebimento', fornecedor_id: 'f1', situacao: 'reprovada' }, { etapa: 'recebimento', fornecedor_id: 'f2', situacao: 'aprovada' },
    { etapa: 'recebimento', fornecedor_id: 'f2', situacao: 'pendente' }];
  assert.equal(Q.iqf(L.filter(i => i.fornecedor_id === 'f1')), 50);
  const rk = Q.rankingFornecedores(L, { f1: 'ALFA', f2: 'BETA' });
  assert.deepEqual(rk.map(x => [x.nome, x.iqf, x.lotes]), [['ALFA', 50, 3], ['BETA', 100, 1]]);
});

test('indicadores, fila, Pareto e alertas', () => {
  const agora = new Date('2026-11-07T12:00:00Z').getTime();
  const I = [
    { id: 1, situacao: 'aprovada', criado_em: '2026-11-01T08:00:00Z', decidida_em: '2026-11-01T12:00:00Z', plano_id: 'p', resultados: [{ nome: 'Espessura', valores: [50] }] },
    { id: 2, situacao: 'reprovada', criado_em: '2026-11-02T08:00:00Z', decidida_em: '2026-11-02T10:00:00Z', plano_id: 'p', resultados: [{ nome: 'Espessura', valores: [60] }, { nome: 'Manchas', defeitos: 2 }] },
    { id: 3, situacao: 'pendente', criado_em: '2026-11-06T08:00:00Z', prazo: '2026-11-07T08:00:00Z', origem: 'nfe' },
    { id: 4, situacao: 'pendente', criado_em: '2026-11-07T10:00:00Z', prazo: '2026-11-07T14:00:00Z', origem: 'liberacao' },
  ];
  const R = [{ situacao: 'acao', prazo: '2026-11-01', aberta_em: '2026-11-02T10:00:00Z', custo: 300, disposicao: 'pendente', quantidade: 20 }];
  const ind = Q.indicadores(I, R, { de: '2026-11-01T00:00:00Z', ate: '2026-11-07T23:59:59Z', agora });
  assert.equal(ind.decididas, 2); assert.equal(ind.aprovacao, 0.5); assert.equal(ind.tempoMedio, 3);
  assert.equal(ind.pendentes, 2); assert.equal(ind.atrasadas, 1); assert.equal(ind.rncVencidas, 1); assert.equal(ind.custo, 300);
  assert.deepEqual(Q.fila(I, agora).map(i => i.id), [3, 4], 'atrasada primeiro, depois a liberação');
  const p = Q.pareto(I, { p: { caracteristicas: CAR } });
  assert.deepEqual(p.map(x => x.nome), ['Manchas', 'Espessura'], 'empate em ocorrências: mais defeitos primeiro');
  const al = Q.alertas({ inspecoes: I, rncs: R, quarentena: 12500, agora });
  assert.deepEqual(al.map(a => a.k), ['liberacao', 'atrasadas', 'quarentena', 'rnc', 'disposicao']);
});

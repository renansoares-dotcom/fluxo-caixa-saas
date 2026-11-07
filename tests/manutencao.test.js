// Manutenção industrial: horas, custo da OS, MTBF/MTTR/disponibilidade, situação do plano, atraso, Pareto e fila. Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/lib/manutencao.js';

const AGORA = new Date('2026-11-07T12:00:00Z').getTime();
const de = '2026-10-01T00:00:00Z', ate = '2026-10-31T00:00:00Z';   // 30 dias = 720 h

test('horas no período', () => {
  assert.equal(M.horasEntre('2026-10-01T08:00:00Z', '2026-10-01T12:30:00Z'), 4.5);
  assert.equal(M.horasDentro('2026-09-30T20:00:00Z', '2026-10-01T04:00:00Z', de, ate), 4, 'só o que cai dentro');
  assert.equal(M.horasDentro('2026-10-30T22:00:00Z', null, de, ate, AGORA), 2, 'parada aberta até o fim do período');
});

test('custo da OS', () => {
  const os = { id: 'o1', valor_terceiros: 300 };
  const c = M.custoOS(os, [{ ordem_id: 'o1', horas: 2 }, { ordem_id: 'o1', horas: 1.5, custo_hora: 80 }], [{ ordem_id: 'o1', custo: 75 }, { ordem_id: 'o1', custo: 40, situacao: 'estornada' }], 50);
  assert.deepEqual(c, { pecas: 75, mao: 220, terceiros: 300, total: 595, horas: 3.5 });
});

test('MTBF, MTTR, disponibilidade e aderência', () => {
  const O = [
    { tipo: 'corretiva', situacao: 'concluida', maquina_parou: true, solicitada_em: '2026-10-05T10:00:00Z', parada_inicio: '2026-10-05T10:00:00Z', parada_fim: '2026-10-05T14:00:00Z', fim: '2026-10-05T14:00:00Z' },
    { tipo: 'corretiva', situacao: 'concluida', maquina_parou: true, solicitada_em: '2026-10-20T08:00:00Z', parada_inicio: '2026-10-20T08:00:00Z', parada_fim: '2026-10-20T10:00:00Z', fim: '2026-10-20T10:00:00Z' },
    { tipo: 'preventiva', situacao: 'concluida', maquina_parou: true, solicitada_em: '2026-10-10T00:00:00Z', parada_inicio: '2026-10-12T06:00:00Z', parada_fim: '2026-10-12T08:00:00Z', fim: '2026-10-12T08:00:00Z', vence_em: '2026-10-12' },
    { tipo: 'lubrificacao', situacao: 'programada', solicitada_em: '2026-10-01T00:00:00Z', vence_em: '2026-10-15' },
    { tipo: 'corretiva', situacao: 'cancelada', maquina_parou: true, solicitada_em: '2026-10-21T00:00:00Z', parada_inicio: '2026-10-21T00:00:00Z', parada_fim: '2026-10-22T00:00:00Z' },
  ];
  const k = M.indicadores(O, { de, ate, agora: AGORA });
  assert.equal(k.falhas, 2); assert.equal(k.horasParadas, 8); assert.equal(k.mttr, 3); assert.equal(k.mtbf, 356);
  assert.ok(Math.abs(k.disponibilidade - (1 - 8 / 720)) < 1e-9);
  assert.equal(k.concluidas, 3); assert.equal(Math.round(k.pctPreventiva * 100), 33);
  assert.equal(k.aderencia, 0.5, 'uma de duas preventivas no prazo');
  assert.equal(M.indicadores([], { de, ate }).mtbf, null, 'sem falha não há MTBF');
});

test('situação do plano por dias e por horas', () => {
  const hoje = '2026-11-07';
  assert.equal(M.statusPlano({ a_cada_dias: 30, ultima_data: '2026-09-01' }, 0, hoje).nivel, 'neg');
  assert.equal(M.statusPlano({ a_cada_dias: 30, ultima_data: '2026-10-10' }, 0, hoje).nivel, 'warn', 'vence em 2 dias');
  assert.equal(M.statusPlano({ a_cada_dias: 30, ultima_data: '2026-11-01' }, 0, hoje).prox, '2026-12-01');
  assert.equal(M.statusPlano({ a_cada_dias: 30 }, 0, hoje).txt, 'nunca executado');
  const h = M.statusPlano({ a_cada_horas: 500, ultima_horas: 1000 }, 1460, hoje);
  assert.equal(h.horasRest, 40); assert.equal(h.nivel, 'warn');
  assert.equal(M.statusPlano({ a_cada_horas: 500, ultima_horas: 1000 }, 1520, hoje).nivel, 'neg');
});

test('atraso, fila e Pareto', () => {
  assert.equal(M.atrasada({ situacao: 'programada', vence_em: '2026-11-01' }, AGORA), true);
  assert.equal(M.atrasada({ situacao: 'aberta', prioridade: 'emergencia', solicitada_em: '2026-11-06T06:00:00Z' }, AGORA), true);
  assert.equal(M.atrasada({ situacao: 'aberta', prioridade: 'media', solicitada_em: '2026-10-01T06:00:00Z' }, AGORA), false, 'média sem prazo');
  assert.equal(M.atrasada({ situacao: 'concluida', vence_em: '2026-11-01' }, AGORA), false);
  const f = M.fila([{ id: 'b', situacao: 'aberta', prioridade: 'baixa', solicitada_em: '2026-11-01' }, { id: 'e', situacao: 'aberta', prioridade: 'emergencia', solicitada_em: '2026-11-07' },
    { id: 'x', situacao: 'concluida', prioridade: 'emergencia', solicitada_em: '2026-11-01' }], AGORA);
  assert.deepEqual(f.map(o => o.id), ['e', 'b']);
  const p = M.pareto([{ tipo: 'corretiva', situacao: 'concluida', falha_id: 'r', maquina_parou: true, parada_inicio: '2026-10-01T00:00:00Z', parada_fim: '2026-10-01T06:00:00Z' },
    { tipo: 'corretiva', situacao: 'concluida', falha_id: 'c', maquina_parou: true, parada_inicio: '2026-10-02T00:00:00Z', parada_fim: '2026-10-02T02:00:00Z' },
    { tipo: 'corretiva', situacao: 'concluida', falha_id: 'r', maquina_parou: false }], [{ id: 'r', nome: 'Rolamento' }, { id: 'c', nome: 'Correia' }], AGORA);
  assert.deepEqual(p.map(x => [x.nome, x.n, x.horas]), [['Rolamento', 2, 6], ['Correia', 1, 2]]);
  assert.equal(p[1].acumulado, 1);
});

test('alertas', () => {
  const a = M.alertas({ ordens: [{ situacao: 'aberta', prioridade: 'emergencia', solicitada_em: '2026-11-07T10:00:00Z' }], planos: [{ id: 'p', equipamento_id: 'e', a_cada_dias: 30, ultima_data: '2026-09-01' }], hoje: '2026-11-07', agora: AGORA });
  assert.deepEqual(a.map(x => x.k), ['emergencia', 'planos']);
});

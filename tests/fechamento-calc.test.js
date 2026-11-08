import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/lib/fechamento-calc.js';

test('prazo em dia útil (mesma regra do banco)', () => {
  assert.equal(F.prazo('2026-10', 1), '2026-11-03');   // 1º domingo, 2 Finados
  assert.equal(F.prazo('2026-10', 5), '2026-11-09');
  assert.equal(F.prazo('2026-10', 0), '2026-10-30');   // 31/10 é sábado
  assert.equal(F.prazo('2026-12', 1), '2027-01-04');
  assert.equal(F.prazo('2027-01', 1), '2027-02-01');
});

test('diaUtilHoje', () => {
  assert.equal(F.diaUtilHoje('2026-10', '2026-10-20'), 0);
  assert.equal(F.diaUtilHoje('2026-10', '2026-11-02'), 0);
  assert.equal(F.diaUtilHoje('2026-10', '2026-11-03'), 1);
  assert.equal(F.diaUtilHoje('2026-10', '2026-11-08'), 4);
});

test('situação e progresso', () => {
  const T = [
    { id: 1, titulo: 'Extratos', etapa_auto: 'ext', situacao: 'pendente', prazo: '2026-11-03', responsavel: 'u1', obrigatoria: true },
    { id: 2, titulo: 'DRE', situacao: 'pendente', prazo: '2026-11-09', papel: 'financeiro', obrigatoria: true },
    { id: 3, titulo: 'Docs', situacao: 'nao_aplica', prazo: '2026-11-09', papel: 'financeiro' },
    { id: 4, titulo: 'Borderô', etapa_auto: 'bord', situacao: 'pendente', prazo: '2026-11-04', papel: 'diretor', obrigatoria: true },
  ];
  const P = F.progresso(T, { ext: true, bord: false }, '2026-11-06', 5, '2026-10');
  assert.equal(P.total, 4); assert.equal(P.feitas, 2); assert.equal(P.atrasadas, 1); assert.equal(P.pendentes, 2);
  assert.equal(P.dHoje, 4); assert.equal(P.dataMeta, '2026-11-09'); assert.equal(P.foraDaMeta, false); assert.equal(P.ultimoPrazo, '2026-11-09');
  assert.equal(P.porResp['papel:diretor'].atras, 1);
  assert.equal(F.situacao(T[0], { ext: true }, '2026-11-06').rotulo, 'Pronta (automática)');
  assert.equal(F.situacao(T[1], {}, '2026-11-09').rotulo, 'Vence hoje');
  assert.equal(F.progresso(T, {}, '2026-11-10', 5, '2026-10').foraDaMeta, true);
});

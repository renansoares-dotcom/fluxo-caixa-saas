import { test } from 'node:test';
import assert from 'node:assert/strict';
import { porPessoa, porSetor } from '../js/lib/horas-folha.js';
const P = [{ nome: 'A', setor: 'Extrusão', salario: 2200, horas_contrato: 220, horas_extras: 10, horas_apontadas: 184, ligado: true },
  { nome: 'B', setor: 'Extrusão', salario: 2200, horas_contrato: 110, horas_extras: 0, horas_apontadas: 110, ligado: true },
  { nome: 'C', setor: 'Corte', salario: 1980, horas_contrato: 220, horas_extras: 0, horas_apontadas: 0, ligado: false }];
test('por pessoa', () => {
  const a = porPessoa(P[0]);
  assert.deepEqual([a.pagas, a.apontadas, a.ociosas, a.valorHora, a.custoOcioso], [230, 184, 46, 10, 460]);
  assert.equal(a.aproveitamento, 0.8);
});
test('por setor', () => {
  const S = porSetor(P);
  assert.deepEqual(S.linhas.map(l => l.setor), ['Corte', 'Extrusão']);
  const ex = S.linhas[1];
  assert.deepEqual([ex.pessoas, ex.pagas, ex.apontadas, ex.ociosas, ex.custoOcioso], [2, 340, 294, 46, 460]);
  assert.equal(S.linhas[0].semLigacao, 1); assert.equal(S.total.custoOcioso, 460 + 1980);
  assert.equal(Math.round(S.total.aproveitamento * 1000) / 1000, Math.round(294 / 560 * 1000) / 1000);
});

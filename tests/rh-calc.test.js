import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horasExtras, avos13, avosFerias, periodos, feriasCalc, diasAviso, rescisaoCalc, passivo, compararReal } from '../js/lib/rh-calc.js';

test('horas extras', () => {
  const h = horasExtras(2200, 10, 2);          // hora 10; 10 × 15 + 2 × 20
  assert.deepEqual([h.hora, h.v1, h.v2, h.dsr, h.total], [10, 150, 40, 0, 190]);
  assert.equal(horasExtras(2200, 10, 0, { dsr_pct: 20 }).total, 180);
});

test('avos', () => {
  assert.equal(avos13('2026-03-20', '2026-10-31'), 7);   // março tem 12 dias: não conta; abr–out = 7
  assert.equal(avos13('2025-01-01', '2026-06-14'), 5);   // junho com 14 dias não conta
  assert.equal(avos13('2025-01-01', '2026-06-15'), 6);
  assert.equal(avosFerias('2026-01-10', '2026-04-09'), 3);
  assert.equal(avosFerias('2026-01-10', '2026-04-23'), 3);
  assert.equal(avosFerias('2026-01-10', '2026-04-24'), 4);
});

test('períodos aquisitivos', () => {
  const P = periodos('2024-03-01', '2026-11-08', [{ aquisitivo_ini: '2024-03-01', dias: 30 }, { aquisitivo_ini: '2025-03-01', dias: 10 }]);
  assert.deepEqual(P.map(p => p.situacao), ['quitado', 'a_gozar', 'em_aquisicao']);
  assert.equal(P[1].saldo, 20); assert.equal(P[1].limite, '2027-02-28'); assert.equal(P[2].avos, 8);
  assert.equal(periodos('2024-03-01', '2026-03-05', [])[0].situacao, 'vencido');
});

test('férias', () => {
  const F = feriasCalc(3000, 20, 10, true, '2026-12-14');
  assert.deepEqual([F.ferias, F.terco, F.abono, F.terco_abono, F.decimo, F.total, F.pagamento, F.retorno], [2000, 666.67, 1000, 333.33, 1500, 5500, '2026-12-12', '2027-01-03']);
});

test('rescisão sem justa causa com aviso indenizado', () => {
  assert.equal(diasAviso('2021-05-10', '2026-11-10'), 45);    // 5 anos completos
  const R = rescisaoCalc({ admissao: '2021-05-10', data: '2026-11-10', salario: 3000, motivo: 'sem_justa_causa', aviso: 'indenizado', saldo_fgts: 10000, ferias_vencidas_dias: 0, aquisitivo_ini: '2026-05-10' });
  assert.equal(R.dias_aviso, 45); assert.equal(R.data_projetada, '2026-12-25');
  const v = Object.fromEntries(R.verbas.map(x => [x.codigo, x.valor]));
  assert.equal(v.saldo_salario, 1000); assert.equal(v.aviso, 4500); assert.equal(v.decimo, 3000);   // 12/12 com a projeção
  assert.equal(R.avos_ferias, 8); assert.equal(v.ferias_prop, 2000); assert.equal(v.terco_prop, 666.67);   // 7 meses + 16 dias
  assert.equal(R.multa_fgts, 4000 + Math.round((1000 + 4500 + 3000) * 0.08 * 0.4 * 100) / 100);
  assert.equal(R.pagamento, '2026-11-20');
});

test('rescisão: justa causa, pedido e acordo', () => {
  const base = { admissao: '2025-01-02', data: '2026-11-10', salario: 3000, aviso: 'indenizado', saldo_fgts: 5000, ferias_vencidas_dias: 30, aquisitivo_ini: '2026-01-02' };
  const J = rescisaoCalc({ ...base, motivo: 'justa_causa' });
  assert.deepEqual(J.verbas.map(v => v.codigo), ['saldo_salario', 'ferias_vencidas', 'terco_vencidas']); assert.equal(J.multa_fgts, 0);
  const Pd = rescisaoCalc({ ...base, motivo: 'pedido' });
  assert.equal(Pd.dias_aviso, 0); assert.ok(Pd.verbas.some(v => v.codigo === 'decimo')); assert.equal(Pd.multa_fgts, 0);
  const A = rescisaoCalc({ ...base, motivo: 'acordo' });
  assert.equal(A.dias_aviso, 16.5); assert.equal(A.multa_pct, 20);
});

test('passivo e folha real', () => {
  const Pv = passivo([{ id: 'a', nome: 'A', salario: 3000, admissao: '2024-03-01', vinculo: 'clt' }, { id: 'b', nome: 'B', salario: 1000, admissao: '2026-01-01', vinculo: 'estagio' }],
    new Map([['a', [{ aquisitivo_ini: '2024-03-01', dias: 30 }]]]), '2026-11-08');
  assert.equal(Pv.linhas.length, 1);
  const l = Pv.linhas[0];
  assert.equal(l.diasDevidos, 30); assert.equal(l.ferias, 4000); assert.equal(l.avosFerias, 8); assert.equal(l.feriasProp, 2666.67); assert.equal(l.avos13, 10); assert.equal(l.decimo, 2500);
  const C = compararReal([{ id: 'i1', colaborador_id: 'a', adiantamento: 1200, liquido: 1500 }], [{ cpf: '123.456.789-00', liquido: 2750.5 }, { matricula: '99', liquido: 10 }], { a: { nome: 'A', cpf: '12345678900' } });
  assert.equal(C.linhas[0].dif, 50.5); assert.equal(C.semCadastro.length, 1);
});

import { lerFolhaReal } from '../js/lib/rh-calc.js';
test('planilha da folha oficial', () => {
  const L = lerFolhaReal([['Resumo da folha'], ['Matrícula', 'Nome', 'Proventos', 'Descontos', 'Líquido', 'INSS', 'FGTS'], [12, 'ANA', 3000, '350,40', '2.649,60', 270, 240], ['', 'TOTAL', 3000, 350.4, 2649.6]]);
  assert.equal(L.length, 1); assert.deepEqual([L[0].matricula, L[0].descontos, L[0].liquido, L[0].fgts], ['12', 350.4, 2649.6, 240]);
  assert.throws(() => lerFolhaReal([['a', 'b']]));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apurar, paramDoMes, naLista, lerLista, pendencias, transicao } from '../js/lib/apuracao.js';

const S = (cfop, ncm, bc, icms, ipi = 0, pis = 0, cofins = 0) => ({ lado: 'saidas', terceiro: false, cfop, ncm, bc, icms, ipi, pis, cofins });
const C = (cfop, vprod, icms, ipi = 0, vfrete = 0) => ({ lado: 'entradas', terceiro: true, cfop, ncm: '39', vprod, vdesc: 0, vfrete, voutro: 0, icms, ipi, bc: vprod });
const I = [S('5101', '39232190', 10000, 1800, 500, 165, 760), S('6101', '39232190', 5000, 600, 250, 82.5, 380), S('5102', '48191000', 2000, 360, 0, 33, 152),
  { lado: 'entradas', terceiro: false, cfop: '1201', ncm: '39232190', bc: 1000, icms: 180, ipi: 50, pis: 16.5, cofins: 76 },
  C('5101', 6000, 720, 300, 200), C('5556', 1000, 180)];
const P = { vigencia_inicio: '2026-01-01', prodepe_ativo: true, prodepe_credito_pct: 75, prodepe_base: 'saldo_proporcional', prodepe_cfops: ['5101', '6101'], prodepe_ncm: ['3923'],
  feef_pct: 10, feef_base: 'beneficio', ad_diper_pct: 2, fecep_pct: 2, fecep_ncm: ['4819'], fecep_cfops: [], pis_pct: 1.65, cofins_pct: 7.6, pc_cfops_credito: ['5101', '6101'],
  pc_incluir_frete: true, pc_incluir_ipi: false, pc_excluir_icms: true };

test('listas e vigência', () => {
  assert.ok(naLista('39232190', ['3923'])); assert.ok(!naLista('48191000', ['3923'])); assert.ok(naLista('x', [])); assert.ok(!naLista('x', [], false));
  assert.deepEqual(lerLista('5101, 6101;6101 5.401'), ['5101', '6101', '5401']);
  const L = [{ vigencia_inicio: '2026-01-01', a: 1 }, { vigencia_inicio: '2026-07-01', a: 2 }];
  assert.equal(paramDoMes(L, '2026-06').a, 1); assert.equal(paramDoMes(L, '2026-07').a, 2); assert.equal(paramDoMes(L, '2025-12'), null);
});

test('ICMS com PRODEPE, FEEF, AD/DIPER e FECEP', () => {
  const R = apurar(I, P, { icms_saldo_credor_ant: 100 });
  // débitos 2760; créditos: devolução 180 + compras 900 + saldo anterior 100 = 1180; saldo 1580
  assert.equal(R.icms.debitos, 2760); assert.equal(R.icms.totalCred, 1180); assert.equal(R.icms.saldoDevedor, 1580);
  // incentivado: 1800 + 600 = 2400 de 2760 -> saldo incentivado 1580 × 2400/2760 = 1373,91; crédito 75% = 1030,43
  assert.equal(R.icms.saldoIncentivado, 1373.91); assert.equal(R.icms.creditoPresumido, 1030.43);
  assert.equal(R.icms.recolher, 549.57); assert.equal(R.icms.feef, 103.04); assert.equal(R.icms.adDiper, 20.61);
  assert.equal(R.icms.baseFecep, 2000); assert.equal(R.icms.fecep, 40);
  assert.equal(R.icms.totalGuias, r(549.57 + 103.04 + 20.61 + 40));
  const D = apurar(I, { ...P, prodepe_base: 'debito_incentivado' });
  assert.equal(D.icms.saldoIncentivado, 1680);   // min(2400, saldo 1680)
  assert.equal(apurar(I, { ...P, prodepe_ativo: false }).icms.creditoPresumido, 0);
});
const r = (v) => Math.round(v * 100) / 100;

test('IPI e PIS/COFINS com créditos pelas regras', () => {
  const R = apurar(I, P, { pc_outros_creditos: 10 });
  assert.equal(R.ipi.debitos, 750); assert.equal(R.ipi.recolher, 400);   // 750 − 50 − 300
  // débito 1572,5 − devolução 92,5; base do crédito: 6000 + 200 − 720 = 5480 (só o CFOP 5101)
  assert.equal(R.pc.baseCredito, 5480); assert.equal(R.pc.creditoPis, 90.42); assert.equal(R.pc.creditoCofins, 416.48);
  assert.equal(R.pc.recolher, r(1572.5 - 92.5 - 90.42 - 416.48 - 10));
  const sem = apurar(I, { ...P, pc_excluir_icms: false, pc_incluir_frete: false });
  assert.equal(sem.pc.baseCredito, 6000);
  assert.equal(apurar(I, null).pc.creditoPis, 0);
});

test('saldo credor e pendências', () => {
  const R = apurar([C('5101', 1000, 180)], P, {});
  assert.equal(R.icms.saldoCredor, 180); assert.equal(R.icms.recolher, 0);
  assert.ok(pendencias(apurar(I, null), null, I)[0].startsWith('Sem parâmetros'));
  assert.ok(pendencias(apurar(I, { ...P, fecep_ncm: [] }), { ...P, fecep_ncm: [] }, I).some(x => x.startsWith('FECEP')));
});

test('transição da reforma', () => {
  const base = { icms: 12000, pc: 9000, incentivo: { credPres: 6000, encargos: 700 }, debNovoBase: 100000, credNovoBase: 40000, faturamento: 120000 };
  const T = transicao(base, [{ ano: 2027, cbs: 9, ibs_uf: 0.05, ibs_mun: 0.05, icms_pct: 100, pis_cofins: false, situacao: 'proposta' },
    { ano: 2033, cbs: 9, ibs_uf: 18, ibs_mun: 0, icms_pct: 0, pis_cofins: false }]);
  assert.equal(T.hoje, 15700);
  assert.equal(T.linhas[0].icms, 6700); assert.equal(T.linhas[0].novo, 5460); assert.equal(T.linhas[0].total, 12160);
  assert.equal(T.linhas[1].icms, 0); assert.equal(T.linhas[1].beneficio, 0); assert.equal(T.linhas[1].novo, 16200);
});

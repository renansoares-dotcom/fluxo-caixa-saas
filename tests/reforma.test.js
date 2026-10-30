// Reforma tributária: tabela de alíquotas, simulador de 2027, conferência da CBS/IBS das notas e relatórios de faturamento/compras.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/lib/reforma.js';
import * as F from '../js/lib/fat-relatorio.js';

test('tabela de alíquotas: padrão do TCU para 2027 e ajuste gravado pela empresa', () => {
  const p = R.aliquotas();
  const a27 = R.doAno(p, 2027);
  assert.equal(R.total(a27), 11.3468);
  assert.equal(a27.situacao, 'proposta');
  assert.equal(R.total(R.doAno(p, 2026)), 1);
  assert.equal(R.doAno(p, 2025), null);
  assert.equal(R.doAno(p, 2040).ano, 2033);
  const g = R.aliquotas([{ ano: 2027, cbs: 11.4, ibs_uf: 0.05, ibs_mun: 0.05, situacao: 'vigente', fonte: 'Resolução do Senado' }]);
  assert.equal(R.total(R.doAno(g, 2027)), 11.5);
  assert.equal(R.doAno(g, 2027).padrao, false);
  assert.equal(g.length, p.length);
});

test('classificação pelo CFOP, vista pela empresa', () => {
  const nossa = { emissao_propria: true }, terceiro = { emissao_propria: false };
  assert.equal(F.classificar('5101', nossa), 'venda');
  assert.equal(F.classificar('6401', nossa), 'venda');
  assert.equal(F.classificar('5202', nossa), 'dev_compra');
  assert.equal(F.classificar('5901', nossa), 'outra_saida');
  assert.equal(F.classificar('1202', nossa), 'dev_venda');
  assert.equal(F.classificar('5101', terceiro), 'compra');      // venda do fornecedor
  assert.equal(F.classificar('6202', terceiro), 'dev_venda');   // devolução de compra do cliente
  assert.equal(F.classificar('5915', terceiro), 'outra_entrada');
});

const nota = (o) => ({ situacao: 'autorizada', emissao: '2026-09-10', tipo: 'saida', emissao_propria: true, finalidade: '1', v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, ...o });
test('simulador de 2027: PIS/Cofins de hoje × CBS+IBS', () => {
  const notas = [
    nota({ cfops: ['5101'], v_prod: 100000, v_nf: 100000, v_icms: 18000, v_pis: 1353, v_cofins: 6232 }),                     // venda
    nota({ cfops: ['5101'], emissao_propria: false, v_prod: 50000, v_nf: 50000, v_icms: 9000, v_pis: 0, v_cofins: 0 }),        // compra
    nota({ cfops: ['5101'], situacao: 'cancelada', v_prod: 9e6, v_nf: 9e6 }),
  ];
  const s = R.simular(notas, R.doAno(R.aliquotas(), 2027), { credAtual: 100, credNovo: 100 });
  const m = s.meses[0];
  assert.equal(m.debAtual, 7585);
  assert.equal(m.credAtual, 3792.5);                  // 41.000 × 9,25%
  assert.equal(m.base, 74415);                        // 100.000 − 18.000 − 7.585
  assert.equal(m.debNovo, 8443.72);                   // 74.415 × 11,3468%
  assert.equal(m.credNovo, 4652.19);                  // 41.000 × 11,3468%
  assert.equal(m.atual, 3792.5); assert.equal(m.novo, 3791.53);
  assert.equal(s.total.faturamento, 100000);
  // com crédito pela metade das compras hoje e integral na CBS
  const s2 = R.simular(notas, R.doAno(R.aliquotas(), 2027), { credAtual: 50, credNovo: 100 });
  assert.equal(s2.total.atual, 5688.75);
  // a base destacada na nota (2026) vale no lugar da estimada
  const s3 = R.simular([nota({ cfops: ['5101'], v_prod: 1000, v_nf: 1000, v_icms: 180, v_bc_ibscbs: 820 })], R.doAno(R.aliquotas(), 2027));
  assert.equal(s3.total.base, 820);
});

test('conferência da CBS/IBS de 2026', () => {
  const L = R.aliquotas();
  const ok = R.conferir(nota({ v_prod: 1000, v_icms: 180, v_pis: 13.53, v_cofins: 62.32, v_bc_ibscbs: 744.15, v_cbs: 6.70, v_ibs: 0.74 }), L, [{ cst_ibscbs: '000' }]);
  assert.equal(ok.nivel, 'ok'); assert.equal(ok.esperadoCbs, 6.7);
  const div = R.conferir(nota({ v_prod: 1000, v_icms: 180, v_pis: 13.53, v_cofins: 62.32, v_bc_ibscbs: 744.15, v_cbs: 9.00, v_ibs: 0.74 }), L, [{ cst_ibscbs: '000' }]);
  assert.equal(div.nivel, 'neg'); assert.match(div.motivos[0], /^CBS /);
  assert.equal(R.conferir(nota({ v_prod: 1000 }), L).nivel, 'neg');
  assert.equal(R.conferir(nota({ v_prod: 1000, emissao_propria: false }), L).nivel, 'warn');
  const red = R.conferir(nota({ v_prod: 1000, v_icms: 180, v_bc_ibscbs: 820, v_cbs: 2.95, v_ibs: 0.33 }), L, [{ cst_ibscbs: '200' }]);
  assert.equal(red.nivel, 'info');
  assert.equal(R.conferir(nota({ emissao: '2025-12-30', v_prod: 1 }), L).nivel, 'ok');
});

const item = (cfop, nt, o = {}) => ({ cfop, cprod: 'P1', xprod: 'Bobina', ucom: 'KG', qcom: 100, vprod: 1000, vdesc: 0, vfrete: 0, voutro: 0, v_ipi: 0, v_st: 0, v_icms: 180, v_pis: 16.5, v_cofins: 76, nfe_notas: nt, ...o });
test('relatório de faturamento com devolução, cancelada, ABC e ano anterior', () => {
  const n1 = { id: 'n1', emissao: '2026-09-02', situacao: 'autorizada', emissao_propria: true, tipo: 'saida', dest_nome: 'Cliente A', dest_doc: '1', dest_uf: 'PE' };
  const n2 = { id: 'n2', emissao: '2026-09-05', situacao: 'autorizada', emissao_propria: true, tipo: 'saida', dest_nome: 'Cliente B', dest_doc: '2', dest_uf: 'BA' };
  const n3 = { id: 'n3', emissao: '2026-09-20', situacao: 'autorizada', emissao_propria: false, tipo: 'saida', emit_nome: 'Cliente A', emit_doc: '1' };   // devolução emitida pelo cliente
  const n4 = { id: 'n4', emissao: '2026-09-21', situacao: 'cancelada', emissao_propria: true, tipo: 'saida', dest_nome: 'Cliente C', dest_doc: '3', dest_uf: 'PE' };
  const n5 = { id: 'n5', emissao: '2026-10-01', situacao: 'autorizada', emissao_propria: true, tipo: 'saida', dest_nome: 'Cliente C', dest_doc: '3', dest_uf: 'PE' };
  const ls = F.linhas([item('5101', n1, { vprod: 8000 }), item('6101', n2, { vprod: 1500 }), item('5202', n3, { vprod: 1000 }), item('5101', n4, { vprod: 7000 }), item('5101', n5, { vprod: 500 }), item('5901', n5, { vprod: 300 })], 'PE');
  const ant = F.linhas([item('5101', { ...n1, id: 'a1', emissao: '2025-09-03' }, { vprod: 6000 })]);
  const r = F.relatorio(ls, { tipo: 'faturamento', agrupar: 'parte', anterior: ant });
  assert.equal(r.total.bruto, 10000); assert.equal(r.total.dev, 1000); assert.equal(r.total.liquido, 9000);
  assert.equal(r.total.canceladas, 1); assert.equal(r.total.vCanceladas, 7000); assert.equal(r.total.vOutras, 300);
  assert.equal(r.total.notas, 3); assert.equal(r.total.ticket, 3333.33);
  const a = r.rows.find(x => x.chave.startsWith('Cliente A'));
  assert.equal(a.liquido, 7000); assert.equal(a.classe, 'A'); assert.equal(a.anterior, 6000); assert.equal(Math.round(a.variacao * 1000), 167);
  assert.deepEqual(r.rows.map(x => x.classe), ['A', 'A', 'B']);   // 77,8% antes do segundo: ainda A
  const m = F.relatorio(ls, { tipo: 'faturamento', agrupar: 'mes', anterior: ant });
  assert.deepEqual(m.rows.map(x => [x.chave, x.liquido, x.anterior]), [['2026-09', 8500, 6000], ['2026-10', 500, 0]]);
  const uf = F.relatorio(ls, { agrupar: 'uf' });
  assert.equal(uf.rows.find(x => x.chave === 'PE').liquido, 7500);
  const c = F.relatorio(ls, { tipo: 'compras', agrupar: 'parte' });
  assert.equal(c.total.liquido, 0);
  assert.equal(F.anoAnterior('2024-02-29'), '2023-02-28');
});

// Análise de Competitividade de Preço (COM009): caso de aceite do Renan (26/11/2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisar, custoCliente, aliqInterSugerida, aliqInterna, antecipacaoPct, perfilPadrao, simularReforma, margemNossa, precoMargemMinima, piso2, r2 } from '../js/lib/competitividade.js';

const cli = { uf: 'PE', tipo: 'industria', regime: 'real', cred_icms: true, cred_pc: false };
const conc = { preco: 17, uf_origem: 'SE', aliq: 12, interna_dest: 20.5, frete_tipo: 'CIF' };
const nos = { preco: 20, uf_origem: 'PE', aliq: 20.5, interna_dest: 20.5, frete_tipo: 'CIF' };
const P = { pc_pct: 9.25, pc_excluir_icms: true, taxa_mensal: 0 };

test('caso real: indústria de PE com crédito de ICMS — Sergipe 17,00 × IPLAMM 20,00', () => {
  const R = analisar({ cli, conc, nos, P });
  assert.equal(r2(R.conc.custo), 14.96);
  assert.equal(r2(R.nos.custo), 15.90);
  assert.equal(r2(R.dif), 0.94);
  assert.equal(Math.round(R.difPct * 10) / 10, 6.3);
  assert.equal(R.empate, 18.81);                       // 14,96 ÷ 0,795 = 18,8176 → para baixo
  assert.ok(custoCliente({ ...nos, preco: 18.82 }, cli, P).custo > 14.96, 'a 18,82 já perde (14,9619)');
  assert.equal(R.ganha, false);
});

test('controle: cliente sem crédito (uso e consumo) — DIFAL base dupla', () => {
  const c = { ...cli, cred_icms: false };
  const R = analisar({ cli: c, conc, nos, P });
  assert.equal(r2(R.conc.baseDifal), 18.82);
  assert.equal(r2(R.conc.difal), 1.82);
  assert.equal(r2(R.conc.custo), 18.82);
  assert.equal(r2(R.nos.custo), 20.00);
  assert.equal(R.nos.difal, 0, 'venda interna não tem DIFAL');
  assert.equal(R.empate, 18.81);
});

test('crédito de PIS/COFINS sem o ICMS na base não muda o empate', () => {
  const R = analisar({ cli: { ...cli, cred_pc: true }, conc, nos, P });
  assert.equal(r2(R.conc.credPc), r2((17 - 2.04) * 0.0925));
  assert.equal(R.empate, 18.81);
});

test('comércio com crédito: antecipação parcial é só caixa; sem crédito vira custo', () => {
  const c = { ...cli, tipo: 'comercio' };
  const R = analisar({ cli: c, conc: { ...conc, antecip_pct: 8.34 }, nos, P });
  assert.equal(r2(R.conc.antecip), r2(17 * 0.0834));
  assert.equal(R.conc.antecipCusto, 0);
  assert.equal(r2(R.conc.custo), 14.96);
  const S = analisar({ cli: { ...c, regime: 'simples', cred_icms: false }, conc: { ...conc, antecip_pct: 8.34 }, nos, P });
  assert.equal(r2(S.conc.custo), r2(17 + 17 * 0.0834));
  assert.equal(S.conc.difal, 0, 'comércio não paga DIFAL, paga a antecipação');
});

test('não contribuinte: sem crédito, DIFAL do fornecedor com aviso', () => {
  const R = analisar({ cli: { ...cli, tipo: 'nao_contrib', cred_icms: false }, conc, nos, P });
  assert.equal(R.conc.custo, 17);
  assert.equal(R.conc.difal, 0);
  assert.ok(R.conc.avisos[0].includes('fornecedor'));
});

test('frete FOB soma ao custo e valor presente é opcional', () => {
  const a = custoCliente({ ...conc, frete_tipo: 'FOB', frete_un: 0.5 }, cli, P);
  assert.equal(r2(a.custo), 15.46);
  const b = custoCliente({ ...conc, prazo_dias: 30 }, cli, { ...P, taxa_mensal: 2 });
  assert.equal(r2(b.custoVp), r2(14.96 / 1.02));
});

test('alíquota interestadual sugerida e regras por vigência', () => {
  assert.equal(aliqInterSugerida('SE', 'PE', false), 12);
  assert.equal(aliqInterSugerida('SP', 'PE', false), 7);
  assert.equal(aliqInterSugerida('SP', 'ES', false), 7);
  assert.equal(aliqInterSugerida('SP', 'RJ', false), 12);
  assert.equal(aliqInterSugerida('SP', 'PE', true), 4);
  assert.equal(aliqInterSugerida('PE', 'PE', false), null);
  const L = [{ uf: 'PE', ncm_prefixo: '', aliquota: 18, vigencia_inicio: '2016-01-01' }, { uf: 'PE', ncm_prefixo: '', aliquota: 20.5, vigencia_inicio: '2024-01-01' },
    { uf: 'PE', ncm_prefixo: '3923', aliquota: 12, vigencia_inicio: '2025-01-01', empresa_id: 'e' }];
  assert.equal(aliqInterna(L, 'PE', '39021020', '2026-11-26').aliquota, 20.5);
  assert.equal(aliqInterna(L, 'PE', '39021020', '2023-06-01').aliquota, 18);
  assert.equal(aliqInterna(L, 'PE', '39232190', '2026-11-26').aliquota, 12);
  const A = [{ uf_destino: 'PE', aliq_inter: 12, aliq_interna: 20.5, pct: 8.34, tipos_cliente: ['comercio'], vigencia_inicio: '2024-01-01' },
    { uf_destino: 'PE', aliq_inter: 7, aliq_interna: 20.5, pct: 15.27, tipos_cliente: ['comercio'], vigencia_inicio: '2024-01-01' }];
  assert.equal(antecipacaoPct(A, 'PE', 12, 20.5, 'comercio', '2026-11-26').pct, 8.34);
  assert.equal(antecipacaoPct(A, 'PE', 7, 20.5, 'comercio', '2026-11-26').pct, 15.27);
  assert.equal(antecipacaoPct(A, 'PE', 12, 20.5, 'industria', '2026-11-26'), null);
  assert.deepEqual(perfilPadrao('industria', 'real'), { cred_icms: true, cred_pc: true });
  assert.deepEqual(perfilPadrao('comercio', 'simples'), { cred_icms: false, cred_pc: false });
});

test('nossa margem com PRODEPE e faixa sugerida', () => {
  const m = { aliq: 20.5, ncm: '39232190', cfop: '5101', custo_un: 10, prodepe: { ativo: true, pct: 75, base: 'debito_incentivado', ncm: [], cfops: [] },
    feef: { pct: 10, base: 'beneficio' }, pc: { pct: 9.25 } };
  const g = margemNossa(20, m);
  // ICMS 4,10; PRODEPE 3,075; FEEF 0,3075 → ICMS líquido 1,3325; PIS/COFINS (20−4,10)×9,25% = 1,47075
  assert.equal(r2(g.margem), r2(20 - 1.3325 - 1.47075 - 10));
  const piso = precoMargemMinima(m, 10);
  assert.ok(margemNossa(piso, m).pct >= 10 - 1e-9 && margemNossa(piso - 0.01, m).pct < 10);
  const R = analisar({ cli, conc, nos, P, m, margem_min_pct: 10 });
  assert.equal(R.faixa.ate, 18.81);
  assert.equal(R.faixa.viavel, piso <= 18.81);
  assert.equal(piso2(18.8176), 18.81);
});

test('reforma: diferença de ICMS cai com a transição e some em 2033', () => {
  const anos = [{ ano: 2027, cbs: 8.8, ibs_uf: 0.1, ibs_mun: 0, pis_cofins: false, icms_pct: 100 },
    { ano: 2029, cbs: 8.8, ibs_uf: 1.8, ibs_mun: 0, pis_cofins: false, icms_pct: 90 },
    { ano: 2033, cbs: 8.8, ibs_uf: 17.7, ibs_mun: 0, pis_cofins: false, icms_pct: 0 }];
  const S = simularReforma({ cli, conc, nos, P }, anos);
  assert.equal(S.length, 3);
  assert.equal(r2(S[0].conc), 14.96);                  // crédito integral de CBS/IBS: neutro
  assert.ok(S[1].empate < S[0].empate && S[1].empate > 17, 'o espaço do crédito maior diminui com a queda do ICMS');
  assert.equal(r2(S[2].conc), 17);
  assert.equal(S[2].empate, 17);
});

test('relatório: versão para o cliente não leva margem, empate nem o nome do concorrente', async () => {
  const { relatorioAnalise, relatorioHistorico } = await import('../js/lib/competitividade-relatorio.js');
  const R = analisar({ cli, conc, nos, P, m: { aliq: 20.5, custo_un: 10, pc: { pct: 9.25 } }, margem_min_pct: 10 });
  const a = { numero: 7, data: '2026-11-26', cliente_nome: 'Indústria Exemplo', cliente: cli, produto_desc: 'SACO', ncm: '39232190', status: 'negociacao',
    concorrente: { ...conc, uf: 'SE', nome: 'CONCORRENTE X' }, proposta: { ...nos, uf: 'PE' }, resultado: { ...R, conc: R.conc, nos: R.nos }, parametros: { pc_pct: 9.25 } };
  const mg = { proposta: R.margem.proposta, empate: R.margem.empate, faixa: R.faixa, margem_min_pct: 10 };
  const o = { esc: (s) => String(s ?? ''), money: (v) => (+v).toFixed(2).replace('.', ','), dateBR: (s) => s };
  const cliTxt = relatorioAnalise(a, null, { ...o, interna: false }), intTxt = relatorioAnalise(a, mg, { ...o, interna: true });
  assert.ok(cliTxt.includes('14,96') && cliTxt.includes('15,90'));
  assert.ok(!cliTxt.includes('CONCORRENTE X') && !cliTxt.includes('empate') && !/margem/i.test(cliTxt.replace(/margem de/g, '')));
  assert.ok(intTxt.includes('CONCORRENTE X') && intTxt.includes('18,81') && intTxt.includes('Nossa margem'));
  assert.ok(relatorioHistorico([{ ...a, id: 'x', status: 'perdida', status_obs: 'preço' }], { x: mg }, { ...o, interna: true }).includes('preço'));
});

test('venda por unidade ou por peso: conversão para a mesma base', async () => {
  const { converter, baseDoProduto } = await import('../js/lib/competitividade.js');
  assert.equal(converter(0.85, 'UN', 'KG', 0.05), 17);           // R$ 0,85 o saco de 50 g = R$ 17,00/kg
  assert.equal(r2(converter(20, 'KG', 'UN', 0.05)), 1);          // R$ 20,00/kg = R$ 1,00 o saco
  assert.equal(converter(17, 'KG', 'KG', null), 17);
  assert.equal(converter(17, 'UN', 'KG', 0), null, 'sem o peso não converte');
  assert.equal(baseDoProduto('kg'), 'KG');
  assert.equal(baseDoProduto('MIL'), 'UN');
  // o caso real dá o mesmo resultado com o concorrente cotando por unidade
  const R = analisar({ cli, conc: { ...conc, preco: converter(0.85, 'UN', 'KG', 0.05) }, nos, P });
  assert.equal(r2(R.conc.custo), 14.96);
  assert.equal(R.empate, 18.81);
});

// Reforma tributária (CBS/IBS): alíquotas por ano de vigência, simulador de 2027 e conferência das notas.
// Tabela padrão atualizada em 30/10/2026: TCU propôs a alíquota de referência da CBS de 2027 em 11,3468% (processo TC 006.529/2026-7),
// a confirmar por resolução do Senado até dezembro; em 2027 o IBS é de teste (0,05% estadual + 0,05% municipal) e a CBS é reduzida em 0,1 p.p.
// As linhas da tabela trib_aliquotas (SQL 072) substituem o padrão ano a ano.
import { classificar } from './fat-relatorio.js';

const TCU = 'TCU, processo TC 006.529/2026-7 (alíquota de referência de 11,3468%), a confirmar por resolução do Senado';
const EST = 'Estimativa (IBS de referência projetado em cerca de 18,7%, estadual e municipal somados); muda a cada ano';
export const ALIQ_PADRAO = [
  { ano: 2026, cbs: 0.9, ibs_uf: 0.1, ibs_mun: 0, pis_cofins: true, icms_pct: 100, situacao: 'vigente', fonte: 'LC 214/2025: ano-teste, destacado na nota e compensável com PIS/Cofins' },
  { ano: 2027, cbs: 11.2468, ibs_uf: 0.05, ibs_mun: 0.05, pis_cofins: false, icms_pct: 100, situacao: 'proposta', fonte: TCU },
  { ano: 2028, cbs: 11.2468, ibs_uf: 0.05, ibs_mun: 0.05, pis_cofins: false, icms_pct: 100, situacao: 'estimada', fonte: 'Estimativa: mesma regra de 2027' },
  { ano: 2029, cbs: 11.25, ibs_uf: 1.87, ibs_mun: 0, pis_cofins: false, icms_pct: 90, situacao: 'estimada', fonte: EST + ' · IBS a 10% e ICMS a 90%' },
  { ano: 2030, cbs: 11.25, ibs_uf: 3.74, ibs_mun: 0, pis_cofins: false, icms_pct: 80, situacao: 'estimada', fonte: EST + ' · IBS a 20% e ICMS a 80%' },
  { ano: 2031, cbs: 11.25, ibs_uf: 5.61, ibs_mun: 0, pis_cofins: false, icms_pct: 70, situacao: 'estimada', fonte: EST + ' · IBS a 30% e ICMS a 70%' },
  { ano: 2032, cbs: 11.25, ibs_uf: 7.48, ibs_mun: 0, pis_cofins: false, icms_pct: 60, situacao: 'estimada', fonte: EST + ' · IBS a 40% e ICMS a 60%' },
  { ano: 2033, cbs: 11.25, ibs_uf: 18.7, ibs_mun: 0, pis_cofins: false, icms_pct: 0, situacao: 'estimada', fonte: EST + ' · fim do ICMS' },
];
export const SITUACAO = { vigente: 'Vigente', proposta: 'Proposta (a confirmar)', estimada: 'Estimativa' };
export const PIS_COFINS = 9.25;   // não cumulativo (Lucro Real): 1,65% + 7,6%

const n = (v) => +v || 0;
const r2 = (v) => Math.round(v * 100) / 100;
export const ibs = (a) => r2((n(a.ibs_uf) + n(a.ibs_mun)) * 10000) / 10000;
export const total = (a) => Math.round((n(a.cbs) + n(a.ibs_uf) + n(a.ibs_mun)) * 10000) / 10000;

/** tabela da empresa: padrão + linhas gravadas (as gravadas valem no lugar do padrão do mesmo ano) */
export function aliquotas(gravadas = []) {
  const por = new Map(ALIQ_PADRAO.map(a => [a.ano, { ...a, padrao: true }]));
  for (const g of gravadas) por.set(+g.ano, { ...por.get(+g.ano), ...g, ano: +g.ano, cbs: n(g.cbs), ibs_uf: n(g.ibs_uf), ibs_mun: n(g.ibs_mun), icms_pct: g.icms_pct == null ? 100 : +g.icms_pct, padrao: false });
  return [...por.values()].sort((a, b) => a.ano - b.ano);
}
/** alíquotas do ano (antes de 2026: nada; depois do último ano da tabela: o último) */
export function doAno(lista, ano) {
  const xs = lista.filter(a => a.ano <= ano);
  return xs.length ? xs[xs.length - 1] : null;
}

/** base da CBS/IBS estimada pela nota: valor da operação sem ICMS, PIS e Cofins (o IPI fica fora por já ser cobrado por fora) */
export const baseEstimada = (x) => Math.max(0, r2(n(x.v_prod) - n(x.v_desc) + n(x.v_frete) + n(x.v_seg) + n(x.v_outro) - n(x.v_icms) - n(x.v_pis) - n(x.v_cofins)));
/** base do crédito de PIS/Cofins hoje: valor sem o ICMS (Lei 14.592/2023) */
export const baseCreditoAtual = (x) => Math.max(0, r2(n(x.v_prod) - n(x.v_desc) + n(x.v_frete) + n(x.v_seg) + n(x.v_outro) - n(x.v_icms)));

/** classe da nota pelo CFOP principal (o primeiro), vista pela empresa */
export function classeNota(nt) {
  if (nt.situacao && nt.situacao !== 'autorizada') return 'cancelada';
  const c = (nt.cfops || [])[0];
  if (!c) return nt.emissao_propria && nt.tipo === 'saida' ? 'venda' : 'outra_entrada';
  return classificar(c, nt);
}

/**
 * Simulador: o que as notas do período pagariam de PIS/Cofins (como hoje) e de CBS+IBS (com as alíquotas do ano simulado).
 * o = { credAtual: % das compras com crédito de PIS/Cofins hoje, credNovo: % das compras com crédito de CBS/IBS }
 * devolve { meses: [...], total, aliq }
 */
export function simular(notas, aliq, o = {}) {
  const credAtual = (o.credAtual ?? 100) / 100, credNovo = (o.credNovo ?? 100) / 100, t = total(aliq) / 100, pc = PIS_COFINS / 100;
  const por = new Map();
  const vazio = (mes) => ({ mes, faturamento: 0, notasVenda: 0, debAtual: 0, devAtual: 0, credAtual: 0, base: 0, baseNota: 0, debNovo: 0, devNovo: 0, credNovo: 0, compras: 0, ipi: 0 });
  for (const nt of notas) {
    const k = classeNota(nt); if (!['venda', 'dev_venda', 'compra'].includes(k)) continue;
    const mes = nt.emissao.slice(0, 7), m = por.get(mes) || por.set(mes, vazio(mes)).get(mes);
    const destacado = n(nt.v_pis) + n(nt.v_cofins);
    const b = n(nt.v_bc_ibscbs) > 0 ? n(nt.v_bc_ibscbs) : baseEstimada(nt);
    if (n(nt.v_bc_ibscbs) > 0) m.baseNota += b;
    if (k === 'venda') { m.faturamento += n(nt.v_nf); m.notasVenda++; m.debAtual += destacado; m.base += b; m.debNovo += b * t; m.ipi += n(nt.v_ipi); }
    else if (k === 'dev_venda') { m.devAtual += destacado || baseCreditoAtual(nt) * pc; m.devNovo += b * t; }
    else { m.compras += n(nt.v_nf); m.credAtual += baseCreditoAtual(nt) * pc * credAtual; m.credNovo += b * t * credNovo; }
  }
  const fecha = (m) => {
    for (const f of Object.keys(m)) if (typeof m[f] === 'number' && f !== 'notasVenda') m[f] = r2(m[f]);
    m.atual = r2(m.debAtual - m.devAtual - m.credAtual); m.novo = r2(m.debNovo - m.devNovo - m.credNovo); m.dif = r2(m.novo - m.atual);
    m.pctAtual = m.faturamento ? m.atual / m.faturamento : null; m.pctNovo = m.faturamento ? m.novo / m.faturamento : null;
    return m;
  };
  const meses = [...por.values()].sort((a, b) => a.mes.localeCompare(b.mes)).map(fecha);
  const T = vazio('total'); for (const m of meses) for (const f of Object.keys(T)) if (typeof T[f] === 'number') T[f] += m[f];
  return { meses, total: fecha(T), aliq };
}

/**
 * Conferência da CBS/IBS destacados na nota contra as alíquotas do ano da emissão.
 * nt: cabeçalho da nota (v_bc_ibscbs, v_cbs, v_ibs, valores) + itens [{ cst_ibscbs, cclass_trib }]
 * devolve { nivel: 'ok'|'neg'|'warn'|'info', motivos: [..], esperadoCbs, esperadoIbs, base }
 */
export function conferir(nt, lista, itens = []) {
  const a = doAno(lista, +nt.emissao.slice(0, 4));
  if (!a) return { nivel: 'ok', motivos: ['antes da reforma'], base: null };
  const base = n(nt.v_bc_ibscbs), est = baseEstimada(nt), tol = (v) => Math.max(0.05, v * 0.005);
  const csts = [...new Set(itens.map(i => i.cst_ibscbs).filter(Boolean))];
  const reducao = csts.filter(c => c !== '000');
  const out = { base, baseEstimada: est, esperadoCbs: r2(base * a.cbs / 100), esperadoIbs: r2(base * ibs(a) / 100), csts, motivos: [], nivel: 'ok', aliq: a };
  const add = (nv, txt) => { out.motivos.push(txt); const ord = { ok: 0, info: 1, warn: 2, neg: 3 }; if (ord[nv] > ord[out.nivel]) out.nivel = nv; };
  if (!base && !n(nt.v_cbs) && !n(nt.v_ibs)) { add(nt.emissao_propria ? 'neg' : 'warn', 'sem o grupo IBS/CBS na nota'); return out; }
  if (reducao.length) add('info', `CST ${reducao.join(', ')} (redução, isenção, suspensão ou diferimento): conferir o cClassTrib`);
  if (!reducao.length) {
    if (Math.abs(n(nt.v_cbs) - out.esperadoCbs) > tol(out.esperadoCbs)) add('neg', `CBS ${fmt(nt.v_cbs)}; esperado ${fmt(out.esperadoCbs)} (${pctBR(a.cbs)} da base)`);
    if (Math.abs(n(nt.v_ibs) - out.esperadoIbs) > tol(out.esperadoIbs)) add('neg', `IBS ${fmt(nt.v_ibs)}; esperado ${fmt(out.esperadoIbs)} (${pctBR(ibs(a))} da base)`);
  }
  if (base && est && Math.abs(base - est) > Math.max(1, est * 0.01)) add('info', `base ${fmt(base)} difere da estimada pela nota (${fmt(est)}: produtos − descontos + frete, seguro e outras − ICMS, PIS e Cofins)`);
  if (!out.motivos.length) out.motivos.push('confere');
  return out;
}
const fmt = (v) => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pctBR = (v, d = 4) => (+(+v).toFixed(d)).toLocaleString('pt-BR', { maximumFractionDigits: d }) + '%';

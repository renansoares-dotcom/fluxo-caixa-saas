// Comercial › Análise de Competitividade de Preço (COM009) — SQL 197, 26/11/2026 (Renan: comparar a nossa proposta com o preço
// que o cliente já paga a outro fornecedor, pelo custo líquido para o cliente depois dos créditos e dos impostos de cada caminho).
// Cálculo puro, sem acesso ao banco: as alíquotas e os percentuais chegam dos parâmetros por vigência (nada fixo aqui).
//  - crédito de ICMS conforme o perfil do cliente; DIFAL com base dupla para o contribuinte sem crédito (uso e consumo);
//  - antecipação parcial para o comércio (efeito só no caixa quando o cliente aproveita o crédito);
//  - crédito de PIS/COFINS sem o ICMS na base (Lei 14.592/2023), quando o cliente é do não cumulativo;
//  - preço de empate arredondado PARA BAIXO (o maior preço que ainda não perde), faixa sugerida da margem mínima ao empate;
//  - nossa margem (visão interna) com PRODEPE/FEEF e PIS/COFINS; simulação da reforma (2027–2033) com CBS/IBS por ano.
import { naLista } from './apuracao.js';

const n = (v) => +v || 0;
export const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
export const piso2 = (v) => Math.floor(n(v) * 100 + 1e-7) / 100;   // 18,8176 → 18,81
export const teto2 = (v) => Math.ceil(n(v) * 100 - 1e-7) / 100;

export const TIPOS_CLIENTE = [['industria', 'Indústria (insumo da produção)'], ['comercio', 'Comércio (revenda)'],
  ['consumidor_contrib', 'Consumidor final contribuinte (uso e consumo)'], ['nao_contrib', 'Não contribuinte']];
export const REGIMES_CLIENTE = [['real', 'Lucro Real'], ['presumido', 'Lucro Presumido'], ['simples', 'Simples Nacional']];
export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
export const REGRA_INTER_PADRAO = { ufs_sul_sudeste: ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'], aliq_ss_para_nne: 7, aliq_geral: 12, aliq_importado: 4 };

/** perfil padrão do cliente: o que normalmente acontece (a tela deixa mudar) */
export function perfilPadrao(tipo, regime) {
  const contrib = tipo !== 'nao_contrib';
  return {
    cred_icms: contrib && regime !== 'simples' && (tipo === 'industria' || tipo === 'comercio'),
    cred_pc: contrib && regime === 'real',
  };
}

const vigente = (L, data) => (L || []).filter(x => !x.vigencia_inicio || x.vigencia_inicio <= data);
/** a empresa sobrepõe o padrão da plataforma; o NCM mais específico vence; depois a vigência mais recente */
function escolher(L, data) {
  return vigente(L, data).sort((a, b) => (String(b.ncm_prefixo || '').length - String(a.ncm_prefixo || '').length)
    || ((b.empresa_id ? 1 : 0) - (a.empresa_id ? 1 : 0)) || String(b.vigencia_inicio).localeCompare(String(a.vigencia_inicio)))[0] || null;
}

/** alíquota interna da UF para o NCM na data: { aliquota, fecp, fonte } ou null */
export function aliqInterna(lista, uf, ncm, data) {
  const so = String(ncm || '').replace(/\D/g, '');
  const L = (lista || []).filter(x => x.uf === uf && x.ativo !== false && (!x.ncm_prefixo || so.startsWith(String(x.ncm_prefixo).replace(/\D/g, ''))));
  return escolher(L, data);
}

/** regra interestadual vigente (empresa sobrepõe a plataforma) */
export function regraInter(lista, data) {
  return escolher((lista || []).map(x => ({ ...x, ncm_prefixo: '' })), data) || REGRA_INTER_PADRAO;
}

/** alíquota interestadual sugerida: 4% importado; 7% do Sul/Sudeste (exceto ES) para N/NE/CO/ES; 12% nos demais */
export function aliqInterSugerida(origem, destino, importado, regra = REGRA_INTER_PADRAO) {
  if (!origem || !destino || origem === destino) return null;
  if (importado) return n(regra.aliq_importado);
  const ss = regra.ufs_sul_sudeste || REGRA_INTER_PADRAO.ufs_sul_sudeste;
  return ss.includes(origem) && !ss.includes(destino) ? n(regra.aliq_ss_para_nne) : n(regra.aliq_geral);
}

/** percentual da antecipação parcial do destino para a alíquota interestadual da operação e a interna vigente */
export function antecipacaoPct(lista, destino, aliqOp, aliqInt, tipo, data) {
  const L = (lista || []).filter(x => x.uf_destino === destino && x.ativo !== false && Math.abs(n(x.aliq_inter) - n(aliqOp)) < 1e-6
    && (x.aliq_interna == null || Math.abs(n(x.aliq_interna) - n(aliqInt)) < 1e-6)
    && (!(x.tipos_cliente || []).length || x.tipos_cliente.includes(tipo)));
  return escolher(L.map(x => ({ ...x, ncm_prefixo: '' })), data);
}

/**
 * Custo para o cliente, por unidade, de UMA opção de compra.
 * op:  { preco, uf_origem, aliq (ICMS da operação, %), interna_dest (%), simples, credito_simples_pct, antecip_pct, frete_tipo 'CIF'|'FOB', frete_un, prazo_dias }
 * cli: { uf, tipo, regime, cred_icms, cred_pc }
 * P:   { pc_pct (9,25), pc_excluir_icms (true), taxa_mensal (% a.m., 0 = sem valor presente) }
 * ref: reforma { t: CBS+IBS %, cred_ibs } (opcional)
 */
export function custoCliente(op, cli, P = {}, ref = null) {
  const L = [], avisos = [], add = (k, txt, v, obs = '') => L.push({ k, txt, v, obs });
  const preco = n(op.preco), inter = !!op.uf_origem && op.uf_origem !== cli.uf, aliq = n(op.aliq) / 100, intd = n(op.interna_dest) / 100;
  const contrib = cli.tipo !== 'nao_contrib', fob = op.frete_tipo === 'FOB', frete = fob ? n(op.frete_un) : 0;
  add('preco', 'Preço', preco, `${op.uf_origem || '—'} → ${cli.uf || '—'}${op.frete_tipo ? ` · frete ${op.frete_tipo}` : ''}`);
  if (frete) add('frete', '(+) Frete FOB pago pelo cliente', frete);
  // ICMS da nota
  const icms = op.simples ? 0 : preco * aliq;
  const credPermitido = op.simples ? preco * n(op.credito_simples_pct) / 100 : icms;
  if (!op.simples) add('icms', `ICMS destacado (${fmtPct(op.aliq)})`, icms, inter ? 'interestadual' : 'interna');
  else add('icms', 'Fornecedor do Simples: ICMS não destacado', 0, `crédito permitido ${fmtPct(op.credito_simples_pct)}`);
  const cred = cli.cred_icms ? credPermitido : 0;
  if (cred) add('cred_icms', '(−) Crédito de ICMS do cliente', -cred, 'recupera na apuração');
  else if (contrib) add('cred_icms', 'Sem crédito de ICMS', 0, cli.tipo === 'comercio' || cli.tipo === 'industria' ? 'perfil sem crédito' : 'uso e consumo');
  // DIFAL: contribuinte sem crédito (uso e consumo), compra de outra UF — base dupla
  let difal = 0, baseDifal = 0;
  if (inter && contrib && !cli.cred_icms && cli.tipo !== 'comercio' && intd > aliq) {
    baseDifal = (preco - preco * aliq) / (1 - intd);
    difal = Math.max(0, baseDifal * intd - preco * aliq);
    add('difal', `(+) DIFAL base dupla: base ${br(baseDifal)} × ${fmtPct(op.interna_dest)} − ${br(preco * aliq)}`, difal, 'pago pelo cliente');
  }
  if (inter && !contrib && intd > aliq) avisos.push(`Não contribuinte: o DIFAL (${fmtPct(op.interna_dest)} − ${fmtPct(op.aliq)}) é recolhido pelo fornecedor de ${op.uf_origem}; ele pode repassar no preço.`);
  // antecipação parcial do comércio
  let antecip = 0, antecipCusto = 0;
  if (inter && cli.tipo === 'comercio' && n(op.antecip_pct) > 0) {
    antecip = (preco + frete) * n(op.antecip_pct) / 100;
    antecipCusto = cli.cred_icms ? 0 : antecip;
    add('antecip', `Antecipação parcial ${cli.uf} (${fmtPct(op.antecip_pct)} sobre ${br(preco + frete)})`, antecipCusto,
      cli.cred_icms ? `paga ${br(antecip)} na entrada e credita depois: efeito só no caixa` : 'sem crédito: vira custo');
  }
  // PIS/COFINS
  let credPc = 0;
  if (cli.cred_pc && contrib) {
    const base = preco + frete - (P.pc_excluir_icms !== false ? icms : 0);
    credPc = base * n(P.pc_pct ?? 9.25) / 100;
    if (credPc) add('cred_pc', `(−) Crédito de PIS/COFINS (${fmtPct(P.pc_pct ?? 9.25)} sobre ${br(base)}${P.pc_excluir_icms !== false ? ', sem o ICMS' : ''})`, -credPc);
  }
  // reforma: CBS/IBS por fora, base sem o ICMS
  let ibs = 0, credIbs = 0;
  if (ref && n(ref.t) > 0) {
    ibs = (preco - icms) * n(ref.t) / 100;
    credIbs = ref.cred_ibs ? ibs : 0;
    add('ibs', `(+) CBS/IBS (${fmtPct(ref.t)} sobre ${br(preco - icms)})`, ibs);
    if (credIbs) add('cred_ibs', '(−) Crédito de CBS/IBS', -credIbs);
  }
  const custo = preco + frete + difal + antecipCusto - cred - credPc + ibs - credIbs;
  add('custo', 'Custo líquido para o cliente', custo);
  let custoVp = custo;
  const i = n(P.taxa_mensal) / 100, d = n(op.prazo_dias);
  if (i > 0 && d > 0) {
    custoVp = custo / Math.pow(1 + i, d / 30);
    add('vp', `Valor presente (${d} dias a ${fmtPct(P.taxa_mensal)} a.m.)`, custoVp);
  }
  return { linhas: L, avisos, preco, frete, icms, cred, difal, baseDifal, antecip, antecipCusto, credPc, ibs, credIbs, custo, custoVp, inter };
}

/** preço da opção "nos" que iguala o custo do cliente a um alvo (a relação é linear no preço) */
export function precoAlvo(op, cli, P, alvo, ref = null) {
  const f = (x) => custoCliente({ ...op, preco: x }, cli, P, ref).custoVp;
  const b = f(0), a = f(1) - b;
  return a > 0 ? (alvo - b) / a : null;
}

/**
 * Nossa margem por unidade ao preço x (visão interna).
 * m: { aliq (ICMS débito %), ncm, cfop, custo_un, frete_cif_un, cred_insumos_un, despesas_pct,
 *      prodepe: { ativo, pct, base, ncm[], cfops[] }, feef: { pct, base }, pc: { pct } | null (cumulativo/simples tratados no pct),
 *      simples_pct (empresa do Simples: alíquota efetiva do DAS; ignora ICMS/PIS/COFINS) }
 */
export function margemNossa(x, m = {}, ref = null) {
  const L = [], add = (txt, v, obs = '') => L.push({ txt, v, obs });
  x = n(x);
  add('Preço de venda', x);
  let trib = 0;
  if (m.simples_pct != null && m.simples_pct !== '') {
    trib = x * n(m.simples_pct) / 100;
    add(`(−) Simples Nacional (${fmtPct(m.simples_pct)} efetiva)`, -trib);
  } else {
    const esc = ref ? n(ref.icms_pct ?? 100) / 100 : 1;
    const deb = x * n(m.aliq) / 100 * esc, credIns = n(m.cred_insumos_un) * esc;
    add(`(−) ICMS débito (${fmtPct(n(m.aliq) * esc)})`, -deb);
    if (credIns) add('(+) Crédito de ICMS dos insumos (por unidade)', credIns);
    const saldo = Math.max(0, deb - credIns);
    const pr = m.prodepe || {}, aplica = !!pr.ativo && naLista(m.ncm, pr.ncm) && naLista(m.cfop, pr.cfops);
    const prodepe = aplica ? (pr.base === 'debito_incentivado' ? deb : saldo) * n(pr.pct) / 100 : 0;
    if (prodepe) add(`(+) Crédito presumido PRODEPE (${fmtPct(pr.pct)})`, prodepe);
    const fe = m.feef || {}, feef = prodepe && n(fe.pct) ? (fe.base === 'saldo_incentivado' ? saldo : prodepe) * n(fe.pct) / 100 : 0;
    if (feef) add(`(−) FEEF (${fmtPct(fe.pct)})`, -feef);
    const icmsLiq = saldo - prodepe + feef;
    trib += icmsLiq;
    if (ref) {
      const pcOn = ref.pis_cofins;
      const pc = pcOn && m.pc ? (x - deb) * n(m.pc.pct) / 100 : 0;
      if (pc) add(`(−) PIS/COFINS (${fmtPct(m.pc.pct)})`, -pc);
      trib += pc;
      if (n(ref.t)) add('CBS/IBS: débito e crédito compensados (neutro para a margem)', 0);
    } else if (m.pc) {
      const pc = (x - deb) * n(m.pc.pct) / 100;
      add(`(−) PIS/COFINS (${fmtPct(m.pc.pct)} sem o ICMS na base)`, -pc);
      trib += pc;
    }
  }
  const custo = n(m.custo_un), frete = n(m.frete_cif_un), desp = x * n(m.despesas_pct) / 100;
  add('(−) Custo do produto', -custo, m.custo_fonte || '');
  if (frete) add('(−) Frete CIF por unidade', -frete);
  if (desp) add(`(−) Despesas variáveis de venda (${fmtPct(m.despesas_pct)})`, -desp);
  const margem = x - trib - custo - frete - desp;
  add('Margem de contribuição', margem, x ? fmtPct(margem / x * 100) : '');
  return { linhas: L, margem, pct: x ? margem / x * 100 : 0, trib };
}

/** menor preço com a margem mínima (arredondado para cima) */
export function precoMargemMinima(m, mmPct, ref = null) {
  const g = (x) => margemNossa(x, m, ref).margem - x * n(mmPct) / 100;
  const b = g(0), a = g(1) - b;
  return a > 0 ? teto2(-b / a) : null;
}

/**
 * Análise completa.
 * e: { cli, conc: op, nos: op, P, m (margem, opcional), margem_min_pct }
 */
export function analisar(e, ref = null) {
  const conc = custoCliente(e.conc, e.cli, e.P, ref && { ...ref, cred_ibs: credIbs(e.cli) });
  const nos = custoCliente(e.nos, e.cli, e.P, ref && { ...ref, cred_ibs: credIbs(e.cli) });
  const dif = nos.custoVp - conc.custoVp, difPct = conc.custoVp ? dif / conc.custoVp * 100 : 0;
  const bruto = precoAlvo(e.nos, e.cli, e.P, conc.custoVp, ref && { ...ref, cred_ibs: credIbs(e.cli) });
  const empate = bruto == null ? null : piso2(bruto);
  const R = { conc, nos, dif, difPct, empate, empateBruto: bruto, ganha: dif <= 1e-9 };
  if (e.m) {
    const mg = (x) => margemNossa(x, e.m, ref);
    R.margem = { proposta: mg(n(e.nos.preco)), empate: empate != null ? mg(empate) : null };
    const piso = precoMargemMinima(e.m, e.margem_min_pct, ref);
    R.faixa = { de: piso, ate: empate, viavel: piso != null && empate != null && piso <= empate };
    if (R.faixa.viavel) R.margem.piso = mg(piso);
  }
  return R;
}
const credIbs = (cli) => cli.tipo !== 'nao_contrib' && cli.regime !== 'simples';

/** simulação da reforma: anos = trib_aliquotas da empresa (2027 em diante) */
export function simularReforma(e, anos) {
  return (anos || []).filter(a => +a.ano >= 2027).sort((a, b) => a.ano - b.ano).map(a => {
    const esc = n(a.icms_pct ?? 100) / 100, t = n(a.cbs) + n(a.ibs_uf) + n(a.ibs_mun);
    const ajusta = (op) => ({ ...op, aliq: n(op.aliq) * esc, interna_dest: n(op.interna_dest) * esc, antecip_pct: n(op.antecip_pct) * esc });
    const P = { ...e.P, pc_pct: a.pis_cofins ? e.P.pc_pct : 0 };
    const ref = { t, icms_pct: n(a.icms_pct ?? 100), pis_cofins: !!a.pis_cofins };
    const R = analisar({ ...e, conc: ajusta(e.conc), nos: ajusta(e.nos), P, m: e.m && { ...e.m } }, ref);
    return { ano: +a.ano, situacao: a.situacao, icms_pct: ref.icms_pct, t, conc: R.conc.custoVp, nos: R.nos.custoVp, dif: R.dif, difPct: R.difPct, empate: R.empate,
      margem: R.margem?.proposta?.pct ?? null };
  });
}

// ------------------------------------------------------------ textos
export const br = (v) => n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPct = (v) => `${n(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
export const STATUS = { negociacao: 'Em negociação', ganha: 'Ganha', perdida: 'Perdida' };

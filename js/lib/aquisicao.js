// Compra inteligente — custo líquido de aquisição (SQL 199, 26/11/2026). Renan: "na reforma tributária será imprescindível a
// compra e saber onde tem crédito será um diferencial". É o espelho da Análise de Competitividade (COM009): aqui a nossa empresa é
// a compradora. Por item de cada cotação:
//   desembolso = preço (com ICMS) + IPI + ICMS-ST + frete rateado [+ DIFAL no uso e consumo/ativo de outra UF]
//   créditos   = ICMS (insumo/revenda: na hora; ativo: 1/48 ao mês a valor presente — CIAP; uso e consumo: não)
//              + IPI (insumo de contribuinte do IPI) + PIS/COFINS (não cumulativo; base sem o ICMS, com frete/IPI conforme a Apuração)
//   custo líquido = desembolso − créditos; e a leitura "efetiva" do crédito de ICMS quando o PRODEPE é calculado sobre o saldo
//   devedor (cada R$ 1 de crédito reduz também o benefício): fator = 1 − %presumido × %saídas incentivadas × (1 − %FEEF).
// Reforma (2027 em diante): ICMS × % da transição, IPI zero, PIS/COFINS extintos, CBS/IBS por fora (base sem o ICMS) com
// crédito amplo — fornecedor do Simples que não opta pelo regime regular transfere só o crédito estimado do Simples.
// Cálculo puro, sem banco: alíquotas e parâmetros chegam por vigência.

const n = (v) => +v || 0;
export const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
export const DESTINACOES = [['insumo', 'Insumo da produção'], ['revenda', 'Revenda'], ['uso_consumo', 'Uso e consumo'], ['ativo', 'Ativo imobilizado']];
export const REGIMES_FORN = [['real', 'Lucro Real'], ['presumido', 'Lucro Presumido'], ['simples', 'Simples Nacional'], ['mei', 'MEI']];
const simplesDe = (reg) => reg === 'simples' || reg === 'mei';

/** valor presente, hoje, de um crédito recebido em parcelas mensais (CIAP: 48 × 1/48) */
export function vpParcelasMensais(total, meses = 48, taxaMensal = 0) {
  const i = n(taxaMensal) / 100, m = Math.max(1, Math.round(n(meses) || 1));
  if (!i) return n(total);
  let s = 0; for (let k = 1; k <= m; k++) s += (n(total) / m) / Math.pow(1 + i, k);
  return s;
}

/** fator do crédito de ICMS depois do PRODEPE (quanto cada R$ 1 de crédito reduz de imposto de fato) */
export function fatorIcmsEfetivo(fisc, P = {}) {
  if (!fisc?.prodepe_ativo || fisc.prodepe_base === 'debito_incentivado') return 1;
  const pct = n(fisc.prodepe_credito_pct) / 100, prop = (P.prodepe_saidas_pct ?? 100) / 100, feef = n(fisc.feef_pct) / 100;
  return Math.max(0, 1 - pct * prop * (1 - feef));
}

/**
 * Custo de UMA unidade de um item cotado.
 * it:  { preco (com ICMS), qtd, destinacao, icms_aliq, ipi_aliq, st_un, frete_un, uf_origem }
 * fo:  { regime, simples_credito_pct, simples_regular }
 * nos: { uf, interna (alíquota interna da nossa UF para o NCM), ipi_contribuinte, pc_nao_cumulativo, simples (nossa empresa no Simples: sem créditos), ibscbs_regular }
 * P:   { pc_pct, pc_excluir_icms, pc_incluir_frete, pc_incluir_ipi, ciap_meses, taxa_mensal, fator_icms, ref (reforma) }
 */
export function custoUnitario(it, fo = {}, nos = {}, P = {}) {
  const L = [], add = (k, txt, v, obs = '') => L.push({ k, txt, v, obs });
  const ref = P.ref || null, esc = ref ? n(ref.icms_pct ?? 100) / 100 : 1;
  const preco = n(it.preco), dest = it.destinacao || 'insumo', inter = !!it.uf_origem && !!nos.uf && it.uf_origem !== nos.uf;
  const simp = simplesDe(fo.regime);
  const aliq = n(it.icms_aliq) * esc / 100, intd = n(nos.interna) * esc / 100;
  const ipi = ref ? 0 : preco * n(it.ipi_aliq) / 100, st = n(it.st_un) * esc, frete = n(it.frete_un);
  add('preco', 'Preço (com ICMS)', preco, it.uf_origem ? `${it.uf_origem} → ${nos.uf || '—'}` : '');
  if (ipi) add('ipi', `(+) IPI (${fmt(it.ipi_aliq)}%)`, ipi);
  if (st) add('st', '(+) ICMS-ST', st);
  if (frete) add('frete', '(+) Frete rateado', frete);
  // ICMS destacado na nota (fornecedor do Simples não destaca: crédito pelo % permitido)
  const icms = simp ? 0 : preco * aliq;
  const icmsCreditavel = simp ? preco * n(fo.simples_credito_pct) * esc / 100 : icms;
  // DIFAL na compra de uso e consumo ou ativo de outra UF (base dupla)
  let difal = 0;
  if (inter && (dest === 'uso_consumo' || dest === 'ativo') && intd > aliq) {
    const base = (preco - preco * aliq) / (1 - intd);
    difal = Math.max(0, base * intd - preco * aliq);
    add('difal', `(+) DIFAL base dupla (${fmt(n(nos.interna) * esc)}% − ${fmt(n(it.icms_aliq) * esc)}%)`, difal, 'recolhido por nós');
  }
  // CBS/IBS por fora (reforma)
  let ibs = 0;
  if (ref && n(ref.t)) { ibs = (preco - icms) * n(ref.t) / 100; add('ibs', `(+) CBS/IBS (${fmt(ref.t)}% sobre ${br(preco - icms)})`, ibs); }
  const desembolso = preco + ipi + st + frete + difal + ibs;
  add('desemb', 'Desembolso por unidade', desembolso);
  // créditos
  let credIcms = 0, credIcmsNom = 0;
  if (nos.simples) add('cred_icms', 'Nossa empresa no Simples: sem crédito de ICMS, IPI e PIS/COFINS', 0);
  else if (dest === 'insumo' || dest === 'revenda') { credIcmsNom = icmsCreditavel; credIcms = credIcmsNom; }
  else if (dest === 'ativo') { credIcmsNom = icmsCreditavel + difal; credIcms = vpParcelasMensais(credIcmsNom, P.ciap_meses ?? 48, P.taxa_mensal); }
  const fat = P.fator_icms ?? 1, credIcmsEf = credIcms * fat;
  if (credIcmsNom) add('cred_icms', dest === 'ativo' ? `(−) Crédito de ICMS em ${P.ciap_meses ?? 48} meses (CIAP, a valor presente)` : `(−) Crédito de ICMS${simp ? ` (Simples: ${fmt(fo.simples_credito_pct)}%)` : ''}`,
    -credIcms, dest === 'ativo' ? `nominal ${br(credIcmsNom)}` : '');
  else if (dest === 'uso_consumo' && !nos.simples) add('cred_icms', 'Uso e consumo: sem crédito de ICMS', 0);
  const credIpi = !ref && !nos.simples && nos.ipi_contribuinte !== false && dest === 'insumo' ? ipi : 0;
  if (credIpi) add('cred_ipi', '(−) Crédito de IPI', -credIpi);
  let credPc = 0;
  if (!ref && !nos.simples && nos.pc_nao_cumulativo !== false && dest !== 'uso_consumo') {
    const base = preco - (P.pc_excluir_icms !== false ? icms : 0) + (P.pc_incluir_frete !== false ? frete : 0) + (P.pc_incluir_ipi && !credIpi ? ipi : 0);
    credPc = base * n(P.pc_pct ?? 9.25) / 100;
    if (credPc) add('cred_pc', `(−) Crédito de PIS/COFINS (${fmt(P.pc_pct ?? 9.25)}% sobre ${br(base)})`, -credPc);
  }
  let credIbs = 0;
  if (ibs) {
    credIbs = nos.simples && !nos.ibscbs_regular ? 0 : simp && fo.simples_regular !== 'sim' ? (preco * n(P.simples_credito_ibs_pct ?? 0) / 100) : ibs;
    if (nos.simples && !nos.ibscbs_regular) add('cred_ibs', 'Nossa empresa no Simples, sem a opção pelo regime regular: sem crédito de CBS/IBS', 0);
    else add('cred_ibs', simp && fo.simples_regular !== 'sim' ? `(−) Crédito de CBS/IBS do Simples (estimado ${fmt(P.simples_credito_ibs_pct ?? 0)}%)` : '(−) Crédito de CBS/IBS', -credIbs);
  }
  const custo = desembolso - credIcms - credIpi - credPc - credIbs;
  add('custo', 'Custo líquido por unidade', custo);
  const custoEf = desembolso - credIcmsEf - credIpi - credPc - credIbs;
  if (fat < 1 && credIcms) add('custo_ef', `Custo líquido com o PRODEPE (crédito de ICMS vale ${fmt(fat * 100)}%)`, custoEf, 'o crédito também reduz o benefício');
  return { linhas: L, preco, ipi, st, frete, difal, ibs, desembolso, icms, credIcms, credIcmsNom, credIcmsEf, credIpi, credPc, credIbs, creditos: credIcms + credIpi + credPc + credIbs, custo, custoEf };
}

/**
 * Mapa por custo líquido.
 * itens: requisição [{id, quantidade, destinacao, ncm}]
 * cots:  [{id, fornecedor, frete, uf, regime, simples_credito_pct, simples_regular, vpFator}]
 * citens:[{cotacao_id, requisicao_item_id, valor_unitario, icms_aliq, ipi_aliq, st_un}]
 * nos, P: como em custoUnitario; P.internaDe(ncm) → alíquota interna da nossa UF
 */
export function mapaLiquido(itens, cots, citens, nos, P) {
  const C = cots.map(c => {
    const meus = itens.map(i => ({ i, x: citens.find(z => z.cotacao_id === c.id && z.requisicao_item_id === i.id) })).filter(o => o.x);
    const merc = meus.reduce((s, o) => s + n(o.x.valor_unitario) * n(o.i.quantidade), 0);
    let tot = { desembolso: 0, creditos: 0, custo: 0, custoEf: 0, preco: 0 };
    const porItem = {};
    for (const { i, x } of meus) {
      const fr = merc ? n(c.frete) * (n(x.valor_unitario) * n(i.quantidade) / merc) / n(i.quantidade) : 0;
      const u = custoUnitario({ preco: x.valor_unitario, destinacao: i.destinacao, icms_aliq: x.icms_aliq, ipi_aliq: x.ipi_aliq, st_un: x.st_un, frete_un: fr, uf_origem: c.uf },
        c, { ...nos, interna: P.internaDe ? P.internaDe(i.ncm) : nos.interna }, P);
      porItem[i.id] = u;
      const q = n(i.quantidade);
      tot = { desembolso: tot.desembolso + u.desembolso * q, creditos: tot.creditos + u.creditos * q, custo: tot.custo + u.custo * q, custoEf: tot.custoEf + u.custoEf * q, preco: tot.preco + u.preco * q };
    }
    const completa = meus.length === itens.length, f = c.vpFator ?? 1;
    return { id: c.id, fornecedor: c.fornecedor, completa, porItem, ...Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, r2(v)])),
      custoVp: r2(tot.custo * f), custoEfVp: r2(tot.custoEf * f), faltaFiscal: !simplesDe(c.regime) && meus.some(o => o.x.icms_aliq == null) };
  });
  const comp = C.filter(c => c.completa), menor = (k) => (comp.length ? comp.reduce((a, b) => (b[k] < a[k] ? b : a)) : null);
  const melhorPreco = comp.length ? comp.reduce((a, b) => (b.desembolso < a.desembolso ? b : a)) : null;
  const melhorLiq = menor('custoVp'), melhorEf = menor('custoEfVp');
  return { cots: C, melhorPreco, melhorLiq, melhorEf,
    ganho: melhorPreco && melhorLiq && melhorPreco.id !== melhorLiq.id ? r2(melhorPreco.custoVp - melhorLiq.custoVp) : 0 };
}

/** o mesmo mapa ano a ano na reforma (anos = trib_aliquotas da empresa, de 2027 em diante) */
export function mapaReforma(itens, cots, citens, nos, P, anos) {
  return (anos || []).filter(a => +a.ano >= 2027).sort((a, b) => a.ano - b.ano).map(a => {
    const ref = { t: n(a.cbs) + n(a.ibs_uf) + n(a.ibs_mun), icms_pct: n(a.icms_pct ?? 100) };
    const M = mapaLiquido(itens, cots, citens, nos, { ...P, ref, fator_icms: 1 });
    return { ano: +a.ano, icms_pct: ref.icms_pct, t: ref.t, cots: M.cots.map(c => ({ id: c.id, custo: c.custoVp })), melhor: M.melhorLiq?.id || null };
  });
}

/** sugestão fiscal a partir das notas de entrada do fornecedor: [{ncm, p_icms, ipi_pct, st_un, orig, simples, uf, emissao}] */
export function sugestaoFiscal(hist, ncm) {
  const so = String(ncm || '').replace(/\D/g, '');
  const H = (hist || []).slice().sort((a, b) => String(b.emissao).localeCompare(String(a.emissao)));
  const x = (so && H.find(h => String(h.ncm || '') === so)) || (so && H.find(h => String(h.ncm || '').slice(0, 4) === so.slice(0, 4))) || null;
  const geral = H[0] || null;
  if (!x && !geral) return null;
  const b = x || geral;
  return { icms_aliq: x ? +x.p_icms || 0 : null, ipi_aliq: x ? r2(x.ipi_pct) : null, st_un: x ? r2(x.st_un) : null, simples: !!geral?.simples, uf: geral?.uf || null,
    origem: x?.orig ?? null, importado: x ? ['1', '2', '3', '8'].includes(String(x.orig)) : null, emissao: b.emissao, ncmIgual: !!x && String(x.ncm) === so };
}

/** diferenças entre o que o fornecedor declarou e a última nota dele */
export function divergencias(declarado, sug) {
  if (!sug) return [];
  const D = [];
  if (sug.icms_aliq != null && declarado.icms_aliq != null && Math.abs(n(declarado.icms_aliq) - n(sug.icms_aliq)) > 0.01)
    D.push(`ICMS declarado ${fmt(declarado.icms_aliq)}%; na última nota ${fmt(sug.icms_aliq)}%`);
  if (sug.ipi_aliq != null && declarado.ipi_aliq != null && Math.abs(n(declarado.ipi_aliq) - n(sug.ipi_aliq)) > 0.01)
    D.push(`IPI declarado ${fmt(declarado.ipi_aliq)}%; na última nota ${fmt(sug.ipi_aliq)}%`);
  return D;
}

export const fmt = (v) => n(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
export const br = (v) => n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Custo líquido cotado × realizado (SQL 200), pelo mesmo motor da cotação.
 * linhas: compras_liquido_realizado() — um registro por item recebido com nota:
 *   { pedido_id, pedido, fornecedor, uf, regime, simples_credito_pct, uf_nota, nota, item, destinacao, quantidade,
 *     vu_pedido, icms_pedido, ipi_pedido, st_un_pedido, vu_nota, icms_nota, nota_simples, ipi_nota, st_un_nota, comparavel }
 * Cotado: preço e impostos do pedido. Realizado: preço e impostos da nota. Nota do Simples: crédito pelo % do pedido
 * (se o pedido também previa Simples) ou zero (a nota não informa o crédito na base).
 * Devolve { itens, pedidos, total } com desembolso, créditos e custo dos dois lados e a diferença (realizado − cotado).
 */
export function realizadoCotado(linhas, nos, P) {
  const itens = (linhas || []).map(l => {
    const q = n(l.quantidade), interna = P.internaDe ? P.internaDe(l.ncm) : nos.interna, N = { ...nos, interna };
    const cot = custoUnitario({ preco: l.vu_pedido, destinacao: l.destinacao, icms_aliq: l.icms_pedido, ipi_aliq: l.ipi_pedido, st_un: l.st_un_pedido, uf_origem: l.uf || l.uf_nota },
      { regime: l.regime || 'real', simples_credito_pct: l.simples_credito_pct }, N, P);
    const regNota = l.nota_simples ? 'simples' : (simplesDe(l.regime) ? 'real' : (l.regime || 'real'));
    const rea = custoUnitario({ preco: l.vu_nota, destinacao: l.destinacao, icms_aliq: l.nota_simples ? 0 : l.icms_nota, ipi_aliq: l.ipi_nota, st_un: l.st_un_nota, uf_origem: l.uf_nota || l.uf },
      { regime: regNota, simples_credito_pct: l.nota_simples && simplesDe(l.regime) ? l.simples_credito_pct : 0 }, N, P);
    const tot = (u) => ({ desembolso: r2(u.desembolso * q), creditos: r2(u.creditos * q), custo: r2(u.custo * q), custoEf: r2(u.custoEf * q) });
    const c = tot(cot), r = tot(rea);
    return { ...l, cotado: c, realizado: r, dif: r2(r.custo - c.custo), difDesembolso: r2(r.desembolso - c.desembolso), difCreditos: r2(r.creditos - c.creditos) };
  });
  const soma = (L) => { const z = { desembolso: 0, creditos: 0, custo: 0, custoEf: 0 }, c = { ...z }, r = { ...z };
    for (const x of L) for (const k of Object.keys(z)) { c[k] += x.cotado[k]; r[k] += x.realizado[k]; }
    for (const k of Object.keys(z)) { c[k] = r2(c[k]); r[k] = r2(r[k]); }
    return { cotado: c, realizado: r, dif: r2(r.custo - c.custo), difDesembolso: r2(r.desembolso - c.desembolso), difCreditos: r2(r.creditos - c.creditos) }; };
  const comp = itens.filter(x => x.comparavel), porPed = {};
  for (const x of comp) (porPed[x.pedido_id] = porPed[x.pedido_id] || []).push(x);
  const pedidos = Object.values(porPed).map(L => ({ pedido_id: L[0].pedido_id, pedido: L[0].pedido, fornecedor: L[0].fornecedor, notas: [...new Set(L.map(x => x.nota))], itens: L, ...soma(L) }))
    .sort((a, b) => b.dif - a.dif);
  return { itens, pedidos, total: soma(comp), semDados: itens.length - comp.length };
}

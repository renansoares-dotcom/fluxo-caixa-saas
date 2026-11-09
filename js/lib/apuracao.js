// Apuração de impostos, etapa 2 (melhoria 9.2): ICMS com PRODEPE (crédito presumido), FEEF, taxa AD/DIPER e FECEP;
// IPI; PIS/COFINS não cumulativo com os créditos pelas regras da empresa; transição da reforma (2027–2033) pela base real.
// Tudo vem dos parâmetros cadastrados (fisc_param, SQL 141): nenhum percentual é suposto aqui.

const n = (v) => +v || 0;
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const so = (s) => String(s || '').replace(/\D/g, '');

/** parâmetros vigentes no mês (a última vigência com início até o fim do mês) */
export function paramDoMes(lista, mes) {
  const fim = mes.length === 7 ? mes + '-31' : mes;
  return (lista || []).filter(p => p.vigencia_inicio <= fim).sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0] || null;
}

/** lista vazia = todos; senão o código começa por algum prefixo da lista */
export const naLista = (cod, lista, vazioTodos = true) => {
  const L = (lista || []).map(so).filter(Boolean);
  if (!L.length) return vazioTodos;
  const c = so(cod); return L.some(p => c.startsWith(p));
};

/** texto "5101, 6101 6102;5401" -> ['5101','6101','6102','5401'] */
export const lerLista = (t) => [...new Set(String(t || '').split(/[\s,;]+/).map(so).filter(Boolean))];

/**
 * itens: [{ lado: 'saidas'|'entradas', terceiro: bool, cfop, ncm, vc, bc, icms, ipi, pis, cofins, vprod, vdesc, vfrete, voutro }]
 * (como montados na tela de apuração: saídas = notas emitidas; entradas próprias = devoluções de clientes; entradas de terceiros = compras)
 * p: fisc_param vigente (ou null); a: ajustes do mês (fisc_apuracoes)
 */
export function apurar(itens, p, a = {}) {
  p = p || {}; a = a || {};
  const S = itens.filter(i => i.lado === 'saidas'), Dv = itens.filter(i => i.lado === 'entradas' && !i.terceiro), C = itens.filter(i => i.lado === 'entradas' && i.terceiro);
  const sum = (L, f) => r2(L.reduce((t, i) => t + n(typeof f === 'function' ? f(i) : i[f]), 0));

  // ---------------- ICMS
  const debitos = sum(S, 'icms'), devolucoes = sum(Dv, 'icms'), creditos = sum(C, 'icms');
  const totalDeb = r2(debitos + n(a.icms_outros_debitos) - n(a.icms_estorno_debitos));
  const totalCred = r2(devolucoes + creditos + n(a.icms_outros_creditos) - n(a.icms_estorno_creditos) + n(a.icms_saldo_credor_ant));
  const saldo = r2(totalDeb - totalCred);
  const saldoDevedor = Math.max(0, saldo), saldoCredor = Math.max(0, -saldo);

  // PRODEPE: parcela incentivada do débito (CFOP e NCM incentivados)
  const incent = (i) => n(i.icms) > 0 && naLista(i.cfop, p.prodepe_cfops) && naLista(i.ncm, p.prodepe_ncm);
  const debIncent = sum(S.filter(incent), 'icms');
  const prop = debitos > 0 ? debIncent / debitos : 0;
  let saldoIncent = 0, credPres = 0, feef = 0, adDiper = 0;
  if (p.prodepe_ativo && n(p.prodepe_credito_pct) > 0) {
    saldoIncent = p.prodepe_base === 'debito_incentivado' ? Math.min(debIncent, saldoDevedor) : r2(saldoDevedor * prop);
    credPres = r2(saldoIncent * n(p.prodepe_credito_pct) / 100);
    feef = r2((p.feef_base === 'saldo_incentivado' ? saldoIncent : credPres) * n(p.feef_pct) / 100);
    adDiper = r2(credPres * n(p.ad_diper_pct) / 100);
  }
  const icmsRecolher = r2(Math.max(0, saldoDevedor - credPres));

  // FECEP: sobre a base do ICMS dos itens de saída sujeitos (lista de NCM vazia = nenhum)
  const sujFecep = S.filter(i => naLista(i.ncm, p.fecep_ncm, false) && naLista(i.cfop, p.fecep_cfops));
  const baseFecep = sum(sujFecep, 'bc'), fecep = r2(baseFecep * n(p.fecep_pct) / 100);

  // ---------------- IPI
  const ipiDeb = sum(S, 'ipi'), ipiDev = sum(Dv, 'ipi'), ipiCred = sum(C, 'ipi');
  const ipiSaldo = r2(ipiDeb - ipiDev - ipiCred - n(a.ipi_saldo_credor_ant));

  // ---------------- PIS/COFINS não cumulativo: débito = destacado nas saídas − devoluções; crédito = compras dos CFOP aceitos × alíquotas
  const pisPct = p.pis_pct == null ? 0 : n(p.pis_pct), cofPct = p.cofins_pct == null ? 0 : n(p.cofins_pct);
  const pcDeb = sum(S, i => n(i.pis) + n(i.cofins)), pcDev = sum(Dv, i => n(i.pis) + n(i.cofins));
  const comCred = C.filter(i => naLista(i.cfop, p.pc_cfops_credito, false));
  const baseCred = sum(comCred, i => n(i.vprod) - n(i.vdesc) + n(i.voutro) + (p.pc_incluir_frete === false ? 0 : n(i.vfrete))
    + (p.pc_incluir_ipi ? n(i.ipi) : 0) - (p.pc_excluir_icms === false ? 0 : n(i.icms)));
  const credPis = r2(baseCred * pisPct / 100), credCof = r2(baseCred * cofPct / 100);
  const pcSaldo = r2(pcDeb - pcDev - credPis - credCof - n(a.pc_outros_creditos) - n(a.pc_saldo_credor_ant));

  return {
    icms: { debitos, outrosDebitos: n(a.icms_outros_debitos), estornoDebitos: n(a.icms_estorno_debitos), devolucoes, creditos, outrosCreditos: n(a.icms_outros_creditos),
      estornoCreditos: n(a.icms_estorno_creditos), saldoCredorAnt: n(a.icms_saldo_credor_ant), totalDeb, totalCred, saldoDevedor, saldoCredor,
      debIncentivado: debIncent, proporcao: prop, saldoIncentivado: r2(saldoIncent), creditoPresumido: credPres, recolher: icmsRecolher, feef, adDiper,
      baseFecep, fecep, itensFecep: sujFecep.length, totalGuias: r2(icmsRecolher + feef + adDiper + fecep) },
    ipi: { debitos: ipiDeb, devolucoes: ipiDev, creditos: ipiCred, saldoCredorAnt: n(a.ipi_saldo_credor_ant), recolher: Math.max(0, ipiSaldo), saldoCredor: Math.max(0, -ipiSaldo) },
    pc: { debitos: pcDeb, devolucoes: pcDev, baseCredito: baseCred, itensCredito: comCred.length, creditoPis: credPis, creditoCofins: credCof, outrosCreditos: n(a.pc_outros_creditos),
      saldoCredorAnt: n(a.pc_saldo_credor_ant), recolher: Math.max(0, pcSaldo), saldoCredor: Math.max(0, -pcSaldo),
      // débito separado pela proporção das alíquotas (o destacado nas notas é a soma; aqui só para a guia)
      pis: Math.max(0, r2(pcSaldo * (pisPct + cofPct ? pisPct / (pisPct + cofPct) : 0))), cofins: Math.max(0, r2(pcSaldo * (pisPct + cofPct ? cofPct / (pisPct + cofPct) : 0))) },
    semParam: !p.vigencia_inicio,
  };
}

/** o que precisa de atenção antes de fechar */
export function pendencias(R, p, itens) {
  const out = [];
  if (!p) out.push('Sem parâmetros vigentes no mês: o PRODEPE, o FECEP e os créditos de PIS/COFINS não entram.');
  else {
    if (p.prodepe_ativo && R.icms.debIncentivado === 0 && R.icms.debitos > 0) out.push('PRODEPE ligado, mas nenhuma saída caiu nos CFOP/NCM incentivados.');
    if (n(p.fecep_pct) > 0 && !(p.fecep_ncm || []).length) out.push('FECEP com percentual, mas sem a lista de NCM sujeitos.');
    if (!(p.pc_cfops_credito || []).length && R.pc.debitos > 0) out.push('Nenhum CFOP de compra com crédito de PIS/COFINS cadastrado.');
  }
  const semNcm = (itens || []).filter(i => i.lado === 'saidas' && !so(i.ncm)).length;
  if (semNcm) out.push(`${semNcm} item(ns) de saída sem NCM: ficam fora das listas por NCM.`);
  if (!(itens || []).length) out.push('Nenhuma nota no mês.');
  return out;
}

/**
 * Transição da reforma pela base real (12 meses de notas, cabeçalhos):
 * hoje = ICMS líquido (− crédito presumido do PRODEPE, + FEEF, AD/DIPER e FECEP na mesma proporção) + PIS/COFINS;
 * em cada ano: o ICMS e o benefício reduzidos pelo icms_pct do ano, PIS/COFINS só se ainda cobrados, + CBS/IBS (débito − crédito).
 * base = { icms, pc, incentivo: { credPres, encargos }, debNovoBase, credNovoBase, faturamento }
 */
export function transicao(base, anos, o = {}) {
  const credNovo = (o.credNovo ?? 100) / 100;
  const hoje = r2(base.icms - base.incentivo.credPres + base.incentivo.encargos + base.pc);
  return {
    hoje, linhas: anos.map(a => {
      const f = n(a.icms_pct) / 100, t = (n(a.cbs) + n(a.ibs_uf) + n(a.ibs_mun)) / 100;
      const icms = r2((base.icms - base.incentivo.credPres + base.incentivo.encargos) * f);
      const pc = a.pis_cofins ? base.pc : 0;
      const novo = r2(base.debNovoBase * t - base.credNovoBase * t * credNovo);
      const totalAno = r2(icms + pc + novo);
      return { ano: a.ano, situacao: a.situacao, aliq: r2(t * 1e4) / 100, icmsPct: n(a.icms_pct), icms, beneficio: r2(base.incentivo.credPres * f), pc, novo, total: totalAno,
        dif: r2(totalAno - hoje), pctFat: base.faturamento ? totalAno / base.faturamento : null };
    }),
  };
}

/**
 * base da transição a partir dos cabeçalhos das notas (classeNota de reforma.js): venda, devolução de venda e compra.
 * O PRODEPE entra pela proporção do ICMS das vendas com o CFOP principal incentivado (sem o filtro de NCM, que é por item).
 */
export function baseTransicao(notas, classe, baseEst, p) {
  p = p || {};
  let icmsV = 0, icmsInc = 0, icmsD = 0, icmsC = 0, pcV = 0, pcD = 0, credPc = 0, debNovo = 0, credNovo = 0, fat = 0;
  const pc = (n(p.pis_pct ?? 1.65) + n(p.cofins_pct ?? 7.6)) / 100;
  for (const nt of notas || []) {
    const k = classe(nt), b = baseEst(nt);
    if (k === 'venda') { fat += n(nt.v_nf); icmsV += n(nt.v_icms); if (naLista((nt.cfops || [])[0], p.prodepe_cfops)) icmsInc += n(nt.v_icms); pcV += n(nt.v_pis) + n(nt.v_cofins); debNovo += b; }
    else if (k === 'dev_venda') { icmsD += n(nt.v_icms); pcD += n(nt.v_pis) + n(nt.v_cofins); debNovo -= b; }
    else if (k === 'compra') {
      icmsC += n(nt.v_icms); credNovo += b;
      if (naLista((nt.cfops || [])[0], p.pc_cfops_credito, false)) credPc += Math.max(0, n(nt.v_prod) - n(nt.v_desc) + n(nt.v_frete) + n(nt.v_outro) - n(nt.v_icms)) * pc;
    }
  }
  const saldo = Math.max(0, icmsV - icmsD - icmsC), prop = icmsV ? icmsInc / icmsV : 0;
  let credPres = 0, encargos = 0;
  if (p.prodepe_ativo && n(p.prodepe_credito_pct) > 0) {
    const si = p.prodepe_base === 'debito_incentivado' ? Math.min(icmsInc, saldo) : saldo * prop;
    credPres = si * n(p.prodepe_credito_pct) / 100;
    encargos = (p.feef_base === 'saldo_incentivado' ? si : credPres) * n(p.feef_pct) / 100 + credPres * n(p.ad_diper_pct) / 100;
  }
  return { icms: r2(saldo), pc: r2(Math.max(0, pcV - pcD - credPc)), incentivo: { credPres: r2(credPres), encargos: r2(encargos) },
    debNovoBase: r2(debNovo), credNovoBase: r2(credNovo), faturamento: r2(fat) };
}

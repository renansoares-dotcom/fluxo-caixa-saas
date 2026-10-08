// NF-e completas: leitura do XML (cabeçalho, itens com impostos, parcelas, eventos) e casamento das parcelas
// com os lançamentos de recebimento que já existem. Usado pela página Notas Fiscais.

const dig = (s) => String(s || '').replace(/\D/g, '');
const n2 = (v) => { const x = parseFloat(v); return isFinite(x) ? Math.round(x * 100) / 100 : null; };
const nn = (v) => { const x = parseFloat(v); return isFinite(x) ? x : null; };
const cent = (v) => Math.round(+v * 100);
// diferença de arredondamento aceita entre parcela e recebimento (ex.: 45,30 × 45,29)
const perto = (a, b) => Math.abs(cent(a) - cent(b)) <= 5;

// CFOP que não geram financeiro (remessas, bonificação, demonstração, comodato, industrialização, retorno…)
export const CFOP_SEM_FINANCEIRO = new Set(['5901', '6901', '5902', '6902', '5903', '6903', '5905', '6905', '5908', '6908', '5909', '6909', '5910', '6910', '5911', '6911',
  '5912', '6912', '5913', '6913', '5914', '6914', '5915', '6915', '5916', '6916', '5917', '6917', '5920', '6920', '5921', '6921', '5923', '6923', '5924', '6924', '5949', '6949', '5552', '6552', '5557', '6557']);

/** Lê um XML: { tipo:'nfe', nota, itens, parcelas } | { tipo:'evento', chave, tpEvento, descricao, data, seq, correcao } | null */
export function lerNFeCompleta(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const un = (el, tag) => el?.getElementsByTagName(tag)[0] || null;
  const tx = (el, tag) => un(el, tag)?.textContent?.trim() || null;
  const filho = (el) => el ? [...el.children][0] || null : null; // ICMS00, PISAliq…
  const inf = un(doc, 'infNFe');
  if (!inf) {
    const ev = un(doc, 'infEvento'); if (!ev) return null;
    return { tipo: 'evento', chave: tx(ev, 'chNFe'), tpEvento: tx(ev, 'tpEvento'), descricao: tx(ev, 'descEvento') || tx(ev, 'xEvento'),
      data: (tx(ev, 'dhEvento') || '').slice(0, 10), seq: tx(ev, 'nSeqEvento'), correcao: tx(ev, 'xCorrecao'),
      cstat: tx(un(doc, 'retEvento') || doc, 'cStat') };
  }
  const ide = un(inf, 'ide'), emit = un(inf, 'emit'), dest = un(inf, 'dest'), tot = un(inf, 'ICMSTot'), ibst = un(inf, 'IBSCBSTot'), prot = un(doc, 'infProt');
  const dets = [...inf.getElementsByTagName('det')];
  const itens = dets.map((d) => {
    const p = un(d, 'prod'), imp = un(d, 'imposto');
    const icms = filho(un(imp, 'ICMS')), ipi = un(imp, 'IPI'), pis = filho(un(imp, 'PIS')), cof = filho(un(imp, 'COFINS')), ibs = un(imp, 'IBSCBS');
    const ipiT = un(ipi, 'IPITrib') || un(ipi, 'IPINT');
    return {
      n_item: +d.getAttribute('nItem') || null, cprod: tx(p, 'cProd'), xprod: tx(p, 'xProd'), ncm: tx(p, 'NCM'), cest: tx(p, 'CEST'), cfop: tx(p, 'CFOP'), ucom: tx(p, 'uCom'),
      qcom: nn(tx(p, 'qCom')), vuncom: nn(tx(p, 'vUnCom')), vprod: n2(tx(p, 'vProd')), vdesc: n2(tx(p, 'vDesc')), vfrete: n2(tx(p, 'vFrete')), voutro: n2(tx(p, 'vOutro')),
      orig: tx(icms, 'orig'), cst_icms: tx(icms, 'CST') || tx(icms, 'CSOSN'), v_bc_icms: n2(tx(icms, 'vBC')), p_icms: nn(tx(icms, 'pICMS')), v_icms: n2(tx(icms, 'vICMS')),
      v_bc_st: n2(tx(icms, 'vBCST')), v_st: n2(tx(icms, 'vICMSST')),
      cst_ipi: tx(ipiT, 'CST'), v_ipi: n2(tx(ipiT, 'vIPI')), cst_pis: tx(pis, 'CST'), v_pis: n2(tx(pis, 'vPIS')), cst_cofins: tx(cof, 'CST'), v_cofins: n2(tx(cof, 'vCOFINS')),
      cst_ibscbs: ibs ? tx(ibs, 'CST') : null, cclass_trib: ibs ? tx(ibs, 'cClassTrib') : null, v_ibs: ibs ? n2(tx(un(ibs, 'gIBSCBS'), 'vIBS')) : null, v_cbs: ibs ? n2(tx(un(ibs, 'gCBS'), 'vCBS')) : null,
      v_tot_trib: n2(tx(imp, 'vTotTrib')),
    };
  });
  const dups = [...(un(inf, 'cobr')?.getElementsByTagName('dup') || [])].map((d, i) => {
    const nd = tx(d, 'nDup') || ''; const k = /^\d+$/.test(nd) ? +nd : (+(nd.match(/(\d+)\s*$/)?.[1]) || i + 1);
    return { numero: k > 0 && k < 1000 ? k : i + 1, vencimento: (tx(d, 'dVenc') || '').slice(0, 10) || null, valor: n2(tx(d, 'vDup')) || 0 };
  });
  const cstat = tx(prot, 'cStat');
  const nota = {
    chave: (inf.getAttribute('Id') || '').replace(/^NFe/, '') || tx(prot, 'chNFe'), modelo: tx(ide, 'mod'), serie: tx(ide, 'serie'), numero: +tx(ide, 'nNF'),
    emissao: (tx(ide, 'dhEmi') || tx(ide, 'dEmi') || '').slice(0, 10), tp_nf: tx(ide, 'tpNF'), finalidade: tx(ide, 'finNFe'), natureza: tx(ide, 'natOp'),
    cfops: [...new Set(itens.map(i => i.cfop).filter(Boolean))], consumidor_final: tx(ide, 'indFinal') === '1',
    emit_doc: tx(emit, 'CNPJ') || tx(emit, 'CPF'), emit_nome: tx(emit, 'xNome'),
    dest_doc: tx(dest, 'CNPJ') || tx(dest, 'CPF') || tx(dest, 'idEstrangeiro'), dest_nome: tx(dest, 'xNome'), dest_uf: tx(un(dest, 'enderDest'), 'UF'), dest_ind_ie: tx(dest, 'indIEDest'),
    v_prod: n2(tx(tot, 'vProd')), v_desc: n2(tx(tot, 'vDesc')), v_frete: n2(tx(tot, 'vFrete')), v_seg: n2(tx(tot, 'vSeg')), v_outro: n2(tx(tot, 'vOutro')), v_nf: n2(tx(tot, 'vNF')),
    v_bc_icms: n2(tx(tot, 'vBC')), v_icms: n2(tx(tot, 'vICMS')), v_icms_deson: n2(tx(tot, 'vICMSDeson')), v_fcp: n2(tx(tot, 'vFCP')), v_bc_st: n2(tx(tot, 'vBCST')), v_st: n2(tx(tot, 'vST')),
    v_ipi: n2(tx(tot, 'vIPI')), v_pis: n2(tx(tot, 'vPIS')), v_cofins: n2(tx(tot, 'vCOFINS')), v_tot_trib: n2(tx(tot, 'vTotTrib')),
    v_bc_ibscbs: ibst ? n2(tx(ibst, 'vBCIBSCBS')) : null, v_ibs: ibst ? n2(tx(un(ibst, 'gIBS'), 'vIBS')) : null, v_cbs: ibst ? n2(tx(un(ibst, 'gCBS'), 'vCBS')) : null,
    cstat, protocolo: tx(prot, 'nProt'), situacao: !prot || ['100', '150'].includes(cstat) ? 'autorizada' : ['110', '301', '302', '303'].includes(cstat) ? 'denegada' : 'outra',
    inf_cpl: tx(un(inf, 'infAdic'), 'infCpl'),
  };
  return { tipo: 'nfe', nota, itens, parcelas: dups };
}

/** Classifica as notas lidas em relação à empresa. */
export function prepararNotas(lidos, cnpjEmpresa) {
  const raiz = dig(cnpjEmpresa).slice(0, 8);
  const eventos = lidos.filter(x => x.tipo === 'evento');
  const out = []; const ignoradas = []; const vistas = new Set(); let repetidas = 0;
  for (const x of lidos.filter(x => x.tipo === 'nfe')) {
    const n = x.nota; if (vistas.has(n.chave)) { repetidas++; continue; } vistas.add(n.chave);
    const propria = dig(n.emit_doc).slice(0, 8) === raiz, dest = dig(n.dest_doc).slice(0, 8) === raiz;
    if (!raiz || (!propria && !dest)) { ignoradas.push({ n, motivo: 'empresa não participa' }); continue; }
    if (propria && dest) { ignoradas.push({ n, motivo: 'entre estabelecimentos da empresa' }); continue; }
    const evs = eventos.filter(e => e.chave === n.chave);
    out.push({ ...x, nota: { ...n, tipo: n.tp_nf === '1' ? 'saida' : 'entrada', emissao_propria: propria,
      situacao: evs.some(e => e.tpEvento === '110111') ? 'cancelada' : n.situacao,
      eventos: evs.map(e => ({ tipo: e.tpEvento, descricao: e.descricao, data: e.data, seq: e.seq, correcao: e.correcao })) } });
  }
  return { notas: out, eventos, ignoradas, repetidas };
}

// ---------------------------------------------------------------------------------------------
// Casamento parcelas × lançamentos de recebimento
// ---------------------------------------------------------------------------------------------
/** NF e parcela citadas no lançamento: "1-35588/1", "DUPLICATA 35932/1", "RECEBIMENTO DE TITULO 34799", documento "36077-1". */
export function nfDoLancamento(l) {
  const txts = [l.documento, l.descricao].filter(Boolean);
  for (const t of txts) {
    let m = t.match(/(\d)-(\d{4,6})\/(\d{1,3})\b/); if (m) return { nf: +m[2], parcela: +m[3] };
    m = t.match(/\b(\d{4,6})[/-](\d{1,3})\b/); if (m) return { nf: +m[1], parcela: +m[2] };
  }
  for (const t of txts) { const m = t.match(/\b(\d{4,6})\b/); if (m) return { nf: +m[1], parcela: null }; }
  return { nf: null, parcela: null };
}

/**
 * notas: [{ id, numero, dest_doc, situacao, cfops, v_nf, emissao, parcelas:[{id, numero, vencimento, valor, a_vista}] }]
 * lancs: [{ id, data, valor, descricao, documento, fav_doc }] (só recebimentos ainda sem vínculo)
 * Retorna { grupos: [{ cat, nota, parcela, lancs, valorNota, valorLanc }], semFinanceiro, cancelados, outroCliente }
 */
export function casarNotas(notas, lancs) {
  const porNF = new Map();
  for (const l of lancs) { const r = nfDoLancamento(l); if (r.nf == null) continue; l._nf = r.nf; l._parc = r.parcela; (porNF.get(r.nf) || porNF.set(r.nf, []).get(r.nf)).push(l); }
  const usados = new Set(); const grupos = []; const semFinanceiro = []; const cancelados = []; const outroCliente = [];
  const raiz = (d) => dig(d).slice(0, 8);
  for (const n of notas) {
    const todos = (porNF.get(n.numero) || []).filter(l => !usados.has(l.id));
    if (n.situacao === 'cancelada') { if (todos.length) cancelados.push({ nota: n, lancs: todos }); continue; }
    // cliente do lançamento diferente do destinatário da nota: não casa automaticamente
    const cands = []; for (const l of todos) { if (l.fav_doc && n.dest_doc && raiz(l.fav_doc) !== raiz(n.dest_doc)) outroCliente.push({ nota: n, lanc: l }); else cands.push(l); }
    if (!n.parcelas.length) { semFinanceiro.push(n); continue; }
    const livres = () => cands.filter(l => !usados.has(l.id));
    const st = new Map(n.parcelas.map(p => [p.id, null]));
    // 1) mesma parcela (ou sem parcela citada) e mesmo valor
    for (const p of n.parcelas) {
      const l = livres().find(l => (l._parc === p.numero || l._parc == null) && perto(l.valor, p.valor))
        || livres().find(l => perto(l.valor, p.valor) && n.parcelas.length === 1);
      if (l) { usados.add(l.id); st.set(p.id, 'ok'); grupos.push({ cat: 'exata', nota: n, parcela: p, lancs: [l] }); }
    }
    // 2) vários lançamentos da mesma parcela somando o valor
    for (const p of n.parcelas) {
      if (st.get(p.id)) continue;
      const ls = livres().filter(l => l._parc === p.numero);
      if (ls.length > 1 && perto(ls.reduce((s, l) => s + +l.valor, 0), p.valor)) { ls.forEach(l => usados.add(l.id)); st.set(p.id, 'ok'); grupos.push({ cat: 'soma', nota: n, parcela: p, lancs: ls }); }
    }
    // 3) o que sobrou da nota: soma dos lançamentos × soma das parcelas
    const rp = n.parcelas.filter(p => !st.get(p.id)); const rl = livres();
    if (rp.length && rl.length) {
      const sp = rp.reduce((s, p) => s + +p.valor, 0), sl = rl.reduce((s, l) => s + +l.valor, 0);
      const cat = perto(sp, sl) ? 'nota' : sl < sp ? 'parcial' : 'valor_diferente';
      rl.forEach(l => usados.add(l.id)); rp.forEach(p => st.set(p.id, cat));
      grupos.push({ cat, nota: n, parcela: rp.length === 1 ? rp[0] : null, parcelas: rp, lancs: rl });
    }
    for (const p of n.parcelas) if (!st.get(p.id)) grupos.push({ cat: 'pendente', nota: n, parcela: p, lancs: [] });
  }
  // parcelas sem recebimento: possíveis lançamentos do mesmo cliente (sem citar a nota) perto do vencimento — só sugestão
  const nome1 = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).find(w => w.length >= 3) || '';
  const dias = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5);
  for (const g of grupos.filter(g => g.cat === 'pendente')) {
    const r = raiz(g.nota.dest_doc), n1 = nome1(g.nota.dest_nome), v = g.parcela?.vencimento || g.nota.emissao;
    g.possiveis = lancs.filter(l => !usados.has(l.id) && l._nf == null && ((l.fav_doc && raiz(l.fav_doc) === r) || (!l.fav_doc && n1 && nome1(l.fav_nome) === n1))
      && dias(l.data, v) >= -45 && dias(l.data, v) <= 150).sort((a, b) => Math.abs(+a.valor - +g.parcela.valor) - Math.abs(+b.valor - +g.parcela.valor)).slice(0, 4);
  }
  for (const g of grupos) { g.valorNota = g.parcelas ? g.parcelas.reduce((s, p) => s + +p.valor, 0) : +(g.parcela?.valor || 0); g.valorLanc = g.lancs.reduce((s, l) => s + +l.valor, 0); }
  return { grupos, semFinanceiro, cancelados, outroCliente };
}

// ---------------------------------------------------------------------------------------------
// Borderôs FIDC × notas: o título da base FIDC traz o nº da nota e, quase sempre, a parcela
// ("33775-001" na FS/Negocial; só "33695" na Contato). Liga cada título à parcela da nota.
//   exata          → mesma nota, parcela e valor (±5 centavos)
//   valor_diferente→ achou a parcela, mas o valor do título difere (título parcial, nota alterada…)
//   outro_sacado   → CNPJ do sacado no borderô é de outra empresa (raiz diferente) — conferir
//   sem_parcela    → cita uma nota do mês mas não foi possível dizer qual parcela
// `ocupadas` = ids de parcelas que já têm título vinculado (não recebem outro automaticamente).
// ---------------------------------------------------------------------------------------------
export function tituloNF(titulo) {
  const m = String(titulo || '').trim().match(/^0*(\d{3,7})(?:\s*[-/.]\s*0*(\d{1,3}))?$/);
  return m ? { nf: +m[1], parc: m[2] != null ? +m[2] : null } : null;
}
export function casarBorderos(notas, titulos, ocupadas = new Set()) {
  const porNum = new Map();
  for (const n of notas) (porNum.get(n.numero) || porNum.set(n.numero, []).get(n.numero)).push(n);
  const usadas = new Set(ocupadas), grupos = [];
  const raiz = (d) => String(d || '').replace(/\D/g, '').slice(0, 8);
  const ord = [...titulos].sort((a, b) => (tituloNF(a.titulo)?.parc == null) - (tituloNF(b.titulo)?.parc == null)); // com parcela primeiro
  for (const t of ord) {
    const k = tituloNF(t.titulo); if (!k) continue;
    let cands = porNum.get(k.nf); if (!cands?.length) continue;
    if (cands.length > 1 && t.cnpj_sacado) cands = cands.filter(n => raiz(n.dest_doc) === raiz(t.cnpj_sacado)).concat(cands.filter(n => raiz(n.dest_doc) !== raiz(t.cnpj_sacado)));
    const nota = cands[0]; const ps = nota.parcelas || [];
    const livres = ps.filter(p => !usadas.has(p.id));
    let p = null;
    if (k.parc != null) p = ps.find(p => p.numero === k.parc) || null;
    else if (ps.length === 1) p = ps[0];
    else p = livres.find(p => Math.abs(+p.valor - +t.valor) <= 0.05) || null;
    let cat;
    if (t.cnpj_sacado && nota.dest_doc && raiz(t.cnpj_sacado) !== raiz(nota.dest_doc)) cat = 'outro_sacado';
    else if (!p || usadas.has(p.id)) cat = 'sem_parcela';
    else cat = Math.abs(+p.valor - +t.valor) <= 0.05 ? 'exata' : 'valor_diferente';
    if (p && cat !== 'sem_parcela') usadas.add(p.id);
    grupos.push({ cat, titulo: t, nota, parcela: cat === 'sem_parcela' ? null : p, ocupada: !!(p && ocupadas.has(p.id)) });
  }
  // parcelas a prazo das notas que não entraram em borderô (cobrança própria / carteira)
  const fora = [];
  for (const n of notas) for (const p of n.parcelas || []) if (!p.a_vista && !usadas.has(p.id)) fora.push({ nota: n, parcela: p });
  return { grupos, fora };
}

// Leitura do "Extrato de Pagamentos" da VExpenses (PDF exportado da plataforma) para entrar como extrato da conta
// VEXPENSES na Conciliação. Cada linha: Data · Número do Cartão · Nome (colaborador) · Descrição · Valor (BRL) · Grupo.
// Três tipos de linha:
//   - carga     "Transf. IPLAMM > colaborador": dinheiro da carteira da empresa para o cartão (interno à conta)
//   - devolução "Transf. colaborador > IPLAMM": sobra do cartão de volta para a carteira (interno à conta)
//   - gasto     compra no cartão (posto, restaurante...) e estornos — é o que sai de fato da conta VEXPENSES
// Só os gastos e estornos viram linhas de extrato; cargas e devoluções ficam no resumo (saldo nos cartões).
// Formato de saída igual ao lerOFX/lerRelatorioERP.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
let _pdfjs = null;
async function carregarPdfjs() {
  if (_pdfjs) return _pdfjs;
  const m = await import(PDFJS);
  m.GlobalWorkerOptions.workerSrc = WORKER;
  return (_pdfjs = m);
}

const r2 = (v) => Math.round(v * 100) / 100;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Linhas de texto do PDF, cada uma como lista de pedaços { x, str } em ordem. */
export async function linhasPdf(buf, pdfjs) {
  const lib = pdfjs || await carregarPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p); const tc = await pg.getTextContent();
    const porY = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]); let k = [...porY.keys()].find(v => Math.abs(v - y) <= 2); if (k == null) { k = y; porY.set(k, []); }
      porY.get(k).push({ x: it.transform[4], str: it.str });
    }
    for (const y of [...porY.keys()].sort((a, b) => b - a)) out.push(porY.get(y).sort((a, b) => a.x - b.x));
  }
  return out;
}

/** Interpreta as linhas do Extrato de Pagamentos. */
export function interpretarVExpenses(linhas) {
  const txt = linhas.map(l => l.map(p => p.str).join(' ')).join('\n');
  if (!/extrato de pagamentos/i.test(txt) || !/descri[cç][aã]o de pagamento/i.test(txt)) throw new Error('O PDF não parece ser o "Extrato de Pagamentos" da VExpenses.');
  // colunas pela posição do cabeçalho
  const cab = linhas.find(l => l.some(p => /^data$/i.test(p.str.trim())) && l.some(p => /^valor$/i.test(p.str.trim())));
  const xs = {}; if (cab) for (const p of cab) { const n = norm(p.str); if (n === 'nome') xs.nome = p.x; if (n.startsWith('descricao')) xs.desc = p.x; if (n === 'valor') xs.valor = p.x; if (n.startsWith('numero')) xs.cartao = p.x; if (n === 'grupo') xs.grupo = p.x; }
  const rows = [];
  // pedaços de uma coluna nas linhas vizinhas (o relatório quebra nome e valor em até três linhas)
  const naColuna = (l, x0, x1) => (l || []).filter(p => p.x >= x0 - 2 && p.x < x1 - 2 && !/^\d{2}\/\d{2}\/\d{4}$/.test(p.str.trim()));
  for (let li = 0; li < linhas.length; li++) {
    const l = linhas[li];
    const m = l[0]?.str.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!m) continue;
    let vi = l.findIndex(p => /BRL/.test(p.str)); let vs;
    if (vi >= 0) { vs = l[vi].str.replace(/.*BRL/, '').trim(); if (!vs && l[vi + 1]) vs = l[vi + 1].str.trim(); }
    else if (xs.valor != null) { // valor em cima/embaixo da linha da data ("BRL" numa linha, número na outra)
      const viz = [linhas[li - 1], linhas[li + 1]].filter(v => v && !/^\d{2}\/\d{2}\/\d{4}$/.test(v[0]?.str.trim()));
      vs = viz.flatMap(v => naColuna(v, xs.valor, xs.grupo ?? 1e9)).map(p => p.str.trim()).join(' ').replace(/.*BRL/, '').trim();
    }
    const v = parseFloat(String(vs || '').replace(/\./g, '').replace(',', '.')); if (!isFinite(v)) continue;
    const meio = l.slice(1, vi >= 0 ? vi : undefined).filter(p => p.str.trim() !== '-' && (xs.valor == null || p.x < xs.valor - 2));
    let nome, desc;
    if (xs.desc != null) { nome = meio.filter(p => p.x < xs.desc - 2).map(p => p.str.trim()).join(' '); desc = meio.filter(p => p.x >= xs.desc - 2).map(p => p.str.trim()).join(' '); }
    else { nome = meio[0]?.str.trim() || ''; desc = meio.slice(1).map(p => p.str.trim()).join(' '); }
    if (!nome && xs.nome != null && xs.desc != null) { // nome quebrado nas linhas vizinhas
      const viz = [linhas[li - 1], linhas[li + 1]].filter(v => v && !/^\d{2}\/\d{2}\/\d{4}$/.test(v[0]?.str.trim()));
      nome = viz.flatMap(v => naColuna(v, xs.nome, xs.desc)).map(p => p.str.trim()).join(' ');
    }
    if (!desc && xs.desc != null) { // descrição quebrada nas linhas vizinhas
      const viz = [linhas[li - 1], linhas[li + 1]].filter(v => v && !/^\d{2}\/\d{2}\/\d{4}$/.test(v[0]?.str.trim()));
      desc = viz.flatMap(v => naColuna(v, xs.desc, xs.valor ?? 1e9)).map(p => p.str.trim()).join(' ');
    }
    rows.push({ data: `${m[3]}-${m[2]}-${m[1]}`, nome: nome.replace(/\s+/g, ' ').trim(), desc: desc.replace(/\s+/g, ' ').trim(), valor: r2(v) });
  }
  if (!rows.length) throw new Error('Nenhuma linha de pagamento encontrada no PDF.');
  // "Transf. Deposito": recarga da carteira da empresa (vem do banco) · "Movimentação do Dia": resumo das distribuições, ignorado
  const tipo = (r) => /^transf\.?\s*dep[oó]sito/i.test(r.desc) ? 'deposito' : /^movimenta[cç][aã]o do dia/i.test(r.desc) ? 'movdia' : /^transf\..*>\s*(iplamm|$)/i.test(r.desc) ? 'devolucao' : /^transf\.\s*iplamm\s*>/i.test(r.desc) ? 'carga' : r.valor > 0 ? 'estorno' : 'gasto';
  const res = { cargas: { n: 0, v: 0 }, devolucoes: { n: 0, v: 0 }, gastos: { n: 0, v: 0 }, estornos: { n: 0, v: 0 }, depositos: { n: 0, v: 0 } };
  const porPessoa = {};
  const vistos = {}; const itens = [];
  for (const r of rows) {
    const t = tipo(r); if (t === 'movdia') continue; const k = { carga: 'cargas', devolucao: 'devolucoes', gasto: 'gastos', estorno: 'estornos', deposito: 'depositos' }[t];
    res[k].n++; res[k].v = r2(res[k].v + r.valor);
    if (t === 'deposito') { const base = `vx:${r.data}|${r.valor.toFixed(2)}|deposito`; vistos[base] = (vistos[base] || 0) + 1;
      itens.push({ fitid: `${base}#${vistos[base]}`, data: r.data, valor: r.valor, tipo: 'DEPOSITO', descricao: 'Transf. Deposito — recarga da carteira IPLAMM', documento: null }); continue; }
    const pp = porPessoa[r.nome] ||= { cargas: 0, devolucoes: 0, gastos: 0 }; pp[t === 'carga' ? 'cargas' : t === 'devolucao' ? 'devolucoes' : 'gastos'] = r2(pp[t === 'carga' ? 'cargas' : t === 'devolucao' ? 'devolucoes' : 'gastos'] + r.valor);
    if (t === 'carga' || t === 'devolucao') continue;
    const descricao = `${r.desc} — ${r.nome}`;
    const base = `vx:${r.data}|${r.valor.toFixed(2)}|${norm(r.nome).replace(/[^a-z0-9]/g, '').slice(0, 30)}|${norm(r.desc).replace(/[^a-z0-9]/g, '').slice(0, 40)}`;
    vistos[base] = (vistos[base] || 0) + 1;
    itens.push({ fitid: `${base}#${vistos[base]}`, data: r.data, valor: r.valor, tipo: t === 'estorno' ? 'ESTORNO' : 'CARTAO', descricao, documento: null });
  }
  // movimento da carteira da empresa por dia, visto pelos cartões: −cargas + devoluções
  const carteiraDia = {};
  for (const r of rows) { const t = tipo(r); if (t === 'carga' || t === 'devolucao') carteiraDia[r.data] = r2((carteiraDia[r.data] || 0) - r.valor); }
  const datas = rows.map(r => r.data).sort();
  const saldoCartoes = r2(rows.filter(r => !['deposito', 'movdia'].includes(tipo(r))).reduce((s, r) => s + r.valor, 0));
  return { origem: 'vexpenses', banco: 'VEXPENSES', agencia: null, conta: null, inicio: datas[0], fim: datas[datas.length - 1], saldo: null, saldoData: datas[datas.length - 1],
    linhas: rows.length, resumo: res, carteiraDia, porPessoa, movCartoes: res.gastos.n || res.cargas.n ? saldoCartoes : null, totalCred: r2(itens.filter(i => i.valor > 0).reduce((s, i) => s + i.valor, 0)), totalDeb: r2(-itens.filter(i => i.valor < 0).reduce((s, i) => s + i.valor, 0)),
    confere: true, itens };
}

export async function lerVExpenses(buf, nome = '', pdfjs) {
  if (!/\.pdf$/i.test(nome)) throw new Error('Envie o PDF do "Extrato de Pagamentos" exportado da VExpenses.');
  return interpretarVExpenses(await linhasPdf(buf, pdfjs));
}

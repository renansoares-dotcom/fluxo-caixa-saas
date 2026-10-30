// Relatórios de faturamento (saídas) e de compras (entradas) a partir dos itens das notas importadas.
// Faturamento = vendas (−) devoluções de clientes; Compras = compras (−) devoluções a fornecedores. Canceladas ficam fora.
// Nas notas de terceiros o CFOP é o do emitente (a operação vista por quem emitiu): a venda do fornecedor é a nossa compra
// e a devolução de compra do cliente é a nossa devolução de venda.

const rng = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
// finais de CFOP (3 últimos dígitos)
const VENDA = new Set([...rng(101, 125), '401', '402', '403', '405', '501', '502']);           // 5.101–5.125, ST, exportação via trading
const DEV_DE_COMPRA = new Set([...rng(201, 210), '410', '411', '412', '413', '553', '555', '556']);
const DEV_DE_VENDA_E = new Set(['201', '202', '203', '204', '410', '411', '503', '504']);    // entradas 1.201/2.201…
const COMPRA_E = new Set([...rng(101, 128), ...rng(401, 408), '551', '556', ...rng(251, 257), ...rng(301, 306), ...rng(351, 360)]);

export const CLASSES = { venda: 'Venda', dev_venda: 'Devolução de cliente', compra: 'Compra', dev_compra: 'Devolução a fornecedor', outra_saida: 'Outra saída', outra_entrada: 'Outra entrada' };

/** classe da operação pelo CFOP, vista pela empresa */
export function classificar(cfop, nota) {
  const c = String(cfop || ''), f = c.slice(1), saida = /^[567]/.test(c);
  if (nota.emissao_propria) {
    if (saida) return VENDA.has(f) ? 'venda' : DEV_DE_COMPRA.has(f) ? 'dev_compra' : 'outra_saida';
    return DEV_DE_VENDA_E.has(f) ? 'dev_venda' : COMPRA_E.has(f) ? 'compra' : 'outra_entrada';
  }
  if (saida) return VENDA.has(f) ? 'compra' : DEV_DE_COMPRA.has(f) ? 'dev_venda' : 'outra_entrada';
  return 'outra_entrada';
}

const n = (v) => +v || 0;
const r2 = (v) => Math.round(v * 100) / 100;
/** valor contábil do item (com IPI e ST) */
export const valorItem = (i) => r2(n(i.vprod) - n(i.vdesc) + n(i.vfrete) + n(i.vseg) + n(i.voutro) + n(i.v_ipi) + n(i.v_st));
export const impostosItem = (i) => r2(n(i.v_icms) + n(i.v_st) + n(i.v_ipi) + n(i.v_pis) + n(i.v_cofins));

// notas de terceiros não trazem a UF do emitente gravada: a origem sai do 1º dígito do CFOP (1/5 = mesmo estado da empresa)
const origem = (cfop, ufEmpresa) => ({ 1: ufEmpresa || 'Mesmo estado', 5: ufEmpresa || 'Mesmo estado', 2: 'Outros estados', 6: 'Outros estados', 3: 'Exterior', 7: 'Exterior' })[String(cfop || '')[0]] || '—';
export const AGRUPAR = {
  mes: { faturamento: 'Mês', compras: 'Mês' },
  parte: { faturamento: 'Cliente', compras: 'Fornecedor' },
  produto: { faturamento: 'Produto', compras: 'Item comprado' },
  uf: { faturamento: 'UF do cliente', compras: 'Origem' },
  cfop: { faturamento: 'CFOP', compras: 'CFOP' },
};

/** linhas planas: um registro por item, com a classe, o mês e as chaves de agrupamento */
export function linhas(itens, ufEmpresa = '') {
  const out = [];
  for (const i of itens) {
    const nt = i.nfe_notas || i.n; if (!nt) continue;
    const doc = nt.emissao_propria ? nt.dest_doc : nt.emit_doc, nome = (nt.emissao_propria ? nt.dest_nome : nt.emit_nome) || '—';
    out.push({ classe: nt.situacao === 'autorizada' ? classificar(i.cfop, nt) : 'cancelada', nota_id: nt.id, emissao: nt.emissao, mes: nt.emissao.slice(0, 7),
      parte: doc ? `${nome} · ${doc}` : nome, produto: `${i.cprod || '—'} · ${i.xprod || ''}`.trim(), ucom: i.ucom || '', qtd: n(i.qcom),
      uf: nt.emissao_propria ? (nt.dest_uf || '—') : origem(i.cfop, ufEmpresa),
      cfop: i.cfop || '—', valor: valorItem(i), impostos: impostosItem(i), icms: n(i.v_icms), ipi: n(i.v_ipi), pis_cofins: r2(n(i.v_pis) + n(i.v_cofins)) });
  }
  return out;
}

const CHAVE = { mes: (l) => l.mes, parte: (l) => l.parte, produto: (l) => l.produto, uf: (l) => l.uf, cfop: (l) => l.cfop };
/**
 * relatório agrupado. tipo 'faturamento' | 'compras'; agrupar = chave de AGRUPAR;
 * anterior = linhas do mesmo período do ano anterior (comparativo), deslocadas 12 meses quando por mês.
 */
export function relatorio(ls, { tipo = 'faturamento', agrupar = 'mes', anterior = null } = {}) {
  const [bruto, dev] = tipo === 'faturamento' ? ['venda', 'dev_venda'] : ['compra', 'dev_compra'];
  const chave = CHAVE[agrupar];
  const acum = (arr) => {
    const g = new Map();
    for (const l of arr) {
      if (l.classe !== bruto && l.classe !== dev) continue;
      const k = chave(l), r = g.get(k) || g.set(k, { chave: k, bruto: 0, dev: 0, impostos: 0, qtd: 0, ucom: new Set(), notas: new Set(), notasDev: new Set() }).get(k);
      if (l.classe === bruto) { r.bruto += l.valor; r.impostos += l.impostos; r.qtd += l.qtd; if (l.ucom) r.ucom.add(l.ucom); r.notas.add(l.nota_id); }
      else { r.dev += l.valor; r.impostos -= l.impostos; r.qtd -= l.qtd; r.notasDev.add(l.nota_id); }
    }
    return g;
  };
  const g = acum(ls);
  const ga = anterior ? acum(agrupar === 'mes' ? anterior.map(l => ({ ...l, mes: `${+l.mes.slice(0, 4) + 1}${l.mes.slice(4)}` })) : anterior) : null;
  let rows = [...g.values()].map(r => ({ chave: r.chave, bruto: r2(r.bruto), dev: r2(r.dev), liquido: r2(r.bruto - r.dev), impostos: r2(r.impostos), qtd: Math.round(r.qtd * 1000) / 1000,
    ucom: r.ucom.size === 1 ? [...r.ucom][0] : '', notas: r.notas.size, notasDev: r.notasDev.size, ticket: r.notas.size ? r2(r.bruto / r.notas.size) : null }));
  if (ga) for (const [k, r] of ga) if (!g.has(k)) rows.push({ chave: k, bruto: 0, dev: 0, liquido: 0, impostos: 0, qtd: 0, ucom: '', notas: 0, notasDev: 0, ticket: null });
  for (const r of rows) {
    if (!ga) continue;
    const a = ga.get(r.chave); r.anterior = a ? r2(a.bruto - a.dev) : 0;
    r.variacao = r.anterior ? (r.liquido - r.anterior) / Math.abs(r.anterior) : null;
  }
  const T = rows.reduce((t, r) => ({ bruto: t.bruto + r.bruto, dev: t.dev + r.dev, liquido: t.liquido + r.liquido, impostos: t.impostos + r.impostos, anterior: t.anterior + (r.anterior || 0) }), { bruto: 0, dev: 0, liquido: 0, impostos: 0, anterior: 0 });
  for (const f of Object.keys(T)) T[f] = r2(T[f]);
  const notas = new Set(ls.filter(l => l.classe === bruto).map(l => l.nota_id)), notasDev = new Set(ls.filter(l => l.classe === dev).map(l => l.nota_id));
  T.notas = notas.size; T.notasDev = notasDev.size; T.ticket = notas.size ? r2(T.bruto / notas.size) : null;
  T.variacao = ga && T.anterior ? (T.liquido - T.anterior) / Math.abs(T.anterior) : null;
  const canc = ls.filter(l => l.classe === 'cancelada'); T.canceladas = new Set(canc.map(l => l.nota_id)).size; T.vCanceladas = r2(canc.reduce((s, l) => s + l.valor, 0));
  const outras = ls.filter(l => l.classe === (tipo === 'faturamento' ? 'outra_saida' : 'outra_entrada')); T.vOutras = r2(outras.reduce((s, l) => s + l.valor, 0)); T.notasOutras = new Set(outras.map(l => l.nota_id)).size;
  if (agrupar === 'mes') rows.sort((a, b) => a.chave.localeCompare(b.chave));
  else { rows.sort((a, b) => b.liquido - a.liquido); abc(rows, T.liquido); }
  for (const r of rows) r.part = T.liquido ? r.liquido / T.liquido : null;
  return { rows, total: T, tipo, agrupar };
}

/** curva ABC sobre o líquido: A até 80% acumulado, B até 95%, C o resto (a linha entra na classe em que o acumulado anterior a ela está) */
export function abc(rows, tot) {
  let ac = 0;
  for (const r of rows) {
    const antes = tot > 0 ? ac / tot : 1;
    r.classe = r.liquido <= 0 ? '—' : antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C';
    ac += Math.max(0, r.liquido); r.acumulado = tot > 0 ? ac / tot : null;
  }
  return rows;
}

/** mesmo período no ano anterior */
export const anoAnterior = (iso) => { const [a, m, d] = iso.split('-').map(Number); const ult = new Date(Date.UTC(a - 1, m, 0)).getUTCDate(); return `${a - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`; };

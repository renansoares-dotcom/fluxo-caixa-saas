// Mapa comparativo de cotações (melhoria 5.2, SQL 132) — regras puras: parcelas, valor presente e o melhor por total,
// por valor presente e por item.

/** "28/42/56" ou "28, 42" → [28, 42, 56]; à vista = [0] */
export function parseParcelas(txt) {
  const t = String(txt ?? '').toLowerCase().trim();
  if (!t) return [];
  if (/vista/.test(t)) return [0];
  return t.split(/[^\d]+/).filter(Boolean).map(Number).filter(n => n >= 0 && n <= 720).slice(0, 24);
}
/** valor presente das parcelas iguais, com a taxa mensal em % (dias / 30 meses) */
export function valorPresente(valor, parcelas = [28], taxaMensal = 1.5) {
  const P = parcelas.length ? parcelas : [0], i = (+taxaMensal || 0) / 100, cada = valor / P.length;
  return Math.round(P.reduce((s, d) => s + cada / (1 + i) ** (d / 30), 0) * 100) / 100;
}
/** monta o mapa: preço de cada item por cotação, o menor de cada item, totais, valor presente e as melhores opções */
export function mapaCotacoes(itens, cots, citens, { taxa = 1.5 } = {}) {
  const preco = (c, i) => { const x = citens.find(z => z.cotacao_id === c.id && z.requisicao_item_id === i.id); return x ? +x.valor_unitario : null; };
  const linhas = itens.map(i => { const p = cots.map(c => preco(c, i)), val = p.filter(v => v != null), min = val.length ? Math.min(...val) : null;
    return { item: i, precos: p, min, idxMin: min == null ? [] : p.map((v, k) => (v === min ? k : -1)).filter(k => k >= 0) }; });
  const C = cots.map((c, k) => { const n = linhas.filter(l => l.precos[k] != null).length, mercadoria = linhas.reduce((s, l) => s + (l.precos[k] ?? 0) * +l.item.quantidade, 0);
    const total = Math.round((mercadoria + +(c.frete || 0)) * 100) / 100;
    return { id: c.id, fornecedor: c.fornecedor, total, frete: +(c.frete || 0), completa: n === itens.length, itens: n, prazo: c.prazo_entrega_dias ?? null, vp: valorPresente(total, c.parcelas_dias || [28], taxa) }; });
  const comp = C.filter(c => c.completa);
  const melhorTotal = comp.length ? comp.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  const melhorVP = comp.length ? comp.reduce((a, b) => (b.vp < a.vp ? b : a)) : null;
  // o menor preço de cada item (sem o frete): quanto se economizaria dividindo a compra
  const porItem = linhas.every(l => l.min != null) ? Math.round(linhas.reduce((s, l) => s + l.min * +l.item.quantidade, 0) * 100) / 100 : null;
  return { linhas, cots: C, melhorTotal, melhorVP, porItem, economiaDividir: porItem != null && melhorTotal ? Math.round((melhorTotal.total - melhorTotal.frete - porItem) * 100) / 100 : null };
}

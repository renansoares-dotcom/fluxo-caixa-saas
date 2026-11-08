// IQF do fornecedor (melhoria 5.6): apresentação e a mesma ponderação do banco (compras_iqf, SQL 134).

export const DIMENSOES = { qualidade: 'Qualidade', entrega: 'Entrega', preco: 'Preço e nota' };
export const CLASSES = {
  A: ['A', 'pos', 'Fornecedor de referência'], B: ['B', '', 'Dentro da meta'], C: ['C', 'neg', 'Abaixo da meta: pedir plano de ação'],
  N: ['—', 'muted', 'Poucos dados no período'],
};

// média ponderada só das dimensões com dado (os pesos das outras são reponderados)
export function ponderar(notas = {}, pesos = {}) {
  let s = 0, w = 0;
  for (const k of Object.keys(DIMENSOES)) {
    const n = notas[k], p = +(pesos[k] ?? 0);
    if (n == null || !(p > 0)) continue;
    s += n * p; w += p;
  }
  return w ? Math.round((s / w) * 10) / 10 : null;
}

export function classe(iqf, eventos, par = {}) {
  if (iqf == null || eventos < (par.iqf_min_eventos ?? 3)) return 'N';
  if (iqf >= (par.iqf_faixa_a ?? 90)) return 'A';
  return iqf >= (par.iqf_meta ?? 80) ? 'B' : 'C';
}

export const notaAtraso = (dias, tol = 2, pts = 10) => Math.max(0, 100 - Math.max(0, dias - tol) * pts);

export function selo(f) {
  if (!f) return '<span class="small muted" title="Sem histórico de compras com este fornecedor no período">sem histórico</span>';
  const [rot, cls, tit] = CLASSES[f.classe] || CLASSES.N;
  return `<span class="badge ${cls === 'pos' ? 'pago' : cls === 'neg' ? 'vencido' : ''}" title="${tit}">IQF ${f.iqf == null ? '–' : String(f.iqf).replace('.', ',')} · ${rot}</span>`;
}

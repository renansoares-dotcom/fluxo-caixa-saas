// Cobrança (melhoria 3.3): aging dos títulos em aberto por faixa de atraso, por cliente ou fornecedor.
// Funções puras (testes em tests/cobranca-calc.test.js).

export const FAIXAS = [
  { k: 'vencer', nome: 'A vencer', de: -Infinity, ate: 0 },
  { k: 'd15', nome: '1 a 15 dias', de: 1, ate: 15 },
  { k: 'd30', nome: '16 a 30', de: 16, ate: 30 },
  { k: 'd60', nome: '31 a 60', de: 31, ate: 60 },
  { k: 'd90', nome: '61 a 90', de: 61, ate: 90 },
  { k: 'm90', nome: 'Mais de 90', de: 91, ate: Infinity }];

export const diasAtraso = (venc, hoje) => Math.round((Date.parse(hoje + 'T12:00:00Z') - Date.parse(String(venc).slice(0, 10) + 'T12:00:00Z')) / 864e5);
export const faixaDe = (dias) => FAIXAS.find(f => dias >= f.de && dias <= f.ate).k;

/** títulos: {favorecido_id, favorecido_nome, data, valor}. Devolve totais por faixa, por pessoa (ordem: maior vencido) e indicadores. */
export function aging(titulos, hoje) {
  const tot = Object.fromEntries(FAIXAS.map(f => [f.k, 0])), pes = new Map();
  let somaDias = 0, vencido = 0;
  for (const t of titulos) {
    const d = diasAtraso(t.data, hoje), k = faixaDe(d), v = Math.abs(+t.valor || 0);
    tot[k] += v;
    if (d > 0) { vencido += v; somaDias += d * v; }
    const id = t.favorecido_id || 'sem';
    if (!pes.has(id)) pes.set(id, { id, nome: t.favorecido_nome || '(sem favorecido)', total: 0, vencido: 0, maior: 0, n: 0, ...Object.fromEntries(FAIXAS.map(f => [f.k, 0])) });
    const p = pes.get(id); p[k] += v; p.total += v; p.n++; if (d > 0) { p.vencido += v; p.maior = Math.max(p.maior, d); }
  }
  const total = Object.values(tot).reduce((a, b) => a + b, 0);
  return { faixas: FAIXAS.map(f => ({ ...f, valor: tot[f.k], pct: total ? tot[f.k] / total : 0 })), total, vencido,
    pctVencido: total ? vencido / total : 0, atrasoMedio: vencido ? somaDias / vencido : 0,
    pessoas: [...pes.values()].sort((a, b) => b.vencido - a.vencido || b.total - a.total) };
}

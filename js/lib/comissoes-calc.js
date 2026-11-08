// Comissões (melhoria 4.3, SQL 130) — regras puras para as telas: totais e meses.
export const MES = (d) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** primeiro dia dos últimos n meses, do mais recente para o mais antigo, a partir de uma data */
export function competencias(hoje, n = 12) {
  const out = []; let y = +hoje.slice(0, 4), m = +hoje.slice(5, 7);
  for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, '0')}-01`); m--; if (!m) { m = 12; y--; } }
  return out;
}
/** totais dos itens: recebido, base, comissão, estornos e quantos com redução por atraso */
export function totais(itens = []) {
  const t = { recebido: 0, base: 0, comissao: 0, estornos: 0, n: itens.length, reduzidos: 0 };
  for (const i of itens) { t.recebido += +i.valor_recebido; t.base += +i.base; t.comissao += +i.comissao; if (i.tipo === 'estorno') t.estornos += +i.comissao; if (+i.reducao_pct > 0) t.reduzidos++; }
  for (const k of ['recebido', 'base', 'comissao', 'estornos']) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}
/** o mês já terminou (pode ser fechado)? */
export const mesTerminou = (comp, hoje) => comp.slice(0, 7) < hoje.slice(0, 7);

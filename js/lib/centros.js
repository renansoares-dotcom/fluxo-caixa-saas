// Centros de custo em níveis (melhoria 9.5): árvore, caminho e totais por nível.

const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
const ord = (a, b) => String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true }) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');

/** lista plana -> lista em ordem de árvore com prof (0 = raiz) e filhos (quantidade) */
export function arvore(lista) {
  const filhos = new Map(); const ids = new Set(lista.map(c => c.id));
  for (const c of lista) { const p = c.pai_id && ids.has(c.pai_id) ? c.pai_id : null; (filhos.get(p) || filhos.set(p, []).get(p)).push(c); }
  const out = [];
  const anda = (p, prof) => { for (const c of (filhos.get(p) || []).sort(ord)) { out.push({ ...c, prof, filhos: (filhos.get(c.id) || []).length }); anda(c.id, prof + 1); } };
  anda(null, 0);
  return out;
}

/** "ADMINISTRATIVO › TI › SUPORTE" */
export function caminho(id, mapa, sep = ' › ') {
  const out = []; let x = mapa.get(id), n = 0;
  while (x && n++ < 10) { out.unshift(x.nome); x = x.pai_id ? mapa.get(x.pai_id) : null; }
  return out.join(sep);
}

/** ids da subárvore (inclui o próprio) */
export function subarvore(id, lista) {
  const out = new Set([id]); let mudou = true;
  while (mudou) { mudou = false; for (const c of lista) if (c.pai_id && out.has(c.pai_id) && !out.has(c.id)) { out.add(c.id); mudou = true; } }
  return out;
}

/**
 * linhas do cc_resultado [{cc_id, receitas, despesas, rateio_recebido, rateio_enviado}] -> por nó da árvore:
 * próprio (só o centro) e total (centro + descendentes); resultado = receitas − despesas − recebido + enviado
 */
export function totaisArvore(linhas, lista) {
  const A = arvore(lista), por = new Map(linhas.filter(l => l.cc_id).map(l => [l.cc_id, l]));
  const z = () => ({ receitas: 0, despesas: 0, rateio_recebido: 0, rateio_enviado: 0 });
  const res = (t) => r2(t.receitas - t.despesas - t.rateio_recebido + t.rateio_enviado);
  const nos = A.map(c => { const p = por.get(c.id) || z(); const proprio = { receitas: +p.receitas || 0, despesas: +p.despesas || 0, rateio_recebido: +p.rateio_recebido || 0, rateio_enviado: +p.rateio_enviado || 0 };
    return { ...c, proprio, total: { ...proprio } }; });
  const mapa = new Map(nos.map(n => [n.id, n]));
  // soma de baixo para cima (a lista está em pré-ordem: percorre ao contrário)
  for (let i = nos.length - 1; i >= 0; i--) { const n = nos[i], p = n.pai_id && mapa.get(n.pai_id); if (p) for (const k of Object.keys(p.total)) p.total[k] = r2(p.total[k] + n.total[k]); }
  for (const n of nos) { n.proprio.resultado = res(n.proprio); n.total.resultado = res(n.total); }
  const sem = linhas.find(l => !l.cc_id);
  const geral = z(); for (const n of nos) if (!n.pai_id || !mapa.has(n.pai_id)) for (const k of Object.keys(geral)) geral[k] = r2(geral[k] + n.total[k]);
  const semCentro = sem ? { receitas: +sem.receitas || 0, despesas: +sem.despesas || 0 } : { receitas: 0, despesas: 0 };
  return { nos, geral: { ...geral, resultado: res(geral) }, semCentro: { ...semCentro, resultado: r2(semCentro.receitas - semCentro.despesas) } };
}

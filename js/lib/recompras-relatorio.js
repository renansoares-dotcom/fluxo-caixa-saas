// Corpo do Relatório de Recompras em PDF (FIN021). Sem DOM: recebe as recompras já filtradas e devolve o HTML das seções.
// 1. Resumo  2. Por motivo  3. Por fundo  4. Substituições (com a diferença que fica de custo)  5. Recompras  6. Taxa de recompra no ano

const SIT = (x, hoje) => x.cancelada ? 'cancelada'
  : x.titulo_acao === 'substituir' ? `substituído${x.titulo_novo_doc ? ' por ' + x.titulo_novo_doc : ''}`
  : !x.lanc_reaberto_id ? (x.titulo_acao === 'baixar' ? 'não volta (devolução)' : 'não volta')
  : x.reaberto_status === 'Pago' ? `recebido ${x.recebido_em || ''}` : (x.reaberto_venc && x.reaberto_venc < hoje ? 'vencido' : 'em aberto');

/** agrupa somando qtd, título, encargos e recompra */
export function agrupar(V, chave) {
  const g = new Map();
  for (const x of V) {
    const k = chave(x) || '—', a = g.get(k) || { nome: k, qtd: 0, titulo: 0, encargos: 0, recompra: 0 };
    a.qtd++; a.titulo += +x.valor_titulo || 0; a.encargos += +x.encargos || 0; a.recompra += +x.valor_recompra || 0; g.set(k, a);
  }
  return [...g.values()].sort((a, b) => b.recompra - a.recompra);
}

/** substituições com o valor do título novo e a diferença (positiva = custo da empresa) */
export function substituicoes(V, novos = {}) {
  return V.filter(x => !x.cancelada && x.titulo_acao === 'substituir').map(x => {
    const novo = x.titulo_novo_id != null && novos[x.titulo_novo_id] != null ? +novos[x.titulo_novo_id] : null;
    return { ...x, valor_novo: novo, diferenca: novo == null ? null : Math.round((+x.valor_titulo - novo) * 100) / 100 };
  });
}

export function relatorioRecompras(V, { novos = {}, resumo = null, ano, esc, money, pct, dateBR, hoje = new Date().toISOString().slice(0, 10) }) {
  const at = V.filter(x => !x.cancelada), soma = (L, k) => L.reduce((s, x) => s + (+x[k] || 0), 0);
  const tot = { qtd: at.length, titulo: soma(at, 'valor_titulo'), encargos: soma(at, 'encargos'), recompra: soma(at, 'valor_recompra') };
  const tab = (cab, linhas, rod = '') => `<table><thead><tr>${cab.map(([t, n]) => `<th${n ? ' class="n"' : ''}>${t}</th>`).join('')}</tr></thead><tbody>${linhas || `<tr><td colspan="${cab.length}">Nenhuma.</td></tr>`}</tbody>${rod ? `<tfoot>${rod}</tfoot>` : ''}</table>`;
  const grupo = (G, rot) => tab([[rot, 0], ['Qtd.', 1], ['Valor dos títulos', 1], ['Encargos', 1], ['Recompra', 1], ['%', 1]],
    G.map(g => `<tr><td>${esc(g.nome)}</td><td class="n">${g.qtd}</td><td class="n">${money(g.titulo)}</td><td class="n">${money(g.encargos)}</td><td class="n">${money(g.recompra)}</td><td class="n">${tot.recompra ? pct(g.recompra / tot.recompra) : '–'}</td></tr>`).join(''),
    `<tr><th>Total</th><th class="n">${tot.qtd}</th><th class="n">${money(tot.titulo)}</th><th class="n">${money(tot.encargos)}</th><th class="n">${money(tot.recompra)}</th><th class="n">${tot.recompra ? '100%' : '–'}</th></tr>`);
  const S = substituicoes(V, novos), dif = S.reduce((s, x) => s + (x.diferenca || 0), 0);
  let n = 0; const h = (t) => `<h2>${++n}. ${t}</h2>`;
  const out = [];
  out.push(h('Resumo'), `<p>${tot.qtd} recompra(s) no período, ${money(tot.recompra)} pagos aos fundos: ${money(tot.titulo)} de títulos e ${money(tot.encargos)} de encargos.${S.length ? ` ${S.length} título(s) substituído(s), com ${money(dif)} de diferença a menor (custo da empresa).` : ''}${V.length > at.length ? ` ${V.length - at.length} cancelada(s) listada(s), fora dos totais.` : ''}</p>`);
  out.push(h('Por motivo'), grupo(agrupar(at, x => x.motivo_nome || 'sem motivo'), 'Motivo'));
  out.push(h('Por fundo'), grupo(agrupar(at, x => x.fundo), 'Fundo'));
  if (S.length) out.push(h('Substituições'), tab([['Título recomprado', 0], ['Cliente', 0], ['Data', 0], ['Valor', 1], ['Título no lugar', 0], ['Valor', 1], ['Diferença', 1], ['Observação', 0]],
    S.map(x => `<tr><td>${esc(x.documento || '')}</td><td>${esc(x.cliente || '')}</td><td>${dateBR(x.data)}</td><td class="n">${money(x.valor_titulo)}</td><td>${esc(x.titulo_novo_doc || '')}</td>
      <td class="n">${x.valor_novo == null ? '–' : money(x.valor_novo)}</td><td class="n">${x.diferenca == null ? '–' : money(x.diferenca)}</td><td>${esc(x.observacao || '')}</td></tr>`).join(''),
    `<tr><th colspan="3">Total</th><th class="n">${money(soma(S, 'valor_titulo'))}</th><th></th><th class="n">${money(S.reduce((s, x) => s + (x.valor_novo || 0), 0))}</th><th class="n">${money(dif)}</th><th></th></tr>`),
    '<p>Diferença positiva: o título que entrou no lugar vale menos que o recomprado. Na DRE Gerencial, a recompra entra em deduções da receita e o título novo, como venda; o líquido entre os dois é a perda.</p>');
  out.push(h('Recompras'), tab([['Nº', 1], ['Data', 0], ['Fundo', 0], ['Título', 0], ['Cliente', 0], ['Motivo', 0], ['Título', 1], ['Encargos', 1], ['Recompra', 1], ['Situação do título', 0]],
    V.slice().sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.numero - b.numero)).map(x => `<tr><td class="n">${x.numero}</td><td>${dateBR(x.data)}</td><td>${esc(x.fundo || '')}</td><td>${esc(x.documento || '')}</td><td>${esc(x.cliente || '')}</td>
      <td>${esc(x.motivo_nome || 'sem motivo')}${x.nota_numero ? ` (NF-e ${x.nota_numero})` : ''}</td><td class="n">${money(x.valor_titulo)}</td><td class="n">${money(x.encargos)}</td><td class="n">${money(x.valor_recompra)}</td><td>${esc(SIT(x, hoje))}</td></tr>`).join('')));
  if (resumo && (+resumo.cedido || +resumo.recomprado)) {
    const tx = (r, c) => (+c ? pct(+r / +c) : '–');
    out.push(h(`Taxa de recompra em ${ano}`), `<p>${money(resumo.recomprado)} recomprados de ${money(resumo.cedido)} cedidos: ${tx(resumo.recomprado, resumo.cedido)}.</p>`,
      tab([['Fundo', 0], ['Cedido', 1], ['Recomprado', 1], ['Taxa', 1]], (resumo.fundos || []).filter(f => +f.cedido || +f.recomprado).map(f => `<tr><td>${esc(f.fundo || '—')}</td><td class="n">${money(f.cedido)}</td><td class="n">${money(f.recomprado)}</td><td class="n">${tx(f.recomprado, f.cedido)}</td></tr>`).join('')),
      tab([['Cliente', 0], ['Motivos', 0], ['Cedido', 1], ['Recomprado', 1], ['Taxa', 1]], (resumo.clientes || []).slice(0, 15).map(c => `<tr><td>${esc(c.cliente || '—')}</td><td>${esc(c.motivos || '')}</td><td class="n">${money(c.cedido)}</td><td class="n">${money(c.recomprado)}</td><td class="n">${tx(c.recomprado, c.cedido)}</td></tr>`).join('')));
  }
  return out.join('');
}

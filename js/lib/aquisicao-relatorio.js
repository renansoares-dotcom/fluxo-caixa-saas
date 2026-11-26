// Relatórios da compra inteligente (SQL 199): mapa de uma requisição por custo líquido e o resumo do período para a direção.
// Sem DOM: recebe os dados já calculados (aquisicao.js) e devolve as seções no padrão de relatórios da plataforma.
import { DESTINACOES, REGIMES_FORN, fmt } from './aquisicao.js';

const DEST = Object.fromEntries(DESTINACOES), REG = Object.fromEntries(REGIMES_FORN);
const tab = (cab, linhas) => `<table><thead><tr>${cab.map(([t, n]) => `<th${n ? ' class="n"' : ''}>${t}</th>`).join('')}</tr></thead><tbody>${linhas || `<tr><td colspan="${cab.length}">Nenhum registro.</td></tr>`}</tbody></table>`;

/** mapa de uma requisição: preço, desembolso, créditos, custo líquido, PRODEPE, reforma e memória por item */
export function relatorioMapa(r, cots, citens, M, ML, RF, BF, div, o) {
  const { esc, money, dateBR } = o; let n = 0; const h = (t) => `<h2>${++n}. ${t}</h2>`, out = [];
  const L = (c) => ML.cots.find(x => x.id === c.id), mc = (c) => M.cots.find(x => x.id === c.id) || {};
  out.push(h('Requisição'), `<p>Nº ${r.numero}${r.solicitante ? `, pedida por ${esc(r.solicitante)}` : ''}${r.necessidade ? `, para ${dateBR(r.necessidade)}` : ''}. ${r.itens.length} item(ns); ${cots.length} cotação(ões).</p>`,
    tab([['Item', 0], ['Quant.', 1], ['NCM', 0], ['Destinação', 0]], r.itens.map(i => `<tr><td>${esc(i.descricao)}</td><td class="n">${(+i.quantidade).toLocaleString('pt-BR')} ${esc(i.unidade)}</td><td>${esc(i.ncm || '')}</td><td>${esc(DEST[i.destinacao || 'insumo'])}</td></tr>`).join('')));
  out.push(h('Fornecedores e condições'), tab([['Fornecedor', 0], ['UF', 0], ['Regime', 0], ['Prazo de entrega', 1], ['Pagamento', 0], ['Frete', 1]],
    cots.map(c => `<tr><td>${esc(c.fornecedor)}${c.escolhida ? ' (escolhida)' : ''}</td><td>${esc(c.uf || '—')}</td><td>${esc(REG[c.regime] || '—')}${c.regime === 'simples' || c.regime === 'mei' ? ` · crédito ${fmt(c.simples_credito_pct)}%${c.simples_regular ? ` · regime regular: ${esc(c.simples_regular)}` : ''}` : ''}</td>
      <td class="n">${c.prazo_entrega_dias != null ? c.prazo_entrega_dias + ' dias' : '–'}</td><td>${esc(c.condicao_pagamento || (c.parcelas_dias || []).join('/'))}</td><td class="n">${money(c.frete)}</td></tr>`).join('')));
  const f = BF.P.fator_icms;
  out.push(h('Comparação: preço × custo líquido'), tab([['Fornecedor', 0], ['Total pelo preço', 1], ['Desembolso', 1], ['Créditos', 1], ['Custo líquido', 1], ['Custo líquido a VP', 1], ...(f < 1 ? [['Com o PRODEPE', 1]] : [])],
    cots.map(c => { const x = L(c); return `<tr><td>${esc(c.fornecedor)}${x.completa ? '' : ' (incompleta)'}</td><td class="n">${money(mc(c).total)}</td><td class="n">${money(x.desembolso)}</td><td class="n">${money(-x.creditos)}</td>
      <td class="n">${money(x.custo)}</td><td class="n">${money(x.custoVp)}</td>${f < 1 ? `<td class="n">${money(x.custoEfVp)}</td>` : ''}</tr>`; }).join('')),
  `<p>${ML.melhorPreco && ML.melhorLiq && ML.melhorPreco.id !== ML.melhorLiq.id ? `Pelo preço, a melhor cotação é ${esc(ML.melhorPreco.fornecedor)}; pelo custo líquido, é ${esc(ML.melhorLiq.fornecedor)}, ${money(ML.ganho)} a menos.`
    : ML.melhorLiq ? `A melhor cotação pelo custo líquido é ${esc(ML.melhorLiq.fornecedor)}.` : 'Não há cotação completa para comparar.'}
    ${f < 1 ? ` Com o crédito presumido do PRODEPE calculado sobre o saldo devedor, cada R$ 1,00 de crédito de ICMS reduz o imposto em cerca de R$ ${fmt(f)}; por essa leitura, a melhor é ${esc(ML.melhorEf?.fornecedor || '—')}.` : ''}</p>`);
  if (div?.length) out.push(h('Pontos a confirmar com os fornecedores'), `<ul>${div.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`);
  if (RF?.length) out.push(h('Simulação da reforma tributária'), tab([['Ano', 0], ['ICMS', 1], ['CBS+IBS', 1], ...cots.map(c => [esc(c.fornecedor), 1])],
    RF.map(a => `<tr><td>${a.ano}</td><td class="n">${fmt(a.icms_pct)}%</td><td class="n">${fmt(a.t)}%</td>${cots.map(c => `<td class="n">${money(a.cots.find(z => z.id === c.id)?.custo)}${a.melhor === c.id ? ' *' : ''}</td>`).join('')}</tr>`).join('')),
    `<p>* menor custo líquido do ano. Mesmos preços; ICMS reduzido na transição, IPI e PIS/COFINS zerados, CBS/IBS por fora com crédito integral; o fornecedor do Simples que não optar pelo regime regular transfere só o crédito estimado (${fmt(BF.P.simples_credito_ibs_pct)}% do preço).</p>`);
  out.push(h('Memória de cálculo por item'), ...cots.filter(c => L(c).completa || Object.keys(L(c).porItem).length).map(c => `<p><b>${esc(c.fornecedor)}</b></p>` + r.itens.filter(i => L(c).porItem[i.id]).map(i =>
    tab([[`${esc(i.descricao)} — R$ por ${esc(i.unidade)}`, 0], ['Valor', 1]], L(c).porItem[i.id].linhas.map(l => `<tr><td>${esc(l.txt)}${l.obs ? ` <span class="muted">(${esc(l.obs)})</span>` : ''}</td><td class="n">${money(l.v)}</td></tr>`).join(''))).join('')));
  return out.join('');
}

/**
 * Resumo do período para a direção. A: [{ r, cots, ML, escolhida }]
 */
export function relatorioPeriodo(A, o) {
  const { esc, money, dateBR } = o; let n = 0; const h = (t) => `<h2>${++n}. ${t}</h2>`, out = [];
  const comEsc = A.filter(a => a.escolhida), L = (a, c) => a.ML.cots.find(x => x.id === c?.id);
  const soma = (f) => comEsc.reduce((s, a) => s + (f(a) || 0), 0);
  const desemb = soma(a => L(a, a.escolhida)?.desembolso), cred = soma(a => L(a, a.escolhida)?.creditos), liq = soma(a => L(a, a.escolhida)?.custo);
  const certas = comEsc.filter(a => a.ML.melhorLiq && a.ML.melhorLiq.id === a.escolhida.id);
  const ganho = certas.reduce((s, a) => s + (a.ML.melhorPreco && a.ML.melhorPreco.id !== a.escolhida.id ? a.ML.ganho : 0), 0);
  const perdas = comEsc.filter(a => a.ML.melhorLiq && a.ML.melhorLiq.id !== a.escolhida.id && L(a, a.escolhida)?.completa)
    .map(a => ({ a, dif: (L(a, a.escolhida).custoVp - a.ML.melhorLiq.custoVp) })).filter(x => x.dif > 0.005);
  out.push(h('Resumo'), `<p>${A.length} requisição(ões) com cotação no período; ${comEsc.length} com a cotação escolhida. Nas escolhidas: desembolso de ${money(desemb)}, créditos de ${money(cred)} (${desemb ? fmt(cred / desemb * 100) : '0'}% do desembolso) e custo líquido de ${money(liq)}.
    ${certas.length} de ${comEsc.length} escolhas foram pelo menor custo líquido${ganho > 0.005 ? `, com ${money(ganho)} de economia em relação ao menor preço` : ''}.${perdas.length ? ` Em ${perdas.length} compra(s), a escolha ficou ${money(perdas.reduce((s, x) => s + x.dif, 0))} acima da melhor pelo custo líquido (veja a seção 3).` : ''}</p>`);
  out.push(h('Compras do período'), tab([['Req.', 1], ['Data', 0], ['Escolhida', 0], ['Menor preço', 0], ['Menor custo líquido', 0], ['Desembolso', 1], ['Créditos', 1], ['Custo líquido', 1]],
    A.map(a => { const x = L(a, a.escolhida); return `<tr><td class="n">${a.r.numero}</td><td>${dateBR(a.r.criado_em)}</td><td>${esc(a.escolhida?.fornecedor || '—')}</td><td>${esc(a.ML.melhorPreco?.fornecedor || '—')}</td><td>${esc(a.ML.melhorLiq?.fornecedor || '—')}</td>
      <td class="n">${x ? money(x.desembolso) : '–'}</td><td class="n">${x ? money(-x.creditos) : '–'}</td><td class="n">${x ? money(x.custo) : '–'}</td></tr>`; }).join('')));
  out.push(h('Escolhas acima do menor custo líquido'), perdas.length ? tab([['Req.', 1], ['Escolhida', 0], ['Melhor pelo custo líquido', 0], ['Diferença', 1]],
    perdas.map(({ a, dif }) => `<tr><td class="n">${a.r.numero}</td><td>${esc(a.escolhida.fornecedor)}</td><td>${esc(a.ML.melhorLiq.fornecedor)}</td><td class="n">${money(dif)}</td></tr>`).join('')) + '<p>Pode haver motivo (prazo, qualidade, pedido mínimo): vale registrar a justificativa na requisição.</p>'
    : '<p>Nenhuma: todas as escolhas ficaram no menor custo líquido.</p>');
  const sn = {}; for (const a of A) for (const c of a.cots) if (c.regime === 'simples' || c.regime === 'mei') { const k = c.fornecedor; sn[k] = sn[k] || { c, n: 0 }; sn[k].n++; }
  out.push(h('Fornecedores do Simples Nacional e a reforma'), Object.keys(sn).length ? tab([['Fornecedor', 0], ['Cotações', 1], ['Crédito de ICMS', 1], ['Vai recolher IBS/CBS pelo regime regular?', 0]],
    Object.values(sn).sort((a, b) => b.n - a.n).map(({ c, n: k }) => `<tr><td>${esc(c.fornecedor)}</td><td class="n">${k}</td><td class="n">${c.simples_credito_pct != null ? fmt(c.simples_credito_pct) + '%' : '–'}</td><td>${esc({ sim: 'Sim', nao: 'Não', avaliando: 'Avaliando' }[c.simples_regular] || 'Não informou')}</td></tr>`).join(''))
    + '<p>A partir de 2027, o fornecedor do Simples que continuar recolhendo tudo no Simples transfere pouco crédito de CBS/IBS. Vale conversar com os principais: pedir a opção pelo regime regular ou renegociar o preço.</p>'
    : '<p>Nenhum fornecedor do Simples nas cotações do período (ou o regime não foi informado).</p>');
  return out.join('');
}

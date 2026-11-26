// Relatórios da compra inteligente (SQL 199): mapa de uma requisição por custo líquido e o resumo do período para a direção.
// Sem DOM: recebe os dados já calculados (aquisicao.js) e devolve as seções no padrão de relatórios da plataforma.
import { DESTINACOES, REGIMES_FORN, fmt } from './aquisicao.js';

const DEST = Object.fromEntries(DESTINACOES), REG = Object.fromEntries(REGIMES_FORN);
const tab = (cab, linhas) => `<table><thead><tr>${cab.map(([t, n]) => `<th${n ? ' class="n"' : ''}>${t}</th>`).join('')}</tr></thead><tbody>${linhas || `<tr><td colspan="${cab.length}">Nenhum registro.</td></tr>`}</tbody></table>`;

/** mapa de uma requisição: preço, desembolso, créditos, custo líquido, PRODEPE, reforma e memória por item */
export function relatorioMapa(r, cots, citens, M, ML, RF, BF, div, o) {
  const { esc, money, dateBR } = o; let n = o.inicio || 0; const h = (t) => `<h2>${++n}. ${t}</h2>`, out = [];
  const L = (c) => ML.cots.find(x => x.id === c.id), mc = (c) => M.cots.find(x => x.id === c.id) || {};
  if (!o.semRequisicao) out.push(h('Requisição'), `<p>Nº ${r.numero}${r.solicitante ? `, pedida por ${esc(r.solicitante)}` : ''}${r.necessidade ? `, para ${dateBR(r.necessidade)}` : ''}. ${r.itens.length} item(ns); ${cots.length} cotação(ões).</p>`,
    tab([['Item', 0], ['Quant.', 1], ['NCM', 0], ['Destinação', 0]], r.itens.map(i => `<tr><td>${esc(i.descricao)}</td><td class="n">${(+i.quantidade).toLocaleString('pt-BR')} ${esc(i.unidade)}</td><td>${esc(i.ncm || '')}</td><td>${esc(DEST[i.destinacao || 'insumo'])}</td></tr>`).join('')));
  if (!o.semFornecedores) out.push(h('Fornecedores e condições'), tab([['Fornecedor', 0], ['UF', 0], ['Regime', 0], ['Prazo de entrega', 1], ['Pagamento', 0], ['Frete', 1]],
    cots.map(c => `<tr><td>${esc(c.fornecedor)}${c.escolhida ? ' (escolhida)' : ''}</td><td>${esc(c.uf || '—')}</td><td>${esc(REG[c.regime] || '—')}${c.regime === 'simples' || c.regime === 'mei' ? ` · crédito ${fmt(c.simples_credito_pct)}%${c.simples_regular ? ` · regime regular: ${esc(c.simples_regular)}` : ''}` : ''}</td>
      <td class="n">${c.prazo_entrega_dias != null ? c.prazo_entrega_dias + ' dias' : '–'}</td><td>${esc(c.condicao_pagamento || (c.parcelas_dias || []).join('/'))}</td><td class="n">${money(c.frete)}</td></tr>`).join('')));
  const f = BF.P.fator_icms;
  out.push(h('Comparação: preço × custo líquido'), tab([['Fornecedor', 0], ['Total pelo preço', 1], ['Desembolso', 1], ['Créditos', 1], ['Custo líquido', 1], ['Custo líquido a VP', 1], ...(f < 1 ? [['Com o PRODEPE', 1]] : [])],
    cots.map(c => { const x = L(c); return `<tr><td>${esc(c.fornecedor)}${x.completa ? '' : ' (incompleta)'}</td><td class="n">${money(mc(c).total)}</td><td class="n">${money(x.desembolso)}</td><td class="n">${money(x.creditos ? -x.creditos : 0)}</td>
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
      <td class="n">${x ? money(x.desembolso) : '–'}</td><td class="n">${x ? money(x.creditos ? -x.creditos : 0) : '–'}</td><td class="n">${x ? money(x.custo) : '–'}</td></tr>`; }).join('')));
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

const SIT_REQ = { pendente: 'Aguardando aprovação', aprovada: 'Aprovada', rejeitada: 'Rejeitada', cancelada: 'Cancelada', atendida: 'Atendida' };
const SIT_CONV = { enviado: 'Enviado', aberto: 'Abriu o link', respondido: 'Respondeu', recusado: 'Não vai cotar', cancelado: 'Cancelado' };

/**
 * Relatório completo de uma requisição: identificação, itens, mapa de preços, custo líquido (se houver cotação),
 * cotação por link e pedidos. d = { setor, cots, citens, M, ML, RF, BF, div, conv, peds, taxa, iqf }
 */
export function relatorioRequisicao(r, d, o) {
  const { esc, money, dateBR } = o; let n = 0; const h = (t) => `<h2>${++n}. ${t}</h2>`, out = [];
  const { cots = [], citens = [], M, conv = [], peds = [] } = d, est = r.itens.some(i => +i.valor_estimado);
  const q = (v) => (+v).toLocaleString('pt-BR', { maximumFractionDigits: 4 }), u = (v) => 'R$ ' + (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const pr = (c, i) => { const v = +citens.find(x => x.cotacao_id === c.id && x.requisicao_item_id === i.id)?.valor_unitario; return isNaN(v) ? null : v; };
  const mc = (c) => M?.cots.find(x => x.id === c.id) || {};
  out.push(h('Identificação'), tab([['Campo', 0], ['Informação', 0]], [
    ['Situação', (SIT_REQ[r.status] || r.status) + (r.prioridade === 'urgente' ? ' — urgente' : '')], ['Solicitante', r.solicitante || '—'], ['Setor', d.setor || '—'],
    ['Pedida em', dateBR(r.criado_em)], ['Precisa até', dateBR(r.necessidade) || '—'],
    ...(r.decidido_em ? [[r.status === 'rejeitada' ? 'Rejeitada em' : 'Aprovada em', dateBR(r.decidido_em)]] : []),
    ...(r.observacao ? [['Observação', r.observacao]] : []), ...(r.motivo ? [['Motivo', r.motivo]] : [])].map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')));
  out.push(h('Itens'), tab([['Item', 0], ['NCM', 0], ['Destinação', 0], ['Quant.', 1], ...(est ? [['Estimado (un.)', 1], ['Estimado (total)', 1]] : [])],
    r.itens.map(i => `<tr><td>${esc(i.descricao)}</td><td>${esc(i.ncm || '')}</td><td>${esc(DEST[i.destinacao || 'insumo'])}</td><td class="n">${q(i.quantidade)} ${esc(i.unidade || '')}</td>${est ? `<td class="n">${i.valor_estimado ? u(i.valor_estimado) : '–'}</td><td class="n">${i.valor_estimado ? money(i.valor_estimado * i.quantidade) : '–'}</td>` : ''}</tr>`).join('')));
  if (cots.length) {
    out.push(h('Mapa comparativo de cotações'), tab([['Item', 0], ['Quant.', 1], ...cots.map(c => [esc(c.fornecedor) + (c.escolhida ? ' (escolhida)' : ''), 1])],
      r.itens.map(i => { const ps = cots.map(c => pr(c, i)), mn = Math.min(...ps.filter(v => v != null));
        return `<tr><td>${esc(i.descricao)}</td><td class="n">${q(i.quantidade)}</td>${ps.map(v => `<td class="n">${v == null ? 'sem preço' : `${u(v)}${v === mn && cots.length > 1 ? ' *' : ''}<br>${money(v * i.quantidade)}`}</td>`).join('')}</tr>`; }).join('')
      + `<tr><td>Avaliação (IQF)</td><td></td>${cots.map(c => `<td class="n">${esc(d.iqf?.(c) || '—')}</td>`).join('')}</tr>`
      + `<tr><td>Prazo de entrega</td><td></td>${cots.map(c => `<td class="n">${c.prazo_entrega_dias != null ? c.prazo_entrega_dias + ' dias' : '–'}</td>`).join('')}</tr>`
      + `<tr><td>Pagamento</td><td></td>${cots.map(c => `<td class="n">${esc(c.condicao_pagamento || (c.parcelas_dias || []).join('/') || '–')}</td>`).join('')}</tr>`
      + `<tr><td>Frete</td><td></td>${cots.map(c => `<td class="n">${money(c.frete)}</td>`).join('')}</tr>`
      + `<tr><td><b>Total</b></td><td></td>${cots.map(c => `<td class="n"><b>${money(mc(c).total)}</b>${mc(c).completa === false ? '<br>incompleta' : ''}</td>`).join('')}</tr>`
      + `<tr><td>Valor presente (${fmt(d.taxa)}% a.m.)</td><td></td>${cots.map(c => `<td class="n">${money(mc(c).vp)}</td>`).join('')}</tr>`
      + `<tr><td>Origem · validade</td><td></td>${cots.map(c => `<td class="n">${c.respondida_pelo_fornecedor ? 'pelo link' : 'digitada'}${c.validade ? ' · até ' + dateBR(c.validade) : ''}</td>`).join('')}</tr>`),
      cots.length > 1 ? '<p>* menor preço do item.</p>' : '');
    if (d.ML) out.push(relatorioMapa(r, cots, citens, M, d.ML, d.RF, d.BF, d.div, { ...o, inicio: n, semRequisicao: true }).replace(/<h2>(\d+)\./g, (m, k) => { n = +k; return m; }));
  } else out.push(h('Cotações'), '<p>Nenhuma cotação registrada até a emissão.</p>');
  if (conv.length) out.push(h('Cotação por link'), tab([['Fornecedor', 0], ['Contato', 0], ['Situação', 0], ['Respondido em', 0], ['Vale até', 0]],
    conv.map(c => `<tr><td>${esc(c.fornecedor)}</td><td>${esc([c.email, c.telefone].filter(Boolean).join(' · ') || '—')}</td><td>${esc(SIT_CONV[c.situacao] || c.situacao)}${c.recusa_motivo ? ' — ' + esc(c.recusa_motivo) : ''}</td>
      <td>${c.respondido_em ? new Date(c.respondido_em).toLocaleString('pt-BR').slice(0, 17) : '—'}</td><td>${dateBR(c.expira_em)}</td></tr>`).join('')));
  out.push(h('Pedidos de compra'), peds.length ? tab([['Pedido', 0], ['Situação', 0], ['Total', 1]], peds.map(p => `<tr><td>PC ${esc(String(p.numero))}</td><td>${esc(p.status || '')}</td><td class="n">${money(p.total)}</td></tr>`).join(''))
    : '<p>Nenhum pedido gerado até a emissão.</p>');
  return out.join('');
}

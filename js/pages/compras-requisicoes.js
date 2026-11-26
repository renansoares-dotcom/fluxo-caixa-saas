// Compras › Requisições e cotações: pedir → aprovar (direção) → cotar com fornecedores (mapa comparativo) → gerar o pedido.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { cadCompras, ST_REQ, badge, qtd, inp, unit, num, diasTxt, lerDias, podeAprovar } from '../lib/compras.js';
import { carregarProdutos, datalistProdutos, ligarItensProduto, produtoDoItem } from '../lib/produtos.js';
import { mapaCotacoes } from '../lib/cotacao-calc.js';
import { selo } from '../lib/iqf.js';
import { DESTINACOES, REGIMES_FORN, mapaLiquido, mapaReforma, fatorIcmsEfetivo, sugestaoFiscal, divergencias, br as br2, fmt } from '../lib/aquisicao.js';
import { aliqInterna } from '../lib/competitividade.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { relatorioMapa, relatorioPeriodo } from '../lib/aquisicao-relatorio.js';

export const title = 'Requisições e Cotações';
const ui = { filtro: 'abertas', busca: '' };
let R = [], C = null, PRODS = [];

const FILTROS = [['abertas', 'Em andamento', ['pendente', 'aprovada']], ['pendente', 'Aguardando aprovação', ['pendente']], ['aprovada', 'Aprovadas (cotar)', ['aprovada']],
  ['atendida', 'Viraram pedido', ['atendida']], ['rejeitada', 'Rejeitadas', ['rejeitada']], ['cancelada', 'Canceladas', ['cancelada']], ['todas', 'Todas', null]];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Requisições e Cotações</h2><div class="muted small">Quem precisa pede; a direção aprova; Compras cota e gera o pedido.</div></div>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="rq-rel" title="Compras do período pelo custo líquido: créditos capturados, escolhas e fornecedores do Simples">Relatório de compra inteligente</button>${['admin', 'diretor'].includes(state.papel) ? '<button class="btn ghost" id="rq-par">Parâmetros da cotação</button>' : ''}<button class="btn primary" id="rq-novo">Nova requisição</button></div></div>
    <div class="card toolbar"><div class="chips" id="rq-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <input id="rq-busca" placeholder="Procurar item, solicitante ou nº" value="${esc(ui.busca)}" style="min-width:240px"></div>
    <div id="rq-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#rq-novo', root).onclick = () => editar(null, root);
  $('#rq-par', root) && ($('#rq-par', root).onclick = () => parametrosCotacao());
  $('#rq-rel', root).onclick = () => relatorioCompraInteligente();
  $('#rq-f', root).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; $$('#rq-f .chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === f)); pintar(root); } };
  $('#rq-busca', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  const ab = state.abrir?.tipo === 'requisicao' ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if (ab) { const r = R.find(x => x.id === ab.id); if (r) abrir(r, root); }
}

async function carregar(root) {
  try {
    const e = state.empresa.id;
    const [cad, reqs, itens, cots] = await Promise.all([cadCompras(),
      fetchAll(() => sb.from('compras_requisicoes').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
      fetchAll(() => sb.from('compras_requisicao_itens').select('*').eq('empresa_id', e).order('id')),
      fetchAll(() => sb.from('compras_cotacoes').select('id,requisicao_id,escolhida').eq('empresa_id', e).order('id'))]);
    C = cad;
    PRODS = await carregarProdutos().catch(() => []);
    R = reqs.map(r => ({ ...r, itens: itens.filter(i => i.requisicao_id === r.id), nCot: cots.filter(c => c.requisicao_id === r.id).length }));
    pintar(root);
  } catch (err) { fail(err); $('#rq-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}

function pintar(root) {
  const sts = FILTROS.find(f => f[0] === ui.filtro)[2], b = ui.busca.trim().toLowerCase();
  const vis = R.filter(r => (!sts || sts.includes(r.status)) && (!b || String(r.numero) === b.replace(/\D/g, '') || (r.solicitante || '').toLowerCase().includes(b)
    || r.itens.some(i => i.descricao.toLowerCase().includes(b))));
  $('#rq-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Pedida em</th><th>Solicitante</th><th>Setor</th><th>Precisa até</th><th>Itens</th><th class="num">Estimado</th><th>Cotações</th><th>Situação</th></tr></thead><tbody>
    ${vis.map(r => { const est = r.itens.reduce((t, i) => t + (+i.valor_estimado || 0) * +i.quantidade, 0);
      return `<tr class="clickable" data-id="${r.id}"><td>${r.numero}${r.prioridade === 'urgente' ? ' <span class="badge vencido">urgente</span>' : ''}</td><td>${dateBR(r.criado_em)}</td><td>${esc(r.solicitante || '')}</td>
        <td>${esc(C.ccById[r.centro_custo_id]?.nome || '')}</td><td class="${r.necessidade && r.necessidade < today() && ['pendente', 'aprovada'].includes(r.status) ? 'neg' : ''}">${dateBR(r.necessidade)}</td>
        <td class="wrap">${esc(r.itens.slice(0, 2).map(i => `${qtd(i.quantidade)} ${i.unidade} ${i.descricao}`).join(' · '))}${r.itens.length > 2 ? ` <span class="muted">+${r.itens.length - 2}</span>` : ''}</td>
        <td class="num">${est ? money(est) : '–'}</td><td>${r.nCot || ''}</td><td>${badge(ST_REQ, r.status)}</td></tr>`; }).join('')
    || '<tr><td colspan="9" class="empty">Nenhuma requisição neste filtro.</td></tr>'}</tbody></table></div></div>`;
  $$('#rq-lista tr[data-id]', root).forEach(tr => tr.onclick = () => abrir(R.find(r => r.id === tr.dataset.id), root));
}

// ------------------------------------------------------------ nova / editar
function linhaItem(i = {}) {
  return `<tr><td><input class="it-d" list="dl-prod" ${i.produto_id ? `data-prod="${i.produto_id}"` : ''} value="${esc(i.descricao || '')}" placeholder="ex.: PEBD 2420 virgem" style="min-width:260px"></td>
    <td><input class="it-u" value="${esc(i.unidade || 'UN')}" style="width:64px"></td>
    <td><input class="it-q" value="${i.quantidade ? inp(i.quantidade) : ''}" style="width:100px"></td>
    <td><input class="it-v" value="${i.valor_estimado ? String(+i.valor_estimado).replace('.', ',') : ''}" placeholder="opcional" style="width:110px"></td>
    <td><input class="it-n" value="${esc(i.ncm || '')}" style="width:100px"></td>
    <td><select class="it-dst" title="Decide os créditos de ICMS, IPI e PIS/COFINS">${DESTINACOES.map(([v, t]) => `<option value="${v}" ${(i.destinacao || 'insumo') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
    <td><button class="btn ghost icon it-x" title="Tirar">✕</button></td></tr>`;
}
function editar(r, root) {
  const v = r || { solicitante: state.user?.email?.split('@')[0] || '', prioridade: 'normal', itens: [{}] };
  const m = modal({ title: r ? `Requisição nº ${r.numero} — editar` : 'Nova requisição de compra', wide: true, body: `
    ${r?.status === 'rejeitada' ? `<p class="neg small" style="margin-top:0">Rejeitada: ${esc(r.motivo || '')}. Ao salvar, volta para aprovação.</p>` : ''}
    <div class="grid-form">
      <label>Solicitante *<input id="rq-sol" value="${esc(v.solicitante || '')}"></label>
      <label>Setor (centro de custo)<select id="rq-cc"><option value="">—</option>${C.centros.map(c => `<option value="${c.id}" ${v.centro_custo_id === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Precisa até<input type="date" id="rq-nec" value="${v.necessidade || ''}"></label>
      <label>Prioridade<select id="rq-pri"><option value="normal">Normal</option><option value="urgente" ${v.prioridade === 'urgente' ? 'selected' : ''}>Urgente</option></select></label>
      <label class="full">Observação / justificativa<input id="rq-obs" value="${esc(v.observacao || '')}"></label>
    </div>
    <h3 style="margin:14px 0 6px">Itens <span class="muted small" style="font-weight:400">escolha o produto do cadastro na lista ou escreva livre</span></h3>${datalistProdutos('dl-prod', PRODS)}
    <div class="table-wrap"><table><thead><tr><th>Descrição *</th><th>Unid.</th><th>Quantidade *</th><th>Valor unit. estimado</th><th>NCM</th><th>Destinação</th><th></th></tr></thead><tbody id="rq-itens">${v.itens.map(linhaItem).join('')}</tbody></table></div>
    <button class="btn ghost small" id="rq-mais" style="margin-top:6px">+ Item</button>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rq-salvar">${r ? 'Salvar' : 'Enviar para aprovação'}</button>` });
  const tb = $('#rq-itens', m.el);
  ligarItensProduto(tb, PRODS);
  $('#rq-mais', m.el).onclick = () => tb.insertAdjacentHTML('beforeend', linhaItem());
  tb.onclick = (e) => { if (e.target.closest('.it-x')) e.target.closest('tr').remove(); };
  $('#rq-salvar', m.el).onclick = async (ev) => {
    const itens = $$('tr', tb).map(tr => ({ produto_id: produtoDoItem(tr), descricao: $('.it-d', tr).value.trim(), unidade: $('.it-u', tr).value.trim().toUpperCase() || 'UN',
      quantidade: num($('.it-q', tr).value), valor_estimado: $('.it-v', tr).value.trim() ? num($('.it-v', tr).value) : null, ncm: $('.it-n', tr).value.replace(/\D/g, '') || null, destinacao: $('.it-dst', tr).value || 'insumo' }))
      .filter(i => i.descricao || i.quantidade);
    const sol = $('#rq-sol', m.el).value.trim();
    if (!sol) return toast('Informe o solicitante', true);
    if (!itens.length || itens.some(i => !i.descricao || !(i.quantidade > 0))) return toast('Cada item precisa de descrição e quantidade', true);
    const cab = { solicitante: sol, centro_custo_id: $('#rq-cc', m.el).value || null, necessidade: $('#rq-nec', m.el).value || null,
      prioridade: $('#rq-pri', m.el).value, observacao: $('#rq-obs', m.el).value.trim() || null };
    ev.target.disabled = true;
    try {
      const e = state.empresa.id;
      let id = r?.id;
      if (r) {
        await q(sb.from('compras_requisicoes').update({ ...cab, ...(r.status === 'rejeitada' ? { status: 'pendente', motivo: null } : {}) }).eq('id', r.id));
        await q(sb.from('compras_requisicao_itens').delete().eq('requisicao_id', r.id));
      } else id = (await q(sb.from('compras_requisicoes').insert({ empresa_id: e, ...cab }).select('id').single())).id;
      await q(sb.from('compras_requisicao_itens').insert(itens.map(i => ({ ...i, empresa_id: e, requisicao_id: id }))));
      m.close(); toast(r ? 'Requisição salva' : 'Requisição enviada para aprovação'); await carregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ------------------------------------------------------------ detalhe
async function abrir(r, root) {
  let cots = [], citens = [], peds = [], conv = [], par = null, IQF = {}, BF = null, HIST = {};
  try {
    [cots, peds, conv, par] = await Promise.all([q(sb.from('compras_cotacoes').select('*').eq('requisicao_id', r.id).order('criado_em')),
      q(sb.from('compras_pedidos').select('id,numero,status,total').eq('requisicao_id', r.id)),
      q(sb.from('compras_cotacao_convites').select('*').eq('requisicao_id', r.id).order('criado_em')).catch(() => []),
      q(sb.from('compras_parametros').select('*').eq('empresa_id', state.empresa.id)).then(x => x[0] || null).catch(() => null)]);
    if (cots.length) citens = await q(sb.from('compras_cotacao_itens').select('*').in('cotacao_id', cots.map(c => c.id)));
    if (cots.some(c => c.favorecido_id)) IQF = Object.fromEntries((await q(sb.rpc('compras_iqf', { p_empresa: state.empresa.id })).catch(() => [])).map(f => [f.favorecido_id, f]));   // melhoria 5.6
    BF = await baseFiscal(par);   // compra inteligente (SQL 199)
    for (const c of cots.filter(x => x.favorecido_id && x.respondida_pelo_fornecedor)) HIST[c.id] = await q(sb.rpc('compras_hist_fiscal', { p_empresa: state.empresa.id, p_fav: c.favorecido_id })).catch(() => []);
  } catch (err) { return fail(err); }
  const m = modal({ title: `Requisição nº ${r.numero}`, wide: true, body: '<div id="rq-det"></div>', foot: '<div id="rq-acoes" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const det = $('#rq-det', m.el), ac = $('#rq-acoes', m.el);
  const totalCot = (c) => r.itens.reduce((t, i) => t + (+citens.find(x => x.cotacao_id === c.id && x.requisicao_item_id === i.id)?.valor_unitario || 0) * +i.quantidade, 0) + +c.frete;
  const completa = (c) => r.itens.every(i => citens.some(x => x.cotacao_id === c.id && x.requisicao_item_id === i.id));
  const melhor = cots.filter(completa).sort((a, b) => totalCot(a) - totalCot(b))[0];
  // mapa comparativo (melhoria 5.2): menor preço por item, prazo, valor presente da condição e quanto custaria dividir a compra
  const taxa = +(par?.taxa_mensal_vp ?? 1.5), M = mapaCotacoes(r.itens, cots, citens, { taxa }), mc = (c) => M.cots.find(x => x.id === c.id);
  const SITC = { enviado: ['enviado', ''], aberto: ['abriu o link', 'aberto'], respondido: ['respondeu', 'pago'], recusado: ['não vai cotar', 'vencido'], cancelado: ['cancelado', ''] };
  det.innerHTML = `<div class="grid-form small">
      <div><span class="muted">Situação</span><div>${badge(ST_REQ, r.status)}${r.prioridade === 'urgente' ? ' <span class="badge vencido">urgente</span>' : ''}</div></div>
      <div><span class="muted">Solicitante</span><div>${esc(r.solicitante || '')}</div></div>
      <div><span class="muted">Setor</span><div>${esc(C.ccById[r.centro_custo_id]?.nome || '–')}</div></div>
      <div><span class="muted">Precisa até</span><div>${dateBR(r.necessidade) || '–'}</div></div>
      <div><span class="muted">Pedida em</span><div>${dateBR(r.criado_em)}</div></div>
      ${r.decidido_em ? `<div><span class="muted">${r.status === 'rejeitada' ? 'Rejeitada' : 'Aprovada'} em</span><div>${dateBR(r.decidido_em)}</div></div>` : ''}
    </div>
    ${r.observacao ? `<p class="small" style="margin:10px 0 0"><span class="muted">Observação:</span> ${esc(r.observacao)}</p>` : ''}
    ${r.motivo ? `<p class="small neg" style="margin:6px 0 0">Motivo: ${esc(r.motivo)}</p>` : ''}
    ${peds.length ? `<p class="small" style="margin:8px 0 0">Pedido(s): ${peds.map(p => `<a href="#" data-ped="${p.id}">PC ${p.numero}</a> (${money(p.total)})`).join(', ')}</p>` : ''}
    <h3 style="margin:14px 0 6px">${cots.length ? 'Mapa comparativo de cotações' : 'Itens'}</h3>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Quant.</th>${r.itens.some(i => i.valor_estimado) ? '<th class="num">Estimado</th>' : ''}
      ${cots.map(c => `<th class="num" style="min-width:150px">${esc(c.fornecedor)}${c.escolhida ? ' ✓' : ''}<div class="small muted" style="font-weight:400">${c.prazo_entrega_dias != null ? c.prazo_entrega_dias + ' dias · ' : ''}${esc(c.condicao_pagamento || diasTxt(c.parcelas_dias))}</div></th>`).join('')}</tr></thead><tbody>
      ${r.itens.map(i => { const pr = cots.map(c => +citens.find(x => x.cotacao_id === c.id && x.requisicao_item_id === i.id)?.valor_unitario).map(v => (isNaN(v) ? null : v));
        const min = Math.min(...pr.filter(v => v != null));
        return `<tr><td class="wrap">${esc(i.descricao)} <span class="muted small">${esc(i.unidade)}${i.ncm ? ' · NCM ' + esc(i.ncm) : ''}</span></td><td class="num">${qtd(i.quantidade)}</td>
          ${r.itens.some(x => x.valor_estimado) ? `<td class="num">${i.valor_estimado ? unit(i.valor_estimado) : '–'}</td>` : ''}
          ${pr.map(v => `<td class="num ${v != null && v === min && cots.length > 1 ? 'pos' : ''}" ${v != null && v === min && cots.length > 1 ? 'style="font-weight:600"' : ''}>${v == null ? '<span class="muted">sem preço</span>' : `${unit(v)}<div class="small muted">${money(v * i.quantidade)}</div>`}</td>`).join('')}</tr>`; }).join('')}
      ${cots.length ? `<tr><td title="Avaliação do fornecedor: qualidade dos lotes, pontualidade e notas que conferem com o pedido (Painel de Compras)">Avaliação (IQF)</td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num">${selo(c.favorecido_id ? IQF[c.favorecido_id] : null)}</td>`).join('')}</tr>
        <tr><td>Prazo de entrega</td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num">${c.prazo_entrega_dias != null ? c.prazo_entrega_dias + ' dias' : '–'}</td>`).join('')}</tr>
        <tr><td>Frete</td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num">${money(c.frete)}</td>`).join('')}</tr>
        <tr style="font-weight:600"><td>Total</td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num ${c === melhor && cots.length > 1 ? 'pos' : ''}">${money(totalCot(c))}${completa(c) ? '' : '<div class="small neg">incompleta</div>'}</td>`).join('')}</tr>
        <tr><td title="Parcelas trazidas a valor presente a ${String(taxa).replace('.', ',')}% ao mês: compara prazos de pagamento diferentes">Valor presente <span class="muted small">(${String(taxa).replace('.', ',')}% a.m.)</span></td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num ${M.melhorVP && M.melhorVP.id === c.id && M.cots.filter(x => x.completa).length > 1 ? 'pos' : ''}">${money(mc(c).vp)}<div class="small muted">${esc(diasTxt(c.parcelas_dias))}</div></td>`).join('')}</tr>
        <tr><td></td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num">${c.respondida_pelo_fornecedor ? '<div class="small muted">pelo link</div>' : ''}<div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          ${r.status === 'aprovada' ? `<button class="btn ghost small" data-ec="${c.id}">Editar</button><button class="btn primary small" data-pc="${c.id}">Gerar pedido</button>` : ''}</div>
          ${c.validade ? `<div class="small muted">válida até ${dateBR(c.validade)}</div>` : ''}</td>`).join('')}</tr>` : ''}
    </tbody></table></div>
    ${melhor && cots.filter(completa).length > 1 ? (() => { const mx = Math.max(...cots.filter(completa).map(totalCot)), mn = totalCot(melhor);
      return `<p class="small" style="margin:8px 0 0">Menor total: <b>${esc(melhor.fornecedor)}</b> ${money(mn)} — ${money(mx - mn)} abaixo da cotação mais cara.${M.melhorVP && M.melhorVP.id !== melhor.id ? ` Pela condição de pagamento (valor presente), a melhor é <b>${esc(M.melhorVP.fornecedor)}</b>.` : ''}${M.economiaDividir > 0.5 ? ` Comprando cada item de quem cobra menos, a mercadoria sairia ${money(M.economiaDividir)} mais barata (sem contar fretes e pedido mínimo).` : ''}</p>`; })() : ''}
    <div id="rq-liq"></div>
    ${conv.length || r.status === 'aprovada' ? `<h3 style="margin:14px 0 6px">Cotação por link</h3>
      <div class="table-wrap"><table class="small"><thead><tr><th>Fornecedor</th><th>Contato</th><th>Situação</th><th>Vale até</th><th></th></tr></thead><tbody>
      ${conv.map(c => `<tr><td>${esc(c.fornecedor)}</td><td>${esc([c.email, c.telefone].filter(Boolean).join(' · ') || '–')}</td>
        <td>${badge(SITC, c.situacao)}${c.recusa_motivo ? `<div class="muted">${esc(c.recusa_motivo)}</div>` : ''}${c.respondido_em ? `<div class="muted">${new Date(c.respondido_em).toLocaleString('pt-BR').slice(0, 17)}</div>` : c.aberto_em ? `<div class="muted">abriu ${new Date(c.aberto_em).toLocaleString('pt-BR').slice(0, 17)}</div>` : ''}</td>
        <td class="${c.expira_em < today() ? 'neg' : ''}">${dateBR(c.expira_em)}</td>
        <td style="white-space:nowrap">${c.situacao !== 'cancelado' ? `<button class="btn ghost small" data-cl="${c.token}">Copiar link</button>${c.telefone ? `<a class="btn ghost small" target="_blank" rel="noopener" href="https://wa.me/55${esc(String(c.telefone).replace(/\D/g, '').replace(/^55/, ''))}?text=${encodeURIComponent(`Olá! Segue o pedido de cotação nº ${r.numero}: ${linkCot(c.token)}`)}">WhatsApp</a>` : ''}${c.situacao !== 'respondido' ? `<button class="btn ghost small" data-cx="${c.id}">Cancelar</button>` : ''}` : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="empty">Nenhum fornecedor convidado. Use "Convidar por link": o fornecedor preenche os preços numa página, sem cadastro.</td></tr>'}</tbody></table></div>` : ''}`;
  if (cots.length) pintarLiquido($('#rq-liq', det), r, cots, citens, M, BF, HIST, par);
  $$('[data-cl]', det).forEach(b => b.onclick = async () => { const l = linkCot(b.dataset.cl); try { await navigator.clipboard.writeText(l); toast('Link copiado'); } catch { prompt('Copie o link:', l); } });
  $$('[data-cx]', det).forEach(b => b.onclick = async () => { if (!await confirmDialog('Cancelar o convite? O link deixa de funcionar.')) return;
    try { await q(sb.from('compras_cotacao_convites').update({ situacao: 'cancelado' }).eq('id', b.dataset.cx)); m.close(); abrir(r, root); } catch (err) { fail(err); } });
  $$('[data-ped]', det).forEach(a => a.onclick = (e) => { e.preventDefault(); m.close(); state.abrir = { tipo: 'pedido', id: a.dataset.ped }; location.hash = '#/compras/pedidos'; });

  const btn = (t, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = t; b.onclick = fn; ac.appendChild(b); };
  const mudar = async (dados, msg) => { try { await q(sb.from('compras_requisicoes').update(dados).eq('id', r.id)); toast(msg); m.close(); await carregar(root); } catch (err) { fail(err); } };
  if (['pendente', 'rejeitada'].includes(r.status)) {
    btn('Cancelar requisição', 'ghost', async () => { if (await confirmDialog(`Cancelar a requisição nº ${r.numero}?`)) mudar({ status: 'cancelada' }, 'Requisição cancelada'); });
    btn('Editar', '', () => { m.close(); editar(r, root); });
  }
  if (r.status === 'pendente' && podeAprovar()) {
    btn('Rejeitar', 'danger', () => { const mot = prompt('Motivo da rejeição:'); if (mot?.trim()) mudar({ status: 'rejeitada', motivo: mot.trim() }, 'Requisição rejeitada'); });
    btn('Aprovar', 'primary', () => mudar({ status: 'aprovada', motivo: null }, 'Requisição aprovada'));
  }
  if (r.status === 'aprovada') {
    btn('Cancelar requisição', 'ghost', async () => { if (await confirmDialog(`Cancelar a requisição nº ${r.numero}?`)) mudar({ status: 'cancelada' }, 'Requisição cancelada'); });
    btn('Pedido sem cotação', '', () => gerarPedido(r, null, [], m, root));
    btn('Convidar por link', '', () => convidar(r, m, root));
    btn('Nova cotação', 'primary', () => cotacao(r, null, [], m, root));
  }
  $$('[data-ec]', det).forEach(b => b.onclick = () => cotacao(r, cots.find(c => c.id === b.dataset.ec), citens, m, root));
  $$('[data-pc]', det).forEach(b => b.onclick = () => gerarPedido(r, cots.find(c => c.id === b.dataset.pc), citens, m, root));
}

// ------------------------------------------------------------ compra inteligente: custo líquido de aquisição (SQL 199)
async function baseFiscal(par) {
  const e = state.empresa.id, hoje = today(), um = (x) => (Array.isArray(x) ? x[0] : x) || null;
  const [trib, fisc, interna, anos] = await Promise.all([
    q(sb.from('empresa_tributacao').select('*').eq('empresa_id', e).lte('vigencia_inicio', hoje).order('vigencia_inicio', { ascending: false }).limit(1)).then(um).catch(() => null),
    q(sb.from('fisc_param').select('*').eq('empresa_id', e).lte('vigencia_inicio', hoje).order('vigencia_inicio', { ascending: false }).limit(1)).then(um).catch(() => null),
    fetchAll(() => sb.from('fisc_icms_interna').select('*').eq('empresa_id', e)).catch(() => []),
    q(sb.from('trib_aliquotas').select('*').eq('empresa_id', e).order('ano')).catch(() => [])]);
  const nos = { uf: trib?.uf || null, ipi_contribuinte: par?.aq_ipi_contribuinte !== false, pc_nao_cumulativo: trib?.pis_cofins ? trib.pis_cofins === 'nao_cumulativo' : !['simples', 'mei'].includes(trib?.regime),
    simples: ['simples', 'mei'].includes(trib?.regime), ibscbs_regular: !!trib?.ibscbs_regular };
  const P = { pc_pct: fisc ? (+fisc.pis_pct || 0) + (+fisc.cofins_pct || 0) || 9.25 : 9.25, pc_excluir_icms: fisc?.pc_excluir_icms !== false, pc_incluir_frete: fisc?.pc_incluir_frete !== false,
    pc_incluir_ipi: !!fisc?.pc_incluir_ipi, ciap_meses: par?.aq_ciap_meses || 48, taxa_mensal: +(par?.taxa_mensal_vp ?? 1.5),
    fator_icms: fatorIcmsEfetivo(fisc, { prodepe_saidas_pct: +(par?.aq_prodepe_saidas_pct ?? 100) }), simples_credito_ibs_pct: +(par?.aq_simples_credito_ibs_pct || 0),
    internaDe: (ncm) => aliqInterna(interna, nos.uf, ncm, hoje)?.aliquota ?? null };
  return { nos, P, fisc, anos, semInterna: !interna.length, semUf: !nos.uf, reforma: !!par?.aq_reforma };
}
function calcLiquido(r, cots, citens, M, BF) {
  const mc = (c) => M.cots.find(x => x.id === c.id) || {};
  const cs = cots.map(c => ({ ...c, vpFator: mc(c).total ? mc(c).vp / mc(c).total : 1 }));
  return { ML: mapaLiquido(r.itens, cs, citens, BF.nos, BF.P), RF: mapaReforma(r.itens, cs, citens, BF.nos, BF.P, BF.anos), cs };
}
function pintarLiquido(el, r, cots, citens, M, BF, HIST, par, comReforma = BF.reforma) {
  const { ML, RF } = calcLiquido(r, cots, citens, M, BF), L = (c) => ML.cots.find(x => x.id === c.id), fat = BF.P.fator_icms, var2 = ML.cots.filter(x => x.completa).length > 1;
  const melhor = (k, c) => var2 && k && k.id === c.id ? 'pos' : '';
  const div = cots.flatMap(c => (HIST[c.id] || []).length ? r.itens.map(i => { const x = citens.find(z => z.cotacao_id === c.id && z.requisicao_item_id === i.id);
    return x ? divergencias(x, sugestaoFiscal(HIST[c.id], i.ncm)).map(t => `${c.fornecedor} · ${i.descricao}: ${t}`) : []; }).flat() : []);
  const lin = (rot, f, cls = '', tip = '') => `<tr class="${cls}"><td ${tip ? `title="${esc(tip)}"` : ''}>${rot}</td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => f(c, L(c))).join('')}</tr>`;
  el.innerHTML = `<h3 style="margin:16px 0 6px">Custo líquido de aquisição <span class="muted small" style="font-weight:400">o que a compra custa depois dos créditos de ICMS, IPI e PIS/COFINS</span></h3>
    ${BF.semUf ? '<p class="small warn">Cadastre a UF e o regime da empresa (Configurações › Empresa › Regime tributário) para calcular os créditos.</p>' : ''}
    ${BF.semInterna ? '<p class="small warn">Sem a alíquota interna por UF: o DIFAL do uso e consumo e do ativo não entra. Abra uma vez a Análise de Competitividade de Preço (Comercial) para carregar a tabela.</p>' : ''}
    <div class="table-wrap"><table><thead><tr><th></th><th></th>${r.itens.some(x => x.valor_estimado) ? '<th></th>' : ''}${cots.map(c => `<th class="num" style="min-width:150px">${esc(c.fornecedor)}<div class="small muted" style="font-weight:400">${esc([c.uf, (REGIMES_FORN.find(x => x[0] === c.regime) || [])[1]].filter(Boolean).join(' · ') || 'sem dados fiscais')}</div></th>`).join('')}</tr></thead><tbody>
      ${lin('Desembolso', (c, x) => `<td class="num ${melhor(ML.melhorPreco, c)}">${money(x.desembolso)}</td>`, '', 'Preço + IPI + ICMS-ST + frete + DIFAL (uso e consumo e ativo de outra UF)')}
      ${lin('(−) Créditos', (c, x) => `<td class="num">${money(-x.creditos)}${x.faltaFiscal ? '<div class="small warn">sem alíquota de ICMS</div>' : ''}</td>`, '', 'ICMS, IPI e PIS/COFINS que voltam na apuração')}
      ${lin('Custo líquido', (c, x) => `<td class="num" style="font-weight:600">${money(x.custo)}${x.completa ? '' : '<div class="small neg">incompleta</div>'}</td>`)}
      ${lin(`Custo líquido a valor presente <span class="muted small">(${String(BF.P.taxa_mensal).replace('.', ',')}% a.m.)</span>`, (c, x) => `<td class="num ${melhor(ML.melhorLiq, c)}" style="font-weight:600">${money(x.custoVp)}</td>`)}
      ${fat < 1 ? lin(`Com o PRODEPE <span class="muted small">(crédito de ICMS vale ${fmt(fat * 100)}%)</span>`, (c, x) => `<td class="num ${melhor(ML.melhorEf, c)}">${money(x.custoEfVp)}</td>`, '',
        'Com o crédito presumido calculado sobre o saldo devedor, cada R$ 1 de crédito de ICMS reduz também o benefício (e o FEEF)') : ''}
      ${lin('', (c) => `<td class="num"><button class="btn ghost small" data-mem="${c.id}">Memória</button></td>`)}
    </tbody></table></div>
    ${var2 ? `<p class="small" style="margin:8px 0 0">${ML.melhorPreco && ML.melhorLiq && ML.melhorPreco.id !== ML.melhorLiq.id
      ? `Pelo preço, a melhor é <b>${esc(ML.melhorPreco.fornecedor)}</b>; <b>pelo custo líquido, é ${esc(ML.melhorLiq.fornecedor)}</b>, ${money(ML.ganho)} a menos por causa dos créditos.`
      : `Pelo custo líquido, a melhor é <b>${esc(ML.melhorLiq?.fornecedor || '')}</b>.`}${fat < 1 && ML.melhorEf && ML.melhorEf.id !== ML.melhorLiq?.id ? ` Considerando o PRODEPE, a melhor passa a ser <b>${esc(ML.melhorEf.fornecedor)}</b>.` : ''}</p>` : ''}
    ${div.length ? `<div class="cp-aviso small" style="margin-top:6px"><b>Confira com o fornecedor</b> (diferente da última nota dele):<br>${div.map(esc).join('<br>')}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn ghost small" id="lq-rf">${comReforma ? 'Esconder a reforma' : 'Simular a reforma (2027–2033)'}</button><button class="btn ghost small" id="lq-pdf">PDF do mapa</button></div>
    ${comReforma ? (RF.length ? `<div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Ano</th><th class="num">ICMS</th><th class="num">CBS+IBS</th>${cots.map(c => `<th class="num">${esc(c.fornecedor)}</th>`).join('')}</tr></thead><tbody>
      ${RF.map(a => `<tr><td>${a.ano}</td><td class="num">${fmt(a.icms_pct)}%</td><td class="num">${fmt(a.t)}%</td>${cots.map(c => { const x = a.cots.find(z => z.id === c.id); return `<td class="num ${a.melhor === c.id && var2 ? 'pos' : ''}">${money(x?.custo)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="small muted">Mesmos preços; ICMS reduzido na transição, IPI e PIS/COFINS zerados, CBS/IBS por fora com crédito integral. Fornecedor do Simples que não optar pelo regime regular transfere só o crédito estimado (${fmt(BF.P.simples_credito_ibs_pct)}% do preço, em Parâmetros da cotação).</p>`
      : '<p class="small muted">Sem as alíquotas de 2027 em diante no Simulador da reforma.</p>') : ''}`;
  $('#lq-rf', el).onclick = () => pintarLiquido(el, r, cots, citens, M, BF, HIST, par, !comReforma);
  $('#lq-pdf', el).onclick = () => abrirRelatorio({ rel: 'Mapa de cotação por custo líquido', nome: 'Mapa de Cotação por Custo Líquido', titulo: `MAPA DE COTAÇÃO — REQUISIÇÃO Nº ${r.numero}`,
    corpo: relatorioMapa(r, cots, citens, M, ML, comReforma ? RF : [], BF, div, { esc, money, dateBR }),
    parametros: [['Requisição', `nº ${r.numero}`], ['Cotações', String(cots.length)], ['Valor presente', `${String(BF.P.taxa_mensal).replace('.', ',')}% a.m.`], ['Reforma', comReforma ? 'incluída' : 'fora']],
    rodape: 'Base: Compras › Requisições e Cotações (CMP002). Créditos pelas regras vigentes; PRODEPE, FEEF e PIS/COFINS de Fiscal › Apuração › Parâmetros; CBS/IBS do Simulador da reforma.' });
  $$('[data-mem]', el).forEach(b => b.onclick = () => { const c = cots.find(x => x.id === b.dataset.mem), x = L(c);
    modal({ title: `Memória do custo líquido — ${c.fornecedor}`, wide: true, body: r.itens.filter(i => x.porItem[i.id]).map(i => `<h3 style="margin:10px 0 4px">${esc(i.descricao)} <span class="muted small">${qtd(i.quantidade)} ${esc(i.unidade)} · ${esc((DESTINACOES.find(d => d[0] === (i.destinacao || 'insumo')) || [])[1] || '')}</span></h3>
      <table class="cp-mt"><tbody>${x.porItem[i.id].linhas.map(l => `<tr class="${['desemb', 'custo', 'custo_ef'].includes(l.k) ? 'cp-tot' : ''}"><td>${esc(l.txt)}${l.obs ? `<div class="muted small">${esc(l.obs)}</div>` : ''}</td><td class="num">${br2(l.v)}</td></tr>`).join('')}</tbody></table>`).join(''),
      foot: '<button class="btn primary" data-close>Fechar</button>' }); });
}

async function relatorioCompraInteligente() {
  const ini = today().slice(0, 8) + '01';
  const m = modal({ title: 'Relatório de compra inteligente', narrow: true, body: `<p class="small muted" style="margin-top:0">Requisições com cotação pedidas no período, comparadas pelo custo líquido (depois dos créditos).</p>
    <div class="grid-form"><label>De<input type="date" id="ri-de" value="${ini}"></label><label>Até<input type="date" id="ri-ate" value="${today()}"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ri-ok">Gerar PDF</button>' });
  $('#ri-ok', m.el).onclick = async (ev) => {
    const de = $('#ri-de', m.el).value, ate = $('#ri-ate', m.el).value;
    ev.target.disabled = true;
    try {
      const reqs = R.filter(r => r.nCot && String(r.criado_em).slice(0, 10) >= de && String(r.criado_em).slice(0, 10) <= ate);
      if (!reqs.length) { ev.target.disabled = false; return toast('Nenhuma requisição com cotação no período', true); }
      const ids = reqs.map(r => r.id);
      const par = (await q(sb.from('compras_parametros').select('*').eq('empresa_id', state.empresa.id)).catch(() => []))[0] || null;
      const [cots, BF] = await Promise.all([fetchAll(() => sb.from('compras_cotacoes').select('*').in('requisicao_id', ids).order('id')), baseFiscal(par)]);
      const citens = cots.length ? await fetchAll(() => sb.from('compras_cotacao_itens').select('*').in('cotacao_id', cots.map(c => c.id)).order('id')) : [];
      const taxa = +(par?.taxa_mensal_vp ?? 1.5);
      const A = reqs.map(r => { const cs = cots.filter(c => c.requisicao_id === r.id), M = mapaCotacoes(r.itens, cs, citens, { taxa }), { ML } = calcLiquido(r, cs, citens, M, BF);
        return { r, cots: cs, ML, escolhida: cs.find(c => c.escolhida) || null }; });
      m.close();
      abrirRelatorio({ rel: 'Relatório de compra inteligente', nome: 'Compra Inteligente', titulo: 'COMPRAS PELO CUSTO LÍQUIDO — CRÉDITOS E ESCOLHAS', paisagem: true,
        corpo: relatorioPeriodo(A, { esc, money, dateBR }), parametros: [['Período', `${dateBR(de)} a ${dateBR(ate)}`], ['Requisições', String(A.length)], ['Valor presente', `${String(taxa).replace('.', ',')}% a.m.`]],
        rodape: 'Base: Compras › Requisições e Cotações (CMP002). Custo líquido = desembolso − créditos de ICMS, IPI e PIS/COFINS, pelas regras vigentes; PRODEPE de Fiscal › Apuração › Parâmetros.' });
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ------------------------------------------------------------ cotação por link (melhoria 5.2, SQL 132)
const linkCot = (t) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}cotacao.html?t=${t}`;
function convidar(r, pai, root) {
  const forn = (C.fornecedores || []).filter(f => f.tipo !== 'CLIENTES');
  const m = modal({ title: `Convidar fornecedores — requisição nº ${r.numero}`, body: `
    <p class="small muted">Cada fornecedor recebe um link próprio. Ele abre sem cadastro, preenche preço por item, frete, prazo e condição, e a resposta entra no mapa comparativo.</p>
    <div id="cv-l"></div><button class="btn ghost small" id="cv-mais" type="button">+ outro fornecedor</button>
    <label style="margin-top:10px">Mensagem ao fornecedor (opcional)<textarea id="cv-msg" rows="2" maxlength="1000" placeholder="Ex.: entrega no galpão 2; preço com ICMS e IPI"></textarea></label>
    <datalist id="cv-dl">${forn.map(f => `<option value="${esc(f.nome)}"></option>`).join('')}</datalist>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cv-ok">Gerar links e enviar e-mails</button>' });
  const linha = () => { const d = document.createElement('div'); d.className = 'grid-form'; d.style.marginBottom = '6px';
    d.innerHTML = '<label class="span2">Fornecedor<input data-n list="cv-dl" placeholder="da lista ou um nome novo"></label><label class="span2">E-mail<input data-e type="email" placeholder="vazio: o do cadastro, se houver"></label><label>WhatsApp<input data-t inputmode="tel" placeholder="81 9…"></label>';
    $('[data-n]', d).onchange = () => { const f = forn.find(x => x.nome === $('[data-n]', d).value); if (f?.email && !$('[data-e]', d).value) $('[data-e]', d).value = f.email; };
    $('#cv-l', m.el).appendChild(d); };
  linha(); linha(); $('#cv-mais', m.el).onclick = linha;
  $('#cv-ok', m.el).onclick = async (ev) => {
    const L = $$('#cv-l .grid-form', m.el).map(d => ({ nome: $('[data-n]', d).value.trim(), email: $('[data-e]', d).value.trim(), tel: $('[data-t]', d).value.trim() })).filter(x => x.nome);
    if (!L.length) return toast('Informe ao menos um fornecedor', true);
    ev.target.disabled = true;
    try { for (const x of L) { const f = forn.find(z => z.nome === x.nome);
        await q(sb.rpc('compras_convidar', { p_requisicao: r.id, p_favorecido: f?.id || null, p_fornecedor: x.nome, p_email: x.email || null, p_telefone: x.tel || null, p_mensagem: $('#cv-msg', m.el).value || null })); }
      sb.functions.invoke('email', { body: {} }).catch(() => {});
      toast(`${L.length} convite(s) criado(s)`); m.close(); pai.close(); abrir(r, root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}
async function parametrosCotacao() {
  const p = (await q(sb.from('compras_parametros').select('*').eq('empresa_id', state.empresa.id)).catch(() => []))[0] || {};
  const m = modal({ title: 'Parâmetros da cotação', body: `<div class="grid-form">
      <label class="xs">O link vale por (dias)<input id="pc-d" type="number" min="1" max="60" value="${p.cotacao_link_dias ?? 5}"></label>
      <label class="xs">Taxa para o valor presente (% ao mês)<input id="pc-t" inputmode="decimal" value="${String(p.taxa_mensal_vp ?? 1.5).replace('.', ',')}"></label></div>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="pc-e" ${p.cotacao_mostra_estimado ? 'checked' : ''}> Mostrar ao fornecedor o preço estimado da requisição como referência</label>
    <label style="margin-top:8px">Mensagem padrão do convite<textarea id="pc-m" rows="3" maxlength="1000">${esc(p.cotacao_mensagem || '')}</textarea></label>
    <h3 style="margin:14px 0 6px">Compra inteligente (custo líquido)</h3><div class="grid-form">
      <label>Parcela das saídas com PRODEPE (%)<input id="pc-pp" inputmode="decimal" value="${String(p.aq_prodepe_saidas_pct ?? 100).replace('.', ',')}"></label>
      <label>Crédito de CBS/IBS do fornecedor do Simples, na reforma (% do preço)<input id="pc-sn" inputmode="decimal" value="${String(p.aq_simples_credito_ibs_pct ?? 0).replace('.', ',')}"></label>
      <label class="xs">CIAP do ativo (meses)<input id="pc-ci" type="number" min="1" max="120" value="${p.aq_ciap_meses ?? 48}"></label></div>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="pc-ipi" ${p.aq_ipi_contribuinte !== false ? 'checked' : ''}> A empresa é contribuinte do IPI (credita o IPI dos insumos)</label>
    <label class="chk"><input type="checkbox" id="pc-rf" ${p.aq_reforma ? 'checked' : ''}> Mostrar a simulação da reforma no mapa</label>
    <p class="small muted">PRODEPE, FEEF e PIS/COFINS vêm de Fiscal › Apuração › Parâmetros; a alíquota interna, dos Parâmetros da Análise de Competitividade; CBS/IBS por ano, do Simulador da reforma.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pc-ok">Salvar</button>' });
  $('#pc-ok', m.el).onclick = async () => { const t = parseFloat($('#pc-t', m.el).value.replace(',', '.'));
    if (!(t >= 0 && t <= 20)) return toast('Taxa de 0 a 20% ao mês', true);
    try { await q(sb.from('compras_parametros').upsert({ empresa_id: state.empresa.id, cotacao_link_dias: Math.min(60, Math.max(1, +$('#pc-d', m.el).value || 5)), taxa_mensal_vp: t,
        cotacao_mostra_estimado: $('#pc-e', m.el).checked, cotacao_mensagem: $('#pc-m', m.el).value.trim() || null, atualizado_em: new Date().toISOString(),
        aq_prodepe_saidas_pct: Math.min(100, Math.max(0, num($('#pc-pp', m.el).value) || 0)), aq_simples_credito_ibs_pct: Math.min(30, Math.max(0, num($('#pc-sn', m.el).value) || 0)),
        aq_ciap_meses: Math.min(120, Math.max(1, +$('#pc-ci', m.el).value || 48)), aq_ipi_contribuinte: $('#pc-ipi', m.el).checked, aq_reforma: $('#pc-rf', m.el).checked })); m.close(); toast('Parâmetros salvos'); } catch (err) { fail(err); } };
}

// ------------------------------------------------------------ cotação
function cotacao(r, c, citens, pai, root) {
  const v = c || { parcelas_dias: [28], frete: 0 };
  const preco = (i) => citens.find(x => x.cotacao_id === c?.id && x.requisicao_item_id === i.id)?.valor_unitario;
  const ci = (i) => citens.find(x => x.cotacao_id === c?.id && x.requisicao_item_id === i.id) || {};
  const pct = (x) => (x == null || x === '' ? '' : String(+x).replace('.', ','));
  const m = modal({ title: `${c ? 'Editar cotação' : 'Nova cotação'} — requisição nº ${r.numero}`, wide: true, body: `
    <div class="grid-form">
      <label class="span2">Fornecedor *<input id="ct-f" list="ct-forn" value="${esc(v.fornecedor || '')}" placeholder="nome do cadastro ou como veio na proposta">
        <datalist id="ct-forn">${C.fornecedores.map(f => `<option value="${esc(f.nome)}"></option>`).join('')}</datalist></label>
      <label>Prazo de entrega (dias)<input id="ct-pz" value="${v.prazo_entrega_dias ?? ''}"></label>
      <label>Parcelas (dias)<input id="ct-pd" value="${(v.parcelas_dias || []).join('/')}" placeholder="28/56/84"></label>
      <label>Condição (texto)<input id="ct-cd" value="${esc(v.condicao_pagamento || '')}" placeholder="ex.: 28 ddl boleto"></label>
      <label>Frete<input id="ct-fr" value="${(+v.frete || 0).toFixed(2).replace('.', ',')}"></label>
      <label>Válida até<input type="date" id="ct-val" value="${v.validade || ''}"></label>
      <label class="span2">Observação<input id="ct-obs" value="${esc(v.observacao || '')}"></label>
    </div>
    <h3 style="margin:14px 0 6px">Dados fiscais do fornecedor <span class="muted small" style="font-weight:400">decidem os créditos no mapa</span></h3>
    <div class="grid-form">
      <label class="xs">UF de saída<input id="ct-uf" maxlength="2" value="${esc(v.uf || '')}" style="text-transform:uppercase"></label>
      <label>Regime<select id="ct-reg"><option value="">—</option>${REGIMES_FORN.map(([k, t]) => `<option value="${k}" ${v.regime === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Simples: crédito de ICMS permitido (%)<input id="ct-scp" inputmode="decimal" value="${pct(v.simples_credito_pct)}"></label>
      <label>Simples: IBS/CBS pelo regime regular?<select id="ct-sr"><option value="">—</option>${[['sim', 'Sim'], ['nao', 'Não'], ['avaliando', 'Avaliando']].map(([k, t]) => `<option value="${k}" ${v.simples_regular === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div style="align-self:end"><button class="btn ghost small" id="ct-hist" type="button">Preencher pelas notas do fornecedor</button></div></div>
    <p class="small muted" id="ct-hmsg" style="margin:4px 0 0"></p>
    <h3 style="margin:14px 0 6px">Preço e impostos por item</h3>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Quant.</th><th>Valor unitário *</th><th>ICMS %</th><th>IPI %</th><th>ICMS-ST por unid.</th></tr></thead><tbody>
      ${r.itens.map(i => `<tr data-row="${i.id}"><td>${esc(i.descricao)} <span class="muted small">${esc(i.unidade)}${i.ncm ? ' · NCM ' + esc(i.ncm) : ''} · ${esc((DESTINACOES.find(d => d[0] === (i.destinacao || 'insumo')) || [])[1] || '')}</span></td><td class="num">${qtd(i.quantidade)}</td>
        <td><input class="ct-p" data-i="${i.id}" value="${preco(i) != null ? String(+preco(i)).replace('.', ',') : ''}" style="width:120px"></td>
        <td><input class="ct-icms" value="${pct(ci(i).icms_aliq)}" style="width:70px"></td><td><input class="ct-ipi" value="${pct(ci(i).ipi_aliq)}" style="width:70px"></td>
        <td><input class="ct-st" value="${pct(ci(i).st_un)}" style="width:90px"></td></tr>`).join('')}</tbody></table></div>`,
    foot: `${c ? '<button class="btn danger" id="ct-del" style="margin-right:auto">Excluir cotação</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ct-ok">Salvar</button>` });
  $('#ct-del', m.el) && ($('#ct-del', m.el).onclick = async () => {
    if (!await confirmDialog('Excluir esta cotação?')) return;
    try { await q(sb.from('compras_cotacoes').delete().eq('id', c.id)); m.close(); pai.close(); toast('Cotação excluída'); await carregar(root); abrir(R.find(x => x.id === r.id), root); } catch (err) { fail(err); }
  });
  // sugestão pelas notas de entrada do fornecedor (XML importados)
  $('#ct-hist', m.el).onclick = async () => {
    const fav = C.fornecedores.find(f => f.nome.toLowerCase() === $('#ct-f', m.el).value.trim().toLowerCase());
    if (!fav) return toast('Escolha um fornecedor do cadastro para buscar as notas dele', true);
    try {
      const H = await q(sb.rpc('compras_hist_fiscal', { p_empresa: state.empresa.id, p_fav: fav.id }));
      if (!H.length) { $('#ct-hmsg', m.el).textContent = 'Nenhuma nota de entrada deste fornecedor importada na plataforma.'; return; }
      let k = 0;
      r.itens.forEach(i => { const sg = sugestaoFiscal(H, i.ncm), tr = $(`[data-row="${i.id}"]`, m.el); if (!sg || !tr) return;
        if (sg.icms_aliq != null && !$('.ct-icms', tr).value) { $('.ct-icms', tr).value = pct(sg.icms_aliq); k++; }
        if (sg.ipi_aliq != null && !$('.ct-ipi', tr).value) $('.ct-ipi', tr).value = pct(sg.ipi_aliq);
        if (sg.st_un && !$('.ct-st', tr).value) $('.ct-st', tr).value = pct(sg.st_un); });
      const g = sugestaoFiscal(H, '');
      if (g?.uf && !$('#ct-uf', m.el).value) $('#ct-uf', m.el).value = g.uf;
      if (g?.simples && !$('#ct-reg', m.el).value) $('#ct-reg', m.el).value = 'simples';
      $('#ct-hmsg', m.el).textContent = `${H.length} item(ns) de nota encontrados; última em ${dateBR(String(H[0].emissao).slice(0, 10))}. ${k} item(ns) preenchido(s) pelo mesmo NCM. Confira.`;
    } catch (err) { fail(err); }
  };
  $('#ct-ok', m.el).onclick = async (ev) => {
    const forn = $('#ct-f', m.el).value.trim(); if (!forn) return toast('Informe o fornecedor', true);
    const opc = (x) => (x.trim() === '' ? null : num(x));
    const precos = $$('.ct-p', m.el).filter(x => x.value.trim()).map(x => { const tr = x.closest('tr');
      return { requisicao_item_id: x.dataset.i, valor_unitario: num(x.value), icms_aliq: opc($('.ct-icms', tr).value), ipi_aliq: opc($('.ct-ipi', tr).value), st_un: opc($('.ct-st', tr).value),
        fonte_fiscal: $('.ct-icms', tr).value.trim() ? 'comprador' : null }; });
    const uf = $('#ct-uf', m.el).value.trim().toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) return toast('UF de saída inválida', true);
    if (!precos.length) return toast('Informe ao menos um preço', true);
    const fav = C.fornecedores.find(f => f.nome.toLowerCase() === forn.toLowerCase());
    const cab = { fornecedor: forn, favorecido_id: fav?.id || null, prazo_entrega_dias: $('#ct-pz', m.el).value.trim() ? parseInt($('#ct-pz', m.el).value) : null,
      parcelas_dias: lerDias($('#ct-pd', m.el).value), condicao_pagamento: $('#ct-cd', m.el).value.trim() || null, frete: num($('#ct-fr', m.el).value),
      validade: $('#ct-val', m.el).value || null, observacao: $('#ct-obs', m.el).value.trim() || null,
      uf: uf || null, regime: $('#ct-reg', m.el).value || null, simples_credito_pct: opc($('#ct-scp', m.el).value), simples_regular: $('#ct-sr', m.el).value || null };
    ev.target.disabled = true;
    try {
      const e = state.empresa.id; let id = c?.id;
      if (c) { await q(sb.from('compras_cotacoes').update(cab).eq('id', id)); await q(sb.from('compras_cotacao_itens').delete().eq('cotacao_id', id)); }
      else id = (await q(sb.from('compras_cotacoes').insert({ ...cab, empresa_id: e, requisicao_id: r.id }).select('id').single())).id;
      await q(sb.from('compras_cotacao_itens').insert(precos.map(p => ({ ...p, empresa_id: e, cotacao_id: id }))));
      m.close(); pai.close(); toast('Cotação salva'); await carregar(root); abrir(R.find(x => x.id === r.id), root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ------------------------------------------------------------ gerar pedido
function gerarPedido(r, c, citens, pai, root) {
  const m = modal({ title: `Gerar pedido — requisição nº ${r.numero}`, body: `
    <p class="small muted" style="margin-top:0">${c ? `Cotação de <b>${esc(c.fornecedor)}</b>. ` : 'Sem cotação: os preços entram no pedido como estimados e podem ser ajustados enquanto ele estiver em rascunho. '}O pedido nasce em rascunho.</p>
    <label>Fornecedor (cadastro) *<select id="gp-f"><option value="">— escolha —</option>${C.fornecedores.map(f => `<option value="${f.id}" ${c?.favorecido_id === f.id ? 'selected' : ''}>${esc(f.nome)}${f.documento ? ' · ' + esc(f.documento) : ''}</option>`).join('')}</select></label>
    ${c && !c.favorecido_id ? '<p class="small warn">O fornecedor da cotação não está no cadastro. Escolha o cadastro correspondente; se não existir, peça ao Financeiro para cadastrar.</p>' : ''}`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="gp-ok">Gerar pedido</button>` });
  $('#gp-ok', m.el).onclick = async (ev) => {
    const fav = $('#gp-f', m.el).value; if (!fav) return toast('Escolha o fornecedor do cadastro', true);
    ev.target.disabled = true;
    try {
      const e = state.empresa.id;
      const ped = await q(sb.from('compras_pedidos').insert({ empresa_id: e, favorecido_id: fav, requisicao_id: r.id, cotacao_id: c?.id || null,
        centro_custo_id: r.centro_custo_id, frete: c ? +c.frete : 0, parcelas_dias: c?.parcelas_dias?.length ? c.parcelas_dias : [28],
        condicao_pagamento: c?.condicao_pagamento || null, entrega_prevista: c?.prazo_entrega_dias != null ? addDias(today(), c.prazo_entrega_dias) : r.necessidade,
        observacao: r.observacao }).select('id,numero').single());
      const itens = r.itens.map(i => ({ empresa_id: e, pedido_id: ped.id, requisicao_item_id: i.id, produto_id: i.produto_id || null, descricao: i.descricao, unidade: i.unidade, ncm: i.ncm, quantidade: +i.quantidade,
        valor_unitario: c ? +(citens.find(x => x.cotacao_id === c.id && x.requisicao_item_id === i.id)?.valor_unitario || 0) : +(i.valor_estimado || 0) }));
      await q(sb.from('compras_pedido_itens').insert(itens));
      if (c) await q(sb.from('compras_cotacoes').update({ escolhida: true }).eq('id', c.id));
      await q(sb.from('compras_requisicoes').update({ status: 'atendida' }).eq('id', r.id));
      m.close(); pai.close(); toast(`Pedido PC ${ped.numero} criado em rascunho`);
      state.abrir = { tipo: 'pedido', id: ped.id }; location.hash = '#/compras/pedidos';
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

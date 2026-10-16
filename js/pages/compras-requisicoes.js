// Compras › Requisições e cotações: pedir → aprovar (direção) → cotar com fornecedores (mapa comparativo) → gerar o pedido.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { cadCompras, ST_REQ, badge, qtd, inp, unit, num, diasTxt, lerDias, podeAprovar } from '../lib/compras.js';

export const title = 'Requisições e cotações';
const ui = { filtro: 'abertas', busca: '' };
let R = [], C = null;

const FILTROS = [['abertas', 'Em andamento', ['pendente', 'aprovada']], ['pendente', 'Aguardando aprovação', ['pendente']], ['aprovada', 'Aprovadas (cotar)', ['aprovada']],
  ['atendida', 'Viraram pedido', ['atendida']], ['rejeitada', 'Rejeitadas', ['rejeitada']], ['cancelada', 'Canceladas', ['cancelada']], ['todas', 'Todas', null]];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Requisições e cotações</h2><div class="muted small">Quem precisa pede; a direção aprova; Compras cota e gera o pedido.</div></div>
      <button class="btn primary" id="rq-novo">Nova requisição</button></div>
    <div class="card toolbar"><div class="chips" id="rq-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <input id="rq-busca" placeholder="Procurar item, solicitante ou nº" value="${esc(ui.busca)}" style="min-width:240px"></div>
    <div id="rq-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#rq-novo', root).onclick = () => editar(null, root);
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
  return `<tr><td><input class="it-d" value="${esc(i.descricao || '')}" placeholder="ex.: PEBD 2420 virgem" style="min-width:260px"></td>
    <td><input class="it-u" value="${esc(i.unidade || 'UN')}" style="width:64px"></td>
    <td><input class="it-q" value="${i.quantidade ? inp(i.quantidade) : ''}" style="width:100px"></td>
    <td><input class="it-v" value="${i.valor_estimado ? String(+i.valor_estimado).replace('.', ',') : ''}" placeholder="opcional" style="width:110px"></td>
    <td><input class="it-n" value="${esc(i.ncm || '')}" style="width:100px"></td>
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
      <label class="span2">Observação / justificativa<input id="rq-obs" value="${esc(v.observacao || '')}"></label>
    </div>
    <h3 style="margin:14px 0 6px">Itens</h3>
    <div class="table-wrap"><table><thead><tr><th>Descrição *</th><th>Unid.</th><th>Quantidade *</th><th>Valor unit. estimado</th><th>NCM</th><th></th></tr></thead><tbody id="rq-itens">${v.itens.map(linhaItem).join('')}</tbody></table></div>
    <button class="btn ghost small" id="rq-mais" style="margin-top:6px">+ Item</button>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rq-salvar">${r ? 'Salvar' : 'Enviar para aprovação'}</button>` });
  const tb = $('#rq-itens', m.el);
  $('#rq-mais', m.el).onclick = () => tb.insertAdjacentHTML('beforeend', linhaItem());
  tb.onclick = (e) => { if (e.target.closest('.it-x')) e.target.closest('tr').remove(); };
  $('#rq-salvar', m.el).onclick = async (ev) => {
    const itens = $$('tr', tb).map(tr => ({ descricao: $('.it-d', tr).value.trim(), unidade: $('.it-u', tr).value.trim().toUpperCase() || 'UN',
      quantidade: num($('.it-q', tr).value), valor_estimado: $('.it-v', tr).value.trim() ? num($('.it-v', tr).value) : null, ncm: $('.it-n', tr).value.replace(/\D/g, '') || null }))
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
  let cots = [], citens = [], peds = [];
  try {
    [cots, peds] = await Promise.all([q(sb.from('compras_cotacoes').select('*').eq('requisicao_id', r.id).order('criado_em')),
      q(sb.from('compras_pedidos').select('id,numero,status,total').eq('requisicao_id', r.id))]);
    if (cots.length) citens = await q(sb.from('compras_cotacao_itens').select('*').in('cotacao_id', cots.map(c => c.id)));
  } catch (err) { return fail(err); }
  const m = modal({ title: `Requisição nº ${r.numero}`, wide: true, body: '<div id="rq-det"></div>', foot: '<div id="rq-acoes" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const det = $('#rq-det', m.el), ac = $('#rq-acoes', m.el);
  const totalCot = (c) => r.itens.reduce((t, i) => t + (+citens.find(x => x.cotacao_id === c.id && x.requisicao_item_id === i.id)?.valor_unitario || 0) * +i.quantidade, 0) + +c.frete;
  const completa = (c) => r.itens.every(i => citens.some(x => x.cotacao_id === c.id && x.requisicao_item_id === i.id));
  const melhor = cots.filter(completa).sort((a, b) => totalCot(a) - totalCot(b))[0];
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
          ${pr.map(v => `<td class="num ${v != null && v === min && cots.length > 1 ? 'pos' : ''}">${v == null ? '<span class="muted">sem preço</span>' : `${unit(v)}<div class="small muted">${money(v * i.quantidade)}</div>`}</td>`).join('')}</tr>`; }).join('')}
      ${cots.length ? `<tr><td>Frete</td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num">${money(c.frete)}</td>`).join('')}</tr>
        <tr style="font-weight:600"><td>Total</td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num ${c === melhor && cots.length > 1 ? 'pos' : ''}">${money(totalCot(c))}${completa(c) ? '' : '<div class="small neg">incompleta</div>'}</td>`).join('')}</tr>
        <tr><td></td><td></td>${r.itens.some(x => x.valor_estimado) ? '<td></td>' : ''}${cots.map(c => `<td class="num"><div style="display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap">
          ${r.status === 'aprovada' ? `<button class="btn ghost small" data-ec="${c.id}">Editar</button><button class="btn primary small" data-pc="${c.id}">Gerar pedido</button>` : ''}</div>
          ${c.validade ? `<div class="small muted">válida até ${dateBR(c.validade)}</div>` : ''}</td>`).join('')}</tr>` : ''}
    </tbody></table></div>
    ${melhor && cots.filter(completa).length > 1 ? (() => { const mx = Math.max(...cots.filter(completa).map(totalCot)), mn = totalCot(melhor);
      return `<p class="small" style="margin:8px 0 0">Menor total: <b>${esc(melhor.fornecedor)}</b> ${money(mn)} — ${money(mx - mn)} abaixo da cotação mais cara.</p>`; })() : ''}`;
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
    btn('Nova cotação', 'primary', () => cotacao(r, null, [], m, root));
  }
  $$('[data-ec]', det).forEach(b => b.onclick = () => cotacao(r, cots.find(c => c.id === b.dataset.ec), citens, m, root));
  $$('[data-pc]', det).forEach(b => b.onclick = () => gerarPedido(r, cots.find(c => c.id === b.dataset.pc), citens, m, root));
}

// ------------------------------------------------------------ cotação
function cotacao(r, c, citens, pai, root) {
  const v = c || { parcelas_dias: [28], frete: 0 };
  const preco = (i) => citens.find(x => x.cotacao_id === c?.id && x.requisicao_item_id === i.id)?.valor_unitario;
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
    <h3 style="margin:14px 0 6px">Preço unitário por item</h3>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Quant.</th><th>Valor unitário *</th></tr></thead><tbody>
      ${r.itens.map(i => `<tr><td>${esc(i.descricao)} <span class="muted small">${esc(i.unidade)}</span></td><td class="num">${qtd(i.quantidade)}</td>
        <td><input class="ct-p" data-i="${i.id}" value="${preco(i) != null ? String(+preco(i)).replace('.', ',') : ''}" style="width:130px"></td></tr>`).join('')}</tbody></table></div>`,
    foot: `${c ? '<button class="btn danger" id="ct-del" style="margin-right:auto">Excluir cotação</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ct-ok">Salvar</button>` });
  $('#ct-del', m.el) && ($('#ct-del', m.el).onclick = async () => {
    if (!await confirmDialog('Excluir esta cotação?')) return;
    try { await q(sb.from('compras_cotacoes').delete().eq('id', c.id)); m.close(); pai.close(); toast('Cotação excluída'); await carregar(root); abrir(R.find(x => x.id === r.id), root); } catch (err) { fail(err); }
  });
  $('#ct-ok', m.el).onclick = async (ev) => {
    const forn = $('#ct-f', m.el).value.trim(); if (!forn) return toast('Informe o fornecedor', true);
    const precos = $$('.ct-p', m.el).filter(x => x.value.trim()).map(x => ({ requisicao_item_id: x.dataset.i, valor_unitario: num(x.value) }));
    if (!precos.length) return toast('Informe ao menos um preço', true);
    const fav = C.fornecedores.find(f => f.nome.toLowerCase() === forn.toLowerCase());
    const cab = { fornecedor: forn, favorecido_id: fav?.id || null, prazo_entrega_dias: $('#ct-pz', m.el).value.trim() ? parseInt($('#ct-pz', m.el).value) : null,
      parcelas_dias: lerDias($('#ct-pd', m.el).value), condicao_pagamento: $('#ct-cd', m.el).value.trim() || null, frete: num($('#ct-fr', m.el).value),
      validade: $('#ct-val', m.el).value || null, observacao: $('#ct-obs', m.el).value.trim() || null };
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
      const itens = r.itens.map(i => ({ empresa_id: e, pedido_id: ped.id, requisicao_item_id: i.id, descricao: i.descricao, unidade: i.unidade, ncm: i.ncm, quantidade: +i.quantidade,
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

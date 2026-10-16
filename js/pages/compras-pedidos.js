// Compras › Pedidos: rascunho → aprovação (alçada) → enviado → recebido. Aprovado gera previsão no contas a pagar (no banco).
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal, confirmDialog, exportXLSX } from '../lib/ui.js';
import { cadCompras, ST_PED, badge, ABERTOS, qtd, inp, unit, num, diasTxt, lerDias, podeAprovar } from '../lib/compras.js';
import { carregarProdutos, datalistProdutos, ligarItensProduto, produtoDoItem } from '../lib/produtos.js';

export const title = 'Pedidos de compra';
const ui = { filtro: 'andamento', busca: '' };
let P = [], C = null, PRODS = [];
const FILTROS = [['andamento', 'Em andamento', ['rascunho', 'aguardando', 'aprovado', 'enviado', 'recebido_parcial']], ['aguardando', 'Aguardando aprovação', ['aguardando']],
  ['receber', 'A receber', ABERTOS], ['recebido', 'Recebidos', ['recebido']], ['cancelado', 'Cancelados', ['cancelado']], ['todos', 'Todos', null]];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Pedidos de compra</h2><div class="muted small">Pedido aprovado vira previsão no contas a pagar; o recebimento com a nota troca a previsão pelos títulos reais.</div></div>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="pc-xls">Excel</button><button class="btn primary" id="pc-novo">Novo pedido</button></div></div>
    <div class="card toolbar"><div class="chips" id="pc-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <input id="pc-busca" placeholder="Procurar fornecedor, item, nº ou Iniflex" value="${esc(ui.busca)}" style="min-width:260px"></div>
    <div id="pc-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#pc-novo', root).onclick = () => editar(null, root);
  $('#pc-xls', root).onclick = () => exportXLSX($('#pc-lista table', root), 'pedidos_de_compra');
  $('#pc-f', root).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; $$('#pc-f .chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === f)); pintar(root); } };
  $('#pc-busca', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  const ab = state.abrir?.tipo === 'pedido' ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if (ab) { const p = P.find(x => x.id === ab.id); if (p) abrir(p, root); }
}

export async function carregarPedidos() {
  const e = state.empresa.id;
  const [peds, itens] = await Promise.all([fetchAll(() => sb.from('compras_pedidos').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
    fetchAll(() => sb.from('compras_pedido_itens').select('*').eq('empresa_id', e).order('id'))]);
  return peds.map(p => { const it = itens.filter(i => i.pedido_id === p.id);
    const vIt = it.reduce((t, i) => t + i.quantidade * i.valor_unitario, 0), vRec = it.reduce((t, i) => t + Math.min(+i.qtd_recebida, +i.quantidade) * i.valor_unitario, 0);
    return { ...p, itens: it, pctRec: vIt ? vRec / vIt : 0, aReceber: ['cancelado', 'recebido'].includes(p.status) ? 0 : Math.max(+p.total * (1 - (vIt ? vRec / vIt : 0)), 0) }; });
}
async function carregar(root) {
  try { [C, P, PRODS] = await Promise.all([cadCompras(), carregarPedidos(), carregarProdutos().catch(() => [])]); pintar(root); }
  catch (err) { fail(err); $('#pc-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}

function pintar(root) {
  const sts = FILTROS.find(f => f[0] === ui.filtro)[2], b = ui.busca.trim().toLowerCase(), h = today();
  const vis = P.filter(p => (!sts || sts.includes(p.status)) && (!b || String(p.numero) === b.replace(/\D/g, '') || (p.pedido_iniflex || '').toLowerCase().includes(b)
    || (C.forById[p.favorecido_id]?.nome || '').toLowerCase().includes(b) || p.itens.some(i => i.descricao.toLowerCase().includes(b))));
  $('#pc-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Entrega prevista</th><th>Pagamento</th><th class="num">Total</th><th class="num">Recebido</th><th>Iniflex</th><th>Situação</th></tr></thead><tbody>
    ${vis.map(p => `<tr class="clickable" data-id="${p.id}"><td>PC ${p.numero}</td><td>${dateBR(p.data_pedido)}</td><td>${esc(C.forById[p.favorecido_id]?.nome || '–')}</td>
      <td class="wrap">${esc(p.itens.slice(0, 2).map(i => i.descricao).join(' · '))}${p.itens.length > 2 ? ` <span class="muted">+${p.itens.length - 2}</span>` : ''}</td>
      <td class="${p.entrega_prevista && p.entrega_prevista < h && ABERTOS.includes(p.status) ? 'neg' : ''}">${dateBR(p.entrega_prevista)}</td><td>${esc(p.condicao_pagamento || diasTxt(p.parcelas_dias))}</td>
      <td class="num">${money(p.total)}</td><td class="num">${p.pctRec ? Math.round(p.pctRec * 100) + '%' : ''}</td><td>${esc(p.pedido_iniflex || '')}</td><td>${badge(ST_PED, p.status)}</td></tr>`).join('')
    || '<tr><td colspan="10" class="empty">Nenhum pedido neste filtro.</td></tr>'}</tbody></table></div></div>`;
  $$('#pc-lista tr[data-id]', root).forEach(tr => tr.onclick = () => abrir(P.find(p => p.id === tr.dataset.id), root));
}

// ------------------------------------------------------------ editar (rascunho/aguardando) ou criar avulso
function linhaItem(i = {}) {
  return `<tr><td><input class="it-d" list="dl-prod" ${i.produto_id ? `data-prod="${i.produto_id}"` : ''} value="${esc(i.descricao || '')}" style="min-width:240px"></td><td><input class="it-u" value="${esc(i.unidade || 'UN')}" style="width:60px"></td>
    <td><input class="it-q" value="${i.quantidade ? inp(i.quantidade) : ''}" style="width:95px"></td><td><input class="it-v" value="${i.valor_unitario != null ? String(+i.valor_unitario).replace('.', ',') : ''}" style="width:110px"></td>
    <td><input class="it-n" value="${esc(i.ncm || '')}" style="width:95px"></td><td class="num it-t"></td><td><button class="btn ghost icon it-x">✕</button></td></tr>`;
}
function editar(p, root) {
  const v = p || { data_pedido: today(), parcelas_dias: [28], frete: 0, desconto: 0, itens: [{}] };
  const so = (id, lista, sel, rot) => `<select id="${id}"><option value="">—</option>${lista.map(x => `<option value="${x.id}" ${sel === x.id ? 'selected' : ''}>${esc(rot(x))}</option>`).join('')}</select>`;
  const m = modal({ title: p ? `PC ${p.numero} — editar` : 'Novo pedido de compra (avulso)', wide: true, body: `
    <div class="grid-form">
      <label class="span2">Fornecedor *${so('pe-f', C.fornecedores, v.favorecido_id, f => f.nome + (f.documento ? ' · ' + f.documento : ''))}</label>
      <label>Data do pedido<input type="date" id="pe-dt" value="${v.data_pedido || today()}"></label>
      <label>Entrega prevista<input type="date" id="pe-ent" value="${v.entrega_prevista || ''}"></label>
      <label>Parcelas (dias após a entrega)<input id="pe-pd" value="${(v.parcelas_dias || []).join('/')}" placeholder="28/56/84 ou 0 à vista"></label>
      <label>Condição (texto)<input id="pe-cd" value="${esc(v.condicao_pagamento || '')}" placeholder="ex.: boleto 28 ddl"></label>
      <label class="span2">Classificação (plano de contas) <span class="muted small">obrigatória para aprovar</span>${so('pe-pl', C.planos, v.plano_id, x => `${x.codigo} - ${x.nome}`)}</label>
      <label>Centro de custo${so('pe-cc', C.centros, v.centro_custo_id, x => x.nome)}</label>
      <label>Nº do pedido no Iniflex<input id="pe-ini" value="${esc(v.pedido_iniflex || '')}"></label>
      <label>Frete<input id="pe-fr" value="${(+v.frete || 0).toFixed(2).replace('.', ',')}"></label>
      <label>Desconto<input id="pe-ds" value="${(+v.desconto || 0).toFixed(2).replace('.', ',')}"></label>
      <label class="span2">Observação<input id="pe-obs" value="${esc(v.observacao || '')}"></label>
    </div>
    <h3 style="margin:14px 0 6px">Itens <span class="muted small" style="font-weight:400">escolha o produto do cadastro na lista ou escreva livre</span></h3>${datalistProdutos('dl-prod', PRODS)}
    <div class="table-wrap"><table><thead><tr><th>Descrição *</th><th>Unid.</th><th>Quantidade *</th><th>Valor unit. *</th><th>NCM</th><th class="num">Total</th><th></th></tr></thead><tbody id="pe-itens">${v.itens.map(linhaItem).join('')}</tbody></table></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><button class="btn ghost small" id="pe-mais">+ Item</button><b id="pe-tot"></b></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pe-ok">Salvar</button>` });
  const tb = $('#pe-itens', m.el);
  ligarItensProduto(tb, PRODS);
  const somar = () => { let t = 0; $$('tr', tb).forEach(tr => { const s = num($('.it-q', tr).value) * num($('.it-v', tr).value); t += s; $('.it-t', tr).textContent = s ? money(s) : ''; });
    $('#pe-tot', m.el).textContent = 'Total do pedido: ' + money(t + num($('#pe-fr', m.el).value) - num($('#pe-ds', m.el).value)); };
  m.el.addEventListener('input', somar); somar();
  $('#pe-mais', m.el).onclick = () => tb.insertAdjacentHTML('beforeend', linhaItem());
  tb.onclick = (e) => { if (e.target.closest('.it-x')) { e.target.closest('tr').remove(); somar(); } };
  $('#pe-ok', m.el).onclick = async (ev) => {
    const itens = $$('tr', tb).map(tr => ({ produto_id: produtoDoItem(tr), descricao: $('.it-d', tr).value.trim(), unidade: $('.it-u', tr).value.trim().toUpperCase() || 'UN', quantidade: num($('.it-q', tr).value),
      valor_unitario: num($('.it-v', tr).value), ncm: $('.it-n', tr).value.replace(/\D/g, '') || null })).filter(i => i.descricao || i.quantidade);
    const cab = { favorecido_id: $('#pe-f', m.el).value || null, data_pedido: $('#pe-dt', m.el).value || today(), entrega_prevista: $('#pe-ent', m.el).value || null,
      parcelas_dias: lerDias($('#pe-pd', m.el).value).length ? lerDias($('#pe-pd', m.el).value) : [0], condicao_pagamento: $('#pe-cd', m.el).value.trim() || null,
      plano_id: $('#pe-pl', m.el).value || null, centro_custo_id: $('#pe-cc', m.el).value || null, pedido_iniflex: $('#pe-ini', m.el).value.trim() || null,
      frete: num($('#pe-fr', m.el).value), desconto: num($('#pe-ds', m.el).value), observacao: $('#pe-obs', m.el).value.trim() || null };
    if (!cab.favorecido_id) return toast('Escolha o fornecedor', true);
    if (!itens.length || itens.some(i => !i.descricao || !(i.quantidade > 0))) return toast('Cada item precisa de descrição e quantidade', true);
    ev.target.disabled = true;
    try {
      const e = state.empresa.id; let id = p?.id;
      if (p) {
        await q(sb.from('compras_pedidos').update(cab).eq('id', id));
        const ant = p.itens.map(i => i.id), fica = [];
        // mantém o vínculo com a requisição quando a linha é a mesma (pela posição)
        for (const [k, i] of itens.entries()) { if (p.itens[k]) { await q(sb.from('compras_pedido_itens').update(i).eq('id', p.itens[k].id)); fica.push(p.itens[k].id); }
          else await q(sb.from('compras_pedido_itens').insert({ ...i, empresa_id: e, pedido_id: id })); }
        const sai = ant.filter(x => !fica.includes(x)); if (sai.length) await q(sb.from('compras_pedido_itens').delete().in('id', sai));
      } else {
        id = (await q(sb.from('compras_pedidos').insert({ ...cab, empresa_id: e }).select('id').single())).id;
        await q(sb.from('compras_pedido_itens').insert(itens.map(i => ({ ...i, empresa_id: e, pedido_id: id }))));
      }
      m.close(); toast('Pedido salvo'); await carregar(root); abrir(P.find(x => x.id === id), root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ------------------------------------------------------------ detalhe e ações
async function abrir(p, root) {
  if (!p) return;
  let recs = [], lancs = [];
  try {
    recs = await q(sb.from('compras_recebimentos').select('id,data,nfe_nota_id,divergencias,observacao').eq('pedido_id', p.id).order('data'));
    if (state.papel !== 'compras') {
      const lk = await q(sb.from('compras_pedido_lancamentos').select('lancamento_id,tipo').eq('pedido_id', p.id));
      if (lk.length) lancs = (await q(sb.from('lancamentos').select('id,data,valor,status,descricao').in('id', lk.map(x => x.lancamento_id)).order('data'))).map(l => ({ ...l, tipo: lk.find(x => x.lancamento_id === l.id).tipo }));
    }
  } catch (err) { return fail(err); }
  const alc = +(C.parametros?.alcada_valor ?? 5000), f = C.forById[p.favorecido_id];
  const m = modal({ title: `Pedido de compra PC ${p.numero}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Situação</span><div>${badge(ST_PED, p.status)}</div></div>
      <div class="span2"><span class="muted">Fornecedor</span><div>${esc(f?.nome || '–')}${f?.documento ? ` <span class="muted">${esc(f.documento)}</span>` : ''}</div></div>
      <div><span class="muted">Data</span><div>${dateBR(p.data_pedido)}</div></div>
      <div><span class="muted">Entrega prevista</span><div>${dateBR(p.entrega_prevista) || '–'}</div></div>
      <div><span class="muted">Pagamento</span><div>${esc(p.condicao_pagamento || '')} ${diasTxt(p.parcelas_dias)}</div></div>
      <div class="span2"><span class="muted">Classificação</span><div>${esc(C.planoById[p.plano_id] ? `${C.planoById[p.plano_id].codigo} - ${C.planoById[p.plano_id].nome}` : '— falta definir')}</div></div>
      <div><span class="muted">Centro de custo</span><div>${esc(C.ccById[p.centro_custo_id]?.nome || '–')}</div></div>
      <div><span class="muted">Iniflex</span><div>${esc(p.pedido_iniflex || '–')}</div></div>
      ${p.aprovado_em ? `<div><span class="muted">Aprovado em</span><div>${dateBR(p.aprovado_em)}</div></div>` : ''}
    </div>
    ${p.observacao ? `<p class="small" style="margin:8px 0 0"><span class="muted">Observação:</span> ${esc(p.observacao)}</p>` : ''}
    ${p.motivo ? `<p class="small neg" style="margin:6px 0 0">Motivo: ${esc(p.motivo)}</p>` : ''}
    ${['rascunho', 'aguardando'].includes(p.status) && p.total > alc ? `<p class="small" style="margin:8px 0 0">Acima da alçada de ${money(alc)}: a aprovação é da direção.</p>` : ''}
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Item</th><th class="num">Quant.</th><th class="num">Recebido</th><th class="num">Unitário</th><th class="num">Total</th></tr></thead><tbody>
      ${p.itens.map(i => `<tr><td class="wrap">${esc(i.descricao)} <span class="muted small">${esc(i.unidade)}${i.ncm ? ' · NCM ' + esc(i.ncm) : ''}</span></td><td class="num">${qtd(i.quantidade)}</td>
        <td class="num ${+i.qtd_recebida >= +i.quantidade ? 'pos' : ''}">${+i.qtd_recebida ? qtd(i.qtd_recebida) : ''}</td><td class="num">${unit(i.valor_unitario)}</td><td class="num">${money(i.quantidade * i.valor_unitario)}</td></tr>`).join('')}
      ${+p.frete ? `<tr><td colspan="4">Frete</td><td class="num">${money(p.frete)}</td></tr>` : ''}${+p.desconto ? `<tr><td colspan="4">Desconto</td><td class="num">−${money(p.desconto)}</td></tr>` : ''}
      <tr style="font-weight:600"><td colspan="4">Total</td><td class="num">${money(p.total)}</td></tr></tbody></table></div>
    ${recs.length ? `<h3 style="margin:14px 0 6px">Recebimentos</h3>${recs.map(r => `<div class="small">${dateBR(r.data)} ${r.nfe_nota_id ? '· com nota' : '· sem nota'}${(r.divergencias || []).length ? ` · <span class="warn">${r.divergencias.length} divergência(s)</span>` : ''}${r.observacao ? ' · ' + esc(r.observacao) : ''}</div>`).join('')}` : ''}
    ${lancs.length ? `<h3 style="margin:14px 0 6px">No contas a pagar</h3><div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Origem</th><th>Descrição</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
      ${lancs.map(l => `<tr><td>${dateBR(l.data)}</td><td>${l.tipo === 'previsao' ? 'Previsão do pedido' : 'Parcela da nota'}</td><td class="wrap">${esc(l.descricao || '')}</td><td class="num">${money(l.valor)}</td><td>${l.status}</td></tr>`).join('')}</tbody></table></div>`
      : (ABERTOS.includes(p.status) && state.papel !== 'compras' && C.parametros?.previsao_automatica !== false ? '<p class="small muted">Sem previsão no contas a pagar.</p>' : '')}`,
    foot: '<div id="pc-acoes" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const ac = $('#pc-acoes', m.el);
  const btn = (t, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = t; b.onclick = fn; ac.appendChild(b); };
  const mudar = async (dados, msg) => { try { await q(sb.from('compras_pedidos').update(dados).eq('id', p.id)); toast(msg); m.close(); await carregar(root); abrir(P.find(x => x.id === p.id), root); } catch (err) { fail(err); } };
  const cancelar = () => { const mot = prompt('Motivo do cancelamento:'); if (mot?.trim()) mudar({ status: 'cancelado', motivo: mot.trim() }, 'Pedido cancelado'); };
  btn('Imprimir', 'ghost', () => imprimir(p));
  if (p.status !== 'cancelado' && p.status !== 'recebido') btn('Cancelar pedido', 'ghost', cancelar);
  if (['rascunho', 'aguardando'].includes(p.status)) btn('Editar', '', () => { m.close(); editar(p, root); });
  if (['aguardando', 'aprovado', 'enviado'].includes(p.status) && !recs.length) btn('Voltar para rascunho', '', () => mudar({ status: 'rascunho' }, 'Pedido voltou para rascunho'));
  const aprova = podeAprovar() || +p.total <= alc;
  if (p.status === 'rascunho' && !aprova) btn('Enviar para aprovação', 'primary', () => mudar({ status: 'aguardando', motivo: null }, 'Pedido enviado para aprovação'));
  if (['rascunho', 'aguardando'].includes(p.status) && aprova) btn('Aprovar', 'primary', () => {
    if (!p.plano_id) return toast('Defina a classificação (plano de contas) no pedido antes de aprovar', true);
    mudar({ status: 'aprovado', motivo: null }, 'Pedido aprovado');
  });
  if (p.status === 'aprovado') btn('Marcar como enviado', '', () => mudar({ status: 'enviado' }, 'Pedido marcado como enviado'));
  if (ABERTOS.includes(p.status)) {
    btn('Pagamento antecipado', '', () => { m.close(); state.abrir = { tipo: 'pa-novo', v: { razao_social: f?.nome || '', cnpj: (f?.documento || '').replace(/\D/g, ''), favorecido_id: p.favorecido_id,
      valor: p.aReceber ? Math.round(p.aReceber * 100) / 100 : +p.total, pedido: `PC ${p.numero}${p.pedido_iniflex ? ' / Iniflex ' + p.pedido_iniflex : ''}`,
      descricao: `Antecipado do pedido PC ${p.numero} — ${p.itens.map(i => i.descricao).join(', ')}`.slice(0, 200), plano_id: p.plano_id, centro_custo_id: p.centro_custo_id } }; location.hash = '#/paraquedas'; });
    btn('Receber', 'primary', () => { m.close(); state.abrir = { tipo: 'receber', id: p.id }; location.hash = '#/compras/recebimentos'; });
  }
}

function imprimir(p) {
  const f = C.forById[p.favorecido_id], w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pedido de compra PC ${p.numero}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;margin:28px;color:#111} h1{font-size:18px;margin:0} table{width:100%;border-collapse:collapse;margin-top:14px}
    th,td{border:1px solid #999;padding:5px 7px;text-align:left} td.n,th.n{text-align:right} .cab{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-top:12px} .ass{margin-top:60px;display:flex;gap:60px} .ass div{border-top:1px solid #111;padding-top:4px;width:240px;text-align:center}</style></head><body>
    <div class="cab"><div><h1>PEDIDO DE COMPRA Nº ${p.numero}</h1><div>${esc(state.empresa.nome || '')}</div></div><div>Data: ${dateBR(p.data_pedido)}${p.pedido_iniflex ? `<br>Iniflex: ${esc(p.pedido_iniflex)}` : ''}</div></div>
    <div class="g"><div><b>Fornecedor:</b> ${esc(f?.nome || '')}</div><div><b>CNPJ/CPF:</b> ${esc(f?.documento || '')}</div>
      <div><b>Entrega prevista:</b> ${dateBR(p.entrega_prevista) || 'a combinar'}</div><div><b>Pagamento:</b> ${esc(p.condicao_pagamento || '')} ${diasTxt(p.parcelas_dias)}</div></div>
    <table><thead><tr><th>#</th><th>Descrição</th><th>Unid.</th><th class="n">Quant.</th><th class="n">Unitário</th><th class="n">Total</th></tr></thead><tbody>
    ${p.itens.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.descricao)}${i.ncm ? ` (NCM ${esc(i.ncm)})` : ''}</td><td>${esc(i.unidade)}</td><td class="n">${qtd(i.quantidade)}</td><td class="n">${unit(i.valor_unitario)}</td><td class="n">${money(i.quantidade * i.valor_unitario)}</td></tr>`).join('')}
    ${+p.frete ? `<tr><td colspan="5">Frete</td><td class="n">${money(p.frete)}</td></tr>` : ''}${+p.desconto ? `<tr><td colspan="5">Desconto</td><td class="n">−${money(p.desconto)}</td></tr>` : ''}
    <tr><td colspan="5"><b>Total</b></td><td class="n"><b>${money(p.total)}</b></td></tr></tbody></table>
    ${p.observacao ? `<p><b>Observação:</b> ${esc(p.observacao)}</p>` : ''}
    <p style="margin-top:14px">Informar o número deste pedido na nota fiscal.</p>
    <div class="ass"><div>Comprador</div><div>Aprovação</div></div>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

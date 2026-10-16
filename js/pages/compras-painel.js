// Compras › Painel: o que está parado, o que está para chegar, quanto já está comprometido e com quem se compra.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, esc, money0, dateBR, today, fail, toast, modal, pct } from '../lib/ui.js';
import { kpiGrid, drawer, barList, tabela } from '../lib/componentes.js';
import { cadCompras, ST_PED, ST_REQ, badge, ABERTOS, podeAprovar, num } from '../lib/compras.js';
import { carregarPedidos } from './compras-pedidos.js';

export const title = 'Painel de Compras';
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Painel de Compras</h2><div class="muted small">Requisições, pedidos e entregas. Clique nos indicadores para ver a lista.</div></div>
      <div style="display:flex;gap:8px">${podeAprovar() ? '<button class="btn ghost" id="cp-par">Parâmetros</button>' : ''}<a class="btn primary" href="#/compras/requisicoes">Requisições</a></div></div>
    <div id="cp-corpo"><div class="loading">Carregando…</div></div>`;
  let C, P, reqs, cots, citens, recs;
  try {
    const e = state.empresa.id, d90 = addDias(today(), -90);
    [C, P, reqs, cots, recs] = await Promise.all([cadCompras(true), carregarPedidos(),
      fetchAll(() => sb.from('compras_requisicoes').select('id,numero,status,solicitante,criado_em,necessidade,prioridade').eq('empresa_id', e).order('id')),
      fetchAll(() => sb.from('compras_cotacoes').select('id,requisicao_id,frete,escolhida').eq('empresa_id', e).gte('criado_em', d90).order('id')),
      fetchAll(() => sb.from('compras_recebimentos').select('pedido_id,data').eq('empresa_id', e).order('id'))]);
    citens = cots.length ? await fetchAll(() => sb.from('compras_cotacao_itens').select('cotacao_id,requisicao_item_id,valor_unitario').in('cotacao_id', cots.map(c => c.id)).order('id')) : [];
  } catch (err) { fail(err); $('#cp-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  if ($('#cp-par', root)) $('#cp-par', root).onclick = () => parametros(C, root);

  const h = today(), nome = (p) => C.forById[p.favorecido_id]?.nome || '–';
  const reqPend = reqs.filter(r => r.status === 'pendente'), reqCotar = reqs.filter(r => r.status === 'aprovada');
  const pedAg = P.filter(p => p.status === 'aguardando'), abertos = P.filter(p => ABERTOS.includes(p.status));
  const atrasados = abertos.filter(p => p.entrega_prevista && p.entrega_prevista < h), semana = abertos.filter(p => p.entrega_prevista && p.entrega_prevista >= h && p.entrega_prevista <= addDias(h, 7));
  const comprometido = abertos.reduce((t, p) => t + p.aReceber, 0);

  // economia: por requisição com 2+ cotações completas, maior total − total da escolhida
  const reqItens = {}; for (const c of citens) (reqItens[c.cotacao_id] ||= []).push(c);
  let economia = 0, nEco = 0;
  const porReq = {}; for (const c of cots) (porReq[c.requisicao_id] ||= []).push(c);
  for (const [rid, cs] of Object.entries(porReq)) {
    const esc_ = cs.find(c => c.escolhida); if (!esc_ || cs.length < 2) continue;
    const ped = P.find(p => p.cotacao_id === esc_.id); if (!ped) continue;
    const tot = (c) => (reqItens[c.id] || []).reduce((t, x) => { const it = ped.itens.find(i => i.requisicao_item_id === x.requisicao_item_id); return t + (it ? it.quantidade * x.valor_unitario : 0); }, 0) + +c.frete;
    const mx = Math.max(...cs.map(tot)); if (mx > tot(esc_)) { economia += mx - tot(esc_); nEco++; }
  }
  // prazo médio de entrega: 1º recebimento − data do pedido (últimos 90 dias)
  const prim = {}; for (const r of recs) if (!prim[r.pedido_id] || r.data < prim[r.pedido_id]) prim[r.pedido_id] = r.data;
  const lead = P.filter(p => prim[p.id] && prim[p.id] >= addDias(h, -90)).map(p => (new Date(prim[p.id]) - new Date(p.data_pedido)) / 864e5);
  const leadMed = lead.length ? lead.reduce((t, v) => t + v, 0) / lead.length : null;

  const listaPed = (arr) => tabela([{ titulo: 'Pedido' }, { titulo: 'Fornecedor' }, { titulo: 'Entrega' }, { titulo: 'Situação' }, { titulo: 'Valor', num: true }],
    arr.map(p => ({ celulas: [`PC ${p.numero}`, nome(p), dateBR(p.entrega_prevista) || '–', { html: badge(ST_PED, p.status) }, money0(ABERTOS.includes(p.status) ? p.aReceber : p.total)],
      onClick: () => { document.querySelector('.cp-drawer-back')?.remove(); state.abrir = { tipo: 'pedido', id: p.id }; location.hash = '#/compras/pedidos'; } })));
  const listaReq = (arr) => tabela([{ titulo: 'Nº' }, { titulo: 'Solicitante' }, { titulo: 'Pedida em' }, { titulo: 'Precisa até' }, { titulo: 'Situação' }],
    arr.map(r => ({ celulas: [r.numero, r.solicitante || '', dateBR(r.criado_em), dateBR(r.necessidade) || '–', { html: badge(ST_REQ, r.status) + (r.prioridade === 'urgente' ? ' <span class="badge vencido">urgente</span>' : '') }],
      onClick: () => { document.querySelector('.cp-drawer-back')?.remove(); state.abrir = { tipo: 'requisicao', id: r.id }; location.hash = '#/compras/requisicoes'; } })));
  const KP = {
    reqp: { label: 'Requisições aguardando aprovação', valor: String(reqPend.length), tom: reqPend.length ? 'warn' : '', sub: `${reqCotar.length} aprovada(s) para cotar`, abrir: () => drawer({ titulo: 'Requisições aguardando aprovação', corpo: listaReq(reqPend.concat(reqCotar)) }) },
    pedag: { label: 'Pedidos aguardando aprovação', valor: String(pedAg.length), tom: pedAg.length ? 'warn' : '', sub: money0(pedAg.reduce((t, p) => t + +p.total, 0)), abrir: () => drawer({ titulo: 'Pedidos aguardando aprovação', corpo: listaPed(pedAg) }) },
    ab: { label: 'Comprometido a receber', valor: money0(comprometido), sub: `${abertos.length} pedido(s) aprovado(s)`, abrir: () => drawer({ titulo: 'Pedidos aprovados a receber', subtitulo: money0(comprometido), corpo: listaPed(abertos) }) },
    atr: { label: 'Entregas atrasadas', valor: String(atrasados.length), tom: atrasados.length ? 'neg' : '', sub: money0(atrasados.reduce((t, p) => t + p.aReceber, 0)), abrir: () => drawer({ titulo: 'Entregas atrasadas', corpo: listaPed(atrasados) }) },
    sem: { label: 'Chegam em 7 dias', valor: String(semana.length), sub: money0(semana.reduce((t, p) => t + p.aReceber, 0)), abrir: () => drawer({ titulo: 'Entregas previstas para os próximos 7 dias', corpo: listaPed(semana) }) },
    eco: { label: 'Economia nas cotações (90 dias)', valor: money0(economia), tom: economia ? 'pos' : '', sub: `${nEco} compra(s) com 2+ cotações`, abrir: () => drawer({ titulo: 'Economia nas cotações', corpo: '<p class="small">Para cada pedido gerado de cotação, nos últimos 90 dias, com duas ou mais propostas: total da proposta mais cara − total da escolhida, nas quantidades do pedido, com frete.</p>' }) },
    lead: { label: 'Prazo médio de entrega', valor: leadMed == null ? '–' : `${Math.round(leadMed)} dias`, sub: `${lead.length} pedido(s) recebidos em 90 dias`, abrir: () => drawer({ titulo: 'Prazo médio de entrega', corpo: '<p class="small">Dias entre a data do pedido e o primeiro recebimento, nos pedidos recebidos nos últimos 90 dias.</p>' }) },
  };
  const c90 = P.filter(p => p.status !== 'cancelado' && p.status !== 'rascunho' && p.data_pedido >= addDias(h, -90));
  const porF = {}; for (const p of c90) { const k = nome(p); (porF[k] ||= { nome: k, valor: 0, n: 0 }); porF[k].valor += +p.total; porF[k].n++; }
  const totF = Object.values(porF).reduce((t, x) => t + x.valor, 0);
  const corpo = $('#cp-corpo', root);
  corpo.innerHTML = `<div id="cp-kpis"></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2 style="margin:0">Entregas atrasadas e da semana</h2></div><div id="cp-ent"></div></div>
      <div class="card"><div class="card-head"><h2 style="margin:0">Maiores fornecedores — 90 dias</h2><span class="muted small">${money0(totF)} em pedidos</span></div><div id="cp-forn"></div></div>
    </div>`;
  kpiGrid($('#cp-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k, clicavel: true })), (id) => KP[id].abrir());
  $('#cp-ent', corpo).append(listaPed(atrasados.concat(semana)));
  barList($('#cp-forn', corpo), Object.values(porF).sort((a, b) => b.valor - a.valor).slice(0, 10).map(x => ({ nome: x.nome, valor: x.valor, txt: `${money0(x.valor)} · ${pct(x.valor / totF)}`, sub: `${x.n} pedido(s)` })), { vazio: 'Nenhum pedido nos últimos 90 dias.' });
}

function parametros(C, root) {
  const v = C.parametros || {};
  const m = modal({ title: 'Parâmetros de Compras', body: `
    <label>Alçada: pedido acima deste valor precisa de admin ou diretor<input id="pp-alc" value="${(+(v.alcada_valor ?? 5000)).toFixed(2).replace('.', ',')}"></label>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="pp-prev" ${v.previsao_automatica !== false ? 'checked' : ''}> Pedido aprovado gera previsão no contas a pagar</label>
    <p class="small muted">A previsão é refeita quando o pedido muda e sai quando ele é recebido ou cancelado.</p>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pp-ok">Salvar</button>` });
  $('#pp-ok', m.el).onclick = async () => {
    try { await q(sb.rpc('compras_salvar_parametros', { p_empresa: state.empresa.id, p_alcada: num($('#pp-alc', m.el).value), p_previsao: $('#pp-prev', m.el).checked }));
      m.close(); toast('Parâmetros salvos'); render(root); } catch (err) { fail(err); }
  };
}

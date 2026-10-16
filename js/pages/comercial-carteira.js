// Comercial › Carteira e agenda: clientes com situação (ativo/novo/esfriando/inativo), ficha do cliente (compras, produtos,
// financeiro, contatos) e a agenda de próximos contatos.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, money0, dateBR, today, fail, toast, modal, exportXLSX, pct } from '../lib/ui.js';
import { baseComercial, limparBaseComercial, ST_CLI, TIPOS_INT, podeEditarCom, interno, addDias } from '../lib/comercial.js';
import { badge, qtd, unit } from '../lib/compras.js';

export const title = 'Carteira de clientes';
const ui = { aba: 'carteira', st: '', busca: '', rep: '' };
let B = null, AG = [];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Carteira de clientes</h2><div class="muted small">Situação pelo histórico de notas: esfriando = sem comprar há mais de 1,5× o intervalo normal do cliente; inativo = 180+ dias.</div></div>
      <button class="btn ghost" id="cc-xls">Excel</button></div>
    <div class="card toolbar"><div class="chips" id="cc-aba"><span class="chip ${ui.aba === 'carteira' ? 'on' : ''}" data-a="carteira">Carteira</span><span class="chip ${ui.aba === 'agenda' ? 'on' : ''}" data-a="agenda">Agenda de contatos</span></div></div>
    <div id="cc-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#cc-aba', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; $$('#cc-aba .chip', root).forEach(c => c.classList.toggle('on', c.dataset.a === a)); pintar(root); } };
  $('#cc-xls', root).onclick = () => exportXLSX($('#cc-corpo table', root), 'carteira_clientes');
  const ab = state.abrir?.tipo === 'cliente' ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if (ab) ficha(ab.id, root);
}
async function carregar(root) {
  try {
    B = await baseComercial(true);
    AG = await q(sb.from('comercial_interacoes').select('id,favorecido_id,tipo,data,resumo,proximo_contato,proximo_assunto,concluido,vendedor_id').eq('empresa_id', state.empresa.id)
      .eq('concluido', false).not('proximo_contato', 'is', null).order('proximo_contato'));
    pintar(root);
  } catch (err) { fail(err); $('#cc-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}
const linhas = () => {
  const ag = {}; for (const a of AG) if (!ag[a.favorecido_id] || a.proximo_contato < ag[a.favorecido_id]) ag[a.favorecido_id] = a.proximo_contato;
  return B.clientes.map(c => ({ c, i: B.info[c.id] || { st: 'sem', v12: 0, v12a: 0 }, prox: ag[c.id] }));
};
function pintar(root) {
  const corpo = $('#cc-corpo', root), h = today();
  if (ui.aba === 'agenda') {
    const nome = Object.fromEntries(B.clientes.map(c => [c.id, c.nome]));
    corpo.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Cliente</th><th>Assunto</th><th>Último contato</th><th></th></tr></thead><tbody>
      ${AG.map(a => `<tr class="clickable" data-f="${a.favorecido_id || ''}"><td class="${a.proximo_contato < h ? 'neg' : a.proximo_contato === h ? 'warn' : ''}">${dateBR(a.proximo_contato)}</td><td>${esc(nome[a.favorecido_id] || '–')}</td>
        <td class="wrap">${esc(a.proximo_assunto || '')}</td><td class="wrap small">${esc(TIPOS_INT[a.tipo])} ${dateBR(a.data)}: ${esc(a.resumo)}</td>
        <td>${podeEditarCom() ? `<button class="btn ghost small" data-ok="${a.id}">Feito</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum contato agendado.</td></tr>'}</tbody></table></div></div>`;
    $$('[data-ok]', corpo).forEach(b => b.onclick = async (e) => { e.stopPropagation(); try { await q(sb.from('comercial_interacoes').update({ concluido: true }).eq('id', b.dataset.ok)); await carregar(root); } catch (err) { fail(err); } });
    $$('tr[data-f]', corpo).forEach(tr => tr.onclick = () => tr.dataset.f && ficha(tr.dataset.f, root));
    return;
  }
  const L = linhas(), b = ui.busca.trim().toLowerCase();
  const reps = [...new Map(B.clientes.filter(c => c.representante_id).map(c => [c.representante_id, c.representante])).entries()];
  const cnt = {}; for (const x of L) cnt[x.i.st] = (cnt[x.i.st] || 0) + 1;
  const vis = L.filter(x => (!ui.st || x.i.st === ui.st) && (!ui.rep || x.c.representante_id === ui.rep) && (!b || [x.c.nome, x.c.nome_fantasia, x.c.documento].some(v => String(v || '').toLowerCase().includes(b))))
    .sort((a, c) => c.i.v12 - a.i.v12);
  corpo.innerHTML = `<div class="card toolbar"><div class="chips" id="cc-st"><span class="chip ${!ui.st ? 'on' : ''}" data-s="">Todos · ${L.length}</span>${Object.entries(ST_CLI).filter(([k]) => cnt[k]).map(([k, [t]]) => `<span class="chip ${ui.st === k ? 'on' : ''}" data-s="${k}">${t} · ${cnt[k]}</span>`).join('')}</div>
      ${interno() && reps.length ? `<label>Representante<select id="cc-rep"><option value="">Todos</option>${reps.map(([id, n]) => `<option value="${id}" ${ui.rep === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
      <input id="cc-b" placeholder="Procurar cliente ou CNPJ" value="${esc(ui.busca)}" style="min-width:220px"></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:66vh"><table><thead><tr><th>Cliente</th><th>Representante</th><th>Situação</th><th>Última compra</th><th class="num">Intervalo médio</th><th class="num">12 meses</th><th class="num">Variação</th><th>Próximo contato</th></tr></thead><tbody>
    ${vis.map(({ c, i, prox }) => `<tr class="clickable" data-id="${c.id}"><td class="wrap">${esc(c.nome)}${c.nome_fantasia ? ` <span class="muted small">${esc(c.nome_fantasia)}</span>` : ''}</td><td>${esc(c.representante || '')}</td>
      <td>${badge(ST_CLI, i.st)}</td><td>${i.ultima ? `${dateBR(i.ultima)} <span class="muted small">${i.desde} d</span>` : ''}</td><td class="num">${i.intervalo ? Math.round(i.intervalo) + ' d' : ''}</td>
      <td class="num">${i.v12 ? money0(i.v12) : ''}</td><td class="num ${i.v12a && i.v12 < i.v12a ? 'neg' : 'pos'}">${i.v12a ? pct(i.v12 / i.v12a - 1, 0) : ''}</td><td class="${prox && prox < today() ? 'neg' : ''}">${dateBR(prox) || ''}</td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">Nenhum cliente neste filtro.</td></tr>'}</tbody></table></div></div>`;
  $('#cc-st', corpo).onclick = (e) => { const s = e.target.closest('[data-s]'); if (s) { ui.st = s.dataset.s; pintar(root); } };
  $('#cc-rep', corpo) && ($('#cc-rep', corpo).onchange = (e) => { ui.rep = e.target.value; pintar(root); });
  $('#cc-b', corpo).oninput = (e) => { ui.busca = e.target.value; clearTimeout(pintar._t); pintar._t = setTimeout(() => { pintar(root); const i = $('#cc-b', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => ficha(tr.dataset.id, root));
}

// ------------------------------------------------------------ ficha do cliente
async function ficha(id, root) {
  const c = B.clientes.find(x => x.id === id); if (!c) return toast('Cliente fora da sua carteira', true);
  const i = B.info[id] || { st: 'sem' }, ns = B.notas.filter(n => n.favorecido_id === id).sort((a, b) => b.emissao.localeCompare(a.emissao));
  let fin = null, ints = [], itens = [], ops = [];
  try {
    [fin, ints, itens, ops] = await Promise.all([q(sb.rpc('comercial_cliente_financeiro', { p_empresa: state.empresa.id, p_fav: id })),
      q(sb.from('comercial_interacoes').select('*').eq('favorecido_id', id).order('data', { ascending: false }).limit(50)),
      q(sb.rpc('comercial_itens', { p_empresa: state.empresa.id, p_de: addDias(today(), -365), p_ate: today() })),
      q(sb.from('comercial_oportunidades').select('id,numero,titulo,etapa,valor_estimado').eq('favorecido_id', id).order('numero', { ascending: false }))]);
  } catch (err) { return fail(err); }
  const prods = {}; for (const x of itens.filter(x => x.favorecido_id === id || (!x.favorecido_id && B.porDoc[x.dest_doc]?.id === id))) { const p = (prods[x.codigo] ||= { ...x, quantidade: 0, valor: 0, ult: x.mes }); p.quantidade += +x.quantidade; p.valor += +x.valor; if (x.mes > p.ult) p.ult = x.mes; }
  const ab = fin.abertos || [], h = today(), venc = ab.filter(t => t.data < h), totAb = ab.reduce((t, x) => t + +x.valor, 0);
  const at = fin.atraso || {};
  const m = modal({ title: c.nome, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Situação</span><div>${badge(ST_CLI, i.st)}</div></div><div><span class="muted">CNPJ/CPF</span><div>${esc(c.documento || '–')}</div></div>
      <div><span class="muted">Representante</span><div>${esc(c.representante || '–')}</div></div><div><span class="muted">Segmento</span><div>${esc(c.segmento || '–')}</div></div>
      <div><span class="muted">Contato</span><div>${esc([c.telefone, c.email].filter(Boolean).join(' · ') || '–')}</div></div>
      <div><span class="muted">Comprou em 12 meses</span><div>${money0(i.v12 || 0)}${i.v12a ? ` <span class="${i.v12 < i.v12a ? 'neg' : 'pos'}">(${pct(i.v12 / i.v12a - 1, 0)})</span>` : ''}</div></div>
      <div><span class="muted">Última compra</span><div>${i.ultima ? `${dateBR(i.ultima)} (${i.desde} dias)` : '–'}</div></div>
      <div><span class="muted">Intervalo médio</span><div>${i.intervalo ? Math.round(i.intervalo) + ' dias' : '–'}</div></div>
      <div><span class="muted">Ticket médio</span><div>${i.ticket ? money0(i.ticket) : '–'}</div></div>
    </div>
    <h3 style="margin:14px 0 6px">Financeiro</h3>
    <div class="grid-form small">
      <div><span class="muted">Em aberto</span><div>${money(totAb)} (${ab.length} título(s))</div></div>
      <div><span class="muted">Vencido</span><div class="${venc.length ? 'neg' : ''}">${money(venc.reduce((t, x) => t + +x.valor, 0))} (${venc.length})</div></div>
      <div><span class="muted">Limite de crédito</span><div>${c.limite_credito != null ? `${money(c.limite_credito)} · uso ${pct(totAb / c.limite_credito, 0)}` : '–'}</div></div>
      <div><span class="muted">Pagamento (12 meses)</span><div>${at.parcelas ? `${at.pontual_pct}% em dia · atraso médio ${String(at.dias_medio).replace('.', ',')} dia(s) · ${at.parcelas} parcela(s)` : 'sem parcelas pagas vinculadas às notas'}</div></div>
      <div><span class="muted">Prazo padrão</span><div>${esc(c.prazo_padrao || '–')}</div></div>
    </div>
    ${ab.length ? `<div class="table-wrap" style="max-height:180px;margin-top:6px"><table><thead><tr><th>Vencimento</th><th>Documento</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${ab.map(t => `<tr><td class="${t.data < h ? 'neg' : ''}">${dateBR(t.data)}</td><td>${esc(t.documento || '')}</td><td class="num">${money(t.valor)}</td><td class="small muted">${t.endossado ? 'em borderô' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <h3 style="margin:14px 0 6px">Produtos comprados — 12 meses</h3>
    <div class="table-wrap" style="max-height:220px"><table><thead><tr><th>Produto</th><th class="num">Quantidade</th><th class="num">Valor</th><th class="num">Preço médio</th><th>Último mês</th></tr></thead><tbody>
      ${Object.values(prods).sort((a, b) => b.valor - a.valor).map(p => `<tr><td class="wrap">${esc(p.codigo)} — ${esc(p.descricao)}</td><td class="num">${qtd(Math.round(p.quantidade))} ${esc(p.unidade || '')}</td><td class="num">${money(p.valor)}</td>
        <td class="num">${p.quantidade ? unit(p.valor / p.quantidade) : ''}</td><td>${p.ult.slice(5, 7)}/${p.ult.slice(0, 4)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sem compras nos últimos 12 meses.</td></tr>'}</tbody></table></div>
    <h3 style="margin:14px 0 6px">Últimas notas</h3>
    <div class="small">${ns.slice(0, 12).map(n => `NF ${n.numero} · ${dateBR(n.emissao)} · ${money(n.valor)}`).join('<br>') || '<span class="muted">Nenhuma nota em 2 anos.</span>'}</div>
    ${ops.length ? `<h3 style="margin:14px 0 6px">Oportunidades</h3><div class="small">${ops.map(o => `<a href="#" data-op="${o.id}">#${o.numero} ${esc(o.titulo)}</a> · ${esc(o.etapa)}${o.valor_estimado ? ' · ' + money0(o.valor_estimado) : ''}`).join('<br>')}</div>` : ''}
    <h3 style="margin:14px 0 6px">Contatos</h3>
    ${podeEditarCom() ? `<div class="grid-form" id="ci-novo">
      <label>Tipo<select id="ci-t">${Object.entries(TIPOS_INT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="span2">O que foi tratado *<input id="ci-r"></label>
      <label>Próximo contato<input type="date" id="ci-p"></label><label class="span2">Assunto do próximo<input id="ci-pa"></label>
      <div style="align-self:end"><button class="btn primary small" id="ci-ok">Registrar</button></div></div>` : ''}
    <div class="small" style="margin-top:8px">${ints.map(x => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><b>${esc(TIPOS_INT[x.tipo])}</b> · ${dateBR(x.data)} — ${esc(x.resumo)}${x.proximo_contato ? ` <span class="${x.concluido ? 'muted' : 'warn'}">→ ${dateBR(x.proximo_contato)} ${esc(x.proximo_assunto || '')}${x.concluido ? ' (feito)' : ''}</span>` : ''}</div>`).join('') || '<span class="muted">Nenhum contato registrado.</span>'}</div>`,
    foot: `${podeEditarCom() ? '<button class="btn" id="ci-op">Nova oportunidade</button>' : ''}<button class="btn" data-close>Fechar</button>` });
  $$('[data-op]', m.el).forEach(a => a.onclick = (e) => { e.preventDefault(); m.close(); state.abrir = { tipo: 'oportunidade', id: a.dataset.op }; location.hash = '#/comercial/funil'; });
  $('#ci-op', m.el) && ($('#ci-op', m.el).onclick = () => { m.close(); state.abrir = { tipo: 'nova-oportunidade', favorecido_id: id }; location.hash = '#/comercial/funil'; });
  $('#ci-ok', m.el) && ($('#ci-ok', m.el).onclick = async (ev) => {
    const r = $('#ci-r', m.el).value.trim(); if (!r) return toast('Descreva o contato', true);
    ev.target.disabled = true;
    try {
      // registrar um contato conclui os próximos contatos pendentes deste cliente
      await q(sb.from('comercial_interacoes').update({ concluido: true }).eq('favorecido_id', id).eq('concluido', false).not('proximo_contato', 'is', null));
      await q(sb.from('comercial_interacoes').insert({ empresa_id: state.empresa.id, favorecido_id: id, tipo: $('#ci-t', m.el).value, resumo: r,
        proximo_contato: $('#ci-p', m.el).value || null, proximo_assunto: $('#ci-pa', m.el).value.trim() || null }));
      toast('Contato registrado'); m.close(); limparBaseComercial(); await carregar(root); ficha(id, root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
}

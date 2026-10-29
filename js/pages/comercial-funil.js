// Comercial › Funil e propostas: oportunidades por etapa (contato → qualificado → proposta → ganha/perdida),
// propostas com especificação técnica, calculadora de preço (peso teórico × custo do kg ÷ (1 − margem)) e PDF da proposta.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, money0, dateBR, today, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { baseComercial, ETAPAS, ABERTAS, podeEditarCom, interno, addDias } from '../lib/comercial.js';
import { MATERIAIS, pesoTeorico, carregarProdutos, datalistProdutos, acharProduto } from '../lib/produtos.js';
import { qtd, inp, unit, num } from '../lib/compras.js';
import { abrirRelatorio } from '../lib/relatorio.js';

export const title = 'Funil e propostas';
const ui = { vend: '', mostrar: 'abertas' };
let B = null, OPS = [], PRODS = [];
const nomeCli = (o) => (o.favorecido_id ? B.clientes.find(c => c.id === o.favorecido_id)?.nome : null) || o.prospect || '–';

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Funil e propostas</h2><div class="muted small">Vai até a proposta; ganhou, registre o número do pedido no Iniflex.</div></div>
      ${podeEditarCom() ? '<button class="btn primary" id="fu-nova">Nova oportunidade</button>' : ''}</div>
    <div class="card toolbar"><div class="chips" id="fu-m"><span class="chip ${ui.mostrar === 'abertas' ? 'on' : ''}" data-m="abertas">Em andamento</span><span class="chip ${ui.mostrar === 'todas' ? 'on' : ''}" data-m="todas">Com ganhas e perdidas (180 dias)</span></div>
      ${interno() ? '<label>Representante<select id="fu-v"><option value="">Todos</option></select></label>' : ''}</div>
    <div id="fu-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#fu-nova', root) && ($('#fu-nova', root).onclick = () => editar(null, root));
  $('#fu-m', root).onclick = (e) => { const m = e.target.closest('[data-m]')?.dataset.m; if (m) { ui.mostrar = m; $$('#fu-m .chip', root).forEach(c => c.classList.toggle('on', c.dataset.m === m)); pintar(root); } };
  const ab = ['oportunidade', 'nova-oportunidade'].includes(state.abrir?.tipo) ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if ($('#fu-v', root)) { $('#fu-v', root).innerHTML = '<option value="">Todos</option>' + B.vendedores.map(v => `<option value="${v.id}" ${ui.vend === v.id ? 'selected' : ''}>${esc(v.nome)}</option>`).join(''); $('#fu-v', root).onchange = (e) => { ui.vend = e.target.value; pintar(root); }; }
  if (ab?.tipo === 'oportunidade') { const o = OPS.find(x => x.id === ab.id); if (o) abrir(o, root); }
  if (ab?.tipo === 'nova-oportunidade') editar({ favorecido_id: ab.favorecido_id }, root);
}
async function carregar(root) {
  try {
    [B, OPS, PRODS] = await Promise.all([baseComercial(), q(sb.from('comercial_oportunidades').select('*').eq('empresa_id', state.empresa.id).order('atualizado_em', { ascending: false })),
      carregarProdutos().catch(() => [])]);
    pintar(root);
  } catch (err) { fail(err); $('#fu-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}
function pintar(root) {
  const lim = addDias(today(), -180);
  const vis = OPS.filter(o => (!ui.vend || o.vendedor_id === ui.vend) && (ABERTAS.includes(o.etapa) || (ui.mostrar === 'todas' && (o.fechado_em || '') >= lim)));
  const cols = ui.mostrar === 'todas' ? Object.keys(ETAPAS) : ABERTAS;
  const vend = Object.fromEntries(B.vendedores.map(v => [v.id, v.nome]));
  $('#fu-corpo', root).innerHTML = `<div class="fu-kanban" style="grid-template-columns:repeat(${cols.length},minmax(220px,1fr))">${cols.map(et => { const os = vis.filter(o => o.etapa === et);
    return `<div class="fu-col"><div class="fu-col-h"><b>${ETAPAS[et]}</b><span class="muted small">${os.length} · ${money0(os.reduce((t, o) => t + (+o.valor_estimado || 0), 0))}</span></div>
      ${os.map(o => `<div class="card fu-card clickable" data-id="${o.id}"><div class="small muted">#${o.numero}${o.previsao_fechamento ? ` · fecha ${dateBR(o.previsao_fechamento)}` : ''}</div>
        <div><b>${esc(nomeCli(o))}</b></div><div class="small">${esc(o.titulo)}</div>
        <div class="small muted">${o.valor_estimado ? money0(o.valor_estimado) : ''}${o.probabilidade != null ? ` · ${o.probabilidade}%` : ''}${interno() && vend[o.vendedor_id] ? ` · ${esc(vend[o.vendedor_id])}` : ''}${o.pedido_iniflex ? ` · Iniflex ${esc(o.pedido_iniflex)}` : ''}</div></div>`).join('') || '<div class="muted small" style="padding:8px">—</div>'}</div>`; }).join('')}</div>`;
  $$('.fu-card', root).forEach(c => c.onclick = () => abrir(OPS.find(o => o.id === c.dataset.id), root));
}

// ------------------------------------------------------------ oportunidade
function editar(o, root) {
  const v = o || {};
  const m = modal({ title: v.id ? `Oportunidade #${v.numero}` : 'Nova oportunidade', body: `
    <div class="grid-form">
      <label class="span2">Cliente da carteira<input id="op-c" list="op-cl" value="${esc(v.favorecido_id ? B.clientes.find(c => c.id === v.favorecido_id)?.nome || '' : '')}" placeholder="escolha da lista">
        <datalist id="op-cl">${B.clientes.map(c => `<option value="${esc(c.nome)}"></option>`).join('')}</datalist></label>
      <label class="span2">ou prospect (ainda sem cadastro)<input id="op-p" value="${esc(v.prospect || '')}"></label>
      <label>Contato<input id="op-ct" value="${esc(v.contato || '')}"></label>
      <label class="span2">O que é *<input id="op-t" value="${esc(v.titulo || '')}" placeholder="ex.: sacola 50x60 impressa 2 cores"></label>
      <label>Valor estimado<input id="op-v" value="${inp(v.valor_estimado)}"></label>
      <label>Probabilidade %<input id="op-pr" value="${v.probabilidade ?? ''}"></label>
      <label>Previsão de fechamento<input type="date" id="op-f" value="${v.previsao_fechamento || ''}"></label>
      ${interno() ? `<label>Representante<select id="op-vd"><option value="">—</option>${B.vendedores.filter(x => x.ativo).map(x => `<option value="${x.id}" ${v.vendedor_id === x.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>` : ''}
      <label class="span2">Observação<input id="op-o" value="${esc(v.observacao || '')}"></label>
    </div>`, foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="op-ok">Salvar</button>` });
  $('#op-ok', m.el).onclick = async (ev) => {
    const cn = $('#op-c', m.el).value.trim(), cli = B.clientes.find(c => c.nome === cn);
    if (cn && !cli) return toast('Escolha o cliente da lista (ou use o campo de prospect)', true);
    const row = { favorecido_id: cli?.id || null, prospect: $('#op-p', m.el).value.trim() || null, contato: $('#op-ct', m.el).value.trim() || null, titulo: $('#op-t', m.el).value.trim(),
      valor_estimado: $('#op-v', m.el).value.trim() ? num($('#op-v', m.el).value) : null, probabilidade: $('#op-pr', m.el).value.trim() ? Math.min(100, Math.max(0, parseInt($('#op-pr', m.el).value))) : null,
      previsao_fechamento: $('#op-f', m.el).value || null, observacao: $('#op-o', m.el).value.trim() || null, ...($('#op-vd', m.el) ? { vendedor_id: $('#op-vd', m.el).value || null } : {}) };
    if (!row.titulo) return toast('Descreva a oportunidade', true);
    if (!row.favorecido_id && !row.prospect) return toast('Informe o cliente ou o prospect', true);
    ev.target.disabled = true;
    try {
      let id = v.id;
      if (id) await q(sb.from('comercial_oportunidades').update(row).eq('id', id));
      else id = (await q(sb.from('comercial_oportunidades').insert({ ...row, empresa_id: state.empresa.id }).select('id').single())).id;
      m.close(); toast('Oportunidade salva'); await carregar(root); abrir(OPS.find(x => x.id === id), root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

async function abrir(o, root) {
  if (!o) return;
  let props = [], itens = [];
  try { props = await q(sb.from('comercial_propostas').select('*').eq('oportunidade_id', o.id).order('numero'));
    if (props.length) itens = await q(sb.from('comercial_proposta_itens').select('*').in('proposta_id', props.map(p => p.id))); } catch (err) { return fail(err); }
  const ed = podeEditarCom(), fechada = ['ganha', 'perdida'].includes(o.etapa);
  const m = modal({ title: `#${o.numero} — ${nomeCli(o)}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Etapa</span><div><b>${ETAPAS[o.etapa]}</b></div></div><div class="span2"><span class="muted">O que é</span><div>${esc(o.titulo)}</div></div>
      <div><span class="muted">Valor estimado</span><div>${o.valor_estimado ? money0(o.valor_estimado) : '–'}${o.probabilidade != null ? ` · ${o.probabilidade}%` : ''}</div></div>
      <div><span class="muted">Previsão</span><div>${dateBR(o.previsao_fechamento) || '–'}</div></div><div><span class="muted">Contato</span><div>${esc(o.contato || '–')}</div></div>
      ${o.pedido_iniflex ? `<div><span class="muted">Pedido no Iniflex</span><div>${esc(o.pedido_iniflex)}</div></div>` : ''}${o.motivo_perda ? `<div class="span2"><span class="muted">Motivo da perda</span><div>${esc(o.motivo_perda)}</div></div>` : ''}
    </div>
    ${o.observacao ? `<p class="small">${esc(o.observacao)}</p>` : ''}
    <h3 style="margin:14px 0 6px">Propostas</h3>
    ${props.map(p => { const its = itens.filter(i => i.proposta_id === p.id); return `<div class="card" style="margin-bottom:8px;padding:10px 12px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b>Proposta nº ${p.numero}</b> · ${dateBR(p.data)} · ${esc(p.status)}${p.validade ? ` · válida até ${dateBR(p.validade)}` : ''}</div><b>${money(p.total)}</b></div>
      <div class="small">${its.map(i => `${qtd(i.quantidade)} ${i.unidade} × ${unit(i.preco)} — ${esc(i.descricao)}`).join('<br>')}</div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap"><button class="btn ghost small" data-pdf="${p.id}">PDF</button>
        ${ed && p.status === 'rascunho' ? `<button class="btn ghost small" data-pe="${p.id}">Editar</button><button class="btn small" data-env="${p.id}">Marcar enviada</button>` : ''}
        ${ed && p.status === 'enviada' ? `<button class="btn ghost small" data-rec="${p.id}">Recusada</button><button class="btn small" data-ace="${p.id}">Aceita</button>` : ''}</div></div>`; }).join('') || '<p class="small muted">Nenhuma proposta.</p>'}`,
    foot: '<div id="op-ac" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const ac = $('#op-ac', m.el), btn = (t, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = t; b.onclick = fn; ac.appendChild(b); };
  const mover = async (dados, msg) => { try { await q(sb.from('comercial_oportunidades').update(dados).eq('id', o.id)); toast(msg); m.close(); await carregar(root); abrir(OPS.find(x => x.id === o.id), root); } catch (err) { fail(err); } };
  const ganhar = () => { const ped = prompt('Número do pedido no Iniflex (pode deixar em branco e informar depois):'); if (ped === null) return; mover({ etapa: 'ganha', pedido_iniflex: ped.trim() || null, probabilidade: 100 }, 'Oportunidade ganha'); };
  if (ed) {
    if (!fechada) {
      btn('Perdida', 'danger', () => { const mot = prompt('Motivo da perda (preço, prazo, qualidade, concorrente, desistiu…):'); if (mot?.trim()) mover({ etapa: 'perdida', motivo_perda: mot.trim(), probabilidade: 0 }, 'Oportunidade perdida'); });
      btn('Editar', '', () => { m.close(); editar(o, root); });
      if (o.etapa === 'contato') btn('Qualificar', '', () => mover({ etapa: 'qualificado' }, 'Oportunidade qualificada'));
      btn('Nova proposta', '', () => { m.close(); proposta(o, null, [], root); });
      btn('Ganha', 'primary', ganhar);
    } else btn('Reabrir', '', () => mover({ etapa: props.length ? 'proposta' : 'qualificado', motivo_perda: null }, 'Oportunidade reaberta'));
    if (o.etapa === 'ganha' && !o.pedido_iniflex) btn('Informar pedido do Iniflex', 'primary', () => { const ped = prompt('Número do pedido no Iniflex:'); if (ped?.trim()) mover({ pedido_iniflex: ped.trim() }, 'Pedido registrado'); });
  }
  const mudarP = async (pid, dados, extra) => { try { await q(sb.from('comercial_propostas').update(dados).eq('id', pid)); if (extra) await q(sb.from('comercial_oportunidades').update(extra).eq('id', o.id));
    toast('Proposta atualizada'); m.close(); await carregar(root); abrir(OPS.find(x => x.id === o.id), root); } catch (err) { fail(err); } };
  $$('[data-pdf]', m.el).forEach(b => b.onclick = () => pdf(o, props.find(p => p.id === b.dataset.pdf), itens.filter(i => i.proposta_id === b.dataset.pdf)));
  $$('[data-pe]', m.el).forEach(b => b.onclick = () => { m.close(); proposta(o, props.find(p => p.id === b.dataset.pe), itens.filter(i => i.proposta_id === b.dataset.pe), root); });
  $$('[data-env]', m.el).forEach(b => b.onclick = () => mudarP(b.dataset.env, { status: 'enviada' }, ABERTAS.includes(o.etapa) ? { etapa: 'proposta' } : null));
  $$('[data-rec]', m.el).forEach(b => b.onclick = () => mudarP(b.dataset.rec, { status: 'recusada' }));
  $$('[data-ace]', m.el).forEach(b => b.onclick = async () => { await mudarP(b.dataset.ace, { status: 'aceita' }); if (!fechada && await confirmDialog('Proposta aceita. Marcar a oportunidade como ganha?')) ganhar(); });
}

// ------------------------------------------------------------ proposta (com calculadora)
const linhaItem = (i = {}) => `<tr>
  <td><input class="pi-d it-d" list="pi-dl" value="${esc(i.descricao || '')}" style="min-width:220px" ${i.produto_id ? `data-prod="${i.produto_id}"` : ''}></td>
  <td><select class="pi-mat"><option value="">—</option>${Object.keys(MATERIAIS).map(k => `<option ${i.material === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
  <td><input class="pi-lar" value="${inp(i.largura_mm)}" style="width:62px"></td><td><input class="pi-esp" value="${inp(i.espessura_um)}" style="width:62px"></td>
  <td><input class="pi-com" value="${inp(i.comprimento_m)}" style="width:62px"></td><td><select class="pi-cam"><option value="1" ${+i.camadas === 1 ? 'selected' : ''}>1</option><option value="2" ${+i.camadas !== 1 ? 'selected' : ''}>2</option></select></td>
  <td><input class="pi-cor" value="${i.cores_impressao ?? ''}" style="width:44px"></td>
  <td><input class="pi-q" value="${inp(i.quantidade)}" style="width:80px"></td><td><select class="pi-u">${['KG', 'MIL', 'UN', 'M'].map(u => `<option ${(i.unidade || 'MIL') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
  <td><input class="pi-p" value="${inp(i.preco)}" style="width:90px"></td>
  <td><button class="btn ghost small pi-calc" title="Calculadora">calc</button></td><td class="num pi-t"></td><td><button class="btn ghost icon pi-x">✕</button></td></tr>
  <tr class="pi-extra"><td colspan="13"><input class="pi-esp-txt" value="${esc(i.especificacao || '')}" placeholder="especificação: cor, solda, sanfona, corona, embalagem…" style="width:100%"><input type="hidden" class="pi-custo" value="${i.custo_estimado ?? ''}"></td></tr>`;

function proposta(o, p, its, root) {
  const v = p || { validade: addDias(today(), 15), frete: 'CIF', condicao_pagamento: '28/42/56 dias', prazo_entrega: '15 dias úteis após aprovação da arte' };
  const m = modal({ title: p ? `Proposta nº ${p.numero} — editar` : `Nova proposta — #${o.numero} ${nomeCli(o)}`, wide: true, body: `
    <div class="grid-form">
      <label>Validade<input type="date" id="pp-val" value="${v.validade || ''}"></label><label>Frete<select id="pp-fr"><option ${v.frete === 'CIF' ? 'selected' : ''}>CIF</option><option ${v.frete === 'FOB' ? 'selected' : ''}>FOB</option></select></label>
      <label>Condição de pagamento<input id="pp-cp" value="${esc(v.condicao_pagamento || '')}"></label><label>Prazo de entrega<input id="pp-pz" value="${esc(v.prazo_entrega || '')}"></label>
      <label class="span2">Observação (sai no PDF)<input id="pp-obs" value="${esc(v.observacao || '')}"></label></div>
    <h3 style="margin:14px 0 6px">Itens <span class="muted small" style="font-weight:400">largura mm · espessura µm · comprimento m · faces 2 = tubular/saco · preço por unidade</span></h3>
    ${datalistProdutos('pi-dl', PRODS)}
    <div class="table-wrap"><table><thead><tr><th>Descrição</th><th>Material</th><th>Larg.</th><th>Esp.</th><th>Comp.</th><th>Faces</th><th>Cores</th><th>Quant.</th><th>Unid.</th><th>Preço</th><th></th><th class="num">Total</th><th></th></tr></thead>
      <tbody id="pp-it">${(its.length ? its : [{}]).map(linhaItem).join('')}</tbody></table></div>
    <div style="display:flex;justify-content:space-between;margin-top:6px"><button class="btn ghost small" id="pp-mais">+ Item</button><b id="pp-tot"></b></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pp-ok">Salvar</button>` });
  const tb = $('#pp-it', m.el);
  const pares = () => $$('tr:not(.pi-extra)', tb).map(tr => [tr, tr.nextElementSibling]);
  const somar = () => { let t = 0; for (const [tr] of pares()) { const s = num($('.pi-q', tr).value) * num($('.pi-p', tr).value); t += s; $('.pi-t', tr).textContent = s ? money(s) : ''; } $('#pp-tot', m.el).textContent = 'Total: ' + money(t); };
  m.el.addEventListener('input', somar); somar();
  tb.addEventListener('change', (e) => { const d = e.target.closest('.pi-d'); if (!d) return; const pr = acharProduto(d.value, PRODS), tr = d.closest('tr');
    if (pr) { d.dataset.prod = pr.id; if (pr.material) $('.pi-mat', tr).value = pr.material; for (const [c, k] of [['.pi-lar', 'largura_mm'], ['.pi-esp', 'espessura_um'], ['.pi-com', 'comprimento_m']]) if (pr[k] != null) $(c, tr).value = inp(pr[k]);
      if (pr.camadas) $('.pi-cam', tr).value = pr.camadas; if (pr.cores_impressao != null) $('.pi-cor', tr).value = pr.cores_impressao; } else delete d.dataset.prod; });
  $('#pp-mais', m.el).onclick = () => tb.insertAdjacentHTML('beforeend', linhaItem());
  tb.addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (e.target.closest('.pi-x')) { tr.nextElementSibling?.remove(); tr.remove(); somar(); }
    if (e.target.closest('.pi-calc')) calculadora(tr, somar);
  });
  $('#pp-ok', m.el).onclick = async (ev) => {
    const itens = pares().map(([tr, ex]) => ({ produto_id: $('.pi-d', tr).dataset.prod || null, descricao: $('.pi-d', tr).value.trim(), material: $('.pi-mat', tr).value || null,
      largura_mm: $('.pi-lar', tr).value.trim() ? num($('.pi-lar', tr).value) : null, espessura_um: $('.pi-esp', tr).value.trim() ? num($('.pi-esp', tr).value) : null,
      comprimento_m: $('.pi-com', tr).value.trim() ? num($('.pi-com', tr).value) : null, camadas: +$('.pi-cam', tr).value, cores_impressao: $('.pi-cor', tr).value.trim() ? parseInt($('.pi-cor', tr).value) : null,
      quantidade: num($('.pi-q', tr).value), unidade: $('.pi-u', tr).value, preco: num($('.pi-p', tr).value), especificacao: $('.pi-esp-txt', ex).value.trim() || null,
      custo_estimado: $('.pi-custo', ex).value ? +$('.pi-custo', ex).value : null })).filter(i => i.descricao || i.quantidade);
    if (!itens.length || itens.some(i => !i.descricao || !(i.quantidade > 0))) return toast('Cada item precisa de descrição e quantidade', true);
    const cab = { validade: $('#pp-val', m.el).value || null, frete: $('#pp-fr', m.el).value, condicao_pagamento: $('#pp-cp', m.el).value.trim() || null, prazo_entrega: $('#pp-pz', m.el).value.trim() || null, observacao: $('#pp-obs', m.el).value.trim() || null };
    ev.target.disabled = true;
    try {
      const e = state.empresa.id; let id = p?.id;
      if (p) { await q(sb.from('comercial_propostas').update(cab).eq('id', id)); await q(sb.from('comercial_proposta_itens').delete().eq('proposta_id', id)); }
      else id = (await q(sb.from('comercial_propostas').insert({ ...cab, empresa_id: e, oportunidade_id: o.id }).select('id').single())).id;
      await q(sb.from('comercial_proposta_itens').insert(itens.map(i => ({ ...i, empresa_id: e, proposta_id: id }))));
      const tot = itens.reduce((t, i) => t + i.quantidade * i.preco, 0);
      if (!o.valor_estimado || o.etapa === 'contato') await q(sb.from('comercial_oportunidades').update({ valor_estimado: Math.round(tot * 100) / 100, ...(o.etapa === 'contato' ? { etapa: 'qualificado' } : {}) }).eq('id', o.id));
      m.close(); toast('Proposta salva'); await carregar(root); abrir(OPS.find(x => x.id === o.id), root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// preço sugerido = custo por unidade ÷ (1 − margem). Custo por unidade: custo do kg × kg por unidade (peso teórico).
function calculadora(tr, depois) {
  const g = (c) => num($(c, tr).value);
  const pt = pesoTeorico({ material: $('.pi-mat', tr).value, largura_mm: g('.pi-lar'), espessura_um: g('.pi-esp'), comprimento_m: g('.pi-com'), camadas: +$('.pi-cam', tr).value });
  const un = $('.pi-u', tr).value, kgPorUn = un === 'KG' ? 1 : un === 'MIL' ? pt?.milheiroKg : un === 'UN' ? (pt?.peca ? pt.peca / 1000 : null) : un === 'M' ? (pt?.gm ? pt.gm / 1000 : null) : null;
  const m = modal({ title: 'Calculadora de preço', body: `
    <p class="small" style="margin-top:0">${pt ? `Peso teórico: ${qtd(Math.round(pt.gm2 * 10) / 10)} g/m²${pt.gm ? ` · ${qtd(Math.round(pt.gm * 100) / 100)} g/m` : ''}${pt.peca ? ` · ${qtd(Math.round(pt.milheiroKg * 100) / 100)} kg/milheiro` : ''}` : 'Preencha material, largura, espessura (e comprimento para saco/sacola) para o peso teórico.'}</p>
    <div class="grid-form">
      <label>kg por ${un}<input id="ca-kg" value="${kgPorUn ? inp(Math.round(kgPorUn * 10000) / 10000) : ''}"></label>
      <label>Custo do kg (resina + aditivos + tinta + conversão)<input id="ca-ck" placeholder="R$/kg"></label>
      <label>Margem desejada %<input id="ca-mg" value="25"></label></div>
    <p id="ca-res" style="margin:10px 0 0"></p>
    <p class="small muted">Margem sobre o preço: preço = custo ÷ (1 − margem). Impostos sobre a venda não estão no cálculo.</p>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ca-ok">Usar o preço</button>` });
  let preco = null, custo = null;
  const calc = () => { const kg = num($('#ca-kg', m.el).value), ck = num($('#ca-ck', m.el).value), mg = num($('#ca-mg', m.el).value) / 100;
    custo = kg && ck ? kg * ck : null; preco = custo && mg < 1 ? custo / (1 - mg) : null;
    $('#ca-res', m.el).innerHTML = preco ? `Custo: <b>${unit(custo)}</b> por ${un} · Preço sugerido: <b>${unit(preco)}</b> por ${un}` : '<span class="muted">Informe kg e custo do kg.</span>'; };
  m.el.addEventListener('input', calc); calc();
  $('#ca-ok', m.el).onclick = () => { if (!preco) return toast('Complete o cálculo', true); $('.pi-p', tr).value = inp(Math.round(preco * 100) / 100); tr.nextElementSibling.querySelector('.pi-custo').value = Math.round(custo * 10000) / 10000; m.close(); depois(); };
}

async function pdf(o, p, its) {
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para gerar o PDF', true);
  const cli = o.favorecido_id ? B.clientes.find(c => c.id === o.favorecido_id) : null;
  const espec = (i) => [i.material, i.largura_mm && `${qtd(i.largura_mm)} mm`, i.espessura_um && `${qtd(i.espessura_um)} µm`, i.comprimento_m && `${qtd(i.comprimento_m)} m`, i.cores_impressao ? `${i.cores_impressao} cor(es)` : null, i.especificacao].filter(Boolean).join(' · ');
  await abrirRelatorio({ janela: w, nome: `Proposta comercial nº ${p.numero}`, titulo: `Proposta comercial nº ${p.numero}`,
    subtitulo: `Data ${dateBR(p.data)} · validade ${dateBR(p.validade) || '—'}`,
    corpo: `<h2>1. Cliente</h2>
    <table class="info"><tr><td>Cliente</td><td>${esc(cli?.nome || o.prospect || '')}</td></tr><tr><td>CNPJ/CPF</td><td>${esc(cli?.documento || '')}</td></tr>
      <tr><td>A/C</td><td>${esc(o.contato || '')}</td></tr><tr><td>Referência</td><td>${esc(o.titulo)}</td></tr></table>
    <h2>2. Produtos</h2>
    <table><thead><tr><th>#</th><th>Produto / especificação</th><th class="n">Quantidade</th><th>Unid.</th><th class="n">Preço unitário</th><th class="n">Total</th></tr></thead><tbody>
    ${its.map((i, k) => `<tr><td>${k + 1}</td><td><b>${esc(i.descricao)}</b><div class="m">${esc(espec(i))}</div></td><td class="n">${qtd(i.quantidade)}</td><td>${i.unidade === 'MIL' ? 'milheiro' : esc(i.unidade)}</td><td class="n">${unit(i.preco)}</td><td class="n">${money(i.quantidade * i.preco)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="5">Total</td><td class="n">${money(p.total)}</td></tr></tfoot></table>
    <h2>3. Condições</h2>
    <table class="info"><tr><td>Condição de pagamento</td><td>${esc(p.condicao_pagamento || '')}</td></tr><tr><td>Prazo de entrega</td><td>${esc(p.prazo_entrega || '')}</td></tr><tr><td>Frete</td><td>${esc(p.frete || '')}</td></tr></table>
    ${p.observacao ? `<p><b>Observação:</b> ${esc(p.observacao)}</p>` : ''}
    <div class="ass"><div>${esc(state.empresa.nome || '')}</div></div>`,
    rodape: 'Preços válidos até a data de validade desta proposta.' });
}

// Interface comum da melhoria 3.1: carregar as regras, aplicar em lote, editar em lote e dividir por centro de custo.
// Usado em Lançamentos, no formulário do lançamento, na Conciliação e na tela Regras de Classificação.
import { sb, state, q, fetchAll } from './data.js';
import { $, $$, esc, toast, fail, modal, money, options, parseNum } from './ui.js';
import { aplicarRegras, partesDoRateio } from './regras.js';
import { planoOptions } from './lanc-form.js';

let cache = null;
/** regras ativas e modelos de rateio da empresa (cache por empresa; force recarrega). Sem o SQL 096: listas vazias. */
export async function carregarRegras(force = false) {
  const e = state.empresa.id;
  if (cache && cache.e === e && !force) return cache;
  const [regras, rateios] = await Promise.all([
    q(sb.from('lanc_regras').select('*').eq('empresa_id', e).order('prioridade').order('criado_em')).catch(() => []),
    q(sb.from('cc_rateios').select('*').eq('empresa_id', e).order('nome')).catch(() => []),
  ]);
  cache = { e, regras, rateios };
  return cache;
}
export const limparCacheRegras = () => { cache = null; };

/** alvo da regra a partir de um lançamento (ou de um movimento do extrato) */
export function alvoDe(l) {
  const c = state.cad, p = c.planoById[l.plano_id];
  const natureza = l.natureza || (p ? (p.natureza === 'C' ? 'E' : 'S') : (l.valor_extrato != null ? (+l.valor_extrato >= 0 ? 'E' : 'S') : null));
  return { descricao: l.descricao || '', favorecido: l.favorecido_nome || c.favById[l.favorecido_id]?.nome || l.favorecido || '', documento: l.documento || '', valor: l.valor, natureza, conta_id: l.conta_id };
}

/** soma 1 uso nas regras aplicadas (não bloqueia se falhar) */
export async function registrarUso(regra, n = 1) {
  if (!regra?.id || !n) return;
  try { await q(sb.from('lanc_regras').update({ usos: (+regra.usos || 0) + n, ultimo_uso: new Date().toISOString() }).eq('id', regra.id)); regra.usos = (+regra.usos || 0) + n; } catch { /* só estatística */ }
}

/** "Editar selecionados": plano, centro de custo, favorecido e conta (os conciliados e transferências ficam de fora) */
export function editarLote(ids, depois) {
  const c = state.cad;
  const m = modal({ title: `Editar ${ids.length} lançamento(s)`, body: `<p class="small muted" style="margin-top:0">Preencha só o que vai mudar. Lançamentos conciliados com o extrato e transferências ficam como estão. Entrada continua entrada e saída continua saída.</p>
    <div class="grid-form">
      <label class="full">Plano de contas<select id="el-p"><option value="">— manter —</option>${planoOptions(null, ['E', 'S'])}</select></label>
      <label class="c6">Centro de custo<select id="el-cc"><option value="__">— manter —</option><option value="">(sem centro de custo)</option>${options(c.cc)}</select></label>
      <label class="c6">Conta<select id="el-ct"><option value="__">— manter —</option><option value="">(sem conta)</option>${options(c.contas.filter(x => x.ativo !== false))}</select></label>
      <label class="full">Favorecido<select id="el-f"><option value="__">— manter —</option><option value="">(sem favorecido)</option>${options(c.favorecidos.filter(x => x.ativo), { label: 'label' })}</select></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="el-ok">Aplicar</button>' });
  $('#el-ok', m.el).onclick = async (ev) => {
    const campos = {};
    if ($('#el-p', m.el).value) campos.plano_id = $('#el-p', m.el).value;
    for (const [id, k] of [['#el-cc', 'centro_custo_id'], ['#el-ct', 'conta_id'], ['#el-f', 'favorecido_id']]) if ($(id, m.el).value !== '__') campos[k] = $(id, m.el).value;
    if (!Object.keys(campos).length) return toast('Nada para mudar', true);
    ev.target.disabled = true;
    try {
      const r = await q(sb.rpc('lanc_editar_lote', { p_ids: ids, p_campos: campos }));
      m.close(); toast(`${r.alterados} lançamento(s) alterado(s)${r.pulados ? ` · ${r.pulados} ficaram como estavam (conciliados, transferências ou entrada/saída trocada)` : ''}`); depois();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

/** "Aplicar regras": mostra o que cada regra muda nos selecionados e aplica (com o rateio do modelo, se houver) */
export async function aplicarRegrasLote(ids, depois) {
  const { regras, rateios } = await carregarRegras(true);
  if (!regras.length) return toast('Nenhuma regra cadastrada: crie em Financeiro › Regras de Classificação', true);
  const ls = await q(sb.from('v_lancamentos').select('id,data,descricao,documento,valor,plano_id,centro_custo_id,favorecido_id,favorecido_nome,conta_id,conta_destino_id,tipo').in('id', ids));
  const conc = new Set((await q(sb.from('conciliacoes').select('lancamento_id').in('lancamento_id', ids))).map(x => x.lancamento_id));
  const c = state.cad;
  const mud = [];
  for (const l of ls) {
    if (l.conta_destino_id || !['E', 'S'].includes(l.tipo)) continue;
    const r = aplicarRegras(regras, { ...alvoDe(l), natureza: l.tipo });
    if (!r) continue;
    const novo = { plano_id: r.plano_id, centro_custo_id: r.centro_custo_id || l.centro_custo_id, favorecido_id: r.favorecido_id || l.favorecido_id };
    const muda = novo.plano_id !== l.plano_id || novo.centro_custo_id !== l.centro_custo_id || novo.favorecido_id !== l.favorecido_id || (r.rateio_id && !conc.has(l.id));
    if (muda && c.planoById[r.plano_id]?.tipo === l.tipo) mud.push({ l, r, novo, conc: conc.has(l.id) });
  }
  const ok = mud.filter(x => !x.conc);
  const m = modal({ title: 'Aplicar regras de classificação', wide: true, body: mud.length ? `<p class="small muted" style="margin-top:0">${ids.length} selecionado(s): ${mud.length} mudam por alguma regra${mud.length - ok.length ? `, ${mud.length - ok.length} conciliado(s) ficam de fora` : ''}.</p>
    <div class="table-wrap" style="max-height:52vh"><table><thead><tr><th>Lançamento</th><th>Regra</th><th>Hoje</th><th>Fica</th></tr></thead><tbody>
    ${mud.map(x => `<tr class="${x.conc ? 'muted' : ''}"><td class="wrap">${esc(x.l.descricao || '')}<div class="small muted">${money(x.l.valor)} · ${esc(x.l.favorecido_nome || '')}</div></td>
      <td class="small wrap">${esc(x.r.nome || `"${x.r.texto}"`)}</td><td class="small wrap">${esc(c.planoById[x.l.plano_id]?.label || '')}<div class="muted">${esc(c.ccById[x.l.centro_custo_id]?.nome || '')}</div></td>
      <td class="small wrap"><b>${esc(c.planoById[x.novo.plano_id]?.label || '')}</b><div class="muted">${esc(c.ccById[x.novo.centro_custo_id]?.nome || '')}${x.r.rateio_id ? ` · rateio ${esc(rateios.find(z => z.id === x.r.rateio_id)?.nome || '')}` : ''}</div>${x.conc ? '<div class="neg">conciliado: não muda</div>' : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Nenhuma regra muda os selecionados.</div>',
    foot: `<button class="btn" data-close>Fechar</button>${ok.length ? `<button class="btn primary" id="ar-ok">Aplicar em ${ok.length}</button>` : ''}` });
  $('#ar-ok', m.el) && ($('#ar-ok', m.el).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      // agrupa pelo resultado para gravar em lote; rateio vai lançamento a lançamento
      const grupos = new Map(), usos = new Map();
      for (const x of ok) { const k = JSON.stringify(x.novo); (grupos.get(k) || grupos.set(k, []).get(k)).push(x.l.id); usos.set(x.r, (usos.get(x.r) || 0) + 1); }
      for (const [k, gids] of grupos) await q(sb.rpc('lanc_editar_lote', { p_ids: gids, p_campos: JSON.parse(k) }));
      let div = 0;
      for (const x of ok.filter(z => z.r.rateio_id)) { const rt = rateios.find(z => z.id === x.r.rateio_id); if (rt) { await q(sb.rpc('lanc_dividir', { p_id: x.l.id, p_partes: partesDoRateio(x.l.valor, rt.partes) })); div++; } }
      for (const [r, n] of usos) await registrarUso(r, n);
      m.close(); toast(`${ok.length} lançamento(s) reclassificado(s)${div ? ` · ${div} dividido(s) pelo rateio` : ''}`); depois();
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
}

/** "Dividir por centro de custo" de um lançamento (não conciliado): partes à mão ou pelo modelo de rateio */
export async function dividirLancamento(l, depois) {
  const c = state.cad, { rateios } = await carregarRegras();
  const total = Math.round(+l.valor * 100) / 100;
  const linha = (cc = '', v = '') => `<div class="dv-l" style="display:grid;grid-template-columns:1fr 160px 34px;gap:8px;margin-bottom:6px"><select data-cc>${options(c.cc, { empty: 'Centro de custo…', selected: cc })}</select>
    <input data-v inputmode="decimal" placeholder="0,00" value="${v === '' ? '' : (+v).toFixed(2).replace('.', ',')}"><button class="btn ghost icon" data-x title="Remover">✕</button></div>`;
  const m = modal({ title: 'Dividir por centro de custo', body: `<p class="small" style="margin-top:0">${esc(l.descricao || '')} · <b>${money(total)}</b>. O lançamento vira um por centro de custo, com a mesma data, conta, plano e favorecido; a soma continua ${money(total)}.</p>
    ${rateios.filter(r => r.ativo).length ? `<label>Usar um modelo de rateio<select id="dv-m"><option value="">—</option>${options(rateios.filter(r => r.ativo))}</select></label>` : '<p class="small muted">Dica: cadastre modelos de rateio (ex.: energia 60/30/10) em Regras de Classificação › Modelos de rateio.</p>'}
    <div id="dv-ls" style="margin-top:8px">${linha(l.centro_custo_id || '', total)}${linha()}</div>
    <button class="btn small" id="dv-add">+ Centro de custo</button><p class="small" id="dv-tot"></p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="dv-ok">Dividir</button>' });
  const partes = () => $$('.dv-l', m.el).map(d => ({ centro_custo_id: $('[data-cc]', d).value, valor: parseNum($('[data-v]', d).value || '0') })).filter(p => p.centro_custo_id || p.valor);
  const tot = () => { const s = Math.round(partes().reduce((a, p) => a + p.valor, 0) * 100) / 100, d = Math.round((total - s) * 100) / 100;
    $('#dv-tot', m.el).innerHTML = `Soma ${money(s)} · ${d ? `<span class="neg">faltam ${money(d)}</span>` : '<span class="pos">fecha</span>'}`; $('#dv-ok', m.el).disabled = !!d || partes().length < 2; };
  m.el.addEventListener('input', tot); m.el.addEventListener('change', tot);
  m.el.addEventListener('click', (e) => { if (e.target.matches('[data-x]')) { e.target.closest('.dv-l').remove(); tot(); } });
  $('#dv-add', m.el).onclick = () => { $('#dv-ls', m.el).insertAdjacentHTML('beforeend', linha()); tot(); };
  $('#dv-m', m.el) && ($('#dv-m', m.el).onchange = (e) => { const r = rateios.find(x => x.id === e.target.value); if (!r) return;
    $('#dv-ls', m.el).innerHTML = partesDoRateio(total, r.partes).map(p => linha(p.centro_custo_id, p.valor)).join(''); tot(); });
  tot();
  $('#dv-ok', m.el).onclick = async (ev) => {
    const p = partes(); if (p.some(x => !x.centro_custo_id || !(x.valor > 0))) return toast('Cada parte precisa de centro de custo e valor', true);
    ev.target.disabled = true;
    try { const n = await q(sb.rpc('lanc_dividir', { p_id: l.id, p_partes: p })); m.close(); toast(`Lançamento dividido em ${n}`); depois(); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
}

/** histórico classificado para sugerir regras (últimos N meses, pagos e em aberto, só entradas e saídas) */
export async function historicoClassificado(meses = 12) {
  const d = new Date(); d.setMonth(d.getMonth() - meses);
  return fetchAll(() => sb.from('v_lancamentos').select('descricao,favorecido_nome,favorecido_id,plano_id,centro_custo_id,tipo,valor,documento,conta_id,id')
    .eq('empresa_id', state.empresa.id).in('tipo', ['E', 'S']).is('conta_destino_id', null).gte('data', d.toISOString().slice(0, 10)).order('id'))
    .then(r => r.map(l => ({ ...l, favorecido: l.favorecido_nome, natureza: l.tipo })));
}

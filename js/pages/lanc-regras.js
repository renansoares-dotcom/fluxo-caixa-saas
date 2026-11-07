// Financeiro › Regras de Classificação (FIN022): "se o histórico tem POSTO, então 2.06.02 COMBUSTÍVEL". As regras valem no
// lançamento novo, no "Criar lançamento" da Conciliação e no "Aplicar regras" em lote dos Lançamentos. "Sugerir pelo histórico"
// propõe regras a partir do que já foi classificado. Aba de modelos de rateio por centro de custo. Melhoria 3.1 (07/11/2026).
import { sb, state, q, loadCadastros, podeEditar } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, options, parseNum, pct, confirmDialog } from '../lib/ui.js';
import { planoOptions } from '../lib/lanc-form.js';
import { regraCasa, sugerirRegras } from '../lib/regras.js';
import { carregarRegras, limparCacheRegras, historicoClassificado, registrarUso } from '../lib/regras-ui.js';

export const title = 'Regras de Classificação';
const ui = { aba: 'regras', busca: '' };
const CAMPOS = { texto: 'Descrição, favorecido ou documento', descricao: 'Descrição', favorecido: 'Favorecido', documento: 'Documento' };
const OPS = { contem: 'contém', comeca: 'começa com', igual: 'é igual a', regex: 'expressão regular' };
const NAT = { '': 'entradas e saídas', E: 'só entradas', S: 'só saídas' };
const CSS = `<style>.rg-cond{font-size:12.5px}.rg-cond b{font-weight:600}.rg-off td{opacity:.55}.rg-res{max-height:52vh;overflow:auto}
  .modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400}.modal label.chk input{width:auto;min-height:0}</style>`;

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Regras de Classificação</h2><div class="muted small">O texto do lançamento decide o plano de contas, o centro de custo e o favorecido. Vale no lançamento novo, na conciliação e no "Aplicar regras" dos Lançamentos.</div></div>
    <div style="display:flex;gap:8px">${podeEditar() ? '<button class="btn" id="rg-sug">Sugerir pelo histórico</button><button class="btn primary" id="rg-novo">Nova regra</button>' : ''}</div></div>
    <div class="card toolbar"><div class="chips" id="rg-abas">${[['regras', 'Regras'], ['rateios', 'Modelos de rateio']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><label>Buscar<input id="rg-b" value="${esc(ui.busca)}" placeholder="texto, plano…"></label></div>
    <div id="rg-corpo"><div class="loading">Carregando…</div></div>`;
  $('#rg-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  $('#rg-b', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  $('#rg-novo', root) && ($('#rg-novo', root).onclick = () => ui.aba === 'rateios' ? editarRateio(null, () => render(root)) : editarRegra(null, () => render(root)));
  $('#rg-sug', root) && ($('#rg-sug', root).onclick = () => sugerir(() => render(root)));
  await loadCadastros();
  try { DADOS = await carregarRegras(true); } catch (err) { fail(err); }
  pintar(root);
}

let ultimoHist = null;
function pintar(root) {
  const c = state.cad, corpo = $('#rg-corpo', root), { regras, rateios } = carregarRegrasSync();
  const b = ui.busca.trim().toUpperCase();
  if (ui.aba === 'rateios') {
    const L = rateios.filter(r => !b || r.nome.toUpperCase().includes(b));
    corpo.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Modelo</th><th>Centros de custo</th><th></th></tr></thead><tbody>
      ${L.map(r => `<tr class="${r.ativo ? '' : 'rg-off'}"><td><b>${esc(r.nome)}</b>${r.ativo ? '' : ' <span class="badge">desativado</span>'}</td>
        <td class="small">${(r.partes || []).map(p => `${esc(c.ccById[p.centro_custo_id]?.nome || '?')} ${String(p.pct).replace('.', ',')}%`).join(' · ')}</td>
        <td>${podeEditar() ? `<button class="btn ghost small" data-er="${r.id}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhum modelo de rateio. Ex.: Energia — Extrusão 60%, Corte e Solda 30%, Administrativo 10%.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">O modelo é usado no "Dividir por C. Custo" do lançamento e nas regras que dividem automaticamente.</p>`;
    $$('[data-er]', corpo).forEach(x => x.onclick = () => editarRateio(rateios.find(r => r.id === x.dataset.er), () => render(root)));
    return;
  }
  const L = regras.filter(r => !b || `${r.nome || ''} ${r.texto} ${c.planoById[r.plano_id]?.label || ''}`.toUpperCase().includes(b));
  const usos = regras.reduce((s, r) => s + (+r.usos || 0), 0);
  corpo.innerHTML = `<div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Regras ativas</div><div class="k-value">${regras.filter(r => r.ativo).length}</div><div class="k-sub">${regras.length} cadastrada(s)</div></div>
      <div class="kpi"><div class="k-label">Lançamentos classificados</div><div class="k-value">${usos.toLocaleString('pt-BR')}</div><div class="k-sub">pelas regras, desde o cadastro</div></div>
      <div class="kpi"><div class="k-label">Sugeridas pelo histórico</div><div class="k-value">${regras.filter(r => r.origem === 'sugerida').length}</div><div class="k-sub">criadas a partir do que já foi classificado</div></div></div>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Ordem</th><th>Se</th><th>Então</th><th class="num">Usos</th><th></th></tr></thead><tbody>
    ${L.map(r => `<tr class="${r.ativo ? '' : 'rg-off'}"><td>${r.prioridade}</td>
      <td class="wrap rg-cond">${r.nome ? `<b>${esc(r.nome)}</b><br>` : ''}${esc(CAMPOS[r.campo])} ${OPS[r.operador]} <b>"${esc(r.texto)}"</b><div class="muted">${NAT[r.natureza || '']}${r.valor_min != null || r.valor_max != null ? ` · valor ${r.valor_min != null ? 'de ' + money(r.valor_min) : ''} ${r.valor_max != null ? 'até ' + money(r.valor_max) : ''}` : ''}${r.conta_id ? ` · só ${esc(c.contaById[r.conta_id]?.nome || '')}` : ''}</div></td>
      <td class="wrap rg-cond"><b>${esc(c.planoById[r.plano_id]?.label || '?')}</b><div class="muted">${[c.ccById[r.centro_custo_id]?.nome, c.favById[r.favorecido_id]?.nome, r.rateio_id ? 'rateio ' + (rateios.find(x => x.id === r.rateio_id)?.nome || '') : ''].filter(Boolean).map(esc).join(' · ')}</div></td>
      <td class="num">${r.usos || 0}</td><td style="white-space:nowrap">${podeEditar() ? `<button class="btn ghost small" data-ed="${r.id}">Editar</button>` : ''}</td></tr>`).join('')
      || `<tr><td colspan="5" class="empty">Nenhuma regra. Use <b>Sugerir pelo histórico</b> para começar pelo que já foi classificado.</td></tr>`}</tbody></table></div></div>
    <p class="small muted">As regras são testadas na ordem (menor primeiro); vale a primeira que casar. O texto é comparado sem acento e sem diferença de maiúsculas.</p>`;
  $$('[data-ed]', corpo).forEach(x => x.onclick = () => editarRegra(regras.find(r => r.id === x.dataset.ed), () => render(root)));
}
// último resultado de carregarRegras (o pintor é síncrono)
let DADOS = { regras: [], rateios: [] };
const carregarRegrasSync = () => DADOS;

async function editarRegra(r, depois) {
  const c = state.cad, novo = !r, { rateios } = await carregarRegras();
  r = r || { campo: 'texto', operador: 'contem', prioridade: 100, ativo: true };
  const m = modal({ title: novo ? 'Nova regra de classificação' : 'Editar regra', wide: true, body: `<div class="grid-form">
      <label class="c6">Nome (opcional)<input id="re-n" maxlength="80" value="${esc(r.nome || '')}" placeholder="ex.: Combustível da frota"></label>
      <label class="c3">Ordem (menor = primeiro)<input id="re-pr" inputmode="numeric" value="${r.prioridade}"></label>
      <label class="c3">Vale para<select id="re-nat">${Object.entries(NAT).map(([k, t]) => `<option value="${k}" ${(r.natureza || '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="c4">Se o campo<select id="re-c">${Object.entries(CAMPOS).map(([k, t]) => `<option value="${k}" ${r.campo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="c3">Operador<select id="re-o">${Object.entries(OPS).map(([k, t]) => `<option value="${k}" ${r.operador === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="c5">Texto<input id="re-t" value="${esc(r.texto || '')}" placeholder="ex.: POSTO"></label>
      <label class="c3">Valor de (opcional)<input id="re-vmin" inputmode="decimal" value="${r.valor_min != null ? String(r.valor_min).replace('.', ',') : ''}"></label>
      <label class="c3">Valor até (opcional)<input id="re-vmax" inputmode="decimal" value="${r.valor_max != null ? String(r.valor_max).replace('.', ',') : ''}"></label>
      <label class="c6">Só nesta conta (opcional)<select id="re-ct">${options(c.contas.filter(x => x.ativo !== false), { empty: 'qualquer conta', selected: r.conta_id })}</select></label>
      <label class="full">Então: plano de contas<select id="re-p"><option value="">Selecione…</option>${planoOptions(r.plano_id, ['E', 'S'])}</select></label>
      <label class="c4">Centro de custo<select id="re-cc">${options(c.cc, { empty: '— não muda —', selected: r.centro_custo_id })}</select></label>
      <label class="c4">Favorecido<select id="re-f">${options(c.favorecidos.filter(x => x.ativo || x.id === r.favorecido_id), { label: 'label', empty: '— não muda —', selected: r.favorecido_id })}</select></label>
      <label class="c4">Dividir pelo rateio<select id="re-rt">${options(rateios.filter(x => x.ativo || x.id === r.rateio_id), { empty: '— não divide —', selected: r.rateio_id })}</select></label></div>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="re-at" ${r.ativo ? 'checked' : ''}> Ativa</label>
    <div class="card" style="margin-top:10px;background:var(--surface-2)"><b class="small">Teste nos lançamentos dos últimos 12 meses</b> <span class="small muted" id="re-tst">digite o texto…</span>
      <div class="rg-res small" id="re-ex"></div>
      <label class="chk" id="re-aplw" hidden style="margin-top:6px"><input type="checkbox" id="re-apl"> <span id="re-apll"></span></label></div>`,
    foot: `${!novo ? '<button class="btn ghost danger" id="re-del">Excluir</button><span class="spacer" style="flex:1"></span>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="re-ok">Salvar</button>` });
  const ler = () => ({ empresa_id: state.empresa.id, nome: $('#re-n', m.el).value.trim() || null, prioridade: parseInt($('#re-pr', m.el).value, 10) || 100, natureza: $('#re-nat', m.el).value || null,
    campo: $('#re-c', m.el).value, operador: $('#re-o', m.el).value, texto: $('#re-t', m.el).value.trim(), conta_id: $('#re-ct', m.el).value || null,
    valor_min: $('#re-vmin', m.el).value.trim() ? parseNum($('#re-vmin', m.el).value) : null, valor_max: $('#re-vmax', m.el).value.trim() ? parseNum($('#re-vmax', m.el).value) : null,
    plano_id: $('#re-p', m.el).value || null, centro_custo_id: $('#re-cc', m.el).value || null, favorecido_id: $('#re-f', m.el).value || null, rateio_id: $('#re-rt', m.el).value || null, ativo: $('#re-at', m.el).checked });
  let casam = [], difer = [];
  const testar = async () => {
    const x = ler(); if (!x.texto) { $('#re-tst', m.el).textContent = 'digite o texto…'; $('#re-ex', m.el).innerHTML = ''; $('#re-aplw', m.el).hidden = true; return; }
    ultimoHist = ultimoHist || await historicoClassificado(12).catch(() => []);
    casam = ultimoHist.filter(l => regraCasa({ ...x, ativo: true }, l));
    difer = x.plano_id ? casam.filter(l => l.plano_id !== x.plano_id && c.planoById[x.plano_id]?.tipo === l.tipo) : [];
    $('#re-tst', m.el).textContent = `${casam.length} lançamento(s) casam${x.plano_id ? `; ${difer.length} estão hoje em outro plano` : ''}.`;
    $('#re-ex', m.el).innerHTML = casam.slice(0, 8).map(l => `<div>${esc(l.descricao || '')} <span class="muted">· ${[l.favorecido, money(l.valor), c.planoById[l.plano_id]?.label].filter(Boolean).map(esc).join(' · ')}</span></div>`).join('');
    $('#re-aplw', m.el).hidden = !difer.length; $('#re-apll', m.el).textContent = `Ao salvar, reclassificar também esses ${difer.length} lançamento(s) (os conciliados ficam como estão)`;
  };
  let t = null; m.el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(testar, 300); }); m.el.addEventListener('change', (e) => { if (e.target.id !== 're-apl') { clearTimeout(t); t = setTimeout(testar, 100); } });
  if (r.texto) testar();
  $('#re-ok', m.el).onclick = async (ev) => {
    const x = ler(); if (!x.texto) return toast('Informe o texto da regra', true); if (!x.plano_id) return toast('Escolha o plano de contas', true);
    ev.target.disabled = true;
    try {
      const salvo = novo ? await q(sb.from('lanc_regras').insert(x).select().single()) : await q(sb.from('lanc_regras').update(x).eq('id', r.id).select().single());
      let n = 0;
      if ($('#re-apl', m.el)?.checked && difer.length) {
        const campos = { plano_id: x.plano_id }; if (x.centro_custo_id) campos.centro_custo_id = x.centro_custo_id; if (x.favorecido_id) campos.favorecido_id = x.favorecido_id;
        n = (await q(sb.rpc('lanc_editar_lote', { p_ids: difer.map(l => l.id), p_campos: campos }))).alterados; if (n) await registrarUso(salvo, n);
      }
      limparCacheRegras(); m.close(); toast(`Regra salva${n ? ` · ${n} lançamento(s) reclassificado(s)` : ''}`); depois();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#re-del', m.el) && ($('#re-del', m.el).onclick = async () => {
    if (!await confirmDialog('Excluir esta regra? Os lançamentos já classificados não mudam.')) return;
    try { await q(sb.from('lanc_regras').delete().eq('id', r.id)); limparCacheRegras(); m.close(); toast('Regra excluída'); depois(); } catch (err) { fail(err); }
  });
}

async function sugerir(depois) {
  const c = state.cad;
  const m = modal({ title: 'Sugerir regras pelo histórico', wide: true, body: `<div class="toolbar" style="padding:0;margin-bottom:8px">
      <label>Mínimo de lançamentos<input id="sg-n" inputmode="numeric" value="3" style="width:90px"></label>
      <label>Acerto mínimo (%)<input id="sg-p" inputmode="numeric" value="90" style="width:90px"></label>
      <label>Período<select id="sg-m"><option value="6">6 meses</option><option value="12" selected>12 meses</option><option value="24">24 meses</option></select></label>
      <button class="btn" id="sg-go">Analisar</button></div><div id="sg-r"><div class="loading">Analisando…</div></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="sg-ok" disabled>Criar as regras marcadas</button>' });
  let P = [];
  const analisar = async () => {
    $('#sg-r', m.el).innerHTML = '<div class="loading">Analisando…</div>';
    try {
      const [hist, { regras }] = await Promise.all([historicoClassificado(+$('#sg-m', m.el).value), carregarRegras(true)]);
      ultimoHist = null;
      P = sugerirRegras(hist, { minOcorr: Math.max(2, parseInt($('#sg-n', m.el).value, 10) || 3), minPct: Math.min(1, (parseInt($('#sg-p', m.el).value, 10) || 90) / 100), existentes: regras });
      $('#sg-r', m.el).innerHTML = P.length ? `<p class="small muted" style="margin-top:0">${hist.length} lançamento(s) analisados. Cada proposta: o texto aparece em pelo menos ${$('#sg-n', m.el).value} lançamentos e cai no mesmo plano em ${$('#sg-p', m.el).value}% ou mais deles. Desmarque o que não fizer sentido.</p>
        <div class="table-wrap rg-res"><table><thead><tr><th><input type="checkbox" id="sg-all" checked></th><th>Se</th><th>Então</th><th class="num">Lançamentos</th><th class="num">Acerto</th></tr></thead><tbody>
        ${P.map((p, i) => `<tr><td><input type="checkbox" data-i="${i}" checked></td><td class="wrap rg-cond">${esc(CAMPOS[p.campo])} ${OPS[p.operador]} <b>"${esc(p.texto)}"</b><div class="muted">${NAT[p.natureza]} · ex.: ${esc(p.exemplos.slice(0, 2).join(' | '))}</div></td>
          <td class="wrap rg-cond"><b>${esc(c.planoById[p.plano_id]?.label || '?')}</b><div class="muted">${[c.ccById[p.centro_custo_id]?.nome, c.favById[p.favorecido_id]?.nome].filter(Boolean).map(esc).join(' · ')}</div></td>
          <td class="num">${p.ocorrencias}</td><td class="num">${pct(p.acerto, 0)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">Nenhuma proposta com esses critérios (${hist.length} lançamentos analisados). Diminua o mínimo ou o acerto.</div>`;
      const cnt = () => { const n = $$('[data-i]:checked', m.el).length; $('#sg-ok', m.el).disabled = !n; $('#sg-ok', m.el).textContent = `Criar ${n} regra(s)`; };
      $('#sg-all', m.el) && ($('#sg-all', m.el).onchange = (e) => { $$('[data-i]', m.el).forEach(x => x.checked = e.target.checked); cnt(); });
      $('#sg-r', m.el).onchange = cnt; cnt();
    } catch (err) { fail(err); $('#sg-r', m.el).innerHTML = ''; }
  };
  $('#sg-go', m.el).onclick = analisar; analisar();
  $('#sg-ok', m.el).onclick = async (ev) => {
    const sel = $$('[data-i]:checked', m.el).map(x => P[+x.dataset.i]); if (!sel.length) return;
    ev.target.disabled = true;
    try {
      await q(sb.from('lanc_regras').insert(sel.map((p, k) => ({ empresa_id: state.empresa.id, campo: p.campo, operador: p.operador, texto: p.texto, natureza: p.natureza, plano_id: p.plano_id,
        centro_custo_id: p.centro_custo_id, favorecido_id: p.favorecido_id, origem: 'sugerida', prioridade: p.campo === 'favorecido' ? 50 : 100 + k }))));
      limparCacheRegras(); m.close(); toast(`${sel.length} regra(s) criada(s)`); depois();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

function editarRateio(r, depois) {
  const c = state.cad, novo = !r; r = r || { nome: '', partes: [], ativo: true };
  const linha = (cc = '', p = '') => `<div class="rt-l" style="display:grid;grid-template-columns:1fr 120px 34px;gap:8px;margin-bottom:6px"><select data-cc>${options(c.cc, { empty: 'Centro de custo…', selected: cc })}</select>
    <input data-p inputmode="decimal" placeholder="%" value="${p === '' ? '' : String(p).replace('.', ',')}"><button class="btn ghost icon" data-x>✕</button></div>`;
  const m = modal({ title: novo ? 'Novo modelo de rateio' : `Rateio: ${r.nome}`, body: `<label>Nome<input id="rt-n" maxlength="60" value="${esc(r.nome)}" placeholder="ex.: Energia elétrica"></label>
    <div id="rt-ls" style="margin-top:10px">${(r.partes.length ? r.partes : [{}, {}]).map(p => linha(p.centro_custo_id, p.pct ?? '')).join('')}</div>
    <button class="btn small" id="rt-add">+ Centro de custo</button><p class="small" id="rt-tot"></p><label class="chk"><input type="checkbox" id="rt-at" ${r.ativo ? 'checked' : ''}> Ativo</label>`,
    foot: `${!novo ? '<button class="btn ghost danger" id="rt-del">Excluir</button><span class="spacer" style="flex:1"></span>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rt-ok">Salvar</button>` });
  const partes = () => $$('.rt-l', m.el).map(d => ({ centro_custo_id: $('[data-cc]', d).value, pct: parseNum($('[data-p]', d).value || '0') })).filter(p => p.centro_custo_id || p.pct);
  const tot = () => { const s = Math.round(partes().reduce((a, p) => a + p.pct, 0) * 100) / 100; $('#rt-tot', m.el).innerHTML = `Soma ${String(s).replace('.', ',')}% ${s === 100 ? '<span class="pos">· fecha</span>' : '<span class="neg">· precisa somar 100%</span>'}`; };
  m.el.addEventListener('input', tot); m.el.addEventListener('click', (e) => { if (e.target.matches('[data-x]')) { e.target.closest('.rt-l').remove(); tot(); } }); tot();
  $('#rt-add', m.el).onclick = () => { $('#rt-ls', m.el).insertAdjacentHTML('beforeend', linha()); tot(); };
  $('#rt-ok', m.el).onclick = async (ev) => {
    const row = { empresa_id: state.empresa.id, nome: $('#rt-n', m.el).value.trim(), partes: partes(), ativo: $('#rt-at', m.el).checked };
    if (!row.nome) return toast('Informe o nome', true);
    ev.target.disabled = true;
    try { if (novo) await q(sb.from('cc_rateios').insert(row)); else await q(sb.from('cc_rateios').update(row).eq('id', r.id)); limparCacheRegras(); m.close(); toast('Rateio salvo'); depois(); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#rt-del', m.el) && ($('#rt-del', m.el).onclick = async () => {
    if (!await confirmDialog('Excluir este modelo de rateio? Regras que usam o modelo deixam de dividir.')) return;
    try { await q(sb.from('cc_rateios').delete().eq('id', r.id)); limparCacheRegras(); m.close(); toast('Rateio excluído'); depois(); } catch (err) { fail(err); }
  });
}

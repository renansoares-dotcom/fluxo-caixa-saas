// Compras › Estoque › Endereços (EST012) — SQL 193, 22/11/2026 (Renan: balanço geral e nova organização do almoxarifado,
// "minha ideia é etiquetar tudo"). Endereço = estante, prateleira e nível dentro do local (A-03-2), com etiqueta de prateleira.
// Cada produto tem um endereço padrão por local. Três abas: os endereços (gerar em massa, imprimir as etiquetas de prateleira),
// os produtos (endereçar em lote e imprimir as etiquetas de mercadoria em lote) e o leitor (ler a prateleira e depois os produtos).
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal } from '../lib/ui.js';
import { estantes, codigosEndereco, codigoEtiqueta, porEndereco } from '../lib/etiquetas.js';
import { imprimirEnderecos, imprimirEtiquetas } from '../lib/etiquetas-ui.js';
import { aoLer } from '../lib/leitura-ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';

export const title = 'Endereços';
const PODE = ['admin', 'financeiro', 'diretor', 'compras', 'producao'];
const MAX_LINHAS = 600;
const qtd = (v) => (v == null ? '' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
let D = null;
const ui = { aba: 'enderecos', estante: '', busca: '', fam: '', filtro: 'local', mud: new Map(), sel: new Set(), selE: new Set() };
const pode = () => PODE.includes(state.papel);
const ir = (root, l, extra = '') => { history.replaceState(null, '', `#/estoque/enderecos?l=${l}${extra}`); render(root); };

export async function render(root) {
  const par = new URLSearchParams(location.hash.split('?')[1] || '');
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id;
    const locais = await q(sb.from('est_locais').select('id,codigo,nome,enderecado,ordem').eq('empresa_id', e).eq('ativo', true).eq('controla_saldo', true).order('ordem'));
    if (!locais.length) { root.innerHTML = '<div class="card"><div class="empty">Nenhum local de estoque cadastrado. Cadastre os locais em Estoque › Parâmetros › Locais.</div></div>'; return; }
    const loc = locais.find(l => l.id === par.get('l')) || locais.find(l => l.enderecado) || locais[0];
    if (D?.loc?.id !== loc.id) { ui.mud.clear(); ui.sel.clear(); ui.selE.clear(); ui.estante = ''; }
    const [end, pe, prods, fams, sal] = await Promise.all([
      fetchAll(() => sb.from('est_enderecos').select('*').eq('local_id', loc.id).order('ordem')),
      fetchAll(() => sb.from('est_produto_enderecos').select('produto_id,endereco_id').eq('local_id', loc.id)),
      fetchAll(() => sb.from('produtos').select('id,codigo,descricao,unidade,etiqueta,familia_id,local_padrao_id,controla_lote').eq('empresa_id', e).eq('ativo', true).order('descricao')),
      q(sb.from('est_familias').select('id,codigo,nome,local_padrao_id').eq('empresa_id', e).eq('ativo', true).order('nome')),
      fetchAll(() => sb.from('est_saldos').select('produto_id,lote_id,quantidade').eq('local_id', loc.id).neq('quantidade', 0))]);
    D = { locais, loc, end, endId: Object.fromEntries(end.map(x => [x.id, x])), prods, prodId: Object.fromEntries(prods.map(p => [p.id, p])), fams, famId: Object.fromEntries(fams.map(f => [f.id, f])),
      pe: new Map(pe.map(x => [x.produto_id, x.endereco_id])), sal, saldo: new Map() };
    for (const s of sal) D.saldo.set(s.produto_id, (D.saldo.get(s.produto_id) || 0) + +s.quantidade);
    if (par.get('modo') === 'leitor') ui.aba = 'leitor';
    pintar(root, par.get('e'));
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 193 já foi executado.</div></div>'; }
}

function pintar(root, endInicial) {
  const abas = [['enderecos', `Endereços (${D.end.length})`], ['produtos', 'Produtos'], ['leitor', 'Endereçar com o leitor']];
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Endereços</h2><div class="muted small">Onde cada produto fica dentro do local: estante, prateleira e nível, com a etiqueta de prateleira.</div></div>
    <label style="min-width:240px">Local<select id="en-loc">${D.locais.map(l => `<option value="${l.id}" ${l.id === D.loc.id ? 'selected' : ''}>${esc(l.nome)}${l.enderecado ? '' : ' (sem endereços)'}</option>`).join('')}</select></label></div>
    <div class="chips" id="en-abas" style="margin:4px 0 10px">${abas.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
    <div id="en-corpo"></div>`;
  $('#en-loc', root).onchange = (ev) => ir(root, ev.target.value);
  $('#en-abas', root).onclick = (ev) => { const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return; ui.aba = a; history.replaceState(null, '', `#/estoque/enderecos?l=${D.loc.id}`); pintar(root); };
  const c = $('#en-corpo', root);
  if (ui.aba === 'produtos') return abaProdutos(root, c);
  if (ui.aba === 'leitor') return abaLeitor(root, c, endInicial);
  abaEnderecos(root, c);
}

// ------------------------------------------------------------ endereços
function abaEnderecos(root, c) {
  const conta = new Map(); for (const id of D.pe.values()) conta.set(id, (conta.get(id) || 0) + 1);
  const ests = [...new Set(D.end.map(x => x.estante))];
  const lista = D.end.filter(x => !ui.estante || x.estante === ui.estante);
  c.innerHTML = `<div class="card" style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${pode() ? '<button class="btn primary" id="ea-ger">Gerar endereços</button><button class="btn" id="ea-novo">Novo endereço</button>' : ''}
      <button class="btn" id="ea-etq">Etiquetas de prateleira${ui.selE.size ? ` (${ui.selE.size})` : ''}</button><button class="btn ghost" id="ea-rel">Mapa do local (PDF)</button>
      ${pode() ? '<button class="btn ghost" id="ea-exc">Excluir selecionados</button>' : ''}
      <span class="spacer"></span>${ests.length > 1 ? `<div class="chips" id="ea-est"><span class="chip ${ui.estante ? '' : 'on'}" data-e="">Todas</span>${ests.map(e => `<span class="chip ${ui.estante === e ? 'on' : ''}" data-e="${esc(e)}">${esc(e)}</span>`).join('')}</div>` : ''}</div>
    ${D.end.length ? '' : `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">Este local ainda não tem endereços. Use <b>Gerar endereços</b>: informe as estantes (ex.: A-F), quantas prateleiras cada uma tem e quantos níveis cada prateleira tem.</div>`}
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th style="width:28px"><input type="checkbox" id="ea-all"></th><th>Endereço</th><th>Descrição</th><th class="num">Produtos</th><th>Etiqueta</th><th>Situação</th><th></th></tr></thead><tbody>
    ${lista.map(x => `<tr><td><input type="checkbox" data-s="${x.id}" ${ui.selE.has(x.id) ? 'checked' : ''}></td><td><b>${esc(x.codigo)}</b></td><td>${esc(x.descricao || '')}</td><td class="num">${conta.get(x.id) || ''}</td>
      <td style="font-family:monospace" class="small">${esc(x.etiqueta)}</td><td>${x.ativo ? '<span class="badge pago">ativo</span>' : '<span class="badge">inativo</span>'}</td>
      <td>${pode() ? `<button class="btn ghost small" data-ed="${x.id}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum endereço.</td></tr>'}</tbody></table></div></div>`;
  const repinta = () => abaEnderecos(root, c);
  $('#ea-est', c) && ($('#ea-est', c).onclick = (ev) => { const e = ev.target.closest('[data-e]'); if (e) { ui.estante = e.dataset.e; repinta(); } });
  $('#ea-all', c).onchange = (ev) => { lista.forEach(x => ev.target.checked ? ui.selE.add(x.id) : ui.selE.delete(x.id)); repinta(); };
  $$('[data-s]', c).forEach(b => b.onchange = () => { b.checked ? ui.selE.add(b.dataset.s) : ui.selE.delete(b.dataset.s); $('#ea-etq', c).textContent = `Etiquetas de prateleira${ui.selE.size ? ` (${ui.selE.size})` : ''}`; });
  $$('[data-ed]', c).forEach(b => b.onclick = () => editar(root, D.endId[b.dataset.ed]));
  $('#ea-novo', c) && ($('#ea-novo', c).onclick = () => editar(root, null));
  $('#ea-ger', c) && ($('#ea-ger', c).onclick = () => gerar(root));
  $('#ea-etq', c).onclick = () => {
    const L = (ui.selE.size ? D.end.filter(x => ui.selE.has(x.id)) : lista).filter(x => x.ativo);
    imprimirEnderecos(L.map(x => ({ etiqueta: x.etiqueta, codigo: x.codigo, local: D.loc.nome, descricao: x.descricao })));
  };
  $('#ea-rel', c).onclick = () => mapa();
  $('#ea-exc', c) && ($('#ea-exc', c).onclick = async () => {
    if (!ui.selE.size) return toast('Marque os endereços a excluir', true);
    if (!confirm(`Excluir ${ui.selE.size} endereço(s)? Endereço com produto não é excluído: mude os produtos antes.`)) return;
    try { const n = await q(sb.rpc('est_end_excluir', { p_empresa: state.empresa.id, p_ids: [...ui.selE] })); ui.selE.clear(); toast(`${n} endereço(s) excluído(s)`); render(root); } catch (err) { fail(err); } });
}

function gerar(root) {
  const m = modal({ title: `Gerar endereços — ${D.loc.nome}`, body: `<div class="grid-form">
      <label class="span2">Estantes<input id="ge-e" placeholder="ex.: A-F ou A, B, C ou 1-12" value="A-D"></label>
      <label>Prateleiras por estante<input type="number" id="ge-p" min="1" max="99" value="5"></label>
      <label>Níveis por prateleira<input type="number" id="ge-n" min="0" max="20" value="0"></label>
      <label>Dígitos da prateleira<select id="ge-d"><option value="1">1 (A-3)</option><option value="2" selected>2 (A-03)</option><option value="3">3 (A-003)</option></select></label></div>
    <p class="small muted">Nível = posição dentro da prateleira (da esquerda para a direita, ou caixa/gaveta). Sem nível, use 0: o endereço fica estante-prateleira (A-03).
      O que já existe não é alterado; a geração só cria o que falta, no fim do corredor.</p>
    <div id="ge-prev" class="small" style="margin-top:6px"></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ge-ok">Gerar</button>' });
  const ler = () => { const e = estantes($('#ge-e', m.el).value), p = +$('#ge-p', m.el).value, n = +$('#ge-n', m.el).value, d = +$('#ge-d', m.el).value; return { e, p, n, d }; };
  const prev = () => { const { e, p, n, d } = ler(); const box = $('#ge-prev', m.el);
    if (e.erro) { box.innerHTML = `<span class="neg">${esc(e.erro)}</span>`; return; }
    if (!(p >= 1 && p <= 99) || !(n >= 0 && n <= 20)) { box.innerHTML = '<span class="neg">Prateleiras de 1 a 99 e níveis de 0 a 20.</span>'; return; }
    if (String(p).length > d) { box.innerHTML = `<span class="neg">Com ${p} prateleiras, use pelo menos ${String(p).length} dígitos.</span>`; return; }
    const cods = codigosEndereco(e.lista, p, n, d), ja = new Set(D.end.map(x => x.codigo)), novos = cods.filter(x => !ja.has(x));
    box.innerHTML = `<b>${novos.length}</b> endereço(s) novo(s)${cods.length - novos.length ? `, ${cods.length - novos.length} já existe(m)` : ''}. Exemplos: ${esc(cods.slice(0, 4).join(', '))}${cods.length > 4 ? ` … ${esc(cods[cods.length - 1])}` : ''}`; };
  ['ge-e', 'ge-p', 'ge-n', 'ge-d'].forEach(id => $('#' + id, m.el).oninput = prev); prev();
  $('#ge-ok', m.el).onclick = async (ev) => { const { e, p, n, d } = ler(); if (e.erro) return toast(e.erro, true);
    ev.target.disabled = true;
    try { const k = await q(sb.rpc('est_end_gerar', { p_empresa: state.empresa.id, p_local: D.loc.id, p_estantes: e.lista, p_prateleiras: p, p_niveis: n, p_digitos: d }));
      m.close(); toast(`${k} endereço(s) criado(s). Imprima as etiquetas de prateleira.`); render(root); }
    catch (err) { fail(err); ev.target.disabled = false; } };
}

function editar(root, x) {
  const m = modal({ title: x ? `Endereço ${x.codigo}` : `Novo endereço — ${D.loc.nome}`, body: `<div class="grid-form">
      <label>Estante<input id="ed-e" maxlength="6" value="${esc(x?.estante || '')}"></label><label>Prateleira<input id="ed-p" maxlength="6" value="${esc(x?.prateleira || '')}"></label>
      <label>Nível<input id="ed-n" maxlength="6" value="${esc(x?.nivel || '')}"></label><label>Código<input id="ed-c" maxlength="20" value="${esc(x?.codigo || '')}" placeholder="montado da estante, prateleira e nível"></label>
      <label class="span2">Descrição<input id="ed-d" maxlength="80" value="${esc(x?.descricao || '')}" placeholder="ex.: paletes perto da porta"></label>
      ${x ? `<label>Ordem no corredor<input type="number" id="ed-o" value="${x.ordem}"></label><label style="display:flex;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="ed-a" style="width:auto;margin:0" ${x.ativo ? 'checked' : ''}> Ativo</label>` : ''}</div>
    <p class="small muted">A ordem no corredor define a sequência da guia de contagem e da lista de entrega (menor primeiro). Endereço fora das estantes (piso, paletes, gaiola) também vale: use, por exemplo, estante PISO.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ed-ok">Salvar</button>' });
  const monta = () => { if (x && $('#ed-c', m.el).dataset.mexeu) return; const t = [$('#ed-e', m.el).value, $('#ed-p', m.el).value, $('#ed-n', m.el).value].map(v => v.trim().toUpperCase()).filter(Boolean).join('-'); if (!x) $('#ed-c', m.el).value = t; };
  ['ed-e', 'ed-p', 'ed-n'].forEach(id => $('#' + id, m.el).oninput = monta); $('#ed-c', m.el).oninput = (ev) => { ev.target.dataset.mexeu = '1'; };
  $('#ed-ok', m.el).onclick = async () => {
    const p = { id: x?.id, local_id: D.loc.id, estante: $('#ed-e', m.el).value, prateleira: $('#ed-p', m.el).value, nivel: $('#ed-n', m.el).value, codigo: $('#ed-c', m.el).value, descricao: $('#ed-d', m.el).value };
    if (x) { p.ordem = +$('#ed-o', m.el).value; p.ativo = $('#ed-a', m.el).checked; }
    try { await q(sb.rpc('est_end_salvar', { p_empresa: state.empresa.id, p })); m.close(); toast('Endereço salvo'); render(root); } catch (err) { fail(err); }
  };
}

// mapa do local: cada endereço e o que deve estar nele (para a arrumação e para conferir as prateleiras)
function mapa() {
  const por = new Map(); for (const [pid, eid] of D.pe) { const a = por.get(eid) || []; const p = D.prodId[pid]; if (p) a.push(p); por.set(eid, a); }
  const linhas = D.end.filter(x => x.ativo && (!ui.estante || x.estante === ui.estante)).map(x => {
    const ps = (por.get(x.id) || []).sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'));
    return ps.length ? ps.map((p, i) => `<tr>${i ? '<td></td>' : `<td rowspan="1"><b>${esc(x.codigo)}</b></td>`}<td>${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td>${esc(p.unidade || '')}</td></tr>`).join('')
      : `<tr><td><b>${esc(x.codigo)}</b></td><td colspan="3" style="color:#777">vazio</td></tr>`; }).join('');
  const sem = D.prods.filter(p => !D.pe.has(p.id) && (D.saldo.get(p.id) || 0) > 0);
  abrirRelatorio({ nome: 'Mapa de endereços', titulo: `Mapa de endereços — ${D.loc.nome}`, subtitulo: `${D.end.filter(x => x.ativo).length} endereço(s) · ${D.pe.size} produto(s) endereçado(s)`,
    corpo: `<table><thead><tr><th style="width:80px">Endereço</th><th style="width:100px">Código</th><th>Produto</th><th style="width:40px">Un.</th></tr></thead><tbody>${linhas || '<tr><td colspan="4">Nenhum endereço.</td></tr>'}</tbody></table>
      ${sem.length ? `<h2>Com saldo no local e sem endereço (${sem.length})</h2><table><thead><tr><th style="width:100px">Código</th><th>Produto</th><th style="width:40px">Un.</th></tr></thead><tbody>${sem.map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.descricao)}</td><td>${esc(p.unidade || '')}</td></tr>`).join('')}</tbody></table>` : ''}`,
    tipo: 'relatorio', parametros: [['Local', D.loc.nome], ['Estante', ui.estante || 'Todas']] });
}

// ------------------------------------------------------------ produtos: endereçar em lote e etiquetas em lote
function doLocal(p) {
  return D.pe.has(p.id) || (D.saldo.get(p.id) || 0) !== 0 || p.local_padrao_id === D.loc.id || (!p.local_padrao_id && D.famId[p.familia_id]?.local_padrao_id === D.loc.id);
}
function abaProdutos(root, c) {
  const ativos = D.end.filter(x => x.ativo), t = ui.busca.trim().toUpperCase();
  const cand = D.prods.filter(p => (ui.filtro === 'todos' || doLocal(p)) && (ui.filtro !== 'sem' || !D.pe.has(p.id)) && (!ui.fam || p.familia_id === ui.fam)
    && (!t || p.codigo.toUpperCase().includes(t) || p.descricao.toUpperCase().includes(t)))
    .map(p => { const eid = ui.mud.has(p.id) ? ui.mud.get(p.id) : D.pe.get(p.id); return { ...p, eid, endereco_ordem: D.endId[eid]?.ordem }; }).sort(porEndereco);
  const lista = cand.slice(0, MAX_LINHAS), opt = (sel) => `<option value="">— sem endereço —</option>${ativos.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.codigo)}</option>`).join('')}`;
  c.innerHTML = `<div class="card" style="margin-bottom:12px"><div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1.4fr) minmax(0,1.4fr);gap:10px">
      <label>Buscar<input id="ep-b" value="${esc(ui.busca)}" placeholder="código ou descrição"></label>
      <label>Família<select id="ep-f"><option value="">Todas</option>${D.fams.map(f => `<option value="${f.id}" ${ui.fam === f.id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></label>
      <label>Mostrar<select id="ep-v"><option value="local" ${ui.filtro === 'local' ? 'selected' : ''}>Produtos deste local</option><option value="sem" ${ui.filtro === 'sem' ? 'selected' : ''}>Deste local e sem endereço</option><option value="todos" ${ui.filtro === 'todos' ? 'selected' : ''}>Todos os produtos</option></select></label></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:10px">
      ${pode() ? `<button class="btn primary" id="ep-ok" ${ui.mud.size ? '' : 'disabled'}>Gravar endereços${ui.mud.size ? ` (${ui.mud.size})` : ''}</button>
      <label style="margin:0">Pôr os marcados em<select id="ep-dst">${opt('')}</select></label><button class="btn" id="ep-mv">Aplicar</button>` : ''}
      <button class="btn" id="ep-etq">Etiquetas dos marcados${ui.sel.size ? ` (${ui.sel.size})` : ''}</button><span class="spacer"></span>
      <span class="small muted">${cand.length} produto(s)${cand.length > MAX_LINHAS ? ` · mostrando ${MAX_LINHAS}: refine a busca` : ''}</span></div>
    ${ativos.length ? '' : '<p class="small" style="color:var(--warn);margin-bottom:0">O local ainda não tem endereços: gere-os na aba Endereços.</p>'}</div>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th style="width:28px"><input type="checkbox" id="ep-all"></th><th>Código</th><th>Descrição</th><th>Família</th><th style="width:150px">Endereço</th><th class="num">Saldo no local</th></tr></thead><tbody>
    ${lista.map(p => `<tr><td><input type="checkbox" data-s="${p.id}" ${ui.sel.has(p.id) ? 'checked' : ''}></td><td><b>${esc(p.codigo)}</b></td><td class="wrap">${esc(p.descricao)}${p.controla_lote ? ' <span class="badge negoc">lote</span>' : ''}</td>
      <td>${esc(D.famId[p.familia_id]?.nome || '')}</td><td>${pode() ? `<select data-p="${p.id}" ${ui.mud.has(p.id) ? 'style="outline:2px solid var(--warn)"' : ''}>${opt(p.eid)}</select>` : esc(D.endId[p.eid]?.codigo || '—')}</td>
      <td class="num">${D.saldo.has(p.id) ? `${qtd(D.saldo.get(p.id))} ${esc(p.unidade || '')}` : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum produto. Troque o filtro para "Todos os produtos" para endereçar o que ainda não tem saldo nem local padrão aqui.</td></tr>'}</tbody></table></div></div>`;
  const repinta = () => abaProdutos(root, c);
  $('#ep-b', c).oninput = (ev) => { clearTimeout(ui.t); ui.t = setTimeout(() => { ui.busca = ev.target.value; repinta(); $('#ep-b', c).focus(); const v = $('#ep-b', c); v.setSelectionRange(v.value.length, v.value.length); }, 300); };
  $('#ep-f', c).onchange = (ev) => { ui.fam = ev.target.value; repinta(); };
  $('#ep-v', c).onchange = (ev) => { ui.filtro = ev.target.value; repinta(); };
  $('#ep-all', c).onchange = (ev) => { lista.forEach(p => ev.target.checked ? ui.sel.add(p.id) : ui.sel.delete(p.id)); repinta(); };
  $$('[data-s]', c).forEach(b => b.onchange = () => { b.checked ? ui.sel.add(b.dataset.s) : ui.sel.delete(b.dataset.s); $('#ep-etq', c).textContent = `Etiquetas dos marcados${ui.sel.size ? ` (${ui.sel.size})` : ''}`; });
  $$('[data-p]', c).forEach(s => s.onchange = () => { const v = s.value || null; (v === (D.pe.get(s.dataset.p) || null)) ? ui.mud.delete(s.dataset.p) : ui.mud.set(s.dataset.p, v); repinta(); });
  $('#ep-mv', c) && ($('#ep-mv', c).onclick = () => { if (!ui.sel.size) return toast('Marque os produtos', true); const v = $('#ep-dst', c).value || null;
    for (const id of ui.sel) (v === (D.pe.get(id) || null)) ? ui.mud.delete(id) : ui.mud.set(id, v); repinta(); toast('Confira e use Gravar endereços'); });
  $('#ep-ok', c) && ($('#ep-ok', c).onclick = async (ev) => { ev.target.disabled = true;
    try { const r = await q(sb.rpc('est_end_atribuir', { p_empresa: state.empresa.id, p_itens: [...ui.mud].map(([produto_id, endereco_id]) => ({ produto_id, local_id: D.loc.id, endereco_id })) }));
      for (const [pid, eid] of ui.mud) eid ? D.pe.set(pid, eid) : D.pe.delete(pid); ui.mud.clear();
      toast(`${r.atribuidos} endereçado(s)${r.removidos ? `, ${r.removidos} sem endereço` : ''}${r.trocados?.length ? ` · ${r.trocados.length} mudaram de endereço` : ''}`); repinta(); }
    catch (err) { fail(err); ev.target.disabled = false; } });
  $('#ep-etq', c).onclick = () => etiquetasLote([...ui.sel].map(id => D.prodId[id]).filter(Boolean));
}

// etiquetas de mercadoria em lote: produto com lote = uma etiqueta por lote com saldo no local; sem lote = a do produto
async function etiquetasLote(ps) {
  if (!ps.length) return toast('Marque os produtos', true);
  const ids = [...new Set(D.sal.filter(s => s.lote_id && ps.some(p => p.id === s.produto_id && p.controla_lote)).map(s => s.lote_id))];
  let L = []; try { if (ids.length) L = await q(sb.from('est_lotes').select('id,codigo,lote_fornecedor,etiqueta').in('id', ids)); } catch (err) { return fail(err); }
  const itens = [];
  for (const p of ps.sort((a, b) => porEndereco({ ...a, endereco_ordem: D.endId[D.pe.get(a.id)]?.ordem }, { ...b, endereco_ordem: D.endId[D.pe.get(b.id)]?.ordem }))) {
    const base = { produto_codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, endereco: D.endId[D.pe.get(p.id)]?.codigo || '' };
    const ls = p.controla_lote ? D.sal.filter(s => s.produto_id === p.id && s.lote_id) : [];
    if (ls.length) for (const s of ls) { const l = L.find(x => x.id === s.lote_id); if (l) itens.push({ ...base, etiqueta: l.etiqueta, lote: l.codigo, lote_fornecedor: l.lote_fornecedor || '', quantidade: s.quantidade }); }
    else itens.push({ ...base, etiqueta: p.etiqueta, quantidade: D.saldo.get(p.id) ?? null });
  }
  imprimirEtiquetas(itens, { titulo: `Etiquetas em lote — ${D.loc.nome} (${itens.length} item(ns))` });
}

// ------------------------------------------------------------ endereçar com o leitor: a prateleira, depois os produtos
function abaLeitor(root, c, endInicial) {
  let atual = D.endId[endInicial] || null; const log = [];
  const temCam = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  c.innerHTML = `<div class="card" style="margin-bottom:12px">
      <div id="el-atual" style="font-size:1.4em;margin-bottom:8px"></div>
      <form id="el-f" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">
        <label>Leia a etiqueta da prateleira e depois a de cada produto que está nela<input id="el-cod" autocomplete="off" style="font-size:1.1em" placeholder="etiqueta, código do produto ou do endereço" ${pode() ? 'autofocus' : 'disabled'}></label>
        <button class="btn primary" style="min-height:44px" ${pode() ? '' : 'disabled'}>Ler</button></form>
      ${temCam && pode() ? '<button type="button" class="btn" id="el-cam" style="min-height:44px;margin-top:8px">Ler pela câmera</button><video id="el-video" playsinline muted hidden style="width:100%;max-width:420px;border-radius:12px;background:#000;aspect-ratio:4/3;object-fit:cover;display:block;margin-top:8px"></video>' : ''}
      <p class="small muted" style="margin-bottom:0">A etiqueta da prateleira (E…) muda o endereço atual. A etiqueta do produto (P…) ou do lote (L…), ou o código do produto, põe o produto no endereço atual. ${pode() ? '' : 'Seu perfil só consulta.'}</p></div>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>Hora</th><th>Produto</th><th>Endereço</th><th>Antes</th></tr></thead><tbody id="el-log"><tr><td colspan="4" class="empty">Nada lido ainda.</td></tr></tbody></table></div></div>`;
  const mostra = () => { $('#el-atual', c).innerHTML = atual ? `Endereço atual: <b>${esc(atual.codigo)}</b>${atual.descricao ? ` <span class="small muted">${esc(atual.descricao)}</span>` : ''}` : '<span class="muted">Leia a etiqueta da prateleira para começar.</span>'; };
  const pintaLog = () => { $('#el-log', c).innerHTML = log.map(x => `<tr><td>${x.hora}</td><td><b>${esc(x.cod)}</b> ${esc(x.desc)}</td><td><b>${esc(x.end)}</b></td><td>${esc(x.antes || '')}</td></tr>`).join(''); };
  mostra();
  const ler = async (bruto) => {
    const t = String(bruto || '').replace(/^.*[?&]b=([^&#]+).*$/i, '$1').trim(); if (!t) return;
    const etq = codigoEtiqueta(t), T = t.toUpperCase();
    if (etq?.alvo === 'endereco' || (!etq && D.end.some(x => x.codigo === T))) {
      const x = etq ? D.end.find(y => y.etiqueta === etq.codigo) : D.end.find(y => y.codigo === T);
      if (!x) { try { const o = await q(sb.from('est_enderecos').select('codigo,local_id').eq('empresa_id', state.empresa.id).eq('etiqueta', etq.codigo).maybeSingle());
        return toast(o ? `O endereço ${o.codigo} é do local ${D.locais.find(l => l.id === o.local_id)?.nome || 'outro'}. Troque o local no alto da tela.` : 'Etiqueta de endereço não encontrada.', true); } catch (err) { return fail(err); } }
      if (!x.ativo) return toast(`O endereço ${x.codigo} está inativo.`, true);
      atual = x; mostra(); return toast(`Endereço ${x.codigo}: agora leia os produtos`);
    }
    let p = null;
    if (etq?.alvo === 'produto') p = D.prods.find(y => y.etiqueta === etq.codigo);
    else if (etq?.alvo === 'lote') { try { const l = await q(sb.from('est_lotes').select('produto_id').eq('empresa_id', state.empresa.id).eq('etiqueta', etq.codigo).maybeSingle()); p = l && D.prodId[l.produto_id]; } catch (err) { return fail(err); } }
    else p = D.prods.find(y => y.codigo.toUpperCase() === T);
    if (!p) return toast(`Código ${t} não encontrado no cadastro de produtos.`, true);
    if (!atual) return toast('Leia primeiro a etiqueta da prateleira.', true);
    if (D.pe.get(p.id) === atual.id) return toast(`${p.codigo} já está em ${atual.codigo}`);
    try {
      const r = await q(sb.rpc('est_end_atribuir', { p_empresa: state.empresa.id, p_itens: [{ produto_id: p.id, local_id: D.loc.id, endereco_id: atual.id }] }));
      const antes = r.trocados?.[0]?.de || ''; D.pe.set(p.id, atual.id);
      log.unshift({ hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), cod: p.codigo, desc: p.descricao, end: atual.codigo, antes: antes ? `estava em ${antes}` : '' }); pintaLog();
      toast(`${p.codigo} → ${atual.codigo}${antes ? ` (estava em ${antes})` : ''}`);
    } catch (err) { fail(err); }
  };
  $('#el-f', c).onsubmit = (ev) => { ev.preventDefault(); const i = $('#el-cod', c); const v = i.value; i.value = ''; ler(v); i.focus(); };
  aoLer('etiqueta', (r) => ler(r.codigo), c);   // leitura com o foco fora do campo
  const cam = $('#el-cam', c); let fluxo = null, quadro = 0;
  const parar = () => { cancelAnimationFrame(quadro); fluxo?.getTracks().forEach(t => t.stop()); fluxo = null; };
  if (cam) cam.onclick = async () => {
    const v = $('#el-video', c);
    if (fluxo) { parar(); v.hidden = true; cam.textContent = 'Ler pela câmera'; return; }
    try {
      fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      v.srcObject = fluxo; v.hidden = false; await v.play(); cam.textContent = 'Parar a câmera';
      const det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code', 'code_39'] }); let ultimo = '', quando = 0;
      const ciclo = async () => { if (!fluxo || !v.isConnected) return parar();
        try { const t = (await det.detect(v))[0]?.rawValue; if (t && (t !== ultimo || Date.now() - quando > 4000)) { ultimo = t; quando = Date.now(); ler(t); } } catch { /* quadro sem código */ }
        quadro = requestAnimationFrame(ciclo); };
      ciclo();
    } catch (err) { parar(); fail(new Error('Não foi possível abrir a câmera: ' + (err.message || err))); }
  };
}


// Estoque › De-para de fornecedores: cada código de item nas notas de entrada (CNPJ + cProd) é ligado a um produto do cadastro,
// existente ou criado aqui. Com o de-para, a plataforma calcula o custo de compra e casa o recebimento sozinha.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { TIPOS, tipoPorNcm, carregarProdutos, limparCacheProdutos, datalistProdutos, acharProduto } from '../lib/produtos.js';
import { num } from '../lib/compras.js';

export const title = 'De-para de fornecedores';
const ui = { desde: '2026-01-01', busca: '', forn: '' };
let PEND = [], PROD = [];
const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1);

// produto mais parecido: palavras em comum na descrição, com bônus para o mesmo NCM
function sugerir(x) {
  const pal = new Set(norm(x.descricao)); let best = null, bs = 0;
  for (const p of PROD) {
    if (!p.ativo || p.tipo === 'produto_acabado') continue;
    const w = norm(p.descricao); let s = w.filter(t => pal.has(t)).length / Math.max(pal.size, w.length, 1);
    if (x.ncm && p.ncm === x.ncm) s += 0.3;
    if (s > bs) { bs = s; best = p; }
  }
  return bs >= 0.45 ? best : null;
}

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">De-para de fornecedores</h2><div class="muted small">Itens das NF-e de entrada ainda sem produto. Ligue a um produto existente ou crie o produto (insumo) a partir do item.</div></div>
      <button class="btn primary" id="dp-criar">Criar produtos dos marcados</button></div>
    <div class="card toolbar"><label>Notas desde<input type="date" id="dp-de" value="${ui.desde}"></label>
      <label>Fornecedor<select id="dp-f"><option value="">Todos</option></select></label>
      <input id="dp-b" placeholder="Procurar descrição, código ou NCM" value="${esc(ui.busca)}" style="min-width:260px"></div>
    <div id="dp-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#dp-de', root).onchange = (e) => { ui.desde = e.target.value; carregar(root); };
  $('#dp-f', root).onchange = (e) => { ui.forn = e.target.value; pintar(root); };
  $('#dp-b', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  $('#dp-criar', root).onclick = () => criarMarcados(root);
  await carregar(root);
}
async function carregar(root) {
  try {
    [PEND, PROD] = await Promise.all([q(sb.rpc('produto_depara_pendente', { p_empresa: state.empresa.id, p_de: ui.desde })), carregarProdutos(true)]);
    PEND.sort((a, b) => b.valor - a.valor); PEND.forEach(x => { x.sug = sugerir(x); });
    const fs = [...new Map(PEND.map(x => [x.emit_doc, x.emit_nome])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    $('#dp-f', root).innerHTML = `<option value="">Todos (${fs.length})</option>` + fs.map(([d, n]) => `<option value="${d}" ${ui.forn === d ? 'selected' : ''}>${esc(n || d)}</option>`).join('');
    pintar(root);
  } catch (err) { fail(err); $('#dp-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}
function pintar(root) {
  const b = ui.busca.trim().toLowerCase();
  const vis = PEND.filter(x => (!ui.forn || x.emit_doc === ui.forn) && (!b || [x.descricao, x.codigo_fornecedor, x.ncm, x.emit_nome].some(v => String(v || '').toLowerCase().includes(b))));
  $('#dp-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:68vh"><table><thead><tr><th><input type="checkbox" id="dp-all"></th><th>Fornecedor</th><th>Código</th><th>Descrição no fornecedor</th><th>Unid.</th><th>NCM</th><th class="num">Notas</th><th class="num">Comprado</th><th>Última</th><th>Sugestão</th><th></th></tr></thead><tbody>
    ${vis.slice(0, 800).map(x => { const i = PEND.indexOf(x); return `<tr data-i="${i}"><td><input type="checkbox" class="dp-c"></td><td class="wrap">${esc(x.emit_nome || x.emit_doc)}</td><td>${esc(x.codigo_fornecedor)}</td><td class="wrap">${esc(x.descricao)}</td>
      <td>${esc(x.unidade || '')}</td><td>${esc(x.ncm || '')}</td><td class="num">${x.notas}</td><td class="num">${money(x.valor)}</td><td>${dateBR(x.ultima)}</td>
      <td class="wrap small">${x.sug ? `${esc(x.sug.codigo)} — ${esc(x.sug.descricao)}` : '<span class="muted">criar novo</span>'}</td><td><button class="btn small" data-v="${i}">Ligar…</button></td></tr>`; }).join('')
    || '<tr><td colspan="11" class="empty">Todos os itens de fornecedor do período estão ligados a um produto.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">${vis.length} item(ns) sem de-para · ${money(vis.reduce((t, x) => t + +x.valor, 0))} comprados${vis.length > 800 ? ' — mostrando os 800 de maior valor' : ''}. "Criar produtos dos marcados" cria um insumo para cada item marcado sem sugestão e liga à sugestão os que têm.</p>`;
  $('#dp-all', root) && ($('#dp-all', root).onchange = (e) => $$('.dp-c', root).forEach(c => c.checked = e.target.checked));
  $$('[data-v]', root).forEach(bt => bt.onclick = () => ligar(PEND[+bt.dataset.v], root));
}

async function gravarVinculo(x, produto, fator) {
  await q(sb.from('produto_fornecedores').insert({ empresa_id: state.empresa.id, produto_id: produto.id, emit_doc: x.emit_doc, codigo_fornecedor: x.codigo_fornecedor,
    descricao_fornecedor: x.descricao, unidade_fornecedor: x.unidade, fator: fator || 1, ultima_compra: x.ultima }));
}
const codigoNovo = (x) => `F${String(x.emit_doc).slice(0, 8)}-${x.codigo_fornecedor}`.slice(0, 40);

function ligar(x, root) {
  const m = modal({ title: `Ligar item do fornecedor — ${x.codigo_fornecedor}`, wide: true, body: `
    <p class="small" style="margin-top:0"><b>${esc(x.emit_nome || x.emit_doc)}</b> · ${esc(x.descricao)} · ${esc(x.unidade || '')} · NCM ${esc(x.ncm || '–')} · ${x.notas} nota(s), ${money(x.valor)}</p>
    <div class="chips" id="lg-m"><span class="chip on" data-m="existe">Ligar a produto existente</span><span class="chip" data-m="novo">Criar produto novo</span></div>
    <div id="lg-existe" style="margin-top:10px"><label>Produto<input id="lg-p" list="lg-dl" value="${x.sug ? esc(`${x.sug.codigo} — ${x.sug.descricao}`) : ''}" placeholder="código ou descrição">${datalistProdutos('lg-dl', PROD)}</label></div>
    <div id="lg-novo" hidden style="margin-top:10px"><div class="grid-form">
      <label>Código *<input id="lg-cod" value="${esc(codigoNovo(x))}"></label><label class="span2">Descrição *<input id="lg-des" value="${esc(x.descricao)}"></label>
      <label>Tipo<select id="lg-tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${tipoPorNcm(x.ncm) === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Unidade<input id="lg-un" value="${esc((x.unidade || 'UN').toUpperCase())}"></label></div>
      <p class="small muted">Se o item já tem código no Iniflex, use o código do Iniflex: é ele que liga o produto ao espelho do estoque.</p></div>
    <label style="margin-top:10px;max-width:320px">Fator: 1 ${esc(x.unidade || 'un.')} do fornecedor = quantas unidades do produto?<input id="lg-f" value="1"></label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lg-ok">Ligar</button>` });
  let modo = 'existe';
  $('#lg-m', m.el).onclick = (e) => { const c = e.target.closest('[data-m]'); if (!c) return; modo = c.dataset.m; $$('#lg-m .chip', m.el).forEach(k => k.classList.toggle('on', k === c));
    $('#lg-existe', m.el).hidden = modo !== 'existe'; $('#lg-novo', m.el).hidden = modo !== 'novo'; };
  $('#lg-ok', m.el).onclick = async (ev) => {
    const fator = num($('#lg-f', m.el).value) || 1;
    ev.target.disabled = true;
    try {
      let prod;
      if (modo === 'existe') { prod = acharProduto($('#lg-p', m.el).value, PROD); if (!prod) { ev.target.disabled = false; return toast('Escolha o produto na lista', true); } }
      else {
        const cod = $('#lg-cod', m.el).value.trim(), des = $('#lg-des', m.el).value.trim(); if (!cod || !des) { ev.target.disabled = false; return toast('Código e descrição', true); }
        prod = await q(sb.from('produtos').insert({ empresa_id: state.empresa.id, codigo: cod, descricao: des, tipo: $('#lg-tipo', m.el).value, unidade: $('#lg-un', m.el).value.trim().toUpperCase() || 'UN',
          ncm: x.ncm || null, origem: 'nfe_entrada' }).select('*').single());
        limparCacheProdutos();
      }
      await gravarVinculo(x, prod, fator);
      m.close(); toast(`Ligado a ${prod.codigo}`); await carregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

async function criarMarcados(root) {
  const sel = $$('#dp-lista tr[data-i]', root).filter(tr => $('.dp-c', tr)?.checked).map(tr => PEND[+tr.dataset.i]);
  if (!sel.length) return toast('Marque os itens na lista', true);
  const novos = sel.filter(x => !x.sug), ligar_ = sel.filter(x => x.sug);
  if (!await confirmDialog(`${novos.length} produto(s) novo(s) serão criados (tipo pelo NCM, código F + CNPJ + código do fornecedor) e ${ligar_.length} item(ns) serão ligados à sugestão. Fator 1 para todos. Confirmar?`)) return;
  try {
    const e = state.empresa.id;
    const criados = novos.length ? await q(sb.from('produtos').insert(novos.map(x => ({ empresa_id: e, codigo: codigoNovo(x), descricao: x.descricao, tipo: tipoPorNcm(x.ncm),
      unidade: (x.unidade || 'UN').toUpperCase(), ncm: x.ncm || null, origem: 'nfe_entrada' }))).select('id,codigo')) : [];
    const porCod = Object.fromEntries(criados.map(c => [c.codigo, c]));
    const vinc = [...novos.map(x => ({ x, p: porCod[codigoNovo(x)] })), ...ligar_.map(x => ({ x, p: x.sug }))].filter(v => v.p);
    for (let i = 0; i < vinc.length; i += 300) await q(sb.from('produto_fornecedores').insert(vinc.slice(i, i + 300).map(({ x, p }) => ({ empresa_id: e, produto_id: p.id, emit_doc: x.emit_doc,
      codigo_fornecedor: x.codigo_fornecedor, descricao_fornecedor: x.descricao, unidade_fornecedor: x.unidade, fator: 1, ultima_compra: x.ultima }))));
    limparCacheProdutos(); toast(`${criados.length} criado(s), ${vinc.length} ligado(s)`); await carregar(root);
  } catch (err) { fail(err); }
}

// Estoque › Produtos: cadastro (atributos de plástico flexível, parâmetros de estoque), de-para de fornecedores,
// estrutura do produto com custo teórico, compras pelas NF-e e posição nos espelhos do Iniflex.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal, confirmDialog, exportXLSX } from '../lib/ui.js';
import { TIPOS, MATERIAIS, FORMATOS, pesoTeorico, carregarProdutos, limparCacheProdutos, datalistProdutos, acharProduto } from '../lib/produtos.js';
import { qtd, inp, unit, num } from '../lib/compras.js';

export const title = 'Produtos';
const ui = { tipo: '', busca: '', inativos: false };
let L = [];
const compras = () => state.papel === 'compras';
const podeEditarCad = () => ['admin', 'financeiro', 'diretor', 'compras'].includes(state.papel);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Produtos</h2><div class="muted small">O código é o do Iniflex (o mesmo das notas de saída). O saldo vem dos espelhos do Iniflex em Posição de estoque.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="pr-xls">Excel</button>${!compras() && podeEditarCad() ? '<button class="btn" id="pr-imp">Importar das notas de saída</button>' : ''}${podeEditarCad() ? '<button class="btn primary" id="pr-novo">Novo produto</button>' : ''}</div></div>
    <div class="card toolbar"><label>Tipo<select id="pr-tipo"><option value="">Todos</option>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${ui.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <input id="pr-busca" placeholder="Procurar código, descrição, NCM ou material" value="${esc(ui.busca)}" style="min-width:280px">
      <label class="chk"><input type="checkbox" id="pr-in" ${ui.inativos ? 'checked' : ''}> Mostrar inativos</label></div>
    <div id="pr-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#pr-novo', root) && ($('#pr-novo', root).onclick = () => editar(null, root));
  $('#pr-imp', root) && ($('#pr-imp', root).onclick = () => importarSaidas(root));
  $('#pr-xls', root).onclick = () => exportXLSX($('#pr-lista table', root), 'produtos');
  $('#pr-tipo', root).onchange = (e) => { ui.tipo = e.target.value; pintar(root); };
  $('#pr-busca', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  $('#pr-in', root).onchange = (e) => { ui.inativos = e.target.checked; pintar(root); };
  const ab = state.abrir?.tipo === 'produto' ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if (ab) { const p = L.find(x => x.id === ab.id); if (p) abrir(p, root); }
}
async function carregar(root) {
  try { L = await carregarProdutos(true); pintar(root); } catch (err) { fail(err); $('#pr-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}
function pintar(root) {
  const b = ui.busca.trim().toLowerCase();
  const vis = L.filter(p => (ui.inativos || p.ativo) && (!ui.tipo || p.tipo === ui.tipo) && (!b || [p.codigo, p.descricao, p.ncm, p.material, p.grupo].some(x => String(x || '').toLowerCase().includes(b))));
  const cont = {}; for (const p of L.filter(x => x.ativo)) cont[p.tipo] = (cont[p.tipo] || 0) + 1;
  $('#pr-lista', root).innerHTML = `<div class="chips" style="margin-bottom:10px">${Object.entries(cont).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="chip ${ui.tipo === k ? 'on' : ''}" data-t="${k}">${TIPOS[k]} · ${n}</span>`).join('')}</div>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th>Unid.</th><th>NCM</th><th>Material</th><th class="num">Largura</th><th class="num">Espessura</th><th class="num">Ponto de pedido</th><th>Situação</th></tr></thead><tbody>
    ${vis.slice(0, 1500).map(p => `<tr class="clickable" data-id="${p.id}"><td>${esc(p.codigo)}</td><td class="wrap">${esc(p.descricao)}</td><td>${esc(TIPOS[p.tipo] || p.tipo)}</td><td>${esc(p.unidade)}</td><td>${esc(p.ncm || '')}</td>
      <td>${esc(p.material || '')}</td><td class="num">${p.largura_mm ? qtd(p.largura_mm) + ' mm' : ''}</td><td class="num">${p.espessura_um ? qtd(p.espessura_um) + ' µm' : ''}</td><td class="num">${p.ponto_pedido != null ? qtd(p.ponto_pedido) : ''}</td>
      <td>${p.ativo ? '' : '<span class="badge">inativo</span>'}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Nenhum produto. Use "Importar das notas de saída" ou "Novo produto".</td></tr>'}</tbody></table></div></div>
    <p class="small muted">${vis.length} produto(s)${vis.length > 1500 ? ' — mostrando os 1.500 primeiros; refine a busca' : ''}.</p>`;
  $$('#pr-lista [data-t]', root).forEach(c => c.onclick = () => { ui.tipo = ui.tipo === c.dataset.t ? '' : c.dataset.t; $('#pr-tipo', root).value = ui.tipo; pintar(root); });
  $$('#pr-lista tr[data-id]', root).forEach(tr => tr.onclick = () => abrir(L.find(p => p.id === tr.dataset.id), root));
}

// ------------------------------------------------------------ editar
function editar(p, root) {
  const v = p || { tipo: 'materia_prima', unidade: 'KG', ativo: true };
  const sel = (id, obj, val, vazio = true) => `<select id="${id}">${vazio ? '<option value="">—</option>' : ''}${Object.entries(obj).map(([k, t]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${typeof t === 'string' ? t : k}</option>`).join('')}</select>`;
  const n = (id, val, ph = '') => `<input id="${id}" value="${val != null ? inp(val) : ''}" placeholder="${ph}">`;
  const m = modal({ title: p ? `${p.codigo} — editar` : 'Novo produto', wide: true, body: `
    <div class="grid-form">
      <label>Código (Iniflex) *<input id="pf-cod" value="${esc(v.codigo || '')}"></label>
      <label class="span2">Descrição *<input id="pf-des" value="${esc(v.descricao || '')}"></label>
      <label>Tipo${sel('pf-tipo', TIPOS, v.tipo, false)}</label>
      <label>Unidade<input id="pf-un" value="${esc(v.unidade || 'KG')}"></label>
      <label>NCM<input id="pf-ncm" value="${esc(v.ncm || '')}"></label>
      <label>Grupo<input id="pf-gr" value="${esc(v.grupo || '')}"></label>
      <label>Subgrupo<input id="pf-sg" value="${esc(v.subgrupo || '')}"></label>
    </div>
    <h3 style="margin:14px 0 6px">Plástico flexível</h3>
    <div class="grid-form">
      <label>Material${sel('pf-mat', Object.fromEntries(Object.keys(MATERIAIS).map(k => [k, k])), v.material)}</label>
      <label>Densidade (g/cm³)${n('pf-den', v.densidade, 'pelo material')}</label>
      <label>Largura (mm)${n('pf-lar', v.largura_mm)}</label>
      <label>Espessura (µm)${n('pf-esp', v.espessura_um)}</label>
      <label>Comprimento (m)${n('pf-com', v.comprimento_m)}</label>
      <label>Faces<select id="pf-cam"><option value="">—</option><option value="1" ${+v.camadas === 1 ? 'selected' : ''}>1 (folha)</option><option value="2" ${+v.camadas === 2 ? 'selected' : ''}>2 (tubular / saco)</option></select></label>
      <label>Formato${sel('pf-fmt', FORMATOS, v.formato)}</label>
      <label>Cor<input id="pf-cor" value="${esc(v.cor || '')}"></label>
      <label>Cores de impressão${n('pf-ci', v.cores_impressao)}</label>
      <label>Solda<input id="pf-sol" value="${esc(v.solda || '')}" placeholder="fundo, lateral…"></label>
      <label class="chk"><input type="checkbox" id="pf-cor2" ${v.corona ? 'checked' : ''}> Tratamento corona</label>
      <label class="chk"><input type="checkbox" id="pf-san" ${v.sanfona ? 'checked' : ''}> Sanfona</label>
    </div>
    <p class="small" id="pf-peso" style="margin:6px 0 0"></p>
    <h3 style="margin:14px 0 6px">Estoque e compra</h3>
    <div class="grid-form">
      <label>Estoque mínimo${n('pf-min', v.estoque_minimo)}</label><label>Estoque máximo${n('pf-max', v.estoque_maximo)}</label>
      <label>Ponto de pedido${n('pf-pp', v.ponto_pedido)}</label><label>Lote econômico${n('pf-le', v.lote_economico)}</label>
      <label>Localização<input id="pf-loc" value="${esc(v.localizacao || '')}"></label>
      <label>Unidade de compra<input id="pf-uc" value="${esc(v.unidade_compra || '')}" placeholder="ex.: SC"></label>
      <label>Fator (1 un. de compra = ? un.)${n('pf-fc', v.fator_compra, 'ex.: 25')}</label>
      <label class="chk"><input type="checkbox" id="pf-at" ${v.ativo !== false ? 'checked' : ''}> Ativo</label>
      <label class="span2">Observação<input id="pf-obs" value="${esc(v.observacao || '')}"></label>
    </div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-ok">Salvar</button>` });
  const V = (id) => $('#' + id, m.el).value.trim(), N = (id) => (V(id) ? num(V(id)) : null);
  const peso = () => { const pt = pesoTeorico({ material: V('pf-mat'), densidade: N('pf-den'), largura_mm: N('pf-lar'), espessura_um: N('pf-esp'), comprimento_m: N('pf-com'), camadas: N('pf-cam') });
    $('#pf-peso', m.el).innerHTML = pt ? `Peso teórico: <b>${qtd(Math.round(pt.gm2 * 10) / 10)} g/m²</b>${pt.gm ? ` · <b>${qtd(Math.round(pt.gm * 100) / 100)} g/m</b>` : ''}${pt.peca ? ` · <b>${qtd(Math.round(pt.peca * 100) / 100)} g por peça</b> (${qtd(Math.round(pt.milheiroKg * 100) / 100)} kg por milheiro)` : ''} <span class="muted">(densidade ${String(pt.d).replace('.', ',')})</span>` : '<span class="muted">Informe material (ou densidade) e espessura para o peso teórico.</span>'; };
  m.el.addEventListener('input', peso); m.el.addEventListener('change', peso); peso();
  $('#pf-ok', m.el).onclick = async (ev) => {
    const row = { codigo: V('pf-cod'), descricao: V('pf-des'), tipo: V('pf-tipo'), unidade: V('pf-un').toUpperCase() || 'UN', ncm: V('pf-ncm').replace(/\D/g, '') || null,
      grupo: V('pf-gr') || null, subgrupo: V('pf-sg') || null, material: V('pf-mat') || null, densidade: N('pf-den'), largura_mm: N('pf-lar'), espessura_um: N('pf-esp'),
      comprimento_m: N('pf-com'), camadas: N('pf-cam'), formato: V('pf-fmt') || null, cor: V('pf-cor') || null, cores_impressao: N('pf-ci'), solda: V('pf-sol') || null,
      corona: $('#pf-cor2', m.el).checked, sanfona: $('#pf-san', m.el).checked, estoque_minimo: N('pf-min'), estoque_maximo: N('pf-max'), ponto_pedido: N('pf-pp'),
      lote_economico: N('pf-le'), localizacao: V('pf-loc') || null, unidade_compra: V('pf-uc') || null, fator_compra: N('pf-fc'), ativo: $('#pf-at', m.el).checked, observacao: V('pf-obs') || null };
    if (!row.codigo || !row.descricao) return toast('Código e descrição são obrigatórios', true);
    ev.target.disabled = true;
    try {
      let id = p?.id;
      if (p) await q(sb.from('produtos').update(row).eq('id', id));
      else id = (await q(sb.from('produtos').insert({ ...row, empresa_id: state.empresa.id }).select('id').single())).id;
      m.close(); toast('Produto salvo'); limparCacheProdutos(); await carregar(root); abrir(L.find(x => x.id === id), root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ------------------------------------------------------------ ficha
async function abrir(p, root) {
  if (!p) return;
  let forn = [], estr = [], esp = [], comprasNf = [];
  try {
    [forn, estr, esp] = await Promise.all([
      q(sb.from('produto_fornecedores').select('*').eq('produto_id', p.id).order('ultima_compra', { ascending: false, nullsFirst: false })),
      q(sb.from('produto_estrutura').select('*').eq('produto_id', p.id)),
      q(sb.from('estoque_espelho_itens').select('quantidade,deposito,custo_unitario,valor,espelho_id').eq('produto_id', p.id))]);
    if (!compras()) comprasNf = (await q(sb.rpc('produto_compras', { p_empresa: state.empresa.id, p_de: addDias(today(), -365), p_ate: today() }))).filter(c => c.produto_id === p.id);
  } catch (err) { return fail(err); }
  const espelhos = esp.length ? await q(sb.from('estoque_espelhos').select('id,data_ref').in('id', [...new Set(esp.map(e => e.espelho_id))])).catch(() => []) : [];
  const ultEsp = espelhos.sort((a, b) => b.data_ref.localeCompare(a.data_ref))[0];
  const saldo = ultEsp ? esp.filter(e => e.espelho_id === ultEsp.id) : [];
  const custoRep = forn.find(f => f.ultimo_preco != null)?.ultimo_preco ?? (comprasNf.length ? comprasNf.sort((a, b) => b.emissao.localeCompare(a.emissao))[0].custo_unitario : null);
  const cmp = (id) => L.find(x => x.id === id);
  // custo dos componentes: último preço do de-para de cada componente
  const comps = estr.length ? await q(sb.from('produto_fornecedores').select('produto_id,ultimo_preco,ultima_compra').in('produto_id', estr.map(e => e.componente_id))).catch(() => []) : [];
  const precoComp = (id) => comps.filter(c => c.produto_id === id && c.ultimo_preco != null).sort((a, b) => String(b.ultima_compra).localeCompare(String(a.ultima_compra)))[0]?.ultimo_preco ?? null;
  const linhasEstr = estr.map(e => { const c = cmp(e.componente_id), qtdUn = e.quantidade / e.base / (1 - e.perda_pct / 100), pr = precoComp(e.componente_id);
    return { e, c, qtdUn, pr, custo: pr != null ? qtdUn * pr : null }; });
  const custoTeo = linhasEstr.length && linhasEstr.every(l => l.custo != null) ? linhasEstr.reduce((t, l) => t + l.custo, 0) : null;
  const pt = pesoTeorico(p);
  const ed = podeEditarCad();
  const m = modal({ title: `${p.codigo} — ${p.descricao}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Tipo</span><div>${esc(TIPOS[p.tipo] || p.tipo)}</div></div><div><span class="muted">Unidade</span><div>${esc(p.unidade)}</div></div>
      <div><span class="muted">NCM</span><div>${esc(p.ncm || '–')}</div></div><div><span class="muted">Grupo</span><div>${esc([p.grupo, p.subgrupo].filter(Boolean).join(' / ') || '–')}</div></div>
      ${p.material || p.largura_mm || p.espessura_um ? `<div class="span2"><span class="muted">Plástico</span><div>${esc([p.material, p.largura_mm && qtd(p.largura_mm) + ' mm', p.espessura_um && qtd(p.espessura_um) + ' µm', p.comprimento_m && qtd(p.comprimento_m) + ' m', p.formato && FORMATOS[p.formato], p.cor, p.cores_impressao && p.cores_impressao + ' cor(es)', p.corona && 'corona', p.sanfona && 'sanfona'].filter(Boolean).join(' · '))}</div></div>` : ''}
      ${pt ? `<div class="span2"><span class="muted">Peso teórico</span><div>${qtd(Math.round(pt.gm2 * 10) / 10)} g/m²${pt.gm ? ` · ${qtd(Math.round(pt.gm * 100) / 100)} g/m` : ''}${pt.peca ? ` · ${qtd(Math.round(pt.milheiroKg * 100) / 100)} kg/milheiro` : ''}</div></div>` : ''}
      <div><span class="muted">Mínimo / ponto de pedido</span><div>${p.estoque_minimo != null ? qtd(p.estoque_minimo) : '–'} / ${p.ponto_pedido != null ? qtd(p.ponto_pedido) : '–'}</div></div>
      <div><span class="muted">Custo de reposição</span><div>${custoRep != null ? unit(custoRep) + ' / ' + esc(p.unidade) : '–'}</div></div>
      ${custoTeo != null ? `<div><span class="muted">Custo teórico (estrutura)</span><div>${unit(custoTeo)} / ${esc(p.unidade)}</div></div>` : ''}
    </div>
    <h3 style="margin:14px 0 6px">Estoque no Iniflex ${ultEsp ? `<span class="muted small">posição de ${dateBR(ultEsp.data_ref)}</span>` : ''}</h3>
    ${saldo.length ? `<div class="table-wrap"><table><thead><tr><th>Depósito</th><th class="num">Quantidade</th><th class="num">Custo Iniflex</th><th class="num">Valor</th></tr></thead><tbody>
      ${saldo.map(s => `<tr><td>${esc(s.deposito)}</td><td class="num">${qtd(s.quantidade)}</td><td class="num">${s.custo_unitario != null ? unit(s.custo_unitario) : '–'}</td><td class="num">${s.valor != null ? money(s.valor) : '–'}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="small muted">Sem posição importada para este código.</p>'}
    <h3 style="margin:14px 0 6px">Fornecedores (código na nota do fornecedor)</h3>
    <div class="table-wrap"><table><thead><tr><th>CNPJ</th><th>Código</th><th>Descrição no fornecedor</th><th class="num">Fator</th><th class="num">Último custo</th><th>Última compra</th>${ed ? '<th></th>' : ''}</tr></thead><tbody>
      ${forn.map(f => `<tr><td>${esc(f.emit_doc)}</td><td>${esc(f.codigo_fornecedor)}</td><td class="wrap">${esc(f.descricao_fornecedor || '')} <span class="muted small">${esc(f.unidade_fornecedor || '')}</span></td>
        <td class="num">${qtd(f.fator)}</td><td class="num">${f.ultimo_preco != null ? unit(f.ultimo_preco) : '–'}</td><td>${dateBR(f.ultima_compra)}</td>${ed ? `<td><button class="btn ghost icon" data-fx="${f.id}" title="Desvincular">✕</button></td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${ed ? 7 : 6}" class="empty">Sem vínculo com itens de fornecedor. Use Estoque › De-para de fornecedores.</td></tr>`}</tbody></table></div>
    <h3 style="margin:14px 0 6px">Estrutura (o que consome)</h3>
    <div class="table-wrap"><table><thead><tr><th>Componente</th><th class="num">Quantidade</th><th class="num">Perda</th><th class="num">Por ${esc(p.unidade)}</th><th class="num">Custo</th>${ed ? '<th></th>' : ''}</tr></thead><tbody>
      ${linhasEstr.map(l => `<tr><td>${esc(l.c ? `${l.c.codigo} — ${l.c.descricao}` : '?')}</td><td class="num">${qtd(l.e.quantidade)} ${esc(l.c?.unidade || '')} por ${qtd(l.e.base)} ${esc(p.unidade)}</td><td class="num">${qtd(l.e.perda_pct)}%</td>
        <td class="num">${qtd(Math.round(l.qtdUn * 10000) / 10000)}</td><td class="num">${l.custo != null ? unit(l.custo) : '<span class="muted">sem custo</span>'}</td>${ed ? `<td><button class="btn ghost icon" data-ex="${l.e.id}">✕</button></td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${ed ? 6 : 5}" class="empty">Sem estrutura.</td></tr>`}</tbody></table></div>
    ${ed ? `<div class="grid-form" style="margin-top:8px" id="es-add"><label class="span2">Componente<input id="es-c" list="es-dl" placeholder="código ou descrição">${datalistProdutos('es-dl', L.filter(x => x.id !== p.id))}</label>
      <label>Quantidade<input id="es-q"></label><label>Por (base em ${esc(p.unidade)})<input id="es-b" value="1"></label><label>Perda %<input id="es-p" value="0"></label>
      <div style="align-self:end"><button class="btn small" id="es-ok">+ Componente</button></div></div>` : ''}
    ${comprasNf.length ? `<h3 style="margin:14px 0 6px">Compras nos últimos 12 meses (NF-e de entrada)</h3><div class="table-wrap" style="max-height:260px"><table><thead><tr><th>Emissão</th><th>NF</th><th>Fornecedor</th><th class="num">Quantidade</th><th class="num">Custo líquido</th><th class="num">Unitário</th></tr></thead><tbody>
      ${comprasNf.sort((a, b) => b.emissao.localeCompare(a.emissao)).map(c => `<tr><td>${dateBR(c.emissao)}</td><td>${c.numero}</td><td>${esc(c.emit_nome || '')}</td><td class="num">${qtd(c.quantidade)}</td><td class="num">${money(c.custo_total)}</td><td class="num">${c.custo_unitario != null ? unit(c.custo_unitario) : '–'}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Custo líquido = produtos + frete + outras − desconto + ST, sem os impostos marcados como recuperáveis em Posição de estoque › Parâmetros de custo.</p>` : ''}`,
    foot: `${ed ? '<button class="btn" id="pf-ed">Editar</button>' : ''}<button class="btn" data-close>Fechar</button>` });
  const reabrir = async () => { m.close(); await carregar(root); abrir(L.find(x => x.id === p.id), root); };
  $('#pf-ed', m.el) && ($('#pf-ed', m.el).onclick = () => { m.close(); editar(p, root); });
  $$('[data-fx]', m.el).forEach(b => b.onclick = async () => { if (!await confirmDialog('Desvincular este código de fornecedor do produto?')) return; try { await q(sb.from('produto_fornecedores').delete().eq('id', b.dataset.fx)); toast('Desvinculado'); reabrir(); } catch (err) { fail(err); } });
  $$('[data-ex]', m.el).forEach(b => b.onclick = async () => { try { await q(sb.from('produto_estrutura').delete().eq('id', b.dataset.ex)); reabrir(); } catch (err) { fail(err); } });
  $('#es-ok', m.el) && ($('#es-ok', m.el).onclick = async () => {
    const c = acharProduto($('#es-c', m.el).value, L); if (!c) return toast('Escolha o componente na lista', true);
    const qv = num($('#es-q', m.el).value); if (!(qv > 0)) return toast('Informe a quantidade', true);
    try { await q(sb.from('produto_estrutura').insert({ empresa_id: state.empresa.id, produto_id: p.id, componente_id: c.id, quantidade: qv, base: num($('#es-b', m.el).value) || 1, perda_pct: num($('#es-p', m.el).value) }));
      toast('Componente incluído'); reabrir(); } catch (err) { fail(err); }
  });
}

// ------------------------------------------------------------ importar das notas de saída
async function importarSaidas(root) {
  let pend = [];
  try { pend = await q(sb.rpc('produto_saida_pendente', { p_empresa: state.empresa.id, p_de: '2025-01-01' })); } catch (err) { return fail(err); }
  pend.sort((a, b) => b.valor - a.valor);
  const m = modal({ title: 'Importar produtos das notas de saída', wide: true, body: `
    <p class="small" style="margin-top:0">${pend.length} código(s) vendidos nas NF-e de saída ainda não estão no cadastro. Entram como <b>Produto acabado</b>, com a descrição, unidade e NCM da nota mais recente. Desmarque o que não for produto (ex.: sucata, serviço).</p>
    <div class="toolbar"><label class="chk"><input type="checkbox" id="is-all" checked> Marcar todos</label><input id="is-b" placeholder="Filtrar" style="min-width:220px"></div>
    <div class="table-wrap" style="max-height:55vh"><table><thead><tr><th></th><th>Código</th><th>Descrição</th><th>Unid.</th><th>NCM</th><th class="num">Notas</th><th class="num">Vendido</th><th>Última venda</th></tr></thead><tbody>
      ${pend.map((x, i) => `<tr data-i="${i}"><td><input type="checkbox" class="is-c" checked></td><td>${esc(x.codigo)}</td><td class="wrap">${esc(x.descricao)}</td><td>${esc(x.unidade || '')}</td><td>${esc(x.ncm || '')}</td><td class="num">${x.notas}</td><td class="num">${money(x.valor)}</td><td>${dateBR(x.ultima)}</td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">Todos os códigos vendidos já estão cadastrados.</td></tr>'}</tbody></table></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="is-ok" ${pend.length ? '' : 'disabled'}>Cadastrar marcados</button>` });
  $('#is-all', m.el).onchange = (e) => $$('tr[data-i]:not([hidden]) .is-c', m.el).forEach(c => c.checked = e.target.checked);
  $('#is-b', m.el).oninput = (e) => { const t = e.target.value.toLowerCase(); $$('tr[data-i]', m.el).forEach(tr => tr.hidden = !!t && !tr.textContent.toLowerCase().includes(t)); };
  $('#is-ok', m.el).onclick = async (ev) => {
    const sel = $$('tr[data-i]', m.el).filter(tr => $('.is-c', tr).checked).map(tr => pend[+tr.dataset.i]);
    if (!sel.length) return toast('Nada marcado', true);
    if (!await confirmDialog(`Cadastrar ${sel.length} produto(s) acabado(s)?`)) return;
    ev.target.disabled = true;
    try {
      for (let i = 0; i < sel.length; i += 300) await q(sb.from('produtos').insert(sel.slice(i, i + 300).map(x => ({ empresa_id: state.empresa.id, codigo: x.codigo, descricao: x.descricao,
        tipo: 'produto_acabado', unidade: (x.unidade || 'UN').toUpperCase(), ncm: x.ncm || null, origem: 'nfe_saida' }))));
      m.close(); toast(`${sel.length} produto(s) cadastrado(s)`); limparCacheProdutos(); await carregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

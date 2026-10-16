// Estoque › Posição: espelho do estoque do Iniflex (importado por arquivo), valorizado, curva ABC, abaixo do ponto de pedido,
// consumo aparente entre dois espelhos (saldo anterior + compras pelas NF-e − saldo atual) e requisição automática.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, money0, dateBR, today, fail, toast, modal, confirmDialog, exportXLSX, pct } from '../lib/ui.js';
import { kpiGrid, drawer, tabela } from '../lib/componentes.js';
import { TIPOS, carregarProdutos } from '../lib/produtos.js';
import { qtd, unit, num } from '../lib/compras.js';

export const title = 'Posição de estoque';
const ui = { esp: null, filtro: 'todos', busca: '', tipo: '' };
const compras = () => state.papel === 'compras';
const podeImportar = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Posição de estoque</h2><div class="muted small">Espelho do Iniflex: o saldo é o do relatório importado na data indicada.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${podeImportar() ? '<button class="btn ghost" id="es-par">Parâmetros de custo</button><button class="btn" id="es-hist">Espelhos</button><button class="btn primary" id="es-imp">Importar espelho do Iniflex</button>' : ''}</div></div>
    <div id="es-corpo"><div class="loading">Carregando…</div></div>`;
  $('#es-imp', root) && ($('#es-imp', root).onclick = () => importar(root));
  $('#es-hist', root) && ($('#es-hist', root).onclick = () => historico(root));
  $('#es-par', root) && ($('#es-par', root).onclick = () => parametros());
  await carregar(root);
}

let D = null;
async function carregar(root) {
  const corpo = $('#es-corpo', root);
  try {
    const e = state.empresa.id;
    const [esps, prods, pf] = await Promise.all([q(sb.from('estoque_espelhos').select('*').eq('empresa_id', e).order('data_ref', { ascending: false }).order('criado_em', { ascending: false })),
      carregarProdutos(true), fetchAll(() => sb.from('produto_fornecedores').select('produto_id,ultimo_preco,ultima_compra').eq('empresa_id', e).order('id'))]);
    if (!esps.length) { corpo.innerHTML = `<div class="card"><div class="empty">Nenhum espelho importado ainda.${podeImportar() ? ' Exporte do Iniflex o relatório de saldo de estoque (Excel ou CSV) e use "Importar espelho do Iniflex".' : ''}</div></div>`; return; }
    const cur = esps.find(x => x.id === ui.esp) || esps[0]; ui.esp = cur.id;
    const ant = esps.filter(x => x.data_ref < cur.data_ref)[0] || null;
    const [itens, itensAnt, comprasNf] = await Promise.all([
      fetchAll(() => sb.from('estoque_espelho_itens').select('*').eq('espelho_id', cur.id).order('id')),
      ant ? fetchAll(() => sb.from('estoque_espelho_itens').select('codigo,quantidade').eq('espelho_id', ant.id).order('id')) : [],
      ant && !compras() ? q(sb.rpc('produto_compras', { p_empresa: e, p_de: addDias(ant.data_ref, 1), p_ate: cur.data_ref })).catch(() => []) : []]);
    const prodById = Object.fromEntries(prods.map(p => [p.id, p])), prodByCod = Object.fromEntries(prods.map(p => [p.codigo, p]));
    const rep = {}; for (const f of pf) if (f.ultimo_preco != null && (!rep[f.produto_id] || String(f.ultima_compra) > String(rep[f.produto_id].d))) rep[f.produto_id] = { v: +f.ultimo_preco, d: f.ultima_compra };
    const g = {};
    for (const i of itens) { const k = i.codigo; const x = (g[k] ||= { codigo: k, descricao: i.descricao, unidade: i.unidade, produto: prodById[i.produto_id] || prodByCod[k] || null, qtd: 0, valorIni: 0, temValor: false, deps: [] });
      x.qtd += +i.quantidade; if (i.valor != null) { x.valorIni += +i.valor; x.temValor = true; } x.deps.push(i); }
    const antQ = {}; for (const i of itensAnt) antQ[i.codigo] = (antQ[i.codigo] || 0) + +i.quantidade;
    const compQ = {}; for (const c of comprasNf) { const p = prodById[c.produto_id]; if (p) compQ[p.codigo] = (compQ[p.codigo] || 0) + +c.quantidade; }
    const linhas = Object.values(g).map(x => { const cr = x.produto ? rep[x.produto.id]?.v ?? null : null;
      const valor = x.temValor ? x.valorIni : (cr != null ? x.qtd * cr : null);
      const consumo = ant ? (antQ[x.codigo] || 0) + (compQ[x.codigo] || 0) - x.qtd : null;
      return { ...x, custoRep: cr, valor, valorRep: cr != null ? x.qtd * cr : null, consumo, ponto: x.produto?.ponto_pedido, minimo: x.produto?.estoque_minimo }; });
    // produtos com ponto de pedido que nem aparecem no espelho: saldo zero
    for (const p of prods) if (p.ativo && p.ponto_pedido != null && !g[p.codigo]) linhas.push({ codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, produto: p, qtd: 0, valor: 0, custoRep: rep[p.id]?.v ?? null, valorRep: 0, consumo: ant ? (antQ[p.codigo] || 0) + (compQ[p.codigo] || 0) : null, ponto: p.ponto_pedido, minimo: p.estoque_minimo, deps: [], fora: true });
    // curva ABC por valor
    const tot = linhas.reduce((t, l) => t + (l.valor || 0), 0); let ac = 0;
    [...linhas].sort((a, b) => (b.valor || 0) - (a.valor || 0)).forEach(l => { ac += l.valor || 0; l.abc = !tot || !l.valor ? 'C' : ac / tot <= 0.8 ? 'A' : ac / tot <= 0.95 ? 'B' : 'C'; });
    D = { esps, cur, ant, linhas, tot, prods };
    pintar(root);
  } catch (err) { fail(err); corpo.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}

function pintar(root) {
  const { esps, cur, ant, linhas, tot } = D, b = ui.busca.trim().toLowerCase();
  const abaixo = linhas.filter(l => l.ponto != null && l.qtd <= l.ponto), semCad = linhas.filter(l => !l.produto), neg = linhas.filter(l => l.qtd < 0);
  const filtros = { todos: () => true, abaixo: l => abaixo.includes(l), sem: l => !l.produto, neg: l => l.qtd < 0, A: l => l.abc === 'A' };
  const vis = linhas.filter(filtros[ui.filtro]).filter(l => (!ui.tipo || l.produto?.tipo === ui.tipo) && (!b || [l.codigo, l.descricao, l.produto?.descricao].some(v => String(v || '').toLowerCase().includes(b))))
    .sort((a, c) => (c.valor || 0) - (a.valor || 0));
  const corpo = $('#es-corpo', root);
  corpo.innerHTML = `<div class="card toolbar"><label>Espelho<select id="es-sel">${esps.map(x => `<option value="${x.id}" ${x.id === cur.id ? 'selected' : ''}>${dateBR(x.data_ref)} · ${x.linhas} linha(s)${x.arquivo ? ' · ' + esc(x.arquivo) : ''}</option>`).join('')}</select></label>
      <span class="small muted">${ant ? `Consumo aparente comparado com ${dateBR(ant.data_ref)}${compras() ? '' : ' (+ compras das NF-e no período)'}` : 'Importe um segundo espelho para ver o consumo aparente.'}</span></div>
    <div id="es-kpis" style="margin-top:12px"></div>
    <div class="card toolbar" style="margin-top:12px"><div class="chips" id="es-f">${[['todos', 'Todos'], ['abaixo', `Abaixo do ponto de pedido (${abaixo.length})`], ['A', 'Curva A'], ['sem', `Sem cadastro (${semCad.length})`], ['neg', `Saldo negativo (${neg.length})`]]
      .map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <label>Tipo<select id="es-tipo"><option value="">Todos</option>${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${ui.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <input id="es-b" placeholder="Procurar código ou descrição" value="${esc(ui.busca)}" style="min-width:220px">
      <button class="btn ghost small" id="es-xls">Excel</button>${abaixo.length ? '<button class="btn small" id="es-req">Gerar requisição dos itens abaixo do ponto</button>' : ''}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:62vh"><table id="es-tab"><thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th class="num">Saldo</th><th>Unid.</th><th class="num">Ponto de pedido</th>
      <th class="num">Valor</th><th class="num">Custo de reposição</th><th class="num">${ant ? 'Consumo aparente' : ''}</th><th>ABC</th></tr></thead><tbody>
      ${vis.slice(0, 1500).map(l => `<tr class="clickable" data-c="${esc(l.codigo)}"><td>${esc(l.codigo)}</td><td class="wrap">${esc(l.produto?.descricao || l.descricao || '')}${l.produto ? '' : ' <span class="badge aberto">sem cadastro</span>'}${l.fora ? ' <span class="muted small">(fora do espelho)</span>' : ''}</td>
        <td>${esc(TIPOS[l.produto?.tipo] || '')}</td><td class="num ${l.qtd < 0 ? 'neg' : l.ponto != null && l.qtd <= l.ponto ? 'warn' : ''}">${qtd(Math.round(l.qtd * 1000) / 1000)}</td><td>${esc(l.produto?.unidade || l.unidade || '')}</td>
        <td class="num">${l.ponto != null ? qtd(l.ponto) : ''}</td><td class="num">${l.valor != null ? money(l.valor) : '–'}</td><td class="num">${l.custoRep != null ? unit(l.custoRep) : '–'}</td>
        <td class="num">${l.consumo != null ? qtd(Math.round(l.consumo * 1000) / 1000) : ''}</td><td>${l.abc}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Nada neste filtro.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">${vis.length} item(ns). Valor: o do Iniflex quando o relatório traz custo; senão quantidade × custo de reposição (último custo líquido de compra pelo de-para).</p>`;
  const lista = (arr) => tabela([{ titulo: 'Código' }, { titulo: 'Descrição' }, { titulo: 'Saldo', num: true }, { titulo: 'Ponto', num: true }, { titulo: 'Valor', num: true }],
    arr.map(l => ({ celulas: [l.codigo, l.produto?.descricao || l.descricao || '', qtd(l.qtd), l.ponto != null ? qtd(l.ponto) : '', l.valor != null ? money(l.valor) : '–'] })));
  const valRep = linhas.reduce((t, l) => t + (l.valorRep || 0), 0);
  const KP = {
    val: { label: `Estoque valorizado em ${dateBR(cur.data_ref)}`, valor: money0(tot), sub: `${linhas.filter(l => !l.fora).length} código(s)`, abrir: () => drawer({ titulo: 'Valor por tipo', corpo: tabela([{ titulo: 'Tipo' }, { titulo: 'Valor', num: true }, { titulo: '%', num: true }],
      Object.entries(linhas.reduce((o, l) => { const k = TIPOS[l.produto?.tipo] || 'Sem cadastro'; o[k] = (o[k] || 0) + (l.valor || 0); return o; }, {})).sort((a, c) => c[1] - a[1]).map(([k, v]) => ({ celulas: [k, money(v), pct(tot ? v / tot : 0)] }))) }) },
    rep: { label: 'A custo de reposição', valor: money0(valRep), sub: 'itens com de-para e compra', abrir: () => drawer({ titulo: 'Custo de reposição', corpo: '<p class="small">Quantidade do espelho × último custo líquido de compra (NF-e de entrada pelo de-para, sem os impostos recuperáveis). Itens sem de-para ficam de fora.</p>' }) },
    ab: { label: 'Abaixo do ponto de pedido', valor: String(abaixo.length), tom: abaixo.length ? 'warn' : '', sub: 'clique para ver', abrir: () => drawer({ titulo: 'Abaixo do ponto de pedido', corpo: lista(abaixo) }) },
    sem: { label: 'Códigos sem cadastro', valor: String(semCad.length), tom: semCad.length ? 'warn' : '', sub: 'cadastre em Produtos', abrir: () => drawer({ titulo: 'Códigos do espelho sem cadastro', corpo: lista(semCad) }) },
    neg: { label: 'Saldo negativo no Iniflex', valor: String(neg.length), tom: neg.length ? 'neg' : '', sub: 'erro de apontamento', abrir: () => drawer({ titulo: 'Saldo negativo', corpo: lista(neg) }) },
  };
  kpiGrid($('#es-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k, clicavel: true })), (id) => KP[id].abrir());
  $('#es-sel', corpo).onchange = (e) => { ui.esp = e.target.value; carregar(root); };
  $('#es-f', corpo).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; pintar(root); } };
  $('#es-tipo', corpo).onchange = (e) => { ui.tipo = e.target.value; pintar(root); };
  $('#es-b', corpo).oninput = (e) => { ui.busca = e.target.value; clearTimeout(pintar._t); pintar._t = setTimeout(() => { pintar(root); const i = $('#es-b', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#es-xls', corpo).onclick = () => exportXLSX($('#es-tab', corpo), `estoque_${cur.data_ref}`);
  $('#es-req', corpo) && ($('#es-req', corpo).onclick = () => gerarRequisicao(abaixo, root));
  $$('#es-tab tr[data-c]', corpo).forEach(tr => tr.onclick = () => { const l = linhas.find(x => x.codigo === tr.dataset.c);
    if (l?.produto) { state.abrir = { tipo: 'produto', id: l.produto.id }; location.hash = '#/estoque/produtos'; }
    else drawer({ titulo: `${l.codigo} — sem cadastro`, corpo: tabela([{ titulo: 'Depósito' }, { titulo: 'Quantidade', num: true }, { titulo: 'Valor', num: true }], l.deps.map(d => ({ celulas: [d.deposito, qtd(d.quantidade), d.valor != null ? money(d.valor) : '–'] }))) }); });
}

async function gerarRequisicao(abaixo, root) {
  const itens = abaixo.filter(l => l.produto).map(l => { const p = l.produto, saldo = Math.max(l.qtd, 0);
    const qn = +p.lote_economico || (p.estoque_maximo != null ? +p.estoque_maximo - saldo : 0) || (+p.ponto_pedido - saldo);
    return { p, quantidade: Math.max(Math.round(qn * 1000) / 1000, 0) }; }).filter(x => x.quantidade > 0);
  if (!itens.length) return toast('Nenhum item com quantidade a comprar (defina lote econômico ou estoque máximo)', true);
  if (!await confirmDialog(`Criar uma requisição de compra com ${itens.length} item(ns) abaixo do ponto de pedido? Quantidade: lote econômico, ou até o estoque máximo, ou até o ponto de pedido.`)) return;
  try {
    const e = state.empresa.id;
    const r = await q(sb.from('compras_requisicoes').insert({ empresa_id: e, solicitante: 'Estoque (ponto de pedido)', observacao: `Gerada pela posição do Iniflex de ${dateBR(D.cur.data_ref)}` }).select('id,numero').single());
    await q(sb.from('compras_requisicao_itens').insert(itens.map(x => ({ empresa_id: e, requisicao_id: r.id, produto_id: x.p.id, descricao: `${x.p.codigo} — ${x.p.descricao}`.slice(0, 200),
      unidade: x.p.unidade, quantidade: x.quantidade, ncm: x.p.ncm || null }))));
    toast(`Requisição nº ${r.numero} criada`); state.abrir = { tipo: 'requisicao', id: r.id }; location.hash = '#/compras/requisicoes';
  } catch (err) { fail(err); }
}

// ------------------------------------------------------------ importar espelho
const SIN = { codigo: /^(c[óo]d|codigo|código|item|produto c)/i, descricao: /(descri|nome|produto$)/i, deposito: /(dep[óo]s|almox|local)/i, unidade: /^(un|und|unid)/i,
  quantidade: /(qtd|quant|saldo|estoque)/i, custo_unitario: /(custo|m[ée]dio|unit|pre[çc]o)/i, valor: /(valor|total)/i };
const CAMPOS = [['codigo', 'Código *'], ['descricao', 'Descrição'], ['deposito', 'Depósito'], ['unidade', 'Unidade'], ['quantidade', 'Quantidade *'], ['custo_unitario', 'Custo unitário'], ['valor', 'Valor total']];
function importar(root) {
  const m = modal({ title: 'Importar espelho do estoque do Iniflex', wide: true, body: `
    <p class="small" style="margin-top:0">Exporte do Iniflex o relatório de saldo de estoque em Excel ou CSV (uma linha por produto e depósito). O arquivo é lido aqui no navegador; nada é gravado até você confirmar.</p>
    <div class="grid-form"><label class="span2">Arquivo<input type="file" id="ie-f" accept=".xlsx,.xls,.csv"></label><label>Posição em *<input type="date" id="ie-d" value="${today()}"></label></div>
    <div id="ie-map" style="margin-top:12px"></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ie-ok" disabled>Importar</button>` });
  let linhas = [], cab = [], nome = '';
  $('#ie-f', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; nome = f.name;
    if (!window.XLSX) return toast('Biblioteca de Excel ainda carregando', true);
    const buf = await f.arrayBuffer();
    let wb;
    if (/\.csv$/i.test(f.name)) {   // CSV: UTF-8 ou Windows-1252 (o Iniflex costuma gerar em 1252), separador ; ou ,
      let t; try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { t = new TextDecoder('windows-1252').decode(buf); }
      const l1 = t.split(/\r?\n/)[0] || '';
      wb = XLSX.read(t, { type: 'string', FS: (l1.match(/;/g) || []).length > (l1.match(/,/g) || []).length ? ';' : ',', raw: true });
    } else wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    // cabeçalho: primeira linha com pelo menos 3 células de texto e uma que pareça código e outra quantidade
    let h = aoa.findIndex(r => r.filter(c => typeof c === 'string' && c.trim()).length >= 3 && r.some(c => SIN.codigo.test(String(c))) && r.some(c => SIN.quantidade.test(String(c))));
    if (h < 0) h = 0;
    cab = aoa[h].map(c => String(c).trim()); linhas = aoa.slice(h + 1).filter(r => r.some(c => String(c).trim() !== ''));
    const usado = new Set(), auto = {};
    for (const [k] of CAMPOS) { const i = cab.findIndex((c, j) => !usado.has(j) && SIN[k].test(c)); if (i >= 0) { auto[k] = i; usado.add(i); } }
    $('#ie-map', m.el).innerHTML = `<h3 style="margin:0 0 6px">Colunas do arquivo (${linhas.length} linha(s) de dados)</h3><div class="grid-form">
      ${CAMPOS.map(([k, t]) => `<label>${t}<select class="ie-c" data-k="${k}"><option value="">—</option>${cab.map((c, i) => `<option value="${i}" ${auto[k] === i ? 'selected' : ''}>${esc(c || 'coluna ' + (i + 1))}</option>`).join('')}</select></label>`).join('')}</div>
      <div id="ie-prev" style="margin-top:10px"></div>`;
    const prev = () => { const mp = Object.fromEntries($$('.ie-c', m.el).map(s => [s.dataset.k, s.value === '' ? null : +s.value]));
      const ok = mp.codigo != null && mp.quantidade != null; $('#ie-ok', m.el).disabled = !ok;
      const rows = linhas.slice(0, 8).map(r => CAMPOS.map(([k]) => (mp[k] != null ? r[mp[k]] : '')));
      $('#ie-prev', m.el).innerHTML = ok ? `<div class="table-wrap"><table><thead><tr>${CAMPOS.map(([, t]) => `<th>${t.replace(' *', '')}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">Prévia das 8 primeiras linhas.</p>`
        : '<p class="small warn">Escolha ao menos as colunas de código e de quantidade.</p>';
      return mp; };
    m.el.querySelector('#ie-map').onchange = prev; prev();
    $('#ie-ok', m.el).onclick = async (ev) => {
      const mp = prev(), d = $('#ie-d', m.el).value; if (!d) return toast('Informe a data da posição', true);
      const nr = (v) => (typeof v === 'number' ? v : num(v));
      const itens = linhas.map(r => ({ codigo: String(r[mp.codigo] ?? '').trim(), descricao: mp.descricao != null ? String(r[mp.descricao] ?? '').trim() : null,
        deposito: mp.deposito != null ? String(r[mp.deposito] ?? '').trim() : null, unidade: mp.unidade != null ? String(r[mp.unidade] ?? '').trim() : null,
        quantidade: String(r[mp.quantidade] ?? '').trim() === '' ? null : nr(r[mp.quantidade]),
        custo_unitario: mp.custo_unitario != null && String(r[mp.custo_unitario]).trim() !== '' ? nr(r[mp.custo_unitario]) : null,
        valor: mp.valor != null && String(r[mp.valor]).trim() !== '' ? nr(r[mp.valor]) : null })).filter(x => x.codigo && x.quantidade != null);
      if (!itens.length) return toast('Nenhuma linha com código e quantidade', true);
      if (D?.esps?.some(x => x.data_ref === d) && !await confirmDialog(`Já existe espelho de ${dateBR(d)}. Importar outro mesmo assim? (você pode excluir o antigo em Espelhos)`)) return;
      ev.target.disabled = true;
      try { await q(sb.rpc('estoque_importar_espelho', { p_empresa: state.empresa.id, p_data: d, p_arquivo: nome, p_itens: itens, p_observacao: null }));
        m.close(); toast(`Espelho de ${dateBR(d)} importado: ${itens.length} linha(s)`); ui.esp = null; carregar(root);
      } catch (err) { fail(err); ev.target.disabled = false; }
    };
  };
}

function historico(root) {
  const m = modal({ title: 'Espelhos importados', body: '', foot: '<button class="btn" data-close>Fechar</button>' });
  const b = $('.modal-body', m.el);
  b.append(tabela([{ titulo: 'Posição' }, { titulo: 'Arquivo' }, { titulo: 'Linhas', num: true }, { titulo: 'Valor', num: true }, { titulo: 'Importado em' }, { titulo: '' }],
    (D?.esps || []).map(x => ({ celulas: [dateBR(x.data_ref), x.arquivo || '', x.linhas, x.valor_total != null ? money(x.valor_total) : '–', dateBR(x.criado_em), { html: `<button class="btn ghost small" data-del="${x.id}">Excluir</button>` }] }))));
  $$('[data-del]', b).forEach(bt => bt.onclick = async (e) => { e.stopPropagation(); if (!await confirmDialog('Excluir este espelho? As linhas dele saem da plataforma (o Iniflex não muda).')) return;
    try { await q(sb.from('estoque_espelhos').delete().eq('id', bt.dataset.del)); toast('Espelho excluído'); m.close(); ui.esp = null; carregar(root); } catch (err) { fail(err); } });
}

async function parametros() {
  let v = {}; try { v = (await q(sb.from('estoque_parametros').select('*').eq('empresa_id', state.empresa.id)))[0] || {}; } catch (err) { return fail(err); }
  const ck = (id, val, t) => `<label class="chk"><input type="checkbox" id="${id}" ${val !== false ? 'checked' : ''}> ${t}</label>`;
  const m = modal({ title: 'Parâmetros de custo de compra', body: `<p class="small" style="margin-top:0">Custo líquido = produtos + frete + outras despesas − desconto + ST, tirando os impostos marcados como recuperáveis (crédito). Confirme com a contabilidade.</p>
    ${ck('pc-icms', v.icms_recupera, 'ICMS é recuperado (sai do custo)')}${ck('pc-pis', v.pis_cofins_recupera, 'PIS e COFINS são recuperados (saem do custo)')}${ck('pc-ipi', v.ipi_recupera, 'IPI é recuperado (sai do custo)')}`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pc-ok">Salvar</button>` });
  $('#pc-ok', m.el).onclick = async () => {
    try { await q(sb.from('estoque_parametros').upsert({ empresa_id: state.empresa.id, icms_recupera: $('#pc-icms', m.el).checked, pis_cofins_recupera: $('#pc-pis', m.el).checked,
      ipi_recupera: $('#pc-ipi', m.el).checked, atualizado_em: new Date().toISOString() })); m.close(); toast('Parâmetros salvos'); } catch (err) { fail(err); }
  };
}

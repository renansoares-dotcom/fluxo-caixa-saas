// Estoque › Kardex (SQL 075): saldo oficial por local e por produto, custo médio ponderado móvel, movimentos, movimento manual
// (entrada, saída, transferência, ajuste), estorno e recálculo. O banco grava custo e saldo e bloqueia saldo negativo e mês fechado.
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, toast, fail, modal, confirmDialog, exportXLSX, erroTela } from '../lib/ui.js';
import { carregarProdutos, datalistProdutos, acharProduto } from '../lib/produtos.js';
import { qtd, unit, num } from '../lib/compras.js';
import { FINALIDADES, SENTIDOS, TIPOS_SPED, PODE_MOVIMENTAR, resumoLocais, periodoAberto } from '../lib/estoque-kardex.js';

export const title = 'Kardex';
const ui = { aba: 'locais', local: '', busca: '', tipo: '' };
let D = null;
const podeMov = () => PODE_MOVIMENTAR.includes(state.papel);

async function carregar() {
  const e = state.empresa.id;
  const [locais, tipos, saldos, custos, movs, lotes, fech, prods] = await Promise.all([
    q(sb.from('est_locais').select('*').eq('empresa_id', e).order('ordem')),
    q(sb.from('est_tipos_movimento').select('*').eq('empresa_id', e).eq('ativo', true).order('sentido').order('nome')),
    fetchAll(() => sb.from('est_saldos').select('*').eq('empresa_id', e).order('id')),
    fetchAll(() => sb.from('est_custos').select('*').eq('empresa_id', e).order('produto_id')),
    q(sb.from('est_movimentos').select('*').eq('empresa_id', e).order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(500)),
    fetchAll(() => sb.from('est_lotes').select('*').eq('empresa_id', e).order('id')),
    q(sb.from('est_fechamentos').select('mes').eq('empresa_id', e)),
    carregarProdutos(true)]);
  D = { locais, tipos, saldos, custos, movs, lotes, fech, prods, loc: Object.fromEntries(locais.map(l => [l.id, l])), tm: Object.fromEntries(tipos.map(t => [t.id, t])),
    prod: Object.fromEntries(prods.map(p => [p.id, p])), lote: Object.fromEntries(lotes.map(l => [l.id, l])), custo: Object.fromEntries(custos.map(c => [c.produto_id, c])) };
  // tipos inativos também aparecem no histórico
  const falta = [...new Set(movs.map(m => m.tipo_movimento_id))].filter(id => !D.tm[id]);
  if (falta.length) for (const t of await q(sb.from('est_tipos_movimento').select('*').in('id', falta))) D.tm[t.id] = t;
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (err) {
    console.error(err);
    root.innerHTML = /est_|does not exist|schema cache/.test(err?.message || '') ? '<div class="card"><span class="badge vencido">SQL 075 pendente</span> O kardex ainda não foi criado no banco.</div>' : erroTela('o kardex');
    return;
  }
  pintar(root);
}
async function recarregar(root) { await carregar(); pintar(root); }

function pintar(root) {
  const R = resumoLocais(D.saldos, D.locais), per = periodoAberto(D.fech), mes = today().slice(0, 7);
  const comSaldo = new Set(D.saldos.filter(s => +s.quantidade).map(s => s.produto_id));
  const movMes = D.movs.filter(m => m.data.startsWith(mes));
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Kardex</h2><div class="muted small">Estoque oficial: saldo por local e lote, custo médio ponderado móvel por produto. Movimento não se altera nem se exclui — corrige-se por estorno.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="kx-xls">Excel</button>${podeMov() ? '<button class="btn" id="kx-trf">Transferir</button><button class="btn primary" id="kx-novo">Novo movimento</button>' : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Valor do estoque</div><div class="k-value">${money(R.total)}</div><div class="k-sub">ao custo médio, locais que compõem custo</div></div>
      <div class="kpi"><div class="k-label">Produtos com saldo</div><div class="k-value">${comSaldo.size}</div><div class="k-sub">de ${D.prods.filter(p => p.ativo).length} cadastrados</div></div>
      <div class="kpi"><div class="k-label">Movimentos no mês</div><div class="k-value">${movMes.length}</div><div class="k-sub">${movMes.filter(m => m.quantidade > 0).length} entradas · ${movMes.filter(m => m.quantidade < 0).length} saídas</div></div>
      <div class="kpi"><div class="k-label">Fechado até</div><div class="k-value">${per.fechadoAte ? per.fechadoAte.slice(5, 7) + '/' + per.fechadoAte.slice(0, 4) : '—'}</div><div class="k-sub">${per.abertoDesde ? 'lançamentos a partir de ' + dateBR(per.abertoDesde) : 'nenhum mês fechado'}</div></div>
    </div>
    <div class="toolbar"><div class="chips" id="kx-abas">${[['locais', 'Saldo por local'], ['produtos', 'Saldo por produto'], ['movs', 'Movimentos']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      ${ui.aba !== 'locais' ? `<label>Local<select id="kx-loc"><option value="">Todos</option>${D.locais.map(l => `<option value="${l.id}" ${ui.local === l.id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}</select></label>
      <input id="kx-bus" placeholder="Código ou descrição" value="${esc(ui.busca)}" style="min-width:240px">` : ''}</div>
    <div id="kx-corpo"></div>`;
  $('#kx-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(root); } };
  $('#kx-loc', root) && ($('#kx-loc', root).onchange = (e) => { ui.local = e.target.value; corpoAba(root, R); });
  let t; $('#kx-bus', root) && ($('#kx-bus', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.busca = e.target.value; corpoAba(root, R); }, 250); });
  $('#kx-xls', root).onclick = () => { const tb = $('#kx-corpo table', root); if (tb) exportXLSX(tb, 'kardex_' + ui.aba); };
  $('#kx-novo', root) && ($('#kx-novo', root).onclick = () => movimento(root));
  $('#kx-trf', root) && ($('#kx-trf', root).onclick = () => movimento(root, { transferencia: true }));
  corpoAba(root, R);
}

const casa = (p) => { const b = ui.busca.trim().toLowerCase(); return !b || `${p?.codigo || ''} ${p?.descricao || ''}`.toLowerCase().includes(b); };
function corpoAba(root, R) {
  const c = $('#kx-corpo', root);
  if (ui.aba === 'locais') {
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Local</th><th>Finalidade</th><th class="num">Itens com saldo</th><th class="num">Valor</th><th class="num">% do estoque</th></tr></thead><tbody>
      ${R.linhas.filter(x => x.local.ativo || x.itens).map(x => `<tr class="clickable" data-l="${x.local.id}"><td>${esc(x.local.nome)}${x.local.compoe_custo ? '' : ' <span class="badge" title="Não entra no valor do estoque">de terceiros</span>'}</td><td>${FINALIDADES[x.local.finalidade]}</td>
        <td class="num">${x.itens}</td><td class="num">${money(x.valor)}</td><td class="num">${x.local.compoe_custo && R.total ? (x.valor / R.total * 100).toFixed(1).replace('.', ',') + '%' : ''}</td></tr>`).join('')}
      <tr class="row-sec"><td colspan="3">Total (compõe custo)</td><td class="num">${money(R.total)}</td><td></td></tr></tbody></table></div></div>
      ${!D.movs.length ? '<p class="small muted">Nenhum movimento ainda. O saldo inicial entra pela importação do relatório do Iniflex (tipo "Saldo inicial") ou por "Novo movimento".</p>' : ''}`;
    $$('tr[data-l]', c).forEach(tr => tr.onclick = () => { ui.local = tr.dataset.l; ui.aba = 'produtos'; pintar(root); });
    return;
  }
  if (ui.aba === 'produtos') {
    const S = D.saldos.filter(s => +s.quantidade && (!ui.local || s.local_id === ui.local) && casa(D.prod[s.produto_id]));
    const g = new Map(); for (const s of S) { const x = g.get(s.produto_id) || { p: D.prod[s.produto_id], qt: 0, val: 0, locais: new Set(), lotes: 0 }; x.qt += +s.quantidade; x.val += +s.valor; x.locais.add(s.local_id); if (s.lote_id) x.lotes++; g.set(s.produto_id, x); }
    const L = [...g.values()].sort((a, b) => b.val - a.val);
    c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:62vh"><table><thead><tr><th>Código</th><th>Descrição</th><th>Tipo SPED</th><th>Unid.</th><th class="num">Quantidade</th><th class="num">Custo médio</th><th class="num">Valor</th><th>Locais</th><th>Última entrada</th></tr></thead><tbody>
      ${L.slice(0, 1500).map(x => { const cm = D.custo[x.p?.id]; return `<tr class="clickable" data-p="${x.p?.id}"><td>${esc(x.p?.codigo || '?')}</td><td class="wrap">${esc(x.p?.descricao || '')}</td><td>${x.p?.tipo_sped || ''}</td><td>${esc(x.p?.unidade || '')}</td>
        <td class="num">${qtd(x.qt)}</td><td class="num">${cm ? unit(cm.custo_medio) : '–'}</td><td class="num">${money(x.val)}</td><td class="small">${[...x.locais].map(id => esc(D.loc[id]?.codigo || '')).join(', ')}${x.lotes ? ` · ${x.lotes} lote(s)` : ''}</td><td>${dateBR(cm?.ultima_entrada)}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">Nenhum produto com saldo neste filtro.</td></tr>'}
      </tbody></table></div></div><p class="small muted">${L.length} produto(s) · ${money(L.reduce((t, x) => t + x.val, 0))}. Clique no produto para ver o kardex.</p>`;
    $$('tr[data-p]', c).forEach(tr => tr.onclick = () => kardexProduto(D.prod[tr.dataset.p], root));
    return;
  }
  const M = D.movs.filter(m => (!ui.local || m.local_id === ui.local) && casa(D.prod[m.produto_id]));
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:62vh">${tabelaMovs(M, true)}</div></div><p class="small muted">Últimos ${D.movs.length} movimentos da empresa${M.length !== D.movs.length ? ` · ${M.length} no filtro` : ''}.</p>`;
  $$('tr[data-p]', c).forEach(tr => tr.onclick = () => kardexProduto(D.prod[tr.dataset.p], root));
}

function tabelaMovs(M, comProduto) {
  return `<table><thead><tr><th>Data</th>${comProduto ? '<th>Produto</th>' : ''}<th>Movimento</th><th>Local</th><th>Lote</th><th class="num">Quantidade</th><th class="num">Custo unit.</th><th class="num">Valor</th><th class="num">Saldo no local</th><th class="num">Custo médio após</th><th>Documento</th></tr></thead><tbody>
    ${M.map(m => { const p = D.prod[m.produto_id], t = D.tm[m.tipo_movimento_id];
      return `<tr class="${comProduto ? 'clickable' : ''}" data-p="${m.produto_id}" data-m="${m.id}"><td>${dateBR(m.data)}</td>${comProduto ? `<td class="wrap">${esc(p?.codigo || '')} <span class="small muted">${esc(p?.descricao || '')}</span></td>` : ''}
        <td>${esc(t?.nome || '?')}${m.estorno_de ? ' <span class="badge">estorno</span>' : ''}${m.transferencia_id ? ' <span class="small muted">transf.</span>' : ''}</td><td class="small">${esc(D.loc[m.local_id]?.nome || '')}</td><td>${esc(D.lote[m.lote_id]?.codigo || '')}</td>
        <td class="num ${m.quantidade < 0 ? 'neg' : 'pos'}">${qtd(m.quantidade)}</td><td class="num">${m.custo_unitario != null ? unit(m.custo_unitario) : '–'}</td><td class="num">${money(m.valor)}</td>
        <td class="num">${m.saldo_local_apos != null ? qtd(m.saldo_local_apos) : ''}</td><td class="num">${m.custo_medio_apos != null ? unit(m.custo_medio_apos) : ''}</td><td class="small wrap">${esc([m.documento, m.observacao].filter(Boolean).join(' · '))}</td></tr>`; }).join('') || `<tr><td colspan="${comProduto ? 11 : 10}" class="empty">Nenhum movimento.</td></tr>`}
  </tbody></table>`;
}

async function kardexProduto(p, root) {
  if (!p) return;
  let M = [];
  try { M = await fetchAll(() => sb.from('est_movimentos').select('*').eq('produto_id', p.id).order('data', { ascending: false }).order('criado_em', { ascending: false })); } catch (err) { return fail(err); }
  const c = D.custo[p.id], S = D.saldos.filter(s => s.produto_id === p.id && +s.quantidade);
  const estornados = new Set(M.filter(m => m.estorno_de).map(m => m.estorno_de));
  const m = modal({ title: `Kardex — ${p.codigo} ${p.descricao}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Tipo do item (SPED)</span><div>${p.tipo_sped ? `${p.tipo_sped} – ${TIPOS_SPED[p.tipo_sped]}` : '–'}</div></div>
      <div><span class="muted">Saldo total</span><div>${c ? qtd(c.quantidade) + ' ' + esc(p.unidade) : '–'}</div></div>
      <div><span class="muted">Custo médio</span><div>${c ? unit(c.custo_medio) + ' / ' + esc(p.unidade) : '–'}</div></div>
      <div><span class="muted">Valor</span><div>${c ? money(c.valor) : '–'}</div></div>
    </div>
    ${S.length ? `<h3 style="margin:14px 0 6px">Saldo por local e lote</h3><div class="table-wrap"><table><thead><tr><th>Local</th><th>Lote</th><th class="num">Quantidade</th><th class="num">Valor</th><th>Último movimento</th></tr></thead><tbody>
      ${S.map(s => `<tr><td>${esc(D.loc[s.local_id]?.nome || '')}</td><td>${esc(D.lote[s.lote_id]?.codigo || '')}${D.lote[s.lote_id]?.lote_fornecedor ? ` <span class="small muted">forn. ${esc(D.lote[s.lote_id].lote_fornecedor)}</span>` : ''}</td><td class="num">${qtd(s.quantidade)}</td><td class="num">${money(s.valor)}</td><td>${dateBR(s.ultimo_movimento)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <h3 style="margin:14px 0 6px">Movimentos</h3><div class="table-wrap" style="max-height:45vh" id="kp-movs">${tabelaMovs(M, false)}</div>
    ${podeMov() ? '<p class="small muted">Clique num movimento para estorná-lo.</p>' : ''}`,
    foot: `${podeEditar() ? '<button class="btn" id="kp-rec" title="Refaz custo e saldos em ordem de data (após lançamentos com data retroativa)">Recalcular</button>' : ''}<span class="spacer"></span>${podeMov() ? '<button class="btn" id="kp-mov">Novo movimento deste produto</button>' : ''}<button class="btn" data-close>Fechar</button>` });
  if (podeMov()) $$('#kp-movs tr[data-m]', m.el).forEach(tr => { const mv = M.find(x => x.id === tr.dataset.m); if (!mv || mv.estorno_de || estornados.has(mv.id)) return; tr.classList.add('clickable'); tr.onclick = () => estornar(mv, p, root, m); });
  $('#kp-mov', m.el) && ($('#kp-mov', m.el).onclick = () => { m.close(); movimento(root, { produto: p }); });
  $('#kp-rec', m.el) && ($('#kp-rec', m.el).onclick = async () => {
    if (!await confirmDialog('Recalcular custo médio e saldos deste produto em ordem de data?')) return;
    try { const n = await q(sb.rpc('est_recalcular', { p_empresa: state.empresa.id, p_produto: p.id })); toast(`${n} movimento(s) recalculado(s)`); m.close(); await recarregar(root); kardexProduto(D.prod[p.id], root); } catch (err) { fail(err); }
  });
}

async function estornar(mv, p, root, pai) {
  const t = D.tm[mv.tipo_movimento_id];
  const m = modal({ title: 'Estornar movimento', body: `<p style="margin-top:0">${dateBR(mv.data)} · ${esc(t?.nome || '')} · ${esc(D.loc[mv.local_id]?.nome || '')} · <b>${qtd(mv.quantidade)} ${esc(p.unidade)}</b> a ${unit(mv.custo_unitario)}</p>
    ${mv.transferencia_id ? '<p class="small"><span class="badge vencido">transferência</span> Estorne as duas pernas (saída e entrada).</p>' : ''}
    <div class="grid2"><label>Data do estorno<input type="date" id="es-dt" value="${today()}"></label><label>Motivo<input id="es-mot" placeholder="obrigatório"></label></div>
    <p class="small muted">Gera o movimento inverso, ao mesmo custo. O original continua no kardex.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="es-ok">Estornar</button>' });
  $('#es-ok', m.el).onclick = async () => {
    const mot = $('#es-mot', m.el).value.trim(); if (!mot) return toast('Informe o motivo', true);
    try { await q(sb.rpc('est_estornar', { p_mov: mv.id, p_data: $('#es-dt', m.el).value, p_motivo: mot })); toast('Estornado'); m.close(); pai.close(); await recarregar(root); kardexProduto(D.prod[p.id], root); } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------ movimento manual
function movimento(root, { produto = null, transferencia = false } = {}) {
  const tipos = D.tipos.filter(t => transferencia ? t.sentido === 'T' : t.sentido !== 'T');
  const locOp = (sel) => D.locais.filter(l => l.ativo && l.controla_saldo).map(l => `<option value="${l.id}" ${sel === l.id ? 'selected' : ''}>${esc(l.nome)}</option>`).join('');
  const m = modal({ title: transferencia ? 'Transferência entre locais' : 'Novo movimento de estoque', wide: true, body: `
    <div class="grid-form">
      ${transferencia ? '' : `<label class="span2">Tipo de movimento<select id="mv-t">${tipos.map(t => `<option value="${t.id}" ${t.codigo === 'COMPRA' ? 'selected' : ''}>${SENTIDOS[t.sentido]} · ${esc(t.nome)}</option>`).join('')}</select></label>`}
      <label>Data<input type="date" id="mv-dt" value="${today()}"></label>
      <label class="span2">Produto<input id="mv-p" list="mv-dl" value="${produto ? esc(produto.codigo + ' — ' + produto.descricao) : ''}" placeholder="código ou descrição">${datalistProdutos('mv-dl', D.prods.filter(p => p.ativo))}</label>
      <label>${transferencia ? 'Origem' : 'Local'}<select id="mv-l">${locOp(null)}</select></label>
      ${transferencia ? `<label>Destino<select id="mv-d">${locOp(null)}</select></label>` : ''}
      <label>Lote<input id="mv-lote" list="mv-lotes" placeholder="se o produto controla lote"><datalist id="mv-lotes"></datalist></label>
      <label id="mv-lf-l" hidden>Lote do fornecedor (lote novo)<input id="mv-lf"></label>
      <label>Quantidade<input id="mv-q" inputmode="decimal"></label>
      <label id="mv-cu-l">Custo unitário (sem impostos recuperáveis)<input id="mv-cu" inputmode="decimal"></label>
      <label>Documento<input id="mv-doc" placeholder="NF, OP, requisição"></label>
      <label class="span2">Observação<input id="mv-obs"></label>
    </div>
    <p class="small" id="mv-info" style="margin:8px 0 0"></p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mv-ok">Lançar</button>' });
  const V = (id) => $('#' + id, m.el)?.value.trim() || '';
  const prod = () => acharProduto(V('mv-p'), D.prods);
  const tipo = () => transferencia ? D.tipos.find(t => t.codigo === 'TRF') || tipos[0] : D.tm[V('mv-t')];
  const atualizar = () => {
    const p = prod(), t = tipo();
    if (!transferencia && t) {   // local padrão: o do tipo (origem na saída, destino na entrada) ou o do produto
      const pad = t.sentido === 'S' ? t.local_origem_id : t.local_destino_id;
      const alvo = pad || p?.local_padrao_id; if (alvo && !m.el.dataset.localMexido) $('#mv-l', m.el).value = alvo;
    }
    const entradaCusto = !transferencia && t?.sentido === 'E' && t.afeta_custo;
    $('#mv-cu-l', m.el).hidden = !entradaCusto;
    const ls = p ? D.lotes.filter(l => l.produto_id === p.id) : [];
    $('#mv-lotes', m.el).innerHTML = ls.map(l => `<option value="${esc(l.codigo)}">${esc(l.lote_fornecedor || '')}</option>`).join('');
    const novoLote = p?.controla_lote && V('mv-lote') && !ls.some(l => l.codigo === V('mv-lote'));
    $('#mv-lf-l', m.el).hidden = !novoLote;
    const s = p ? D.saldos.filter(x => x.produto_id === p.id && x.local_id === V('mv-l')).reduce((a, x) => a + +x.quantidade, 0) : null, c = p ? D.custo[p.id] : null;
    $('#mv-info', m.el).innerHTML = p ? `Saldo no local: <b>${qtd(s)} ${esc(p.unidade)}</b> · custo médio ${c ? unit(c.custo_medio) : '–'}${p.controla_lote ? ' · <span class="badge">controla lote</span>' : ''}${entradaCusto ? '' : !transferencia && t?.sentido === 'E' ? ' · entra ao custo médio' : ' · sai ao custo médio'}` : '<span class="muted">Escolha o produto.</span>';
  };
  $('#mv-l', m.el).addEventListener('change', () => { m.el.dataset.localMexido = '1'; });
  m.el.addEventListener('input', atualizar); m.el.addEventListener('change', atualizar); atualizar();
  $('#mv-ok', m.el).onclick = async (ev) => {
    const p = prod(), t = tipo(); if (!p) return toast('Escolha o produto na lista', true); if (!t) return toast('Cadastre o tipo de movimento', true);
    const qv = num(V('mv-q')); if (!(qv > 0)) return toast('Informe a quantidade', true);
    const entradaCusto = !transferencia && t.sentido === 'E' && t.afeta_custo, cu = num(V('mv-cu'));
    if (entradaCusto && !(cu >= 0 && V('mv-cu'))) return toast('Informe o custo unitário', true);
    if (transferencia && V('mv-l') === V('mv-d')) return toast('Origem e destino iguais', true);
    ev.target.disabled = true;
    try {
      let lote = null;
      if (V('mv-lote')) {
        lote = D.lotes.find(l => l.produto_id === p.id && l.codigo === V('mv-lote'))?.id;
        if (!lote) lote = (await q(sb.from('est_lotes').insert({ empresa_id: state.empresa.id, produto_id: p.id, codigo: V('mv-lote'), lote_fornecedor: V('mv-lf') || null, origem: t.codigo === 'PROD' ? 'producao' : t.codigo === 'SI' || t.documento === 'inventario' ? 'inventario' : 'compra' }).select('id').single())).id;
      }
      if (transferencia) await q(sb.rpc('est_transferir', { p_empresa: state.empresa.id, p_data: V('mv-dt'), p_produto: p.id, p_origem: V('mv-l'), p_destino: V('mv-d'), p_qtd: qv, p_lote: lote, p_tipo: t.id, p_obs: V('mv-obs') || null }));
      else await q(sb.from('est_movimentos').insert({ empresa_id: state.empresa.id, data: V('mv-dt'), produto_id: p.id, local_id: V('mv-l'), lote_id: lote, tipo_movimento_id: t.id,
        quantidade: t.sentido === 'S' ? -qv : qv, custo_unitario: entradaCusto ? cu : null, documento: V('mv-doc') || null, observacao: V('mv-obs') || null }));
      toast('Movimento lançado'); m.close(); await recarregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

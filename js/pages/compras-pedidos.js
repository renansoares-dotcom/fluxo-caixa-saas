// Compras › Pedidos: rascunho → aprovação (alçada) → enviado → recebido. Aprovado gera previsão no contas a pagar (no banco).
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal, confirmDialog, exportXLSX } from '../lib/ui.js';
import { cadCompras, ST_PED, badge, ABERTOS, qtd, inp, unit, num, diasTxt, lerDias, podeAprovar } from '../lib/compras.js';
import { carregarProdutos, datalistProdutos, ligarItensProduto, produtoDoItem } from '../lib/produtos.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { conversaNoModal } from '../lib/mini-chat.js';
import { seletorColunas } from '../lib/colunas.js';
import { DESTINACOES, REGIMES_FORN, realizadoCotado, fmt } from '../lib/aquisicao.js';
import { baseFiscal } from '../lib/aquisicao-base.js';

export const title = 'Pedidos de Compra';
const ui = { filtro: 'andamento', busca: '' };
let P = [], C = null, PRODS = [], VIS = [];
// colunas que o seletor "Colunas" mostra ou oculta (docs/design-system.md › 5); Data, Iniflex, Pagamento e Recebido ficam na 2ª linha
const COLUNAS = [{ id: 'data', nome: 'Data do pedido', sub: true }, { id: 'ini', nome: 'Nº no Iniflex', sub: true }, { id: 'forn', nome: 'Fornecedor' },
  { id: 'pag', nome: 'Pagamento', sub: true }, { id: 'sit', nome: 'Situação' }, { id: 'itens', nome: 'Itens' }, { id: 'ent', nome: 'Entrega prevista' }, { id: 'rec', nome: 'Recebido (%)', sub: true }];
const FILTROS = [['andamento', 'Em andamento', ['rascunho', 'aguardando', 'aprovado', 'enviado', 'recebido_parcial']], ['aguardando', 'Aguardando aprovação', ['aguardando']],
  ['receber', 'A receber', ABERTOS], ['recebido', 'Recebidos', ['recebido']], ['cancelado', 'Cancelados', ['cancelado']], ['todos', 'Todos', null]];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Pedidos de Compra</h2><div class="muted small">Pedido aprovado vira previsão no contas a pagar; o recebimento com a nota troca a previsão pelos títulos reais.</div></div>
      <div style="display:flex;gap:8px" id="pc-acoes"><button class="btn ghost" id="pc-xls">Excel</button><button class="btn primary" id="pc-novo">Novo pedido</button></div></div>
    <div class="card toolbar"><div class="chips" id="pc-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <input id="pc-busca" placeholder="Procurar fornecedor, item, nº ou Iniflex" value="${esc(ui.busca)}" style="min-width:260px"></div>
    <div id="pc-lista" style="margin-top:12px" data-colunas="compras-pedidos"><div class="loading">Carregando…</div></div>`;
  $('#pc-acoes', root).prepend(seletorColunas({ tela: 'compras-pedidos', colunas: COLUNAS, classe: 'btn ghost' }).botao);
  $('#pc-novo', root).onclick = () => editar(null, root);
  // Excel com todas as colunas, mesmo as ocultas na tela
  $('#pc-xls', root).onclick = () => exportXLSX([['Nº', 'Data', 'Fornecedor', 'Itens', 'Entrega prevista', 'Pagamento', 'Total', 'Recebido (%)', 'Iniflex', 'Situação'],
    ...VIS.map(p => [`PC ${p.numero}`, dateBR(p.data_pedido), C.forById[p.favorecido_id]?.nome || '', p.itens.map(i => i.descricao).join(' · '), dateBR(p.entrega_prevista),
      p.condicao_pagamento || diasTxt(p.parcelas_dias), +p.total, p.pctRec ? Math.round(p.pctRec * 100) : '', p.pedido_iniflex || '', ST_PED[p.status]?.[0] || p.status])], 'pedidos_de_compra');
  $('#pc-f', root).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; $$('#pc-f .chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === f)); pintar(root); } };
  $('#pc-busca', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  const ab = state.abrir?.tipo === 'pedido' ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if (ab) { const p = P.find(x => x.id === ab.id); if (p) abrir(p, root); }
}

export async function carregarPedidos() {
  const e = state.empresa.id;
  const [peds, itens] = await Promise.all([fetchAll(() => sb.from('compras_pedidos').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
    fetchAll(() => sb.from('compras_pedido_itens').select('*').eq('empresa_id', e).order('id'))]);
  return peds.map(p => { const it = itens.filter(i => i.pedido_id === p.id);
    const vIt = it.reduce((t, i) => t + i.quantidade * i.valor_unitario, 0), vRec = it.reduce((t, i) => t + Math.min(+i.qtd_recebida, +i.quantidade) * i.valor_unitario, 0);
    return { ...p, itens: it, pctRec: vIt ? vRec / vIt : 0, aReceber: ['cancelado', 'recebido'].includes(p.status) ? 0 : Math.max(+p.total * (1 - (vIt ? vRec / vIt : 0)), 0) }; });
}
async function carregar(root) {
  try { [C, P, PRODS] = await Promise.all([cadCompras(), carregarPedidos(), carregarProdutos().catch(() => [])]); pintar(root); }
  catch (err) { fail(err); $('#pc-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}

function pintar(root) {
  const sts = FILTROS.find(f => f[0] === ui.filtro)[2], b = ui.busca.trim().toLowerCase(), h = today();
  const vis = P.filter(p => (!sts || sts.includes(p.status)) && (!b || String(p.numero) === b.replace(/\D/g, '') || (p.pedido_iniflex || '').toLowerCase().includes(b)
    || (C.forById[p.favorecido_id]?.nome || '').toLowerCase().includes(b) || p.itens.some(i => i.descricao.toLowerCase().includes(b))));
  VIS = vis;
  $('#pc-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº<div class="small" data-col="data">Data</div></th>
      <th data-col="forn">Fornecedor<div class="small" data-col="pag">Pagamento</div></th><th data-col="sit">Situação</th><th data-col="itens">Itens</th><th data-col="ent">Entrega prevista</th>
      <th class="num">Total<div class="small" data-col="rec">Recebido</div></th></tr></thead><tbody>
    ${vis.map(p => `<tr class="clickable" data-id="${p.id}"><td>PC ${p.numero}<div class="small muted" data-col="data">${dateBR(p.data_pedido)}</div>${p.pedido_iniflex ? `<div class="small muted" data-col="ini">Iniflex ${esc(p.pedido_iniflex)}</div>` : ''}</td>
      <td class="wrap-m" data-col="forn">${esc(C.forById[p.favorecido_id]?.nome || '–')}<div class="small muted" data-col="pag">${esc(p.condicao_pagamento || diasTxt(p.parcelas_dias))}</div></td>
      <td data-col="sit">${badge(ST_PED, p.status)}</td>
      <td class="wrap" data-col="itens">${esc(p.itens.slice(0, 2).map(i => i.descricao).join(' · '))}${p.itens.length > 2 ? ` <span class="muted">+${p.itens.length - 2}</span>` : ''}</td>
      <td data-col="ent" class="${p.entrega_prevista && p.entrega_prevista < h && ABERTOS.includes(p.status) ? 'neg' : ''}">${dateBR(p.entrega_prevista)}</td>
      <td class="num">${money(p.total)}${p.pctRec ? `<div class="small muted" data-col="rec">recebido ${Math.round(p.pctRec * 100)}%</div>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="6" class="empty">Nenhum pedido neste filtro.</td></tr>'}</tbody></table></div></div>`;
  $$('#pc-lista tr[data-id]', root).forEach(tr => tr.onclick = () => abrir(P.find(p => p.id === tr.dataset.id), root));
}

// impostos do item (SQL 200): o total do pedido soma IPI e ICMS-ST, que é o que se paga ao fornecedor
const merc = (i) => +i.quantidade * +i.valor_unitario, ipiDe = (i) => merc(i) * (+i.ipi_aliq || 0) / 100, stDe = (i) => +i.quantidade * (+i.st_un || 0);
const pct = (v) => (v == null || v === '' ? '' : String(+v).replace('.', ','));
const DEST_CURTA = { insumo: 'Insumo', revenda: 'Revenda', uso_consumo: 'Uso/consumo', ativo: 'Ativo' };
const numOuNulo = (v) => (String(v ?? '').trim() === '' ? null : num(v));

// ------------------------------------------------------------ editar (rascunho/aguardando) ou criar avulso
function linhaItem(i = {}) {
  return `<tr><td><input class="it-d" list="dl-prod" ${i.produto_id ? `data-prod="${i.produto_id}"` : ''} value="${esc(i.descricao || '')}" style="min-width:170px"></td><td><input class="it-u" value="${esc(i.unidade || 'UN')}" style="width:50px"></td>
    <td><input class="it-q" value="${i.quantidade ? inp(i.quantidade) : ''}" style="width:82px"></td><td><input class="it-v" value="${i.valor_unitario != null ? String(+i.valor_unitario).replace('.', ',') : ''}" style="width:88px"></td>
    <td><input class="it-n" value="${esc(i.ncm || '')}" style="width:82px"></td>
    <td><select class="it-de" style="width:104px" title="Destinação: decide os créditos">${DESTINACOES.map(([k, t]) => `<option value="${k}" ${(i.destinacao || 'insumo') === k ? 'selected' : ''}>${DEST_CURTA[k] || t}</option>`).join('')}</select></td>
    <td><input class="it-ic" inputmode="decimal" value="${pct(i.icms_aliq)}" placeholder="%" style="width:52px"></td><td><input class="it-ip" inputmode="decimal" value="${pct(i.ipi_aliq)}" placeholder="%" style="width:52px"></td>
    <td><input class="it-st" inputmode="decimal" value="${i.st_un != null ? String(+i.st_un).replace('.', ',') : ''}" placeholder="R$/un" style="width:64px"></td>
    <td class="num it-t"></td><td><button class="btn ghost icon it-x">✕</button></td></tr>`;
}
function editar(p, root) {
  const v = p || { data_pedido: today(), parcelas_dias: [28], frete: 0, desconto: 0, itens: [{}] };
  const so = (id, lista, sel, rot, req = false) => `<select id="${id}"${req ? ' required' : ''}><option value="">—</option>${lista.map(x => `<option value="${x.id}" ${sel === x.id ? 'selected' : ''}>${esc(rot(x))}</option>`).join('')}</select>`;
  const m = modal({ title: p ? `PC ${p.numero} — editar` : 'Novo pedido de compra (avulso)', wide: true, body: `
    <fieldset><legend>Pedido</legend><div class="grid-form">
      <label class="span2">Fornecedor *${so('pe-f', C.fornecedores, v.favorecido_id, f => f.nome + (f.documento ? ' · ' + f.documento : ''), true)}</label>
      <label class="xs">Data do pedido<input type="date" id="pe-dt" value="${v.data_pedido || today()}"></label>
      <label class="xs">Entrega prevista<input type="date" id="pe-ent" value="${v.entrega_prevista || ''}"></label>
      <label class="xs">Nº do pedido no Iniflex<input id="pe-ini" value="${esc(v.pedido_iniflex || '')}"></label>
      <label>Parcelas (dias após a entrega)<input id="pe-pd" value="${(v.parcelas_dias || []).join('/')}" placeholder="28/56/84 ou 0 à vista"></label>
      <label>Condição (texto)<input id="pe-cd" value="${esc(v.condicao_pagamento || '')}" placeholder="ex.: boleto 28 ddl"></label>
      <label class="span2"><span>Classificação (plano de contas) <span class="muted small">obrigatória para aprovar</span></span>${so('pe-pl', C.planos, v.plano_id, x => `${x.codigo} - ${x.nome}`)}</label>
      <label class="c4">Centro de custo${so('pe-cc', C.centros, v.centro_custo_id, x => x.nome)}</label>
      <label class="xs">Frete<input id="pe-fr" value="${(+v.frete || 0).toFixed(2).replace('.', ',')}"></label>
      <label class="xs">Desconto<input id="pe-ds" value="${(+v.desconto || 0).toFixed(2).replace('.', ',')}"></label>
      <label class="c4">Observação<input id="pe-obs" value="${esc(v.observacao || '')}"></label>
      <label class="xs" title="UF de onde a mercadoria sai: define o ICMS interestadual e o DIFAL">UF de origem<input id="pe-uf" maxlength="2" value="${esc(v.uf || '')}" style="text-transform:uppercase"></label>
      <label title="Regime do fornecedor: no Simples, o ICMS não vem destacado">Regime do fornecedor<select id="pe-rg"><option value="">—</option>${REGIMES_FORN.map(([k, t]) => `<option value="${k}" ${v.regime === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="xs" title="Fornecedor do Simples: % de crédito de ICMS informado na nota">Crédito do Simples (%)<input id="pe-sc" inputmode="decimal" value="${pct(v.simples_credito_pct)}"></label>
    </div></fieldset>
    <fieldset><legend>Itens</legend><p class="small muted" style="margin:0 0 6px">Escolha o produto do cadastro na lista ou escreva livre. ICMS, IPI e ICMS-ST vêm da cotação; o recebimento confere a nota contra eles. Deixe em branco se não souber.</p>${datalistProdutos('dl-prod', PRODS)}
    <div class="table-wrap"><table><thead><tr><th>Descrição *</th><th>Unid.</th><th>Quantidade *</th><th>Valor unit. *</th><th>NCM</th><th>Destinação</th><th>ICMS</th><th>IPI</th><th>ICMS-ST</th><th class="num">Total</th><th></th></tr></thead><tbody id="pe-itens">${v.itens.map(linhaItem).join('')}</tbody></table></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><button class="btn ghost small" id="pe-mais">+ Item</button><b id="pe-tot"></b></div></fieldset>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pe-ok">Salvar</button>` });
  const tb = $('#pe-itens', m.el);
  ligarItensProduto(tb, PRODS);
  const somar = () => { let t = 0, imp = 0; $$('tr', tb).forEach(tr => { const q = num($('.it-q', tr).value), mv = q * num($('.it-v', tr).value), ii = mv * num($('.it-ip', tr).value) / 100 + q * num($('.it-st', tr).value);
      t += mv + ii; imp += ii; $('.it-t', tr).textContent = mv ? money(mv + ii) : ''; });
    $('#pe-tot', m.el).textContent = 'Total do pedido: ' + money(t + num($('#pe-fr', m.el).value) - num($('#pe-ds', m.el).value)) + (imp ? ` (com ${money(imp)} de IPI e ICMS-ST)` : ''); };
  m.el.addEventListener('input', somar); somar();
  $('#pe-mais', m.el).onclick = () => tb.insertAdjacentHTML('beforeend', linhaItem());
  tb.onclick = (e) => { if (e.target.closest('.it-x')) { e.target.closest('tr').remove(); somar(); } };
  $('#pe-ok', m.el).onclick = async (ev) => {
    const itens = $$('tr', tb).map(tr => ({ produto_id: produtoDoItem(tr), descricao: $('.it-d', tr).value.trim(), unidade: $('.it-u', tr).value.trim().toUpperCase() || 'UN', quantidade: num($('.it-q', tr).value),
      valor_unitario: num($('.it-v', tr).value), ncm: $('.it-n', tr).value.replace(/\D/g, '') || null, destinacao: $('.it-de', tr).value,
      icms_aliq: numOuNulo($('.it-ic', tr).value), ipi_aliq: numOuNulo($('.it-ip', tr).value), st_un: numOuNulo($('.it-st', tr).value) })).filter(i => i.descricao || i.quantidade);
    if (itens.some(i => [i.icms_aliq, i.ipi_aliq].some(x => x != null && (x < 0 || x > 100)))) return toast('Alíquota de ICMS ou IPI deve ficar entre 0 e 100%', true);
    const cab = { favorecido_id: $('#pe-f', m.el).value || null, data_pedido: $('#pe-dt', m.el).value || today(), entrega_prevista: $('#pe-ent', m.el).value || null,
      parcelas_dias: lerDias($('#pe-pd', m.el).value).length ? lerDias($('#pe-pd', m.el).value) : [0], condicao_pagamento: $('#pe-cd', m.el).value.trim() || null,
      plano_id: $('#pe-pl', m.el).value || null, centro_custo_id: $('#pe-cc', m.el).value || null, pedido_iniflex: $('#pe-ini', m.el).value.trim() || null,
      frete: num($('#pe-fr', m.el).value), desconto: num($('#pe-ds', m.el).value), observacao: $('#pe-obs', m.el).value.trim() || null,
      uf: $('#pe-uf', m.el).value.trim().toUpperCase() || null, regime: $('#pe-rg', m.el).value || null, simples_credito_pct: numOuNulo($('#pe-sc', m.el).value) };
    if (cab.uf && !/^[A-Z]{2}$/.test(cab.uf)) return toast('UF de origem com 2 letras (ex.: PB)', true);
    if (!cab.favorecido_id) return toast('Escolha o fornecedor', true);
    if (!itens.length || itens.some(i => !i.descricao || !(i.quantidade > 0))) return toast('Cada item precisa de descrição e quantidade', true);
    ev.target.disabled = true;
    try {
      const e = state.empresa.id; let id = p?.id;
      if (p) {
        await q(sb.from('compras_pedidos').update(cab).eq('id', id));
        const ant = p.itens.map(i => i.id), fica = [];
        // mantém o vínculo com a requisição quando a linha é a mesma (pela posição)
        for (const [k, i] of itens.entries()) { if (p.itens[k]) { await q(sb.from('compras_pedido_itens').update(i).eq('id', p.itens[k].id)); fica.push(p.itens[k].id); }
          else await q(sb.from('compras_pedido_itens').insert({ ...i, empresa_id: e, pedido_id: id })); }
        const sai = ant.filter(x => !fica.includes(x)); if (sai.length) await q(sb.from('compras_pedido_itens').delete().in('id', sai));
      } else {
        id = (await q(sb.from('compras_pedidos').insert({ ...cab, empresa_id: e }).select('id').single())).id;
        await q(sb.from('compras_pedido_itens').insert(itens.map(i => ({ ...i, empresa_id: e, pedido_id: id }))));
      }
      m.close(); toast('Pedido salvo'); await carregar(root); abrir(P.find(x => x.id === id), root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ------------------------------------------------------------ detalhe e ações
async function abrir(p, root) {
  if (!p) return;
  let recs = [], lancs = [];
  try {
    recs = await q(sb.from('compras_recebimentos').select('id,data,nfe_nota_id,divergencias,observacao').eq('pedido_id', p.id).order('data'));
    if (state.papel !== 'compras') {
      const lk = await q(sb.from('compras_pedido_lancamentos').select('lancamento_id,tipo').eq('pedido_id', p.id));
      if (lk.length) lancs = (await q(sb.from('lancamentos').select('id,data,valor,status,descricao').in('id', lk.map(x => x.lancamento_id)).order('data'))).map(l => ({ ...l, tipo: lk.find(x => x.lancamento_id === l.id).tipo }));
    }
  } catch (err) { return fail(err); }
  const alc = +(C.parametros?.alcada_valor ?? 5000), f = C.forById[p.favorecido_id];
  const temImp = p.itens.some(i => i.icms_aliq != null || i.ipi_aliq != null || i.st_un != null), nc = temImp ? 7 : 4, somaImp = p.itens.some(i => ipiDe(i) || stDe(i));
  const m = modal({ title: `Pedido de compra PC ${p.numero}`, wide: true, body: `
    <div class="grid-form small">
      <div class="xs"><span class="muted">Situação</span><div>${badge(ST_PED, p.status)}</div>${p.aprovado_em ? `<div class="muted">aprovado em ${dateBR(p.aprovado_em)}</div>` : ''}</div>
      <div class="span2"><span class="muted">Fornecedor</span><div>${esc(f?.nome || '–')}${f?.documento ? ` <span class="muted">${esc(f.documento)}</span>` : ''}</div></div>
      <div class="xs"><span class="muted">Data</span><div>${dateBR(p.data_pedido)}</div></div>
      <div class="xs"><span class="muted">Entrega prevista</span><div>${dateBR(p.entrega_prevista) || '–'}</div></div>
      <div class="xs"><span class="muted">Pagamento</span><div>${esc(p.condicao_pagamento || '')} ${diasTxt(p.parcelas_dias)}</div></div>
      <div class="span2"><span class="muted">Classificação</span><div>${esc(C.planoById[p.plano_id] ? `${C.planoById[p.plano_id].codigo} - ${C.planoById[p.plano_id].nome}` : '— falta definir')}</div></div>
      <div class="xs"><span class="muted">Centro de custo</span><div>${esc(C.ccById[p.centro_custo_id]?.nome || '–')}</div></div>
      <div class="xs"><span class="muted">Iniflex</span><div>${esc(p.pedido_iniflex || '–')}</div></div>
    </div>
    ${p.observacao ? `<p class="small" style="margin:8px 0 0"><span class="muted">Observação:</span> ${esc(p.observacao)}</p>` : ''}
    ${p.motivo ? `<p class="small neg" style="margin:6px 0 0">Motivo: ${esc(p.motivo)}</p>` : ''}
    ${['rascunho', 'aguardando'].includes(p.status) && p.total > alc ? `<p class="small" style="margin:8px 0 0">Acima da alçada de ${money(alc)}: a aprovação é da direção.</p>` : ''}
    ${p.uf || p.regime ? `<p class="small muted" style="margin:8px 0 0">Fornecedor: ${esc([p.uf, (REGIMES_FORN.find(x => x[0] === p.regime) || [])[1], p.simples_credito_pct != null && ['simples', 'mei'].includes(p.regime) ? `crédito de ICMS ${pct(p.simples_credito_pct)}%` : ''].filter(Boolean).join(' · '))}</p>` : ''}
    <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Item</th><th class="num">Quant.</th><th class="num">Recebido</th><th class="num">Unitário</th>${temImp ? '<th class="num">ICMS</th><th class="num">IPI</th><th class="num">ICMS-ST</th>' : ''}<th class="num">Total</th></tr></thead><tbody>
      ${p.itens.map(i => `<tr><td class="wrap">${esc(i.descricao)} <span class="muted small">${esc(i.unidade)}${i.ncm ? ' · NCM ' + esc(i.ncm) : ''}${i.destinacao ? ' · ' + esc((DESTINACOES.find(d => d[0] === i.destinacao) || [])[1] || '') : ''}</span></td><td class="num">${qtd(i.quantidade)}</td>
        <td class="num ${+i.qtd_recebida >= +i.quantidade ? 'pos' : ''}">${+i.qtd_recebida ? qtd(i.qtd_recebida) : ''}</td><td class="num">${unit(i.valor_unitario)}</td>
        ${temImp ? `<td class="num">${i.icms_aliq != null ? pct(i.icms_aliq) + '%' : '–'}</td><td class="num">${i.ipi_aliq != null ? `${pct(i.ipi_aliq)}%<div class="small muted">${money(ipiDe(i))}</div>` : '–'}</td><td class="num">${+i.st_un ? money(stDe(i)) : '–'}</td>` : ''}
        <td class="num">${money(merc(i) + ipiDe(i) + stDe(i))}</td></tr>`).join('')}
      ${somaImp ? `<tr><td colspan="${nc}">Mercadorias</td><td class="num">${money(p.itens.reduce((t, i) => t + merc(i), 0))}</td></tr>
        ${p.itens.some(i => ipiDe(i)) ? `<tr><td colspan="${nc}">IPI</td><td class="num">${money(p.itens.reduce((t, i) => t + ipiDe(i), 0))}</td></tr>` : ''}${p.itens.some(i => stDe(i)) ? `<tr><td colspan="${nc}">ICMS-ST</td><td class="num">${money(p.itens.reduce((t, i) => t + stDe(i), 0))}</td></tr>` : ''}` : ''}
      ${+p.frete ? `<tr><td colspan="${nc}">Frete</td><td class="num">${money(p.frete)}</td></tr>` : ''}${+p.desconto ? `<tr><td colspan="${nc}">Desconto</td><td class="num">−${money(p.desconto)}</td></tr>` : ''}
      <tr style="font-weight:600"><td colspan="${nc}">Total${somaImp ? ' a pagar' : ''}</td><td class="num">${money(p.total)}</td></tr></tbody></table></div>
    <div id="pc-rz"></div>
    ${recs.length ? `<h3 style="margin:14px 0 6px">Recebimentos</h3>${recs.map(r => `<div class="small">${dateBR(r.data)} ${r.nfe_nota_id ? '· com nota' : '· sem nota'}${(r.divergencias || []).length ? ` · <span class="warn">${r.divergencias.length} divergência(s)</span>` : ''}${r.observacao ? ' · ' + esc(r.observacao) : ''}</div>`).join('')}` : ''}
    ${lancs.length ? `<h3 style="margin:14px 0 6px">No contas a pagar</h3><div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Origem</th><th>Descrição</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
      ${lancs.map(l => `<tr><td>${dateBR(l.data)}</td><td>${l.tipo === 'previsao' ? 'Previsão do pedido' : 'Parcela da nota'}</td><td class="wrap">${esc(l.descricao || '')}</td><td class="num">${money(l.valor)}</td><td>${l.status}</td></tr>`).join('')}</tbody></table></div>`
      : (ABERTOS.includes(p.status) && state.papel !== 'compras' && C.parametros?.previsao_automatica !== false ? '<p class="small muted">Sem previsão no contas a pagar.</p>' : '')}`,
    foot: '<div id="pc-acoes" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  conversaNoModal(m, 'compras_pedido', p.id);
  if (recs.some(r => r.nfe_nota_id)) cotadoRealizado($('#pc-rz', m.el), p);
  const ac = $('#pc-acoes', m.el);
  const btn = (t, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = t; b.onclick = fn; ac.appendChild(b); };
  const mudar = async (dados, msg) => { try { await q(sb.from('compras_pedidos').update(dados).eq('id', p.id)); toast(msg); m.close(); await carregar(root); abrir(P.find(x => x.id === p.id), root); } catch (err) { fail(err); } };
  const cancelar = () => { const mot = prompt('Motivo do cancelamento:'); if (mot?.trim()) mudar({ status: 'cancelado', motivo: mot.trim() }, 'Pedido cancelado'); };
  btn('Imprimir', 'ghost', () => imprimir(p));
  if (p.status !== 'cancelado' && p.status !== 'recebido') btn('Cancelar pedido', 'ghost', cancelar);
  if (['rascunho', 'aguardando'].includes(p.status)) btn('Editar', '', () => { m.close(); editar(p, root); });
  if (['aguardando', 'aprovado', 'enviado'].includes(p.status) && !recs.length) btn('Voltar para rascunho', '', () => mudar({ status: 'rascunho' }, 'Pedido voltou para rascunho'));
  const aprova = podeAprovar() || +p.total <= alc;
  if (p.status === 'rascunho' && !aprova) btn('Enviar para aprovação', 'primary', () => mudar({ status: 'aguardando', motivo: null }, 'Pedido enviado para aprovação'));
  if (['rascunho', 'aguardando'].includes(p.status) && aprova) btn('Aprovar', 'primary', () => {
    if (!p.plano_id) return toast('Defina a classificação (plano de contas) no pedido antes de aprovar', true);
    mudar({ status: 'aprovado', motivo: null }, 'Pedido aprovado');
  });
  if (p.status === 'aprovado') btn('Marcar como enviado', '', () => mudar({ status: 'enviado' }, 'Pedido marcado como enviado'));
  if (ABERTOS.includes(p.status)) {
    btn('Pagamento antecipado', '', () => { m.close(); state.abrir = { tipo: 'pa-novo', v: { razao_social: f?.nome || '', cnpj: (f?.documento || '').replace(/\D/g, ''), favorecido_id: p.favorecido_id,
      valor: p.aReceber ? Math.round(p.aReceber * 100) / 100 : +p.total, pedido: `PC ${p.numero}${p.pedido_iniflex ? ' / Iniflex ' + p.pedido_iniflex : ''}`,
      descricao: `Antecipado do pedido PC ${p.numero} — ${p.itens.map(i => i.descricao).join(', ')}`.slice(0, 200), plano_id: p.plano_id, centro_custo_id: p.centro_custo_id } }; location.hash = '#/paraquedas'; });
    btn('Receber', 'primary', () => { m.close(); state.abrir = { tipo: 'receber', id: p.id }; location.hash = '#/compras/recebimentos'; });
  }
}

// custo líquido cotado × realizado (SQL 200): o que o pedido prometia de crédito e o que a nota trouxe
async function cotadoRealizado(el, p) {
  try {
    const [linhas, BF] = await Promise.all([q(sb.rpc('compras_liquido_realizado', { p_empresa: state.empresa.id, p_de: null, p_ate: null, p_pedido: p.id })), baseFiscal(C.parametros)]);
    const R = realizadoCotado(linhas || [], BF.nos, BF.P);
    if (!R.pedidos.length) { el.innerHTML = linhas?.length ? '<p class="small muted" style="margin-top:10px">Pedido sem os impostos da cotação: não há custo líquido cotado para comparar com a nota.</p>' : ''; return; }
    const x = R.pedidos[0], cls = (v) => (v > 0.005 ? 'neg' : v < -0.005 ? 'pos' : '');
    el.innerHTML = `<h3 style="margin:14px 0 6px">Custo líquido: cotado × realizado <span class="muted small" style="font-weight:400">o que o pedido previa × o que a nota trouxe (${x.notas.map(n => 'NF ' + n).join(', ')})</span></h3>
      <div class="table-wrap"><table><thead><tr><th></th><th class="num">Cotado</th><th class="num">Realizado</th><th class="num">Diferença</th></tr></thead><tbody>
        <tr><td>Desembolso</td><td class="num">${money(x.cotado.desembolso)}</td><td class="num">${money(x.realizado.desembolso)}</td><td class="num ${cls(x.difDesembolso)}">${money(x.difDesembolso)}</td></tr>
        <tr><td>(−) Créditos</td><td class="num">${money(-x.cotado.creditos)}</td><td class="num">${money(-x.realizado.creditos)}</td><td class="num ${cls(-x.difCreditos)}">${money(-x.difCreditos)}</td></tr>
        <tr style="font-weight:600"><td>Custo líquido</td><td class="num">${money(x.cotado.custo)}</td><td class="num">${money(x.realizado.custo)}</td><td class="num ${cls(x.dif)}">${money(x.dif)}</td></tr>
        ${x.itens.length > 1 ? x.itens.map(i => `<tr class="small"><td class="muted">${esc(i.item)} · ICMS ${i.nota_simples ? 'Simples' : pct(i.icms_nota) + '%'} (pedido ${pct(i.icms_pedido) || '–'}%) · IPI ${pct(+i.ipi_nota)}% (pedido ${pct(i.ipi_pedido) || '–'}%)</td><td class="num muted">${money(i.cotado.custo)}</td><td class="num muted">${money(i.realizado.custo)}</td><td class="num ${cls(i.dif)}">${money(i.dif)}</td></tr>`).join('')
          : `<tr class="small"><td class="muted" colspan="4">${esc(x.itens[0].item)} · ICMS ${x.itens[0].nota_simples ? 'do Simples' : pct(x.itens[0].icms_nota) + '%'} na nota (pedido ${pct(x.itens[0].icms_pedido) || '–'}%) · IPI ${pct(+x.itens[0].ipi_nota)}% (pedido ${pct(x.itens[0].ipi_pedido) || '–'}%)</td></tr>`}
      </tbody></table></div>
      <p class="small ${x.dif > 0.005 ? 'neg' : 'muted'}" style="margin:6px 0 0">${x.dif > 0.005 ? `A compra saiu ${money(x.dif)} mais cara do que a cotação prometia${x.difCreditos < -0.005 ? `, por ${money(-x.difCreditos)} de crédito a menos` : ''}. Vale cobrar do fornecedor (nota complementar, abatimento ou carta de correção).`
        : x.dif < -0.005 ? `A compra saiu ${money(-x.dif)} mais barata do que a cotação.` : 'A nota trouxe os impostos combinados.'} Pela mesma conta do mapa da cotação; recebimentos parciais entram pelo que já chegou.</p>`;
  } catch { el.innerHTML = ''; }
}

async function imprimir(p) {
  const f = C.forById[p.favorecido_id], w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  const ti = p.itens.some(i => i.icms_aliq != null || i.ipi_aliq != null || i.st_un != null), cs = ti ? 8 : 5;
  await abrirRelatorio({ rel: 'Pedido de compra', tipo: 'documento', janela: w, nome: `Pedido de compra PC ${p.numero}`, titulo: `Pedido de compra nº ${p.numero}`,
    subtitulo: `Data do pedido ${dateBR(p.data_pedido)}${p.pedido_iniflex ? ` · Iniflex ${esc(p.pedido_iniflex)}` : ''}`,
    corpo: `<h2>1. Fornecedor e condições</h2>
    <table class="info"><tr><td>Fornecedor</td><td>${esc(f?.nome || '')}</td></tr><tr><td>CNPJ/CPF</td><td>${esc(f?.documento || '')}</td></tr>
      <tr><td>Entrega prevista</td><td>${dateBR(p.entrega_prevista) || 'a combinar'}</td></tr><tr><td>Pagamento</td><td>${esc(p.condicao_pagamento || '')} ${diasTxt(p.parcelas_dias)}</td></tr></table>
    <h2>2. Itens</h2>
    <table><thead><tr><th>#</th><th>Descrição</th><th>Unid.</th><th class="n">Quant.</th><th class="n">Unitário</th>${ti ? '<th class="n">ICMS</th><th class="n">IPI</th><th class="n">ICMS-ST</th>' : ''}<th class="n">Total</th></tr></thead><tbody>
    ${p.itens.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.descricao)}${i.ncm ? ` (NCM ${esc(i.ncm)})` : ''}</td><td>${esc(i.unidade)}</td><td class="n">${qtd(i.quantidade)}</td><td class="n">${unit(i.valor_unitario)}</td>
      ${ti ? `<td class="n">${i.icms_aliq != null ? pct(i.icms_aliq) + '%' : '–'}</td><td class="n">${i.ipi_aliq != null ? pct(i.ipi_aliq) + '%' : '–'}</td><td class="n">${+i.st_un ? money(stDe(i)) : '–'}</td>` : ''}<td class="n">${money(merc(i) + ipiDe(i) + stDe(i))}</td></tr>`).join('')}
    ${+p.frete ? `<tr><td colspan="${cs}">Frete</td><td class="n">${money(p.frete)}</td></tr>` : ''}${+p.desconto ? `<tr><td colspan="${cs}">Desconto</td><td class="n">−${money(p.desconto)}</td></tr>` : ''}</tbody>
    <tfoot><tr><td colspan="${cs}">Total${ti ? ' (com IPI e ICMS-ST)' : ''}</td><td class="n">${money(p.total)}</td></tr></tfoot></table>
    ${ti ? '<p>As alíquotas de ICMS e IPI e o ICMS-ST acima são as da cotação: a nota fiscal deve vir com os mesmos valores. Diferenças travam o pagamento até a conferência.</p>' : ''}
    ${p.observacao ? `<p><b>Observação:</b> ${esc(p.observacao)}</p>` : ''}
    <p style="margin-top:14px">Informar o número deste pedido na nota fiscal.</p>
    <div class="ass"><div>Comprador</div><div>Aprovação</div></div>`,
    rodape: `Pedido de compra emitido pela plataforma · ${esc(state.empresa.nome || '')}` });
}

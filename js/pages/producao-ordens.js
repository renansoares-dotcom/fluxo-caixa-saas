// Produção › Ordens de produção: OP com etapas (pelo roteiro do produto), necessidade de material × estoque (gera requisição),
// apontamentos, bobinas com etiqueta e rastreabilidade, consumo real × teórico.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal, confirmDialog, exportXLSX } from '../lib/ui.js';
import { cadProducao, ST_OP, ST_ET, podePCP, podeApontar, necessidadeMaterial, imprimirEtiquetas, horas } from '../lib/producao.js';
import { carregarProdutos, datalistProdutos, acharProduto } from '../lib/produtos.js';
import { badge, qtd, num } from '../lib/compras.js';
import { abrirRelatorio } from '../lib/relatorio.js';

export const title = 'Ordens de produção';
const ui = { filtro: 'abertas', busca: '' };
let C = null, OPS = [], ETS = [], PRODS = [];
const FILTROS = [['abertas', 'Em aberto', ['planejada', 'liberada', 'em_producao']], ['atrasadas', 'Atrasadas', null], ['concluida', 'Concluídas', ['concluida']], ['todas', 'Todas', []]];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Ordens de produção</h2><div class="muted small">Enquanto o Iniflex for o sistema principal, as OPs entram por Produção › Importar do Iniflex; OPs novas também podem ser abertas aqui.</div></div>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="op-xls">Excel</button>${podePCP() ? '<button class="btn primary" id="op-nova">Nova OP</button>' : ''}</div></div>
    <div class="card toolbar"><div class="chips" id="op-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <input id="op-b" placeholder="Procurar OP, produto, cliente ou pedido" value="${esc(ui.busca)}" style="min-width:260px"></div>
    <div id="op-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#op-nova', root) && ($('#op-nova', root).onclick = () => nova(root));
  $('#op-xls', root).onclick = () => exportXLSX($('#op-lista table', root), 'ordens_producao');
  $('#op-f', root).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; $$('#op-f .chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === f)); pintar(root); } };
  $('#op-b', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  const ab = state.abrir?.tipo === 'op' ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if (ab) { const o = OPS.find(x => x.id === ab.id); if (o) abrir(o, root); }
}
async function carregar(root) {
  try {
    const e = state.empresa.id;
    [C, OPS, ETS, PRODS] = await Promise.all([cadProducao(true), fetchAll(() => sb.from('prod_ordens').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
      fetchAll(() => sb.from('prod_ordem_etapas').select('*').eq('empresa_id', e).order('seq')), carregarProdutos().catch(() => [])]);
    pintar(root);
  } catch (err) { fail(err); $('#op-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}
const progresso = (o) => { const et = ETS.filter(x => x.ordem_id === o.id); const ult = et[et.length - 1]; return ult ? Math.min(+ult.qtd_boa / +o.quantidade, 1) : null; };
const etapaAtual = (o) => ETS.filter(x => x.ordem_id === o.id).find(x => x.status !== 'concluida');
function pintar(root) {
  const h = today(), b = ui.busca.trim().toLowerCase(), f = FILTROS.find(x => x[0] === ui.filtro);
  const vis = OPS.filter(o => (ui.filtro === 'atrasadas' ? (o.entrega && o.entrega < h && !['concluida', 'cancelada'].includes(o.status)) : (!f[2].length || f[2].includes(o.status)))
    && (!b || [o.numero, o.numero_iniflex, o.codigo_produto, o.descricao, o.cliente, o.pedido_iniflex].some(v => String(v ?? '').toLowerCase().includes(b))))
    .sort((a, c) => (a.status === 'concluida') - (c.status === 'concluida') || a.prioridade - c.prioridade || String(a.entrega || '9').localeCompare(String(c.entrega || '9')));
  $('#op-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:68vh"><table><thead><tr><th>OP</th><th>Iniflex</th><th>Produto</th><th>Cliente</th><th class="num">Quantidade</th><th>Entrega</th><th>Prior.</th><th>Etapa atual</th><th class="num">Feito</th><th>Situação</th></tr></thead><tbody>
    ${vis.map(o => { const et = etapaAtual(o), pg = progresso(o); return `<tr class="clickable" data-id="${o.id}"><td>${o.numero}</td><td>${esc(o.numero_iniflex || '')}</td>
      <td class="wrap">${esc(o.codigo_produto || '')} ${esc(o.descricao || '')}</td><td class="wrap">${esc(o.cliente || '')}</td><td class="num">${qtd(o.quantidade)} ${esc(o.unidade)}</td>
      <td class="${o.entrega && o.entrega < h && !['concluida', 'cancelada'].includes(o.status) ? 'neg' : ''}">${dateBR(o.entrega)}</td><td>${o.prioridade}</td>
      <td>${et ? esc(C.setorById[et.setor_id]?.nome || '') + (et.maquina_id ? ` · ${esc(C.maqById[et.maquina_id]?.codigo || '')}` : '') : ''}</td><td class="num">${pg != null ? Math.round(pg * 100) + '%' : ''}</td><td>${badge(ST_OP, o.status)}</td></tr>`; }).join('')
    || '<tr><td colspan="10" class="empty">Nenhuma OP neste filtro.</td></tr>'}</tbody></table></div></div>`;
  $$('#op-lista tr[data-id]', root).forEach(tr => tr.onclick = () => abrir(OPS.find(o => o.id === tr.dataset.id), root));
}

// ------------------------------------------------------------ nova OP
function nova(root) {
  const cli = (state.cad?.favorecidos || []).filter(f => f.ativo && ['CLIENTES', 'TERCEIROS - CLIENTES'].includes(f.tipo));
  const m = modal({ title: 'Nova ordem de produção', wide: true, body: `
    <div class="grid-form">
      <label class="span2">Produto *<input id="no-p" list="no-dl" placeholder="código ou descrição">${datalistProdutos('no-dl', PRODS)}</label>
      <label>Quantidade *<input id="no-q"></label><label>Unidade<select id="no-u">${['KG', 'MIL', 'UN', 'M'].map(u => `<option>${u}</option>`).join('')}</select></label>
      <label class="span2">Cliente<input id="no-c" list="no-cl"><datalist id="no-cl">${cli.map(f => `<option value="${esc(f.nome)}"></option>`).join('')}</datalist></label>
      <label>Pedido no Iniflex<input id="no-ped"></label><label>Nº da OP no Iniflex<input id="no-ini"></label>
      <label>Entrega<input type="date" id="no-e"></label><label>Prioridade (1 = mais urgente)<select id="no-pr">${[1, 2, 3, 4, 5].map(n => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="span2">Observação<input id="no-o"></label></div>
    <p class="small muted">As etapas vêm do roteiro do produto (Produção › Cadastros › Roteiros). Sem roteiro, a OP nasce sem etapas e você inclui depois.</p>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="no-ok">Criar OP</button>` });
  $('#no-p', m.el).onchange = () => { const p = acharProduto($('#no-p', m.el).value, PRODS); if (p && ['KG', 'MIL', 'UN', 'M'].includes(p.unidade)) $('#no-u', m.el).value = p.unidade; };
  $('#no-ok', m.el).onclick = async (ev) => {
    const p = acharProduto($('#no-p', m.el).value, PRODS); if (!p) return toast('Escolha o produto da lista', true);
    const qv = num($('#no-q', m.el).value); if (!(qv > 0)) return toast('Informe a quantidade', true);
    const f = cli.find(x => x.nome === $('#no-c', m.el).value.trim());
    ev.target.disabled = true;
    try {
      const e = state.empresa.id;
      const op = await q(sb.from('prod_ordens').insert({ empresa_id: e, produto_id: p.id, codigo_produto: p.codigo, descricao: p.descricao, quantidade: qv, unidade: $('#no-u', m.el).value,
        favorecido_id: f?.id || null, cliente: f?.nome || $('#no-c', m.el).value.trim() || null, pedido_iniflex: $('#no-ped', m.el).value.trim() || null, numero_iniflex: $('#no-ini', m.el).value.trim() || null,
        entrega: $('#no-e', m.el).value || null, prioridade: +$('#no-pr', m.el).value, observacao: $('#no-o', m.el).value.trim() || null, status: 'planejada' }).select('*').single());
      const rot = await q(sb.from('prod_roteiros').select('*').eq('produto_id', p.id).order('seq'));
      if (rot.length) await q(sb.from('prod_ordem_etapas').insert(rot.map(r => ({ empresa_id: e, ordem_id: op.id, seq: r.seq, setor_id: r.setor_id, maquina_id: r.maquina_id, qtd_prevista: qv,
        horas_previstas: r.velocidade_kg_h && $('#no-u', m.el).value === 'KG' ? Math.round((qv / r.velocidade_kg_h + (+r.setup_min || 0) / 60) * 100) / 100 : null }))));
      m.close(); toast(`OP ${op.numero} criada`); await carregar(root); abrir(OPS.find(x => x.id === op.id), root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ------------------------------------------------------------ ficha da OP
async function abrir(o, root) {
  if (!o) return;
  let ap = [], bob = [], cons = [], nec = { linhas: [] }, custoRep = {};
  try {
    [ap, bob, cons, nec] = await Promise.all([q(sb.from('prod_apontamentos').select('*').eq('ordem_id', o.id).order('inicio')),
      q(sb.from('prod_bobinas').select('*').eq('ordem_id', o.id).order('criado_em')), q(sb.from('prod_consumos').select('*').eq('ordem_id', o.id).order('criado_em')),
      necessidadeMaterial(o).catch(() => ({ linhas: [] }))]);
    if (['admin', 'financeiro', 'diretor', 'leitura'].includes(state.papel)) {
      const ids = [...new Set([...cons.map(c => c.produto_id), ...nec.linhas.map(l => l.produto.id)].filter(Boolean))];
      if (ids.length) for (const f of await q(sb.from('produto_fornecedores').select('produto_id,ultimo_preco,ultima_compra').in('produto_id', ids)))
        if (f.ultimo_preco != null && (!custoRep[f.produto_id] || String(f.ultima_compra) > custoRep[f.produto_id].d)) custoRep[f.produto_id] = { v: +f.ultimo_preco, d: String(f.ultima_compra) };
    }
  } catch (err) { return fail(err); }
  const et = ETS.filter(x => x.ordem_id === o.id), pcp = podePCP();
  const totBoa = et.length ? +et[et.length - 1].qtd_boa : ap.reduce((t, a) => t + +a.qtd_boa, 0), totRef = ap.reduce((t, a) => t + +a.refugo, 0), totApBoa = ap.reduce((t, a) => t + +a.qtd_boa, 0), totH = ap.reduce((t, a) => t + horas(a.inicio, a.fim), 0);
  const consPorProd = {}; for (const c of cons) if (c.produto_id) consPorProd[c.produto_id] = (consPorProd[c.produto_id] || 0) + +c.quantidade;
  const custoReal = Object.entries(consPorProd).reduce((t, [id, qv]) => t + qv * (custoRep[id]?.v || 0), 0);
  const fator = o.quantidade ? totBoa / o.quantidade : 0;
  const custoTeo = nec.linhas.reduce((t, l) => t + l.necessario * fator * (custoRep[l.produto.id]?.v || 0), 0);
  const m = modal({ title: `OP ${o.numero}${o.numero_iniflex ? ` · Iniflex ${o.numero_iniflex}` : ''}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Situação</span><div>${badge(ST_OP, o.status)} <span class="muted">${o.origem === 'iniflex' ? 'importada do Iniflex' : ''}</span></div></div>
      <div class="span2"><span class="muted">Produto</span><div>${esc(o.codigo_produto || '')} ${esc(o.descricao || '')}${o.produto_id ? '' : ' <span class="badge aberto">sem cadastro</span>'}</div></div>
      <div><span class="muted">Quantidade</span><div>${qtd(o.quantidade)} ${esc(o.unidade)}</div></div>
      <div><span class="muted">Cliente</span><div>${esc(o.cliente || '–')}</div></div><div><span class="muted">Pedido Iniflex</span><div>${esc(o.pedido_iniflex || '–')}</div></div>
      <div><span class="muted">Entrega</span><div>${dateBR(o.entrega) || '–'}</div></div><div><span class="muted">Prioridade</span><div>${o.prioridade}</div></div>
      <div><span class="muted">Produzido (última etapa)</span><div><b>${qtd(Math.round(totBoa * 100) / 100)}</b> ${esc(o.unidade)} (${o.quantidade ? Math.round(totBoa / o.quantidade * 100) : 0}%)</div></div>
      <div><span class="muted">Apara / refugo</span><div>${qtd(Math.round(totRef * 100) / 100)} kg${totApBoa + totRef ? ` (${(totRef / (totApBoa + totRef) * 100).toFixed(1).replace('.', ',')}% do apontado)` : ''}</div></div>
      <div><span class="muted">Horas apontadas</span><div>${totH.toFixed(1).replace('.', ',')} h${totH && o.unidade === 'KG' ? ` · ${qtd(Math.round(ap.reduce((t, a) => t + +a.qtd_boa, 0) / totH))} kg/h` : ''}</div></div>
    </div>
    ${o.observacao ? `<p class="small">${esc(o.observacao)}</p>` : ''}
    <h3 style="margin:14px 0 6px">Etapas</h3>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Setor</th><th>Máquina</th><th>Previsto</th><th class="num">Bom</th><th class="num">Refugo</th><th>Situação</th>${pcp ? '<th></th>' : ''}</tr></thead><tbody>
      ${et.map(x => `<tr><td>${x.seq}</td><td>${esc(C.setorById[x.setor_id]?.nome || '')}</td><td>${esc(C.maqById[x.maquina_id] ? `${C.maqById[x.maquina_id].codigo} — ${C.maqById[x.maquina_id].nome}` : '–')}</td>
        <td>${x.inicio_previsto ? dateBR(x.inicio_previsto) : ''}${x.horas_previstas ? ` · ${String(x.horas_previstas).replace('.', ',')} h` : ''}</td><td class="num">${qtd(x.qtd_boa)}</td><td class="num">${qtd(x.refugo)}</td><td>${badge(ST_ET, x.status)}</td>
        ${pcp ? `<td><div style="display:flex;gap:4px">${x.status !== 'concluida' ? `<button class="btn ghost small" data-ce="${x.id}">Concluir</button>` : `<button class="btn ghost small" data-re="${x.id}">Reabrir</button>`}</div></td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${pcp ? 8 : 7}" class="empty">Sem etapas. Cadastre o roteiro do produto ou inclua uma etapa.</td></tr>`}</tbody></table></div>
    ${pcp ? `<div class="grid-form" style="margin-top:6px"><label>Incluir etapa: setor<select id="oe-s">${C.setores.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}</select></label>
      <label>Máquina<select id="oe-m"><option value="">—</option>${C.maquinas.filter(mq => mq.ativo).map(mq => `<option value="${mq.id}">${esc(mq.codigo)} — ${esc(mq.nome)}</option>`).join('')}</select></label>
      <div style="align-self:end"><button class="btn small" id="oe-ok">+ Etapa</button></div></div>` : ''}
    <h3 style="margin:14px 0 6px">Necessidade de material ${nec.espelho ? `<span class="muted small" style="font-weight:400">saldo do Iniflex em ${dateBR(nec.espelho.data_ref)}</span>` : ''}</h3>
    ${nec.unidadeDiferente ? `<p class="small warn">A estrutura do produto é por ${esc(nec.unidadeDiferente.produto)} e a OP está em ${esc(nec.unidadeDiferente.op)}: a necessidade não é calculada. Ajuste a unidade da OP ou do produto.</p>` : nec.semEstrutura ? '<p class="small muted">O produto não tem estrutura cadastrada (Estoque › Produtos › Estrutura).</p>' : `<div class="table-wrap"><table><thead><tr><th>Material</th><th class="num">Necessário</th><th class="num">Em estoque</th><th class="num">Falta</th><th class="num">Consumido</th></tr></thead><tbody>
      ${nec.linhas.map(l => `<tr><td>${esc(l.produto.codigo || '')} — ${esc(l.produto.descricao || '')}</td><td class="num">${qtd(Math.round(l.necessario * 100) / 100)} ${esc(l.produto.unidade || '')}</td>
        <td class="num">${l.saldo == null ? '–' : qtd(Math.round(l.saldo * 100) / 100)}</td><td class="num ${l.falta ? 'neg' : ''}">${l.falta == null ? '–' : qtd(Math.round(l.falta * 100) / 100)}</td><td class="num">${qtd(Math.round((consPorProd[l.produto.id] || 0) * 100) / 100)}</td></tr>`).join('')}</tbody></table></div>
      ${pcp && nec.linhas.some(l => l.falta > 0) ? '<button class="btn small" id="on-req" style="margin-top:6px">Gerar requisição dos materiais em falta</button>' : ''}`}
    ${custoTeo || custoReal ? `<p class="small" style="margin:8px 0 0">Custo de material pelo produzido: teórico (estrutura) <b>${money(custoTeo)}</b> · real (consumos apontados) <b>${money(custoReal)}</b>${custoTeo ? ` · diferença ${((custoReal / custoTeo - 1) * 100).toFixed(1).replace('.', ',')}%` : ''} <span class="muted">(último custo líquido de compra)</span></p>` : ''}
    <h3 style="margin:14px 0 6px">Apontamentos (${ap.length})</h3>
    <div class="table-wrap" style="max-height:220px"><table><thead><tr><th>Início</th><th>Fim</th><th>Máquina</th><th>Operador</th><th class="num">Bom</th><th class="num">Refugo</th><th>Motivo</th><th>Origem</th></tr></thead><tbody>
      ${ap.map(a => `<tr><td>${new Date(a.inicio).toLocaleString('pt-BR').slice(0, 17)}</td><td>${a.fim ? new Date(a.fim).toLocaleString('pt-BR').slice(0, 17) : '<span class="warn">em curso</span>'}</td>
        <td>${esc(C.maqById[a.maquina_id]?.codigo || '')}</td><td>${esc(C.opById[a.operador_id]?.nome || a.operador_nome || '')}</td><td class="num">${qtd(a.qtd_boa)}</td><td class="num">${qtd(a.refugo)}</td>
        <td>${esc(C.motById[a.refugo_motivo_id]?.nome || '')}</td><td class="small muted">${a.origem}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhum apontamento.</td></tr>'}</tbody></table></div>
    <h3 style="margin:14px 0 6px">Bobinas / volumes (${bob.length})</h3>
    <div class="table-wrap" style="max-height:220px"><table><thead><tr><th>Código</th><th>Máquina</th><th class="num">Peso</th><th class="num">Metros</th><th>Bobina mãe</th><th>Lote MP</th><th>Situação</th></tr></thead><tbody>
      ${bob.map(b => `<tr><td style="font-family:monospace">${esc(b.codigo)}</td><td>${esc(C.maqById[b.maquina_id]?.codigo || '')}</td><td class="num">${qtd(b.peso_kg)} kg</td><td class="num">${b.metros ? qtd(b.metros) : ''}</td>
        <td style="font-family:monospace">${esc(bob.find(x => x.id === b.mae_id)?.codigo || (b.mae_id ? '(outra OP)' : ''))}</td><td>${esc(b.lote_materia || '')}</td><td>${esc(b.situacao)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhuma bobina registrada.</td></tr>'}</tbody></table></div>
    ${podeApontar() ? `<h3 style="margin:14px 0 6px">Consumo de matéria-prima</h3>
      <div class="small">${cons.map(c => `${qtd(c.quantidade)} — ${esc(PRODS.find(p => p.id === c.produto_id)?.descricao || c.codigo || '')}${c.lote ? ` · lote ${esc(c.lote)}` : ''}`).join('<br>') || '<span class="muted">Nenhum consumo apontado.</span>'}</div>
      <div class="grid-form" style="margin-top:6px"><label class="span2">Material<input id="oc-p" list="oc-dl">${datalistProdutos('oc-dl', PRODS.filter(p => p.tipo !== 'produto_acabado'))}</label>
        <label>Quantidade<input id="oc-q"></label><label>Lote / NF<input id="oc-l"></label><div style="align-self:end"><button class="btn small" id="oc-ok">+ Consumo</button></div></div>` : ''}`,
    foot: '<div id="op-ac" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;width:100%"></div>' });
  const ac = $('#op-ac', m.el), btn = (t, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = t; b.onclick = fn; ac.appendChild(b); };
  const reabrir = async () => { m.close(); await carregar(root); abrir(OPS.find(x => x.id === o.id), root); };
  const mudar = async (dados, msg) => { try { await q(sb.from('prod_ordens').update(dados).eq('id', o.id)); toast(msg); reabrir(); } catch (err) { fail(err); } };
  if (bob.length) btn('Etiquetas', 'ghost', () => imprimirEtiquetas(bob, o, (id) => C.maqById[id] ? `${C.maqById[id].codigo}` : ''));
  btn('Imprimir OP', 'ghost', () => imprimirOP(o, et, nec));
  if (pcp) {
    if (o.status === 'planejada') btn('Liberar para produção', 'primary', () => mudar({ status: 'liberada' }, 'OP liberada'));
    if (!['concluida', 'cancelada'].includes(o.status)) { btn('Cancelar OP', 'ghost', async () => { if (await confirmDialog(`Cancelar a OP ${o.numero}?`)) mudar({ status: 'cancelada' }, 'OP cancelada'); });
      btn('Concluir OP', 'primary', () => mudar({ status: 'concluida' }, 'OP concluída')); }
    else btn('Reabrir OP', '', () => mudar({ status: ap.length ? 'em_producao' : 'liberada' }, 'OP reaberta'));
  }
  $$('[data-ce]', m.el).forEach(b => b.onclick = async () => { try { await q(sb.from('prod_ordem_etapas').update({ status: 'concluida' }).eq('id', b.dataset.ce)); reabrir(); } catch (err) { fail(err); } });
  $$('[data-re]', m.el).forEach(b => b.onclick = async () => { try { await q(sb.from('prod_ordem_etapas').update({ status: 'em_andamento' }).eq('id', b.dataset.re)); reabrir(); } catch (err) { fail(err); } });
  $('#oe-ok', m.el) && ($('#oe-ok', m.el).onclick = async () => { try { await q(sb.from('prod_ordem_etapas').insert({ empresa_id: state.empresa.id, ordem_id: o.id, seq: (et[et.length - 1]?.seq || 0) + 1,
    setor_id: $('#oe-s', m.el).value, maquina_id: $('#oe-m', m.el).value || null, qtd_prevista: o.quantidade })); reabrir(); } catch (err) { fail(err); } });
  $('#on-req', m.el) && ($('#on-req', m.el).onclick = async () => {
    const it = nec.linhas.filter(l => l.falta > 0);
    if (!await confirmDialog(`Criar requisição de compra com ${it.length} material(is) em falta para a OP ${o.numero}?`)) return;
    try { const e = state.empresa.id;
      const r = await q(sb.from('compras_requisicoes').insert({ empresa_id: e, solicitante: 'PCP', necessidade: o.entrega ? new Date(new Date(o.entrega).getTime() - 7 * 864e5).toISOString().slice(0, 10) : null, observacao: `Materiais em falta para a OP ${o.numero}${o.numero_iniflex ? ' (Iniflex ' + o.numero_iniflex + ')' : ''}` }).select('id,numero').single());
      await q(sb.from('compras_requisicao_itens').insert(it.map(l => ({ empresa_id: e, requisicao_id: r.id, produto_id: l.produto.id, descricao: `${l.produto.codigo} — ${l.produto.descricao}`.slice(0, 200), unidade: l.produto.unidade || 'KG', quantidade: Math.ceil(l.falta * 100) / 100, ncm: l.produto.ncm || null }))));
      toast(`Requisição nº ${r.numero} criada`); } catch (err) { fail(err); }
  });
  $('#oc-ok', m.el) && ($('#oc-ok', m.el).onclick = async () => {
    const p = acharProduto($('#oc-p', m.el).value, PRODS); if (!p) return toast('Escolha o material da lista', true);
    const qv = num($('#oc-q', m.el).value); if (!(qv > 0)) return toast('Informe a quantidade', true);
    try { await q(sb.from('prod_consumos').insert({ empresa_id: state.empresa.id, ordem_id: o.id, produto_id: p.id, codigo: p.codigo, quantidade: qv, lote: $('#oc-l', m.el).value.trim() || null })); reabrir(); } catch (err) { fail(err); }
  });
}

async function imprimirOP(o, et, nec) {
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up', true);
  await abrirRelatorio({ janela: w, nome: `Ordem de produção OP ${o.numero}`, titulo: `Ordem de produção nº ${o.numero}`,
    subtitulo: o.numero_iniflex ? `Iniflex ${esc(o.numero_iniflex)}` : '',
    extraCss: 'table.prc td{height:22px;border-bottom:.4px solid #888} table.prc td+td{border-left:.25px solid #bbb}',
    corpo: `<h2>1. Produto e pedido</h2>
    <table class="info"><tr><td>Produto</td><td>${esc(o.codigo_produto || '')} ${esc(o.descricao || '')}</td></tr><tr><td>Quantidade</td><td>${qtd(o.quantidade)} ${esc(o.unidade)}</td></tr>
      <tr><td>Cliente</td><td>${esc(o.cliente || '')}</td></tr><tr><td>Pedido</td><td>${esc(o.pedido_iniflex || '')}</td></tr><tr><td>Entrega</td><td>${dateBR(o.entrega)}</td></tr><tr><td>Prioridade</td><td>${o.prioridade}</td></tr></table>
    <h2>2. Etapas (preencher na produção)</h2>
    <table class="prc"><thead><tr><th>#</th><th>Setor</th><th>Máquina</th><th>Início</th><th>Fim</th><th>Bom (kg)</th><th>Refugo (kg)</th><th>Operador</th></tr></thead><tbody>
    ${et.map(x => `<tr><td>${x.seq}</td><td>${esc(C.setorById[x.setor_id]?.nome || '')}</td><td>${esc(C.maqById[x.maquina_id]?.codigo || '')}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')}</tbody></table>
    ${nec.linhas?.length ? `<h2>3. Materiais</h2><table class="prc"><thead><tr><th>Material</th><th>Necessário</th><th>Lote</th><th>Consumido</th></tr></thead><tbody>${nec.linhas.map(l => `<tr><td>${esc(l.produto.codigo || '')} — ${esc(l.produto.descricao || '')}</td><td>${qtd(Math.round(l.necessario * 100) / 100)} ${esc(l.produto.unidade || '')}</td><td></td><td></td></tr>`).join('')}</tbody></table>` : ''}
    ${o.observacao ? `<p><b>Observação:</b> ${esc(o.observacao)}</p>` : ''}`,
    rodape: `Ordem de produção emitida pela plataforma · ${esc(state.empresa.nome || '')}` });
}

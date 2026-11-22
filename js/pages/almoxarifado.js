// Painéis › Requisição de Material (PAI015, SQL 176): qualquer pessoa pede material ao almoxarifado; aprovação só na exceção
// (item controlado ou valor acima do parâmetro); o almoxarife separa e entrega identificando quem retirou (crachá ou nome);
// retirada no balcão registrada na hora; a entrega dá saída no Kardex com o custo no centro de custo de quem recebeu.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, money, dateBR, today, exportXLSX, erroTela } from '../lib/ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { aoLer } from '../lib/leitura-ui.js';
import * as A from '../lib/almoxarifado.js';

export const title = 'Requisição de Material';
const menos = (iso, d) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
const ui = { aba: 'minhas', situacao: 'abertas', setor: '', busca: '', de: menos(today(), 60), ate: today() };
let D = null;
const PADRAO = { valor_aprovacao: null, papeis_almoxarife: ['admin', 'diretor', 'compras'], almoxarifes: [], papeis_aprovador: ['admin', 'diretor'], aprovadores: [], exigir_cracha: false, permitir_balcao: true, locais: null, aprovar_proprio: false };
const qtd = (v) => (v == null ? '' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: 4 }));
const quando = (t) => (t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' }) : '');
const badge = (s) => { const [t, c] = A.SIT[s] || [s, '']; return `<span class="badge ${c}">${t}</span>`; };
const rpc = (fn, args) => q(sb.rpc(fn, args));
const gerencia = () => ['admin', 'diretor'].includes(state.papel);

async function carregar() {
  const e = state.empresa.id;
  const [cfg, almox, aprov, abertas, periodo] = await Promise.all([
    q(sb.from('alm_config').select('*').eq('empresa_id', e).maybeSingle()), rpc('alm_almoxarife', { p_empresa: e }), rpc('alm_aprovador', { p_empresa: e }),
    q(sb.from('alm_requisicoes').select('*').eq('empresa_id', e).in('situacao', A.ABERTAS).order('numero', { ascending: false })),
    fetchAll(() => sb.from('alm_requisicoes').select('*').eq('empresa_id', e).gte('criado_em', ui.de + 'T00:00:00-03:00').lte('criado_em', ui.ate + 'T23:59:59-03:00').order('numero', { ascending: false }))]);
  const reqs = [...new Map([...abertas, ...periodo].map(r => [r.id, r])).values()].sort((a, b) => b.numero - a.numero);
  const ids = reqs.map(r => r.id); let itens = [], entregas = [];
  for (let i = 0; i < ids.length; i += 150) {
    const c = ids.slice(i, i + 150);
    const [a, b] = await Promise.all([q(sb.from('alm_requisicao_itens').select('*').in('requisicao_id', c)), q(sb.from('alm_entregas').select('*').in('requisicao_id', c).order('entregue_em'))]);
    itens.push(...a); entregas.push(...b);
  }
  for (const r of reqs) { r.itens = itens.filter(i => i.requisicao_id === r.id); r.entregas = entregas.filter(x => x.requisicao_id === r.id); }
  D = { cfg: { ...PADRAO, ...(cfg || {}) }, almox: !!almox, aprov: !!aprov, reqs, entregas, catalogo: null, pessoas: null };
}
const catalogo = async () => (D.catalogo = D.catalogo || await rpc('alm_catalogo', { p_empresa: state.empresa.id }));
const pessoas = async () => (D.pessoas = D.pessoas || await rpc('alm_pessoas', { p_empresa: state.empresa.id }));

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (err) {
    console.error(err);
    root.innerHTML = /alm_|does not exist|schema cache/.test(err?.message || '') ? '<div class="card"><span class="badge vencido">SQL 176 pendente</span> A requisição de material ainda não foi criada no banco.</div>' : erroTela('as requisições de material');
    return;
  }
  if (!['minhas', 'parametros'].includes(ui.aba) && !D.almox && !D.aprov) ui.aba = 'minhas';
  const ab = state.abrir?.tipo === 'balcao' ? state.abrir : null; if (ab) delete state.abrir;
  pintar(root);
  const id = /[?&]id=([0-9a-f-]{36})/.exec(location.hash)?.[1]; if (id) { const r = D.reqs.find(x => x.id === id); if (r) detalhe(r, root); }
  if (ab && D.almox) balcao(root, ab.cracha);
}
const recarregar = async (root) => { try { await carregar(); pintar(root); } catch (err) { fail(err); } };

function pintar(root) {
  const mes = today().slice(0, 7), R = A.resumo(D.reqs, D.entregas, mes), eu = state.user.id;
  const abas = [['minhas', 'Minhas requisições'], ...(D.almox ? [['atender', `Atender${R.entregar ? ' · ' + R.entregar : ''}`]] : []), ...(D.aprov ? [['aprovar', `Aprovar${R.aprovar ? ' · ' + R.aprovar : ''}`]] : []),
    ...(D.almox || D.aprov ? [['todas', 'Todas']] : []), ...(gerencia() ? [['parametros', 'Parâmetros']] : [])];
  const setores = [...new Set(D.reqs.map(r => r.setor).filter(Boolean))].sort();
  const vejoTudo = D.almox || D.aprov;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Requisição de Material</h2><div class="muted small">Peça o material ao almoxarifado por aqui. Toda retirada fica registrada: quem pediu, quem entregou, quem retirou, o quê e quando.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:nowrap;white-space:nowrap">${D.almox && D.cfg.permitir_balcao ? '<button class="btn" id="al-balcao">Retirada no balcão</button>' : ''}<button class="btn primary" id="al-novo">Nova requisição</button></div></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">${vejoTudo ? 'Aguardando entrega' : 'Minhas em andamento'}</div><div class="k-value ${vejoTudo && R.entregar ? 'warn' : ''}">${vejoTudo ? R.entregar : D.reqs.filter(r => A.ABERTAS.includes(r.situacao)).length}</div><div class="k-sub">${vejoTudo ? 'liberadas para o almoxarifado' : 'pedidas e ainda não concluídas'}</div></div>
      <div class="kpi"><div class="k-label">Aguardando aprovação</div><div class="k-value ${R.aprovar ? 'warn' : ''}">${R.aprovar}</div><div class="k-sub">item controlado ou acima do limite</div></div>
      <div class="kpi"><div class="k-label">Entregas no mês</div><div class="k-value">${R.entregasMes}</div><div class="k-sub">${R.balcaoMes} no balcão · ${R.comCracha} com crachá lido</div></div>
      ${vejoTudo ? `<div class="kpi"><div class="k-label">Valor entregue no mês</div><div class="k-value">${money(R.valorMes)}</div><div class="k-sub">ao custo médio do estoque</div></div>` : ''}
    </div>
    <div class="toolbar"><div class="chips" id="al-abas" data-rotulo="Aba">${abas.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      ${ui.aba === 'todas' ? `<label>De<input type="date" id="al-de" value="${ui.de}"></label><label>Até<input type="date" id="al-ate" value="${ui.ate}"></label>
        <label>Situação<select id="al-sit"><option value="">Todas</option><option value="abertas" ${ui.situacao === 'abertas' ? 'selected' : ''}>Em andamento</option>${Object.entries(A.SIT).map(([k, [t]]) => `<option value="${k}" ${ui.situacao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Setor<select id="al-set"><option value="">Todos</option>${setores.map(s => `<option ${ui.setor === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <input id="al-bus" placeholder="Nº, pessoa, item ou motivo" value="${esc(ui.busca)}" style="min-width:210px">
        <span class="spacer"></span><button class="btn ghost" id="al-xls">Excel</button><button class="btn" id="al-pdf">PDF</button>` : ''}</div>
    <div id="al-corpo"></div>`;
  $('#al-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(root); } };
  $('#al-novo', root).onclick = () => nova(root);
  $('#al-balcao', root) && ($('#al-balcao', root).onclick = () => balcao(root));
  if (ui.aba === 'todas') {
    $('#al-de', root).onchange = (e) => { if (e.target.value) { ui.de = e.target.value; recarregar(root); } };
    $('#al-ate', root).onchange = (e) => { if (e.target.value) { ui.ate = e.target.value; recarregar(root); } };
    $('#al-sit', root).onchange = (e) => { ui.situacao = e.target.value; pintar(root); };
    $('#al-set', root).onchange = (e) => { ui.setor = e.target.value; pintar(root); };
    let t; $('#al-bus', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.busca = e.target.value; lista(root); }, 250); };
    $('#al-xls', root).onclick = () => { const tb = $('#al-corpo table', root); if (tb) exportXLSX(tb, 'requisicoes_material'); };
    $('#al-pdf', root).onclick = () => relatorio();
  }
  if (ui.aba === 'parametros') return parametros(root);
  lista(root);
}

const daAba = () => ui.aba === 'minhas' ? D.reqs.filter(r => r.solicitante_id === state.user.id || !(D.almox || D.aprov))
  : ui.aba === 'atender' ? D.reqs.filter(r => r.situacao === 'aberta' || r.situacao === 'parcial').sort((a, b) => a.numero - b.numero)
  : ui.aba === 'aprovar' ? D.reqs.filter(r => r.situacao === 'aprovacao').sort((a, b) => a.numero - b.numero)
  : A.filtrar(D.reqs, ui);

function lista(root) {
  const L = daAba(), c = $('#al-corpo', root), valor = (r) => r.entregas.reduce((t, e) => t + (+e.valor || 0), 0), verValor = D.almox || D.aprov;
  const vazio = { minhas: 'Você ainda não pediu material. Clique em Nova requisição.', atender: 'Nenhuma requisição aguardando entrega.', aprovar: 'Nenhuma requisição aguardando aprovação.', todas: 'Nenhuma requisição neste filtro.' }[ui.aba];
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:62vh"><table><thead><tr><th class="num">Nº</th><th>Pedida em</th><th>Para quem</th><th>Setor</th><th>Itens</th><th>Situação</th>${verValor ? '<th class="num">Valor entregue</th>' : ''}<th></th></tr></thead><tbody>
    ${L.slice(0, 800).map(r => `<tr class="clickable" data-id="${r.id}"><td class="num">${r.numero}</td><td>${quando(r.criado_em)}</td><td>${esc(r.para_nome || '')}${r.origem === 'balcao' ? ' <span class="badge">balcão</span>' : ''}</td><td>${esc(r.setor || '')}</td>
      <td class="wrap small">${esc(r.itens.map(i => `${qtd(i.quantidade)} ${i.unidade || ''} ${i.descricao}`).join(' · '))}</td><td>${badge(r.situacao)}${r.situacao === 'aprovacao' && r.motivo_aprovacao ? `<div class="small muted wrap">${esc(r.motivo_aprovacao)}</div>` : ''}</td>
      ${verValor ? `<td class="num">${r.entregas.length ? money(valor(r)) : ''}</td>` : ''}
      <td style="white-space:nowrap">${ui.aba === 'atender' ? '<button class="btn small primary" data-ent>Entregar</button>' : ui.aba === 'aprovar' ? '<button class="btn small primary" data-apr>Aprovar</button> <button class="btn small" data-rec>Recusar</button>' : ''}</td></tr>`).join('')
      || `<tr><td colspan="${verValor ? 8 : 7}" class="empty">${vazio}</td></tr>`}</tbody></table></div></div>
    <p class="small muted">${L.length} requisição(ões)${ui.aba === 'todas' ? ' · em andamento aparecem sempre; as concluídas, só as do período.' : ''}</p>`;
  $$('tr[data-id]', c).forEach(tr => tr.onclick = (e) => { const r = D.reqs.find(x => x.id === tr.dataset.id);
    if (e.target.closest('[data-ent]')) return entregar(r, root); if (e.target.closest('[data-apr]')) return decidir(r, true, root); if (e.target.closest('[data-rec]')) return decidir(r, false, root); detalhe(r, root); });
}

/* ------------------------------------------------------------------ escolher itens do catálogo (nova requisição e balcão) */
function quadroItens(m, cat, sel, { saldo = true } = {}) {
  const c = $('#ni-cat', m.el);
  const pinta = () => { const b = $('#ni-bus', m.el).value.trim().toLowerCase(), L = cat.filter(p => !b || `${p.codigo} ${p.descricao} ${p.etiqueta || ''}`.toLowerCase().includes(b)).slice(0, 80);
    c.innerHTML = L.map(p => `<tr><td>${esc(p.codigo)}</td><td class="wrap">${esc(p.descricao)}${p.controlado ? ' <span class="badge warn" title="Pede aprovação">controlado</span>' : ''}</td>${saldo ? `<td class="num ${+p.saldo > 0 ? '' : 'neg'}">${qtd(p.saldo)} ${esc(p.unidade || '')}</td>` : ''}
      <td style="width:120px"><input inputmode="decimal" data-p="${p.produto_id}" value="${sel.has(p.produto_id) ? qtd(sel.get(p.produto_id)) : ''}" placeholder="quantidade"></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum item com esse nome. Se o material não está no catálogo, peça ao almoxarifado para cadastrá-lo.</td></tr>';
    $$('input[data-p]', c).forEach(i => i.oninput = () => { const v = A.qtdBR(i.value); if (v > 0) sel.set(i.dataset.p, v); else sel.delete(i.dataset.p); resumo(); }); };
  const resumo = () => { $('#ni-sel', m.el).innerHTML = sel.size ? `<b>${sel.size} item(ns):</b> ` + [...sel].map(([id, v]) => { const p = cat.find(x => x.produto_id === id); return `${qtd(v)} ${esc(p?.unidade || '')} ${esc(p?.descricao || '')}`; }).join(' · ') : '<span class="muted">Nenhum item escolhido ainda.</span>'; };
  let t; $('#ni-bus', m.el).oninput = () => { clearTimeout(t); t = setTimeout(pinta, 150); };
  pinta(); resumo();
  return { incluir: (id) => { if (!sel.has(id)) sel.set(id, 1); $('#ni-bus', m.el).value = ''; pinta(); resumo(); } };
}
const corpoItens = (saldo = true) => `<input id="ni-bus" placeholder="Procurar item pelo nome ou código" style="width:100%;margin-bottom:8px">
  <div class="table-wrap" style="max-height:34vh"><table><thead><tr><th>Código</th><th>Item</th>${saldo ? '<th class="num">Disponível</th>' : ''}<th>Quantidade</th></tr></thead><tbody id="ni-cat"></tbody></table></div>
  <p class="small" id="ni-sel" style="margin:10px 0 0"></p>`;

async function nova(root) {
  let cat, P = [];
  try { cat = await catalogo(); if (D.almox) P = await pessoas(); } catch (err) { return fail(err); }
  if (!cat.length) return toast('O almoxarifado ainda não tem itens no catálogo. Os itens aparecem quando o produto é cadastrado com local de entrada no almoxarifado.', true);
  const sel = new Map();
  const m = modal({ title: 'Nova requisição de material', wide: true, body: `${corpoItens()}
    <div class="grid-form" style="margin-top:12px">
      ${D.almox ? `<label>Para quem (em branco = para você)<input id="ni-para" list="ni-pessoas" placeholder="nome do colaborador"><datalist id="ni-pessoas">${P.map(p => `<option value="${esc(p.nome)}">${esc(p.setor || '')}</option>`).join('')}</datalist></label>` : ''}
      <label class="span2">Para que é (motivo)<input id="ni-mot" maxlength="500" placeholder="ex.: reposição do administrativo"></label></div>
    <p class="small muted">Item controlado${D.cfg.valor_aprovacao != null ? ` ou pedido acima de ${money(D.cfg.valor_aprovacao)}` : ''} passa por aprovação antes de ser separado. O resto vai direto para o almoxarifado.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ni-ok">Enviar requisição</button>' });
  quadroItens(m, cat, sel);
  $('#ni-ok', m.el).onclick = async (ev) => {
    if (!sel.size) return toast('Escolha pelo menos um item e informe a quantidade', true);
    const nome = $('#ni-para', m.el)?.value.trim() || '', pes = nome ? P.find(p => p.nome.toLowerCase() === nome.toLowerCase()) : null;
    ev.target.disabled = true;
    try {
      const r = await rpc('alm_requisitar', { p_empresa: state.empresa.id, p_itens: [...sel].map(([produto_id, quantidade]) => ({ produto_id, quantidade })), p_motivo: $('#ni-mot', m.el).value.trim() || null, p_colaborador: pes?.colaborador_id || null, p_para_nome: pes ? null : nome || null });
      toast(r.situacao === 'aprovacao' ? `Requisição nº ${r.numero} enviada para aprovação (${r.motivo_aprovacao})` : `Requisição nº ${r.numero} enviada ao almoxarifado`);
      m.close(); ui.aba = 'minhas'; await recarregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

/* ------------------------------------------------------------------ quem retira: crachá lido, pessoa da lista ou nome digitado */
function blocoQuem(P) {
  return `<div class="grid-form" style="margin-top:12px"><label class="span2">Quem está retirando<input id="qr-nome" list="qr-pessoas" autocomplete="off" placeholder="Leia o crachá ou escolha a pessoa">
      <datalist id="qr-pessoas">${P.map(p => `<option value="${esc(p.nome)}">${esc([p.matricula, p.setor].filter(Boolean).join(' · '))}</option>`).join('')}</datalist></label>
    <div id="qr-info" class="small" style="align-self:end;padding-bottom:10px"></div></div>`;
}
function ligarQuem(m, P, crachaInicial) {
  const st = { colaborador_id: null, nome: '', cracha: false, codigo: null }, inp = $('#qr-nome', m.el), info = $('#qr-info', m.el);
  const mostra = () => { info.innerHTML = st.cracha ? '<span class="badge pago">crachá lido</span>' : st.colaborador_id ? '<span class="muted">colaborador da lista</span>' : st.nome ? '<span class="warn">nome digitado, sem cadastro</span>' : D.cfg.exigir_cracha ? '<span class="warn">a entrega exige o crachá</span>' : ''; };
  const pelaLista = () => { const v = inp.value.trim(), p = P.find(x => x.nome.toLowerCase() === v.toLowerCase()); st.colaborador_id = p?.colaborador_id || null; st.nome = v; st.cracha = false; st.codigo = null; mostra(); };
  const cracha = async (codigo) => {
    try { const r = await rpc('alm_cracha', { p_empresa: state.empresa.id, p_codigo: codigo });
      if (!r?.achou) return toast('Crachá não encontrado nesta empresa', true);
      if (!r.valido) return toast(`Crachá de ${r.nome}: ${r.situacao}. Não vale para retirada.`, true);
      st.colaborador_id = r.colaborador_id || null; st.nome = r.nome; st.cracha = true; st.codigo = codigo; inp.value = r.nome; mostra(); toast(`Crachá lido: ${r.nome}`);
    } catch (err) { fail(err); }
  };
  inp.oninput = () => { const c = A.codigoCracha(inp.value); if (c) { inp.value = ''; cracha(c); } else pelaLista(); };
  aoLer('cracha', (r) => { cracha(r.codigo); }, m.el);   // crachá lido com o leitor enquanto esta janela está aberta
  mostra(); if (crachaInicial) cracha(crachaInicial);
  return st;
}

/* ------------------------------------------------------------------ entregar */
async function entregar(r, root) {
  let S, P;
  try { [S, P] = await Promise.all([rpc('alm_saldos', { p_empresa: state.empresa.id, p_produtos: r.itens.map(i => i.produto_id) }), pessoas()]); } catch (err) { return fail(err); }
  const L = A.sugerirEntrega(r.itens, S);
  const m = modal({ title: `Entregar a requisição nº ${r.numero} — ${r.para_nome || ''}`, wide: true, body: `
    <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Falta entregar</th><th>Sai de</th><th style="width:130px">Entregar agora</th></tr></thead><tbody>
    ${L.map((l, i) => `<tr><td class="wrap"><b>${esc(l.codigo)}</b> ${esc(l.descricao)}</td><td class="num">${qtd(l.falta)} ${esc(l.unidade || '')}</td>
      <td>${l.semSaldo ? '<span class="neg">sem saldo no almoxarifado</span>' : `<select data-l="${i}">${l.locais.map(s => `<option value="${s.local_id}" data-q="${s.quantidade}">${esc(s.local_nome)} (${qtd(s.quantidade)})</option>`).join('')}</select>`}</td>
      <td><input inputmode="decimal" data-q="${i}" value="${l.quantidade ? qtd(l.quantidade) : ''}" ${l.semSaldo ? 'disabled' : ''}></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Sem saldo para tudo? Entregue o que tem: a requisição fica "entregue em parte" e o restante continua na fila.</p>
    ${blocoQuem(P)}
    <div class="grid-form" style="margin-top:8px"><label class="span2">Observação<input id="en-obs" maxlength="300"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="en-ok">Registrar a entrega</button>' });
  const quem = ligarQuem(m, P);
  $('#en-ok', m.el).onclick = async (ev) => {
    const linhas = L.map((l, i) => { const s = $(`[data-l="${i}"]`, m.el), v = $(`[data-q="${i}"]`, m.el).value.trim(); return { ...l, quantidade: v === '' ? 0 : A.qtdBR(v), local_id: s?.value || '', saldoLocal: s ? +s.selectedOptions[0].dataset.q : null }; });
    const erros = A.conferirEntrega(linhas, { quem: quem.nome, exigirCracha: D.cfg.exigir_cracha, crachaLido: quem.cracha });
    if (erros.length) return toast(erros[0], true);
    ev.target.disabled = true;
    try {
      const x = await rpc('alm_entregar', { p_id: r.id, p_itens: linhas.filter(l => l.quantidade > 0).map(l => ({ item_id: l.item_id, quantidade: l.quantidade, local_id: l.local_id })),
        p_retirou: quem.colaborador_id, p_retirou_nome: quem.colaborador_id ? null : quem.nome, p_cracha: quem.cracha, p_obs: $('#en-obs', m.el).value.trim() || null, p_cracha_codigo: quem.cracha ? quem.codigo : null });
      toast(x.situacao === 'atendida' ? `Requisição nº ${r.numero} entregue` : `Requisição nº ${r.numero} entregue em parte`); m.close(); await recarregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

/* ------------------------------------------------------------------ balcão: pede e entrega na mesma hora */
async function balcao(root, crachaInicial = null) {
  let cat, P;
  try { [cat, P] = await Promise.all([catalogo(), pessoas()]); } catch (err) { return fail(err); }
  if (!cat.length) return toast('O almoxarifado ainda não tem itens no catálogo.', true);
  const sel = new Map();
  const m = modal({ title: 'Retirada no balcão', wide: true, body: `<p class="small muted" style="margin-top:0">Para quem chegou sem pedido. Leia a etiqueta do item (ou procure pelo nome), informe a quantidade e identifique quem está retirando. A saída é lançada na hora.</p>
    ${corpoItens()}${blocoQuem(P)}<div class="grid-form" style="margin-top:8px"><label class="span2">Para que é (motivo)<input id="ba-mot" maxlength="500"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ba-ok">Registrar a retirada</button>' });
  const itens = quadroItens(m, cat, sel), quem = ligarQuem(m, P, crachaInicial);
  aoLer('etiqueta', (r) => { const p = cat.find(x => x.etiqueta === r.codigo); if (!p) return toast(`Etiqueta ${r.codigo}: não é item do catálogo do almoxarifado`, true); itens.incluir(p.produto_id); toast(`${p.descricao} incluído`); }, m.el);
  $('#ba-ok', m.el).onclick = async (ev) => {
    if (!sel.size) return toast('Escolha pelo menos um item e informe a quantidade', true);
    if (!quem.nome) return toast('Identifique quem está retirando (leia o crachá ou escolha a pessoa)', true);
    if (D.cfg.exigir_cracha && !quem.cracha) return toast('A entrega exige a leitura do crachá de quem retira', true);
    ev.target.disabled = true;
    try {
      const S = await rpc('alm_saldos', { p_empresa: state.empresa.id, p_produtos: [...sel.keys()] }); const env = [];
      for (const [id, v] of sel) { const p = cat.find(x => x.produto_id === id), loc = S.filter(s => s.produto_id === id).sort((a, b) => b.quantidade - a.quantidade)[0];
        if (!loc || +loc.quantidade < v - 1e-9) { ev.target.disabled = false; return toast(`${p.descricao}: saldo insuficiente (${loc ? qtd(loc.quantidade) + ' em ' + loc.local_nome : 'sem saldo'}).`, true); }
        env.push({ produto_id: id, quantidade: v, local_id: loc.local_id }); }
      const x = await rpc('alm_balcao', { p_empresa: state.empresa.id, p_itens: env, p_retirou: quem.colaborador_id, p_retirou_nome: quem.colaborador_id ? null : quem.nome, p_cracha: quem.cracha, p_motivo: $('#ba-mot', m.el).value.trim() || null, p_cracha_codigo: quem.cracha ? quem.codigo : null });
      toast(x.entregue ? `Retirada nº ${x.numero} registrada para ${quem.nome}` : `Requisição nº ${x.numero} ficou aguardando aprovação (${x.motivo_aprovacao}). Nada foi entregue.`, !x.entregue);
      m.close(); await recarregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

/* ------------------------------------------------------------------ aprovar, recusar, cancelar */
async function decidir(r, aprova, root) {
  if (aprova) { if (!await confirmDialog(`Aprovar a requisição nº ${r.numero} de ${r.para_nome || ''}?\n${r.motivo_aprovacao || ''}`)) return;
    try { await rpc('alm_decidir', { p_id: r.id, p_aprova: true, p_motivo: null }); toast('Requisição aprovada'); await recarregar(root); } catch (err) { fail(err); } return; }
  motivo(`Recusar a requisição nº ${r.numero}`, 'Motivo da recusa', async (t) => { await rpc('alm_decidir', { p_id: r.id, p_aprova: false, p_motivo: t }); toast('Requisição recusada'); await recarregar(root); });
}
function motivo(titulo, rotulo, fn, obrigatorio = true) {
  const m = modal({ title: titulo, narrow: true, body: `<label>${rotulo}<textarea id="mo-t" rows="3" maxlength="300"></textarea></label>`, foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="mo-ok">Confirmar</button>' });
  $('#mo-ok', m.el).onclick = async (ev) => { const t = $('#mo-t', m.el).value.trim(); if (obrigatorio && t.length < 3) return toast('Escreva o motivo', true);
    ev.target.disabled = true; try { await fn(t || null); m.close(); } catch (err) { fail(err); ev.target.disabled = false; } };
}

/* ------------------------------------------------------------------ ficha da requisição */
function detalhe(r, root) {
  const eu = r.solicitante_id === state.user.id, aberta = A.ABERTAS.includes(r.situacao), verValor = D.almox || D.aprov;
  const podeCancelar = aberta && (D.almox || (eu && r.situacao !== 'parcial'));
  const m = modal({ title: `Requisição nº ${r.numero}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Situação</span><div>${badge(r.situacao)}${r.origem === 'balcao' ? ' <span class="badge">balcão</span>' : ''}</div></div>
      <div><span class="muted">Para quem</span><div><b>${esc(r.para_nome || '')}</b>${r.setor ? ' · ' + esc(r.setor) : ''}</div></div>
      <div><span class="muted">Pedida por</span><div>${esc(r.solicitante_nome || '')} · ${quando(r.criado_em)}</div></div>
      ${r.motivo ? `<div class="full" style="grid-column:1/-1"><span class="muted">Motivo</span><div>${esc(r.motivo)}</div></div>` : ''}
      ${r.motivo_aprovacao ? `<div class="full" style="grid-column:1/-1"><span class="muted">Aprovação</span><div>${esc(r.motivo_aprovacao)}${r.decidido_em ? ` — ${r.situacao === 'recusada' ? 'recusada' : 'aprovada'} por ${esc(r.decidido_nome || '')} em ${quando(r.decidido_em)}${r.decisao_motivo ? ': ' + esc(r.decisao_motivo) : ''}` : ''}</div></div>` : ''}
      ${r.encerrado_motivo ? `<div class="full" style="grid-column:1/-1"><span class="muted">Encerramento</span><div>${esc(r.encerrado_motivo)}</div></div>` : ''}
    </div>
    <h3 style="margin:14px 0 6px">Itens</h3>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Item</th><th class="num">Pedido</th><th class="num">Entregue</th><th class="num">Falta</th></tr></thead><tbody>
    ${r.itens.map(i => `<tr><td>${esc(i.codigo)}</td><td class="wrap">${esc(i.descricao)}${i.controlado ? ' <span class="badge warn">controlado</span>' : ''}${i.observacao ? `<div class="small muted">${esc(i.observacao)}</div>` : ''}</td>
      <td class="num">${qtd(i.quantidade)} ${esc(i.unidade || '')}</td><td class="num">${qtd(i.qtd_entregue)}</td><td class="num ${A.pendente(i) ? 'warn' : ''}">${qtd(A.pendente(i))}</td></tr>`).join('')}</tbody></table></div>
    <h3 style="margin:14px 0 6px">Entregas</h3>
    ${r.entregas.length ? `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Entregue por</th><th>Retirado por</th><th>Identificação</th>${verValor ? '<th class="num">Valor</th>' : ''}<th>Observação</th></tr></thead><tbody>
      ${r.entregas.map(e => `<tr><td>${quando(e.entregue_em)}</td><td>${esc(e.entregue_nome || '')}</td><td><b>${esc(e.retirou_nome)}</b>${e.estornada_em ? ' <span class="badge vencido">estornada</span>' : ''}</td><td>${e.cracha_lido ? '<span class="badge pago">crachá lido</span>' : e.retirou_colaborador_id ? 'colaborador da lista' : '<span class="warn">nome digitado</span>'}</td>
        ${verValor ? `<td class="num">${money(e.valor)}</td>` : ''}<td class="wrap small">${esc(e.observacao || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">Nada foi entregue ainda.</p>'}`,
    foot: `${podeCancelar ? `<button class="btn danger" id="de-can">${r.situacao === 'parcial' ? 'Encerrar o que falta' : 'Cancelar'}</button>` : ''}${r.entregas.length ? '<button class="btn" id="de-imp">Comprovante</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Fechar</button>
      ${D.aprov && r.situacao === 'aprovacao' ? '<button class="btn" id="de-rec">Recusar</button><button class="btn primary" id="de-apr">Aprovar</button>' : ''}${D.almox && ['aberta', 'parcial'].includes(r.situacao) ? '<button class="btn primary" id="de-ent">Entregar</button>' : ''}` });
  const acao = (id, fn) => $(id, m.el) && ($(id, m.el).onclick = () => { m.close(); fn(); });
  acao('#de-ent', () => entregar(r, root)); acao('#de-apr', () => decidir(r, true, root)); acao('#de-rec', () => decidir(r, false, root));
  acao('#de-can', () => motivo(r.situacao === 'parcial' ? `Encerrar a requisição nº ${r.numero} sem entregar o restante` : `Cancelar a requisição nº ${r.numero}`, 'Motivo', async (t) => { await rpc('alm_cancelar', { p_id: r.id, p_motivo: t }); toast('Requisição encerrada'); await recarregar(root); }, !eu));
  $('#de-imp', m.el) && ($('#de-imp', m.el).onclick = () => comprovante(r));
}

function comprovante(r) {
  abrirRelatorio({ rel: 'Comprovante de entrega de material', tipo: 'documento', nome: `Comprovante de entrega – requisição ${r.numero}`, titulo: `Comprovante de entrega de material nº ${r.numero}`, subtitulo: `${esc(r.para_nome || '')}${r.setor ? ' · ' + esc(r.setor) : ''}`,
    rodape: 'Fonte: Painéis › Requisição de Material.',
    corpo: `<h2>1. Requisição</h2><table class="info"><tbody><tr><td>Pedida por</td><td>${esc(r.solicitante_nome || '')} em ${quando(r.criado_em)}${r.origem === 'balcao' ? ' (retirada no balcão)' : ''}</td></tr>
        <tr><td>Para</td><td>${esc(r.para_nome || '')}${r.setor ? ' · ' + esc(r.setor) : ''}</td></tr>${r.motivo ? `<tr><td>Motivo</td><td>${esc(r.motivo)}</td></tr>` : ''}
        ${r.decidido_em ? `<tr><td>Aprovação</td><td>${esc(r.decidido_nome || '')} em ${quando(r.decidido_em)}</td></tr>` : ''}</tbody></table>
      <h2>2. Itens</h2><table><thead><tr><th>Código</th><th>Item</th><th class="n">Pedido</th><th class="n">Entregue</th><th class="n">Falta</th></tr></thead><tbody>
        ${r.itens.map(i => `<tr><td>${esc(i.codigo)}</td><td>${esc(i.descricao)}</td><td class="n">${qtd(i.quantidade)} ${esc(i.unidade || '')}</td><td class="n">${qtd(i.qtd_entregue)}</td><td class="n">${qtd(A.pendente(i))}</td></tr>`).join('')}</tbody></table>
      <h2>3. Entregas</h2><table><thead><tr><th>Data e hora</th><th>Entregue por</th><th>Retirado por</th><th>Identificação</th></tr></thead><tbody>
        ${r.entregas.map(e => `<tr><td>${quando(e.entregue_em)}</td><td>${esc(e.entregue_nome || '')}</td><td>${esc(e.retirou_nome)}${e.estornada_em ? ' (estornada)' : ''}</td><td>${e.cracha_lido ? 'Crachá lido' : e.retirou_colaborador_id ? 'Colaborador da lista' : 'Nome digitado'}</td></tr>`).join('')}</tbody></table>
      <div class="ass"><div>Almoxarifado</div><div>Quem retirou</div></div>` });
}

function relatorio() {
  const L = A.filtrar(D.reqs, ui), ids = new Set(L.map(r => r.id)), E = D.entregas.filter(e => ids.has(e.requisicao_id)), C = A.consumoPorSetor(L, E), tot = C.reduce((t, x) => t + x.valor, 0);
  abrirRelatorio({ nome: 'Requisições de material', titulo: 'Requisições de material ao almoxarifado', subtitulo: `Pedidas de ${dateBR(ui.de)} a ${dateBR(ui.ate)}`, paisagem: true, tipo: 'relatorio', rodape: 'Fonte: Painéis › Requisição de Material. Valor ao custo médio do estoque.',
    corpo: `<h2>1. Consumo por setor</h2><table><thead><tr><th>Setor</th><th class="n">Requisições com entrega</th><th class="n">Valor entregue (R$)</th><th class="n">% do valor</th></tr></thead><tbody>
        ${C.map(x => `<tr><td>${esc(x.setor)}</td><td class="n">${x.requisicoes}</td><td class="n">${money(x.valor)}</td><td class="n">${tot ? (100 * x.valor / tot).toFixed(1).replace('.', ',') : '0,0'}%</td></tr>`).join('')}
        <tr class="tot"><td>Total</td><td class="n">${C.reduce((t, x) => t + x.requisicoes, 0)}</td><td class="n">${money(tot)}</td><td class="n">${tot ? '100,0%' : ''}</td></tr></tbody></table>
      <h2>2. Requisições</h2><table><thead><tr><th class="n">Nº</th><th>Pedida em</th><th>Para quem</th><th>Setor</th><th>Itens</th><th>Situação</th><th>Retirado por</th><th class="n">Valor (R$)</th></tr></thead><tbody>
        ${L.map(r => `<tr><td class="n">${r.numero}</td><td>${quando(r.criado_em)}</td><td>${esc(r.para_nome || '')}${r.origem === 'balcao' ? ' (balcão)' : ''}</td><td>${esc(r.setor || '')}</td><td>${esc(r.itens.map(i => `${qtd(i.quantidade)} ${i.unidade || ''} ${i.descricao}`).join('; '))}</td>
          <td>${A.SIT[r.situacao]?.[0] || r.situacao}</td><td>${esc([...new Set(r.entregas.map(e => e.retirou_nome))].join(', '))}</td><td class="n">${r.entregas.length ? money(r.entregas.reduce((t, e) => t + (+e.valor || 0), 0)) : ''}</td></tr>`).join('')}
        <tr class="tot"><td colspan="7">${L.length} requisição(ões)</td><td class="n">${money(tot)}</td></tr></tbody></table>` });
}

/* ------------------------------------------------------------------ parâmetros */
async function parametros(root) {
  const c = $('#al-corpo', root); c.innerHTML = '<div class="loading">Carregando…</div>';
  let U, LOC, cat;
  try { [U, LOC, cat] = await Promise.all([rpc('alm_usuarios', { p_empresa: state.empresa.id }), q(sb.from('est_locais').select('id,codigo,nome,finalidade,ativo,ordem').eq('empresa_id', state.empresa.id).eq('ativo', true).order('ordem')), catalogo()]); } catch (err) { c.innerHTML = ''; return fail(err); }
  const g = D.cfg, padraoLocal = (l) => ['insumo', 'manutencao', 'uso_consumo'].includes(l.finalidade);
  const caixas = (id, marc) => Object.entries(A.PAPEIS).map(([k, t]) => `<label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin:0 16px 6px 0"><input type="checkbox" style="width:auto;margin:0" data-${id}="${k}" ${marc.includes(k) ? 'checked' : ''}> ${t}</label>`).join('');
  const gente = (id, marc) => `<select id="${id}" multiple size="5" style="min-width:260px">${U.map(u => `<option value="${u.user_id}" ${marc.includes(u.user_id) ? 'selected' : ''}>${esc(u.nome)} (${A.PAPEIS[u.papel] || u.papel})</option>`).join('')}</select>`;
  c.innerHTML = `<div class="card" style="max-width:980px"><h2 style="margin-top:0">Parâmetros do almoxarifado</h2>
    <div class="grid-form">
      <label>Pedido acima de (R$) pede aprovação<input id="pa-valor" inputmode="decimal" value="${g.valor_aprovacao != null ? qtd(g.valor_aprovacao) : ''}" placeholder="em branco = sem regra de valor"></label>
      <label style="display:flex;flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:10px"><input type="checkbox" id="pa-cracha" style="width:auto;margin:0" ${g.exigir_cracha ? 'checked' : ''}> Entrega só com o crachá lido</label>
      <label style="display:flex;flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:10px"><input type="checkbox" id="pa-balcao" style="width:auto;margin:0" ${g.permitir_balcao ? 'checked' : ''}> Permitir retirada no balcão, sem pedido prévio</label>
      <label style="display:flex;flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:10px"><input type="checkbox" id="pa-proprio" style="width:auto;margin:0" ${g.aprovar_proprio ? 'checked' : ''}> Quem pediu pode aprovar a própria requisição (exceção)</label>
    </div>
    <fieldset style="margin-top:12px"><legend>Quem atende e entrega (almoxarife)</legend><div>${caixas('alx', g.papeis_almoxarife)}</div>
      <div class="small muted" style="margin:8px 0 4px">Pessoas a mais, de qualquer perfil (segure Ctrl para marcar várias):</div>${gente('pa-alx-p', g.almoxarifes)}</fieldset>
    <fieldset style="margin-top:12px"><legend>Quem aprova</legend><div>${caixas('apr', g.papeis_aprovador)}</div>
      <div class="small muted" style="margin:8px 0 4px">Pessoas a mais, de qualquer perfil:</div>${gente('pa-apr-p', g.aprovadores)}</fieldset>
    <fieldset style="margin-top:12px"><legend>Locais do almoxarifado</legend><div>${LOC.map(l => `<label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin:0 16px 6px 0"><input type="checkbox" style="width:auto;margin:0" data-loc="${l.id}" ${(g.locais ? g.locais.includes(l.id) : padraoLocal(l)) ? 'checked' : ''}> ${esc(l.nome)}</label>`).join('')}</div>
      <div class="small muted" style="margin-top:6px">O catálogo mostra o que tem saldo nesses locais, ou cujo local de entrada é um deles. Quem entrega precisa poder movimentar o local (Estoque › Parâmetros › Locais).</div></fieldset>
    <div style="margin-top:14px"><button class="btn primary" id="pa-ok">Salvar</button></div></div>
    <div class="card flush" style="max-width:980px;margin-top:16px"><div style="padding:14px 16px 0"><h2 style="margin:0">Itens controlados</h2><div class="small muted">Item controlado sempre passa por aprovação, em qualquer quantidade.</div>
      <input id="pa-bus" placeholder="Procurar item" style="margin:10px 0;min-width:280px"></div>
      <div class="table-wrap" style="max-height:44vh"><table><thead><tr><th>Código</th><th>Item</th><th class="num">Saldo</th><th>Controlado</th></tr></thead><tbody id="pa-itens"></tbody></table></div></div>`;
  const pintaItens = () => { const b = $('#pa-bus', c).value.trim().toLowerCase();
    $('#pa-itens', c).innerHTML = cat.filter(p => !b || `${p.codigo} ${p.descricao}`.toLowerCase().includes(b)).slice(0, 200).map(p => `<tr><td>${esc(p.codigo)}</td><td class="wrap">${esc(p.descricao)}</td><td class="num">${qtd(p.saldo)} ${esc(p.unidade || '')}</td>
      <td><label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin:0 16px 6px 0"><input type="checkbox" style="width:auto;margin:0" data-ctl="${p.produto_id}" ${p.controlado ? 'checked' : ''}> pede aprovação</label></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum item no catálogo.</td></tr>';
    $$('[data-ctl]', c).forEach(i => i.onchange = async () => { try { await rpc('alm_controlar', { p_empresa: state.empresa.id, p_produto: i.dataset.ctl, p_sim: i.checked }); cat.find(p => p.produto_id === i.dataset.ctl).controlado = i.checked; toast(i.checked ? 'Item marcado como controlado' : 'Item liberado'); } catch (err) { fail(err); i.checked = !i.checked; } }); };
  $('#pa-bus', c).oninput = pintaItens; pintaItens();
  $('#pa-ok', c).onclick = async (ev) => {
    const vt = $('#pa-valor', c).value.trim(), valor = vt === '' ? null : A.qtdBR(vt); if (vt !== '' && Number.isNaN(valor)) return toast('Valor inválido', true);
    const marc = (a) => $$(`[data-${a}]`, c).filter(i => i.checked).map(i => i.dataset[a]), sel = (id) => [...$(id, c).selectedOptions].map(o => o.value);
    const locs = marc('loc'), padrao = LOC.filter(padraoLocal).map(l => l.id), igual = locs.length === padrao.length && locs.every(x => padrao.includes(x));
    if (!locs.length) return toast('Marque pelo menos um local do almoxarifado', true);
    if (!marc('alx').length && !sel('#pa-alx-p').length) return toast('Marque quem atende o almoxarifado', true);
    if (!marc('apr').length && !sel('#pa-apr-p').length) return toast('Marque quem aprova', true);
    ev.target.disabled = true;
    try { await rpc('alm_config_salvar', { p_empresa: state.empresa.id, p_valor: valor, p_papeis_almoxarife: marc('alx'), p_almoxarifes: sel('#pa-alx-p'), p_papeis_aprovador: marc('apr'), p_aprovadores: sel('#pa-apr-p'),
        p_cracha: $('#pa-cracha', c).checked, p_balcao: $('#pa-balcao', c).checked, p_locais: igual ? null : locs, p_aprovar_proprio: $('#pa-proprio', c).checked });
      toast('Parâmetros salvos'); D.catalogo = null; await recarregar(root); } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

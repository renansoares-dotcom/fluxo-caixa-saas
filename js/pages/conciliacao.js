// Conciliação bancária: importa o extrato OFX, sugere os vínculos com os lançamentos e registra a conciliação.
// Extrato à esquerda, lançamentos do sistema à direita (mesmo padrão das propostas de borderô).
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, esc, money, cls, dateBR, options, fail, toast, modal } from '../lib/ui.js';
import { abrirLancamento } from '../lib/lanc-form.js';
import { lerOFX, decodificarOFX } from '../lib/ofx.js';
import { normTxt } from '../lib/nf-titulos.js';

export const title = 'Conciliação bancária';

const hoje = new Date();
const mesAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
const ui = { conta: '', mes: `${mesAnt.getFullYear()}-${String(mesAnt.getMonth() + 1).padStart(2, '0')}`, filtro: 'pendente', sels: new Set(), manual: false, marcados: new Set(), abertos: false, busca: '', lf: { sinal: 'mesmo', classe: '', de: '', ate: '', vmin: '', vmax: '', ordem: 'prox' } };
let D = null; // dados carregados

const dig = (s) => String(s || '').replace(/\D/g, '');
const cent = (v) => Math.round(+v * 100);
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const difDias = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5);
const fimMes = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };
const sinal = (l) => (state.cad.planoById[l.plano_id]?.natureza === 'D' ? -1 : 1) * +l.valor;
const chaveDesc = (s) => normTxt(s).replace(/\d+/g, ' ').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 4).join(' ');

export async function render(root) {
  const c = state.cad;
  const contas = c.contas.filter(x => x.ativo !== false);
  if (!ui.conta) ui.conta = (contas.find(x => x.ofx_conta) || contas.find(x => /corrente/i.test(x.tipo || '')) || contas[0])?.id || '';
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div class="toolbar" id="flt">
        <label>Conta<select name="conta">${options(contas, { selected: ui.conta })}</select></label>
        <label>Mês<input type="month" name="mes" value="${ui.mes}"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="hist">Importações</button>
        ${podeEditar() ? '<button class="btn" id="aceitar" disabled>Aceitar sugestões</button><button class="btn primary" id="imp">Importar extrato OFX</button>' : ''}
      </div></div></div>
    <div class="kpis" id="kpis"></div>
    <div class="conc-grid">
      <div class="card flush" id="ext"></div>
      <div class="card flush" id="sis"></div>
    </div>`;
  $('#flt', root).addEventListener('change', (e) => { ui[e.target.name] = e.target.value; ui.sels.clear(); ui.marcados.clear(); ui.manual = false; carregar(root); });
  $('#imp', root) && ($('#imp', root).onclick = () => importar(root));
  $('#hist', root).onclick = () => historico(root);
  $('#aceitar', root) && ($('#aceitar', root).onclick = () => aceitarTodas(root));
  await carregar(root);
}

async function carregar(root) {
  if (!ui.conta) { $('#ext', root).innerHTML = '<div class="empty">Cadastre uma conta bancária.</div>'; return; }
  const e = state.empresa.id, ini = `${ui.mes}-01`, fim = fimMes(ui.mes);
  $('#ext', root).innerHTML = '<div class="loading">Carregando…</div>'; $('#sis', root).innerHTML = '';
  try {
    const [itens, links, lancs, abertos, imps] = await Promise.all([
      fetchAll(() => sb.from('extrato_itens').select('*').eq('empresa_id', e).eq('conta_id', ui.conta).gte('data', ini).lte('data', fim).order('data').order('created_at')),
      fetchAll(() => sb.from('conciliacoes').select('id,extrato_id,lancamento_id,grupo_id').eq('empresa_id', e).eq('conta_id', ui.conta)),
      fetchAll(() => sb.from('lancamentos').select('id,data,valor,status,plano_id,favorecido_id,centro_custo_id,descricao,documento,conta_id').eq('empresa_id', e).eq('conta_id', ui.conta).eq('status', 'Pago').gte('data', addDias(ini, -10)).lte('data', addDias(fim, 10)).order('data')),
      fetchAll(() => sb.from('lancamentos').select('id,data,valor,status,plano_id,favorecido_id,centro_custo_id,descricao,documento,conta_id').eq('empresa_id', e).eq('status', 'Em aberto').gte('data', addDias(ini, -20)).lte('data', addDias(fim, 20)).order('data')),
      q(sb.from('extrato_importacoes').select('*').eq('empresa_id', e).eq('conta_id', ui.conta).lte('saldo_data', fim).order('saldo_data', { ascending: false }).limit(1)),
    ]);
    const imp = imps?.[0] && imps[0].saldo_data >= ini ? imps[0] : null;
    let saldoSis = null;
    if (imp?.saldo_data) { const s = await q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: imp.saldo_data })); saldoSis = s?.find(x => x.conta_id === ui.conta)?.saldo_pago ?? null; }
    const porItem = {}; const lancLig = new Set();
    for (const l of links) { (porItem[l.extrato_id] ||= []).push(l.lancamento_id); lancLig.add(l.lancamento_id); }
    D = { itens, links, porItem, lancLig, lancs, abertos: abertos.filter(a => !lancLig.has(a.id)), imp, saldoSis, ini, fim, lancById: Object.fromEntries([...lancs, ...abertos].map(l => [l.id, l])) };
    // lançamentos conciliados fora da janela carregada (para mostrar o vínculo)
    const faltam = links.filter(l => itens.some(i => i.id === l.extrato_id) && !D.lancById[l.lancamento_id]).map(l => l.lancamento_id);
    for (let i = 0; i < faltam.length; i += 150) for (const l of await q(sb.from('lancamentos').select('id,data,valor,status,plano_id,favorecido_id,descricao,documento,conta_id').in('id', faltam.slice(i, i + 150)))) D.lancById[l.id] = l;
    // vínculos órfãos (o movimento voltou a pendente porque um lançamento do grupo foi excluído): remove
    const orfaos = links.filter(l => { const it = itens.find(i => i.id === l.extrato_id); return it && it.status !== 'conciliado'; });
    if (orfaos.length && podeEditar()) {
      for (let i = 0; i < orfaos.length; i += 200) await q(sb.from('conciliacoes').delete().in('id', orfaos.slice(i, i + 200).map(l => l.id)));
      const fora = new Set(orfaos.map(l => l.lancamento_id)); D.links = links.filter(l => !fora.has(l.lancamento_id));
      D.porItem = {}; D.lancLig = new Set(); for (const l of D.links) { (D.porItem[l.extrato_id] ||= []).push(l.lancamento_id); D.lancLig.add(l.lancamento_id); }
      D.abertos = abertos.filter(a => !D.lancLig.has(a.id));
    }
    D.sug = sugerir();
  } catch (err) { fail(err); $('#ext', root).innerHTML = '<div class="empty">Não foi possível carregar.</div>'; return; }
  pintar(root);
}

// Sugestões: 1) mesmo valor e data próxima (±3 dias); 2) vários lançamentos do mesmo dia somando o item; 3) título em aberto com mesmo valor (±7 dias) → baixa
function sugerir() {
  const sug = {}; const usados = new Set(D.lancLig);
  const pend = D.itens.filter(i => i.status === 'pendente');
  const docOk = (i, l) => { const d = dig(l.documento).replace(/^0+/, ''); return d.length >= 3 && (dig(i.documento).replace(/^0+/, '') === d || dig(i.descricao).includes(d)); };
  const casar = (lista, maxDias, tipo) => {
    const pares = [];
    for (const i of pend) if (!sug[i.id]) for (const l of lista) {
      if (usados.has(l.id) || cent(sinal(l)) !== cent(i.valor)) continue;
      const dd = Math.abs(difDias(i.data, l.data)); if (dd > maxDias) continue;
      pares.push({ i, l, s: dd * 10 - (docOk(i, l) ? 25 : 0) });
    }
    pares.sort((a, b) => a.s - b.s);
    for (const p of pares) if (!sug[p.i.id] && !usados.has(p.l.id)) { sug[p.i.id] = { tipo, ids: [p.l.id] }; usados.add(p.l.id); }
  };
  casar(D.lancs, 3, 'exato');
  for (const i of pend) {
    if (sug[i.id]) continue;
    const mesmos = D.lancs.filter(l => !usados.has(l.id) && l.data === i.data && Math.sign(sinal(l)) === Math.sign(i.valor));
    if (mesmos.length >= 2 && cent(mesmos.reduce((s, l) => s + sinal(l), 0)) === cent(i.valor)) { sug[i.id] = { tipo: 'grupo', ids: mesmos.map(l => l.id) }; mesmos.forEach(l => usados.add(l.id)); }
  }
  casar(D.abertos, 7, 'baixa');
  return sug;
}

const ROT_SUG = { exato: 'sugestão', grupo: 'sugestão (vários)', baixa: 'baixar título' };

function pintar(root) {
  const it = D.itens; const n = (s) => it.filter(i => i.status === s).length;
  const semExt = D.lancs.filter(l => l.data >= D.ini && l.data <= D.fim && !D.lancLig.has(l.id));
  const nSug = Object.keys(D.sug).length;
  const dif = D.imp && D.saldoSis != null ? Math.round((+D.imp.saldo_final - D.saldoSis) * 100) / 100 : null;
  $('#kpis', root).innerHTML = `
    <div class="kpi"><div class="k-label">Saldo no banco</div><div class="k-value">${D.imp ? money(D.imp.saldo_final) : '–'}</div><div class="k-sub">${D.imp ? `extrato em ${dateBR(D.imp.saldo_data)}` : 'importe o OFX do mês'}</div></div>
    <div class="kpi"><div class="k-label">Saldo no sistema</div><div class="k-value">${D.saldoSis != null ? money(D.saldoSis) : '–'}</div><div class="k-sub">lançamentos pagos até a mesma data</div></div>
    <div class="kpi"><div class="k-label">Diferença</div><div class="k-value ${dif ? 'neg' : dif === 0 ? 'pos' : ''}">${dif == null ? '–' : money(dif)}</div><div class="k-sub">${dif === 0 ? 'saldos batem' : dif ? 'banco − sistema' : ''}</div></div>
    <div class="kpi"><div class="k-label">Extrato do mês</div><div class="k-value">${it.length ? Math.round(n('conciliado') / it.length * 100) : 0}%</div><div class="k-sub">${n('conciliado')} conciliado(s) · ${n('pendente')} pendente(s)${n('ignorado') ? ` · ${n('ignorado')} ignorado(s)` : ''}</div></div>
    <div class="kpi"><div class="k-label">Lançamentos sem extrato</div><div class="k-value ${semExt.length ? 'neg' : ''}">${semExt.length}</div><div class="k-sub">${money(semExt.reduce((s, l) => s + sinal(l), 0))} no mês</div></div>`;
  const ac = $('#aceitar', root); if (ac) { ac.disabled = !nSug; ac.textContent = nSug ? `Aceitar sugestões (${nSug})` : 'Aceitar sugestões'; }
  pintarExtrato(root); pintarSistema(root);
}

function pintarExtrato(root) {
  const lista = D.itens.filter(i => ui.filtro === 'todos' || i.status === ui.filtro);
  const tot = (s) => D.itens.filter(i => i.status === s).length;
  const pendVis = lista.filter(i => i.status === 'pendente');
  const todosMarc = pendVis.length && pendVis.every(i => ui.sels.has(i.id));
  const c = $('#ext', root);
  const selPend = [...ui.sels].map(id => D.itens.find(i => i.id === id)).filter(i => i?.status === 'pendente');
  c.innerHTML = `<div class="card-head"><div><h2>Extrato do banco</h2><p class="muted small">${D.itens.length} movimento(s) em ${dateBR(D.ini).slice(3)}${selPend.length > 1 ? ` · <strong>${selPend.length} selecionados = ${money(selPend.reduce((a, i) => a + +i.valor, 0))}</strong>` : ''}</p></div>
      <div class="chips" id="fx">${[['pendente', 'Pendentes'], ['conciliado', 'Conciliados'], ['ignorado', 'Ignorados'], ['todos', 'Todos']].map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t} <span class="muted">${k === 'todos' ? D.itens.length : tot(k)}</span></span>`).join('')}</div></div>
    <div class="table-wrap" style="max-height:62vh">${lista.length ? `<table><thead><tr><th style="width:28px">${pendVis.length ? `<input type="checkbox" id="ext-todos" title="Selecionar todos os pendentes visíveis" ${todosMarc ? 'checked' : ''}>` : ''}</th><th>Data</th><th>Histórico</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${lista.map(i => { const s = D.sug[i.id];
        return `<tr class="clickable ${ui.sels.has(i.id) ? 'row-sel' : ''}" data-id="${i.id}"><td>${i.status === 'pendente' ? `<input type="checkbox" data-chk ${ui.sels.has(i.id) ? 'checked' : ''}>` : ''}</td><td>${dateBR(i.data)}</td>
        <td class="wrap">${esc(i.descricao || i.tipo || '')}${i.documento ? `<div class="small muted">doc. ${esc(i.documento)}</div>` : ''}${i.status === 'ignorado' && i.observacao ? `<div class="small muted">${esc(i.observacao)}</div>` : ''}</td>
        <td class="num ${cls(i.valor)}">${money(i.valor)}</td>
        <td class="small">${i.status === 'conciliado' ? `<span class="badge pago">conciliado${i.grupo_id ? ' (grupo)' : ''}</span>` : i.status === 'ignorado' ? '<span class="badge">ignorado</span>' : s ? `<span class="badge aberto">${ROT_SUG[s.tipo]}</span>` : ''}</td></tr>`; }).join('')}
      </tbody></table>` : `<div class="empty">${D.itens.length ? 'Nada neste filtro.' : 'Nenhum movimento importado para esta conta neste mês. Use “Importar extrato OFX”.'}</div>`}</div>`;
  $('#fx', c).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; pintarExtrato(root); } };
  const mudou = () => {
    const sel = [...ui.sels]; const um = sel.length === 1 ? sel[0] : null;
    if (!ui.manual || !ui.marcados.size) { ui.manual = false; ui.marcados = new Set(um ? D.sug[um]?.ids || [] : []); }
    ui.busca = '';
    if (sel.length) { ui.lf.sinal = 'mesmo'; ui.lf.ordem = 'prox'; }
    if (um && D.sug[um]?.tipo === 'baixa') ui.abertos = true;
    pintarExtrato(root); pintarSistema(root);
  };
  $('#ext-todos', c) && ($('#ext-todos', c).onchange = (e) => {
    for (const k of [...ui.sels]) if (D.itens.find(i => i.id === k)?.status !== 'pendente') ui.sels.delete(k);
    for (const i of pendVis) e.target.checked ? ui.sels.add(i.id) : ui.sels.delete(i.id);
    mudou();
  });
  $('tbody', c)?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return; const id = tr.dataset.id;
    if (e.target.matches('[data-chk]')) {
      // seleção múltipla: só movimentos pendentes
      for (const k of [...ui.sels]) if (D.itens.find(i => i.id === k)?.status !== 'pendente') ui.sels.delete(k);
      e.target.checked ? ui.sels.add(id) : ui.sels.delete(id);
    } else {
      const so = ui.sels.size === 1 && ui.sels.has(id); ui.sels.clear(); if (!so) ui.sels.add(id);
    }
    mudou();
    if (ui.sels.size && !e.target.matches('[data-chk]') && window.innerWidth < 1100) $('#sis', root).scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });
}

const linhaLanc = (l, { marcar = true, marcado = false } = {}) => {
  const p = state.cad.planoById[l.plano_id]; const f = state.cad.favById[l.favorecido_id]; const v = sinal(l);
  return `<tr data-l="${l.id}">${marcar ? `<td><input type="checkbox" ${marcado ? 'checked' : ''}></td>` : ''}<td>${dateBR(l.data)}</td>
    <td class="wrap">${esc(f?.nome || l.descricao || '')}<div class="small muted">${esc(p ? `${p.codigo} ${p.nome}` : '')}${l.documento ? ` · NF ${esc(l.documento)}` : ''}${l.status === 'Em aberto' ? ' · <span class="neg">em aberto</span>' : ''}${l.conta_id && l.conta_id !== ui.conta ? ` · ${esc(state.cad.contaById[l.conta_id]?.nome || '')}` : ''}</div></td>
    <td class="num ${cls(v)}">${money(v)}</td><td class="edt"><button class="btn ghost icon small" data-edit="${l.id}" title="Abrir o lançamento para edição">✎</button></td></tr>`;
};

// abre o lançamento no formulário de edição; ao salvar ou excluir, recarrega a conciliação
async function editarLanc(id, root) {
  try {
    const l = await q(sb.from('lancamentos').select('*').eq('id', id).single());
    abrirLancamento(l, () => carregar(root));
  } catch (e) { fail(e); }
}

// Filtros e ordem do painel de lançamentos (direita)
const ORDENS = [['prox', 'Mais provável'], ['data', 'Data ↑'], ['data_desc', 'Data ↓'], ['valor', 'Valor ↑'], ['valor_desc', 'Valor ↓'], ['fav', 'Favorecido A–Z'], ['plano', 'Plano de contas']];
const COL_ORDEM = { data: ['data', 'data_desc'], fav: ['fav', 'fav'], valor: ['valor_desc', 'valor'] };
function filtrosHTML(item) {
  const f = ui.lf; const classes = state.cad.classes || state.cad.plano.filter(p => p.nivel === 1);
  const ativos = [f.classe, f.de || f.ate, f.vmin || f.vmax].filter(Boolean).length;
  return `<div class="conc-flt" id="lf">
    <div class="toolbar">
      <label class="grow">Buscar<input name="busca" value="${esc(ui.busca)}" placeholder="favorecido, descrição, NF, valor"></label>
      <label>Tipo<select name="sinal">${[['', 'Todos'], ...(item ? [['mesmo', item.valor < 0 ? 'Saídas (como o extrato)' : 'Entradas (como o extrato)']] : []), ['E', 'Entradas'], ['S', 'Saídas']].map(([k, t]) => `<option value="${k}" ${f.sinal === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Ordem<select name="ordem">${ORDENS.filter(([k]) => item || k !== 'prox').map(([k, t]) => `<option value="${k}" ${f.ordem === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <button class="btn small" type="button" id="lf-mais">${ui.lfMais ? 'Menos filtros' : 'Mais filtros'}${ativos ? ` (${ativos})` : ''}</button>
    </div>
    <div class="toolbar" ${ui.lfMais ? '' : 'hidden'}>
      <label>Classificação<select name="classe"><option value="">Todas</option>${classes.map(c => `<option value="${c.id}" ${f.classe === c.id ? 'selected' : ''}>${esc(c.codigo)} ${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Período<span class="par"><input type="date" name="de" value="${f.de}"><input type="date" name="ate" value="${f.ate}"></span></label>
      <label>Valor entre<span class="par"><input name="vmin" inputmode="decimal" value="${esc(f.vmin)}" placeholder="mín."><input name="vmax" inputmode="decimal" value="${esc(f.vmax)}" placeholder="máx."></span></label>
      <button class="btn small" type="button" id="lf-limpa">Limpar</button>
    </div>
    ${item ? `<label class="chk"><input type="checkbox" name="abertos" ${ui.abertos ? 'checked' : ''}> Incluir títulos em aberto</label>` : ''}
  </div>`;
}
function filtrarOrdenar(cand, item) {
  const f = ui.lf; const b = normTxt(ui.busca); const num = (x) => { const v = parseFloat(String(x).replace(/\./g, '').replace(',', '.')); return isFinite(v) ? v : null; };
  const vmin = num(f.vmin), vmax = num(f.vmax);
  const pai = (l) => state.cad.planoById[l.plano_id]?.pai_id;
  const lista = cand.filter(l => {
    if (ui.marcados.has(l.id)) return true;
    const v = sinal(l);
    if (f.sinal === 'mesmo' && item && Math.sign(v) !== Math.sign(item.valor)) return false;
    if (f.sinal === 'E' && v < 0) return false; if (f.sinal === 'S' && v > 0) return false;
    if (f.classe && pai(l) !== f.classe) return false;
    if (f.de && l.data < f.de) return false; if (f.ate && l.data > f.ate) return false;
    if (vmin != null && Math.abs(v) < vmin) return false; if (vmax != null && Math.abs(v) > vmax) return false;
    return !b || normTxt(`${state.cad.favById[l.favorecido_id]?.nome || ''} ${l.descricao || ''} ${l.documento || ''} ${money(l.valor)}`).includes(b);
  });
  const fav = (l) => state.cad.favById[l.favorecido_id]?.nome || l.descricao || '';
  const cod = (l) => state.cad.planoById[l.plano_id]?.codigo || '';
  const cmp = {
    prox: (x, y) => item ? (Math.abs(Math.abs(sinal(x)) - Math.abs(item.valor)) - Math.abs(Math.abs(sinal(y)) - Math.abs(item.valor))) || (Math.abs(difDias(x.data, item.data)) - Math.abs(difDias(y.data, item.data))) : x.data.localeCompare(y.data),
    data: (x, y) => x.data.localeCompare(y.data) || Math.abs(sinal(y)) - Math.abs(sinal(x)), data_desc: (x, y) => y.data.localeCompare(x.data) || Math.abs(sinal(y)) - Math.abs(sinal(x)),
    valor: (x, y) => Math.abs(sinal(x)) - Math.abs(sinal(y)), valor_desc: (x, y) => Math.abs(sinal(y)) - Math.abs(sinal(x)),
    fav: (x, y) => fav(x).localeCompare(fav(y), 'pt-BR') || x.data.localeCompare(y.data), plano: (x, y) => cod(x).localeCompare(cod(y)) || x.data.localeCompare(y.data),
  }[f.ordem] || ((x, y) => x.data.localeCompare(y.data));
  return lista.sort((x, y) => (ui.marcados.has(y.id) - ui.marcados.has(x.id)) || cmp(x, y));
}
const thOrd = (k, t, extra = '') => { const on = (COL_ORDEM[k] || []).includes(ui.lf.ordem); const seta = on ? (ui.lf.ordem.endsWith('_desc') || (k === 'valor' && ui.lf.ordem === 'valor_desc') ? ' ↓' : ' ↑') : ''; return `<th class="${extra} sortable" data-ord="${k}" style="cursor:pointer" title="Ordenar">${t}${seta}</th>`; };
function ligarFiltros(c, root, item) {
  const lf = $('#lf', c); if (!lf) return;
  let t;
  lf.addEventListener('input', (e) => {
    const n = e.target.name; if (!n) return;
    if (n === 'abertos') ui.abertos = e.target.checked; else if (n === 'busca') ui.busca = e.target.value; else ui.lf[n] = e.target.value;
    clearTimeout(t); t = setTimeout(() => { const foco = n; pintarSistema(root); const el = $(`#lf [name="${foco}"]`, c); if (el && el.type !== 'checkbox' && el.tagName === 'INPUT') { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* date */ } } }, ['busca', 'vmin', 'vmax'].includes(n) ? 350 : 0);
  });
  $('#lf-mais', c).onclick = () => { ui.lfMais = !ui.lfMais; pintarSistema(root); };
  $('#lf-limpa', c).onclick = () => { ui.busca = ''; Object.assign(ui.lf, { sinal: item ? 'mesmo' : '', classe: '', de: '', ate: '', vmin: '', vmax: '', ordem: item ? 'prox' : 'data' }); pintarSistema(root); };
  c.querySelector('thead')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-ord]')?.dataset.ord; if (!k) return;
    const [a, d] = COL_ORDEM[k]; ui.lf.ordem = k === 'fav' ? 'fav' : ui.lf.ordem === a ? d : a; pintarSistema(root);
  });
}
const resumo = (lista) => `<p class="small muted" style="margin:0 12px 6px">${lista.length} lançamento(s) · ${money(lista.reduce((s, l) => s + sinal(l), 0))}${lista.length > 300 ? ' · mostrando os 300 primeiros' : ''}</p>`;

// marcar/desmarcar lançamentos (linha a linha ou todos os visíveis)
const thTodos = (lista) => { const vis = lista.slice(0, 300); const todos = vis.length && vis.every(l => ui.marcados.has(l.id)); return `<th style="width:28px"><input type="checkbox" id="l-todos" title="Selecionar todos os lançamentos visíveis" ${todos ? 'checked' : ''}></th>`; };
function ligarMarcacao(c, lista, depois) {
  c.querySelector('tbody')?.addEventListener('change', (e) => { const tr = e.target.closest('tr[data-l]'); if (!tr) return; e.target.checked ? ui.marcados.add(tr.dataset.l) : ui.marcados.delete(tr.dataset.l); ui.manual = true; depois(); });
  const t = $('#l-todos', c); if (!t) return;
  t.onchange = () => {
    for (const l of lista.slice(0, 300)) t.checked ? ui.marcados.add(l.id) : ui.marcados.delete(l.id);
    c.querySelectorAll('tr[data-l] input[type=checkbox]').forEach(cb => { cb.checked = ui.marcados.has(cb.closest('tr').dataset.l); });
    ui.manual = true; depois();
  };
}

function pintarSistema(root) {
  const c = $('#sis', root);
  c.onclick = (e) => { const id = e.target.closest('[data-edit]')?.dataset.edit; if (id) { e.preventDefault(); editarLanc(id, root); } };
  const sels = [...ui.sels].map(id => D.itens.find(i => i.id === id)).filter(Boolean);
  const multi = sels.length > 1;
  // vários movimentos: o alvo é a soma deles (data do primeiro, para a proximidade)
  const item = multi ? { multi: true, itens: sels, valor: Math.round(sels.reduce((a, i) => a + +i.valor, 0) * 100) / 100, data: sels.map(i => i.data).sort()[0], status: 'pendente' } : sels[0];
  if (!item) {
    if (ui.lf.sinal === 'mesmo') ui.lf.sinal = ''; if (ui.lf.ordem === 'prox') ui.lf.ordem = 'data';
    const sem = filtrarOrdenar(D.lancs.filter(l => l.data >= D.ini && l.data <= D.fim && !D.lancLig.has(l.id)), null);
    c.innerHTML = `<div class="card-head"><div><h2>Lançamentos sem extrato</h2><p class="muted small">Pagos nesta conta no mês e ainda não conciliados. Clique num movimento do extrato para conciliar.</p></div></div>
      ${filtrosHTML(null)}${resumo(sem)}
      <div class="table-wrap" style="max-height:52vh">${sem.length ? `<table><thead><tr>${thTodos(sem)}${thOrd('data', 'Data')}${thOrd('fav', 'Favorecido / plano')}${thOrd('valor', 'Valor', 'num')}<th></th></tr></thead><tbody>${sem.slice(0, 300).map(l => linhaLanc(l, { marcado: ui.marcados.has(l.id) })).join('')}</tbody></table>` : '<div class="empty">Nenhum.</div>'}</div>
      <div class="conc-foot" id="cf"></div>`;
    const rod = () => {
      const sel = [...ui.marcados].map(id => D.lancById[id]).filter(Boolean);
      $('#cf', c).innerHTML = sel.length ? `<div class="small">Selecionado <strong>${money(sel.reduce((a, l) => a + sinal(l), 0))}</strong> (${sel.length}) · agora marque à esquerda os movimentos do extrato correspondentes</div><button class="btn small" id="lc">Limpar seleção</button>` : '<div class="small muted">Marque lançamentos aqui e os movimentos do extrato à esquerda para conciliar em qualquer ordem.</div>';
      $('#lc', c) && ($('#lc', c).onclick = () => { ui.marcados.clear(); ui.manual = false; pintarSistema(root); });
    };
    rod();
    ligarMarcacao(c, sem, rod);
    ligarFiltros(c, root, null);
    return;
  }
  const cab = multi
    ? `<div class="card-head"><div><h2>${sels.length} movimentos · <span class="${cls(item.valor)}">${money(item.valor)}</span></h2><p class="muted small">${sels.slice(0, 6).map(i => `${dateBR(i.data).slice(0, 5)} ${esc((i.descricao || '').slice(0, 28))} ${money(i.valor)}`).join(' · ')}${sels.length > 6 ? ' …' : ''}</p></div></div>`
    : `<div class="card-head"><div><h2>${dateBR(item.data)} · <span class="${cls(item.valor)}">${money(item.valor)}</span></h2><p class="muted small">${esc(item.descricao || '')}</p></div></div>`;
  if (item.status !== 'pendente') {
    const lig = item.grupo_id ? D.links.filter(l => l.grupo_id === item.grupo_id).map(l => l.lancamento_id) : (D.porItem[item.id] || []);
    const ls = lig.map(id => D.lancById[id]).filter(Boolean);
    const outros = item.grupo_id ? D.itens.filter(i => i.grupo_id === item.grupo_id && i.id !== item.id) : [];
    c.innerHTML = `${cab}<div style="padding:0 12px 12px">${item.status === 'conciliado' ? `${outros.length ? `<p class="small">Conciliado em grupo com mais ${outros.length} movimento(s) do extrato: ${outros.map(i => `${dateBR(i.data)} ${money(i.valor)}`).join(' · ')}</p>` : ''}<p class="small">Lançamentos (${ls.length} · ${money(ls.reduce((a, l) => a + sinal(l), 0))}):</p>
      <div class="table-wrap"><table><tbody>${ls.map(l => linhaLanc(l, { marcar: false })).join('') || '<tr><td class="muted">—</td></tr>'}</tbody></table></div>`
      : `<p class="small">Ignorado${item.observacao ? `: ${esc(item.observacao)}` : ''}.</p>`}
      ${podeEditar() ? `<div class="toolbar" style="margin-top:10px"><button class="btn" id="desf">${item.status === 'conciliado' ? (item.grupo_id ? 'Desfazer conciliação do grupo' : 'Desfazer conciliação') : 'Voltar para pendente'}</button></div>` : ''}</div>`;
    $('#desf', c) && ($('#desf', c).onclick = () => desfazer(item, root));
    return;
  }
  const s = multi ? null : D.sug[item.id];
  const cand = [...D.lancs.filter(l => !D.lancLig.has(l.id)), ...(ui.abertos ? D.abertos : [])];
  const lista = filtrarOrdenar(cand, item);
  c.innerHTML = `${cab}
    ${s ? `<p class="small" style="margin:0 12px 8px"><span class="badge aberto">${ROT_SUG[s.tipo]}</span> ${s.tipo === 'baixa' ? 'Título em aberto com o mesmo valor: ao conciliar, ele é baixado como pago na data do extrato e nesta conta.' : s.tipo === 'grupo' ? 'Lançamentos do mesmo dia que somam o valor do extrato.' : 'Mesmo valor e data próxima.'}</p>` : ''}
    ${filtrosHTML(item)}${resumo(lista)}
    <div class="table-wrap" style="max-height:44vh">${lista.length ? `<table><thead><tr>${thTodos(lista)}${thOrd('data', 'Data')}${thOrd('fav', 'Favorecido / plano')}${thOrd('valor', 'Valor', 'num')}<th></th></tr></thead><tbody>${lista.slice(0, 300).map(l => linhaLanc(l, { marcado: ui.marcados.has(l.id) })).join('')}</tbody></table>` : '<div class="empty">Nenhum lançamento com esses filtros.</div>'}</div>
    <div class="conc-foot" id="cf"></div>`;
  const rodape = () => {
    const sel = [...ui.marcados].map(id => D.lancById[id]).filter(Boolean); const tot = sel.reduce((s, l) => s + sinal(l), 0); const dif = Math.round((item.valor - tot) * 100) / 100;
    $('#cf', c).innerHTML = `<div class="small">Extrato <strong>${money(item.valor)}</strong> · Selecionado <strong>${money(tot)}</strong> (${sel.length}) · Diferença <strong class="${dif ? 'neg' : 'pos'}">${money(dif)}</strong>${sel.some(l => l.status === 'Em aberto') ? ' · <span class="neg">títulos em aberto serão baixados</span>' : ''}</div>
      ${podeEditar() ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" id="ign">Ignorar${multi ? ` (${sels.length})` : ''}</button>${multi ? '' : '<button class="btn small" id="cria">Criar lançamento</button>'}<button class="btn small primary" id="conc" ${sel.length && !dif ? '' : 'disabled'}>Conciliar${multi ? ` ${sels.length} × ${sel.length}` : ''}</button></div>` : ''}`;
    // seleção que bate: linhas verdes nos dois lados
    const ok = sel.length > 0 && !dif;
    root.querySelectorAll('#ext tr[data-id]').forEach(tr => tr.classList.toggle('conc-ok', ok && ui.sels.has(tr.dataset.id)));
    c.querySelectorAll('tr[data-l]').forEach(tr => tr.classList.toggle('conc-ok', ok && ui.marcados.has(tr.dataset.l)));
    $('#cf', c).classList.toggle('ok', ok);
    $('#conc', c) && ($('#conc', c).onclick = () => multi ? conciliarGrupo(sels, [...ui.marcados], root) : conciliar([{ item, ids: [...ui.marcados] }], root));
    $('#ign', c) && ($('#ign', c).onclick = () => ignorar(multi ? sels : [item], root));
    $('#cria', c) && ($('#cria', c).onclick = () => criar(item, root));
  };
  rodape();
  ligarMarcacao(c, lista, rodape);
  ligarFiltros(c, root, item);
}

// grava uma ou mais conciliações: [{ item, ids }]
async function conciliar(grupos, root) {
  const agora = new Date().toISOString(), uid = state.user?.id || null;
  try {
    for (const { item, ids } of grupos) {
      const abertos = ids.filter(id => D.lancById[id]?.status === 'Em aberto');
      if (abertos.length) await q(sb.from('lancamentos').update({ status: 'Pago', data: item.data, conta_id: ui.conta }).in('id', abertos));
    }
    const links = grupos.flatMap(({ item, ids }) => ids.map(id => ({ empresa_id: state.empresa.id, conta_id: ui.conta, extrato_id: item.id, lancamento_id: id })));
    for (let i = 0; i < links.length; i += 500) await q(sb.from('conciliacoes').insert(links.slice(i, i + 500)));
    const itens = grupos.map(g => g.item.id);
    for (let i = 0; i < itens.length; i += 200) await q(sb.from('extrato_itens').update({ status: 'conciliado', conciliado_em: agora, conciliado_por: uid }).in('id', itens.slice(i, i + 200)));
    toast(`${grupos.length} movimento(s) conciliado(s)`);
    ui.sels.clear(); ui.marcados.clear(); ui.manual = false; await carregar(root);
  } catch (e) { fail(String(e.message || e).includes('duplicate') ? new Error('Algum lançamento já estava conciliado com outro movimento. Atualize a página.') : e); }
}

// vários movimentos ↔ vários lançamentos: mesmo grupo_id; vínculos no primeiro movimento
async function conciliarGrupo(itens, ids, root) {
  const agora = new Date().toISOString(), uid = state.user?.id || null;
  const g = globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = Math.random() * 16 | 0; return (ch === 'x' ? r : (r & 3 | 8)).toString(16); });
  const ord = [...itens].sort((a, b) => a.data.localeCompare(b.data)); const ult = ord[ord.length - 1].data;
  try {
    const abertos = ids.filter(id => D.lancById[id]?.status === 'Em aberto');
    if (abertos.length) await q(sb.from('lancamentos').update({ status: 'Pago', data: ult, conta_id: ui.conta }).in('id', abertos));
    await q(sb.from('conciliacoes').insert(ids.map(id => ({ empresa_id: state.empresa.id, conta_id: ui.conta, extrato_id: ord[0].id, lancamento_id: id, grupo_id: g }))));
    await q(sb.from('extrato_itens').update({ status: 'conciliado', conciliado_em: agora, conciliado_por: uid, grupo_id: g }).in('id', itens.map(i => i.id)));
    toast(`${itens.length} movimento(s) conciliado(s) com ${ids.length} lançamento(s)`);
    ui.sels.clear(); ui.marcados.clear(); ui.manual = false; await carregar(root);
  } catch (e) { fail(String(e.message || e).includes('duplicate') ? new Error('Algum lançamento já estava conciliado com outro movimento. Atualize a página.') : e); }
}

function aceitarTodas(root) {
  const g = Object.entries(D.sug).map(([id, s]) => ({ item: D.itens.find(i => i.id === id), ids: s.ids, tipo: s.tipo })).filter(x => x.item);
  const nb = g.filter(x => x.tipo === 'baixa').length;
  const m = modal({ title: 'Aceitar sugestões', body: `<p>Conciliar <strong>${g.length}</strong> movimento(s) do extrato com os lançamentos sugeridos?</p>
    ${nb ? `<p class="small">${nb} sugestão(ões) baixam títulos em aberto (status Pago, data do extrato e esta conta).</p><label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="sb" checked> Incluir as baixas de títulos em aberto</label>` : ''}`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Conciliar</button>' });
  $('#ok', m.el).onclick = () => { const inclui = $('#sb', m.el)?.checked !== false; m.close(); conciliar(g.filter(x => inclui || x.tipo !== 'baixa'), root); };
}

async function desfazer(item, root) {
  try {
    if (item.grupo_id) {
      await q(sb.from('conciliacoes').delete().eq('grupo_id', item.grupo_id));
      await q(sb.from('extrato_itens').update({ status: 'pendente', conciliado_em: null, conciliado_por: null, grupo_id: null }).eq('grupo_id', item.grupo_id));
      toast('Conciliação do grupo desfeita: os movimentos voltaram para pendente');
    } else {
      if (item.status === 'conciliado') await q(sb.from('conciliacoes').delete().eq('extrato_id', item.id));
      await q(sb.from('extrato_itens').update({ status: 'pendente', conciliado_em: null, conciliado_por: null, observacao: null }).eq('id', item.id));
      toast('Movimento voltou para pendente');
    }
    ui.sels.clear(); await carregar(root);
  } catch (e) { fail(e); }
}

function ignorar(itens, root) {
  const tot = itens.reduce((a, i) => a + +i.valor, 0);
  const m = modal({ title: itens.length > 1 ? `Ignorar ${itens.length} movimentos` : 'Ignorar movimento',
    body: `<p class="small">${itens.length > 1 ? `${itens.length} movimentos · <strong>${money(tot)}</strong>` : `${dateBR(itens[0].data)} · ${esc(itens[0].descricao || '')} · <strong>${money(tot)}</strong>`}</p>
    <label>Motivo<input id="mot" placeholder="ex.: aplicação/resgate automático, estorno do próprio banco"></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Ignorar</button>' });
  $('#ok', m.el).onclick = async () => {
    try { await q(sb.from('extrato_itens').update({ status: 'ignorado', observacao: $('#mot', m.el).value.trim() || null }).in('id', itens.map(i => i.id))); m.close(); ui.sels.clear(); await carregar(root); } catch (e) { fail(e); }
  };
}

// Cria o lançamento a partir do movimento; sugere plano/favorecido pelo histórico de conciliações com o mesmo texto
async function criar(item, root) {
  let base = {};
  try {
    const hist = await q(sb.from('conciliacoes').select('created_at, extrato_itens(descricao), lancamentos(plano_id, favorecido_id, centro_custo_id)').eq('empresa_id', state.empresa.id).eq('conta_id', ui.conta).order('created_at', { ascending: false }).limit(1000));
    const k = chaveDesc(item.descricao);
    const h = k && (hist || []).find(x => x.lancamentos && chaveDesc(x.extrato_itens?.descricao) === k);
    if (h) base = { plano_id: h.lancamentos.plano_id, favorecido_id: h.lancamentos.favorecido_id, centro_custo_id: h.lancamentos.centro_custo_id };
  } catch { /* sem histórico */ }
  abrirLancamento({ ...base, data: item.data, status: 'Pago', valor: Math.abs(item.valor), conta_id: ui.conta, descricao: item.descricao, documento: item.documento }, async (salvo) => {
    if (!salvo) return carregar(root);
    if (salvo.status !== 'Pago' || salvo.conta_id !== ui.conta || cent(sinal(salvo)) !== cent(item.valor)) {
      toast('Lançamento criado, mas valor/natureza/conta não batem com o movimento: concilie manualmente.', true); return carregar(root);
    }
    D.lancById[salvo.id] = salvo; await conciliar([{ item, ids: [salvo.id] }], root);
  });
}

// ---------------------------------------------------------------------------------------------
// Importação do OFX
// ---------------------------------------------------------------------------------------------
const BANCOS = { 1: 'BRASIL', 4: 'NORDESTE', 33: 'SANTANDER', 104: 'CAIXA ECON', 136: 'UNICRED', 237: 'BRADESCO', 260: 'NU', 341: 'ITAU', 748: 'SICREDI', 756: 'SICOOB' };
function contaDoOFX(st) {
  const a = dig(st.conta).replace(/^0+/, ''); const cs = state.cad.contas.filter(c => c.ativo !== false);
  const porOfx = a && cs.find(c => dig(c.ofx_conta).replace(/^0+/, '') === a); if (porOfx) return porOfx;
  const banco = BANCOS[+dig(st.banco)]; const doBanco = (c) => banco && normTxt(`${c.nome} ${c.instituicao || ''}`).toUpperCase().includes(banco);
  // número da conta com ou sem o dígito verificador (Bradesco manda ACCTID 39 para a conta 39-6)
  const num = a ? cs.filter(c => { const n = dig(c.numero).replace(/^0+/, ''); return n && (n === a || n.slice(0, -1) === a || (n.length >= 4 && (a.endsWith(n) || n.endsWith(a)))); }) : [];
  if (num.length) return num.find(doBanco) || num[0];
  const pb = cs.filter(c => doBanco(c) && /corrente/i.test(c.tipo || ''));
  return pb.length === 1 ? pb[0] : null;
}

function importar(root) {
  let lidos = [];
  const m = modal({ title: 'Importar extrato OFX', wide: true,
    body: `<p class="small muted" style="margin-top:0">Selecione um ou mais arquivos .ofx exportados do internet banking. Movimentos já importados (mesmo identificador do banco) não são duplicados.
      Depois da importação o sistema sugere os vínculos com os lançamentos; nada é conciliado sem a sua confirmação.</p>
      <input type="file" id="arq" accept=".ofx,.OFX" multiple><div id="res" style="margin-top:12px"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="ok" disabled>Importar</button>' });
  $('#arq', m.el).onchange = async (e) => {
    lidos = [];
    try {
      for (const f of e.target.files) for (const st of lerOFX(decodificarOFX(await f.arrayBuffer()))) lidos.push({ arquivo: f.name, ...st, contaId: contaDoOFX(st)?.id || (e.target.files.length === 1 ? ui.conta : '') });
    } catch (err) { fail(err); }
    $('#res', m.el).innerHTML = lidos.length ? `<div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Banco / agência / conta no OFX</th><th>Período</th><th class="num">Movimentos</th><th class="num">Créditos</th><th class="num">Débitos</th><th class="num">Saldo final</th><th>Conta no sistema</th></tr></thead><tbody>
      ${lidos.map((s, k) => `<tr data-k="${k}"><td class="small wrap">${esc(s.arquivo)}</td><td class="small">${esc([s.banco, s.agencia, s.conta].filter(Boolean).join(' / '))}${s.cartao ? ' (cartão)' : ''}</td>
        <td class="small">${dateBR(s.inicio)} a ${dateBR(s.fim)}</td><td class="num">${s.itens.length}</td>
        <td class="num pos">${money(s.itens.filter(i => i.valor > 0).reduce((a, i) => a + i.valor, 0))}</td><td class="num neg">${money(s.itens.filter(i => i.valor < 0).reduce((a, i) => a + i.valor, 0))}</td>
        <td class="num">${s.saldo != null ? money(s.saldo) : '–'}${s.saldoData ? `<div class="small muted">${dateBR(s.saldoData)}</div>` : ''}</td>
        <td><select data-conta>${options(state.cad.contas.filter(c => c.ativo !== false), { empty: 'Selecione…', selected: s.contaId })}</select></td></tr>`).join('')}</tbody></table></div>
      <label style="flex-direction:row;align-items:center;gap:6px;margin-top:8px"><input type="checkbox" id="lembrar" checked> Lembrar a conta do OFX no cadastro da conta bancária</label>` : '<div class="empty">Nenhum extrato lido.</div>';
    const ok = () => { $('#ok', m.el).disabled = !lidos.length || lidos.some(s => !s.contaId); };
    $('#res', m.el).onchange = (ev) => { const tr = ev.target.closest('tr[data-k]'); if (tr && ev.target.matches('[data-conta]')) { lidos[+tr.dataset.k].contaId = ev.target.value; ok(); } };
    ok();
  };
  $('#ok', m.el).onclick = async () => {
    const btn = $('#ok', m.el); btn.disabled = true; const e = state.empresa.id; let novos = 0, total = 0, atual = '';
    try {
      for (const s of lidos) {
        atual = s.arquivo;
        const imp = await q(sb.from('extrato_importacoes').insert({ empresa_id: e, conta_id: s.contaId, arquivo: s.arquivo, banco: s.banco, agencia: s.agencia, conta_ofx: s.conta,
          dt_inicio: s.inicio, dt_fim: s.fim, saldo_final: s.saldo, saldo_data: s.saldoData || s.fim, qtd: s.itens.length }).select().single());
        let n = 0;
        for (let i = 0; i < s.itens.length; i += 500) {
          const rows = s.itens.slice(i, i + 500).map(x => ({ ...x, empresa_id: e, conta_id: s.contaId, importacao_id: imp.id }));
          const ins = await q(sb.from('extrato_itens').upsert(rows, { onConflict: 'empresa_id,conta_id,fitid', ignoreDuplicates: true }).select('id'));
          n += ins?.length || 0;
        }
        await q(sb.from('extrato_importacoes').update({ novos: n }).eq('id', imp.id));
        novos += n; total += s.itens.length;
        const ct = state.cad.contaById[s.contaId];
        if ($('#lembrar', m.el)?.checked && s.conta && dig(ct?.ofx_conta) !== dig(s.conta)) { await q(sb.from('contas').update({ ofx_banco: s.banco, ofx_conta: s.conta }).eq('id', s.contaId)); Object.assign(ct, { ofx_banco: s.banco, ofx_conta: s.conta }); }
      }
      toast(`${novos} movimento(s) novo(s) de ${total} lido(s)${total - novos ? ` · ${total - novos} já existiam` : ''}`);
      const ult = lidos[lidos.length - 1]; ui.conta = ult.contaId;
      // abre no mês com mais movimentos (o Bradesco acrescenta os lançamentos dos últimos dias ao extrato do período)
      const pm = {}; for (const i of ult.itens) pm[i.data.slice(0, 7)] = (pm[i.data.slice(0, 7)] || 0) + 1;
      const mm = Object.entries(pm).sort((a, b) => b[1] - a[1])[0]?.[0]; if (mm) ui.mes = mm;
      ui.sels.clear(); ui.filtro = 'pendente'; m.close(); render(root);
    } catch (err) { fail(new Error(`Falha ao importar ${atual}: ${err.message || err}`)); btn.disabled = false; }
  };
}

async function historico(root) {
  let imps = [];
  try { imps = await q(sb.from('extrato_importacoes').select('*').eq('empresa_id', state.empresa.id).eq('conta_id', ui.conta).order('created_at', { ascending: false }).limit(100)); } catch (e) { return fail(e); }
  const m = modal({ title: `Importações — ${state.cad.contaById[ui.conta]?.nome || ''}`, wide: true,
    body: imps.length ? `<div class="table-wrap"><table><thead><tr><th>Importado em</th><th>Arquivo</th><th>Período</th><th class="num">Lidos</th><th class="num">Novos</th><th class="num">Saldo final</th><th></th></tr></thead><tbody>
      ${imps.map(i => `<tr data-id="${i.id}"><td class="small">${new Date(i.created_at).toLocaleString('pt-BR')}</td><td class="small wrap">${esc(i.arquivo || '')}</td><td class="small">${dateBR(i.dt_inicio)} a ${dateBR(i.dt_fim)}</td>
        <td class="num">${i.qtd}</td><td class="num">${i.novos}</td><td class="num">${i.saldo_final != null ? money(i.saldo_final) : '–'}</td>
        <td>${podeEditar() ? '<button class="btn small danger" data-del>Excluir</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Excluir remove os movimentos trazidos por aquela importação que ainda não foram conciliados (use quando o arquivo foi importado na conta errada).</p>` : '<div class="empty">Nenhuma importação nesta conta.</div>' });
  m.el.addEventListener('click', async (e) => {
    const tr = e.target.closest('[data-del]')?.closest('tr[data-id]'); if (!tr) return;
    try {
      const conc = await q(sb.from('extrato_itens').select('id').eq('importacao_id', tr.dataset.id).eq('status', 'conciliado').limit(1));
      if (conc.length) return toast('Há movimentos desta importação já conciliados: desfaça as conciliações antes.', true);
      if (!confirm('Excluir esta importação e os movimentos não conciliados que ela trouxe?')) return;
      await q(sb.from('extrato_itens').delete().eq('importacao_id', tr.dataset.id));
      await q(sb.from('extrato_importacoes').delete().eq('id', tr.dataset.id));
      toast('Importação excluída'); m.close(); carregar(root);
    } catch (err) { fail(err); }
  });
}

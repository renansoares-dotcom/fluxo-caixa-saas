import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, cls, dateBR, options, MESES_CURTO, debounce, exportXLSX, fail, toast } from '../lib/ui.js';
import { abrirLancamento } from '../lib/lanc-form.js';

export const title = 'Lançamentos';
const PAGE = 100;
const f = { mes: new Date().getMonth() + 1, status: '', classe: '', conta: '', cc: '', busca: '', page: 0 };

export async function render(root) {
  const c = state.cad;
  root.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div class="chips" id="meses">${['Ano', ...MESES_CURTO].map((m, i) => `<span class="chip ${f.mes === i ? 'on' : ''}" data-m="${i}">${m}</span>`).join('')}</div>
        <div style="display:flex;gap:8px">
          <button class="btn" id="exp">Exportar Excel</button>
          ${podeEditar() ? '<button class="btn primary" id="novo">+ Novo lançamento</button>' : ''}
        </div>
      </div>
      <div class="toolbar" id="flt">
        <label class="grow">Buscar<input name="busca" placeholder="Descrição, favorecido, opcional…" value="${esc(f.busca)}"></label>
        <label>Status<select name="status">${options([{ id: 'Pago' }, { id: 'Em aberto' }], { label: 'id', empty: 'Todos', selected: f.status })}</select></label>
        <label>Classificação<select name="classe">${options(c.classes, { label: 'label', empty: 'Todas', selected: f.classe })}</select></label>
        <label>Conta<select name="conta">${options(c.contas, { empty: 'Todas', selected: f.conta })}<option value="none" ${f.conta === 'none' ? 'selected' : ''}>(sem conta)</option></select></label>
        <label>C. Custo<select name="cc">${options(c.cc, { empty: 'Todos', selected: f.cc })}</select></label>
      </div>
    </div>
    <div class="kpis" id="tot"></div>
    <div class="card flush">
      ${podeEditar() ? `<div class="toolbar" style="padding:10px 12px" id="bulk"><span class="muted small" id="sel-info">Nenhum selecionado</span>
        <button class="btn small" id="baixar" disabled>Marcar como pago</button>
        <button class="btn small danger" id="excluir" disabled>Excluir selecionados</button></div>` : ''}
      <div class="table-wrap" id="tbl"></div>
      <div class="pager" id="pager"></div>
    </div>`;

  $('#meses', root).onclick = (e) => { const m = e.target.dataset.m; if (m == null) return; f.mes = +m; f.page = 0; render(root); };
  $('#flt', root).addEventListener('input', debounce((e) => { f[e.target.name] = e.target.value; f.page = 0; load(root); }, 350));
  $('#novo', root) && ($('#novo', root).onclick = () => abrirLancamento({ data: defaultDate() }, () => load(root)));
  $('#exp', root).onclick = () => exportar();
  if (podeEditar()) {
    $('#baixar', root).onclick = async () => {
      const ids = selecionados(root); if (!ids.length) return;
      try { const n = await q(sb.rpc('baixar_lancamentos', { p_ids: ids })); toast(`${n} lançamento(s) marcados como pago`); load(root); } catch (e) { fail(e); }
    };
    $('#excluir', root).onclick = async () => {
      const ids = selecionados(root); if (!ids.length || !confirm(`Excluir ${ids.length} lançamento(s)?`)) return;
      try { await q(sb.from('lancamentos').delete().in('id', ids)); toast('Excluídos'); load(root); } catch (e) { fail(e); }
    };
  }
  await load(root);
}

function defaultDate() {
  const d = new Date(); const m = f.mes || d.getMonth() + 1;
  const day = (state.ano === d.getFullYear() && m === d.getMonth() + 1) ? d.getDate() : 1;
  return `${state.ano}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function base(sel = '*', opts) {
  let qy = sb.from('v_lancamentos').select(sel, opts).eq('empresa_id', state.empresa.id);
  if (f.mes) {
    const ini = `${state.ano}-${String(f.mes).padStart(2, '0')}-01`;
    const fim = new Date(state.ano, f.mes, 0).getDate();
    qy = qy.gte('data', ini).lte('data', `${state.ano}-${String(f.mes).padStart(2, '0')}-${fim}`);
  } else qy = qy.eq('ano', state.ano);
  if (f.status) qy = qy.eq('status', f.status);
  if (f.classe) qy = qy.eq('classe_id', f.classe);
  if (f.conta === 'none') qy = qy.is('conta_id', null); else if (f.conta) qy = qy.eq('conta_id', f.conta);
  if (f.cc) qy = qy.eq('centro_custo_id', f.cc);
  if (f.busca) {
    const s = f.busca.replace(/[%,()]/g, ' ').trim();
    qy = qy.or(`descricao.ilike.%${s}%,favorecido_nome.ilike.%${s}%,opc1.ilike.%${s}%,plano_nome.ilike.%${s}%`);
  }
  return qy;
}

async function load(root) {
  const tbl = $('#tbl', root);
  try {
    const [{ data, count, error }, tot] = await Promise.all([
      base('*', { count: 'exact' }).order('data').order('created_at').range(f.page * PAGE, f.page * PAGE + PAGE - 1),
      fetchAll(() => base('tipo,valor_sinal,status')),
    ]);
    if (error) throw error;
    const ent = tot.filter(t => t.tipo === 'E').reduce((s, t) => s + +t.valor_sinal, 0);
    const sai = tot.filter(t => t.tipo === 'S').reduce((s, t) => s + +t.valor_sinal, 0);
    const trf = tot.filter(t => t.tipo === 'T').reduce((s, t) => s + +t.valor_sinal, 0);
    $('#tot', root).innerHTML = `
      <div class="kpi"><div class="k-label">Lançamentos</div><div class="k-value">${count.toLocaleString('pt-BR')}</div></div>
      <div class="kpi"><div class="k-label">Entradas</div><div class="k-value pos">${money(ent)}</div></div>
      <div class="kpi"><div class="k-label">Saídas</div><div class="k-value neg">${money(sai)}</div></div>
      <div class="kpi"><div class="k-label">Resultado</div><div class="k-value ${cls(ent + sai)}">${money(ent + sai)}</div><div class="k-sub">Transferências: ${money(trf)}</div></div>`;
    if (!data.length) { tbl.innerHTML = '<div class="empty">Nenhum lançamento encontrado.</div>'; $('#pager', root).innerHTML = ''; return; }
    tbl.innerHTML = `<table><thead><tr>${podeEditar() ? '<th><input type="checkbox" id="all"></th>' : ''}
      <th>Data</th><th>Plano de contas</th><th>Descrição</th><th>Favorecido</th><th>C. Custo</th><th>Conta</th><th>Status</th><th class="num">Valor</th></tr></thead>
      <tbody>${data.map(l => `<tr class="clickable" data-id="${l.id}">
        ${podeEditar() ? `<td><input type="checkbox" class="sel" value="${l.id}"></td>` : ''}
        <td>${dateBR(l.data)}</td><td>${esc(l.plano_codigo + ' - ' + l.plano_nome)}</td>
        <td class="wrap">${esc(l.descricao || '')}${l.opc1 ? `<div class="muted small">${esc(l.opc1)}</div>` : ''}</td>
        <td class="wrap">${esc(l.favorecido_nome || '')}</td><td>${esc(l.centro_custo_nome || '')}</td>
        <td>${esc(l.conta_nome || '—')}</td>
        <td><span class="badge ${l.status === 'Pago' ? 'pago' : 'aberto'}">${l.status}</span></td>
        <td class="num ${cls(l.valor_sinal)}">${money(l.valor_sinal)}</td></tr>`).join('')}</tbody></table>`;
    const pages = Math.ceil(count / PAGE);
    $('#pager', root).innerHTML = `<span class="muted small">Página ${f.page + 1} de ${pages}</span>
      <button class="btn small" id="pv" ${f.page ? '' : 'disabled'}>‹ Anterior</button>
      <button class="btn small" id="nx" ${f.page + 1 < pages ? '' : 'disabled'}>Próxima ›</button>`;
    $('#pv', root).onclick = () => { f.page--; load(root); };
    $('#nx', root).onclick = () => { f.page++; load(root); };
    tbl.onclick = (e) => {
      if (e.target.matches('input')) return updSel(root);
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      abrirLancamento(data.find(x => x.id === tr.dataset.id), () => load(root));
    };
    const all = $('#all', root);
    if (all) all.onchange = () => { $$('.sel', root).forEach(c => c.checked = all.checked); updSel(root); };
    updSel(root);
  } catch (e) { fail(e); }
}

const selecionados = (root) => $$('.sel:checked', root).map(c => c.value);
function updSel(root) {
  if (!podeEditar()) return;
  const n = selecionados(root).length;
  $('#sel-info', root).textContent = n ? `${n} selecionado(s)` : 'Nenhum selecionado';
  $('#baixar', root).disabled = $('#excluir', root).disabled = !n;
}

async function exportar() {
  try {
    const rows = await fetchAll(() => base('*').order('data'));
    exportXLSX([
      ['Data', 'Classificação', 'Plano de contas', 'Descrição', 'Opcional 1', 'Opcional 2', 'Opcional 3', 'Opcional 4', 'Favorecido', 'Centro de custo', 'Status', 'Conta', 'Valor', 'Grupo', 'Disponibilidade'],
      ...rows.map(l => [l.data, `${l.classe_codigo} - ${l.classe_nome}`, `${l.plano_codigo} - ${l.plano_nome}`, l.descricao, l.opc1, l.opc2, l.opc3, l.opc4,
        l.favorecido_nome, l.centro_custo_nome, l.status, l.conta_nome, +l.valor_sinal, l.grupo_nome, l.disponibilidade])
    ], `lancamentos_${state.ano}${f.mes ? '_' + String(f.mes).padStart(2, '0') : ''}`);
  } catch (e) { fail(e); }
}

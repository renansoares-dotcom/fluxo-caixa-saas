import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, cls, dateBR, today, options, exportXLSX, fail, toast, modal, MESES_CURTO } from '../lib/ui.js';
import { abrirLancamento } from '../lib/lanc-form.js';

export const title = 'Contas a pagar / receber';
const f = { aba: 'S', de: '', ate: '', conta: '', busca: '' };
const ABAS = [['S', 'A pagar'], ['E', 'A receber'], ['INAD', 'Inadimplentes'], ['T', 'Transferências'], ['MES', 'Resumo mensal']];

export async function render(root) {
  root.innerHTML = `<div class="card"><div class="card-head">
      <div class="chips" id="abas">${ABAS.map(([k, n]) => `<span class="chip ${f.aba === k ? 'on' : ''}" data-k="${k}">${n}</span>`).join('')}</div>
      <div style="display:flex;gap:8px"><button class="btn" id="exp">Exportar Excel</button>${podeEditar() ? '<button class="btn primary" id="novo">+ Novo título</button>' : ''}</div></div>
    <div class="toolbar" id="flt">
      <label>Vencimento de<input type="date" name="de" value="${f.de}"></label>
      <label>até<input type="date" name="ate" value="${f.ate}"></label>
      <label>Conta<select name="conta">${options(state.cad.contas, { empty: 'Todas', selected: f.conta })}</select></label>
      <label class="grow">Buscar<input name="busca" value="${esc(f.busca)}" placeholder="Favorecido, descrição…"></label>
    </div></div>
    <div class="kpis" id="kp"></div>
    <div class="card flush">${podeEditar() ? `<div class="toolbar" style="padding:10px 12px"><span class="muted small" id="si">Nenhum selecionado</span>
      <label style="flex-direction:row;align-items:center;gap:6px">Data do pagamento <input type="date" id="dt-baixa" value="${today()}"></label>
      <button class="btn small" id="baixar" disabled>Baixar selecionados</button></div>` : ''}
      <div class="table-wrap" id="tbl"></div></div>`;
  $('#abas', root).onclick = (e) => { if (e.target.dataset.k) { f.aba = e.target.dataset.k; render(root); } };
  $('#flt', root).addEventListener('change', (e) => { f[e.target.name] = e.target.value; load(root); });
  $('#novo', root) && ($('#novo', root).onclick = () => abrirLancamento({ status: 'Em aberto' }, () => load(root)));
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), `em_aberto_${f.aba}`);
  if (podeEditar()) $('#baixar', root).onclick = async () => {
    const ids = $$('.sel:checked', root).map(c => c.value);
    try { const n = await q(sb.rpc('baixar_lancamentos', { p_ids: ids, p_data: $('#dt-baixa', root).value || null })); toast(`${n} título(s) baixado(s)`); load(root); } catch (e) { fail(e); }
  };
  await load(root);
}

async function load(root) {
  const tbl = $('#tbl', root);
  try {
    let rows = await fetchAll(() => {
      let qy = sb.from('v_lancamentos').select('*').eq('empresa_id', state.empresa.id).eq('status', 'Em aberto');
      if (f.de) qy = qy.gte('data', f.de); if (f.ate) qy = qy.lte('data', f.ate);
      if (f.conta) qy = qy.eq('conta_id', f.conta);
      return qy.order('data');
    });
    if (f.busca) { const s = f.busca.toLowerCase(); rows = rows.filter(r => `${r.favorecido_nome} ${r.descricao} ${r.plano_nome} ${r.documento || ''}`.toLowerCase().includes(s)); }
    const hoje = today();
    const sum = (a) => a.reduce((s, x) => s + Math.abs(+x.valor_sinal), 0);
    const pag = rows.filter(r => r.tipo === 'S'), rec = rows.filter(r => r.tipo === 'E');
    $('#kp', root).innerHTML = `
      <div class="kpi"><div class="k-label">A pagar</div><div class="k-value neg">${money(sum(pag))}</div><div class="k-sub">${pag.length} título(s)</div></div>
      <div class="kpi"><div class="k-label">A pagar vencido</div><div class="k-value neg">${money(sum(pag.filter(r => r.data < hoje)))}</div></div>
      <div class="kpi"><div class="k-label">A receber</div><div class="k-value pos">${money(sum(rec))}</div><div class="k-sub">${rec.length} título(s)</div></div>
      <div class="kpi"><div class="k-label">Inadimplência</div><div class="k-value neg">${money(sum(rec.filter(r => r.data < hoje)))}</div></div>
      <div class="kpi"><div class="k-label">Saldo projetado</div><div class="k-value ${cls(sum(rec) - sum(pag))}">${money(sum(rec) - sum(pag))}</div></div>`;

    if (f.aba === 'MES') {
      const ano = {}; for (const r of rows) { const k = r.data.slice(0, 7); (ano[k] ||= { E: 0, S: 0 }); if (r.tipo !== 'T') ano[k][r.tipo] += Math.abs(+r.valor_sinal); }
      const ks = Object.keys(ano).sort();
      tbl.innerHTML = ks.length ? `<table><thead><tr><th>Mês</th><th class="num">A receber</th><th class="num">A pagar</th><th class="num">Saldo</th></tr></thead><tbody>
        ${ks.map(k => `<tr><td>${MESES_CURTO[+k.slice(5) - 1]}/${k.slice(0, 4)}</td><td class="num pos">${money(ano[k].E)}</td><td class="num neg">${money(ano[k].S)}</td><td class="num ${cls(ano[k].E - ano[k].S)}">${money(ano[k].E - ano[k].S)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nada em aberto.</div>';
      return;
    }
    const lista = f.aba === 'INAD' ? rec.filter(r => r.data < hoje) : rows.filter(r => r.tipo === f.aba);
    if (!lista.length) { tbl.innerHTML = '<div class="empty">Nada em aberto aqui.</div>'; return; }
    tbl.innerHTML = `<table><thead><tr>${podeEditar() ? '<th><input type="checkbox" id="all"></th>' : ''}<th>Vencimento</th><th>Dias</th><th>Favorecido</th><th>Descrição</th><th>Plano de contas</th><th>Conta</th><th>Prioridade</th><th class="num">Valor</th></tr></thead><tbody>
      ${lista.map(r => { const dias = Math.floor((new Date(hoje) - new Date(r.data)) / 864e5);
        return `<tr class="clickable" data-id="${r.id}">${podeEditar() ? `<td><input type="checkbox" class="sel" value="${r.id}"></td>` : ''}
        <td>${dateBR(r.data)}</td><td>${dias > 0 ? `<span class="badge vencido">${dias} d atraso</span>` : `<span class="muted small">em ${-dias} d</span>`}</td>
        <td class="wrap">${esc(r.favorecido_nome || '')}</td><td class="wrap">${esc(r.descricao || '')}${r.documento && !(r.descricao || '').includes(r.documento) ? `<div class="muted small">NF ${esc(r.documento)}</div>` : ''}</td><td>${esc(r.plano_codigo + ' - ' + r.plano_nome)}</td>
        <td>${esc(r.conta_nome || '—')}</td><td>${r.tipo === 'S' ? `<span class="badge ${r.prioridade_efetiva === 'Obrigatório' ? 'obrig' : 'negoc'}">${r.prioridade_efetiva}</span>` : ''}</td>
        <td class="num ${cls(r.valor_sinal)}">${money(r.valor_sinal)}</td></tr>`; }).join('')}
      <tr class="row-total">${podeEditar() ? '<td></td>' : ''}<td colspan="7">Total</td><td class="num">${money(lista.reduce((s, r) => s + +r.valor_sinal, 0))}</td></tr></tbody></table>`;
    tbl.onclick = (e) => {
      if (e.target.matches('input')) { const n = $$('.sel:checked', root).length; if ($('#si', root)) { $('#si', root).textContent = n ? `${n} selecionado(s)` : 'Nenhum selecionado'; $('#baixar', root).disabled = !n; } return; }
      const tr = e.target.closest('tr[data-id]'); if (tr) abrirLancamento(lista.find(x => x.id === tr.dataset.id), () => load(root));
    };
    const all = $('#all', root); if (all) all.onchange = () => { $$('.sel', root).forEach(c => c.checked = all.checked); tbl.onclick({ target: all }); };
  } catch (e) { fail(e); }
}

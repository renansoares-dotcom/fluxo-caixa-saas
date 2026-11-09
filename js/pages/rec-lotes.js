// Recuperadora › Lotes (REC003): lotes de entrada (compra), de apara interna e (parte 2) de grão, com saldo, custo por kg,
// origem (ticket ou apontamentos), bloqueio, observação e etiqueta com QR.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, toast, fail, modal, exportXLSX } from '../lib/ui.js';
import { carregarRec, podeConfig, kpi, kg, kg0, rkg, badgeLote, semSQL, avisoSQL, desligada, avisoDesligada, nomeMat } from '../lib/rec-ui.js';
import { TIPOS_LOTE, SIT_LOTE, estoquePorMaterial } from '../lib/recuperadora.js';
import { qrSvg } from '../lib/crachas.js';

export const title = 'Lotes da Recuperadora';
const ui = { tipo: '', mat: '', sit: 'ativos', busca: '' };

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const R = await carregarRec();
    if (desligada(R)) { root.innerHTML = avisoDesligada(); return; }
    let qy = sb.from('rec_lotes').select('*').eq('empresa_id', state.empresa.id).order('data', { ascending: false }).order('codigo', { ascending: false }).limit(2000);
    if (ui.sit === 'ativos') qy = qy.in('situacao', ['disponivel', 'bloqueado', 'em_processo']); else if (ui.sit) qy = qy.eq('situacao', ui.sit);
    if (ui.tipo) qy = qy.eq('tipo', ui.tipo); if (ui.mat) qy = qy.eq('material_id', ui.mat);
    const L = (await q(qy)).filter(l => !ui.busca || `${l.codigo} ${R.fornById[l.fornecedor_id]?.nome || ''} ${l.observacao || ''}`.toLowerCase().includes(ui.busca));
    const E = estoquePorMaterial(L), tot = [...E.values()].reduce((s, x) => ({ kg: s.kg + x.kg, c: s.c + x.custo }), { kg: 0, c: 0 });
    root.innerHTML = `<div class="kpis">${kpi('Saldo em lotes', kg0(tot.kg), `${L.filter(l => ['disponivel', 'bloqueado'].includes(l.situacao)).length} lote(s) disponíveis ou bloqueados`)}
        ${kpi('Custo do saldo', money(tot.c), tot.kg ? `${rkg(tot.c / tot.kg)} por kg` : '')}${kpi('Bloqueados', L.filter(l => l.situacao === 'bloqueado').length, '', L.some(l => l.situacao === 'bloqueado') ? 'warn' : '')}</div>
      <div class="card toolbar" style="margin-top:12px">
        <label class="small">Tipo<select id="rl-t"><option value="">Todos</option>${Object.entries(TIPOS_LOTE).map(([k, t]) => `<option value="${k}" ${ui.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="small">Material<select id="rl-m"><option value="">Todos</option>${R.mats.map(m => `<option value="${m.id}" ${ui.mat === m.id ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.nome)}</option>`).join('')}</select></label>
        <label class="small">Situação<select id="rl-s"><option value="ativos" ${ui.sit === 'ativos' ? 'selected' : ''}>Em estoque</option><option value="" ${!ui.sit ? 'selected' : ''}>Todas</option>${Object.entries(SIT_LOTE).map(([k, [t]]) => `<option value="${k}" ${ui.sit === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="grow small">Buscar<input id="rl-b" value="${esc(ui.busca)}" placeholder="código, fornecedor ou observação"></label>
        <button class="btn" id="rl-et">Etiquetas dos marcados</button><button class="btn" id="rl-x">Excel</button></div>
      <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:62vh" id="rl-tab"><table><thead><tr><th><input type="checkbox" id="rl-all"></th><th>Lote</th><th>Material</th><th>Origem</th>
        <th class="num">Peso</th><th class="num">Saldo</th><th class="num">R$/kg</th><th>Situação</th></tr></thead><tbody>
        ${L.map(l => `<tr class="clickable" data-id="${l.id}"><td><input type="checkbox" class="rl-c" value="${l.id}"></td><td><b>${esc(l.codigo)}</b><div class="small muted">${TIPOS_LOTE[l.tipo]} · ${dateBR(l.data)}</div>${l.observacao ? `<div class="small muted">${esc(l.observacao)}</div>` : ''}</td>
          <td>${esc(nomeMat(R, l.material_id))}${l.classe_id ? `<div class="small muted">classe ${esc(R.claById[l.classe_id]?.codigo || '')}</div>` : ''}</td><td class="small">${l.fornecedor_id ? esc(R.fornById[l.fornecedor_id]?.nome || '') : l.tipo === 'apara' ? 'apontamentos da produção' : ''}</td><td class="num">${kg(l.peso_kg)}</td><td class="num">${kg(l.saldo_kg)}</td><td class="num">${+l.peso_kg ? rkg(l.custo_total / l.peso_kg) : '–'}</td><td>${badgeLote(l.situacao)}</td></tr>`).join('')
          || '<tr><td colspan="8" class="empty">Nenhum lote. Os lotes nascem ao fechar o ticket da balança e, nas aparas internas, a cada apontamento encerrado com refugo.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">O saldo é consumido pelo processamento (parte 2 da Recuperadora). Lote bloqueado não entra no processamento até ser liberado.</p>`;
    $('#rl-t', root).onchange = (e) => { ui.tipo = e.target.value; render(root); };
    $('#rl-m', root).onchange = (e) => { ui.mat = e.target.value; render(root); };
    $('#rl-s', root).onchange = (e) => { ui.sit = e.target.value; render(root); };
    let tm; $('#rl-b', root).oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { ui.busca = e.target.value.toLowerCase().trim(); render(root); }, 350); };
    $('#rl-x', root).onclick = () => exportXLSX($('#rl-tab table', root), 'lotes_recuperadora');
    $('#rl-all', root).onchange = (e) => $$('.rl-c', root).forEach(x => { x.checked = e.target.checked; });
    $('#rl-et', root).onclick = () => { const ids = $$('.rl-c:checked', root).map(x => x.value); if (!ids.length) return toast('Marque os lotes', true); etiquetas(R, L.filter(l => ids.includes(l.id))); };
    root.querySelector('tbody').onclick = (e) => { if (e.target.closest('input')) return; const id = e.target.closest('tr[data-id]')?.dataset.id; if (id) abrir(R, L.find(l => l.id === id), root); };
  } catch (err) { root.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

async function abrir(R, l, root) {
  const pode = podeConfig();
  let origem = '';
  if (l.ticket_item_id) {
    const [it] = await q(sb.from('rec_ticket_itens').select('*, ticket:rec_tickets(numero, data_hora, placa, nf_numero)').eq('id', l.ticket_item_id));
    if (it) origem = `<p class="small">Ticket <b>${it.ticket.numero}</b> de ${new Date(it.ticket.data_hora).toLocaleString('pt-BR')}${it.ticket.placa ? ` · placa ${esc(it.ticket.placa)}` : ''}${it.ticket.nf_numero ? ` · NF ${esc(it.ticket.nf_numero)}` : ' · sem nota'}<br>
      Pesado ${kg(it.peso_kg)} · desconto ${String(it.desconto_pct).replace('.', ',')}% · pago ${kg(it.peso_pago)} a ${rkg(it.preco_kg)}/kg</p>`;
  } else if (l.tipo === 'apara') {
    const regs = await q(sb.from('rec_apara_registros').select('apontamento_id, kg').eq('lote_id', l.id));
    origem = `<p class="small">${regs.length} apontamento(s) da produção com refugo encerrados em ${dateBR(l.data)}.</p>`;
  }
  const md = modal({ title: `Lote ${l.codigo}`, body: `<div class="kpis">${kpi('Peso', kg(l.peso_kg))}${kpi('Saldo', kg(l.saldo_kg))}${kpi('Custo', money(l.custo_total), +l.peso_kg ? rkg(l.custo_total / l.peso_kg) + '/kg' : '')}</div>
      <p>${TIPOS_LOTE[l.tipo]} · ${esc(nomeMat(R, l.material_id))}${l.classe_id ? ' · classe ' + esc(R.claById[l.classe_id]?.codigo || '') : ''} · ${badgeLote(l.situacao)}</p>${origem}
      <label>Observação<input id="lt-o" value="${esc(l.observacao || '')}" ${pode ? '' : 'disabled'}></label>`,
    foot: `${pode && ['disponivel', 'bloqueado'].includes(l.situacao) ? `<button class="btn ${l.situacao === 'bloqueado' ? '' : 'danger'}" id="lt-b">${l.situacao === 'bloqueado' ? 'Liberar' : 'Bloquear'}</button>` : ''}<span class="spacer"></span>
      <button class="btn" id="lt-et">Etiqueta</button>${pode ? '<button class="btn primary" id="lt-ok">Salvar</button>' : '<button class="btn" data-close>Fechar</button>'}` });
  $('#lt-et', md.el).onclick = () => etiquetas(R, [l]);
  $('#lt-ok', md.el) && ($('#lt-ok', md.el).onclick = async () => { try { await q(sb.from('rec_lotes').update({ observacao: $('#lt-o', md.el).value.trim() || null }).eq('id', l.id)); md.close(); toast('Lote salvo'); render(root); } catch (err) { fail(err); } });
  $('#lt-b', md.el) && ($('#lt-b', md.el).onclick = async () => { try { await q(sb.from('rec_lotes').update({ situacao: l.situacao === 'bloqueado' ? 'disponivel' : 'bloqueado', observacao: $('#lt-o', md.el).value.trim() || null }).eq('id', l.id)); md.close(); toast(l.situacao === 'bloqueado' ? 'Lote liberado' : 'Lote bloqueado'); render(root); } catch (err) { fail(err); } });
}

async function etiquetas(R, lotes) {
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir as etiquetas', true);
  const qrs = await Promise.all(lotes.map(l => qrSvg(l.codigo).catch(() => '')));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas de lote</title><style>@page{size:100mm 70mm;margin:3mm} body{font-family:Arial,sans-serif;margin:0}
    .et{width:94mm;height:64mm;box-sizing:border-box;border:1px solid #000;padding:3mm;display:grid;grid-template-columns:1fr auto;gap:2mm;page-break-after:always}
    h1{font-size:14px;margin:0 0 1mm} .l{font-size:11px;line-height:1.4} .p{font-size:22px;font-weight:700;margin-top:2mm} .cod{font-family:monospace;font-size:16px;font-weight:700;margin-top:1mm} .qr svg{width:30mm;height:30mm}</style></head><body>
    ${lotes.map((l, k) => `<div class="et"><div><h1>${esc(state.empresa.nome || '')} — Recuperadora</h1><div class="l"><b>${esc(TIPOS_LOTE[l.tipo])}</b> · ${esc(nomeMat(R, l.material_id))}${l.classe_id ? ' · classe ' + esc(R.claById[l.classe_id]?.codigo || '') : ''}<br>
      ${l.fornecedor_id ? esc(R.fornById[l.fornecedor_id]?.nome || '') + '<br>' : ''}Data: ${dateBR(l.data)}</div><div class="p">${String(l.peso_kg).replace('.', ',')} kg</div><div class="cod">${esc(l.codigo)}</div></div><div class="qr">${qrs[k]}</div></div>`).join('')}
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

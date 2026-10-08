// Recebimentos × Notas: liga parcelas das notas de saída aos lançamentos de recebimento já existentes,
// no mesmo modelo da conciliação bancária (duas colunas, seleção dos dois lados, linhas verdes quando o total bate).
// Nenhum lançamento é alterado: o vínculo fica em nfe_vinculos.
import { sb, state, q, fetchAll, podeEditar } from './data.js';
import { $, esc, money, dateBR, fail, toast, modal } from './ui.js';
import { casarNotas, nfDoLancamento } from './nfe-fiscal.js';

const R = { de: '', ate: '', lde: '', late: '', bp: '', bl: '', soSug: false, outrasNF: false, selP: new Set(), selL: new Set() };
let P = [], L = [], SUG = [], NFS = new Set();
const chunks = (arr, k = 150) => { const o = []; for (let i = 0; i < arr.length; i += k) o.push(arr.slice(i, i + k)); return o; };
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const dig = (s) => String(s || '').replace(/\D/g, '');
const raiz = (s) => dig(s).slice(0, 8);
const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 864e5);
const perto = (a, b) => Math.abs(+a - +b) <= 0.05;
const nome1 = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !['LTDA', 'EIRELI', 'IND', 'INDUSTRIA', 'COMERCIO', 'COM', 'DOS', 'DAS', 'DE'].includes(w)).slice(0, 2).join(' ');
const receitas = () => state.cad.contasPlano.filter(p => p.codigo.startsWith('1.01')).map(p => p.id);

// ---------------------------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------------------------
// Parcelas das notas de venda com o que já foi recebido (vínculos) e o que falta
async function parcelasPendentes(e, de, ate) {
  const ps = await fetchAll(() => sb.from('nfe_parcelas').select('id,nota_id,numero,vencimento,valor,a_vista,n:nfe_notas!inner(id,numero,emissao,dest_doc,dest_nome,favorecido_id,situacao,finalidade,tipo,v_nf)')
    .eq('empresa_id', e).gte('vencimento', de).lte('vencimento', ate).eq('n.tipo', 'saida').eq('n.situacao', 'autorizada').eq('n.finalidade', '1').order('vencimento'));
  const notaIds = [...new Set(ps.map(p => p.nota_id))];
  const vinc = [], fidc = [], todasParc = [];
  for (const c of chunks(notaIds)) {
    const [v, f, tp] = await Promise.all([q(sb.from('nfe_vinculos').select('id,nota_id,parcela_id,l:lancamentos(valor)').in('nota_id', c)),
      q(sb.from('nfe_fidc_vinculos').select('parcela_id,t:fidc_titulos(fundo,bordero)').in('nota_id', c)),
      q(sb.from('nfe_parcelas').select('id,nota_id,numero,valor').in('nota_id', c))]);
    vinc.push(...v); fidc.push(...f); todasParc.push(...tp);
  }
  // recebido por parcela; vínculos "pela nota" (sem parcela) cobrem as parcelas em ordem
  const rec = new Map();
  for (const v of vinc) if (v.parcela_id) rec.set(v.parcela_id, (rec.get(v.parcela_id) || 0) + +(v.l?.valor || 0));
  for (const nid of notaIds) {
    let solto = vinc.filter(v => v.nota_id === nid && !v.parcela_id).reduce((s, v) => s + +(v.l?.valor || 0), 0); if (!solto) continue;
    for (const p of todasParc.filter(p => p.nota_id === nid).sort((a, b) => a.numero - b.numero)) { const falta = +p.valor - (rec.get(p.id) || 0); if (falta <= 0) continue; const u = Math.min(falta, solto); rec.set(p.id, (rec.get(p.id) || 0) + u); solto -= u; if (solto <= 0) break; }
  }
  // "nota gêmea": mesmo cliente e valor, emitida até 3 dias depois com número até 5 à frente e já recebida/em borderô → provável cancelada e reemitida
  const gem = new Map();
  if (ps.length) {
    const ems = ps.map(p => p.n.emissao).sort();
    const outras = await fetchAll(() => sb.from('nfe_notas').select('id,numero,emissao,dest_doc,v_nf,v:nfe_vinculos(id),f:nfe_fidc_vinculos(id)').eq('empresa_id', e).eq('tipo', 'saida').eq('situacao', 'autorizada').gte('emissao', ems[0]).lte('emissao', addDias(ems.at(-1), 3)));
    for (const p of ps) {
      if (rec.get(p.id)) continue;
      const t = outras.find(o => o.id !== p.nota_id && o.dest_doc === p.n.dest_doc && o.numero > p.n.numero && o.numero - p.n.numero <= 5 && Math.abs(dias(o.emissao, p.n.emissao)) <= 3 && perto(o.v_nf, p.n.v_nf) && (o.v?.length || o.f?.length));
      if (t) gem.set(p.id, t.numero);
    }
  }
  return ps.map(p => ({ ...p, gemea: gem.get(p.id) || null, recebido: rec.get(p.id) || 0, falta: +(+p.valor - (rec.get(p.id) || 0)).toFixed(2), fidc: fidc.find(f => f.parcela_id === p.id)?.t || null }))
    .filter(p => p.falta > 0.05);
}

// Lançamentos de recebimento (pagos) ainda sem nota
async function recebimentosLivres(e, de, ate) {
  const ids = receitas(); if (!ids.length) return [];
  const ls = await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,favorecido_id,conta_id,status,v:nfe_vinculos(id)')
    .eq('empresa_id', e).eq('status', 'Pago').in('plano_id', ids).gte('data', de).lte('data', ate).order('data'));
  const fav = state.cad.favById;
  return ls.filter(l => !l.v?.length).map(l => ({ ...l, fav_doc: fav[l.favorecido_id]?.documento || null, fav_nome: fav[l.favorecido_id]?.nome || '', nf: nfDoLancamento(l) }));
}

// Sugestões seguras (mesma NF citada: parcela + valor, vários somando a parcela, ou o restante exato da nota)
function sugerir(parcelas, lancs) {
  const porNota = new Map();
  for (const p of parcelas) { const n = porNota.get(p.nota_id) || porNota.set(p.nota_id, { ...p.n, parcelas: [] }).get(p.nota_id); n.parcelas.push({ ...p, valor: p.falta }); }
  const r = casarNotas([...porNota.values()], lancs.map(l => ({ ...l })));
  return r.grupos.filter(g => ['exata', 'soma', 'nota'].includes(g.cat) && g.lancs.length);
}
const linhasDe = (gs) => gs.flatMap(g => g.lancs.map(l => ({ empresa_id: state.empresa.id, nota_id: g.nota.id, parcela_id: g.parcela && !(g.parcelas?.length > 1) ? g.parcela.id : (g.parcelas?.length === 1 ? g.parcelas[0].id : null), lancamento_id: l.id, tipo: g.cat })));

// Vínculo automático após importar: só o que é certo (NF citada + parcela/valor)
export async function autoVincular(notaIds) {
  if (!notaIds?.length) return 0;
  const e = state.empresa.id; const parcelas = [];
  for (const c of chunks(notaIds)) {
    const ps = await q(sb.from('nfe_parcelas').select('id,nota_id,numero,vencimento,valor,a_vista,n:nfe_notas!inner(id,numero,emissao,dest_doc,dest_nome,favorecido_id,situacao,finalidade,tipo)').in('nota_id', c).eq('n.tipo', 'saida').eq('n.situacao', 'autorizada').eq('n.finalidade', '1'));
    parcelas.push(...ps);
  }
  if (!parcelas.length) return 0;
  const vs = new Set(); for (const c of chunks(notaIds)) for (const v of await q(sb.from('nfe_vinculos').select('parcela_id').in('nota_id', c))) vs.add(v.parcela_id);
  const pend = parcelas.filter(p => !vs.has(p.id)).map(p => ({ ...p, falta: +p.valor }));
  if (!pend.length) return 0;
  const emis = pend.map(p => p.n.emissao).sort()[0], venc = pend.map(p => p.vencimento).filter(Boolean).sort().pop() || emis;
  const lancs = await recebimentosLivres(e, addDias(emis, -20), addDias(venc, 120));
  const rows = linhasDe(sugerir(pend, lancs));
  for (const ch of chunks(rows, 300)) await q(sb.from('nfe_vinculos').insert(ch));
  return rows.length;
}

// ---------------------------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------------------------
export async function pintarRecebimentos(c, root, onMudou, mes) {
  if (mes) R.mesGer = mes;
  const e = state.empresa.id;
  if (!R.de) {
    const r = await q(sb.from('nfe_notas').select('emissao').eq('empresa_id', e).eq('tipo', 'saida').order('emissao').limit(1));
    R.de = r[0] ? r[0].emissao.slice(0, 8) + '01' : `${new Date().getFullYear()}-01-01`; R.ate = addDias(hojeISO(), 60);
    R.lde = addDias(R.de, -15); R.late = hojeISO();
  }
  c.innerHTML = `<div class="card"><div class="toolbar" id="rflt">
      <label>Vencimento das parcelas<span class="par" style="display:flex;gap:4px"><input type="date" name="de" value="${R.de}"><input type="date" name="ate" value="${R.ate}"></span></label>
      <label>Data dos recebimentos<span class="par" style="display:flex;gap:4px"><input type="date" name="lde" value="${R.lde}"><input type="date" name="late" value="${R.late}"></span></label>
      <span class="spacer" style="flex:1"></span>
      ${podeEditar() ? '<button class="btn" id="rger">Lançar contas a receber das notas</button><button class="btn primary" id="rsug" disabled>Aceitar sugestões</button>' : ''}</div>
    <p class="small muted" style="margin:8px 0 0">Marque a(s) parcela(s) à esquerda e o(s) recebimento(s) à direita: quando os totais batem as linhas ficam verdes e é só <strong>Vincular</strong>. Ao marcar uma parcela, os recebimentos mais prováveis (mesma NF citada, mesmo cliente, valor e data próximos) sobem para o topo. Os lançamentos não são alterados.</p></div>
    <div class="kpis" id="rkpi"></div>
    <div class="conc-grid"><div class="card flush" id="rpar"><div class="loading">Carregando…</div></div><div class="card flush" id="rlan"></div></div>
    <div class="card flush" id="rfoot" style="position:sticky;bottom:0;z-index:2"></div>`;
  $('#rger', c) && ($('#rger', c).onclick = () => gerarContasReceber(R.mesGer || hojeISO().slice(0, 7), async () => { await carregarDados(c, root, onMudou); onMudou && onMudou(); }));
  $('#rflt', c).onchange = (ev) => { if (ev.target.name) { R[ev.target.name] = ev.target.value; R.selP.clear(); R.selL.clear(); carregarDados(c, root, onMudou); } };
  await carregarDados(c, root, onMudou);
}

async function carregarDados(c, root, onMudou) {
  const e = state.empresa.id;
  try {
    let nums; [P, L, nums] = await Promise.all([parcelasPendentes(e, R.de, R.ate), recebimentosLivres(e, R.lde, R.late),
      fetchAll(() => sb.from('nfe_notas').select('numero').eq('empresa_id', e).eq('tipo', 'saida'))]);
    NFS = new Set(nums.map(n => n.numero));
  }
  catch (err) { fail(err); $('#rpar', c).innerHTML = ''; return; }
  SUG = sugerir(P, L);
  const b = $('#rsug', c); if (b) { b.disabled = !SUG.length; b.textContent = `Aceitar sugestões (${SUG.reduce((s, g) => s + g.lancs.length, 0)})`; b.onclick = () => aceitar(c, root, onMudou); }
  desenhar(c, root, onMudou);
}

// pontuação de um recebimento para as parcelas marcadas
function pontos(l, selP) {
  if (!selP.length) return { s: 0, tags: [] };
  const nums = new Set(selP.map(p => p.n.numero)), raizes = new Set(selP.map(p => raiz(p.n.dest_doc)).filter(Boolean)), favs = new Set(selP.map(p => p.n.favorecido_id).filter(Boolean));
  const tot = selP.reduce((s, p) => s + p.falta, 0); const tags = []; let s = 0;
  if (l.nf.nf != null && nums.has(l.nf.nf)) { s += 100; tags.push('NF citada'); }
  else if (l.nf.nf != null) { s -= 50; tags.push(`cita NF ${l.nf.nf}`); }
  if (favs.has(l.favorecido_id) || (l.fav_doc && raizes.has(raiz(l.fav_doc)))) { s += 40; tags.push('mesmo cliente'); }
  else { const nm = new Set(selP.map(p => nome1(p.n.dest_nome)).filter(Boolean)); if (nm.has(nome1(l.fav_nome))) { s += 25; tags.push('cliente parecido'); } }
  if (perto(l.valor, tot) || selP.some(p => perto(l.valor, p.falta))) { s += 30; tags.push('mesmo valor'); }
  const ref = selP[0].vencimento || selP[0].n.emissao; s -= Math.min(Math.abs(dias(l.data, ref)) / 10, 20);
  return { s, tags };
}

function desenhar(c, root, onMudou) {
  const bp = R.bp.trim().toLowerCase(), bl = R.bl.trim().toLowerCase();
  const selP = P.filter(p => R.selP.has(p.id)), selL = L.filter(l => R.selL.has(l.id));
  const tp = selP.reduce((s, p) => s + p.falta, 0), tl = selL.reduce((s, l) => s + +l.valor, 0), ok = selP.length && selL.length && perto(tp, tl);
  $('#rkpi', c).innerHTML = `
    <div class="kpi"><div class="k-label">Parcelas sem recebimento</div><div class="k-value">${P.length}</div><div class="k-sub">${money(P.reduce((s, p) => s + p.falta, 0))} · vencimento ${dateBR(R.de)} a ${dateBR(R.ate)}</div></div>
    <div class="kpi"><div class="k-label">Recebimentos sem nota</div><div class="k-value">${L.filter(l => l.nf.nf == null || NFS.has(l.nf.nf)).length}</div><div class="k-sub">${dateBR(R.lde)} a ${dateBR(R.late)} · fora os que citam NF ainda não importada</div></div>
    <div class="kpi"><div class="k-label">Sugestões seguras</div><div class="k-value">${SUG.length}</div><div class="k-sub">NF citada no lançamento e valor que fecha</div></div>`;
  const PP = P.filter(p => !bp || `${p.n.numero} ${p.n.dest_nome} ${p.n.dest_doc} ${String(p.falta).replace('.', ',')}`.toLowerCase().includes(bp));
  const pts = new Map(L.map(l => [l.id, pontos(l, selP)]));
  const deFora = (l) => l.nf.nf != null && !NFS.has(l.nf.nf);
  const nFora = L.filter(deFora).length;
  let LL = L.filter(l => (R.outrasNF || !deFora(l)) && (!bl || `${l.descricao || ''} ${l.documento || ''} ${l.fav_nome} ${String(l.valor).replace('.', ',')}`.toLowerCase().includes(bl)));
  if (selP.length) { LL = LL.slice().sort((a, b) => pts.get(b.id).s - pts.get(a.id).s || a.data.localeCompare(b.data)); if (R.soSug) LL = LL.filter(l => pts.get(l.id).tags.length); }
  const conta = (id) => state.cad.contaById[id]?.nome || '—';
  const MAX = 400;
  $('#rpar', c).innerHTML = `<div class="card-head" style="padding:12px 12px 6px"><h2>Parcelas das notas (${PP.length})</h2></div>
    <div class="conc-flt"><input name="bp" placeholder="Buscar NF, cliente, CNPJ ou valor" value="${esc(R.bp)}"></div>
    <div class="table-wrap" style="max-height:62vh"><table><thead><tr><th></th><th>NF / parc.</th><th>Cliente</th><th>Vencimento</th><th class="num">Falta receber</th></tr></thead><tbody>
    ${PP.slice(0, MAX).map(p => `<tr data-p="${p.id}" class="clickable ${R.selP.has(p.id) && ok ? 'conc-ok' : ''}"><td><input type="checkbox" ${R.selP.has(p.id) ? 'checked' : ''}></td>
      <td>${p.n.numero} / ${p.a_vista ? 'à vista' : p.numero}${p.fidc ? ` <span class="badge" title="Antecipada no borderô ${esc(p.fidc.fundo)} ${esc(p.fidc.bordero)}">FIDC</span>` : ''}</td>
      <td class="wrap small">${esc(p.n.dest_nome || '')}${p.gemea ? `<div><span class="badge vencido" title="Mesmo cliente e valor, emitida logo depois e já recebida">provável cancelada → NF ${p.gemea}</span>${podeEditar() ? ` <a href="#" data-canc="${p.nota_id}" data-sub="${p.gemea}">marcar cancelada</a>` : ''}</div>` : ''}</td><td>${dateBR(p.vencimento)}</td>
      <td class="num">${money(p.falta)}${p.recebido > 0.005 ? `<div class="small muted">de ${money(p.valor)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhuma parcela pendente no período.</td></tr>'}
    ${PP.length > MAX ? `<tr><td colspan="5" class="small muted">Mostrando ${MAX} de ${PP.length} — use a busca ou o período.</td></tr>` : ''}</tbody></table></div>`;
  $('#rlan', c).innerHTML = `<div class="card-head" style="padding:12px 12px 6px"><h2>Recebimentos sem nota (${LL.length})</h2>
      ${selP.length ? `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sosug" ${R.soSug ? 'checked' : ''}> só os prováveis</label>` : ''}</div>
    <div class="conc-flt"><input name="bl" placeholder="Buscar descrição, cliente ou valor" value="${esc(R.bl)}">
      ${nFora ? `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="outrasnf" ${R.outrasNF ? 'checked' : ''}> mostrar também os ${nFora} que citam NF ainda não importada</label>` : ''}</div>
    <div class="table-wrap" style="max-height:62vh"><table><thead><tr><th></th><th>Data</th><th>Cliente / descrição</th><th>Conta</th><th class="num">Valor</th></tr></thead><tbody>
    ${LL.slice(0, MAX).map(l => { const t = pts.get(l.id); return `<tr data-l="${l.id}" class="clickable ${R.selL.has(l.id) && ok ? 'conc-ok' : ''}"><td><input type="checkbox" ${R.selL.has(l.id) ? 'checked' : ''}></td><td>${dateBR(l.data)}</td>
      <td class="wrap small">${esc(l.fav_nome || '')}<div class="muted">${esc(l.descricao || '')}${l.documento ? ' · ' + esc(l.documento) : ''}</div>${t.tags.map(x => `<span class="badge ${x === 'NF citada' ? 'pago' : x.startsWith('cita NF') ? 'vencido' : 'aberto'}" style="margin-right:4px">${x}</span>`).join('')}</td>
      <td class="small">${esc(conta(l.conta_id))}</td><td class="num">${money(l.valor)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Nenhum recebimento sem nota no período.</td></tr>'}
    ${LL.length > MAX ? `<tr><td colspan="5" class="small muted">Mostrando ${MAX} de ${LL.length} — marque uma parcela (os prováveis sobem) ou use a busca.</td></tr>` : ''}</tbody></table></div>`;
  const dif = tl - tp;
  $('#rfoot', c).innerHTML = `<div class="conc-foot ${ok ? 'ok' : ''}"><div><strong>${selP.length}</strong> parcela(s) ${money(tp)} · <strong>${selL.length}</strong> recebimento(s) ${money(tl)}
      ${selP.length && selL.length ? (ok ? ' · <span class="pos">totais batem</span>' : ` · diferença <span class="neg">${money(dif)}</span>${dif < 0 ? ' (parcela fica parcial)' : ''}`) : ''}</div>
    <div style="display:flex;gap:8px">${selP.length || selL.length ? '<button class="btn" id="rlimpa">Limpar seleção</button>' : ''}${podeEditar() ? `<button class="btn primary" id="rvinc" ${selP.length && selL.length ? '' : 'disabled'}>Vincular</button>` : ''}</div></div>`;
  // eventos
  for (const [sel, nm] of [['#rpar', 'bp'], ['#rlan', 'bl']]) { let t; const inp = $(`${sel} [name=${nm}]`, c); inp.oninput = (ev) => { clearTimeout(t); t = setTimeout(() => { R[nm] = ev.target.value; desenhar(c, root, onMudou); const i = $(`${sel} [name=${nm}]`, c); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); }; }
  $('#rpar tbody', c).onclick = (ev) => { const ca = ev.target.closest('[data-canc]'); if (ca) { ev.preventDefault(); ev.stopPropagation(); return marcarCancelada(ca.dataset.canc, ca.dataset.sub, async () => { await carregarDados(c, root, onMudou); onMudou && onMudou(); }); } const tr = ev.target.closest('tr[data-p]'); if (!tr) return; const id = tr.dataset.p; R.selP.has(id) ? R.selP.delete(id) : R.selP.add(id); desenhar(c, root, onMudou); };
  $('#rlan tbody', c).onclick = (ev) => { const tr = ev.target.closest('tr[data-l]'); if (!tr) return; const id = tr.dataset.l; R.selL.has(id) ? R.selL.delete(id) : R.selL.add(id); desenhar(c, root, onMudou); };
  $('#outrasnf', c) && ($('#outrasnf', c).onchange = (ev) => { R.outrasNF = ev.target.checked; desenhar(c, root, onMudou); });
  $('#sosug', c) && ($('#sosug', c).onchange = (ev) => { R.soSug = ev.target.checked; desenhar(c, root, onMudou); });
  $('#rlimpa', c) && ($('#rlimpa', c).onclick = () => { R.selP.clear(); R.selL.clear(); desenhar(c, root, onMudou); });
  $('#rvinc', c) && ($('#rvinc', c).onclick = () => vincular(selP, selL, c, root, onMudou));
}

// Distribui os recebimentos nas parcelas marcadas (por vencimento / data) e grava os vínculos
async function vincular(selP, selL, c, root, onMudou) {
  const tp = selP.reduce((s, p) => s + p.falta, 0), tl = selL.reduce((s, l) => s + +l.valor, 0);
  if (!perto(tp, tl) && !confirm(tl < tp ? `Os recebimentos somam ${money(tl)} e as parcelas ${money(tp)}. Vincular assim? A parcela fica parcial (falta ${money(tp - tl)}).`
    : `Os recebimentos somam ${money(tl)}, ${money(tl - tp)} a mais que as parcelas (${money(tp)}). Vincular assim?`)) return;
  const nomes = new Set(selP.map(p => p.n.dest_nome)); const nfs = selL.filter(l => l.nf.nf != null && !selP.some(p => p.n.numero === l.nf.nf));
  if (nfs.length && !confirm(`${nfs.length} recebimento(s) citam outra NF (${[...new Set(nfs.map(l => l.nf.nf))].join(', ')}). Vincular mesmo assim?`)) return;
  const ps = selP.slice().sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || '') || a.n.numero - b.n.numero).map(p => ({ p, resta: p.falta }));
  const rows = []; let i = 0;
  for (const l of selL.slice().sort((a, b) => a.data.localeCompare(b.data))) {
    while (i < ps.length - 1 && ps[i].resta <= 0.05) i++;
    const alvo = ps[i]; alvo.resta -= +l.valor;
    rows.push({ empresa_id: state.empresa.id, nota_id: alvo.p.nota_id, parcela_id: alvo.p.id, lancamento_id: l.id, tipo: perto(tp, tl) ? (selL.length > 1 && selP.length === 1 ? 'soma' : 'manual') : 'parcial' });
  }
  try {
    await q(sb.from('nfe_vinculos').insert(rows));
    toast(`${rows.length} recebimento(s) vinculado(s)${nomes.size === 1 ? ' — ' + [...nomes][0] : ''}`);
    R.selP.clear(); R.selL.clear(); await carregarDados(c, root, onMudou); onMudou && onMudou();
  } catch (err) { fail(String(err.message || err).includes('duplicate') ? new Error('Algum recebimento já estava vinculado a outra nota. Recarregue.') : err); }
}

async function aceitar(c, root, onMudou) {
  const rows = linhasDe(SUG);
  if (!rows.length || !confirm(`Vincular ${rows.length} recebimento(s) a ${SUG.length} parcela(s)/nota(s)? São os casos em que o lançamento cita a NF e o valor fecha com a parcela (ou com o que falta da nota).`)) return;
  try { for (const ch of chunks(rows, 300)) await q(sb.from('nfe_vinculos').insert(ch)); toast(`${rows.length} recebimento(s) vinculado(s)`); R.selP.clear(); R.selL.clear(); await carregarDados(c, root, onMudou); onMudou && onMudou(); }
  catch (err) { fail(err); }
}

// ---------------------------------------------------------------------------------------------
// Contas a receber a partir das notas: cada parcela ainda sem lançamento vira um título Em aberto (1.01.01),
// já ligado à parcela (tipo 'titulo'). Se já existe um lançamento da mesma NF/parcela e valor ainda sem nota,
// ele é ligado em vez de criar outro.
// ---------------------------------------------------------------------------------------------
// periodo: 'AAAA-MM' (mês) ou { de, ate } (datas de emissão)
export function gerarContasReceber(periodo, onDone) {
  const ini = typeof periodo === 'string' ? `${periodo}-01` : periodo.de;
  const fim = typeof periodo === 'string' ? new Date(Date.UTC(+periodo.slice(0, 4), +periodo.slice(5, 7), 0)).toISOString().slice(0, 10) : periodo.ate;
  const contaPad = state.cad.contas.find(c => c.nome === 'BRADESCO'), ccPad = (state.cad.cc || []).find(c => c.nome === 'VENDAS');
  let itens = []; const marc = new Set();
  const m = modal({ title: 'Lançar contas a receber das notas', wide: true, body: `
    <p class="small muted" style="margin-top:0">Cada parcela das notas de venda que ainda não tem lançamento vira um título <strong>Em aberto</strong> (receita 1.01.01, data = vencimento, documento NF-parcela), já ligado à nota.
      Depois ele é baixado pelo borderô (aprovação da proposta), pela conciliação bancária ou manualmente. Parcelas que já têm um lançamento da mesma NF e valor são só ligadas a ele.</p>
    <div class="toolbar"><label>Emissão das notas<span style="display:flex;gap:4px"><input type="date" id="gde" value="${ini}"><input type="date" id="gate" value="${fim}"></span></label>
      <label>Conta prevista<select id="gconta">${state.cad.contas.map(c => `<option value="${c.id}" ${c.id === contaPad?.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Centro de custo<select id="gcc"><option value="">—</option>${(state.cad.cc || []).map(c => `<option value="${c.id}" ${c.id === ccPad?.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <button class="btn" id="gbusca">Buscar parcelas</button></div>
    <div id="gres" style="margin-top:10px"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="gok" disabled>Lançar</button>' });
  const pinta = () => {
    const sel = itens.filter(i => marc.has(i.p.id)); const nCriar = sel.filter(i => !i.existente).length, nLigar = sel.length - nCriar;
    $('#gres', m.el).innerHTML = !itens.length ? '<div class="empty">Nenhuma parcela sem lançamento nas notas desse período.</div>' : `
      <p class="small"><strong>${itens.length}</strong> parcela(s) sem lançamento · ${money(itens.reduce((s, i) => s + +i.p.valor, 0))}. Marcadas: ${nCriar} título(s) novo(s)${nLigar ? ` + ${nLigar} ligada(s) a lançamento existente` : ''} · ${money(sel.reduce((s, i) => s + +i.p.valor, 0))}
        <a href="#" id="gtodos">marcar todas</a> · <a href="#" id="gnenhum">desmarcar</a></p>
      <div class="table-wrap" style="max-height:50vh"><table><thead><tr><th></th><th>NF / parcela</th><th>Emissão</th><th>Cliente</th><th>Vencimento</th><th class="num">Valor</th><th>O que será feito</th></tr></thead><tbody>
      ${itens.map(i => `<tr data-g="${i.p.id}" class="clickable"><td><input type="checkbox" ${marc.has(i.p.id) ? 'checked' : ''}></td><td>${i.p.n.numero} / ${i.p.a_vista ? 'à vista' : i.p.numero}</td><td>${dateBR(i.p.n.emissao)}</td>
        <td class="wrap small">${esc(i.fav?.nome || i.p.n.dest_nome || '')}${i.fav ? '' : ' <span class="badge vencido">sem cadastro</span>'}</td><td>${dateBR(i.p.vencimento)}</td><td class="num">${money(i.p.valor)}</td>
        <td class="small">${i.existente ? `ligar a ${esc(i.existente.descricao || '')} (${dateBR(i.existente.data)}, ${esc(i.existente.status)})` : 'criar título em aberto'}</td></tr>`).join('')}</tbody></table></div>`;
    const b = $('#gok', m.el); b.disabled = !sel.length || sel.some(i => !i.fav && !i.existente); b.textContent = sel.length ? `Lançar ${sel.length}` : 'Lançar';
    if (sel.some(i => !i.fav && !i.existente)) b.title = 'Há parcela marcada de cliente sem cadastro: atualize o cadastro pelas NF-e ou desmarque';
  };
  const buscar = async () => {
    $('#gres', m.el).innerHTML = '<div class="loading">Procurando…</div>';
    try {
      const e = state.empresa.id, de = $('#gde', m.el).value, ate = $('#gate', m.el).value;
      const ps = await fetchAll(() => sb.from('nfe_parcelas').select('id,nota_id,numero,vencimento,valor,a_vista,n:nfe_notas!inner(id,chave,numero,emissao,dest_doc,dest_nome,favorecido_id,situacao,finalidade,tipo)')
        .eq('empresa_id', e).eq('n.tipo', 'saida').eq('n.situacao', 'autorizada').eq('n.finalidade', '1').gte('n.emissao', de).lte('n.emissao', ate).order('vencimento'));
      const ligadas = new Set(); const nids = [...new Set(ps.map(p => p.nota_id))];
      for (const c of chunks(nids)) for (const v of await q(sb.from('nfe_vinculos').select('parcela_id,nota_id').in('nota_id', c))) { ligadas.add(v.parcela_id); if (!v.parcela_id) ligadas.add('nota:' + v.nota_id); }
      const pend = ps.filter(p => !ligadas.has(p.id) && !ligadas.has('nota:' + p.nota_id));
      // lançamentos (qualquer status) ainda sem nota que citam a NF/parcela com o mesmo valor
      const venc = pend.map(p => p.vencimento).filter(Boolean).sort();
      const ids = receitas(); let ls = [];
      if (pend.length && ids.length) ls = (await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,status,conta_id,v:nfe_vinculos(id)').eq('empresa_id', e).in('plano_id', ids)
        .gte('data', addDias(de, -10)).lte('data', addDias(venc.at(-1) || ate, 30)))).filter(l => !l.v?.length).map(l => ({ ...l, nf: nfDoLancamento(l) }));
      const usados = new Set(); const fav = state.cad.favById, porDoc = new Map(state.cad.favorecidos.filter(f => dig(f.documento)).map(f => [dig(f.documento), f]));
      itens = pend.map(p => {
        const ex = ls.find(l => !usados.has(l.id) && l.nf.nf === p.n.numero && (l.nf.parcela == null || l.nf.parcela === p.numero) && perto(l.valor, p.valor));
        if (ex) usados.add(ex.id);
        return { p, existente: ex || null, fav: fav[p.n.favorecido_id] || porDoc.get(dig(p.n.dest_doc)) || null };
      });
      marc.clear(); itens.forEach(i => marc.add(i.p.id));
      pinta();
    } catch (err) { fail(err); $('#gres', m.el).innerHTML = ''; }
  };
  $('#gbusca', m.el).onclick = buscar;
  $('#gres', m.el).onclick = (ev) => {
    if (ev.target.id === 'gtodos' || ev.target.id === 'gnenhum') { ev.preventDefault(); marc.clear(); if (ev.target.id === 'gtodos') itens.forEach(i => marc.add(i.p.id)); return pinta(); }
    const tr = ev.target.closest('tr[data-g]'); if (!tr) return; const id = tr.dataset.g; marc.has(id) ? marc.delete(id) : marc.add(id); pinta();
  };
  $('#gok', m.el).onclick = async () => {
    const sel = itens.filter(i => marc.has(i.p.id)); if (!sel.length) return;
    const criar = sel.filter(i => !i.existente), ligar = sel.filter(i => i.existente);
    if (!confirm(`Lançar ${criar.length} título(s) em aberto (${money(criar.reduce((s, i) => s + +i.p.valor, 0))})${ligar.length ? ` e ligar ${ligar.length} parcela(s) a lançamentos que já existem` : ''}?`)) return;
    const planoRec = state.cad.plano.find(p => p.codigo === '1.01.01'); if (!planoRec) return toast('Plano 1.01.01 não encontrado', true);
    const e = state.empresa.id, conta = $('#gconta', m.el).value || null, cc = $('#gcc', m.el).value || null;
    $('#gok', m.el).disabled = true;
    try {
      const vinc = ligar.map(i => ({ empresa_id: e, nota_id: i.p.nota_id, parcela_id: i.p.id, lancamento_id: i.existente.id, tipo: i.existente.status === 'Pago' ? 'exata' : 'titulo' }));
      for (const lote of chunks(criar, 200)) {
        const rows = lote.map(i => { const doc = `${i.p.n.numero}-${i.p.numero}`; return { empresa_id: e, data: i.p.vencimento || i.p.n.emissao, emissao: i.p.n.emissao, documento: doc, plano_id: planoRec.id,
          descricao: `NF ${doc} - ${i.fav.nome}`, favorecido_id: i.fav.id, centro_custo_id: cc, status: 'Em aberto', conta_id: conta, valor: +(+i.p.valor).toFixed(2), origem: `nfe:${i.p.n.chave}` }; });
        const ins = await q(sb.from('lancamentos').insert(rows).select('id,documento,origem'));
        for (const i of lote) { const doc = `${i.p.n.numero}-${i.p.numero}`; const l = ins.find(x => x.documento === doc && x.origem === `nfe:${i.p.n.chave}`); if (l) vinc.push({ empresa_id: e, nota_id: i.p.nota_id, parcela_id: i.p.id, lancamento_id: l.id, tipo: 'titulo' }); }
      }
      for (const ch of chunks(vinc, 300)) await q(sb.from('nfe_vinculos').insert(ch));
      toast(`${criar.length} título(s) lançado(s)${ligar.length ? ` · ${ligar.length} ligado(s) a lançamento existente` : ''}`); m.close(); onDone && onDone();
    } catch (err) { fail(err); $('#gok', m.el).disabled = false; }
  };
  buscar();
}

// ---------------------------------------------------------------------------------------------
// Cancelamento informado pelo usuário (quando o XML do evento não veio ou a nota foi cancelada depois de importada)
// ---------------------------------------------------------------------------------------------
export async function marcarCancelada(notaId, substSugerida, onDone) {
  const e = state.empresa.id;
  let n, parc, vinc, fidc;
  try {
    n = (await q(sb.from('nfe_notas').select('id,numero,emissao,dest_nome,dest_doc,v_nf,situacao,eventos').eq('id', notaId)))[0];
    [parc, vinc, fidc] = await Promise.all([q(sb.from('nfe_parcelas').select('id,numero,valor').eq('nota_id', notaId)),
      q(sb.from('nfe_vinculos').select('id,tipo,lancamento_id,l:lancamentos(id,data,valor,status,descricao,fidc_proposta_id)').eq('nota_id', notaId)),
      q(sb.from('nfe_fidc_vinculos').select('id').eq('nota_id', notaId))]);
  } catch (err) { return fail(err); }
  if (!n) return;
  const titulosAbertos = vinc.filter(v => v.tipo === 'titulo' && v.l?.status === 'Em aberto' && !v.l.fidc_proposta_id);
  const recebidos = vinc.filter(v => !titulosAbertos.includes(v));
  const m = modal({ title: `Marcar a NF ${n.numero} como cancelada`, body: `
    <p class="small" style="margin-top:0">${esc(n.dest_nome || '')} · emissão ${dateBR(n.emissao)} · ${money(n.v_nf)}. A nota sai do faturamento, dos impostos e das contas a receber; o XML continua guardado e dá para desfazer.
      Se depois o XML do evento de cancelamento for importado, ele é aplicado normalmente.</p>
    <div class="toolbar"><label>Substituída pela NF (opcional)<input id="cs" inputmode="numeric" value="${esc(substSugerida || '')}" style="width:120px"></label>
      <label class="grow">Observação<input id="cm" placeholder="ex.: reemitida com duplicata"></label></div>
    ${titulosAbertos.length ? `<label class="small" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="cx" checked> Excluir ${titulosAbertos.length} título(s) em aberto gerado(s) desta nota (${money(titulosAbertos.reduce((s, v) => s + +v.l.valor, 0))})</label>` : ''}
    ${recebidos.length ? `<p class="small neg">Há ${recebidos.length} recebimento(s) ligado(s) a esta nota (${money(recebidos.reduce((s, v) => s + +(v.l?.valor || 0), 0))}). O vínculo será desfeito (o lançamento não muda); se informar a NF substituta, o sistema tenta ligá-lo a ela.</p>` : ''}
    ${fidc.length ? `<p class="small neg">Esta nota tem ${fidc.length} título(s) ligado(s) a borderô FIDC: a ligação será desfeita (o borderô não muda).</p>` : ''}`,
    foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="cok">Marcar como cancelada</button>' });
  $('#cok', m.el).onclick = async () => {
    const sub = +($('#cs', m.el).value || '').replace(/\D/g, '') || null; let subst = null;
    try {
      if (sub) { subst = (await q(sb.from('nfe_notas').select('id,numero,situacao').eq('empresa_id', e).eq('tipo', 'saida').eq('numero', sub)))[0]; if (!subst) return toast(`NF ${sub} não está importada`, true); }
      $('#cok', m.el).disabled = true;
      const ev = { tipo: 'cancelamento_manual', data: hojeISO(), substituta: sub, descricao: `Cancelada (informado${state.user?.email ? ' por ' + state.user.email : ''} em ${dateBR(hojeISO())})${sub ? ` — substituída pela NF ${sub}` : ''}${$('#cm', m.el).value.trim() ? ` · ${$('#cm', m.el).value.trim()}` : ''}`, usuario: state.user?.email || null };
      const excluir = $('#cx', m.el)?.checked ? titulosAbertos : [];
      if (vinc.length) await q(sb.from('nfe_vinculos').delete().eq('nota_id', n.id));
      if (fidc.length) await q(sb.from('nfe_fidc_vinculos').delete().eq('nota_id', n.id));
      for (const ch of chunks(excluir.map(v => v.lancamento_id), 100)) await q(sb.from('lancamentos').delete().in('id', ch).eq('status', 'Em aberto'));
      await q(sb.from('nfe_notas').update({ situacao: 'cancelada', eventos: [...(n.eventos || []), ev] }).eq('id', n.id));
      let lig = 0; if (subst && recebidos.length) { try { lig = await autoVincular([subst.id]); } catch {} }
      toast(`NF ${n.numero} marcada como cancelada${excluir.length ? ` · ${excluir.length} título(s) excluído(s)` : ''}${lig ? ` · ${lig} recebimento(s) ligado(s) à NF ${sub}` : ''}`);
      m.close(); onDone && onDone();
    } catch (err) { fail(err); $('#cok', m.el).disabled = false; }
  };
}

export async function desfazerCancelamento(n, onDone) {
  if (!confirm(`Desfazer o cancelamento informado da NF ${n.numero}? Ela volta a autorizada (títulos excluídos não voltam; gere de novo se precisar).`)) return;
  try {
    const ev = (n.eventos || []).filter(x => x.tipo !== 'cancelamento_manual');
    await q(sb.from('nfe_notas').update({ situacao: 'autorizada', eventos: ev }).eq('id', n.id));
    toast('Cancelamento desfeito'); onDone && onDone();
  } catch (err) { fail(err); }
}

// Notas de venda recentes (últimos `dias` dias) com parcelas ainda sem título/recebimento
export async function notasSemTitulo(dias = 60) {
  const e = state.empresa.id, de = addDias(hojeISO(), -dias);
  const ps = await fetchAll(() => sb.from('nfe_parcelas').select('id,nota_id,valor,n:nfe_notas!inner(emissao,tipo,situacao,finalidade),v:nfe_vinculos(id)').eq('empresa_id', e)
    .eq('n.tipo', 'saida').eq('n.situacao', 'autorizada').eq('n.finalidade', '1').gte('n.emissao', de));
  const sem = ps.filter(p => !p.v?.length);
  const ems = sem.map(p => p.n.emissao).sort();
  return { parcelas: sem.length, notas: new Set(sem.map(p => p.nota_id)).size, valor: sem.reduce((s, p) => s + +p.valor, 0), de: ems[0] || null, ate: ems.at(-1) || null };
}

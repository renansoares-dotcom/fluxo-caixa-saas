// Pagamentos × Notas (compras): liga as notas de entrada dos fornecedores aos lançamentos de pagamento já existentes,
// no mesmo modelo de Recebimentos × Notas. Nenhum lançamento é alterado: o vínculo fica em nfe_vinculos
// (com a parcela quando a nota tem duplicatas; pela nota quando não tem — o caso da maioria das compras).
// O pagamento cita a NF do fornecedor como "DOCTO 622/1 BRADESCO - …" (NF 622, parcela 1).
import { sb, state, q, fetchAll, podeEditar } from './data.js';
import { $, esc, money, dateBR, fail, toast } from './ui.js';
import { CFOP_SEM_FINANCEIRO } from './nfe-fiscal.js';
import { usosPorNota } from './creditos.js';

const R = { de: '', ate: '', lde: '', late: '', bp: '', bl: '', soSug: false, selP: new Set(), selL: new Set() };
let P = [], L = [], SUG = [];
const chunks = (arr, k = 150) => { const o = []; for (let i = 0; i < arr.length; i += k) o.push(arr.slice(i, i + k)); return o; };
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const dig = (s) => String(s || '').replace(/\D/g, '');
const raiz = (s) => dig(s).slice(0, 8);
const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 864e5);
const perto = (a, b) => Math.abs(+a - +b) <= 0.05;
const nome1 = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !['LTDA', 'EIRELI', 'IND', 'INDUSTRIA', 'COMERCIO', 'COM', 'DOS', 'DAS', 'DE', 'BRASIL'].includes(w)).slice(0, 2).join(' ');
// devoluções e operações sem pagamento (remessa, retorno, conserto, bonificação…)
const DEVOL = new Set(['1201', '1202', '2201', '2202', '5201', '5202', '6201', '6202', '5410', '5411', '6410', '6411', '5553', '6553', '5556', '6556', '5660', '5661', '5662', '6660', '6661', '6662']);
export const semPagamento = (n) => n.finalidade === '4' || (n.cfops || []).every(c => CFOP_SEM_FINANCEIRO.has(c) || DEVOL.has(c) || c.startsWith('59') || c.startsWith('69') || c.startsWith('19') || c.startsWith('29'));

/** NF citada no pagamento: "DOCTO 622/1 BRADESCO", "NF 1234", "NFE 1234/2", documento "1234-1" */
export function nfDoPagamento(l) {
  for (const t of [l.documento, l.descricao].filter(Boolean)) {
    let m = t.match(/\bDOC(?:TO|UMENTO)?\.?\s*(\d{1,9})\s*[/-]\s*(\d{1,3})\b/i); if (m) return { nf: +m[1], parcela: +m[2] };
    m = t.match(/\bNF-?E?\s*(?:N[ºO°.]?\s*)?(\d{1,9})(?:\s*[/-]\s*(\d{1,3}))?\b/i); if (m) return { nf: +m[1], parcela: m[2] ? +m[2] : null };
  }
  if (l.documento) { const m = String(l.documento).match(/^\s*(\d{1,9})(?:\s*[/-]\s*(\d{1,3}))?\s*$/); if (m) return { nf: +m[1], parcela: m[2] ? +m[2] : null }; }
  return { nf: null, parcela: null };
}

// ---------------------------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------------------------
/** Notas de compra (entrada de fornecedor) com o que já foi pago (vínculos + créditos usados) e o que falta */
export async function notasPendentes(e, de, ate) {
  let ns = await fetchAll(() => sb.from('nfe_notas').select('id,numero,serie,emissao,emit_doc,emit_nome,favorecido_id,finalidade,cfops,natureza,v_nf,eventos')
    .eq('empresa_id', e).eq('tipo', 'entrada').eq('emissao_propria', false).eq('situacao', 'autorizada').gte('emissao', de).lte('emissao', ate).order('emissao').order('numero'));
  ns = ns.filter(n => !semPagamento(n) && !(n.eventos || []).some(x => x.tipo === 'devolucao_total'));
  const ids = ns.map(n => n.id), vinc = [], parc = [];
  for (const c of chunks(ids)) {
    const [v, p] = await Promise.all([q(sb.from('nfe_vinculos').select('id,nota_id,parcela_id,l:lancamentos(valor)').in('nota_id', c)), q(sb.from('nfe_parcelas').select('id,nota_id,numero,vencimento,valor').in('nota_id', c))]);
    vinc.push(...v); parc.push(...p);
  }
  const usos = await usosPorNota(ids);
  return ns.map(n => {
    const pago = vinc.filter(v => v.nota_id === n.id).reduce((s, v) => s + +(v.l?.valor || 0), 0) + (usos.get(n.id) || []).reduce((s, u) => s + +u.valor, 0);
    const parcelas = parc.filter(p => p.nota_id === n.id).sort((a, b) => a.numero - b.numero);
    return { ...n, parcelas, venc: parcelas.map(p => p.vencimento).filter(Boolean).sort()[0] || n.emissao, pago, falta: +(+n.v_nf - pago).toFixed(2) };
  }).filter(n => n.falta > 0.05);
}

/** Pagamentos (lançamentos pagos de despesa) ainda sem nota e que não são adiantamento registrado */
export async function pagamentosLivres(e, de, ate) {
  const cad = state.cad;
  const planos = new Set(cad.contasPlano.filter(p => p.natureza === 'D' && p.tipo !== 'T').map(p => p.id));
  const ls = await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,favorecido_id,conta_id,plano_id,v:nfe_vinculos(id)')
    .eq('empresa_id', e).eq('status', 'Pago').gte('data', de).lte('data', ate).not('favorecido_id', 'is', null).order('data'));
  let deCredito = new Set(); try { deCredito = new Set((await q(sb.from('creditos').select('lancamento_id').eq('empresa_id', e).not('lancamento_id', 'is', null))).map(c => c.lancamento_id)); } catch { /* sem créditos */ }
  return ls.filter(l => planos.has(l.plano_id) && !l.v?.length && !deCredito.has(l.id))
    .map(l => { const f = cad.favById[l.favorecido_id]; return { ...l, fav_doc: f?.documento || null, fav_nome: f?.nome || '', nf: nfDoPagamento(l) }; });
}

/** mesmo fornecedor: cadastro ligado à nota, raiz do CNPJ ou nome */
function mesmoForn(n, l) {
  if (n.favorecido_id && n.favorecido_id === l.favorecido_id) return true;
  const r = raiz(n.emit_doc); if (r.length === 8 && raiz(l.fav_doc) === r) return true;
  return !dig(l.fav_doc) && nome1(l.fav_nome) && nome1(l.fav_nome) === nome1(n.emit_nome);
}

/**
 * Sugestões seguras, sempre do mesmo fornecedor:
 *  1) pagamentos que citam a NF (DOCTO n/p) e somam o que falta da nota (ou da parcela citada);
 *  2) valor exato e único: um só pagamento com aquele valor para uma só nota, entre 60 dias antes e 150 depois da emissão.
 */
export function sugerirPagamentos(notas, lancs) {
  const usados = new Set(), out = [];
  const livres = () => lancs.filter(l => !usados.has(l.id));
  // 1) NF citada
  for (const n of notas) {
    const cit = livres().filter(l => l.nf.nf === n.numero && mesmoForn(n, l));
    if (!cit.length) continue;
    const tot = cit.reduce((s, l) => s + +l.valor, 0);
    if (perto(tot, n.falta)) { out.push({ nota: n, lancs: cit, cat: cit.length > 1 ? 'soma' : 'exata', motivo: `cita NF ${n.numero}` }); cit.forEach(l => usados.add(l.id)); continue; }
    // por parcela: DOCTO n/p com o valor da parcela
    for (const p of n.parcelas) {
      const cp = cit.filter(l => l.nf.parcela === p.numero && !usados.has(l.id)); const tp = cp.reduce((s, l) => s + +l.valor, 0);
      if (cp.length && perto(tp, p.valor)) { out.push({ nota: n, parcela: p, lancs: cp, cat: 'exata', motivo: `cita NF ${n.numero}/${p.numero}` }); cp.forEach(l => usados.add(l.id)); }
    }
  }
  // 2) valor exato e único (pagamentos que não citam outra NF)
  const jaNota = new Set(out.filter(g => !g.parcela).map(g => g.nota.id));
  const cand = (n) => livres().filter(l => mesmoForn(n, l) && perto(l.valor, n.falta) && (l.nf.nf == null || l.nf.nf === n.numero) && dias(l.data, n.emissao) >= -60 && dias(l.data, n.emissao) <= 150);
  for (const n of notas.filter(n => !jaNota.has(n.id) && !out.some(g => g.nota.id === n.id))) {
    const cs = cand(n); if (cs.length !== 1) continue;
    const l = cs[0];
    const rivais = notas.filter(o => o.id !== n.id && !jaNota.has(o.id) && mesmoForn(o, l) && perto(o.falta, l.valor) && dias(l.data, o.emissao) >= -60 && dias(l.data, o.emissao) <= 150);
    if (rivais.length) continue;
    out.push({ nota: n, lancs: [l], cat: 'nota', motivo: 'mesmo fornecedor e valor' }); usados.add(l.id);
  }
  return out;
}
const linhasDe = (gs) => gs.flatMap(g => g.lancs.map(l => ({ empresa_id: state.empresa.id, nota_id: g.nota.id, parcela_id: g.parcela?.id || (g.nota.parcelas.length === 1 ? g.nota.parcelas[0].id : null), lancamento_id: l.id, tipo: g.cat })));

// ---------------------------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------------------------
export async function pintarPagamentos(c, root, onMudou) {
  if (!R.de) { R.de = `${new Date().getFullYear()}-01-01`; R.ate = hojeISO(); R.lde = addDias(R.de, -60); R.late = hojeISO(); }
  c.innerHTML = `<div class="card"><div class="toolbar" id="pflt">
      <label>Emissão das notas<span class="par" style="display:flex;gap:4px"><input type="date" name="de" value="${R.de}"><input type="date" name="ate" value="${R.ate}"></span></label>
      <label>Data dos pagamentos<span class="par" style="display:flex;gap:4px"><input type="date" name="lde" value="${R.lde}"><input type="date" name="late" value="${R.late}"></span></label>
      <span class="spacer" style="flex:1"></span>
      ${podeEditar() ? '<button class="btn primary" id="psug" disabled>Aceitar sugestões</button>' : ''}</div>
    <p class="small muted" style="margin:8px 0 0">Notas de compra × pagamentos já lançados. Marque a(s) nota(s) à esquerda e o(s) pagamento(s) à direita; quando os totais batem as linhas ficam verdes e é só <strong>Vincular</strong>. Ao marcar uma nota, sobem os pagamentos do mesmo fornecedor, que citam a NF (DOCTO) ou têm o mesmo valor. Ficam de fora devoluções, remessas, retornos e adiantamentos já registrados em Créditos. Os lançamentos não são alterados.</p></div>
    <div class="kpis" id="pkpi"></div>
    <div class="conc-grid"><div class="card flush" id="ppar"><div class="loading">Carregando…</div></div><div class="card flush" id="plan"></div></div>
    <div class="card flush" id="pfoot" style="position:sticky;bottom:0;z-index:2"></div>`;
  $('#pflt', c).onchange = (ev) => { if (ev.target.name) { R[ev.target.name] = ev.target.value; R.selP.clear(); R.selL.clear(); carregar(c, root, onMudou); } };
  await carregar(c, root, onMudou);
}

async function carregar(c, root, onMudou) {
  const e = state.empresa.id;
  try { [P, L] = await Promise.all([notasPendentes(e, R.de, R.ate), pagamentosLivres(e, R.lde, R.late)]); }
  catch (err) { fail(err); $('#ppar', c).innerHTML = ''; return; }
  SUG = sugerirPagamentos(P, L);
  const b = $('#psug', c); if (b) { const n = SUG.reduce((s, g) => s + g.lancs.length, 0); b.disabled = !n; b.textContent = `Aceitar sugestões (${n})`; b.onclick = () => aceitar(c, root, onMudou); }
  desenhar(c, root, onMudou);
}

function pontos(l, selP) {
  if (!selP.length) return { s: 0, tags: [] };
  const nums = new Set(selP.map(n => n.numero)), tot = selP.reduce((s, n) => s + n.falta, 0); const tags = []; let s = 0;
  const forn = selP.some(n => mesmoForn(n, l));
  if (l.nf.nf != null && nums.has(l.nf.nf) && forn) { s += 100; tags.push('NF citada'); }
  else if (l.nf.nf != null && forn) { s -= 30; tags.push(`cita NF ${l.nf.nf}`); }
  if (forn) { s += 50; tags.push('mesmo fornecedor'); }
  if (perto(l.valor, tot) || selP.some(n => perto(l.valor, n.falta) || n.parcelas.some(p => perto(l.valor, p.valor)))) { s += 30; tags.push('mesmo valor'); }
  s -= Math.min(Math.abs(dias(l.data, selP[0].venc)) / 10, 20);
  return { s, tags };
}

function desenhar(c, root, onMudou) {
  const bp = R.bp.trim().toLowerCase(), bl = R.bl.trim().toLowerCase();
  const selP = P.filter(n => R.selP.has(n.id)), selL = L.filter(l => R.selL.has(l.id));
  const tp = selP.reduce((s, n) => s + n.falta, 0), tl = selL.reduce((s, l) => s + +l.valor, 0), ok = selP.length && selL.length && perto(tp, tl);
  $('#pkpi', c).innerHTML = `
    <div class="kpi"><div class="k-label">Notas de compra sem pagamento</div><div class="k-value">${P.length}</div><div class="k-sub">${money(P.reduce((s, n) => s + n.falta, 0))} · emissão ${dateBR(R.de)} a ${dateBR(R.ate)}</div></div>
    <div class="kpi"><div class="k-label">Pagamentos sem nota</div><div class="k-value">${L.length}</div><div class="k-sub">${money(L.reduce((s, l) => s + +l.valor, 0))} · ${dateBR(R.lde)} a ${dateBR(R.late)}</div></div>
    <div class="kpi"><div class="k-label">Sugestões seguras</div><div class="k-value">${SUG.length}</div><div class="k-sub">${money(SUG.reduce((s, g) => s + g.lancs.reduce((a, l) => a + +l.valor, 0), 0))} · NF citada ou valor único do mesmo fornecedor</div></div>`;
  const PP = P.filter(n => !bp || `${n.numero} ${n.emit_nome} ${n.emit_doc} ${String(n.falta).replace('.', ',')}`.toLowerCase().includes(bp));
  const pts = new Map(L.map(l => [l.id, pontos(l, selP)]));
  let LL = L.filter(l => !bl || `${l.descricao || ''} ${l.documento || ''} ${l.fav_nome} ${String(l.valor).replace('.', ',')}`.toLowerCase().includes(bl));
  if (selP.length) { LL = LL.slice().sort((a, b) => pts.get(b.id).s - pts.get(a.id).s || a.data.localeCompare(b.data)); if (R.soSug) LL = LL.filter(l => pts.get(l.id).tags.includes('mesmo fornecedor')); }
  const conta = (id) => state.cad.contaById[id]?.nome || '—', MAX = 400;
  $('#ppar', c).innerHTML = `<div class="card-head" style="padding:12px 12px 6px"><h2>Notas de compra (${PP.length})</h2></div>
    <div class="conc-flt"><input name="bp" placeholder="Buscar NF, fornecedor, CNPJ ou valor" value="${esc(R.bp)}"></div>
    <div class="table-wrap" style="max-height:62vh"><table><thead><tr><th></th><th>NF</th><th>Fornecedor</th><th>Emissão / venc.</th><th class="num">Falta pagar</th></tr></thead><tbody>
    ${PP.slice(0, MAX).map(n => `<tr data-p="${n.id}" class="clickable ${R.selP.has(n.id) && ok ? 'conc-ok' : ''}"><td><input type="checkbox" ${R.selP.has(n.id) ? 'checked' : ''}></td>
      <td>${n.numero}${n.parcelas.length ? `<div class="small muted">${n.parcelas.length} parc.</div>` : ''}</td>
      <td class="wrap small">${esc(n.emit_nome || '')}<div class="muted">${esc((n.cfops || []).join(', '))}</div></td><td class="small">${dateBR(n.emissao)}${n.venc !== n.emissao ? `<div class="muted">venc. ${dateBR(n.venc)}</div>` : ''}</td>
      <td class="num">${money(n.falta)}${n.pago > 0.005 ? `<div class="small muted">de ${money(n.v_nf)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhuma nota de compra pendente no período.</td></tr>'}
    ${PP.length > MAX ? `<tr><td colspan="5" class="small muted">Mostrando ${MAX} de ${PP.length} — use a busca ou o período.</td></tr>` : ''}</tbody></table></div>`;
  $('#plan', c).innerHTML = `<div class="card-head" style="padding:12px 12px 6px"><h2>Pagamentos sem nota (${LL.length})</h2>
      ${selP.length ? `<label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="psosug" ${R.soSug ? 'checked' : ''}> só do mesmo fornecedor</label>` : ''}</div>
    <div class="conc-flt"><input name="bl" placeholder="Buscar fornecedor, descrição ou valor" value="${esc(R.bl)}"></div>
    <div class="table-wrap" style="max-height:62vh"><table><thead><tr><th></th><th>Data</th><th>Fornecedor / descrição</th><th>Conta</th><th class="num">Valor</th></tr></thead><tbody>
    ${LL.slice(0, MAX).map(l => { const t = pts.get(l.id); return `<tr data-l="${l.id}" class="clickable ${R.selL.has(l.id) && ok ? 'conc-ok' : ''}"><td><input type="checkbox" ${R.selL.has(l.id) ? 'checked' : ''}></td><td>${dateBR(l.data)}</td>
      <td class="wrap small">${esc(l.fav_nome || '')}<div class="muted">${esc(l.descricao || '')}${l.documento ? ' · ' + esc(l.documento) : ''}</div>${t.tags.map(x => `<span class="badge ${x === 'NF citada' ? 'pago' : x.startsWith('cita NF') ? 'vencido' : 'aberto'}" style="margin-right:4px">${x}</span>`).join('')}</td>
      <td class="small">${esc(conta(l.conta_id))}</td><td class="num">${money(l.valor)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Nenhum pagamento sem nota no período.</td></tr>'}
    ${LL.length > MAX ? `<tr><td colspan="5" class="small muted">Mostrando ${MAX} de ${LL.length} — marque uma nota (os prováveis sobem) ou use a busca.</td></tr>` : ''}</tbody></table></div>`;
  const dif = tl - tp;
  $('#pfoot', c).innerHTML = `<div class="conc-foot ${ok ? 'ok' : ''}"><div><strong>${selP.length}</strong> nota(s) ${money(tp)} · <strong>${selL.length}</strong> pagamento(s) ${money(tl)}
      ${selP.length && selL.length ? (ok ? ' · <span class="pos">totais batem</span>' : ` · diferença <span class="neg">${money(dif)}</span>${dif < 0 ? ' (nota fica parcial)' : ''}`) : ''}</div>
    <div style="display:flex;gap:8px">${selP.length || selL.length ? '<button class="btn" id="plimpa">Limpar seleção</button>' : ''}${podeEditar() ? `<button class="btn primary" id="pvinc" ${selP.length && selL.length ? '' : 'disabled'}>Vincular</button>` : ''}</div></div>`;
  for (const [sel, nm] of [['#ppar', 'bp'], ['#plan', 'bl']]) { let t; const inp = $(`${sel} [name=${nm}]`, c); inp.oninput = (ev) => { clearTimeout(t); t = setTimeout(() => { R[nm] = ev.target.value; desenhar(c, root, onMudou); const i = $(`${sel} [name=${nm}]`, c); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); }; }
  $('#ppar tbody', c).onclick = (ev) => { const tr = ev.target.closest('tr[data-p]'); if (!tr) return; const id = tr.dataset.p; R.selP.has(id) ? R.selP.delete(id) : R.selP.add(id); desenhar(c, root, onMudou); };
  $('#plan tbody', c).onclick = (ev) => { const tr = ev.target.closest('tr[data-l]'); if (!tr) return; const id = tr.dataset.l; R.selL.has(id) ? R.selL.delete(id) : R.selL.add(id); desenhar(c, root, onMudou); };
  $('#psosug', c) && ($('#psosug', c).onchange = (ev) => { R.soSug = ev.target.checked; desenhar(c, root, onMudou); });
  $('#plimpa', c) && ($('#plimpa', c).onclick = () => { R.selP.clear(); R.selL.clear(); desenhar(c, root, onMudou); });
  $('#pvinc', c) && ($('#pvinc', c).onclick = () => vincular(selP, selL, c, root, onMudou));
}

// distribui os pagamentos nas notas marcadas (por emissão / data) e grava os vínculos
async function vincular(selP, selL, c, root, onMudou) {
  const tp = selP.reduce((s, n) => s + n.falta, 0), tl = selL.reduce((s, l) => s + +l.valor, 0);
  if (!perto(tp, tl) && !confirm(tl < tp ? `Os pagamentos somam ${money(tl)} e as notas ${money(tp)}. Vincular assim? A nota fica parcial (falta ${money(tp - tl)}).`
    : `Os pagamentos somam ${money(tl)}, ${money(tl - tp)} a mais que as notas (${money(tp)}). Vincular assim?`)) return;
  const outroForn = selL.filter(l => !selP.some(n => mesmoForn(n, l)));
  if (outroForn.length && !confirm(`${outroForn.length} pagamento(s) estão em outro fornecedor (${[...new Set(outroForn.map(l => l.fav_nome))].join(', ')}). Vincular mesmo assim?`)) return;
  const ns = selP.slice().sort((a, b) => a.emissao.localeCompare(b.emissao) || a.numero - b.numero).map(n => ({ n, resta: n.falta }));
  const rows = []; let i = 0;
  for (const l of selL.slice().sort((a, b) => a.data.localeCompare(b.data))) {
    const citada = ns.find(x => x.n.numero === l.nf.nf && x.resta > 0.05);
    while (!citada && i < ns.length - 1 && ns[i].resta <= 0.05) i++;
    const alvo = citada || ns[i]; alvo.resta -= +l.valor;
    const parc = alvo.n.parcelas.find(p => p.numero === l.nf.parcela) || (alvo.n.parcelas.length === 1 ? alvo.n.parcelas[0] : null);
    rows.push({ empresa_id: state.empresa.id, nota_id: alvo.n.id, parcela_id: parc?.id || null, lancamento_id: l.id, tipo: perto(tp, tl) ? (selL.length > 1 && selP.length === 1 ? 'soma' : 'manual') : 'parcial' });
  }
  try {
    await q(sb.from('nfe_vinculos').insert(rows));
    toast(`${rows.length} pagamento(s) vinculado(s)`);
    R.selP.clear(); R.selL.clear(); await carregar(c, root, onMudou); onMudou && onMudou();
  } catch (err) { fail(String(err.message || err).includes('duplicate') ? new Error('Algum pagamento já estava vinculado a outra nota. Recarregue.') : err); }
}

async function aceitar(c, root, onMudou) {
  const rows = linhasDe(SUG);
  const porCat = { cita: SUG.filter(g => g.motivo.startsWith('cita')).length, valor: SUG.filter(g => !g.motivo.startsWith('cita')).length };
  if (!rows.length || !confirm(`Vincular ${rows.length} pagamento(s) a ${SUG.length} nota(s) de compra?\n\n${porCat.cita} pelo número da NF citado no pagamento (DOCTO) e valor que fecha;\n${porCat.valor} pelo mesmo fornecedor com valor exato e único no período.\n\nCada vínculo pode ser desfeito no detalhe da nota.`)) return;
  try { for (const ch of chunks(rows, 300)) await q(sb.from('nfe_vinculos').insert(ch)); toast(`${rows.length} pagamento(s) vinculado(s)`); R.selP.clear(); R.selL.clear(); await carregar(c, root, onMudou); onMudou && onMudou(); }
  catch (err) { fail(err); }
}

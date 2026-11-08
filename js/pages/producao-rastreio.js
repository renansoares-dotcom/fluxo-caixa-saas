// Produção › Rastreabilidade (PRD021) — melhoria 6.4 (SQL 115, 08/11/2026).
// Do lote da resina e da tinta até a NF-e do cliente, e de volta. Busca por código da bobina (ou o QR da etiqueta),
// nº da OP, lote (resina, insumo, tinta) ou NF-e. Mostra o caminho em três colunas (materiais → produção → clientes),
// a qualidade e, quando a busca é um lote, o resumo de quem recebeu (para um recolhimento). Expedição das bobinas na NF-e.
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, dateBR, fail, toast, modal, exportXLSX } from '../lib/ui.js';
import { certificadoPDF } from '../lib/certificado.js';

export const title = 'Rastreabilidade';
const ui = { termo: '' };
let R = null;
const kg = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' kg');
const SIT_B = { estoque: ['Em estoque', ''], consumida: ['Consumida', 'negoc'], expedida: ['Expedida', 'pago'], refugada: ['Refugada', 'vencido'] };
const QUAL = { liberada: '', bloqueada: '<span class="badge aberto">bloqueada</span>', reprovada: '<span class="badge vencido">reprovada</span>' };
const podeExpedir = () => ['admin', 'financeiro', 'diretor', 'compras', 'producao'].includes(state.papel);

export async function render(root) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  if (qs.get('b')) ui.termo = qs.get('b'); else if (qs.get('t')) ui.termo = qs.get('t');
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Rastreabilidade</h2><div class="muted small">Do lote da resina e da tinta até a nota do cliente, e de volta.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${podeExpedir() ? '<button class="btn" id="rt-exp">Expedir bobinas</button>' : ''}${podeEditar() ? '<button class="btn" id="rt-par">Parâmetros</button>' : ''}</div></div>
    <form id="rt-f" class="card" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
      <label style="flex:1;min-width:260px">Código da bobina, nº da OP, lote (resina, insumo ou tinta) ou nº / chave da NF-e<input id="rt-t" autocomplete="off" value="${esc(ui.termo)}" placeholder="Leia o QR da etiqueta ou digite" autofocus></label>
      <button class="btn primary" type="submit">Rastrear</button></form>
    <div id="rt-r">${ui.termo ? '<div class="loading">Rastreando…</div>' : '<div class="card"><div class="empty">Leia o QR da etiqueta da bobina ou digite um código. Para um recolhimento, busque o lote da resina ou da tinta: a tela mostra todas as bobinas e os clientes que receberam.</div></div>'}</div>`;
  $('#rt-f', root).onsubmit = (e) => { e.preventDefault(); ui.termo = $('#rt-t', root).value.trim(); buscar(root); };
  $('#rt-exp', root) && ($('#rt-exp', root).onclick = () => expedir(root));
  $('#rt-par', root) && ($('#rt-par', root).onclick = () => parametros());
  if (ui.termo) buscar(root);
}

async function buscar(root) {
  const el = $('#rt-r', root);
  if (ui.termo.length < 2) { el.innerHTML = '<div class="card"><div class="empty">Digite ao menos 2 caracteres.</div></div>'; return; }
  el.innerHTML = '<div class="loading">Rastreando…</div>';
  try { R = await q(sb.rpc('prod_rastrear', { p_empresa: state.empresa.id, p_termo: ui.termo })); pintar(root); }
  catch (e) { fail(e); el.innerHTML = '<div class="card"><div class="empty">Não foi possível rastrear. Confira se o SQL 115 já foi executado.</div></div>'; }
}

function pintar(root) {
  const el = $('#rt-r', root);
  if (!R.ops.length && !R.bobinas.length && !R.notas.length) { el.innerHTML = `<div class="card"><div class="empty">Nada encontrado para <b>${esc(R.termo)}</b>. Confira o código ou busque pelo nº da OP.</div></div>`; return; }
  const opById = Object.fromEntries(R.ops.map(o => [o.id, o]));
  const bobPorOp = (id) => R.bobinas.filter(b => b.ordem_id === id);
  const maeDe = Object.fromEntries(R.bobinas.map(b => [b.id, b]));
  const ehLote = R.achados.some(a => a.tipo === 'lote' || a.tipo === 'tinta');
  const tot = { bob: R.bobinas.filter(b => b.situacao === 'expedida').length, kg: R.notas.reduce((s, n) => s + +(n.kg || 0), 0), cli: new Set(R.notas.map(n => n.cnpj || n.cliente)).size };
  const destaca = (x) => String(x || '').toUpperCase() === R.termo ? 'background:var(--warn-bg, #fff4d6);border-radius:4px;padding:0 3px' : '';
  el.innerHTML = `
    <div class="card" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <b>${esc(R.termo)}</b>${R.achados.map(a => `<span class="badge">${esc(a.txt)}</span>`).join('')}
      <span class="small muted">${R.ops.length} OP(s) · ${R.bobinas.length} bobina(s) · ${R.notas.length} nota(s) de saída</span>
      <span style="flex:1"></span><button class="btn small" id="rt-xls">Exportar Excel</button></div>
    ${ehLote && R.notas.length ? `<div class="card" style="border-left:4px solid var(--neg);margin-bottom:12px"><b>Para um recolhimento:</b> ${tot.bob} bobina(s), ${kg(tot.kg)}, entregues a ${tot.cli} cliente(s) em ${R.notas.length} nota(s): ${R.notas.map(n => `${esc(n.cliente || '')} (NF ${n.numero})`).join(', ')}.</div>` : ''}
    <div style="display:grid;grid-template-columns:minmax(240px,1fr) minmax(320px,1.4fr) minmax(240px,1fr);gap:12px;align-items:start" class="rt-grade">
      <div><h3 style="margin:0 0 6px">1. Materiais e lotes</h3>
        ${R.materiais.map(m => `<div class="card small" style="margin-bottom:8px"><b>${esc(m.codigo || '')}</b> ${esc(m.descricao || '')}<div>Lote <b style="${destaca(m.lote)}">${esc(m.lote || 'sem lote')}</b>${m.lote_fornecedor ? ` · do fornecedor <span style="${destaca(m.lote_fornecedor)}">${esc(m.lote_fornecedor)}</span>` : ''}</div>
          <div class="muted">${kg(m.qtd)} na OP ${opById[m.ordem_id]?.numero || ''}${m.fornecedor ? ` · ${esc(m.fornecedor)}` : ''}${m.nota_entrada ? ` · NF de entrada ${m.nota_entrada} (${dateBR(m.nota_entrada_data)})` : ''}</div></div>`).join('') || '<div class="card small muted">Nenhum consumo apontado.</div>'}
        ${R.tintas.map(t => `<div class="card small" style="margin-bottom:8px;border-left:3px solid var(--primary)"><b>Tinta ${esc(t.cor || '')}</b> · ordem ${t.numero}<div>Lote <b style="${destaca(t.lote)}">${esc(t.lote || '—')}</b> · ${kg(t.kg)} na OP ${opById[t.ordem_id]?.numero || ''}</div>
          ${(t.componentes || []).length ? `<div class="muted">${t.componentes.map(c => `${esc(c.codigo)} lote ${esc(c.lote || '—')}${c.lote_fornecedor ? ` (${esc(c.lote_fornecedor)})` : ''}`).join(' · ')}</div>` : ''}</div>`).join('')}</div>
      <div><h3 style="margin:0 0 6px">2. Produção</h3>
        ${R.ops.map(o => `<div class="card small" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:8px"><b style="${destaca(o.numero)}">OP ${o.numero}${o.numero_iniflex ? ` (${esc(o.numero_iniflex)})` : ''}</b><a href="#/producao/ordens?abrir=${o.id}">abrir →</a></div>
          <div>${esc(o.produto)}${o.cliente ? ` · ${esc(o.cliente)}` : ''}</div>
          <div class="table-wrap" style="margin-top:6px"><table class="small"><tbody>${bobPorOp(o.id).map(b => `<tr><td><b style="${destaca(b.codigo)}">${esc(b.codigo)}</b>${b.mae_id && maeDe[b.mae_id] ? `<div class="muted">de ${esc(maeDe[b.mae_id].codigo)}</div>` : ''}</td><td class="num">${kg(b.peso_kg)}</td>
            <td><span class="badge ${SIT_B[b.situacao]?.[1] || ''}">${SIT_B[b.situacao]?.[0] || b.situacao}</span> ${QUAL[b.qualidade] || ''}${b.nota ? `<div class="muted">NF ${b.nota}</div>` : ''}</td>
            <td>${b.situacao === 'expedida' && podeEditar() ? `<button class="btn ghost small" data-desf="${b.id}" title="Desfazer a expedição">↩</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">Sem bobinas registradas.</td></tr>'}</tbody></table></div>
          ${R.qualidade.filter(x => x.ordem_id === o.id || bobPorOp(o.id).some(b => b.id === x.bobina_id)).map(x => `<div class="muted">${esc(x.tipo)} nº ${x.numero} · ${esc(String(x.situacao).replace(/_/g, " "))}</div>`).join('')}</div>`).join('')}</div>
      <div><h3 style="margin:0 0 6px">3. Clientes</h3>
        ${R.notas.map(n => `<div class="card small" style="margin-bottom:8px;border-left:3px solid var(--pos)"><div style="display:flex;justify-content:space-between;gap:6px"><span><b style="${destaca(n.numero)}">NF-e ${n.numero}</b> · ${dateBR(n.emissao)}</span><button class="btn ghost small" data-cert="${n.id}" data-n="${n.numero}" title="Certificado de qualidade desta nota">Certificado</button></div><div>${esc(n.cliente || '')}${n.uf ? ` — ${esc(n.uf)}` : ''}</div>
          <div class="muted">${n.bobinas} bobina(s) · ${kg(n.kg)}${n.carga ? ` · carga ${n.carga}${n.entrega ? ` (${esc(n.entrega)})` : ''}` : ''}</div></div>`).join('') || '<div class="card small muted">Nenhuma bobina expedida em nota.</div>'}</div>
    </div>`;
  $('#rt-xls', el).onclick = exportar;
  $$('[data-desf]', el).forEach(b => b.onclick = () => desfazer(b.dataset.desf, root));
  // certificado de qualidade da nota (melhoria 6.6, SQL 128): o mesmo PDF que o cliente baixa no Portal
  $$('[data-cert]', el).forEach(b => b.onclick = async () => {
    if (!window.jspdf) return fail(new Error('Gerador de PDF não carregado'));
    b.disabled = true;
    try { const c = await q(sb.rpc('qual_certificado', { p_nota: b.dataset.cert })); certificadoPDF(c, window.jspdf.jsPDF).save(`Certificado_NF${b.dataset.n}.pdf`); } catch (e) { fail(e); } finally { b.disabled = false; }
  });
}

function exportar() {
  const op = Object.fromEntries(R.ops.map(o => [o.id, o]));
  const rows = [['Bobina', 'Peso (kg)', 'OP', 'Produto', 'Situação', 'Qualidade', 'Lote da matéria-prima', 'NF-e', 'Cliente', 'Emissão']];
  const notas = Object.fromEntries(R.notas.map(n => [n.id, n]));
  for (const b of R.bobinas) { const n = notas[b.nota_id] || {}; rows.push([b.codigo, b.peso_kg, op[b.ordem_id]?.numero, op[b.ordem_id]?.produto, b.situacao, b.qualidade, b.lote_materia || '', n.numero || '', n.cliente || '', n.emissao || '']); }
  rows.push([]); rows.push(['Material', 'Lote', 'Lote do fornecedor', 'Kg', 'OP', 'NF de entrada']);
  for (const m of R.materiais) rows.push([`${m.codigo || ''} ${m.descricao || ''}`, m.lote || '', m.lote_fornecedor || '', m.qtd, op[m.ordem_id]?.numero, m.nota_entrada || '']);
  exportXLSX(rows, `rastreio_${R.termo}`);
}

async function desfazer(id, root) {
  const m = modal({ title: 'Desfazer a expedição', narrow: true, body: '<label>Motivo<textarea id="df-m" rows="3" placeholder="Ex.: nota cancelada e reemitida"></textarea></label><p class="small muted">A bobina volta para o estoque e sai da nota. Fica registrado na Auditoria.</p>',
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="df-ok">Desfazer</button>' });
  $('#df-ok', m.el).onclick = async () => { try { await q(sb.rpc('prod_bobina_desfazer_expedicao', { p_bobina: id, p_motivo: $('#df-m', m.el).value })); m.close(); toast('Expedição desfeita'); buscar(root); } catch (e) { fail(e); } };
}

async function expedir(root) {
  const m = modal({ title: 'Expedir bobinas', wide: true, body: `
    <div class="grid-form"><label class="span2">NF-e de saída (nº)<input id="ex-n" inputmode="numeric" placeholder="Número da nota"></label><div id="ex-nota" class="small muted span2" style="align-self:end"></div></div>
    <label style="margin-top:8px">Bobinas (leia o QR de cada etiqueta, uma por linha)<textarea id="ex-b" rows="6" placeholder="B-000123"></textarea></label>
    <div id="ex-res" class="small" style="margin-top:6px"></div>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ex-ok">Expedir</button>' });
  let nota = null, bobs = [];
  const codigo = (s) => { const t = s.trim(); const m2 = t.match(/[?&]b=([^&#]+)/i); return (m2 ? decodeURIComponent(m2[1]) : t).toUpperCase(); };
  $('#ex-n', m.el).onchange = async (e) => {
    nota = null; const v = e.target.value.trim(); if (!v) { $('#ex-nota', m.el).textContent = ''; return; }
    try { const r = await q(sb.from('nfe_notas').select('id,numero,emissao,dest_nome,situacao').eq('empresa_id', state.empresa.id).eq('tipo', 'saida').eq('emissao_propria', true).eq('numero', +v).order('emissao', { ascending: false }).limit(1));
      nota = r[0] || null; $('#ex-nota', m.el).innerHTML = nota ? `${esc(nota.dest_nome || '')} · ${dateBR(nota.emissao)}${nota.situacao !== 'autorizada' ? ` · <span class="neg">${esc(nota.situacao)}</span>` : ''}` : '<span class="neg">Nota não encontrada (importe a NF-e antes).</span>'; } catch (err) { fail(err); }
  };
  $('#ex-b', m.el).oninput = async () => {
    const cods = [...new Set($('#ex-b', m.el).value.split(/\n+/).map(codigo).filter(Boolean))];
    if (!cods.length) { bobs = []; $('#ex-res', m.el).innerHTML = ''; return; }
    try { bobs = await q(sb.from('prod_bobinas').select('id,codigo,peso_kg,situacao,qualidade').eq('empresa_id', state.empresa.id).in('codigo', cods)); } catch (err) { return fail(err); }
    const falta = cods.filter(c => !bobs.some(b => b.codigo.toUpperCase() === c)), ruins = bobs.filter(b => b.situacao !== 'estoque' || b.qualidade !== 'liberada');
    $('#ex-res', m.el).innerHTML = `${bobs.length - ruins.length} bobina(s) prontas, ${kg(bobs.filter(b => !ruins.includes(b)).reduce((s, b) => s + +b.peso_kg, 0))}`
      + (falta.length ? `<div class="neg">Não encontradas: ${falta.map(esc).join(', ')}</div>` : '') + (ruins.length ? `<div class="neg">Não podem sair: ${ruins.map(b => `${esc(b.codigo)} (${b.situacao !== 'estoque' ? b.situacao : b.qualidade})`).join(', ')}</div>` : '');
  };
  $('#ex-ok', m.el).onclick = async () => {
    const ok = bobs.filter(b => b.situacao === 'estoque' && b.qualidade === 'liberada');
    if (!ok.length) return toast('Nenhuma bobina pronta para expedir', true);
    if ($('#ex-n', m.el).value.trim() && !nota) return toast('Nota não encontrada', true);
    try { const n = await q(sb.rpc('prod_bobina_expedir', { p_bobinas: ok.map(b => b.id), p_nota: nota?.id || null })); m.close(); toast(`${n} bobina(s) expedida(s)`); if (nota) { ui.termo = String(nota.numero); $('#rt-t', root).value = ui.termo; buscar(root); } } catch (e) { fail(e); }
  };
}

async function parametros() {
  let c = null; try { c = await q(sb.from('prod_rastreio_config').select('*').eq('empresa_id', state.empresa.id).maybeSingle()); } catch { /* sem SQL */ }
  c = { qr_link: true, exigir_nota: false, ...(c || {}) };
  const m = modal({ title: 'Parâmetros da rastreabilidade', body: `
    <label class="chk"><input type="checkbox" id="rp-l" ${c.qr_link ? 'checked' : ''}> O QR da etiqueta abre esta tela no celular (link); desmarcado, o QR traz só o código</label>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="rp-n" ${c.exigir_nota ? 'checked' : ''}> Expedição só com a NF-e informada</label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rp-ok">Salvar</button>' });
  $('#rp-ok', m.el).onclick = async () => { try { await q(sb.from('prod_rastreio_config').upsert({ empresa_id: state.empresa.id, qr_link: $('#rp-l', m.el).checked, exigir_nota: $('#rp-n', m.el).checked, atualizado_em: new Date().toISOString() })); m.close(); toast('Parâmetros salvos'); } catch (e) { fail(e); } };
}

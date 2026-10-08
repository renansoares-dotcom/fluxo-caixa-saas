import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, cls, dateBR, today, options, fail, toast, parseNum, loading, logoPNG, modal, MESES_CURTO } from '../lib/ui.js';

export const title = 'Autorização de pagamentos';
const f = { de: '', ate: '', conta: '', grupo: '', cc: '', favorecido: '', situacao: '', prioridade: '' };
let itens = [];      // títulos listados
let marc = {};       // id -> {autoriza, valor, obs}
let saldoBancos = 0;
let orcInfo = {};    // `${plano}|${ano}|${mes}` -> { orcAc, usado } (orçado × realizado + em aberto acumulados até o mês do vencimento)

// Orçamento das contas dos títulos listados: com o que já foi pago e o que está em aberto até o mês do vencimento,
// a conta passa do budget acumulado? (aviso; o pagamento não é bloqueado, mas pede justificativa ao autorizar)
async function carregarOrcamento(rows) {
  orcInfo = {};
  const e = state.empresa.id, anos = [...new Set(rows.map(r => +r.data.slice(0, 4)))];
  for (const ano of anos) {
    const planos = new Set(rows.filter(r => +r.data.slice(0, 4) === ano).map(r => r.plano_id));
    const [mov, orc] = await Promise.all([q(sb.rpc('orcamento_movimento', { p_empresa: e, p_ano: ano })),
      fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor').eq('empresa_id', e).eq('ano', ano).eq('cenario', 'budget'))]);
    const A = {}; const arr = (pid) => A[pid] ||= { orc: Array(12).fill(0), usado: Array(12).fill(0) };
    for (const o of orc) if (planos.has(o.plano_id)) arr(o.plano_id).orc[o.mes - 1] += +o.valor;
    for (const m of mov) if (planos.has(m.plano_id)) arr(m.plano_id).usado[m.mes - 1] += +m.total;
    for (const [pid, a] of Object.entries(A)) {
      let oa = 0, ua = 0;
      for (let i = 0; i < 12; i++) { oa += a.orc[i]; ua += a.usado[i]; orcInfo[`${pid}|${ano}|${i + 1}`] = { orcAc: oa, usado: ua, mes: i + 1, ano }; }
    }
  }
}
const infoOrc = (it) => orcInfo[`${it.plano_id}|${+it.data.slice(0, 4)}|${+it.data.slice(5, 7)}`];
const acimaOrc = (it) => { const o = infoOrc(it); return o && o.usado - o.orcAc > 0.005 ? o : null; };

export async function render(root) {
  const c = state.cad;
  root.innerHTML = `
    <div class="card">
      <div class="toolbar" id="flt">
        <label>Vencimento de<input type="date" name="de" value="${f.de}"></label>
        <label>até<input type="date" name="ate" value="${f.ate}"></label>
        <label>Situação<select name="situacao">${options([{ id: 'vencidos', n: 'Vencidos' }, { id: 'avencer', n: 'A vencer' }], { label: 'n', empty: 'Todos', selected: f.situacao })}</select></label>
        <label>Prioridade<select name="prioridade">${options([{ id: 'Obrigatório' }, { id: 'Negociável' }], { label: 'id', empty: 'Todas', selected: f.prioridade })}</select></label>
        <label>Banco<select name="conta">${options(c.contas, { empty: 'Todos', selected: f.conta })}</select></label>
        <label>Grupo<select name="grupo">${options(c.grupos, { empty: 'Todos', selected: f.grupo })}</select></label>
        <label>C. Custo<select name="cc">${options(c.cc, { empty: 'Todos', selected: f.cc })}</select></label>
        <label class="grow">Favorecido<select name="favorecido">${options(c.favorecidos, { label: 'label', empty: 'Todos', selected: f.favorecido })}</select></label>
      </div>
      <p class="muted small" style="margin:10px 0 0">Filtros em branco = todos. Marque o que será pago (ajuste o valor se for parcial) e gere o PDF para o diretor assinar.
      A prioridade vem da classificação do plano de contas (configurável em Cadastros › Plano de contas) ou do próprio lançamento.</p>
    </div>
    <div class="kpis" id="kp"></div>
    <div class="card flush">
      <div class="toolbar" style="padding:10px 12px">
        ${podeEditar() ? `<button class="btn small" id="m-obr">Marcar obrigatórios</button><button class="btn small" id="m-venc">Marcar vencidos</button>
        <button class="btn small" id="m-tudo">Marcar todos</button><button class="btn small" id="m-limpa">Limpar</button>
        <span class="spacer"></span>
        <label style="flex-direction:row;align-items:center;gap:6px">Elaborado por <input id="elab" value="${esc(state.empresa.elaborado_por || '')}"></label>
        <button class="btn primary" id="gerar">Gerar autorização (PDF)</button>` : '<span class="muted small">Somente leitura</span>'}
      </div>
      <div class="table-wrap" id="tbl"></div>
    </div>
    <div class="card flush"><div style="padding:16px 16px 0"><h2>Autorizações emitidas</h2></div><div class="table-wrap" id="hist"></div></div>`;
  $('#flt', root).addEventListener('change', (e) => { f[e.target.name] = e.target.value; load(root); });
  if (podeEditar()) {
    const marcar = (fn) => { for (const it of itens) marc[it.id] = { ...marc[it.id], autoriza: fn(it), valor: marc[it.id]?.valor ?? Math.abs(+it.valor_sinal) }; desenhar(root); };
    $('#m-obr', root).onclick = () => marcar(it => it.prioridade_efetiva === 'Obrigatório' || !!marc[it.id]?.autoriza);
    $('#m-venc', root).onclick = () => marcar(it => it.data < today() || !!marc[it.id]?.autoriza);
    $('#m-tudo', root).onclick = () => marcar(() => true);
    $('#m-limpa', root).onclick = () => marcar(() => false);
    $('#gerar', root).onclick = () => gerar(root);
  }
  await Promise.all([load(root), historico(root)]);
}

async function load(root) {
  loading($('#tbl', root));
  try {
    const e = state.empresa.id;
    const [rows, saldos] = await Promise.all([
      fetchAll(() => {
        let qy = sb.from('v_lancamentos').select('*').eq('empresa_id', e).eq('status', 'Em aberto').eq('tipo', 'S');
        if (f.de) qy = qy.gte('data', f.de); if (f.ate) qy = qy.lte('data', f.ate);
        if (f.conta) qy = qy.eq('conta_id', f.conta); if (f.grupo) qy = qy.eq('grupo_id', f.grupo);
        if (f.cc) qy = qy.eq('centro_custo_id', f.cc); if (f.favorecido) qy = qy.eq('favorecido_id', f.favorecido);
        if (f.situacao === 'vencidos') qy = qy.lt('data', today()); if (f.situacao === 'avencer') qy = qy.gte('data', today());
        if (f.prioridade) qy = qy.eq('prioridade_efetiva', f.prioridade);
        return qy.order('data');
      }),
      q(sb.rpc('saldos_contas', { p_empresa: e })),
    ]);
    itens = rows;
    try { await carregarOrcamento(rows); } catch (err) { orcInfo = {}; console.warn('orçamento', err); }
    saldoBancos = saldos.filter(s => s.disponibilidade === 'Conta com recursos disponíveis' && (!f.conta || s.conta_id === f.conta)).reduce((a, s) => a + +s.saldo_pago, 0);
    desenhar(root);
  } catch (err) { fail(err); }
}

function totais() {
  const v = (it) => Math.abs(+it.valor_sinal);
  const t = { total: 0, obr: 0, neg: 0, venc: 0, aut: 0 };
  for (const it of itens) {
    t.total += v(it);
    it.prioridade_efetiva === 'Obrigatório' ? t.obr += v(it) : t.neg += v(it);
    if (it.data < today()) t.venc += v(it);
    if (marc[it.id]?.autoriza) t.aut += +(marc[it.id].valor ?? v(it));
  }
  return t;
}

function desenhar(root) {
  const t = totais();
  $('#kp', root).innerHTML = `
    <div class="kpi"><div class="k-label">Total em aberto</div><div class="k-value">${money(t.total)}</div><div class="k-sub">${itens.length} título(s)</div></div>
    <div class="kpi"><div class="k-label">Obrigatório</div><div class="k-value neg">${money(t.obr)}</div></div>
    <div class="kpi"><div class="k-label">Negociável</div><div class="k-value">${money(t.neg)}</div></div>
    <div class="kpi"><div class="k-label">Vencidos</div><div class="k-value neg">${money(t.venc)}</div></div>
    <div class="kpi"><div class="k-label">Saldo em bancos</div><div class="k-value ${cls(saldoBancos)}">${money(saldoBancos)}</div></div>
    <div class="kpi"><div class="k-label">Saldo após pagar tudo</div><div class="k-value ${cls(saldoBancos - t.total)}">${money(saldoBancos - t.total)}</div></div>
    <div class="kpi"><div class="k-label">Acima do orçado</div><div class="k-value ${itens.some(acimaOrc) ? 'neg' : ''}">${itens.filter(acimaOrc).length}</div><div class="k-sub">título(s) em contas que passam do budget acumulado do mês</div></div>
    <div class="kpi"><div class="k-label">Autorizado</div><div class="k-value" style="color:var(--primary)">${money(t.aut)}</div><div class="k-sub">saldo após: ${money(saldoBancos - t.aut)}</div></div>`;
  const tbl = $('#tbl', root);
  if (!itens.length) { tbl.innerHTML = '<div class="empty">Nenhum compromisso em aberto com esses filtros.</div>'; return; }
  const ed = podeEditar();
  tbl.innerHTML = `<table><thead><tr><th>Nº</th><th>Vencimento</th><th>Atraso</th><th>Favorecido</th><th>Descrição</th><th>Plano de contas</th><th>C. Custo</th><th>Banco</th><th>Prioridade</th><th>Orçamento</th><th class="num">Valor</th><th>Autoriza</th><th class="num">Valor autorizado</th><th>Observação</th></tr></thead><tbody>
    ${itens.map((it, i) => { const mk = marc[it.id] || {}; const dias = Math.floor((new Date(today()) - new Date(it.data)) / 864e5);
      return `<tr data-id="${it.id}"><td>${i + 1}</td><td>${dateBR(it.data)}</td><td>${dias > 0 ? `<span class="badge vencido">${dias} d</span>` : ''}</td>
      <td class="wrap">${esc(it.favorecido_nome || '')}</td><td class="wrap">${esc(it.descricao || '')}</td><td>${esc(it.plano_codigo + ' - ' + it.plano_nome)}</td>
      <td>${esc(it.centro_custo_nome || '')}</td><td>${esc(it.conta_nome || '')}</td>
      <td><span class="badge ${it.prioridade_efetiva === 'Obrigatório' ? 'obrig' : 'negoc'}">${it.prioridade_efetiva}</span></td>
      <td>${(() => { const o = acimaOrc(it); if (o) return `<span class="badge vencido" title="Budget acumulado até ${MESES_CURTO[o.mes - 1]}: ${money(o.orcAc)} · pago + em aberto: ${money(o.usado)}">acima ${money(o.usado - o.orcAc)}</span>`; const x = infoOrc(it); return x ? '<span class="badge pago">no orçado</span>' : '<span class="small muted">sem orçamento</span>'; })()}</td>
      <td class="num">${money(Math.abs(+it.valor_sinal))}</td>
      <td><input type="checkbox" class="aut" ${mk.autoriza ? 'checked' : ''} ${ed ? '' : 'disabled'}></td>
      <td class="num"><input class="cell val" value="${money(mk.valor ?? Math.abs(+it.valor_sinal))}" ${ed ? '' : 'disabled'}></td>
      <td><input class="obs" value="${esc(mk.obs || '')}" style="min-width:160px" ${ed ? '' : 'disabled'}></td></tr>`; }).join('')}</tbody></table>`;
  tbl.onchange = (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const it = itens.find(x => x.id === tr.dataset.id);
    marc[it.id] = { autoriza: $('.aut', tr).checked, valor: Math.min(parseNum($('.val', tr).value), Math.abs(+it.valor_sinal)), obs: $('.obs', tr).value };
    const keep = e.target.classList.contains('obs');
    if (!keep) desenhar(root);
  };
}

// Antes de gerar: títulos marcados em contas acima do orçado pedem justificativa (uma por conta × mês)
function pedirJustificativas(lista) {
  return new Promise((resolve) => {
    const grupos = new Map();
    for (const it of lista) { const o = acimaOrc(it); const k = `${it.plano_id}|${o.ano}|${o.mes}`; (grupos.get(k) || grupos.set(k, { it, o, itens: [] }).get(k)).itens.push(it); }
    const G = [...grupos.values()];
    const m = modal({ title: 'Pagamentos acima do orçado — justificativa', wide: true, body: `
      <p class="small" style="margin-top:0">Os títulos marcados abaixo estão em contas que, com o que já foi pago e o que está em aberto, passam do budget acumulado até o mês do vencimento. O pagamento não é bloqueado: escreva o motivo para registrar no controle orçamentário e no PDF da autorização.</p>
      ${G.map((g, i) => `<div class="card" style="margin:8px 0;padding:10px"><strong>${esc(g.it.plano_codigo)} ${esc(g.it.plano_nome)}</strong> — até ${MESES_CURTO[g.o.mes - 1]}/${g.o.ano}: budget ${money(g.o.orcAc)} · pago + em aberto ${money(g.o.usado)} · <span class="neg">acima ${money(g.o.usado - g.o.orcAc)}</span>
        <div class="small muted">${g.itens.map(x => `${dateBR(x.data)} · ${esc(x.favorecido_nome || x.descricao || '')} · ${money(+(marc[x.id]?.valor ?? Math.abs(+x.valor_sinal)))}`).join('<br>')}</div>
        <textarea data-g="${i}" rows="2" style="width:100%;margin-top:6px" placeholder="Justificativa"></textarea></div>`).join('')}`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="jok">Continuar e gerar</button>' });
    let ok = false;
    $('#jok', m.el).onclick = () => {
      const txt = [...m.el.querySelectorAll('textarea[data-g]')].map(t => t.value.trim());
      if (txt.some(x => !x)) return toast('Escreva a justificativa de cada conta', true);
      ok = true; m.close(); resolve(G.map((g, i) => ({ ...g, texto: txt[i] })));
    };
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!ok) resolve(null); } });
    obs.observe(document.getElementById('modal-root') || document.body, { childList: true });
  });
}

async function gerar(root) {
  const t = totais();
  if (!itens.length) return toast('Nenhum título listado', true);
  const elab = $('#elab', root).value.trim();
  const acima = itens.filter(it => marc[it.id]?.autoriza && acimaOrc(it));
  let justs = [];
  if (acima.length) { justs = await pedirJustificativas(acima); if (!justs) return; }
  const justDoItem = (it) => justs.find(g => g.itens.includes(it))?.texto;
  try {
    const aut = await q(sb.from('autorizacoes').insert({
      empresa_id: state.empresa.id, emissao: today(), elaborado_por: elab || null,
      total_listado: t.total, total_autorizado: t.aut, saldo_bancos: saldoBancos, filtros: f,
    }).select().single());
    const rows = itens.map(it => ({
      autorizacao_id: aut.id, empresa_id: state.empresa.id, lancamento_id: it.id, vencimento: it.data,
      favorecido: it.favorecido_nome, descricao: it.descricao, plano: `${it.plano_codigo} - ${it.plano_nome}`,
      centro_custo: it.centro_custo_nome, conta: it.conta_nome, prioridade: it.prioridade_efetiva,
      valor: Math.abs(+it.valor_sinal), autoriza: !!marc[it.id]?.autoriza,
      valor_autorizado: marc[it.id]?.autoriza ? +(marc[it.id].valor ?? Math.abs(+it.valor_sinal)) : 0,
      observacao: [justDoItem(it) ? `Acima do orçado: ${justDoItem(it)}` : '', marc[it.id]?.obs || ''].filter(Boolean).join(' · ') || null,
    }));
    for (let i = 0; i < rows.length; i += 500) await q(sb.from('autorizacao_itens').insert(rows.slice(i, i + 500)));
    if (justs.length) await q(sb.from('orcamento_justificativas').insert(justs.map(g => ({ empresa_id: state.empresa.id, ano: g.o.ano, mes: g.o.mes, plano_id: g.it.plano_id, origem: 'autorizacao',
      orcado: +g.o.orcAc.toFixed(2), realizado: +g.o.usado.toFixed(2), desvio: +(g.o.usado - g.o.orcAc).toFixed(2), justificativa: g.texto,
      acao: `Autorização nº ${aut.numero}: ${g.itens.length} título(s), ${money(g.itens.reduce((s, x) => s + +(marc[x.id]?.valor ?? Math.abs(+x.valor_sinal)), 0))}`, autorizacao_id: aut.id }))));
    if (elab && elab !== state.empresa.elaborado_por) {
      sb.from('empresas').update({ elaborado_por: elab }).eq('id', state.empresa.id).then(() => state.empresa.elaborado_por = elab);
    }
    pdf(aut, rows);
    toast(`Autorização nº ${aut.numero} gerada`);
    historico(root);
  } catch (e) { fail(e); }
}

export async function pdf(aut, rows) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const logo = await logoPNG();
  if (logo) doc.addImage(logo.data, 'PNG', W - 14 - 14 * logo.ratio, 7, 14 * logo.ratio, 14);
  doc.setFontSize(14); doc.setFont(undefined, 'bold');
  doc.text(`AUTORIZAÇÃO DE PAGAMENTOS — ${state.empresa.nome}`, 14, 15);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text(`Nº ${aut.numero}   |   Emissão: ${dateBR(aut.emissao)}   |   Elaborado por: ${aut.elaborado_por || '-'}`, 14, 22);
  const aprov = rows.filter(r => r.autoriza);
  doc.text(`Total em aberto listado: R$ ${money(aut.total_listado)}   |   Saldo em bancos: R$ ${money(aut.saldo_bancos)}   |   TOTAL AUTORIZADO: R$ ${money(aut.total_autorizado)}   |   Saldo após pagamentos: R$ ${money((+aut.saldo_bancos || 0) - aut.total_autorizado)}`, 14, 28);
  doc.autoTable({
    startY: 33, styles: { fontSize: 7.5, cellPadding: 1.5 }, headStyles: { fillColor: [43, 85, 152] },
    head: [['Nº', 'Vencimento', 'Favorecido', 'Descrição', 'Plano de contas', 'Banco', 'Prioridade', 'Valor', 'Autoriza', 'Valor autorizado', 'Observação']],
    body: rows.map((r, i) => [i + 1, dateBR(r.vencimento), r.favorecido || '', r.descricao || '', r.plano || '', r.conta || '', r.prioridade || '',
      money(r.valor), r.autoriza ? 'SIM' : 'NÃO', r.autoriza ? money(r.valor_autorizado) : '', r.observacao || '']),
    columnStyles: { 7: { halign: 'right' }, 9: { halign: 'right' }, 8: { halign: 'center' } },
    didParseCell: (d) => { if (d.section === 'body' && rows[d.row.index]?.autoriza) d.cell.styles.fontStyle = 'bold'; },
    foot: [['', '', '', '', '', '', 'TOTAL', money(rows.reduce((s, r) => s + +r.valor, 0)), `${aprov.length} itens`, money(aut.total_autorizado), '']],
    footStyles: { fillColor: [240, 243, 248], textColor: 20, fontStyle: 'bold' },
  });
  let y = doc.lastAutoTable.finalY + 22;
  if (y > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 40; }
  doc.line(30, y, 120, y); doc.line(W - 120, y, W - 30, y);
  doc.setFontSize(9);
  doc.text(`Elaborado por: ${aut.elaborado_por || ''}`, 30, y + 5);
  doc.text('Diretor — autorizo os pagamentos marcados como SIM', W - 120, y + 5);
  doc.save(`autorizacao_${aut.numero}_${aut.emissao}.pdf`);
}

async function historico(root) {
  const el = $('#hist', root);
  try {
    const rows = await q(sb.from('autorizacoes').select('*').eq('empresa_id', state.empresa.id).order('numero', { ascending: false }).limit(50));
    if (!rows.length) { el.innerHTML = '<div class="empty">Nenhuma autorização emitida ainda.</div>'; return; }
    const podeAprovar = ['admin', 'diretor'].includes(state.papel);
    el.innerHTML = `<table><thead><tr><th>Nº</th><th>Emissão</th><th>Elaborado por</th><th class="num">Listado</th><th class="num">Autorizado</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(a => `<tr data-id="${a.id}"><td>${a.numero}</td><td>${dateBR(a.emissao)}</td><td>${esc(a.elaborado_por || '')}</td>
        <td class="num">${money(a.total_listado)}</td><td class="num">${money(a.total_autorizado)}</td>
        <td><span class="badge ${a.status === 'Aprovada' ? 'pago' : a.status === 'Rejeitada' ? 'vencido' : 'aberto'}">${a.status}</span></td>
        <td><button class="btn small" data-a="pdf">PDF</button>
          ${podeAprovar && a.status === 'Pendente' ? '<button class="btn small" data-a="Aprovada">Aprovar</button><button class="btn small danger" data-a="Rejeitada">Rejeitar</button>' : ''}</td></tr>`).join('')}</tbody></table>`;
    el.onclick = async (e) => {
      const a = e.target.dataset.a; if (!a) return;
      const aut = rows.find(r => r.id === e.target.closest('tr').dataset.id);
      try {
        if (a === 'pdf') { const its = await q(sb.from('autorizacao_itens').select('*').eq('autorizacao_id', aut.id).order('vencimento')); pdf(aut, its); }
        else { await q(sb.from('autorizacoes').update({ status: a, aprovado_por: state.user.id, aprovado_em: new Date().toISOString() }).eq('id', aut.id)); toast(`Autorização ${a.toLowerCase()}`); historico(root); }
      } catch (err) { fail(err); }
    };
  } catch (e) { fail(e); }
}

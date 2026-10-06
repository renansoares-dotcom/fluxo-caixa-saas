import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, cls, dateBR, today, options, fail, toast, parseNum, loading, logoPNG } from '../lib/ui.js';

export const title = 'Autorização de pagamentos';
const f = { de: '', ate: '', conta: '', grupo: '', cc: '', favorecido: '', situacao: '', prioridade: '' };
let itens = [];      // títulos listados
let marc = {};       // id -> {autoriza, valor, obs}
let saldoBancos = 0;

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
    <div class="kpi"><div class="k-label">Autorizado</div><div class="k-value" style="color:var(--primary)">${money(t.aut)}</div><div class="k-sub">saldo após: ${money(saldoBancos - t.aut)}</div></div>`;
  const tbl = $('#tbl', root);
  if (!itens.length) { tbl.innerHTML = '<div class="empty">Nenhum compromisso em aberto com esses filtros.</div>'; return; }
  const ed = podeEditar();
  tbl.innerHTML = `<table><thead><tr><th>Nº</th><th>Vencimento</th><th>Atraso</th><th>Favorecido</th><th>Descrição</th><th>Plano de contas</th><th>C. Custo</th><th>Banco</th><th>Prioridade</th><th class="num">Valor</th><th>Autoriza</th><th class="num">Valor autorizado</th><th>Observação</th></tr></thead><tbody>
    ${itens.map((it, i) => { const mk = marc[it.id] || {}; const dias = Math.floor((new Date(today()) - new Date(it.data)) / 864e5);
      return `<tr data-id="${it.id}"><td>${i + 1}</td><td>${dateBR(it.data)}</td><td>${dias > 0 ? `<span class="badge vencido">${dias} d</span>` : ''}</td>
      <td class="wrap">${esc(it.favorecido_nome || '')}</td><td class="wrap">${esc(it.descricao || '')}</td><td>${esc(it.plano_codigo + ' - ' + it.plano_nome)}</td>
      <td>${esc(it.centro_custo_nome || '')}</td><td>${esc(it.conta_nome || '')}</td>
      <td><span class="badge ${it.prioridade_efetiva === 'Obrigatório' ? 'obrig' : 'negoc'}">${it.prioridade_efetiva}</span></td>
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

async function gerar(root) {
  const t = totais();
  if (!itens.length) return toast('Nenhum título listado', true);
  const elab = $('#elab', root).value.trim();
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
      observacao: marc[it.id]?.obs || null,
    }));
    for (let i = 0; i < rows.length; i += 500) await q(sb.from('autorizacao_itens').insert(rows.slice(i, i + 500)));
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

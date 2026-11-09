// RH › Férias e Provisões (RHT004, melhoria 8.1): situação dos períodos aquisitivos de cada pessoa, passivo de férias e 13º,
// programação das férias com o cálculo e a previsão do pagamento no fluxo de caixa.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, toast, fail, modal, exportXLSX } from '../lib/ui.js';
import { temRH, podeRH, carregarBase, avisoMigracao, kpi } from '../lib/rh-dados.js';
import { periodos, feriasCalc, passivo } from '../lib/rh-calc.js';

export const title = 'Férias e Provisões';
const ui = { aba: 'situacao', ate: new Date().toISOString().slice(0, 10), filtro: 'todos' };
const SIT = { programada: ['Programada', 'aberto'], paga: ['Paga', 'pago'], cancelada: ['Cancelada', ''] };

export async function render(root) {
  if (!temRH()) { root.innerHTML = '<div class="card"><div class="empty">Acesso ao RH só para administrador ou quem tem a área RH liberada.</div></div>'; return; }
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="fe-abas">${[['situacao', 'Situação e passivo'], ['programadas', 'Férias programadas']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <label class="small">Posição em <input type="date" id="fe-ate" value="${ui.ate}"></label><span class="spacer"></span><span id="fe-acoes"></span></div><div id="fe-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#fe-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  $('#fe-ate', root).onchange = (e) => { if (e.target.value) { ui.ate = e.target.value; render(root); } };
  let B, FE;
  try { B = await carregarBase(); FE = await fetchAll(() => sb.from('rh_ferias').select('*').eq('empresa_id', state.empresa.id).order('gozo_ini', { ascending: false })); }
  catch (err) { $('#fe-corpo', root).innerHTML = /rh_ferias/.test(err.message || '') ? '<div class="card"><div class="empty">Esta tela precisa do SQL 144.</div></div>' : avisoMigracao; return; }
  const porC = new Map(); for (const f of FE) (porC.get(f.colaborador_id) || porC.set(f.colaborador_id, []).get(f.colaborador_id)).push(f);
  if (ui.aba === 'situacao') situacao($('#fe-corpo', root), B, porC, root); else programadas($('#fe-corpo', root), B, FE, root);
}

function situacao(c, B, porC, root) {
  const Pv = passivo(B.colabs, porC, ui.ate), T = Pv.total;
  const L = ui.filtro === 'vencidas' ? Pv.linhas.filter(l => l.vencidos) : ui.filtro === 'a_gozar' ? Pv.linhas.filter(l => l.diasDevidos > 0) : Pv.linhas;
  const semAdm = B.colabs.filter(x => x.situacao !== 'desligado' && ['clt', 'aprendiz'].includes(x.vinculo) && !x.admissao).length;
  $('#fe-acoes', root).innerHTML = '<button class="btn" id="fe-xls">Excel</button>';
  c.innerHTML = `<div class="kpis">${kpi('Passivo de férias e 13º', money(T.total), `em ${dateBR(ui.ate)}`)}${kpi('Férias devidas (com 1/3)', money(T.ferias), 'períodos completos não gozados')}
      ${kpi('Férias proporcionais', money(T.feriasProp), 'período em aquisição')}${kpi('13º do ano', money(T.decimo), 'avos até a data')}${kpi('Com férias vencidas', T.vencidos, T.vencidos ? '<span class="neg">pagamento em dobro</span>' : 'nenhum', T.vencidos ? 'neg' : '')}</div>
    ${semAdm ? `<p class="small warn">${semAdm} colaborador(es) CLT sem data de admissão ficam fora (RH › Colaboradores).</p>` : ''}
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><div class="chips" id="fe-f">${[['todos', 'Todos'], ['a_gozar', 'Com férias a gozar'], ['vencidas', 'Vencidas']].map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div></div>
    <div class="table-wrap" id="fe-tab" style="max-height:60vh"><table><thead><tr><th>Nome</th><th class="num">Dias a gozar</th><th>Gozar até</th><th class="num">Avos férias</th><th class="num">Avos 13º</th><th class="num">Férias devidas</th><th class="num">Proporcionais</th><th class="num">13º</th><th class="num">Total</th><th></th></tr></thead><tbody>
    ${L.map(l => `<tr><td>${esc(l.nome)}${l.vencidos ? ' <span class="badge vencido">vencida</span>' : ''}<div class="small muted">salário ${money(l.salario)}</div></td><td class="num">${l.diasDevidos || '–'}</td>
      <td class="${l.vencidos ? 'neg' : ''}">${l.proximoLimite ? dateBR(l.proximoLimite) : l.vencidos ? 'vencido' : '–'}</td><td class="num">${l.avosFerias}/12</td><td class="num">${l.avos13}/12</td>
      <td class="num">${money(l.ferias)}</td><td class="num">${money(l.feriasProp)}</td><td class="num">${money(l.decimo)}</td><td class="num"><b>${money(l.total)}</b></td>
      <td>${podeRH() && l.diasDevidos ? `<button class="btn small" data-prog="${l.id}">Programar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Ninguém nesta situação.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Gozar até: fim do período concessivo (12 meses depois de completar o período aquisitivo); depois dele as férias são devidas em dobro. Faltas, afastamentos e licenças que mudam os períodos não entram: confira com a folha oficial.</p>`;
  $('#fe-f', c).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; situacao(c, B, porC, root); } };
  $('#fe-xls', root).onclick = () => exportXLSX($('#fe-tab table', c), `passivo_ferias_13_${ui.ate}`);
  $$('[data-prog]', c).forEach(b => b.onclick = () => programar(B, porC, B.colabById[b.dataset.prog], null, root));
}

function programadas(c, B, FE, root) {
  const porC = new Map(); for (const f of FE) (porC.get(f.colaborador_id) || porC.set(f.colaborador_id, []).get(f.colaborador_id)).push(f);
  const ativas = FE.filter(f => f.situacao === 'programada');
  $('#fe-acoes', root).innerHTML = podeRH() ? '<button class="btn primary" id="fe-novo">Programar férias</button>' : '';
  c.innerHTML = `<div class="kpis">${kpi('Programadas', ativas.length)}${kpi('A pagar', money(ativas.reduce((s, f) => s + +f.total, 0)), 'previsto no fluxo')}
      ${kpi('Próximos 30 dias', ativas.filter(f => f.pagamento <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)).length)}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Período aquisitivo</th><th>Saída</th><th class="num">Dias</th><th class="num">Abono</th><th class="num">Total</th><th>Pagamento</th><th>Situação</th><th></th></tr></thead><tbody>
    ${FE.map(f => { const [t, cl] = SIT[f.situacao]; const co = B.colabById[f.colaborador_id] || {};
      return `<tr><td>${esc(co.nome || '?')}</td><td class="small">${dateBR(f.aquisitivo_ini)}</td><td>${dateBR(f.gozo_ini)}</td><td class="num">${f.dias}</td><td class="num">${f.abono_dias || '–'}</td>
        <td class="num">${money(f.total)}${f.adiantar_13 ? '<div class="small muted">com 1ª parcela do 13º</div>' : ''}</td><td>${dateBR(f.pagamento)}</td><td><span class="badge ${cl}">${t}</span>${f.lancamento_id ? '<div class="small muted">no fluxo</div>' : ''}</td>
        <td style="white-space:nowrap">${podeRH() && f.situacao === 'programada' ? `<button class="btn small" data-ed="${f.id}">Editar</button> <button class="btn small ghost" data-paga="${f.id}">Paga</button> <button class="btn small ghost" data-canc="${f.id}">Cancelar</button>` : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="9" class="empty">Nenhuma férias programada.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Ao programar, a previsão do pagamento entra no fluxo de caixa (Em aberto) na data de pagamento, com o plano de férias dos parâmetros da folha. "Paga" registra que o pagamento saiu; a baixa no fluxo segue pela conciliação.</p>`;
  $('#fe-novo', root) && ($('#fe-novo', root).onclick = () => programar(B, porC, null, null, root));
  $$('[data-ed]', c).forEach(b => b.onclick = () => { const f = FE.find(x => x.id === b.dataset.ed); programar(B, porC, B.colabById[f.colaborador_id], f, root); });
  $$('[data-paga]', c).forEach(b => b.onclick = async () => { try { await q(sb.from('rh_ferias').update({ situacao: 'paga' }).eq('id', b.dataset.paga)); toast('Férias marcadas como pagas'); render(root); } catch (err) { fail(err); } });
  $$('[data-canc]', c).forEach(b => b.onclick = async () => {
    if (!confirm('Cancelar estas férias? A previsão em aberto sai do fluxo.')) return;
    try { await q(sb.from('rh_ferias').update({ situacao: 'cancelada' }).eq('id', b.dataset.canc)); await q(sb.rpc('rh_ferias_lancar', { p_id: b.dataset.canc })); toast('Férias canceladas'); render(root); } catch (err) { fail(err); }
  });
}

function programar(B, porC, colab, f, root) {
  const ativos = B.colabs.filter(x => x.situacao !== 'desligado' && ['clt', 'aprendiz'].includes(x.vinculo) && x.admissao).sort((a, b) => a.nome.localeCompare(b.nome));
  const md = modal({ title: f ? 'Editar férias' : 'Programar férias', body: `<div class="grid2">
      <label>Colaborador<select id="pf-c" ${f ? 'disabled' : ''}>${ativos.map(x => `<option value="${x.id}" ${x.id === colab?.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Período aquisitivo<select id="pf-aq"></select></label>
      <label>Saída (início do gozo)<input type="date" id="pf-ini" value="${f?.gozo_ini || ''}"></label>
      <label>Dias de gozo<input type="number" id="pf-d" min="5" max="30" value="${f?.dias || 30}"></label>
      <label>Abono pecuniário (dias vendidos, até 10)<input type="number" id="pf-ab" min="0" max="10" value="${f?.abono_dias || 0}"></label>
      <label class="chk"><input type="checkbox" id="pf-13" ${f?.adiantar_13 ? 'checked' : ''}> Adiantar a 1ª parcela do 13º</label></div>
    <div id="pf-calc" style="margin-top:8px"></div>
    <label>Observação<input id="pf-obs" value="${esc(f?.observacao || '')}"></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-ok">Salvar e prever no fluxo</button>' });
  const sel = () => B.colabById[$('#pf-c', md.el).value];
  const aqs = () => { const co = sel(); if (!co) return; const P = periodos(co.admissao, ui.ate > co.admissao ? addAno(ui.ate) : co.admissao, (porC.get(co.id) || []).filter(x => x.id !== f?.id));
    $('#pf-aq', md.el).innerHTML = P.filter(p => p.saldo > 0 || p.ini === f?.aquisitivo_ini).map(p => `<option value="${p.ini}" ${p.ini === f?.aquisitivo_ini ? 'selected' : ''}>${dateBR(p.ini)} a ${dateBR(p.fim)} · saldo ${p.saldo} dia(s)${p.situacao === 'vencido' ? ' · VENCIDO' : p.completo ? '' : ' · em aquisição'}</option>`).join(''); calc(); };
  const calc = () => { const co = sel(); if (!co) return; const ini = $('#pf-ini', md.el).value;
    const F = feriasCalc(co.salario, +$('#pf-d', md.el).value, +$('#pf-ab', md.el).value, $('#pf-13', md.el).checked, ini || null, B.Prow);
    $('#pf-calc', md.el).innerHTML = `<table class="small"><tbody><tr><td>Férias (${$('#pf-d', md.el).value} dias)</td><td class="num">${money(F.ferias)}</td></tr><tr><td>1/3 constitucional</td><td class="num">${money(F.terco)}</td></tr>
      ${F.abono ? `<tr><td>Abono pecuniário + 1/3</td><td class="num">${money(F.abono + F.terco_abono)}</td></tr>` : ''}${F.decimo ? `<tr><td>1ª parcela do 13º</td><td class="num">${money(F.decimo)}</td></tr>` : ''}
      <tr class="row-sec"><td>Total bruto</td><td class="num">${money(F.total)}</td></tr></tbody></table>
      <p class="small muted">${F.pagamento ? `Pagamento em ${dateBR(F.pagamento)} · retorno em ${dateBR(F.retorno)}. ` : ''}Bruto, sem INSS e IRRF do empregado (descontados na folha oficial).</p>`; return F; };
  $('#pf-c', md.el).onchange = aqs; ['#pf-ini', '#pf-d', '#pf-ab', '#pf-13'].forEach(id => { $(id, md.el).oninput = calc; $(id, md.el).onchange = calc; }); aqs();
  $('#pf-ok', md.el).onclick = async (ev) => {
    const co = sel(), F = calc(), d = +$('#pf-d', md.el).value, ab = +$('#pf-ab', md.el).value;
    if (!co || !$('#pf-aq', md.el).value) return toast('Escolha o colaborador e o período aquisitivo', true);
    if (!$('#pf-ini', md.el).value) return toast('Informe a data de saída', true);
    if (d < 5 || d + ab > 30) return toast('Dias de gozo de 5 a 30, e gozo + abono até 30', true);
    ev.target.disabled = true;
    const row = { empresa_id: state.empresa.id, colaborador_id: co.id, aquisitivo_ini: $('#pf-aq', md.el).value, gozo_ini: $('#pf-ini', md.el).value, dias: d, abono_dias: ab, adiantar_13: $('#pf-13', md.el).checked,
      salario: +co.salario || 0, valores: { ferias: F.ferias, terco: F.terco, abono: F.abono, terco_abono: F.terco_abono, decimo: F.decimo }, total: F.total, pagamento: F.pagamento, observacao: $('#pf-obs', md.el).value.trim() || null };
    try {
      const [g] = await q(f ? sb.from('rh_ferias').update(row).eq('id', f.id).select('id') : sb.from('rh_ferias').insert(row).select('id'));
      await q(sb.rpc('rh_ferias_lancar', { p_id: g.id })); toast('Férias programadas e previstas no fluxo'); md.close(); ui.aba = 'programadas'; render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}
const addAno = (s) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); };

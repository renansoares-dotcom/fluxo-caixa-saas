// RH › Rescisões (RHT005, melhoria 8.1): simulação das verbas (saldo, aviso, 13º, férias e 1/3, multa do FGTS),
// confirmação (desliga o colaborador e prevê o pagamento e a GRRF no fluxo), cancelamento e baixa.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, toast, fail, modal } from '../lib/ui.js';
import { temRH, podeRH, carregarBase, avisoMigracao, kpi } from '../lib/rh-dados.js';
import { rescisaoCalc, periodos, MOTIVOS, AVISOS } from '../lib/rh-calc.js';

export const title = 'Rescisões';
const SIT = { simulada: ['Simulada', ''], confirmada: ['Confirmada', 'aberto'], paga: ['Paga', 'pago'], cancelada: ['Cancelada', ''] };

export async function render(root) {
  if (!temRH()) { root.innerHTML = '<div class="card"><div class="empty">Acesso ao RH só para administrador ou quem tem a área RH liberada.</div></div>'; return; }
  root.innerHTML = '<div class="loading">Carregando…</div>';
  let B, R, FE;
  try {
    B = await carregarBase();
    [R, FE] = await Promise.all([fetchAll(() => sb.from('rh_rescisoes').select('*').eq('empresa_id', state.empresa.id).order('data_desligamento', { ascending: false })),
      fetchAll(() => sb.from('rh_ferias').select('colaborador_id,aquisitivo_ini,dias,abono_dias,situacao').eq('empresa_id', state.empresa.id))]);
  } catch (err) { root.innerHTML = /rh_rescis|rh_ferias/.test(err.message || '') ? '<div class="card"><div class="empty">Esta tela precisa do SQL 144.</div></div>' : avisoMigracao; return; }
  const abertas = R.filter(r => r.situacao === 'confirmada');
  root.innerHTML = `<div class="kpis">${kpi('Confirmadas a pagar', abertas.length)}${kpi('Verbas a pagar', money(abertas.reduce((s, r) => s + +r.total, 0)))}${kpi('Multa do FGTS a recolher', money(abertas.reduce((s, r) => s + +r.multa_fgts, 0)))}
      ${kpi('Simulações', R.filter(r => r.situacao === 'simulada').length)}</div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><h2 style="margin:0">Rescisões</h2>${podeRH() ? '<button class="btn primary" id="rs-novo">Simular rescisão</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Desligamento</th><th>Motivo</th><th>Aviso</th><th class="num">Verbas</th><th class="num">Multa FGTS</th><th>Pagamento</th><th>Situação</th><th></th></tr></thead><tbody>
    ${R.map(r => { const [t, cl] = SIT[r.situacao]; return `<tr><td>${esc(B.colabById[r.colaborador_id]?.nome || '?')}</td><td>${dateBR(r.data_desligamento)}</td><td class="small">${MOTIVOS[r.motivo]}</td><td class="small">${AVISOS[r.aviso]}</td>
      <td class="num">${money(r.total)}</td><td class="num">${r.multa_fgts ? money(r.multa_fgts) : '–'}</td><td>${dateBR(r.pagamento)}</td><td><span class="badge ${cl}">${t}</span>${r.lancamento_id ? '<div class="small muted">no fluxo</div>' : ''}</td>
      <td style="white-space:nowrap">${podeRH() && ['simulada', 'confirmada'].includes(r.situacao) ? `<button class="btn small" data-ab="${r.id}">Abrir</button> ${r.situacao === 'confirmada' ? `<button class="btn small ghost" data-paga="${r.id}">Paga</button> ` : ''}<button class="btn small ghost" data-canc="${r.id}">Cancelar</button>` : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="9" class="empty">Nenhuma rescisão.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Estimativa das verbas brutas para o caixa: INSS e IRRF do empregado, descontos e o TRCT oficial vêm da folha. O saldo do FGTS é o do extrato da Caixa.</p>`;
  $('#rs-novo', root) && ($('#rs-novo', root).onclick = () => simular(B, FE, null, root));
  $$('[data-ab]', root).forEach(b => b.onclick = () => simular(B, FE, R.find(r => r.id === b.dataset.ab), root));
  $$('[data-paga]', root).forEach(b => b.onclick = async () => { try { await q(sb.from('rh_rescisoes').update({ situacao: 'paga' }).eq('id', b.dataset.paga)); toast('Rescisão marcada como paga'); render(root); } catch (err) { fail(err); } });
  $$('[data-canc]', root).forEach(b => b.onclick = async () => {
    if (!confirm('Cancelar esta rescisão? As previsões em aberto saem do fluxo e, se estava confirmada, o colaborador volta para ativo.')) return;
    try { await q(sb.rpc('rh_rescisao_cancelar', { p_id: b.dataset.canc })); toast('Rescisão cancelada'); render(root); } catch (err) { fail(err); }
  });
}

function simular(B, FE, r, root) {
  const ativos = B.colabs.filter(x => (x.situacao !== 'desligado' || x.id === r?.colaborador_id) && ['clt', 'aprendiz'].includes(x.vinculo) && x.admissao).sort((a, b) => a.nome.localeCompare(b.nome));
  const hoje = new Date().toISOString().slice(0, 10);
  const md = modal({ wide: true, title: r ? 'Rescisão' : 'Simular rescisão', body: `<div class="grid2">
      <label>Colaborador<select id="rs-c" ${r ? 'disabled' : ''}>${ativos.map(x => `<option value="${x.id}" ${x.id === r?.colaborador_id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Data do desligamento<input type="date" id="rs-d" value="${r?.data_desligamento || hoje}"></label>
      <label>Motivo<select id="rs-m">${Object.entries(MOTIVOS).map(([k, t]) => `<option value="${k}" ${(r?.motivo || 'sem_justa_causa') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Aviso prévio<select id="rs-a">${Object.entries(AVISOS).map(([k, t]) => `<option value="${k}" ${(r?.aviso || 'indenizado') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Saldo do FGTS (extrato da Caixa)<input type="number" step="0.01" id="rs-f" value="${r?.saldo_fgts ?? ''}"></label>
      <label>Férias vencidas a pagar (dias)<input type="number" id="rs-v" min="0" max="60" value="${r?.ferias_vencidas_dias ?? ''}"></label></div>
    <div id="rs-calc" style="margin-top:8px"></div><label>Observação<input id="rs-obs" value="${esc(r?.observacao || '')}"></label>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Fechar</button><button class="btn" id="rs-sim">Salvar simulação</button><button class="btn primary" id="rs-conf">${r?.situacao === 'confirmada' ? 'Atualizar e prever no fluxo' : 'Confirmar e prever no fluxo'}</button>` });
  const co = () => B.colabById[$('#rs-c', md.el).value];
  const vencDefault = () => { const c = co(); if (!c || r) return; const P = periodos(c.admissao, $('#rs-d', md.el).value, FE.filter(f => f.colaborador_id === c.id));
    $('#rs-v', md.el).value = P.filter(p => p.completo).reduce((s, p) => s + p.saldo, 0); };
  const calc = () => { const c = co(); if (!c) return null; const d = $('#rs-d', md.el).value; if (!d) return null;
    const P = periodos(c.admissao, d, FE.filter(f => f.colaborador_id === c.id)), aq = P.find(p => !p.completo)?.ini || P.slice(-1)[0]?.ini;
    const R = rescisaoCalc({ admissao: c.admissao, data: d, salario: c.salario, motivo: $('#rs-m', md.el).value, aviso: $('#rs-a', md.el).value, saldo_fgts: +$('#rs-f', md.el).value || 0,
      ferias_vencidas_dias: +$('#rs-v', md.el).value || 0, aquisitivo_ini: aq }, B.Prow);
    $('#rs-calc', md.el).innerHTML = `<p class="small" style="margin:0 0 6px">Admissão ${dateBR(c.admissao)} · salário ${money(c.salario)}${R.dias_aviso ? ` · aviso de ${R.dias_aviso} dia(s), data projetada ${dateBR(R.data_projetada)}` : ''}</p>
      <table class="small"><tbody>${R.verbas.map(v => `<tr><td>${esc(v.nome)}</td><td class="num">${money(v.valor)}</td></tr>`).join('')}
      <tr class="row-sec"><td>Verbas rescisórias (bruto)</td><td class="num">${money(R.total)}</td></tr>
      <tr><td>Multa do FGTS (${R.multa_pct}% sobre o saldo + FGTS do mês e do aviso)</td><td class="num">${money(R.multa_fgts)}</td></tr>
      <tr class="row-sec"><td>Saída de caixa estimada</td><td class="num">${money(R.total_caixa)}</td></tr></tbody></table>
      <p class="small muted">Pagamento até ${dateBR(R.pagamento)}. ${$('#rs-m', md.el).value === 'pedido' && $('#rs-a', md.el).value === 'indenizado' ? 'No pedido de demissão o aviso não cumprido pode ser descontado do empregado (não entra aqui).' : ''}</p>`; return R; };
  $('#rs-c', md.el).onchange = () => { vencDefault(); calc(); }; $('#rs-d', md.el).onchange = () => { vencDefault(); calc(); };
  ['#rs-m', '#rs-a', '#rs-f', '#rs-v'].forEach(id => { $(id, md.el).oninput = calc; $(id, md.el).onchange = calc; });
  vencDefault(); calc();
  const gravar = async (confirmar, ev) => {
    const c = co(), R = calc(); if (!c || !R) return toast('Escolha o colaborador e a data', true);
    if (confirmar && !confirm(`Confirmar a rescisão de ${c.nome}? O colaborador passa a desligado e o pagamento (${money(R.total)}) e a multa do FGTS (${money(R.multa_fgts)}) entram como previsão no fluxo.`)) return;
    ev.target.disabled = true;
    const row = { empresa_id: state.empresa.id, colaborador_id: c.id, data_desligamento: $('#rs-d', md.el).value, motivo: $('#rs-m', md.el).value, aviso: $('#rs-a', md.el).value, salario: +c.salario || 0,
      saldo_fgts: +$('#rs-f', md.el).value || 0, ferias_vencidas_dias: +$('#rs-v', md.el).value || 0, verbas: R.verbas, total: R.total, multa_fgts: R.multa_fgts, pagamento: R.pagamento, observacao: $('#rs-obs', md.el).value.trim() || null };
    try {
      const [g] = await q(r ? sb.from('rh_rescisoes').update(row).eq('id', r.id).select('id') : sb.from('rh_rescisoes').insert(row).select('id'));
      if (confirmar || r?.situacao === 'confirmada') await q(sb.rpc('rh_rescisao_lancar', { p_id: g.id, p_confirmar: true }));
      toast(confirmar ? 'Rescisão confirmada e prevista no fluxo' : 'Simulação salva'); md.close(); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#rs-sim', md.el).onclick = (ev) => gravar(false, ev);
  $('#rs-conf', md.el).onclick = (ev) => gravar(true, ev);
  if (r?.situacao === 'confirmada') $('#rs-sim', md.el).style.display = 'none';
}

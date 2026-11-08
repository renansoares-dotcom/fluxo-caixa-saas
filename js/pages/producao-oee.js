// Produção › OEE e Perdas (PRD019) — melhoria 6.1 (SQL 113, 08/11/2026).
// OEE por máquina com disponibilidade, desempenho e qualidade contra as metas da empresa, tendência por dia, semana ou mês,
// as perdas em horas (do tempo planejado ao tempo efetivo), o Pareto das paradas (inclusive as OS de manutenção que
// pararam a máquina) e do refugo. Metas e parâmetros: administrador e financeiro.
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, today, chart, CORES, exportXLSX } from '../lib/ui.js';
import { drawer } from '../lib/componentes.js';
import { cadProducao, addDias } from '../lib/producao.js';
import * as K from '../lib/oee-calc.js';

export const title = 'OEE e Perdas';
const ui = { dias: 30, grupo: 'semana', setor: '' };
let D = null;
const pc = (v) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%');
const hh = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' h');
const kg = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kg';
const SITC = { ok: 'var(--pos)', atencao: 'var(--warn)', abaixo: 'var(--neg)' };
const rotPer = (p, g) => g === 'mes' ? ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+p.slice(5, 7) - 1] + '/' + p.slice(2, 4)
  : (g === 'semana' ? 'sem ' : '') + p.slice(8, 10) + '/' + p.slice(5, 7);

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">OEE e Perdas</h2><div class="muted small">Quanto do tempo planejado de cada máquina virou produto bom, e para onde foi o resto.</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <select id="oe-d" title="Período" style="width:auto">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [180, '6 meses'], [365, '12 meses']].map(([d, t]) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="oe-g" title="Agrupar por" style="width:auto">${[['dia', 'Por dia'], ['semana', 'Por semana'], ['mes', 'Por mês']].map(([v, t]) => `<option value="${v}" ${ui.grupo === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="oe-s" title="Setor" style="width:auto"><option value="">Todos os setores</option></select>
      ${podeEditar() ? '<button class="btn" id="oe-par">Metas</button>' : ''}<button class="btn" id="oe-xls">Exportar Excel</button></div></div>
    <div id="oe-corpo"><div class="loading">Calculando o OEE…</div></div>`;
  $('#oe-d', root).onchange = (e) => { ui.dias = +e.target.value; if (ui.dias >= 180 && ui.grupo === 'dia') ui.grupo = 'mes'; render(root); };
  $('#oe-g', root).onchange = (e) => { ui.grupo = e.target.value; render(root); };
  $('#oe-s', root).onchange = (e) => { ui.setor = e.target.value; pintar(root); };
  $('#oe-par', root) && ($('#oe-par', root).onclick = () => metas(root));
  $('#oe-xls', root).onclick = () => D && exportar();
  try {
    const e = state.empresa.id, ate = today(), de = addDias(ate, -(ui.dias - 1));
    const [C, cfg, dados] = await Promise.all([cadProducao(true),
      q(sb.from('prod_oee_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.rpc('prod_oee', { p_empresa: e, p_de: de, p_ate: ate, p_grupo: ui.grupo }))]);
    D = { C, cfg: { ...K.CFG_PADRAO, ...(cfg || {}) }, dados, linhas: K.preparar(dados, C.maquinas), de, ate };
    $('#oe-s', root).innerHTML = '<option value="">Todos os setores</option>' + C.setores.filter(s => s.ativo !== false).map(s => `<option value="${s.id}" ${ui.setor === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('');
    pintar(root);
  } catch (err) { fail(err); $('#oe-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível calcular o OEE. Confira se o SQL 113 já foi executado.</div></div>'; }
}

const filtradas = () => D.linhas.filter(l => !ui.setor || D.C.maqById[l.maquina_id]?.setor_id === ui.setor);

function pintar(root) {
  const L = filtradas(), cfg = D.cfg, G = K.indices(L), maqs = K.porMaquina(L), pers = K.porPeriodo(L);
  const semCap = D.C.maquinas.filter(m => m.ativo && !(+m.capacidade_kg_h)).filter(m => !ui.setor || m.setor_id === ui.setor);
  const kpi = (rot, v, meta, sub) => { const s = K.situacao(v, meta, cfg.atencao_pp);
    return `<div class="kpi" style="border-top:3px solid ${SITC[s] || 'var(--border)'}"><div class="k-label">${rot}</div><div class="k-value">${pc(v)}</div><div class="k-sub">meta ${meta}%${sub ? ' · ' + sub : ''}</div></div>`; };
  const mp = K.maiorPerda(G.perdas);
  const corpo = $('#oe-corpo', root);
  corpo.innerHTML = `
    <div class="kpis" style="margin-bottom:12px">${kpi('OEE', G.oee, cfg.meta_oee, 'tempo efetivo ' + hh(G.perdas.efetivo))}${kpi('Disponibilidade', G.D, cfg.meta_disp, hh(G.run) + ' de ' + hh(G.tPlan))}${kpi('Desempenho', G.P, cfg.meta_perf, kg(G.bom + G.refugo) + ' produzidos')}${kpi('Qualidade', G.Q, cfg.meta_qual, kg(G.refugo) + ' de refugo')}</div>
    ${mp ? `<div class="card small" style="margin-bottom:12px">Maior perda do período: <b>${esc(mp.nome)}</b> (${hh(mp.horas)}). ${G.h_os ? `As OS de manutenção pararam as máquinas por ${hh(G.h_os)} sem parada registrada na produção.` : ''}</div>` : ''}
    ${semCap.length ? `<div class="card small" style="margin-bottom:12px;border-left:3px solid var(--warn)">Sem capacidade (kg/h) cadastrada, fora do desempenho e do OEE: ${semCap.map(m => esc(m.codigo)).join(', ')}. Informe em <a href="#/producao/cadastros">Cadastros de Produção</a>.</div>` : ''}
    <div class="grid2"><div class="card"><h3 style="margin-top:0">Tendência do OEE</h3><div class="chart-box"><canvas id="oe-t"></canvas></div></div>
      <div class="card"><h3 style="margin-top:0">Do tempo planejado ao tempo efetivo</h3><div class="chart-box"><canvas id="oe-p"></canvas></div></div></div>
    <div class="card flush" style="margin-top:12px"><div style="padding:12px 16px 0"><h3 style="margin:0">Por máquina</h3><div class="small muted">Clique na máquina para ver a tendência, as perdas e as paradas.</div></div><div class="table-wrap" id="oe-maq">${tabelaMaquinas(maqs)}</div></div>
    <div class="grid2" style="margin-top:12px"><div class="card"><h3 style="margin-top:0">Paradas por motivo (Pareto)</h3><div id="oe-par-l"></div></div>
      <div class="card"><h3 style="margin-top:0">Refugo por motivo</h3><div id="oe-ref-l"></div></div></div>
    <details class="small muted" style="margin-top:10px"><summary>Como o OEE é calculado</summary><ul>
      <li><b>Tempo planejado</b> = horas produtivas do setor por dia × dias − paradas planejadas (motivos marcados como planejados em Cadastros).</li>
      <li><b>Disponibilidade</b> = horas apontadas ÷ tempo planejado. <b>Desempenho</b> = (bom + refugo) ÷ (horas apontadas × capacidade kg/h). <b>Qualidade</b> = bom ÷ (bom + refugo). <b>OEE</b> = os três multiplicados.</li>
      <li><b>Perdas</b>: paradas não planejadas da produção${cfg.contar_os_manutencao ? ' e das OS de manutenção que pararam a máquina sem parada registrada' : ''}; tempo sem apontamento nem parada; perda de velocidade (abaixo da capacidade); refugo. O que sobra é o tempo efetivo.</li>
      <li>Situação: meta atingida; atenção até ${cfg.atencao_pp} pontos abaixo; crítico além disso.</li></ul></details>`;
  const pt = pers.map(p => p.oee == null ? null : Math.round(p.oee * 1000) / 10);
  chart($('#oe-t', corpo), { type: 'line', data: { labels: pers.map(p => rotPer(p.per, D.dados.grupo)), datasets: [
    { label: 'OEE', data: pt, borderColor: CORES[0], backgroundColor: CORES[0], tension: 0.25, spanGaps: true },
    { label: 'Disponibilidade', data: pers.map(p => p.D == null ? null : Math.round(p.D * 1000) / 10), borderColor: CORES[3], borderWidth: 1, pointRadius: 0, tension: 0.25, spanGaps: true },
    { label: 'Desempenho', data: pers.map(p => p.P == null ? null : Math.round(p.P * 1000) / 10), borderColor: CORES[4], borderWidth: 1, pointRadius: 0, tension: 0.25, spanGaps: true },
    { label: `Meta ${cfg.meta_oee}%`, data: pers.map(() => +cfg.meta_oee), borderColor: CORES[7], borderDash: [4, 4], pointRadius: 0, borderWidth: 1 }] },
    options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } }, plugins: { legend: { position: 'bottom' } } } });
  graficoPerdas($('#oe-p', corpo), G);
  $$('[data-maq]', corpo).forEach(tr => tr.onclick = () => detalhe(tr.dataset.maq));
  lista($('#oe-par-l', corpo), K.pareto((D.dados.paradas || []).filter(p => incl(p.maquina_id)), 'horas'), (x) => `${hh(x.v)} · ${x.qtd}×${x.planejada ? ' · planejada' : ''}`);
  lista($('#oe-ref-l', corpo), K.pareto((D.dados.refugos || []).filter(p => incl(p.maquina_id)).map(r => ({ ...r, qtd: 0 })), 'kg'), (x) => kg(x.v));
}
const incl = (id) => !ui.setor || D.C.maqById[id]?.setor_id === ui.setor;

function lista(el, P, txt) {
  if (!P.length) { el.innerHTML = '<div class="empty" style="padding:8px">Nada registrado no período.</div>'; return; }
  el.innerHTML = P.slice(0, 10).map(x => `<div style="margin:6px 0"><div class="small" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(x.motivo)}</span><span class="muted">${txt(x)} · ${Math.round(x.pct * 100)}% (acum. ${Math.round(x.acum * 100)}%)</span></div>
    <div style="height:7px;background:var(--surface-2);border-radius:4px"><div style="height:7px;width:${Math.max(2, x.pct * 100)}%;background:${x.planejada ? 'var(--border)' : x.acum <= 0.8 ? 'var(--neg)' : 'var(--warn)'};border-radius:4px"></div></div></div>`).join('');
}

function graficoPerdas(cv, G) {
  const p = G.perdas;
  const itens = [['Paradas não planejadas', p.naoPlan, CORES[7]], ['Sem apontamento', p.naoApont, CORES[5]], ['Velocidade', p.velocidade, CORES[4]], ['Refugo', p.qualidade, CORES[1]], ['Tempo efetivo', p.efetivo || 0, CORES[3]]];
  chart(cv, { type: 'bar', data: { labels: ['Planejadas (fora)', ...itens.map(i => i[0])], datasets: [{ label: 'horas', data: [p.planejadas, ...itens.map(i => Math.round(i[1] * 10) / 10)],
    backgroundColor: ['#9aa3ad', ...itens.map(i => i[2])] }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => hh(c.raw) } } } } });
}

function tabelaMaquinas(maqs) {
  const cfg = D.cfg, C = D.C;
  const cel = (v, meta) => { const s = K.situacao(v, meta, cfg.atencao_pp); return `<td class="num" style="color:${s === 'abaixo' ? 'var(--neg)' : 'inherit'}">${pc(v)}</td>`; };
  const linhas = maqs.map(x => ({ x, m: C.maqById[x.maquina_id] })).filter(r => r.m).sort((a, b) => (a.x.oee ?? -1) - (b.x.oee ?? -1));
  if (!linhas.length) return '<div class="empty" style="padding:14px">Cadastre as máquinas em Produção › Cadastros.</div>';
  return `<table><thead><tr><th>Máquina</th><th>Setor</th><th class="num">Tempo planejado</th><th class="num">Apontado</th><th class="num">Paradas não plan.</th><th class="num">Bom</th><th class="num">Refugo</th><th class="num">Disp.</th><th class="num">Desemp.</th><th class="num">Qualid.</th><th class="num">OEE</th><th class="num">Meta</th></tr></thead><tbody>
    ${linhas.map(({ x, m }) => { const meta = K.metaMaquina(cfg, m.id), s = K.situacao(x.oee, meta, cfg.atencao_pp);
      return `<tr data-maq="${m.id}" style="cursor:pointer"><td><b>${esc(m.codigo)}</b> ${esc(m.nome)}</td><td>${esc(C.setorById[m.setor_id]?.nome || '')}</td><td class="num">${hh(x.tPlan)}</td><td class="num">${hh(x.run)}</td><td class="num">${hh(x.naoPlan)}</td>
        <td class="num">${kg(x.bom)}</td><td class="num">${kg(x.refugo)}</td>${cel(x.D, cfg.meta_disp)}${cel(x.P, cfg.meta_perf)}${cel(x.Q, cfg.meta_qual)}
        <td class="num"><span class="badge ${s === 'ok' ? 'pago' : s === 'atencao' ? 'aberto' : s ? 'vencido' : ''}">${pc(x.oee)}</span></td><td class="num muted">${meta}%</td></tr>`; }).join('')}</tbody></table>`;
}

function detalhe(id) {
  const m = D.C.maqById[id], L = D.linhas.filter(l => l.maquina_id === id), G = K.indices(L), pers = K.porPeriodo(L), meta = K.metaMaquina(D.cfg, id);
  const par = K.pareto((D.dados.paradas || []).filter(p => p.maquina_id === id), 'horas');
  const d = drawer({ titulo: `${m.codigo} — ${m.nome}`, subtitulo: `OEE ${pc(G.oee)} · meta ${meta}% · capacidade ${m.capacidade_kg_h ? m.capacidade_kg_h + ' kg/h' : 'não cadastrada'}`, corpo: `
    <div class="kpis" style="margin-bottom:10px">${[['Disponibilidade', G.D], ['Desempenho', G.P], ['Qualidade', G.Q]].map(([t, v]) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value">${pc(v)}</div></div>`).join('')}</div>
    <div style="height:200px"><canvas id="oe-dt"></canvas></div>
    <div style="height:190px;margin-top:10px"><canvas id="oe-dp"></canvas></div>
    <h4 style="margin:12px 0 4px">Paradas</h4><div id="oe-dl"></div>
    <div class="table-wrap" style="margin-top:10px"><table class="small"><thead><tr><th>Período</th><th class="num">Planejado</th><th class="num">Apontado</th><th class="num">Bom</th><th class="num">Refugo</th><th class="num">OEE</th></tr></thead><tbody>
      ${[...pers].reverse().map(p => `<tr><td>${rotPer(p.per, D.dados.grupo)}</td><td class="num">${hh(p.tPlan)}</td><td class="num">${hh(p.run)}</td><td class="num">${kg(p.bom)}</td><td class="num">${kg(p.refugo)}</td><td class="num"><b>${pc(p.oee)}</b></td></tr>`).join('')}</tbody></table></div>` });
  chart(d.el.querySelector('#oe-dt'), { type: 'line', data: { labels: pers.map(p => rotPer(p.per, D.dados.grupo)), datasets: [
    { label: 'OEE', data: pers.map(p => p.oee == null ? null : Math.round(p.oee * 1000) / 10), borderColor: CORES[0], backgroundColor: CORES[0], tension: 0.25, spanGaps: true },
    { label: `Meta ${meta}%`, data: pers.map(() => meta), borderColor: CORES[7], borderDash: [4, 4], pointRadius: 0, borderWidth: 1 }] },
    options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom' } } } });
  graficoPerdas(d.el.querySelector('#oe-dp'), G);
  lista(d.el.querySelector('#oe-dl'), par, (x) => `${hh(x.v)} · ${x.qtd}×`);
}

function exportar() {
  const L = filtradas(), C = D.C;
  const rows = [['Máquina', 'Setor', 'Período', 'Calendário (h)', 'Paradas planejadas (h)', 'Tempo planejado (h)', 'Apontado (h)', 'Paradas não planejadas (h)', 'OS manutenção (h)', 'Bom (kg)', 'Refugo (kg)', 'Disponibilidade', 'Desempenho', 'Qualidade', 'OEE']];
  for (const l of L) { const x = K.indices(l), m = C.maqById[l.maquina_id];
    rows.push([m?.codigo || '', C.setorById[m?.setor_id]?.nome || '', l.per, x.horas_cal, x.h_plan, x.tPlan, x.run, x.h_nao_plan, x.h_os, x.bom, x.refugo, x.D, x.P, x.Q, x.oee]); }
  exportXLSX(rows, `oee_${D.de}_${D.ate}`);
}

function metas(root) {
  const c = D.cfg, maqs = D.C.maquinas.filter(m => m.ativo);
  const m = modal({ title: 'Metas do OEE', wide: true, body: `
    <div class="grid-form">
      <label>OEE (%)<input type="number" id="mo-o" min="1" max="100" step="0.5" value="${c.meta_oee}"></label>
      <label>Disponibilidade (%)<input type="number" id="mo-d" min="1" max="100" step="0.5" value="${c.meta_disp}"></label>
      <label>Desempenho (%)<input type="number" id="mo-p" min="1" max="100" step="0.5" value="${c.meta_perf}"></label>
      <label>Qualidade (%)<input type="number" id="mo-q" min="1" max="100" step="0.5" value="${c.meta_qual}"></label>
      <label>Atenção: até quantos pontos abaixo da meta<input type="number" id="mo-a" min="0" max="50" step="0.5" value="${c.atencao_pp}"></label></div>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="mo-os" ${c.contar_os_manutencao ? 'checked' : ''}> Contar as OS de manutenção que pararam a máquina (sem parada registrada na produção) como parada não planejada</label>
    <h4 style="margin:14px 0 4px">Meta de OEE por máquina (vazio = a meta geral)</h4>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 14px">${maqs.map(x => `<label class="small">${esc(x.codigo)} ${esc(x.nome)}<input type="number" min="1" max="100" step="0.5" data-mm="${x.id}" value="${c.metas_maquina?.[x.id] ?? ''}" placeholder="${c.meta_oee}"></label>`).join('') || '<span class="muted small">Nenhuma máquina ativa.</span>'}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mo-ok">Salvar</button>' });
  $('#mo-ok', m.el).onclick = async () => {
    const v = (id) => +$(id, m.el).value;
    const reg = { empresa_id: state.empresa.id, meta_oee: v('#mo-o'), meta_disp: v('#mo-d'), meta_perf: v('#mo-p'), meta_qual: v('#mo-q'), atencao_pp: v('#mo-a'), contar_os_manutencao: $('#mo-os', m.el).checked, metas_maquina: {}, atualizado_em: new Date().toISOString() };
    if (![reg.meta_oee, reg.meta_disp, reg.meta_perf, reg.meta_qual].every(x => x >= 1 && x <= 100)) return toast('Metas de 1 a 100%', true);
    if (!(reg.atencao_pp >= 0 && reg.atencao_pp <= 50)) return toast('Atenção: de 0 a 50 pontos', true);
    for (const i of $$('[data-mm]', m.el)) { if (i.value === '') continue; const x = +i.value; if (!(x >= 1 && x <= 100)) return toast('Meta por máquina: de 1 a 100%', true); reg.metas_maquina[i.dataset.mm] = x; }
    try { await q(sb.from('prod_oee_config').upsert(reg)); m.close(); toast('Metas salvas'); render(root); } catch (err) { fail(err); }
  };
}

// Manutenção › Painel (PRD008): disponibilidade, MTBF, MTTR, aderência às preventivas, backlog por situação,
// Pareto de falhas, custo por equipamento e situação dos equipamentos críticos. Botão "Gerar preventivas".
import { sb, state, q } from '../lib/data.js';
import { $, esc, money0, fail, toast, today } from '../lib/ui.js';
import { kpiGrid, barList } from '../lib/componentes.js';
import * as M from '../lib/manutencao.js';
import { carregarManutencao, fichaOS, novaOS, nomeEq, selo, clsSit, clsPrio, CSS, podePCP, podeApontar } from '../lib/manutencao-ui.js';

export const title = 'Painel de Manutenção';

/** alertas para o Decision Center (regra 18) */
export async function alertasDecisao() {
  try { const D = await carregarManutencao({ meses: 2 }); if (!D.E.length) return []; return M.alertas({ ordens: D.O, planos: D.Pl, horasPorEquip: D.horasEq, hoje: today() }); } catch { return []; }
}
const ui = { dias: 30 };
const pctTxt = (v) => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1).replace('.', ',') + '%';
const hTxt = (v) => v == null ? '–' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' h';

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Painel de Manutenção</h2><div class="muted small">Ordens de serviço, preventivas e indicadores de confiabilidade das máquinas.</div></div>
      <div class="mn-acoes"><label>Período<select id="mp-d">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']].map(([d, t]) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${podePCP() ? '<button class="btn" id="mp-gerar">Gerar preventivas</button>' : ''}${podeApontar() ? '<button class="btn primary" id="mp-nova">Nova OS</button>' : ''}</div></div>
    <div id="mp-corpo"><div class="loading">Carregando…</div></div>`;
  $('#mp-d', root).onchange = (e) => { ui.dias = +e.target.value; render(root); };
  let D;
  try { D = await carregarManutencao(); } catch (err) { fail(err); $('#mp-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 086 (manutenção) já foi executado.</div></div>'; return; }
  const re = () => render(root);
  $('#mp-nova', root) && ($('#mp-nova', root).onclick = () => novaOS(D, { onSalvo: re }));
  $('#mp-gerar', root) && ($('#mp-gerar', root).onclick = async () => {
    try { const n = await q(sb.rpc('man_gerar_preventivas', { p_empresa: state.empresa.id, p_ate: null })); toast(+n ? `${n} OS preventiva(s) gerada(s)` : 'Nenhuma preventiva a gerar agora — todos os planos estão em dia'); re(); } catch (e) { fail(e); }
  });
  const corpo = $('#mp-corpo', root);
  if (!D.E.length) {
    corpo.innerHTML = `<div class="card"><div class="empty" style="padding:24px"><b>Nenhum equipamento cadastrado.</b><br>Vá em Manutenção › Equipamentos e Planos e use <b>Trazer as máquinas da produção</b>: as máquinas viram equipamentos críticos e o catálogo de falhas é criado.</div>
      <div style="text-align:center;padding-bottom:16px"><a class="btn primary" href="#/manutencao/equipamentos">Abrir Equipamentos e Planos</a></div></div>`; return;
  }
  const agora = Date.now(), ate = new Date().toISOString(), de = new Date(agora - ui.dias * 86400000).toISOString();
  const maquinas = D.E.filter(e => e.situacao !== 'inativo' && e.tipo === 'maquina');
  const ind = M.indicadores(D.O, { de, ate, nEquip: maquinas.length || 1, agora, tolerancia: +D.P.tolerancia_pct || 10 });
  const ab = D.O.filter(o => M.ABERTAS.includes(o.situacao)), em = ab.filter(o => o.prioridade === 'emergencia'), atr = ab.filter(o => M.atrasada(o, agora));
  const noPer = D.O.filter(o => o.solicitada_em >= de && o.situacao !== 'cancelada');
  const custoPer = noPer.reduce((s, o) => s + M.custoOS(o, D.H, D.Pc, +D.P.custo_hora || 0).total, 0);
  const planosVenc = D.Pl.filter(p => p.ativo && M.statusPlano(p, D.horasEq[p.equipamento_id] || 0).nivel === 'neg');
  const alertas = M.alertas({ ordens: D.O, planos: D.Pl, horasPorEquip: D.horasEq, hoje: today(), agora });
  const KP = {
    ab: { label: 'OS em aberto', valor: String(ab.length), sub: `${em.length} emergência(s) · ${atr.length} atrasada(s)`, tom: em.length || atr.length ? 'neg' : '', clicavel: true },
    disp: { label: 'Disponibilidade', valor: pctTxt(ind.disponibilidade), sub: `${hTxt(ind.horasParadas)} parada(s) por manutenção`, tom: ind.disponibilidade < 0.9 ? 'warn' : 'pos' },
    mtbf: { label: 'MTBF', valor: hTxt(ind.mtbf), sub: `${ind.falhas} quebra(s) no período` },
    mttr: { label: 'MTTR', valor: hTxt(ind.mttr), sub: 'tempo médio para voltar a operar', tom: ind.mttr > 8 ? 'warn' : '' },
    prev: { label: 'Aderência às preventivas', valor: pctTxt(ind.aderencia), sub: `${planosVenc.length} plano(s) vencido(s) · ${pctTxt(ind.pctPreventiva)} das OS são preventivas`, tom: ind.aderencia != null && ind.aderencia < 0.8 ? 'warn' : '' },
    custo: { label: 'Custo da manutenção', valor: 'R$ ' + money0(custoPer), sub: 'peças + mão de obra + terceiros' },
  };
  corpo.innerHTML = `${alertas.length ? `<div class="card" style="border-left:4px solid var(--neg);margin-bottom:12px">${alertas.map(a => `<div>${a.nivel === 'neg' ? '🔴' : '🟠'} ${esc(a.txt)}</div>`).join('')}</div>` : ''}
    <div id="mp-kpis"></div>
    <div class="card" style="margin-top:16px"><h2>Backlog</h2><div class="mn-kanban" id="mp-kb"></div></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h2>Pareto das falhas (horas de máquina parada)</h2><div id="mp-par"></div><p class="muted small">Corretivas no período. As primeiras barras concentram a maior parte do tempo perdido: é onde a preventiva rende mais.</p></div>
      <div class="card"><h2>Custo por equipamento</h2><div id="mp-cus"></div></div></div>
    <div class="card" style="margin-top:16px"><h2>Equipamentos críticos (A)</h2><div class="mn-k" id="mp-eq"></div></div>`;
  $('#mp-kpis', corpo).classList.add('mn-kpis6'); kpiGrid($('#mp-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k })), (id) => { if (id === 'ab') location.hash = '#/manutencao/ordens'; });
  const col = (tit, L) => `<div class="mn-col"><div class="small" style="font-weight:700;margin-bottom:6px">${tit} <span class="muted">(${L.length})</span></div>${M.fila(L, agora).slice(0, 8).map(o => `<div class="mn-card ${o.prioridade === 'emergencia' || M.atrasada(o, agora) ? 'c-neg' : o.prioridade === 'alta' ? 'c-warn' : ''}" data-os="${o.id}">
      <div style="display:flex;justify-content:space-between;gap:6px"><b>OS ${o.numero}</b>${selo(M.PRIORIDADES[o.prioridade], clsPrio(o.prioridade))}</div><div class="small">${esc(nomeEq(D, o.equipamento_id))}</div>
      <div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(M.TIPOS_OS[o.tipo])} · ${esc(o.descricao)}</div></div>`).join('')}${L.length > 8 ? `<a class="small" href="#/manutencao/ordens">+ ${L.length - 8} na lista</a>` : ''}</div>`;
  $('#mp-kb', corpo).innerHTML = col('A atender', ab.filter(o => ['solicitada', 'aberta'].includes(o.situacao))) + col('Programadas', ab.filter(o => o.situacao === 'programada'))
    + col('Em execução', ab.filter(o => o.situacao === 'em_execucao')) + col('Aguardando', ab.filter(o => o.situacao.startsWith('aguardando')));
  $('#mp-kb', corpo).onclick = (e) => { const c = e.target.closest('[data-os]'); if (c) fichaOS(D, D.O.find(o => o.id === c.dataset.os), { onMudou: re }); };
  const par = M.pareto(noPer.filter(o => o.situacao === 'concluida'), D.F, agora).slice(0, 8);
  barList($('#mp-par', corpo), par.map(x => ({ nome: x.nome, valor: x.horas, txt: `${hTxt(x.horas)} · ${x.n} OS`, sub: `acumulado ${pctTxt(x.acumulado)}` })), { vazio: 'Nenhuma corretiva no período.' });
  const porEq = {}; noPer.forEach(o => { porEq[o.equipamento_id] = (porEq[o.equipamento_id] || 0) + M.custoOS(o, D.H, D.Pc, +D.P.custo_hora || 0).total; });
  barList($('#mp-cus', corpo), Object.entries(porEq).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, v]) => ({ nome: nomeEq(D, id), valor: v, sub: `${noPer.filter(o => o.equipamento_id === id).length} OS`, onClick: () => { location.hash = `#/manutencao/equipamentos?abrir=${id}`; } })), { vazio: 'Sem custo lançado no período.' });
  const crit = D.E.filter(e => e.criticidade === 'A' && e.situacao !== 'inativo');
  $('#mp-eq', corpo).innerHTML = crit.map(e => {
    const os = ab.filter(o => o.equipamento_id === e.id), pl = D.Pl.filter(p => p.equipamento_id === e.id && p.ativo).map(p => M.statusPlano(p, D.horasEq[e.id] || 0));
    const ie = M.indicadores(D.O.filter(o => o.equipamento_id === e.id), { de, ate, nEquip: 1, agora });
    const cor = e.situacao === 'operando' ? 'pos' : e.situacao === 'em_manutencao' ? 'warn' : 'neg';
    return `<a class="card" href="#/manutencao/equipamentos?abrir=${e.id}" style="text-decoration:none;color:inherit;border-top:4px solid var(--${cor === 'pos' ? 'pos' : cor === 'warn' ? 'warn' : 'neg'});padding:10px">
      <div style="display:flex;justify-content:space-between;gap:6px"><b>${esc(e.codigo)}</b>${selo(M.SIT_EQUIP[e.situacao], cor)}</div><div class="small">${esc(e.nome)}</div>
      <div class="small muted" style="margin-top:6px">Disp. ${pctTxt(ie.disponibilidade)} · ${os.length} OS aberta(s)</div>
      <div class="small ${pl.some(x => x.nivel === 'neg') ? 'neg' : pl.some(x => x.nivel === 'warn') ? 'warn' : 'muted'}">${pl.length ? (pl.some(x => x.nivel === 'neg') ? 'Preventiva vencida' : pl.some(x => x.nivel === 'warn') ? 'Preventiva próxima' : 'Preventivas em dia') : 'Sem plano preventivo'}</div></a>`;
  }).join('') || '<div class="empty">Nenhum equipamento de criticidade A.</div>';
}

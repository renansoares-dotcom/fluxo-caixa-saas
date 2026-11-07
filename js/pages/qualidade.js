// Qualidade › Painel (PRD012): fila de inspeção, material em quarentena, aprovação, RNC, IQF dos fornecedores e Pareto das reprovações.
import { sb, state, q } from '../lib/data.js';
import { $, esc, money0, fail, toast } from '../lib/ui.js';
import { kpiGrid, barList } from '../lib/componentes.js';
import * as Q from '../lib/qualidade.js';
import { carregarQualidade, fichaInspecao, novaInspecao, nomeProd, refTxt, selo, clsSit, CSS, podeRegistrar, podeGerir } from '../lib/qualidade-ui.js';

export const title = 'Painel da Qualidade';
const ui = { dias: 30 };
const pctTxt = (v) => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1).replace('.', ',') + '%';

/** alertas para o Decision Center (regra 19) */
export async function alertasDecisao() {
  try {
    const D = await carregarQualidade({ meses: 3 }); if (!D.Pl.length && !D.I.length) return [];
    return Q.alertas({ inspecoes: D.I, rncs: D.R, quarentena: D.quarentena.valor, bloqueados: D.lotesBloq.length + D.bobinasBloq.length, ranking: D.ranking, meta: +D.P.meta_aprovacao_pct || 95 });
  } catch { return []; }
}

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Painel da Qualidade</h2><div class="muted small">Inspeção no recebimento, no processo e no produto final, com bloqueio do material até a decisão.</div></div>
      <div class="ql-acoes"><label>Período<select id="qp-d">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']].map(([d, t]) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${podeRegistrar() ? '<button class="btn" id="qp-nf">Buscar notas de entrada</button><button class="btn primary" id="qp-nova">Nova inspeção</button>' : ''}</div></div>
    <div id="qp-corpo"><div class="loading">Carregando…</div></div>`;
  $('#qp-d', root).onchange = (e) => { ui.dias = +e.target.value; render(root); };
  let D;
  try { D = await carregarQualidade(); } catch (err) { fail(err); $('#qp-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 087 (qualidade) já foi executado.</div></div>'; return; }
  const re = () => render(root);
  $('#qp-nova', root) && ($('#qp-nova', root).onclick = () => novaInspecao(D, { onSalvo: re }));
  $('#qp-nf', root) && ($('#qp-nf', root).onclick = async () => {
    try { const n = await q(sb.rpc('qual_gerar_recebimento', { p_empresa: state.empresa.id, p_desde: null })); toast(+n ? `${n} inspeção(ões) aberta(s) pelas notas de entrada dos últimos 30 dias` : 'Nenhuma nota nova com plano de recebimento'); re(); } catch (e) { fail(e); }
  });
  const corpo = $('#qp-corpo', root);
  if (D.semConfig || !D.Pl.length) {
    corpo.innerHTML = `<div class="card"><div class="empty" style="padding:24px"><b>A qualidade ainda não está configurada.</b><br>Em Qualidade › Planos e Parâmetros, clique em <b>Configurar a qualidade</b> (cria os locais Quarentena e Reprovado e a tabela de amostragem) e cadastre os planos de inspeção dos produtos.</div>
      <div style="text-align:center;padding-bottom:16px"><a class="btn primary" href="#/qualidade/planos">Abrir Planos e Parâmetros</a></div></div>`; return;
  }
  const agora = Date.now(), ate = new Date().toISOString(), de = new Date(agora - ui.dias * 86400000).toISOString();
  const ind = Q.indicadores(D.I, D.R, { de, ate, agora }), meta = (+D.P.meta_aprovacao_pct || 95) / 100;
  const alertas = Q.alertas({ inspecoes: D.I, rncs: D.R, quarentena: D.quarentena.valor, bloqueados: D.lotesBloq.length + D.bobinasBloq.length, ranking: D.ranking, meta: meta * 100, agora });
  const KP = {
    pend: { label: 'Inspeções pendentes', valor: String(ind.pendentes), sub: `${ind.atrasadas} fora do prazo`, tom: ind.atrasadas ? 'neg' : '', clicavel: true },
    qua: { label: 'Em quarentena', valor: 'R$ ' + money0(D.quarentena.valor), sub: `${D.quarentena.qtd} item(ns) aguardando decisão`, tom: D.quarentena.valor ? 'warn' : '' },
    apr: { label: 'Aprovação', valor: pctTxt(ind.aprovacao), sub: `${ind.decididas} decidida(s) · meta ${pctTxt(meta)}`, tom: ind.aprovacao != null && ind.aprovacao < meta ? 'warn' : 'pos' },
    con: { label: 'Concessões', valor: pctTxt(ind.concessao), sub: `${ind.reprovadas} reprovada(s)` },
    tmp: { label: 'Tempo de inspeção', valor: ind.tempoMedio != null ? ind.tempoMedio.toLocaleString('pt-BR') + ' h' : '–', sub: `prazo ${D.P.prazo_horas} h` },
    rnc: { label: 'Não conformidades', valor: String(ind.rncAbertas), sub: `${ind.rncVencidas} com ação vencida · R$ ${money0(ind.custo)} no período`, tom: ind.rncVencidas ? 'neg' : '', clicavel: true },
  };
  const fila = Q.fila(D.I, agora);
  corpo.innerHTML = `${alertas.length ? `<div class="card" style="border-left:4px solid var(--neg);margin-bottom:12px">${alertas.map(a => `<div>${a.nivel === 'neg' ? '🔴' : '🟠'} ${esc(a.txt)}</div>`).join('')}</div>` : ''}
    <div id="qp-kpis"></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0;display:flex;justify-content:space-between"><h2>Fila de inspeção</h2><a class="small" href="#/qualidade/inspecoes">ver todas</a></div><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Produto</th><th>Etapa</th><th class="num">Quantidade</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>
      ${fila.slice(0, 8).map(i => `<tr class="clickable" data-i="${i.id}"><td><b>${i.numero}</b></td><td>${esc(nomeProd(D, i.produto_id))}<div class="small muted">${esc(refTxt(D, i))}</div></td>
        <td>${esc(Q.ETAPAS[i.etapa])}${i.origem === 'liberacao' ? `<div>${selo('Máquina aguardando', 'warn')}</div>` : ''}</td><td class="num">${(+i.quantidade || 0).toLocaleString('pt-BR')} ${esc(i.unidade || '')}</td>
        <td>${Q.atrasada(i, agora) ? selo('Fora do prazo', 'neg') : `<span class="small">${new Date(i.prazo).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>`}</td><td>${selo(Q.SITUACOES[i.situacao], clsSit(i.situacao))}</td></tr>`).join('')
        || '<tr><td colspan="6" class="empty">Nenhuma inspeção pendente.</td></tr>'}</tbody></table></div></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h2>Qualidade dos fornecedores (IQF)</h2><div id="qp-iqf"></div><p class="muted small">Aprovado = 100, aprovado com concessão = 50, reprovado = 0, na média dos lotes recebidos em 13 meses. Meta: ${esc(String(D.P.meta_aprovacao_pct))}.</p></div>
      <div class="card"><h2>O que mais reprova</h2><div id="qp-par"></div><p class="muted small">Características fora da especificação nas inspeções decididas do período.</p></div></div>`;
  $('#qp-kpis', corpo).classList.add('ql-kpis6');
  kpiGrid($('#qp-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k })), (id) => { if (id === 'pend') location.hash = '#/qualidade/inspecoes'; if (id === 'rnc') location.hash = '#/qualidade/nao-conformidades'; });
  corpo.querySelector('tbody').onclick = (e) => { const r = e.target.closest('[data-i]'); if (r) fichaInspecao(D, D.I.find(x => x.id === r.dataset.i), { onMudou: re }); };
  barList($('#qp-iqf', corpo), D.ranking.slice(0, 8).map(f => ({ nome: f.nome, valor: f.iqf, txt: `IQF ${f.iqf.toLocaleString('pt-BR')}`, cor: f.iqf < meta * 100 ? 1 : 3,
    sub: `${f.lotes} lote(s) · ${f.reprovados} reprovado(s) · ${f.concessoes} concessão(ões)` })), { vazio: 'Sem lotes recebidos decididos.' });
  const per = D.I.filter(i => i.decidida_em && i.decidida_em >= de);
  barList($('#qp-par', corpo), Q.pareto(per, D.plById).slice(0, 8).map(x => ({ nome: x.nome, valor: x.n, txt: `${x.n} inspeção(ões)`, sub: `acumulado ${pctTxt(x.acumulado)}` })), { vazio: 'Nenhuma característica reprovada no período.' });
}

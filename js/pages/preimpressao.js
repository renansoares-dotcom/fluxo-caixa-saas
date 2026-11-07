// Comercial › Painel da Pré-impressão (COM005): artes em cada etapa (quadro), aprovação do cliente pelo Portal,
// rodadas até aprovar, tempo de resposta do cliente, OPs esperando arte e clientes que mais pedem alteração.
import { sb, state } from '../lib/data.js';
import { $, esc, fail, dateBR, today } from '../lib/ui.js';
import { kpiGrid, barList } from '../lib/componentes.js';
import * as P from '../lib/preimpressao.js';
import { linksArte } from '../lib/arte-viewer.js';
import { carregarArtes, fichaArte, novaArte, cliTxt, CSS, pode, nf } from '../lib/preimpressao-ui.js';

export const title = 'Painel da Pré-impressão';
const ui = { dias: 30 };
const tempo = (h) => h == null ? '–' : h < 48 ? `${nf(h, 1)} h` : `${nf(h / 24, 1)} dias`;

/** alertas para a Central de Decisões (regra 21) */
export async function alertasDecisao() {
  try { const D = await carregarArtes(); if (!D.Pj.length) return []; return P.alertas({ projetos: D.Pj, opsPendentes: D.opsPendentes }); } catch { return []; }
}

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Painel da Pré-impressão</h2><div class="muted small">Da arte-final à liberação: versões com impressão digital (SHA-256), aprovação do cliente no Portal com prova, clicheria e produção.</div></div>
      <div class="pi-acoes"><label>Período<select id="pp-d">${[[30, '30 dias'], [90, '90 dias'], [365, '12 meses']].map(([d, t]) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <a class="btn ghost" href="#/preimpressao/artes">Todas as artes</a>${pode() ? '<button class="btn primary" id="pp-nova">Nova arte</button>' : ''}</div></div>
    <div id="pp-corpo"><div class="loading">Carregando…</div></div>`;
  $('#pp-d', root).onchange = (e) => { ui.dias = +e.target.value; render(root); };
  let D;
  try { D = await carregarArtes(); } catch (err) { fail(err); $('#pp-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 089 (pré-impressão) já foi executado.</div></div>'; return; }
  const re = () => render(root), abrir = (p) => fichaArte(D, p, { onMudou: re });
  $('#pp-nova', root) && ($('#pp-nova', root).onclick = () => novaArte(D, { onSalvo: abrir }));
  const corpo = $('#pp-corpo', root), hoje = today();
  if (!D.Pj.length) {
    corpo.innerHTML = `<div class="card"><div class="empty" style="padding:28px"><b>Nenhuma arte ainda.</b><br>Crie a primeira arte com a ficha técnica da embalagem, envie o arquivo (o PDF vira prévia no navegador) e mande ao cliente: ele aprova no Portal do Cliente, com assinatura e a impressão digital do arquivo.
      ${D.semConfig ? '<br><br>Antes, revise os <b>Parâmetros</b> em Todas as artes (checklist, prazo do cliente, termo de aprovação e a trava da OP).' : ''}</div>
      <div style="text-align:center;padding-bottom:18px">${pode() ? '<button class="btn primary" id="pp-n2">Criar a primeira arte</button>' : ''}</div></div>`;
    $('#pp-n2', corpo) && ($('#pp-n2', corpo).onclick = () => novaArte(D, { onSalvo: abrir })); return;
  }
  const de = new Date(Date.now() - ui.dias * 864e5).toISOString().slice(0, 10);
  const ind = P.indicadores(D.Pj, D.Ve, D.De, { de, ate: hoje, hoje }), al = P.alertas({ projetos: D.Pj, opsPendentes: D.opsPendentes });
  const nomes = Object.fromEntries(D.Pj.map(p => [p.favorecido_id, cliTxt(D, p.favorecido_id)]));
  const rank = P.porCliente(D.Pj, D.Ve, D.De, nomes, { de, ate: hoje });
  const KP = {
    ab: { label: 'Em andamento', valor: String(ind.abertas), sub: `${ind.emAjuste} em criação ou ajuste`, clicavel: true },
    cl: { label: 'Com o cliente', valor: String(ind.comCliente), sub: ind.atrasadas ? `${ind.atrasadas} fora do prazo` : 'todas no prazo', tom: ind.atrasadas ? 'neg' : '', clicavel: true },
    ap: { label: 'Aprovadas', valor: String(ind.aprovadas), sub: `${ind.pedidosAlteracao} pedido(s) de alteração`, tom: 'pos' },
    ro: { label: 'Rodadas até aprovar', valor: ind.rodadasMedia != null ? nf(ind.rodadasMedia, 1) : '–', sub: ind.primeira != null ? `${ind.primeira}% aprovadas na 1ª` : 'sem aprovações', tom: ind.rodadasMedia > 2 ? 'warn' : '' },
    rs: { label: 'Resposta do cliente', valor: tempo(ind.respostaH), sub: ind.leadDias != null ? `${nf(ind.leadDias, 1)} dias da criação à aprovação` : 'tempo médio' },
    op: { label: 'OPs esperando arte', valor: String(D.opsPendentes.length), sub: D.Pm.bloquear_op ? 'trava da OP ligada' : 'trava da OP desligada', tom: D.opsPendentes.length ? 'warn' : '' },
  };
  corpo.innerHTML = `${al.length ? `<div class="card" style="border-left:4px solid var(--warn);margin-bottom:12px">${al.map(a => `<div>${a.nivel === 'alto' ? '🔴' : a.nivel === 'medio' ? '🟠' : '🔵'} <b>${esc(a.titulo)}</b> <span class="small muted">${esc(a.detalhe)}</span></div>`).join('')}</div>` : ''}
    <div id="pp-kpis"></div>
    <div class="pi-kan" style="margin-top:16px" id="pp-kan">${P.COLUNAS.map(c => {
      const L = D.Pj.filter(p => c.sits.includes(p.situacao) && (c.id !== 'liberada' || (p.liberada_em && p.liberada_em.slice(0, 10) >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))));
      return `<div class="pi-col"><h3><span>${c.titulo}</span><span class="muted">${L.length}</span></h3>${L.slice(0, 12).map(p => card(D, p, hoje)).join('') || '<div class="small muted" style="padding:6px">—</div>'}
        ${L.length > 12 ? `<a class="small" href="#/preimpressao/artes">+ ${L.length - 12}</a>` : ''}</div>`; }).join('')}</div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h2>Rodadas até a aprovação</h2><div id="pp-rod"></div><p class="small muted" style="margin-bottom:0">Quantas versões foram ao cliente até a aprovada. Muitas rodadas = briefing incompleto ou conferência fraca antes do envio.</p></div>
      <div class="card flush"><div style="padding:14px 16px 0"><h2>Clientes — rodadas e tempo de resposta</h2></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th class="num">Artes</th><th class="num">Rodadas</th><th class="num">Resposta</th></tr></thead><tbody>
        ${rank.slice(0, 8).map(r => `<tr><td>${esc(r.nome)}</td><td class="num">${r.artes}</td><td class="num ${r.rodadas > 2 ? 'neg' : ''}">${nf(r.rodadas, 1)}</td><td class="num">${tempo(r.respostaH)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhuma aprovação no período.</td></tr>'}</tbody></table></div></div></div>
    ${D.opsPendentes.length ? `<div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>OPs com arte ainda não aprovada</h2></div><div class="table-wrap"><table><thead><tr><th>OP</th><th>Produto</th><th>Entrega</th><th>Arte</th></tr></thead><tbody>
      ${D.opsPendentes.slice(0, 15).map(o => { const p = D.pjById[o.projeto_id]; return `<tr class="clickable" data-p="${p.id}"><td>OP ${o.numero}</td><td class="wrap">${esc(o.descricao || '')}</td><td>${dateBR(o.entrega) || '—'}</td><td>nº ${p.numero} · ${esc(P.SITUACOES[p.situacao])}</td></tr>`; }).join('')}</tbody></table></div></div>` : ''}`;
  $('#pp-kpis', corpo).classList.add('pi-kpis6');
  kpiGrid($('#pp-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k })), (id) => { if (id === 'ab' || id === 'cl') { sessionStorage.setItem('pi-filtro', id === 'cl' ? 'cliente' : 'andamento'); location.hash = '#/preimpressao/artes'; } });
  barList($('#pp-rod', corpo), ind.porRodada.map(x => ({ nome: x.n === '1' ? '1 rodada (aprovada de primeira)' : `${x.n} rodadas`, valor: x.qtd, txt: `${x.qtd} arte(s)` })), { vazio: 'Nenhuma aprovação no período.' });
  corpo.onclick = (e) => { const c = e.target.closest('[data-p]'); if (c) abrir(D.pjById[c.dataset.p]); };
  // miniaturas das artes no quadro
  const cams = [...corpo.querySelectorAll('[data-im]')].map(i => i.dataset.im);
  if (cams.length) linksArte(sb, cams).then(U => corpo.querySelectorAll('[data-im]').forEach(i => { if (U[i.dataset.im]) i.innerHTML = `<img src="${U[i.dataset.im]}" alt="" loading="lazy">`; })).catch(() => {});
}

function card(D, p, hoje) {
  const v = [...D.versoesDe(p.id)].reverse().find(x => x.previa), atr = p.situacao === 'aguardando_cliente' && p.prazo && p.prazo < hoje;
  const dias = P.parada(p);
  return `<div class="pi-card ${atr ? 'atr' : ''}" data-p="${p.id}"><div class="im" ${v ? `data-im="${esc(v.previa)}"` : ''}>${v ? '' : '<span class="small muted">sem arquivo</span>'}</div>
    <div class="tx"><b title="${esc(p.nome)}">nº ${p.numero} · ${esc(p.nome)}</b><div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cliTxt(D, p.favorecido_id))}</div>
      <div class="r"><span>${v ? 'V' + v.numero : ''}${['alteracao_solicitada', 'reprovada'].includes(p.situacao) ? ' · <span class="neg">alteração</span>' : ''}</span>
      <span class="${atr ? 'neg' : ''}">${p.situacao === 'aguardando_cliente' && p.prazo ? 'até ' + dateBR(p.prazo).slice(0, 5) : dias ? `${dias} d` : 'hoje'}</span></div></div></div>`;
}

// Casa de Tintas › Ordens de Preparação (PRD017): fila das ordens e a ficha de pesagem.
import { state } from '../lib/data.js';
import { $, $$, esc, fail, exportXLSX, dateBR, money, debounce } from '../lib/ui.js';
import * as T from '../lib/tintas.js';
import { carregarTintas, fichaOrdem, novaOrdem, corTxt, versaoTxt, opTxt, selo, clsOrdem, amostra, CSS, podeTintas, nf } from '../lib/tintas-ui.js';

export const title = 'Ordens de Preparação';
const ui = { f: 'abertas', busca: '' };
const FILTROS = [['abertas', 'Em preparação'], ['ajuste', 'Em ajuste'], ['prontas', 'Prontas / na máquina'], ['encerradas', 'Encerradas'], ['todas', 'Todas']];
let D = null;

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Ordens de Preparação</h2><div class="muted small">Pesagem item a item contra a receita aprovada, medição da cor e da viscosidade, lote com etiqueta e entrega à máquina.</div></div>
      <div class="tn-acoes"><button class="btn ghost" id="to-xls">Excel</button>${podeTintas() ? '<button class="btn primary" id="to-nova">Nova ordem</button>' : ''}</div></div>
    <div class="card toolbar"><div class="chips" id="to-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.f === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><input id="to-b" placeholder="Procurar cor, OP, lote" value="${esc(ui.busca)}" style="width:190px"></div>
    <div id="to-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#to-f', root).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.f = f; $$('#to-f .chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === f)); pintar(root); } };
  $('#to-b', root).oninput = debounce((e) => { ui.busca = e.target.value; pintar(root); }, 200);
  $('#to-xls', root).onclick = () => exportXLSX($('#to-lista table', root), 'ordens_tinta');
  const ab = state.abrir?.tipo === 'tinta' ? state.abrir : null; if (ab) delete state.abrir;
  try { D = await carregarTintas(); } catch (err) { fail(err); $('#to-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 088 (casa de tintas) já foi executado.</div></div>'; return; }
  const mudou = (x) => (x?.silencioso ? pintar(root) : render(root));
  $('#to-nova', root) && ($('#to-nova', root).onclick = () => novaOrdem(D, { onSalvo: (o) => { D.O.unshift(o); pintar(root); fichaOrdem(D, o, { onMudou: mudou }); } }));
  pintar(root);
  if (ab) { const o = D.O.find(x => x.id === ab.id); if (o) fichaOrdem(D, o, { onMudou: mudou }); }
  root._mudou = mudou;
}

function pintar(root) {
  const b = ui.busca.trim().toLowerCase();
  const L = D.O.filter(o => (ui.f === 'abertas' ? ['aberta', 'em_pesagem'].includes(o.situacao) : ui.f === 'ajuste' ? o.situacao === 'em_ajuste' : ui.f === 'prontas' ? ['aprovada', 'entregue'].includes(o.situacao)
    : ui.f === 'encerradas' ? ['encerrada', 'cancelada'].includes(o.situacao) : true)
    && (!b || `${o.numero} ${corTxt(D, o.cor_id)} ${opTxt(D, o.ordem_id)} ${o.lote_codigo || ''} ${o.responsavel || ''}`.toLowerCase().includes(b)));
  $('#to-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Cor</th><th>Receita</th><th class="num">kg</th><th>Situação</th><th class="num">Custo/kg</th><th>Lote</th></tr></thead><tbody>
    ${L.map(o => `<tr class="clickable" data-o="${o.id}"><td><b>${o.numero}</b><div class="small muted">${dateBR(o.criado_em.slice(0, 10))}</div></td>
      <td>${amostra(D.coById[o.cor_id]?.hex)}${esc(corTxt(D, o.cor_id))}<div class="small muted">${esc(opTxt(D, o.ordem_id))}</div></td><td class="small">${esc(versaoTxt(D, o.versao_id))}</td>
      <td class="num">${nf(o.quantidade_real ?? o.quantidade)}<div class="small muted">${o.quantidade_real != null && +o.quantidade_real !== +o.quantidade ? 'plan. ' + nf(o.quantidade) : ''}${+o.entregue_kg ? ` · entregue ${nf(o.entregue_kg)}` : ''}</div></td>
      <td>${selo(T.SIT_ORDEM[o.situacao], clsOrdem(o.situacao))}${o.concessao ? `<div>${selo('Concessão', 'warn')}</div>` : ''}</td>
      <td class="num">${o.custo_kg != null ? money(o.custo_kg) : '–'}</td><td class="small">${esc(o.lote_codigo || '—')}${o.validade ? `<div class="muted">até ${dateBR(o.validade)}</div>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">Nenhuma ordem neste filtro.</td></tr>'}</tbody></table></div></div>`;
  $('#to-lista', root).onclick = (e) => { const r = e.target.closest('[data-o]'); if (r) fichaOrdem(D, D.O.find(x => x.id === r.dataset.o), { onMudou: root._mudou }); };
}

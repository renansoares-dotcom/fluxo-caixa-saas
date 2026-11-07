// Qualidade › Inspeções (PRD013): fila e histórico das inspeções, com a ficha (resultados, avaliação ao vivo, decisão e laudo).
import { state } from '../lib/data.js';
import { $, $$, esc, fail, exportXLSX, dateBR, debounce } from '../lib/ui.js';
import * as Q from '../lib/qualidade.js';
import { carregarQualidade, fichaInspecao, novaInspecao, nomeProd, refTxt, selo, clsSit, CSS, podeRegistrar } from '../lib/qualidade-ui.js';

export const title = 'Inspeções';
const ui = { f: 'abertas', etapa: '', busca: '' };
const FILTROS = [['abertas', 'Pendentes'], ['atrasadas', 'Fora do prazo'], ['liberacao', 'Liberação de máquina'], ['aprovadas', 'Aprovadas'], ['reprovada', 'Reprovadas'], ['todas', 'Todas']];
let D = null;

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Inspeções</h2><div class="muted small">A fila vem na ordem de atendimento: fora do prazo, máquina aguardando a liberação e depois a mais antiga.</div></div>
      <div class="ql-acoes"><button class="btn ghost" id="qi-xls">Excel</button>${podeRegistrar() ? '<button class="btn primary" id="qi-nova">Nova inspeção</button>' : ''}</div></div>
    <div class="card toolbar"><div class="chips" id="qi-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.f === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><select id="qi-e" style="max-width:160px"><option value="">Todas as etapas</option>${Object.entries(Q.ETAPAS).map(([k, t]) => `<option value="${k}" ${ui.etapa === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input id="qi-b" placeholder="Procurar" value="${esc(ui.busca)}" style="width:170px"></div>
    <div id="qi-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#qi-f', root).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.f = f; $$('#qi-f .chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === f)); pintar(root); } };
  $('#qi-e', root).onchange = (e) => { ui.etapa = e.target.value; pintar(root); };
  $('#qi-b', root).oninput = debounce((e) => { ui.busca = e.target.value; pintar(root); }, 200);
  $('#qi-xls', root).onclick = () => exportXLSX($('#qi-lista table', root), 'inspecoes');
  const ab = state.abrir?.tipo === 'insp' ? state.abrir : null; if (ab) delete state.abrir;
  try { D = await carregarQualidade(); } catch (err) { fail(err); $('#qi-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  $('#qi-nova', root) && ($('#qi-nova', root).onclick = () => novaInspecao(D, { onSalvo: () => render(root) }));
  pintar(root);
  if (ab) { const i = D.I.find(x => x.id === ab.id); if (i) fichaInspecao(D, i, { onMudou: () => render(root) }); }
}

function pintar(root) {
  const agora = Date.now(), b = ui.busca.trim().toLowerCase();
  let L = D.I.filter(i => {
    if (ui.f === 'abertas' && !Q.ABERTAS.includes(i.situacao)) return false;
    if (ui.f === 'atrasadas' && !Q.atrasada(i, agora)) return false;
    if (ui.f === 'liberacao' && !(i.origem === 'liberacao' && Q.ABERTAS.includes(i.situacao))) return false;
    if (ui.f === 'aprovadas' && !['aprovada', 'aprovada_concessao'].includes(i.situacao)) return false;
    if (ui.f === 'reprovada' && i.situacao !== 'reprovada') return false;
    if (ui.etapa && i.etapa !== ui.etapa) return false;
    if (b && !`${i.numero} ${nomeProd(D, i.produto_id)} ${refTxt(D, i)} ${i.inspetor || ''}`.toLowerCase().includes(b)) return false;
    return true;
  });
  if (['abertas', 'atrasadas', 'liberacao'].includes(ui.f)) L = Q.fila(L, agora);
  $('#qi-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Produto</th><th>Etapa</th><th class="num">Quantidade</th><th class="num">Amostra</th><th>Situação</th><th>Decisão</th></tr></thead><tbody>
    ${L.slice(0, 500).map(i => `<tr class="clickable" data-i="${i.id}"><td><b>${i.numero}</b><div class="small muted">${dateBR(i.criado_em.slice(0, 10))}</div></td>
      <td class="wrap">${esc(nomeProd(D, i.produto_id))}<div class="small muted">${esc(refTxt(D, i))}</div></td>
      <td>${esc(Q.ETAPAS[i.etapa])}<div class="small muted">${esc(Q.ORIGENS[i.origem] || '')}</div></td>
      <td class="num">${i.quantidade != null ? (+i.quantidade).toLocaleString('pt-BR') + ' ' + esc(i.unidade || '') : '–'}${i.movimento_id && Q.ABERTAS.includes(i.situacao) ? `<div>${selo('Na quarentena', 'warn')}</div>` : ''}</td>
      <td class="num">${i.amostra ?? '–'}<div class="small muted">Ac ${i.ac ?? 0} · Re ${i.re ?? 1}</div></td>
      <td>${selo(Q.SITUACOES[i.situacao], clsSit(i.situacao))}${Q.atrasada(i, agora) ? `<div>${selo('Fora do prazo', 'neg')}</div>` : ''}</td>
      <td class="small">${i.decidida_em ? `${esc(i.decidida_por || '')}<div class="muted">${dateBR(i.decidida_em.slice(0, 10))}</div>` : '—'}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">Nenhuma inspeção neste filtro.</td></tr>'}</tbody>${L.length ? `<tfoot><tr><td colspan="7">${L.length} inspeção(ões)${L.length > 500 ? ' (mostrando 500)' : ''}</td></tr></tfoot>` : ''}</table></div></div>`;
  $('#qi-lista', root).onclick = (e) => { const r = e.target.closest('[data-i]'); if (r) fichaInspecao(D, D.I.find(x => x.id === r.dataset.i), { onMudou: () => render(root) }); };
}

// Manutenção › Ordens de Serviço (PRD009): lista com filtros, nova OS e a ficha completa (execução, horas, peças, terceiros, anexos, impressão).
import { state } from '../lib/data.js';
import { $, $$, esc, fail, exportXLSX, money, dateBR, debounce } from '../lib/ui.js';
import * as M from '../lib/manutencao.js';
import { carregarManutencao, fichaOS, novaOS, nomeEq, selo, clsSit, clsPrio, CSS, podeApontar } from '../lib/manutencao-ui.js';

export const title = 'Ordens de Serviço';
const ui = { f: 'abertas', tipo: '', eq: '', busca: '' };
const FILTROS = [['abertas', 'Em aberto'], ['emergencia', 'Emergências'], ['atrasadas', 'Atrasadas'], ['aguardando', 'Aguardando'], ['concluida', 'Concluídas'], ['todas', 'Todas']];
let D = null;

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Ordens de Serviço</h2><div class="muted small">Corretivas, preventivas, inspeções e melhorias. A fila já vem na ordem de atendimento: prioridade, atraso e antiguidade.</div></div>
      <div class="mn-acoes"><button class="btn ghost" id="mo-xls">Excel</button>${podeApontar() ? '<button class="btn primary" id="mo-nova">Nova OS</button>' : ''}</div></div>
    <div class="card toolbar"><div class="chips" id="mo-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.f === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><select id="mo-t" style="max-width:150px"><option value="">Todos os tipos</option>${Object.entries(M.TIPOS_OS).map(([k, t]) => `<option value="${k}" ${ui.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="mo-e" style="max-width:170px"><option value="">Todos os equipamentos</option></select>
      <input id="mo-b" placeholder="Procurar" value="${esc(ui.busca)}" style="width:160px"></div>
    <div id="mo-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#mo-f', root).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.f = f; $$('#mo-f .chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === f)); pintar(root); } };
  $('#mo-t', root).onchange = (e) => { ui.tipo = e.target.value; pintar(root); };
  $('#mo-e', root).onchange = (e) => { ui.eq = e.target.value; pintar(root); };
  $('#mo-b', root).oninput = debounce((e) => { ui.busca = e.target.value; pintar(root); }, 200);
  $('#mo-xls', root).onclick = () => exportXLSX($('#mo-lista table', root), 'ordens_servico');
  const ab = state.abrir?.tipo === 'os' ? state.abrir : null; if (ab) delete state.abrir;
  try { D = await carregarManutencao(); } catch (err) { fail(err); $('#mo-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  $('#mo-e', root).innerHTML = '<option value="">Todos os equipamentos</option>' + D.E.map(e => `<option value="${e.id}" ${ui.eq === e.id ? 'selected' : ''}>${esc(e.codigo)} · ${esc(e.nome)}</option>`).join('');
  $('#mo-nova', root) && ($('#mo-nova', root).onclick = () => novaOS(D, { pre: { equipamento_id: ui.eq || null }, onSalvo: () => render(root) }));
  pintar(root);
  if (ab) { const o = D.O.find(x => x.id === ab.id); if (o) fichaOS(D, o, { onMudou: () => render(root) }); }
}

function pintar(root) {
  const agora = Date.now(), b = ui.busca.trim().toLowerCase();
  let L = D.O.filter(o => {
    if (ui.f === 'abertas' && !M.ABERTAS.includes(o.situacao)) return false;
    if (ui.f === 'emergencia' && !(M.ABERTAS.includes(o.situacao) && o.prioridade === 'emergencia')) return false;
    if (ui.f === 'atrasadas' && !M.atrasada(o, agora)) return false;
    if (ui.f === 'aguardando' && !o.situacao.startsWith('aguardando')) return false;
    if (ui.f === 'concluida' && o.situacao !== 'concluida') return false;
    if (ui.tipo && o.tipo !== ui.tipo) return false;
    if (ui.eq && o.equipamento_id !== ui.eq) return false;
    if (b && !`${o.numero} ${o.descricao} ${o.responsavel || ''} ${nomeEq(D, o.equipamento_id)}`.toLowerCase().includes(b)) return false;
    return true;
  });
  L = ['abertas', 'emergencia', 'atrasadas', 'aguardando'].includes(ui.f) ? M.fila(L, agora) : L;
  const tot = L.reduce((s, o) => s + M.custoOS(o, D.H, D.Pc, +D.P.custo_hora || 0).total, 0);
  $('#mo-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>OS</th><th>Equipamento</th><th>Serviço</th><th>Prioridade</th><th>Situação</th><th>Prazo</th><th class="num">Custo</th></tr></thead><tbody>
    ${L.slice(0, 500).map(o => { const c = M.custoOS(o, D.H, D.Pc, +D.P.custo_hora || 0), at = M.atrasada(o, agora);
      return `<tr class="clickable" data-os="${o.id}"><td><b>${o.numero}</b><div class="small muted">${dateBR(o.solicitada_em.slice(0, 10))}</div></td>
        <td>${esc(nomeEq(D, o.equipamento_id))}${o.maquina_parou ? `<div>${selo(o.parada_fim || !M.ABERTAS.includes(o.situacao) ? 'Parou a máquina' : 'Máquina parada', o.parada_fim ? 'muted' : 'neg')}</div>` : ''}</td>
        <td class="wrap">${esc(M.TIPOS_OS[o.tipo])} — ${esc(o.descricao)}<div class="small muted">${esc(o.responsavel || '')}${o.origem !== 'manual' && o.origem !== 'solicitacao' ? ` · origem ${esc(o.origem)}` : ''}</div></td>
        <td>${selo(M.PRIORIDADES[o.prioridade], clsPrio(o.prioridade))}</td><td>${selo(M.SITUACOES[o.situacao], clsSit(o.situacao))}${at ? `<div>${selo('Atrasada', 'neg')}</div>` : ''}</td>
        <td>${o.situacao === 'concluida' ? `<span class="small">feita ${dateBR((o.fim || '').slice(0, 10))}</span>` : esc(dateBR(o.programada_para || o.vence_em) || '—')}</td><td class="num">${c.total ? money(c.total) : '–'}</td></tr>`; }).join('')
      || '<tr><td colspan="7" class="empty">Nenhuma OS neste filtro.</td></tr>'}</tbody>
    ${L.length ? `<tfoot><tr><td colspan="6">${L.length} OS${L.length > 500 ? ' (mostrando 500)' : ''}</td><td class="num"><b>${money(tot)}</b></td></tr></tfoot>` : ''}</table></div></div>`;
  $('#mo-lista', root).onclick = (e) => { const r = e.target.closest('[data-os]'); if (r) fichaOS(D, D.O.find(o => o.id === r.dataset.os), { onMudou: () => render(root) }); };
}

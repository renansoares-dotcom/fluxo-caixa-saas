// Comercial › Artes (COM006): todas as artes com filtros, a ficha completa e os parâmetros da pré-impressão.
import { sb, state } from '../lib/data.js';
import { $, $$, esc, fail, exportXLSX, dateBR, today, debounce } from '../lib/ui.js';
import * as P from '../lib/preimpressao.js';
import { linksArte } from '../lib/arte-viewer.js';
import { carregarArtes, fichaArte, novaArte, parametros, cliTxt, prodTxt, seloSit, selo, CSS, pode, podeConfig, hora } from '../lib/preimpressao-ui.js';

export const title = 'Artes e Aprovações';
const ui = { f: 'andamento', busca: '' };
const FILTROS = [['andamento', 'Em andamento'], ['cliente', 'Com o cliente'], ['ajuste', 'Alteração pedida'], ['aprovadas', 'Aprovadas / clicheria'], ['liberadas', 'Liberadas'], ['canceladas', 'Canceladas'], ['arquivadas', 'Arquivadas'], ['todas', 'Todas']];
const FILTRA = {
  andamento: (p) => P.ABERTAS.includes(p.situacao), cliente: (p) => p.situacao === 'aguardando_cliente', ajuste: (p) => ['alteracao_solicitada', 'reprovada'].includes(p.situacao),
  aprovadas: (p) => ['aprovada', 'na_clicheria'].includes(p.situacao), liberadas: (p) => p.situacao === 'liberada', canceladas: (p) => p.situacao === 'cancelada', todas: () => true,
};
let D = null;

export async function render(root) {
  const pf = sessionStorage.getItem('pi-filtro'); if (pf) { ui.f = pf; sessionStorage.removeItem('pi-filtro'); }
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Artes e Aprovações</h2><div class="muted small">Ficha técnica da embalagem, versões com SHA-256, pinos de comentário, aprovação do cliente no Portal, clicheria e liberação.</div></div>
      <div class="pi-acoes"><button class="btn ghost" id="pa-xls">Excel</button>${podeConfig() ? '<button class="btn ghost" id="pa-par">Parâmetros</button>' : ''}${pode() ? '<button class="btn primary" id="pa-nova">Nova arte</button>' : ''}</div></div>
    <div class="card toolbar"><div class="chips" id="pa-f">${FILTROS.map(([k, t]) => `<span class="chip ${ui.f === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><input id="pa-b" placeholder="Procurar nº, embalagem, cliente, código" value="${esc(ui.busca)}" style="width:240px"></div>
    <div id="pa-lista" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#pa-f', root).onclick = async (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (!f) return; const antes = ui.f; ui.f = f; $$('#pa-f .chip', root).forEach(c => c.classList.toggle('on', c.dataset.f === f));
    if ((f === 'arquivadas') !== (antes === 'arquivadas')) await carregar(root); pintar(root); };
  $('#pa-b', root).oninput = debounce((e) => { ui.busca = e.target.value; pintar(root); }, 200);
  $('#pa-xls', root).onclick = () => exportXLSX($('#pa-lista table', root), 'artes');
  const ab = state.abrir?.tipo === 'arte' ? state.abrir : null; if (ab) delete state.abrir;
  if (!(await carregar(root))) return;
  const mudou = (x) => (x?.silencioso ? pintar(root) : render(root));
  root._mudou = mudou;
  $('#pa-nova', root) && ($('#pa-nova', root).onclick = () => novaArte(D, { onSalvo: (p) => { D.Pj.unshift(p); D.pjById[p.id] = p; pintar(root); fichaArte(D, p, { onMudou: mudou }); } }));
  $('#pa-par', root) && ($('#pa-par', root).onclick = () => parametros(D, { onSalvo: () => render(root) }));
  pintar(root);
  if (ab) { const p = D.pjById[ab.id]; if (p) fichaArte(D, p, { onMudou: mudou }); }
}

async function carregar(root) {
  try { D = await carregarArtes({ arquivadas: ui.f === 'arquivadas' }); return true; }
  catch (err) { fail(err); $('#pa-lista', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 089 (pré-impressão) já foi executado.</div></div>'; return false; }
}

function pintar(root) {
  const b = ui.busca.trim().toLowerCase(), hoje = today();
  const L = D.Pj.filter(p => (ui.f === 'arquivadas' ? p.arquivado : !p.arquivado && FILTRA[ui.f](p))
    && (!b || `${p.numero} ${p.nome} ${p.codigo_cliente || ''} ${cliTxt(D, p.favorecido_id)} ${prodTxt(D, p.produto_id)} ${p.ean || ''}`.toLowerCase().includes(b)));
  $('#pa-lista', root).innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th style="width:56px"></th><th>Nº</th><th>Embalagem</th><th>Produto / OP</th><th>Versão</th><th>Situação</th><th>Prazo</th></tr></thead><tbody>
    ${L.map(p => { const v = D.ultima(p.id), vp = [...D.versoesDe(p.id)].reverse().find(x => x.previa), atr = p.situacao === 'aguardando_cliente' && p.prazo && p.prazo < hoje, op = p.ordem_id && D.opById[p.ordem_id];
      return `<tr class="clickable" data-p="${p.id}"><td>${vp ? `<span data-im="${esc(vp.previa)}"><span class="pi-mini" style="display:inline-block"></span></span>` : ''}</td><td><b>${p.numero}</b><div class="small muted">${P.TIPOS[p.tipo]?.split(' ')[0] || ''}</div></td>
        <td class="wrap">${esc(p.nome)}<div class="small muted">${esc(cliTxt(D, p.favorecido_id))}${p.codigo_cliente ? ' · ' + esc(p.codigo_cliente) : ''}</div></td>
        <td class="small wrap">${esc(prodTxt(D, p.produto_id)) || '—'}${op ? `<div class="muted">OP ${op.numero}</div>` : ''}</td>
        <td>${v ? `V${v.numero}` : '—'}<div class="small muted">${v ? (v.origem === 'cliente' ? 'do cliente' : v.enviada_em ? 'enviada' : 'rascunho') : 'sem arquivo'}</div></td>
        <td>${seloSit(p.situacao)}${p.versao_aprovada_id && p.situacao !== 'aprovada' && p.situacao !== 'liberada' && p.situacao !== 'na_clicheria' ? `<div>${selo('já teve aprovação', 'muted')}</div>` : ''}</td>
        <td class="${atr ? 'neg' : ''}">${dateBR(p.prazo) || '—'}<div class="small muted">${hora(p.atualizado_em)}</div></td></tr>`; }).join('')
    || '<tr><td colspan="7" class="empty">Nenhuma arte neste filtro.</td></tr>'}</tbody></table></div></div>`;
  $('#pa-lista', root).onclick = (e) => { const r = e.target.closest('[data-p]'); if (r) fichaArte(D, D.pjById[r.dataset.p], { onMudou: root._mudou }); };
  const cams = [...root.querySelectorAll('#pa-lista [data-im]')].slice(0, 80).map(i => i.dataset.im);
  if (cams.length) linksArte(sb, cams).then(U => root.querySelectorAll('#pa-lista [data-im]').forEach(i => { if (U[i.dataset.im]) i.innerHTML = `<img class="pi-mini" src="${U[i.dataset.im]}" alt="" loading="lazy">`; })).catch(() => {});
}

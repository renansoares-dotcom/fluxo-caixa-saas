// Cadastros › Centros de Custo e Grupos. Centros em níveis (melhoria 9.5, SQL 143): área › departamento › centro (nomes e quantidade configuráveis).
import { sb, state, q, podeEditar, isAdmin, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, exportXLSX } from '../lib/ui.js';
import { crudPage } from '../lib/crud.js';
import { arvore, caminho, subarvore } from '../lib/centros.js';

export const title = 'Centros de Custo e Grupos';
const TIPOS = { produtivo: 'Produtivo', apoio: 'Apoio à produção', administrativo: 'Administrativo', comercial: 'Comercial' };
let CFG = null;

export async function render(root) {
  root.innerHTML = '<div id="cc-arv"></div><div id="cc-grp" style="margin-top:16px"></div>';
  try { [CFG] = await q(sb.from('cc_config').select('*').eq('empresa_id', state.empresa.id)); } catch { CFG = null; }
  CFG = CFG || { niveis: 3, nomes_niveis: ['Área', 'Departamento', 'Centro de custo'], so_ultimo_nivel: false, base_valores: 'pago' };
  desenhar($('#cc-arv', root));
  crudPage($('#cc-grp', root), {
    table: 'grupos', titulo: 'Grupos empresariais (ex.: matriz, filiais, empresas do grupo)',
    rows: () => state.cad.grupos,
    cols: [{ k: 'nome', t: 'Nome' }],
    fields: [{ k: 'nome', t: 'Nome', req: true }],
    antesSalvar: (r) => { r.nome = r.nome.trim().toUpperCase(); },
  });
}

const nomeNivel = (n) => CFG.nomes_niveis?.[n - 1] || `Nível ${n}`;

function desenhar(el) {
  const ed = podeEditar(), L = state.cad.cc || [], A = arvore(L);
  el.innerHTML = `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2>Centros de custo</h2>
      <p class="small muted">${CFG.niveis} nível(is): ${Array.from({ length: CFG.niveis }, (_, i) => nomeNivel(i + 1)).join(' › ')}. Os relatórios somam cada centro com os de baixo.</p></div>
      <div><button class="btn" id="cc-xls">Exportar Excel</button>${isAdmin() ? ' <button class="btn" id="cc-cfg">Níveis</button>' : ''}${ed ? ' <button class="btn primary" id="cc-novo">+ Novo</button>' : ''}</div></div>
    <div class="table-wrap"><table id="cc-tab"><thead><tr><th>Centro de custo</th><th>Código</th><th>Nível</th><th>Tipo</th><th></th>${ed ? '<th></th>' : ''}</tr></thead><tbody>
    ${A.map(c => `<tr class="${ed ? 'clickable' : ''}" data-id="${c.id}"><td style="padding-left:${12 + c.prof * 22}px">${c.prof ? '<span class="muted">└ </span>' : ''}${c.filhos ? `<b>${esc(c.nome)}</b>` : esc(c.nome)}</td>
      <td class="small">${esc(c.codigo || '')}</td><td class="small muted">${nomeNivel(c.nivel || c.prof + 1)}</td><td class="small">${TIPOS[c.tipo] || ''}</td>
      <td>${c.ativo ? '' : '<span class="badge vencido">inativo</span>'}</td>${ed ? `<td>${(c.nivel || c.prof + 1) < CFG.niveis ? `<button class="btn small ghost" data-sub="${c.id}">+ abaixo</button>` : ''}</td>` : ''}</tr>`).join('')
    || `<tr><td colspan="6" class="empty">Nenhum centro de custo.</td></tr>`}</tbody></table></div></div>`;
  $('#cc-xls', el).onclick = () => exportXLSX($('#cc-tab', el), 'centros_custo');
  $('#cc-cfg', el) && ($('#cc-cfg', el).onclick = () => niveis(el));
  if (!ed) return;
  $('#cc-novo', el).onclick = () => editar(el, { ativo: true });
  $('#cc-tab tbody', el).onclick = (e) => {
    const sub = e.target.closest('[data-sub]')?.dataset.sub; if (sub) return editar(el, { ativo: true, pai_id: sub });
    const id = e.target.closest('tr[data-id]')?.dataset.id; if (id) editar(el, L.find(c => c.id === id));
  };
}

function editar(el, c) {
  const L = state.cad.cc || [], mapa = new Map(L.map(x => [x.id, x]));
  // pode ficar abaixo de quem não é ele nem descendente dele, e está acima do último nível
  const proibidos = c.id ? subarvore(c.id, L) : new Set();
  const pais = arvore(L).filter(x => !proibidos.has(x.id) && (x.nivel || x.prof + 1) < CFG.niveis);
  const md = modal({ title: c.id ? 'Centro de custo' : 'Novo centro de custo', body: `<div class="grid2">
      <label>Nome<input id="ce-nome" value="${esc(c.nome || '')}"></label><label>Código (opcional)<input id="ce-cod" value="${esc(c.codigo || '')}" placeholder="ex.: 2.1.03"></label>
      <label>Fica abaixo de<select id="ce-pai"><option value="">— (${nomeNivel(1)})</option>${pais.map(x => `<option value="${x.id}" ${x.id === c.pai_id ? 'selected' : ''}>${'  '.repeat(x.prof)}${esc(caminho(x.id, mapa))}</option>`).join('')}</select></label>
      <label>Tipo<select id="ce-tipo"><option value="">—</option>${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${c.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="ce-at" ${c.ativo !== false ? 'checked' : ''}> Ativo</label></div>
    <p class="small muted">O tipo ajuda no rateio: centros de apoio e administrativos costumam ser rateados para os produtivos.</p>`,
    foot: `${c.id ? '<button class="btn danger" id="ce-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ce-ok">Salvar</button>` });
  $('#ce-ok', md.el).onclick = async () => {
    const r = { empresa_id: state.empresa.id, nome: $('#ce-nome', md.el).value.trim().toUpperCase(), codigo: $('#ce-cod', md.el).value.trim() || null, pai_id: $('#ce-pai', md.el).value || null,
      tipo: $('#ce-tipo', md.el).value || null, ativo: $('#ce-at', md.el).checked };
    if (!r.nome) return toast('Informe o nome', true);
    try { await q(c.id ? sb.from('centros_custo').update(r).eq('id', c.id) : sb.from('centros_custo').insert(r)); await loadCadastros(); toast('Centro salvo'); md.close(); desenhar(el); } catch (e) { fail(e); }
  };
  $('#ce-del', md.el) && ($('#ce-del', md.el).onclick = async () => {
    if (L.some(x => x.pai_id === c.id)) return toast('Mova ou exclua os centros de baixo antes', true);
    if (!confirm(`Excluir o centro ${c.nome}? Lançamentos ligados a ele ficam sem centro.`)) return;
    try { await q(sb.from('centros_custo').delete().eq('id', c.id)); await loadCadastros(); toast('Centro excluído'); md.close(); desenhar(el); } catch (e) { fail(e); }
  });
}

function niveis(el) {
  const md = modal({ title: 'Níveis dos centros de custo', body: `<div class="grid2">
      <label>Quantidade de níveis<select id="nv-q">${[1, 2, 3, 4, 5].map(n => `<option ${n === CFG.niveis ? 'selected' : ''}>${n}</option>`).join('')}</select></label><div></div>
      ${[1, 2, 3, 4, 5].map(n => `<label>Nome do nível ${n}<input class="nv-n" value="${esc(CFG.nomes_niveis?.[n - 1] || '')}"></label>`).join('')}
      <label>Valores dos relatórios e do rateio<select id="nv-b"><option value="pago" ${CFG.base_valores === 'pago' ? 'selected' : ''}>Só pagos/recebidos</option><option value="todos" ${CFG.base_valores === 'todos' ? 'selected' : ''}>Pagos e em aberto (pela data)</option></select></label>
      <label class="chk"><input type="checkbox" id="nv-u" ${CFG.so_ultimo_nivel ? 'checked' : ''}> Avisar quando o lançamento usar um centro que tem centros abaixo</label></div>
    <p class="small muted">Diminuir a quantidade de níveis só é aceito se nenhum centro passar do novo limite.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nv-ok">Salvar</button>' });
  $('#nv-ok', md.el).onclick = async () => {
    const n = +$('#nv-q', md.el).value;
    if ((state.cad.cc || []).some(c => (c.nivel || 1) > n)) return toast(`Há centros abaixo do nível ${n}`, true);
    const v = { empresa_id: state.empresa.id, niveis: n, nomes_niveis: $$('.nv-n', md.el).map(x => x.value.trim()).slice(0, n).map((x, i) => x || `Nível ${i + 1}`), base_valores: $('#nv-b', md.el).value,
      so_ultimo_nivel: $('#nv-u', md.el).checked, atualizado_em: new Date().toISOString() };
    try { await q(sb.from('cc_config').upsert(v)); CFG = v; toast('Níveis salvos'); md.close(); desenhar(el); } catch (e) { fail(e); }
  };
}

// CRUD genérico para cadastros simples
import { sb, state, q, podeEditar, loadCadastros } from './data.js';
import { $, esc, options, modal, formData, toast, fail, money, parseNum, exportXLSX, debounce } from './ui.js';

/**
 * cfg = { table, titulo, rows: () => array, cols: [{k, t, fmt?, num?}], fields: [{k, t, type?, opts?, req?, span?}], busca?: fn }
 */
export function crudPage(root, cfg) {
  const ed = podeEditar();
  const wrap = document.createElement('div'); wrap.className = 'card flush';
  wrap.innerHTML = `<div class="toolbar" style="padding:12px">
      ${cfg.busca ? '<label class="grow">Buscar<input id="cb" placeholder="Digite para filtrar…"></label>' : '<span class="spacer"></span>'}
      <button class="btn" id="cx">Exportar Excel</button>
      ${ed ? `<button class="btn primary" id="cn">+ Novo</button>` : ''}</div>
    <div class="table-wrap" id="ct"></div>`;
  if (cfg.titulo) { const h = document.createElement('div'); h.style.padding = '16px 16px 0'; h.innerHTML = `<h2>${esc(cfg.titulo)}</h2>`; wrap.prepend(h); }
  root.appendChild(wrap);
  let termo = '';
  const draw = () => {
    let rows = cfg.rows();
    if (termo) rows = rows.filter(r => cfg.busca(r).toLowerCase().includes(termo));
    $('#ct', wrap).innerHTML = rows.length ? `<table><thead><tr>${cfg.cols.map(c => `<th class="${c.num ? 'num' : ''}">${c.t}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr class="${ed ? 'clickable' : ''}" data-id="${r.id}">${cfg.cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${c.fmt ? c.fmt(r) : esc(r[c.k] ?? '')}</td>`).join('')}</tr>`).join('')}
      </tbody></table>` : '<div class="empty">Nenhum registro.</div>';
  };
  draw();
  if (cfg.busca) $('#cb', wrap).oninput = debounce((e) => { termo = e.target.value.toLowerCase(); draw(); }, 200);
  $('#cx', wrap).onclick = () => exportXLSX($('#ct table', wrap), cfg.table);
  if (!ed) return;
  const abrir = (r = {}) => {
    const m = modal({
      title: r.id ? 'Editar' : 'Novo',
      body: `<form id="cf" class="grid-form">${cfg.fields.map(f => {
        const v = r[f.k] ?? f.def ?? '';
        if (f.type === 'select') return `<label class="${f.span ? 'span2' : ''}">${f.t}<select name="${f.k}">${options(f.opts(), { selected: v, empty: f.req ? null : '—', value: f.value || 'id', label: f.label || 'nome' })}</select></label>`;
        if (f.type === 'check') return `<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="${f.k}" ${v === true || v === '' && f.def !== false ? 'checked' : ''}> ${f.t}</label>`;
        if (f.type === 'money') return `<label>${f.t}<input name="${f.k}" inputmode="decimal" value="${v !== '' ? money(v) : ''}"></label>`;
        return `<label class="${f.span ? 'span2' : ''}">${f.t}<input name="${f.k}" value="${esc(v)}" ${f.req ? 'required' : ''} ${f.list ? `list="dl-${f.k}"` : ''}>${f.list ? `<datalist id="dl-${f.k}">${f.list().map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}</label>`;
      }).join('')}</form>`,
      foot: `${r.id ? '<button class="btn danger" id="cd" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cs">Salvar</button>`,
    });
    $('#cs', m.el).onclick = async () => {
      const form = $('#cf', m.el); if (!form.reportValidity()) return;
      const d = formData(form); const row = {};
      for (const f of cfg.fields) row[f.k] = f.type === 'check' ? !!d[f.k] : f.type === 'money' ? parseNum(d[f.k]) : (d[f.k] ?? null);
      if (cfg.antesSalvar) cfg.antesSalvar(row);
      try {
        if (r.id) await q(sb.from(cfg.table).update(row).eq('id', r.id));
        else await q(sb.from(cfg.table).insert({ ...row, empresa_id: state.empresa.id }));
        await loadCadastros(true); toast('Salvo'); m.close(); draw();
      } catch (e) { fail(e.code === '23505' ? new Error('Já existe um registro com esse nome') : e); }
    };
    if (r.id) $('#cd', m.el).onclick = async () => {
      if (!confirm('Excluir este registro?')) return;
      try { await q(sb.from(cfg.table).delete().eq('id', r.id)); await loadCadastros(true); toast('Excluído'); m.close(); draw(); }
      catch (e) { fail(e.code === '23503' ? new Error('Registro em uso em lançamentos. Inative em vez de excluir.') : e); }
    };
  };
  $('#cn', wrap).onclick = () => abrir();
  $('#ct', wrap).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) abrir(cfg.rows().find(x => x.id === tr.dataset.id)); };
}

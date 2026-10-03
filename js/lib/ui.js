// Utilidades de interface: formatação, DOM, modal, toast, export
export const MESES = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
export const MESES_CURTO = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const nf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export const money = (v) => (v == null || isNaN(v)) ? '–' : nf.format(+v);
export const money0 = (v) => (v == null || isNaN(v)) ? '–' : nf0.format(+v);
export const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '–' : (v * 100).toFixed(d).replace('.', ',') + '%';
export const cls = (v) => (+v < 0 ? 'neg' : (+v > 0 ? 'pos' : ''));
export const dateBR = (s) => s ? s.slice(0, 10).split('-').reverse().join('/') : '';
export const today = () => new Date().toISOString().slice(0, 10);
export const parseNum = (s) => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  s = String(s).trim().replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function options(list, { value = 'id', label = 'nome', selected = null, empty = null } = {}) {
  let out = empty != null ? `<option value="">${esc(empty)}</option>` : '';
  for (const it of list) {
    const v = typeof value === 'function' ? value(it) : it[value];
    const l = typeof label === 'function' ? label(it) : it[label];
    out += `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
  }
  return out;
}

export function toast(msg, err = false) {
  const el = h(`<div class="toast ${err ? 'err' : ''}">${esc(msg)}</div>`);
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), err ? 6000 : 3000);
}
export function fail(e) { console.error(e); toast(e?.message || String(e), true); }

export function modal({ title, body, foot = '', wide = false, onMount }) {
  const back = h(`<div class="modal-back"><div class="modal" style="${wide ? 'max-width:1100px' : ''}">
    <div class="modal-head"><h2 style="margin:0">${esc(title)}</h2><button class="btn ghost icon" data-close>✕</button></div>
    <div class="modal-body"></div><div class="modal-foot"></div></div></div>`);
  const b = $('.modal-body', back); typeof body === 'string' ? b.innerHTML = body : b.appendChild(body);
  const f = $('.modal-foot', back); typeof foot === 'string' ? f.innerHTML = foot : f.appendChild(foot);
  if (!foot) f.remove();
  const close = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  $('#modal-root').appendChild(back);
  onMount && onMount(back, close);
  return { el: back, close };
}

export function confirmDialog(msg) {
  return new Promise(res => {
    const m = modal({ title: 'Confirmar', body: `<p>${esc(msg)}</p>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn danger" id="cf-ok">Confirmar</button>` });
    $('#cf-ok', m.el).onclick = () => { m.close(); res(true); };
    m.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) res(false); });
  });
}

export function formData(form) {
  const o = {};
  for (const [k, v] of new FormData(form).entries()) o[k] = v === '' ? null : v;
  return o;
}

export function loading(el, msg = 'Carregando…') { el.innerHTML = `<div class="loading">${esc(msg)}</div>`; }

// Exporta uma <table> (ou matriz) para Excel
export function exportXLSX(tableOrRows, nome = 'relatorio') {
  if (!window.XLSX) return toast('Biblioteca de Excel ainda carregando', true);
  const wb = XLSX.utils.book_new();
  const ws = Array.isArray(tableOrRows) ? XLSX.utils.aoa_to_sheet(tableOrRows)
    : XLSX.utils.table_to_sheet(tableOrRows, { raw: false });
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  XLSX.writeFile(wb, `${nome}.xlsx`);
}

export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export const CORES = ['#1f6feb', '#12a26a', '#e5534b', '#b26a00', '#8250df', '#0f9bb3', '#d4458f', '#6e7781'];
export function chart(canvas, cfg) {
  if (!window.Chart) return null;
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue('--muted').trim();
  Chart.defaults.borderColor = css.getPropertyValue('--border').trim();
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new Chart(canvas, cfg);
  return canvas._chart;
}
export const moneyTick = (v) => {
  const a = Math.abs(v);
  return a >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' mi' : a >= 1e3 ? (v / 1e3).toFixed(0) + ' mil' : v;
};

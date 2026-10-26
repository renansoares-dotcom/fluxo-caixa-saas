// Listas com busca: toda <select> com muitas opções (plano de contas, favorecido, conta, centro de custo…) ganha um campo
// onde se digita parte do nome ou do código e a lista filtra na hora (sem acento, sem maiúscula). Setas + Enter escolhem,
// Esc fecha sem mudar, Tab confirma e segue. Os mais usados (por campo, neste navegador) aparecem no topo antes de digitar.
// O <select> original continua no formulário (invisível): o valor, o "change" e o "required" funcionam como antes.
// Para não aplicar numa lista: <select data-nobusca>.

const MIN_OPCOES = 12;
const LS = 'sb-usados';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let usados = {};
try { usados = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { usados = {}; }
const chaveCampo = (sel) => sel.dataset.buscaKey || sel.name || sel.id || '';
function marcarUso(sel, v) {
  const k = chaveCampo(sel); if (!k || !v) return;
  const m = usados[k] || (usados[k] = {}); m[v] = (m[v] || 0) + 1;
  try { localStorage.setItem(LS, JSON.stringify(usados)); } catch { /* sem storage: só nesta sessão */ }
}

let aberto = null;   // { sel, inp, lista, itens, idx, original }

function opcoes(sel) {
  const out = [];
  for (const o of sel.options) {
    if (o.disabled && o.value !== sel.value) continue;
    const g = o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label : '';
    out.push({ v: o.value, t: o.textContent.trim(), g, n: norm(`${g} ${o.textContent}`) });
  }
  return out;
}
const textoAtual = (sel) => { const o = sel.options[sel.selectedIndex]; return o && o.value !== '' ? o.textContent.trim() : ''; };
const placeholderDe = (sel) => { const o = [...sel.options].find(x => x.value === ''); return o ? o.textContent.trim() : 'Selecione…'; };

function filtrar(sel, termo) {
  const todas = opcoes(sel);
  const t = norm(termo).trim();
  if (!t) {
    const m = usados[chaveCampo(sel)] || {};
    const top = todas.filter(o => o.v && m[o.v]).sort((a, b) => m[b.v] - m[a.v]).slice(0, 5);
    return top.length ? [...top.map(o => ({ ...o, top: true })), { sep: true }, ...todas] : todas;
  }
  const pal = t.split(/\s+/);
  const ok = todas.filter(o => o.v !== '' && pal.every(p => o.n.includes(p)));
  // código que começa com o que foi digitado vem primeiro; depois nome que começa; depois o resto
  const peso = (o) => (norm(o.t).startsWith(t) ? 0 : norm(o.t).split(/[\s.\-–—]+/).some(w => w.startsWith(pal[0])) ? 1 : 2);
  return ok.map((o, i) => ({ o, i, p: peso(o) })).sort((a, b) => a.p - b.p || a.i - b.i).map(x => x.o);
}

function destacar(txt, termo) {
  const t = norm(termo).trim(); if (!t) return esc(txt);
  const n = norm(txt); let out = '', i = 0;
  const pal = t.split(/\s+/).filter(Boolean);
  const marcas = new Array(txt.length).fill(false);
  for (const p of pal) { let k = n.indexOf(p); while (k >= 0) { for (let j = k; j < k + p.length; j++) marcas[j] = true; k = n.indexOf(p, k + p.length); } }
  while (i < txt.length) {
    const m = marcas[i]; let j = i; while (j < txt.length && marcas[j] === m) j++;
    out += m ? `<mark>${esc(txt.slice(i, j))}</mark>` : esc(txt.slice(i, j)); i = j;
  }
  return out;
}

function desenhar() {
  const a = aberto; if (!a) return;
  const termo = a.inp.value === a.original ? '' : a.inp.value;
  a.itens = filtrar(a.sel, termo);
  const sel = a.itens.filter(x => !x.sep);
  if (a.idx >= sel.length) a.idx = sel.length - 1;
  if (a.idx < 0 && sel.length) a.idx = Math.max(0, sel.findIndex(x => x.v === a.sel.value && !termo));
  let k = -1;
  a.lista.innerHTML = a.itens.length ? a.itens.map((x) => {
    if (x.sep) return '<li class="sb-sep" role="separator">todas</li>';
    k++;
    return `<li role="option" data-k="${k}" class="${k === a.idx ? 'on' : ''}${x.v === a.sel.value ? ' atual' : ''}${x.v === '' ? ' vazio' : ''}" aria-selected="${k === a.idx}">${x.top ? '<span class="sb-top">★</span>' : ''}${x.g ? `<span class="sb-g">${esc(x.g)} · </span>` : ''}${destacar(x.t, termo)}</li>`;
  }).join('') : '<li class="sb-nada">Nada encontrado</li>';
  a.lista.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  posicionar();
}

function posicionar() {
  const a = aberto; if (!a) return;
  const r = a.inp.getBoundingClientRect(), h = Math.min(320, window.innerHeight * 0.45);
  const embaixo = window.innerHeight - r.bottom, emCima = r.top;
  a.lista.style.left = `${r.left}px`; a.lista.style.minWidth = `${Math.max(r.width, 260)}px`; a.lista.style.maxHeight = `${h}px`;
  if (embaixo < h + 8 && emCima > embaixo) { a.lista.style.top = ''; a.lista.style.bottom = `${window.innerHeight - r.top + 2}px`; }
  else { a.lista.style.bottom = ''; a.lista.style.top = `${r.bottom + 2}px`; }
}

function abrir(sel, inp) {
  if (aberto?.sel === sel) return;
  fechar(false);
  const lista = document.createElement('ul'); lista.className = 'sb-lista'; lista.setAttribute('role', 'listbox');
  document.body.appendChild(lista);
  aberto = { sel, inp, lista, itens: [], idx: -1, original: textoAtual(sel) };
  inp.setAttribute('aria-expanded', 'true');
  lista.addEventListener('mousedown', (e) => { e.preventDefault(); const li = e.target.closest('li[data-k]'); if (li) escolher(+li.dataset.k); });
  desenhar();
  inp.select();
}

function fechar(restaurar = true) {
  const a = aberto; if (!a) return;
  aberto = null;
  a.lista.remove(); a.inp.setAttribute('aria-expanded', 'false');
  if (restaurar) a.inp.value = textoAtual(a.sel);
}

function escolher(k) {
  const a = aberto; if (!a) return;
  const x = a.itens.filter(i => !i.sep)[k]; if (!x) return;
  const mudou = a.sel.value !== x.v;
  a.sel.value = x.v; marcarUso(a.sel, x.v);
  fechar(true);
  if (mudou) { a.sel.dispatchEvent(new Event('input', { bubbles: true })); a.sel.dispatchEvent(new Event('change', { bubbles: true })); }
}

export function aplicarBusca(sel) {
  if (!sel || sel.multiple || sel.dataset.nobusca != null || sel.dataset.busca === 'on') return;
  if (sel.options.length < MIN_OPCOES) return;
  sel.dataset.busca = 'on';
  const caixa = document.createElement('span'); caixa.className = 'sb';
  if (sel.style.width) caixa.style.width = sel.style.width;
  if (sel.style.maxWidth) caixa.style.maxWidth = sel.style.maxWidth;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'sb-in'; inp.autocomplete = 'off'; inp.spellcheck = false;
  inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-expanded', 'false');
  inp.placeholder = placeholderDe(sel); inp.value = textoAtual(sel); inp.disabled = sel.disabled;
  if (sel.title) inp.title = sel.title;
  caixa.appendChild(inp);
  sel.after(caixa);
  sel.classList.add('sb-nativo'); sel.tabIndex = -1;

  const sync = () => { if (aberto?.sel !== sel) inp.value = textoAtual(sel); inp.disabled = sel.disabled; inp.placeholder = placeholderDe(sel); };
  sel.addEventListener('change', sync);
  // valor trocado por código (sel.value = x / selectedIndex) sem disparar "change": o campo acompanha
  for (const prop of ['value', 'selectedIndex']) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    if (d?.set) Object.defineProperty(sel, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); } });
  }
  sel.addEventListener('focus', () => inp.focus());   // clique no rótulo / validação do formulário
  sel.addEventListener('invalid', () => inp.classList.add('sb-inv'));
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

  inp.addEventListener('focus', () => { sync(); });
  inp.addEventListener('mousedown', () => { if (document.activeElement === inp) abrir(sel, inp); });
  inp.addEventListener('click', () => abrir(sel, inp));
  inp.addEventListener('input', () => { inp.classList.remove('sb-inv'); if (!aberto || aberto.sel !== sel) abrir(sel, inp); aberto.idx = 0; desenhar(); });
  inp.addEventListener('keydown', (e) => {
    const a = aberto?.sel === sel ? aberto : null;
    const n = a ? a.itens.filter(i => !i.sep).length : 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!a) { abrir(sel, inp); return; }
      a.idx = Math.max(0, Math.min(n - 1, a.idx + (e.key === 'ArrowDown' ? 1 : -1))); desenhar();
    } else if (e.key === 'Enter') {
      if (a) { e.preventDefault(); if (n) escolher(Math.max(0, a.idx)); }
    } else if (e.key === 'Escape') {
      if (a) { e.preventDefault(); e.stopPropagation(); fechar(true); }
    } else if (e.key === 'Tab') {
      if (a && inp.value !== a.original && n) escolher(Math.max(0, a.idx)); else fechar(true);
    }
  });
  inp.addEventListener('blur', () => { setTimeout(() => { if (aberto?.sel === sel && document.activeElement !== inp) fechar(true); }, 0); });
}

/** liga a busca em toda a página: selects que já existem e os que forem aparecendo (telas, modais) */
let ligado = false;
export function iniciarSelectBusca(raiz = document.body) {
  if (ligado) return; ligado = true;
  const varrer = (el) => { if (el.tagName === 'SELECT') aplicarBusca(el); else el.querySelectorAll?.('select:not([data-busca])').forEach(aplicarBusca); };
  varrer(raiz);
  let pend = new Set(), agendado = false;
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) pend.add(n);
    // select que recebeu opções depois de criado
    for (const m of ms) if (m.target?.tagName === 'SELECT') pend.add(m.target);
    if (!agendado) { agendado = true; requestAnimationFrame(() => { agendado = false; const p = pend; pend = new Set(); for (const n of p) if (n.isConnected) varrer(n); }); }
  }).observe(raiz, { childList: true, subtree: true });
  window.addEventListener('resize', () => posicionar());
  document.addEventListener('scroll', (e) => { if (aberto && !aberto.lista.contains(e.target)) posicionar(); }, true);
}

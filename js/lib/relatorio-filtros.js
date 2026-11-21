// Padrão de relatórios, fase 1 (21/11/2026): os filtros escolhidos na tela saem impressos no relatório e ficam guardados
// para repetir. Em vez de cada tela declarar os seus filtros, este módulo LÊ os controles da barra de filtros da tela
// (seletores, datas, buscas, caixas de marcar e as fichas/abas ligadas) — serve para todas as telas de uma vez.
//  - capturarFiltros(): { parametros: [[rótulo, valor]] (como sai impresso), estado: { c: [...] } (para repetir) }
//  - aplicarFiltros(estado): recoloca os filtros na tela (botão Repetir e variantes)
// Parte pura (testável sem navegador): rotuloLimpo, valorImpresso, textoFicha, assinatura.

/** rótulo do controle: tira dois-pontos, asterisco e espaços a mais */
export const rotuloLimpo = (t) => String(t || '').replace(/\s+/g, ' ').replace(/[:*]\s*$/, '').trim();
/** texto da ficha (chip) sem o contador: "Pendências das notas · 3" → "Pendências das notas" */
export const textoFicha = (t) => rotuloLimpo(String(t || '').replace(/\s[·•(]\s*\d[\d.,]*\)?\s*$/, ''));
/** valor como sai impresso: data em dd/mm/aaaa, mês em mm/aaaa, vazio fica vazio (vira "Todos" no relatório) */
export function valorImpresso(tipo, v) {
  v = String(v ?? '').trim(); if (!v) return '';
  let m;
  if (tipo === 'date' && (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v))) return `${m[3]}/${m[2]}/${m[1]}`;
  if (tipo === 'month' && (m = /^(\d{4})-(\d{2})$/.exec(v))) return `${m[2]}/${m[1]}`;
  if (tipo === 'datetime-local' && (m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(v))) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}`;
  return v;
}
/** assinatura do estado (para saber se os filtros ainda são os da variante aplicada) */
export const assinatura = (estado) => JSON.stringify((estado?.c || []).map(x => [x.k, x.v]));

const RAIZ = '#page';
const visivel = (el) => !!(el.offsetParent || el.getClientRects().length) && !el.closest('[hidden]');
const TIPOS = ['date', 'month', 'text', 'search', 'number', 'checkbox', 'datetime-local', 'time', ''];

/** controles de filtro da tela, na ordem em que aparecem */
function controles(root) {
  const todos = [...root.querySelectorAll('select, input, .chips')].filter(el => !el.closest('.modal-back') && !el.closest('table') && visivel(el)
    && (el.tagName !== 'INPUT' || TIPOS.includes(el.getAttribute('type') || '')) && !(el.tagName === 'INPUT' && el.closest('label')?.querySelector('select')) && !el.readOnly && !el.dataset.semFiltro && !(el.classList.contains('chips') && !el.querySelector('.chip')));
  const naBarra = todos.filter(el => el.closest('.toolbar, [data-filtros]'));   // data-filtros: bloco de filtros fora da barra
  return naBarra.length ? naBarra : todos.filter(el => !el.closest('form') && !el.closest('.grid-form')).slice(0, 12);
}
function rotuloDe(el, n) {
  if (el.classList.contains('chips')) return el.dataset.rotulo || el.getAttribute('aria-label') || (n.fichas++ ? `Visão ${n.fichas}` : 'Visão');
  const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
  let t = '';
  if (lab) t = [...lab.childNodes].filter(x => x.nodeType === 3 || (x.nodeType === 1 && !/^(SELECT|INPUT|DATALIST|TEXTAREA|BUTTON)$/.test(x.tagName))).map(x => x.textContent).join(' ');
  t = rotuloLimpo(t) || rotuloLimpo(el.getAttribute('aria-label') || el.title);
  if (!t && el.tagName === 'SELECT') t = rotuloLimpo(el.options[0]?.value === '' ? el.options[0].textContent.replace(/^tod[oa]s?( (os|as))?\s*/i, '') : '') || 'Seleção';
  if (!t) t = el.placeholder ? `Busca (${rotuloLimpo(el.placeholder).toLowerCase()})` : 'Filtro';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const chaveDe = (el, i) => el.id ? '#' + el.id : `${el.classList.contains('chips') ? 'chips' : el.tagName.toLowerCase()}:${i}`;
function fichaLigada(el) { const on = el.querySelector('.chip.on, .chip.active'); if (!on) return null; const d = Object.entries(on.dataset)[0]; return { on, d: d ? [d[0], d[1]] : null, texto: textoFicha(on.textContent) }; }

/** lê os filtros da tela aberta */
export function capturarFiltros(root = document.querySelector(RAIZ)) {
  const parametros = [], c = [];
  const ano = document.querySelector('#ano-global');
  if (ano && visivel(ano)) { parametros.push(['Ano de trabalho', ano.value]); c.push({ k: '#ano-global', t: 's', v: ano.value }); }
  if (!root) return { parametros, estado: { c } };
  const n = { fichas: 0 }; const vistos = new Map();
  controles(root).forEach((el, i) => {
    let r = rotuloDe(el, n), v, item;
    if (el.classList.contains('chips')) { const f = fichaLigada(el); if (!f) return; v = f.texto; item = { k: chaveDe(el, i), t: 'f', v: f.d ? f.d[1] : f.texto, a: f.d ? f.d[0] : null }; }
    else if (el.tagName === 'SELECT') { const o = el.selectedOptions[0]; v = el.value === '' ? '' : rotuloLimpo(o?.textContent || el.value); item = { k: chaveDe(el, i), t: 's', v: el.value }; }
    else if (el.type === 'checkbox') { v = el.checked ? 'Sim' : 'Não'; item = { k: chaveDe(el, i), t: 'x', v: el.checked }; }
    else { v = valorImpresso(el.type, el.value); item = { k: chaveDe(el, i), t: 'i', v: el.value }; }
    const rep = vistos.get(r) || 0; vistos.set(r, rep + 1); if (rep) r = `${r} (${rep + 1})`;
    parametros.push([r, v]); c.push(item);
  });
  return { parametros, estado: { c } };
}

const espera = (ms) => new Promise(r => setTimeout(r, ms));
async function assentar(root, max = 6000) { const t0 = Date.now(); await espera(250); while (document.querySelector(`${RAIZ} .loading`) && Date.now() - t0 < max) await espera(120); await espera(120); }
function achar(root, k) {
  if (k.startsWith('#')) return document.querySelector(`#${CSS.escape(k.slice(1))}`);
  const [, i] = k.split(':'); return controles(root)[+i] || null;
}

/** recoloca os filtros na tela (um por vez, esperando a tela recarregar); devolve { aplicados, faltaram } */
export async function aplicarFiltros(estado, { root = () => document.querySelector(RAIZ) } = {}) {
  let aplicados = 0; const faltaram = [];
  await assentar(root());
  for (const x of estado?.c || []) {
    const el = achar(root(), x.k);
    if (!el) { faltaram.push(x.k); continue; }
    try {
      if (x.t === 'f') {
        const alvo = [...el.querySelectorAll('.chip')].find(ch => x.a ? ch.dataset[x.a] === String(x.v) : textoFicha(ch.textContent) === x.v);
        if (!alvo) { faltaram.push(x.k); continue; }
        if (!alvo.classList.contains('on') && !alvo.classList.contains('active')) { alvo.click(); await assentar(root()); }
      } else if (x.t === 'x') { if (el.checked !== !!x.v) { el.click(); await assentar(root()); } }
      else if (String(el.value) !== String(x.v ?? '')) {
        if (x.t === 's' && ![...el.options].some(o => o.value === String(x.v ?? ''))) { faltaram.push(x.k); continue; }
        el.value = x.v ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        await assentar(root());
      }
      aplicados++;
    } catch { faltaram.push(x.k); }
  }
  return { aplicados, faltaram };
}

// ---------------------------------------------------------------- variante aplicada e repetição pendente
let variante = null;   // { rota, nome, ass }
export const marcarVariante = (rota, nome, estado) => { variante = nome ? { rota, nome, ass: assinatura(estado) } : null; };
/** nome da variante em uso, se os filtros da tela ainda forem os dela */
export const varianteEmUso = (rota, estado) => (variante && variante.rota === rota && variante.ass === assinatura(estado) ? variante.nome : '');

const PEND = 'relp-repetir';
export function pedirRepeticao(rota, estado, { nome = '', rotulo = '' } = {}) { sessionStorage.setItem(PEND, JSON.stringify({ rota, estado, nome, rotulo, em: Date.now() })); }
/** chamado pelo roteador ao abrir a tela: aplica os filtros pedidos em "Repetir" ou numa variante */
export async function aplicarPendente(rota, avisar) {
  let p = null; try { p = JSON.parse(sessionStorage.getItem(PEND) || 'null'); } catch { /* ignora */ }
  if (!p || p.rota !== rota || Date.now() - p.em > 60000) return null;
  sessionStorage.removeItem(PEND);
  const r = await aplicarFiltros(p.estado);
  if (p.nome) marcarVariante(rota, p.nome, capturarFiltros().estado);
  avisar?.(r.faltaram.length ? `${p.rotulo || 'Filtros'}: ${r.aplicados} filtro(s) aplicado(s); ${r.faltaram.length} não existe(m) mais nesta tela. Confira antes de emitir.`
    : `${p.rotulo || 'Filtros aplicados'}. Confira e clique no botão do relatório para emitir.`, !!r.faltaram.length);
  return r;
}

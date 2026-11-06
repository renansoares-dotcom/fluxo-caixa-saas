// Menu lateral (05/11/2026, padrão em docs/design-system.md › 3): ícone por área, código de cada tela,
// busca no menu (nome ou código), Favoritos (estrela), Recentes (últimas 5) e modo recolhido (só ícones,
// abre por cima ao passar o mouse). O acordeão de áreas e grupos continua em app.js.
// 06/11/2026: no computador (> 900 px) as áreas ficam paradas e cada uma abre num painel ao lado, por cima da tela,
// sem empurrar os itens de baixo (decisão do Renan, opção B). No celular continua o acordeão.
// Favoritos e Recentes ficam fora do #nav (data-r, não data-route) para não confundir as rotinas que leem o menu.
import { state } from './data.js';
import { $, $$, esc } from './ui.js';
import { codigoDa, rotaDoCodigo } from './telas.js';

const SVG = (d) => `<svg class="nav-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONES = {
  conv: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l2-5.5A8.4 8.4 0 1 1 21 11.5z"/>',
  pain: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  fin: '<rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19"/><path d="M16 15h2"/>',
  com: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  cmp: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h3l2.4 12h11l2-8H6.6"/>',
  prd: '<path d="M3 21V10l6 4V10l6 4V6l6 4v11z"/><path d="M7 18h2M12 18h2M17 18h2"/>',
  log: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  rh: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><path d="M16 4.6a3.2 3.2 0 0 1 0 6.2M18 15c1.8.6 3 2.2 3.4 5"/>',
  cpd: '<path d="M6 2.5h9l4 4V21.5H6z"/><path d="M15 2.5v4h4"/><path d="M9 12h7M9 16h7"/>',
  cont: '<rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M8 7h8"/><path d="M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0"/>',
  cad: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/><path d="M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 3.7"/><path d="M12 17.3h0"/>',
};
const ESTRELA = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2 6.6 20.1l1-6.1L3.2 9.7l6.1-.9z"/></svg>';
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const chave = (k) => `nav-${k}:${state.user?.id || 'anon'}`;
const ler = (k) => { try { return JSON.parse(localStorage.getItem(chave(k)) || '[]'); } catch { return []; } };
const gravar = (k, v) => { try { localStorage.setItem(chave(k), JSON.stringify(v)); } catch { /* sem armazenamento */ } };

const ancora = (rota) => $(`#nav a[data-route="${CSS.escape(rota)}"]`);
const nomeDa = (a) => a?.dataset.nome || a?.textContent.trim() || '';
// a tela está liberada para quem usa (mesmas regras do menu: área, papel, itens escondidos)
function visivel(rota) {
  const a = ancora(rota); if (!a || a.hidden) return false;
  const area = a.closest('.nav-area'); if (area?.hidden) return false;
  if (state.papel === 'compras' && !a.classList.contains('nav-compras')) return false;
  if (state.papel === 'vendas' && !a.classList.contains('nav-vendas')) return false;
  if (state.papel === 'producao' && !a.classList.contains('nav-producao')) return false;
  return true;
}

let montado = false;
/** prepara o menu uma vez (ícones, códigos, estrelas, ferramentas do topo) */
export function montarMenu() {
  if (montado) return; montado = true;
  const nav = $('#nav'); if (!nav) return;
  // ícone por área; o nome da área vai num span (a trilha lê data-nome)
  $$('.nav-area', nav).forEach(ar => {
    const t = $('.nav-area-tit', ar); if (!t) return;
    const txt = [...t.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    const nome = txt ? txt.textContent.trim() : t.textContent.trim();
    t.dataset.nome = nome;
    if (txt) { const s = document.createElement('span'); s.className = 'nav-txt'; s.textContent = nome; txt.replaceWith(s); }
    t.insertAdjacentHTML('afterbegin', SVG(ICONES[ar.dataset.area] || ICONES.cad));
    t.title = nome;
  });
  // código e estrela em cada tela
  $$('a[data-route]', nav).forEach(a => {
    const nome = a.firstChild?.nodeType === 3 ? a.firstChild.textContent.trim() : a.textContent.trim();
    a.dataset.nome = nome;
    const cod = codigoDa(a.dataset.route);
    if (a.firstChild?.nodeType === 3) { const s = document.createElement('span'); s.className = 'nav-nome'; s.textContent = a.firstChild.textContent.trim(); a.firstChild.replaceWith(s); }
    if (cod) a.insertAdjacentHTML('beforeend', `<span class="nav-cod">${cod}</span>`);
    a.insertAdjacentHTML('beforeend', `<button type="button" class="nav-fav" title="Favoritar" aria-label="Favoritar ${esc(nome)}">${ESTRELA}</button>`);
    a.title = cod ? `${cod} · ${nome}` : nome;
  });
  nav.addEventListener('click', (e) => { const b = e.target.closest('.nav-fav'); if (!b) return; e.preventDefault(); e.stopPropagation(); alternarFavorito(b.closest('a').dataset.route); });

  // topo: recolher + busca + favoritos + recentes
  const brand = $('#sidebar .brand-logo');
  brand?.insertAdjacentHTML('beforeend', `<button type="button" class="btn ghost icon nav-recolher" id="nav-recolher" title="Recolher o menu" aria-label="Recolher o menu">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg></button>`);
  nav.insertAdjacentHTML('beforebegin', `<div class="nav-topo">
    <label class="nav-busca"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="nav-filtro" type="search" placeholder="Procurar tela ou código" autocomplete="off" aria-label="Procurar tela no menu"></label>
    <div class="nav-atalhos" id="nav-atalhos"></div></div>`);
  $('#nav-recolher').onclick = (e) => { recolher(!document.body.classList.contains('nav-recolhido')); e.currentTarget.blur(); };
  try { if (localStorage.getItem('nav-recolhido') === '1') document.body.classList.add('nav-recolhido'); } catch { /* */ }

  const inp = $('#nav-filtro');
  inp.addEventListener('input', () => filtrar(inp.value));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { inp.value = ''; filtrar(''); inp.blur(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = rotaDoCodigo(inp.value) || $('#nav a.achou')?.dataset.route;
      if (r && visivel(r)) { inp.value = ''; filtrar(''); location.hash = '#/' + r; }
    }
  });
  $('#nav-atalhos').addEventListener('click', (e) => { const b = e.target.closest('.nav-fav'); if (b) { e.preventDefault(); alternarFavorito(b.dataset.r); } });
  montarPainel(nav);
}

// ---------------------------------------------------------------------------------------------
// Painel lateral das áreas (computador)
// ---------------------------------------------------------------------------------------------
const MQ = typeof matchMedia === 'function' ? matchMedia('(min-width:901px)') : { matches: false, addEventListener() {} };
export const modoPainel = () => document.body.classList.contains('nav-modo-painel');
let aberta = null;

function montarPainel(nav) {
  // o conteúdo de cada área vai para um "corpo", que no computador vira o painel flutuante
  $$('.nav-area', nav).forEach(ar => {
    const tit = $('.nav-area-tit', ar); if (!tit) return;
    const corpo = document.createElement('div'); corpo.className = 'nav-corpo'; corpo.setAttribute('role', 'menu');
    corpo.innerHTML = `<div class="nav-corpo-tit">${esc(tit.dataset.nome || '')}</div>`;
    [...ar.children].filter(c => c !== tit).forEach(c => corpo.appendChild(c));
    ar.appendChild(corpo);
    tit.setAttribute('aria-haspopup', 'menu'); tit.setAttribute('aria-expanded', 'false');
    // com um painel aberto, passar o mouse em outra área troca o painel (como numa barra de menus)
    tit.addEventListener('mouseenter', () => { if (aberta && aberta !== ar && modoPainel() && !nav.classList.contains('nav-filtrando')) abrirPainel(ar); });
  });
  // no painel os grupos ficam todos abertos e o título do grupo é só um rótulo
  nav.addEventListener('click', (e) => { const s = e.target.closest('summary'); if (s && modoPainel() && !nav.classList.contains('nav-filtrando')) e.preventDefault(); }, true);
  document.addEventListener('mousedown', (e) => { if (aberta && !aberta.contains(e.target)) fecharPainel(); });
  document.addEventListener('keydown', (e) => {
    if (!aberta) return;
    const corpo = $('.nav-corpo', aberta);
    if (e.key === 'Escape') { e.preventDefault(); const t = $('.nav-area-tit', aberta); fecharPainel(); t?.focus(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && corpo.contains(document.activeElement)) {
      e.preventDefault();
      const ls = $$('a[data-route]', corpo).filter(a => a.offsetParent); const i = ls.indexOf(document.activeElement);
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? ls.length - 1 : e.key === 'ArrowDown' ? Math.min(ls.length - 1, i + 1) : Math.max(0, i - 1);
      ls[j]?.focus();
    }
    if (e.key === 'ArrowLeft' && corpo.contains(document.activeElement)) { e.preventDefault(); const t = $('.nav-area-tit', aberta); fecharPainel(); t?.focus(); }
  });
  $('#sidebar')?.addEventListener('scroll', () => { if (aberta) posicionar(aberta); }, { passive: true });
  addEventListener('resize', () => { if (aberta) posicionar(aberta); });
  const aplicar = () => {
    fecharPainel();
    document.body.classList.toggle('nav-modo-painel', MQ.matches);
    if (MQ.matches) { $$('.nav-area', nav).forEach(a => a.classList.remove('aberta')); $$('details', nav).forEach(d => { d.open = true; }); }
    else { const at = $('a.active', nav)?.closest('details'); $$('details', nav).forEach(d => { d.open = d === at; }); }
  };
  MQ.addEventListener('change', aplicar); aplicar();
}

/** clique (ou Enter) no título de uma área; devolve true quando o painel tratou */
export function cliqueArea(ar, peloTeclado = false) {
  if (!modoPainel() || $('#nav').classList.contains('nav-filtrando')) return false;
  if (aberta === ar) fecharPainel(); else abrirPainel(ar, peloTeclado);
  return true;
}

function abrirPainel(ar, focar = false) {
  if (aberta && aberta !== ar) fecharPainel();
  aberta = ar; ar.classList.add('painel');
  $('.nav-area-tit', ar)?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('nav-painel-aberto');
  const corpo = $('.nav-corpo', ar);
  const n = $$('a[data-route]', corpo).filter(a => !a.hidden && getComputedStyle(a).display !== 'none').length;
  corpo.classList.toggle('duas-col', n > 9);
  posicionar(ar);
  if (focar) ($('a[data-route].active', corpo) || $$('a[data-route]', corpo).find(a => a.offsetParent))?.focus();
}

function posicionar(ar) {
  const corpo = $('.nav-corpo', ar), tit = $('.nav-area-tit', ar), sb = $('#sidebar');
  const rt = tit.getBoundingClientRect(), rs = sb.getBoundingClientRect();
  corpo.style.left = Math.round(rs.right + 6) + 'px';
  corpo.style.maxHeight = (innerHeight - 16) + 'px';
  const h = corpo.offsetHeight;
  corpo.style.top = Math.round(Math.max(8, Math.min(rt.top - 10, innerHeight - h - 8))) + 'px';
}

export function fecharPainel() {
  if (!aberta) return;
  aberta.classList.remove('painel'); $('.nav-area-tit', aberta)?.setAttribute('aria-expanded', 'false');
  aberta = null; document.body.classList.remove('nav-painel-aberto');
}

function recolher(on) {
  document.body.classList.toggle('nav-recolhido', on);
  try { localStorage.setItem('nav-recolhido', on ? '1' : '0'); } catch { /* */ }
  const b = $('#nav-recolher'); if (b) { b.title = on ? 'Fixar o menu aberto' : 'Recolher o menu'; b.setAttribute('aria-label', b.title); }
}

function filtrar(txt) {
  const nav = $('#nav'); const t = norm(txt.trim());
  const porCod = rotaDoCodigo(txt);
  nav.classList.toggle('nav-filtrando', !!t);
  $$('a[data-route]', nav).forEach(a => {
    const ok = !!t && visivel(a.dataset.route) && (norm(nomeDa(a)).includes(t) || norm(codigoDa(a.dataset.route)).includes(t.replace(/\s|-/g, '')) || a.dataset.route === porCod);
    a.classList.toggle('achou', ok);
  });
  $$('.nav-area', nav).forEach(ar => ar.classList.toggle('tem-achado', !!$('a.achou', ar)));
  $$('details', nav).forEach(d => { const tem = !!$('a.achou', d); d.classList.toggle('tem-achado', tem); if (t && tem) d.open = true; });
  if (t) fecharPainel();
  if (!t) { const at = $('a.active', nav)?.closest('details'); $$('details', nav).forEach(d => { d.open = modoPainel() || d === at; }); }
  let vazio = $('#nav-nada');
  if (t && !$('a.achou', nav)) { if (!vazio) nav.insertAdjacentHTML('afterbegin', '<div id="nav-nada" class="small muted" style="padding:8px 10px">Nenhuma tela encontrada.</div>'); }
  else vazio?.remove();
}

function alternarFavorito(rota) {
  const f = ler('fav'); const i = f.indexOf(rota);
  if (i >= 0) f.splice(i, 1); else f.push(rota);
  gravar('fav', f); atalhos();
}

/** registra a tela aberta nos Recentes e atualiza a marcação de favoritas */
export function marcarTela(rota) {
  if (rota && ancora(rota)) { const r = ler('rec').filter(x => x !== rota); r.unshift(rota); gravar('rec', r.slice(0, 8)); }
  atalhos(rota);
}

function atalhos(atual = location.hash.replace(/^#\//, '').split('?')[0]) {
  const box = $('#nav-atalhos'); if (!box) return;
  const fav = ler('fav').filter(visivel);
  const rec = ler('rec').filter(r => visivel(r) && !fav.includes(r) && r !== atual).slice(0, 5);
  $$('#nav a[data-route]').forEach(a => a.classList.toggle('favorita', fav.includes(a.dataset.route)));
  const item = (r, f) => { const a = ancora(r), cod = codigoDa(r);
    return `<a href="#/${esc(r)}" data-r="${esc(r)}" class="${r === atual ? 'active' : ''}" title="${esc(cod ? cod + ' · ' : '')}${esc(nomeDa(a))}"><span class="nav-nome">${esc(nomeDa(a))}</span>${cod ? `<span class="nav-cod">${cod}</span>` : ''}${f ? `<button type="button" class="nav-fav on" data-r="${esc(r)}" title="Tirar dos favoritos" aria-label="Tirar dos favoritos">${ESTRELA}</button>` : ''}</a>`; };
  box.innerHTML = (fav.length ? `<div class="nav-grupo-tit">Favoritos</div>${fav.map(r => item(r, true)).join('')}` : '')
    + (rec.length ? `<div class="nav-grupo-tit">Recentes</div>${rec.map(r => item(r, false)).join('')}` : '');
}

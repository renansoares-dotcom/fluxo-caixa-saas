// Ajuda › Tutoriais: manuais de uso de cada funcionalidade (texto em tutoriais/<id>.md, PDF em tutoriais/pdf/<id>.pdf).
// #/tutoriais lista os manuais; #/tutoriais?m=<id> abre um. O botão "?" do topo de cada tela abre o manual dela.
import { state, temRH } from '../lib/data.js';
import { $, esc, toast, logoPNG } from '../lib/ui.js';
import { MANUAIS, manualPorId } from '../lib/tutoriais.js';
import { lerManual, mdParaHtml } from '../lib/markdown.js';
import { htmlManual, dataBR } from '../lib/manual-html.js';

export const title = 'Tutoriais';
const V = Date.now();
const base = new URL('../../tutoriais/', import.meta.url).href;
const cache = {};
async function texto(id) {
  if (cache[id]) return cache[id];
  const r = await fetch(`${base}${id}.md?v=${V}`); if (!r.ok) throw new Error('Manual não encontrado');
  return (cache[id] = await r.text());
}
const visiveis = () => MANUAIS.filter(m => !m.rh || temRH());

export async function render(root) {
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('m');
  const m = id && manualPorId(id);
  if (m && (!m.rh || temRH())) return abrir(root, m);
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Tutoriais</h2><div class="muted small">Manual de uso de cada funcionalidade da plataforma, para quem usa no dia a dia. Em cada tela, o botão <b>?</b> no topo abre o manual dela.</div></div></div>
    <div class="tut-lista" id="tut-lista"><div class="loading">Carregando…</div></div>`;
  const lista = visiveis();
  const dados = await Promise.all(lista.map(x => texto(x.id).then(t => lerManual(t).dados).catch(() => ({}))));
  const card = (x, d) => `<div class="card tut-card" data-txt="${esc((x.titulo + ' ' + x.resumo + ' ' + x.area).toLowerCase())}"><a class="tut-tit" href="#/tutoriais?m=${x.id}">${esc(x.titulo)}</a><p class="small muted">${esc(x.resumo)}</p>
        <div class="small muted">versão ${esc(d.versao || '1.0')} · atualizado em ${dataBR(d.atualizado) || '–'}</div>
        <div class="tut-acoes"><a class="btn small primary" href="#/tutoriais?m=${x.id}">Abrir</a><a class="btn small" href="${base}pdf/${x.id}.pdf?v=${V}" target="_blank" rel="noopener">PDF</a></div></div>`;
  const areas = [...new Set(lista.map(x => x.area))];
  $('#tut-lista', root).innerHTML = lista.length ? `<div class="toolbar card"><input id="tut-busca" placeholder="Procurar um assunto (ex.: borderô, conciliação, folha)" style="min-width:320px"><span class="muted small">${lista.length} manuais</span></div>
    ${areas.map(a => `<section class="tut-sec"><h3 class="tut-sec-tit">${esc(a)}</h3><div class="tut-grade">${lista.map((x, i) => [x, dados[i]]).filter(([x]) => x.area === a).map(([x, d]) => card(x, d)).join('')}</div></section>`).join('')}`
    : '<div class="card"><div class="empty">Nenhum manual disponível.</div></div>';
  const bz = $('#tut-busca', root);
  if (bz) bz.oninput = () => { const t = bz.value.trim().toLowerCase();
    root.querySelectorAll('.tut-card').forEach(c => { c.hidden = !!t && !c.dataset.txt.includes(t); });
    root.querySelectorAll('.tut-sec').forEach(sc => { sc.hidden = ![...sc.querySelectorAll('.tut-card')].some(c => !c.hidden); }); };
}

async function abrir(root, m) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  let md; try { md = await texto(m.id); } catch (e) { root.innerHTML = `<div class="card"><div class="empty">${esc(e.message)}</div></div>`; return; }
  const { dados, corpo } = lerManual(md);
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Manual — ${esc(dados.titulo || m.titulo)}</h2>
      <div class="muted small">${esc(dados.tela || m.area)} · versão ${esc(dados.versao || '1.0')} · atualizado em ${dataBR(dados.atualizado)}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost" href="#/tutoriais">← Todos os tutoriais</a>${m.rotas[0] ? `<a class="btn ghost" href="#/${m.rotas[0]}">Ir para a tela</a>` : ''}
        <a class="btn" href="${base}pdf/${m.id}.pdf?v=${V}" target="_blank" rel="noopener">Baixar PDF</a><button class="btn primary" id="tut-imp">Imprimir</button></div></div>
    <div class="card manual-tela"><div class="manual-corpo">${mdParaHtml(corpo, { img: (c) => base + c + '?v=' + V })}</div></div>`;
  $('#tut-imp', root).onclick = async () => {
    const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
    const logo = await logoPNG().catch(() => null);
    w.document.write(htmlManual(m, md, logo, { auto: true, barra: true, img: (c) => base + c + '?v=' + V })); w.document.close();
  };
}

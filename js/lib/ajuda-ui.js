// Ajuda na tela (melhoria 10.5): o botão "?" abre, ao lado da tela, o trecho do manual dela (com as figuras), as outras seções,
// os vídeos curtos cadastrados para a tela e o tour; e o tour de boas-vindas para quem entra pela primeira vez.
import { sb, state, q, isAdmin, temRH } from './data.js';
import { $, $$, esc, toast, fail, modal } from './ui.js';
import { manualDaRota } from './tutoriais.js';
import { lerManual, mdParaHtml } from './markdown.js';
import { codigoDa } from './telas.js';
import { secoes, trecho, secaoDaTela, passosVisiveis, videoEmbed } from './ajuda.js';

const V = Date.now();
const base = new URL('../../tutoriais/', import.meta.url).href;
const cache = {};
const texto = async (id) => cache[id] || (cache[id] = await fetch(`${base}${id}.md?v=${V}`).then(r => { if (!r.ok) throw new Error('Manual não encontrado'); return r.text(); }));
const img = (c) => base + c + '?v=' + V;

function painel() {
  let p = $('#ajuda-painel');
  if (!p) {
    p = document.createElement('aside'); p.id = 'ajuda-painel'; p.className = 'ajuda-painel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Ajuda desta tela');
    document.body.appendChild(p);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && p.classList.contains('aberto')) fecharAjuda(); });
  }
  return p;
}
export const fecharAjuda = () => $('#ajuda-painel')?.classList.remove('aberto');

export async function abrirAjuda(rota) {
  const m = manualDaRota(rota), p = painel();
  if (!m || (m.rh && !temRH())) return;
  p.innerHTML = '<div class="loading">Carregando…</div>'; p.classList.add('aberto');
  let corpo, dados;
  try { ({ corpo, dados } = lerManual(await texto(m.id))); } catch (err) { p.innerHTML = `<div class="ajuda-topo"><b>Ajuda</b><button class="btn ghost icon" data-fecha>✕</button></div><div class="empty">${esc(err.message)}</div>`; p.querySelector('[data-fecha]').onclick = fecharAjuda; return; }
  const nome = $(`#nav a[data-route="${CSS.escape(rota)}"]`)?.dataset.nome || $('#page-title')?.textContent || '';
  const S = secoes(corpo).filter(s => !/hist[oó]rico de altera/i.test(s.texto));
  const atual = secaoDaTela(corpo, { titulo: nome, codigo: codigoDa(rota), prefixo: m.secoes?.[rota] || null });
  let V2 = []; try { V2 = await q(sb.from('ajuda_videos').select('*').eq('empresa_id', state.empresa.id).eq('rota', rota).order('ordem').order('criado_em')); } catch { V2 = null; }
  const mostra = (sec) => {
    p.querySelector('.ajuda-corpo').innerHTML = `<div class="manual-corpo">${mdParaHtml(trecho(corpo, sec), { img })}</div>`;
    p.querySelector('#aj-sec').value = String(sec.linha);
    p.querySelector('.ajuda-corpo').scrollTop = 0;
  };
  p.innerHTML = `<div class="ajuda-topo"><div><b>Ajuda — ${esc(nome)}</b><div class="small muted">${esc(dados.titulo || m.titulo)} · versão ${esc(dados.versao || '1.0')}</div></div><button class="btn ghost icon" data-fecha aria-label="Fechar">✕</button></div>
    <div class="ajuda-barra"><select id="aj-sec" aria-label="Seção do manual">${S.map(s => `<option value="${s.linha}">${s.nivel === 3 ? '   ' : ''}${esc(s.texto)}</option>`).join('')}</select></div>
    ${V2 && V2.length ? `<div class="ajuda-videos">${V2.map((v, i) => `<button class="btn small" data-vid="${i}">▶ ${esc(v.titulo)}</button>`).join(' ')}</div><div id="aj-player"></div>` : ''}
    <div class="ajuda-corpo"></div>
    <div class="ajuda-pe"><a class="btn small" href="#/tutoriais?m=${m.id}">Manual completo</a><a class="btn small" href="${base}pdf/${m.id}.pdf?v=${V}" target="_blank" rel="noopener">PDF</a>
      <button class="btn small" id="aj-tour">Tour da plataforma</button>${isAdmin() && V2 ? '<button class="btn small ghost" id="aj-vnovo">+ vídeo desta tela</button><button class="btn small ghost" id="aj-cfg">Configurar o tour</button>' : ''}</div>`;
  p.querySelector('[data-fecha]').onclick = fecharAjuda;
  p.querySelector('#aj-sec').onchange = (e) => mostra(S.find(s => String(s.linha) === e.target.value));
  p.querySelector('.ajuda-pe').addEventListener('click', (e) => { if (e.target.closest('a[href^="#/"]')) fecharAjuda(); });
  p.querySelector('#aj-tour').onclick = () => { fecharAjuda(); iniciarTour(true); };
  $$('[data-vid]', p).forEach(b => b.onclick = () => {
    const v = V2[+b.dataset.vid], e = videoEmbed(v.url), pl = p.querySelector('#aj-player');
    if (!e) return toast('Link de vídeo inválido', true);
    if (e.tipo === 'link') { window.open(e.src, '_blank', 'noopener'); return; }
    pl.innerHTML = `<div class="ajuda-video"><iframe src="${esc(e.src)}" title="${esc(v.titulo)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>
      ${isAdmin() ? `<button class="btn small ghost" data-vdel="${v.id}">Excluir este vídeo</button>` : ''}`;
    pl.querySelector('[data-vdel]') && (pl.querySelector('[data-vdel]').onclick = async () => { if (!confirm('Excluir o vídeo desta tela?')) return; try { await q(sb.from('ajuda_videos').delete().eq('id', v.id)); abrirAjuda(rota); } catch (err) { fail(err); } });
  });
  p.querySelector('#aj-vnovo') && (p.querySelector('#aj-vnovo').onclick = async () => {
    const titulo = prompt('Título do vídeo (ex.: Como lançar uma conta)'); if (!titulo) return;
    const url = prompt('Link do vídeo (YouTube ou Google Drive, começando com https://)'); if (!url) return;
    if (!videoEmbed(url)) return toast('Use um link https:// do YouTube ou do Google Drive', true);
    try { await q(sb.from('ajuda_videos').insert({ empresa_id: state.empresa.id, rota, titulo: titulo.trim(), url: url.trim(), ordem: (V2.length + 1) * 10 })); toast('Vídeo cadastrado'); abrirAjuda(rota); } catch (err) { fail(err); }
  });
  p.querySelector('#aj-cfg') && (p.querySelector('#aj-cfg').onclick = () => configurarTour());
  mostra(atual || S[0]);
}

async function configurarTour() {
  let c; try { [c] = await q(sb.from('ajuda_config').select('*').eq('empresa_id', state.empresa.id)); } catch (err) { return fail(err); }
  c = c || { tour_ativo: true, tour_versao: 1 };
  const md = modal({ title: 'Tour da plataforma', body: `<div class="form"><label class="chk"><input type="checkbox" id="tc-at" ${c.tour_ativo ? 'checked' : ''}> Mostrar o tour para quem entra pela primeira vez</label>
      <label class="chk"><input type="checkbox" id="tc-nv"> Mostrar de novo para todos no próximo acesso (versão ${c.tour_versao} → ${c.tour_versao + 1})</label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="tc-ok">Salvar</button>' });
  $('#tc-ok', md.el).onclick = async () => {
    try { await q(sb.from('ajuda_config').upsert({ empresa_id: state.empresa.id, tour_ativo: $('#tc-at', md.el).checked, tour_versao: c.tour_versao + ($('#tc-nv', md.el).checked ? 1 : 0), atualizado_em: new Date().toISOString() }));
      toast('Tour salvo'); md.close(); } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------------ tour de boas-vindas
const PASSOS = [
  { alvo: '#nav', titulo: 'Menu por área', texto: 'As telas ficam agrupadas por área (Financeiro, Compras, Produção…). Clique na área para abrir as telas dela. A estrela marca uma tela como favorita.' },
  { alvo: '#nav-filtro', titulo: 'Procurar uma tela', texto: 'Digite parte do nome ou o código da tela (ex.: FIN001) para achar rápido.' },
  { alvo: '#busca-btn', titulo: 'Buscar em tudo', texto: 'Ctrl K procura telas, lançamentos, beneficiários, notas e pedidos de qualquer lugar.' },
  { alvo: '#notif-btn', titulo: 'Avisos', texto: 'O sino mostra o que precisa de você: aprovações, vencimentos, integrações atrasadas. Em Meus avisos você escolhe o que receber.' },
  { alvo: '#chat-btn', titulo: 'Conversas', texto: 'Converse com a equipe e envie um lançamento, pedido ou nota direto no chat.' },
  { alvo: '#ajuda-btn', titulo: 'Ajuda desta tela', texto: 'O "?" abre, ao lado, o trecho do manual da tela em que você está, com as figuras e os vídeos.' },
  { alvo: '#page-cod', titulo: 'Código da tela', texto: 'Cada tela tem um código, como no Iniflex. Use para pedir ajuda ou abrir a tela pela busca.' },
  { alvo: '#ano-global', titulo: 'Ano', texto: 'Os relatórios e painéis usam o ano escolhido aqui.' },
  { alvo: '#empresa-switch', titulo: 'Empresa', texto: 'Se você trabalha em mais de uma empresa do grupo, troque aqui.' },
];
let tourAtivo = false;

export async function iniciarTour(forcar = false) {
  if (tourAtivo) return;
  if (!forcar) { try { if (!(await q(sb.rpc('ajuda_tour_pendente', { p_empresa: state.empresa.id })))) return; } catch { return; } }
  const P = passosVisiveis(PASSOS, (s) => $(s));
  if (!P.length) return;
  tourAtivo = true;
  const fundo = document.createElement('div'); fundo.className = 'tour-fundo';
  const luz = document.createElement('div'); luz.className = 'tour-luz';
  const bal = document.createElement('div'); bal.className = 'tour-balao'; bal.setAttribute('role', 'dialog');
  document.body.append(fundo, luz, bal);
  let i = 0;
  const fim = async () => { fundo.remove(); luz.remove(); bal.remove(); tourAtivo = false; document.removeEventListener('keydown', tecla); try { await q(sb.rpc('ajuda_tour_visto', { p_empresa: state.empresa.id })); } catch {} };
  const tecla = (e) => { if (e.key === 'Escape') fim(); else if (e.key === 'ArrowRight') ir(1); else if (e.key === 'ArrowLeft') ir(-1); };
  const ir = (d) => { i += d; if (i >= P.length) return fim(); if (i < 0) i = 0; mostra(); };
  const mostra = () => {
    const p = P[i], el = $(p.alvo); el.scrollIntoView?.({ block: 'nearest' });
    const r = el.getBoundingClientRect(), m = 6;
    Object.assign(luz.style, { top: `${r.top - m}px`, left: `${r.left - m}px`, width: `${r.width + 2 * m}px`, height: `${Math.min(r.height + 2 * m, innerHeight - 20)}px` });
    bal.innerHTML = `<div class="small muted">${i + 1} de ${P.length}</div><b>${esc(p.titulo)}</b><p>${esc(p.texto)}</p>
      <div class="tour-acoes"><button class="btn small ghost" data-t="sair">Pular</button><span class="spacer"></span>${i ? '<button class="btn small" data-t="-1">Voltar</button>' : ''}<button class="btn small primary" data-t="1">${i === P.length - 1 ? 'Concluir' : 'Próximo'}</button></div>`;
    const bw = Math.min(320, innerWidth - 24); bal.style.width = bw + 'px';
    const direita = r.right + 16 + bw < innerWidth, abaixo = r.bottom + 180 < innerHeight;
    bal.style.left = `${Math.max(12, direita ? r.right + 16 : Math.min(r.left, innerWidth - bw - 12))}px`;
    bal.style.top = `${Math.max(12, direita ? Math.min(r.top, innerHeight - 200) : abaixo ? r.bottom + 12 : r.top - 190)}px`;
    bal.querySelector('[data-t="1"]').focus();
  };
  bal.onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (!t) return; if (t === 'sair') fim(); else ir(+t); };
  fundo.onclick = () => fim();
  document.addEventListener('keydown', tecla);
  mostra();
}

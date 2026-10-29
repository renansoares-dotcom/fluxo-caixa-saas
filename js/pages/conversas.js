// Conversas: chat interno no estilo do WhatsApp (lista à esquerda, conversa à direita; no celular, uma de cada vez).
// #/conversas?c=<id> abre uma conversa. O serviço (lib/chat.js) recebe em tempo real e envia; esta tela só desenha.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog } from '../lib/ui.js';
import * as chat from '../lib/chat.js';

export const title = 'Conversas';

const CORES = ['#0a8ed3', '#eb6834', '#4a3aa7', '#1baf7a', '#c98a00', '#d0578a', '#2e8b57', '#d64545', '#6f5bd6', '#0f9aa8'];
const corDe = (id) => { let h = 0; for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return CORES[h % CORES.length]; };
const iniciais = (n) => String(n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
const avatar = (id, nome, grupo = false, tam = 42) => `<span class="ch-av" style="--av:${corDe(id)};width:${tam}px;height:${tam}px;font-size:${Math.round(tam * 0.38)}px">${grupo ? '<svg viewBox="0 0 24 24" width="55%" height="55%" fill="currentColor"><path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1a4.2 4.2 0 0 1 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/></svg>' : esc(iniciais(nome))}</span>`;
const ts = (s) => (s ? Date.parse(s) : 0);
const dia = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
const hora = (s) => new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
function quandoLista(s) {
  if (!s) return '';
  const d = new Date(s), hoje = new Date(), ontem = new Date(Date.now() - 864e5);
  if (dia(d) === dia(hoje)) return hora(s);
  if (dia(d) === dia(ontem)) return 'Ontem';
  if (Date.now() - d < 6 * 864e5) return SEMANA[d.getDay()];
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function rotuloDia(s) {
  const d = new Date(s), hoje = new Date(), ontem = new Date(Date.now() - 864e5);
  if (dia(d) === dia(hoje)) return 'Hoje';
  if (dia(d) === dia(ontem)) return 'Ontem';
  if (Date.now() - d < 6 * 864e5) return SEMANA[d.getDay()][0].toUpperCase() + SEMANA[d.getDay()].slice(1);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}
const tamanho = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);
const silenciada = (c) => c?.silenciada_ate && new Date(c.silenciada_ate) > new Date();
const mobile = () => matchMedia('(max-width: 760px)').matches;
const toqueGrosso = () => matchMedia('(pointer: coarse)').matches;

// *negrito* _itálico_ ~riscado~ `código` e links (como no WhatsApp)
const RX_LINK = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])/gi;
function formatar(txt) {
  const partes = String(txt).split(RX_LINK);
  return partes.map((p, i) => {
    if (i % 2) { const href = p.startsWith('www.') ? 'https://' + p : p; return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p)}</a>`; }
    return esc(p)
      .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,!?:;])/g, '$1<strong>$2</strong>')
      .replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=$|[\s).,!?:;])/g, '$1<s>$2</s>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/(^|\s)(#\/[a-z0-9\-/?=&]+)/gi, '$1<a href="$2">$2</a>');
  }).join('').replace(/\n/g, '<br>');
}
const soEmoji = (t) => /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍|\s){1,12}$/u.test(t || '') && /\p{Extended_Pictographic}/u.test(t) && [...(t || '').replace(/\s/g, '')].length <= 8;

const EMOJIS = ('😀 😁 😂 🤣 😊 😍 😘 😉 😎 🤩 🙂 🤔 😐 😅 😬 🙄 😴 😢 😭 😡 🤯 😱 🥳 🤝 👍 👎 👏 🙏 💪 👌 ✌️ 🤞 👋 🙌 ☝️ 👀 '
  + '❤️ 💙 💚 💛 🧡 💜 🖤 💔 🔥 ⭐ ✨ 🎉 🎂 🎁 ✅ ❌ ⚠️ ❗ ❓ 💯 🆗 🔔 📌 📎 📄 📊 📈 📉 💰 💵 💳 🧾 🏦 📦 🚚 🏭 ⚙️ 🛠️ 🧪 '
  + '📅 ⏰ ⏳ ☕ 🍕 🍔 🍺 ⚽ 🏆 🚀 💡 📞 📧 💻 📱 🖨️ 🔒 🔑 ☀️ 🌧️ 🌙 🇧🇷').split(' ');

let ui = null;          // estado da tela aberta

export async function render(root) {
  root.classList.add('page-chat');
  ui = { root, id: null, msgs: [], parts: [], fimHist: false, carregando: false, filtro: 'todas', busca: '', arquivos: [], desliga: null, novasAbaixo: 0 };
  root.innerHTML = `<div class="ch" id="ch">
    <section class="ch-lado">
      <div class="ch-lado-topo"><strong>Conversas</strong>
        <div class="ch-acoes"><button class="btn ghost icon" id="ch-nova" title="Nova conversa" aria-label="Nova conversa"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 8v6M9 11h6"/></svg></button>
        <button class="btn ghost icon" id="ch-grupo" title="Novo grupo" aria-label="Novo grupo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M19 8v6M16 11h6"/></svg></button></div></div>
      <div class="ch-busca"><input id="ch-busca" type="search" placeholder="Pesquisar conversa" autocomplete="off"></div>
      <div class="ch-filtros" id="ch-filtros">${[['todas', 'Tudo'], ['nao_lidas', 'Não lidas'], ['grupos', 'Grupos'], ['arquivadas', 'Arquivadas']].map(([k, l]) => `<button class="ch-chip${k === 'todas' ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="ch-lista" id="ch-lista"><div class="loading">Carregando…</div></div>
    </section>
    <section class="ch-conv" id="ch-conv"><div class="ch-vazio"><div class="ch-vazio-ico">💬</div><h3>Conversas da equipe</h3><p class="muted">Escolha uma conversa à esquerda ou comece uma nova.<br>As mensagens ficam só entre quem participa.</p></div></section>
  </div>`;
  $('#ch-nova', root).onclick = novaConversa;
  $('#ch-grupo', root).onclick = () => novoGrupo();
  $('#ch-busca', root).oninput = (e) => { ui.busca = e.target.value.trim().toLowerCase(); pintarLista(); };
  $('#ch-filtros', root).onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; ui.filtro = b.dataset.f; $$('.ch-chip', root).forEach(x => x.classList.toggle('on', x === b)); pintarLista(); };

  if (!chat.chatPronto()) await chat.atualizarResumo(true);
  if (!chat.chatPronto()) {
    root.innerHTML = '<div class="card"><div class="empty">As Conversas ainda não foram ativadas no banco de dados. Peça ao administrador da plataforma.</div></div>';
    return;
  }
  _contatos = await chat.getContatos().catch(() => []);
  const desl = chat.ouvir(aoEvento);
  ui.desliga = () => { desl(); chat.setAberta(null); window.removeEventListener('focus', aoFocar); document.removeEventListener('visibilitychange', aoFocar); };
  window.addEventListener('focus', aoFocar); document.addEventListener('visibilitychange', aoFocar);
  pintarLista();
  const id = new URLSearchParams(location.hash.split('?')[1] || '').get('c');
  if (id) abrir(id, false);
}

function vivo() { if (ui && !ui.root.isConnected) { ui.desliga?.(); ui = null; } return !!ui; }
function aoFocar() { if (vivo() && ui.id && !document.hidden) chat.marcarLida(ui.id); }

function aoEvento(ev, d) {
  if (!vivo()) return;
  if (ev === 'resumo') { pintarLista(); if (ui.id) pintarTopo(); }
  else if (ev === 'mensagem' && d.conversa_id === ui.id) receber(d);
  else if (ev === 'participante' && d.conversa_id === ui.id) {
    const i = ui.parts.findIndex(p => p.user_id === d.user_id);
    if (i >= 0) ui.parts[i] = { ...ui.parts[i], ...d }; else ui.parts.push(d);
    pintarTicks(); pintarComposer();
  }
  else if (ev === 'fila' && d.conversa === ui.id) pintarPendente(d);
  else if (ev === 'enviada' && d.item.conversa === ui.id) { $(`[data-cliente="${d.item.clienteId}"]`, ui.root)?.remove(); receber(d.m); }
  else if (ev === 'conexao') { const t = $('#ch-off', ui.root); if (t) t.hidden = d === 'SUBSCRIBED'; }
}

// ---------- lista ----------
function pintarLista() {
  const el = $('#ch-lista', ui.root); if (!el) return;
  let l = chat.getResumo();
  if (ui.filtro === 'arquivadas') l = l.filter(c => c.arquivada); else l = l.filter(c => !c.arquivada);
  if (ui.filtro === 'nao_lidas') l = l.filter(c => c.nao_lidas > 0);
  if (ui.filtro === 'grupos') l = l.filter(c => c.tipo === 'grupo');
  if (ui.busca) l = l.filter(c => `${c.nome} ${c.ultima_msg_texto || ''}`.toLowerCase().includes(ui.busca));
  const narq = chat.getResumo().filter(c => c.arquivada).length;
  if (!l.length) {
    el.innerHTML = `<div class="ch-lista-vazia muted">${ui.busca ? 'Nada encontrado.' : ui.filtro === 'arquivadas' ? 'Nenhuma conversa arquivada.' : ui.filtro === 'nao_lidas' ? 'Tudo lido 👍' : 'Nenhuma conversa ainda.<br><button class="btn small primary" id="ch-comecar">Começar uma conversa</button>'}</div>`;
    $('#ch-comecar', el) && ($('#ch-comecar', el).onclick = novaConversa);
    return;
  }
  el.innerHTML = l.map(c => {
    const minha = c.ultima_msg_autor === chat.eu();
    const prev = c.ultima_msg_texto ? `${minha ? 'Você: ' : c.tipo === 'grupo' && c.ultima_msg_autor_nome ? esc(c.ultima_msg_autor_nome.split(' ')[0]) + ': ' : ''}${esc(c.ultima_msg_texto)}` : `<span class="muted">${c.tipo === 'grupo' ? `${c.participantes} participantes` : 'Diga olá 👋'}</span>`;
    return `<button class="ch-item${c.id === ui.id ? ' on' : ''}${c.nao_lidas ? ' nl' : ''}" data-id="${c.id}">
      ${avatar(c.tipo === 'grupo' ? c.id : c.outro_id, c.nome, c.tipo === 'grupo')}
      <span class="ch-item-txt"><span class="ch-item-l1"><span class="ch-item-nome">${esc(c.nome || 'Conversa')}</span><span class="ch-item-hora">${quandoLista(c.ultima_msg_em)}</span></span>
      <span class="ch-item-l2"><span class="ch-item-prev">${prev}</span>
        <span class="ch-item-ico">${silenciada(c) ? '<span title="Silenciada">🔕</span>' : ''}${c.fixada ? '<span title="Fixada">📌</span>' : ''}${c.nao_lidas ? `<span class="ch-nl${silenciada(c) ? ' mudo' : ''}">${c.nao_lidas > 99 ? '99+' : c.nao_lidas}</span>` : ''}</span></span></span></button>`;
  }).join('') + (ui.filtro === 'todas' && narq ? `<button class="ch-arq-link" data-f="arquivadas">Arquivadas (${narq})</button>` : '');
  el.onclick = (e) => {
    const a = e.target.closest('.ch-arq-link'); if (a) { $(`.ch-chip[data-f="arquivadas"]`, ui.root).click(); return; }
    const it = e.target.closest('.ch-item'); if (it) abrir(it.dataset.id);
  };
}

// ---------- conversa ----------
async function abrir(id, empilhar = true) {
  if (!vivo()) return;
  const c = chat.getResumo().find(x => x.id === id);
  if (!c) { await chat.atualizarResumo(); if (!chat.getResumo().find(x => x.id === id)) { toast('Conversa não encontrada', true); return; } }
  ui.id = id; ui.msgs = []; ui.parts = []; ui.fimHist = false; ui.arquivos = []; ui.novasAbaixo = 0;
  chat.setAberta(id);
  const url = `#/conversas?c=${id}`;
  if (location.hash !== url) history[empilhar ? 'pushState' : 'replaceState'](null, '', url);
  $('#ch', ui.root).classList.add('aberta');
  $$('.ch-item', ui.root).forEach(x => x.classList.toggle('on', x.dataset.id === id));
  const conv = $('#ch-conv', ui.root);
  conv.innerHTML = `<header class="ch-topo" id="ch-topo"></header>
    <div class="ch-off small" id="ch-off" hidden>Reconectando… as mensagens novas podem demorar a aparecer.</div>
    <div class="ch-msgs" id="ch-msgs"><div class="loading">Carregando…</div></div>
    <button class="ch-descer" id="ch-descer" hidden aria-label="Ir para o fim">⌄<span class="ch-nl" id="ch-descer-n" hidden></span></button>
    <div class="ch-anexos" id="ch-anexos" hidden></div>
    <footer class="ch-composer" id="ch-composer"></footer>
    <div class="ch-soltar" id="ch-soltar" hidden>Solte os arquivos para enviar</div>`;
  pintarTopo(); pintarComposer();
  try {
    const [msgs, parts] = await Promise.all([
      q(sb.from('chat_mensagens').select(chat.SELECT_MSG).eq('conversa_id', id).order('criado_em', { ascending: false }).limit(50)),
      q(sb.from('chat_participantes').select('conversa_id, user_id, admin, entrou_em, saiu_em, entregue_ate, lida_ate').eq('conversa_id', id)),
    ]);
    if (ui?.id !== id) return;
    ui.msgs = msgs.reverse(); ui.parts = parts; ui.fimHist = msgs.length < 50;
  } catch (e) { fail(e); return; }
  const cAtual = chat.getResumo().find(x => x.id === id);
  ui.primeiraNaoLida = cAtual?.nao_lidas ? ui.msgs.filter(m => m.autor_id !== chat.eu() && m.tipo !== 'sistema').slice(-cAtual.nao_lidas)[0]?.id : null;
  pintarTopo(); pintarComposer();
  pintarMsgs(true);
  chat.marcarLida(id);
  const box = $('#ch-msgs', ui.root);
  box.onscroll = () => {
    if (box.scrollTop < 80) carregarAntigas();
    const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    $('#ch-descer', ui.root).hidden = perto;
    if (perto && ui.novasAbaixo) { ui.novasAbaixo = 0; pintarDescer(); }
  };
  $('#ch-descer', ui.root).onclick = () => { box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); ui.novasAbaixo = 0; pintarDescer(); };
  ligarSoltar(conv);
  if (!toqueGrosso()) setTimeout(() => $('#ch-txt', ui.root)?.focus(), 50);
}
function pintarDescer() { const n = $('#ch-descer-n', ui.root); if (n) { n.hidden = !ui.novasAbaixo; n.textContent = ui.novasAbaixo; } }

function conversa() { return chat.getResumo().find(x => x.id === ui.id) || {}; }
function pintarTopo() {
  const t = $('#ch-topo', ui.root); if (!t) return;
  const c = conversa();
  let sub = '';
  if (c.tipo === 'grupo') {
    const ativos = ui.parts.filter(p => !p.saiu_em);
    sub = ativos.length ? ativos.map(p => chat.nomeDe(p.user_id)).sort((a, b) => (a === 'Você') - (b === 'Você') || a.localeCompare(b)).join(', ') : `${c.participantes || ''} participantes`;
  } else {
    sub = papelDe(c.outro_id);
  }
  t.innerHTML = `<button class="btn ghost icon ch-voltar" id="ch-voltar" aria-label="Voltar">←</button>
    <button class="ch-topo-quem" id="ch-quem">${avatar(c.tipo === 'grupo' ? c.id : c.outro_id, c.nome, c.tipo === 'grupo', 38)}
      <span class="ch-topo-txt"><strong>${esc(c.nome || 'Conversa')}</strong><span class="small muted ch-topo-sub">${esc(sub)}</span></span></button>
    <span class="ch-topo-ico">${silenciada(c) ? '🔕' : ''}</span>
    <div class="ch-menu-wrap"><button class="btn ghost icon" id="ch-menu-btn" aria-label="Mais opções">⋮</button><div class="ch-menu" id="ch-menu" hidden></div></div>`;
  $('#ch-voltar', t).onclick = () => { $('#ch', ui.root).classList.remove('aberta'); ui.id = null; chat.setAberta(null); history.pushState(null, '', '#/conversas'); pintarLista(); };
  $('#ch-quem', t).onclick = () => (c.tipo === 'grupo' ? dadosGrupo() : dadosContato());
  $('#ch-menu-btn', t).onclick = (e) => { e.stopPropagation(); abrirMenu(); };
}
function papelDe(uid) {
  const PAP = { admin: 'Administrador', financeiro: 'Financeiro', diretor: 'Diretor', leitura: 'Leitura', compras: 'Compras', vendas: 'Vendas', producao: 'Produção' };
  return PAP[contato(uid)?.papel] || '';
}
let _contatos = [];
function contato(uid) { return _contatos.find(x => x.user_id === uid); }

function abrirMenu() {
  const m = $('#ch-menu', ui.root), c = conversa();
  const itens = [
    silenciada(c) ? ['som', 'Ativar som'] : ['silenciar', 'Silenciar…'],
    [c.fixada ? 'desafixar' : 'fixar', c.fixada ? 'Desafixar' : 'Fixar no topo'],
    [c.arquivada ? 'desarquivar' : 'arquivar', c.arquivada ? 'Desarquivar' : 'Arquivar'],
    [c.tipo === 'grupo' ? 'grupo' : 'contato', c.tipo === 'grupo' ? 'Dados do grupo' : 'Dados do contato'],
  ];
  if (c.tipo === 'grupo' && !c.saiu) itens.push(['sair', 'Sair do grupo']);
  m.innerHTML = itens.map(([k, l]) => `<button data-k="${k}"${k === 'sair' ? ' class="neg"' : ''}>${l}</button>`).join('');
  m.hidden = false;
  const fechar = (e) => { if (!e.target.closest('.ch-menu-wrap')) { m.hidden = true; document.removeEventListener('click', fechar); } };
  setTimeout(() => document.addEventListener('click', fechar), 0);
  m.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
    m.hidden = true;
    try {
      if (k === 'silenciar') return silenciar();
      if (k === 'som') await chat.preferencias(ui.id, { tirar_silencio: true });
      if (k === 'fixar' || k === 'desafixar') await chat.preferencias(ui.id, { fixada: k === 'fixar' });
      if (k === 'arquivar' || k === 'desarquivar') { await chat.preferencias(ui.id, { arquivada: k === 'arquivar' }); toast(k === 'arquivar' ? 'Conversa arquivada. Volta para a lista quando chegar mensagem.' : 'Conversa desarquivada'); }
      if (k === 'grupo') dadosGrupo();
      if (k === 'contato') dadosContato();
      if (k === 'sair') { if (await confirmDialog('Sair deste grupo? Você continua vendo as mensagens até agora, mas não recebe as novas.')) { await q(sb.rpc('chat_grupo_remover', { p_conversa: ui.id, p_user: chat.eu() })); await chat.atualizarResumo(); recarregarParts(); } }
      pintarTopo();
    } catch (er) { fail(er); }
  };
}
function silenciar() {
  const md = modal({ title: 'Silenciar conversa', body: `<p class="muted" style="margin-top:0">Sem som e sem aviso no celular para esta conversa. As mensagens continuam chegando.</p>
    <div class="ch-opcoes">${[['8', '8 horas'], ['168', '1 semana'], ['sempre', 'Sempre']].map(([v, l], i) => `<label class="ch-opcao"><input type="radio" name="sil" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="sil-ok">Silenciar</button>' });
  $('#sil-ok', md.el).onclick = async () => {
    const v = $('input[name=sil]:checked', md.el).value;
    const ate = v === 'sempre' ? '9999-12-31T00:00:00Z' : new Date(Date.now() + +v * 3600e3).toISOString();
    try { await chat.preferencias(ui.id, { silenciada_ate: ate }); md.close(); pintarTopo(); } catch (e) { fail(e); }
  };
}
async function recarregarParts() {
  try { ui.parts = await q(sb.from('chat_participantes').select('conversa_id, user_id, admin, entrou_em, saiu_em, entregue_ate, lida_ate').eq('conversa_id', ui.id)); } catch {}
  pintarTopo(); pintarComposer(); pintarTicks();
}

// ---------- mensagens ----------
function htmlMsg(m, ant) {
  if (m.tipo === 'sistema') return `<div class="cm-sis" data-id="${m.id}"><span>${esc(m.texto)}</span></div>`;
  const c = conversa(), minha = m.autor_id === chat.eu();
  const cont = ant && ant.tipo !== 'sistema' && ant.autor_id === m.autor_id && dia(ant.criado_em) === dia(m.criado_em) && ts(m.criado_em) - ts(ant.criado_em) < 5 * 60e3;
  const anexos = (m.chat_anexos || []);
  const imgs = anexos.filter(a => /^image\//.test(a.mime || '')), docs = anexos.filter(a => !/^image\//.test(a.mime || ''));
  const grande = !anexos.length && soEmoji(m.texto);
  return `<div class="cm${minha ? ' eu' : ''}${cont ? ' cont' : ''}" data-id="${m.id}" data-t="${esc(m.criado_em)}">
    <div class="cm-bolha${grande ? ' emoji' : ''}${imgs.length && !m.texto && !docs.length ? ' so-img' : ''}">
      ${c.tipo === 'grupo' && !minha && !cont ? `<div class="cm-autor" style="color:${corDe(m.autor_id)}">${esc(chat.nomeDe(m.autor_id))}</div>` : ''}
      ${imgs.length ? `<div class="cm-imgs n${Math.min(imgs.length, 4)}">${imgs.map(a => `<button class="cm-img" data-caminho="${esc(a.caminho)}" data-nome="${esc(a.nome)}" style="${a.largura && imgs.length === 1 ? `aspect-ratio:${a.largura}/${a.altura}` : ''}"><span class="cm-img-load"></span></button>`).join('')}</div>` : ''}
      ${docs.map(a => `<button class="cm-doc" data-caminho="${esc(a.caminho)}" data-nome="${esc(a.nome)}"><span class="cm-doc-ico">${icoDoc(a)}</span><span class="cm-doc-txt"><span class="cm-doc-nome">${esc(a.nome)}</span><span class="small muted">${esc(extDe(a.nome))} · ${tamanho(a.tamanho)}</span></span><span class="cm-doc-baixar">⬇</span></button>`).join('')}
      ${m.texto ? `<div class="cm-texto">${formatar(m.texto)}</div>` : ''}
      <span class="cm-meta">${hora(m.criado_em)}${minha ? `<span class="cm-tick" data-tick>${tick(m)}</span>` : ''}</span>
    </div></div>`;
}
const extDe = (n) => (String(n).match(/\.(\w{1,6})$/)?.[1] || 'arquivo').toUpperCase();
function icoDoc(a) {
  const e = extDe(a.nome);
  const cor = { PDF: '#d64545', XML: '#0a8ed3', XLSX: '#1baf7a', XLS: '#1baf7a', CSV: '#1baf7a', DOCX: '#2b5598', DOC: '#2b5598', ZIP: '#8a6d3b', OFX: '#4a3aa7' }[e] || '#667085';
  return `<span style="background:${cor}">${esc(e.slice(0, 4))}</span>`;
}
// ✓ enviada · ✓✓ entregue a todos · ✓✓ azul lida por todos
function estadoMsg(m) {
  const t = ts(m.criado_em);
  const outros = ui.parts.filter(p => p.user_id !== chat.eu() && ts(p.entrou_em) <= t + 1000 && (!p.saiu_em || ts(p.saiu_em) >= t));
  if (!outros.length) return 'enviada';
  if (outros.every(p => ts(p.lida_ate) >= t)) return 'lida';
  if (outros.every(p => ts(p.entregue_ate) >= t || ts(p.lida_ate) >= t)) return 'entregue';
  return 'enviada';
}
const SVG1 = '<svg viewBox="0 0 16 11" width="16" height="11"><path d="M11.1.6 4.7 7 1.9 4.2.8 5.3l3.9 3.9L12.2 1.7z" fill="currentColor"/></svg>';
const SVG2 = '<svg viewBox="0 0 18 11" width="18" height="11"><path d="M12.6.6 6.2 7 5 5.8 3.9 6.9l2.3 2.3 7.5-7.5zM9.9 1.7 8.8.6 2.4 7 .9 5.5-.2 6.6l2.6 2.6z" fill="currentColor" transform="translate(1 0)"/><path d="M16.6.6 10.2 7l-.6-.6-1.1 1.1 1.7 1.7 7.5-7.5z" fill="currentColor"/></svg>';
function tick(m) {
  const e = estadoMsg(m);
  return e === 'lida' ? `<span class="tk lida" title="Lida">${SVG2}</span>` : e === 'entregue' ? `<span class="tk" title="Entregue">${SVG2}</span>` : `<span class="tk" title="Enviada">${SVG1}</span>`;
}
function pintarTicks() { if (!ui?.id) return; for (const el of $$('.cm.eu[data-id]', ui.root)) { const m = ui.msgs.find(x => x.id === el.dataset.id); const t = el.querySelector('[data-tick]'); if (m && t) t.innerHTML = tick(m); } }

function pintarMsgs(rolarFim = false) {
  const box = $('#ch-msgs', ui.root); if (!box) return;
  let html = ui.fimHist ? `<div class="cm-inicio small muted">${conversa().tipo === 'grupo' ? 'Início do grupo' : 'Início da conversa'} · as mensagens ficam só entre quem participa 🔒</div>` : '<div class="cm-inicio small muted">Carregando mensagens anteriores…</div>';
  let ant = null;
  for (const m of ui.msgs) {
    if (!ant || dia(ant.criado_em) !== dia(m.criado_em)) { html += `<div class="cm-dia"><span>${rotuloDia(m.criado_em)}</span></div>`; ant = null; }
    if (m.id === ui.primeiraNaoLida) html += '<div class="cm-novas" id="cm-novas"><span>Mensagens não lidas</span></div>';
    html += htmlMsg(m, ant); ant = m;
  }
  html += '<div id="cm-pend"></div>';
  box.innerHTML = html;
  for (const it of chat.getFila(ui.id)) pintarPendente(it);
  carregarImagens(box);
  ligarAnexos(box);
  if (rolarFim) {
    const nv = $('#cm-novas', box);
    requestAnimationFrame(() => { if (nv) nv.scrollIntoView({ block: 'center' }); else box.scrollTop = box.scrollHeight; });
  }
}

async function carregarAntigas() {
  if (ui.fimHist || ui.carregando || !ui.msgs.length) return;
  ui.carregando = true;
  const id = ui.id, box = $('#ch-msgs', ui.root);
  try {
    const mais = await q(sb.from('chat_mensagens').select(chat.SELECT_MSG).eq('conversa_id', id).lt('criado_em', ui.msgs[0].criado_em).order('criado_em', { ascending: false }).limit(50));
    if (ui?.id !== id) return;
    ui.fimHist = mais.length < 50;
    const antes = box.scrollHeight;
    ui.msgs = mais.reverse().concat(ui.msgs);
    pintarMsgs();
    box.scrollTop = box.scrollHeight - antes;
  } catch (e) { fail(e); } finally { if (ui) ui.carregando = false; }
}

function receber(m) {
  if (!ui?.id || m.conversa_id !== ui.id) return;
  if (ui.msgs.some(x => x.id === m.id)) return;
  if (m.cliente_id) $(`[data-cliente="${m.cliente_id}"]`, ui.root)?.remove();
  const box = $('#ch-msgs', ui.root);
  const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const ant = ui.msgs[ui.msgs.length - 1];
  ui.msgs.push(m);
  // a pessoa entrou/saiu/virou admin: atualiza os participantes
  if (m.tipo === 'sistema') recarregarParts();
  const pend = $('#cm-pend', box);
  let html = '';
  if (!ant || dia(ant.criado_em) !== dia(m.criado_em)) html += `<div class="cm-dia"><span>${rotuloDia(m.criado_em)}</span></div>`;
  html += htmlMsg(m, ant && dia(ant.criado_em) === dia(m.criado_em) ? ant : null);
  pend.insertAdjacentHTML('beforebegin', html);
  carregarImagens(box); ligarAnexos(box);
  const minha = m.autor_id === chat.eu();
  if (perto || minha) box.scrollTop = box.scrollHeight;
  else { ui.novasAbaixo++; pintarDescer(); $('#ch-descer', ui.root).hidden = false; }
  if (!minha) chat.marcarLida(ui.id);
}

function pintarPendente(it) {
  if (!ui?.id) return;
  const pend = $('#cm-pend', ui.root); if (!pend) return;
  let el = $(`[data-cliente="${it.clienteId}"]`, ui.root);
  if (it.status === 'descartado' || it.status === 'enviada') { el?.remove(); return; }
  const icone = it.status === 'falhou' ? '<span class="tk erro" title="Não enviada">!</span>' : '<span class="tk" title="Enviando">🕓</span>';
  const arqs = it.arquivos.map(f => `<div class="cm-doc pend"><span class="cm-doc-ico"><span style="background:#667085">${esc(extDe(f.name).slice(0, 4))}</span></span><span class="cm-doc-txt"><span class="cm-doc-nome">${esc(f.name)}</span><span class="small muted">${tamanho(f.size)}</span></span></div>`).join('');
  const html = `<div class="cm eu pend" data-cliente="${it.clienteId}"><div class="cm-bolha">${arqs}${it.texto ? `<div class="cm-texto">${formatar(it.texto)}</div>` : ''}
    <span class="cm-meta">${hora(it.criado_em)}${icone}</span>
    ${it.status === 'falhou' || it.status === 'aguardando' ? `<div class="cm-erro small">${esc(it.erro || '')}${it.status === 'falhou' ? ' <button class="btn link small" data-re>Tentar de novo</button> <button class="btn link small" data-desc>Descartar</button>' : ''}</div>` : ''}</div></div>`;
  if (el) el.outerHTML = html; else pend.insertAdjacentHTML('beforeend', html);
  el = $(`[data-cliente="${it.clienteId}"]`, ui.root);
  $('[data-re]', el) && ($('[data-re]', el).onclick = () => chat.reenviar(it.clienteId));
  $('[data-desc]', el) && ($('[data-desc]', el).onclick = () => chat.descartar(it.clienteId));
  const box = $('#ch-msgs', ui.root); box.scrollTop = box.scrollHeight;
}

// ---------- anexos ----------
async function carregarImagens(box) {
  const bts = $$('.cm-img:not([data-ok])', box); if (!bts.length) return;
  bts.forEach(b => b.dataset.ok = '1');
  const urls = await chat.urlsAnexos(bts.map(b => b.dataset.caminho));
  for (const b of bts) { const u = urls[b.dataset.caminho]; b.innerHTML = u ? `<img src="${esc(u)}" alt="${esc(b.dataset.nome)}" loading="lazy">` : '<span class="small muted">imagem indisponível</span>'; }
}
function ligarAnexos(box) {
  box.onclick = async (e) => {
    const im = e.target.closest('.cm-img'); const dc = e.target.closest('.cm-doc:not(.pend)');
    if (!im && !dc) return;
    const el = im || dc;
    const { [el.dataset.caminho]: u } = await chat.urlsAnexos([el.dataset.caminho]);
    if (!u) return toast('Arquivo indisponível', true);
    if (im) {
      const md = modal({ title: el.dataset.nome, wide: true, body: `<div class="ch-foto"><img src="${esc(u)}" alt="${esc(el.dataset.nome)}"></div>`,
        foot: `<a class="btn" href="${esc(u)}&download=${encodeURIComponent(el.dataset.nome)}">Baixar</a><a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Abrir em nova aba</a><button class="btn primary" data-close>Fechar</button>` });
      return md;
    }
    if (/\.pdf$/i.test(el.dataset.nome)) window.open(u, '_blank', 'noopener');
    else { const a = document.createElement('a'); a.href = `${u}&download=${encodeURIComponent(el.dataset.nome)}`; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
  };
}
function ligarSoltar(conv) {
  let n = 0; const sol = $('#ch-soltar', conv);
  conv.ondragenter = (e) => { if (!e.dataTransfer?.types?.includes('Files') || !podeEscrever()) return; e.preventDefault(); n++; sol.hidden = false; };
  conv.ondragover = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
  conv.ondragleave = () => { if (--n <= 0) { n = 0; sol.hidden = true; } };
  conv.ondrop = (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); n = 0; sol.hidden = true; if (podeEscrever()) addArquivos([...e.dataTransfer.files]); };
}
function addArquivos(fs) {
  for (const f of fs) { if (f.size > 25 * 1048576) { toast(`"${f.name}" passa de 25 MB`, true); continue; } if (ui.arquivos.length >= 10) { toast('Até 10 arquivos por mensagem', true); break; } ui.arquivos.push(f); }
  pintarArquivos();
}
function pintarArquivos() {
  const el = $('#ch-anexos', ui.root); if (!el) return;
  el.hidden = !ui.arquivos.length;
  el.innerHTML = ui.arquivos.map((f, i) => `<span class="ch-anexo">${/^image\//.test(f.type) ? `<img src="${URL.createObjectURL(f)}" alt="">` : `<span class="cm-doc-ico">${icoDoc({ nome: f.name })}</span>`}<span class="ch-anexo-nome">${esc(f.name)}<br><span class="muted">${tamanho(f.size)}</span></span><button class="btn ghost icon small" data-i="${i}" aria-label="Tirar">✕</button></span>`).join('')
    + (ui.arquivos.length ? '<span class="small muted">Escreva uma legenda (opcional) e envie.</span>' : '');
  el.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { ui.arquivos.splice(+b.dataset.i, 1); pintarArquivos(); } };
  ajustarBotao();
}

// ---------- escrever ----------
function podeEscrever() {
  const c = conversa();
  if (c.saiu) return false;
  if (c.tipo === 'grupo' && c.so_admins_escrevem && !c.sou_admin) return false;
  return true;
}
function pintarComposer() {
  const f = $('#ch-composer', ui.root); if (!f) return;
  const c = conversa();
  if (!podeEscrever()) {
    f.innerHTML = `<div class="ch-bloq small muted">${c.saiu ? 'Você não participa mais deste grupo.' : 'Só os administradores podem enviar mensagens neste grupo.'}</div>`;
    return;
  }
  if ($('#ch-txt', f)) return;                       // já desenhado: não perde o que foi digitado
  f.innerHTML = `<div class="ch-emoji-wrap"><button class="btn ghost icon" id="ch-emoji" title="Emoji" aria-label="Emoji">😊</button><div class="ch-emojis" id="ch-emojis" hidden>${EMOJIS.map(e => `<button type="button">${e}</button>`).join('')}</div></div>
    <label class="btn ghost icon ch-clip" title="Anexar arquivo ou foto" aria-label="Anexar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg><input type="file" id="ch-arq" multiple hidden></label>
    <textarea id="ch-txt" rows="1" placeholder="Mensagem" maxlength="8000" aria-label="Mensagem"></textarea>
    <button class="btn primary icon ch-enviar" id="ch-enviar" aria-label="Enviar" disabled><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2z"/></svg></button>`;
  const tx = $('#ch-txt', f);
  const cresce = () => { tx.style.height = 'auto'; tx.style.height = Math.min(tx.scrollHeight, 160) + 'px'; ajustarBotao(); };
  tx.oninput = cresce;
  tx.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !toqueGrosso() && !e.isComposing) { e.preventDefault(); mandar(); } };
  tx.onpaste = (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addArquivos(fs); } };
  $('#ch-arq', f).onchange = (e) => { addArquivos([...e.target.files]); e.target.value = ''; };
  $('#ch-enviar', f).onclick = mandar;
  const ep = $('#ch-emojis', f);
  $('#ch-emoji', f).onclick = (e) => { e.stopPropagation(); ep.hidden = !ep.hidden; };
  ep.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const p = tx.selectionStart ?? tx.value.length; tx.value = tx.value.slice(0, p) + b.textContent + tx.value.slice(tx.selectionEnd ?? p); tx.selectionStart = tx.selectionEnd = p + b.textContent.length; tx.focus(); cresce(); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.ch-emoji-wrap')) ep.hidden = true; });
}
function ajustarBotao() { const b = $('#ch-enviar', ui.root), t = $('#ch-txt', ui.root); if (b && t) b.disabled = !t.value.trim() && !ui.arquivos.length; }
function mandar() {
  const tx = $('#ch-txt', ui.root); if (!tx) return;
  const texto = tx.value.replace(/\s+$/, '');
  if (!texto.trim() && !ui.arquivos.length) return;
  const it = chat.enviar(ui.id, texto, ui.arquivos.slice());
  if (!it) return;
  tx.value = ''; tx.style.height = 'auto'; ui.arquivos = []; pintarArquivos(); ajustarBotao();
  $('#ch-emojis', ui.root).hidden = true;
  if (!toqueGrosso()) tx.focus();
}

// ---------- nova conversa, grupo, dados ----------
async function listaPessoas({ multipla = false, marcados = [], excluir = [] } = {}) {
  const todos = await chat.getContatos(true).catch(() => _contatos);
  if (todos.length) _contatos = todos;
  const pessoas = todos.filter(p => !excluir.includes(p.user_id));
  return `<input type="search" class="ch-pess-busca" placeholder="Pesquisar pessoa" autocomplete="off">
    <div class="ch-pessoas">${pessoas.length ? pessoas.map(p => `<label class="ch-pessoa" data-txt="${esc((p.nome + ' ' + p.email).toLowerCase())}">
      ${multipla ? `<input type="checkbox" value="${p.user_id}" ${marcados.includes(p.user_id) ? 'checked' : ''}>` : `<input type="radio" name="pessoa" value="${p.user_id}" hidden>`}
      ${avatar(p.user_id, p.nome, false, 36)}<span><strong>${esc(p.nome)}</strong><br><span class="small muted">${esc(papelDe(p.user_id) || p.papel)} · ${esc(p.email)}</span></span></label>`).join('')
      : '<div class="empty small">Ninguém para adicionar.</div>'}</div>`;
}
function ligarBuscaPessoas(el) {
  const b = $('.ch-pess-busca', el); if (!b) return;
  b.oninput = () => { const t = b.value.trim().toLowerCase(); $$('.ch-pessoa', el).forEach(p => { p.hidden = !!t && !p.dataset.txt.includes(t); }); };
  setTimeout(() => b.focus(), 50);
}
async function novaConversa() {
  const md = modal({ title: 'Nova conversa', body: `<button class="btn ch-novo-grupo" id="nc-grupo">${avatar('g', '', true, 32)} Novo grupo</button>${await listaPessoas()}` });
  ligarBuscaPessoas(md.el);
  $('#nc-grupo', md.el).onclick = () => { md.close(); novoGrupo(); };
  $('.ch-pessoas', md.el).onclick = async (e) => {
    const p = e.target.closest('.ch-pessoa'); if (!p) return;
    e.preventDefault();
    try { const id = await chat.abrirDireta(p.querySelector('input').value); md.close(); await chat.atualizarResumo(); pintarLista(); abrir(id); } catch (er) { fail(er); }
  };
}
async function novoGrupo() {
  const md = modal({ title: 'Novo grupo', body: `<form class="form" id="ng-f">
      <label>Nome do grupo<input name="nome" maxlength="80" required placeholder="Ex.: Financeiro, Fechamento de outubro"></label>
      <label>Descrição (opcional)<input name="descricao" maxlength="500"></label>
      <div class="small muted" style="margin:6px 0 4px">Participantes</div>${await listaPessoas({ multipla: true })}</form>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ng-ok">Criar grupo</button>' });
  ligarBuscaPessoas(md.el);
  setTimeout(() => $('[name=nome]', md.el).focus(), 60);
  $('#ng-ok', md.el).onclick = async () => {
    const nome = $('[name=nome]', md.el).value.trim(); if (!nome) return toast('Dê um nome ao grupo', true);
    const users = $$('.ch-pessoa input:checked', md.el).map(i => i.value);
    if (!users.length) return toast('Escolha ao menos uma pessoa', true);
    try { const id = await chat.criarGrupo(nome, $('[name=descricao]', md.el).value.trim(), users); md.close(); pintarLista(); abrir(id); } catch (e) { fail(e); }
  };
}
async function dadosContato() {
  const c = conversa(); const p = contato(c.outro_id) || (await chat.getContatos()).find(x => x.user_id === c.outro_id);
  modal({ title: 'Dados do contato', body: `<div class="ch-perfil">${avatar(c.outro_id, c.nome, false, 84)}<h3>${esc(c.nome)}</h3>
    <div class="muted">${esc(p?.email || '')}</div><div class="small muted">${esc(papelDe(c.outro_id))}</div></div>` });
}
async function dadosGrupo() {
  await recarregarParts();
  const c = conversa(), sou = c.sou_admin && !c.saiu;
  const ativos = ui.parts.filter(p => !p.saiu_em).sort((a, b) => (b.admin - a.admin) || chat.nomeDe(a.user_id).localeCompare(chat.nomeDe(b.user_id)));
  const md = modal({ title: 'Dados do grupo', body: `<div class="ch-perfil">${avatar(c.id, c.nome, true, 84)}<h3>${esc(c.nome)}</h3>
      <div class="muted">${esc(c.descricao || '')}</div><div class="small muted">Grupo · ${ativos.length} participantes</div></div>
    ${sou ? `<form class="form" id="dg-f"><label>Nome<input name="nome" maxlength="80" value="${esc(c.nome)}"></label><label>Descrição<input name="descricao" maxlength="500" value="${esc(c.descricao || '')}"></label>
      <label class="ch-check"><input type="checkbox" name="so" ${c.so_admins_escrevem ? 'checked' : ''}> Só administradores enviam mensagens (grupo de avisos)</label>
      <button class="btn small" type="submit">Salvar</button></form>` : ''}
    <div class="ch-part-topo"><strong>${ativos.length} participantes</strong>${sou ? '<button class="btn small" id="dg-add">+ Adicionar</button>' : ''}</div>
    <div class="ch-pessoas">${ativos.map(p => `<div class="ch-pessoa" data-u="${p.user_id}">${avatar(p.user_id, chat.nomeDe(p.user_id), false, 36)}
      <span style="flex:1"><strong>${esc(chat.nomeDe(p.user_id))}</strong><br><span class="small muted">${esc(papelDe(p.user_id))}</span></span>
      ${p.admin ? '<span class="badge pago">admin do grupo</span>' : ''}
      ${sou && p.user_id !== chat.eu() ? `<span class="ch-pessoa-acoes"><button class="btn ghost small" data-adm="${p.admin ? 0 : 1}">${p.admin ? 'Tirar admin' : 'Tornar admin'}</button><button class="btn ghost small neg" data-rem>Remover</button></span>` : ''}</div>`).join('')}</div>`,
    foot: !c.saiu ? '<button class="btn danger" id="dg-sair" style="margin-right:auto">Sair do grupo</button><button class="btn" data-close>Fechar</button>' : '<button class="btn" data-close>Fechar</button>' });
  const reabrir = async () => { md.close(); await chat.atualizarResumo(); await recarregarParts(); dadosGrupo(); };
  $('#dg-f', md.el) && ($('#dg-f', md.el).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await q(sb.rpc('chat_grupo_editar', { p_conversa: c.id, p_nome: f.nome.value, p_descricao: f.descricao.value, p_so_admins: f.so.checked })); toast('Grupo atualizado'); reabrir(); } catch (er) { fail(er); }
  });
  $('#dg-add', md.el) && ($('#dg-add', md.el).onclick = async () => {
    const m2 = modal({ title: 'Adicionar participantes', body: await listaPessoas({ multipla: true, excluir: ativos.map(p => p.user_id) }),
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ad-ok">Adicionar</button>' });
    ligarBuscaPessoas(m2.el);
    $('#ad-ok', m2.el).onclick = async () => {
      const users = $$('.ch-pessoa input:checked', m2.el).map(i => i.value); if (!users.length) return m2.close();
      try { await q(sb.rpc('chat_grupo_adicionar', { p_conversa: c.id, p_users: users })); m2.close(); reabrir(); } catch (er) { fail(er); }
    };
  });
  $('.ch-pessoas', md.el).onclick = async (e) => {
    const linha = e.target.closest('[data-u]'); if (!linha) return;
    const u = linha.dataset.u;
    try {
      if (e.target.closest('[data-adm]')) { await q(sb.rpc('chat_grupo_admin', { p_conversa: c.id, p_user: u, p_admin: e.target.closest('[data-adm]').dataset.adm === '1' })); reabrir(); }
      if (e.target.closest('[data-rem]') && await confirmDialog(`Remover ${chat.nomeDe(u)} do grupo?`)) { await q(sb.rpc('chat_grupo_remover', { p_conversa: c.id, p_user: u })); reabrir(); }
    } catch (er) { fail(er); }
  };
  $('#dg-sair', md.el) && ($('#dg-sair', md.el).onclick = async () => {
    if (!await confirmDialog('Sair deste grupo? Você continua vendo as mensagens até agora, mas não recebe as novas.')) return;
    try { await q(sb.rpc('chat_grupo_remover', { p_conversa: c.id, p_user: chat.eu() })); md.close(); await chat.atualizarResumo(); recarregarParts(); } catch (er) { fail(er); }
  });
}

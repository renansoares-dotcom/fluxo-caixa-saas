// Conversas: chat interno no estilo do WhatsApp (lista à esquerda, conversa à direita; no celular e no mini-chat, uma
// parte de cada vez). #/conversas?c=<id> abre uma conversa. O serviço (lib/chat.js) recebe em tempo real e envia;
// esta tela só desenha. A mesma tela roda dentro do mini-chat (render(root, { mini: true })).
import { sb, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, logoPNG } from '../lib/ui.js';
import { padronizarPDF, pdfCabecalho, pdfRodapes, pdfLimpo, PRETO } from '../lib/relatorio.js';
import * as chat from '../lib/chat.js';

export const title = 'Conversas';

const CORES = ['#0a8ed3', '#eb6834', '#4a3aa7', '#1baf7a', '#c98a00', '#d0578a', '#2e8b57', '#d64545', '#6f5bd6', '#0f9aa8'];
const corDe = (id) => { let h = 0; for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return CORES[h % CORES.length]; };
const iniciais = (n) => String(n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
const ICO_GRUPO = '<svg viewBox="0 0 24 24" width="55%" height="55%" fill="currentColor"><path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1a4.2 4.2 0 0 1 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z"/></svg>';
const ICO_REG = '<svg viewBox="0 0 24 24" width="52%" height="52%" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>';
const avatar = (id, nome, tipo = 'direta', tam = 42, on = false) => `<span class="ch-av${on ? ' on' : ''}" style="--av:${tipo === 'registro' ? '#667085' : corDe(id)};width:${tam}px;height:${tam}px;font-size:${Math.round(tam * 0.38)}px">${tipo === 'grupo' ? ICO_GRUPO : tipo === 'registro' ? ICO_REG : esc(iniciais(nome))}</span>`;
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
function vistoTxt(s) {
  if (!s) return '';
  const d = new Date(s), hoje = new Date(), ontem = new Date(Date.now() - 864e5);
  if (dia(d) === dia(hoje)) return `visto por último hoje às ${hora(s)}`;
  if (dia(d) === dia(ontem)) return `visto por último ontem às ${hora(s)}`;
  return `visto por último em ${d.toLocaleDateString('pt-BR')} às ${hora(s)}`;
}
const tamanho = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`);
const toqueGrosso = () => matchMedia('(pointer: coarse)').matches;
const ehAudio = (a) => /^audio\//.test(a?.mime || '');
const ehImg = (a) => /^image\//.test(a?.mime || '');
const PAPEL = { admin: 'Administrador', financeiro: 'Financeiro', diretor: 'Diretor', leitura: 'Leitura', compras: 'Compras', vendas: 'Vendas', producao: 'Produção' };
const papelDe = (uid) => PAPEL[chat.contatoDe(uid)?.papel] || '';
const REGISTRO = { lancamento: 'Lançamento', paraquedas: 'Pagamento antecipado', compras_pedido: 'Pedido de compra', prod_ordem: 'Ordem de produção', log_frete: 'Frete', fidc_proposta: 'Proposta FIDC' };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// *negrito* _itálico_ ~riscado~ `código`, links e menções (como no WhatsApp)
const RX_LINK = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])/gi;
const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function formatar(txt, mencoes = []) {
  const partes = String(txt).split(RX_LINK);
  let h = partes.map((p, i) => {
    if (i % 2) { const href = p.startsWith('www.') ? 'https://' + p : p; return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(p)}</a>`; }
    return esc(p)
      .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,!?:;])/g, '$1<strong>$2</strong>')
      .replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=$|[\s).,!?:;])/g, '$1<s>$2</s>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/(^|\s)(#\/[a-z0-9\-/?=&]+)/gi, '$1<a href="$2" data-interno>$2</a>');
  }).join('');
  for (const u of mencoes || []) {
    const n = u === chat.eu() ? chat.getMeuNome() : chat.nomeDe(u); if (!n) continue;
    h = h.replace(new RegExp('@' + rxEsc(esc(n)), 'g'), `<span class="cm-menc${u === chat.eu() ? ' eu' : ''}">@${esc(n)}</span>`);
  }
  return h.replace(/\n/g, '<br>');
}
const soEmoji = (t) => /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍|\s){1,12}$/u.test(t || '') && /\p{Extended_Pictographic}/u.test(t) && [...(t || '').replace(/\s/g, '')].length <= 8;
const previaMsg = (m) => !m ? '' : m.apagado_em ? '🚫 Mensagem apagada' : m.texto ? m.texto.replace(/\s+/g, ' ').slice(0, 120)
  : (m.chat_anexos || []).some(ehAudio) ? '🎤 Mensagem de voz' : (m.chat_anexos || []).some(ehImg) ? '📷 Foto' : m.chat_anexos?.length ? '📎 ' + m.chat_anexos[0].nome : m.cartao ? '🔗 Registro' : '';

const EMOJIS = ('😀 😁 😂 🤣 😊 😍 😘 😉 😎 🤩 🙂 🤔 😐 😅 😬 🙄 😴 😢 😭 😡 🤯 😱 🥳 🤝 👍 👎 👏 🙏 💪 👌 ✌️ 🤞 👋 🙌 ☝️ 👀 '
  + '❤️ 💙 💚 💛 🧡 💜 🖤 💔 🔥 ⭐ ✨ 🎉 🎂 🎁 ✅ ❌ ⚠️ ❗ ❓ 💯 🆗 🔔 📌 📎 📄 📊 📈 📉 💰 💵 💳 🧾 🏦 📦 🚚 🏭 ⚙️ 🛠️ 🧪 '
  + '📅 ⏰ ⏳ ☕ 🍕 🍔 🍺 ⚽ 🏆 🚀 💡 📞 📧 💻 📱 🖨️ 🔒 🔑 ☀️ 🌧️ 🌙 🇧🇷').split(' ');
const RAPIDAS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

let ui = null;          // estado da tela aberta (página ou mini-chat)

export async function render(root, { mini = false, abrirId = null } = {}) {
  if (ui && ui.root !== root) ui.desliga?.();
  root.classList.add(mini ? 'page-mini' : 'page-chat');
  ui = { root, mini, id: null, msgs: [], parts: [], favs: new Set(), fimHist: false, temNovas: false, carregando: false, filtro: 'todas', busca: '',
    arquivos: [], desliga: null, novasAbaixo: 0, resp: null, editando: null, mencoes: new Map(), gravador: null, achados: [], extras: {} };
  root.innerHTML = `<div class="ch${mini ? ' mini' : ''}" id="ch">
    <section class="ch-lado">
      <div class="ch-lado-topo"><strong>Conversas</strong>
        <div class="ch-acoes"><button class="btn ghost icon" id="ch-nova" title="Nova conversa" aria-label="Nova conversa"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 8v6M9 11h6"/></svg></button>
        <button class="btn ghost icon" id="ch-grupo" title="Novo grupo" aria-label="Novo grupo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5"/><path d="M19 8v6M16 11h6"/></svg></button>
        <div class="ch-menu-wrap"><button class="btn ghost icon" id="ch-lado-menu" aria-label="Mais opções">⋮</button><div class="ch-menu" id="ch-lado-m" hidden></div></div></div></div>
      <div class="ch-busca"><input id="ch-busca" type="search" placeholder="Pesquisar conversa ou mensagem" autocomplete="off"></div>
      <div class="ch-filtros" id="ch-filtros">${[['todas', 'Tudo'], ['nao_lidas', 'Não lidas'], ['grupos', 'Grupos'], ['registros', 'Registros'], ['arquivadas', 'Arquivadas']].map(([k, l]) => `<button class="ch-chip${k === 'todas' ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="ch-lista" id="ch-lista"><div class="loading">Carregando…</div></div>
    </section>
    <section class="ch-conv" id="ch-conv"><div class="ch-vazio"><div class="ch-vazio-ico">💬</div><h3>Conversas da equipe</h3><p class="muted">Escolha uma conversa à esquerda ou comece uma nova.<br>As mensagens ficam só entre quem participa.</p></div></section>
  </div>`;
  $('#ch-nova', root).onclick = novaConversa;
  $('#ch-grupo', root).onclick = () => novoGrupo();
  $('#ch-lado-menu', root).onclick = (e) => { e.stopPropagation(); menuLado(); };
  const buscarMsgs = debounce(async (t) => { if (!ui || ui.busca !== t) return; ui.achados = t.length >= 2 && chat.temEtapa2() ? await chat.buscar(t).catch(() => []) : []; if (ui && ui.busca === t) pintarLista(); }, 350);
  $('#ch-busca', root).oninput = (e) => { ui.busca = e.target.value.trim().toLowerCase(); ui.achados = []; pintarLista(); buscarMsgs(ui.busca); };
  $('#ch-filtros', root).onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; ui.filtro = b.dataset.f; $$('.ch-chip', root).forEach(x => x.classList.toggle('on', x === b)); pintarLista(); };

  if (!chat.chatPronto()) await chat.atualizarResumo(true);
  if (!chat.chatPronto()) {
    root.innerHTML = '<div class="card"><div class="empty">As Conversas ainda não foram ativadas no banco de dados. Peça ao administrador da plataforma.</div></div>';
    return;
  }
  $('[data-f="registros"]', root).hidden = !chat.temEtapa2();
  await chat.getContatos().catch(() => []);
  const desl = chat.ouvir(aoEvento);
  ui.desliga = () => { if (ui?.id) chat.sairDigitando(ui.id); desl(); chat.setAberta(null); window.removeEventListener('focus', aoFocar); document.removeEventListener('visibilitychange', aoFocar); document.removeEventListener('click', fecharFlutuantes, true); pararGravacao(true); };
  window.addEventListener('focus', aoFocar); document.addEventListener('visibilitychange', aoFocar);
  document.addEventListener('click', fecharFlutuantes, true);
  pintarLista();
  const id = abrirId || (!mini && new URLSearchParams(location.hash.split('?')[1] || '').get('c'));
  if (id) abrir(id, false);
}
export function fechar() { if (ui) { ui.desliga?.(); ui = null; } }
export function abrirConversa(id) { if (ui) abrir(id, false); }
export function reafirmar() { if (ui?.id && ui.root.isConnected) chat.setAberta(ui.id); }
export const telaAberta = () => (ui && ui.root.isConnected ? (ui.mini ? 'mini' : 'pagina') : null);

function vivo() { if (ui && !ui.root.isConnected) { ui.desliga?.(); ui = null; } return !!ui; }
function aoFocar() { if (vivo() && ui.id && !document.hidden && !ui.temNovas) chat.marcarLida(ui.id); }
function fecharFlutuantes(e) {
  if (!ui) return;
  if (!e.target.closest('.ch-menu-wrap')) $$('.ch-menu', ui.root).forEach(m => { m.hidden = true; });
  if (!e.target.closest('.ch-emoji-wrap')) { const p = $('#ch-emojis', ui.root); if (p) p.hidden = true; }
  if (!e.target.closest('.cm-acoes') && !e.target.closest('.cm-mais')) $$('.cm-acoes', ui.root).forEach(m => m.remove());
  if (!e.target.closest('.ch-mencao-pop') && !e.target.closest('#ch-txt')) $('#ch-mencao-pop', ui.root)?.remove();
}

function aoEvento(ev, d) {
  if (!vivo()) return;
  if (ev === 'resumo') { pintarLista(); if (ui.id) { pintarTopo(); pintarFixada(); } }
  else if (ev === 'mensagem' && d.conversa_id === ui.id) receber(d);
  else if (ev === 'mudou' && d.conversa_id === ui.id) atualizarMsg(d);
  else if (ev === 'reacao' && d && ui.msgs.some(m => m.id === d)) recarregarReacoes(d);
  else if (ev === 'participante' && d.conversa_id === ui.id) {
    const i = ui.parts.findIndex(p => p.user_id === d.user_id);
    if (i >= 0) ui.parts[i] = { ...ui.parts[i], ...d }; else ui.parts.push(d);
    pintarTicks(); pintarComposer();
  }
  else if (ev === 'fila' && d.conversa === ui.id) pintarPendente(d);
  else if (ev === 'enviada' && d.item.conversa === ui.id) { $(`[data-cliente="${d.item.clienteId}"]`, ui.root)?.remove(); receber(d.m); }
  else if (ev === 'conexao') { const t = $('#ch-off', ui.root); if (t) t.hidden = d === 'SUBSCRIBED'; }
  else if (ev === 'digitando') { if (d === ui.id) pintarSub(); pintarLista(); }
  else if (ev === 'presenca') { pintarSub(); pintarLista(); }
}

// ---------- lista ----------
function pintarLista() {
  const el = $('#ch-lista', ui.root); if (!el) return;
  let l = chat.getResumo();
  if (ui.filtro === 'arquivadas') l = l.filter(c => c.arquivada); else l = l.filter(c => !c.arquivada);
  if (ui.filtro === 'nao_lidas') l = l.filter(c => c.nao_lidas > 0);
  if (ui.filtro === 'grupos') l = l.filter(c => c.tipo === 'grupo');
  if (ui.filtro === 'registros') l = l.filter(c => c.tipo === 'registro');
  if (ui.busca) l = l.filter(c => `${c.nome} ${c.ultima_msg_texto || ''}`.toLowerCase().includes(ui.busca));
  const narq = chat.getResumo().filter(c => c.arquivada).length;
  let html = '';
  if (!l.length && !ui.achados.length) {
    html = `<div class="ch-lista-vazia muted">${ui.busca ? 'Nada encontrado.' : ui.filtro === 'arquivadas' ? 'Nenhuma conversa arquivada.' : ui.filtro === 'nao_lidas' ? 'Tudo lido 👍' : ui.filtro === 'registros' ? 'Nenhuma conversa de registro.<br><span class="small">Use o botão 💬 Conversa num lançamento, pedido de compra, OP, frete, proposta FIDC ou pagamento antecipado.</span>' : 'Nenhuma conversa ainda.<br><button class="btn small primary" id="ch-comecar">Começar uma conversa</button>'}</div>`;
  } else {
    if (ui.busca && l.length) html += '<div class="ch-sec">Conversas</div>';
    html += l.map(c => {
      const minha = c.ultima_msg_autor === chat.eu();
      const dig = chat.quemDigita(c.id);
      const prev = dig.length ? `<span class="ch-dig">${dig[0].acao === 'gravando' ? 'gravando áudio…' : 'digitando…'}</span>`
        : c.ultima_msg_texto ? `${minha ? 'Você: ' : c.tipo !== 'direta' && c.ultima_msg_autor_nome ? esc(c.ultima_msg_autor_nome.split(' ')[0]) + ': ' : ''}${esc(c.ultima_msg_texto)}`
        : `<span class="muted">${c.tipo === 'grupo' ? `${c.participantes} participantes` : c.tipo === 'registro' ? esc(REGISTRO[c.registro_tipo] || 'Registro') : 'Diga olá 👋'}</span>`;
      return `<button class="ch-item${c.id === ui.id ? ' on' : ''}${c.nao_lidas ? ' nl' : ''}" data-id="${c.id}">
        ${avatar(c.tipo === 'direta' ? c.outro_id : c.id, c.nome, c.tipo, 42, c.tipo === 'direta' && chat.estaOnline(c.outro_id))}
        <span class="ch-item-txt"><span class="ch-item-l1"><span class="ch-item-nome">${esc(c.nome || 'Conversa')}</span><span class="ch-item-hora">${quandoLista(c.ultima_msg_em)}</span></span>
        <span class="ch-item-l2"><span class="ch-item-prev">${prev}</span>
          <span class="ch-item-ico">${chat.silenciada(c) ? '<span title="Silenciada">🔕</span>' : ''}${c.fixada ? '<span title="Fixada">📌</span>' : ''}${c.mencoes ? '<span class="ch-arroba" title="Mencionaram você">@</span>' : ''}${c.nao_lidas ? `<span class="ch-nl${chat.silenciada(c) && !c.mencoes ? ' mudo' : ''}">${c.nao_lidas > 99 ? '99+' : c.nao_lidas}</span>` : ''}</span></span></span></button>`;
    }).join('');
    if (ui.achados.length) {
      html += '<div class="ch-sec">Mensagens</div>' + ui.achados.map(a => {
        const c = chat.getResumo().find(x => x.id === a.conversa_id);
        const t = esc(a.texto || '').replace(new RegExp(rxEsc(esc(ui.busca)), 'gi'), (x) => `<mark>${x}</mark>`);
        return `<button class="ch-item ch-achado" data-id="${a.conversa_id}" data-msg="${a.id}" data-t="${esc(a.criado_em)}"><span class="ch-item-txt"><span class="ch-item-l1"><span class="ch-item-nome">${esc(c?.nome || 'Conversa')}</span><span class="ch-item-hora">${quandoLista(a.criado_em)}</span></span>
          <span class="ch-item-prev">${a.autor_id === chat.eu() ? 'Você: ' : c?.tipo !== 'direta' ? esc(chat.nomeDe(a.autor_id).split(' ')[0]) + ': ' : ''}${t}</span></span></button>`;
      }).join('');
    }
    if (ui.filtro === 'todas' && narq && !ui.busca) html += `<button class="ch-arq-link" data-f="arquivadas">Arquivadas (${narq})</button>`;
  }
  el.innerHTML = html;
  $('#ch-comecar', el) && ($('#ch-comecar', el).onclick = novaConversa);
  el.onclick = (e) => {
    const a = e.target.closest('.ch-arq-link'); if (a) { $(`.ch-chip[data-f="arquivadas"]`, ui.root).click(); return; }
    const it = e.target.closest('.ch-item'); if (!it) return;
    if (it.dataset.msg) irParaMsg(it.dataset.id, it.dataset.msg, it.dataset.t); else abrir(it.dataset.id);
  };
}
function menuLado() {
  const m = $('#ch-lado-m', ui.root);
  const itens = [['favoritas', '⭐ Mensagens favoritas']];
  if (chat.temEtapa2()) itens.push(['visto', `${chat.getMostrarVisto() ? '✔ ' : ''}Mostrar meu "visto por último"`]);
  if (ui.mini) itens.push(['tela', 'Abrir em tela cheia']);
  m.innerHTML = itens.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join(''); m.hidden = false;
  m.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return; m.hidden = true;
    if (k === 'favoritas') favoritas();
    if (k === 'tela') irLink('#/conversas' + (ui.id ? '?c=' + ui.id : ''));
    if (k === 'visto') {
      const sim = !chat.getMostrarVisto();
      try { await chat.setMostrarVisto(sim); toast(sim ? 'Seu "visto por último" e o online aparecem para os outros' : 'Seu "visto por último" e o online não aparecem mais. Você também não vê o dos outros.'); } catch (er) { fail(er); }
    }
  };
}

// ---------- conversa ----------
function conversa() { return chat.getResumo().find(x => x.id === ui.id) || {}; }
const SEL_PART = 'conversa_id, user_id, admin, entrou_em, saiu_em, entregue_ate, lida_ate';
async function abrir(id, empilhar = true, ate = null) {
  if (!vivo()) return;
  if (!chat.getResumo().find(x => x.id === id)) { await chat.atualizarResumo(); if (!chat.getResumo().find(x => x.id === id)) { toast('Conversa não encontrada', true); return; } }
  if (ui.id && ui.id !== id) chat.sairDigitando(ui.id);
  pararGravacao(true);
  Object.assign(ui, { id, msgs: [], parts: [], favs: new Set(), fimHist: false, temNovas: false, arquivos: [], novasAbaixo: 0, resp: null, editando: null, mencoes: new Map(), extras: {} });
  chat.setAberta(id); chat.entrarDigitando(id);
  if (!ui.mini) { const url = `#/conversas?c=${id}`; if (location.hash !== url) history[empilhar ? 'pushState' : 'replaceState'](null, '', url); }
  $('#ch', ui.root).classList.add('aberta');
  $$('.ch-item', ui.root).forEach(x => x.classList.toggle('on', x.dataset.id === id && !x.dataset.msg));
  const conv = $('#ch-conv', ui.root);
  conv.innerHTML = `<header class="ch-topo" id="ch-topo"></header>
    <div class="ch-fixada" id="ch-fixada" hidden></div>
    <div class="ch-off small" id="ch-off" hidden>Reconectando… as mensagens novas podem demorar a aparecer.</div>
    <div class="ch-msgs" id="ch-msgs"><div class="loading">Carregando…</div></div>
    <button class="ch-descer" id="ch-descer" hidden aria-label="Ir para o fim">⌄<span class="ch-nl" id="ch-descer-n" hidden></span></button>
    <div class="ch-barra" id="ch-barra" hidden></div>
    <div class="ch-anexos" id="ch-anexos" hidden></div>
    <footer class="ch-composer" id="ch-composer"></footer>
    <div class="ch-soltar" id="ch-soltar" hidden>Solte os arquivos para enviar</div>`;
  pintarTopo(); pintarComposer();
  try {
    const sel = chat.selectMsg();
    let msgs, novas = [];
    if (ate) {
      [msgs, novas] = await Promise.all([
        q(sb.from('chat_mensagens').select(sel).eq('conversa_id', id).lte('criado_em', ate).order('criado_em', { ascending: false }).limit(40)),
        q(sb.from('chat_mensagens').select(sel).eq('conversa_id', id).gt('criado_em', ate).order('criado_em', { ascending: true }).limit(40))]);
    } else msgs = await q(sb.from('chat_mensagens').select(sel).eq('conversa_id', id).order('criado_em', { ascending: false }).limit(50));
    const [parts, favs] = await Promise.all([
      q(sb.from('chat_participantes').select(SEL_PART).eq('conversa_id', id)),
      chat.temEtapa2() ? q(sb.from('chat_favoritas').select('mensagem_id').eq('conversa_id', id)).catch(() => []) : []]);
    if (ui?.id !== id) return;
    ui.msgs = msgs.reverse().concat(novas); ui.parts = parts; ui.fimHist = msgs.length < (ate ? 40 : 50); ui.temNovas = novas.length === 40;
    ui.favs = new Set((favs || []).map(f => f.mensagem_id));
  } catch (e) { fail(e); return; }
  const cAtual = conversa();
  ui.primeiraNaoLida = !ate && cAtual?.nao_lidas ? ui.msgs.filter(m => m.autor_id !== chat.eu() && m.tipo !== 'sistema').slice(-cAtual.nao_lidas)[0]?.id : null;
  pintarTopo(); pintarComposer(); pintarFixada();
  await pintarMsgs(!ate);
  if (!ui.temNovas) chat.marcarLida(id);
  const box = $('#ch-msgs', ui.root);
  box.onscroll = () => {
    if (box.scrollTop < 80) carregarAntigas();
    const fim = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (fim < 80 && ui.temNovas) carregarNovas();
    $('#ch-descer', ui.root).hidden = fim < 120 && !ui.temNovas;
    if (fim < 120 && ui.novasAbaixo && !ui.temNovas) { ui.novasAbaixo = 0; pintarDescer(); }
  };
  $('#ch-descer', ui.root).onclick = () => { if (ui.temNovas) { abrir(ui.id, false); return; } box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); ui.novasAbaixo = 0; pintarDescer(); };
  ligarSoltar(conv);
  ligarMsgs(box);
  if (!toqueGrosso() && !ate) setTimeout(() => $('#ch-txt', ui.root)?.focus(), 50);
}
async function irParaMsg(conv, msg, quando) {
  if (ui.id === conv && ui.msgs.some(m => m.id === msg)) return piscar(msg);
  await abrir(conv, true, quando);
  piscar(msg);
}
function piscar(id) {
  const el = $(`.cm[data-id="${id}"]`, ui.root); if (!el) { toast('Mensagem não encontrada (pode ter sido apagada)'); return; }
  el.scrollIntoView({ block: 'center' }); el.classList.add('piscar'); setTimeout(() => el.classList.remove('piscar'), 1600);
}
function pintarDescer() { const n = $('#ch-descer-n', ui.root); if (n) { n.hidden = !ui.novasAbaixo; n.textContent = ui.novasAbaixo; } }

function pintarTopo() {
  const t = $('#ch-topo', ui.root); if (!t) return;
  const c = conversa();
  t.innerHTML = `<button class="btn ghost icon ch-voltar" id="ch-voltar" aria-label="Voltar">←</button>
    <button class="ch-topo-quem" id="ch-quem">${avatar(c.tipo === 'direta' ? c.outro_id : c.id, c.nome, c.tipo, 38)}
      <span class="ch-topo-txt"><strong>${esc(c.nome || 'Conversa')}</strong><span class="small muted ch-topo-sub" id="ch-sub"></span></span></button>
    <span class="ch-topo-ico">${chat.silenciada(c) ? '🔕' : ''}</span>
    ${c.tipo === 'registro' ? '<button class="btn small" id="ch-abrir-reg" title="Abrir o registro">Abrir registro</button>' : ''}
    <div class="ch-menu-wrap"><button class="btn ghost icon" id="ch-menu-btn" aria-label="Mais opções">⋮</button><div class="ch-menu" id="ch-menu" hidden></div></div>`;
  $('#ch-voltar', t).onclick = () => {
    chat.sairDigitando(ui.id); pararGravacao(true);
    $('#ch', ui.root).classList.remove('aberta'); ui.id = null; chat.setAberta(null);
    if (!ui.mini) history.pushState(null, '', '#/conversas');
    pintarLista();
  };
  $('#ch-quem', t).onclick = () => dadosConversa();
  $('#ch-menu-btn', t).onclick = (e) => { e.stopPropagation(); abrirMenu(); };
  $('#ch-abrir-reg', t) && ($('#ch-abrir-reg', t).onclick = async () => {
    const info = (await chat.infoCartoes([{ tipo: c.registro_tipo, id: c.registro_id }]))({ tipo: c.registro_tipo, id: c.registro_id });
    if (!info) return toast('Você não tem acesso a este registro', true);
    irLink(info.link);
  });
  pintarSub();
}
function pintarSub() {
  const s = $('#ch-sub', ui.root); if (!s || !ui.id) return;
  const c = conversa(), dig = chat.quemDigita(ui.id);
  if (dig.length) {
    const g = dig.some(d => d.acao === 'gravando');
    s.innerHTML = `<span class="ch-dig">${c.tipo === 'direta' ? (g ? 'gravando áudio…' : 'digitando…') : esc(dig.map(d => chat.nomeDe(d.u).split(' ')[0]).join(', ')) + (g ? ' gravando áudio…' : dig.length > 1 ? ' estão digitando…' : ' está digitando…')}</span>`;
    return;
  }
  if (c.tipo === 'direta') { s.textContent = chat.estaOnline(c.outro_id) ? 'online' : vistoTxt(chat.contatoDe(c.outro_id)?.visto_em) || papelDe(c.outro_id); return; }
  if (c.tipo === 'registro') { s.textContent = `${REGISTRO[c.registro_tipo] || 'Registro'}${c.descricao ? ' · ' + c.descricao : ''}`; return; }
  const ativos = ui.parts.filter(p => !p.saiu_em);
  s.textContent = ativos.length ? ativos.map(p => chat.nomeDe(p.user_id)).sort((a, b) => (a === 'Você') - (b === 'Você') || a.localeCompare(b)).join(', ') : `${c.participantes || ''} participantes`;
}
function irLink(link) {
  if (!link) return;
  if (ui?.mini) document.dispatchEvent(new CustomEvent('mini-chat-fechar'));
  location.hash = link;
}

function abrirMenu() {
  const m = $('#ch-menu', ui.root), c = conversa();
  const itens = [
    ['dados', c.tipo === 'grupo' ? 'Dados do grupo' : c.tipo === 'registro' ? 'Dados da conversa' : 'Dados do contato'],
    ['midia', 'Mídia, documentos e links'],
    chat.silenciada(c) ? ['som', 'Ativar som'] : ['silenciar', 'Silenciar…'],
    [c.fixada ? 'desafixar' : 'fixar', c.fixada ? 'Desafixar conversa' : 'Fixar conversa no topo'],
    [c.arquivada ? 'desarquivar' : 'arquivar', c.arquivada ? 'Desarquivar' : 'Arquivar'],
    ['pdf', 'Exportar conversa (PDF)'],
  ];
  if (c.tipo === 'registro' && !c.saiu) itens.push(['add', 'Adicionar pessoa']);
  if (c.tipo !== 'direta' && !c.saiu) itens.push(['sair', c.tipo === 'grupo' ? 'Sair do grupo' : 'Sair da conversa']);
  m.innerHTML = itens.map(([k, l]) => `<button data-k="${k}"${k === 'sair' ? ' class="neg"' : ''}>${l}</button>`).join('');
  m.hidden = false;
  m.onclick = async (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
    m.hidden = true;
    try {
      if (k === 'silenciar') return silenciar();
      if (k === 'som') await chat.preferencias(ui.id, { tirar_silencio: true });
      if (k === 'fixar' || k === 'desafixar') await chat.preferencias(ui.id, { fixada: k === 'fixar' });
      if (k === 'arquivar' || k === 'desarquivar') { await chat.preferencias(ui.id, { arquivada: k === 'arquivar' }); toast(k === 'arquivar' ? 'Conversa arquivada. Volta para a lista quando chegar mensagem.' : 'Conversa desarquivada'); }
      if (k === 'dados') dadosConversa();
      if (k === 'midia') dadosConversa('midia');
      if (k === 'pdf') exportarPDF();
      if (k === 'add') adicionarPessoas();
      if (k === 'sair') { if (await confirmDialog('Sair desta conversa? Você continua vendo as mensagens até agora, mas não recebe as novas.')) { await q(sb.rpc('chat_grupo_remover', { p_conversa: ui.id, p_user: chat.eu() })); await chat.atualizarResumo(); recarregarParts(); } }
      pintarTopo();
    } catch (er) { fail(er); }
  };
}
function silenciar() {
  const md = modal({ title: 'Silenciar conversa', body: `<p class="muted" style="margin-top:0">Sem som e sem aviso no celular para esta conversa. As mensagens continuam chegando, e quem mencionar você com @ ainda avisa.</p>
    <div class="ch-opcoes">${[['8', '8 horas'], ['168', '1 semana'], ['sempre', 'Sempre']].map(([v, l], i) => `<label class="ch-opcao"><input type="radio" name="sil" value="${v}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="sil-ok">Silenciar</button>' });
  $('#sil-ok', md.el).onclick = async () => {
    const v = $('input[name=sil]:checked', md.el).value;
    const ate = v === 'sempre' ? '9999-12-31T00:00:00Z' : new Date(Date.now() + +v * 3600e3).toISOString();
    try { await chat.preferencias(ui.id, { silenciada_ate: ate }); md.close(); pintarTopo(); } catch (e) { fail(e); }
  };
}
async function recarregarParts() {
  if (!ui?.id) return;
  try { ui.parts = await q(sb.from('chat_participantes').select(SEL_PART).eq('conversa_id', ui.id)); } catch {}
  pintarTopo(); pintarComposer(); pintarTicks();
}
function pintarFixada() {
  const f = $('#ch-fixada', ui.root); if (!f) return;
  const c = conversa(); const id = c.msg_fixada;
  if (!id) { f.hidden = true; return; }
  const m = ui.msgs.find(x => x.id === id) || ui.extras[id];
  f.hidden = false;
  f.innerHTML = `<button class="ch-fixada-txt" id="ch-fix-ir">📌 <span>${esc(m ? previaMsg(m) : 'Mensagem fixada')}</span></button>${podeEscrever() ? '<button class="btn ghost icon small" id="ch-fix-x" title="Desafixar" aria-label="Desafixar">✕</button>' : ''}`;
  $('#ch-fix-ir', f).onclick = async () => {
    if (ui.msgs.some(x => x.id === id)) return piscar(id);
    try { const mm = await q(sb.from('chat_mensagens').select('id, criado_em').eq('id', id).maybeSingle()); if (mm) irParaMsg(ui.id, id, mm.criado_em); } catch (e) { fail(e); }
  };
  $('#ch-fix-x', f) && ($('#ch-fix-x', f).onclick = async () => { try { await chat.fixarMsg(ui.id, null); await chat.atualizarResumo(); } catch (e) { fail(e); } });
  if (!m) q(sb.from('chat_mensagens').select(chat.selectMsg()).eq('id', id).maybeSingle()).then(x => { if (x && ui) { ui.extras[id] = x; pintarFixada(); } }, () => {});
}

// ---------- mensagens ----------
function htmlMsg(m, ant) {
  if (m.tipo === 'sistema') return `<div class="cm-sis" data-id="${m.id}"><span>${esc(m.texto)}</span></div>`;
  const c = conversa(), minha = m.autor_id === chat.eu();
  const cont = ant && ant.tipo !== 'sistema' && ant.autor_id === m.autor_id && dia(ant.criado_em) === dia(m.criado_em) && ts(m.criado_em) - ts(ant.criado_em) < 5 * 60e3;
  const autor = c.tipo !== 'direta' && !minha && !cont ? `<div class="cm-autor" style="color:${corDe(m.autor_id)}">${esc(chat.nomeDe(m.autor_id))}</div>` : '';
  const meta = `<span class="cm-meta">${ui.favs.has(m.id) && !m.apagado_em ? '<span title="Favorita">★</span>' : ''}${m.editado_em && !m.apagado_em ? '<span class="cm-edit">editada</span>' : ''}${hora(m.criado_em)}${minha && !m.apagado_em ? `<span class="cm-tick" data-tick>${tick(m)}</span>` : ''}</span>`;
  const mais = chat.temEtapa2() ? '<button class="cm-mais" aria-label="Opções da mensagem" title="Opções">⌄</button>' : '';
  if (m.apagado_em) return `<div class="cm${minha ? ' eu' : ''}${cont ? ' cont' : ''}" data-id="${m.id}"><div class="cm-bolha apagada">${mais}${autor}<div class="cm-texto">🚫 <em>${minha ? 'Você apagou esta mensagem' : 'Esta mensagem foi apagada'}</em></div>${meta}</div></div>`;
  const anexos = (m.chat_anexos || []);
  const imgs = anexos.filter(ehImg), audios = anexos.filter(ehAudio), docs = anexos.filter(a => !ehImg(a) && !ehAudio(a));
  const grande = !anexos.length && !m.cartao && !m.resposta_a && soEmoji(m.texto);
  const so = imgs.length && !m.texto && !docs.length && !audios.length && !m.resposta_a && !m.encaminhada;
  return `<div class="cm${minha ? ' eu' : ''}${cont ? ' cont' : ''}" data-id="${m.id}" data-t="${esc(m.criado_em)}">
    <div class="cm-bolha${grande ? ' emoji' : ''}${so ? ' so-img' : ''}">
      ${mais}${autor}
      ${m.encaminhada ? '<div class="cm-enc">↪ <em>Encaminhada</em></div>' : ''}
      ${m.resposta_a ? htmlCitacao(m.resposta_a) : ''}
      ${m.cartao ? `<button class="cm-cartao" data-tipo="${esc(m.cartao.tipo)}" data-rid="${esc(m.cartao.id)}"><span class="cm-cartao-ico">${ICO_REG}</span><span class="cm-cartao-txt"><strong>${esc(REGISTRO[m.cartao.tipo] || 'Registro')}</strong><span class="small muted">carregando…</span></span></button>` : ''}
      ${imgs.length ? `<div class="cm-imgs n${Math.min(imgs.length, 4)}">${imgs.map(a => `<button class="cm-img" data-caminho="${esc(a.caminho)}" data-nome="${esc(a.nome)}" style="${a.largura && imgs.length === 1 ? `aspect-ratio:${a.largura}/${a.altura}` : ''}"><span class="cm-img-load"></span></button>`).join('')}</div>` : ''}
      ${audios.map(a => `<div class="cm-audio" data-caminho="${esc(a.caminho)}">${avatar(m.autor_id, chat.nomeDe(m.autor_id), 'direta', 34)}<button class="cm-audio-play" aria-label="Tocar">▶</button><div class="cm-audio-barra"><input type="range" min="0" max="1000" value="0" aria-label="Posição"><span class="small muted cm-audio-t">0:00</span></div><button class="cm-audio-vel" title="Velocidade">1×</button></div>`).join('')}
      ${docs.map(a => `<button class="cm-doc" data-caminho="${esc(a.caminho)}" data-nome="${esc(a.nome)}"><span class="cm-doc-ico">${icoDoc(a)}</span><span class="cm-doc-txt"><span class="cm-doc-nome">${esc(a.nome)}</span><span class="small muted">${esc(extDe(a.nome))} · ${tamanho(a.tamanho)}</span></span><span class="cm-doc-baixar">⬇</span></button>`).join('')}
      ${m.texto ? `<div class="cm-texto">${formatar(m.texto, m.mencoes)}</div>` : ''}
      ${meta}
    </div>${htmlReacoes(m)}</div>`;
}
function htmlCitacao(id) {
  const o = ui.msgs.find(x => x.id === id) || ui.extras[id];
  if (!o) return `<button class="cm-cit" data-ir="${id}"><span class="cm-cit-txt small muted">Mensagem respondida</span></button>`;
  return `<button class="cm-cit" data-ir="${id}" style="--cit:${corDe(o.autor_id)}"><strong>${esc(chat.nomeDe(o.autor_id))}</strong><span class="cm-cit-txt">${esc(previaMsg(o))}</span></button>`;
}
function htmlReacoes(m) {
  const r = m.chat_reacoes || []; if (!r.length) return '';
  const g = {}; for (const x of r) (g[x.emoji] ||= []).push(x.user_id);
  return `<div class="cm-reacoes">${Object.entries(g).map(([e, us]) => `<button class="cm-reacao${us.includes(chat.eu()) ? ' minha' : ''}" data-emo="${esc(e)}" title="${esc(us.map(chat.nomeDe).join(', '))}">${e}${us.length > 1 ? `<span>${us.length}</span>` : ''}</button>`).join('')}</div>`;
}
const extDe = (n) => (String(n).match(/\.(\w{1,6})$/)?.[1] || 'arquivo').toUpperCase();
function icoDoc(a) {
  const e = extDe(a.nome);
  const cor = { PDF: '#d64545', XML: '#0a8ed3', XLSX: '#1baf7a', XLS: '#1baf7a', CSV: '#1baf7a', DOCX: '#2b5598', DOC: '#2b5598', ZIP: '#8a6d3b', OFX: '#4a3aa7' }[e] || '#667085';
  return `<span style="background:${cor}">${esc(e.slice(0, 4))}</span>`;
}
// ✓ enviada · ✓✓ entregue a todos · ✓✓ azul lida por todos
function outrosDa(m) { const t = ts(m.criado_em); return ui.parts.filter(p => p.user_id !== chat.eu() && ts(p.entrou_em) <= t + 1000 && (!p.saiu_em || ts(p.saiu_em) >= t)); }
function estadoMsg(m) {
  const t = ts(m.criado_em), outros = outrosDa(m);
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

async function pintarMsgs(rolarFim = false) {
  const box = $('#ch-msgs', ui.root); if (!box) return;
  await completarCitacoes(ui.msgs);
  if (!ui) return;
  let html = ui.fimHist ? `<div class="cm-inicio small muted">${conversa().tipo === 'direta' ? 'Início da conversa' : 'Início das mensagens'} · as mensagens ficam só entre quem participa 🔒</div>` : '<div class="cm-inicio small muted">Carregando mensagens anteriores…</div>';
  let ant = null;
  for (const m of ui.msgs) {
    if (!ant || dia(ant.criado_em) !== dia(m.criado_em)) { html += `<div class="cm-dia"><span>${rotuloDia(m.criado_em)}</span></div>`; ant = null; }
    if (m.id === ui.primeiraNaoLida) html += '<div class="cm-novas" id="cm-novas"><span>Mensagens não lidas</span></div>';
    html += htmlMsg(m, ant); ant = m;
  }
  html += `<div id="cm-pend"></div>${ui.temNovas ? '<div class="cm-inicio small muted">Role para ver as mensagens mais novas…</div>' : ''}`;
  box.innerHTML = html;
  for (const it of chat.getFila(ui.id)) pintarPendente(it, false);
  aposPintar(box);
  if (rolarFim) {
    const nv = $('#cm-novas', box);
    requestAnimationFrame(() => { if (nv) nv.scrollIntoView({ block: 'center' }); else box.scrollTop = box.scrollHeight; });
  }
}
function aposPintar(box) { carregarImagens(box); pintarCartoes(box); }

// mensagens respondidas que não estão carregadas: busca para mostrar a citação
async function completarCitacoes(lista) {
  const falta = [...new Set(lista.map(m => m.resposta_a).filter(id => id && !ui.msgs.some(x => x.id === id) && !ui.extras[id]))];
  if (!falta.length) return;
  try { for (const m of await q(sb.from('chat_mensagens').select(chat.selectMsg()).in('id', falta))) ui.extras[m.id] = m; } catch {}
}
async function pintarCartoes(box) {
  const els = $$('.cm-cartao:not([data-ok])', box); if (!els.length) return;
  els.forEach(e => e.dataset.ok = '1');
  const info = await chat.infoCartoes(els.map(e => ({ tipo: e.dataset.tipo, id: e.dataset.rid })));
  for (const e of els) {
    const i = info({ tipo: e.dataset.tipo, id: e.dataset.rid });
    const t = $('.cm-cartao-txt', e);
    if (!i) { t.innerHTML = `<strong>${esc(REGISTRO[e.dataset.tipo] || 'Registro')}</strong><span class="small muted">Você não tem acesso a este registro</span>`; e.disabled = true; continue; }
    e.dataset.link = i.link; t.innerHTML = `<strong>${esc(i.titulo)}</strong><span class="small muted">${esc(i.sub || '')}</span>`;
  }
}

async function carregarAntigas() {
  if (ui.fimHist || ui.carregando || !ui.msgs.length) return;
  ui.carregando = true;
  const id = ui.id, box = $('#ch-msgs', ui.root);
  try {
    const mais = await q(sb.from('chat_mensagens').select(chat.selectMsg()).eq('conversa_id', id).lt('criado_em', ui.msgs[0].criado_em).order('criado_em', { ascending: false }).limit(50));
    if (ui?.id !== id) return;
    ui.fimHist = mais.length < 50;
    const antes = box.scrollHeight, topo = box.scrollTop;
    ui.msgs = mais.reverse().concat(ui.msgs);
    await pintarMsgs();
    box.scrollTop = box.scrollHeight - antes + topo;
  } catch (e) { fail(e); } finally { if (ui) ui.carregando = false; }
}
async function carregarNovas() {
  if (!ui.temNovas || ui.carregando) return;
  ui.carregando = true;
  const id = ui.id, box = $('#ch-msgs', ui.root);
  try {
    const mais = await q(sb.from('chat_mensagens').select(chat.selectMsg()).eq('conversa_id', id).gt('criado_em', ui.msgs[ui.msgs.length - 1].criado_em).order('criado_em', { ascending: true }).limit(50));
    if (ui?.id !== id) return;
    ui.temNovas = mais.length === 50;
    const topo = box.scrollTop;
    ui.msgs = ui.msgs.concat(mais);
    await pintarMsgs(); box.scrollTop = topo;
    if (!ui.temNovas) { ui.novasAbaixo = 0; pintarDescer(); chat.marcarLida(id); }
  } catch (e) { fail(e); } finally { if (ui) ui.carregando = false; }
}

async function receber(m) {
  if (!ui?.id || m.conversa_id !== ui.id) return;
  if (ui.msgs.some(x => x.id === m.id)) return atualizarMsg(m);
  if (m.cliente_id) $(`[data-cliente="${m.cliente_id}"]`, ui.root)?.remove();
  if (ui.temNovas) { if (m.autor_id === chat.eu()) return abrir(ui.id, false); ui.novasAbaixo++; pintarDescer(); $('#ch-descer', ui.root).hidden = false; return; }      // lendo mensagens antigas: só avisa
  await completarCitacoes([m]);
  if (!ui?.id || ui.msgs.some(x => x.id === m.id)) return;
  const box = $('#ch-msgs', ui.root);
  const perto = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const ant = ui.msgs[ui.msgs.length - 1];
  ui.msgs.push(m);
  if (m.tipo === 'sistema') recarregarParts();
  const pend = $('#cm-pend', box);
  let html = '';
  if (!ant || dia(ant.criado_em) !== dia(m.criado_em)) html += `<div class="cm-dia"><span>${rotuloDia(m.criado_em)}</span></div>`;
  html += htmlMsg(m, ant && dia(ant.criado_em) === dia(m.criado_em) ? ant : null);
  pend.insertAdjacentHTML('beforebegin', html);
  aposPintar(box);
  const minha = m.autor_id === chat.eu();
  if (perto || minha) box.scrollTop = box.scrollHeight;
  else { ui.novasAbaixo++; pintarDescer(); $('#ch-descer', ui.root).hidden = false; }
  if (!minha) chat.marcarLida(ui.id);
}
function trocarMsg(m) {
  const i = ui.msgs.findIndex(x => x.id === m.id); if (i < 0) return;
  ui.msgs[i] = m;
  const el = $(`.cm[data-id="${m.id}"]`, ui.root); if (!el) return;
  const ant = i > 0 && dia(ui.msgs[i - 1].criado_em) === dia(m.criado_em) ? ui.msgs[i - 1] : null;
  el.outerHTML = htmlMsg(m, ant);
  aposPintar($('#ch-msgs', ui.root));
}
function atualizarMsg(m) { if (!ui?.id || m.conversa_id !== ui.id) return; trocarMsg(m); if (conversa().msg_fixada === m.id) pintarFixada(); }
async function recarregarReacoes(id) {
  try { const r = await q(sb.from('chat_reacoes').select('user_id, emoji').eq('mensagem_id', id)); const m = ui?.msgs.find(x => x.id === id); if (m) trocarMsg({ ...m, chat_reacoes: r }); } catch {}
}

function pintarPendente(it, rolar = true) {
  if (!ui?.id) return;
  const pend = $('#cm-pend', ui.root); if (!pend) return;
  let el = $(`[data-cliente="${it.clienteId}"]`, ui.root);
  if (it.status === 'descartado' || it.status === 'enviada') { el?.remove(); return; }
  const icone = it.status === 'falhou' ? '<span class="tk erro" title="Não enviada">!</span>' : '<span class="tk" title="Enviando">🕓</span>';
  const arqs = (it.arquivos.length ? it.arquivos : (it.anexos || [])).map(f => `<div class="cm-doc pend"><span class="cm-doc-ico"><span style="background:#667085">${esc(extDe(f.name || f.nome).slice(0, 4))}</span></span><span class="cm-doc-txt"><span class="cm-doc-nome">${esc(f.name || f.nome)}</span><span class="small muted">${tamanho(f.size ?? f.tamanho)}</span></span></div>`).join('');
  const html = `<div class="cm eu pend" data-cliente="${it.clienteId}"><div class="cm-bolha">${it.extra?.encaminhada ? '<div class="cm-enc">↪ <em>Encaminhada</em></div>' : ''}${it.extra?.resposta_a ? htmlCitacao(it.extra.resposta_a) : ''}${arqs}${it.texto ? `<div class="cm-texto">${formatar(it.texto)}</div>` : ''}
    <span class="cm-meta">${hora(it.criado_em)}${icone}</span>
    ${it.status === 'falhou' || it.status === 'aguardando' ? `<div class="cm-erro small">${esc(it.erro || '')}${it.status === 'falhou' ? ' <button class="btn link small" data-re>Tentar de novo</button> <button class="btn link small" data-desc>Descartar</button>' : ''}</div>` : ''}</div></div>`;
  if (el) el.outerHTML = html; else pend.insertAdjacentHTML('beforeend', html);
  el = $(`[data-cliente="${it.clienteId}"]`, ui.root);
  $('[data-re]', el) && ($('[data-re]', el).onclick = () => chat.reenviar(it.clienteId));
  $('[data-desc]', el) && ($('[data-desc]', el).onclick = () => chat.descartar(it.clienteId));
  if (rolar) { const box = $('#ch-msgs', ui.root); box.scrollTop = box.scrollHeight; }
}

// ---------- cliques dentro das mensagens ----------
function ligarMsgs(box) {
  box.onclick = async (e) => {
    const mais = e.target.closest('.cm-mais'); if (mais) { e.stopPropagation(); return menuMsg(mais.closest('.cm').dataset.id, mais); }
    const ac = e.target.closest('.cm-acoes [data-a]'); if (ac) return acaoMsg(ac.dataset.a, ac.closest('.cm-acoes').dataset.id, ac.dataset.emo);
    const cit = e.target.closest('.cm-cit'); if (cit) { if (ui.msgs.some(x => x.id === cit.dataset.ir)) return piscar(cit.dataset.ir); const x = ui.extras[cit.dataset.ir]; if (x) return irParaMsg(ui.id, x.id, x.criado_em); return; }
    const reac = e.target.closest('.cm-reacao'); if (reac) return quemReagiu(reac.closest('.cm').dataset.id);
    const card = e.target.closest('.cm-cartao'); if (card) { if (card.dataset.link) irLink(card.dataset.link); return; }
    const int = e.target.closest('a[data-interno]'); if (int && ui.mini) { e.preventDefault(); irLink(int.getAttribute('href')); return; }
    const play = e.target.closest('.cm-audio-play'); if (play) return tocarAudio(play.closest('.cm-audio'));
    const vel = e.target.closest('.cm-audio-vel'); if (vel) { const a = vel.closest('.cm-audio'); const v = { '1×': '1,5×', '1,5×': '2×', '2×': '1×' }[vel.textContent] || '1×'; vel.textContent = v; if (a._audio) a._audio.playbackRate = parseFloat(v.replace(',', '.')); return; }
    const im = e.target.closest('.cm-img'); const dc = e.target.closest('.cm-doc:not(.pend)');
    if (!im && !dc) return;
    const el = im || dc;
    const { [el.dataset.caminho]: u } = await chat.urlsAnexos([el.dataset.caminho]);
    if (!u) return toast('Arquivo indisponível', true);
    if (im) {
      modal({ title: el.dataset.nome, wide: true, body: `<div class="ch-foto"><img src="${esc(u)}" alt="${esc(el.dataset.nome)}"></div>`,
        foot: `<a class="btn" href="${esc(u)}&download=${encodeURIComponent(el.dataset.nome)}">Baixar</a><a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Abrir em nova aba</a><button class="btn primary" data-close>Fechar</button>` });
      return;
    }
    if (/\.pdf$/i.test(el.dataset.nome)) window.open(u, '_blank', 'noopener');
    else { const a = document.createElement('a'); a.href = `${u}&download=${encodeURIComponent(el.dataset.nome)}`; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
  };
  box.oninput = (e) => { const r = e.target.closest('.cm-audio input[type=range]'); if (r) { const a = r.closest('.cm-audio')._audio; if (a?.duration) a.currentTime = (+r.value / 1000) * a.duration; } };
  // celular: segurar a mensagem abre as opções
  let tmr = null;
  box.ontouchstart = (e) => { const m = e.target.closest('.cm[data-id]'); if (!m || !chat.temEtapa2() || e.target.closest('button, a, input')) return; tmr = setTimeout(() => { navigator.vibrate?.(20); menuMsg(m.dataset.id, m.querySelector('.cm-bolha')); }, 480); };
  box.ontouchend = box.ontouchmove = () => clearTimeout(tmr);
}
const durTxt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
async function tocarAudio(el) {
  $$('.cm-audio', ui.root).forEach(x => { if (x !== el && x._audio && !x._audio.paused) x._audio.pause(); });
  if (!el._audio) {
    const { [el.dataset.caminho]: u } = await chat.urlsAnexos([el.dataset.caminho]);
    if (!u) return toast('Áudio indisponível', true);
    const a = new Audio(u); el._audio = a; a.playbackRate = parseFloat($('.cm-audio-vel', el).textContent.replace(',', '.')) || 1;
    const bt = $('.cm-audio-play', el), r = $('input', el), t = $('.cm-audio-t', el);
    a.onplay = () => { bt.textContent = '❚❚'; }; a.onpause = () => { bt.textContent = '▶'; };
    a.ontimeupdate = () => { if (a.duration && isFinite(a.duration)) { r.value = Math.round(a.currentTime / a.duration * 1000); } t.textContent = durTxt(a.currentTime); };
    a.onended = () => { bt.textContent = '▶'; r.value = 0; };
    a.onloadedmetadata = () => { if (isFinite(a.duration)) t.textContent = durTxt(a.duration); };
  }
  el._audio.paused ? el._audio.play().catch(e => fail(e)) : el._audio.pause();
}

function menuMsg(id, ancora) {
  $$('.cm-acoes', ui.root).forEach(x => x.remove());
  const m = ui.msgs.find(x => x.id === id); if (!m || m.tipo === 'sistema') return;
  const minha = m.autor_id === chat.eu(), c = conversa(), ativo = podeEscrever();
  const itens = [];
  if (!m.apagado_em) {
    if (ativo) itens.push(['responder', 'Responder']);
    if (m.texto) itens.push(['copiar', 'Copiar']);
    itens.push(['encaminhar', 'Encaminhar']);
    itens.push([ui.favs.has(id) ? 'desfav' : 'fav', ui.favs.has(id) ? 'Tirar das favoritas' : 'Favoritar ⭐']);
    if (ativo) itens.push([c.msg_fixada === id ? 'desfixar' : 'fixar', c.msg_fixada === id ? 'Desafixar' : 'Fixar na conversa 📌']);
    if (minha) itens.push(['info', 'Dados da mensagem']);
    if (minha && ativo && Date.now() - ts(m.criado_em) < 15 * 60e3 && m.texto) itens.push(['editar', 'Editar']);
  }
  itens.push(['apagar', 'Apagar']);
  const pop = document.createElement('div'); pop.className = 'cm-acoes'; pop.dataset.id = id;
  pop.innerHTML = `${!m.apagado_em && ativo ? `<div class="cm-rapidas">${RAPIDAS.map(e => `<button data-a="reagir" data-emo="${e}">${e}</button>`).join('')}<button data-a="mais-emo" title="Mais emojis">＋</button></div>` : ''}${itens.map(([k, l]) => `<button data-a="${k}"${k === 'apagar' ? ' class="neg"' : ''}>${l}</button>`).join('')}`;
  const bolha = ancora.closest('.cm-bolha') || ancora;
  bolha.parentElement.appendChild(pop);
  const box = $('#ch-msgs', ui.root), r = pop.getBoundingClientRect(), rb = box.getBoundingClientRect();
  if (r.bottom > rb.bottom - 8) pop.classList.add('acima');
}
async function acaoMsg(a, id, emo) {
  $$('.cm-acoes', ui.root).forEach(x => x.remove());
  const m = ui.msgs.find(x => x.id === id); if (!m) return;
  try {
    if (a === 'reagir') { const minha = (m.chat_reacoes || []).find(r => r.user_id === chat.eu()); await chat.reagir(id, minha?.emoji === emo ? null : emo); await recarregarReacoes(id); }
    if (a === 'mais-emo') escolherEmoji(async (e) => { try { await chat.reagir(id, e); recarregarReacoes(id); } catch (er) { fail(er); } });
    if (a === 'responder') { ui.editando = null; ui.resp = id; pintarBarra(); $('#ch-txt', ui.root)?.focus(); }
    if (a === 'copiar') { await navigator.clipboard.writeText(m.texto || ''); toast('Copiado'); }
    if (a === 'encaminhar') encaminhar(m);
    if (a === 'fav' || a === 'desfav') { await chat.favoritar(id, a === 'fav'); a === 'fav' ? ui.favs.add(id) : ui.favs.delete(id); trocarMsg(m); }
    if (a === 'fixar' || a === 'desfixar') { await chat.fixarMsg(ui.id, a === 'fixar' ? id : null); await chat.atualizarResumo(); }
    if (a === 'info') infoMsg(m);
    if (a === 'editar') { ui.resp = null; ui.arquivos = []; pintarArquivos(); ui.editando = id; pintarBarra(); const tx = $('#ch-txt', ui.root); if (tx) { tx.value = m.texto || ''; tx.dispatchEvent(new Event('input')); tx.focus(); } }
    if (a === 'apagar') apagarMsg(m);
  } catch (e) { fail(e); }
}
function escolherEmoji(fn) {
  const md = modal({ title: 'Reagir', body: `<div class="ch-emojis solto">${EMOJIS.map(e => `<button type="button">${e}</button>`).join('')}</div>` });
  $('.ch-emojis', md.el).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; md.close(); fn(b.textContent); };
}
function apagarMsg(m) {
  const minha = m.autor_id === chat.eu(), todos = minha && !m.apagado_em && Date.now() - ts(m.criado_em) < 48 * 3600e3 && podeEscrever();
  const md = modal({ title: 'Apagar mensagem?', body: `<p class="muted" style="margin-top:0">${todos ? '"Apagar para todos" tira a mensagem da conversa de todo mundo (fica o aviso "Esta mensagem foi apagada"). Dá para apagar para todos até 48 horas depois de enviar.' : '"Apagar para mim" tira a mensagem só da sua tela.'}</p>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn" id="ap-mim">Apagar para mim</button>${todos ? '<button class="btn danger" id="ap-todos">Apagar para todos</button>' : ''}` });
  $('#ap-mim', md.el).onclick = async () => { try { await chat.apagar(m.id, false); md.close(); ui.msgs = ui.msgs.filter(x => x.id !== m.id); $(`.cm[data-id="${m.id}"]`, ui.root)?.remove(); chat.atualizarResumo(); } catch (e) { fail(e); } };
  $('#ap-todos', md.el) && ($('#ap-todos', md.el).onclick = async () => { try { await chat.apagar(m.id, true); md.close(); ui.favs.delete(m.id); trocarMsg({ ...m, texto: null, chat_anexos: [], chat_reacoes: [], cartao: null, apagado_em: new Date().toISOString() }); chat.atualizarResumo(); } catch (e) { fail(e); } });
}
function quemReagiu(id) {
  const m = ui.msgs.find(x => x.id === id); if (!m) return;
  const md = modal({ title: 'Reações', body: `<div class="ch-pessoas">${(m.chat_reacoes || []).map(r => `<div class="ch-pessoa">${avatar(r.user_id, chat.nomeDe(r.user_id), 'direta', 34)}<span style="flex:1"><strong>${esc(chat.nomeDe(r.user_id))}</strong>${r.user_id === chat.eu() ? '<br><button class="btn link small" data-tirar>Tirar a minha reação</button>' : ''}</span><span style="font-size:22px">${r.emoji}</span></div>`).join('')}</div>` });
  $('[data-tirar]', md.el) && ($('[data-tirar]', md.el).onclick = async () => { try { await chat.reagir(id, null); md.close(); recarregarReacoes(id); } catch (e) { fail(e); } });
}
function infoMsg(m) {
  const t = ts(m.criado_em), outros = outrosDa(m);
  const lidas = outros.filter(p => ts(p.lida_ate) >= t), entregues = outros.filter(p => ts(p.lida_ate) < t && ts(p.entregue_ate) >= t), falta = outros.filter(p => ts(p.lida_ate) < t && ts(p.entregue_ate) < t);
  const lista = (ps) => ps.length ? ps.map(p => `<div class="ch-pessoa">${avatar(p.user_id, chat.nomeDe(p.user_id), 'direta', 30)}<span>${esc(chat.nomeDe(p.user_id))}</span></div>`).join('') : '<div class="small muted" style="padding:6px">Ninguém</div>';
  modal({ title: 'Dados da mensagem', body: `<div class="cm-info-prev">${esc(previaMsg(m))}<div class="small muted">enviada ${rotuloDia(m.criado_em).toLowerCase()} às ${hora(m.criado_em)}</div></div>
    <h4 class="ch-info-tit"><span class="tk lida">${SVG2}</span> Lida por</h4>${lista(lidas)}
    <h4 class="ch-info-tit"><span class="tk">${SVG2}</span> Entregue a</h4>${lista(entregues)}
    ${falta.length ? `<h4 class="ch-info-tit"><span class="tk">${SVG1}</span> Ainda não recebeu</h4>${lista(falta)}` : ''}` });
}
async function encaminhar(m) {
  const convs = chat.getResumo().filter(c => !c.saiu && !(c.tipo === 'grupo' && c.so_admins_escrevem && !c.sou_admin));
  const md = modal({ title: 'Encaminhar para…', body: `<input type="search" class="ch-pess-busca" placeholder="Pesquisar conversa" autocomplete="off">
    <div class="ch-pessoas">${convs.map(c => `<label class="ch-pessoa" data-txt="${esc((c.nome || '').toLowerCase())}"><input type="checkbox" value="${c.id}">${avatar(c.tipo === 'direta' ? c.outro_id : c.id, c.nome, c.tipo, 34)}<span><strong>${esc(c.nome)}</strong></span></label>`).join('')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="enc-ok">Encaminhar</button>' });
  ligarBuscaPessoas(md.el);
  $('#enc-ok', md.el).onclick = async () => {
    const ds = $$('.ch-pessoa input:checked', md.el).map(i => i.value); if (!ds.length) return toast('Escolha ao menos uma conversa', true);
    $('#enc-ok', md.el).disabled = true;
    try { const n = await chat.encaminhar(m, ds); md.close(); toast(n === 1 ? 'Mensagem encaminhada' : `Encaminhada para ${n} conversas`); } catch (e) { fail(e); $('#enc-ok', md.el).disabled = false; }
  };
}

// ---------- anexos ----------
async function carregarImagens(box) {
  const bts = $$('.cm-img:not([data-ok])', box); if (!bts.length) return;
  bts.forEach(b => b.dataset.ok = '1');
  const urls = await chat.urlsAnexos(bts.map(b => b.dataset.caminho));
  for (const b of bts) { const u = urls[b.dataset.caminho]; b.innerHTML = u ? `<img src="${esc(u)}" alt="${esc(b.dataset.nome)}" loading="lazy">` : '<span class="small muted">imagem indisponível</span>'; }
}
function ligarSoltar(conv) {
  let n = 0; const sol = $('#ch-soltar', conv);
  conv.ondragenter = (e) => { if (!e.dataTransfer?.types?.includes('Files') || !podeEscrever()) return; e.preventDefault(); n++; sol.hidden = false; };
  conv.ondragover = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
  conv.ondragleave = () => { if (--n <= 0) { n = 0; sol.hidden = true; } };
  conv.ondrop = (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); n = 0; sol.hidden = true; if (podeEscrever()) addArquivos([...e.dataTransfer.files]); };
}
function addArquivos(fs) {
  if (ui.editando) return toast('Termine a edição antes de anexar', true);
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
function pintarBarra() {
  const b = $('#ch-barra', ui.root); if (!b) return;
  if (ui.resp) {
    const o = ui.msgs.find(x => x.id === ui.resp);
    b.hidden = false;
    b.innerHTML = `<div class="ch-barra-txt" style="--cit:${corDe(o?.autor_id)}"><strong>Respondendo a ${esc(chat.nomeDe(o?.autor_id))}</strong><span>${esc(previaMsg(o))}</span></div><button class="btn ghost icon small" id="ch-barra-x" aria-label="Cancelar">✕</button>`;
  } else if (ui.editando) {
    const o = ui.msgs.find(x => x.id === ui.editando);
    b.hidden = false;
    b.innerHTML = `<div class="ch-barra-txt" style="--cit:var(--ch-verde)"><strong>✏️ Editando mensagem</strong><span>${esc(previaMsg(o))}</span></div><button class="btn ghost icon small" id="ch-barra-x" aria-label="Cancelar">✕</button>`;
  } else { b.hidden = true; b.innerHTML = ''; return; }
  $('#ch-barra-x', b).onclick = () => { const ed = !!ui.editando; ui.resp = null; ui.editando = null; pintarBarra(); if (ed) { const tx = $('#ch-txt', ui.root); tx.value = ''; tx.dispatchEvent(new Event('input')); } };
}
function pintarComposer() {
  const f = $('#ch-composer', ui.root); if (!f || f.dataset.gravando) return;
  const c = conversa();
  if (!podeEscrever()) {
    f.innerHTML = `<div class="ch-bloq small muted">${c.saiu ? 'Você não participa mais desta conversa.' : 'Só os administradores podem enviar mensagens neste grupo.'}</div>`;
    return;
  }
  if ($('#ch-txt', f)) return;                       // já desenhado: não perde o que foi digitado
  const temMic = chat.temEtapa2() && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  f.innerHTML = `<div class="ch-emoji-wrap"><button class="btn ghost icon" id="ch-emoji" title="Emoji" aria-label="Emoji">😊</button><div class="ch-emojis" id="ch-emojis" hidden>${EMOJIS.map(e => `<button type="button">${e}</button>`).join('')}</div></div>
    <label class="btn ghost icon ch-clip" title="Anexar arquivo ou foto" aria-label="Anexar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg><input type="file" id="ch-arq" multiple hidden></label>
    <textarea id="ch-txt" rows="1" placeholder="Mensagem" maxlength="8000" aria-label="Mensagem"></textarea>
    <button class="btn primary icon ch-enviar" id="ch-enviar" aria-label="Enviar"${temMic ? ' hidden' : ' disabled'}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2z"/></svg></button>
    ${temMic ? '<button class="btn primary icon ch-enviar" id="ch-mic" aria-label="Gravar áudio" title="Gravar mensagem de voz"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1a7 7 0 0 0 6-6.9z"/></svg></button>' : ''}`;
  const tx = $('#ch-txt', f);
  const cresce = () => { tx.style.height = 'auto'; tx.style.height = Math.min(tx.scrollHeight, 160) + 'px'; ajustarBotao(); };
  tx.oninput = () => { cresce(); if (tx.value && !ui.editando) chat.avisarDigitando(ui.id); mencaoPop(tx); };
  tx.onkeydown = (e) => {
    const pop = $('#ch-mencao-pop', ui.root);
    if (pop && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) { e.preventDefault(); navegarMencao(pop, e.key, tx); return; }
    if (e.key === 'Escape' && (ui.resp || ui.editando)) { $('#ch-barra-x', ui.root)?.click(); return; }
    if (e.key === 'ArrowUp' && !tx.value && chat.temEtapa2()) { const ult = [...ui.msgs].reverse().find(m => m.autor_id === chat.eu() && !m.apagado_em && m.tipo !== 'sistema' && m.texto && Date.now() - ts(m.criado_em) < 15 * 60e3); if (ult) { e.preventDefault(); acaoMsg('editar', ult.id); } return; }
    if (e.key === 'Enter' && !e.shiftKey && !toqueGrosso() && !e.isComposing) { e.preventDefault(); mandar(); }
  };
  tx.onpaste = (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addArquivos(fs); } };
  $('#ch-arq', f).onchange = (e) => { addArquivos([...e.target.files]); e.target.value = ''; };
  $('#ch-enviar', f).onclick = mandar;
  $('#ch-mic', f) && ($('#ch-mic', f).onclick = gravar);
  const ep = $('#ch-emojis', f);
  $('#ch-emoji', f).onclick = (e) => { e.stopPropagation(); ep.hidden = !ep.hidden; };
  ep.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const p = tx.selectionStart ?? tx.value.length; tx.value = tx.value.slice(0, p) + b.textContent + tx.value.slice(tx.selectionEnd ?? p); tx.selectionStart = tx.selectionEnd = p + b.textContent.length; tx.focus(); cresce(); };
  pintarBarra();
}
function ajustarBotao() {
  const b = $('#ch-enviar', ui.root), t = $('#ch-txt', ui.root), mic = $('#ch-mic', ui.root); if (!b || !t) return;
  const tem = !!t.value.trim() || ui.arquivos.length;
  if (mic) { mic.hidden = !!tem || !!ui.editando; b.hidden = !tem && !ui.editando; b.disabled = false; } else b.disabled = !tem && !ui.editando;
}
function mandar() {
  const tx = $('#ch-txt', ui.root); if (!tx) return;
  const texto = tx.value.replace(/\s+$/, '');
  if (ui.editando) {
    const id = ui.editando, m = ui.msgs.find(x => x.id === id);
    if (!texto.trim()) return toast('A mensagem não pode ficar vazia. Para tirar, use Apagar.', true);
    ui.editando = null; pintarBarra(); tx.value = ''; tx.style.height = 'auto'; ajustarBotao();
    if (m && texto !== (m.texto || '')) chat.editar(id, texto).then(nm => trocarMsg({ ...m, ...nm }), fail);
    return;
  }
  if (!texto.trim() && !ui.arquivos.length) return;
  const mencoes = [...ui.mencoes].filter(([, nome]) => texto.includes('@' + nome)).map(([u]) => u);
  const it = chat.enviar(ui.id, texto, ui.arquivos.slice(), { resposta_a: ui.resp, mencoes });
  if (!it) return;
  tx.value = ''; tx.style.height = 'auto'; ui.arquivos = []; ui.resp = null; ui.mencoes = new Map(); pintarArquivos(); pintarBarra(); ajustarBotao();
  chat.avisarDigitando(ui.id, 'parou');
  const ep = $('#ch-emojis', ui.root); if (ep) ep.hidden = true;
  if (!toqueGrosso()) tx.focus();
}

// menções: "@" abre a lista de quem está na conversa
function mencaoPop(tx) {
  $('#ch-mencao-pop', ui.root)?.remove();
  if (conversa().tipo === 'direta' || !chat.temEtapa2()) return;
  const antes = tx.value.slice(0, tx.selectionStart), mt = antes.match(/(?:^|\s)@([\p{L}\d.]*)$/u);
  if (!mt) return;
  const t = mt[1].toLowerCase();
  const ps = ui.parts.filter(p => !p.saiu_em && p.user_id !== chat.eu()).map(p => ({ u: p.user_id, n: chat.nomeDe(p.user_id) })).filter(p => p.n.toLowerCase().includes(t)).slice(0, 8);
  if (!ps.length) return;
  const pop = document.createElement('div'); pop.className = 'ch-mencao-pop'; pop.id = 'ch-mencao-pop';
  pop.innerHTML = ps.map((p, i) => `<button data-u="${p.u}" data-n="${esc(p.n)}"${i === 0 ? ' class="on"' : ''}>${avatar(p.u, p.n, 'direta', 26)} ${esc(p.n)}</button>`).join('');
  $('#ch-composer', ui.root).appendChild(pop);
  pop.onclick = (e) => { const b = e.target.closest('[data-u]'); if (b) inserirMencao(tx, b.dataset.u, b.dataset.n); };
}
function navegarMencao(pop, k, tx) {
  const bs = $$('button', pop); let i = bs.findIndex(b => b.classList.contains('on'));
  if (k === 'Escape') { pop.remove(); return; }
  if (k === 'Enter' || k === 'Tab') { const b = bs[i] || bs[0]; inserirMencao(tx, b.dataset.u, b.dataset.n); return; }
  i = (i + (k === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, j) => b.classList.toggle('on', j === i));
}
function inserirMencao(tx, u, n) {
  const p = tx.selectionStart, antes = tx.value.slice(0, p).replace(/@([\p{L}\d.]*)$/u, '@' + n + ' ');
  tx.value = antes + tx.value.slice(p); tx.selectionStart = tx.selectionEnd = antes.length;
  ui.mencoes.set(u, n); $('#ch-mencao-pop', ui.root)?.remove(); tx.focus(); ajustarBotao();
}

// áudio: toque no microfone para gravar; ➤ envia, 🗑 descarta
async function gravar() {
  if (ui.gravador) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Libere o microfone no navegador para gravar áudio', true); }
  const tipo = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined), partes = [];
  const g = ui.gravador = { rec, stream, inicio: Date.now(), cancelado: false, conversa: ui.id, resp: ui.resp };
  rec.ondataavailable = (e) => { if (e.data.size) partes.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach(t => t.stop()); clearInterval(g.timer);
    if (ui?.gravador === g) ui.gravador = null;
    chat.avisarDigitando(g.conversa, 'parou');
    if (ui?.root.isConnected) pintarComposerNormal();
    if (g.cancelado || Date.now() - g.inicio < 800) return;
    const mime = (rec.mimeType || tipo || 'audio/webm').split(';')[0];
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const nome = `audio-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${ext}`;
    chat.enviar(g.conversa, '', [new File(partes, nome, { type: mime })], { resposta_a: g.resp || null });
    if (ui && ui.resp === g.resp) { ui.resp = null; pintarBarra(); }
  };
  rec.start(250);
  chat.avisarDigitando(ui.id, 'gravando');
  const f = $('#ch-composer', ui.root);
  f.dataset.gravando = '1';
  f.innerHTML = `<button class="btn ghost icon" id="gr-x" title="Descartar" aria-label="Descartar">🗑</button><div class="ch-gravando"><span class="ch-rec"></span><span id="gr-t">0:00</span><span class="small muted">gravando… toque em enviar quando terminar</span></div>
    <button class="btn primary icon ch-enviar" id="gr-ok" aria-label="Enviar áudio"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2z"/></svg></button>`;
  g.timer = setInterval(() => { const t = document.getElementById('gr-t'); if (t) t.textContent = durTxt((Date.now() - g.inicio) / 1000); if (Date.now() - g.inicio > 15 * 60e3) rec.stop(); else chat.avisarDigitando(g.conversa, 'gravando'); }, 1000);
  $('#gr-x', f).onclick = () => { g.cancelado = true; rec.stop(); };
  $('#gr-ok', f).onclick = () => rec.stop();
}
function pararGravacao(cancelar) { const g = ui?.gravador; if (!g) return; g.cancelado = !!cancelar; try { g.rec.stop(); } catch {} }
function pintarComposerNormal() { const f = $('#ch-composer', ui.root); if (!f) return; if (f.dataset.gravando) { delete f.dataset.gravando; f.innerHTML = ''; } pintarComposer(); ajustarBotao(); }

// ---------- nova conversa, grupo, dados ----------
async function listaPessoas({ multipla = false, marcados = [], excluir = [] } = {}) {
  const pessoas = (await chat.getContatos(true).catch(() => [])).filter(p => !excluir.includes(p.user_id));
  return `<input type="search" class="ch-pess-busca" placeholder="Pesquisar pessoa" autocomplete="off">
    <div class="ch-pessoas">${pessoas.length ? pessoas.map(p => `<label class="ch-pessoa" data-txt="${esc((p.nome + ' ' + p.email).toLowerCase())}">
      ${multipla ? `<input type="checkbox" value="${p.user_id}" ${marcados.includes(p.user_id) ? 'checked' : ''}>` : `<input type="radio" name="pessoa" value="${p.user_id}" hidden>`}
      ${avatar(p.user_id, p.nome, 'direta', 36, chat.estaOnline(p.user_id))}<span><strong>${esc(p.nome)}</strong><br><span class="small muted">${esc(PAPEL[p.papel] || p.papel)} · ${esc(p.email)}</span></span></label>`).join('')
      : '<div class="empty small">Ninguém para adicionar.</div>'}</div>`;
}
function ligarBuscaPessoas(el) {
  const b = $('.ch-pess-busca', el); if (!b) return;
  b.oninput = () => { const t = b.value.trim().toLowerCase(); $$('.ch-pessoa', el).forEach(p => { p.hidden = !!t && !p.dataset.txt.includes(t); }); };
  if (!toqueGrosso()) setTimeout(() => b.focus(), 50);
}
async function novaConversa() {
  const md = modal({ title: 'Nova conversa', body: `<button class="btn ch-novo-grupo" id="nc-grupo">${avatar('g', '', 'grupo', 32)} Novo grupo</button>${await listaPessoas()}` });
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
async function adicionarPessoas(depois) {
  const ativos = ui.parts.filter(p => !p.saiu_em).map(p => p.user_id);
  const m2 = modal({ title: 'Adicionar participantes', body: await listaPessoas({ multipla: true, excluir: ativos }),
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ad-ok">Adicionar</button>' });
  ligarBuscaPessoas(m2.el);
  $('#ad-ok', m2.el).onclick = async () => {
    const users = $$('.ch-pessoa input:checked', m2.el).map(i => i.value); if (!users.length) return m2.close();
    try { await q(sb.rpc('chat_grupo_adicionar', { p_conversa: ui.id, p_users: users })); m2.close(); await chat.atualizarResumo(); await recarregarParts(); depois?.(); } catch (er) { fail(er); }
  };
}
async function favoritas() {
  if (!chat.temEtapa2()) return toast('Disponível depois da atualização do banco (SQL 060)', true);
  let fs = [];
  try { fs = await q(sb.from('chat_favoritas').select(`criado_em, conversa_id, mensagem_id, chat_mensagens(${chat.selectMsg()})`).eq('empresa_id', chat.getEmpresa()).order('criado_em', { ascending: false }).limit(200)); } catch (e) { return fail(e); }
  const vis = fs.filter(f => f.chat_mensagens);
  const md = modal({ title: '⭐ Mensagens favoritas', body: vis.length ? `<div class="ch-favs">${vis.map(f => { const m = f.chat_mensagens, c = chat.getResumo().find(x => x.id === f.conversa_id);
      return `<button class="ch-fav" data-c="${f.conversa_id}" data-m="${m.id}" data-t="${esc(m.criado_em)}"><span class="small muted">${esc(chat.nomeDe(m.autor_id))} · ${esc(c?.nome || '')} · ${quandoLista(m.criado_em)}</span><span>${esc(previaMsg(m))}</span></button>`; }).join('')}</div>`
    : '<div class="empty small">Nenhuma mensagem favorita. Use ⌄ › Favoritar numa mensagem.</div>' });
  $('.ch-favs', md.el) && ($('.ch-favs', md.el).onclick = (e) => { const b = e.target.closest('.ch-fav'); if (!b) return; md.close(); irParaMsg(b.dataset.c, b.dataset.m, b.dataset.t); });
}

async function dadosConversa(aba = 'dados') {
  await recarregarParts();
  const c = conversa(), sou = c.sou_admin && !c.saiu && c.tipo === 'grupo';
  const ativos = ui.parts.filter(p => !p.saiu_em).sort((a, b) => (b.admin - a.admin) || chat.nomeDe(a.user_id).localeCompare(chat.nomeDe(b.user_id)));
  const ct = c.tipo === 'direta' ? chat.contatoDe(c.outro_id) : null;
  const perfil = `<div class="ch-perfil">${avatar(c.tipo === 'direta' ? c.outro_id : c.id, c.nome, c.tipo, 84, c.tipo === 'direta' && chat.estaOnline(c.outro_id))}<h3>${esc(c.nome)}</h3>
    ${c.tipo === 'direta' ? `<div class="muted">${esc(ct?.email || '')}</div><div class="small muted">${esc(papelDe(c.outro_id))}${chat.estaOnline(c.outro_id) ? ' · online' : ct?.visto_em ? ' · ' + vistoTxt(ct.visto_em) : ''}</div>`
      : `<div class="muted">${esc(c.descricao || '')}</div><div class="small muted">${c.tipo === 'grupo' ? 'Grupo' : esc(REGISTRO[c.registro_tipo] || 'Registro')} · ${ativos.length} participantes</div>`}</div>`;
  const parts = c.tipo === 'direta' ? '' : `
    ${sou ? `<form class="form" id="dg-f"><label>Nome<input name="nome" maxlength="80" value="${esc(c.nome)}"></label><label>Descrição<input name="descricao" maxlength="500" value="${esc(c.descricao || '')}"></label>
      <label class="ch-check"><input type="checkbox" name="so" ${c.so_admins_escrevem ? 'checked' : ''}> Só administradores enviam mensagens (grupo de avisos)</label>
      <button class="btn small" type="submit">Salvar</button></form>` : ''}
    <div class="ch-part-topo"><strong>${ativos.length} participantes</strong>${(sou || (c.tipo === 'registro' && !c.saiu)) ? '<button class="btn small" id="dg-add">+ Adicionar</button>' : ''}</div>
    <div class="ch-pessoas">${ativos.map(p => `<div class="ch-pessoa" data-u="${p.user_id}">${avatar(p.user_id, chat.nomeDe(p.user_id), 'direta', 36, chat.estaOnline(p.user_id))}
      <span style="flex:1"><strong>${esc(chat.nomeDe(p.user_id))}</strong><br><span class="small muted">${esc(papelDe(p.user_id))}</span></span>
      ${p.admin && c.tipo === 'grupo' ? '<span class="badge pago">admin do grupo</span>' : ''}
      ${sou && p.user_id !== chat.eu() ? `<span class="ch-pessoa-acoes"><button class="btn ghost small" data-adm="${p.admin ? 0 : 1}">${p.admin ? 'Tirar admin' : 'Tornar admin'}</button><button class="btn ghost small neg" data-rem>Remover</button></span>` : ''}</div>`).join('')}</div>`;
  const md = modal({ title: c.tipo === 'grupo' ? 'Dados do grupo' : c.tipo === 'registro' ? 'Dados da conversa' : 'Dados do contato', body: `
    <div class="ch-abas"><button data-aba="dados" class="${aba === 'dados' ? 'on' : ''}">${c.tipo === 'direta' ? 'Contato' : 'Participantes'}</button><button data-aba="midia" class="${aba === 'midia' ? 'on' : ''}">Mídia</button><button data-aba="docs">Documentos</button><button data-aba="links">Links</button></div>
    <div id="dg-dados" ${aba !== 'dados' ? 'hidden' : ''}>${perfil}${parts}</div><div id="dg-outra" ${aba === 'dados' ? 'hidden' : ''}></div>`,
    foot: c.tipo !== 'direta' && !c.saiu ? `<button class="btn danger" id="dg-sair" style="margin-right:auto">${c.tipo === 'grupo' ? 'Sair do grupo' : 'Sair da conversa'}</button><button class="btn" data-close>Fechar</button>` : '<button class="btn" data-close>Fechar</button>' });
  const reabrir = async () => { md.close(); await chat.atualizarResumo(); await recarregarParts(); dadosConversa(); };
  const abaEl = $('.ch-abas', md.el);
  const mostrar = async (a) => {
    $$('button', abaEl).forEach(b => b.classList.toggle('on', b.dataset.aba === a));
    $('#dg-dados', md.el).hidden = a !== 'dados'; const o = $('#dg-outra', md.el); o.hidden = a === 'dados';
    if (a !== 'dados') { o.innerHTML = '<div class="loading">Carregando…</div>'; o.innerHTML = await htmlMidia(a); ligarMidia(o); }
  };
  abaEl.onclick = (e) => { const b = e.target.closest('[data-aba]'); if (b) mostrar(b.dataset.aba); };
  if (aba !== 'dados') mostrar(aba);
  $('#dg-f', md.el) && ($('#dg-f', md.el).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await q(sb.rpc('chat_grupo_editar', { p_conversa: c.id, p_nome: f.nome.value, p_descricao: f.descricao.value, p_so_admins: f.so.checked })); toast('Grupo atualizado'); reabrir(); } catch (er) { fail(er); }
  });
  $('#dg-add', md.el) && ($('#dg-add', md.el).onclick = () => adicionarPessoas(reabrir));
  $('.ch-pessoas', md.el)?.addEventListener('click', async (e) => {
    const linha = e.target.closest('[data-u]'); if (!linha) return;
    const u = linha.dataset.u;
    try {
      if (e.target.closest('[data-adm]')) { await q(sb.rpc('chat_grupo_admin', { p_conversa: c.id, p_user: u, p_admin: e.target.closest('[data-adm]').dataset.adm === '1' })); reabrir(); }
      if (e.target.closest('[data-rem]') && await confirmDialog(`Remover ${chat.nomeDe(u)} do grupo?`)) { await q(sb.rpc('chat_grupo_remover', { p_conversa: c.id, p_user: u })); reabrir(); }
    } catch (er) { fail(er); }
  });
  $('#dg-sair', md.el) && ($('#dg-sair', md.el).onclick = async () => {
    if (!await confirmDialog('Sair desta conversa? Você continua vendo as mensagens até agora, mas não recebe as novas.')) return;
    try { await q(sb.rpc('chat_grupo_remover', { p_conversa: c.id, p_user: chat.eu() })); md.close(); await chat.atualizarResumo(); recarregarParts(); } catch (er) { fail(er); }
  });
}
async function htmlMidia(aba) {
  try {
    if (aba === 'links') {
      const ms = await q(sb.from('chat_mensagens').select('id, autor_id, texto, criado_em').eq('conversa_id', ui.id).ilike('texto', '%http%').order('criado_em', { ascending: false }).limit(200));
      const links = ms.flatMap(m => (m.texto.match(RX_LINK) || []).map(l => ({ l, m })));
      return links.length ? `<div class="ch-links">${links.map(({ l, m }) => `<a class="ch-link" href="${esc(l.startsWith('www.') ? 'https://' + l : l)}" target="_blank" rel="noopener noreferrer"><strong>${esc(l)}</strong><span class="small muted">${esc(chat.nomeDe(m.autor_id))} · ${quandoLista(m.criado_em)}</span></a>`).join('')}</div>` : '<div class="empty small">Nenhum link nesta conversa.</div>';
    }
    const as = await q(sb.from('chat_anexos').select('id, mensagem_id, caminho, nome, mime, tamanho, criado_em').eq('conversa_id', ui.id).order('criado_em', { ascending: false }).limit(300));
    if (aba === 'midia') {
      const im = as.filter(ehImg); if (!im.length) return '<div class="empty small">Nenhuma foto nesta conversa.</div>';
      const urls = await chat.urlsAnexos(im.map(a => a.caminho));
      return `<div class="ch-grade-midia">${im.map(a => `<button class="cm-img" data-caminho="${esc(a.caminho)}" data-nome="${esc(a.nome)}">${urls[a.caminho] ? `<img src="${esc(urls[a.caminho])}" alt="${esc(a.nome)}" loading="lazy">` : ''}</button>`).join('')}</div>`;
    }
    const ds = as.filter(a => !ehImg(a));
    return ds.length ? `<div class="ch-docs">${ds.map(a => `<button class="cm-doc" data-caminho="${esc(a.caminho)}" data-nome="${esc(a.nome)}"><span class="cm-doc-ico">${ehAudio(a) ? '<span style="background:#1daa61">🎤</span>' : icoDoc(a)}</span><span class="cm-doc-txt"><span class="cm-doc-nome">${esc(a.nome)}</span><span class="small muted">${tamanho(a.tamanho)} · ${quandoLista(a.criado_em)}</span></span><span class="cm-doc-baixar">⬇</span></button>`).join('')}</div>` : '<div class="empty small">Nenhum documento nesta conversa.</div>';
  } catch (e) { return `<div class="empty small">${esc(e.message || e)}</div>`; }
}
function ligarMidia(o) {
  o.onclick = async (e) => {
    const el = e.target.closest('.cm-img, .cm-doc'); if (!el) return;
    const { [el.dataset.caminho]: u } = await chat.urlsAnexos([el.dataset.caminho]); if (!u) return toast('Arquivo indisponível', true);
    if (el.classList.contains('cm-img') || /\.pdf$/i.test(el.dataset.nome)) window.open(u, '_blank', 'noopener');
    else { const a = document.createElement('a'); a.href = `${u}&download=${encodeURIComponent(el.dataset.nome)}`; document.body.appendChild(a); a.click(); a.remove(); }
  };
}

// ---------- exportar a conversa em PDF (padrão dos relatórios) ----------
async function exportarPDF() {
  if (!window.jspdf) return toast('Biblioteca de PDF ainda carregando, tente de novo em instantes', true);
  const c = conversa(), idConv = ui.id;
  toast('Montando o PDF da conversa…');
  let todas = [], ate = null;
  try {
    for (;;) {
      let b = sb.from('chat_mensagens').select(chat.selectMsg()).eq('conversa_id', idConv).order('criado_em', { ascending: false }).limit(500);
      if (ate) b = b.lt('criado_em', ate);
      const r = await q(b); todas = todas.concat(r); if (r.length < 500 || todas.length >= 20000) break; ate = r[r.length - 1].criado_em;
    }
  } catch (e) { return fail(e); }
  todas.reverse();
  const limpa = (t) => pdfLimpo(t).replace(/[^\x00-\xFF]/g, '').replace(/[ \t]+/g, ' ').trim();
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  padronizarPDF(doc);
  const M = 14, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), larg = W - 2 * M;
  const logo = await logoPNG().catch(() => null);
  const nomeRel = limpa(`Conversa - ${c.nome || ''}`);
  const sub = c.tipo === 'direta' ? 'conversa individual' : c.tipo === 'grupo' ? `grupo - ${ui.parts.filter(p => !p.saiu_em).length} participantes` : limpa(REGISTRO[c.registro_tipo] || 'registro');
  const cab = () => pdfCabecalho(doc, nomeRel, logo, { M, sub });
  cab();
  let y = 27, diaAnt = null;
  const quebra = (h) => { if (y + h > H - 16) { doc.addPage(); cab(); y = 27; } };
  doc.setTextColor(...PRETO);
  for (const m of todas) {
    if (dia(m.criado_em) !== diaAnt) {
      diaAnt = dia(m.criado_em); quebra(10);
      doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.text(limpa(new Date(m.criado_em).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })), M, y + 3);
      doc.setDrawColor(0); doc.setLineWidth(0.2); doc.line(M, y + 4.5, W - M, y + 4.5); y += 8;
    }
    if (m.tipo === 'sistema') { quebra(5); doc.setFont('times', 'italic'); doc.setFontSize(8.5); doc.setTextColor(90); doc.text(limpa(`${hora(m.criado_em)}  ${m.texto}`), M, y + 3); doc.setTextColor(...PRETO); y += 5; continue; }
    let corpo = m.apagado_em ? '(mensagem apagada)' : limpa(m.texto || '');
    const extra = [];
    if (m.encaminhada) extra.push('encaminhada');
    if (m.editado_em && !m.apagado_em) extra.push('editada');
    if (m.resposta_a) { const o = todas.find(x => x.id === m.resposta_a); if (o) extra.push(`em resposta a ${limpa(chat.nomeDe(o.autor_id))}: "${limpa(previaMsg(o)).slice(0, 60)}"`); }
    for (const a of (m.chat_anexos || [])) corpo += `${corpo ? '\n' : ''}[${ehAudio(a) ? 'áudio' : ehImg(a) ? 'foto' : 'arquivo'}: ${limpa(a.nome)}]`;
    if (m.cartao) corpo += `${corpo ? '\n' : ''}[registro: ${limpa(REGISTRO[m.cartao.tipo] || m.cartao.tipo)}]`;
    doc.setFont('times', 'normal'); doc.setFontSize(9.5);
    const linhas = doc.splitTextToSize(corpo || ' ', larg - 14);
    quebra(5 + linhas.length * 4.2);
    doc.setFontSize(8.5); doc.setTextColor(90); doc.text(hora(m.criado_em), M, y + 3);
    const nome = limpa(chat.nomeDe(m.autor_id));
    doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...PRETO); doc.text(nome, M + 12, y + 3);
    if (extra.length) { const x = M + 14 + doc.getTextWidth(nome); doc.setFont('times', 'italic'); doc.setFontSize(8); doc.setTextColor(90); doc.text(doc.splitTextToSize(limpa(`(${extra.join('; ')})`), W - M - x)[0], x, y + 3); doc.setTextColor(...PRETO); }
    doc.setFont('times', m.apagado_em ? 'italic' : 'normal'); doc.setFontSize(9.5);
    doc.text(linhas, M + 12, y + 7.5); y += 5 + linhas.length * 4.2 + 1.5;
  }
  if (!todas.length) { doc.setFont('times', 'italic'); doc.text('Nenhuma mensagem.', M, y + 4); }
  pdfRodapes(doc, `Fonte: Conversas (plataforma) - ${todas.length} mensagens`, { M });
  doc.save(`conversa_${(c.nome || 'conversa').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

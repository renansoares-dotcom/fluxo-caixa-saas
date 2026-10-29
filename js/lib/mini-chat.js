// Mini-chat: as Conversas numa janela por cima de qualquer tela (computador). No celular, vai para a tela Conversas.
// Também liga o botão "💬 Conversa" dos registros (lançamento, pagamento antecipado, pedido de compra, OP, frete,
// proposta FIDC): abre a conversa daquele registro (SQL 060: só entra quem pode ver o registro).
import { $, $$, esc, fail, modal, toast } from './ui.js';
import * as chat from './chat.js';

let painel = null;
const pagina = () => import('../pages/conversas.js');
const celular = () => matchMedia('(max-width: 900px)').matches;
export const miniAberto = () => !!painel && !painel.hidden;

export async function abrirMini(convId = null) {
  if (!chat.chatPronto()) return;
  if (location.hash.startsWith('#/conversas') || celular()) { location.hash = '#/conversas' + (convId ? '?c=' + convId : ''); return; }
  const mod = await pagina();
  if (!painel) {
    painel = document.createElement('div'); painel.className = 'mini-chat'; painel.hidden = true;
    painel.innerHTML = `<div class="mini-topo"><strong>💬 Conversas</strong><span class="mini-acoes"><button class="btn ghost icon small" id="mini-tela" title="Abrir em tela cheia" aria-label="Abrir em tela cheia">⤢</button><button class="btn ghost icon small" id="mini-x" title="Fechar" aria-label="Fechar">✕</button></span></div><div class="mini-corpo" id="mini-corpo"></div>`;
    document.body.appendChild(painel);
    $('#mini-x', painel).onclick = fecharMini;
    $('#mini-tela', painel).onclick = () => { const c = chat.getAberta(); fecharMini(); location.hash = '#/conversas' + (c ? '?c=' + c : ''); };
  }
  painel.hidden = false;
  if (mod.telaAberta() !== 'mini') await mod.render($('#mini-corpo', painel), { mini: true, abrirId: convId });
  else if (convId) mod.abrirConversa(convId);
}
export async function fecharMini() {
  if (!painel || painel.hidden) return;
  painel.hidden = true;
  const mod = await pagina(); if (mod.telaAberta() === 'mini') mod.fechar();
  const corpo = $('#mini-corpo', painel); corpo.innerHTML = ''; corpo.className = 'mini-corpo';
}
export function alternarMini() { miniAberto() ? fecharMini() : abrirMini(); }
document.addEventListener('mini-chat-fechar', fecharMini);
// o roteador zera a conversa "aberta" a cada tela; com o mini-chat aberto, ela continua aberta
window.addEventListener('hashchange', async () => {
  if (!miniAberto()) return;
  if (location.hash.startsWith('#/conversas')) return fecharMini();
  (await pagina()).reafirmar?.();
});

// ---------- conversa do registro ----------
export async function conversaRegistro(tipo, id) {
  try { const c = await chat.abrirRegistro(tipo, id); await abrirMini(c); } catch (e) { fail(e); }
}
/** botão para colocar nas telas: abre a conversa do registro (o clique é tratado aqui, em qualquer tela) */
export const botaoConversa = (tipo, id, rotulo = '💬 Conversa') => (chat.chatPronto() && chat.temEtapa2() && id
  ? `<button type="button" class="btn small" data-chat-reg="${tipo}" data-chat-id="${id}" title="Conversa da equipe sobre este registro">${rotulo}</button>` : '');
/** coloca os botões "💬 Conversa" e "↗ Enviar no chat" no topo de uma janela (modal) de registro */
export function conversaNoModal(m, tipo, id) {
  const h = botaoConversa(tipo, id); if (!h || !m?.el) return;
  const head = m.el.querySelector('.modal-head'); if (!head) return;
  const fechar = head.querySelector('[data-close]');
  const t = document.createElement('template');
  t.innerHTML = `<span class="chat-reg-acoes">${h}<button type="button" class="btn small ghost" data-chat-env="${tipo}" data-chat-id="${id}" title="Mandar este registro (como cartão) numa conversa">↗ Enviar no chat</button></span>`;
  const b = t.content.firstElementChild;
  fechar ? head.insertBefore(b, fechar) : head.appendChild(b);
}
/** manda o registro como cartão numa ou mais conversas (quem não pode ver o registro vê "sem acesso") */
export async function compartilharRegistro(tipo, id) {
  await chat.atualizarResumo();
  const convs = chat.getResumo().filter(c => !c.saiu && !(c.tipo === 'grupo' && c.so_admins_escrevem && !c.sou_admin));
  if (!convs.length) return toast('Você ainda não tem conversas. Abra Conversas e comece uma.', true);
  const md = modal({ title: 'Enviar no chat', body: `<label>Mensagem (opcional)<input id="cr-txt" maxlength="2000" placeholder="Ex.: pode conferir este?"></label>
    <input type="search" class="ch-pess-busca" placeholder="Pesquisar conversa" autocomplete="off" style="margin-top:8px">
    <div class="ch-pessoas">${convs.map(c => `<label class="ch-pessoa" data-txt="${esc((c.nome || '').toLowerCase())}"><input type="checkbox" value="${c.id}"><span><strong>${esc(c.nome)}</strong><br><span class="small muted">${c.tipo === 'grupo' ? 'Grupo' : c.tipo === 'registro' ? 'Conversa de registro' : 'Conversa individual'}</span></span></label>`).join('')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cr-ok">Enviar</button>' });
  const bz = $('.ch-pess-busca', md.el); bz.oninput = () => { const t = bz.value.trim().toLowerCase(); $$('.ch-pessoa', md.el).forEach(p => { p.hidden = !!t && !p.dataset.txt.includes(t); }); };
  $('#cr-ok', md.el).onclick = () => {
    const ds = $$('.ch-pessoa input:checked', md.el).map(i => i.value); if (!ds.length) return toast('Escolha ao menos uma conversa', true);
    const txt = $('#cr-txt', md.el).value.trim();
    for (const d of ds) chat.enviar(d, txt, [], { cartao: { tipo, id } });
    md.close(); toast(ds.length === 1 ? 'Enviado no chat' : `Enviado em ${ds.length} conversas`);
  };
}
document.addEventListener('click', (e) => {
  const env = e.target.closest('[data-chat-env]');
  if (env) { e.preventDefault(); e.stopPropagation(); compartilharRegistro(env.dataset.chatEnv, env.dataset.chatId).catch(fail); return; }
  const b = e.target.closest('[data-chat-reg]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  conversaRegistro(b.dataset.chatReg, b.dataset.chatId);
}, true);

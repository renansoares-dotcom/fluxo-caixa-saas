// Notificações: sino na barra superior (lista, não lidas, som) e aviso no computador/celular (Web Push).
// As notificações nascem no banco (gatilhos); aqui só lemos, marcamos como lidas e pedimos o envio do aviso.
import { sb, state, q } from './data.js';
import { $, esc, toast, fail, dateBR } from './ui.js';
import { VAPID_PUBLIC_KEY } from '../config.js';

let timer = null, ultimoTopo = null, lista = [];
const iOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const suportaPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// pede ao servidor para mandar os avisos pendentes (chamar depois de ações que geram notificação)
export async function dispararAvisos() {
  try { await sb.functions.invoke('notificar', { body: {} }); } catch (e) { console.warn('aviso não enviado', e); }
}

export function iniciarNotificacoes() {
  pararNotificacoes();
  const host = $('.topbar-right'); if (!host) return;
  let btn = $('#notif-btn');
  if (!btn) {
    btn = document.createElement('div'); btn.className = 'notif-wrap';
    btn.innerHTML = `<button class="btn ghost icon" id="notif-btn" title="Notificações" aria-label="Notificações">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
      <span class="notif-n" id="notif-n" hidden></span></button><div class="notif-painel" id="notif-painel" hidden></div>`;
    host.insertBefore(btn, host.firstChild);
    $('#notif-btn').onclick = (e) => { e.stopPropagation(); const p = $('#notif-painel'); p.hidden = !p.hidden; if (!p.hidden) pintar(); };
    document.addEventListener('click', (e) => { const p = $('#notif-painel'); if (p && !p.hidden && !e.target.closest('.notif-wrap')) p.hidden = true; });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.empresa) buscar(); });
  }
  registrarSW();
  buscar(true);
  timer = setInterval(buscar, 60000);
}
export function pararNotificacoes() { if (timer) clearInterval(timer); timer = null; ultimoTopo = null; lista = []; }

async function buscar(primeira = false) {
  if (!state.empresa || !state.user) return;
  try {
    lista = await q(sb.from('notificacoes').select('id, tipo, titulo, corpo, link, lida_em, criado_em').eq('empresa_id', state.empresa.id).neq('tipo', 'chat').order('criado_em', { ascending: false }).limit(40));
  } catch { return; }   // tabela ainda não criada: o sino fica quieto
  const novas = lista.filter(n => !n.lida_em).length;
  const n = $('#notif-n'); if (n) { n.hidden = !novas; n.textContent = novas > 9 ? '9+' : novas; }
  if (!primeira && lista[0] && lista[0].id !== ultimoTopo && !lista[0].lida_em) { tocar(); toast(lista[0].titulo); }
  ultimoTopo = lista[0]?.id || null;
  if (!$('#notif-painel')?.hidden) pintar();
}

function tocar() {
  try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.15); } catch {}
}

async function estadoPush() {
  if (!suportaPush()) return iOS() && !instalado() ? 'ios' : 'sem';
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'ativo' : 'inativo';
}

async function pintar() {
  const p = $('#notif-painel'); if (!p) return;
  const est = await estadoPush();
  const avisoTxt = { ativo: '<span class="pos">✔ Avisos ativos neste aparelho</span> <button class="btn ghost small" id="push-off">Desativar</button>',
    inativo: '<button class="btn small primary" id="push-on">Ativar avisos neste aparelho</button>',
    bloqueado: '<span class="neg">Avisos bloqueados no navegador.</span> Libere em Configurações do site › Notificações.',
    ios: 'No iPhone: toque em <strong>Compartilhar › Adicionar à Tela de Início</strong>, abra pelo ícone e ative aqui.',
    sem: 'Este navegador não recebe avisos.' }[est];
  p.innerHTML = `<div class="notif-topo"><strong>Notificações</strong>${lista.some(n => !n.lida_em) ? '<button class="btn ghost small" id="notif-todas">Marcar todas como lidas</button>' : ''}</div>
    <div class="notif-push small">${avisoTxt}</div>
    <div class="notif-lista">${lista.length ? lista.map(n => `<div class="notif-item ${n.lida_em ? '' : 'nova'}" data-id="${n.id}">
      <div class="notif-tit">${esc(n.titulo)}</div>${n.corpo ? `<div class="small muted">${esc(n.corpo)}</div>` : ''}
      <div class="small muted">${quando(n.criado_em)}</div></div>`).join('') : '<div class="empty small">Nenhuma notificação.</div>'}</div>`;
  $('#push-on', p) && ($('#push-on', p).onclick = ativarPush);
  $('#push-off', p) && ($('#push-off', p).onclick = desativarPush);
  $('#notif-todas', p) && ($('#notif-todas', p).onclick = async () => { await marcar(lista.filter(n => !n.lida_em).map(n => n.id)); buscar(); });
  p.querySelector('.notif-lista').onclick = async (e) => {
    const it = e.target.closest('.notif-item'); if (!it) return;
    const n = lista.find(x => x.id === it.dataset.id);
    if (!n.lida_em) await marcar([n.id]);
    p.hidden = true; if (n.link) location.hash = n.link; buscar();
  };
}
const quando = (iso) => { const d = new Date(iso), m = Math.round((Date.now() - d) / 60000); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : dateBR(iso.slice(0, 10)); };
async function marcar(ids) { if (!ids.length) return; try { await q(sb.from('notificacoes').update({ lida_em: new Date().toISOString() }).in('id', ids)); } catch (e) { fail(e); } }

async function registrarSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('service worker', e); return null; }
}
const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };

async function ativarPush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Permissão de aviso não concedida', true); return pintar(); }
    const reg = (await registrarSW()) || await navigator.serviceWorker.ready;
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    await q(sb.rpc('registrar_push', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_aparelho: navigator.userAgent }));
    toast('Avisos ativados neste aparelho');
    reg.showNotification('IPLAMM · Fluxo de Caixa', { body: 'Pronto! Os avisos vão aparecer assim.', icon: 'assets/icon-192.png', badge: 'assets/icon-192.png' });
  } catch (e) { fail(e); }
  pintar();
}
async function desativarPush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await q(sb.rpc('remover_push', { p_endpoint: sub.endpoint })); await sub.unsubscribe(); }
    toast('Avisos desativados neste aparelho');
  } catch (e) { fail(e); }
  pintar();
}

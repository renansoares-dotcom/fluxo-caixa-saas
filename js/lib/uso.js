// Uso da plataforma (melhoria 1.4, 07/11/2026): registra, em lote, a tela aberta e o tempo ATIVO nela (aba em segundo plano e
// 5 minutos sem mexer não contam), os formulários abertos e se foram concluídos ou abandonados, e os erros mostrados.
// Não grava o que foi digitado. O relatório (Cadastros › Uso da Plataforma) é só do administrador. Banco: SQL 099.
import { sb, state } from './data.js';
import { ganchos } from './ui.js';
import { normalizarTexto, rotaLimpa } from './uso-calc.js';

const OCIOSO = 5 * 60e3, ENVIO = 30e3;
let fila = [], atual = null, ligado = false, relogio = null, envio = null, ultimoGesto = Date.now(), ultimoErro = '';

const gesto = () => { ultimoGesto = Date.now(); };
const ativoAgora = () => document.visibilityState === 'visible' && Date.now() - ultimoGesto < OCIOSO;
const evento = (tipo, rota, extra = {}) => { if (ligado && state.empresa && state.user) fila.push({ empresa_id: state.empresa.id, tipo, rota: rotaLimpa(rota), ...extra }); };

function fecharTela() {
  if (!atual) return;
  evento('tela', atual.rota, { segundos: Math.min(86400, atual.seg) });
  atual = null;
}
export async function enviarUso() {
  if (!fila.length) return;
  const lote = fila.splice(0, 200);
  const { error } = await sb.from('uso_eventos').insert(lote);
  // tabela ainda não criada (SQL 099) ou sem permissão: para de registrar nesta sessão
  if (error) { if (/uso_eventos|does not exist|permission/i.test(error.message || '')) ligado = false; }
}

export async function iniciarUso() {
  pararUso();
  ligado = true;
  try { const { data } = await sb.from('uso_config').select('ativo').eq('empresa_id', state.empresa.id).maybeSingle(); if (data && !data.ativo) ligado = false; } catch { /* sem a tabela: o insert desliga */ }
  if (!ligado) return;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, gesto, { passive: true, capture: true }));
  relogio = setInterval(() => { if (atual && ativoAgora()) atual.seg++; }, 1000);
  envio = setInterval(() => enviarUso().catch(() => {}), ENVIO);
  ganchos.form = (titulo, segundos, concluido) => evento('form', atual?.rota || location.hash, { titulo: normalizarTexto(titulo), segundos: Math.min(86400, segundos), concluido });
  ganchos.erro = (msg) => { const t = normalizarTexto(msg); if (!t || t === ultimoErro) return; ultimoErro = t; setTimeout(() => { if (ultimoErro === t) ultimoErro = ''; }, 3000); evento('erro', atual?.rota || location.hash, { titulo: t }); };
}
export function pararUso() {
  fecharTela(); enviarUso().catch(() => {});
  clearInterval(relogio); clearInterval(envio); relogio = envio = null;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.removeEventListener(ev, gesto, { capture: true }));
  ganchos.form = ganchos.erro = null; ligado = false;
}
// chamada a cada troca de tela (js/app.js › render)
export function telaUso(rota) {
  if (!ligado) return;
  const r = rotaLimpa(rota);
  if (atual?.rota === r) return;
  fecharTela(); atual = { rota: r, seg: 0 }; gesto();
}
// aba escondida ou página fechando: fecha a tela e envia o que falta
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && ligado) { const r = atual?.rota; fecharTela(); enviarUso().catch(() => {}); if (r) atual = { rota: r, seg: 0 }; } });
window.addEventListener('pagehide', () => { if (ligado) { fecharTela(); enviarUso().catch(() => {}); } });

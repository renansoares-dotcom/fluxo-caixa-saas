// Verificação pública do crachá (QR Code do verso): sem login, mostra só empresa, nome, cargo, tipo, situação e validade.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const el = document.getElementById('vc');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : 'indeterminada');
const TIPOS = { colaborador: 'Colaborador', terceiro: 'Prestador de serviço', visitante: 'Visitante' };
const SIT = { ativo: 'Crachá válido', vencido: 'Crachá vencido', cancelado: 'Crachá cancelado', devolvido: 'Crachá devolvido', extraviado: 'Crachá extraviado' };
const codigo = new URLSearchParams(location.search).get('c') || '';

async function verificar() {
  if (!/^[0-9a-f]{24}$/.test(codigo)) return mostrar(null);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cracha_verificar`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_codigo: codigo }) });
    if (!r.ok) throw new Error();
    const [c] = await r.json(); mostrar(c || null);
  } catch { el.innerHTML = '<p>Não foi possível verificar agora. Tente de novo em instantes.</p>'; }
}
function mostrar(c) {
  if (!c) { el.innerHTML = '<div class="ic nao">✕</div><div class="sit nao">Crachá não encontrado</div><p class="muted small">O código lido não corresponde a nenhum crachá emitido.</p>'; return; }
  const ok = c.situacao === 'ativo';
  el.innerHTML = `<div class="ic ${ok ? 'ok' : 'nao'}">${ok ? '✓' : '✕'}</div><div class="sit ${ok ? 'ok' : 'nao'}">${esc(SIT[c.situacao] || c.situacao)}</div>
    <div class="muted">${esc(c.empresa)}</div>
    <dl><dt>Nome</dt><dd>${esc(c.nome)}</dd><dt>Tipo</dt><dd>${esc(TIPOS[c.tipo] || c.tipo)}</dd>${c.cargo ? `<dt>Cargo</dt><dd>${esc(c.cargo)}</dd>` : ''}<dt>Validade</dt><dd>${esc(dataBR(c.validade))}</dd></dl>
    <p class="muted small" style="margin-top:16px">Confira se a foto do crachá corresponde ao portador. Verificado em ${new Date().toLocaleString('pt-BR')}.</p>`;
}
verificar();

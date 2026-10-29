// Verificação em duas etapas (MFA) com aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…).
// Supabase Auth, fator TOTP. A regra de acesso fica no banco (SQL 057: _mfa_ok nas funções de permissão);
// aqui ficam as telas: pedir o código ao entrar, ativar e desativar, e ativação obrigatória quando a empresa exige.
import { sb, q } from './data.js';
import { $, esc, modal, toast, fail } from './ui.js';

const campoCodigo = '<label>Código de 6 dígitos<input id="mfa-cod" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" style="font-size:20px;letter-spacing:6px;max-width:180px"></label>';

export async function fatoresVerificados() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.totp || []).filter(f => f.status === 'verified');
}

/** pede o código quando a conta já tem o segundo fator e a sessão ainda não foi confirmada. Resolve true quando liberado. */
export async function exigirCodigo(sair) {
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!(data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2')) return true;
  const [f] = await fatoresVerificados();
  if (!f) return true;
  return new Promise((res) => {
    const m = modal({ title: 'Verificação em duas etapas', fixo: true, body: `<form id="mfa-f" class="form">
        <p style="margin-top:0">Abra o aplicativo autenticador no celular e digite o código da <strong>IPLAMM · plataforma</strong>.</p>
        ${campoCodigo}<div id="mfa-msg" class="msg"></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" type="submit">Confirmar</button><button class="btn ghost" type="button" id="mfa-sair">Sair</button></div></form>` });
    setTimeout(() => $('#mfa-cod', m.el)?.focus(), 50);
    $('#mfa-sair', m.el).onclick = () => { m.close(); res(false); sair?.(); };
    $('#mfa-f', m.el).onsubmit = async (ev) => {
      ev.preventDefault();
      const code = $('#mfa-cod', m.el).value.trim();
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code });
      if (error) { $('#mfa-msg', m.el).innerHTML = '<span class="neg">Código inválido ou vencido. Confira a hora do celular e tente de novo.</span>'; $('#mfa-cod', m.el).select(); return; }
      m.close(); res(true);
    };
  });
}

/** cadastra o autenticador: mostra o QR Code e confirma com o primeiro código. obrigatoria = não dá para pular. */
export function ativar({ obrigatoria = false, sair } = {}) {
  return new Promise(async (res) => {
    let fator;
    try {
      // fator pendente de uma tentativa anterior: remove para gerar um QR novo
      const { data } = await sb.auth.mfa.listFactors();
      for (const x of (data?.all || []).filter(x => x.factor_type === 'totp' && x.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: x.id });
      const r = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'IPLAMM · plataforma' });
      if (r.error) throw r.error;
      fator = r.data;
    } catch (e) { fail(e); return res(false); }
    const qr = fator.totp.qr_code.startsWith('data:') ? fator.totp.qr_code : 'data:image/svg+xml;utf-8,' + encodeURIComponent(fator.totp.qr_code);
    const m = modal({ title: 'Ativar a verificação em duas etapas', fixo: obrigatoria, body: `<form id="mfa-f" class="form">
        ${obrigatoria ? '<p class="warn" style="margin-top:0"><strong>A empresa exige a verificação em duas etapas para o seu perfil.</strong> Ative agora para continuar.</p>' : ''}
        <ol class="small" style="padding-left:18px;margin:0 0 8px">
          <li>Instale no celular um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou Authy).</li>
          <li>No aplicativo, escolha <strong>adicionar conta</strong> e leia o QR Code abaixo.</li>
          <li>Digite o código de 6 dígitos que aparecer no aplicativo.</li></ol>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><img src="${esc(qr)}" alt="QR Code" style="width:180px;height:180px;background:#fff;padding:6px;border-radius:8px">
          <div class="small">Sem câmera? Digite a chave no aplicativo:<br><code style="word-break:break-all">${esc(fator.totp.secret)}</code></div></div>
        ${campoCodigo}<div id="mfa-msg" class="msg"></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" type="submit">Ativar</button>${obrigatoria ? '<button class="btn ghost" type="button" id="mfa-sair">Sair</button>' : '<button class="btn ghost" type="button" data-close>Agora não</button>'}</div></form>` });
    m.el.addEventListener('click', (e) => { if (!obrigatoria && (e.target === m.el || e.target.closest('[data-close]'))) { sb.auth.mfa.unenroll({ factorId: fator.id }).catch(() => {}); res(false); } });
    $('#mfa-sair', m.el) && ($('#mfa-sair', m.el).onclick = () => { m.close(); res(false); sair?.(); });
    setTimeout(() => $('#mfa-cod', m.el)?.focus(), 50);
    $('#mfa-f', m.el).onsubmit = async (ev) => {
      ev.preventDefault();
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: fator.id, code: $('#mfa-cod', m.el).value.trim() });
      if (error) { $('#mfa-msg', m.el).innerHTML = '<span class="neg">Código inválido. Confira se leu o QR Code certo e se a hora do celular está correta.</span>'; return; }
      m.close(); toast('Verificação em duas etapas ativada. Nos próximos acessos o código será pedido.'); res(true);
    };
  });
}

/** ao entrar: confirma o código (se já tem) e, se a empresa exige para o perfil e a pessoa não tem, obriga a ativar */
export async function verificarAoEntrar(sair) {
  if (!await exigirCodigo(sair)) return false;
  let exige = false;
  try { exige = !!(await q(sb.rpc('mfa_exigido'))); } catch { /* SQL 057 ainda não rodou: segue sem exigir */ }
  if (exige && !(await fatoresVerificados()).length) return ativar({ obrigatoria: true, sair });
  return true;
}

/** botão "Verificação em duas etapas" do menu: estado, ativar e desativar */
export async function gerenciar() {
  let fs = [];
  try { fs = await fatoresVerificados(); } catch (e) { return fail(e); }
  if (!fs.length) return ativar();
  let exige = false; try { exige = !!(await q(sb.rpc('mfa_exigido'))); } catch {}
  const m = modal({ title: 'Verificação em duas etapas', body: `<p style="margin-top:0"><span class="badge pago">ativada</span> Ao entrar, a plataforma pede o código do aplicativo autenticador.</p>
      <p class="small muted">Trocou de celular? Desative e ative de novo, lendo o QR Code no aparelho novo.</p>
      ${exige ? '<p class="small warn">A empresa exige a verificação para o seu perfil: se desativar, ela será pedida de novo no próximo acesso.</p>' : ''}`,
    foot: '<button class="btn danger" id="mfa-off" style="margin-right:auto">Desativar</button><button class="btn" data-close>Fechar</button>' });
  $('#mfa-off', m.el).onclick = async () => {
    // desativar exige a sessão já confirmada com o código (aal2)
    for (const f of fs) { const { error } = await sb.auth.mfa.unenroll({ factorId: f.id }); if (error) return fail(new Error('Para desativar, saia e entre de novo confirmando o código. ' + error.message)); }
    m.close(); toast('Verificação em duas etapas desativada');
  };
}

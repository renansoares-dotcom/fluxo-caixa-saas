// Termo de uso e aviso de privacidade no acesso (melhoria 1.10, SQL 100). Usado na plataforma (lgpd_entrar, que também grava
// o último acesso) e no Portal do Cliente (portal_termo_pendente). Sem o SQL 100 ou sem termo publicado, não mostra nada.
import { $, esc, modal, toast, dateBR } from './ui.js';
import { termoHTML } from './lgpd-calc.js';

export async function exigirTermo(sb, rpc, args, { sair } = {}) {
  let t;
  try { const { data, error } = await sb.rpc(rpc, args); if (error) return; t = data; } catch { return; }
  if (!t?.id) return;
  return new Promise((resolve) => {
    const m = modal({ title: t.titulo, fixo: true, wide: true,
      body: `${t.empresa ? `<div class="small muted" style="margin-bottom:6px">${esc(t.empresa)}</div>` : ''}
        ${t.anterior ? '<div class="card" style="background:var(--warn-soft);margin-bottom:10px;padding:10px 12px">O termo foi <b>atualizado</b>. Leia e aceite a nova versão para continuar.</div>' : ''}
        <div class="termo-texto" id="tm-txt" style="max-height:52vh;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 16px;line-height:1.55">${termoHTML(t.texto)}</div>
        <label class="chk" style="flex-direction:row;align-items:center;gap:8px;font-weight:400;margin-top:12px"><input type="checkbox" id="tm-li" style="width:auto;min-height:0"> Li e aceito o termo (versão ${t.versao}, de ${dateBR(String(t.publicado_em).slice(0, 10))})</label>`,
      foot: `${sair ? '<button class="btn" id="tm-sair">Sair</button>' : ''}<button class="btn primary" id="tm-ok" disabled>Aceitar e continuar</button>` });
    $('#tm-li', m.el).onchange = (e) => { $('#tm-ok', m.el).disabled = !e.target.checked; };
    if (sair) $('#tm-sair', m.el).onclick = () => { m.close(); sair(); resolve(false); };
    $('#tm-ok', m.el).onclick = async (e) => {
      e.target.disabled = true;
      const { error } = await sb.rpc('lgpd_aceitar', { p_termo: t.id, p_navegador: navigator.userAgent.slice(0, 200) });
      if (error) { e.target.disabled = false; toast(error.message, true); return; }
      m.close(); toast('Termo aceito. Obrigado!'); resolve(true);
      // portal com mais de uma empresa: pode haver outro termo
      if (rpc === 'portal_termo_pendente') exigirTermo(sb, rpc, args, { sair });
    };
  });
}

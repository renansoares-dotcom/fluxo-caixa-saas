// E-mail da plataforma (SQL 092) — montagem do e-mail a partir do modelo: troca os {{campos}}, tira as linhas vazias,
// monta o HTML (cabeçalho com o nome da empresa, parágrafos, botão com o link e o rodapé) e a versão em texto.
// A MESMA função está copiada na função "email" do Supabase (supabase/functions/email/index.ts): mudou aqui, mude lá.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const trocar = (t, c = {}) => String(t ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (c[k] == null ? '' : String(c[k])));

/** monta { assunto, html, texto } */
export function montar(modelo, campos = {}, cfg = {}) {
  const base = String(cfg.url_base || '').replace(/\/?$/, '/');
  const link = campos.caminho ? base + String(campos.caminho).replace(/^\//, '') : null;
  const assunto = trocar(modelo.assunto, campos).replace(/\s+/g, ' ').trim();
  const paras = trocar(modelo.corpo, campos).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const cor = campos.urgente ? '#c62828' : '#1f4e9c';
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e6ee">
<tr><td style="background:${cor};color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">${esc(campos.empresa || cfg.remetente_nome || '')}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${paras.map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
${link && modelo.botao ? `<p style="margin:22px 0 8px"><a href="${esc(link)}" style="display:inline-block;background:${cor};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${esc(trocar(modelo.botao, campos))}</a></p>
<p style="margin:0;font-size:12px;color:#6b7385">Se o botão não abrir, copie este endereço: ${esc(link)}</p>` : ''}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e2e6ee;font-size:12px;color:#6b7385">${esc(cfg.rodape || '')}</td></tr>
</table></td></tr></table></body></html>`;
  const texto = [...paras, link ? `${trocar(modelo.botao || 'Abrir', campos)}: ${link}` : '', cfg.rodape || ''].filter(Boolean).join('\n\n');
  return { assunto, html, texto, link };
}

export const SITUACAO = { pendente: 'Na fila', enviado: 'Enviado', erro: 'Erro', ignorado: 'Não enviado' };

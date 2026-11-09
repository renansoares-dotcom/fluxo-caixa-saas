// Envia os e-mails da fila (email_fila) pelo provedor Resend, com o remetente e os modelos de cada empresa.
// Só envia quando a empresa ligou o e-mail (email_config.ativo) e existe o segredo RESEND_API_KEY.
// Quem chama: a plataforma logo depois de uma ação (usuário logado) ou o agendamento do banco a cada minuto
// (cabeçalho x-cron-chave = segredo CRON_CHAVE). O conteúdo vem do banco; quem chama não escolhe destinatário nem texto.
// Segredos: RESEND_API_KEY, CRON_CHAVE. A montagem do e-mail é cópia de js/lib/email.js (mudou lá, mude aqui).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-chave',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trocar = (t: unknown, c: any = {}) => String(t ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_: string, k: string) => (c[k] == null ? '' : String(c[k])));

// relatório agendado (melhoria 1.7): tabelas montadas pelo banco (rel_previa); todo conteúdo é escapado aqui
function tabelasHtml(tabs: any, base: string) {
  if (!Array.isArray(tabs) || !tabs.length) return '';
  return tabs.map((t: any) => `<h3 style="margin:22px 0 2px;font-size:16px">${esc(t.titulo)}</h3><div style="font-size:12px;color:#6b7385;margin-bottom:8px">${esc(t.periodo || '')}</div>` +
    (t.erro ? `<p style="color:#c62828;font-size:13px">Não foi possível montar este bloco: ${esc(t.erro)}</p>` :
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
<tr><th align="left" style="border-bottom:2px solid #e2e6ee;padding:6px 4px">${esc(t.colunas?.[0] || '')}</th><th align="right" style="border-bottom:2px solid #e2e6ee;padding:6px 4px">${esc(t.colunas?.[1] || '')}</th></tr>
${(t.linhas || []).map((l: any) => `<tr><td style="border-bottom:1px solid #eef1f6;padding:5px 4px">${esc(l[0])}</td><td align="right" style="border-bottom:1px solid #eef1f6;padding:5px 4px;white-space:nowrap">${esc(l[1])}</td></tr>`).join('')}
${t.total ? `<tr><td style="padding:6px 4px;font-weight:bold">Total</td><td align="right" style="padding:6px 4px;font-weight:bold;white-space:nowrap">${esc(t.total)}</td></tr>` : ''}</table>` +
    (t.link && base ? `<div style="font-size:12px;margin-top:6px"><a href="${esc(base + 'index.html' + t.link)}" style="color:#1f4e9c">Abrir ${esc(t.rotulo || 'na plataforma')}</a></div>` : ''))).join('');
}
function tabelasTexto(tabs: any) {
  if (!Array.isArray(tabs) || !tabs.length) return '';
  return tabs.map((t: any) => [`${t.titulo} — ${t.periodo || ''}`, ...(t.erro ? [`  (erro: ${t.erro})`] : (t.linhas || []).map((l: any) => `  ${l[0]}: ${l[1]}`)), t.total ? `  Total: ${t.total}` : ''].filter(Boolean).join('\n')).join('\n\n');
}

/** monta { assunto, html, texto } */
function montar(modelo: any, campos: any = {}, cfg: any = {}) {
  const base = String(cfg.url_base || '').replace(/\/?$/, '/');
  const link = campos.caminho ? base + String(campos.caminho).replace(/^\//, '') : null;
  const assunto = trocar(modelo.assunto, campos).replace(/\s+/g, ' ').trim();
  const paras = trocar(modelo.corpo, campos).split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean);
  const cor = campos.urgente ? '#c62828' : '#1f4e9c';
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e6ee">
<tr><td style="background:${cor};color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">${esc(campos.empresa || cfg.remetente_nome || '')}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">${paras.map((p: string) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}
${tabelasHtml(campos.tabelas, base)}
${link && modelo.botao ? `<p style="margin:22px 0 8px"><a href="${esc(link)}" style="display:inline-block;background:${cor};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">${esc(trocar(modelo.botao, campos))}</a></p>
<p style="margin:0;font-size:12px;color:#6b7385">Se o botão não abrir, copie este endereço: ${esc(link)}</p>` : ''}</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e2e6ee;font-size:12px;color:#6b7385">${esc(cfg.rodape || '')}</td></tr>
</table></td></tr></table></body></html>`;
  const texto = [...paras, tabelasTexto(campos.tabelas), link ? `${trocar(modelo.botao || 'Abrir', campos)}: ${link}` : '', cfg.rodape || ''].filter(Boolean).join('\n\n');
  return { assunto, html, texto, link };
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const chave = Deno.env.get('CRON_CHAVE') || '';
    if (!(chave && req.headers.get('x-cron-chave') === chave)) {
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: u } = tok ? await sb.auth.getUser(tok) : { data: { user: null } };
      if (!u?.user) return json({ erro: 'não autorizado' }, 401);
    }
    const key = Deno.env.get('RESEND_API_KEY') || '';
    // e-mails com mais de 7 dias na fila não saem mais
    await sb.from('email_fila').update({ situacao: 'ignorado', erro: 'mais de 7 dias na fila' }).eq('situacao', 'pendente').lt('criado_em', new Date(Date.now() - 7 * 864e5).toISOString());
    const { data: pend, error } = await sb.from('email_fila').select('*').eq('situacao', 'pendente').order('criado_em').limit(50);
    if (error) throw error;
    if (!pend?.length) return json({ enviados: 0 });
    const emps = [...new Set(pend.map((e) => e.empresa_id))];
    const [{ data: cfgs }, { data: mods }, { data: pads }] = await Promise.all([
      sb.from('email_config').select('*').in('empresa_id', emps),
      sb.from('email_modelos').select('*').in('empresa_id', emps),
      sb.rpc('email_padrao'),
    ]);
    const cfg = new Map((cfgs ?? []).map((c) => [c.empresa_id, c]));
    let enviados = 0, erros = 0, esperando = 0;
    for (const e of pend) {
      const c = cfg.get(e.empresa_id);
      if (!c?.ativo || !key) { esperando++; continue; }            // e-mail desligado ou sem a chave: espera
      const m = (mods ?? []).find((x) => x.empresa_id === e.empresa_id && x.codigo === e.codigo) || (pads ?? []).find((x) => x.codigo === e.codigo);
      if (!m) { await sb.from('email_fila').update({ situacao: 'erro', erro: 'modelo não encontrado: ' + e.codigo }).eq('id', e.id); erros++; continue; }
      const { data: trava } = await sb.from('email_fila').update({ tentativas: e.tentativas + 1 }).eq('id', e.id).eq('situacao', 'pendente').eq('tentativas', e.tentativas).select('id');
      if (!trava?.length) continue;                                 // outra chamada pegou
      const msg = montar(m, e.campos || {}, c);
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `${c.remetente_nome} <${c.remetente_email}>`, to: [e.para], subject: msg.assunto, html: msg.html, text: msg.texto,
            ...(c.responder_para ? { reply_to: c.responder_para } : {}) }),
        });
        const b = await r.json().catch(() => ({}));
        if (r.ok) { await sb.from('email_fila').update({ situacao: 'enviado', enviado_em: new Date().toISOString(), provedor_id: b.id || null, erro: null }).eq('id', e.id); enviados++; }
        else {
          const final = (r.status < 500 && r.status !== 429) || e.tentativas + 1 >= 5;   // erro de dados (ex.: domínio não validado) não insiste; limite (429) tenta de novo
          await sb.from('email_fila').update({ situacao: final ? 'erro' : 'pendente', erro: `${r.status}: ${b.message || b.name || 'falha'}`.slice(0, 400) }).eq('id', e.id); erros++;
        }
      } catch (err) {
        await sb.from('email_fila').update({ situacao: e.tentativas + 1 >= 5 ? 'erro' : 'pendente', erro: String((err as Error).message).slice(0, 400) }).eq('id', e.id); erros++;
      }
    }
    return json({ enviados, erros, esperando, sem_chave: !key });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});

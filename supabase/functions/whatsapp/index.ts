// Envia as mensagens da fila (wa_fila) pela API oficial do WhatsApp (WhatsApp Cloud API, Meta), com os modelos aprovados.
// Só envia quando a empresa ligou o WhatsApp (wa_config.ativo, com o phone_number_id) e existe o segredo WHATSAPP_TOKEN.
// Quem chama: a plataforma logo depois de uma ação (usuário logado) ou o agendamento do banco a cada minuto
// (cabeçalho x-cron-chave = segredo CRON_CHAVE). O conteúdo e o destinatário vêm do banco.
// Segredos: WHATSAPP_TOKEN (token permanente do usuário do sistema na Meta), CRON_CHAVE.
// A montagem da mensagem é cópia de js/lib/whatsapp.js (mudou lá, mude aqui).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-chave',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const VERSAO = 'v21.0';

function limpar(v: unknown) {
  const t = String(v ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim().slice(0, 1024);
  return t || '-';
}
function mensagem(modelo: any, campos: any = {}, para: string, idioma = 'pt_BR') {
  const comps: any[] = [];
  const ps = (modelo.parametros || []).map((k: string) => ({ type: 'text', text: limpar(campos[k]) }));
  if (ps.length) comps.push({ type: 'body', parameters: ps });
  if (modelo.botao_campo && campos[modelo.botao_campo]) comps.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: String(campos[modelo.botao_campo]).replace(/^\//, '').slice(0, 2000) }] });
  return { messaging_product: 'whatsapp', to: para, type: 'template', template: { name: modelo.template, language: { code: idioma }, ...(comps.length ? { components: comps } : {}) } };
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
    const token = Deno.env.get('WHATSAPP_TOKEN') || '';
    // mensagens com mais de 3 dias na fila não saem mais (perderam o sentido)
    await sb.from('wa_fila').update({ situacao: 'ignorado', erro: 'mais de 3 dias na fila' }).eq('situacao', 'pendente').lt('criado_em', new Date(Date.now() - 3 * 864e5).toISOString());
    const { data: pend, error } = await sb.from('wa_fila').select('*').eq('situacao', 'pendente').order('criado_em').limit(50);
    if (error) throw error;
    if (!pend?.length) return json({ enviados: 0 });
    const emps = [...new Set(pend.map((e) => e.empresa_id))];
    const [{ data: cfgs }, { data: mods }, { data: pads }] = await Promise.all([
      sb.from('wa_config').select('*').in('empresa_id', emps),
      sb.from('wa_modelos').select('*').in('empresa_id', emps),
      sb.rpc('wa_padrao'),
    ]);
    const cfg = new Map((cfgs ?? []).map((c) => [c.empresa_id, c]));
    let enviados = 0, erros = 0, esperando = 0;
    for (const e of pend) {
      const c = cfg.get(e.empresa_id);
      if (!c?.ativo || !c.phone_number_id || !token) { esperando++; continue; }   // desligado, sem número ou sem token: espera
      const m = (mods ?? []).find((x) => x.empresa_id === e.empresa_id && x.codigo === e.codigo) || (pads ?? []).find((x) => x.codigo === e.codigo);
      if (!m) { await sb.from('wa_fila').update({ situacao: 'erro', erro: 'modelo não encontrado: ' + e.codigo }).eq('id', e.id); erros++; continue; }
      const { data: trava } = await sb.from('wa_fila').update({ tentativas: e.tentativas + 1 }).eq('id', e.id).eq('situacao', 'pendente').eq('tentativas', e.tentativas).select('id');
      if (!trava?.length) continue;                                                 // outra chamada pegou
      try {
        const r = await fetch(`https://graph.facebook.com/${VERSAO}/${c.phone_number_id}/messages`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(mensagem(m, e.campos || {}, e.para, c.idioma || 'pt_BR')),
        });
        const b = await r.json().catch(() => ({}));
        if (r.ok) { await sb.from('wa_fila').update({ situacao: 'enviado', enviado_em: new Date().toISOString(), provedor_id: b?.messages?.[0]?.id || null, erro: null }).eq('id', e.id); enviados++; }
        else {
          const msg = b?.error ? `${b.error.code || r.status}: ${b.error.error_user_msg || b.error.message || 'falha'}` : `${r.status}: falha`;
          const final = (r.status < 500 && r.status !== 429) || e.tentativas + 1 >= 5;   // modelo não aprovado, número inválido: não insiste
          await sb.from('wa_fila').update({ situacao: final ? 'erro' : 'pendente', erro: msg.slice(0, 400) }).eq('id', e.id); erros++;
        }
      } catch (err) {
        await sb.from('wa_fila').update({ situacao: e.tentativas + 1 >= 5 ? 'erro' : 'pendente', erro: String((err as Error).message).slice(0, 400) }).eq('id', e.id); erros++;
      }
    }
    return json({ enviados, erros, esperando, sem_token: !token });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});

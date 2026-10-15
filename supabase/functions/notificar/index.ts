// Envia para o computador/celular (Web Push) as notificações ainda não enviadas.
// Chamada pela plataforma logo depois de uma ação que gera notificação (só usuário logado chama).
// Lê as notificações com a chave de serviço; o conteúdo vem do banco, nunca de quem chamou.
// Segredos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

    // pega as pendentes dos últimos 2 dias e marca como enviadas antes de mandar (evita aviso em dobro)
    const desde = new Date(Date.now() - 2 * 864e5).toISOString();
    const { data: pend, error } = await sb.from('notificacoes').select('id, user_id, titulo, corpo, link, tipo')
      .is('enviado_em', null).gte('criado_em', desde).order('criado_em').limit(200);
    if (error) throw error;
    let enviadas = 0, aparelhos = 0, removidos = 0;
    for (const n of pend ?? []) {
      const { data: marcada } = await sb.from('notificacoes').update({ enviado_em: new Date().toISOString() }).eq('id', n.id).is('enviado_em', null).select('id');
      if (!marcada?.length) continue;                       // outra chamada já enviou
      const { data: subs } = await sb.from('push_inscricoes').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id);
      const payload = JSON.stringify({ titulo: n.titulo, corpo: n.corpo, link: n.link, tag: `${n.tipo}-${n.id}` });
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
          aparelhos++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { await sb.from('push_inscricoes').delete().eq('id', s.id); removidos++; }   // aparelho desinscrito
          else console.error('push falhou', code, (e as Error).message);
        }
      }
      enviadas++;
    }
    return json({ enviadas, aparelhos, removidos });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});

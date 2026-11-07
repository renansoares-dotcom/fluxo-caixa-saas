// Envia para o computador/celular (Web Push) as notificações ainda não enviadas, respeitando "Meus avisos":
//  - tipo desligado no celular pela pessoa → não envia (fica só no sino);
//  - horário de silêncio (padrão 20h–7h e fim de semana) → espera o fim do silêncio; aviso URGENTE passa sempre.
// Quem chama: a plataforma logo depois de uma ação (usuário logado) ou o agendamento do banco a cada minuto
// (cabeçalho x-cron-chave = segredo CRON_CHAVE). A função só esvazia a fila: o conteúdo vem do banco, nunca de quem chamou.
// Segredos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), CRON_CHAVE.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-chave',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

type Hor = { silencio: boolean; inicio: string; fim: string; fim_de_semana: boolean; fuso: string };
const PADRAO: Hor = { silencio: true, inicio: '20:00', fim: '07:00', fim_de_semana: true, fuso: 'America/Sao_Paulo' };
const min = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

/** está no horário de silêncio da pessoa agora? */
export function emSilencio(h: Hor, agora = new Date()): boolean {
  if (!h.silencio) return false;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: h.fuso || PADRAO.fuso, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(agora).map((x) => [x.type, x.value]));
  if (h.fim_de_semana && (p.weekday === 'Sat' || p.weekday === 'Sun')) return true;
  const m = (Number(p.hour) % 24) * 60 + Number(p.minute), i = min(h.inicio), f = min(h.fim);
  return i === f ? false : i > f ? m >= i || m < f : m >= i && m < f;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    // quem pode chamar: o agendamento (chave) ou um usuário logado
    const chave = Deno.env.get('CRON_CHAVE') || '';
    if (!(chave && req.headers.get('x-cron-chave') === chave)) {
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: u } = tok ? await sb.auth.getUser(tok) : { data: { user: null } };
      if (!u?.user) return json({ erro: 'não autorizado' }, 401);
    }
    const [pub, priv, subj] = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].map((k) => Deno.env.get(k) || '');
    if (!pub || !priv || !subj) return json({ erro: 'faltam os segredos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT na função notificar' });
    webpush.setVapidDetails(subj, pub, priv);

    const desde = new Date(Date.now() - 4 * 864e5).toISOString();
    const { data: pend, error } = await sb.from('notificacoes').select('id, user_id, empresa_id, titulo, corpo, link, tipo, urgente')
      .is('enviado_em', null).gte('criado_em', desde).order('criado_em').limit(300);
    if (error) throw error;
    if (!pend?.length) return json({ enviadas: 0 });
    const users = [...new Set(pend.map((n) => n.user_id))];
    const [{ data: tipos }, { data: prefs }, { data: hors }] = await Promise.all([
      sb.from('notif_tipos').select('codigo, urgente'),
      sb.from('notif_preferencias').select('user_id, empresa_id, tipo, push').in('user_id', users),
      sb.from('notif_horarios').select('user_id, empresa_id, silencio, inicio, fim, fim_de_semana, fuso').in('user_id', users),
    ]);
    const cat = (tipos ?? []).sort((a, b) => b.codigo.length - a.codigo.length);
    const codigo = (t: string) => cat.find((c) => t === c.codigo || t.startsWith(c.codigo + '_'));
    const pref = new Map((prefs ?? []).map((p) => [`${p.user_id}|${p.empresa_id}|${p.tipo}`, p.push]));
    const hor = new Map((hors ?? []).map((h) => [`${h.user_id}|${h.empresa_id}`, h as Hor]));
    const agora = new Date();
    let enviadas = 0, aparelhos = 0, removidos = 0, silencio = 0, desligadas = 0;
    const marcar = (id: string, sit: string) => sb.from('notificacoes').update({ enviado_em: new Date().toISOString(), push_situacao: sit }).eq('id', id).is('enviado_em', null).select('id');

    for (const n of pend) {
      const c = codigo(n.tipo), urg = !!n.urgente || !!c?.urgente;
      if (c && pref.get(`${n.user_id}|${n.empresa_id}|${c.codigo}`) === false) { await marcar(n.id, 'desligado'); desligadas++; continue; }
      if (!urg && emSilencio(hor.get(`${n.user_id}|${n.empresa_id}`) || PADRAO, agora)) { silencio++; continue; }   // fica na fila
      const { data: subs } = await sb.from('push_inscricoes').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id);
      const { data: marcada } = await marcar(n.id, subs?.length ? 'enviado' : 'sem_aparelho');
      if (!marcada?.length) continue;                       // outra chamada já enviou
      const payload = JSON.stringify({ titulo: (urg ? '🔴 ' : '') + n.titulo, corpo: n.corpo, link: n.link, tag: `${n.tipo}-${n.id}`, urgente: urg });
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: urg ? 'high' : 'normal' });
          aparelhos++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          // 404/410: aparelho desinscrito; 403: inscrição feita com outra chave VAPID (o navegador se inscreve de novo sozinho)
          if (code === 404 || code === 410 || code === 403) { await sb.from('push_inscricoes').delete().eq('id', s.id); removidos++; }
          else console.error('push falhou', code, (e as Error).message);
        }
      }
      enviadas++;
    }
    return json({ enviadas, aparelhos, removidos, silencio, desligadas });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});

// NF-e de entrada automática (melhoria 9.1): consulta a Distribuição DF-e da SEFAZ e manifesta, pela ponte da Vercel
// (ponte-sefaz/, que leva o certificado A1). Quem chama: o agendamento do banco a cada hora (x-cron-chave = CRON_CHAVE)
// ou o usuário na tela "NF-e da SEFAZ" (consultar agora / manifestar), com o token dele.
// Segredos: SEFAZ_PONTE_URL, SEFAZ_PONTE_CHAVE, CRON_CHAVE. O que volta da SEFAZ é gravado pelo banco (dfe_registrar).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-chave',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const TIPOS: Record<string, number> = { ciencia: 210210, confirmacao: 210200, desconhecimento: 210220, nao_realizada: 210240 };

async function ponte(corpo: Record<string, unknown>) {
  const url = Deno.env.get('SEFAZ_PONTE_URL'), chave = Deno.env.get('SEFAZ_PONTE_CHAVE');
  if (!url || !chave) return { ok: false, erro: 'ponte da SEFAZ não configurada (segredos SEFAZ_PONTE_URL e SEFAZ_PONTE_CHAVE)' };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ponte-chave': chave }, body: JSON.stringify(corpo) });
    return await r.json().catch(() => ({ ok: false, erro: `ponte respondeu HTTP ${r.status}` }));
  } catch (e) { return { ok: false, erro: 'ponte inacessível: ' + (e as Error).message }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const adm = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const b = await req.json().catch(() => ({}));
    const cron = !!Deno.env.get('CRON_CHAVE') && req.headers.get('x-cron-chave') === Deno.env.get('CRON_CHAVE');
    let empresa: string | null = null;
    if (!cron) {
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: u } = tok ? await adm.auth.getUser(tok) : { data: { user: null } };
      if (!u?.user) return json({ erro: 'não autorizado' }, 401);
      const usr = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${tok}` } } });
      empresa = b.empresa_id || null;
      const { data: pode } = empresa ? await usr.rpc('dfe_pode', { p_empresa: empresa }) : { data: false };
      if (!pode) return json({ erro: 'Sem acesso às NF-e da SEFAZ desta empresa.' }, 403);
    }

    // ---- manifestar (usuário) ----
    if (b.acao === 'manifestar') {
      const tipo = TIPOS[b.tipo];
      if (!tipo) return json({ erro: 'Manifestação inválida.' }, 400);
      const { data: doc } = await adm.from('dfe_documentos').select('id, chave, empresa_id').eq('id', b.documento_id).eq('empresa_id', empresa).single();
      if (!doc) return json({ erro: 'Documento não encontrado.' }, 404);
      const [{ data: cfg }, { data: emp }] = await Promise.all([adm.from('dfe_config').select('ambiente').eq('empresa_id', empresa).single(), adm.from('empresas').select('cnpj').eq('id', empresa).single()]);
      const r = await ponte({ acao: 'manifestar', ambiente: cfg?.ambiente || 'producao', cnpj: emp?.cnpj, chave: doc.chave, tipo, justificativa: b.justificativa || '' });
      await adm.rpc('dfe_manifestado', { p_doc: doc.id, p_tipo: b.tipo, p_cstat: r.ok ? r.cStat : null, p_motivo: r.ok ? r.xMotivo : r.erro, p_just: b.justificativa || null });
      return json({ ok: r.ok && ['135', '136', '573'].includes(r.cStat), cStat: r.cStat, motivo: r.ok ? r.xMotivo : r.erro });
    }

    // ---- consultar (agendamento: todas as empresas na hora; usuário: a empresa dele, respeitando a 1 hora) ----
    const { data: lista } = await adm.rpc('dfe_para_consultar', { p_empresa: null });
    const alvo = (lista || []).filter((e: any) => !empresa || e.empresa_id === empresa);
    if (empresa && !alvo.length) return json({ ok: true, aviso: 'A SEFAZ só permite nova consulta 1 hora depois da última sem documentos. Tente mais tarde.' });
    const res: any[] = [];
    for (const e of alvo) {
      let ult = e.ultimo_nsu, voltas = 0, novas = 0, xml = 0, erro = null;
      while (voltas < 10) {   // até 500 documentos por vez
        voltas++;
        const r = await ponte({ acao: 'distribuicao', ambiente: e.ambiente, cUF: e.cuf, cnpj: e.cnpj, ultNSU: ult });
        const { data: g, error } = await adm.rpc('dfe_registrar', { p_empresa: e.empresa_id, p_resp: r.ok ? r : { erro: r.erro, cStat: null } });
        if (error) { erro = error.message; break; }
        if (!r.ok) { erro = r.erro; break; }
        novas += g?.novas || 0; xml += g?.xml || 0; ult = r.ultNSU;
        if (!g?.mais) break;
      }
      // ciência automática dos resumos (libera o XML completo na próxima consulta)
      let ciencias = 0;
      if (e.ciencia_automatica && !erro) {
        const { data: pend } = await adm.rpc('dfe_para_ciencia', { p_empresa: e.empresa_id, p_limite: 20 });
        for (const d of pend || []) {
          const r = await ponte({ acao: 'manifestar', ambiente: e.ambiente, cnpj: e.cnpj, chave: d.chave, tipo: 210210 });
          await adm.rpc('dfe_manifestado', { p_doc: d.id, p_tipo: 'ciencia', p_cstat: r.ok ? r.cStat : null, p_motivo: r.ok ? r.xMotivo : r.erro });
          if (r.ok && ['135', '136', '573'].includes(r.cStat)) ciencias++;
        }
      }
      res.push({ empresa_id: e.empresa_id, novas, xml, ciencias, erro });
    }
    return json({ ok: true, empresas: res });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});

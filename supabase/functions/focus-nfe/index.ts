// Emissão de NF-e pela API da Focus NFe (v2). A tela (CPD › Emissão de NF-e) chama esta função com o token do usuário;
// a função confere a permissão (nfe_pode), fala com a Focus com o token guardado em segredo e grava o retorno no banco
// (nfe_registrar, só service_role). O token da Focus nunca vai para o navegador nem para o banco.
// Segredos: FOCUS_NFE_TOKEN_HOMOLOGACAO e FOCUS_NFE_TOKEN_PRODUCAO (para uma empresa específica, acrescente _<CNPJ só dígitos>);
// FOCUS_NFE_HOOK_CHAVE (opcional): chave do gatilho que a Focus chama quando a nota muda de situação (?hook=<chave>).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const HOST: Record<string, string> = { homologacao: 'https://homologacao.focusnfe.com.br', producao: 'https://api.focusnfe.com.br' };
const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const refDe = (id: string) => id.replace(/-/g, '');

function token(ambiente: string, cnpj: string) {
  const base = `FOCUS_NFE_TOKEN_${ambiente === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO'}`;
  return Deno.env.get(`${base}_${cnpj}`) || Deno.env.get(base) || '';
}
async function focus(ambiente: string, tok: string, metodo: string, caminho: string, corpo?: unknown) {
  try {
    const r = await fetch(HOST[ambiente] + caminho, { method: metodo, headers: { Authorization: 'Basic ' + btoa(tok + ':'), ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    const txt = await r.text(); let d: any = null;
    try { d = JSON.parse(txt); } catch { d = { mensagem: r.status === 401 ? 'Token da Focus NFe recusado (confira o segredo deste ambiente).' : txt.slice(0, 300) }; }
    return { http: r.status, d };
  } catch (e) { return { http: 0, d: { mensagem: 'Focus NFe inacessível: ' + (e as Error).message } }; }
}
const situacao = (d: any) => d?.status === 'autorizado' ? 'autorizada' : d?.status === 'cancelado' ? 'cancelada' : d?.status === 'denegado' ? 'denegada' : d?.status === 'processando_autorizacao' ? 'processando' : 'erro';
const erros = (d: any) => { const L: string[] = [];
  if (d?.mensagem_sefaz && !['autorizado', 'cancelado'].includes(d.status)) L.push(`${d.status_sefaz ? d.status_sefaz + ' - ' : ''}${d.mensagem_sefaz}`);
  if (d?.mensagem && !d?.erros?.length) L.push(d.mensagem);
  for (const e of d?.erros || []) L.push(`${e.campo ? e.campo + ': ' : ''}${e.mensagem || e.codigo || ''}`);
  return L; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const adm = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const b = await req.json().catch(() => ({}));

    // grava o que a Focus devolveu sobre a nota e, se autorizada ou cancelada, guarda o XML
    const gravar = async (nota: any, tok: string, d: any) => {
      const st = situacao(d), dados: Record<string, unknown> = { status: st, status_sefaz: d.status_sefaz ?? null, mensagem_sefaz: d.mensagem_sefaz ?? null };
      if (st === 'erro') dados.erros = erros(d);
      if (st === 'autorizada' || st === 'cancelada') {
        Object.assign(dados, { numero: d.numero ? String(d.numero) : null, serie: d.serie ? String(d.serie) : null, chave: so(d.chave_nfe) || null, caminho_xml: d.caminho_xml_nota_fiscal ?? null, caminho_danfe: d.caminho_danfe ?? null,
          protocolo: d.protocolo ?? d.protocolo_nota_fiscal?.numero_protocolo ?? null, autorizada_em: d.protocolo_nota_fiscal?.data_recebimento ?? null });
        if (d.caminho_xml_nota_fiscal && !nota.xml) { try { const x = await fetch(HOST[nota.ambiente] + d.caminho_xml_nota_fiscal, { headers: { Authorization: 'Basic ' + btoa(tok + ':') } }); if (x.ok) dados.xml = await x.text(); } catch { /* fica para a próxima consulta */ } }
        if (st === 'cancelada' && d.caminho_xml_cancelamento && !nota.xml_cancelamento) { try { const x = await fetch(HOST[nota.ambiente] + d.caminho_xml_cancelamento, { headers: { Authorization: 'Basic ' + btoa(tok + ':') } }); if (x.ok) dados.xml_cancelamento = await x.text(); } catch { /* idem */ } }
      }
      Object.keys(dados).forEach(k => dados[k] == null && delete dados[k]);
      await adm.rpc('nfe_registrar', { p_id: nota.id, p_dados: dados });
      return { status: st, erros: dados.erros || [], numero: dados.numero, chave: dados.chave };
    };

    // ---- gatilho da Focus (sem usuário): confere a chave e consulta a nota na própria Focus antes de gravar ----
    const hook = new URL(req.url).searchParams.get('hook');
    if (hook) {
      if (!Deno.env.get('FOCUS_NFE_HOOK_CHAVE') || hook !== Deno.env.get('FOCUS_NFE_HOOK_CHAVE')) return json({ erro: 'não autorizado' }, 401);
      const ref = String(b.ref || ''); if (!/^[0-9a-f]{32}$/.test(ref)) return json({ ok: true });
      const id = ref.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
      const { data: nota } = await adm.from('nfe_emissoes').select('id, empresa_id, ambiente, xml, xml_cancelamento, status').eq('id', id).maybeSingle();
      if (!nota) return json({ ok: true });
      const { data: emp } = await adm.from('empresas').select('cnpj').eq('id', nota.empresa_id).single();
      const tok = token(nota.ambiente, so(emp?.cnpj)); if (!tok) return json({ ok: true });
      const r = await focus(nota.ambiente, tok, 'GET', `/v2/nfe/${ref}?completa=1`);
      if (r.http === 200) await gravar(nota, tok, r.d);
      return json({ ok: true });
    }

    // ---- chamadas da tela ----
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = jwt ? await adm.auth.getUser(jwt) : { data: { user: null } };
    if (!u?.user) return json({ erro: 'não autorizado' }, 401);
    const usr = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const empresa = String(b.empresa_id || '');
    const { data: pode } = empresa ? await usr.rpc('nfe_pode', { p_empresa: empresa }) : { data: false };
    if (!pode) return json({ erro: 'Sem permissão para emitir NF-e nesta empresa.' }, 403);
    const [{ data: emp }, { data: cfg }] = await Promise.all([adm.from('empresas').select('cnpj').eq('id', empresa).single(), adm.from('nfe_config').select('ambiente, enviar_email_destinatario, email_copia').eq('empresa_id', empresa).maybeSingle()]);
    const cnpj = so(emp?.cnpj), ambCfg = cfg?.ambiente || 'homologacao';

    if (b.acao === 'testar') {
      const amb = b.ambiente === 'producao' ? 'producao' : 'homologacao', tok = token(amb, cnpj);
      if (!tok) return json({ ok: false, motivo: `Falta o segredo FOCUS_NFE_TOKEN_${amb === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO'} na função.` });
      const r = await focus(amb, tok, 'GET', '/v2/nfe/teste-de-conexao-' + Date.now());   // 404 = token aceito, nota inexistente
      return json({ ok: r.http === 404 || r.http === 200, http: r.http, motivo: r.http === 404 || r.http === 200 ? 'Token aceito pela Focus NFe.' : (r.d?.mensagem || `HTTP ${r.http}`) });
    }

    if (b.acao === 'inutilizar') {
      const tok = token(ambCfg, cnpj); if (!tok) return json({ erro: 'Token da Focus NFe não configurado para este ambiente.' }, 400);
      const r = await focus(ambCfg, tok, 'POST', '/v2/nfe/inutilizacao', { cnpj, serie: String(b.serie || '1'), numero_inicial: String(b.numero_inicial), numero_final: String(b.numero_final), justificativa: String(b.justificativa || '') });
      return json({ ok: r.http < 300 && r.d?.status === 'autorizado', retorno: r.d, erros: erros(r.d) });
    }

    const { data: nota } = await adm.from('nfe_emissoes').select('*').eq('id', b.nota_id).eq('empresa_id', empresa).maybeSingle();
    if (!nota) return json({ erro: 'Nota não encontrada.' }, 404);
    const tok = token(nota.ambiente, cnpj);
    if (!tok) return json({ erro: `Token da Focus NFe não configurado (segredo FOCUS_NFE_TOKEN_${nota.ambiente === 'producao' ? 'PRODUCAO' : 'HOMOLOGACAO'}).` }, 400);
    const ref = refDe(nota.id);

    if (b.acao === 'emitir') {
      if (!['rascunho', 'erro'].includes(nota.status)) return json({ erro: 'Esta nota já foi enviada.' }, 409);
      if (nota.ambiente !== ambCfg) return json({ erro: 'O ambiente da empresa mudou. Abra a nota e salve de novo antes de emitir.' }, 409);
      const p = b.payload || {}; if (!Array.isArray(p.items) || !p.items.length) return json({ erro: 'Nota sem itens.' }, 400);
      p.cnpj_emitente = cnpj; delete p.cpf_emitente;   // o emitente é sempre a empresa da sessão
      await adm.rpc('nfe_registrar', { p_id: nota.id, p_dados: { status: 'enviando' } });
      let r = await focus(nota.ambiente, tok, 'POST', `/v2/nfe?ref=${ref}`, p);
      // nota rejeitada antes pode ser reenviada com a mesma referência; se a Focus já a tem, consulta
      if (r.http === 422 && r.d?.codigo === 'already_processed') r = await focus(nota.ambiente, tok, 'GET', `/v2/nfe/${ref}?completa=1`);
      else if (r.http === 202 || r.d?.status === 'processando_autorizacao') { await new Promise(res => setTimeout(res, 2500)); const c = await focus(nota.ambiente, tok, 'GET', `/v2/nfe/${ref}?completa=1`); if (c.http === 200) r = c; }
      const g = await gravar(nota, tok, r.http === 0 || r.http >= 400 ? { ...r.d, status: 'erro_autorizacao' } : r.d);
      if (g.status === 'autorizada' && cfg?.enviar_email_destinatario) { const emails = [nota.destinatario?.email, cfg.email_copia].filter(Boolean); if (emails.length) await focus(nota.ambiente, tok, 'POST', `/v2/nfe/${ref}/email`, { emails }); }
      return json({ ok: g.status !== 'erro', ...g });
    }
    if (b.acao === 'consultar') {
      if (['rascunho'].includes(nota.status)) return json({ ok: true, status: nota.status });
      const r = await focus(nota.ambiente, tok, 'GET', `/v2/nfe/${ref}?completa=1`);
      if (r.http !== 200) return json({ ok: false, erros: erros(r.d) });
      return json({ ok: true, ...(await gravar(nota, tok, r.d)) });
    }
    if (b.acao === 'cancelar') {
      if (nota.status !== 'autorizada') return json({ erro: 'Só nota autorizada pode ser cancelada.' }, 409);
      const just = String(b.justificativa || '').trim(); if (just.length < 15 || just.length > 255) return json({ erro: 'A justificativa precisa ter de 15 a 255 caracteres.' }, 400);
      const r = await focus(nota.ambiente, tok, 'DELETE', `/v2/nfe/${ref}`, { justificativa: just });
      if (r.d?.status !== 'cancelado') return json({ ok: false, erros: erros(r.d) });
      await adm.rpc('nfe_registrar', { p_id: nota.id, p_dados: { cancel_justificativa: just } });
      const c = await focus(nota.ambiente, tok, 'GET', `/v2/nfe/${ref}?completa=1`);
      return json({ ok: true, ...(await gravar(nota, tok, c.http === 200 ? c.d : { ...r.d, status: 'cancelado' })) });
    }
    if (b.acao === 'carta') {
      if (nota.status !== 'autorizada') return json({ erro: 'Só nota autorizada aceita carta de correção.' }, 409);
      const texto = String(b.correcao || '').trim(); if (texto.length < 15 || texto.length > 1000) return json({ erro: 'A correção precisa ter de 15 a 1.000 caracteres.' }, 400);
      const r = await focus(nota.ambiente, tok, 'POST', `/v2/nfe/${ref}/carta_correcao`, { correcao: texto });
      if (r.d?.status !== 'autorizado') return json({ ok: false, erros: erros(r.d) });
      await adm.rpc('nfe_registrar', { p_id: nota.id, p_dados: { carta: { seq: r.d.numero_carta_correcao ?? (nota.cartas?.length || 0) + 1, texto, em: new Date().toISOString(), por: u.user.id, caminho_pdf: r.d.caminho_pdf_carta_correcao ?? null } } });
      return json({ ok: true });
    }
    if (b.acao === 'email') {
      const emails = (Array.isArray(b.emails) ? b.emails : []).map((x: unknown) => String(x).trim()).filter((x: string) => /^\S+@\S+\.\S+$/.test(x)).slice(0, 10);
      if (!emails.length) return json({ erro: 'Informe ao menos um e-mail válido.' }, 400);
      const r = await focus(nota.ambiente, tok, 'POST', `/v2/nfe/${ref}/email`, { emails });
      return json({ ok: r.http < 300, erros: r.http < 300 ? [] : erros(r.d) });
    }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return json({ erro: (e as Error).message }, 500);
  }
});

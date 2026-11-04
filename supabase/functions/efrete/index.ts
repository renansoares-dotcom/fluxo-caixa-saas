// e-frete (nstech IP) — CIOT e Pagamento Eletrônico de Frete pela API REST (Manual de Integração v8.2, 15/07/2026).
// Fica no servidor: o hash do integrador, o usuário/senha (e depois o certificado A1) nunca vão para o navegador.
// Segredos: EFRETE_INTEGRADOR, EFRETE_USUARIO, EFRETE_SENHA, EFRETE_CNPJ (só dígitos; a empresa da plataforma que pode usar),
//           EFRETE_BASE (opcional; padrão homologação https://dev.efrete.com.br — produção: https://sistema.efrete.com.br).
// Quem chama: usuário logado que seja admin/financeiro/diretor da empresa com o CNPJ de EFRETE_CNPJ, ou admin da plataforma.
// Etapa 1 (04/11/2026): só diagnóstico e consultas (login, situação do transportador, tipos de carga) — nada é emitido.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
const soDig = (s: string) => String(s || '').replace(/\D/g, '');
const BASE = () => (env('EFRETE_BASE') || 'https://dev.efrete.com.br').replace(/\/+$/, '');

// métodos liberados nesta etapa (só leitura)
const LEITURA: Record<string, { path: string; http: 'GET' | 'POST'; versao: number }> = {
  ConsultaSituacaoTransportador: { path: '/Services/Pef/ConsultaSituacaoTransportador', http: 'GET', versao: 1 },
  ConsultarTipoCarga: { path: '/Services/Pef/ConsultarTipoCarga', http: 'GET', versao: 1 },
  ObterCodigoIdentificacaoOperacaoTransportePorIdOperacaoCliente: { path: '/Services/Pef/ObterCodigoIdentificacaoOperacaoTransportePorIdOperacaoCliente', http: 'GET', versao: 1 },
};

// esconde token/senha de qualquer texto devolvido
const mascarar = (t: string) => t.replace(/("?(Token|Senha)"?\s*[:=]\s*"?)[^",&}\s]+/gi, '$1***');

// registro de cada chamada (tabela efrete_chamadas, SQL 079) — sem token, senha nem hash
const SECRETOS = new Set(['Token', 'Senha', 'Integrador', 'Usuario']);
const limpar = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !SECRETOS.has(k)));
const ctx: { adm: ReturnType<typeof createClient> | null; uid: string | null; empresa: string | null; acao: string } = { adm: null, uid: null, empresa: null, acao: '' };
async function registrar(metodo: string, corpo: Record<string, unknown>, r: { status: number; ms: number; dados: unknown; texto?: string }) {
  if (!ctx.adm) return;
  const d = r.dados as Record<string, unknown> | null;
  const resp = d ? Object.fromEntries(Object.entries(d).filter(([k]) => !SECRETOS.has(k))) : { texto: r.texto };
  try {
    await ctx.adm.from('efrete_chamadas').insert({ empresa_id: ctx.empresa, user_id: ctx.uid, acao: ctx.acao, ambiente: BASE().includes('dev.') ? 'homologacao' : 'producao',
      metodo, ok: !!(d?.Sucesso === true || d?.Token), http_status: r.status, ms: r.ms, pedido: limpar(corpo), resposta: resp });
  } catch { /* SQL 079 ainda não rodou: segue sem registro */ }
}

async function chamar(path: string, http: 'GET' | 'POST', corpo: Record<string, unknown>) {
  const url = new URL(BASE() + path);
  const ini = Date.now();
  let r: Response;
  if (http === 'GET') {
    for (const [k, v] of Object.entries(corpo)) if (v != null && typeof v !== 'object') url.searchParams.set(k, String(v));
    r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  } else {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(corpo) });
  }
  const texto = await r.text();
  let dados: unknown = null; try { dados = JSON.parse(texto); } catch { /* não é JSON */ }
  const res = { status: r.status, ms: Date.now() - ini, dados, texto: dados ? undefined : mascarar(texto.slice(0, 600)) };
  await registrar(`${http} ${path.split('/').pop()}`, corpo, res);
  return res;
}

async function login() {
  const corpo = { Usuario: env('EFRETE_USUARIO'), Senha: env('EFRETE_SENHA'), Integrador: env('EFRETE_INTEGRADOR'), Versao: 1 };
  // a lista de URLs do kit diz GET; o exemplo do manual é JSON — tenta os dois e informa qual funcionou
  const a = await chamar('/Services/Logon/Login', 'GET', corpo);
  const ok = (x: { dados: unknown }) => !!(x.dados as { Token?: string; Sucesso?: boolean })?.Token;
  if (ok(a)) return { token: (a.dados as { Token: string }).Token, via: 'GET', tentativas: [resumo(a)] };
  const b = await chamar('/Services/Logon/Login', 'POST', corpo);
  if (ok(b)) return { token: (b.dados as { Token: string }).Token, via: 'POST', tentativas: [resumo(a), resumo(b)] };
  return { token: null, via: null, tentativas: [resumo(a), resumo(b)] };
}
const resumo = (x: { status: number; ms: number; dados: unknown; texto?: string }) => {
  const d = x.dados as Record<string, unknown> | null;
  return { status: x.status, ms: x.ms, sucesso: d?.Sucesso ?? null, temToken: !!d?.Token, excecao: d?.Excecao ?? null, texto: x.texto };
};
async function logout(token: string) {
  try { await chamar('/Services/Logon/Logout', 'POST', { Integrador: env('EFRETE_INTEGRADOR'), Versao: 1, Token: token }); } catch { /* silencioso, como o próprio Logout */ }
}

async function autorizado(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const adm = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const { data: u } = await adm.auth.getUser(jwt);
  const uid = u?.user?.id; if (!uid) return false;
  ctx.adm = adm; ctx.uid = uid;
  const { data: pa } = await adm.from('plataforma_admins').select('user_id').eq('user_id', uid).maybeSingle();
  if (pa) return true;
  const { data: ms } = await adm.from('membros').select('papel, empresas!inner(cnpj)').eq('user_id', uid).in('papel', ['admin', 'financeiro', 'diretor']);
  return (ms ?? []).some((m: { empresas: { cnpj: string } }) => soDig(m.empresas?.cnpj) === soDig(env('EFRETE_CNPJ')));
}
// empresa da plataforma com o CNPJ da integração (null enquanto ela não existir: diagnóstico pelo admin da plataforma)
async function empresaDaIntegracao() {
  if (!ctx.adm) return null;
  const { data } = await ctx.adm.from('empresas').select('id, cnpj');
  return (data ?? []).find((e: { cnpj: string }) => soDig(e.cnpj) === soDig(env('EFRETE_CNPJ')))?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!(await autorizado(req))) return json({ erro: 'Sem permissão para usar a integração e-frete.' }, 403);
    const faltam = ['EFRETE_INTEGRADOR', 'EFRETE_USUARIO', 'EFRETE_SENHA', 'EFRETE_CNPJ'].filter(k => !env(k));
    const body = await req.json().catch(() => ({}));
    const acao = String(body.acao || 'diagnostico');
    ctx.acao = acao; ctx.empresa = await empresaDaIntegracao();
    const ambiente = BASE().includes('dev.') ? 'homologacao' : 'producao';
    if (faltam.length) return json({ ambiente, erro: 'Segredos não cadastrados: ' + faltam.join(', ') }, 400);

    if (acao === 'diagnostico') {
      const L = await login();
      let tipos: unknown = null;
      if (L.token) {
        const t = await chamar(LEITURA.ConsultarTipoCarga.path, 'GET', { Integrador: env('EFRETE_INTEGRADOR'), Token: L.token, Versao: 1 });
        tipos = resumo(t); if ((t.dados as { Sucesso?: boolean })?.Sucesso) tipos = { ...resumo(t), dados: t.dados };
        await logout(L.token);
      }
      return json({ ambiente, base: BASE(), login: { ok: !!L.token, via: L.via, tentativas: L.tentativas }, tiposDeCarga: tipos });
    }

    const m = LEITURA[acao];
    if (!m) return json({ erro: 'Ação não liberada nesta etapa: ' + acao }, 400);
    const L = await login();
    if (!L.token) return json({ ambiente, erro: 'Login no e-frete falhou', tentativas: L.tentativas }, 502);
    const params = (body.params && typeof body.params === 'object') ? body.params : {};
    const r = await chamar(m.path, m.http, { ...params, Integrador: env('EFRETE_INTEGRADOR'), Token: L.token, Versao: m.versao });
    await logout(L.token);
    return json({ ambiente, status: r.status, dados: r.dados, texto: r.texto });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});

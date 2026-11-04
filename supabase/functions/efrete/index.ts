// e-frete (nstech IP) — CIOT e Pagamento Eletrônico de Frete pela API REST (Manual de Integração v8.2, 15/07/2026).
// Fica no servidor: o hash do integrador, o usuário/senha (e depois o certificado A1) nunca vão para o navegador.
// Segredos: EFRETE_INTEGRADOR, EFRETE_USUARIO, EFRETE_SENHA, EFRETE_CNPJ (só dígitos; a empresa da plataforma que pode usar),
//           EFRETE_BASE (opcional; padrão homologação https://dev.efrete.com.br — produção: https://sistema.efrete.com.br).
// Quem chama: usuário logado que seja admin/financeiro/diretor da empresa com o CNPJ de EFRETE_CNPJ, ou admin da plataforma.
// Etapa 1 (04/11/2026): só diagnóstico e consultas (login, situação do transportador, tipos de carga) — nada é emitido.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import https from 'node:https';

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
  // tem lista de veículos: vai por POST (JSON); ConsultarTipoCarga foi desabilitado pelo e-frete ("não é requisito para emissão de CIOT")
  ConsultaSituacaoTransportador: { path: '/Services/Pef/ConsultaSituacaoTransportador', http: 'POST', versao: 1 },
  ObterCodigoIdentificacaoOperacaoTransportePorIdOperacaoCliente: { path: '/Services/Pef/ObterCodigoIdentificacaoOperacaoTransportePorIdOperacaoCliente', http: 'GET', versao: 1 },
};

// esconde token/senha de qualquer texto devolvido
const mascarar = (t: string) => t.replace(/("?(Token|Senha|Usuario|Integrador)"?\s*[:=]\s*"?)[^",&}\s]+/gi, '$1***');

// registro de cada chamada (tabela efrete_chamadas, SQL 079) — sem token, senha nem hash
const SECRETOS = new Set(['Token', 'Senha', 'Integrador', 'Usuario']);
const limpar = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !SECRETOS.has(k)));
const ctx: { adm: ReturnType<typeof createClient> | null; uid: string | null; empresa: string | null; acao: string } = { adm: null, uid: null, empresa: null, acao: '' };
async function registrar(metodo: string, corpo: Record<string, unknown>, r: { status: number; ms: number; dados: unknown; texto?: string }) {
  if (!ctx.adm) return;
  const d = r.dados as Record<string, unknown> | null;
  const resp = d ? Object.fromEntries(Object.entries(d).filter(([k]) => !SECRETOS.has(k)).map(([k, v]) => k === 'Pdf' && typeof v === 'string' ? [k, `[PDF ${Math.round(v.length * 0.75 / 1024)} KB]`] : [k, v])) : { texto: r.texto };
  try {
    await ctx.adm.from('efrete_chamadas').insert({ empresa_id: ctx.empresa, user_id: ctx.uid, acao: ctx.acao, ambiente: BASE().includes('dev.') ? 'homologacao' : 'producao',
      metodo, ok: !!(d?.Sucesso === true || d?.Token), http_status: r.status, ms: r.ms, pedido: limpar(corpo), resposta: resp });
  } catch { /* SQL 079 ainda não rodou: segue sem registro */ }
}

// o servidor do e-frete recusa HTTP/2 ("endpoint requires HTTP/1.1"): cliente só com HTTP/1.1
let _cli: unknown = null;
function cliente() {
  if (_cli === null) {
    try { _cli = (Deno as unknown as { createHttpClient: (o: Record<string, unknown>) => unknown }).createHttpClient({ http1: true, http2: false }); }
    catch { _cli = undefined; }
  }
  return _cli || undefined;
}
// alternativa quando o fetch não aceita forçar HTTP/1.1: node:https (sempre HTTP/1.1)
function http11(url: URL, metodo: string, corpo?: string): Promise<Response> {
  return new Promise((ok, falha) => {
    const req = https.request(url, { method: metodo, headers: { Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(corpo).length) } : {}) } }, (res) => {
      const partes: Uint8Array[] = [];
      res.on('data', (c: Uint8Array) => partes.push(c));
      res.on('end', () => ok(new Response(new Blob(partes), { status: res.statusCode || 0 })));
    });
    req.on('error', falha); req.setTimeout(30000, () => req.destroy(new Error('tempo esgotado (30 s)')));
    if (corpo) req.write(corpo); req.end();
  });
}
// mensagem de erro sem o endereço com parâmetros (que podem levar a senha) e sem credenciais
const erroLimpo = (e: unknown) => mascarar(String((e as Error)?.message || e).replace(/https?:\/\/\S+/g, (u) => u.split('?')[0]));

// ponte Node.js na Vercel (ponte-efrete/): aceita a renegociação TLS do e-frete e leva o certificado A1.
// Ligada quando existirem os segredos EFRETE_PONTE_URL e EFRETE_PONTE_CHAVE.
async function pelaPonte(path: string, http: 'GET' | 'POST', corpo: Record<string, unknown>) {
  const ini = Date.now();
  let caminho = path;
  if (http === 'GET') { const q = new URLSearchParams(); for (const [k, v] of Object.entries(corpo)) if (v != null && typeof v !== 'object') q.set(k, String(v)); caminho += '?' + q.toString(); }
  try {
    const r = await fetch(env('EFRETE_PONTE_URL'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ponte-chave': env('EFRETE_PONTE_CHAVE') },
      body: JSON.stringify({ ambiente: BASE().includes('dev.') ? 'homologacao' : 'producao', metodo: http, caminho, corpo: http === 'POST' ? corpo : undefined }) });
    const p = await r.json().catch(() => ({ ok: false, erro: `ponte respondeu HTTP ${r.status}` }));
    if (!p.ok) return { status: 0, ms: Date.now() - ini, dados: null, texto: 'Falha de conexão (ponte): ' + erroLimpo(p.erro || p.codigo || 'erro') };
    let dados: unknown = null; try { dados = JSON.parse(p.corpo); } catch { /* não é JSON */ }
    return { status: p.status, ms: Date.now() - ini, dados, texto: dados ? undefined : mascarar(String(p.corpo || '').slice(0, 600)) };
  } catch (e) { return { status: 0, ms: Date.now() - ini, dados: null, texto: 'Ponte inacessível: ' + erroLimpo(e) }; }
}
const usaPonte = () => !!(env('EFRETE_PONTE_URL') && env('EFRETE_PONTE_CHAVE'));

async function chamar(path: string, http: 'GET' | 'POST', corpo: Record<string, unknown>) {
  if (usaPonte()) { const res = await pelaPonte(path, http, corpo); await registrar(`${http} ${path.split('/').pop()} (ponte)`, corpo, res); return res; }
  const url = new URL(BASE() + path);
  const ini = Date.now();
  let r: Response;
  const client = cliente();
  try {
    if (http === 'GET') {
      for (const [k, v] of Object.entries(corpo)) if (v != null && typeof v !== 'object') url.searchParams.set(k, String(v));
      r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, ...(client ? { client } : {}) } as RequestInit);
    } else {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(corpo), ...(client ? { client } : {}) } as RequestInit);
    }
  } catch (e) {
    try {
      if (!/http2|HTTP\/1\.1/i.test(String((e as Error)?.message))) throw e;
      if (http === 'GET') r = await http11(url, 'GET');
      else r = await http11(url, 'POST', JSON.stringify(corpo));
    } catch (e2) {
      const res = { status: 0, ms: Date.now() - ini, dados: null, texto: 'Falha de conexão: ' + erroLimpo(e2) };
      await registrar(`${http} ${path.split('/').pop()}`, corpo, res);
      return res;
    }
  }
  const texto = await r.text();
  let dados: unknown = null; try { dados = JSON.parse(texto); } catch { /* não é JSON */ }
  const res = { status: r.status, ms: Date.now() - ini, dados, texto: dados ? undefined : mascarar(texto.slice(0, 600)) };
  await registrar(`${http} ${path.split('/').pop()}`, corpo, res);
  return res;
}

async function login() {
  const corpo = { Usuario: env('EFRETE_USUARIO'), Senha: env('EFRETE_SENHA'), Integrador: env('EFRETE_INTEGRADOR'), Versao: 1 };
  // o exemplo do manual é JSON (POST, senha no corpo); a lista de URLs do kit diz GET — tenta POST primeiro
  const ok = (x: { dados: unknown }) => !!(x.dados as { Token?: string; Sucesso?: boolean })?.Token;
  const a = await chamar('/Services/Logon/Login', 'POST', corpo);
  if (ok(a)) return { token: (a.dados as { Token: string }).Token, via: 'POST', tentativas: [resumo(a)] };
  const b = await chamar('/Services/Logon/Login', 'GET', corpo);
  if (ok(b)) return { token: (b.dados as { Token: string }).Token, via: 'GET', tentativas: [resumo(a), resumo(b)] };
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

// ---- dados FICTÍCIOS para o teste na homologação (nunca usados em produção)
const rnd = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10));
function cpfFicticio(): string {
  for (;;) {
    const d = rnd(9); if (new Set(d).size === 1) continue;
    const dv = (b: number[]) => { const s = b.reduce((a, x, i) => a + x * (b.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
    const d1 = dv(d), d2 = dv([...d, d1]); return [...d, d1, d2].join('');
  }
}
function cnhFicticia(): string {
  for (;;) {
    const d = rnd(9); if (new Set(d).size === 1) continue;
    let v = 0; for (let i = 0, j = 9; i < 9; i++, j--) v += d[i] * j;
    let d1 = v % 11, dsc = 0; if (d1 >= 10) { d1 = 0; dsc = 2; }
    v = 0; for (let i = 0, j = 1; i < 9; i++, j++) v += d[i] * j;
    const x = v % 11, d2 = x >= 10 ? 0 : x - dsc; if (d2 < 0) continue;
    return [...d, d1, d2].join('');
  }
}
const motoristaFicticio = () => ({ cpf: cpfFicticio(), cnh: cnhFicticia(), cel: { DDD: 81, Numero: 900000000 + Math.floor(Math.random() * 99999999) } });

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
      // rede direta (só quando não há ponte): separa bloqueio de rede × exigência de certificado na pasta /Services
      const rede: Record<string, string> = {};
      if (!usaPonte()) for (const p of ['/', '/Suporte', '/Services/LogonService.asmx']) {
        const ini = Date.now();
        try { const c = cliente(); const r = await fetch(BASE() + p, { method: 'GET', redirect: 'manual', ...(c ? { client: c } : {}) } as RequestInit); await r.body?.cancel(); rede[p] = `HTTP ${r.status} · ${Date.now() - ini} ms`; }
        catch (e) { rede[p] = 'falha · ' + erroLimpo(e).replace(/^.*?\): /, '').slice(0, 160); }
      }
      const L = await login();
      let consulta: unknown = null;
      if (L.token) {
        // consulta de teste com um transportador da massa de testes da ANTT (kit e-frete): só leitura
        const pedido = body.teste || { InteressadoCpfOuCnpj: soDig(env('EFRETE_CNPJ')), TransportadorCpfOuCnpj: '48384601000171', TransportadorRNTRC: '55887888', Veiculos: [{ Placa: 'BWP6E54' }] };
        const t = await chamar(LEITURA.ConsultaSituacaoTransportador.path, 'POST', { ...pedido, Integrador: env('EFRETE_INTEGRADOR'), Token: L.token, Versao: 1 });
        const d = t.dados as Record<string, unknown> | null;
        consulta = { ...resumo(t), dados: d ? Object.fromEntries(Object.entries(d).filter(([k]) => !SECRETOS.has(k))) : null };
        await logout(L.token);
      }
      return json({ ambiente, base: BASE(), ponte: usaPonte(), rede, login: { ok: !!L.token, via: L.via, tentativas: L.tentativas }, consultaTransportador: consulta });
    }

    if (acao === 'ciot_teste') {
      // Emissão de TESTE na homologação, com a massa de testes da ANTT do kit e-frete: grava proprietário, veículo e motorista,
      // emite um CIOT de Lotação, baixa o PDF e cancela. Nunca roda em produção.
      if (ambiente !== 'homologacao') return json({ erro: 'O CIOT de teste só roda na homologação.' }, 400);
      const passos: Record<string, unknown>[] = [];
      const passo = (nome: string, r: { status: number; ms: number; dados: unknown; texto?: string }, extra: Record<string, unknown> = {}) => {
        const d = r.dados as Record<string, unknown> | null;
        passos.push({ nome, ok: d?.Sucesso === true, status: r.status, ms: r.ms, mensagem: (d?.Excecao as { Mensagem?: string })?.Mensagem || r.texto || '', protocolo: d?.ProtocoloServico ?? null, ...extra });
        return d;
      };
      const L = await login();
      if (!L.token) return json({ ambiente, erro: 'Login no e-frete falhou', tentativas: L.tentativas }, 502);
      const I = { Integrador: env('EFRETE_INTEGRADOR'), Token: L.token };
      const cnpj = soDig(env('EFRETE_CNPJ'));
      // massa ANTT: transportador com um único caminhão simples (sem implemento)
      const T = { cnpj: '48386287000166', rntrc: '56216399', placa: 'OSK7D95' };
      const end = { Bairro: 'INDIANOPOLIS', CEP: '55024740', CodigoMunicipio: 2604106, Rua: 'AV ADJAR DA SILVA CASE', Numero: '800' };
      passo('Gravar proprietário', await chamar('/Services/proprietarios/gravarV2', 'POST', { ...I, Versao: 4, CNPJ: T.cnpj, Endereco: end, RNTRC: T.rntrc, RazaoSocial: 'TRANSPORTADOR TESTE HOMOLOGACAO' }));
      passo('Gravar veículo', await chamar('/Services/veiculos/gravar', 'POST', { ...I, Versao: 1, Veiculo: { Chassi: '9BM384078KB123456', NumeroDeEixos: 2, Placa: T.placa, RNTRC: Number(T.rntrc), Renavam: 12345678901, TipoCarroceria: 'FechadaOuBau', TipoRodado: 'Toco' } }));
      // motorista FICTÍCIO novo a cada teste: CPF e CNH com dígitos válidos e celular único
      // (na homologação a CNH/CPF genéricos já estão cadastrados para outras pessoas e o celular não pode repetir)
      const M = motoristaFicticio();
      passo('Gravar motorista', await chamar('/Services/motoristas/gravar', 'POST', { ...I, Versao: 2, CNH: Number(M.cnh), CPF: Number(M.cpf), DataNascimento: '1985-06-15T00:00:00', Endereco: end, Nome: 'MOTORISTA TESTE ' + M.cpf.slice(-4), Telefones: { Celular: M.cel } }), { motorista: `CPF ${M.cpf} · CNH ${M.cnh}` });
      // viagem Caruaru → Recife começando daqui a 1 hora (a data de início não pode ser anterior ao registro)
      const iso = (d: Date) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 19);
      const ini = new Date(Date.now() + 3600e3), fim = new Date(Date.now() + 26 * 3600e3);
      const id = 'TESTE-' + Date.now();
      const valor = 2500;
      const op = {
        ...I, Versao: 8, TipoViagem: 'Padrao', MatrizCNPJ: cnpj, IdOperacaoCliente: id,
        DataInicioViagem: iso(ini), DataFimViagem: iso(fim), CodigoNCMNaturezaCarga: '3923', PesoCarga: 5000.0,
        // a API espera listas (o exemplo do manual mostra objeto, mas o servidor exige array)
        Viagens: [{
          DocumentoViagem: 'TESTE-1', CodigoMunicipioOrigem: 2604106, CodigoMunicipioDestino: 2611606, DistanciaPercorrida: 140,
          LatitudeOrigem: '-8.2845', LongitudeOrigem: '-35.9699', LatitudeDestino: '-8.0467', LongitudeDestino: '-34.8771',
          Valores: { TotalOperacao: valor, TotalViagem: valor, TotalDeAdiantamento: 0, TotalDeQuitacao: valor, Combustivel: 0, Pedagio: 0, Seguro: 0 },
          TipoPagamento: 'eFRETE',
          NotasFiscais: [{ Numero: '1', Serie: '1', ValorTotal: 30000.0, ValorDaMercadoriaPorUnidade: 6.0, CodigoNCMNaturezaCarga: '3923',
            UnidadeDeMedidaDaMercadoria: 'Kg', TipoDeCalculo: 'SemQuebra', QuantidadeDaMercadoriaNoEmbarque: 5000, ToleranciaDePerdaDeMercadoria: { Tipo: 'Nenhum', Valor: 0 } }],
        }],
        Impostos: { IRRF: 0, SestSenat: 0, INSS: 0, ISSQN: 0, OutrosImpostos: 0 },
        Pagamentos: [{ IdPagamentoCliente: id + '-Q', DataDeLiberacao: iso(fim), Valor: valor, TipoPagamento: 'eFRETE', Categoria: 'Quitacao', Documento: 'TESTE-1',
          IndicadorPagamento: 'AVista', CpfCnpjCreditado: T.cnpj, NumeroParcela: 1 }],
        Contratado: { CpfOuCnpj: T.cnpj, RNTRC: T.rntrc },
        Motorista: { CpfOuCnpj: M.cpf, CNH: M.cnh, Celular: M.cel },
        Destinatario: { NomeOuRazaoSocial: 'DESTINATARIO TESTE', CpfOuCnpj: cnpj, Endereco: { Bairro: 'BOA VISTA', Rua: 'RUA DA AURORA', Numero: '100', CEP: '50050000', CodigoMunicipio: 2611606 } },
        Contratante: { NomeOuRazaoSocial: 'KRATOS TRANSPORTES E LOGISTICA LTDA', CpfOuCnpj: cnpj, ResponsavelPeloPagamento: true, Endereco: end },
        Veiculos: [{ Placa: T.placa }], CodigoTipoCarga: 5, AltoDesempenho: false, ComposicaoVeicular: false, RetornoVazio: false, TipoPagamento: 'eFRETE',
        TipoEmbalagem: 'Pallet',
        // quitação pelo meio de pagamento (eFRETE): documentos que o posto/credenciado retém (mín. 10 caracteres cada)
        ObservacoesAoCredenciado: ['Canhoto da NF-e assinado pelo destinatario', 'Comprovante de entrega da carga'],
        EntregaDocumentacao: 'RedeCredenciada',
      };
      const d = passo('Emitir CIOT (Lotação)', await chamar('/Services/Pef/AdicionarOperacaoTransporteV2', 'POST', op), { idOperacaoCliente: id });
      const ciot = (d?.CodigoIdentificacaoOperacao as string) || null;
      let pdf: string | null = null;
      if (ciot) {
        passos[passos.length - 1].ciot = ciot;
        const c = passo('Consultar CIOT pelo Id da operação', await chamar('/Services/Pef/ObterCodigoIdentificacaoOperacaoTransportePorIdOperacaoCliente', 'GET', { ...I, Versao: 1, MatrizCNPJ: cnpj, IdOperacaoCliente: id }));
        if (c) passos[passos.length - 1].estado = c.EstadoCiot ?? null;
        const p = passo('Baixar PDF do CIOT', await chamar('/Services/Pef/ObterOperacaoTransportePdf', 'GET', { ...I, Versao: 1, CodigoIdentificacaoOperacao: ciot }));
        pdf = (p?.Pdf as string) || null;
        passo('Cancelar CIOT de teste', await chamar('/Services/Pef/CancelarOperacaoTransporte', 'POST', { ...I, Versao: 1, CodigoIdentificacaoOperacao: ciot, Motivo: 'Teste de integração em homologação (plataforma Kratos).' }));
      }
      await logout(L.token);
      return json({ ambiente, ponte: usaPonte(), ciot, passos, pdf });
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
    console.error(erroLimpo(e));
    return json({ erro: erroLimpo(e) }, 500);
  }
});

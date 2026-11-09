// Pergunte à plataforma (melhoria 1.8): responde perguntas em português sobre os dados da empresa com a IA (Claude, da Anthropic).
// SÓ CONSULTA. A IA não escreve SQL: ela chama a ferramenta "consultar", que roda a RPC ia_consultar COM O TOKEN DE QUEM
// PERGUNTOU (as regras de acesso de cada tela valem aqui), sobre o catálogo fechado de ia_catalogo(). Os números do gráfico e
// da tabela saem das consultas, nunca do texto da IA.
// Segredo: ANTHROPIC_API_KEY. Configuração por empresa em ia_config (liga/desliga, modelo, perfis, limite por dia).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const API = 'https://api.anthropic.com/v1/messages';

const FERRAMENTAS = (cat: any) => [
  {
    name: 'consultar',
    description: 'Consulta agregada nos dados da empresa. Use só fontes, medidas, agrupamentos e filtros do catálogo. Devolve linhas [chave, valor], o total e o link da tela de origem. Pode chamar mais de uma vez (ex.: comparar dois períodos).',
    input_schema: {
      type: 'object',
      properties: {
        fonte: { type: 'string', enum: Object.keys(cat) },
        metrica: { type: 'string', description: 'medida da fonte (catálogo)' },
        agrupar: { type: 'string', description: 'agrupamento da fonte (catálogo); omita para um total só' },
        filtros: { type: 'object', description: 'filtros da fonte (catálogo), valores em texto', additionalProperties: { type: 'string' } },
        de: { type: 'string', description: 'data inicial AAAA-MM-DD' },
        ate: { type: 'string', description: 'data final AAAA-MM-DD' },
        ordem: { type: 'string', enum: ['maior', 'menor', 'chave'], description: 'maior primeiro (padrão), menor primeiro ou pela chave (tempo)' },
        limite: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['fonte', 'metrica'],
    },
  },
  {
    name: 'responder',
    description: 'Entrega a resposta final ao usuário. Chame uma vez, no fim.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'resposta em português do Brasil, curta e direta, com os números das consultas (R$ no formato 1.234,56) e o período' },
        grafico: { type: 'string', enum: ['barras', 'linha', 'pizza', 'nenhum'], description: 'tipo de gráfico para a consulta escolhida (linha para tempo; barras para ranking; pizza só com até 6 fatias)' },
        titulo_grafico: { type: 'string' },
        consulta: { type: 'integer', description: 'índice (a partir de 0) da consulta que vai no gráfico, na tabela e no link' },
      },
      required: ['texto'],
    },
  },
];

function sistema(cat: any, empresa: string, hoje: string, instrucoes: string | null) {
  return `Você é o assistente de dados da plataforma de gestão da empresa ${empresa}. Hoje é ${hoje} (fuso de Recife).
Responda perguntas sobre os dados da empresa usando SOMENTE a ferramenta "consultar" e depois "responder".
Regras:
- Nunca invente números: todo número da resposta vem de uma consulta feita agora. Se o catálogo não cobre a pergunta, diga isso em uma frase e indique a tela onde a pessoa encontra (sem chamar consultar).
- Sempre informe o período considerado. Sem período na pergunta, use o ano corrente até hoje e diga isso.
- "Mês passado", "este ano", "último trimestre" são relativos a hoje.
- Faturamento = notas de saída próprias (fonte notas, tipo saida, propria true). Despesas/pagamentos = lançamentos do tipo saída; receitas/recebimentos = lançamentos do tipo entrada; tire as transferências entre contas quando falar de despesa ou receita.
- Valores em reais no formato brasileiro (R$ 1.234,56); quilos com "kg". Seja breve: no máximo 4 frases ou uma lista curta.
- Não peça confirmação; faça a melhor leitura da pergunta e diga qual foi.
- Você só lê dados. Se pedirem para alterar, lançar, aprovar ou excluir algo, explique que aqui só se consulta e indique a tela.
${instrucoes ? `Orientação da empresa: ${instrucoes}\n` : ''}Catálogo (fontes, medidas, agrupamentos, filtros):
${JSON.stringify(cat)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t0 = Date.now();
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const adm = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = tok ? await adm.auth.getUser(tok) : { data: { user: null } };
    if (!u?.user) return json({ erro: 'não autorizado' }, 401);
    const usr = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${tok}` } } });

    const { empresa_id, pergunta, anteriores } = await req.json().catch(() => ({}));
    const p = String(pergunta || '').trim();
    if (!empresa_id || p.length < 3) return json({ erro: 'Escreva a pergunta.' }, 400);
    if (p.length > 1000) return json({ erro: 'Pergunta longa demais (até 1.000 caracteres).' }, 400);
    const { data: pode } = await usr.rpc('ia_pode', { p_empresa: empresa_id });
    if (!pode) return json({ erro: 'A IA está desligada ou o seu perfil não tem acesso (Pergunte à plataforma › Parâmetros).' }, 403);
    const chave = Deno.env.get('ANTHROPIC_API_KEY') || '';
    if (!chave) return json({ erro: 'Falta configurar o segredo ANTHROPIC_API_KEY no Supabase.' }, 503);

    const [{ data: cfg }, { data: emp }, { data: cat }] = await Promise.all([
      adm.from('ia_config').select('*').eq('empresa_id', empresa_id).single(),
      adm.from('empresas').select('nome').eq('id', empresa_id).single(),
      adm.rpc('ia_catalogo'),
    ]);
    const desde = new Date(); desde.setHours(desde.getHours() - 24);
    const { count } = await adm.from('ia_perguntas').select('id', { count: 'exact', head: true }).eq('empresa_id', empresa_id).eq('user_id', u.user.id).gte('criado_em', desde.toISOString());
    if ((count ?? 0) >= (cfg?.limite_dia ?? 30)) return json({ erro: `Limite de ${cfg?.limite_dia ?? 30} perguntas em 24 horas atingido.` }, 429);

    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
    const msgs: any[] = [];
    for (const a of (Array.isArray(anteriores) ? anteriores : []).slice(-2)) {   // contexto curto para "e em fevereiro?"
      if (a?.pergunta && a?.resposta) msgs.push({ role: 'user', content: String(a.pergunta).slice(0, 1000) }, { role: 'assistant', content: String(a.resposta).slice(0, 2000) });
    }
    msgs.push({ role: 'user', content: p });
    const consultas: any[] = [];
    let fim: any = null, tin = 0, tout = 0, voltas = 0;
    const maxc = cfg?.max_consultas ?? 6;
    while (!fim && voltas < maxc + 2) {
      voltas++;
      const r = await fetch(API, {
        method: 'POST',
        headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg?.modelo || 'claude-sonnet-5-5', max_tokens: 1500, system: sistema(cat, emp?.nome || '', hoje, cfg?.instrucoes || null),
          tools: FERRAMENTAS(cat), tool_choice: consultas.length >= maxc ? { type: 'tool', name: 'responder' } : { type: 'any' }, messages: msgs }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(`IA: ${b?.error?.message || r.status}`);
      tin += b.usage?.input_tokens || 0; tout += b.usage?.output_tokens || 0;
      msgs.push({ role: 'assistant', content: b.content });
      const usos = (b.content || []).filter((c: any) => c.type === 'tool_use');
      if (!usos.length) { fim = { texto: (b.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim() }; break; }
      const resultados: any[] = [];
      for (const t of usos) {
        if (t.name === 'responder') { fim = t.input; break; }
        const i = t.input || {};
        const { data, error } = await usr.rpc('ia_consultar', { p_empresa: empresa_id, p_fonte: i.fonte, p_metrica: i.metrica, p_agrupar: i.agrupar || null,
          p_filtros: i.filtros || {}, p_de: i.de || null, p_ate: i.ate || null, p_ordem: i.ordem || null, p_limite: i.limite || 30 });
        if (!error) consultas.push(data);
        resultados.push({ type: 'tool_result', tool_use_id: t.id, is_error: !!error,
          content: error ? `Erro: ${error.message}` : JSON.stringify({ indice: consultas.length - 1, ...data }).slice(0, 12000) });
      }
      if (fim) break;
      msgs.push({ role: 'user', content: resultados });
    }
    if (!fim?.texto) fim = { texto: 'Não consegui montar a resposta. Tente perguntar de outro jeito, com o período e o que quer ver.' };

    const ic = Number.isInteger(fim.consulta) && consultas[fim.consulta] ? fim.consulta : consultas.length - 1;
    const base = ic >= 0 ? consultas[ic] : null;
    const tabela = base && base.agrupar ? { colunas: [base.agrupar_nome || base.agrupar, base.metrica_nome || base.metrica], linhas: base.linhas, metrica: base.metrica, agrupar: base.agrupar } : null;
    const grafico = tabela && fim.grafico && fim.grafico !== 'nenhum' && base.linhas.length > 1 ? { tipo: fim.grafico, titulo: fim.titulo_grafico || '', consulta: ic } : null;
    const reg = {
      empresa_id, user_id: u.user.id, pergunta: p, resposta: fim.texto,
      consultas: consultas.map((c) => ({ fonte: c.fonte, metrica: c.metrica, agrupar: c.agrupar, filtros: c.filtros, de: c.de, ate: c.ate, n: c.n, total: c.total })),
      grafico, tabela, link: base?.link || null, link_rotulo: base?.rotulo || null,
      modelo: cfg?.modelo || 'claude-sonnet-5-5', tokens_entrada: tin, tokens_saida: tout, ms: Date.now() - t0,
    };
    const { data: ins } = await adm.from('ia_perguntas').insert(reg).select('id').single();
    return json({ id: ins?.id, ...reg });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});

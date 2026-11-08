// Cliente Supabase, estado global, cache de cadastros e montagem dos relatórios
import { createClient } from '../../vendor/supabase-2.117.2.esm.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { options, esc, $, MESES } from './ui.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const state = {
  user: null,
  empresa: null,   // {id, nome, ...}
  papel: null,     // admin | financeiro | diretor | leitura
  areas: null,     // áreas do menu que o usuário vê (fin, cpd, cont); null = todas
  ano: new Date().getFullYear(),
  cad: null,       // cadastros em cache
  filtros: { conta: '', grupo: '', cc: '', favorecido: '', disp: '', visao: 'Pago' },
};

export const podeEditar = () => ['admin', 'financeiro'].includes(state.papel);
export const isAdmin = () => state.papel === 'admin';
// acesso por área (Financeiro, CPD, Contabilidade): administrador vê todas; sem marcação = todas
export const AREAS = [['fin', 'Financeiro'], ['com', 'Comercial'], ['cmp', 'Compras'], ['prd', 'Produção'], ['log', 'Logística'], ['cpd', 'CPD'], ['cont', 'Contabilidade']];
export const temArea = (a) => state.papel === 'admin' || !state.areas || state.areas.includes(a);
// RH é exceção: só administrador ou quem tem "rh" marcado (sem marcação NÃO dá acesso — salário é sigiloso; SQL 052)
export const temRH = () => state.papel === 'admin' || (state.areas || []).includes('rh');

// gancho do modo sem internet (js/lib/offline.js): guarda as leituras das telas de chão de fábrica e responde sem sinal
export const ganchoQ = { ler: false, ehRede: null, guardar: null, offline: null };
export async function q(promise) {
  const g = ganchoQ.ler && promise && promise.method === 'GET' && promise.url ? ganchoQ : null;
  let res;
  try { res = await promise; } catch (e) { if (g && g.ehRede(e)) { const c = await g.offline(promise); if (c !== undefined) return c; } throw e; }
  const { data, error } = res;
  if (error) { if (g && g.ehRede(error, res.status)) { const c = await g.offline(promise); if (c !== undefined) return c; } throw error; }
  if (g) g.guardar(promise, data);
  return data;
}

// Busca todas as linhas (o Supabase limita 1000 por requisição)
export async function fetchAll(build, page = 1000) {
  let from = 0, out = [];
  for (;;) {
    const rows = await q(build().range(from, from + page - 1));
    out = out.concat(rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

let cadPendente = null;
export async function loadCadastros(force = false) {
  if (state.cad && !force) return state.cad;
  // várias telas podem pedir ao mesmo tempo (troca de empresa, renovação de sessão): uma carga só
  if (cadPendente && !force) return cadPendente;
  cadPendente = carregarCadastros().finally(() => { cadPendente = null; });
  return cadPendente;
}
// cache dos cadastros no navegador (melhoria 1.9): guardados no IndexedDB com a impressão digital do banco
// (cadastros_assinatura, SQL 123); só baixa de novo quando algum cadastro mudou
const IDB = 'iplamm-cadastros';
function cadIdb(modo, chave, valor) {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('c');
      r.onsuccess = () => { try { const t = r.result.transaction('c', modo), st = t.objectStore('c'), g = modo === 'readonly' ? st.get(chave) : st.put(valor, chave);
        t.oncomplete = () => { ok(g.result); r.result.close(); }; t.onerror = () => ok(null); } catch { ok(null); } };
      r.onerror = () => ok(null);
    } catch { ok(null); }
  });
}
/** ao sair: apaga os cadastros guardados neste navegador (dados de favorecidos não ficam no aparelho) */
export function limparCacheCadastros() { try { indexedDB.deleteDatabase(IDB); } catch {} }
async function carregarCadastros() {
  const e = state.empresa.id, chave = 'cad-' + e;
  // sem internet: os últimos cadastros guardados (ou a lista vazia — as telas de chão de fábrica não precisam deles)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const c = await cadIdb('readonly', chave);
    if (c?.dados) return montarCad(c.dados, true);
    state.cad = { plano: [], classes: [], contasPlano: [], contas: [], favorecidos: [], cc: [], grupos: [], planoById: {}, contaById: {}, favById: {}, ccById: {}, grupoById: {}, _offline: true };
    return state.cad;
  }
  let ass = null;
  try { const r = await sb.rpc('cadastros_assinatura', { p_empresa: e }); ass = r.error ? null : r.data; } catch { /* sem o SQL 123: baixa tudo */ }
  if (ass) { const c = await cadIdb('readonly', chave); if (c?.ass === ass && c.dados) return montarCad(c.dados); }
  const [plano, contas, favorecidos, cc, grupos] = await Promise.all([
    fetchAll(() => sb.from('plano_contas').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('contas').select('*').eq('empresa_id', e).order('codigo', { nullsFirst: false }).order('nome')),
    fetchAll(() => sb.from('favorecidos').select('*').eq('empresa_id', e).order('nome')),
    q(sb.from('centros_custo').select('*').eq('empresa_id', e).order('nome')),
    q(sb.from('grupos').select('*').eq('empresa_id', e).order('nome')),
  ]);
  const dados = { plano, contas, favorecidos, cc, grupos };
  if (ass) cadIdb('readwrite', chave, { ass, dados, em: Date.now() });
  return montarCad(dados);
}
function montarCad({ plano, contas, favorecidos, cc, grupos }, offline = false) {
  const byId = (arr) => Object.fromEntries(arr.map(x => [x.id, x]));
  plano.forEach(p => p.label = `${p.codigo} - ${p.nome}`);
  favorecidos.forEach(f => f.label = `${f.sigla ? f.sigla + ' - ' : ''}${f.nome}`);
  const classes = plano.filter(p => p.nivel === 1);
  const contasPlano = plano.filter(p => p.nivel === 2);
  state.cad = {
    plano, classes, contasPlano, contas, favorecidos, cc, grupos,
    planoById: byId(plano), contaById: byId(contas), favById: byId(favorecidos), ccById: byId(cc), grupoById: byId(grupos),
    ...(offline ? { _offline: true } : {}),
  };
  return state.cad;
}

// ---------------------------------------------------------------------
// Barra de filtros padrão (C. Custo, Favorecido, Grupo, Conta, Disponibilidade, Visão)
// ---------------------------------------------------------------------
export function filtrosHTML({ visao = true, extra = '' } = {}) {
  const c = state.cad, f = state.filtros;
  return `<div class="toolbar card" id="filtros">
    ${visao ? `<label>Visão<select name="visao">
      <option value="Pago" ${f.visao === 'Pago' ? 'selected' : ''}>Realizado (pago)</option>
      <option value="Pago,Em aberto" ${f.visao === 'Pago,Em aberto' ? 'selected' : ''}>Projetado (pago + em aberto)</option>
    </select></label>` : ''}
    <label>Grupo<select name="grupo">${options(c.grupos, { empty: 'Todos', selected: f.grupo })}</select></label>
    <label>Conta<select name="conta">${options(c.contas, { empty: 'Todas', selected: f.conta })}</select></label>
    <label>Centro de custo<select name="cc">${options(c.cc, { empty: 'Todos', selected: f.cc })}</select></label>
    <label class="grow">Favorecido<select name="favorecido">${options(c.favorecidos, { label: 'label', empty: 'Todos', selected: f.favorecido })}</select></label>
    <label>Disponibilidade<select name="disp">
      <option value="">Todos os recursos</option>
      <option ${f.disp === 'Conta com recursos disponíveis' ? 'selected' : ''}>Conta com recursos disponíveis</option>
      <option ${f.disp === 'Conta com recursos bloqueados' ? 'selected' : ''}>Conta com recursos bloqueados</option>
    </select></label>
    ${extra}
  </div>`;
}
export function bindFiltros(root, onChange) {
  const bar = $('#filtros', root);
  bar.addEventListener('change', (e) => {
    if (!(e.target.name in state.filtros)) return;
    state.filtros[e.target.name] = e.target.value;
    onChange();
  });
}
export function rpcFiltros(statusOverride) {
  const f = state.filtros;
  return {
    p_status: (statusOverride || f.visao).split(','),
    p_conta: f.conta || null, p_grupo: f.grupo || null, p_cc: f.cc || null,
    p_favorecido: f.favorecido || null, p_disp: f.disp || null,
  };
}
export function descricaoFiltros() {
  const f = state.filtros, c = state.cad;
  return `C. Custo: ${c.ccById[f.cc]?.nome || 'Todos'} | Favorecido: ${c.favById[f.favorecido]?.label || 'Todos'} | Grupo: ${c.grupoById[f.grupo]?.nome || 'Todos'} | Conta: ${c.contaById[f.conta]?.nome || 'Todas'} | Disponibilidade: ${f.disp || 'Todos os recursos'}`;
}

// ---------------------------------------------------------------------
// Matriz mensal: { [plano_id]: [12 valores] } + totais por classe e por tipo
// ---------------------------------------------------------------------
export async function matrizMensal(ano, statusOverride) {
  // obs.: a DRE usa comRecompras(matriz, ano, …) para levar a recompra de títulos para a linha do motivo
  const rows = await q(sb.rpc('resumo_mensal', { p_empresa: state.empresa.id, p_ano: ano, ...rpcFiltros(statusOverride) }));
  return montarMatriz(rows.map(r => ({ plano_id: r.plano_id, mes: r.mes, total: +r.total })));
}

export function montarMatriz(rows) {
  const c = state.cad;
  const conta = {}, classe = {}, tipo = { E: z(), S: z(), T: z() };
  for (const r of rows) {
    const p = c.planoById[r.plano_id]; if (!p) continue;
    (conta[p.id] ||= z())[r.mes - 1] += r.total;
    (classe[p.pai_id] ||= z())[r.mes - 1] += r.total;
    tipo[p.tipo][r.mes - 1] += r.total;
  }
  return { conta, classe, tipo };
}
export const z = () => Array(12).fill(0);

// Recompras de títulos (FIN021): a saída fica na 2.07.11 no fluxo de caixa, mas na DRE vai para a linha do MOTIVO
// (deduções da receita, despesas financeiras, não operacionais ou fora da DRE). Tira o valor da classe da 2.07.11 e
// põe numa linha própria por motivo. Sem o SQL 094 (ou sem recompras) a matriz fica como está.
export async function comRecompras(matriz, ano, statusOverride, filtros) {
  matriz.extra = []; matriz.recFora = z(); matriz.recPorSecao = {};
  try {
    const rows = await q(sb.rpc('fidc_recompras_dre', { p_empresa: state.empresa.id, p_ano: ano, ...(filtros || rpcFiltros(statusOverride)) }));
    const by = new Map();
    for (const r of rows) {
      const i = r.mes - 1, v = +r.total;
      if (matriz.classe[r.classe_id]) matriz.classe[r.classe_id][i] -= v;
      if (r.dre_secao === 'fora') { matriz.recFora[i] += v; continue; }
      const k = r.dre_secao + '|' + r.dre_rotulo;
      if (!by.has(k)) by.set(k, { dre_secao: r.dre_secao, classe: { id: 'rc:' + k, label: r.dre_rotulo, recompra: true }, v: z() });
      by.get(k).v[i] += v;
    }
    matriz.extra = [...by.values()];
  } catch { /* SQL 094 ainda não executado */ }
  return matriz;
}
export const soma = (a) => a.reduce((s, v) => s + v, 0);

// Estrutura da DRE gerencial (mesma lógica da aba "DRE Mensal")
export const DRE_SECOES = [
  { key: 'receita_bruta', titulo: 'RECEITA OPERACIONAL BRUTA' },
  { key: 'custos_diretos', titulo: '(-) CUSTOS DIRETOS' },
  { calc: 'lucro_bruto', titulo: 'LUCRO BRUTO', margem: 'Margem bruta (%)' },
  { key: 'despesas_operacionais', titulo: '(-) DESPESAS OPERACIONAIS' },
  { calc: 'ebitda', titulo: 'EBITDA GERENCIAL', margem: 'Margem EBITDA (%)' },
  { key: 'resultado_financeiro', titulo: 'RESULTADO FINANCEIRO', keys: ['receitas_financeiras', 'despesas_financeiras'] },
  { key: 'tributos', titulo: '(-) TRIBUTOS' },
  { calc: 'antes_nao_op', titulo: 'RESULTADO ANTES MOV. NÃO OPERAC.' },
  { key: 'nao_operacionais', titulo: '(-) MOVIMENTOS NÃO OPERACIONAIS' },
  { key: 'capital_giro', titulo: '(-) CAPITAL DE GIRO (ADIANTAMENTOS)' },
  { calc: 'resultado', titulo: 'RESULTADO GERENCIAL', margem: 'Margem final (%)' },
];

// Recebe matriz por classe (valores com sinal) e devolve linhas da DRE (12 meses)
export function montarDRE(matriz) {
  const c = state.cad;
  const sec = {}; const linhas = {};
  for (const cl of c.classes) {
    if (!cl.dre_secao) continue;
    const v = matriz.classe[cl.id] || z();
    (linhas[cl.dre_secao] ||= []).push({ classe: cl, v });
    sec[cl.dre_secao] ||= z();
    v.forEach((x, i) => sec[cl.dre_secao][i] += x);
  }
  for (const x of matriz.extra || []) {   // recompras por motivo (comRecompras)
    (linhas[x.dre_secao] ||= []).push({ classe: x.classe, v: x.v });
    sec[x.dre_secao] ||= z();
    x.v.forEach((y, i) => sec[x.dre_secao][i] += y);
  }
  const g = (k) => sec[k] || z();
  const abs = (arr) => arr.map(Math.abs);
  const rec = g('receita_bruta');
  const custos = abs(g('custos_diretos'));
  const lb = rec.map((v, i) => v - custos[i]);
  const desp = abs(g('despesas_operacionais'));
  const ebitda = lb.map((v, i) => v - desp[i]);
  const resfin = g('receitas_financeiras').map((v, i) => v + g('despesas_financeiras')[i]); // desp. financeiras já são negativas
  const trib = abs(g('tributos'));
  const antes = ebitda.map((v, i) => v + resfin[i] - trib[i]);
  const naoop = abs(g('nao_operacionais'));
  const giro = abs(g('capital_giro'));
  const resultado = antes.map((v, i) => v - naoop[i] - giro[i]);
  const val = { receita_bruta: rec, custos_diretos: custos, lucro_bruto: lb, despesas_operacionais: desp, ebitda,
    resultado_financeiro: resfin, tributos: trib, antes_nao_op: antes, nao_operacionais: naoop, capital_giro: giro, resultado };
  const out = [];
  for (const s of DRE_SECOES) {
    const k = s.key || s.calc;
    out.push({ tipo: 'sec', titulo: s.titulo, v: val[k] });
    const ks = s.keys || (s.key ? [s.key] : []);
    for (const kk of ks) for (const l of (linhas[kk] || [])) {
      const v = (kk === 'receita_bruta' || kk === 'receitas_financeiras' || kk === 'despesas_financeiras') ? l.v : l.v.map(Math.abs);
      out.push({ tipo: 'linha', titulo: l.classe.label, v, classe: l.classe });
    }
    if (s.margem) out.push({ tipo: 'pct', titulo: s.margem, v: val[k].map((x, i) => rec[i] ? x / rec[i] : null) });
  }
  return { linhas: out, val };
}

export function anosSelect(sel) {
  const atual = new Date().getFullYear();
  const ini = Math.min(state.empresa?.ano_inicio || atual, atual) - 1;
  let html = '';
  for (let a = atual + 1; a >= ini; a--) html += `<option ${a === state.ano ? 'selected' : ''}>${a}</option>`;
  sel.innerHTML = html;
}

export function mesesHeader(extra = '') {
  return MESES.map(m => `<th class="num">${m}</th>`).join('') + extra;
}
export { esc };

// ---------------------------------------------------------------------
// Transferência única: um lançamento com conta de origem (conta_id) e de destino (conta_destino_id).
// pontas() devolve cada lançamento como ponta(s) por conta: a origem com o sinal do plano e, quando há destino,
// uma segunda ponta no destino como entrada (plano de contrapartida 3.01). Use em qualquer cálculo por conta.
// ---------------------------------------------------------------------
export function pontas(ls) {
  const cad = state.cad, out = [];
  for (const l of ls) {
    const p = cad.planoById[l.plano_id];
    out.push({ ...l, sinal: (p?.natureza === 'C' ? 1 : -1) * +l.valor, destino: false });
    if (l.conta_destino_id) out.push({ ...l, conta_id: l.conta_destino_id, conta_origem_id: l.conta_id, plano_id: p?.contrapartida_id || l.plano_id, sinal: +l.valor, destino: true });
  }
  return out;
}
// filtro PostgREST "lançamentos desta conta" (origem ou destino da transferência)
export const daConta = (id) => `conta_id.eq.${id},conta_destino_id.eq.${id}`;

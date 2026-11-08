// Modo sem internet (melhoria 1.5): regras puras — erro de rede, chave da leitura guardada e filtros do PostgREST
// avaliados no aparelho para aplicar a fila por cima do último dado. Testes em tests/offline-calc.test.js.

// ---------- erro de rede × erro do servidor ----------
export const ehRede = (e, status) => status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)
  || /Failed to fetch|NetworkError|Load failed|FetchError|network|ERR_INTERNET|ERR_NETWORK/i.test(String(e?.message || e || ''));

// ---------- filtros do PostgREST avaliados no aparelho ----------
const RESERV = new Set(['select', 'order', 'limit', 'offset', 'and', 'or', 'on_conflict', 'columns']);
const valor = (s) => (s === 'null' ? null : s === 'true' ? true : s === 'false' ? false : s);
const igual = (a, b) => (a == null || b == null ? a == b : String(a) === String(b));
export function passa(linha, filtros) {
  for (const [col, exp] of filtros) {
    let neg = false, e = exp; if (e.startsWith('not.')) { neg = true; e = e.slice(4); }
    const i = e.indexOf('.'), op = e.slice(0, i), v = e.slice(i + 1), x = linha[col];
    let r = true;
    if (op === 'eq') r = igual(x, valor(v));
    else if (op === 'neq') r = !igual(x, valor(v));
    else if (op === 'is') r = v === 'null' ? x == null : igual(x, valor(v));
    else if (op === 'in') r = v.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).some(s => igual(x, s));
    else if (op === 'gt') r = x != null && String(x) > v; else if (op === 'gte') r = x != null && String(x) >= v;
    else if (op === 'lt') r = x != null && String(x) < v; else if (op === 'lte') r = x != null && String(x) <= v;
    if (neg ? r : !r) return false;
  }
  return true;
}
/** chave da leitura: tabela + parâmetros, sem datas/horas (a mesma consulta feita mais tarde cai na mesma chave) */
export function chaveLeitura(url) {
  const u = new URL(url), ps = [...u.searchParams.entries()].map(([k, v]) => [k, v.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?/g, '*')]).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  return u.pathname + '?' + ps.map(([k, v]) => k + '=' + v).join('&');
}
export const tabelaDa = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop());
export const filtrosDa = (url) => [...new URL(url).searchParams.entries()].filter(([k]) => !RESERV.has(k));

/** aplica a fila (inclusões, alterações e sombras) por cima das linhas guardadas, pelos filtros da consulta */
export function mesclar(linhas, tabela, filtros, fila) {
  let out = Array.isArray(linhas) ? linhas.map(l => ({ ...l })) : linhas;
  if (!Array.isArray(out)) return out;
  for (const it of fila) for (const op of it.ops) {
    if (op.t === 'insert' && op.tabela === tabela && !out.some(l => (op.valores.id != null && l.id === op.valores.id) || (op.valores.sync_id != null && l.sync_id === op.valores.sync_id))) out.push({ id: op.valores.sync_id, ...op.valores, _offline: true });
    if (op.t === 'rpc' && op.sombra?.tabela === tabela && !out.some(l => l.id === op.sombra.valores.id)) out.push({ ...op.sombra.valores, _offline: true });
    if (op.t === 'update' && op.tabela === tabela) out = out.map(l => (l.id === op.id ? { ...l, ...op.valores, _offline: true } : l));
  }
  return out.filter(l => passa(l, filtros));
}


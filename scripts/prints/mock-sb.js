import './seed.js';
// MOCK do Supabase para as telas dos manuais — dados FICTÍCIOS em memória (window.DB). Nada sai do navegador.
const DB = window.DB = window.DB || {};
const LOG = window.MOCKLOG = { tabelas: new Set(), rpcs: new Set(), faltaRpc: new Set() };
const RPC = window.RPC = window.RPC || {};
const USER = { id: 'u1', email: 'renata@exemplo.com.br', user_metadata: { nome: 'Renata Alves' } };
const uid = () => 'x' + Math.random().toString(36).slice(2, 10);
// relações para selects com junção: tabela → coluna
const FK = { empresas: 'empresa_id', plano_contas: 'plano_id', contas: 'conta_id', favorecidos: 'favorecido_id', centros_custo: 'cc_id', grupos: 'grupo_id' };
function parseSel(s) {   // "*, empresas(*), conta:contas(nome)" → joins
  const joins = []; let depth = 0, cur = '';
  for (const ch of String(s || '*')) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { joins.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) joins.push(cur.trim());
  return joins.map(j => { const m = j.match(/^(?:(\w+):)?(\w+)(?:!\w+)?\((.*)\)$/s); return m ? { alias: m[1] || m[2], tab: m[2], sub: m[3] } : null; }).filter(Boolean);
}
function anexar(tab, row, joins) {
  const o = { ...row };
  for (const j of joins) {
    const fk = FK[j.tab] || (j.tab.replace(/s$/, '') + '_id');
    if (row[fk] !== undefined) o[j.alias] = (DB[j.tab] || []).find(r => r.id === row[fk]) || null;
    else o[j.alias] = (DB[j.tab] || []).filter(r => r[(tab.replace(/s$/, '')) + '_id'] === row.id);
  }
  return o;
}
function val(r, c) { return c.includes('->') ? c.split(/->>?/).reduce((a, k) => a?.[k], r) : r[c]; }
function builder(tab) {
  LOG.tabelas.add(tab);
  const rows = () => DB[tab] || (DB[tab] = []);
  const f = []; let op = 'select', payload = null, ord = [], lim = null, off = 0, single = false, maybe = false, sel = '*', head = false, cnt = null, retorna = false;
  const api = {
    select(s = '*', o = {}) { if (op === 'select') sel = s; else retorna = true; head = !!o.head; cnt = o.count || null; return api; },
    eq(c, v) { f.push(r => val(r, c) == v); return api; }, neq(c, v) { f.push(r => val(r, c) != v); return api; },
    gt(c, v) { f.push(r => val(r, c) > v); return api; }, gte(c, v) { f.push(r => val(r, c) >= v); return api; },
    lt(c, v) { f.push(r => val(r, c) < v); return api; }, lte(c, v) { f.push(r => val(r, c) <= v); return api; },
    is(c, v) { f.push(r => (val(r, c) ?? null) === v); return api; }, in(c, vs) { f.push(r => (vs || []).includes(val(r, c))); return api; },
    not(c, opr, v) { if (opr === 'is') f.push(r => (val(r, c) ?? null) !== v); else if (opr === 'in') { const l = String(v).replace(/[()]/g, '').split(','); f.push(r => !l.includes(String(val(r, c)))); } else if (opr === 'eq') f.push(r => val(r, c) != v); return api; },
    ilike(c, p) { const re = new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); f.push(r => re.test(val(r, c) || '')); return api; },
    like(c, p) { return api.ilike(c, p); }, contains() { return api; }, overlaps() { return api; }, filter() { return api; }, match(o) { Object.entries(o).forEach(([c, v]) => api.eq(c, v)); return api; },
    or(s) { const cs = s.split(',').map(x => x.split('.')); f.push(r => cs.some(([c, o, ...v]) => { v = v.join('.'); const x = val(r, c); return o === 'eq' ? x == v : o === 'is' ? (x ?? null) === null : o === 'ilike' ? String(x || '').toLowerCase().includes(v.replace(/%/g, '').toLowerCase()) : o === 'gte' ? x >= v : o === 'lte' ? x <= v : o === 'gt' ? x > v : o === 'lt' ? x < v : false; })); return api; },
    textSearch() { return api; },
    order(c, o = {}) { ord.push([c, o.ascending !== false]); return api; }, limit(n) { lim = n; return api; }, range(a, b) { off = a; lim = b - a + 1; return api; },
    single() { single = true; return api; }, maybeSingle() { single = maybe = true; return api; }, abortSignal() { return api; }, csv() { return api; },
    insert(p) { op = 'insert'; payload = p; return api; }, upsert(p) { op = 'upsert'; payload = p; return api; }, update(p) { op = 'update'; payload = p; return api; }, delete() { op = 'delete'; return api; },
    then(res, rej) { try { res(exec()); } catch (e) { console.error('mock', tab, e); res({ data: null, error: { message: String(e) } }); } },
  };
  function exec() {
    const R = rows(), m = R.filter(r => f.every(fn => fn(r)));
    if (op === 'select') {
      let d = m.slice();
      for (const [c, asc] of ord.slice().reverse()) d.sort((a, b) => { const x = val(a, c), y = val(b, c); return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1); });
      const total = d.length; d = d.slice(off, lim != null ? off + lim : undefined);
      const joins = parseSel(sel); if (joins.length) d = d.map(r => anexar(tab, r, joins));
      if (head) return { data: null, count: total, error: null };
      return { data: single ? (d[0] ?? null) : d, count: cnt ? total : null, error: single && !maybe && !d[0] ? { message: 'not found' } : null };
    }
    if (op === 'insert' || op === 'upsert') { const arr = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: uid(), empresa_id: 'emp1', criado_em: new Date().toISOString(), created_at: new Date().toISOString(), ...p })); R.push(...arr); return { data: single ? arr[0] : arr, error: null }; }
    if (op === 'update') { m.forEach(r => Object.assign(r, payload)); return { data: single ? m[0] : m, error: null }; }
    if (op === 'delete') { DB[tab] = R.filter(r => !m.includes(r)); return { data: m, error: null }; }
  }
  return api;
}
const canal = (nome) => { const ch = { nome, on() { return ch; }, subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 5); return ch; }, track: async () => {}, untrack: async () => {}, presenceState: () => ({}), send: async () => {}, unsubscribe: async () => {} }; return ch; };
export const sbMock = {
  from: builder,
  rpc(n, a) {
    LOG.rpcs.add(n); const h = RPC[n];
    if (h === undefined) LOG.faltaRpc.add(n);
    const p = Promise.resolve().then(() => ({ data: typeof h === 'function' ? h(a || {}) : (h === undefined ? [] : h), error: null }));
    const api = { then: (r, j) => p.then(r, j), select: () => api, single: () => api, maybeSingle: () => api, order: () => api, limit: () => api, eq: () => api, range: () => api };
    return api;
  },
  auth: {
    onAuthStateChange(cb) { setTimeout(() => cb('SIGNED_IN', { user: USER, access_token: 'x' }), 0); return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: { user: USER, access_token: 'x' } }, error: null }), getUser: async () => ({ data: { user: USER }, error: null }),
    signOut: async () => ({ error: null }), updateUser: async () => ({ error: null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }), listFactors: async () => ({ data: { totp: [], all: [] }, error: null }) },
  },
  channel: canal, removeChannel() {}, getChannels: () => [], realtime: { setAuth() {} },
  storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), createSignedUrl: async () => ({ data: { signedUrl: 'data:,' }, error: null }), createSignedUrls: async (ps) => ({ data: ps.map(p => ({ path: p, signedUrl: 'data:,' })), error: null }), download: async () => ({ data: new Blob(['x']), error: null }), remove: async () => ({ data: [], error: null }), list: async () => ({ data: [], error: null }) }) },
  functions: { invoke: async () => ({ data: null, error: null }) },
};

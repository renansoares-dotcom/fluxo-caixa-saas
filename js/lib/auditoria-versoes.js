// Versões de um registro a partir da auditoria (melhoria 10.3). Funções puras, usadas pela tela Auditoria e pelos testes.
/** reconstrói o registro completo depois de cada evento (para trás a partir do registro atual, ou para frente desde a inclusão) */
export function versoes(eventos, atual) {
  const E = [...eventos].sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)) || (a.id - b.id));
  const out = E.map(e => ({ e, estado: null, excluido: e.acao === 'excluiu' }));
  if (atual && E.length && E[E.length - 1].acao !== 'excluiu') {
    let S = { ...atual };
    for (let i = E.length - 1; i >= 0; i--) { out[i].estado = { ...S }; if (E[i].acao === 'alterou') S = { ...S, ...(E[i].antes || {}) }; else if (E[i].acao === 'incluiu') S = {}; }
  } else {
    let S = {};
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (e.acao === 'incluiu') S = { ...(e.depois || {}) };
      else if (e.acao === 'alterou') { for (const [k, v] of Object.entries(e.antes || {})) if (!(k in S)) for (let j = 0; j < i; j++) if (out[j].estado && !(k in out[j].estado)) out[j].estado[k] = v;
        S = { ...S, ...(e.antes ? Object.fromEntries(Object.entries(e.antes).filter(([k]) => !(k in S))) : {}), ...(e.depois || {}) }; }
      else S = { ...(e.antes || S) };
      out[i].estado = { ...S };
    }
  }
  return out;
}
/** campos que diferem entre duas versões (ou todos) */
export function diferencas(a = {}, b = {}, todos = false) {
  const ign = new Set(['empresa_id', 'updated_at', 'created_at', 'atualizado_em', 'criado_em', 'xml']);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !ign.has(k) && (todos || JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))).sort();
}


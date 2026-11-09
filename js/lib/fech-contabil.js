// Fechamento contábil assistido (melhoria 9.3): decomposição dos lançamentos em pares débito × crédito e o arquivo para o Domínio.
// O leiaute (separador, data, decimal, conta por código reduzido ou classificação, ordem dos campos) vem de contab_fech_config.

const r2 = (v) => Math.round((+v + Number.EPSILON) * 100) / 100;

/** partidas [{conta_id, debito, credito}] -> pares [{debito: conta, credito: conta, valor}] (casamento guloso, mantém a ordem) */
export function pares(partidas) {
  const D = partidas.filter(p => +p.debito > 0).map(p => ({ c: p.conta_id, v: r2(p.debito) }));
  const C = partidas.filter(p => +p.credito > 0).map(p => ({ c: p.conta_id, v: r2(p.credito) }));
  const out = []; let i = 0, j = 0;
  while (i < D.length && j < C.length) {
    const v = r2(Math.min(D[i].v, C[j].v));
    if (v > 0) out.push({ debito: D[i].c, credito: C[j].c, valor: v });
    D[i].v = r2(D[i].v - v); C[j].v = r2(C[j].v - v);
    if (D[i].v <= 0.004) i++; if (C[j].v <= 0.004) j++;
  }
  return out;
}

const fmtData = (d, f) => { const [a, m, dd] = d.slice(0, 10).split('-'); return f === 'aaaa-mm-dd' ? `${a}-${m}-${dd}` : f === 'ddmmaaaa' ? `${dd}${m}${a}` : `${dd}/${m}/${a}`; };
const fmtValor = (v, dec) => { const s = r2(v).toFixed(2); return dec === ',' ? s.replace('.', ',') : s; };
const limpa = (t, sep) => String(t ?? '').replace(/[\r\n]+/g, ' ').split(sep).join(' ').trim();

export const CAMPOS = { data: 'Data', debito: 'Conta débito', credito: 'Conta crédito', valor: 'Valor', historico_codigo: 'Código do histórico', complemento: 'Complemento do histórico', lote: 'Lote', origem: 'Origem' };

/**
 * lancs: [{ id, data, historico, origem, partidas: [{conta_id, debito, credito}] }]; contas: Map(id -> {codigo, classificacao})
 * cfg: contab_fech_config. Devolve { texto, linhas, semConta: [...], porOrigem }
 */
export function arquivoDominio(lancs, contas, cfg = {}) {
  const sep = cfg.dom_separador === 'tab' ? '\t' : (cfg.dom_separador || ';');
  const campos = cfg.dom_campos?.length ? cfg.dom_campos : ['data', 'debito', 'credito', 'valor', 'historico_codigo', 'complemento'];
  const origens = new Set(cfg.dom_origens?.length ? cfg.dom_origens : lancs.map(l => l.origem));
  const conta = (id) => { const c = contas.get(id); if (!c) return null; return cfg.dom_conta === 'classificacao' ? c.classificacao : (c.codigo ?? null); };
  const rows = [], semConta = new Set(), porOrigem = {}; let lote = 0;
  for (const l of [...lancs].sort((a, b) => a.data.localeCompare(b.data) || String(a.id).localeCompare(String(b.id)))) {
    if (!origens.has(l.origem)) continue;
    lote++; porOrigem[l.origem] = (porOrigem[l.origem] || 0) + 1;
    for (const p of pares(l.partidas || [])) {
      const d = conta(p.debito), c = conta(p.credito);
      if (d == null) semConta.add(p.debito); if (c == null) semConta.add(p.credito);
      const v = { data: fmtData(l.data, cfg.dom_data), debito: d ?? '', credito: c ?? '', valor: fmtValor(p.valor, cfg.dom_decimal || ','), historico_codigo: cfg.dom_historico_codigo || '',
        complemento: limpa(l.historico, sep), lote: String(lote), origem: l.origem };
      rows.push(campos.map(k => v[k] ?? '').join(sep));
    }
  }
  const cab = cfg.dom_cabecalho ? [campos.map(k => CAMPOS[k] || k).join(sep)] : [];
  return { texto: [...cab, ...rows].join('\r\n') + (rows.length ? '\r\n' : ''), linhas: rows.length, lancamentos: lote, semConta: [...semConta], porOrigem };
}

/** total gerado × sugerido, pendências das sugestões */
export function resumoSugestoes(S) {
  const L = S || [];
  return { total: r2(L.reduce((t, s) => t + (+s.valor || 0), 0)), gerados: L.filter(s => s.gerado).length, pendentes: L.filter(s => !s.gerado && +s.valor > 0 && !s.aviso).length,
    avisos: L.filter(s => s.aviso).length, divergentes: L.filter(s => s.gerado && s.valor != null && Math.abs((+s.valor_gerado || 0) - (+s.valor || 0)) > 0.005).length };
}

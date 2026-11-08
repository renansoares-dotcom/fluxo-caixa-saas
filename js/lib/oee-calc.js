// OEE (melhoria 6.1): disponibilidade × desempenho × qualidade e as perdas em horas, a partir dos números de prod_oee.
// Funções puras.
//
// Tempo calendário   = horas produtivas do setor por dia × dias do período
// Tempo planejado    = calendário − paradas planejadas (setup, limpeza programada…)
// Disponibilidade    = horas apontadas ÷ tempo planejado
// Desempenho         = (bom + refugo) ÷ (horas apontadas × capacidade kg/h)
// Qualidade          = bom ÷ (bom + refugo)
// Perdas (horas)     = paradas não planejadas (produção + OS de manutenção) · tempo sem apontamento e sem parada registrada
//                      · perda de velocidade · refugo; o que sobra é o tempo efetivo (= OEE × tempo planejado).

export const CFG_PADRAO = { meta_oee: 65, meta_disp: 85, meta_perf: 85, meta_qual: 95, atencao_pp: 10, metas_maquina: {}, contar_os_manutencao: true };
const n = (v) => Number(v || 0);
const cap1 = (v) => (v == null ? null : Math.max(0, Math.min(1, v)));

export function soma(linhas) {
  const t = { horas_cal: 0, horas_run: 0, bom: 0, refugo: 0, apont: 0, h_plan: 0, h_nao_plan: 0, h_os: 0, qtd_os: 0, cap_horas: 0, dias: 0 };
  for (const l of linhas) {
    for (const k of Object.keys(t)) if (k !== 'cap_horas') t[k] += n(l[k]);
    t.cap_horas += n(l.horas_run) * n(l.capacidade);   // kg possíveis nas horas apontadas
  }
  return t;
}

/** índices e perdas de um conjunto de linhas (cada linha com a capacidade da máquina em `capacidade`) */
export function indices(linhas) {
  const t = soma(Array.isArray(linhas) ? linhas : [linhas]);
  const tPlan = Math.max(t.horas_cal - t.h_plan, 0);
  const run = Math.min(t.horas_run, tPlan);
  const naoPlan = t.h_nao_plan + t.h_os;
  const D = tPlan > 0 ? cap1(run / tPlan) : null;
  const P = t.cap_horas > 0 ? cap1((t.bom + t.refugo) / t.cap_horas) : null;
  const Q = t.bom + t.refugo > 0 ? t.bom / (t.bom + t.refugo) : null;
  const oee = D != null && P != null && Q != null ? D * P * Q : null;
  const naoApont = Math.max(tPlan - run - naoPlan, 0);
  const vel = P != null ? run * (1 - P) : 0, qual = P != null && Q != null ? run * P * (1 - Q) : 0;
  return {
    ...t, tPlan, run, naoPlan, D, P, Q, oee,
    perdas: { planejadas: t.h_plan, naoPlan: Math.min(naoPlan, Math.max(tPlan - run, 0)), naoApont, velocidade: vel, qualidade: qual, efetivo: oee != null ? oee * tPlan : null },
  };
}

/** situação de um índice (0–1) contra a meta (%): ok, atencao (até atencao_pp pontos abaixo), abaixo */
export function situacao(v, metaPct, atencaoPp = 10) {
  if (v == null || metaPct == null) return null;
  const x = v * 100;
  return x >= metaPct ? 'ok' : x >= metaPct - atencaoPp ? 'atencao' : 'abaixo';
}
export const metaMaquina = (cfg, id) => { const m = (cfg.metas_maquina || {})[id]; return m === '' || m == null || !isFinite(+m) ? cfg.meta_oee : +m; };

/** linhas por máquina e por período, com a capacidade da máquina */
export function preparar(dados, maquinas) {
  const cap = Object.fromEntries((maquinas || []).map(m => [m.id, n(m.capacidade_kg_h)]));
  return (dados?.linhas || []).map(l => ({ ...l, capacidade: cap[l.maquina_id] ?? 0 }));
}
export function porMaquina(linhas) {
  const g = new Map();
  for (const l of linhas) (g.get(l.maquina_id) || g.set(l.maquina_id, []).get(l.maquina_id)).push(l);
  return [...g].map(([id, ls]) => ({ maquina_id: id, ...indices(ls) }));
}
export function porPeriodo(linhas) {
  const g = new Map();
  for (const l of linhas) (g.get(l.per) || g.set(l.per, []).get(l.per)).push(l);
  return [...g].sort((a, b) => a[0].localeCompare(b[0])).map(([per, ls]) => ({ per, ...indices(ls) }));
}

/** Pareto: motivos somados (horas), do maior para o menor, com o acumulado em % */
export function pareto(itens, campo = 'horas') {
  const o = new Map();
  for (const x of itens || []) o.set(x.motivo, (o.get(x.motivo) || { motivo: x.motivo, planejada: !!x.planejada, v: 0, qtd: 0 }));
  for (const x of itens || []) { const r = o.get(x.motivo); r.v += n(x[campo]); r.qtd += n(x.qtd); }
  const l = [...o.values()].filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const tot = l.reduce((s, x) => s + x.v, 0); let ac = 0;
  return l.map(x => { ac += x.v; return { ...x, pct: tot ? x.v / tot : 0, acum: tot ? ac / tot : 0 }; });
}

/** maior perda em horas, para a frase "onde está a maior perda" */
export function maiorPerda(p) {
  const nomes = { naoPlan: 'paradas não planejadas', naoApont: 'tempo sem apontamento nem parada registrada', velocidade: 'perda de velocidade', qualidade: 'refugo' };
  const l = Object.entries(nomes).map(([k, t]) => [t, n(p[k])]).sort((a, b) => b[1] - a[1]);
  return l[0][1] > 0 ? { nome: l[0][0], horas: l[0][1] } : null;
}

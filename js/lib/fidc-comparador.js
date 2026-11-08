// Comparador de fundos FIDC (melhoria 3.11): custo efetivo realizado por fundo, curva por prazo, comparação com o CDI
// e a melhor divisão de um lote de títulos entre os fundos, respeitando o limite disponível de cada um.
// Funções puras, testadas em tests/fidc-comparador.test.js.

/** taxa efetiva ao mês: custo sobre o valor antecipado (face − custo), proporcional a 30 dias */
export const taxaEf = (custo, face, prazo) => (face > custo && prazo > 0 ? custo / (face - custo) / prazo * 30 : 0);
/** taxa ao mês → ao ano (composta) */
export const anual = (tm) => Math.pow(1 + tm, 12) - 1;
/** taxa ao ano → ao mês (composta) */
export const mensal = (ta) => Math.pow(1 + ta, 1 / 12) - 1;

const ym = (d) => String(d).slice(0, 7);
const addMeses = (s, n) => { const [a, m] = s.split('-').map(Number); const t = a * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };

/**
 * custo efetivo realizado por fundo nos últimos `meses` (borderôs de fidc_operacoes).
 * A taxa do período pondera cada borderô pelo valor antecipado × prazo: Σcusto ÷ Σ((face − custo) × prazo ÷ 30).
 */
export function historico(ops, { meses = 12, hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const fim = ym(hoje), ini = addMeses(fim, -(meses - 1));
  const lista = Array.from({ length: meses }, (_, i) => addMeses(ini, i));
  const F = {};
  for (const o of ops) {
    const m = ym(o.data); if (m < ini || m > fim) continue;
    const face = +o.valor_face || 0, custo = +o.custo_total || 0, prazo = +o.prazo_medio || 0;
    if (!face || face <= custo || !prazo) continue;
    const f = (F[o.fundo] ||= { fundo: o.fundo, n: 0, face: 0, custo: 0, base: 0, prazoFace: 0, ultima: null, porMes: {} });
    const base = (face - custo) * prazo / 30;
    f.n++; f.face += face; f.custo += custo; f.base += base; f.prazoFace += prazo * face;
    if (!f.ultima || o.data > f.ultima) f.ultima = o.data;
    const pm = (f.porMes[m] ||= { face: 0, custo: 0, base: 0, n: 0 }); pm.face += face; pm.custo += custo; pm.base += base; pm.n++;
  }
  const fundos = Object.values(F).map(f => {
    const taxa = f.base ? f.custo / f.base : 0;
    return { fundo: f.fundo, n: f.n, face: f.face, custo: f.custo, prazo: f.face ? f.prazoFace / f.face : 0, taxa, cet: anual(taxa), ultima: f.ultima,
      serie: lista.map(m => (f.porMes[m]?.base ? f.porMes[m].custo / f.porMes[m].base : null)), volume: lista.map(m => f.porMes[m]?.face || 0) };
  }).sort((a, b) => a.taxa - b.taxa);
  const tot = fundos.reduce((s, f) => ({ face: s.face + f.face, custo: s.custo + f.custo, base: s.base + f.custo / (f.taxa || Infinity) }), { face: 0, custo: 0, base: 0 });
  return { meses: lista, fundos, face: tot.face, custo: tot.custo, taxa: tot.base ? tot.custo / tot.base : 0 };
}

/** taxa efetiva realizada por faixa de prazo médio do borderô (ex.: [30, 45, 60, 90] → até 30, 31–45, 46–60, 61–90, acima de 90) */
export function curvaPrazo(ops, faixas = [30, 45, 60, 90], { de = null } = {}) {
  const rot = faixas.map((f, i) => (i === 0 ? `até ${f} dias` : `${faixas[i - 1] + 1} a ${f}`)).concat(`acima de ${faixas[faixas.length - 1]}`);
  const idx = (p) => { const i = faixas.findIndex(f => p <= f); return i < 0 ? faixas.length : i; };
  const T = {};
  for (const o of ops) {
    if (de && o.data < de) continue;
    const face = +o.valor_face || 0, custo = +o.custo_total || 0, prazo = +o.prazo_medio || 0;
    if (!face || face <= custo || !prazo) continue;
    const k = idx(prazo), c = ((T[o.fundo] ||= rot.map(() => ({ custo: 0, base: 0, n: 0 })))[k]);
    c.custo += custo; c.base += (face - custo) * prazo / 30; c.n++;
  }
  const fundos = Object.keys(T).sort();
  const linhas = rot.map((r, k) => {
    const v = fundos.map(f => (T[f][k].base ? { taxa: T[f][k].custo / T[f][k].base, n: T[f][k].n } : null));
    const ok = v.map((x, i) => (x ? i : -1)).filter(i => i >= 0);
    const melhor = ok.length ? ok.reduce((a, i) => (v[i].taxa < v[a].taxa ? i : a), ok[0]) : -1;
    return { faixa: r, valores: v, melhor: melhor >= 0 ? fundos[melhor] : null };
  });
  return { fundos, linhas };
}

/**
 * Melhor divisão de um lote entre fundos.
 *  fundos: [{ id, nome }]; titulos: [{ id, valor, ... }]
 *  custoTit(fu, t) → custo variável do título no fundo, ou null se o fundo não aceita o título (prazo, condição…)
 *  custoLote(fu, tits) → custo exato do lote no fundo (com as tarifas fixas e o agrupamento por condição)
 *  disponivel(fu) → limite ainda livre no fundo (Infinity = sem limite)
 * 1) cada título vai para o fundo de menor custo variável que ainda tem limite;
 * 2) consolidação: tenta levar todos os títulos de um fundo para os outros já usados (ou o próximo melhor), se o
 *    custo total exato cair (economiza as tarifas fixas do borderô);
 * Devolve { grupos: [{ fu, tits, custo, face }], custo, semFundo: [t], unico: { fu, custo } | null }.
 */
export function distribuir({ fundos, titulos, custoTit, custoLote, disponivel = () => Infinity }) {
  const livre = new Map(fundos.map(f => [f.id, disponivel(f)]));
  const aloc = new Map(fundos.map(f => [f.id, []]));
  const semFundo = [];
  // os maiores primeiro: ocupam o limite antes dos pequenos
  for (const t of [...titulos].sort((a, b) => +b.valor - +a.valor)) {
    const opc = fundos.map(fu => ({ fu, c: custoTit(fu, t) })).filter(x => x.c != null && livre.get(x.fu.id) >= +t.valor).sort((a, b) => a.c - b.c);
    if (!opc.length) { semFundo.push(t); continue; }
    aloc.get(opc[0].fu.id).push(t); livre.set(opc[0].fu.id, livre.get(opc[0].fu.id) - +t.valor);
  }
  const total = (A) => fundos.reduce((s, fu) => s + (A.get(fu.id).length ? custoLote(fu, A.get(fu.id)) : 0), 0);
  let atual = total(aloc), melhorou = true, voltas = 0;
  while (melhorou && voltas++ < 10) {
    melhorou = false;
    for (const fu of fundos) {
      const tits = aloc.get(fu.id); if (!tits.length) continue;
      // tenta esvaziar este fundo levando cada título para o melhor outro fundo com limite
      const A = new Map([...aloc].map(([k, v]) => [k, [...v]])), L = new Map(livre);
      A.set(fu.id, []); L.set(fu.id, L.get(fu.id) + tits.reduce((s, t) => s + +t.valor, 0));
      let ok = true;
      for (const t of tits) {
        const opc = fundos.filter(f => f.id !== fu.id).map(f => ({ f, c: custoTit(f, t), usado: A.get(f.id).length > 0 }))
          .filter(x => x.c != null && L.get(x.f.id) >= +t.valor).sort((a, b) => (b.usado - a.usado) || a.c - b.c);
        if (!opc.length) { ok = false; break; }
        A.get(opc[0].f.id).push(t); L.set(opc[0].f.id, L.get(opc[0].f.id) - +t.valor);
      }
      if (!ok) continue;
      const novo = total(A);
      if (novo < atual - 0.005) { for (const [k, v] of A) aloc.set(k, v); for (const [k, v] of L) livre.set(k, v); atual = novo; melhorou = true; }
    }
  }
  const grupos = fundos.filter(fu => aloc.get(fu.id).length).map(fu => { const tits = aloc.get(fu.id); return { fu, tits, custo: custoLote(fu, tits), face: tits.reduce((s, t) => s + +t.valor, 0) }; })
    .sort((a, b) => b.face - a.face);
  // referência: o lote inteiro num fundo só (o mais barato que aceita todos e tem limite)
  const faceTot = titulos.reduce((s, t) => s + +t.valor, 0);
  const unicos = fundos.filter(fu => disponivel(fu) >= faceTot && titulos.every(t => custoTit(fu, t) != null)).map(fu => ({ fu, custo: custoLote(fu, titulos) })).sort((a, b) => a.custo - b.custo);
  return { grupos, custo: grupos.reduce((s, g) => s + g.custo, 0), semFundo, unico: unicos[0] || null };
}

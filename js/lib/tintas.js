// Casa de Tintas (SQL 088) — regras puras: escala da receita, andamento da pesagem, correção de proporção, custo teórico,
// ΔE (CIE76 e CIEDE2000), medição contra a versão, indicadores e alertas. Nada aqui busca dado no banco.

export const SIT_VERSAO = { rascunho: 'Rascunho', em_teste: 'Em teste', aprovada: 'Aprovada', bloqueada: 'Bloqueada', obsoleta: 'Obsoleta' };
export const SIT_ORDEM = { aberta: 'Aberta', em_pesagem: 'Em pesagem', em_ajuste: 'Em ajuste', aprovada: 'Aprovada', entregue: 'Entregue à máquina', encerrada: 'Encerrada', cancelada: 'Cancelada' };
export const ABERTAS = ['aberta', 'em_pesagem', 'em_ajuste'];
export const FUNCOES = { base: 'Tinta base', pigmento: 'Pigmento / concentrado', verniz: 'Verniz', solvente: 'Solvente / diluente', retardador: 'Retardador', aditivo: 'Aditivo', sobra: 'Sobra de tinta pronta', outro: 'Outro' };
export const APLICACOES = { superficie: 'Impressão de superfície', laminacao: 'Laminação', verso: 'Verso', outra: 'Outra' };
export const PADROES = { pantone: 'Pantone', cliente: 'Padrão do cliente', instrumental: 'Instrumental (L*a*b*)' };

const n = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const r = (v, c = 3) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** c) / 10 ** c);
const ms = (d) => new Date(String(d).length === 10 ? d + 'T12:00:00' : d).getTime();

/** quantidade prevista de cada item para a quantidade da ordem */
export const prevista = (item, versao, qtd) => r(+item.quantidade * +qtd / +(versao.base_kg || 100), 4);

/** percentual de cada item e total da base (a receita fecha em 100% da base?) */
export function composicao(itens = [], base = 100) {
  const tot = itens.reduce((s, i) => s + (+i.quantidade || 0), 0);
  return { total: r(tot, 4), fecha: Math.abs(tot - base) < 0.0005, linhas: itens.map(i => ({ ...i, pct: tot ? r(+i.quantidade / tot * 100, 2) : 0 })) };
}

/** custo teórico por kg pela composição e o custo de cada insumo (R$/kg) */
export function custoTeorico(itens = [], custos = {}) {
  const tot = itens.reduce((s, i) => s + (+i.quantidade || 0), 0);
  if (!tot) return null;
  const faltam = itens.filter(i => custos[i.produto_id] == null).length;
  return { custoKg: r(itens.reduce((s, i) => s + (+i.quantidade || 0) * (+custos[i.produto_id] || 0), 0) / tot, 4), faltam };
}

/** andamento da pesagem: por item, o previsto, o pesado (sem os ajustes), o desvio e a situação */
export function andamento(itens = [], pesagens = [], versao, qtd, tolPadrao = 2) {
  const val = pesagens.filter(p => p.situacao !== 'estornada');
  const linhas = [...itens].sort((a, b) => a.seq - b.seq).map(it => {
    const prev = prevista(it, versao, qtd), pes = r(val.filter(p => p.item_id === it.id && !p.ajuste).reduce((s, p) => s + +p.pesada, 0), 4);
    const tol = it.tolerancia_pct ?? tolPadrao, desv = prev ? r((pes - prev) / prev * 100, 2) : null;
    const st = !pes ? 'falta' : desv > tol ? 'acima' : desv < -tol ? 'abaixo' : 'ok';
    return { item: it, prevista: prev, pesada: pes, falta: r(Math.max(0, prev - pes), 4), desvio: pes ? desv : null, tol, status: st };
  });
  const ajustes = val.filter(p => p.ajuste);
  const total = r(val.reduce((s, p) => s + +p.pesada, 0), 4), custo = r(val.reduce((s, p) => s + +(p.custo || 0), 0), 2);
  return { linhas, ajustes, total, custo, custoKg: total ? r(custo / total, 4) : null, proxima: linhas.find(l => l.status === 'falta' || l.status === 'abaixo') || null,
    completa: linhas.every(l => l.status === 'ok' || l.status === 'acima'), foraTol: linhas.filter(l => l.status === 'acima').length };
}

/** correção de proporção: a nova quantidade da ordem que mantém a fórmula com o item que mais passou */
export function correcaoProporcao(and, qtd) {
  const acima = and.linhas.filter(l => l.status === 'acima' && l.prevista > 0);
  if (!acima.length) return null;
  const pior = acima.reduce((a, b) => (b.pesada / b.prevista > a.pesada / a.prevista ? b : a));
  const nova = r(+qtd * pior.pesada / pior.prevista, 3);
  return { nova, fator: r(nova / +qtd, 4), item: pior.item, acrescimo: r(nova - +qtd, 3) };
}

/** ΔE CIE76 */
export const deltaE76 = (p, q) => r(Math.sqrt((p.l - q.l) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2), 2);
/** ΔE CIEDE2000 (kL = kC = kH = 1) — Sharma, Wu e Dalal (2005) */
export function deltaE00(p, q) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(p.a, p.b), C2 = Math.hypot(q.a, q.b), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1 = (1 + G) * p.a, a2 = (1 + G) * q.a, c1 = Math.hypot(a1, p.b), c2 = Math.hypot(a2, q.b);
  const h = (b, a) => { if (b === 0 && a === 0) return 0; const x = Math.atan2(b, a) * deg; return x < 0 ? x + 360 : x; };
  const h1 = h(p.b, a1), h2 = h(q.b, a2);
  const dL = q.l - p.l, dC = c2 - c1;
  let dh = 0; if (c1 * c2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(dh / 2 * rad);
  const Lm = (p.l + q.l) / 2, cm = (c1 + c2) / 2;
  let hm = h1 + h2; if (c1 * c2 !== 0) { if (Math.abs(h1 - h2) > 180) hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2; else hm = (h1 + h2) / 2; }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.20 * Math.cos((4 * hm - 63) * rad);
  const dTh = 30 * Math.exp(-(((hm - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), Sc = 1 + 0.045 * cm, Sh = 1 + 0.015 * cm * T, Rt = -Math.sin(2 * dTh * rad) * Rc;
  return r(Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh)), 4);
}

/** a medição está dentro da versão? (mesma regra do banco) */
export function medicaoOk(m, v) {
  const viscOk = v.viscosidade_alvo == null || n(m.viscosidade) == null || Math.abs(+m.viscosidade - +v.viscosidade_alvo) <= (+v.viscosidade_tol || 0);
  const densOk = v.densidade_alvo == null || n(m.densidade) == null || Math.abs(+m.densidade - +v.densidade_alvo) <= (+v.densidade_tol || 0);
  const deOk = v.delta_e_max == null || n(m.delta_e) == null || +m.delta_e <= +v.delta_e_max;
  const algum = [m.viscosidade, m.densidade, m.delta_e].some(x => n(x) != null);
  return { ok: viscOk && densOk && deOk && algum, viscOk, densOk, deOk, algum };
}

/** indicadores do período (ordens aprovadas no período) */
export function indicadores(ordens = [], pesagens = [], medicoes = [], { de, ate } = {}) {
  const per = (t) => t && ms(t) >= ms(de) && ms(t) <= ms(ate);
  const apr = ordens.filter(o => o.aprovada_em && per(o.aprovada_em));
  const kg = apr.reduce((s, o) => s + +(o.quantidade_real || 0), 0), custo = apr.reduce((s, o) => s + +(o.custo_total || 0), 0);
  const primeira = apr.filter(o => { const M = medicoes.filter(m => m.ordem_id === o.id); return M.length === 1 && M[0].ok; }).length;
  const P = pesagens.filter(p => p.situacao !== 'estornada' && !p.ajuste && p.desvio_pct != null && per(p.criado_em));
  const porCor = {};
  for (const o of apr) { const k = o.cor_id; (porCor[k] ||= { cor_id: k, kg: 0, custo: 0, ordens: 0 }); porCor[k].kg += +(o.quantidade_real || 0); porCor[k].custo += +(o.custo_total || 0); porCor[k].ordens++; }
  return {
    ordens: apr.length, kg: r(kg, 1), custoKg: kg ? r(custo / kg, 2) : null, custo: r(custo, 2),
    primeira: apr.length ? primeira / apr.length : null, comConcessao: apr.filter(o => o.concessao).length,
    desvioMedio: P.length ? r(P.reduce((s, p) => s + Math.abs(+p.desvio_pct), 0) / P.length, 2) : null,
    foraTol: P.length ? P.filter(p => p.fora_tolerancia).length / P.length : null,
    ajustes: pesagens.filter(p => p.ajuste && p.situacao !== 'estornada' && per(p.criado_em)).length,
    abertas: ordens.filter(o => ABERTAS.includes(o.situacao)).length,
    sobraKg: r(apr.reduce((s, o) => s + +(o.retorno_kg || 0), 0), 1),
    porCor: Object.values(porCor).sort((a, b) => b.kg - a.kg),
  };
}

/** alertas para o Decision Center */
export function alertas({ ordens = [], sobras = [], versoes = [], hoje = new Date().toISOString().slice(0, 10), agora = Date.now() }) {
  const out = [];
  const paradas = ordens.filter(o => ABERTAS.includes(o.situacao) && agora - ms(o.atualizado_em || o.criado_em) > 24 * 3600000);
  if (paradas.length) out.push({ nivel: 'warn', k: 'paradas', txt: `${paradas.length} ordem(ns) de tinta paradas há mais de 24 h` });
  const ajuste = ordens.filter(o => o.situacao === 'em_ajuste');
  if (ajuste.length) out.push({ nivel: 'warn', k: 'ajuste', txt: `${ajuste.length} tinta(s) em ajuste de cor ou viscosidade` });
  const venc = sobras.filter(s => s.validade && s.validade < hoje && +s.quantidade > 0);
  if (venc.length) out.push({ nivel: 'neg', k: 'vencidas', txt: `${venc.length} lote(s) de tinta pronta vencido(s) (${r(venc.reduce((s, x) => s + +x.quantidade, 0), 1).toLocaleString('pt-BR')} kg)` });
  const lim = new Date(ms(hoje) + 7 * 86400000).toISOString().slice(0, 10);
  const vai = sobras.filter(s => s.validade && s.validade >= hoje && s.validade <= lim && +s.quantidade > 0);
  if (vai.length) out.push({ nivel: 'warn', k: 'vencendo', txt: `${vai.length} sobra(s) de tinta vencem em 7 dias: use primeiro` });
  const teste = versoes.filter(v => v.situacao === 'em_teste' && agora - ms(v.criado_em) > 15 * 86400000);
  if (teste.length) out.push({ nivel: 'warn', k: 'teste', txt: `${teste.length} receita(s) em teste há mais de 15 dias` });
  return out;
}

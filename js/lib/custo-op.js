// Custo real da OP (melhoria 6.3): resume o retorno de prod_custo_op em custo real, orçado, desvio e margem. Funções puras.
export const CFG_PADRAO = { custo_hora_padrao: 0, ratear_manutencao: true, dias_preco: 90, tolerancia_pct: 10, margem_minima_pct: 15 };
const n = (v) => Number(v || 0);
const soma = (l, k = 'valor') => (l || []).reduce((s, x) => s + n(x[k]), 0);

export function resumir(j, cfg = {}) {
  const c = { ...CFG_PADRAO, ...Object.fromEntries(Object.entries(cfg || {}).filter(([, v]) => v != null)) };
  const o = j.ordem || {}, pr = j.producao || {};
  const material = soma(j.material), tinta = soma(j.tinta), maquina = soma(j.maquina), manutencao = soma(j.manutencao);
  const total = material + tinta + maquina + manutencao;
  const bom = n(pr.bom), refugo = n(pr.refugo);
  const custoKg = bom > 0 ? total / bom : null;
  const orcMat = soma(j.orcado?.material), orcMaq = soma(j.orcado?.maquina), orcTot = orcMat + orcMaq;
  const orcKg = n(o.quantidade) > 0 && orcTot > 0 ? orcTot / n(o.quantidade) : null;
  const desvio = custoKg != null && orcKg ? custoKg / orcKg - 1 : null;
  const preco = j.venda?.preco != null ? n(j.venda.preco) : null;
  const receita = preco != null ? preco * bom : null;
  const margem = receita != null ? receita - total : null;
  const margemPct = receita ? margem / receita : null;
  const alertas = [];
  const semCusto = (j.material || []).filter(x => x.fonte === 'sem custo');
  if (semCusto.length) alertas.push(`${semCusto.length} material(is) sem custo: ${semCusto.slice(0, 3).map(x => x.codigo).join(', ')}`);
  if (!(j.material || []).length) alertas.push('nenhum consumo de material apontado');
  if ((j.maquina || []).some(x => !n(x.custo_hora))) alertas.push('máquina ou setor sem custo-hora');
  if (!j.orcado?.tem_estrutura) alertas.push('produto sem estrutura (sem orçado de material)');
  if (preco == null) alertas.push(`sem venda do produto nos ${j.venda?.dias || c.dias_preco} dias`);
  if (!bom) alertas.push('sem quantidade boa apontada');
  let sit = null;
  if (desvio != null && desvio > c.tolerancia_pct / 100) sit = 'acima';
  if (margemPct != null && margemPct * 100 < c.margem_minima_pct) sit = sit ? 'acima_margem' : 'margem';
  if (!sit && (desvio != null || margemPct != null)) sit = 'ok';
  return {
    id: o.id, numero: o.numero, numero_iniflex: o.numero_iniflex, produto: (o.produto || '').trim(), cliente: o.cliente, status: o.status, quantidade: n(o.quantidade), unidade: o.unidade, referencia: o.referencia,
    bom, refugo, refugoPct: bom + refugo ? refugo / (bom + refugo) : null,
    material, tinta, maquina, manutencao, total, custoKg,
    orcado: { material: orcMat, maquina: orcMaq, total: orcTot, custoKg: orcKg, materialKg: n(o.quantidade) ? orcMat / n(o.quantidade) : null, maquinaKg: n(o.quantidade) ? orcMaq / n(o.quantidade) : null },
    desvio, preco, receita, margem, margemPct, sit, alertas,
    partes: [['Material', material, orcMat], ['Tinta', tinta, null], ['Máquina', maquina, orcMaq], ['Manutenção', manutencao, null]],
  };
}

/** totais da lista: custo e quantidade somados, desvio e margem ponderados */
export function totais(lista) {
  const t = lista.reduce((a, r) => ({ total: a.total + r.total, bom: a.bom + r.bom, refugo: a.refugo + r.refugo,
    receita: a.receita + (r.receita || 0), custoVend: a.custoVend + (r.receita != null ? r.total : 0),
    orc: a.orc + (r.orcado.custoKg != null ? r.orcado.custoKg * r.bom : 0), real: a.real + (r.orcado.custoKg != null ? r.total : 0) }),
    { total: 0, bom: 0, refugo: 0, receita: 0, custoVend: 0, orc: 0, real: 0 });
  return { ...t, ops: lista.length, custoKg: t.bom ? t.total / t.bom : null, desvio: t.orc ? t.real / t.orc - 1 : null,
    margemPct: t.receita ? (t.receita - t.custoVend) / t.receita : null, acima: lista.filter(r => r.sit === 'acima' || r.sit === 'acima_margem').length,
    margemBaixa: lista.filter(r => r.sit === 'margem' || r.sit === 'acima_margem').length };
}
export const SIT = { ok: ['No esperado', 'pago'], acima: ['Custo acima', 'aberto'], margem: ['Margem baixa', 'vencido'], acima_margem: ['Custo e margem', 'vencido'] };

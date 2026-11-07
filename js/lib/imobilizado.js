// Ativo Imobilizado (SQL 084) — regras puras, sem acesso ao banco (testadas em tests/imobilizado.test.js).
// A quota do mês é a mesma do banco (af_calcular): (custo − residual − acumulada) ÷ (vida útil − meses já depreciados) × fração do mês.
// Aqui ela serve para a projeção dos próximos meses, o quadro de movimentação, o CIAP e os créditos de PIS/COFINS.

export const SITUACOES = { em_uso: 'Em uso', ocioso: 'Ocioso', em_manutencao: 'Em manutenção', baixado: 'Baixado' };
export const BAIXAS = { venda: 'Venda', sucata: 'Sucata / descarte', perda: 'Perda, furto ou sinistro', doacao: 'Doação', outro: 'Outro' };
export const CREDITOS = {
  nenhum: 'Sem crédito',
  depreciacao: 'Sobre a depreciação do mês',
  48: 'Em 48 meses (1/48 por mês)',
  imediato: 'Imediato (máquinas da produção)',
};
export const REGRAS_INICIO = {
  mes_seguinte: 'A partir do mês seguinte ao início de uso',
  mes_aquisicao: 'Mês cheio no mês do início de uso',
  pro_rata_dia: 'Proporcional aos dias do mês (pró-rata)',
};
export const ESTADOS = { bom: 'Bom', regular: 'Regular', ruim: 'Ruim', inservivel: 'Inservível' };
export const ALIQ_PIS_COFINS = 0.0925;            // 1,65% + 7,6% (não cumulativo)

const r2 = (v) => Math.round((+v + Number.EPSILON) * 100) / 100;
export const mesDe = (d) => String(d).slice(0, 7);                                   // 'AAAA-MM'
export const somaMes = (m, n) => { const [a, b] = m.split('-').map(Number); const t = a * 12 + (b - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
export const difMeses = (de, ate) => { const [a, b] = de.split('-').map(Number), [c, d] = ate.split('-').map(Number); return (c * 12 + d) - (a * 12 + b); };
const diasNoMes = (m) => { const [a, b] = m.split('-').map(Number); return new Date(Date.UTC(a, b, 0)).getUTCDate(); };
export const fimDoMes = (m) => `${m}-${String(diasNoMes(m)).padStart(2, '0')}`;
export const inicioUso = (b) => b.data_inicio_uso || b.data_aquisicao;

/** fração do mês depreciada pelo bem (0 a 1), pela regra de início */
export function fracao(b, mes, regra = 'mes_seguinte', deprecia = true) {
  if (!deprecia) return 0;
  const ini = inicioUso(b), mIni = mesDe(ini), dias = diasNoMes(mes);
  if (b.baixa_data && mesDe(b.baixa_data) < mes) return 0;
  if (b.data_corte && mesDe(b.data_corte) >= mes) return 0;
  if (regra === 'mes_seguinte' && mes <= mIni) return 0;
  if (mes < mIni) return 0;
  const baixaNoMes = b.baixa_data && mesDe(b.baixa_data) === mes;
  if (baixaNoMes && regra === 'mes_seguinte') return 0;
  if (regra === 'pro_rata_dia') {
    const ate = baixaNoMes ? +b.baixa_data.slice(8, 10) : dias, de = mes === mIni ? +ini.slice(8, 10) : 1;
    return Math.round((ate - de + 1) / dias * 10000) / 10000;
  }
  return 1;
}

/** quota contábil de um mês, a partir do que já foi depreciado (acum e meses usados) */
export function quota(b, acum, usados, fr) {
  const base = +b.valor_aquisicao - (+b.valor_residual || 0), rest = base - acum;
  if (fr <= 0 || rest <= 0) return 0;
  const faltam = +b.vida_util_meses - usados;
  return faltam <= fr ? r2(rest) : Math.max(0, Math.min(rest, r2(rest / faltam * fr)));
}

/** posição de um bem numa data (último mês calculado ≤ data), com as depreciações gravadas */
export function posicao(b, deps = [], ate = '9999-12') {
  const ds = deps.filter(d => d.bem_id === b.id && mesDe(d.competencia) <= ate);
  const acum = r2((+b.deprec_inicial || 0) + ds.reduce((s, d) => s + +d.valor, 0));
  const custo = +b.valor_aquisicao;
  const baixado = b.baixa_data && mesDe(b.baixa_data) <= ate;
  return { custo, acum, vcl: r2(custo - acum), pct: custo ? acum / custo : 0, baixado,
           usados: (+b.meses_iniciais || 0) + ds.reduce((s, d) => s + +d.meses, 0), ultimo: ds.length ? mesDe(ds[ds.length - 1].competencia) : null };
}

/** projeção da depreciação dos próximos meses a partir do último mês calculado (lista mês → valor) */
export function projecao(bens, deps, classes, { de, meses = 12, regra = 'mes_seguinte' }) {
  const kById = Object.fromEntries(classes.map(k => [k.id, k]));
  const out = Array.from({ length: meses }, (_, i) => ({ mes: somaMes(de, i), valor: 0 }));
  for (const b of bens) {
    if (b.situacao === 'baixado') continue;
    const k = kById[b.classe_id]; if (!k) continue;
    const p = posicao(b, deps, somaMes(de, -1)); let acum = p.acum, usados = p.usados;
    for (const o of out) {
      const fr = fracao(b, o.mes, regra, k.deprecia !== false), q = quota(b, acum, usados, fr);
      acum = r2(acum + q); usados += fr; o.valor = r2(o.valor + q);
    }
  }
  return out;
}

/** quadro de movimentação do período por classe (custo e depreciação acumulada: saldo inicial, adições, baixas, saldo final) */
export function movimentacao(bens, deps, classes, { de, ate }) {
  const linhas = classes.map(k => ({ classe_id: k.id, classe: `${k.codigo} ${k.nome}`, custoIni: 0, adicoes: 0, baixasCusto: 0, custoFim: 0, depIni: 0, depMes: 0, depBaixas: 0, depFim: 0 }));
  const lById = Object.fromEntries(linhas.map(l => [l.classe_id, l]));
  const antes = somaMes(de, -1);
  for (const b of bens) {
    const l = lById[b.classe_id]; if (!l) continue;
    const mAq = mesDe(b.data_aquisicao), mBx = b.baixa_data ? mesDe(b.baixa_data) : null;
    const existiaAntes = mAq <= antes && !(mBx && mBx <= antes);
    const custo = +b.valor_aquisicao;
    if (existiaAntes) { l.custoIni += custo; l.depIni += posicao(b, deps, antes).acum; }
    else if (mAq >= de && mAq <= ate && !(mBx && mBx < de)) {
      l.adicoes += custo;
      l.depMes += +b.deprec_inicial || 0;   // bem implantado no período: a acumulada que veio de fora entra no período
    }
    const noPeriodo = deps.filter(d => d.bem_id === b.id && mesDe(d.competencia) >= de && mesDe(d.competencia) <= ate).reduce((s, d) => s + +d.valor, 0);
    l.depMes += noPeriodo;
    if (mBx && mBx >= de && mBx <= ate && (existiaAntes || mAq >= de)) { l.baixasCusto += custo; l.depBaixas += posicao(b, deps, ate).acum; }
  }
  for (const l of linhas) {
    for (const k of ['custoIni', 'adicoes', 'baixasCusto', 'depIni', 'depMes', 'depBaixas']) l[k] = r2(l[k]);
    l.custoFim = r2(l.custoIni + l.adicoes - l.baixasCusto); l.depFim = r2(l.depIni + l.depMes - l.depBaixas);
    l.vclIni = r2(l.custoIni - l.depIni); l.vclFim = r2(l.custoFim - l.depFim);
  }
  return linhas.filter(l => l.custoIni || l.adicoes || l.baixasCusto);
}

/** custo de aquisição sugerido a partir do item da NF-e: tira o ICMS que vai para o CIAP e o PIS/COFINS se houver crédito */
export function custoSugerido(item, classe = {}, { ateCredito = '2026-12-31', data = '' } = {}) {
  const bruto = r2(+item.valor || 0), icms = classe.ciap ? r2(+item.icms || 0) : 0;
  const temPis = (classe.credito_pis_cofins || 'nenhum') !== 'nenhum' && (!data || data <= ateCredito);
  const baseSemIcms = r2(bruto - icms);
  const pis = temPis ? r2(baseSemIcms * ALIQ_PIS_COFINS) : 0;
  return { bruto, icms, pis, custo: r2(bruto - icms - pis), base_pis: temPis ? baseSemIcms : 0 };
}

/** CIAP: 1/48 do ICMS por mês desde o mês de entrada, × fator de saídas tributadas; a baixa antes dos 48 meses encerra (LC 87/1996, art. 20, § 5º) */
export function ciapParcelas(b, { ate, fatores = {} }) {
  const icms = +b.icms_credito || 0; if (icms <= 0) return [];
  const m0 = mesDe(b.data_aquisicao), out = [];
  for (let i = 0; i < 48; i++) {
    const m = somaMes(m0, i); if (m > ate) break;
    if (b.baixa_data && m > mesDe(b.baixa_data)) break;
    const f = fatores[m] == null ? 1 : +fatores[m];
    out.push({ mes: m, parcela: i + 1, cota: r2(icms / 48), fator: f, credito: r2(icms / 48 * f) });
  }
  return out;
}

/** créditos de PIS/COFINS de um bem por mês, pelo método (até o fim do PIS/COFINS) */
export function pisCofinsParcelas(b, metodo, { deps = [], ate, fim = '2026-12' }) {
  const base = b.pis_cofins_base != null ? +b.pis_cofins_base : +b.valor_aquisicao;
  const lim = ate < fim ? ate : fim, m0 = mesDe(b.data_aquisicao), out = [];
  if (!base || metodo === 'nenhum' || !metodo) return out;
  if (metodo === 'imediato') { if (m0 <= lim) out.push({ mes: m0, base, credito: r2(base * ALIQ_PIS_COFINS) }); return out; }
  if (metodo === '48') {
    for (let i = 0; i < 48; i++) { const m = somaMes(m0, i); if (m > lim) break; out.push({ mes: m, base: r2(base / 48), credito: r2(base / 48 * ALIQ_PIS_COFINS) }); }
    return out;
  }
  // sobre os encargos de depreciação do mês (proporção da base no custo)
  const prop = +b.valor_aquisicao ? base / +b.valor_aquisicao : 0;
  for (const d of deps.filter(x => x.bem_id === b.id && mesDe(x.competencia) <= lim)) out.push({ mes: mesDe(d.competencia), base: r2(+d.valor * prop), credito: r2(+d.valor * prop * ALIQ_PIS_COFINS) });
  return out;
}

/** fator do CIAP de um mês: saídas tributadas (e exportações) ÷ total das saídas (itens das NF-e de saída autorizadas) */
export function fatorCiap(itens) {
  let trib = 0, total = 0;
  for (const i of itens) {
    const v = (+i.vprod || 0) - (+i.vdesc || 0); if (v <= 0) continue;
    const cfop = String(i.cfop || '');
    if (/^[56]9\d\d$/.test(cfop)) continue;   // remessas e retornos (5.9xx / 6.9xx) não entram; o fator é só uma sugestão, ajustável na tela
    total += v;
    if (cfop.startsWith('7') || (+i.v_icms || 0) > 0) trib += v;
  }
  return total ? Math.round(trib / total * 10000) / 10000 : 1;
}

/** conteúdo do QR da plaqueta: o endereço da tela de inventário já com o número (o celular abre direto) */
export const qrConteudo = (plaqueta, base = '') => base ? `${base}#/contab/inventario?pat=${encodeURIComponent(plaqueta)}` : plaqueta;
/** lê o que veio do leitor (endereço do QR, plaqueta com ou sem prefixo, só o número) e devolve a plaqueta ou o número */
export function lerCodigo(txt) {
  const s = String(txt || '').trim(); if (!s) return null;
  const m = s.match(/[?&]pat=([^&#]+)/); if (m) return { plaqueta: decodeURIComponent(m[1]).toUpperCase() };
  if (/^\d+$/.test(s)) return { numero: +s };
  return { plaqueta: s.toUpperCase().replace(/\s+/g, '') };
}

/** situação do bem para a lista (rótulo e classe de cor) */
export function selo(b, pos) {
  if (b.situacao === 'baixado') return { txt: 'Baixado', cls: 'muted' };
  if (pos && pos.custo && pos.vcl <= (+b.valor_residual || 0) + 0.005) return { txt: 'Totalmente depreciado', cls: 'warn' };
  return { txt: SITUACOES[b.situacao] || b.situacao, cls: b.situacao === 'em_uso' ? 'pos' : 'warn' };
}

/** alertas para o Decision Center */
export function alertas({ bens = [], classes = [], calculos = [], candidatos = 0, inventarios = [], hoje }) {
  const out = [], mesAnt = somaMes(mesDe(hoje), -1);
  const ativos = bens.filter(b => b.situacao !== 'baixado');
  if (ativos.length && !calculos.some(c => mesDe(c.competencia) === mesAnt)) out.push({ nivel: 'warn', k: 'calculo', txt: `Depreciação de ${mesAnt.split('-').reverse().join('/')} não calculada` });
  const semConta = classes.filter(k => k.deprecia && ativos.some(b => b.classe_id === k.id) && (!k.conta_deprec_id || !k.conta_despesa_id || !k.conta_ativo_id));
  if (semConta.length) out.push({ nivel: 'warn', k: 'contas', txt: `${semConta.length} classe(s) sem conta contábil: ${semConta.map(k => k.codigo).join(', ')}` });
  if (candidatos) out.push({ nivel: 'info', k: 'candidatos', txt: `${candidatos} compra(s), máquina(s) ou veículo(s) a imobilizar` });
  const ult = inventarios.filter(i => i.situacao === 'concluido').map(i => i.data_inicio).sort().pop();
  if (ativos.length && (!ult || difMeses(mesDe(ult), mesDe(hoje)) >= 12)) out.push({ nivel: 'info', k: 'inventario', txt: ult ? `Último inventário físico em ${ult.split('-').reverse().join('/')}` : 'Nenhum inventário físico concluído' });
  return out;
}

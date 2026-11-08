// Índices financeiros (melhoria 9.4): liquidez, endividamento, ciclo de caixa e resultado (EBITDA), com a tendência
// de 12 meses e a leitura em linguagem simples para a Diretoria e o Administrador Judicial. Funções puras.
//
// Cada ponto da série é um balancete (fim de mês da plataforma ou balancete importado da contabilidade):
//   saldos de balanço (posição no fim) e fluxos de resultado (movimento do período do balancete).
// Na plataforma os fluxos de 12 meses somam os meses da janela; no balancete da contabilidade vale o período dele.

/** componentes → classificações do plano contábil (padrão do plano da empresa; ajustável nos Parâmetros) */
export const GRUPOS_PADRAO = {
  ativo: ['1'], ac: ['1.1'], disp: ['1.1.1'], clientes: ['1.1.2'], estoques: ['1.1.5'], rlp: ['1.2.1'],
  pc: ['2.1'], pnc: ['2.2'], pl: ['2.3'], fornec: ['2.1.3'], emprest: ['2.1.1', '2.2.1'],
  rb: ['4.1.1'], ded: ['4.1.2'], cmv: ['5', '3.1'], recfin: ['4.1.3'], despfin: ['3.2.20.5'],
  naoop: ['3.2.20.7', '4.2'], ir: [], deprec: ['1.2.30.7'],
};
export const GRUPOS_ROT = {
  ativo: ['Ativo total', 'balanço'], ac: ['Ativo circulante', 'balanço'], disp: ['Disponível (caixa e bancos)', 'balanço'],
  clientes: ['Clientes a receber', 'balanço'], estoques: ['Estoques', 'balanço'], rlp: ['Realizável a longo prazo', 'balanço'],
  pc: ['Passivo circulante', 'balanço'], pnc: ['Passivo não circulante', 'balanço'], pl: ['Patrimônio líquido', 'balanço'],
  fornec: ['Fornecedores', 'balanço'], emprest: ['Empréstimos e financiamentos', 'balanço'],
  rb: ['Receita bruta', 'resultado'], ded: ['Deduções da receita', 'resultado'], cmv: ['Custo dos produtos vendidos', 'resultado'],
  recfin: ['Receitas financeiras', 'resultado'], despfin: ['Despesas financeiras', 'resultado'],
  naoop: ['Resultado não operacional', 'resultado'], ir: ['IR e CSLL', 'resultado'],
  deprec: ['Depreciação (crédito da conta acumulada)', 'resultado'],
};

export const GRUPOS_IND = [['liq', 'Liquidez'], ['end', 'Endividamento'], ['ciclo', 'Ciclo de caixa'], ['res', 'Resultado']];

// sentido: "maior" = quanto maior, melhor; bom/atencao = faixas padrão (ajustáveis nos Parâmetros)
export const INDICES = [
  { k: 'lc', g: 'liq', nome: 'Liquidez corrente', un: 'x', sentido: 'maior', bom: 1.2, atencao: 1, formula: 'Ativo circulante ÷ Passivo circulante' },
  { k: 'ls', g: 'liq', nome: 'Liquidez seca', un: 'x', sentido: 'maior', bom: 1, atencao: 0.7, formula: '(Ativo circulante − Estoques) ÷ Passivo circulante' },
  { k: 'li', g: 'liq', nome: 'Liquidez imediata', un: 'x', sentido: 'maior', bom: 0.2, atencao: 0.1, formula: 'Disponível ÷ Passivo circulante' },
  { k: 'lg', g: 'liq', nome: 'Liquidez geral', un: 'x', sentido: 'maior', bom: 1, atencao: 0.8, formula: '(Ativo circulante + Realizável a longo prazo) ÷ (Passivo circulante + Passivo não circulante)' },
  { k: 'cgl', g: 'liq', nome: 'Capital de giro líquido', un: 'R$', sentido: 'maior', bom: 0, atencao: null, formula: 'Ativo circulante − Passivo circulante' },
  { k: 'eg', g: 'end', nome: 'Endividamento geral', un: '%', sentido: 'menor', bom: 60, atencao: 80, formula: '(Passivo circulante + Passivo não circulante) ÷ Ativo total' },
  { k: 'ce', g: 'end', nome: 'Dívida de curto prazo', un: '%', sentido: 'menor', bom: 50, atencao: 70, formula: 'Passivo circulante ÷ (Passivo circulante + Passivo não circulante)' },
  { k: 'pt', g: 'end', nome: 'Dívida sobre o patrimônio', un: 'x', sentido: 'menor', bom: 1.5, atencao: 3, formula: '(Passivo circulante + Passivo não circulante) ÷ Patrimônio líquido' },
  { k: 'dl', g: 'end', nome: 'Dívida líquida ÷ EBITDA', un: 'anos', sentido: 'menor', bom: 2.5, atencao: 4, formula: '(Empréstimos e financiamentos − Disponível) ÷ EBITDA de 12 meses' },
  { k: 'cj', g: 'end', nome: 'Cobertura dos juros', un: 'x', sentido: 'maior', bom: 3, atencao: 1.5, formula: 'EBITDA de 12 meses ÷ Despesas financeiras de 12 meses' },
  { k: 'pmr', g: 'ciclo', nome: 'Prazo médio de recebimento', un: 'dias', sentido: 'menor', bom: 60, atencao: 90, formula: 'Clientes a receber ÷ Receita bruta de 12 meses × dias' },
  { k: 'pme', g: 'ciclo', nome: 'Prazo médio de estoque', un: 'dias', sentido: 'menor', bom: 45, atencao: 60, formula: 'Estoques ÷ Custo dos produtos vendidos de 12 meses × dias' },
  { k: 'pmp', g: 'ciclo', nome: 'Prazo médio de pagamento', un: 'dias', sentido: 'maior', bom: 45, atencao: 30, formula: 'Fornecedores ÷ Custo dos produtos vendidos de 12 meses × dias' },
  { k: 'cc', g: 'ciclo', nome: 'Ciclo de caixa', un: 'dias', sentido: 'menor', bom: 45, atencao: 75, formula: 'Prazo de recebimento + Prazo de estoque − Prazo de pagamento' },
  { k: 'ebitda', g: 'res', nome: 'EBITDA de 12 meses', un: 'R$', sentido: 'maior', bom: 0, atencao: null, formula: 'Resultado + Despesas financeiras − Receitas financeiras + Resultado não operacional + IR e CSLL + Depreciação' },
  { k: 'me', g: 'res', nome: 'Margem EBITDA', un: '%', sentido: 'maior', bom: 10, atencao: 5, formula: 'EBITDA de 12 meses ÷ Receita líquida de 12 meses' },
  { k: 'ml', g: 'res', nome: 'Margem líquida', un: '%', sentido: 'maior', bom: 5, atencao: 0, formula: 'Resultado de 12 meses ÷ Receita líquida de 12 meses' },
];
export const IDX = Object.fromEntries(INDICES.map(i => [i.k, i]));

/** grupos efetivos: padrão + o que a empresa ajustou (lista vazia ajustada vale: o componente fica zerado) */
export function grupos(cfg = {}) {
  const g = { ...GRUPOS_PADRAO };
  for (const [k, v] of Object.entries(cfg || {})) if (k in g && Array.isArray(v)) g[k] = v.map(s => String(s).trim()).filter(Boolean);
  return g;
}
/** faixas efetivas por índice */
export function faixas(cfg = {}) {
  const f = {};
  for (const i of INDICES) {
    const c = (cfg || {})[i.k] || {};
    const n = (x, d) => (x === '' || x == null || !isFinite(+x) ? d : +x);
    f[i.k] = { bom: n(c.bom, i.bom), atencao: i.atencao == null && c.atencao == null ? null : n(c.atencao, i.atencao) };
  }
  return f;
}

/** situação pela faixa: ok, atencao, abaixo; null sem valor */
export function situacao(v, ind, fx) {
  if (v == null || !isFinite(v)) return null;
  const { bom, atencao } = fx || ind;
  if (ind.sentido === 'menor') return v <= bom ? 'ok' : atencao != null && v <= atencao ? 'atencao' : 'abaixo';
  return v >= bom ? 'ok' : atencao != null && v >= atencao ? 'atencao' : 'abaixo';
}

/**
 * Componentes de um balancete. acc = { atu(cls), mov(cls) = débito − crédito do período, cred(cls) } com sinal devedor +.
 * resAcum: resultado ainda não encerrado (contas 3, 4 e 5), que entra no patrimônio líquido como no Balanço.
 */
export function extrair(acc, G) {
  const S = (k, f) => (G[k] || []).reduce((s, c) => s + (+f(c) || 0), 0);
  const deb = (k) => S(k, acc.atu), cre = (k) => -S(k, acc.atu), mov = (k) => S(k, acc.mov);
  const resAcum = -(acc.atu('3') + acc.atu('4') + acc.atu('5'));
  const lucro = -(acc.mov('3') + acc.mov('4') + acc.mov('5'));
  const rb = -mov('rb'), ded = -mov('ded');
  const despfin = mov('despfin'), recfin = -mov('recfin'), naoop = mov('naoop'), ir = mov('ir');
  const deprec = S('deprec', acc.cred);
  return {
    ativo: deb('ativo'), ac: deb('ac'), disp: deb('disp'), clientes: deb('clientes'), estoques: deb('estoques'), rlp: deb('rlp'),
    pc: cre('pc'), pnc: cre('pnc'), pl: cre('pl') + resAcum, fornec: cre('fornec'), emprest: cre('emprest'),
    rb, ded, rl: rb + ded, cmv: mov('cmv'), recfin, despfin, naoop, ir, deprec, lucro,
    ebitda: lucro + despfin - recfin + naoop + ir + deprec,
  };
}

const FLUXOS = ['rb', 'ded', 'rl', 'cmv', 'recfin', 'despfin', 'naoop', 'ir', 'deprec', 'lucro', 'ebitda'];
const dv = (a, b) => (b && isFinite(a / b) ? a / b : null);
const r2 = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const diasEntre = (ini, fim) => Math.round((new Date(fim + 'T12:00:00') - new Date(ini + 'T12:00:00')) / 864e5) + 1;

/** fluxos de 12 meses do ponto i: na janela "acumular" soma os pontos dos últimos 365 dias; senão, o período do próprio */
export function fluxo12(pontos, i, janela = 'acumular') {
  const p = pontos[i];
  const sel = janela === 'acumular' ? pontos.slice(0, i + 1).filter(x => diasEntre(x.fim, p.fim) <= 366).slice(-12) : [p];
  const f = Object.fromEntries(FLUXOS.map(k => [k, sel.reduce((s, x) => s + (x.v[k] || 0), 0)]));
  f.dias = sel.reduce((s, x) => s + x.dias, 0); f.n = sel.length;
  return f;
}

/** índices de um ponto; avisos explicam quando um índice não pode ser calculado */
export function indicesDe(v, f) {
  const fat = f.dias ? 360 / f.dias : 1;                   // anualiza quando há menos de 12 meses
  const ano = (x) => x * fat;
  const ebitda12 = ano(f.ebitda), divida = v.pc + v.pnc;
  const pmr = dv(v.clientes, f.rb / f.dias), pme = dv(v.estoques, f.cmv / f.dias), pmp = dv(v.fornec, f.cmv / f.dias);
  const avisos = {};
  if (v.pl <= 0) avisos.pt = 'patrimônio líquido negativo (passivo a descoberto)';
  if (ebitda12 <= 0) avisos.dl = 'EBITDA de 12 meses negativo ou zero';
  if (!(f.despfin > 0)) avisos.cj = 'sem despesas financeiras no período';
  if (f.n && f.n < 12 && f.dias < 330) avisos._parcial = `fluxos de ${f.n} ${f.n === 1 ? 'mês' : 'meses'}, anualizados`;
  const x = {
    lc: dv(v.ac, v.pc), ls: dv(v.ac - v.estoques, v.pc), li: dv(v.disp, v.pc), lg: dv(v.ac + v.rlp, divida), cgl: v.ac - v.pc,
    eg: dv(divida, v.ativo) == null ? null : dv(divida, v.ativo) * 100, ce: dv(v.pc, divida) == null ? null : dv(v.pc, divida) * 100,
    pt: v.pl > 0 ? dv(divida, v.pl) : null, dl: ebitda12 > 0 ? (v.emprest - v.disp) / ebitda12 : null,
    cj: f.despfin > 0 ? f.ebitda / f.despfin : null,
    pmr, pme, pmp, cc: pmr == null || pme == null || pmp == null ? null : pmr + pme - pmp,
    ebitda: ebitda12, me: dv(f.ebitda, f.rl) == null ? null : dv(f.ebitda, f.rl) * 100, ml: dv(f.lucro, f.rl) == null ? null : dv(f.lucro, f.rl) * 100,
  };
  for (const k of Object.keys(x)) x[k] = x[k] == null || !isFinite(x[k]) ? null : r2(x[k], IDX[k].un === 'R$' ? 2 : 4);
  return { x, avisos, ebitda12, rl12: ano(f.rl), lucro12: ano(f.lucro), despfin12: ano(f.despfin) };
}

/** tendência de 12 pontos: compara a média dos 3 últimos com a dos 3 anteriores (±3% = estável) */
export function tendencia(serie, sentido) {
  const s = serie.filter(v => v != null);
  const u = s.slice(-3), a = s.slice(-6, -3);
  if (u.length < 2 || a.length < 2) return { k: 'sem', txt: 'sem histórico' };
  const m = (l) => l.reduce((t, v) => t + v, 0) / l.length;
  const A = m(u), B = m(a), d = B === 0 ? (A === 0 ? 0 : Math.sign(A)) : (A - B) / Math.abs(B);
  if (Math.abs(d) < 0.03) return { k: 'estavel', txt: 'estável', d };
  const sobe = d > 0, bom = sentido === 'menor' ? !sobe : sobe;
  return { k: bom ? 'melhora' : 'piora', txt: `${bom ? 'melhorando' : 'piorando'} (${sobe ? '+' : '−'}${Math.min(999, Math.abs(Math.round(d * 100)))}% em 3 meses)`, d };
}

/**
 * Série completa: pontos em ordem crescente [{ ref, ini, fim, dias, v }]; devolve os últimos `meses` pontos com os índices,
 * a situação e, por índice, a série, a tendência e as comparações com o ponto anterior e com o de 12 meses antes.
 */
export function montar(pontos, { meses = 12, janela = 'acumular', faixasCfg = {}, ocultos = [] } = {}) {
  const fx = faixas(faixasCfg);
  const calc = pontos.map((p, i) => { const f = fluxo12(pontos, i, janela); return { ...p, f, ...indicesDe(p.v, f) }; });
  const vis = calc.slice(-meses);
  const ult = vis[vis.length - 1];
  const inds = INDICES.filter(i => !ocultos.includes(i.k)).map(i => {
    const serie = vis.map(p => p.x[i.k]);
    const valor = ult ? ult.x[i.k] : null;
    const ant = vis.length > 1 ? vis[vis.length - 2].x[i.k] : null;
    const a12 = calc.length > 12 ? calc[calc.length - 13].x[i.k] : null;
    return { ...i, faixa: fx[i.k], valor, ant, a12, serie, sit: situacao(valor, i, fx[i.k]), tend: tendencia(serie, i.sentido), aviso: ult?.avisos[i.k] || null };
  });
  return { pontos: vis, todos: calc, ult, inds, fx };
}

// ---------- texto ----------
const nf = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
export function fmt(v, un) {
  if (v == null) return '—';
  if (un === 'R$') return 'R$ ' + nf(v, 0);
  if (un === '%') return nf(v, 1) + '%';
  if (un === 'dias') return nf(v, 0) + ' dias';
  if (un === 'anos') return nf(v, 1) + (Math.abs(v) >= 0.95 && Math.abs(v) < 1.05 ? ' ano' : ' anos');
  return nf(v, 2);
}
export const fmtFaixa = (i, fx) => {
  const s = i.sentido === 'menor' ? '≤' : '≥';
  return fx.atencao == null ? `${s} ${fmt(fx.bom, i.un)}` : `bom ${s} ${fmt(fx.bom, i.un)} · atenção ${s} ${fmt(fx.atencao, i.un)}`;
};
export const SIT = { ok: 'Confortável', atencao: 'Atenção', abaixo: 'Crítico' };
const real = (v) => 'R$ ' + nf(v, 2);
const rs = (v) => 'R$ ' + nf(Math.abs(v), 0);

/** leitura em linguagem simples (para a Diretoria e o Administrador Judicial) */
export function leitura(i, ctx = {}) {
  const v = i.valor, c = ctx.v || {}, a = i.aviso;
  if (v == null) {
    if (i.k === 'pt' && a) return `O patrimônio líquido está negativo em ${rs(c.pl || 0)}: as dívidas somadas superam todos os bens e direitos da empresa (passivo a descoberto). Por isso a relação entre dívida e patrimônio não se aplica.`;
    if (i.k === 'dl' && a) return 'A operação não gerou caixa nos últimos 12 meses (EBITDA negativo ou zero); por isso não é possível medir em quantos anos a dívida seria paga com a geração operacional.';
    if (i.k === 'cj' && a) return 'Não houve despesas financeiras no período; o índice não se aplica.';
    return 'Sem dados suficientes no balancete para calcular este índice.';
  }
  switch (i.k) {
    case 'lc': return `Para cada R$ 1,00 de obrigações que vencem em até 12 meses, a empresa tem ${real(v)} em caixa, clientes a receber, estoques e outros créditos de curto prazo.`;
    case 'ls': return `Sem contar os estoques (que ainda precisam ser vendidos), há ${real(v)} para cada R$ 1,00 de obrigação de curto prazo.`;
    case 'li': return `O dinheiro em caixa e bancos pagaria hoje ${nf(v * 100, 0)}% das obrigações que vencem em até 12 meses.`;
    case 'lg': return `Somando tudo o que a empresa tem a receber e a realizar, no curto e no longo prazo, há ${real(v)} para cada R$ 1,00 de dívida total.`;
    case 'cgl': return v >= 0 ? `Os recursos de curto prazo superam as obrigações de curto prazo em ${rs(v)} (capital de giro positivo).` : `Faltam ${rs(v)} de recursos de curto prazo para cobrir as obrigações que vencem em até 12 meses (capital de giro negativo).`;
    case 'eg': return `${nf(v, 0)}% dos bens e direitos da empresa estão financiados por terceiros: fornecedores, bancos, tributos, empregados e credores da recuperação judicial.${v > 100 ? ' Acima de 100%, as dívidas superam o ativo.' : ''}`;
    case 'ce': return `${nf(v, 0)}% das dívidas vencem em até 12 meses; o restante é de longo prazo.`;
    case 'pt': return `Para cada R$ 1,00 do patrimônio dos sócios, há ${real(v)} de dívidas com terceiros.`;
    case 'dl': return v <= 0 ? 'O caixa disponível é maior que a dívida com bancos e financiamentos (dívida líquida zero ou negativa).' : `A dívida com bancos e financiamentos, descontado o caixa, equivale a ${fmt(v, 'anos')} da geração de caixa operacional (EBITDA).`;
    case 'cj': return `A geração operacional dos últimos 12 meses cobre ${nf(v, 1)} vezes as despesas financeiras (juros, encargos e deságio do FIDC).`;
    case 'pmr': return `A empresa leva, em média, ${nf(v, 0)} dias para receber das vendas a prazo. Títulos cedidos ao FIDC saem da carteira e reduzem este prazo.`;
    case 'pme': return `Os estoques cobrem, em média, ${nf(v, 0)} dias do custo dos produtos vendidos.`;
    case 'pmp': return `A empresa paga os fornecedores, em média, em ${nf(v, 0)} dias.`;
    case 'cc': return v > 0 ? `Entre pagar os fornecedores e receber dos clientes passam ${nf(v, 0)} dias, que precisam ser financiados com caixa próprio, antecipação de recebíveis ou empréstimos.` : `Os fornecedores financiam a operação: a empresa recebe dos clientes ${nf(-v, 0)} dias antes de pagar os fornecedores.`;
    case 'ebitda': return v >= 0 ? `Nos últimos 12 meses a operação gerou ${rs(v)} antes de juros, impostos sobre o lucro e depreciação.` : `Nos últimos 12 meses a operação consumiu ${rs(v)} antes de juros, impostos sobre o lucro e depreciação.`;
    case 'me': return v >= 0 ? `De cada R$ 100,00 de receita líquida, sobram R$ ${nf(v, 2)} da operação (EBITDA).` : `De cada R$ 100,00 de receita líquida, a operação perde R$ ${nf(-v, 2)} (EBITDA negativo).`;
    case 'ml': return v >= 0 ? `Depois de todos os custos, despesas e juros, sobram R$ ${nf(v, 2)} de lucro para cada R$ 100,00 de receita líquida.` : `Depois de todos os custos, despesas e juros, há prejuízo de R$ ${nf(-v, 2)} para cada R$ 100,00 de receita líquida.`;
    default: return '';
  }
}
export function fraseSit(i) {
  const t = i.tend && i.tend.k !== 'sem' ? ` Tendência: ${i.tend.txt}.` : '';
  if (!i.sit) return t.trim();
  return ({ ok: 'Dentro da faixa confortável definida pela empresa.', atencao: 'Ponto de atenção: entre a faixa confortável e a mínima.', abaixo: 'Abaixo da faixa mínima definida pela empresa.' })[i.sit] + t;
}

/** resumo para o Objeto do relatório e a faixa da tela */
export function resumo(inds) {
  const n = (s) => inds.filter(i => i.sit === s).length;
  return { ok: n('ok'), atencao: n('atencao'), abaixo: n('abaixo'), criticos: inds.filter(i => i.sit === 'abaixo').map(i => i.nome) };
}

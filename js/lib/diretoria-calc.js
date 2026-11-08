// Painel da Diretoria (melhoria 2.4, 07/11/2026): definição dos indicadores, situação contra a meta, tendência e montagem
// das séries de 13 meses. Puro (sem banco). Testes: tests/diretoria.test.js.

export const INDICADORES = [
  { k: 'caixa', nome: 'Caixa disponível', un: 'R$', sentido: 'maior', rota: 'necessidade-caixa', area: 'Financeiro',
    regra: 'Saldo das contas disponíveis no fim do mês (contas de bloqueio judicial fora, ou as escolhidas nos Parâmetros). Meta = caixa mínimo.' },
  { k: 'faturamento', nome: 'Faturamento líquido', un: 'R$', sentido: 'maior', rota: 'notas', area: 'Comercial',
    regra: 'Vendas das NF-e autorizadas (CFOP de venda) menos as devoluções de clientes, com IPI e ST. Notas canceladas ficam fora.' },
  { k: 'margem', nome: 'Margem EBITDA', un: '%', sentido: 'maior', rota: 'dre', area: 'Financeiro',
    regra: 'EBITDA gerencial ÷ receita bruta da DRE Gerencial do mês (regime de caixa: lançamentos pagos).' },
  { k: 'producao', nome: 'Produção', un: 'kg', sentido: 'maior', rota: 'producao', area: 'Produção',
    regra: 'Quantidade boa apontada no mês (setores escolhidos nos Parâmetros; sem escolha, todos).' },
  { k: 'perdas', nome: 'Perdas (apara e refugo)', un: '%', sentido: 'menor', rota: 'producao', area: 'Produção',
    regra: 'Refugo ÷ (bom + refugo) dos apontamentos do mês.' },
  { k: 'qualidade', nome: 'Reclamações de clientes', un: 'n', sentido: 'menor', rota: 'qualidade/nao-conformidades', area: 'Qualidade',
    regra: 'Não conformidades de origem "reclamação de cliente" abertas no mês (canceladas fora).' },
  { k: 'entregas', nome: 'Entregas no prazo', un: '%', sentido: 'maior', rota: 'logistica/indicadores', area: 'Logística',
    regra: 'Notas entregues em até N dias da emissão (prazo dos Parâmetros da logística) ÷ notas entregues com data, pela data da carga.' },
  { k: 'rj', nome: 'Recuperação judicial', un: 'R$', sentido: 'maior', rota: 'fluxo-mensal', area: 'Financeiro',
    regra: 'Pagamentos do mês nas contas do plano da RJ escolhidas nos Parâmetros. Meta = valor mensal previsto no plano de recuperação.' },
];
export const IND = Object.fromEntries(INDICADORES.map(i => [i.k, i]));
export const SIT = { ok: { txt: 'Na meta', cls: 'pago', cor: 'var(--pos)' }, atencao: { txt: 'Atenção', cls: 'aberto', cor: 'var(--warn)' }, abaixo: { txt: 'Fora da meta', cls: 'vencido', cor: 'var(--neg)' } };

const div = (a, b) => (b ? a / b : null);
const num = (v) => (v == null || v === '' || !isFinite(+v) ? null : +v);

/** situação contra a meta: ok, atencao (até a tolerância), abaixo; null sem meta ou sem valor */
export function situacao(valor, meta, sentido = 'maior', tolPct = 10) {
  const v = num(valor), m = num(meta);
  if (v == null || m == null) return null;
  const tol = Math.abs(m) * (+tolPct || 0) / 100;
  if (sentido === 'menor') return v <= m ? 'ok' : v <= m + tol ? 'atencao' : 'abaixo';
  return v >= m ? 'ok' : v >= m - tol ? 'atencao' : 'abaixo';
}

/** tendência: média dos 3 últimos meses contra os 3 anteriores (±3% = estável); "melhorando" segue o sentido do indicador */
export function tendencia(serie, sentido = 'maior') {
  const s = (serie || []).map(num);
  const ult = s.slice(-3).filter(x => x != null), ant = s.slice(-6, -3).filter(x => x != null);
  if (ult.length < 2 || ant.length < 2) return { k: 'sem', txt: 'sem histórico' };
  const a = ult.reduce((t, x) => t + x, 0) / ult.length, b = ant.reduce((t, x) => t + x, 0) / ant.length;
  const d = b === 0 ? (a === 0 ? 0 : Math.sign(a)) : (a - b) / Math.abs(b);
  if (Math.abs(d) < 0.03) return { k: 'estavel', txt: 'estável', d };
  const sobe = d > 0, bom = sentido === 'menor' ? !sobe : sobe;
  return { k: bom ? 'melhora' : 'piora', txt: `${sobe ? 'subindo' : 'caindo'} ${Math.abs(Math.round(d * 100))}% (3 meses)`, d };
}

/** variação percentual de a sobre b (null quando não dá para comparar) */
export const variacao = (a, b) => { const x = num(a), y = num(b); return x == null || y == null || y === 0 ? null : (x - y) / Math.abs(y); };

/** 13 meses ('YYYY-MM') terminando no mês de referência */
export function meses13(ref) {
  const [a, m] = ref.split('-').map(Number);
  return Array.from({ length: 13 }, (_, i) => { const d = new Date(Date.UTC(a, m - 1 - 12 + i, 1)); return d.toISOString().slice(0, 7); });
}

/** série de 13 meses a partir de vetores anuais (12 posições) por ano: porAno = { 2025: [...], 2026: [...] } */
export const serieAnual = (meses, porAno) => meses.map(ym => { const v = porAno[+ym.slice(0, 4)]; return v ? num(v[+ym.slice(5) - 1]) : null; });

/**
 * saldo de fim de mês reconstituído: saldo de hoje menos o movimento pago dos meses seguintes até o mês atual.
 * geracao = movimento (entradas − saídas) por mês, mesma ordem de `meses`; posteriores = movimento depois do último mês da série.
 */
export function saldosFimMes(saldoHoje, geracao, posteriores = 0) {
  const out = new Array(geracao.length); let s = +saldoHoje - (+posteriores || 0);
  for (let i = geracao.length - 1; i >= 0; i--) { out[i] = Math.round(s * 100) / 100; s -= +geracao[i] || 0; }
  return out;
}

/**
 * monta os indicadores do mês de referência (último da série).
 * fin = { caixa:[13], receita:[13], ebitda:[13] }; op = resposta de diretoria_operacional; metas = { k: { ano: meta } };
 * cfg = diretoria_config; ocultos saem da lista.
 */
export function montarIndicadores({ meses, fin = {}, op = {}, metas = {}, cfg = {}, comentarios = {} }) {
  const a = (k) => (op[k] || []).map(num);
  const venda = a('fat_venda'), dev = a('fat_devolucao'), boa = a('prod_boa'), ref = a('prod_refugo'), med = a('ent_medidas'), noPrazo = a('ent_no_prazo');
  const series = {
    caixa: (fin.caixa || []).map(num),
    faturamento: meses.map((_, i) => venda[i] == null && dev[i] == null ? null : (venda[i] || 0) - (dev[i] || 0)),
    margem: meses.map((_, i) => { const r = num(fin.receita?.[i]), e = num(fin.ebitda?.[i]); return r ? Math.round(e / r * 1000) / 10 : null; }),
    producao: boa,
    perdas: meses.map((_, i) => { const t = (boa[i] || 0) + (ref[i] || 0); return t ? Math.round(ref[i] / t * 1000) / 10 : null; }),
    qualidade: a('rnc_cliente'),
    entregas: meses.map((_, i) => med[i] ? Math.round(noPrazo[i] / med[i] * 1000) / 10 : null),
    rj: a('rj_pago'),
  };
  const ult = meses.length - 1, ano = +meses[ult].slice(0, 4), tol = cfg.tolerancia_pct ?? 10;
  const metaDe = (k, ym) => {
    const m = metas[k]?.[+ym.slice(0, 4)];
    if (m != null) return +m;
    if (k === 'rj' && +cfg.rj_previsto) return cfg.rj_inicio && ym < String(cfg.rj_inicio).slice(0, 7) ? null : +cfg.rj_previsto;
    if (k === 'entregas' && op.meta_prazo_logistica != null) return +op.meta_prazo_logistica;
    return null;
  };
  const sub = {
    caixa: () => `movimento do mês ${fmt(series.caixa[ult] - (series.caixa[ult - 1] ?? series.caixa[ult]), 'R$', true)}`,
    faturamento: () => `vendas ${fmt(venda[ult], 'R$')} · devoluções ${fmt(dev[ult], 'R$')}`,
    margem: () => `EBITDA ${fmt(fin.ebitda?.[ult], 'R$')} sobre receita de ${fmt(fin.receita?.[ult], 'R$')}`,
    producao: () => `${fmt(ref[ult], 'kg')} de refugo no mês`,
    perdas: () => `${fmt(ref[ult], 'kg')} de refugo em ${fmt((boa[ult] || 0) + (ref[ult] || 0), 'kg')}`,
    qualidade: () => `${op.rnc_mes?.[ult] ?? 0} RNC abertas no mês · ${op.rnc_em_aberto?.[ult] ?? 0} em aberto · custo ${fmt(op.rnc_custo?.[ult], 'R$')}`,
    entregas: () => `${op.ent_entregues?.[ult] ?? 0} entregas · ${op.ent_problemas?.[ult] ?? 0} devolvidas ou não entregues · prazo ${op.prazo_entrega_dias ?? 3} dias`,
    rj: () => { const acum = meses.reduce((t, ym, i) => t + (ym.startsWith(String(ano)) ? series.rj[i] || 0 : 0), 0),
      prev = meses.reduce((t, ym) => t + (ym.startsWith(String(ano)) ? metaDe('rj', ym) || 0 : 0), 0); return `acumulado em ${ano}: ${fmt(acum, 'R$')}${prev ? ` de ${fmt(prev, 'R$')} (${Math.round(acum / prev * 100)}%)` : ''}`; },
  };
  return INDICADORES.filter(d => !(cfg.ocultos || []).includes(d.k)).map(d => {
    const s = series[d.k] || [], v = s[ult] ?? null, meta = metaDe(d.k, meses[ult]);
    const anoAnt = meses.length >= 13 ? s[ult - 12] ?? null : null;
    return { ...d, serie: s, metas: meses.map(ym => metaDe(d.k, ym)), valor: v, meta, sit: situacao(v, meta, d.sentido, tol),
      ant: s[ult - 1] ?? null, anoAnt, varMes: variacao(v, s[ult - 1]), varAno: variacao(v, anoAnt), tend: tendencia(s, d.sentido),
      sub: sub[d.k](), comentario: comentarios[d.k] || null };
  });
}

/** formatação compacta: R$ 1,2 mi · 85,3% · 12.300 kg · 4 */
export function fmt(v, un, sinal = false) {
  const x = num(v); if (x == null) return '—';
  const s = sinal && x > 0 ? '+' : '';
  if (un === 'R$') { const a = Math.abs(x);
    const t = a >= 1e6 ? `${(x / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : a >= 1e4 ? `${(x / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${s}R$ ${t}`; }
  if (un === '%') return `${s}${x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (un === 'kg') return `${s}${Math.round(x).toLocaleString('pt-BR')} kg`;
  return `${s}${Math.round(x).toLocaleString('pt-BR')}`;
}
export const fmtVar = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

/** parágrafo de análise do indicador para o PDF da reunião */
export function analise(i, nomeMes) {
  const partes = [`<b>${i.nome}</b>: ${fmt(i.valor, i.un)} em ${nomeMes}`];
  if (i.meta != null) partes.push(`${i.sit === 'ok' ? 'dentro' : i.sit === 'atencao' ? 'perto' : 'fora'} da meta de ${fmt(i.meta, i.un)}`);
  else partes.push('sem meta definida');
  const comp = [];
  if (i.varMes != null) comp.push(`${fmtVar(i.varMes)} sobre o mês anterior`);
  if (i.varAno != null) comp.push(`${fmtVar(i.varAno)} sobre o mesmo mês do ano anterior`);
  let t = partes.join(', ') + (comp.length ? `; ${comp.join(' e ')}` : '') + `. Tendência: ${i.tend.txt}. ${i.sub.charAt(0).toUpperCase() + i.sub.slice(1)}.`;
  if (i.comentario) t += ` <i>Comentário do responsável: ${String(i.comentario).replace(/</g, '&lt;')}</i>`;
  return t;
}

/** itens sugeridos para a deliberação: um plano de ação por indicador fora da meta */
export const itensDeliberacao = (inds) => inds.filter(i => i.sit === 'abaixo').map(i => `Aprovar plano de ação para ${i.nome.toLowerCase()} (${fmt(i.valor, i.un)} contra a meta de ${fmt(i.meta, i.un)}), com responsável e prazo.`);

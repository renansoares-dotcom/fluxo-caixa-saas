// Retenções no frete pago a transportador autônomo PESSOA FÍSICA (SQL 159) — regras puras, para a tela, a função "efrete" e os testes.
// CÓPIA IDÊNTICA em supabase/functions/efrete/retencoes.js (a função do servidor só enxerga a própria pasta): mudou aqui, copie lá.
// O teste tests/frete-retencoes.test.js falha se as duas cópias diferirem.
//
// Regras (parâmetros em log_retencao_param, por vigência — nada fixo: o que está em PARAM_PADRAO é só o valor inicial):
//  - INSS do contribuinte individual: 11% sobre 20% do frete bruto, limitado ao teto do salário de contribuição no mês.
//  - SEST/SENAT: 2,5% sobre a mesma base de 20% do frete.
//  - IRRF: tabela progressiva mensal sobre 10% do frete, menos o INSS e os dependentes (ou o desconto simplificado, se maior),
//    com a redução mensal da Lei 15.270/2025. Retenção de até R$ 10,00 é dispensada.
//  - INSS e IRRF são do MÊS: os fretes anteriores do mesmo autônomo no mês entram na conta e o frete atual paga a diferença.
//  - Pessoa jurídica (CNPJ), inclusive autônomo equiparado e cooperativa: sem estas retenções.

const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const dig = (s) => String(s ?? '').replace(/\D/g, '');

/** valores iniciais (2026), a confirmar com a contabilidade — a tela grava por vigência em log_retencao_param */
export const PARAM_PADRAO = {
  vigencia: '2026-01-01',
  inss_pct: 11, inss_base_pct: 20, inss_teto: 8475.55,
  sest_senat_pct: 2.5, sest_senat_teto: true,
  irrf_base_pct: 10, irrf_dependente: 189.59, irrf_simplificado: 607.20, irrf_minimo: 10,
  irrf_faixas: [{ ate: 2428.80, aliq: 0, deduzir: 0 }, { ate: 2826.65, aliq: 7.5, deduzir: 182.16 }, { ate: 3751.05, aliq: 15, deduzir: 394.16 },
    { ate: 4664.68, aliq: 22.5, deduzir: 675.49 }, { ate: null, aliq: 27.5, deduzir: 908.73 }],
  irrf_reducao: { isento_ate: 5000, valor_max: 312.89, limite: 7350, a: 978.62, b: 0.133145 },
};

/** parâmetro vigente na data: a vigência mais recente que não passa da data (sem data: a mais recente) */
export function paramVigente(params, data) {
  return (params || []).filter(p => !data || String(p.vigencia) <= String(data)).sort((a, b) => String(b.vigencia).localeCompare(String(a.vigencia)))[0] || null;
}

/** estas retenções só existem quando o contratado é pessoa física (CPF) */
export const retemNaFonte = (t) => dig(t?.documento).length === 11;

/** imposto pela tabela progressiva mensal */
export function irTabela(base, faixas) {
  const b = +base || 0; if (b <= 0) return 0;
  const f = (faixas || []).find(x => x.ate == null || b <= +x.ate) || {};
  return Math.max(0, r2(b * (+f.aliq || 0) / 100 - (+f.deduzir || 0)));
}
/** redução mensal da Lei 15.270/2025, calculada sobre o rendimento tributável do mês e limitada ao imposto */
export function irReducao(rendimento, imposto, red) {
  if (!red || !(imposto > 0)) return 0;
  const r = +rendimento || 0;
  if (r <= +red.isento_ate) return r2(Math.min(+red.valor_max || imposto, imposto));
  if (r <= +red.limite) return r2(Math.min(Math.max((+red.a || 0) - (+red.b || 0) * r, 0), imposto));
  return 0;
}

/**
 * Retenções de um frete.
 * @param x {valor, transp:{documento, dependentes}, anteriores:[{valor, inss, sest_senat, irrf}]} — anteriores: outros fretes do mesmo
 *   autônomo no mesmo mês (não cancelados), com o que já foi retido em cada um.
 * @param P parâmetro vigente (log_retencao_param)
 * @returns {aplica, motivo, inss, sest_senat, irrf, total, liquido, base_inss, base_irrf, memoria, vigencia}
 */
export function calcRetencoes(x, P) {
  const valor = r2(x?.valor);
  const zero = (motivo) => ({ aplica: false, motivo, inss: 0, sest_senat: 0, irrf: 0, total: 0, liquido: valor, base_inss: 0, base_irrf: 0, memoria: null, vigencia: P?.vigencia || null });
  if (!retemNaFonte(x?.transp)) return zero('Contratado com CNPJ: sem retenção de INSS, SEST/SENAT e IRRF na fonte.');
  if (!(valor > 0)) return zero('Informe o valor do frete.');
  if (!P) return zero('Sem parâmetros de retenção vigentes na data do frete (Frota e parâmetros › e-frete).');
  const ant = (x.anteriores || []).filter(a => +a.valor > 0);
  const soma = (k) => r2(ant.reduce((s, a) => s + (+a[k] || 0), 0));
  const freteMes = r2(soma('valor') + valor), teto = +P.inss_teto || Infinity;

  // INSS: base do mês = 20% do frete do mês, limitada ao teto; o frete atual paga o que falta
  const baseMes = r2(freteMes * (+P.inss_base_pct || 0) / 100), baseMesLim = Math.min(baseMes, teto);
  const inssMes = r2(baseMesLim * (+P.inss_pct || 0) / 100);
  const inss = Math.max(0, r2(inssMes - soma('inss')));
  const baseInss = r2(valor * (+P.inss_base_pct || 0) / 100);

  // SEST/SENAT: mesma base; com o teto ligado, acompanha a base limitada do mês
  const sestMes = r2((P.sest_senat_teto === false ? baseMes : baseMesLim) * (+P.sest_senat_pct || 0) / 100);
  const sest = Math.max(0, r2(sestMes - soma('sest_senat')));

  // IRRF: rendimento tributável do mês = 10% do frete do mês
  const rendMes = r2(freteMes * (+P.irrf_base_pct || 0) / 100);
  const dedLegal = r2(inssMes + (Math.max(0, Math.trunc(+x.transp?.dependentes || 0)) * (+P.irrf_dependente || 0)));
  const ded = Math.max(dedLegal, +P.irrf_simplificado || 0), simplificado = (+P.irrf_simplificado || 0) > dedLegal;
  const baseIr = Math.max(0, r2(rendMes - ded));
  const tabela = irTabela(baseIr, P.irrf_faixas), reducao = irReducao(rendMes, tabela, P.irrf_reducao);
  let irMes = Math.max(0, r2(tabela - reducao));
  if (irMes <= (+P.irrf_minimo || 0)) irMes = 0;
  const irrf = Math.max(0, r2(irMes - soma('irrf')));

  const total = r2(inss + sest + irrf);
  return { aplica: true, motivo: null, inss, sest_senat: sest, irrf, total, liquido: r2(valor - total), base_inss: baseInss, base_irrf: r2(valor * (+P.irrf_base_pct || 0) / 100),
    vigencia: P.vigencia || null,
    memoria: { frete_mes: freteMes, fretes_anteriores: ant.length, base_inss_mes: baseMes, base_inss_mes_limitada: r2(baseMesLim), teto_aplicado: baseMes > teto, inss_mes: inssMes, inss_ja_retido: soma('inss'),
      sest_senat_mes: sestMes, rendimento_irrf_mes: rendMes, deducao: r2(ded), desconto_simplificado: simplificado, base_irrf_mes: baseIr, irrf_tabela: tabela, irrf_reducao: reducao, irrf_mes: irMes, irrf_ja_retido: soma('irrf') } };
}

/** fretes anteriores do mesmo transportador no mês do frete (para o acumulado) */
export function anterioresDoMes(fretes, f) {
  const mes = String(f?.data || '').slice(0, 7);
  return (fretes || []).filter(o => o.id !== f?.id && o.transportador_id === f?.transportador_id && o.status !== 'cancelado' && String(o.data || '').slice(0, 7) === mes
    && (String(o.data) < String(f.data) || (o.data === f.data && (+o.numero || 0) < (+f.numero || Infinity))))
    .map(o => ({ valor: +o.valor || 0, inss: +o.retencoes?.inss || 0, sest_senat: +o.retencoes?.sest_senat || 0, irrf: +o.retencoes?.irrf || 0 }));
}

/** vencimento do recolhimento: dia 20 do mês seguinte ao do frete (DARF previdenciário e IRRF) */
export function vencimentoRecolhimento(data) {
  const [a, m] = String(data || '').split('-').map(Number); if (!a || !m) return null;
  const d = new Date(Date.UTC(a, m, 20)); return d.toISOString().slice(0, 10);
}

/** o que gravar em log_fretes.retencoes */
export const resumoRetencoes = (r) => (r?.aplica ? { inss: r.inss, sest_senat: r.sest_senat, irrf: r.irrf, total: r.total, liquido: r.liquido, base_inss: r.base_inss, base_irrf: r.base_irrf, vigencia: r.vigencia, memoria: r.memoria } : {});

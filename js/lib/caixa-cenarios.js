// Cenários de caixa (melhoria 3.9): premissas padrão, validação e simulação da Recuperação Judicial.
// Funções puras (sem banco), usadas pela Necessidade de Caixa e testadas em tests/caixa-cenarios.test.js.

/** premissas de um cenário; todos os percentuais em % (100 = como está) */
export const PREMISSAS_VAZIAS = {
  receber_pct: 100,          // quanto dos recebimentos em aberto (no prazo) entra
  receber_atraso_dias: 0,    // atraso médio dos recebimentos
  vencidos_receber_pct: 100, // quanto dos recebimentos já vencidos entra (na 1ª semana)
  pagar_pct: 100,            // quanto dos pagamentos em aberto sai
  pagar_atraso_dias: 0,      // pagamentos empurrados (negociação com fornecedor)
  forecast: true,            // completar com o forecast ainda não lançado
  forecast_receitas_pct: 100,
  forecast_despesas_pct: 100,
  compromissos: true,        // compromissos programados
  rj: { ativo: false, passivo: 0, desagio_pct: 0, carencia_meses: 0, parcelas: 1, juros_aa_pct: 0, inicio: '', dia: 10 },
  eventos: [],               // pontuais: { data, descricao, valor (+ entra / − sai) }
};

export const PADROES = [
  { tipo: 'base', nome: 'Base', cor: '#2563eb', ordem: 1, descricao: 'Como está: títulos em aberto no vencimento, forecast e compromissos.', premissas: {} },
  { tipo: 'otimista', nome: 'Otimista', cor: '#16a34a', ordem: 2, descricao: 'Recebe tudo no prazo, receitas do forecast 5% acima e despesas 3% abaixo.',
    premissas: { forecast_receitas_pct: 105, forecast_despesas_pct: 97 } },
  { tipo: 'pessimista', nome: 'Pessimista', cor: '#dc2626', ordem: 3, descricao: '8% dos recebimentos não entram, atraso de 15 dias, metade dos vencidos não entra, receitas do forecast 15% abaixo e despesas 3% acima.',
    premissas: { receber_pct: 92, receber_atraso_dias: 15, vencidos_receber_pct: 50, forecast_receitas_pct: 85, forecast_despesas_pct: 103 } },
];
export const TIPOS = { base: 'Base', otimista: 'Otimista', pessimista: 'Pessimista', personalizado: 'Personalizado' };

const num = (v, d) => { const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v); return Number.isFinite(n) ? n : d; };
const lim = (v, a, b) => Math.min(b, Math.max(a, v));

/** completa e limita as premissas (o que vier faltando fica no valor de "como está") */
export function normalizar(p = {}) {
  const V = PREMISSAS_VAZIAS, r0 = { ...V.rj, ...(p.rj || {}) };
  return {
    receber_pct: lim(num(p.receber_pct, V.receber_pct), 0, 200),
    receber_atraso_dias: lim(Math.round(num(p.receber_atraso_dias, 0)), 0, 180),
    vencidos_receber_pct: lim(num(p.vencidos_receber_pct, V.vencidos_receber_pct), 0, 100),
    pagar_pct: lim(num(p.pagar_pct, V.pagar_pct), 0, 200),
    pagar_atraso_dias: lim(Math.round(num(p.pagar_atraso_dias, 0)), 0, 180),
    forecast: p.forecast !== false,
    forecast_receitas_pct: lim(num(p.forecast_receitas_pct, 100), 0, 200),
    forecast_despesas_pct: lim(num(p.forecast_despesas_pct, 100), 0, 200),
    compromissos: p.compromissos !== false,
    rj: { ativo: !!r0.ativo, passivo: Math.max(0, num(r0.passivo, 0)), desagio_pct: lim(num(r0.desagio_pct, 0), 0, 100),
      carencia_meses: lim(Math.round(num(r0.carencia_meses, 0)), 0, 120), parcelas: lim(Math.round(num(r0.parcelas, 1)), 1, 360),
      juros_aa_pct: lim(num(r0.juros_aa_pct, 0), 0, 50), inicio: /^\d{4}-\d{2}$/.test(r0.inicio || '') ? r0.inicio : '', dia: lim(Math.round(num(r0.dia, 10)), 1, 31) },
    eventos: (Array.isArray(p.eventos) ? p.eventos : []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.data || '') && num(e.valor, 0) !== 0)
      .map(e => ({ data: e.data, descricao: String(e.descricao || '').slice(0, 120), valor: num(e.valor, 0) })),
  };
}

/** erros que impedem salvar (lista de textos) */
export function validar(c) {
  const e = [];
  if (!String(c.nome || '').trim()) e.push('Dê um nome ao cenário.');
  const p = c.premissas || {}, rj = p.rj || {};
  if (rj.ativo) {
    if (!(num(rj.passivo, 0) > 0)) e.push('Simulação da RJ: informe o valor do passivo sujeito ao plano.');
    if (!/^\d{4}-\d{2}$/.test(rj.inicio || '')) e.push('Simulação da RJ: informe o mês de início (homologação do plano).');
  }
  for (const ev of p.eventos || []) if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.data || '') || !num(ev.valor, 0)) { e.push('Cada evento pontual precisa de data e valor.'); break; }
  return e;
}

const addMes = (ym, n) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
const ultimoDia = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** parcela da RJ pela tabela Price (com juros) ou linear (sem juros), depois do deságio e da carência.
 *  Durante a carência os juros são capitalizados no saldo. */
export function simularRJ(rj0) {
  const rj = normalizar({ rj: rj0 }).rj;
  if (!rj.ativo || !(rj.passivo > 0) || !rj.inicio) return { parcela: 0, total: 0, liquido: 0, primeira: null, ultima: null, cronograma: [] };
  const liquido = rj.passivo * (1 - rj.desagio_pct / 100);
  const i = rj.juros_aa_pct > 0 ? Math.pow(1 + rj.juros_aa_pct / 100, 1 / 12) - 1 : 0;
  const saldo = liquido * Math.pow(1 + i, rj.carencia_meses);
  const n = rj.parcelas;
  const parcela = i > 0 ? saldo * i / (1 - Math.pow(1 + i, -n)) : saldo / n;
  const mes1 = addMes(rj.inicio, rj.carencia_meses);
  const cronograma = Array.from({ length: n }, (_, k) => { const ym = addMes(mes1, k); return { mes: ym, data: `${ym}-${String(Math.min(rj.dia, ultimoDia(ym))).padStart(2, '0')}`, valor: Math.round(parcela * 100) / 100 }; });
  return { parcela: Math.round(parcela * 100) / 100, total: Math.round(parcela * n * 100) / 100, liquido: Math.round(liquido * 100) / 100,
    primeira: cronograma[0]?.data || null, ultima: cronograma[n - 1]?.data || null, cronograma };
}

/** ajusta um lançamento em aberto pelas premissas: devolve { data, v } (v com sinal) ou null se não entra */
export function ajustarLanc(p, data, v, hoje, addDias) {
  if (v > 0) {
    if (data < hoje) return { data, v: v * p.vencidos_receber_pct / 100, vencido: true };
    return { data: p.receber_atraso_dias ? addDias(data, p.receber_atraso_dias) : data, v: v * p.receber_pct / 100 };
  }
  if (data < hoje) return { data, v: v * p.pagar_pct / 100, vencido: true };
  return { data: p.pagar_atraso_dias ? addDias(data, p.pagar_atraso_dias) : data, v: v * p.pagar_pct / 100 };
}

/** fator do forecast: receitas (sinal +) e despesas (sinal −) */
export const fatorForecast = (p, sinal) => (sinal > 0 ? p.forecast_receitas_pct : p.forecast_despesas_pct) / 100;

/** resumo de comparação de várias projeções { nome, cor, semanas[] } com o caixa mínimo */
export function comparar(lista, minimo) {
  return lista.map(c => {
    const S = c.semanas, pior = S.reduce((a, w) => (w.saldo < a.saldo ? w : a), S[0]);
    const primeira = S.find(w => w.saldo < minimo) || null;
    return { ...c, pior, primeira, maxFalta: Math.max(0, ...S.map(w => minimo - w.saldo)), saldoFinal: S[S.length - 1].saldo,
      semanasAbaixo: S.filter(w => w.saldo < minimo).length };
  });
}

/** cenários da empresa: os salvos + os padrões que ainda não foram salvos (em memória) */
export function montarLista(salvos = []) {
  const out = [...salvos].filter(c => c.ativo !== false);
  for (const p of PADROES) if (!salvos.some(c => c.tipo === p.tipo)) out.push({ ...p, id: null, padrao: true });
  return out.sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99) || String(a.nome).localeCompare(b.nome));
}

/** texto curto das premissas que mudam em relação ao "como está" */
export function resumoPremissas(p0) {
  const p = normalizar(p0), t = [];
  if (p.receber_pct !== 100) t.push(`recebe ${p.receber_pct}%`);
  if (p.receber_atraso_dias) t.push(`atraso de ${p.receber_atraso_dias} dias no recebimento`);
  if (p.vencidos_receber_pct !== 100) t.push(`${p.vencidos_receber_pct}% dos vencidos`);
  if (p.pagar_pct !== 100) t.push(`paga ${p.pagar_pct}%`);
  if (p.pagar_atraso_dias) t.push(`pagamentos ${p.pagar_atraso_dias} dias depois`);
  if (!p.forecast) t.push('sem forecast');
  else { if (p.forecast_receitas_pct !== 100) t.push(`receitas do forecast ${p.forecast_receitas_pct}%`); if (p.forecast_despesas_pct !== 100) t.push(`despesas do forecast ${p.forecast_despesas_pct}%`); }
  if (!p.compromissos) t.push('sem compromissos');
  if (p.rj.ativo) t.push('com a simulação da RJ');
  if (p.eventos.length) t.push(`${p.eventos.length} evento(s) pontual(is)`);
  return t.length ? t.join(' · ') : 'como está';
}

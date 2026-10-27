// RH / Trabalhista — cálculos puros (sem banco), para testar: datas da folha, folha mensal estimada e 13º salário.
// Etapa 1 (27/10/2026): a folha é feita no Iniflex/contabilidade; aqui ela vira PREVISÃO de caixa (títulos em aberto)
// a partir do cadastro de colaboradores e de parâmetros calibrados pelo que foi pago nos últimos meses.
import { ehDiaUtil } from './fidc-condicoes.js';

const iso = (d) => d.toISOString().slice(0, 10);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();   // mes 1–12
const dataDe = (ano, mes, dia) => `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimoDia(ano, mes))).padStart(2, '0')}`;
export const anteriorUtil = (s) => { let d = s; while (!ehDiaUtil(d)) d = addDias(d, -1); return d; };
/** n-ésimo dia útil do mês (feriados nacionais) */
export function nesimoUtil(ano, mes, n) {
  let d = dataDe(ano, mes, 1), k = 0;
  for (;;) { if (ehDiaUtil(d)) { k++; if (k >= n) return d; } d = addDias(d, 1); }
}
const proxMes = (ano, mes) => (mes === 12 ? [ano + 1, 1] : [ano, mes + 1]);

export const VINCULOS = { clt: 'CLT', aprendiz: 'Menor aprendiz', estagio: 'Estágio', extra_folha: 'Extra folha / diarista', pro_labore: 'Pró-labore' };
export const SITUACOES = { ativo: 'Ativo', afastado: 'Afastado', desligado: 'Desligado' };
export const EVENTOS = {
  adiantamento: 'Adiantamento salarial', saldo: 'Saldo da folha', inss: 'INSS (guia)', fgts: 'FGTS (guia)', irrf: 'IRRF s/ folha',
  decimo_1: '13º — 1ª parcela', decimo_2: '13º — 2ª parcela', inss_decimo: 'INSS s/ 13º', fgts_decimo_1: 'FGTS s/ 13º (1ª parcela)', fgts_decimo_2: 'FGTS s/ 13º (2ª parcela)', outro: 'Outro',
};
// plano de contas padrão de cada evento (código); a empresa pode trocar nos parâmetros
export const PLANO_PADRAO = { salarios: '2.03.01', inss: '2.03.17', fgts: '2.03.18', irrf: '2.03.20', decimo: '2.03.05' };
export const planoDoEvento = (ev) => ({ adiantamento: 'salarios', saldo: 'salarios', inss: 'inss', inss_decimo: 'inss', fgts: 'fgts', fgts_decimo_1: 'fgts', fgts_decimo_2: 'fgts', irrf: 'irrf', decimo_1: 'decimo', decimo_2: 'decimo' }[ev] || 'salarios');

export const PARAM_PADRAO = {
  pct_adiantamento: 40,   // % do salário pago no adiantamento
  dia_adiantamento: 15,   // dia do mês da competência (dia não útil → dia útil anterior)
  dia_util_saldo: 3,      // saldo no n-ésimo dia útil do mês seguinte (2026: pago no 3º/4º dia útil)
  fator_liquido: 92,      // líquido do mês (adiantamento + saldo) em % do bruto (sobra depois de INSS/IRRF/VT/descontos)
  dia_guias: 18,          // INSS / FGTS / IRRF (vencem dia 20; em 2026 pagos entre 16 e 19) — não útil → antecipa
  inss_pct: 10.5,         // valor da guia de INSS em % da folha (calibrar pelo pago; desoneração/parcelamentos mudam)
  fgts_pct: 8,            // FGTS (aprendiz 2%, estágio não recolhe)
  irrf_mensal: 0,         // guia de IRRF estimada (R$); 0 = não prever
  desc13_pct: 9,          // descontos da 2ª parcela do 13º (INSS/IRRF do empregado) em % do bruto
};
export const param = (P) => ({ ...PARAM_PADRAO, ...Object.fromEntries(Object.entries(P || {}).filter(([, v]) => v != null && v !== '')) });

const entraFolha = (c) => c.situacao !== 'desligado' && !['extra_folha', 'pro_labore'].includes(c.vinculo);
const pctFgts = (c, P) => (c.vinculo === 'aprendiz' ? 2 : c.vinculo === 'estagio' ? 0 : +P.fgts_pct);

/** datas de pagamento da folha de uma competência 'YYYY-MM' */
export function datasFolha(comp, P0) {
  const P = param(P0); const [ano, mes] = comp.split('-').map(Number); const [a2, m2] = proxMes(ano, mes);
  return { adiantamento: anteriorUtil(dataDe(ano, mes, +P.dia_adiantamento)), saldo: nesimoUtil(a2, m2, +P.dia_util_saldo), guias: anteriorUtil(dataDe(a2, m2, +P.dia_guias)) };
}

/** itens da folha mensal estimada a partir do cadastro (quem entra: ativos/afastados CLT, aprendiz, estágio) */
export function itensMensal(colabs, P0) {
  const P = param(P0);
  return colabs.filter(entraFolha).map(c => {
    const sal = +c.salario || 0, adiant = r2(sal * P.pct_adiantamento / 100);
    return { colaborador_id: c.id, salario: sal, proventos: 0, descontos: 0, adiantamento: adiant, liquido: r2(sal * P.fator_liquido / 100 - adiant) };
  });
}
/** recalcula o líquido de um item quando proventos/descontos/adiantamento mudam */
export const liquidoItem = (it, P0) => { const P = param(P0); return r2((+it.salario + +it.proventos) * P.fator_liquido / 100 - +it.descontos - +it.adiantamento); };

/** eventos (pagamentos) da folha mensal: adiantamento, saldo e guias */
export function eventosMensal(comp, itens, colabsPorId, P0) {
  const P = param(P0), d = datasFolha(comp, P);
  const soma = (f) => r2(itens.reduce((s, it) => s + f(it), 0));
  const base = soma(it => +it.salario + +it.proventos);
  const fgts = soma(it => (+it.salario + +it.proventos) * pctFgts(colabsPorId[it.colaborador_id] || {}, P) / 100);
  const ev = [
    { evento: 'adiantamento', vencimento: d.adiantamento, valor: soma(it => +it.adiantamento) },
    { evento: 'saldo', vencimento: d.saldo, valor: soma(it => +it.liquido) },
    { evento: 'inss', vencimento: d.guias, valor: r2(base * P.inss_pct / 100) },
    { evento: 'fgts', vencimento: d.guias, valor: fgts },
  ];
  if (+P.irrf_mensal > 0) ev.push({ evento: 'irrf', vencimento: d.guias, valor: r2(P.irrf_mensal) });
  return ev.filter(e => e.valor > 0);
}

/** avos do 13º no ano: meses com 15 dias ou mais trabalhados (admissão/desligamento dentro do ano) */
export function avos13(admissao, demissao, ano) {
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    const ini = dataDe(ano, m, 1), fim = dataDe(ano, m, 31);
    const de = admissao && admissao > ini ? admissao : ini, ate = demissao && demissao < fim ? demissao : fim;
    if (de > ate) continue;
    const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 864e5) + 1;
    if (dias >= 15) n++;
  }
  return n;
}

/** itens do 13º: bruto = salário × avos/12 + médias (proventos); 1ª parcela = metade − já adiantado; 2ª = resto − descontos */
export function itensDecimo(colabs, P0, ano, anteriores = {}) {
  const P = param(P0);
  return colabs.filter(c => entraFolha(c) && c.vinculo !== 'estagio').map(c => {
    const a = anteriores[c.id] || {};
    const it = { colaborador_id: c.id, salario: +c.salario || 0, avos: a.avos ?? avos13(c.admissao, c.demissao, ano), proventos: +a.proventos || 0, adiant_pago: +a.adiant_pago || 0 };
    return calcDecimo(it, P);
  });
}
export function calcDecimo(it, P0) {
  const P = param(P0);
  const bruto = r2(+it.salario * (+it.avos || 0) / 12 + (+it.proventos || 0));
  const p1 = r2(Math.max(0, bruto / 2 - (+it.adiant_pago || 0)));
  const desc = r2(bruto * P.desc13_pct / 100);
  const p2 = r2(Math.max(0, bruto - p1 - (+it.adiant_pago || 0) - desc));
  return { ...it, bruto, adiantamento: p1, descontos: desc, liquido: p2 };
}
export function eventosDecimo(ano, itens, colabsPorId, P0) {
  const P = param(P0);
  const soma = (f) => r2(itens.reduce((s, it) => s + f(it), 0));
  const pf = (it) => pctFgts(colabsPorId[it.colaborador_id] || {}, P) / 100;
  const g = String(Math.min(28, +P.dia_guias || 20)).padStart(2, '0');
  return [
    { evento: 'decimo_1', vencimento: anteriorUtil(`${ano}-11-30`), valor: soma(it => +it.adiantamento) },
    { evento: 'decimo_2', vencimento: anteriorUtil(`${ano}-12-20`), valor: soma(it => +it.liquido) },
    { evento: 'inss_decimo', vencimento: anteriorUtil(`${ano}-12-${g}`), valor: r2(soma(it => +it.bruto) * P.inss_pct / 100) },
    { evento: 'fgts_decimo_1', vencimento: anteriorUtil(`${ano}-12-${g}`), valor: soma(it => +it.adiantamento * pf(it)) },
    { evento: 'fgts_decimo_2', vencimento: anteriorUtil(`${ano + 1}-01-${g}`), valor: soma(it => (+it.bruto - +it.adiantamento - +it.adiant_pago) * pf(it)) },
  ].filter(e => e.valor > 0);
}

/** pagamento de salário realizado: adiantamento × saldo pelo texto do lançamento (padrão do ERP: "ADIANT FOLHA" / "PROVISAO FOLHA") */
export const tipoPagamentoSalario = (desc) => (/ADIANT\w*\s+FOLHA/i.test(desc || '') ? 'adiantamento' : /PROVIS\w*\s+FOLHA|SALDO\s+(DA\s+)?FOLHA/i.test(desc || '') ? 'saldo' : null);

/** setor sugerido pelo cargo (só palavras óbvias; o resto fica para preencher) */
export function setorDoCargo(cargo) {
  const c = String(cargo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const regras = [[/IMPRESS|CLICHE|COLORISTA/, 'Impressão'], [/EXTRUS/, 'Extrusão'], [/CORTE E SOLDA/, 'Corte e solda'], [/LAMINA/, 'Laminação'],
    [/QUALIDADE/, 'Qualidade'], [/AGLUTINADOR/, 'Reciclagem'], [/MECANIC/, 'Manutenção'], [/PCP|PLANEJAMENTO/, 'PCP'], [/LOGISTICA/, 'Logística'],
    [/COMPRADOR/, 'Compras'], [/SEGURANCA DO TRABALHO/, 'SESMT'], [/PORTEIRO|SERVICOS GERAIS/, 'Apoio']];
  return (regras.find(([re]) => re.test(c)) || [])[1] || null;
}

/** normaliza nome para casar a planilha com o cadastro */
export const chaveNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

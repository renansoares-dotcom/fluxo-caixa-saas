// Liquidação dos títulos cedidos aos fundos (SQL 073): leitura dos relatórios de títulos pagos de cada fundo,
// casamento com a base FIDC (fundo + título + borderô) e situação de cada título cedido.
// A cessão (aprovação do borderô) já baixou o título; aqui fica o segundo momento: o cliente pagou o fundo,
// a IPLAMM recomprou, ou o título venceu e o fundo ainda não informou (risco de recompra).

const num = (s) => (s ? parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0 : 0);
const iso = (s) => (s ? s.split('/').reverse().join('-') : null);
const r2 = (v) => Math.round(v * 100) / 100;

export const TIPOS = { normal: 'Pago pelo cliente', deposito_sacado: 'Depósito do cliente', recompra: 'Recomprado', outro: 'Outro' };
export const SITUACOES = {
  a_vencer: 'A vencer', aguardando: 'Vencido, aguardando o fundo', atrasado: 'Vencido sem liquidação', sem_relatorio: 'Vencido, fundo sem relatório importado',
  liquidado: 'Liquidado pelo cliente', recomprado: 'Recomprado',
};
export const TOLERANCIA_DU = 3;   // dias úteis depois do vencimento até virar "vencido sem liquidação"

/** tipo da plataforma a partir do texto do fundo */
export function tipoDe(txt) {
  const t = String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/RECOMPRA/.test(t)) return 'recompra';
  if (/DEPOSITO/.test(t)) return 'deposito_sacado';
  if (/NORMAL|LIQUIDA|PAGO|BAIXA/.test(t)) return 'normal';
  return 'outro';
}

/**
 * Negocial — "PAGOS - ANALÍTICO" (Consulta de títulos pagos).
 * Linha: Duplicata | Cheque | Vencimento | Quitação | Sacado | CNPJ | Face | Desc./Abat. | Mora | Pago | Tipo Liquidação | Situação | Borderô | Empresa | Banco
 */
const RX_NEG = /^\s*(.*?)\s*(\d\d\/\d\d\/\d{4})\s+(\d\d\/\d\d\/\d{4})\s+(.+?)\s+(\d\d\.\d{3}\.\d{3}\/\d{4}-\d\d|\d{3}\.\d{3}\.\d{3}-\d\d)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+R\$\s*([\d.,]+)\s+(.+?)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/;
export function parseNegocial(texto) {
  const out = [];
  for (const l of String(texto).split(/\r?\n/)) {
    if (!/R\$/.test(l) || !/\d\d\/\d\d\/\d{4}\s+\d\d\/\d\d\/\d{4}/.test(l)) continue;
    const m = l.match(RX_NEG); if (!m) continue;
    const titulo = m[1].trim(); if (!titulo) continue;
    out.push({ titulo, bordero: m[12], vencimento: iso(m[2]), quitacao: iso(m[3]), sacado: m[4].trim(), cnpj_sacado: m[5],
      valor_face: num(m[6]), desconto: num(m[7]), mora: num(m[8]), valor_pago: num(m[9]), tipo_fundo: m[10].trim(), tipo: tipoDe(m[10]) });
  }
  return out;
}

export const LEITORES = {
  Negocial: { nome: 'Negocial — Consulta de títulos pagos (PDF "PAGOS - ANALÍTICO")', ler: parseNegocial, reconhece: (t) => /PAGOS\s*-\s*ANAL[IÍ]TICO/i.test(t) },
};

/** título da plataforma é o mesmo do fundo? (36479-001 = 36479-1 = 36479/1) */
export const chaveTitulo = (t) => { const m = String(t || '').match(/^(\d+)\s*[-/]\s*0*(\d+)$/); return m ? `${+m[1]}-${+m[2]}` : String(t || '').trim().toUpperCase(); };

/**
 * casa as linhas do relatório com os títulos da base FIDC do fundo.
 * titulos: [{ id, titulo, bordero, valor, vencimento }]; devolve { linhas: [{...linha, fidc_titulo_id, aviso}], semTitulo, divergentes }
 */
export function casar(linhas, titulos) {
  const por = new Map();
  for (const t of titulos) { const k = `${chaveTitulo(t.titulo)}|${String(t.bordero || '').replace(/^0+/, '')}`; (por.get(k) || por.set(k, []).get(k)).push(t); }
  const res = linhas.map(l => {
    const c = por.get(`${chaveTitulo(l.titulo)}|${String(l.bordero || '').replace(/^0+/, '')}`) || [];
    const t = c.find(x => Math.abs(+x.valor - l.valor_face) < 0.01) || c[0];
    return { ...l, fidc_titulo_id: t?.id || null, aviso: !t ? 'sem título na base (borderô fora da base)' : Math.abs(+t.valor - l.valor_face) >= 0.01 ? `face na base ${r2(+t.valor)}` : null };
  });
  return { linhas: res, semTitulo: res.filter(l => !l.fidc_titulo_id), divergentes: res.filter(l => l.fidc_titulo_id && l.aviso) };
}

/** dias úteis (seg–sex) entre duas datas ISO, contando a partir do dia seguinte a "de" */
export function diasUteis(de, ate) {
  if (ate <= de) return 0;
  let n = 0; const d = new Date(de + 'T12:00:00Z'), f = new Date(ate + 'T12:00:00Z');
  while (d < f) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6) n++; }
  return n;
}

/**
 * situação do título cedido. cobertura = data do último pagamento no relatório do fundo (até onde o relatório vai).
 * Vencido sem liquidação só quando o relatório já cobre o vencimento + a tolerância e não trouxe o título.
 */
export function situacao(t, liq, hoje, cobertura, tol = TOLERANCIA_DU) {
  if (liq) return liq.tipo === 'recompra' ? 'recomprado' : 'liquidado';
  if (t.vencimento >= hoje) return 'a_vencer';
  if (!cobertura) return 'sem_relatorio';
  return diasUteis(t.vencimento, cobertura) > tol ? 'atrasado' : 'aguardando';
}

/** carteira cedida: títulos com situação, totais por fundo e por situação */
export function carteira(titulos, liquidacoes, hoje, tol = TOLERANCIA_DU) {
  const porTit = new Map(liquidacoes.filter(l => l.fidc_titulo_id).map(l => [l.fidc_titulo_id, l]));
  const cobertura = {}; for (const l of liquidacoes) if (!cobertura[l.fundo] || l.quitacao > cobertura[l.fundo]) cobertura[l.fundo] = l.quitacao;
  const itens = titulos.map(t => { const l = porTit.get(t.id) || null; return { ...t, liq: l, sit: situacao(t, l, hoje, cobertura[t.fundo], tol), atraso: l ? null : Math.max(0, diasUteis(t.vencimento, hoje)) }; });
  const fundos = {};
  for (const i of itens) {
    const f = fundos[i.fundo] || (fundos[i.fundo] = { fundo: i.fundo, ...Object.fromEntries(Object.keys(SITUACOES).flatMap(k => [[k, 0], ['n_' + k, 0]])) });
    f[i.sit] = r2(f[i.sit] + +i.valor); f['n_' + i.sit]++;
  }
  for (const f of Object.values(fundos)) { f.coobrigacao = r2(f.a_vencer + f.aguardando + f.atrasado + f.sem_relatorio); f.cobertura = cobertura[f.fundo] || null; }
  const T = Object.fromEntries(Object.keys(SITUACOES).flatMap(k => [[k, r2(itens.filter(i => i.sit === k).reduce((s, i) => s + +i.valor, 0))], ['n_' + k, itens.filter(i => i.sit === k).length]]));
  T.coobrigacao = r2(T.a_vencer + T.aguardando + T.atrasado + T.sem_relatorio);
  return { itens, fundos: Object.values(fundos).sort((a, b) => b.coobrigacao - a.coobrigacao), total: T, cobertura };
}

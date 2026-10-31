// Reforma tributária — notas de débito de juros e multa (SQL 074).
// LC 214/2025, art. 12, § 1º, II: juros, multas e acréscimos recebidos entram na base da CBS e do IBS. No recebimento, o
// fornecedor emite NF-e de débito (finNFe 6, tpNFDebito 04 – Multa e juros), referenciando cada item da nota de origem
// (DFeReferenciado: chave + nItem), com a mesma classificação e a alíquota do ano da nota de origem; só CBS e IBS (sem ICMS).
import { doAno, ibs as ibsDe } from './reforma.js';

export const PLANO_JUROS = '1.02.17';
export const STATUS = { pendente: 'A emitir', a_decidir: 'A decidir (contabilidade)', emitida: 'Emitida', dispensada: 'Dispensada' };
export const ORIGEM = { recebimento: 'Recebido pela empresa', fidc: 'Recebido pelo fundo', manual: 'Registrado à mão' };
export const PRAZO_ALERTA = 5;   // dias corridos sem emitir → vermelho

const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const n = (v) => +v || 0;

/** recebimento acima da face: o título baixa pela face e a diferença é juros/multa */
export function separarJuros(face, recebido) {
  const f = r2(face), rc = r2(recebido), j = r2(rc - f);
  return j > 0.004 ? { face: f, juros: j } : { face: f, juros: 0 };
}

/** valor de cada item da nota de origem usado no rateio (produtos − desconto + frete + outras) */
const baseItem = (i) => n(i.vprod) - n(i.vdesc) + n(i.vfrete) + n(i.voutro);

/**
 * rateia os juros entre os itens da nota de origem, na proporção do valor de cada item; o último absorve o arredondamento.
 * itens: nfe_itens da nota de origem; aliq: linha da tabela de alíquotas do ano da EMISSÃO da nota de origem.
 * devolve [{ nItem, cprod, xprod, ncm, cfop, cst_ibscbs, cclass_trib, valor, cbs, ibs }]
 */
export function ratear(itens, valor, aliq) {
  const base = itens.map(baseItem), tot = base.reduce((s, b) => s + b, 0), v = r2(valor);
  if (!itens.length || tot <= 0) return [];
  let acum = 0;
  return itens.map((it, k) => {
    const val = k === itens.length - 1 ? r2(v - acum) : r2(v * base[k] / tot); acum = r2(acum + val);
    return { nItem: it.n_item ?? k + 1, cprod: it.cprod, xprod: it.xprod, ncm: it.ncm, cfop: it.cfop, cst_ibscbs: it.cst_ibscbs || '000', cclass_trib: it.cclass_trib || '000001',
      valor: val, cbs: aliq ? r2(val * n(aliq.cbs) / 100) : 0, ibs: aliq ? r2(val * ibsDe(aliq) / 100) : 0 };
  });
}

/** dados da NF-e de débito no layout da NT 2025.002-RTC (base para a emissão pela API) */
export function dadosND(pend, nota, itens, lista, empresa) {
  const aliq = nota ? doAno(lista, +String(nota.emissao).slice(0, 4)) : null;
  const det = ratear(itens, pend.valor, aliq);
  const tot = det.reduce((s, d) => ({ valor: r2(s.valor + d.valor), cbs: r2(s.cbs + d.cbs), ibs: r2(s.ibs + d.ibs) }), { valor: 0, cbs: 0, ibs: 0 });
  return {
    ide: { finNFe: 6, tpNFDebito: '04', natOp: 'NOTA DE DEBITO - MULTA E JUROS', dhEmi: null },
    emit: { CNPJ: String(empresa?.cnpj || '').replace(/\D/g, ''), xNome: empresa?.razao_social || empresa?.nome || '' },
    dest: { doc: String(pend.cliente_doc || nota?.dest_doc || '').replace(/\D/g, ''), xNome: pend.cliente_nome || nota?.dest_nome || '' },
    origem: nota ? { chave: nota.chave, numero: nota.numero, serie: nota.serie, emissao: nota.emissao } : null,
    recebimento: { data: pend.data_recebimento, valor: r2(pend.valor), parcela: pend.parcela },
    aliquotas: aliq ? { ano: aliq.ano, cbs: aliq.cbs, ibs: ibsDe(aliq), situacao: aliq.situacao } : null,
    det: det.map(d => ({ ...d, DFeReferenciado: nota ? { chaveAcesso: nota.chave, nItem: d.nItem } : null })),
    total: tot,
    infCpl: nota ? `Juros/multa por atraso no pagamento da NF-e ${nota.numero}${pend.parcela ? ' parcela ' + pend.parcela : ''} de ${String(nota.emissao).split('-').reverse().join('/')}, recebidos em ${String(pend.data_recebimento).split('-').reverse().join('/')}. Art. 12, § 1º, II, da LC 214/2025.` : null,
  };
}

/** dias desde o recebimento */
export const diasDesde = (iso, hoje) => Math.round((Date.parse(hoje + 'T12:00:00') - Date.parse(iso + 'T12:00:00')) / 864e5);
/** nível do alerta de uma pendência */
export const nivel = (p, hoje) => p.status !== 'pendente' ? null : diasDesde(p.data_recebimento, hoje) > PRAZO_ALERTA ? 'neg' : 'warn';

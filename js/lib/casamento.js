// Regra única de casamento: um movimento que chega por qualquer importador (ERP, extrato, planilha, VExpenses…)
// procura primeiro o TÍTULO EM ABERTO que ele paga, antes de virar lançamento novo. Puro (sem banco), para testar.
//
// Ordem:
//  1) NF/parcela citada no movimento ("DUPLICATA 36045/1", "DOCTO 622/1", "1-36045/1", "NF 36045-1", documento "36045-1")
//     = documento do título, mesma natureza. Valor igual → baixa; menor → baixa parcial; maior → avisa (pago a maior).
//     Vale para título vencido há muito tempo (a data não impede: a NF/parcela identifica).
//  2) Sem NF/parcela que case: mesmo valor e mesmo favorecido, título de até 150 dias antes a 7 dias depois.
//  3) Mesmo valor e só a NF (sem parcela) citada no documento, se houver um único título dessa NF com esse valor.

const r2 = (v) => Math.round(+v * 100) / 100;
const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 864e5);

/** NF e parcela citadas num texto/documento → "36045-1" (ou { nf } sem parcela) */
export function nfParcela(...textos) {
  for (const t of textos.filter(Boolean).map(String)) {
    let m = t.match(/\b(?:DUPLICATA|DUPL?\.?|DOCTO|DOCUMENTO|DOC\.?|NFE?|NF-E|T[IÍ]TULO)\s*(?:N[ºO°.]?\s*)?(?:\d{1,2}-)?(\d{3,9})\s*[/-]\s*(\d{1,3})\b/i);
    if (m) return { nf: +m[1], parcela: +m[2], doc: `${+m[1]}-${+m[2]}` };
    m = t.match(/^\s*(?:\d{1,2}-)?(\d{3,9})\s*[/-]\s*(\d{1,3})\s*$/); // "36045-1", "36045/1", "1-36045/1"
    if (m) return { nf: +m[1], parcela: +m[2], doc: `${+m[1]}-${+m[2]}` };
  }
  for (const t of textos.filter(Boolean).map(String)) {
    const m = t.match(/^\s*(\d{4,9})\s*$/) || t.match(/\b(?:DUPLICATA|DOCTO|NFE?)\s*(?:N[ºO°.]?\s*)?(\d{4,9})\b/i);
    if (m) return { nf: +m[1], parcela: null, doc: null };
  }
  return null;
}
const docTitulo = (l) => { const x = nfParcela(l.documento); return x?.doc || null; };

/**
 * mov: { data, valor (>0), entrada (bool), favorecido_id, documento, texto }
 * abertos: títulos Em aberto { id, data, valor, tipo 'E'|'S', documento, favorecido_id, fidc_proposta_id }
 * usados: Set de ids já casados nesta rodada
 * → { titulo, como: 'exato'|'parcial'|'maior'|'valor', aviso } ou null
 */
export function casarTitulo(mov, abertos, usados = new Set()) {
  const v = r2(mov.valor);
  const livres = abertos.filter(l => !usados.has(l.id) && (l.tipo === 'E') === !!mov.entrada && !l.fidc_proposta_id);
  const ref = nfParcela(mov.documento, mov.texto);
  if (ref?.doc) {
    const t = livres.find(l => docTitulo(l) === ref.doc);
    if (t) {
      const tv = r2(t.valor);
      if (Math.abs(tv - v) < 0.005) return { titulo: t, como: 'exato' };
      if (v < tv) return { titulo: t, como: 'parcial', aviso: `baixa parcial do título ${t.documento}: recebido ${v.toFixed(2)} de ${tv.toFixed(2)}, saldo ${r2(tv - v).toFixed(2)} continua em aberto` };
      return { titulo: t, como: 'maior', aviso: `valor maior que o título ${t.documento} (${tv.toFixed(2)}): confira juros/multa ou pagamento a maior` };
    }
  }
  const mesmoValor = livres.filter(l => Math.abs(r2(l.valor) - v) < 0.005 && dias(l.data, mov.data) >= -150 && dias(l.data, mov.data) <= 7);
  if (mov.favorecido_id) {
    const t = mesmoValor.find(l => l.favorecido_id === mov.favorecido_id);
    if (t) return { titulo: t, como: 'valor' };
  }
  if (ref?.nf) {
    const c = mesmoValor.filter(l => nfParcela(l.documento)?.nf === ref.nf);
    if (c.length === 1) return { titulo: c[0], como: 'valor' };
  }
  return null;
}

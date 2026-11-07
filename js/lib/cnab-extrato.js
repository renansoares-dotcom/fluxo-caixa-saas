// Extrato bancário no padrão CNAB 240 da FEBRABAN ("Extrato Eletrônico para Conciliação Bancária", serviço 04,
// segmento E). Devolve o mesmo formato do lerOFX: um extrato por lote (conta), com os movimentos, o período e o
// saldo final do trailer do lote. Posições 1-based conforme o layout FEBRABAN 240 (v. 10.x):
//   header do arquivo (tipo 0): 1-3 banco · 73-102 empresa
//   header do lote (tipo 1): 53-57 agência · 59-70 conta · 71 DV · 143-150 data do saldo inicial · 151-168 saldo inicial · 169 D/C
//   detalhe (tipo 3, segmento E): 109-111 natureza · 112-113 tipo do complemento · 114-133 complemento · 135-142 data contábil
//     · 143-150 data do lançamento · 151-168 valor (2 decimais) · 169 D/C · 170-172 categoria · 173-176 código do histórico
//     · 177-201 histórico · 202-240 número do documento
//   trailer do lote (tipo 5): 143-150 data do saldo final · 151-168 saldo final · 169 D/C · 177-194 total de débitos · 195-212 total de créditos

const corta = (l, a, b) => l.slice(a - 1, b);
const data = (s) => { const d = String(s || '').trim(); if (!/^\d{8}$/.test(d) || /^0+$/.test(d)) return null; return `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`; };
const valor = (s) => { const d = String(s || '').replace(/\D/g, ''); return d ? +d / 100 : NaN; };
const txt = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const semZeros = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

/** o texto parece um CNAB 240? (linhas de 240 posições com tipo de registro na posição 8) */
export function ehCNAB240(texto) {
  const ls = String(texto || '').split(/\r?\n/).filter(l => l.trim());
  return ls.length >= 3 && ls.filter(l => l.replace(/\r$/, '').length >= 240).length >= ls.length * 0.8 && /^\d{3}0{4}0/.test(ls[0]);
}

/** lê o arquivo CNAB 240 de extrato; recusa outros serviços (ex.: retorno de cobrança, segmentos T/U) */
export function lerCNAB240(texto) {
  if (!ehCNAB240(texto)) throw new Error('O arquivo não parece um CNAB 240 (linhas de 240 posições).');
  const ls = String(texto).split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  const banco = corta(ls[0], 1, 3);
  const lotes = [];
  let at = null;
  for (const l of ls) {
    const tipo = l[7];
    if (tipo === '1') {
      at = { banco, agencia: semZeros(corta(l, 53, 57)) || null, conta: semZeros(corta(l, 59, 70)) + (txt(corta(l, 71, 71)) || ''), contaSemDV: semZeros(corta(l, 59, 70)),
        saldoIni: valor(corta(l, 151, 168)) * (corta(l, 169, 169) === 'D' ? -1 : 1), saldoIniData: data(corta(l, 143, 150)), itens: [], saldo: null, saldoData: null };
      lotes.push(at);
    } else if (tipo === '3' && at && l[13] === 'E') {
      const v = valor(corta(l, 151, 168)), dc = corta(l, 169, 169).toUpperCase();
      const dt = data(corta(l, 143, 150)) || data(corta(l, 135, 142));
      if (!dt || !isFinite(v) || !v) continue;
      const hist = txt(corta(l, 177, 201)), compl = txt(corta(l, 114, 133)), doc = txt(corta(l, 202, 240)).replace(/^0+(?=\d)/, '');
      at.itens.push({ data: dt, valor: dc === 'D' ? -v : v, tipo: dc === 'D' ? 'DEBIT' : 'CREDIT', descricao: [hist, compl].filter(Boolean).join(' — ') || null,
        documento: doc || null, categoria: corta(l, 170, 172), historico_cod: txt(corta(l, 173, 176)) });
    } else if (tipo === '3' && at && l[13] !== 'E') {
      throw new Error(`Este CNAB não é de extrato (segmento ${l[13]}): é retorno de cobrança ou pagamento. Peça ao banco o "extrato para conciliação" em CNAB 240 (segmento E).`);
    } else if (tipo === '5' && at) {
      const s = valor(corta(l, 151, 168));
      if (isFinite(s)) { at.saldo = s * (corta(l, 169, 169) === 'D' ? -1 : 1); at.saldoData = data(corta(l, 143, 150)); }
      at = null;
    }
  }
  return lotes.filter(x => x.itens.length || x.saldo != null).map((x) => {
    // identificador estável (o nº sequencial muda a cada arquivo): data|valor|documento|histórico + ocorrência
    const vistos = {};
    for (const i of x.itens) { const b = `cnab:${i.data}|${i.valor.toFixed(2)}|${i.documento || ''}|${(i.descricao || '').toUpperCase()}`; vistos[b] = (vistos[b] || 0) + 1; i.fitid = `${b}|${vistos[b]}`; delete i.categoria; delete i.historico_cod; }
    const ds = x.itens.map(i => i.data).sort();
    return { cartao: false, banco: x.banco, agencia: x.agencia, conta: x.conta, tipoConta: 'CHECKING', inicio: ds[0] || x.saldoIniData, fim: ds[ds.length - 1] || x.saldoData,
      saldo: x.saldo, saldoData: x.saldoData || ds[ds.length - 1] || null, formato: 'cnab240', itens: x.itens };
  });
}

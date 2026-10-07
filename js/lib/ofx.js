// Leitura de extratos OFX (1.x SGML e 2.x XML) no navegador.
// Retorna uma lista de extratos (um arquivo pode trazer mais de uma conta):
// { banco, agencia, conta, tipoConta, inicio, fim, saldo, saldoData, itens: [{ fitid, data, valor, tipo, descricao, documento }] }

/** Decodifica os bytes respeitando o CHARSET do cabeçalho (bancos brasileiros costumam usar 1252). */
export function decodificarOFX(buf) {
  const bytes = new Uint8Array(buf);
  const cab = new TextDecoder('latin1').decode(bytes.slice(0, 600));
  const cp = (cab.match(/CHARSET:\s*([\w-]+)/i)?.[1] || cab.match(/encoding="([\w-]+)"/i)?.[1] || '').toLowerCase();
  if (/1252|8859|latin/.test(cp)) return new TextDecoder('windows-1252').decode(bytes);
  const u = new TextDecoder('utf-8').decode(bytes);
  return u.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : u;
}

// datas inválidas (ex.: Bradesco manda DTASOF 00000000) viram null
const dataOFX = (s) => {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})/); if (!m) return null;
  const [a, mm, d] = [+m[1], +m[2], +m[3]];
  if (a < 1990 || a > 2100 || mm < 1 || mm > 12 || d < 1 || d > new Date(Date.UTC(a, mm, 0)).getUTCDate()) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
};
const numOFX = (s) => {
  let t = String(s || '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  return Math.round(parseFloat(t) * 100) / 100;
};
const entidades = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
// valor de uma tag folha: <TAG>valor  (SGML, sem fechamento) ou <TAG>valor</TAG> (XML)
const tag = (bloco, nome) => { const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i')); return m ? entidades(m[1].trim()) : ''; };
const blocos = (txt, nome) => {
  const out = []; const re = new RegExp(`<${nome}>([\\s\\S]*?)(?=<\\/${nome}>|<${nome}>|<\\/BANKTRANLIST>|$)`, 'gi'); let m;
  while ((m = re.exec(txt))) out.push(m[1]);
  return out;
};

export function lerOFX(texto) {
  if (!/<OFX>/i.test(texto)) throw new Error('O arquivo não parece ser um extrato OFX');
  const corpo = texto.slice(texto.search(/<OFX>/i));
  const stmts = [...corpo.matchAll(/<(STMTRS|CCSTMTRS)>([\s\S]*?)(?:<\/\1>|(?=<(?:STMTRS|CCSTMTRS)>)|$)/gi)].map(m => ({ cartao: /^CC/i.test(m[1]), txt: m[2] }));
  if (!stmts.length) throw new Error('Nenhum extrato encontrado no OFX');
  return stmts.map(({ cartao, txt }) => {
    const conta = txt.match(/<(BANKACCTFROM|CCACCTFROM)>([\s\S]*?)(?:<\/\1>|<BANKTRANLIST>)/i)?.[2] || txt;
    const lista = txt.match(/<BANKTRANLIST>([\s\S]*?)(?:<\/BANKTRANLIST>|$)/i)?.[1] || '';
    const bal = txt.match(/<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|$)/i)?.[1] || '';
    const vistos = {};
    const itens = blocos(lista, 'STMTTRN').map((b) => {
      const data = dataOFX(tag(b, 'DTPOSTED')); const valor = numOFX(tag(b, 'TRNAMT'));
      const memo = tag(b, 'MEMO'), nome = tag(b, 'NAME');
      const descricao = [nome, memo].filter((x, i, a) => x && a.indexOf(x) === i).join(' — ') || tag(b, 'TRNTYPE');
      let fitid = tag(b, 'FITID');
      if (!fitid) { const base = `gen:${data}|${valor}|${descricao}`; vistos[base] = (vistos[base] || 0) + 1; fitid = `${base}|${vistos[base]}`; }
      return { fitid, data, valor, tipo: tag(b, 'TRNTYPE') || null, descricao: descricao || null, documento: tag(b, 'CHECKNUM') || tag(b, 'REFNUM') || null };
    }).filter(i => i.data && isFinite(i.valor) && i.valor !== 0);
    // O FITID de alguns bancos (ex.: Bradesco) é só uma sequência do arquivo e pode se repetir em outro extrato:
    // a chave de duplicidade junta FITID + data + valor. Repetido no mesmo arquivo: torna único.
    for (const i of itens) if (!i.fitid.startsWith('gen:')) i.fitid = `${i.fitid}|${i.data}|${i.valor.toFixed(2)}`;
    const cont = {}; for (const i of itens) { cont[i.fitid] = (cont[i.fitid] || 0) + 1; if (cont[i.fitid] > 1) i.fitid += `#${cont[i.fitid]}`; }
    const datas = itens.map(i => i.data).sort();
    // período: pelos movimentos (o cabeçalho às vezes traz a data da exportação, não o período)
    const ini = datas[0] || dataOFX(tag(lista, 'DTSTART')), fim = datas[datas.length - 1] || dataOFX(tag(lista, 'DTEND'));
    return {
      cartao, banco: tag(conta, 'BANKID') || null, agencia: tag(conta, 'BRANCHID') || null, conta: tag(conta, 'ACCTID') || null, tipoConta: tag(conta, 'ACCTTYPE') || null,
      inicio: ini || null, fim: fim || null,
      saldo: bal && isFinite(numOFX(tag(bal, 'BALAMT'))) ? numOFX(tag(bal, 'BALAMT')) : null, saldoData: (bal && dataOFX(tag(bal, 'DTASOF'))) || fim || null, itens,
    };
  });
}

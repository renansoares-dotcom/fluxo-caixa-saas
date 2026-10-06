// Leitura dos borderôs enviados pelos fundos (.htm da Contato/Vector, .pdf da FS/Negocial).
// Porta das regras de Sistema/FIDC/parse_all.py. Usado só para comparar a proposta
// aprovada na plataforma com o borderô que o fundo efetivamente operou.

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

const num = (s) => (s ? parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0 : 0);
const iso = (s) => (s ? s.split('/').reverse().join('-') : null);
const r2 = (v) => Math.round(v * 100) / 100;
function g(rx, t, def = 0, f = num) { const m = t.match(rx); return m ? f(m[1]) : def; }
const str = (s) => s;

// ---------------------------------------------------------------- texto
const MARCAS = { acute: '\u0301', grave: '\u0300', tilde: '\u0303', circ: '\u0302', uml: '\u0308', cedil: '\u0327' };
const NOMES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ordm: 'º', ordf: 'ª', deg: '°', ndash: '–', mdash: '—', laquo: '«', raquo: '»' };
function decodificarEntidades(t) {
  return t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([A-Za-z])(acute|grave|tilde|circ|uml|cedil);/g, (_, l, m) => (l + MARCAS[m]).normalize('NFC'))
    .replace(/&([a-z]+);/gi, (m, n) => NOMES[n.toLowerCase()] ?? m);
}

export function textoHtm(html) {
  let t = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<br[^>]*>|<\/p>|<\/tr>/gi, '\n').replace(/<\/td>/gi, ' | ').replace(/<[^>]+>/g, '');
  t = decodificarEntidades(t);
  return t.replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

// Reconstrói linhas a partir dos itens de texto do pdf.js (equivalente ao pdftotext -layout)
export async function textoPdfDoc(doc) {
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const linhas = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let l = linhas.find(l => Math.abs(l.y - y) < 2.5);
      if (!l) { l = { y, its: [] }; linhas.push(l); }
      l.its.push({ x, w: it.width || 0, s: it.str });
    }
    linhas.sort((a, b) => b.y - a.y);
    for (const l of linhas) {
      l.its.sort((a, b) => a.x - b.x);
      let s = '', fim = null;
      for (const it of l.its) {
        if (fim != null) s += it.x - fim > 12 ? '   ' : it.x - fim > 0.8 ? ' ' : '';
        s += it.s; fim = it.x + it.w;
      }
      out.push(s);
    }
    out.push('');
  }
  return out.join('\n');
}

let pdfjsP = null;
function carregarPdfjs() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  pdfjsP ??= new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(globalThis.pdfjsLib); };
    s.onerror = () => { pdfjsP = null; erro(new Error('não foi possível carregar o leitor de PDF')); };
    document.head.appendChild(s);
  });
  return pdfjsP;
}

// ---------------------------------------------------------------- parser
const dias = (a, b) => Math.round((Date.parse(iso(b)) - Date.parse(iso(a))) / 864e5);

export function parseBordero(t, fundo, arquivo = '') {
  const o = { fundo, arquivo, bordero: null, data: null, valor_face: 0, desagio: 0, ad_valorem: 0, tarifas: 0, iof: 0, encargos: 0, recompra: 0, desc_sacado: 0, liquido: 0, observacao: '' };
  let T = [];
  const F = fundo.toUpperCase();
  if (F.startsWith('FS')) {
    o.bordero = g(/Termo Aditivo n\.º\s*(\d+)/, t, null, str);
    o.data = g(/Operação[^\n]*?(\d\d\/\d\d\/\d{4})/, t, null, str) || g(/CREDITO REF\. OPERAÇÃO \S+ (\d\d\/\d\d\/\d{4})/, t, null, str);
    o.valor_face = g(/\(\+\) Face\s+R\$\s+([\d.,]+)/, t);
    o.desagio = g(/\(-\) Diferencial\s+R\$\s+([\d.,]+)/, t);
    o.ad_valorem = g(/\(-\) Ad-Valorem\s+R\$\s+([\d.,]+)/, t);
    o.tarifas = g(/\(-\) Despesas com Cobrança\s+R\$\s+([\d.,]+)/, t) + g(/\(-\) Outras Despesas\s+R\$\s+([\d.,]+)/, t);
    o.iof = g(/\(-\) Iof\s+R\$\s+([\d.,]+)/, t) + g(/\(-\) Iof Adicional\s+R\$\s+([\d.,]+)/, t);
    for (const m of t.matchAll(/^\s*(\S.*?)\s+R\$\s+([\d.,]+) D\s*$/gm)) {
      const h = m[1], v = num(m[2]), H = h.toUpperCase();
      if (/^(TOTAL|LÍQUIDO)/.test(H)) continue;
      const mr = h.match(/Nº\s*(\S+)/); const ref = mr ? ' ' + mr[1].replace(/-$/, '') : '';
      if (/^(CUSTAS|ASSINATURA|CONSULTA|ENVIO CARTORIO|SUST\. PROT|RENOVACAO)/.test(H)) o.tarifas += v;
      else if (/^(RECOMPRA|LIQUID|BAIXA|DIFERENCA LIQUID)/.test(H)) { o.recompra += v; o.observacao += ({ RECOMPRA: 'Recompra', LIQUID: 'Liquidação', BAIXA: 'Baixa', DIFERENCA: 'Dif. liquidação cartório' }[H.split(' ')[0].split('.')[0]] || 'Recompra') + ref + '; '; }
      else if (/^(PRORR|ALTER|JUROS)/.test(H)) { o.encargos += v; o.observacao += (H.startsWith('PRORR') ? 'Prorrogação' : H.startsWith('ALTER') ? 'Alteração vcto' : 'Juros/multa recompra') + ref + '; '; }
      else if (H.startsWith('DIFERENCA JUROS')) { o.encargos += v; o.observacao += 'Diferença de juros; '; }
      else if (H.startsWith('ABAT')) { o.desc_sacado += v; o.observacao += 'Abatimento ao sacado' + ref + '; '; }
      else { o.encargos += v; o.observacao += 'VERIFICAR: ' + h.slice(0, 40) + '; '; }
    }
    for (const m of t.matchAll(/^\s*(\S.*?)\s+R\$\s+([\d.,]+) C\s*$/gm)) {
      if (/^(CREDITO REF|TOTAL)/i.test(m[1])) continue;
      o.recompra -= num(m[2]); o.observacao += 'Crédito: ' + m[1].trim().slice(0, 30) + '; ';
    }
    o.liquido = g(/TOTAL DOS PAGAMENTOS REALIZADOS\s+R\$\s+([\d.,]+)/, t);
    for (const m of t.matchAll(/^\s*(\d+-\d+)\s+(\d\d\/\d\d\/\d{4})\s+([\d.,]+)\s+([\d./-]+)\s+(.+?)\s*$/gm))
      T.push({ titulo: m[1], venc: m[2], valor: num(m[3]), cnpj: m[4], sacado: m[5].trim() });
    const pmc = g(/Prazo M[ée]dio:\s*([\d.,]+)/, t, 0);
    if (pmc) o.prazo_cobrado = pmc;
  } else if (F.startsWith('NEGOCIAL')) {
    o.bordero = g(/Borderô Número:\s+(\d+)/, t, null, str);
    o.data = g(/Borderô Número:[\s\S]*?Data:\s+(\d\d\/\d\d\/\d{4})/, t, null, str);
    o.valor_face = g(/Valor total dos títulos\s+R\$\s+([\d.,]+)/, t);
    o.desagio = g(/Fator de compra\s+R\$\s+([\d.,]+)/, t);
    o.ad_valorem = g(/Comissão de Prestação de Serviço \(ad[\s\S]*?R\$\s+([\d.,]+)/, t);
    o.tarifas = g(/Despesas Bancárias\s+R\$\s+([\d.,]+)/, t);
    o.iof = g(/IOF retido[\s\S]*?R\$\s+([\d.,]+)/, t);
    o.recompra = g(/Recompra\s+R\$\s+([\d.,]+)/, t);
    o.desc_sacado = g(/Desconto concedido pelo Cedente ao[\s\S]*?R\$\s+([\d.,]+)/, t);
    if (o.desc_sacado) o.observacao += 'Desconto concedido pelo cedente ao sacado; ';
    o.liquido = g(/VALOR PAGO AO CEDENTE\s+R\$\s+([\d.,]+)/, t);
    for (const m of t.matchAll(/^\s*(\d[\d./-]*)\s+(\d\d\/\d\d\/\d{4})\s+([\d.,]+)\s+(.+?)\s*$/gm))
      T.push({ titulo: m[1], venc: m[2], valor: num(m[3]), cnpj: '', sacado: m[4].trim() });
  } else { // Contato / Vector (htm)
    o.bordero = g(/Bordero:\s*(\d+)/, t, null, str);
    o.data = g(/Data:\s*(\d\d\/\d\d\/\d{4})\s+Bordero/, t, null, str);
    if (/Valor de face dos títulos/.test(t)) {
      o.valor_face = g(/I\. Valor de face dos títulos-*\s*R\$\s*([\d.,]+)/, t);
      o.desagio = g(/II\. Custo\/Deságio-*\s*R\$\s*([\d.,]+)/, t);
      o.recompra = g(/IV\. Recompra\s*-*\s*R\$\s*([\d.,]+)/, t);
      o.liquido = g(/V\. Valor LiquidoFinal\/PAGO-*\s*R\$\s*([\d.,]+)/, t);
    } else {
      o.valor_face = g(/Valor\s*Total dos titulos:_*\s*R\$\s*([\d.,]+)/, t);
      o.desagio = g(/\(-\)Desagio:_*\s*R\$\s*([\d.,]+)/, t);
      o.recompra = g(/\(-\)Recompra:_*\s*R\$\s*([\d.,]+)/, t);
      o.desc_sacado = g(/Creditos\/Debitos:_*\s*R\s*\$\s*([\d.,]+)/, t);
      o.liquido = g(/DESEMBOLSO:_*\s*R\s*\$\s*([\d.,]+)/, t);
    }
    for (const m of t.matchAll(/^\s*(\d+) \| \w+ \| (\d+) \| (\S+) \| (\d\d\/\d\d\/\d{4}) \| ([\d.,]+) \| [\d,]+ \| \. \| (\d+)-(.+?) \|/gm))
      T.push({ titulo: m[3], venc: m[4], valor: num(m[5]), cnpj: m[6], sacado: m[7].trim(), prz: +m[2] });
  }
  if (!o.bordero || !o.data) throw new Error(`o arquivo não parece um borderô do ${fundo}`);
  // títulos repetidos (o anexo às vezes se repete entre páginas)
  const vistos = new Set();
  T = T.filter(x => { const k = `${x.titulo}|${x.venc}|${x.valor}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  const sv = T.reduce((s, x) => s + x.valor, 0);
  o.titulos = T.map(x => ({ titulo: x.titulo, vencimento: iso(x.venc), valor: x.valor, cnpj_sacado: x.cnpj || null, sacado: x.sacado, prazo: dias(o.data, x.venc), prz: x.prz }));
  o.qtd_titulos = T.length;
  o.prazo_medio = sv ? Math.round(o.titulos.reduce((s, x) => s + x.valor * x.prazo, 0) / sv * 10) / 10 : 0;
  if (o.prazo_cobrado == null) o.prazo_cobrado = sv && T.length && T.every(x => x.prz != null) ? Math.round(T.reduce((s, x) => s + x.valor * x.prz, 0) / sv * 10) / 10 : o.prazo_medio;
  o.titulos.forEach(x => delete x.prz);
  for (const k of ['desagio', 'tarifas', 'iof', 'encargos', 'recompra', 'desc_sacado']) o[k] = r2(o[k]);
  o.data = iso(o.data);
  o.observacao = o.observacao.trim() || null;
  o.custo = r2(o.desagio + o.ad_valorem + o.tarifas + o.iof + o.encargos);
  o.diferenca = r2(o.valor_face - o.custo - o.recompra - o.desc_sacado - o.liquido);
  return o;
}

// ---------------------------------------------------------------- entrada
export async function lerBordero(file, fundo) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  const ehPdf = /\.pdf$/i.test(file.name) || String.fromCharCode(...head) === '%PDF';
  let t;
  if (ehPdf) {
    const lib = await carregarPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    t = await textoPdfDoc(doc);
  } else {
    t = textoHtm(new TextDecoder('windows-1252').decode(buf));
  }
  return parseBordero(t, fundo, file.name);
}

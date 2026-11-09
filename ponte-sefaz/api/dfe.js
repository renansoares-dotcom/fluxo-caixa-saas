// Ponte SEFAZ (Vercel, Node.js, região gru1) — melhoria 9.1: NF-e de entrada direto da SEFAZ.
// Fala com o Ambiente Nacional da NF-e com o certificado A1 da empresa (TLS mútuo), o que o runtime do Supabase não faz:
//   • acao "distribuicao": NFeDistribuicaoDFe (por ultNSU ou por chave) → devolve os documentos já descompactados;
//   • acao "manifestar": RecepcaoEvento 4.00 (ciência 210210, confirmação 210200, desconhecimento 210220,
//     operação não realizada 210240), com o evento assinado (XMLDSig RSA-SHA1, C14N).
// Segurança: só atende POST com x-ponte-chave = PONTE_CHAVE; só fala com os hosts da SEFAZ do Ambiente Nacional;
// não guarda nada. Variáveis: PONTE_CHAVE, SEFAZ_PFX_B64 (certificado A1 em base64), SEFAZ_PFX_SENHA.
const https = require('node:https');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const NS = 'http://www.portalfiscal.inf.br/nfe';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const URLS = {
  distribuicao: { producao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx', homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx' },
  evento: { producao: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx', homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx' },
};
const EVENTOS = { 210200: 'Confirmacao da Operacao', 210210: 'Ciencia da Operacao', 210220: 'Desconhecimento da Operacao', 210240: 'Operacao nao Realizada' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const so = (s) => String(s ?? '').replace(/\D/g, '');
const tag = (xml, nome) => { const m = String(xml).match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`)); return m ? m[1] : null; };

function igual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- distribuição ----------
function xmlDistribuicao({ ambiente, cUF, cnpj, ultNSU, chave }) {
  const corpo = chave ? `<consChNFe><chNFe>${so(chave)}</chNFe></consChNFe>` : `<distNSU><ultNSU>${String(so(ultNSU) || '0').padStart(15, '0')}</ultNSU></distNSU>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">`
    + `<soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>`
    + `<distDFeInt xmlns="${NS}" versao="1.01"><tpAmb>${ambiente === 'producao' ? 1 : 2}</tpAmb><cUFAutor>${so(cUF)}</cUFAutor><CNPJ>${so(cnpj)}</CNPJ>${corpo}</distDFeInt>`
    + `</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
}

function lerDistribuicao(resposta) {
  const ret = tag(resposta, 'retDistDFeInt') || '';
  const docs = [];
  for (const m of ret.matchAll(/<(?:\w+:)?docZip\s+([^>]*)>([^<]+)<\/(?:\w+:)?docZip>/g)) {
    const at = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    let xml = null;
    try { xml = zlib.gunzipSync(Buffer.from(m[2].trim(), 'base64')).toString('utf8'); } catch { xml = null; }
    docs.push({ nsu: String(+at.NSU || 0), schema: String(at.schema || '').replace(/_v[\d.]+\.xsd$/, ''), xml });
  }
  return { cStat: tag(ret, 'cStat'), xMotivo: tag(ret, 'xMotivo'), ultNSU: String(+(tag(ret, 'ultNSU') || 0)), maxNSU: String(+(tag(ret, 'maxNSU') || 0)), docs };
}

// ---------- evento (manifestação) ----------
function infEvento({ ambiente, cnpj, chave, tipo, seq = 1, dhEvento, justificativa }) {
  const id = `ID${tipo}${so(chave)}${String(seq).padStart(2, '0')}`;
  const det = `<detEvento versao="1.00"><descEvento>${EVENTOS[tipo]}</descEvento>${tipo === 210240 || tipo === '210240' ? `<xJust>${esc(justificativa)}</xJust>` : ''}</detEvento>`;
  // forma canônica (C14N): o namespace herdado do <evento> vai declarado no próprio infEvento
  const c14n = `<infEvento xmlns="${NS}" Id="${id}"><cOrgao>91</cOrgao><tpAmb>${ambiente === 'producao' ? 1 : 2}</tpAmb><CNPJ>${so(cnpj)}</CNPJ><chNFe>${so(chave)}</chNFe>`
    + `<dhEvento>${dhEvento}</dhEvento><tpEvento>${tipo}</tpEvento><nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento>${det}</infEvento>`;
  return { id, c14n, xml: c14n.replace(` xmlns="${NS}"`, '') };
}

function assinar(inf, chavePem, certB64) {
  const digest = crypto.createHash('sha1').update(inf.c14n, 'utf8').digest('base64');
  const si = `<SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="${DS}rsa-sha1"></SignatureMethod>`
    + `<Reference URI="#${inf.id}"><Transforms><Transform Algorithm="${DS}enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms>`
    + `<DigestMethod Algorithm="${DS}sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const siC14n = si.replace('<SignedInfo>', `<SignedInfo xmlns="${DS}">`);
  const valor = crypto.createSign('RSA-SHA1').update(siC14n, 'utf8').sign(chavePem, 'base64');
  return { digest, siC14n, assinatura: `<Signature xmlns="${DS}">${si}<SignatureValue>${valor}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo></Signature>` };
}

function xmlEvento({ ambiente, cnpj, chave, tipo, justificativa, dhEvento, chavePem, certB64, lote }) {
  const inf = infEvento({ ambiente, cnpj, chave, tipo, dhEvento, justificativa });
  const { assinatura } = assinar(inf, chavePem, certB64);
  const env = `<envEvento xmlns="${NS}" versao="1.00"><idLote>${lote || Date.now()}</idLote><evento versao="1.00">${inf.xml}${assinatura}</evento></envEvento>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">`
    + `<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${env}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

function lerEvento(resposta) {
  const ret = tag(resposta, 'retEvento') || resposta;
  const lote = tag(resposta, 'retEnvEvento') || '';
  return { cStat: tag(ret, 'cStat') || tag(lote, 'cStat'), xMotivo: tag(ret, 'xMotivo') || tag(lote, 'xMotivo'), protocolo: tag(ret, 'nProt') };
}

// data/hora de Brasília (UTC−3) no formato da SEFAZ
const dhAgora = (d = new Date()) => new Date(d.getTime() - 3 * 36e5).toISOString().slice(0, 19) + '-03:00';

// ---------- certificado (só na Vercel: o node-forge lê o .pfx) ----------
let _cert = null;
function certificado() {
  if (_cert) return _cert;
  if (!process.env.SEFAZ_PFX_B64) throw new Error('certificado A1 não configurado (SEFAZ_PFX_B64)');
  const forge = require('node-forge');
  const der = forge.util.decode64(process.env.SEFAZ_PFX_B64);
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), process.env.SEFAZ_PFX_SENHA || '');
  const chave = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
  const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0].cert;
  _cert = {
    pfx: Buffer.from(der, 'binary'),
    chavePem: forge.pki.privateKeyToPem(chave),
    certB64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()),
    validade: cert.validity.notAfter.toISOString(),
  };
  return _cert;
}

function soap(url, acao, corpo, pfx) {
  return new Promise((ok, falha) => {
    const u = new URL(url);
    const req = https.request({ host: u.hostname, port: 443, path: u.pathname, method: 'POST', agent: false, servername: u.hostname,
      pfx, passphrase: process.env.SEFAZ_PFX_SENHA || '',
      headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${acao}"`, 'Content-Length': Buffer.byteLength(corpo) } }, (res) => {
      const partes = []; res.on('data', (c) => partes.push(c)); res.on('end', () => ok({ status: res.statusCode || 0, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('error', falha);
    req.setTimeout(45000, () => req.destroy(new Error('tempo esgotado (45 s)')));
    req.write(corpo); req.end();
  });
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ erro: 'use POST' })); }
  if (!process.env.PONTE_CHAVE || !igual(req.headers['x-ponte-chave'], process.env.PONTE_CHAVE)) { res.statusCode = 401; return res.end(JSON.stringify({ erro: 'não autorizado' })); }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  const ambiente = b?.ambiente === 'producao' ? 'producao' : 'homologacao';
  try {
    const c = certificado();
    if (b?.acao === 'distribuicao') {
      const r = await soap(URLS.distribuicao[ambiente], 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse', xmlDistribuicao({ ambiente, cUF: b.cUF, cnpj: b.cnpj, ultNSU: b.ultNSU, chave: b.chave }), c.pfx);
      if (r.status !== 200) return res.end(JSON.stringify({ ok: false, erro: `SEFAZ respondeu HTTP ${r.status}`, corpo: r.corpo.slice(0, 500) }));
      return res.end(JSON.stringify({ ok: true, validade_certificado: c.validade, ...lerDistribuicao(r.corpo) }));
    }
    if (b?.acao === 'manifestar') {
      const tipo = +b.tipo;
      if (!EVENTOS[tipo]) return res.end(JSON.stringify({ ok: false, erro: 'tipo de evento inválido' }));
      if (tipo === 210240 && String(b.justificativa || '').trim().length < 15) return res.end(JSON.stringify({ ok: false, erro: 'justificativa de 15 a 255 caracteres' }));
      const corpo = xmlEvento({ ambiente, cnpj: b.cnpj, chave: b.chave, tipo, justificativa: String(b.justificativa || '').slice(0, 255), dhEvento: dhAgora(), chavePem: c.chavePem, certB64: c.certB64 });
      const r = await soap(URLS.evento[ambiente], 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF', corpo, c.pfx);
      if (r.status !== 200) return res.end(JSON.stringify({ ok: false, erro: `SEFAZ respondeu HTTP ${r.status}`, corpo: r.corpo.slice(0, 500) }));
      return res.end(JSON.stringify({ ok: true, ...lerEvento(r.corpo) }));
    }
    if (b?.acao === 'certificado') return res.end(JSON.stringify({ ok: true, validade_certificado: c.validade }));
    res.end(JSON.stringify({ ok: false, erro: 'ação desconhecida' }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false, erro: String(e && e.message || e).replace(/https?:\/\/\S+/g, (u) => u.split('?')[0]) }));
  }
}

module.exports = handler;
module.exports.auxiliares = { xmlDistribuicao, lerDistribuicao, infEvento, assinar, xmlEvento, lerEvento, dhAgora, EVENTOS };

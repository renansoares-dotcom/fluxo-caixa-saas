// Ponte SEFAZ (melhoria 9.1): pedido de distribuição, leitura dos documentos compactados e o evento assinado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const { auxiliares: A } = require('../ponte-sefaz/api/dfe.js');
const CH = '26261111222333000144550010000123451000012340';

test('pedido de distribuição por NSU e por chave', () => {
  const x = A.xmlDistribuicao({ ambiente: 'producao', cUF: 26, cnpj: '11.222.333/0001-81', ultNSU: '1234' });
  assert.match(x, /<tpAmb>1<\/tpAmb><cUFAutor>26<\/cUFAutor><CNPJ>11222333000181<\/CNPJ><distNSU><ultNSU>000000000001234<\/ultNSU><\/distNSU>/);
  assert.match(A.xmlDistribuicao({ ambiente: 'homologacao', cUF: 26, cnpj: '1', chave: CH }), /<tpAmb>2<\/tpAmb>.*<consChNFe><chNFe>26261111222333000144550010000123451000012340<\/chNFe>/);
});

test('resposta da distribuição: documentos descompactados', () => {
  const doc = (x) => zlib.gzipSync(Buffer.from(x)).toString('base64');
  const resp = `<soap:Envelope><soap:Body><nfeDistDFeInteresseResponse><nfeDistDFeInteresseResult><retDistDFeInt versao="1.01" xmlns="http://www.portalfiscal.inf.br/nfe">
    <tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento localizado</xMotivo><ultNSU>000000000000012</ultNSU><maxNSU>000000000000015</maxNSU><loteDistDFeInt>
    <docZip NSU="000000000000011" schema="resNFe_v1.01.xsd">${doc('<resNFe><chNFe>' + CH + '</chNFe></resNFe>')}</docZip>
    <docZip NSU="000000000000012" schema="procNFe_v4.00.xsd">${doc('<nfeProc>XML</nfeProc>')}</docZip></loteDistDFeInt></retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`;
  const r = A.lerDistribuicao(resp);
  assert.deepEqual([r.cStat, r.ultNSU, r.maxNSU, r.docs.length], ['138', '12', '15', 2]);
  assert.deepEqual(r.docs.map(d => [d.nsu, d.schema]), [['11', 'resNFe'], ['12', 'procNFe']]);
  assert.match(r.docs[0].xml, /<chNFe>2626/);
  assert.equal(A.lerDistribuicao('<retDistDFeInt><cStat>137</cStat><ultNSU>000000000000015</ultNSU><maxNSU>000000000000015</maxNSU></retDistDFeInt>').docs.length, 0);
});

test('evento de manifestação assinado (digest e assinatura conferem)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const inf = A.infEvento({ ambiente: 'producao', cnpj: '11222333000181', chave: CH, tipo: 210210, dhEvento: '2026-11-08T10:00:00-03:00' });
  assert.equal(inf.id, 'ID210210' + CH + '01');
  assert.match(inf.c14n, /^<infEvento xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" Id="ID210210/);
  assert.match(inf.xml, /^<infEvento Id=/);
  assert.match(inf.xml, /<cOrgao>91<\/cOrgao><tpAmb>1<\/tpAmb>.*<descEvento>Ciencia da Operacao<\/descEvento>/);
  const s = A.assinar(inf, pem, 'CERT');
  assert.equal(s.digest, crypto.createHash('sha1').update(inf.c14n).digest('base64'));
  const valor = s.assinatura.match(/<SignatureValue>([^<]+)</)[1];
  assert.ok(crypto.createVerify('RSA-SHA1').update(s.siC14n).verify(publicKey, valor, 'base64'));
  assert.match(s.siC14n, /^<SignedInfo xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#"><CanonicalizationMethod Algorithm="[^"]+"><\/CanonicalizationMethod>/);
  const env = A.xmlEvento({ ambiente: 'homologacao', cnpj: '1', chave: CH, tipo: 210240, justificativa: 'Mercadoria não foi entregue & devolvida', dhEvento: 'x', chavePem: pem, certB64: 'C', lote: 7 });
  assert.match(env, /<idLote>7<\/idLote><evento versao="1\.00"><infEvento Id="ID210240/);
  assert.match(env, /<xJust>Mercadoria não foi entregue &amp; devolvida<\/xJust>/);
  assert.match(A.dhAgora(new Date('2026-11-08T13:00:00Z')), /^2026-11-08T10:00:00-03:00$/);
});

test('retorno do evento', () => {
  assert.deepEqual(A.lerEvento('<retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><nProt>891</nProt></infEvento></retEvento></retEnvEvento>'),
    { cStat: '135', xMotivo: 'Evento registrado', protocolo: '891' });
});

// MDF-e 3.00: o XML gerado a partir da ficha do frete passa nos esquemas oficiais (xmllint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarXMLMDFe, chaveMDFe, dvChave, dataHoraBR, tpTransp } from '../js/lib/mdfe-xml.js';
import { chaveValida } from '../js/lib/mdfe.js';

const XSD = join(dirname(fileURLToPath(import.meta.url)), 'xsd', 'mdfe-3.00b');
const temXmllint = spawnSync('xmllint', ['--version']).status === 0;
if (!temXmllint && process.env.CI) throw new Error('xmllint é obrigatório no CI');
const tmp = mkdtempSync(join(tmpdir(), 'mdfe-'));
// dados FICTÍCIOS
const chNFe = (n) => { const b = '26' + '2610' + '11222333000181' + '55' + '001' + String(n).padStart(9, '0') + '1' + '12345678'; return b + dvChave(b); };
const emp = { cnpj: '11222333000181', ie: '123456789', razao_social: 'EMPRESA TESTE LTDA' };
const ender = { xLgr: 'RUA DAS FLORES', nro: '100', xBairro: 'CENTRO', cMun: '2604106', xMun: 'CARUARU', CEP: '55000000', UF: 'PE', fone: '8133334444' };
const tac = { nome: 'JOSE DA SILVA', tipo: 'tac', documento: '52998224725', rntrc: '12345678' };
const base = (extra = {}) => ({ numero: 7, valor: 4500, ciot: '123456789012', mdfe_emissor: 'iplamm', pedagio_nao_ha: true,
  mdfe: { uf_ini: 'PE', uf_fim: 'BA', percurso: ['AL', 'SE'], carregamento: [{ cmun: '2604106', xmun: 'CARUARU', uf: 'PE' }],
    descarga: [{ cmun: '2927408', xmun: 'SALVADOR', uf: 'BA', chaves: [chNFe(101), chNFe(102)] }, { cmun: '2910800', xmun: 'FEIRA DE SANTANA', uf: 'BA', chaves: [chNFe(103)] }],
    veiculo: { placa: 'ABC1D23', renavam: '12345678901', tara: 8000, cap_kg: 25000, uf: 'PE', tp_rod: '03', tp_car: '02' },
    reboques: [{ placa: 'XYZ9A87', tara: 7000, cap_kg: 30000, uf: 'PE', tp_car: '02' }],
    prop: { tp_prop: '1' }, condutor: { nome: 'JOSE DA SILVA', cpf: '52998224725' },
    seguro: { resp: '1', nome: 'SEGURADORA TESTE', cnpj: '11444777000161', apolice: 'AP123', averbacoes: ['AV1'] },
    prod: { tp_carga: '05', nome: 'EMBALAGENS PLASTICAS', ncm: '39232190' }, peso_kg: 7000.5, valor_carga: 42000,
    ciot_resp: '11222333000181', pag: { forma: 'ipef', cnpj_ipef: '11444777000161', ind_pag: '0' }, info: 'Teste & <validação>', ...extra } });

function validar(xml) {
  const assinado = xml.replace('</MDFe>', '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>'
    + '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#x"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>'
    + '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAA</DigestValue></Reference></SignedInfo>'
    + '<SignatureValue>AAAA</SignatureValue><KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature></MDFe>');
  const a = join(tmp, 'mdfe.xml'), r = join(tmp, 'rodo.xml');
  writeFileSync(a, assinado);
  writeFileSync(r, '<?xml version="1.0" encoding="UTF-8"?>' + xml.match(/<rodo [\s\S]*<\/rodo>/)[0]);
  const v1 = spawnSync('xmllint', ['--noout', '--schema', join(XSD, 'mdfe_v3.00.xsd'), a], { encoding: 'utf8' });
  const v2 = spawnSync('xmllint', ['--noout', '--schema', join(XSD, 'mdfeModalRodoviario_v3.00.xsd'), r], { encoding: 'utf8' });
  return { ok: v1.status === 0 && v2.status === 0, erro: (v1.stderr + v2.stderr).trim() };
}

test('chave do MDF-e tem 44 dígitos e dígito certo', () => {
  const c = chaveMDFe({ uf: 'PE', dhEmi: '2026-11-23T08:00:00-03:00', cnpj: '11222333000181', serie: 1, nMDF: 15, cMDF: '00001234' });
  assert.equal(c.length, 44); assert.ok(chaveValida(c)); assert.equal(c.slice(0, 6), '262611'); assert.equal(c.slice(20, 22), '58');
  assert.match(dataHoraBR(new Date('2026-11-23T11:00:00Z')), /^2026-11-23T08:00:00-03:00$/);
  assert.equal(tpTransp(tac), 2); assert.equal(tpTransp({ tipo: 'etc' }), 1); assert.equal(tpTransp(null), null);
});

test('autônomo, IPEF, reboque, seguro, duas descargas: passa no esquema', { skip: !temXmllint && 'sem xmllint' }, () => {
  const { xml, chave } = gerarXMLMDFe(base(), tac, emp, ender, { tpAmb: 2, serie: 1, nMDF: 15, dhEmi: '2026-11-23T08:00:00-03:00' });
  assert.ok(chaveValida(chave)); assert.ok(xml.includes(`Id="MDFe${chave}"`)); assert.ok(xml.includes('<tpTransp>2</tpTransp>'));
  assert.ok(xml.includes('<infCIOT><CIOT>123456789012</CIOT><CNPJ>11222333000181</CNPJ></infCIOT>'));
  assert.ok(xml.includes('<qNFe>3</qNFe>')); assert.ok(xml.includes('Teste &amp; &lt;validação&gt;'));
  const v = validar(xml); assert.ok(v.ok, v.erro);
});

test('Pix a prazo com parcelas e vale-pedágio: passa no esquema', { skip: !temXmllint && 'sem xmllint' }, () => {
  const f = base({ pag: { forma: 'pix', pix: '52998224725', ind_pag: '1', prazos: [{ venc: '2026-12-01', valor: 2000 }, { venc: '2026-12-15', valor: 2500 }], comp: [{ tp: '01', valor: 300 }, { tp: '99', valor: 4200 }] },
    pedagio: { cnpj_forn: '11444777000161' } });
  Object.assign(f, { pedagio_nao_ha: false, pedagio_valor: 300, pedagio_comprovante: '998877' });
  const { xml } = gerarXMLMDFe(f, tac, emp, ender, { nMDF: 16 });
  assert.ok(xml.includes('<PIX>52998224725</PIX>')); assert.ok(xml.includes('<nParcela>002</nParcela>')); assert.ok(xml.includes('<valePed>'));
  const v = validar(xml); assert.ok(v.ok, v.erro);
});

test('frota própria (sem transportador): sem CIOT nem proprietário, passa no esquema', { skip: !temXmllint && 'sem xmllint' }, () => {
  const f = base({ reboques: [], seguro: { resp: '1' } }); f.ciot = null;
  const { xml } = gerarXMLMDFe(f, null, emp, ender, { nMDF: 17 });
  assert.ok(!xml.includes('<tpTransp>')); assert.ok(!xml.includes('<prop>')); assert.ok(!xml.includes('<infCIOT>'));
  const v = validar(xml); assert.ok(v.ok, v.erro);
});

test('XML com erro de estrutura é recusado pelo teste (o teste enxerga falhas)', { skip: !temXmllint && 'sem xmllint' }, () => {
  const { xml } = gerarXMLMDFe(base(), tac, emp, ender, { nMDF: 18 });
  assert.equal(validar(xml.replace(/<UFFim>BA<\/UFFim>/, '')).ok, false);
  assert.equal(validar(xml.replace(/<tpRod>03<\/tpRod>/, '')).ok, false);          // erro dentro do modal rodoviário
  assert.equal(validar(xml.replace('<CIOT>123456789012</CIOT>', '<CIOT>123</CIOT>')).ok, false);
});

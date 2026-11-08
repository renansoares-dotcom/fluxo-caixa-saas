import { test } from 'node:test';
import assert from 'node:assert/strict';
import { code128c, code128Barras, CODE128_PADROES, lerDanfe, fmtChave, fmtDoc, fmtNum, fmtCep } from '../js/lib/danfe.js';

const CHAVE = '26110812345678000195550010000182111000182118';

test('padrões do Code 128: 107 símbolos, 11 módulos (parada 13), sem repetição', () => {
  assert.equal(CODE128_PADROES.length, 107);
  CODE128_PADROES.slice(0, 106).forEach(p => assert.equal([...p].reduce((s, x) => s + +x, 0), 11));
  assert.equal([...CODE128_PADROES[106]].reduce((s, x) => s + +x, 0), 13);
  assert.equal(new Set(CODE128_PADROES).size, 107);
});

test('Code 128C da chave: mesmos símbolos e verificador de uma implementação de referência', () => {
  assert.deepEqual(code128c(CHAVE), [105, 26, 11, 8, 12, 34, 56, 78, 0, 1, 95, 55, 0, 10, 0, 1, 82, 11, 10, 0, 18, 21, 18, 94, 106]);
  const b = code128Barras(CHAVE);
  assert.equal(b.reduce((s, x) => s + x, 0), 25 * 11 + 2); // 24 símbolos de 11 + parada de 13
  assert.throws(() => code128c('123'));
  assert.throws(() => code128c('12a4'));
});

test('formatação', () => {
  assert.equal(fmtChave(CHAVE), '2611 0812 3456 7800 0195 5500 1000 0182 1110 0018 2118');
  assert.equal(fmtDoc('12345678000195'), '12.345.678/0001-95');
  assert.equal(fmtDoc('12345678909'), '123.456.789-09');
  assert.equal(fmtNum('18211'), '000.018.211');
  assert.equal(fmtCep('55000000'), '55000-000');
});

const XML = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
<ide><natOp>VENDA DE PRODUÇÃO</natOp><serie>1</serie><nNF>18211</nNF><dhEmi>2026-11-03T09:12:00-03:00</dhEmi><dhSaiEnt>2026-11-03T14:00:00-03:00</dhSaiEnt><tpNF>1</tpNF><tpAmb>1</tpAmb></ide>
<emit><CNPJ>12345678000195</CNPJ><xNome>PLASTICOS EXEMPLO LTDA</xNome><enderEmit><xLgr>Rua A</xLgr><nro>100</nro><xBairro>Distrito Industrial</xBairro><xMun>Caruaru</xMun><UF>PE</UF><CEP>55000000</CEP></enderEmit><IE>123456789</IE></emit>
<dest><CNPJ>98765432000110</CNPJ><xNome>MERCADO BOA VISTA &amp; CIA</xNome><enderDest><xLgr>Av. B</xLgr><nro>5</nro><xBairro>Centro</xBairro><xMun>Recife</xMun><UF>PE</UF><CEP>50000000</CEP></enderDest><IE>987654</IE></dest>
<det nItem="1"><prod><cProd>SAC-01</cProd><xProd>SACOLA 40X50</xProd><NCM>39232190</NCM><CFOP>5101</CFOP><uCom>KG</uCom><qCom>100.0000</qCom><vUnCom>12.3450</vUnCom><vProd>1234.50</vProd></prod>
<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1234.50</vBC><pICMS>18.00</pICMS><vICMS>222.21</vICMS></ICMS00></ICMS><IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>1234.50</vBC><pIPI>0.00</pIPI><vIPI>0.00</vIPI></IPITrib></IPI></imposto><infAdProd>Lote 7</infAdProd></det>
<det nItem="2"><prod><cProd>BOB-02</cProd><xProd>BOBINA</xProd><NCM>39201099</NCM><CFOP>5101</CFOP><uCom>KG</uCom><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10.00</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>
<total><ICMSTot><vBC>1234.50</vBC><vICMS>222.21</vICMS><vBCST>0</vBCST><vST>0</vST><vProd>1244.50</vProd><vFrete>0</vFrete><vSeg>0</vSeg><vDesc>0</vDesc><vIPI>0</vIPI><vOutro>0</vOutro><vNF>1244.50</vNF></ICMSTot></total>
<transp><modFrete>0</modFrete><transporta><xNome>TRANSPORTES EXEMPLO</xNome></transporta><vol><qVol>3</qVol><esp>FARDO</esp><pesoL>100.000</pesoL><pesoB>103.500</pesoB></vol></transp>
<cobr><dup><nDup>001</nDup><dVenc>2026-12-03</dVenc><vDup>622.25</vDup></dup><dup><nDup>002</nDup><dVenc>2027-01-03</dVenc><vDup>622.25</vDup></dup></cobr>
<infAdic><infCpl>Pedido 4521</infCpl></infAdic></infNFe></NFe><protNFe><infProt><tpAmb>1</tpAmb><chNFe>${CHAVE}</chNFe><dhRecbto>2026-11-03T09:13:05-03:00</dhRecbto><nProt>126260000123456</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;

test('leitura do XML para a DANFE', () => {
  const d = lerDanfe(XML);
  assert.equal(d.chave, CHAVE); assert.equal(d.numero, '18211'); assert.equal(d.natureza, 'VENDA DE PRODUÇÃO');
  assert.equal(d.dest.nome, 'MERCADO BOA VISTA & CIA'); assert.equal(d.emit.mun, 'Caruaru');
  assert.equal(d.itens.length, 2); assert.equal(d.itens[0].cst, '000'); assert.equal(d.itens[1].cst, '0102'); assert.equal(d.itens[0].vicms, 222.21); assert.equal(d.itens[0].info, 'Lote 7');
  assert.equal(d.dups.length, 2); assert.equal(d.tot.nf, 1244.5); assert.equal(d.transp.qvol, '3'); assert.equal(d.transp.pesoB, 103.5);
  assert.equal(d.protocolo, '126260000123456');
  assert.equal(lerDanfe('<x/>'), null);
});

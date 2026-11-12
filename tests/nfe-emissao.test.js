// Emissão de NF-e: cálculo dos itens e totais, parcelas, conferência, JSON da Focus, prévia do DANFE e leitura do grupo da Reforma Tributária.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcular, itemDaNatureza, aliquotaInterestadual, localDestino, parcelar, validar, payloadFocus, dadosDanfe, situacaoFocus, errosFocus } from '../js/lib/nfe-emissao.js';
import { lerDanfe } from '../js/lib/danfe.js';

const NAT = { cfop_interno: '5101', cfop_interestadual: '6101', icms_cst: '00', icms_aliquota_interna: 20.5, ipi_cst: '50', ipi_aliquota: 15, pis_cst: '01', pis_aliquota: 1.65, cofins_cst: '01', cofins_aliquota: 7.6, ibs_cbs_cst: '000', ibs_cbs_classificacao: '000001', cbs_aliquota: 0.9, ibs_uf_aliquota: 0.1, ibs_mun_aliquota: 0 };
const EMIT = { cnpj: '11.444.777/0001-61', razao_social: 'PLASTICOS EXEMPLO LTDA', ie: '123456789', logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Bezerros', uf: 'PE', cep: '55660-000' };
const DEST = { nome: 'CLIENTE EXEMPLO LTDA', documento: '06.990.590/0001-23', ie: '987654321', indicador_ie: 1, logradouro: 'Av B', numero: '200', bairro: 'Distrito', municipio: 'Fortaleza', uf: 'CE', cep: '60000-000' };
const item = (x = {}) => ({ ...itemDaNatureza({ codigo: 'F001', descricao: 'FILME PE', ncm: '3920.10.99', unidade: 'KG' }, NAT, { ufEmit: 'PE', ufDest: 'CE' }), quantidade: 1000, valor_unitario: 12.5, ...x });

test('alíquota interestadual e local de destino', () => {
  assert.equal(aliquotaInterestadual('PE', 'CE'), 12); assert.equal(aliquotaInterestadual('SP', 'PE'), 7); assert.equal(aliquotaInterestadual('SP', 'RJ'), 12); assert.equal(aliquotaInterestadual('PE', 'SP', '2'), 4);
  assert.deepEqual([localDestino('PE', 'PE'), localDestino('PE', 'CE'), localDestino('PE', 'EX')], [1, 2, 3]);
  const i = item(); assert.deepEqual([i.cfop, i.icms_aliquota, i.ncm], ['6101', 12, '39201099']);
  assert.equal(itemDaNatureza({}, NAT, { ufEmit: 'PE', ufDest: 'PE' }).icms_aliquota, 20.5);
});

test('cálculo: frete rateado, IPI, ICMS, PIS/COFINS sem ICMS e base do IBS/CBS', () => {
  const { itens, totais } = calcular([item(), item({ quantidade: 500, valor_unitario: 10, desconto: 50 })], { valor_frete: 350 }, { crt: 3 });
  assert.deepEqual([itens[0].frete, itens[1].frete], [250, 100]);
  assert.equal(itens[0].icms_base, 12750); assert.equal(itens[0].icms_valor, 1530); assert.equal(itens[0].ipi_valor, 1912.5);
  assert.equal(itens[0].pis_base, 11220); assert.equal(itens[0].pis_valor, 185.13); assert.equal(itens[0].cofins_valor, 852.72);
  assert.equal(itens[0].ibs_cbs_base, 10182.15); assert.equal(itens[0].cbs_valor, 91.64); assert.equal(itens[0].ibs_uf_valor, 10.18);
  assert.equal(totais.produtos, 17500); assert.equal(totais.desconto, 50); assert.equal(totais.nota, 17500 - 50 + 350 + totais.ipi);
  assert.equal(calcular([item()], { consumidor_final: true }, { crt: 3 }).itens[0].icms_base, 14375);
  assert.equal(calcular([item()], {}, { crt: 1 }).totais.icms, 0);
  assert.equal(calcular([item()], {}, { crt: 3, pis_cofins_exclui_icms: false }).itens[0].pis_base, 12500);
  assert.equal(calcular([item({ ibs_cbs_cst: '' })], {}, { crt: 3 }).totais.cbs, 0);
  assert.equal(calcular([item({ icms_reducao: 20 })], {}, { crt: 3 }).itens[0].icms_base, 10000);
});

test('parcelas: centavos na última', () => {
  const P = parcelar(1000, [28, 35, 42], '2026-11-12T10:00:00Z');
  assert.deepEqual(P.map(x => [x.numero, x.vencimento, x.valor]), [['001', '2026-12-10', 333.33], ['002', '2026-12-17', 333.33], ['003', '2026-12-24', 333.34]]);
  assert.deepEqual(parcelar(0, [30], '2026-11-12'), []);
});

const NOTA = { natureza_operacao: 'VENDA DE PRODUCAO', tipo_documento: 1, finalidade: 1, data_emissao: '2026-11-12T10:00:00-03:00', destinatario: DEST, itens: [item()], transporte: { modalidade: 0, nome: 'TRANSPORTES EXEMPLO', documento: '19131243000197', volumes: 12, especie: 'BOBINA', peso_bruto: 1020 }, valor_frete: 0, duplicatas: [], referenciadas: [] };
test('conferência antes de enviar', () => {
  assert.deepEqual(validar(NOTA, EMIT, { crt: 3 }), []);
  assert.ok(validar({ ...NOTA, itens: [item({ cfop: '5101' })] }, EMIT, { crt: 3 }).some(x => /CFOP 5101 não combina/.test(x)));
  assert.ok(validar({ ...NOTA, destinatario: { ...DEST, ie: '' } }, EMIT, {}).some(x => /inscrição estadual/.test(x)));
  assert.ok(validar({ ...NOTA, finalidade: 4 }, EMIT, {}).some(x => /chave/.test(x)));
  assert.ok(validar({ ...NOTA, itens: [item({ ncm: '39', ibs_cbs_classificacao: '1' })] }, EMIT, {}).length >= 2);
  assert.ok(validar({ ...NOTA, duplicatas: [{ numero: '001', vencimento: '2026-12-10', valor: 10 }] }, EMIT, { crt: 3 }).some(x => /duplicatas somam/.test(x)));
  assert.ok(validar(NOTA, { ...EMIT, bairro: '' }, {}).some(x => /Emitente: falta bairro/.test(x)));
  assert.ok(validar({ ...NOTA, itens: [] }, EMIT, {}).some(x => /ao menos um item/.test(x)));
});

test('JSON da Focus NFe', () => {
  const p = payloadFocus({ ...NOTA, duplicatas: parcelar(14375, [30, 60], '2026-11-12') }, EMIT, { crt: 3 });
  assert.equal(p.cnpj_emitente, '11444777000161'); assert.equal(p.cnpj_destinatario, '06990590000123'); assert.equal(p.local_destino, 2); assert.equal(p.regime_tributario_emitente, 3);
  assert.equal(p.valor_total, '14375.00'); assert.equal(p.items.length, 1);
  const i = p.items[0];
  assert.deepEqual([i.cfop, i.codigo_ncm, i.quantidade_comercial, i.valor_unitario_comercial, i.valor_bruto, i.icms_situacao_tributaria, i.icms_base_calculo, i.icms_valor, i.ipi_valor, i.pis_aliquota_porcentual],
    ['6101', '39201099', '1000.0000', '12.5', '12500.00', '00', '12500.00', '1500.00', '1875.00', '1.65']);
  assert.deepEqual([i.ibs_cbs_situacao_tributaria, i.ibs_cbs_classificacao_tributaria, i.ibs_cbs_base_calculo, i.cbs_aliquota, i.cbs_valor], ['000', '000001', '9982.50', '0.9000', '89.84']);
  assert.equal(p.duplicatas.length, 2); assert.equal(p.formas_pagamento[0].forma_pagamento, '15'); assert.equal(p.volumes[0].quantidade, 12); assert.equal(p.cnpj_transportador, '19131243000197');
  assert.equal(payloadFocus({ ...NOTA, destinatario: { ...DEST, documento: '123.456.789-09' } }, EMIT, {}).cpf_destinatario, '12345678909');
  assert.ok(!('icms_base_calculo' in payloadFocus(NOTA, EMIT, { crt: 1 }).items[0]));
  assert.equal(payloadFocus({ ...NOTA, finalidade: 4, referenciadas: ['3'.repeat(44)] }, EMIT, {}).notas_referenciadas[0].chave_nfe, '3'.repeat(44));
});

test('prévia do DANFE com o grupo da Reforma e retorno da Focus', () => {
  const d = dadosDanfe(NOTA, EMIT, { crt: 3 });
  assert.equal(d.crt, '3'); assert.equal(d.tot.nf, 14375); assert.deepEqual([d.totRtc.cbs, d.totRtc.ibsUF], [89.84, 9.98]);
  assert.deepEqual([d.itens[0].rtc.classTrib, d.itens[0].rtc.pCBS, d.itens[0].cst], ['000001', 0.9, '000']);
  assert.equal(dadosDanfe({ ...NOTA, itens: [item({ ibs_cbs_cst: '' })] }, EMIT, {}).totRtc, null);
  assert.equal(situacaoFocus({ status: 'autorizado' }), 'autorizada'); assert.equal(situacaoFocus({ status: 'erro_autorizacao' }), 'erro'); assert.equal(situacaoFocus({ codigo: 'requisicao_invalida' }), 'erro'); assert.equal(situacaoFocus({ status: 'processando_autorizacao' }), 'processando');
  assert.deepEqual(errosFocus({ status: 'erro_autorizacao', status_sefaz: '539', mensagem_sefaz: 'Duplicidade', erros: [{ campo: 'cfop', mensagem: 'inválido' }] }), ['539 - Duplicidade', 'cfop: inválido']);
});

test('DANFE NT 2026.010: lê CRT, totais e itens de IBS, CBS e IS do XML', () => {
  const xml = `<nfeProc><NFe><infNFe Id="NFe${'2'.repeat(44)}"><ide><nNF>10</nNF><serie>1</serie><tpNF>1</tpNF><natOp>VENDA</natOp><tpAmb>2</tpAmb><dhEmi>2026-12-01T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>11444777000161</CNPJ><xNome>EMITENTE</xNome><enderEmit><UF>PE</UF></enderEmit><IE>1</IE><CRT>3</CRT></emit><dest><CNPJ>06990590000123</CNPJ><xNome>DEST</xNome></dest>
    <det nItem="1"><prod><cProd>A</cProd><xProd>FILME</xProd><NCM>39201099</NCM><CFOP>6101</CFOP><uCom>KG</uCom><qCom>10</qCom><vUnCom>10</vUnCom><vProd>100.00</vProd></prod>
      <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>100.00</vBC><pICMS>12</pICMS><vICMS>12.00</vICMS></ICMS00></ICMS>
      <IS><CSTIS>000</CSTIS><vBCIS>100.00</vBCIS><pIS>1.0000</pIS><vIS>1.00</vIS></IS>
      <IBSCBS><CST>200</CST><cClassTrib>200001</cClassTrib><gIBSCBS><vBC>80.00</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><gRed><pRedAliq>60</pRedAliq><pAliqEfet>0.0400</pAliqEfet></gRed><vIBSUF>0.03</vIBSUF></gIBSUF>
        <gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.03</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>0.72</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>
    <total><ICMSTot><vBC>100.00</vBC><vICMS>12.00</vICMS><vProd>100.00</vProd><vNF>100.00</vNF></ICMSTot><ISTot><vIS>1.00</vIS></ISTot>
      <IBSCBSTot><vBCIBSCBS>80.00</vBCIBSCBS><gIBS><gIBSUF><vDif>0</vDif><vIBSUF>0.03</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.03</vIBS></gIBS><gCBS><vCBS>0.72</vCBS></gCBS></IBSCBSTot></total>
    <transp><modFrete>9</modFrete></transp></infNFe></NFe></nfeProc>`;
  const d = lerDanfe(xml);
  assert.equal(d.crt, '3');
  assert.deepEqual(d.totRtc, { cbs: 0.72, ibsUF: 0.03, ibsMun: 0, is: 1, ibsMono: null, cbsMono: null, ibsMonoRet: null, cbsMonoRet: null });
  assert.deepEqual(d.itens[0].rtc, { classTrib: '200001', cst: '200', bc: 80, pIBSUF: 0.04, vIBSUF: 0.03, pIBSMun: 0, vIBSMun: 0, pCBS: 0.9, vCBS: 0.72, bcIS: 100, pIS: 1, vIS: 1 });
  assert.equal(lerDanfe(xml.replace(/<IS>[\s\S]*?<\/IBSCBS>/, '').replace(/<ISTot>[\s\S]*?<\/IBSCBSTot>/, '')).itens[0].rtc, null);
});

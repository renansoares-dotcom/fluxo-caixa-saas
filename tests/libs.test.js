// Testes das bibliotecas puras (sem banco e sem tela). Rodar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnpjValido, cpfValido, analisaDocumento } from '../js/lib/documentos.js';
import { valorExtenso, numeroExtenso, dataExtenso, mesExtenso } from '../js/lib/extenso.js';
import { diasEntre, feriados, ehDiaUtil, proximoUtil } from '../js/lib/fidc-condicoes.js';
import { nesimoUtil, anteriorUtil, avos13 } from '../js/lib/rh.js';
import { tipoPeloDoc } from '../js/lib/fretes.js';
import { nfParcela } from '../js/lib/casamento.js';
import { lerOFX } from '../js/lib/ofx.js';
import { lerManual, mdParaHtml } from '../js/lib/markdown.js';

test('CNPJ e CPF: dígitos verificadores', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('111.111.111-11'), false, 'sequência repetida não vale');
  assert.deepEqual(analisaDocumento('11222333000181'), { tipo: 'PJ', valido: true, formatado: '11.222.333/0001-81' });
});

test('valores e datas por extenso (duplicata, termos)', () => {
  assert.equal(valorExtenso(1), 'um real');
  assert.equal(valorExtenso(1234.56), 'mil, duzentos e trinta e quatro reais e cinquenta e seis centavos');
  assert.equal(numeroExtenso(1000000), 'um milhão');
  assert.equal(dataExtenso('2026-10-29'), 'vinte e nove de outubro de dois mil e vinte e seis');
  assert.equal(mesExtenso('2026-10-29'), 'outubro');
});

test('feriados nacionais e dias úteis (FIDC, folha)', () => {
  const f = feriados(2026);
  for (const d of ['2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-06-04', '2026-11-02', '2026-11-20', '2026-12-25']) assert.ok(f.has(d), d);
  assert.equal(diasEntre('2026-10-01', '2026-11-01'), 31);
  assert.equal(ehDiaUtil('2026-11-02'), false, 'Finados');
  assert.equal(proximoUtil('2026-10-31'), '2026-11-03', 'sábado → pula domingo e Finados');
  assert.equal(nesimoUtil(2026, 11, 5), '2026-11-09', '5º dia útil de novembro/2026');
  assert.equal(anteriorUtil('2026-11-15'), '2026-11-13');
});

test('13º: avos pela admissão (15 dias no mês contam)', () => {
  assert.equal(avos13('2026-03-10', null, 2026), 10);
});

test('fretes: tipo do transportador pelo documento', () => {
  assert.equal(tipoPeloDoc('123.456.789-01'), 'tac');
  assert.equal(tipoPeloDoc('11222333000181'), 'etc');
});

test('nota e parcela a partir do texto do título', () => {
  assert.deepEqual(nfParcela('NF 1234/2'), { nf: 1234, parcela: 2, doc: '1234-2' });
  assert.deepEqual(nfParcela('DUP 000123-01'), { nf: 123, parcela: 1, doc: '123-1' });
});

test('extrato OFX: lançamentos, saldo e período', () => {
  const ofx = '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>001<ACCTID>12345</BANKACCTFROM><BANKTRANLIST>'
    + '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005<TRNAMT>-150.25<FITID>A1<MEMO>PAGTO BOLETO</STMTTRN>'
    + '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261006<TRNAMT>1000.00<FITID>A2<MEMO>TED RECEBIDA</STMTTRN>'
    + '</BANKTRANLIST><LEDGERBAL><BALAMT>849.75<DTASOF>20261006</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const [e] = lerOFX(ofx);
  assert.equal(e.banco, '001'); assert.equal(e.conta, '12345');
  assert.equal(e.inicio, '2026-10-05'); assert.equal(e.fim, '2026-10-06'); assert.equal(e.saldo, 849.75);
  assert.deepEqual(e.itens.map(i => [i.data, i.valor, i.descricao]), [['2026-10-05', -150.25, 'PAGTO BOLETO'], ['2026-10-06', 1000, 'TED RECEBIDA']]);
});

test('manuais: cabeçalho e lista numerada que continua depois da tabela', () => {
  const { dados, corpo } = lerManual('---\ntitulo: T\nversao: 1.2\n---\n## A\n\n1. um\n2. dois\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n3. tres\n');
  assert.deepEqual(dados, { titulo: 'T', versao: '1.2' });
  const h = mdParaHtml(corpo);
  assert.match(h, /<ol><li>um<\/li><li>dois<\/li><\/ol>/);
  assert.match(h, /<ol start="3"><li>tres<\/li><\/ol>/);
});

// Liquidação dos títulos cedidos: leitura do relatório de pagos da Negocial, casamento com a base FIDC e situação (dados fictícios).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/lib/fidc-liquidacoes.js';

const REL = `PAGOS - ANALÍTICO - EMPRESA EXEMPLO
  Duplicata   Cheque   Vencimento   Quitacao     Sacado            Cnpj Sacado          Valor de Face   Desc./Abat.   Valor Mora   Valor Pago     Tipo Liquidacao   Situacao     Bordero   Empresa   banco
  10001-001            01/09/2026   01/09/2026   CLIENTE ALFA LT   11.222.333/0001-81   R$ 1.000,00     R$ 0,00       R$ 0,00      R$ 1.000,00    NORMAL            Normal       700       FIDC      FIDC
  10002-002            02/09/2026   05/09/2026   CLIENTE BETA LT   22.333.444/0001-05   R$ 2.641,83     R$ 145,30     R$ 240,41    R$ 2.736,94    DEPÓSITO SACADO   Dep.Sacado   700       FIDC      FIDC
  10003-001            03/09/2026   20/09/2026   CLIENTE GAMA LT   33.444.555/0001-10   R$ 500,00       R$ 0,00       R$ 12,00     R$ 512,00      RECOMPRA          Recompra     701       FIDC      GRAF EXEMPLO
              000144   05/09/2026   05/09/2026   PESSOA EXEMPLO    123.456.789-09       R$ 300,00       R$ 0,00       R$ 0,00      R$ 300,00      NORMAL            Normal       1         FACTOR    FACTORING
Tipo Liquidação                 Valor Face         Mora           Desc./Abat.    Valor Pago
NORMAL                          R$ 1.300,00        R$ 0,00        R$ 0,00        R$ 1.300,00`;

test('lê o relatório de pagos da Negocial', () => {
  assert.ok(L.LEITORES.Negocial.reconhece(REL));
  const r = L.parseNegocial(REL);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map(x => x.tipo), ['normal', 'deposito_sacado', 'recompra', 'normal']);
  assert.deepEqual(r[1], { titulo: '10002-002', bordero: '700', vencimento: '2026-09-02', quitacao: '2026-09-05', sacado: 'CLIENTE BETA LT', cnpj_sacado: '22.333.444/0001-05',
    valor_face: 2641.83, desconto: 145.3, mora: 240.41, valor_pago: 2736.94, tipo_fundo: 'DEPÓSITO SACADO', tipo: 'deposito_sacado' });
  assert.equal(r[3].titulo, '000144');
  // texto montado pelo pdf.js no navegador vem com espaços simples
  assert.equal(L.parseNegocial(REL.replace(/ {2,}/g, ' ')).length, 4);
});

test('casa com a base FIDC por título e borderô', () => {
  const tit = [{ id: 't1', titulo: '10001-001', bordero: '700', valor: 1000 }, { id: 't2', titulo: '10002-2', bordero: '700', valor: 2600 }, { id: 't3', titulo: '10003-001', bordero: '701', valor: 500 }];
  const c = L.casar(L.parseNegocial(REL), tit);
  assert.deepEqual(c.linhas.map(l => l.fidc_titulo_id), ['t1', 't2', 't3', null]);
  assert.equal(c.semTitulo.length, 1);
  assert.equal(c.divergentes.length, 1);
  assert.equal(L.chaveTitulo('36479-001'), L.chaveTitulo('36479/1'));
});

test('situação do título cedido e coobrigação', () => {
  assert.equal(L.diasUteis('2026-10-23', '2026-10-28'), 3);   // sex → qua
  const hoje = '2026-10-30';
  const T = [
    { id: 'a', fundo: 'F1', vencimento: '2026-11-10', valor: 100 },
    { id: 'b', fundo: 'F1', vencimento: '2026-10-01', valor: 200 },
    { id: 'c', fundo: 'F1', vencimento: '2026-10-02', valor: 300 },
    { id: 'd', fundo: 'F1', vencimento: '2026-10-26', valor: 400 },
    { id: 'e', fundo: 'F1', vencimento: '2026-10-05', valor: 50 },
    { id: 'f', fundo: 'F2', vencimento: '2026-10-05', valor: 70 },
  ];
  const Lq = [{ fidc_titulo_id: 'b', fundo: 'F1', tipo: 'normal', quitacao: '2026-10-01' }, { fidc_titulo_id: 'c', fundo: 'F1', tipo: 'recompra', quitacao: '2026-10-27' }];
  const C = L.carteira(T, Lq, hoje);
  assert.deepEqual(C.itens.map(i => i.sit), ['a_vencer', 'liquidado', 'recomprado', 'aguardando', 'atrasado', 'sem_relatorio']);
  assert.equal(C.total.coobrigacao, 620);
  assert.equal(C.fundos.find(f => f.fundo === 'F1').cobertura, '2026-10-27');
  assert.equal(L.tipoDe('Liquidação por depósito'), 'deposito_sacado');
});

const CONT = `CONTATO FIDC                                                     CONTROLE FIDC
                                            Títulos Liquidados
Documento   Venc.   CPF/CNPJ          Sacado             Orig.        Encargos Desc.    Vlr.Pago Tp.    Dt Liqu      Tp de Baixa    C.S. Fl
EMPRESA EXEMPLO
10001-4     01/10/26 11222333000181   CLIENTE ALFA LTD    15,560.74       0.00   0.00   15,560.74   D   01/10/26     LIQ BANCO           31
                                                                                                                       BOLETO
10002-1     01/10/26 22333444000105   CLIENTE BETA LTD     3,111.00     103.70   0.00    3,214.70   D   05/10/26     LIQ BANCO           31
                                                                                                                       BOLETO
10003       26/10/26 33444555000110   CLIENTE GAMA LTD    39,370.00       0.00   0.00   39,370.00   D   20/10/26     BAIXA NAO         31
                                                                                                                     COMISSIONADO
NC9-15      26/05/26 11222333000999   EMPRESA EXEMPLO     30,000.00     487.23   0.00    5,000.00   D   21/10/26   PGTO BORDERO        31
                                                                                                                         TITULO
NC9-15      26/05/26 11222333000999   EMPRESA EXEMPLO     30,000.00     490.36   0.00    5,000.00   D   22/10/26   PGTO BORDERO        31
                                                                                                                         TITULO
                                                        118,041.74   1,081.29   0.00   68,145.44
Total                                                   118,041.74   1,081.29   0.00   68,145.44`;

test('lê o relatório de liquidados da Contato e casa sem borderô', () => {
  assert.ok(L.LEITORES.Contato.reconhece(CONT)); assert.ok(!L.LEITORES.Negocial.reconhece(CONT));
  const r = L.LEITORES.Contato.ler(CONT, { cnpjCedente: '11222333000999' });
  assert.equal(r.length, 5);
  assert.equal(r.reduce((s, x) => s + x.valor_pago, 0).toFixed(2), '68145.44');
  assert.deepEqual(r.map(x => x.tipo), ['normal', 'normal', 'recompra', 'recompra', 'recompra']);
  assert.deepEqual(r[1], { titulo: '10002-1', bordero: '', vencimento: '2026-10-01', quitacao: '2026-10-05', sacado: 'CLIENTE BETA LTD', cnpj_sacado: '22333444000105',
    valor_face: 3111, mora: 103.7, desconto: 0, valor_pago: 3214.7, tipo_fundo: 'LIQ BANCO BOLETO', tipo: 'normal' });
  assert.deepEqual(r.slice(3).map(x => x.bordero), ['pgto 21/10/2026', 'pgto 22/10/2026']);   // pagamentos parciais do acordo ficam separados
  const tit = [{ id: 'v', titulo: '10001-4', bordero: '400', data_operacao: '2026-08-14', valor: 15560.74 }, { id: 'n', titulo: '10001-4', bordero: '500', data_operacao: '2026-11-01', valor: 15560.74 },
    { id: 'g', titulo: '10003', bordero: '450', data_operacao: '2026-09-25', valor: 39370 }];
  const c = L.casar(r, tit);
  assert.deepEqual(c.linhas.map(l => l.fidc_titulo_id), ['v', null, 'g', null, null]);   // cessão mais recente antes do pagamento
});

// FS (GPA Factoring) — extrato por sacado, liquidados, analítico (dados fictícios no mesmo leiaute)
const FS = `FACTORING EXEMPLO LTDA.   Página 0001/0001
Extrato de Titulos - POR SACADO
Operações   : 000000 - 999999   Data Operações   : 09/07/2020 - 03/11/2026   Tipo de Operação : Todas   Situação   : Liquidados
Valor dos titulos: 0,00 - 999.999.999,99   Liquidação   : 01/01/2026 - 31/10/2026   Layout   : Analítico   Quebra de página : Não
Por Emissão Título   Ocorrências   Vcto   Dias Vlr Original   Vlr Abat   Vlr Atual   Cap Rec   Corr Rec Total Recdo Liquidação   Saldo Cap Dt Sal   %   Correção Total à Rec
SACADO: CLIENTE ALFA LTDA-11.222.333/0001-81
CEDENTE: 0001-EMPRESA EXEMPLO LTDA
001 08/12/25 20001-001   19/01/26 0   2.128,96   0,00   2.128,96   2.128,96   0,00   2.128,96 19/01/26   0,00   -   0,00   0,00   0,00
001 08/05/26 20002-002   CT   18/06/26 21   5.181,60   0,00   5.181,60   5.181,60   62,16   5.243,76 09/07/26   0,00   -   0,00   0,00   0,00
Total Liquidados [2] - SACADO ->   7.310,56   0,00   7.310,56   7.310,56   62,16   7.372,72   0,00   0,00   0,00
SACADO: CLIENTE BETA LTDA-22.333.444/0001-05
001 04/05/26 20003-001   25/05/26 -3   5.454,16   900,00   4.554,16   4.554,16   0,00   4.554,16 22/05/26   0,00   -   0,00   0,00   0,00
001 08/05/26 20004-001   BX ST   06/02/26 6   2.586,26   0,00   2.586,26   2.586,26   0,00   2.586,26 12/02/26   0,00   -   0,00   0,00   0,00
Total Liquidados [4] - GERAL ->   15.351,98   900,00   14.451,98   14.451,98   62,16   14.513,14   0,00   0,00   0,00`;

test('lê o extrato de liquidados da FS e casa pela data da operação', () => {
  assert.ok(L.LEITORES.FS.reconhece(FS)); assert.ok(!L.LEITORES.Negocial.reconhece(FS)); assert.ok(!L.LEITORES.Contato.reconhece(FS));
  const r = L.LEITORES.FS.ler(FS);
  assert.equal(r.length, 4);
  assert.deepEqual(r[1], { titulo: '20002-002', bordero: '', data_operacao: '2026-05-08', vencimento: '2026-06-18', quitacao: '2026-07-09', sacado: 'CLIENTE ALFA LTDA', cnpj_sacado: '11.222.333/0001-81',
    valor_face: 5181.6, desconto: 0, mora: 62.16, valor_pago: 5243.76, tipo_fundo: 'CT - Cartório', tipo: 'normal' });
  assert.equal(r[2].desconto, 900); assert.equal(r[2].sacado, 'CLIENTE BETA LTDA');
  assert.equal(r[3].tipo, 'outro'); assert.equal(r[3].tipo_fundo, 'BX - Baixado · ST - Sustado');
  assert.equal(Math.round(r.reduce((s, x) => s + x.valor_pago, 0) * 100) / 100, 14513.14);
  const c = L.casar([r[1]], [{ id: 'velho', titulo: '20002-002', bordero: '10', data_operacao: '2026-01-10', valor: 5181.6 }, { id: 'novo', titulo: '20002-002', bordero: '20', data_operacao: '2026-05-08', valor: 5181.6 }, { id: 'depois', titulo: '20002-002', bordero: '30', data_operacao: '2026-06-01', valor: 5181.6 }]);
  assert.equal(c.linhas[0].fidc_titulo_id, 'novo');
});

test('lê o relatório de liquidados da Vector (mesmo leiaute da Contato)', () => {
  const V = `VECTOR   Controle de Factoring
Títulos Liquidados
Documento Venc.   CPF/CNPJ   Sacado   Orig.   Encargos Desc.   Vlr.Pago Tp. Dt Liqu   Tp de Baixa   C.S. Fl
EMPRESA EXEMPLO
30001   25/08/26 11222333000181 CLIENTE ALFA LTD   55,388.20   0.00 0.00   55,388.20 D 25/08/26   LIQUIDACAO   20
COBRANCA
30002-1   01/10/26 22333444000105 CLIENTE BETA LTD   12,775.56   12.40 0.00   12,787.96 D 03/10/26   LIQUIDACAO   20
COBRANCA
68,163.76   12.40 0.00   68,176.16
Total   68,163.76   12.40 0.00   68,176.16`;
  assert.ok(L.LEITORES.Vector.reconhece(V)); assert.ok(!L.LEITORES.Contato.reconhece(V)); assert.ok(!L.LEITORES.FS.reconhece(V));
  const r = L.LEITORES.Vector.ler(V, {});
  assert.deepEqual(r.map(x => [x.titulo, x.quitacao, x.valor_face, x.mora, x.valor_pago, x.tipo, x.tipo_fundo]),
    [['30001', '2026-08-25', 55388.2, 0, 55388.2, 'normal', 'LIQUIDACAO COBRANCA'], ['30002-1', '2026-10-03', 12775.56, 12.4, 12787.96, 'normal', 'LIQUIDACAO COBRANCA']]);
});

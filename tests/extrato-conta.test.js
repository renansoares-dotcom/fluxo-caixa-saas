// Extrato da conta (Conferência do Dia › Extrato em PDF): saldo corrente, totais do dia e do período, período parcial e formatos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarExtrato, htmlExtrato } from '../js/lib/extrato-conta.js';

const L = (sinal, descricao, documento = '') => ({ sinal, descricao, documento });
// três dias de uma conta fictícia: 1.000,00 de saldo inicial
const cel = [
  { d: '2026-11-02', ini: 1000, ent: 500, sai: -200, fim: 1300, dl: [L(500, 'Recebimento NF 100', '100'), L(-200, 'Energia')] },
  { d: '2026-11-03', ini: 1300, ent: 0, sai: 0, fim: 1300, dl: [] },
  { d: '2026-11-04', ini: 1300, ent: 50.1, sai: -1500.3, fim: -150.2, dl: [L(-1500.3, 'Fornecedor A', '55'), L(50.1, 'Estorno tarifa')] },
];
const conta = { nome: 'Banco Fictício', instituicao: 'Banco X', agencia: '0001', numero: '12345-6' };

test('saldo corrente lançamento a lançamento e totais do período', () => {
  const e = montarExtrato(cel);
  assert.equal(e.saldoInicial, 1000); assert.equal(e.saldoFinal, -150.2);
  assert.equal(e.entradas, 550.1); assert.equal(e.saidas, -1700.3); assert.equal(e.qtd, 4);
  assert.deepEqual(e.dias[0].itens.map(i => i.saldo), [1500, 1300]);
  assert.deepEqual(e.dias[2].itens.map(i => i.saldo), [-200.3, -150.2]);
  assert.equal(e.dias[2].itens.at(-1).saldo, e.dias[2].fim);   // o último saldo do dia é o saldo final do dia
});

test('período parcial começa no saldo inicial do primeiro dia escolhido', () => {
  const e = montarExtrato(cel, { de: '2026-11-03', ate: '2026-11-04' });
  assert.equal(e.saldoInicial, 1300); assert.equal(e.saldoFinal, -150.2); assert.equal(e.dias.length, 2); assert.equal(e.qtd, 2);
  assert.equal(montarExtrato(cel, { de: '2026-12-01' }).dias.length, 0);
});

test('histórico vem da função da tela (favorecido, plano, documento)', () => {
  const e = montarExtrato(cel, { historico: (l) => ({ titulo: l.descricao.toUpperCase(), detalhe: 'plano', documento: l.documento }) });
  assert.deepEqual(e.dias[0].itens[0], { titulo: 'RECEBIMENTO NF 100', detalhe: 'plano', documento: '100', valor: 500, saldo: 1500 });
});

test('HTML detalhado: abre o dia com o saldo inicial e fecha com o total do dia; dia sem movimento só se pedido', () => {
  const e = montarExtrato(cel);
  const h = htmlExtrato(conta, e, { de: '2026-11-02', ate: '2026-11-04' });
  assert.match(h, /Banco Fictício/); assert.match(h, /ag\. 0001/); assert.match(h, /02\/11\/2026 a 04\/11\/2026/);
  assert.equal((h.match(/SALDO INICIAL DO DIA/g) || []).length, 2);
  assert.match(h, /Total do dia 02\/11: 2 lançamento\(s\)/);
  assert.match(h, /1\.300,00/); assert.match(h, /class="neg">-150,20/);
  assert.doesNotMatch(h, /SEM MOVIMENTO/);
  assert.match(htmlExtrato(conta, e, { de: '2026-11-02', ate: '2026-11-04', semMovimento: true }), /SEM MOVIMENTO — SALDO DO DIA/);
});

test('HTML resumido: uma linha por dia com saldo inicial, entradas, saídas e saldo final', () => {
  const e = montarExtrato(cel);
  const h = htmlExtrato(conta, e, { de: '2026-11-02', ate: '2026-11-04', detalhado: false });
  const linhas = h.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) || [];
  assert.equal(linhas.length, 2);   // sem o dia vazio
  assert.match(h, /Saldo inicial<\/th><th class="n">Entradas/);
  assert.equal((htmlExtrato(conta, e, { detalhado: false, semMovimento: true }).split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) || []).length, 3);
});

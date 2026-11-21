import test from 'node:test';
import assert from 'node:assert/strict';
import { numero, parametros, htmlPadrao, tabelaPadrao, numeroEmissao, dataBR } from '../js/lib/relatorio-padrao.js';

test('numero: milhar, vírgula e negativo com sinal de menos', () => {
  assert.equal(numero(1234567.891), '1.234.567,89');
  assert.equal(numero(-1500.5), '-1.500,50');
  assert.equal(numero(12.3456, 4), '12,3456');
  assert.equal(numero(1000, 0), '1.000');
  assert.equal(numero(null), ''); assert.equal(numero(''), '');
  assert.equal(numero(0), '0,00'); assert.equal(numero(0, 2, { zero: false }), '');
  assert.equal(numero(-0.001), '0,00');
});

test('parametros: filtro vazio aparece como "Todos"', () => {
  assert.deepEqual(parametros([['Local', ''], ['Produto', null], ['Tipo', []], ['CFOP', ['5.101', '6.101']], null, ['Mês', '10/2026']]),
    [['Local', 'Todos'], ['Produto', 'Todos'], ['Tipo', 'Todos'], ['CFOP', '5.101, 6.101'], ['Mês', '10/2026']]);
});

test('numeroEmissao e dataBR', () => { assert.equal(numeroEmissao(127), '000127'); assert.equal(dataBR('2026-10-05'), '05/10/2026'); assert.equal(dataBR(null), ''); });

const spec = { codigo: 'EST002-R01', nome: 'Kardex por produto', titulo: 'Kardex <b>', empresa: { nome: 'EMPRESA "X" LTDA.', cnpj: '00.000.000/0001-00' },
  emissao: { numero: 5, quando: new Date(2026, 10, 21, 9, 5), usuario: 'Renata Alves' }, fonte: 'Fonte: teste', registros: 2,
  parametros: [['Período', '01/10/2026 a 31/10/2026'], ['Local', ''], ['Nível', 'Analítico']], resumo: [['Movimentos', '2']],
  secoes: [{ titulo: 'Movimentos', tabela: { colunas: [{ t: 'Data' }, { t: 'Valor', n: 1 }], grupos: [{ titulo: 'P1', anterior: ['Saldo anterior', '1,00'], linhas: [['01/10/2026', '2,00']], subtotal: ['Total do produto', '3,00'] }], total: ['Total geral', '3,00'] } }] };

test('htmlPadrao: parâmetros, identificação, seções numeradas e sem cor', () => {
  const h = htmlPadrao(spec);
  assert.match(h, /Parâmetros do relatório/); assert.match(h, /<td class="k">Local<\/td><td class="v">Todos<\/td>/);
  assert.match(h, /Emissão nº 000005 · 21\/11\/2026 09:05 · Renata Alves/); assert.match(h, /EMPRESA \\"X\\" LTDA\./);
  assert.match(h, /<h2>1\. Movimentos<\/h2>/); assert.match(h, /Kardex &lt;b&gt;/);
  assert.match(h, /Fim do relatório · 2 registro\(s\) · EST002-R01 · emissão nº 000005/);
  assert.match(h, /Página " counter\(page\) " de " counter\(pages\)/);
  // só preto e cinza, sem fundo e sem imagem
  const cores = [...h.matchAll(/#([0-9a-f]{3,6})\b/gi)].map(m => m[1].toLowerCase());
  assert.ok(cores.length && cores.every(c => new Set(c).size === 1), 'só tons de cinza');
  assert.doesNotMatch(h, /background|<img/);
});

test('tabelaPadrao: grupo, saldo anterior, subtotal, total e colspan', () => {
  const t = tabelaPadrao({ colunas: [{ t: 'A' }, { t: 'B' }, { t: 'C', n: 1 }], linhas: [[{ v: 'x', span: 2 }, '1,00']], total: [{ v: 'Total', span: 2 }, '1,00'] });
  assert.match(t, /<td colspan="2" class="">x<\/td><td class="n">1,00<\/td>/); assert.match(t, /<tr class="tot">/);
  const g = tabelaPadrao(spec.secoes[0].tabela);
  assert.match(g, /<tr class="gr"><td colspan="2">P1<\/td><\/tr><tr class="sa">/); assert.match(g, /<tr class="st">/);
});

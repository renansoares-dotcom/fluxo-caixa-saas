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

// ---------------------------------------------------------------- fase 1
import { documentoPadrao, identificacao, linhaEmissao, linhasCabecalho, deslocarPlanilha, quadroParametros } from '../js/lib/relatorio-padrao.js';
import { rotuloLimpo, textoFicha, valorImpresso, assinatura } from '../js/lib/relatorio-filtros.js';
import { filtrarEmissoes, resumoEmissoes } from '../js/lib/relatorio-historico.js';

test('identificação e linha da emissão: com e sem código/número', () => {
  const q = new Date(2026, 10, 21, 9, 5);
  assert.equal(identificacao({ codigo: 'EST002-R01', nome: 'Kardex' }), 'EST002-R01 – Kardex'); assert.equal(identificacao({ codigo: '', nome: 'Kardex' }), 'Kardex');
  assert.equal(linhaEmissao({ numero: 7, quando: q, usuario: 'Renata' }), 'Emissão nº 000007 · 21/11/2026 09:05 · Renata');
  assert.equal(linhaEmissao({ numero: null, quando: q, usuario: 'Renata' }), 'Emitido em 21/11/2026 09:05 · Renata');
});

test('documentoPadrao: relatório leva parâmetros e fecho; documento não', () => {
  const base = { codigo: 'FIN009-R01', nome: 'Extrato', titulo: 'Extrato da conta', corpo: '<table><tr><td class="neg">-1,00</td></tr></table>', empresa: { nome: 'E', cnpj: '' },
    emissao: { numero: 3, quando: new Date(2026, 0, 2, 8, 0), usuario: 'U' }, parametros: [['Conta', ''], ['De', '01/01/2026']] };
  const r = documentoPadrao({ ...base, tipo: 'relatorio', rodape: 'Fonte: conferência' });
  assert.match(r, /Parâmetros do relatório/); assert.match(r, /<td class="k">Conta<\/td><td class="v">Todos<\/td>/); assert.match(r, /Fim do relatório · FIN009-R01 · emissão nº 000003/);
  assert.match(r, /@bottom-left\{content:"Fonte: conferência"/); assert.match(r, /color:#000 !important/); assert.doesNotMatch(r, /<img/);
  const d = documentoPadrao({ ...base, tipo: 'documento', rodape: 'Texto <b>longo</b> com marcação' });
  assert.doesNotMatch(d, /Parâmetros do relatório/); assert.doesNotMatch(d, /Fim do relatório/); assert.match(d, /<div class="nota">Texto <b>longo<\/b>/); assert.match(d, /@bottom-left\{content:""/);
  assert.equal(quadroParametros([]), '');
});

test('Excel: linhas do cabeçalho e deslocamento da folha', () => {
  const L = linhasCabecalho({ empresa: { nome: 'EMPRESA', cnpj: '1' }, codigo: 'EST002-R03', nome: 'Kardex – planilha', emissao: { numero: 9, quando: new Date(2026, 10, 21, 9, 5), usuario: 'R' }, parametros: [['Local', ''], ['Mês', '10/2026']] });
  assert.deepEqual(L, [['EMPRESA'], ['CNPJ 1'], ['EST002-R03 – Kardex – planilha'], ['Emissão nº 000009 · 21/11/2026 09:05 · R'], [], ['Parâmetros do relatório'], ['Local', 'Todos'], ['Mês', '10/2026'], []]);
  assert.equal(linhasCabecalho({ empresa: { nome: 'E' }, nome: 'X', emissao: { quando: new Date(), usuario: '' }, parametros: [] }).length, 4);
  const ws = { A1: { v: 'Data' }, B1: { v: 'Valor' }, A2: { v: 'x' }, AA10: { v: 1 }, '!ref': 'A1:AA10', '!merges': [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] };
  deslocarPlanilha(ws, 9);
  assert.equal(ws.A10.v, 'Data'); assert.equal(ws.B10.v, 'Valor'); assert.equal(ws.A11.v, 'x'); assert.equal(ws.AA19.v, 1); assert.equal(ws.A1, undefined);
  assert.equal(ws['!ref'], 'A1:AA19'); assert.deepEqual(ws['!merges'][0], { s: { r: 9, c: 0 }, e: { r: 9, c: 1 } });
});

test('filtros: rótulo, ficha, valor impresso e assinatura', () => {
  assert.equal(rotuloLimpo('  Local : '), 'Local'); assert.equal(textoFicha('Pendências das notas · 3'), 'Pendências das notas'); assert.equal(textoFicha('Abertos (12)'), 'Abertos');
  assert.equal(textoFicha('Saldo por local'), 'Saldo por local');
  assert.equal(valorImpresso('date', '2026-10-05'), '05/10/2026'); assert.equal(valorImpresso('month', '2026-10'), '10/2026'); assert.equal(valorImpresso('text', ' abc '), 'abc'); assert.equal(valorImpresso('date', ''), '');
  assert.equal(assinatura({ c: [{ k: '#a', t: 's', v: '1' }] }), assinatura({ c: [{ k: '#a', t: 'i', v: '1' }] }));
  assert.notEqual(assinatura({ c: [{ k: '#a', v: '1' }] }), assinatura({ c: [{ k: '#a', v: '2' }] }));
});

test('histórico: filtro e resumo', () => {
  const L = [{ numero: 3, codigo: 'EST002-R01', nome: 'Kardex', formato: 'pdf', usuario_nome: 'Ana', usuario_id: 'a', parametros: [['Local', 'Expedição']] },
    { numero: 2, codigo: 'EST002-R01', nome: 'Kardex', formato: 'xlsx', usuario_nome: 'Rui', usuario_id: 'r', parametros: [] },
    { numero: 1, codigo: 'FIS002-R01', nome: 'Apuração', formato: 'pdf', usuario_nome: 'Ana', usuario_id: 'a', parametros: [['Mês', '10/2026']] }];
  assert.equal(filtrarEmissoes(L, { formato: 'pdf' }).length, 2); assert.equal(filtrarEmissoes(L, { usuario: 'Rui' }).length, 1);
  assert.equal(filtrarEmissoes(L, { busca: 'expedicao' })[0].numero, 3); assert.equal(filtrarEmissoes(L, { codigo: 'FIS002-R01', busca: '10/2026' }).length, 1);
  assert.deepEqual(resumoEmissoes(L), { total: 3, pdf: 2, xlsx: 1, relatorios: 2, pessoas: 2, mais: { codigo: 'EST002-R01', nome: 'Kardex', n: 2 } });
  assert.equal(resumoEmissoes([]).mais, null);
});

import { numeroBR } from '../js/lib/relatorio-padrao.js';
test('numeroBR: só número puro vira número', () => {
  assert.equal(numeroBR('8.300,000'), 8300); assert.equal(numeroBR('-3,600'), -3.6); assert.equal(numeroBR('R$ 11,41'), 11.41); assert.equal(numeroBR('1.234.567,89'), 1234567.89);
  assert.equal(numeroBR('12'), 12); assert.equal(numeroBR('0,00'), 0); assert.equal(numeroBR('−5,5'), -5.5); assert.equal(numeroBR('R$ 1.000,00'), 1000);
  for (const t of ['', '–', '12,5%', '30/10/2026', 'MP-001', '3901.10.10', '1.2', 'abc', '10 it.']) assert.equal(numeroBR(t), null, t);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { codigoEtiqueta, expandir, cssEtiquetas, htmlEtiqueta, documentoEtiquetas, PADRAO } from '../js/lib/etiquetas.js';
import { reconhecer, detector } from '../js/lib/leitura.js';

test('código da etiqueta: lote e produto, sem diferenciar maiúscula', () => {
  assert.deepEqual(codigoEtiqueta('L0000123'), { codigo: 'L0000123', alvo: 'lote' });
  assert.deepEqual(codigoEtiqueta(' p0000456 '), { codigo: 'P0000456', alvo: 'produto' });
  for (const t of ['L123', 'X0000123', 'L00001A3', '', 'MP-001', '12345678']) assert.equal(codigoEtiqueta(t), null, t);
  assert.equal(reconhecer('l0000123').tipo, 'etiqueta'); assert.equal(reconhecer('L0000123').alvo, 'lote'); assert.equal(reconhecer('MP-001').tipo, 'desconhecido');
});

test('o leitor de etiqueta (8 caracteres rápidos) é reconhecido; digitação não', () => {
  const d = detector(); let t = 0;
  for (const ch of 'L0000123') { d.tecla(ch, t); t += 6; }
  assert.equal(d.fim(), 'L0000123');
  for (const ch of 'L0000123') { d.tecla(ch, t); t += 140; }
  assert.equal(d.fim(), null);
});

test('expandir: uma etiqueta por volume, numerada', () => {
  const L = expandir([{ etiqueta: 'L1', copias: 3 }, { etiqueta: 'L2', copias: 1 }, { etiqueta: 'L3', copias: 0 }, { etiqueta: 'L4', copias: 999 }]);
  assert.deepEqual(L.slice(0, 5).map(x => `${x.etiqueta}:${x.volume}`), ['L1:1/3', 'L1:2/3', 'L1:3/3', 'L2:', 'L3:']);
  assert.equal(L.filter(x => x.etiqueta === 'L4').length, 200);
});

test('etiqueta: conteúdo, tipo de código e tamanho da página', () => {
  const e = { etiqueta: 'L0000123', produto_codigo: 'MP-001', descricao: 'RESINA <PEBD>', lote: 'NF77310-1', lote_fornecedor: 'L2611', fornecedor: 'RESINAS', nota: '77310', data: '19/11/2026', peso: '25 kg', volume: '1/40' };
  const svg = { barras: '<svg id="b"></svg>', qr: '<svg id="q"></svg>' };
  const a = htmlEtiqueta(e, PADRAO, svg, 'EMPRESA');
  for (const t of ['EMPRESA', 'Vol. 1/40', 'MP-001', 'RESINA &lt;PEBD&gt;', 'Lote <b>NF77310-1</b>', 'lote do fornecedor L2611', 'NF 77310 · RESINAS · 19/11/2026', 'Conteúdo: <b>25 kg</b>', 'L0000123', 'id="b"', 'id="q"']) assert.ok(a.includes(t), t);
  const b = htmlEtiqueta(e, { ...PADRAO, codigo: 'barras', mostrar_fornecedor: false }, svg);
  assert.ok(b.includes('id="b"') && !b.includes('id="q"') && !b.includes('RESINAS'));
  const q = htmlEtiqueta({ ...e, lote: '', volume: '', peso: '' }, { ...PADRAO, codigo: 'qr' }, svg);
  assert.ok(!q.includes('id="b"') && q.includes('id="q"') && !q.includes('Lote <b>') && !q.includes('Vol.') && !q.includes('Conteúdo'));
  assert.match(cssEtiquetas({ largura_mm: 80, altura_mm: 40 }), /@page\{size:80mm 40mm;margin:0\}/);
  const doc = documentoEtiquetas(expandir([{ ...e, copias: 2 }]), PADRAO, { L0000123: svg }, 'EMPRESA');
  assert.equal(doc.split('class="etq"').length - 1, 2); assert.match(doc, /Etiquetas \(2\)/);
});

// ---------------------------------------------------------------- SQL 193: endereço de prateleira
import { estantes, codigosEndereco, porEndereco, htmlEndereco, cssEnderecos } from '../js/lib/etiquetas.js';
test('etiqueta de prateleira: E + 7 dígitos é endereço', () => {
  assert.deepEqual(codigoEtiqueta(' e0000789 '), { codigo: 'E0000789', alvo: 'endereco' });
  assert.equal(codigoEtiqueta('E123'), null);
});
test('estantes: intervalo de letras, de números e lista', () => {
  assert.deepEqual(estantes('a-d').lista, ['A', 'B', 'C', 'D']);
  assert.deepEqual(estantes('1-3').lista, ['1', '2', '3']);
  assert.deepEqual(estantes('01-03').lista, ['01', '02', '03']);
  assert.deepEqual(estantes('A-B, P; A').lista, ['A', 'B', 'P']);
  assert.ok(estantes('A-3').erro); assert.ok(estantes('F-A').erro); assert.ok(estantes('').erro); assert.ok(estantes('A_1').erro);
});
test('códigos gerados: a mesma regra do banco', () => {
  assert.deepEqual(codigosEndereco(['B', 'A'], 2, 2), ['A-01-1', 'A-01-2', 'A-02-1', 'A-02-2', 'B-01-1', 'B-01-2', 'B-02-1', 'B-02-2']);
  assert.deepEqual(codigosEndereco(['P'], 3, 0, 1), ['P-1', 'P-2', 'P-3']);
});
test('ordem do corredor: sem endereço vai para o fim', () => {
  const L = [{ descricao: 'ZINCO' }, { descricao: 'LUVA', endereco_ordem: 20 }, { descricao: 'ABRACADEIRA', endereco_ordem: 10 }, { descricao: 'ARRUELA' }];
  assert.deepEqual(L.sort(porEndereco).map(x => x.descricao), ['ABRACADEIRA', 'LUVA', 'ARRUELA', 'ZINCO']);
});
test('etiqueta de prateleira: endereço grande, local, número e tamanho próprio', () => {
  const h = htmlEndereco({ etiqueta: 'E0000789', codigo: 'A-03-2', local: 'Almoxarifado', descricao: '<luvas>' }, { codigo: 'barras' }, { barras: '<svg id="b"></svg>', qr: '<svg id="q"></svg>' }, 'IPLAMM');
  assert.match(h, /A-03-2/); assert.match(h, /class="loc">Almoxarifado</); assert.doesNotMatch(h, /IPLAMM/); assert.match(h, /E0000789/); assert.match(h, /&lt;luvas&gt;/);
  assert.match(h, /id="b"/); assert.doesNotMatch(h, /id="q"/);
  assert.match(cssEnderecos({ end_largura_mm: 80, end_altura_mm: 30 }), /@page\{size:80mm 30mm/);
});

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

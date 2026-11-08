import test from 'node:test';
import assert from 'node:assert/strict';
import { brcode, crc16, txt } from '../js/lib/pix.js';

test('CRC16-CCITT conhecido', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('texto sem acento e no tamanho', () => {
  assert.equal(txt('Indústria São João Ltda.', 25), 'INDUSTRIA SAO JOAO LTDA');
  assert.equal(txt('Bezerros-PE', 15), 'BEZERROSPE');
});

test('BR Code estático', () => {
  const c = brcode({ chave: '12345678000195', nome: 'Plásticos Exemplo Ltda', cidade: 'Caruaru', valor: 1234.5, txid: 'NF 18.211/1' });
  assert.ok(c.startsWith('000201'));
  assert.ok(c.includes('0014br.gov.bcb.pix011412345678000195'));
  assert.ok(c.includes('54071234.50'));
  assert.ok(c.includes('5802BR5922PLASTICOS EXEMPLO LTDA6007CARUARU'));
  assert.ok(c.includes('62120508NF182111'));
  assert.equal(c.slice(-8, -4), '6304');
  assert.equal(c.slice(-4), crc16(c.slice(0, -4)));
  assert.equal(c, '00020126360014br.gov.bcb.pix0114123456780001955204000053039865407' + '1234.505802BR5922PLASTICOS EXEMPLO LTDA6007CARUARU62120508NF182111' + '6304' + crc16(c.slice(0, -4)));
});

test('sem valor e sem identificador', () => {
  const c = brcode({ chave: 'financeiro@exemplo.com', nome: 'X', cidade: '' });
  assert.ok(!c.includes('5404'));
  assert.ok(c.includes('62070503***'));
  assert.ok(c.includes('6006BRASIL'));
  assert.throws(() => brcode({ nome: 'X' }));
});

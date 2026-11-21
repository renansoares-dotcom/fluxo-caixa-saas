import test from 'node:test';
import assert from 'node:assert/strict';
import { dvChave, chaveNFe, boleto, reconhecer, detector, chaveFormatada, cnpjFormatado } from '../js/lib/leitura.js';

const base = '26' + '2610' + '14677338000197' + '55' + '001' + '000012345' + '1' + '00012345';   // PE, 10/2026, CNPJ 14.677.338/0001-97, mod 55, série 1, nº 12345
const CH = base + dvChave(base);

test('chave da NF-e: dígito, partes e validação', () => {
  assert.equal(CH.length, 44);
  const k = chaveNFe(CH);
  assert.deepEqual({ uf: k.uf, ano: k.ano, mes: k.mes, cnpj: k.cnpj, modelo: k.modelo, documento: k.documento, serie: k.serie, numero: k.numero, valida: k.valida },
    { uf: 'PE', ano: 2026, mes: 10, cnpj: '14677338000197', modelo: 55, documento: 'NF-e', serie: '1', numero: 12345, valida: true });
  assert.equal(chaveNFe(CH.slice(0, 43) + ((+CH[43] + 1) % 10)).valida, false, 'dígito errado');
  assert.equal(chaveNFe('99' + CH.slice(2)).valida, false, 'UF inexistente');
  assert.equal(chaveNFe('123'), null);
  assert.equal(chaveFormatada(CH).split(' ').length, 11); assert.equal(cnpjFormatado('14677338000197'), '14.677.338/0001-97');
  // chave real de exemplo do Manual da NF-e (dígito 0 quando o resto é 0 ou 1)
  assert.equal(dvChave('5206043300991100250655012000000780026730161'), 5);
});

test('reconhecer: chave pura, com espaços, dentro do QR da NFC-e, boleto e lixo', () => {
  assert.equal(reconhecer(CH).tipo, 'nfe'); assert.equal(reconhecer(chaveFormatada(CH)).numero, 12345);
  assert.equal(reconhecer(`https://nfce.sefaz.pe.gov.br/nfce/consulta?p=${CH}|2|1|1|ABCDEF`).chave, CH);
  assert.equal(reconhecer('').tipo, 'vazio'); assert.equal(reconhecer('MP-001').tipo, 'desconhecido');
  const ruim = reconhecer(CH.slice(0, 43) + ((+CH[43] + 1) % 10)); assert.ok(['invalido', 'boleto'].includes(ruim.tipo));
  // boleto: banco 341, moeda 9, valor 1.250,00
  const corpo = '3419' + '1049' + '0000125000' + '1090000012345678901234567';   // sem o dígito geral (posição 5)
  let s = 0, p = 2; for (let i = corpo.length - 1; i >= 0; i--) { s += +corpo[i] * p; p = p === 9 ? 2 : p + 1; }
  let dv = 11 - (s % 11); if ([0, 10, 11].includes(dv)) dv = 1;
  const cod = corpo.slice(0, 4) + dv + corpo.slice(4);
  const b = reconhecer(cod); assert.equal(b.tipo, 'boleto'); assert.equal(b.banco, '341'); assert.equal(b.valor, 1250);
  assert.equal(boleto(cod).valida, true);
  assert.equal(reconhecer('34191.09008 00001.234561 78901.234567 1 10490000125000').tipo, 'boleto');   // linha digitável (47)
  assert.equal(reconhecer('8'.padEnd(44, '1')).tipo, 'boleto');
});

test('detector: leitor (rápido) × pessoa digitando (devagar)', () => {
  const d = detector(); let t = 1000;
  for (const ch of CH) { d.tecla(ch, t); t += 8; }
  assert.equal(d.fim(), CH); assert.equal(d.pendente(), 0);
  for (const ch of CH) { d.tecla(ch, t); t += 180; }   // pessoa digitando a chave
  assert.equal(d.fim(), null);
  for (const ch of '12345') { d.tecla(ch, t); t += 5; }   // rápido, mas curto
  assert.equal(d.fim(), null);
  d.tecla('9', t); t += 400; for (const ch of CH) { d.tecla(ch, t); t += 10; }   // tecla solta antes: a pausa zera
  assert.equal(d.fim(), CH);
});

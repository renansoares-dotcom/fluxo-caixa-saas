// Códigos de tela (js/lib/telas.js): toda tela do menu tem código, os códigos são únicos e no formato AAA000.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TELAS, codigoDa, rotaDoCodigo, grafia } from '../js/lib/telas.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rotasMenu = [...html.matchAll(/data-route="([^"]+)"/g)].map(m => m[1]);

test('toda tela do menu tem código', () => {
  const sem = rotasMenu.filter(r => !codigoDa(r));
  assert.deepEqual(sem, [], 'telas sem código: ' + sem.join(', '));
});
test('códigos únicos e no formato AAA000', () => {
  const c = Object.values(TELAS);
  assert.equal(new Set(c).size, c.length);
  for (const x of c) assert.match(x, /^[A-Z]{3}\d{3}$/);
});
test('busca pelo código aceita variações', () => {
  assert.equal(rotaDoCodigo('FIN019'), 'fidc-carteira');
  assert.equal(rotaDoCodigo('fin19'), 'fidc-carteira');
  assert.equal(rotaDoCodigo('cad-003'), 'cadastros/favorecidos');
  assert.equal(rotaDoCodigo('XYZ001'), null);
});
test('grafia: conectivos em minúscula, menos a primeira palavra', () => {
  assert.equal(grafia('Contas A Pagar / Receber'), 'Contas a Pagar / Receber');
  assert.equal(grafia('De-para De Fornecedores'), 'De-para de Fornecedores');
});
test('menu sem conectivo em maiúscula', () => {
  const nomes = [...html.matchAll(/data-route="[^"]+"[^>]*>([^<]+)</g)].map(m => m[1].trim());
  const ruins = nomes.filter(n => grafia(n) !== n);
  assert.deepEqual(ruins, []);
});

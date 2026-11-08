import test from 'node:test';
import assert from 'node:assert/strict';
import { limpar, numero, mensagem, previa } from '../js/lib/whatsapp.js';

test('limpar: sem quebra, sem vazio, até 1024', () => {
  assert.equal(limpar('a\nb\tc'), 'a · b · c');
  assert.equal(limpar(''), '-');
  assert.equal(limpar(null), '-');
  assert.equal(limpar('x'.repeat(2000)).length, 1024);
  assert.equal(limpar('a      b'), 'a   b');
});

test('numero: 55 + DDD', () => {
  assert.equal(numero('(81) 99876-5432'), '5581998765432');
  assert.equal(numero('+55 81 3721-0000'), '558137210000');
  assert.equal(numero('081 99876 5432'), '5581998765432');
  assert.equal(numero('123'), null);
});

test('mensagem: modelo, campos na ordem e botão de link', () => {
  const m = mensagem({ template: 'pedido_entregue', parametros: ['empresa', 'nota'], botao_campo: 'caminho' }, { empresa: 'IPLAMM', nota: 7001, caminho: 'portal.html?aba=entregas' }, '5581998765432');
  assert.equal(m.template.name, 'pedido_entregue');
  assert.equal(m.template.language.code, 'pt_BR');
  assert.deepEqual(m.template.components[0].parameters.map(p => p.text), ['IPLAMM', '7001']);
  assert.equal(m.template.components[1].parameters[0].text, 'portal.html?aba=entregas');
  const s = mensagem({ template: 'teste_plataforma', parametros: [] }, {}, '5581998765432');
  assert.equal(s.template.components, undefined);
});

test('previa', () => {
  assert.equal(previa('Olá {{2}}, de {{1}}', ['empresa', 'nome'], { empresa: 'IPLAMM', nome: 'Ana' }), 'Olá Ana, de IPLAMM');
});

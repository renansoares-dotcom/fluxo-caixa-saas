// E-mail: troca dos campos, linhas vazias, link com o endereço da plataforma, escape do HTML e versão em texto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montar, trocar } from '../js/lib/email.js';

const M = { assunto: 'Arte nº {{numero}} — {{arte}}', corpo: 'Olá,\n\nA versão {{versao}} está pronta.\n\n{{observacao}}\n\nResponda até {{prazo}}.', botao: 'Conferir a arte' };
test('campos, parágrafos vazios e link', () => {
  const e = montar(M, { numero: 41, arte: 'Biscoito <Maria>', versao: 2, observacao: '', prazo: '09/11/2026', caminho: 'portal.html?arte=x', empresa: 'IPLAMM' }, { url_base: 'https://exemplo.com/app', rodape: 'Rodapé' });
  assert.equal(e.assunto, 'Arte nº 41 — Biscoito <Maria>');
  assert.equal(e.link, 'https://exemplo.com/app/portal.html?arte=x');
  assert.match(e.html, /Biscoito|versão 2/);
  assert.equal((e.html.match(/<p style="margin:0 0 14px">/g) || []).length, 3);   // a observação vazia some
  assert.match(e.html, /href="https:\/\/exemplo.com\/app\/portal.html\?arte=x"/);
  assert.match(e.texto, /Conferir a arte: https:\/\/exemplo.com\/app\/portal.html\?arte=x/);
  assert.doesNotMatch(montar({ assunto: 'x', corpo: '{{a}}' }, { a: '<script>' }).html, /<script>/);
});
test('trocar', () => {
  assert.equal(trocar('{{a}} e {{ b }} e {{c}}', { a: 1, b: 'dois' }), '1 e dois e ');
});

test('relatório agendado: tabelas no corpo, escapadas, com total e link', () => {
  const tabs = [{ titulo: 'Saldo <das contas>', periodo: 'hoje (11/11/2026)', colunas: ['conta', 'saldo'], linhas: [['BANCO A', 'R$ 1.250,00'], ['<script>', 'R$ 0,00']], total: 'R$ 1.250,00', link: '#/fluxo-diario', rotulo: 'Fluxo de Caixa Diário' },
    { titulo: 'Bloco ruim', erro: 'Fonte desconhecida' }];
  const e = montar({ assunto: '{{titulo}}', corpo: 'Segue.' }, { titulo: 'Caixa', tabelas: tabs }, { url_base: 'https://x.com/app' });
  assert.match(e.html, /Saldo &lt;das contas&gt;/); assert.match(e.html, /&lt;script&gt;/); assert.doesNotMatch(e.html, /<script>/);
  assert.match(e.html, /Total<\/td><td[^>]*>R\$ 1\.250,00/); assert.match(e.html, /https:\/\/x\.com\/app\/index\.html#\/fluxo-diario/);
  assert.match(e.html, /Não foi possível montar este bloco: Fonte desconhecida/);
  assert.match(e.texto, /Saldo <das contas> — hoje \(11\/11\/2026\)\n  BANCO A: R\$ 1\.250,00/);
  assert.equal(montar({ assunto: 'a', corpo: 'b' }, {}, {}).html.includes('<h3'), false);
});

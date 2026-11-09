import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { secoes, trecho, secaoDaTela, videoEmbed, passosVisiveis } from '../js/lib/ajuda.js';
import { lerManual } from '../js/lib/markdown.js';
const corpo = (id) => lerManual(readFileSync(new URL(`../tutoriais/${id}.md`, import.meta.url), 'utf8')).corpo;

test('seções e trecho', () => {
  const md = '## 1. A\nx\n### 1.1 B\ny\n## 2. C\nz\n## 3. Histórico de alterações\n';
  assert.equal(secoes(md).length, 4);
  assert.equal(trecho(md, secoes(md)[0]), '## 1. A\nx\n### 1.1 B\ny');
  assert.equal(trecho(md, secoes(md)[1]), '### 1.1 B\ny');
});

test('seção da tela pelos manuais de verdade', () => {
  const nf = corpo('notas-fiscais');
  assert.match(secaoDaTela(nf, { titulo: 'Apuração de Impostos' }).texto, /^6\. Apuração de Impostos/);
  assert.match(secaoDaTela(nf, { prefixo: '### 6.5' }).texto, /^6\.5 Imposto a recolher/);
  const pt = corpo('portal-sst');
  assert.match(secaoDaTela(pt, { titulo: 'SST e Treinamentos' }).texto, /^5\. SST e treinamentos/);
  assert.match(secaoDaTela(pt, { titulo: 'Meu Portal' }).texto, /^4\. Meu Portal/);
  assert.match(secaoDaTela(corpo('folha-completa'), { titulo: 'Rescisões' }).texto, /^6\. Rescisões/);
  assert.match(secaoDaTela(nf, { titulo: 'Tela inexistente' }).texto, /^1\. Para que serve/);
});

test('vídeo e passos', () => {
  assert.deepEqual(videoEmbed('https://youtu.be/dQw4w9WgXcQ'), { tipo: 'youtube', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
  assert.equal(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3').tipo, 'youtube');
  assert.equal(videoEmbed('https://drive.google.com/file/d/1AbC_d/view').src, 'https://drive.google.com/file/d/1AbC_d/preview');
  assert.equal(videoEmbed('http://x.com'), null); assert.equal(videoEmbed('https://vimeo.com/1').tipo, 'link');
  const els = { a: { hidden: false, offsetParent: {} }, b: { hidden: true, offsetParent: {} }, c: { hidden: false, offsetParent: null } };
  assert.deepEqual(passosVisiveis([{ alvo: 'a' }, { alvo: 'b' }, { alvo: 'c' }, { alvo: 'd' }], (s) => els[s]).map(p => p.alvo), ['a']);
});

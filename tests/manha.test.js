import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disponiveis, padrao, aplicar, mover, nomeTabela, fraseMudanca, textoDesde } from '../js/lib/manha-blocos.js';

const so = (lista) => lista.filter(x => x.on).map(x => x.k);
test('blocos por papel e área', () => {
  assert.deepEqual(disponiveis('compras').map(b => b.k), ['aprovacoes', 'mudou', 'ontem', 'atalhos']);
  assert.ok(!disponiveis('financeiro', (a) => a !== 'fin').some(b => b.k === 'situacao'), 'sem área financeira, sem situação do dia');
  assert.deepEqual(so(padrao('diretor')), ['diretoria', 'aprovacoes', 'ontem', 'mudou', 'situacao', 'alertas']);
  assert.ok(padrao('diretor').some(x => x.k === 'atalhos' && !x.on), 'disponível, desligado');
  assert.deepEqual(so(padrao('producao')), ['ontem', 'mudou', 'aprovacoes', 'atalhos']);
});
test('preferência salva com o que está disponível', () => {
  const salvo = [{ k: 'atalhos', on: true }, { k: 'situacao', on: true }, { k: 'mudou', on: false }, { k: 'atalhos', on: false }];
  const r = aplicar(salvo, 'compras');
  assert.deepEqual(r.map(x => x.k), ['atalhos', 'mudou', 'aprovacoes', 'ontem'], 'situação sumiu; duplicado sai; novos no fim');
  assert.deepEqual(so(r), ['atalhos']);
  assert.deepEqual(so(aplicar(null, 'compras')), so(padrao('compras')));
});
test('mover e textos', () => {
  const l = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
  assert.deepEqual(mover(l, 2, -1).map(x => x.k), ['a', 'c', 'b']);
  assert.equal(mover(l, 0, -1), l);
  assert.equal(nomeTabela('prod_ordens'), 'Ordens de produção');
  assert.equal(nomeTabela('xyz_abc'), 'Xyz abc');
  assert.equal(fraseMudanca({ incluiu: 3, alterou: 1, excluiu: 0, pessoas: 2 }), '3 inclusões, 1 alteração · 2 pessoas');
  const agora = new Date('2026-11-07T12:00:00-03:00');
  assert.equal(textoDesde('2026-11-07T08:05:00-03:00', agora), 'desde hoje às 08:05');
  assert.equal(textoDesde('2026-11-06T18:40:00-03:00', agora), 'desde ontem às 18:40');
  assert.equal(textoDesde('2026-11-03T09:12:00-03:00', agora), 'desde 03/11 às 09:12');
});

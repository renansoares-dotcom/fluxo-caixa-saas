import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arvore, caminho, subarvore, totaisArvore } from '../js/lib/centros.js';
const L = [{ id: 'p', nome: 'PROD', codigo: '2' }, { id: 'a', nome: 'ADM', codigo: '1' }, { id: 't', nome: 'TI', pai_id: 'a', codigo: '1.1' }, { id: 's', nome: 'SUPORTE', pai_id: 't' },
  { id: 'e', nome: 'EXTRUSÃO', pai_id: 'p' }, { id: 'i', nome: 'IMPRESSÃO', pai_id: 'p' }];
test('árvore, caminho e subárvore', () => {
  assert.deepEqual(arvore(L).map(c => c.id + c.prof), ['a0', 't1', 's2', 'p0', 'e1', 'i1']);
  assert.equal(caminho('s', new Map(L.map(c => [c.id, c]))), 'ADM › TI › SUPORTE');
  assert.deepEqual([...subarvore('a', L)].sort(), ['a', 's', 't']);
});
test('totais por nível com rateio', () => {
  const T = totaisArvore([{ cc_id: 't', despesas: 1000, rateio_enviado: 0 }, { cc_id: 's', despesas: 500 }, { cc_id: 'a', rateio_enviado: 1500 }, { cc_id: 'e', receitas: 10000, despesas: 2000, rateio_recebido: 900 },
    { cc_id: 'i', rateio_recebido: 600 }, { cc_id: null, receitas: 50, despesas: 20 }], L);
  const n = (id) => T.nos.find(x => x.id === id);
  assert.equal(n('a').total.resultado, 0);          // 1500 de despesas da subárvore saíram por rateio
  assert.equal(n('t').total.despesas, 1500);
  assert.equal(n('p').total.resultado, 10000 - 2000 - 1500);
  assert.equal(n('e').proprio.resultado, 7100);
  assert.equal(T.geral.resultado, 6500); assert.equal(T.semCentro.resultado, 30);
});

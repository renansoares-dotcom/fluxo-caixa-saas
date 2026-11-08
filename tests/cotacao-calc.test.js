import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParcelas, valorPresente, mapaCotacoes } from '../js/lib/cotacao-calc.js';
test('parcelas e valor presente', () => {
  assert.deepEqual(parseParcelas('28/42/56'), [28, 42, 56]); assert.deepEqual(parseParcelas('à vista'), [0]); assert.deepEqual(parseParcelas(''), []);
  assert.equal(valorPresente(1000, [0], 2), 1000);
  assert.equal(valorPresente(1000, [30], 2), 980.39);
  assert.equal(valorPresente(1000, [30, 60], 0), 1000);
});
test('mapa comparativo: menor por item, total, valor presente e dividir', () => {
  const itens = [{ id: 'i1', quantidade: 10 }, { id: 'i2', quantidade: 2 }];
  const cots = [{ id: 'a', fornecedor: 'A', frete: 50, parcelas_dias: [0], prazo_entrega_dias: 5 }, { id: 'b', fornecedor: 'B', frete: 0, parcelas_dias: [60], prazo_entrega_dias: 10 }, { id: 'c', fornecedor: 'C', frete: 0 }];
  const ci = [{ cotacao_id: 'a', requisicao_item_id: 'i1', valor_unitario: 10 }, { cotacao_id: 'a', requisicao_item_id: 'i2', valor_unitario: 100 },
    { cotacao_id: 'b', requisicao_item_id: 'i1', valor_unitario: 12 }, { cotacao_id: 'b', requisicao_item_id: 'i2', valor_unitario: 90 }, { cotacao_id: 'c', requisicao_item_id: 'i1', valor_unitario: 9 }];
  const M = mapaCotacoes(itens, cots, ci, { taxa: 2 });
  assert.deepEqual(M.linhas[0].idxMin, [2]); assert.equal(M.linhas[1].min, 90);
  assert.deepEqual(M.cots.map(c => c.total), [350, 300, 90]); assert.equal(M.cots[2].completa, false);
  assert.equal(M.melhorTotal.id, 'b'); assert.equal(M.melhorVP.id, 'b');
  assert.equal(M.cots[1].vp, 288.35);
  assert.equal(M.porItem, 270); assert.equal(M.economiaDividir, 30);
});

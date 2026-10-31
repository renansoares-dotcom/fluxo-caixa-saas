// Estoque parametrizado: regra por CFOP, custo médio ponderado móvel, resumo por local e período aberto (dados fictícios).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../js/lib/estoque-kardex.js';

test('regra por CFOP: completo vence o final; família vence o geral; inativa não conta', () => {
  const R = [
    { id: 'geral', cfop: '101', sentido: 'entrada', prioridade: 100 },
    { id: 'res', cfop: '101', sentido: 'entrada', familia_id: 'F-RES', prioridade: 100 },
    { id: 'cheio', cfop: '2101', sentido: 'entrada', prioridade: 100 },
    { id: 'off', cfop: '1101', sentido: 'entrada', ativo: false },
    { id: 'venda', cfop: '101', sentido: 'saida' },
  ];
  assert.equal(K.regraCfop(R, { cfop: '1101', sentido: 'entrada' }).id, 'geral');
  assert.equal(K.regraCfop(R, { cfop: '1101', sentido: 'entrada', familia_id: 'F-RES' }).id, 'res');
  assert.equal(K.regraCfop(R, { cfop: '2.101', sentido: 'entrada', familia_id: 'F-RES' }).id, 'cheio');
  assert.equal(K.regraCfop(R, { cfop: '5101', sentido: 'saida' }).id, 'venda');
  assert.equal(K.regraCfop(R, { cfop: '5949', sentido: 'saida' }), null);
});

test('custo médio ponderado móvel em ordem cronológica (igual ao banco)', () => {
  const r = K.custoMedio([
    { data: '2026-11-03', quantidade: -100, afeta_custo: false },
    { data: '2026-10-01', quantidade: 1000, custo_unitario: 8, afeta_custo: true },
    { data: '2026-10-05', quantidade: 500, custo_unitario: 11, afeta_custo: true },
    { data: '2026-10-06', quantidade: -300, afeta_custo: false },
    { data: '2026-10-09', quantidade: 300, custo_unitario: 9, afeta_custo: false, estorno: true },
    { data: '2026-11-02', quantidade: 1500, custo_unitario: 13, afeta_custo: true },
  ]);
  assert.deepEqual(r.linhas.map(l => l.valor), [8000, 5500, -2700, 2700, 19500, -1100]);
  assert.equal(r.quantidade, 2900); assert.equal(r.valor, 31900); assert.equal(r.custo_medio, 11);
  const t = K.custoMedio([{ data: '2026-10-01', quantidade: 10, custo_unitario: 5, afeta_custo: true }, { data: '2026-10-02', quantidade: 4, custo_unitario: 99, afeta_custo: true, compoe_custo: false }]);
  assert.equal(t.custo_medio, 5);
});

test('resumo por local e período aberto', () => {
  const L = [{ id: 'a', ordem: 2, compoe_custo: true }, { id: 'b', ordem: 1, compoe_custo: false }];
  const r = K.resumoLocais([{ local_id: 'a', quantidade: 10, valor: 100.1 }, { local_id: 'a', quantidade: 0, valor: 0 }, { local_id: 'b', quantidade: 5, valor: 50 }], L);
  assert.deepEqual(r.linhas.map(x => [x.local.id, x.itens, x.valor]), [['b', 1, 50], ['a', 1, 100.1]]);
  assert.equal(r.total, 100.1);
  assert.deepEqual(K.periodoAberto([{ mes: '2026-09-01' }, { mes: '2026-10-01' }]), { fechadoAte: '2026-10-01', abertoDesde: '2026-11-01' });
  assert.deepEqual(K.periodoAberto([]), { fechadoAte: null, abertoDesde: null });
});

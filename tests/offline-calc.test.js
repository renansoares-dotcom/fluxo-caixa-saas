import test from 'node:test';
import assert from 'node:assert/strict';
import { ehRede, chaveLeitura, tabelaDa, filtrosDa, mesclar, passa } from '../js/lib/offline-calc.js';

const U = 'https://x.supabase.co/rest/v1/prod_apontamentos?select=*&empresa_id=eq.E1&fim=is.null&maquina_id=in.(m1,m2)';

test('erro de rede × erro do servidor', () => {
  assert.equal(ehRede({ message: 'TypeError: Failed to fetch' }), true);
  assert.equal(ehRede({ message: 'x' }, 0), true);
  assert.equal(ehRede({ message: 'Sem permissão.' }, 400), false);
});

test('chave da leitura ignora a hora e a ordem dos parâmetros', () => {
  const a = chaveLeitura('https://x/rest/v1/tin_ordens?criado_em=gte.2026-11-08T10:00:00.000Z&empresa_id=eq.E');
  const b = chaveLeitura('https://x/rest/v1/tin_ordens?empresa_id=eq.E&criado_em=gte.2026-11-09T11:30:00.123Z');
  assert.equal(a, b);
  assert.equal(tabelaDa(U), 'prod_apontamentos');
  assert.deepEqual(filtrosDa(U).map(f => f[0]), ['empresa_id', 'fim', 'maquina_id']);
});

test('filtros: eq, is, in, not, gte', () => {
  const l = { a: 1, b: null, c: 'x', d: '2026-11-08' };
  assert.ok(passa(l, [['a', 'eq.1'], ['b', 'is.null'], ['c', 'in.(x,y)'], ['d', 'gte.2026-11-01']]));
  assert.ok(!passa(l, [['b', 'not.is.null']]));
  assert.ok(!passa(l, [['c', 'neq.x']]));
});

test('mesclar: inclusão entra, alteração aplica e sai do filtro', () => {
  const guardado = [{ id: 'ap1', empresa_id: 'E1', fim: null, maquina_id: 'm1' }];
  const fila = [{ ops: [
    { t: 'insert', tabela: 'prod_apontamentos', valores: { id: 'ap2', empresa_id: 'E1', fim: null, maquina_id: 'm2' } },
    { t: 'update', tabela: 'prod_apontamentos', id: 'ap1', valores: { fim: '2026-11-08T10:00:00Z' } },
    { t: 'insert', tabela: 'prod_paradas', valores: { id: 'pp1' } }] }];
  const r = mesclar(guardado, 'prod_apontamentos', filtrosDa(U), fila);
  assert.deepEqual(r.map(x => x.id), ['ap2']);
  assert.equal(r[0]._offline, true);
});

test('mesclar: sombra da pesagem aparece na leitura', () => {
  const fila = [{ ops: [{ t: 'rpc', nome: 'tin_pesar', sombra: { tabela: 'tin_pesagens', valores: { id: 'k1', ordem_id: 'o1', pesada: 2 } } }] }];
  const r = mesclar([], 'tin_pesagens', [['ordem_id', 'eq.o1']], fila);
  assert.equal(r.length, 1);
  assert.equal(mesclar([], 'tin_pesagens', [['ordem_id', 'eq.o2']], fila).length, 0);
});

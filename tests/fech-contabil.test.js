import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pares, arquivoDominio, resumoSugestoes } from '../js/lib/fech-contabil.js';

test('pares débito × crédito', () => {
  assert.deepEqual(pares([{ conta_id: 'a', debito: 100, credito: 0 }, { conta_id: 'b', debito: 0, credito: 100 }]), [{ debito: 'a', credito: 'b', valor: 100 }]);
  assert.deepEqual(pares([{ conta_id: 'a', debito: 70, credito: 0 }, { conta_id: 'b', debito: 30, credito: 0 }, { conta_id: 'c', debito: 0, credito: 50 }, { conta_id: 'd', debito: 0, credito: 50 }]),
    [{ debito: 'a', credito: 'c', valor: 50 }, { debito: 'a', credito: 'd', valor: 20 }, { debito: 'b', credito: 'd', valor: 30 }]);
});

test('arquivo do Domínio pelo leiaute', () => {
  const contas = new Map([['a', { codigo: 101, classificacao: '1.1.01' }], ['b', { codigo: 202, classificacao: '2.1.01' }]]);
  const L = [{ id: 2, data: '2026-10-31', historico: 'Provisão; 13º\nout', origem: 'folha', partidas: [{ conta_id: 'a', debito: 416.67, credito: 0 }, { conta_id: 'b', debito: 0, credito: 416.67 }] },
    { id: 1, data: '2026-10-05', historico: 'Pagto', origem: 'financeiro', partidas: [{ conta_id: 'b', debito: 10, credito: 0 }, { conta_id: 'x', debito: 0, credito: 10 }] }];
  const A = arquivoDominio(L, contas, { dom_historico_codigo: '999' });
  assert.equal(A.texto, '05/10/2026;202;;10,00;999;Pagto\r\n31/10/2026;101;202;416,67;999;Provisão  13º out\r\n');
  assert.deepEqual(A.semConta, ['x']); assert.equal(A.linhas, 2);
  const B = arquivoDominio(L, contas, { dom_separador: '|', dom_data: 'aaaa-mm-dd', dom_decimal: '.', dom_conta: 'classificacao', dom_campos: ['data', 'debito', 'credito', 'valor'], dom_cabecalho: true, dom_origens: ['folha'] });
  assert.equal(B.texto, 'Data|Conta débito|Conta crédito|Valor\r\n2026-10-31|1.1.01|2.1.01|416.67\r\n');
});

test('resumo das sugestões', () => {
  const R = resumoSugestoes([{ valor: 100, gerado: true, valor_gerado: 90 }, { valor: 50, gerado: false }, { valor: null, aviso: 'x' }]);
  assert.deepEqual(R, { total: 150, gerados: 1, pendentes: 1, avisos: 1, divergentes: 1 });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disponiveis, validar, dadosDe, PADRAO, mover, CARTAO } from '../js/lib/paineis-cartoes.js';

test('cartões por área e papel', () => {
  assert.ok(disponiveis(() => true, 'compras').every(c => c.area !== 'dir'), 'compras não vê o Painel da Diretoria');
  assert.ok(!disponiveis((a) => a !== 'fin', 'financeiro').some(c => c.area === 'fin'), 'sem a área financeira');
  assert.ok(disponiveis(() => true, 'diretor').some(c => c.t === 'resumo_diretoria'));
});
test('validar a lista salva', () => {
  const v = validar([{ t: 'kpi_saldo', tam: 9 }, { t: 'nao_existe' }, { t: 'ind_diretoria', tam: 1, cfg: { k: 'perdas' } }, { t: 'ind_diretoria' }, null], () => true, 'admin');
  assert.deepEqual(v, [{ t: 'kpi_saldo', tam: 1 }, { t: 'ind_diretoria', tam: 1, cfg: { k: 'perdas' } }, { t: 'ind_diretoria', tam: 1, cfg: { k: 'faturamento' } }]);
  assert.deepEqual(validar({}), []);
  assert.equal(validar(PADRAO).length, PADRAO.length, 'o padrão é válido');
});
test('dados e ordem', () => {
  assert.deepEqual(dadosDe([{ t: 'kpi_saldo' }, { t: 'tab_saldos' }, { t: 'graf_producao' }, { t: 'graf_necessidade' }]), ['fin', 'dir', 'nec']);
  assert.deepEqual(mover([1, 2, 3].map(x => ({ x })), 0, 1).map(o => o.x), [2, 1, 3]);
  assert.ok(Object.keys(CARTAO).length >= 16);
});

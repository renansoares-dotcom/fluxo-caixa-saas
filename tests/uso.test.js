import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarTexto, rotaLimpa, fmtTempo, perfisResumo, telasSemUso, taxaDesistencia, periodo } from '../js/lib/uso-calc.js';

test('normaliza títulos e mensagens sem números', () => {
  assert.equal(normalizarTexto('Editar PA nº 21'), normalizarTexto('Editar PA nº 4.512'));
  assert.equal(normalizarTexto('Valor 1.234,56 acima de 10/11/2026'), 'Valor # acima de #');
  assert.equal(normalizarTexto('  Novo   lançamento '), 'Novo lançamento');
  assert.equal(normalizarTexto('x'.repeat(300)).length, 160);
});
test('rota sem query', () => {
  assert.equal(rotaLimpa('#/auditoria?aba=alertas'), 'auditoria');
  assert.equal(rotaLimpa('compras/pedidos'), 'compras/pedidos');
  assert.equal(rotaLimpa(''), 'hoje');
});
test('formata o tempo', () => {
  assert.equal(fmtTempo(45), '45 s');
  assert.equal(fmtTempo(720), '12 min');
  assert.equal(fmtTempo(3600 * 3 + 300), '3 h 05');
  assert.equal(fmtTempo(3600 * 2 + 3590), '3 h');
  assert.equal(fmtTempo(-5), '0 s');
});
test('perfil × tela: fatia do tempo e ordem', () => {
  const r = perfisResumo([
    { papel: 'financeiro', rota: 'lancamentos', acessos: 10, segundos: 600 },
    { papel: 'financeiro', rota: 'conciliacao', acessos: 5, segundos: 400 },
    { papel: 'compras', rota: 'paraquedas', acessos: 3, segundos: 90 }]);
  assert.equal(r[0].papel, 'financeiro');
  assert.equal(r[0].segundos, 1000);
  assert.deepEqual(r[0].telas.map(t => [t.rota, t.fatia]), [['lancamentos', 60], ['conciliacao', 40]]);
  assert.equal(perfisResumo([{ papel: 'x', rota: 'a', segundos: 1 }, { papel: 'x', rota: 'b', segundos: 2 }], 1)[0].telas.length, 1);
});
test('telas sem uso e desistência', () => {
  assert.deepEqual(telasSemUso([{ rota: 'a' }, { rota: 'b' }], [{ rota: 'a' }]), [{ rota: 'b' }]);
  assert.equal(taxaDesistencia({ abertos: 8, abandonos: 2 }), 25);
  assert.equal(taxaDesistencia({ abertos: 0 }), 0);
});
test('período dos últimos N dias', () => {
  assert.deepEqual(periodo(7, new Date(2026, 10, 7)), { de: '2026-11-01', ate: '2026-11-07' });
  assert.deepEqual(periodo(1, new Date(2026, 0, 1)), { de: '2026-01-01', ate: '2026-01-01' });
});

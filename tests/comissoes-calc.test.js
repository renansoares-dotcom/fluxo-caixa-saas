import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competencias, totais, mesTerminou, MES } from '../js/lib/comissoes-calc.js';
test('comissões: meses, totais e fechamento', () => {
  assert.deepEqual(competencias('2026-02-15', 3), ['2026-02-01', '2026-01-01', '2025-12-01']);
  const t = totais([{ valor_recebido: 1000, base: 900, comissao: 13.5, reducao_pct: 50, tipo: 'comissao' }, { valor_recebido: 500, base: 500, comissao: 25, reducao_pct: 0, tipo: 'comissao' },
    { valor_recebido: -1000, base: -900, comissao: -13.5, reducao_pct: 50, tipo: 'estorno' }]);
  assert.deepEqual(t, { recebido: 500, base: 500, comissao: 25, estornos: -13.5, n: 3, reduzidos: 2 });
  assert.equal(mesTerminou('2026-10-01', '2026-11-08'), true); assert.equal(mesTerminou('2026-11-01', '2026-11-08'), false);
  assert.equal(MES('2026-09-01'), '09/2026');
});

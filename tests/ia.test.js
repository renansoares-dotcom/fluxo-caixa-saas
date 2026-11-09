import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarValor, rotuloChave, configGrafico, textoHtml, anteriores } from '../js/lib/ia.js';
const n = (s) => s.replace(/ /g, ' ');
test('formatar valores por medida', () => {
  assert.equal(n(formatarValor(1234.5, 'valor')), 'R$ 1.234,50');
  assert.equal(n(formatarValor(15200, 'kg')), '15.200 kg');
  assert.equal(formatarValor(3.456, 'refugo_pct'), '3,5%');
  assert.equal(formatarValor(12, 'quantidade'), '12');
  assert.equal(formatarValor(null, 'valor'), '–');
});
test('rótulos e gráfico', () => {
  assert.equal(rotuloChave('2026-03', 'mes'), 'mar/2026'); assert.equal(rotuloChave('2026-03-09', 'dia'), '09/03/2026'); assert.equal(rotuloChave('X', 'cliente'), 'X');
  const tab = { colunas: ['mês', 'valor'], linhas: [['2026-01', 10], ['2026-02', 20]], metrica: 'valor', agrupar: 'mes' };
  const c = configGrafico(tab, { tipo: 'linha', titulo: 'Fat.' });
  assert.equal(c.type, 'line'); assert.deepEqual(c.data.labels, ['jan/2026', 'fev/2026']); assert.deepEqual(c.data.datasets[0].data, [10, 20]);
  const muitos = { colunas: ['cliente', 'valor'], linhas: Array.from({ length: 30 }, (_, i) => ['C' + i, 30 - i]), metrica: 'valor', agrupar: 'cliente' };
  const b = configGrafico(muitos, { tipo: 'pizza' });
  assert.equal(b.type, 'bar'); assert.equal(b.options.indexAxis, 'y'); assert.equal(b.data.labels.length, 20);
  assert.equal(configGrafico(null, { tipo: 'barras' }), null);
});
test('texto da resposta seguro', () => {
  assert.equal(textoHtml('Total **R$ 10**\n- a\n- b\nfim'), '<p>Total <b>R$ 10</b></p><ul><li>a</li><li>b</li></ul><p>fim</p>');
  assert.match(textoHtml('<script>x</script>'), /&lt;script&gt;/);
  assert.deepEqual(anteriores([{ pergunta: 'a', resposta: 'b' }, { pergunta: 'c', erro: 'x' }, { pergunta: 'd', resposta: 'e' }, { pergunta: 'f', resposta: 'g' }]), [{ pergunta: 'd', resposta: 'e' }, { pergunta: 'f', resposta: 'g' }]);
});

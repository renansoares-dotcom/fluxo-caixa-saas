// Depois de publicar, o navegador pode juntar módulo novo com antigo: a tela recarrega sozinha uma vez (js/app.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const re = new RegExp(src.match(/versaoMisturada = \(e\) => \/(.+)\/i\.test/)[1], 'i');

test('reconhece os erros de versão misturada (Chrome, Firefox, Safari)', () => {
  for (const m of ["The requested module '../lib/aquisicao.js' does not provide an export named 'realizadoCotado'",
    'Failed to fetch dynamically imported module: https://x/js/pages/compras-pedidos.js?v=1', 'Importing a module script failed.', 'error loading dynamically imported module'])
    assert.ok(re.test(m), m);
  for (const m of ['Sem acesso a Compras.', 'Failed to fetch', 'permission denied for table compras_pedidos']) assert.ok(!re.test(m), m);
});
test('recarrega no máximo uma vez a cada 2 minutos', () => {
  assert.match(src, /fc-recarga-versao/); assert.match(src, /Date\.now\(\) - ult > 120000/);
});

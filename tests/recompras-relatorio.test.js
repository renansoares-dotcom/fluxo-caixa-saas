import test from 'node:test';
import assert from 'node:assert/strict';
import { agrupar, substituicoes, relatorioRecompras } from '../js/lib/recompras-relatorio.js';
const esc = (s) => String(s ?? '').replace(/</g, '&lt;'), money = (v) => (+v || 0).toFixed(2), pct = (v) => (v * 100).toFixed(1) + '%', dateBR = (d) => d ? d.split('-').reverse().join('/') : '';
const V = [
  { numero: 1, data: '2026-11-24', fundo: 'Negocial', documento: '36736-1', cliente: 'QUALITY', motivo_nome: 'Substituição de título', titulo_acao: 'substituir', titulo_novo_id: 'n1', titulo_novo_doc: '36757-1', valor_titulo: 6938.36, encargos: 0, valor_recompra: 6938.36, observacao: 'diferença custo nosso' },
  { numero: 2, data: '2026-11-24', fundo: 'Negocial', documento: '36736-5', cliente: 'QUALITY', motivo_nome: 'Substituição de título', titulo_acao: 'substituir', titulo_novo_id: 'n5', titulo_novo_doc: '36757-5', valor_titulo: 6938.40, encargos: 0, valor_recompra: 6938.40 },
  { numero: 3, data: '2026-10-02', fundo: 'FS', documento: '35000-1', cliente: 'X <b>', motivo_nome: 'Inadimplência', titulo_acao: 'reabrir', lanc_reaberto_id: 'r', reaberto_status: 'Em aberto', reaberto_venc: '2026-10-01', valor_titulo: 1000, encargos: 25, valor_recompra: 1025 },
  { numero: 4, data: '2026-10-03', fundo: 'FS', documento: '35001-1', cliente: 'Y', motivo_nome: 'Inadimplência', cancelada: true, valor_titulo: 500, encargos: 0, valor_recompra: 500 }];
test('agrupar soma por chave e ordena pela recompra', () => {
  const g = agrupar(V.filter(x => !x.cancelada), x => x.fundo);
  assert.deepEqual(g.map(x => [x.nome, x.qtd, +x.recompra.toFixed(2)]), [['Negocial', 2, 13876.76], ['FS', 1, 1025]]);
});
test('substituições: diferença entre o recomprado e o que entrou no lugar', () => {
  const S = substituicoes(V, { n1: 6517.86, n5: 6517.87 });
  assert.deepEqual(S.map(x => x.diferenca), [420.5, 420.53]);
  assert.equal(substituicoes(V, {})[0].diferenca, null);
});
test('relatório: seções, totais sem as canceladas, escape e taxa do ano', () => {
  const h = relatorioRecompras(V, { novos: { n1: 6517.86, n5: 6517.87 }, resumo: { cedido: 100000, recomprado: 14901.76, fundos: [{ fundo: 'Negocial', cedido: 80000, recomprado: 13876.76 }], clientes: [] }, ano: 2026, esc, money, pct, dateBR, hoje: '2026-11-24' });
  for (const s of ['1. Resumo', '2. Por motivo', '3. Por fundo', '4. Substituições', '5. Recompras', '6. Taxa de recompra em 2026']) assert.ok(h.includes(s), s);
  assert.ok(h.includes('3 recompra(s)') && h.includes('14901.76') && h.includes('841.03') && h.includes('1 cancelada(s)'));
  assert.ok(h.includes('X &lt;b>') && !h.includes('X <b>'));
  assert.ok(h.includes('vencido') && h.includes('substituído por 36757-1') && h.includes('cancelada'));
  const sem = relatorioRecompras(V.slice(2), { esc, money, pct, dateBR, ano: 2026 });
  assert.ok(!sem.includes('Substituições') && sem.includes('4. Recompras'));
});

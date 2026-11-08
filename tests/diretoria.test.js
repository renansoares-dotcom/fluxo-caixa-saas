import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situacao, tendencia, variacao, meses13, serieAnual, saldosFimMes, montarIndicadores, fmt, analise, itensDeliberacao } from '../js/lib/diretoria-calc.js';

test('situação contra a meta com tolerância', () => {
  assert.equal(situacao(100, 100, 'maior', 10), 'ok');
  assert.equal(situacao(95, 100, 'maior', 10), 'atencao');
  assert.equal(situacao(89, 100, 'maior', 10), 'abaixo');
  assert.equal(situacao(5, 6, 'menor', 10), 'ok');
  assert.equal(situacao(6.5, 6, 'menor', 10), 'atencao');
  assert.equal(situacao(7, 6, 'menor', 10), 'abaixo');
  assert.equal(situacao(null, 6), null);
  assert.equal(situacao(5, null), null);
});
test('tendência pelo sentido', () => {
  assert.equal(tendencia([1, 1, 1, 10, 10, 10]).k, 'melhora');
  assert.equal(tendencia([1, 1, 1, 10, 10, 10], 'menor').k, 'piora');
  assert.equal(tendencia([10, 10, 10, 10.1, 10, 10]).k, 'estavel');
  assert.equal(tendencia([1, 2]).k, 'sem');
  assert.equal(variacao(110, 100), 0.1);
  assert.equal(variacao(5, 0), null);
});
test('meses e séries', () => {
  const m = meses13('2026-10');
  assert.equal(m.length, 13); assert.equal(m[0], '2025-10'); assert.equal(m[12], '2026-10');
  const s = serieAnual(['2025-12', '2026-01'], { 2025: Array(12).fill(1), 2026: [5, ...Array(11).fill(0)] });
  assert.deepEqual(s, [1, 5]);
  assert.deepEqual(saldosFimMes(1000, [100, 200, 300], 50), [450, 650, 950]);
});
test('monta os indicadores do mês', () => {
  const meses = meses13('2026-10'), z = () => Array(13).fill(0);
  const op = { fat_venda: [...z().slice(1), 950], fat_devolucao: [...z().slice(1), 200], prod_boa: [...z().slice(1), 900], prod_refugo: [...z().slice(1), 100],
    rnc_cliente: [...z().slice(1), 2], rnc_mes: z(), rnc_em_aberto: z(), rnc_custo: z(), ent_medidas: [...z().slice(1), 4], ent_no_prazo: [...z().slice(1), 3], ent_entregues: z(), ent_problemas: z(),
    rj_pago: [...Array(9).fill(0), 450000, 450000, 450000, 400000], meta_prazo_logistica: 95 };
  const fin = { caixa: Array(13).fill(500000), receita: [...z().slice(1), 1000], ebitda: [...z().slice(1), 120] };
  const I = montarIndicadores({ meses, fin, op, metas: { faturamento: { 2026: 700 }, perdas: { 2026: 6 } }, cfg: { tolerancia_pct: 10, rj_previsto: 450000, ocultos: ['caixa'] }, comentarios: { perdas: 'Troca de bobina' } });
  const g = Object.fromEntries(I.map(i => [i.k, i]));
  assert.equal(g.caixa, undefined, 'oculto');
  assert.equal(g.faturamento.valor, 750); assert.equal(g.faturamento.sit, 'ok');
  assert.equal(g.margem.valor, 12);
  assert.equal(g.perdas.valor, 10); assert.equal(g.perdas.sit, 'abaixo'); assert.equal(g.perdas.comentario, 'Troca de bobina');
  assert.equal(g.entregas.valor, 75); assert.equal(g.entregas.meta, 95); assert.equal(g.entregas.sit, 'abaixo');
  assert.equal(g.rj.meta, 450000); assert.equal(g.rj.sit, 'abaixo');
  assert.match(g.rj.sub, /acumulado em 2026/);
  const J = montarIndicadores({ meses, fin, op, cfg: { rj_previsto: 450000, rj_inicio: '2026-07-01' } }).find(i => i.k === 'rj');
  assert.equal(J.metas[0], null, 'antes do início do plano não há meta'); assert.equal(J.metas[12], 450000);
  assert.match(J.sub, /R\$ 1,75 mi de R\$ 1,8 mi \(97%\)/);
  assert.equal(g.qualidade.meta, null); assert.equal(g.qualidade.sit, null);
  assert.equal(itensDeliberacao(I).length, 3);
  assert.match(analise(g.perdas, 'outubro de 2026'), /fora da meta de 6,0%.*Troca de bobina/);
});
test('formatação', () => {
  assert.equal(fmt(1234567, 'R$'), 'R$ 1,23 mi');
  assert.equal(fmt(45000, 'R$'), 'R$ 45 mil');
  assert.equal(fmt(-120.5, 'R$'), 'R$ -120,50');
  assert.equal(fmt(85.25, '%'), '85,3%');
  assert.equal(fmt(12300.4, 'kg'), '12.300 kg');
  assert.equal(fmt(null, 'R$'), '—');
  assert.equal(fmt(5, 'R$', true), '+R$ 5,00');
});

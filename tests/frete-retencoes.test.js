// Retenções do autônomo pessoa física no frete (INSS, SEST/SENAT, IRRF): regras puras, com os parâmetros iniciais de 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARAM_PADRAO as P, calcRetencoes, paramVigente, retemNaFonte, irTabela, irReducao, anterioresDoMes, vencimentoRecolhimento, resumoRetencoes } from '../js/lib/frete-retencoes.js';

const PF = { documento: '529.982.247-25', dependentes: 0 }, PJ = { documento: '11.222.333/0001-81' };

test('a cópia da função do servidor é idêntica à da tela', () => {
  const a = readFileSync(new URL('../js/lib/frete-retencoes.js', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../supabase/functions/efrete/retencoes.js', import.meta.url), 'utf8');
  assert.equal(a, b, 'copie js/lib/frete-retencoes.js para supabase/functions/efrete/retencoes.js');
});

test('só pessoa física tem retenção', () => {
  assert.equal(retemNaFonte(PF), true);
  assert.equal(retemNaFonte(PJ), false);
  const r = calcRetencoes({ valor: 3000, transp: PJ }, P);
  assert.equal(r.aplica, false);
  assert.equal(r.total, 0);
  assert.equal(r.liquido, 3000);
  assert.match(r.motivo, /CNPJ/);
});

test('frete comum: INSS 11% e SEST/SENAT 2,5% sobre 20%; IRRF zero', () => {
  const r = calcRetencoes({ valor: 3000, transp: PF }, P);
  assert.equal(r.aplica, true);
  assert.equal(r.base_inss, 600);
  assert.equal(r.inss, 66);
  assert.equal(r.sest_senat, 15);
  assert.equal(r.irrf, 0);
  assert.equal(r.total, 81);
  assert.equal(r.liquido, 2919);
  assert.equal(r.memoria.desconto_simplificado, true);
});

test('teto do INSS limita a base do mês', () => {
  const r = calcRetencoes({ valor: 50000, transp: PF }, P);
  assert.equal(r.memoria.teto_aplicado, true);
  assert.equal(r.inss, 932.31);          // 8.475,55 × 11%
  assert.equal(r.sest_senat, 211.89);    // 8.475,55 × 2,5%
  assert.equal(r.irrf, 0);               // rendimento de R$ 5.000: a redução zera o imposto
  const semTeto = calcRetencoes({ valor: 50000, transp: PF }, { ...P, sest_senat_teto: false });
  assert.equal(semTeto.sest_senat, 250); // 10.000 × 2,5%
});

test('IRRF: tabela progressiva sobre 10% do frete, menos o INSS, com a redução de 2026', () => {
  const r = calcRetencoes({ valor: 100000, transp: PF }, P);
  assert.equal(r.base_irrf, 10000);
  assert.equal(r.memoria.base_irrf_mes, 9067.69);
  assert.equal(r.irrf, 1584.88);
  assert.equal(r.liquido, 100000 - 932.31 - 211.89 - 1584.88);
  // faixa de redução parcial: rendimento de R$ 6.000
  const m = calcRetencoes({ valor: 60000, transp: PF }, P);
  assert.equal(m.memoria.irrf_tabela, 484.88);   // (6.000 − 932,31) × 27,5% − 908,73
  assert.equal(m.memoria.irrf_reducao, 179.75);  // 978,62 − 0,133145 × 6.000
  assert.equal(m.irrf, 305.13);
  // dependentes reduzem a base
  const d = calcRetencoes({ valor: 100000, transp: { ...PF, dependentes: 2 } }, P);
  assert.equal(d.irrf, r2(1584.88 - 2 * 189.59 * 0.275));
});
const r2 = (v) => Math.round(v * 100) / 100;

test('tabela e redução isoladas', () => {
  assert.equal(irTabela(2428.80, P.irrf_faixas), 0);
  assert.equal(irTabela(3000, P.irrf_faixas), 55.84);
  assert.equal(irTabela(0, P.irrf_faixas), 0);
  assert.equal(irReducao(5000, 239.74, P.irrf_reducao), 239.74);
  assert.equal(irReducao(7350.01, 500, P.irrf_reducao), 0);
  assert.equal(irReducao(6000, 0, P.irrf_reducao), 0);
});

test('retenção de IRRF até o mínimo é dispensada', () => {
  const r = calcRetencoes({ valor: 100000, transp: PF }, { ...P, irrf_minimo: 2000 });
  assert.equal(r.irrf, 0);
});

test('acumulado do mês: o frete seguinte paga só a diferença', () => {
  const a = calcRetencoes({ valor: 40000, transp: PF }, P);
  assert.equal(a.inss, 880);
  const b = calcRetencoes({ valor: 10000, transp: PF, anteriores: [{ valor: 40000, inss: a.inss, sest_senat: a.sest_senat, irrf: a.irrf }] }, P);
  assert.equal(b.inss, 52.31);           // 932,31 do mês − 880 já retido
  assert.equal(b.sest_senat, 11.89);     // 211,89 − 200
  const c = calcRetencoes({ valor: 5000, transp: PF, anteriores: [{ valor: 40000, inss: 880, sest_senat: 200, irrf: 0 }, { valor: 10000, inss: 52.31, sest_senat: 11.89, irrf: 0 }] }, P);
  assert.equal(c.inss, 0);               // teto já atingido no mês
  assert.equal(c.sest_senat, 0);
});

test('fretes anteriores do mês: mesmo transportador, mesmo mês, antes deste, sem os cancelados', () => {
  const F = [
    { id: 'a', numero: 1, transportador_id: 't', data: '2026-11-03', valor: 1000, status: 'aberto', retencoes: { inss: 22, sest_senat: 5, irrf: 0 } },
    { id: 'b', numero: 2, transportador_id: 't', data: '2026-11-10', valor: 2000, status: 'cancelado', retencoes: { inss: 44 } },
    { id: 'c', numero: 3, transportador_id: 't', data: '2026-10-30', valor: 3000, status: 'aberto' },
    { id: 'd', numero: 4, transportador_id: 'outro', data: '2026-11-04', valor: 4000, status: 'aberto' },
    { id: 'e', numero: 5, transportador_id: 't', data: '2026-11-20', valor: 5000, status: 'aberto' },
    { id: 'f', numero: 6, transportador_id: 't', data: '2026-11-12', valor: 6000, status: 'aberto' },
  ];
  assert.deepEqual(anterioresDoMes(F, F[5]), [{ valor: 1000, inss: 22, sest_senat: 5, irrf: 0 }]);
  assert.equal(anterioresDoMes(F, { transportador_id: 't', data: '2026-11-30' }).length, 3);   // ficha nova, ainda sem número
});

test('parâmetro vigente e vencimento do recolhimento', () => {
  const ps = [{ vigencia: '2026-01-01', x: 1 }, { vigencia: '2027-01-01', x: 2 }];
  assert.equal(paramVigente(ps, '2026-11-16').x, 1);
  assert.equal(paramVigente(ps, '2027-01-01').x, 2);
  assert.equal(paramVigente(ps, '2025-12-31'), null);
  assert.equal(paramVigente(ps).x, 2);
  assert.equal(vencimentoRecolhimento('2026-11-16'), '2026-12-20');
  assert.equal(vencimentoRecolhimento('2026-12-05'), '2027-01-20');
  assert.match(calcRetencoes({ valor: 100, transp: PF }, null).motivo, /Sem parâmetros/);
});

test('resumo gravado no frete', () => {
  assert.deepEqual(resumoRetencoes(calcRetencoes({ valor: 3000, transp: PJ }, P)), {});
  const r = resumoRetencoes(calcRetencoes({ valor: 3000, transp: PF }, P));
  assert.equal(r.total, 81);
  assert.equal(r.vigencia, '2026-01-01');
});

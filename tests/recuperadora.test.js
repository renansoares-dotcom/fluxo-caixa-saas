import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precoVigente, calcTicket, abatimento, saldosAdiant, estoquePorMaterial, placa, COLETOR_SUGERIDO, dosarReceita, resumoAditivos, resumoExpedicao, resumoOrdem as resumoOrdemAdt } from '../js/lib/recuperadora.js';

const PRECOS = [
  { material_id: 'm1', classe_id: null, vigencia: '2026-01-01', preco_kg: 1.5 },
  { material_id: 'm1', classe_id: null, vigencia: '2026-11-01', preco_kg: 1.8 },
  { material_id: 'm1', classe_id: 'A', vigencia: '2026-11-01', preco_kg: 2.2 },
  { material_id: 'm2', classe_id: null, vigencia: '2026-01-01', preco_kg: 1 }];

test('preço vigente: classe vence o geral, vigência mais recente', () => {
  assert.equal(precoVigente(PRECOS, 'm1', 'B', '2026-11-05'), 1.8);
  assert.equal(precoVigente(PRECOS, 'm1', 'A', '2026-11-05'), 2.2);
  assert.equal(precoVigente(PRECOS, 'm1', 'A', '2026-10-31'), 1.5);
  assert.equal(precoVigente(PRECOS, 'm3', null, '2026-11-05'), null);
});

test('ticket: desconto da classe, preço da tabela, frete rateado e tolerância (igual ao banco)', () => {
  const t = { origem: 'compra', peso_bruto: 2500, tara: 1500, frete_valor: 100 };
  const it = [{ peso_kg: 700, desconto_padrao: 8, preco_tabela: 1.8 }, { peso_kg: 300, desconto_pct: '', preco_tabela: 1 }];
  const c = calcTicket(t, it);
  assert.equal(c.liquido, 1000); assert.equal(c.soma, 1000); assert.ok(c.dentro);
  assert.deepEqual(c.itens.map(i => [i.pago, i.valor, i.frete]), [[644, 1159.2, 70], [300, 300, 30]]);
  assert.equal(c.total, 1459.2); assert.equal(c.pagoKg, 944);
  const c2 = calcTicket(t, [{ peso_kg: 990, preco_kg: 1 }]);
  assert.equal(c2.diferenca, -10); assert.equal(c2.dentro, false);
  assert.equal(calcTicket({ origem: 'doacao' }, [{ peso_kg: 50, preco_tabela: 3 }]).total, 0);
  assert.equal(calcTicket({ origem: 'compra' }, [{ peso_kg: 50 }]).itens[0].semPreco, true);
  assert.equal(calcTicket({ origem: 'compra' }, [{ peso_kg: 120, desconto_pct: 2, preco_kg: 2.2 }]).total, 258.72);
});

test('abatimento do adiantamento: mais antigos primeiro, até o total', () => {
  const A = [{ id: 'b', data: '2026-11-05', saldo: 300 }, { id: 'a', data: '2026-11-01', saldo: 100 }];
  assert.deepEqual(abatimento(250, A), { abatido: 250, aPagar: 0, usados: [{ id: 'a', valor: 100 }, { id: 'b', valor: 150 }] });
  assert.deepEqual(abatimento(1000, A).aPagar, 600);
  assert.deepEqual(abatimento(50, []), { abatido: 0, aPagar: 50, usados: [] });
});

test('saldos de adiantamento e estoque por material', () => {
  const S = saldosAdiant([{ id: 'a', valor: 100, situacao: 'aberto' }, { id: 'c', valor: 40, situacao: 'cancelado' }], [{ adiantamento_id: 'a', valor: 60 }]);
  assert.deepEqual(S.map(x => x.saldo), [40, 0]);
  const E = estoquePorMaterial([{ material_id: 'm', situacao: 'disponivel', peso_kg: 100, saldo_kg: 50, custo_total: 200 },
    { material_id: 'm', situacao: 'consumido', peso_kg: 10, saldo_kg: 0, custo_total: 10 }, { material_id: 'm', situacao: 'bloqueado', peso_kg: 50, saldo_kg: 50, custo_total: 50 }]);
  assert.deepEqual(E.get('m'), { kg: 100, custo: 150, lotes: 2, custoKg: 1.5 });
});

test('placa e coletor incentivado', () => {
  assert.equal(placa('abc-1d23'), 'ABC1D23');
  assert.ok(COLETOR_SUGERIDO('catador_pf')); assert.ok(!COLETOR_SUGERIDO('sucateiro_pj'));
});

import { custoProcesso, resumoOrdem, avaliarEnsaio, precoEquivalente, horasEtapa } from '../js/lib/recuperadora.js';
test('custo do processo igual ao banco (teste 88)', () => {
  const o = { energia_kwh: 100, agua_m3: 2, quimicos_valor: 15, mo_horas: 4, outros_valor: 0, maquina_id: 'agl' };
  const et = [{ maquina_id: 'moa', inicio: '2026-11-09T08:00:00-03:00', fim: '2026-11-09T09:30:00-03:00', kg_saida: 120, perda_sujeira: 7, perda_finos: 2, ordem: 2 },
    { horas_maquina: 2, kg_saida: 110, perda_umidade: 10, ordem: 5 }];
  const cfg = { custo_kwh: 0.8, custo_m3_agua: 10, custo_hora_mo: 25 }, ch = (m) => ({ moa: 40, agl: 60 }[m] || 0);
  assert.equal(horasEtapa(et[0]), 1.5);
  assert.equal(custoProcesso(o, et, cfg, ch).total, 395);
  const R = resumoOrdem(o, [{ kg: 100, custo: 220 }, { kg: 29, custo: 14.5 }], et, cfg, ch);
  assert.deepEqual([R.entrada, R.kgSaida, R.total, R.perdaTotal, R.naoExplicado], [129, 110, 629.5, 19, 0]);
  assert.equal(R.custoKg, 5.7227);
});
test('ensaio e preço equivalente', () => {
  const s = { mfi_min: 0.5, mfi_max: 3, umidade_max: 0.3 };
  assert.deepEqual(avaliarEnsaio({ mfi: 1.2, umidade: 0.5 }, s), ['umidade acima de 0.3%']);
  assert.deepEqual(avaliarEnsaio({ mfi: 1.2, umidade: 0.2 }, s), []);
  assert.deepEqual(avaliarEnsaio({ mfi: 1 }, null), []);
  assert.equal(precoEquivalente({ preco_pago_kg: 2, rendimento_pesado: 0.72 }, 0.8), 1.8);
  assert.equal(precoEquivalente({ preco_pago_kg: 2 }, 0.8), null);
});

import { situacaoLicenca, conferirBalanco, alertasParaDecisoes } from '../js/lib/recuperadora.js';
test('licença, balanço e alertas', () => {
  assert.equal(situacaoLicenca({ validade: '2026-11-08' }, '2026-11-09').k, 'vencida');
  assert.equal(situacaoLicenca({ validade: '2026-12-01' }, '2026-11-09').k, 'avencer');
  assert.equal(situacaoLicenca({ validade: '2026-12-01', antecedencia_dias: 10 }, '2026-11-09').k, 'ok');
  const B = { tolerancia_pct: 2, material: { estoque_inicial: 100, comprado: 917.6, aparas: 29, outras: 0, consumido: 129, estoque_final: 917.6 },
    processo: { entrada: 129, nao_explicada: 3 }, grao: { estoque_inicial: 0, produzido: 110, saidas: { producao: 100 }, estoque_final: 10 } };
  const C = conferirBalanco(B);
  assert.ok(C.materialFecha); assert.ok(C.grao.fecha); assert.equal(C.processoOk, false); assert.equal(C.naoExplicadaPct, 2.33);
  const A = alertasParaDecisoes([{ k: 'licenca', nivel: 'alto', item: { tipo: 'LO', numero: '1', validade: '2026-11-01', dias: -8 } }, { k: 'licenca', nivel: 'medio', item: { tipo: 'CTF', validade: '2026-12-20', dias: 41 } },
    { k: 'ensaio', nivel: 'medio', item: { lotes: 2, kg: 3000 } }, { k: 'adiantamento', nivel: 'medio', item: { qtd: 1, valor: 400, dias: 30 } }]);
  assert.deepEqual(A.map(a => [a.k, a.urg]), [['rec-licencas', 'alta'], ['rec-ensaio', 'media'], ['rec-adiant', 'media']]);
  assert.equal(A[2].impacto, 400); assert.ok(A.every(a => a.origem === 'Recuperadora' && a.rota && a.regra));
});

test('receita e aditivos: dosagem sobre o reciclado, desvio do previsto e custo no kg de grão', () => {
  // 2% e 10% de 500 kg de reciclado
  assert.deepEqual(dosarReceita([{ produto_id: 'mb', dosagem_pct: 2 }, { produto_id: 'pv', dosagem_pct: 10 }], 500).map(i => i.kg), [10, 50]);
  // usado 14 kg contra 10 previstos = +40% (fora de 20%); custo pelo custo médio enquanto a ordem está aberta
  const A = resumoAditivos([{ produto_id: 'mb', kg: 14, kg_previsto: 10 }, { produto_id: 'pv', kg: 50, kg_previsto: 50 }, { produto_id: 'x', kg: 1, kg_previsto: null }], (p) => ({ mb: 20, pv: 9 })[p] || 0, 20);
  assert.equal(A.kg, 65); assert.equal(A.custo, 730); assert.equal(A.fora, 1);
  assert.deepEqual(A.itens.map(i => [i.desvio, i.fora]), [[40, true], [0, false], [null, false]]);
  // custo gravado na conclusão vale mais que o custo médio de hoje
  assert.equal(resumoAditivos([{ produto_id: 'mb', kg: 14, custo: 300 }], () => 20).custo, 300);
  // ordem: 500 kg de reciclado + 64 de aditivos; saída 540 → rendimento sobre 564, custo com os aditivos
  const B = resumoAditivos([{ produto_id: 'mb', kg: 14, kg_previsto: 10 }, { produto_id: 'pv', kg: 50, kg_previsto: 50 }], (p) => ({ mb: 20, pv: 9 })[p], 20);
  const S = resumoOrdemAdt({ quimicos_valor: 50 }, [{ kg: 500, custo: 500 }], [], {}, () => 0, 540, B);
  assert.equal(S.entrada, 564); assert.equal(S.reciclado, 500); assert.equal(S.aditivosKg, 64); assert.equal(S.total, 1280);
  assert.equal(Math.round(S.rendimento * 10000), Math.round(540 / 564 * 10000)); assert.equal(S.custoKg, Math.round(1280 / 540 * 10000) / 10000);
  // sem aditivos, nada muda
  const S0 = resumoOrdemAdt({ quimicos_valor: 50 }, [{ kg: 500, custo: 500 }], [], {}, () => 0, 450);
  assert.equal(S0.entrada, 500); assert.equal(S0.total, 550); assert.equal(S0.rendimento, 0.9);
});

test('separação por densidade: o separado deixa a entrada e leva o custo pelo peso (ou nenhum)', () => {
  // 100 kg a R$ 100; 15 kg afundam → entrada 85, material 85; saída 76,5 → 90%
  const S = resumoOrdemAdt({}, [{ kg: 100, custo: 100 }], [], { separacao_custo: 'peso' }, () => 0, 76.5, null, [{ kg: 15 }]);
  assert.equal(S.bruto, 100); assert.equal(S.separadoKg, 15); assert.equal(S.entrada, 85); assert.equal(S.material, 85); assert.equal(S.rendimento, 0.9); assert.equal(S.custoKg, Math.round(85 / 76.5 * 10000) / 10000);
  // custo zero no separado: os R$ 100 ficam no grão
  const Z = resumoOrdemAdt({}, [{ kg: 100, custo: 100 }], [], { separacao_custo: 'zero' }, () => 0, 76.5, null, [{ kg: 15 }]);
  assert.equal(Z.material, 100); assert.equal(Z.entrada, 85);
  // balanço: separados somam e saídas diretas saem da conta do material
  const B = { tolerancia_pct: 2, material: { estoque_inicial: 100, comprado: 50, aparas: 0, outras: 0, separados: 15, consumido: 100, saidas: 10, estoque_final: 55 }, processo: { entrada: 85, nao_explicada: 0 }, grao: { estoque_inicial: 0, produzido: 76.5, saidas: {}, estoque_final: 76.5 } };
  assert.equal(conferirBalanco(B).materialFecha, true);
  assert.equal(conferirBalanco({ ...B, material: { ...B.material, separados: 0 } }).materialFecha, false);
});

test('expedição: peso, valor só dos itens com preço, custo dos lotes e margem', () => {
  const L = { peso_kg: 540, custo_total: 1280, situacao: 'disponivel' };
  const S = resumoExpedicao([{ kg: 200, volumes: 8, preco_kg: 6.5, lote: L }, { kg: 5, volumes: 1, preco_kg: null, lote: { peso_kg: 15, custo_total: 15, situacao: 'bloqueado' } }]);
  assert.deepEqual([S.lotes, S.kg, S.volumes, S.valor, S.semPreco, S.indisponiveis], [2, 205, 9, 1300, 1, 1]);
  assert.equal(S.custo, 479.07); assert.equal(S.margem, 820.93);
  // depois de expedida, vale o custo gravado no item e o lote vendido não conta como indisponível
  const E = resumoExpedicao([{ kg: 100, preco_kg: 7, custo: 237.04, saida_id: 's1', lote: { peso_kg: 540, custo_total: 1280, situacao: 'vendido' } }]);
  assert.equal(E.custo, 237.04); assert.equal(E.indisponiveis, 0); assert.equal(E.margem, 462.96);
});

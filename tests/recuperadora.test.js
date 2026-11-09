import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precoVigente, calcTicket, abatimento, saldosAdiant, estoquePorMaterial, placa, COLETOR_SUGERIDO } from '../js/lib/recuperadora.js';

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

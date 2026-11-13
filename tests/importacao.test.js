import test from 'node:test';
import assert from 'node:assert/strict';
import { estimar, custoFinal, coberturaCambio, exposicao, alertas, lerSgs, proximaEtapa, faltaParaEtapa, freteNoPreco, seguroNoPreco, numeroProcesso, CATEGORIAS, ETAPAS, MODALIDADES, resumoRepasses } from '../js/lib/importacao.js';

const itens = [{ id: 'a', descricao: 'RESINA PEBD', unidade: 'KG', quantidade: 20000, valor_unitario: 1.2, aliq_ii: 12.6, aliq_ipi: 0, aliq_pis: 2.1, aliq_cofins: 9.65, aliq_icms: 18 },
  { id: 'b', descricao: 'MASTERBATCH', unidade: 'KG', quantidade: 5000, valor_unitario: 2, aliq_ii: 12.6, aliq_ipi: 5, aliq_pis: 2.1, aliq_cofins: 9.65, aliq_icms: 18 }];
const desp = [['frete_internacional', 8500, true], ['seguro', 340, true], ['ii', 12000, true], ['icms', 30000, false], ['siscomex', 154.23, true], ['despachante', 1500, true], ['bancaria', 200, false]]
  .map(([categoria, valor, compoe_custo]) => ({ categoria, valor, compoe_custo, item_id: null })).concat([{ categoria: 'armazenagem', valor: 500, compoe_custo: true, item_id: 'b' }]);
const camb = [{ status: 'liquidado', valor_moeda: 10200, valor_brl: 49980, taxa: 4.9 }, { status: 'liquidado', valor_moeda: 23800, valor_brl: 121380, taxa: 5.1 }];

test('custo final: os mesmos números do teste do banco (imp_custo)', () => {
  const c = custoFinal({ moeda: 'USD', taxa_di: 5, taxa_prevista: 5.2 }, itens, desp, camb, { rateio: 'valor' });
  assert.equal(c.taxa, 5); assert.equal(c.taxa_origem, 'declaracao'); assert.equal(c.fob_brl, 170000);
  assert.equal(c.despesas_custo, 22994.23); assert.equal(c.despesas_fora, 30200); assert.equal(c.impostos_recuperaveis, 30000);
  assert.equal(c.itens[0].custo_total, 135878.28); assert.equal(c.itens[0].custo_unitario, 6.793914);
  assert.equal(c.itens[1].custo_total, 57115.95); assert.equal(c.itens[1].custo_unitario, 11.42319);
  assert.equal(c.custo_total, 192994.23); assert.equal(c.variacao_cambial, 1360);
  assert.ok(Math.abs(c.fator - 1.13526) < 1e-4);
});
test('custo final: rateio por peso, taxa prevista e sem taxa', () => {
  assert.equal(custoFinal({ taxa_di: 5, rateio: 'peso' }, itens, desp, [], {}).itens[0].despesas, 17995.38);
  const p = custoFinal({ taxa_prevista: 5.2 }, itens, [], [], {}); assert.equal(p.taxa_origem, 'prevista'); assert.equal(p.fob_brl, 176800);
  const s = custoFinal({}, itens, [], [], {}); assert.equal(s.taxa, null); assert.equal(s.taxa_origem, 'sem_taxa'); assert.equal(s.variacao_cambial, null);
  assert.equal(custoFinal({}, itens, [], [], {}, 5.4).taxa_origem, 'cotacao');
  // item sem peso em unidade diferente de KG: o rateio por peso cai para o valor
  assert.equal(custoFinal({ taxa_di: 5, rateio: 'peso' }, [{ id: 'x', unidade: 'UN', quantidade: 10, valor_unitario: 100 }], [{ categoria: 'outras', valor: 50, compoe_custo: true }], [], {}).rateio, 'valor');
});
test('custo estimado: valor aduaneiro, impostos em cascata, ICMS por dentro e recuperáveis fora do custo', () => {
  const e = estimar([{ id: 'a', unidade: 'KG', quantidade: 1000, valor_unitario: 1, aliq_ii: 10, aliq_ipi: 5, aliq_pis: 2, aliq_cofins: 10, aliq_icms: 20 }],
    { taxa: 5, frete: 100, seguro: 0, siscomex: 100, afrmm_pct: 8, despesas: 300 });
  assert.equal(e.valor_aduaneiro, 5500); assert.equal(e.ii, 550); assert.equal(e.ipi, 302.5); assert.equal(e.pis, 110); assert.equal(e.cofins, 550); assert.equal(e.afrmm, 40);
  assert.equal(e.icms, 1788.13);                                   // (5500 + 550 + 302,5 + 110 + 550 + 140) / 0,8 × 0,2
  assert.equal(e.desembolso, 9240.63); assert.equal(e.recuperavel, 2750.63); assert.equal(e.custo_total, 6490); assert.equal(e.itens[0].custo_unitario, 6.49);
  const s = estimar([{ id: 'a', unidade: 'KG', quantidade: 1000, valor_unitario: 1, aliq_ii: 10, aliq_icms: 20 }], { taxa: 5, recupera_icms: false });
  assert.equal(s.custo_total, s.desembolso);                       // nada recuperável: tudo é custo
  assert.equal(estimar([], { taxa: 5 }).custo_total, 0);
});
test('cobertura e exposição cambial', () => {
  const c = coberturaCambio(itens, [{ status: 'previsto', valor_moeda: 10000 }, { status: 'contratado', valor_moeda: 5000 }, { status: 'liquidado', valor_moeda: 4000 }]);
  assert.deepEqual([c.fob, c.programado, c.sem_programar], [34000, 19000, 15000]);
  const x = exposicao([{ moeda: 'USD', status: 'previsto', valor_moeda: 10000 }, { moeda: 'USD', status: 'contratado', valor_moeda: 5000, taxa: 5.3 }, { moeda: 'USD', status: 'liquidado', valor_moeda: 99 }, { moeda: 'EUR', status: 'previsto', valor_moeda: 1000 }], { USD: 5.4 });
  assert.deepEqual([x[0].moeda, x[0].aberto, x[0].aberto_brl, x[0].por_ponto, x[0].travado_brl], ['USD', 10000, 54000, 540, 26500]);
  assert.equal(x[1].aberto_brl, null);
});
test('alertas de prazo', () => {
  const P = [{ id: '1', numero: 1, moeda: 'USD', status: 'embarcado', chegada_prevista: '2026-11-10' }, { id: '2', numero: 2, moeda: 'USD', status: 'embarcado', chegada_prevista: '2026-11-18' },
    { id: '3', numero: 3, moeda: 'USD', status: 'chegada', data_chegada: '2026-11-01', data_devolucao_container: '2026-11-15' }, { id: '4', numero: 4, moeda: 'USD', status: 'encerrado', chegada_prevista: '2026-01-01' },
    { id: '5', numero: 5, moeda: 'USD', status: 'pedido', embarque_previsto: '2026-11-01' }];
  const C = [{ processo_id: '2', status: 'previsto', valor_moeda: 1000, vencimento: '2026-11-15' }, { processo_id: '2', status: 'contratado', valor_moeda: 1000, vencimento: '2026-11-12' }, { processo_id: '2', status: 'liquidado', valor_moeda: 1, vencimento: '2026-11-01' }];
  const A = alertas(P, C, {}, '2026-11-13');
  assert.deepEqual(A.map(a => a.k + ':' + a.nivel), ['chegada:alto', 'cambio:alto', 'cambio:alto', 'registro:medio', 'embarque:medio', 'container:medio', 'chegada:baixo']);
  assert.match(A[0].texto, /IMP 001.*3 dia\(s\) atrasada/); assert.match(A.find(a => a.k === 'cambio' && a.data === '2026-11-15').texto, /sem contrato/);
  assert.equal(alertas(P, C, { dias_aviso_chegada: 2, dias_aviso_cambio: 0, dias_aviso_freetime: 0 }, '2026-11-13').filter(a => a.nivel === 'baixo').length, 0);
});
test('cotações do Banco Central, etapas e conferências', () => {
  const L = lerSgs('USD', [{ data: '12/11/2026', valor: '5.4018' }, { data: '13/11/2026', valor: '5.3990' }, { data: 'x', valor: '1' }], [{ data: '12/11/2026', valor: '5.4012' }]);
  assert.deepEqual(L, [{ moeda: 'USD', data: '2026-11-12', venda: 5.4018, compra: 5.4012, fonte: 'Banco Central (PTAX)' }, { moeda: 'USD', data: '2026-11-13', venda: 5.399, compra: null, fonte: 'Banco Central (PTAX)' }]);
  assert.deepEqual(lerSgs('USD', null), []);
  assert.equal(proximaEtapa('embarcado'), 'chegada'); assert.equal(proximaEtapa('encerrado'), null); assert.equal(ETAPAS.length, 9);
  assert.ok(freteNoPreco('CIF') && !freteNoPreco('FOB') && seguroNoPreco('CIF') && !seguroNoPreco('CFR'));
  assert.equal(numeroProcesso({ numero: 7 }), 'IMP 007');
  assert.equal(faltaParaEtapa({}, itens, 'registro').length, 2); assert.equal(faltaParaEtapa({ declaracao: '1', taxa_di: 5 }, itens, 'registro').length, 0);
  assert.equal(faltaParaEtapa({}, [], 'pedido').length, 1); assert.equal(faltaParaEtapa({}, [{ quantidade: 10, qtd_recebida: 4 }], 'encerrado').length, 1);
  assert.ok(Object.values(CATEGORIAS).every(c => c.length === 3)); assert.equal(CATEGORIAS.icms[2], false);
});

test('importação por meio de terceiro: repasses contra o total informado e a mercadoria em moeda', () => {
  const it = [{ id: 'a', unidade: 'KG', quantidade: 40000, valor_unitario: 1.2 }, { id: 'b', unidade: 'KG', quantidade: 60000, valor_unitario: 1.5 }];
  const reps = [{ valor: 150000, valor_moeda: 30000, confirmado: true, data: '2026-09-22' }, { valor: 180000, confirmado: true, data: '2026-11-13' }, { valor: 50000, confirmado: false, data: null }];
  const r = resumoRepasses({ total_informado_brl: 700000 }, reps, it);
  assert.equal(r.repassado, 380000); assert.equal(r.confirmado, 330000); assert.equal(r.a_confirmar, 50000); assert.equal(r.sem_data, 1);
  assert.equal(r.saldo, 320000); assert.ok(Math.abs(r.pct - 54.2857) < 1e-3);
  assert.equal(r.fob_moeda, 138000); assert.equal(r.abatido_moeda, 30000); assert.equal(r.saldo_moeda, 108000); assert.equal(r.taxa_media, 5);
  const s = resumoRepasses({}, [], it); assert.equal(s.informado, null); assert.equal(s.saldo, null); assert.equal(s.pct, null); assert.equal(s.taxa_media, null);
  assert.deepEqual(Object.keys(MODALIDADES), ['direta', 'terceiro']);
});

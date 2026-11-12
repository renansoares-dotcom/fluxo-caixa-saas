// Agenda única: repetição, exceções, grades, itens das origens, filtros, resumo do dia e saldo projetado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { datasDaSerie, ocorrencias, textoRepeticao, gradeMes, semanaDe, periodo, navegar, itensTitulos, itensCheques, itensContatos, itensFechamento, itensContratos, filtrar, porDia, resumoDia, saldoPorDia, valorCurto, fontesVisiveis, addMeses } from '../js/lib/agenda.js';

const C = (x) => ({ id: 'c1', titulo: 'Reunião', tipo: 'reuniao', data: '2026-11-02', repetir: 'nao', intervalo: 1, dias_semana: [], situacao: 'aberto', dono: 'u1', responsavel: 'u1', participantes: [], ...x });

test('repetição: diária, semanal, mensal e anual', () => {
  assert.deepEqual(datasDaSerie(C({ repetir: 'diaria', intervalo: 2 }), '2026-11-05', '2026-11-10'), ['2026-11-06', '2026-11-08', '2026-11-10']);
  assert.deepEqual(datasDaSerie(C({ repetir: 'semanal', dias_semana: [1, 3] }), '2026-11-01', '2026-11-12'), ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11']);
  assert.deepEqual(datasDaSerie(C({ repetir: 'semanal', intervalo: 2 }), '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-16', '2026-11-30']);
  assert.deepEqual(datasDaSerie(C({ repetir: 'semanal', data: '2025-01-06' }), '2026-11-09', '2026-11-16'), ['2026-11-09', '2026-11-16']);
  assert.deepEqual(datasDaSerie(C({ repetir: 'mensal', data: '2026-01-31' }), '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(datasDaSerie(C({ repetir: 'anual', data: '2024-02-29' }), '2025-01-01', '2028-12-31'), ['2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.deepEqual(datasDaSerie(C({ repetir: 'diaria', repetir_ate: '2026-11-04' }), '2026-11-01', '2026-11-30'), ['2026-11-02', '2026-11-03', '2026-11-04']);
  assert.deepEqual(datasDaSerie(C({}), '2026-11-01', '2026-11-30'), ['2026-11-02']);
  assert.equal(addMeses('2026-11-30', 3), '2027-02-28');
});

test('ocorrências com exceções: feito, cancelado e movido', () => {
  const c = C({ repetir: 'semanal', hora: '08:30:00' }), ex = [
    { compromisso_id: 'c1', data: '2026-11-09', acao: 'feito' }, { compromisso_id: 'c1', data: '2026-11-16', acao: 'movido', nova_data: '2026-11-18', nova_hora: '10:00:00' },
    { compromisso_id: 'c1', data: '2026-11-23', acao: 'cancelado' }, { compromisso_id: 'c1', data: '2026-12-07', acao: 'movido', nova_data: '2026-11-27' }];
  const O = ocorrencias(c, '2026-11-01', '2026-11-30', ex).sort((a, b) => a.data.localeCompare(b.data));
  assert.deepEqual(O.map(o => [o.data, o.dataOriginal, o.hora, !!o.feito]), [['2026-11-02', '2026-11-02', '08:30', false], ['2026-11-09', '2026-11-09', '08:30', true], ['2026-11-18', '2026-11-16', '10:00', false], ['2026-11-27', '2026-12-07', '08:30', false], ['2026-11-30', '2026-11-30', '08:30', false]]);
  assert.equal(new Set(O.map(o => o.uid)).size, 5);
  assert.equal(ocorrencias(C({ situacao: 'cancelado' }), '2026-11-01', '2026-11-30').length, 0);
  assert.equal(ocorrencias(C({ situacao: 'feito' }), '2026-11-01', '2026-11-30')[0].feito, true);
  assert.equal(textoRepeticao(C({ repetir: 'semanal', dias_semana: [3, 1], repetir_ate: '2026-12-31' })), 'toda semana (seg, qua), até 31/12/2026');
  assert.equal(textoRepeticao(C({ repetir: 'mensal', intervalo: 3 })), 'a cada 3 meses');
});

test('grade do mês, semana e navegação', () => {
  const g = gradeMes(2026, 11, 0);
  assert.equal(g.length, 5); assert.equal(g[0][0], '2026-11-01'); assert.equal(g[4][6], '2026-12-05');
  const s = gradeMes(2026, 11, 1);
  assert.equal(s[0][0], '2026-10-26'); assert.equal(s[s.length - 1][6], '2026-12-06');
  assert.deepEqual([semanaDe('2026-11-12', 1)[0], semanaDe('2026-11-12', 1)[6]], ['2026-11-09', '2026-11-15']);
  assert.equal(periodo('mes', '2026-11-12').titulo, 'novembro de 2026');
  assert.deepEqual([periodo('semana', '2026-11-12', 1).de, periodo('semana', '2026-11-12', 1).ate], ['2026-11-09', '2026-11-15']);
  assert.equal(navegar('mes', '2026-01-31', 1), '2026-02-01'); assert.equal(navegar('mes', '2026-01-15', -1), '2025-12-01'); assert.equal(navegar('semana', '2026-11-12', -1), '2026-11-05');
});

const ctx = { planoById: { r: { natureza: 'C', tipo: 'E', nome: 'VENDAS' }, d: { natureza: 'D', tipo: 'S', nome: 'ENERGIA' }, t: { natureza: 'D', tipo: 'T', nome: 'TRANSF' } }, favById: { f1: { nome: 'Cliente Exemplo' } }, contaById: { c1: { nome: 'Banco' } }, hoje: '2026-11-12' };
test('itens das telas de origem', () => {
  const T = itensTitulos([{ id: 1, data: '2026-11-10', plano_id: 'r', favorecido_id: 'f1', valor: 100, documento: '10/1' }, { id: 2, data: '2026-11-20', plano_id: 'd', valor: 40, descricao: 'Conta de luz' }, { id: 3, data: '2026-11-20', plano_id: 't', valor: 5 }], { ...ctx, podeAdiar: true });
  assert.deepEqual(T.map(i => [i.fonte, i.titulo, i.sinal, !!i.atrasado, i.acoes.adiar]), [['receber', 'Cliente Exemplo', 1, true, true], ['pagar', 'Conta de luz', -1, false, true]]);
  const Q = itensCheques([{ id: 'a', numero: '10', situacao: 'carteira', bom_para: '2026-11-10', valor: 50, favorecido_id: 'f1' }, { id: 'b', numero: '11', situacao: 'depositado', bom_para: '2026-11-11', valor: 60 }, { id: 'c', numero: '12', situacao: 'fidc', bom_para: '2026-11-11', valor: 70 }],
    [{ id: 'e', numero: 5, situacao: 'emitido', bom_para: '2026-11-15', valor: 30, conta_id: 'c1' }, { id: 'x', numero: 6, situacao: 'compensado', bom_para: '2026-11-15', valor: 30 }], ctx);
  assert.deepEqual(Q.map(i => [i.fonte, i.sinal, !!i.noSaldo, !!i.atrasado]), [['cheque_rec', 1, true, true], ['cheque_rec', 1, false, false], ['cheque_emi', -1, true, false]]);
  assert.equal(itensContatos([{ id: 1, proximo_contato: '2026-11-13', favorecido_id: 'f1', vendedor_id: 'u2' }, { id: 2, proximo_contato: '2026-11-13', concluido: true }, { id: 3 }], ctx).length, 1);
  assert.deepEqual(itensFechamento([{ id: 1, prazo: '2026-11-05', situacao: 'pendente', titulo: 'Conciliar', mes: '2026-10-01', responsavel: 'u1' }, { id: 2, prazo: '2026-11-05', situacao: 'feita', titulo: 'Extratos', mes: '2026-10-01' }], ctx).map(i => [i.atrasado, i.feito, i.sub]), [[true, false, 'fechamento de 10/2026'], [false, true, 'fechamento de 10/2026']]);
  const K = itensContratos([{ id: 1, status: 'vigente', numero: '7', parte_nome: 'Locadora', fim: '2026-11-30', data_base: '2025-11-20', indice: 'IPCA' }, { id: 2, status: 'encerrado', fim: '2026-11-30' }, { id: 3, status: 'vigente', data_base: '2026-11-20', indice: 'IPCA' }], { de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-12' });
  assert.deepEqual(K.map(i => [i.data, i.sub]), [['2026-11-30', 'fim da vigência'], ['2026-11-20', 'data-base do reajuste (IPCA)']]);
});

test('filtros, agrupamento e resumo do dia', () => {
  const I = [{ uid: 1, fonte: 'pagar', data: '2026-11-12', titulo: 'Luz', valor: 40 }, { uid: 2, fonte: 'pagar', data: '2026-11-12', titulo: 'Água', valor: 60, atrasado: true }, { uid: 3, fonte: 'compromisso', data: '2026-11-12', titulo: 'Reunião', hora: '09:00', pessoas: ['u1'] },
    { uid: 4, fonte: 'compromisso', data: '2026-11-12', titulo: 'Feriado local', pessoas: ['u2'] }, { uid: 5, fonte: 'contato', data: '2026-11-13', titulo: 'Contato: Cliente', pessoas: ['u2'], feito: true }];
  assert.deepEqual(filtrar(I, { meus: true, uid: 'u1' }).map(i => i.uid), [1, 2, 3]);
  assert.deepEqual(filtrar(I, { ocultas: new Set(['pagar']), busca: 'reun' }).map(i => i.uid), [3]);
  assert.deepEqual(filtrar(I, { feitos: false }).map(i => i.uid), [1, 2, 3, 4]);
  const D = porDia(I);
  assert.deepEqual(D.get('2026-11-12').map(i => i.uid), [4, 3, 2, 1]);
  const R = resumoDia(D.get('2026-11-12'));
  assert.equal(R.compromissos.length, 2); assert.deepEqual(R.grupos, [{ fonte: 'pagar', n: 2, valor: 100, atrasado: true, pendentes: 2 }]);
});

test('saldo projetado por dia', () => {
  const S = saldoPorDia({ saldo: 1000, hoje: '2026-11-12', ate: '2026-11-14', minimo: 500, fluxos: [{ data: '2026-11-01', valor: 200 }, { data: '2026-11-12', valor: -300 }, { data: '2026-11-13', valor: -700 }, { data: '2026-11-14', valor: 50 }, { data: '2026-11-20', valor: 999 }] });
  assert.deepEqual([...S].map(([k, v]) => [k, v.entra, v.sai, v.saldo, v.abaixo]), [['2026-11-12', 200, 300, 900, false], ['2026-11-13', 0, 700, 200, true], ['2026-11-14', 50, 0, 250, true]]);
  assert.equal(saldoPorDia({ saldo: 1000, hoje: '2026-11-12', ate: '2026-11-12', vencidosEmHoje: false, fluxos: [{ data: '2026-11-01', valor: 200 }] }).get('2026-11-12').saldo, 1000);
  assert.deepEqual([valorCurto(950), valorCurto(1234), valorCurto(-250000), valorCurto(2500000)], ['950', '1,2 mil', '−250 mil', '2,5 mi']);
});

test('fontes visíveis por área, papel e parâmetro da empresa', () => {
  const k = (o) => fontesVisiveis(o).map(f => f.k);
  const vendas = k({ temArea: (a) => a === 'com', temRH: () => false, papel: 'vendas' });
  assert.deepEqual(vendas, ['compromisso', 'contato', 'arte']);
  const fin = k({ temArea: (a) => a === 'fin', temRH: () => false, papel: 'financeiro', desligadas: ['cheque_emi'] });
  assert.ok(fin.includes('pagar') && fin.includes('contrato') && !fin.includes('cheque_emi') && !fin.includes('ferias'));
});

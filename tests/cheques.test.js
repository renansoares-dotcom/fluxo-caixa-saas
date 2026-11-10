// Controle de Cheques: CMC-7, prazos, alíneas, alertas, histórico do emitente, agenda, talão e valor por extenso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mod10, lerCMC7, prazos, proximoPasso, alineaTexto, alineaReapresenta, historicoEmitentes, riscoEmitente, alertas, agenda, folhasTalao, valorPorExtenso, validarRecebimento, rotuloSituacao } from '../js/lib/cheques.js';

const cmc7 = (banco, ag, comp, num, tipo, conta) => { const c2 = comp + num + tipo; return banco + ag + mod10(c2) + c2 + mod10(banco + ag) + conta + mod10(conta); };

test('CMC-7: separa banco, agência, conta e número e confere os dígitos', () => {
  const linha = cmc7('237', '1234', '018', '000456', '5', '0000067890');
  const r = lerCMC7(`<${linha.slice(0, 8)}<${linha.slice(8, 18)}>${linha.slice(18)}:`);
  assert.deepEqual({ banco: r.banco, agencia: r.agencia, conta: r.conta, numero: r.numero, valido: r.valido }, { banco: '237', agencia: '1234', conta: '67890', numero: '000456', valido: true });
  const errado = linha.slice(0, 29) + ((+linha[29] + 1) % 10);
  assert.equal(lerCMC7(errado).valido, false);
  assert.equal(lerCMC7('123'), null);
});

test('prazos: 30 dias na praça, 60 fora, prescrição em meses depois', () => {
  assert.deepEqual(prazos({ bom_para: '2026-11-10' }, {}), { base: '2026-11-10', apresentar: '2026-12-10', prescreve: '2027-06-10' });
  assert.equal(prazos({ bom_para: '2026-11-10', praca_outra: true }, { prazo_fora: 60 }).apresentar, '2027-01-09');
  assert.equal(prazos({ bom_para: '2026-08-01' }, { prazo_praca: 30, prescricao_meses: 6 }).prescreve, '2027-02-28');
});

test('próximo passo do cheque', () => {
  const cfg = { max_reapresentacoes: 1 };
  assert.equal(proximoPasso({ situacao: 'carteira', bom_para: '2026-11-20' }, cfg, '2026-11-10').k, 'aguardar');
  assert.equal(proximoPasso({ situacao: 'carteira', bom_para: '2026-11-01' }, cfg, '2026-11-10').k, 'depositar');
  assert.equal(proximoPasso({ situacao: 'carteira', bom_para: '2026-10-13' }, cfg, '2026-11-10').k, 'urgente');
  assert.equal(proximoPasso({ situacao: 'carteira', bom_para: '2026-09-01' }, cfg, '2026-11-10').k, 'vencido');
  assert.equal(proximoPasso({ situacao: 'devolvido', bom_para: '2026-11-01', devolucoes: 1, alinea: '11' }, cfg, '2026-11-10').k, 'reapresentar');
  assert.equal(proximoPasso({ situacao: 'devolvido', bom_para: '2026-11-01', devolucoes: 2, alinea: '12' }, cfg, '2026-11-10').k, 'cobrar');
  assert.equal(proximoPasso({ situacao: 'devolvido', bom_para: '2026-11-01', devolucoes: 1, alinea: '21' }, cfg, '2026-11-10').k, 'cobrar');
  assert.equal(proximoPasso({ situacao: 'devolvido', bom_para: '2025-01-01', devolucoes: 1, alinea: '11' }, cfg, '2026-11-10').k, 'prescrito');
});

test('alíneas', () => {
  assert.equal(alineaTexto('11'), '11 — Sem fundos — 1ª apresentação');
  assert.equal(alineaTexto('99'), '99');
  assert.equal(alineaReapresenta('11'), true);
  assert.equal(alineaReapresenta('13'), false);
  assert.equal(rotuloSituacao('fidc'), 'No FIDC');
});

const CH = [
  { numero: '1', valor: 1000, situacao: 'compensado', devolucoes: 0, emitente_doc: '111', emitente: 'Ana', bom_para: '2026-10-01' },
  { numero: '2', valor: 500, situacao: 'devolvido', devolucoes: 1, alinea: '11', emitente_doc: '111', bom_para: '2026-11-01' },
  { numero: '3', valor: 300, situacao: 'carteira', devolucoes: 0, emitente_doc: '222', emitente: 'Beto', bom_para: '2026-11-05' },
  { numero: '4', valor: 700, situacao: 'carteira', devolucoes: 0, favorecido_id: 'f1', bom_para: '2026-11-25' },
  { numero: '5', valor: 900, situacao: 'cancelado', devolucoes: 0, emitente_doc: '111', bom_para: '2026-11-25' },
  { numero: '6', valor: 250, situacao: 'depositado', devolucoes: 0, emitente_doc: '222', bom_para: '2026-11-09' },
];

test('histórico e risco do emitente', () => {
  const H = historicoEmitentes(CH);
  assert.equal(H.length, 3);
  assert.deepEqual({ qtd: H[0].qtd, dev: H[0].devolvidos, taxa: H[0].taxa, aberto: H[0].aberto, nome: H[0].emitente }, { qtd: 2, dev: 1, taxa: 0.5, aberto: 500, nome: 'Ana' });
  assert.equal(riscoEmitente(CH, { emitente_doc: '111' }).devolvidos, 1);
  assert.equal(riscoEmitente(CH, { emitente_doc: '999' }), null);
  assert.equal(riscoEmitente(CH, {}), null);
});

test('alertas: depositar, devolvidos e cheques próprios sem saldo', () => {
  const em = [{ numero: 10, valor: 800, situacao: 'emitido', bom_para: '2026-11-12', conta_id: 'c1' }, { numero: 11, valor: 100, situacao: 'emitido', bom_para: '2026-12-30', conta_id: 'c1' }, { numero: 12, valor: 50, situacao: 'devolvido', bom_para: '2026-11-01', conta_id: 'c1' }];
  const A = alertas({ cheques: CH, emitidos: em, cfg: {}, hoje: '2026-11-10', saldos: { c1: 500 } }), k = (x) => A.find(a => a.k === x);
  assert.equal(k('depositar').valor, 300);
  assert.equal(k('devolvidos').valor, 500);
  assert.equal(k('proprios').nivel, 'alto');
  assert.equal(k('proprios').valor, 800);
  assert.ok(k('proprio-devolvido'));
  assert.equal(alertas({ cheques: CH, emitidos: em, cfg: {}, hoje: '2026-11-10', saldos: { c1: 5000 } }).find(a => a.k === 'proprios').nivel, 'medio');
  assert.equal(alertas({ cheques: [], emitidos: [], hoje: '2026-11-10' }).length, 0);
});

test('agenda de compensação: atrasados caem em hoje, acumulado por dia', () => {
  const G = agenda({ cheques: CH, emitidos: [{ numero: 10, valor: 800, situacao: 'emitido', bom_para: '2026-11-12', conta_id: 'c1' }], hoje: '2026-11-10', dias: 30 });
  assert.deepEqual(G.map(x => [x.data, x.entra, x.sai, x.acumulado]), [['2026-11-10', 550, 0, 550], ['2026-11-12', 0, 800, -250], ['2026-11-25', 700, 0, 450]]);
});

test('talão: folhas livres e a próxima', () => {
  const t = { conta_id: 'c1', numero_ini: 100, numero_fim: 119 };
  assert.deepEqual(folhasTalao(t, [{ conta_id: 'c1', numero: 100 }, { conta_id: 'c1', numero: 101 }, { conta_id: 'c2', numero: 102 }, { conta_id: 'c1', numero: 300 }]), { total: 20, usadas: 2, livres: 18, proxima: 102 });
});

test('valor por extenso', () => {
  assert.equal(valorPorExtenso(1), 'um real');
  assert.equal(valorPorExtenso(0.01), 'um centavo');
  assert.equal(valorPorExtenso(1100), 'mil e cem reais');
  assert.equal(valorPorExtenso(1234.56), 'mil, duzentos e trinta e quatro reais e cinquenta e seis centavos');
  assert.equal(valorPorExtenso(21500), 'vinte e um mil e quinhentos reais');
  assert.equal(valorPorExtenso(1000000), 'um milhão de reais');
  assert.equal(valorPorExtenso(2500300.1), 'dois milhões, quinhentos mil e trezentos reais e dez centavos');
});

test('conferência do recebimento antes de gravar', () => {
  const ok = [{ banco: '001', agencia: '1', conta: '2', numero: '10', valor: 100, bom_para: '2026-11-10' }];
  assert.deepEqual(validarRecebimento(ok, { titulos: 100 }), []);
  assert.equal(validarRecebimento(ok, { titulos: 150 }).length, 1);
  assert.equal(validarRecebimento([...ok, ...ok]).length, 1);
  assert.equal(validarRecebimento(ok, { existentes: [{ banco: '001', agencia: '1', conta: '2', numero: '10', situacao: 'carteira' }] }).length, 1);
  assert.equal(validarRecebimento([{ banco: '', numero: '', valor: 0 }]).length, 3);
});

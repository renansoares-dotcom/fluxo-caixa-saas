// Contratos: alertas de vigência/aviso/reajuste, índice acumulado (janela de 12 meses) e conferência de assinatura no PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../js/lib/contratos.js';

const base = { status: 'vigente', natureza: 'pagar', valor: 1000, periodicidade: 'mensal', inicio: '2026-01-01', fim: '2026-12-31', aviso_previo_dias: 30, indice: 'IPCA', data_base: '2027-01-01', renovacao_automatica: false };
const ass = [{ tipo: 'assinado' }];

test('vencimento em até 90 dias e aviso prévio em até 30 dias', () => {
  const a = K.alertas(base, ass, [], '2026-11-20');
  assert.ok(a.find(x => x.k === 'vence' && x.nivel === 'warn'));
  assert.equal(a.find(x => x.k === 'aviso').data, '2026-12-01');
  assert.deepEqual(K.alertas(base, ass, [], '2026-06-01'), []);
});
test('vencido sem renovação × renovação automática', () => {
  assert.equal(K.alertas(base, ass, [], '2027-01-05')[0].k, 'vencido');
  assert.equal(K.alertas({ ...base, renovacao_automatica: true }, ass, [], '2027-01-05')[0].k, 'renovar');
  assert.equal(K.proximaVigencia(base), '2027-12-31');
});
test('reajuste: avisa na data-base, some depois de proposto e pede aprovação', () => {
  const c = { ...base, fim: null, data_base: '2026-12-15' };
  assert.ok(K.alertas(c, ass, [], '2026-12-01').some(x => x.k === 'reajuste'));
  assert.ok(K.alertas(c, ass, [{ data_base: '2026-12-15', status: 'proposto', percentual: 4.5 }], '2026-12-01').some(x => x.k === 'aprovar'));
  assert.ok(!K.alertas(c, ass, [{ data_base: '2026-12-15', status: 'aprovado', percentual: 4.5 }], '2026-12-20').some(x => /reajuste|aprovar/.test(x.k)));
});
test('sem PDF assinado e contratos fora de vigência', () => {
  assert.ok(K.alertas(base, [], [], '2026-06-01').some(x => x.k === 'sem-pdf'));
  assert.deepEqual(K.alertas({ ...base, status: 'encerrado' }, [], [], '2026-06-01'), []);
});
test('valor mensal equivalente', () => {
  assert.equal(K.valorMensal({ ...base, periodicidade: 'trimestral', valor: 3000 }), 1000);
  assert.equal(K.valorMensal({ ...base, natureza: 'sem_valor' }), 0);
});
test('índice: janela de 12 meses e acumulado composto', async () => {
  assert.deepEqual(K.janelaIndice('2026-04-10'), { ini: '01/03/2025', fim: '01/02/2026', rotulo: '03/2025 a 02/2026' });
  assert.equal(K.acumular(Array(12).fill(1)), 12.6825);
  const falso = async () => ({ ok: true, json: async () => Array.from({ length: 12 }, () => ({ data: '01/01/2026', valor: '0,50' })) });
  const r = await K.indiceAcumulado('IPCA', '2026-04-01', falso);
  assert.equal(r.percentual, 6.1678);
  assert.match(r.fonte, /série 433/);
  await assert.rejects(K.indiceAcumulado('IPCA', '2026-04-01', async () => ({ ok: true, json: async () => [] })));
  assert.equal(K.reajustar(1000, 6.1678), 1061.68);
});
test('assinatura digital no PDF', () => {
  const sem = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj');
  const com = new TextEncoder().encode('%PDF-1.7\n5 0 obj << /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 100 200 300] >> endobj');
  assert.equal(K.temAssinaturaDigital(sem), false);
  assert.equal(K.temAssinaturaDigital(com), true);
});

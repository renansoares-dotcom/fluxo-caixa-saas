// Frota: validade, consumo pelo tanque cheio, preventiva por km/tempo, alertas de motorista e multa, custo do mês.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/lib/frota.js';

const H = '2026-10-30';
test('validade de documentos', () => {
  assert.equal(F.validade('2026-10-29', H).nivel, 'neg');
  assert.equal(F.validade('2026-11-20', H).nivel, 'neg');
  assert.equal(F.validade('2026-12-20', H).nivel, 'warn');
  assert.equal(F.validade('2027-06-01', H).nivel, 'ok');
  const s = F.situacaoDocs([{ tipo: 'seguro', validade: '2026-01-01' }, { tipo: 'seguro', validade: '2027-01-01' }, { tipo: 'ipva', validade: '2026-12-31' }], H);
  assert.equal(s.find(d => d.tipo === 'seguro').validade, '2027-01-01');
});
test('consumo pelo tanque cheio, com abastecimento parcial no meio', () => {
  const ab = [
    { id: 1, data: '2026-10-01', km: 10000, litros: 300, tanque_cheio: true },
    { id: 2, data: '2026-10-03', km: 10300, litros: 50, tanque_cheio: false },
    { id: 3, data: '2026-10-05', km: 10700, litros: 150, tanque_cheio: true },   // 700 km / 200 l = 3,5
    { id: 4, data: '2026-10-08', km: 11100, litros: 160, tanque_cheio: true },   // 400 / 160 = 2,5
    { id: 5, data: '2026-10-08', km: 11100, litros: 20, combustivel: 'arla', tanque_cheio: false },
  ];
  const c = F.consumo(ab);
  assert.deepEqual(c.trechos.map(t => t.kml), [3.5, 2.5]);
  assert.equal(c.media, 3.06);                       // 1100 km / 360 l
  assert.deepEqual(F.foraDaMedia(c).map(t => t.id), [4]);
});
test('preventiva por km e por tempo', () => {
  assert.equal(F.preventiva({ a_cada_km: 20000, ultimo_km: 100000, ultima_data: '2026-06-01' }, 119500, H).nivel, 'warn');
  assert.equal(F.preventiva({ a_cada_km: 20000, ultimo_km: 100000 }, 121000, H).nivel, 'neg');
  const t = F.preventiva({ a_cada_meses: 6, ultima_data: '2026-04-15' }, null, H);
  assert.equal(t.dataProx, '2026-10-15'); assert.equal(t.nivel, 'neg');
  assert.equal(F.preventiva({ a_cada_km: 10000 }, 5000, H).nivel, 'info');
});
test('alertas do motorista e da multa', () => {
  const a = F.alertasMotorista({ ativo: true, vinculo: 'empregado', cnh_categoria: 'D', cnh_validade: '2026-11-15' }, H);
  assert.deepEqual(a.map(x => x.nivel), ['neg', 'warn', 'info']);
  assert.equal(F.alertaMulta({ situacao: 'a_indicar', prazo_indicacao: '2026-11-03' }, H).nivel, 'neg');
  assert.equal(F.alertaMulta({ situacao: 'paga', vencimento: '2026-10-01' }, H), null);
});
test('custo do veículo no mês', () => {
  const v = { id: 'v1' };
  const abast = [{ veiculo_id: 'v1', data: '2026-09-28', km: 9000, litros: 100, valor: 600 }, { veiculo_id: 'v1', data: '2026-10-10', km: 10000, litros: 300, valor: 1800 }, { veiculo_id: 'v1', data: '2026-10-20', km: 11000, litros: 300, valor: 1800 }];
  const c = F.custoMes(v, '2026-10', { abast, manut: [{ veiculo_id: 'v1', data: '2026-10-05', valor: 900 }], multas: [{ veiculo_id: 'v1', data_infracao: '2026-10-03', valor: 100, situacao: 'paga' }], locacaoMensal: 1200 });
  assert.equal(c.total, 5800); assert.equal(c.km, 2000); assert.equal(c.custoKm, 2.9); assert.equal(c.combustivel, 3600);
});

// CIOT pela IPEF (camada neutra): pedido montado da ficha e conferência do que falta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pedidoCIOT, faltasCIOT, lerRetorno, empresaGeraCIOT } from '../js/lib/ipef.js';

const emp = { cnpj: '11222333000181', razao_social: 'EMPRESA TESTE LTDA' };     // dados FICTÍCIOS
const tac = { nome: 'JOSE DA SILVA', tipo: 'tac', documento: '52998224725', rntrc: '12345678', conta_pix: '52998224725', conta_vinculo: 'proprio' };
const f = { numero: 9, data: '2026-11-24', valor: 4500, piso: 4200, km: 800, eixos: 5, lotacao: true, tipo_carga: 'geral', pedagio_nao_ha: true,
  mdfe: { carregamento: [{ cmun: '2604106', xmun: 'CARUARU', uf: 'PE' }], descarga: [{ cmun: '2927408', xmun: 'SALVADOR', uf: 'BA', chaves: [] }],
    veiculo: { placa: 'ABC1D23' }, condutor: { nome: 'JOSE DA SILVA', cpf: '52998224725' }, prod: { nome: 'EMBALAGENS' }, peso_kg: 7000, valor_carga: 42000,
    pag: { forma: 'pix', ind_pag: '0' } } };

test('pedido completo não tem faltas', () => {
  const p = pedidoCIOT(f, tac, emp);
  assert.equal(p.referencia, 'FRETE-9'); assert.equal(p.origem.cmun, '2604106'); assert.equal(p.destinos[0].uf, 'BA');
  assert.deepEqual(faltasCIOT(p), []);
});
test('abaixo do piso, sem motorista e sem vínculo da conta: aponta as faltas', () => {
  const p = pedidoCIOT({ ...f, valor: 3000, mdfe: { ...f.mdfe, condutor: { nome: '' } } }, { ...tac, conta_vinculo: null }, emp);
  const c = faltasCIOT(p).map(x => x.campo);
  assert.ok(c.includes('piso')); assert.ok(c.includes('motorista')); assert.ok(c.includes('vinculo'));
});
test('a prazo: parcelas precisam somar o frete', () => {
  const p = pedidoCIOT({ ...f, mdfe: { ...f.mdfe, pag: { forma: 'pix', ind_pag: '1', prazos: [{ venc: '2026-12-01', valor: 2000 }] } } }, tac, emp);
  assert.ok(faltasCIOT(p).some(x => x.campo === 'parcelas'));
});
test('retorno da IPEF e quem gera o CIOT', () => {
  assert.equal(lerRetorno({ ok: true, ciot: '1234.5678.9012' }).ciot, '123456789012');
  assert.equal(lerRetorno({ ok: true, ciot: '123' }).ok, false);
  assert.equal(empresaGeraCIOT({}, tac), true); assert.equal(empresaGeraCIOT({ ciot_por: 'transportadora' }, tac), false); assert.equal(empresaGeraCIOT({}, { tipo: 'etc' }), false);
});

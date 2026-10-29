// MDF-e: conferência da ficha do frete (NT 2026.001: CIOT obrigatório quando a IPLAMM emite com veículo de terceiro)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveValida, placaValida, rntrcValido, ciotValido, ciotObrigatorio, faltasMDFe, graves, prontoMDFe, descargaDasNotas, montarMDFe, dadosMDFe, diasAte } from '../js/lib/mdfe.js';

// monta uma chave fictícia válida (DV módulo 11)
function chave(base43) { let s = 0, p = 2; for (let i = 42; i >= 0; i--) { s += +base43[i] * p; p = p === 9 ? 2 : p + 1; } const dv = s % 11 < 2 ? 0 : 11 - (s % 11); return base43 + dv; }
const CH1 = chave('2610111222333000181550010000364881000000001'), CH2 = chave('2610111222333000181550010000364791000000002');
const TAC = { id: 't1', nome: 'Motorista Teste', tipo: 'tac', documento: '52998224725', rntrc: '12345678' };
const EMP = { cnpj: '11222333000181', ie: '123', razao_social: 'Empresa Teste' };
const COMPLETO = {
  id: 'f1', numero: 7, mdfe_emissor: 'iplamm', valor: 3000, ciot: '123456789012', placa: 'ABC1D23', motorista: 'João Teste', pedagio_nao_ha: true,
  mdfe: { uf_ini: 'PE', uf_fim: 'PE', carregamento: [{ cmun: '2604106', xmun: 'Caruaru', uf: 'PE' }],
    descarga: [{ cmun: '2611606', xmun: 'Recife', uf: 'PE', chaves: [CH1, CH2] }],
    veiculo: { placa: 'ABC1D23', tara: 7500, cap_kg: 14000, uf: 'PE', tp_rod: '01', tp_car: '02' }, condutor: { nome: 'João Teste', cpf: '52998224725' },
    peso_kg: 578.1, valor_carga: 8845.85, prod: { tp_carga: '05', nome: 'Embalagens plásticas', ncm: '39232190' },
    ciot_resp: '11222333000181', pag: { forma: 'ipef', cnpj_ipef: '11444777000161', ind_pag: '0' },
    seguro: { resp: '1', nome: 'Seguradora Teste', cnpj: '11444777000161', apolice: '999' } },
};

test('chave de acesso, placa, RNTRC e CIOT', () => {
  assert.equal(chaveValida(CH1), true);
  assert.equal(chaveValida(CH1.slice(0, 43) + ((+CH1[43] + 1) % 10)), false, 'dígito errado');
  assert.equal(chaveValida('123'), false);
  assert.equal(placaValida('ABC1D23'), true); assert.equal(placaValida('abc-1234'), true); assert.equal(placaValida('AB12345'), false);
  assert.equal(rntrcValido('12345678'), true); assert.equal(rntrcValido('1234567'), false);
  assert.equal(ciotValido('123456789012'), true); assert.equal(ciotValido('12345'), false);
});

test('CIOT obrigatório: IPLAMM emite com veículo de terceiro (rejeição 684)', () => {
  assert.equal(ciotObrigatorio({ mdfe_emissor: 'iplamm' }, TAC), true);
  assert.equal(ciotObrigatorio({ mdfe_emissor: 'transportadora' }, TAC), false);
  const semCiot = { ...COMPLETO, ciot: '' };
  assert.ok(graves(faltasMDFe(semCiot, TAC)).some(x => x.campo === 'ciot'));
});

test('ficha completa fica pronta; faltas aparecem com o campo', () => {
  assert.deepEqual(graves(faltasMDFe(COMPLETO, TAC)), []);
  assert.equal(prontoMDFe(COMPLETO, TAC), true);
  const ruim = { ...COMPLETO, mdfe: { ...COMPLETO.mdfe, condutor: { nome: '', cpf: '111' }, veiculo: { ...COMPLETO.mdfe.veiculo, tara: null }, uf_fim: 'SP' } };
  const campos = graves(faltasMDFe(ruim, TAC)).map(x => x.campo);
  for (const c of ['condutor', 'veiculo', 'uf_fim']) assert.ok(campos.includes(c), c);
  assert.deepEqual(faltasMDFe({ ...COMPLETO, mdfe_emissor: null }, TAC).map(x => x.campo), ['emissor']);
});

test('pagamento ao autônomo (infPag): IPEF e parcelas', () => {
  const semIpef = { ...COMPLETO, mdfe: { ...COMPLETO.mdfe, pag: { forma: 'ipef', cnpj_ipef: '' } } };
  assert.ok(faltasMDFe(semIpef, TAC).some(x => x.campo === 'pag'));
  const prazo = { ...COMPLETO, mdfe: { ...COMPLETO.mdfe, pag: { ...COMPLETO.mdfe.pag, ind_pag: '1', prazos: [{ venc: '2026-12-01', valor: 1000 }] } } };
  assert.ok(faltasMDFe(prazo, TAC).some(x => x.txt.includes('parcelas')));
});

test('NF-e agrupadas por município de descarga, com peso, valor e produto', () => {
  const r = descargaDasNotas([
    { chave: CH1, cmun: '2611606', xmun: 'Recife', uf: 'PE', peso_kg: 252.35, v_nf: 3701.65, produto: 'Saco', ncm: '39232190', emit_cmun: '2604106', emit_xmun: 'Caruaru', emit_uf: 'PE' },
    { chave: CH2, cmun: '2611606', xmun: 'Recife', uf: 'PE', peso_kg: 325.75, v_nf: 5144.2, produto: 'Bobina', ncm: '39201099' }]);
  assert.equal(r.descarga.length, 1); assert.deepEqual(r.descarga[0].chaves, [CH1, CH2]);
  assert.equal(r.peso_kg, 578.1); assert.equal(r.valor_carga, 8845.85);
  assert.equal(r.produto.nome, 'Bobina'); assert.deepEqual(r.carregamento, [{ cmun: '2604106', xmun: 'Caruaru', uf: 'PE' }]);
});

test('MDF-e montado no leiaute 3.00', () => {
  const m = montarMDFe(COMPLETO, TAC, EMP);
  assert.equal(m.ide.tpEmit, 2); assert.equal(m.ide.UFIni, 'PE');
  assert.deepEqual(m.infModal.rodo.infANTT.infCIOT, [{ CIOT: '123456789012', CNPJ: '11222333000181' }]);
  assert.equal(m.infModal.rodo.veicTracao.prop.CPF, '52998224725'); assert.equal(m.infModal.rodo.veicTracao.prop.RNTRC, '12345678');
  assert.equal(m.infModal.rodo.infANTT.infPag[0].vContrato, 3000); assert.deepEqual(m.infModal.rodo.infANTT.infPag[0].infBanc, { CNPJIPEF: '11444777000161' });
  assert.equal(m.infDoc.infMunDescarga[0].infNFe.length, 2); assert.equal(m.tot.qNFe, 2); assert.equal(m.tot.qCarga, 578.1);
});

test('padrões da empresa por baixo da ficha', () => {
  const d = dadosMDFe({ mdfe: {}, placa: 'xyz-9a87' }, { seguro: { nome: 'Seg', apolice: '1' }, prod: { nome: 'Embalagens' } });
  assert.equal(d.seguro.nome, 'Seg'); assert.equal(d.prod.nome, 'Embalagens'); assert.equal(d.prod.tp_carga, '05'); assert.equal(d.veiculo.placa, 'XYZ9A87');
  assert.equal(diasAte('2026-11-23', '2026-10-29'), 25);
});

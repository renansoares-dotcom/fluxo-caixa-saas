// Tabela oficial de classificação do IBS/CBS (SQL 171): regra de conferência de item, NCM do anexo e sugestões
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexar, validarItem, ncmAceito, sugestoes, validarNota, resumoClasstrib, modeloDaChave } from '../js/lib/rtc.js';
import { conferir, aliquotas } from '../js/lib/reforma.js';

const T = indexar({
  base: { versao_base: 'V0059' },
  cst: [{ cst: '000', descricao: 'Tributação integral', inicio: '2026-01-01', fim: null }, { cst: '200', descricao: 'Alíquota reduzida', inicio: '2026-01-01', fim: null }, { cst: '220', descricao: 'Alíquota fixa', inicio: '2026-01-01', fim: null }],
  classtrib: [
    { codigo: '000001', cst: '000', descricao: 'Situações tributadas integralmente', inicio: '2026-01-01', fim: null, modelos: [55, 65, 91], red_cbs: 0, red_ibs_uf: 0, red_ibs_mun: 0, credito_adquirente_cbs: true, credito_adquirente_ibs: true },
    { codigo: '200003', cst: '200', descricao: 'Alimentos da cesta básica (Anexo I)', inicio: '2026-01-01', fim: null, modelos: [55, 65], red_cbs: 100, red_ibs_uf: 100, red_ibs_mun: 100, credito_adquirente_cbs: false, credito_adquirente_ibs: false },
    { codigo: '200028', cst: '200', descricao: 'Serviços de educação', inicio: '2026-01-01', fim: null, modelos: [91], red_cbs: 60, red_ibs_uf: 60, red_ibs_mun: 60, credito_adquirente_cbs: true, credito_adquirente_ibs: true },
    { codigo: '220001', cst: '220', descricao: 'Incorporação imobiliária', inicio: '2026-01-01', fim: '2026-01-01', modelos: [55], red_cbs: 0, red_ibs_uf: 0, red_ibs_mun: 0 },
    { codigo: '200050', cst: '200', descricao: 'Classificação que começa em 2027', inicio: '2027-01-01', fim: null, modelos: [55], red_cbs: 30, red_ibs_uf: 40, red_ibs_mun: 40, credito_adquirente_cbs: true }],
  ncm: [{ id: 1, codigo: '200003', ncm: '1006', inicio: '2026-01-01', fim: null }, { id: 2, codigo: '200003', ncm: '0713', inicio: '2026-01-01', fim: null }, { id: 3, codigo: '200003', ncm: '0201', inicio: '2026-01-01', fim: '2026-06-30' }],
  exc: [{ id: 1, vinculo_id: 2, ncm: '07134090', inicio: '2026-01-01', fim: null }] });
const v = (cst, classtrib, ncm, o = {}) => validarItem(T, { cst, classtrib, ncm }, { data: '2026-10-15', ...o });

test('item sem CST e sem cClassTrib não é conferido; tabela vazia não acusa nada', () => {
  assert.deepEqual(v('', '', '39012029').motivos, []);
  assert.equal(validarItem(indexar(), { cst: '999', classtrib: '999999' }).nivel, 'ok');
});
test('tributação integral com NCM qualquer confere', () => { const r = v('000', '000001', '39012029'); assert.equal(r.nivel, 'ok'); assert.equal(r.ct.codigo, '000001'); });
test('cClassTrib que não existe, CST que não existe e CST sem cClassTrib', () => {
  assert.match(v('000', '000777', '39012029').motivos[0], /não existe na tabela oficial/); assert.equal(v('000', '000777', '1').nivel, 'neg');
  assert.match(v('999', '000001', '39012029').motivos[0], /CST 999 não existe/);
  const r = v('000', '', '39012029'); assert.equal(r.nivel, 'warn'); assert.match(r.motivos[0], /sem cClassTrib/);
});
test('cClassTrib de outro CST', () => { const r = v('000', '200003', '10063021'); assert.equal(r.nivel, 'neg'); assert.match(r.motivos[0], /é do CST 200, mas o item está com CST 000/); });
test('vigência: encerrada e ainda não iniciada', () => {
  assert.match(v('220', '220001', '39012029').motivos[0], /fora de vigência em 15\/10\/2026 \(vale de 01\/01\/2026 a 01\/01\/2026\)/);
  assert.match(v('200', '200050', '39012029').motivos[0], /a partir de 01\/01\/2027/);
  assert.equal(v('200', '200050', '39012029', { data: '2027-02-01' }).nivel, 'ok');
});
test('documento que não aceita a classificação é atenção, não erro', () => { const r = v('200', '200028', '', { modelo: 55 }); assert.equal(r.nivel, 'warn'); assert.match(r.motivos[0], /não é aceito em NF-e/); assert.equal(v('200', '200028', '', { modelo: 91 }).nivel, 'ok'); });
test('NCM do anexo: mesma regra da calculadora da Receita', () => {
  assert.equal(ncmAceito(T, '000001', '39012029', '2026-10-15'), 'livre');
  assert.equal(ncmAceito(T, '200003', '10063021', '2026-10-15'), 'ok');
  assert.equal(ncmAceito(T, '200003', '39012029', '2026-10-15'), 'fora');
  assert.equal(ncmAceito(T, '200003', '1006', '2026-10-15'), 'incompleto');
  assert.equal(ncmAceito(T, '200003', '07133319', '2026-10-15'), 'ok');          // vínculo com exceção que não cobre este NCM
  assert.equal(ncmAceito(T, '200003', '07134090', '2026-10-15'), 'fora');        // o excepcionado
  assert.equal(ncmAceito(T, '200003', '02013000', '2026-03-01'), 'ok');          // vínculo ainda em vigor
  assert.equal(ncmAceito(T, '200003', '02013000', '2026-10-15'), 'fora');        // vínculo encerrado
  assert.match(v('200', '200003', '39012029').motivos[0], /NCM 39012029 não consta do anexo do cClassTrib 200003/);
  assert.match(v('200', '200003', '1006').motivos[0], /exige o NCM completo/);
});
test('resumo da classificação: redução e crédito', () => {
  assert.equal(resumoClasstrib(T.ct.get('200003')), 'Alimentos da cesta básica (Anexo I) · redução de 100% · sem crédito para quem compra');
  assert.equal(resumoClasstrib(T.ct.get('000001')), 'Situações tributadas integralmente');
  assert.match(resumoClasstrib(T.ct.get('200050')), /redução de 30% na CBS e 40% no IBS/);
});
test('sugestões: primeiro a classificação cujo anexo cita o NCM, só as vigentes e aceitas no documento', () => {
  const s = sugestoes(T, { ncm: '10063021', data: '2026-10-15', modelo: 55 });
  assert.deepEqual(s.map(x => x.codigo), ['200003', '000001']); assert.equal(s[0].especifico, true);
  assert.deepEqual(sugestoes(T, { ncm: '39012029', data: '2026-10-15', modelo: 55 }).map(x => x.codigo), ['000001']);
  assert.deepEqual(sugestoes(T, { ncm: '', data: '2026-10-15', modelo: 91 }).map(x => x.codigo), ['000001', '200028']);
});
test('modelo pela chave de acesso', () => { assert.equal(modeloDaChave('2626111467733800019755001000012345' + '1234567890'), 55); assert.equal(modeloDaChave('2626111467733800019757001000012345' + '1234567890'), 57); assert.equal(modeloDaChave(''), 55); });
test('nota: junta os motivos sem repetir e lista as reduções válidas', () => {
  const r = validarNota(T, [{ cst_ibscbs: '000', cclass_trib: '000777', ncm: '1' }, { cst_ibscbs: '000', cclass_trib: '000777', ncm: '2' }, { cst_ibscbs: '200', cclass_trib: '200003', ncm: '10063021' }], { data: '2026-10-15' });
  assert.equal(r.nivel, 'neg'); assert.deepEqual(r.motivos, ['cClassTrib 000777 não existe na tabela oficial (2 itens)']); assert.deepEqual(r.reducoes, ['200003: redução de 100%']);
});
test('conferência da nota usa a tabela oficial: divergente na nota da empresa, atenção na de terceiros', () => {
  const L = aliquotas([]), nt = { emissao: '2026-10-15', v_bc_ibscbs: 1000, v_cbs: 9, v_ibs: 1, v_prod: 1000, emissao_propria: true };
  const it = [{ cst_ibscbs: '000', cclass_trib: '200003', ncm: '10063021' }];
  assert.equal(conferir(nt, L, it).nivel, 'ok');                                         // sem a tabela, segue como antes
  const p = conferir(nt, L, it, { rtc: T }); assert.equal(p.nivel, 'neg'); assert.match(p.motivos.join(' '), /é do CST 200/);
  assert.equal(conferir({ ...nt, emissao_propria: false }, L, it, { rtc: T }).nivel, 'warn');
  const ok = conferir(nt, L, [{ cst_ibscbs: '000', cclass_trib: '000001', ncm: '39012029' }], { rtc: T }); assert.equal(ok.nivel, 'ok'); assert.deepEqual(ok.motivos, ['confere']);
  const red = conferir({ ...nt, v_cbs: 0, v_ibs: 0 }, L, [{ cst_ibscbs: '200', cclass_trib: '200003', ncm: '10063021' }], { rtc: T });
  assert.equal(red.nivel, 'ok'); assert.equal(red.esperadoCbs, 0); assert.deepEqual(red.motivos, ['confere']);            // redução única: o valor é conferido
  const errado = conferir(nt, L, [{ cst_ibscbs: '200', cclass_trib: '200003', ncm: '10063021' }], { rtc: T }); assert.equal(errado.nivel, 'neg'); assert.match(errado.motivos[0], /CBS R\$\s9,00; esperado R\$\s0,00 \(0,9% da base, com redução de 100%\)/);
  const misto = conferir(nt, L, [{ cst_ibscbs: '200', cclass_trib: '200003', ncm: '10063021' }, { cst_ibscbs: '000', cclass_trib: '000001', ncm: '39012029' }], { rtc: T });
  assert.equal(misto.nivel, 'info'); assert.match(misto.motivos[0], /CST 200 com classificação válida \(200003: redução de 100%\)/);
});

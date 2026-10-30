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

// ---- modelos (SQL 069)
import * as M from '../js/lib/contratos-modelos.js';
const empresa = { razao_social: 'EMPRESA EXEMPLO LTDA', cnpj: '11222333000181', logradouro: 'Rua A, 1', municipio: 'Caruaru', uf: 'PE', responsavel_nome: 'FULANA', responsavel_cpf: '52998224725' };
const ctr = { numero: 7, natureza: 'pagar', objeto: 'Serviço', valor: 1250.5, periodicidade: 'mensal', dia_vencimento: 10, inicio: '2026-11-01', fim: '2027-10-31', aviso_previo_dias: 30, indice: 'IPCA', data_base: '2027-11-01', dados: {} };
test('valor por extenso', () => {
  assert.equal(M.extenso(1250.5), 'mil duzentos e cinquenta reais e cinquenta centavos');
  assert.equal(M.extenso(18500), 'dezoito mil e quinhentos reais');
  assert.equal(M.extenso(1000000), 'um milhão de reais');
  assert.equal(M.extenso(101), 'cento e um reais');
  assert.equal(M.extenso(0.01), 'um centavo');
});
test('todos os modelos geram o documento', () => {
  for (const id of Object.keys(M.MODELOS)) {
    const x = M.contexto({ empresa, contrato: ctr, parte: { nome: 'PARTE EXEMPLO', doc: '52998224725', endereco: 'Rua B, 2' } });
    const h = M.documento(id, x, { data: '2026-10-30' });
    assert.match(h, /EMPRESA EXEMPLO LTDA/); assert.match(h, /PARTE EXEMPLO/); assert.match(h, /30 de outubro de 2026/);
  }
});
test('transporte com autônomo cita CIOT, IPEF, piso e vale-pedágio; faltas apontadas', () => {
  const x = M.contexto({ empresa, contrato: { ...ctr, natureza: 'sem_valor' }, parte: { nome: 'JOSÉ', doc: '52998224725' } });
  const h = M.documento('transporte_tac', x);
  for (const t of ['CIOT', 'IPEF', 'piso mínimo', 'Vale-Pedágio', '11.442/2007']) assert.ok(h.includes(t), t);
  assert.deepEqual(M.faltas('transporte_tac', x), ['endereço da outra parte (cadastro do beneficiário)', 'placa do veículo', 'RNTRC']);
  const s = M.documento('servico', M.contexto({ empresa, contrato: ctr, parte: { nome: 'P', doc: '11222333000181' } }));
  assert.match(s, /R\$\s1\.250,50 \(mil duzentos e cinquenta reais e cinquenta centavos\) por mês/);
  assert.ok(s.includes('variação acumulada do IPCA'));
  assert.equal(M.MODELO_PADRAO('agregado'), 'agregado'); assert.equal(M.MODELO_PADRAO('locacao_imovel'), 'servico');
});

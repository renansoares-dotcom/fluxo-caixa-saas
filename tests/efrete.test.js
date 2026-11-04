// e-frete: montagem da operação do CIOT a partir do frete, do transportador, das NF-e e dos parâmetros (dados FICTÍCIOS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarOperacao, ciot12, periodoPadrao, tipoPix, enderecoDest, pesoNota } from '../supabase/functions/efrete/operacao.js';

const end = { rua: 'RUA DAS FLORES', numero: '10', bairro: 'CENTRO', cep: '55000-000', cmun: '2604106' };
const transp = { nome: 'JOSE TRANSPORTES', documento: '52998224725', rntrc: '12345678', endereco: end,
  veiculos: [{ placa: 'ABC1D23', eixos: 3, chassi: '9BM384078KB123456', renavam: '12345678901' }],
  motoristas: [{ nome: 'JOSE', cpf: '52998224725', cnh: '01234567890', nascimento: '1980-01-02', ddd: '81', celular: '999990000' }],
  conta_pix: 'jose@exemplo.com' };
const frete = { numero: 7, data: '2026-11-10', valor: 2500, piso: 2000, lotacao: true, km: 140, tabela: 'A', tipo_carga: 'geral', retorno_vazio: false,
  mdfe: { veiculo: { placa: 'ABC1D23', tp_rod: '01', tp_car: '02', renavam: '12345678901' }, condutor: { nome: 'JOSE', cpf: '529.982.247-25' },
    carregamento: [{ cmun: '2604106', xmun: 'Caruaru' }], descarga: [{ cmun: '2611606', xmun: 'Recife', chaves: ['x'] }] } };
const notas = [{ numero: 101, serie: '1', emissao: '2026-11-09', v_nf: 30000, peso_kg: 5000, ncm: '39232190', emit_doc: '11222333000181',
  dest_doc: '11444777000161', dest_nome: 'CLIENTE', dest_end: { rua: 'AV X', numero: '1', bairro: 'B', cep: '50000000', cmun: '2611606' } }];
const cfg = { tipo_pagamento: 'eFRETE', pct_adiantamento: 40, dias_liberacao_quitacao: 2, docs_credenciado: ['Canhoto da NF-e assinado', 'Comprovante de entrega'],
  entrega_documentacao: 'RedeCredenciada', tipo_embalagem: 'Pallet', unidade_medida: 'Kg', tipo_calculo: 'SemQuebra', contratante_endereco: end };
const base = { frete, transp, empresa: { cnpj: '11.222.333/0001-81', razao_social: 'EMPRESA TESTE LTDA' }, config: cfg, tipos: { geral: 5 }, notas,
  inicio: '2026-11-10T11:00:00Z', fim: '2026-11-12T11:00:00Z', idOperacao: 'F7-abc' };

test('monta a operação completa sem faltas', () => {
  const { faltas, op, cadastros, resumo } = montarOperacao(base);
  assert.deepEqual(faltas, []);
  assert.equal(op.TipoViagem, 'Padrao');
  assert.equal(op.MatrizCNPJ, '11222333000181');
  assert.equal(op.CodigoTipoCarga, 5);
  assert.equal(op.CodigoNCMNaturezaCarga, '3923');
  assert.equal(op.DataInicioViagem, '2026-11-10T08:00:00');
  assert.ok(Array.isArray(op.Viagens) && Array.isArray(op.Viagens[0].NotasFiscais));
  assert.equal(op.Viagens[0].Valores.TotalDeAdiantamento, 1000);
  assert.equal(op.Viagens[0].Valores.TotalDeQuitacao, 1500);
  assert.equal(op.Pagamentos.length, 2);
  assert.equal(op.Pagamentos[1].DataDeLiberacao, '2026-11-14T08:00:00');
  assert.equal(op.Pagamentos[0].CpfCnpjCreditado, '52998224725');
  assert.equal(op.Motorista.CNH, '01234567890');
  assert.deepEqual(op.Motorista.Celular, { DDD: 81, Numero: 999990000 });
  assert.equal(op.Destinatario.CpfOuCnpj, '11444777000161');
  assert.equal(op.Contratante.Endereco.CEP, '55000000');
  assert.deepEqual(op.ObservacoesAoCredenciado, cfg.docs_credenciado);
  assert.equal(op.Viagens[0].NotasFiscais[0].ValorDaMercadoriaPorUnidade, 6);
  assert.equal(cadastros.veiculos[0].Veiculo.TipoRodado, 'Truck');
  assert.equal(cadastros.veiculos[0].Veiculo.TipoCarroceria, 'FechadaOuBau');
  assert.equal(cadastros.motorista.DataNascimento, '1980-01-02T00:00:00');
  assert.equal(resumo.codigo_antt, 5);
});

test('aponta o que falta e de onde vem', () => {
  const t2 = { ...transp, endereco: {}, veiculos: [{ placa: 'ABC1D23', eixos: 3 }], motoristas: [] };
  const { faltas } = montarOperacao({ ...base, transp: t2, tipos: {}, config: { ...cfg, contratante_endereco: {} }, frete: { ...frete, valor: 1500 } });
  const txt = faltas.map(f => `${f.onde}: ${f.txt}`).join(' | ');
  for (const s of ['endereço do transportador', 'motorista do CPF', 'chassi', 'abaixo do piso', 'endereço da empresa contratante', 'código ANTT']) assert.match(txt, new RegExp(s));
});

test('sem adiantamento: só a quitação; transferência usa o Pix', () => {
  const { op, faltas } = montarOperacao({ ...base, config: { ...cfg, pct_adiantamento: 0, tipo_pagamento: 'DepositoAgendado' } });
  assert.deepEqual(faltas, []);
  assert.equal(op.Pagamentos.length, 1);
  assert.equal(op.Pagamentos[0].Categoria, 'Quitacao');
  assert.equal(op.Pagamentos[0].TipoChavePix, 'Email');
  assert.equal(op.ObservacoesAoCredenciado, undefined);
});

test('auxiliares', () => {
  assert.equal(ciot12('560000609941/2757'), '560000609941');
  assert.equal(tipoPix('52998224725'), 'CpfOuCnpj');
  assert.equal(tipoPix('8b0e1c2a-1111-2222-3333-444455556666'), 'ChaveAleatoria');
  const p = periodoPadrao('2026-11-10', 24, Date.parse('2026-11-01T12:00:00Z'));
  assert.equal(p.inicio, '2026-11-10T11:00:00.000Z');
  assert.equal(p.fim, '2026-11-11T11:00:00.000Z');
  const xml = '<dest><enderDest><xLgr>RUA A</xLgr><nro>5</nro><xBairro>B</xBairro><cMun>2611606</cMun><CEP>50000000</CEP></enderDest></dest><vol><pesoB>10.500</pesoB></vol><vol><pesoB>2</pesoB></vol>';
  assert.deepEqual(enderecoDest(xml), { rua: 'RUA A', numero: '5', complemento: '', bairro: 'B', cep: '50000000', cmun: '2611606' });
  assert.equal(pesoNota(xml), 12.5);
});

// Cadastro pelas notas de entrada (SQL 085): limpeza da descrição, grau do material, classificação, unidade/fator, agrupamento e curva ABC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/lib/cadastro-massa.js';

const F = ['RESINA', 'MASTER', 'TINTA', 'EMBAL', 'PECA', 'EPI', 'NAOEST', 'FERRAM', 'CONSUMO', 'IMOB'].map(c => ({ id: 'f-' + c, codigo: c }));
const R = [
  { ordem: 10, familia_id: 'f-NAOEST', ncm_prefixos: ['2716'], palavras: [] },
  { ordem: 12, familia_id: 'f-NAOEST', ncm_prefixos: [], palavras: ['SERVICO'] },
  { ordem: 20, familia_id: 'f-FERRAM', ncm_prefixos: ['8442'], palavras: ['CLICHE', 'ANILOX'] },
  { ordem: 30, familia_id: 'f-EPI', ncm_prefixos: ['6403'], palavras: [' CA ', 'LUVA'] },
  { ordem: 70, familia_id: 'f-MASTER', ncm_prefixos: ['3206'], palavras: ['MASTER', 'MB '] },
  { ordem: 80, familia_id: 'f-RESINA', ncm_prefixos: ['3901', '3902'], palavras: [] },
  { ordem: 100, familia_id: 'f-IMOB', ncm_prefixos: ['84'], palavras: [], valor_unit_min: 1200 },
  { ordem: 110, familia_id: 'f-PECA', ncm_prefixos: ['84', '85'], palavras: [] },
  { ordem: 200, familia_id: 'f-CONSUMO', ncm_prefixos: [], palavras: [] },
];

test('limpa a descrição da nota', () => {
  assert.equal(C.limpar('TELHA TRAPEZOIDAL TP40 0.43X1032 MT QTD. 98.00 MT'), 'TELHA TRAPEZOIDAL TP40 0.43X1032 MT');
  assert.equal(C.limpar('(006970/01006866-01) CLICHE 1.14 (DIGITAL) SACO CAFE'), 'CLICHE 1.14 (DIGITAL) SACO CAFE', 'tira só o código; o que é informação fica');
  assert.equal(C.limpar('PEBD 2022N SC 25KG'), 'PEBD 2022N');
  assert.equal(C.limpar('Cimento todas as obras CPII 50kg Poty -'), 'CIMENTO TODAS AS OBRAS CPII 50KG POTY');
});

test('grau do material', () => {
  assert.equal(C.grau('PEBD 2022N SC 25KG'), '2022N');
  assert.equal(C.grau('POLIETILENO BAIXA DENSIDADE 2022N'), '2022N');
  assert.equal(C.grau('PL720N COMPOSTO POLIMERICO PEBDL C/ CARGA'), 'PL720N');
  assert.equal(C.grau('POLIETILENO DE ALTA DENSIDADE'), null);
  assert.equal(C.grau('FX ADITIVO SLIP USO 4% A 6% 25KG'), null, 'unidade não é grau');
  assert.equal(C.grau('MB BRANCO 70% TIO2'), null, 'fórmula química não é grau');
  assert.equal(C.grau('PELBD 118W'), null, 'parece potência (200W): no máximo deixa de juntar fornecedores');
});

test('classifica pela primeira regra que casa', () => {
  const k = (descricao, ncm, valor = 100, quantidade = 1) => C.classificar({ descricao, ncm, valor, quantidade }, R);
  assert.equal(k('ENERGIA ELETRICA', '27160000'), 'f-NAOEST');
  assert.equal(k('SERVIÇO DE USINAGEM', '00000000'), 'f-NAOEST', 'palavra sem acento');
  assert.equal(k('CLICHE 1.14 DIGITAL', '39219019'), 'f-FERRAM', 'palavra vence o NCM de outra família quando vem antes');
  assert.equal(k('BOTA DE COURO CA 17015', '64039990'), 'f-EPI');
  assert.equal(k('CARRO DE MAO', '87168000'), 'f-CONSUMO', '" CA " não casa com CARRO');
  assert.equal(k('MB DESLIZANTE', '38123900'), 'f-MASTER');
  assert.equal(k('COPOLIMERO DE ETILENO', '39014000'), 'f-RESINA');
  assert.equal(k('COMPRESSOR', '84148019', 15000), 'f-IMOB', 'máquina cara sugere imobilizado');
  assert.equal(k('ROLAMENTO 6205', '84821010', 90), 'f-PECA', 'peça barata fica em peças');
  assert.equal(k('ROLAMENTO 6205', '84821010', 9000, 100), 'f-PECA', 'valor unitário, não o total');
  assert.equal(k('AGUA MINERAL', '22011000'), 'f-CONSUMO');
});

test('unidade do produto e fator', () => {
  assert.deepEqual(C.unidadeFator({ unidade: 'SC', descricao: 'PEBD 2022N SC 25KG' }, 'RESINA'), { unidade: 'KG', fator: 25 });
  assert.deepEqual(C.unidadeFator({ unidade: 'BB', descricao: 'PEAD BIG BAG 1.250 KG' }, 'RESINA'), { unidade: 'KG', fator: 1250 });
  assert.deepEqual(C.unidadeFator({ unidade: 'TON', descricao: 'PEBD' }, 'RESINA'), { unidade: 'KG', fator: 1000 });
  assert.deepEqual(C.unidadeFator({ unidade: 'kg', descricao: 'X' }, 'RESINA'), { unidade: 'KG', fator: 1 });
  assert.deepEqual(C.unidadeFator({ unidade: 'PC', descricao: 'ROLAMENTO' }, 'PECA'), { unidade: 'PC', fator: 1 });
  assert.equal(C.unidadeFator({ unidade: 'SC', descricao: 'PEBD SEM PESO' }, 'RESINA').revisar, true, 'saco sem peso na descrição: revisar');
});

test('agrupa o mesmo grau de fornecedores diferentes e ordena pela curva ABC', () => {
  const itens = [
    { emit_doc: '1', codigo_fornecedor: 'R1', descricao: 'PEBD 2022N SC 25KG', ncm: '39011010', unidade: 'SC', quantidade: 40, valor: 80000 },
    { emit_doc: '2', codigo_fornecedor: '9', descricao: 'POLIETILENO BAIXA DENSIDADE 2022N', ncm: '39011090', unidade: 'KG', quantidade: 1000, valor: 10000 },
    { emit_doc: '3', codigo_fornecedor: 'E', descricao: 'ENERGIA ELETRICA', ncm: '27160000', unidade: 'KWH', quantidade: 1, valor: 6000 },
    { emit_doc: '4', codigo_fornecedor: 'S', descricao: 'SERVICO DE MANUTENCAO', ncm: '', unidade: 'UN', quantidade: 1, valor: 1000 },
    { emit_doc: '5', codigo_fornecedor: 'L', descricao: 'LUVA NITRILICA CA 12254', ncm: '40151900', unidade: 'PAR', quantidade: 10, valor: 300 },
  ];
  const g = C.agrupar(itens, R, F);
  assert.equal(g.length, 3, 'resina (2 fornecedores), não é estoque (energia + serviço), EPI');
  assert.equal(g[0].grau, '2022N'); assert.equal(g[0].itens.length, 2); assert.equal(g[0].fornecedores, 2); assert.equal(g[0].unidade, 'KG');
  assert.deepEqual(g[0].itens.map(i => i.fator), [25, 1]);
  assert.equal(g[0].curva, 'A'); assert.equal(g[1].nao_estoque, true); assert.equal(g[1].itens.length, 2);
  assert.equal(g[2].curva, 'C'); assert.ok(Math.abs(g[2].acumulado - 1) < 1e-9);
  const p = C.payload([g[0], g[1]]);
  assert.equal(p[0].familia_id, 'f-RESINA'); assert.equal(p[0].itens[0].fator, 25); assert.equal(p[1].nao_estoque, true);
});

test('produto parecido já cadastrado', () => {
  const prods = [{ id: 'p1', codigo: 'RES-0001', descricao: 'PEBD 2022N', tipo: 'materia_prima', ncm: '39011010' }, { id: 'p2', codigo: '100', descricao: 'SACO PEBD 2022N', tipo: 'produto_acabado' }];
  assert.equal(C.parecido({ descricao: 'POLIETILENO BAIXA DENSIDADE 2022N', grau: '2022N', ncm: '39011010' }, prods)?.id, 'p1');
  assert.equal(C.parecido({ descricao: 'ROLAMENTO', ncm: '8482' }, prods), null);
});

test('prontidão em % do valor', () => {
  const r = C.prontidao({ resumo: [{ sentido: 'entrada', resultado: 'ok', itens: 8, valor: 900 }, { sentido: 'entrada', resultado: 'nao_movimenta', itens: 1, valor: 50 }, { sentido: 'entrada', resultado: 'sem_produto', itens: 5, valor: 50 }] });
  assert.equal(r.entrada.pct, 0.95); assert.equal(r.entrada.porMotivo.sem_produto.itens, 5); assert.equal(r.saida.pct, 1);
});

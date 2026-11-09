import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normNome, semelhanca, duplicados, completude, CAMPOS_FAV, CAMPOS_PROD, lerReceita, diferencas } from '../js/lib/qualidade-cadastro.js';

test('nome normalizado e semelhança', () => {
  assert.equal(normNome('Resinas do Brasil Ltda.'), 'RESINAS BRASIL');
  assert.equal(semelhanca('RESINAS DO BRASIL LTDA', 'Resinas Brasil S/A'), 1);
  assert.ok(semelhanca('COLOR MASTER TINTAS', 'COLORMASTER TINTAS') > 0.85);
  assert.ok(semelhanca('COLOR MASTER', 'PAPELÃO DO CABO') < 0.3);
});

test('duplicados por documento e por nome', () => {
  const L = [{ id: 'a', tipo: 'F', nome: 'RESINAS DO BRASIL LTDA', documento: '12.345.678/0001-90' }, { id: 'b', tipo: 'F', nome: 'RESINAS BRASIL', documento: '12345678000190' },
    { id: 'c', tipo: 'F', nome: 'COLOR MASTER TINTAS', documento: '' }, { id: 'd', tipo: 'F', nome: 'COLORMASTER TINTAS LTDA', documento: null },
    { id: 'e', tipo: 'C', nome: 'RESINAS DO BRASIL', documento: '12345678000190' }, { id: 'f', tipo: 'F', nome: 'COLOR MASTER TINTAS', documento: '11222333000181' },
    { id: 'g', tipo: 'F', nome: 'COLOR MASTER TINTAS', documento: '99888777000166' }, { id: 'h', tipo: 'F', nome: 'X', ativo: false, documento: '12345678000190' }];
  const G = duplicados(L);
  assert.equal(G[0].motivo, 'documento'); assert.deepEqual(G[0].itens.map(x => x.id).sort(), ['a', 'b']);
  assert.ok(G.some(g => g.motivo === 'nome' && g.chave === 'c|d'));
  assert.ok(!G.some(g => g.chave === 'f|g'));                       // documentos diferentes
  assert.ok(!G.some(g => g.itens.some(x => x.id === 'e')));          // cliente × fornecedor
  assert.ok(!duplicados(L, { ignorados: new Set(['c|d']) }).some(g => g.chave === 'c|d'));
});

test('completude', () => {
  const C = completude({ documento: '11.222.333/0001-81', logradouro: 'R', municipio: 'M', uf: 'PE', cep: '1', email: 'a@b.com', telefone: '81 3333-4444', pix: 'x', ie: '1', receita_situacao: 'ATIVA' }, CAMPOS_FAV);
  assert.equal(C.nota, 100);
  const D = completude({ documento: '123', email: 'x' }, CAMPOS_FAV, { receita: 0 });
  assert.equal(D.nota, 0); assert.equal(D.faltam.length, 6);
  assert.equal(completude({ ncm: '3923.21.90', unidade: 'KG', grupo: 'G', tipo: 'materia_prima', ponto_pedido: 10, descricao: 'PEBD CRISTAL 2020' }, CAMPOS_PROD).nota, 100);
});

test('Receita: leitura e diferenças', () => {
  const R = lerReceita({ cnpj: '11222333000181', razao_social: 'COLOR MASTER TINTAS LTDA', nome_fantasia: '', descricao_tipo_de_logradouro: 'RUA', logradouro: 'DAS FLORES', numero: '10', bairro: 'CENTRO',
    municipio: 'CARUARU', uf: 'PE', cep: '55000000', ddd_telefone_1: '8133334444', descricao_situacao_cadastral: 'ATIVA', cnae_fiscal: 2071100, cnae_fiscal_descricao: 'Fabricação de tintas' });
  assert.equal(R.situacao, 'ATIVA'); assert.equal(R.campos.cep, '55000-000'); assert.equal(R.campos.logradouro, 'RUA DAS FLORES');
  const D = diferencas({ nome: 'Color Master Tintas Ltda', municipio: 'Recife', uf: '' }, R);
  assert.ok(!D.some(d => d.campo === 'nome')); assert.ok(D.some(d => d.campo === 'municipio' && !d.vazio)); assert.ok(D.some(d => d.campo === 'uf' && d.vazio));
});

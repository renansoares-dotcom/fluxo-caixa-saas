import { state } from '../lib/data.js';
import { crudPage } from '../lib/crud.js';

export const title = 'Favorecidos';
const TIPOS = [['FORNECEDORES', 'FOR'], ['CLIENTES', 'CLI'], ['FUNCIONÁRIOS', 'FUN'], ['SÓCIOS', 'SÓC'], ['CONSULTORES', 'CON'], ['OUTROS', 'OUT'], ['TERCEIROS - CLIENTES', 'TER'], ['REPRESENTANTES', 'REP']];

export async function render(root) {
  crudPage(root, {
    table: 'favorecidos',
    rows: () => state.cad.favorecidos,
    busca: (r) => `${r.nome} ${r.documento || ''} ${r.tipo} ${r.segmento || ''}`,
    cols: [
      { k: 'tipo', t: 'Tipo' }, { k: 'nome', t: 'Nome', wrap: true }, { k: 'segmento', t: 'Segmento' }, { k: 'documento', t: 'CNPJ / CPF' },
      { k: 'forma_pagamento', t: 'Forma de pagamento' }, { k: 'periodicidade', t: 'Periodicidade' },
      { k: 'ativo', t: '', fmt: r => r.ativo ? '' : '<span class="badge vencido">inativo</span>' },
    ],
    fields: [
      { k: 'tipo', t: 'Tipo', type: 'select', req: true, value: 'id', label: 'id', def: 'FORNECEDORES', opts: () => TIPOS.map(([id]) => ({ id })) },
      { k: 'nome', t: 'Nome', req: true, span: true }, { k: 'segmento', t: 'Segmento' }, { k: 'documento', t: 'CNPJ / CPF' },
      { k: 'forma_pagamento', t: 'Forma de pagamento / recebimento' }, { k: 'dados_bancarios', t: 'Dados bancários', span: true },
      { k: 'periodicidade', t: 'Periodicidade' }, { k: 'ativo', t: 'Ativo', type: 'check', def: true },
    ],
    antesSalvar: (row) => { row.nome = row.nome.trim().toUpperCase(); row.sigla = (TIPOS.find(t => t[0] === row.tipo) || [, 'OUT'])[1]; },
  });
}

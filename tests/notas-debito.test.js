// Notas de débito de juros e multa: separação dos juros, rateio pelos itens da nota de origem e dados da NF-e de débito (fictício).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../js/lib/notas-debito.js';
import { aliquotas } from '../js/lib/reforma.js';

test('separa os juros do valor de face', () => {
  assert.deepEqual(N.separarJuros(10360.56, 10602.31), { face: 10360.56, juros: 241.75 });
  assert.deepEqual(N.separarJuros(1000, 1000), { face: 1000, juros: 0 });
  assert.deepEqual(N.separarJuros(1000, 990), { face: 1000, juros: 0 });
});

test('rateia pelos itens e calcula CBS/IBS do ano da nota de origem', () => {
  const itens = [{ n_item: 1, cprod: 'A', vprod: 700, vdesc: 0 }, { n_item: 2, cprod: 'B', vprod: 300, vdesc: 0, cst_ibscbs: '000', cclass_trib: '000001' }];
  const L = aliquotas();
  const r = N.ratear(itens, 100.01, L.find(a => a.ano === 2026));
  assert.deepEqual(r.map(x => x.valor), [70.01, 30]);
  assert.equal(r[0].cbs, 0.63); assert.equal(r[0].ibs, 0.07);
  const d = N.dadosND({ valor: 100.01, data_recebimento: '2026-10-29', parcela: 2, cliente_nome: 'CLIENTE EXEMPLO', cliente_doc: '11.222.333/0001-81' },
    { chave: '2626', numero: 9001, serie: '1', emissao: '2026-09-16' }, itens, L, { cnpj: '00.000.000/0001-91', nome: 'EMPRESA EXEMPLO' });
  assert.equal(d.ide.finNFe, 6); assert.equal(d.ide.tpNFDebito, '04');
  assert.equal(d.total.valor, 100.01);
  assert.deepEqual(d.det.map(x => x.DFeReferenciado), [{ chaveAcesso: '2626', nItem: 1 }, { chaveAcesso: '2626', nItem: 2 }]);
  assert.match(d.infCpl, /NF-e 9001 parcela 2 de 16\/09\/2026/);
  assert.equal(N.nivel({ status: 'pendente', data_recebimento: '2026-10-20' }, '2026-10-31'), 'neg');
  assert.equal(N.nivel({ status: 'pendente', data_recebimento: '2026-10-29' }, '2026-10-31'), 'warn');
});

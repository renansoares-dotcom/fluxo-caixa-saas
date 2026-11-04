// Regime tributário (js/lib/regime.js): vigência, descrição, conferência e normalização. Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vigente, proxima, descricao, conferir, normalizar, ehSimples } from '../js/lib/regime.js';
import { conferir as conferirNota, ALIQ_PADRAO, aliquotas } from '../js/lib/reforma.js';

const L = [
  { vigencia_inicio: '2026-11-01', regime: 'simples', simples_atividades: [{ cnae: '4930-2/02', anexo: 'III' }], ibscbs_regular: false },
  { vigencia_inicio: '2027-01-01', regime: 'simples', simples_atividades: [{ cnae: '4930-2/02', anexo: 'III' }], ibscbs_regular: true },
];

test('vigente: linha de maior início até a data', () => {
  assert.equal(vigente(L, '2026-10-31'), null);
  assert.equal(vigente(L, '2026-12-31').ibscbs_regular, false);
  assert.equal(vigente(L, '2027-01-01').ibscbs_regular, true);
  assert.equal(proxima(L, L[0]).vigencia_inicio, '2027-01-01');
  assert.equal(proxima(L, L[1]), null);
});

test('descrição', () => {
  assert.equal(descricao(null), 'Regime tributário não cadastrado');
  assert.equal(descricao(L[0]), 'Simples Nacional · Anexo III · IBS/CBS no DAS');
  assert.equal(descricao({ regime: 'real', pis_cofins: 'nao_cumulativo', incentivos: 'PRODEPE (ICMS)' }), 'Lucro Real · PIS/COFINS não cumulativo · PRODEPE (ICMS)');
  assert.ok(ehSimples({ regime: 'mei' }) && !ehSimples({ regime: 'real' }) && !ehSimples(null));
});

test('conferir: erros impedem, avisos orientam', () => {
  assert.deepEqual(conferir({ regime: 'simples', vigencia_inicio: '2026-11-01', simples_atividades: [{ anexo: 'III', cnae: '4930-2/02' }] }).erros, []);
  assert.ok(conferir({ regime: '', vigencia_inicio: '' }).erros.length === 2);
  assert.ok(conferir({ regime: 'simples', vigencia_inicio: '2026-11-01', simples_atividades: [] }).avisos.some(a => /anexo/.test(a)));
  assert.ok(conferir({ regime: 'simples', vigencia_inicio: '2026-11-01', simples_atividades: [{ cnae: '4930' }] }).erros.some(e => /anexo/.test(e)));
  assert.ok(conferir({ regime: 'presumido', vigencia_inicio: '2026-01-01', pis_cofins: 'nao_cumulativo' }).erros.length === 1);
  assert.ok(conferir({ regime: 'simples', vigencia_inicio: '2027-03-01', ibscbs_regular: true, simples_atividades: [{ anexo: 'I' }] }).avisos.some(a => /semestre/.test(a)));
});

test('normalizar: só os campos do regime', () => {
  const s = normalizar({ regime: 'simples', vigencia_inicio: '2026-11-01', pis_cofins: 'cumulativo', uf: 'pe', simples_atividades: [{ cnae: '4930-2/02', anexo: 'III' }, { cnae: '' }], ibscbs_regular: true }, 'E');
  assert.equal(s.pis_cofins, null); assert.equal(s.uf, 'PE'); assert.equal(s.simples_atividades.length, 1); assert.equal(s.ibscbs_regular, true);
  const p = normalizar({ regime: 'presumido', vigencia_inicio: '2026-01-01', ibscbs_regular: true, simples_atividades: [{ anexo: 'I' }] }, 'E');
  assert.equal(p.pis_cofins, 'cumulativo'); assert.equal(p.ibscbs_regular, false); assert.deepEqual(p.simples_atividades, []);
  assert.equal(normalizar({ regime: 'real', vigencia_inicio: '2026-01-01' }, 'E').pis_cofins, 'nao_cumulativo');
});

test('conferência da nota: Simples com IBS/CBS no DAS não acusa erro por falta do grupo', () => {
  const nt = { emissao: '2027-02-10', emissao_propria: true, v_prod: 1000 };
  const lst = aliquotas([]);
  assert.equal(conferirNota(nt, lst, []).nivel, 'neg');
  assert.equal(conferirNota(nt, lst, [], { simplesDentro: true }).nivel, 'info');
  assert.ok(ALIQ_PADRAO.length);
});

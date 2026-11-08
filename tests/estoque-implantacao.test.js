import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../js/lib/estoque-implantacao.js';

const vazio = { espelho: { qtd: 0 }, locais: { ativos: 12, setores: 1, setores_sem_local: 0 }, cadastro: { produtos: 888, nao_acabados: 0, sem_familia: 0 },
  depara: { qtd: 0 }, prontidao: { resumo: [{ sentido: 'entrada', resultado: 'sem_produto', itens: 1464, valor: 900000 }, { sentido: 'saida', resultado: 'ok', itens: 5000, valor: 3000000 }], cfops_sem_regra: [] },
  saldo: { implantado_em: null, movimentos: 0, valor: 0 }, automatico: { ligado: false, pendencias: 0 }, fechamento: { qtd: 0 } };

test('situação de hoje: espelho pendente, saldo bloqueado, vendas prontas', () => {
  const A = K.avaliar(vazio, {}, [{ etapa: 'espelho', responsavel: 'Renan', prevista: '2026-11-03' }], '2026-11-08');
  const by = Object.fromEntries(A.etapas.map(e => [e.k, e]));
  assert.equal(by.espelho.s, 'pendente'); assert.equal(by.espelho.atrasada, true); assert.equal(by.espelho.responsavel, 'Renan');
  assert.equal(by.locais.s, 'feito'); assert.equal(by.cadastro.s, 'bloqueado'); assert.equal(by.depara.s, 'pendente');
  assert.equal(by.vendas.s, 'feito'); assert.equal(by.saldo.s, 'bloqueado'); assert.equal(by.automatico.s, 'bloqueado');
  assert.equal(A.proxima.k, 'espelho'); assert.equal(A.concluida, false);
  assert.ok(A.geral > 0 && A.geral < 50);
});

test('tudo pronto: saldo liberado, depois implantado e fechado', () => {
  const pronto = { ...vazio, espelho: { qtd: 1, data_ref: '2026-11-30', linhas: 500, depositos: 4, valor: 2e6 },
    cadastro: { nao_acabados: 600, esp_linhas: 500, esp_ligadas: 490, esp_valor: 2e6, esp_valor_ligado: 1.98e6, sem_familia: 0 }, depara: { qtd: 1400 },
    prontidao: { resumo: [{ sentido: 'entrada', resultado: 'ok', itens: 1400, valor: 880000 }, { sentido: 'entrada', resultado: 'sem_produto', itens: 64, valor: 20000 }, { sentido: 'saida', resultado: 'ok', itens: 5000, valor: 3e6 }], cfops_sem_regra: [] } };
  let A = K.avaliar(pronto);
  const s = (k) => A.etapas.find(e => e.k === k).s;
  assert.equal(s('cadastro'), 'feito'); assert.equal(s('depara'), 'feito'); assert.equal(s('cfop'), 'feito'); assert.equal(s('saldo'), 'pendente'); assert.equal(A.proxima.k, 'saldo');
  A = K.avaliar({ ...pronto, saldo: { implantado_em: '2026-12-01', movimentos: 900, valor: 2e6 }, automatico: { ligado: true, pendencias: 3 } });
  assert.equal(s('saldo'), 'feito'); assert.equal(s('automatico'), 'andamento'); assert.equal(s('fechamento'), 'pendente');
  A = K.avaliar({ ...pronto, saldo: { implantado_em: '2026-12-01' }, automatico: { ligado: true, pendencias: 0 }, fechamento: { qtd: 1, ultimo: '2026-12-01' } }, {}, [{ etapa: 'locais', dispensada: true }]);
  assert.equal(A.concluida, true); assert.equal(A.geral, 100); assert.equal(s('locais'), 'dispensado');
});

test('metas e prontidão', () => {
  const p = K.prontidao({ resumo: [{ sentido: 'saida', resultado: 'ok', itens: 9, valor: 90 }, { sentido: 'saida', resultado: 'sem_regra', itens: 1, valor: 10 }] }, 'saida');
  assert.equal(p.pct, 90); assert.equal(p.por.sem_regra.itens, 1);
  const pr = { ...vazio, prontidao: { resumo: [{ sentido: 'saida', resultado: 'ok', itens: 9, valor: 90 }, { sentido: 'saida', resultado: 'sem_regra', itens: 1, valor: 10 }], cfops_sem_regra: [{ cfop: '5949', itens: 1, valor: 10 }] } };
  assert.equal(K.avaliar(pr).etapas.find(e => e.k === 'vendas').s, 'andamento');
  assert.equal(K.avaliar(pr, { meta_saida_pct: 90 }).etapas.find(e => e.k === 'vendas').s, 'feito');
  assert.match(K.avaliar(pr).etapas.find(e => e.k === 'cfop').txt[0], /5949/);
});

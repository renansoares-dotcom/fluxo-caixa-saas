// Ativo Imobilizado: as regras da biblioteca batem com as do banco (tests/sql/20_ativo_imobilizado.sql). Dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../js/lib/imobilizado.js';

const MAQ = { id: 'k1', codigo: 'MAQ', nome: 'Máquinas', deprecia: true, ciap: true, credito_pis_cofins: 'imediato', conta_ativo_id: 'a', conta_deprec_id: 'b', conta_despesa_id: 'c' };
const novo = { id: 'b1', classe_id: 'k1', data_aquisicao: '2026-01-15', valor_aquisicao: 120000, valor_residual: 0, vida_util_meses: 120, situacao: 'em_uso' };
const antigo = { id: 'b2', classe_id: 'k1', data_aquisicao: '2020-01-01', valor_aquisicao: 120000, valor_residual: 0, vida_util_meses: 120, situacao: 'em_uso',
  data_corte: '2025-12-31', deprec_inicial: 72000, meses_iniciais: 72 };

test('fração do mês pelas três regras de início', () => {
  assert.equal(I.fracao(novo, '2026-01', 'mes_seguinte'), 0);
  assert.equal(I.fracao(novo, '2026-02', 'mes_seguinte'), 1);
  assert.equal(I.fracao(novo, '2026-01', 'mes_aquisicao'), 1);
  assert.equal(I.fracao(novo, '2026-01', 'pro_rata_dia'), Math.round(17 / 31 * 10000) / 10000);
  assert.equal(I.fracao(antigo, '2025-12', 'mes_seguinte'), 0, 'antes do corte já está depreciado');
  assert.equal(I.fracao({ ...novo, deprecia: false }, '2026-05', 'mes_seguinte', false), 0, 'terreno');
  const baixado = { ...antigo, baixa_data: '2026-03-20' };
  assert.equal(I.fracao(baixado, '2026-03', 'mes_seguinte'), 0, 'mês seguinte: não deprecia no mês da baixa');
  assert.equal(I.fracao(baixado, '2026-03', 'pro_rata_dia'), Math.round(20 / 31 * 10000) / 10000, 'pró-rata até o dia da baixa');
  assert.equal(I.fracao(baixado, '2026-04', 'mes_aquisicao'), 0);
});

test('quota: linear, último mês leva o resto, nunca passa do custo', () => {
  assert.equal(I.quota(novo, 0, 0, 1), 1000);
  assert.equal(I.quota(antigo, 72000, 72, 1), 1000, 'implantação: 48.000 ÷ 48');
  assert.equal(I.quota({ ...novo, vida_util_meses: 60 }, 1000, 1, 1), Math.round(119000 / 59 * 100) / 100, 'revisão de vida útil prospectiva');
  assert.equal(I.quota(novo, 119500, 119.5, 1), 500, 'o último mês leva o resto');
  assert.equal(I.quota(novo, 120000, 120, 1), 0);
  assert.equal(I.quota({ ...novo, valor_residual: 12000 }, 0, 0, 1), 900, 'com valor residual');
});

test('projeção soma os bens mês a mês e respeita o que já foi gravado', () => {
  const deps = [{ bem_id: 'b2', competencia: '2026-01-01', valor: 1000, meses: 1 }];
  const p = I.projecao([novo, antigo], deps, [MAQ], { de: '2026-02', meses: 3 });
  assert.deepEqual(p.map(x => x.valor), [2000, 2000, 2000]);
  const fim = I.projecao([antigo], [], [MAQ], { de: '2026-01', meses: 50 });
  assert.equal(Math.round(fim.reduce((s, x) => s + x.valor, 0)), 48000, 'termina exatamente no custo');
  assert.equal(fim[48].valor, 0);
});

test('posição e quadro de movimentação do período', () => {
  const deps = [{ bem_id: 'b2', competencia: '2026-01-01', valor: 1000, meses: 1 }, { bem_id: 'b2', competencia: '2026-02-01', valor: 1000, meses: 1 },
                { bem_id: 'b1', competencia: '2026-02-01', valor: 1000, meses: 1 }];
  const p = I.posicao(antigo, deps, '2026-02');
  assert.deepEqual([p.acum, p.vcl, p.usados], [74000, 46000, 74]);
  const baixado = { ...antigo, baixa_data: '2026-03-20', situacao: 'baixado' };
  const [l] = I.movimentacao([novo, baixado], deps, [MAQ], { de: '2026-01', ate: '2026-03' });
  assert.equal(l.custoIni, 120000); assert.equal(l.adicoes, 120000); assert.equal(l.baixasCusto, 120000); assert.equal(l.custoFim, 120000);
  assert.equal(l.depIni, 72000); assert.equal(l.depMes, 3000); assert.equal(l.depBaixas, 74000); assert.equal(l.depFim, 1000);
  assert.equal(l.vclFim, 119000);
});

test('custo sugerido pela NF-e tira o ICMS do CIAP e o PIS/COFINS com crédito', () => {
  const c = I.custoSugerido({ valor: 30000, icms: 3600 }, MAQ, { data: '2026-03-05' });
  assert.equal(c.icms, 3600); assert.equal(c.pis, Math.round(26400 * 0.0925 * 100) / 100); assert.equal(c.custo, Math.round((26400 - 2442) * 100) / 100);
  assert.equal(I.custoSugerido({ valor: 30000, icms: 3600 }, MAQ, { data: '2027-02-01' }).pis, 0, 'sem PIS/COFINS a partir de 2027');
  assert.equal(I.custoSugerido({ valor: 30000, icms: 3600 }, { ciap: false, credito_pis_cofins: 'nenhum' }).custo, 30000);
});

test('CIAP em 48 parcelas com fator; a baixa encerra', () => {
  const b = { data_aquisicao: '2026-03-05', icms_credito: 4800 };
  const p = I.ciapParcelas(b, { ate: '2030-12', fatores: { '2026-04': 0.9 } });
  assert.equal(p.length, 48); assert.equal(p[0].credito, 100); assert.equal(p[1].credito, 90); assert.equal(p[47].mes, '2030-02');
  assert.equal(I.ciapParcelas({ ...b, baixa_data: '2026-06-10' }, { ate: '2030-12' }).length, 4);
});

test('PIS/COFINS por método e fim em 2026', () => {
  const b = { id: 'x', data_aquisicao: '2026-03-05', valor_aquisicao: 48000 };
  assert.deepEqual(I.pisCofinsParcelas(b, 'imediato', { ate: '2026-12' }), [{ mes: '2026-03', base: 48000, credito: 4440 }]);
  assert.equal(I.pisCofinsParcelas(b, '48', { ate: '2030-12' }).length, 10, '48 avos só até dez/2026');
  const deps = [{ bem_id: 'x', competencia: '2026-04-01', valor: 400 }];
  assert.equal(I.pisCofinsParcelas(b, 'depreciacao', { deps, ate: '2026-12' })[0].credito, 37);
  assert.equal(I.pisCofinsParcelas(b, 'nenhum', { ate: '2026-12' }).length, 0);
});

test('fator do CIAP pelas saídas', () => {
  assert.equal(I.fatorCiap([{ cfop: '5101', vprod: 900, v_icms: 108 }, { cfop: '5101', vprod: 100, v_icms: 0 }, { cfop: '5901', vprod: 5000 }]), 0.9);
  assert.equal(I.fatorCiap([{ cfop: '7101', vprod: 100 }]), 1, 'exportação conta como tributada');
  assert.equal(I.fatorCiap([]), 1);
});

test('leitura do QR, da plaqueta e do número', () => {
  assert.equal(I.qrConteudo('PAT-000012', 'https://x/app/'), 'https://x/app/#/contab/inventario?pat=PAT-000012');
  assert.deepEqual(I.lerCodigo('https://x/app/#/contab/inventario?pat=PAT-000012'), { plaqueta: 'PAT-000012' });
  assert.deepEqual(I.lerCodigo(' pat-000012 '), { plaqueta: 'PAT-000012' });
  assert.deepEqual(I.lerCodigo('12'), { numero: 12 });
  assert.equal(I.lerCodigo(''), null);
});

test('alertas para o Decision Center', () => {
  const a = I.alertas({ bens: [novo], classes: [{ ...MAQ, conta_deprec_id: null }], calculos: [], candidatos: 3, inventarios: [], hoje: '2026-11-07' });
  assert.deepEqual(a.map(x => x.k), ['calculo', 'contas', 'candidatos', 'inventario']);
  assert.deepEqual(I.alertas({ bens: [novo], classes: [MAQ], calculos: [{ competencia: '2026-10-01' }], inventarios: [{ situacao: 'concluido', data_inicio: '2026-06-30' }], hoje: '2026-11-07' }), []);
});

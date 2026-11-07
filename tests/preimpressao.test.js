// Pré-impressão: código de barras, desbobinamento, hash, medidas do PDF, rodadas, tempo de resposta, indicadores e alertas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/lib/preimpressao.js';

test('GTIN: EAN-13, EAN-8, UPC-A, DUN-14 e erros', () => {
  assert.equal(P.gtin('7891000315507').ok, true);
  assert.equal(P.gtin('789 1000 31550 7').tipo, 'EAN-13');
  assert.equal(P.gtin('7891000315507').brasil, true);
  const e = P.gtin('7891000315508'); assert.equal(e.ok, false); assert.equal(e.esperado, 7);
  assert.equal(P.gtin('96385074').ok, true);           // EAN-8
  assert.equal(P.gtin('036000291452').ok, true);       // UPC-A
  assert.equal(P.gtin('17891000315504').ok, true);     // DUN-14 (caixa) do EAN acima
  assert.equal(P.gtin('17891000315504').brasil, true);
  assert.match(P.gtin('12345').msg, /5 dígitos/);
  assert.equal(P.gtin('').vazio, true);
});

test('desbobinamento: 8 posições, externa por cima e interna por baixo', () => {
  assert.equal(Object.keys(P.DESBOBINAMENTO).length, 8);
  assert.match(P.desbobinamentoSvg(1), /rotate\(90 /);
  assert.match(P.desbobinamentoSvg(4), /rotate\(180 /);
  assert.match(P.desbobinamentoSvg(7), /interna/);
  assert.match(P.desbobinamentoSvg(7), /rotate\(0 /);
  assert.equal(P.desbobinamentoSvg(9), '');
});

test('SHA-256 e hash curto', async () => {
  const h = await P.sha256(new TextEncoder().encode('abc'));
  assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(P.hashCurto(h), 'ba7816bf…f20015ad');
});

test('medidas do PDF contra a ficha (inclusive girada)', () => {
  assert.equal(P.confereMedidas({ mmLargura: 250.4, mmAltura: 180 }, { largura_mm: 250, altura_mm: 180 }).ok, true);
  const g = P.confereMedidas({ mmLargura: 180, mmAltura: 250 }, { largura_mm: 250, altura_mm: 180 }); assert.equal(g.ok, true); assert.equal(g.girada, true);
  assert.equal(P.confereMedidas({ mmLargura: 210, mmAltura: 297 }, { largura_mm: 250, altura_mm: 180 }).ok, false);
  assert.equal(P.confereMedidas({}, { largura_mm: 1, altura_mm: 1 }), null);
});

const PJ = [
  { id: 'a', numero: 1, favorecido_id: 'c1', situacao: 'liberada', versao_aprovada_id: 'a2', criado_em: '2026-11-01T10:00:00Z', atualizado_em: '2026-11-04T10:00:00Z' },
  { id: 'b', numero: 2, favorecido_id: 'c2', situacao: 'aprovada', versao_aprovada_id: 'b1', criado_em: '2026-11-02T10:00:00Z', atualizado_em: '2026-11-02T20:00:00Z' },
  { id: 'c', numero: 3, nome: 'Rótulo', favorecido_id: 'c1', situacao: 'aguardando_cliente', prazo: '2026-11-05', criado_em: '2026-11-03T10:00:00Z', atualizado_em: '2026-11-03T12:00:00Z' },
  { id: 'd', numero: 4, favorecido_id: 'c2', situacao: 'alteracao_solicitada', criado_em: '2026-11-01T10:00:00Z', atualizado_em: '2026-11-02T10:00:00Z' },
];
const VS = [
  { id: 'a1', projeto_id: 'a', numero: 1, enviada_em: '2026-11-01T12:00:00Z' }, { id: 'a2', projeto_id: 'a', numero: 2, enviada_em: '2026-11-02T12:00:00Z' },
  { id: 'b1', projeto_id: 'b', numero: 1, enviada_em: '2026-11-02T12:00:00Z' },
  { id: 'c1', projeto_id: 'c', numero: 1, enviada_em: '2026-11-03T12:00:00Z' },
  { id: 'd1', projeto_id: 'd', numero: 1, enviada_em: '2026-11-01T12:00:00Z' },
];
const DS = [
  { projeto_id: 'a', versao_id: 'a1', decisao: 'alteracao', origem: 'cliente', criado_em: '2026-11-01T18:00:00Z' },
  { projeto_id: 'a', versao_id: 'a2', decisao: 'aprovada', origem: 'cliente', criado_em: '2026-11-03T12:00:00Z' },
  { projeto_id: 'b', versao_id: 'b1', decisao: 'aprovada', origem: 'cliente', criado_em: '2026-11-02T16:00:00Z' },
  { projeto_id: 'd', versao_id: 'd1', decisao: 'alteracao', origem: 'cliente', criado_em: '2026-11-02T10:00:00Z' },
];

test('rodadas e tempo de resposta', () => {
  assert.equal(P.rodadas(PJ[0], VS), 2);
  assert.equal(P.rodadas(PJ[1], VS), 1);
  assert.deepEqual(P.respostas(DS, VS).map(x => x.horas), [6, 24, 4, 22]);
});

test('indicadores do período', () => {
  const i = P.indicadores(PJ, VS, DS, { de: '2026-11-01', ate: '2026-11-30', hoje: '2026-11-07' });
  assert.equal(i.aprovadas, 2); assert.equal(i.rodadasMedia, 1.5); assert.equal(i.primeira, 50);
  assert.equal(i.respostaH, 14); assert.equal(i.comCliente, 1); assert.equal(i.atrasadas, 1);
  assert.equal(i.emAjuste, 1); assert.equal(i.pedidosAlteracao, 2);
  assert.deepEqual(i.porRodada.map(x => x.qtd), [1, 1, 0, 0]);
  const pc = P.porCliente(PJ, VS, DS, { c1: 'UM', c2: 'DOIS' });
  assert.equal(pc[0].nome, 'UM'); assert.equal(pc[0].rodadas, 2);
});

test('alertas', () => {
  const agora = new Date('2026-11-07T12:00:00Z').getTime();
  const a = P.alertas({ projetos: PJ, opsPendentes: [{ numero: 7001, projeto_id: 'c' }], hoje: '2026-11-07', agora });
  assert.deepEqual(a.map(x => x.filtro), ['atrasadas', 'ops', 'ajuste', 'liberar']);
  assert.equal(a[0].nivel, 'alto');
  assert.equal(P.nomeSeguro('Arte Ação/final (1).pdf'), 'Arte_Acao_final_1_.pdf');
});

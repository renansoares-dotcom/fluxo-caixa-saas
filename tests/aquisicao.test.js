// Compra inteligente: custo líquido de aquisição (SQL 199)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { custoUnitario, fatorIcmsEfetivo, vpParcelasMensais, mapaLiquido, mapaReforma, sugestaoFiscal, divergencias, r2 } from '../js/lib/aquisicao.js';

const nos = { uf: 'PE', interna: 20.5, ipi_contribuinte: true, pc_nao_cumulativo: true };
const P = { pc_pct: 9.25, pc_excluir_icms: true, pc_incluir_frete: true, taxa_mensal: 0, ciap_meses: 48 };

test('insumo: créditos de ICMS e PIS/COFINS (sem o ICMS na base)', () => {
  const se = custoUnitario({ preco: 17, icms_aliq: 12, uf_origem: 'SE' }, { regime: 'real' }, nos, P);
  assert.equal(r2(se.credIcms), 2.04);
  assert.equal(r2(se.credPc), r2((17 - 2.04) * 0.0925));
  assert.equal(r2(se.custo), r2(17 - 2.04 - (17 - 2.04) * 0.0925));
  const pe = custoUnitario({ preco: 20, icms_aliq: 20.5, uf_origem: 'PE' }, { regime: 'real' }, nos, P);
  assert.equal(r2(pe.custo), r2(20 - 4.1 - 15.9 * 0.0925));
  assert.equal(pe.difal, 0);
});

test('PRODEPE sobre o saldo: o crédito de ICMS vale menos', () => {
  const f = fatorIcmsEfetivo({ prodepe_ativo: true, prodepe_base: 'saldo_proporcional', prodepe_credito_pct: 75, feef_pct: 10 }, { prodepe_saidas_pct: 100 });
  assert.equal(r2(f), 0.33);   // 1 − 0,75 × 0,90 = 0,325
  assert.equal(fatorIcmsEfetivo({ prodepe_ativo: true, prodepe_base: 'debito_incentivado', prodepe_credito_pct: 75 }), 1);
  assert.equal(fatorIcmsEfetivo(null), 1);
  const pe = custoUnitario({ preco: 20, icms_aliq: 20.5, uf_origem: 'PE' }, { regime: 'real' }, nos, { ...P, fator_icms: f });
  assert.equal(r2(pe.custoEf), r2(20 - 4.1 * 0.325 - 15.9 * 0.0925));
  assert.ok(pe.linhas.some(l => l.k === 'custo_ef'));
});

test('uso e consumo de outra UF: DIFAL base dupla e sem créditos', () => {
  const u = custoUnitario({ preco: 17, icms_aliq: 12, ipi_aliq: 5, uf_origem: 'SE', destinacao: 'uso_consumo' }, { regime: 'real' }, nos, P);
  assert.equal(r2(u.difal), 1.82);
  assert.equal(u.credIcms + u.credPc + u.credIpi, 0);
  assert.equal(r2(u.custo), r2(17 + 0.85 + 1.8176));
});

test('ativo: ICMS (com o DIFAL) em 48 meses a valor presente; IPI sem crédito; insumo credita o IPI', () => {
  const a0 = custoUnitario({ preco: 1000, icms_aliq: 12, ipi_aliq: 10, uf_origem: 'SP', destinacao: 'ativo' }, { regime: 'real' }, nos, P);
  assert.equal(r2(a0.credIcms), r2(a0.credIcmsNom));
  assert.equal(a0.credIpi, 0);
  const a1 = custoUnitario({ preco: 1000, icms_aliq: 12, uf_origem: 'SP', destinacao: 'ativo' }, { regime: 'real' }, nos, { ...P, taxa_mensal: 1 });
  assert.ok(a1.credIcms < a1.credIcmsNom * 0.8, 'o crédito parcelado vale menos hoje');
  assert.equal(r2(vpParcelasMensais(480, 48, 0)), 480);
  const ins = custoUnitario({ preco: 1000, icms_aliq: 12, ipi_aliq: 10, uf_origem: 'SP' }, { regime: 'real' }, nos, P);
  assert.equal(ins.credIpi, 100);
});

test('fornecedor do Simples: sem ICMS destacado, crédito pelo % permitido', () => {
  const s = custoUnitario({ preco: 17, icms_aliq: 12, uf_origem: 'SE' }, { regime: 'simples', simples_credito_pct: 2.5 }, nos, P);
  assert.equal(s.icms, 0);
  assert.equal(r2(s.credIcms), r2(17 * 0.025));
  assert.equal(r2(s.credPc), r2(17 * 0.0925), 'PIS/COFINS sobre o preço inteiro');
});

test('mapa: o menor preço nem sempre é o menor custo líquido; frete rateado', () => {
  const itens = [{ id: 'i1', quantidade: 100, destinacao: 'insumo', ncm: '39011092' }];
  const cots = [{ id: 'A', fornecedor: 'Fornecedor do Simples', frete: 0, uf: 'PE', regime: 'simples', simples_credito_pct: 2 },
    { id: 'B', fornecedor: 'Fornecedor do regime normal', frete: 50, uf: 'PE', regime: 'real' }];
  const citens = [{ cotacao_id: 'A', requisicao_item_id: 'i1', valor_unitario: 18 }, { cotacao_id: 'B', requisicao_item_id: 'i1', valor_unitario: 20, icms_aliq: 20.5 }];
  const M = mapaLiquido(itens, cots, citens, nos, P);
  assert.equal(M.melhorPreco.id, 'A');
  assert.equal(M.melhorLiq.id, 'B');
  assert.ok(M.ganho > 0);
  assert.equal(r2(M.cots[1].porItem.i1.frete), 0.5);
  assert.ok(!M.cots[0].faltaFiscal, 'o Simples não destaca ICMS: não falta alíquota');
  const M2 = mapaLiquido(itens, [{ ...cots[1], id: 'C' }], [{ cotacao_id: 'C', requisicao_item_id: 'i1', valor_unitario: 20 }], nos, P);
  assert.ok(M2.cots[0].faltaFiscal, 'regime normal sem a alíquota de ICMS é sinalizado');
});

test('reforma: sem ICMS em 2033, o Simples sem opção pelo regular perde o crédito de CBS/IBS', () => {
  const itens = [{ id: 'i1', quantidade: 1, destinacao: 'insumo' }];
  const cots = [{ id: 'A', fornecedor: 'Simples', frete: 0, uf: 'PE', regime: 'simples', simples_regular: 'nao' }, { id: 'R', fornecedor: 'Regular', frete: 0, uf: 'PE', regime: 'real' },
    { id: 'S', fornecedor: 'Simples optante', frete: 0, uf: 'PE', regime: 'simples', simples_regular: 'sim' }];
  const citens = ['A', 'R', 'S'].map(id => ({ cotacao_id: id, requisicao_item_id: 'i1', valor_unitario: 100, icms_aliq: 20.5 }));
  const F = mapaReforma(itens, cots, citens, nos, { ...P, simples_credito_ibs_pct: 4 }, [{ ano: 2033, cbs: 8.8, ibs_uf: 17.7, ibs_mun: 0, icms_pct: 0 }]);
  const c = Object.fromEntries(F[0].cots.map(x => [x.id, x.custo]));
  assert.equal(c.R, 100);
  assert.equal(c.S, 100);
  assert.equal(r2(c.A), r2(100 + 26.5 - 4));
});

test('sugestão pelas notas de entrada e divergência do que foi declarado', () => {
  const hist = [{ ncm: '39011092', p_icms: 12, ipi_pct: 0, st_un: 0, orig: '0', uf: 'SE', simples: false, emissao: '2026-10-01' },
    { ncm: '39011092', p_icms: 4, ipi_pct: 0, st_un: 0, orig: '1', uf: 'SE', simples: false, emissao: '2026-11-10' }];
  const s = sugestaoFiscal(hist, '3901.10.92');
  assert.equal(s.icms_aliq, 4);
  assert.equal(s.importado, true);
  assert.equal(s.uf, 'SE');
  assert.deepEqual(divergencias({ icms_aliq: 12, ipi_aliq: 0 }, s), ['ICMS declarado 12%; na última nota 4%']);
  assert.equal(sugestaoFiscal([], '39'), null);
});

test('nossa empresa no Simples: sem créditos (e sem CBS/IBS sem a opção pelo regular)', () => {
  const u = custoUnitario({ preco: 17, icms_aliq: 12, ipi_aliq: 5, uf_origem: 'SE' }, { regime: 'real' }, { ...nos, simples: true }, P);
  assert.equal(u.creditos, 0);
  assert.equal(r2(u.custo), r2(17 * 1.05));
  const rf = custoUnitario({ preco: 100, icms_aliq: 20.5, uf_origem: 'PE' }, { regime: 'real' }, { ...nos, simples: true, ibscbs_regular: true }, { ...P, ref: { t: 26.5, icms_pct: 0 } });
  assert.equal(r2(rf.custo), 100, 'com a opção pelo regular, credita a CBS/IBS');
});

test('relatório da requisição: identificação, itens, mapa, custo líquido numerado em sequência, convites e pedidos', async () => {
  const { relatorioRequisicao } = await import('../js/lib/aquisicao-relatorio.js');
  const { mapaCotacoes } = await import('../js/lib/cotacao-calc.js');
  const o = { esc: (s) => String(s ?? ''), money: (v) => (+v || 0).toFixed(2), dateBR: (d) => d || '' };
  const r = { numero: 2, status: 'aprovada', solicitante: 'Ana', criado_em: '2026-11-26', itens: [{ id: 'i1', descricao: 'Resina X', ncm: '39011020', unidade: 'KG', quantidade: 1000, destinacao: 'insumo' }] };
  const cots = [{ id: 'c1', fornecedor: 'Fornecedor A', uf: 'PB', regime: 'real', frete: 0, parcelas_dias: [], respondida_pelo_fornecedor: true }];
  const citens = [{ cotacao_id: 'c1', requisicao_item_id: 'i1', valor_unitario: 10, icms_aliq: 12, ipi_aliq: 5 }];
  const M = mapaCotacoes(r.itens, cots, citens, { taxa: 1.5 });
  const BF = { P: { ...P, fator_icms: 1, simples_credito_ibs_pct: 0, taxa_mensal: 1.5 } };
  const ML = mapaLiquido(r.itens, cots.map(c => ({ ...c, vpFator: 1 })), citens, nos, BF.P);
  const html = relatorioRequisicao(r, { setor: 'PRODUÇÃO', cots, citens, M, ML, RF: [], BF, div: [], conv: [{ fornecedor: 'Fornecedor A', situacao: 'respondido', expira_em: '2026-12-01' }], peds: [], taxa: 1.5, iqf: () => 'sem histórico' }, o);
  const titulos = [...html.matchAll(/<h2>(\d+)\. ([^<]+)<\/h2>/g)].map(m => +m[1] + ' ' + m[2]);
  assert.deepEqual(titulos.map(t => +t.split(' ')[0]), titulos.map((_, k) => k + 1), 'seções numeradas em sequência');
  for (const t of ['Identificação', 'Itens', 'Mapa comparativo de cotações', 'Comparação: preço × custo líquido', 'Memória de cálculo por item', 'Cotação por link', 'Pedidos de compra'])
    assert.ok(titulos.some(x => x.endsWith(t)), 'falta a seção ' + t);
  assert.ok(!titulos.some(x => x.endsWith(' Requisição')), 'a identificação não se repete');
  assert.match(html, /PRODUÇÃO/); assert.match(html, /Respondeu/); assert.match(html, /Nenhum pedido gerado/);
  const sem = relatorioRequisicao({ ...r, status: 'pendente' }, { cots: [], conv: [], peds: [], taxa: 1.5 }, o);
  assert.match(sem, /Nenhuma cotação registrada/);
});

test('cotado × realizado (SQL 200): NF com ICMS 7% contra 12% do pedido perde crédito; Simples e IPI a mais', async () => {
  const { realizadoCotado } = await import('../js/lib/aquisicao.js');
  const P2 = { pc_pct: 9.25, pc_excluir_icms: true, pc_incluir_frete: true, fator_icms: 1, taxa_mensal: 0, ciap_meses: 48 };
  const base = { pedido_id: 'p1', pedido: 7, fornecedor: 'NORPOLIM', uf: 'PB', regime: 'real', uf_nota: 'PB', nota: 9253, item: 'PL720N', destinacao: 'insumo',
    quantidade: 27000, vu_pedido: 10.6667, icms_pedido: 12, ipi_pedido: 5, st_un_pedido: null, vu_nota: 10.6667, icms_nota: 12, nota_simples: false, ipi_nota: 5, st_un_nota: 0, comparavel: true };
  const igual = realizadoCotado([base], nos, P2);
  assert.equal(igual.total.dif, 0, 'nota igual ao pedido: sem diferença');
  assert.equal(igual.total.cotado.custo, 229997.52, 'o mesmo custo líquido do mapa');
  const R = realizadoCotado([{ ...base, icms_nota: 7 }], nos, P2);
  // ICMS perdido 5% × 288.000,90 = 14.400,05; o PIS/COFINS sobe 9,25% disso (a base é sem o ICMS) = 1.332,00
  assert.ok(Math.abs(R.total.difCreditos + (14400.05 - 14400.05 * 0.0925)) <= 0.02, 'crédito perdido líquido do PIS/COFINS');
  assert.equal(R.total.dif, 13068.04);
  assert.equal(R.total.difDesembolso, 0);
  const S = realizadoCotado([{ ...base, quantidade: 1000, nota_simples: true, icms_nota: null }], nos, P2);
  assert.ok(S.total.dif > 1000, 'nota do Simples: sem crédito de ICMS');
  const L = realizadoCotado([{ ...base, item: 'LUVA', destinacao: 'uso_consumo', quantidade: 100, vu_pedido: 10, vu_nota: 10, ipi_pedido: 0, ipi_nota: 10, st_un_pedido: 1.5, st_un_nota: 4 }], nos, P2);
  assert.equal(L.total.difDesembolso, 100 + 250, 'IPI e ST a mais no desembolso');
  assert.equal(L.total.dif, 350, 'uso e consumo: tudo vira custo');
  const sem = realizadoCotado([{ ...base, comparavel: false }], nos, P2);
  assert.equal(sem.pedidos.length, 0); assert.equal(sem.semDados, 1);
  const { relatorioPeriodo } = await import('../js/lib/aquisicao-relatorio.js');
  const html = relatorioPeriodo([], { esc: (x) => String(x ?? ''), money: (v) => (+v || 0).toFixed(2), dateBR: (d) => d || '' }, R);
  assert.match(html, /Cotado × realizado/); assert.match(html, /13068\.04/);
});

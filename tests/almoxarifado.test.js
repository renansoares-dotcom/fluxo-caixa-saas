import test from 'node:test';
import assert from 'node:assert/strict';
import { pendente, temPendencia, qtdBR, codigoCracha, sugerirEntrega, conferirEntrega, filtrar, resumo, consumoPorSetor } from '../js/lib/almoxarifado.js';
import { reconhecer } from '../js/lib/leitura.js';

test('pendente e número à brasileira', () => {
  assert.equal(pendente({ quantidade: 10, qtd_entregue: 4 }), 6); assert.equal(pendente({ quantidade: 2.5, qtd_entregue: 2.5 }), 0); assert.equal(pendente({ quantidade: 1, qtd_entregue: 3 }), 0);
  assert.equal(temPendencia([{ quantidade: 1, qtd_entregue: 1 }, { quantidade: 2, qtd_entregue: 1 }]), true); assert.equal(temPendencia([{ quantidade: 1, qtd_entregue: 1 }]), false);
  assert.equal(qtdBR('2,5'), 2.5); assert.equal(qtdBR('1.000'), 1000); assert.equal(qtdBR('12'), 12); assert.equal(qtdBR(' 1.234,50 '), 1234.5);
  for (const t of ['', 'abc', '1,2,3', '-1', '1.5']) assert.ok(Number.isNaN(qtdBR(t)), t);
});

test('crachá: acha o código no endereço do QR, mesmo com os símbolos trocados pelo leitor', () => {
  const c = 'a1b2c3d4e5f60718293a4b5c';
  assert.equal(codigoCracha(`https://exemplo.github.io/app/cracha.html?c=${c}`), c);
  assert.equal(codigoCracha(`httpsÇ;;exemplo.github.io;app;cracha.htmlÇc=${c.toUpperCase()}`), c);
  assert.equal(codigoCracha(c), c);
  assert.equal(codigoCracha('L0000123'), null); assert.equal(codigoCracha('26261111222333000144550010000773101000773109'), null); assert.equal(codigoCracha(''), null);
  assert.deepEqual(reconhecer(`https://x.io/cracha.html?c=${c}`), { tipo: 'cracha', codigo: c });
  assert.equal(reconhecer('L0000123').tipo, 'etiqueta');
});

const itens = [{ id: 'i1', produto_id: 'p1', codigo: 'PAP', descricao: 'PAPEL A4', unidade: 'UN', quantidade: 5, qtd_entregue: 0 },
  { id: 'i2', produto_id: 'p2', codigo: 'LUV', descricao: 'LUVA', unidade: 'PAR', quantidade: 10, qtd_entregue: 4 }, { id: 'i3', produto_id: 'p3', codigo: 'TON', descricao: 'TONER', unidade: 'UN', quantidade: 1, qtd_entregue: 1 },
  { id: 'i4', produto_id: 'p4', codigo: 'CAN', descricao: 'CANETA', unidade: 'UN', quantidade: 3, qtd_entregue: 0 }];
const saldos = [{ produto_id: 'p1', local_id: 'uc', local_nome: 'Uso e consumo', quantidade: 100 }, { produto_id: 'p2', local_id: 'uc', local_nome: 'Uso e consumo', quantidade: 2 },
  { produto_id: 'p2', local_id: 'ins', local_nome: 'Insumos', quantidade: 3 }];

test('sugestão de entrega: local com mais saldo, limitada ao saldo; item entregue fica fora', () => {
  const S = sugerirEntrega(itens, saldos);
  assert.deepEqual(S.map(x => [x.codigo, x.falta, x.quantidade, x.local_id, x.semSaldo]), [['PAP', 5, 5, 'uc', false], ['LUV', 6, 3, 'ins', false], ['CAN', 3, 0, '', true]]);
  assert.equal(S[1].locais.length, 2);
});

test('conferência da entrega', () => {
  const ok = [{ item_id: 'i1', descricao: 'PAPEL', falta: 5, quantidade: 5, local_id: 'uc', saldoLocal: 100 }];
  assert.deepEqual(conferirEntrega(ok, { quem: 'Maria' }), []);
  assert.match(conferirEntrega(ok, { quem: '' })[0], /Identifique quem/);
  assert.match(conferirEntrega(ok, { quem: 'Maria', exigirCracha: true })[0], /crachá/); assert.deepEqual(conferirEntrega(ok, { quem: 'Maria', exigirCracha: true, crachaLido: true }), []);
  assert.match(conferirEntrega([{ ...ok[0], quantidade: 6 }], { quem: 'M' })[0], /maior que o pendente/);
  assert.match(conferirEntrega([{ ...ok[0], quantidade: 5, saldoLocal: 2 }], { quem: 'M' })[0], /só 2/);
  assert.match(conferirEntrega([{ ...ok[0], local_id: '' }], { quem: 'M' })[0], /escolha o local/);
  assert.match(conferirEntrega([{ ...ok[0], quantidade: 0 }], { quem: 'M' })[0], /pelo menos um item/);
});

const reqs = [{ id: 'r1', numero: 1, situacao: 'aberta', origem: 'pedido', setor: 'Administrativo', para_nome: 'Ana', criado_em: '2026-11-03T10:00:00Z', itens: [{ codigo: 'PAP', descricao: 'PAPEL A4' }] },
  { id: 'r2', numero: 2, situacao: 'aprovacao', origem: 'pedido', setor: 'Extrusão', para_nome: 'Rui', criado_em: '2026-11-10T10:00:00Z', itens: [] },
  { id: 'r3', numero: 3, situacao: 'atendida', origem: 'balcao', setor: 'Extrusão', para_nome: 'Rui', criado_em: '2026-11-12T10:00:00Z', itens: [] },
  { id: 'r4', numero: 4, situacao: 'parcial', origem: 'pedido', setor: null, para_nome: 'Zé', criado_em: '2026-10-28T10:00:00Z', itens: [] }];
const ent = [{ requisicao_id: 'r3', valor: 60, entregue_em: '2026-11-12T11:00:00Z', cracha_lido: true }, { requisicao_id: 'r4', valor: 40.5, entregue_em: '2026-11-02T11:00:00Z', cracha_lido: false },
  { requisicao_id: 'r4', valor: 10, entregue_em: '2026-10-29T11:00:00Z', cracha_lido: false }];

test('filtro, indicadores e consumo por setor', () => {
  assert.equal(filtrar(reqs, { situacao: 'abertas' }).length, 3); assert.equal(filtrar(reqs, { situacao: 'atendida' }).length, 1); assert.equal(filtrar(reqs, { setor: 'Extrusão' }).length, 2);
  assert.equal(filtrar(reqs, { busca: 'papel' })[0].numero, 1); assert.equal(filtrar(reqs, { de: '2026-11-01', ate: '2026-11-10' }).length, 2);
  assert.deepEqual(resumo(reqs, ent, '2026-11'), { entregar: 2, aprovar: 1, entregasMes: 2, valorMes: 100.5, balcaoMes: 1, comCracha: 1 });
  assert.deepEqual(consumoPorSetor(reqs, ent), [{ setor: 'Extrusão', requisicoes: 1, valor: 60 }, { setor: 'Sem setor', requisicoes: 1, valor: 50.5 }]);
});

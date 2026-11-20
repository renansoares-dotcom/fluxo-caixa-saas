// Análise de Problemas (SQL 172): regras puras do Pareto, do Ishikawa, dos 5 porquês e do plano 5W2H
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/lib/problemas.js';

test('Pareto: ordena, soma repetidos, calcula o acumulado e marca os poucos vitais até o corte', () => {
  const G = P.pareto([{ nome: 'Bolha', valor: 20 }, { nome: 'Rasgo', valor: 50 }, { nome: 'Mancha', valor: 5 }, { nome: 'Rasgo', valor: 10 }, { nome: 'Furo', valor: 15 }, { nome: '', valor: 9 }, { nome: 'Zero', valor: 0 }]);
  assert.deepEqual(G.linhas.map(x => x.nome), ['Rasgo', 'Bolha', 'Furo', 'Mancha']); assert.equal(G.total, 100);
  assert.deepEqual(G.linhas.map(x => x.acumulado), [60, 80, 95, 100]);
  assert.deepEqual(G.linhas.map(x => x.vital), [true, true, false, false]); assert.equal(G.vitais, 2);          // 60% + 20% = 80%: os dois entram
  assert.deepEqual(P.pareto([{ nome: 'A', valor: 79 }, { nome: 'B', valor: 11 }, { nome: 'C', valor: 10 }]).linhas.map(x => x.vital), [true, true, false]);   // o que cruza o corte entra
  assert.equal(P.pareto([{ nome: 'A', valor: 90 }, { nome: 'B', valor: 10 }], 80).vitais, 1);
  assert.equal(P.pareto([]).linhas.length, 0);
});
test('Pareto: muitos itens viram "Outros", que nunca é prioridade', () => {
  const G = P.pareto(Array.from({ length: 20 }, (_, i) => ({ nome: 'M' + i, valor: 20 - i })), 80, 8);
  assert.equal(G.linhas.length, 8); assert.equal(G.linhas[7].nome, 'Outros (13)'); assert.equal(G.linhas[7].vital, false);
  assert.equal(Math.round(G.linhas.reduce((s, x) => s + x.valor, 0)), 210);
});
test('Pareto: frase e desenho', () => {
  const G = P.pareto([{ nome: 'Rasgo', valor: 60 }, { nome: 'Bolha', valor: 20 }, { nome: 'Furo', valor: 15 }, { nome: 'Mancha', valor: 5 }]);
  assert.equal(P.paretoFrase(G, 'kg'), '2 de 4 itens respondem por 80% do total de 100 kg. Comece por eles: Rasgo, Bolha.');
  assert.equal(P.paretoFrase(P.pareto([]), 'kg'), 'Sem dados para o Pareto.');
  const svg = P.paretoSVG(G, { unidade: 'kg' });
  assert.match(svg, /^<svg /); assert.equal((svg.match(/<rect /g) || []).length, 4); assert.match(svg, /<polyline /); assert.match(svg, />corte 80%</); assert.match(svg, /Rasgo/);
  assert.equal(P.paretoSVG(P.pareto([])), '');
  assert.equal(P.valorTxt(1234.5, 'R$'), 'R$ 1.234,50'); assert.equal(P.valorTxt(12, 'h'), '12 h');
});
test('Ishikawa: limpa, mantém a ordem das categorias e lista as causas prováveis', () => {
  const ish = P.limparIshikawa([{ categoria: 'Máquina', causas: [{ texto: ' Rolo gasto ', provavel: true }, { texto: '  ' }] }, { categoria: 'Antiga', causas: [{ texto: 'Sem padrão' }] }], ['Método', 'Máquina']);
  assert.deepEqual(ish.map(g => g.categoria), ['Método', 'Máquina', 'Antiga']);
  assert.deepEqual(ish[1].causas, [{ texto: 'Rolo gasto', provavel: true }]); assert.deepEqual(ish[0].causas, []);
  assert.equal(P.causasDoIshikawa(ish).length, 2); assert.deepEqual(P.causasProvaveis(ish).map(c => `${c.categoria}: ${c.texto}`), ['Máquina: Rolo gasto']);
});
test('Ishikawa: desenho com a cabeça, uma espinha por categoria e as causas (texto protegido)', () => {
  const ish = [{ categoria: 'Método', causas: [{ texto: 'Sem roteiro <b>', provavel: true }] }, { categoria: 'Máquina', causas: [{ texto: 'Caminhão quebrado' }, { texto: 'Pneu' }] }, { categoria: 'Medida', causas: [] }];
  const svg = P.ishikawaSVG('Atraso na entrega dos pedidos de outubro', ish);
  assert.match(svg, /^<svg /); assert.match(svg, /PROBLEMA/); assert.match(svg, /Método/); assert.match(svg, /Caminhão quebrado/); assert.match(svg, /Sem roteiro &lt;b&gt;/); assert.doesNotMatch(svg, /<b>/);
  assert.equal((svg.match(/font-size="11.5"/g) || []).length, 3);                // três categorias
  assert.equal(P.ishikawaSVG('x', []), '');
  assert.deepEqual(P.quebrar('Atraso na entrega dos pedidos de outubro', 16), ['Atraso na', 'entrega dos', 'pedidos de', 'outubro']);
});
test('5 Porquês: limpa as cadeias, acha a conclusão e as causas prováveis ainda sem análise', () => {
  const pq = P.limparPorques([{ partida: ' Caminhão quebrado ', respostas: ['Faltou manutenção', '', ' Peça em falta '], causa: '' }, { partida: '', respostas: [], causa: '' }]);
  assert.deepEqual(pq, [{ partida: 'Caminhão quebrado', respostas: ['Faltou manutenção', 'Peça em falta'], causa: '' }]);
  assert.equal(P.conclusaoDaCadeia(pq[0]), 'Peça em falta'); assert.equal(P.conclusaoDaCadeia({ respostas: ['a'], causa: 'Orçamento' }), 'Orçamento'); assert.equal(P.conclusaoDaCadeia({}), '');
  const ish = [{ categoria: 'Máquina', causas: [{ texto: 'Caminhão quebrado', provavel: true }, { texto: 'Pneu', provavel: false }] }, { categoria: 'Método', causas: [{ texto: 'Sem roteiro', provavel: true }] }];
  assert.deepEqual(P.partidasPendentes(ish, pq).map(c => c.texto), ['Sem roteiro']);
});
test('5W2H: ação atrasada, dias de atraso, o que falta nas sete perguntas e o andamento do plano', () => {
  const hoje = '2026-11-20', a = { o_que: 'Trocar a matriz', prazo: '2026-11-17', situacao: 'pendente', responsavel_nome: 'Ana', custo_previsto: 0 };
  assert.equal(P.acaoAtrasada(a, hoje), true); assert.equal(P.diasDeAtraso(a, hoje), 3);
  assert.equal(P.acaoAtrasada({ ...a, prazo: hoje }, hoje), false); assert.equal(P.acaoAtrasada({ ...a, situacao: 'concluida' }, hoje), false); assert.equal(P.diasDeAtraso({ ...a, situacao: 'cancelada' }, hoje), 0);
  assert.deepEqual(P.faltaNo5w2h(a), ['Por quê', 'Onde', 'Como', 'Quanto']);
  assert.deepEqual(P.faltaNo5w2h({ ...a, por_que: 'x', onde: 'y', como: 'z', custo_previsto: 10 }), []);
  const pr = P.progresso([a, { ...a, situacao: 'concluida', custo_previsto: 100, custo_real: 120 }, { ...a, situacao: 'cancelada', custo_previsto: 999 }, { ...a, situacao: 'em_andamento', prazo: '2026-12-01', custo_previsto: 50 }], hoje);
  assert.deepEqual(pr, { total: 3, feitas: 1, abertas: 2, canceladas: 1, pct: 33, atrasadas: 1, previsto: 150, real: 120 });
  assert.equal(P.progresso([]).pct, 0);
});
test('roteiro das quatro ferramentas e pendências para encerrar', () => {
  const p = { ishikawa: [{ categoria: 'Método', causas: [{ texto: 'Sem roteiro', provavel: true }] }], porques: [{ partida: 'Sem roteiro', respostas: ['x'], causa: '' }], causa_raiz: null, pareto: null };
  const A = [{ situacao: 'pendente', prazo: '2099-01-01' }];
  assert.deepEqual(P.etapas(p, A).map(e => e.feito), [false, true, false, false]);
  assert.deepEqual(P.pendenciasParaEncerrar(p, A), ['1 ação(ões) do plano ainda em aberto', 'causa raiz não registrada', 'nenhuma ação concluída']);
  const p2 = { ...p, causa_raiz: 'Falta de padrão', pareto: { itens: [{ nome: 'a', valor: 1 }] } }, A2 = [{ situacao: 'concluida' }, { situacao: 'cancelada' }];
  assert.deepEqual(P.etapas(p2, A2).map(e => e.feito), [true, true, true, true]); assert.deepEqual(P.pendenciasParaEncerrar(p2, A2), []);
  assert.deepEqual(P.pendenciasParaEncerrar(p, [], { exige_causa: false, exige_acao: false }), []);
});
test('painel: problemas abertos, sem plano, ações atrasadas e tempo médio para resolver', () => {
  const hoje = '2026-11-20';
  const PR = [{ id: 1, situacao: 'em_acao', gravidade: 'alta', prazo: '2026-11-01' }, { id: 2, situacao: 'aberto', gravidade: 'baixa' }, { id: 3, situacao: 'verificacao', gravidade: 'critica' },
    { id: 4, situacao: 'encerrado', aberto_em: '2026-10-01T12:00:00Z', encerrado_em: '2026-10-11T12:00:00Z' }, { id: 5, situacao: 'cancelado' }];
  const AC = [{ problema_id: 1, situacao: 'pendente', prazo: '2026-11-10' }, { problema_id: 1, situacao: 'em_andamento', prazo: '2026-11-25' }, { problema_id: 3, situacao: 'concluida', prazo: '2026-11-01' }, { problema_id: 5, situacao: 'pendente', prazo: '2026-01-01' }];
  assert.deepEqual(P.resumo(PR, AC, hoje), { abertos: 3, criticos: 2, verificar: 1, semPlano: 1, acoesAbertas: 2, acoesAtrasadas: 1, acoesSemana: 1, encerrados: 1, diasMedios: 10, problemasAtrasados: 1 });
});

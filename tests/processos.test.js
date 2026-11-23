// Gestão de Processos (SQL 196): fluxograma gerado das etapas, conferência das etapas e pendências do POP
import test from 'node:test';
import assert from 'node:assert/strict';
import { raias, setas, conferir, quebrar, svgFluxo } from '../js/lib/fluxograma.js';
import { pendenciasPop, situacaoPop, textoPop, mesesTxt } from '../js/lib/processos.js';

const E = [
  { tipo: 'inicio', responsavel: 'Produção', o_que: 'Lote pronto' },
  { tipo: 'atividade', responsavel: 'Qualidade', o_que: 'Inspecionar', tela: 'qualidade/inspecoes', prazo: '1 dia' },
  { tipo: 'decisao', responsavel: 'qualidade', o_que: 'Aprovado?', sim: 5, nao: 4 },
  { tipo: 'atividade', responsavel: 'Qualidade', o_que: 'Bloquear e abrir RNC', ir: 6 },
  { tipo: 'atividade', responsavel: 'Expedição', o_que: 'Liberar' },
  { tipo: 'fim', responsavel: 'Expedição', o_que: 'Fim' }];

test('raias: responsáveis na ordem em que aparecem, sem diferença de maiúscula', () => {
  assert.deepEqual(raias(E), ['Produção', 'Qualidade', 'Expedição']);
});
test('setas: seguinte, vai para, sim e não; o fim não tem saída', () => {
  assert.deepEqual(setas(E), [{ de: 1, para: 2, tipo: 'seguinte' }, { de: 2, para: 3, tipo: 'seguinte' }, { de: 3, para: 5, tipo: 'sim' }, { de: 3, para: 4, tipo: 'nao' },
    { de: 4, para: 6, tipo: 'vai' }, { de: 5, para: 6, tipo: 'seguinte' }]);
  assert.deepEqual(setas([{ tipo: 'decisao', o_que: 'x', responsavel: 'A', nao: 3 }, { tipo: 'atividade', o_que: 'y', responsavel: 'A' }, { tipo: 'fim', o_que: 'z', responsavel: 'A' }]).slice(0, 2),
    [{ de: 1, para: 2, tipo: 'sim' }, { de: 1, para: 3, tipo: 'nao' }]);   // sim vazio = a de baixo
});
test('conferir: os mesmos erros do banco e avisos de etapa solta', () => {
  assert.deepEqual(conferir(E), { erros: [], avisos: [] });
  const r = conferir([{ tipo: 'inicio', responsavel: '', o_que: 'A' }, { tipo: 'decisao', responsavel: 'B', o_que: 'Pode?' }, { tipo: 'x', responsavel: 'B', o_que: 'C' }]);
  assert.ok(r.erros.some(x => x.startsWith('Etapa 1: descreva')));
  assert.ok(r.erros.some(x => x.startsWith('Etapa 1: informe o responsável')));
  assert.ok(r.erros.some(x => x.includes('informe para qual etapa vai no "não"')));
  assert.ok(r.erros.some(x => x === 'Etapa 3: escolha o tipo.'));
  assert.ok(conferir([{ tipo: 'inicio', responsavel: 'A', o_que: 'Começo', ir: 1 }]).erros[0].includes('"vai para"'));
  assert.ok(conferir([{ tipo: 'inicio', responsavel: 'A', o_que: 'Começo' }, { tipo: 'decisao', responsavel: 'A', o_que: 'Ok?', nao: 1 }]).erros[0].includes('é a última'));
  const s = conferir([{ tipo: 'inicio', responsavel: 'A', o_que: 'Começo', ir: 3 }, { tipo: 'atividade', responsavel: 'A', o_que: 'Esquecida' }, { tipo: 'fim', responsavel: 'A', o_que: 'Fim' }]);
  assert.deepEqual(s.erros, []); assert.deepEqual(s.avisos, ['Nenhuma seta chega à etapa 2.']);
  assert.deepEqual(conferir([{ tipo: 'atividade', responsavel: 'A', o_que: 'Só isto' }]).avisos, ['O processo não começa por uma etapa de início.', 'O processo não tem etapa de fim.']);
});
test('quebrar: linhas curtas e reticências no limite', () => {
  assert.deepEqual(quebrar('Conferir produto e quantidade com o leitor', 22, 3), ['Conferir produto e', 'quantidade com o', 'leitor']);
  const q = quebrar('um dois três quatro cinco seis sete oito nove dez onze doze treze', 10, 2); assert.equal(q.length, 2); assert.ok(q[1].endsWith('…'));
});
test('svgFluxo: uma raia por responsável, uma caixa por etapa, setas e código da tela', () => {
  const s = svgFluxo(E, { codigo: (r) => (r === 'qualidade/inspecoes' ? 'PRD013' : ''), destaque: [2] });
  assert.ok(s.startsWith('<svg'));
  assert.equal((s.match(/<polyline/g) || []).length, 6);
  assert.equal((s.match(/<polygon/g) || []).length, 1);
  assert.ok(s.includes('PRD013 · 1 dia')); assert.ok(s.includes('#fff4d6'));
  assert.ok(s.includes('>Sim<') && s.includes('>Não<'));
  assert.equal(svgFluxo([]), '');
  assert.ok(!svgFluxo([{ tipo: 'inicio', responsavel: '<b>', o_que: 'a & b' }]).includes('<b>'));
});

const procs = [{ id: 'p1', dono_id: 'dono' }];
const pops = [{ id: 'A', processo_id: 'p1', ativo: true, revisar_em: '2026-12-10' }, { id: 'B', processo_id: 'p1', ativo: true, revisar_em: '2027-11-01' }];
const versoes = [
  { id: 'a1', pop_id: 'A', versao: 1, situacao: 'vigente', publico: ['compras'], leitores: [], elaborado_por: 'fin' },
  { id: 'b1', pop_id: 'B', versao: 1, situacao: 'em_aprovacao', fase: 1, aprovador_tipo: 'dono', elaborado_por: 'fin' },
  { id: 'b0', pop_id: 'B', versao: 2, situacao: 'rascunho', elaborado_por: 'fin', recusa_motivo: 'x' }];
test('pendências: o dono aprova, a Diretoria aprova a fase dela, quem precisa ler, revisão perto do vencimento', () => {
  const d = pendenciasPop({ eu: 'dono', papel: 'compras', diretoria: false, pops, versoes, procs, lidas: new Set(), hoje: '2026-11-23', avisoDias: 30 });
  assert.deepEqual(d.aprovar.map(x => x.versao.id), ['b1']);
  assert.deepEqual(d.ler.map(x => x.versao.id), ['a1']);
  assert.deepEqual(d.revisar.map(x => x.pop.id), ['A']);
  assert.equal(pendenciasPop({ eu: 'dono', papel: 'compras', pops, versoes, procs, lidas: new Set(['a1']), hoje: '2026-11-23', avisoDias: 10 }).ler.length, 0);
  assert.equal(pendenciasPop({ eu: 'dono', papel: 'compras', pops, versoes, procs, lidas: new Set(), hoje: '2026-11-23', avisoDias: 10 }).revisar.length, 0);
  const f = pendenciasPop({ eu: 'fin', papel: 'financeiro', diretoria: true, pops, versoes, procs, lidas: new Set(), hoje: '2026-11-23' });
  assert.equal(f.aprovar.length, 0); assert.deepEqual(f.rascunhos.map(x => x.versao.id), ['b0']); assert.equal(f.ler.length, 0);
  const v2 = versoes.map(v => (v.id === 'b1' ? { ...v, fase: 2, aprovado_por: 'dono' } : v));
  assert.equal(pendenciasPop({ eu: 'dono', papel: 'diretor', diretoria: true, pops, versoes: v2, procs, lidas: new Set(), hoje: '2026-11-23' }).aprovar.length, 0, 'quem aprovou como dono não aprova pela Diretoria');
  assert.equal(pendenciasPop({ eu: 'dir', papel: 'diretor', diretoria: true, pops, versoes: v2, procs, lidas: new Set(), hoje: '2026-11-23' }).aprovar.length, 1);
});
test('situação, texto do POP e meses', () => {
  assert.equal(situacaoPop(pops[1], versoes.filter(v => v.pop_id === 'B')).k, 'em_aprovacao');
  assert.equal(situacaoPop({ ativo: false }, []).k, 'obsoleto');
  const t = textoPop({ objetivo: 'Comprar <bem>', procedimento: '1. A\n2. B', etapas: [2] }, E.map((e, i) => ({ ...e, n: i + 1 })), { tela: (r) => r.toUpperCase() });
  assert.ok(t.includes('1. Objetivo') && t.includes('2. Procedimento') && t.includes('3. Etapas do processo'));
  assert.ok(t.includes('&lt;bem&gt;') && t.includes('1. A<br>2. B') && t.includes('QUALIDADE/INSPECOES'));
  assert.equal(mesesTxt(12), '1 ano'); assert.equal(mesesTxt(24), '2 anos'); assert.equal(mesesTxt(6), '6 meses'); assert.equal(mesesTxt(1), '1 mês');
});

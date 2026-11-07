// Regras de classificação (3.1): casamento por campo/operador/natureza/valor, prioridade, sugestão pelo histórico,
// partes do rateio e vencimentos dos recorrentes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regraCasa, aplicarRegras, sugerirRegras, partesDoRateio, proximosVencimentos } from '../js/lib/regras.js';

const R = (o) => ({ campo: 'texto', operador: 'contem', ativo: true, prioridade: 100, ...o });
test('regra casa por texto sem acento e maiúsculas, natureza, conta e faixa de valor', () => {
  const r = R({ texto: 'posto', natureza: 'S', plano_id: 'comb' });
  assert.equal(regraCasa(r, { descricao: 'Pagto Posto São João', natureza: 'S', valor: 80 }), true);
  assert.equal(regraCasa(r, { descricao: 'PAGTO POSTO SAO JOAO', natureza: 'E', valor: 80 }), false);
  assert.equal(regraCasa(R({ texto: 'POSTO', valor_max: 50 }), { descricao: 'POSTO', valor: 80 }), false);
  assert.equal(regraCasa(R({ texto: 'COPEL', campo: 'favorecido', operador: 'igual' }), { descricao: 'x', favorecido: 'copel' }), true);
  assert.equal(regraCasa(R({ texto: '^TAR(IFA)?\\b', operador: 'regex' }), { descricao: 'Tarifa pacote' }), true);
  assert.equal(regraCasa(R({ texto: '([', operador: 'regex' }), { descricao: 'x' }), false);
  assert.equal(regraCasa(R({ texto: 'POSTO', conta_id: 'c1' }), { descricao: 'POSTO', conta_id: 'c2' }), false);
});
test('a regra de menor prioridade vence; desativada não vale', () => {
  const rs = [R({ texto: 'POSTO', plano_id: 'geral', prioridade: 100 }), R({ texto: 'POSTO SHELL', plano_id: 'frota', prioridade: 10 }), R({ texto: 'POSTO', plano_id: 'off', prioridade: 1, ativo: false })];
  assert.equal(aplicarRegras(rs, { descricao: 'POSTO SHELL BR' }).plano_id, 'frota');
  assert.equal(aplicarRegras(rs, { descricao: 'POSTO IPIRANGA' }).plano_id, 'geral');
  assert.equal(aplicarRegras(rs, { descricao: 'MERCADO' }), null);
});
test('sugere regras pelo histórico (favorecido e palavra), com acerto mínimo e sem repetir regra existente', () => {
  const L = [];
  for (let i = 0; i < 5; i++) L.push({ descricao: `POSTO IPIRANGA ${i}`, favorecido: 'AUTO POSTO IPIRANGA', plano_id: 'comb', centro_custo_id: 'frota', natureza: 'S' });
  for (let i = 0; i < 4; i++) L.push({ descricao: `CONTA ENERGIA ${i}`, favorecido: 'NEOENERGIA', plano_id: 'energia', natureza: 'S' });
  L.push({ descricao: 'POSTO X', favorecido: 'OUTRO', plano_id: 'outro', natureza: 'S' });
  const s = sugerirRegras(L, { minOcorr: 3, minPct: 0.8 });
  const fav = s.find(p => p.campo === 'favorecido' && p.texto === 'AUTO POSTO IPIRANGA');
  assert.ok(fav); assert.equal(fav.plano_id, 'comb'); assert.equal(fav.centro_custo_id, 'frota');
  assert.ok(s.some(p => p.texto === 'NEOENERGIA'));
  assert.ok(!s.some(p => p.texto === 'IPIRANGA'));   // palavra que só repete o favorecido some
  assert.ok(s.some(p => p.texto === 'POSTO' && p.ocorrencias === 6));   // 5 de 6 no mesmo plano (83%)
  const s2 = sugerirRegras(L, { minOcorr: 3, minPct: 0.8, existentes: [R({ campo: 'favorecido', operador: 'igual', texto: 'NEOENERGIA', plano_id: 'energia' })] });
  assert.ok(!s2.some(p => p.texto === 'NEOENERGIA'));
});
test('partes do rateio fecham no centavo', () => {
  const p = partesDoRateio(1000.01, [{ centro_custo_id: 'a', pct: 33.33 }, { centro_custo_id: 'b', pct: 33.33 }, { centro_custo_id: 'c', pct: 33.34 }]);
  assert.equal(Math.round(p.reduce((s, x) => s + x.valor, 0) * 100), 100001);
});
test('vencimentos do recorrente: último dia do mês e fim de semana', () => {
  const v = proximosVencimentos({ inicio: '2027-01-01', dia: 31, frequencia: 'mensal', ajuste_fds: 'postergar' }, 3);
  assert.deepEqual(v.map(x => x.vencimento), ['2027-02-01', '2027-03-01', '2027-03-31']);   // 31/01 dom → 01/02; 28/02 dom → 01/03
  const a = proximosVencimentos({ inicio: '2027-01-01', dia: 31, frequencia: 'mensal', ajuste_fds: 'antecipar' }, 2);
  assert.deepEqual(a.map(x => x.vencimento), ['2027-01-29', '2027-02-26']);
  const t = proximosVencimentos({ inicio: '2027-01-15', dia: 10, frequencia: 'trimestral', ajuste_fds: 'manter' }, 3);
  assert.deepEqual(t.map(x => x.vencimento), ['2027-04-10', '2027-07-10', '2027-10-10']);   // 10/01 é antes do início
});

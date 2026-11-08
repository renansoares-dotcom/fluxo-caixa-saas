import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../js/lib/indices-calc.js';

const perto = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);

// balancete de mentira: saldo (devedor +) e movimento do período por classificação
function acc(atu, mov = {}, cred = {}) {
  const f = (o) => (c) => o[c] || 0;
  return { atu: f(atu), mov: f(mov), cred: f(cred) };
}
const base = () => acc(
  { '1': 1000, '1.1': 600, '1.1.1': 50, '1.1.2': 300, '1.1.5': 200, '1.2.1': 40, '2.1': -500, '2.2': -300, '2.3': -150,
    '2.1.3': -120, '2.1.1': -80, '2.2.1': -200, '3': 400, '4': -460, '5': 10 },
  { '4.1.1': -400, '4.1.2': 40, '5': 200, '3.1': 40, '3.2.20.5': 15, '4.1.3': -2, '3.2.20.7': 3, '4.2': 0, '3': 100, '4': -380 },
  { '1.2.30.7': 8 });

test('extrair: componentes do balanço e do resultado', () => {
  const v = K.extrair(base(), K.grupos());
  assert.equal(v.ac, 600); assert.equal(v.pc, 500); assert.equal(v.fornec, 120); assert.equal(v.emprest, 280);
  // PL = 150 + resultado ainda não encerrado (−(400 − 460 + 10) = 50)
  assert.equal(v.pl, 200);
  assert.equal(v.ativo, v.pc + v.pnc + v.pl);
  assert.equal(v.rb, 400); assert.equal(v.rl, 360); assert.equal(v.cmv, 240);
  // lucro do período = −(100 − 380 + 200) = 80; EBITDA = 80 + 15 − 2 + 3 + 0 + 8 = 104
  assert.equal(v.lucro, 80); assert.equal(v.ebitda, 104);
});

test('grupos e faixas ajustáveis', () => {
  const g = K.grupos({ emprest: ['2.1.1.9'], estoques: [], inexistente: ['9'] });
  assert.deepEqual(g.emprest, ['2.1.1.9']); assert.deepEqual(g.estoques, []); assert.ok(!('inexistente' in g));
  assert.deepEqual(g.ac, ['1.1']);
  const fx = K.faixas({ lc: { bom: 1.5, atencao: '' } });
  assert.equal(fx.lc.bom, 1.5); assert.equal(fx.lc.atencao, 1);
  assert.equal(K.situacao(1.6, K.IDX.lc, fx.lc), 'ok');
  assert.equal(K.situacao(1.2, K.IDX.lc, fx.lc), 'atencao');
  assert.equal(K.situacao(0.9, K.IDX.lc, fx.lc), 'abaixo');
  assert.equal(K.situacao(55, K.IDX.eg, K.faixas().eg), 'ok');
  assert.equal(K.situacao(90, K.IDX.eg, K.faixas().eg), 'abaixo');
  assert.equal(K.situacao(-1, K.IDX.cgl, K.faixas().cgl), 'abaixo');
  assert.equal(K.situacao(null, K.IDX.lc), null);
});

test('índices: liquidez, endividamento, prazos e margens', () => {
  const v = K.extrair(base(), K.grupos());
  const pts = Array.from({ length: 12 }, (_, i) => ({ ref: `2026-${String(i + 1).padStart(2, '0')}`, fim: `2026-${String(i + 1).padStart(2, '0')}-28`, dias: 30, v }));
  const f = K.fluxo12(pts, 11);
  assert.equal(f.n, 12); assert.equal(f.dias, 360); assert.equal(f.rb, 4800);
  const { x } = K.indicesDe(v, f);
  perto(x.lc, 1.2); perto(x.ls, 0.8); perto(x.li, 0.1); perto(x.lg, 0.8); assert.equal(x.cgl, 100);
  perto(x.eg, 80); perto(x.ce, 62.5); perto(x.pt, 4);
  // dívida líquida (280 − 50) ÷ EBITDA 12m (104 × 12)
  perto(x.dl, Math.round(230 / 1248 * 1e4) / 1e4);
  perto(x.pmr, 22.5); perto(x.pme, Math.round(200 / 240 * 30 * 1e4) / 1e4); perto(x.pmp, 15); perto(x.cc, Math.round((22.5 + 25 - 15) * 1e4) / 1e4);
  assert.equal(x.ebitda, 1248); perto(x.me, Math.round(104 / 360 * 1e6) / 1e4); perto(x.ml, Math.round(80 / 360 * 1e6) / 1e4);
  // com 3 meses, fluxos anualizados
  const p3 = K.fluxo12(pts.slice(0, 3), 2);
  const r3 = K.indicesDe(v, p3);
  assert.equal(r3.x.ebitda, 1248); perto(r3.x.pmr, 22.5); assert.ok(r3.avisos._parcial);
  // balancete da contabilidade: só o próprio período
  assert.equal(K.fluxo12(pts, 11, 'proprio').n, 1);
});

test('casos limite e texto', () => {
  const neg = K.extrair(acc({ '1': 100, '1.1': 100, '2.1': -150, '2.3': 50 }, { '4.1.1': -100, '3': 120, '4': -100 }), K.grupos());
  assert.equal(neg.pl, -50);
  const { x, avisos } = K.indicesDe(neg, { ...K.fluxo12([{ fim: '2026-01-31', dias: 31, v: neg }], 0) });
  assert.equal(x.pt, null); assert.ok(avisos.pt); assert.equal(x.dl, null); assert.ok(avisos.dl); assert.equal(x.cj, null);
  const pts = [8, 9, 10, 11, 12, 13].map((n, i) => ({ ref: `2026-0${i + 1}`, fim: `2026-0${i + 1}-28`, dias: 30,
    v: { ...neg, ac: n * 10, pc: 100, pl: 10 } }));
  const M = K.montar(pts, { meses: 6, ocultos: ['ml'] });
  assert.equal(M.pontos.length, 6); assert.ok(!M.inds.some(i => i.k === 'ml'));
  const lc = M.inds.find(i => i.k === 'lc');
  perto(lc.valor, 1.3); perto(lc.ant, 1.2); assert.equal(lc.a12, null); assert.equal(lc.sit, 'ok'); assert.equal(lc.tend.k, 'melhora');
  assert.match(K.leitura(lc), /R\$ 1,30/);
  assert.match(K.leitura({ ...K.IDX.pt, valor: null, aviso: 'x' }, { v: { pl: -50 } }), /passivo a descoberto/);
  assert.match(K.leitura({ ...K.IDX.cc, valor: -10 }), /fornecedores financiam/);
  assert.equal(K.fmt(12.345, '%'), '12,3%'); assert.equal(K.fmt(1, 'anos'), '1,0 ano'); assert.equal(K.fmt(null, 'x'), '—');
  assert.match(K.fmtFaixa(K.IDX.eg, K.faixas().eg), /≤ 60,0%/);
  const R = K.resumo(M.inds); assert.equal(R.ok + R.atencao + R.abaixo <= M.inds.length, true);
});

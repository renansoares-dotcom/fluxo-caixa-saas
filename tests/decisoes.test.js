import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assinatura, estado, saude, faixa, areaDaOrigem } from '../js/lib/decisoes-calc.js';

const r = { k: 'x', titulo: 'Caixa abaixo do mínimo', desc: 'faltam 10 mil' };
test('assinatura muda com o conteúdo', () => {
  assert.equal(assinatura(r), assinatura({ ...r }));
  assert.notEqual(assinatura(r), assinatura({ ...r, desc: 'faltam 12 mil' }));
});
test('estado do alerta', () => {
  const h = '2026-11-07';
  assert.equal(estado(r, null, h).aberto, true);
  assert.equal(estado(r, { situacao: 'resolvido', assinatura: assinatura(r), criado_em: '2026-11-06', por_email: 'ana@x' }, h).aberto, false);
  const v = estado({ ...r, desc: 'faltam 30 mil' }, { situacao: 'resolvido', assinatura: assinatura(r), criado_em: '2026-11-06' }, h);
  assert.equal(v.aberto, true); assert.equal(v.k, 'voltou');
  assert.equal(estado(r, { situacao: 'adiado', ate: '2026-11-10' }, h).aberto, false);
  assert.equal(estado(r, { situacao: 'adiado', ate: '2026-11-07' }, h).k, 'venceu');
  const d = estado(r, { situacao: 'delegado', delegado_nome: 'Ana', delegado_para: 'u1', criado_em: '2026-11-07' }, h);
  assert.equal(d.aberto, true); assert.match(d.txt, /Delegado a Ana em 07\/11\/2026/);
  assert.equal(estado(r, { situacao: 'reaberto' }, h).aberto, true);
});
test('saúde por área', () => {
  const S = saude([{ origem: 'Caixa', urg: 'alta', titulo: 'a' }, { origem: 'Conciliação', urg: 'baixa', titulo: 'b' }, { origem: 'Qualidade', urg: 'media', titulo: 'c' }],
    [{ k: 'perdas', nome: 'Perdas', sit: 'abaixo' }, { k: 'faturamento', nome: 'Faturamento', sit: 'atencao' }, { k: 'caixa', nome: 'Caixa', sit: 'ok' }]);
  const a = Object.fromEntries(S.areas.map(x => [x.k, x]));
  assert.equal(a.fin.nota, 77); assert.equal(a.fin.motivos[0].pontos, 20);
  assert.equal(a.prd.nota, 85); assert.equal(a.com.nota, 95); assert.equal(a.qua.nota, 92); assert.equal(a.gov.nota, 100);
  assert.equal(S.geral, Math.round((77 + 95 + 100 + 85 + 92 + 100 + 100 + 100) / 8));
  assert.equal(saude(Array(10).fill({ origem: 'Caixa', urg: 'alta', titulo: 'x' })).areas[0].nota, 0, 'nunca negativa');
  assert.equal(saude([], [], {}, { fin: 3, com: 0, cmp: 0, prd: 0, qua: 0, log: 0, fis: 0, gov: 0 }).geral, 100);
  assert.equal(faixa(85), 'boa'); assert.equal(faixa(70), 'atencao'); assert.equal(faixa(40), 'critica'); assert.equal(faixa(70, { faixa_boa: 70 }), 'boa');
  assert.equal(areaDaOrigem('Privacidade e Acessos'), 'gov'); assert.equal(areaDaOrigem('desconhecida'), 'fin');
});

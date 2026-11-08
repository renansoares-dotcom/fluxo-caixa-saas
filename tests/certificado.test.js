import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhasCertificado } from '../js/lib/certificado.js';
import { passos8D, respostaAtrasada, SIT_CLIENTE } from '../js/lib/qualidade.js';

const C = { ops: [
  { numero: 96400, produto: 'SAC-64 · SACOLA', expedida: true, bobinas: [{ codigo: 'B1', peso_kg: 250 }, { codigo: 'B2', peso_kg: 260.5 }],
    inspecoes: [{ numero: 7, etapa: 'final', situacao: 'aprovada', data: '2026-11-02T10:00:00Z', caracteristicas: [{ nome: 'Espessura', tipo: 'medida', min: 28, max: 32, unidade: 'µm' }, { nome: 'Solda', tipo: 'atributo' }],
      resultados: [{ nome: 'Espessura', valores: [29.5, 30.1, 30.4] }, { nome: 'Solda', defeitos: 0 }] }] },
  { numero: 96399, produto: 'EXT', expedida: false, bobinas: [], inspecoes: [] }] };

test('certificado: bobinas, especificação e resultado de cada característica', () => {
  const L = linhasCertificado(C);
  assert.equal(L.length, 2); assert.equal(L[0].kg, 510.5); assert.equal(L[0].op, 'OP 96400');
  const it = L[0].inspecoes[0].itens;
  assert.equal(it[0].espec, '28 a 32 µm'); assert.match(it[0].resultado, /^média 30 \(mín\. 29,5, máx\. 30,4; n=3\)$/); assert.equal(it[0].conforme, true);
  assert.equal(it[1].espec, 'Sem defeito'); assert.equal(it[1].resultado, '0 defeito(s)'); assert.equal(L[0].inspecoes[0].data, '02/11/2026');
  assert.equal(L[1].inspecoes.length, 0);
  assert.equal(linhasCertificado({ ops: [{ numero: 1, inspecoes: [{ caracteristicas: [{ nome: 'S', tipo: 'medida', min: 1.5, unidade: 'kgf' }, { nome: 'T', tipo: 'medida', max: 2 }], resultados: [] }] }] })[0].inspecoes[0].itens.map(x => x.espec).join('|'), 'mín. 1,5 kgf|máx. 2');
});

test('8D a partir da RNC', () => {
  const p = passos8D({ equipe: 'Qualidade', descricao: 'Solda abrindo', contencao: 'Fardos bloqueados', causa: 'Temperatura baixa', porques: ['a', '', 'b'], corretiva: 'Ajuste', prazo: '2026-11-20', eficacia: 'eficaz', encerrada_em: '2026-11-25T10:00:00Z' });
  assert.equal(p.length, 8); assert.ok(p.every(x => x.d.startsWith('D')));
  assert.equal(p[3].texto, 'Temperatura baixa — Por quês: 1) a 2) b'); assert.equal(p[5].texto, 'Prazo 20/11/2026 · eficácia verificada');
  assert.equal(p[6].feito, false); assert.equal(p[7].texto, 'Encerrada em 25/11/2026');
  assert.equal(passos8D({}).filter(x => x.feito).length, 0);
  assert.equal(SIT_CLIENTE.aberta, 'Recebida');
});

test('resposta ao cliente atrasada', () => {
  const r = { portal_visivel: true, prazo_resposta: '2026-11-05', situacao: 'aberta' };
  assert.equal(respostaAtrasada(r, '2026-11-06'), true); assert.equal(respostaAtrasada(r, '2026-11-05'), false);
  assert.equal(respostaAtrasada({ ...r, respondida_em: 'x' }, '2026-11-06'), false); assert.equal(respostaAtrasada({ ...r, portal_visivel: false }, '2026-11-06'), false);
});

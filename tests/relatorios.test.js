import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELOS, descreverFrequencia, parseFiltros, filtrosTexto, validar, separarEmails } from '../js/lib/relatorios.js';
const CAT = { notas: { metricas: { valor: 1 }, agrupar: { cliente: 1, mes: 1 } }, lancamentos: { metricas: { valor: 1 }, agrupar: { favorecido: 1, dia: 1, classe: 1, centro_custo: 1 } },
  saldos: { metricas: { saldo: 1 }, agrupar: { conta: 1 } }, producao: { metricas: { kg: 1, refugo_pct: 1 }, agrupar: { maquina: 1 } }, fretes: { metricas: { valor: 1 }, agrupar: { transportador: 1, destino: 1 } } };
test('modelos válidos contra o catálogo', () => {
  for (const m of MODELOS) assert.deepEqual(validar({ ...m, destinatarios: ['a@b.com'] }, CAT), [], m.id);
});
test('frequência, filtros e e-mails', () => {
  assert.equal(descreverFrequencia({ frequencia: 'semanal', dia_semana: 1, hora: 8 }), 'Toda segunda às 08h');
  assert.equal(descreverFrequencia({ frequencia: 'mensal', dia_mes: 2, hora: 7 }), 'Todo dia 2 às 07h');
  assert.equal(descreverFrequencia({ frequencia: 'dias_uteis', hora: 18 }), 'Dias úteis (seg. a sex.) às 18h');
  assert.deepEqual(parseFiltros('status=Em aberto; tipo = saida\nx'), { status: 'Em aberto', tipo: 'saida' });
  assert.equal(filtrosTexto({ a: '1', b: '2' }), 'a=1; b=2');
  assert.deepEqual(separarEmails('A@x.com, b@y.com; a@x.com'), ['a@x.com', 'b@y.com']);
  const e = validar({ nome: 'ab', destinatarios: ['ruim'], blocos: [{ fonte: 'notas', metrica: 'kg' }] }, CAT);
  assert.equal(e.length, 3);
});

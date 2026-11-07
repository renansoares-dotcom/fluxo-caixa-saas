// Avisos: horário de silêncio (madrugada, fim de semana, janela no mesmo dia, desligado) e o código do catálogo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../js/lib/avisos.js';

const h = (s) => new Date(s);   // horários em UTC; São Paulo = UTC−3
test('silêncio 20h–7h e fim de semana', () => {
  assert.equal(A.emSilencio(A.PADRAO, h('2026-11-09T23:30:00Z')), true);    // seg 20h30 em SP
  assert.equal(A.emSilencio(A.PADRAO, h('2026-11-10T09:30:00Z')), true);    // ter 6h30
  assert.equal(A.emSilencio(A.PADRAO, h('2026-11-10T10:30:00Z')), false);   // ter 7h30
  assert.equal(A.emSilencio(A.PADRAO, h('2026-11-07T15:00:00Z')), true);    // sábado 12h
  assert.equal(A.emSilencio({ ...A.PADRAO, fim_de_semana: false }, h('2026-11-07T15:00:00Z')), false);
  assert.equal(A.emSilencio({ ...A.PADRAO, silencio: false }, h('2026-11-09T23:30:00Z')), false);
  assert.equal(A.emSilencio({ ...A.PADRAO, inicio: '12:00', fim: '13:30' }, h('2026-11-10T15:45:00Z')), true);   // almoço 12h45
});
test('código do catálogo e resumo', () => {
  const C = [{ codigo: 'paraquedas' }, { codigo: 'decisao_dia' }, { codigo: 'arte' }, { codigo: 'os_urgente' }];
  assert.equal(A.codigoDo('paraquedas_novo', C), 'paraquedas');
  assert.equal(A.codigoDo('decisao_dia_aprovada', C), 'decisao_dia');
  assert.equal(A.codigoDo('os_urgente', C), 'os_urgente');
  assert.equal(A.codigoDo('outro', C), null);
  assert.match(A.resumoHorario(A.PADRAO), /20h às 07h e no fim de semana/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casarArquivo, caminhoDoc, resumoSST } from '../js/lib/rh-docs.js';
const C = [{ id: 'a', nome: 'ANA PAULA FERREIRA', matricula: '0012', cpf: '123.456.789-01' }, { id: 'b', nome: 'BRUNO LIMA', matricula: '15', cpf: null }, { id: 'c', nome: 'ANA', matricula: '120' }];
test('casar arquivo com o colaborador', () => {
  assert.equal(casarArquivo('holerite_12345678901_out.pdf', C).por, 'cpf');
  assert.deepEqual([casarArquivo('Holerite 2026-10 mat 15.pdf', C).colab.id, casarArquivo('Holerite 2026-10 mat 15.pdf', C).por], ['b', 'matricula']);
  assert.equal(casarArquivo('012 - recibo.pdf', C).colab.id, 'a');
  assert.equal(casarArquivo('Holerite Bruno Lima.pdf', C).colab.id, 'b');
  assert.equal(casarArquivo('qualquer.pdf', C), null);
});
test('caminho e resumo', () => {
  assert.match(caminhoDoc('E', 'C', 'holerite', '2026-10-01', 'Holerite Out/2026 (Ana).pdf'), /^E\/C\/2026-10-holerite-[a-z0-9]+-Holerite_Out_2026_Ana_\.pdf$/);
  const R = resumoSST([{ colaborador_id: 1, situacao: 'vencido' }, { colaborador_id: 1, situacao: 'a_vencer' }, { colaborador_id: 2, situacao: 'pendente', obrigatorio: true }, { colaborador_id: 3, situacao: 'pendente', obrigatorio: false }, { colaborador_id: 3, situacao: 'em_dia' }]);
  assert.deepEqual(R, { vencido: 1, a_vencer: 1, pendente: 1, em_dia: 1, pessoas: 2 });
});

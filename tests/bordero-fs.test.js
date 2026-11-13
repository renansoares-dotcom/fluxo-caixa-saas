// Número do borderô da FS: termo aditivo, e termo/contrato a partir do contrato 000002 (dados fictícios).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBordero } from '../js/lib/bordero.js';

const base = (cab) => `${cab}
19/10/2026 do qual passa a fazer parte integrante
                   Demonstrativo da Operação
 Operação: 999 de 03/11/2026
 (+) Face                                  R$               10.000,00
 (-) Diferencial                           R$                  500,00
 TOTAL DOS PAGAMENTOS REALIZADOS           R$                9.500,00
 30001-001   03/12/2026   10.000,00   11.222.333/0001-81   CLIENTE EXEMPLO LTDA`;

test('FS: contrato 000002 numera termo/contrato; contrato 000001 só o termo', () => {
  const novo = parseBordero(base('Termo Aditivo n.º 000008 ao contrato de Fomento Mercantil Convencional n.º 000002 firmado em'), 'FS');
  assert.equal(novo.bordero, '000008/000002'); assert.equal(novo.valor_face, 10000);
  const antigo = parseBordero(base('Termo Aditivo n.º 001226 ao contrato de Fomento Mercantil Convencional n.º 000001 firmado em'), 'FS');
  assert.equal(antigo.bordero, '001226');
});

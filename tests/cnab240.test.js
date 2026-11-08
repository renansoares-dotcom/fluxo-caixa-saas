import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/lib/cnab240.js';

// boleto fictício montado com os dígitos verificadores corretos (banco 341, R$ 1.234,56, vencimento 10/12/2026)
const mod10 = (s) => { let soma = 0, p = 2; for (let i = s.length - 1; i >= 0; i--) { let r = +s[i] * p; if (r > 9) r = Math.floor(r / 10) + (r % 10); soma += r; p = p === 2 ? 1 : 2; } return (10 - (soma % 10)) % 10; };
const mod11 = (s) => { let soma = 0, p = 2; for (let i = s.length - 1; i >= 0; i--) { soma += +s[i] * p; p = p === 9 ? 2 : p + 1; } const r = 11 - (soma % 11); return r === 0 || r > 9 ? 1 : r; };
const fator = 1000 + Math.round((Date.UTC(2026, 11, 10) - Date.UTC(2025, 1, 22)) / 864e5);
const livre = '1234567890123456789012345';
const semDv = '341' + '9' + String(fator) + '0000123456' + livre;
const barras = semDv.slice(0, 4) + mod11(semDv) + semDv.slice(4);
const c1 = barras.slice(0, 4) + barras.slice(19, 24), c2 = barras.slice(24, 34), c3 = barras.slice(34, 44);
const linha = c1 + mod10(c1) + c2 + mod10(c2) + c3 + mod10(c3) + barras[4] + barras.slice(5, 19);

test('ler boleto: linha digitável e código de barras', () => {
  const b = C.lerBoleto(linha, new Date('2026-11-08'));
  assert.equal(b.barras, barras); assert.equal(b.banco, '341'); assert.equal(b.valor, 1234.56); assert.equal(b.vencimento, '2026-12-10');
  assert.equal(C.lerBoleto(barras, new Date('2026-11-08')).vencimento, '2026-12-10');
  assert.match(C.lerBoleto(linha.slice(0, 10) + ((+linha[10] + 1) % 10) + linha.slice(11)).erro, /dígito/);
  assert.match(C.lerBoleto('8' + '1'.repeat(47)).erro, /consumo/);
  assert.match(C.lerBoleto('123').erro, /47/);
});

test('forma sugerida e pendências', () => {
  const fav = { documento: '12.345.678/0001-95', banco_codigo: '237', agencia: '1234', conta_numero: '56789' };
  assert.equal(C.formaSugerida({ codigo_barras: linha, fav }, '341'), 'boleto');
  assert.equal(C.formaSugerida({ fav: { ...fav, pix: 'a@b.com', pix_tipo: 'email' } }, '341'), 'pix');
  assert.equal(C.formaSugerida({ fav }, '341'), 'ted');
  assert.equal(C.formaSugerida({ fav }, '237'), 'credito');
  assert.equal(C.formaSugerida({ fav: {} }, '237'), null);
  assert.deepEqual(C.pendencias({ valor: 10, fav: { documento: '1' } }, 'ted'), ['CPF/CNPJ do beneficiário', 'banco', 'agência', 'conta']);
});

test('arquivo CNAB 240: 240 posições, lotes, trailers e campos', () => {
  const E = { nome: 'Plásticos Exemplo', cnpj: '11.222.333/0001-81', logradouro: 'Rua A', municipio: 'Recife', uf: 'PE', cep: '50000-000' };
  const CT = { banco: '341', agencia: '0123', agencia_dv: '', conta: '45678', conta_dv: '9', convenio: '', layout: {} };
  const fav = { nome: 'Fornecedor Ação Ltda', documento: '12.345.678/0001-95', banco_codigo: '237', agencia: '1234', agencia_dv: '5', conta_numero: '56789', conta_dv: '0' };
  const T = [
    { forma: 'ted', valor: 1500.5, vencimento: '2026-11-10', seu_numero: 'L1', descricao: 'NF 10', fav },
    { forma: 'pix', valor: 200, vencimento: '2026-11-10', seu_numero: 'L2', fav: { ...fav, pix: 'financeiro@fornecedor.com.br', pix_tipo: 'email' } },
    { forma: 'boleto', valor: 1234.56, vencimento: '2026-12-10', seu_numero: 'L3', codigo_barras: linha, fav },
  ];
  const R = C.gerarRemessa({ E, C: CT, titulos: T, nsa: 7, data: '2026-11-10', agora: new Date(2026, 10, 9, 14, 30, 5) });
  for (const l of R.linhas) assert.equal(l.length, 240);
  assert.equal(R.lotes, 3); assert.equal(R.total, 2935.06);
  // header de arquivo + 3 × (header + 2 detalhes + trailer) + trailer de arquivo
  assert.equal(R.linhas.length, 1 + 4 + 4 + 4 + 1);
  const h = R.linhas[0];
  assert.equal(h.slice(0, 3), '341'); assert.equal(h[7], '0'); assert.equal(h.slice(18, 32), '11222333000181'); assert.equal(h.slice(157, 163), '000007'); assert.equal(h.slice(143, 151), '09112026');
  const hl = R.linhas[1]; assert.equal(hl[7], '1'); assert.equal(hl.slice(11, 13), '41'); assert.equal(hl.slice(13, 16), '046');
  const a = R.linhas[2]; assert.equal(a[13], 'A'); assert.equal(a.slice(17, 20), '018'); assert.equal(a.slice(20, 23), '237'); assert.equal(a.slice(43, 73).trim(), 'FORNECEDOR ACAO LTDA');
  assert.equal(a.slice(93, 101), '10112026'); assert.equal(a.slice(119, 134), '000000000150050'); assert.equal(a.slice(219, 224), '00005');
  const tl = R.linhas[4]; assert.equal(tl[7], '5'); assert.equal(tl.slice(17, 23), '000004'); assert.equal(tl.slice(23, 41), '000000000000150050');
  const pixB = R.linhas[7]; assert.equal(pixB[13], 'B'); assert.equal(pixB.slice(14, 17).trim(), '02'); assert.equal(pixB.slice(127, 226).trim(), 'financeiro@fornecedor.com.br');
  const j = R.linhas[10]; assert.equal(j[13], 'J'); assert.equal(j.slice(17, 61), barras); assert.equal(j.slice(152, 167), '000000000123456');
  assert.equal(R.linhas[9].slice(11, 13), '30', 'boleto do mesmo banco = forma 30');
  const j52 = R.linhas[11]; assert.equal(j52.slice(17, 19), '52');
  const ta = R.linhas.at(-1); assert.equal(ta.slice(3, 8), '99999'); assert.equal(ta.slice(17, 23), '000003'); assert.equal(ta.slice(23, 29), '000014');
  assert.ok(R.texto.endsWith('\r\n')); assert.equal(R.nome, 'PAG_341_20261110_000007.REM');
});

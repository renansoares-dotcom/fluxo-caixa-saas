// Atualização cadastral da reforma (COM010)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparar, atualDoCadastro, conferir, texto, tipoPelaDestinacao, perfilParaCompetitividade } from '../js/lib/cadastro-reforma.js';

test('compara a resposta com o cadastro e marca o que muda', () => {
  const atual = atualDoCadastro({ email: 'antigo@cliente.com', uf: 'PE', cep: '55660000', regime_tributario: 'Lucro Presumido', telefone: '(81) 3333-4444' }, null);
  const L = comparar({ email_nfe: 'nfe@cliente.com', uf: 'PE', cep: '55660-000', regime: 'real', telefone: '81 33334444', destinacao: ['industrializacao'] }, atual);
  const m = Object.fromEntries(L.map(x => [x.chave, x]));
  assert.equal(m.email_nfe.muda, true);
  assert.equal(m.uf.muda, false);
  assert.equal(m.cep.muda, false, 'CEP com ou sem traço é o mesmo');
  assert.equal(m.telefone.muda, false, 'telefone só números');
  assert.equal(m.regime.atual, 'Lucro Presumido');
  assert.equal(m.regime.novo, 'Lucro Real');
  assert.equal(m.destinacao.novo, 'Industrialização');
  assert.ok(!('ie' in m), 'campo não respondido fica fora');
});

test('confere a resposta antes de enviar', () => {
  assert.ok(conferir({}).length >= 5);
  const ok = { contribuinte_icms: '1', regime: 'real', destinacao: ['revenda'], cep: '55660-000', declarante: { nome: 'Maria' }, aceite: true };
  assert.deepEqual(conferir(ok), []);
  assert.ok(conferir({ ...ok, email_nfe: 'x@' }).some(p => p.includes('NF-e')));
  assert.ok(conferir({ ...ok, cep: '123' }).some(p => p.includes('CEP')));
});

test('textos, atividade e perfil para a competitividade', () => {
  assert.equal(texto('especiais', { zfm: true, reducao: 'reducao_60', orgao_publico: false }), 'Zona Franca/ALC · Redução na reforma: Redução de 60%');
  assert.equal(texto('contato_fiscal', { nome: 'Maria', email: 'm@c.com' }), 'Maria · m@c.com');
  assert.equal(tipoPelaDestinacao(['uso_consumo', 'revenda'], '1'), 'comercio');
  assert.equal(tipoPelaDestinacao(['revenda', 'industrializacao'], '1'), 'industria');
  assert.equal(tipoPelaDestinacao(['uso_consumo'], '1'), 'consumidor_contrib');
  assert.equal(tipoPelaDestinacao(['revenda'], '9'), 'nao_contrib');
  assert.deepEqual(perfilParaCompetitividade({ tipo: 'industria', regime: 'real', cred_icms: 'sim', cred_pc: 'nao_sei' }, { uf: 'PE' }),
    { uf: 'PE', tipo: 'industria', regime: 'real', cred_icms: true });
  assert.equal(perfilParaCompetitividade({ cred_icms: 'sim' }, {}), null);
});

test('páginas públicas liberam a conexão com o Supabase (CSP)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['cadastro.html', 'cotacao.html', 'portal.html', 'index.html']) {
    const csp = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
    assert.match(csp, /connect-src 'self' https:\/\/ceyzvhcpgokysgmpdalt\.supabase\.co/, `${f}: connect-src`);
    assert.match(csp, /object-src 'none'/, `${f}: object-src`);
  }
});

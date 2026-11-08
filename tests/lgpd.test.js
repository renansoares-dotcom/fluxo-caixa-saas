import { test } from 'node:test';
import assert from 'node:assert/strict';
import { termoHTML, situacaoAcesso, prazoSolicitacao, mascararCPF, modeloTermo } from '../js/lib/lgpd-calc.js';

test('termo vira HTML seguro', () => {
  const h = termoHTML('Olá **mundo**\ncontinua\n\n## Título\n- um\n- dois <script>\n\nfim');
  assert.equal(h, '<p>Olá <b>mundo</b> continua</p><h3>Título</h3><ul><li>um</li><li>dois &lt;script&gt;</li></ul><p>fim</p>');
  assert.equal(termoHTML(''), '');
});
test('situação do acesso', () => {
  const cfg = { inativos_dias: 60, aviso_dias: 7, inativos_acao: 'suspender' };
  assert.equal(situacaoAcesso({ dias: 10 }, cfg).k, 'ok');
  assert.equal(situacaoAcesso({ dias: 55 }, cfg).k, 'aviso');
  assert.equal(situacaoAcesso({ dias: 55 }, cfg).txt, 'Suspensão em 5 dia(s)');
  assert.equal(situacaoAcesso({ dias: 61 }, cfg).k, 'suspender');
  assert.equal(situacaoAcesso({ dias: 61 }, { ...cfg, inativos_acao: 'avisar' }).k, 'avisar');
  assert.equal(situacaoAcesso({ dias: 90, protegido: true }, cfg).k, 'protegido');
  assert.equal(situacaoAcesso({ dias: 5, eu: true }, cfg).k, 'ok');
});
test('prazo da solicitação', () => {
  const h = new Date(2026, 10, 7);
  assert.deepEqual(prazoSolicitacao('2026-11-22', h), { dias: 15, cls: '', txt: '15 dia(s)' });
  assert.equal(prazoSolicitacao('2026-11-09', h).cls, 'aberto');
  assert.equal(prazoSolicitacao('2026-11-07', h).txt, 'vence hoje');
  assert.equal(prazoSolicitacao('2026-11-05', h).txt, 'atrasada 2 dia(s)');
});
test('máscara do CPF e modelos', () => {
  assert.equal(mascararCPF('123.456.789-09'), '123.***.***-09');
  assert.equal(mascararCPF('12.345.678/0001-90'), '12.345.678/0001-90');
  const t = modeloTermo('equipe', { empresa: 'ACME', encarregado: 'Ana', email: 'a@x.com' });
  assert.ok(t.includes('**ACME**') && t.includes('a@x.com') && t.length > 500);
  assert.ok(modeloTermo('portal').includes('[EMPRESA]'));
});

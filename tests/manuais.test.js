// Regra dos manuais (tutoriais/README.md): toda funcionalidade tem manual, com versão, data, histórico e PDF atualizados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { MANUAIS } from '../js/lib/tutoriais.js';
import { lerManual } from '../js/lib/markdown.js';

const raiz = new URL('../', import.meta.url);
const ler = (p) => readFileSync(new URL(p, raiz), 'utf8');

test('cada manual do catálogo tem texto, PDF e histórico coerentes', () => {
  for (const m of MANUAIS) {
    const md = `tutoriais/${m.id}.md`, pdf = `tutoriais/pdf/${m.id}.pdf`;
    assert.ok(existsSync(new URL(md, raiz)), `falta ${md}`);
    assert.ok(existsSync(new URL(pdf, raiz)), `falta ${pdf} (rode tutoriais/gerar-pdf.mjs ${m.id})`);
    const { dados, corpo } = lerManual(ler(md));
    for (const k of ['titulo', 'tela', 'versao', 'atualizado']) assert.ok(dados[k], `${md}: falta "${k}" no cabeçalho`);
    assert.match(dados.atualizado, /^\d{4}-\d{2}-\d{2}$/, `${md}: data "atualizado" no formato AAAA-MM-DD`);
    assert.ok(corpo.includes(`| ${dados.versao} |`), `${md}: o histórico de alterações não tem a versão ${dados.versao}`);
    assert.ok(statSync(new URL(pdf, raiz)).size > 5000, `${pdf} parece vazio`);
  }
});

test('ids e rotas do catálogo não se repetem', () => {
  const ids = MANUAIS.map(m => m.id), rotas = MANUAIS.flatMap(m => m.rotas);
  assert.equal(new Set(ids).size, ids.length, 'id repetido');
  assert.equal(new Set(rotas).size, rotas.length, 'rota em dois manuais');
});

test('toda tela do menu tem manual', () => {
  const html = ler('index.html');
  const rotas = [...html.matchAll(/href="#\/([a-z0-9-]+)"/g)].map(x => x[1]);
  const cobertas = new Set(MANUAIS.flatMap(m => m.rotas).concat(['tutoriais']));
  const sem = [...new Set(rotas)].filter(r => !cobertas.has(r));
  assert.deepEqual(sem, [], `telas do menu sem manual: ${sem.join(', ')}`);
});

test('as figuras dos manuais existem na pasta tutoriais/img', () => {
  for (const m of MANUAIS) {
    const refs = [...ler(`tutoriais/${m.id}.md`).matchAll(/^!\[[^\]]*\]\((img\/[^)]+)\)\s*$/gm)].map(x => x[1]);
    for (const r of refs) assert.ok(existsSync(new URL(`tutoriais/${r}`, raiz)), `${m.id}: falta tutoriais/${r}`);
  }
});

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { FIGS } from './figuras.mjs';
const D = new URL('../../tutoriais/', import.meta.url).pathname;
const todas = [...FIGS, ['conversas', 'conversas', '## 3.', 'Conversa individual aberta, com a lista à esquerda']];   // conversas-1.jpg: tirado à parte (mock do chat)
const cont = {}, porManual = {};
for (const [m, , apos, leg] of todas) { const n = cont[m] = (cont[m] || 0) + 1; (porManual[m] ||= []).push({ n, apos, leg, arq: `img/${m}-${n}.jpg` }); }
for (const [m, figs] of Object.entries(porManual)) {
  const p = D + m + '.md'; let s = readFileSync(p, 'utf8');
  s = s.split('\n').filter(l => !/^!\[[^\]]*\]\(img\//.test(l)).join('\n').replace(/\n{3,}/g, '\n\n');   // tira figuras antigas
  for (const f of figs) {
    if (!existsSync(D + f.arq)) throw new Error('falta ' + f.arq);
    const L = s.split('\n'), i = L.findIndex(l => l.startsWith(f.apos + ' ') || l === f.apos);
    if (i < 0) throw new Error(`${m}: sem o título ${f.apos}`);
    L.splice(i + 1, 0, '', `![Figura ${f.n} — ${f.leg} (dados fictícios)](${f.arq})`);
    s = L.join('\n');
  }
  // versão e histórico
  const v = s.match(/^versao: (\d+)\.(\d+)$/m), nova = `${v[1]}.${+v[2] + 1}`;
  if (!s.includes('| Imagens das telas, com dados fictícios. |')) {
    s = s.replace(/^versao: .*$/m, `versao: ${nova}`).replace(/^atualizado: .*$/m, 'atualizado: 2026-10-29');
    s = s.replace(/\n*$/, '') + `\n| ${nova} | 29/10/2026 | Imagens das telas, com dados fictícios. |\n`;
  }
  writeFileSync(p, s); console.log(m, figs.length, 'figura(s), versão', nova);
}

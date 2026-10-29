// Gera os PDFs dos manuais (tutoriais/pdf/<id>.pdf) a partir dos textos (tutoriais/<id>.md), no padrão dos relatórios.
// Uso:  node tutoriais/gerar-pdf.mjs            (todos)
//       node tutoriais/gerar-pdf.mjs rh compras  (só esses)
// Precisa do Playwright com Chromium (npm i -g playwright && npx playwright install chromium) — ou PLAYWRIGHT=/caminho/index.mjs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MANUAIS } from '../js/lib/tutoriais.js';
import { htmlManual } from '../js/lib/manual-html.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const pw = process.env.PLAYWRIGHT ? await import(pathToFileURL(process.env.PLAYWRIGHT).href) : await import('playwright');
const { chromium } = pw.default?.chromium ? pw.default : pw;

const svg = readFileSync(join(DIR, '..', 'assets', 'iplamm-logo.svg'));
const logo = { data: 'data:image/svg+xml;base64,' + svg.toString('base64') };
const pedidos = process.argv.slice(2);
const lista = MANUAIS.filter(m => !pedidos.length || pedidos.includes(m.id));
mkdirSync(join(DIR, 'pdf'), { recursive: true });
const b = await chromium.launch();
const p = await b.newPage();
for (const m of lista) {
  const md = readFileSync(join(DIR, `${m.id}.md`), 'utf8');
  await p.setContent(htmlManual(m, md, logo), { waitUntil: 'load' });
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  writeFileSync(join(DIR, 'pdf', `${m.id}.pdf`), pdf);
  console.log(`tutoriais/pdf/${m.id}.pdf`, Math.round(pdf.length / 1024) + ' KB');
}
await b.close();

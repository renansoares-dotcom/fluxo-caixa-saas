const pw = process.env.PLAYWRIGHT ? await import(process.env.PLAYWRIGHT) : await import('playwright'); const { chromium } = pw.default?.chromium ? pw.default : pw;
import { mkdirSync } from 'node:fs';
import { FIGS } from './figuras.mjs';
const OUT = new URL('../../tutoriais/img/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const so = process.argv[2]?.split(',');
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 820 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(() => { try { localStorage.setItem('fc-empresa', 'emp1'); } catch {} });
await p.goto('http://localhost:8840/index.html#/lancamentos'); await p.waitForTimeout(3500);
const cont = {};
for (const [m, rota, , leg, aba] of FIGS) {
  const n = cont[m] = (cont[m] || 0) + 1; if (so && !so.includes(m)) continue;
  await p.evaluate((r) => { location.hash = '#/x'; setTimeout(() => { location.hash = '#/' + r; }, 50); }, rota); await p.waitForTimeout(2000);
  if (aba) { const [a1, rol] = aba.split('|scroll:'); await p.click(a1.startsWith('click:') ? a1.slice(6) : `[data-a="${a1}"]`); await p.waitForTimeout(800); if (rol) { await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), rol); await p.waitForTimeout(300); } }
  await p.evaluate(() => { document.querySelectorAll('#toast-root > *').forEach(t => t.remove()); scrollTo(0, 0); });
  await p.screenshot({ path: `${OUT}${m}-${n}.jpg`, type: 'jpeg', quality: 80 });
  console.log(`${m}-${n}.jpg  ${leg}`);
}
await b.close();

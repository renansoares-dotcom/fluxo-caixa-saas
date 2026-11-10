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
  await p.evaluate((r) => { document.querySelectorAll('.modal-back, .cp-drawer-back').forEach(m => m.remove()); location.hash = '#/x'; setTimeout(() => { location.hash = '#/' + r; }, 50); }, rota); await p.waitForTimeout(2000);
  // passos separados por "|": aba (data-a), click:<seletor>, scroll:<seletor>, fill:<seletor>=<valor>, select:<seletor>=<texto da opção>, offline ou online, na ordem
  if (aba) for (const passo of aba.split('|')) {
    if (passo === 'offline' || passo === 'online') { await p.context().setOffline(passo === 'offline'); await p.evaluate((o) => window.dispatchEvent(new Event(o)), passo); await p.waitForTimeout(500); }
    else if (passo.startsWith('file:')) { await p.setInputFiles(passo.slice(5), { name: 'extrato.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ficticio') }); await p.waitForTimeout(800); }
    else if (passo.startsWith('select:')) { const r = passo.slice(7), k = r.lastIndexOf('='), sel = r.slice(0, k), txt = r.slice(k + 1); await p.evaluate(([s, t]) => { const e = document.querySelector(s), o = [...e.options].find(x => x.textContent.includes(t)); if (o) { e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }, [sel, txt]); await p.waitForTimeout(700); }
    else if (passo.startsWith('fill:')) { const r = passo.slice(5), k = r.lastIndexOf('='); await p.fill(r.slice(0, k), r.slice(k + 1)); }
    else if (passo.startsWith('scroll:')) { await p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), passo.slice(7)); await p.waitForTimeout(300); }
    else { await p.click(passo.startsWith('click:') ? passo.slice(6) : `[data-a="${passo}"]`); await p.waitForTimeout(800); }
  }
  await p.evaluate((rolou) => { document.querySelectorAll('#toast-root > *').forEach(t => t.remove()); if (!rolou) scrollTo(0, 0); }, !!aba?.includes('scroll:'));
  await p.screenshot({ path: `${OUT}${m}-${n}.jpg`, type: 'jpeg', quality: 80 });
  // depois de uma figura sem internet: esvazia a fila do aparelho e volta o sinal
  if (aba?.includes('offline')) { await p.evaluate(() => new Promise(r => { const o = indexedDB.open('iplamm-offline'); o.onsuccess = () => { try { const t = o.result.transaction('fila', 'readwrite'); t.objectStore('fila').clear(); t.oncomplete = () => r(); } catch { r(); } }; o.onerror = () => r(); }));
    await p.context().setOffline(false); await p.waitForTimeout(300); }
  console.log(`${m}-${n}.jpg  ${leg}`);
}
await b.close();

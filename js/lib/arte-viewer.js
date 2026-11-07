// Visualizador de arte compartilhado pela plataforma e pelo Portal do Cliente:
//  - prévia: a página 1 do PDF vira imagem no navegador (pdf.js), com as medidas da página em mm;
//  - zoom (botões, roda do mouse, pinça no celular), arrastar, ajustar à tela;
//  - pinos numerados nas coordenadas da arte (0–1), clique para marcar quando permitido;
//  - comparação de versões: lado a lado (zoom sincronizado), cortina (arrastar a divisória) e diferença (pixels que mudaram
//    destacados em vermelho, com a % da área alterada).
import { carregarPdfjs } from './pdfjs.js';
import { sha256, nomeSeguro } from './preimpressao.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** gera a prévia (imagem) de um arquivo: PDF (página 1) ou imagem. Devolve { blob, largura, altura, paginas, mmLargura, mmAltura } */
export async function gerarPrevia(file, { maxLado = 2400, tipo = 'image/jpeg', qualidade = 0.9 } = {}) {
  const ehPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  let paginas = 1, mmLargura = null, mmAltura = null;
  if (ehPdf) {
    const pdfjs = await carregarPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    paginas = doc.numPages;
    const pg = await doc.getPage(1), v1 = pg.getViewport({ scale: 1 });
    mmLargura = v1.width * 25.4 / 72; mmAltura = v1.height * 25.4 / 72;
    const vp = pg.getViewport({ scale: Math.min(6, maxLado / Math.max(v1.width, v1.height)) });
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    doc.destroy();
  } else if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
    const bmp = await createImageBitmap(file), k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  } else return null;   // AI, EPS, TIFF: sem prévia no navegador — peça o PDF
  const blob = await new Promise((ok) => cv.toBlob(ok, tipo, qualidade));
  return { blob, largura: cv.width, altura: cv.height, paginas, mmLargura, mmAltura };
}

export const TAM_MAX = 50 * 1024 * 1024;
export const ACEITOS = '.pdf,.png,.jpg,.jpeg,.webp,.ai,.eps,.tif,.tiff';

/** lê o arquivo: hash SHA-256 e a prévia em imagem (as duas coisas ficam com a versão) */
export async function prepararArquivo(file) {
  if (file.size > TAM_MAX) throw new Error('Arquivo maior que 50 MB. Envie o PDF da arte (o arquivo aberto fica com a pré-impressão).');
  const [hash, previa] = await Promise.all([sha256(await file.arrayBuffer()), gerarPrevia(file).catch(() => null)]);
  return { hash, previa };
}

/** sobe o arquivo e a prévia para artes/<empresa>/<projeto>/ com o cliente Supabase informado (plataforma ou portal) */
export async function subirArquivos(sb, projeto, file, prep) {
  const base = `${projeto.empresa_id}/${projeto.id}/${Date.now()}`, caminho = `${base}-${nomeSeguro(file.name)}`;
  let { error } = await sb.storage.from('artes').upload(caminho, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  let previa = null;
  if (prep.previa?.blob) {
    previa = `${base}-previa.jpg`;
    ({ error } = await sb.storage.from('artes').upload(previa, prep.previa.blob, { contentType: 'image/jpeg' }));
    if (error) throw error;
  }
  return { caminho, previa };
}

/** links temporários (1 h) das prévias, com cache */
const cacheUrl = new Map();
export async function linksArte(sb, caminhos = []) {
  const agora = Date.now(), falta = [...new Set(caminhos.filter(c => c && !(cacheUrl.get(c)?.ate > agora)))];
  if (falta.length) {
    const { data, error } = await sb.storage.from('artes').createSignedUrls(falta, 3600);
    if (error) throw error;
    for (const d of data || []) if (d.signedUrl) cacheUrl.set(d.path, { url: d.signedUrl, ate: agora + 3300e3 });
  }
  return Object.fromEntries(caminhos.filter(Boolean).map(c => [c, cacheUrl.get(c)?.url]));
}

/** baixa o arquivo original, confere o SHA-256 com o registrado e devolve { ok, hash, blob } */
export async function conferirArquivo(sb, caminho, hashEsperado) {
  const { data, error } = await sb.storage.from('artes').download(caminho);
  if (error) throw error;
  const h = await sha256(await data.arrayBuffer());
  return { ok: h === hashEsperado, hash: h, blob: data };
}

let cssPronto = false;
function css() {
  if (cssPronto) return; cssPronto = true;
  const s = document.createElement('style');
  s.textContent = `
  .av{display:flex;flex-direction:column;gap:8px;min-width:0}
  .av-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between}
  .av-bar .av-g{display:flex;gap:4px;align-items:center;flex-wrap:wrap}
  .av-bar .btn.on{background:var(--primary);color:#fff;border-color:var(--primary)}
  .av-zoom{min-width:48px;text-align:center;font-variant-numeric:tabular-nums}
  .av-palco{position:relative;display:grid;gap:8px;grid-template-columns:1fr;height:var(--av-h,62vh);min-height:300px}
  .av-palco.lado{grid-template-columns:1fr 1fr}
  .av-vista{position:relative;overflow:hidden;border:1px solid var(--border);border-radius:10px;touch-action:none;cursor:grab;
    background:repeating-conic-gradient(var(--bg) 0 25%,var(--surface,#fff) 0 50%) 0 0/20px 20px}
  .av-vista.arrastando{cursor:grabbing}.av-vista.marcando{cursor:crosshair}
  .av-rot{position:absolute;left:8px;top:8px;z-index:3;background:rgba(15,23,42,.78);color:#fff;font-size:12px;padding:3px 8px;border-radius:6px;pointer-events:none}
  .av-tela{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
  .av-tela img,.av-tela canvas{display:block;user-select:none;-webkit-user-drag:none;pointer-events:none;box-shadow:0 2px 14px rgba(0,0,0,.18)}
  .av-topo{position:absolute;inset:0}
  .av-pino{position:absolute;width:26px;height:26px;margin:-26px 0 0 -13px;transform:scale(var(--inv,1));transform-origin:50% 100%;cursor:pointer;z-index:2}
  .av-pino b{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    background:var(--neg,#dc2626);color:#fff;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff}
  .av-pino b i{transform:rotate(45deg);font-style:normal}
  .av-pino.int b{background:#7c3aed}.av-pino.eq b{background:var(--primary,#2563eb)}.av-pino.ok b{background:#16a34a;opacity:.75}
  .av-pino.sel b{outline:3px solid #facc15}
  .av-cort{position:absolute;inset:0;overflow:hidden}
  .av-div{position:absolute;top:0;bottom:0;width:0;border-left:2px solid #facc15;z-index:4;cursor:ew-resize}
  .av-div::after{content:'⇔';position:absolute;top:50%;left:-15px;width:28px;height:28px;margin-top:-14px;border-radius:50%;background:#facc15;color:#111;
    display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 1px 6px rgba(0,0,0,.4)}
  .av-info{font-size:12px;color:var(--muted)}
  .av-dif{color:var(--neg,#dc2626);font-weight:600}
  @media (max-width:760px){ .av-palco.lado{grid-template-columns:1fr;grid-template-rows:1fr 1fr} .av-palco{height:var(--av-h-cel,56vh)} }`;
  document.head.appendChild(s);
}

function carregarImg(url) {
  return new Promise((ok, erro) => {
    const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async';
    i.onload = () => ok(i); i.onerror = () => erro(new Error('Não foi possível abrir a prévia da arte.')); i.src = url;
  });
}

/**
 * monta o visualizador em `el`.
 * opts: { a: {url, rotulo}, b?: {url, rotulo}, pinos: [{id, n, x, y, texto, classe}], podeMarcar, onMarcar(x, y), onPino(pino), modo }
 * devolve { pinos(lista), selecionar(id), modo(m), destruir() }
 */
export function viewer(el, opts = {}) {
  css();
  const st = { modo: opts.b ? (opts.modo || 'lado') : 'uma', marcar: false, k: 1, x: 0, y: 0, cortina: 0.5, pinos: opts.pinos || [], sel: null, imgA: null, imgB: null, dif: null };
  const modos = [['lado', 'Lado a lado'], ['cortina', 'Cortina'], ['diferenca', 'Diferença']];
  el.innerHTML = `<div class="av">
    <div class="av-bar"><div class="av-g">
        ${opts.b ? modos.map(([k, t]) => `<button class="btn small ghost" data-m="${k}">${t}</button>`).join('') : ''}
        ${opts.podeMarcar ? `<button class="btn small" data-acao="marcar" title="Clique na arte para marcar o ponto do comentário">📍 Marcar na arte</button>` : ''}
        <span class="av-info" data-info></span></div>
      <div class="av-g"><button class="btn small ghost" data-acao="menos" title="Diminuir">−</button><span class="av-zoom small" data-zoom>100%</span>
        <button class="btn small ghost" data-acao="mais" title="Aumentar">+</button><button class="btn small ghost" data-acao="ajustar">Ajustar</button>
        <button class="btn small ghost" data-acao="real" title="Tamanho real da prévia">1:1</button>
        <button class="btn small ghost" data-acao="tela" title="Tela cheia">⛶</button></div></div>
    <div class="av-palco" data-palco><div class="loading">Abrindo a arte…</div></div></div>`;
  const $ = (s) => el.querySelector(s), palco = $('[data-palco]');

  const vistas = () => [...palco.querySelectorAll('.av-vista')];
  function aplicar() {
    for (const t of palco.querySelectorAll('.av-tela')) {
      t.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.k})`;
      t.style.setProperty('--inv', String(1 / st.k));
    }
    $('[data-zoom]').textContent = Math.round(st.k * 100) + '%';
    if (st.modo === 'cortina') {
      const v = vistas()[0]; if (!v) return;
      const w = v.clientWidth, px = st.cortina * w;
      v.querySelector('.av-div').style.left = px + 'px';
      v.querySelector('.av-cort').style.clipPath = `inset(0 ${w - px}px 0 0)`;
    }
  }
  function ajustar() {
    const v = vistas()[0], img = st.imgA; if (!v || !img) return;
    const w = v.clientWidth, h = v.clientHeight, k = Math.min(w / img.naturalWidth, h / img.naturalHeight) * 0.96;
    st.k = k; st.x = (w - img.naturalWidth * k) / 2; st.y = (h - img.naturalHeight * k) / 2; aplicar();
  }
  function zoom(f, cx, cy) {
    const v = vistas()[0]; if (!v) return;
    cx ??= v.clientWidth / 2; cy ??= v.clientHeight / 2;
    const k = Math.min(12, Math.max(0.05, st.k * f));
    st.x = cx - (cx - st.x) * (k / st.k); st.y = cy - (cy - st.y) * (k / st.k); st.k = k; aplicar();
  }

  const pinosHtml = () => st.pinos.filter(p => p.x != null && p.y != null).map(p =>
    `<div class="av-pino ${p.classe || ''} ${st.sel === p.id ? 'sel' : ''}" data-pino="${p.id}" style="left:${p.x * 100}%;top:${p.y * 100}%" title="${esc(p.texto)}"><b><i>${p.n}</i></b></div>`).join('');

  function tela(img, rotulo, comPinos = true) {
    return `<div class="av-tela" style="width:${img.naturalWidth}px;height:${img.naturalHeight}px"><img src="${img.src}" width="${img.naturalWidth}" height="${img.naturalHeight}" alt="">
      ${comPinos ? `<div class="av-topo" data-topo>${pinosHtml()}</div>` : ''}</div>${rotulo ? `<span class="av-rot">${esc(rotulo)}</span>` : ''}`;
  }

  function diferenca() {
    if (st.dif) return st.dif;
    const A = st.imgA, B = st.imgB, w = A.naturalWidth, h = A.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(B, 0, 0, w, h); const pb = c.getImageData(0, 0, w, h);
    c.clearRect(0, 0, w, h); c.drawImage(A, 0, 0, w, h); const pa = c.getImageData(0, 0, w, h);
    const out = c.createImageData(w, h); let mud = 0;
    for (let i = 0; i < pa.data.length; i += 4) {
      const d = Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]);
      const g = 0.299 * pb.data[i] + 0.587 * pb.data[i + 1] + 0.114 * pb.data[i + 2], cl = 235 + g * 0.08;   // fundo: versão nova clareada
      if (d > 60) { mud++; out.data[i] = 230; out.data[i + 1] = 20; out.data[i + 2] = 40; out.data[i + 3] = 255; }
      else { out.data[i] = cl; out.data[i + 1] = cl; out.data[i + 2] = cl; out.data[i + 3] = 255; }
    }
    c.putImageData(out, 0, 0);
    st.dif = { url: cv.toDataURL('image/png'), pct: mud / (w * h) * 100 };
    return st.dif;
  }

  function pintar() {
    el.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === st.modo));
    palco.className = 'av-palco' + (st.modo === 'lado' ? ' lado' : '');
    const A = st.imgA, B = st.imgB, info = $('[data-info]');
    info.innerHTML = '';
    if (st.modo === 'uma' || !B) palco.innerHTML = `<div class="av-vista">${tela(A, opts.a?.rotulo)}</div>`;
    else if (st.modo === 'lado') palco.innerHTML = `<div class="av-vista">${tela(B, opts.b.rotulo, false)}</div><div class="av-vista">${tela(A, opts.a.rotulo)}</div>`;
    else if (st.modo === 'cortina') {
      palco.innerHTML = `<div class="av-vista">${tela(B, null, false)}<div class="av-cort">${tela(A, null)}</div><div class="av-div" data-div></div>
        <span class="av-rot">◀ ${esc(opts.a.rotulo)} | ${esc(opts.b.rotulo)} ▶</span></div>`;
    } else {
      let d = null;
      try { d = diferenca(); } catch { info.textContent = 'A diferença precisa das duas prévias do mesmo servidor.'; }
      const img = new Image(); img.src = d?.url || B.src; img.width = A.naturalWidth; img.height = A.naturalHeight;
      palco.innerHTML = `<div class="av-vista"><div class="av-tela" style="width:${A.naturalWidth}px;height:${A.naturalHeight}px"><img src="${img.src}" width="${A.naturalWidth}" height="${A.naturalHeight}" alt="">
        <div class="av-topo" data-topo>${pinosHtml()}</div></div><span class="av-rot">Em vermelho: o que mudou de ${esc(opts.b.rotulo)} para ${esc(opts.a.rotulo)}</span></div>`;
      if (d) info.innerHTML = d.pct < 0.005 ? 'Nenhuma diferença visível entre as versões.' : `<span class="av-dif">${d.pct < 0.1 ? d.pct.toFixed(3) : d.pct.toFixed(1)}%</span> da área mudou`;
      if (A.naturalWidth !== B.naturalWidth || A.naturalHeight !== B.naturalHeight) info.innerHTML += ' · as versões têm proporções diferentes';
    }
    for (const v of vistas()) ligar(v);
    aplicar();
  }

  // arrastar, roda, pinça, marcar pino, mover a cortina
  function ligar(v) {
    const ptrs = new Map(); let ini = null, moveu = false, pinca = null, div = false;
    v.classList.toggle('marcando', st.marcar);
    v.addEventListener('wheel', (e) => { e.preventDefault(); const r = v.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    v.addEventListener('pointerdown', (e) => {
      v.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e); moveu = false;
      div = !!e.target.closest('[data-div]');
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinca = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), k: st.k }; }
      ini = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y };
    });
    v.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e);
      const r = v.getBoundingClientRect();
      if (div) { st.cortina = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); aplicar(); return; }
      if (ptrs.size === 2 && pinca) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        zoom((pinca.k * d / pinca.d) / st.k, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top); moveu = true; return;
      }
      if (Math.abs(e.clientX - ini.x) + Math.abs(e.clientY - ini.y) > 4) { moveu = true; v.classList.add('arrastando'); }
      if (moveu) { st.x = ini.sx + e.clientX - ini.x; st.y = ini.sy + e.clientY - ini.y; aplicar(); }
    });
    const fim = (e) => {
      const era = ptrs.size; ptrs.delete(e.pointerId); v.classList.remove('arrastando');
      if (ptrs.size < 2) pinca = null;
      if (div || moveu || era > 1 || e.type === 'pointercancel') { if (!ptrs.size) div = false; return; }
      const pino = e.target.closest?.('[data-pino]') || document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pino]');
      if (pino) { const p = st.pinos.find(x => String(x.id) === pino.dataset.pino); if (p) { selecionar(p.id); opts.onPino?.(p); } return; }
      if (st.marcar && opts.onMarcar && v.querySelector('[data-topo]')) {
        const img = v.querySelector('.av-tela img').getBoundingClientRect();
        const x = (e.clientX - img.left) / img.width, y = (e.clientY - img.top) / img.height;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) opts.onMarcar(Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4);
      }
    };
    v.addEventListener('pointerup', fim); v.addEventListener('pointercancel', fim);
  }

  function selecionar(id) {
    st.sel = id;
    el.querySelectorAll('[data-pino]').forEach(p => p.classList.toggle('sel', p.dataset.pino === String(id)));
  }
  function centrar(id) {
    const p = st.pinos.find(x => x.id === id), v = vistas().at(-1); if (!p || p.x == null || !v) return;
    const k = Math.max(st.k, 0.6);
    st.k = k; st.x = v.clientWidth / 2 - p.x * st.imgA.naturalWidth * k; st.y = v.clientHeight / 2 - p.y * st.imgA.naturalHeight * k; aplicar(); selecionar(id);
  }

  el.querySelector('.av-bar').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.m) { st.modo = b.dataset.m; pintar(); return; }
    const a = b.dataset.acao;
    if (a === 'mais') zoom(1.25); else if (a === 'menos') zoom(0.8); else if (a === 'ajustar') ajustar();
    else if (a === 'real') { const v = vistas()[0]; st.k = 1; st.x = (v.clientWidth - st.imgA.naturalWidth) / 2; st.y = (v.clientHeight - st.imgA.naturalHeight) / 2; aplicar(); }
    else if (a === 'tela') { const av = el.querySelector('.av'); document.fullscreenElement ? document.exitFullscreen() : av.requestFullscreen?.().then(() => { av.style.background = 'var(--bg)'; av.style.padding = '12px'; palco.style.setProperty('--av-h', 'calc(100vh - 70px)'); setTimeout(ajustar, 120); }); }
    else if (a === 'marcar') { st.marcar = !st.marcar; b.classList.toggle('on', st.marcar); vistas().forEach(v => v.classList.toggle('marcando', st.marcar)); }
  };
  const sair = () => { if (!document.fullscreenElement) { const av = el.querySelector('.av'); if (av) { av.style.background = ''; av.style.padding = ''; } palco.style.removeProperty('--av-h'); setTimeout(ajustar, 60); } };
  document.addEventListener('fullscreenchange', sair);
  const ro = new ResizeObserver(() => ajustar());

  Promise.all([carregarImg(opts.a.url), opts.b ? carregarImg(opts.b.url) : null]).then(([a, b]) => {
    st.imgA = a; st.imgB = b; pintar(); ajustar(); ro.observe(palco); opts.onPronto?.();
  }).catch((err) => { palco.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });

  return {
    pinos(lista) { st.pinos = lista; el.querySelectorAll('[data-topo]').forEach(t => t.innerHTML = pinosHtml()); },
    selecionar, centrar,
    marcar(on) { st.marcar = on; el.querySelector('[data-acao=marcar]')?.classList.toggle('on', on); vistas().forEach(v => v.classList.toggle('marcando', on)); },
    modo(m) { st.modo = m; pintar(); },
    destruir() { ro.disconnect(); document.removeEventListener('fullscreenchange', sair); el.innerHTML = ''; },
  };
}

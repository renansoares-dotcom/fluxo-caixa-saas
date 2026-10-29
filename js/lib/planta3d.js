// Planta da fábrica em 3D (three.js): luz e sombra reais, câmera com zoom, arrastar e girar, etiquetas em HTML por cima da cena.
// Montada a partir do mesmo JSON do editor (prod_planta) e das máquinas/caminhões; a cada atualização só o conteúdo é refeito,
// a câmera fica onde o usuário deixou. Sem WebGL (ou sem acesso ao CDN) a tela volta ao desenho em SVG.
import { esc } from './ui.js';
import { TIPOS_VISUAIS, COR, COR_V, pegada, lugaresCaminhoes, geoCaminhao, textoVeiculo, textoMaquina, geometriaSeta, textoSeta } from './planta.js';

const URL_THREE = new URL('../../vendor/three-0.169.0.module.min.js', import.meta.url).href;
let T = null;
export async function carregarThree() {
  if (T) return T;
  const c = document.createElement('canvas');
  if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('sem WebGL');
  T = await import(URL_THREE); return T;
}

const BRANCO = '#f5f7fb', ACO = '#cdd5e1', MARINHO = '#34428a', AZUL = '#1590d6', ESCURO = '#3a4256', FILME = '#bfe3f7';
const TONS = ['#f7f0e2', '#e6f3ee', '#e8f0fb', '#f3edf8'];
const TXT = { prod: '#15803d', setup: '#b45309', parada: '#dc2626', livre: '#5d6790', imp: '#475569' };

export async function criarPlanta3D(container, opts = {}) {
  const THREE = await carregarThree();
  container.innerHTML = `<div class="p3-wrap"><canvas class="p3-cv"></canvas><div class="p3-lbl"></div>
    <div class="p3-ctl"><button data-z="in" title="Aproximar">+</button><button data-z="out" title="Afastar">−</button><button data-z="esq" title="Girar">⟲</button><button data-z="dir" title="Girar">⟳</button><button data-z="fit" title="Enquadrar tudo">⤢</button></div>
    <div class="p3-dica">Arraste para mover · roda do mouse ou + / − para zoom · ⟲ ⟳ para girar</div></div>`;
  const wrap = container.querySelector('.p3-wrap'), cv = wrap.querySelector('.p3-cv'), lbl = wrap.querySelector('.p3-lbl');
  const R = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  R.setPixelRatio(Math.min(2, devicePixelRatio || 1)); R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  R.toneMapping = THREE.NeutralToneMapping; R.outputColorSpace = THREE.SRGBColorSpace;
  const cena = new THREE.Scene(); cena.background = new THREE.Color('#eef1f6');
  cena.add(new THREE.HemisphereLight(0xffffff, 0xe3e8f0, 1.55));
  const sol = new THREE.DirectionalLight(0xffffff, 1.7); sol.castShadow = true; sol.shadow.mapSize.set(4096, 4096); sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.04; sol.shadow.radius = 4;
  cena.add(sol, sol.target);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  const st = { alvo: new THREE.Vector3(), ang: Math.PI / 4, zoom: 1, base: 50, L: 60, P: 30 };
  const bolha = new THREE.MeshStandardMaterial({ color: '#dff1ff', transparent: true, opacity: .55, roughness: .15 });
  const MC = {}, CACHE = new Set([bolha]); const mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!MC[k]) { MC[k] = new THREE.MeshStandardMaterial({ color: c, roughness: .82, metalness: 0, ...o }); CACHE.add(MC[k]); } return MC[k]; };
  let grupo = null, labels = [], alvosClique = [], sujo = true, vivo = true, piscam = [];

  function posCam() {
    const w = wrap.clientWidth || 800, h = wrap.clientHeight || 500, a = w / h, V = st.base / st.zoom;
    cam.left = -V * a; cam.right = V * a; cam.top = V; cam.bottom = -V; cam.updateProjectionMatrix();
    const d = 400; cam.position.set(st.alvo.x + Math.cos(st.ang) * d, d * .95, st.alvo.z + Math.sin(st.ang) * d); cam.lookAt(st.alvo);
    sujo = true;
  }
  function tamanho() { const w = wrap.clientWidth || 800, h = wrap.clientHeight || 500; R.setSize(w, h, false); posCam(); }
  const enquadrar = () => { st.alvo.set(st.L / 2, 0, st.P / 2); st.zoom = 1; const w = wrap.clientWidth || 800, h = wrap.clientHeight || 500;
    st.base = Math.max(st.P * .62, (st.L + st.P) * .5 * (h / w) * 1.05, 20); posCam(); };

  // ---- interação: arrastar (mover), roda/pinça (zoom), botões
  let arr = null, toques = new Map(), dist0 = 0, zoom0 = 1;
  const parafuso = (dx, dy) => { const V = st.base / st.zoom, h = wrap.clientHeight || 500, k = 2 * V / h;
    const dir = new THREE.Vector3(-Math.sin(st.ang), 0, Math.cos(st.ang)), fr = new THREE.Vector3(-Math.cos(st.ang), 0, -Math.sin(st.ang));
    st.alvo.addScaledVector(dir, dx * k).addScaledVector(fr, -dy * k / .7); posCam(); };
  cv.addEventListener('pointerdown', (e) => { toques.set(e.pointerId, [e.clientX, e.clientY]); cv.setPointerCapture(e.pointerId);
    if (toques.size === 2) { const [a, b] = [...toques.values()]; dist0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = st.zoom; arr = null; } else arr = { x: e.clientX, y: e.clientY, mov: 0 }; });
  cv.addEventListener('pointermove', (e) => { if (!toques.has(e.pointerId)) return; toques.set(e.pointerId, [e.clientX, e.clientY]);
    if (toques.size === 2) { const [a, b] = [...toques.values()]; st.zoom = Math.min(12, Math.max(.4, zoom0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / (dist0 || 1))); posCam(); return; }
    if (arr) { const dx = e.clientX - arr.x, dy = e.clientY - arr.y; arr.mov += Math.abs(dx) + Math.abs(dy); arr.x = e.clientX; arr.y = e.clientY; parafuso(-dx, -dy); } });
  const solta = (e) => { const clique = arr && arr.mov < 6; toques.delete(e.pointerId); if (clique) clicar(e); arr = null; };
  cv.addEventListener('pointerup', solta); cv.addEventListener('pointercancel', (e) => { toques.delete(e.pointerId); arr = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); st.zoom = Math.min(12, Math.max(.4, st.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); posCam(); }, { passive: false });
  wrap.querySelector('.p3-ctl').addEventListener('click', (e) => { const z = e.target.closest('[data-z]')?.dataset.z; if (!z) return;
    if (z === 'in') st.zoom = Math.min(12, st.zoom * 1.35); if (z === 'out') st.zoom = Math.max(.4, st.zoom / 1.35);
    if (z === 'esq') st.ang -= Math.PI / 4; if (z === 'dir') st.ang += Math.PI / 4; if (z === 'fit') { st.ang = Math.PI / 4; enquadrar(); return; } posCam(); });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function clicar(e) {
    const r = cv.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(alvosClique, true)[0]; if (!hit) return; let o = hit.object; while (o && !o.userData.sel) o = o.parent;
    if (o && opts.aoClicar) opts.aoClicar(o.userData.sel);
  }
  lbl.addEventListener('click', (e) => { const el = e.target.closest('[data-sel]'); if (el && opts.aoClicar) opts.aoClicar(el.dataset.sel); });
  const ro = new ResizeObserver(() => tamanho()); ro.observe(wrap);

  // ---- laço de desenho: só redesenha quando algo muda (e enquanto algo pisca)
  const proj = new THREE.Vector3(); let t0 = performance.now();
  function quadro(t) {
    if (!vivo) return;
    if (!container.isConnected) { destruir(); return; }
    if (piscam.length && t - t0 > 500) { t0 = t; piscam.forEach(m => { m.visible = !m.visible; }); sujo = true; }
    if (sujo) {
      R.render(cena, cam); sujo = false;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      // posiciona e esconde as etiquetas que ficariam por cima de outra mais importante (selecionada, parada, mais à frente)
      const vis = [];
      for (const l of labels) { proj.copy(l.p).project(cam); l.x = (proj.x + 1) / 2 * w; l.y = (1 - proj.y) / 2 * h; l.fora = l.x < 20 || l.x > w - 20 || l.y < 36 || l.y > h + 10; if (!l.fora) vis.push(l); }
      vis.sort((a, b) => (b.prio - a.prio) || (b.y - a.y));
      const usados = [];
      for (const l of labels) l.el.style.display = 'none';
      for (const l of vis) { l.lw ||= l.el.offsetWidth || 90; l.lh ||= l.el.offsetHeight || 36;
        const r = [l.x - l.lw / 2, l.y - l.lh, l.x + l.lw / 2, l.y];
        if (usados.some(u => r[0] < u[2] && r[2] > u[0] && r[1] < u[3] && r[3] > u[1])) continue;
        usados.push(r); l.el.style.display = ''; l.el.style.transform = `translate(${l.x.toFixed(0)}px,${l.y.toFixed(0)}px) translate(-50%,-100%)`; if (!l.lw0) { l.lw = l.el.offsetWidth || l.lw; l.lh = l.el.offsetHeight || l.lh; l.lw0 = 1; } }
    }
    requestAnimationFrame(quadro);
  }
  function destruir() { vivo = false; ro.disconnect(); limpar(); R.dispose(); }
  function limpar() {
    if (grupo) { grupo.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) for (const m of [].concat(o.material)) if (!CACHE.has(m)) { if (m.map?.isTexture) m.map.dispose(); m.dispose(); } }); cena.remove(grupo); }
    lbl.innerHTML = ''; labels = []; alvosClique = []; piscam = [];
  }

  // ---- construção da cena
  function montar(planta, maquinas, S, sel) {
    limpar(); grupo = new THREE.Group(); cena.add(grupo);
    const g = grupo, L = +planta.largura_m || 60, P = +planta.profundidade_m || 30, els = planta.elementos || [], porId = Object.fromEntries(els.map(e => [e.id, e]));
    const novoTamanho = st.L !== L || st.P !== P; st.L = L; st.P = P;
    sol.position.set(L / 2 - 25, 95, P / 2 + 55); sol.target.position.set(L / 2, 0, P / 2);
    const m = Math.max(L, P) * .75 + 20; Object.assign(sol.shadow.camera, { left: -m, right: m, top: m, bottom: -m, near: 1, far: 400 }); sol.shadow.camera.updateProjectionMatrix();
    const add = (geo, mt, x, y, z, sombra = true) => { const me = new THREE.Mesh(geo, mt); me.position.set(x, y, z); me.castShadow = sombra; me.receiveShadow = true; g.add(me); return me; };
    const M = (c, o) => typeof c === 'string' ? mat(c, o) : c;
    const box = (x, y, z, w, d, h, c, o, pai = g) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c, o)); me.position.set(x + w / 2, z + h / 2, y + d / 2); me.castShadow = me.receiveShadow = true; pai.add(me); return me; };
    const cil = (x, y, z, r, h, c, o, rt, pai = g) => { const me = new THREE.Mesh(new THREE.CylinderGeometry(rt ?? r, r, h, 24), M(c, o)); me.position.set(x, z + h / 2, y); me.castShadow = me.receiveShadow = true; pai.add(me); return me; };
    const cilH = (x, y, z, r, len, c, eixo = 'x', pai = g) => { const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 22), M(c)); me.position.set(x, z, y); if (eixo === 'x') me.rotation.z = Math.PI / 2; else me.rotation.x = Math.PI / 2; me.castShadow = me.receiveShadow = true; pai.add(me); return me; };
    const piso = (x, y, w, d, c, h = .02) => add(new THREE.BoxGeometry(w, .04, d), mat(c), x + w / 2, h, y + d / 2, false);
    const linha = (x1, y1, x2, y2, c, larg = .12, h = .06) => { const len = Math.hypot(x2 - x1, y2 - y1); const me = add(new THREE.BoxGeometry(len, .02, larg), mat(c), (x1 + x2) / 2, h, (y1 + y2) / 2, false); me.rotation.y = -Math.atan2(y2 - y1, x2 - x1); return me; };
    const contorno = (e, c, larg = .12) => { linha(e.x, e.y, e.x + e.w, e.y, c, larg); linha(e.x, e.y + e.d, e.x + e.w, e.y + e.d, c, larg); linha(e.x, e.y, e.x, e.y + e.d, c, larg); linha(e.x + e.w, e.y, e.x + e.w, e.y + e.d, c, larg); };
    const tracejado = (x1, y1, x2, y2, c, passo = 1.6, larg = .15) => { const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.floor(len / passo)); for (let i = 0; i < n; i += 2) { const a = i / n, b = Math.min(1, (i + 1) / n); linha(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b, c, larg); } };
    const noChao = (txt, x, y, alt, cor = '#6f7c9e', maxW = null) => {
      if (!txt) return; const c = document.createElement('canvas'), q = c.getContext('2d'), tam = 64; q.font = `800 ${tam}px Inter, Arial, sans-serif`;
      const tw = q.measureText(txt.toUpperCase()).width + 30; c.width = Math.ceil(tw); c.height = Math.ceil(tam * 1.5); const q2 = c.getContext('2d');
      q2.font = `800 ${tam}px Inter, Arial, sans-serif`; q2.fillStyle = cor; q2.textBaseline = 'middle'; q2.fillText(txt.toUpperCase(), 15, c.height / 2 + 2);
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
      let k = alt / c.height; if (maxW && c.width * k > maxW) k = maxW / c.width;
      const me = new THREE.Mesh(new THREE.PlaneGeometry(c.width * k, c.height * k), new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false })); me.userData.matProprio = true;
      me.rotation.x = -Math.PI / 2; me.position.set(x + c.width * k / 2, .09, y + c.height * k / 2); g.add(me); };
    const etiqueta = (sel, l1, l2, cor, txtCor, x, y, z, ativo) => {
      const el = document.createElement('div'); el.className = 'p3-tag' + (ativo ? ' on' : ''); el.dataset.sel = sel; el.style.borderColor = cor;
      el.innerHTML = `<b>${esc(l1)}</b><span style="background:${cor}">${esc(l2)}</span>`; lbl.appendChild(el); labels.push({ el, p: new THREE.Vector3(x, z, y), prio: ativo ? 3 : (cor === COR.parada ? 2 : 1) }); };

    // terreno e pisos
    piso(-8, -8, L + 16, P + 16, '#eaeef4', -0.03);
    piso(0, 0, L, P, '#f3f5f9', .005);
    let ti = 0;
    for (const e of els) {
      if (e.t === 'patio') piso(e.x, e.y, e.w, e.d, '#d5dae3', .015);
      if (e.t === 'rua') { piso(e.x, e.y, e.w, e.d, '#9aa3b5', .02); if (e.w >= e.d) tracejado(e.x + 1, e.y + e.d / 2, e.x + e.w - 1, e.y + e.d / 2, '#ffffff', 2.2, .18); else tracejado(e.x + e.w / 2, e.y + 1, e.x + e.w / 2, e.y + e.d - 1, '#ffffff', 2.2, .18); }
      if (e.t === 'setor' || e.t === 'area') piso(e.x, e.y, e.w, e.d, TONS[ti++ % TONS.length], .025);
      if (e.t === 'corredor') { piso(e.x, e.y, e.w, e.d, '#eef1f6', .03); contorno(e, '#f2c94c'); }
      if (e.t === 'doca') { contorno(e, '#f2c94c', .18); noChao(e.nome, e.x + .4, e.y + e.d - 1.1, .8, '#c99a1a', e.w - .8); }
      if (e.t === 'vaga') { contorno(e, '#ffffff', .16); noChao(e.nome, e.x + .3, e.y + e.d - 1, .7, '#ffffff', e.w - .5); }
      if (e.t === 'portao') { box(e.x - .2, e.y, 0, Math.max(.5, e.w) + .2, .3, 2.4, MARINHO); box(e.x - .2, e.y + e.d - .3, 0, Math.max(.5, e.w) + .2, .3, 2.4, MARINHO); box(e.x, e.y + .3, 1, Math.max(.25, e.w * .5), e.d - .6, .12, '#f2c94c'); }
    }
    for (const e of els) if (e.t === 'setor' || e.t === 'area') noChao(e.nome, e.x + .6, e.y + e.d - 2.1, 1.5, '#6f7c9e', e.w - 1);
    // objetos fixos
    for (const e of els) {
      if (e.t === 'parede') { const h = +e.altura || 3; box(e.x, e.y, 0, e.w, e.d, h, BRANCO); if (h >= 2) box(e.x - .02, e.y - .02, h, e.w + .04, e.d + .04, .12, '#2b5598'); }
      if (e.t === 'guarita') { box(e.x, e.y, 0, e.w, e.d, 2.6, BRANCO); box(e.x - .2, e.y - .2, 2.6, e.w + .4, e.d + .4, .25, MARINHO); box(e.x + e.w, e.y + e.d * .25, 1.1, .05, e.d * .5, .9, AZUL, { roughness: .2 }); }
      if (e.t === 'arvore') arvore(e.x + e.w / 2, e.y + e.d / 2, Math.max(.6, Math.min(e.w, e.d) / 2.6));
      if (e.t === 'telao') telao(e, S);
      if (e.t === 'area') decorArea(e);
    }
    // sem árvores desenhadas: um contorno de árvores em volta do terreno (só enfeite)
    if (!els.some(e => e.t === 'arvore')) { for (let x = 4; x < L; x += 9) { arvore(x, -4.5, .9 + (x % 3) * .08); arvore(x + 3, P + 4.5, .95); } for (let y = 4; y < P; y += 9) { arvore(-4.5, y, .9 + (y % 3) * .08); arvore(L + 4.5, y + 3, .95); } }
    // setas de fluxo e material entre etapas
    for (const e of els.filter(x => x.t === 'seta')) {
      const gm = geometriaSeta(e, porId); if (!gm) continue; const tx = textoSeta(e, porId, S);
      tracejado(gm.a[0], gm.a[1], gm.b[0], gm.b[1], '#2b5598', 1.2, .28);
      const ang = Math.atan2(gm.u[1], gm.u[0]), seta = new THREE.Group(), cab = new THREE.Mesh(new THREE.ConeGeometry(.6, 1.4, 16), mat('#2b5598')); cab.rotation.z = -Math.PI / 2; seta.add(cab); seta.position.set(gm.b[0], .3, gm.b[1]); seta.rotation.y = -ang; g.add(seta);
      const mx = (gm.a[0] + gm.b[0]) / 2, my = (gm.a[1] + gm.b[1]) / 2;
      if (tx?.n) { const n = Math.min(9, tx.n), px = mx - gm.u[1] * 1.4 - .65, py = my + gm.u[0] * 1.4 - .55; box(px, py, 0, 1.3, 1.1, .15, '#c89a5e'); for (let i = 0; i < n; i++) cilH(px + .25 + (i % 3) * .4, py + .55, .34 + Math.floor(i / 3) * .36, .18, 1, FILME, 'z'); }
      if (tx) { const el = document.createElement('div'); el.className = 'p3-fluxo'; el.innerHTML = `<b>${esc(tx.l1)}</b><span>${esc(tx.l2)}</span>`; lbl.appendChild(el); labels.push({ el, p: new THREE.Vector3(mx, 2.2, my), prio: 0 }); }
    }
    // máquinas
    for (const mq of maquinas) if (mq.pos_x != null && mq.pos_y != null) maquina(mq);
    // caminhões
    for (const x of lugaresCaminhoes(els, S?.frota)) { const gc = geoCaminhao(x); if (gc) caminhao(x, gc); }

    function local(X, Y, rot) { // desenho no sistema da máquina (giro 90 = transposto, como no 2D)
      const G = new THREE.Group(); g.add(G);
      return { G, B: (a, b, z, w, d, h, c, o) => rot ? box(X + b, Y + a, z, d, w, h, c, o, G) : box(X + a, Y + b, z, w, d, h, c, o, G),
        C: (a, b, z, r, h, c, o, rt) => rot ? cil(X + b, Y + a, z, r, h, c, o, rt, G) : cil(X + a, Y + b, z, r, h, c, o, rt, G),
        H: (a, b, z, r, len, c, eixo) => rot ? cilH(X + b, Y + a, z, r, len, c, eixo === 'x' ? 'z' : 'x', G) : cilH(X + a, Y + b, z, r, len, c, eixo, G),
        pt: (a, b) => rot ? [X + b, Y + a] : [X + a, Y + b] };
    }
    function maquina(mq) {
      const s = S?.maq?.[mq.id]?.st || 'livre', X = +mq.pos_x, Y = +mq.pos_y, rot = +mq.rotacao === 90, Tv = TIPOS_VISUAIS[mq.tipo_visual] || TIPOS_VISUAIS.generica, pg = pegada(mq);
      const { G, B, C, H, pt } = local(X, Y, rot); G.userData.sel = 'm:' + mq.id; alvosClique.push(G);
      const halo = add(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: COR[s], transparent: true, opacity: s === 'livre' || s === 'imp' ? .12 : .26, depthWrite: false }), X + pg.w / 2, .07, Y + pg.d / 2, false);
      halo.userData.matProprio = true; halo.rotation.x = -Math.PI / 2; halo.scale.set(pg.w / 2 + .9, pg.d / 2 + .9, 1);
      let topo;
      switch (mq.tipo_visual) {
        case 'extrusora': {
          B(0, 1, 0, 2.6, 1, 1.05, BRANCO); H(1.45, 1.5, 1.45, .33, 2.5, ACO, 'x'); C(.8, 1.5, 1.75, .18, 1, AZUL, {}, .62);
          for (const [a, b] of [[2.2, .7], [3.66, .7], [2.2, 2.16], [3.66, 2.16]]) B(a, b, 0, .14, .14, 8.1, ACO);
          C(3, 1.5, 0, .48, 1.85, BRANCO); C(3, 1.5, 1.85, .36, 1.1, bolha, null, .72); C(3, 1.5, 2.95, .72, 3.4, bolha); C(3, 1.5, 6.35, .72, 1.2, bolha, null, .08);
          B(2.2, .7, 4.2, 1.6, 1.6, .1, ACO); B(2.1, .6, 7.9, 1.8, 1.8, .38, MARINHO); H(3, 1.5, 7.55, .18, 1.6, ESCURO, 'z');
          B(4.4, .6, 0, 1.4, 1.8, 1.25, BRANCO); H(5.1, 1.5, 1.7, .46, 1.7, FILME, 'z'); topo = [3, 1.5, 8.28]; break; }
        case 'impressora': {
          B(0, .3, 0, .8, 1.6, 1.5, BRANCO); H(.4, 1.1, 1.85, .55, 1.8, FILME, 'z'); B(1.2, .2, 0, 2.8, .2, 2.7, BRANCO);
          H(2.6, 1.15, 1.5, .92, 1.4, MARINHO, 'z'); for (const [a, z] of [[1.45, 2.25], [1.45, .95], [3.75, 2.25], [3.75, .95]]) H(a, 1.15, z, .22, 1.4, AZUL, 'z');
          B(1.8, .4, 2.55, 1.6, 1.4, .5, AZUL); B(1.2, 1.85, 0, 2.8, .2, 2.7, BRANCO); B(4.4, .3, 0, .8, 1.6, 1.5, BRANCO); H(4.8, 1.1, 1.85, .42, 1.8, FILME, 'z'); topo = [2.6, 1.1, 3.05]; break; }
        case 'corte_solda': {
          B(0, .2, 0, .8, 1.2, 1, BRANCO); H(.4, .8, 1.35, .45, 1.4, FILME, 'z'); B(.9, .2, 0, 3.2, 1.2, .9, BRANCO); B(.9, .25, .9, 3.2, 1.1, .04, ESCURO); B(2.6, .1, .9, .6, 1.4, .7, AZUL);
          B(4.1, .3, 0, 1.2, 1, .6, BRANCO); [0, 1, 2].forEach(i => B(4.3, .45, .6 + i * .12, .8, .7, .1, FILME)); topo = [2.9, .8, 1.6]; break; }
        case 'rebobinadeira': {
          B(0, .2, 0, .9, 1.4, 1.1, BRANCO); H(.45, .9, 1.5, .5, 1.6, FILME, 'z'); B(1.1, .3, 0, 1, 1.2, 1.4, BRANCO); B(1.1, .3, 1.4, 1, 1.2, .08, ESCURO);
          B(2.3, .2, 0, .9, 1.4, 1.1, BRANCO); H(2.75, .9, 1.5, .38, 1.6, FILME, 'z'); topo = [1.6, .9, 1.5]; break; }
        case 'aglutinador': {
          B(0, 0, 0, 2.2, 2, .5, MARINHO); C(1.1, 1, .5, .8, 1.5, BRANCO); C(1.1, 1, 2, .8, .5, AZUL, {}, .3); B(1.6, 1.3, .5, .6, .6, .8, '#3f63c6'); topo = [1.1, 1, 2.5]; break; }
        default: { B(0, 0, 0, 2.4, 1.6, 1.3, BRANCO); B(.3, 1.6, .5, .8, .02, .5, ESCURO); B(0, 0, 1.3, 2.4, 1.6, .08, AZUL); topo = [1.2, .8, 1.38]; }
      }
      // sinaleiro
      const [tx, ty] = pt(topo[0], topo[1]);
      box(tx - .05, ty - .05, topo[2], .1, .1, 1.1, ACO, null, G);
      [['parada', topo[2] + .97], ['setup', topo[2] + .72], ['prod', topo[2] + .47]].forEach(([k, z]) => { const on = k === s;
        const me = cil(tx, ty, z, .13, .22, on ? COR[k] : '#59627a', on ? { emissive: COR[k], emissiveIntensity: 1.6 } : {}, null, G); if (on && k === 'parada') piscam.push(me); });
      // operador
      const xs = S?.maq?.[mq.id]; if (xs?.operador && s !== 'livre') { const [ox, oy] = pt(Tv.w * .55, Tv.d + .5); pessoa(ox, oy); }
      etiqueta('m:' + mq.id, mq.codigo, textoMaquina(mq, S) || 'Livre', COR[s], TXT[s], tx, ty, topo[2] + 1.6, sel === 'm:' + mq.id);
    }
    function pessoa(x, y, camisa = '#3f63c6') { box(x, y, 0, .16, .16, .78, '#2f3a5c'); box(x + .22, y, 0, .16, .16, .78, '#2f3a5c'); box(x - .03, y - .06, .78, .44, .3, .66, camisa);
      add(new THREE.SphereGeometry(.19, 16, 12), mat('#f1c7a0'), x + .19, 1.65, y + .09); add(new THREE.SphereGeometry(.21, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#ffd34d'), x + .19, 1.7, y + .09); }
    function arvore(x, y, s = 1) { cil(x, y, 0, .18 * s, 1.4 * s, '#8a6a4f'); add(new THREE.IcosahedronGeometry(1.25 * s, 1), mat('#8fcf9b', { flatShading: true }), x, 2.4 * s, y); }
    function palete(x, y, h = 1.1, c = '#e8b36a') { box(x, y, 0, 1.3, 1.1, .15, '#c89a5e'); box(x + .08, y + .06, .15, 1.14, .98, h, c); }
    function decorArea(e) {
      if (e.tipo === 'estoque') { const nx = Math.max(1, Math.floor((e.w - .6) / 2.6)), ny = Math.max(1, Math.floor((e.d - 2.6) / 2.6)); for (let i = 0; i < nx; i++) for (let j = 0; j < Math.min(ny, 8); j++) { box(e.x + .6 + i * 2.6, e.y + .6 + j * 2.6, 0, 1.9, 1.9, 1.6, '#fbfcfe'); box(e.x + .6 + i * 2.6, e.y + .6 + j * 2.6, 1.6, 1.9, 1.9, .06, AZUL); } }
      else if (e.tipo === 'paletes' || e.tipo === 'expedicao') { const nx = Math.max(1, Math.floor((e.w - .6) / 3.2)), ny = Math.max(1, Math.floor((e.d - 2.6) / 3.2)); for (let i = 0; i < nx; i++) for (let j = 0; j < Math.min(ny, 8); j++) if ((i + j) % 3 !== 2) palete(e.x + .8 + i * 3.2, e.y + .8 + j * 3.2, .7 + ((i * 7 + j) % 3) * .35, (i + j) % 2 ? '#e8b36a' : '#dfe8f5'); }
    }
    function telao(e, S) {
      const K = S?.kpi, F = S?.frota, logi = e.tipo === 'logistica';
      const linhas = logi ? ['LOGÍSTICA — HOJE', ['Cargas', F ? `${F.cargasHoje} · ${(F.kgHoje / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t` : '–'], ['Em rota', F ? String(F.cargas.filter(c => c.status === 'em_rota').length) : '–', '#a78bfa'],
          ['Carregando', F ? String(F.cargas.filter(c => c.status === 'carregando').length) : '–'], ['Prontas', F ? String(F.cargas.filter(c => c.status === 'pronta').length) : '–', '#4ade80']]
        : ['PRODUÇÃO — HOJE', ['Kg bons', K ? Math.round(K.kgDia).toLocaleString('pt-BR') : '–'], ['Produzindo', K ? `${K.produzindo} de ${K.total}` : '–', '#4ade80'], ['Paradas agora', K ? String(K.paradas) : '–', '#f87171'], ['Apara', K?.apara != null ? (K.apara * 100).toFixed(1).replace('.', ',') + '%' : '–']];
      const c = document.createElement('canvas'); c.width = 800; c.height = 460; const q = c.getContext('2d');
      q.fillStyle = '#1b2240'; q.fillRect(0, 0, 800, 460); q.fillStyle = '#6ea8ec'; q.font = '700 36px Inter, Arial'; q.fillText(linhas[0], 34, 62);
      linhas.slice(1).forEach(([t, v, cor], i) => { const yy = 128 + i * 82; q.fillStyle = '#2a3460'; q.fillRect(30, yy - 46, 740, 68); q.fillStyle = '#c8d3f0'; q.font = '500 32px Inter, Arial'; q.fillText(t, 50, yy); q.fillStyle = cor || '#fff'; q.font = '800 40px Inter, Arial'; q.textAlign = 'right'; q.fillText(v, 750, yy); q.textAlign = 'left'; });
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
      const W = Math.max(2.5, Math.max(e.w, e.d)), Hh = W * .575, G = new THREE.Group();
      const tela = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, .15), [mat(ESCURO), mat(ESCURO), mat(ESCURO), mat(ESCURO), new THREE.MeshBasicMaterial({ map: tx }), mat(ESCURO)]);
      tela.userData.matProprio = false; tela.position.y = 2.2 + Hh / 2; tela.castShadow = true; G.add(tela);
      for (const dx of [-W * .3, W * .3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(.12, 2.3, .12), mat(ACO)); p.position.set(dx, 1.15, -.05); p.castShadow = true; G.add(p); }
      G.position.set(e.x + e.w / 2, 0, e.y + e.d / 2); G.rotation.y = e.w >= e.d ? 0 : -Math.PI / 2; G.rotation.y += Math.PI / 4 * (e.giro || 0); g.add(G);
    }
    function caminhao(x, gc) {
      const cab = { carr: '#2563eb', pronto: '#16a34a', rota: '#7c3aed', plan: '#0ea5e9', garagem: '#3f63c6', manut: '#ef4444' }[x.est] || '#3f63c6';
      const G = new THREE.Group(); G.userData.sel = 'v:' + x.v.id; alvosClique.push(G);
      const Lc = gc.L, w = gc.w;
      const b = (a, bb, z, ww, dd, h, c, o) => { const me = new THREE.Mesh(new THREE.BoxGeometry(ww, h, dd), mat(c, o)); me.position.set(a + ww / 2, z + h / 2, bb + dd / 2); me.castShadow = me.receiveShadow = true; G.add(me); };
      b(0, 0, .5, Lc - 1.9, w, .25, ESCURO); b(0, 0, .75, Lc - 2.1, w, 2.6, '#fbfcfe'); b(Lc - 1.9, 0, .5, 1.9, w, 2.05, cab); b(Lc - .05, .2, 1.5, .06, w - .4, .78, '#9fd3f5', { roughness: .15 });
      for (const a of [.9, 2.1, Lc - 1]) for (const bb of [-.02, w - .18]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(.44, .44, .2, 18), mat('#252a36')); r.rotation.x = Math.PI / 2; r.position.set(a, .44, bb + .1); r.castShadow = true; G.add(r); }
      if (gc.aoX) G.position.set(gc.X, 0, gc.Y); else { G.rotation.y = -Math.PI / 2; G.position.set(gc.X + w, 0, gc.Y); }
      g.add(G);
      const cx = gc.aoX ? gc.X + (Lc - 2) / 2 : gc.X + w / 2, cy = gc.aoX ? gc.Y + w / 2 : gc.Y + (Lc - 2) / 2;
      etiqueta('v:' + x.v.id, x.v.codigo, textoVeiculo(x), COR_V[x.est], COR_V[x.est], cx, cy, 4.4, sel === 'v:' + x.v.id);
    }
    if (novoTamanho || !st.ok) { st.ok = true; enquadrar(); }
    sujo = true;
  }

  tamanho(); requestAnimationFrame(quadro);
  return { montar, destruir, enquadrar, redesenhar: () => { sujo = true; } };
}

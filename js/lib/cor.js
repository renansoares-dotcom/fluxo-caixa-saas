// Cor (melhoria 4.4): conversões sRGB ↔ CIELAB (D65), diferença de cor ΔE2000 e a simulação da arte com as tintas reais
// da Casa de Tintas (prova de cor na tela). Só regras puras.

export const hexToRgb = (h) => { const x = String(h || '').replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(x)) return null; return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16)); };
export const rgbToHex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const XN = 95.047, YN = 100, ZN = 108.883;
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fi = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

/** [r, g, b] 0–255 → [L, a, b] */
export function rgbToLab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) * 100, Y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) * 100, Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) * 100;
  const fx = f(X / XN), fy = f(Y / YN), fz = f(Z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** [L, a, b] → [r, g, b] 0–255 (fora da gama: recortado) */
export function labToRgb([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = XN * fi(fx) / 100, Y = YN * fi(fy) / 100, Z = ZN * fi(fz) / 100;
  const R = X * 3.2404542 - Y * 1.5371385 - Z * 0.4985314, G = -X * 0.969266 + Y * 1.8760108 + Z * 0.041556, B = X * 0.0556434 - Y * 0.2040259 + Z * 1.0572252;
  return [R, G, B].map(c => Math.max(0, Math.min(255, Math.round(gam(Math.max(0, Math.min(1, c)))))));
}
export const de76 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** ΔE2000 (CIE 2000, kL = kC = kH = 1) */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { if (b === 0 && a === 0) return 0; const x = Math.atan2(b, a) / rad; return x < 0 ? x + 360 : x; };
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0; if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
  const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p; if (C1p * C2p !== 0) { hm = Math.abs(h1p - h2p) <= 180 ? hm / 2 : (h1p + h2p < 360 ? (hm + 360) / 2 : (hm - 360) / 2); }
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTh = 30 * Math.exp(-(((hm - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T, Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** leitura do ΔE00 para a gráfica */
export function classificaDE(de, { ok = 2, atencao = 3.5 } = {}) {
  if (de == null) return { cls: '', txt: 'sem medida' };
  return de <= 1 ? { cls: 'pos', txt: 'imperceptível' } : de <= ok ? { cls: 'pos', txt: 'aceitável' } : de <= atencao ? { cls: 'warn', txt: 'perceptível' } : { cls: 'neg', txt: 'fora do padrão' };
}

/** pares de cor da prova: a cor especificada na arte (hex) e a tinta real (Lab medido ou hex da Casa de Tintas) */
export function paresProva(cores = [], tintas = {}) {
  return cores.map(c => {
    const t = c.tin_cor_id ? tintas[c.tin_cor_id] : null, spec = hexToRgb(c.hex);
    const real = t ? (t.lab_l != null && t.lab_a != null && t.lab_b != null ? [+t.lab_l, +t.lab_a, +t.lab_b] : hexToRgb(t.hex) && rgbToLab(hexToRgb(t.hex))) : null;
    const de = spec && real ? deltaE2000(rgbToLab(spec), real) : null;
    return { nome: c.nome || c.pantone || '', pantone: c.pantone || '', hex: c.hex || null, tinta: t ? `${t.codigo} · ${t.nome}` : null, medido: !!(t && t.lab_l != null),
      de: de == null ? null : Math.round(de * 100) / 100, de_lab: spec ? rgbToLab(spec) : null, para_lab: real, para_hex: real ? rgbToHex(labToRgb(real)) : null };
  });
}

/** recolore um pixel: perto (ΔE76 < tol) de uma cor da arte, desloca pela diferença até a tinta real, com transição suave */
export function recolorFactory(pares, tol = 22) {
  const P = pares.filter(p => p.de_lab && p.para_lab).map(p => ({ de: p.de_lab, d: [p.para_lab[0] - p.de_lab[0], p.para_lab[1] - p.de_lab[1], p.para_lab[2] - p.de_lab[2]] }));
  const cache = new Map();
  return (r, g, b) => {
    const k = (r << 16) | (g << 8) | b, c = cache.get(k); if (c) return c;
    let out = [r, g, b];
    if (P.length) {
      const lab = rgbToLab([r, g, b]); let best = null, dm = Infinity;
      for (const p of P) { const d = de76(lab, p.de); if (d < dm) { dm = d; best = p; } }
      if (dm < tol) { const w = 1 - dm / tol; out = labToRgb([lab[0] + w * best.d[0], lab[1] + w * best.d[1], lab[2] + w * best.d[2]]); }
    }
    cache.set(k, out); return out;
  };
}

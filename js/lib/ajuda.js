// Ajuda na tela (melhoria 10.5): acha no manual o trecho da tela aberta, monta os passos do tour e lê o link do vídeo.

const N = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** cabeçalhos (## e ###) do corpo do manual: [{nivel, texto, linha}] */
export function secoes(corpo) {
  const L = String(corpo || '').split('\n'), out = [];
  L.forEach((l, i) => { const m = /^(#{2,3})\s+(.+?)\s*$/.exec(l); if (m) out.push({ nivel: m[1].length, texto: m[2], linha: i }); });
  return out;
}

/** trecho de uma seção: do cabeçalho até o próximo de nível igual ou maior */
export function trecho(corpo, sec) {
  const L = String(corpo || '').split('\n'), S = secoes(corpo), i = S.findIndex(s => s.linha === sec.linha);
  const fim = S.slice(i + 1).find(s => s.nivel <= sec.nivel)?.linha ?? L.length;
  return L.slice(sec.linha, fim).join('\n').trim();
}

/**
 * a seção da tela: 1) a indicada no catálogo (prefixo, ex.: "## 6." ou "### 6.5"); 2) a que tem o nome da tela no título
 * (a mais específica: ### antes de ##); 3) a que cita o código da tela; 4) "Para que serve" (a primeira).
 */
export function secaoDaTela(corpo, { titulo = '', codigo = '', prefixo = null } = {}) {
  const S = secoes(corpo).filter(s => !/hist[oó]rico de altera/i.test(s.texto));
  if (!S.length) return null;
  if (prefixo) { const p = S.find(s => (('#'.repeat(s.nivel) + ' ' + s.texto).startsWith(prefixo))); if (p) return p; }
  const t = N(titulo);
  if (t) {
    const igual = S.find(s => N(s.texto).replace(/^[0-9 ]+/, '') === t);
    if (igual) return igual;
    const cand = S.filter(s => N(s.texto).includes(t));
    if (cand.length) return cand.sort((a, b) => b.nivel - a.nivel || a.linha - b.linha)[0];
    // todas as palavras de 4+ letras do título no cabeçalho
    const pal = t.split(' ').filter(w => w.length >= 4);
    if (pal.length) { const c2 = S.filter(s => pal.every(w => N(s.texto).includes(w))); if (c2.length) return c2[0]; }
  }
  if (codigo) { const L = String(corpo).split('\n'); const i = L.findIndex(l => l.includes(codigo)); if (i >= 0) { const s = [...S].reverse().find(x => x.linha <= i); if (s) return s; } }
  return S[0];
}

/** passos do tour: os que têm o elemento na tela (visível) */
export function passosVisiveis(passos, achar) {
  return passos.filter(p => { const el = achar(p.alvo); return !!el && !el.hidden && el.offsetParent !== null; });
}

/** link de vídeo para incorporar: YouTube (watch, youtu.be, shorts) e Google Drive (file/d/…); senão abre em nova aba */
export function videoEmbed(url) {
  const u = String(url || '').trim();
  let m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(u);
  if (m) return { tipo: 'youtube', src: `https://www.youtube-nocookie.com/embed/${m[1]}` };
  m = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(u);
  if (m) return { tipo: 'drive', src: `https://drive.google.com/file/d/${m[1]}/preview` };
  return /^https:\/\//.test(u) ? { tipo: 'link', src: u } : null;
}

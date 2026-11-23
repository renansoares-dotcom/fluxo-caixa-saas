// Fluxograma gerado das etapas do processo (SQL 196, 23/11/2026; Renan escolheu "gerado das etapas": cadastra as etapas e a
// plataforma desenha as raias e as setas, sempre igual ao texto). Funções puras: servem à tela, ao PDF e aos testes.
// Leiaute vertical (cabe na folha A4 em pé e no celular): uma coluna (raia) por responsável, na ordem em que aparece; uma linha
// por etapa, de cima para baixo. A seta para a etapa seguinte desce; as que pulam ou voltam correm pelos corredores laterais
// (o "não" e o "vai para" pela direita, o "sim" que pula pela esquerda), então nenhuma seta passa por cima de uma caixa.

export const TIPOS_ETAPA = { inicio: 'Início', atividade: 'Atividade', decisao: 'Decisão', fim: 'Fim' };

/** raias: os responsáveis na ordem em que aparecem (a grafia exata vale: "Compras" e "compras" são a mesma raia) */
export function raias(etapas) {
  const vistos = new Map();
  for (const e of etapas || []) { const r = String(e.responsavel || '').trim(); if (r && !vistos.has(r.toLowerCase())) vistos.set(r.toLowerCase(), r); }
  return [...vistos.values()];
}
const raiaDe = (L, e) => Math.max(0, L.findIndex(r => r.toLowerCase() === String(e.responsavel || '').trim().toLowerCase()));

/** as setas do processo: [{ de, para, tipo: 'seguinte' | 'vai' | 'sim' | 'nao' }] (números de etapa, de 1 a N) */
export function setas(etapas) {
  const N = (etapas || []).length, S = [];
  (etapas || []).forEach((e, i) => {
    const n = i + 1, num = (v) => (v == null || v === '' ? null : +v);
    if (e.tipo === 'fim') return;
    if (e.tipo === 'decisao') {
      const sim = num(e.sim) ?? (n < N ? n + 1 : null), nao = num(e.nao);
      if (sim) S.push({ de: n, para: sim, tipo: 'sim' });
      if (nao) S.push({ de: n, para: nao, tipo: 'nao' });
      return;
    }
    const ir = num(e.ir);
    if (ir) S.push({ de: n, para: ir, tipo: 'vai' }); else if (n < N) S.push({ de: n, para: n + 1, tipo: 'seguinte' });
  });
  return S;
}

/** confere as etapas como o banco confere (mensagens iguais) e devolve também avisos que não impedem salvar */
export function conferir(etapas) {
  const E = etapas || [], N = E.length, erros = [], avisos = [];
  if (N > 60) erros.push('No máximo 60 etapas por processo. Divida em subprocessos.');
  E.forEach((e, i) => {
    const k = i + 1, num = (v) => (v == null || v === '' ? null : +v);
    if (!TIPOS_ETAPA[e.tipo]) erros.push(`Etapa ${k}: escolha o tipo.`);
    const o = String(e.o_que || '').trim();
    if (o.length < 2) erros.push(`Etapa ${k}: descreva o que é feito.`); else if (o.length > 160) erros.push(`Etapa ${k}: descrição longa demais (até 160 letras; detalhe no POP).`);
    if (!String(e.responsavel || '').trim()) erros.push(`Etapa ${k}: informe o responsável (setor ou função).`);
    if (e.tipo === 'decisao') {
      const nao = num(e.nao), sim = num(e.sim);
      if (!nao) erros.push(`Etapa ${k} (decisão): informe para qual etapa vai no "não".`);
      else if (nao < 1 || nao > N || nao === k) erros.push(`Etapa ${k} (decisão): o "não" precisa ir para outra etapa do processo (1 a ${N}).`);
      if (sim && (sim < 1 || sim > N || sim === k)) erros.push(`Etapa ${k} (decisão): o "sim" precisa ir para outra etapa (1 a ${N}).`);
      if (!sim && k === N) erros.push(`Etapa ${k} (decisão) é a última: informe para onde vai no "sim".`);
    } else if (e.tipo !== 'fim' && num(e.ir) && (num(e.ir) < 1 || num(e.ir) > N || num(e.ir) === k)) erros.push(`Etapa ${k}: "vai para" precisa ser outra etapa do processo (1 a ${N}).`);
  });
  if (erros.length || !N) return { erros, avisos };
  if (E[0].tipo !== 'inicio') avisos.push('O processo não começa por uma etapa de início.');
  if (!E.some(e => e.tipo === 'fim')) avisos.push('O processo não tem etapa de fim.');
  // etapas que ninguém alcança a partir da primeira
  const S = setas(E), vis = new Set([1]), fila = [1];
  while (fila.length) { const a = fila.shift(); for (const s of S) if (s.de === a && !vis.has(s.para)) { vis.add(s.para); fila.push(s.para); } }
  const soltas = E.map((_, i) => i + 1).filter(n => !vis.has(n));
  if (soltas.length) avisos.push(`Nenhuma seta chega ${soltas.length > 1 ? 'às etapas' : 'à etapa'} ${soltas.join(', ')}.`);
  return { erros, avisos };
}

// quebra o texto em linhas de até `max` letras, no máximo `linhas` linhas (a última com reticências)
export function quebrar(txt, max = 22, linhas = 3) {
  const P = String(txt || '').trim().split(/\s+/).filter(Boolean), L = [];
  let cur = '';
  for (const p of P) {
    if (!cur) cur = p; else if ((cur + ' ' + p).length <= max) cur += ' ' + p; else { L.push(cur); cur = p; }
  }
  if (cur) L.push(cur);
  if (L.length > linhas) { const r = L.slice(0, linhas); r[linhas - 1] = r[linhas - 1].slice(0, max - 1).replace(/\s+\S*$/, '') + '…'; return r; }
  return L.map(l => (l.length > max ? l.slice(0, max - 1) + '…' : l));
}

const xe = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * SVG do fluxograma.
 * @param {Array} etapas [{ tipo, responsavel, o_que, prazo, tela, ir, sim, nao }] na ordem
 * @param {object} o { codigo(rota) → código da tela, larguraRaia, destaque: [n] (etapas cobertas por um POP) }
 */
export function svgFluxo(etapas, o = {}) {
  const E = etapas || [];
  if (!E.length) return '';
  const L = raias(E), W = o.larguraRaia || 180, H = 92, TOPO = 34, BW = 150, BH = 50, DW = 150, DH = 62;
  const S = setas(E), dest = new Set(o.destaque || []);
  // corredores: cada seta que não vai para a etapa logo abaixo ganha a sua faixa
  const longe = S.filter(s => s.para !== s.de + 1);
  const dir = longe.filter(s => s.tipo !== 'sim'), esq = longe.filter(s => s.tipo === 'sim');
  const GE = esq.length ? 14 + esq.length * 10 : 8, GD = dir.length ? 14 + dir.length * 10 : 8;
  const larg = GE + L.length * W + GD, alt = TOPO + E.length * H + 8;
  const cx = (i) => GE + raiaDe(L, E[i]) * W + W / 2, cy = (i) => TOPO + i * H + H / 2 - 6;
  const meia = (i) => (E[i].tipo === 'decisao' ? DW / 2 : BW / 2), mAlt = (i) => (E[i].tipo === 'decisao' ? DH / 2 : (E[i].tipo === 'atividade' ? BH : 40) / 2);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${larg} ${alt}" width="${larg}" height="${alt}" font-family="Arial, Helvetica, sans-serif" class="fluxograma" role="img" aria-label="Fluxograma do processo">`);
  out.push(`<defs><marker id="fx-seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>`);
  out.push(`<rect x="0" y="0" width="${larg}" height="${alt}" fill="#fff"/>`);
  // raias
  L.forEach((r, k) => {
    const x = GE + k * W;
    out.push(`<rect x="${x}" y="0" width="${W}" height="${alt}" fill="${k % 2 ? '#fff' : '#f7f7f7'}" stroke="#d0d0d0" stroke-width="0.8"/>`);
    out.push(`<rect x="${x}" y="0" width="${W}" height="${TOPO - 6}" fill="#e9e9e9" stroke="#d0d0d0" stroke-width="0.8"/>`);
    out.push(`<text x="${x + W / 2}" y="${(TOPO - 6) / 2 + 4}" text-anchor="middle" font-size="12" font-weight="bold" fill="#222">${xe(quebrar(r, 24, 1)[0])}</text>`);
  });
  // setas
  const linha = (pts, rot, rx, ry, anc = 'start') => {
    out.push(`<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="#333" stroke-width="1.3" marker-end="url(#fx-seta)"/>`);
    if (rot) out.push(`<text x="${rx}" y="${ry}" font-size="10" font-weight="bold" fill="#333" text-anchor="${anc}">${rot}</text>`);
  };
  let kd = 0, ke = 0;
  for (const s of S) {
    const a = s.de - 1, b = s.para - 1, rot = s.tipo === 'sim' ? 'Sim' : s.tipo === 'nao' ? 'Não' : '';
    const ax = cx(a), ay = cy(a), bx = cx(b), by = cy(b);
    if (!longe.includes(s)) {   // para a etapa logo abaixo
      const y0 = ay + mAlt(a), y1 = by - mAlt(b), ym = y0 + (y1 - y0) / 2;
      linha(ax === bx ? [[ax, y0], [bx, y1]] : [[ax, y0], [ax, ym], [bx, ym], [bx, y1]], rot, ax + 5, y0 + 12);
    } else if (s.tipo === 'sim') {   // corredor da esquerda
      const gx = GE - 10 - ke * 10; ke++;
      linha([[ax - meia(a), ay], [gx, ay], [gx, by], [bx - meia(b), by]], rot, ax - meia(a) - 4, ay - 5, 'end');
    } else {                        // corredor da direita
      const gx = GE + L.length * W + 10 + kd * 10; kd++;
      linha([[ax + meia(a), ay], [gx, ay], [gx, by], [bx + meia(b), by]], rot, ax + meia(a) + 4, ay - 5);
    }
  }
  // caixas
  E.forEach((e, i) => {
    const x = cx(i), y = cy(i), fill = dest.has(i + 1) ? '#fff4d6' : '#fff', T = quebrar(e.o_que, e.tipo === 'decisao' ? 20 : 24, e.tipo === 'atividade' ? 3 : 2);
    if (e.tipo === 'decisao') out.push(`<polygon points="${x},${y - DH / 2} ${x + DW / 2},${y} ${x},${y + DH / 2} ${x - DW / 2},${y}" fill="${dest.has(i + 1) ? '#fff4d6' : '#f2f2f2'}" stroke="#333" stroke-width="1.3"/>`);
    else if (e.tipo === 'atividade') out.push(`<rect x="${x - BW / 2}" y="${y - BH / 2}" width="${BW}" height="${BH}" rx="4" fill="${fill}" stroke="#333" stroke-width="1.3"/>`);
    else out.push(`<rect x="${x - BW / 2}" y="${y - 20}" width="${BW}" height="40" rx="20" fill="${e.tipo === 'fim' ? '#333' : '#fff'}" stroke="#333" stroke-width="1.6"/>`);
    const cor = e.tipo === 'fim' ? '#fff' : '#111', tam = e.tipo === 'decisao' ? 10 : 11, y0 = y - ((T.length - 1) * (tam + 2)) / 2 + 4;
    T.forEach((l, k) => out.push(`<text x="${x}" y="${y0 + k * (tam + 2)}" text-anchor="middle" font-size="${tam}" fill="${cor}">${xe(l)}</text>`));
    out.push(`<text x="${x - meia(i) - 2}" y="${y - mAlt(i) + 2}" text-anchor="end" font-size="9" fill="#777">${i + 1}</text>`);
    const leg = [e.tela && o.codigo ? o.codigo(e.tela) : '', e.prazo || ''].filter(Boolean).join(' · ');
    if (leg) out.push(`<text x="${x}" y="${y + mAlt(i) + 12}" text-anchor="middle" font-size="9" fill="#555" paint-order="stroke" stroke="#fff" stroke-width="3">${xe(quebrar(leg, 34, 1)[0])}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

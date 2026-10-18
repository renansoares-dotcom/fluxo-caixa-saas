// Planta da fábrica: desenho isométrico (computador/TV), planta baixa (celular e editor) e situação ao vivo das máquinas.
// Coordenadas em metros: x = largura do galpão, y = profundidade. Máquina: canto em (pos_x, pos_y); giro 0 = linha ao longo
// da largura, 90 = ao longo da profundidade (desenho transposto, o que mantém a ordem de pintura).
import { sb, state, q, fetchAll } from './data.js';
import { esc } from './ui.js';
import { cadProducao } from './producao.js';

export const TIPOS_VISUAIS = {
  extrusora: { t: 'Extrusora balão', w: 6, d: 3 },
  impressora: { t: 'Impressora flexográfica', w: 5.4, d: 2.4 },
  corte_solda: { t: 'Corte e solda', w: 5.4, d: 1.6 },
  rebobinadeira: { t: 'Rebobinadeira / refiladeira', w: 3.2, d: 1.8 },
  aglutinador: { t: 'Aglutinador / recuperação', w: 2.2, d: 2 },
  generica: { t: 'Outra máquina', w: 2.4, d: 1.6 },
};
export const TIPOS_AREA = { paletes: 'Área de paletes', estoque: 'Estoque de matéria-prima', expedicao: 'Expedição', outro: 'Outra área' };
export const COR = { prod: '#22c55e', setup: '#f59e0b', parada: '#ef4444', livre: '#94a3b8', imp: '#64748b' };
export const ROTULO_ST = { prod: 'Produzindo', setup: 'Setup / parada planejada', parada: 'Parada', livre: 'Livre', imp: 'Só Iniflex' };
export const COR_V = { carr: '#2563eb', pronto: '#22c55e', rota: '#7c3aed', plan: '#0ea5e9', garagem: '#94a3b8', manut: '#ef4444' };
export const ROT_V = { carr: 'Carregando', pronto: 'Pronto para sair', rota: 'Em rota', plan: 'Carga planejada', garagem: 'Na garagem', manut: 'Em manutenção' };
const TXT_V = { carr: '#1d4ed8', pronto: '#15803d', rota: '#6d28d9', plan: '#0369a1', garagem: '#5d6790', manut: '#dc2626' };
const TXT_ST = { prod: '#15803d', setup: '#b45309', parada: '#dc2626', livre: '#5d6790', imp: '#475569' };

export const pegada = (m) => { const T = TIPOS_VISUAIS[m.tipo_visual] || TIPOS_VISUAIS.generica; return +m.rotacao === 90 ? { w: T.d, d: T.w } : { w: T.w, d: T.d }; };
export const uid = () => Math.random().toString(36).slice(2, 10);
export const dur = (ini) => { const m = Math.max(0, Math.round((Date.now() - new Date(ini)) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Recife' });
const kg = (v) => Math.round(+v || 0).toLocaleString('pt-BR');

// ---------------------------------------------------------------- dados
export async function carregarPlanta() {
  const e = state.empresa.id;
  const [C, pl] = await Promise.all([cadProducao(true), q(sb.from('prod_planta').select('*').eq('empresa_id', e))]);
  return { C, planta: pl[0] || { empresa_id: e, largura_m: 60, profundidade_m: 30, elementos: [] } };
}

// situação de cada máquina agora + material entre setores + números do dia
export async function carregarSituacao(C) {
  const e = state.empresa.id, hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Recife' }), ini = `${hoje}T00:00:00-03:00`;
  const desde2d = new Date(Date.now() - 2 * 864e5).toISOString();
  const [abertos, paradas, doDia, recentes, opsAbertas] = await Promise.all([
    q(sb.from('prod_apontamentos').select('*').eq('empresa_id', e).is('fim', null)),
    q(sb.from('prod_paradas').select('*').eq('empresa_id', e).is('fim', null)),
    fetchAll(() => sb.from('prod_apontamentos').select('id,maquina_id,setor_id,inicio,fim,qtd_boa,refugo').eq('empresa_id', e).gte('inicio', ini).order('id')),
    q(sb.from('prod_apontamentos').select('maquina_id,origem,inicio,fim').eq('empresa_id', e).gte('inicio', desde2d).order('inicio', { ascending: false }).limit(500)),
    fetchAll(() => sb.from('prod_ordens').select('id,numero,numero_iniflex,codigo_produto,descricao,cliente,quantidade,unidade,entrega,status').eq('empresa_id', e).in('status', ['planejada', 'liberada', 'em_producao']).order('id'))]);
  const opIds = opsAbertas.map(o => o.id);
  const fatia = (a, n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  let etapas = [], bobEst = [], bobAbertas = [];
  for (const ids of fatia(opIds)) {
    const [et, bo] = await Promise.all([q(sb.from('prod_ordem_etapas').select('id,ordem_id,seq,setor_id,status,qtd_boa').in('ordem_id', ids)),
      q(sb.from('prod_bobinas').select('id,ordem_id,etapa_id,peso_kg,apontamento_id,situacao').in('ordem_id', ids).eq('situacao', 'estoque'))]);
    etapas = etapas.concat(et); bobEst = bobEst.concat(bo);
  }
  if (abertos.length) bobAbertas = await q(sb.from('prod_bobinas').select('apontamento_id,peso_kg').in('apontamento_id', abertos.map(a => a.id)));
  const opById = Object.fromEntries(opsAbertas.map(o => [o.id, o]));
  const faltam = [...new Set(abertos.map(a => a.ordem_id).filter(id => !opById[id]))];
  if (faltam.length) (await q(sb.from('prod_ordens').select('id,numero,numero_iniflex,codigo_produto,descricao,cliente,quantidade,unidade,entrega,status').in('id', faltam))).forEach(o => { opById[o.id] = o; });

  const maq = {};
  for (const m of C.maquinas) {
    const ap = abertos.find(a => a.maquina_id === m.id), pa = paradas.find(p => p.maquina_id === m.id);
    let st = 'livre', desde = null, motivo = null;
    if (pa) { const mo = C.motById[pa.motivo_id]; st = mo?.planejada ? 'setup' : 'parada'; desde = pa.inicio; motivo = mo?.nome || 'Parada'; }
    else if (ap) { st = 'prod'; desde = ap.inicio; }
    const ult = recentes.find(r => r.maquina_id === m.id);
    if (st === 'livre' && ult?.origem === 'iniflex') { st = 'imp'; desde = ult.fim || ult.inicio; }
    else if (st === 'livre' && ult?.fim) desde = ult.fim;
    const D = doDia.filter(a => a.maquina_id === m.id);
    const emCurso = ap ? bobAbertas.filter(b => b.apontamento_id === ap.id).reduce((t, b) => t + +b.peso_kg, 0) : 0;
    const op = ap ? opById[ap.ordem_id] : null;
    const et = ap?.etapa_id ? etapas.find(x => x.id === ap.etapa_id) : null;
    const operador = ap ? (C.opById[ap.operador_id]?.nome || ap.operador_nome || null) : pa ? (C.opById[pa.operador_id]?.nome || null) : null;
    maq[m.id] = { st, desde, motivo, op, etapa: et, operador, apontamento: ap || null,
      kgDia: D.reduce((t, a) => t + +a.qtd_boa, 0) + emCurso, refDia: D.reduce((t, a) => t + +a.refugo, 0), bobinasCurso: ap ? bobAbertas.filter(b => b.apontamento_id === ap.id).length : 0 };
  }
  // material parado entre setores: bobina em estoque cuja etapa é do setor A e a etapa seguinte (setor B) ainda não terminou
  const etById = Object.fromEntries(etapas.map(x => [x.id, x]));
  const wip = {};
  for (const b of bobEst) {
    const et = etById[b.etapa_id]; if (!et) continue;
    const prox = etapas.filter(x => x.ordem_id === et.ordem_id && x.seq > et.seq).sort((a, c) => a.seq - c.seq)[0];
    if (!prox || prox.status === 'concluida') continue;
    const k = `${et.setor_id}>${prox.setor_id}`; (wip[k] ||= { n: 0, kg: 0 }); wip[k].n++; wip[k].kg += +b.peso_kg;
  }
  const saidaSetor = {}; for (const a of doDia) saidaSetor[a.setor_id] = (saidaSetor[a.setor_id] || 0) + +a.qtd_boa;
  const ativas = C.maquinas.filter(m => m.ativo);
  const kgDia = Object.values(maq).reduce((t, x) => t + x.kgDia, 0), refDia = Object.values(maq).reduce((t, x) => t + x.refDia, 0);
  const hojeStr = hoje;
  let frota = null;
  try {
    const [veiculos, ativas, doDiaC] = await Promise.all([q(sb.from('log_veiculos').select('*').eq('empresa_id', e).order('codigo')),
      q(sb.from('log_cargas').select('*').eq('empresa_id', e).in('status', ['carregando', 'pronta', 'em_rota'])),
      q(sb.from('log_cargas').select('*').eq('empresa_id', e).eq('data', hoje).neq('status', 'cancelada'))]);
    const cargas = [...ativas, ...doDiaC.filter(c => !ativas.some(a => a.id === c.id))];
    const peso = { em_rota: 4, carregando: 3, pronta: 3, planejada: 2, concluida: 1 };
    const porVeiculo = {}; for (const c of cargas) { if (!c.veiculo_id) continue; const at = porVeiculo[c.veiculo_id]; if (!at || (peso[c.status] || 0) > (peso[at.status] || 0)) porVeiculo[c.veiculo_id] = c; }
    frota = { veiculos, cargas, porVeiculo, cargasHoje: doDiaC.length, kgHoje: doDiaC.reduce((s, c) => s + (+c.peso_kg || 0), 0) };
  } catch { frota = null; }
  return { maq, wip, saidaSetor, frota, atualizado: new Date(), kpi: {
    produzindo: ativas.filter(m => maq[m.id].st === 'prod').length, total: ativas.length,
    paradas: ativas.filter(m => maq[m.id].st === 'parada').length, setup: ativas.filter(m => maq[m.id].st === 'setup').length,
    kgDia, apara: kgDia + refDia ? refDia / (kgDia + refDia) : null,
    atrasadas: opsAbertas.filter(o => o.entrega && o.entrega < hojeStr).length } };
}

export function textoMaquina(m, S) {
  const x = S?.maq?.[m.id]; if (!x) return '';
  if (x.st === 'prod') return x.op ? `OP ${x.op.numero} · ${dur(x.desde)}` : `Produzindo · ${dur(x.desde)}`;
  if (x.st === 'parada') return `Parada ${dur(x.desde)}`;
  if (x.st === 'setup') return `${x.motivo || 'Setup'} ${dur(x.desde)}`;
  if (x.st === 'imp') return `Iniflex · ${hora(x.desde)}`;
  return x.desde ? `Livre há ${dur(x.desde)}` : 'Livre';
}

// ---------------------------------------------------------------- caminhões na planta
export const capKg = (v) => +v.carga_kg * (+v.ocupacao_max_pct || 100) / 100;
export const pequenoV = (v) => v.pequeno || ['vuc', 'utilitario', 'tres_quartos'].includes(v.tipo) || +v.carga_kg <= 4000;
// onde cada caminhão aparece: doca (carregando/pronto), rua (em rota) ou vaga da garagem
export function lugaresCaminhoes(els, frota) {
  if (!frota?.veiculos?.length) return [];
  const docas = els.filter(e => e.t === 'doca'), vagas = els.filter(e => e.t === 'vaga'), ruas = els.filter(e => e.t === 'rua');
  const usD = new Set(), usV = new Set(), res = []; let nRua = 0;
  const ativos = frota.veiculos.filter(v => v.situacao !== 'inativo');
  const ordem = [...ativos].sort((a, b) => (vagas.some(g => g.veiculo_id === b.id) ? 1 : 0) - (vagas.some(g => g.veiculo_id === a.id) ? 1 : 0));
  for (const v of ordem) {
    const c = frota.porVeiculo[v.id], st = c?.status; let lugar = null, est = 'garagem', idx = 0;
    if (v.situacao === 'manutencao') est = 'manut';
    else if (st === 'carregando' || st === 'pronta') { est = st === 'pronta' ? 'pronto' : 'carr'; lugar = docas.find(d => !usD.has(d.id)) || null; if (lugar) usD.add(lugar.id); }
    else if (st === 'em_rota') { est = 'rota'; lugar = ruas[0] || null; idx = nRua++; }
    else if (st === 'planejada') est = 'plan';
    if (!lugar && est !== 'rota') { lugar = vagas.find(g => g.veiculo_id === v.id && !usV.has(g.id)) || vagas.find(g => !g.veiculo_id && !usV.has(g.id)) || null; if (lugar) usV.add(lugar.id); }
    res.push({ v, c, lugar, est, idx });
  }
  return res;
}
export function textoVeiculo(x) {
  const pct = x.c?.peso_kg ? Math.round(+x.c.peso_kg / +x.v.carga_kg * 100) : null;
  if (x.est === 'carr') return `Carregando${pct != null ? ' · ' + pct + '%' : ''}`;
  if (x.est === 'pronto') return `Pronto${pct != null ? ' · ' + pct + '%' : ''}`;
  if (x.est === 'rota') return `Em rota${x.c?.saida_em ? ' · saiu ' + hora(x.c.saida_em) : ''}`;
  if (x.est === 'plan') return `Carga planejada${pct != null ? ' · ' + pct + '%' : ''}`;
  if (x.est === 'manut') return 'Manutenção';
  return 'Na garagem';
}
// retângulo ocupado pelo caminhão dentro do lugar (ao longo do lado maior)
export function geoCaminhao(x) {
  const el = x.lugar; if (!el) return null;
  const aoX = el.w >= el.d, longo = aoX ? el.w : el.d, curto = aoX ? el.d : el.w;
  const L = Math.max(3, Math.min(pequenoV(x.v) ? 5.2 : 7.6, longo - .3)), w = Math.max(1.4, Math.min(2.4, curto - .2));
  const off = x.est === 'rota' ? Math.min(x.idx * (L + 1.5), Math.max(0, longo - L - .3)) : 0;
  return aoX ? { X: el.x + .15 + off, Y: el.y + (el.d - w) / 2, L, w, aoX } : { X: el.x + (el.w - w) / 2, Y: el.y + .15 + off, L, w, aoX };
}

// ---------------------------------------------------------------- geometria auxiliar
const centro = (r) => [r.x + r.w / 2, r.y + r.d / 2];
function saidaRet(r, c, dir) { // ponto onde a reta c + t·dir sai do retângulo r
  let t = Infinity;
  if (dir[0] > 0) t = Math.min(t, (r.x + r.w - c[0]) / dir[0]); if (dir[0] < 0) t = Math.min(t, (r.x - c[0]) / dir[0]);
  if (dir[1] > 0) t = Math.min(t, (r.y + r.d - c[1]) / dir[1]); if (dir[1] < 0) t = Math.min(t, (r.y - c[1]) / dir[1]);
  return [c[0] + dir[0] * t, c[1] + dir[1] * t];
}
export function geometriaSeta(el, porId) {
  const A = porId[el.de], B = porId[el.para]; if (!A || !B) return null;
  const ca = centro(A), cb = centro(B), d = [cb[0] - ca[0], cb[1] - ca[1]], L = Math.hypot(...d) || 1, u = [d[0] / L, d[1] / L];
  const a = saidaRet(A, ca, u), b = saidaRet(B, cb, [-u[0], -u[1]]);
  return { a: [a[0] + u[0] * .4, a[1] + u[1] * .4], b: [b[0] - u[0] * .4, b[1] - u[1] * .4], u };
}
export function textoSeta(el, porId, S) {
  const A = porId[el.de], B = porId[el.para]; if (!A || !B || !S) return null;
  if (A.t === 'setor' && B.t === 'setor' && A.setor_id && B.setor_id) {
    const w = S.wip[`${A.setor_id}>${B.setor_id}`] || { n: 0, kg: 0 };
    return { l1: `${w.n} bobina${w.n === 1 ? '' : 's'} · ${w.kg >= 1000 ? (w.kg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' t' : kg(w.kg) + ' kg'}`, l2: `aguardando ${(B.nome || '').toLowerCase()}`, n: w.n };
  }
  if (A.setor_id) return { l1: `${kg(S.saidaSetor[A.setor_id] || 0)} kg hoje`, l2: `para ${(B.nome || '').toLowerCase()}`, n: 0 };
  return { l1: B.nome || '', l2: '', n: 0 };
}

// ---------------------------------------------------------------- desenho isométrico
const C30 = .866, S30 = .5, ESC = 21;
const PAL = { w: ['#ffffff', '#e2e8f8', '#c3cef0'], d: ['#4a5aa8', '#34428a', '#28346f'], c: ['#38b3ef', '#1590d6', '#0d73b3'], f: ['#d9f2ff', '#a9dcf7', '#86c8ee'],
  m: ['#d9a86a', '#b9874b', '#9c6f3a'], k: ['#f0c890', '#dcae6e', '#c4934f'], b: ['#5b7fe0', '#3f63c6', '#2f4fa8'], p: ['#ffffff', '#eef2fb', '#dfe6f7'] };
const EDGE = 'rgba(40,52,111,.28)';

export function desenharIso(planta, maquinas, S, opts = {}) {
  const out = [], tarde = [], pts = [];
  const P = (x, y, z = 0) => [(x - y) * C30 * ESC, (x + y) * S30 * ESC - z * ESC];
  const pp = (a) => a.map(p => { pts.push(p); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
  const poly = (a, f, st = EDGE, w = .7, ex = '') => out.push(`<polygon points="${pp(a)}" fill="${f}" stroke="${st}" stroke-width="${w}" stroke-linejoin="round" ${ex}/>`);
  const box = (x, y, z, w, d, h, k = 'w') => { const c = PAL[k];
    poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], c[2]);
    poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], c[1]);
    poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], c[0]); };
  const cyl = (ax, cx, cy, cz, r0, r1, L, k = 'w', fill, cap) => {
    const c = PAL[k]; fill = fill || c[1]; cap = cap || c[0]; const n = 28, A = [], B = [];
    const pt = (t, r, o) => ax === 'z' ? P(cx + r * Math.cos(t), cy + r * Math.sin(t), cz + o) : ax === 'x' ? P(cx + o, cy + r * Math.cos(t), cz + r * Math.sin(t)) : P(cx + r * Math.cos(t), cy + o, cz + r * Math.sin(t));
    for (let i = 0; i < n; i++) { const t = i / n * 2 * Math.PI; A.push(pt(t, r0, 0)); B.push(pt(t, r1, L)); }
    const c0 = pt(0, 0, 0), c1 = pt(0, 0, L); let u = [c1[0] - c0[0], c1[1] - c0[1]]; const ul = Math.hypot(...u) || 1; u = [u[0] / ul, u[1] / ul]; const nv = [-u[1], u[0]];
    const dn = p => (p[0] - c0[0]) * nv[0] + (p[1] - c0[1]) * nv[1], du = p => (p[0] - c0[0]) * u[0] + (p[1] - c0[1]) * u[1];
    let im = 0, iM = 0; A.forEach((p, i) => { if (dn(p) < dn(A[im])) im = i; if (dn(p) > dn(A[iM])) iM = i; });
    const arc = (arr, a, b) => { const r = []; for (let i = a; ; i = (i + 1) % n) { r.push(arr[i]); if (i === b) break; } return r; };
    const a1 = arc(A, im, iM), a2 = arc(A, iM, im), mid = a => du(a[a.length >> 1]);
    const frente = mid(a1) < mid(a2) ? a1 : a2, fim = frente === a1 ? arc(B, iM, im) : arc(B, im, iM);
    poly([...frente, ...fim], fill); poly(B, cap); };
  const seg = (a, b, st, w, dash) => out.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${st}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`);
  const piso = (r, fill, st, dash = '', w = 1.4) => poly([P(r.x, r.y), P(r.x + r.w, r.y), P(r.x + r.w, r.y + r.d), P(r.x, r.y + r.d)], fill, st, w, dash ? `stroke-dasharray="${dash}"` : '');
  const textoPiso = (x, y, txt, cor = '#fff', tam = 15) => { const p = P(x, y); out.push(`<text transform="matrix(${C30},${S30},${-C30},${S30},${p[0].toFixed(1)},${p[1].toFixed(1)})" fill="${cor}" font-size="${tam}" font-weight="800" letter-spacing="2">${esc(String(txt).toUpperCase())}</text>`); };

  const L = +planta.largura_m || 60, Pf = +planta.profundidade_m || 30, els = planta.elementos || [];
  const porId = Object.fromEntries(els.map(x => [x.id, x]));
  // piso e paredes do galpão
  piso({ x: 0, y: 0, w: L, d: Pf }, 'rgba(255,255,255,.10)', 'rgba(255,255,255,.55)', '', 1.2);
  for (let i = 1; i < L; i++) seg(P(i, 0), P(i, Pf), 'rgba(255,255,255,.10)', .8);
  for (let j = 1; j < Pf; j++) seg(P(0, j), P(L, j), 'rgba(255,255,255,.10)', .8);
  box(0, -.25, 0, L, .25, 2.2, 'p'); box(-.25, -.25, 0, .25, Pf + .25, 2.2, 'p');
  // elementos de piso
  for (const el of els) {
    if (el.t === 'corredor') { piso(el, 'rgba(255,255,255,.22)', '#ffd34d', '8 6', 2); }
    if (el.t === 'portao') { piso(el, 'rgba(47,79,168,.55)', '#fff', '', 1); textoPiso(el.x + .2, el.y + el.d - .2, 'Portão', '#fff', 11); }
    if (el.t === 'setor') { piso(el, 'rgba(255,255,255,.16)', 'rgba(255,255,255,.85)', '7 5', 1.6); }
    if (el.t === 'area') { piso(el, 'rgba(255,255,255,.12)', 'rgba(255,255,255,.7)', '3 4', 1.2); }
    if (el.t === 'patio') piso(el, 'rgba(60,72,130,.30)', 'rgba(255,255,255,.35)', '', 1);
    if (el.t === 'rua') { piso(el, 'rgba(45,55,105,.5)', 'none', '', 0); const aoX = el.w >= el.d;
      if (aoX) for (let x = el.x + .5; x < el.x + el.w - 1; x += 3) seg(P(x, el.y + el.d / 2), P(Math.min(x + 1.5, el.x + el.w), el.y + el.d / 2), '#ffd34d', 2);
      else for (let y = el.y + .5; y < el.y + el.d - 1; y += 3) seg(P(el.x + el.w / 2, y), P(el.x + el.w / 2, Math.min(y + 1.5, el.y + el.d)), '#ffd34d', 2); }
    if (el.t === 'doca') piso(el, 'rgba(255,211,77,.10)', '#ffd34d', '9 6', 2);
    if (el.t === 'vaga') piso(el, 'rgba(255,255,255,.05)', '#fff', '', 1.4);
  }
  for (const el of els) if (el.t === 'setor' || el.t === 'area') textoPiso(el.x + .4, el.y + el.d - .5, el.nome || '');
  for (const el of els) if (el.t === 'doca' || el.t === 'vaga') textoPiso(el.x + .3, el.y + el.d - .3, el.nome || '', el.t === 'doca' ? '#ffd34d' : '#fff', 9);
  for (const el of els) if (el.t === 'rua' && el.nome) textoPiso(el.x + .4, el.y + el.d - .3, el.nome, 'rgba(255,255,255,.8)', 11);
  // objetos com altura, pintados de trás para frente
  const objs = [];
  for (const el of els) if (el.t === 'area' && ['paletes', 'expedicao', 'estoque'].includes(el.tipo)) objs.push({ prof: el.x + el.y + 1, f: () => decorArea(el) });
  for (const m of maquinas) { if (m.pos_x == null || m.pos_y == null) continue; const pg = pegada(m); objs.push({ prof: +m.pos_x + +m.pos_y + (pg.w + pg.d) / 2, f: () => maquina(m) }); }
  for (const el of els) if (el.t === 'parede') objs.push({ prof: el.x + el.y + (el.w + el.d) / 2, f: () => box(el.x, el.y, 0, el.w, el.d, +el.altura || 3, 'p') });
  for (const el of els) if (el.t === 'guarita') objs.push({ prof: el.x + el.y + (el.w + el.d) / 2, f: () => { box(el.x, el.y, 0, el.w, el.d, 2.3, 'w'); box(el.x - .1, el.y - .1, 2.3, el.w + .2, el.d + .2, .18, 'd'); box(el.x + el.w * .25, el.y + el.d, .9, el.w * .5, .02, .6, 'c'); } });
  const cams = lugaresCaminhoes(els, S?.frota);
  for (const x of cams) { const g = geoCaminhao(x); if (!g) continue; objs.push({ prof: g.X + g.Y + (g.aoX ? g.L + g.w : g.w + g.L) / 2, f: () => caminhao(x, g) }); }
  const setas = els.filter(x => x.t === 'seta').map(el => ({ el, g: geometriaSeta(el, porId), tx: textoSeta(el, porId, S) })).filter(x => x.g);
  for (const s of setas) if (s.tx?.n) { const m = [(s.g.a[0] + s.g.b[0]) / 2, (s.g.a[1] + s.g.b[1]) / 2], nrm = [-s.g.u[1], s.g.u[0]];
    const px = m[0] + nrm[0] * 1.2 - .65, py = m[1] + nrm[1] * 1.2 - .55; objs.push({ prof: px + py + 1, f: () => palete(px, py, Math.min(9, s.tx.n)) }); }
  objs.sort((a, b) => a.prof - b.prof).forEach(o => o.f());
  // setas e etiquetas por cima de tudo
  for (const s of setas) {
    const a = P(...s.g.a), b = P(...s.g.b); seg(a, b, '#fff', 2.6, '8 5');
    const d = [b[0] - a[0], b[1] - a[1]], Ls = Math.hypot(...d) || 1, u = [d[0] / Ls, d[1] / Ls], n = [-u[1], u[0]];
    out.push(`<polygon points="${pp([[b[0] + u[0] * 11, b[1] + u[1] * 11], [b[0] + n[0] * 6.5, b[1] + n[1] * 6.5], [b[0] - n[0] * 6.5, b[1] - n[1] * 6.5]])}" fill="#fff"/>`);
    if (s.tx) { const mm = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 58], wd = Math.max(s.tx.l1.length * 6.8, s.tx.l2.length * 6) + 20;
      pts.push([mm[0] - wd / 2, mm[1]], [mm[0] + wd / 2, mm[1] + 36]);
      tarde.push(`<g transform="translate(${(mm[0] - wd / 2).toFixed(1)},${mm[1].toFixed(1)})"><rect width="${wd}" height="36" rx="8" fill="#fff"/><text x="10" y="15" font-size="12" font-weight="700" fill="#14103f">${esc(s.tx.l1)}</text><text x="10" y="29" font-size="10.5" fill="#4a5280">${esc(s.tx.l2)}</text></g>`); }
  }

  function decorArea(el) {
    if (el.tipo === 'estoque') { const n = Math.min(6, Math.max(1, Math.floor(el.w / 1.4))); for (let i = 0; i < n; i++) { box(el.x + .4 + i * 1.3, el.y + .5, 0, 1, 1, 1.1, 'w'); box(el.x + .4 + i * 1.3, el.y + .5, 1.1, 1, 1, .08, 'c'); } }
    else { const n = Math.min(4, Math.max(1, Math.floor(el.w / 1.8))); for (let i = 0; i < n; i++) { box(el.x + .4 + i * 1.7, el.y + .5, 0, 1.2, 1.1, .14, 'm'); box(el.x + .5 + i * 1.7, el.y + .6, .14, 1, .9, .5 + (i % 2) * .4, 'k'); } }
  }
  function palete(x, y, n) { box(x, y, 0, 1.3, 1.1, .14, 'm'); for (let i = 0; i < n; i++) { const c = i % 3, r = Math.floor(i / 3); cyl('y', x + .25 + c * .4, y + .05, .32 + r * .36, .18, .18, 1, 'f'); } }

  function caminhao(x, g) {
    const { X, Y, L, w } = g, rot = !g.aoX, st = x.est;
    const B = (a, b, z, ww, dd, h, k) => rot ? box(X + b, Y + a, z, dd, ww, h, k) : box(X + a, Y + b, z, ww, dd, h, k);
    const Cy = (ax, cx, cy, cz, r0, r1, Lc, k) => rot ? cyl(ax === 'x' ? 'y' : ax === 'y' ? 'x' : 'z', X + cy, Y + cx, cz, r0, r1, Lc, k) : cyl(ax, X + cx, Y + cy, cz, r0, r1, Lc, k);
    const Pl = (a, b, z) => rot ? P(X + b, Y + a, z) : P(X + a, Y + b, z);
    const fw = rot ? w : L, fd = rot ? L : w;
    out.push(`<g class="pl-maq" data-v="${x.v.id}" style="cursor:pointer"><polygon points="${pp([P(X - .3, Y - .3), P(X + fw + .3, Y - .3), P(X + fw + .3, Y + fd + .3), P(X - .3, Y + fd + .3)])}" fill="${COR_V[st]}" opacity="${st === 'garagem' ? .12 : .4}" filter="url(#pl-bl)"/>`);
    B(0, 0, .45, L - 1.9, w, .25, 'd'); B(0, 0, .7, L - 2.1, w, 2.6, 'w'); B(L - 1.9, 0, .45, 1.9, w, 2.05, 'b'); B(L - .03, .15, 1.45, .03, w - .3, .75, 'c');
    [.9, 2.1, L - 1].forEach(a => Cy('y', a, w, .45, .42, .42, .16, 'd'));
    out.push('</g>');
    const b = Pl((L - 2.1) / 2, w / 2, 3.3), t2 = textoVeiculo(x), wd = Math.max(x.v.codigo.length * 7.4, t2.length * 5.9) + 18, sel = opts.sel === 'v:' + x.v.id;
    pts.push([b[0] - wd / 2, b[1] - 46]);
    tarde.push(`<g class="pl-maq" data-v="${x.v.id}" style="cursor:pointer"><g transform="translate(${(b[0] - wd / 2).toFixed(1)},${(b[1] - 44).toFixed(1)})"><rect width="${wd}" height="32" rx="6" fill="#fff" stroke="${sel ? '#2a1f6f' : COR_V[st]}" stroke-width="${sel ? 3 : 2}"/>
      <text x="9" y="13" fill="#1b2350" font-size="11.5" font-weight="700">${esc(x.v.codigo)}</text><text x="9" y="26" fill="${TXT_V[st]}" font-size="10" font-weight="600">${esc(t2)}</text></g>
      <line x1="${b[0].toFixed(1)}" y1="${(b[1] - 12).toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${COR_V[st]}"/></g>`);
  }
  function maquina(m) {
    const st = S?.maq?.[m.id]?.st || 'livre', X = +m.pos_x, Y = +m.pos_y, rot = +m.rotacao === 90;
    // desenho local (giro 0) transposto quando giro 90
    const B = (x, y, z, w, d, h, k) => rot ? box(X + y, Y + x, z, d, w, h, k) : box(X + x, Y + y, z, w, d, h, k);
    const Cy = (ax, cx, cy, cz, r0, r1, Lc, k, f, c) => rot ? cyl(ax === 'x' ? 'y' : ax === 'y' ? 'x' : 'z', X + cy, Y + cx, cz, r0, r1, Lc, k, f, c) : cyl(ax, X + cx, Y + cy, cz, r0, r1, Lc, k, f, c);
    const Pl = (x, y, z) => rot ? P(X + y, Y + x, z) : P(X + x, Y + y, z);
    const T = TIPOS_VISUAIS[m.tipo_visual] || TIPOS_VISUAIS.generica, pg = pegada(m);
    out.push(`<g class="pl-maq" data-m="${m.id}" style="cursor:pointer">`);
    out.push(`<polygon points="${pp([P(X - .4, Y - .4), P(X + pg.w + .4, Y - .4), P(X + pg.w + .4, Y + pg.d + .4), P(X - .4, Y + pg.d + .4)])}" fill="${COR[st]}" opacity="${st === 'livre' || st === 'imp' ? .12 : .45}" filter="url(#pl-bl)" ${st === 'parada' ? 'class="pl-pulsa"' : ''}/>`);
    const bolha = 'rgba(255,255,255,.55)'; let topo;
    switch (m.tipo_visual) {
      case 'extrusora':
        B(0, 1, 0, 2.6, 1, 1.05); Cy('x', .2, 1.5, 1.45, .33, .33, 2.5, 'd'); Cy('z', .8, 1.5, 1.75, .18, .62, 1, 'c');
        B(2.2, .7, 0, .14, .14, 8.1); B(3.66, .7, 0, .14, .14, 8.1); B(2.2, 2.16, 0, .14, .14, 8.1);
        Cy('z', 3, 1.5, 0, .48, .48, 1.85); Cy('z', 3, 1.5, 1.85, .36, .72, 1.1, 'w', bolha, bolha); Cy('z', 3, 1.5, 2.95, .72, .72, 3.4, 'w', bolha, bolha); Cy('z', 3, 1.5, 6.35, .72, .08, 1.2, 'w', bolha, bolha);
        B(2.2, .7, 4.2, 1.6, 1.6, .1); B(3.66, 2.16, 0, .14, .14, 8.1); B(2.1, .6, 7.9, 1.8, 1.8, .38, 'd'); Cy('y', 3, .7, 7.55, .18, .18, 1.6, 'd');
        B(4.4, .6, 0, 1.4, 1.8, 1.25); Cy('y', 5.1, .65, 1.7, .46, .46, 1.7, 'f'); topo = [3, 1.5, 8.28]; break;
      case 'impressora':
        B(0, .3, 0, .8, 1.6, 1.5); Cy('y', .4, .2, 1.85, .55, .55, 1.8, 'f'); B(1.2, .2, 0, 2.8, .2, 2.7);
        Cy('y', 2.6, .45, 1.5, .92, .92, 1.4, 'd'); [[1.45, 2.25], [1.45, .95], [3.75, 2.25], [3.75, .95]].forEach(([a, b]) => Cy('y', a, .45, b, .22, .22, 1.4, 'c'));
        B(1.8, .4, 2.55, 1.6, 1.4, .5, 'c'); B(1.2, 1.85, 0, 2.8, .2, 2.7); B(4.4, .3, 0, .8, 1.6, 1.5); Cy('y', 4.8, .2, 1.85, .42, .42, 1.8, 'f'); topo = [2.6, 1.1, 3.05]; break;
      case 'corte_solda':
        B(0, .2, 0, .8, 1.2, 1); Cy('y', .4, .1, 1.35, .45, .45, 1.4, 'f'); B(.9, .2, 0, 3.2, 1.2, .9); B(.9, .25, .9, 3.2, 1.1, .04, 'd'); B(2.6, .1, .9, .6, 1.4, .7, 'c');
        B(4.1, .3, 0, 1.2, 1, .6); [0, 1, 2].forEach(i => B(4.3, .45, .6 + i * .12, .8, .7, .1, 'f')); topo = [2.9, .8, 1.6]; break;
      case 'rebobinadeira':
        B(0, .2, 0, .9, 1.4, 1.1); Cy('y', .45, .1, 1.5, .5, .5, 1.6, 'f'); B(1.1, .3, 0, 1, 1.2, 1.4, 'w'); B(1.1, .3, 1.4, 1, 1.2, .08, 'd');
        B(2.3, .2, 0, .9, 1.4, 1.1); Cy('y', 2.75, .1, 1.5, .38, .38, 1.6, 'f'); topo = [1.6, .9, 1.5]; break;
      case 'aglutinador':
        B(0, 0, 0, 2.2, 2, .5, 'd'); Cy('z', 1.1, 1, .5, .8, .8, 1.5); Cy('z', 1.1, 1, 2, .8, .3, .5, 'c'); B(1.6, 1.3, .5, .6, .6, .8, 'b'); topo = [1.1, 1, 2.5]; break;
      default:
        B(0, 0, 0, 2.4, 1.6, 1.3); B(.3, 1.6, .5, .8, .02, .5, 'd'); B(0, 0, 1.3, 2.4, 1.6, .08, 'c'); topo = [1.2, .8, 1.38];
    }
    const x = S?.maq?.[m.id];
    if (x?.operador && st !== 'livre') { // operador ao lado da máquina
      const px = T.w * .55, py = T.d + .45;
      B(px, py, 0, .12, .12, .75, 'd'); B(px + .2, py, 0, .12, .12, .75, 'd'); B(px - .03, py - .05, .75, .38, .24, .62, 'b');
      const h = Pl(px + .16, py + .06, 1.62); out.push(`<circle cx="${h[0].toFixed(1)}" cy="${h[1].toFixed(1)}" r="5.2" fill="#f1c7a0" stroke="${EDGE}" stroke-width=".6"/><path d="M${(h[0] - 5.6).toFixed(1)},${(h[1] - 1).toFixed(1)} a5.6,5.6 0 0 1 11.2,0 z" fill="#ffd34d" stroke="#d69a00" stroke-width=".6"/>`);
    }
    out.push('</g>');
    // sinaleiro e etiqueta
    const b = Pl(...topo); seg(b, [b[0], b[1] - 34], '#9fb6e8', 1.5);
    [['parada', -30], ['setup', -21], ['prod', -12]].forEach(([k, dy]) => { const on = k === st;
      out.push(`<circle cx="${b[0].toFixed(1)}" cy="${(b[1] + dy).toFixed(1)}" r="4.3" fill="${on ? COR[k] : '#6b77b5'}" stroke="${on ? '#fff' : '#55619e'}" stroke-width=".8" ${on ? 'filter="url(#pl-gl)"' : ''}/>`); });
    const t2 = textoMaquina(m, S), w = Math.max(m.codigo.length * 7.4, t2.length * 5.9) + 18, sel = opts.sel === m.id;
    pts.push([b[0] - w / 2, b[1] - 80], [b[0] + w / 2, b[1] - 80]);
    tarde.push(`<g class="pl-maq" data-m="${m.id}" style="cursor:pointer"><g transform="translate(${(b[0] - w / 2).toFixed(1)},${(b[1] - 76).toFixed(1)})"><rect width="${w}" height="32" rx="6" fill="#fff" stroke="${sel ? '#2a1f6f' : COR[st]}" stroke-width="${sel ? 3 : 2}"/>
      <text x="9" y="13" fill="#1b2350" font-size="11.5" font-weight="700">${esc(m.codigo)}</text><text x="9" y="26" fill="${TXT_ST[st]}" font-size="10" font-weight="600">${esc(t2)}</text></g>
      <line x1="${b[0].toFixed(1)}" y1="${(b[1] - 44).toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${(b[1] - 38).toFixed(1)}" stroke="${COR[st]}"/>
</g>`);
  }

  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs) - 16, y0 = Math.min(...ys) - 16, W = Math.max(...xs) - x0 + 16, H = Math.max(...ys) - y0 + 16;
  return `<svg viewBox="${x0.toFixed(0)} ${y0.toFixed(0)} ${W.toFixed(0)} ${H.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" class="pl-iso"><defs>
    <filter id="pl-bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="pl-gl" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${out.join('')}${tarde.join('')}</svg>`;
}

// ---------------------------------------------------------------- planta baixa (vista de cima)
// modo 'situacao' pinta as máquinas pela situação; modo 'editor' mostra alças e o tipo
export function desenharBaixa(planta, maquinas, S, opts = {}) {
  const L = +planta.largura_m || 60, Pf = +planta.profundidade_m || 30, els = planta.elementos || [], ed = opts.modo === 'editor';
  const porId = Object.fromEntries(els.map(x => [x.id, x])), sel = opts.sel;
  const r = (el, f, st, dash = '', extra = '') => `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.d}" fill="${f}" stroke="${st}" stroke-width="${ed ? .08 : .1}" ${dash ? `stroke-dasharray="${dash}"` : ''} ${extra}/>`;
  const grade = []; for (let i = 1; i < L; i++) grade.push(`<line x1="${i}" y1="0" x2="${i}" y2="${Pf}" stroke="rgba(43,85,152,${i % 5 ? .07 : .16})" stroke-width=".04"/>`);
  for (let j = 1; j < Pf; j++) grade.push(`<line x1="0" y1="${j}" x2="${L}" y2="${j}" stroke="rgba(43,85,152,${j % 5 ? .07 : .16})" stroke-width=".04"/>`);
  const partes = [`<rect x="0" y="0" width="${L}" height="${Pf}" fill="#f4f7fe" stroke="#2a1f6f" stroke-width=".18"/>`, ...grade];
  const alca = (el) => ed && sel === el.id ? `<rect class="pl-alca" data-alca="${el.id}" x="${el.x + el.w - .45}" y="${el.y + el.d - .45}" width=".9" height=".9" rx=".15" fill="#2a1f6f"/>` : '';
  for (const el of els) {
    const g = (inner) => partes.push(`<g class="pl-el ${sel === el.id ? 'sel' : ''}" data-el="${el.id}">${inner}${alca(el)}</g>`);
    const nome = (txt, cor) => `<text x="${el.x + .35}" y="${el.y + .9}" font-size=".75" font-weight="700" fill="${cor}">${esc(txt || '')}</text>`;
    if (el.t === 'setor') g(r(el, 'rgba(43,85,152,.06)', sel === el.id ? '#2a1f6f' : '#2b5598', '.5 .3') + nome(el.nome, '#2a1f6f'));
    if (el.t === 'area') g(r(el, 'rgba(217,168,106,.14)', sel === el.id ? '#2a1f6f' : '#b9874b', '.25 .25') + nome(el.nome || TIPOS_AREA[el.tipo], '#8a6232'));
    if (el.t === 'corredor') g(r(el, 'rgba(255,211,77,.18)', sel === el.id ? '#2a1f6f' : '#e0a800', '.6 .4') + (ed ? nome('Corredor', '#a07400') : ''));
    if (el.t === 'patio') g(r(el, 'rgba(93,103,144,.16)', sel === el.id ? '#2a1f6f' : '#8a93b8') + (ed ? nome('Pátio', '#5d6790') : ''));
    if (el.t === 'rua') g(r(el, '#5d6790', sel === el.id ? '#2a1f6f' : '#4a5280') + `<line x1="${el.w >= el.d ? el.x + .3 : el.x + el.w / 2}" y1="${el.w >= el.d ? el.y + el.d / 2 : el.y + .3}" x2="${el.w >= el.d ? el.x + el.w - .3 : el.x + el.w / 2}" y2="${el.w >= el.d ? el.y + el.d / 2 : el.y + el.d - .3}" stroke="#ffd34d" stroke-width=".15" stroke-dasharray="1 .8"/>` + (el.nome ? `<text x="${el.x + .35}" y="${el.y + .8}" font-size=".6" fill="#fff" font-weight="700">${esc(el.nome)}</text>` : ''));
    if (el.t === 'doca') g(r(el, 'rgba(255,211,77,.16)', sel === el.id ? '#2a1f6f' : '#e0a800', '.5 .3') + nome(el.nome || 'Doca', '#a07400'));
    if (el.t === 'vaga') g(r(el, 'rgba(148,163,184,.12)', sel === el.id ? '#2a1f6f' : '#94a3b8') + nome(el.nome || 'Vaga', '#5d6790'));
    if (el.t === 'parede') g(r(el, '#2a1f6f', sel === el.id ? '#0ea5e9' : '#2a1f6f'));
    if (el.t === 'guarita') g(r(el, '#5d6790', sel === el.id ? '#2a1f6f' : '#4a5280') + `<text x="${el.x + el.w / 2}" y="${el.y + el.d / 2 + .2}" font-size=".55" text-anchor="middle" fill="#fff" font-weight="700">GUARITA</text>`);
    if (el.t === 'portao') g(r(el, '#3f63c6', sel === el.id ? '#2a1f6f' : '#2f4fa8') + `<text x="${el.x + el.w / 2}" y="${el.y + el.d / 2 + .22}" font-size=".6" text-anchor="middle" fill="#fff" font-weight="700">PORTÃO</text>`);
  }
  for (const el of els.filter(x => x.t === 'seta')) {
    const gm = geometriaSeta(el, porId); if (!gm) continue; const tx = textoSeta(el, porId, S);
    const n = [-gm.u[1], gm.u[0]], b = gm.b, h = [[b[0] + gm.u[0] * .7, b[1] + gm.u[1] * .7], [b[0] + n[0] * .45, b[1] + n[1] * .45], [b[0] - n[0] * .45, b[1] - n[1] * .45]];
    const mid = [(gm.a[0] + b[0]) / 2, (gm.a[1] + b[1]) / 2];
    partes.push(`<g class="pl-el ${sel === el.id ? 'sel' : ''}" data-el="${el.id}"><line x1="${gm.a[0]}" y1="${gm.a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${sel === el.id ? '#2a1f6f' : '#2b5598'}" stroke-width=".22" stroke-dasharray=".6 .35"/>
      <polygon points="${h.map(p => p.join(',')).join(' ')}" fill="${sel === el.id ? '#2a1f6f' : '#2b5598'}"/>${tx && !ed ? `<text x="${mid[0]}" y="${mid[1] - .5}" font-size=".62" text-anchor="middle" fill="#2a1f6f" font-weight="700">${esc(tx.l1)}</text>` : ''}
      <line x1="${gm.a[0]}" y1="${gm.a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="transparent" stroke-width="1.2"/></g>`);
  }
  if (!ed) for (const x of lugaresCaminhoes(els, S?.frota)) {
    const gm = geoCaminhao(x); if (!gm) continue; const fw = gm.aoX ? gm.L : gm.w, fd = gm.aoX ? gm.w : gm.L;
    partes.push(`<g class="pl-el pl-maq" data-v="${x.v.id}"><rect x="${gm.X}" y="${gm.Y}" width="${fw}" height="${fd}" rx=".25" fill="${COR_V[x.est]}" stroke="${sel === 'v:' + x.v.id ? '#2a1f6f' : 'rgba(0,0,0,.25)'}" stroke-width="${sel === 'v:' + x.v.id ? .2 : .08}"/>
      <text x="${gm.X + fw / 2}" y="${gm.Y + fd / 2 + .2}" font-size="${Math.min(.75, Math.min(fw, fd) / 2.2)}" text-anchor="middle" font-weight="800" fill="#fff">${esc(x.v.codigo)}</text></g>`);
  }
  for (const m of maquinas) {
    if (m.pos_x == null || m.pos_y == null) continue; const pg = pegada(m), st = S?.maq?.[m.id]?.st || 'livre', x = +m.pos_x, y = +m.pos_y;
    const cor = ed ? '#ffffff' : COR[st], tc = ed ? '#1b2350' : (st === 'livre' ? '#1b2350' : '#fff'), fs = Math.min(.8, pg.w / 4, pg.d / 1.6 + .1);
    partes.push(`<g class="pl-el pl-maq ${sel === 'm:' + m.id ? 'sel' : ''} ${!ed && st === 'parada' ? 'pl-pulsa' : ''}" data-el="m:${m.id}" data-m="${m.id}">
      <rect x="${x}" y="${y}" width="${pg.w}" height="${pg.d}" rx=".2" fill="${cor}" stroke="${sel === 'm:' + m.id ? '#2a1f6f' : ed ? '#2b5598' : 'rgba(0,0,0,.25)'}" stroke-width="${sel === 'm:' + m.id ? .2 : .08}"/>
      <text x="${x + pg.w / 2}" y="${y + pg.d / 2 + fs * .2}" font-size="${fs}" text-anchor="middle" font-weight="800" fill="${tc}">${esc(m.codigo)}</text>
      ${!ed && pg.d > 1.4 ? `<text x="${x + pg.w / 2}" y="${y + pg.d / 2 + fs * .2 + fs * .95}" font-size="${fs * .62}" text-anchor="middle" fill="${tc}">${esc(textoMaquina(m, S))}</text>` : ''}
      ${ed ? `<text x="${x + pg.w / 2}" y="${y + pg.d / 2 + fs * .2 + fs * .9}" font-size="${fs * .55}" text-anchor="middle" fill="#5d6790">${esc((TIPOS_VISUAIS[m.tipo_visual] || TIPOS_VISUAIS.generica).t)}</text>` : ''}</g>`);
  }
  let vb = [-1, -1, L + 2, Pf + 2];
  if (!ed) { // acompanhamento: enquadra só o que foi montado
    const rs = [...els.filter(e => e.t !== 'seta'), ...maquinas.filter(m => m.pos_x != null).map(m => ({ x: +m.pos_x, y: +m.pos_y, ...pegada(m) }))];
    if (rs.length) { const x0 = Math.max(-1, Math.min(...rs.map(r => r.x)) - 1), y0 = Math.max(-1, Math.min(...rs.map(r => r.y)) - 1);
      const x1 = Math.min(L + 1, Math.max(...rs.map(r => r.x + r.w)) + 1), y1 = Math.min(Pf + 1, Math.max(...rs.map(r => r.y + r.d)) + 1); vb = [x0, y0, x1 - x0, y1 - y0]; }
  }
  return `<svg viewBox="${vb.join(' ')}" xmlns="http://www.w3.org/2000/svg" class="pl-baixa" font-family="Inter,system-ui,sans-serif">${partes.join('')}</svg>`;
}

// rascunho automático: setores do cadastro em faixas ao longo da largura, máquinas de cada setor em fila, setas na ordem do fluxo
export function rascunho(C, L, Pf) {
  const setores = C.setores.filter(s => s.ativo).sort((a, b) => a.ordem - b.ordem), els = [], pos = {};
  if (!setores.length) return { elementos: [], pos, L, Pf };
  const larg = setores.map(s => { const ms = C.maquinas.filter(m => m.ativo && m.setor_id === s.id); return Math.max(8, Math.max(0, ...ms.map(m => (TIPOS_VISUAIS[m.tipo_visual] || TIPOS_VISUAIS.generica).w)) + 3); });
  const alt = setores.map(s => { const ms = C.maquinas.filter(m => m.ativo && m.setor_id === s.id); return Math.max(8, ms.reduce((t, m) => t + (TIPOS_VISUAIS[m.tipo_visual] || TIPOS_VISUAIS.generica).d + 1.6, 1.4)); });
  const Lt = Math.max(L, larg.reduce((t, w) => t + w + 4, 2)), Pt = Math.max(Pf, Math.max(...alt) + 8);
  let x = 2;
  setores.forEach((s, i) => {
    const id = uid(); els.push({ id, t: 'setor', x, y: 2, w: larg[i], d: alt[i], nome: s.nome, setor_id: s.id });
    let y = 3; for (const m of C.maquinas.filter(mm => mm.ativo && mm.setor_id === s.id)) { pos[m.id] = { pos_x: x + 1.5, pos_y: y, rotacao: 0 }; y += (TIPOS_VISUAIS[m.tipo_visual] || TIPOS_VISUAIS.generica).d + 1.6; }
    if (i) els.push({ id: uid(), t: 'seta', de: els.filter(e => e.t === 'setor')[i - 1].id, para: id });
    x += larg[i] + 4;
  });
  els.push({ id: uid(), t: 'corredor', x: 1, y: Pt - 4.5, w: Lt - 2, d: 2.5 });
  return { elementos: els, pos, L: Lt, Pf: Pt };
}

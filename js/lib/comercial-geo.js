// Comercial — curva ABC, situação do cliente pelos parâmetros, ação sugerida e rotas de visita (melhoria 4.1, SQL 129).
// Só regras puras: nada aqui busca dado no banco.

export const CFG_PADRAO = { abc_a_pct: 80, abc_b_pct: 95, abc_meses: 12, esfriando_fator: 1.5, esfriando_min_dias: 20, inativo_dias: 180, novo_dias: 90,
  visita_dias_a: 30, visita_dias_b: 60, visita_dias_c: 120, acao_a: 'visita', acao_b: 'ligacao', acao_c: 'whatsapp', prazo_acao_dias: 7,
  origem_cod_municipio: null, visitas_por_dia: 5, km_por_dia: 300, fator_estrada: 1.25, raio_km: 250 };
export const ACOES = { visita: 'Visita', ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', reuniao: 'Reunião' };

const dias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
export const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** curva ABC por valor: A enquanto o acumulado ANTES do cliente for menor que a%, B até b%, o resto C; sem valor = sem classe */
export function curvaABC(itens, { abc_a_pct = 80, abc_b_pct = 95 } = {}) {
  const pos = itens.filter(x => +x.valor > 0).sort((a, b) => b.valor - a.valor || String(a.nome || '').localeCompare(String(b.nome || '')));
  const total = pos.reduce((s, x) => s + +x.valor, 0);
  let acum = 0;
  const lista = pos.map((x, i) => {
    const antes = total ? acum / total * 100 : 0; acum += +x.valor;
    const classe = antes < abc_a_pct ? 'A' : antes < abc_b_pct ? 'B' : 'C';
    return { ...x, rank: i + 1, pct: total ? +x.valor / total * 100 : 0, acum_pct: total ? acum / total * 100 : 0, classe };
  });
  const resumo = Object.fromEntries(['A', 'B', 'C'].map(k => { const l = lista.filter(x => x.classe === k), v = l.reduce((s, x) => s + +x.valor, 0);
    return [k, { n: l.length, valor: v, pct: total ? v / total * 100 : 0, pct_clientes: lista.length ? l.length / lista.length * 100 : 0 }]; }));
  return { lista, resumo, total, porId: Object.fromEntries(lista.map(x => [x.id, x.classe])) };
}

/** situação pelo histórico de compras e os parâmetros: ativo, novo, esfriando ou inativo */
export function situacao({ primeira, ultima, intervalo }, hoje, cfg = CFG_PADRAO) {
  if (!ultima) return 'sem';
  const desde = dias(ultima, hoje);
  if (desde > cfg.inativo_dias) return 'inativo';
  if (intervalo && desde > Math.max(cfg.esfriando_fator * intervalo, cfg.esfriando_min_dias)) return 'esfriando';
  if (primeira > addDias(hoje, -cfg.novo_dias)) return 'novo';
  return 'ativo';
}

/** ação sugerida para o cliente esfriando ou inativo, pela classe: { tipo, ate, texto } */
export function acaoSugerida({ classe, st, desde, intervalo }, hoje, cfg = CFG_PADRAO) {
  if (!['esfriando', 'inativo'].includes(st)) return null;
  const tipo = cfg['acao_' + String(classe || 'c').toLowerCase()] || 'ligacao';
  const prazo = st === 'inativo' ? cfg.prazo_acao_dias * 2 : classe === 'A' ? Math.min(cfg.prazo_acao_dias, 3) : cfg.prazo_acao_dias;
  const motivo = st === 'inativo' ? `sem comprar há ${desde} dias` : `sem comprar há ${desde} dias (o normal é a cada ${Math.round(intervalo)})`;
  const verbo = { visita: 'Visitar', ligacao: 'Ligar', whatsapp: 'Mandar WhatsApp', email: 'Mandar e-mail', reuniao: 'Marcar reunião' }[tipo];
  return { tipo, ate: addDias(hoje, prazo), texto: `${verbo}${classe ? ` (cliente ${classe})` : ''}: ${motivo}` };
}

/** clientes com visita vencida pela frequência da classe (sem visita registrada = vencida) */
export function visitasDevidas(clientes, hoje, cfg = CFG_PADRAO) {
  return clientes.filter(c => c.classe && (!c.ultima_visita || dias(c.ultima_visita.slice(0, 10), hoje) >= cfg['visita_dias_' + c.classe.toLowerCase()]))
    .map(c => ({ ...c, dias_sem_visita: c.ultima_visita ? dias(c.ultima_visita.slice(0, 10), hoje) : null }));
}

// ---------------------------------------------------------------- distâncias e rotas
/** km em linha reta */
export function km(a, b) {
  const R = 6371, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const kmE = (a, b, f) => km(a, b) * f;

/** dias de visita: só os clientes dentro do raio (os de fora: contato à distância); sai da origem, vai ao mais próximo ainda não visitado e fecha o dia quando passa do limite de visitas
 *  ou de km (contando a volta); cada dia é melhorado com 2-opt. Pontos sem coordenada ficam de fora (semLocal). */
export function montarRota(origem, pontos, cfg = CFG_PADRAO) {
  const f = +cfg.fator_estrada || 1, maxV = +cfg.visitas_por_dia || 5, maxKm = +cfg.km_por_dia || 300;
  const semLocal = pontos.filter(p => p.lat == null || p.lng == null), raio = +cfg.raio_km || Infinity;
  const comLocal = pontos.filter(p => p.lat != null && p.lng != null).map(p => ({ ...p, dist: Math.round(kmE(origem, p, f)) }));
  const foraRaio = comLocal.filter(p => p.dist > raio), resta = comLocal.filter(p => p.dist <= raio);
  const dias = [];
  while (resta.length) {
    let atual = origem, rodado = 0; const dia = [];
    while (resta.length && dia.length < maxV) {
      let melhor = -1, dm = Infinity;
      resta.forEach((p, i) => { const d = kmE(atual, p, f); if (d < dm) { dm = d; melhor = i; } });
      const volta = kmE(resta[melhor], origem, f);
      if (dia.length && rodado + dm + volta > maxKm) break;
      const p = resta.splice(melhor, 1)[0]; dia.push(p); rodado += dm; atual = p;
    }
    dias.push(doisOpt(origem, dia, f));
  }
  return { dias: dias.map(d => resumoDia(origem, d, f)), semLocal, foraRaio };
}
function custo(origem, seq, f) { let s = 0, a = origem; for (const p of seq) { s += kmE(a, p, f); a = p; } return s + kmE(a, origem, f); }
function doisOpt(origem, seq, f) {
  let melhor = seq.slice(), mc = custo(origem, melhor, f), mudou = true;
  while (mudou) {
    mudou = false;
    for (let i = 0; i < melhor.length - 1; i++) for (let j = i + 1; j < melhor.length; j++) {
      const t = [...melhor.slice(0, i), ...melhor.slice(i, j + 1).reverse(), ...melhor.slice(j + 1)], c = custo(origem, t, f);
      if (c < mc - 1e-6) { melhor = t; mc = c; mudou = true; }
    }
  }
  return melhor;
}
function resumoDia(origem, seq, f) {
  let a = origem, total = 0;
  const paradas = seq.map(p => { const d = kmE(a, p, f); total += d; a = p; return { ...p, km: Math.round(d) }; });
  const volta = Math.round(kmE(a, origem, f));
  return { paradas, volta, km: Math.round(total) + volta };
}

/** próximos dias úteis a partir de uma data (inclusive), pulando sábado e domingo */
export function diasUteis(inicio, n) {
  const out = []; let d = inicio;
  while (out.length < n) { const w = new Date(d + 'T12:00:00').getDay(); if (w !== 0 && w !== 6) out.push(d); d = addDias(d, 1); }
  return out;
}

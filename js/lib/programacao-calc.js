// Programação inteligente (melhoria 6.2): a sequência sugerida das etapas numa máquina.
// Regras:
//  • a entrega manda: a próxima OP sai das que vencem até "janela" dias depois da mais urgente que falta;
//  • dentro dessa janela, a escolhida é a de menor troca de cor a partir da anterior (cores novas × minutos por cor,
//    + limpeza quando vai do escuro para o claro); empate: a mais clara, depois a entrega e a prioridade;
//  • etapas com impedimento vão para o fim, na ordem de entrega, marcadas como bloqueadas.
// Funções puras (testes em tests/programacao-calc.test.js).

const DIA = 864e5;
const dataNum = (s) => (s ? Date.parse(String(s).slice(0, 10) + 'T12:00:00Z') : Infinity);
const maxEsc = (it) => (it?.cores?.length ? Math.max(...it.cores.map(c => +c.esc || 0)) : null);

/** Minutos de troca da etapa a para a b (a nula: começa limpa). */
export function troca(a, b, cfg) {
  if (!b?.cores?.length) return 0;
  const tem = new Set((a?.cores || []).map(c => c.id));
  const novas = b.cores.filter(c => !tem.has(c.id)).length;
  let min = novas * (+cfg.troca_cor_min || 0);
  const ea = maxEsc(a), eb = maxEsc(b);
  if (ea != null && eb != null && ea - eb > 25) min += +cfg.limpeza_escuro_claro_min || 0;
  return min;
}

const ordemEntrega = (a, b) => dataNum(a.entrega) - dataNum(b.entrega) || (a.prioridade || 3) - (b.prioridade || 3) || (a.numero || 0) - (b.numero || 0);

/** Soma das trocas de uma fila na ordem dada. */
export function totalTrocas(fila, cfg, atual = null) {
  let ant = atual, t = 0;
  for (const it of fila) { t += troca(ant, it, cfg); ant = it.cores?.length ? it : ant; }
  return t;
}

/** Sequência sugerida. itens: {id, numero, entrega, prioridade, cores:[{id, esc}], horas, bloqueada}.
 *  ctx {inicio, horasDia}: com ele, a cor não passa uma OP na frente se isso fizer a mais urgente atrasar. */
export function sequenciar(itens, cfg, atual = null, ctx = null) {
  const janela = (+cfg.janela_entrega_dias || 0) * DIA;
  const prontas = itens.filter(i => !i.bloqueada).sort(ordemEntrega), bloq = itens.filter(i => i.bloqueada).sort(ordemEntrega);
  const fila = []; let ant = atual, t = 0;
  const hd = Math.max(+ctx?.horasDia || 24, 1), prazoH = (it) => (ctx?.inicio && it.entrega ? ((dataNum(it.entrega) - dataNum(ctx.inicio)) / DIA + 1) * hd : Infinity);
  const dur = (de, it) => (+it.horas || 0) + troca(de, it, cfg) / 60;
  while (prontas.length) {
    const ancora = prontas[0], lim = dataNum(ancora.entrega) + janela;
    // prioridade 1 (urgente) não espera troca de cor
    const cands = ancora.prioridade === 1 ? [ancora] : prontas.filter(i => dataNum(i.entrega) <= lim && (i.prioridade || 3) > 1 || i === ancora);
    cands.sort((a, b) => troca(ant, a, cfg) - troca(ant, b, cfg) || (maxEsc(a) ?? -1) - (maxEsc(b) ?? -1) || ordemEntrega(a, b));
    let esc = cands[0];
    // passar na frente não pode atrasar a mais urgente
    if (esc !== ancora && t + dur(ant, esc) + dur(esc.cores?.length ? esc : ant, ancora) > prazoH(ancora)) esc = ancora;
    t += dur(ant, esc);
    prontas.splice(prontas.indexOf(esc), 1);
    fila.push({ ...esc, troca: troca(ant, esc, cfg) });
    if (esc.cores?.length) ant = esc;
  }
  bloq.forEach(b => { fila.push({ ...b, troca: troca(ant, b, cfg) }); if (b.cores?.length) ant = b; });
  const base = totalTrocas([...itens.filter(i => !i.bloqueada).sort(ordemEntrega), ...bloq], cfg, atual);
  const total = fila.reduce((t, i) => t + i.troca, 0);
  return { fila, trocaTotal: total, trocaBase: base, economiaMin: Math.max(0, base - total) };
}

/** Datas previstas: enche cada dia até horasDia (as trocas entram no tempo). Mesma regra do prod_prog_aplicar. */
export function distribuir(fila, inicio, horasDia) {
  const hd = Math.max(+horasDia || 24, 1); let dia = dataNum(inicio), usado = 0;
  return fila.map(it => {
    const h = (+it.horas || 0) + (it.troca || 0) / 60;
    if (usado > 0 && usado + h > hd) { dia += DIA; usado = 0; }
    const ini = dia; usado += h;
    while (usado > hd) { dia += DIA; usado -= hd; }
    const fim = usado === 0 ? dia - DIA : dia, iso = (t) => new Date(t).toISOString().slice(0, 10);
    return { ...it, inicio: iso(ini), fim: iso(Math.max(fim, ini)), atrasa: !!it.entrega && iso(Math.max(fim, ini)) > String(it.entrega).slice(0, 10) };
  });
}

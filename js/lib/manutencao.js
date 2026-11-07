// Manutenção industrial (SQL 086) — regras puras, sem acesso ao banco (tests/manutencao.test.js).
// Indicadores no período: falhas = OS corretivas que pararam a máquina; horas paradas = soma das paradas das OS dentro do período;
// MTTR = horas paradas ÷ falhas; MTBF = (horas do período − horas paradas) ÷ falhas; disponibilidade = 1 − paradas ÷ horas do período.

export const TIPOS_OS = { corretiva: 'Corretiva', preventiva: 'Preventiva', lubrificacao: 'Lubrificação', inspecao: 'Inspeção', preditiva: 'Preditiva', calibracao: 'Calibração', melhoria: 'Melhoria' };
export const SITUACOES = { solicitada: 'Solicitada', aberta: 'Aberta', programada: 'Programada', em_execucao: 'Em execução', aguardando_peca: 'Aguardando peça',
  aguardando_terceiro: 'Aguardando terceiro', concluida: 'Concluída', cancelada: 'Cancelada' };
export const ABERTAS = ['solicitada', 'aberta', 'programada', 'em_execucao', 'aguardando_peca', 'aguardando_terceiro'];
export const PRIORIDADES = { emergencia: 'Emergência', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
export const ORDEM_PRIO = { emergencia: 0, alta: 1, media: 2, baixa: 3 };
export const TIPOS_EQUIP = { maquina: 'Máquina de produção', utilidade: 'Utilidade (compressor, gerador, chiller)', predial: 'Predial', movimentacao: 'Movimentação (empilhadeira, ponte)',
  instrumento: 'Instrumento de medição', ferramenta: 'Ferramenta / dispositivo', outro: 'Outro' };
export const SIT_EQUIP = { operando: 'Operando', em_manutencao: 'Em manutenção', parado: 'Parado', inativo: 'Inativo' };
export const CATEGORIAS = { mecanica: 'Mecânica', eletrica: 'Elétrica', eletronica: 'Eletrônica', hidraulica: 'Hidráulica', pneumatica: 'Pneumática', lubrificacao: 'Lubrificação',
  operacional: 'Operacional', instrumentacao: 'Instrumentação', outra: 'Outra' };
export const TIPOS_PLANO = { preventiva: 'Preventiva', lubrificacao: 'Lubrificação', inspecao: 'Inspeção', preditiva: 'Preditiva', calibracao: 'Calibração' };
const PREVENTIVOS = ['preventiva', 'lubrificacao', 'inspecao', 'preditiva', 'calibracao'];

const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round((+v + Number.EPSILON) * 100) / 100;
const ms = (d) => d instanceof Date ? d.getTime() : new Date(String(d).length === 10 ? d + 'T00:00:00' : d).getTime();
/** horas entre duas datas/horas (fim vazio = agora) */
export const horasEntre = (a, b, agora = Date.now()) => a ? Math.max(0, ((b ? ms(b) : agora) - ms(a)) / 3600000) : 0;
/** horas de [a, b] dentro de [de, ate] */
export function horasDentro(a, b, de, ate, agora = Date.now()) {
  if (!a) return 0;
  const x = Math.max(ms(a), ms(de)), y = Math.min(b ? ms(b) : agora, ms(ate));
  return y > x ? (y - x) / 3600000 : 0;
}

/** custo da OS: peças (consumidas) + mão de obra (horas × custo da hora) + terceiros */
export function custoOS(os, horas = [], pecas = [], custoHora = 0) {
  const mao = horas.filter(h => h.ordem_id === os.id).reduce((s, h) => s + +h.horas * +(h.custo_hora ?? custoHora), 0);
  const pc = pecas.filter(p => p.ordem_id === os.id && p.situacao !== 'estornada').reduce((s, p) => s + +(p.custo || 0), 0);
  const ter = +(os.valor_terceiros || 0);
  return { pecas: r2(pc), mao: r2(mao), terceiros: r2(ter), total: r2(pc + mao + ter), horas: r1(horas.filter(h => h.ordem_id === os.id).reduce((s, h) => s + +h.horas, 0)) };
}

/** indicadores de um conjunto de OS (de um equipamento ou de todos) no período [de, ate] */
export function indicadores(ordens, { de, ate, nEquip = 1, agora = Date.now(), tolerancia = 10 } = {}) {
  const horasPeriodo = Math.max(0, (ms(ate) - ms(de)) / 3600000) * Math.max(1, nEquip);
  const noPer = ordens.filter(o => ms(o.solicitada_em) <= ms(ate) && (!o.fim || ms(o.fim) >= ms(de)) && o.situacao !== 'cancelada');
  const falhas = noPer.filter(o => o.tipo === 'corretiva' && o.maquina_parou && ms(o.parada_inicio || o.solicitada_em) >= ms(de) && ms(o.parada_inicio || o.solicitada_em) <= ms(ate));
  const paradas = noPer.filter(o => o.maquina_parou).reduce((s, o) => s + horasDentro(o.parada_inicio || o.inicio || o.solicitada_em, o.parada_fim || o.fim, de, ate, agora), 0);
  const parCorr = falhas.reduce((s, o) => s + horasEntre(o.parada_inicio || o.solicitada_em, o.parada_fim || o.fim, agora), 0);
  const concl = ordens.filter(o => o.situacao === 'concluida' && o.fim && ms(o.fim) >= ms(de) && ms(o.fim) <= ms(ate));
  const prevConcl = concl.filter(o => PREVENTIVOS.includes(o.tipo));
  const prevVenc = ordens.filter(o => PREVENTIVOS.includes(o.tipo) && o.vence_em && ms(o.vence_em) >= ms(de) && ms(o.vence_em) <= ms(ate) && o.situacao !== 'cancelada');
  const noPrazo = prevVenc.filter(o => o.situacao === 'concluida' && o.fim && ms(o.fim) <= ms(o.vence_em) + tolerancia / 100 * 30 * 86400000 + 86400000);
  return {
    falhas: falhas.length, horasParadas: r1(paradas), horasPeriodo: r1(horasPeriodo),
    disponibilidade: horasPeriodo ? Math.max(0, 1 - paradas / horasPeriodo) : 1,
    mttr: falhas.length ? r1(parCorr / falhas.length) : null,
    mtbf: falhas.length ? r1((horasPeriodo - paradas) / falhas.length) : null,
    concluidas: concl.length, pctPreventiva: concl.length ? prevConcl.length / concl.length : null,
    aderencia: prevVenc.length ? noPrazo.length / prevVenc.length : null, preventivasNoPeriodo: prevVenc.length,
  };
}

/** situação de um plano: próxima data e/ou horas restantes */
export function statusPlano(p, horasAtuais = 0, hoje = new Date().toISOString().slice(0, 10)) {
  const out = { prox: null, horasRest: null, nivel: 'ok', txt: '' };
  if (p.a_cada_dias) {
    if (!p.ultima_data) { out.prox = hoje; out.nivel = 'warn'; out.txt = 'nunca executado'; }
    else { const d = new Date(p.ultima_data + 'T00:00:00'); d.setDate(d.getDate() + +p.a_cada_dias); out.prox = d.toISOString().slice(0, 10); }
  }
  if (p.a_cada_horas) out.horasRest = r1(+p.a_cada_horas - (+horasAtuais - +(p.ultima_horas || 0)));
  const dias = out.prox ? Math.round((ms(out.prox) - ms(hoje)) / 86400000) : null;
  const txts = [];
  if (dias != null && p.ultima_data) txts.push(dias < 0 ? `vencido há ${-dias} dia(s)` : dias === 0 ? 'vence hoje' : `vence em ${dias} dia(s)`);
  if (out.horasRest != null) txts.push(out.horasRest < 0 ? `${-out.horasRest} h além do intervalo` : `faltam ${out.horasRest} h de máquina`);
  if (txts.length) out.txt = [out.txt, ...txts].filter(Boolean).join(' · ');
  if ((dias != null && dias < 0 && p.ultima_data) || (out.horasRest != null && out.horasRest < 0)) out.nivel = 'neg';
  else if ((dias != null && dias <= 7) || (out.horasRest != null && out.horasRest <= +p.a_cada_horas * 0.1)) out.nivel = 'warn';
  return out;
}

/** OS atrasada: preventiva além do vencimento ou corretiva de emergência/alta aberta há mais de 24 h / 72 h */
export function atrasada(o, agora = Date.now()) {
  if (!ABERTAS.includes(o.situacao)) return false;
  if (o.vence_em) return ms(o.vence_em) + 86400000 < agora;
  const h = horasEntre(o.solicitada_em, null, agora);
  return (o.prioridade === 'emergencia' && h > 24) || (o.prioridade === 'alta' && h > 72);
}

/** Pareto das falhas (OS corretivas concluídas com falha) — por quantidade e horas paradas */
export function pareto(ordens, falhas = [], agora = Date.now()) {
  const fById = Object.fromEntries(falhas.map(f => [f.id, f])), m = {};
  for (const o of ordens.filter(x => x.tipo === 'corretiva' && x.situacao !== 'cancelada')) {
    const k = o.falha_id || '-'; (m[k] ||= { falha_id: o.falha_id, nome: fById[o.falha_id]?.nome || 'Sem falha informada', categoria: fById[o.falha_id]?.categoria || null, n: 0, horas: 0 });
    m[k].n++; if (o.maquina_parou) m[k].horas += horasEntre(o.parada_inicio || o.solicitada_em, o.parada_fim || o.fim, agora);
  }
  const L = Object.values(m).sort((a, b) => b.horas - a.horas || b.n - a.n), tot = L.reduce((s, x) => s + x.horas, 0); let ac = 0;
  return L.map(x => { ac += x.horas; return { ...x, horas: r1(x.horas), acumulado: tot ? ac / tot : 0 }; });
}

/** ordem da fila: prioridade, atrasada primeiro, depois a mais antiga */
export const fila = (ordens, agora = Date.now()) => ordens.filter(o => ABERTAS.includes(o.situacao))
  .sort((a, b) => ORDEM_PRIO[a.prioridade] - ORDEM_PRIO[b.prioridade] || atrasada(b, agora) - atrasada(a, agora) || ms(a.programada_para || a.solicitada_em) - ms(b.programada_para || b.solicitada_em));

/** alertas para o Decision Center */
export function alertas({ ordens = [], planos = [], horasPorEquip = {}, hoje, agora = Date.now() }) {
  const out = [], ab = ordens.filter(o => ABERTAS.includes(o.situacao));
  const em = ab.filter(o => o.prioridade === 'emergencia'); if (em.length) out.push({ nivel: 'neg', k: 'emergencia', txt: `${em.length} OS de emergência aberta(s)` });
  const atr = ab.filter(o => atrasada(o, agora)); if (atr.length) out.push({ nivel: 'neg', k: 'atrasadas', txt: `${atr.length} OS atrasada(s)` });
  const pec = ab.filter(o => o.situacao === 'aguardando_peca' && horasEntre(o.atualizado_em || o.solicitada_em, null, agora) > 72);
  if (pec.length) out.push({ nivel: 'warn', k: 'peca', txt: `${pec.length} OS aguardando peça há mais de 3 dias` });
  const venc = planos.filter(p => p.ativo !== false && statusPlano(p, horasPorEquip[p.equipamento_id] || 0, hoje).nivel === 'neg' && !ab.some(o => o.plano_id === p.id));
  if (venc.length) out.push({ nivel: 'warn', k: 'planos', txt: `${venc.length} plano(s) preventivo(s) vencido(s) sem OS — gere as preventivas` });
  return out;
}

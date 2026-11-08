// Qualidade (SQL 087) — regras puras: avaliação das medições (com Cp/Cpk), sugestão de decisão pela amostragem, IQF do fornecedor,
// indicadores, Pareto e alertas. Nenhuma função aqui busca dado no banco.

export const ETAPAS = { recebimento: 'Recebimento', processo: 'Processo', final: 'Final' };
export const ORIGENS = { nfe: 'Nota de entrada', estoque: 'Estoque', liberacao: 'Liberação do primeiro material', op: 'Ordem de produção', manual: 'Manual', reclamacao: 'Reclamação' };
export const SITUACOES = { pendente: 'Pendente', em_inspecao: 'Em inspeção', aprovada: 'Aprovada', aprovada_concessao: 'Aprovada com concessão', reprovada: 'Reprovada', cancelada: 'Cancelada' };
export const ABERTAS = ['pendente', 'em_inspecao'];
export const DECIDIDAS = ['aprovada', 'aprovada_concessao', 'reprovada'];
export const AMOSTRAGEM = { tabela: 'Pela tabela (tamanho do lote)', fixa: 'Amostra fixa', cem: '100% (todas as unidades)' };
export const TIPOS_CARAC = { medida: 'Medida (valor)', atributo: 'Atributo (defeitos)' };
export const ORIGENS_RNC = { inspecao: 'Inspeção', processo: 'Processo', cliente: 'Reclamação de cliente', fornecedor: 'Fornecedor', interna: 'Interna', auditoria: 'Auditoria' };
export const SIT_RNC = { aberta: 'Aberta', em_analise: 'Em análise', acao: 'Ação em andamento', verificacao: 'Verificação de eficácia', encerrada: 'Encerrada', cancelada: 'Cancelada' };
export const RNC_ABERTAS = ['aberta', 'em_analise', 'acao', 'verificacao'];
export const GRAVIDADES = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };
export const DISPOSICOES = { pendente: 'Pendente', usar_como_esta: 'Usar como está (concessão)', retrabalho: 'Retrabalhar', reclassificar: 'Reclassificar (2ª linha)', sucatear: 'Sucatear', devolver_fornecedor: 'Devolver ao fornecedor' };

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(String(d).length === 10 ? d + 'T12:00:00' : d).getTime());
const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const r = (v, c = 2) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** c) / 10 ** c);

/** um valor medido está dentro da especificação? (sem mínimo ou máximo, o lado aberto passa) */
export function dentro(car, v) {
  const x = num(v); if (x == null) return null;
  const mn = num(car.min), mx = num(car.max);
  return (mn == null || x >= mn) && (mx == null || x <= mx);
}

/** estatística das medições: média, desvio, mínimo, máximo, fora, Cp e Cpk (com 5 medições ou mais e os dois limites) */
export function estatistica(car, valores = []) {
  const xs = valores.map(num).filter(v => v != null);
  if (!xs.length) return { n: 0, fora: 0 };
  const n = xs.length, media = xs.reduce((s, v) => s + v, 0) / n;
  const dp = n > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1)) : 0;
  const mn = num(car.min), mx = num(car.max), fora = xs.filter(v => dentro(car, v) === false).length;
  let cp = null, cpk = null;
  if (n >= 5 && dp > 0 && mn != null && mx != null) { cp = (mx - mn) / (6 * dp); cpk = Math.min(mx - media, media - mn) / (3 * dp); }
  return { n, media: r(media, 4), dp: r(dp, 4), min: Math.min(...xs), max: Math.max(...xs), fora, cp: r(cp), cpk: r(cpk) };
}

/** avalia os resultados contra as características do plano: cada linha com ok, defeitos e a estatística */
export function avaliar(caracteristicas = [], resultados = []) {
  const porNome = Object.fromEntries(resultados.map(x => [x.nome, x]));
  const linhas = caracteristicas.map(c => {
    const res = porNome[c.nome] || {};
    if (c.tipo === 'atributo') {
      const d = num(res.defeitos);
      return { nome: c.nome, tipo: 'atributo', critica: !!c.critica, defeitos: d ?? 0, preenchido: d != null || res.ok != null, ok: d == null ? (res.ok ?? null) : d === 0 };
    }
    const est = estatistica(c, res.valores || []);
    return { nome: c.nome, tipo: 'medida', critica: !!c.critica, ...est, defeitos: est.fora, preenchido: est.n > 0, ok: est.n ? est.fora === 0 : null };
  });
  const defeitos = linhas.reduce((s, l) => s + (l.defeitos || 0), 0);
  return { linhas, defeitos, completas: linhas.every(l => l.preenchido), criticaFora: linhas.some(l => l.critica && l.ok === false) };
}

/** sugestão de decisão: característica crítica fora → reprova; defeitos ≥ Re → reprova; ≤ Ac → aprova; laudo exigido e ausente → pendente */
export function sugestao(insp, aval, { exigeLaudo = false } = {}) {
  if (!aval.linhas.length) return { decisao: null, txt: 'O plano não tem características: decida pela inspeção visual.' };
  if (!aval.completas) return { decisao: null, txt: 'Faltam resultados para sugerir a decisão.' };
  if (aval.criticaFora) return { decisao: 'reprovada', txt: 'Característica crítica fora da especificação.' };
  const ac = insp.ac ?? 0, re = insp.re ?? ac + 1;
  if (aval.defeitos >= re) return { decisao: 'reprovada', txt: `${aval.defeitos} defeito(s): atinge o número de rejeição (Re ${re}).` };
  if (exigeLaudo && !insp.laudo_ok) return { decisao: null, txt: 'Resultados dentro, mas falta conferir o laudo do fornecedor.' };
  if (aval.defeitos <= ac) return { decisao: 'aprovada', txt: aval.defeitos ? `${aval.defeitos} defeito(s), dentro do aceite (Ac ${ac}).` : 'Todas as características dentro da especificação.' };
  return { decisao: null, txt: 'Entre o aceite e a rejeição: decida pela análise.' };
}

/** IQF do fornecedor: aprovadas = 100, concessão = 50, reprovada = 0, na média das inspeções decididas */
export function iqf(inspecoes = []) {
  const d = inspecoes.filter(i => DECIDIDAS.includes(i.situacao));
  if (!d.length) return null;
  return r(d.reduce((s, i) => s + (i.situacao === 'aprovada' ? 100 : i.situacao === 'aprovada_concessao' ? 50 : 0), 0) / d.length, 1);
}
export function rankingFornecedores(inspecoes = [], nomes = {}) {
  const g = {};
  for (const i of inspecoes.filter(x => x.etapa === 'recebimento' && x.fornecedor_id)) (g[i.fornecedor_id] ||= []).push(i);
  return Object.entries(g).map(([id, L]) => ({ id, nome: nomes[id] || id, iqf: iqf(L), lotes: L.filter(i => DECIDIDAS.includes(i.situacao)).length,
    reprovados: L.filter(i => i.situacao === 'reprovada').length, concessoes: L.filter(i => i.situacao === 'aprovada_concessao').length }))
    .filter(x => x.iqf != null).sort((a, b) => a.iqf - b.iqf || b.lotes - a.lotes);
}

export const atrasada = (i, agora = Date.now()) => ABERTAS.includes(i.situacao) && i.prazo && ms(i.prazo) < agora;
export const rncVencida = (x, hoje = new Date().toISOString().slice(0, 10)) => RNC_ABERTAS.includes(x.situacao) && x.prazo && x.prazo < hoje;

/** indicadores do período [de, ate] (inspeções decididas e RNC abertas no período) */
export function indicadores(inspecoes = [], rncs = [], { de, ate, agora = Date.now() } = {}) {
  const per = (t) => t && ms(t) >= ms(de) && ms(t) <= ms(ate);
  const dec = inspecoes.filter(i => DECIDIDAS.includes(i.situacao) && per(i.decidida_em));
  const ap = dec.filter(i => i.situacao === 'aprovada').length, co = dec.filter(i => i.situacao === 'aprovada_concessao').length;
  const tempos = dec.filter(i => i.criado_em && i.decidida_em).map(i => (ms(i.decidida_em) - ms(i.criado_em)) / 3600000);
  const rp = rncs.filter(x => per(x.aberta_em));
  return {
    pendentes: inspecoes.filter(i => ABERTAS.includes(i.situacao)).length,
    atrasadas: inspecoes.filter(i => atrasada(i, agora)).length,
    decididas: dec.length, aprovacao: dec.length ? ap / dec.length : null, concessao: dec.length ? co / dec.length : null,
    reprovadas: dec.filter(i => i.situacao === 'reprovada').length,
    tempoMedio: tempos.length ? r(tempos.reduce((s, v) => s + v, 0) / tempos.length, 1) : null,
    rncAbertas: rncs.filter(x => RNC_ABERTAS.includes(x.situacao)).length,
    rncVencidas: rncs.filter(x => rncVencida(x, new Date(agora).toISOString().slice(0, 10))).length,
    rncNoPeriodo: rp.length, custo: r(rp.reduce((s, x) => s + +(x.custo || 0), 0)),
  };
}

/** Pareto das características reprovadas (resultados das inspeções decididas) */
export function pareto(inspecoes = [], planos = {}) {
  const m = {};
  for (const i of inspecoes.filter(x => DECIDIDAS.includes(x.situacao))) {
    const pl = planos[i.plano_id]; if (!pl) continue;
    for (const l of avaliar(pl.caracteristicas || [], i.resultados || []).linhas.filter(l => l.ok === false)) {
      (m[l.nome] ||= { nome: l.nome, n: 0, defeitos: 0 }); m[l.nome].n++; m[l.nome].defeitos += l.defeitos || 1;
    }
  }
  const L = Object.values(m).sort((a, b) => b.n - a.n || b.defeitos - a.defeitos), tot = L.reduce((s, x) => s + x.n, 0); let ac = 0;
  return L.map(x => { ac += x.n; return { ...x, acumulado: tot ? ac / tot : 0 }; });
}

/** fila de inspeção: atrasadas, liberação de máquina (para a produção), depois a mais antiga */
export const fila = (inspecoes = [], agora = Date.now()) => inspecoes.filter(i => ABERTAS.includes(i.situacao))
  .sort((a, b) => atrasada(b, agora) - atrasada(a, agora) || (b.origem === 'liberacao') - (a.origem === 'liberacao') || ms(a.prazo || a.criado_em) - ms(b.prazo || b.criado_em));

/** alertas para o Decision Center */
export function alertas({ inspecoes = [], rncs = [], quarentena = 0, bloqueados = 0, ranking = [], meta = 95, agora = Date.now() }) {
  const out = [], at = inspecoes.filter(i => atrasada(i, agora));
  const lib = inspecoes.filter(i => ABERTAS.includes(i.situacao) && i.origem === 'liberacao');
  if (lib.length) out.push({ nivel: 'neg', k: 'liberacao', txt: `${lib.length} máquina(s) aguardando a liberação do primeiro material` });
  if (at.length) out.push({ nivel: 'neg', k: 'atrasadas', txt: `${at.length} inspeção(ões) fora do prazo` });
  if (quarentena > 0) out.push({ nivel: 'warn', k: 'quarentena', txt: `R$ ${Math.round(quarentena).toLocaleString('pt-BR')} em quarentena aguardando inspeção` });
  const vc = rncs.filter(x => rncVencida(x, new Date(agora).toISOString().slice(0, 10)));
  if (vc.length) out.push({ nivel: 'warn', k: 'rnc', txt: `${vc.length} não conformidade(s) com a ação vencida` });
  const disp = rncs.filter(x => RNC_ABERTAS.includes(x.situacao) && x.disposicao === 'pendente' && x.quantidade);
  if (disp.length) out.push({ nivel: 'warn', k: 'disposicao', txt: `${disp.length} RNC com material aguardando disposição` });
  const ruins = ranking.filter(f => f.lotes >= 3 && f.iqf < meta);
  if (ruins.length) out.push({ nivel: 'warn', k: 'iqf', txt: `${ruins.length} fornecedor(es) abaixo da meta de qualidade (IQF ${meta})` });
  if (bloqueados > 0) out.push({ nivel: 'warn', k: 'bloqueados', txt: `${bloqueados} lote(s)/bobina(s) bloqueados pela qualidade` });
  return out;
}

// ---------------------------------------------------------------- reclamação pelo Portal (melhoria 6.6)
/** situação da reclamação como o cliente vê */
export const SIT_CLIENTE = { aberta: 'Recebida', em_analise: 'Em análise', acao: 'Ação em andamento', verificacao: 'Verificando a eficácia', encerrada: 'Encerrada', cancelada: 'Cancelada' };
/** os 8 passos (8D) a partir dos campos da RNC: { d, titulo, texto, feito } */
export function passos8D(x = {}) {
  const pq = (x.porques || []).filter(Boolean);
  const causa = [x.causa, pq.length ? 'Por quês: ' + pq.map((p, i) => `${i + 1}) ${p}`).join(' ') : ''].filter(Boolean).join(' — ');
  const impl = x.corretiva ? [x.prazo ? `Prazo ${String(x.prazo).slice(0, 10).split('-').reverse().join('/')}` : '', x.eficacia === 'eficaz' ? 'eficácia verificada' : x.eficacia === 'nao_eficaz' ? 'ação não foi eficaz: nova ação em estudo' : ''].filter(Boolean).join(' · ') : '';
  return [
    { d: 'D1', titulo: 'Equipe', texto: x.equipe || '' },
    { d: 'D2', titulo: 'Descrição do problema', texto: x.descricao || '' },
    { d: 'D3', titulo: 'Contenção (ação imediata)', texto: x.contencao || '' },
    { d: 'D4', titulo: 'Causa raiz', texto: causa },
    { d: 'D5', titulo: 'Ação corretiva', texto: x.corretiva || '' },
    { d: 'D6', titulo: 'Implementação e eficácia', texto: impl, feito: x.eficacia === 'eficaz' },
    { d: 'D7', titulo: 'Prevenção (para não repetir)', texto: x.prevencao || '' },
    { d: 'D8', titulo: 'Encerramento', texto: x.encerrada_em ? `Encerrada em ${String(x.encerrada_em).slice(0, 10).split('-').reverse().join('/')}` : '', feito: !!x.encerrada_em },
  ].map(p => ({ ...p, feito: p.feito ?? !!p.texto }));
}
/** resposta ao cliente atrasada: sem resposta e o prazo passou */
export const respostaAtrasada = (r, hoje = new Date().toISOString().slice(0, 10)) => !!(r.portal_visivel && !r.respondida_em && r.prazo_resposta && r.prazo_resposta < hoje && !['encerrada', 'cancelada'].includes(r.situacao));

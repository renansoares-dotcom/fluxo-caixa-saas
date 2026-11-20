// Análise de Problemas (PAI013, SQL 172): regras puras das quatro ferramentas — Pareto, Ishikawa, 5 Porquês e 5W2H.
// Nada aqui busca dado no banco nem toca na tela: os desenhos saem como texto SVG, para a tela, a impressão e os testes usarem o mesmo.

export const SIT = { aberto: ['Aberto', ''], em_analise: ['Em análise', 'info'], em_acao: ['Em ação', 'warn'], verificacao: ['Verificar eficácia', 'info'], encerrado: ['Encerrado', 'pos'], cancelado: ['Cancelado', ''] };
export const GRAV = { baixa: ['Baixa', ''], media: ['Média', 'info'], alta: ['Alta', 'warn'], critica: ['Crítica', 'neg'] };
export const SIT_ACAO = { pendente: ['Pendente', ''], em_andamento: ['Em andamento', 'info'], concluida: ['Concluída', 'pos'], cancelada: ['Cancelada', ''] };
export const ORIGEM = { manual: 'Aberto na tela', pareto: 'Pareto', rnc: 'Não conformidade', manutencao: 'Ordem de manutenção', parada: 'Parada de máquina' };
export const CATEGORIAS = ['Método', 'Máquina', 'Mão de obra', 'Material', 'Medida', 'Meio ambiente'];
export const AREAS = ['Produção', 'Qualidade', 'Manutenção', 'Logística', 'Comercial', 'Compras', 'Financeiro', 'Fiscal', 'RH', 'Outra'];
export const CFG0 = { categorias: CATEGORIAS, areas: AREAS, exige_causa: true, exige_acao: true, exige_eficacia: true, dias_aviso: 2, avisar_atraso: true, pareto_corte: 80 };

/** fontes do Pareto automático (função prob_pareto). financeiro = só administrador, financeiro e diretor */
export const FONTES = [
  { k: 'paradas', nome: 'Paradas de máquina', unidade: 'h', medida: 'Horas paradas por motivo', area: 'Produção' },
  { k: 'refugos', nome: 'Refugos', unidade: 'kg', medida: 'Quilos de refugo por motivo', area: 'Produção' },
  { k: 'falhas', nome: 'Falhas de manutenção', unidade: 'OS', medida: 'Ordens corretivas por tipo de falha', area: 'Manutenção' },
  { k: 'rnc_produto', nome: 'Não conformidades por produto', unidade: 'RNC', medida: 'Quantidade de RNC por produto', area: 'Qualidade' },
  { k: 'rnc_custo', nome: 'Custo da não qualidade', unidade: 'R$', medida: 'Custo das RNC por origem', area: 'Qualidade' },
  { k: 'devolucoes', nome: 'Devoluções de clientes', unidade: 'R$', medida: 'Valor devolvido por cliente', area: 'Comercial' },
  { k: 'entregas_atraso', nome: 'Entregas fora do prazo', unidade: 'entregas', medida: 'Entregas fora do prazo por cliente', area: 'Logística' },
  { k: 'ocorrencias', nome: 'Ocorrências de entrega', unidade: 'ocorrências', medida: 'Ocorrências de entrega por tipo', area: 'Logística' },
  { k: 'atraso_fornecedor', nome: 'Pedidos de compra atrasados', unidade: 'pedidos', medida: 'Pedidos recebidos depois do previsto por fornecedor', area: 'Compras' },
  { k: 'vencidos', nome: 'Títulos a receber vencidos', unidade: 'R$', medida: 'Valor vencido e em aberto por cliente', area: 'Financeiro', financeiro: true },
];

const n = (v) => { const x = +v; return Number.isFinite(x) ? x : 0; };
const r1 = (v) => Math.round(v * 10) / 10;
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cortar = (s, k) => { s = String(s ?? ''); return s.length > k ? s.slice(0, k - 1).trimEnd() + '…' : s; };
export const numBR = (v, d = 0) => n(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const valorTxt = (v, unidade) => unidade === 'R$' ? 'R$ ' + numBR(v, 2) : `${numBR(v, n(v) % 1 ? 1 : 0)} ${unidade || ''}`.trim();

/* ---------------------------------------------------------------- Pareto */

/**
 * Ordena do maior para o menor, calcula a participação e o acumulado e marca os "poucos vitais":
 * os itens que, somados, chegam ao corte (80% por padrão). O item que cruza o corte entra nos vitais.
 * itens: [{ nome, valor }]  →  { linhas: [{ nome, valor, pct, acumulado, vital, qtd }], total, vitais, corte }
 */
export function pareto(itens = [], corte = 80, maxLinhas = 12) {
  const m = new Map();
  for (const i of itens) { const nome = String(i?.nome ?? '').trim(), v = n(i?.valor); if (!nome || v <= 0) continue; const a = m.get(nome) || { nome, valor: 0, qtd: 0 }; a.valor += v; a.qtd += n(i.qtd) || 0; m.set(nome, a); }
  let L = [...m.values()].sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome));
  if (L.length > maxLinhas) { const resto = L.slice(maxLinhas - 1); L = [...L.slice(0, maxLinhas - 1), { nome: `Outros (${resto.length})`, valor: resto.reduce((s, x) => s + x.valor, 0), qtd: resto.reduce((s, x) => s + x.qtd, 0), outros: true }]; }
  const total = L.reduce((s, x) => s + x.valor, 0); let ac = 0, vitais = 0;
  const linhas = L.map(x => { const antes = ac; ac += x.valor; const vital = total > 0 && antes / total * 100 < corte && !x.outros; if (vital) vitais++; return { ...x, pct: total ? x.valor / total * 100 : 0, acumulado: total ? ac / total * 100 : 0, vital }; });
  return { linhas, total, vitais, corte };
}

/** frase que resume o Pareto: "3 de 9 motivos respondem por 81% (...)" */
export function paretoFrase(P, unidade) {
  if (!P.linhas.length) return 'Sem dados para o Pareto.';
  const v = P.linhas.filter(x => x.vital), ac = v.length ? v[v.length - 1].acumulado : 0;
  return `${v.length} de ${P.linhas.length} ${P.linhas.length === 1 ? 'item responde' : 'itens respondem'} por ${numBR(ac, 0)}% do total de ${valorTxt(P.total, unidade)}. Comece por ${v.length === 1 ? 'ele' : 'eles'}: ${v.map(x => x.nome).join(', ')}.`;
}

/** gráfico de Pareto em SVG: colunas (vitais em destaque), linha do acumulado e a linha do corte. cores: { texto, grade, barra, vital, linha } */
export function paretoSVG(P, { unidade = '', cores = {}, largura = 860, altura = 340 } = {}) {
  const C = { texto: 'currentColor', grade: 'var(--border)', barra: 'var(--muted)', vital: 'var(--primary)', linha: 'var(--warn)', ...cores };
  const L = P.linhas; if (!L.length) return '';
  const mE = 56, mD = 46, mT = 18, mB = 78, W = largura - mE - mD, H = altura - mT - mB, max = Math.max(...L.map(x => x.valor)) || 1, passo = W / L.length, bw = Math.min(64, passo * 0.68);
  const y = (v) => mT + H - v / max * H, yp = (p) => mT + H - p / 100 * H, cx = (i) => mE + passo * i + passo / 2;
  const grade = [0, 25, 50, 75, 100].map(p => `<line x1="${mE}" y1="${yp(p)}" x2="${mE + W}" y2="${yp(p)}" stroke="${C.grade}" stroke-width="1"/><text x="${mE + W + 6}" y="${yp(p) + 4}" font-size="10" fill="${C.texto}" opacity=".7">${p}%</text><text x="${mE - 6}" y="${yp(p) + 4}" font-size="10" fill="${C.texto}" opacity=".7" text-anchor="end">${xml(numBR(max * p / 100, max < 10 ? 1 : 0))}</text>`).join('');
  const barras = L.map((x, i) => `<rect x="${r1(cx(i) - bw / 2)}" y="${r1(y(x.valor))}" width="${r1(bw)}" height="${r1(mT + H - y(x.valor))}" rx="3" fill="${x.vital ? C.vital : C.barra}" opacity="${x.vital ? 1 : .55}"><title>${xml(x.nome)}: ${xml(valorTxt(x.valor, unidade))} (${numBR(x.pct, 1)}%)</title></rect>
    <text x="${r1(cx(i))}" y="${r1(y(x.valor) - 4)}" font-size="10" text-anchor="middle" fill="${C.texto}">${xml(numBR(x.valor, x.valor % 1 ? 1 : 0))}</text>
    <text transform="translate(${r1(cx(i))},${mT + H + 12}) rotate(-28)" font-size="10.5" text-anchor="end" fill="${C.texto}"${x.vital ? ' font-weight="600"' : ''}>${xml(cortar(x.nome, 22))}</text>`).join('');
  const pts = L.map((x, i) => `${r1(cx(i))},${r1(yp(x.acumulado))}`).join(' ');
  const corte = `<line x1="${mE}" y1="${yp(P.corte)}" x2="${mE + W}" y2="${yp(P.corte)}" stroke="${C.linha}" stroke-width="1.2" stroke-dasharray="5 4"/><text x="${mE + W - 4}" y="${yp(P.corte) - 4}" font-size="10" fill="${C.linha}" font-weight="600" text-anchor="end">corte ${numBR(P.corte, 0)}%</text>`;
  return `<svg viewBox="0 0 ${largura} ${altura}" width="100%" role="img" aria-label="Gráfico de Pareto" xmlns="http://www.w3.org/2000/svg" style="max-width:${largura}px;font-family:inherit">${grade}${corte}${barras}
    <polyline points="${pts}" fill="none" stroke="${C.linha}" stroke-width="2"/>${L.map((x, i) => `<circle cx="${r1(cx(i))}" cy="${r1(yp(x.acumulado))}" r="3" fill="${C.linha}"><title>Acumulado: ${numBR(x.acumulado, 1)}%</title></circle>`).join('')}
    <text x="${mE}" y="${altura - 4}" font-size="10" fill="${C.texto}" opacity=".7">${xml(unidade ? `Colunas em ${unidade} · linha: % acumulado` : 'Linha: % acumulado')}</text></svg>`;
}

/* ---------------------------------------------------------------- Ishikawa */

/** tira espaços e causas vazias; mantém a ordem das categorias dos parâmetros e junta as que não existem mais */
export function limparIshikawa(ish = [], categorias = CATEGORIAS) {
  const m = new Map(categorias.map(c => [c, []]));
  for (const g of ish || []) { const cat = String(g?.categoria ?? '').trim(); if (!cat) continue; const L = m.get(cat) || m.set(cat, []).get(cat);
    for (const c of g.causas || []) { const t = String(c?.texto ?? '').trim(); if (t) L.push({ texto: t, provavel: !!c.provavel }); } }
  return [...m].map(([categoria, causas]) => ({ categoria, causas }));
}
export const causasDoIshikawa = (ish = []) => (ish || []).flatMap(g => (g.causas || []).map(c => ({ ...c, categoria: g.categoria })));
export const causasProvaveis = (ish = []) => causasDoIshikawa(ish).filter(c => c.provavel);

/**
 * Diagrama de Ishikawa (espinha de peixe) em SVG: o problema na cabeça, à direita; as categorias alternam em cima e embaixo;
 * cada causa é uma linha ligada à espinha da categoria; as causas prováveis vêm em destaque.
 */
export function ishikawaSVG(titulo, ish = [], { cores = {}, largura = 980 } = {}) {
  const C = { texto: 'currentColor', linha: 'var(--muted)', cat: 'var(--primary)', prov: 'var(--warn)', cabeca: 'var(--primary)', ...cores };
  const G = (ish || []).filter(g => g && g.categoria); if (!G.length) return '';
  const cima = G.filter((_, i) => i % 2 === 0), baixo = G.filter((_, i) => i % 2 === 1), cols = Math.max(cima.length, baixo.length);
  const maxC = (L) => Math.max(1, ...L.map(g => Math.min(7, (g.causas || []).length))), hC = 27;
  const altCima = 46 + maxC(cima) * hC, altBaixo = 46 + maxC(baixo) * hC, cabW = 190, mE = 16, ySp = altCima + 14, altura = ySp + altBaixo + 14;
  const xFim = largura - cabW - 14, passo = (xFim - mE - 40) / cols, incl = Math.min(70, passo * 0.38);
  const espinha = `<line x1="${mE}" y1="${ySp}" x2="${xFim}" y2="${ySp}" stroke="${C.cabeca}" stroke-width="3" stroke-linecap="round"/><path d="M${xFim - 2} ${ySp - 9} L${xFim + 12} ${ySp} L${xFim - 2} ${ySp + 9} Z" fill="${C.cabeca}"/>`;
  const linhasTit = quebrar(titulo || 'Problema', 24).slice(0, 4), cabH = Math.max(64, 26 + linhasTit.length * 16);
  const cabeca = `<rect x="${xFim + 12}" y="${ySp - cabH / 2}" width="${cabW}" height="${cabH}" rx="10" fill="${C.cabeca}"/>
    <text x="${xFim + 12 + cabW / 2}" y="${ySp - cabH / 2 + 15}" font-size="9.5" text-anchor="middle" fill="#fff" opacity=".85" letter-spacing=".6">PROBLEMA</text>
    ${linhasTit.map((t, i) => `<text x="${xFim + 12 + cabW / 2}" y="${ySp - (linhasTit.length - 1) * 8 + i * 16 + 9}" font-size="12.5" font-weight="600" text-anchor="middle" fill="#fff">${xml(t)}</text>`).join('')}`;
  const osso = (g, i, sobe) => {
    const xP = mE + 40 + passo * (i + 1) - 14, alt = sobe ? altCima - 30 : altBaixo - 30, yT = sobe ? ySp - alt : ySp + alt, xT = xP - incl;
    const causas = (g.causas || []).slice(0, 7), extra = (g.causas || []).length - causas.length;
    const itens = causas.map((c, k) => { const f = (k + 1) / (causas.length + 1), yy = ySp + (yT - ySp) * (1 - f), xx = xP + (xT - xP) * (1 - f);
      // o texto ocupa até duas linhas acima do traço da causa
      const larg = passo * 0.62, mx = Math.max(16, Math.floor(larg / 5.6)), ls = quebrar((c.provavel ? '● ' : '') + c.texto, mx), duas = ls.length > 2 ? [ls[0], cortar(ls.slice(1).join(' '), mx)] : ls;
      return `<line x1="${r1(xx - larg)}" y1="${r1(yy)}" x2="${r1(xx)}" y2="${r1(yy)}" stroke="${c.provavel ? C.prov : C.linha}" stroke-width="${c.provavel ? 1.6 : 1}"/>
        <text font-size="10.5" fill="${c.provavel ? C.prov : C.texto}"${c.provavel ? ' font-weight="600"' : ''}>${duas.map((t, j) => `<tspan x="${r1(xx - larg)}" y="${r1(yy - 3 - (duas.length - 1 - j) * 11.5)}">${xml(t)}</tspan>`).join('')}<title>${xml(c.texto)}${c.provavel ? ' (causa provável)' : ''}</title></text>`; }).join('');
    return `<line x1="${r1(xT)}" y1="${r1(yT)}" x2="${r1(xP)}" y2="${ySp}" stroke="${C.cat}" stroke-width="2" stroke-linecap="round"/>
      <rect x="${r1(xT - 62)}" y="${r1(sobe ? yT - 24 : yT + 2)}" width="124" height="22" rx="6" fill="none" stroke="${C.cat}" stroke-width="1.4"/>
      <text x="${r1(xT)}" y="${r1(sobe ? yT - 9 : yT + 17)}" font-size="11.5" font-weight="600" text-anchor="middle" fill="${C.cat}">${xml(cortar(g.categoria, 20))}${extra > 0 ? ` (+${extra})` : ''}</text>${itens}`;
  };
  return `<svg viewBox="0 0 ${largura} ${altura}" width="100%" role="img" aria-label="Diagrama de Ishikawa" xmlns="http://www.w3.org/2000/svg" style="max-width:${largura}px;font-family:inherit">${espinha}${cima.map((g, i) => osso(g, i, true)).join('')}${baixo.map((g, i) => osso(g, i, false)).join('')}${cabeca}</svg>`;
}
/** quebra um texto em linhas de até k letras, sem cortar palavra */
export function quebrar(texto, k) {
  const out = []; let l = '';
  for (const p of String(texto ?? '').trim().split(/\s+/)) { if ((l + ' ' + p).trim().length > k && l) { out.push(l); l = p; } else l = (l + ' ' + p).trim(); }
  if (l) out.push(l); return out;
}

/* ---------------------------------------------------------------- 5 Porquês */

/** cadeias sem linhas vazias: [{ partida, respostas: [..], causa }] */
export function limparPorques(pq = []) {
  return (pq || []).map(c => ({ partida: String(c?.partida ?? '').trim(), respostas: (c?.respostas || []).map(r => String(r ?? '').trim()).filter(Boolean), causa: String(c?.causa ?? '').trim() }))
    .filter(c => c.partida || c.respostas.length || c.causa);
}
/** última resposta de cada cadeia: candidata a causa raiz quando a cadeia não tem conclusão escrita */
export const conclusaoDaCadeia = (c) => c?.causa || (c?.respostas || []).slice(-1)[0] || '';
/** causas prováveis do Ishikawa que ainda não têm cadeia de porquês */
export function partidasPendentes(ish = [], pq = []) {
  const ja = new Set(limparPorques(pq).map(c => c.partida.toLowerCase()));
  return causasProvaveis(ish).filter(c => !ja.has(c.texto.trim().toLowerCase()));
}

/** RNC ou ordem de manutenção viram o ponto de partida do problema: a cadeia de porquês e a causa já registradas vão junto */
export function daOrigem(tipo, r) {
  if (!r) return {};
  const resp = (Array.isArray(r.porques) ? r.porques : []).map(x => String(x ?? '').trim()).filter(Boolean), causa = String(r.causa ?? '').trim(), desc = String(r.descricao ?? '').trim();
  const out = { origem_ref: `${tipo === 'rnc' ? 'nº' : 'OS nº'} ${r.numero}`, titulo: `${tipo === 'rnc' ? 'RNC' : 'OS'} ${r.numero}: ${desc.slice(0, 100)}`, descricao: desc, area: tipo === 'rnc' ? 'Qualidade' : 'Manutenção' };
  if (resp.length || causa) out.porques = [{ partida: desc.slice(0, 140) || out.titulo, respostas: resp, causa }];
  if (causa) out.causa_raiz = causa;
  return out;
}
export const tamanhoTxt = (b) => { const v = n(b); return !v ? '' : v < 1024 * 1024 ? `${Math.max(1, Math.round(v / 1024))} KB` : `${numBR(v / 1048576, 1)} MB`; };
export const nomeDeArquivo = (nome) => String(nome ?? 'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-80) || 'arquivo';

/* ---------------------------------------------------------------- 5W2H e andamento */

export const acaoAberta = (a) => a.situacao === 'pendente' || a.situacao === 'em_andamento';
export const acaoAtrasada = (a, hoje) => acaoAberta(a) && !!a.prazo && String(a.prazo).slice(0, 10) < hoje;
export const diasDeAtraso = (a, hoje) => acaoAtrasada(a, hoje) ? Math.round((Date.parse(hoje) - Date.parse(String(a.prazo).slice(0, 10))) / 86400000) : 0;
/** o que falta preencher do 5W2H de uma ação (os sete campos) */
export function faltaNo5w2h(a) {
  const f = [];
  if (!String(a.o_que || '').trim()) f.push('O quê'); if (!String(a.por_que || '').trim()) f.push('Por quê'); if (!String(a.onde || '').trim()) f.push('Onde');
  if (!a.prazo) f.push('Quando'); if (!String(a.responsavel_nome || '').trim()) f.push('Quem'); if (!String(a.como || '').trim()) f.push('Como'); if (!(n(a.custo_previsto) > 0)) f.push('Quanto');
  return f;
}
/** andamento do plano: contagens, % concluído (as canceladas ficam de fora), atrasadas e custos */
export function progresso(acoes = [], hoje = new Date().toISOString().slice(0, 10)) {
  const v = acoes.filter(a => a.situacao !== 'cancelada'), feitas = v.filter(a => a.situacao === 'concluida').length;
  return { total: v.length, feitas, abertas: v.length - feitas, canceladas: acoes.length - v.length, pct: v.length ? Math.round(feitas / v.length * 100) : 0,
    atrasadas: v.filter(a => acaoAtrasada(a, hoje)).length, previsto: v.reduce((s, a) => s + n(a.custo_previsto), 0), real: v.reduce((s, a) => s + n(a.custo_real), 0) };
}

/** as quatro ferramentas no problema: feita, em uso ou vazia (para o roteiro no alto da ficha) */
export function etapas(p, acoes = []) {
  const ish = causasDoIshikawa(p.ishikawa), pq = limparPorques(p.porques), pr = progresso(acoes);
  return [
    { k: 'pareto', nome: 'Pareto', sub: 'Priorizar', feito: !!p.pareto?.itens?.length, txt: p.pareto?.itens?.length ? `${p.pareto.itens.length} itens` : 'opcional' },
    { k: 'ishikawa', nome: 'Ishikawa', sub: 'Levantar as causas', feito: ish.length > 0, txt: ish.length ? `${ish.length} causa(s), ${ish.filter(c => c.provavel).length} provável(is)` : 'nenhuma causa' },
    { k: 'porques', nome: '5 Porquês', sub: 'Chegar à causa raiz', feito: !!p.causa_raiz, txt: p.causa_raiz ? 'causa raiz registrada' : pq.length ? `${pq.length} cadeia(s), sem causa raiz` : 'não iniciado' },
    { k: '5w2h', nome: '5W2H', sub: 'Plano de ação', feito: pr.total > 0 && pr.abertas === 0, txt: pr.total ? `${pr.feitas} de ${pr.total} concluída(s)${pr.atrasadas ? `, ${pr.atrasadas} atrasada(s)` : ''}` : 'sem ações' },
  ];
}

/** o que impede o encerramento (mesmas regras da função prob_encerrar) */
export function pendenciasParaEncerrar(p, acoes = [], cfg = CFG0) {
  const pr = progresso(acoes), f = [];
  if (pr.abertas > 0) f.push(`${pr.abertas} ação(ões) do plano ainda em aberto`);
  if (cfg.exige_causa !== false && !String(p.causa_raiz || '').trim()) f.push('causa raiz não registrada');
  if (cfg.exige_acao !== false && pr.feitas === 0) f.push('nenhuma ação concluída');
  return f;
}

/** números do painel: problemas por situação, ações abertas e atrasadas, vencendo em 7 dias */
export function resumo(problemas = [], acoes = [], hoje = new Date().toISOString().slice(0, 10)) {
  const vivos = problemas.filter(p => !['encerrado', 'cancelado'].includes(p.situacao)), ids = new Set(vivos.map(p => p.id));
  const ab = acoes.filter(a => acaoAberta(a) && ids.has(a.problema_id)), em7 = new Date(Date.parse(hoje) + 7 * 86400000).toISOString().slice(0, 10);
  const enc = problemas.filter(p => p.situacao === 'encerrado' && p.encerrado_em && p.aberto_em);
  return { abertos: vivos.length, criticos: vivos.filter(p => p.gravidade === 'critica' || p.gravidade === 'alta').length, verificar: vivos.filter(p => p.situacao === 'verificacao').length,
    semPlano: vivos.filter(p => !acoes.some(a => a.problema_id === p.id && a.situacao !== 'cancelada')).length,
    acoesAbertas: ab.length, acoesAtrasadas: ab.filter(a => acaoAtrasada(a, hoje)).length, acoesSemana: ab.filter(a => a.prazo >= hoje && a.prazo <= em7).length,
    encerrados: enc.length, diasMedios: enc.length ? Math.round(enc.reduce((s, p) => s + (Date.parse(p.encerrado_em) - Date.parse(p.aberto_em)) / 86400000, 0) / enc.length) : null,
    problemasAtrasados: vivos.filter(p => p.prazo && String(p.prazo).slice(0, 10) < hoje).length };
}

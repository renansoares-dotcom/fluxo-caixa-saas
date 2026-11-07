// Pré-impressão (SQL 089) — regras puras: situações e fluxo, código de barras (GTIN), posição de desbobinamento, hash,
// rodadas até a aprovação, tempo de resposta do cliente, indicadores e alertas. Nada aqui busca dado no banco.

export const SITUACOES = {
  em_criacao: 'Em criação', aguardando_cliente: 'Aguardando o cliente', alteracao_solicitada: 'Alteração pedida', reprovada: 'Reprovada',
  aprovada: 'Aprovada', na_clicheria: 'Na clicheria', liberada: 'Liberada', cancelada: 'Cancelada',
};
export const COR_SIT = { em_criacao: '', aguardando_cliente: 'aberto', alteracao_solicitada: 'vencido', reprovada: 'vencido', aprovada: 'pago', na_clicheria: 'aberto', liberada: 'pago', cancelada: '' };
export const ABERTAS = ['em_criacao', 'aguardando_cliente', 'alteracao_solicitada', 'reprovada', 'aprovada', 'na_clicheria'];
export const APROVADAS = ['aprovada', 'na_clicheria', 'liberada'];
export const TIPOS = { nova: 'Arte nova', alteracao: 'Alteração de arte', reimpressao: 'Reimpressão (sem mudança)' };
export const PROCESSOS = { superficie: 'Impressão de superfície', verso: 'Impressão no verso (reverso)', laminacao: 'Verso para laminação' };
export const DECISOES = { aprovada: 'Aprovada', alteracao: 'Alteração pedida', reprovada: 'Reprovada' };
// colunas do quadro: a arte anda da esquerda para a direita
export const COLUNAS = [
  { id: 'criacao', titulo: 'Em criação / ajuste', sits: ['em_criacao', 'alteracao_solicitada', 'reprovada'] },
  { id: 'cliente', titulo: 'Com o cliente', sits: ['aguardando_cliente'] },
  { id: 'aprovada', titulo: 'Aprovada', sits: ['aprovada'] },
  { id: 'clicheria', titulo: 'Clicheria', sits: ['na_clicheria'] },
  { id: 'liberada', titulo: 'Liberada (30 dias)', sits: ['liberada'] },
];
// as 8 posições de desbobinamento (padrão do mercado de rótulos e embalagens flexíveis)
export const DESBOBINAMENTO = {
  1: 'Externa — topo sai primeiro', 2: 'Externa — pé sai primeiro', 3: 'Externa — lado direito sai primeiro', 4: 'Externa — lado esquerdo sai primeiro',
  5: 'Interna — topo sai primeiro', 6: 'Interna — pé sai primeiro', 7: 'Interna — lado direito sai primeiro', 8: 'Interna — lado esquerdo sai primeiro',
};

const ms = (d) => (d == null ? NaN : new Date(String(d).length === 10 ? d + 'T12:00:00' : d).getTime());
const r = (v, c = 1) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** c) / 10 ** c);
const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** valida GTIN (EAN-8, UPC-A, EAN-13, DUN-14): dígito verificador pelo módulo 10 com pesos 3 e 1 a partir da direita */
export function gtin(codigo) {
  const d = String(codigo ?? '').replace(/\D/g, '');
  const tipo = { 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'DUN-14' }[d.length];
  if (!d) return { ok: false, vazio: true, msg: '' };
  if (!tipo) return { ok: false, codigo: d, msg: `${d.length} dígitos: o código de barras tem 8, 12, 13 ou 14` };
  const corpo = d.slice(0, -1), dv = +d.at(-1);
  const soma = [...corpo].reverse().reduce((s, c, i) => s + (+c) * (i % 2 === 0 ? 3 : 1), 0);
  const esperado = (10 - (soma % 10)) % 10;
  const pais = tipo === 'EAN-13' ? d.slice(0, 3) : tipo === 'DUN-14' ? d.slice(1, 4) : null;
  return { ok: esperado === dv, codigo: d, tipo, digito: dv, esperado, brasil: pais ? pais >= '789' && pais <= '790' : null,
    msg: esperado === dv ? `${tipo} válido` : `${tipo} inválido: o dígito verificador deveria ser ${esperado}` };
}

/** SVG da posição de desbobinamento (bobina, sentido de saída e a letra "F" na orientação da impressão) */
export function desbobinamentoSvg(pos, { w = 150, h = 74, cor = 'currentColor' } = {}) {
  const p = +pos;
  if (!(p >= 1 && p <= 8)) return '';
  const interna = p > 4, rot = { 1: 90, 2: -90, 3: 0, 4: 180 }[((p - 1) % 4) + 1];
  const yWeb = interna ? 52 : 18;   // externa: a lâmina sai por cima; interna: por baixo
  return `<svg viewBox="0 0 150 74" width="${w}" height="${h}" role="img" aria-label="Posição ${p}: ${DESBOBINAMENTO[p]}" style="color:${cor}">
    <circle cx="36" cy="35" r="26" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="36" cy="35" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M36 ${interna ? 61 : 9} L136 ${interna ? 61 : 9}" stroke="currentColor" stroke-width="2"/>
    <rect x="66" y="${yWeb - 16}" width="52" height="32" rx="3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2"/>
    <text x="92" y="${yWeb}" font-size="22" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="Inter,Arial,sans-serif" transform="rotate(${rot} 92 ${yWeb})" fill="currentColor">F</text>
    <path d="M128 ${interna ? 56 : 4} l8 ${interna ? 5 : 5} l-8 ${interna ? 5 : 5}" fill="none" stroke="currentColor" stroke-width="2"/>
    <text x="3" y="72" font-size="10" font-family="Inter,Arial,sans-serif" fill="currentColor">${p} · ${interna ? 'interna' : 'externa'}</text></svg>`;
}

/** SHA-256 em hexadecimal (navegador e Node 20+) */
export async function sha256(buf) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', buf instanceof ArrayBuffer || ArrayBuffer.isView(buf) ? buf : await buf.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const hashCurto = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-8)}` : '');

/** checklist da versão: quantos itens faltam */
export const faltaChecklist = (lista = []) => lista.filter(x => !x.ok).length;

/** confere as medidas da página do PDF com a ficha técnica (tolerância em mm) */
export function confereMedidas(pdf, ficha, tol = 2) {
  if (!pdf?.mmLargura || !ficha?.largura_mm || !ficha?.altura_mm) return null;
  const a = [pdf.mmLargura, pdf.mmAltura], b = [+ficha.largura_mm, +ficha.altura_mm];
  const igual = (x, y) => Math.abs(x[0] - y[0]) <= tol && Math.abs(x[1] - y[1]) <= tol;
  return { ok: igual(a, b) || igual([a[1], a[0]], b), girada: !igual(a, b) && igual([a[1], a[0]], b), pdf: a.map(v => r(v, 1)), ficha: b };
}

/** rodadas de um projeto: versões enviadas ao cliente até a aprovada (ou até agora) */
export function rodadas(projeto, versoes = []) {
  const env = versoes.filter(v => v.projeto_id === projeto.id && v.enviada_em).sort((a, b) => a.numero - b.numero);
  const ap = projeto.versao_aprovada_id && versoes.find(v => v.id === projeto.versao_aprovada_id);
  return ap ? env.filter(v => v.numero <= ap.numero).length : env.length;
}

/** tempo de resposta do cliente em horas: do envio da versão à decisão */
export function respostas(decisoes = [], versoes = []) {
  const ver = Object.fromEntries(versoes.map(v => [v.id, v]));
  return decisoes.filter(d => ver[d.versao_id]?.enviada_em).map(d => ({ ...d, horas: (ms(d.criado_em) - ms(ver[d.versao_id].enviada_em)) / 36e5 }));
}

/** indicadores do período (de/ate: datas AAAA-MM-DD) */
export function indicadores(projetos = [], versoes = [], decisoes = [], { de, ate, hoje = new Date().toISOString().slice(0, 10) } = {}) {
  const noPer = (t) => (!de || String(t).slice(0, 10) >= de) && (!ate || String(t).slice(0, 10) <= ate);
  const ativos = projetos.filter(p => !p.arquivado);
  const aprov = decisoes.filter(d => d.decisao === 'aprovada' && noPer(d.criado_em));
  const projAprov = aprov.map(d => ativos.find(p => p.id === d.projeto_id)).filter(Boolean);
  const rods = projAprov.map(p => rodadas(p, versoes)).filter(n => n > 0);
  const resp = respostas(decisoes.filter(d => d.origem === 'cliente' && noPer(d.criado_em)), versoes).map(x => x.horas);
  const lead = aprov.map(d => { const p = ativos.find(x => x.id === d.projeto_id); return p ? (ms(d.criado_em) - ms(p.criado_em)) / 864e5 : null; }).filter(x => x != null);
  const aguard = ativos.filter(p => p.situacao === 'aguardando_cliente');
  return {
    abertas: ativos.filter(p => ABERTAS.includes(p.situacao)).length,
    comCliente: aguard.length,
    atrasadas: aguard.filter(p => p.prazo && p.prazo < hoje).length,
    emAjuste: ativos.filter(p => ['em_criacao', 'alteracao_solicitada', 'reprovada'].includes(p.situacao)).length,
    aprovadas: aprov.length,
    rodadasMedia: r(media(rods), 1),
    primeira: rods.length ? r(rods.filter(n => n === 1).length / rods.length * 100, 0) : null,
    respostaH: r(media(resp), 1),
    leadDias: r(media(lead), 1),
    pedidosAlteracao: decisoes.filter(d => d.decisao !== 'aprovada' && noPer(d.criado_em)).length,
    porRodada: [1, 2, 3, 4].map(n => ({ n: n === 4 ? '4+' : String(n), qtd: rods.filter(x => (n === 4 ? x >= 4 : x === n)).length })),
  };
}

/** clientes que mais pedem alteração (rodadas médias por cliente, só os com aprovação no período) */
export function porCliente(projetos = [], versoes = [], decisoes = [], nomes = {}, per = {}) {
  const g = {};
  for (const p of projetos) {
    const d = decisoes.find(x => x.projeto_id === p.id && x.decisao === 'aprovada' && (!per.de || x.criado_em.slice(0, 10) >= per.de) && (!per.ate || x.criado_em.slice(0, 10) <= per.ate));
    if (!d) continue;
    (g[p.favorecido_id] ??= { favorecido_id: p.favorecido_id, nome: nomes[p.favorecido_id] || '—', artes: 0, rod: 0, horas: [] });
    g[p.favorecido_id].artes++; g[p.favorecido_id].rod += rodadas(p, versoes);
  }
  for (const x of respostas(decisoes.filter(d => d.origem === 'cliente'), versoes)) { const p = projetos.find(y => y.id === x.projeto_id); if (p && g[p.favorecido_id]) g[p.favorecido_id].horas.push(x.horas); }
  return Object.values(g).map(x => ({ ...x, rodadas: r(x.rod / x.artes, 1), respostaH: r(media(x.horas), 1) })).sort((a, b) => b.rodadas - a.rodadas || b.artes - a.artes);
}

/** dias desde a última mudança */
export const parada = (p, agora = Date.now()) => Math.floor((agora - ms(p.atualizado_em || p.criado_em)) / 864e5);

/** alertas para o painel e a Central de Decisões */
export function alertas({ projetos = [], opsPendentes = [], hoje = new Date().toISOString().slice(0, 10), agora = Date.now(), diasAjuste = 2, diasLiberar = 3 }) {
  const a = [], at = projetos.filter(p => !p.arquivado);
  const atr = at.filter(p => p.situacao === 'aguardando_cliente' && p.prazo && p.prazo < hoje);
  if (atr.length) a.push({ nivel: 'alto', titulo: `${atr.length} arte(s) sem resposta do cliente no prazo`, detalhe: atr.slice(0, 4).map(p => `nº ${p.numero} ${p.nome}`).join(' · '), ids: atr.map(p => p.id), filtro: 'atrasadas' });
  if (opsPendentes.length) a.push({ nivel: 'alto', titulo: `${opsPendentes.length} OP(s) com arte ainda não aprovada`, detalhe: opsPendentes.slice(0, 4).map(o => `OP ${o.numero}`).join(' · '), ids: opsPendentes.map(o => o.projeto_id), filtro: 'ops' });
  const aj = at.filter(p => ['alteracao_solicitada', 'reprovada'].includes(p.situacao) && parada(p, agora) >= diasAjuste);
  if (aj.length) a.push({ nivel: 'medio', titulo: `${aj.length} alteração(ões) pedida(s) parada(s) há ${diasAjuste}+ dias`, detalhe: aj.slice(0, 4).map(p => `nº ${p.numero}`).join(' · '), ids: aj.map(p => p.id), filtro: 'ajuste' });
  const cl = at.filter(p => p.situacao === 'na_clicheria' && !p.cliche_recebido_em && p.cliche_previsto && p.cliche_previsto < hoje);
  if (cl.length) a.push({ nivel: 'medio', titulo: `${cl.length} clichê(s) atrasado(s) na clicheria`, detalhe: cl.slice(0, 4).map(p => `nº ${p.numero}`).join(' · '), ids: cl.map(p => p.id), filtro: 'clicheria' });
  const lib = at.filter(p => (p.situacao === 'aprovada' || (p.situacao === 'na_clicheria' && p.cliche_recebido_em)) && parada(p, agora) >= diasLiberar);
  if (lib.length) a.push({ nivel: 'baixo', titulo: `${lib.length} arte(s) aprovada(s) esperando liberação para a produção`, detalhe: lib.slice(0, 4).map(p => `nº ${p.numero}`).join(' · '), ids: lib.map(p => p.id), filtro: 'liberar' });
  return a;
}

/** nome de arquivo seguro para o armazenamento */
export const nomeSeguro = (n) => String(n || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);

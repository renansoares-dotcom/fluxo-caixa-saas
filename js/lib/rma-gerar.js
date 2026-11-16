// RMA (SQL 162 e 163): geração e guarda dos arquivos do pacote, usada pela tela do RMA e pelo fechamento do banco.
// Ao conciliar e fechar uma conta no Fechamento do Mês, o extrato conciliado dela entra sozinho no RMA de cada mês coberto;
// com todos os bancos fechados no mês, os demais relatórios da plataforma são gerados. Tudo conforme os Parâmetros do RMA.
import { sb, state, q, fetchAll } from './data.js';
import { GERADORES, extratoConta, iniMes, fimMes, mesesCobertos, contasDoRma, contasAbertasNoMes, nomeArquivo, nomeExtrato, paraPlanilhas } from './rma.js';

const nv = (v) => (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

export function pdfDe(rel, cfg) {
  if (!window.jspdf) throw new Error('Biblioteca de PDF ainda carregando; tente de novo em instantes.');
  const { jsPDF } = window.jspdf, largo = rel.tabelas.some(t => t.cab.length > 6), doc = new jsPDF({ orientation: largo ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const topo = () => { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30); doc.text(String(rel.empresa || ''), M, 13);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(90); doc.text('Em recuperação judicial' + (cfg.processo ? ` — Processo nº ${cfg.processo}` : '') + (cfg.vara ? ` — ${cfg.vara}` : ''), M, 17.5);
    doc.text('RMA — Relatório Mensal de Atividades', W - M, 13, { align: 'right' }); doc.setDrawColor(160); doc.line(M, 20, W - M, 20); };
  topo(); doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(rel.titulo, M, 28); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text(rel.periodo, M, 33.5);
  let y = 39;
  for (const t of rel.tabelas) {
    if (y > H - 40) { doc.addPage(); y = 26; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20); doc.text(t.nome, M, y); y += 2;
    const fmt = (row) => row.map((v, i) => (t.num || []).includes(i) && typeof v === 'number' ? (Number.isInteger(v) && /Notas|notas/.test(t.cab[i]) ? String(v) : nv(v)) : (v ?? ''));
    doc.autoTable({ startY: y, margin: { left: M, right: M, top: 24, bottom: 14 }, head: [t.cab], body: t.linhas.map(fmt), foot: t.total ? [fmt(t.total)] : undefined, theme: 'grid', showFoot: 'lastPage',
      styles: { fontSize: largo ? 6.6 : 8, cellPadding: 1.1, lineColor: 200, lineWidth: 0.1, textColor: 20, overflow: 'linebreak' }, headStyles: { fillColor: [43, 85, 152], textColor: 255, fontStyle: 'bold' }, footStyles: { fillColor: 235, textColor: 20, fontStyle: 'bold' },
      columnStyles: Object.fromEntries((t.num || []).map(i => [i, { halign: 'right' }])), didParseCell: (c) => { if ((t.num || []).includes(c.column.index)) c.cell.styles.halign = 'right'; }, didDrawPage: (d) => { if (d.pageNumber > 1) topo(); } });
    y = doc.lastAutoTable.finalY + 8;
  }
  if (rel.notas?.length) { if (y > H - 30) { doc.addPage(); y = 28; } doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90);
    for (const nt of rel.notas) { const L = doc.splitTextToSize(nt, W - 2 * M); doc.text(L, M, y); y += L.length * 3.4 + 1.5; } }
  const tot = doc.getNumberOfPages(), ger = `Gerado pela plataforma em ${new Date().toLocaleString('pt-BR')}`;
  for (let i = 1; i <= tot; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(120); doc.text(ger, M, H - 7); doc.text(`Página ${i} de ${tot}`, W - M, H - 7, { align: 'right' }); }
  return doc.output('blob');
}
export function xlsxDe(rel) {
  if (!window.XLSX) throw new Error('Biblioteca de Excel ainda carregando; tente de novo em instantes.');
  const wb = XLSX.utils.book_new(), usados = new Set();
  for (const p of paraPlanilhas(rel)) { let nome = p.nome, k = 2; while (usados.has(nome)) nome = `${p.nome.slice(0, 28)} ${k++}`; usados.add(nome); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(p.linhas), nome); }
  return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: MIME.xlsx });
}

/** tudo o que a geração precisa saber do RMA da empresa */
export async function contexto(e) {
  const Cf = await q(sb.from('rma_config').select('*').eq('empresa_id', e)), cfg = Cf[0] || null;
  if (!cfg?.ativo) return { e, cfg, docs: [], meses: [], ent: [], arqs: [], travas: [] };
  const [docs, meses, ent, arqs, travas] = await Promise.all([
    q(sb.from('rma_documentos').select('*').eq('empresa_id', e).order('ordem')), q(sb.from('rma_meses').select('*').eq('empresa_id', e)),
    fetchAll(() => sb.from('rma_entregas').select('*').eq('empresa_id', e)), fetchAll(() => sb.from('rma_arquivos').select('*').eq('empresa_id', e).order('em')),
    q(sb.from('contas_travas').select('conta_id,ate,saldo_banco,saldo_sistema,observacao,criado_em,ativo').eq('empresa_id', e).order('criado_em', { ascending: false })).catch(() => []),
  ]);
  return { e, cfg, docs, meses, ent, arqs, travas, empresaNome: state.empresa?.razao_social || state.empresa?.nome || '' };
}
const contasCad = () => state.cad?.contas || [];
export const travasAtivas = (ctx) => ctx.travas.filter(t => t.ativo !== false);

/** grava o arquivo na pasta do mês e liga à entrega (o de mesmo nome é substituído) */
export async function guardar(ctx, entrega, mes, blob, nome, origem, tipo, contaId = null) {
  const path = `${ctx.e}/${mes.slice(0, 7)}/${nome}`;
  const { error } = await sb.storage.from('rma').upload(path, blob, { contentType: tipo, upsert: true }); if (error) throw error;
  const ja = ctx.arqs.find(a => a.entrega_id === entrega.id && a.caminho === path);
  if (ja) { await q(sb.from('rma_arquivos').update({ tamanho: blob.size, origem }).eq('id', ja.id)).catch(() => {}); return ja; }
  const r = await q(sb.from('rma_arquivos').insert({ empresa_id: ctx.e, entrega_id: entrega.id, nome, caminho: path, tamanho: blob.size, origem, conta_id: contaId }).select('*'));
  if (r[0]) ctx.arqs.push(r[0]); return r[0];
}
const planosDe = (e) => q(sb.from('plano_contas').select('id,codigo,nome,tipo,natureza,pai_id').eq('empresa_id', e));
const favs = () => Object.fromEntries(Object.values(state.cad?.favById || {}).map(v => [v.id, v.nome]));
const vespera = (mes) => new Date(Date.parse(iniMes(mes) + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);

/** gera um dos relatórios da plataforma (fluxo de caixa, títulos, faturamento, notas, vendas, contratos) nos formatos do documento */
export async function gerarDocumento(ctx, entrega, doc, mes) {
  const e = ctx.e, ini = iniMes(mes), fim = fimMes(mes), f = doc.fonte; let rel;
  if (f === 'fluxo_caixa') { const [L, P, s0, s1] = await Promise.all([fetchAll(() => sb.from('lancamentos').select('plano_id,status,data,valor,conta_id').eq('empresa_id', e).eq('status', 'Pago').gte('data', ini).lte('data', fim)), planosDe(e),
      q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: vespera(mes) })), q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: fim }))]); rel = GERADORES.fluxo_caixa(mes, L, P, s0, s1, ctx.empresaNome); }
  else if (f === 'titulos') { const cols = 'plano_id,status,data,emissao,created_at,valor,descricao,documento,favorecido_id';
    const [A, Pg, P] = await Promise.all([fetchAll(() => sb.from('lancamentos').select(cols).eq('empresa_id', e).eq('status', 'Em aberto')), fetchAll(() => sb.from('lancamentos').select(cols).eq('empresa_id', e).eq('status', 'Pago').gt('data', fim)), planosDe(e)]);
    rel = GERADORES.titulos(mes, [...A, ...Pg], P, favs(), ctx.empresaNome); }
  else if (['faturamento', 'notas_emitidas', 'vendas'].includes(f)) { const N = await fetchAll(() => sb.from('nfe_notas').select('tipo,emissao_propria,situacao,finalidade,cfops,numero,serie,emissao,natureza,dest_nome,dest_doc,dest_uf,v_nf,v_icms,v_st,v_ipi,v_pis,v_cofins,v_ibs,v_cbs,chave')
      .eq('empresa_id', e).eq('tipo', 'saida').gte('emissao', ini).lte('emissao', fim + 'T23:59:59')); rel = GERADORES[f](mes, N, ctx.empresaNome); }
  else if (f === 'contratos') { const C = await fetchAll(() => sb.from('contratos').select('numero,status,natureza,objeto,parte_nome,valor,periodicidade,inicio,fim,encerrado_em,criado_em,atualizado_em').eq('empresa_id', e)); rel = GERADORES.contratos(mes, C, ctx.empresaNome); }
  else throw new Error('Este documento é anexado, não gerado.');
  for (const ext of doc.formatos) await guardar(ctx, entrega, mes, ext === 'pdf' ? pdfDe(rel, ctx.cfg) : xlsxDe(rel), nomeArquivo(ctx.cfg.sigla, mes, doc, ext), 'gerado', MIME[ext]);
}

/**
 * Extrato conciliado das contas fechadas no mês (todas, ou só as de `soContas`). Conta ainda aberta no mês não gera.
 * Devolve { gerados: [nome da conta], abertas: [nome da conta] }.
 */
export async function gerarExtratos(ctx, entrega, doc, mes, soContas = null) {
  const e = ctx.e, ini = iniMes(mes), fim = fimMes(mes), T = travasAtivas(ctx), contas = contasDoRma(contasCad(), ctx.cfg);
  const fechadas = contas.filter(c => T.some(t => t.conta_id === c.id && t.ate >= fim)), alvo = fechadas.filter(c => !soContas || soContas.includes(c.id));
  const abertas = contas.filter(c => !fechadas.includes(c)).map(c => c.nome);
  if (!alvo.length) return { gerados: [], abertas };
  const [P, s0, L, pend] = await Promise.all([planosDe(e), q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: vespera(mes) })),
    fetchAll(() => sb.from('lancamentos').select('plano_id,status,data,valor,conta_id,conta_destino_id,favorecido_id,descricao,documento,created_at').eq('empresa_id', e).eq('status', 'Pago').gte('data', ini).lte('data', fim)),
    fetchAll(() => sb.from('extrato_itens').select('conta_id,valor').eq('empresa_id', e).eq('status', 'pendente').gte('data', ini).lte('data', fim)).catch(() => [])]);
  const F = favs(), gerados = [];
  for (const c of alvo) {
    const doMes = ctx.travas.find(t => t.conta_id === c.id && t.ate === fim), ativa = T.find(t => t.conta_id === c.id), tr = doMes || ativa, pc = pend.filter(x => x.conta_id === c.id);
    const fecho = { ate: tr.ate, saldo_banco: doMes?.saldo_banco ?? null, observacao: doMes?.observacao || null, em: String(tr.criado_em || '').slice(0, 10) || null, pendentes: pc.length, valorPendente: pc.reduce((s, x) => s + Math.abs(+x.valor), 0) };
    const rel = extratoConta(mes, c, L, P, F, +(s0.find(s => s.conta_id === c.id)?.saldo_pago) || 0, fecho, ctx.empresaNome);
    await guardar(ctx, entrega, mes, pdfDe(rel, ctx.cfg), nomeExtrato(ctx.cfg.sigla, mes, doc, c), 'gerado', MIME.pdf, c.id); gerados.push(c.nome);
  }
  return { gerados, abertas };
}

/** garante o pacote do mês aberto e devolve a entrega do documento (ou null se o mês já foi enviado) */
async function entregaDe(ctx, mes, doc) {
  const m = ctx.meses.find(x => x.mes === mes); if (m?.status === 'enviado') return null;
  let en = ctx.ent.find(x => x.mes === mes && x.documento_id === doc.id);
  if (!en) { await q(sb.rpc('rma_abrir_mes', { p_empresa: ctx.e, p_mes: mes }));
    const [M, E] = await Promise.all([q(sb.from('rma_meses').select('*').eq('empresa_id', ctx.e)), fetchAll(() => sb.from('rma_entregas').select('*').eq('empresa_id', ctx.e).eq('mes', mes))]);
    ctx.meses = M; ctx.ent = ctx.ent.filter(x => x.mes !== mes).concat(E); en = ctx.ent.find(x => x.mes === mes && x.documento_id === doc.id); }
  return en && en.status !== 'nao_aplica' ? en : null;
}

/** com todos os bancos fechados no mês, gera os relatórios da plataforma que ainda não têm arquivo; devolve quantos gerou */
export async function gerarRelatoriosDoMes(ctx, mes, { refazer = false } = {}) {
  if (contasAbertasNoMes(mes, contasCad(), travasAtivas(ctx), ctx.cfg).length) return 0;
  let n = 0;
  for (const doc of ctx.docs.filter(d => d.ativo && GERADORES[d.fonte])) { const en = await entregaDe(ctx, mes, doc); if (!en) continue;
    if (!refazer && ctx.arqs.some(a => a.entrega_id === en.id && a.origem === 'gerado')) continue;
    try { await gerarDocumento(ctx, en, doc, mes); n++; } catch (err) { console.warn('[RMA]', doc.codigo, err); } }
  return n;
}

/**
 * Chamado pelo Fechamento do Mês logo depois de fechar e travar uma conta até `ate`.
 * Devolve null (RMA desligado, automático desligado, conta fora do RMA ou sem permissão) ou { extratos, relatorios, meses }.
 */
export async function aoFecharConta(e, contaId, ate) {
  const ctx = await contexto(e), cfg = ctx.cfg;
  if (!cfg?.ativo || (!cfg.auto_extrato && !cfg.auto_relatorios) || (cfg.contas_fora || []).includes(contaId)) return null;
  if (!await q(sb.rpc('rma_pode', { p_empresa: e })).catch(() => false)) return null;
  const meses = mesesCobertos(cfg.mes_inicio, ate), docExt = ctx.docs.find(d => d.ativo && d.fonte === 'extrato_conta'), out = { extratos: 0, relatorios: 0, meses: [] };
  for (const mes of meses) {
    if (ctx.meses.find(x => x.mes === mes)?.status === 'enviado') continue;
    if (cfg.auto_extrato && docExt) { const en = await entregaDe(ctx, mes, docExt);
      if (en && (mes === meses[meses.length - 1] || !ctx.arqs.some(a => a.entrega_id === en.id && a.conta_id === contaId))) { const r = await gerarExtratos(ctx, en, docExt, mes, [contaId]); if (r.gerados.length) { out.extratos++; out.meses.push(mes); } } }
    if (cfg.auto_relatorios) out.relatorios += await gerarRelatoriosDoMes(ctx, mes);
  }
  return out;
}

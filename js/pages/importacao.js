// Compras e Estoque › Importação (CMP005, SQL 158): importação de matéria-prima do exterior, do pedido ao estoque.
// Processo com etapas (negociação, pedido, produção, embarque, porto, declaração, desembaraço, recebimento, encerramento), itens com
// NCM e alíquotas, câmbio (adiantamento e saldo, contratação e liquidação, exposição com a PTAX do Banco Central), despesas e impostos
// da nacionalização, custo estimado e custo final por item, documentos, títulos no financeiro e entrada no estoque com o custo apurado.
// Pedido do Renan em 13/11/2026.
import { sb, state, q, fetchAll, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, money0, dateBR, today, options, parseNum, confirmDialog, exportXLSX } from '../lib/ui.js';
import { kpiGrid } from '../lib/componentes.js';
import { ETAPAS, ETAPA, ABERTAS, DATA_ETAPA, INCOTERMS, MODAL, CANAL, MOEDAS, SGS, CATEGORIAS, DOCS, CAMBIO_TIPO, CAMBIO_STATUS, proximaEtapa, freteNoPreco, seguroNoPreco,
  fobTotal, numeroProcesso, diasEntre, estimar, custoFinal, coberturaCambio, exposicao, alertas, lerSgs, faltaParaEtapa } from '../lib/importacao.js';

export const title = 'Importação';
const CFG0 = { papeis: ['financeiro', 'diretor', 'compras'], moeda_padrao: 'USD', rateio: 'valor', recupera_icms: true, recupera_ipi: true, recupera_pis_cofins: true, gerar_titulos: true,
  free_time_padrao: 14, dias_aviso_chegada: 7, dias_aviso_cambio: 5, dias_aviso_freetime: 3, avisar: true };
const ui = { aba: 'painel', filtro: 'abertos', busca: '', proc: null, paba: 'resumo' };
const ABAS = [['painel', 'Painel'], ['processos', 'Processos'], ['cambio', 'Câmbio'], ['custos', 'Custos']];
const PABAS = [['resumo', 'Resumo'], ['itens', 'Itens'], ['cambio', 'Câmbio'], ['despesas', 'Despesas'], ['custo', 'Custo'], ['docs', 'Documentos'], ['hist', 'Histórico']];
const CSS = `<style>
  .im-st{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;background:var(--surface-2);color:var(--muted)}
  .im-st.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.im-st.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .im-st.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.im-st.info{background:color-mix(in srgb,var(--primary) 14%,transparent);color:var(--primary)}
  .im-funil{display:grid;grid-template-columns:repeat(8,minmax(118px,1fr));gap:6px;overflow-x:auto;padding-bottom:4px}
  .im-col{background:var(--surface-2);border-radius:10px;padding:6px;min-height:120px;min-width:0}.im-col h4{margin:0 0 6px;font-size:11.5px;display:flex;justify-content:space-between;gap:6px}
  .im-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:6px 7px;margin-bottom:6px;font-size:11.5px;cursor:pointer;overflow-wrap:anywhere}.im-card:hover{border-color:var(--primary)}
  .im-card b{display:block}.im-card .al{color:var(--neg);font-weight:600}
  .im-passos{display:flex;gap:0;overflow-x:auto;margin:10px 0 4px}.im-passo{flex:1;min-width:92px;text-align:center;font-size:11px;position:relative;padding-top:20px;color:var(--muted)}
  .im-passo:before{content:'';position:absolute;top:6px;left:0;right:0;height:3px;background:var(--border)}.im-passo:after{content:'';position:absolute;top:1px;left:50%;margin-left:-7px;width:13px;height:13px;border-radius:50%;background:var(--surface);border:3px solid var(--border)}
  .im-passo.ok:before{background:var(--pos)}.im-passo.ok:after{border-color:var(--pos);background:var(--pos)}.im-passo.at{color:var(--text);font-weight:700}.im-passo.at:after{border-color:var(--primary);background:var(--surface)}
  .im-passo small{display:block;font-weight:400;color:var(--muted)}
  .im-g{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.im-g .c2{grid-column:span 2}.im-g .c3{grid-column:span 3}.im-g .c4{grid-column:span 4}.im-g .c6{grid-column:span 6}
  @media(max-width:800px){.im-g{grid-template-columns:1fr 1fr}.im-g .c3,.im-g .c4,.im-g .c6{grid-column:span 2}}
  .im-it input,.im-it select{min-height:30px;padding:3px 6px;font-size:12.5px;width:100%;min-width:0}.im-it td{padding:3px 4px;vertical-align:middle}.im-it th{font-size:11px}
  .im-res{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:10px 0}.im-res div{border:1px solid var(--border);border-radius:8px;padding:7px 9px;font-size:13px}.im-res span{display:block;color:var(--muted);font-size:11px}
  .im-bar{height:8px;border-radius:6px;background:var(--surface-2);overflow:hidden;display:flex}.im-bar i{display:block;height:100%}
  .im-al{border-left:4px solid var(--warn);margin-bottom:12px}.im-al.alto{border-left-color:var(--neg)}.im-al li{margin:3px 0}
  .modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;font-size:13px}.modal label.chk input{width:auto;min-height:0}
</style>`;
const pn = (v) => parseNum(String(v ?? '').trim() || '0') || 0;
const nv = (v, c = 2) => v == null || v === '' ? '' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const fm = (v, moeda) => `${moeda} ${nv(v)}`;
const st = (s) => `<span class="im-st ${s === 'cancelado' ? 'neg' : s === 'encerrado' ? '' : s === 'recebido' ? 'pos' : 'info'}">${esc(ETAPA[s]?.nome || s)}</span>`;
const dataEtapa = (p) => p[DATA_ETAPA[p.status]] || null;

async function dados(e) {
  const [Cf, Pr, It, Cb, Dp, Px, pode] = await Promise.all([
    q(sb.from('imp_config').select('*').eq('empresa_id', e)),
    fetchAll(() => sb.from('imp_processos').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
    fetchAll(() => sb.from('imp_itens').select('*').eq('empresa_id', e).order('ordem')),
    fetchAll(() => sb.from('imp_cambios').select('*').eq('empresa_id', e).order('vencimento')),
    fetchAll(() => sb.from('imp_despesas').select('*').eq('empresa_id', e).order('vencimento')),
    q(sb.from('imp_ptax').select('*').order('data', { ascending: false }).limit(120)),
    q(sb.rpc('imp_pode', { p_empresa: e })),
  ]);
  const cot = {}; for (const x of Px) if (!cot[x.moeda]) cot[x.moeda] = x;     // a mais recente de cada moeda
  return { cfg: { ...CFG0, ...(Cf[0] || {}), _existe: !!Cf[0] }, Pr, It, Cb, Dp, Px, cot, pode: !!pode };
}

/** alertas para a Central de Decisões (regra 29) */
export async function alertasDecisao() {
  try { const D = await dados(state.empresa.id); return alertas(D.Pr, D.Cb, D.cfg, today()); } catch { return []; }
}

export async function render(root) {
  const e = state.empresa.id, hoje = today();
  const prm = new URLSearchParams(location.hash.split('?')[1] || '');
  if (!ui.interno) { ui.proc = null; ui.paba = 'resumo'; ui.aba = 'painel'; }                  // quem chega pelo menu vê a lista; quem está dentro continua no processo
  ui.interno = false;
  if (prm.get('p')) { ui.proc = prm.get('p'); history.replaceState(null, '', '#/compras/importacao'); }
  if (ABAS.some(a => a[0] === prm.get('aba'))) ui.aba = prm.get('aba');
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Importação de matéria-prima</h2><div class="muted small">Do pedido ao exportador até a entrada no estoque: etapas, câmbio, despesas e custo final.</div></div>
    <div class="pi-acoes" style="display:flex;gap:8px;flex-wrap:wrap" id="im-acoes"></div></div><div id="im-corpo"><div class="loading">Carregando…</div></div>`;
  const corpo = $('#im-corpo', root);
  let D, cad = { fornecedores: [], planos: [], centros: [] }, prods = [];
  try {
    await loadCadastros().catch(() => {});
    D = await dados(e);
    [cad, prods] = await Promise.all([q(sb.rpc('compras_cadastros', { p_empresa: e })).catch(() => cad), fetchAll(() => sb.from('produtos').select('id,codigo,descricao,unidade,ncm,tipo,ativo').eq('empresa_id', e).order('codigo')).catch(() => [])]);
  } catch (err) { fail(err); corpo.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 158 (importação) já foi executado.</div></div>'; return; }
  const re = () => { ui.interno = true; return render(root); }, cfg = D.cfg, pode = D.pode, admin = state.papel === 'admin';
  const forn = (id) => cad.fornecedores.find(f => f.id === id)?.nome || state.cad?.favById?.[id]?.nome || '—';
  const contas = () => (state.cad?.contas || []).filter(c => c.ativo !== false && c.tipo !== 'Cheques');
  const itensDe = (id) => D.It.filter(i => i.processo_id === id), cambDe = (id) => D.Cb.filter(c => c.processo_id === id), despDe = (id) => D.Dp.filter(d => d.processo_id === id);
  const cotDe = (m) => +D.cot[m]?.venda || null;
  const custoDe = (p) => custoFinal(p, itensDe(p.id), despDe(p.id), cambDe(p.id), cfg, cotDe(p.moeda));
  const AL = alertas(D.Pr, D.Cb, cfg, hoje), alDe = (id) => AL.filter(a => a.processo_id === id);
  const abrir = (id, aba = 'resumo') => { ui.proc = id; ui.paba = aba; re(); };

  $('#im-acoes', root).innerHTML = ui.proc ? '<button class="btn ghost" id="im-volta">← Voltar à lista</button>'
    : `${admin ? '<button class="btn ghost" id="im-par">Parâmetros</button>' : ''}<button class="btn ghost" id="im-cot">Cotações</button>${pode ? '<button class="btn primary" id="im-novo">Novo processo</button>' : ''}`;
  $('#im-volta', root) && ($('#im-volta', root).onclick = () => { ui.proc = null; re(); });
  $('#im-par', root) && ($('#im-par', root).onclick = parametros);
  $('#im-cot', root) && ($('#im-cot', root).onclick = cotacoes);
  $('#im-novo', root) && ($('#im-novo', root).onclick = () => editarProcesso(null));

  const proc = ui.proc && D.Pr.find(p => p.id === ui.proc);
  if (ui.proc && !proc) ui.proc = null;
  if (proc) return detalhe(proc);

  // ------------------------------------------------------------ visão geral
  const abertos = D.Pr.filter(p => ABERTAS.includes(p.status) && p.status !== 'recebido'), transito = D.Pr.filter(p => p.status === 'embarcado');
  const cbAb = D.Cb.filter(c => c.status !== 'liquidado' && D.Pr.find(p => p.id === c.processo_id && p.status !== 'cancelado')).map(c => ({ ...c, moeda: D.Pr.find(p => p.id === c.processo_id).moeda }));
  const EX = exposicao(cbAb, Object.fromEntries(Object.entries(D.cot).map(([m, x]) => [m, +x.venda])));
  const aPagarBrl = EX.reduce((s, x) => s + (x.aberto_brl || 0) + x.travado_brl, 0), semTrava = EX.reduce((s, x) => s + (x.aberto_brl || 0), 0);
  const prox = D.Pr.filter(p => p.status === 'embarcado' && p.chegada_prevista).sort((a, b) => a.chegada_prevista.localeCompare(b.chegada_prevista))[0];
  const resumoItens = (p) => { const I = itensDe(p.id); return I.length ? `${esc(I[0].descricao)}${I.length > 1 ? ` <span class="muted">+ ${I.length - 1}</span>` : ''}` : '<span class="muted">sem itens</span>'; };
  const pctLiq = (p) => { const c = coberturaCambio(itensDe(p.id), cambDe(p.id)); return c.fob > 0 ? Math.min(100, c.liquidado / c.fob * 100) : 0; };
  const cardProc = (p) => { const a = alDe(p.id)[0], I = itensDe(p.id);
    return `<div class="im-card" data-p="${p.id}"><b>${numeroProcesso(p)}${p.referencia ? ` <span class="muted" style="font-weight:400">· ${esc(p.referencia)}</span>` : ''}</b>${esc(forn(p.favorecido_id))}
      <div class="muted">${fm(fobTotal(I), p.moeda)}${p.status === 'embarcado' && p.chegada_prevista ? ` · chega ${dateBR(p.chegada_prevista).slice(0, 5)}` : dataEtapa(p) ? ` · ${dateBR(dataEtapa(p)).slice(0, 5)}` : ''}</div>${a ? `<div class="al">${a.nivel === 'baixo' ? '' : '⚠ '}${esc(a.texto.replace(/^IMP \d+: /, ''))}</div>` : ''}</div>`; };

  const vistas = {
    painel: () => `<div id="im-k"></div>
      ${AL.filter(a => a.nivel !== 'baixo').length ? `<div class="card im-al ${AL.some(a => a.nivel === 'alto') ? 'alto' : ''}" style="margin-top:12px"><b>Atenção aos prazos</b><ul style="margin:6px 0 0;padding-left:18px">${AL.filter(a => a.nivel !== 'baixo').slice(0, 8).map(a => `<li><a href="#" data-p="${a.processo_id}">${esc(a.texto)}</a></li>`).join('')}</ul></div>` : ''}
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Processos por etapa</h2>
        ${D.Pr.some(p => ABERTAS.includes(p.status)) ? `<div class="im-funil">${ETAPAS.slice(0, 8).map(([k, n]) => { const L = D.Pr.filter(p => p.status === k); return `<div class="im-col"><h4><span>${esc(n)}</span><span class="muted">${L.length || ''}</span></h4>${L.map(cardProc).join('')}</div>`; }).join('')}</div>`
          : `<div class="empty">Nenhum processo em andamento.${pode ? ' Use "Novo processo" para registrar a primeira importação.' : ''}</div>`}</div>`,
    processos: () => { const b = ui.busca.trim().toLowerCase();
      const F = { abertos: (p) => ABERTAS.includes(p.status) && p.status !== 'recebido', recebidos: (p) => ['recebido', 'encerrado'].includes(p.status), cancelados: (p) => p.status === 'cancelado', todos: () => true };
      const L = D.Pr.filter(p => F[ui.filtro](p) && (!b || [numeroProcesso(p), p.referencia, forn(p.favorecido_id), p.declaracao, p.conhecimento, p.invoice, ...itensDe(p.id).map(i => i.descricao)].some(v => String(v || '').toLowerCase().includes(b))));
      return `<div class="card toolbar" style="margin-bottom:12px"><div class="chips" id="im-f">${[['abertos', 'Em andamento'], ['recebidos', 'Recebidos e encerrados'], ['cancelados', 'Cancelados'], ['todos', 'Todos']].map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
        <span class="spacer"></span><label>Buscar<input id="im-b" value="${esc(ui.busca)}" placeholder="processo, exportador, DI, BL, item" style="min-width:230px"></label><button class="btn ghost" id="im-xls">Excel</button></div>
      <div class="card flush"><div class="table-wrap"><table id="im-tab"><thead><tr><th>Processo</th><th>Exportador</th><th>Mercadoria</th><th class="num">Valor</th><th>Etapa</th><th>Chegada</th><th>Câmbio pago</th><th></th></tr></thead><tbody>
      ${L.map(p => { const liq = pctLiq(p), a = alDe(p.id).filter(x => x.nivel !== 'baixo');
        return `<tr><td><a href="#" data-p="${p.id}"><b>${numeroProcesso(p)}</b></a>${p.referencia ? `<div class="small muted">${esc(p.referencia)}</div>` : ''}</td><td class="wrap">${esc(forn(p.favorecido_id))}<div class="small muted">${esc([p.pais_origem, p.incoterm, MODAL[p.modal]].filter(Boolean).join(' · '))}</div></td>
          <td class="wrap">${resumoItens(p)}</td><td class="num">${fm(fobTotal(itensDe(p.id)), p.moeda)}</td><td>${st(p.status)}${dataEtapa(p) ? `<div class="small muted">${dateBR(dataEtapa(p))}</div>` : ''}${a.length ? `<div class="small neg">⚠ ${a.length} alerta(s)</div>` : ''}</td>
          <td>${p.data_chegada ? dateBR(p.data_chegada) : p.chegada_prevista ? `<span class="muted">prev.</span> ${dateBR(p.chegada_prevista)}` : '—'}</td>
          <td style="min-width:110px"><div class="im-bar"><i style="width:${liq.toFixed(0)}%;background:var(--pos)"></i></div><div class="small muted">${liq.toFixed(0)}% liquidado</div></td>
          <td><button class="btn ghost small" data-p="${p.id}">Abrir</button></td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Nenhum processo aqui.</td></tr>'}</tbody></table></div></div>`; },
    cambio: () => `<div class="card"><h2 style="margin-top:0">Exposição cambial</h2><div class="small muted" style="margin-bottom:8px">O que ainda vai ser pago ao exterior. "Sem taxa travada" é o valor previsto, sem contrato de câmbio: é ele que muda com a cotação.</div>
        <div class="table-wrap"><table><thead><tr><th>Moeda</th><th class="num">Sem taxa travada</th><th class="num">Cotação (venda)</th><th class="num">Em reais hoje</th><th class="num">A cada 1% da moeda</th><th class="num">Com contrato</th><th class="num">Em reais (contratado)</th></tr></thead><tbody>
        ${EX.map(x => `<tr><td><b>${x.moeda}</b> <span class="small muted">${esc(MOEDAS[x.moeda] || '')}</span></td><td class="num">${nv(x.aberto)}</td><td class="num">${x.cotacao ? nv(x.cotacao, 4) : '<span class="neg">sem cotação</span>'}${D.cot[x.moeda] ? `<div class="small muted">${dateBR(D.cot[x.moeda].data)}</div>` : ''}</td>
          <td class="num">${x.aberto_brl != null ? money(x.aberto_brl) : '—'}</td><td class="num">${x.por_ponto != null ? money(x.por_ponto) : '—'}</td><td class="num">${nv(x.travado)}</td><td class="num">${money(x.travado_brl)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum pagamento ao exterior em aberto.</td></tr>'}</tbody></table></div></div>
      <h3>Pagamentos ao exterior em aberto</h3>${tabCambio(cbAb.sort((a, b) => a.vencimento.localeCompare(b.vencimento)), true)}
      <h3>Liquidados recentes</h3>${tabCambio(D.Cb.filter(c => c.status === 'liquidado').sort((a, b) => (b.data_liquidacao || '').localeCompare(a.data_liquidacao || '')).slice(0, 20).map(c => ({ ...c, moeda: D.Pr.find(p => p.id === c.processo_id)?.moeda || '' })), true)}`,
    custos: () => { const L = D.Pr.filter(p => ['registro', 'desembaracado', 'recebido', 'encerrado'].includes(p.status)).map(p => ({ p, c: custoDe(p) }));
      const hist = L.flatMap(({ p, c }) => c.itens.map(i => ({ p, i, it: itensDe(p.id).find(x => x.id === i.item_id) }))).sort((a, b) => String(a.i.descricao).localeCompare(b.i.descricao) || (b.p.numero - a.p.numero));
      return `<div class="card flush"><div class="table-wrap"><table id="im-tab"><thead><tr><th>Processo</th><th>Exportador</th><th class="num">Taxa</th><th class="num">Mercadoria (R$)</th><th class="num">Despesas no custo</th><th class="num">Custo total</th><th class="num">Custo ÷ mercadoria</th><th class="num">Impostos recuperáveis</th><th class="num">Variação cambial</th></tr></thead><tbody>
        ${L.map(({ p, c }) => `<tr><td><a href="#" data-p="${p.id}" data-aba="custo"><b>${numeroProcesso(p)}</b></a><div class="small">${st(p.status)}</div></td><td class="wrap">${esc(forn(p.favorecido_id))}</td><td class="num">${c.taxa ? nv(c.taxa, 4) : '—'}<div class="small muted">${{ declaracao: 'da declaração', prevista: 'prevista', cotacao: 'cotação', sem_taxa: '' }[c.taxa_origem]}</div></td>
          <td class="num">${money(c.fob_brl)}</td><td class="num">${money(c.despesas_custo)}</td><td class="num"><b>${money(c.custo_total)}</b></td><td class="num">${c.fator ? nv(c.fator, 3) : '—'}</td><td class="num">${money(c.impostos_recuperaveis)}</td>
          <td class="num ${c.variacao_cambial > 0 ? 'neg' : c.variacao_cambial < 0 ? 'pos' : ''}">${c.variacao_cambial == null || !c.cambio_liquidado_moeda ? '—' : money(c.variacao_cambial)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">O custo aparece aqui a partir da declaração registrada.</td></tr>'}</tbody></table></div></div>
        <p class="small muted">"Custo ÷ mercadoria" mostra quanto a nacionalização acrescenta: 1,150 quer dizer que cada R$ 1,00 de mercadoria chega à fábrica custando R$ 1,15. Variação cambial positiva é perda (pagou-se mais reais do que a mercadoria valia pela taxa da declaração); ela é resultado financeiro e não entra no custo.</p>
        <h3>Custo por item, processo a processo</h3><div class="card flush"><div class="table-wrap"><table><thead><tr><th>Item</th><th>Processo</th><th>Recebido em</th><th class="num">Quantidade</th><th class="num">Preço do exportador</th><th class="num">Custo final por unidade</th></tr></thead><tbody>
        ${hist.map(({ p, i, it }) => `<tr><td class="wrap">${esc(i.descricao)}</td><td><a href="#" data-p="${p.id}" data-aba="custo">${numeroProcesso(p)}</a></td><td>${dateBR(p.data_recebimento) || '—'}</td><td class="num">${nv(i.quantidade, 0)} ${esc(i.unidade)}</td><td class="num">${fm(it?.valor_unitario, p.moeda)}</td><td class="num"><b>${i.custo_unitario ? 'R$ ' + nv(i.custo_unitario, 4) : '—'}</b></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sem histórico ainda.</td></tr>'}</tbody></table></div></div>`; },
  };
  function tabCambio(L, comProc) {
    return `<div class="card flush"><div class="table-wrap"><table><thead><tr>${comProc ? '<th>Processo</th>' : ''}<th>Tipo</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th class="num">Taxa</th><th class="num">Em reais</th><th></th></tr></thead><tbody>
      ${L.map(c => { const p = D.Pr.find(x => x.id === c.processo_id), d = diasEntre(hoje, c.vencimento), tx = +c.taxa || +p?.taxa_di || +p?.taxa_prevista || cotDe(c.moeda || p?.moeda);
        return `<tr>${comProc ? `<td><a href="#" data-p="${c.processo_id}" data-aba="cambio"><b>${p ? numeroProcesso(p) : ''}</b></a><div class="small muted">${esc(forn(p?.favorecido_id))}</div></td>` : ''}<td>${CAMBIO_TIPO[c.tipo]}${c.contrato ? `<div class="small muted">contrato ${esc(c.contrato)}</div>` : ''}</td>
          <td>${dateBR(c.vencimento)}${c.status !== 'liquidado' ? `<div class="small ${d < 0 ? 'neg' : 'muted'}">${d < 0 ? `vencido há ${-d} dia(s)` : d === 0 ? 'hoje' : `em ${d} dia(s)`}</div>` : `<div class="small muted">pago ${dateBR(c.data_liquidacao)}</div>`}</td>
          <td class="num">${fm(c.valor_moeda, c.moeda || p?.moeda || '')}</td><td><span class="im-st ${CAMBIO_STATUS[c.status][1]}">${CAMBIO_STATUS[c.status][0]}</span></td><td class="num">${c.taxa ? nv(c.taxa, 4) : tx ? `<span class="muted">${nv(tx, 4)}</span>` : '—'}</td>
          <td class="num">${c.valor_brl != null ? money(c.valor_brl) : tx ? `<span class="muted">${money(c.valor_moeda * tx)}</span>` : '—'}</td>
          <td style="white-space:nowrap">${pode && c.status === 'previsto' ? `<button class="btn ghost small" data-cb="contratar" data-id="${c.id}">Contratar</button> ` : ''}${pode && c.status !== 'liquidado' ? `<button class="btn primary small" data-cb="liquidar" data-id="${c.id}">Liquidar</button> ` : ''}${pode ? `<button class="btn ghost small" data-cb="editar" data-id="${c.id}">Editar</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="${comProc ? 8 : 7}" class="empty">Nada aqui.</td></tr>`}</tbody></table></div></div>`;
  }
  function ligar(el) {
    $$('[data-p]', el).forEach(a => a.onclick = (ev) => { ev.preventDefault(); abrir(a.dataset.p, a.dataset.aba || 'resumo'); });
    $$('[data-cb]', el).forEach(b => b.onclick = () => cambio(D.Cb.find(c => c.id === b.dataset.id), null, b.dataset.cb));
  }
  corpo.innerHTML = `<div class="chips tabs" id="im-abas" style="margin-bottom:12px">${ABAS.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-aba="${k}">${t}</span>`).join('')}</div><div id="im-vista">${vistas[ui.aba]()}</div>`;
  $$('#im-abas [data-aba]', corpo).forEach(b => b.onclick = () => { ui.aba = b.dataset.aba; re(); });
  ligar(corpo);
  if (ui.aba === 'painel') kpiGrid($('#im-k', corpo), [
    { id: 'p', label: 'Processos em andamento', valor: String(abertos.length), sub: `${D.Pr.filter(p => p.status === 'recebido').length} recebido(s) a encerrar`, clicavel: true },
    { id: 't', label: 'Em trânsito', valor: String(transito.length), sub: prox ? `próxima chegada ${dateBR(prox.chegada_prevista)}` : 'nenhum embarque no mar', clicavel: true },
    { id: 'c', label: 'A pagar ao exterior', valor: money0(aPagarBrl), sub: EX.map(x => `${x.moeda} ${nv(x.aberto + x.travado, 0)}`).join(' · ') || 'nada em aberto', clicavel: true },
    { id: 'c', label: 'Sem taxa travada', valor: money0(semTrava), sub: semTrava ? `${money0(semTrava / 100)} a cada 1% da moeda` : 'tudo contratado ou pago', tom: semTrava ? 'warn' : '', clicavel: true },
    { id: 'a', label: 'Alertas de prazo', valor: String(AL.filter(a => a.nivel !== 'baixo').length), sub: AL.some(a => a.nivel === 'alto') ? 'há prazo vencido' : 'nenhum prazo vencido', tom: AL.some(a => a.nivel === 'alto') ? 'neg' : '' },
  ], (k) => { if (k === 'c') { ui.aba = 'cambio'; re(); } else if (k === 'p' || k === 't') { ui.aba = 'processos'; ui.filtro = 'abertos'; re(); } });
  function ligarVista() {
    $$('#im-f [data-f]', corpo).forEach(c => c.onclick = () => { ui.filtro = c.dataset.f; re(); });
    $('#im-xls', corpo) && ($('#im-xls', corpo).onclick = () => exportXLSX($('#im-tab', corpo), 'importacoes'));
    $('#im-b', corpo) && ($('#im-b', corpo).oninput = (ev) => { ui.busca = ev.target.value; const pos = ev.target.selectionStart, v = $('#im-vista', corpo);
      v.innerHTML = vistas.processos(); ligar(v); ligarVista(); const i = $('#im-b', v); i.focus(); i.setSelectionRange(pos, pos); });
  }
  ligarVista();

  // ------------------------------------------------------------ processo aberto
  function detalhe(p) {
    const I = itensDe(p.id), C = cambDe(p.id), Dz = despDe(p.id), cob = coberturaCambio(I, C), cf = custoDe(p), al = alDe(p.id), aberto = !['encerrado', 'cancelado'].includes(p.status), edita = pode && aberto;
    const prox = proximaEtapa(p.status), ord = ETAPA[p.status]?.ordem ?? -1;
    const cab = `<div class="card"><div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:240px"><h2 style="margin:0">${numeroProcesso(p)} ${st(p.status)}</h2>
        <div><b>${esc(forn(p.favorecido_id))}</b>${p.referencia ? ` · ref. ${esc(p.referencia)}` : ''}</div><div class="small muted">${esc([p.pais_origem, INCOTERMS[p.incoterm]?.split(' — ')[0], MODAL[p.modal], p.local_embarque && p.local_destino ? `${p.local_embarque} → ${p.local_destino}` : p.local_destino].filter(Boolean).join(' · '))}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${edita && p.status === 'desembaracado' ? '<button class="btn primary" id="im-rec">Receber no estoque</button>' : ''}
          ${edita && prox && !(p.status === 'desembaracado') ? `<button class="btn ${p.status === 'recebido' ? 'ghost' : 'primary'}" id="im-av">Avançar: ${esc(ETAPA[prox].nome)}</button>` : ''}
          ${edita && p.status === 'recebido' && I.some(i => +i.qtd_recebida < +i.quantidade) ? '<button class="btn ghost" id="im-rec">Receber o saldo</button>' : ''}
          ${edita ? '<button class="btn ghost" id="im-ed">Editar dados</button><button class="btn ghost" id="im-canc">Cancelar processo</button>' : ''}${pode && !aberto ? '<button class="btn ghost" id="im-reab">Reabrir</button>' : ''}
          ${pode && p.status === 'negociacao' ? '<button class="btn ghost" id="im-exc">Excluir</button>' : ''}</div></div>
      ${p.status === 'cancelado' ? `<p class="neg" style="margin:8px 0 0">Cancelado: ${esc(p.motivo_cancelamento || '')}</p>` : `<div class="im-passos">${ETAPAS.map(([k, n], i) => `<div class="im-passo ${i < ord ? 'ok' : i === ord ? 'at ok' : ''}">${esc(n)}<small>${dateBR(p[DATA_ETAPA[k]] || (k === 'embarcado' && i > ord ? p.embarque_previsto : k === 'chegada' && i > ord ? p.chegada_prevista : '')) || '&nbsp;'}</small></div>`).join('')}</div>`}
      ${al.length ? `<ul class="small" style="margin:8px 0 0;padding-left:18px">${al.map(a => `<li class="${a.nivel === 'alto' ? 'neg' : ''}">${esc(a.texto.replace(/^IMP \d+: /, ''))}</li>`).join('')}</ul>` : ''}</div>`;
    const sub = {
      resumo: () => `<div class="im-res"><div><span>Mercadoria</span><b>${fm(cob.fob, p.moeda)}</b></div><div><span>Taxa ${{ declaracao: 'da declaração', prevista: 'prevista', cotacao: 'da última cotação', sem_taxa: '' }[cf.taxa_origem]}</span><b>${cf.taxa ? nv(cf.taxa, 4) : '—'}</b></div>
          <div><span>Mercadoria em reais</span><b>${cf.taxa ? money(cf.fob_brl) : '—'}</b></div><div><span>Despesas no custo</span><b>${money(cf.despesas_custo)}</b></div><div><span>Custo total</span><b>${cf.taxa ? money(cf.custo_total) : '—'}</b></div>
          <div><span>Câmbio liquidado</span><b>${cob.fob ? (cob.liquidado / cob.fob * 100).toFixed(0) : 0}%</b></div></div>
        <div class="card"><div class="im-g small">
          ${[['Proforma', p.proforma], ['Fatura comercial', p.invoice], ['Conhecimento de embarque', p.conhecimento], ['Navio / voo', p.navio], ['Contêineres', p.containers], ['Declaração (DI / DUIMP)', p.declaracao],
             ['Canal', p.canal ? CANAL[p.canal][0] : ''], ['Despachante', p.despachante_id ? forn(p.despachante_id) : ''], ['Agente de carga', p.agente_id ? forn(p.agente_id) : ''], ['Embarque previsto', dateBR(p.embarque_previsto)], ['Chegada prevista', dateBR(p.chegada_prevista)],
             ['Dias livres do contêiner', p.free_time_dias], ['Devolver o contêiner até', dateBR(p.data_devolucao_container)], ['Peso líquido / bruto', p.peso_liquido || p.peso_bruto ? `${nv(p.peso_liquido, 0)} / ${nv(p.peso_bruto, 0)} kg` : ''], ['Taxa prevista', p.taxa_prevista ? nv(p.taxa_prevista, 4) : ''], ['Taxa da declaração', p.taxa_di ? nv(p.taxa_di, 4) : '']]
            .map(([r, v]) => `<div class="c2"><span class="muted">${r}</span><div><b>${esc(v == null || v === '' ? '—' : v)}</b></div></div>`).join('')}
          ${p.observacao ? `<div class="c6"><span class="muted">Observação</span><div>${esc(p.observacao)}</div></div>` : ''}</div></div>`,
      itens: () => `<div class="card flush"><div class="table-wrap"><table class="im-it"><thead><tr><th>Item</th><th>NCM</th><th class="num">Quantidade</th><th class="num">Preço (${p.moeda})</th><th class="num">Total (${p.moeda})</th><th class="num">II %</th><th class="num">IPI %</th><th class="num">PIS %</th><th class="num">COFINS %</th><th class="num">ICMS %</th><th class="num">Recebido</th><th></th></tr></thead><tbody>
        ${I.map(i => `<tr><td class="wrap"><b>${esc(i.descricao)}</b>${i.produto_id ? `<div class="small muted">${esc(prods.find(x => x.id === i.produto_id)?.codigo || '')}</div>` : '<div class="small warn">sem produto do estoque</div>'}</td><td>${esc(i.ncm || '')}</td><td class="num">${nv(i.quantidade, 0)} ${esc(i.unidade)}</td><td class="num">${nv(i.valor_unitario, 4)}</td><td class="num">${nv(i.quantidade * i.valor_unitario)}</td>
          ${['aliq_ii', 'aliq_ipi', 'aliq_pis', 'aliq_cofins', 'aliq_icms'].map(k => `<td class="num">${nv(i[k], 2)}</td>`).join('')}<td class="num">${+i.qtd_recebida ? nv(i.qtd_recebida, 0) : '—'}</td>
          <td style="white-space:nowrap">${edita ? `<button class="btn ghost small" data-it="${i.id}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="12" class="empty">Nenhum item. Inclua a matéria-prima deste processo.</td></tr>'}</tbody>
        ${I.length ? `<tfoot><tr><td colspan="4"><b>${I.length} item(ns)</b></td><td class="num"><b>${nv(cob.fob)}</b></td><td colspan="7"></td></tr></tfoot>` : ''}</table></div></div>${edita ? '<p><button class="btn" id="im-nit">+ Incluir item</button></p>' : ''}
        <p class="small muted">As alíquotas servem ao custo estimado. Os impostos realmente pagos entram em Despesas, pelo valor da declaração.</p>`,
      cambio: () => `<div class="im-res"><div><span>Mercadoria</span><b>${fm(cob.fob, p.moeda)}</b></div><div><span>Liquidado</span><b>${fm(cob.liquidado, p.moeda)}</b></div><div><span>Contratado</span><b>${fm(cob.contratado, p.moeda)}</b></div><div><span>Previsto</span><b>${fm(cob.previsto, p.moeda)}</b></div>
          <div><span>Sem programação</span><b class="${cob.sem_programar > 0.005 ? 'warn' : ''}">${fm(cob.sem_programar, p.moeda)}</b></div><div><span>Variação cambial</span><b class="${cf.variacao_cambial > 0 ? 'neg' : cf.variacao_cambial < 0 ? 'pos' : ''}">${cf.variacao_cambial == null || !cf.cambio_liquidado_moeda ? '—' : money(cf.variacao_cambial)}</b></div></div>
        <div class="im-bar" style="margin-bottom:10px">${cob.fob ? `<i style="width:${cob.liquidado / cob.fob * 100}%;background:var(--pos)"></i><i style="width:${cob.contratado / cob.fob * 100}%;background:var(--warn)"></i><i style="width:${cob.previsto / cob.fob * 100}%;background:var(--primary)"></i>` : ''}</div>
        ${tabCambio(C.map(c => ({ ...c, moeda: p.moeda })), false)}${edita ? '<p><button class="btn" id="im-ncb">+ Programar pagamento</button></p>' : ''}
        <p class="small muted"><b>Previsto</b>: valor e data combinados, ainda sem taxa. <b>Contratado</b>: câmbio fechado com o banco, taxa travada. <b>Liquidado</b>: pago; o título é baixado na conta escolhida.${cfg.gerar_titulos && cfg.plano_mercadoria_id ? ' Cada pagamento gera um título a pagar no financeiro e o mantém atualizado.' : ' Os títulos no financeiro estão desligados ou sem conta do plano nos Parâmetros.'}</p>`,
      despesas: () => { const G = {}; for (const d of Dz) (G[CATEGORIAS[d.categoria][1]] ||= []).push(d);
        return `<div class="im-res"><div><span>Total de despesas</span><b>${money(Dz.reduce((s, d) => s + +d.valor, 0))}</b></div><div><span>Entram no custo</span><b>${money(cf.despesas_custo)}</b></div><div><span>Fora do custo</span><b>${money(cf.despesas_fora)}</b></div><div><span>Impostos recuperáveis</span><b>${money(cf.impostos_recuperaveis)}</b></div><div><span>Pagas</span><b>${money(Dz.filter(d => d.pago).reduce((s, d) => s + +d.valor, 0))}</b></div></div>
        <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Despesa</th><th>Fornecedor</th><th>Vencimento</th><th class="num">Valor</th><th>No custo</th><th>Situação</th><th></th></tr></thead><tbody>
        ${Object.entries(G).map(([g, L]) => `<tr><td colspan="7" class="small muted" style="background:var(--surface-2)"><b>${esc(g)}</b> · ${money(L.reduce((s, d) => s + +d.valor, 0))}</td></tr>` + L.map(d => `<tr><td class="wrap"><b>${esc(CATEGORIAS[d.categoria][0])}</b>${d.descricao ? `<div class="small muted">${esc(d.descricao)}</div>` : ''}${d.item_id ? `<div class="small muted">só para: ${esc(I.find(i => i.id === d.item_id)?.descricao || '')}</div>` : ''}</td>
          <td class="wrap">${esc(d.favorecido_id ? forn(d.favorecido_id) : '—')}${d.documento ? `<div class="small muted">${esc(d.documento)}</div>` : ''}</td><td>${dateBR(d.vencimento)}</td><td class="num">${money(d.valor)}${d.valor_moeda ? `<div class="small muted">${fm(d.valor_moeda, p.moeda)} × ${nv(d.taxa, 4)}</div>` : ''}</td>
          <td>${d.compoe_custo ? '<span class="im-st pos">sim</span>' : '<span class="im-st">não</span>'}</td><td>${d.pago ? `<span class="im-st pos">paga</span><div class="small muted">${dateBR(d.data_pagamento)}</div>` : '<span class="im-st warn">em aberto</span>'}</td>
          <td>${edita ? `<button class="btn ghost small" data-dp="${d.id}">Editar</button>` : ''}</td></tr>`).join('')).join('') || '<tr><td colspan="7" class="empty">Nenhuma despesa lançada.</td></tr>'}</tbody></table></div></div>
        ${edita ? '<p><button class="btn" id="im-ndp">+ Lançar despesa</button> <button class="btn ghost" id="im-imp">Lançar os impostos da declaração</button></p>' : ''}
        <p class="small muted">Imposto recuperável (ICMS, IPI, PIS e COFINS, conforme os Parâmetros), despesa bancária, multa e demurrage nascem <b>fora do custo</b>; você pode mudar em cada despesa.</p>`; },
      custo: () => { const prem = { taxa: p.taxa_prevista || cotDe(p.moeda) || '', afrmm_pct: p.modal === 'maritimo' ? 8 : 0, ...(p.estimativa || {}) }, est = estimar(I, { ...prem, rateio: p.rateio || cfg.rateio, recupera_icms: cfg.recupera_icms, recupera_ipi: cfg.recupera_ipi, recupera_pis_cofins: cfg.recupera_pis_cofins });
        return `<div class="card"><h3 style="margin-top:0">Custo estimado <span class="small muted" style="font-weight:400">antes das despesas reais, pelas alíquotas dos itens</span></h3>
          <div class="im-g" id="im-prem"><label>Taxa de câmbio<input name="taxa" value="${nv(prem.taxa, 4)}" inputmode="decimal" ${edita ? '' : 'disabled'}></label><label>Frete internacional (${p.moeda})<input name="frete" value="${nv(prem.frete)}" inputmode="decimal" ${edita ? '' : 'disabled'}></label>
            <label>Seguro (${p.moeda})<input name="seguro" value="${nv(prem.seguro)}" inputmode="decimal" ${edita ? '' : 'disabled'}></label><label>Taxa Siscomex (R$)<input name="siscomex" value="${nv(prem.siscomex)}" inputmode="decimal" ${edita ? '' : 'disabled'}></label>
            <label>AFRMM (% do frete)<input name="afrmm_pct" value="${nv(prem.afrmm_pct)}" inputmode="decimal" ${edita ? '' : 'disabled'}></label><label>Porto, despachante e frete interno (R$)<input name="despesas" value="${nv(prem.despesas)}" inputmode="decimal" ${edita ? '' : 'disabled'}></label></div>
          ${freteNoPreco(p.incoterm) ? `<p class="small muted">No ${p.incoterm} o frete internacional já está no preço do exportador${seguroNoPreco(p.incoterm) ? ', e o seguro também' : ''}: deixe esses campos em branco.</p>` : ''}
          ${edita ? '<p><button class="btn ghost small" id="im-sprem">Salvar as premissas</button></p>' : ''}
          <div class="im-res"><div><span>Valor aduaneiro</span><b>${money(est.valor_aduaneiro)}</b></div><div><span>II</span><b>${money(est.ii)}</b></div><div><span>IPI</span><b>${money(est.ipi)}</b></div><div><span>PIS + COFINS</span><b>${money(est.pis + est.cofins)}</b></div><div><span>ICMS</span><b>${money(est.icms)}</b></div>
            <div><span>Desembolso total</span><b>${money(est.desembolso)}</b></div><div><span>Impostos recuperáveis</span><b>${money(est.recuperavel)}</b></div><div><span>Custo estimado</span><b>${money(est.custo_total)}</b></div></div></div>
        <div class="card" style="margin-top:12px"><h3 style="margin-top:0">Custo final <span class="small muted" style="font-weight:400">mercadoria pela taxa ${{ declaracao: 'da declaração', prevista: 'prevista (ainda sem a da declaração)', cotacao: 'da última cotação', sem_taxa: '— informe a taxa' }[cf.taxa_origem]}, mais as despesas lançadas; rateio por ${cf.rateio === 'peso' ? 'peso' : 'valor'}</span></h3>
          <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Quantidade</th><th class="num">Mercadoria (R$)</th><th class="num">Despesas</th><th class="num">Custo total</th><th class="num">Estimado / un.</th><th class="num">Final / un.</th><th class="num">Diferença</th></tr></thead><tbody>
          ${cf.itens.map((x, k) => { const e1 = est.itens[k]?.custo_unitario || 0, dif = e1 ? x.custo_unitario / e1 - 1 : null; return `<tr><td class="wrap">${esc(x.descricao)}</td><td class="num">${nv(x.quantidade, 0)} ${esc(x.unidade)}</td><td class="num">${money(x.fob_brl)}</td><td class="num">${money(x.despesas)}</td><td class="num"><b>${money(x.custo_total)}</b></td>
            <td class="num">${e1 ? nv(e1, 4) : '—'}</td><td class="num"><b>${cf.taxa ? nv(x.custo_unitario, 4) : '—'}</b></td><td class="num ${dif > 0.02 ? 'neg' : dif < -0.02 ? 'pos' : ''}">${dif == null || !cf.taxa ? '—' : (dif * 100).toFixed(1).replace('.', ',') + '%'}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Inclua os itens.</td></tr>'}</tbody>
          ${cf.itens.length ? `<tfoot><tr><td colspan="2"><b>Total</b></td><td class="num"><b>${money(cf.fob_brl)}</b></td><td class="num"><b>${money(cf.despesas_custo)}</b></td><td class="num"><b>${money(cf.custo_total)}</b></td><td colspan="3" class="num">${cf.fator ? `custo ÷ mercadoria: <b>${nv(cf.fator, 3)}</b>` : ''}</td></tr></tfoot>` : ''}</table></div>
          <p class="small muted">${Dz.length ? '' : 'Ainda sem despesas lançadas: o custo final só tem a mercadoria. '}Fora do custo: ${money(cf.despesas_fora)} (${money(cf.impostos_recuperaveis)} de impostos recuperáveis).${cf.variacao_cambial != null && cf.cambio_liquidado_moeda ? ` Variação cambial do que já foi pago: ${money(cf.variacao_cambial)}.` : ''}
            ${p.data_recebimento && Dz.some(d => d.compoe_custo && String(d.criado_em).slice(0, 10) > p.data_recebimento) ? '<span class="neg"> Há despesa lançada depois do recebimento: ela não entrou no custo que foi para o estoque.</span>' : ''}</p></div>`; },
      docs: () => '<div id="im-docs"><div class="loading">Carregando…</div></div>',
      hist: () => '<div id="im-hist"><div class="loading">Carregando…</div></div>',
    };
    corpo.innerHTML = `${cab}<div class="chips tabs" id="im-pabas" style="margin:12px 0">${PABAS.map(([k, t]) => `<span class="chip ${ui.paba === k ? 'on' : ''}" data-paba="${k}">${t}${k === 'itens' ? ` (${I.length})` : k === 'cambio' ? ` (${C.length})` : k === 'despesas' ? ` (${Dz.length})` : ''}</span>`).join('')}</div><div id="im-sub">${sub[ui.paba]()}</div>`;
    $$('#im-pabas [data-paba]', corpo).forEach(b => b.onclick = () => { ui.paba = b.dataset.paba; re(); });
    ligar(corpo);
    const on = (s, f) => $(s, corpo) && ($(s, corpo).onclick = f);
    on('#im-ed', () => editarProcesso(p)); on('#im-av', () => avancar(p, prox, I)); on('#im-rec', () => receber(p, I, cf));
    on('#im-canc', () => modal({ title: `Cancelar ${numeroProcesso(p)}`, narrow: true, body: '<label>Motivo do cancelamento<textarea id="im-mot" rows="3"></textarea></label><p class="small muted">Os títulos em aberto do processo continuam no financeiro: exclua os pagamentos e as despesas que não vão acontecer.</p>',
      foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="im-scanc">Cancelar o processo</button>',
      onMount: (m, close) => { $('#im-scanc', m).onclick = async () => { const t = $('#im-mot', m).value.trim(); if (!t) return toast('Informe o motivo.', true);
        try { await q(sb.from('imp_processos').update({ status: 'cancelado', motivo_cancelamento: t }).eq('id', p.id)); close(); toast('Processo cancelado.'); re(); } catch (err) { fail(err); } }; } }));
    on('#im-reab', async () => { if (!await confirmDialog(`Reabrir o processo ${numeroProcesso(p)}?`)) return; try { await q(sb.from('imp_processos').update({ status: p.status === 'cancelado' ? 'negociacao' : 'recebido' }).eq('id', p.id)); toast('Processo reaberto.'); re(); } catch (err) { fail(err); } });
    on('#im-exc', async () => { if (!await confirmDialog(`Excluir o processo ${numeroProcesso(p)} e tudo o que foi lançado nele?`)) return; try { await q(sb.from('imp_processos').delete().eq('id', p.id)); ui.proc = null; toast('Processo excluído.'); re(); } catch (err) { fail(err); } });
    on('#im-nit', () => item(p, null)); $$('[data-it]', corpo).forEach(b => b.onclick = () => item(p, I.find(i => i.id === b.dataset.it)));
    on('#im-ncb', () => cambio(null, p, 'editar')); on('#im-ndp', () => despesa(p, null, I)); on('#im-imp', () => impostos(p));
    $$('[data-dp]', corpo).forEach(b => b.onclick = () => despesa(p, Dz.find(d => d.id === b.dataset.dp), I));
    on('#im-sprem', async () => { const est = Object.fromEntries($$('#im-prem input', corpo).map(i => [i.name, pn(i.value) || null]));
      try { await q(sb.from('imp_processos').update({ estimativa: est }).eq('id', p.id)); toast('Premissas salvas.'); re(); } catch (err) { fail(err); } });
    if (ui.paba === 'docs') documentos(p, edita);
    if (ui.paba === 'hist') historico(p);
  }

  // ------------------------------------------------------------ formulários
  function editarProcesso(p) {
    const n = p || { moeda: cfg.moeda_padrao, incoterm: 'FOB', modal: 'maritimo', free_time_dias: cfg.free_time_padrao, taxa_prevista: cotDe(cfg.moeda_padrao) };
    const F = cad.fornecedores, d = (k) => esc(n[k] ?? ''), dt = (k, r) => `<label>${r}<input type="date" name="${k}" value="${d(k)}"></label>`;
    modal({ title: p ? `Editar ${numeroProcesso(p)}` : 'Novo processo de importação', wide: true, body: `<form id="im-fp"><div class="im-g">
        <label class="c3">Exportador<select name="favorecido_id" required>${options(F, { selected: n.favorecido_id, empty: 'Escolha…' })}</select></label><label class="c2">Referência do exportador / pedido<input name="referencia" value="${d('referencia')}"></label><label>País de origem<input name="pais_origem" value="${d('pais_origem')}"></label>
        <label class="c2">Incoterm<select name="incoterm">${Object.entries(INCOTERMS).map(([k, t]) => `<option value="${k}" ${n.incoterm === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Moeda<select name="moeda">${Object.entries(MOEDAS).map(([k, t]) => `<option value="${k}" ${n.moeda === k ? 'selected' : ''}>${k} — ${esc(t)}</option>`).join('')}</select></label><label>Taxa prevista<input name="taxa_prevista" value="${nv(n.taxa_prevista, 4)}" inputmode="decimal"></label>
        <label>Transporte<select name="modal">${Object.entries(MODAL).map(([k, t]) => `<option value="${k}" ${n.modal === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>Rateio das despesas<select name="rateio"><option value="">Padrão (${cfg.rateio === 'peso' ? 'peso' : 'valor'})</option><option value="valor" ${n.rateio === 'valor' ? 'selected' : ''}>Pelo valor</option><option value="peso" ${n.rateio === 'peso' ? 'selected' : ''}>Pelo peso</option></select></label>
        <label class="c3">Local de embarque<input name="local_embarque" value="${d('local_embarque')}" placeholder="porto ou aeroporto de origem"></label><label class="c3">Local de destino<input name="local_destino" value="${d('local_destino')}" placeholder="ex.: Porto de Suape"></label>
        ${dt('embarque_previsto', 'Embarque previsto')}${dt('chegada_prevista', 'Chegada prevista')}<label class="c2">Proforma<input name="proforma" value="${d('proforma')}"></label><label class="c2">Fatura comercial (invoice)<input name="invoice" value="${d('invoice')}"></label>
        ${p ? `<label class="c2">Conhecimento (BL / AWB / CRT)<input name="conhecimento" value="${d('conhecimento')}"></label><label class="c2">Navio / voo<input name="navio" value="${d('navio')}"></label><label class="c2">Contêineres<input name="containers" value="${d('containers')}"></label>
          <label class="c2">Declaração (DI / DUIMP)<input name="declaracao" value="${d('declaracao')}"></label><label>Taxa da declaração<input name="taxa_di" value="${nv(n.taxa_di, 4)}" inputmode="decimal"></label><label>Canal<select name="canal"><option value=""></option>${Object.entries(CANAL).map(([k, t]) => `<option value="${k}" ${n.canal === k ? 'selected' : ''}>${t[0]}</option>`).join('')}</select></label>
          <label>Dias livres do contêiner<input name="free_time_dias" type="number" min="0" max="120" value="${d('free_time_dias')}"></label><label>Devolver até<input type="date" name="data_devolucao_container" value="${d('data_devolucao_container')}"></label>
          <label class="c3">Despachante<select name="despachante_id">${options(F, { selected: n.despachante_id, empty: '—' })}</select></label><label class="c3">Agente de carga<select name="agente_id">${options(F, { selected: n.agente_id, empty: '—' })}</select></label>
          <label>Peso líquido (kg)<input name="peso_liquido" value="${nv(n.peso_liquido, 0)}" inputmode="decimal"></label><label>Peso bruto (kg)<input name="peso_bruto" value="${nv(n.peso_bruto, 0)}" inputmode="decimal"></label>
          ${Object.entries(DATA_ETAPA).filter(([k]) => (ETAPA[k].ordem <= ETAPA[p.status]?.ordem)).map(([k, c]) => dt(c, ETAPA[k].nome)).join('')}` : ''}
        <label class="c6">Observação<textarea name="observacao" rows="2">${d('observacao')}</textarea></label></div></form>
        ${F.length ? '' : '<p class="small neg">Cadastre o exportador em Cadastros › Beneficiários antes de abrir o processo.</p>'}`,
      foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="im-sp">Salvar</button>',
      onMount: (m, close) => { $('#im-sp', m).onclick = async () => { const f = Object.fromEntries(new FormData($('#im-fp', m)));
        if (!f.favorecido_id) return toast('Escolha o exportador.', true);
        const row = {}; for (const [k, v] of Object.entries(f)) row[k] = ['taxa_prevista', 'taxa_di', 'peso_liquido', 'peso_bruto'].includes(k) ? (pn(v) || null) : k === 'free_time_dias' ? (v === '' ? null : +v) : (String(v).trim() || null);
        try { if (p) await q(sb.from('imp_processos').update(row).eq('id', p.id)); else { const r = await q(sb.from('imp_processos').insert({ ...row, empresa_id: e }).select('id')); ui.proc = r[0]?.id || null; ui.paba = 'itens'; }
          close(); toast(p ? 'Processo atualizado.' : 'Processo aberto. Inclua os itens.'); re(); } catch (err) { fail(err); } }; } });
  }
  function avancar(p, etapa, I) {
    const falta = faltaParaEtapa(p, I, etapa), campo = DATA_ETAPA[etapa];
    modal({ title: `Avançar para: ${ETAPA[etapa].nome}`, narrow: true, body: `<p class="small muted">${esc(ETAPA[etapa].desc)}</p>${falta.length ? `<div class="card im-al alto"><b>Antes de avançar:</b><ul style="margin:4px 0 0;padding-left:18px">${falta.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        <form id="im-fa"><div class="im-g">${campo ? `<label class="c3">Data<input type="date" name="data" value="${hoje}" max="${hoje}"></label>` : ''}
        ${etapa === 'pedido' ? '<label class="c3">Embarque previsto<input type="date" name="embarque_previsto" value="' + esc(p.embarque_previsto || '') + '"></label>' : ''}
        ${etapa === 'embarcado' ? `<label class="c3">Chegada prevista<input type="date" name="chegada_prevista" value="${esc(p.chegada_prevista || '')}"></label><label class="c3">Conhecimento (BL / AWB / CRT)<input name="conhecimento" value="${esc(p.conhecimento || '')}"></label><label class="c3">Navio / voo<input name="navio" value="${esc(p.navio || '')}"></label><label class="c6">Contêineres<input name="containers" value="${esc(p.containers || '')}"></label>` : ''}
        ${etapa === 'registro' ? `<label class="c3">Declaração (DI / DUIMP)<input name="declaracao" value="${esc(p.declaracao || '')}"></label><label class="c3">Taxa de câmbio da declaração<input name="taxa_di" value="${nv(p.taxa_di || cotDe(p.moeda), 4)}" inputmode="decimal"></label><label class="c3">Canal<select name="canal"><option value=""></option>${Object.entries(CANAL).map(([k, t]) => `<option value="${k}" ${p.canal === k ? 'selected' : ''}>${t[0]}</option>`).join('')}</select></label>` : ''}</div></form>
        ${etapa === 'registro' ? '<p class="small muted">A taxa da declaração é a que forma o custo da mercadoria. Depois de avançar, lance os impostos pagos em Despesas.</p>' : ''}`,
      foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="im-sa">Avançar</button>',
      onMount: (m, close) => { $('#im-sa', m).onclick = async () => { const f = Object.fromEntries(new FormData($('#im-fa', m))), row = { status: etapa };
        if (campo && f.data) row[campo] = f.data; for (const k of ['embarque_previsto', 'chegada_prevista', 'conhecimento', 'navio', 'containers', 'declaracao', 'canal']) if (k in f) row[k] = String(f[k]).trim() || null;
        if ('taxa_di' in f) row.taxa_di = pn(f.taxa_di) || null;
        const ainda = faltaParaEtapa({ ...p, ...row }, I, etapa); if (ainda.length) return toast(ainda[0], true);
        try { await q(sb.from('imp_processos').update(row).eq('id', p.id)); close(); toast(`Etapa: ${ETAPA[etapa].nome}.`); if (etapa === 'registro') ui.paba = 'despesas'; re(); } catch (err) { fail(err); } }; } });
  }
  function item(p, it) {
    const n = it || { unidade: 'KG' }, d = (k) => esc(n[k] ?? '');
    modal({ title: it ? 'Editar item' : 'Incluir item', body: `<form id="im-fi"><div class="im-g">
        <label class="c6">Produto do estoque<select name="produto_id"><option value="">— sem ligar ao estoque —</option>${prods.filter(x => x.ativo !== false && ['materia_prima', 'aditivo', 'tinta_solvente', 'embalagem', 'outro'].includes(x.tipo) || x.id === n.produto_id).map(x => `<option value="${x.id}" ${n.produto_id === x.id ? 'selected' : ''}>${esc(x.codigo)} — ${esc(x.descricao)}</option>`).join('')}</select></label>
        <label class="c4">Descrição<input name="descricao" value="${d('descricao')}" required></label><label class="c2">NCM<input name="ncm" value="${d('ncm')}" maxlength="10"></label>
        <label class="c2">Quantidade<input name="quantidade" value="${nv(n.quantidade, 3)}" inputmode="decimal" required></label><label>Unidade<input name="unidade" value="${d('unidade')}" maxlength="6"></label><label class="c2">Preço unitário (${p.moeda})<input name="valor_unitario" value="${nv(n.valor_unitario, 4)}" inputmode="decimal" required></label><label>Peso líq. (kg)<input name="peso_liquido" value="${nv(n.peso_liquido, 0)}" inputmode="decimal"></label>
        ${[['aliq_ii', 'II %'], ['aliq_ipi', 'IPI %'], ['aliq_pis', 'PIS %'], ['aliq_cofins', 'COFINS %'], ['aliq_icms', 'ICMS %']].map(([k, r]) => `<label>${r}<input name="${k}" value="${nv(n[k] || 0, 2)}" inputmode="decimal"></label>`).join('')}<label>Lote<input name="lote" value="${d('lote')}"></label></div></form>
        <p class="small muted">Ligue o item a um produto do estoque para que o recebimento dê entrada no Kardex com o custo final. As alíquotas vêm da classificação fiscal (NCM): confira com o despachante ou a contabilidade.</p>`,
      foot: `${it && !+it.qtd_recebida ? '<button class="btn ghost" id="im-xi" style="margin-right:auto">Excluir</button>' : ''}<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="im-si">Salvar</button>`,
      onMount: (m, close) => { const sel = $('[name=produto_id]', m); sel.onchange = () => { const x = prods.find(y => y.id === sel.value); if (!x) return; const f = $('#im-fi', m); if (!f.descricao.value) f.descricao.value = x.descricao; if (!f.ncm.value) f.ncm.value = x.ncm || ''; f.unidade.value = x.unidade || f.unidade.value; };
        $('#im-xi', m) && ($('#im-xi', m).onclick = async () => { try { await q(sb.from('imp_itens').delete().eq('id', it.id)); close(); re(); } catch (err) { fail(err); } });
        $('#im-si', m).onclick = async () => { const f = Object.fromEntries(new FormData($('#im-fi', m)));
          const row = { produto_id: f.produto_id || null, descricao: f.descricao.trim(), ncm: f.ncm.replace(/\D/g, '') || null, unidade: (f.unidade || 'KG').trim().toUpperCase(), quantidade: pn(f.quantidade), valor_unitario: pn(f.valor_unitario), peso_liquido: pn(f.peso_liquido) || null, lote: f.lote.trim() || null };
          for (const k of ['aliq_ii', 'aliq_ipi', 'aliq_pis', 'aliq_cofins', 'aliq_icms']) row[k] = pn(f[k]);
          if (!row.descricao || !(row.quantidade > 0)) return toast('Informe a descrição e a quantidade.', true);
          try { if (it) await q(sb.from('imp_itens').update(row).eq('id', it.id)); else await q(sb.from('imp_itens').insert({ ...row, empresa_id: e, processo_id: p.id, ordem: itensDe(p.id).length + 1 })); close(); re(); } catch (err) { fail(err); } }; } });
  }
  function cambio(c, p, modo) {
    p = p || D.Pr.find(x => x.id === c.processo_id); const cob = coberturaCambio(itensDe(p.id), cambDe(p.id));
    const n = c || { tipo: cambDe(p.id).length ? 'saldo' : 'adiantamento', valor_moeda: Math.max(0, cob.sem_programar), vencimento: hoje, status: 'previsto' };
    const alvo = modo === 'contratar' ? 'contratado' : modo === 'liquidar' ? 'liquidado' : n.status, tx0 = +n.taxa || cotDe(p.moeda) || +p.taxa_prevista || '';
    modal({ title: `${modo === 'contratar' ? 'Contratar o câmbio' : modo === 'liquidar' ? 'Liquidar o câmbio' : c ? 'Editar pagamento' : 'Programar pagamento'} — ${numeroProcesso(p)}`, body: `<form id="im-fc"><div class="im-g">
        <label class="c2">Tipo<select name="tipo">${Object.entries(CAMBIO_TIPO).map(([k, t]) => `<option value="${k}" ${n.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label class="c2">Valor (${p.moeda})<input name="valor_moeda" value="${nv(n.valor_moeda)}" inputmode="decimal" required></label><label class="c2">Vencimento<input type="date" name="vencimento" value="${esc(n.vencimento)}" required></label>
        <label class="c2">Situação<select name="status">${Object.entries(CAMBIO_STATUS).map(([k, t]) => `<option value="${k}" ${alvo === k ? 'selected' : ''}>${t[0]}</option>`).join('')}</select></label>
        <label class="c2 im-ct">Taxa contratada<input name="taxa" value="${nv(tx0, 4)}" inputmode="decimal"></label><label class="c2 im-ct">Data da contratação<input type="date" name="data_contratacao" value="${esc(n.data_contratacao || hoje)}"></label>
        <label class="c2 im-ct">Contrato<input name="contrato" value="${esc(n.contrato || '')}"></label><label class="c2 im-ct">Banco / corretora<input name="banco" value="${esc(n.banco || '')}"></label>
        <label class="c2 im-lq">Data do pagamento<input type="date" name="data_liquidacao" value="${esc(n.data_liquidacao || hoje)}"></label><label class="c2 im-lq">Valor em reais<input name="valor_brl" value="${nv(n.valor_brl)}" inputmode="decimal" placeholder="valor × taxa"></label>
        <label class="c4 im-lq">Conta de onde saiu<select name="conta_id">${options(contas(), { selected: n.conta_id, empty: contas().length ? 'Escolha…' : 'sem acesso às contas' })}</select></label>
        <label class="c6">Observação<input name="observacao" value="${esc(n.observacao || '')}"></label></div></form><p class="small muted" id="im-cinfo"></p>`,
      foot: `${c && c.status !== 'liquidado' ? '<button class="btn ghost" id="im-xc" style="margin-right:auto">Excluir</button>' : ''}<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="im-sc">Salvar</button>`,
      onMount: (m, close) => { const f = $('#im-fc', m);
        const pintar = () => { const s = f.status.value; $$('.im-ct', m).forEach(x => x.style.display = s === 'previsto' ? 'none' : ''); $$('.im-lq', m).forEach(x => x.style.display = s === 'liquidado' ? '' : 'none');
          const v = pn(f.valor_moeda.value), t = pn(f.taxa.value); $('#im-cinfo', m).textContent = s === 'previsto' ? (cotDe(p.moeda) ? `Pela última cotação (${nv(cotDe(p.moeda), 4)}): ${money(v * cotDe(p.moeda))}.` : '') : t ? `${fm(v, p.moeda)} × ${nv(t, 4)} = ${money(v * t)}.${p.taxa_di ? ` Pela taxa da declaração seriam ${money(v * p.taxa_di)}: variação de ${money(v * t - v * p.taxa_di)}.` : ''}` : ''; };
        f.oninput = pintar; pintar();
        $('#im-xc', m) && ($('#im-xc', m).onclick = async () => { try { await q(sb.from('imp_cambios').delete().eq('id', c.id)); close(); re(); } catch (err) { fail(err); } });
        $('#im-sc', m).onclick = async () => { const s = f.status.value, row = { tipo: f.tipo.value, valor_moeda: pn(f.valor_moeda.value), vencimento: f.vencimento.value, status: s, observacao: f.observacao.value.trim() || null,
            taxa: s === 'previsto' ? null : pn(f.taxa.value) || null, data_contratacao: s === 'previsto' ? null : f.data_contratacao.value || null, contrato: s === 'previsto' ? null : f.contrato.value.trim() || null, banco: s === 'previsto' ? null : f.banco.value.trim() || null,
            data_liquidacao: s === 'liquidado' ? f.data_liquidacao.value || null : null, valor_brl: s === 'liquidado' ? (pn(f.valor_brl.value) || null) : null, conta_id: s === 'liquidado' ? f.conta_id.value || null : null };
          if (!(row.valor_moeda > 0) || !row.vencimento) return toast('Informe o valor e o vencimento.', true);
          if (s !== 'previsto' && (!row.taxa || !row.data_contratacao)) return toast('Informe a taxa e a data da contratação.', true);
          if (s === 'liquidado' && !row.conta_id && contas().length) return toast('Escolha a conta de onde saiu o pagamento.', true);
          try { if (c) await q(sb.from('imp_cambios').update(row).eq('id', c.id)); else await q(sb.from('imp_cambios').insert({ ...row, empresa_id: e, processo_id: p.id })); close(); toast('Pagamento salvo.'); re(); } catch (err) { fail(err); } }; } });
  }
  function despesa(p, d0, I) {
    const n = d0 || { categoria: 'frete_internacional', vencimento: hoje, compoe_custo: true };
    const recup = (k) => (k === 'icms' && cfg.recupera_icms) || (k === 'ipi' && cfg.recupera_ipi) || (['pis', 'cofins'].includes(k) && cfg.recupera_pis_cofins) || ['bancaria', 'multa', 'demurrage'].includes(k);
    modal({ title: d0 ? 'Editar despesa' : `Lançar despesa — ${numeroProcesso(p)}`, body: `<form id="im-fd"><div class="im-g">
        <label class="c3">Tipo<select name="categoria">${Object.entries(CATEGORIAS).map(([k, t]) => `<option value="${k}" ${n.categoria === k ? 'selected' : ''}>${esc(t[0])}</option>`).join('')}</select></label><label class="c3">Descrição<input name="descricao" value="${esc(n.descricao || '')}"></label>
        <label class="c2">Valor em ${p.moeda} (opcional)<input name="valor_moeda" value="${nv(n.valor_moeda)}" inputmode="decimal"></label><label class="c2">Taxa<input name="taxa" value="${nv(n.taxa || (n.valor_moeda ? '' : ''), 4)}" inputmode="decimal"></label><label class="c2">Valor em reais<input name="valor" value="${nv(n.valor)}" inputmode="decimal" required></label>
        <label class="c3">Fornecedor<select name="favorecido_id">${options(cad.fornecedores, { selected: n.favorecido_id, empty: '—' })}</select></label><label>Documento<input name="documento" value="${esc(n.documento || '')}"></label><label class="c2">Vencimento<input type="date" name="vencimento" value="${esc(n.vencimento)}" required></label>
        <label class="c3">Vale para<select name="item_id"><option value="">Todos os itens (rateada)</option>${I.map(i => `<option value="${i.id}" ${n.item_id === i.id ? 'selected' : ''}>${esc(i.descricao)}</option>`).join('')}</select></label>
        <label class="chk c3" style="align-self:end"><input type="checkbox" name="compoe_custo" ${n.compoe_custo ? 'checked' : ''}> Entra no custo da mercadoria</label>
        <label class="chk c2"><input type="checkbox" name="pago" ${n.pago ? 'checked' : ''}> Já foi paga</label><label class="c2 im-pg">Data do pagamento<input type="date" name="data_pagamento" value="${esc(n.data_pagamento || hoje)}"></label><label class="c2 im-pg">Conta<select name="conta_id">${options(contas(), { selected: n.conta_id, empty: contas().length ? 'Escolha…' : 'sem acesso às contas' })}</select></label></div></form>`,
      foot: `${d0 && !d0.pago ? '<button class="btn ghost" id="im-xd" style="margin-right:auto">Excluir</button>' : ''}<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="im-sd">Salvar</button>`,
      onMount: (m, close) => { const f = $('#im-fd', m);
        const pintar = () => $$('.im-pg', m).forEach(x => x.style.display = f.pago.checked ? '' : 'none'); f.pago.onchange = pintar; pintar();
        if (!d0) f.categoria.onchange = () => { f.compoe_custo.checked = !recup(f.categoria.value); }; if (!d0) f.compoe_custo.checked = !recup(f.categoria.value);
        const conv = () => { const v = pn(f.valor_moeda.value), t = pn(f.taxa.value); if (v && t) f.valor.value = nv(v * t); }; f.valor_moeda.oninput = conv; f.taxa.oninput = conv;
        $('#im-xd', m) && ($('#im-xd', m).onclick = async () => { try { await q(sb.from('imp_despesas').delete().eq('id', d0.id)); close(); re(); } catch (err) { fail(err); } });
        $('#im-sd', m).onclick = async () => { const row = { categoria: f.categoria.value, descricao: f.descricao.value.trim() || null, valor: pn(f.valor.value), valor_moeda: pn(f.valor_moeda.value) || null, taxa: pn(f.taxa.value) || null, favorecido_id: f.favorecido_id.value || null,
            documento: f.documento.value.trim() || null, vencimento: f.vencimento.value, item_id: f.item_id.value || null, compoe_custo: f.compoe_custo.checked, pago: f.pago.checked, data_pagamento: f.pago.checked ? f.data_pagamento.value || null : null, conta_id: f.pago.checked ? f.conta_id.value || null : null };
          if (!(row.valor > 0) || !row.vencimento) return toast('Informe o valor em reais e o vencimento.', true);
          try { if (d0) await q(sb.from('imp_despesas').update(row).eq('id', d0.id)); else { const r = await q(sb.from('imp_despesas').insert({ ...row, empresa_id: e, processo_id: p.id }).select('id,compoe_custo'));
              // na inclusão o banco tira do custo o imposto recuperável: se quem lançou marcou diferente, vale a escolha dele
              if (r[0] && r[0].compoe_custo !== row.compoe_custo) await q(sb.from('imp_despesas').update({ compoe_custo: row.compoe_custo }).eq('id', r[0].id)); }
            close(); toast('Despesa salva.'); re(); } catch (err) { fail(err); } }; } });
  }
  function impostos(p) {
    const L = ['ii', 'ipi', 'pis', 'cofins', 'icms', 'siscomex', 'afrmm'], ja = new Set(despDe(p.id).map(d => d.categoria));
    modal({ title: `Impostos da declaração — ${numeroProcesso(p)}`, body: `<p class="small muted">Digite os valores do extrato da declaração${p.declaracao ? ` ${esc(p.declaracao)}` : ''}. Em branco não é lançado.</p><form id="im-fx"><div class="im-g">
        ${L.map(k => `<label class="c2">${esc(CATEGORIAS[k][0])}${ja.has(k) ? ' <span class="small warn">já lançado</span>' : ''}<input name="${k}" inputmode="decimal"></label>`).join('')}
        <label class="c2">Data do débito<input type="date" name="data" value="${esc(p.data_registro || hoje)}"></label><label class="chk c2" style="align-self:end"><input type="checkbox" name="pago" checked> Já debitados</label>
        <label class="c2">Conta<select name="conta_id">${options(contas(), { empty: contas().length ? 'Escolha…' : 'sem acesso às contas' })}</select></label></div></form>
        <p class="small muted">${[cfg.recupera_icms && 'ICMS', cfg.recupera_ipi && 'IPI', cfg.recupera_pis_cofins && 'PIS e COFINS'].filter(Boolean).join(', ') || 'Nenhum imposto'} ${cfg.recupera_icms || cfg.recupera_ipi || cfg.recupera_pis_cofins ? 'ficam fora do custo por serem recuperáveis (Parâmetros).' : 'é tratado como recuperável: todos entram no custo.'}</p>`,
      foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="im-sx">Lançar</button>',
      onMount: (m, close) => { $('#im-sx', m).onclick = async () => { const f = $('#im-fx', m), rows = L.map(k => ({ k, v: pn(f[k].value) })).filter(x => x.v > 0)
          .map(x => ({ empresa_id: e, processo_id: p.id, categoria: x.k, valor: x.v, vencimento: f.data.value || hoje, documento: p.declaracao || null, pago: f.pago.checked, data_pagamento: f.pago.checked ? f.data.value || hoje : null, conta_id: f.pago.checked ? f.conta_id.value || null : null }));
        if (!rows.length) return toast('Informe ao menos um valor.', true);
        try { await q(sb.from('imp_despesas').insert(rows)); close(); toast(`${rows.length} imposto(s) lançado(s).`); re(); } catch (err) { fail(err); } }; } });
  }
  function receber(p, I, cf) {
    const pend = I.filter(i => +i.qtd_recebida < +i.quantidade), semProd = pend.filter(i => !i.produto_id), cu = (id) => cf.itens.find(x => x.item_id === id)?.custo_unitario;
    modal({ title: `Receber no estoque — ${numeroProcesso(p)}`, wide: true, body: `${!cf.taxa ? '<div class="card im-al alto">Informe a taxa de câmbio da declaração antes de receber: sem ela não há custo.</div>' : ''}
        <form id="im-fr"><div class="im-g" style="margin-bottom:10px"><label class="c2">Data do recebimento<input type="date" name="data" value="${hoje}" max="${hoje}"></label><label class="chk c4" style="align-self:end"><input type="checkbox" name="mov" checked> Dar entrada no estoque (Kardex) com o custo final</label></div>
        <div class="table-wrap"><table class="im-it"><thead><tr><th>Item</th><th class="num">Pedido</th><th class="num">Já recebido</th><th class="num" style="width:130px">Recebendo agora</th><th style="width:150px">Lote</th><th class="num">Custo por unidade</th><th class="num">Valor da entrada</th></tr></thead><tbody>
        ${pend.map(i => `<tr data-i="${i.id}"><td class="wrap"><b>${esc(i.descricao)}</b>${i.produto_id ? '' : '<div class="small warn">sem produto do estoque: só registra</div>'}</td><td class="num">${nv(i.quantidade, 0)} ${esc(i.unidade)}</td><td class="num">${nv(i.qtd_recebida, 0)}</td>
          <td><input class="num" name="q" value="${nv(i.quantidade - i.qtd_recebida, 3)}" inputmode="decimal"></td><td><input name="l" value="${esc(i.lote || '')}"></td><td class="num">${cu(i.id) ? 'R$ ' + nv(cu(i.id), 4) : '—'}</td><td class="num" data-v></td></tr>`).join('')}</tbody></table></div></form>
        <p class="small muted">O custo por unidade é o custo final de agora: mercadoria pela taxa ${cf.taxa_origem === 'declaracao' ? 'da declaração' : 'prevista'} mais ${money(cf.despesas_custo)} de despesas. Despesa lançada depois do recebimento não muda o que já entrou no estoque: lance tudo antes.${semProd.length ? ' Itens sem produto do estoque só têm a quantidade e o custo registrados.' : ''}
          ${p.nfe_nota_id ? '' : ' Se a entrada automática do estoque pelas notas estiver ligada para o CFOP de importação, desmarque a entrada aqui para não lançar duas vezes.'}</p>`,
      foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="im-sr">Confirmar o recebimento</button>',
      onMount: (m, close) => { const calc = () => $$('tr[data-i]', m).forEach(tr => { const c = cu(tr.dataset.i); $('[data-v]', tr).textContent = c ? money(pn($('[name=q]', tr).value) * c) : ''; }); m.oninput = calc; calc();
        $('#im-sr', m).onclick = async (ev) => { const f = $('#im-fr', m), itens = $$('tr[data-i]', m).map(tr => ({ item_id: tr.dataset.i, quantidade: pn($('[name=q]', tr).value), lote: $('[name=l]', tr).value.trim() })).filter(x => x.quantidade > 0);
          if (!itens.length) return toast('Informe a quantidade recebida.', true);
          ev.target.disabled = true;
          try { const r = await q(sb.rpc('imp_receber', { p_processo: p.id, p_data: f.data.value || hoje, p_itens: itens, p_movimentar: f.mov.checked })); close();
            toast(`Recebido: ${r.movimentos} item(ns) no estoque${r.registrados ? `, ${r.registrados} só registrado(s)` : ''}${r.faltam ? `; ${r.faltam} ainda com saldo` : ''}.`); ui.paba = 'custo'; re(); } catch (err) { fail(err); ev.target.disabled = false; } }; } });
  }
  async function documentos(p, edita) {
    const el = $('#im-docs', corpo); let L = [];
    try { L = await q(sb.from('imp_anexos').select('*').eq('processo_id', p.id).order('em')); } catch (err) { fail(err); }
    const esperados = ['proforma', 'invoice', 'packing', 'conhecimento', 'declaracao', 'cambio', 'nota'], tem = new Set(L.map(a => a.tipo));
    el.innerHTML = `<div class="card"><div class="small" style="margin-bottom:8px">${esperados.map(k => `<span class="im-st ${tem.has(k) ? 'pos' : ''}" style="margin:0 4px 4px 0">${tem.has(k) ? '✓' : '○'} ${esc(DOCS[k].split(' (')[0])}</span>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>Documento</th><th>Arquivo</th><th>Incluído em</th><th></th></tr></thead><tbody>${L.map(a => `<tr><td>${esc(DOCS[a.tipo] || a.tipo)}</td><td class="wrap"><a href="#" data-abrir="${esc(a.caminho)}">${esc(a.nome)}</a></td><td>${dateBR(String(a.em).slice(0, 10))}</td><td>${edita ? `<button class="btn ghost small" data-xa="${a.id}">Excluir</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum documento anexado.</td></tr>'}</tbody></table></div>
      ${edita ? `<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:10px"><label>Tipo<select id="im-dt">${Object.entries(DOCS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label><label>Arquivo (PDF, imagem, XML ou planilha, até 15 MB)<input type="file" id="im-df" accept=".pdf,.png,.jpg,.jpeg,.webp,.xml,.xlsx,.xls,.docx"></label><button class="btn" id="im-du">Anexar</button></div>` : ''}</div>`;
    $$('[data-abrir]', el).forEach(a => a.onclick = async (ev) => { ev.preventDefault(); const { data, error } = await sb.storage.from('importacao').createSignedUrl(a.dataset.abrir, 600); if (error) return fail(error); window.open(data.signedUrl, '_blank', 'noopener'); });
    $$('[data-xa]', el).forEach(b => b.onclick = async () => { const a = L.find(x => x.id === b.dataset.xa); if (!await confirmDialog(`Excluir "${a.nome}"?`)) return; try { await sb.storage.from('importacao').remove([a.caminho]); await q(sb.from('imp_anexos').delete().eq('id', a.id)); documentos(p, edita); } catch (err) { fail(err); } });
    $('#im-du', el) && ($('#im-du', el).onclick = async (ev) => { const f = $('#im-df', el).files[0]; if (!f) return toast('Escolha o arquivo.', true); if (f.size > 15728640) return toast('Arquivo acima de 15 MB.', true);
      ev.target.disabled = true; const path = `${e}/${p.id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.\-]+/g, '_').slice(-80)}`;
      try { const { error } = await sb.storage.from('importacao').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false }); if (error) throw error;
        await q(sb.from('imp_anexos').insert({ empresa_id: e, processo_id: p.id, tipo: $('#im-dt', el).value, nome: f.name, caminho: path, tamanho: f.size })); toast('Documento anexado.'); documentos(p, edita); } catch (err) { fail(err); ev.target.disabled = false; } });
  }
  async function historico(p) {
    const el = $('#im-hist', corpo); let L = [];
    try { L = await q(sb.from('imp_eventos').select('*').eq('processo_id', p.id).order('em')); } catch (err) { fail(err); }
    const dur = (i) => i > 0 ? diasEntre(L[i - 1].data, L[i].data) : null;
    el.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Data</th><th>O que aconteceu</th><th class="num">Dias desde a etapa anterior</th><th>Registrado em</th></tr></thead><tbody>
      ${L.map((x, i) => `<tr><td>${dateBR(x.data)}</td><td class="wrap"><b>${esc(x.etapa === 'recebimento' ? 'Recebimento' : ETAPA[x.etapa]?.nome || x.etapa)}</b>${x.texto ? `<div class="small muted">${esc(x.texto)}</div>` : ''}</td><td class="num">${dur(i) ?? ''}</td><td class="small muted">${new Date(x.em).toLocaleString('pt-BR')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sem registros.</td></tr>'}</tbody></table></div></div>
      ${p.data_pedido && (p.data_recebimento || p.data_chegada) ? `<p class="small muted">Do pedido ${p.data_recebimento ? 'ao recebimento' : 'à chegada ao porto'}: <b>${diasEntre(p.data_pedido, p.data_recebimento || p.data_chegada)} dias</b>.</p>` : ''}`;
  }
  async function cotacoes() {
    const moedas = [...new Set([cfg.moeda_padrao, ...D.Pr.map(p => p.moeda)])];
    modal({ title: 'Cotações das moedas', body: `<p class="small muted">A última cotação de venda (PTAX) serve à exposição cambial e à previsão dos títulos enquanto não há taxa contratada. Dólar e euro vêm do Banco Central; as demais são digitadas.</p>
        <div class="table-wrap"><table><thead><tr><th>Moeda</th><th>Data</th><th class="num">Compra</th><th class="num">Venda</th><th>Fonte</th></tr></thead><tbody>${D.Px.slice(0, 14).map(x => `<tr><td><b>${x.moeda}</b></td><td>${dateBR(x.data)}</td><td class="num">${x.compra ? nv(x.compra, 4) : '—'}</td><td class="num">${nv(x.venda, 4)}</td><td class="small muted">${esc(x.fonte)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma cotação gravada.</td></tr>'}</tbody></table></div>
        ${pode ? `<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:12px"><button class="btn primary" id="im-bcb">Buscar no Banco Central</button><span class="spacer"></span>
          <label>Moeda<select id="im-cm">${Object.keys(MOEDAS).map(k => `<option ${k === cfg.moeda_padrao ? 'selected' : ''}>${k}</option>`).join('')}</select></label><label>Data<input type="date" id="im-cd" value="${hoje}" max="${hoje}"></label><label>Venda<input id="im-cv" inputmode="decimal" style="width:110px"></label><button class="btn" id="im-cg">Gravar</button></div>` : ''}`,
      foot: '<button class="btn ghost" data-close>Fechar</button>',
      onMount: (m, close) => { const gravar = async (linhas) => { const n = await q(sb.rpc('imp_ptax_gravar', { p_empresa: e, p_linhas: linhas })); close(); toast(`${n} cotação(ões) gravada(s).`); re(); };
        $('#im-bcb', m) && ($('#im-bcb', m).onclick = async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Buscando…';
          try { const g = (c) => fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${c}/dados/ultimos/15?formato=json`).then(r => r.ok ? r.json() : []);
            const L = (await Promise.all(Object.keys(SGS).filter(k => moedas.includes(k) || k === 'USD').map(async k => lerSgs(k, await g(SGS[k].venda), await g(SGS[k].compra))))).flat();
            if (!L.length) throw new Error('O Banco Central não devolveu cotações agora. Tente mais tarde ou digite a cotação.'); await gravar(L); } catch (err) { fail(err); ev.target.disabled = false; ev.target.textContent = 'Buscar no Banco Central'; } });
        $('#im-cg', m) && ($('#im-cg', m).onclick = async () => { const v = pn($('#im-cv', m).value); if (!(v > 0)) return toast('Informe a cotação de venda.', true); try { await gravar([{ moeda: $('#im-cm', m).value, data: $('#im-cd', m).value, venda: v, fonte: 'digitada' }]); } catch (err) { fail(err); } }); } });
  }
  async function parametros() {
    let locais = [], tipos = [];
    try { [locais, tipos] = await Promise.all([q(sb.from('est_locais').select('id,codigo,nome,ativo').eq('empresa_id', e).order('ordem')), q(sb.from('est_tipos_movimento').select('id,codigo,nome,sentido,ativo').eq('empresa_id', e).eq('sentido', 'E').order('nome'))]); } catch { /* sem estoque configurado */ }
    const PAP = [['financeiro', 'Financeiro'], ['diretor', 'Diretor'], ['compras', 'Compras'], ['producao', 'Produção']], pl = (k, r) => `<label class="c3">${r}<select name="${k}">${options(cad.planos.map(x => ({ id: x.id, nome: `${x.codigo} ${x.nome}` })), { selected: cfg[k], empty: '— não gerar título —' })}</select></label>`;
    const ck = (k, r) => `<label class="chk c3"><input type="checkbox" name="${k}" ${cfg[k] ? 'checked' : ''}> ${r}</label>`;
    modal({ title: 'Parâmetros da importação', wide: true, body: `<form id="im-fpar">
        <h3 style="margin-top:0">Quem opera</h3><div class="im-g">${PAP.map(([k, r]) => `<label class="chk"><input type="checkbox" name="papel" value="${k}" ${cfg.papeis.includes(k) ? 'checked' : ''}> ${r}</label>`).join('')}<div class="c2 small muted">O administrador sempre opera. Os demais perfis do financeiro consultam.</div></div>
        <h3>Custo</h3><div class="im-g"><label class="c2">Moeda padrão<select name="moeda_padrao">${Object.entries(MOEDAS).map(([k, t]) => `<option value="${k}" ${cfg.moeda_padrao === k ? 'selected' : ''}>${k} — ${esc(t)}</option>`).join('')}</select></label>
          <label class="c2">Rateio das despesas entre os itens<select name="rateio"><option value="valor" ${cfg.rateio === 'valor' ? 'selected' : ''}>Pelo valor da mercadoria</option><option value="peso" ${cfg.rateio === 'peso' ? 'selected' : ''}>Pelo peso</option></select></label><div class="c2"></div>
          ${ck('recupera_icms', 'ICMS é recuperável (fica fora do custo)')}${ck('recupera_ipi', 'IPI é recuperável (fica fora do custo)')}${ck('recupera_pis_cofins', 'PIS e COFINS são recuperáveis (ficam fora do custo)')}</div>
        <h3>Financeiro</h3><div class="im-g">${ck('gerar_titulos', 'Gerar títulos a pagar do câmbio e das despesas')}<label class="c3">Centro de custo<select name="centro_custo_id">${options(cad.centros, { selected: cfg.centro_custo_id, empty: '—' })}</select></label>
          ${pl('plano_mercadoria_id', 'Conta do plano: mercadoria (câmbio)')}${pl('plano_impostos_id', 'Conta do plano: impostos da importação')}${pl('plano_despesas_id', 'Conta do plano: despesas da importação')}${pl('plano_bancarias_id', 'Conta do plano: despesas bancárias')}</div>
        <h3>Estoque</h3><div class="im-g"><label class="c3">Local de entrada<select name="local_id">${options(locais.filter(x => x.ativo !== false).map(x => ({ id: x.id, nome: `${x.codigo} — ${x.nome}` })), { selected: cfg.local_id, empty: 'O local padrão do produto' })}</select></label>
          <label class="c3">Tipo de movimento<select name="tipo_movimento_id">${options(tipos.filter(x => x.ativo !== false).map(x => ({ id: x.id, nome: `${x.codigo} — ${x.nome}` })), { selected: cfg.tipo_movimento_id, empty: 'Compra (padrão)' })}</select></label></div>
        <h3>Prazos e avisos</h3><div class="im-g"><label>Dias livres do contêiner<input type="number" name="free_time_padrao" min="0" max="120" value="${cfg.free_time_padrao}"></label><label>Avisar a chegada (dias antes)<input type="number" name="dias_aviso_chegada" min="0" max="60" value="${cfg.dias_aviso_chegada}"></label>
          <label>Avisar o câmbio (dias antes)<input type="number" name="dias_aviso_cambio" min="0" max="60" value="${cfg.dias_aviso_cambio}"></label><label>Avisar o contêiner (dias antes)<input type="number" name="dias_aviso_freetime" min="0" max="30" value="${cfg.dias_aviso_freetime}"></label>${ck('avisar', 'Avisar a equipe a cada mudança de etapa').replace('c3', 'c2')}</div></form>`,
      foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="im-spar">Salvar</button>',
      onMount: (m, close) => { $('#im-spar', m).onclick = async () => { const f = $('#im-fpar', m), row = { empresa_id: e, papeis: $$('[name=papel]:checked', m).map(x => x.value), moeda_padrao: f.moeda_padrao.value, rateio: f.rateio.value, atualizado_em: new Date().toISOString() };
        for (const k of ['recupera_icms', 'recupera_ipi', 'recupera_pis_cofins', 'gerar_titulos', 'avisar']) row[k] = f[k].checked;
        for (const k of ['plano_mercadoria_id', 'plano_impostos_id', 'plano_despesas_id', 'plano_bancarias_id', 'centro_custo_id', 'local_id', 'tipo_movimento_id']) row[k] = f[k].value || null;
        for (const k of ['free_time_padrao', 'dias_aviso_chegada', 'dias_aviso_cambio', 'dias_aviso_freetime']) row[k] = +f[k].value || 0;
        try { await q(sb.from('imp_config').upsert(row)); close(); toast('Parâmetros salvos.'); re(); } catch (err) { fail(err); } }; } });
  }
}

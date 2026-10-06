import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, esc, money, money0, pct, dateBR, options, fail, toast, modal, formData, parseNum, exportXLSX, chart, CORES, COR, MESES, MESES_CURTO, loading, logoPNG } from '../lib/ui.js';

export const title = 'Análise FIDC';
const f = { mes: 0, fundo: '' };
const sim = { valor: '', prazo: '' };
let ops = [], tits = [], cdiMes = {}, lancF = [], receitaMes = {}; // cdiMes[mês] = CDI a.m. em fração (0,0108 = 1,08%)

const num1 = (v) => (+v || 0).toFixed(1).replace('.', ',');
const pp = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(2).replace('.', ',') + ' p.p.';
const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const prazoCob = (o) => +(o.prazo_cobrado ?? o.prazo_medio) || 0;

// Indicadores agregados (mesmas fórmulas da aba 5.7 da planilha)
// Taxa do fundo = custo ÷ (face − custo) ÷ prazo COBRADO × 30; custo efetivo = mesmo cálculo pelo prazo REAL.
function ind(list) {
  const soma = (fn) => list.reduce((s, o) => s + (+fn(o) || 0), 0);
  const face = soma(o => o.valor_face), custo = soma(o => o.custo_total), liq = soma(o => o.liquido), rec = soma(o => o.recompra);
  const prazo = face ? soma(o => o.valor_face * o.prazo_medio) / face : 0;
  const prazoC = face ? soma(o => o.valor_face * prazoCob(o)) / face : 0;
  const taxaDe = (p) => face && p && face - custo ? custo / (face - custo) / p * 30 : 0;
  return { face, custo, liq, rec, prazo, prazoC, taxa: taxaDe(prazoC), taxaEf: taxaDe(prazo), n: list.length,
    titulos: soma(o => o.qtd_titulos), custoPct: face ? custo / face : 0, recPct: face ? rec / face : 0,
    desagio: soma(o => o.desagio), adv: soma(o => o.ad_valorem), tarifas: soma(o => o.tarifas), iof: soma(o => o.iof), encargos: soma(o => o.encargos) };
}
const faixa = (p) => p <= 30 ? '1. Até 30 dias' : p <= 45 ? '2. 31 a 45 dias' : p <= 60 ? '3. 46 a 60 dias' : p <= 90 ? '4. 61 a 90 dias' : '5. Acima de 90 dias';
const FAIXAS_VENC = [['Vencem em 1 a 7 dias', 1, 7], ['Vencem em 8 a 15 dias', 8, 15], ['Vencem em 16 a 30 dias', 16, 30], ['Vencem em 31 a 60 dias', 31, 60], ['Vencem em 61 a 90 dias', 61, 90], ['Vencem acima de 90 dias', 91, 1e9]];
const nivelHHI = (h) => h > 2500 ? ['Alta', 'vencido'] : h >= 1500 ? ['Moderada', 'aberto'] : ['Baixa', 'pago'];
const card = (id, titulo, sub = '', extra = '') => `<div class="card flush"><div class="card-head"><div><h2>${titulo}</h2>${sub ? `<p class="muted small">${sub}</p>` : ''}</div>${extra}</div><div class="table-wrap" id="${id}"></div></div>`;

export async function render(root) {
  root.innerHTML = `<div class="card"><div class="toolbar" id="flt">
      <label>Mês<select name="mes">${options([{ id: 0, nome: 'Acumulado' }, ...MESES.map((n, i) => ({ id: i + 1, nome: n }))], { selected: f.mes })}</select></label>
      <label>Fundo<select name="fundo" id="sel-fundo"></select></label>
      <span class="spacer"></span><button class="btn" id="pdf">PDF da análise</button><button class="btn" id="exp">Exportar operações</button>
      ${podeEditar() ? '<button class="btn primary" id="novo">+ Novo borderô</button>' : ''}</div></div>
    <div class="exec-head"><h2 id="exec-tit">Resumo executivo</h2><span class="muted small" id="exec-sub"></span></div>
    <div class="kpis" id="kp"></div>
    <div class="card"><div class="card-head"><h2>Alertas</h2><span class="muted small">Seguem os filtros de mês e fundo, exceto a conferência dos borderôs (base inteira).</span></div><div id="alertas" class="alert-list"></div></div>
    <div class="grid2">
      ${card('cmp', 'Comparativo entre fundos', 'Segue só o filtro de mês. Taxa do fundo usa o prazo cobrado no borderô; custo efetivo, o prazo real dos títulos. Ranking 1 = menor taxa.')}
      <div class="card"><h2>Taxa do fundo a.m. por mês × CDI</h2><div class="chart-box"><canvas id="ch"></canvas></div></div>
    </div>
    ${card('cdi', 'CDI e spread por mês', 'CDI do mês em % a.m. (editável). Spread = taxa do fundo − CDI. No acumulado, o CDI é a média dos meses ponderada pelo valor antecipado.')}
    ${card('opo', 'Custo de oportunidade', 'Quanto custaria cada operação no fundo de menor taxa do mesmo mês e da mesma faixa de prazo (ou do mês, quando só um fundo operou a faixa), mantendo valor e prazo cobrado. Não considera limites de crédito, sacados aceitos nem disponibilidade dos fundos. Segue o filtro de mês.')}
    ${card('simu', 'Simulador de antecipação', 'Custo estimado = valor × taxa × prazo/30 ÷ (1 + taxa × prazo/30), a mesma convenção da taxa do fundo (use o prazo que o fundo cobra). Taxa do período segue o filtro de mês; taxa do ano usa todos os meses.', `<form id="simf" class="toolbar sim-form"><label>Valor de face (R$)<input name="valor" inputmode="decimal" value="${esc(sim.valor)}" placeholder="ex.: 500.000,00"></label><label>Prazo médio (dias)<input name="prazo" inputmode="decimal" value="${esc(sim.prazo)}" placeholder="ex.: 45"></label></form>`)}
    <div class="grid2">
      ${card('cart', 'Carteira cedida a vencer', 'Coobrigação: títulos cedidos ainda não vencidos. Se o sacado não pagar, o fundo cobra a recompra da IPLAMM. Posição de hoje, todos os meses.')}
      <div class="card"><h2>Coobrigação por prazo de vencimento</h2><div class="chart-box"><canvas id="ch-cart"></canvas></div></div>
    </div>
    <div class="grid2">
      ${card('sac', 'Concentração por sacado — top 20', 'Segue os filtros de mês e fundo. HHI = soma dos quadrados das participações (0 a 10.000).', '<span id="hhi"></span>')}
      <div class="card"><h2>Participação acumulada dos sacados</h2><div class="chart-box"><canvas id="ch-sac"></canvas></div></div>
    </div>
    ${card('rec', 'Recompras descontadas nos borderôs', 'Por fundo e mês, ano inteiro (não segue os filtros).')}
    ${card('conc', 'Conciliação borderôs × fluxo de caixa', 'Segue o filtro de mês e compara só meses com borderô. Fluxo de caixa = lançamentos pagos na conta do próprio fundo: transferências 3.02.01, juros 2.07.08, tarifas 2.07.32 + 2.07.05 e recompras 2.07.11. Diferença ≠ 0 = borderô não lançado, lançado em outra conta/classificação ou valor divergente. Clique num fundo para ver mês a mês.')}
    <div class="grid2">
      ${card('peso', 'Peso no faturamento', 'Só meses com receita de vendas (1.01) lançada e operação FIDC. Segue o filtro de mês.')}
      ${card('fora', 'Custos fora do borderô', 'Tarifas dos fundos (2.07.32 / 2.07.05) pagas por outras contas e identificadas pelo nome do fundo na descrição. Entram no custo total com custos fora.')}
    </div>
    <div class="grid2">
      ${card('cal', 'Calendário de liquidação', 'Títulos cedidos a vencer por semana (próximas 12 semanas), por fundo. É o valor que os sacados devem pagar aos fundos; o que não for pago volta como recompra.')}
      <div class="card"><h2>Coobrigação por semana</h2><div class="chart-box"><canvas id="ch-cal"></canvas></div></div>
    </div>
    ${card('comp', 'Composição do custo', 'Segue o filtro de mês. Custo = deságio + ad valorem + tarifas + IOF + prorrogação/encargos; recompras e descontos ao sacado não são custo.')}
    ${card('evo', 'Evolução mensal', 'Segue o filtro de fundo.')}
    ${card('fx', 'Taxa por faixa de prazo × fundo', 'Mapa de calor: quanto mais escura a célula, maior a taxa do fundo naquela faixa. Colunas totais seguem mês e fundo; as colunas por fundo seguem só o mês.')}
    ${card('ops', 'Operações (borderôs)', 'Clique numa linha para ver os títulos ou editar.')}`;
  $('#flt', root).addEventListener('change', (e) => { f[e.target.name] = e.target.name === 'mes' ? +e.target.value : e.target.value; desenhar(root); });
  $('#simf', root).addEventListener('input', (e) => { sim[e.target.name] = e.target.value; simular(root); });
  $('#simf', root).addEventListener('submit', (e) => e.preventDefault());
  $('#exp', root).onclick = () => exportXLSX($('#ops table', root), `fidc_operacoes_${state.ano}`);
  $('#pdf', root).onclick = () => gerarPDF(root);
  $('#novo', root) && ($('#novo', root).onclick = () => editar({}, root));
  loading($('#ops', root));
  try {
    const e = state.empresa.id;
    let idx, recRows;
    const codigos = ['3.02.01', '2.07.08', '2.07.32', '2.07.05', '2.07.11'];
    const planoIds = state.cad.plano.filter(p => codigos.includes(p.codigo)).map(p => p.id);
    [ops, tits, idx, lancF, recRows] = await Promise.all([
      fetchAll(() => sb.from('fidc_operacoes').select('*').eq('empresa_id', e).gte('data', `${state.ano}-01-01`).lte('data', `${state.ano}-12-31`).order('data')),
      fetchAll(() => sb.from('fidc_titulos').select('operacao_id,fundo,valor,vencimento,data_operacao,sacado_agrupado,sacado').eq('empresa_id', e).gte('data_operacao', `${state.ano}-01-01`).lte('data_operacao', `${state.ano}-12-31`)),
      q(sb.from('indices_mensais').select('mes,cdi').eq('empresa_id', e).eq('ano', state.ano)),
      planoIds.length ? fetchAll(() => sb.from('lancamentos').select('data,valor,plano_id,conta_id,descricao').eq('empresa_id', e).eq('status', 'Pago').in('plano_id', planoIds).gte('data', `${state.ano}-01-01`).lte('data', `${state.ano}-12-31`)) : [],
      q(sb.rpc('resumo_mensal', { p_empresa: e, p_ano: state.ano })),
    ]);
    receitaMes = {};
    for (const r of recRows || []) if (state.cad.planoById[r.classe_id]?.codigo === '1.01') receitaMes[r.mes] = (receitaMes[r.mes] || 0) + +r.total;
    cdiMes = Object.fromEntries((idx || []).filter(r => r.cdi != null).map(r => [r.mes, +r.cdi / 100]));
    desenhar(root);
  } catch (err) { fail(err); }
}

function desenhar(root) {
  const fundos = [...new Set(ops.map(o => o.fundo))].sort();
  $('#sel-fundo', root).innerHTML = options(fundos.map(x => ({ id: x, nome: x })), { empty: 'Todos', selected: f.fundo });
  const mesOk = (o) => !f.mes || +o.data.slice(5, 7) === f.mes;
  const fundoOk = (o) => !f.fundo || o.fundo === f.fundo;
  const sel = ops.filter(o => mesOk(o) && fundoOk(o));
  const I = ind(sel); const cdi = cdiDe(sel);
  const hoje = hojeISO();
  const opById = Object.fromEntries(ops.map(o => [o.id, o]));
  const corFundo = Object.fromEntries(fundos.map((fd, i) => [fd, CORES[i % CORES.length]]));

  // ---------- Carteira a vencer (posição de hoje, todos os meses) ----------
  const aVencer = tits.filter(t => t.vencimento && t.vencimento > hoje);
  const cart = FAIXAS_VENC.map(([nome, a, b]) => { const l = aVencer.filter(t => { const d = dias(hoje, t.vencimento); return d >= a && d <= b; }); return { nome, l }; });
  const totVencer = aVencer.reduce((s, t) => s + +t.valor, 0);
  const prox30 = aVencer.filter(t => dias(hoje, t.vencimento) <= 30).reduce((s, t) => s + +t.valor, 0);

  // ---------- Sacados (filtros mês + fundo) ----------
  const opIds = new Set(sel.map(o => o.id));
  const tsel = tits.filter(t => opIds.has(t.operacao_id));
  const sac = {}; for (const t of tsel) { const k = t.sacado_agrupado || t.sacado || '(sem nome)'; (sac[k] ||= { v: 0, n: 0, fundos: new Set(), pz: 0 }); sac[k].v += +t.valor; sac[k].n++; sac[k].fundos.add(t.fundo); sac[k].pz += +t.valor * Math.max(0, dias(t.data_operacao, t.vencimento)); }
  const totT = tsel.reduce((s, t) => s + +t.valor, 0);
  const sacOrd = Object.entries(sac).sort((a, b) => b[1].v - a[1].v);
  const hhi = totT ? sacOrd.reduce((s, [, v]) => s + (v.v / totT * 100) ** 2, 0) : 0;
  const [hhiNome, hhiCls] = nivelHHI(hhi);
  const maior = sacOrd[0];

  // ---------- Resumo executivo ----------
  $('#exec-tit', root).textContent = `Resumo executivo — ${f.mes ? MESES[f.mes - 1].toLowerCase().replace(/^./, c => c.toUpperCase()) : 'acumulado'} ${state.ano}${f.fundo ? ' · ' + f.fundo : ''}`;
  $('#exec-sub', root).textContent = `${I.n} borderôs · ${I.titulos.toLocaleString('pt-BR')} títulos`;
  $('#kp', root).innerHTML = `
    <div class="kpi"><div class="k-label">Valor de face antecipado</div><div class="k-value">${money0(I.face)}</div><div class="k-sub">líquido creditado ${money0(I.liq)}</div></div>
    <div class="kpi"><div class="k-label">Custo total</div><div class="k-value">${money0(I.custo)}</div><div class="k-sub">${pct(I.custoPct, 2)} da face</div></div>
    <div class="kpi"><div class="k-label">Taxa do fundo a.m.</div><div class="k-value">${pct(I.taxa, 2)}</div><div class="k-sub">custo efetivo ${pct(I.taxaEf, 2)}${cdi != null ? ` · CDI ${pct(cdi, 2)} · spread ${pp(I.taxa - cdi)}` : ''}</div></div>
    <div class="kpi"><div class="k-label">Prazo cobrado</div><div class="k-value">${num1(I.prazoC)} dias</div><div class="k-sub">prazo real ${num1(I.prazo)} dias</div></div>
    <div class="kpi"><div class="k-label">Coobrigação a vencer</div><div class="k-value">${money0(totVencer)}</div><div class="k-sub">${money0(prox30)} nos próximos 30 dias</div></div>
    <div class="kpi"><div class="k-label">Recompras</div><div class="k-value">${money0(I.rec)}</div><div class="k-sub">${pct(I.recPct, 2)} da face</div></div>
    <div class="kpi"><div class="k-label">Maior sacado</div><div class="k-value">${pct(totT && maior ? maior[1].v / totT : 0)}</div><div class="k-sub" title="${esc(maior?.[0] || '')}">${esc((maior?.[0] || '–').slice(0, 30))}</div></div>
    <div class="kpi"><div class="k-label">Concentração (HHI)</div><div class="k-value">${Math.round(hhi).toLocaleString('pt-BR')}</div><div class="k-sub"><span class="badge ${hhiCls}">${hhiNome}</span></div></div>`;

  // ---------- Comparativo entre fundos (só filtro de mês) ----------
  const porFundo = fundos.map(fd => { const l = ops.filter(o => mesOk(o) && o.fundo === fd); return { fd, ...ind(l), cdi: cdiDe(l) }; }).filter(x => x.n);
  const tot = ind(ops.filter(mesOk)); const cdiP = cdiDe(ops.filter(mesOk));
  const minT = Math.min(...porFundo.map(x => x.taxa).filter(Boolean));
  const rank = [...porFundo].sort((a, b) => a.taxa - b.taxa).map(x => x.fd);
  $('#cmp', root).innerHTML = `<table><thead><tr><th>Fundo</th><th class="num">Op.</th><th class="num">Face</th><th class="num">Part.</th><th class="num">Custo %</th><th class="num">Prazo cobr.</th><th class="num">Taxa do fundo</th><th class="num">Custo efetivo</th><th class="num">Δ vs. + barato</th>${cdiP != null ? '<th class="num">Spread CDI</th>' : ''}<th class="num">Recompra %</th><th class="num">Rank</th></tr></thead><tbody>
    ${porFundo.map(x => `<tr><td><span class="dot" style="background:${corFundo[x.fd]}"></span>${esc(x.fd)}</td><td class="num">${x.n}</td><td class="num">${money0(x.face)}</td><td class="num">${pct(tot.face ? x.face / tot.face : 0)}</td>
      <td class="num">${pct(x.custoPct, 2)}</td><td class="num">${num1(x.prazoC)}</td><td class="num"><strong>${pct(x.taxa, 2)}</strong></td><td class="num">${pct(x.taxaEf, 2)}</td>
      <td class="num">${x.taxa - minT > 1e-9 ? pp(x.taxa - minT) : '—'}</td>${cdiP != null ? `<td class="num">${x.cdi != null ? pp(x.taxa - x.cdi) : '–'}</td>` : ''}
      <td class="num${x.recPct > 0.05 ? ' neg' : ''}">${pct(x.recPct, 2)}</td><td class="num">${rank.indexOf(x.fd) + 1}º</td></tr>`).join('')}
    <tr class="row-total"><td>TOTAL</td><td class="num">${tot.n}</td><td class="num">${money0(tot.face)}</td><td class="num">100%</td><td class="num">${pct(tot.custoPct, 2)}</td><td class="num">${num1(tot.prazoC)}</td><td class="num">${pct(tot.taxa, 2)}</td><td class="num">${pct(tot.taxaEf, 2)}</td><td></td>${cdiP != null ? `<td class="num">${pp(tot.taxa - cdiP)}</td>` : ''}<td class="num">${pct(tot.recPct, 2)}</td><td></td></tr></tbody></table>`;

  const porMes = (list) => Array.from({ length: 12 }, (_, i) => ind(list.filter(o => +o.data.slice(5, 7) === i + 1)));
  const ultimoMes = Math.max(0, ...ops.map(o => +o.data.slice(5, 7)));
  const labelsAte = MESES_CURTO.slice(0, Math.max(ultimoMes, 1));
  chart($('#ch', root), {
    type: 'line',
    data: { labels: labelsAte, datasets: fundos.map(fd => ({ label: fd, data: porMes(ops.filter(o => o.fundo === fd)).slice(0, labelsAte.length).map(x => x.n ? +(x.taxa * 100).toFixed(3) : null),
      borderColor: corFundo[fd], backgroundColor: corFundo[fd], spanGaps: false, tension: .2, pointRadius: 4 })).concat(Object.keys(cdiMes).length ? [{
      label: 'CDI', data: labelsAte.map((_, i) => cdiMes[i + 1] != null ? +(cdiMes[i + 1] * 100).toFixed(3) : null), borderColor: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#667085',
      backgroundColor: 'transparent', borderDash: [6, 4], pointRadius: 0, tension: 0 }] : []) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: v => String(v).replace('.', ',') + '%' } } },
      plugins: { tooltip: { callbacks: { label: (x) => x.raw == null ? null : `${x.dataset.label}: ${x.raw.toFixed(2).replace('.', ',')}% a.m.` } } } },
  });

  // ---------- Carteira a vencer ----------
  const fdCart = fundos.filter(fd => tits.some(t => t.fundo === fd));
  const somaF = (l, fd) => l.filter(t => !fd || t.fundo === fd).reduce((s, t) => s + +t.valor, 0);
  const vencidos = tits.filter(t => t.vencimento && t.vencimento <= hoje);
  $('#cart', root).innerHTML = `<table><thead><tr><th>Vencimento</th>${fdCart.map(fd => `<th class="num">${esc(fd)}</th>`).join('')}<th class="num">Total</th><th class="num">% a vencer</th></tr></thead><tbody>
    ${cart.map(c => `<tr><td>${c.nome}</td>${fdCart.map(fd => `<td class="num">${money0(somaF(c.l, fd))}</td>`).join('')}<td class="num"><strong>${money0(somaF(c.l))}</strong></td><td class="num">${pct(totVencer ? somaF(c.l) / totVencer : 0)}</td></tr>`).join('')}
    <tr class="row-total"><td>Total a vencer (coobrigação)</td>${fdCart.map(fd => `<td class="num">${money0(somaF(aVencer, fd))}</td>`).join('')}<td class="num">${money0(totVencer)}</td><td class="num">100%</td></tr>
    <tr class="muted"><td>Já vencidos (pagos ou recomprados)</td>${fdCart.map(fd => `<td class="num">${money0(somaF(vencidos, fd))}</td>`).join('')}<td class="num">${money0(somaF(vencidos))}</td><td></td></tr></tbody></table>`;
  chart($('#ch-cart', root), {
    type: 'bar',
    data: { labels: cart.map(c => c.nome.replace('Vencem em ', '').replace('Vencem ', '')), datasets: [{ label: 'Coobrigação a vencer', data: cart.map(c => +somaF(c.l).toFixed(2)), backgroundColor: COR.entrada, maxBarThickness: 48 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => money0(x.raw) } } }, scales: { y: { ticks: { callback: v => moneyCurto(v) } } } },
  });

  // ---------- Concentração por sacado ----------
  $('#hhi', root).innerHTML = `<span class="muted small">HHI</span> <strong>${Math.round(hhi).toLocaleString('pt-BR')}</strong> <span class="badge ${hhiCls}">Concentração ${hhiNome.toLowerCase()}</span>`;
  let acum = 0;
  const top = sacOrd.slice(0, 20).map(([k, v]) => { acum += v.v; return { k, v, acum }; });
  const demais = sacOrd.slice(20);
  $('#sac', root).innerHTML = tsel.length ? `<table><thead><tr><th>#</th><th>Sacado</th><th>Fundos</th><th class="num">Títulos</th><th class="num">Valor de face</th><th class="num">Part.</th><th class="num">% acum.</th><th class="num">Prazo méd.</th></tr></thead><tbody>
    ${top.map((x, i) => `<tr class="clickable" data-sac="${esc(x.k)}"><td>${i + 1}</td><td class="wrap">${esc(x.k)}</td><td class="small">${esc([...x.v.fundos].sort().join(', '))}</td><td class="num">${x.v.n}</td><td class="num">${money0(x.v.v)}</td><td class="num${x.v.v / totT > .3 ? ' neg' : ''}">${pct(x.v.v / totT)}</td><td class="num">${pct(x.acum / totT)}</td><td class="num">${x.v.v ? num1(x.v.pz / x.v.v) : '–'}</td></tr>`).join('')}
    ${demais.length ? `<tr><td></td><td>Demais sacados (${demais.length})</td><td></td><td class="num">${demais.reduce((s, [, v]) => s + v.n, 0)}</td><td class="num">${money0(demais.reduce((s, [, v]) => s + v.v, 0))}</td><td class="num">${pct(demais.reduce((s, [, v]) => s + v.v, 0) / totT)}</td><td class="num">100%</td><td></td></tr>` : ''}
    <tr class="row-total"><td></td><td>TOTAL</td><td></td><td class="num">${tsel.length}</td><td class="num">${money0(totT)}</td><td class="num">100%</td><td></td><td></td></tr></tbody></table>` : '<div class="empty">Nenhum título no período.</div>';
  $('#sac', root).onclick = (e) => { const tr = e.target.closest('tr[data-sac]'); if (tr) fichaSacado(tr.dataset.sac); };
  const curva = sacOrd.slice(0, 20);
  chart($('#ch-sac', root), {
    type: 'bar',
    data: { labels: curva.map((_, i) => `${i + 1}º`), datasets: [
      { type: 'line', label: '% acumulado', data: curva.reduce((a, [, v]) => { a.push(+(((a.at(-1) || 0) + v.v / totT * 100)).toFixed(2)); return a; }, []), borderColor: COR.saldo, backgroundColor: COR.saldo, pointRadius: 3, tension: .2 },
      { label: 'Participação', data: curva.map(([, v]) => +(v.v / totT * 100).toFixed(2)), backgroundColor: COR.entrada, maxBarThickness: 28 }] },
    options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } },
      plugins: { tooltip: { callbacks: { title: (x) => curva[x[0].dataIndex]?.[0] || '', label: (x) => `${x.dataset.label}: ${x.raw.toFixed(1).replace('.', ',')}%` } } } },
  });

  // ---------- Recompras por fundo e mês (ano inteiro) ----------
  const mesesAte = Array.from({ length: Math.max(ultimoMes, 1) }, (_, i) => i);
  const recM = (fd, m) => ops.filter(o => (!fd || o.fundo === fd) && +o.data.slice(5, 7) === m + 1).reduce((s, o) => s + +o.recompra, 0);
  const faceM = (m) => ops.filter(o => +o.data.slice(5, 7) === m + 1).reduce((s, o) => s + +o.valor_face, 0);
  const totRec = ops.reduce((s, o) => s + +o.recompra, 0), totFace = ops.reduce((s, o) => s + +o.valor_face, 0);
  $('#rec', root).innerHTML = `<table><thead><tr><th class="sticky">Fundo</th>${mesesAte.map(m => `<th class="num">${MESES_CURTO[m]}</th>`).join('')}<th class="num">Ano</th><th class="num">% da face</th></tr></thead><tbody>
    ${fundos.map(fd => { const faceF = ops.filter(o => o.fundo === fd).reduce((s, o) => s + +o.valor_face, 0); const r = mesesAte.reduce((s, m) => s + recM(fd, m), 0); return `<tr><td class="sticky">${esc(fd)}</td>${mesesAte.map(m => `<td class="num">${recM(fd, m) ? money0(recM(fd, m)) : '–'}</td>`).join('')}<td class="num"><strong>${money0(r)}</strong></td><td class="num${faceF && r / faceF > .05 ? ' neg' : ''}"><strong>${pct(faceF ? r / faceF : 0, 2)}</strong></td></tr>`; }).join('')}
    <tr class="row-total"><td class="sticky">TOTAL</td>${mesesAte.map(m => `<td class="num">${money0(recM('', m))}</td>`).join('')}<td class="num">${money0(totRec)}</td><td class="num">${pct(totFace ? totRec / totFace : 0, 2)}</td></tr>
    <tr><td class="sticky muted">Recompra % da face</td>${mesesAte.map(m => `<td class="num${faceM(m) && recM('', m) / faceM(m) > .05 ? ' neg' : ''}">${faceM(m) ? pct(recM('', m) / faceM(m), 1) : '–'}</td>`).join('')}<td class="num">${pct(totFace ? totRec / totFace : 0, 2)}</td><td></td></tr></tbody></table>`;

  // ---------- Composição do custo (só mês) ----------
  const compRows = [...porFundo, { fd: 'TOTAL', ...tot, total: true }];
  $('#comp', root).innerHTML = `<table><thead><tr><th>Fundo</th><th class="num">Deságio / juros</th><th class="num">Ad valorem</th><th class="num">Tarifas</th><th class="num">IOF</th><th class="num">Prorrog. / encargos</th><th class="num">Custo total</th><th class="num">% deságio no custo</th><th class="num">Custo % da face</th><th class="num">Custo médio / operação</th><th class="num">Tarifa média / operação</th></tr></thead><tbody>
    ${compRows.map(x => `<tr${x.total ? ' class="row-total"' : ''}><td>${esc(x.fd)}</td><td class="num">${money0(x.desagio)}</td><td class="num">${money0(x.adv)}</td><td class="num">${money0(x.tarifas)}</td><td class="num">${money0(x.iof)}</td><td class="num">${money0(x.encargos)}</td>
      <td class="num"><strong>${money0(x.custo)}</strong></td><td class="num">${pct(x.custo ? x.desagio / x.custo : 0)}</td><td class="num">${pct(x.custoPct, 2)}</td><td class="num">${money0(x.n ? x.custo / x.n : 0)}</td><td class="num">${money(x.n ? x.tarifas / x.n : 0)}</td></tr>`).join('')}</tbody></table>`;

  // ---------- Evolução mensal (filtro de fundo) ----------
  const baseF = ops.filter(fundoOk);
  const ev = porMes(baseF).slice(0, mesesAte.length); const evA = ind(baseF);
  const linha = (n, fn, fmt) => `<tr><td class="sticky">${n}</td>${ev.map(x => `<td class="num">${x.n ? fmt(fn(x)) : '–'}</td>`).join('')}<td class="num"><strong>${fmt(fn(evA))}</strong></td></tr>`;
  $('#evo', root).innerHTML = `<table><thead><tr><th class="sticky">${esc(f.fundo || 'Todos os fundos')}</th>${mesesAte.map(m => `<th class="num">${MESES_CURTO[m]}</th>`).join('')}<th class="num">Ano</th></tr></thead><tbody>
    ${linha('Valor de face', x => x.face, money0)}${linha('Líquido creditado', x => x.liq, money0)}${linha('Custo total', x => x.custo, money0)}
    ${linha('Custo % da face', x => x.custoPct, v => pct(v, 2))}${linha('Taxa do fundo a.m.', x => x.taxa, v => pct(v, 2))}${linha('Custo efetivo a.m.', x => x.taxaEf, v => pct(v, 2))}
    ${linha('Prazo cobrado (dias)', x => x.prazoC, num1)}${linha('Prazo real (dias)', x => x.prazo, num1)}${linha('Nº operações', x => x.n, v => v)}${linha('Recompras', x => x.rec, money0)}</tbody></table>`;

  // ---------- Faixa de prazo × fundo (mapa de calor) ----------
  const fx = {}; for (const o of sel) { const k = faixa(prazoCob(o)); (fx[k] ||= []).push(o); }
  const fxF = {}; for (const o of ops.filter(mesOk)) { const k = faixa(prazoCob(o)); ((fxF[k] ||= {})[o.fundo] ||= []).push(o); }
  const celTaxas = Object.values(fxF).flatMap(g => Object.values(g).map(l => ind(l).taxa)).filter(Boolean);
  const tMin = Math.min(...celTaxas), tMax = Math.max(...celTaxas);
  const calor = (t) => { const k = tMax > tMin ? (t - tMin) / (tMax - tMin) : .5; return `background:color-mix(in srgb, var(--heat) ${Math.round(8 + k * 62)}%, var(--surface))`; };
  $('#fx', root).innerHTML = `<table class="heat"><thead><tr><th>Faixa (prazo cobrado)</th><th class="num">Op.</th><th class="num">Face</th><th class="num">% do volume</th><th class="num">Custo % face</th><th class="num">Taxa do fundo</th>${fundos.map(fd => `<th class="num">${esc(fd)}</th>`).join('')}</tr></thead><tbody>
    ${Object.keys(fx).sort().map(k => { const x = ind(fx[k]); return `<tr><td>${k}</td><td class="num">${x.n}</td><td class="num">${money0(x.face)}</td><td class="num">${pct(I.face ? x.face / I.face : 0)}</td><td class="num">${pct(x.custoPct, 2)}</td><td class="num"><strong>${pct(x.taxa, 2)}</strong></td>${fundos.map(fd => { const l = fxF[k]?.[fd]; if (!l) return '<td class="num muted">–</td>'; const y = ind(l); return `<td class="num heat-cell" style="${calor(y.taxa)}" title="${esc(fd)} · ${k}: ${y.n} op., ${money0(y.face)}"><strong>${pct(y.taxa, 2)}</strong><span class="small muted">${y.n} op.</span></td>`; }).join('')}</tr>`; }).join('')}
    <tr class="row-total"><td>TOTAL</td><td class="num">${I.n}</td><td class="num">${money0(I.face)}</td><td class="num">100%</td><td class="num">${pct(I.custoPct, 2)}</td><td class="num">${pct(I.taxa, 2)}</td>${fundos.map(fd => { const x = porFundo.find(z => z.fd === fd); return `<td class="num">${x ? pct(x.taxa, 2) : '–'}</td>`; }).join('')}</tr></tbody></table>
    <div class="heat-legend small muted">menor taxa <span class="heat-bar"></span> maior taxa${celTaxas.length ? ` (${pct(tMin, 2)} a ${pct(tMax, 2)} a.m.)` : ''}</div>`;

  // ---------- CDI e spread por mês ----------
  const tabCdi = () => {
    const ed = podeEditar();
    const evT = porMes(ops).slice(0, mesesAte.length);
    const linhaF = (fd) => { const ev2 = porMes(ops.filter(o => o.fundo === fd)).slice(0, mesesAte.length); return `<tr><td class="sticky">Spread ${esc(fd)}</td>${ev2.map((x, m) => `<td class="num">${x.n && cdiMes[m + 1] != null ? pp(x.taxa - cdiMes[m + 1]) : '–'}</td>`).join('')}<td class="num">${(() => { const l = ops.filter(o => o.fundo === fd); const c = cdiDe(l); return c != null ? pp(ind(l).taxa - c) : '–'; })()}</td></tr>`; };
    const cAno = cdiDe(ops);
    return `<table><thead><tr><th class="sticky"></th>${mesesAte.map(m => `<th class="num">${MESES_CURTO[m]}</th>`).join('')}<th class="num">Ano</th></tr></thead><tbody>
      <tr><td class="sticky"><strong>CDI a.m.</strong></td>${mesesAte.map(m => `<td class="num">${ed ? `<input class="cdi-in" data-mes="${m + 1}" inputmode="decimal" value="${cdiMes[m + 1] != null ? (cdiMes[m + 1] * 100).toFixed(2).replace('.', ',') : ''}" placeholder="–" aria-label="CDI ${MESES[m]}">` : (cdiMes[m + 1] != null ? pct(cdiMes[m + 1], 2) : '–')}</td>`).join('')}<td class="num">${cAno != null ? pct(cAno, 2) : '–'}</td></tr>
      <tr><td class="sticky">Taxa do fundo (todos)</td>${evT.map(x => `<td class="num">${x.n ? pct(x.taxa, 2) : '–'}</td>`).join('')}<td class="num">${pct(ind(ops).taxa, 2)}</td></tr>
      <tr class="row-total"><td class="sticky">Spread (todos)</td>${evT.map((x, m) => `<td class="num">${x.n && cdiMes[m + 1] != null ? pp(x.taxa - cdiMes[m + 1]) : '–'}</td>`).join('')}<td class="num">${cAno != null ? pp(ind(ops).taxa - cAno) : '–'}</td></tr>
      ${fundos.map(linhaF).join('')}</tbody></table>`;
  };
  $('#cdi', root).innerHTML = tabCdi();
  $('#cdi', root).onchange = async (e) => {
    const inp = e.target.closest('.cdi-in'); if (!inp) return;
    const mes = +inp.dataset.mes; const v = inp.value.trim() ? parseNum(inp.value) : null;
    try {
      await q(sb.from('indices_mensais').upsert({ empresa_id: state.empresa.id, ano: state.ano, mes, cdi: v, updated_at: new Date().toISOString() }));
      if (v == null) delete cdiMes[mes]; else cdiMes[mes] = v / 100;
      toast(`CDI de ${MESES[mes - 1].toLowerCase()} salvo`); desenhar(root);
    } catch (err) { fail(err); }
  };

  // ---------- Custo de oportunidade (filtro de mês) ----------
  // Referência: fundo de menor taxa no mesmo mês e mesma faixa de prazo (com ao menos 2 operações na célula);
  // sem concorrência na faixa, vale o fundo mais barato do mês.
  const opoMes = {}, opoCel = {};
  for (let m = 1; m <= 12; m++) {
    const fm = porFundoMes(m).filter(x => x.taxa > 0);
    if (fm.length) { const b = fm.reduce((a, x) => x.taxa < a.taxa ? x : a); opoMes[m] = { fd: b.fd, taxa: b.taxa }; }
    const lm = ops.filter(o => +o.data.slice(5, 7) === m); const cel = {};
    for (const o of lm) ((cel[faixa(prazoCob(o))] ||= {})[o.fundo] ||= []).push(o);
    for (const [fx2, g] of Object.entries(cel)) {
      const cands = Object.entries(g).filter(([, l]) => l.length >= 2).map(([fd, l]) => ({ fd, taxa: ind(l).taxa })).filter(x => x.taxa > 0);
      if (cands.length >= 2) opoCel[`${m}|${fx2}`] = cands.reduce((a, x) => x.taxa < a.taxa ? x : a);
    }
  }
  const custoA = (face, t, p) => { const k = t * p / 30; return face * k / (1 + k); };
  const baseOpo = ops.filter(mesOk);
  const opoF = {};
  for (const o of baseOpo) {
    const m = +o.data.slice(5, 7); const ref = opoCel[`${m}|${faixa(prazoCob(o))}`] || opoMes[m]; if (!ref) continue;
    const alt = custoA(+o.valor_face, ref.taxa, prazoCob(o));
    const g = (opoF[o.fundo] ||= { real: 0, alt: 0, face: 0, n: 0, nMaisBarato: 0 });
    g.real += +o.custo_total; g.alt += alt; g.face += +o.valor_face; g.n++; if (ref.fd === o.fundo) g.nMaisBarato++;
  }
  const opoRows = Object.entries(opoF).sort((a, b) => (b[1].real - b[1].alt) - (a[1].real - a[1].alt));
  const opoTot = opoRows.reduce((t, [, g]) => ({ real: t.real + g.real, alt: t.alt + g.alt, face: t.face + g.face, n: t.n + g.n }), { real: 0, alt: 0, face: 0, n: 0 });
  const mesesOpo = Object.keys(opoMes).map(Number).filter(m => !f.mes || m === f.mes);
  $('#opo', root).innerHTML = opoRows.length ? `<table><thead><tr><th>Fundo</th><th class="num">Op.</th><th class="num">Face</th><th class="num">Custo real</th><th class="num">Custo no + barato</th><th class="num">Economia potencial</th><th class="num">% do custo</th><th class="num">Op. já no + barato</th></tr></thead><tbody>
    ${opoRows.map(([fd, g]) => `<tr><td><span class="dot" style="background:${corFundo[fd]}"></span>${esc(fd)}</td><td class="num">${g.n}</td><td class="num">${money0(g.face)}</td><td class="num">${money0(g.real)}</td><td class="num">${money0(g.alt)}</td><td class="num"><strong>${money0(Math.max(0, g.real - g.alt))}</strong></td><td class="num">${pct(g.real ? Math.max(0, g.real - g.alt) / g.real : 0)}</td><td class="num">${g.nMaisBarato} de ${g.n}</td></tr>`).join('')}
    <tr class="row-total"><td>TOTAL</td><td class="num">${opoTot.n}</td><td class="num">${money0(opoTot.face)}</td><td class="num">${money0(opoTot.real)}</td><td class="num">${money0(opoTot.alt)}</td><td class="num">${money0(Math.max(0, opoTot.real - opoTot.alt))}</td><td class="num">${pct(opoTot.real ? Math.max(0, opoTot.real - opoTot.alt) / opoTot.real : 0)}</td><td></td></tr></tbody></table>
    <div class="small muted" style="padding:8px 16px 14px">Fundo mais barato no mês (referência quando não há concorrência na faixa): ${mesesOpo.map(m => `${MESES_CURTO[m - 1]} ${esc(opoMes[m].fd)} (${pct(opoMes[m].taxa, 2)})`).join(' · ')}</div>`
    : '<div class="empty">Sem operações no período.</div>';

  simular(root);
  blocoConciliacao(root, { fundos, mesOk, corFundo, hoje, aVencer, fundoOk });

  // ---------- Operações ----------
  $('#ops', root).innerHTML = sel.length ? `<table><thead><tr><th>Data</th><th>Fundo</th><th>Borderô</th><th>Conta</th><th class="num">Títulos</th><th class="num">Face</th><th class="num">Deságio</th><th class="num">Ad valorem</th><th class="num">Tarifas</th><th class="num">IOF</th><th class="num">Encargos</th><th class="num">Custo</th><th class="num">Recompra</th><th class="num">Líquido</th><th class="num">Prazo cobr.</th><th class="num">Prazo real</th><th class="num">Taxa do fundo</th></tr></thead><tbody>
    ${sel.map(o => { const x = ind([o]); return `<tr class="clickable" data-id="${o.id}"><td>${dateBR(o.data)}</td><td>${esc(o.fundo)}</td><td>${esc(o.bordero)}</td><td>${esc(state.cad.contaById[o.conta_id]?.nome || '')}</td>
      <td class="num">${o.qtd_titulos}</td><td class="num">${money(o.valor_face)}</td><td class="num">${money(o.desagio)}</td><td class="num">${money(o.ad_valorem)}</td><td class="num">${money(o.tarifas)}</td><td class="num">${money(o.iof)}</td><td class="num">${money(o.encargos)}</td>
      <td class="num">${money(o.custo_total)}</td><td class="num">${money(o.recompra)}</td><td class="num">${money(o.liquido)}</td><td class="num">${num1(prazoCob(o))}</td><td class="num">${num1(o.prazo_medio)}</td><td class="num">${pct(x.taxa, 2)}</td></tr>`; }).join('')}</tbody></table>`
    : '<div class="empty">Nenhuma operação no período.</div>';
  $('#ops', root).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) editar(ops.find(o => o.id === tr.dataset.id), root); };

  // ---------- Alertas ----------
  const naoFecham = ops.filter(o => Math.abs(+o.valor_face - +o.custo_total - +o.recompra - +(o.desc_sacado || 0) - +o.liquido) > 0.05);
  const anoF = ind(ops.filter(fundoOk));
  const recAlta = porFundo.filter(x => !f.fundo || x.fd === f.fundo).filter(x => x.recPct > 0.05).sort((a, b) => b.recPct - a.recPct);
  const venc7 = aVencer.filter(t => fundoOk(t) && dias(hoje, t.vencimento) <= 7).reduce((s, t) => s + +t.valor, 0);
  const contaNome = (o) => state.cad.contaById[o.conta_id]?.nome || '';
  const foraBrad = sel.filter(o => !/BRADESCO/i.test(contaNome(o)));
  const A = [
    naoFecham.length ? ['atencao', 'Borderôs que não fecham', `${naoFecham.length} borderô(s) em que face − custo − recompra − desconto ≠ líquido: ${naoFecham.slice(0, 4).map(o => `${o.fundo} ${o.bordero}`).join(', ')}${naoFecham.length > 4 ? '…' : ''}`]
      : ['ok', 'Borderôs conferidos', 'Todos os borderôs fecham (face − custo − recompra − desconto = líquido).'],
    f.mes ? (I.taxa > anoF.taxa + 1e-6 ? ['atencao', 'Taxa do mês acima da média do ano', `${pct(I.taxa, 2)} a.m. no mês contra ${pct(anoF.taxa, 2)} no ano (${pp(I.taxa - anoF.taxa)}).`]
      : ['ok', 'Taxa do mês dentro da média', `${pct(I.taxa, 2)} a.m. no mês; média do ano ${pct(anoF.taxa, 2)}.`]) : null,
    recAlta.length ? ['atencao', 'Recompra acima de 5% da face', recAlta.map(x => `${x.fd} ${pct(x.recPct, 1)}`).join(' · ')] : ['ok', 'Recompras sob controle', 'Nenhum fundo com recompra acima de 5% da face no período.'],
    maior && totT && maior[1].v / totT > .3 ? ['atencao', 'Sacado acima de 30% do volume', `${maior[0]} responde por ${pct(maior[1].v / totT)} do valor cedido.`] : null,
    hhi > 2500 ? ['atencao', 'Concentração de sacados alta', `HHI ${Math.round(hhi).toLocaleString('pt-BR')} (acima de 2.500). Os 5 maiores somam ${pct(sacOrd.slice(0, 5).reduce((s, [, v]) => s + v.v, 0) / (totT || 1))}.`]
      : hhi >= 1500 ? ['info', 'Concentração de sacados moderada', `HHI ${Math.round(hhi).toLocaleString('pt-BR')}.`] : null,
    cdi != null ? (I.taxa > cdi + 0.02 ? ['atencao', 'Taxa acima do CDI + 2 p.p.', `Spread de ${pp(I.taxa - cdi)} sobre o CDI do período (${pct(cdi, 2)} a.m.).`] : ['ok', 'Taxa dentro de CDI + 2 p.p.', `Spread de ${pp(I.taxa - cdi)}.`])
      : ['info', 'Spread sobre o CDI', 'Cadastre o CDI do mês na tabela "CDI e spread por mês" para comparar.'],
    venc7 ? ['info', 'Coobrigação vencendo em 7 dias', `${money0(venc7)} em títulos cedidos vencem até ${dateBR(new Date(Date.parse(hoje) + 7 * 864e5).toISOString().slice(0, 10))}.`] : null,
    foraBrad.length ? ['info', 'Créditos fora do Bradesco', `${foraBrad.length} borderô(s), ${money0(foraBrad.reduce((s, o) => s + +o.liquido, 0))} creditados em outras contas.`] : null,
  ].filter(Boolean).sort((a, b) => ['atencao', 'info', 'ok'].indexOf(a[0]) - ['atencao', 'info', 'ok'].indexOf(b[0]));
  const ROT = { atencao: ['⚠', 'Atenção'], info: ['ℹ', 'Info'], ok: ['✓', 'OK'] };
  $('#alertas', root).innerHTML = A.map(([st, t, d]) => `<div class="alert-row ${st}"><span class="alert-tag">${ROT[st][0]} ${ROT[st][1]}</span><div><strong>${esc(t)}</strong><div class="small muted">${esc(d)}</div></div></div>`).join('');
}

// CDI médio do conjunto de borderôs, ponderado pelo valor de face de cada mês (null se não houver CDI cadastrado)
function cdiDe(list) {
  let w = 0, s = 0;
  for (const o of list) { const c = cdiMes[+o.data.slice(5, 7)]; if (c != null) { w += +o.valor_face; s += +o.valor_face * c; } }
  return w ? s / w : null;
}
// Indicadores por fundo num mês (ignora fundos com volume irrisório: < 2% do mês)
function porFundoMes(m) {
  const lm = ops.filter(o => +o.data.slice(5, 7) === m); const faceM = lm.reduce((s, o) => s + +o.valor_face, 0);
  return [...new Set(lm.map(o => o.fundo))].map(fd => ({ fd, ...ind(lm.filter(o => o.fundo === fd)) })).filter(x => faceM && x.face / faceM >= 0.02);
}
function simular(root) {
  const el = $('#simu', root); if (!el) return;
  const V = parseNum(sim.valor), P = parseNum(sim.prazo);
  const mesOk = (o) => !f.mes || +o.data.slice(5, 7) === f.mes;
  const fundos = [...new Set(ops.map(o => o.fundo))].sort();
  const linhas = fundos.map(fd => { const lp = ops.filter(o => mesOk(o) && o.fundo === fd), la = ops.filter(o => o.fundo === fd); return { fd, tp: lp.length ? ind(lp).taxa : null, ta: ind(la).taxa }; });
  const custo = (t) => { if (!t || !V || !P) return null; const k = t * P / 30; return V * k / (1 + k); };
  const ok = V > 0 && P > 0;
  const melhor = ok ? linhas.filter(x => x.tp).reduce((a, x) => !a || x.tp < a.tp ? x : a, null) : null;
  el.innerHTML = `<table><thead><tr><th>Fundo</th><th class="num">Taxa a.m. (${f.mes ? MESES_CURTO[f.mes - 1] : 'período'})</th><th class="num">Custo estimado</th><th class="num">Líquido estimado</th><th class="num">Taxa a.m. (ano)</th><th class="num">Custo (taxa do ano)</th><th class="num">Líquido (taxa do ano)</th><th></th></tr></thead><tbody>
    ${linhas.map(x => { const c = custo(x.tp), ca = custo(x.ta); return `<tr><td>${esc(x.fd)}</td><td class="num">${x.tp ? pct(x.tp, 2) : '–'}</td><td class="num">${c != null ? money(c) : '–'}</td><td class="num">${c != null ? money(V - c) : '–'}</td><td class="num">${pct(x.ta, 2)}</td><td class="num">${ca != null ? money(ca) : '–'}</td><td class="num">${ca != null ? money(V - ca) : '–'}</td><td>${melhor && melhor.fd === x.fd ? '<span class="badge pago">✓ Menor custo</span>' : ''}</td></tr>`; }).join('')}</tbody></table>
    ${ok ? '' : '<div class="small muted" style="padding:8px 16px 14px">Informe o valor de face e o prazo médio para simular.</div>'}`;
}

// ---------- Conciliação, peso no faturamento, custos fora, calendário ----------
const contaDoFundo = (fd) => state.cad.contas.find(c => (c.nome || '').trim().toUpperCase() === fd.trim().toUpperCase());
const codigoDe = (planoId) => state.cad.planoById[planoId]?.codigo;
function custosFora(fundos) {
  const contasFundo = new Set(fundos.map(contaDoFundo).filter(Boolean).map(c => c.id));
  const out = [];
  for (const l of lancF) {
    if (contasFundo.has(l.conta_id) || !['2.07.32', '2.07.05'].includes(codigoDe(l.plano_id))) continue;
    const d = (l.descricao || '').toUpperCase();
    const fd = fundos.find(f => f.length > 2 && new RegExp(`\\b${f.toUpperCase()}\\b`).test(d));
    if (fd) out.push({ ...l, fundo: fd });
  }
  return out;
}
let concDet = '';
function blocoConciliacao(root, { fundos, mesOk, corFundo, hoje, aVencer, fundoOk }) {
  const cats = [['liq', 'Líquido × transferências', ['3.02.01']], ['jur', 'Juros (deságio + prorrog.)', ['2.07.08']], ['tar', 'Tarifas + IOF', ['2.07.32', '2.07.05']], ['rec', 'Recompras', ['2.07.11']]];
  const bord = (o, k) => k === 'liq' ? +o.liquido : k === 'jur' ? +o.desagio + +o.encargos : k === 'tar' ? +o.tarifas + +o.iof : +o.recompra;
  const linhas = fundos.map(fd => {
    const conta = contaDoFundo(fd); const meses = new Set(ops.filter(o => o.fundo === fd && mesOk(o)).map(o => +o.data.slice(5, 7)));
    const porMes = {};
    for (const m of meses) {
      const b = {}, c = {};
      for (const [k, , cods] of cats) {
        b[k] = ops.filter(o => o.fundo === fd && +o.data.slice(5, 7) === m).reduce((s, o) => s + bord(o, k), 0);
        c[k] = conta ? lancF.filter(l => l.conta_id === conta.id && +l.data.slice(5, 7) === m && cods.includes(codigoDe(l.plano_id))).reduce((s, l) => s + +l.valor, 0) : 0;
      }
      porMes[m] = { b, c };
    }
    const tot = (k, w) => Object.values(porMes).reduce((s, x) => s + x[w][k], 0);
    return { fd, conta, porMes, tot };
  }).filter(x => Object.keys(x.porMes).length);
  const cel = (b, c) => { const d = b - c; return `<td class="num">${money0(b)}</td><td class="num">${money0(c)}</td><td class="num ${Math.abs(d) > 1 ? 'neg' : 'pos'}"><strong>${Math.abs(d) > 1 ? money0(d) : '✓'}</strong></td>`; };
  const head = `<thead><tr><th rowspan="2">Fundo (conta)</th>${cats.map(([, n]) => `<th colspan="3" class="grp">${n}</th>`).join('')}</tr><tr>${cats.map(() => '<th class="num">Borderôs</th><th class="num">Fluxo de caixa</th><th class="num">Diferença</th>').join('')}</tr></thead>`;
  const T = (k, w) => linhas.reduce((s, x) => s + x.tot(k, w), 0);
  $('#conc', root).innerHTML = linhas.length ? `<table class="conc">${head}<tbody>
    ${linhas.map(x => `<tr class="clickable" data-fd="${esc(x.fd)}"><td>${esc(x.fd)} <span class="muted small">(${esc(x.conta?.nome || 'sem conta')})</span></td>${cats.map(([k]) => cel(x.tot(k, 'b'), x.tot(k, 'c'))).join('')}</tr>
      ${concDet === x.fd ? Object.entries(x.porMes).sort((a, b) => a[0] - b[0]).map(([m, v]) => `<tr class="sub"><td>↳ ${MESES[m - 1].toLowerCase()}</td>${cats.map(([k]) => cel(v.b[k], v.c[k])).join('')}</tr>`).join('') : ''}`).join('')}
    <tr class="row-total"><td>TOTAL</td>${cats.map(([k]) => cel(T(k, 'b'), T(k, 'c'))).join('')}</tr></tbody></table>` : '<div class="empty">Sem borderôs no período.</div>';
  $('#conc', root).onclick = (e) => { const tr = e.target.closest('tr[data-fd]'); if (!tr) return; concDet = concDet === tr.dataset.fd ? '' : tr.dataset.fd; blocoConciliacao(root, { fundos, mesOk, corFundo, hoje, aVencer, fundoOk }); };

  // Peso no faturamento
  const mesesOk = Object.keys(receitaMes).map(Number).filter(m => receitaMes[m] > 0 && ops.some(o => +o.data.slice(5, 7) === m) && (!f.mes || m === f.mes));
  const lp = ops.filter(o => mesesOk.includes(+o.data.slice(5, 7)) && fundoOk(o)); const ip = ind(lp);
  const rec = mesesOk.reduce((s, m) => s + receitaMes[m], 0);
  $('#peso', root).innerHTML = mesesOk.length ? `<table><tbody>
    <tr><td>Receita de vendas (1.01) — ${mesesOk.map(m => MESES_CURTO[m - 1]).join(', ')}</td><td class="num">${money0(rec)}</td></tr>
    <tr><td>Valor de face antecipado nos mesmos meses</td><td class="num">${money0(ip.face)}</td></tr>
    <tr class="row-total"><td>% das vendas antecipadas nos FIDCs</td><td class="num">${pct(rec ? ip.face / rec : 0)}</td></tr>
    <tr><td>Custo dos FIDCs nos mesmos meses</td><td class="num">${money0(ip.custo)}</td></tr>
    <tr><td>Custo dos FIDCs % da receita</td><td class="num">${pct(rec ? ip.custo / rec : 0, 2)}</td></tr>
    <tr class="row-total"><td>Custo por R$ 1.000 vendidos</td><td class="num">${money(rec ? ip.custo / rec * 1000 : 0)}</td></tr></tbody></table>` : '<div class="empty">Sem meses com receita lançada e operação FIDC.</div>';

  // Custos fora do borderô
  const fora = custosFora(fundos).filter(l => (!f.mes || +l.data.slice(5, 7) === f.mes) && (!f.fundo || l.fundo === f.fundo));
  const I = ind(ops.filter(o => mesOk(o) && fundoOk(o))); const tf = fora.reduce((s, l) => s + +l.valor, 0);
  $('#fora', root).innerHTML = `<table><thead><tr><th>Data</th><th>Fundo</th><th>Conta</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>
    ${fora.map(l => `<tr><td>${dateBR(l.data)}</td><td>${esc(l.fundo)}</td><td>${esc(state.cad.contaById[l.conta_id]?.nome || '')}</td><td class="wrap small">${esc(l.descricao || '')}</td><td class="num">${money(l.valor)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum no período.</td></tr>'}
    <tr class="row-total"><td colspan="4">Custo dos borderôs + custos fora</td><td class="num">${money0(I.custo + tf)}</td></tr>
    <tr><td colspan="4" class="muted">Custo % da face com custos fora</td><td class="num">${pct(I.face ? (I.custo + tf) / I.face : 0, 2)}</td></tr></tbody></table>`;

  // Calendário de liquidação (12 semanas, segunda a domingo)
  const d0 = new Date(hoje + 'T12:00:00'); const seg = new Date(d0); seg.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  const semanas = Array.from({ length: 12 }, (_, i) => { const a = new Date(seg); a.setDate(seg.getDate() + 7 * i); const b = new Date(a); b.setDate(a.getDate() + 6); return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)]; });
  const fdCal = fundos.filter(fd => aVencer.some(t => t.fundo === fd));
  const somaS = (a, b, fd) => aVencer.filter(t => t.vencimento >= a && t.vencimento <= b && (!fd || t.fundo === fd)).reduce((s, t) => s + +t.valor, 0);
  const depois = aVencer.filter(t => t.vencimento > semanas.at(-1)[1]).reduce((s, t) => s + +t.valor, 0);
  const lbl = ([a, b]) => `${dateBR(a).slice(0, 5)}–${dateBR(b).slice(0, 5)}`;
  $('#cal', root).innerHTML = `<table><thead><tr><th>Semana</th>${fdCal.map(fd => `<th class="num">${esc(fd)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
    ${semanas.map(w => `<tr><td>${lbl(w)}</td>${fdCal.map(fd => { const v = somaS(w[0], w[1], fd); return `<td class="num">${v ? money0(v) : '–'}</td>`; }).join('')}<td class="num"><strong>${money0(somaS(w[0], w[1]))}</strong></td></tr>`).join('')}
    ${depois ? `<tr class="muted"><td>Depois de ${dateBR(semanas.at(-1)[1])}</td>${fdCal.map(fd => `<td class="num">${money0(aVencer.filter(t => t.fundo === fd && t.vencimento > semanas.at(-1)[1]).reduce((s, t) => s + +t.valor, 0))}</td>`).join('')}<td class="num">${money0(depois)}</td></tr>` : ''}</tbody></table>`;
  chart($('#ch-cal', root), {
    type: 'bar',
    data: { labels: semanas.map(lbl), datasets: fdCal.map(fd => ({ label: fd, data: semanas.map(w => +somaS(w[0], w[1], fd).toFixed(2)), backgroundColor: corFundo[fd], borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(), borderWidth: { top: 2 }, maxBarThickness: 40 })) },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => moneyCurto(v) } } },
      plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money0(x.raw)}` } } } },
  });
}

// ---------- Ficha do sacado ----------
function fichaSacado(nome) {
  const ts = tits.filter(t => (t.sacado_agrupado || t.sacado || '(sem nome)') === nome).sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
  const hoje = hojeISO(); const totT = tits.reduce((s, t) => s + +t.valor, 0);
  const v = ts.reduce((s, t) => s + +t.valor, 0);
  const pz = v ? ts.reduce((s, t) => s + +t.valor * Math.max(0, dias(t.data_operacao, t.vencimento)), 0) / v : 0;
  const av = ts.filter(t => t.vencimento > hoje); const vav = av.reduce((s, t) => s + +t.valor, 0);
  const porF = {}; for (const t of ts) porF[t.fundo] = (porF[t.fundo] || 0) + +t.valor;
  const porM = Array(12).fill(0); for (const t of ts) porM[+t.data_operacao.slice(5, 7) - 1] += +t.valor;
  const docs = [...new Set(ts.map(t => t.sacado).filter(Boolean))];
  const opById = Object.fromEntries(ops.map(o => [o.id, o]));
  modal({
    title: nome, wide: true,
    body: `<div class="kpis">
        <div class="kpi"><div class="k-label">Valor cedido no ano</div><div class="k-value">${money0(v)}</div><div class="k-sub">${pct(totT ? v / totT : 0)} do total · ${ts.length} títulos</div></div>
        <div class="kpi"><div class="k-label">A vencer (coobrigação)</div><div class="k-value">${money0(vav)}</div><div class="k-sub">${av.length} títulos</div></div>
        <div class="kpi"><div class="k-label">Prazo médio</div><div class="k-value">${num1(pz)} dias</div></div>
        <div class="kpi"><div class="k-label">Fundos</div><div class="k-value" style="font-size:15px">${Object.entries(porF).sort((a, b) => b[1] - a[1]).map(([fd, x]) => `${esc(fd)} ${pct(x / v)}`).join('<br>')}</div></div>
      </div>
      ${docs.length > 1 ? `<p class="small muted" style="margin:10px 0 0">Empresas do grupo: ${docs.map(esc).join(' · ')}</p>` : ''}
      <h3 style="margin-top:16px">Cedido por mês</h3>
      <div class="table-wrap"><table><thead><tr>${MESES_CURTO.map(m => `<th class="num">${m}</th>`).join('')}</tr></thead><tbody><tr>${porM.map(x => `<td class="num">${x ? money0(x) : '–'}</td>`).join('')}</tr></tbody></table></div>
      <h3 style="margin-top:16px">Títulos (${ts.length})</h3>
      <div class="table-wrap" style="max-height:320px"><table><thead><tr><th>Vencimento</th><th>Situação</th><th>Fundo</th><th>Borderô</th><th>Operação</th><th>Empresa</th><th class="num">Valor</th></tr></thead><tbody>
      ${ts.map(t => `<tr><td>${dateBR(t.vencimento)}</td><td>${t.vencimento > hoje ? `<span class="badge aberto">vence em ${dias(hoje, t.vencimento)} d</span>` : '<span class="badge pago">vencido</span>'}</td><td>${esc(t.fundo)}</td><td>${esc(opById[t.operacao_id]?.bordero || '')}</td><td>${dateBR(t.data_operacao)}</td><td class="small">${esc(t.sacado || '')}</td><td class="num">${money(t.valor)}</td></tr>`).join('')}</tbody></table></div>`,
    foot: '<button class="btn" data-close>Fechar</button>',
  });
}

// ---------- PDF da análise ----------
// A fonte padrão do PDF não tem alguns símbolos; troca por equivalentes simples
const pdfTxt = (t) => String(t ?? '').replace(/✓/g, 'OK').replace(/↳\s*/g, '   ').replace(/[−–]/g, '-').replace(/Δ/g, 'Dif.').replace(/×/g, 'x').replace(/[⚠ℹ]\s*/g, '').replace(/\u00a0/g, ' ');
async function gerarPDF(root) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const azul = [43, 85, 152], marinho = [42, 31, 111];
  const logo = await logoPNG();
  const periodo = pdfTxt($('#exec-tit', root).textContent.replace('Resumo executivo — ', ''));
  const cabecalho = () => {
    if (logo) doc.addImage(logo.data, 'PNG', 14, 8, 13 * logo.ratio, 13);
    doc.setTextColor(...marinho); doc.setFontSize(15); doc.setFont(undefined, 'bold');
    doc.text('Análise de operações FIDC', W - 14, 14, { align: 'right' });
    doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90);
    doc.text(`${state.empresa.nome} · ${periodo} · emitido em ${dateBR(hojeISO())}`, W - 14, 19.5, { align: 'right' });
    doc.setDrawColor(...marinho); doc.setLineWidth(.6); doc.line(14, 24, W - 14, 24); doc.setTextColor(20);
  };
  const tabela = (sel, titulo, opts = {}) => {
    const t = $(sel + ' table', root); if (!t) return;
    let y = (doc.lastAutoTable?.finalY ?? 24) + 9;
    if (y > H - 40) { doc.addPage(); cabecalho(); y = 33; }
    doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(...marinho); doc.text(pdfTxt(titulo), 14, y); doc.setTextColor(20); doc.setFont(undefined, 'normal');
    doc.autoTable({ html: t, startY: y + 2, theme: 'grid', styles: { fontSize: 7.5, cellPadding: 1.4, lineColor: [226, 231, 239] }, headStyles: { fillColor: azul, textColor: 255 },
      didParseCell: (d) => { d.cell.text = d.cell.text.map(pdfTxt); if (d.section === 'body' && d.row.raw?.classList?.contains('row-total')) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [232, 238, 248]; } if (d.section === 'body' && d.column.index > 0) d.cell.styles.halign = 'right'; },
      margin: { left: 14, right: 14, top: 30 }, didDrawPage: () => {}, ...opts });
  };
  cabecalho();
  // Indicadores
  const kp = [...root.querySelectorAll('#kp .kpi')].map(k => [k.querySelector('.k-label').textContent, k.querySelector('.k-value').textContent, k.querySelector('.k-sub')?.textContent || ''].map(pdfTxt));
  doc.autoTable({ startY: 28, theme: 'plain', body: [kp.slice(0, 4).map(x => x[0]), kp.slice(0, 4).map(x => x[1]), kp.slice(0, 4).map(x => x[2]), kp.slice(4).map(x => x[0]), kp.slice(4).map(x => x[1]), kp.slice(4).map(x => x[2])],
    styles: { fontSize: 8, cellPadding: { top: .6, bottom: .6, left: 2, right: 2 } }, margin: { left: 14, right: 14 },
    columnStyles: Object.fromEntries([0, 1, 2, 3].map(i => [i, { cellWidth: (W - 28) / 4 }])),
    didParseCell: (d) => { const r = d.row.index % 3; if (r === 0) { d.cell.styles.textColor = 110; d.cell.styles.fontSize = 7.5; } if (r === 1) { d.cell.styles.fontSize = 13; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = marinho; } if (r === 2) { d.cell.styles.textColor = 110; d.cell.styles.fontSize = 7.5; } } });
  // Alertas
  const al = [...root.querySelectorAll('#alertas .alert-row')].map(a => [a.querySelector('.alert-tag').textContent.replace(/^\S+\s/, ''), a.querySelector('strong').textContent, a.querySelector('.small').textContent].map(pdfTxt));
  let y = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(...marinho); doc.text('Alertas', 14, y); doc.setTextColor(20); doc.setFont(undefined, 'normal');
  doc.autoTable({ startY: y + 2, theme: 'grid', head: [['Status', 'Alerta', 'Detalhe']], body: al, styles: { fontSize: 7.5, cellPadding: 1.4 }, headStyles: { fillColor: azul },
    columnStyles: { 0: { cellWidth: 20, fontStyle: 'bold' }, 1: { cellWidth: 70 } }, margin: { left: 14, right: 14 },
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0) d.cell.styles.textColor = d.cell.raw === 'Atenção' ? [192, 53, 43] : d.cell.raw === 'OK' ? [18, 122, 74] : azul; } });
  // Gráficos
  const graf = [['#ch', 'Taxa do fundo a.m. por mês × CDI'], ['#ch-cart', 'Coobrigação por prazo de vencimento']].map(([s2, t]) => [$(s2, root), t]).filter(([c]) => c && c._chart && c.width);
  if (graf.length) try {
    doc.addPage(); cabecalho();
    const gw = (W - 28 - 8) / 2;
    graf.forEach(([c, t], i) => { const x = 14 + i * (gw + 8); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.setTextColor(...marinho); doc.text(pdfTxt(t), x, 33); doc.setTextColor(20);
      const h = gw * c.height / c.width; const bg = document.createElement('canvas'); bg.width = c.width; bg.height = c.height; const g = bg.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, bg.width, bg.height); g.drawImage(c, 0, 0);
      doc.addImage(bg.toDataURL('image/png'), 'PNG', x, 36, gw, Math.min(h, 95)); });
    doc.lastAutoTable.finalY = 36 + 95;
  } catch (e) { console.warn('Gráficos fora do PDF:', e); }
  tabela('#cmp', 'Comparativo entre fundos');
  tabela('#cart', 'Carteira cedida a vencer (coobrigação)');
  tabela('#rec', 'Recompras descontadas nos borderôs');
  tabela('#comp', 'Composição do custo');
  tabela('#opo', 'Custo de oportunidade');
  const sac = $('#sac table', root);
  if (sac) { const clone = sac.cloneNode(true); [...clone.tBodies[0].rows].slice(10).forEach(r => { if (!r.classList.contains('row-total')) r.remove(); }); const tmp = document.createElement('div'); tmp.id = 'tmp-sac'; tmp.style.display = 'none'; tmp.appendChild(clone); root.appendChild(tmp); tabela('#tmp-sac', `Concentração por sacado — top 10 · ${$('#hhi', root).textContent.trim()}`); tmp.remove(); }
  tabela('#conc', 'Conciliação borderôs × fluxo de caixa');
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(130); doc.text(`Página ${i} de ${n}`, W - 14, H - 7, { align: 'right' }); doc.text('Fonte: borderôs dos fundos e lançamentos do fluxo de caixa', 14, H - 7); }
  doc.save(`analise_fidc_${periodo.replace(/[^\wÀ-ú]+/g, '_')}.pdf`);
}

const moneyCurto = (v) => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' mi' : a >= 1e3 ? Math.round(v / 1e3) + ' mil' : v; };

function editar(o, root) {
  const ed = podeEditar();
  const campos = [['valor_face', 'Valor de face'], ['desagio', 'Deságio / juros'], ['ad_valorem', 'Ad valorem'], ['tarifas', 'Tarifas'], ['iof', 'IOF'],
    ['encargos', 'Prorrog. / encargos'], ['recompra', 'Recompra'], ['desc_sacado', 'Desc. ao sacado'], ['liquido', 'Líquido creditado']];
  const tlist = o.id ? tits.filter(t => t.operacao_id === o.id) : [];
  const m = modal({
    title: o.id ? `Borderô ${o.bordero} — ${o.fundo}` : 'Novo borderô', wide: true,
    body: `<form id="ff" class="grid-form">
      <label>Fundo<input name="fundo" value="${esc(o.fundo || '')}" required list="dl-fundos"><datalist id="dl-fundos">${[...new Set(ops.map(x => x.fundo))].map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <label>Data<input type="date" name="data" value="${o.data || ''}" required></label>
      <label>Borderô<input name="bordero" value="${esc(o.bordero || '')}" required></label>
      <label>Conta crédito<select name="conta_id">${options(state.cad.contas, { empty: '—', selected: o.conta_id })}</select></label>
      <label>Qtd. títulos<input name="qtd_titulos" type="number" value="${o.qtd_titulos ?? ''}"></label>
      <label>Prazo real (dias)<input name="prazo_medio" inputmode="decimal" value="${o.prazo_medio ?? ''}"></label>
      <label>Prazo cobrado pelo fundo (dias)<input name="prazo_cobrado" inputmode="decimal" value="${o.prazo_cobrado ?? ''}" placeholder="igual ao real"></label>
      ${campos.map(([k, n]) => `<label>${n}<input name="${k}" inputmode="decimal" value="${o[k] != null ? money(o[k]) : ''}"></label>`).join('')}
      <label class="span2">Observação<input name="observacao" value="${esc(o.observacao || '')}"></label>
    </form>
    ${tlist.length ? `<h3 style="margin-top:18px">Títulos cedidos (${tlist.length})</h3><div class="table-wrap" style="max-height:260px"><table><thead><tr><th>Vencimento</th><th>Sacado</th><th class="num">Valor</th></tr></thead><tbody>
      ${tlist.map(t => `<tr><td>${dateBR(t.vencimento)}</td><td>${esc(t.sacado_agrupado || t.sacado || '')}</td><td class="num">${money(t.valor)}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
    foot: ed ? `${o.id ? '<button class="btn danger" id="fdel" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fsave">Salvar</button>` : '<button class="btn" data-close>Fechar</button>',
  });
  if (!ed) return;
  $('#fsave', m.el).onclick = async () => {
    const form = $('#ff', m.el); if (!form.reportValidity()) return;
    const d = formData(form);
    const row = { empresa_id: state.empresa.id, fundo: d.fundo, data: d.data, bordero: d.bordero, conta_id: d.conta_id, observacao: d.observacao,
      qtd_titulos: +d.qtd_titulos || 0, prazo_medio: parseNum(d.prazo_medio), prazo_cobrado: d.prazo_cobrado ? parseNum(d.prazo_cobrado) : null };
    for (const [k] of campos) row[k] = parseNum(d[k]);
    try {
      if (o.id) await q(sb.from('fidc_operacoes').update(row).eq('id', o.id)); else await q(sb.from('fidc_operacoes').insert(row));
      toast('Borderô salvo'); m.close(); render(root);
    } catch (e) { fail(e); }
  };
  if (o.id) $('#fdel', m.el).onclick = async () => {
    if (!confirm('Excluir este borderô e seus títulos?')) return;
    try { await q(sb.from('fidc_operacoes').delete().eq('id', o.id)); toast('Excluído'); m.close(); render(root); } catch (e) { fail(e); }
  };
}

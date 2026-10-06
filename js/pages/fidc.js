import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, esc, money, money0, pct, dateBR, options, fail, toast, modal, formData, parseNum, exportXLSX, chart, CORES, COR, MESES, MESES_CURTO, loading } from '../lib/ui.js';

export const title = 'Análise FIDC';
const f = { mes: 0, fundo: '', cdi: '' };
let ops = [], tits = [];

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
      <label>CDI a.m. (%)<input name="cdi" inputmode="decimal" value="${esc(f.cdi)}" placeholder="ex.: 1,10"></label>
      <span class="spacer"></span><button class="btn" id="exp">Exportar operações</button>
      ${podeEditar() ? '<button class="btn primary" id="novo">+ Novo borderô</button>' : ''}</div></div>
    <div class="exec-head"><h2 id="exec-tit">Resumo executivo</h2><span class="muted small" id="exec-sub"></span></div>
    <div class="kpis" id="kp"></div>
    <div class="card"><div class="card-head"><h2>Alertas</h2><span class="muted small">Seguem os filtros de mês e fundo, exceto a conferência dos borderôs (base inteira).</span></div><div id="alertas" class="alert-list"></div></div>
    <div class="grid2">
      ${card('cmp', 'Comparativo entre fundos', 'Segue só o filtro de mês. Taxa do fundo usa o prazo cobrado no borderô; custo efetivo, o prazo real dos títulos. Ranking 1 = menor taxa.')}
      <div class="card"><h2>Taxa do fundo a.m. por mês</h2><div class="chart-box"><canvas id="ch"></canvas></div></div>
    </div>
    <div class="grid2">
      ${card('cart', 'Carteira cedida a vencer', 'Coobrigação: títulos cedidos ainda não vencidos. Se o sacado não pagar, o fundo cobra a recompra da IPLAMM. Posição de hoje, todos os meses.')}
      <div class="card"><h2>Coobrigação por prazo de vencimento</h2><div class="chart-box"><canvas id="ch-cart"></canvas></div></div>
    </div>
    <div class="grid2">
      ${card('sac', 'Concentração por sacado — top 20', 'Segue os filtros de mês e fundo. HHI = soma dos quadrados das participações (0 a 10.000).', '<span id="hhi"></span>')}
      <div class="card"><h2>Participação acumulada dos sacados</h2><div class="chart-box"><canvas id="ch-sac"></canvas></div></div>
    </div>
    ${card('rec', 'Recompras descontadas nos borderôs', 'Por fundo e mês, ano inteiro (não segue os filtros).')}
    ${card('comp', 'Composição do custo', 'Segue o filtro de mês. Custo = deságio + ad valorem + tarifas + IOF + prorrogação/encargos; recompras e descontos ao sacado não são custo.')}
    ${card('evo', 'Evolução mensal', 'Segue o filtro de fundo.')}
    ${card('fx', 'Custo por faixa de prazo', 'Segue os filtros de mês e fundo (as colunas por fundo seguem só o mês).')}
    ${card('ops', 'Operações (borderôs)', 'Clique numa linha para ver os títulos ou editar.')}`;
  $('#flt', root).addEventListener('change', (e) => { f[e.target.name] = e.target.name === 'mes' ? +e.target.value : e.target.value; desenhar(root); });
  $('#exp', root).onclick = () => exportXLSX($('#ops table', root), `fidc_operacoes_${state.ano}`);
  $('#novo', root) && ($('#novo', root).onclick = () => editar({}, root));
  loading($('#ops', root));
  try {
    const e = state.empresa.id;
    [ops, tits] = await Promise.all([
      fetchAll(() => sb.from('fidc_operacoes').select('*').eq('empresa_id', e).gte('data', `${state.ano}-01-01`).lte('data', `${state.ano}-12-31`).order('data')),
      fetchAll(() => sb.from('fidc_titulos').select('operacao_id,fundo,valor,vencimento,data_operacao,sacado_agrupado,sacado').eq('empresa_id', e).gte('data_operacao', `${state.ano}-01-01`).lte('data_operacao', `${state.ano}-12-31`)),
    ]);
    desenhar(root);
  } catch (err) { fail(err); }
}

function desenhar(root) {
  const fundos = [...new Set(ops.map(o => o.fundo))].sort();
  $('#sel-fundo', root).innerHTML = options(fundos.map(x => ({ id: x, nome: x })), { empty: 'Todos', selected: f.fundo });
  const mesOk = (o) => !f.mes || +o.data.slice(5, 7) === f.mes;
  const fundoOk = (o) => !f.fundo || o.fundo === f.fundo;
  const sel = ops.filter(o => mesOk(o) && fundoOk(o));
  const I = ind(sel); const cdi = f.cdi ? parseNum(f.cdi) / 100 : null;
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
    <div class="kpi"><div class="k-label">Taxa do fundo a.m.</div><div class="k-value">${pct(I.taxa, 2)}</div><div class="k-sub">custo efetivo ${pct(I.taxaEf, 2)}${cdi ? ' · spread ' + pp(I.taxa - cdi) : ''}</div></div>
    <div class="kpi"><div class="k-label">Prazo cobrado</div><div class="k-value">${num1(I.prazoC)} dias</div><div class="k-sub">prazo real ${num1(I.prazo)} dias</div></div>
    <div class="kpi"><div class="k-label">Coobrigação a vencer</div><div class="k-value">${money0(totVencer)}</div><div class="k-sub">${money0(prox30)} nos próximos 30 dias</div></div>
    <div class="kpi"><div class="k-label">Recompras</div><div class="k-value">${money0(I.rec)}</div><div class="k-sub">${pct(I.recPct, 2)} da face</div></div>
    <div class="kpi"><div class="k-label">Maior sacado</div><div class="k-value">${pct(totT && maior ? maior[1].v / totT : 0)}</div><div class="k-sub" title="${esc(maior?.[0] || '')}">${esc((maior?.[0] || '–').slice(0, 30))}</div></div>
    <div class="kpi"><div class="k-label">Concentração (HHI)</div><div class="k-value">${Math.round(hhi).toLocaleString('pt-BR')}</div><div class="k-sub"><span class="badge ${hhiCls}">${hhiNome}</span></div></div>`;

  // ---------- Comparativo entre fundos (só filtro de mês) ----------
  const porFundo = fundos.map(fd => ({ fd, ...ind(ops.filter(o => mesOk(o) && o.fundo === fd)) })).filter(x => x.n);
  const tot = ind(ops.filter(mesOk));
  const minT = Math.min(...porFundo.map(x => x.taxa).filter(Boolean));
  const rank = [...porFundo].sort((a, b) => a.taxa - b.taxa).map(x => x.fd);
  $('#cmp', root).innerHTML = `<table><thead><tr><th>Fundo</th><th class="num">Op.</th><th class="num">Face</th><th class="num">Part.</th><th class="num">Custo %</th><th class="num">Prazo cobr.</th><th class="num">Taxa do fundo</th><th class="num">Custo efetivo</th><th class="num">Δ vs. + barato</th>${cdi ? '<th class="num">Spread CDI</th>' : ''}<th class="num">Recompra %</th><th class="num">Rank</th></tr></thead><tbody>
    ${porFundo.map(x => `<tr><td><span class="dot" style="background:${corFundo[x.fd]}"></span>${esc(x.fd)}</td><td class="num">${x.n}</td><td class="num">${money0(x.face)}</td><td class="num">${pct(tot.face ? x.face / tot.face : 0)}</td>
      <td class="num">${pct(x.custoPct, 2)}</td><td class="num">${num1(x.prazoC)}</td><td class="num"><strong>${pct(x.taxa, 2)}</strong></td><td class="num">${pct(x.taxaEf, 2)}</td>
      <td class="num">${x.taxa - minT > 1e-9 ? pp(x.taxa - minT) : '—'}</td>${cdi ? `<td class="num">${pp(x.taxa - cdi)}</td>` : ''}
      <td class="num${x.recPct > 0.05 ? ' neg' : ''}">${pct(x.recPct, 2)}</td><td class="num">${rank.indexOf(x.fd) + 1}º</td></tr>`).join('')}
    <tr class="row-total"><td>TOTAL</td><td class="num">${tot.n}</td><td class="num">${money0(tot.face)}</td><td class="num">100%</td><td class="num">${pct(tot.custoPct, 2)}</td><td class="num">${num1(tot.prazoC)}</td><td class="num">${pct(tot.taxa, 2)}</td><td class="num">${pct(tot.taxaEf, 2)}</td><td></td>${cdi ? `<td class="num">${pp(tot.taxa - cdi)}</td>` : ''}<td class="num">${pct(tot.recPct, 2)}</td><td></td></tr></tbody></table>`;

  const porMes = (list) => Array.from({ length: 12 }, (_, i) => ind(list.filter(o => +o.data.slice(5, 7) === i + 1)));
  const ultimoMes = Math.max(0, ...ops.map(o => +o.data.slice(5, 7)));
  const labelsAte = MESES_CURTO.slice(0, Math.max(ultimoMes, 1));
  chart($('#ch', root), {
    type: 'line',
    data: { labels: labelsAte, datasets: fundos.map(fd => ({ label: fd, data: porMes(ops.filter(o => o.fundo === fd)).slice(0, labelsAte.length).map(x => x.n ? +(x.taxa * 100).toFixed(3) : null),
      borderColor: corFundo[fd], backgroundColor: corFundo[fd], spanGaps: false, tension: .2, pointRadius: 4 })) },
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
    ${top.map((x, i) => `<tr><td>${i + 1}</td><td class="wrap">${esc(x.k)}</td><td class="small">${esc([...x.v.fundos].sort().join(', '))}</td><td class="num">${x.v.n}</td><td class="num">${money0(x.v.v)}</td><td class="num${x.v.v / totT > .3 ? ' neg' : ''}">${pct(x.v.v / totT)}</td><td class="num">${pct(x.acum / totT)}</td><td class="num">${x.v.v ? num1(x.v.pz / x.v.v) : '–'}</td></tr>`).join('')}
    ${demais.length ? `<tr><td></td><td>Demais sacados (${demais.length})</td><td></td><td class="num">${demais.reduce((s, [, v]) => s + v.n, 0)}</td><td class="num">${money0(demais.reduce((s, [, v]) => s + v.v, 0))}</td><td class="num">${pct(demais.reduce((s, [, v]) => s + v.v, 0) / totT)}</td><td class="num">100%</td><td></td></tr>` : ''}
    <tr class="row-total"><td></td><td>TOTAL</td><td></td><td class="num">${tsel.length}</td><td class="num">${money0(totT)}</td><td class="num">100%</td><td></td><td></td></tr></tbody></table>` : '<div class="empty">Nenhum título no período.</div>';
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

  // ---------- Faixa de prazo ----------
  const fx = {}; for (const o of sel) { const k = faixa(prazoCob(o)); (fx[k] ||= []).push(o); }
  const fxF = {}; for (const o of ops.filter(mesOk)) { const k = faixa(prazoCob(o)); ((fxF[k] ||= {})[o.fundo] ||= []).push(o); }
  $('#fx', root).innerHTML = `<table><thead><tr><th>Faixa (prazo cobrado)</th><th class="num">Op.</th><th class="num">Face</th><th class="num">% do volume</th><th class="num">Custo % face</th><th class="num">Taxa do fundo</th>${fundos.map(fd => `<th class="num">Taxa ${esc(fd)}</th>`).join('')}</tr></thead><tbody>
    ${Object.keys(fx).sort().map(k => { const x = ind(fx[k]); return `<tr><td>${k}</td><td class="num">${x.n}</td><td class="num">${money0(x.face)}</td><td class="num">${pct(I.face ? x.face / I.face : 0)}</td><td class="num">${pct(x.custoPct, 2)}</td><td class="num"><strong>${pct(x.taxa, 2)}</strong></td>${fundos.map(fd => { const l = fxF[k]?.[fd]; return `<td class="num">${l ? pct(ind(l).taxa, 2) : '–'}</td>`; }).join('')}</tr>`; }).join('')}
    <tr class="row-total"><td>TOTAL</td><td class="num">${I.n}</td><td class="num">${money0(I.face)}</td><td class="num">100%</td><td class="num">${pct(I.custoPct, 2)}</td><td class="num">${pct(I.taxa, 2)}</td>${fundos.map(() => '<td></td>').join('')}</tr></tbody></table>`;

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
    cdi != null ? (I.taxa > cdi + 0.02 ? ['atencao', 'Taxa acima do CDI + 2 p.p.', `Spread de ${pp(I.taxa - cdi)} sobre o CDI informado.`] : ['ok', 'Taxa dentro de CDI + 2 p.p.', `Spread de ${pp(I.taxa - cdi)}.`])
      : ['info', 'Spread sobre o CDI', 'Informe o CDI a.m. no filtro para comparar.'],
    venc7 ? ['info', 'Coobrigação vencendo em 7 dias', `${money0(venc7)} em títulos cedidos vencem até ${dateBR(new Date(Date.parse(hoje) + 7 * 864e5).toISOString().slice(0, 10))}.`] : null,
    foraBrad.length ? ['info', 'Créditos fora do Bradesco', `${foraBrad.length} borderô(s), ${money0(foraBrad.reduce((s, o) => s + +o.liquido, 0))} creditados em outras contas.`] : null,
  ].filter(Boolean).sort((a, b) => ['atencao', 'info', 'ok'].indexOf(a[0]) - ['atencao', 'info', 'ok'].indexOf(b[0]));
  const ROT = { atencao: ['⚠', 'Atenção'], info: ['ℹ', 'Info'], ok: ['✓', 'OK'] };
  $('#alertas', root).innerHTML = A.map(([st, t, d]) => `<div class="alert-row ${st}"><span class="alert-tag">${ROT[st][0]} ${ROT[st][1]}</span><div><strong>${esc(t)}</strong><div class="small muted">${esc(d)}</div></div></div>`).join('');
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

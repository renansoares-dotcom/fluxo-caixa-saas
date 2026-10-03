import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, esc, money, money0, pct, dateBR, options, fail, toast, modal, formData, parseNum, exportXLSX, chart, CORES, MESES, MESES_CURTO, loading } from '../lib/ui.js';

export const title = 'Análise FIDC';
const f = { mes: 0, fundo: '', cdi: '' };
let ops = [], tits = [];

// Indicadores agregados (mesmas fórmulas da aba 5.7)
function ind(list) {
  const face = list.reduce((s, o) => s + +o.valor_face, 0);
  const custo = list.reduce((s, o) => s + +o.custo_total, 0);
  const liq = list.reduce((s, o) => s + +o.liquido, 0);
  const fp = list.reduce((s, o) => s + +o.valor_face * +o.prazo_medio, 0);
  const prazo = face ? fp / face : 0;
  const taxa = face && prazo && face - custo ? custo / (face - custo) / prazo * 30 : 0;
  const rec = list.reduce((s, o) => s + +o.recompra, 0);
  return { face, custo, liq, prazo, taxa, rec, n: list.length, titulos: list.reduce((s, o) => s + (+o.qtd_titulos || 0), 0), custoPct: face ? custo / face : 0, recPct: face ? rec / face : 0 };
}
const faixa = (p) => p <= 30 ? '1. Até 30 dias' : p <= 45 ? '2. 31 a 45 dias' : p <= 60 ? '3. 46 a 60 dias' : p <= 90 ? '4. 61 a 90 dias' : '5. Acima de 90 dias';

export async function render(root) {
  root.innerHTML = `<div class="card"><div class="toolbar" id="flt">
      <label>Mês<select name="mes">${options([{ id: 0, nome: 'Acumulado' }, ...MESES.map((n, i) => ({ id: i + 1, nome: n }))], { selected: f.mes })}</select></label>
      <label>Fundo<select name="fundo" id="sel-fundo"></select></label>
      <label>CDI a.m. (%)<input name="cdi" inputmode="decimal" value="${esc(f.cdi)}" placeholder="ex.: 1,10"></label>
      <span class="spacer"></span><button class="btn" id="exp">Exportar operações</button>
      ${podeEditar() ? '<button class="btn primary" id="novo">+ Novo borderô</button>' : ''}</div></div>
    <div class="kpis" id="kp"></div>
    <div class="grid2">
      <div class="card flush"><div style="padding:16px 16px 0"><h2>Comparativo entre fundos</h2><p class="muted small" style="margin:-6px 0 8px">Segue só o filtro de mês. Ranking 1 = menor taxa.</p></div><div class="table-wrap" id="cmp"></div></div>
      <div class="card"><h2>Taxa efetiva a.m. por fundo</h2><div class="chart-box"><canvas id="ch"></canvas></div></div>
    </div>
    <div class="card flush"><div style="padding:16px 16px 0"><h2>Evolução mensal</h2></div><div class="table-wrap" id="evo"></div></div>
    <div class="grid2">
      <div class="card flush"><div style="padding:16px 16px 0"><h2>Maiores sacados</h2></div><div class="table-wrap" id="sac"></div></div>
      <div class="card flush"><div style="padding:16px 16px 0"><h2>Por faixa de prazo</h2></div><div class="table-wrap" id="fx"></div></div>
    </div>
    <div class="card flush"><div style="padding:16px 16px 0"><h2>Operações (borderôs)</h2></div><div class="table-wrap" id="ops"></div></div>`;
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
  const sel = ops.filter(o => mesOk(o) && (!f.fundo || o.fundo === f.fundo));
  const I = ind(sel); const cdi = f.cdi ? parseNum(f.cdi) / 100 : null;
  $('#kp', root).innerHTML = `
    <div class="kpi"><div class="k-label">Valor de face antecipado</div><div class="k-value">${money0(I.face)}</div><div class="k-sub">${I.n} operações · ${I.titulos} títulos</div></div>
    <div class="kpi"><div class="k-label">Líquido creditado</div><div class="k-value">${money0(I.liq)}</div></div>
    <div class="kpi"><div class="k-label">Custo total</div><div class="k-value neg">${money0(I.custo)}</div><div class="k-sub">${pct(I.custoPct, 2)} da face</div></div>
    <div class="kpi"><div class="k-label">Taxa efetiva a.m.</div><div class="k-value">${pct(I.taxa, 2)}</div><div class="k-sub">${cdi ? 'spread s/ CDI: ' + ((I.taxa - cdi) * 100).toFixed(2).replace('.', ',') + ' p.p.' : 'informe o CDI para ver o spread'}</div></div>
    <div class="kpi"><div class="k-label">Prazo médio</div><div class="k-value">${I.prazo.toFixed(1).replace('.', ',')} dias</div></div>
    <div class="kpi"><div class="k-label">Recompras</div><div class="k-value">${money0(I.rec)}</div><div class="k-sub">${pct(I.recPct, 2)} da face</div></div>`;

  const porFundo = fundos.map(fd => ({ fd, ...ind(ops.filter(o => mesOk(o) && o.fundo === fd)) })).filter(x => x.n);
  const tot = ind(ops.filter(mesOk));
  const minT = Math.min(...porFundo.map(x => x.taxa).filter(Boolean));
  const rank = [...porFundo].sort((a, b) => a.taxa - b.taxa).map(x => x.fd);
  $('#cmp', root).innerHTML = `<table><thead><tr><th>Fundo</th><th class="num">Op.</th><th class="num">Face</th><th class="num">Part.</th><th class="num">Custo %</th><th class="num">Prazo</th><th class="num">Taxa a.m.</th><th class="num">Δ vs. + barato</th>${cdi ? '<th class="num">Spread CDI</th>' : ''}<th class="num">Recompra %</th><th class="num">Rank</th></tr></thead><tbody>
    ${porFundo.map(x => `<tr><td>${esc(x.fd)}</td><td class="num">${x.n}</td><td class="num">${money0(x.face)}</td><td class="num">${pct(tot.face ? x.face / tot.face : 0)}</td>
      <td class="num">${pct(x.custoPct, 2)}</td><td class="num">${x.prazo.toFixed(1).replace('.', ',')}</td><td class="num"><strong>${pct(x.taxa, 2)}</strong></td>
      <td class="num">${((x.taxa - minT) * 100).toFixed(2).replace('.', ',')} p.p.</td>${cdi ? `<td class="num">${((x.taxa - cdi) * 100).toFixed(2).replace('.', ',')} p.p.</td>` : ''}
      <td class="num">${pct(x.recPct, 2)}</td><td class="num">${rank.indexOf(x.fd) + 1}</td></tr>`).join('')}
    <tr class="row-total"><td>TOTAL</td><td class="num">${tot.n}</td><td class="num">${money0(tot.face)}</td><td class="num">100%</td><td class="num">${pct(tot.custoPct, 2)}</td><td class="num">${tot.prazo.toFixed(1).replace('.', ',')}</td><td class="num">${pct(tot.taxa, 2)}</td><td></td>${cdi ? '<td></td>' : ''}<td class="num">${pct(tot.recPct, 2)}</td><td></td></tr></tbody></table>`;

  const porMes = (list) => Array.from({ length: 12 }, (_, i) => ind(list.filter(o => +o.data.slice(5, 7) === i + 1)));
  const baseF = ops.filter(o => !f.fundo || o.fundo === f.fundo);
  const ev = porMes(baseF);
  const linha = (n, fn, fmt) => `<tr><td class="sticky">${n}</td>${ev.map(x => `<td class="num">${x.n ? fmt(fn(x)) : '–'}</td>`).join('')}<td class="num"><strong>${fmt(fn(ind(baseF)))}</strong></td></tr>`;
  $('#evo', root).innerHTML = `<table><thead><tr><th class="sticky">${esc(f.fundo || 'Todos os fundos')}</th>${MESES.map(m => `<th class="num">${m}</th>`).join('')}<th class="num">ANO</th></tr></thead><tbody>
    ${linha('Valor de face', x => x.face, money0)}${linha('Líquido creditado', x => x.liq, money0)}${linha('Custo total', x => x.custo, money0)}
    ${linha('Custo % da face', x => x.custoPct, v => pct(v, 2))}${linha('Taxa efetiva a.m.', x => x.taxa, v => pct(v, 2))}
    ${linha('Prazo médio (dias)', x => x.prazo, v => v.toFixed(1).replace('.', ','))}${linha('Nº operações', x => x.n, v => v)}${linha('Recompras', x => x.rec, money0)}</tbody></table>`;

  chart($('#ch', root), {
    type: 'line',
    data: { labels: MESES_CURTO, datasets: fundos.map((fd, i) => ({ label: fd, data: porMes(ops.filter(o => o.fundo === fd)).map(x => x.n ? +(x.taxa * 100).toFixed(3) : null),
      borderColor: CORES[i % CORES.length], backgroundColor: CORES[i % CORES.length], spanGaps: false, tension: .2 })) },
    options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: v => v + '%' } } },
      plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${String(x.raw).replace('.', ',')}% a.m.` } } } },
  });

  const opIds = new Set(sel.map(o => o.id));
  const tsel = tits.filter(t => opIds.has(t.operacao_id));
  const sac = {}; for (const t of tsel) { const k = t.sacado_agrupado || t.sacado || '(sem nome)'; (sac[k] ||= { v: 0, n: 0, fundos: new Set() }); sac[k].v += +t.valor; sac[k].n++; sac[k].fundos.add(t.fundo); }
  const totT = tsel.reduce((s, t) => s + +t.valor, 0);
  $('#sac', root).innerHTML = `<table><thead><tr><th>#</th><th>Sacado</th><th>Fundos</th><th class="num">Títulos</th><th class="num">Valor</th><th class="num">Part.</th></tr></thead><tbody>
    ${Object.entries(sac).sort((a, b) => b[1].v - a[1].v).slice(0, 20).map(([k, v], i) => `<tr><td>${i + 1}</td><td class="wrap">${esc(k)}</td><td>${esc([...v.fundos].join(', '))}</td><td class="num">${v.n}</td><td class="num">${money0(v.v)}</td><td class="num">${pct(totT ? v.v / totT : 0)}</td></tr>`).join('')}</tbody></table>`;
  const fx = {}; for (const o of sel) { const k = faixa(+o.prazo_medio); (fx[k] ||= []).push(o); }
  $('#fx', root).innerHTML = `<table><thead><tr><th>Faixa</th><th class="num">Op.</th><th class="num">Face</th><th class="num">Taxa a.m.</th></tr></thead><tbody>
    ${Object.keys(fx).sort().map(k => { const x = ind(fx[k]); return `<tr><td>${k}</td><td class="num">${x.n}</td><td class="num">${money0(x.face)}</td><td class="num">${pct(x.taxa, 2)}</td></tr>`; }).join('')}</tbody></table>`;

  $('#ops', root).innerHTML = sel.length ? `<table><thead><tr><th>Data</th><th>Fundo</th><th>Borderô</th><th>Conta</th><th class="num">Títulos</th><th class="num">Face</th><th class="num">Deságio</th><th class="num">Ad valorem</th><th class="num">Tarifas</th><th class="num">IOF</th><th class="num">Encargos</th><th class="num">Custo</th><th class="num">Recompra</th><th class="num">Líquido</th><th class="num">Prazo</th><th class="num">Taxa a.m.</th></tr></thead><tbody>
    ${sel.map(o => { const x = ind([o]); return `<tr class="clickable" data-id="${o.id}"><td>${dateBR(o.data)}</td><td>${esc(o.fundo)}</td><td>${esc(o.bordero)}</td><td>${esc(state.cad.contaById[o.conta_id]?.nome || '')}</td>
      <td class="num">${o.qtd_titulos}</td><td class="num">${money(o.valor_face)}</td><td class="num">${money(o.desagio)}</td><td class="num">${money(o.ad_valorem)}</td><td class="num">${money(o.tarifas)}</td><td class="num">${money(o.iof)}</td><td class="num">${money(o.encargos)}</td>
      <td class="num">${money(o.custo_total)}</td><td class="num">${money(o.recompra)}</td><td class="num">${money(o.liquido)}</td><td class="num">${o.prazo_medio}</td><td class="num">${pct(x.taxa, 2)}</td></tr>`; }).join('')}</tbody></table>`
    : '<div class="empty">Nenhuma operação no período.</div>';
  $('#ops', root).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) editar(ops.find(o => o.id === tr.dataset.id), root); };
}

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
      <label>Prazo médio (dias)<input name="prazo_medio" inputmode="decimal" value="${o.prazo_medio ?? ''}"></label>
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
      qtd_titulos: +d.qtd_titulos || 0, prazo_medio: parseNum(d.prazo_medio) };
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

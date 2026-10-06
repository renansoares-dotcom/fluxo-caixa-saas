import { sb, state, q, fetchAll, filtrosHTML, bindFiltros, matrizMensal, montarMatriz, montarDRE, soma, z, mesesHeader } from '../lib/data.js';
import { $, esc, money, pct, cls, exportXLSX, fail, loading, options, MESES, chart, CORES, COR, MESES_CURTO, moneyTick } from '../lib/ui.js';

export const title = 'Orçado x Realizado';
let comp = 'budget', periodo = 0, vis = 'classe';

export async function render(root) {
  const extra = `<label>Comparar com<select name="comp"><option value="budget">Budget</option><option value="forecast" ${comp === 'forecast' ? 'selected' : ''}>Forecast</option></select></label>
    <label>Período<select name="periodo">${options([{ id: 0, nome: 'Ano inteiro' }, ...MESES.map((n, i) => ({ id: i + 1, nome: n })), { id: 13, nome: 'Acumulado até o mês atual' }], { selected: periodo })}</select></label>
    <label>Visão<select name="vis"><option value="classe">Por classificação</option><option value="dre" ${vis === 'dre' ? 'selected' : ''}>DRE</option></select></label>
    <span class="spacer"></span><button class="btn" id="exp">Exportar Excel</button>`;
  root.innerHTML = filtrosHTML({ visao: false, extra }) + `
    <p class="muted small" style="margin:0">Budget e forecast são lançados por conta do plano (sem filtro de banco/favorecido); os filtros acima afetam apenas o realizado.</p>
    <div class="card"><h2>Mês a mês</h2><div class="chart-box"><canvas id="ch"></canvas></div></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>
    <div class="card flush"><div style="padding:16px 16px 0"><h2 id="t2"></h2></div><div class="table-wrap" id="tbl2"></div></div>`;
  bindFiltros(root, () => load(root));
  for (const n of ['comp', 'periodo', 'vis']) $(`[name=${n}]`, root).onchange = (e) => {
    if (n === 'comp') comp = e.target.value; if (n === 'periodo') periodo = +e.target.value; if (n === 'vis') vis = e.target.value; load(root);
  };
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), `orcado_realizado_${state.ano}`);
  await load(root);
}

async function load(root) {
  const tbl = $('#tbl', root); loading(tbl);
  try {
    const e = state.empresa.id;
    const [real, orc, st] = await Promise.all([
      matrizMensal(state.ano, 'Pago'),
      fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor,cenario').eq('empresa_id', e).eq('ano', state.ano)),
      q(sb.from('forecast_status').select('mes,status').eq('empresa_id', e).eq('ano', state.ano)),
    ]);
    const c = state.cad;
    const sinal = (pid) => c.planoById[pid]?.natureza === 'D' ? -1 : 1;
    const bud = montarMatriz(orc.filter(o => o.cenario === 'budget').map(o => ({ plano_id: o.plano_id, mes: o.mes, total: sinal(o.plano_id) * o.valor })));
    let fc = montarMatriz(orc.filter(o => o.cenario === 'forecast').map(o => ({ plano_id: o.plano_id, mes: o.mes, total: sinal(o.plano_id) * o.valor })));
    // forecast efetivo conforme status do mês
    const stBy = Object.fromEntries(st.map(s => [s.mes, s.status]));
    const efetivo = (getter) => (key) => Array.from({ length: 12 }, (_, i) => {
      const s = stBy[i + 1] || 'Prev. Ajustada';
      const src = s === 'Realizado' ? real : s === 'Prev. Inicial' ? bud : fc;
      return (getter(src, key) || z())[i];
    });
    const fcClasse = efetivo((m, k) => m.classe[k]);
    const fcTipo = efetivo((m, k) => m.tipo[k]);
    const fcM = { classe: Object.fromEntries(c.classes.map(cl => [cl.id, fcClasse(cl.id)])), tipo: { E: fcTipo('E'), S: fcTipo('S'), T: fcTipo('T') }, conta: {} };
    const ref = comp === 'budget' ? bud : fcM;
    const nomeRef = comp === 'budget' ? 'Budget' : 'Forecast';
    const mesAtual = new Date().getMonth() + 1;
    const idx = periodo === 0 ? [...Array(12).keys()] : periodo === 13 ? [...Array(mesAtual).keys()] : [periodo - 1];
    const sP = (v) => idx.reduce((s, i) => s + (v?.[i] || 0), 0);

    let linhas;
    if (vis === 'dre') {
      const dr = montarDRE(real).linhas, db = montarDRE(ref).linhas;
      linhas = dr.filter(l => l.tipo !== 'pct').map((l, i) => ({ k: l.tipo, nome: l.titulo, r: l.v, o: db[db.findIndex(x => x.titulo === l.titulo)]?.v || z(), receita: l.tipo === 'sec' && i === 0 }));
    } else {
      linhas = [];
      for (const [t, n] of [['E', 'ENTRADAS'], ['S', 'SAÍDAS']]) {
        linhas.push({ k: 'sec', nome: n, r: real.tipo[t], o: ref.tipo[t] });
        for (const cl of c.classes.filter(x => x.tipo === t)) {
          const r = real.classe[cl.id], o = ref.classe[cl.id];
          if ((!r || r.every(x => !x)) && (!o || o.every(x => !x))) continue;
          linhas.push({ k: 'linha', nome: cl.label, r: r || z(), o: o || z() });
        }
      }
      const rr = z().map((_, i) => real.tipo.E[i] + real.tipo.S[i]), oo = z().map((_, i) => ref.tipo.E[i] + ref.tipo.S[i]);
      linhas.push({ k: 'sec', nome: 'RESULTADO (E + S)', r: rr, o: oo });
    }
    tbl.innerHTML = `<table><thead><tr><th class="sticky">${periodo === 0 ? 'Ano ' + state.ano : periodo === 13 ? 'Acumulado até ' + MESES[mesAtual - 1] : MESES[periodo - 1]}</th>
      <th class="num">Realizado</th><th class="num">${nomeRef}</th><th class="num">Diferença R$</th><th class="num">Diferença %</th><th class="num">Atingimento</th></tr></thead><tbody>
      ${linhas.map(l => { const r = sP(l.r), o = sP(l.o), d = r - o;
        return `<tr class="${l.k === 'sec' ? 'row-sec' : ''}"><td class="sticky" ${l.k === 'linha' ? 'style="padding-left:22px"' : ''}>${esc(l.nome)}</td>
        <td class="num">${money(r)}</td><td class="num">${money(o)}</td><td class="num ${cls(d)}">${money(d)}</td>
        <td class="num ${cls(d)}">${o ? pct(d / Math.abs(o)) : '–'}</td><td class="num">${o ? pct(r / o) : '–'}</td></tr>`; }).join('')}</tbody></table>`;

    $('#t2', root).textContent = `Realizado x ${nomeRef} — diferença R$ por mês`;
    $('#tbl2', root).innerHTML = `<table><thead><tr><th class="sticky"></th>${mesesHeader('<th class="num">ANO</th>')}</tr></thead><tbody>
      ${linhas.map(l => { const d = l.r.map((x, i) => x - (l.o[i] || 0));
        return `<tr class="${l.k === 'sec' ? 'row-sec' : ''}"><td class="sticky">${esc(l.nome)}</td>${d.map(x => `<td class="num ${cls(x)}">${money(x)}</td>`).join('')}<td class="num ${cls(soma(d))}">${money(soma(d))}</td></tr>`; }).join('')}</tbody></table>`;

    const res = (m) => z().map((_, i) => m.tipo.E[i] + m.tipo.S[i]);
    chart($('#ch', root), {
      type: 'bar',
      data: { labels: MESES_CURTO, datasets: [
        { label: 'Entradas realizadas', data: real.tipo.E, backgroundColor: COR.entrada },
        { label: `Entradas ${nomeRef}`, data: ref.tipo.E, backgroundColor: COR.entrada + '33', borderColor: COR.entrada, borderWidth: 1 },
        { label: 'Saídas realizadas', data: real.tipo.S.map(Math.abs), backgroundColor: COR.saida },
        { label: `Saídas ${nomeRef}`, data: ref.tipo.S.map(Math.abs), backgroundColor: COR.saida + '33', borderColor: COR.saida, borderWidth: 1 },
        { type: 'line', label: 'Resultado realizado', data: res(real), borderColor: COR.resultado, backgroundColor: COR.resultado },
        { type: 'line', label: `Resultado ${nomeRef}`, data: res(ref), borderColor: COR.resultado, backgroundColor: COR.resultado, borderDash: [5, 4] },
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: moneyTick } } },
        plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw)}` } } } },
    });
  } catch (e) { fail(e); tbl.innerHTML = ''; }
}

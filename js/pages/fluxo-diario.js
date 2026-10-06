import { sb, state, q, filtrosHTML, bindFiltros, rpcFiltros, descricaoFiltros, soma } from '../lib/data.js';
import { $, esc, money, cls, exportXLSX, fail, loading, MESES, options, chart, moneyTick, CORES, COR } from '../lib/ui.js';

export const title = 'Fluxo de caixa diário';
let mes = new Date().getMonth() + 1;

export async function render(root) {
  const extra = `<label>Mês<select name="mes-fd">${options(MESES.map((n, i) => ({ id: i + 1, nome: n })), { selected: mes })}</select></label>
    <span class="spacer"></span><button class="btn" id="exp">Exportar Excel</button>`;
  root.innerHTML = filtrosHTML({ extra }) + `<div class="muted small" id="desc"></div>
    <div class="card"><h2>Saldo diário</h2><div class="chart-box"><canvas id="ch"></canvas></div></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>`;
  bindFiltros(root, () => load(root));
  $('[name=mes-fd]', root).onchange = (e) => { mes = +e.target.value; load(root); };
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), `fluxo_diario_${state.ano}_${String(mes).padStart(2, '0')}`);
  await load(root);
}

async function load(root) {
  const tbl = $('#tbl', root); loading(tbl);
  $('#desc', root).textContent = 'Filtros: ' + descricaoFiltros();
  try {
    const ini = `${state.ano}-${String(mes).padStart(2, '0')}-01`;
    const [rows, saldoIni] = await Promise.all([
      q(sb.rpc('resumo_diario', { p_empresa: state.empresa.id, p_ano: state.ano, p_mes: mes, ...rpcFiltros() })),
      q(sb.rpc('saldo_em', { p_empresa: state.empresa.id, p_data: ini, ...rpcFiltros() })),
    ]);
    const c = state.cad;
    const nd = new Date(state.ano, mes, 0).getDate();
    const zero = () => Array(nd).fill(0);
    const porClasse = {}, porTipo = { E: zero(), S: zero(), T: zero() };
    for (const r of rows) {
      const d = +r.dia.slice(8, 10) - 1; const cl = c.planoById[r.classe_id]; if (!cl) continue;
      (porClasse[cl.id] ||= zero())[d] += +r.total; porTipo[cl.tipo][d] += +r.total;
    }
    const res = zero().map((_, i) => porTipo.E[i] + porTipo.S[i] + porTipo.T[i]);
    const sIni = [], sFim = []; let s = +saldoIni;
    for (let i = 0; i < nd; i++) { sIni.push(s); s += res[i]; sFim.push(s); }
    const cell = (v) => `<td class="num ${cls(v)}">${v ? money(v) : ''}</td>`;
    const linha = (label, v, k = '', tot = true) => `<tr class="${k}"><td class="sticky">${label}</td>${v.map(cell).join('')}${tot ? cell(soma(v)) : '<td></td>'}</tr>`;
    let body = linha('Saldo inicial', sIni, 'row-total', false);
    for (const [t, nome] of [['E', 'ENTRADAS'], ['S', 'SAÍDAS'], ['T', 'TRANSFERÊNCIAS']]) {
      body += linha(nome, porTipo[t], 'row-sec');
      for (const cl of c.classes.filter(x => x.tipo === t)) if (porClasse[cl.id]) body += linha(esc(cl.label), porClasse[cl.id], 'row-l1');
    }
    body += linha('RESULTADO DO DIA', res, 'row-total');
    body += linha('Saldo final', sFim, 'row-total', false);
    const dias = Array.from({ length: nd }, (_, i) => i + 1);
    tbl.innerHTML = `<table><thead><tr><th class="sticky">${MESES[mes - 1]} ${state.ano}</th>${dias.map(d => `<th class="num">${d}</th>`).join('')}<th class="num">TOTAL</th></tr></thead><tbody>${body}</tbody></table>`;
    chart($('#ch', root), {
      type: 'bar',
      data: { labels: dias, datasets: [
        { type: 'line', label: 'Saldo final', data: sFim, borderColor: COR.saldo, backgroundColor: COR.saldo, tension: .25, pointRadius: 2, yAxisID: 'y' },
        { label: 'Entradas', data: porTipo.E, backgroundColor: COR.entrada, yAxisID: 'y' },
        { label: 'Saídas', data: porTipo.S, backgroundColor: COR.saida, yAxisID: 'y' },
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { ticks: { callback: moneyTick } } },
        plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw)}` } } } },
    });
  } catch (e) { fail(e); tbl.innerHTML = ''; }
}

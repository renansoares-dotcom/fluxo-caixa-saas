import { state, filtrosHTML, bindFiltros, matrizMensal, montarDRE, descricaoFiltros, soma, mesesHeader } from '../lib/data.js';
import { $, esc, money, pct, cls, exportXLSX, fail, loading, chart, CORES, MESES_CURTO, moneyTick } from '../lib/ui.js';

export const title = 'DRE gerencial';
let modo = 'mensal';

export async function render(root) {
  const extra = `<label>Exibição<select name="modo-dre"><option value="mensal">Mensal</option><option value="acum" ${modo === 'acum' ? 'selected' : ''}>Acumulado no ano</option></select></label>
    <span class="spacer"></span><button class="btn" id="exp">Exportar Excel</button>`;
  root.innerHTML = filtrosHTML({ extra }) + `<div class="muted small" id="desc"></div>
    <div class="card"><h2>Receita x Resultado gerencial</h2><div class="chart-box"><canvas id="ch"></canvas></div></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>`;
  bindFiltros(root, () => load(root));
  $('[name=modo-dre]', root).onchange = (e) => { modo = e.target.value; load(root); };
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), `dre_${state.ano}`);
  await load(root);
}

async function load(root) {
  const tbl = $('#tbl', root); loading(tbl);
  $('#desc', root).textContent = 'Regime de caixa. Filtros: ' + descricaoFiltros();
  try {
    const m = await matrizMensal(state.ano);
    const { linhas, val } = montarDRE(m);
    const acum = (v) => { let s = 0; return v.map(x => s += (x || 0)); };
    const rec = val.receita_bruta;
    const body = linhas.map(l => {
      let v = l.v;
      if (modo === 'acum' && l.tipo !== 'pct') v = acum(v);
      if (l.tipo === 'pct') {
        const key = l.titulo.startsWith('Margem bruta') ? 'lucro_bruto' : l.titulo.startsWith('Margem EBITDA') ? 'ebitda' : 'resultado';
        const num = modo === 'acum' ? acum(val[key]) : val[key];
        const den = modo === 'acum' ? acum(rec) : rec;
        const tot = soma(den) ? soma(val[key]) / soma(rec) : null;
        return `<tr class="row-pct"><td class="sticky">${esc(l.titulo)}</td>${num.map((x, i) => `<td class="num">${den[i] ? pct(x / den[i]) : '–'}</td>`).join('')}<td class="num">${pct(tot)}</td><td></td></tr>`;
      }
      const tot = soma(l.v);
      const av = soma(rec) ? tot / soma(rec) : null;
      return `<tr class="${l.tipo === 'sec' ? 'row-sec' : ''}"><td class="sticky" ${l.tipo === 'linha' ? 'style="padding-left:22px"' : ''}>${esc(l.titulo)}</td>
        ${v.map(x => `<td class="num ${l.tipo === 'sec' ? cls(x) : ''}">${money(x)}</td>`).join('')}
        <td class="num ${l.tipo === 'sec' ? cls(tot) : ''}"><strong>${money(tot)}</strong></td><td class="num muted">${pct(av)}</td></tr>`;
    }).join('');
    tbl.innerHTML = `<table><thead><tr><th class="sticky">${state.filtros.visao === 'Pago' ? 'Realizado' : 'Projetado'}</th>${mesesHeader('<th class="num">ANO</th><th class="num">AV%</th>')}</tr></thead><tbody>${body}</tbody></table>`;
    chart($('#ch', root), {
      type: 'bar',
      data: { labels: MESES_CURTO, datasets: [
        { label: 'Receita bruta', data: val.receita_bruta, backgroundColor: CORES[0] + 'cc' },
        { label: 'EBITDA gerencial', data: val.ebitda, backgroundColor: CORES[1] + 'cc' },
        { label: 'Resultado gerencial', data: val.resultado, backgroundColor: CORES[4] },
      ] },
      options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: moneyTick } } },
        plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw)}` } } } },
    });
  } catch (e) { fail(e); tbl.innerHTML = ''; }
}

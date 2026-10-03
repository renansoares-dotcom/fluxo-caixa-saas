import { sb, state, q, filtrosHTML, bindFiltros, rpcFiltros, matrizMensal, descricaoFiltros, soma, z, mesesHeader } from '../lib/data.js';
import { $, $$, esc, money, cls, exportXLSX, fail, loading, MESES } from '../lib/ui.js';

export const title = 'Fluxo de caixa mensal';
const abertos = new Set();

export async function render(root) {
  root.innerHTML = filtrosHTML({ extra: '<span class="spacer"></span><button class="btn" id="exp">Exportar Excel</button><button class="btn" id="exp-det">Expandir tudo</button>' })
    + `<div class="muted small" id="desc"></div><div class="card flush"><div class="table-wrap" id="tbl"></div></div>`;
  bindFiltros(root, () => load(root));
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), `fluxo_mensal_${state.ano}`);
  $('#exp-det', root).onclick = () => {
    const all = state.cad.classes.every(c => abertos.has(c.id));
    state.cad.classes.forEach(c => all ? abertos.delete(c.id) : abertos.add(c.id)); load(root);
  };
  await load(root);
}

async function load(root) {
  const tbl = $('#tbl', root); loading(tbl);
  $('#desc', root).textContent = 'Filtros: ' + descricaoFiltros();
  try {
    const [m, saldoIni] = await Promise.all([
      matrizMensal(state.ano),
      q(sb.rpc('saldo_em', { p_empresa: state.empresa.id, p_data: `${state.ano}-01-01`, ...rpcFiltros() })),
    ]);
    const c = state.cad;
    const resultado = z().map((_, i) => m.tipo.E[i] + m.tipo.S[i] + m.tipo.T[i]);
    const ini = [], fim = [];
    let s = +saldoIni;
    for (let i = 0; i < 12; i++) { ini.push(s); s += resultado[i]; fim.push(s); }
    const totE = soma(m.tipo.E);
    const cell = (v) => `<td class="num ${cls(v)}">${money(v)}</td>`;
    const linha = (label, v, klass = '', attrs = '', part = true, total = true) =>
      `<tr class="${klass}" ${attrs}><td class="sticky">${label}</td>${v.map(cell).join('')}${total ? cell(soma(v)) : '<td></td>'}<td class="num muted">${part && totE ? ((Math.abs(soma(v)) / totE) * 100).toFixed(1).replace('.', ',') + '%' : ''}</td></tr>`;
    let body = linha('Saldo inicial', ini, 'row-total', '', false, false);
    for (const [t, nome] of [['E', 'ENTRADAS'], ['S', 'SAÍDAS'], ['T', 'TRANSFERÊNCIAS']]) {
      body += linha(nome, m.tipo[t], 'row-sec');
      for (const cl of c.classes.filter(x => x.tipo === t)) {
        const v = m.classe[cl.id]; if (!v || v.every(x => !x)) continue;
        const open = abertos.has(cl.id);
        body += linha(`<span class="muted">${open ? '▾' : '▸'}</span> ${esc(cl.label)}`, v, 'row-l1 clickable', `data-cl="${cl.id}"`);
        if (open) for (const p of c.contasPlano.filter(x => x.pai_id === cl.id)) {
          const vv = m.conta[p.id]; if (!vv || vv.every(x => !x)) continue;
          body += linha(`<span style="padding-left:18px">${esc(p.label)}</span>`, vv);
        }
      }
    }
    body += linha('RESULTADO DO MÊS', resultado, 'row-total', '', false);
    body += linha('Saldo final', fim, 'row-total', '', false, false);
    tbl.innerHTML = `<table><thead><tr><th class="sticky">${state.filtros.visao === 'Pago' ? 'REALIZADO (PAGO)' : 'PROJETADO (PAGO + EM ABERTO)'}</th>${mesesHeader('<th class="num">TOTAL</th><th class="num">Part.</th>')}</tr></thead><tbody>${body}</tbody></table>`;
    $$('tr[data-cl]', tbl).forEach(tr => tr.onclick = () => { const id = tr.dataset.cl; abertos.has(id) ? abertos.delete(id) : abertos.add(id); load(root); });
  } catch (e) { fail(e); tbl.innerHTML = ''; }
}

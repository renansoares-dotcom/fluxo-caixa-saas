// Contabilidade › Balanço Patrimonial (a partir do balancete da contabilidade ou da plataforma)
import { state } from '../lib/data.js';
import { $, esc, money, dateBR, fail, loading, exportXLSX } from '../lib/ui.js';
import { fontes, opcoes, periodo, itens, arvore } from '../lib/contab.js';

export const title = 'Balanço Patrimonial';
const ui = { sel: null, nivel: 4 };

export async function render(root) {
  root.innerHTML = `
    <div class="toolbar">
      <label>Fonte<select id="sel"></select></label>
      <label>Detalhe<select id="niv"><option value="2">Grupos</option><option value="3">Subgrupos</option><option value="4">Contas</option><option value="5">Analítico</option></select></label>
      <span class="spacer"></span><button class="btn" id="exp">Exportar Excel</button>
    </div>
    <div id="info" class="muted small" style="margin-bottom:8px"></div>
    <div class="kpis" id="kp" style="margin-bottom:12px"></div>
    <div class="grid2 bp-grid"><div class="card flush"><div class="table-wrap" id="at"></div></div><div class="card flush"><div class="table-wrap" id="pa"></div></div></div>`;
  $('#niv', root).value = String(ui.nivel);
  $('#niv', root).onchange = (e) => { ui.nivel = +e.target.value; carregar(root); };
  $('#sel', root).onchange = (e) => { ui.sel = e.target.value; carregar(root); };
  $('#exp', root).onclick = () => {
    const t = (id) => [...$(id, root).querySelectorAll('tr')].map(tr => [...tr.cells].map(c => c.textContent.trim()));
    exportXLSX([...t('#at'), [], ...t('#pa')], 'balanco_patrimonial');
  };
  try {
    const f = await fontes(true); const op = opcoes(f);
    if (!op.length) { $('#at', root).innerHTML = '<div class="empty">Importe o balancete da contabilidade em Contabilidade › Balancete.</div>'; return; }
    if (!op.some(o => o[0] === ui.sel)) ui.sel = op[0][0];
    $('#sel', root).innerHTML = op.map(([v, t]) => `<option value="${v}" ${v === ui.sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
    await carregar(root);
  } catch (e) { fail(e); }
}

async function carregar(root) {
  loading($('#at', root)); $('#pa', root).innerHTML = '';
  try {
    const f = await fontes(); const p = periodo(ui.sel, f, true);
    const A = arvore(f.contas, await itens(ui.sel, f, true), p.fonte === 'plataforma');
    const z = (x) => (Math.abs(x) < 0.005 ? 0 : x);
    const res = z(-(A.g('3').atu + A.g('4').atu + A.g('5').atu)), resAnt = z(-(A.g('3').ant + A.g('4').ant + A.g('5').ant));
    $('#info', root).innerHTML = `Posição em ${dateBR(p.fim)} comparada com ${dateBR(addDia(p.ini, -1))} · fonte: ${p.fonte === 'plataforma' ? 'balancete feito pela plataforma' : 'balancete da contabilidade'}`;
    const at = A.g('1'), pa = A.g('2');
    const passivoTot = -pa.atu + res, passivoAnt = -pa.ant + resAnt;
    const dif = Math.round((at.atu - passivoTot) * 100) / 100;
    $('#kp', root).innerHTML = [['Ativo', at.atu], ['Passivo exigível', -(A.g('2.1').atu + A.g('2.2').atu)], ['Patrimônio líquido', -A.g('2.3').atu + res], ['Resultado do período', res]]
      .map(([t, v]) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value ${t.startsWith('Resultado') ? (v >= 0 ? 'pos' : 'neg') : ''}">${money(v)}</div></div>`).join('')
      + `<div class="kpi"><div class="k-label">Ativo − (Passivo + PL)</div><div class="k-value ${Math.abs(dif) < 0.01 ? 'pos' : 'neg'}">${Math.abs(dif) < 0.01 ? '✔ fecha' : money(dif)}</div></div>`;
    // o resultado do período entra no PL (e no total do passivo), como no balanço da contabilidade
    const ajuste = { '2': [passivoAnt, passivoTot], '2.3': [-A.g('2.3').ant + resAnt, -A.g('2.3').atu + res] };
    const lado = (raiz, sinal, extra) => {
      const rows = [];
      const desce = (c) => {
        if (c.nivel > ui.nivel || !c.tem || (Math.abs(c.atu) < 0.005 && Math.abs(c.ant) < 0.005)) return;
        const [va, vf] = ajuste[c.classificacao] && sinal < 0 ? ajuste[c.classificacao] : [sinal * c.ant, sinal * c.atu];
        rows.push(`<tr class="${c.tipo === 'S' && c.nivel <= 3 ? 'row-sec' : ''}"><td style="padding-left:${8 + (c.nivel - 1) * 14}px">${esc(c.descricao)}</td><td class="num">${money(va)}</td><td class="num">${money(vf)}</td></tr>`);
        if (c.classificacao === '2.3' && extra) rows.push(extra);
        c.filhos.forEach(desce);
      };
      desce(raiz);
      return rows.join('');
    };
    const head = (t) => `<table class="bp-tbl"><thead><tr><th>${t}</th><th class="num">${dateBR(addDia(p.ini, -1))}</th><th class="num">${dateBR(p.fim)}</th></tr></thead><tbody>`;
    $('#at', root).innerHTML = head('Ativo') + lado(at, 1) + '</tbody></table>';
    const linhaRes = `<tr><td style="padding-left:36px"><em>Resultado do período</em></td><td class="num">${money(resAnt)}</td><td class="num ${res >= 0 ? 'pos' : 'neg'}">${money(res)}</td></tr>`;
    $('#pa', root).innerHTML = head('Passivo e patrimônio líquido') + lado(pa, -1, linhaRes) + '</tbody></table>';
  } catch (e) { fail(e); $('#at', root).innerHTML = ''; }
}
const addDia = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

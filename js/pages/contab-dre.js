// Contabilidade › DRE (competência), no mesmo formato da DRE da contabilidade.
// Fonte: balancete da contabilidade ou da plataforma. Cada linha abre as contas que a compõem.
import { $, esc, money, pct, dateBR, fail, loading, exportXLSX } from '../lib/ui.js';
import { fontes, opcoes, periodo, itens, arvore } from '../lib/contab.js';

export const title = 'DRE Contábil';
const ui = { sel: null, acum: true, abertas: new Set() };

// linhas: grupos de contas somados (movimento do período); sinal + = receita, − = custo/despesa
const LINHAS = [
  { k: 'rb', t: 'Receita bruta', g: ['4.1.1'] },
  { k: 'ded', t: '(−) Deduções da receita', g: ['4.1.2'] },
  { k: 'rl', t: 'Receita líquida', soma: ['rb', 'ded'], tot: 1 },
  { k: 'cmv', t: '(−) Custo dos produtos vendidos', g: ['5', '3.1'] },
  { k: 'lb', t: 'Lucro bruto', soma: ['rl', 'cmv'], tot: 1 },
  { k: 'dv', t: '(−) Despesas com vendas', g: ['3.2.1'] },
  { k: 'da', t: '(−) Despesas administrativas', g: ['3.2.2'], menos: ['3.2.20.5', '3.2.20.7'] },
  { k: 'rf', t: 'Receitas financeiras', g: ['4.1.3'] },
  { k: 'df', t: '(−) Despesas financeiras', g: ['3.2.20.5'] },
  { k: 'or', t: 'Outras receitas operacionais', g: ['4.1.4', '4.1.5'] },
  { k: 'ro', t: 'Resultado operacional', soma: ['lb', 'dv', 'da', 'rf', 'df', 'or'], tot: 1 },
  { k: 'dn', t: '(−) Despesas não operacionais (indedutíveis)', g: ['3.2.20.7'] },
  { k: 'rn', t: 'Receitas não operacionais', g: ['4.2'] },
  { k: 'lair', t: 'Resultado antes do IR e CSLL', soma: ['ro', 'dn', 'rn'], tot: 1 },
];

export async function render(root) {
  root.innerHTML = `
    <div class="toolbar">
      <label>Fonte<select id="sel"></select></label>
      <label class="chk" id="lacum"><input type="checkbox" id="acum" ${ui.acum ? 'checked' : ''}> Acumulado no ano</label>
      <span class="spacer"></span><button class="btn" id="exp">Exportar Excel</button>
    </div>
    <div id="info" class="muted small" style="margin-bottom:8px"></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>`;
  $('#sel', root).onchange = (e) => { ui.sel = e.target.value; carregar(root); };
  $('#acum', root).onchange = (e) => { ui.acum = e.target.checked; carregar(root); };
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), 'dre_contabil');
  try {
    const f = await fontes(true); const op = opcoes(f);
    if (!op.length) { $('#tbl', root).innerHTML = '<div class="empty">Importe o balancete da contabilidade em Contabilidade › Balancete.</div>'; return; }
    if (!op.some(o => o[0] === ui.sel)) ui.sel = op[0][0];
    $('#sel', root).innerHTML = op.map(([v, t]) => `<option value="${v}" ${v === ui.sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
    await carregar(root);
  } catch (e) { fail(e); }
}

async function carregar(root) {
  const tbl = $('#tbl', root); loading(tbl);
  $('#lacum', root).hidden = !ui.sel.startsWith('g:');
  try {
    const f = await fontes(); const p = periodo(ui.sel, f, ui.acum);
    const A = arvore(f.contas, await itens(ui.sel, f, ui.acum), p.fonte === 'plataforma');
    $('#info', root).innerHTML = `Regime de competência · ${dateBR(p.ini)} a ${dateBR(p.fim)} · fonte: ${p.fonte === 'plataforma' ? 'balancete feito pela plataforma' : 'balancete da contabilidade'}`;
    const v = {}, det = {};
    const usadas = new Set();
    for (const l of LINHAS) {
      if (l.soma) { v[l.k] = l.soma.reduce((s, k) => s + v[k], 0); continue; }
      let s = 0; const contas = [];
      for (const g of l.g) {
        const c = A.g(g); s += -(c.deb - c.cred);
        // analíticas com movimento dentro do grupo (fora as excluídas)
        const pega = (x) => { if ((l.menos || []).includes(x.classificacao)) return false; if (!x.filhos.length) { if (Math.abs(x.deb - x.cred) > 0.004) contas.push(x); return true; } x.filhos.forEach(pega); return true; };
        pega(c); usadas.add(g);
      }
      for (const m of l.menos || []) { const c = A.g(m); s -= -(c.deb - c.cred); }
      v[l.k] = s; det[l.k] = contas.sort((a, b) => Math.abs(b.deb - b.cred) - Math.abs(a.deb - a.cred));
    }
    // prova: o resultado das linhas tem de ser o resultado do balancete (receitas − custos − despesas)
    const resBal = -(A.mov('3') + A.mov('4') + A.mov('5'));
    const outros = Math.round((resBal - v.lair) * 100) / 100;
    const rb = v.rb || 0;
    const linha = (l) => {
      const x = v[l.k], aberta = ui.abertas.has(l.k), tem = det[l.k]?.length;
      return `<tr class="${l.tot ? 'row-sec' : ''} ${tem ? 'dre-l' : ''}" data-k="${l.k}"><td>${tem ? `<span class="bal-tg">${aberta ? '▾' : '▸'}</span>` : '<span class="bal-tg"></span>'}${esc(l.t)}</td>
        <td class="num ${l.tot ? (x >= 0 ? 'pos' : 'neg') : ''}">${money(x)}</td><td class="num muted">${rb ? pct(x / rb) : '–'}</td></tr>`
        + (aberta ? det[l.k].map(c => `<tr class="small"><td style="padding-left:40px">${esc(c.classificacao)} · ${esc(c.descricao)}</td><td class="num">${money(-(c.deb - c.cred))}</td><td></td></tr>`).join('') : '');
    };
    tbl.innerHTML = `<table><thead><tr><th>Descrição</th><th class="num">Valor</th><th class="num">% receita bruta</th></tr></thead><tbody>
      ${LINHAS.map(linha).join('')}
      ${Math.abs(outros) >= 0.01 ? `<tr><td><span class="bal-tg"></span>Outras contas de resultado</td><td class="num">${money(outros)}</td><td></td></tr>` : ''}
      <tr class="row-sec"><td><span class="bal-tg"></span><strong>Lucro (prejuízo) líquido do período</strong></td><td class="num ${resBal >= 0 ? 'pos' : 'neg'}"><strong>${money(resBal)}</strong></td><td class="num muted">${rb ? pct(resBal / rb) : '–'}</td></tr>
    </tbody></table>`;
    tbl.querySelector('tbody').onclick = (e) => { const k = e.target.closest('tr.dre-l')?.dataset.k; if (!k) return; ui.abertas.has(k) ? ui.abertas.delete(k) : ui.abertas.add(k); carregar(root); };
  } catch (e) { fail(e); tbl.innerHTML = ''; }
}

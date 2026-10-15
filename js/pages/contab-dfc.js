// Contabilidade › DFC pelo método direto, a partir dos lançamentos contábeis gerados pela plataforma.
// Cada lançamento que mexe numa conta do Disponível (1.1.1) é classificado pela conta da contrapartida.
// Transferências entre contas do Disponível se anulam e não aparecem.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, esc, money, dateBR, fail, loading, exportXLSX } from '../lib/ui.js';
import { fontes, periodo, arvore, dentro, MESN } from '../lib/contab.js';

export const title = 'DFC — Fluxo de Caixa (método direto)';
const ui = { sel: null, acum: false, abertas: new Set() };

// contrapartida → linha da DFC (a regra mais específica vence: é testada a cadeia de contas-mãe)
const REGRAS = [
  ['1.1.20.2', 'fin', 'Antecipação de recebíveis (FIDC / factoring)'],
  ['1.1.2', 'op', 'Recebimentos de clientes'], ['2.1.60.1', 'op', 'Recebimentos de clientes'], ['4.1.1', 'op', 'Recebimentos de clientes'],
  ['4.2', 'inv', 'Venda de ativos e sinistros'],
  ['4', 'op', 'Outras receitas operacionais recebidas'],
  ['2.1.3', 'op', 'Pagamentos a fornecedores'], ['1.1.30.5', 'op', 'Pagamentos a fornecedores'], ['1.1.5', 'op', 'Pagamentos a fornecedores'], ['3.1.3', 'op', 'Pagamentos a fornecedores'],
  ['2.1.5', 'op', 'Pagamentos de salários e encargos'], ['3.1.1', 'op', 'Pagamentos de salários e encargos'], ['3.2.20.1', 'op', 'Pagamentos de salários e encargos'], ['1.1.30.6', 'op', 'Pagamentos de salários e encargos'],
  ['2.1.4', 'op', 'Pagamentos de tributos'], ['3.2.20.3', 'op', 'Pagamentos de tributos'], ['3.2.10.9', 'op', 'Pagamentos de tributos'], ['2.2.10.301', 'op', 'Pagamentos de tributos'],
  ['3.2.20.5', 'op', 'Pagamentos de despesas financeiras'],
  ['1.1.60.100.0009', 'op', 'Bloqueios judiciais'],
  ['3', 'op', 'Pagamentos de outras despesas operacionais'],
  ['1.2.3', 'inv', 'Aquisição de imobilizado e obras em andamento'], ['1.1.30.7', 'inv', 'Aquisição de imobilizado e obras em andamento'],
  ['2.1.1', 'fin', 'Empréstimos e financiamentos'], ['2.2.1', 'fin', 'Empréstimos e financiamentos'],
  ['1.2.10.202', 'fin', 'Sócios (retiradas e devoluções)'], ['2.3', 'fin', 'Sócios (retiradas e devoluções)'],
  ['2.1.6', 'fin', 'Acordos e outras obrigações'],
  ['1', 'op', 'Outros ativos operacionais'], ['2', 'op', 'Outros passivos operacionais'],
];
const SEC = [['op', 'Atividades operacionais'], ['inv', 'Atividades de investimento'], ['fin', 'Atividades de financiamento']];

export async function render(root) {
  root.innerHTML = `
    <div class="toolbar">
      <label>Mês<select id="sel"></select></label>
      <label class="chk"><input type="checkbox" id="acum" ${ui.acum ? 'checked' : ''}> Acumulado no ano</label>
      <span class="spacer"></span><button class="btn" id="exp">Exportar Excel</button>
    </div>
    <div id="info" class="muted small" style="margin-bottom:8px"></div>
    <div class="kpis" id="kp" style="margin-bottom:12px"></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>`;
  $('#sel', root).onchange = (e) => { ui.sel = e.target.value; carregar(root); };
  $('#acum', root).onchange = (e) => { ui.acum = e.target.checked; carregar(root); };
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), 'dfc_metodo_direto');
  try {
    const f = await fontes(true);
    if (!f.meses.length) { $('#tbl', root).innerHTML = '<div class="empty">Importe o balancete com o saldo de abertura e gere os lançamentos contábeis em Contabilidade › Balancete.</div>'; return; }
    if (!f.meses.some(m => `g:${m}` === ui.sel)) ui.sel = `g:${f.meses[f.meses.length - 1]}`;
    $('#sel', root).innerHTML = f.meses.map(m => `<option value="g:${m}" ${`g:${m}` === ui.sel ? 'selected' : ''}>${MESN[+m.slice(5) - 1]}/${m.slice(0, 4)}</option>`).join('');
    await carregar(root);
  } catch (e) { fail(e); }
}

async function carregar(root) {
  const tbl = $('#tbl', root); loading(tbl);
  try {
    const f = await fontes(); const p = periodo(ui.sel, f, ui.acum);
    const byId = new Map(f.contas.map(c => [c.id, c]));
    const disp = (id) => { const c = byId.get(id); return c && dentro(byId, c, '1.1.1'); };
    const [parts, bal] = await Promise.all([
      fetchAll(() => sb.from('contab_partidas').select('lancamento_id, conta_id, debito, credito, contab_lancamentos!inner(data, empresa_id, historico)')
        .eq('contab_lancamentos.empresa_id', state.empresa.id).gte('contab_lancamentos.data', p.ini).lte('contab_lancamentos.data', p.fim)),
      q(sb.rpc('contab_balancete_gerencial', { p_empresa: state.empresa.id, p_ini: p.ini, p_fim: p.fim })),
    ]);
    // saldos do Disponível no início e no fim
    const A = arvore(f.contas, bal, true); const d = A.g('1.1.1');
    // agrupa por lançamento: o lado do caixa e a contrapartida
    const porL = new Map();
    for (const x of parts) (porL.get(x.lancamento_id) || porL.set(x.lancamento_id, []).get(x.lancamento_id)).push(x);
    const linhas = new Map(); let semRegra = 0;
    for (const ps of porL.values()) {
      const caixa = ps.filter(x => disp(x.conta_id)), contra = ps.filter(x => !disp(x.conta_id));
      if (!caixa.length || !contra.length) continue;            // transferência entre contas do Disponível ou lançamento sem caixa
      const valor = caixa.reduce((s, x) => s + (+x.debito) - (+x.credito), 0);
      const c = byId.get(contra[0].conta_id);
      const r = REGRAS.find(([g]) => dentro(byId, c, g));
      if (!r) semRegra++;
      const [sec, nome] = r ? [r[1], r[2]] : ['op', 'Outros'];
      const key = `${sec}|${nome}|${valor >= 0 ? 'e' : 's'}`;
      const l = linhas.get(key) || linhas.set(key, { sec, nome, ent: valor >= 0, v: 0, contas: new Map() }).get(key);
      l.v += valor; const k2 = c.classificacao + ' · ' + c.descricao; l.contas.set(k2, (l.contas.get(k2) || 0) + valor);
    }
    const variacao = [...linhas.values()].reduce((s, l) => s + l.v, 0);
    const prova = Math.round((d.ant + variacao - d.atu) * 100) / 100;
    $('#info', root).innerHTML = `Método direto · ${dateBR(p.ini)} a ${dateBR(p.fim)} · feita a partir dos lançamentos contábeis gerados pela plataforma (gere o mês em Contabilidade › Balancete antes).`;
    $('#kp', root).innerHTML = [['Disponível no início', d.ant], ['Variação do período', variacao], ['Disponível no fim', d.atu]]
      .map(([t, v]) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value">${money(v)}</div></div>`).join('')
      + `<div class="kpi"><div class="k-label">Início + variação = fim</div><div class="k-value ${Math.abs(prova) < 0.01 ? 'pos' : 'neg'}">${Math.abs(prova) < 0.01 ? '✔ fecha' : money(prova)}</div></div>`;
    let html = '';
    for (const [sec, tit] of SEC) {
      const ls = [...linhas.values()].filter(l => l.sec === sec).sort((a, b) => (b.ent - a.ent) || Math.abs(b.v) - Math.abs(a.v));
      const tot = ls.reduce((s, l) => s + l.v, 0);
      html += `<tr class="row-sec"><td colspan="2">${tit}</td></tr>`;
      for (const l of ls) {
        const id = `${l.sec}|${l.nome}|${l.ent}`, ab = ui.abertas.has(id);
        html += `<tr class="dre-l" data-k="${esc(id)}"><td style="padding-left:20px"><span class="bal-tg">${ab ? '▾' : '▸'}</span>${esc(l.nome)}${ls.some(o => o !== l && o.nome === l.nome) ? (l.ent ? ' (entradas)' : ' (saídas)') : ''}</td><td class="num">${money(l.v)}</td></tr>`;
        if (ab) html += [...l.contas].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([n, v]) => `<tr class="small"><td style="padding-left:52px">${esc(n)}</td><td class="num">${money(v)}</td></tr>`).join('');
      }
      html += `<tr><td style="padding-left:20px"><strong>Caixa líquido — ${tit.toLowerCase()}</strong></td><td class="num ${tot >= 0 ? 'pos' : 'neg'}"><strong>${money(tot)}</strong></td></tr>`;
    }
    html += `<tr class="row-sec"><td>Aumento (redução) das disponibilidades</td><td class="num">${money(variacao)}</td></tr>
      <tr><td>Disponibilidades no início do período</td><td class="num">${money(d.ant)}</td></tr>
      <tr><td>Disponibilidades no fim do período</td><td class="num">${money(d.atu)}</td></tr>`;
    tbl.innerHTML = (parts.length ? '' : '<div class="empty">Nenhum lançamento contábil no período: gere os lançamentos do mês em Contabilidade › Balancete.</div>')
      + `<table><thead><tr><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>${html}</tbody></table>`;
    tbl.querySelector('tbody').onclick = (e) => { const k = e.target.closest('tr.dre-l')?.dataset.k; if (!k) return; ui.abertas.has(k) ? ui.abertas.delete(k) : ui.abertas.add(k); carregar(root); };
  } catch (e) { fail(e); tbl.innerHTML = ''; }
}

import { sb, state, q, matrizMensal, montarDRE, soma, z } from '../lib/data.js';
import { $, esc, money, money0, pct, cls, dateBR, today, fail, chart, CORES, MESES_CURTO, moneyTick } from '../lib/ui.js';

export const title = 'Dashboard';

export async function render(root) {
  root.innerHTML = `<div class="kpis" id="kpis"><div class="kpi"><div class="k-label">Carregando…</div></div></div>
    <div class="grid2">
      <div class="card"><h2>Entradas x Saídas (realizado) e saldo</h2><div class="chart-box"><canvas id="c1"></canvas></div></div>
      <div class="card"><h2>Composição das saídas no ano</h2><div class="chart-box"><canvas id="c2"></canvas></div></div>
    </div>
    <div class="grid2">
      <div class="card flush"><div style="padding:16px 16px 0"><h2>Saldos por conta</h2></div><div class="table-wrap" id="saldos"></div></div>
      <div class="card flush"><div style="padding:16px 16px 0" class="card-head"><h2 style="margin:0">Próximos vencimentos</h2><a href="#/abertos">ver todos</a></div><div class="table-wrap" id="venc"></div></div>
    </div>`;
  try {
    const e = state.empresa.id;
    const [m, saldoIni, saldos, abertos] = await Promise.all([
      matrizMensal(state.ano, 'Pago'),
      q(sb.rpc('saldo_em', { p_empresa: e, p_data: `${state.ano}-01-01` })),
      q(sb.rpc('saldos_contas', { p_empresa: e })),
      q(sb.from('v_lancamentos').select('id,data,descricao,favorecido_nome,plano_nome,valor_sinal,tipo,conta_nome')
        .eq('empresa_id', e).eq('status', 'Em aberto').order('data').limit(1000)),
    ]);
    const { val } = montarDRE(m);
    const res = z().map((_, i) => m.tipo.E[i] + m.tipo.S[i] + m.tipo.T[i]);
    let s = +saldoIni; const saldoFim = res.map(v => s += v);
    const saldoBancos = saldos.filter(x => x.disponibilidade === 'Conta com recursos disponíveis').reduce((a, x) => a + +x.saldo_pago, 0);
    const hoje = today();
    const pagar = abertos.filter(a => a.tipo === 'S'), receber = abertos.filter(a => a.tipo === 'E');
    const venc = pagar.filter(a => a.data < hoje);
    const sum = (arr) => arr.reduce((a, x) => a + Math.abs(+x.valor_sinal), 0);
    const recAno = soma(val.receita_bruta);
    $('#kpis', root).innerHTML = `
      <div class="kpi"><div class="k-label">Saldo em bancos (disponível)</div><div class="k-value ${cls(saldoBancos)}">${money(saldoBancos)}</div><div class="k-sub">hoje, realizado</div></div>
      <div class="kpi"><div class="k-label">Entradas ${state.ano}</div><div class="k-value">${money0(soma(m.tipo.E))}</div><div class="k-sub">Receita bruta ${money0(recAno)}</div></div>
      <div class="kpi"><div class="k-label">Saídas ${state.ano}</div><div class="k-value">${money0(Math.abs(soma(m.tipo.S)))}</div></div>
      <div class="kpi"><div class="k-label">EBITDA gerencial</div><div class="k-value ${cls(soma(val.ebitda))}">${money0(soma(val.ebitda))}</div><div class="k-sub">margem ${pct(recAno ? soma(val.ebitda) / recAno : null)}</div></div>
      <div class="kpi"><div class="k-label">Resultado gerencial</div><div class="k-value ${cls(soma(val.resultado))}">${money0(soma(val.resultado))}</div><div class="k-sub">margem ${pct(recAno ? soma(val.resultado) / recAno : null)}</div></div>
      <div class="kpi"><div class="k-label">A pagar em aberto</div><div class="k-value neg">${money0(sum(pagar))}</div><div class="k-sub">${venc.length} vencido(s): ${money0(sum(venc))}</div></div>
      <div class="kpi"><div class="k-label">A receber em aberto</div><div class="k-value pos">${money0(sum(receber))}</div></div>`;

    chart($('#c1', root), {
      type: 'bar',
      data: { labels: MESES_CURTO, datasets: [
        { label: 'Entradas', data: m.tipo.E, backgroundColor: CORES[1] + 'cc', order: 2 },
        { label: 'Saídas', data: m.tipo.S.map(Math.abs), backgroundColor: CORES[2] + 'cc', order: 2 },
        { type: 'line', label: 'Saldo final', data: saldoFim, borderColor: CORES[0], backgroundColor: CORES[0], yAxisID: 'y2', tension: .25, order: 1 },
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { ticks: { callback: moneyTick } }, y2: { position: 'right', grid: { display: false }, ticks: { callback: moneyTick } } },
        plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw)}` } } } },
    });
    const comp = state.cad.classes.filter(c => c.tipo === 'S').map(c => ({ l: c.label, v: Math.abs(soma(m.classe[c.id] || z())) }))
      .filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const top = comp.slice(0, 7); const resto = soma(comp.slice(7).map(x => x.v));
    if (resto) top.push({ l: 'Demais', v: resto });
    chart($('#c2', root), {
      type: 'doughnut',
      data: { labels: top.map(x => x.l), datasets: [{ data: top.map(x => x.v), backgroundColor: CORES, borderWidth: 0 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' },
        tooltip: { callbacks: { label: (x) => `${x.label}: ${money(x.raw)} (${pct(x.raw / soma(top.map(t => t.v)))})` } } } },
    });
    $('#saldos', root).innerHTML = `<table><thead><tr><th>Conta</th><th>Grupo</th><th class="num">Saldo</th><th class="num">A receber</th><th class="num">A pagar</th></tr></thead><tbody>
      ${saldos.map(x => `<tr><td>${esc(x.nome)}${x.disponibilidade !== 'Conta com recursos disponíveis' ? ' <span class="badge vencido">bloqueada</span>' : ''}</td><td>${esc(x.grupo || '')}</td>
        <td class="num ${cls(x.saldo_pago)}">${money(x.saldo_pago)}</td><td class="num">${money(x.a_receber)}</td><td class="num">${money(x.a_pagar)}</td></tr>`).join('')}
      <tr class="row-total"><td>Total</td><td></td><td class="num">${money(soma(saldos.map(x => +x.saldo_pago)))}</td><td class="num">${money(soma(saldos.map(x => +x.a_receber)))}</td><td class="num">${money(soma(saldos.map(x => +x.a_pagar)))}</td></tr></tbody></table>`;
    $('#venc', root).innerHTML = abertos.length ? `<table><thead><tr><th>Vencimento</th><th>Favorecido / descrição</th><th class="num">Valor</th></tr></thead><tbody>
      ${abertos.slice(0, 12).map(a => `<tr><td>${dateBR(a.data)} ${a.data < hoje ? '<span class="badge vencido">vencido</span>' : ''}</td>
        <td class="wrap">${esc(a.favorecido_nome || a.plano_nome)}<div class="muted small">${esc(a.descricao || '')}</div></td>
        <td class="num ${cls(a.valor_sinal)}">${money(a.valor_sinal)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nada em aberto.</div>';
  } catch (e) { fail(e); }
}

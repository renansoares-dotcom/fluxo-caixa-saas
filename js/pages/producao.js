// Produção › Painel: produção por dia, apara/refugo, OEE por máquina (regra explicada), paradas e refugo por motivo, OPs abertas e atrasadas.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, esc, dateBR, today, fail, chart, COR } from '../lib/ui.js';
import { kpiGrid, drawer, barList, tabela } from '../lib/componentes.js';
import { cadProducao, ST_OP, horas, addDias } from '../lib/producao.js';
import { badge, qtd } from '../lib/compras.js';

export const title = 'Painel de produção';
const ui = { dias: 7 };
const pctTxt = (v) => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1).replace('.', ',') + '%');

export async function render(root) {
  const h = today(), de = addDias(h, -(ui.dias - 1));
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Painel de produção</h2><div class="muted small">Apontamentos com início no período (importados do Iniflex ou feitos no terminal).</div></div>
      <label>Período<select id="pd-d">${[[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [90, '90 dias']].map(([d, t]) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>
    <div id="pd-corpo"><div class="loading">Carregando…</div></div>`;
  $('#pd-d', root).onchange = (e) => { ui.dias = +e.target.value; render(root); };
  let C, ap, pa, ops;
  try {
    const e = state.empresa.id, ini = `${de}T00:00:00-03:00`;
    [C, ap, pa, ops] = await Promise.all([cadProducao(true),
      fetchAll(() => sb.from('prod_apontamentos').select('maquina_id,setor_id,ordem_id,inicio,fim,qtd_boa,refugo,refugo_motivo_id').eq('empresa_id', e).gte('inicio', ini).order('id')),
      fetchAll(() => sb.from('prod_paradas').select('maquina_id,motivo_id,inicio,fim').eq('empresa_id', e).gte('inicio', ini).order('id')),
      fetchAll(() => sb.from('prod_ordens').select('id,numero,numero_iniflex,codigo_produto,descricao,quantidade,unidade,entrega,status,prioridade,cliente').eq('empresa_id', e).in('status', ['planejada', 'liberada', 'em_producao']).order('id'))]);
  } catch (err) { fail(err); $('#pd-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const agora = new Date().toISOString(), fimOu = (x) => x.fim || agora;
  const boa = ap.reduce((t, a) => t + +a.qtd_boa, 0), ref = ap.reduce((t, a) => t + +a.refugo, 0);
  const atras = ops.filter(o => o.entrega && o.entrega < h);
  // OEE por máquina
  const maqs = C.maquinas.filter(m => m.ativo).map(m => {
    const A = ap.filter(a => a.maquina_id === m.id), P = pa.filter(p => p.maquina_id === m.id);
    const hDia = +(C.setorById[m.setor_id]?.horas_dia || 24), disp = hDia * ui.dias;
    const planej = P.filter(p => C.motById[p.motivo_id]?.planejada).reduce((t, p) => t + horas(p.inicio, fimOu(p)), 0);
    const naoPl = P.filter(p => !C.motById[p.motivo_id]?.planejada).reduce((t, p) => t + horas(p.inicio, fimOu(p)), 0);
    const run = A.reduce((t, a) => t + horas(a.inicio, fimOu(a)), 0), b = A.reduce((t, a) => t + +a.qtd_boa, 0), r = A.reduce((t, a) => t + +a.refugo, 0);
    const tempoPl = Math.max(disp - planej, 0);
    const D = tempoPl ? Math.min(run / tempoPl, 1) : null, Pf = run && m.capacidade_kg_h ? Math.min((b + r) / (run * m.capacidade_kg_h), 1) : null, Q = b + r ? b / (b + r) : null;
    return { m, run, naoPl, planej, b, r, D, Pf, Q, oee: D != null && Pf != null && Q != null ? D * Pf * Q : null };
  });
  const comOee = maqs.filter(x => x.oee != null), oeeMed = comOee.length ? comOee.reduce((t, x) => t + x.oee * x.run, 0) / comOee.reduce((t, x) => t + x.run, 0) : null;
  const hNaoPl = maqs.reduce((t, x) => t + x.naoPl, 0);
  const listaOps = (arr) => tabela([{ titulo: 'OP' }, { titulo: 'Produto' }, { titulo: 'Entrega' }, { titulo: 'Situação' }],
    arr.map(o => ({ celulas: [o.numero_iniflex ? `${o.numero} (${o.numero_iniflex})` : o.numero, `${o.codigo_produto || ''} ${o.descricao || ''}`, dateBR(o.entrega), { html: badge(ST_OP, o.status) }],
      onClick: () => { document.querySelector('.cp-drawer-back')?.remove(); state.abrir = { tipo: 'op', id: o.id }; location.hash = '#/producao/ordens'; } })));
  const KP = {
    kg: { label: 'Produzido bom', valor: `${qtd(Math.round(boa))}`, sub: `${ap.length} apontamento(s)`, abrir: () => {} },
    ap: { label: 'Apara / refugo', valor: pctTxt(boa + ref ? ref / (boa + ref) : null), tom: boa + ref && ref / (boa + ref) > 0.08 ? 'warn' : '', sub: `${qtd(Math.round(ref))} kg`, abrir: () => {} },
    oee: { label: 'OEE médio', valor: pctTxt(oeeMed), tom: oeeMed != null && oeeMed < 0.6 ? 'warn' : '', sub: 'ponderado pelas horas', abrir: () => drawer({ titulo: 'Como o OEE é calculado', corpo: `<p class="small">Por máquina, no período:<br>
      <b>Disponibilidade</b> = horas apontadas ÷ (horas do setor por dia × dias − paradas planejadas).<br><b>Performance</b> = (bom + refugo) ÷ (horas apontadas × capacidade kg/h da máquina).<br>
      <b>Qualidade</b> = bom ÷ (bom + refugo).<br>OEE = disponibilidade × performance × qualidade. Máquina sem capacidade cadastrada fica sem OEE. Parada planejada é a marcada assim em Cadastros › Motivos.</p>` }) },
    pa: { label: 'Paradas não planejadas', valor: `${hNaoPl.toFixed(1).replace('.', ',')} h`, tom: hNaoPl ? 'warn' : '', sub: `${pa.length} parada(s)`, abrir: () => {} },
    op: { label: 'OPs em aberto', valor: String(ops.length), sub: `${ops.filter(o => o.status === 'em_producao').length} em produção`, abrir: () => drawer({ titulo: 'OPs em aberto', corpo: listaOps(ops) }) },
    at: { label: 'OPs atrasadas', valor: String(atras.length), tom: atras.length ? 'neg' : '', sub: 'entrega vencida', abrir: () => drawer({ titulo: 'OPs atrasadas', corpo: listaOps(atras) }) },
  };
  const corpo = $('#pd-corpo', root);
  corpo.innerHTML = `<div id="pd-kpis"></div>
    <div class="card" style="margin-top:16px"><h2>Produção por dia (kg bons)</h2><div class="chart-box"><canvas id="pd-c1"></canvas></div></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>OEE por máquina</h2></div><div class="table-wrap"><table><thead><tr><th>Máquina</th><th>Setor</th><th class="num">Horas apontadas</th><th class="num">Paradas (não plan.)</th><th class="num">Bom</th><th class="num">Refugo</th><th class="num">Disponib.</th><th class="num">Perform.</th><th class="num">Qualid.</th><th class="num">OEE</th></tr></thead><tbody>
      ${maqs.map(x => `<tr><td>${esc(x.m.codigo)} — ${esc(x.m.nome)}</td><td>${esc(C.setorById[x.m.setor_id]?.nome || '')}</td><td class="num">${x.run.toFixed(1).replace('.', ',')}</td><td class="num">${x.naoPl.toFixed(1).replace('.', ',')}</td>
        <td class="num">${qtd(Math.round(x.b))}</td><td class="num">${qtd(Math.round(x.r))}</td><td class="num">${pctTxt(x.D)}</td><td class="num">${pctTxt(x.Pf)}</td><td class="num">${pctTxt(x.Q)}</td>
        <td class="num ${x.oee != null && x.oee < 0.6 ? 'warn' : x.oee != null ? 'pos' : ''}"><b>${pctTxt(x.oee)}</b></td></tr>`).join('') || '<tr><td colspan="10" class="empty">Cadastre as máquinas em Produção › Cadastros.</td></tr>'}</tbody></table></div></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h2>Paradas por motivo (horas)</h2><div id="pd-par"></div></div>
      <div class="card"><h2>Refugo por motivo (kg)</h2><div id="pd-ref"></div></div></div>`;
  kpiGrid($('#pd-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k, clicavel: ['oee', 'op', 'at'].includes(id) })), (id) => KP[id].abrir());
  const dias = Array.from({ length: ui.dias }, (_, i) => addDias(de, i));
  const setores = C.setores.filter(s => ap.some(a => a.setor_id === s.id));
  chart($('#pd-c1', corpo), { type: 'bar', data: { labels: dias.map(d => d.slice(8) + '/' + d.slice(5, 7)), datasets: (setores.length ? setores : [{ id: null, nome: 'Total' }]).map((s, i) => ({
    label: s.nome, data: dias.map(d => ap.filter(a => (s.id == null || a.setor_id === s.id) && new Date(a.inicio).toLocaleDateString('sv-SE', { timeZone: 'America/Recife' }) === d).reduce((t, a) => t + +a.qtd_boa, 0)),
    backgroundColor: [COR.entrada, COR.saida, COR.saldo, '#1baf7a', '#eda100'][i % 5] })) },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } } });
  const porMot = (arr, f) => { const o = {}; for (const x of arr) { const k = C.motById[x.k]?.nome || 'Sem motivo'; o[k] = (o[k] || 0) + f(x); } return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  barList($('#pd-par', corpo), porMot(pa.map(p => ({ k: p.motivo_id, p })), (x) => horas(x.p.inicio, fimOu(x.p))).map(([n, v]) => ({ nome: n, valor: v, txt: `${v.toFixed(1).replace('.', ',')} h`, cor: 7 })), { vazio: 'Nenhuma parada registrada.' });
  barList($('#pd-ref', corpo), porMot(ap.filter(a => +a.refugo > 0).map(a => ({ k: a.refugo_motivo_id, a })), (x) => +x.a.refugo).map(([n, v]) => ({ nome: n, valor: v, txt: `${qtd(Math.round(v))} kg`, cor: 1 })), { vazio: 'Nenhum refugo apontado.' });
}

// Controle orçamentário: Orçado × Comprometido (em aberto) × Realizado por conta do plano e por centro de custo,
// semáforo (desvio acumulado e projeção do ano), projeção de fechamento, rateio do orçamento por centro de custo
// e justificativa dos desvios com relatório em PDF. Nada aqui altera lançamentos nem o budget/forecast.
import { sb, state, q, fetchAll, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, money, money0, pct, dateBR, fail, toast, modal, exportXLSX, loading, chart, COR, MESES, MESES_CURTO, moneyTick, logoPNG, parseNum } from '../lib/ui.js';

export const title = 'Controle orçamentário';

const ui = { ref: 0, comp: 'budget', visao: 'conta', tipo: 'S', tolPct: 10, tolVal: 5000, filtro: '', busca: '', abertos: new Set() };
let D = null;
const z = () => Array(12).fill(0);
const sum = (a, de = 0, ate = 12) => a.slice(de, ate).reduce((s, v) => s + v, 0);
const SEM = { vermelho: ['Estourado', 'vencido'], amarelo: ['Atenção', 'aberto'], verde: ['No orçamento', 'pago'], sem: ['Sem orçamento', ''] };

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando o orçamento…</div>';
  try { await carregar(); } catch (e) { fail(e); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar o controle orçamentário.</div></div>'; return; }
  if (!ui.ref) ui.ref = D.ultimoMes;
  desenhar(root);
}

async function carregar() {
  await loadCadastros();
  const e = state.empresa.id, ano = state.ano;
  const [mov, orc, rat, just] = await Promise.all([
    q(sb.rpc('orcamento_movimento', { p_empresa: e, p_ano: ano })),
    fetchAll(() => sb.from('orcamentos').select('plano_id,centro_custo_id,mes,valor,cenario').eq('empresa_id', e).eq('ano', ano)),
    q(sb.from('orcamento_rateio_cc').select('*').eq('empresa_id', e).eq('ano', ano)),
    q(sb.from('orcamento_justificativas').select('*').eq('empresa_id', e).eq('ano', ano).order('criado_em', { ascending: false })),
  ]);
  const ultimoMes = Math.max(0, ...mov.filter(r => r.status === 'Pago').map(r => r.mes)) || new Date().getMonth() || 1;
  D = { mov, orc, rat, just, ultimoMes, ano };
}

// ---------------------------------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------------------------------
// Monta as séries mensais de cada conta (e de cada conta × centro de custo)
function series() {
  const c = state.cad, contas = new Map(), porCC = new Map();
  const nova = (p) => ({ p, bud: z(), fc: z(), real: z(), comp: z(), temFc: false });
  const get = (pid) => { const p = c.planoById[pid]; if (!p || p.nivel !== 2 || !'ES'.includes(p.tipo)) return null; if (!contas.has(pid)) contas.set(pid, nova(p)); return contas.get(pid); };
  for (const o of D.orc) { const s = get(o.plano_id); if (!s) continue; s[o.cenario === 'budget' ? 'bud' : 'fc'][o.mes - 1] += +o.valor; if (o.cenario === 'forecast') s.temFc = true; }
  for (const r of D.mov) {
    const s = get(r.plano_id); if (!s) continue; const k = r.status === 'Pago' ? 'real' : 'comp';
    s[k][r.mes - 1] += +r.total;
    const kc = `${r.plano_id}|${r.centro_custo_id || ''}`;
    if (!porCC.has(kc)) porCC.set(kc, { pid: r.plano_id, cc: r.centro_custo_id || '', real: z(), comp: z() });
    porCC.get(kc)[k][r.mes - 1] += +r.total;
  }
  return { contas, porCC };
}

// Indicadores de uma série (valores sempre positivos; para entradas o desvio desfavorável é receber menos)
function indicadores(s, orcArr) {
  const r = ui.ref, E = s.p.tipo === 'E';
  const orc = orcArr, real = s.real, comp = s.comp;
  const orcMes = orc[r - 1], realMes = real[r - 1];
  const orcAc = sum(orc, 0, r), realAc = sum(real, 0, r), orcAno = sum(orc), realAno = sum(real), compTot = sum(comp), compAtras = sum(comp, 0, r);
  // projeção: realizado até o mês + (forecast ou média) dos meses seguintes, nunca abaixo do que já está lançado/em aberto
  const media = r ? realAc / r : 0;
  let proj = realAc + compAtras;
  for (let m = r; m < 12; m++) proj += Math.max(s.temFc ? s.fc[m] : media, real[m] + comp[m]);
  const sinal = E ? -1 : 1;
  const dvMes = sinal * (realMes - orcMes), dvAc = sinal * (realAc - orcAc), dvProj = sinal * (proj - orcAno);
  const lim = (base) => Math.max(ui.tolVal, ui.tolPct / 100 * Math.abs(base));
  let st;
  if (!orcAno && !orcAc) st = (realAno + compTot) > 0 ? 'sem' : null;
  else if (dvAc > lim(orcAc)) st = 'vermelho';
  else if (dvAc > 0.005 || dvProj > lim(orcAno)) st = 'amarelo';
  else st = 'verde';
  const justificar = st === 'vermelho' || (orcMes || realMes) && dvMes > lim(orcMes) || (st === 'sem' && !E && realMes > ui.tolVal);
  return { orcMes, realMes, dvMes, orcAc, realAc, dvAc, consumo: orcAc ? realAc / orcAc : null, orcAno, realAno, compTot, saldo: orcAno - realAno - compTot, proj, dvProj, st, justificar };
}

const justDe = (pid, cc = null) => D.just.find(j => j.origem === 'acompanhamento' && j.mes === ui.ref && j.plano_id === pid && (j.centro_custo_id || null) === (cc || null));

function linhasConta() {
  const { contas } = series();
  const L = [];
  for (const s of contas.values()) {
    if (ui.tipo && s.p.tipo !== ui.tipo) continue;
    const orc = ui.comp === 'budget' ? s.bud : s.fc;
    const x = indicadores(s, orc); if (!x.st) continue;
    L.push({ s, x, j: justDe(s.p.id) });
  }
  return L;
}

// Centro de custo: orçado = lançado por centro de custo no budget, senão rateio (%) do orçamento da conta
function linhasCC() {
  const { contas, porCC } = series(); const c = state.cad;
  const rat = new Map(D.rat.map(r => [`${r.plano_id}|${r.centro_custo_id}`, +r.pct]));
  const orcDireto = new Map();
  for (const o of D.orc.filter(o => o.centro_custo_id && o.cenario === ui.comp)) { const k = `${o.plano_id}|${o.centro_custo_id}`; (orcDireto.get(k) || orcDireto.set(k, z()).get(k))[o.mes - 1] += +o.valor; }
  const chaves = new Set([...porCC.keys(), ...[...rat.keys()], ...orcDireto.keys()]);
  const grupos = new Map();
  for (const k of chaves) {
    const [pid, cc] = k.split('|'); const s = contas.get(pid); if (!s || (ui.tipo && s.p.tipo !== ui.tipo)) continue;
    const mv = porCC.get(k) || { real: z(), comp: z() };
    const base = ui.comp === 'budget' ? s.bud : s.fc;
    let orc = null, fonte = '';
    if (orcDireto.has(k)) { orc = orcDireto.get(k); fonte = 'lançado'; }
    else if (cc && rat.has(k)) { const f = rat.get(k) / 100; orc = base.map(v => v * f); fonte = `${String(rat.get(k)).replace('.', ',')}% da conta`; }
    const sub = { p: s.p, real: mv.real, comp: mv.comp, fc: s.fc.map(v => v * (rat.get(k) ?? 0) / 100), temFc: s.temFc && rat.has(k) };
    const x = orc ? indicadores(sub, orc) : { ...indicadores({ ...sub, temFc: false }, z()), st: 'sem', semOrc: true };
    if (!orc && !sum(mv.real) && !sum(mv.comp)) continue;
    const g = grupos.get(cc) || grupos.set(cc, { cc, nome: c.ccById[cc]?.nome || 'Sem centro de custo', itens: [] }).get(cc);
    g.itens.push({ s: { p: s.p }, x, fonte, temOrc: !!orc, j: justDe(pid, cc || null) });
  }
  return [...grupos.values()].sort((a, b) => (a.cc ? 0 : 1) - (b.cc ? 0 : 1) || a.nome.localeCompare(b.nome));
}

function totais(L) {
  const T = { orcMes: 0, realMes: 0, orcAc: 0, realAc: 0, orcAno: 0, realAno: 0, compTot: 0, saldo: 0, proj: 0 };
  for (const { x } of L) for (const k in T) T[k] += x[k] || 0;
  return T;
}

// ---------------------------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------------------------
function desenhar(root) {
  const mesOpts = MESES.map((m, i) => `<option value="${i + 1}" ${ui.ref === i + 1 ? 'selected' : ''}>${m[0] + m.slice(1).toLowerCase()}</option>`).join('');
  root.innerHTML = `<div class="card"><div class="toolbar" id="oflt">
      <label>Mês de referência<select name="ref">${mesOpts}</select></label>
      <label>Comparar com<select name="comp"><option value="budget">Budget</option><option value="forecast" ${ui.comp === 'forecast' ? 'selected' : ''}>Forecast</option></select></label>
      <label>Visão<select name="visao"><option value="conta">Por conta do plano</option><option value="cc" ${ui.visao === 'cc' ? 'selected' : ''}>Por centro de custo</option></select></label>
      <label>Tipo<select name="tipo"><option value="S">Saídas</option><option value="E" ${ui.tipo === 'E' ? 'selected' : ''}>Entradas</option><option value="" ${ui.tipo === '' ? 'selected' : ''}>Entradas e saídas</option></select></label>
      <label>Tolerância %<input name="tolPct" type="number" min="0" step="1" value="${ui.tolPct}" style="width:70px"></label>
      <label>Tolerância R$<input name="tolVal" type="number" min="0" step="500" value="${ui.tolVal}" style="width:100px"></label>
      <label class="grow">Buscar<input name="busca" value="${esc(ui.busca)}" placeholder="conta ou centro de custo"></label>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
      <div class="chips" id="ofil">${[['', 'Todas'], ['vermelho', 'Estouradas'], ['amarelo', 'Atenção'], ['justificar', 'A justificar'], ['sem', 'Sem orçamento']].map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <span class="spacer" style="flex:1"></span>
      ${ui.visao === 'cc' && podeEditar() ? '<button class="btn" id="rateio">Rateio do orçamento por centro de custo</button>' : ''}
      <button class="btn" id="pdf">Relatório de desvios (PDF)</button><button class="btn" id="exp">Exportar Excel</button></div>
    <p class="muted small" style="margin:8px 0 0">Realizado = lançamentos pagos; comprometido = lançamentos em aberto (a pagar ou a receber). Semáforo pelo desvio acumulado até ${MESES_CURTO[ui.ref - 1]}/${D.ano}: vermelho acima da tolerância, amarelo dentro da tolerância ou com projeção do ano acima do orçado.
      Projeção = realizado até o mês + ${'forecast (ou a média mensal, quando a conta não tem forecast)'} nos meses seguintes, nunca abaixo do que já está lançado em aberto.</p></div>
    <div class="kpis" id="okpi"></div>
    <div class="card"><div class="chart-box" style="height:240px"><canvas id="och"></canvas></div></div>
    <div class="card flush"><div class="table-wrap" id="otab" style="max-height:70vh"></div></div>`;
  const f = $('#oflt', root);
  f.onchange = (e) => { const n = e.target.name; if (!n || n === 'busca') return; ui[n] = ['ref', 'tolPct', 'tolVal'].includes(n) ? +e.target.value || 0 : e.target.value; if (n === 'visao') return desenhar(root); pintar(root); };
  let tb; $('[name=busca]', f).oninput = (e) => { clearTimeout(tb); tb = setTimeout(() => { ui.busca = e.target.value; pintar(root); }, 300); };
  $('#ofil', root).onclick = (e) => { const k = e.target.closest('[data-f]'); if (!k) return; ui.filtro = k.dataset.f; root.querySelectorAll('#ofil .chip').forEach(c => c.classList.toggle('on', c.dataset.f === ui.filtro)); pintar(root); };
  $('#exp', root).onclick = () => exportXLSX($('#otab table', root), `controle_orcamentario_${D.ano}_${String(ui.ref).padStart(2, '0')}`);
  $('#pdf', root).onclick = () => pdfDesvios();
  $('#rateio', root) && ($('#rateio', root).onclick = () => editarRateio(null, root));
  pintar(root);
}

const passa = (it) => {
  const b = ui.busca.trim().toLowerCase();
  if (b && !`${it.s.p.codigo} ${it.s.p.nome} ${it.ccNome || ''}`.toLowerCase().includes(b)) return false;
  if (ui.filtro === 'justificar') return it.x.justificar && !it.j;
  if (ui.filtro) return it.x.st === ui.filtro;
  return true;
};

function pintar(root) {
  const c = state.cad;
  const todas = linhasConta();
  // KPIs sempre pela visão por conta (o total da empresa)
  const porTipo = (t) => totais(todas.filter(l => l.s.p.tipo === t));
  const S = ui.tipo === 'E' ? null : porTipo('S'), Ent = ui.tipo === 'S' ? null : porTipo('E');
  const cont = (st) => todas.filter(l => l.x.st === st).length, pend = todas.filter(l => l.x.justificar && !l.j).length;
  const kp = (rot, v, sub, cl = '') => `<div class="kpi"><div class="k-label">${rot}</div><div class="k-value ${cl}">${v}</div><div class="k-sub">${sub}</div></div>`;
  const blocoT = (T, nome, E) => T ? kp(`${nome} até ${MESES_CURTO[ui.ref - 1]}`, money0(T.realAc), `orçado ${money0(T.orcAc)} · ${T.orcAc ? pct(T.realAc / T.orcAc) : '–'} · desvio <span class="${(E ? T.orcAc - T.realAc : T.realAc - T.orcAc) > 0 ? 'neg' : 'pos'}">${money0(T.realAc - T.orcAc)}</span>`)
    + kp(`${nome} — projeção ${D.ano}`, money0(T.proj), `orçado no ano ${money0(T.orcAno)} · <span class="${(E ? T.orcAno - T.proj : T.proj - T.orcAno) > 0 ? 'neg' : 'pos'}">${T.proj - T.orcAno >= 0 ? '+' : ''}${money0(T.proj - T.orcAno)}</span>${E ? '' : ` · em aberto ${money0(T.compTot)}`}`) : '';
  $('#okpi', root).innerHTML = blocoT(S, 'Saídas', false) + blocoT(Ent, 'Entradas', true)
    + kp('Semáforo', `<span class="neg">${cont('vermelho')}</span> · <span style="color:var(--warn,#c98a00)">${cont('amarelo')}</span> · <span class="pos">${cont('verde')}</span>`, `estouradas · atenção · no orçamento${cont('sem') ? ` · ${cont('sem')} sem orçamento` : ''}`)
    + kp(`Justificativas de ${MESES_CURTO[ui.ref - 1]}`, `${pend}`, pend ? 'desvio(s) aguardando justificativa' : 'nenhuma pendente', pend ? 'neg' : 'pos');
  grafico(root, todas);
  if (ui.visao === 'cc') return tabelaCC(root);
  tabelaConta(root, todas.filter(passa));
}

function grafico(root, todas) {
  const L = todas.filter(l => !ui.tipo || l.s.p.tipo === ui.tipo);
  const orc = z(), real = z(), comp = z();
  for (const { s } of L) { const o = ui.comp === 'budget' ? s.bud : s.fc; for (let i = 0; i < 12; i++) { orc[i] += o[i]; real[i] += s.real[i]; comp[i] += s.comp[i]; } }
  const nome = ui.tipo === 'S' ? 'Saídas' : ui.tipo === 'E' ? 'Entradas' : 'Entradas + saídas';
  chart($('#och', root), { type: 'bar', data: { labels: MESES_CURTO, datasets: [
    { label: `${nome} — ${ui.comp === 'budget' ? 'budget' : 'forecast'}`, data: orc, backgroundColor: (COR.saida || '#e34948') + '33', borderColor: COR.saida || '#e34948', borderWidth: 1, stack: 'o' },
    { label: `${nome} — realizado`, data: real, backgroundColor: COR.saida || '#e34948', stack: 'r' },
    { label: `${nome} — em aberto`, data: comp, backgroundColor: '#eda100', stack: 'r' }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: moneyTick } } },
      plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw)}` } } } } });
}

const thead = (pri) => `<thead><tr><th rowspan="2">${pri}</th><th colspan="3" class="num" style="text-align:center">${MESES_CURTO[ui.ref - 1]}/${D.ano}</th><th colspan="4" class="num" style="text-align:center">Acumulado até ${MESES_CURTO[ui.ref - 1]}</th><th colspan="5" class="num" style="text-align:center">Ano ${D.ano}</th><th rowspan="2">Status</th><th rowspan="2">Justificativa</th></tr>
  <tr><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Desvio</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Desvio</th><th class="num">Consumo</th><th class="num">Orçado</th><th class="num">Em aberto</th><th class="num">Saldo</th><th class="num">Projeção</th><th class="num">Proj. × orçado</th></tr></thead>`;
const corDv = (v, E) => (E ? -v : v) > 0.005 ? 'neg' : (E ? -v : v) < -0.005 ? 'pos' : '';
function celulas(x, E) {
  if (x.semOrc) return `<td class="num">–</td><td class="num">${money0(x.realMes)}</td><td class="num">–</td><td class="num">–</td><td class="num">${money0(x.realAc)}</td><td class="num">–</td><td class="num">–</td>
    <td class="num">–</td><td class="num">${money0(x.compTot)}</td><td class="num">–</td><td class="num">${money0(x.proj)}</td><td class="num">–</td>`;
  return `<td class="num">${money0(x.orcMes)}</td><td class="num">${money0(x.realMes)}</td><td class="num ${corDv(x.realMes - x.orcMes, E)}">${money0(x.realMes - x.orcMes)}</td>
    <td class="num">${money0(x.orcAc)}</td><td class="num">${money0(x.realAc)}</td><td class="num ${corDv(x.realAc - x.orcAc, E)}">${money0(x.realAc - x.orcAc)}</td><td class="num">${x.consumo == null ? '–' : pct(x.consumo, 0)}</td>
    <td class="num">${money0(x.orcAno)}</td><td class="num">${money0(x.compTot)}</td><td class="num ${x.saldo < -0.005 && !E ? 'neg' : ''}">${money0(x.saldo)}</td><td class="num">${money0(x.proj)}</td><td class="num ${corDv(x.proj - x.orcAno, E)}">${x.orcAno ? pct((x.proj - x.orcAno) / x.orcAno, 0) : '–'}</td>`;
}
const badgeSt = (st) => st ? `<span class="badge ${SEM[st][1]}">${SEM[st][0]}</span>` : '';
const celJust = (it, key) => it.j ? `<span class="badge pago" title="${esc(it.j.justificativa)}">justificado</span>` : it.x.justificar ? (podeEditar() ? `<button class="btn small" data-just="${key}">Justificar</button>` : '<span class="badge vencido">pendente</span>') : '';

function tabelaConta(root, L) {
  const c = state.cad; const t = $('#otab', root);
  if (!L.length) { t.innerHTML = '<div class="empty">Nenhuma conta com esses filtros.</div>'; return; }
  const porClasse = new Map();
  for (const l of L) (porClasse.get(l.s.p.pai_id) || porClasse.set(l.s.p.pai_id, []).get(l.s.p.pai_id)).push(l);
  const classes = [...porClasse.keys()].sort((a, b) => (c.planoById[a]?.codigo || '').localeCompare(c.planoById[b]?.codigo || ''));
  const linha = (l) => `<tr class="clickable" data-pid="${l.s.p.id}"><td style="padding-left:22px" class="wrap">${esc(l.s.p.codigo)} ${esc(l.s.p.nome)}</td>${celulas(l.x, l.s.p.tipo === 'E')}<td>${badgeSt(l.x.st)}</td><td>${celJust(l, l.s.p.id)}</td></tr>`;
  const sub = (nome, LL, E, cls = 'row-sec') => { const T = totais(LL); const x = { ...T, consumo: T.orcAc ? T.realAc / T.orcAc : null }; return `<tr class="${cls}"><td>${esc(nome)}</td>${celulas(x, E)}<td></td><td></td></tr>`; };
  t.innerHTML = `<table>${thead('Conta')}<tbody>
    ${classes.map(cid => { const LL = porClasse.get(cid).sort((a, b) => a.s.p.codigo.localeCompare(b.s.p.codigo)); const cl = c.planoById[cid]; return sub(cl ? `${cl.codigo} ${cl.nome}` : '—', LL, cl?.tipo === 'E') + LL.map(linha).join(''); }).join('')}
    ${['S', 'E'].filter(tp => L.some(l => l.s.p.tipo === tp)).map(tp => sub(tp === 'S' ? 'TOTAL SAÍDAS' : 'TOTAL ENTRADAS', L.filter(l => l.s.p.tipo === tp), tp === 'E', 'row-sec total')).join('')}
    </tbody></table>`;
  t.onclick = (e) => {
    const bj = e.target.closest('[data-just]'); if (bj) { e.stopPropagation(); const l = L.find(x => x.s.p.id === bj.dataset.just); return justificar(l.s.p, null, l.x, l.j, root); }
    const tr = e.target.closest('tr[data-pid]'); if (tr) detalheConta(tr.dataset.pid, root);
  };
}

function tabelaCC(root) {
  const t = $('#otab', root); const G = linhasCC();
  const vis = G.map(g => ({ ...g, itens: g.itens.map(i => ({ ...i, ccNome: g.nome })).filter(passa) })).filter(g => g.itens.length);
  if (!vis.length) { t.innerHTML = '<div class="empty">Nenhum centro de custo com esses filtros.</div>'; return; }
  const semRateio = G.reduce((n, g) => n + g.itens.filter(i => !i.temOrc && g.cc).length, 0);
  t.innerHTML = `${semRateio ? `<p class="small" style="padding:10px 12px 0;margin:0">O orçamento é feito por conta do plano. Para ver o orçado de cada centro de custo, defina o <strong>rateio</strong> de cada conta entre os centros (botão acima ou o link “definir” na linha). ${semRateio} conta(s) × centro(s) ainda sem rateio aparecem como “sem orçamento”.</p>` : ''}
    <table>${thead('Centro de custo / conta')}<tbody>
    ${vis.map(g => { const aberto = ui.abertos.has(g.cc) || !!ui.busca || !!ui.filtro; const T = totais(g.itens.filter(i => i.temOrc)), R = totais(g.itens);
      const com = g.itens.some(i => i.temOrc); const x = com ? { ...T, consumo: T.orcAc ? T.realAc / T.orcAc : null, saldo: T.orcAno - T.realAno - T.compTot } : { ...R, semOrc: true };
      const cob = R.realAc ? totais(g.itens.filter(i => i.temOrc)).realAc / R.realAc : 0;
      return `<tr class="row-sec clickable" data-cc="${g.cc}"><td>${aberto ? '▾' : '▸'} ${esc(g.nome)} <span class="small muted">· ${g.itens.length} conta(s)${R.realAc ? ` · ${pct(cob, 0)} do realizado com orçamento` : ''}</span></td>${celulas(x, ui.tipo === 'E')}<td></td><td></td></tr>
        ${aberto ? g.itens.sort((a, b) => a.s.p.codigo.localeCompare(b.s.p.codigo)).map(i => `<tr data-pid="${i.s.p.id}" data-ccl="${g.cc}" class="clickable"><td style="padding-left:26px" class="wrap">${esc(i.s.p.codigo)} ${esc(i.s.p.nome)} <span class="small muted">${i.temOrc ? `(${esc(i.fonte)})` : g.cc && podeEditar() ? `<a href="#" data-rat="${i.s.p.id}">definir rateio</a>` : ''}</span></td>
          ${celulas(i.x, i.s.p.tipo === 'E')}<td>${i.temOrc ? badgeSt(i.x.st) : badgeSt('sem')}</td><td>${i.temOrc ? celJust(i, `${i.s.p.id}|${g.cc}`) : ''}</td></tr>`).join('') : ''}`; }).join('')}
    </tbody></table>`;
  t.onclick = (e) => {
    const ra = e.target.closest('[data-rat]'); if (ra) { e.preventDefault(); e.stopPropagation(); return editarRateio(ra.dataset.rat, root); }
    const bj = e.target.closest('[data-just]'); if (bj) { e.stopPropagation(); const [pid, cc] = bj.dataset.just.split('|'); const it = G.find(g => g.cc === cc)?.itens.find(i => i.s.p.id === pid); return justificar(it.s.p, cc || null, it.x, it.j, root); }
    const g = e.target.closest('tr[data-cc]'); if (g) { const k = g.dataset.cc; ui.abertos.has(k) ? ui.abertos.delete(k) : ui.abertos.add(k); return tabelaCC(root); }
    const tr = e.target.closest('tr[data-pid]'); if (tr) detalheConta(tr.dataset.pid, root, tr.dataset.ccl);
  };
}

// ---------------------------------------------------------------------------------------------
// Detalhe da conta (mês a mês, centros de custo, maiores lançamentos, justificativas)
// ---------------------------------------------------------------------------------------------
async function detalheConta(pid, root, ccSel) {
  const c = state.cad, p = c.planoById[pid]; const { contas, porCC } = series(); const s = contas.get(pid); if (!s) return;
  const E = p.tipo === 'E'; const orc = ui.comp === 'budget' ? s.bud : s.fc; const x = indicadores(s, orc);
  const ini = `${D.ano}-${String(ui.ref).padStart(2, '0')}-01`, fim = new Date(Date.UTC(D.ano, ui.ref, 0)).toISOString().slice(0, 10);
  let lanc = [];
  try { lanc = await q(sb.from('lancamentos').select('id,data,valor,descricao,favorecido_id,centro_custo_id,status,conta_id').eq('empresa_id', state.empresa.id).eq('plano_id', pid).gte('data', ini).lte('data', fim).order('valor', { ascending: false }).limit(15)); } catch (e) { return fail(e); }
  const ccs = [...porCC.values()].filter(v => v.pid === pid).map(v => ({ nome: c.ccById[v.cc]?.nome || 'Sem centro de custo', realAc: sum(v.real, 0, ui.ref), realAno: sum(v.real), comp: sum(v.comp), cc: v.cc })).sort((a, b) => b.realAno - a.realAno);
  const just = D.just.filter(j => j.plano_id === pid).sort((a, b) => b.mes - a.mes);
  const m = modal({ title: `${p.codigo} ${p.nome}`, wide: true, body: `
    <div class="kpis" style="margin:0 0 12px">
      <div class="kpi"><div class="k-label">Acumulado até ${MESES_CURTO[ui.ref - 1]}</div><div class="k-value">${money0(x.realAc)}</div><div class="k-sub">orçado ${money0(x.orcAc)} · consumo ${x.consumo == null ? '–' : pct(x.consumo, 0)}</div></div>
      <div class="kpi"><div class="k-label">Ano ${D.ano}</div><div class="k-value">${money0(x.orcAno)}</div><div class="k-sub">realizado ${money0(x.realAno)} · em aberto ${money0(x.compTot)} · saldo ${money0(x.saldo)}</div></div>
      <div class="kpi"><div class="k-label">Projeção do ano</div><div class="k-value">${money0(x.proj)}</div><div class="k-sub ${corDv(x.proj - x.orcAno, E)}">${x.proj - x.orcAno >= 0 ? '+' : ''}${money0(x.proj - x.orcAno)} contra o orçado</div></div>
      <div class="kpi"><div class="k-label">Status</div><div class="k-value">${badgeSt(x.st)}</div><div class="k-sub">${x.justificar ? (justDe(pid) ? 'justificado' : 'desvio a justificar') : 'sem desvio relevante'}</div></div></div>
    <div class="chart-box" style="height:200px"><canvas id="dch"></canvas></div>
    <div class="table-wrap" style="margin-top:10px"><table id="dtab"><thead><tr><th></th>${MESES_CURTO.map((n, i) => `<th class="num ${i + 1 === ui.ref ? 'row-sel' : ''}">${n}</th>`).join('')}<th class="num">Ano</th></tr></thead><tbody>
      ${[['Budget', s.bud], ['Forecast', s.fc], ['Realizado', s.real], ['Em aberto', s.comp], [`Desvio (realizado − ${ui.comp})`, s.real.map((v, i) => v - orc[i])]].map(([n, a]) => `<tr><td>${n}</td>${a.map(v => `<td class="num ${n.startsWith('Desvio') ? corDv(v, E) : ''}">${money0(v)}</td>`).join('')}<td class="num">${money0(sum(a))}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="grid2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-top:12px">
      <div><h3 style="margin:0 0 6px">Por centro de custo</h3><div class="table-wrap" style="max-height:220px"><table><thead><tr><th>Centro de custo</th><th class="num">Até ${MESES_CURTO[ui.ref - 1]}</th><th class="num">Ano</th><th class="num">Em aberto</th></tr></thead><tbody>
        ${ccs.map(r => `<tr class="${r.cc === (ccSel ?? null) ? 'row-sel' : ''}"><td>${esc(r.nome)}</td><td class="num">${money0(r.realAc)}</td><td class="num">${money0(r.realAno)}</td><td class="num">${money0(r.comp)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">—</td></tr>'}</tbody></table></div></div>
      <div><h3 style="margin:0 0 6px">Maiores lançamentos de ${MESES_CURTO[ui.ref - 1]}</h3><div class="table-wrap" style="max-height:220px"><table><thead><tr><th>Data</th><th>Favorecido / descrição</th><th class="num">Valor</th></tr></thead><tbody>
        ${lanc.map(l => `<tr><td>${dateBR(l.data)}${l.status !== 'Pago' ? ' <span class="badge aberto">aberto</span>' : ''}</td><td class="wrap small">${esc(c.favById[l.favorecido_id]?.nome || '')}<div class="muted">${esc(l.descricao || '')}${l.centro_custo_id ? ' · ' + esc(c.ccById[l.centro_custo_id]?.nome || '') : ''}</div></td><td class="num">${money(l.valor)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nenhum lançamento no mês.</td></tr>'}</tbody></table></div></div></div>
    <h3 style="margin:12px 0 6px">Justificativas</h3>
    ${just.length ? `<div class="table-wrap"><table><thead><tr><th>Mês</th><th>Centro de custo</th><th class="num">Desvio</th><th>Justificativa</th><th>Ação</th><th>Origem</th></tr></thead><tbody>
      ${just.map(j => `<tr><td>${MESES_CURTO[j.mes - 1]}</td><td>${esc(c.ccById[j.centro_custo_id]?.nome || '—')}</td><td class="num">${money0(j.desvio)}</td><td class="wrap small">${esc(j.justificativa)}</td><td class="wrap small">${esc(j.acao || '')}</td><td class="small">${j.origem === 'autorizacao' ? 'autorização de pagamento' : 'acompanhamento'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">Nenhuma justificativa registrada para esta conta.</p>'}`,
    foot: `${podeEditar() ? `<button class="btn primary" id="djust" style="margin-right:auto">${justDe(pid) ? 'Editar justificativa' : 'Justificar'} ${MESES_CURTO[ui.ref - 1]}</button>` : ''}<button class="btn" id="dexp">Exportar Excel</button><button class="btn" data-close>Fechar</button>` });
  chart($('#dch', m.el), { type: 'bar', data: { labels: MESES_CURTO, datasets: [
    { label: ui.comp === 'budget' ? 'Budget' : 'Forecast', data: orc, backgroundColor: '#8884', borderColor: '#888', borderWidth: 1, stack: 'o' },
    { label: 'Realizado', data: s.real, backgroundColor: E ? (COR.entrada || '#1baf7a') : (COR.saida || '#e34948'), stack: 'r' },
    { label: 'Em aberto', data: s.comp, backgroundColor: '#eda100', stack: 'r' }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: moneyTick } } }, plugins: { tooltip: { callbacks: { label: (v) => `${v.dataset.label}: ${money(v.raw)}` } } } } });
  $('#dexp', m.el).onclick = () => exportXLSX($('#dtab', m.el), `orcamento_${p.codigo}_${D.ano}`);
  $('#djust', m.el) && ($('#djust', m.el).onclick = () => { m.close(); justificar(p, null, x, justDe(pid), root); });
}

// ---------------------------------------------------------------------------------------------
// Justificativa de desvio (conta ou conta × centro de custo, no mês de referência)
// ---------------------------------------------------------------------------------------------
function justificar(p, cc, x, atual, root) {
  const nomeCC = cc ? state.cad.ccById[cc]?.nome : null;
  const m = modal({ title: `Justificar desvio — ${p.codigo} ${p.nome}${nomeCC ? ' · ' + nomeCC : ''}`, body: `
    <p class="small" style="margin-top:0">${MESES[ui.ref - 1][0] + MESES[ui.ref - 1].slice(1).toLowerCase()}/${D.ano} · comparado com o ${ui.comp}.</p>
    <div class="kpis" style="margin:0 0 10px">
      <div class="kpi"><div class="k-label">No mês</div><div class="k-value">${money0(x.realMes - x.orcMes)}</div><div class="k-sub">realizado ${money0(x.realMes)} · orçado ${money0(x.orcMes)}</div></div>
      <div class="kpi"><div class="k-label">Acumulado</div><div class="k-value">${money0(x.realAc - x.orcAc)}</div><div class="k-sub">realizado ${money0(x.realAc)} · orçado ${money0(x.orcAc)}</div></div></div>
    <label style="display:block">Justificativa (o que causou o desvio)<textarea id="jt" rows="4" style="width:100%">${esc(atual?.justificativa || '')}</textarea></label>
    <label style="display:block;margin-top:8px">Ação prevista (opcional)<textarea id="ja" rows="2" style="width:100%">${esc(atual?.acao || '')}</textarea></label>`,
    foot: `${atual ? '<button class="btn danger" id="jdel" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="jok">Salvar</button>` });
  $('#jt', m.el).focus();
  $('#jok', m.el).onclick = async () => {
    const texto = $('#jt', m.el).value.trim(); if (!texto) return toast('Escreva a justificativa', true);
    const row = { empresa_id: state.empresa.id, ano: D.ano, mes: ui.ref, plano_id: p.id, centro_custo_id: cc || null, origem: 'acompanhamento',
      orcado: +x.orcMes.toFixed(2), realizado: +x.realMes.toFixed(2), desvio: +(x.realMes - x.orcMes).toFixed(2), justificativa: texto, acao: $('#ja', m.el).value.trim() || null, atualizado_em: new Date().toISOString() };
    try {
      if (atual) await q(sb.from('orcamento_justificativas').update(row).eq('id', atual.id)); else await q(sb.from('orcamento_justificativas').insert(row));
      toast('Justificativa salva'); m.close(); await carregar(); pintar(root);
    } catch (e) { fail(e); }
  };
  $('#jdel', m.el) && ($('#jdel', m.el).onclick = async () => { if (!confirm('Excluir esta justificativa?')) return; try { await q(sb.from('orcamento_justificativas').delete().eq('id', atual.id)); toast('Justificativa excluída'); m.close(); await carregar(); pintar(root); } catch (e) { fail(e); } });
}

// ---------------------------------------------------------------------------------------------
// Rateio do orçamento de uma conta entre os centros de custo
// ---------------------------------------------------------------------------------------------
function editarRateio(pidIni, root) {
  const c = state.cad; const { contas, porCC } = series();
  const lista = [...contas.values()].filter(s => sum(s.bud) || sum(s.fc)).map(s => s.p).filter(p => !ui.tipo || p.tipo === ui.tipo).sort((a, b) => a.codigo.localeCompare(b.codigo));
  let pid = pidIni || lista[0]?.id;
  const m = modal({ title: 'Rateio do orçamento por centro de custo', wide: true, body: `
    <p class="small muted" style="margin-top:0">Define quanto do orçamento de cada conta pertence a cada centro de custo em ${D.ano}. O budget e o forecast continuam lançados por conta; o rateio só distribui o valor para a visão por centro de custo.</p>
    <div class="toolbar"><label class="grow">Conta<select id="rc">${lista.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.codigo)} ${esc(p.nome)}</option>`).join('')}</select></label>
      <button class="btn" id="rsug">Sugerir pela participação realizada</button></div>
    <div id="rbody" style="margin-top:10px"></div>`,
    foot: `${podeEditar() ? '<button class="btn" id="rtodas" style="margin-right:auto">Aplicar a sugestão em todas as contas sem rateio</button>' : ''}<button class="btn" data-close>Fechar</button><button class="btn primary" id="rok">Salvar rateio da conta</button>` });
  const participacao = (id) => { const L = [...porCC.values()].filter(v => v.pid === id && v.cc); const tot = L.reduce((s, v) => s + sum(v.real, 0, ui.ref), 0); return tot ? L.map(v => ({ cc: v.cc, pct: +(sum(v.real, 0, ui.ref) / tot * 100).toFixed(2) })).filter(x => x.pct > 0) : []; };
  const pinta = (vals) => {
    const atual = vals || Object.fromEntries(D.rat.filter(r => r.plano_id === pid).map(r => [r.centro_custo_id, +r.pct]));
    const s = contas.get(pid); const orcAno = sum(ui.comp === 'budget' ? s.bud : s.fc);
    $('#rbody', m.el).innerHTML = `<div class="table-wrap" style="max-height:46vh"><table><thead><tr><th>Centro de custo</th><th class="num">Realizado até ${MESES_CURTO[ui.ref - 1]}</th><th class="num">%</th><th class="num">Orçado no ano</th></tr></thead><tbody>
      ${c.cc.filter(x => x.ativo !== false || atual[x.id]).map(x => { const v = [...porCC.values()].find(r => r.pid === pid && r.cc === x.id); return `<tr><td>${esc(x.nome)}</td><td class="num">${money0(v ? sum(v.real, 0, ui.ref) : 0)}</td>
        <td class="num"><input data-cc="${x.id}" type="text" inputmode="decimal" value="${atual[x.id] ? String(atual[x.id]).replace('.', ',') : ''}" style="width:80px;text-align:right"></td><td class="num" data-v="${x.id}">${money0(orcAno * (atual[x.id] || 0) / 100)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr style="font-weight:600"><td>Total</td><td></td><td class="num" id="rtot"></td><td class="num">${money0(orcAno)}</td></tr></tfoot></table></div>`;
    const tot = () => { let t = 0; m.el.querySelectorAll('[data-cc]').forEach(i => { const v = parseNum(i.value) || 0; t += v; m.el.querySelector(`[data-v="${i.dataset.cc}"]`).textContent = money0(orcAno * v / 100); }); $('#rtot', m.el).innerHTML = `<span class="${Math.abs(t - 100) < 0.01 || !t ? 'pos' : 'neg'}">${t.toFixed(2).replace('.', ',')}%</span>`; return t; };
    $('#rbody', m.el).oninput = tot; tot();
  };
  pinta();
  $('#rc', m.el).onchange = (e) => { pid = e.target.value; pinta(); };
  $('#rsug', m.el).onclick = () => { const sg = participacao(pid); if (!sg.length) return toast('Esta conta não tem realizado por centro de custo para sugerir', true); pinta(Object.fromEntries(sg.map(x => [x.cc, x.pct]))); };
  const salvar = async (id, vals) => {
    await q(sb.from('orcamento_rateio_cc').delete().eq('empresa_id', state.empresa.id).eq('ano', D.ano).eq('plano_id', id));
    const rows = vals.filter(v => v.pct > 0).map(v => ({ empresa_id: state.empresa.id, ano: D.ano, plano_id: id, centro_custo_id: v.cc, pct: v.pct }));
    if (rows.length) await q(sb.from('orcamento_rateio_cc').insert(rows));
  };
  $('#rok', m.el).onclick = async () => {
    const vals = [...m.el.querySelectorAll('[data-cc]')].map(i => ({ cc: i.dataset.cc, pct: parseNum(i.value) || 0 }));
    const t = vals.reduce((s, v) => s + v.pct, 0);
    if (t > 100.01) return toast('A soma passa de 100%', true);
    if (t && Math.abs(t - 100) > 0.01 && !confirm(`A soma é ${t.toFixed(2).replace('.', ',')}%. O restante fica sem centro de custo. Salvar assim?`)) return;
    try { await salvar(pid, vals); toast('Rateio salvo'); await carregar(); pinta(); pintar(root); } catch (e) { fail(e); }
  };
  $('#rtodas', m.el) && ($('#rtodas', m.el).onclick = async () => {
    const comRat = new Set(D.rat.map(r => r.plano_id));
    const alvo = lista.filter(p => !comRat.has(p.id)).map(p => ({ p, sg: participacao(p.id) })).filter(x => x.sg.length);
    if (!alvo.length) return toast('Nenhuma conta sem rateio com realizado por centro de custo');
    if (!confirm(`Aplicar o rateio pela participação realizada até ${MESES_CURTO[ui.ref - 1]} em ${alvo.length} conta(s) que ainda não têm rateio? Dá para ajustar depois, conta a conta.`)) return;
    try { for (const a of alvo) await salvar(a.p.id, a.sg); toast(`Rateio aplicado em ${alvo.length} conta(s)`); await carregar(); pinta(); pintar(root); } catch (e) { fail(e); }
  });
}

// ---------------------------------------------------------------------------------------------
// Relatório de desvios em PDF (para a direção)
// ---------------------------------------------------------------------------------------------
async function pdfDesvios() {
  try {
    const { jsPDF } = window.jspdf; const c = state.cad;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const azul = [43, 85, 152], marinho = [42, 31, 111];
    const mesNome = MESES[ui.ref - 1][0] + MESES[ui.ref - 1].slice(1).toLowerCase();
    const logo = await logoPNG(); if (logo) doc.addImage(logo.data, 'PNG', 14, 8, 12 * logo.ratio, 12);
    doc.setTextColor(...marinho); doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text(`Controle orçamentário — ${mesNome}/${D.ano}`, W - 14, 13, { align: 'right' });
    doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90);
    doc.text(`${state.empresa.nome} · comparado com o ${ui.comp} · tolerância ${ui.tolPct}% ou ${money0(ui.tolVal)} · emitido em ${dateBR(new Date().toISOString())}`, W - 14, 18.5, { align: 'right' });
    doc.setDrawColor(...marinho); doc.setLineWidth(.6); doc.line(14, 23, W - 14, 23); doc.setTextColor(20);
    const todas = linhasConta(); const T = (tp) => totais(todas.filter(l => l.s.p.tipo === tp));
    const S = T('S'), E = T('E');
    doc.autoTable({ startY: 27, theme: 'grid', head: [['', `Orçado ${MESES_CURTO[ui.ref - 1]}`, `Realizado ${MESES_CURTO[ui.ref - 1]}`, 'Orçado acum.', 'Realizado acum.', 'Desvio acum.', 'Orçado ano', 'Em aberto', 'Projeção ano', 'Proj. − orçado']], headStyles: { fillColor: azul },
      body: [['Entradas', E], ['Saídas', S]].map(([n, t]) => [n, money0(t.orcMes), money0(t.realMes), money0(t.orcAc), money0(t.realAc), money0(t.realAc - t.orcAc), money0(t.orcAno), money0(t.compTot), money0(t.proj), money0(t.proj - t.orcAno)]),
      styles: { fontSize: 8.5, cellPadding: 1.6, halign: 'right' }, columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } }, margin: { left: 14, right: 14 } });
    const crit = todas.filter(l => ['vermelho', 'amarelo', 'sem'].includes(l.x.st) || l.x.justificar)
      .sort((a, b) => ({ vermelho: 0, sem: 1, amarelo: 2, verde: 3 }[a.x.st] - { vermelho: 0, sem: 1, amarelo: 2, verde: 3 }[b.x.st]) || b.x.dvAc - a.x.dvAc);
    doc.setFontSize(11); doc.setTextColor(...marinho); doc.text(`Contas com desvio (${crit.length})`, 14, doc.lastAutoTable.finalY + 8); doc.setTextColor(20);
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 10, theme: 'grid',
      head: [['Conta', 'Status', 'Desvio mês', 'Desvio acum.', 'Consumo', 'Proj. − orçado ano', 'Justificativa', 'Ação prevista']], headStyles: { fillColor: azul },
      body: crit.map(l => [`${l.s.p.codigo} ${l.s.p.nome}`, SEM[l.x.st]?.[0] || '', money0(l.x.realMes - l.x.orcMes), money0(l.x.realAc - l.x.orcAc), l.x.consumo == null ? '-' : pct(l.x.consumo, 0), money0(l.x.proj - l.x.orcAno),
        l.j?.justificativa || (l.x.justificar ? 'PENDENTE' : ''), l.j?.acao || '']),
      styles: { fontSize: 7.5, cellPadding: 1.3 }, columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 20 }, 2: { halign: 'right', cellWidth: 20 }, 3: { halign: 'right', cellWidth: 22 }, 4: { halign: 'right', cellWidth: 15 }, 5: { halign: 'right', cellWidth: 24 } },
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 6 && d.cell.raw === 'PENDENTE') { d.cell.styles.textColor = [200, 40, 40]; d.cell.styles.fontStyle = 'bold'; } },
      margin: { left: 14, right: 14 } });
    const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(130); doc.text(`Página ${i} de ${n}`, W - 14, H - 7, { align: 'right' }); }
    doc.save(`controle_orcamentario_${D.ano}_${String(ui.ref).padStart(2, '0')}.pdf`);
  } catch (e) { fail(e); }
}

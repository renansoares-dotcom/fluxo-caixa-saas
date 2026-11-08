// Comercial › Curva ABC, Mapa e Rotas (COM007) — melhoria 4.1 (SQL 129, 08/11/2026).
// Curva ABC dos clientes pelo faturamento das NF-e, mapa dos clientes por cidade (situação ou classe), visitas por rota
// (frequência pela classe, clientes esfriando, dias limitados por visitas e km) e os parâmetros comerciais.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money0, dateBR, today, fail, toast, modal, exportXLSX, chart, moneyTick, parseNum } from '../lib/ui.js';
import { baseComercial, limparBaseComercial, ST_CLI, interno, podeEditarCom, podeConfigCom } from '../lib/comercial.js';
import { CFG_PADRAO, ACOES, visitasDevidas, acaoSugerida, montarRota, diasUteis } from '../lib/comercial-geo.js';
import { VIEWBOX, UFS, CENTROS, proj } from '../lib/mapa-br.js';
import { badge } from '../lib/compras.js';

export const title = 'Curva ABC, Mapa e Rotas';
const ui = { aba: 'abc', rep: '', cor: 'situacao', uf: null, brasil: false, cidade: null, inicio: null, sel: null, rota: null };
let B = null, ORIG = null, VIS = {};
const COR_ST = { ativo: '#1f8a4c', novo: '#2f6fd6', esfriando: '#e08a00', inativo: '#c0352b', sem: '#8a94a6' };
const COR_ABC = { A: '#1f6f43', B: '#b7791f', C: '#8a94a6' };
const COR_DIA = ['#2f6fd6', '#e08a00', '#1f8a4c', '#8b3fd1', '#c0352b', '#0e9aa7', '#d14d8b', '#6b7a1f'];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Curva ABC, Mapa e Rotas</h2><div class="muted small">Quem são os clientes que fazem o faturamento, onde estão e qual a próxima visita.</div></div>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="mp-xls">Excel</button></div></div>
    <div class="card toolbar"><div class="chips" id="mp-abas">${[['abc', 'Curva ABC'], ['mapa', 'Mapa'], ['rotas', 'Visitas por rota'], ['par', 'Parâmetros']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><span id="mp-rep"></span></div>
    <div id="mp-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#mp-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; $$('#mp-abas .chip', root).forEach(c => c.classList.toggle('on', c.dataset.a === a)); pintar(root); } };
  $('#mp-xls', root).onclick = () => exportXLSX($('#mp-corpo table', root) || [['Sem tabela nesta aba']], 'comercial_' + ui.aba);
  try {
    B = await baseComercial(true);
    const e = state.empresa.id;
    const [O, V] = await Promise.all([q(sb.rpc('comercial_origem', { p_empresa: e })).catch(() => []),
      q(sb.from('comercial_interacoes').select('favorecido_id,data').eq('empresa_id', e).eq('tipo', 'visita').gte('data', new Date(Date.now() - 400 * 864e5).toISOString()).order('data', { ascending: false }).limit(5000)).catch(() => [])]);
    ORIG = O[0] || null; VIS = {}; for (const v of V) if (!VIS[v.favorecido_id]) VIS[v.favorecido_id] = v.data;
  } catch (err) { fail(err); $('#mp-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const reps = [...new Map(B.clientes.filter(c => c.representante_id).map(c => [c.representante_id, c.representante])).entries()];
  if (interno() && reps.length) {
    $('#mp-rep', root).innerHTML = `<label class="small">Representante <select id="mp-r"><option value="">Todos</option>${reps.map(([id, n]) => `<option value="${id}" ${ui.rep === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
    $('#mp-r', root).onchange = (e) => { ui.rep = e.target.value; ui.sel = null; ui.rota = null; pintar(root); };
  }
  pintar(root);
}

// clientes da carteira com a situação, a classe, o faturamento do período e a cidade
function clientes() {
  return B.clientes.filter(c => !ui.rep || c.representante_id === ui.rep).map(c => {
    const i = B.info[c.id] || { st: 'sem', v_abc: 0 }, g = B.geo[c.id] || {};
    return { id: c.id, nome: c.nome, rep: c.representante || '', st: i.st, classe: i.classe, valor: i.v_abc || 0, desde: i.desde, intervalo: i.intervalo, ultima: i.ultima,
      cod: g.cod_municipio, cidade: g.municipio || '', uf: g.uf || '', lat: g.lat != null ? +g.lat : null, lng: g.lng != null ? +g.lng : null, ultima_visita: VIS[c.id] || null };
  });
}
const abrirCliente = (id) => { state.abrir = { tipo: 'cliente', id }; location.hash = '#/comercial/carteira'; };

function pintar(root) {
  const c = $('#mp-corpo', root);
  if (ui.aba === 'abc') return abaAbc(c);
  if (ui.aba === 'mapa') return abaMapa(c, root);
  if (ui.aba === 'rotas') return abaRotas(c, root);
  return abaParametros(c, root);
}

// ---------------------------------------------------------------- curva ABC
function abaAbc(c) {
  const L = clientes(), cfg = B.cfg, tot = L.reduce((s, x) => s + x.valor, 0);
  const ord = L.filter(x => x.valor > 0).sort((a, b) => b.valor - a.valor);
  let ac = 0; const linhas = ord.map((x, i) => { ac += x.valor; return { ...x, rank: i + 1, pct: tot ? x.valor / tot : 0, acum: tot ? ac / tot : 0 }; });
  const res = ['A', 'B', 'C'].map(k => { const l = linhas.filter(x => x.classe === k); return { k, n: l.length, v: l.reduce((s, x) => s + x.valor, 0) }; });
  const semCompra = L.length - linhas.length;
  c.innerHTML = `<div class="kpis">${res.map(r => `<div class="kpi"><div class="k-label"><span class="abc abc-${r.k}">${r.k}</span> Classe ${r.k}</div><div class="k-value">${r.n} cliente(s)</div>
      <div class="k-sub">${money0(r.v)} · ${tot ? Math.round(r.v / tot * 100) : 0}% do faturamento · ${linhas.length ? Math.round(r.n / linhas.length * 100) : 0}% dos clientes</div></div>`).join('')}
      <div class="kpi"><div class="k-label">Sem compra no período</div><div class="k-value">${semCompra}</div><div class="k-sub">${cfg.abc_meses} meses · A até ${String(cfg.abc_a_pct).replace('.', ',')}%, B até ${String(cfg.abc_b_pct).replace('.', ',')}%</div></div></div>
    <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">Curva de Pareto</h3><div style="height:260px"><canvas id="mp-par"></canvas></div></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:60vh"><table><thead><tr><th class="num">#</th><th>Cliente</th><th>ABC</th><th>Situação</th><th>Cidade</th><th>Representante</th>
      <th class="num">Faturamento</th><th class="num">%</th><th class="num">% acumulado</th><th>Ação sugerida</th></tr></thead><tbody>
      ${linhas.map(x => { const a = acaoSugerida(x, today(), cfg); return `<tr class="clickable" data-c="${x.id}"><td class="num">${x.rank}</td><td class="wrap">${esc(x.nome)}</td><td><span class="abc abc-${x.classe}">${x.classe}</span></td>
        <td>${badge(ST_CLI, x.st)}</td><td>${esc(x.cidade ? `${x.cidade}/${x.uf}` : '')}</td><td>${esc(x.rep)}</td><td class="num">${money0(x.valor)}</td><td class="num">${(x.pct * 100).toFixed(1).replace('.', ',')}%</td>
        <td class="num">${(x.acum * 100).toFixed(1).replace('.', ',')}%</td><td class="small wrap">${a ? esc(a.texto) : ''}</td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">Nenhum faturamento no período.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-c]', c).forEach(tr => tr.onclick = () => abrirCliente(tr.dataset.c));
  const top = linhas.slice(0, 60);
  chart($('#mp-par', c), { type: 'bar', data: { labels: top.map(x => x.nome.slice(0, 18)), datasets: [
      { type: 'bar', label: 'Faturamento', data: top.map(x => x.valor), backgroundColor: top.map(x => COR_ABC[x.classe]), yAxisID: 'y' },
      { type: 'line', label: '% acumulado', data: top.map(x => +(x.acum * 100).toFixed(1)), borderColor: '#334155', pointRadius: 0, yAxisID: 'y2' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true } }, scales: { x: { ticks: { display: false } }, y: { ticks: { callback: moneyTick } }, y2: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: (v) => v + '%' } } } } });
}

// ---------------------------------------------------------------- mapa
function abaMapa(c, root) {
  const L = clientes(), com = L.filter(x => x.lat != null), sem = L.filter(x => x.lat == null);
  const porUf = {}; for (const x of L) if (x.uf) porUf[x.uf] = (porUf[x.uf] || 0) + x.valor;
  const maxUf = Math.max(1, ...Object.values(porUf));
  const cid = {}; for (const x of com) { const k = x.cod; (cid[k] ||= { cod: k, nome: x.cidade, uf: x.uf, lat: x.lat, lng: x.lng, valor: 0, cli: [] }); cid[k].valor += x.valor; cid[k].cli.push(x); }
  const C = Object.values(cid).sort((a, b) => b.valor - a.valor), maxC = Math.max(1, ...C.map(x => x.valor));
  const corCidade = (k) => {
    if (ui.cor === 'abc') { const cl = ['A', 'B', 'C'].find(z => k.cli.some(x => x.classe === z)); return COR_ABC[cl] || '#8a94a6'; }
    if (k.cli.some(x => ['A', 'B'].includes(x.classe) && ['esfriando', 'inativo'].includes(x.st))) return COR_ST.esfriando;
    if (k.cli.every(x => ['inativo', 'sem'].includes(x.st))) return COR_ST.inativo;
    return k.cli.some(x => ['ativo', 'novo'].includes(x.st)) ? COR_ST.ativo : COR_ST.sem;
  };
  // enquadramento: o estado escolhido, o Brasil inteiro ou (padrão) a região dos clientes
  let vb = VIEWBOX;
  if (!ui.uf && !ui.brasil && C.length) { const P = C.map(k => proj(k.lat, k.lng)), xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); const lado = Math.max(x1 - x0, y1 - y0, 220) * 1.25, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    vb = `${(cx - lado / 2).toFixed(0)} ${(cy - lado / 2).toFixed(0)} ${lado.toFixed(0)} ${lado.toFixed(0)}`; }
  c.innerHTML = `<div class="card toolbar"><label class="small">Cor das cidades <select id="mp-cor"><option value="situacao" ${ui.cor === 'situacao' ? 'selected' : ''}>Situação</option><option value="abc" ${ui.cor === 'abc' ? 'selected' : ''}>Curva ABC</option></select></label>
      <div class="mp-leg">${ui.cor === 'abc' ? Object.entries(COR_ABC).map(([k, v]) => `<span><i style="background:${v}"></i>tem cliente ${k}</span>`).join('')
        : `<span><i style="background:${COR_ST.ativo}"></i>clientes comprando</span><span><i style="background:${COR_ST.esfriando}"></i>cliente A ou B esfriando/inativo</span><span><i style="background:${COR_ST.inativo}"></i>só inativos</span>`}<span class="muted">círculo = faturamento da cidade</span></div>
      <span class="spacer"></span>${ui.uf || !ui.brasil ? `<button class="btn ghost small" id="mp-br">Brasil inteiro</button>` : `<button class="btn ghost small" id="mp-zc">Aproximar dos clientes</button>`}
      ${sem.length ? `<span class="small muted">${sem.length} cliente(s) sem cidade</span>${podeEditarCom() || interno() ? ' <button class="btn small" id="mp-loc">Localizar pela NF-e e cadastro</button>' : ''}` : ''}</div>
    <div class="mp-wrap" style="margin-top:12px"><div class="card" style="padding:8px"> <svg class="mp-svg" id="mp-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">
      ${Object.entries(UFS).map(([uf, d]) => `<path class="uf" data-uf="${uf}" d="${d}" fill="${porUf[uf] ? `rgba(47,111,214,${(0.12 + 0.55 * porUf[uf] / maxUf).toFixed(2)})` : '#e5e9f0'}"><title>${uf}: ${money0(porUf[uf] || 0)}</title></path>`).join('')}
      ${Object.entries(CENTROS).map(([uf, [x, y]]) => `<text class="uf-sig" x="${x}" y="${y}" text-anchor="middle">${uf}</text>`).join('')}
      ${C.slice().reverse().map(k => { const [x, y] = proj(k.lat, k.lng), r = 3 + 15 * Math.sqrt(k.valor / maxC);
        return `<circle class="cid ${ui.cidade === k.cod ? 'on' : ''}" data-cod="${k.cod}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${corCidade(k)}"><title>${esc(k.nome)}/${k.uf}: ${k.cli.length} cliente(s), ${money0(k.valor)}</title></circle>`; }).join('')}
    </svg></div><div class="card" id="mp-lado" style="max-height:72vh;overflow:auto"></div></div>`;
  const svg = $('#mp-svg', c);
  if (ui.uf) { const p = svg.querySelector(`path[data-uf="${ui.uf}"]`); if (p) { const b = p.getBBox(), m = Math.max(b.width, b.height) * 0.08; svg.setAttribute('viewBox', `${b.x - m} ${b.y - m} ${b.width + 2 * m} ${b.height + 2 * m}`); } }
  // círculos, rótulos e bordas na mesma escala da tela, qualquer que seja o enquadramento
  const k = svg.viewBox.baseVal.width / 773;
  svg.querySelectorAll('circle').forEach(ci => ci.setAttribute('r', (ci.getAttribute('r') * Math.max(0.25, k)).toFixed(2)));
  svg.querySelectorAll('text.uf-sig').forEach(t => t.style.fontSize = (11 * k).toFixed(2) + 'px');
  const lado = $('#mp-lado', c);
  const listaCid = (k) => { lado.innerHTML = `<h3 style="margin:0 0 4px">${esc(k.nome)}/${k.uf}</h3><div class="small muted">${k.cli.length} cliente(s) · ${money0(k.valor)}</div>
      ${k.cli.sort((a, b) => b.valor - a.valor).map(x => { const a = acaoSugerida(x, today(), B.cfg); return `<div style="padding:8px 0;border-bottom:1px solid var(--border)" class="clickable" data-c="${x.id}">
        ${x.classe ? `<span class="abc abc-${x.classe}">${x.classe}</span> ` : ''}<b>${esc(x.nome)}</b> ${badge(ST_CLI, x.st)}<div class="small muted">${money0(x.valor)}${x.ultima ? ` · última compra ${dateBR(x.ultima)}` : ''}${x.ultima_visita ? ` · visita ${dateBR(x.ultima_visita)}` : ''}</div>
        ${a ? `<div class="small">💡 ${esc(a.texto)}</div>` : ''}</div>`; }).join('')}`;
    $$('[data-c]', lado).forEach(d => d.onclick = () => abrirCliente(d.dataset.c)); };
  const resumo = () => { const ufs = Object.entries(porUf).sort((a, b) => b[1] - a[1]), tot = ufs.reduce((s, [, v]) => s + v, 0);
    lado.innerHTML = `<h3 style="margin:0 0 6px">Faturamento por estado</h3>${ufs.map(([uf, v]) => `<div class="clickable" data-uf2="${uf}" style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span><b>${uf}</b> · ${L.filter(x => x.uf === uf).length} cliente(s)</span><span>${money0(v)} <span class="muted small">${tot ? Math.round(v / tot * 100) : 0}%</span></span></div>`).join('') || '<div class="empty">Sem clientes localizados.</div>'}
      <h3 style="margin:14px 0 6px">Maiores cidades</h3>${C.slice(0, 12).map(k => `<div class="clickable" data-cod2="${k.cod}" style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)"><span>${esc(k.nome)}/${k.uf} <span class="muted small">${k.cli.length}</span></span><span>${money0(k.valor)}</span></div>`).join('')}
      <p class="small muted" style="margin-top:10px">Clique num estado para aproximar e numa cidade para ver os clientes.</p>`;
    $$('[data-uf2]', lado).forEach(d => d.onclick = () => { ui.uf = d.dataset.uf2; ui.brasil = false; ui.cidade = null; abaMapa(c, root); });
    $$('[data-cod2]', lado).forEach(d => d.onclick = () => { ui.cidade = +d.dataset.cod2; listaCid(cid[ui.cidade]); svg.querySelectorAll('circle').forEach(ci => ci.classList.toggle('on', +ci.dataset.cod === ui.cidade)); }); };
  ui.cidade && cid[ui.cidade] ? listaCid(cid[ui.cidade]) : resumo();
  svg.onclick = (e) => {
    const ci = e.target.closest('circle'); if (ci) { ui.cidade = +ci.dataset.cod; svg.querySelectorAll('circle').forEach(x => x.classList.toggle('on', x === ci)); return listaCid(cid[ui.cidade]); }
    const p = e.target.closest('path[data-uf]'); if (p) { ui.uf = p.dataset.uf; ui.cidade = null; abaMapa(c, root); }
  };
  $('#mp-cor', c).onchange = (e) => { ui.cor = e.target.value; abaMapa(c, root); };
  $('#mp-br', c) && ($('#mp-br', c).onclick = () => { ui.uf = null; ui.brasil = true; ui.cidade = null; abaMapa(c, root); });
  $('#mp-zc', c) && ($('#mp-zc', c).onclick = () => { ui.brasil = false; abaMapa(c, root); });
  $('#mp-loc', c) && ($('#mp-loc', c).onclick = async (ev) => { ev.target.disabled = true;
    try { const n = await q(sb.rpc('comercial_geo_preencher', { p_empresa: state.empresa.id })); toast(n ? `${n} cliente(s) localizado(s)` : 'Nenhum cliente novo localizado: confira a cidade e a UF no cadastro', !n); limparBaseComercial(); render(root); }
    catch (err) { fail(err); ev.target.disabled = false; } });
}

// ---------------------------------------------------------------- visitas por rota
function abaRotas(c, root) {
  const cfg = B.cfg, h = today(), L = clientes().filter(x => x.classe || ['esfriando', 'inativo'].includes(x.st));
  const dev = Object.fromEntries(visitasDevidas(L, h, cfg).map(x => [x.id, x]));
  const cand = L.filter(x => dev[x.id] || (['A', 'B'].includes(x.classe) && ['esfriando', 'inativo'].includes(x.st)))
    .sort((a, b) => (a.classe || 'Z').localeCompare(b.classe || 'Z') || b.valor - a.valor);
  if (!ui.sel) ui.sel = new Set(cand.filter(x => ['A', 'B'].includes(x.classe)).map(x => x.id));
  ui.inicio ||= diasUteis(h, 2)[1];
  const motivo = (x) => [dev[x.id] ? (x.ultima_visita ? `sem visita há ${dev[x.id].dias_sem_visita} d (a cada ${cfg['visita_dias_' + x.classe.toLowerCase()]})` : 'sem visita registrada') : '',
    ['esfriando', 'inativo'].includes(x.st) ? `${x.st} (${x.desde} d sem comprar)` : ''].filter(Boolean).join(' · ');
  c.innerHTML = `${!ORIG ? '<div class="pt-aviso card" style="margin-bottom:12px">Defina a cidade de saída das visitas em Parâmetros (ou o município da empresa no cadastro da empresa).</div>' : ''}
    <div class="card toolbar"><div class="small">Saída: <b>${ORIG ? `${esc(ORIG.nome)}/${ORIG.uf}` : '—'}</b> · clientes até ${cfg.raio_km} km · até ${cfg.visitas_por_dia} visitas e ${cfg.km_por_dia} km por dia (estrada ≈ linha reta × ${String(cfg.fator_estrada).replace('.', ',')})</div>
      <span class="spacer"></span><label class="small">Começar em <input type="date" id="rt-ini" value="${ui.inicio}"></label><button class="btn primary" id="rt-montar" ${ORIG ? '' : 'disabled'}>Montar rota (${ui.sel.size})</button></div>
    <div class="grid2" style="margin-top:12px;align-items:start">
      <div class="card flush"><div style="padding:12px 14px 0"><h3 style="margin:0">Quem visitar</h3><div class="small muted">Visita vencida pela frequência da classe (A ${cfg.visita_dias_a} d, B ${cfg.visita_dias_b} d, C ${cfg.visita_dias_c} d) e clientes A/B esfriando ou inativos.</div></div>
        <div class="table-wrap" style="max-height:62vh"><table class="small"><thead><tr><th><input type="checkbox" id="rt-todos"></th><th>Cliente</th><th>ABC</th><th>Por quê</th></tr></thead><tbody>
        ${cand.map(x => `<tr><td><input type="checkbox" data-s="${x.id}" ${ui.sel.has(x.id) ? 'checked' : ''}></td><td class="wrap">${esc(x.nome)}<div class="muted">${x.lat != null ? esc(`${x.cidade}/${x.uf}`) : '<span class="neg">sem cidade</span>'}</div></td><td>${x.classe ? `<span class="abc abc-${x.classe}">${x.classe}</span>` : ''}</td>
          <td class="wrap">${esc(motivo(x))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhuma visita pendente pelas regras.</td></tr>'}</tbody></table></div></div>
      <div id="rt-res">${ui.rota ? '' : '<div class="card"><div class="empty">Marque os clientes e clique em Montar rota.</div></div>'}</div></div>`;
  $$('[data-s]', c).forEach(ch => ch.onchange = () => { ch.checked ? ui.sel.add(ch.dataset.s) : ui.sel.delete(ch.dataset.s); ui.rota = null; $('#rt-montar', c).textContent = `Montar rota (${ui.sel.size})`; });
  $('#rt-todos', c).onchange = (e) => { cand.forEach(x => e.target.checked ? ui.sel.add(x.id) : ui.sel.delete(x.id)); ui.rota = null; abaRotas(c, root); };
  $('#rt-ini', c).onchange = (e) => { ui.inicio = e.target.value || h; if (ui.rota) mostrarRota(c, root); };
  $('#rt-montar', c).onclick = () => { ui.rota = montarRota({ lat: +ORIG.lat, lng: +ORIG.lng }, cand.filter(x => ui.sel.has(x.id)), cfg); mostrarRota(c, root); };
  if (ui.rota) mostrarRota(c, root);
}
function mostrarRota(c, root) {
  const R = ui.rota, datas = diasUteis(ui.inicio, R.dias.length), o = proj(+ORIG.lat, +ORIG.lng);
  const pts = R.dias.flatMap(d => d.paradas).map(p => proj(p.lat, p.lng)).concat([o]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), m = 12, x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m, w = Math.max(...xs) - x0 + m, hh = Math.max(...ys) - y0 + m;
  const esc2 = Math.max(w, hh) / 300;
  $('#rt-res', c).innerHTML = `<div class="card" style="padding:8px"><svg class="mp-svg" viewBox="${x0} ${y0} ${w} ${hh}" style="max-height:340px">
      ${Object.entries(UFS).map(([uf, d]) => `<path d="${d}" fill="#eef1f6" stroke="#fff" stroke-width="${(1.2 * esc2).toFixed(2)}"/>`).join('')}
      ${R.dias.map((d, i) => { const seq = [o, ...d.paradas.map(p => proj(p.lat, p.lng)), o]; return `<polyline points="${seq.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${COR_DIA[i % 8]}" stroke-width="${(2 * esc2).toFixed(2)}" stroke-linejoin="round"/>`
        + d.paradas.map(p => { const [x, y] = proj(p.lat, p.lng); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(4 * esc2).toFixed(2)}" fill="${COR_DIA[i % 8]}" stroke="#fff" stroke-width="${esc2.toFixed(2)}"><title>${esc(p.nome)} — ${esc(p.cidade)}</title></circle>`; }).join(''); }).join('')}
      <rect x="${(o[0] - 5 * esc2).toFixed(1)}" y="${(o[1] - 5 * esc2).toFixed(1)}" width="${(10 * esc2).toFixed(1)}" height="${(10 * esc2).toFixed(1)}" fill="#111"><title>Saída: ${esc(ORIG.nome)}</title></rect></svg></div>
    ${R.dias.map((d, i) => `<div class="card rt-dia" style="border-left-color:${COR_DIA[i % 8]};margin-top:10px"><div style="display:flex;justify-content:space-between"><b>Dia ${i + 1} — ${dateBR(datas[i])}</b><span class="small">${d.paradas.length} visita(s) · ~${d.km} km</span></div>
      <ol class="small" style="margin:6px 0 0 18px;padding:0">${d.paradas.map(p => `<li>${esc(p.nome)} <span class="muted">— ${esc(p.cidade)}/${p.uf}${p.km ? ` · ${p.km} km` : ''}</span></li>`).join('')}</ol><div class="small muted">volta: ${d.volta} km</div></div>`).join('')}
    ${R.foraRaio.length ? `<div class="card" style="margin-top:10px"><b>Longe demais para a rota (${R.foraRaio.length})</b> <span class="small muted">— mais de ${B.cfg.raio_km} km: contato à distância</span>
      ${R.foraRaio.map(x => `<div class="small" style="padding:4px 0">${esc(x.nome)} <span class="muted">— ${esc(x.cidade)}/${x.uf} · ~${x.dist} km</span>${podeEditarCom() ? ` <button class="btn ghost small" data-dist="${x.id}">Agendar ${esc(ACOES[B.cfg['acao_' + (x.classe || 'c').toLowerCase()] === 'visita' ? 'ligacao' : B.cfg['acao_' + (x.classe || 'c').toLowerCase()]] || 'Ligação')}</button>` : ''}</div>`).join('')}</div>` : ''}
    ${R.semLocal.length ? `<p class="small neg">Fora da rota (sem cidade): ${R.semLocal.map(x => esc(x.nome)).join(', ')}.</p>` : ''}
    ${podeEditarCom() ? `<div style="text-align:right;margin-top:8px"><button class="btn primary" id="rt-ag">Agendar as ${R.dias.reduce((s, d) => s + d.paradas.length, 0)} visitas</button></div>` : ''}`;
  $$('[data-dist]', c).forEach(b => b.onclick = async () => { const x = R.foraRaio.find(z => z.id === b.dataset.dist), tipo = B.cfg['acao_' + (x.classe || 'c').toLowerCase()] === 'visita' ? 'ligacao' : B.cfg['acao_' + (x.classe || 'c').toLowerCase()];
    b.disabled = true;
    try { await q(sb.from('comercial_interacoes').insert({ empresa_id: state.empresa.id, favorecido_id: x.id, tipo: 'anotacao', resumo: 'Contato à distância (fora do raio da rota)', proximo_contato: datas[0] || ui.inicio,
        proximo_assunto: `${ACOES[tipo]}: cliente a ~${x.dist} km` })); b.textContent = 'Agendado'; } catch (err) { fail(err); b.disabled = false; } });
  $('#rt-ag', c) && ($('#rt-ag', c).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const reg = R.dias.flatMap((d, i) => d.paradas.map((p, k) => ({ empresa_id: state.empresa.id, favorecido_id: p.id, tipo: 'anotacao', resumo: `Visita planejada pela rota de ${dateBR(datas[0])}`,
        proximo_contato: datas[i], proximo_assunto: `Visita — dia ${i + 1} da rota, ${k + 1}ª parada (${p.cidade}/${p.uf})` })));
      await q(sb.from('comercial_interacoes').insert(reg));
      toast(`${reg.length} visita(s) na Agenda de contatos`); ui.rota = null; ui.sel = null; limparBaseComercial(); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
}

// ---------------------------------------------------------------- parâmetros
function abaParametros(c, root) {
  const p = B.cfg, ed = podeConfigCom(), dis = ed ? '' : 'disabled', n = (v) => String(v ?? '').replace('.', ',');
  c.innerHTML = `<div class="card"><form id="cp"><h3 style="margin:0 0 8px">Curva ABC</h3><div class="grid-form">
      <label class="xs">Classe A até (% do faturamento)<input name="a" inputmode="decimal" value="${n(p.abc_a_pct)}" ${dis}></label>
      <label class="xs">Classe B até (%)<input name="b" inputmode="decimal" value="${n(p.abc_b_pct)}" ${dis}></label>
      <label class="xs">Período (meses)<input name="m" type="number" min="1" max="24" value="${p.abc_meses}" ${dis}></label></div>
    <h3 style="margin:14px 0 8px">Situação do cliente</h3><div class="grid-form">
      <label class="xs">Esfriando: sem comprar há mais de N× o intervalo normal<input name="ef" inputmode="decimal" value="${n(p.esfriando_fator)}" ${dis}></label>
      <label class="xs">…e no mínimo (dias)<input name="em" type="number" min="0" value="${p.esfriando_min_dias}" ${dis}></label>
      <label class="xs">Inativo depois de (dias)<input name="in" type="number" min="30" value="${p.inativo_dias}" ${dis}></label>
      <label class="xs">Novo: primeira compra há menos de (dias)<input name="no" type="number" min="1" value="${p.novo_dias}" ${dis}></label></div>
    <h3 style="margin:14px 0 8px">Ação sugerida e frequência de visita por classe</h3><div class="grid-form">
      ${['a', 'b', 'c'].map(k => `<label>Classe ${k.toUpperCase()}: ação<select name="ac_${k}" ${dis}>${Object.entries(ACOES).map(([v, t]) => `<option value="${v}" ${p['acao_' + k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="xs">Visitar a cada (dias)<input name="vi_${k}" type="number" min="1" max="730" value="${p['visita_dias_' + k]}" ${dis}></label>`).join('')}
      <label class="xs">Prazo para o contato (dias)<input name="pz" type="number" min="0" max="60" value="${p.prazo_acao_dias}" ${dis}></label></div>
    <h3 style="margin:14px 0 8px">Rotas de visita</h3><div class="grid-form">
      <label class="span2">Cidade de saída<input name="og" list="cp-cid" value="${ORIG ? esc(`${ORIG.nome}/${ORIG.uf}`) : ''}" placeholder="Digite a cidade (ex.: Caruaru/PE)" ${dis}><datalist id="cp-cid"></datalist></label>
      <label class="xs">Visitas por dia<input name="vd" type="number" min="1" max="20" value="${p.visitas_por_dia}" ${dis}></label>
      <label class="xs">Km por dia<input name="kd" type="number" min="20" max="2000" value="${p.km_por_dia}" ${dis}></label>
      <label class="xs">Fator da estrada<input name="fe" inputmode="decimal" value="${n(p.fator_estrada)}" ${dis}></label>
      <label class="xs">Raio da rota (km)<input name="rk" type="number" min="10" max="3000" value="${p.raio_km}" ${dis}></label></div>
    <p class="small muted">A cidade de cada cliente vem da última NF-e emitida para ele ou da cidade do cadastro. ${ed ? '' : 'Só administrador e diretor alteram os parâmetros.'}</p>
    ${ed ? '<div style="text-align:right"><button class="btn primary" type="button" id="cp-ok">Salvar parâmetros</button></div>' : ''}</form></div>`;
  const f = $('#cp', c); let cidades = [];
  f.og.oninput = async () => { const t = f.og.value.split('/')[0].trim(); if (t.length < 3) return;
    cidades = await q(sb.from('geo_municipios').select('codigo_ibge,nome,uf').ilike('nome', t + '%').order('nome').limit(20)).catch(() => []);
    $('#cp-cid', c).innerHTML = cidades.map(x => `<option value="${esc(`${x.nome}/${x.uf}`)}"></option>`).join(''); };
  $('#cp-ok', c) && ($('#cp-ok', c).onclick = async () => {
    const a = parseNum(f.a.value), b = parseNum(f.b.value);
    if (!(a > 0 && b > a && b <= 100)) return toast('A classe B precisa ir além da A (ex.: A 80%, B 95%)', true);
    let og = p.origem_cod_municipio ?? null;
    if (f.og.value.trim()) { const [nm, uf] = f.og.value.split('/').map(s => s.trim());
      const x = cidades.find(z => z.nome === nm && z.uf === uf) || (await q(sb.from('geo_municipios').select('codigo_ibge').eq('nome', nm).eq('uf', (uf || '').toUpperCase()).limit(1)).catch(() => []))[0];
      if (!x) return toast('Cidade de saída não encontrada: escolha na lista', true); og = x.codigo_ibge; } else og = null;
    const reg = { empresa_id: state.empresa.id, abc_a_pct: a, abc_b_pct: b, abc_meses: +f.m.value || 12, esfriando_fator: parseNum(f.ef.value) || 1.5, esfriando_min_dias: +f.em.value || 0,
      inativo_dias: +f.in.value || 180, novo_dias: +f.no.value || 90, acao_a: f.ac_a.value, acao_b: f.ac_b.value, acao_c: f.ac_c.value, visita_dias_a: +f.vi_a.value || 30,
      visita_dias_b: +f.vi_b.value || 60, visita_dias_c: +f.vi_c.value || 120, prazo_acao_dias: +f.pz.value || 0, origem_cod_municipio: og, visitas_por_dia: +f.vd.value || 5,
      km_por_dia: +f.kd.value || 300, fator_estrada: parseNum(f.fe.value) || 1.25, raio_km: +f.rk.value || 250, atualizado_em: new Date().toISOString() };
    try { await q(sb.from('comercial_config').upsert(reg)); toast('Parâmetros salvos'); limparBaseComercial(); ui.sel = null; ui.rota = null; render(root); } catch (err) { fail(err); }
  });
}

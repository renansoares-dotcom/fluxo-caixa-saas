// Recuperadora › Rendimento e Custo (REC005): rendimento das ordens concluídas no período, perdas por tipo, grão de cada fornecedor
// (atribuição proporcional), quanto custa o kg de grão vindo de cada um, preço equivalente pelo rendimento e economia contra a resina virgem.
import { sb, state, q } from '../lib/data.js';
import { $, esc, money, dateBR, today, chart, CORES, exportXLSX } from '../lib/ui.js';
import { carregarRec, kpi, kg0, rkg, semSQL, avisoSQL, desligada, avisoDesligada } from '../lib/rec-ui.js';
import { precoEquivalente, PERDAS, TIPOS_FORN } from '../lib/recuperadora.js';

export const title = 'Rendimento e Custo';
const mesIni = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const ui = { de: mesIni(), ate: today() };
const pctf = (v) => v == null ? '–' : (v * 100).toFixed(1).replace('.', ',') + '%';

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const R = await carregarRec();
    if (desligada(R)) { root.innerHTML = avisoDesligada(); return; }
    const D = await q(sb.rpc('rec_rendimento', { p_empresa: state.empresa.id, p_de: ui.de, p_ate: ui.ate }));
    const T = D.total, meta = (+D.meta_pct || 85) / 100, cor = (r) => r == null ? '' : r >= meta ? 'pos' : r >= meta - 0.1 ? 'neg warn' : 'neg';
    const F = D.fornecedores || [], comp = F.filter(f => f.fornecedor_id), mediaPes = comp.reduce((s, f) => s + +f.grao, 0) / (comp.reduce((s, f) => s + +f.pesado, 0) || 1);
    const eco = (D.grao || []).reduce((s, g) => s + (+g.economia || 0), 0), perdas = Object.fromEntries(Object.keys(PERDAS).map(k => [k, +(D.perdas || {})[k.replace('perda_', '')] || 0])), totPerda = Object.keys(PERDAS).reduce((s, k) => s + (+perdas[k] || 0), 0);
    root.innerHTML = `<div class="card toolbar"><label class="small">De <input type="date" id="rr-de" value="${ui.de}"></label><label class="small">Até <input type="date" id="rr-ate" value="${ui.ate}"></label>
        <span class="small muted">Ordens concluídas no período.</span><span class="spacer"></span><button class="btn" id="rr-x">Excel</button></div>
      <div class="kpis" style="margin-top:12px">${kpi('Rendimento', pctf(T.rendimento), `${kg0(T.saida)} de grão de ${kg0(T.entrada)} · meta ${pctf(meta)}`, cor(T.rendimento))}
        ${kpi('Custo do kg de grão', T.custo_kg == null ? '–' : rkg(T.custo_kg), `material ${rkg(+T.saida ? T.custo_material / T.saida : null)} · processo ${rkg(+T.saida ? T.custo_processo / T.saida : null)}`)}
        ${kpi('Economia contra a resina virgem', money(eco), (D.grao || []).some(g => g.virgem_kg == null) ? 'cadastre o preço da resina virgem nos parâmetros' : 'preço virgem − custo do grão', eco > 0 ? 'pos' : eco < 0 ? 'neg' : '')}
        ${kpi('Perdas apontadas', kg0(totPerda), Object.entries(PERDAS).filter(([k]) => +perdas[k]).map(([k, t]) => `${t.toLowerCase()} ${kg0(perdas[k])}`).join(' · ') || 'nenhuma etapa com perda')}</div>
      <div class="grid2" style="margin-top:12px;align-items:start">
        <div class="card"><h3 style="margin:0 0 8px">Rendimento por ordem</h3><div style="height:220px"><canvas id="rr-c"></canvas></div></div>
        <div class="card"><h3 style="margin:0 0 8px">Perdas por tipo (kg)</h3><div style="height:220px"><canvas id="rr-p"></canvas></div></div></div>
      <div class="card flush" style="margin-top:12px"><div style="padding:12px 12px 0"><h3 style="margin:0">Fornecedores: quanto paguei × quanto virou grão</h3></div><div class="table-wrap" id="rr-ft"><table><thead><tr><th>Fornecedor</th><th class="num">Pesado</th><th class="num">Grão</th>
        <th class="num">Rendimento s/ pesado</th><th class="num">Pago por kg pesado</th><th class="num">Material no kg de grão</th><th class="num">Preço equivalente</th></tr></thead><tbody>
        ${F.map(f => { const pe = f.fornecedor_id ? precoEquivalente(f, mediaPes) : null; return `<tr><td>${esc(f.fornecedor)}<div class="small muted">${esc(TIPOS_FORN[f.rec_tipo] || '')}</div></td><td class="num">${kg0(f.pesado)}</td><td class="num">${kg0(f.grao)}</td>
          <td class="num ${f.fornecedor_id ? cor(f.rendimento_pesado) : ''}"><b>${pctf(f.rendimento_pesado)}</b></td><td class="num">${rkg(f.preco_pago_kg)}</td><td class="num">${rkg(f.custo_grao_kg)}</td>
          <td class="num">${pe == null ? '–' : `${rkg(pe)}${+f.preco_pago_kg ? ` <span class="small ${pe < f.preco_pago_kg ? 'neg' : 'pos'}">${pe < f.preco_pago_kg ? '▼' : '▲'}</span>` : ''}`}</td></tr>`; }).join('')
          || '<tr><td colspan="7" class="empty">Nenhuma ordem concluída no período.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">Rendimento sobre o pesado = grão atribuído ÷ kg pesado na balança (inclui o desconto da classe e as perdas do processo). O grão de cada lote é o kg consumido × rendimento da ordem.
        Preço equivalente = preço pago × (rendimento do fornecedor ÷ média dos fornecedores, ${pctf(mediaPes)}): ▼ o fornecedor rende menos que a média e o preço justo é menor.</p>
      <div class="card flush" style="margin-top:12px"><div style="padding:12px 12px 0"><h3 style="margin:0">Grão produzido</h3></div><div class="table-wrap" id="rr-gt"><table><thead><tr><th>Grão</th><th class="num">Ordens</th><th class="num">Entrada</th><th class="num">Saída</th><th class="num">Rendimento</th>
        <th class="num">Material/kg</th><th class="num">Processo/kg</th><th class="num">Custo/kg</th><th class="num">Resina virgem/kg</th><th class="num">Economia</th></tr></thead><tbody>
        ${(D.grao || []).map(g => `<tr><td>${esc(g.material)}</td><td class="num">${g.ordens}</td><td class="num">${kg0(g.entrada)}</td><td class="num">${kg0(g.saida)}</td><td class="num ${cor(g.rendimento)}">${pctf(g.rendimento)}</td>
          <td class="num">${rkg(g.custo_material_kg)}</td><td class="num">${rkg(g.custo_processo_kg)}</td><td class="num"><b>${rkg(g.custo_kg)}</b></td><td class="num">${rkg(g.virgem_kg)}</td><td class="num ${+g.economia > 0 ? 'pos' : +g.economia < 0 ? 'neg' : ''}">${g.economia == null ? '–' : money(g.economia)}</td></tr>`).join('')
          || '<tr><td colspan="10" class="empty">Sem grão no período.</td></tr>'}</tbody></table></div></div>
      <div class="card flush" style="margin-top:12px"><div style="padding:12px 12px 0"><h3 style="margin:0">Material de entrada</h3></div><div class="table-wrap"><table><thead><tr><th>Material</th><th class="num">Consumido</th><th class="num">Grão atribuído</th><th class="num">Rendimento</th></tr></thead><tbody>
        ${(D.materiais || []).map(m => `<tr><td>${esc(m.material)} <span class="small muted">${m.tipo === 'apara' ? 'apara interna' : m.tipo === 'grao' ? 'grão reprocessado' : ''}</span></td><td class="num">${kg0(m.consumido)}</td><td class="num">${kg0(m.grao)}</td><td class="num ${cor(m.rendimento)}">${pctf(m.rendimento)}</td></tr>`).join('')
          || '<tr><td colspan="4" class="empty">—</td></tr>'}</tbody></table></div></div>`;
    $('#rr-de', root).onchange = (ev) => { ui.de = ev.target.value || mesIni(); render(root); };
    $('#rr-ate', root).onchange = (ev) => { ui.ate = ev.target.value || today(); render(root); };
    $('#rr-x', root).onclick = () => exportXLSX($('#rr-ft table', root), `rendimento_fornecedores_${ui.de}_${ui.ate}`);
    const O = [...(D.ordens || [])].reverse();
    chart($('#rr-c', root), { type: 'bar', data: { labels: O.map(o => `${o.numero} · ${dateBR(o.data).slice(0, 5)}`), datasets: [
      { type: 'line', label: 'Meta', data: O.map(() => meta * 100), borderColor: CORES[1], borderDash: [5, 4], pointRadius: 0 },
      { label: 'Rendimento (%)', data: O.map(o => Math.round(+o.rendimento * 1000) / 10), backgroundColor: O.map(o => +o.rendimento >= meta ? CORES[3] : CORES[7]) }] },
      options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100 }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } } });
    chart($('#rr-p', root), { type: 'bar', data: { labels: Object.values(PERDAS), datasets: [{ label: 'kg', data: Object.keys(PERDAS).map(k => +perdas[k] || 0), backgroundColor: CORES[4] }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => (+v).toLocaleString('pt-BR') } } } } });
  } catch (err) { root.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

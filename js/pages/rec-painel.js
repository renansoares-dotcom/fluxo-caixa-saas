// Recuperadora › Painel (REC001): o mês em números — material comprado e pago, valor e preço médio, apara interna recebida,
// entradas por dia, por material (com o saldo em lotes) e por fornecedor (desconto e preço médio), tickets abertos, a pagar e adiantamentos.
import { sb, state, q } from '../lib/data.js';
import { $, esc, money, toast, chart, CORES, exportXLSX } from '../lib/ui.js';
import { carregarRec, kpi, kg0, rkg, semSQL, avisoSQL, desligada, avisoDesligada } from '../lib/rec-ui.js';
import { TIPOS_FORN, MODOS } from '../lib/recuperadora.js';

export const title = 'Painel da Recuperadora';
const h = new Date();
const ui = { mes: `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}` };

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const R = await carregarRec();
    if (desligada(R)) { root.innerHTML = avisoDesligada(); return; }
    const P = await q(sb.rpc('rec_painel', { p_empresa: state.empresa.id, p_mes: ui.mes + '-01' }));
    const compra = R.cfg.modo !== 'interno', apara = R.cfg.modo !== 'externo';
    const desc = +P.comprado_kg ? 1 - +P.pago_kg / +P.comprado_kg : null;
    root.innerHTML = `<div class="card toolbar"><label class="small">Mês <input type="month" id="rpn-m" value="${ui.mes}"></label><span class="small muted">Modo: ${esc(MODOS[R.cfg.modo])}</span><span class="spacer"></span>
        <a class="btn" href="#/recuperadora/entradas">Entradas e Balança</a><a class="btn" href="#/recuperadora/lotes">Lotes da Recuperadora</a></div>
      <div class="kpis" style="margin-top:12px">
        ${compra ? kpi('Material comprado', kg0(P.comprado_kg), `${P.tickets} ticket(s) fechado(s)`) + kpi('Peso pago', kg0(P.pago_kg), desc == null ? '' : `desconto médio ${(desc * 100).toFixed(1).replace('.', ',')}%`)
          + kpi('Valor das compras', money(P.valor), +P.pago_kg ? `${rkg(P.valor / P.pago_kg)} por kg pago` : '') : ''}
        ${apara ? kpi('Apara interna recebida', kg0(P.apara_kg), +P.aparas_sem_material ? `${P.aparas_sem_material} apontamento(s) sem material` : 'dos apontamentos encerrados', +P.aparas_sem_material ? 'warn' : '') : ''}
        ${+P.outras_entradas_kg ? kpi('Doações e transferências', kg0(P.outras_entradas_kg)) : ''}
        ${kpi('Tickets abertos', P.tickets_abertos, 'aguardando fechamento', +P.tickets_abertos ? 'warn' : '')}
        ${compra ? kpi('A pagar a fornecedores', money(P.a_pagar), `adiantamentos em aberto ${money(P.adiant_saldo)}`) : ''}</div>
      ${+P.aparas_sem_material ? `<div class="card" style="margin-top:12px;border-left:4px solid var(--warn,#c80)"><p class="small" style="margin:0">Há apontamentos com refugo no mês que não viraram lote: falta o material padrão da apara ou uma regra. Ajuste em <a href="#/recuperadora/parametros">Parâmetros da Recuperadora</a> e use "Refazer as aparas".</p></div>` : ''}
      <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">Entradas por dia (kg)</h3><div style="height:220px"><canvas id="rpn-c"></canvas></div></div>
      <div class="grid2" style="margin-top:12px;align-items:start">
        <div class="card flush"><div style="padding:12px 12px 0"><h3 style="margin:0">Por material</h3></div><div class="table-wrap" id="rpn-mt"><table><thead><tr><th>Material</th>${compra ? '<th class="num">Comprado</th><th class="num">Valor</th>' : ''}${apara ? '<th class="num">Apara</th>' : ''}<th class="num">Saldo em lotes</th></tr></thead><tbody>
          ${(P.por_material || []).map(m => `<tr><td>${esc(m.material)}</td>${compra ? `<td class="num">${kg0(m.kg)}</td><td class="num">${money(m.valor)}</td>` : ''}${apara ? `<td class="num">${kg0(m.apara_kg)}</td>` : ''}<td class="num"><b>${kg0(m.estoque_kg)}</b></td></tr>`).join('')
            || '<tr><td colspan="5" class="empty">Sem movimento no mês.</td></tr>'}</tbody></table></div></div>
        ${compra ? `<div class="card flush"><div style="padding:12px 12px 0"><h3 style="margin:0">Fornecedores do mês</h3></div><div class="table-wrap" id="rpn-ft"><table><thead><tr><th>Fornecedor</th><th class="num">Pesado</th><th class="num">Desconto</th><th class="num">R$/kg pago</th><th class="num">Valor</th></tr></thead><tbody>
          ${(P.fornecedores || []).map(f => `<tr><td>${esc(f.fornecedor)}<div class="small muted">${esc(TIPOS_FORN[f.rec_tipo] || '')} · ${f.tickets} ticket(s)</div></td><td class="num">${kg0(f.kg)}</td>
            <td class="num">${f.desconto_pct == null ? '–' : String(f.desconto_pct).replace('.', ',') + '%'}</td><td class="num">${rkg(f.preco_medio)}</td><td class="num">${money(f.valor)}</td></tr>`).join('')
            || '<tr><td colspan="5" class="empty">Nenhuma compra no mês.</td></tr>'}</tbody></table></div></div>` : ''}</div>
      <p class="small muted">O rendimento por fornecedor (quanto paguei × quanto virou grão), o custo do kg de grão e a economia contra a resina virgem entram com o processamento (parte 2 da Recuperadora).</p>`;
    $('#rpn-m', root).onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; render(root); } };
    const D = P.dias || [];
    chart($('#rpn-c', root), { type: 'bar', data: { labels: D.map(d => d.dia.slice(8, 10)), datasets: [
      ...(compra ? [{ label: 'Compra', data: D.map(d => +d.compra_kg), backgroundColor: CORES[0], stack: 's' }] : []),
      ...(apara ? [{ label: 'Apara interna', data: D.map(d => +d.apara_kg), backgroundColor: CORES[3], stack: 's' }] : [])] },
      options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (v) => (+v).toLocaleString('pt-BR') } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${kg0(c.raw)}` } } } } });
  } catch (err) { root.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

// Recuperadora › Créditos Fiscais (REC010): crédito presumido de CBS e IBS na compra de coletor incentivado (LC 214/2025, art. 170)
// e crédito de PIS/COFINS na compra de pessoa jurídica, pelo percentual vigente na data de cada ticket, com a fonte; parâmetros por vigência.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, toast, fail, modal, parseNum, confirmDialog, exportXLSX, MESES_CURTO } from '../lib/ui.js';
import { carregarRec, podeConfig, kpi, semSQL, avisoSQL, desligada, avisoDesligada } from '../lib/rec-ui.js';
import { TIPOS_FORN } from '../lib/recuperadora.js';

export const title = 'Créditos Fiscais da Recuperadora';
const ui = { de: `${new Date().getFullYear()}-01-01`, ate: today() };
const pc = (v) => String(+v).replace('.', ',') + '%';

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const R = await carregarRec();
    if (desligada(R)) { root.innerHTML = avisoDesligada(); return; }
    const e = state.empresa.id, pode = podeConfig();
    const [F, P] = await Promise.all([q(sb.rpc('rec_fiscal', { p_empresa: e, p_de: ui.de, p_ate: ui.ate })), q(sb.from('rec_fiscal_param').select('*').eq('empresa_id', e).order('vigencia', { ascending: false }))]);
    const T = F.total;
    root.innerHTML = `<div class="card toolbar"><label class="small">De <input type="date" id="fc-de" value="${ui.de}"></label><label class="small">Até <input type="date" id="fc-ate" value="${ui.ate}"></label>
        <span class="small muted">Compras fechadas na balança, pelo percentual vigente na data de cada ticket.</span><span class="spacer"></span><button class="btn" id="fc-x">Excel</button></div>
      ${+T.sem_parametro ? `<div class="card" style="margin-top:12px;border-left:4px solid var(--warn,#c80)"><p class="small" style="margin:0">${T.sem_parametro} compra(s) sem percentual vigente na data: cadastre os parâmetros abaixo (com a fonte) ou use "Carregar os percentuais da LC 214/2025".</p></div>` : ''}
      <div class="kpis" style="margin-top:12px">${kpi('Compras no período', money(T.compras), `coletor incentivado ${money(T.coletor)} · pessoa jurídica ${money(T.pj)}${+T.outros ? ' · outros ' + money(T.outros) : ''}`)}
        ${kpi('Crédito presumido de CBS', money(T.cbs), 'compra de coletor incentivado')}${kpi('Crédito presumido de IBS', money(T.ibs), 'compra de coletor incentivado')}
        ${kpi('Crédito de PIS/COFINS', money(T.pis_cofins), 'compra de pessoa jurídica')}</div>
      <div class="card flush" style="margin-top:12px"><div style="padding:12px 12px 0"><h3 style="margin:0">Por fornecedor</h3></div><div class="table-wrap" id="fc-t" style="max-height:45vh"><table><thead><tr><th>Fornecedor</th><th>Enquadramento</th><th class="num">Tickets</th><th class="num">Compras</th><th class="num">CBS</th><th class="num">IBS</th><th class="num">PIS/COFINS</th></tr></thead><tbody>
        ${(F.fornecedores || []).map(f => `<tr><td>${esc(f.fornecedor)}<div class="small muted">${esc(f.documento || 'sem documento')} · ${esc(TIPOS_FORN[f.rec_tipo] || '')}</div></td>
          <td>${f.coletor ? '<span class="badge pago">coletor incentivado</span>' : f.pj ? '<span class="badge">pessoa jurídica</span>' : '<span class="badge negoc">sem crédito</span>'}</td>
          <td class="num">${f.tickets}</td><td class="num">${money(f.valor)}</td><td class="num">${money(f.cbs)}</td><td class="num">${money(f.ibs)}</td><td class="num">${money(f.pis_cofins)}</td></tr>`).join('')
          || '<tr><td colspan="7" class="empty">Nenhuma compra no período.</td></tr>'}</tbody></table></div></div>
      <div class="card flush" style="margin-top:12px"><div style="padding:12px 12px 0"><h3 style="margin:0">Por mês</h3></div><div class="table-wrap"><table><thead><tr><th>Mês</th><th class="num">Compras</th><th class="num">CBS</th><th class="num">IBS</th><th class="num">PIS/COFINS</th><th>Fonte</th></tr></thead><tbody>
        ${(F.meses || []).map(m => `<tr><td>${MESES_CURTO[+m.mes.slice(5, 7) - 1]}/${m.mes.slice(0, 4)}</td><td class="num">${money(m.valor)}</td><td class="num">${money(m.cbs)}</td><td class="num">${money(m.ibs)}</td><td class="num">${money(m.pis_cofins)}</td><td class="small">${esc(m.fonte || '—')}</td></tr>`).join('')
          || '<tr><td colspan="6" class="empty">—</td></tr>'}</tbody></table></div></div>
      <div class="card flush" style="margin-top:12px"><div class="toolbar" style="padding:12px"><h3 style="margin:0">Parâmetros por vigência</h3><span class="spacer"></span>
        ${pode ? '<button class="btn" id="fc-lc">Carregar os percentuais da LC 214/2025</button><button class="btn primary" id="fc-n">+ Vigência</button>' : ''}</div><div class="table-wrap"><table><thead><tr><th>A partir de</th><th class="num">CBS presumido</th><th class="num">IBS presumido</th><th class="num">PIS/COFINS (PJ)</th><th>Fonte</th><th></th></tr></thead><tbody>
        ${P.map(p => `<tr class="${pode ? 'clickable' : ''}" data-id="${p.id}"><td>${dateBR(p.vigencia)}</td><td class="num">${pc(p.cbs_presumido_pct)}</td><td class="num">${pc(p.ibs_presumido_pct)}</td><td class="num">${pc(p.pis_cofins_pct)}</td><td class="small">${esc(p.fonte)}</td>
          <td>${pode ? `<button class="btn ghost sm" data-del="${p.id}">Excluir</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sem parâmetros: nenhum crédito é calculado.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">Coletor incentivado (LC 214/2025, art. 170): pessoa física que coleta ou faz a triagem de resíduos e associação ou cooperativa de catadores, marcados em Entradas e Balança › Fornecedores; o crédito presumido vale para quem está no regime regular do IBS e da CBS. PIS/COFINS: crédito no regime não cumulativo na compra de pessoa jurídica (Tema 304 do STF), informe o percentual só se a empresa apura assim. Os percentuais carregados da LC 214/2025 são o ponto de partida: confira com a contabilidade antes de usar na apuração. Estes valores são estimativas para o planejamento; a apuração oficial é feita no sistema fiscal.</p>`;
    $('#fc-de', root).onchange = (ev) => { ui.de = ev.target.value || ui.de; render(root); };
    $('#fc-ate', root).onchange = (ev) => { ui.ate = ev.target.value || today(); render(root); };
    $('#fc-x', root).onclick = () => exportXLSX($('#fc-t table', root), `creditos_recuperadora_${ui.de}_${ui.ate}`);
    $('#fc-lc', root) && ($('#fc-lc', root).onclick = async () => { if (!await confirmDialog('Carregar as vigências de 2027 a 2033 com o crédito presumido da LC 214/2025, art. 170 (CBS 7%; IBS 1,3% em 2029 subindo até 13% em 2033)? As vigências que já existem não mudam.')) return;
      try { const n = await q(sb.rpc('rec_fiscal_carregar_lc214', { p_empresa: e })); toast(`${n} vigência(s) carregada(s)`); render(root); } catch (err) { fail(err); } });
    const abrir = (p = {}) => {
      const md = modal({ title: p.id ? 'Editar vigência' : 'Nova vigência', body: `<form id="pf" class="grid2"><label>A partir de *<input type="date" name="v" value="${p.vigencia || today()}" required></label><span></span>
          <label>CBS presumido (%)<input name="c" inputmode="decimal" value="${p.id ? String(p.cbs_presumido_pct).replace('.', ',') : '0'}"></label><label>IBS presumido (%)<input name="i" inputmode="decimal" value="${p.id ? String(p.ibs_presumido_pct).replace('.', ',') : '0'}"></label>
          <label>PIS/COFINS na compra de PJ (%)<input name="p" inputmode="decimal" value="${p.id ? String(p.pis_cofins_pct).replace('.', ',') : '0'}"><span class="small muted">ex.: 9,25 no não cumulativo; 0 se não credita</span></label><span></span>
          <label class="span2">Fonte *<input name="f" required value="${esc(p.fonte || '')}" placeholder="lei, artigo, orientação da contabilidade"></label></form>`,
        foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-ok">Salvar</button>' });
      $('#pf-ok', md.el).onclick = async () => { const f = $('#pf', md.el); if (!f.reportValidity()) return;
        const v = { empresa_id: e, vigencia: f.v.value, cbs_presumido_pct: parseNum(f.c.value) || 0, ibs_presumido_pct: parseNum(f.i.value) || 0, pis_cofins_pct: parseNum(f.p.value) || 0, fonte: f.f.value.trim() };
        try { await q(p.id ? sb.from('rec_fiscal_param').update(v).eq('id', p.id) : sb.from('rec_fiscal_param').insert(v)); md.close(); render(root); }
        catch (err) { fail(/unique|duplicate/.test(err.message) ? new Error('Já existe vigência nesta data.') : err); } };
    };
    $('#fc-n', root) && ($('#fc-n', root).onclick = () => abrir());
    $$('tr[data-id]', root).forEach(tr => tr.onclick = (ev) => { if (ev.target.closest('[data-del]') || !pode) return; abrir(P.find(p => p.id === tr.dataset.id)); });
    $$('[data-del]', root).forEach(b => b.onclick = async () => { if (!await confirmDialog('Excluir esta vigência?')) return; try { await q(sb.from('rec_fiscal_param').delete().eq('id', b.dataset.del)); render(root); } catch (err) { fail(err); } });
  } catch (err) { root.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

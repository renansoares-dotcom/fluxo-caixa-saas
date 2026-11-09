// CPD › Fiscal › Apuração de Impostos — etapa 2 (melhoria 9.2): imposto a recolher do mês e parâmetros (PRODEPE, FEEF, AD/DIPER, FECEP, PIS/COFINS).
import { sb, state, q, isAdmin } from './data.js';
import { $, $$, esc, money, dateBR, fail, toast, modal, loading, exportXLSX, MESES_CURTO } from './ui.js';
import { apurar, paramDoMes, pendencias, lerLista } from './apuracao.js';

const mesBR = (m) => `${MESES_CURTO[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}`;
const antMes = (m) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 2, 1)); return d.toISOString().slice(0, 7); };
const pctBR = (v) => (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 }) + '%';
const AJ = [['icms_saldo_credor_ant', 'ICMS — saldo credor do mês anterior'], ['icms_outros_debitos', 'ICMS — outros débitos'], ['icms_estorno_creditos', 'ICMS — estornos de créditos'],
  ['icms_outros_creditos', 'ICMS — outros créditos'], ['icms_estorno_debitos', 'ICMS — estornos de débitos'], ['ipi_saldo_credor_ant', 'IPI — saldo credor do mês anterior'],
  ['pc_saldo_credor_ant', 'PIS/COFINS — saldo credor anterior'], ['pc_outros_creditos', 'PIS/COFINS — outros créditos (energia, aluguéis, depreciação…)']];
let PARAMS = null;

export async function carregarParams(force = false) {
  if (PARAMS && !force && PARAMS.emp === state.empresa.id) return PARAMS.l;
  let l = []; try { l = await q(sb.from('fisc_param').select('*').eq('empresa_id', state.empresa.id).order('vigencia_inicio', { ascending: false })); } catch { l = null; }
  PARAMS = { emp: state.empresa.id, l }; return l;
}

// ------------------------------------------------------------------ imposto a recolher do mês
export async function pintarApuracao(c, mes, itens, regime) {
  loading(c);
  const L = await carregarParams(true);
  if (L === null) { c.innerHTML = '<div class="card"><div class="empty">Esta aba precisa do SQL 141.</div></div>'; return; }
  let A, Ant;
  try {
    [A, Ant] = await Promise.all([
      q(sb.from('fisc_apuracoes').select('*').eq('empresa_id', state.empresa.id).eq('mes', mes + '-01')).then(r => r[0] || null),
      q(sb.from('fisc_apuracoes').select('situacao,resultado').eq('empresa_id', state.empresa.id).eq('mes', antMes(mes) + '-01')).then(r => r[0] || null)]);
  } catch (e) { fail(e); c.innerHTML = ''; return; }
  const p = paramDoMes(L, mes), fechada = A?.situacao === 'fechada', grava = ['admin', 'financeiro'].includes(state.papel);
  // sem apuração gravada: o saldo credor vem do fechamento do mês anterior
  const aj = A || { icms_saldo_credor_ant: Ant?.resultado?.icms?.saldoCredor || 0, ipi_saldo_credor_ant: Ant?.resultado?.ipi?.saldoCredor || 0, pc_saldo_credor_ant: Ant?.resultado?.pc?.saldoCredor || 0 };
  const R = fechada && A.resultado ? A.resultado : apurar(itens, p, aj), pend = fechada ? [] : pendencias(R, p, itens);
  const I = R.icms, P = R.pc, l = (t, v, cls = '', nota = '') => `<tr class="${cls}"><td>${t}${nota ? `<div class="small muted">${nota}</div>` : ''}</td><td class="num">${v == null ? '' : money(v)}</td></tr>`;
  c.innerHTML = `
    ${regime && regime.regime !== 'real' ? `<div class="card" style="border-left:4px solid var(--warn,#c80)"><p class="small" style="margin:0">Esta apuração é de débito e crédito (Lucro Real). O regime no mês é <strong>${esc(regime.regime)}</strong>: confira com a contabilidade antes de usar.</p></div>` : ''}
    <div class="kpis" style="margin:0 0 12px">
      <div class="kpi"><div class="k-label">ICMS a recolher</div><div class="k-value">${money(I.recolher)}</div><div class="k-sub">${I.saldoCredor ? `saldo credor ${money(I.saldoCredor)}` : I.creditoPresumido ? `após ${money(I.creditoPresumido)} de crédito presumido` : 'sem incentivo no mês'}</div></div>
      <div class="kpi"><div class="k-label">FEEF + AD/DIPER + FECEP</div><div class="k-value">${money(I.feef + I.adDiper + I.fecep)}</div><div class="k-sub">guias à parte</div></div>
      <div class="kpi"><div class="k-label">IPI a recolher</div><div class="k-value">${money(R.ipi.recolher)}</div><div class="k-sub">${R.ipi.saldoCredor ? `saldo credor ${money(R.ipi.saldoCredor)}` : '&nbsp;'}</div></div>
      <div class="kpi"><div class="k-label">PIS + COFINS a recolher</div><div class="k-value">${money(P.recolher)}</div><div class="k-sub">PIS ${money(P.pis)} · COFINS ${money(P.cofins)}</div></div>
      <div class="kpi"><div class="k-label">Apuração de ${mesBR(mes)}</div><div class="k-value" style="font-size:16px">${fechada ? '<span class="pos">fechada</span>' : 'aberta'}</div><div class="k-sub">${fechada ? `em ${dateBR(A.fechada_em)}` : p ? `parâmetros de ${dateBR(p.vigencia_inicio)}` : '<span class="neg">sem parâmetros</span>'}</div></div></div>
    ${pend.length ? `<div class="card" style="border-left:4px solid var(--warn,#c80);margin-bottom:12px"><b class="small">Antes de fechar</b><ul class="small" style="margin:4px 0 0">${pend.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="grid2" id="ap-tabs" style="align-items:start">
      <div class="card flush"><div class="card-head" style="padding:12px 12px 0"><h2>ICMS</h2></div><div class="table-wrap"><table><tbody>
        ${l('Débitos das saídas', I.debitos)}${I.outrosDebitos ? l('(+) Outros débitos', I.outrosDebitos) : ''}${I.estornoCreditos ? l('(+) Estornos de créditos', I.estornoCreditos) : ''}${I.estornoDebitos ? l('(−) Estornos de débitos', -I.estornoDebitos) : ''}
        ${l('(−) Devoluções de clientes', -I.devolucoes)}${l('(−) Créditos das compras', -I.creditos)}${I.outrosCreditos ? l('(−) Outros créditos', -I.outrosCreditos) : ''}${I.saldoCredorAnt ? l('(−) Saldo credor do mês anterior', -I.saldoCredorAnt) : ''}
        ${l(I.saldoCredor ? 'Saldo credor para o próximo mês' : 'Saldo devedor', I.saldoCredor || I.saldoDevedor, 'row-sec')}
        ${I.creditoPresumido ? `${l('Débito das saídas incentivadas', I.debIncentivado, '', `${(I.proporcao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do débito`)}${l('Saldo incentivado', I.saldoIncentivado)}
          ${l(`(−) Crédito presumido PRODEPE (${pctBR(p?.prodepe_credito_pct)})`, -I.creditoPresumido)}` : ''}
        ${l('ICMS a recolher', I.recolher, 'row-sec')}
        ${I.feef ? l(`FEEF (${pctBR(p?.feef_pct)} ${p?.feef_base === 'saldo_incentivado' ? 'do saldo incentivado' : 'do benefício'})`, I.feef) : ''}${I.adDiper ? l(`Taxa AD/DIPER (${pctBR(p?.ad_diper_pct)} do benefício)`, I.adDiper) : ''}
        ${I.fecep ? l(`FECEP (${pctBR(p?.fecep_pct)} sobre ${money(I.baseFecep)})`, I.fecep, '', `${I.itensFecep} item(ns) com NCM sujeito`) : ''}
        ${l('Total das guias de ICMS', I.totalGuias, 'row-sec')}</tbody></table></div></div>
      <div>
        <div class="card flush"><div class="card-head" style="padding:12px 12px 0"><h2>IPI</h2></div><div class="table-wrap"><table><tbody>
          ${l('Débitos das saídas', R.ipi.debitos)}${l('(−) Devoluções de clientes', -R.ipi.devolucoes)}${l('(−) Créditos das compras', -R.ipi.creditos)}${R.ipi.saldoCredorAnt ? l('(−) Saldo credor anterior', -R.ipi.saldoCredorAnt) : ''}
          ${l(R.ipi.saldoCredor ? 'Saldo credor' : 'IPI a recolher', R.ipi.saldoCredor || R.ipi.recolher, 'row-sec')}</tbody></table></div></div>
        <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><h2>PIS / COFINS (não cumulativo)</h2></div><div class="table-wrap"><table><tbody>
          ${l('Débitos destacados nas saídas', P.debitos)}${l('(−) Devoluções de clientes', -P.devolucoes)}
          ${l(`(−) Crédito de PIS (${pctBR(p?.pis_pct)})`, -P.creditoPis, '', `base ${money(P.baseCredito)} em ${P.itensCredito} item(ns) de compra`)}${l(`(−) Crédito de COFINS (${pctBR(p?.cofins_pct)})`, -P.creditoCofins)}
          ${P.outrosCreditos ? l('(−) Outros créditos', -P.outrosCreditos) : ''}${P.saldoCredorAnt ? l('(−) Saldo credor anterior', -P.saldoCredorAnt) : ''}
          ${l(P.saldoCredor ? 'Saldo credor' : 'PIS + COFINS a recolher', P.saldoCredor || P.recolher, 'row-sec')}</tbody></table></div></div>
      </div></div>
    <div class="card" style="margin-top:12px"><h2>Ajustes do mês</h2>
      <div class="grid2" id="ap-aj">${AJ.map(([k, t]) => `<label>${t}<input type="number" step="0.01" data-aj="${k}" value="${+aj[k] || 0}" ${fechada || !grava ? 'disabled' : ''}></label>`).join('')}</div>
      <label>Observação<textarea id="ap-obs" rows="2" ${fechada || !grava ? 'disabled' : ''}>${esc(A?.observacao || '')}</textarea></label>
      <div class="toolbar" style="margin:8px 0 0"><button class="btn" id="ap-xls">Exportar Excel</button><span class="spacer"></span>
        ${fechada ? (isAdmin() ? '<button class="btn" id="ap-reab">Reabrir</button>' : '') : grava ? '<button class="btn" id="ap-salv">Salvar ajustes</button> <button class="btn primary" id="ap-fech">Fechar a apuração</button>' : ''}</div>
      <p class="small muted">${fechada ? 'Apuração fechada: os valores acima são a memória gravada no fechamento. Só o administrador reabre.' : 'Os valores são recalculados a cada abertura pelas notas do mês e pelos parâmetros vigentes. Fechar grava a memória de cálculo e leva os saldos credores para o mês seguinte.'}
      Prévia gerencial: confira com a apuração da contabilidade (EFD ICMS/IPI e EFD Contribuições) antes de pagar as guias.</p></div>`;
  const ajustes = () => { const o = {}; $$('[data-aj]', c).forEach(x => { o[x.dataset.aj] = +x.value || 0; }); o.observacao = $('#ap-obs', c).value.trim() || null; return o; };
  const gravar = (extra = {}) => q(sb.from('fisc_apuracoes').upsert({ empresa_id: state.empresa.id, mes: mes + '-01', ...ajustes(), ...extra }));
  $$('[data-aj]', c).forEach(x => x.onchange = () => { const o = ajustes(); const N = apurar(itens, p, o); Object.assign(aj, o); pintarResumoRapido(c, N); });
  $('#ap-xls', c).onclick = () => { const t = document.createElement('table'); t.innerHTML = $$('#ap-tabs tbody', c).map(b => b.innerHTML).join(''); exportXLSX(t, `apuracao_impostos_${mes}`); };
  $('#ap-salv', c) && ($('#ap-salv', c).onclick = async () => { try { await gravar(); toast('Ajustes salvos'); pintarApuracao(c, mes, itens, regime); } catch (e) { fail(e); } });
  $('#ap-fech', c) && ($('#ap-fech', c).onclick = async () => {
    const N = apurar(itens, p, ajustes()), pd = pendencias(N, p, itens);
    if (!confirm(`Fechar a apuração de ${mesBR(mes)}?${pd.length ? '\n\nPendências:\n- ' + pd.join('\n- ') : ''}\n\nICMS ${money(N.icms.totalGuias)} · IPI ${money(N.ipi.recolher)} · PIS/COFINS ${money(N.pc.recolher)}`)) return;
    try { await gravar({ situacao: 'fechada', resultado: { ...N, param: p ? { vigencia_inicio: p.vigencia_inicio, fonte: p.fonte } : null, notas: new Set(itens.map(i => i.nota_id)).size } }); toast('Apuração fechada'); pintarApuracao(c, mes, itens, regime); }
    catch (e) { fail(e); }
  });
  $('#ap-reab', c) && ($('#ap-reab', c).onclick = async () => {
    if (!confirm(`Reabrir a apuração de ${mesBR(mes)}?`)) return;
    try { await q(sb.from('fisc_apuracoes').update({ situacao: 'aberta' }).eq('empresa_id', state.empresa.id).eq('mes', mes + '-01')); toast('Apuração reaberta'); pintarApuracao(c, mes, itens, regime); } catch (e) { fail(e); }
  });
}
// ao mudar um ajuste, atualiza só os cartões (o detalhe é refeito ao salvar)
function pintarResumoRapido(c, N) {
  const v = $$('.kpi .k-value', c);
  if (v.length >= 4) { v[0].textContent = money(N.icms.recolher); v[1].textContent = money(N.icms.feef + N.icms.adDiper + N.icms.fecep); v[2].textContent = money(N.ipi.recolher); v[3].textContent = money(N.pc.recolher); }
}

// ------------------------------------------------------------------ parâmetros (aba Regras e parâmetros)
export async function pintarParametros(c, textoRegras) {
  loading(c);
  const L = await carregarParams(true);
  if (L === null) { c.innerHTML = textoRegras + '<div class="card"><div class="empty">Os parâmetros precisam do SQL 141.</div></div>'; return; }
  const lst = (a) => (a || []).length ? esc(a.join(', ')) : '<span class="muted">—</span>';
  c.innerHTML = textoRegras + `<div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><div><h2>Parâmetros da apuração por vigência</h2>
      <p class="small muted">Cada vigência vale do início até a próxima. ${isAdmin() ? 'Clique para ajustar.' : 'Só o administrador altera.'}</p></div>${isAdmin() ? '<button class="btn primary" id="pr-novo">Nova vigência</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Desde</th><th>PRODEPE</th><th>CFOP / NCM incentivados</th><th>FEEF · AD/DIPER</th><th>FECEP</th><th>PIS · COFINS</th><th>CFOP com crédito</th><th>Fonte</th></tr></thead><tbody>
    ${L.map(p => `<tr class="${isAdmin() ? 'clickable' : ''}" data-p="${p.id}"><td><b>${dateBR(p.vigencia_inicio)}</b></td><td>${p.prodepe_ativo ? `${pctBR(p.prodepe_credito_pct)}<div class="small muted">${p.prodepe_base === 'debito_incentivado' ? 'sobre o débito incentivado' : 'saldo proporcional'}</div>` : '<span class="muted">não</span>'}</td>
      <td class="small">${lst(p.prodepe_cfops)}<div class="muted">NCM ${p.prodepe_ncm?.length ? esc(p.prodepe_ncm.join(', ')) : 'todos'}</div></td><td>${pctBR(p.feef_pct)} · ${pctBR(p.ad_diper_pct)}</td>
      <td>${pctBR(p.fecep_pct)}<div class="small muted">NCM ${lst(p.fecep_ncm)}</div></td><td>${pctBR(p.pis_pct)} · ${pctBR(p.cofins_pct)}</td><td class="small">${lst(p.pc_cfops_credito)}</td><td class="small wrap">${esc(p.fonte || '')}</td></tr>`).join('')
    || '<tr><td colspan="8" class="empty">Nenhum parâmetro cadastrado. A apuração mostra só o destacado nas notas até cadastrar.</td></tr>'}</tbody></table></div></div>`;
  if (!isAdmin()) return;
  $('#pr-novo', c).onclick = () => editar(c, textoRegras, null, L[0]);
  c.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr[data-p]')?.dataset.p; if (id) editar(c, textoRegras, L.find(p => p.id === id)); };
}

function editar(c, textoRegras, p, base) {
  const x = p || { ...(base || {}), id: undefined, vigencia_inicio: new Date().toISOString().slice(0, 8) + '01', pis_pct: base?.pis_pct ?? 1.65, cofins_pct: base?.cofins_pct ?? 7.6,
    pc_incluir_frete: base?.pc_incluir_frete ?? true, pc_excluir_icms: base?.pc_excluir_icms ?? true, prodepe_base: base?.prodepe_base || 'saldo_proporcional', feef_base: base?.feef_base || 'beneficio' };
  const lv = (a) => esc((a || []).join(', '));
  const md = modal({ wide: true, title: p ? `Parâmetros desde ${dateBR(p.vigencia_inicio)}` : 'Nova vigência dos parâmetros', body: `<div>
    <div class="grid2"><label>Vale a partir de<input type="date" id="pp-vig" value="${x.vigencia_inicio}" ${p ? 'disabled' : ''}></label><label>Fonte (decreto, termo de concessão, orientação da contabilidade)<input id="pp-fonte" value="${esc(x.fonte || '')}"></label></div>
    <h3 style="margin:14px 0 6px">PRODEPE</h3>
    <label class="chk"><input type="checkbox" id="pp-on" ${x.prodepe_ativo ? 'checked' : ''}> A empresa usa o crédito presumido do PRODEPE</label>
    <div class="grid2"><label>Crédito presumido (%)<input type="number" step="0.0001" id="pp-pct" value="${+x.prodepe_credito_pct || 0}"></label>
      <label>Calcular sobre<select id="pp-base"><option value="saldo_proporcional" ${x.prodepe_base === 'saldo_proporcional' ? 'selected' : ''}>Saldo devedor × proporção das saídas incentivadas</option><option value="debito_incentivado" ${x.prodepe_base === 'debito_incentivado' ? 'selected' : ''}>Débito das saídas incentivadas (até o saldo devedor)</option></select></label>
      <label>CFOP de saída incentivados (vazio = todos)<input id="pp-cfop" value="${lv(x.prodepe_cfops)}" placeholder="5101, 6101"></label>
      <label>NCM incentivados — início do código (vazio = todos)<input id="pp-ncm" value="${lv(x.prodepe_ncm)}" placeholder="3923, 3920"></label>
      <label>FEEF (%)<input type="number" step="0.0001" id="pp-feef" value="${+x.feef_pct || 0}"></label>
      <label>FEEF calculado sobre<select id="pp-feefb"><option value="beneficio" ${x.feef_base === 'beneficio' ? 'selected' : ''}>o benefício (crédito presumido)</option><option value="saldo_incentivado" ${x.feef_base === 'saldo_incentivado' ? 'selected' : ''}>o saldo incentivado</option></select></label>
      <label>Taxa AD/DIPER (% do benefício)<input type="number" step="0.0001" id="pp-ad" value="${+x.ad_diper_pct || 0}"></label></div>
    <h3 style="margin:14px 0 6px">FECEP</h3>
    <div class="grid2"><label>Adicional (%)<input type="number" step="0.0001" id="pp-fec" value="${+x.fecep_pct || 0}"></label>
      <label>NCM sujeitos — início do código<input id="pp-fncm" value="${lv(x.fecep_ncm)}"></label>
      <label>CFOP de saída sujeitos (vazio = todos)<input id="pp-fcfop" value="${lv(x.fecep_cfops)}"></label></div>
    <h3 style="margin:14px 0 6px">PIS / COFINS não cumulativo</h3>
    <div class="grid2"><label>PIS (%)<input type="number" step="0.0001" id="pp-pis" value="${x.pis_pct}"></label><label>COFINS (%)<input type="number" step="0.0001" id="pp-cof" value="${x.cofins_pct}"></label>
      <label>CFOP do fornecedor que dão crédito<input id="pp-pc" value="${lv(x.pc_cfops_credito)}" placeholder="5101, 6101, 5102, 6102"></label><div></div>
      <label class="chk"><input type="checkbox" id="pp-fr" ${x.pc_incluir_frete !== false ? 'checked' : ''}> Frete na base do crédito</label>
      <label class="chk"><input type="checkbox" id="pp-ipi" ${x.pc_incluir_ipi ? 'checked' : ''}> IPI não recuperável na base do crédito</label>
      <label class="chk"><input type="checkbox" id="pp-icms" ${x.pc_excluir_icms !== false ? 'checked' : ''}> ICMS fora da base do crédito</label></div>
    <label>Observação<textarea id="pp-obs" rows="2">${esc(x.observacao || '')}</textarea></label>
    <p class="small muted">Nas notas de fornecedores o CFOP é o do emitente (5xxx/6xxx). Listas aceitam vírgula, espaço ou ponto e vírgula. Uma vigência nova não altera os meses já fechados.</p></div>`,
    foot: `${p ? '<button class="btn danger" id="pp-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="pp-ok">Salvar</button>` });
  const v = (id) => $(id, md.el).value;
  $('#pp-ok', md.el).onclick = async () => {
    const r = { empresa_id: state.empresa.id, vigencia_inicio: v('#pp-vig'), fonte: v('#pp-fonte').trim() || null, prodepe_ativo: $('#pp-on', md.el).checked, prodepe_credito_pct: +v('#pp-pct') || 0,
      prodepe_base: v('#pp-base'), prodepe_cfops: lerLista(v('#pp-cfop')), prodepe_ncm: lerLista(v('#pp-ncm')), feef_pct: +v('#pp-feef') || 0, feef_base: v('#pp-feefb'), ad_diper_pct: +v('#pp-ad') || 0,
      fecep_pct: +v('#pp-fec') || 0, fecep_ncm: lerLista(v('#pp-fncm')), fecep_cfops: lerLista(v('#pp-fcfop')), pis_pct: +v('#pp-pis') || 0, cofins_pct: +v('#pp-cof') || 0,
      pc_cfops_credito: lerLista(v('#pp-pc')), pc_incluir_frete: $('#pp-fr', md.el).checked, pc_incluir_ipi: $('#pp-ipi', md.el).checked, pc_excluir_icms: $('#pp-icms', md.el).checked, observacao: v('#pp-obs').trim() || null };
    if (!r.vigencia_inicio) return toast('Informe o início da vigência', true);
    if (r.prodepe_ativo && (!r.prodepe_credito_pct || !r.fonte)) return toast('PRODEPE: informe o percentual e a fonte', true);
    try { await q(p ? sb.from('fisc_param').update(r).eq('id', p.id) : sb.from('fisc_param').insert(r)); toast('Parâmetros salvos'); md.close(); pintarParametros(c, textoRegras); } catch (e) { fail(e); }
  };
  $('#pp-del', md.el) && ($('#pp-del', md.el).onclick = async () => {
    if (!confirm(`Excluir a vigência de ${dateBR(p.vigencia_inicio)}?`)) return;
    try { await q(sb.from('fisc_param').delete().eq('id', p.id)); toast('Vigência excluída'); md.close(); pintarParametros(c, textoRegras); } catch (e) { fail(e); }
  });
}

// CPD › Fiscal › Apuração de impostos: abas da reforma tributária.
//  - Alíquotas por vigência (padrão da plataforma + ajustes da empresa, SQL 072)
//  - Simulador 2027: PIS/Cofins de hoje × CBS+IBS sobre as notas dos últimos 12 meses
//  - Conferência IBS/CBS: o destacado em cada nota × a alíquota do ano da emissão
import { sb, state, q, fetchAll, isAdmin } from './data.js';
import { $, esc, money, pct, dateBR, fail, toast, modal, loading, exportXLSX, MESES_CURTO } from './ui.js';
import { aliquotas, doAno, total, ibs, simular, conferir, SITUACAO, PIS_COFINS, pctBR } from './reforma.js';

let TAB = null, semTabela = false;
const sim = { ano: 2027, credAtual: 100, credNovo: 100, notas: null, chave: null };
const conf = { lado: 'saidas', filtro: 'problemas', chave: null, notas: null, itens: null };
const mesBR = (m) => `${MESES_CURTO[+m.slice(5) - 1]}/${m.slice(0, 4)}`;
const fimMes = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };

export async function carregarAliquotas(force = false) {
  if (TAB && !force) return TAB;
  try { TAB = aliquotas(await q(sb.from('trib_aliquotas').select('*').eq('empresa_id', state.empresa.id))); semTabela = false; }
  catch { TAB = aliquotas(); semTabela = true; }
  return TAB;
}
const selo = (a) => `<span class="badge ${a.situacao === 'vigente' ? 'pago' : a.situacao === 'proposta' ? 'aberto' : ''}">${SITUACAO[a.situacao] || a.situacao}</span>`;

// ------------------------------------------------------------------ alíquotas por vigência
export async function pintarAliquotas(c) {
  loading(c); const L = await carregarAliquotas(true);
  c.innerHTML = `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2>Alíquotas da CBS e do IBS por ano</h2>
    <p class="muted small">Padrão da plataforma atualizado em 30/10/2026 com a proposta do TCU para 2027 (11,3468%: CBS de 11,2468% e IBS de teste de 0,1%), que ainda depende de resolução do Senado até dezembro; sem a votação, vale o valor do TCU. De 2028 em diante são estimativas.
    ${isAdmin() ? 'Clique no ano para ajustar quando sair a alíquota definitiva.' : 'Só administradores ajustam.'}</p>
    ${semTabela ? '<p class="small"><span class="badge vencido">SQL 072 pendente</span> A tabela da empresa ainda não foi criada: aparece só o padrão e não dá para ajustar.</p>' : ''}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Ano</th><th class="num">CBS</th><th class="num">IBS estadual</th><th class="num">IBS municipal</th><th class="num">Total</th><th>PIS/Cofins</th><th class="num">ICMS mantido</th><th>Situação</th><th>Fonte</th></tr></thead><tbody>
    ${L.map(a => `<tr class="${isAdmin() && !semTabela ? 'clickable' : ''}" data-ano="${a.ano}"><td><strong>${a.ano}</strong></td><td class="num">${pctBR(a.cbs)}</td><td class="num">${pctBR(a.ibs_uf)}</td><td class="num">${pctBR(a.ibs_mun)}</td><td class="num"><strong>${pctBR(total(a))}</strong></td>
      <td>${a.pis_cofins ? 'cobrados' : 'extintos'}</td><td class="num">${a.icms_pct}%</td><td>${selo(a)}${a.padrao ? '' : ' <span class="badge">ajustada pela empresa</span>'}</td><td class="small wrap">${esc(a.fonte || '')}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted" style="padding:0 12px 12px">Em 2026 a CBS (0,9%) e o IBS (0,1%) são só destacados na nota e compensados com o PIS/Cofins. De 2029 a 2032 o ICMS cai 10 pontos por ano e o IBS sobe na mesma proporção; em 2033 o ICMS acaba. Compras de órgãos públicos têm redutor próprio, fora desta tabela.</p></div>`;
  if (!isAdmin() || semTabela) return;
  c.querySelector('tbody').onclick = (e) => { const ano = e.target.closest('tr[data-ano]')?.dataset.ano; if (ano) editar(c, L.find(a => a.ano === +ano)); };
}

function editar(c, a) {
  const md = modal({ title: `Alíquotas de ${a.ano}`, body: `<div class="grid2">
      <label>CBS (%)<input type="number" step="0.0001" id="al-cbs" value="${a.cbs}"></label>
      <label>IBS estadual (%)<input type="number" step="0.0001" id="al-uf" value="${a.ibs_uf}"></label>
      <label>IBS municipal (%)<input type="number" step="0.0001" id="al-mun" value="${a.ibs_mun}"></label>
      <label>ICMS mantido (%)<input type="number" step="1" id="al-icms" value="${a.icms_pct}"></label>
      <label>Situação<select id="al-sit">${Object.entries(SITUACAO).map(([k, t]) => `<option value="${k}" ${a.situacao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="al-pc" ${a.pis_cofins ? 'checked' : ''}> PIS/Cofins ainda cobrados</label></div>
    <label>Fonte (lei, resolução, data)<input id="al-fonte" value="${esc(a.fonte || '')}"></label>
    <p class="small muted">A alteração vale para o simulador e para a conferência das notas. ${a.padrao ? '' : '“Voltar ao padrão” apaga o ajuste da empresa para este ano.'}</p>`,
    foot: `${a.padrao ? '' : '<button class="btn" id="al-pad">Voltar ao padrão</button>'}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="al-ok">Salvar</button>` });
  $('#al-ok', md.el).onclick = async () => {
    const v = { empresa_id: state.empresa.id, ano: a.ano, cbs: +$('#al-cbs', md.el).value || 0, ibs_uf: +$('#al-uf', md.el).value || 0, ibs_mun: +$('#al-mun', md.el).value || 0,
      icms_pct: +$('#al-icms', md.el).value || 0, situacao: $('#al-sit', md.el).value, pis_cofins: $('#al-pc', md.el).checked, fonte: $('#al-fonte', md.el).value.trim() || null, atualizado_em: new Date().toISOString() };
    if (!v.fonte) return toast('Informe a fonte da alíquota', true);
    try { await q(sb.from('trib_aliquotas').upsert(v, { onConflict: 'empresa_id,ano' })); toast(`Alíquotas de ${a.ano} salvas`); md.close(); sim.chave = null; pintarAliquotas(c); } catch (e) { fail(e); }
  };
  $('#al-pad', md.el) && ($('#al-pad', md.el).onclick = async () => {
    try { await q(sb.from('trib_aliquotas').delete().eq('empresa_id', state.empresa.id).eq('ano', a.ano)); toast('Voltou ao padrão'); md.close(); pintarAliquotas(c); } catch (e) { fail(e); }
  });
}

// ------------------------------------------------------------------ simulador 2027
const COLS_SIM = 'id, emissao, tipo, situacao, emissao_propria, finalidade, cfops, v_prod, v_desc, v_frete, v_seg, v_outro, v_nf, v_icms, v_ipi, v_pis, v_cofins, v_bc_ibscbs';
export async function pintarSimulador(c) {
  const L = await carregarAliquotas();
  const h = new Date(), fim = new Date(Date.UTC(h.getFullYear(), h.getMonth(), 0)).toISOString().slice(0, 10);
  const ini12 = (() => { const d = new Date(fim + 'T12:00:00'); d.setMonth(d.getMonth() - 11, 1); return d.toISOString().slice(0, 10); })();
  if (sim.chave !== `${state.empresa.id}|${fim}`) {
    loading(c, 'Carregando as notas dos últimos 12 meses…');
    try { sim.notas = await fetchAll(() => sb.from('nfe_notas').select(COLS_SIM).eq('empresa_id', state.empresa.id).gte('emissao', ini12).lte('emissao', fim).order('id')); sim.chave = `${state.empresa.id}|${fim}`; }
    catch (e) { fail(e); c.innerHTML = ''; return; }
  }
  const a = doAno(L, sim.ano), S = simular(sim.notas, a, sim), T = S.total;
  const neg = (v) => v ? money(-v) : '–';
  const lin = (m, rot) => `<tr class="${m.mes === 'total' ? 'row-sec' : ''}"><td class="nowrap">${rot}</td><td class="num">${money(m.faturamento)}</td><td class="num">${money(m.debAtual - m.devAtual)}</td><td class="num">${neg(m.credAtual)}</td><td class="num"><strong>${money(m.atual)}</strong></td><td class="num">${pct(m.pctAtual)}</td>
    <td class="num">${money(m.base)}</td><td class="num">${money(m.debNovo - m.devNovo)}</td><td class="num">${neg(m.credNovo)}</td><td class="num"><strong>${money(m.novo)}</strong></td><td class="num">${pct(m.pctNovo)}</td><td class="num ${m.dif > 0 ? 'neg' : 'pos'}">${m.dif > 0 ? '+' : ''}${money(m.dif)}</td></tr>`;
  c.innerHTML = `<div class="card"><div class="toolbar" style="margin-bottom:0">
      <label>Simular o ano<select id="sm-ano">${L.filter(x => x.ano >= 2027).map(x => `<option value="${x.ano}" ${x.ano === sim.ano ? 'selected' : ''}>${x.ano} · ${pctBR(total(x))}</option>`).join('')}</select></label>
      <label>Compras com crédito de PIS/Cofins hoje (%)<input type="number" min="0" max="100" step="5" id="sm-ca" value="${sim.credAtual}" style="width:90px"></label>
      <label>Compras com crédito de CBS/IBS (%)<input type="number" min="0" max="100" step="5" id="sm-cn" value="${sim.credNovo}" style="width:90px"></label>
      <span class="spacer"></span><button class="btn" id="sm-xls">Excel</button></div>
    <p class="small muted" style="margin:8px 0 0">Notas autorizadas de ${dateBR(ini12)} a ${dateBR(fim)}. Alíquota de ${sim.ano}: CBS ${pctBR(a.cbs)} + IBS ${pctBR(ibs(a))} = <strong>${pctBR(total(a))}</strong> ${selo(a)}.
      <strong>Estimativa</strong>: mantém os valores das notas e só troca o tributo. Base da CBS/IBS = a destacada na nota (quando houver) ou produtos − descontos + frete, seguro e outras − ICMS, PIS e Cofins.
      Hoje: débito = PIS/Cofins destacados nas vendas; crédito = ${PIS_COFINS.toString().replace('.', ',')}% sobre as compras sem ICMS, na proporção informada. Na CBS o crédito é amplo (tudo o que a empresa compra e tem o tributo pago), por isso o padrão é 100%.</p></div>
    <div class="kpis">${[['Faturamento (12 meses)', money(T.faturamento), `${T.notasVenda} nota(s) de venda`], ['PIS/Cofins líquido hoje', money(T.atual), `${pct(T.pctAtual)} do faturamento`],
      [`CBS + IBS em ${sim.ano}`, money(T.novo), `${pct(T.pctNovo)} do faturamento`], ['Diferença no ano', `<span class="${T.dif > 0 ? 'neg' : 'pos'}">${T.dif > 0 ? '+' : ''}${money(T.dif)}</span>`, `média de ${money(T.dif / Math.max(1, S.meses.length))} por mês`],
      ['IPI destacado nas vendas', money(T.ipi), 'vai a zero em 2027 para a maior parte dos produtos']].map(([t, v, s]) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value">${v}</div><div class="k-sub">${s}</div></div>`).join('')}</div>
    <div class="card flush"><div class="table-wrap" id="sm-tab"><table><thead>
      <tr><th rowspan="2">Mês</th><th rowspan="2" class="num">Faturamento</th><th colspan="4" style="text-align:center">PIS/Cofins (como hoje)</th><th colspan="5" style="text-align:center">CBS + IBS (${sim.ano})</th><th rowspan="2" class="num">Diferença</th></tr>
      <tr><th class="num" title="Débito das vendas menos as devoluções de clientes">Débito líquido</th><th class="num">Créditos</th><th class="num">A pagar</th><th class="num">% fat.</th><th class="num">Base</th><th class="num" title="Débito das vendas menos as devoluções de clientes">Débito líquido</th><th class="num">Créditos</th><th class="num">A pagar</th><th class="num">% fat.</th></tr></thead><tbody>
      ${S.meses.map(m => lin(m, mesBR(m.mes))).join('')}${lin(T, 'Total')}</tbody></table></div></div>
    <p class="small muted">Não considera: mudança de preço por a CBS ser cobrada “por fora”, split payment (o tributo sai no recebimento), redutores e regimes específicos, créditos presumidos e o fim do IPI. É uma ordem de grandeza para o planejamento, não a apuração.</p>`;
  $('#sm-ano', c).onchange = (e) => { sim.ano = +e.target.value; pintarSimulador(c); };
  $('#sm-ca', c).onchange = (e) => { sim.credAtual = Math.min(100, Math.max(0, +e.target.value || 0)); pintarSimulador(c); };
  $('#sm-cn', c).onchange = (e) => { sim.credNovo = Math.min(100, Math.max(0, +e.target.value || 0)); pintarSimulador(c); };
  $('#sm-xls', c).onclick = () => exportXLSX($('#sm-tab table', c), `simulador_cbs_ibs_${sim.ano}`);
}

// ------------------------------------------------------------------ conferência IBS/CBS
export async function pintarConferencia(c, mes) {
  loading(c); const L = await carregarAliquotas();
  let notas = conf.notas, itens = conf.itens;
  if (conf.chave !== `${state.empresa.id}|${mes}`) try {
    notas = await fetchAll(() => sb.from('nfe_notas').select('id, numero, serie, emissao, tipo, situacao, emissao_propria, finalidade, dest_nome, emit_nome, v_prod, v_desc, v_frete, v_seg, v_outro, v_nf, v_icms, v_pis, v_cofins, v_bc_ibscbs, v_ibs, v_cbs')
      .eq('empresa_id', state.empresa.id).eq('situacao', 'autorizada').gte('emissao', mes + '-01').lte('emissao', fimMes(mes)).order('numero'));
    itens = await fetchAll(() => sb.from('nfe_itens').select('nota_id, cst_ibscbs, cclass_trib, nfe_notas!inner(empresa_id, emissao)').eq('nfe_notas.empresa_id', state.empresa.id).gte('nfe_notas.emissao', mes + '-01').lte('nfe_notas.emissao', fimMes(mes)).order('id'));
    Object.assign(conf, { chave: `${state.empresa.id}|${mes}`, notas, itens });
  } catch (e) { fail(e); c.innerHTML = ''; return; }
  const porNota = new Map(); for (const i of itens) (porNota.get(i.nota_id) || porNota.set(i.nota_id, []).get(i.nota_id)).push(i);
  const lado = (n) => n.emissao_propria ? 'saidas' : 'entradas';
  const R = notas.map(n => ({ n, r: conferir(n, L, porNota.get(n.id) || []) }));
  const sel = R.filter(x => lado(x.n) === conf.lado);
  const cont = (nv) => sel.filter(x => x.r.nivel === nv).length;
  const vis = conf.filtro === 'problemas' ? sel.filter(x => x.r.nivel !== 'ok') : sel;
  const a = doAno(L, +mes.slice(0, 4));
  const S = (k) => sel.reduce((s, x) => s + (+x.n[k] || 0), 0), Esp = (k) => sel.reduce((s, x) => s + (x.r[k] || 0), 0);
  const nivelTxt = { ok: ['pago', 'confere'], info: ['', 'verificar'], warn: ['aberto', 'atenção'], neg: ['vencido', 'divergente'] };
  c.innerHTML = `<div class="card"><div class="toolbar" style="margin-bottom:0">
      <div class="chips" id="cf-lado">${[['saidas', 'Notas emitidas pela empresa'], ['entradas', 'Notas de fornecedores e clientes']].map(([k, t]) => `<span class="chip ${conf.lado === k ? 'on' : ''}" data-l="${k}">${t}</span>`).join('')}</div>
      <div class="chips" id="cf-flt">${[['problemas', 'Só o que precisa de atenção'], ['todas', 'Todas']].map(([k, t]) => `<span class="chip ${conf.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><button class="btn" id="cf-xls">Excel</button></div>
    <p class="small muted" style="margin:8px 0 0">${a ? `Alíquotas de ${a.ano}: CBS ${pctBR(a.cbs)} e IBS ${pctBR(ibs(a))} sobre a base destacada na nota ${selo(a)}.` : 'Antes da reforma: nada a conferir.'}
      Divergente: a CBS ou o IBS destacados diferem do esperado em mais de 0,5% (mínimo de R$ 0,05), ou a nota emitida pela empresa veio sem o grupo IBS/CBS. Verificar: itens com CST diferente de 000 (redução, isenção, suspensão, diferimento) ou base diferente da estimada pela nota.</p></div>
    <div class="kpis">${[['Notas no mês', sel.length, mesBR(mes)], ['Divergentes', cont('neg'), 'conferir com quem emite a nota'], ['Atenção', cont('warn'), 'sem o grupo IBS/CBS (terceiros)'], ['Verificar', cont('info'), 'CST de redução ou base diferente'],
      ['CBS + IBS destacados', money(S('v_cbs') + S('v_ibs')), `CBS ${money(S('v_cbs'))} (esperado ${money(Esp('esperadoCbs'))}) · IBS ${money(S('v_ibs'))} (esperado ${money(Esp('esperadoIbs'))})`]].map(([t, v, s]) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value">${v}</div><div class="k-sub">${s}</div></div>`).join('')}</div>
    <div class="card flush"><div class="table-wrap" style="max-height:60vh" id="cf-tab"><table><thead><tr><th>Nº</th><th>Emissão</th><th>${conf.lado === 'saidas' ? 'Destinatário' : 'Emitente'}</th><th class="num">Valor</th><th class="num">Base IBS/CBS</th><th class="num">CBS</th><th class="num">CBS esperada</th><th class="num">IBS</th><th class="num">IBS esperado</th><th>CST</th><th>Situação</th></tr></thead><tbody>
      ${vis.length ? vis.map(({ n, r }) => `<tr><td>${n.serie && n.serie !== '1' ? n.serie + '-' : ''}${n.numero}</td><td>${dateBR(n.emissao)}</td><td class="wrap" style="min-width:240px">${esc((n.emissao_propria ? n.dest_nome : n.emit_nome) || '')}${r.nivel === 'ok' ? '' : `<div class="small muted">${esc(r.motivos.join(' · '))}</div>`}</td><td class="num">${money(n.v_nf)}</td>
        <td class="num">${money(n.v_bc_ibscbs)}</td><td class="num">${money(n.v_cbs)}</td><td class="num">${r.base ? money(r.esperadoCbs) : '–'}</td><td class="num">${money(n.v_ibs)}</td><td class="num">${r.base ? money(r.esperadoIbs) : '–'}</td><td class="small">${esc((r.csts || []).join(', '))}</td>
        <td><span class="badge ${nivelTxt[r.nivel][0]}">${nivelTxt[r.nivel][1]}</span></td></tr>`).join('') : `<tr><td colspan="11" class="empty">${sel.length ? 'Todas as notas conferem.' : 'Nenhuma nota no mês.'}</td></tr>`}
    </tbody></table></div></div>`;
  $('#cf-lado', c).onclick = (e) => { const l = e.target.closest('[data-l]')?.dataset.l; if (l) { conf.lado = l; pintarConferencia(c, mes); } };
  $('#cf-flt', c).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { conf.filtro = f; pintarConferencia(c, mes); } };
  $('#cf-xls', c).onclick = () => exportXLSX($('#cf-tab table', c), `conferencia_ibs_cbs_${mes}`);
}

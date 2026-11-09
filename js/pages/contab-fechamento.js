// Contabilidade › Fechamento Contábil (CTB011, melhoria 9.3): checklist do mês, provisões sugeridas com geração dos lançamentos,
// conferência das contas bancárias do balancete × saldo do fluxo, arquivo para o Domínio e fechamento do mês.
import { sb, state, q, fetchAll, isAdmin } from '../lib/data.js';
import { $, $$, esc, money, dateBR, fail, toast, modal, loading, MESES_CURTO } from '../lib/ui.js';
import { arquivoDominio, resumoSugestoes, CAMPOS } from '../lib/fech-contabil.js';

export const title = 'Fechamento Contábil';
const h = new Date(), ant = new Date(h.getFullYear(), h.getMonth() - 1, 1);
const ui = { mes: `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}` };
const mesBR = (m) => `${MESES_CURTO[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}`;
const fimMes = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const ORIG = { financeiro: 'Financeiro', folha: 'Folha e provisões', apuracao: 'Impostos', depreciacao: 'Depreciação', manual: 'Manuais', nota: 'Notas', fidc: 'FIDC', estoque: 'Estoque' };
const TIPOS = { decimo: '13º (% da folha)', ferias: 'Férias + 1/3 (% da folha)', encargos: 'Encargos (% das provisões)', icms: 'ICMS da apuração', ipi: 'IPI da apuração', pis_cofins: 'PIS/COFINS da apuração', feef_fecep: 'FEEF, AD/DIPER e FECEP', fixo: 'Valor fixo do mês' };
let CONTAS = null;

export async function render(root) {
  const qm = new URLSearchParams(location.hash.split('?')[1] || '').get('mes'); if (/^\d{4}-\d{2}$/.test(qm || '')) ui.mes = qm;
  root.innerHTML = `<div class="toolbar"><label>Mês<select id="cf-mes">${[h.getFullYear() - 1, h.getFullYear()].flatMap(a => MESES_CURTO.map((_, i) => `${a}-${String(i + 1).padStart(2, '0')}`))
      .filter(m => m <= h.toISOString().slice(0, 7)).reverse().map(m => `<option value="${m}" ${m === ui.mes ? 'selected' : ''}>${mesBR(m)}</option>`).join('')}</select></label>
    <span class="spacer"></span><span id="cf-acoes"></span></div><div id="cf-corpo"></div>`;
  $('#cf-mes', root).onchange = (e) => { ui.mes = e.target.value; carregar(root); };
  await carregar(root);
}

async function carregar(root) {
  const c = $('#cf-corpo', root); loading(c);
  const e = state.empresa.id, mes = ui.mes + '-01';
  let R, S, K;
  try {
    R = await q(sb.rpc('contab_fech_resumo', { p_empresa: e, p_mes: mes }));
    [S, K] = await Promise.all([q(sb.rpc('contab_fech_sugestoes', { p_empresa: e, p_mes: mes })), q(sb.rpc('contab_fech_conferencia', { p_empresa: e, p_mes: mes }))]);
    if (!CONTAS || CONTAS.emp !== e) CONTAS = { emp: e, l: await fetchAll(() => sb.from('contab_contas').select('id,codigo,classificacao,descricao,tipo').eq('empresa_id', e).order('classificacao')) };
  } catch (err) {
    c.innerHTML = `<div class="card"><div class="empty">${/contab_fech/.test(err.message || '') ? 'Esta tela precisa do SQL 142.' : /acesso/i.test(err.message || '') ? 'O fechamento contábil é do administrador, diretor e financeiro.' : esc(err.message || 'Não foi possível carregar.')}</div></div>`; return;
  }
  const fechado = R.situacao === 'fechado', grava = ['admin', 'financeiro'].includes(state.papel), ct = new Map(CONTAS.l.map(x => [x.id, x]));
  const nomeC = (id) => { const x = ct.get(id); return x ? `${esc(x.classificacao)} <span class="muted">${esc(x.descricao)}</span>` : '<span class="neg">—</span>'; };
  const RS = resumoSugestoes(S), bancos = K.contas || [], bOk = bancos.filter(b => b.ok).length;
  const chk = [
    ['Lançamentos do financeiro gerados', (R.por_origem?.financeiro || 0) > 0, `${R.por_origem?.financeiro || 0} lançamento(s)`, '#/contab/balancete'],
    ['Depreciação do mês', R.depreciacao, R.depreciacao ? 'gerada' : 'não gerada', '#/contab/imobilizado'],
    ['Apuração de impostos fechada', R.apuracao_fechada, R.apuracao_fechada ? 'fechada' : 'aberta', '#/fiscal/apuracao'],
    ['Provisões geradas', RS.pendentes === 0 && RS.gerados > 0, `${RS.gerados} de ${S.length} · ${RS.pendentes} a gerar${RS.divergentes ? ` · ${RS.divergentes} com valor diferente do sugerido` : ''}`, null],
    ['Contas bancárias conferidas', bancos.length > 0 && bOk === bancos.length, `${bOk} de ${bancos.length} (${K.fonte === 'importado' ? 'balancete importado' : 'balancete da plataforma'})`, null],
    ['Balancete da contabilidade importado', R.balancete_importado, R.balancete_importado ? 'importado' : 'ainda não', '#/contab/balancete'],
    ['Lançamentos fechando (débito = crédito)', R.sem_partidas_fechando === 0, R.sem_partidas_fechando ? `${R.sem_partidas_fechando} com diferença` : 'todos', null]];
  $('#cf-acoes', root).innerHTML = `${isAdmin() ? '<button class="btn" id="cf-regras">Regras</button> <button class="btn" id="cf-lay">Leiaute do Domínio</button> ' : ''}<button class="btn" id="cf-dom">Arquivo para o Domínio</button>
    ${fechado ? (isAdmin() ? ' <button class="btn" id="cf-reab">Reabrir o mês</button>' : '') : grava ? ' <button class="btn primary" id="cf-fech">Fechar o mês</button>' : ''}`;
  c.innerHTML = `<div class="kpis" style="margin:12px 0">
      <div class="kpi"><div class="k-label">Mês contábil</div><div class="k-value" style="font-size:18px">${fechado ? '<span class="pos">fechado</span>' : 'aberto'}</div><div class="k-sub">${fechado ? 'em ' + dateBR(R.fechado_em) : mesBR(ui.mes)}</div></div>
      <div class="kpi"><div class="k-label">Checklist</div><div class="k-value">${chk.filter(x => x[1]).length} de ${chk.length}</div><div class="k-sub">etapas concluídas</div></div>
      <div class="kpi"><div class="k-label">Lançamentos contábeis</div><div class="k-value">${R.lancamentos}</div><div class="k-sub">${Object.entries(R.por_origem || {}).map(([k, v]) => `${ORIG[k] || k} ${v}`).join(' · ') || 'nenhum'}</div></div>
      <div class="kpi"><div class="k-label">Provisões sugeridas</div><div class="k-value">${money(RS.total)}</div><div class="k-sub">${RS.avisos ? `<span class="warn">${RS.avisos} com aviso</span>` : 'sem avisos'}</div></div>
      <div class="kpi"><div class="k-label">Domínio</div><div class="k-value" style="font-size:16px">${R.exportado_em ? 'exportado' : '<span class="muted">não exportado</span>'}</div><div class="k-sub">${R.exportado_em ? dateBR(R.exportado_em) : '&nbsp;'}</div></div></div>
    <div class="card"><h2>Checklist do fechamento</h2><table class="small"><tbody>${chk.map(([t, ok, d, l]) => `<tr><td style="width:24px">${ok ? '<span class="pos">✔</span>' : '<span class="warn">●</span>'}</td><td>${t}</td><td class="muted">${d}</td><td>${l ? `<a href="${l}">abrir</a>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><div><h2>Provisões e lançamentos sugeridos</h2><p class="small muted">O valor pode ser ajustado antes de gerar. Gerar de novo substitui o lançamento anterior da mesma regra. Data: ${dateBR(fimMes(ui.mes))}.</p></div>
      ${!fechado && grava ? '<button class="btn primary" id="cf-gerar">Gerar os marcados</button>' : ''}</div>
      <div class="table-wrap"><table><thead><tr><th></th><th>Provisão e base</th><th>Débito / crédito</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
      ${S.map(s => `<tr><td>${!fechado && grava && !s.aviso ? `<input type="checkbox" class="cf-sel" data-r="${s.regra_id}" ${!s.gerado && +s.valor > 0 ? 'checked' : ''}>` : ''}</td>
        <td class="wrap"><b>${esc(s.nome)}</b><div class="small muted">${esc(s.base || '')}</div>${s.aviso ? `<div class="small warn">${esc(s.aviso)}</div>` : ''}</td>
        <td class="small wrap">D ${nomeC(s.conta_debito_id)}<br>C ${nomeC(s.conta_credito_id)}</td>
        <td class="num">${!fechado && grava && !s.aviso ? `<input type="number" step="0.01" class="cf-val" data-r="${s.regra_id}" value="${s.valor ?? ''}" style="width:120px;text-align:right">` : s.valor == null ? '–' : money(s.valor)}</td>
        <td class="small">${s.gerado ? `<span class="pos">gerado ${money(s.valor_gerado)}</span>${s.valor != null && Math.abs(+s.valor_gerado - +s.valor) > 0.005 ? `<div class="warn">sugerido ${money(s.valor)}</div>` : ''}` : '<span class="muted">a gerar</span>'}</td>
        <td>${s.gerado && !fechado && grava ? `<button class="btn small ghost" data-desf="${s.regra_id}">Desfazer</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma regra ativa.</td></tr>'}</tbody></table></div></div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><div><h2>Contas bancárias: balancete × fluxo de caixa</h2>
      <p class="small muted">Saldo da conta contábil (de-para da conta bancária) no ${K.fonte === 'importado' ? 'balancete importado da contabilidade' : 'balancete gerado pela plataforma'} × saldo pago no fluxo em ${dateBR(fimMes(ui.mes))}. Tolerância ${money(K.tolerancia)}.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Conta bancária</th><th>Conta contábil</th><th class="num">Fluxo de caixa</th><th class="num">Contabilidade</th><th class="num">Diferença</th><th></th></tr></thead><tbody>
      ${bancos.map(b => `<tr><td>${esc(b.nome)}</td><td class="small">${b.mapeada ? `${esc(b.classificacao)} <span class="muted">${esc(b.conta_contabil || '')}</span>` : '<a href="#/contab/depara" class="warn">sem de-para</a>'}</td>
        <td class="num">${money(b.fluxo)}</td><td class="num">${b.mapeada ? money(b.contabil) : '–'}</td><td class="num ${b.ok ? '' : 'neg'}">${b.mapeada ? money(b.diferenca) : '–'}</td><td>${b.ok ? '<span class="pos">✔</span>' : '<span class="neg">✖</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma conta bancária ativa.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Prévia gerencial dos lançamentos de fechamento: a escrituração oficial continua na contabilidade. O arquivo do Domínio segue o leiaute cadastrado; confira a primeira importação com o contador.</p>`;

  $('#cf-gerar', c) && ($('#cf-gerar', c).onclick = async (ev) => {
    const itens = $$('.cf-sel:checked', c).map(x => ({ regra_id: x.dataset.r, valor: +($(`.cf-val[data-r="${x.dataset.r}"]`, c)?.value || 0) }));
    if (!itens.length) return toast('Marque as provisões a gerar', true);
    ev.target.disabled = true;
    try { const n = await q(sb.rpc('contab_fech_gerar', { p_empresa: state.empresa.id, p_mes: ui.mes + '-01', p_itens: itens })); toast(`${n} lançamento(s) gerado(s)`); carregar(root); }
    catch (err) { fail(err); ev.target.disabled = false; }
  });
  $$('[data-desf]', c).forEach(b => b.onclick = async () => { try { await q(sb.rpc('contab_fech_desfazer', { p_empresa: state.empresa.id, p_mes: ui.mes + '-01', p_regra: b.dataset.desf })); toast('Lançamento desfeito'); carregar(root); } catch (err) { fail(err); } });
  $('#cf-fech', root) && ($('#cf-fech', root).onclick = async () => {
    const falta = chk.filter(x => !x[1]).map(x => '- ' + x[0]);
    if (!confirm(`Fechar o mês contábil de ${mesBR(ui.mes)}?${falta.length ? '\n\nAinda pendente:\n' + falta.join('\n') : ''}\n\nCom o mês fechado, as provisões não podem ser geradas nem desfeitas.`)) return;
    try { await q(sb.rpc('contab_fech_situacao', { p_empresa: state.empresa.id, p_mes: ui.mes + '-01', p_fechar: true, p_obs: falta.length ? 'Fechado com pendências: ' + chk.filter(x => !x[1]).map(x => x[0]).join('; ') : null })); toast('Mês contábil fechado'); carregar(root); } catch (err) { fail(err); }
  });
  $('#cf-reab', root) && ($('#cf-reab', root).onclick = async () => { if (!confirm(`Reabrir o mês contábil de ${mesBR(ui.mes)}?`)) return; try { await q(sb.rpc('contab_fech_situacao', { p_empresa: state.empresa.id, p_mes: ui.mes + '-01', p_fechar: false })); toast('Mês reaberto'); carregar(root); } catch (err) { fail(err); } });
  $('#cf-dom', root).onclick = () => exportar(root);
  $('#cf-regras', root) && ($('#cf-regras', root).onclick = () => regras(root));
  $('#cf-lay', root) && ($('#cf-lay', root).onclick = () => leiaute(root));
}

async function exportar(root) {
  const e = state.empresa.id, ini = ui.mes + '-01', fim = fimMes(ui.mes);
  try {
    const [cfg] = await q(sb.from('contab_fech_config').select('*').eq('empresa_id', e));
    const L = await fetchAll(() => sb.from('contab_lancamentos').select('id,data,historico,origem,contab_partidas(conta_id,debito,credito)').eq('empresa_id', e).gte('data', ini).lte('data', fim).order('data').order('id'));
    const A = arquivoDominio(L.map(l => ({ ...l, partidas: l.contab_partidas || [] })), new Map(CONTAS.l.map(x => [x.id, x])), cfg || {});
    if (!A.linhas) return toast('Nenhum lançamento contábil no mês para as origens do leiaute', true);
    if (A.semConta.length && !confirm(`${A.semConta.length} conta(s) sem ${cfg?.dom_conta === 'classificacao' ? 'classificação' : 'código reduzido'} no plano: as linhas saem com a conta em branco. Exportar assim mesmo?`)) return;
    const url = URL.createObjectURL(new Blob(['﻿' + A.texto], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `dominio_lancamentos_${ui.mes}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    await q(sb.rpc('contab_fech_exportado', { p_empresa: e, p_mes: ini }));
    toast(`${A.lancamentos} lançamento(s) em ${A.linhas} linha(s)`); carregar(root);
  } catch (err) { fail(err); }
}

function opcoesContas(sel) {
  return '<option value="">—</option>' + CONTAS.l.filter(x => x.tipo === 'A').map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.classificacao)} ${esc(x.descricao)}${x.codigo ? ` (${x.codigo})` : ''}</option>`).join('');
}

async function regras(root) {
  let L; try { L = await q(sb.from('contab_fech_regras').select('*').eq('empresa_id', state.empresa.id).order('ordem').order('nome')); } catch (err) { return fail(err); }
  const linha = (r) => `<tr data-id="${r.id || ''}"><td><input type="checkbox" class="rg-at" ${r.ativo !== false ? 'checked' : ''}></td>
    <td><input class="rg-nome" value="${esc(r.nome || '')}" style="min-width:200px"><div class="small muted">${TIPOS[r.tipo] || ''}</div><input type="hidden" class="rg-tipo" value="${r.tipo}"></td>
    <td>${['decimo', 'ferias', 'encargos'].includes(r.tipo) ? `<input type="number" step="0.0001" class="rg-pct" value="${r.percentual ?? ''}" placeholder="${r.tipo === 'encargos' ? 'INSS+FGTS do RH' : ''}" style="width:110px">` : r.tipo === 'fixo' ? `<input type="number" step="0.01" class="rg-fixo" value="${r.valor_fixo ?? ''}" style="width:110px">` : '<span class="muted small">da apuração</span>'}</td>
    <td><select class="rg-d" style="max-width:240px">${opcoesContas(r.conta_debito_id)}</select></td><td><select class="rg-c" style="max-width:240px">${opcoesContas(r.conta_credito_id)}</select></td>
    <td><input class="rg-hist" value="${esc(r.historico || '')}" style="min-width:160px"></td></tr>`;
  const md = modal({ wide: true, title: 'Regras das provisões do fechamento', body: `<div class="table-wrap"><table class="small"><thead><tr><th>Ativa</th><th>Provisão</th><th>% ou valor</th><th>Débito</th><th>Crédito</th><th>Histórico</th></tr></thead><tbody id="rg-l">${L.map(linha).join('')}</tbody></table></div>
    <button class="btn small" id="rg-novo" style="margin-top:8px">+ Valor fixo do mês</button>
    <p class="small muted">13º e férias: percentual sobre os salários dos colaboradores ativos (vínculos do leiaute). Encargos: percentual sobre as duas provisões (em branco = INSS + FGTS dos parâmetros do RH). Impostos: o valor da apuração fechada do mês.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rg-ok">Salvar</button>' });
  $('#rg-novo', md.el).onclick = () => $('#rg-l', md.el).insertAdjacentHTML('beforeend', linha({ tipo: 'fixo', nome: 'Provisão fixa', ativo: true }));
  $('#rg-ok', md.el).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const rows = $$('#rg-l tr', md.el).map((tr, i) => {
        const tipo = $('.rg-tipo', tr).value, id = tr.dataset.id;
        return { ...(id ? { id } : { codigo: 'fixo_' + Date.now().toString(36) + i }), empresa_id: state.empresa.id, tipo, nome: $('.rg-nome', tr).value.trim() || TIPOS[tipo], ativo: $('.rg-at', tr).checked,
          percentual: $('.rg-pct', tr) ? ($('.rg-pct', tr).value === '' ? null : +$('.rg-pct', tr).value) : null, valor_fixo: $('.rg-fixo', tr) ? (+$('.rg-fixo', tr).value || 0) : null,
          conta_debito_id: $('.rg-d', tr).value || null, conta_credito_id: $('.rg-c', tr).value || null, historico: $('.rg-hist', tr).value.trim() || null, ordem: (i + 1) * 10, atualizado_em: new Date().toISOString() };
      });
      for (const r of rows) await q(r.id ? sb.from('contab_fech_regras').update(r).eq('id', r.id) : sb.from('contab_fech_regras').insert(r));
      toast('Regras salvas'); md.close(); carregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

async function leiaute(root) {
  let c; try { [c] = await q(sb.from('contab_fech_config').select('*').eq('empresa_id', state.empresa.id)); } catch (err) { return fail(err); }
  c = c || { dom_separador: ';', dom_data: 'dd/mm/aaaa', dom_decimal: ',', dom_conta: 'codigo', dom_campos: ['data', 'debito', 'credito', 'valor', 'historico_codigo', 'complemento'], dom_cabecalho: false, dom_origens: Object.keys(ORIG), vinculos: ['clt', 'aprendiz'], tolerancia: 1 };
  const sel = (id, ops, v) => `<select id="${id}">${ops.map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const md = modal({ wide: true, title: 'Leiaute do arquivo do Domínio e parâmetros do fechamento', body: `<div class="grid2">
      <label>Separador${sel('ly-sep', [[';', 'ponto e vírgula'], [',', 'vírgula'], ['|', 'barra vertical'], ['tab', 'tabulação']], c.dom_separador)}</label>
      <label>Data${sel('ly-dt', [['dd/mm/aaaa', 'dd/mm/aaaa'], ['aaaa-mm-dd', 'aaaa-mm-dd'], ['ddmmaaaa', 'ddmmaaaa']], c.dom_data)}</label>
      <label>Decimal${sel('ly-dec', [[',', 'vírgula (1234,56)'], ['.', 'ponto (1234.56)']], c.dom_decimal)}</label>
      <label>Conta${sel('ly-ct', [['codigo', 'código reduzido'], ['classificacao', 'classificação']], c.dom_conta)}</label>
      <label>Campos, na ordem (separados por vírgula)<input id="ly-cp" value="${esc((c.dom_campos || []).join(', '))}"></label>
      <label>Código do histórico padrão<input id="ly-hc" value="${esc(c.dom_historico_codigo || '')}"></label>
      <label class="chk"><input type="checkbox" id="ly-cab" ${c.dom_cabecalho ? 'checked' : ''}> Primeira linha com os nomes dos campos</label><div></div>
      <div><b class="small">Origens exportadas</b><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">${Object.entries(ORIG).map(([k, t]) => `<label class="chk"><input type="checkbox" class="ly-or" value="${k}" ${(c.dom_origens || []).includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <div><b class="small">Vínculos na base das provisões de folha</b><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">${[['clt', 'CLT'], ['aprendiz', 'Aprendiz'], ['estagio', 'Estágio'], ['pro_labore', 'Pró-labore'], ['extra_folha', 'Extra folha']].map(([k, t]) => `<label class="chk"><input type="checkbox" class="ly-vi" value="${k}" ${(c.vinculos || []).includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <label>Tolerância da conferência bancária (R$)<input type="number" step="0.01" id="ly-tol" value="${c.tolerancia ?? 1}"></label></div>
    <p class="small muted">Campos possíveis: ${Object.entries(CAMPOS).map(([k, t]) => `<code>${k}</code> (${t.toLowerCase()})`).join(', ')}. Lançamentos com mais de duas contas saem em pares débito × crédito. Confira o leiaute de importação de lançamentos no Domínio com o contador.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ly-ok">Salvar</button>' });
  $('#ly-ok', md.el).onclick = async (ev) => {
    const campos = $('#ly-cp', md.el).value.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
    const inval = campos.filter(x => !CAMPOS[x]); if (inval.length) return toast('Campo desconhecido: ' + inval.join(', '), true);
    ev.target.disabled = true;
    try {
      await q(sb.from('contab_fech_config').upsert({ empresa_id: state.empresa.id, dom_separador: $('#ly-sep', md.el).value, dom_data: $('#ly-dt', md.el).value, dom_decimal: $('#ly-dec', md.el).value, dom_conta: $('#ly-ct', md.el).value,
        dom_campos: campos, dom_historico_codigo: $('#ly-hc', md.el).value.trim() || null, dom_cabecalho: $('#ly-cab', md.el).checked, dom_origens: $$('.ly-or:checked', md.el).map(x => x.value),
        vinculos: $$('.ly-vi:checked', md.el).map(x => x.value), tolerancia: +$('#ly-tol', md.el).value || 0, atualizado_em: new Date().toISOString() }));
      toast('Leiaute salvo'); md.close(); carregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

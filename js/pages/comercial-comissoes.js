// Comercial › Comissões (COM008) — melhoria 4.3 (SQL 130, 08/11/2026).
// Comissão pelo recebido: prévia do mês por representante, fechamento (gera o título a pagar), extrato, taxas e exceções
// por cliente e parâmetros. O representante (perfil vendas) vê só a própria prévia e o próprio extrato.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal, exportXLSX, parseNum, confirmDialog, options } from '../lib/ui.js';
import { interno } from '../lib/comercial.js';
import { competencias, totais, mesTerminou, MES } from '../lib/comissoes-calc.js';
import { abrirRelatorio } from '../lib/relatorio.js';

export const title = 'Comissões';
const ui = { aba: 'apuracao', comp: null, abertos: new Set() };
let CFG = null, V = [];
const podeConfig = () => ['admin', 'diretor'].includes(state.papel);
const podeFechar = () => state.papel === 'admin' || (CFG?.papeis_fechar || ['admin', 'diretor', 'financeiro']).includes(state.papel);
const ehRep = () => state.papel === 'vendas';
const pctTxt = (v) => String(+v).replace('.', ',') + '%';

export async function render(root) {
  const abas = ehRep() ? [['apuracao', 'Mês em andamento'], ['extrato', 'Meu extrato']] : [['apuracao', 'Apuração do mês'], ['extrato', 'Fechamentos'], ['taxas', 'Taxas e exceções'], ['par', 'Parâmetros']];
  ui.comp ||= competencias(today(), 2)[ehRep() ? 0 : 1];
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">${ehRep() ? 'Minhas comissões' : 'Comissões'}</h2><div class="muted small">Comissão pelo <b>recebido</b>: entra quando o cliente paga o título da nota de venda. Recompra depois de paga vira estorno no mês seguinte.</div></div>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="cm-xls">Excel</button>${ehRep() ? '<a class="btn ghost" href="#/comercial/carteira">Minha carteira</a>' : ''}</div></div>
    <div class="card toolbar"><div class="chips" id="cm-abas">${abas.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><label class="small" id="cm-mes">Mês <select id="cm-comp">${competencias(today(), 18).map(c => `<option value="${c}" ${c === ui.comp ? 'selected' : ''}>${MES(c)}</option>`).join('')}</select></label></div>
    <div id="cm-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#cm-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  $('#cm-comp', root).onchange = (e) => { ui.comp = e.target.value; pintar(root); };
  $('#cm-xls', root).onclick = () => exportXLSX($('#cm-corpo table', root) || [['Sem tabela nesta aba']], 'comissoes_' + ui.aba);
  if (!abas.some(([k]) => k === ui.aba)) ui.aba = 'apuracao';
  try {
    const e = state.empresa.id;
    [CFG, V] = await Promise.all([q(sb.from('comissao_config').select('*').eq('empresa_id', e)).then(r => r[0] || null).catch(() => null),
      q(sb.from('comercial_vendedores').select('*').eq('empresa_id', e).order('nome')).catch(() => [])]);
  } catch {}
  pintar(root);
}

function pintar(root) {
  const c = $('#cm-corpo', root);
  $('#cm-mes', root).hidden = !['apuracao'].includes(ui.aba);
  ({ apuracao, extrato, taxas, par })[ui.aba](c, root).catch?.(err => { fail(err); c.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. O SQL 130 já foi aplicado?</div></div>'; });
}

const tabItens = (itens) => `<div class="table-wrap"><table class="small"><thead><tr><th>Recebido em</th><th>NF</th><th>Cliente</th><th>Título</th><th class="num">Recebido</th><th class="num">Base</th><th class="num">Taxa</th><th class="num">Comissão</th></tr></thead><tbody>
  ${itens.map(i => `<tr class="${i.tipo === 'estorno' ? 'neg' : ''}"><td>${dateBR(i.recebido_em)}${i.tipo === 'estorno' ? ' <b>estorno</b>' : ''}</td><td>${i.nota_numero || ''}</td><td class="wrap">${esc(i.cliente || '')}</td><td>${esc(i.documento || '')}</td>
    <td class="num">${money(i.valor_recebido)}</td><td class="num">${money(i.base)}</td><td class="num">${pctTxt(i.pct)}${+i.reducao_pct ? `<div class="muted" title="${i.dias_atraso} dia(s) de atraso">−${pctTxt(i.reducao_pct)} atraso</div>` : ''}</td><td class="num"><b>${money(i.comissao)}</b></td></tr>`).join('')
  || '<tr><td colspan="8" class="empty">Nenhum recebimento.</td></tr>'}</tbody></table></div>`;

// ---------------------------------------------------------------- apuração (prévia) e fechamento
async function apuracao(c, root) {
  const R = await q(sb.rpc('comissao_apurar', { p_empresa: state.empresa.id, p_competencia: ui.comp }));
  const term = mesTerminou(ui.comp, today()), tot = R.reduce((s, r) => s + (r.fechamento ? +r.fechamento.total : totais(r.itens).comissao), 0);
  c.innerHTML = `${!CFG && !ehRep() ? '<div class="pt-aviso card" style="margin-bottom:12px">Revise os Parâmetros: sem eles, conta todo recebimento a partir deste mês, pela base recebida, e o fechamento não gera o título a pagar.</div>' : ''}
    <div class="kpis"><div class="kpi"><div class="k-label">Comissão de ${MES(ui.comp)}</div><div class="k-value">${money(tot)}</div><div class="k-sub">${term ? 'mês encerrado' : 'mês em andamento: prévia'}</div></div>
      <div class="kpi"><div class="k-label">Representantes</div><div class="k-value">${R.length}</div><div class="k-sub">${R.filter(r => r.fechamento).length} fechado(s)</div></div></div>
    ${R.map(r => { const t = r.fechamento ? { base: +r.fechamento.base_total, comissao: +r.fechamento.comissao_total, n: null } : totais(r.itens), ab = ui.abertos.has(r.vendedor_id) || ehRep();
      return `<div class="card" style="margin-top:12px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;cursor:pointer" data-tg="${r.vendedor_id}">
        <b style="flex:1">${esc(r.nome)}</b><span class="small muted">taxa ${pctTxt(r.pct)}</span><span class="small">base ${money(t.base)}</span><span><b>${money(r.fechamento ? r.fechamento.total : t.comissao)}</b></span>
        ${r.fechamento ? `<span class="badge pago">fechado</span>` : term ? '<span class="badge negoc">a fechar</span>' : '<span class="badge">prévia</span>'}
        ${!ehRep() && podeFechar() && !r.fechamento && term ? `<button class="btn primary small" data-fe="${r.vendedor_id}">Fechar ${MES(ui.comp)}</button>` : ''}
        ${!ehRep() && podeFechar() && r.fechamento ? `<button class="btn ghost small" data-ca="${r.fechamento.id}">Cancelar fechamento</button>` : ''}</div>
        ${r.fechamento ? `<div class="small muted" style="margin-top:4px">Fechado em ${new Date(r.fechamento.fechado_em).toLocaleString('pt-BR').slice(0, 17)} por ${esc(r.fechamento.fechado_por || '')}${+r.fechamento.ajuste ? ` · ajuste ${money(r.fechamento.ajuste)} (${esc(r.fechamento.ajuste_motivo || '')})` : ''}. Os itens estão no extrato.</div>` : ''}
        ${!r.fechamento && ab ? `<div style="margin-top:8px">${tabItens(r.itens)}</div>` : ''}</div>`; }).join('') || '<div class="card"><div class="empty">Nenhum representante ativo. Cadastre em Representantes e Metas.</div></div>'}`;
  $$('[data-tg]', c).forEach(d => d.onclick = (e) => { if (e.target.closest('button')) return; const id = d.dataset.tg; ui.abertos.has(id) ? ui.abertos.delete(id) : ui.abertos.add(id); apuracao(c, root); });
  $$('[data-fe]', c).forEach(b => b.onclick = () => fechar(R.find(r => r.vendedor_id === b.dataset.fe), c, root));
  $$('[data-ca]', c).forEach(b => b.onclick = async () => {
    const mot = prompt('Motivo do cancelamento (os recebimentos voltam para a apuração e o título a pagar em aberto é excluído):'); if (!mot) return;
    try { await q(sb.rpc('comissao_cancelar', { p_fechamento: b.dataset.ca, p_motivo: mot })); toast('Fechamento cancelado'); apuracao(c, root); } catch (err) { fail(err); } });
}
function fechar(r, c, root) {
  const t = totais(r.itens);
  const m = modal({ title: `Fechar ${MES(ui.comp)} — ${esc(r.nome)}`, body: `<p>${t.n} recebimento(s) · base ${money(t.base)} · comissão <b>${money(t.comissao)}</b>${t.estornos ? ` (estornos ${money(t.estornos)})` : ''}.</p>
    <div class="grid-form"><label class="xs">Ajuste (R$)<input id="fe-a" inputmode="decimal" placeholder="0,00"></label><label class="span2">Motivo do ajuste<input id="fe-m" placeholder="Obrigatório se houver ajuste"></label></div>
    <p class="small muted">${CFG?.plano_id ? `Gera o título a pagar da comissão para o dia ${CFG.dia_pagamento} do mês seguinte e avisa o representante.` : 'Sem a conta da despesa nos Parâmetros: o fechamento não gera o título a pagar.'} Depois de fechado, estes recebimentos não entram de novo.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fe-ok">Fechar</button>' });
  $('#fe-ok', m.el).onclick = async (ev) => { ev.target.disabled = true;
    try { await q(sb.rpc('comissao_fechar', { p_vendedor: r.vendedor_id, p_competencia: ui.comp, p_ajuste: parseNum($('#fe-a', m.el).value) || 0, p_motivo: $('#fe-m', m.el).value || null }));
      m.close(); toast('Comissão fechada'); apuracao(c, root); } catch (err) { fail(err); ev.target.disabled = false; } };
}

// ---------------------------------------------------------------- extrato
async function extrato(c) {
  const X = await q(sb.rpc('comissao_extrato', { p_empresa: state.empresa.id, p_vendedor: null }));
  c.innerHTML = X.map(f => `<div class="card" style="margin-top:12px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <b style="flex:1">${MES(f.competencia)}${ehRep() ? '' : ` — ${esc(f.vendedor)}`}</b><span class="small">base ${money(f.base_total)}</span>${+f.ajuste ? `<span class="small">ajuste ${money(f.ajuste)}</span>` : ''}<b>${money(f.total)}</b>
      ${f.lancamento_id ? (f.pago ? `<span class="badge pago">pago ${dateBR(f.pagamento)}</span>` : `<span class="badge aberto">a pagar ${dateBR(f.pagamento)}</span>`) : '<span class="badge">sem título</span>'}
      <button class="btn ghost small" data-pdf="${f.id}">Imprimir</button></div>
      <details style="margin-top:6px"><summary class="small">${f.itens.length} recebimento(s)</summary>${tabItens(f.itens)}</details></div>`).join('')
    || '<div class="card"><div class="empty">Nenhum fechamento ainda.</div></div>';
  $$('[data-pdf]', c).forEach(b => b.onclick = () => { const f = X.find(x => x.id === b.dataset.pdf), t = totais(f.itens);
    abrirRelatorio({ nome: `Comissão ${MES(f.competencia)} ${f.vendedor}`, titulo: `EXTRATO DE COMISSÃO — ${MES(f.competencia)}`, subtitulo: esc(f.vendedor),
      extraCss: '.num{text-align:right} table{width:100%;border-collapse:collapse} td,th{border:1px solid #000;padding:3px 5px;font-size:9.5pt}',
      corpo: `<h2>1. Resumo</h2><p>Recebimentos: ${t.n} · base ${money(f.base_total)} · comissão ${money(f.comissao_total)}${+f.ajuste ? ` · ajuste ${money(f.ajuste)} (${esc(f.ajuste_motivo || '')})` : ''} · <b>total ${money(f.total)}</b>.
        ${f.lancamento_id ? (f.pago ? `Pago em ${dateBR(f.pagamento)}.` : `Previsto para ${dateBR(f.pagamento)}.`) : ''}</p>
        <h2>2. Recebimentos</h2><table><thead><tr><th>Recebido em</th><th>NF</th><th>Cliente</th><th>Título</th><th class="num">Recebido</th><th class="num">Base</th><th class="num">Taxa</th><th class="num">Comissão</th></tr></thead><tbody>
        ${f.itens.map(i => `<tr><td>${dateBR(i.recebido_em)}${i.tipo === 'estorno' ? ' (estorno)' : ''}</td><td>${i.nota_numero || ''}</td><td>${esc(i.cliente || '')}</td><td>${esc(i.documento || '')}</td><td class="num">${money(i.valor_recebido)}</td>
          <td class="num">${money(i.base)}</td><td class="num">${pctTxt(i.pct)}${+i.reducao_pct ? ` −${pctTxt(i.reducao_pct)}` : ''}</td><td class="num">${money(i.comissao)}</td></tr>`).join('')}</tbody></table>`,
      rodape: `Fechado em ${new Date(f.fechado_em).toLocaleDateString('pt-BR')} por ${esc(f.fechado_por || '')}. Base: recebimentos das notas de venda na plataforma.` }); });
}

// ---------------------------------------------------------------- taxas e exceções
async function taxas(c, root) {
  const e = state.empresa.id, ed = podeConfig();
  const [EX, CL] = await Promise.all([q(sb.from('comissao_excecoes').select('*').eq('empresa_id', e)), q(sb.rpc('comercial_clientes', { p_empresa: e })).catch(() => [])]);
  const nomeCli = Object.fromEntries(CL.map(x => [x.id, x.nome])), nomeV = Object.fromEntries(V.map(x => [x.id, x.nome]));
  c.innerHTML = `<div class="grid2" style="align-items:start"><div class="card flush"><div style="padding:12px 14px 0"><h3 style="margin:0">Taxa de cada representante</h3><div class="small muted">Sobre a base de cada recebimento.</div></div>
      <div class="table-wrap"><table><thead><tr><th>Representante</th><th class="num">Taxa (%)</th></tr></thead><tbody>
      ${V.map(v => `<tr><td>${esc(v.nome)}${v.ativo ? '' : ' <span class="muted small">(inativo)</span>'}</td><td class="num"><input data-pct="${v.id}" inputmode="decimal" value="${String(+v.comissao_pct).replace('.', ',')}" style="width:80px;text-align:right" ${ed ? '' : 'disabled'}></td></tr>`).join('') || '<tr><td colspan="2" class="empty">Sem representantes.</td></tr>'}</tbody></table></div>
      ${ed ? '<div style="padding:10px;text-align:right"><button class="btn primary small" id="tx-ok">Salvar taxas</button></div>' : ''}</div>
    <div class="card flush"><div style="padding:12px 14px 0;display:flex;justify-content:space-between;align-items:center"><div><h3 style="margin:0">Exceções por cliente</h3><div class="small muted">Taxa diferente para um cliente (de um representante ou de todos).</div></div>${ed ? '<button class="btn small" id="ex-novo">Nova exceção</button>' : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Representante</th><th class="num">Taxa</th><th>Motivo</th><th></th></tr></thead><tbody>
      ${EX.map(x => `<tr><td>${esc(nomeCli[x.favorecido_id] || '—')}</td><td>${esc(x.vendedor_id ? nomeV[x.vendedor_id] || '' : 'Todos')}</td><td class="num">${pctTxt(x.pct)}</td><td class="small">${esc(x.motivo || '')}</td>
        <td>${ed ? `<button class="btn ghost small" data-rm="${x.id}">Excluir</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma exceção.</td></tr>'}</tbody></table></div></div></div>`;
  $('#tx-ok', c) && ($('#tx-ok', c).onclick = async () => {
    try { for (const i of $$('[data-pct]', c)) { const v = parseNum(i.value) || 0; if (v < 0 || v > 30) return toast('Taxa de 0 a 30%', true);
        const old = V.find(x => x.id === i.dataset.pct); if (+old.comissao_pct !== v) await q(sb.from('comercial_vendedores').update({ comissao_pct: v }).eq('id', old.id)); }
      toast('Taxas salvas'); render(root); } catch (err) { fail(err); } });
  $('#ex-novo', c) && ($('#ex-novo', c).onclick = () => {
    const m = modal({ title: 'Nova exceção', body: `<label>Cliente<input id="ex-c" list="ex-cl" placeholder="nome do cliente"><datalist id="ex-cl">${CL.map(x => `<option value="${esc(x.nome)}"></option>`).join('')}</datalist></label>
      <label style="margin-top:8px">Representante<select id="ex-v"><option value="">Todos</option>${options(V)}</select></label>
      <label style="margin-top:8px">Taxa (%)<input id="ex-p" inputmode="decimal"></label><label style="margin-top:8px">Motivo<input id="ex-m" placeholder="Ex.: cliente com preço especial"></label>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ex-ok">Salvar</button>' });
    $('#ex-ok', m.el).onclick = async () => { const cli = CL.find(x => x.nome === $('#ex-c', m.el).value), p = parseNum($('#ex-p', m.el).value);
      if (!cli) return toast('Escolha o cliente da lista', true); if (!(p >= 0 && p <= 30)) return toast('Taxa de 0 a 30%', true);
      try { await q(sb.from('comissao_excecoes').insert({ empresa_id: e, favorecido_id: cli.id, vendedor_id: $('#ex-v', m.el).value || null, pct: p, motivo: $('#ex-m', m.el).value.trim() || null })); m.close(); taxas(c, root); } catch (err) { fail(err); } };
  });
  $$('[data-rm]', c).forEach(b => b.onclick = async () => { if (!await confirmDialog('Excluir esta exceção?')) return; try { await q(sb.from('comissao_excecoes').delete().eq('id', b.dataset.rm)); taxas(c, root); } catch (err) { fail(err); } });
}

// ---------------------------------------------------------------- parâmetros
async function par(c, root) {
  const p = { base: 'recebido', fidc_regra: 'cessao', fidc_carencia_dias: 5, atraso_dias: 0, atraso_reducao_pct: 0, inicio: competencias(today(), 1)[0], plano_id: null, dia_pagamento: 10, papeis_fechar: ['admin', 'diretor', 'financeiro'], ...(CFG || {}) };
  const ed = podeConfig(), dis = ed ? '' : 'disabled';
  const PL = await q(sb.from('plano_contas').select('id,codigo,nome').eq('empresa_id', state.empresa.id).eq('tipo', 'S').eq('nivel', 2).order('codigo')).catch(() => []);
  c.innerHTML = `<div class="card"><form id="cpp"><div class="grid-form">
      <label class="span2">Base da comissão<select name="base" ${dis}><option value="recebido" ${p.base === 'recebido' ? 'selected' : ''}>O valor recebido</option><option value="sem_impostos" ${p.base === 'sem_impostos' ? 'selected' : ''}>O recebido sem IPI e ST (na proporção da nota)</option></select></label>
      <label class="span2">Título cedido ao FIDC conta<select name="fidc" ${dis}><option value="cessao" ${p.fidc_regra === 'cessao' ? 'selected' : ''}>Na cessão (quando a empresa recebe do fundo)</option><option value="vencimento" ${p.fidc_regra === 'vencimento' ? 'selected' : ''}>No vencimento + carência, se não houver recompra</option></select></label>
      <label class="xs">Carência do FIDC (dias)<input name="car" type="number" min="0" max="60" value="${p.fidc_carencia_dias}" ${dis}></label>
      <label class="xs">Reduz se pago com mais de (dias de atraso)<input name="ad" type="number" min="0" max="365" value="${p.atraso_dias}" ${dis}></label>
      <label class="xs">Redução (%)<input name="ar" inputmode="decimal" value="${String(+p.atraso_reducao_pct).replace('.', ',')}" ${dis}></label>
      <label class="xs">Contar recebimentos a partir de<input name="ini" type="date" value="${p.inicio}" ${dis}></label>
      <label class="span2">Conta da despesa (gera o título a pagar)<select name="pl" ${dis}><option value="">— não gerar —</option>${PL.map(x => `<option value="${x.id}" ${p.plano_id === x.id ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nome)}</option>`).join('')}</select></label>
      <label class="xs">Dia do pagamento<input name="dia" type="number" min="1" max="28" value="${p.dia_pagamento}" ${dis}></label></div>
    <div class="small" style="margin-top:10px">Quem fecha o mês:</div><div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">${[['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro']].map(([k, t]) => `<label class="chk" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="pf" value="${k}" ${k === 'admin' ? 'checked disabled' : p.papeis_fechar.includes(k) ? 'checked' : ''} ${dis}> ${t}</label>`).join('')}</div>
    <p class="small muted">Taxa do representante e exceções por cliente na aba Taxas e exceções. ${ed ? '' : 'Só administrador e diretor alteram.'}</p>
    ${ed ? '<div style="text-align:right"><button class="btn primary" type="button" id="cpp-ok">Salvar parâmetros</button></div>' : ''}</form></div>`;
  $('#cpp-ok', c) && ($('#cpp-ok', c).onclick = async () => { const f = $('#cpp', c);
    const reg = { empresa_id: state.empresa.id, base: f.base.value, fidc_regra: f.fidc.value, fidc_carencia_dias: +f.car.value || 0, atraso_dias: +f.ad.value || 0, atraso_reducao_pct: parseNum(f.ar.value) || 0,
      inicio: f.ini.value || p.inicio, plano_id: f.pl.value || null, dia_pagamento: Math.min(28, Math.max(1, +f.dia.value || 10)), papeis_fechar: ['admin', ...$$('input[name=pf]:checked:not([disabled])', c).map(x => x.value)], atualizado_em: new Date().toISOString() };
    if (reg.atraso_reducao_pct < 0 || reg.atraso_reducao_pct > 100) return toast('Redução de 0 a 100%', true);
    try { await q(sb.from('comissao_config').upsert(reg)); toast('Parâmetros salvos'); render(root); } catch (err) { fail(err); } });
}

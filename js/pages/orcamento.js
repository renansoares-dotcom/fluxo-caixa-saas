import { sb, state, q, fetchAll, podeEditar, soma, z, mesesHeader } from '../lib/data.js';
import { $, $$, esc, money, money0, cls, parseNum, fail, toast, loading, exportXLSX, modal, chart, COR, moneyTick, MESES, MESES_CURTO } from '../lib/ui.js';

const gestor = () => ['admin', 'diretor', 'financeiro'].includes(state.papel);
const METODOS = { tendencia: 'Budget × tendência do realizado', media: 'Média dos últimos meses realizados', budget: 'Budget dos meses seguintes', manter: 'Manter o forecast dos meses seguintes' };

export const title = 'Budget / Forecast';
let cenario = 'budget';
let atual = {};   // `${plano}|${mes}` -> {id, valor}
let edit = {};    // `${plano}|${mes}` -> valor

export async function render(root) {
  const qc = new URLSearchParams(location.hash.split('?')[1] || '').get('cen'); if (qc === 'forecast' || qc === 'budget') { cenario = qc; history.replaceState(null, '', '#/orcamento'); }
  root.innerHTML = `<div class="card"><div class="toolbar">
      <label>Cenário<select id="cen"><option value="budget">Budget (planejamento inicial)</option><option value="forecast" ${cenario === 'forecast' ? 'selected' : ''}>Forecast (revisão)</option></select></label>
      <span class="spacer"></span>
      ${gestor() && cenario === 'forecast' ? '<button class="btn primary" id="rolar">Atualizar pelo realizado…</button><button class="btn" id="versoes">Versões</button>' : ''}
      ${gestor() ? '<button class="btn" id="ccs">Centros de custo e aprovação</button><button class="btn" id="opar">Parâmetros</button>' : ''}
      ${podeEditar() ? `<button class="btn" id="copiar">${cenario === 'forecast' ? 'Copiar budget → forecast' : 'Copiar realizado do ano anterior'}</button>
      <button class="btn" id="exp">Exportar Excel</button><button class="btn primary" id="salvar" disabled>Salvar alterações</button>` : '<button class="btn" id="exp">Exportar Excel</button>'}
    </div>
    <p class="muted small" style="margin:10px 0 0">Valores positivos. Entradas somam e saídas subtraem automaticamente pelo plano de contas. Use Tab para navegar entre as células; cole valores do Excel normalmente.</p></div>
    <div id="status-box"></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>`;
  $('#cen', root).onchange = (e) => { cenario = e.target.value; edit = {}; render(root); };
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), `${cenario}_${state.ano}`);
  $('#rolar', root) && ($('#rolar', root).onclick = () => rolar(root));
  $('#versoes', root) && ($('#versoes', root).onclick = () => versoes());
  $('#ccs', root) && ($('#ccs', root).onclick = () => centrosCusto());
  $('#opar', root) && ($('#opar', root).onclick = () => parametros());
  if (podeEditar()) {
    $('#salvar', root).onclick = () => salvar(root);
    $('#copiar', root).onclick = () => copiar(root);
  }
  await load(root);
}

async function load(root) {
  const tbl = $('#tbl', root); loading(tbl);
  try {
    const rows = await fetchAll(() => sb.from('orcamentos').select('id,plano_id,mes,valor,centro_custo_id')
      .eq('empresa_id', state.empresa.id).eq('cenario', cenario).eq('ano', state.ano));
    atual = {}; const comCC = {};
    for (const r of rows) {
      const k = `${r.plano_id}|${r.mes}`;
      if (r.centro_custo_id) { comCC[k] = (comCC[k] || 0) + +r.valor; continue; }
      atual[k] = { id: r.id, valor: +r.valor };
    }
    if (cenario === 'forecast') await statusBox(root);
    const c = state.cad, ed = podeEditar();
    const val = (p, m) => edit[`${p}|${m}`] ?? atual[`${p}|${m}`]?.valor ?? 0;
    let body = '';
    for (const [t, nome] of [['E', 'ENTRADAS'], ['S', 'SAÍDAS']]) {
      const totT = z();
      let sec = '';
      for (const cl of c.classes.filter(x => x.tipo === t)) {
        const filhos = c.contasPlano.filter(p => p.pai_id === cl.id && p.ativo);
        if (!filhos.length) continue;
        const totC = z();
        let lin = '';
        for (const p of filhos) {
          const v = Array.from({ length: 12 }, (_, i) => val(p.id, i + 1));
          v.forEach((x, i) => { totC[i] += x; totT[i] += x; });
          lin += `<tr data-p="${p.id}"><td class="sticky" style="padding-left:22px">${esc(p.label)}</td>
            ${v.map((x, i) => `<td class="num">${ed ? `<input class="cell" data-m="${i + 1}" value="${x ? money(x) : ''}">` : money(x)}${comCC[`${p.id}|${i + 1}`] ? `<div class="muted small">+${money(comCC[`${p.id}|${i + 1}`])} por C.C.</div>` : ''}</td>`).join('')}
            <td class="num"><strong>${money(soma(v))}</strong></td></tr>`;
        }
        sec += `<tr class="row-l1"><td class="sticky">${esc(cl.label)}</td>${totC.map(x => `<td class="num">${money(x)}</td>`).join('')}<td class="num">${money(soma(totC))}</td></tr>` + lin;
      }
      body += `<tr class="row-sec"><td class="sticky">${nome}</td>${totT.map(x => `<td class="num">${money(x)}</td>`).join('')}<td class="num">${money(soma(totT))}</td></tr>` + sec;
    }
    tbl.innerHTML = `<table><thead><tr><th class="sticky">${cenario.toUpperCase()} ${state.ano}</th>${mesesHeader('<th class="num">TOTAL</th>')}</tr></thead><tbody>${body}</tbody></table>`;
    if (ed) {
      tbl.oninput = (e) => {
        if (!e.target.matches('input.cell')) return;
        const p = e.target.closest('tr').dataset.p, m = e.target.dataset.m;
        edit[`${p}|${m}`] = parseNum(e.target.value);
        $('#salvar', root).disabled = false;
        $('#salvar', root).textContent = `Salvar alterações (${Object.keys(edit).length})`;
      };
      tbl.onpaste = (e) => { // colar bloco do Excel
        if (!e.target.matches('input.cell')) return;
        const txt = e.clipboardData.getData('text'); if (!txt.includes('\t') && !txt.includes('\n')) return;
        e.preventDefault();
        const linhas = txt.replace(/\r/g, '').split('\n').filter(Boolean).map(l => l.split('\t'));
        let tr = e.target.closest('tr'); const m0 = +e.target.dataset.m;
        for (const l of linhas) {
          if (!tr) break;
          if (tr.dataset.p) l.forEach((v, j) => { const inp = $(`input[data-m="${m0 + j}"]`, tr); if (inp) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); } });
          do { tr = tr.nextElementSibling; } while (tr && !tr.dataset.p);
        }
      };
    }
  } catch (e) { fail(e); }
}

async function statusBox(root) {
  const box = $('#status-box', root);
  let st = await q(sb.from('forecast_status').select('*').eq('empresa_id', state.empresa.id).eq('ano', state.ano));
  const by = Object.fromEntries(st.map(s => [s.mes, s.status]));
  box.innerHTML = `<div class="card"><h3>Status de cada mês no forecast</h3>
    <p class="muted small" style="margin-top:0">Realizado = usa o caixa real · Prev. Ajustada = usa os valores deste forecast · Prev. Inicial = mantém o budget. Usado em Orçado x Realizado.</p>
    <div class="table-wrap"><table><thead><tr>${MESES.map(m => `<th>${m.slice(0, 3)}</th>`).join('')}</tr></thead><tbody><tr>
    ${MESES.map((_, i) => `<td><select data-m="${i + 1}" ${podeEditar() ? '' : 'disabled'}>${['Realizado', 'Prev. Ajustada', 'Prev. Inicial'].map(s => `<option ${(by[i + 1] || 'Prev. Ajustada') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>`).join('')}
    </tr></tbody></table></div></div>`;
  box.onchange = async (e) => {
    try {
      await q(sb.from('forecast_status').upsert({ empresa_id: state.empresa.id, ano: state.ano, mes: +e.target.dataset.m, status: e.target.value }));
      toast('Status atualizado');
    } catch (err) { fail(err); }
  };
}

async function salvar(root) {
  const ins = [], upd = [], del = [];
  for (const [k, v] of Object.entries(edit)) {
    const [plano_id, mes] = k.split('|'); const ex = atual[k];
    if (ex && !v) del.push(ex.id);
    else if (ex) upd.push({ id: ex.id, valor: v });
    else if (v) ins.push({ empresa_id: state.empresa.id, cenario, ano: state.ano, mes: +mes, plano_id, valor: v });
  }
  try {
    if (del.length) await q(sb.from('orcamentos').delete().in('id', del));
    for (let i = 0; i < ins.length; i += 500) await q(sb.from('orcamentos').insert(ins.slice(i, i + 500)));
    await Promise.all(upd.map(u => q(sb.from('orcamentos').update({ valor: u.valor }).eq('id', u.id))));
    edit = {}; toast('Orçamento salvo'); render(root);
  } catch (e) { fail(e); }
}

async function copiar(root) {
  const e = state.empresa.id;
  try {
    let origem;
    if (cenario === 'forecast') {
      if (!confirm('Substituir todo o forecast deste ano pelos valores do budget?')) return;
      origem = (await fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor,centro_custo_id').eq('empresa_id', e).eq('cenario', 'budget').eq('ano', state.ano)));
    } else {
      if (!confirm(`Preencher o budget ${state.ano} com o realizado de ${state.ano - 1}? (substitui o budget atual)`)) return;
      const r = await q(sb.rpc('resumo_mensal', { p_empresa: e, p_ano: state.ano - 1 }));
      origem = r.filter(x => state.cad.planoById[x.plano_id]?.tipo !== 'T').map(x => ({ plano_id: x.plano_id, mes: x.mes, valor: Math.abs(+x.total), centro_custo_id: null }));
    }
    await q(sb.from('orcamentos').delete().eq('empresa_id', e).eq('cenario', cenario).eq('ano', state.ano));
    const rows = origem.filter(o => +o.valor).map(o => ({ empresa_id: e, cenario, ano: state.ano, mes: o.mes, plano_id: o.plano_id, centro_custo_id: o.centro_custo_id, valor: +o.valor }));
    for (let i = 0; i < rows.length; i += 500) await q(sb.from('orcamentos').insert(rows.slice(i, i + 500)));
    edit = {}; toast(`${rows.length} valores copiados`); render(root);
  } catch (err) { fail(err); }
}

// =====================================================================
// Forecast contínuo (melhoria 3.10): atualizar pelo realizado, versões, centros de custo com aprovação e parâmetros
// =====================================================================
async function config() {
  const c = await q(sb.from('orcamento_config').select('*').eq('empresa_id', state.empresa.id).maybeSingle()).catch(() => undefined);
  if (c === undefined) { toast('Esta função precisa do SQL 108.', true); return null; }
  return { tol_pct: 10, tol_valor: 5000, base_comparacao: 'budget', exigir_justificativa: true, prazo_justificar: 4, avisar: true, avisar_papeis: ['financeiro'],
    rolar_ao_fechar: true, metodo: 'tendencia', media_meses: 3, tendencia_limite: 30, ...(c || {}) };
}

async function rolar(root) {
  const c = await config(); if (!c) return;
  const hoje = new Date(), ultimo = state.ano < hoje.getFullYear() ? 12 : state.ano === hoje.getFullYear() ? Math.max(1, hoje.getMonth()) : 0;
  if (!ultimo) return toast('O ano ainda não começou: não há realizado.', true);
  const m = modal({ title: `Atualizar o forecast ${state.ano} pelo realizado`, body: `
    <p class="small muted" style="margin-top:0">Os meses até o escolhido passam a ser o <b>realizado pago</b> (por conta, sem centro de custo). Os meses seguintes são projetados pelo método. Antes e depois fica guardada uma versão para comparar.</p>
    <div class="grid-form"><label>Realizado até<select id="rl-ate">${MESES.map((n, i) => i < ultimo ? `<option value="${i + 1}" ${i + 1 === ultimo ? 'selected' : ''}>${n.charAt(0)}${n.slice(1).toLowerCase()}</option>` : '').join('')}</select></label>
      <label>Meses seguintes<select id="rl-met">${Object.entries(METODOS).map(([k, l]) => `<option value="${k}" ${k === c.metodo ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Média de quantos meses<input id="rl-n" type="number" min="1" max="12" value="${c.media_meses}"></label></div>
    <p class="small" id="rl-exp"></p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rl-ok">Atualizar o forecast</button>' });
  const exp = () => { const k = $('#rl-met', m.el).value; $('#rl-n', m.el).closest('label').style.display = k === 'media' ? '' : 'none';
    $('#rl-exp', m.el).textContent = { tendencia: `Cada conta: budget do mês × (realizado ÷ budget acumulados até o mês), com ajuste de no máximo ±${c.tendencia_limite}% (Parâmetros).`,
      media: 'Cada conta: a média do realizado nos últimos meses, repetida até dezembro.', budget: 'Os meses seguintes voltam a ser o budget (com os centros de custo do budget).',
      manter: 'Os meses seguintes ficam como estão; só os meses realizados mudam.' }[k]; };
  $('#rl-met', m.el).onchange = exp; exp();
  $('#rl-ok', m.el).onclick = async () => {
    try {
      const r = await q(sb.rpc('forecast_rolar', { p_empresa: state.empresa.id, p_ano: state.ano, p_ate: +$('#rl-ate', m.el).value, p_metodo: $('#rl-met', m.el).value, p_meses: +$('#rl-n', m.el).value }));
      toast(`Forecast atualizado: ${r.realizado} valor(es) realizados e ${r.projetado} projetados`); m.close(); edit = {}; render(root);
    } catch (e) { fail(e); }
  };
}

async function versoes() {
  let V, B;
  try {
    [V, B] = await Promise.all([q(sb.from('forecast_versoes').select('*').eq('empresa_id', state.empresa.id).eq('ano', state.ano).order('criado_em', { ascending: false })),
      fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor').eq('empresa_id', state.empresa.id).eq('cenario', 'budget').eq('ano', state.ano))]);
  } catch (e) { return fail(/forecast_versoes/.test(e.message || '') ? new Error('Esta função precisa do SQL 108.') : e); }
  if (!V.length) return toast('Ainda não há versões: use "Atualizar pelo realizado".', true);
  const c = state.cad, tipo = (p) => c.planoById[p]?.tipo;
  const serie = (dados) => { const r = Array(12).fill(0); for (const d of dados) { const t = tipo(d.p ?? d.plano_id); const v = +(d.v ?? d.valor); if (t === 'E') r[(d.m ?? d.mes) - 1] += v; else if (t === 'S') r[(d.m ?? d.mes) - 1] -= v; } return r; };
  const res = (s) => s.reduce((a, b) => a + b, 0);
  const sB = serie(B), cores = ['#2563eb', '#9333ea', '#16a34a', '#ea580c', '#0891b2', '#db2777'];
  const ult = V.slice(0, 5).reverse();
  const nomeV = (v) => v.ref_mes ? `Real até ${MESES_CURTO[v.ref_mes - 1]} · ${new Date(v.criado_em).toLocaleDateString('pt-BR')}` : `Inicial · ${new Date(v.criado_em).toLocaleDateString('pt-BR')}`;
  const motivo = { inicial: 'antes da 1ª atualização', manual: 'atualizado na tela', fechamento: 'ao fechar o mês' };
  const m = modal({ title: `Versões do forecast ${state.ano}`, wide: true, body: `
    <p class="small muted" style="margin-top:0">Resultado do mês (entradas − saídas) em cada versão, com o budget como referência. O gráfico mostra as 5 versões mais recentes.</p>
    <canvas id="vs-ch" height="110"></canvas>
    <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Versão</th><th>Origem</th><th>Método</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado do ano</th><th class="num">× budget</th></tr></thead><tbody>
      ${V.map(v => { const r = +v.entradas - +v.saidas; return `<tr><td class="nowrap">${esc(nomeV(v))}</td><td class="small">${motivo[v.motivo] || v.motivo}</td><td class="small">${esc(METODOS[v.metodo] || '—')}</td>
        <td class="num">${money0(v.entradas)}</td><td class="num">${money0(v.saidas)}</td><td class="num ${r < 0 ? 'neg' : ''}"><b>${money0(r)}</b></td><td class="num ${r - res(sB) < 0 ? 'neg' : 'pos'}">${money0(r - res(sB))}</td></tr>`; }).join('')}
      <tr class="row-total"><td>Budget</td><td></td><td></td><td></td><td></td><td class="num">${money0(res(sB))}</td><td></td></tr></tbody></table></div>`,
    foot: '<button class="btn" id="vs-exp">Exportar Excel</button><button class="btn" data-close>Fechar</button>' });
  chart($('#vs-ch', m.el), { type: 'line', data: { labels: MESES_CURTO, datasets: [
    { label: 'Budget', data: sB, borderColor: '#98a2b3', borderDash: [5, 4], pointRadius: 0 },
    ...ult.map((v, i) => ({ label: nomeV(v), data: serie(v.dados), borderColor: cores[i % cores.length], backgroundColor: cores[i % cores.length], tension: .25, pointRadius: 2 })),
  ] }, options: { plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money0(x.raw)}` } } }, scales: { y: { ticks: { callback: moneyTick } } } } });
  $('#vs-exp', m.el).onclick = () => exportXLSX([['Versão', ...MESES_CURTO, 'Ano'], ['Budget', ...sB, res(sB)], ...V.map(v => { const s = serie(v.dados); return [nomeV(v), ...s, res(s)]; })], `versoes_forecast_${state.ano}`);
}

async function centrosCusto() {
  const e = state.empresa.id;
  let CC, AP, MB;
  try {
    [CC, AP, MB] = await Promise.all([
      q(sb.from('centros_custo').select('id,nome,ativo,responsavel').eq('empresa_id', e).order('nome')),
      q(sb.from('orcamento_cc_aprovacoes').select('*').eq('empresa_id', e).eq('ano', state.ano)),
      q(sb.rpc('listar_membros', { p_empresa: e })).catch(() => []),
    ]);
  } catch (er) { return fail(/responsavel|orcamento_cc/.test(er.message || '') ? new Error('Esta função precisa do SQL 108.') : er); }
  CC = CC.filter(x => x.ativo);
  const totais = {};
  await Promise.all(CC.map(async (c) => { const v = await q(sb.rpc('orcamento_cc_valores', { p_empresa: e, p_ano: state.ano, p_cenario: cenario, p_cc: c.id })).catch(() => []); totais[c.id] = v.reduce((s, x) => s + +x.valor, 0); }));
  const ap = (id) => AP.find(a => a.centro_custo_id === id && a.cenario === cenario);
  const SIT = { enviado: ['aguardando o responsável', 'aberto'], aprovado: ['aprovado', 'pago'], devolvido: ['devolvido', 'vencido'] };
  const m = modal({ title: `Orçamento por centro de custo — ${cenario} ${state.ano}`, wide: true, body: `
    <p class="small muted" style="margin-top:0">Total de cada centro = valores lançados direto no centro + a parte do rateio (Controle Orçamentário › Rateio). Escolha o responsável e envie para ele aprovar: ele recebe o aviso e vê o orçamento em <b>Orçamento do meu centro</b>, mesmo sem acesso ao financeiro.</p>
    <div class="table-wrap"><table id="cc-t"><thead><tr><th>Centro de custo</th><th>Responsável</th><th class="num">Total do ano</th><th>Aprovação</th><th></th></tr></thead><tbody>
    ${CC.map(c => { const a = ap(c.id), s = a && SIT[a.situacao], mudou = a && Math.abs(+a.total - totais[c.id]) > 0.5; return `<tr data-id="${c.id}"><td><b>${esc(c.nome)}</b></td>
      <td><select class="cc-r"><option value="">— sem responsável —</option>${MB.map(x => `<option value="${x.user_id}" ${x.user_id === c.responsavel ? 'selected' : ''}>${esc(x.nome || x.email)}</option>`).join('')}</select></td>
      <td class="num">${money0(totais[c.id])}</td>
      <td>${s ? `<span class="badge ${s[1]}">${s[0]}</span>${mudou ? ' <span class="badge vencido" title="O total mudou depois do envio">mudou</span>' : ''}${a.comentario ? `<div class="small muted">${esc(a.comentario)}</div>` : ''}` : '<span class="muted small">não enviado</span>'}</td>
      <td class="nowrap"><button class="btn small" data-env ${totais[c.id] ? '' : 'disabled'}>${a ? 'Reenviar' : 'Enviar para aprovação'}</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nenhum centro de custo ativo.</td></tr>'}
    </tbody></table></div>`, foot: '<button class="btn" data-close>Fechar</button>' });
  m.el.querySelector('tbody').onchange = async (ev) => {
    const s = ev.target.closest('.cc-r'); if (!s) return; const id = s.closest('tr').dataset.id;
    try { await q(sb.from('centros_custo').update({ responsavel: s.value || null }).eq('id', id)); toast('Responsável salvo'); } catch (er) { fail(er); }
  };
  m.el.querySelector('tbody').onclick = async (ev) => {
    if (!ev.target.closest('[data-env]')) return; const id = ev.target.closest('tr').dataset.id;
    try { await q(sb.rpc('orcamento_cc_enviar', { p_empresa: e, p_ano: state.ano, p_cenario: cenario, p_cc: id })); toast('Enviado ao responsável'); m.close(); centrosCusto(); } catch (er) { fail(er); }
  };
}

async function parametros() {
  const c = await config(); if (!c) return;
  const pap = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro']];
  const m = modal({ title: 'Parâmetros do orçamento', body: `<h3 class="nc-h" style="margin-top:0">Desvios e justificativa</h3><div class="grid-form">
      <label>Tolerância (%)<input id="op-tp" inputmode="decimal" value="${String(c.tol_pct).replace('.', ',')}"></label>
      <label>Tolerância (R$)<input id="op-tv" inputmode="decimal" value="${money(c.tol_valor)}"></label>
      <label>Comparar o realizado com<select id="op-base"><option value="budget" ${c.base_comparacao === 'budget' ? 'selected' : ''}>Budget</option><option value="forecast" ${c.base_comparacao === 'forecast' ? 'selected' : ''}>Forecast</option></select></label>
      <label>Prazo para justificar (D+)<input id="op-pz" type="number" min="1" max="20" value="${c.prazo_justificar}"></label>
      <label class="chk span2"><input type="checkbox" id="op-ex" ${c.exigir_justificativa ? 'checked' : ''}> Desvio fora da tolerância exige justificativa (entra no checklist do fechamento)</label>
      <label class="chk span2"><input type="checkbox" id="op-av" ${c.avisar ? 'checked' : ''}> Cobrar no prazo quem justifica:</label>
      <div class="span2 fc-chks">${pap.map(([k, l]) => `<label class="chk"><input type="checkbox" class="op-p" value="${k}" ${c.avisar_papeis.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
    <h3 class="nc-h">Forecast contínuo</h3><div class="grid-form">
      <label class="chk span2"><input type="checkbox" id="op-rf" ${c.rolar_ao_fechar ? 'checked' : ''}> Atualizar o forecast sozinho quando o mês for fechado</label>
      <label class="span2">Método padrão dos meses seguintes<select id="op-met">${Object.entries(METODOS).map(([k, l]) => `<option value="${k}" ${k === c.metodo ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Média de quantos meses<input id="op-n" type="number" min="1" max="12" value="${c.media_meses}"></label>
      <label>Ajuste máximo da tendência (±%)<input id="op-lim" type="number" min="0" max="100" value="${c.tendencia_limite}"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="op-ok">Salvar</button>' });
  $('#op-ok', m.el).onclick = async () => {
    const reg = { empresa_id: state.empresa.id, tol_pct: parseNum($('#op-tp', m.el).value), tol_valor: parseNum($('#op-tv', m.el).value), base_comparacao: $('#op-base', m.el).value,
      prazo_justificar: +$('#op-pz', m.el).value, exigir_justificativa: $('#op-ex', m.el).checked, avisar: $('#op-av', m.el).checked,
      avisar_papeis: $$('.op-p', m.el).filter(i => i.checked).map(i => i.value), rolar_ao_fechar: $('#op-rf', m.el).checked, metodo: $('#op-met', m.el).value,
      media_meses: +$('#op-n', m.el).value, tendencia_limite: +$('#op-lim', m.el).value };
    if (!(reg.tol_pct >= 0) || !(reg.tol_valor >= 0)) return toast('Confira as tolerâncias', true);
    if (!(reg.prazo_justificar >= 1 && reg.prazo_justificar <= 20)) return toast('O prazo vai de D+1 a D+20', true);
    if (reg.avisar && !reg.avisar_papeis.length) return toast('Escolha quem é cobrado', true);
    try { await q(sb.from('orcamento_config').upsert(reg, { onConflict: 'empresa_id' })); toast('Parâmetros salvos'); m.close(); } catch (e) { fail(e); }
  };
}

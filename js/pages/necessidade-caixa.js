// Necessidade de caixa: próximas 13 semanas a partir do saldo de hoje.
// Saldo das contas escolhidas + recebimentos em aberto − pagamentos em aberto + compromissos programados
// (+ o que o forecast ainda espera e não foi lançado, se marcado) → saldo projetado por semana × caixa mínimo.
// Quando falta caixa, sugere títulos a receber para antecipar (leva para Propostas de borderô).
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, money0, dateBR, fail, loading, modal, chart, moneyTick, COR, exportXLSX, parseNum, today, toast, confirmDialog } from '../lib/ui.js';

export const title = 'Necessidade de caixa';

const SEMANAS = 13;
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
             set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const iso = (d) => d.toISOString().slice(0, 10);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const segunda = (s) => { const d = new Date(s + 'T12:00:00'); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const fimMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12
const ddmm = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);

const ui = { forecast: ls.get('nc-forecast', true), vencidos: ls.get('nc-vencidos', true) };
let D = null;

async function carregar() {
  const e = state.empresa.id, hoje = today();
  const ini = segunda(hoje), fim = addDias(ini, SEMANAS * 7 - 1);
  const meses = []; for (let d = new Date(hoje.slice(0, 7) + '-01T12:00:00'); iso(d) <= fim; d.setMonth(d.getMonth() + 1)) meses.push([d.getFullYear(), d.getMonth() + 1]);
  const [saldos, abertos, comp, fc, lancMes] = await Promise.all([
    q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: hoje })),
    fetchAll(() => sb.from('lancamentos').select('id,data,valor,plano_id,favorecido_id,descricao,documento,conta_id,fidc_proposta_id').eq('empresa_id', e).eq('status', 'Em aberto').lte('data', fim).order('data').order('id')),
    q(sb.from('caixa_compromissos').select('*').eq('empresa_id', e).order('inicio')).catch(err => (/caixa_compromissos/.test(err.message || '') ? null : Promise.reject(err))),
    fetchAll(() => sb.from('orcamentos').select('plano_id,ano,mes,valor').eq('empresa_id', e).eq('cenario', 'forecast').in('ano', [...new Set(meses.map(m => m[0]))]).order('id')),
    fetchAll(() => sb.from('lancamentos').select('plano_id,valor,data').eq('empresa_id', e).gte('data', `${meses[0][0]}-${String(meses[0][1]).padStart(2, '0')}-01`).lte('data', `${fim.slice(0, 7)}-${String(fimMes(+fim.slice(0, 4), +fim.slice(5, 7))).padStart(2, '0')}`).order('id')),
  ]);
  D = { hoje, ini, fim, meses, saldos, abertos, comp, fc: fc.filter(o => meses.some(([y, m]) => o.ano === y && o.mes === m)), lancMes };
}

function calcular(contasSel, minimo) {
  const c = state.cad, { hoje, ini, meses } = D;
  const semanas = Array.from({ length: SEMANAS }, (_, i) => ({ ini: addDias(ini, i * 7), fim: addDias(ini, i * 7 + 6), ent: 0, sai: 0, fc: 0, comp: 0, itens: [] }));
  const idx = (d) => { if (d < ini) return 0; const i = Math.floor((new Date(d + 'T12:00:00') - new Date(ini + 'T12:00:00')) / (7 * 864e5)); return i < SEMANAS ? i : -1; };
  const sinal = (pid) => c.planoById[pid]?.natureza === 'C' ? 1 : -1;
  const tipo = (pid) => c.planoById[pid]?.tipo;
  const saldoIni = D.saldos.filter(s => contasSel.has(s.conta_id)).reduce((s, x) => s + +x.saldo_pago, 0);

  // 1) lançamentos em aberto (vencidos entram na 1ª semana, se marcado)
  let vencidos = 0;
  for (const l of D.abertos) {
    if (tipo(l.plano_id) === 'T') continue;
    if (l.data < hoje && !ui.vencidos) continue;
    const i = idx(l.data); if (i < 0) continue;
    const v = sinal(l.plano_id) * +l.valor;
    if (l.data < hoje) vencidos += v;
    if (v > 0) semanas[i].ent += v; else semanas[i].sai += v;
    semanas[i].itens.push({ tipo: 'lanc', data: l.data, v, l });
  }
  // 2) compromissos programados
  for (const k of D.comp || []) {
    if (!k.ativo) continue;
    for (const [y, m] of meses) {
      const dia = Math.min(k.dia, fimMes(y, m)); const dt = `${y}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (dt < hoje || dt < k.inicio || (k.fim && dt > k.fim)) continue;
      const i = idx(dt); if (i < 0) continue;
      const v = (k.natureza === 'E' ? 1 : -1) * +k.valor;
      semanas[i].comp += v; semanas[i].itens.push({ tipo: 'comp', data: dt, v, k });
    }
  }
  // 3) forecast ainda não lançado (por classificação e mês), espalhado pelos dias que faltam do mês
  if (ui.forecast) {
    const lanc = {};
    for (const l of D.lancMes) { const k = l.plano_id + '|' + l.data.slice(0, 7); lanc[k] = (lanc[k] || 0) + +l.valor; }
    for (const o of D.fc) {
      if (!['E', 'S'].includes(tipo(o.plano_id))) continue;
      const mk = `${o.ano}-${String(o.mes).padStart(2, '0')}`;
      const resto = Math.abs(+o.valor) - (lanc[o.plano_id + '|' + mk] || 0);
      if (resto <= 0.005) continue;
      const d0 = mk + '-01' > hoje ? mk + '-01' : hoje, dN = `${mk}-${String(fimMes(o.ano, o.mes)).padStart(2, '0')}`;
      if (d0 > dN) continue;
      const dias = []; for (let d = d0; d <= dN; d = addDias(d, 1)) dias.push(d);
      const por = resto / dias.length, s = sinal(o.plano_id);
      const porSemana = {};
      for (const d of dias) { const i = idx(d); if (i >= 0) porSemana[i] = (porSemana[i] || 0) + por; }
      for (const [i, v] of Object.entries(porSemana)) { semanas[i].fc += s * v; semanas[i].itens.push({ tipo: 'fc', data: mk, v: s * v, plano_id: o.plano_id }); }
    }
  }
  let saldo = saldoIni;
  for (const w of semanas) { w.res = w.ent + w.sai + w.fc + w.comp; w.saldoIni = saldo; saldo += w.res; w.saldo = saldo; w.abaixo = saldo < minimo; w.falta = Math.max(0, minimo - saldo); }
  return { semanas, saldoIni, vencidos };
}

// títulos a receber em aberto, fora de proposta, que vencem depois da semana crítica (candidatos a antecipar)
function candidatos(w, falta) {
  const c = state.cad;
  const lista = D.abertos.filter(l => c.planoById[l.plano_id]?.codigo?.startsWith('1.01') && !l.fidc_proposta_id && l.data > w.fim)
    .sort((a, b) => a.data.localeCompare(b.data));
  const sel = []; let s = 0;
  for (const l of lista) { if (s >= falta) break; sel.push(l); s += +l.valor; }
  return { sel, soma: s, total: lista.reduce((t, l) => t + +l.valor, 0), qtd: lista.length };
}

// resumo para a Minha Manhã (usa as mesmas escolhas salvas na tela)
export async function resumoNecessidade() {
  await carregar();
  const salvas = ls.get('nc-contas', null);
  const sel = new Set(salvas ? salvas : D.saldos.filter(s => !/bloqueio/i.test(s.nome)).map(s => s.conta_id));
  const minimo = ls.get('nc-min', 50000);
  const R = calcular(sel, minimo);
  return { minimo, saldoIni: R.saldoIni, primeira: R.semanas.find(w => w.abaixo) || null, pior: R.semanas.reduce((a, w) => (w.saldo < a.saldo ? w : a), R.semanas[0]) };
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (e) { fail(e); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const c = state.cad;
  const contasAtivas = D.saldos;
  const salvas = ls.get('nc-contas', null);
  const contasSel = new Set(salvas ? salvas.filter(id => contasAtivas.some(s => s.conta_id === id)) : contasAtivas.filter(s => !/bloqueio/i.test(s.nome)).map(s => s.conta_id));
  let minimo = ls.get('nc-min', 50000);

  root.innerHTML = `<div class="card"><div class="toolbar">
      <label>Caixa mínimo (R$)<input id="nc-min" inputmode="decimal" value="${money(minimo)}" style="max-width:140px"></label>
      <label class="chk"><input type="checkbox" id="nc-fc" ${ui.forecast ? 'checked' : ''}> Completar com o forecast</label>
      <label class="chk"><input type="checkbox" id="nc-venc" ${ui.vencidos ? 'checked' : ''}> Vencidos em aberto na 1ª semana</label>
      <span class="spacer"></span>
      <button class="btn" id="nc-contas-btn">Contas consideradas (${contasSel.size})</button>
      <button class="btn" id="nc-comp-btn">Compromissos programados${D.comp ? ` (${D.comp.filter(k => k.ativo).length})` : ''}</button>
      <button class="btn" id="nc-exp">Exportar Excel</button></div>
      <p class="small muted" style="margin:8px 0 0">Saldo de hoje das contas consideradas + recebimentos − pagamentos em aberto + compromissos programados${ui.forecast ? ' + o que o forecast ainda espera para o mês e não foi lançado' : ''}. Transferências entre contas não entram.</p></div>
    <div class="kpis" id="nc-kpis"></div>
    <div class="card"><canvas id="nc-ch" height="90"></canvas></div>
    <div id="nc-alerta"></div>
    <div class="card flush"><div class="table-wrap" id="nc-tbl"></div></div>`;

  const pintar = () => {
    const R = calcular(contasSel, minimo), S = R.semanas;
    const pior = S.reduce((a, w) => (w.saldo < a.saldo ? w : a), S[0]);
    const primeira = S.find(w => w.abaixo);
    const maxFalta = Math.max(0, ...S.map(w => w.falta));
    $('#nc-kpis', root).innerHTML = `
      <div class="kpi"><div class="k-label">Saldo hoje</div><div class="k-value ${R.saldoIni < 0 ? 'neg' : ''}">${money0(R.saldoIni)}</div><div class="k-sub">${contasSel.size} conta(s) consideradas</div></div>
      <div class="kpi"><div class="k-label">Menor saldo projetado</div><div class="k-value ${pior.saldo < minimo ? 'neg' : ''}">${money0(pior.saldo)}</div><div class="k-sub">semana de ${ddmm(pior.ini)} a ${ddmm(pior.fim)}</div></div>
      <div class="kpi"><div class="k-label">Primeira semana abaixo do mínimo</div><div class="k-value">${primeira ? ddmm(primeira.ini) : '—'}</div><div class="k-sub">${primeira ? `faltam ${money0(primeira.falta)}` : `mínimo ${money0(minimo)} atendido nas ${SEMANAS} semanas`}</div></div>
      <div class="kpi"><div class="k-label">Maior necessidade</div><div class="k-value ${maxFalta ? 'neg' : ''}">${money0(maxFalta)}</div><div class="k-sub">${R.vencidos && ui.vencidos ? `inclui vencidos: ${money0(R.vencidos)}` : '&nbsp;'}</div></div>`;
    chart($('#nc-ch', root), { type: 'bar', data: { labels: S.map(w => ddmm(w.ini)), datasets: [
      { type: 'line', label: 'Saldo projetado', data: S.map(w => w.saldo), borderColor: COR.saldo, backgroundColor: COR.saldo, tension: .25, yAxisID: 'y', order: 1, pointRadius: 3 },
      { type: 'line', label: 'Caixa mínimo', data: S.map(() => minimo), borderColor: '#98a2b3', borderDash: [5, 4], pointRadius: 0, yAxisID: 'y', order: 2 },
      { label: 'Entradas', data: S.map(w => w.ent + Math.max(0, w.fc) + Math.max(0, w.comp)), backgroundColor: COR.entrada, order: 3 },
      { label: 'Saídas', data: S.map(w => w.sai + Math.min(0, w.fc) + Math.min(0, w.comp)), backgroundColor: COR.saida, order: 3 },
    ] }, options: { maintainAspectRatio: true, plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money0(x.raw)}` } } }, scales: { y: { ticks: { callback: moneyTick } } } } });

    // sugestão de cobertura
    const al = $('#nc-alerta', root);
    if (primeira) {
      const cd = candidatos(primeira, primeira.falta);
      al.innerHTML = `<div class="card alert-row atencao" style="display:block">
        <strong>Falta caixa na semana de ${ddmm(primeira.ini)} a ${ddmm(primeira.fim)}: ${money0(primeira.falta)} para chegar ao mínimo.</strong>
        ${cd.qtd ? `<br><span class="small">Há ${cd.qtd} título(s) a receber, fora de proposta, vencendo depois dessa semana (${money0(cd.total)}). Antecipar os ${cd.sel.length} primeiro(s) cobre ${money0(cd.soma)} de face (o líquido sai menor pelo deságio).</span>
          ${podeEditar() ? '<div style="margin-top:8px"><button class="btn primary small" id="nc-bord">Montar borderô com esses títulos</button></div>' : ''}`
          : '<br><span class="small">Não há títulos a receber em aberto para antecipar depois dessa semana.</span>'}</div>`;
      $('#nc-bord', al) && ($('#nc-bord', al).onclick = () => { state.borderoSel = cd.sel.map(l => l.id); location.hash = '#/fidc-propostas'; });
    } else al.innerHTML = '';

    $('#nc-tbl', root).innerHTML = `<table id="nc-t"><thead><tr><th>Semana</th><th class="num">Saldo inicial</th><th class="num">A receber</th><th class="num">A pagar</th>
      <th class="num">Forecast a lançar</th><th class="num">Compromissos</th><th class="num">Resultado</th><th class="num">Saldo final</th><th></th></tr></thead><tbody>
      ${S.map((w, i) => `<tr class="clickable" data-i="${i}"><td class="nowrap">${dateBR(w.ini)} a ${ddmm(w.fim)}${i === 0 && R.vencidos && ui.vencidos ? ' <span class="badge vencido">com vencidos</span>' : ''}</td>
        <td class="num">${money0(w.saldoIni)}</td><td class="num pos">${money0(w.ent)}</td><td class="num neg">${money0(w.sai)}</td>
        <td class="num ${w.fc < 0 ? 'neg' : ''}">${ui.forecast ? money0(w.fc) : '—'}</td><td class="num ${w.comp < 0 ? 'neg' : ''}">${money0(w.comp)}</td>
        <td class="num ${w.res < 0 ? 'neg' : 'pos'}">${money0(w.res)}</td><td class="num ${w.saldo < 0 ? 'neg' : ''}"><strong>${money0(w.saldo)}</strong></td>
        <td>${w.abaixo ? `<span class="badge vencido">falta ${money0(w.falta)}</span>` : '<span class="badge pago">ok</span>'}</td></tr>`).join('')}
      </tbody></table>`;
    $$('#nc-t tr[data-i]', root).forEach(tr => tr.onclick = () => detalheSemana(S[+tr.dataset.i]));
    $('#nc-exp', root).onclick = () => exportXLSX([['Semana início', 'Semana fim', 'Saldo inicial', 'A receber', 'A pagar', 'Forecast a lançar', 'Compromissos', 'Resultado', 'Saldo final', 'Falta para o mínimo'],
      ...S.map(w => [dateBR(w.ini), dateBR(w.fim), w.saldoIni, w.ent, w.sai, w.fc, w.comp, w.res, w.saldo, w.falta])], `necessidade_caixa_${D.hoje}`);
  };

  $('#nc-min', root).onchange = (e) => { minimo = parseNum(e.target.value); ls.set('nc-min', minimo); e.target.value = money(minimo); pintar(); };
  $('#nc-fc', root).onchange = (e) => { ui.forecast = e.target.checked; ls.set('nc-forecast', ui.forecast); render(root); };
  $('#nc-venc', root).onchange = (e) => { ui.vencidos = e.target.checked; ls.set('nc-vencidos', ui.vencidos); pintar(); };
  $('#nc-contas-btn', root).onclick = () => {
    const m = modal({ title: 'Contas consideradas no saldo de hoje', body: `<p class="small muted" style="margin-top:0">Marque as contas cujo dinheiro está disponível. O bloqueio judicial vem desmarcado.</p>
      <div style="display:grid;gap:6px">${contasAtivas.map(s => `<label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" value="${s.conta_id}" ${contasSel.has(s.conta_id) ? 'checked' : ''}>
        <span style="flex:1">${esc(s.nome)}</span><span class="num ${+s.saldo_pago < 0 ? 'neg' : ''}">${money(s.saldo_pago)}</span></label>`).join('')}</div>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cs-ok">Aplicar</button>' });
    $('#cs-ok', m.el).onclick = () => {
      contasSel.clear(); $$('input[type=checkbox]', m.el).forEach(i => i.checked && contasSel.add(i.value));
      ls.set('nc-contas', [...contasSel]); $('#nc-contas-btn', root).textContent = `Contas consideradas (${contasSel.size})`; m.close(); pintar();
    };
  };
  $('#nc-comp-btn', root).onclick = () => compromissos(root);
  pintar();
}

function detalheSemana(w) {
  const c = state.cad;
  const lanc = w.itens.filter(x => x.tipo === 'lanc').sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const fc = {}; for (const x of w.itens.filter(x => x.tipo === 'fc')) fc[x.plano_id] = (fc[x.plano_id] || 0) + x.v;
  const comp = w.itens.filter(x => x.tipo === 'comp');
  modal({ title: `Semana de ${dateBR(w.ini)} a ${dateBR(w.fim)}`, wide: true, body: `
    ${comp.length ? `<h3>Compromissos programados</h3><table><tbody>${comp.map(x => `<tr><td>${dateBR(x.data)}</td><td>${esc(x.k.descricao)}</td><td class="num ${x.v < 0 ? 'neg' : 'pos'}">${money(x.v)}</td></tr>`).join('')}</tbody></table>` : ''}
    <h3>Lançamentos em aberto (${lanc.length})</h3>
    <div class="table-wrap" style="max-height:45vh">${lanc.length ? `<table><thead><tr><th>Vencimento</th><th>Classificação</th><th>Beneficiário</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>
      ${lanc.map(x => `<tr><td>${dateBR(x.data)}</td><td>${esc(c.planoById[x.l.plano_id]?.label || '')}</td><td>${esc(c.favById[x.l.favorecido_id]?.nome || '')}</td><td class="wrap">${esc([x.l.descricao, x.l.documento && 'NF ' + x.l.documento].filter(Boolean).join(' · '))}</td>
        <td class="num ${x.v < 0 ? 'neg' : 'pos'}">${money(x.v)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhum.</div>'}</div>
    ${Object.keys(fc).length ? `<h3>Forecast ainda não lançado</h3><table><tbody>${Object.entries(fc).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([p, v]) => `<tr><td>${esc(c.planoById[p]?.label || p)}</td><td class="num ${v < 0 ? 'neg' : 'pos'}">${money(v)}</td></tr>`).join('')}</tbody></table>` : ''}` });
}

function compromissos(root) {
  if (D.comp === null) return toast('Não foi possível carregar os compromissos. Recarregue a página.', true);
  const ed = podeEditar();
  const m = modal({ title: 'Compromissos programados', wide: true, body: `
    <p class="small muted" style="margin-top:0">Valores que se repetem todo mês e ainda não estão lançados (ex.: parcela da Recuperação Judicial, quando definida). Entram na projeção no dia do mês informado, entre o início e o fim.</p>
    <div class="table-wrap"><table><thead><tr><th>Descrição</th><th>Tipo</th><th class="num">Valor mensal</th><th>Dia</th><th>Início</th><th>Fim</th><th>Ativo</th>${ed ? '<th></th>' : ''}</tr></thead><tbody>
      ${D.comp.map(k => `<tr data-id="${k.id}"><td>${esc(k.descricao)}</td><td>${k.natureza === 'E' ? 'Entrada' : 'Saída'}</td><td class="num">${money(k.valor)}</td><td>${k.dia}</td><td>${dateBR(k.inicio)}</td><td>${k.fim ? dateBR(k.fim) : '—'}</td><td>${k.ativo ? 'sim' : 'não'}</td>
        ${ed ? '<td class="nowrap"><button class="btn ghost small" data-ed>Editar</button><button class="btn ghost small" data-del>Excluir</button></td>' : ''}</tr>`).join('') || `<tr><td colspan="8" class="empty">Nenhum compromisso cadastrado.</td></tr>`}
    </tbody></table></div>`, foot: ed ? '<button class="btn" data-close>Fechar</button><button class="btn primary" id="cp-novo">+ Novo compromisso</button>' : '<button class="btn" data-close>Fechar</button>' });
  const recarregar = async () => { m.close(); await render(root); };
  $('#cp-novo', m.el) && ($('#cp-novo', m.el).onclick = () => { m.close(); editarComp(null, recarregar); });
  m.el.querySelector('tbody').onclick = async (e) => {
    const id = e.target.closest('tr')?.dataset.id; if (!id) return;
    const k = D.comp.find(x => x.id === id);
    if (e.target.closest('[data-ed]')) { m.close(); editarComp(k, recarregar); }
    if (e.target.closest('[data-del]') && await confirmDialog(`Excluir o compromisso "${k.descricao}"?`)) {
      try { await q(sb.from('caixa_compromissos').delete().eq('id', id)); toast('Compromisso excluído'); recarregar(); } catch (err) { fail(err); }
    }
  };
}

function editarComp(k, depois) {
  const v = k || { natureza: 'S', dia: 10, inicio: today(), ativo: true };
  const m = modal({ title: k ? 'Editar compromisso' : 'Novo compromisso', body: `<form id="cp-f" class="grid-form">
      <label class="span2">Descrição<input name="descricao" required value="${esc(v.descricao || '')}" placeholder="ex.: Parcela da Recuperação Judicial"></label>
      <label>Tipo<select name="natureza"><option value="S" ${v.natureza === 'S' ? 'selected' : ''}>Saída</option><option value="E" ${v.natureza === 'E' ? 'selected' : ''}>Entrada</option></select></label>
      <label>Valor mensal (R$)<input name="valor" inputmode="decimal" required value="${v.valor ? money(v.valor) : ''}"></label>
      <label>Dia do mês<input name="dia" type="number" min="1" max="31" required value="${v.dia}"></label>
      <label>Início<input name="inicio" type="date" required value="${v.inicio}"></label>
      <label>Fim (opcional)<input name="fim" type="date" value="${v.fim || ''}"></label>
      <label class="chk"><input type="checkbox" name="ativo" ${v.ativo ? 'checked' : ''}> Ativo</label>
      <label class="span2">Observação<input name="observacao" value="${esc(v.observacao || '')}"></label></form>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cp-ok">Salvar</button>' });
  $('#cp-ok', m.el).onclick = async () => {
    const f = $('#cp-f', m.el); if (!f.reportValidity()) return;
    const fd = Object.fromEntries(new FormData(f).entries());
    const row = { empresa_id: state.empresa.id, descricao: fd.descricao.trim(), natureza: fd.natureza, valor: parseNum(fd.valor), dia: +fd.dia,
      inicio: fd.inicio, fim: fd.fim || null, ativo: !!fd.ativo, observacao: fd.observacao || null };
    if (!(row.valor > 0)) return toast('Informe um valor maior que zero', true);
    if (row.fim && row.fim < row.inicio) return toast('O fim é antes do início', true);
    try {
      if (k) await q(sb.from('caixa_compromissos').update(row).eq('id', k.id)); else await q(sb.from('caixa_compromissos').insert(row));
      toast('Compromisso salvo'); m.close(); depois();
    } catch (e) { fail(e); }
  };
}

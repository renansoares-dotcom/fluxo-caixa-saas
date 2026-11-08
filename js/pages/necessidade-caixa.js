// Necessidade de caixa: próximas N semanas (13 por padrão) a partir do saldo de hoje, por CENÁRIO (melhoria 3.9).
// Saldo das contas escolhidas + recebimentos em aberto − pagamentos em aberto + compromissos programados
// (+ o que o forecast ainda espera e não foi lançado) → saldo projetado por semana × caixa mínimo.
// Cada cenário (base, otimista, pessimista, personalizados) ajusta essas parcelas pelas premissas, pode simular o pagamento
// da Recuperação Judicial e somar eventos pontuais. Quando falta caixa, sugere títulos a receber para antecipar.
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, money0, dateBR, fail, loading, modal, chart, moneyTick, COR, exportXLSX, parseNum, today, toast, confirmDialog } from '../lib/ui.js';
import * as K from '../lib/caixa-cenarios.js';

export const title = 'Necessidade de Caixa';

const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
             set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const iso = (d) => d.toISOString().slice(0, 10);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const segunda = (s) => { const d = new Date(s + 'T12:00:00'); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const fimMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12
const ddmm = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
const podeCenarios = () => ['admin', 'diretor', 'financeiro'].includes(state.papel);
const chave = (c) => c.id || c.tipo;
const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['leitura', 'Leitura']];

const ui = { vencidos: ls.get('nc-vencidos', true), cen: ls.get('nc-cenario', 'base'), comparar: false };
let D = null;

async function carregar() {
  const e = state.empresa.id, hoje = today();
  const [cfgRow, cens] = await Promise.all([
    q(sb.from('caixa_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => undefined),
    q(sb.from('caixa_cenarios').select('*').eq('empresa_id', e).order('ordem').order('nome')).catch(() => null),
  ]);
  const banco = cfgRow !== undefined && cens !== null;
  const cfg = { caixa_minimo: ls.get('nc-min', 50000), horizonte_semanas: 13, contas: ls.get('nc-contas', null), cenario_alerta: null, avisar: true, avisar_papeis: ['admin', 'diretor', 'financeiro'], avisar_semanas: 4, ...(cfgRow || {}) };
  if (cfgRow) cfg.caixa_minimo = +cfgRow.caixa_minimo;
  const SEM = cfg.horizonte_semanas || 13;
  const ini = segunda(hoje), fim = addDias(ini, SEM * 7 - 1);
  const meses = []; for (let d = new Date(hoje.slice(0, 7) + '-01T12:00:00'); iso(d) <= fim; d.setMonth(d.getMonth() + 1)) meses.push([d.getFullYear(), d.getMonth() + 1]);
  const [saldos, abertos, comp, fc, lancMes] = await Promise.all([
    q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: hoje })),
    fetchAll(() => sb.from('lancamentos').select('id,data,valor,plano_id,favorecido_id,descricao,documento,conta_id,fidc_proposta_id').eq('empresa_id', e).eq('status', 'Em aberto').lte('data', fim).order('data').order('id')),
    q(sb.from('caixa_compromissos').select('*').eq('empresa_id', e).order('inicio')).catch(err => (/caixa_compromissos/.test(err.message || '') ? null : Promise.reject(err))),
    fetchAll(() => sb.from('orcamentos').select('plano_id,ano,mes,valor').eq('empresa_id', e).eq('cenario', 'forecast').in('ano', [...new Set(meses.map(m => m[0]))]).order('id')),
    fetchAll(() => sb.from('lancamentos').select('plano_id,valor,data').eq('empresa_id', e).gte('data', `${meses[0][0]}-${String(meses[0][1]).padStart(2, '0')}-01`).lte('data', `${fim.slice(0, 7)}-${String(fimMes(+fim.slice(0, 4), +fim.slice(5, 7))).padStart(2, '0')}`).order('id')),
  ]);
  const lista = K.montarLista(cens || []);
  D = { hoje, ini, fim, SEM, meses, saldos, abertos, comp, fc: fc.filter(o => meses.some(([y, m]) => o.ano === y && o.mes === m)), lancMes, cfg, banco, lista };
}

const contasDe = () => {
  const salvas = D.cfg.contas;
  return new Set(salvas ? salvas.filter(id => D.saldos.some(s => s.conta_id === id)) : D.saldos.filter(s => !/bloqueio/i.test(s.nome)).map(s => s.conta_id));
};
const cenarioAlerta = () => D.lista.find(c => c.id && c.id === D.cfg.cenario_alerta) || D.lista.find(c => c.tipo === 'base') || D.lista[0];

function calcular(contasSel, minimo, premissas = {}) {
  const c = state.cad, { hoje, ini, meses, SEM } = D, P = K.normalizar(premissas);
  const semanas = Array.from({ length: SEM }, (_, i) => ({ ini: addDias(ini, i * 7), fim: addDias(ini, i * 7 + 6), ent: 0, sai: 0, fc: 0, comp: 0, sim: 0, itens: [] }));
  const idx = (d) => { if (d < ini) return 0; const i = Math.floor((new Date(d + 'T12:00:00') - new Date(ini + 'T12:00:00')) / (7 * 864e5)); return i < SEM ? i : -1; };
  const sinal = (pid) => c.planoById[pid]?.natureza === 'C' ? 1 : -1;
  const tipo = (pid) => c.planoById[pid]?.tipo;
  const saldoIni = D.saldos.filter(s => contasSel.has(s.conta_id)).reduce((s, x) => s + +x.saldo_pago, 0);

  // 1) lançamentos em aberto, ajustados pelas premissas (vencidos entram na 1ª semana, se marcado)
  let vencidos = 0;
  for (const l of D.abertos) {
    if (tipo(l.plano_id) === 'T') continue;
    if (l.data < hoje && !ui.vencidos) continue;
    const a = K.ajustarLanc(P, l.data, sinal(l.plano_id) * +l.valor, hoje, addDias);
    if (!a || !a.v) continue;
    const i = idx(a.data); if (i < 0) continue;
    if (a.vencido) vencidos += a.v;
    if (a.v > 0) semanas[i].ent += a.v; else semanas[i].sai += a.v;
    semanas[i].itens.push({ tipo: 'lanc', data: a.data, v: a.v, l });
  }
  // 2) compromissos programados
  if (P.compromissos) for (const k of D.comp || []) {
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
  if (P.forecast) {
    const lanc = {};
    for (const l of D.lancMes) { const k = l.plano_id + '|' + l.data.slice(0, 7); lanc[k] = (lanc[k] || 0) + +l.valor; }
    for (const o of D.fc) {
      if (!['E', 'S'].includes(tipo(o.plano_id))) continue;
      const mk = `${o.ano}-${String(o.mes).padStart(2, '0')}`, s = sinal(o.plano_id);
      const resto = Math.abs(+o.valor) * K.fatorForecast(P, s) - (lanc[o.plano_id + '|' + mk] || 0);
      if (resto <= 0.005) continue;
      const d0 = mk + '-01' > hoje ? mk + '-01' : hoje, dN = `${mk}-${String(fimMes(o.ano, o.mes)).padStart(2, '0')}`;
      if (d0 > dN) continue;
      const dias = []; for (let d = d0; d <= dN; d = addDias(d, 1)) dias.push(d);
      const por = resto / dias.length;
      const porSemana = {};
      for (const d of dias) { const i = idx(d); if (i >= 0) porSemana[i] = (porSemana[i] || 0) + por; }
      for (const [i, v] of Object.entries(porSemana)) { semanas[i].fc += s * v; semanas[i].itens.push({ tipo: 'fc', data: mk, v: s * v, plano_id: o.plano_id }); }
    }
  }
  // 4) simulações do cenário: parcelas da RJ e eventos pontuais
  if (P.rj.ativo) for (const p of K.simularRJ(P.rj).cronograma) {
    if (p.data < hoje) continue; const i = idx(p.data); if (i < 0) continue;
    semanas[i].sim -= p.valor; semanas[i].itens.push({ tipo: 'sim', data: p.data, v: -p.valor, desc: 'Parcela da Recuperação Judicial (simulação)' });
  }
  for (const ev of P.eventos) {
    if (ev.data < hoje) continue; const i = idx(ev.data); if (i < 0) continue;
    semanas[i].sim += ev.valor; semanas[i].itens.push({ tipo: 'sim', data: ev.data, v: ev.valor, desc: ev.descricao || 'Evento pontual' });
  }
  let saldo = saldoIni;
  for (const w of semanas) { w.res = w.ent + w.sai + w.fc + w.comp + w.sim; w.saldoIni = saldo; saldo += w.res; w.saldo = saldo; w.abaixo = saldo < minimo; w.falta = Math.max(0, minimo - saldo); }
  return { semanas, saldoIni, vencidos, P };
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

// aviso de caixa mínimo projetado (o banco avisa uma vez por semana crítica; sem o SQL 106 não faz nada)
function registrarAlerta(cen, R, minimo) {
  if (!D.banco) return;
  const w = R.semanas.find(x => x.abaixo); if (!w) return;
  sb.rpc('caixa_registrar_alerta', { p_empresa: state.empresa.id, p_semana: w.ini, p_falta: w.falta, p_saldo: w.saldo, p_cenario: cen?.nome || 'Base' }).then(() => {}, () => {});
}

// resumo para a Minha Manhã, os painéis e a Central de Decisões: cenário do alerta, com os parâmetros da empresa
export async function resumoNecessidade() {
  await carregar();
  const minimo = D.cfg.caixa_minimo, cen = cenarioAlerta();
  const R = calcular(contasDe(), minimo, cen?.premissas);
  registrarAlerta(cen, R, minimo);
  return { minimo, cenario: cen?.nome || 'Base', saldoIni: R.saldoIni, semanas: R.semanas, primeira: R.semanas.find(w => w.abaixo) || null, pior: R.semanas.reduce((a, w) => (w.saldo < a.saldo ? w : a), R.semanas[0]) };
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (e) { fail(e); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const contasAtivas = D.saldos, contasSel = contasDe();
  const minimo = D.cfg.caixa_minimo;
  if (!D.lista.some(c => chave(c) === ui.cen)) ui.cen = 'base';
  const cenAt = () => D.lista.find(c => chave(c) === ui.cen) || D.lista[0];

  root.innerHTML = `<div class="card"><div class="toolbar">
      <div class="nc-cens" id="nc-cens">${D.lista.map(c => `<button class="ch-chip nc-chip${!ui.comparar && chave(c) === ui.cen ? ' on' : ''}" data-c="${esc(chave(c))}"><i style="background:${esc(c.cor || '#64748b')}"></i>${esc(c.nome)}</button>`).join('')}
        <button class="ch-chip${ui.comparar ? ' on' : ''}" id="nc-comp-cen" title="Ver todos os cenários lado a lado">⇆ Comparar</button></div>
      <label class="chk"><input type="checkbox" id="nc-venc" ${ui.vencidos ? 'checked' : ''}> Vencidos em aberto na 1ª semana</label>
      <span class="spacer"></span>
      <button class="btn" id="nc-cen-btn">Cenários e premissas</button>
      <button class="btn" id="nc-contas-btn">Contas consideradas (${contasSel.size})</button>
      <button class="btn" id="nc-comp-btn">Compromissos programados${D.comp ? ` (${D.comp.filter(k => k.ativo).length})` : ''}</button>
      <button class="btn" id="nc-par">Parâmetros</button>
      <button class="btn" id="nc-exp">Exportar Excel</button></div>
      <p class="small muted" style="margin:8px 0 0" id="nc-desc"></p>
      ${D.banco ? '' : '<p class="small warn" style="margin:6px 0 0">Os cenários personalizados, os parâmetros da empresa e o aviso de caixa mínimo precisam do SQL 106. Até lá, valem os três cenários padrão e os parâmetros deste navegador.</p>'}</div>
    <div class="kpis" id="nc-kpis"></div>
    <div class="card"><canvas id="nc-ch" height="90"></canvas></div>
    <div id="nc-alerta"></div>
    <div class="card flush"><div class="table-wrap" id="nc-tbl"></div></div>`;

  const pintarCenario = () => {
    const cen = cenAt(), R = calcular(contasSel, minimo, cen.premissas), S = R.semanas, P = R.P;
    if (cen === cenarioAlerta()) registrarAlerta(cen, R, minimo);
    const pior = S.reduce((a, w) => (w.saldo < a.saldo ? w : a), S[0]);
    const primeira = S.find(w => w.abaixo);
    const maxFalta = Math.max(0, ...S.map(w => w.falta));
    const temSim = S.some(w => w.sim);
    $('#nc-desc', root).innerHTML = `<b>${esc(cen.nome)}</b>: ${esc(K.resumoPremissas(cen.premissas))}. Saldo de hoje das contas consideradas + recebimentos − pagamentos em aberto${P.compromissos ? ' + compromissos programados' : ''}${P.forecast ? ' + o que o forecast ainda espera e não foi lançado' : ''}${temSim ? ' + simulações do cenário' : ''}. Caixa mínimo ${money0(minimo)} · ${D.SEM} semanas. Transferências entre contas não entram.`;
    $('#nc-kpis', root).innerHTML = `
      <div class="kpi"><div class="k-label">Saldo hoje</div><div class="k-value ${R.saldoIni < 0 ? 'neg' : ''}">${money0(R.saldoIni)}</div><div class="k-sub">${contasSel.size} conta(s) consideradas</div></div>
      <div class="kpi"><div class="k-label">Menor saldo projetado</div><div class="k-value ${pior.saldo < minimo ? 'neg' : ''}">${money0(pior.saldo)}</div><div class="k-sub">semana de ${ddmm(pior.ini)} a ${ddmm(pior.fim)}</div></div>
      <div class="kpi"><div class="k-label">Primeira semana abaixo do mínimo</div><div class="k-value">${primeira ? ddmm(primeira.ini) : '—'}</div><div class="k-sub">${primeira ? `faltam ${money0(primeira.falta)}` : `mínimo ${money0(minimo)} atendido nas ${D.SEM} semanas`}</div></div>
      <div class="kpi"><div class="k-label">Maior necessidade</div><div class="k-value ${maxFalta ? 'neg' : ''}">${money0(maxFalta)}</div><div class="k-sub">${R.vencidos && ui.vencidos ? `inclui vencidos: ${money0(R.vencidos)}` : '&nbsp;'}</div></div>`;
    chart($('#nc-ch', root), { type: 'bar', data: { labels: S.map(w => ddmm(w.ini)), datasets: [
      { type: 'line', label: `Saldo projetado (${cen.nome})`, data: S.map(w => w.saldo), borderColor: cen.cor || COR.saldo, backgroundColor: cen.cor || COR.saldo, tension: .25, yAxisID: 'y', order: 1, pointRadius: 3 },
      { type: 'line', label: 'Caixa mínimo', data: S.map(() => minimo), borderColor: '#98a2b3', borderDash: [5, 4], pointRadius: 0, yAxisID: 'y', order: 2 },
      { label: 'Entradas', data: S.map(w => w.ent + Math.max(0, w.fc) + Math.max(0, w.comp) + Math.max(0, w.sim)), backgroundColor: COR.entrada, order: 3 },
      { label: 'Saídas', data: S.map(w => w.sai + Math.min(0, w.fc) + Math.min(0, w.comp) + Math.min(0, w.sim)), backgroundColor: COR.saida, order: 3 },
    ] }, options: { maintainAspectRatio: true, plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money0(x.raw)}` } } }, scales: { y: { ticks: { callback: moneyTick } } } } });

    // sugestão de cobertura
    const al = $('#nc-alerta', root);
    if (primeira) {
      const cd = candidatos(primeira, primeira.falta);
      al.innerHTML = `<div class="card alert-row atencao" style="display:block">
        <strong>No cenário ${esc(cen.nome)}, falta caixa na semana de ${ddmm(primeira.ini)} a ${ddmm(primeira.fim)}: ${money0(primeira.falta)} para chegar ao mínimo.</strong>
        ${cd.qtd ? `<br><span class="small">Há ${cd.qtd} título(s) a receber, fora de proposta, vencendo depois dessa semana (${money0(cd.total)}). Antecipar os ${cd.sel.length} primeiro(s) cobre ${money0(cd.soma)} de face (o líquido sai menor pelo deságio).</span>
          ${podeEditar() ? '<div style="margin-top:8px"><button class="btn primary small" id="nc-bord">Montar borderô com esses títulos</button></div>' : ''}`
          : '<br><span class="small">Não há títulos a receber em aberto para antecipar depois dessa semana.</span>'}</div>`;
      $('#nc-bord', al) && ($('#nc-bord', al).onclick = () => { state.borderoSel = cd.sel.map(l => l.id); location.hash = '#/fidc-propostas'; });
    } else al.innerHTML = '';

    $('#nc-tbl', root).innerHTML = `<table id="nc-t"><thead><tr><th>Semana</th><th class="num">Saldo inicial</th><th class="num">A receber</th><th class="num">A pagar</th>
      <th class="num">Forecast a lançar</th><th class="num">Compromissos</th>${temSim ? '<th class="num">Simulações</th>' : ''}<th class="num">Resultado</th><th class="num">Saldo final</th><th></th></tr></thead><tbody>
      ${S.map((w, i) => `<tr class="clickable" data-i="${i}"><td class="nowrap">${dateBR(w.ini)} a ${ddmm(w.fim)}${i === 0 && R.vencidos && ui.vencidos ? ' <span class="badge vencido">com vencidos</span>' : ''}</td>
        <td class="num">${money0(w.saldoIni)}</td><td class="num pos">${money0(w.ent)}</td><td class="num neg">${money0(w.sai)}</td>
        <td class="num ${w.fc < 0 ? 'neg' : ''}">${P.forecast ? money0(w.fc) : '—'}</td><td class="num ${w.comp < 0 ? 'neg' : ''}">${P.compromissos ? money0(w.comp) : '—'}</td>
        ${temSim ? `<td class="num ${w.sim < 0 ? 'neg' : w.sim > 0 ? 'pos' : ''}">${money0(w.sim)}</td>` : ''}
        <td class="num ${w.res < 0 ? 'neg' : 'pos'}">${money0(w.res)}</td><td class="num ${w.saldo < 0 ? 'neg' : ''}"><strong>${money0(w.saldo)}</strong></td>
        <td>${w.abaixo ? `<span class="badge vencido">falta ${money0(w.falta)}</span>` : '<span class="badge pago">ok</span>'}</td></tr>`).join('')}
      </tbody></table>`;
    $$('#nc-t tr[data-i]', root).forEach(tr => tr.onclick = () => detalheSemana(S[+tr.dataset.i], cen));
    $('#nc-exp', root).onclick = () => exportXLSX([['Cenário', 'Semana início', 'Semana fim', 'Saldo inicial', 'A receber', 'A pagar', 'Forecast a lançar', 'Compromissos', 'Simulações', 'Resultado', 'Saldo final', 'Falta para o mínimo'],
      ...S.map(w => [cen.nome, dateBR(w.ini), dateBR(w.fim), w.saldoIni, w.ent, w.sai, w.fc, w.comp, w.sim, w.res, w.saldo, w.falta])], `necessidade_caixa_${D.hoje}`);
  };

  const pintarComparacao = () => {
    const C = K.comparar(D.lista.map(c => ({ c, nome: c.nome, cor: c.cor || '#64748b', semanas: calcular(contasSel, minimo, c.premissas).semanas })), minimo);
    const S0 = C[0].semanas;
    $('#nc-desc', root).innerHTML = `Todos os cenários com as mesmas contas (saldo de hoje) e o caixa mínimo de ${money0(minimo)}, em ${D.SEM} semanas. Clique numa linha da tabela para abrir o cenário.`;
    const piorDeTodos = C.reduce((a, x) => (x.pior.saldo < a.pior.saldo ? x : a), C[0]);
    const abaixo = C.filter(x => x.primeira);
    $('#nc-kpis', root).innerHTML = `
      <div class="kpi"><div class="k-label">Cenários</div><div class="k-value">${C.length}</div><div class="k-sub">${abaixo.length ? `${abaixo.length} ficam abaixo do mínimo` : 'todos acima do mínimo'}</div></div>
      <div class="kpi"><div class="k-label">Pior saldo projetado</div><div class="k-value ${piorDeTodos.pior.saldo < minimo ? 'neg' : ''}">${money0(piorDeTodos.pior.saldo)}</div><div class="k-sub">${esc(piorDeTodos.nome)}, semana de ${ddmm(piorDeTodos.pior.ini)}</div></div>
      <div class="kpi"><div class="k-label">Diferença no fim do horizonte</div><div class="k-value">${money0(Math.max(...C.map(x => x.saldoFinal)) - Math.min(...C.map(x => x.saldoFinal)))}</div><div class="k-sub">entre o melhor e o pior cenário</div></div>
      <div class="kpi"><div class="k-label">Maior necessidade</div><div class="k-value ${Math.max(...C.map(x => x.maxFalta)) ? 'neg' : ''}">${money0(Math.max(...C.map(x => x.maxFalta)))}</div><div class="k-sub">para manter o mínimo em todos</div></div>`;
    chart($('#nc-ch', root), { type: 'line', data: { labels: S0.map(w => ddmm(w.ini)), datasets: [
      ...C.map(x => ({ label: x.nome, data: x.semanas.map(w => w.saldo), borderColor: x.cor, backgroundColor: x.cor, tension: .25, pointRadius: 2 })),
      { label: 'Caixa mínimo', data: S0.map(() => minimo), borderColor: '#98a2b3', borderDash: [5, 4], pointRadius: 0 },
    ] }, options: { maintainAspectRatio: true, plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money0(x.raw)}` } } }, scales: { y: { ticks: { callback: moneyTick } } } } });
    $('#nc-alerta', root).innerHTML = '';
    $('#nc-tbl', root).innerHTML = `<table id="nc-tc"><thead><tr><th>Cenário</th><th>Premissas</th><th class="num">Menor saldo</th><th>Semana do menor</th><th>1ª semana abaixo</th><th class="num">Semanas abaixo</th><th class="num">Maior necessidade</th><th class="num">Saldo no fim</th></tr></thead><tbody>
      ${C.map(x => `<tr class="clickable" data-c="${esc(chave(x.c))}"><td class="nowrap"><span class="nc-dot" style="background:${esc(x.cor)}"></span><b>${esc(x.nome)}</b></td><td class="wrap small">${esc(K.resumoPremissas(x.c.premissas))}</td>
        <td class="num ${x.pior.saldo < minimo ? 'neg' : ''}">${money0(x.pior.saldo)}</td><td>${ddmm(x.pior.ini)}</td><td>${x.primeira ? `<span class="badge vencido">${ddmm(x.primeira.ini)}</span>` : '<span class="badge pago">nenhuma</span>'}</td>
        <td class="num">${x.semanasAbaixo}</td><td class="num ${x.maxFalta ? 'neg' : ''}">${money0(x.maxFalta)}</td><td class="num"><strong>${money0(x.saldoFinal)}</strong></td></tr>`).join('')}
      </tbody></table>
      <table class="nc-sem"><thead><tr><th>Semana</th>${C.map(x => `<th class="num">${esc(x.nome)}</th>`).join('')}</tr></thead><tbody>
      ${S0.map((w, i) => `<tr><td class="nowrap">${dateBR(w.ini)} a ${ddmm(w.fim)}</td>${C.map(x => `<td class="num ${x.semanas[i].saldo < minimo ? 'neg' : ''}">${money0(x.semanas[i].saldo)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    $$('#nc-tc tr[data-c]', root).forEach(tr => tr.onclick = () => { ui.comparar = false; ui.cen = tr.dataset.c; ls.set('nc-cenario', ui.cen); render(root); });
    $('#nc-exp', root).onclick = () => exportXLSX([['Semana início', 'Semana fim', ...C.map(x => x.nome), 'Caixa mínimo'],
      ...S0.map((w, i) => [dateBR(w.ini), dateBR(w.fim), ...C.map(x => x.semanas[i].saldo), minimo])], `cenarios_caixa_${D.hoje}`);
  };
  const pintar = () => (ui.comparar ? pintarComparacao() : pintarCenario());

  $('#nc-cens', root).onclick = (e) => {
    const b = e.target.closest('[data-c]'); if (b) { ui.comparar = false; ui.cen = b.dataset.c; ls.set('nc-cenario', ui.cen); }
    else if (e.target.closest('#nc-comp-cen')) ui.comparar = !ui.comparar; else return;
    $$('#nc-cens .ch-chip', root).forEach(x => x.classList.toggle('on', ui.comparar ? x.id === 'nc-comp-cen' : x.dataset.c === ui.cen));
    pintar();
  };
  $('#nc-venc', root).onchange = (e) => { ui.vencidos = e.target.checked; ls.set('nc-vencidos', ui.vencidos); pintar(); };
  $('#nc-cen-btn', root).onclick = () => listaCenarios(root);
  $('#nc-par', root).onclick = () => parametros(root);
  $('#nc-contas-btn', root).onclick = () => {
    const m = modal({ title: 'Contas consideradas no saldo de hoje', body: `<p class="small muted" style="margin-top:0">Marque as contas cujo dinheiro está disponível. O bloqueio judicial vem desmarcado.${D.banco ? ' A escolha vale para a empresa (também no alerta de caixa mínimo).' : ''}</p>
      <div style="display:grid;gap:6px">${contasAtivas.map(s => `<label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" value="${s.conta_id}" ${contasSel.has(s.conta_id) ? 'checked' : ''}>
        <span style="flex:1">${esc(s.nome)}</span><span class="num ${+s.saldo_pago < 0 ? 'neg' : ''}">${money(s.saldo_pago)}</span></label>`).join('')}</div>`,
      foot: `<button class="btn" data-close>Cancelar</button>${!D.banco || podeCenarios() ? '<button class="btn primary" id="cs-ok">Aplicar</button>' : ''}` });
    $('#cs-ok', m.el) && ($('#cs-ok', m.el).onclick = async () => {
      const ids = $$('input[type=checkbox]', m.el).filter(i => i.checked).map(i => i.value);
      try { await salvarConfig({ contas: ids }); m.close(); render(root); } catch (e) { fail(e); }
    });
  };
  $('#nc-comp-btn', root).onclick = () => compromissos(root);
  pintar();
}

async function salvarConfig(mud) {
  if (!D.banco) {
    if ('contas' in mud) ls.set('nc-contas', mud.contas);
    if ('caixa_minimo' in mud) ls.set('nc-min', mud.caixa_minimo);
    Object.assign(D.cfg, mud); return;
  }
  const { empresa_id, atualizado_em, atualizado_por, ...atual } = D.cfg;
  await q(sb.from('caixa_config').upsert({ ...atual, ...mud, empresa_id: state.empresa.id }, { onConflict: 'empresa_id' }));
  toast('Parâmetros salvos');
}

function parametros(root) {
  const c = D.cfg, ed = !D.banco || podeCenarios();
  const m = modal({ title: 'Parâmetros da necessidade de caixa', body: `<div class="grid-form">
      <label>Caixa mínimo (R$)<input id="pc-min" inputmode="decimal" value="${money(c.caixa_minimo)}"></label>
      <label>Horizonte (semanas)<input id="pc-hor" type="number" min="4" max="26" value="${c.horizonte_semanas || 13}" ${D.banco ? '' : 'disabled'}></label>
      <label class="span2">Cenário que dispara o alerta<select id="pc-cen" ${D.banco ? '' : 'disabled'}>${D.lista.filter(x => x.id || x.tipo === 'base').map(x => `<option value="${x.id || ''}" ${(x.id || null) === (c.cenario_alerta || null) || (!c.cenario_alerta && x.tipo === 'base' && !x.id) ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
        <span class="small muted">Para escolher outro cenário padrão, salve-o antes em "Cenários e premissas".</span></label>
      <label class="chk span2"><input type="checkbox" id="pc-av" ${c.avisar ? 'checked' : ''} ${D.banco ? '' : 'disabled'}> Avisar quando o cenário do alerta ficar abaixo do mínimo</label>
      <label>Avisar se a falta for nas próximas (semanas)<input id="pc-avs" type="number" min="1" max="26" value="${c.avisar_semanas || 4}" ${D.banco ? '' : 'disabled'}></label>
      <div class="span2"><span class="small">Quem recebe o aviso</span><div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px">${PAPEIS.map(([k, l]) => `<label class="chk"><input type="checkbox" class="pc-pap" value="${k}" ${(c.avisar_papeis || []).includes(k) ? 'checked' : ''} ${D.banco ? '' : 'disabled'}> ${l}</label>`).join('')}</div></div></div>
    <p class="small muted">O aviso sai uma vez por semana crítica (e de novo se a falta piorar mais de 20%), quando a projeção é calculada na Necessidade de Caixa, na Minha Manhã ou na Central de Decisões. O mesmo cenário e o mesmo mínimo valem para esses painéis.</p>
    ${D.banco ? '' : '<p class="small warn">Sem o SQL 106, só o caixa mínimo é guardado (neste navegador).</p>'}`,
    foot: `<button class="btn" data-close>${ed ? 'Cancelar' : 'Fechar'}</button>${ed ? '<button class="btn primary" id="pc-ok">Salvar</button>' : ''}` });
  $('#pc-ok', m.el) && ($('#pc-ok', m.el).onclick = async () => {
    const mud = { caixa_minimo: parseNum($('#pc-min', m.el).value) };
    if (!(mud.caixa_minimo >= 0)) return toast('Informe o caixa mínimo', true);
    if (D.banco) {
      const h = +$('#pc-hor', m.el).value, s = +$('#pc-avs', m.el).value;
      if (!(h >= 4 && h <= 26)) return toast('O horizonte vai de 4 a 26 semanas', true);
      if (!(s >= 1 && s <= 26)) return toast('A janela do aviso vai de 1 a 26 semanas', true);
      Object.assign(mud, { horizonte_semanas: h, avisar_semanas: s, cenario_alerta: $('#pc-cen', m.el).value || null, avisar: $('#pc-av', m.el).checked,
        avisar_papeis: $$('.pc-pap', m.el).filter(i => i.checked).map(i => i.value) });
      if (mud.avisar && !mud.avisar_papeis.length) return toast('Escolha quem recebe o aviso', true);
    }
    try { await salvarConfig(mud); m.close(); render(root); } catch (e) { fail(e); }
  });
}

function listaCenarios(root) {
  const ed = D.banco && podeCenarios();
  const m = modal({ title: 'Cenários e premissas', wide: true, body: `
    <p class="small muted" style="margin-top:0">Cada cenário ajusta a mesma base (saldo de hoje, títulos em aberto, forecast e compromissos) pelas premissas. Os três padrões já vêm prontos e podem ser ajustados; crie outros para simular uma decisão (ex.: "RJ homologada em março", "Perda do cliente X").</p>
    <div class="table-wrap"><table><thead><tr><th>Cenário</th><th>Tipo</th><th>Premissas</th><th></th></tr></thead><tbody>
    ${D.lista.map((c, i) => `<tr data-i="${i}"><td class="nowrap"><span class="nc-dot" style="background:${esc(c.cor || '#64748b')}"></span><b>${esc(c.nome)}</b>${c.id && c.id === D.cfg.cenario_alerta || (!D.cfg.cenario_alerta && c.tipo === 'base') ? ' <span class="badge">alerta</span>' : ''}</td>
      <td>${K.TIPOS[c.tipo] || c.tipo}${c.id ? '' : ' <span class="small muted">(padrão)</span>'}</td><td class="wrap small">${esc(K.resumoPremissas(c.premissas))}</td>
      <td class="nowrap"><button class="btn ghost small" data-ed>${ed ? 'Editar' : 'Ver'}</button>${ed ? '<button class="btn ghost small" data-dup>Duplicar</button>' : ''}</td></tr>`).join('')}
    </tbody></table></div>${D.banco ? '' : '<p class="small warn">Rode o SQL 106 para salvar cenários e premissas.</p>'}`,
    foot: `<button class="btn" data-close>Fechar</button>${ed ? '<button class="btn primary" id="cn-novo">+ Novo cenário</button>' : ''}` });
  const depois = () => render(root);
  $('#cn-novo', m.el) && ($('#cn-novo', m.el).onclick = () => { m.close(); editarCenario({ tipo: 'personalizado', nome: '', cor: '#9333ea', ordem: 10, premissas: {} }, depois); });
  m.el.querySelector('tbody').onclick = (e) => {
    const i = e.target.closest('tr')?.dataset.i; if (i == null) return; const c = D.lista[+i];
    if (e.target.closest('[data-ed]')) { m.close(); editarCenario(c, depois); }
    if (e.target.closest('[data-dup]')) { m.close(); editarCenario({ tipo: 'personalizado', nome: `${c.nome} (cópia)`, cor: '#9333ea', ordem: 10, descricao: c.descricao, premissas: JSON.parse(JSON.stringify(c.premissas || {})) }, depois); }
  };
}

function editarCenario(c0, depois) {
  const ed = D.banco && podeCenarios(), novo = !c0.id;
  const p = K.normalizar(c0.premissas), rj = p.rj;
  const dis = ed ? '' : 'disabled';
  const num = (id, v, lbl, extra = '') => `<label>${lbl}<input id="${id}" inputmode="decimal" value="${String(v).replace('.', ',')}" ${dis} ${extra}></label>`;
  const evLinha = (ev = {}) => `<tr class="cn-ev"><td><input type="date" class="ev-d" value="${esc(ev.data || '')}" ${dis}></td><td><input class="ev-t" maxlength="120" value="${esc(ev.descricao || '')}" placeholder="ex.: venda do terreno" ${dis}></td>
    <td><input class="ev-v" inputmode="decimal" value="${ev.valor ? money(ev.valor) : ''}" placeholder="+ entra / − sai" ${dis}></td><td>${ed ? '<button class="btn ghost small ev-x" type="button">✕</button>' : ''}</td></tr>`;
  const m = modal({ title: novo && c0.tipo === 'personalizado' ? 'Novo cenário' : `Cenário ${c0.nome}`, wide: true, body: `<form id="cn-f">
    <div class="grid-form">
      <label>Nome<input id="cn-nome" maxlength="60" value="${esc(c0.nome || '')}" ${c0.tipo !== 'personalizado' ? 'readonly' : dis}></label>
      <label>Cor<input id="cn-cor" type="color" value="${esc(c0.cor || '#64748b')}" ${dis}></label>
      <label class="span2">Descrição<input id="cn-desc" maxlength="300" value="${esc(c0.descricao || '')}" ${dis}></label></div>
    <h3 class="nc-h">Recebimentos e pagamentos em aberto</h3>
    <div class="grid-form">
      ${num('cn-rp', p.receber_pct, 'Recebimentos que entram (%)')}${num('cn-ra', p.receber_atraso_dias, 'Atraso dos recebimentos (dias)')}
      ${num('cn-vr', p.vencidos_receber_pct, 'Vencidos a receber que entram (%)')}<span></span>
      ${num('cn-pp', p.pagar_pct, 'Pagamentos que saem (%)')}${num('cn-pa', p.pagar_atraso_dias, 'Pagamentos adiados (dias)')}</div>
    <h3 class="nc-h">Forecast e compromissos</h3>
    <div class="grid-form">
      <div class="span2" style="display:flex;gap:22px;flex-wrap:wrap"><label class="chk"><input type="checkbox" id="cn-fc" ${p.forecast ? 'checked' : ''} ${dis}> Completar com o forecast ainda não lançado</label>
      <label class="chk"><input type="checkbox" id="cn-cp" ${p.compromissos ? 'checked' : ''} ${dis}> Incluir os compromissos programados</label></div>
      ${num('cn-fr', p.forecast_receitas_pct, 'Realização das receitas do forecast (%)')}${num('cn-fd', p.forecast_despesas_pct, 'Realização das despesas do forecast (%)')}</div>
    <h3 class="nc-h">Simulação do pagamento da Recuperação Judicial</h3>
    <label class="chk"><input type="checkbox" id="rj-at" ${rj.ativo ? 'checked' : ''} ${dis}> Simular as parcelas do plano neste cenário</label>
    <div class="grid-form" id="rj-campos">
      <label>Passivo sujeito ao plano (R$)<input id="rj-pa" inputmode="decimal" value="${rj.passivo ? money(rj.passivo) : ''}" ${dis}></label>
      ${num('rj-de', rj.desagio_pct, 'Deságio (%)')}
      ${num('rj-ca', rj.carencia_meses, 'Carência (meses)')}${num('rj-np', rj.parcelas, 'Parcelas (meses)')}
      ${num('rj-ju', rj.juros_aa_pct, 'Juros e correção (% ao ano)')}
      <label>Início (homologação)<input id="rj-in" type="month" value="${esc(rj.inicio)}" ${dis}></label>
      ${num('rj-di', rj.dia, 'Dia do pagamento')}</div>
    <div class="small" id="rj-prev" style="margin-top:6px"></div>
    <p class="small muted">Se a parcela da RJ já estiver nos compromissos programados, desmarque os compromissos ou a simulação, para não contar duas vezes.</p>
    <h3 class="nc-h">Eventos pontuais</h3>
    <div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Valor (R$)</th><th></th></tr></thead><tbody id="cn-evs">${p.eventos.map(evLinha).join('')}</tbody></table></div>
    ${ed ? '<button class="btn ghost small" type="button" id="cn-ev-add">+ Evento</button>' : ''}</form>`,
    foot: `${ed && c0.tipo === 'personalizado' && c0.id ? '<button class="btn danger" id="cn-del">Excluir</button>' : ''}${ed && c0.tipo !== 'personalizado' && c0.id ? '<button class="btn" id="cn-rest">Restaurar padrão</button>' : ''}<span class="spacer"></span>
      <button class="btn" data-close>${ed ? 'Cancelar' : 'Fechar'}</button>${ed ? '<button class="btn primary" id="cn-ok">Salvar</button>' : ''}` });
  const el = m.el, v = (id) => $('#' + id, el).value, n = (id) => parseNum(v(id));
  const ler = () => ({
    receber_pct: n('cn-rp'), receber_atraso_dias: n('cn-ra'), vencidos_receber_pct: n('cn-vr'), pagar_pct: n('cn-pp'), pagar_atraso_dias: n('cn-pa'),
    forecast: $('#cn-fc', el).checked, forecast_receitas_pct: n('cn-fr'), forecast_despesas_pct: n('cn-fd'), compromissos: $('#cn-cp', el).checked,
    rj: { ativo: $('#rj-at', el).checked, passivo: n('rj-pa') || 0, desagio_pct: n('rj-de'), carencia_meses: n('rj-ca'), parcelas: n('rj-np'), juros_aa_pct: n('rj-ju'), inicio: v('rj-in'), dia: n('rj-di') },
    eventos: $$('.cn-ev', el).map(tr => ({ data: $('.ev-d', tr).value, descricao: $('.ev-t', tr).value.trim(), valor: parseNum($('.ev-v', tr).value) })).filter(e => e.data || e.valor),
  });
  const prever = () => {
    const at = $('#rj-at', el).checked; $('#rj-campos', el).style.opacity = at ? 1 : .5;
    const s = K.simularRJ(ler().rj);
    $('#rj-prev', el).innerHTML = at && s.parcela ? `Valor a pagar depois do deságio: <b>${money(s.liquido)}</b> · parcela de <b>${money(s.parcela)}</b> por mês, de ${dateBR(s.primeira)} a ${dateBR(s.ultima)} · total pago ${money(s.total)}.`
      : at ? '<span class="muted">Informe o passivo e o mês de início para ver a parcela.</span>' : '';
  };
  $$('#rj-campos input, #rj-at', el).forEach(i => (i.oninput = prever)); prever();
  $('#cn-ev-add', el) && ($('#cn-ev-add', el).onclick = () => $('#cn-evs', el).insertAdjacentHTML('beforeend', evLinha()));
  $('#cn-evs', el).onclick = (e) => { if (e.target.closest('.ev-x')) e.target.closest('tr').remove(); };
  $('#cn-del', el) && ($('#cn-del', el).onclick = async () => {
    if (!await confirmDialog(`Excluir o cenário "${c0.nome}"?`)) return;
    try { await q(sb.from('caixa_cenarios').delete().eq('id', c0.id)); if (D.cfg.cenario_alerta === c0.id) await salvarConfig({ cenario_alerta: null }); toast('Cenário excluído'); m.close(); depois(); } catch (e) { fail(e); }
  });
  $('#cn-rest', el) && ($('#cn-rest', el).onclick = async () => {
    const pd = K.PADROES.find(x => x.tipo === c0.tipo); if (!pd || !await confirmDialog(`Voltar o cenário ${c0.nome} às premissas padrão?`)) return;
    try { await q(sb.from('caixa_cenarios').update({ premissas: pd.premissas, descricao: pd.descricao, cor: pd.cor }).eq('id', c0.id)); toast('Premissas padrão restauradas'); m.close(); depois(); } catch (e) { fail(e); }
  });
  $('#cn-ok', el) && ($('#cn-ok', el).onclick = async () => {
    const reg = { nome: v('cn-nome').trim(), cor: v('cn-cor'), descricao: v('cn-desc').trim() || null, premissas: ler() };
    const erros = K.validar(reg); if (erros.length) return toast(erros[0], true);
    reg.premissas = K.normalizar(reg.premissas);
    try {
      if (c0.id) await q(sb.from('caixa_cenarios').update(reg).eq('id', c0.id));
      else await q(sb.from('caixa_cenarios').insert({ ...reg, empresa_id: state.empresa.id, tipo: c0.tipo, ordem: c0.ordem ?? 10 }));
      toast('Cenário salvo'); m.close(); depois();
    } catch (e) { fail(/caixa_cenarios_nome/.test(e.message || '') ? new Error('Já existe um cenário com esse nome.') : e); }
  });
}

function detalheSemana(w, cen) {
  const c = state.cad;
  const lanc = w.itens.filter(x => x.tipo === 'lanc').sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const fc = {}; for (const x of w.itens.filter(x => x.tipo === 'fc')) fc[x.plano_id] = (fc[x.plano_id] || 0) + x.v;
  const comp = w.itens.filter(x => x.tipo === 'comp'), sim = w.itens.filter(x => x.tipo === 'sim');
  modal({ title: `Semana de ${dateBR(w.ini)} a ${dateBR(w.fim)}${cen ? ' · ' + esc(cen.nome) : ''}`, wide: true, body: `
    ${sim.length ? `<h3>Simulações do cenário</h3><table><tbody>${sim.map(x => `<tr><td>${dateBR(x.data)}</td><td>${esc(x.desc)}</td><td class="num ${x.v < 0 ? 'neg' : 'pos'}">${money(x.v)}</td></tr>`).join('')}</tbody></table>` : ''}
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

// Dashboard executivo: visão de um mês fechado para a direção — KPIs clicáveis (painel lateral com a composição),
// saúde financeira (nota 0–100 com fatores e regras explícitas), leituras automáticas por regra, aging,
// maiores clientes e pagamentos, evolução de 12 meses. Usa só lançamentos com conta bancária (mesma base dos saldos).
import { sb, state, q, fetchAll, montarMatriz, montarDRE, temArea } from '../lib/data.js';
import { $, esc, money0, pct, dateBR, today, fail, chart, COR, MESES, MESES_CURTO, moneyTick, exportXLSX } from '../lib/ui.js';
import { kpiGrid, drawer, composicao, barList, score, faixa, insight, tabela, aging, trend, variacao } from '../lib/componentes.js';

export const title = 'Dashboard Executivo';

const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } } };
const fimMes = (a, m) => new Date(a, m, 0).getDate();
const iso = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ant = (a, m) => (m === 1 ? [a - 1, 12] : [a, m - 1]);

const ui = { ref: null };

async function resumo(ano) {
  const rows = await q(sb.rpc('resumo_mensal', { p_empresa: state.empresa.id, p_ano: ano, p_status: ['Pago'], p_conta: null, p_grupo: null, p_cc: null, p_favorecido: null, p_disp: null }));
  return montarMatriz(rows.map(r => ({ plano_id: r.plano_id, mes: r.mes, total: +r.total })));
}

async function carregar(ano, mes) {
  const e = state.empresa.id, [aA, mA] = ant(ano, mes);
  const ini = iso(aA, mA, 1), fim = iso(ano, mes, fimMes(ano, mes));
  const seguro = (p, v) => p.catch(() => v);
  const [mat, matAnt, saldos, abertos, pagos, budget, fidc] = await Promise.all([
    resumo(ano), resumo(ano - 1),
    q(sb.rpc('saldos_contas', { p_empresa: e })),
    fetchAll(() => sb.from('v_lancamentos').select('id,data,valor_sinal,tipo,favorecido_nome,plano_codigo,plano_nome,descricao,documento,fidc_proposta_id')
      .eq('empresa_id', e).eq('status', 'Em aberto').in('tipo', ['E', 'S']).order('id')),
    fetchAll(() => sb.from('v_lancamentos').select('data,valor_sinal,tipo,favorecido_nome,plano_codigo')
      .eq('empresa_id', e).eq('status', 'Pago').in('tipo', ['E', 'S']).not('conta_id', 'is', null).gte('data', ini).lte('data', fim).order('id')),
    fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor').eq('empresa_id', e).eq('cenario', 'budget').eq('ano', ano).order('id')),
    seguro(fetchAll(() => sb.from('fidc_operacoes').select('data,valor_face,custo_total').eq('empresa_id', e).gte('data', ini).lte('data', fim).order('id')), []),
  ]);
  return { ano, mes, aA, mA, mat, matAnt, saldos, abertos, pagos, budget, fidc };
}

// série contínua de 24 meses (ano anterior + ano) para comparar com mês anterior e médias móveis
function serie(D) {
  const s = (k) => [...D.matAnt.tipo[k], ...D.mat.tipo[k]];
  return { E: s('E'), S: s('S'), T: s('T'), i: 11 + D.mes };   // i = índice do mês de referência
}
const somaPlanos = (mat, filtro, m) => state.cad.contasPlano.filter(filtro).reduce((t, p) => t + (mat.conta[p.id]?.[m - 1] || 0), 0);

function calcular(D) {
  const c = state.cad, hoje = today(), S = serie(D), i = S.i;
  const rec = S.E[i], recA = S.E[i - 1], pag = -S.S[i], pagA = -S.S[i - 1];
  const ger = S.E[i] + S.S[i], gerA = S.E[i - 1] + S.S[i - 1];
  const med = (arr, n) => arr.slice(i - n + 1, i + 1).reduce((t, v) => t + v, 0) / n;
  const ger3 = med(S.E.map((v, k) => v + S.S[k]), 3), rec3 = med(S.E, 3);
  const matMes = (a) => (a === D.ano ? D.mat : D.matAnt);
  const rec101 = somaPlanos(D.mat, p => p.codigo.startsWith('1.01'), D.mes);

  // saldo disponível: mesmas contas da Necessidade de caixa / Minha Manhã
  const salvas = ls.get('nc-contas', null);
  const sel = new Set(salvas || D.saldos.filter(s => !/bloqueio/i.test(s.nome)).map(s => s.conta_id));
  const contasSel = D.saldos.filter(s => sel.has(s.conta_id)), contasFora = D.saldos.filter(s => !sel.has(s.conta_id) && Math.abs(+s.saldo_pago) > 0.005);
  const disp = contasSel.reduce((t, s) => t + +s.saldo_pago, 0);

  // em aberto
  const ab = D.abertos.map(l => ({ ...l, valor: Math.abs(+l.valor_sinal) }));
  const receber = ab.filter(l => l.tipo === 'E'), pagar = ab.filter(l => l.tipo === 'S');
  const tot = (a) => a.reduce((t, l) => t + l.valor, 0);
  const vencRec = receber.filter(l => l.data < hoje && !l.fidc_proposta_id), vencPag = pagar.filter(l => l.data < hoje);
  const d30 = addDias(hoje, 30);
  const rec30 = tot(receber.filter(l => l.data <= d30 && l.data >= hoje)), pag30 = tot(pagar.filter(l => l.data <= d30));
  const projetado = disp + rec30 - pag30;

  // pagos do mês por beneficiário
  const [ini, fim] = [iso(D.ano, D.mes, 1), iso(D.ano, D.mes, fimMes(D.ano, D.mes))];
  const doMes = D.pagos.filter(l => l.data >= ini && l.data <= fim);
  const agrupa = (arr) => { const g = {}; for (const l of arr) { const k = l.favorecido_nome || '(sem beneficiário)'; (g[k] ||= { nome: k, valor: 0, qtd: 0 }); g[k].valor += Math.abs(+l.valor_sinal); g[k].qtd++; } return Object.values(g).sort((a, b) => b.valor - a.valor); };
  const clientes = agrupa(doMes.filter(l => l.tipo === 'E' && String(l.plano_codigo).startsWith('1.01')));
  const fornec = agrupa(doMes.filter(l => l.tipo === 'S'));
  const totCli = clientes.reduce((t, x) => t + x.valor, 0), totFor = fornec.reduce((t, x) => t + x.valor, 0);

  // DRE do mês e do anterior
  const dre = montarDRE(D.mat).val, dreA = D.aA === D.ano ? dre : montarDRE(D.matAnt).val;
  const rb = dre.receita_bruta[D.mes - 1], rbA = dreA.receita_bruta[D.mA - 1];
  const mEb = rb ? dre.ebitda[D.mes - 1] / rb : null, mEbA = rbA ? dreA.ebitda[D.mA - 1] / rbA : null;

  // orçamento: despesas pagas × budget acumulado até o mês
  const orc = {}; for (const o of D.budget) if (o.mes <= D.mes) orc[o.plano_id] = (orc[o.plano_id] || 0) + Math.abs(+o.valor);
  let real = 0, orcT = 0;
  for (const p of c.contasPlano.filter(p => p.tipo === 'S' && orc[p.id])) { orcT += orc[p.id]; real += Math.abs((D.mat.conta[p.id] || []).slice(0, D.mes).reduce((t, v) => t + v, 0)); }
  const usoOrc = orcT ? real / orcT : null;

  // FIDC no mês
  const fMes = D.fidc.filter(f => f.data >= ini && f.data <= fim);
  const face = fMes.reduce((t, f) => t + +f.valor_face, 0), custoF = fMes.reduce((t, f) => t + +f.custo_total, 0);
  const depFidc = rec101 ? face / rec101 : null;

  // saúde financeira
  const liq = pag30 ? (Math.max(disp, 0) + rec30) / pag30 : null;
  const inad = tot(receber) ? tot(vencRec) / tot(receber) : 0;
  const conc = totCli ? (clientes[0]?.valor || 0) / totCli : null;
  const gerRel = rec3 ? ger3 / rec3 : null;
  const fatores = [
    { nome: 'Liquidez 30 dias', peso: .25, nota: faixa(liq, .5, 1.2), valorTxt: liq == null ? '–' : liq.toFixed(2).replace('.', ',') + '×',
      regra: '(saldo disponível + a receber nos próximos 30 dias) ÷ a pagar até 30 dias, incluindo vencidos. 0,5× ou menos = 0; 1,2× ou mais = 100.' },
    { nome: 'Geração de caixa', peso: .25, nota: faixa(gerRel, -.05, .05), valorTxt: gerRel == null ? '–' : pct(gerRel),
      regra: 'Média dos últimos 3 meses de (entradas − saídas, sem transferências) ÷ média das entradas. −5% ou pior = 0; +5% ou melhor = 100.' },
    { nome: 'Inadimplência', peso: .15, nota: faixa(inad, .3, 0), valorTxt: pct(inad),
      regra: 'A receber vencido (fora de borderô) ÷ total a receber em aberto. 30% ou mais = 0; 0% = 100.' },
    { nome: 'Dependência de antecipação', peso: .15, nota: faixa(depFidc, .8, .2), valorTxt: depFidc == null ? '–' : pct(depFidc),
      regra: 'Valor de face antecipado no FIDC no mês ÷ receitas (1.01) recebidas no mês. 80% ou mais = 0; 20% ou menos = 100.' },
    { nome: 'Concentração de clientes', peso: .1, nota: faixa(conc, .4, .1), valorTxt: conc == null ? '–' : pct(conc),
      regra: 'Participação do maior cliente nas receitas (1.01) recebidas no mês. 40% ou mais = 0; 10% ou menos = 100.' },
    { nome: 'Aderência ao orçamento', peso: .1, nota: faixa(usoOrc, 1.3, 1), valorTxt: usoOrc == null ? 'sem budget' : pct(usoOrc),
      regra: 'Despesas pagas ÷ budget acumulado do ano até o mês, só nas classificações com budget. 130% ou mais = 0; até 100% = 100.' },
  ];

  // leituras automáticas (regra fixa)
  const ins = [];
  const vR = variacao(rec, recA), vP = variacao(pag, pagA);
  if (vR != null) ins.push({ categoria: 'Recebimentos', texto: `${money0(rec)} no mês, ${vR >= 0 ? 'alta' : 'queda'} de ${pct(Math.abs(vR))} sobre ${MESES_CURTO[D.mA - 1]} e ${pct(rec / (rec3 || 1) - 1)} contra a média de 3 meses.`, tendencia: vR >= 0 ? 'alta' : 'baixa', bom: vR >= 0 });
  if (vP != null) ins.push({ categoria: 'Pagamentos', texto: `${money0(pag)} no mês, ${vP >= 0 ? 'alta' : 'queda'} de ${pct(Math.abs(vP))} sobre ${MESES_CURTO[D.mA - 1]}.`, tendencia: vP >= 0 ? 'alta' : 'baixa', bom: vP <= 0 });
  const neg6 = S.E.slice(i - 5, i + 1).filter((v, k) => v + S.S[i - 5 + k] < 0).length;
  ins.push({ categoria: 'Geração de caixa', texto: `${ger >= 0 ? 'Positiva' : 'Negativa'} em ${money0(ger)} no mês; ${neg6} dos últimos 6 meses fecharam negativos.`, tendencia: ger >= 0 ? 'alta' : 'baixa', bom: ger >= 0 });
  if (clientes[0]) ins.push({ categoria: 'Clientes', texto: `${clientes[0].nome} respondeu por ${pct(conc)} das receitas do mês; os 5 maiores somam ${pct(clientes.slice(0, 5).reduce((t, x) => t + x.valor, 0) / totCli)}.`, tendencia: 'neutra', bom: conc <= .2 });
  if (fornec[0]) ins.push({ categoria: 'Pagamentos por beneficiário', texto: `${fornec[0].nome} recebeu ${pct(fornec[0].valor / totFor)} dos pagamentos do mês (${money0(fornec[0].valor)}).`, tendencia: 'neutra', bom: null });
  if (mEb != null && mEbA != null) ins.push({ categoria: 'Margem EBITDA gerencial', texto: `${pct(mEb)} no mês contra ${pct(mEbA)} em ${MESES_CURTO[D.mA - 1]} (${mEb >= mEbA ? '+' : '−'}${(Math.abs(mEb - mEbA) * 100).toFixed(1).replace('.', ',')} p.p.).`, tendencia: mEb >= mEbA ? 'alta' : 'baixa', bom: mEb >= mEbA });
  if (face) ins.push({ categoria: 'Antecipação (FIDC)', texto: `${money0(face)} antecipados no mês (${pct(depFidc)} das receitas) com custo de ${money0(custoF)} (${pct(custoF / face, 2)} do valor de face).`, tendencia: 'neutra', bom: depFidc <= .5 });
  ins.push({ categoria: 'Inadimplência', texto: `${money0(tot(vencRec))} a receber vencidos fora de borderô (${pct(inad)} da carteira em aberto, ${vencRec.length} título(s)).`, tendencia: 'neutra', bom: inad <= .1 });

  return { S, i, rec, recA, pag, pagA, ger, gerA, ger3, disp, contasSel, contasFora, receber, pagar, vencRec, vencPag, tot, rec30, pag30, projetado,
    clientes, fornec, totCli, totFor, fatores, ins, matMes, hoje };
}

export async function render(root) {
  if (!temArea('fin') || state.papel === 'compras') { root.innerHTML = '<div class="card"><p>O Dashboard executivo usa os dados do Financeiro.</p></div>'; return; }
  const h = today(), [ay, am] = [+h.slice(0, 4), +h.slice(5, 7)];
  if (!ui.ref) { const [a, m] = ant(ay, am); ui.ref = `${a}-${String(m).padStart(2, '0')}`; }
  const opcoes = []; for (let k = 0, a = ay, m = am; k < 18; k++) { opcoes.push(`${a}-${String(m).padStart(2, '0')}`); [a, m] = ant(a, m); }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Dashboard executivo</h2><div class="muted small">Movimento pago com conta bancária. Saldos e em aberto são de hoje. Clique nos indicadores para ver a composição.</div></div>
      <div class="toolbar" style="margin:0"><label>Mês de referência<select id="ex-ref">${opcoes.map(o => `<option value="${o}" ${o === ui.ref ? 'selected' : ''}>${MESES[+o.slice(5) - 1]} ${o.slice(0, 4)}${o === `${ay}-${String(am).padStart(2, '0')}` ? ' (até hoje)' : ''}</option>`).join('')}</select></label>
        <button class="btn ghost" id="ex-xls">Excel</button></div></div>
    <div id="ex-corpo"><div class="loading">Carregando…</div></div>`;
  $('#ex-ref', root).onchange = (e) => { ui.ref = e.target.value; render(root); };
  const [ano, mes] = ui.ref.split('-').map(Number);
  let D, R; try { D = await carregar(ano, mes); R = calcular(D); } catch (e) { fail(e); $('#ex-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const nomeMes = `${MESES_CURTO[mes - 1]}/${ano}`, nomeAnt = MESES_CURTO[D.mA - 1];
  const corpo = $('#ex-corpo', root);
  corpo.innerHTML = `<div id="ex-kpis"></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2 style="margin:0">Saúde financeira</h2><span class="muted small">${esc(nomeMes)}</span></div><div id="ex-score"></div></div>
      <div class="card"><div class="card-head"><h2 style="margin:0">Leituras do mês</h2><span class="muted small">por regra, sem IA</span></div><div class="cp-insights">${R.ins.map(insight).join('')}</div></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Entradas, saídas e geração de caixa — 12 meses até ${esc(nomeMes)}</h2><div class="chart-box"><canvas id="ex-c1"></canvas></div></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2 style="margin:0">A receber por vencimento</h2><span class="muted small">${money0(R.tot(R.receber))}</span></div><div id="ex-ag-rec"></div></div>
      <div class="card"><div class="card-head"><h2 style="margin:0">A pagar por vencimento</h2><span class="muted small">${money0(R.tot(R.pagar))}</span></div><div id="ex-ag-pag"></div></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2 style="margin:0">Maiores clientes — ${esc(nomeMes)}</h2><span class="muted small">receitas 1.01 recebidas</span></div><div id="ex-cli"></div></div>
      <div class="card"><div class="card-head"><h2 style="margin:0">Maiores pagamentos — ${esc(nomeMes)}</h2><span class="muted small">por beneficiário</span></div><div id="ex-for"></div></div>
    </div>`;

  // ---------- KPIs + painéis
  const tituloLista = (arr, { vencido = false } = {}) => tabela(
    [{ titulo: 'Vencimento' }, { titulo: 'Beneficiário' }, { titulo: 'Classificação' }, { titulo: 'Documento' }, { titulo: 'Valor', num: true }],
    [...arr].sort((a, b) => vencido ? b.valor - a.valor : a.data.localeCompare(b.data)).slice(0, 300).map(l => ({
      celulas: [dateBR(l.data), l.favorecido_nome || '', l.plano_nome || '', l.documento || '', money0(l.valor)], onClick: () => abrirLanc(l.id) })));
  const painelAging = (titulo, arr) => {
    const fx = aging(arr, R.hoje);
    const dw = drawer({ titulo, subtitulo: `${arr.length} título(s) · ${money0(R.tot(arr))}`, corpo: '' });
    const lista = () => dw.corpo(composicao(fx.map(f => ({ nome: f.nome, sub: `${f.qtd} título(s)`, valor: f.valor,
      onClick: f.qtd ? () => { const n = document.createElement('div'); const v = document.createElement('button'); v.className = 'btn ghost small'; v.textContent = '← Voltar às faixas'; v.onclick = lista;
        const t = document.createElement('h3'); t.textContent = f.nome; t.style.margin = '10px 0'; n.append(v, t, tituloLista(f.itens)); dw.corpo(n); } : null })), { total: true }));
    lista();
  };
  const porClasse = (tipo) => {
    const lin = state.cad.classes.filter(c => c.tipo === tipo).map(c => ({ nome: c.label, valor: Math.abs(D.mat.classe[c.id]?.[mes - 1] || 0),
      ant: Math.abs(R.matMes(D.aA).classe[c.id]?.[D.mA - 1] || 0) })).filter(x => x.valor || x.ant).sort((a, b) => b.valor - a.valor);
    return composicao(lin.map(x => ({ nome: x.nome, valor: x.valor, sub: `${nomeAnt}: ${money0(x.ant)}` })), { total: true });
  };
  const KP = {
    saldo: { label: 'Saldo disponível hoje', valor: money0(R.disp), tom: R.disp < 0 ? 'neg' : '', sub: `${R.contasSel.length} conta(s)`,
      abrir: () => { const n = document.createElement('div'); n.append(composicao(R.contasSel.map(s => ({ nome: s.nome, valor: +s.saldo_pago })).sort((a, b) => b.valor - a.valor), { total: true }));
        if (R.contasFora.length) { const t = document.createElement('h3'); t.textContent = 'Fora do saldo disponível'; t.style.margin = '16px 0 6px'; n.append(t, composicao(R.contasFora.map(s => ({ nome: s.nome, valor: +s.saldo_pago })), { total: true })); }
        const p = document.createElement('p'); p.className = 'small muted'; p.textContent = 'As contas consideradas são as mesmas escolhidas na Necessidade de caixa.'; n.append(p);
        drawer({ titulo: 'Saldo disponível hoje', subtitulo: money0(R.disp), corpo: n }); } },
    rec: { label: `Recebimentos ${nomeMes}`, valor: money0(R.rec), trendHtml: trend(variacao(R.rec, R.recA)), sub: `vs ${nomeAnt}`,
      abrir: () => drawer({ titulo: `Recebimentos ${nomeMes}`, subtitulo: `${money0(R.rec)} · ${nomeAnt}: ${money0(R.recA)}`, corpo: porClasse('E') }) },
    pag: { label: `Pagamentos ${nomeMes}`, valor: money0(R.pag), trendHtml: trend(variacao(R.pag, R.pagA), { bomSeSobe: false }), sub: `vs ${nomeAnt}`,
      abrir: () => drawer({ titulo: `Pagamentos ${nomeMes}`, subtitulo: `${money0(R.pag)} · ${nomeAnt}: ${money0(R.pagA)}`, corpo: porClasse('S') }) },
    ger: { label: 'Geração de caixa no mês', valor: money0(R.ger), tom: R.ger < 0 ? 'neg' : 'pos', sub: `média 3 meses ${money0(R.ger3)}`,
      abrir: () => drawer({ titulo: 'Geração de caixa', subtitulo: nomeMes, corpo: composicao([
        { nome: 'Entradas', valor: R.S.E[R.i] }, { nome: 'Saídas', valor: R.S.S[R.i] },
        { nome: 'Transferências (fora da geração)', valor: R.S.T[R.i], sub: 'entre contas da empresa' },
        { nome: `Geração em ${nomeAnt}`, valor: R.gerA }, { nome: 'Média dos últimos 3 meses', valor: R.ger3 }]) }) },
    receber: { label: 'A receber em aberto', valor: money0(R.tot(R.receber)), tom: 'pos', sub: `${R.receber.length} título(s)`, abrir: () => painelAging('A receber em aberto', R.receber) },
    pagar: { label: 'A pagar em aberto', valor: money0(R.tot(R.pagar)), tom: 'neg', sub: `${R.vencPag.length} vencido(s): ${money0(R.tot(R.vencPag))}`, abrir: () => painelAging('A pagar em aberto', R.pagar) },
    inad: { label: 'A receber vencido', valor: money0(R.tot(R.vencRec)), tom: R.vencRec.length ? 'warn' : '', sub: `${R.vencRec.length} título(s), fora de borderô`,
      abrir: () => drawer({ titulo: 'A receber vencido (fora de borderô)', subtitulo: `${R.vencRec.length} título(s) · ${money0(R.tot(R.vencRec))}`, corpo: tituloLista(R.vencRec, { vencido: true }) }) },
    proj: { label: 'Saldo projetado 30 dias', valor: money0(R.projetado), tom: R.projetado < 0 ? 'neg' : '', sub: 'disponível + receber − pagar',
      abrir: () => drawer({ titulo: 'Saldo projetado para 30 dias', subtitulo: `até ${dateBR(addDias(R.hoje, 30))}`, corpo: composicao([
        { nome: 'Saldo disponível hoje', valor: R.disp }, { nome: 'A receber nos próximos 30 dias', valor: R.rec30, sub: 'não inclui vencidos' },
        { nome: 'A pagar até 30 dias', valor: -R.pag30, sub: 'inclui vencidos' }], { total: true, rotuloTotal: 'Saldo projetado' }) }) },
  };
  kpiGrid($('#ex-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k, clicavel: true })), (id) => KP[id].abrir());

  const nota = score($('#ex-score', corpo), { nome: 'Saúde financeira do mês', fatores: R.fatores });

  // ---------- gráfico 12 meses
  const idx = Array.from({ length: 12 }, (_, k) => R.i - 11 + k);
  const rot = idx.map(k => `${MESES_CURTO[k % 12]}/${String(k < 12 ? ano - 1 : ano).slice(2)}`);
  chart($('#ex-c1', corpo), { type: 'bar', data: { labels: rot, datasets: [
    { label: 'Entradas', data: idx.map(k => R.S.E[k]), backgroundColor: COR.entrada, order: 2 },
    { label: 'Saídas', data: idx.map(k => -R.S.S[k]), backgroundColor: COR.saida, order: 2 },
    { type: 'line', label: 'Geração de caixa', data: idx.map(k => R.S.E[k] + R.S.S[k]), borderColor: COR.saldo, backgroundColor: COR.saldo, tension: .25, order: 1 }] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: moneyTick } } },
      plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money0(x.raw)}` } } } } });

  // ---------- aging e rankings
  const ag = (el, arr, tit) => barList(el, aging(arr, R.hoje).map((f, k) => ({ nome: f.nome, valor: f.valor, sub: `${f.qtd} título(s)`, cor: k < 2 ? 7 : k,
    onClick: f.qtd ? () => drawer({ titulo: `${tit}: ${f.nome}`, subtitulo: `${f.qtd} título(s) · ${money0(f.valor)}`, corpo: tituloLista(f.itens) }) : null })));
  ag($('#ex-ag-rec', corpo), R.receber, 'A receber'); ag($('#ex-ag-pag', corpo), R.pagar, 'A pagar');
  barList($('#ex-cli', corpo), R.clientes.slice(0, 10).map(x => ({ nome: x.nome, valor: x.valor, txt: `${money0(x.valor)} · ${pct(x.valor / R.totCli)}`, sub: `${x.qtd} recebimento(s)`, cor: 0 })));
  barList($('#ex-for', corpo), R.fornec.slice(0, 10).map(x => ({ nome: x.nome, valor: x.valor, txt: `${money0(x.valor)} · ${pct(x.valor / R.totFor)}`, sub: `${x.qtd} pagamento(s)`, cor: 1 })));

  $('#ex-xls', root).onclick = () => exportXLSX([
    [`Dashboard executivo — ${state.empresa.nome || ''} — ${MESES[mes - 1]} ${ano}`], [],
    ['Indicador', 'Valor'], ...Object.values(KP).map(k => [k.label, k.valor]), [],
    ['Saúde financeira', nota ?? ''], ['Fator', 'Valor', 'Nota', 'Peso', 'Regra'], ...R.fatores.map(f => [f.nome, f.valorTxt, f.nota ?? '', f.peso, f.regra]), [],
    ['Leituras do mês'], ...R.ins.map(x => [x.categoria, x.texto]), [],
    ['Maiores clientes', 'Valor', '%'], ...R.clientes.slice(0, 20).map(x => [x.nome, x.valor, x.valor / R.totCli]), [],
    ['Maiores pagamentos', 'Valor', '%'], ...R.fornec.slice(0, 20).map(x => [x.nome, x.valor, x.valor / R.totFor]),
  ], `dashboard-executivo-${ui.ref}`);
}

async function abrirLanc(id) {
  try { const [{ abrirLancamento }, [full]] = await Promise.all([import('../lib/lanc-form.js'), q(sb.from('lancamentos').select('*').eq('id', id))]);
    document.querySelector('.cp-drawer-back')?.remove(); if (full) abrirLancamento(full, () => {}); } catch (e) { fail(e); }
}

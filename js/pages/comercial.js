// Comercial › Painel: faturamento pelas NF-e de saída (pedido continua no Iniflex) × meta, carteira (ativos, novos, esfriando,
// inativos), representantes, estados, produtos com preço médio e margem estimada pela estrutura, funil e nota comercial.
import { sb, state, q } from '../lib/data.js';
import { $, money0, money, pct, dateBR, today, fail, chart, COR, MESES, MESES_CURTO, moneyTick } from '../lib/ui.js';
import { kpiGrid, drawer, barList, score, faixa, tabela, trend, variacao } from '../lib/componentes.js';
import { baseComercial, ST_CLI, ABERTAS, interno, addDias } from '../lib/comercial.js';
import { qtd, unit } from '../lib/compras.js';

export const title = 'Painel comercial';
const ui = { ref: null };

export async function render(root) {
  const h = today(); ui.ref ||= h.slice(0, 7);
  const opcoes = []; for (let k = 0, d = new Date(h.slice(0, 7) + '-15'); k < 18; k++, d.setMonth(d.getMonth() - 1)) opcoes.push(d.toISOString().slice(0, 7));
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Painel comercial</h2><div class="muted small">Faturamento = NF-e de venda autorizadas (o pedido de venda continua no Iniflex)${interno() ? '' : ' · só a sua carteira'}.</div></div>
      <label>Mês<select id="cm-ref">${opcoes.map(o => `<option value="${o}" ${o === ui.ref ? 'selected' : ''}>${MESES[+o.slice(5) - 1]} ${o.slice(0, 4)}${o === h.slice(0, 7) ? ' (até hoje)' : ''}</option>`).join('')}</select></label></div>
    <div id="cm-corpo"><div class="loading">Carregando…</div></div>`;
  $('#cm-ref', root).onchange = (e) => { ui.ref = e.target.value; render(root); };
  let B, metas, ops, itens;
  const [ano, mes] = ui.ref.split('-').map(Number), ini = `${ui.ref}-01`, fim = new Date(ano, mes, 0).toISOString().slice(0, 10);
  try {
    B = await baseComercial();
    const e = state.empresa.id;
    [metas, ops, itens] = await Promise.all([q(sb.from('comercial_metas').select('*').eq('empresa_id', e).in('ano', [ano, ano - 1])),
      q(sb.from('comercial_oportunidades').select('id,etapa,valor_estimado,probabilidade,fechado_em,vendedor_id,criado_em').eq('empresa_id', e)),
      q(sb.rpc('comercial_itens', { p_empresa: e, p_de: addDias(ini, -335), p_ate: fim }))]);
  } catch (err) { fail(err); $('#cm-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }

  const N = B.notas, soma = (arr) => arr.reduce((t, n) => t + +n.valor, 0);
  const noMes = N.filter(n => n.emissao >= ini && n.emissao <= fim), mesAnt = N.filter(n => n.emissao.slice(0, 7) === `${ano - 1}-${String(mes).padStart(2, '0')}` && n.emissao.slice(8) <= (ui.ref === today().slice(0, 7) ? today().slice(8) : '31'));   // mês corrente: compara até o mesmo dia
  const noAno = N.filter(n => n.emissao >= `${ano}-01-01` && n.emissao <= fim);
  const fatMes = soma(noMes), fatAno = soma(noAno), fatMesAA = soma(mesAnt);
  const metaEmp = (m) => metas.filter(x => !x.vendedor_id && x.ano === ano && x.mes === m).reduce((t, x) => t + +x.valor, 0)
    || metas.filter(x => x.vendedor_id && x.ano === ano && x.mes === m).reduce((t, x) => t + +x.valor, 0);
  const metaMes = metaEmp(mes), metaAno = Array.from({ length: mes }, (_, i) => metaEmp(i + 1)).reduce((t, v) => t + v, 0);
  const I = Object.values(B.info), cont = (st) => I.filter(c => c.st === st);
  const ativos = I.filter(c => c.desde <= 90), novos = cont('novo'), esfr = cont('esfriando'), inat = cont('inativo');
  const opAb = ops.filter(o => ABERTAS.includes(o.etapa)), pipe = opAb.reduce((t, o) => t + (+o.valor_estimado || 0) * ((o.probabilidade ?? 50) / 100), 0);
  const fech180 = ops.filter(o => o.fechado_em && o.fechado_em >= addDias(today(), -180)), ganhas = fech180.filter(o => o.etapa === 'ganha').length;
  const conv = fech180.length ? ganhas / fech180.length : null;

  // nota comercial
  const v12 = I.reduce((t, c) => t + c.v12, 0), v12a = I.reduce((t, c) => t + c.v12a, 0), cresc = v12a ? v12 / v12a - 1 : null;
  const top = [...I].sort((a, b) => b.v12 - a.v12), conc = v12 ? (top[0]?.v12 || 0) / v12 : null;
  const comp12a = I.filter(c => c.v12a > 0), ret = comp12a.length ? comp12a.filter(c => c.v12 > 0).length / comp12a.length : null;
  const ating = metaAno ? fatAno / metaAno : null;
  const fatores = [
    { nome: 'Meta do ano', peso: .3, nota: faixa(ating, .7, 1), valorTxt: ating == null ? 'sem meta' : pct(ating), regra: 'Faturado no ano até o mês ÷ meta acumulada até o mês. 70% ou menos = 0; 100% ou mais = 100.' },
    { nome: 'Crescimento 12 meses', peso: .25, nota: faixa(cresc, -.15, .1), valorTxt: cresc == null ? '–' : pct(cresc), regra: 'Últimos 12 meses ÷ 12 meses anteriores − 1. −15% ou pior = 0; +10% ou melhor = 100.' },
    { nome: 'Retenção de clientes', peso: .2, nota: faixa(ret, .6, .9), valorTxt: ret == null ? '–' : pct(ret), regra: 'Clientes que compraram nos 12 meses anteriores e voltaram a comprar nos últimos 12. 60% ou menos = 0; 90% ou mais = 100.' },
    { nome: 'Concentração', peso: .15, nota: faixa(conc, .4, .1), valorTxt: conc == null ? '–' : pct(conc), regra: 'Peso do maior cliente nos últimos 12 meses. 40% ou mais = 0; 10% ou menos = 100.' },
    { nome: 'Conversão do funil', peso: .1, nota: faixa(conv, .1, .5), valorTxt: conv == null ? 'sem dados' : pct(conv), regra: 'Oportunidades ganhas ÷ fechadas (ganhas + perdidas) nos últimos 180 dias. 10% ou menos = 0; 50% ou mais = 100.' },
  ];

  const listaCli = (arr) => tabela([{ titulo: 'Cliente' }, { titulo: 'UF' }, { titulo: 'Última compra' }, { titulo: 'Dias' }, { titulo: '12 meses', num: true }],
    arr.sort((a, b) => b.v12 - a.v12).map(c => ({ celulas: [c.nome, c.uf || '', dateBR(c.ultima), c.desde, money0(c.v12)], onClick: c.chave.startsWith('doc:') ? null : () => abrirCliente(c.chave) })));
  const KP = {
    mes: { label: `Faturado em ${MESES_CURTO[mes - 1]}/${ano}`, valor: money0(fatMes), trendHtml: fatMesAA ? trend(variacao(fatMes, fatMesAA), { sufixo: 'vs ano anterior' }) : '', sub: metaMes ? `meta ${money0(metaMes)} (${pct(fatMes / metaMes, 0)})` : `${noMes.length} nota(s)`,
      abrir: () => drawer({ titulo: `Notas de ${MESES_CURTO[mes - 1]}/${ano}`, subtitulo: money0(fatMes), corpo: tabela([{ titulo: 'Emissão' }, { titulo: 'NF' }, { titulo: 'Cliente' }, { titulo: 'Valor', num: true }],
        noMes.sort((a, b) => b.emissao.localeCompare(a.emissao)).map(n => ({ celulas: [dateBR(n.emissao), n.numero, n.dest_nome, money(n.valor)] }))) }) },
    ano: { label: `Faturado em ${ano}`, valor: money0(fatAno), tom: ating != null && ating < .9 ? 'warn' : '', sub: metaAno ? `meta até ${MESES_CURTO[mes - 1]} ${money0(metaAno)} (${pct(ating, 0)})` : 'sem meta cadastrada',
      abrir: () => drawer({ titulo: `Faturado × meta — ${ano}`, corpo: tabela([{ titulo: 'Mês' }, { titulo: 'Faturado', num: true }, { titulo: 'Meta', num: true }, { titulo: '%', num: true }],
        Array.from({ length: mes }, (_, i) => { const f = soma(N.filter(n => n.emissao.slice(0, 7) === `${ano}-${String(i + 1).padStart(2, '0')}`)), m = metaEmp(i + 1); return { celulas: [MESES[i], money0(f), m ? money0(m) : '–', m ? pct(f / m, 0) : ''] }; })) }) },
    tk: { label: 'Ticket médio por nota', valor: money0(noMes.length ? fatMes / noMes.length : 0), sub: `${noMes.length} nota(s) no mês`, abrir: () => drawer({ titulo: 'Ticket médio', corpo: '<p class="small">Valor faturado no mês ÷ número de notas de venda.</p>' }) },
    at: { label: 'Clientes ativos (90 dias)', valor: String(ativos.length), sub: `${novos.length} novo(s)`, abrir: () => drawer({ titulo: 'Clientes que compraram nos últimos 90 dias', corpo: listaCli(ativos) }) },
    es: { label: 'Clientes esfriando', valor: String(esfr.length), tom: esfr.length ? 'warn' : '', sub: money0(esfr.reduce((t, c) => t + c.v12, 0)) + ' em 12 meses',
      abrir: () => drawer({ titulo: 'Clientes esfriando', subtitulo: 'sem comprar há mais de 1,5× o intervalo normal deles', corpo: listaCli(esfr) }) },
    in: { label: 'Inativos (180+ dias)', valor: String(inat.length), tom: inat.length ? 'neg' : '', sub: 'compraram nos últimos 2 anos', abrir: () => drawer({ titulo: 'Clientes inativos', corpo: listaCli(inat) }) },
    fu: { label: 'Funil ponderado', valor: money0(pipe), sub: `${opAb.length} oportunidade(s) abertas`, abrir: () => { location.hash = '#/comercial/funil'; } },
  };
  const corpo = $('#cm-corpo', root);
  corpo.innerHTML = `<div id="cm-kpis"></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2 style="margin:0">Nota comercial</h2><span class="muted small">por regra</span></div><div id="cm-score"></div></div>
      <div class="card"><h2>Faturado × meta — 12 meses</h2><div class="chart-box"><canvas id="cm-c1"></canvas></div></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2 style="margin:0">Maiores clientes — 12 meses</h2></div><div id="cm-cli"></div></div>
      <div class="card"><div class="card-head"><h2 style="margin:0">Por representante — ${MESES_CURTO[mes - 1]}/${ano}</h2></div><div id="cm-rep"></div></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2 style="margin:0">Produtos — 12 meses até ${MESES_CURTO[mes - 1]}</h2><span class="muted small">preço médio${interno() ? ' e margem estimada' : ''}</span></div><div id="cm-prod"></div></div>
      <div class="card"><div class="card-head"><h2 style="margin:0">Por estado — 12 meses</h2></div><div id="cm-uf"></div></div>
    </div>`;
  kpiGrid($('#cm-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k, clicavel: true })), (id) => KP[id].abrir());
  score($('#cm-score', corpo), { nome: 'Saúde comercial', fatores });

  // gráfico 12 meses
  const meses = Array.from({ length: 12 }, (_, i) => { const d = new Date(ano, mes - 12 + i, 15); return d.toISOString().slice(0, 7); });
  chart($('#cm-c1', corpo), { type: 'bar', data: { labels: meses.map(m => `${MESES_CURTO[+m.slice(5) - 1]}/${m.slice(2, 4)}`), datasets: [
    { label: 'Faturado', data: meses.map(m => soma(N.filter(n => n.emissao.slice(0, 7) === m))), backgroundColor: COR.entrada, order: 2 },
    { type: 'line', label: 'Meta', data: meses.map(m => { const a = +m.slice(0, 4), mm = +m.slice(5); const v = metas.filter(x => x.ano === a && x.mes === mm && !x.vendedor_id).reduce((t, x) => t + +x.valor, 0) || metas.filter(x => x.ano === a && x.mes === mm).reduce((t, x) => t + +x.valor, 0); return v || null; }),
      borderColor: COR.saldo, backgroundColor: COR.saldo, spanGaps: true, order: 1 }] },
    options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: moneyTick } } }, plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money0(x.raw)}` } } } } });

  barList($('#cm-cli', corpo), top.slice(0, 10).filter(c => c.v12 > 0).map(c => ({ nome: c.nome, valor: c.v12, txt: `${money0(c.v12)} · ${pct(c.v12 / v12)}`, sub: `${ST_CLI[c.st][0]} · última ${dateBR(c.ultima)}`, cor: 0,
    onClick: c.chave.startsWith('doc:') ? null : () => abrirCliente(c.chave) })));
  // representantes
  const repNome = Object.fromEntries(B.clientes.filter(c => c.representante_id).map(c => [c.representante_id, c.representante]));
  const porRep = {}; for (const n of noMes) { const k = n.representante_id || ''; porRep[k] = (porRep[k] || 0) + +n.valor; }
  const vend = Object.fromEntries(B.vendedores.map(v => [v.representante_id, v]));
  barList($('#cm-rep', corpo), Object.entries(porRep).sort((a, b) => b[1] - a[1]).map(([k, v]) => { const vd = vend[k], m = vd ? metas.filter(x => x.vendedor_id === vd.id && x.ano === ano && x.mes === mes).reduce((t, x) => t + +x.valor, 0) : 0;
    return { nome: k ? (repNome[k] || vd?.nome || 'representante') : 'Sem representante no cadastro', valor: v, txt: money0(v), sub: m ? `meta ${money0(m)} · ${pct(v / m, 0)}` : '', cor: 2 }; }), { vazio: 'Sem faturamento no mês.' });
  // estados
  const porUf = {}; for (const n of N.filter(n => n.emissao > addDias(fim, -365) && n.emissao <= fim)) porUf[n.dest_uf || '?'] = (porUf[n.dest_uf || '?'] || 0) + +n.valor;
  const totUf = Object.values(porUf).reduce((t, v) => t + v, 0);
  barList($('#cm-uf', corpo), Object.entries(porUf).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ nome: k, valor: v, txt: `${money0(v)} · ${pct(v / totUf)}`, cor: 3 })));
  // produtos: preço médio e (interno) margem estimada pela estrutura
  const pp = {}; for (const i of itens) { const x = (pp[i.codigo] ||= { codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, qtd: 0, valor: 0 }); x.qtd += +i.quantidade; x.valor += +i.valor; }
  const topP = Object.values(pp).sort((a, b) => b.valor - a.valor).slice(0, 10);
  let custos = {};
  if (interno() && topP.length) custos = await custoTeorico(topP.map(p => p.codigo)).catch(() => ({}));
  barList($('#cm-prod', corpo), topP.map(p => { const pm = p.qtd ? p.valor / p.qtd : 0, c = custos[p.codigo];
    return { nome: `${p.codigo} — ${p.descricao}`, valor: p.valor, txt: money0(p.valor), cor: 1,
      sub: `${qtd(Math.round(p.qtd))} ${p.unidade || ''} · preço médio ${unit(pm)}/${p.unidade || 'un'}${c != null && pm ? ` · custo teórico ${unit(c)} · margem ${pct(1 - c / pm)}` : ''}` }; }), { vazio: 'Sem itens vendidos no período.' });
}

// custo teórico pela estrutura (último custo de compra de cada componente), por código de produto
async function custoTeorico(codigos) {
  const e = state.empresa.id;
  const prods = await q(sb.from('produtos').select('id,codigo').eq('empresa_id', e).in('codigo', codigos));
  if (!prods.length) return {};
  const estr = await q(sb.from('produto_estrutura').select('*').in('produto_id', prods.map(p => p.id)));
  if (!estr.length) return {};
  const pf = await q(sb.from('produto_fornecedores').select('produto_id,ultimo_preco,ultima_compra').in('produto_id', [...new Set(estr.map(x => x.componente_id))]));
  const preco = (id) => pf.filter(f => f.produto_id === id && f.ultimo_preco != null).sort((a, b) => String(b.ultima_compra).localeCompare(String(a.ultima_compra)))[0]?.ultimo_preco;
  const out = {};
  for (const p of prods) { const ls = estr.filter(x => x.produto_id === p.id); if (!ls.length) continue;
    let t = 0, ok = true; for (const l of ls) { const pr = preco(l.componente_id); if (pr == null) { ok = false; break; } t += l.quantidade / l.base / (1 - l.perda_pct / 100) * pr; }
    if (ok) out[p.codigo] = t; }
  return out;
}

function abrirCliente(id) { document.querySelector('.cp-drawer-back')?.remove(); state.abrir = { tipo: 'cliente', id }; location.hash = '#/comercial/carteira'; }

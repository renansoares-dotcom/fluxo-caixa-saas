// Logística › Indicadores (SQL 071): nível de serviço, eficiência das cargas, custo logístico e frota, com metas e tendência de 6 meses.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, today, money, erroTela, chart } from '../lib/ui.js';
import { podeLogistica } from '../lib/logistica.js';
import { indicadores, frenteMeta, mesesAte, METAS_PADRAO } from '../lib/logistica-indicadores.js';
import { valorMensal } from '../lib/contratos.js';
import { SUGESTOES, resumo as resumoRotas, textoSugestao } from '../lib/frete-rota.js';

export const title = 'Indicadores';
const ui = { mes: today().slice(0, 7) };
let B = null;
const nf = (v, c = 1) => v == null ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const MES = (m) => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m.slice(5) - 1] + '/' + m.slice(2, 4);

async function carregar() {
  const e = state.empresa.id, meses = mesesAte(ui.mes, 6), ini = meses[0] + '-01', fim = ui.mes + '-31';
  const seg = (p) => p.catch(() => []);
  const [cargas, veiculos, par, fretes, abast, manut, multas, contratos] = await Promise.all([
    fetchAll(() => sb.from('log_cargas').select('id,data,veiculo_id,status,peso_kg,volume_m3,km_previsto,km_real').eq('empresa_id', e).gte('data', ini).lte('data', fim).order('id')),
    q(sb.from('log_veiculos').select('*').eq('empresa_id', e)),
    q(sb.from('log_parametros').select('*').eq('empresa_id', e)),
    seg(fetchAll(() => sb.from('log_fretes').select('id,data,valor,status,carga_id').eq('empresa_id', e).gte('data', ini).lte('data', fim).order('id'))),
    seg(fetchAll(() => sb.from('frota_abastecimentos').select('*').eq('empresa_id', e).gte('data', ini.slice(0, 8) + '01').lte('data', fim).order('id'))),
    seg(fetchAll(() => sb.from('frota_manutencoes').select('veiculo_id,data,valor').eq('empresa_id', e).gte('data', ini).lte('data', fim).order('id'))),
    seg(fetchAll(() => sb.from('frota_multas').select('veiculo_id,data_infracao,valor,situacao').eq('empresa_id', e).gte('data_infracao', ini).lte('data_infracao', fim).order('id'))),
    seg(q(sb.from('contratos').select('id,valor,periodicidade,natureza,status').eq('empresa_id', e))),
  ]);
  const ids = cargas.map(c => c.id), cnotas = [];
  for (let i = 0; i < ids.length; i += 200) cnotas.push(...await q(sb.from('log_carga_notas').select('carga_id,nota_id,situacao,entregue_em').in('carga_id', ids.slice(i, i + 200))));
  const nIds = [...new Set(cnotas.map(n => n.nota_id))], notas = {};
  for (let i = 0; i < nIds.length; i += 200) for (const n of await q(sb.from('nfe_notas').select('id,emissao,v_nf,dest_nome').in('id', nIds.slice(i, i + 200)))) notas[n.id] = n;
  cnotas.forEach(n => { n.nota = notas[n.nota_id] || null; });
  const locacao = {}; for (const v of veiculos) { const c = v.contrato_id && contratos.find(x => x.id === v.contrato_id); if (c && c.status === 'vigente') locacao[v.id] = valorMensal(c); }
  const P = par[0] || {};
  const fim2 = new Date(Date.UTC(+ui.mes.slice(0, 4), +ui.mes.slice(5), 0)).toISOString().slice(0, 10);   // último dia do mês
  const comp = await q(sb.rpc('log_frete_comparativo', { p_empresa: e, p_ate: fim2 })).catch(() => null);
  B = { comp, par: P, cargas, cnotas, veiculos, fretes, abast, manut, multas, locacao, diasAtraso: P.dias_atraso ?? 3, metas: { ...METAS_PADRAO, ...(P.metas || {}) }, temParam: !!par[0], meses };
  return B;
}

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Indicadores de logística</h2><div class="muted small">Nível de serviço, eficiência das cargas, custo logístico e frota. Cores conforme as metas.</div></div>
      <div style="display:flex;gap:8px;align-items:center"><input type="month" id="li-mes" value="${ui.mes}">${podeLogistica() ? '<button class="btn" id="li-metas">Metas</button>' : ''}</div></div>
    <div id="li-corpo"><div class="loading">Carregando…</div></div>`;
  $('#li-mes', root).onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; render(root); } };
  try { await carregar(); } catch (err) { console.error(err); $('#li-corpo', root).innerHTML = erroTela('os indicadores'); return; }
  $('#li-metas', root)?.addEventListener('click', () => metas(root));
  const serie = B.meses.map(m => indicadores(m, B)), k = serie[serie.length - 1], M = B.metas;
  const card = (rot, v, unid, meta, sentido, sub = '') => {
    const s = meta != null ? frenteMeta(v, meta, sentido) : null;
    return `<div class="kpi"><div class="k-label">${rot}</div><div class="k-value ${s === 'neg' ? 'neg' : s === 'warn' ? 'warn' : s === 'ok' ? 'pos' : ''}">${v == null ? '–' : unid === 'R$' ? money(v) : nf(v, ['%', ' dias'].includes(unid) ? 1 : Number.isInteger(+v) ? 0 : 2) + (unid || '')}</div>
      <div class="k-sub">${meta != null ? `meta ${sentido === 'maior' ? '≥' : '≤'} ${nf(meta, meta % 1 ? 1 : 0)}${unid}` : ''}${sub ? (meta != null ? ' · ' : '') + sub : ''}</div></div>`;
  };
  const sec = (t, html) => `<h3 style="margin:18px 0 8px">${t}</h3><div class="kpis">${html}</div>`;
  $('#li-corpo', root).innerHTML = `
    ${!B.cargas.length ? '<div class="card"><div class="empty">Sem cargas nos últimos 6 meses. Os indicadores aparecem conforme as cargas são montadas e as entregas baixadas em Cargas e entregas.</div></div>' : ''}
    ${sec('Nível de serviço', card('Entregas no prazo', k.prazo_pct, '%', M.prazo_pct, 'maior', `até ${B.diasAtraso} dia(s) da emissão`) + card('Tempo médio de entrega', k.lead_dias, ' dias', null, null, 'emissão → entrega')
      + card('Não entregues e devoluções', k.devol_pct, '%', M.devol_pct, 'menor', `${k.notas} nota(s) no mês`) + card('Entregas no mês', k.entregues, '', null, null, `${k.cargas} carga(s)`))}
    ${sec('Eficiência das cargas', card('Ocupação por peso', k.ocupacao_pct, '%', M.ocupacao_pct, 'maior') + card('Ocupação por volume', k.ocupacao_vol_pct, '%', null, null, 'baú cadastrado')
      + card('Entregas por carga', k.entregas_carga, '', null, null) + card('Km por carga', k.km_carga, ' km', null, null, k.desvio_km_pct != null ? `real ${k.desvio_km_pct >= 0 ? '+' : ''}${nf(k.desvio_km_pct)}% sobre o previsto` : ''))}
    ${sec('Custo logístico', card('Custo sobre as notas entregues', k.custo_pct, '%', M.custo_pct, 'menor', money(k.custo_total)) + card('Custo por kg', k.custo_kg, 'R$', null, null, `próprio ${k.custo_kg_proprio != null ? money(k.custo_kg_proprio) : '–'} · terceiros ${k.custo_kg_terceiros != null ? money(k.custo_kg_terceiros) : '–'}`)
      + card('Custo por entrega', k.custo_entrega, 'R$', null, null) + card('Frota × terceiros', k.custo_frota, 'R$', null, null, `terceiros ${money(k.custo_terceiros)}`))}
    ${sec('Frota', card('Veículos disponíveis', k.veiculos_disp, '', null, null, `de ${k.veiculos_total}`) + card('Km por litro', k.kml, '', null, null, `${nf(k.km_frota, 0)} km no mês`)
      + card('Multas a cada 10 mil km', k.multas_10mil_km, '', null, null) + card('Manutenção por km', k.manut_km, 'R$', null, null))}
    <div class="grid2" style="margin-top:18px;gap:12px">
      <div class="card"><h3 style="margin:0 0 8px">Tendência — 6 meses</h3><div style="height:240px"><canvas id="li-c1"></canvas></div></div>
      <div class="card"><h3 style="margin:0 0 8px">Custo logístico — 6 meses</h3><div style="height:240px"><canvas id="li-c2"></canvas></div></div></div>
    <div class="grid2" style="margin-top:12px;gap:12px">
      <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Mês</th><th class="num">No prazo</th><th class="num">Ocupação</th><th class="num">Custo/notas</th><th class="num">Custo/kg</th><th class="num">Devoluções</th></tr></thead><tbody>
        ${serie.slice().reverse().map(s => `<tr><td>${MES(s.mes)}</td>${[[s.prazo_pct, '%', M.prazo_pct, 'maior'], [s.ocupacao_pct, '%', M.ocupacao_pct, 'maior'], [s.custo_pct, '%', M.custo_pct, 'menor'], [s.custo_kg, 'R$'], [s.devol_pct, '%', M.devol_pct, 'menor']]
          .map(([v, u, m, sd]) => { const st = m != null ? frenteMeta(v, m, sd) : null; return `<td class="num ${st === 'neg' ? 'neg' : st === 'warn' ? 'warn' : ''}">${v == null ? '–' : u === 'R$' ? money(v) : nf(v) + u}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h3 style="margin:0 0 8px">Clientes com mais atraso no mês</h3>
        ${k.atrasos.map(a => `<div class="small" style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(a.nome)}</span><span>${a.qtd} entrega(s) · média ${nf(a.media)} dias</span></div>`).join('') || '<div class="muted small">Nenhuma entrega fora do prazo no mês.</div>'}</div></div>
    <div id="li-rotas"></div>
    <p class="small muted">Prazo: dias entre a emissão da nota e a baixa da entrega (limite em Frota e Parâmetros). Ocupação: peso e volume da carga sobre a capacidade do veículo, nas cargas que saíram. Custo: frota (combustível, manutenção, multas e locação) mais fretes de terceiros, sobre o valor das notas entregues.</p>`;
  rotas($('#li-rotas', root), root);
  const rot = B.meses.map(MES);
  chart($('#li-c1', root), { type: 'line', data: { labels: rot, datasets: [{ label: 'No prazo (%)', data: serie.map(s => s.prazo_pct), tension: .3 }, { label: 'Ocupação (%)', data: serie.map(s => s.ocupacao_pct), tension: .3 }] },
    options: { maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } } } });
  chart($('#li-c2', root), { type: 'bar', data: { labels: rot, datasets: [{ label: 'Frota', data: serie.map(s => s.custo_frota), stack: 'c' }, { label: 'Terceiros', data: serie.map(s => s.custo_terceiros), stack: 'c' }] },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } } });
}

// melhoria 7.2: frete próprio × terceirizado por rota
function rotas(el, root) {
  const C = B.comp;
  if (!C) { el.innerHTML = ''; return; }
  const R = C.rotas || [], S = resumoRotas(R), t = (kg) => kg ? nf(kg / 1000, 1) + ' t' : '–';
  const lado = (x) => x && (x.viagens || x.custo) ? `${money(x.custo)}<div class="small muted">${x.viagens} viagem(ns) · ${t(x.peso_kg)}${x.rs_t != null ? ` · <b>${money(x.rs_t)}/t</b>` : ''}</div>` : '<span class="muted">–</span>';
  el.innerHTML = `<div class="card flush" style="margin-top:18px"><div class="card-head" style="padding:14px 16px 0"><div><h3 style="margin:0">Frete próprio × terceirizado por rota</h3>
      <div class="small muted">${C.de.split('-').reverse().join('/')} a ${C.ate.split('-').reverse().join('/')} · rota por ${C.rota_por === 'uf' ? 'UF' : 'município'} de destino · troca sugerida a partir de ${nf(C.dif_pct, 0)}% de diferença no R$/t, com ${nf(C.min_t, 1)} t ou mais de cada lado</div></div>
      ${podeLogistica() ? '<button class="btn small" id="li-rpar">Parâmetros da comparação</button>' : ''}</div>
    <div class="kpis" style="padding:12px 16px 0">
      <div class="kpi"><div class="k-label">Frota própria</div><div class="k-value">${S.rs_t_proprio != null ? money(S.rs_t_proprio) + '/t' : '–'}</div><div class="k-sub">${money(S.custo_proprio)} no período</div></div>
      <div class="kpi"><div class="k-label">Terceiros</div><div class="k-value">${S.rs_t_terceiro != null ? money(S.rs_t_terceiro) + '/t' : '–'}</div><div class="k-sub">${money(S.custo_terceiro)} no período</div></div>
      <div class="kpi"><div class="k-label">Rotas comparáveis</div><div class="k-value">${S.comparaveis}</div><div class="k-sub">${S.terceirizar} para terceirizar · ${S.frota} para a frota</div></div>
      <div class="kpi"><div class="k-label">Economia estimada</div><div class="k-value ${S.economia ? 'pos' : ''}">${money(S.economia)}</div><div class="k-sub">no período, seguindo as sugestões</div></div></div>
    <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Rota (destino)</th><th class="num">Frota própria</th><th class="num">Terceiros</th><th>Sugestão</th><th class="num">Economia</th></tr></thead><tbody>
    ${R.map(r => { const [rotulo, cls] = SUGESTOES[r.sugestao] || SUGESTOES.sem_base;
      return `<tr><td>${esc(r.rota)}</td><td class="num">${lado(r.proprio)}</td><td class="num">${lado(r.terceiro)}</td>
        <td><span class="${cls}">${rotulo}</span>${r.dif_pct != null ? ` <span class="small muted">(terceiro ${r.dif_pct > 0 ? '+' : ''}${nf(r.dif_pct)}% sobre o próprio)</span>` : ''}<div class="small muted">${esc(textoSugestao(r))}</div></td><td class="num">${r.economia ? money(r.economia) : '<span class="muted">–</span>'}</td></tr>`; }).join('')
    || '<tr><td colspan="5" class="empty">Sem cargas da frota nem fretes de terceiros no período.</td></tr>'}</tbody></table></div>
    <p class="small muted" style="padding:0 16px 12px">Frota própria: cargas que saíram, km real (ou previsto) × custo por km do veículo (ou consumo × diesel), rateado entre as notas pelo peso. Terceiros: fichas de Fretes e CIOT (valor + pedágio), rateadas pelas notas da carga ou pelos números de nota da ficha; sem nota, a rota é o destino escrito na ficha e não há peso. A economia move o peso da opção mais cara para a mais barata, no R$/t do período.</p></div>`;
  $('#li-rpar', el)?.addEventListener('click', () => parRotas(root));
}

function parRotas(root) {
  const P = B.par || {};
  const md = modal({ title: 'Parâmetros da comparação de fretes', body: `<div class="grid2">
      <label>Agrupar a rota por<select id="rp-por"><option value="municipio" ${P.comp_rota_por !== 'uf' ? 'selected' : ''}>Município de destino</option><option value="uf" ${P.comp_rota_por === 'uf' ? 'selected' : ''}>UF de destino</option></select></label>
      <label>Período (meses até o mês escolhido)<input type="number" min="1" max="24" id="rp-m" value="${P.comp_meses ?? 6}"></label>
      <label>Sugerir troca a partir de (% de diferença no R$/t)<input type="number" step="0.1" min="0" max="100" id="rp-d" value="${P.comp_dif_pct ?? 10}"></label>
      <label>Peso mínimo de cada lado para comparar (t)<input type="number" step="0.1" min="0" id="rp-t" value="${P.comp_min_t ?? 1}"></label></div>
    <p class="small muted">O custo por km de cada veículo fica em Frota e Parâmetros (ou use o custo do mês na Gestão da Frota).</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rp-ok">Salvar</button>' });
  $('#rp-ok', md.el).onclick = async () => {
    const nv = { comp_rota_por: $('#rp-por', md.el).value, comp_meses: Math.min(24, Math.max(1, +$('#rp-m', md.el).value || 6)), comp_dif_pct: Math.min(100, Math.max(0, +$('#rp-d', md.el).value || 0)), comp_min_t: Math.max(0, +$('#rp-t', md.el).value || 0) };
    try {
      if (B.temParam) await q(sb.from('log_parametros').update(nv).eq('empresa_id', state.empresa.id));
      else await q(sb.from('log_parametros').insert({ empresa_id: state.empresa.id, ...nv }));
      toast('Parâmetros salvos'); md.close(); render(root);
    } catch (err) { fail(err); }
  };
}

function metas(root) {
  const M = B.metas;
  const md = modal({ title: 'Metas dos indicadores', body: `<div class="grid2">
      <label>Entregas no prazo (mínimo, %)<input type="number" step="0.1" id="mt-p" value="${M.prazo_pct}"></label>
      <label>Ocupação por peso (mínimo, %)<input type="number" step="0.1" id="mt-o" value="${M.ocupacao_pct}"></label>
      <label>Custo sobre as notas entregues (máximo, %)<input type="number" step="0.1" id="mt-c" value="${M.custo_pct}"></label>
      <label>Não entregues e devoluções (máximo, %)<input type="number" step="0.1" id="mt-d" value="${M.devol_pct}"></label></div>
    <p class="small muted">Verde: dentro da meta. Amarelo: até 10% fora. Vermelho: mais que isso.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mt-ok">Salvar</button>' });
  $('#mt-ok', md.el).onclick = async () => {
    const nv = { prazo_pct: +$('#mt-p', md.el).value, ocupacao_pct: +$('#mt-o', md.el).value, custo_pct: +$('#mt-c', md.el).value, devol_pct: +$('#mt-d', md.el).value };
    try {
      if (B.temParam) await q(sb.from('log_parametros').update({ metas: nv }).eq('empresa_id', state.empresa.id));
      else await q(sb.from('log_parametros').insert({ empresa_id: state.empresa.id, metas: nv }));
      toast('Metas salvas'); md.close(); render(root);
    } catch (err) { fail(err); }
  };
}

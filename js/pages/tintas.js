// Casa de Tintas › Painel (PRD016): ordens na bancada, kg preparados, custo por kg, aprovação na primeira medição,
// precisão da pesagem, sobras com validade e consumo por cor.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, esc, fail, money, dateBR } from '../lib/ui.js';
import { kpiGrid, barList } from '../lib/componentes.js';
import * as T from '../lib/tintas.js';
import { carregarTintas, fichaOrdem, novaOrdem, corTxt, versaoTxt, opTxt, selo, clsOrdem, amostra, CSS, podeTintas, nf } from '../lib/tintas-ui.js';

export const title = 'Painel da Casa de Tintas';
const ui = { dias: 30 };
const pctTxt = (v) => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1).replace('.', ',') + '%';

async function extras(D, de) {
  const ids = D.O.map(o => o.id);
  if (!ids.length) return { Pe: [], Me: [] };
  const fat = (t) => fetchAll(() => sb.from(t).select('*').eq('empresa_id', state.empresa.id).gte('criado_em', de));
  const [Pe, Me] = await Promise.all([fat('tin_pesagens').catch(() => []), fat('tin_medicoes').catch(() => [])]);
  return { Pe, Me };
}

/** alertas para o Decision Center (regra 20) */
export async function alertasDecisao() {
  try { const D = await carregarTintas({ meses: 2 }); if (!D.Re.length) return []; return T.alertas({ ordens: D.O, sobras: D.sobras, versoes: D.Ve }); } catch { return []; }
}

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Painel da Casa de Tintas</h2><div class="muted small">Receitas aprovadas, pesagem conferida, cor medida e cada quilo de tinta com lote, custo e destino.</div></div>
      <div class="tn-acoes"><label>Período<select id="tp-d">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias']].map(([d, t]) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${podeTintas() ? '<button class="btn primary" id="tp-nova">Nova ordem</button>' : ''}</div></div>
    <div id="tp-corpo"><div class="loading">Carregando…</div></div>`;
  $('#tp-d', root).onchange = (e) => { ui.dias = +e.target.value; render(root); };
  let D, X;
  const de = new Date(Date.now() - ui.dias * 86400000).toISOString(), ate = new Date().toISOString();
  try { D = await carregarTintas(); X = await extras(D, de); } catch (err) { fail(err); $('#tp-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 088 (casa de tintas) já foi executado.</div></div>'; return; }
  const re = () => render(root);
  $('#tp-nova', root) && ($('#tp-nova', root).onclick = () => novaOrdem(D, { onSalvo: (o) => fichaOrdem(D, o, { onMudou: re }) }));
  const corpo = $('#tp-corpo', root);
  if (D.semConfig || !D.Re.length) {
    corpo.innerHTML = `<div class="card"><div class="empty" style="padding:24px"><b>A casa de tintas ainda não está configurada.</b><br>Em Casa de Tintas › Cores e Receitas, clique em <b>Configurar a casa de tintas</b> (cria o local da tinta pronta e os sistemas) e cadastre as cores e as receitas.</div>
      <div style="text-align:center;padding-bottom:16px"><a class="btn primary" href="#/tintas/receitas">Abrir Cores e Receitas</a></div></div>`; return;
  }
  const ind = T.indicadores(D.O, X.Pe, X.Me, { de, ate }), alertas = T.alertas({ ordens: D.O, sobras: D.sobras, versoes: D.Ve });
  const sobraKg = D.sobras.reduce((s, x) => s + +x.quantidade, 0), sobraVal = D.sobras.reduce((s, x) => s + +x.valor, 0);
  const KP = {
    ab: { label: 'Na bancada', valor: String(ind.abertas), sub: `${D.O.filter(o => o.situacao === 'em_ajuste').length} em ajuste`, clicavel: true },
    kg: { label: 'Tinta preparada', valor: `${nf(ind.kg, 1)} kg`, sub: `${ind.ordens} ordem(ns) aprovada(s)` },
    ck: { label: 'Custo por kg', valor: ind.custoKg != null ? money(ind.custoKg) : '–', sub: `${money(ind.custo)} no período` },
    pr: { label: 'Aprovada na 1ª medição', valor: pctTxt(ind.primeira), sub: `${ind.comConcessao} com concessão · ${ind.ajustes} ajuste(s)`, tom: ind.primeira != null && ind.primeira < 0.8 ? 'warn' : 'pos' },
    ps: { label: 'Precisão da pesagem', valor: ind.desvioMedio != null ? `±${nf(ind.desvioMedio, 2)}%` : '–', sub: `${pctTxt(ind.foraTol)} das pesagens fora da tolerância`, tom: ind.foraTol > 0.1 ? 'warn' : '' },
    so: { label: 'Sobras na casa de tintas', valor: `${nf(sobraKg, 1)} kg`, sub: `${money(sobraVal)} · ${nf(ind.sobraKg, 1)} kg voltaram no período`, tom: alertas.some(a => a.k === 'vencidas') ? 'neg' : '' },
  };
  const bancada = D.O.filter(o => T.ABERTAS.includes(o.situacao) || o.situacao === 'aprovada').slice(0, 10);
  corpo.innerHTML = `${alertas.length ? `<div class="card" style="border-left:4px solid var(--warn);margin-bottom:12px">${alertas.map(a => `<div>${a.nivel === 'neg' ? '🔴' : '🟠'} ${esc(a.txt)}</div>`).join('')}</div>` : ''}
    <div id="tp-kpis"></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0;display:flex;justify-content:space-between"><h2>Na bancada</h2><a class="small" href="#/tintas/ordens">ver todas</a></div><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Cor</th><th>OP</th><th class="num">kg</th><th>Situação</th></tr></thead><tbody id="tp-b">
      ${bancada.map(o => `<tr class="clickable" data-o="${o.id}"><td><b>${o.numero}</b></td><td>${amostra(D.coById[o.cor_id]?.hex)}${esc(corTxt(D, o.cor_id))}<div class="small muted">${esc(versaoTxt(D, o.versao_id))}</div></td>
        <td class="small">${esc(opTxt(D, o.ordem_id)) || '—'}</td><td class="num">${nf(o.quantidade_real ?? o.quantidade)}</td><td>${selo(T.SIT_ORDEM[o.situacao], clsOrdem(o.situacao))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nada na bancada.</td></tr>'}</tbody></table></div></div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><h2>Consumo por cor (kg)</h2><div id="tp-cor"></div></div>
      <div class="card flush"><div style="padding:14px 16px 0"><h2>Sobras de tinta pronta</h2></div><div class="table-wrap"><table><thead><tr><th>Cor / lote</th><th class="num">kg</th><th>Validade</th></tr></thead><tbody>
        ${D.sobras.sort((a, b) => String(a.validade || '9').localeCompare(String(b.validade || '9'))).map(s => { const venc = s.validade && s.validade < new Date().toISOString().slice(0, 10);
          return `<tr><td>${amostra(s.cor?.hex)}${esc(s.cor ? s.cor.codigo + ' · ' + s.cor.nome : '')}<div class="small muted">lote ${esc(s.lote || '')}</div></td><td class="num">${nf(s.quantidade, 1)}</td>
            <td>${s.validade ? selo(dateBR(s.validade), venc ? 'neg' : 'muted') : '—'}</td></tr>`; }).join('') || '<tr><td colspan="3" class="empty">Sem sobras.</td></tr>'}</tbody></table></div>
        <p class="muted small" style="padding:0 16px 12px">Use a sobra mais antiga primeiro: na ficha da ordem, "Lançar ajuste" com a tinta pronta da cor. Tinta vencida sai pelo Kardex (perda).</p></div></div>`;
  $('#tp-kpis', corpo).classList.add('tn-kpis6');
  kpiGrid($('#tp-kpis', corpo), Object.entries(KP).map(([id, k]) => ({ id, ...k })), (id) => { if (id === 'ab') location.hash = '#/tintas/ordens'; });
  $('#tp-b', corpo).onclick = (e) => { const r = e.target.closest('[data-o]'); if (r) fichaOrdem(D, D.O.find(o => o.id === r.dataset.o), { onMudou: re }); };
  barList($('#tp-cor', corpo), ind.porCor.slice(0, 8).map(x => ({ nome: corTxt(D, x.cor_id), valor: x.kg, txt: `${nf(x.kg, 1)} kg`, sub: `${x.ordens} ordem(ns) · ${x.kg ? money(x.custo / x.kg) : '–'}/kg` })), { vazio: 'Nenhuma tinta aprovada no período.' });
}

// Contabilidade › Patrimônio › Ativo Imobilizado (SQL 084). Referência: ERP "Consultoria" (ativo-fixo.html), refeito com:
// painel com projeção e grau de depreciação, bens com ficha (dados, depreciação, histórico, anexos), compras a imobilizar
// (NF-e, lançamentos, máquinas e veículos), depreciação mensal com prévia, lançamento contábil e fechamento, inventário
// físico pela plaqueta (QR), créditos fiscais (CIAP e PIS/COFINS) e relatórios no padrão IPLAMM.
import { sb, state, q, fetchAll, loadCadastros, podeEditar, isAdmin } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, today, dateBR, money, money0, pct, options, erroTela, exportXLSX, chart, moneyTick, parseNum, debounce } from '../lib/ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { barList } from '../lib/componentes.js';
import * as I from '../lib/imobilizado.js';

export const title = 'Ativo Imobilizado';
const BUCKET = 'patrimonio';
const hojeMes = () => today().slice(0, 7);
const ui = { aba: 'painel', busca: '', classe: '', sit: 'ativos', cc: '', mes: I.somaMes(hojeMes(), -1), invAberto: null,
  candDe: `${today().slice(0, 4)}-01-01`, candAte: today(), credMes: I.somaMes(hojeMes(), -1), relData: today(), relDe: `${today().slice(0, 4)}-01`, relAte: I.somaMes(hojeMes(), -1) };
let D = null;
const nf = (v, c = 0) => v == null || v === '' ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const mesBR = (m) => m ? m.split('-').reverse().join('/') : '';
const ccNome = (id) => state.cad.ccById[id]?.nome || '';
const favNome = (id) => state.cad.favById[id]?.nome || '';

async function carregar() {
  const e = state.empresa.id; await loadCadastros();
  const seg = (p, v = []) => p.catch(() => v);
  const [P, K, B, Dp, C, Iv, Ct, M, V, Ax] = await Promise.all([
    q(sb.from('af_parametros').select('*').eq('empresa_id', e)),
    q(sb.from('af_classes').select('*').eq('empresa_id', e).order('codigo')),
    fetchAll(() => sb.from('af_bens').select('*').eq('empresa_id', e).order('numero')),
    fetchAll(() => sb.from('af_depreciacoes').select('bem_id,competencia,meses,valor,acumulada,valor_fiscal,centro_custo_id').eq('empresa_id', e).order('competencia').order('id')),
    q(sb.from('af_calculos').select('*').eq('empresa_id', e).order('competencia')),
    q(sb.from('af_inventarios').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
    fetchAll(() => sb.from('contab_contas').select('id,classificacao,descricao,tipo,natureza').eq('empresa_id', e).order('classificacao')),
    seg(q(sb.from('prod_maquinas').select('id,codigo,nome').eq('empresa_id', e).order('codigo'))),
    seg(q(sb.from('log_veiculos').select('id,codigo,placa,marca_modelo,propriedade').eq('empresa_id', e).order('codigo'))),
    seg(q(sb.from('af_anexos').select('bem_id').eq('empresa_id', e))),
  ]);
  const p = P[0] || { regra_inicio: 'mes_seguinte', gerar_contabil: true, prefixo: 'PAT', valor_minimo: 1200, pis_cofins_ate: '2026-12-31', ciap_fatores: {}, planos_imobilizado: [] };
  const kById = Object.fromEntries(K.map(k => [k.id, k])), bById = Object.fromEntries(B.map(b => [b.id, b])), ctById = Object.fromEntries(Ct.map(c => [c.id, c]));
  const ult = C.length ? I.mesDe(C[C.length - 1].competencia) : null;
  const pos = Object.fromEntries(B.map(b => [b.id, I.posicao(b, Dp)]));
  const nAnexos = {}; for (const a of Ax) nAnexos[a.bem_id] = (nAnexos[a.bem_id] || 0) + 1;
  D = { P: p, K, B, Dp, C, Iv, Ct, M, V, kById, bById, ctById, ult, pos, nAnexos, semParam: !P[0] };
  return D;
}
const nomeConta = (id) => { const c = D.ctById[id]; return c ? `${c.classificacao} ${c.descricao}` : ''; };
const classeTxt = (id) => { const k = D.kById[id]; return k ? `${k.codigo} · ${k.nome}` : '—'; };
const kpi = (r, v, s = '', c = '') => `<div class="kpi"><div class="k-label">${r}</div><div class="k-value ${c}">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
const barra = (p) => `<div class="af-barra" title="${pct(p, 0)} depreciado"><span style="width:${Math.min(100, Math.round(p * 100))}%"></span></div>`;

export async function render(root) {
  root.innerHTML = `<style>
    .af-barra{height:6px;border-radius:3px;background:var(--border);overflow:hidden;margin-top:4px;min-width:80px}.af-barra span{display:block;height:100%;background:var(--brand-blue)}
    .af-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--primary-soft)}
    .af-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.af-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}.af-sel.muted{color:var(--muted)}
    .af-alerta{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;background:var(--primary-soft);margin-bottom:8px}.af-alerta.warn{background:color-mix(in srgb,var(--warn) 12%,transparent)}
    .af-grid2{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:16px}@media(max-width:1000px){.af-grid2{grid-template-columns:1fr}}
    .af-meses{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:6px}.af-mes{border:1px solid var(--border);border-radius:8px;padding:6px;text-align:center;font-size:12px;cursor:pointer}
    .af-mes.fechado{background:color-mix(in srgb,var(--pos) 14%,transparent);border-color:var(--pos)}.af-mes.calculado{background:var(--primary-soft)}.af-mes.on{outline:2px solid var(--brand-blue)}
    .af-mes b{display:block;font-size:13px}@media(max-width:700px){.af-meses{grid-template-columns:repeat(4,1fr)}}
    .af-ficha-topo{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.af-plaq{font-family:ui-monospace,monospace;font-weight:700;font-size:15px}
  </style>
  <div class="mm-topo"><div><h2 style="margin:0">Ativo Imobilizado</h2><div class="muted small">Bens, depreciação mensal com lançamento contábil, inventário pela plaqueta e créditos de ICMS (CIAP) e PIS/COFINS.</div></div>
    <a class="btn ghost" href="#/contab/imobilizado-parametros">Parâmetros do imobilizado</a></div>
  <div class="card toolbar"><div class="chips" id="af-abas">${[['painel', 'Painel'], ['bens', 'Bens'], ['cand', 'A imobilizar'], ['dep', 'Depreciação'], ['inv', 'Inventário'], ['cred', 'Créditos fiscais'], ['rel', 'Relatórios']]
    .map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
  <div id="af-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#af-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  try { await carregar(); } catch (err) { console.error(err); $('#af-corpo', root).innerHTML = erroTela('o ativo imobilizado (rode o SQL 084 se ainda não rodou)'); return; }
  const c = $('#af-corpo', root);
  if (!D.K.length) { semClasses(c, root); return; }
  const ab = state.abrir?.tipo === 'bem' ? state.abrir : null;
  if (ab) { delete state.abrir; ui.aba = 'bens'; }
  const r = { painel, bens, cand: candidatos, dep: depreciacao, inv: inventario, cred: creditos, rel: relatorios }[ui.aba] || painel;
  try { await r(c, root); } catch (err) { fail(err); }
  if (ab && D.bById[ab.id]) ficha(D.bById[ab.id], root);
}
const refazer = async (root) => { await carregar(); render(root); };

function semClasses(c, root) {
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">Comece pelas classes de bens</h3>
    <p>As classes definem a taxa fiscal (Anexo III da IN RFB 1.700/2017), a vida útil contábil, as contas contábeis e os créditos de cada grupo de bens.
    A plataforma cria 11 classes de partida (terrenos, edificações, instalações, máquinas, empilhadeiras, caminhões, automóveis, informática, móveis, ferramentas e softwares). Depois é só ligar as contas da contabilidade.</p>
    ${podeEditar() ? '<button class="btn primary" id="af-padrao">Criar as classes de partida</button>' : '<div class="muted">Peça a um administrador ou ao financeiro para criar as classes.</div>'}</div>`;
  const b = $('#af-padrao', c); if (b) b.onclick = async () => {
    try { const n = await q(sb.rpc('af_classes_padrao', { p_empresa: state.empresa.id })); toast(`${n} classes criadas. Ligue as contas contábeis em Parâmetros.`); refazer(root); } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- Decision Center
export async function alertasDecisao() {
  try {
    await carregar();
    const cand = podeEditar() ? await q(sb.rpc('af_candidatos', { p_empresa: state.empresa.id, p_ini: `${today().slice(0, 4)}-01-01`, p_fim: today() })).catch(() => []) : [];
    return I.alertas({ bens: D.B, classes: D.K, calculos: D.C, candidatos: cand.length, inventarios: D.Iv, hoje: today() });
  } catch { return []; }
}

// ---------------------------------------------------------------- Painel
function painel(c, root) {
  const ativos = D.B.filter(b => b.situacao !== 'baixado');
  const tot = ativos.reduce((s, b) => { const p = D.pos[b.id]; s.custo += p.custo; s.acum += p.acum; return s; }, { custo: 0, acum: 0 });
  const ultCalc = D.C[D.C.length - 1];
  const totalDep = ativos.filter(b => D.kById[b.classe_id]?.deprecia && D.pos[b.id].vcl <= (+b.valor_residual || 0) + 0.005);
  const de = D.ult ? I.somaMes(D.ult, 1) : hojeMes();
  const proj = I.projecao(ativos, D.Dp, D.K, { de, meses: 24, regra: D.P.regra_inicio });
  const al = I.alertas({ bens: D.B, classes: D.K, calculos: D.C, candidatos: 0, inventarios: D.Iv, hoje: today() });
  const porClasse = D.K.map(k => { const bs = ativos.filter(b => b.classe_id === k.id); return { k, n: bs.length, custo: bs.reduce((s, b) => s + D.pos[b.id].custo, 0), vcl: bs.reduce((s, b) => s + D.pos[b.id].vcl, 0) }; }).filter(x => x.n);
  const porCC = {}; for (const b of ativos) { const k = b.centro_custo_id || ''; porCC[k] = (porCC[k] || 0) + D.pos[b.id].vcl; }
  c.innerHTML = `${D.semParam ? '<div class="af-alerta warn"><b>Parâmetros ainda não revisados.</b> Confira a regra de início da depreciação e as contas contábeis em Parâmetros do imobilizado.</div>' : ''}
    ${al.map(a => `<div class="af-alerta ${a.nivel === 'warn' ? 'warn' : ''}">${a.nivel === 'warn' ? '⚠️' : 'ℹ️'} <div>${esc(a.txt)}</div></div>`).join('')}
    <div class="kpis">${kpi('Custo dos bens em uso', money0(tot.custo), `${ativos.length} bens`)}${kpi('Depreciação acumulada', money0(tot.acum), pct(tot.custo ? tot.acum / tot.custo : 0, 0) + ' do custo')}
      ${kpi('Valor contábil líquido', money0(tot.custo - tot.acum), 'custo − depreciação')}${kpi('Depreciação do último mês', ultCalc ? money0(ultCalc.total) : '–', ultCalc ? `${mesBR(I.mesDe(ultCalc.competencia))} · ${ultCalc.situacao}` : 'nenhum mês calculado')}
      ${kpi('Totalmente depreciados em uso', nf(totalDep.length), totalDep.length ? 'rever a vida útil (CPC 27)' : 'nenhum', totalDep.length ? 'warn' : '')}</div>
    <div class="af-grid2" style="margin-top:16px">
      <div class="card"><h3 style="margin-top:0">Depreciação prevista — próximos 24 meses</h3><div class="muted small">Com os bens de hoje (sem compras novas), pela regra "${esc(I.REGRAS_INICIO[D.P.regra_inicio])}". Entra no forecast da DRE.</div>
        <div style="height:260px;margin-top:8px"><canvas id="af-proj"></canvas></div>
        <div class="muted small">Próximos 12 meses: <b>${money0(proj.slice(0, 12).reduce((s, x) => s + x.valor, 0))}</b> · 12 seguintes: <b>${money0(proj.slice(12).reduce((s, x) => s + x.valor, 0))}</b></div></div>
      <div class="card"><h3 style="margin-top:0">Valor líquido por classe</h3><div id="af-classes"></div>
        <h3>Valor líquido por centro de custo</h3><div id="af-ccs"></div></div>
    </div>
    <div class="card" style="margin-top:16px"><h3 style="margin-top:0">Grau de depreciação por classe</h3><div class="muted small">Quanto do custo já foi depreciado. Classe perto de 100% indica parque antigo e necessidade de reinvestimento.</div>
      <div class="table-wrap"><table><tr><th>Classe</th><th class="num">Bens</th><th class="num">Custo</th><th class="num">Valor líquido</th><th style="min-width:160px">Depreciado</th></tr>
      ${porClasse.map(x => `<tr><td>${esc(x.k.codigo)} · ${esc(x.k.nome)}</td><td class="num">${x.n}</td><td class="num">${money0(x.custo)}</td><td class="num">${money0(x.vcl)}</td>
        <td>${pct(x.custo ? 1 - x.vcl / x.custo : 0, 0)}${barra(x.custo ? 1 - x.vcl / x.custo : 0)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum bem cadastrado.</td></tr>'}</table></div></div>`;
  barList($('#af-classes', c), porClasse.sort((a, b) => b.vcl - a.vcl).map(x => ({ nome: `${x.k.codigo} ${x.k.nome}`, valor: x.vcl })), { vazio: 'Sem bens.' });
  barList($('#af-ccs', c), Object.entries(porCC).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ nome: ccNome(k) || 'Sem centro de custo', valor: v })), { vazio: 'Sem bens.' });
  chart($('#af-proj', c), { type: 'bar', data: { labels: proj.map(x => mesBR(x.mes).slice(0, 2) + '/' + x.mes.slice(2, 4)), datasets: [{ label: 'Depreciação', data: proj.map(x => x.valor), backgroundColor: '#2b5598' }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (t) => money(t.raw) } } }, scales: { y: { ticks: { callback: moneyTick } } } } });
}

// ---------------------------------------------------------------- Bens
function filtrar() {
  const t = ui.busca.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return D.B.filter(b => (ui.sit === 'todos' || (ui.sit === 'ativos' ? b.situacao !== 'baixado' : b.situacao === ui.sit))
    && (!ui.classe || b.classe_id === ui.classe) && (!ui.cc || (ui.cc === '-' ? !b.centro_custo_id : b.centro_custo_id === ui.cc))
    && (!t || `${b.plaqueta} ${b.numero} ${b.descricao} ${b.marca || ''} ${b.modelo || ''} ${b.serie || ''} ${b.local || ''} ${b.responsavel || ''} ${b.nf_numero || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(t)));
}
function bens(c, root) {
  c.innerHTML = `<div class="card toolbar" id="af-tb">
      <input id="af-busca" placeholder="Buscar plaqueta, descrição, série, local…" value="${esc(ui.busca)}" style="min-width:200px;flex:1">
      <select id="af-fcl"><option value="">Todas as classes</option>${D.K.map(k => `<option value="${k.id}" ${ui.classe === k.id ? 'selected' : ''}>${esc(k.codigo)} · ${esc(k.nome)}</option>`).join('')}</select>
      <select id="af-fcc"><option value="">Todos os centros</option><option value="-" ${ui.cc === '-' ? 'selected' : ''}>Sem centro de custo</option>${state.cad.cc.map(x => `<option value="${x.id}" ${ui.cc === x.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
      <select id="af-fsit">${[['ativos', 'Em uso, ociosos e em manutenção'], ['em_uso', 'Em uso'], ['ocioso', 'Ociosos'], ['em_manutencao', 'Em manutenção'], ['baixado', 'Baixados'], ['todos', 'Todos']].map(([k, t]) => `<option value="${k}" ${ui.sit === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <span class="spacer"></span><button class="btn small" id="af-xls">Excel</button><button class="btn small" id="af-etq">Etiquetas</button>
      ${podeEditar() ? '<button class="btn primary" id="af-novo">+ Novo bem</button>' : ''}</div>
    <div class="card" style="margin-top:12px"><div id="af-lista"></div></div>`;
  const lista = () => {
    const L = filtrar(), tot = L.reduce((s, b) => { const p = D.pos[b.id]; s.c += p.custo; s.a += p.acum; return s; }, { c: 0, a: 0 });
    $('#af-lista', c).innerHTML = `<div class="table-wrap"><table><tr><th>Plaqueta / Bem<div class="small">Marca, modelo, série · local</div></th><th>Classe<div class="small">Centro de custo</div></th>
      <th>Aquisição<div class="small">Início de uso</div></th><th class="num">Custo</th><th class="num">Depr. acumulada</th><th class="num">Valor líquido<div class="small">% depreciado</div></th><th>Situação</th></tr>
      ${L.slice(0, 500).map(b => { const p = D.pos[b.id], s = I.selo(b, p); return `<tr class="clickable" data-id="${b.id}">
        <td class="wrap"><span class="af-plaq" style="font-size:13px">${esc(b.plaqueta)}</span> ${esc(b.descricao)}${D.nAnexos[b.id] ? ` <span class="muted small" title="anexos">📎${D.nAnexos[b.id]}</span>` : ''}
          <div class="small muted">${esc([b.marca, b.modelo, b.serie && 'série ' + b.serie].filter(Boolean).join(' · '))}${b.local ? ` · ${esc(b.local)}` : ''}</div></td>
        <td class="wrap-m">${esc(D.kById[b.classe_id]?.nome || '')}<div class="small muted">${esc(ccNome(b.centro_custo_id) || '—')}</div></td>
        <td>${dateBR(b.data_aquisicao)}<div class="small muted">${b.data_inicio_uso ? dateBR(b.data_inicio_uso) : ''}</div></td>
        <td class="num">${money(p.custo)}</td><td class="num">${money(p.acum)}</td><td class="num">${money(p.vcl)}${barra(p.pct)}</td>
        <td><span class="af-sel ${s.cls}">${s.txt}</span></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Nenhum bem com estes filtros.</td></tr>'}
      ${L.length ? `<tr class="total"><td colspan="3">${L.length} bens${L.length > 500 ? ' (mostrando 500; use os filtros)' : ''}</td><td class="num">${money(tot.c)}</td><td class="num">${money(tot.a)}</td><td class="num">${money(tot.c - tot.a)}</td><td></td></tr>` : ''}</table></div>`;
    $$('tr[data-id]', c).forEach(tr => tr.onclick = () => ficha(D.bById[tr.dataset.id], root));
  };
  lista();
  $('#af-busca', c).oninput = debounce((e) => { ui.busca = e.target.value; lista(); }, 200);
  $('#af-fcl', c).onchange = (e) => { ui.classe = e.target.value; lista(); };
  $('#af-fcc', c).onchange = (e) => { ui.cc = e.target.value; lista(); };
  $('#af-fsit', c).onchange = (e) => { ui.sit = e.target.value; lista(); };
  $('#af-xls', c).onclick = () => exportXLSX([['Plaqueta', 'Descrição', 'Classe', 'Marca', 'Modelo', 'Série', 'NCM', 'Centro de custo', 'Local', 'Responsável', 'Fornecedor', 'NF', 'Aquisição', 'Início de uso',
    'Custo', 'Residual', 'Vida útil (meses)', 'Taxa fiscal % a.a.', 'Depr. acumulada', 'Valor líquido', 'Situação', 'Baixa', 'Tipo da baixa', 'Valor da baixa'],
    ...filtrar().map(b => { const p = D.pos[b.id]; return [b.plaqueta, b.descricao, classeTxt(b.classe_id), b.marca, b.modelo, b.serie, b.ncm, ccNome(b.centro_custo_id), b.local, b.responsavel, favNome(b.favorecido_id), b.nf_numero,
      b.data_aquisicao, b.data_inicio_uso, p.custo, +b.valor_residual, b.vida_util_meses, +b.taxa_fiscal, p.acum, p.vcl, I.SITUACOES[b.situacao], b.baixa_data, I.BAIXAS[b.baixa_tipo] || '', b.baixa_valor]; })], 'ativo-imobilizado');
  $('#af-etq', c).onclick = () => etiquetas(filtrar().filter(b => b.situacao !== 'baixado'));
  const n = $('#af-novo', c); if (n) n.onclick = () => formBem(null, root);
}

// ficha do bem
async function ficha(b, root) {
  const p = D.pos[b.id], k = D.kById[b.classe_id], s = I.selo(b, p);
  const deps = D.Dp.filter(d => d.bem_id === b.id);
  const [mov, anx] = await Promise.all([q(sb.from('af_movimentos').select('*').eq('bem_id', b.id).order('criado_em', { ascending: false })).catch(() => []),
    q(sb.from('af_anexos').select('*').eq('bem_id', b.id).order('criado_em', { ascending: false })).catch(() => [])]);
  const proj = b.situacao === 'baixado' ? [] : I.projecao([b], D.Dp, D.K, { de: D.ult ? I.somaMes(D.ult, 1) : hojeMes(), meses: 12, regra: D.P.regra_inicio });
  const faltam = Math.max(0, +b.vida_util_meses - p.usados);
  const linha = (r, v) => v ? `<div><div class="muted small">${r}</div><div>${v}</div></div>` : '';
  const vinc = [b.maquina_id && D.M.find(m => m.id === b.maquina_id), b.veiculo_id && D.V.find(v => v.id === b.veiculo_id)].filter(Boolean);
  const movTxt = (m) => {
    const de = m.de || {}, pa = m.para || {};
    if (m.tipo === 'aquisicao') return `Cadastro: ${money(pa.valor)}${pa.local ? ` · ${esc(pa.local)}` : ''}`;
    if (m.tipo === 'transferencia') return ['centro_custo_id', 'local', 'responsavel'].filter(x => de[x] !== pa[x]).map(x => `${{ centro_custo_id: 'Centro', local: 'Local', responsavel: 'Responsável' }[x]}: ${esc(x === 'centro_custo_id' ? ccNome(de[x]) || '—' : de[x] || '—')} → <b>${esc(x === 'centro_custo_id' ? ccNome(pa[x]) || '—' : pa[x] || '—')}</b>`).join(' · ');
    if (m.tipo === 'revisao') return `Revisão: vida útil ${de.vida_util_meses} → <b>${pa.vida_util_meses}</b> meses${de.valor_residual !== pa.valor_residual ? ` · residual ${money(de.valor_residual)} → <b>${money(pa.valor_residual)}</b>` : ''}${de.taxa_fiscal !== pa.taxa_fiscal ? ` · taxa fiscal ${nf(de.taxa_fiscal, 2)}% → <b>${nf(pa.taxa_fiscal, 2)}%</b>` : ''}`;
    if (m.tipo === 'situacao') return `Situação: ${I.SITUACOES[de.situacao]} → <b>${I.SITUACOES[pa.situacao]}</b>`;
    if (m.tipo === 'baixa') return `<b>Baixa</b> (${I.BAIXAS[pa.tipo] || pa.tipo})${pa.valor ? ` por ${money(pa.valor)}` : ''}`;
    if (m.tipo === 'reativacao') return '<b>Baixa desfeita</b>';
    if (m.tipo === 'inventario') return `Inventário nº ${pa.inventario}: encontrado${pa.local ? ` em ${esc(pa.local)}` : ''}${pa.estado ? ` · estado ${I.ESTADOS[pa.estado]}` : ''}`;
    return m.tipo;
  };
  const md = modal({ title: `${b.plaqueta} — ${b.descricao}`, wide: true, body: `
    <div class="af-ficha-topo"><span class="af-sel ${s.cls}">${s.txt}</span><span class="muted">${esc(classeTxt(b.classe_id))}</span>${vinc.map(v => `<span class="af-sel">${v.placa ? '🚚 ' + esc(v.placa) : '⚙️ ' + esc(v.codigo + ' ' + (v.nome || ''))}</span>`).join('')}</div>
    <div class="kpis" style="margin-top:12px">${kpi('Custo', money(p.custo))}${kpi('Depreciação acumulada', money(p.acum), pct(p.pct, 1))}${kpi('Valor líquido', money(p.vcl))}
      ${kpi('Vida útil restante', b.situacao === 'baixado' ? '–' : `${nf(faltam, 1)} meses`, `de ${b.vida_util_meses} · taxa fiscal ${nf(b.taxa_fiscal, 2)}% a.a.`)}</div>
    <div class="chips" id="fb-abas" style="margin:14px 0 8px">${[['dados', 'Dados'], ['dep', `Depreciação (${deps.length})`], ['hist', `Histórico (${mov.length})`], ['anx', `Anexos (${anx.length})`]].map(([k2, t], i) => `<span class="chip ${i ? '' : 'on'}" data-t="${k2}">${t}</span>`).join('')}</div>
    <div data-p="dados"><div class="grid-form dados5">
      ${linha('Marca / modelo', esc([b.marca, b.modelo].filter(Boolean).join(' · ')))}${linha('Série', esc(b.serie))}${linha('NCM', esc(b.ncm))}
      ${linha('Centro de custo', esc(ccNome(b.centro_custo_id)))}${linha('Local', esc(b.local))}${linha('Responsável', esc(b.responsavel))}
      ${linha('Fornecedor', esc(favNome(b.favorecido_id)))}${linha('Nota fiscal', esc(b.nf_numero))}${linha('Aquisição', dateBR(b.data_aquisicao))}${linha('Início de uso', dateBR(b.data_inicio_uso))}
      ${linha('Valor residual', +b.valor_residual ? money(b.valor_residual) : '')}${linha('Implantação', b.data_corte ? `${money(b.deprec_inicial)} até ${dateBR(b.data_corte)} (${nf(b.meses_iniciais, 1)} meses)` : '')}
      ${linha('ICMS no CIAP', +b.icms_credito ? money(b.icms_credito) : '')}${linha('PIS/COFINS', I.CREDITOS[b.credito_pis_cofins || k?.credito_pis_cofins] || '')}
      ${linha('Bem principal', b.pai_id ? esc(D.bById[b.pai_id]?.plaqueta + ' ' + D.bById[b.pai_id]?.descricao) : '')}
      ${b.situacao === 'baixado' ? linha('Baixa', `${dateBR(b.baixa_data)} · ${I.BAIXAS[b.baixa_tipo]}${b.baixa_valor ? ` · ${money(b.baixa_valor)}` : ''}`) + linha('Motivo', esc(b.baixa_motivo)) : ''}
      ${linha('Observação', esc(b.observacao))}</div>
      ${D.B.some(x => x.pai_id === b.id) ? `<h4>Componentes e melhorias</h4><ul>${D.B.filter(x => x.pai_id === b.id).map(x => `<li>${esc(x.plaqueta)} ${esc(x.descricao)} — ${money(D.pos[x.id].vcl)}</li>`).join('')}</ul>` : ''}</div>
    <div data-p="dep" hidden><div class="table-wrap" style="max-height:340px"><table><tr><th>Mês</th><th class="num">Fração</th><th class="num">Quota</th><th class="num">Acumulada</th><th class="num">Valor líquido</th><th class="num">Fiscal</th></tr>
      ${b.data_corte ? `<tr class="muted"><td>até ${mesBR(I.mesDe(b.data_corte))}</td><td class="num">${nf(b.meses_iniciais, 1)}</td><td class="num">${money(b.deprec_inicial)}</td><td class="num">${money(b.deprec_inicial)}</td><td class="num">${money(+b.valor_aquisicao - +b.deprec_inicial)}</td><td class="num">–</td></tr>` : ''}
      ${deps.map(d => `<tr><td>${mesBR(I.mesDe(d.competencia))}</td><td class="num">${nf(d.meses, 2)}</td><td class="num">${money(d.valor)}</td><td class="num">${money(d.acumulada)}</td><td class="num">${money(+b.valor_aquisicao - +d.acumulada)}</td><td class="num">${money(d.valor_fiscal)}</td></tr>`).join('')}
      ${proj.filter(x => x.valor).map(x => `<tr class="muted"><td>${mesBR(x.mes)} <span class="small">previsto</span></td><td></td><td class="num">${money(x.valor)}</td><td colspan="3"></td></tr>`).join('')}
      ${!deps.length && !proj.some(x => x.valor) ? '<tr><td colspan="6" class="empty">Sem depreciação.</td></tr>' : ''}</table></div></div>
    <div data-p="hist" hidden><div class="table-wrap" style="max-height:340px"><table><tr><th>Data</th><th>O que mudou</th><th>Por</th></tr>
      ${mov.map(m => `<tr><td>${dateBR(m.data)}<div class="small muted">${dateBR(String(m.criado_em).slice(0, 10))}</div></td><td class="wrap">${movTxt(m)}${m.observacao ? `<div class="small muted">${esc(m.observacao)}</div>` : ''}</td><td class="small">${esc(m.usuario || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Sem histórico.</td></tr>'}</table></div></div>
    <div data-p="anx" hidden>${podeEditar() ? `<div class="toolbar"><select id="fb-tipo"><option value="foto">Foto</option><option value="nota">Nota fiscal</option><option value="laudo">Laudo / avaliação</option><option value="documento">Documento</option></select>
      <input type="file" id="fb-arq" accept="application/pdf,image/*" multiple><button class="btn small" id="fb-up">Enviar</button></div>` : ''}
      <div class="table-wrap"><table><tr><th>Arquivo</th><th>Tipo</th><th>Enviado</th><th></th></tr>${anx.map(a => `<tr><td><a href="#" data-ver="${esc(a.caminho)}">${esc(a.nome)}</a></td><td>${esc(a.tipo)}</td><td class="small">${dateBR(String(a.criado_em).slice(0, 10))} · ${esc(a.criado_por || '')}</td>
        <td>${podeEditar() ? `<button class="btn small ghost" data-del="${a.id}" data-cam="${esc(a.caminho)}">Excluir</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sem anexos.</td></tr>'}</table></div></div>`,
    foot: `${podeEditar() ? (b.situacao === 'baixado' ? '<button class="btn danger" id="fb-desf">Desfazer baixa</button>' : '<button class="btn danger" id="fb-baixa">Baixar bem</button>') : ''}<span class="spacer"></span>
      <button class="btn" id="fb-etq">Etiqueta</button><button class="btn" id="fb-imp">Imprimir ficha</button>${podeEditar() ? '<button class="btn primary" id="fb-edit">Editar</button>' : ''}` });
  const el = md.el;
  $('#fb-abas', el).onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (!t) return; $$('#fb-abas .chip', el).forEach(x => x.classList.toggle('on', x.dataset.t === t)); $$('[data-p]', el).forEach(x => { x.hidden = x.dataset.p !== t; }); };
  $('#fb-etq', el).onclick = () => etiquetas([b]);
  $('#fb-imp', el).onclick = () => imprimirFicha(b, deps, mov);
  const ed = $('#fb-edit', el); if (ed) ed.onclick = () => { md.close(); formBem(b, root); };
  const bx = $('#fb-baixa', el); if (bx) bx.onclick = () => { md.close(); baixar(b, root); };
  const df = $('#fb-desf', el); if (df) df.onclick = async () => {
    const mot = prompt('Motivo para desfazer a baixa:'); if (!mot?.trim()) return;
    try { await q(sb.rpc('af_desfazer_baixa', { p_bem: b.id, p_motivo: mot.trim() })); toast('Baixa desfeita. Recalcule a depreciação do mês da baixa.'); md.close(); refazer(root); } catch (e) { fail(e); }
  };
  $$('[data-ver]', el).forEach(a => a.onclick = async (e) => { e.preventDefault(); try { const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.dataset.ver, 300); if (error) throw error; window.open(data.signedUrl, '_blank'); } catch (er) { fail(er); } });
  $$('[data-del]', el).forEach(x => x.onclick = async () => {
    if (!await confirmDialog('Excluir este anexo?')) return;
    try { await sb.storage.from(BUCKET).remove([x.dataset.cam]); await q(sb.from('af_anexos').delete().eq('id', x.dataset.del)); toast('Anexo excluído'); md.close(); await carregar(); ficha(D.bById[b.id], root); } catch (e) { fail(e); }
  });
  const up = $('#fb-up', el); if (up) up.onclick = async () => {
    const fs = [...$('#fb-arq', el).files]; if (!fs.length) return toast('Escolha o arquivo', true);
    try {
      for (const f of fs) {
        const cam = `${state.empresa.id}/${b.id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`;
        const { error } = await sb.storage.from(BUCKET).upload(cam, f, { upsert: false }); if (error) throw error;
        await q(sb.from('af_anexos').insert({ empresa_id: state.empresa.id, bem_id: b.id, caminho: cam, nome: f.name, tipo: $('#fb-tipo', el).value }));
      }
      toast('Anexo enviado'); md.close(); await carregar(); ficha(D.bById[b.id], root);
    } catch (e) { fail(e); }
  };
}

// cadastro / edição
function formBem(b, root, pre = {}) {
  const novo = !b; b = b || { situacao: 'em_uso', data_aquisicao: today(), valor_residual: 0, deprec_inicial: 0, meses_iniciais: 0, icms_credito: 0, ...pre };
  const k0 = D.kById[b.classe_id];
  const travado = !novo && D.Dp.some(d => d.bem_id === b.id && D.C.some(c => c.competencia === d.competencia && c.situacao === 'fechado'));
  const lk = travado ? 'disabled title="Já depreciado em mês fechado"' : '';
  const ctas = (sel) => `<option value="">—</option>${D.M.map(m => `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${esc(m.codigo)} · ${esc(m.nome)}</option>`).join('')}`;
  const md = modal({ title: novo ? (pre.descricao ? 'Imobilizar' : 'Novo bem') : `Editar ${b.plaqueta}`, wide: true, body: `<form id="fb">
    ${travado ? '<div class="af-alerta warn">Este bem já foi depreciado em mês fechado: custo, classe, residual, início de uso e implantação ficam travados. A vida útil pode ser revista (vale dos próximos meses em diante).</div>' : ''}
    <fieldset><legend>Identificação</legend><div class="grid-form">
      <label class="span2">Descrição *<input name="descricao" required value="${esc(b.descricao || '')}"></label>
      <label class="c4">Classe *<select name="classe_id" required ${lk}><option value="">Escolha…</option>${D.K.filter(k => k.ativo || k.id === b.classe_id).map(k => `<option value="${k.id}" ${b.classe_id === k.id ? 'selected' : ''}>${esc(k.codigo)} · ${esc(k.nome)}</option>`).join('')}</select></label>
      <label class="xs">Situação<select name="situacao" ${b.situacao === 'baixado' ? 'disabled' : ''}>${Object.entries(I.SITUACOES).filter(([s]) => s !== 'baixado' || b.situacao === 'baixado').map(([s, t]) => `<option value="${s}" ${b.situacao === s ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Marca<input name="marca" value="${esc(b.marca || '')}"></label><label>Modelo<input name="modelo" value="${esc(b.modelo || '')}"></label>
      <label class="xs">Nº de série<input name="serie" value="${esc(b.serie || '')}"></label><label class="xs">NCM<input name="ncm" value="${esc(b.ncm || '')}" maxlength="8"></label>
      <label class="xs">Plaqueta<input name="plaqueta" value="${esc(b.plaqueta || '')}" placeholder="automática"></label>
    </div></fieldset>
    <fieldset><legend>Onde está</legend><div class="grid-form">
      <label>Centro de custo<select name="centro_custo_id">${options(state.cad.cc, { selected: b.centro_custo_id, empty: '—' })}</select></label>
      <label>Local<input name="local" value="${esc(b.local || '')}" list="af-locais"><datalist id="af-locais">${[...new Set(D.B.map(x => x.local).filter(Boolean))].map(l => `<option value="${esc(l)}">`).join('')}</datalist></label>
      <label>Responsável<input name="responsavel" value="${esc(b.responsavel || '')}"></label>
      <label>Bem principal<select name="pai_id"><option value="">— (bem independente)</option>${D.B.filter(x => x.id !== b.id && x.situacao !== 'baixado').map(x => `<option value="${x.id}" ${b.pai_id === x.id ? 'selected' : ''}>${esc(x.plaqueta)} ${esc(x.descricao)}</option>`).join('')}</select></label>
      <label class="span2">Máquina da produção<select name="maquina_id">${ctas(b.maquina_id)}</select></label>
      <label class="span2">Veículo<select name="veiculo_id"><option value="">—</option>${D.V.map(v => `<option value="${v.id}" ${b.veiculo_id === v.id ? 'selected' : ''}>${esc(v.codigo)}${v.placa ? ' · ' + esc(v.placa) : ''}${v.marca_modelo ? ' · ' + esc(v.marca_modelo) : ''}</option>`).join('')}</select></label>
    </div></fieldset>
    <fieldset><legend>Aquisição e depreciação</legend><div class="grid-form">
      <label class="span2">Fornecedor<select name="favorecido_id">${options(state.cad.favorecidos, { label: 'label', selected: b.favorecido_id, empty: '—' })}</select></label>
      <label class="xs">Nota fiscal<input name="nf_numero" value="${esc(b.nf_numero || '')}"></label>
      <label class="xs">Aquisição *<input type="date" name="data_aquisicao" required value="${b.data_aquisicao || ''}" ${lk}></label>
      <label class="xs">Início de uso<input type="date" name="data_inicio_uso" value="${b.data_inicio_uso || ''}" ${lk} title="Quando o bem ficou pronto para uso (instalado). Vazio = data de aquisição."></label>
      <label class="xs">Custo (R$) *<input name="valor_aquisicao" required inputmode="decimal" value="${b.valor_aquisicao != null ? nf(b.valor_aquisicao, 2) : ''}" ${lk}></label>
      <label class="xs">Residual (R$)<input name="valor_residual" inputmode="decimal" value="${nf(b.valor_residual || 0, 2)}" ${lk}></label>
      <label class="xs">Vida útil (meses) *<input name="vida_util_meses" type="number" min="1" required value="${b.vida_util_meses || k0?.vida_util_meses || ''}"></label>
      <label class="xs">Taxa fiscal % a.a.<input name="taxa_fiscal" inputmode="decimal" value="${nf(b.taxa_fiscal ?? k0?.taxa_fiscal ?? 10, 2)}"></label>
      <div class="xs muted small" id="fb-quota" style="align-self:end;padding-bottom:8px"></div>
    </div></fieldset>
    <fieldset><legend>Créditos fiscais</legend><div class="grid-form">
      <label class="xs">ICMS no CIAP (R$)<input name="icms_credito" inputmode="decimal" value="${nf(b.icms_credito || 0, 2)}"></label>
      <label class="c4">PIS/COFINS<select name="credito_pis_cofins"><option value="">Da classe${k0 ? ` (${I.CREDITOS[k0.credito_pis_cofins]})` : ''}</option>${Object.entries(I.CREDITOS).map(([c, t]) => `<option value="${c}" ${b.credito_pis_cofins === c ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="xs">Base PIS/COFINS<input name="pis_cofins_base" inputmode="decimal" value="${b.pis_cofins_base != null ? nf(b.pis_cofins_base, 2) : ''}" placeholder="= custo"></label>
      <label class="xs">CIAP<select name="ciap"><option value="">Da classe</option><option value="true" ${b.ciap === true ? 'selected' : ''}>Sim</option><option value="false" ${b.ciap === false ? 'selected' : ''}>Não</option></select></label>
    </div></fieldset>
    <details ${b.data_corte ? 'open' : ''}><summary><b>Implantação</b> — bem que já vinha sendo depreciado antes da plataforma</summary><div class="grid-form" style="margin-top:8px">
      <label class="xs">Depreciado até<input type="date" name="data_corte" value="${b.data_corte || ''}" ${lk} title="Último dia do mês"></label>
      <label class="xs">Depr. acumulada (R$)<input name="deprec_inicial" inputmode="decimal" value="${nf(b.deprec_inicial || 0, 2)}" ${lk}></label>
      <label class="xs">Meses já depreciados<input name="meses_iniciais" inputmode="decimal" value="${nf(b.meses_iniciais || 0, 2)}" ${lk}></label>
      <div class="span2 muted small" style="align-self:end;padding-bottom:8px">Use o razão auxiliar ou o balancete da contabilidade. A plataforma deprecia o saldo nos meses que faltam da vida útil.</div>
    </div></details>
    <fieldset><legend>Observação</legend><div class="grid-form"><label class="full"><textarea name="observacao" rows="2">${esc(b.observacao || '')}</textarea></label></div></fieldset>
    ${novo && pre.quantidade > 1 ? `<div class="af-alerta"><label class="chk"><input type="checkbox" name="desmembrar" checked> Cadastrar <b>${nf(pre.quantidade)}</b> bens (um por unidade da nota, com o custo dividido)</label></div>` : ''}
  </form>`, foot: '<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="fb-ok">Salvar</button>' });
  const f = $('#fb', md.el);
  const quotaTxt = () => { const v = parseNum(f.valor_aquisicao.value) - parseNum(f.valor_residual.value) - parseNum(f.deprec_inicial.value), m = +f.vida_util_meses.value - parseNum(f.meses_iniciais.value);
    $('#fb-quota', md.el).textContent = v > 0 && m > 0 ? `≈ ${money(v / m)}/mês` : ''; };
  f.classe_id.onchange = () => { const k = D.kById[f.classe_id.value]; if (!k) return; f.vida_util_meses.value = k.vida_util_meses; f.taxa_fiscal.value = nf(k.taxa_fiscal, 2);
    if (+k.residual_pct) f.valor_residual.value = nf(parseNum(f.valor_aquisicao.value) * k.residual_pct / 100, 2); quotaTxt(); };
  f.data_corte.onchange = () => { const dc = f.data_corte.value, ini = f.data_inicio_uso.value || f.data_aquisicao.value; if (dc && ini && !parseNum(f.meses_iniciais.value)) f.meses_iniciais.value = nf(Math.max(0, I.difMeses(I.mesDe(ini), I.mesDe(dc)) + (D.P.regra_inicio === 'mes_seguinte' ? 0 : 1)), 0); quotaTxt(); };
  ['valor_aquisicao', 'valor_residual', 'vida_util_meses', 'deprec_inicial', 'meses_iniciais'].forEach(n => f[n].addEventListener('input', quotaTxt)); quotaTxt();
  $('#fb-ok', md.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const v = (n) => f[n].value.trim() || null, num = (n) => f[n].value.trim() === '' ? null : parseNum(f[n].value);
    const reg = { descricao: v('descricao'), classe_id: f.classe_id.value, marca: v('marca'), modelo: v('modelo'), serie: v('serie'), ncm: v('ncm'), centro_custo_id: v('centro_custo_id'), local: v('local'), responsavel: v('responsavel'),
      pai_id: v('pai_id'), maquina_id: v('maquina_id'), veiculo_id: v('veiculo_id'), favorecido_id: v('favorecido_id'), nf_numero: v('nf_numero'), data_aquisicao: f.data_aquisicao.value, data_inicio_uso: v('data_inicio_uso'),
      valor_aquisicao: num('valor_aquisicao'), valor_residual: num('valor_residual') || 0, vida_util_meses: +f.vida_util_meses.value, taxa_fiscal: num('taxa_fiscal') ?? 0,
      icms_credito: num('icms_credito') || 0, credito_pis_cofins: v('credito_pis_cofins'), pis_cofins_base: num('pis_cofins_base'), ciap: f.ciap.value === '' ? null : f.ciap.value === 'true',
      data_corte: v('data_corte'), deprec_inicial: num('deprec_inicial') || 0, meses_iniciais: num('meses_iniciais') || 0, observacao: v('observacao') };
    if (b.situacao !== 'baixado') reg.situacao = f.situacao.value;
    if (v('plaqueta')) reg.plaqueta = v('plaqueta').toUpperCase();
    if (travado) for (const k of ['classe_id', 'data_aquisicao', 'data_inicio_uso', 'valor_aquisicao', 'valor_residual', 'data_corte', 'deprec_inicial', 'meses_iniciais']) delete reg[k];
    if (reg.data_corte && reg.data_corte !== I.fimDoMes(I.mesDe(reg.data_corte))) return toast('"Depreciado até" tem de ser o último dia do mês', true);
    try {
      if (novo) {
        const n = f.desmembrar?.checked ? Math.round(+pre.quantidade) : 1, base = { ...reg, empresa_id: state.empresa.id, nfe_nota_id: pre.nfe_nota_id || null, nfe_item_id: pre.nfe_item_id || null, lancamento_id: pre.lancamento_id || null };
        if (n > 1) { const un = Math.floor(reg.valor_aquisicao / n * 100) / 100, ic = Math.floor(reg.icms_credito / n * 100) / 100;
          const rows = Array.from({ length: n }, (_, i) => ({ ...base, plaqueta: null, descricao: `${reg.descricao} (${i + 1}/${n})`, valor_aquisicao: i === n - 1 ? Math.round((reg.valor_aquisicao - un * (n - 1)) * 100) / 100 : un,
            icms_credito: i === n - 1 ? Math.round((reg.icms_credito - ic * (n - 1)) * 100) / 100 : ic, valor_residual: Math.round(reg.valor_residual / n * 100) / 100, nfe_item_id: i ? null : base.nfe_item_id }));
          for (const r of rows) { delete r.plaqueta; await q(sb.from('af_bens').insert(r)); }   // um por vez: numeração em sequência
        } else { if (!base.plaqueta) delete base.plaqueta; await q(sb.from('af_bens').insert(base)); }
        toast(n > 1 ? `${n} bens cadastrados` : 'Bem cadastrado');
      } else { await q(sb.from('af_bens').update(reg).eq('id', b.id)); toast('Bem atualizado'); }
      md.close(); await refazer(root);
    } catch (e) { fail(e); }
  };
}

function baixar(b, root) {
  const p = D.pos[b.id];
  const md = modal({ title: `Baixar ${b.plaqueta}`, body: `<p>${esc(b.descricao)} · custo ${money(p.custo)} · valor líquido ${money(p.vcl)}</p><form id="fbx"><div class="grid-form">
      <label class="xs">Data *<input type="date" name="data" required value="${today()}"></label>
      <label class="c4">Tipo *<select name="tipo">${Object.entries(I.BAIXAS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label class="xs">Valor da venda (R$)<input name="valor" inputmode="decimal" placeholder="0,00"></label>
      <label class="full">Motivo *<textarea name="motivo" rows="2" required placeholder="Ex.: vendida para … conforme NF …; sucateada após laudo …"></textarea></label></div></form>
    <div class="muted small">A baixa entra na contabilidade no cálculo do mês dela: crédito do custo, débito da depreciação acumulada e o valor líquido no custo do bem baixado.
      A receita da venda entra pelo financeiro (lançamento do recebimento). Depois imprima o termo de baixa para assinatura.</div>`,
    foot: '<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn danger" id="fbx-ok">Baixar</button>' });
  $('#fbx-ok', md.el).onclick = async () => {
    const f = $('#fbx', md.el); if (!f.reportValidity()) return;
    try {
      await q(sb.rpc('af_baixar', { p_bem: b.id, p_data: f.data.value, p_tipo: f.tipo.value, p_valor: f.valor.value ? parseNum(f.valor.value) : null, p_motivo: f.motivo.value.trim() }));
      md.close(); toast('Bem baixado. Calcule (ou recalcule) a depreciação do mês da baixa para o lançamento contábil.');
      await carregar(); termoBaixa(D.bById[b.id]); render(root);
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- A imobilizar
async function candidatos(c, root) {
  c.innerHTML = `<div class="card toolbar"><label>De <input type="date" id="cd-de" value="${ui.candDe}"></label><label>Até <input type="date" id="cd-ate" value="${ui.candAte}"></label>
      <span class="muted small">NF-e de entrada com NCM de bem durável e valor unitário a partir de ${money(D.P.valor_minimo)}, produtos do tipo 08, lançamentos nas classificações de compra de bens, máquinas e veículos próprios sem bem.</span></div>
    <div class="card" style="margin-top:12px" id="cd-lista"><div class="loading">Procurando…</div></div>`;
  $('#cd-de', c).onchange = (e) => { ui.candDe = e.target.value; candidatos(c, root); };
  $('#cd-ate', c).onchange = (e) => { ui.candAte = e.target.value; candidatos(c, root); };
  if (!podeEditar()) { $('#cd-lista', c).innerHTML = '<div class="empty">Só quem edita (administrador e financeiro) vê as compras a imobilizar.</div>'; return; }
  let L; try { L = await q(sb.rpc('af_candidatos', { p_empresa: state.empresa.id, p_ini: ui.candDe, p_fim: ui.candAte })); } catch (e) { $('#cd-lista', c).innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const ORIG = { nfe: 'Notas fiscais de entrada', lancamento: 'Lançamentos pagos', maquina: 'Máquinas da produção', veiculo: 'Veículos próprios' };
  $('#cd-lista', c).innerHTML = !L.length ? '<div class="empty">Nada a imobilizar neste período. 👌</div>' : Object.keys(ORIG).filter(o => L.some(x => x.origem === o)).map(o => `<h3 style="margin-top:0">${ORIG[o]} <span class="muted small">(${L.filter(x => x.origem === o).length})</span></h3>
    <div class="table-wrap" style="margin-bottom:16px"><table><tr><th>Item<div class="small">Motivo</div></th><th>Documento<div class="small">Fornecedor</div></th><th class="num">Qtd.</th><th class="num">Valor<div class="small">ICMS</div></th><th></th></tr>
    ${L.filter(x => x.origem === o).map(x => `<tr><td class="wrap">${esc(x.descricao || '')}${x.ncm ? ` <span class="muted small">NCM ${esc(x.ncm)}</span>` : ''}<div class="small muted">${esc(x.motivo)}</div></td>
      <td>${esc(x.documento || '')}${x.data ? ` · ${dateBR(x.data)}` : ''}<div class="small muted">${esc(x.fornecedor || '')}</div></td><td class="num">${nf(x.quantidade, 0)}</td>
      <td class="num">${x.valor != null ? money(x.valor) : '–'}<div class="small muted">${+x.icms ? money(x.icms) : ''}</div></td>
      <td style="white-space:nowrap"><button class="btn small primary" data-im="${x.ref_id}">Imobilizar</button> <button class="btn small ghost" data-ig="${x.ref_id}" data-o="${x.origem}">Não é imobilizado</button></td></tr>`).join('')}</table></div>`).join('');
  const byRef = Object.fromEntries(L.map(x => [x.ref_id, x]));
  $$('[data-im]', c).forEach(bt => bt.onclick = () => {
    const x = byRef[bt.dataset.im];
    const k = D.K.find(k2 => x.origem === 'veiculo' ? k2.codigo === 'VCG' : x.origem === 'maquina' ? k2.codigo === 'MAQ' : x.ncm?.startsWith('8471') ? k2.codigo === 'INF' : x.ncm?.startsWith('8704') ? k2.codigo === 'VCG' : x.ncm?.startsWith('8703') ? k2.codigo === 'VPS' : x.ncm?.startsWith('94') ? k2.codigo === 'MOV' : x.ncm?.startsWith('8427') ? k2.codigo === 'EMP' : k2.codigo === 'MAQ');
    const cs = x.valor != null ? I.custoSugerido(x, k || {}, { data: x.data || today(), ateCredito: D.P.pis_cofins_ate }) : null;
    formBem(null, root, { descricao: x.descricao, ncm: x.ncm, classe_id: k?.id, favorecido_id: x.favorecido_id, nf_numero: x.origem === 'nfe' ? x.documento.replace(/^NF /, '') : x.documento,
      data_aquisicao: x.data || today(), valor_aquisicao: cs ? cs.custo : null, icms_credito: cs ? cs.icms : 0, pis_cofins_base: cs && cs.base_pis ? cs.base_pis : null,
      vida_util_meses: k?.vida_util_meses, taxa_fiscal: k?.taxa_fiscal, quantidade: +x.quantidade || 1,
      nfe_nota_id: x.nota_id, nfe_item_id: x.origem === 'nfe' ? x.ref_id : null, lancamento_id: x.origem === 'lancamento' ? x.ref_id : null,
      maquina_id: x.origem === 'maquina' ? x.ref_id : null, veiculo_id: x.origem === 'veiculo' ? x.ref_id : null,
      observacao: cs && (cs.icms || cs.pis) ? `Custo = ${money(cs.bruto)} da nota − ICMS do CIAP ${money(cs.icms)} − PIS/COFINS ${money(cs.pis)} (créditos recuperáveis saem do custo).` : null });
  });
  $$('[data-ig]', c).forEach(bt => bt.onclick = async () => {
    const mot = prompt('Por que não é imobilizado? (ex.: peça de reposição, material de consumo)'); if (mot == null) return;
    try { await q(sb.from('af_ignorados').insert({ empresa_id: state.empresa.id, origem: bt.dataset.o, ref_id: bt.dataset.ig, motivo: mot.trim() || null })); toast('Retirado da lista'); candidatos(c, root); } catch (e) { fail(e); }
  });
}

// ---------------------------------------------------------------- Depreciação mensal
async function depreciacao(c, root) {
  const ano = ui.mes.slice(0, 4), calc = Object.fromEntries(D.C.map(x => [I.mesDe(x.competencia), x]));
  const atual = calc[ui.mes];
  c.innerHTML = `<div class="card"><div class="toolbar"><b>Ano</b><select id="dp-ano">${[...new Set([String(+today().slice(0, 4) - 1), today().slice(0, 4), ...D.C.map(x => x.competencia.slice(0, 4))])].sort().map(a => `<option ${a === ano ? 'selected' : ''}>${a}</option>`).join('')}</select>
      <span class="muted small">Verde = fechado · azul = calculado. Os meses vão em sequência; mês fechado não muda.</span></div>
      <div class="af-meses">${Array.from({ length: 12 }, (_, i) => { const m = `${ano}-${String(i + 1).padStart(2, '0')}`, x = calc[m];
        return `<div class="af-mes ${x ? x.situacao : ''} ${m === ui.mes ? 'on' : ''}" data-m="${m}">${['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][i]}<b>${x ? money0(x.total) : '–'}</b><span class="small muted">${x ? (x.situacao === 'fechado' ? 'fechado' : 'calculado') : ''}</span></div>`; }).join('')}</div></div>
    <div class="card" style="margin-top:12px"><div class="toolbar"><h3 style="margin:0">${mesBR(ui.mes)}</h3>${atual ? `<span class="af-sel ${atual.situacao === 'fechado' ? 'pos' : ''}">${atual.situacao === 'fechado' ? `Fechado por ${esc(atual.fechado_por || '')}` : `Calculado por ${esc(atual.calculado_por || '')} em ${dateBR(String(atual.calculado_em).slice(0, 10))}`}</span>` : '<span class="af-sel warn">Não calculado</span>'}
      <span class="spacer"></span><button class="btn small" id="dp-mapa">Mapa de depreciação</button>
      ${podeEditar() && atual?.situacao !== 'fechado' ? `<button class="btn" id="dp-prev">Prévia</button><button class="btn primary" id="dp-calc">${atual ? 'Recalcular' : 'Calcular e lançar'}</button>` : ''}
      ${podeEditar() && atual && atual.situacao !== 'fechado' ? '<button class="btn" id="dp-fech">Fechar o mês</button>' : ''}${isAdmin() && atual?.situacao === 'fechado' ? '<button class="btn danger" id="dp-reab">Reabrir</button>' : ''}</div>
      <div id="dp-res" style="margin-top:12px"></div></div>`;
  $('#dp-ano', c).onchange = (e) => { ui.mes = `${e.target.value}-${ui.mes.slice(5)}`; depreciacao(c, root); };
  $$('[data-m]', c).forEach(x => x.onclick = () => { ui.mes = x.dataset.m; depreciacao(c, root); });
  const res = $('#dp-res', c);
  const mostrar = async (r, gravado) => {
    let lanc = [];
    if (gravado && atual) { lanc = await q(sb.from('contab_lancamentos').select('id,data,historico,contab_partidas(conta_id,debito,credito)').eq('empresa_id', state.empresa.id).eq('origem', 'depreciacao').eq('origem_id', atual.id).order('data')).catch(() => []); }
    const pend = r.pendencias || [];
    res.innerHTML = `${gravado ? '' : '<div class="af-alerta">Prévia: nada foi gravado.</div>'}
      ${pend.map(p => `<div class="af-alerta warn">⚠️ <div><b>${esc(p.motivo)}</b>: ${esc(p.classe)} — ${p.qtd} bem(ns), ${money(p.valor)}. <a href="#/contab/imobilizado-parametros">Ligar as contas</a> e recalcular.</div></div>`).join('')}
      <div class="kpis">${kpi('Depreciação contábil', money(r.total), `${r.qtd} bens`)}${kpi('Depreciação fiscal (taxa RFB)', money(r.total_fiscal), +r.total_fiscal !== +r.total ? `diferença ${money(r.total_fiscal - r.total)} (LALUR)` : 'igual à contábil')}${kpi('Baixas no mês', nf(r.baixas))}</div>
      <div class="af-grid2" style="margin-top:12px"><div><h4 style="margin-top:0">Por classe</h4><div class="table-wrap"><table><tr><th>Classe</th><th class="num">Bens</th><th class="num">Contábil</th><th class="num">Fiscal</th></tr>
        ${(r.classes || []).map(x => `<tr><td>${esc(x.classe)}</td><td class="num">${x.qtd}</td><td class="num">${money(x.valor)}</td><td class="num">${money(x.fiscal)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nada a depreciar.</td></tr>'}</table></div></div>
      <div><h4 style="margin-top:0">Lançamento contábil</h4>${gravado ? (lanc.length ? lanc.map(l => `<div class="small"><b>${dateBR(l.data)}</b> ${esc(l.historico)}</div><table style="margin-bottom:10px"><tr><th>Conta</th><th class="num">Débito</th><th class="num">Crédito</th></tr>
        ${l.contab_partidas.map(p => `<tr><td class="wrap">${esc(nomeConta(p.conta_id))}</td><td class="num">${+p.debito ? money(p.debito) : ''}</td><td class="num">${+p.credito ? money(p.credito) : ''}</td></tr>`).join('')}</table>`).join('')
        : `<div class="muted">${D.P.gerar_contabil ? 'Nenhum lançamento (verifique as contas das classes).' : 'Geração contábil desligada nos parâmetros.'}</div>`) : '<div class="muted">Sai ao calcular.</div>'}
        <div class="muted small">Entra no Balancete, no Balanço e na DRE Contábil da plataforma (origem "depreciação").</div></div></div>`;
  };
  if (atual) {   // o que foi gravado no mês, por classe (funciona também com o mês fechado e para quem só lê)
    const porK = {}; for (const d of D.Dp.filter(x => I.mesDe(x.competencia) === ui.mes)) { const k = D.bById[d.bem_id]?.classe_id; (porK[k] ||= { classe: classeTxt(k).replace(' · ', ' '), qtd: 0, valor: 0, fiscal: 0 }); porK[k].qtd++; porK[k].valor += +d.valor; porK[k].fiscal += +d.valor_fiscal; }
    mostrar({ ...atual, classes: Object.values(porK).sort((a, b) => a.classe.localeCompare(b.classe)) }, true).catch(fail);
  }
  else res.innerHTML = '<div class="muted">Use <b>Prévia</b> para conferir antes de gravar.</div>';
  const pv = $('#dp-prev', c); if (pv) pv.onclick = async () => { try { mostrar(await q(sb.rpc('af_calcular', { p_empresa: state.empresa.id, p_competencia: `${ui.mes}-01`, p_gravar: false })), false); } catch (e) { fail(e); } };
  const cl = $('#dp-calc', c); if (cl) cl.onclick = async () => {
    try { const r = await q(sb.rpc('af_calcular', { p_empresa: state.empresa.id, p_competencia: `${ui.mes}-01`, p_gravar: true })); toast(`Depreciação de ${mesBR(ui.mes)}: ${money(r.total)}`); await carregar(); depreciacao(c, root); } catch (e) { fail(e); }
  };
  const fc = $('#dp-fech', c); if (fc) fc.onclick = async () => {
    if (!await confirmDialog(`Fechar ${mesBR(ui.mes)}? Depois disso, custo e classe dos bens depreciados não mudam e o mês não é recalculado (só o administrador reabre).`)) return;
    try { await q(sb.rpc('af_fechar', { p_empresa: state.empresa.id, p_competencia: `${ui.mes}-01`, p_fechar: true })); toast('Mês fechado'); await carregar(); depreciacao(c, root); } catch (e) { fail(e); }
  };
  const ra = $('#dp-reab', c); if (ra) ra.onclick = async () => {
    if (!await confirmDialog(`Reabrir ${mesBR(ui.mes)}?`)) return;
    try { await q(sb.rpc('af_fechar', { p_empresa: state.empresa.id, p_competencia: `${ui.mes}-01`, p_fechar: false })); toast('Mês reaberto'); await carregar(); depreciacao(c, root); } catch (e) { fail(e); }
  };
  $('#dp-mapa', c).onclick = () => mapaDepreciacao(ui.mes);
}

// ---------------------------------------------------------------- Inventário
async function inventario(c, root) {
  const aberto = D.Iv.find(i => i.id === ui.invAberto) || null;
  if (aberto) return inventarioAberto(c, root, aberto);
  c.innerHTML = `<div class="card"><div class="toolbar"><h3 style="margin:0">Inventários físicos</h3><span class="spacer"></span>${podeEditar() ? '<button class="btn primary" id="iv-novo">+ Novo inventário</button>' : ''}</div>
    <p class="muted small">Imprima as etiquetas com QR, abra o inventário e leia as plaquetas pelo celular (tela Inventário Patrimonial) ou com leitor no computador. Ao concluir, sai o termo com os não encontrados e as divergências de local.</p>
    <div class="table-wrap"><table><tr><th>Nº</th><th>Descrição<div class="small">Escopo</div></th><th>Data</th><th>Situação</th><th class="num">Encontrados</th><th class="num">Não encontrados</th></tr>
    ${D.Iv.map(i => `<tr class="clickable" data-iv="${i.id}"><td>${i.numero}</td><td class="wrap">${esc(i.descricao)}<div class="small muted">${esc(escopoTxt(i.filtro))}</div></td><td>${dateBR(i.data_inicio)}</td>
      <td><span class="af-sel ${i.situacao === 'concluido' ? 'pos' : 'warn'}">${i.situacao === 'concluido' ? 'Concluído' : 'Aberto'}</span></td>
      <td class="num">${i.resumo ? `${i.resumo.encontrados} de ${i.resumo.esperados}` : '–'}</td><td class="num">${i.resumo ? i.resumo.nao_encontrados : '–'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum inventário.</td></tr>'}</table></div></div>`;
  $$('[data-iv]', c).forEach(tr => tr.onclick = () => { ui.invAberto = tr.dataset.iv; inventario(c, root); });
  const n = $('#iv-novo', c); if (n) n.onclick = () => {
    const md = modal({ title: 'Novo inventário', body: `<form id="ivf"><div class="grid-form">
      <label class="span2">Descrição *<input name="descricao" required value="Inventário anual ${today().slice(0, 4)}"></label><label class="xs">Data de referência *<input type="date" name="data" required value="${today()}"></label>
      <label>Classe<select name="classe"><option value="">Todas</option>${D.K.map(k => `<option value="${k.id}">${esc(k.codigo)} · ${esc(k.nome)}</option>`).join('')}</select></label>
      <label>Centro de custo<select name="cc">${options(state.cad.cc, { empty: 'Todos' })}</select></label>
      <label>Local<select name="local"><option value="">Todos</option>${[...new Set(D.B.map(x => x.local).filter(Boolean))].sort().map(l => `<option>${esc(l)}</option>`).join('')}</select></label></div></form>`,
      foot: '<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ivf-ok">Abrir inventário</button>' });
    $('#ivf-ok', md.el).onclick = async () => {
      const f = $('#ivf', md.el); if (!f.reportValidity()) return;
      const filtro = {}; if (f.classe.value) filtro.classe_id = f.classe.value; if (f.cc.value) filtro.centro_custo_id = f.cc.value; if (f.local.value) filtro.local = f.local.value;
      try { const [r] = await q(sb.from('af_inventarios').insert({ empresa_id: state.empresa.id, descricao: f.descricao.value.trim(), data_inicio: f.data.value, filtro }).select()); md.close(); ui.invAberto = r.id; refazer(root); } catch (e) { fail(e); }
    };
  };
}
const escopoTxt = (f = {}) => [f.classe_id && `classe ${D.kById[f.classe_id]?.codigo || ''}`, f.centro_custo_id && `centro ${ccNome(f.centro_custo_id)}`, f.local && `local ${f.local}`].filter(Boolean).join(' · ') || 'Todos os bens';
export function noEscopo(b, iv) {
  const f = iv.filtro || {};
  return b.situacao !== 'baixado' && b.data_aquisicao <= iv.data_inicio && (!f.classe_id || b.classe_id === f.classe_id) && (!f.centro_custo_id || b.centro_custo_id === f.centro_custo_id) && (!f.local || b.local === f.local);
}
async function inventarioAberto(c, root, iv) {
  const itens = await q(sb.from('af_inventario_itens').select('*').eq('inventario_id', iv.id).order('conferido_em', { ascending: false }));
  const alvo = D.B.filter(b => noEscopo(b, iv)), achados = new Map(itens.filter(i => i.bem_id && i.encontrado).map(i => [i.bem_id, i]));
  const faltam = alvo.filter(b => !achados.has(b.id)), aberto = iv.situacao === 'aberto' && podeEditar();
  const link = `${location.origin}${location.pathname}#/contab/inventario?inv=${iv.id}`;
  c.innerHTML = `<div class="card"><div class="toolbar"><button class="btn small ghost" id="iv-volta">← Inventários</button><h3 style="margin:0">Inventário nº ${iv.numero} — ${esc(iv.descricao)}</h3>
      <span class="af-sel ${iv.situacao === 'concluido' ? 'pos' : 'warn'}">${iv.situacao === 'concluido' ? 'Concluído' : 'Aberto'}</span><span class="spacer"></span>
      <button class="btn small" id="iv-term">${iv.situacao === 'concluido' ? 'Termo do inventário' : 'Lista para conferência'}</button>${aberto ? '<button class="btn primary" id="iv-concl">Concluir</button>' : ''}</div>
    <div class="muted small">${esc(escopoTxt(iv.filtro))} · referência ${dateBR(iv.data_inicio)}</div>
    <div class="kpis" style="margin-top:12px">${kpi('Esperados', nf(alvo.length))}${kpi('Encontrados', nf(achados.size), pct(alvo.length ? [...achados.keys()].filter(id => alvo.some(b => b.id === id)).length / alvo.length : 0, 0), 'pos')}
      ${kpi('Faltam', nf(faltam.length), money0(faltam.reduce((s, b) => s + +b.valor_aquisicao, 0)) + ' de custo', faltam.length ? 'warn' : '')}${kpi('Sem cadastro', nf(itens.filter(i => !i.bem_id).length))}</div>
    ${aberto ? `<div class="toolbar" style="margin-top:12px"><input id="iv-ler" placeholder="Leia o QR ou digite a plaqueta e Enter" style="min-width:300px;font-size:16px" autofocus>
      <input id="iv-local" placeholder="Local onde está (opcional)" list="af-locais2"><datalist id="af-locais2">${[...new Set(D.B.map(x => x.local).filter(Boolean))].map(l => `<option value="${esc(l)}">`).join('')}</datalist>
      <select id="iv-estado">${Object.entries(I.ESTADOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>
      <button class="btn small" id="iv-semcad">+ Achado sem cadastro</button><span class="spacer"></span><a class="btn small ghost" href="${esc(link)}" target="_blank" title="${esc(link)}">📱 Abrir no celular</a></div>` : ''}</div>
    <div class="af-grid2" style="margin-top:12px">
      <div class="card"><h4 style="margin-top:0">Faltam conferir (${faltam.length})</h4><div class="table-wrap" style="max-height:420px"><table><tr><th>Bem</th><th>Local esperado</th><th></th></tr>
        ${faltam.map(b => `<tr><td class="wrap"><span class="af-plaq" style="font-size:12px">${esc(b.plaqueta)}</span> ${esc(b.descricao)}</td><td class="small">${esc(b.local || '—')}</td><td>${aberto ? `<button class="btn small" data-achei="${b.id}">Encontrado</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Todos conferidos. 🎉</td></tr>'}</table></div></div>
      <div class="card"><h4 style="margin-top:0">Conferidos (${itens.length})</h4><div class="table-wrap" style="max-height:420px"><table><tr><th>Bem</th><th>Local / estado</th><th>Por</th></tr>
        ${itens.map(i => { const b = D.bById[i.bem_id]; const div = b && i.local_encontrado && b.local !== i.local_encontrado; const fora = b && !noEscopo(b, iv);
          return `<tr><td class="wrap">${b ? `<span class="af-plaq" style="font-size:12px">${esc(b.plaqueta)}</span> ${esc(b.descricao)}` : `<i>Sem cadastro:</i> ${esc(i.descricao || '')}`}${fora ? ' <span class="af-sel warn">fora do escopo</span>' : ''}</td>
          <td class="small wrap-m">${esc(i.local_encontrado || '')} · ${I.ESTADOS[i.estado] || ''}${div ? `<div><span class="af-sel warn" title="cadastro: ${esc(b.local || '—')}">local diferente (cadastro: ${esc(b.local || '—')})</span></div>` : ''}</td><td class="small">${esc(i.conferido_por || '')}<div class="muted">${String(i.conferido_em).slice(11, 16)}</div></td></tr>`; }).join('') || '<tr><td colspan="3" class="empty">Nada conferido ainda.</td></tr>'}</table></div></div></div>`;
  $('#iv-volta', c).onclick = () => { ui.invAberto = null; inventario(c, root); };
  $('#iv-term', c).onclick = () => termoInventario(iv, itens);
  const registrar = async (bem, extra = {}) => {
    const reg = { encontrado: true, local_encontrado: $('#iv-local', c)?.value.trim() || bem?.local || null, estado: $('#iv-estado', c)?.value || 'bom', ...extra };
    const ja = bem && itens.find(i => i.bem_id === bem.id);
    try { if (ja) await q(sb.from('af_inventario_itens').update(reg).eq('id', ja.id));
      else await q(sb.from('af_inventario_itens').insert({ empresa_id: state.empresa.id, inventario_id: iv.id, bem_id: bem?.id || null, ...reg }));
      toast(bem ? `✔ ${bem.plaqueta} ${bem.descricao}` : 'Registrado'); inventarioAberto(c, root, iv); } catch (e) { fail(e); }
  };
  const ler = $('#iv-ler', c); if (ler) { ler.focus(); ler.onkeydown = (e) => {
    if (e.key !== 'Enter') return; const cod = I.lerCodigo(ler.value); ler.value = ''; if (!cod) return;
    const bem = D.B.find(b => cod.plaqueta ? b.plaqueta === cod.plaqueta : b.numero === cod.numero);
    if (!bem) return toast('Plaqueta não cadastrada', true); if (bem.situacao === 'baixado') return toast(`${bem.plaqueta} está baixado (${dateBR(bem.baixa_data)})`, true);
    registrar(bem);
  }; }
  $$('[data-achei]', c).forEach(b => b.onclick = () => registrar(D.bById[b.dataset.achei]));
  const sc = $('#iv-semcad', c); if (sc) sc.onclick = () => { const d = prompt('Descreva o bem encontrado sem plaqueta/cadastro:'); if (d?.trim()) registrar(null, { descricao: d.trim() }); };
  const co = $('#iv-concl', c); if (co) co.onclick = async () => {
    if (!await confirmDialog(`Concluir o inventário? Faltam ${faltam.length} bem(ns). O resultado entra no histórico dos bens encontrados.`)) return;
    try { await q(sb.rpc('af_concluir_inventario', { p_inventario: iv.id })); toast('Inventário concluído'); await carregar(); const iv2 = D.Iv.find(i => i.id === iv.id); termoInventario(iv2, itens); inventario(c, root); } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- Créditos fiscais (CIAP e PIS/COFINS)
async function creditos(c) {
  const m = ui.credMes, fatores = D.P.ciap_fatores || {}, fimPis = I.mesDe(D.P.pis_cofins_ate || '2026-12-31');
  const ciap = D.B.map(b => { const k = D.kById[b.classe_id], usa = b.ciap ?? k?.ciap; if (!usa) return null; const p = I.ciapParcelas(b, { ate: m, fatores }).find(x => x.mes === m); return p ? { b, p } : null; }).filter(Boolean);
  const pis = D.B.map(b => { const k = D.kById[b.classe_id], met = b.credito_pis_cofins || k?.credito_pis_cofins; const p = I.pisCofinsParcelas(b, met, { deps: D.Dp, ate: m, fim: fimPis }).find(x => x.mes === m); return p ? { b, met, p } : null; }).filter(Boolean);
  const tc = ciap.reduce((s, x) => s + x.p.credito, 0), tp = pis.reduce((s, x) => s + x.p.credito, 0);
  c.innerHTML = `<div class="card toolbar"><label>Mês <input type="month" id="cr-mes" value="${m}"></label>
      <label>Fator do CIAP <input id="cr-fator" inputmode="decimal" style="width:90px" value="${fatores[m] != null ? nf(fatores[m], 4) : ''}" placeholder="1,0000" ${podeEditar() ? '' : 'disabled'}></label>
      <button class="btn small" id="cr-sug">Sugerir pelas NF-e de saída</button>${podeEditar() ? '<button class="btn small primary" id="cr-salva">Salvar fator</button>' : ''}
      <span class="spacer"></span><button class="btn small" id="cr-imp">Relatório do mês</button></div>
    <div class="kpis" style="margin-top:12px">${kpi('Crédito de ICMS (CIAP)', money(tc), `${ciap.length} bens · fator ${nf(fatores[m] ?? 1, 4)}`)}${kpi('Crédito de PIS/COFINS (9,25%)', money(tp), m > fimPis ? 'PIS/COFINS encerrado (CBS a partir de 2027)' : `${pis.length} bens`)}</div>
    <div class="af-grid2" style="margin-top:12px">
      <div class="card"><h4 style="margin-top:0">CIAP — ${mesBR(m)}</h4><div class="table-wrap" style="max-height:420px"><table><tr><th>Bem</th><th class="num">ICMS</th><th class="num">Parcela</th><th class="num">Crédito</th></tr>
        ${ciap.map(({ b, p }) => `<tr><td class="wrap"><span class="af-plaq" style="font-size:12px">${esc(b.plaqueta)}</span> ${esc(b.descricao)}</td><td class="num">${money(b.icms_credito)}</td><td class="num">${p.parcela}/48</td><td class="num">${money(p.credito)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum bem com CIAP neste mês.</td></tr>'}</table></div></div>
      <div class="card"><h4 style="margin-top:0">PIS/COFINS — ${mesBR(m)}</h4><div class="table-wrap" style="max-height:420px"><table><tr><th>Bem<div class="small">Método</div></th><th class="num">Base</th><th class="num">Crédito</th></tr>
        ${pis.map(({ b, met, p }) => `<tr><td class="wrap"><span class="af-plaq" style="font-size:12px">${esc(b.plaqueta)}</span> ${esc(b.descricao)}<div class="small muted">${I.CREDITOS[met]}</div></td><td class="num">${money(p.base)}</td><td class="num">${money(p.credito)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhum crédito neste mês.</td></tr>'}</table></div></div></div>
    <div class="card muted small" style="margin-top:12px">Bases: CIAP — LC 87/1996, art. 20, § 5º (1/48 por mês × saídas tributadas ÷ total das saídas; a baixa antes de 48 meses cancela o saldo).
      PIS/COFINS — Lei 10.637/2002 e Lei 10.833/2003, art. 3º, VI (sobre a depreciação ou em 48 meses) e Lei 11.774/2008, art. 1º, XII (imediato para máquinas e equipamentos da produção adquiridos desde 07/2012; não alcança veículos — SC Cosit 215/2017).
      A LC 214/2025 substitui o PIS/COFINS pela CBS a partir de 2027 (o art. 1º da Lei 11.774 é revogado). É um controle de apoio: a apuração oficial continua com a contabilidade.</div>`;
  $('#cr-mes', c).onchange = (e) => { ui.credMes = e.target.value; creditos(c); };
  $('#cr-sug', c).onclick = async () => {
    try {
      const notas = await fetchAll(() => sb.from('nfe_notas').select('id').eq('empresa_id', state.empresa.id).eq('tipo', 'saida').eq('emissao_propria', true).eq('situacao', 'autorizada').gte('emissao', `${m}-01`).lte('emissao', I.fimDoMes(m)).order('id'));
      if (!notas.length) return toast('Sem NF-e de saída importadas neste mês', true);
      const itens = []; for (let i = 0; i < notas.length; i += 150) itens.push(...await fetchAll(() => sb.from('nfe_itens').select('cfop,vprod,vdesc,v_icms').in('nota_id', notas.slice(i, i + 150).map(n => n.id)).order('id')));
      $('#cr-fator', c).value = nf(I.fatorCiap(itens), 4); toast(`Fator sugerido com ${notas.length} notas e ${itens.length} itens. Confira com a apuração antes de salvar.`);
    } catch (e) { fail(e); }
  };
  const sv = $('#cr-salva', c); if (sv) sv.onclick = async () => {
    const v = $('#cr-fator', c).value.trim(), fs = { ...fatores }; if (v) fs[m] = Math.min(1, Math.max(0, parseNum(v))); else delete fs[m];
    try { await q(sb.from('af_parametros').upsert({ empresa_id: state.empresa.id, ciap_fatores: fs })); toast('Fator salvo'); await carregar(); creditos(c); } catch (e) { fail(e); }
  };
  $('#cr-imp', c).onclick = () => abrirRelatorio({ nome: 'Créditos do imobilizado', titulo: 'CRÉDITOS FISCAIS DO ATIVO IMOBILIZADO', subtitulo: `${mesBR(m)} · CIAP e PIS/COFINS`,
    corpo: `<h2>1. CIAP — ICMS (fator ${nf(fatores[m] ?? 1, 4)})</h2>${tabelaHTML(['Plaqueta', 'Bem', 'Aquisição', 'ICMS', 'Parcela', 'Crédito'], ciap.map(({ b, p }) => [b.plaqueta, esc(b.descricao), dateBR(b.data_aquisicao), money(b.icms_credito), `${p.parcela}/48`, money(p.credito)]), ['', '', '', '', 'Total', money(tc)], [3, 5])}
      <h2>2. PIS/COFINS (9,25%)</h2>${tabelaHTML(['Plaqueta', 'Bem', 'Método', 'Base', 'Crédito'], pis.map(({ b, met, p }) => [b.plaqueta, esc(b.descricao), I.CREDITOS[met], money(p.base), money(p.credito)]), ['', '', '', 'Total', money(tp)], [3, 4])}
      <p class="nota">Controle de apoio para a contabilidade. Bases: LC 87/1996, art. 20, § 5º; Leis 10.637/2002 e 10.833/2003, art. 3º, VI; Lei 11.774/2008, art. 1º, XII.</p>`,
    rodape: 'Base: cadastro do imobilizado e depreciações gravadas na plataforma' });
}

// ---------------------------------------------------------------- Relatórios
function relatorios(c) {
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">Relatórios do imobilizado</h3>
    <div class="grid-form" style="max-width:820px"><label class="xs">Posição em<input type="date" id="rl-data" value="${ui.relData}"></label><label class="xs">Período de<input type="month" id="rl-de" value="${ui.relDe}"></label>
      <label class="xs">até<input type="month" id="rl-ate" value="${ui.relAte}"></label></div>
    <div class="table-wrap" style="margin-top:12px"><table>
      ${[['razao', 'Razão auxiliar do imobilizado', 'Bem a bem por classe na data: custo, depreciação acumulada e valor líquido (posição).'],
         ['mov', 'Quadro de movimentação', 'Por classe no período: saldo inicial, adições, baixas, depreciação e saldo final — o quadro da nota explicativa (CPC 27).'],
         ['mapa', 'Mapa de depreciação do mês', 'Depreciação do último mês do período por classe e por centro de custo, contábil × fiscal.'],
         ['conf', 'Conferência com a contabilidade', 'Custo e depreciação acumulada do controle × saldo das contas contábeis na data.'],
         ['totdep', 'Totalmente depreciados ainda em uso', 'Bens com valor líquido zerado (ou no residual) que continuam em uso: rever a vida útil.'],
         ['baixas', 'Baixas do período', 'Bens baixados no período com tipo, valor da venda, valor líquido e resultado.']].map(([k, t, d]) => `<tr><td style="width:280px"><b>${t}</b></td><td class="wrap muted small">${d}</td><td><button class="btn small" data-r="${k}">Gerar</button></td></tr>`).join('')}</table></div></div>`;
  $('#rl-data', c).onchange = (e) => { ui.relData = e.target.value; };
  $('#rl-de', c).onchange = (e) => { ui.relDe = e.target.value; };
  $('#rl-ate', c).onchange = (e) => { ui.relAte = e.target.value; };
  $$('[data-r]', c).forEach(b => b.onclick = () => ({ razao: razaoAuxiliar, mov: quadroMovimentacao, mapa: () => mapaDepreciacao(ui.relAte), conf: conferenciaContabil, totdep: totalmenteDepreciados, baixas: relBaixas })[b.dataset.r]());
}
function tabelaHTML(cab, linhas, total = null, numCols = []) {
  const td = (v, i) => `<td${numCols.includes(i) ? ' class="num"' : ''}>${v ?? ''}</td>`;
  return `<table><thead><tr>${cab.map((h, i) => `<th${numCols.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map(td).join('')}</tr>`).join('') || `<tr><td colspan="${cab.length}">Nenhum registro.</td></tr>`}
    ${total ? `<tr class="total">${total.map(td).join('')}</tr>` : ''}</tbody></table>`;
}
const CSS_REL = '.num{text-align:right;white-space:nowrap} tr.total td{font-weight:700;border-top:1px solid #000} .nota{font-size:9pt;font-style:italic} .ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:60px} .ass div{border-top:1px solid #000;padding-top:4px;text-align:center;font-size:10pt}';
function razaoAuxiliar() {
  const ate = I.mesDe(ui.relData);
  const bs = D.B.filter(b => b.data_aquisicao <= ui.relData && !(b.baixa_data && b.baixa_data <= ui.relData));
  let tg = [0, 0];
  const corpo = D.K.map(k => { const L = bs.filter(b => b.classe_id === k.id); if (!L.length) return '';
    const t = [0, 0]; const linhas = L.map(b => { const p = I.posicao(b, D.Dp, ate); t[0] += p.custo; t[1] += p.acum; return [b.plaqueta, esc(b.descricao), dateBR(b.data_aquisicao), esc(ccNome(b.centro_custo_id)), money(p.custo), money(p.acum), money(p.vcl)]; });
    tg = [tg[0] + t[0], tg[1] + t[1]];
    return `<h2>${esc(k.codigo)} — ${esc(k.nome)} <span style="font-weight:400;font-size:10pt">(taxa fiscal ${nf(k.taxa_fiscal, 2)}% a.a.)</span></h2>${tabelaHTML(['Plaqueta', 'Bem', 'Aquisição', 'Centro de custo', 'Custo', 'Depr. acumulada', 'Valor líquido'], linhas, ['', `${L.length} bens`, '', 'Total da classe', money(t[0]), money(t[1]), money(t[0] - t[1])], [4, 5, 6])}`; }).join('');
  abrirRelatorio({ nome: 'Razão auxiliar do imobilizado', titulo: 'RAZÃO AUXILIAR DO ATIVO IMOBILIZADO', subtitulo: `Posição em ${dateBR(ui.relData)} (depreciação gravada até ${mesBR(ate)})`, paisagem: true, extraCss: CSS_REL,
    corpo: `${corpo}<h2>Total geral</h2>${tabelaHTML(['', 'Custo', 'Depreciação acumulada', 'Valor líquido'], [['Bens em uso', money(tg[0]), money(tg[1]), money(tg[0] - tg[1])]], null, [1, 2, 3])}`,
    rodape: `Base: cadastro do imobilizado e depreciações gravadas na plataforma (${D.ult ? 'último mês calculado ' + mesBR(D.ult) : 'nenhum mês calculado'})` });
}
function quadroMovimentacao() {
  const L = I.movimentacao(D.B, D.Dp, D.K, { de: ui.relDe, ate: ui.relAte }), s = (k) => L.reduce((t, l) => t + l[k], 0);
  abrirRelatorio({ nome: 'Movimentação do imobilizado', titulo: 'QUADRO DE MOVIMENTAÇÃO DO ATIVO IMOBILIZADO', subtitulo: `${mesBR(ui.relDe)} a ${mesBR(ui.relAte)}`, paisagem: true, extraCss: CSS_REL,
    corpo: `<h2>1. Custo</h2>${tabelaHTML(['Classe', 'Saldo inicial', 'Adições', 'Baixas', 'Saldo final'], L.map(l => [esc(l.classe), money(l.custoIni), money(l.adicoes), money(l.baixasCusto ? -l.baixasCusto : 0), money(l.custoFim)]), ['Total', money(s('custoIni')), money(s('adicoes')), money(-s('baixasCusto')), money(s('custoFim'))], [1, 2, 3, 4])}
      <h2>2. Depreciação acumulada</h2>${tabelaHTML(['Classe', 'Saldo inicial', 'Depreciação do período', 'Baixas', 'Saldo final'], L.map(l => [esc(l.classe), money(l.depIni), money(l.depMes), money(l.depBaixas ? -l.depBaixas : 0), money(l.depFim)]), ['Total', money(s('depIni')), money(s('depMes')), money(-s('depBaixas')), money(s('depFim'))], [1, 2, 3, 4])}
      <h2>3. Valor contábil líquido</h2>${tabelaHTML(['Classe', 'Inicial', 'Final', 'Taxa fiscal'], L.map(l => [esc(l.classe), money(l.vclIni), money(l.vclFim), nf(D.kById[l.classe_id]?.taxa_fiscal, 2) + '% a.a.']), ['Total', money(s('vclIni')), money(s('vclFim')), ''], [1, 2])}
      <p class="nota">Método linear. Vida útil contábil revista conforme CPC 27; taxas fiscais do Anexo III da IN RFB 1.700/2017.</p>`,
    rodape: 'Base: cadastro do imobilizado e depreciações gravadas na plataforma' });
}
function mapaDepreciacao(m) {
  const ds = D.Dp.filter(d => I.mesDe(d.competencia) === m);
  const porK = {}, porCC = {};
  for (const d of ds) { const b = D.bById[d.bem_id], k = b?.classe_id; (porK[k] ||= [0, 0, 0]); porK[k][0]++; porK[k][1] += +d.valor; porK[k][2] += +d.valor_fiscal; const cc = d.centro_custo_id || ''; porCC[cc] = (porCC[cc] || 0) + +d.valor; }
  const tot = ds.reduce((s, d) => s + +d.valor, 0), totf = ds.reduce((s, d) => s + +d.valor_fiscal, 0), calc = D.C.find(x => I.mesDe(x.competencia) === m);
  abrirRelatorio({ nome: 'Mapa de depreciação', titulo: 'MAPA DE DEPRECIAÇÃO', subtitulo: `${mesBR(m)}${calc ? ` · ${calc.situacao === 'fechado' ? 'mês fechado' : 'mês calculado, não fechado'}` : ' · mês não calculado'}`, extraCss: CSS_REL,
    corpo: `<h2>1. Por classe</h2>${tabelaHTML(['Classe', 'Bens', 'Contábil', 'Fiscal', 'Diferença'], Object.entries(porK).map(([k, v]) => [esc(classeTxt(k)), v[0], money(v[1]), money(v[2]), money(v[2] - v[1])]), ['Total', ds.length, money(tot), money(totf), money(totf - tot)], [1, 2, 3, 4])}
      <h2>2. Por centro de custo</h2>${tabelaHTML(['Centro de custo', 'Depreciação', '% do total'], Object.entries(porCC).sort((a, b) => b[1] - a[1]).map(([k, v]) => [esc(ccNome(k) || 'Sem centro de custo'), money(v), pct(tot ? v / tot : 0, 1)]), ['Total', money(tot), '100,0%'], [1, 2])}
      <h2>3. Bem a bem</h2>${tabelaHTML(['Plaqueta', 'Bem', 'Fração', 'Quota', 'Acumulada', 'Fiscal'], ds.map(d => { const b = D.bById[d.bem_id]; return [b?.plaqueta, esc(b?.descricao), nf(d.meses, 2), money(d.valor), money(d.acumulada), money(d.valor_fiscal)]; }), null, [2, 3, 4, 5])}
      <p class="nota">Diferença fiscal × contábil: ajuste no LALUR/LACS (adição quando a contábil é maior; exclusão quando a fiscal é maior, conforme a legislação).</p>`,
    rodape: 'Base: depreciações gravadas na plataforma' });
}
async function conferenciaContabil() {
  try {
    const d = ui.relData, ini = `${d.slice(0, 4)}-01-01`;
    const sal = await q(sb.rpc('contab_balancete_gerencial', { p_empresa: state.empresa.id, p_ini: ini, p_fim: d }));
    const sById = Object.fromEntries(sal.map(s => [s.conta_id, +s.saldo_atual]));
    const bs = D.B.filter(b => b.data_aquisicao <= d && !(b.baixa_data && b.baixa_data <= d)), ate = I.mesDe(d);
    const ctl = {}; for (const b of bs) { const k = D.kById[b.classe_id], p = I.posicao(b, D.Dp, ate);
      if (k?.conta_ativo_id) ctl[k.conta_ativo_id] = (ctl[k.conta_ativo_id] || 0) + p.custo; if (k?.conta_deprec_id) ctl[k.conta_deprec_id] = (ctl[k.conta_deprec_id] || 0) - p.acum; }
    const linhas = Object.entries(ctl).map(([id, v]) => { const s = sById[id] ?? 0; return [esc(nomeConta(id)), money(Math.abs(v)), money(Math.abs(s)), Math.abs(v - s) < 0.01 ? 'Confere' : `<b>${money(Math.abs(v) - Math.abs(s))}</b>`]; });
    const semConta = bs.filter(b => !D.kById[b.classe_id]?.conta_ativo_id);
    abrirRelatorio({ nome: 'Conferência do imobilizado', titulo: 'CONFERÊNCIA DO IMOBILIZADO COM A CONTABILIDADE', subtitulo: `Posição em ${dateBR(d)}`, extraCss: CSS_REL,
      corpo: `<h2>1. Controle × saldo contábil</h2>${tabelaHTML(['Conta contábil', 'Controle (bens)', 'Saldo contábil', 'Diferença'], linhas, null, [1, 2, 3])}
        ${semConta.length ? `<p><b>${semConta.length} bem(ns)</b> em classe sem conta contábil (${money(semConta.reduce((s, b) => s + +b.valor_aquisicao, 0))}) não entram na conferência.</p>` : ''}
        <p class="nota">O saldo contábil vem do balancete gerencial da plataforma (saldo de abertura + lançamentos gerados: financeiro, notas e depreciação). Diferença costuma ser bem não cadastrado, compra lançada em outra conta, baixa sem cálculo do mês ou saldo de abertura desatualizado.</p>`,
      rodape: 'Base: cadastro do imobilizado e balancete gerencial da plataforma' });
  } catch (e) { fail(e); }
}
function totalmenteDepreciados() {
  const L = D.B.filter(b => b.situacao !== 'baixado' && D.kById[b.classe_id]?.deprecia && D.pos[b.id].vcl <= (+b.valor_residual || 0) + 0.005);
  abrirRelatorio({ nome: 'Bens totalmente depreciados', titulo: 'BENS TOTALMENTE DEPRECIADOS AINDA EM USO', subtitulo: `${L.length} bens · posição do último mês calculado`, extraCss: CSS_REL,
    corpo: `${tabelaHTML(['Plaqueta', 'Bem', 'Classe', 'Aquisição', 'Custo', 'Local'], L.map(b => [b.plaqueta, esc(b.descricao), esc(D.kById[b.classe_id]?.codigo), dateBR(b.data_aquisicao), money(b.valor_aquisicao), esc(b.local || '')]), null, [4])}
      <p class="nota">O CPC 27 pede revisão da vida útil e do valor residual pelo menos no fim de cada exercício. Bem totalmente depreciado e ainda produtivo indica vida útil estimada curta demais.</p>`,
    rodape: 'Base: cadastro do imobilizado' });
}
function relBaixas() {
  const L = D.B.filter(b => b.baixa_data && I.mesDe(b.baixa_data) >= ui.relDe && I.mesDe(b.baixa_data) <= ui.relAte);
  const linhas = L.map(b => { const p = I.posicao(b, D.Dp, I.mesDe(b.baixa_data)); return { b, p, res: (+b.baixa_valor || 0) - p.vcl }; });
  abrirRelatorio({ nome: 'Baixas do imobilizado', titulo: 'BAIXAS DO ATIVO IMOBILIZADO', subtitulo: `${mesBR(ui.relDe)} a ${mesBR(ui.relAte)}`, paisagem: true, extraCss: CSS_REL,
    corpo: `${tabelaHTML(['Data', 'Plaqueta', 'Bem', 'Tipo', 'Custo', 'Depr. acumulada', 'Valor líquido', 'Venda', 'Resultado'],
      linhas.map(({ b, p, res }) => [dateBR(b.baixa_data), b.plaqueta, esc(b.descricao), I.BAIXAS[b.baixa_tipo], money(p.custo), money(p.acum), money(p.vcl), money(b.baixa_valor || 0), money(res)]),
      ['', '', `${L.length} bens`, 'Total', money(linhas.reduce((s, x) => s + x.p.custo, 0)), money(linhas.reduce((s, x) => s + x.p.acum, 0)), money(linhas.reduce((s, x) => s + x.p.vcl, 0)), money(linhas.reduce((s, x) => s + (+x.b.baixa_valor || 0), 0)), money(linhas.reduce((s, x) => s + x.res, 0))], [4, 5, 6, 7, 8])}
      <p class="nota">Resultado = valor da venda − valor contábil líquido na baixa (ganho ou perda de capital, resultado não operacional).</p>`,
    rodape: 'Base: cadastro do imobilizado e depreciações gravadas na plataforma' });
}
function imprimirFicha(b, deps, mov) {
  const p = D.pos[b.id];
  abrirRelatorio({ nome: 'Ficha do bem', titulo: `FICHA DO BEM ${b.plaqueta}`, subtitulo: esc(b.descricao), extraCss: CSS_REL,
    corpo: `<h2>1. Identificação</h2>${tabelaHTML(['Campo', 'Valor'], [['Classe', esc(classeTxt(b.classe_id))], ['Marca / modelo / série', esc([b.marca, b.modelo, b.serie].filter(Boolean).join(' · '))], ['Centro de custo / local', esc([ccNome(b.centro_custo_id), b.local].filter(Boolean).join(' · '))],
      ['Responsável', esc(b.responsavel || '')], ['Fornecedor / NF', esc([favNome(b.favorecido_id), b.nf_numero].filter(Boolean).join(' · NF '))], ['Aquisição / início de uso', `${dateBR(b.data_aquisicao)} / ${dateBR(b.data_inicio_uso) || '—'}`],
      ['Custo / residual', `${money(b.valor_aquisicao)} / ${money(b.valor_residual)}`], ['Vida útil / taxa fiscal', `${b.vida_util_meses} meses / ${nf(b.taxa_fiscal, 2)}% a.a.`], ['Depreciação acumulada / valor líquido', `${money(p.acum)} / ${money(p.vcl)}`], ['Situação', I.selo(b, p).txt]])}
      <h2>2. Depreciação</h2>${tabelaHTML(['Mês', 'Quota', 'Acumulada', 'Fiscal'], deps.map(d => [mesBR(I.mesDe(d.competencia)), money(d.valor), money(d.acumulada), money(d.valor_fiscal)]), null, [1, 2, 3])}
      <h2>3. Histórico</h2>${tabelaHTML(['Data', 'Tipo', 'Observação', 'Usuário'], mov.map(m => [dateBR(m.data), m.tipo, esc(m.observacao || ''), esc(m.usuario || '')]))}`, rodape: 'Base: cadastro do imobilizado' });
}
function termoBaixa(b) {
  const p = I.posicao(b, D.Dp);
  abrirRelatorio({ nome: 'Termo de baixa', titulo: 'TERMO DE BAIXA DE BEM DO ATIVO IMOBILIZADO', subtitulo: `${b.plaqueta} — ${esc(b.descricao)}`, extraCss: CSS_REL,
    corpo: `<h2>1. Bem</h2>${tabelaHTML(['Campo', 'Valor'], [['Plaqueta', b.plaqueta], ['Descrição', esc(b.descricao)], ['Classe', esc(classeTxt(b.classe_id))], ['Série', esc(b.serie || '')], ['Aquisição', `${dateBR(b.data_aquisicao)} · ${money(b.valor_aquisicao)}`],
      ['Depreciação acumulada até o último mês calculado', money(p.acum)], ['Valor contábil líquido', money(p.vcl)]])}
      <h2>2. Baixa</h2>${tabelaHTML(['Campo', 'Valor'], [['Data', dateBR(b.baixa_data)], ['Tipo', I.BAIXAS[b.baixa_tipo]], ['Valor da venda', b.baixa_valor ? money(b.baixa_valor) : '—'], ['Motivo', esc(b.baixa_motivo || '')]])}
      <p>Declaramos que o bem acima foi baixado do ativo imobilizado da empresa pelo motivo descrito, com o registro contábil correspondente.</p>
      <div class="ass"><div>Responsável pelo patrimônio</div><div>Diretoria</div></div>`, rodape: 'Base: cadastro do imobilizado' });
}
function termoInventario(iv, itens) {
  const alvo = D.B.filter(b => noEscopo(b, iv)), ach = new Set(itens.filter(i => i.bem_id && i.encontrado).map(i => i.bem_id));
  const falt = alvo.filter(b => !ach.has(b.id)), div = itens.filter(i => { const b = D.bById[i.bem_id]; return b && i.local_encontrado && b.local !== i.local_encontrado; });
  const concl = iv.situacao === 'concluido';
  abrirRelatorio({ nome: concl ? 'Termo de inventário' : 'Lista de conferência', titulo: concl ? 'TERMO DE INVENTÁRIO FÍSICO DO ATIVO IMOBILIZADO' : 'LISTA PARA CONFERÊNCIA FÍSICA', subtitulo: `Inventário nº ${iv.numero} — ${esc(iv.descricao)} · ${dateBR(iv.data_inicio)}`, paisagem: !concl, extraCss: CSS_REL,
    corpo: concl ? `<h2>1. Resumo</h2>${tabelaHTML(['Item', 'Quantidade'], [['Bens esperados', alvo.length], ['Encontrados', alvo.filter(b => ach.has(b.id)).length], ['Não encontrados', falt.length], ['Encontrados em outro local', div.length], ['Achados sem cadastro', itens.filter(i => !i.bem_id).length], ['Em estado ruim ou inservível', itens.filter(i => ['ruim', 'inservivel'].includes(i.estado)).length]], null, [1])}
      <h2>2. Não encontrados</h2>${tabelaHTML(['Plaqueta', 'Bem', 'Local no cadastro', 'Custo', 'Valor líquido'], falt.map(b => [b.plaqueta, esc(b.descricao), esc(b.local || ''), money(b.valor_aquisicao), money(D.pos[b.id].vcl)]), ['', '', 'Total', money(falt.reduce((s, b) => s + +b.valor_aquisicao, 0)), money(falt.reduce((s, b) => s + D.pos[b.id].vcl, 0))], [3, 4])}
      <h2>3. Encontrados em outro local</h2>${tabelaHTML(['Plaqueta', 'Bem', 'Cadastro', 'Encontrado em'], div.map(i => { const b = D.bById[i.bem_id]; return [b.plaqueta, esc(b.descricao), esc(b.local || ''), esc(i.local_encontrado)]; }))}
      <h2>4. Achados sem cadastro</h2>${tabelaHTML(['Descrição', 'Local', 'Estado'], itens.filter(i => !i.bem_id).map(i => [esc(i.descricao || ''), esc(i.local_encontrado || ''), I.ESTADOS[i.estado] || '']))}
      <p class="nota">Providências: localizar ou baixar (perda) os não encontrados, atualizar o local dos bens e cadastrar os achados.</p><div class="ass"><div>Responsável pelo inventário</div><div>Diretoria</div></div>`
      : tabelaHTML(['✓', 'Plaqueta', 'Bem', 'Série', 'Local no cadastro', 'Observação'], alvo.sort((a, b) => (a.local || '').localeCompare(b.local || '') || a.numero - b.numero).map(b => ['☐', b.plaqueta, esc(b.descricao), esc(b.serie || ''), esc(b.local || ''), '']) ),
    rodape: 'Base: cadastro do imobilizado e conferências do inventário' });
}

// ---------------------------------------------------------------- Etiquetas patrimoniais com QR (A4, 3 × 8)
let qrLib = null;
async function qr() {
  if (qrLib) return qrLib;
  await new Promise((ok, err) => { const s = document.createElement('script'); s.src = new URL('../../vendor/qrcode-generator-1.4.4.js', import.meta.url).href; s.onload = ok; s.onerror = err; document.head.appendChild(s); });
  qrLib = window.qrcode; return qrLib;
}
export async function etiquetas(lista) {
  if (!lista.length) return toast('Nenhum bem para etiquetar', true);
  let gerar = null; try { const lib = await qr(); gerar = (t) => { const c = lib(0, 'M'); c.addData(t); c.make(); return c.createSvgTag({ cellSize: 2, margin: 0 }); }; } catch { gerar = null; }
  const base = `${location.origin}${location.pathname}`, w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas patrimoniais</title><style>
    @page{size:A4;margin:8mm 6mm} body{font-family:Arial,sans-serif;margin:0} .g{display:grid;grid-template-columns:repeat(3,66mm);grid-auto-rows:34mm;gap:0 0}
    .e{box-sizing:border-box;border:1px dashed #bbb;padding:2.5mm 3mm;display:grid;grid-template-columns:24mm 1fr;gap:2.5mm;align-items:center;overflow:hidden;break-inside:avoid}
    .e svg{width:24mm;height:24mm} .emp{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.3px} .p{font-family:monospace;font-size:13pt;font-weight:700;margin:1mm 0}
    .d{font-size:7.5pt;line-height:1.2;max-height:3.6em;overflow:hidden} .s{font-size:6.5pt;color:#444;margin-top:1mm}</style></head><body><div class="g">
    ${lista.map(b => `<div class="e"><div>${gerar ? gerar(I.qrConteudo(b.plaqueta, base)) : ''}</div><div><div class="emp">${esc(state.empresa.nome || '')} · Patrimônio</div><div class="p">${esc(b.plaqueta)}</div>
      <div class="d">${esc(b.descricao)}</div><div class="s">${esc([b.serie && 'S/N ' + b.serie, dateBR(b.data_aquisicao)].filter(Boolean).join(' · '))}</div></div></div>`).join('')}
    </div><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

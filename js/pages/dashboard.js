// Painéis › Meus Painéis (PAI005, antigo Dashboard) — melhoria 2.5 (SQL 104, 07/11/2026).
// Cada pessoa monta um ou mais painéis com os cartões que já existem (indicadores, gráficos, tabelas), escolhe o tamanho e
// a ordem. Um painel pode ser compartilhado com a empresa como modelo: os outros veem e copiam para si. Sem painel salvo,
// aparece o painel padrão "Visão do ano" (o Dashboard antigo). Os dados são carregados uma vez por painel e reaproveitados.
import { sb, state, q, matrizMensal, comRecompras, montarDRE, soma, z, temArea } from '../lib/data.js';
import { $, $$, esc, money, money0, pct, cls, dateBR, today, fail, toast, modal, chart, CORES, COR, MESES_CURTO, moneyTick } from '../lib/ui.js';
import { CARTOES, CARTAO, AREAS_CARTAO, disponiveis, validar, dadosDe, PADRAO, mover } from '../lib/paineis-cartoes.js';

export const title = 'Meus Painéis';
const ui = { atual: null, editando: false };
const VIRTUAL = { id: 'padrao', nome: 'Visão do ano', cartoes: PADRAO, virtual: true };
const LS = () => `paineis-${state.empresa.id}`;
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS()) || '[]'); } catch { return []; } };
const lsSet = (v) => { try { localStorage.setItem(LS(), JSON.stringify(v)); } catch {} };
let semTabela = false;

async function listar() {
  try { const r = await q(sb.from('paineis').select('*').eq('empresa_id', state.empresa.id).order('ordem').order('criado_em')); semTabela = false; return r; }
  catch { semTabela = true; return lsGet().map(p => ({ ...p, dono: state.user?.id })); }
}
async function salvar(p) {
  const row = { nome: p.nome, cartoes: p.cartoes, compartilhado: !!p.compartilhado, atualizado_em: new Date().toISOString() };
  if (semTabela) { const L = lsGet(); const id = p.id && !p.virtual ? p.id : 'local-' + Date.now(); const i = L.findIndex(x => x.id === id); const novo = { ...L[i], ...row, id }; if (i >= 0) L[i] = novo; else L.push(novo); lsSet(L); return novo; }
  if (p.id && !p.virtual) { await q(sb.from('paineis').update(row).eq('id', p.id)); return { ...p, ...row }; }
  const [r] = await q(sb.from('paineis').insert({ ...row, empresa_id: state.empresa.id, dono: state.user.id, dono_nome: state.user.email?.split('@')[0], ordem: Date.now() % 1e9 }).select());
  return r;
}

export async function render(root, interno = false) {
  if (!interno) ui.editando = false;   // ao abrir a tela pelo menu, sai do modo de edição
  const todos = await listar(), eu = state.user?.id;
  const meus = todos.filter(p => p.dono === eu), modelos = todos.filter(p => p.dono !== eu && p.compartilhado);
  const lista = meus.length ? meus : [VIRTUAL];
  let P = [...lista, ...modelos].find(p => p.id === ui.atual) || lista[0];
  ui.atual = P.id;
  const meu = P.virtual || P.dono === eu;
  const cartoes = validar(P.cartoes, temArea, state.papel);
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Meus Painéis</h2><div class="muted small">Monte painéis com os indicadores, gráficos e tabelas que você mais acompanha. Ano dos dados financeiros: ${state.ano}.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${ui.editando ? '<button class="btn" id="pn-add">+ Adicionar cartão</button><button class="btn primary" id="pn-ok">Concluir</button>'
        : `${meu ? '<button class="btn" id="pn-ed">Editar painel</button>' : '<button class="btn primary" id="pn-cp">Copiar para mim</button>'}<button class="btn ghost" id="pn-novo">+ Novo painel</button>`}</div></div>
    <div class="card toolbar"><div class="chips" id="pn-lista">${lista.map(p => `<span class="chip ${p.id === P.id ? 'on' : ''}" data-p="${p.id}">${esc(p.nome)}${p.compartilhado ? ' ⇄' : ''}</span>`).join('')}</div>
      ${modelos.length ? `<span class="spacer"></span><label>Modelos da empresa<select id="pn-mod"><option value="">—</option>${modelos.map(p => `<option value="${p.id}" ${p.id === P.id ? 'selected' : ''}>${esc(p.nome)} · ${esc(p.dono_nome || '')}</option>`).join('')}</select></label>` : ''}</div>
    ${ui.editando ? `<div class="card toolbar" style="margin-top:8px;background:var(--surface-2)"><label>Nome<input id="pn-nome" value="${esc(P.virtual ? 'Meu painel' : P.nome)}" maxlength="60" style="max-width:260px"></label>
      <label class="chk" style="flex-direction:row;align-items:center;gap:6px;font-weight:400"><input type="checkbox" id="pn-comp" style="width:auto;min-height:0" ${P.compartilhado ? 'checked' : ''}> Compartilhar com a empresa como modelo</label>
      <span class="spacer"></span>${!P.virtual ? '<button class="btn danger small" id="pn-del">Excluir painel</button>' : ''}</div>
      <p class="small muted" style="margin:6px 0 0">Use ↑ ↓ para mudar a ordem, P · M · G para o tamanho (um terço, dois terços ou a largura toda) e ✕ para tirar o cartão. ${P.virtual ? 'Ao concluir, o painel padrão vira um painel seu.' : ''}</p>` : ''}
    ${!meu ? `<p class="small muted" style="margin:8px 0 0">Modelo compartilhado por ${esc(P.dono_nome || 'outra pessoa')}. Copie para você para poder mudar.</p>` : ''}
    ${semTabela ? '<p class="small muted" style="margin:8px 0 0">Os painéis estão guardados só neste navegador (falta o SQL 104 para valer em todos os aparelhos).</p>' : ''}
    <div class="pn-grade" id="pn-grade" style="margin-top:12px">${cartoes.map((c, i) => `<div class="pn-c t${c.tam}" data-i="${i}"><div class="card pn-card">
        <div class="card-head"><h2>${esc(tituloCartao(c))}</h2>${ui.editando ? `<span class="pn-ed">
          <button class="btn ghost small" data-mv="${i}|-1" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn ghost small" data-mv="${i}|1" ${i === cartoes.length - 1 ? 'disabled' : ''}>↓</button>
          ${[1, 2, 3].map(t => `<button class="btn ${c.tam === t ? 'primary' : 'ghost'} small" data-tam="${i}|${t}">${'PMG'[t - 1]}</button>`).join('')}
          ${c.t === 'ind_diretoria' ? `<button class="btn ghost small" data-cfg="${i}" title="Qual indicador">⚙</button>` : ''}<button class="btn ghost small" data-x="${i}">✕</button></span>` : ''}</div>
        <div class="pn-corpo"><div class="loading small">Carregando…</div></div></div></div>`).join('')
      || `<div class="card" style="grid-column:1/-1"><div class="empty">Painel vazio. ${meu ? 'Clique em <b>Editar painel</b> e depois em <b>Adicionar cartão</b>.' : ''}</div></div>`}</div>`;

  const re = () => render(root, true);
  $('#pn-lista', root).onclick = (e) => { const id = e.target.closest('[data-p]')?.dataset.p; if (id && id !== ui.atual) { ui.atual = id; ui.editando = false; re(); } };
  $('#pn-mod', root) && ($('#pn-mod', root).onchange = (e) => { if (e.target.value) { ui.atual = e.target.value; ui.editando = false; re(); } });
  $('#pn-novo', root) && ($('#pn-novo', root).onclick = async () => {
    const nome = prompt('Nome do novo painel', 'Meu painel'); if (!nome?.trim()) return;
    try { const r = await salvar({ nome: nome.trim().slice(0, 60), cartoes: [] }); ui.atual = r.id; ui.editando = true; re(); } catch (e) { fail(e); } });
  $('#pn-cp', root) && ($('#pn-cp', root).onclick = async () => {
    try { const r = await salvar({ nome: `${P.nome} (cópia)`.slice(0, 60), cartoes }); ui.atual = r.id; toast('Painel copiado para você'); re(); } catch (e) { fail(e); } });
  $('#pn-ed', root) && ($('#pn-ed', root).onclick = () => { ui.editando = true; re(); });

  if (ui.editando) {
    let C = cartoes.map(c => ({ ...c }));
    const grava = async (fim) => {
      const nome = $('#pn-nome', root).value.trim() || 'Meu painel';
      try { const r = await salvar({ ...P, nome, cartoes: C, compartilhado: $('#pn-comp', root).checked }); ui.atual = r.id; if (fim) { ui.editando = false; toast('Painel salvo'); } re(); } catch (e) { fail(e); }
    };
    $$('[data-mv]', root).forEach(b => b.onclick = () => { const [i, d] = b.dataset.mv.split('|').map(Number); C = mover(C, i, d); P = { ...P, cartoes: C }; grava(false); });
    $$('[data-tam]', root).forEach(b => b.onclick = () => { const [i, t] = b.dataset.tam.split('|').map(Number); C[i].tam = t; grava(false); });
    $$('[data-x]', root).forEach(b => b.onclick = () => { C.splice(+b.dataset.x, 1); grava(false); });
    $$('[data-cfg]', root).forEach(b => b.onclick = () => escolherIndicador(C[+b.dataset.cfg], () => grava(false)));
    $('#pn-add', root).onclick = () => adicionar((novo) => { C.push(novo); grava(false); });
    $('#pn-ok', root).onclick = () => grava(true);
    $('#pn-del', root) && ($('#pn-del', root).onclick = async () => {
      if (!confirm(`Excluir o painel "${P.nome}"?`)) return;
      try { if (semTabela) lsSet(lsGet().filter(x => x.id !== P.id)); else await q(sb.from('paineis').delete().eq('id', P.id)); ui.atual = null; ui.editando = false; toast('Painel excluído'); re(); } catch (e) { fail(e); } });
  }
  if (cartoes.length) await pintarCartoes(root, cartoes);
}

const tituloCartao = (c) => c.t === 'ind_diretoria' ? (NOMES_IND[c.cfg?.k] || 'Indicador') : CARTAO[c.t].nome;
const NOMES_IND = { caixa: 'Caixa disponível', faturamento: 'Faturamento líquido', margem: 'Margem EBITDA', producao: 'Produção', perdas: 'Perdas (apara e refugo)', qualidade: 'Reclamações de clientes', entregas: 'Entregas no prazo', rj: 'Recuperação judicial' };

function adicionar(depois) {
  const D = disponiveis(temArea, state.papel), grupos = [...new Set(D.map(c => c.area))];
  const m = modal({ title: 'Adicionar cartão', wide: true, body: grupos.map(g => `<h3 style="margin:10px 0 6px">${esc(AREAS_CARTAO[g])}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px">${D.filter(c => c.area === g).map(c => `<button class="btn" data-t="${c.t}" style="text-align:left;justify-content:flex-start;height:auto;white-space:normal;padding:10px 12px;display:block"><b>${esc(c.nome)}</b><div class="small muted" style="font-weight:400">${esc(c.desc)}</div></button>`).join('')}</div>`).join('') });
  $$('[data-t]', m.el).forEach(b => b.onclick = () => { const c = CARTAO[b.dataset.t]; m.close(); const novo = { t: c.t, tam: c.tam, ...(c.cfg ? { cfg: { ...c.cfg } } : {}) };
    if (c.t === 'ind_diretoria') escolherIndicador(novo, () => depois(novo)); else depois(novo); });
}
function escolherIndicador(c, depois) {
  const m = modal({ title: 'Qual indicador', narrow: true, body: `<label>Indicador<select id="ei-k">${Object.entries(NOMES_IND).map(([k, n]) => `<option value="${k}" ${c.cfg?.k === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ei-ok">OK</button>' });
  $('#ei-ok', m.el).onclick = () => { c.cfg = { ...(c.cfg || {}), k: $('#ei-k', m.el).value }; m.close(); depois(); };
}

// ---------------------------------------------------------------- dados (uma vez por painel)
async function carregarDados(chaves) {
  const out = {}, e = state.empresa.id;
  await Promise.all(chaves.map(async k => {
    try {
      if (k === 'fin') {
        const [m, saldoIni, saldos, abertos] = await Promise.all([
          matrizMensal(state.ano, 'Pago').then(m => comRecompras(m, state.ano, 'Pago')),
          q(sb.rpc('saldo_em', { p_empresa: e, p_data: `${state.ano}-01-01` })),
          q(sb.rpc('saldos_contas', { p_empresa: e })),
          q(sb.from('v_lancamentos').select('id,data,descricao,favorecido_nome,plano_nome,valor_sinal,tipo,conta_nome').eq('empresa_id', e).eq('status', 'Em aberto').order('data').limit(1000))]);
        out.fin = { m, saldoIni: +saldoIni, saldos, abertos, val: montarDRE(m).val };
      }
      if (k === 'dir') { const mod = await import(`./diretoria.js?v=${Date.now()}`); out.dir = await mod.carregarPainel(mod.mesAnterior()); }
      if (k === 'nec') { const mod = await import(`./necessidade-caixa.js?v=${Date.now()}`); out.nec = await mod.resumoNecessidade(); }
    } catch (err) { console.error(err); out[k] = { erro: err }; }
  }));
  return out;
}

async function pintarCartoes(root, cartoes) {
  const D = await carregarDados(dadosDe(cartoes));
  cartoes.forEach((c, i) => {
    const el = $(`[data-i="${i}"] .pn-corpo`, root); if (!el) return;
    const falta = (CARTAO[c.t].dados || []).find(k => !D[k] || D[k].erro);
    if (falta) { el.innerHTML = `<div class="empty small">${falta === 'dir' ? 'Sem os dados do Painel da Diretoria (SQL 101).' : 'Não foi possível carregar.'}</div>`; return; }
    try { R[c.t](el, D, c.cfg || {}); } catch (err) { console.error(err); el.innerHTML = '<div class="empty small">Não foi possível montar este cartão.</div>'; }
  });
}

// ---------------------------------------------------------------- cartões
const kpi = (rot, val, sub = '', c = '') => `<div class="pn-kpi"><div class="k-label">${rot}</div><div class="k-value ${c}">${val}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
const canvas = (el, alt = 240) => { el.innerHTML = `<div class="chart-box" style="height:${alt}px"><canvas></canvas></div>`; return $('canvas', el); };
const rotMes = (ym) => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+ym.slice(5) - 1] + '/' + ym.slice(2, 4);
const sumAbs = (arr) => arr.reduce((a, x) => a + Math.abs(+x.valor_sinal), 0);

const R = {
  kpi_saldo(el, { fin }) { const s = fin.saldos.filter(x => x.disponibilidade === 'Conta com recursos disponíveis').reduce((a, x) => a + +x.saldo_pago, 0);
    el.innerHTML = kpi('Disponível hoje', money(s), `${fin.saldos.length} conta(s) · realizado`, cls(s)); },
  kpi_entradas_saidas(el, { fin }) { el.innerHTML = `<div class="pn-kpis">${kpi(`Entradas ${state.ano}`, money0(soma(fin.m.tipo.E)), `receita bruta ${money0(soma(fin.val.receita_bruta))}`)}${kpi(`Saídas ${state.ano}`, money0(Math.abs(soma(fin.m.tipo.S))))}</div>`; },
  kpi_resultado(el, { fin }) { const r = soma(fin.val.receita_bruta), eb = soma(fin.val.ebitda), re = soma(fin.val.resultado);
    el.innerHTML = `<div class="pn-kpis">${kpi('EBITDA gerencial', money0(eb), `margem ${pct(r ? eb / r : null)}`, cls(eb))}${kpi('Resultado gerencial', money0(re), `margem ${pct(r ? re / r : null)}`, cls(re))}</div>`; },
  kpi_abertos(el, { fin }) { const h = today(), pag = fin.abertos.filter(a => a.tipo === 'S'), rec = fin.abertos.filter(a => a.tipo === 'E'), v = pag.filter(a => a.data < h), vr = rec.filter(a => a.data < h);
    el.innerHTML = `<div class="pn-kpis">${kpi('A pagar', money0(sumAbs(pag)), `${v.length} vencido(s): ${money0(sumAbs(v))}`, 'neg')}${kpi('A receber', money0(sumAbs(rec)), `${vr.length} vencido(s): ${money0(sumAbs(vr))}`, 'pos')}</div>`; },
  graf_entradas_saidas(el, { fin }) { const m = fin.m, res = z().map((_, i) => m.tipo.E[i] + m.tipo.S[i] + m.tipo.T[i]); let s = fin.saldoIni; const sf = res.map(v => s += v);
    chart(canvas(el), { type: 'bar', data: { labels: MESES_CURTO, datasets: [
      { label: 'Entradas', data: m.tipo.E, backgroundColor: COR.entrada, order: 2 }, { label: 'Saídas', data: m.tipo.S.map(Math.abs), backgroundColor: COR.saida, order: 2 },
      { type: 'line', label: 'Saldo final', data: sf, borderColor: COR.saldo, backgroundColor: COR.saldo, yAxisID: 'y2', tension: .25, order: 1 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: moneyTick } }, y2: { position: 'right', grid: { display: false }, ticks: { callback: moneyTick } } },
        plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw)}` } } } } }); },
  graf_composicao(el, { fin }) { const comp = state.cad.classes.filter(c => c.tipo === 'S').map(c => ({ l: c.label, v: Math.abs(soma(fin.m.classe[c.id] || z())) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const top = comp.slice(0, 7), resto = soma(comp.slice(7).map(x => x.v)); if (resto) top.push({ l: 'Demais', v: resto });
    if (!top.length) { el.innerHTML = '<div class="empty small">Sem saídas no ano.</div>'; return; }
    chart(canvas(el), { type: 'doughnut', data: { labels: top.map(x => x.l), datasets: [{ data: top.map(x => x.v), backgroundColor: CORES, borderWidth: 2, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (x) => `${x.label}: ${money(x.raw)} (${pct(x.raw / soma(top.map(t => t.v)))})` } } } } }); },
  graf_dre(el, { fin }) { const v = fin.val;
    chart(canvas(el), { type: 'bar', data: { labels: MESES_CURTO, datasets: [
      { label: 'Receita bruta', data: v.receita_bruta, backgroundColor: COR.entrada, order: 2 }, { label: 'EBITDA', data: v.ebitda, backgroundColor: COR.saldo, order: 2 },
      { type: 'line', label: 'Margem EBITDA', data: v.receita_bruta.map((r, i) => r ? Math.round(v.ebitda[i] / r * 1000) / 10 : null), borderColor: COR.saida, backgroundColor: COR.saida, yAxisID: 'y2', tension: .25, order: 1 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: moneyTick } }, y2: { position: 'right', grid: { display: false }, ticks: { callback: (x) => x + '%' } } },
        plugins: { tooltip: { callbacks: { label: (x) => x.dataset.yAxisID === 'y2' ? `Margem: ${x.raw ?? '—'}%` : `${x.dataset.label}: ${money(x.raw)}` } } } } }); },
  graf_necessidade(el, { nec }) { const S = nec.semanas || [];
    if (!S.length) { el.innerHTML = '<div class="empty small">Sem projeção.</div>'; return; }
    chart(canvas(el), { type: 'line', data: { labels: S.map(w => dateBR(w.ini).slice(0, 5)), datasets: [
      { label: 'Saldo projetado', data: S.map(w => w.saldo), borderColor: COR.saldo, backgroundColor: COR.saldo, tension: .25, fill: false, pointBackgroundColor: S.map(w => w.abaixo ? COR.saida : COR.saldo) },
      { label: 'Caixa mínimo', data: S.map(() => nec.minimo), borderColor: COR.saida, borderDash: [4, 4], pointRadius: 0 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: moneyTick } } }, plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw)}` } } } } });
    if (nec.primeira) el.insertAdjacentHTML('beforeend', `<div class="small neg" style="margin-top:4px">Abaixo do mínimo a partir da semana de ${dateBR(nec.primeira.ini)}.</div>`); },
  tab_saldos(el, { fin }) { const S = fin.saldos;
    el.innerHTML = `<div class="table-wrap"><table class="small"><thead><tr><th>Conta</th><th class="num">Saldo</th><th class="num">A receber</th><th class="num">A pagar</th></tr></thead><tbody>
      ${S.map(x => `<tr><td>${esc(x.nome)}${x.disponibilidade !== 'Conta com recursos disponíveis' ? ' <span class="badge vencido">bloqueada</span>' : ''}</td><td class="num ${cls(x.saldo_pago)}">${money(x.saldo_pago)}</td><td class="num">${money(x.a_receber)}</td><td class="num">${money(x.a_pagar)}</td></tr>`).join('')}
      <tr class="row-total"><td>Total</td><td class="num">${money(soma(S.map(x => +x.saldo_pago)))}</td><td class="num">${money(soma(S.map(x => +x.a_receber)))}</td><td class="num">${money(soma(S.map(x => +x.a_pagar)))}</td></tr></tbody></table></div>`; },
  tab_vencimentos(el, { fin }) { const h = today(), A = fin.abertos.slice(0, 12);
    el.innerHTML = A.length ? `<div class="table-wrap"><table class="small"><tbody>${A.map(a => `<tr><td class="nowrap">${dateBR(a.data)}${a.data < h ? ' <span class="badge vencido">vencido</span>' : ''}</td>
      <td class="wrap">${esc(a.favorecido_nome || a.plano_nome || '')}<div class="muted">${esc(a.descricao || '')}</div></td><td class="num ${cls(a.valor_sinal)}">${money(a.valor_sinal)}</td></tr>`).join('')}</tbody></table></div><a class="small" href="#/abertos">ver todos</a>` : '<div class="empty small">Nada em aberto.</div>'; },
  async ind_diretoria(el, { dir }, cfg) { const { SIT, fmt, fmtVar } = await import('../lib/diretoria-calc.js'); const i = dir.inds.find(x => x.k === cfg.k) || dir.inds[0];
    if (!i) { el.innerHTML = '<div class="empty small">Indicador escondido no Painel da Diretoria.</div>'; return; }
    const s = i.sit ? SIT[i.sit] : null;
    el.innerHTML = `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><span style="font-size:1.6em;font-weight:700">${fmt(i.valor, i.un)}</span><span class="small muted">meta ${fmt(i.meta, i.un)}</span>${s ? `<span class="badge ${s.cls}">${s.txt}</span>` : ''}</div>
      <div class="small muted">${rotMes(dir.ref)} · mês ant. ${fmtVar(i.varMes)} · ${esc(i.tend.txt)}</div><div class="chart-box" style="height:110px"><canvas></canvas></div>`;
    chart($('canvas', el), { type: 'line', data: { labels: dir.meses.map(rotMes), datasets: [{ label: i.nome, data: i.serie, borderColor: s ? s.cor : COR.saldo, tension: .25, pointRadius: 2 },
      { label: 'Meta', data: i.metas, borderColor: '#999', borderDash: [4, 4], pointRadius: 0 }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 } } } } }); },
  async resumo_diretoria(el, { dir }) { const { SIT, fmt } = await import('../lib/diretoria-calc.js');
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">${dir.inds.map(i => { const s = i.sit ? SIT[i.sit] : null;
      return `<a href="#/diretoria" style="color:inherit;text-decoration:none;border:1px solid var(--border);border-left:3px solid ${s ? s.cor : 'var(--border)'};border-radius:8px;padding:8px 10px"><div class="small muted">${esc(i.nome)}</div><b>${fmt(i.valor, i.un)}</b><div class="small">${s ? `<span class="badge ${s.cls}">${s.txt}</span>` : '<span class="muted">sem meta</span>'}</div></a>`; }).join('')}</div>
      <div class="small muted" style="margin-top:6px">${rotMes(dir.ref)} · <a href="#/diretoria">abrir o Painel da Diretoria</a></div>`; },
  graf_faturamento(el, { dir }) { const op = dir.op;
    chart(canvas(el), { type: 'bar', data: { labels: dir.meses.map(rotMes), datasets: [{ label: 'Vendas', data: op.fat_venda, backgroundColor: COR.entrada }, { label: 'Devoluções', data: op.fat_devolucao, backgroundColor: COR.saida }] },
      options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: moneyTick } } }, plugins: { tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw)}` } } } } }); },
  graf_producao(el, { dir }) { const op = dir.op;
    chart(canvas(el), { type: 'bar', data: { labels: dir.meses.map(rotMes), datasets: [{ label: 'Produção (kg)', data: op.prod_boa, backgroundColor: COR.entrada, order: 2 },
      { type: 'line', label: 'Refugo (%)', data: op.prod_boa.map((b, i) => +b + +op.prod_refugo[i] ? Math.round(op.prod_refugo[i] / (+b + +op.prod_refugo[i]) * 1000) / 10 : null), borderColor: COR.saida, backgroundColor: COR.saida, yAxisID: 'y2', order: 1 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y2: { position: 'right', grid: { display: false }, ticks: { callback: (x) => x + '%' } } } } }); },
  graf_qualidade(el, { dir }) { const op = dir.op;
    chart(canvas(el), { type: 'bar', data: { labels: dir.meses.map(rotMes), datasets: [{ label: 'RNC abertas no mês', data: op.rnc_mes, backgroundColor: COR.saldo }, { label: 'De clientes', data: op.rnc_cliente, backgroundColor: COR.saida },
      { type: 'line', label: 'Em aberto no fim do mês', data: op.rnc_em_aberto, borderColor: '#888' }] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false } } }); },
  graf_entregas(el, { dir }) { const op = dir.op;
    chart(canvas(el), { type: 'bar', data: { labels: dir.meses.map(rotMes), datasets: [{ label: 'Entregas', data: op.ent_entregues, backgroundColor: COR.entrada, order: 2 },
      { type: 'line', label: 'No prazo (%)', data: op.ent_medidas.map((m, i) => +m ? Math.round(op.ent_no_prazo[i] / m * 1000) / 10 : null), borderColor: COR.saldo, backgroundColor: COR.saldo, yAxisID: 'y2', order: 1 }] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y2: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: (x) => x + '%' } } } } }); },
};

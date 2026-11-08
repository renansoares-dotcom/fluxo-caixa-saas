// Produção › Programação Inteligente (PRD024) — melhoria 6.2 (SQL 121, 08/11/2026).
// O que impede cada OP de começar (arte, clichê, tinta, material, etapa anterior) e a sequência sugerida por máquina:
// a entrega manda e, dentro da janela, a ordem que menos troca de cor (do claro para o escuro). Ajuste manual (↑↓),
// datas previstas pelas horas do setor, aplicar a fila na máquina. Parâmetros na tela.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, dateBR, today, fail, toast, modal } from '../lib/ui.js';
import { cadProducao, podePCP } from '../lib/producao.js';
import { sequenciar, distribuir, troca } from '../lib/programacao-calc.js';

export const title = 'Programação Inteligente';
const ui = { maq: null, inicio: null, aba: 'fila', manual: null };
let D = null;
const CFG0 = { considerar_arte: true, considerar_cliche: true, considerar_tinta: true, considerar_material: true, troca_cor_min: 20, limpeza_escuro_claro_min: 40, janela_entrega_dias: 3, horizonte_dias: 21, setor_impressao_id: null };
const TIPO = { arte: 'Arte', cliche: 'Clichê', tinta: 'Tinta', material: 'Material', etapa: 'Etapa anterior' };
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + Math.round(min % 60) + ' min' : ''}` : `${Math.round(min)} min`);

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id;
    const [C, pr, cfg] = await Promise.all([cadProducao(true), q(sb.rpc('prod_prontidao', { p_empresa: e })), q(sb.from('prod_prog_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null)]);
    const ids = [...new Set(pr.map(x => x.ordem_id))];
    const [ops, ets] = ids.length ? await Promise.all([
      fetchAll(() => sb.from('prod_ordens').select('id,numero,numero_iniflex,codigo_produto,descricao,cliente,quantidade,unidade,entrega,prioridade').in('id', ids.slice(0, 900)).order('id')),
      fetchAll(() => sb.from('prod_ordem_etapas').select('id,ordem_id,seq,status,horas_previstas,qtd_prevista,inicio_previsto,ordem_maquina,maquina_id').in('ordem_id', ids.slice(0, 900)).order('id'))]) : [[], []];
    D = { C, pr, cfg: { ...CFG0, ...(cfg || {}) }, op: Object.fromEntries(ops.map(o => [o.id, o])), et: Object.fromEntries(ets.map(x => [x.id, x])) };
    const maqs = C.maquinas.filter(m => m.ativo);
    if (!ui.maq || !maqs.some(m => m.id === ui.maq)) ui.maq = (maqs.find(m => m.setor_id === (D.cfg.setor_impressao_id || C.setores.find(s => /impress/i.test(s.nome))?.id)) || maqs[0])?.id || null;
    ui.inicio ||= today();
    tela(root);
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 121 já foi executado.</div></div>'; }
}

// etapas da máquina: do setor dela, sem máquina ou já nela; a que está rodando fica fixa no topo
function itensDaMaquina(m) {
  const lim = Date.now() + D.cfg.horizonte_dias * 864e5;
  return D.pr.filter(p => p.setor_id === m.setor_id && (!p.maquina_id || p.maquina_id === m.id)).map(p => {
    const o = D.op[p.ordem_id] || {}, et = D.et[p.etapa_id] || {};
    return { id: p.etapa_id, numero: o.numero, op: o, et, entrega: o.entrega, prioridade: o.prioridade, horas: +et.horas_previstas || 0, cores: (p.cores || []).map(c => ({ ...c, esc: +c.esc })),
      impedimentos: p.impedimentos || [], avisos: p.avisos || [], bloqueada: (p.impedimentos || []).length > 0, rodando: et.status === 'em_andamento' };
  }).filter(i => i.rodando || !i.entrega || Date.parse(i.entrega) <= lim || i.et.maquina_id === m.id);
}

function tela(root) {
  const C = D.C, maqs = C.maquinas.filter(m => m.ativo), m = maqs.find(x => x.id === ui.maq);
  const todos = m ? itensDaMaquina(m) : [], rodando = todos.find(i => i.rodando), resto = todos.filter(i => !i.rodando);
  const hd = +(C.setorById[m?.setor_id]?.horas_dia || 24), sug = sequenciar(resto, D.cfg, rodando || null, { inicio: ui.inicio, horasDia: hd });
  // ajuste manual: a ordem que o PCP arrastou (↑↓) prevalece; as trocas são recalculadas
  let fila = sug.fila;
  if (ui.manual && ui.manual.maq === ui.maq) { const by = Object.fromEntries(resto.map(i => [i.id, i])); const ord = ui.manual.ids.filter(id => by[id]); resto.forEach(i => { if (!ord.includes(i.id)) ord.push(i.id); });
    let ant = rodando || null; fila = ord.map(id => { const it = { ...by[id], troca: troca(ant, by[id], D.cfg) }; if (it.cores.length) ant = it; return it; }); }
  const datas = distribuir(fila, ui.inicio, hd);
  const tot = fila.reduce((t, i) => t + i.troca, 0), econ = Math.max(0, sug.trocaBase - tot), bloq = fila.filter(i => i.bloqueada).length, atr = datas.filter(i => i.atrasa).length;
  const imped = D.pr.filter(p => (p.impedimentos || []).length);
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Programação Inteligente</h2><div class="muted small">O que impede cada OP de começar e a ordem que menos troca de cor sem perder a entrega.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><a class="btn ghost" href="#/producao/programacao">Quadro da semana</a>${podePCP() ? '<button class="btn" id="sq-par">Parâmetros</button>' : ''}</div></div>
    <div style="margin-bottom:12px;display:flex;gap:6px"><button class="chip${ui.aba === 'fila' ? ' on' : ''}" data-aba="fila">Sequência por máquina</button><button class="chip${ui.aba === 'imped' ? ' on' : ''}" data-aba="imped">Impedimentos (${imped.length})</button></div>
    ${ui.aba === 'imped' ? impedimentos(imped) : `
    <div class="card toolbar" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap"><label>Máquina<select id="sq-m">${maqs.map(x => `<option value="${x.id}" ${x.id === ui.maq ? 'selected' : ''}>${esc(x.codigo)} — ${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Começar em<input type="date" id="sq-i" value="${ui.inicio}"></label><span class="muted small" style="padding-bottom:8px">${esc(C.setorById[m?.setor_id]?.nome || '')} · ${hd} h/dia</span>
      <div style="flex:1"></div>${ui.manual?.maq === ui.maq ? '<button class="btn ghost" id="sq-reset">Voltar à sugestão</button>' : ''}${podePCP() && fila.length ? '<button class="btn primary" id="sq-apl">Aplicar sequência na máquina</button>' : ''}</div>
    <div class="kpis" style="margin:12px 0"><div class="kpi"><div class="k-label">Na fila</div><div class="k-value">${fila.length}</div><div class="k-sub">${fila.length - bloq} prontas para começar</div></div>
      <div class="kpi"><div class="k-label">Com impedimento</div><div class="k-value ${bloq ? 'warn' : ''}">${bloq}</div><div class="k-sub">vão para o fim da fila</div></div>
      <div class="kpi"><div class="k-label">Troca de cor</div><div class="k-value">${hm(tot)}</div><div class="k-sub">pela entrega seria ${hm(sug.trocaBase)}</div></div>
      <div class="kpi"><div class="k-label">Economia</div><div class="k-value ${econ ? 'pos' : ''}">${hm(econ)}</div><div class="k-sub">de máquina parada em limpeza</div></div>
      <div class="kpi"><div class="k-label">Atrasos previstos</div><div class="k-value ${atr ? 'neg' : ''}">${atr}</div><div class="k-sub">fim depois da entrega</div></div></div>
    <div class="card flush"><div class="table-wrap" id="sq-corpo"><table class="small"><thead><tr><th>#</th><th>OP</th><th>Produto · cliente</th><th>Cores</th><th>Entrega</th><th class="num">Horas</th><th class="num">Troca</th><th>Previsto</th><th>Pode começar?</th>${podePCP() ? '<th></th>' : ''}</tr></thead><tbody>
      ${rodando ? linha(rodando, '▶', { inicio: null }, true) : ''}
      ${datas.map((i, k) => linha(i, k + 1, i, false, k, datas.length)).join('') || `<tr><td colspan="10" class="empty">Nenhuma etapa aberta para ${esc(m?.codigo || 'esta máquina')} no horizonte de ${D.cfg.horizonte_dias} dias.</td></tr>`}</tbody></table></div></div>
    <p class="small muted">A sugestão segue a entrega e, entre as OPs que vencem até ${D.cfg.janela_entrega_dias} dia(s) depois da mais urgente, escolhe a que menos troca de cor (${D.cfg.troca_cor_min} min por cor nova, + ${D.cfg.limpeza_escuro_claro_min} min do escuro para o claro). Prioridade 1 não espera. Use ↑↓ para ajustar.</p>`}`;
  $$('[data-aba]', root).forEach(b => b.onclick = () => { ui.aba = b.dataset.aba; tela(root); });
  $('#sq-par', root) && ($('#sq-par', root).onclick = () => parametros(root));
  if (ui.aba === 'imped') return;
  $('#sq-m', root) && ($('#sq-m', root).onchange = (e) => { ui.maq = e.target.value; tela(root); });
  $('#sq-i', root) && ($('#sq-i', root).onchange = (e) => { ui.inicio = e.target.value || today(); tela(root); });
  $('#sq-reset', root) && ($('#sq-reset', root).onclick = () => { ui.manual = null; tela(root); });
  $$('[data-mv]', root).forEach(b => b.onclick = () => { const ids = fila.map(i => i.id), k = +b.dataset.k, d = +b.dataset.mv; [ids[k], ids[k + d]] = [ids[k + d], ids[k]]; ui.manual = { maq: ui.maq, ids }; tela(root); });
  $('#sq-apl', root) && ($('#sq-apl', root).onclick = async () => {
    if (bloq && !confirm(`${bloq} etapa(s) com impedimento entram no fim da fila. Aplicar assim mesmo?`)) return;
    try { const n = await q(sb.rpc('prod_prog_aplicar', { p_maquina: ui.maq, p_etapas: fila.map(i => i.id), p_inicio: ui.inicio, p_trocas_min: fila.map(i => Math.round(i.troca)) }));
      toast(`${n} etapa(s) programadas em ${m.codigo}`); ui.manual = null; render(root); } catch (e) { fail(e); }
  });
}

const bolas = (cores) => cores.map(c => `<span title="${esc(c.codigo + ' ' + (c.nome || ''))}" style="display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid var(--line);margin-right:2px;vertical-align:middle;background:${/^#?[0-9a-f]{6}$/i.test(c.hex || '') ? (c.hex.startsWith('#') ? c.hex : '#' + c.hex) : 'repeating-linear-gradient(45deg,#ccc 0 3px,#fff 3px 6px)'}"></span>`).join('') || '<span class="muted">—</span>';
const chips = (l, cls) => l.map(x => `<span class="badge ${cls}" title="${esc(x.texto)}" style="margin:1px 3px 1px 0;white-space:normal;display:inline-block">${esc(x.texto)}</span>`).join('');

function linha(i, pos, dt, fixo, k, n) {
  const o = i.op;
  return `<tr ${fixo ? 'style="background:var(--bg-soft)"' : ''}><td><b>${pos}</b></td><td><b>${o.numero}</b>${o.prioridade === 1 ? ' <span class="badge vencido">P1</span>' : ''}</td>
    <td class="wrap">${esc((o.codigo_produto || '') + ' ' + (o.descricao || ''))}<div class="muted">${esc(o.cliente || '')}</div></td><td style="white-space:nowrap">${bolas(i.cores)}</td>
    <td>${dateBR(o.entrega)}</td><td class="num">${(i.horas || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td><td class="num">${fixo ? '—' : i.troca ? hm(i.troca) : '0'}</td>
    <td>${fixo ? 'rodando agora' : dt.inicio === dt.fim ? dateBR(dt.inicio) : `${dateBR(dt.inicio).slice(0, 5)} a ${dateBR(dt.fim).slice(0, 5)}`}${dt.atrasa ? ' <span class="badge vencido">atrasa</span>' : ''}</td>
    <td style="min-width:200px;max-width:300px;white-space:normal">${i.impedimentos.length ? chips(i.impedimentos, 'vencido') : '<span class="badge pago">Pronta</span>'}${chips(i.avisos, '')}</td>
    ${podePCP() ? `<td style="white-space:nowrap">${fixo ? '' : `<button class="btn ghost small" data-mv="-1" data-k="${k}" ${k === 0 ? 'disabled' : ''} title="Subir">↑</button><button class="btn ghost small" data-mv="1" data-k="${k}" ${k === n - 1 ? 'disabled' : ''} title="Descer">↓</button>`}</td>` : ''}</tr>`;
}

function impedimentos(lista) {
  const cont = {}; lista.forEach(p => p.impedimentos.forEach(x => { cont[x.tipo] = (cont[x.tipo] || 0) + 1; }));
  const ord = [...lista].sort((a, b) => String(D.op[a.ordem_id]?.entrega || '9').localeCompare(String(D.op[b.ordem_id]?.entrega || '9')));
  return `<div class="kpis" style="margin-bottom:12px">${['arte', 'cliche', 'tinta', 'material'].map(t => `<div class="kpi"><div class="k-label">${TIPO[t]}</div><div class="k-value ${cont[t] ? 'warn' : ''}">${cont[t] || 0}</div><div class="k-sub">etapa(s) paradas por isso</div></div>`).join('')}</div>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>OP</th><th>Etapa</th><th>Produto · cliente</th><th>Entrega</th><th>O que falta para começar</th></tr></thead><tbody>
    ${ord.map(p => { const o = D.op[p.ordem_id] || {}; return `<tr><td><b>${o.numero}</b></td><td>${p.seq}. ${esc(D.C.setorById[p.setor_id]?.nome || '')}</td><td class="wrap">${esc((o.codigo_produto || '') + ' ' + (o.descricao || ''))}<div class="muted">${esc(o.cliente || '')}</div></td>
      <td>${dateBR(o.entrega)}</td><td>${chips(p.impedimentos, 'vencido')}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nenhuma OP com impedimento.</td></tr>'}</tbody></table></div></div>`;
}

function parametros(root) {
  const c = D.cfg, S = D.C.setores;
  const m = modal({ title: 'Parâmetros da programação inteligente', body: `<div class="small" style="margin-bottom:4px">O que impede a etapa de começar:</div>
    ${[['arte', 'Arte não aprovada na pré-impressão (só na impressão)'], ['cliche', 'Clichê não recebido (só na impressão)'], ['tinta', 'Tinta não preparada nem em estoque (só na impressão)'], ['material', 'Material da estrutura sem saldo (na primeira etapa)']]
      .map(([k, t]) => `<label class="chk"><input type="checkbox" id="pp-${k}" ${c['considerar_' + k] ? 'checked' : ''}> ${t}</label>`).join('')}
    <div class="grid-form" style="margin-top:10px">
      <label>Troca de cor (min por cor nova)<input type="number" id="pp-tc" min="0" max="240" value="${c.troca_cor_min}"></label>
      <label>Limpeza do escuro para o claro (min)<input type="number" id="pp-lp" min="0" max="480" value="${c.limpeza_escuro_claro_min}"></label>
      <label>Janela de entrega (dias)<input type="number" id="pp-jn" min="0" max="30" value="${c.janela_entrega_dias}"></label>
      <label>Horizonte (dias)<input type="number" id="pp-hz" min="1" max="90" value="${c.horizonte_dias}"></label>
      <label>Setor da impressão<select id="pp-si"><option value="">O que tem "impress" no nome</option>${S.map(s => `<option value="${s.id}" ${c.setor_impressao_id === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></label></div>
    <p class="small muted">Janela 0: a ordem segue só a entrega. As cores vêm da ficha de cores dos produtos (Casa de Tintas › Previsão de Tinta).</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pp-ok">Salvar</button>' });
  $('#pp-ok', m.el).onclick = async () => {
    const v = (id) => +$(id, m.el).value, reg = { empresa_id: state.empresa.id, considerar_arte: $('#pp-arte', m.el).checked, considerar_cliche: $('#pp-cliche', m.el).checked, considerar_tinta: $('#pp-tinta', m.el).checked,
      considerar_material: $('#pp-material', m.el).checked, troca_cor_min: v('#pp-tc'), limpeza_escuro_claro_min: v('#pp-lp'), janela_entrega_dias: v('#pp-jn'), horizonte_dias: v('#pp-hz'), setor_impressao_id: $('#pp-si', m.el).value || null, atualizado_em: new Date().toISOString() };
    if (!(reg.troca_cor_min >= 0 && reg.troca_cor_min <= 240 && reg.limpeza_escuro_claro_min >= 0 && reg.limpeza_escuro_claro_min <= 480 && reg.janela_entrega_dias >= 0 && reg.janela_entrega_dias <= 30 && reg.horizonte_dias >= 1 && reg.horizonte_dias <= 90)) return toast('Confira as faixas', true);
    try { await q(sb.from('prod_prog_config').upsert(reg)); m.close(); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
  };
}

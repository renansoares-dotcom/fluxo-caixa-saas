// Recuperadora › Processamento (REC004): ordem de reprocesso — os lotes que entram (o saldo sai do lote na hora),
// o apontamento por etapa (horas, kg, perdas por tipo), os custos (energia, água, químicos, mão de obra, outros, máquina)
// e a conclusão, que cria o lote de grão com o custo total (bloqueado até o ensaio, se os parâmetros pedirem).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, toast, fail, modal, parseNum, exportXLSX } from '../lib/ui.js';
import { carregarRec, podeOperar, kpi, kg, kg0, rkg, semSQL, avisoSQL, desligada, avisoDesligada, nomeMat, optMats } from '../lib/rec-ui.js';
import { resumoOrdem, horasEtapa, PERDAS, TIPOS_LOTE } from '../lib/recuperadora.js';
import { cadProducao } from '../lib/producao.js';

export const title = 'Processamento';
const mesIni = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const ui = { de: mesIni(), ate: today(), sit: 'todas' };
const n3 = (v) => v == null || v === '' ? '' : String(+v).replace('.', ',');
const pctf = (v) => v == null ? '–' : (v * 100).toFixed(1).replace('.', ',') + '%';
const SIT = { aberta: ['Aberta', 'aberto'], concluida: ['Concluída', 'pago'], cancelada: ['Cancelada', 'vencido'] };

async function base() {
  const [R, P, cc] = await Promise.all([carregarRec(), cadProducao(), q(sb.from('prod_custo_config').select('custo_hora_padrao').eq('empresa_id', state.empresa.id).maybeSingle()).catch(() => null)]);
  const etapas = await q(sb.from('rec_etapas').select('*').eq('empresa_id', state.empresa.id).order('ordem'));
  const custoHora = (mid) => { const m = P.maqById[mid]; if (!m) return +(cc?.custo_hora_padrao || 0) || +(R.cfg.custo_hora_maquina || 0);
    return m.custo_hora != null ? +m.custo_hora : P.setorById[m.setor_id]?.custo_hora != null ? +P.setorById[m.setor_id].custo_hora : (+(cc?.custo_hora_padrao || 0) || +(R.cfg.custo_hora_maquina || 0)); };
  return { R, P, etapas, etById: Object.fromEntries(etapas.map(e => [e.id, e])), custoHora };
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const B = await base(), R = B.R;
    if (desligada(R)) { root.innerHTML = avisoDesligada(); return; }
    const e = state.empresa.id;
    const [O, ENT] = await Promise.all([q(sb.from('rec_ordens').select('*').eq('empresa_id', e).gte('data', ui.de).lte('data', ui.ate).order('data', { ascending: false }).order('numero', { ascending: false })),
      q(sb.from('rec_ordens').select('id').eq('empresa_id', e).eq('situacao', 'aberta'))]);
    const abertasIds = ENT.map(x => x.id);
    const emProc = abertasIds.length ? await q(sb.from('rec_ordem_entradas').select('kg').in('ordem_id', abertasIds)) : [];
    const L = O.filter(o => ui.sit === 'todas' || o.situacao === ui.sit), C = O.filter(o => o.situacao === 'concluida');
    const ent = C.reduce((s, o) => s + +o.peso_entrada, 0), sai = C.reduce((s, o) => s + +o.peso_saida, 0), ct = C.reduce((s, o) => s + +o.custo_total, 0), meta = (+R.cfg.meta_rendimento_pct || 85) / 100;
    const cor = (r) => r == null ? '' : r >= meta ? 'pos' : r >= meta - 0.1 ? 'warn' : 'neg';
    root.innerHTML = `<div class="kpis">${kpi('Ordens abertas', abertasIds.length, `${kg0(emProc.reduce((s, x) => s + +x.kg, 0))} em processo`, abertasIds.length ? 'warn' : '')}
        ${kpi('Grão produzido', kg0(sai), `${C.length} ordem(ns) concluída(s) no período`)}${kpi('Rendimento', pctf(ent ? sai / ent : null), `meta ${pctf(meta)}`, cor(ent ? sai / ent : null))}
        ${kpi('Custo do kg de grão', sai ? rkg(ct / sai) : '–', `total ${money(ct)}`)}</div>
      <div class="card toolbar" style="margin-top:12px"><label class="small">De <input type="date" id="pr-de" value="${ui.de}"></label><label class="small">Até <input type="date" id="pr-ate" value="${ui.ate}"></label>
        <div class="chips" id="pr-sit">${[['todas', 'Todas'], ['aberta', 'Abertas'], ['concluida', 'Concluídas'], ['cancelada', 'Canceladas']].map(([k, t]) => `<span class="chip ${ui.sit === k ? 'on' : ''}" data-s="${k}">${t}</span>`).join('')}</div>
        <span class="spacer"></span><button class="btn" id="pr-x">Excel</button>${podeOperar() ? '<button class="btn primary" id="pr-n">+ Nova ordem</button>' : ''}</div>
      <div class="card flush" style="margin-top:12px"><div class="table-wrap" id="pr-t" style="max-height:62vh"><table><thead><tr><th>Nº</th><th>Data</th><th>Grão produzido</th><th>Máquina</th><th class="num">Entrada</th><th class="num">Saída</th><th class="num">Rendimento</th><th class="num">R$/kg</th><th>Situação</th></tr></thead><tbody>
        ${L.map(o => { const r = o.peso_entrada ? o.peso_saida / o.peso_entrada : null; return `<tr class="clickable" data-id="${o.id}"><td><b>${o.numero}</b></td><td>${dateBR(o.data)}</td><td>${esc(nomeMat(R, o.material_saida_id))}</td>
          <td>${esc(B.P.maqById[o.maquina_id]?.codigo || '')}</td><td class="num">${o.peso_entrada != null ? kg0(o.peso_entrada) : '–'}</td><td class="num">${o.peso_saida != null ? kg0(o.peso_saida) : '–'}</td>
          <td class="num ${cor(r)}"><b>${pctf(r)}</b></td><td class="num">${o.custo_total != null && +o.peso_saida ? rkg(o.custo_total / o.peso_saida) : '–'}</td><td><span class="badge ${SIT[o.situacao][1]}">${SIT[o.situacao][0]}</span></td></tr>`; }).join('')
          || '<tr><td colspan="9" class="empty">Nenhuma ordem no período. "+ Nova ordem" escolhe o grão que sai e os lotes que entram.</td></tr>'}</tbody></table></div></div>`;
    $('#pr-de', root).onchange = (ev) => { ui.de = ev.target.value || mesIni(); render(root); };
    $('#pr-ate', root).onchange = (ev) => { ui.ate = ev.target.value || today(); render(root); };
    $('#pr-sit', root).onclick = (ev) => { const s = ev.target.closest('[data-s]')?.dataset.s; if (s) { ui.sit = s; render(root); } };
    $('#pr-x', root).onclick = () => exportXLSX($('#pr-t table', root), `ordens_reprocesso_${ui.de}_${ui.ate}`);
    root.querySelector('tbody').onclick = (ev) => { const id = ev.target.closest('tr[data-id]')?.dataset.id; if (id) abrir(B, id, root); };
    $('#pr-n', root) && ($('#pr-n', root).onclick = () => nova(B, root));
  } catch (err) { root.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

function nova(B, root) {
  const R = B.R, graos = R.mats.filter(m => m.ativo);
  if (!graos.length) return toast('Cadastre o material do grão nos Parâmetros (ex.: GR-PEBD — Grão PEBD reciclado)', true);
  const md = modal({ title: 'Nova ordem de reprocesso', body: `<form id="nf" class="grid2"><label>Data<input type="date" name="d" value="${today()}"></label>
      <label>Grão que sai *<select name="m">${optMats(R, graos.find(m => /^gr/i.test(m.codigo))?.id)}</select></label>
      <label class="span2">Máquina principal<select name="q"><option value="">—</option>${B.P.maquinas.filter(m => m.ativo !== false).map(m => `<option value="${m.id}" ${m.tipo_visual === 'aglutinador' ? 'selected' : ''}>${esc(m.codigo)} ${esc(m.nome)}</option>`).join('')}</select></label>
      <label class="span2">Observação<input name="o"></label></form>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nf-ok">Abrir a ordem</button>' });
  $('#nf-ok', md.el).onclick = async (ev) => { const f = $('#nf', md.el); ev.target.disabled = true;
    try { const [o] = await q(sb.from('rec_ordens').insert({ empresa_id: state.empresa.id, data: f.d.value || today(), material_saida_id: f.m.value, maquina_id: f.q.value || null, observacao: f.o.value.trim() || null }).select('id'));
      md.close(); render(root); abrir(B, o.id, root); } catch (err) { ev.target.disabled = false; fail(err); } };
}

async function abrir(B, id, root) {
  const R = B.R, e = state.empresa.id;
  const [[o], ENT, ET] = await Promise.all([q(sb.from('rec_ordens').select('*').eq('id', id)), q(sb.from('rec_ordem_entradas').select('*, lote:rec_lotes(codigo, tipo, material_id, fornecedor_id)').eq('ordem_id', id).order('criado_em')),
    q(sb.from('rec_ordem_etapas').select('*').eq('ordem_id', id).order('criado_em'))]);
  const aberta = o.situacao === 'aberta', pode = aberta && podeOperar(), dis = pode ? '' : 'disabled';
  const ets = ET.map(x => ({ ...x, ordem: B.etById[x.etapa_id]?.ordem ?? 0 }));
  const md = modal({ title: `Ordem de reprocesso ${o.numero} — ${nomeMat(R, o.material_saida_id)}`, wide: true, body: `
    <div class="grid-form"><label class="c4">Data<input type="date" id="or-d" value="${o.data}" ${dis}></label>
      <label class="span2">Grão que sai<select id="or-m" ${dis}>${optMats(R, o.material_saida_id)}</select></label>
      <label class="c4">Máquina principal<select id="or-q" ${dis}><option value="">—</option>${B.P.maquinas.map(m => `<option value="${m.id}" ${m.id === o.maquina_id ? 'selected' : ''}>${esc(m.codigo)} ${esc(m.nome)}</option>`).join('')}</select></label></div>
    <h3 style="margin:14px 0 6px">Lotes que entram</h3>
    <div class="table-wrap"><table class="small"><thead><tr><th>Lote</th><th>Material</th><th>Origem</th><th class="num">kg</th><th class="num">Custo</th><th></th></tr></thead><tbody>
      ${ENT.map(x => `<tr><td><b>${esc(x.lote?.codigo || '')}</b></td><td>${esc(nomeMat(R, x.lote?.material_id))}</td><td>${x.lote?.fornecedor_id ? esc(R.fornById[x.lote.fornecedor_id]?.nome || '') : esc(TIPOS_LOTE[x.lote?.tipo] || '')}</td>
        <td class="num">${kg(x.kg)}</td><td class="num">${money(x.custo)}</td><td>${pode ? `<button class="btn ghost sm" data-tira="${x.id}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum lote.</td></tr>'}</tbody></table></div>
    ${pode ? `<div class="toolbar" style="margin-top:6px"><label class="grow small">Lote (escolha ou leia a etiqueta)<input id="or-lc" list="or-ll" placeholder="código do lote"><datalist id="or-ll"></datalist></label>
      <label class="small">kg<input id="or-lk" inputmode="decimal" style="width:100px" placeholder="todo o saldo"></label><button class="btn" id="or-la">+ Lote</button></div>` : ''}
    <h3 style="margin:14px 0 6px">Etapas</h3>
    <div class="table-wrap"><table class="small"><thead><tr><th>Etapa</th><th>Máquina</th><th class="num">Horas</th><th class="num">kg entrada</th><th class="num">kg saída</th>${Object.values(PERDAS).map(p => `<th class="num">${p}</th>`).join('')}<th></th></tr></thead><tbody>
      ${[...ets].sort((a, b) => a.ordem - b.ordem).map(x => `<tr><td>${esc(B.etById[x.etapa_id]?.nome || '')}${x.operador ? `<div class="muted">${esc(x.operador)}</div>` : ''}</td><td>${esc(B.P.maqById[x.maquina_id]?.codigo || '')}</td>
        <td class="num">${n3(horasEtapa(x))}</td><td class="num">${n3(x.kg_entrada)}</td><td class="num">${n3(x.kg_saida)}</td>${Object.keys(PERDAS).map(k => `<td class="num">${+x[k] ? n3(x[k]) : ''}</td>`).join('')}
        <td>${pode ? `<button class="btn ghost sm" data-del="${x.id}">✕</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="${5 + Object.keys(PERDAS).length + 1}" class="empty">Nenhuma etapa apontada.</td></tr>`}</tbody></table></div>
    ${pode ? `<form id="or-ef" class="grid-form" style="margin-top:6px"><label class="c4">Etapa<select name="et">${B.etapas.filter(x => x.ativo).map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label>
      <label class="c4">Máquina<select name="mq"><option value="">a principal</option>${B.P.maquinas.map(m => `<option value="${m.id}">${esc(m.codigo)}</option>`).join('')}</select></label>
      <label class="c4">Horas<input name="h" inputmode="decimal"></label><label class="c4">Operador<input name="op"></label>
      <label class="c4">kg entrada<input name="ke" inputmode="decimal"></label><label class="c4">kg saída<input name="ks" inputmode="decimal"></label>
      ${Object.entries(PERDAS).map(([k, t]) => `<label class="c4">Perda: ${t.toLowerCase()} (kg)<input name="${k}" inputmode="decimal"></label>`).join('')}
      <div class="c4" style="align-self:end"><button class="btn" id="or-ea">+ Apontar etapa</button></div></form>` : ''}
    <h3 style="margin:14px 0 6px">Custos da ordem</h3>
    <div class="grid-form"><label class="c4">Energia (kWh)<input id="or-kwh" inputmode="decimal" value="${n3(o.energia_kwh)}" ${dis}><span class="small muted">${rkg(R.cfg.custo_kwh)}/kWh</span></label>
      <label class="c4">Água (m³)<input id="or-agua" inputmode="decimal" value="${n3(o.agua_m3)}" ${dis}><span class="small muted">${rkg(R.cfg.custo_m3_agua)}/m³</span></label>
      <label class="c4">Químicos (R$)<input id="or-qui" inputmode="decimal" value="${+o.quimicos_valor ? money(o.quimicos_valor) : ''}" ${dis}></label>
      <label class="c4">Mão de obra (horas)<input id="or-mo" inputmode="decimal" value="${n3(o.mo_horas)}" ${dis}><span class="small muted">${money(R.cfg.custo_hora_mo)}/h</span></label>
      <label class="c4">Outros (R$)<input id="or-out" inputmode="decimal" value="${+o.outros_valor ? money(o.outros_valor) : ''}" ${dis}></label>
      <label class="span2">Observação<input id="or-ob" value="${esc(o.observacao || '')}" ${dis}></label></div>
    <div id="or-res" style="margin-top:12px"></div>`,
    foot: `${pode ? '<button class="btn danger" id="or-can">Cancelar a ordem</button>' : ''}<span class="spacer"></span>
      ${o.lote_saida_id ? '<a class="btn" href="#/recuperadora/lotes">Ver o lote de grão</a>' : ''}${pode ? '<button class="btn" id="or-sv">Salvar</button><button class="btn primary" id="or-ok">Concluir</button>' : '<button class="btn" data-close>Fechar</button>'}` });
  const el = md.el, meta = (+R.cfg.meta_rendimento_pct || 85) / 100;
  const atual = () => pode ? { ...o, energia_kwh: parseNum($('#or-kwh', el).value) || 0, agua_m3: parseNum($('#or-agua', el).value) || 0, quimicos_valor: parseNum($('#or-qui', el).value) || 0,
    mo_horas: parseNum($('#or-mo', el).value) || 0, outros_valor: parseNum($('#or-out', el).value) || 0, maquina_id: $('#or-q', el).value || null } : o;
  const resumo = () => {
    const S = resumoOrdem(atual(), ENT, ets, R.cfg, B.custoHora), P = S.processo;
    $('#or-res', el).innerHTML = `<div class="kpis">${kpi('Entrou', kg(S.entrada), money(S.material) + ' de material')}${kpi(aberta ? 'Saída prevista' : 'Grão produzido', kg(S.kgSaida), aberta ? 'última etapa ou entrada − perdas' : '')}
      ${kpi('Rendimento', pctf(S.rendimento), `meta ${pctf(meta)}`, S.rendimento == null ? '' : S.rendimento >= meta ? 'pos' : 'neg')}${kpi('Custo do processo', money(P.total), `energia ${money(P.energia)} · água ${money(P.agua)} · químicos ${money(P.quimicos)} · MO ${money(P.mao_obra)} · máquina ${money(P.maquina)}${P.outros ? ' · outros ' + money(P.outros) : ''}`)}
      ${kpi('Custo do kg de grão', S.custoKg == null ? '–' : rkg(S.custoKg), money(S.total) + ' no total')}</div>
      ${Math.abs(S.naoExplicado) > 0.5 && ets.length ? `<p class="small warn">${kg(Math.abs(S.naoExplicado))} ${S.naoExplicado > 0 ? 'não explicados pelas perdas apontadas' : 'a mais que a entrada menos as perdas'}: confira os pesos das etapas.</p>` : ''}`;
    return S;
  };
  resumo();
  if (!pode) return;
  ['#or-kwh', '#or-agua', '#or-qui', '#or-mo', '#or-out', '#or-q'].forEach(s => $(s, el).addEventListener('change', resumo));
  const salvar = async () => { const a = atual();
    await q(sb.from('rec_ordens').update({ data: $('#or-d', el).value || o.data, material_saida_id: $('#or-m', el).value, maquina_id: a.maquina_id, energia_kwh: a.energia_kwh, agua_m3: a.agua_m3,
      quimicos_valor: a.quimicos_valor, mo_horas: a.mo_horas, outros_valor: a.outros_valor, observacao: $('#or-ob', el).value.trim() || null }).eq('id', o.id)); };
  const reabrir = () => { md.close(); abrir(B, id, root); };
  // lotes disponíveis para a lista
  q(sb.from('rec_lotes').select('id, codigo, tipo, material_id, saldo_kg').eq('empresa_id', e).in('situacao', ['disponivel', 'em_processo']).gt('saldo_kg', 0).order('data').limit(1500))
    .then(Ls => { $('#or-ll', el).innerHTML = Ls.map(l => `<option value="${esc(l.codigo)}">${esc(nomeMat(R, l.material_id))} · saldo ${n3(l.saldo_kg)} kg</option>`).join(''); el._lotes = Ls; }).catch(() => {});
  $('#or-la', el).onclick = async () => {
    const cod = $('#or-lc', el).value.trim(), l = (el._lotes || []).find(x => x.codigo.toLowerCase() === cod.toLowerCase());
    if (!l) return toast('Lote não encontrado entre os disponíveis', true);
    const k = $('#or-lk', el).value.trim() ? parseNum($('#or-lk', el).value) : +l.saldo_kg;
    try { await salvar(); await q(sb.rpc('rec_ordem_entrada', { p_ordem: o.id, p_lote: l.id, p_kg: k })); toast(`${n3(k)} kg do lote ${l.codigo}`); reabrir(); render(root); } catch (err) { fail(err); }
  };
  $$('[data-tira]', el).forEach(b => b.onclick = async () => { try { await salvar(); await q(sb.rpc('rec_ordem_entrada_tirar', { p_entrada: b.dataset.tira })); reabrir(); render(root); } catch (err) { fail(err); } });
  $('#or-ea', el).onclick = async (ev) => { ev.preventDefault(); const f = $('#or-ef', el), num = (n) => f[n].value.trim() === '' ? null : parseNum(f[n].value);
    const v = { empresa_id: e, ordem_id: o.id, etapa_id: f.et.value, maquina_id: f.mq.value || null, operador: f.op.value.trim() || null, horas_maquina: num('h') || 0, kg_entrada: num('ke'), kg_saida: num('ks'),
      ...Object.fromEntries(Object.keys(PERDAS).map(k => [k, num(k) || 0])) };
    if (v.kg_entrada != null && v.kg_saida != null && v.kg_saida > v.kg_entrada) return toast('A saída da etapa passou da entrada', true);
    try { await salvar(); await q(sb.from('rec_ordem_etapas').insert(v)); reabrir(); } catch (err) { fail(err); } };
  $$('[data-del]', el).forEach(b => b.onclick = async () => { try { await q(sb.from('rec_ordem_etapas').delete().eq('id', b.dataset.del)); reabrir(); } catch (err) { fail(err); } });
  $('#or-sv', el).onclick = async () => { try { await salvar(); md.close(); toast('Ordem salva'); render(root); } catch (err) { fail(err); } };
  $('#or-can', el).onclick = () => { const m2 = modal({ title: 'Cancelar a ordem', narrow: true, body: '<p class="small">Os kg voltam aos lotes de entrada.</p><label>Motivo<input id="oc-m"></label>', foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="oc-ok">Cancelar</button>' });
    $('#oc-ok', m2.el).onclick = async () => { try { await q(sb.rpc('rec_ordem_cancelar', { p_ordem: o.id, p_motivo: $('#oc-m', m2.el).value })); m2.close(); md.close(); toast('Ordem cancelada'); render(root); } catch (err) { fail(err); } }; };
  $('#or-ok', el).onclick = async () => {
    const S = resumo();
    const m2 = modal({ title: 'Concluir a ordem', narrow: true, body: `<p class="small">Entrou ${kg(S.entrada)}. Informe o grão pesado na saída: ele vira o lote de grão${R.cfg.exigir_ensaio ? ', bloqueado até o ensaio' : ''}.</p>
        <label>Grão produzido (kg)<input id="oc-k" inputmode="decimal" value="${n3(S.kgSaida)}"></label>`, foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="oc-ok">Concluir</button>' });
    $('#oc-ok', m2.el).onclick = async (ev) => { ev.target.disabled = true;
      try { await salvar(); const r = await q(sb.rpc('rec_ordem_concluir', { p_ordem: o.id, p_kg_saida: parseNum($('#oc-k', m2.el).value) }));
        m2.close(); md.close(); toast(`Lote ${r.lote}: ${kg(r.saida)} · rendimento ${pctf(r.rendimento)} · ${rkg(r.custo_kg)}/kg${r.bloqueado ? ' · aguardando o ensaio' : ''}`); render(root); }
      catch (err) { ev.target.disabled = false; fail(err); } };
  };
}

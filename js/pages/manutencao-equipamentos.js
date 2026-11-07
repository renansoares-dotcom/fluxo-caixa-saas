// Manutenção › Equipamentos e Planos (PRD010): cadastro de equipamentos (ligado à máquina da produção, ao bem do imobilizado e ao centro de custo),
// ficha com indicadores, histórico e custo; planos preventivos por dias e/ou horas de máquina; catálogo de falhas; parâmetros.
import { sb, state, q, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, options, money, dateBR, today, parseNum, exportXLSX } from '../lib/ui.js';
import * as M from '../lib/manutencao.js';
import { carregarManutencao, fichaOS, novaOS, nomeEq, selo, clsSit, clsPrio, CSS, podePCP, podeApontar } from '../lib/manutencao-ui.js';

export const title = 'Equipamentos e Planos';
const ui = { aba: 'eq', busca: '', crit: '' };
let D = null, BENS = [];
const nf = (v, c = 1) => v == null ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const pctTxt = (v) => v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1).replace('.', ',') + '%';
const corSit = (s) => ({ operando: 'pos', em_manutencao: 'warn', parado: 'neg', inativo: 'muted' }[s]);

export async function render(root) {
  const ger = podePCP();
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Equipamentos e Planos</h2><div class="muted small">O que a manutenção cuida, de quanto em quanto tempo e com que checklist. Os parâmetros ficam na última aba.</div></div>
      <div class="mn-acoes">${ger ? '<button class="btn" id="me-conf">Trazer máquinas da produção</button>' : ''}<button class="btn ghost" id="me-xls">Excel</button><span id="me-acao"></span></div></div>
    <div class="card toolbar"><div class="chips" id="me-abas">${[['eq', 'Equipamentos'], ['pl', 'Planos preventivos'], ['fa', 'Catálogo de falhas'], ['pa', 'Parâmetros']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><select id="me-c"><option value="">Toda criticidade</option>${['A', 'B', 'C'].map(c => `<option ${ui.crit === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <input id="me-b" placeholder="Procurar código ou nome" value="${esc(ui.busca)}" style="min-width:200px"></div>
    <div id="me-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#me-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; $$('#me-abas .chip', root).forEach(c => c.classList.toggle('on', c.dataset.a === a)); pintar(root); } };
  $('#me-c', root).onchange = (e) => { ui.crit = e.target.value; pintar(root); };
  $('#me-b', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  $('#me-xls', root).onclick = () => exportXLSX($('#me-corpo table', root), 'manutencao_' + ui.aba);
  $('#me-conf', root) && ($('#me-conf', root).onclick = async () => {
    try { const r = await q(sb.rpc('man_configurar', { p_empresa: state.empresa.id })); toast(`${r?.equipamentos ?? 0} máquina(s) trazida(s) · ${r?.falhas ?? 0} falha(s) no catálogo`); render(root); } catch (e) { fail(e); }
  });
  const ab = state.abrir?.tipo === 'equip' ? state.abrir : null; if (ab) delete state.abrir;
  try { [D, BENS] = await Promise.all([carregarManutencao(), q(sb.from('af_bens').select('id,plaqueta,descricao').eq('empresa_id', state.empresa.id).neq('situacao', 'baixado').order('plaqueta')).catch(() => [])]); await loadCadastros(); }
  catch (err) { fail(err); $('#me-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 086 (manutenção) já foi executado.</div></div>'; return; }
  pintar(root);
  if (ab) { const e = D.eById[ab.id]; if (e) fichaEquip(e, root); }
}

function pintar(root) {
  const ger = podePCP(), c = $('#me-corpo', root), b = ui.busca.trim().toLowerCase(), acao = $('#me-acao', root);
  const eqs = D.E.filter(e => (!ui.crit || e.criticidade === ui.crit) && (!b || `${e.codigo} ${e.nome}`.toLowerCase().includes(b)));
  acao.innerHTML = !ger ? '' : ui.aba === 'eq' ? '<button class="btn primary" id="me-novo">Novo equipamento</button>' : ui.aba === 'pl' ? '<button class="btn primary" id="me-novo">Novo plano</button>' : ui.aba === 'fa' ? '<button class="btn primary" id="me-novo">Nova falha</button>' : '';
  const novo = $('#me-novo', root);
  if (ui.aba === 'eq') {
    if (novo) novo.onclick = () => formEquip(null, root);
    const agora = Date.now(), de = new Date(agora - 90 * 86400000).toISOString(), ate = new Date().toISOString();
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Equipamento</th><th>Tipo</th><th>Crit.</th><th>Situação</th><th class="num">Horas de máquina</th><th class="num">Disp. 90 dias</th><th class="num">OS abertas</th><th>Preventiva</th></tr></thead><tbody>
      ${eqs.map(e => { const ind = M.indicadores(D.O.filter(o => o.equipamento_id === e.id), { de, ate, nEquip: 1, agora }), ab = D.O.filter(o => o.equipamento_id === e.id && M.ABERTAS.includes(o.situacao)).length;
        const pls = D.Pl.filter(p => p.equipamento_id === e.id && p.ativo).map(p => M.statusPlano(p, D.horasEq[e.id] || 0)), niv = pls.some(x => x.nivel === 'neg') ? 'neg' : pls.some(x => x.nivel === 'warn') ? 'warn' : 'pos';
        return `<tr class="clickable" data-e="${e.id}"><td><b>${esc(e.codigo)}</b> · ${esc(e.nome)}<div class="small muted">${esc([...new Set([D.S.find(s => s.id === e.setor_id)?.nome, e.local].filter(Boolean))].concat(e.maquina_id ? ['ligado à máquina da produção'] : []).join(' · '))}</div></td>
          <td class="small">${esc((M.TIPOS_EQUIP[e.tipo] || e.tipo).split(' (')[0])}</td><td><b>${e.criticidade}</b></td><td>${selo(M.SIT_EQUIP[e.situacao], corSit(e.situacao))}</td>
          <td class="num">${D.horasEq[e.id] != null ? nf(D.horasEq[e.id], 0) : '–'}</td><td class="num">${pctTxt(ind.disponibilidade)}</td><td class="num">${ab || '–'}</td>
          <td>${pls.length ? selo(niv === 'neg' ? 'Vencida' : niv === 'warn' ? 'Próxima' : 'Em dia', niv) : '<span class="muted small">sem plano</span>'}</td></tr>`; }).join('')
        || `<tr><td colspan="8" class="empty">${D.E.length ? 'Nenhum equipamento neste filtro.' : 'Nenhum equipamento. Use "Trazer as máquinas da produção" ou "Novo equipamento".'}</td></tr>`}</tbody></table></div></div>`;
    c.onclick = (ev) => { const r = ev.target.closest('[data-e]'); if (r) fichaEquip(D.eById[r.dataset.e], root); };
  } else if (ui.aba === 'pl') {
    if (novo) novo.onclick = () => formPlano(null, root);
    const L = D.Pl.filter(p => eqs.some(e => e.id === p.equipamento_id)).map(p => ({ p, s: M.statusPlano(p, D.horasEq[p.equipamento_id] || 0) }))
      .sort((a, b) => ({ neg: 0, warn: 1, ok: 2 }[a.s.nivel] - { neg: 0, warn: 1, ok: 2 }[b.s.nivel]) || (a.s.prox || '9').localeCompare(b.s.prox || '9'));
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Plano</th><th>Equipamento</th><th>Última execução</th><th>Próxima</th></tr></thead><tbody>
      ${L.map(({ p, s }) => `<tr class="clickable" data-p="${p.id}" style="${p.ativo ? '' : 'opacity:.55'}"><td><b>${esc(p.nome)}</b><div class="small muted">${esc(M.TIPOS_PLANO[p.tipo])} · ${[p.a_cada_dias && `a cada ${p.a_cada_dias} dia(s)`, p.a_cada_horas && `a cada ${nf(p.a_cada_horas, 0)} h`].filter(Boolean).join(' ou ')}${p.exige_parada ? ' · parar a máquina' : ''}${p.ativo ? '' : ' · inativo'}</div></td>
        <td>${esc(nomeEq(D, p.equipamento_id))}</td>
        <td class="small">${p.ultima_data ? dateBR(p.ultima_data) : '—'}${p.ultima_horas != null ? `<div class="muted">${nf(p.ultima_horas, 0)} h</div>` : ''}</td>
        <td class="wrap" style="max-width:280px">${selo(s.prox && p.a_cada_dias ? dateBR(s.prox) : s.horasRest != null ? `${nf(s.horasRest, 0)} h` : '—', s.nivel === 'ok' ? 'pos' : s.nivel)}${(() => { const o = D.O.find(x => x.plano_id === p.id && M.ABERTAS.includes(x.situacao)); return o ? ` ${selo('OS ' + o.numero + ' aberta', 'info')}` : ''; })()}<div class="small muted">${esc(s.txt)}${(p.checklist || []).length ? ` · ${p.checklist.length} item(ns) no checklist` : ''}</div></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum plano. Crie um por equipamento: lubrificação semanal, troca de resistência a cada 2.000 h, inspeção elétrica mensal…</td></tr>'}</tbody></table></div></div>
      <p class="muted small">"Gerar preventivas" (Painel) abre a OS ${D.P.antecedencia_dias} dia(s) antes de vencer por data, ou quando a máquina chega a 90% das horas do intervalo. Uma OS aberta por plano de cada vez.</p>`;
    c.onclick = (ev) => { const r = ev.target.closest('[data-p]'); if (r) formPlano(D.Pl.find(p => p.id === r.dataset.p), root); };
  } else if (ui.aba === 'fa') {
    if (novo) novo.onclick = () => formFalha(null, root);
    const usos = {}; D.O.forEach(o => { if (o.falha_id) usos[o.falha_id] = (usos[o.falha_id] || 0) + 1; });
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Falha</th><th>Categoria</th><th class="num">OS (13 meses)</th><th>Ativa</th></tr></thead><tbody>
      ${D.F.filter(f => !b || `${f.codigo} ${f.nome}`.toLowerCase().includes(b)).map(f => `<tr class="clickable" data-f="${f.id}"><td>${esc(f.codigo)}</td><td>${esc(f.nome)}</td><td>${esc(M.CATEGORIAS[f.categoria])}</td><td class="num">${usos[f.id] || '–'}</td><td>${f.ativo ? 'Sim' : selo('Não', 'muted')}</td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">Catálogo vazio. "Trazer as máquinas da produção" cria 18 falhas típicas de extrusão e impressão.</td></tr>'}</tbody></table></div></div>`;
    c.onclick = (ev) => { const r = ev.target.closest('[data-f]'); if (r && ger) formFalha(D.F.find(f => f.id === r.dataset.f), root); };
  } else {
    const p = D.P, dis = ger ? '' : 'disabled';
    c.innerHTML = `<div class="card"><form id="mpa"><div class="grid-form">
      <label class="xs">Custo da hora interna (R$)<input name="ch" inputmode="decimal" value="${nf(p.custo_hora, 2)}" ${dis}></label>
      <label class="xs">Antecedência das preventivas (dias)<input name="an" type="number" min="0" value="${p.antecedencia_dias}" ${dis}></label>
      <label class="xs">Tolerância "no prazo" (%)<input name="to" inputmode="decimal" value="${nf(p.tolerancia_pct, 0)}" ${dis}></label>
      <label class="xs">Horas por dia (disponibilidade)<input name="hd" type="number" min="1" max="24" value="${p.horas_dia}" ${dis}></label>
    </div><label class="chk" style="margin-top:12px;display:flex;gap:8px;align-items:center"><input type="checkbox" name="op" ${p.abrir_os_pela_parada ? 'checked' : ''} ${dis}> Parada por manutenção no Terminal do Setor abre OS automaticamente</label></form>
    <ul class="small muted"><li><b>Custo da hora</b>: salário + encargos do mecânico ÷ horas trabalhadas no mês; multiplica as horas lançadas na OS.</li>
      <li><b>Antecedência</b>: quantos dias antes do vencimento a OS preventiva é gerada (para dar tempo de programar com o PCP).</li>
      <li><b>Tolerância</b>: preventiva feita até esse percentual além do vencimento ainda conta como "no prazo" na aderência.</li>
      <li><b>Abrir OS pela parada</b>: quando o operador aponta parada de motivo do tipo manutenção, a manutenção recebe a solicitação (emergência se o equipamento for crítico A).</li></ul>
    ${ger ? '<div style="text-align:right"><button class="btn primary" id="mpa-ok">Salvar parâmetros</button></div>' : ''}</div>`;
    $('#mpa-ok', c) && ($('#mpa-ok', c).onclick = async () => {
      const f = $('#mpa', c);
      try { await q(sb.from('man_parametros').upsert({ empresa_id: state.empresa.id, custo_hora: parseNum(f.ch.value) || 0, antecedencia_dias: +f.an.value || 0, tolerancia_pct: parseNum(f.to.value) || 0,
        horas_dia: Math.min(24, Math.max(1, +f.hd.value || 24)), abrir_os_pela_parada: f.op.checked, atualizado_em: new Date().toISOString() })); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
    });
    c.onclick = null;
  }
}

function formEquip(e, root) {
  e = e || { tipo: 'maquina', criticidade: 'B', situacao: 'operando' };
  const md = modal({ title: e.id ? `Equipamento ${e.codigo}` : 'Novo equipamento', wide: true, body: `<form id="fe"><div class="grid-form">
    <label class="xs">Código *<input name="codigo" required value="${esc(e.codigo || '')}"></label><label class="span2">Nome *<input name="nome" required value="${esc(e.nome || '')}"></label>
    <label>Tipo<select name="tipo">${Object.entries(M.TIPOS_EQUIP).map(([k, t]) => `<option value="${k}" ${e.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="xs">Criticidade<select name="crit">${[['A', 'A — para a fábrica'], ['B', 'B — atrapalha'], ['C', 'C — baixa']].map(([k, t]) => `<option value="${k}" ${e.criticidade === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="xs">Situação<select name="sit">${Object.entries(M.SIT_EQUIP).map(([k, t]) => `<option value="${k}" ${e.situacao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Máquina da produção<select name="maq">${options(D.Mq.filter(m => m.id === e.maquina_id || !D.E.some(x => x.maquina_id === m.id)).map(m => ({ id: m.id, nome: `${m.codigo} · ${m.nome}` })), { selected: e.maquina_id, empty: '— não é máquina de produção —' })}</select></label>
    <label>Setor<select name="setor">${options(D.S, { selected: e.setor_id, empty: '—' })}</select></label>
    <label>Centro de custo<select name="cc">${options(state.cad.cc, { selected: e.centro_custo_id, empty: '—' })}</select></label>
    <label>Bem do imobilizado<select name="bem">${options(BENS.map(x => ({ id: x.id, nome: `${x.plaqueta} · ${x.descricao}` })), { selected: e.bem_id, empty: '—' })}</select></label>
    <label>Componente de<select name="pai">${options(D.E.filter(x => x.id !== e.id).map(x => ({ id: x.id, nome: `${x.codigo} · ${x.nome}` })), { selected: e.pai_id, empty: '— equipamento principal —' })}</select></label>
    <label>Local<input name="local" value="${esc(e.local || '')}"></label>
    <label>Fabricante<input name="fab" value="${esc(e.fabricante || '')}"></label><label>Modelo<input name="mod" value="${esc(e.modelo || '')}"></label>
    <label class="xs">Nº de série<input name="serie" value="${esc(e.serie || '')}"></label><label class="xs">Ano<input name="ano" type="number" value="${e.ano || ''}"></label>
    <label class="xs">Garantia até<input name="gar" type="date" value="${e.garantia_ate || ''}"></label>
    <label class="xs">Horímetro<input name="hor" inputmode="decimal" value="${e.horimetro != null ? nf(e.horimetro) : ''}" placeholder="${e.maquina_id ? 'pelos apontamentos' : ''}"></label>
    <label class="full">Observação<textarea name="obs" rows="2">${esc(e.observacao || '')}</textarea></label>
  </div><p class="muted small">Máquina ligada à produção: as horas de máquina saem dos apontamentos (Terminal do Setor e Iniflex), sem horímetro. Equipamento sem apontamento (compressor, chiller, empilhadeira) usa o horímetro, atualizado pelas leituras.</p></form>`,
    foot: `${e.id ? '<button class="btn danger" id="fe-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="fe-ok">Salvar</button>` });
  $('#fe-ok', md.el).onclick = async () => {
    const f = $('#fe', md.el); if (!f.reportValidity()) return;
    const reg = { empresa_id: state.empresa.id, codigo: f.codigo.value.trim(), nome: f.nome.value.trim(), tipo: f.tipo.value, criticidade: f.crit.value, situacao: f.sit.value, maquina_id: f.maq.value || null,
      setor_id: f.setor.value || null, centro_custo_id: f.cc.value || null, bem_id: f.bem.value || null, pai_id: f.pai.value || null, local: f.local.value.trim() || null, fabricante: f.fab.value.trim() || null,
      modelo: f.mod.value.trim() || null, serie: f.serie.value.trim() || null, ano: +f.ano.value || null, garantia_ate: f.gar.value || null, observacao: f.obs.value.trim() || null };
    const h = f.hor.value.trim(); if (h && parseNum(h) !== +e.horimetro) { reg.horimetro = parseNum(h); reg.horimetro_em = today(); }
    try { e.id ? await q(sb.from('man_equipamentos').update(reg).eq('id', e.id)) : await q(sb.from('man_equipamentos').insert(reg)); md.close(); toast('Equipamento salvo'); render(root); } catch (err) { fail(err); }
  };
  $('#fe-del', md.el) && ($('#fe-del', md.el).onclick = async () => {
    if (D.O.some(o => o.equipamento_id === e.id)) return toast('Equipamento com OS não pode ser excluído — marque como Inativo', true);
    if (!await confirmDialog(`Excluir ${e.codigo}? Os planos dele também saem.`)) return;
    try { await q(sb.from('man_equipamentos').delete().eq('id', e.id)); md.close(); toast('Excluído'); render(root); } catch (err) { fail(err); }
  });
}

async function fichaEquip(e, root) {
  const agora = Date.now(), ger = podePCP(), re = () => render(root);
  const os = D.O.filter(o => o.equipamento_id === e.id), pls = D.Pl.filter(p => p.equipamento_id === e.id);
  const de90 = new Date(agora - 90 * 86400000).toISOString(), de365 = new Date(agora - 365 * 86400000).toISOString(), ate = new Date().toISOString();
  const i90 = M.indicadores(os, { de: de90, ate, agora }), i12 = M.indicadores(os, { de: de365, ate, agora });
  const custo = os.filter(o => o.solicitada_em >= de365).map(o => M.custoOS(o, D.H, D.Pc, +D.P.custo_hora || 0)).reduce((s, c) => ({ pecas: s.pecas + c.pecas, mao: s.mao + c.mao, ter: s.ter + c.terceiros, tot: s.tot + c.total }), { pecas: 0, mao: 0, ter: 0, tot: 0 });
  const lei = await q(sb.from('man_leituras').select('*').eq('equipamento_id', e.id).order('data', { ascending: false }).limit(10)).catch(() => []);
  const par = M.pareto(os.filter(o => o.situacao === 'concluida'), D.F, agora).slice(0, 5);
  const md = modal({ title: `${e.codigo} — ${e.nome}`, wide: true, body: `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${selo(M.SIT_EQUIP[e.situacao], corSit(e.situacao))}${selo('Criticidade ' + e.criticidade, e.criticidade === 'A' ? 'neg' : '')}${selo(M.TIPOS_EQUIP[e.tipo]?.split(' (')[0] || e.tipo)}
      <span class="muted small">${esc([e.fabricante, e.modelo, e.serie && 'série ' + e.serie, e.ano, e.garantia_ate && `garantia até ${dateBR(e.garantia_ate)}`].filter(Boolean).join(' · '))}</span></div>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="k-label">Disponibilidade 90 dias</div><div class="k-value">${pctTxt(i90.disponibilidade)}</div><div class="k-sub">${nf(i90.horasParadas)} h paradas</div></div>
      <div class="kpi"><div class="k-label">MTBF 12 meses</div><div class="k-value">${i12.mtbf != null ? nf(i12.mtbf, 0) + ' h' : '–'}</div><div class="k-sub">${i12.falhas} quebra(s)</div></div>
      <div class="kpi"><div class="k-label">MTTR 12 meses</div><div class="k-value">${i12.mttr != null ? nf(i12.mttr) + ' h' : '–'}</div></div>
      <div class="kpi"><div class="k-label">Custo 12 meses</div><div class="k-value">${money(custo.tot)}</div><div class="k-sub">peças ${money(custo.pecas)} · M.O. ${money(custo.mao)} · terc. ${money(custo.ter)}</div></div>
      <div class="kpi"><div class="k-label">Horas de máquina</div><div class="k-value">${D.horasEq[e.id] != null ? nf(D.horasEq[e.id], 0) + ' h' : '–'}</div><div class="k-sub">${e.maquina_id ? 'pelos apontamentos' : e.horimetro_em ? 'horímetro em ' + dateBR(e.horimetro_em) : 'sem horímetro'}</div></div></div>
    <div class="grid2" style="margin-top:12px">
      <div><h4 style="margin:4px 0">Planos</h4>${pls.map(p => { const s = M.statusPlano(p, D.horasEq[e.id] || 0); return `<div class="mn-check" style="justify-content:space-between"><span>${esc(p.nome)}<div class="small muted">${esc(s.txt)}</div></span>${selo(s.nivel === 'neg' ? 'Vencido' : s.nivel === 'warn' ? 'Próximo' : 'Em dia', s.nivel === 'ok' ? 'pos' : s.nivel)}</div>`; }).join('') || '<p class="muted small">Sem plano preventivo.</p>'}
        ${ger ? '<button class="btn small" id="fq-pl" type="button" style="margin-top:6px">+ Plano para este equipamento</button>' : ''}</div>
      <div><h4 style="margin:4px 0">Falhas que mais param</h4>${par.map(x => `<div class="mn-check" style="justify-content:space-between"><span>${esc(x.nome)}</span><span class="small">${x.n} OS · ${nf(x.horas)} h</span></div>`).join('') || '<p class="muted small">Nenhuma corretiva registrada.</p>'}
        ${!e.maquina_id && podeApontar() ? `<h4 style="margin:12px 0 4px">Leitura do horímetro</h4><div style="display:flex;gap:6px"><input id="fq-lh" inputmode="decimal" placeholder="horas" style="width:110px"><input id="fq-ld" type="date" value="${today()}"><button class="btn small" id="fq-lok" type="button">Registrar</button></div>
          <div class="small muted">${lei.map(l => `${dateBR(l.data)}: ${nf(l.horimetro)} h`).join(' · ')}</div>` : ''}</div></div>
    <h4 style="margin:14px 0 4px">Histórico de OS (${os.length})</h4><div class="table-wrap" style="max-height:280px"><table><tr><th>OS</th><th>Serviço</th><th>Situação</th><th class="num">Custo</th></tr>
      ${os.slice(0, 60).map(o => `<tr class="clickable" data-os="${o.id}"><td><b>${o.numero}</b><div class="small muted">${dateBR(o.solicitada_em.slice(0, 10))}</div></td><td class="wrap">${esc(M.TIPOS_OS[o.tipo])} — ${esc(o.descricao)}${o.solucao ? `<div class="small muted">✔ ${esc(o.solucao)}</div>` : ''}</td>
        <td>${selo(M.SITUACOES[o.situacao], clsSit(o.situacao))}</td><td class="num">${money(M.custoOS(o, D.H, D.Pc, +D.P.custo_hora || 0).total)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sem OS.</td></tr>'}</table></div>`,
    foot: `${ger ? '<button class="btn" id="fq-ed">Editar cadastro</button>' : ''}<span class="spacer"></span>${podeApontar() ? '<button class="btn primary" id="fq-os">Abrir OS</button>' : ''}` });
  $('#fq-ed', md.el) && ($('#fq-ed', md.el).onclick = () => { md.close(); formEquip(e, root); });
  $('#fq-os', md.el) && ($('#fq-os', md.el).onclick = () => { md.close(); novaOS(D, { pre: { equipamento_id: e.id }, onSalvo: re }); });
  $('#fq-pl', md.el) && ($('#fq-pl', md.el).onclick = () => { md.close(); formPlano({ equipamento_id: e.id }, root); });
  $('#fq-lok', md.el) && ($('#fq-lok', md.el).onclick = async () => {
    const h = parseNum($('#fq-lh', md.el).value); if (!(h >= 0) || !$('#fq-lh', md.el).value.trim()) return toast('Informe a leitura', true);
    try { await q(sb.from('man_leituras').insert({ empresa_id: state.empresa.id, equipamento_id: e.id, data: $('#fq-ld', md.el).value || today(), horimetro: h })); md.close(); toast('Leitura registrada'); render(root); } catch (err) { fail(err); }
  });
  $$('[data-os]', md.el).forEach(r => r.onclick = () => { md.close(); fichaOS(D, D.O.find(o => o.id === r.dataset.os), { onMudou: re }); });
}

function formPlano(p, root) {
  p = p || {}; const novo = !p.id, ck = [...(p.checklist || [])], pc = Array.isArray(p.pecas) ? [...p.pecas] : [];
  const md = modal({ title: novo ? 'Novo plano preventivo' : p.nome, wide: true, body: `<form id="fp"><div class="grid-form">
    <label class="span2">Equipamento *<select name="eq" required>${options(D.E.filter(e => e.situacao !== 'inativo' || e.id === p.equipamento_id).map(e => ({ id: e.id, nome: `${e.codigo} · ${e.nome}` })), { selected: p.equipamento_id, empty: '— escolha —' })}</select></label>
    <label class="span2">Nome do plano *<input name="nome" required value="${esc(p.nome || '')}" placeholder="Ex.: Lubrificação do redutor"></label>
    <label>Tipo<select name="tipo">${Object.entries(M.TIPOS_PLANO).map(([k, t]) => `<option value="${k}" ${(p.tipo || 'preventiva') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="xs">A cada (dias)<input name="dias" type="number" min="1" value="${p.a_cada_dias || ''}"></label>
    <label class="xs">A cada (horas de máquina)<input name="horas" inputmode="decimal" value="${p.a_cada_horas ? nf(p.a_cada_horas, 0) : ''}"></label>
    <label class="xs">Duração prevista (h)<input name="dur" inputmode="decimal" value="${p.duracao_h ? nf(p.duracao_h) : ''}"></label>
    <label>Especialidade<input name="esp" value="${esc(p.especialidade || '')}" placeholder="mecânica, elétrica…"></label>
    <label class="xs">Última execução<input name="ud" type="date" value="${p.ultima_data || ''}"></label>
    <label class="xs">Horas na última<input name="uh" inputmode="decimal" value="${p.ultima_horas != null ? nf(p.ultima_horas, 0) : ''}"></label>
    <label class="chk"><input type="checkbox" name="par" ${p.exige_parada !== false ? 'checked' : ''}> Exige parar a máquina</label>
    <label class="chk xs"><input type="checkbox" name="at" ${p.ativo !== false ? 'checked' : ''}> Ativo</label>
  </div>
  <h4 style="margin:12px 0 4px">Checklist (um item por linha)</h4><textarea name="ck" rows="6" style="width:100%" placeholder="Verificar nível de óleo do redutor&#10;Reapertar terminais das resistências&#10;Limpar filtro de ar do painel">${esc(ck.join('\n'))}</textarea>
  <h4 style="margin:12px 0 4px">Peças previstas</h4><div id="fp-pc"></div>
  <div style="display:flex;gap:6px;margin-top:6px"><select id="fp-pp" style="flex:1">${options(D.Pr.map(x => ({ id: x.id, nome: `${x.codigo} · ${x.descricao} (${x.unidade})` })), { empty: '— peça —' })}</select><input id="fp-pq" inputmode="decimal" placeholder="qtd." style="width:90px"><button class="btn small" id="fp-pa" type="button">Adicionar</button></div>
  <p class="muted small">Informe dias, horas ou os dois — vence o que chegar primeiro. A última execução atualiza sozinha quando a OS do plano é concluída.</p></form>`,
    foot: `${!novo ? '<button class="btn danger" id="fp-del">Excluir</button>' : ''}<span class="spacer"></span>${!novo && podeApontar() ? '<button class="btn" id="fp-os">Abrir OS agora</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fp-ok">Salvar</button>` });
  const pintaPc = () => { $('#fp-pc', md.el).innerHTML = pc.map((x, i) => `<div class="mn-check"><span style="flex:1">${esc(D.prById[x.produto_id] ? `${D.prById[x.produto_id].codigo} · ${D.prById[x.produto_id].descricao}` : x.produto_id)}</span><span>${nf(x.quantidade, 2)}</span><button class="btn ghost small" data-rp="${i}" type="button">✕</button></div>`).join('') || '<span class="muted small">Nenhuma.</span>'; };
  pintaPc();
  $('#fp-pc', md.el).onclick = (ev) => { const i = ev.target.closest('[data-rp]')?.dataset.rp; if (i != null) { pc.splice(+i, 1); pintaPc(); } };
  $('#fp-pa', md.el).onclick = () => { const id = $('#fp-pp', md.el).value, qt = parseNum($('#fp-pq', md.el).value); if (!id || !(qt > 0)) return toast('Escolha a peça e a quantidade', true); pc.push({ produto_id: id, quantidade: qt }); pintaPc(); };
  $('#fp-ok', md.el).onclick = async () => {
    const f = $('#fp', md.el); if (!f.reportValidity()) return;
    const dias = +f.dias.value || null, horas = f.horas.value.trim() ? parseNum(f.horas.value) : null;
    if (!dias && !horas) return toast('Informe o intervalo em dias ou em horas de máquina', true);
    const reg = { empresa_id: state.empresa.id, equipamento_id: f.eq.value, nome: f.nome.value.trim(), tipo: f.tipo.value, a_cada_dias: dias, a_cada_horas: horas, duracao_h: f.dur.value.trim() ? parseNum(f.dur.value) : null,
      especialidade: f.esp.value.trim() || null, ultima_data: f.ud.value || null, ultima_horas: f.uh.value.trim() ? parseNum(f.uh.value) : null, exige_parada: f.par.checked, ativo: f.at.checked,
      checklist: f.ck.value.split('\n').map(s => s.trim()).filter(Boolean), pecas: pc };
    try { novo ? await q(sb.from('man_planos').insert(reg)) : await q(sb.from('man_planos').update(reg).eq('id', p.id)); md.close(); toast('Plano salvo'); render(root); } catch (err) { fail(err); }
  };
  $('#fp-del', md.el) && ($('#fp-del', md.el).onclick = async () => { if (!await confirmDialog('Excluir este plano? As OS já geradas ficam no histórico.')) return; try { await q(sb.from('man_planos').delete().eq('id', p.id)); md.close(); toast('Plano excluído'); render(root); } catch (err) { fail(err); } });
  $('#fp-os', md.el) && ($('#fp-os', md.el).onclick = async () => {
    if (D.O.some(o => o.plano_id === p.id && M.ABERTAS.includes(o.situacao))) return toast('Este plano já tem uma OS aberta', true);
    try { const [o] = await q(sb.from('man_ordens').insert({ empresa_id: state.empresa.id, equipamento_id: p.equipamento_id, tipo: p.tipo, origem: 'plano', plano_id: p.id, prioridade: 'media', situacao: 'aberta',
      descricao: p.nome, vence_em: M.statusPlano(p, D.horasEq[p.equipamento_id] || 0).prox, checklist: (p.checklist || []).map(item => ({ item, ok: null, obs: null })) }).select());
      md.close(); toast(`OS ${o.numero} aberta`); render(root); } catch (err) { fail(err); }
  });
}

function formFalha(f, root) {
  f = f || { categoria: 'mecanica', ativo: true };
  const md = modal({ title: f.id ? 'Falha' : 'Nova falha', narrow: true, body: `<form id="ff"><div class="grid-form">
    <label class="xs">Código *<input name="codigo" required value="${esc(f.codigo || '')}"></label><label class="span2">Descrição *<input name="nome" required value="${esc(f.nome || '')}"></label>
    <label>Categoria<select name="cat">${Object.entries(M.CATEGORIAS).map(([k, t]) => `<option value="${k}" ${f.categoria === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="chk xs"><input type="checkbox" name="at" ${f.ativo ? 'checked' : ''}> Ativa</label></div></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ff-ok">Salvar</button>` });
  $('#ff-ok', md.el).onclick = async () => {
    const x = $('#ff', md.el); if (!x.reportValidity()) return;
    const reg = { empresa_id: state.empresa.id, codigo: x.codigo.value.trim().toUpperCase(), nome: x.nome.value.trim(), categoria: x.cat.value, ativo: x.at.checked };
    try { f.id ? await q(sb.from('man_falhas').update(reg).eq('id', f.id)) : await q(sb.from('man_falhas').insert(reg)); md.close(); toast('Falha salva'); render(root); } catch (err) { fail(err); }
  };
}

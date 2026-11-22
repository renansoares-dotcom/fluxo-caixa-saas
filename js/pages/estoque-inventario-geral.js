// Compras › Estoque › Inventário Geral (EST010) — SQL 182, 183 e 184, 22/11/2026.
// O inventário do dia 01: data de referência, locais congelados, contagem cega por quem responde pelo local, auditoria cega por outra
// pessoa (rodízio), terceira contagem quando divergem, ajustes na data de referência e fechamento do mês na aprovação.
// A lista de itens vem só por função: quem conta não recebe o saldo; quem audita não recebe o saldo nem a contagem.
import { sb, state, q, isAdmin } from '../lib/data.js';
import { $, $$, esc, money, fail, toast, modal, dateBR, parseNum } from '../lib/ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';

export const title = 'Inventário Geral';
let D = null;
const n = (v, d = 3) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }));
const pct = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');
const SIT = { aberto: ['Em andamento', 'aberto'], aprovado: ['Aprovado', 'pago'], cancelado: ['Cancelado', ''], estornado: ['Desfeito', 'vencido'] };
const SIT_L = { contando: ['Contando', 'aberto'], auditando: ['Em auditoria', 'negoc'], terceira: ['Terceira contagem', 'vencido'], concluido: ['Concluído', 'pago'] };
const CFG = { amostra_pct: 100, amostra_classe_a: true, amostra_divergentes: true, tolerancia_pct: 2, tolerancia_valor: 100, dif_auditoria_pct: 0.5, papeis_aprovacao: ['admin', 'diretor', 'financeiro'], aprovar_quem_contou: false, fechar_mes: true, esconder_saldo: true };
const gerencia = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
const aprova = () => D.cfg.papeis_aprovacao.includes(state.papel);
const ir = (root, i, l) => { history.replaceState(null, '', '#/estoque/inventario-geral' + (i ? '?i=' + i + (l ? '&l=' + l : '') : '')); render(root); };
const fimMesAnterior = () => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const minutos = (m) => (m == null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);

export async function render(root) {
  const par = new URLSearchParams(location.hash.split('?')[1] || ''), iid = par.get('i'), lid = par.get('l');
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id;
    const [invs, locais, cfg, impl] = await Promise.all([
      q(sb.from('est_ig_inventarios').select('*').eq('empresa_id', e).order('numero', { ascending: false }).limit(60)),
      q(sb.from('est_locais').select('id,codigo,nome').eq('empresa_id', e).eq('ativo', true).eq('controla_saldo', true).order('ordem')),
      q(sb.from('est_ig_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.from('est_config').select('implantado_em').eq('empresa_id', e).maybeSingle()).catch(() => null)]);
    D = { invs, locais, loc: Object.fromEntries(locais.map(l => [l.id, l])), cfg: { ...CFG, ...(cfg || {}) }, implantado: !!impl?.implantado_em };
    const g = iid && invs.find(x => x.id === iid);
    if (!g) return lista(root);
    D.igl = await q(sb.from('est_ig_locais').select('*').eq('inventario_id', g.id));
    D.igl.sort((a, b) => (D.loc[a.local_id]?.nome || '').localeCompare(D.loc[b.local_id]?.nome || ''));
    const gl = lid && D.igl.find(x => x.id === lid);
    if (gl && g.situacao === 'aberto') return contar(root, g, gl);
    await painel(root, g);
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 182 já foi executado.</div></div>'; }
}

// ------------------------------------------------------------ lista de inventários
function lista(root) {
  const aberto = D.invs.find(g => g.situacao === 'aberto');
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Inventário Geral</h2><div class="muted small">O inventário do dia 01: contagem cega por local, auditoria por outra pessoa e ajuste na data de referência.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${isAdmin() ? '<button class="btn" id="ig-par">Parâmetros</button>' : ''}${gerencia() && !aberto ? '<button class="btn primary" id="ig-novo">Abrir inventário</button>' : ''}</div></div>
    ${D.implantado ? '' : '<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px"><b>O estoque ainda não foi implantado.</b> O primeiro inventário geral serve de implantação: o que for contado e auditado vira o saldo inicial de cada local, na data de referência.</div>'}
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Data de referência</th><th>Aberto por</th><th>Situação</th><th class="num">Ajustes</th><th class="num">Valor dos ajustes</th><th>Mês fechado</th><th>Decidido por</th></tr></thead><tbody>
      ${D.invs.map(g => { const s = SIT[g.situacao]; return `<tr data-i="${g.id}" style="cursor:pointer"><td><b>${g.numero}</b>${g.implantacao ? ' <span class="badge negoc">implantação</span>' : ''}</td><td>${dateBR(g.referencia)}</td>
        <td>${esc(g.criado_nome || '')} <span class="muted small">${dateBR(g.criado_em)}</span></td><td><span class="badge ${s[1]}">${s[0]}</span></td><td class="num">${g.ajustes ?? '—'}</td>
        <td class="num ${g.valor_ajuste < 0 ? 'neg' : ''}">${g.valor_ajuste == null ? '—' : money(g.valor_ajuste)}</td><td>${g.mes_fechado == null ? '—' : g.mes_fechado ? 'Sim' : 'Não'}</td>
        <td>${esc(g.decidido_nome || '')} <span class="muted small">${g.decidido_em ? dateBR(g.decidido_em) : ''}</span></td></tr>`; }).join('')
        || '<tr><td colspan="8" class="empty">Nenhum inventário geral. Use Abrir inventário: escolha a data de referência, os locais e quem conta cada um.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-i]', root).forEach(tr => tr.onclick = () => ir(root, tr.dataset.i));
  $('#ig-par', root) && ($('#ig-par', root).onclick = () => parametros(root));
  $('#ig-novo', root) && ($('#ig-novo', root).onclick = () => novo(root));
}

async function novo(root) {
  let pessoas; try { pessoas = await q(sb.rpc('est_ig_pessoas', { p_empresa: state.empresa.id })); } catch (e) { return fail(e); }
  const semAud = !(D.cfg.amostra_pct > 0 || D.cfg.amostra_classe_a || D.cfg.amostra_divergentes);
  const op = (v) => pessoas.map(p => `<option value="${p.user_id}" ${p.user_id === v ? 'selected' : ''}>${esc(p.nome || '')}</option>`).join('');
  const m = modal({ title: 'Abrir inventário geral', wide: true, body: `<div class="grid-form"><label>Data de referência<input type="date" id="nv-d" value="${fimMesAnterior()}" max="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Observação<input id="nv-o" maxlength="500" placeholder="Opcional"></label></div>
    <p class="small muted" style="margin:6px 0">Os ajustes entram na data de referência (o último dia do mês anterior). Enquanto o local não terminar a contagem e a auditoria, nenhum movimento entra nele.</p>
    <div class="table-wrap"><table class="small"><thead><tr><th style="width:28px"><input type="checkbox" id="nv-t" checked></th><th>Local</th><th>Quem conta</th><th>Quem audita</th></tr></thead><tbody>
      ${D.locais.map(l => `<tr data-l="${l.id}"><td><input type="checkbox" class="nv-c" checked></td><td><b>${esc(l.codigo)}</b> ${esc(l.nome)}</td>
        <td><select class="nv-r"><option value="">Escolha…</option>${op()}</select></td>
        <td><select class="nv-a" ${semAud ? 'disabled' : ''}><option value="">${semAud ? 'Sem auditoria (parâmetros)' : 'Rodízio (automático)'}</option>${op()}</select></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">No rodízio, cada local é auditado por quem conta o local seguinte da lista. Quem conta nunca audita o próprio local.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nv-ok">Abrir e congelar os locais</button>' });
  $('#nv-t', m.el).onchange = (e) => $$('.nv-c', m.el).forEach(c => { c.checked = e.target.checked; });
  $('#nv-ok', m.el).onclick = async () => {
    const L = $$('tr[data-l]', m.el).filter(tr => $('.nv-c', tr).checked).map(tr => ({ local_id: tr.dataset.l, responsavel_id: $('.nv-r', tr).value, auditor_id: $('.nv-a', tr).value || null }));
    if (!L.length) return toast('Escolha pelo menos um local', true);
    if (L.some(l => !l.responsavel_id)) return toast('Informe quem conta cada local escolhido', true);
    if (!confirm(`Abrir o inventário de ${L.length} local(is)? Eles ficam congelados até a contagem e a auditoria terminarem.`)) return;
    try { const id = await q(sb.rpc('est_ig_abrir', { p_empresa: state.empresa.id, p_referencia: $('#nv-d', m.el).value, p_locais: L, p_observacao: $('#nv-o', m.el).value || null }));
      m.close(); toast('Inventário aberto: os responsáveis foram avisados'); ir(root, id); } catch (e) { fail(e); }
  };
}

// ------------------------------------------------------------ painel do inventário
async function painel(root, g) {
  const eu = state.user.id, cego = g.situacao === 'aberto' && D.igl.some(l => l.situacao !== 'concluido' && [l.responsavel_id, l.auditor_id].includes(eu));
  const vejo = (gerencia() || aprova()) && !cego;   // quem conta ou audita só vê o resultado depois que o seu local terminar
  const [and, det, acu] = await Promise.all([q(sb.rpc('est_ig_andamento', { p_inventario: g.id })).catch(() => []),
    vejo ? q(sb.rpc('est_ig_detalhe', { p_inventario: g.id })).catch(() => []) : [], vejo ? q(sb.rpc('est_ig_acuracidade', { p_inventario: g.id })).catch(() => []) : []]);
  const A = Object.fromEntries(and.map(a => [a.ig_local_id, a])), AC = Object.fromEntries(acu.map(a => [a.ig_local_id, a]));
  const s = SIT[g.situacao], aberto = g.situacao === 'aberto', pronto = aberto && D.igl.length && D.igl.every(l => l.situacao === 'concluido');
  const dif = det.filter(i => i.final != null ? +i.final !== +i.saldo_ref : (i.contado != null && +i.contado !== +i.saldo_ref));   // saldo_ref = saldo do local no congelamento
  const semCusto = det.filter(i => +(i.final ?? i.contado ?? 0) > +i.saldo_ref && !+i.custo);
  const tot = { itens: det.length, sobra: dif.filter(i => +i.valor > 0).reduce((t, i) => t + +i.valor, 0), falta: dif.filter(i => +i.valor < 0).reduce((t, i) => t + +i.valor, 0) };
  const acao = (l) => { if (!aberto) return ''; const b = (t) => `<button class="btn primary small" data-ir="${l.id}">${t}</button>`;
    if (l.situacao === 'contando' && l.responsavel_id === eu) return b('Contar');
    if (l.situacao === 'auditando' && l.auditor_id === eu) return b('Auditar');
    if (l.situacao === 'terceira' && [l.responsavel_id, l.auditor_id].includes(eu)) return b('Terceira contagem');
    return ''; };
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Inventário geral nº ${g.numero} <span class="badge ${s[1]}">${s[0]}</span>${g.implantacao ? ' <span class="badge negoc">implantação</span>' : ''}</h2>
      <div class="muted small">Data de referência ${dateBR(g.referencia)} · aberto por ${esc(g.criado_nome || '')} em ${dateBR(g.criado_em)}${g.observacao ? ' · ' + esc(g.observacao) : ''}${g.motivo ? ' · motivo: ' + esc(g.motivo) : ''}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end"><button class="btn ghost" id="pg-v">← Inventários</button>
      ${aberto && gerencia() ? '<button class="btn" id="pg-x">Cancelar inventário</button>' : ''}${vejo && det.length ? '<button class="btn" id="pg-rel">Relatório</button>' : ''}
      ${g.situacao === 'aprovado' && isAdmin() && !D.invs.some(x => x.situacao === 'aprovado' && x.numero > g.numero) ? '<button class="btn" id="pg-des">Desfazer inventário</button>' : ''}
      ${aberto && aprova() ? `<button class="btn primary" id="pg-ok" ${pronto ? '' : 'disabled'}>Aprovar e lançar os ajustes</button>` : ''}</div></div>
    ${aberto ? `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">Local em contagem ou auditoria fica <b>congelado</b>: nenhum movimento entra nele. Depois de concluído o local volta a movimentar, mas movimento com data até ${dateBR(g.referencia)} só depois da aprovação.</div>` : ''}
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Locais concluídos</div><div class="k-value">${D.igl.filter(l => l.situacao === 'concluido').length} de ${D.igl.length}</div><div class="k-sub">contagem, auditoria e terceira contagem</div></div>
      <div class="kpi"><div class="k-label">Itens contados</div><div class="k-value">${and.reduce((t, a) => t + a.contados, 0)} de ${and.reduce((t, a) => t + a.itens, 0)}</div><div class="k-sub">${and.reduce((t, a) => t + a.auditados, 0)} de ${and.reduce((t, a) => t + a.na_amostra, 0)} auditados</div></div>
      ${vejo ? `<div class="kpi"><div class="k-label">Sobras</div><div class="k-value">${money(tot.sobra)}</div><div class="k-sub">${dif.filter(i => +i.diferenca > 0).length} item(ns)</div></div>
      <div class="kpi"><div class="k-label">Faltas</div><div class="k-value ${tot.falta < 0 ? 'neg' : ''}">${money(tot.falta)}</div><div class="k-sub">${dif.filter(i => +i.diferenca < 0).length} item(ns)</div></div>` : ''}</div>
    <div class="card flush" style="margin-bottom:12px"><div class="table-wrap"><table class="small"><thead><tr><th>Local</th><th>Quem conta</th><th>Quem audita</th><th>Situação</th><th class="num">Contados</th><th class="num">Auditados</th><th class="num">Divergiram</th>
      ${vejo ? '<th class="num">Acuracidade (itens)</th><th class="num">Acuracidade (valor)</th><th class="num">Tempo de contagem</th>' : ''}<th></th></tr></thead><tbody>
      ${D.igl.map(l => { const a = A[l.id] || { itens: 0, contados: 0, na_amostra: 0, auditados: 0, divergentes: 0, resolvidos: 0 }, c = AC[l.id], sl = SIT_L[l.situacao];
        return `<tr><td><b>${esc(D.loc[l.local_id]?.codigo || '')}</b> ${esc(D.loc[l.local_id]?.nome || '')}</td><td>${esc(l.responsavel_nome || '')}</td><td>${esc(l.auditor_nome || '—')}</td><td><span class="badge ${sl[1]}">${sl[0]}</span></td>
          <td class="num">${a.contados} de ${a.itens}</td><td class="num">${l.situacao === 'contando' ? '—' : `${a.auditados} de ${a.na_amostra}`}</td><td class="num">${a.divergentes + a.resolvidos || '—'}</td>
          ${vejo ? `<td class="num">${c && l.situacao !== 'contando' ? pct(c.pct_itens) : '—'}</td><td class="num">${c && l.situacao !== 'contando' ? pct(c.pct_valor) : '—'}</td><td class="num">${minutos(c?.minutos_contagem)}</td>` : ''}
          <td style="white-space:nowrap">${acao(l)} ${aberto && (gerencia() || [l.responsavel_id, l.auditor_id].includes(eu)) ? `<button class="btn ghost small" data-guia="${l.id}">Guia cega</button>` : ''}
            ${aberto && gerencia() && l.situacao !== 'concluido' ? `<button class="btn ghost small" data-troca="${l.id}">Trocar pessoas</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>
    ${vejo ? `<div class="card flush"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;flex-wrap:wrap"><b>Resultado</b>
        <div style="display:flex;gap:8px;align-items:center"><select id="pg-fl"><option value="">Todos os locais</option>${D.igl.map(l => `<option value="${l.id}">${esc(D.loc[l.local_id]?.nome || '')}</option>`).join('')}</select>
        <label style="display:flex;flex-direction:row;gap:6px;align-items:center;font-weight:400;margin:0;white-space:nowrap"><input type="checkbox" id="pg-sd" checked> Só as diferenças</label></div></div>
      ${semCusto.length && aberto ? `<div class="small" style="padding:0 14px 10px;color:var(--warn)">${semCusto.length} item(ns) com sobra não têm custo: informe o custo na linha (botão Custo) antes de aprovar.</div>` : ''}
      <div class="table-wrap"><table class="small"><thead><tr><th>Local</th><th>Item</th><th class="num" title="Saldo do local no momento em que foi congelado">Sistema</th><th class="num">Contado</th><th class="num">Auditado</th><th class="num">3ª contagem</th><th class="num">Vale</th><th class="num">Diferença</th><th class="num" title="Custo na data de referência">Custo</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody id="pg-tb"></tbody></table></div>
      ${aberto ? '<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 14px"><span class="small muted" style="align-self:center">Marque os itens de um local concluído para pedir recontagem, sem cancelar o inventário.</span><button class="btn" id="pg-rc">Pedir recontagem dos marcados</button></div>' : ''}</div>` : `<div class="card small muted">${cego ? 'Você conta ou audita um local deste inventário: o resultado, com o saldo do sistema, aparece depois que o seu local terminar.' : 'O resultado, com o saldo do sistema e as diferenças, fica visível para quem gerencia ou aprova o inventário.'}</div>`}`;
  const SL = Object.fromEntries(D.igl.map(l => [l.id, l.situacao]));
  const linhas = () => { const fl = $('#pg-fl', root).value, sd = $('#pg-sd', root).checked, L = det.filter(i => (!fl || i.ig_local_id === fl) && (!sd || dif.includes(i)));
    $('#pg-tb', root).innerHTML = L.map(i => `<tr><td>${esc(D.loc[i.local_id]?.codigo || '')}</td><td>${esc(i.codigo)} ${esc(i.descricao)}${i.lote ? ` · lote ${esc(i.lote)}` : ''}${i.incluido ? ' <span class="badge negoc">achado</span>' : ''}${i.justificativa ? `<div class="muted">${esc(i.justificativa)}</div>` : ''}</td>
      <td class="num">${n(i.saldo_ref)}</td><td class="num">${n(i.contado)}</td><td class="num">${i.na_amostra || SL[i.ig_local_id] === 'contando' ? n(i.auditado) : '<span class="muted">fora da amostra</span>'}</td><td class="num">${n(i.terceira)}</td><td class="num"><b>${n(i.final)}</b></td>
      <td class="num ${+i.diferenca < 0 ? 'neg' : ''}">${n(i.diferenca)}</td><td class="num">${n(i.custo, 4)}</td><td class="num ${+i.valor < 0 ? 'neg' : ''}">${money(i.valor)}</td>
      <td style="white-space:nowrap">${aberto && gerencia() && !+i.custo ? `<button class="btn ghost small" data-custo="${i.item_id}">Custo</button>` : ''}${aberto && SL[i.ig_local_id] === 'concluido' ? ` <input type="checkbox" class="pg-rx" value="${i.item_id}" data-l="${i.ig_local_id}" title="Marcar para recontagem">` : ''}</td></tr>`).join('') || `<tr><td colspan="11" class="empty">${sd ? 'Nenhuma diferença até agora.' : 'Nenhum item.'}</td></tr>`;
    $$('[data-custo]', root).forEach(b => b.onclick = async () => { const v = parseNum(prompt('Custo unitário do item (R$)') || ''); if (!(v >= 0)) return;
      try { await q(sb.rpc('est_ig_custo', { p_item: b.dataset.custo, p_custo: v })); toast('Custo informado'); render(root); } catch (e) { fail(e); } }); };
  if (vejo) { linhas(); $('#pg-fl', root).onchange = linhas; $('#pg-sd', root).onchange = linhas; }
  $('#pg-v', root).onclick = () => ir(root, null);
  $$('[data-ir]', root).forEach(b => b.onclick = () => ir(root, g.id, b.dataset.ir));
  $$('[data-guia]', root).forEach(b => b.onclick = () => guia(g, D.igl.find(l => l.id === b.dataset.guia), det));
  $$('[data-troca]', root).forEach(b => b.onclick = () => trocar(root, D.igl.find(l => l.id === b.dataset.troca)));
  $('#pg-rel', root) && ($('#pg-rel', root).onclick = () => relatorio(g, det, acu));
  $('#pg-x', root) && ($('#pg-x', root).onclick = async () => { const mot = prompt('Motivo do cancelamento (os locais são descongelados e nada é ajustado)'); if (!mot) return;
    try { await q(sb.rpc('est_ig_cancelar', { p_inventario: g.id, p_motivo: mot })); toast('Inventário cancelado'); render(root); } catch (e) { fail(e); } });
  $('#pg-rc', root) && ($('#pg-rc', root).onclick = async () => {
    const M = $$('.pg-rx:checked', root); if (!M.length) return toast('Marque os itens a recontar no resultado', true);
    const ls = [...new Set(M.map(x => x.dataset.l))]; if (ls.length > 1) return toast('Peça a recontagem de um local por vez', true);
    const mot = (prompt(`Motivo da recontagem de ${M.length} item(ns)`) || '').trim(); if (mot.length < 5) return toast('Informe o motivo', true);
    try { await q(sb.rpc('est_ig_recontar', { p_ig_local: ls[0], p_itens: M.map(x => x.value), p_motivo: mot })); toast('Recontagem pedida: quem conta e quem audita foram avisados'); render(root); } catch (e) { fail(e); } });
  $('#pg-des', root) && ($('#pg-des', root).onclick = async () => {
    const mot = (prompt(`Desfazer o inventário nº ${g.numero}? Todos os ajustes são estornados na data de referência e o mês é reaberto. Motivo:`) || '').trim(); if (!mot) return;
    if (mot.length < 10) return toast('Informe o motivo (pelo menos 10 letras)', true);
    try { const r = await q(sb.rpc('est_ig_estornar', { p_inventario: g.id, p_motivo: mot })); toast(`${r.estornos} ajuste(s) estornado(s)${r.mes_reaberto ? ' e mês reaberto' : ''}`); render(root); } catch (e) { fail(e); } });
  $('#pg-ok', root) && ($('#pg-ok', root).onclick = async () => {
    const fecha = D.cfg.fechar_mes ? ' e o mês da data de referência é fechado' : '';
    if (!confirm(`Aprovar o inventário nº ${g.numero}? ${dif.length} ajuste(s) entram no Kardex em ${dateBR(g.referencia)}${fecha}.`)) return;
    let semc = false; if (semCusto.length) { if (!confirm(`${semCusto.length} item(ns) com sobra estão sem custo e vão entrar a custo zero. Continuar?`)) return; semc = true; }
    try { const r = await q(sb.rpc('est_ig_aprovar', { p_inventario: g.id, p_sem_custo: semc }));
      toast(`${r.ajustes} ajuste(s) lançado(s)${r.mes_fechado ? ' e mês fechado' : ''}${r.implantacao ? ' · estoque implantado' : ''}`); render(root); } catch (e) { fail(e); } });
}

async function trocar(root, l) {
  let pessoas; try { pessoas = await q(sb.rpc('est_ig_pessoas', { p_empresa: state.empresa.id })); } catch (e) { return fail(e); }
  const op = (v) => pessoas.map(p => `<option value="${p.user_id}" ${p.user_id === v ? 'selected' : ''}>${esc(p.nome || '')}</option>`).join('');
  const m = modal({ title: `Trocar pessoas — ${D.loc[l.local_id]?.nome || ''}`, body: `<div class="grid-form"><label>Quem conta<select id="tr-r">${op(l.responsavel_id)}</select></label>
    <label>Quem audita<select id="tr-a"><option value="">Sem auditor</option>${op(l.auditor_id)}</select></label></div><p class="small muted">Para falta ou férias. Quem já contou itens deste local não pode auditá-lo.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="tr-ok">Trocar</button>' });
  $('#tr-ok', m.el).onclick = async () => { try { await q(sb.rpc('est_ig_trocar', { p_ig_local: l.id, p_responsavel: $('#tr-r', m.el).value, p_auditor: $('#tr-a', m.el).value || null })); m.close(); toast('Pessoas trocadas'); render(root); } catch (e) { fail(e); } };
}

// ------------------------------------------------------------ guia cega (impressa) e relatório do resultado
async function guia(g, l, det) {
  const eu = state.user.id, w = window.open('', '_blank'); let its;   // a janela abre já no clique, antes de buscar a lista (bloqueador de pop-up)
  if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  try {
    if ([l.responsavel_id, l.auditor_id].includes(eu) && !(l.auditor_id === eu && l.situacao === 'contando')) its = (await q(sb.rpc('est_ig_lista', { p_ig_local: l.id }))).map(i => ({ codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, lote: i.lote, etiqueta: i.lote_etiqueta || i.etiqueta }));
    else its = det.filter(i => i.ig_local_id === l.id && (l.situacao === 'contando' || i.na_amostra)).map(i => ({ codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, lote: i.lote }));
  } catch (e) { w.close(); return fail(e); }
  const aud = l.situacao !== 'contando', nome = aud ? 'Guia cega de auditoria' : 'Guia cega de contagem';
  abrirRelatorio({ janela: w, nome: `${nome} — inventário geral`, titulo: `${nome} — ${D.loc[l.local_id]?.nome || ''}`,
    subtitulo: `Inventário geral nº ${g.numero} · data de referência ${dateBR(g.referencia)} · ${aud ? 'auditor' : 'contador'}: ${esc((aud ? l.auditor_nome : l.responsavel_nome) || '')}`,
    corpo: `<p style="font-size:9pt">Conte o que está fisicamente no local e anote a quantidade. Esta guia não traz o saldo do sistema${aud ? ' nem a contagem já feita' : ''}. Item que não for encontrado: anote zero. Item encontrado que não está na lista: anote no final.</p>
      <table class="guia"><thead><tr><th style="width:26px">#</th><th style="width:90px">Código</th><th>Descrição</th><th style="width:90px">Lote</th><th style="width:36px">Un.</th><th style="width:110px">Quantidade contada</th><th style="width:150px">Observação</th></tr></thead><tbody>
      ${its.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.codigo || '')}</td><td>${esc(i.descricao || '')}</td><td>${esc(i.lote || '')}</td><td>${esc(i.unidade || '')}</td><td style="height:22px"></td><td></td></tr>`).join('')}
      ${Array.from({ length: 5 }, () => '<tr><td></td><td></td><td></td><td></td><td></td><td style="height:22px"></td><td>fora da lista</td></tr>').join('')}</tbody></table>
      <p style="font-size:9pt;margin-top:22px">Início: ____:____ &nbsp;&nbsp; Fim: ____:____ &nbsp;&nbsp;&nbsp;&nbsp; Assinatura: ______________________________________</p>`,
    extraCss: '.guia td{height:26px;vertical-align:middle}.guia td:nth-child(6){border-left:1px solid #000;border-right:1px solid #000}',
    tipo: 'relatorio', parametros: [['Inventário', `nº ${g.numero}`], ['Local', D.loc[l.local_id]?.nome || ''], ['Tipo', aud ? 'Auditoria' : 'Contagem']] });
}

function relatorio(g, det, acu) {
  const dif = det.filter(i => +(i.final ?? i.contado ?? i.saldo_ref) !== +i.saldo_ref), nl = (id) => D.loc[id]?.nome || '';
  abrirRelatorio({ nome: 'Inventário geral — resultado', titulo: `Inventário geral nº ${g.numero} — resultado`, paisagem: true,
    subtitulo: `Data de referência ${dateBR(g.referencia)} · ${SIT[g.situacao][0]}${g.decidido_nome ? ' por ' + esc(g.decidido_nome) + ' em ' + dateBR(g.decidido_em) : ''}`,
    corpo: `<h2>Acuracidade por local</h2><table><thead><tr><th>Local</th><th>Quem conta</th><th>Quem audita</th><th class="num">Itens</th><th class="num">Dentro da tolerância</th><th class="num">Acuracidade (itens)</th><th class="num">Valor no sistema</th><th class="num">Diferença (R$)</th><th class="num">Acuracidade (valor)</th><th class="num">Auditados</th><th class="num">Divergiram na auditoria</th></tr></thead><tbody>
      ${acu.map(a => { const l = D.igl.find(x => x.id === a.ig_local_id) || {}; return `<tr><td>${esc(nl(a.local_id))}</td><td>${esc(l.responsavel_nome || '')}</td><td>${esc(l.auditor_nome || '—')}</td><td class="num">${a.itens}</td><td class="num">${a.itens_certos}</td><td class="num">${pct(a.pct_itens)}</td>
        <td class="num">${money(a.valor_sistema)}</td><td class="num">${money(a.valor_diferenca)}</td><td class="num">${pct(a.pct_valor)}</td><td class="num">${a.auditados}</td><td class="num">${a.divergiu_auditoria}</td></tr>`; }).join('')}</tbody></table>
      <h2>Diferenças (${dif.length})</h2><table><thead><tr><th>Local</th><th>Código</th><th>Descrição</th><th>Lote</th><th class="num">Sistema</th><th class="num">Contado</th><th class="num">Auditado</th><th class="num">3ª contagem</th><th class="num">Vale</th><th class="num">Diferença</th><th class="num">Valor (R$)</th><th>Justificativa</th></tr></thead><tbody>
      ${dif.map(i => `<tr><td>${esc(nl(i.local_id))}</td><td>${esc(i.codigo)}</td><td>${esc(i.descricao)}</td><td>${esc(i.lote || '')}</td><td class="num">${n(i.saldo_ref)}</td><td class="num">${n(i.contado)}</td><td class="num">${n(i.auditado)}</td><td class="num">${n(i.terceira)}</td>
        <td class="num">${n(i.final)}</td><td class="num">${n(i.diferenca)}</td><td class="num">${money(i.valor)}</td><td>${esc(i.justificativa || '')}</td></tr>`).join('') || '<tr><td colspan="12">Nenhuma diferença.</td></tr>'}</tbody></table>`,
    tipo: 'relatorio', parametros: [['Inventário', `nº ${g.numero}`], ['Data de referência', dateBR(g.referencia)]] });
}

// ------------------------------------------------------------ contar, auditar e terceira contagem (celular, leitor, câmera)
async function contar(root, g, gl) {
  let its; try { its = await q(sb.rpc('est_ig_lista', { p_ig_local: gl.id })); } catch (e) { fail(e); return ir(root, g.id); }
  const papel = its[0]?.papel || (gl.situacao === 'terceira' ? 'terceira' : gl.auditor_id === state.user.id && gl.situacao !== 'contando' ? 'auditor' : 'contador');
  const vez = (papel === 'contador' && gl.situacao === 'contando') || (papel === 'auditor' && gl.situacao === 'auditando') || papel === 'terceira';
  const T = { contador: ['Contagem', 'Concluir a contagem', 'contagem cega: o saldo do sistema não aparece'], auditor: ['Auditoria', 'Concluir a auditoria', 'auditoria cega: você não vê o saldo nem a contagem'], terceira: ['Terceira contagem', '', 'contagem e auditoria diferentes: contem juntos; um registra a quantidade que vale e o outro confirma'] }[papel];
  const rot = (i) => `${esc(i.codigo || '')} ${esc(i.descricao || '')}${i.lote ? ` · lote ${esc(i.lote)}` : ''}`;
  const falta = its.filter(i => !i.feito), temCam = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  its.sort((a, b) => (a.feito ? 1 : 0) - (b.feito ? 1 : 0));
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">${T[0]} — ${esc(D.loc[gl.local_id]?.nome || '')}</h2><div class="muted small">Inventário geral nº ${g.numero} · ${its.length - falta.length} de ${its.length} · ${T[2]}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="ct-v">← Inventário</button>${vez && T[1] ? `<button class="btn primary" id="ct-fim">${T[1]}</button>` : ''}</div></div>
    ${vez ? `<form id="ct-f" class="card" style="display:grid;grid-template-columns:1fr 160px auto;gap:8px;align-items:end;margin-bottom:12px">
      <label>Leia a etiqueta ou digite o código<input id="ct-cod" autocomplete="off" placeholder="Etiqueta, código do produto ou do lote" style="font-size:1.1em" autofocus></label>
      <label>Quantidade ${papel === 'terceira' ? 'que vale' : 'contada'}<input id="ct-q" inputmode="decimal" style="font-size:1.1em"></label><button class="btn primary" style="min-height:44px">Registrar</button>
      <div id="ct-it" class="small" style="grid-column:1/-1"></div>
      ${temCam ? '<div style="grid-column:1/-1"><button type="button" class="btn" id="ct-cam" style="min-height:44px">Ler pela câmera</button><video id="ct-video" playsinline muted hidden style="width:100%;max-width:420px;border-radius:12px;background:#000;aspect-ratio:4/3;object-fit:cover;display:block;margin-top:8px"></video></div>' : ''}</form>`
      : `<div class="card small muted" style="margin-bottom:12px">${papel === 'contador' ? 'A contagem deste local foi concluída.' : 'Aguardando a sua vez neste local.'}</div>`}
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>Item</th><th>Un.</th>${papel === 'terceira' ? '<th class="num">Contagem</th><th class="num">Auditoria</th>' : ''}<th class="num">${papel === 'terceira' ? 'Vale' : 'Quantidade'}</th><th></th></tr></thead><tbody>
      ${its.map(i => `<tr><td>${rot(i)}${i.incluido ? ' <span class="badge negoc">achado</span>' : ''}</td><td>${esc(i.unidade || '')}</td>${papel === 'terceira' ? `<td class="num">${n(i.contado)}</td><td class="num">${n(i.auditado)}</td>` : ''}
        <td class="num">${i.feito ? `<b>${n(i.quantidade)}</b>` : i.situacao === 'aguarda_outro' ? `${n(i.quantidade)} <span class="badge aberto">aguarda a outra pessoa confirmar</span>` : i.situacao === 'confirmar' ? `${n(i.quantidade)} <span class="badge negoc">proposta</span>` : '<span class="muted">a contar</span>'}</td>
        <td style="white-space:nowrap">${vez && i.situacao === 'confirmar' ? `<button class="btn primary small" data-conf="${i.item_id}">Confirmar ${n(i.quantidade)}</button> ` : ''}${vez && !(papel === 'terceira' && i.feito) ? `<button class="btn ghost small" data-it="${i.item_id}">${i.feito ? 'Corrigir' : papel === 'terceira' && i.quantidade != null ? 'Outra quantidade' : 'Contar'}</button>` : ''}</td></tr>`).join('')
        || `<tr><td colspan="6" class="empty">Nenhum item na lista. ${papel === 'contador' ? 'Leia a etiqueta ou digite o código do que encontrar no local.' : ''}</td></tr>`}</tbody></table></div></div>`;
  let fluxo = null, quadro = 0; const parar = () => { cancelAnimationFrame(quadro); fluxo?.getTracks().forEach(t => t.stop()); fluxo = null; };
  $('#ct-v', root).onclick = () => { parar(); ir(root, g.id); };
  if (!vez) return;
  let alvo = null, recemLido = false;
  const escolher = (i) => { alvo = i; $('#ct-it', root).innerHTML = i ? `<b>${rot(i)}</b> · ${esc(i.unidade || '')}${papel === 'terceira' ? ` · contagem ${n(i.contado)} × auditoria ${n(i.auditado)}` : ''}` : ''; if (i) $('#ct-q', root).focus(); };
  // a etiqueta da plataforma (L… do lote, P… do produto) vem primeiro; depois o código do lote e o do produto
  const achar = (cod) => { const t = cod.trim().toUpperCase(), igual = (v) => (v || '').toUpperCase() === t;
    return its.find(i => igual(i.lote_etiqueta)) || its.find(i => !i.lote_id && igual(i.etiqueta)) || its.find(i => igual(i.lote)) || its.find(i => igual(i.etiqueta)) || its.find(i => igual(i.codigo)); };
  $('#ct-cod', root).onchange = async (e) => {
    const bruto = e.target.value.replace(/^.*[?&]b=([^&#]+).*$/i, '$1'); if (!bruto.trim()) return escolher(null);
    const cod = decodeURIComponent(bruto).trim(), i = achar(cod); if (i) { recemLido = true; return escolher(i); }
    if (papel !== 'contador') return toast('Este item não está na sua lista', true);
    try { // achado no local, fora da lista: etiqueta de lote, etiqueta ou código de produto
      const lim = cod.toUpperCase().replace(/[^A-Z0-9]/g, ''), e2 = state.empresa.id;
      const lt = lim ? (await q(sb.from('est_lotes').select('id,codigo,produto_id').eq('empresa_id', e2).eq('etiqueta', lim).limit(1)))[0] : null;
      const p = (await q(lt ? sb.from('produtos').select('id,codigo,descricao,controla_lote').eq('id', lt.produto_id) : sb.from('produtos').select('id,codigo,descricao,controla_lote').eq('empresa_id', e2).or(`codigo.ilike.${cod.replace(/[,()*%]/g, '')},etiqueta.eq.${lim}`).limit(1)))[0];
      if (!p) return toast('Código não encontrado no cadastro', true);
      if (p.controla_lote && !lt) {   // lote ainda sem etiqueta (comum na implantação): cria o lote pelo código da embalagem
        const cl = (prompt(`${p.codigo} ${p.descricao} controla lote. Digite o código do lote escrito na embalagem:`) || '').trim(); if (!cl) return;
        await q(sb.rpc('est_ig_incluir_lote', { p_ig_local: gl.id, p_produto: p.id, p_codigo: cl })); toast('Lote incluído: informe a quantidade'); return render(root);
      }
      if (!confirm(`${p.codigo} ${p.descricao}${lt ? ' · lote ' + lt.codigo : ''} não está na lista deste local. Incluir?`)) return;
      await q(sb.rpc('est_ig_incluir', { p_ig_local: gl.id, p_produto: p.id, p_lote: lt?.id || null })); toast('Item incluído: informe a quantidade'); render(root);
    } catch (err) { fail(err); }
  };
  $$('[data-it]', root).forEach(b => b.onclick = () => { const i = its.find(x => x.item_id === b.dataset.it); $('#ct-cod', root).value = i.codigo || ''; escolher(i); });
  $$('[data-conf]', root).forEach(b => b.onclick = async () => { const i = its.find(x => x.item_id === b.dataset.conf);
    try { const r = await q(sb.rpc('est_ig_terceira', { p_item: i.item_id, p_qtd: i.quantidade, p_justificativa: null })); toast(r === 'concluido' ? 'Confirmado: local concluído' : 'Confirmado'); parar(); r === 'concluido' ? ir(root, g.id) : render(root); } catch (err) { fail(err); } });
  $('#ct-f', root).onsubmit = async (e) => {
    e.preventDefault(); if (!alvo) return toast('Leia a etiqueta do item', true);
    // o leitor manda Enter depois do código: isso escolhe o item, não registra a quantidade
    if (recemLido && $('#ct-q', root).value.trim() === '') { recemLido = false; return $('#ct-q', root).focus(); }
    recemLido = false;
    const qv = parseNum($('#ct-q', root).value); if (!(qv >= 0) || $('#ct-q', root).value.trim() === '') return toast('Informe a quantidade', true);
    try {
      if (papel === 'terceira') { const just = (prompt('Justificativa da diferença entre a contagem e a auditoria (obrigatória)') || '').trim(); if (just.length < 5) return toast('Informe a justificativa', true);
        const r = await q(sb.rpc('est_ig_terceira', { p_item: alvo.item_id, p_qtd: qv, p_justificativa: just }));
        toast(r === 'concluido' ? 'Local concluído' : r === 'confirmar' ? 'Registrado: falta a outra pessoa confirmar' : 'Registrado'); parar(); return r === 'concluido' ? ir(root, g.id) : render(root); }
      await q(sb.rpc('est_ig_contar', { p_item: alvo.item_id, p_qtd: qv })); toast('Registrado'); parar(); render(root);
    } catch (err) { fail(err); }
  };
  $('#ct-fim', root) && ($('#ct-fim', root).onclick = async () => {
    try {
      if (papel === 'auditor') { const r = await q(sb.rpc('est_ig_concluir_auditoria', { p_ig_local: gl.id }));
        toast(r === 'terceira' ? 'Há itens diferentes da contagem: terceira contagem, com quem contou' : 'Auditoria confere: local concluído'); parar(); return ir(root, g.id); }
      let zerar = false; if (falta.length) { if (!confirm(`${falta.length} item(ns) sem contagem. Confirmar que não foram encontrados (ficam com zero)?`)) return; zerar = true; }
      else if (!confirm('Concluir a contagem deste local? Depois disso a contagem não pode mais ser alterada.')) return;
      const r = await q(sb.rpc('est_ig_concluir_contagem', { p_ig_local: gl.id, p_zerar_pendentes: zerar }));
      toast(r === 'auditando' ? 'Contagem concluída: o auditor foi avisado' : 'Local concluído'); parar(); ir(root, g.id);
    } catch (err) { fail(err); } });
  // câmera do celular: lê a etiqueta (código de barras ou QR) e escolhe o item
  const cam = $('#ct-cam', root);
  if (cam) cam.onclick = async () => {
    const v = $('#ct-video', root);
    if (fluxo) { parar(); v.hidden = true; cam.textContent = 'Ler pela câmera'; return; }
    try {
      fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      v.srcObject = fluxo; v.hidden = false; await v.play(); cam.textContent = 'Parar a câmera';
      const det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code', 'code_39'] }); let ultimo = '', quando = 0;
      const ciclo = async () => {
        if (!fluxo || !v.isConnected) return parar();
        try { const t = (await det.detect(v))[0]?.rawValue; if (t && (t !== ultimo || Date.now() - quando > 4000)) { ultimo = t; quando = Date.now(); const c = $('#ct-cod', root); c.value = t; c.dispatchEvent(new Event('change')); } } catch { /* quadro sem código */ }
        quadro = requestAnimationFrame(ciclo);
      };
      ciclo();
    } catch (err) { parar(); fail(new Error('Não foi possível abrir a câmera: ' + (err.message || err))); }
  };
}

// ------------------------------------------------------------ parâmetros
function parametros(root) {
  const c = D.cfg, PAP = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro']];
  const chk = (id, on, t) => `<label style="display:flex;flex-direction:row;gap:8px;align-items:flex-start;font-weight:400;margin:6px 0"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} style="margin-top:3px"> <span>${t}</span></label>`;
  const m = modal({ title: 'Parâmetros do inventário geral', body: `<div class="grid-form">
      <label>Amostra da auditoria (% dos itens)<input type="number" id="gp-a" min="0" max="100" step="5" value="${+c.amostra_pct}"></label>
      <label>Contagem × auditoria: diferença aceita (%)<input type="number" id="gp-d" min="0" max="20" step="0.1" value="${+c.dif_auditoria_pct}"></label>
      <label>Contagem × sistema: tolerância (%)<input type="number" id="gp-t" min="0" max="50" step="0.5" value="${+c.tolerancia_pct}"></label>
      <label>Contagem × sistema: tolerância (R$)<input type="number" id="gp-v" min="0" step="10" value="${+c.tolerancia_valor}"></label></div>
    ${chk('gp-ca', c.amostra_classe_a, 'Sempre auditar os itens de maior valor (os que somam 80% do valor do local)')}
    ${chk('gp-dv', c.amostra_divergentes, 'Sempre auditar os itens que divergiram do sistema além da tolerância')}
    ${chk('gp-es', c.esconder_saldo, 'Contagem cega: quem conta ou audita não vê o saldo nem o Kardex do local enquanto ele não termina')}
    ${chk('gp-fm', c.fechar_mes, 'Ao aprovar, fechar o mês da data de referência (a posição do fechamento passa a ser o inventário)')}
    ${chk('gp-qc', c.aprovar_quem_contou, 'Exceção: quem contou ou auditou também pode aprovar o inventário')}
    <div class="small" style="margin:8px 0 2px">Quem aprova o inventário:</div><div style="display:flex;gap:4px 14px;flex-wrap:wrap">${PAP.map(([k, t]) => `<label style="display:flex;flex-direction:row;gap:6px;align-items:center;font-weight:400"><input type="checkbox" class="gp-p" value="${k}" ${c.papeis_aprovacao.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div>
    <p class="small muted">Amostra de 100% audita todos os itens (recomendado nos primeiros inventários). Com 0% e as duas regras desligadas, não há auditoria: a contagem conclui o local.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="gp-ok">Salvar</button>' });
  $('#gp-ok', m.el).onclick = async () => {
    const v = (id) => +$(id, m.el).value, k = (id) => $(id, m.el).checked, papeis = $$('.gp-p:checked', m.el).map(x => x.value);
    if (!papeis.length) return toast('Escolha quem aprova', true);
    if (!(v('#gp-a') >= 0 && v('#gp-a') <= 100 && v('#gp-d') >= 0 && v('#gp-t') >= 0 && v('#gp-v') >= 0)) return toast('Confira as faixas', true);
    try { await q(sb.rpc('est_ig_config_salvar', { p_empresa: state.empresa.id, p: { amostra_pct: v('#gp-a'), dif_auditoria_pct: v('#gp-d'), tolerancia_pct: v('#gp-t'), tolerancia_valor: v('#gp-v'),
      amostra_classe_a: k('#gp-ca'), amostra_divergentes: k('#gp-dv'), esconder_saldo: k('#gp-es'), fechar_mes: k('#gp-fm'), aprovar_quem_contou: k('#gp-qc'), papeis_aprovacao: papeis } }));
      m.close(); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
  };
}

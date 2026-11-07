// Financeiro › Lançamentos Recorrentes (FIN023): aluguel, assinaturas, honorários e outras contas fixas que viram títulos EM ABERTO
// sozinhos, com N meses de antecedência (agendamento diário no banco, "Gerar agora" e ao salvar). Mudou o valor? Os títulos em
// aberto de hoje em diante são atualizados. Encerrar apaga os em aberto depois do fim. Melhoria 3.1 (07/11/2026).
// Parcelas de contrato continuam em Cadastros › Contratos.
import { sb, state, q, loadCadastros, podeEditar } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, options, parseNum, dateBR, today, confirmDialog } from '../lib/ui.js';
import { planoOptions } from '../lib/lanc-form.js';
import { proximosVencimentos } from '../lib/regras.js';

export const title = 'Lançamentos Recorrentes';
const FREQ = { mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual' };
const MESES_FREQ = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
const FDS = { postergar: 'Passa para a segunda-feira', antecipar: 'Antecipa para a sexta-feira', manter: 'Mantém no fim de semana' };
const ui = { f: 'ativos', busca: '' };

export async function render(root) {
  const e = state.empresa.id;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Lançamentos Recorrentes</h2><div class="muted small">Contas fixas (aluguel, assinaturas, honorários, seguros) que viram títulos em aberto sozinhas, com meses de antecedência, e aparecem no fluxo de caixa projetado.</div></div>
    <div style="display:flex;gap:8px">${podeEditar() ? '<button class="btn" id="rc-ger" title="Cria agora os títulos que faltam no horizonte de cada recorrente">Gerar agora</button><button class="btn primary" id="rc-novo">Novo recorrente</button>' : ''}</div></div>
    <div id="rc-corpo"><div class="loading">Carregando…</div></div>`;
  let R, S;
  try { await loadCadastros(); [R, S] = await Promise.all([q(sb.from('lanc_recorrentes').select('*').eq('empresa_id', e).order('descricao')), q(sb.rpc('lanc_recorrentes_lista', { p_empresa: e }))]); }
  catch (err) { fail(err); $('#rc-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 096 já foi executado.</div></div>'; return; }
  const re = () => render(root);
  $('#rc-novo', root) && ($('#rc-novo', root).onclick = () => editar(null, re));
  $('#rc-ger', root) && ($('#rc-ger', root).onclick = async (ev) => { ev.target.disabled = true;
    try { const n = await q(sb.rpc('lanc_recorrentes_gerar', { p_empresa: e })); toast(n ? `${n} título(s) criado(s)` : 'Nada a criar: os títulos já estão em dia'); re(); } catch (err) { fail(err); ev.target.disabled = false; } });
  const c = state.cad, st = Object.fromEntries(S.map(x => [x.id, x])), hoje = today();
  const mensal = (r) => +r.valor / MESES_FREQ[r.frequencia];
  const ativos = R.filter(r => r.ativo && (!r.fim || r.fim >= hoje.slice(0, 7) + '-01'));
  const sai = ativos.filter(r => c.planoById[r.plano_id]?.tipo === 'S'), ent = ativos.filter(r => c.planoById[r.plano_id]?.tipo === 'E');
  const em30 = R.reduce((s, r) => s + (st[r.id]?.proximo && st[r.id].proximo <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? 1 : 0), 0);
  const pintar = () => {
    const b = ui.busca.trim().toUpperCase();
    const L = R.filter(r => (ui.f === 'todos' || (ui.f === 'ativos' ? ativos.includes(r) : !ativos.includes(r))) && (!b || `${r.descricao} ${c.favById[r.favorecido_id]?.nome || ''} ${c.planoById[r.plano_id]?.label || ''}`.toUpperCase().includes(b)));
    $('#rc-corpo', root).innerHTML = `<div class="kpis" style="margin-bottom:12px">
        <div class="kpi"><div class="k-label">Recorrentes ativos</div><div class="k-value">${ativos.length}</div><div class="k-sub">${R.length} cadastrado(s)</div></div>
        <div class="kpi"><div class="k-label">Saídas fixas por mês</div><div class="k-value neg">${money(sai.reduce((s, r) => s + mensal(r), 0))}</div><div class="k-sub">${sai.length} conta(s); trimestral, anual… divididos por mês</div></div>
        <div class="kpi"><div class="k-label">Entradas fixas por mês</div><div class="k-value pos">${money(ent.reduce((s, r) => s + mensal(r), 0))}</div><div class="k-sub">${ent.length} recorrente(s)</div></div>
        <div class="kpi"><div class="k-label">Vencem em 30 dias</div><div class="k-value">${em30}</div><div class="k-sub">próximo título em aberto de cada um</div></div></div>
      <div class="card toolbar"><div class="chips" id="rc-f">${[['ativos', 'Ativos'], ['encerrados', 'Encerrados'], ['todos', 'Todos']].map(([k, t]) => `<span class="chip ${ui.f === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
        <span class="spacer"></span><label>Buscar<input id="rc-b" value="${esc(ui.busca)}" placeholder="descrição, favorecido, plano"></label></div>
      <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Descrição</th><th>Plano / centro de custo</th><th>Quando</th><th class="num">Valor</th><th>Próximo</th><th class="num">Em aberto</th><th>Último pago</th><th></th></tr></thead><tbody>
      ${L.map(r => { const x = st[r.id] || {}, p = c.planoById[r.plano_id]; return `<tr class="${ativos.includes(r) ? '' : 'muted'}"><td class="wrap"><b>${esc(r.descricao)}</b><div class="small muted">${[c.favById[r.favorecido_id]?.nome, c.contaById[r.conta_id]?.nome].filter(Boolean).map(esc).join(' · ')}</div></td>
        <td class="wrap small">${esc(p?.label || '')}<div class="muted">${esc(c.ccById[r.centro_custo_id]?.nome || '')}</div></td>
        <td class="small">${FREQ[r.frequencia]} · dia ${r.dia === 31 ? 'último' : r.dia}<div class="muted">desde ${dateBR(r.inicio).slice(3)}${r.fim ? ` até ${dateBR(r.fim).slice(3)}` : ''}</div></td>
        <td class="num ${p?.tipo === 'E' ? 'pos' : 'neg'}">${money(r.valor)}</td><td>${x.proximo ? dateBR(x.proximo) : '—'}</td>
        <td class="num">${+x.abertos ? `${x.abertos}<div class="small muted">${money(x.abertos_valor)}</div>` : '—'}</td><td>${x.ultimo_pago ? dateBR(x.ultimo_pago) : '—'}</td>
        <td style="white-space:nowrap">${podeEditar() ? `<button class="btn ghost small" data-ed="${r.id}">Editar</button>` : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="8" class="empty">Nenhum recorrente neste filtro. Cadastre o aluguel, as assinaturas e os honorários fixos: eles passam a aparecer no fluxo projetado.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">Os títulos são criados como <b>Em aberto</b>, com meses de antecedência (padrão 3), todo dia de manhã e quando você salva ou clica em Gerar agora. Pague e concilie normalmente. Parcelas de contrato continuam em Cadastros › Contratos.</p>`;
    $('#rc-f', root).onclick = (ev) => { const f = ev.target.closest('[data-f]')?.dataset.f; if (f) { ui.f = f; pintar(); } };
    $('#rc-b', root).oninput = (ev) => { ui.busca = ev.target.value; clearTimeout(pintar._t); pintar._t = setTimeout(() => { pintar(); const i = $('#rc-b', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
    $$('[data-ed]', root).forEach(x => x.onclick = () => editar(R.find(r => r.id === x.dataset.ed), re));
  };
  pintar();
}

function editar(r, depois) {
  const c = state.cad, novo = !r, hoje = today();
  r = r || { frequencia: 'mensal', dia: 10, inicio: hoje.slice(0, 7) + '-01', ajuste_fds: 'postergar', meses_a_frente: 3, ativo: true };
  const m = modal({ title: novo ? 'Novo lançamento recorrente' : `Recorrente: ${r.descricao}`, wide: true, body: `<div class="grid-form">
      <label class="c8">Descrição<input id="rr-d" maxlength="200" value="${esc(r.descricao || '')}" placeholder="ex.: Aluguel do galpão"></label>
      <label class="c4">Valor (R$)<input id="rr-v" inputmode="decimal" value="${r.valor != null ? (+r.valor).toFixed(2).replace('.', ',') : ''}"></label>
      <label class="full">Plano de contas<select id="rr-p"><option value="">Selecione…</option>${planoOptions(r.plano_id, ['E', 'S'])}</select></label>
      <label class="c4">Favorecido<select id="rr-f">${options(c.favorecidos.filter(x => x.ativo || x.id === r.favorecido_id), { label: 'label', empty: '—', selected: r.favorecido_id })}</select></label>
      <label class="c4">Centro de custo<select id="rr-cc">${options(c.cc, { empty: '—', selected: r.centro_custo_id })}</select></label>
      <label class="c4">Conta prevista<select id="rr-ct">${options(c.contas.filter(x => x.ativo !== false || x.id === r.conta_id), { empty: '(sem conta)', selected: r.conta_id })}</select></label>
      <label class="c3">Frequência<select id="rr-fr">${Object.entries(FREQ).map(([k, t]) => `<option value="${k}" ${r.frequencia === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="c3">Dia do vencimento<input id="rr-dia" inputmode="numeric" value="${r.dia}"><span class="small muted">31 = último dia do mês</span></label>
      <label class="c3">Primeira competência<input type="month" id="rr-i" value="${String(r.inicio).slice(0, 7)}"></label>
      <label class="c3">Última (opcional)<input type="month" id="rr-fim" value="${r.fim ? String(r.fim).slice(0, 7) : ''}"></label>
      <label class="c4">Vencimento no fim de semana<select id="rr-fds">${Object.entries(FDS).map(([k, t]) => `<option value="${k}" ${r.ajuste_fds === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="c4">Criar com antecedência de (meses)<input id="rr-m" inputmode="numeric" value="${r.meses_a_frente}"></label>
      <label class="c4">Prioridade (pagamentos)<select id="rr-pr"><option value="">Padrão da classificação</option>${['Obrigatório', 'Negociável'].map(x => `<option ${r.prioridade === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="c6">Documento (opcional)<input id="rr-doc" value="${esc(r.documento || '')}" placeholder="ex.: contrato 12/2025"></label>
      <label class="c6">Observação<input id="rr-o" value="${esc(r.observacao || '')}"></label></div>
    <label class="chk" style="margin-top:8px;flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="rr-at" ${r.ativo ? 'checked' : ''} style="width:auto;min-height:0"> Ativo (desmarque para encerrar: os títulos em aberto de hoje em diante são apagados)</label>
    <div class="card" style="margin-top:10px;background:var(--surface-2)"><b class="small">Próximos vencimentos</b><div class="small" id="rr-prev"></div></div>`,
    foot: `${!novo ? '<button class="btn ghost danger" id="rr-del">Excluir</button><span class="spacer" style="flex:1"></span>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rr-ok">Salvar</button>` });
  const ler = () => ({ empresa_id: state.empresa.id, descricao: $('#rr-d', m.el).value.trim(), valor: parseNum($('#rr-v', m.el).value || '0'), plano_id: $('#rr-p', m.el).value || null,
    favorecido_id: $('#rr-f', m.el).value || null, centro_custo_id: $('#rr-cc', m.el).value || null, conta_id: $('#rr-ct', m.el).value || null, frequencia: $('#rr-fr', m.el).value,
    dia: Math.min(31, Math.max(1, parseInt($('#rr-dia', m.el).value, 10) || 1)), inicio: ($('#rr-i', m.el).value || hoje.slice(0, 7)) + '-01',
    fim: $('#rr-fim', m.el).value ? $('#rr-fim', m.el).value + '-01' : null, ajuste_fds: $('#rr-fds', m.el).value, meses_a_frente: Math.min(24, Math.max(0, parseInt($('#rr-m', m.el).value, 10) || 0)),
    prioridade: $('#rr-pr', m.el).value || null, documento: $('#rr-doc', m.el).value.trim() || null, observacao: $('#rr-o', m.el).value.trim() || null, ativo: $('#rr-at', m.el).checked, atualizado_em: new Date().toISOString() });
  const prev = () => { const x = ler(); const v = proximosVencimentos(x, 6, hoje.slice(0, 7) + '-01');
    $('#rr-prev', m.el).innerHTML = v.length ? v.map(z => `${dateBR(z.vencimento)} <span class="muted">(${z.competencia.slice(5)}/${z.competencia.slice(0, 4)})</span>`).join(' · ') + (x.valor ? ` — ${money(x.valor)} cada` : '') : '<span class="muted">nenhum vencimento a partir deste mês</span>'; };
  m.el.addEventListener('input', prev); m.el.addEventListener('change', prev); prev();
  $('#rr-ok', m.el).onclick = async (ev) => {
    const x = ler();
    if (!x.descricao) return toast('Informe a descrição', true); if (!(x.valor > 0)) return toast('Informe o valor', true); if (!x.plano_id) return toast('Escolha o plano de contas', true);
    if (x.fim && x.fim < x.inicio) return toast('A última competência é antes da primeira', true);
    ev.target.disabled = true;
    try {
      const salvo = novo ? await q(sb.from('lanc_recorrentes').insert(x).select().single()) : await q(sb.from('lanc_recorrentes').update(x).eq('id', r.id).select().single());
      const atual = novo ? 0 : await q(sb.rpc('lanc_recorrente_atualizar_futuros', { p_id: salvo.id }));
      const n = salvo.ativo ? await q(sb.rpc('lanc_recorrentes_gerar', { p_empresa: state.empresa.id, p_id: salvo.id })) : 0;
      m.close(); toast(`Recorrente salvo${n ? ` · ${n} título(s) criado(s)` : ''}${atual ? ` · ${atual} título(s) em aberto atualizado(s)` : ''}`); depois();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#rr-del', m.el) && ($('#rr-del', m.el).onclick = async () => {
    if (!await confirmDialog('Excluir este recorrente? Os títulos já criados continuam nos Lançamentos (sem o vínculo). Para parar de gerar e apagar os futuros em aberto, desmarque "Ativo".')) return;
    try { await q(sb.from('lanc_recorrentes').delete().eq('id', r.id)); m.close(); toast('Recorrente excluído'); depois(); } catch (err) { fail(err); }
  });
}

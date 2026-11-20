// Painéis › Análise de Problemas (PAI013, SQL 172): as quatro ferramentas de solução de problemas num só lugar e para qualquer área.
//   Pareto (priorizar) → Ishikawa (levantar as causas) → 5 Porquês (causa raiz) → 5W2H (plano de ação com responsável, prazo e custo).
// O Pareto usa o dado da própria plataforma (paradas, refugos, falhas, RNC, devoluções, títulos vencidos) ou uma lista digitada.
// O plano de ação avisa o responsável, cobra o atraso e o problema só encerra com a eficácia verificada. Pedido do Renan em 20/11/2026.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, dateBR, today, confirmDialog, loading } from '../lib/ui.js';
import { kpiGrid } from '../lib/componentes.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import * as P from '../lib/problemas.js';

export const title = 'Análise de Problemas';
const ui = { aba: 'problemas', filtro: 'abertos', busca: '', area: '', acoes: 'minhas', id: null, ficha: 'ishikawa', par: { fonte: 'paradas', modo: 'auto', de: null, ate: null, manual: [], res: null } };
const CSS = `<style>
  .pb-st{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;background:var(--surface-2);color:var(--muted)}
  .pb-st.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.pb-st.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .pb-st.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.pb-st.info{background:color-mix(in srgb,var(--primary) 14%,transparent);color:var(--primary)}
  .pb-pts{display:inline-flex;gap:4px;vertical-align:middle}.pb-pts i{width:9px;height:9px;border-radius:50%;background:var(--border);display:inline-block}.pb-pts i.on{background:var(--pos)}
  .pb-bar{height:6px;border-radius:6px;background:var(--surface-2);overflow:hidden;min-width:70px}.pb-bar i{display:block;height:100%;background:var(--pos)}
  .pb-rot{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}
  .pb-et{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--surface);cursor:pointer;text-align:left;font:inherit;color:var(--text)}
  .pb-et:hover{border-color:var(--primary)}.pb-et.on{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 25%,transparent)}
  .pb-et b{display:block;font-size:14px}.pb-et small{color:var(--muted);display:block}.pb-et .n{float:right;width:22px;height:22px;border-radius:50%;background:var(--surface-2);font-size:12px;font-weight:700;display:grid;place-items:center}
  .pb-et.ok .n{background:var(--pos);color:#fff}
  .pb-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}.pb-cat{border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface)}
  .pb-cat h4{margin:0 0 6px;font-size:13px;color:var(--primary)}.pb-ca{display:flex;gap:6px;align-items:flex-start;font-size:13px;margin:3px 0}.pb-ca span{flex:1;overflow-wrap:anywhere}
  .pb-ca.pv span{font-weight:600;color:var(--warn)}.pb-ca button,.pb-x{border:0;background:none;color:var(--muted);cursor:pointer;padding:0 4px;font-size:14px}
  .pb-cad{border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--surface)}.pb-pq{display:grid;grid-template-columns:78px 1fr;gap:6px;align-items:center;margin:4px 0}
  .pb-pq label{font-size:12px;color:var(--muted);font-weight:600}.pb-g{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.pb-g .c2{grid-column:span 2}.pb-g .c3{grid-column:span 3}.pb-g .c4{grid-column:span 4}.pb-g .c6{grid-column:span 6}
  .pb-w{display:inline-block;min-width:22px;padding:0 5px;border-radius:5px;background:var(--primary);color:#fff;font-size:10px;font-weight:700;text-align:center;margin-right:4px}
  .pb-com{border-left:3px solid var(--border);padding:4px 0 4px 10px;margin:0 0 10px}.pb-com.sis{border-color:transparent;color:var(--muted);font-size:12px;padding-left:13px}.pb-com small{color:var(--muted)}
  .pb-lin{cursor:pointer}.pb-lin:hover td{background:var(--surface-2)}.pb-sub{color:var(--muted);font-size:12px}
  .modal label.chk,.pb-chk{display:flex;flex-direction:row;align-items:center;gap:8px;font-weight:400;font-size:13px}.modal label.chk input,.pb-chk input{width:auto;min-height:0}
  @media(max-width:800px){.pb-rot{grid-template-columns:1fr 1fr}.pb-g{grid-template-columns:1fr 1fr}.pb-g .c3,.pb-g .c4,.pb-g .c6{grid-column:span 2}}
</style>`;
const st = (t, [nome, tom]) => `<span class="pb-st ${tom}">${esc(nome)}</span>`;
const nv = (v) => (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hora = (s) => s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const PAPEIS = ['admin', 'financeiro', 'diretor', 'compras', 'vendas', 'producao'];
const pode = () => PAPEIS.includes(state.papel), gerencia = () => ['admin', 'diretor'].includes(state.papel);
const conduz = (p) => gerencia() || (pode() && [p.responsavel_id, p.aberto_por].includes(state.user?.id));
const rpc = async (f, a) => { const { data, error } = await sb.rpc(f, a); if (error) throw new Error(error.message); return data; };
const iniMes = (k = 0) => { const d = new Date(); d.setMonth(d.getMonth() - k, 1); return d.toISOString().slice(0, 10); };

let D = null;
async function carregar() {
  const e = state.empresa.id;
  const [cfg, problemas, acoes, pessoas] = await Promise.all([
    q(sb.from('prob_config').select('*').eq('empresa_id', e).maybeSingle()), q(sb.from('prob_problemas').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
    q(sb.from('prob_acoes').select('*').eq('empresa_id', e).order('prazo')), q(sb.rpc('prob_pessoas', { p_empresa: e })).catch(() => [])]);
  D = { cfg: { ...P.CFG0, ...(cfg || {}) }, problemas, acoes, pessoas: pessoas || [], porProb: new Map() };
  for (const a of acoes) (D.porProb.get(a.problema_id) || D.porProb.set(a.problema_id, []).get(a.problema_id)).push(a);
  for (const L of D.porProb.values()) L.sort((a, b) => a.numero - b.numero);
}
const acoesDe = (id) => D.porProb.get(id) || [];
const prob = (id) => D.problemas.find(p => p.id === id);
const pessoasOpt = (sel) => `<option value="">Escolha…</option>` + D.pessoas.map(m => `<option value="${m.user_id}" ${m.user_id === sel ? 'selected' : ''}>${esc(m.nome)}</option>`).join('');

export async function render(root) {
  const qs = new URLSearchParams((location.hash.split('?')[1] || ''));
  if (qs.get('id')) { ui.id = qs.get('id'); if (qs.get('aba')) ui.ficha = qs.get('aba'); } else if (!qs.get('novo')) ui.id = null;
  ui.par.de ??= iniMes(2); ui.par.ate ??= today();
  loading(root);
  try { await carregar(); } catch (e) {
    root.innerHTML = `<div class="card"><div class="empty">A Análise de Problemas ainda não está disponível neste banco de dados (SQL 172 não aplicado).<br><span class="muted small">${esc(e.message || '')}</span></div></div>`; return; }
  const pintar = () => (ui.id && prob(ui.id) ? ficha(root, pintar) : lista(root, pintar));
  pintar();
  if (qs.get('novo') && pode()) novoProblema({ titulo: qs.get('titulo') || '', descricao: qs.get('descricao') || '', area: qs.get('area') || '', origem_tipo: qs.get('origem') || 'manual', origem_id: qs.get('origem_id') || '', origem_ref: qs.get('ref') || '' }, root, pintar);
}
const recarregar = async (pintar) => { await carregar(); pintar(); };
const ir = (id, aba) => { ui.id = id; if (aba) ui.ficha = aba; history.replaceState(null, '', id ? `#/problemas?id=${id}` : '#/problemas'); };

/* ------------------------------------------------------------------ lista, plano de ação, Pareto e parâmetros */
function lista(root, pintar) {
  const hoje = today(), R = P.resumo(D.problemas, D.acoes, hoje);
  root.innerHTML = `${CSS}<div class="mm-topo" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><h2 style="margin:0">Análise de Problemas</h2>
      <div class="muted small">Priorize com o Pareto, levante as causas no Ishikawa, chegue à causa raiz com os 5 Porquês e resolva com o plano 5W2H.</div></div>
      ${pode() ? '<button class="btn primary" id="pb-novo">Novo problema</button>' : ''}</div>
    <div id="pb-k" style="margin:12px 0"></div>
    <div class="chips tabs" id="pb-abas">${[['problemas', 'Problemas'], ['acoes', `Plano de ação${R.acoesAtrasadas ? ` (${R.acoesAtrasadas} atrasada${R.acoesAtrasadas > 1 ? 's' : ''})` : ''}`], ['pareto', 'Pareto'], ...(gerencia() ? [['param', 'Parâmetros']] : [])]
      .map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${esc(t)}</span>`).join('')}</div>
    <div id="pb-c" style="margin-top:12px"></div>`;
  kpiGrid($('#pb-k', root), [
    { id: 'abertos', label: 'Problemas em aberto', valor: String(R.abertos), sub: `${R.criticos} de gravidade alta ou crítica`, clicavel: true },
    { id: 'semplano', label: 'Sem plano de ação', valor: String(R.semPlano), sub: 'problema aberto sem nenhuma ação', tom: R.semPlano ? 'warn' : '', clicavel: true },
    { id: 'atrasadas', label: 'Ações atrasadas', valor: String(R.acoesAtrasadas), sub: `${R.acoesAbertas} em aberto · ${R.acoesSemana} vencem em 7 dias`, tom: R.acoesAtrasadas ? 'neg' : '', clicavel: true },
    { id: 'verificar', label: 'Aguardando eficácia', valor: String(R.verificar), sub: 'ações concluídas, falta verificar', tom: R.verificar ? 'warn' : '', clicavel: true },
    { id: 'encerrados', label: 'Encerrados', valor: String(R.encerrados), sub: R.diasMedios != null ? `${R.diasMedios} dia(s) em média para resolver` : 'nenhum ainda', clicavel: true }],
    (k) => { if (k === 'atrasadas') { ui.aba = 'acoes'; ui.acoes = 'atrasadas'; } else { ui.aba = 'problemas'; ui.filtro = k; } pintar(); });
  $$('#pb-abas .chip', root).forEach(c => c.onclick = () => { ui.aba = c.dataset.a; pintar(); });
  if ($('#pb-novo', root)) $('#pb-novo', root).onclick = () => novoProblema({}, root, pintar);
  const c = $('#pb-c', root);
  ({ problemas: tabProblemas, acoes: tabAcoes, pareto: tabPareto, param: tabParam }[ui.aba] || tabProblemas)(c, pintar, root);
}

function tabProblemas(c, pintar) {
  const hoje = today(), F = { abertos: (p) => !['encerrado', 'cancelado'].includes(p.situacao), semplano: (p) => !['encerrado', 'cancelado'].includes(p.situacao) && !acoesDe(p.id).some(a => a.situacao !== 'cancelada'),
    verificar: (p) => p.situacao === 'verificacao', meus: (p) => !['encerrado', 'cancelado'].includes(p.situacao) && p.responsavel_id === state.user?.id, encerrados: (p) => p.situacao === 'encerrado', todos: () => true };
  const b = ui.busca.trim().toLowerCase();
  const L = D.problemas.filter(F[ui.filtro] || F.abertos).filter(p => !ui.area || p.area === ui.area).filter(p => !b || `${p.numero} ${p.titulo} ${p.responsavel_nome || ''} ${p.causa_raiz || ''}`.toLowerCase().includes(b));
  const areas = [...new Set(D.problemas.map(p => p.area))].sort();
  c.innerHTML = `<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <div class="chips" id="pb-f">${[['abertos', 'Em aberto'], ['meus', 'Meus'], ['semplano', 'Sem plano de ação'], ['verificar', 'Aguardando eficácia'], ['encerrados', 'Encerrados'], ['todos', 'Todos']].map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <select id="pb-ar" style="width:auto"><option value="">Todas as áreas</option>${areas.map(a => `<option ${a === ui.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <input id="pb-b" placeholder="Buscar por número, problema ou responsável" value="${esc(ui.busca)}" style="flex:1;min-width:200px"></div></div>
    <div class="table-wrap"><table><thead><tr><th>Nº</th><th>Problema</th><th>Gravidade</th><th>Responsável</th><th>Prazo</th><th title="Pareto, Ishikawa, 5 Porquês e 5W2H">Ferramentas</th><th>Plano de ação</th><th>Situação</th></tr></thead><tbody>
    ${L.map(p => { const A = acoesDe(p.id), pr = P.progresso(A, hoje), E = P.etapas(p, A), atr = p.prazo && p.prazo < hoje && !['encerrado', 'cancelado'].includes(p.situacao);
      return `<tr class="pb-lin" data-id="${p.id}"><td>${p.numero}</td><td style="min-width:220px;white-space:normal"><b>${esc(p.titulo)}</b><div class="pb-sub">${esc(p.area)} · ${esc(P.ORIGEM[p.origem_tipo] || '')}${p.origem_ref ? ' ' + esc(p.origem_ref) : ''}</div></td>
        <td>${st('', P.GRAV[p.gravidade] || P.GRAV.media)}</td><td>${esc(p.responsavel_nome || '—')}</td><td class="${atr ? 'neg' : ''}">${dateBR(p.prazo) || '—'}</td>
        <td><span class="pb-pts" title="${esc(E.map(x => `${x.nome}: ${x.txt}`).join(' · '))}">${E.map(x => `<i class="${x.feito ? 'on' : ''}"></i>`).join('')}</span></td>
        <td>${pr.total ? `<div class="pb-bar"><i style="width:${pr.pct}%"></i></div><div class="pb-sub ${pr.atrasadas ? 'neg' : ''}">${pr.feitas} de ${pr.total}${pr.atrasadas ? ` · ${pr.atrasadas} atrasada(s)` : ''}</div>` : '<span class="muted small">sem ações</span>'}</td>
        <td>${st('', P.SIT[p.situacao])}</td></tr>`; }).join('') || `<tr><td colspan="8" class="empty">${D.problemas.length ? 'Nenhum problema neste filtro.' : 'Nenhum problema registrado. Clique em Novo problema ou comece pelo Pareto para descobrir onde está a maior perda.'}</td></tr>`}
    </tbody></table></div>`;
  $$('#pb-f .chip', c).forEach(x => x.onclick = () => { ui.filtro = x.dataset.f; pintar(); });
  $('#pb-ar', c).onchange = (e) => { ui.area = e.target.value; pintar(); };
  $('#pb-b', c).oninput = (e) => { ui.busca = e.target.value; const pos = e.target.selectionStart; pintar(); const n = $('#pb-b'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
  $$('.pb-lin', c).forEach(tr => tr.onclick = () => { ir(tr.dataset.id); pintar(); });
}

function linhaAcao(a, hoje, comProblema) {
  const p = prob(a.problema_id), atr = P.acaoAtrasada(a, hoje), falta = P.faltaNo5w2h(a);
  return `<tr data-ac="${a.id}"><td ${comProblema ? 'style="white-space:normal;max-width:190px"' : ''}>${comProblema ? `<a href="#/problemas?id=${a.problema_id}&aba=5w2h" data-ab="${a.problema_id}">nº ${p?.numero ?? ''}</a><div class="pb-sub">${esc(p?.titulo || '')}</div>` : a.numero}</td>
    <td style="min-width:240px;white-space:normal"><b>${esc(a.o_que)}</b>${a.por_que ? `<div class="pb-sub"><span class="pb-w">Por quê</span>${esc(a.por_que)}</div>` : ''}${a.onde ? `<div class="pb-sub"><span class="pb-w">Onde</span>${esc(a.onde)}</div>` : ''}${a.como ? `<div class="pb-sub"><span class="pb-w">Como</span>${esc(a.como)}</div>` : ''}
      ${a.evidencia ? `<div class="pb-sub">${a.situacao === 'cancelada' ? 'Motivo' : 'Evidência'}: ${esc(a.evidencia)}</div>` : ''}${falta.length && P.acaoAberta(a) ? `<div class="pb-sub warn">Falta no 5W2H: ${esc(falta.join(', '))}</div>` : ''}</td>
    <td style="white-space:normal;max-width:150px">${esc(a.responsavel_nome)}</td>
    <td class="${atr ? 'neg' : ''}" style="white-space:nowrap">${dateBR(a.prazo)}${a.inicio ? `<div class="pb-sub">início ${dateBR(a.inicio)}</div>` : ''}${atr ? `<div class="pb-sub neg">${P.diasDeAtraso(a, hoje)} dia(s) de atraso</div>` : ''}${a.concluida_em ? `<div class="pb-sub">feita em ${dateBR(a.concluida_em)}</div>` : ''}</td>
    <td class="num">${nv(a.custo_previsto)}${a.custo_real != null ? `<div class="pb-sub">real ${nv(a.custo_real)}</div>` : ''}</td>
    <td>${st('', P.SIT_ACAO[a.situacao])}</td><td><div style="display:grid;grid-template-columns:auto auto;gap:4px;justify-content:end">${botoesAcao(a)}</div></td></tr>`;
}
function botoesAcao(a) {
  const p = prob(a.problema_id); if (!p || !pode() || ['encerrado', 'cancelado'].includes(p.situacao)) return '';
  const meu = a.responsavel_id === state.user?.id, c = conduz(p), B = [];
  if (P.acaoAberta(a) && (meu || c)) { if (a.situacao === 'pendente') B.push(['ini', 'Iniciar']); B.push(['fim', 'Concluir']); }
  if (P.acaoAberta(a)) B.push(['ed', 'Editar']);
  if (P.acaoAberta(a) && c) B.push(['can', 'Cancelar']);
  if (!P.acaoAberta(a) && c) B.push(['rea', 'Reabrir']);
  return B.map(([k, t]) => `<button class="btn small ${k === 'fim' ? 'primary' : ''}" data-b="${k}">${t}</button>`).join('');
}
function ligarAcoes(el, pintar) {
  $$('[data-ab]', el).forEach(a => a.onclick = (ev) => { ev.preventDefault(); ir(a.dataset.ab, '5w2h'); pintar(); });
  $$('tr[data-ac] [data-b]', el).forEach(b => b.onclick = async () => {
    const a = D.acoes.find(x => x.id === b.closest('tr').dataset.ac), k = b.dataset.b;
    try {
      if (k === 'ini') { await rpc('prob_acao_situacao', { p_acao: a.id, p_situacao: 'em_andamento', p: {} }); toast('Ação em andamento.'); await recarregar(pintar); }
      else if (k === 'ed') formAcao(prob(a.problema_id), a, pintar);
      else if (k === 'rea') { if (await confirmDialog(`Reabrir a ação "${a.o_que}"?`)) { await rpc('prob_acao_reabrir', { p_acao: a.id }); toast('Ação reaberta.'); await recarregar(pintar); } }
      else if (k === 'fim') concluirAcao(a, pintar);
      else if (k === 'can') cancelarAcao(a, pintar);
    } catch (e) { fail(e); }
  });
}
function concluirAcao(a, pintar) {
  const m = modal({ title: `Concluir a ação ${a.numero}`, narrow: true, body: `<p style="margin-top:0"><b>${esc(a.o_que)}</b></p><div class="pb-g">
      <label class="c3">Concluída em<input type="date" name="d" value="${today()}" max="${today()}"></label><label class="c3">Custo real (R$)<input name="c" inputmode="decimal" placeholder="${nv(a.custo_previsto)}"></label>
      <label class="c6">Evidência do que foi feito<textarea name="e" rows="3" placeholder="Ex.: peça trocada, procedimento revisado e treinado, ata da reunião"></textarea></label></div>`,
    foot: '<button class="btn" data-x>Voltar</button><button class="btn primary" data-ok>Concluir a ação</button>',
    onMount: (el, close) => { $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = async () => {
      const cr = $('[name=c]', el).value.trim().replace(/\./g, '').replace(',', '.');
      try { const s = await rpc('prob_acao_situacao', { p_acao: a.id, p_situacao: 'concluida', p: { concluida_em: $('[name=d]', el).value, evidencia: $('[name=e]', el).value, ...(cr ? { custo_real: cr } : {}) } });
        close(); toast(s === 'verificacao' ? 'Ação concluída. Todas as ações do plano estão feitas: verifique a eficácia.' : 'Ação concluída.'); await recarregar(pintar); } catch (e) { fail(e); } }; } });
  return m;
}
function cancelarAcao(a, pintar) {
  modal({ title: `Cancelar a ação ${a.numero}`, narrow: true, body: `<p style="margin-top:0"><b>${esc(a.o_que)}</b></p><label>Motivo do cancelamento<textarea name="e" rows="3"></textarea></label>`,
    foot: '<button class="btn" data-x>Voltar</button><button class="btn danger" data-ok>Cancelar a ação</button>',
    onMount: (el, close) => { $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = async () => {
      try { await rpc('prob_acao_situacao', { p_acao: a.id, p_situacao: 'cancelada', p: { evidencia: $('[name=e]', el).value } }); close(); toast('Ação cancelada.'); await recarregar(pintar); } catch (e) { fail(e); } }; } });
}
const CAB_ACOES = (primeira) => `<thead><tr><th>${primeira}</th><th><span class="pb-w">O quê</span> <span class="pb-w">Por quê</span> <span class="pb-w">Onde</span> <span class="pb-w">Como</span></th><th><span class="pb-w">Quem</span></th><th><span class="pb-w">Quando</span></th><th class="num"><span class="pb-w">Quanto</span></th><th>Situação</th><th></th></tr></thead>`;

function tabAcoes(c, pintar) {
  const hoje = today(), vivos = new Set(D.problemas.filter(p => !['encerrado', 'cancelado'].includes(p.situacao)).map(p => p.id));
  const F = { minhas: (a) => P.acaoAberta(a) && vivos.has(a.problema_id) && a.responsavel_id === state.user?.id, atrasadas: (a) => vivos.has(a.problema_id) && P.acaoAtrasada(a, hoje),
    abertas: (a) => P.acaoAberta(a) && vivos.has(a.problema_id), concluidas: (a) => a.situacao === 'concluida' };
  const L = D.acoes.filter(F[ui.acoes] || F.minhas).sort((a, b) => String(a.prazo).localeCompare(String(b.prazo)));
  const tot = P.progresso(L, hoje);
  c.innerHTML = `<div class="card"><div class="chips" id="pb-fa">${[['minhas', 'Minhas ações'], ['atrasadas', 'Atrasadas'], ['abertas', 'Todas em aberto'], ['concluidas', 'Concluídas']].map(([k, t]) => `<span class="chip ${ui.acoes === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <p class="muted small" style="margin:8px 0 0">${L.length} ação(ões) · custo previsto R$ ${nv(tot.previsto)}${tot.real ? ` · custo real R$ ${nv(tot.real)}` : ''}. O responsável é avisado ao receber a ação, ${D.cfg.dias_aviso} dia(s) antes do prazo${D.cfg.avisar_atraso ? ' e quando ela atrasa' : ''}.</p></div>
    <div class="table-wrap"><table>${CAB_ACOES('Problema')}<tbody>${L.map(a => linhaAcao(a, hoje, true)).join('') || '<tr><td colspan="7" class="empty">Nenhuma ação neste filtro.</td></tr>'}</tbody></table></div>`;
  $$('#pb-fa .chip', c).forEach(x => x.onclick = () => { ui.acoes = x.dataset.f; pintar(); });
  ligarAcoes(c, pintar);
}

/* ---- Pareto: dado da plataforma ou lista digitada. opt.problema = guarda no problema; sem ele, abre problema a partir de um item */
async function calcularPareto(par) {
  if (par.modo === 'manual') return { itens: par.manual.filter(x => String(x.nome || '').trim() && +x.valor > 0).map(x => ({ nome: x.nome.trim(), valor: +x.valor })), unidade: par.unidade || '', fonte: 'manual', titulo: par.titulo || 'Lista digitada' };
  const f = P.FONTES.find(x => x.k === par.fonte), rows = await rpc('prob_pareto', { p_empresa: state.empresa.id, p_fonte: par.fonte, p_de: par.de, p_ate: par.ate });
  return { itens: (rows || []).map(r => ({ nome: r.nome, valor: +r.valor, qtd: +r.qtd })), unidade: f.unidade, fonte: f.k, titulo: f.medida, de: par.de, ate: par.ate };
}
function paretoHTML(res, corte, extra = '') {
  const G = P.pareto(res.itens, corte);
  if (!G.linhas.length) return `<div class="empty">Sem dados para o Pareto${res.fonte !== 'manual' ? ' neste período' : ''}. ${res.fonte !== 'manual' ? 'Aumente o período, escolha outra fonte ou digite a lista.' : 'Digite ao menos um item com valor.'}</div>`;
  return `<p style="margin:0 0 8px"><b>${esc(res.titulo)}</b>${res.de ? ` <span class="muted">· ${dateBR(res.de)} a ${dateBR(res.ate)}</span>` : ''}</p>${P.paretoSVG(G, { unidade: res.unidade })}
    <p style="margin:8px 0">${esc(P.paretoFrase(G, res.unidade))}</p>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Item</th><th class="num">Valor${res.unidade ? ` (${esc(res.unidade)})` : ''}</th><th class="num">Participação</th><th class="num">Acumulado</th>${G.linhas.some(x => x.qtd) ? '<th class="num">Ocorrências</th>' : ''}<th></th></tr></thead><tbody>
    ${G.linhas.map((x, i) => `<tr><td>${i + 1}</td><td>${x.vital ? `<b>${esc(x.nome)}</b>` : esc(x.nome)}</td><td class="num">${esc(P.numBR(x.valor, res.unidade === 'R$' ? 2 : (x.valor % 1 ? 1 : 0)))}</td><td class="num">${P.numBR(x.pct, 1)}%</td><td class="num">${P.numBR(x.acumulado, 1)}%</td>
      ${G.linhas.some(y => y.qtd) ? `<td class="num">${x.qtd || ''}</td>` : ''}<td>${x.vital ? '<span class="pb-st warn">prioridade</span>' : ''}${extra && !x.outros ? ` <button class="btn small" data-item="${esc(x.nome)}">${extra}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function editorPareto(c, par, aoMudar) {
  const fin = ['admin', 'financeiro', 'diretor'].includes(state.papel), fontes = P.FONTES.filter(f => !f.financeiro || fin);
  if (!par.manual.length) par.manual = [{ nome: '', valor: '' }, { nome: '', valor: '' }, { nome: '', valor: '' }];
  c.innerHTML = `<div class="chips" id="pp-m">${[['auto', 'Dado da plataforma'], ['manual', 'Digitar a lista']].map(([k, t]) => `<span class="chip ${par.modo === k ? 'on' : ''}" data-m="${k}">${t}</span>`).join('')}</div>
    ${par.modo === 'auto' ? `<div class="pb-g" style="margin-top:10px"><label class="c3">O que medir<select id="pp-f">${fontes.map(f => `<option value="${f.k}" ${f.k === par.fonte ? 'selected' : ''}>${esc(f.nome)} — ${esc(f.medida.toLowerCase())}</option>`).join('')}</select></label>
        <label>De<input type="date" id="pp-de" value="${par.de}"></label><label>Até<input type="date" id="pp-ate" value="${par.ate}"></label><label class="c2" style="align-self:end"><button class="btn primary" id="pp-go">Montar o Pareto</button></label></div>`
    : `<div class="pb-g" style="margin-top:10px"><label class="c4">O que está sendo medido<input id="pp-t" value="${esc(par.titulo || '')}" placeholder="Ex.: reclamações de clientes por motivo"></label><label class="c2">Unidade<input id="pp-u" value="${esc(par.unidade || '')}" placeholder="un, R$, h, kg"></label></div>
        <div id="pp-l" style="margin-top:6px">${par.manual.map((x, i) => `<div class="pb-g" style="margin:4px 0" data-i="${i}"><input class="c4" data-n placeholder="Item (motivo, defeito, cliente...)" value="${esc(x.nome)}"><input data-v inputmode="decimal" placeholder="Valor" value="${esc(x.valor)}"><button class="pb-x" data-rm title="Remover">×</button></div>`).join('')}</div>
        <button class="btn small" id="pp-add">+ Item</button> <button class="btn primary" id="pp-go">Montar o Pareto</button>`}`;
  $$('#pp-m .chip', c).forEach(x => x.onclick = () => { par.modo = x.dataset.m; par.res = null; aoMudar(); });
  const ler = () => { if (par.modo === 'auto') { par.fonte = $('#pp-f', c).value; par.de = $('#pp-de', c).value; par.ate = $('#pp-ate', c).value; }
    else { par.titulo = $('#pp-t', c).value; par.unidade = $('#pp-u', c).value.trim(); par.manual = $$('#pp-l [data-i]', c).map(r => ({ nome: $('[data-n]', r).value, valor: $('[data-v]', r).value.trim().replace(/\.(?=\d{3})/g, '').replace(',', '.') })); } };
  if ($('#pp-add', c)) $('#pp-add', c).onclick = () => { ler(); par.manual.push({ nome: '', valor: '' }); aoMudar(); };
  $$('[data-rm]', c).forEach(b => b.onclick = () => { ler(); par.manual.splice(+b.closest('[data-i]').dataset.i, 1); aoMudar(); });
  $('#pp-go', c).onclick = async () => { ler(); try { par.res = await calcularPareto(par); aoMudar(); } catch (e) { fail(e); } };
}
function tabPareto(c, pintar, root) {
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">Pareto: onde está a maior perda</h3><p class="muted small" style="margin-top:0">Poucas causas costumam responder pela maior parte do problema. Monte o gráfico e abra um problema para os itens em destaque.</p><div id="pp-e"></div></div><div class="card" id="pp-r" ${ui.par.res ? '' : 'hidden'}></div>`;
  editorPareto($('#pp-e', c), ui.par, pintar);
  if (ui.par.res) { const r = $('#pp-r', c); r.innerHTML = paretoHTML(ui.par.res, D.cfg.pareto_corte, pode() ? 'Abrir problema' : '');
    $$('[data-item]', r).forEach(b => b.onclick = () => { const f = P.FONTES.find(x => x.k === ui.par.res.fonte);
      novoProblema({ titulo: `${f ? f.nome : ui.par.res.titulo}: ${b.dataset.item}`, area: f?.area || '', origem_tipo: 'pareto', origem_ref: `${f ? f.nome : 'Lista'} · ${b.dataset.item}`, pareto: { ...ui.par.res, foco: [b.dataset.item] } }, root, pintar); }); }
}

function tabParam(c, pintar) {
  const g = D.cfg;
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">Parâmetros da Análise de Problemas</h3><form id="pb-pf" class="pb-g">
      <label class="c3">Categorias do Ishikawa (uma por linha, de 3 a 10)<textarea name="cat" rows="7">${esc((g.categorias || []).join('\n'))}</textarea></label>
      <label class="c3">Áreas (uma por linha)<textarea name="ar" rows="7">${esc((g.areas || []).join('\n'))}</textarea></label>
      <label class="c2">Lembrar o responsável antes do prazo (dias)<input name="dias" type="number" min="0" max="30" value="${g.dias_aviso}"></label>
      <label class="c2">Corte do Pareto (% acumulado)<input name="corte" type="number" min="50" max="95" value="${+g.pareto_corte}"></label><div class="c2"></div>
      <label class="pb-chk c6"><input type="checkbox" name="at" ${g.avisar_atraso ? 'checked' : ''}> Cobrar a ação atrasada (no dia seguinte ao prazo e depois toda segunda-feira), avisando o responsável pela ação e o responsável pelo problema</label>
      <label class="pb-chk c6"><input type="checkbox" name="ca" ${g.exige_causa ? 'checked' : ''}> Só encerrar o problema com a causa raiz registrada</label>
      <label class="pb-chk c6"><input type="checkbox" name="ac" ${g.exige_acao ? 'checked' : ''}> Só encerrar com ao menos uma ação concluída</label>
      <label class="pb-chk c6"><input type="checkbox" name="ef" ${g.exige_eficacia ? 'checked' : ''}> Só encerrar com a eficácia verificada (se as ações não resolveram, o problema volta para a análise)</label>
      <div class="c6"><button class="btn primary">Salvar parâmetros</button></div></form></div>`;
  $('#pb-pf', c).onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target, lin = (t) => t.value.split('\n').map(x => x.trim()).filter(Boolean);
    try { await rpc('prob_config_salvar', { p_empresa: state.empresa.id, p: { categorias: lin(f.cat), areas: lin(f.ar), dias_aviso: +f.dias.value, pareto_corte: +f.corte.value, avisar_atraso: f.at.checked, exige_causa: f.ca.checked, exige_acao: f.ac.checked, exige_eficacia: f.ef.checked } });
      toast('Parâmetros salvos.'); await recarregar(pintar); } catch (e) { fail(e); } };
}

/* ------------------------------------------------------------------ novo problema e dados gerais */
function novoProblema(ini, root, pintar, p = null) {
  const v = p || { titulo: '', descricao: '', area: '', gravidade: 'media', responsavel_id: state.user?.id, prazo: '', ...ini };
  modal({ title: p ? `Problema nº ${p.numero}: dados gerais` : 'Novo problema', body: `<div class="pb-g">
      <label class="c6">Qual é o problema? (o fato, com número quando houver)<input name="titulo" maxlength="140" value="${esc(v.titulo || '')}" placeholder="Ex.: 12% dos pedidos de outubro foram entregues com atraso"></label>
      <label class="c6">Descrição: onde acontece, desde quando, o que causa de prejuízo<textarea name="descricao" rows="3">${esc(v.descricao || '')}</textarea></label>
      <label class="c2">Área<select name="area">${(D.cfg.areas || []).map(a => `<option ${a === v.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <label class="c2">Gravidade<select name="gravidade">${Object.entries(P.GRAV).map(([k, [t]]) => `<option value="${k}" ${k === v.gravidade ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="c2">Prazo para resolver<input type="date" name="prazo" value="${v.prazo || ''}"></label>
      <label class="c3">Responsável por conduzir<select name="resp" ${p && !conduz(p) ? 'disabled' : ''}>${pessoasOpt(v.responsavel_id)}</select></label>
      ${v.origem_ref ? `<div class="c3 muted small" style="align-self:end">Origem: ${esc(P.ORIGEM[v.origem_tipo] || '')} ${esc(v.origem_ref)}</div>` : ''}</div>`,
    foot: `<button class="btn" data-x>Voltar</button><button class="btn primary" data-ok>${p ? 'Salvar' : 'Abrir o problema'}</button>`,
    onMount: (el, close) => { $('[data-x]', el).onclick = close; if (!p && !v.area && ini.area) $('[name=area]', el).value = ini.area;
      $('[data-ok]', el).onclick = async () => { const g = (n) => $(`[name=${n}]`, el).value, d = { titulo: g('titulo'), descricao: g('descricao'), area: g('area'), gravidade: g('gravidade'), prazo: g('prazo') };
        try {
          if (p) { await rpc('prob_salvar', { p_id: p.id, p: { ...d, ...(conduz(p) ? { responsavel_id: g('resp') } : {}) } }); close(); toast('Dados salvos.'); await recarregar(pintar); }
          else { const id = await rpc('prob_abrir', { p_empresa: state.empresa.id, p: { ...d, responsavel_id: g('resp'), origem_tipo: v.origem_tipo || 'manual', origem_id: v.origem_id || '', origem_ref: v.origem_ref || '', ...(v.pareto ? { pareto: v.pareto } : {}), ...(v.porques ? { porques: v.porques } : {}), ...(v.causa_raiz ? { causa_raiz: v.causa_raiz } : {}) } });
            close(); toast('Problema aberto. Comece levantando as causas no Ishikawa.'); ir(id, v.pareto ? 'pareto' : 'ishikawa'); await recarregar(pintar); }
        } catch (e) { fail(e); } }; } });
}

/* ------------------------------------------------------------------ ficha do problema */
function ficha(root, pintar) {
  const p = prob(ui.id), A = acoesDe(p.id), hoje = today(), E = P.etapas(p, A), aberto = !['encerrado', 'cancelado'].includes(p.situacao), ed = pode() && aberto;
  if (!['pareto', 'ishikawa', 'porques', '5w2h', 'fechar', 'diario'].includes(ui.ficha)) ui.ficha = 'ishikawa';
  root.innerHTML = `${CSS}<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="min-width:0;flex:1"><a href="#/problemas" id="pb-volta" class="small">‹ Todos os problemas</a>
        <h2 style="margin:4px 0 6px">Nº ${p.numero} · ${esc(p.titulo)}</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${st('', P.SIT[p.situacao])}${st('', P.GRAV[p.gravidade])}<span class="pb-st">${esc(p.area)}</span>
          <span class="muted small">Responsável: <b>${esc(p.responsavel_nome || '—')}</b>${p.prazo ? ` · prazo ${dateBR(p.prazo)}` : ''} · aberto em ${dateBR(p.aberto_em)}${p.aberto_por_nome ? ' por ' + esc(p.aberto_por_nome) : ''}${p.origem_ref ? ` · origem: ${esc(P.ORIGEM[p.origem_tipo] || '')} ${esc(p.origem_ref)}` : ''}</span></div>
        ${p.descricao ? `<p style="margin:8px 0 0;max-width:900px">${esc(p.descricao)}</p>` : ''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${ed ? '<button class="btn" id="pb-ed">Editar dados</button>' : ''}<button class="btn" id="pb-imp">Imprimir</button>
        ${aberto && conduz(p) ? '<button class="btn" id="pb-can">Cancelar problema</button>' : ''}${!aberto && gerencia() ? '<button class="btn" id="pb-rea">Reabrir</button>' : ''}</div></div>
    <div class="pb-rot">${E.map((x, i) => `<button class="pb-et ${ui.ficha === x.k ? 'on' : ''} ${x.feito ? 'ok' : ''}" data-e="${x.k}"><span class="n">${x.feito ? '✓' : i + 1}</span><b>${x.nome}</b><small>${x.sub}</small><small>${esc(x.txt)}</small></button>`).join('')}</div>
    <div class="chips tabs" id="pb-fa2">${[['fechar', p.situacao === 'encerrado' ? 'Encerramento' : 'Eficácia e encerramento'], ['diario', 'Diário']].map(([k, t]) => `<span class="chip ${ui.ficha === k ? 'on' : ''}" data-e="${k}">${t}</span>`).join('')}</div>
    <div id="pb-fc" style="margin-top:12px"></div>`;
  $('#pb-volta', root).onclick = (ev) => { ev.preventDefault(); ir(null); pintar(); };
  $$('[data-e]', root).forEach(b => b.onclick = () => { ui.ficha = b.dataset.e; pintar(); });
  if ($('#pb-ed', root)) $('#pb-ed', root).onclick = () => novoProblema({}, root, pintar, p);
  $('#pb-imp', root).onclick = () => imprimir(p, A);
  if ($('#pb-can', root)) $('#pb-can', root).onclick = () => motivo('Cancelar o problema', 'Motivo do cancelamento (as ações em aberto também são canceladas)', 'Cancelar o problema', async (t) => { await rpc('prob_cancelar', { p_id: p.id, p_motivo: t }); toast('Problema cancelado.'); await recarregar(pintar); });
  if ($('#pb-rea', root)) $('#pb-rea', root).onclick = () => motivo('Reabrir o problema', 'Motivo da reabertura', 'Reabrir', async (t) => { await rpc('prob_reabrir', { p_id: p.id, p_motivo: t }); toast('Problema reaberto.'); await recarregar(pintar); });
  const c = $('#pb-fc', root);
  ({ pareto: fPareto, ishikawa: fIshikawa, porques: fPorques, '5w2h': f5w2h, fechar: fFechar, diario: fDiario })[ui.ficha](c, p, A, ed, pintar, hoje);
}
function motivo(titulo, rotulo, botao, feito) {
  modal({ title: titulo, narrow: true, body: `<label>${esc(rotulo)}<textarea name="t" rows="3"></textarea></label>`, foot: `<button class="btn" data-x>Voltar</button><button class="btn primary" data-ok>${esc(botao)}</button>`,
    onMount: (el, close) => { $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = async () => { try { await feito($('[name=t]', el).value); close(); } catch (e) { fail(e); } }; } });
}
const salvar = async (p, d, pintar, msg) => { try { await rpc('prob_salvar', { p_id: p.id, p: d }); if (msg) toast(msg); await recarregar(pintar); } catch (e) { fail(e); } };

/* ---- 1. Pareto */
const parFicha = { modo: 'auto', fonte: 'paradas', de: null, ate: null, manual: [], res: null, de_id: null };
function fPareto(c, p, A, ed, pintar) {
  if (parFicha.de_id !== p.id) Object.assign(parFicha, { de_id: p.id, res: null, modo: 'auto', de: iniMes(2), ate: today(), manual: [] });
  const guardado = p.pareto?.itens?.length ? p.pareto : null, mostra = parFicha.res || guardado;
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">1. Pareto — o que resolver primeiro</h3>
      <p class="muted small" style="margin-top:0">Etapa opcional. Use quando o problema tem várias ocorrências (motivos, defeitos, clientes) e é preciso escolher onde atacar.${guardado && !parFicha.res ? ' Este é o Pareto guardado no problema.' : ''}</p>
      ${ed ? '<div id="pf-e"></div>' : ''}</div>
    ${mostra ? `<div class="card" id="pf-r">${paretoHTML(mostra, D.cfg.pareto_corte)}${mostra.foco?.length ? `<p class="muted small">Foco deste problema: <b>${esc(mostra.foco.join(', '))}</b></p>` : ''}
      ${ed && parFicha.res ? '<button class="btn primary" id="pf-g">Guardar este Pareto no problema</button>' : ''}${ed && guardado && !parFicha.res ? '<button class="btn" id="pf-rm">Retirar o Pareto do problema</button>' : ''}</div>` : (ed ? '' : '<div class="card"><div class="empty">Este problema não tem Pareto.</div></div>')}`;
  if (ed) editorPareto($('#pf-e', c), parFicha, pintar);
  if ($('#pf-g', c)) $('#pf-g', c).onclick = async () => { const G = P.pareto(parFicha.res.itens, D.cfg.pareto_corte), r = { ...parFicha.res, foco: guardado?.foco?.length ? guardado.foco : G.linhas.filter(x => x.vital).map(x => x.nome) }; parFicha.res = null; await salvar(p, { pareto: r }, pintar, 'Pareto guardado no problema.'); };
  if ($('#pf-rm', c)) $('#pf-rm', c).onclick = async () => { if (await confirmDialog('Retirar o Pareto deste problema?')) await salvar(p, { pareto: null }, pintar, 'Pareto retirado.'); };
}

/* ---- 2. Ishikawa */
function fIshikawa(c, p, A, ed, pintar) {
  const ish = P.limparIshikawa(p.ishikawa, D.cfg.categorias), tem = P.causasDoIshikawa(ish).length;
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">2. Ishikawa — por que isso acontece?</h3>
      <p class="muted small" style="margin-top:0">Liste, em cada categoria, tudo o que pode causar o problema. Depois marque as causas mais prováveis: são elas que seguem para os 5 Porquês.</p>
      ${tem ? `<div style="overflow-x:auto">${P.ishikawaSVG(p.titulo, ish.filter(g => g.causas.length))}</div>` : '<div class="empty">Nenhuma causa levantada ainda. Comece pelas categorias abaixo.</div>'}</div>
    <div class="pb-cats">${ish.map((g, gi) => `<div class="pb-cat" data-g="${gi}"><h4>${esc(g.categoria)}</h4>
      ${g.causas.map((x, ci) => `<div class="pb-ca ${x.provavel ? 'pv' : ''}" data-c="${ci}">${ed ? `<input type="checkbox" ${x.provavel ? 'checked' : ''} title="Causa provável" style="width:auto;min-height:0;margin-top:3px">` : (x.provavel ? '●' : '·')}<span>${esc(x.texto)}</span>${ed ? '<button data-rm title="Remover">×</button>' : ''}</div>`).join('') || '<div class="muted small">Sem causas.</div>'}
      ${ed ? '<input data-nova placeholder="Nova causa (Enter para incluir)" style="margin-top:6px">' : ''}</div>`).join('')}</div>`;
  if (!ed) return;
  const grava = (msg) => salvar(p, { ishikawa: ish }, pintar, msg);
  $$('.pb-cat', c).forEach(card => { const g = ish[+card.dataset.g];
    $('[data-nova]', card).onkeydown = (ev) => { if (ev.key !== 'Enter') return; ev.preventDefault(); const t = ev.target.value.trim(); if (!t) return; g.causas.push({ texto: t, provavel: false }); ui._foco = +card.dataset.g; grava(); };
    $$('.pb-ca', card).forEach(l => { const k = +l.dataset.c; $('input', l).onchange = (ev) => { g.causas[k].provavel = ev.target.checked; grava(); }; $('[data-rm]', l).onclick = () => { g.causas.splice(k, 1); grava(); }; }); });
  if (ui._foco != null) { const el = $(`.pb-cat[data-g="${ui._foco}"] [data-nova]`, c); ui._foco = null; if (el) el.focus(); }
}

/* ---- 3. 5 Porquês */
function fPorques(c, p, A, ed, pintar) {
  const pq = P.limparPorques(p.porques), pend = P.partidasPendentes(p.ishikawa, pq);
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">3. 5 Porquês — até a causa raiz</h3>
      <p class="muted small" style="margin-top:0">Para cada causa provável, pergunte "por quê?" até chegar a algo que a empresa pode mudar (processo, padrão, decisão). Nem sempre são cinco: pare quando a resposta deixar de ser consequência de outra coisa.</p>
      ${ed && pend.length ? `<p style="margin:0">Causas prováveis do Ishikawa sem análise: ${pend.map(x => `<button class="btn small" data-par="${esc(x.texto)}">+ ${esc(x.texto)}</button>`).join(' ')}</p>` : ''}
      ${ed ? '<p style="margin:8px 0 0"><button class="btn small" data-par="">+ Nova cadeia de porquês</button></p>' : ''}</div>
    <div id="pq-l">${pq.map((x, i) => `<div class="pb-cad" data-i="${i}"><div class="pb-pq"><label>Partida</label><input data-pa value="${esc(x.partida)}" ${ed ? '' : 'disabled'} placeholder="A causa ou o fato de onde a pergunta começa"></div>
      ${[...x.respostas, ...(ed && x.respostas.length < 7 ? [''] : [])].map((r, k) => `<div class="pb-pq"><label>Por quê? ${k + 1}</label><input data-r value="${esc(r)}" ${ed ? '' : 'disabled'} placeholder="${k === x.respostas.length ? 'Próxima resposta (deixe vazio se já chegou à causa)' : ''}"></div>`).join('')}
      <div class="pb-pq"><label>Conclusão</label><input data-co value="${esc(x.causa)}" ${ed ? '' : 'disabled'} placeholder="A causa a que esta cadeia chegou"></div>
      ${ed ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn small primary" data-s>Salvar cadeia</button><button class="btn small" data-raiz>Usar como causa raiz</button><button class="btn small" data-rm>Excluir cadeia</button></div>` : ''}</div>`).join('') || '<div class="card"><div class="empty">Nenhuma cadeia de porquês.</div></div>'}</div>
    <div class="card"><h3 style="margin-top:0">Causa raiz</h3><textarea id="pq-raiz" rows="2" ${ed ? '' : 'disabled'} placeholder="A causa que, eliminada, impede o problema de voltar">${esc(p.causa_raiz || '')}</textarea>
      ${ed ? '<p style="margin:8px 0 0"><button class="btn primary" id="pq-sr">Salvar a causa raiz</button></p>' : ''}</div>`;
  if (!ed) return;
  const ler = () => $$('#pq-l .pb-cad', c).map(card => ({ partida: $('[data-pa]', card).value, respostas: $$('[data-r]', card).map(i => i.value), causa: $('[data-co]', card).value }));
  $$('[data-par]', c).forEach(b => b.onclick = () => salvar(p, { porques: [...ler(), { partida: b.dataset.par || 'Nova cadeia', respostas: [], causa: '' }] }, pintar));
  $$('#pq-l .pb-cad', c).forEach(card => { const i = +card.dataset.i;
    $('[data-s]', card).onclick = () => salvar(p, { porques: ler() }, pintar, 'Cadeia salva.');
    $('[data-rm]', card).onclick = async () => { if (await confirmDialog('Excluir esta cadeia de porquês?')) { const L = ler(); L.splice(i, 1); salvar(p, { porques: L }, pintar); } };
    $('[data-raiz]', card).onclick = () => { const L = P.limparPorques(ler()), t = P.conclusaoDaCadeia(L[i]); if (!t) return toast('Preencha ao menos uma resposta nesta cadeia.', true); salvar(p, { porques: ler(), causa_raiz: t }, pintar, 'Causa raiz registrada. Monte o plano de ação no 5W2H.'); }; });
  $('#pq-sr', c).onclick = () => salvar(p, { porques: ler(), causa_raiz: $('#pq-raiz', c).value }, pintar, 'Causa raiz salva.');
}

/* ---- 4. 5W2H */
function formAcao(p, a, pintar) {
  const v = a || { o_que: '', por_que: p.causa_raiz ? `Eliminar a causa raiz: ${p.causa_raiz}` : '', onde: '', inicio: '', prazo: '', responsavel_id: '', responsavel_nome: '', como: '', custo_previsto: '' }, externo = a && !a.responsavel_id;
  modal({ title: a ? `Ação ${a.numero} do problema nº ${p.numero}` : `Nova ação do problema nº ${p.numero}`, body: `<div class="pb-g">
      <label class="c6"><span><span class="pb-w">What</span> O que será feito</span><input name="o_que" maxlength="200" value="${esc(v.o_que)}" placeholder="A ação, começando por um verbo: trocar, revisar, treinar, contratar"></label>
      <label class="c6"><span><span class="pb-w">Why</span> Por que será feito</span><input name="por_que" value="${esc(v.por_que || '')}" placeholder="Qual causa esta ação elimina"></label>
      <label class="c3"><span><span class="pb-w">Where</span> Onde</span><input name="onde" value="${esc(v.onde || '')}" placeholder="Setor, máquina, cliente, filial"></label>
      <label class="c3"><span><span class="pb-w">Who</span> Quem (usuário da plataforma)</span><select name="resp">${pessoasOpt(v.responsavel_id)}</select></label>
      <label class="c3"><span><span class="pb-w">Who</span> Ou alguém de fora da plataforma</span><input name="nome" value="${esc(externo ? v.responsavel_nome : '')}" placeholder="Nome (não recebe aviso)"></label>
      <label><span><span class="pb-w">When</span> Início</span><input type="date" name="inicio" value="${v.inicio || ''}"></label><label class="c2"><span><span class="pb-w">When</span> Prazo</span><input type="date" name="prazo" value="${v.prazo || ''}"></label>
      <label class="c6"><span><span class="pb-w">How</span> Como será feito</span><textarea name="como" rows="2" placeholder="Os passos, o método, o recurso necessário">${esc(v.como || '')}</textarea></label>
      <label class="c2"><span><span class="pb-w">How much</span> Quanto custa (R$)</span><input name="custo" inputmode="decimal" value="${v.custo_previsto ? nv(v.custo_previsto) : ''}" placeholder="0,00"></label></div>`,
    foot: `<button class="btn" data-x>Voltar</button><button class="btn primary" data-ok>${a ? 'Salvar a ação' : 'Incluir a ação'}</button>`,
    onMount: (el, close) => { $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = async () => { const g = (n) => $(`[name=${n}]`, el).value;
      try { await rpc('prob_acao_salvar', { p_problema: p.id, p_acao: a?.id || null, p: { o_que: g('o_que'), por_que: g('por_que'), onde: g('onde'), inicio: g('inicio'), prazo: g('prazo'), responsavel_id: g('resp'), responsavel_nome: g('nome'), como: g('como'),
          custo_previsto: g('custo').trim().replace(/\./g, '').replace(',', '.') || '0' } });
        close(); toast(a ? 'Ação salva.' : (g('resp') && g('resp') !== state.user?.id ? 'Ação incluída. O responsável foi avisado.' : 'Ação incluída.')); await recarregar(pintar); } catch (e) { fail(e); } }; } });
}
function f5w2h(c, p, A, ed, pintar, hoje) {
  const pr = P.progresso(A, hoje);
  c.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h3 style="margin:0">4. 5W2H — plano de ação</h3>
      <p class="muted small" style="margin:4px 0 0">${p.causa_raiz ? `Causa raiz: <b>${esc(p.causa_raiz)}</b>` : 'A causa raiz ainda não foi registrada. O plano pode começar pelas ações de contenção.'}</p></div>
      ${ed ? '<button class="btn primary" id="aw-n">Nova ação</button>' : ''}</div>
      ${pr.total ? `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:10px"><div class="pb-bar" style="flex:1;min-width:160px;height:8px"><i style="width:${pr.pct}%"></i></div>
        <span class="small">${pr.feitas} de ${pr.total} concluída(s) (${pr.pct}%)${pr.atrasadas ? ` · <span class="neg">${pr.atrasadas} atrasada(s)</span>` : ''} · previsto R$ ${nv(pr.previsto)}${pr.real ? ` · real R$ ${nv(pr.real)}` : ''}</span></div>` : ''}</div>
    <div class="table-wrap"><table>${CAB_ACOES('Nº')}<tbody>${A.map(a => linhaAcao(a, hoje, false)).join('') || '<tr><td colspan="7" class="empty">Nenhuma ação no plano. Cada ação responde às sete perguntas: o quê, por quê, onde, quando, quem, como e quanto.</td></tr>'}</tbody></table></div>`;
  if ($('#aw-n', c)) $('#aw-n', c).onclick = () => formAcao(p, null, pintar);
  ligarAcoes(c, pintar);
}

/* ---- eficácia e encerramento */
function fFechar(c, p, A, ed, pintar) {
  const pend = P.pendenciasParaEncerrar(p, A, D.cfg), fechado = ['encerrado', 'cancelado'].includes(p.situacao);
  if (fechado) { c.innerHTML = `<div class="card"><h3 style="margin-top:0">${p.situacao === 'encerrado' ? 'Problema encerrado' : 'Problema cancelado'}</h3>
      <p>${p.situacao === 'encerrado' ? `Encerrado em ${hora(p.encerrado_em)} por ${esc(p.encerrado_por || '—')}.${p.eficacia ? ` Eficácia: <b>${p.eficacia === 'eficaz' ? 'ações eficazes' : 'não eficazes'}</b>.` : ''}` : `Cancelado em ${hora(p.encerrado_em)} por ${esc(p.encerrado_por || '—')}: ${esc(p.cancelado_motivo || '')}`}</p>
      ${p.eficacia_obs ? `<p><b>Verificação:</b> ${esc(p.eficacia_obs)}</p>` : ''}<p><b>Causa raiz:</b> ${esc(p.causa_raiz || '—')}</p></div>`; return; }
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">Verificar a eficácia e encerrar</h3>
      ${p.eficacia === 'nao_eficaz' ? `<p class="warn">Verificação anterior (${dateBR(p.eficacia_em)}): as ações não foram eficazes. ${esc(p.eficacia_obs || '')}</p>` : ''}
      ${pend.length ? `<p style="margin-top:0">Ainda não dá para encerrar:</p><ul style="margin-top:0">${pend.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p style="margin-top:0">O plano está concluído. Confira se o problema deixou de acontecer antes de encerrar.</p>'}
      ${conduz(p) ? `<div class="pb-g"><label class="c3">As ações resolveram o problema?<select id="ef-s"><option value="">${D.cfg.exige_eficacia ? 'Escolha…' : 'Não verificar'}</option><option value="eficaz">Sim, as ações foram eficazes</option><option value="nao_eficaz">Não: o problema continua (volta para a análise)</option></select></label>
        <label class="c6">O que foi verificado (indicador, período, quem conferiu)<textarea id="ef-o" rows="3" placeholder="Ex.: em dezembro não houve entrega atrasada; conferido no relatório de logística"></textarea></label>
        <div class="c6"><button class="btn primary" id="ef-ok" ${pend.length ? 'disabled' : ''}>Registrar e encerrar</button></div></div>` : '<p class="muted small">Só quem conduz o problema (responsável, quem abriu, administrador ou diretor) encerra.</p>'}</div>`;
  if ($('#ef-ok', c)) $('#ef-ok', c).onclick = async () => { try { const s = await rpc('prob_encerrar', { p_id: p.id, p_eficacia: $('#ef-s', c).value || null, p_obs: $('#ef-o', c).value || null });
    toast(s === 'encerrado' ? 'Problema encerrado.' : 'Registrado: as ações não resolveram. O problema voltou para a análise.'); if (s !== 'encerrado') ui.ficha = 'ishikawa'; await recarregar(pintar); } catch (e) { fail(e); } };
}

/* ---- diário */
async function fDiario(c, p, A, ed, pintar) {
  c.innerHTML = '<div class="card"><div class="loading">Carregando…</div></div>';
  let L = []; try { L = await q(sb.from('prob_diario').select('*').eq('problema_id', p.id).order('criado_em', { ascending: false })); } catch (e) { fail(e); }
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">Diário do problema</h3>
      ${pode() ? '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:12px"><textarea id="di-t" rows="2" placeholder="Comentário para a equipe (o responsável e quem abriu são avisados)" style="flex:1"></textarea><button class="btn primary" id="di-ok">Comentar</button></div>' : ''}
      ${L.map(x => `<div class="pb-com ${x.tipo === 'sistema' ? 'sis' : ''}">${x.tipo === 'sistema' ? `${hora(x.criado_em)} · ${esc(x.texto)}${x.autor ? ` <small>(${esc(x.autor)})</small>` : ''}` : `<small>${esc(x.autor || '—')} · ${hora(x.criado_em)}</small><div>${esc(x.texto)}</div>`}</div>`).join('') || '<div class="empty">Sem registros.</div>'}</div>`;
  if ($('#di-ok', c)) $('#di-ok', c).onclick = async () => { try { await rpc('prob_comentar', { p_id: p.id, p_texto: $('#di-t', c).value }); toast('Comentário registrado.'); fDiario(c, p, A, ed, pintar); } catch (e) { fail(e); } };
}

/* ------------------------------------------------------------------ impressão: o relatório do problema com as quatro ferramentas */
function imprimir(p, A) {
  const COR = { texto: '#111', grade: '#ccc', barra: '#777', vital: '#111', linha: '#b3261e', cat: '#111', prov: '#b3261e', cabeca: '#111' }, hoje = today();
  const ish = P.limparIshikawa(p.ishikawa, D.cfg.categorias).filter(g => g.causas.length), pq = P.limparPorques(p.porques), G = p.pareto?.itens?.length ? P.pareto(p.pareto.itens, D.cfg.pareto_corte) : null, pr = P.progresso(A, hoje);
  const T = (cab, L) => `<table><thead><tr>${cab.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${L.map(l => `<tr>${l.map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cab.length}">—</td></tr>`}</tbody></table>`;
  abrirRelatorio({ nome: `Análise de Problema ${p.numero}`, titulo: `ANÁLISE DE PROBLEMA Nº ${p.numero}`, subtitulo: esc(p.titulo), paisagem: true,
    extraCss: 'svg{max-width:100%;height:auto} .ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px} .ass div{border-top:1px solid #000;padding-top:4px;text-align:center;font-size:10pt} h2{break-after:avoid} table{break-inside:auto}',
    corpo: `<h2>1. Identificação</h2>${T(['Campo', 'Informação'], [['Área / gravidade', `${esc(p.area)} · ${P.GRAV[p.gravidade][0]}`], ['Responsável', esc(p.responsavel_nome || '—')], ['Aberto em / por', `${dateBR(p.aberto_em)} · ${esc(p.aberto_por_nome || '—')}`],
        ['Prazo', dateBR(p.prazo) || '—'], ['Situação', P.SIT[p.situacao][0]], ...(p.origem_ref ? [['Origem', `${esc(P.ORIGEM[p.origem_tipo] || '')} ${esc(p.origem_ref)}`]] : []), ...(p.descricao ? [['Descrição', esc(p.descricao)]] : [])])}
      ${G ? `<h2>2. Pareto</h2><p>${esc(p.pareto.titulo || '')}${p.pareto.de ? ` · ${dateBR(p.pareto.de)} a ${dateBR(p.pareto.ate)}` : ''}</p>${P.paretoSVG(G, { unidade: p.pareto.unidade, cores: COR })}<p>${esc(P.paretoFrase(G, p.pareto.unidade))}</p>` : ''}
      <h2>${G ? 3 : 2}. Ishikawa</h2>${ish.length ? P.ishikawaSVG(p.titulo, ish, { cores: COR }) + T(['Categoria', 'Causas levantadas (● = provável)'], ish.map(g => [esc(g.categoria), g.causas.map(x => `${x.provavel ? '● ' : ''}${esc(x.texto)}`).join('; ')])) : '<p>Sem causas levantadas.</p>'}
      <h2>${G ? 4 : 3}. 5 Porquês</h2>${pq.length ? pq.map(x => `<p><b>${esc(x.partida)}</b></p><ol>${x.respostas.map(r => `<li>${esc(r)}</li>`).join('')}</ol>${x.causa ? `<p>Conclusão: ${esc(x.causa)}</p>` : ''}`).join('') : '<p>Sem cadeias registradas.</p>'}
      <p><b>Causa raiz:</b> ${esc(p.causa_raiz || '—')}</p>
      <h2>${G ? 5 : 4}. Plano de ação 5W2H</h2>${T(['Nº', 'O quê (What)', 'Por quê (Why)', 'Onde (Where)', 'Quando (When)', 'Quem (Who)', 'Como (How)', 'Quanto (How much)', 'Situação'],
        A.map(a => [a.numero, esc(a.o_que), esc(a.por_que || '—'), esc(a.onde || '—'), `${a.inicio ? dateBR(a.inicio) + ' a ' : ''}${dateBR(a.prazo)}`, esc(a.responsavel_nome), esc(a.como || '—'), 'R$ ' + nv(a.custo_previsto), P.SIT_ACAO[a.situacao][0] + (a.concluida_em ? ' em ' + dateBR(a.concluida_em) : '')]))}
      <p>${pr.feitas} de ${pr.total} ação(ões) concluída(s) · custo previsto R$ ${nv(pr.previsto)}${pr.real ? ` · custo real R$ ${nv(pr.real)}` : ''}</p>
      <h2>${G ? 6 : 5}. Eficácia</h2><p>${p.eficacia ? `${p.eficacia === 'eficaz' ? 'Ações eficazes' : 'Ações não eficazes'}${p.eficacia_em ? ' em ' + dateBR(p.eficacia_em) : ''}. ${esc(p.eficacia_obs || '')}` : 'Ainda não verificada.'}</p>
      <div class="ass"><div>Responsável pelo problema</div><div>Aprovação</div></div>`, rodape: 'Base: Análise de Problemas da plataforma (Pareto, Ishikawa, 5 Porquês e 5W2H)' });
}

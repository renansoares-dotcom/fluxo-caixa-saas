// Painéis › Minhas aprovações (PAI006): tudo o que espera a SUA decisão, numa lista só — pagamentos antecipados, pedidos e
// requisições de compra, borderôs, decisão do dia, prorrogações do Portal, reajustes de contrato, receitas de tinta, artes
// para liberar e inspeções. Aprovar ou recusar aqui usa as mesmas regras de cada tela (as funções do banco de cada módulo).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, dateBR, today } from '../lib/ui.js';
import { dispararAvisos } from '../lib/notif.js';

export const title = 'Minhas aprovações';
const TIPOS = {
  pa: { nome: 'Pagamento antecipado', grupo: 'Pagamentos', recusa: true },
  pedido: { nome: 'Pedido de compra', grupo: 'Compras', recusa: true },
  requisicao: { nome: 'Requisição de compra', grupo: 'Compras', recusa: true },
  bordero: { nome: 'Borderô FIDC', grupo: 'Crédito / FIDC', recusa: true },
  decisao_dia: { nome: 'Decisão do dia', grupo: 'Painéis', recusa: true },
  prorrogacao: { nome: 'Prorrogação do cliente', grupo: 'Financeiro', recusa: true },
  reajuste: { nome: 'Reajuste de contrato', grupo: 'Contratos', recusa: true },
  receita: { nome: 'Receita de tinta em teste', grupo: 'Casa de Tintas', recusa: false, aprovar: 'Aprovar a versão' },
  arte: { nome: 'Arte para liberar', grupo: 'Pré-impressão', recusa: false, aprovar: 'Liberar para produção' },
  inspecao: { nome: 'Inspeção para decidir', grupo: 'Qualidade', recusa: false },
  orcamento_cc: { nome: 'Orçamento do centro de custo', grupo: 'Orçamento', recusa: false },
};
/** executa a decisão pela regra do módulo de origem */
async function decidir(it, aprovar, motivo) {
  const r = (n, a) => q(sb.rpc(n, a));
  switch (it.tipo) {
    case 'pa': return q(sb.from('paraquedas').update({ status: aprovar ? 'aprovado' : 'rejeitado', motivo: aprovar ? null : motivo }).eq('id', it.id));
    case 'pedido': return q(sb.from('compras_pedidos').update(aprovar ? { status: 'aprovado', motivo: null } : { status: 'rascunho', motivo }).eq('id', it.id));
    case 'requisicao': return q(sb.from('compras_requisicoes').update({ status: aprovar ? 'aprovada' : 'rejeitada', motivo: aprovar ? null : motivo }).eq('id', it.id));
    case 'bordero': return r('decidir_proposta_fidc', { p_id: it.id, p_aprovar: aprovar, p_motivo: motivo || null });
    case 'decisao_dia': return r('decidir_decisao_dia', { p_id: it.id, p_aprovar: aprovar, p_motivo: motivo || null });
    case 'prorrogacao': return r('portal_decidir_prorrogacao', { p_id: it.id, p_aprovar: aprovar, p_resposta: motivo || null });
    case 'reajuste': return r('contrato_decidir_reajuste', { p_reajuste: it.id, p_aprovar: aprovar, p_obs: motivo || null });
    case 'receita': return r('tin_aprovar_versao', { p_versao: it.id });
    case 'arte': return r('pre_liberar', { p_projeto: it.id });
    default: throw new Error('Decida na tela de origem.');
  }
}
const CSS = `<style>
  .ap-l{display:flex;flex-direction:column;gap:8px}
  .ap-i{display:grid;grid-template-columns:28px minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
  .ap-i.urg{border-left:4px solid var(--neg)}.ap-i.atr{border-left:4px solid var(--warn)}
  .ap-i input[type=checkbox]{width:18px;height:18px;min-height:0}
  .ap-i .tt{font-weight:600}.ap-i .dd{font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis}
  .ap-i .vv{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .ap-i .bb{display:flex;gap:6px}
  .ap-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--primary-soft);margin-right:6px}
  .ap-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}
  .ap-barra{position:sticky;bottom:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;margin-top:12px;
    border:1px solid var(--border);border-radius:12px;background:var(--surface);box-shadow:0 -4px 16px rgba(0,0,0,.08)}
  .ap-vazio{text-align:center;padding:48px 16px}.ap-vazio div{font-size:42px}
  @media(max-width:760px){.ap-i{grid-template-columns:24px minmax(0,1fr)}.ap-i .vv{grid-column:2;text-align:left}.ap-i .bb{grid-column:1/-1}.ap-i .bb .btn{flex:1}}
</style>`;
const ui = { f: 'todos', sel: new Set() };

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Minhas aprovações</h2><div class="muted small">Tudo o que espera a sua decisão, de todos os módulos. Aprove um por um ou marque vários e decida de uma vez.</div></div>
      <button class="btn ghost" id="ap-at">Atualizar</button></div>
    <div id="ap-corpo"><div class="loading">Carregando…</div></div>`;
  $('#ap-at', root).onclick = () => render(root);
  let L;
  try { L = await q(sb.rpc('minhas_aprovacoes', { p_empresa: state.empresa.id })); }
  catch (err) { fail(err); $('#ap-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 091 (minhas aprovações) já foi executado.</div></div>'; return; }
  L.sort((a, b) => (b.urgente - a.urgente) || String(a.prazo || '9').localeCompare(String(b.prazo || '9')) || String(a.desde).localeCompare(String(b.desde)));
  ui.sel = new Set([...ui.sel].filter(k => L.some(x => x.tipo + x.id === k)));
  const cont = {}; L.forEach(x => cont[x.tipo] = (cont[x.tipo] || 0) + 1);
  if (ui.f !== 'todos' && !cont[ui.f]) ui.f = 'todos';
  const corpo = $('#ap-corpo', root), hoje = today();
  if (!L.length) { corpo.innerHTML = '<div class="card ap-vazio"><div>✓</div><h2>Nada esperando a sua decisão</h2><p class="muted">Quando algo precisar da sua aprovação, aparece aqui e no sino.</p></div>'; return; }
  const pintar = () => {
    const V = L.filter(x => ui.f === 'todos' || x.tipo === ui.f), soma = L.filter(x => ui.sel.has(x.tipo + x.id)).reduce((s, x) => s + (+x.valor || 0), 0);
    corpo.innerHTML = `<div class="card toolbar"><div class="chips" id="ap-f"><span class="chip ${ui.f === 'todos' ? 'on' : ''}" data-f="todos">Tudo (${L.length})</span>
        ${Object.keys(TIPOS).filter(t => cont[t]).map(t => `<span class="chip ${ui.f === t ? 'on' : ''}" data-f="${t}">${TIPOS[t].nome} (${cont[t]})</span>`).join('')}</div>
        <span class="spacer"></span><label class="chk small" style="display:flex;flex-direction:row;gap:6px;align-items:center"><input type="checkbox" id="ap-todos" style="width:auto;min-height:0"> Marcar todos</label></div>
      <div class="ap-l" style="margin-top:12px">${V.map(x => { const T = TIPOS[x.tipo], k = x.tipo + x.id, atr = x.prazo && x.prazo < hoje;
        return `<div class="ap-i ${x.urgente ? 'urg' : atr ? 'atr' : ''}" data-k="${k}"><div>${x.lote ? `<input type="checkbox" data-s="${k}" ${ui.sel.has(k) ? 'checked' : ''}>` : ''}</div>
          <div style="min-width:0"><div><span class="ap-sel ${x.urgente ? 'neg' : ''}">${x.urgente ? 'URGENTE · ' : ''}${esc(T.nome)}${x.numero != null ? ' nº ' + x.numero : ''}</span><span class="tt">${esc(x.titulo)}</span></div>
            <div class="dd">${esc(x.detalhe || '')}${x.prazo ? ` · ${x.tipo === 'pa' ? 'pagar em' : 'até'} <span class="${atr ? 'neg' : ''}">${dateBR(x.prazo)}</span>` : ''} · desde ${new Date(x.desde).toLocaleDateString('pt-BR')}</div></div>
          <div class="vv">${x.valor != null ? `<b>${money(x.valor)}</b>` : ''}</div>
          <div class="bb"><a class="btn ghost small" href="${x.link}">Abrir</a>${T.recusa ? `<button class="btn small danger" data-r="${k}">Recusar</button>` : ''}${x.tipo !== 'inspecao' && x.lote ? `<button class="btn small primary" data-a="${k}">${T.aprovar || 'Aprovar'}</button>` : ''}</div></div>`; }).join('')}</div>
      ${ui.sel.size ? `<div class="ap-barra"><div><b>${ui.sel.size}</b> marcado(s)${soma ? ` · ${money(soma)}` : ''}</div><div style="display:flex;gap:8px">
        <button class="btn ghost" id="ap-limpa">Desmarcar</button>${[...ui.sel].every(k => TIPOS[L.find(x => x.tipo + x.id === k)?.tipo]?.recusa) ? '<button class="btn danger" id="ap-rl">Recusar marcados</button>' : ''}<button class="btn primary" id="ap-al">Aprovar marcados</button></div></div>` : ''}`;
    $('#ap-f', corpo).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.f = f; pintar(); } };
    $('#ap-todos', corpo).onchange = (e) => { V.filter(x => x.lote).forEach(x => e.target.checked ? ui.sel.add(x.tipo + x.id) : ui.sel.delete(x.tipo + x.id)); pintar(); };
    $$('[data-s]', corpo).forEach(c => c.onchange = () => { c.checked ? ui.sel.add(c.dataset.s) : ui.sel.delete(c.dataset.s); pintar(); });
    const ach = (k) => L.find(x => x.tipo + x.id === k);
    $$('[data-a]', corpo).forEach(b => b.onclick = () => executar([ach(b.dataset.a)], true));
    $$('[data-r]', corpo).forEach(b => b.onclick = () => executar([ach(b.dataset.r)], false));
    $('#ap-limpa', corpo) && ($('#ap-limpa', corpo).onclick = () => { ui.sel.clear(); pintar(); });
    $('#ap-al', corpo) && ($('#ap-al', corpo).onclick = () => executar([...ui.sel].map(ach), true));
    $('#ap-rl', corpo) && ($('#ap-rl', corpo).onclick = () => executar([...ui.sel].map(ach), false));
  };
  const executar = (itens, aprovar) => {
    const tot = itens.reduce((s, x) => s + (+x.valor || 0), 0);
    const m = modal({ title: `${aprovar ? 'Aprovar' : 'Recusar'} ${itens.length > 1 ? itens.length + ' itens' : TIPOS[itens[0].tipo].nome.toLowerCase()}`, body: `
      <ul class="small" style="max-height:240px;overflow:auto;margin-top:0">${itens.map(x => `<li><b>${esc(TIPOS[x.tipo].nome)}${x.numero != null ? ' nº ' + x.numero : ''}</b> · ${esc(x.titulo)}${x.valor != null ? ' · ' + money(x.valor) : ''}</li>`).join('')}</ul>
      ${tot ? `<p style="margin:8px 0"><b>Total: ${money(tot)}</b></p>` : ''}
      <label>${aprovar ? 'Observação (opcional)' : 'Motivo da recusa *'}<input id="ap-mot" maxlength="300" placeholder="${aprovar ? '' : 'volta para quem pediu corrigir'}"></label>`,
      foot: `<button class="btn" data-close>Voltar</button><button class="btn ${aprovar ? 'primary' : 'danger'}" id="ap-ok">${aprovar ? 'Aprovar' : 'Recusar'}</button>` });
    $('#ap-ok', m.el).onclick = async (ev) => {
      const mot = $('#ap-mot', m.el).value.trim();
      if (!aprovar && !mot) return toast('Informe o motivo da recusa', true);
      ev.target.disabled = true; ev.target.textContent = 'Decidindo…';
      const erros = [];
      for (const x of itens) { try { await decidir(x, aprovar, mot); ui.sel.delete(x.tipo + x.id); } catch (err) { erros.push(`${TIPOS[x.tipo].nome}${x.numero != null ? ' nº ' + x.numero : ''}: ${err.message || err}`); } }
      m.close(); dispararAvisos();
      if (erros.length) {
        modal({ title: `${itens.length - erros.length} de ${itens.length} decidido(s)`, body: `<p class="small" style="margin-top:0">Estes não foram decididos — abra na tela de origem:</p><ul class="small">${erros.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`, foot: '<button class="btn primary" data-close>Entendi</button>' });
      } else toast(`${itens.length} ${aprovar ? 'aprovado(s)' : 'recusado(s)'}${tot ? ' · ' + money(tot) : ''}`);
      render(root);
    };
  };
  pintar();
}

/** quantidade para o menu e a Minha Manhã */
export async function contarAprovacoes() {
  try { return (await q(sb.rpc('minhas_aprovacoes', { p_empresa: state.empresa.id }))).length; } catch { return 0; }
}

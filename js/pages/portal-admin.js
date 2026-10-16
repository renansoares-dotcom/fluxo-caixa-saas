// Financeiro › Portal do Cliente: pedidos de prorrogação (aprovar/recusar) e acessos (convites e usuários por cliente).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, fail, toast, modal, confirmDialog } from '../lib/ui.js';

export const title = 'Portal do Cliente';
const ui = { aba: 'pedidos' };
const podeDecidir = () => ['admin', 'financeiro'].includes(state.papel);
const podeGerir = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
const linkPortal = (token) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}portal.html?convite=${token}`;

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Portal do Cliente</h2><div class="muted small">O cliente vê títulos, notas (XML), o que comprou e pede prorrogação. O vencimento só muda quando o Financeiro aprova aqui.</div></div>
      ${podeGerir() ? '<button class="btn primary" id="pa-conv">Convidar cliente</button>' : ''}</div>
    <div class="card toolbar"><div class="chips" id="pa-abas"><span class="chip ${ui.aba === 'pedidos' ? 'on' : ''}" data-a="pedidos">Pedidos de prorrogação</span><span class="chip ${ui.aba === 'acessos' ? 'on' : ''}" data-a="acessos">Acessos</span></div>
      <a class="btn ghost small" href="portal.html" target="_blank" rel="noopener">Abrir o portal</a></div>
    <div id="pa-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#pa-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  $('#pa-conv', root) && ($('#pa-conv', root).onclick = () => convidar(root));
  try { ui.aba === 'pedidos' ? await pedidos(root) : await acessos(root); } catch (err) { fail(err); $('#pa-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}
const nomeFav = (id) => state.cad?.favById?.[id]?.nome || '–';

async function pedidos(root) {
  const P = await q(sb.from('portal_prorrogacoes').select('*').eq('empresa_id', state.empresa.id).order('solicitado_em', { ascending: false }).limit(300));
  const pend = P.filter(p => p.status === 'pendente'), dec = P.filter(p => p.status !== 'pendente');
  const tab = (arr, acoes) => `<div class="table-wrap"><table><thead><tr><th>Pedido em</th><th>Cliente</th><th>Documento</th><th class="num">Valor</th><th>Vencimento</th><th>Pede para</th><th class="num">Dias</th><th>Motivo</th><th>${acoes ? '' : 'Decisão'}</th></tr></thead><tbody>
    ${arr.map(p => `<tr><td>${dateBR(p.solicitado_em)}</td><td>${esc(nomeFav(p.favorecido_id))}</td><td>${esc(p.documento || '')}</td><td class="num">${money(p.valor)}</td><td>${dateBR(p.vencimento_atual)}</td><td>${dateBR(p.nova_data)}</td>
      <td class="num">${Math.round((new Date(p.nova_data) - new Date(p.vencimento_atual)) / 864e5)}</td><td class="wrap">${esc(p.motivo)}</td>
      <td>${acoes ? (podeDecidir() ? `<div style="display:flex;gap:4px"><button class="btn ghost small" data-rc="${p.id}">Recusar</button><button class="btn primary small" data-ap="${p.id}">Aprovar</button></div>` : '<span class="muted small">admin/financeiro</span>')
        : `<span class="badge ${p.status === 'aprovada' ? 'pago' : 'vencido'}">${p.status}</span>${p.resposta ? `<div class="small">${esc(p.resposta)}</div>` : ''}`}</td></tr>`).join('')
    || `<tr><td colspan="9" class="empty">${acoes ? 'Nenhum pedido aguardando.' : 'Nada decidido ainda.'}</td></tr>`}</tbody></table></div>`;
  $('#pa-corpo', root).innerHTML = `<div class="card flush"><div style="padding:14px 16px 0"><h2>Aguardando decisão (${pend.length})</h2></div>${tab(pend, true)}</div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Decididos</h2></div>${tab(dec, false)}</div>`;
  const decidir = async (id, ap) => {
    const p = P.find(x => x.id === id);
    const resp = ap ? (prompt('Mensagem para o cliente (opcional):') ?? null) : prompt('Motivo da recusa (o cliente vê):');
    if (resp === null || (!ap && !resp.trim())) return;
    if (ap && !await confirmDialog(`Aprovar: o vencimento do título ${p.documento || ''} passa de ${dateBR(p.vencimento_atual)} para ${dateBR(p.nova_data)} no contas a receber.`)) return;
    try { await q(sb.rpc('portal_decidir_prorrogacao', { p_id: id, p_aprovar: ap, p_resposta: resp })); toast(ap ? 'Prorrogação aprovada' : 'Pedido recusado'); render(root); } catch (err) { fail(err); }
  };
  $$('[data-ap]', root).forEach(b => b.onclick = () => decidir(b.dataset.ap, true));
  $$('[data-rc]', root).forEach(b => b.onclick = () => decidir(b.dataset.rc, false));
}

async function acessos(root) {
  const e = state.empresa.id;
  const [U, C] = await Promise.all([q(sb.from('portal_usuarios').select('*').eq('empresa_id', e).order('criado_em', { ascending: false })),
    q(sb.from('portal_convites').select('*').eq('empresa_id', e).is('aceito_em', null).is('cancelado_em', null).order('criado_em', { ascending: false }))]);
  $('#pa-corpo', root).innerHTML = `<div class="card flush"><div style="padding:14px 16px 0"><h2>Clientes com acesso</h2></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>E-mail</th><th>Desde</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead><tbody>
    ${U.map(u => `<tr><td>${esc(nomeFav(u.favorecido_id))}</td><td>${esc(u.email)}</td><td>${dateBR(u.criado_em)}</td><td>${u.ultimo_acesso ? dateBR(u.ultimo_acesso) : '–'}</td><td>${u.ativo ? '<span class="badge pago">ativo</span>' : '<span class="badge">bloqueado</span>'}</td>
      <td>${podeGerir() ? `<button class="btn ghost small" data-tg="${u.id}" data-at="${u.ativo}">${u.ativo ? 'Bloquear' : 'Liberar'}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum cliente acessou ainda.</td></tr>'}</tbody></table></div></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Convites pendentes</h2></div><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>E-mail</th><th>Criado</th><th>Vence</th><th></th></tr></thead><tbody>
    ${C.map(c => `<tr><td>${esc(nomeFav(c.favorecido_id))}</td><td>${esc(c.email)}</td><td>${dateBR(c.criado_em)}</td><td>${dateBR(c.expira_em)}</td>
      <td><div style="display:flex;gap:4px"><button class="btn ghost small" data-cp="${c.token}">Copiar link</button>${podeGerir() ? `<button class="btn ghost small" data-cx="${c.id}">Cancelar</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum convite pendente.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-tg]', root).forEach(b => b.onclick = async () => { try { await q(sb.from('portal_usuarios').update({ ativo: b.dataset.at !== 'true' }).eq('id', b.dataset.tg)); render(root); } catch (err) { fail(err); } });
  $$('[data-cp]', root).forEach(b => b.onclick = () => copiar(linkPortal(b.dataset.cp)));
  $$('[data-cx]', root).forEach(b => b.onclick = async () => { if (!await confirmDialog('Cancelar este convite?')) return; try { await q(sb.rpc('portal_cancelar_convite', { p_id: b.dataset.cx })); render(root); } catch (err) { fail(err); } });
}
const copiar = async (t) => { try { await navigator.clipboard.writeText(t); toast('Link copiado'); } catch { prompt('Copie o link:', t); } };

function convidar(root) {
  const cli = (state.cad?.favorecidos || []).filter(f => f.ativo && ['CLIENTES', 'TERCEIROS - CLIENTES'].includes(f.tipo));
  const m = modal({ title: 'Convidar cliente para o portal', body: `
    <label>Cliente<input id="cv-c" list="cv-dl" placeholder="nome do cliente"><datalist id="cv-dl">${cli.map(f => `<option value="${esc(f.nome)}"></option>`).join('')}</datalist></label>
    <label style="margin-top:8px">E-mail de quem vai acessar<input id="cv-e" type="email"></label>
    <p class="small muted">O convite vale 14 dias. A plataforma não envia e-mail: copie o link e mande ao cliente. Ele cria a própria senha e confirma o e-mail.</p>
    <div id="cv-res"></div>`, foot: `<button class="btn" data-close>Fechar</button><button class="btn primary" id="cv-ok">Gerar convite</button>` });
  $('#cv-c', m.el).onchange = () => { const f = cli.find(x => x.nome === $('#cv-c', m.el).value); if (f?.email && !$('#cv-e', m.el).value) $('#cv-e', m.el).value = f.email; };
  $('#cv-ok', m.el).onclick = async (ev) => {
    const f = cli.find(x => x.nome === $('#cv-c', m.el).value); if (!f) return toast('Escolha o cliente da lista', true);
    ev.target.disabled = true;
    try { const tk = await q(sb.rpc('portal_criar_convite', { p_empresa: state.empresa.id, p_favorecido: f.id, p_email: $('#cv-e', m.el).value }));
      const link = linkPortal(tk);
      $('#cv-res', m.el).innerHTML = `<p class="pos small">Convite criado para ${esc(f.nome)}.</p><input readonly value="${esc(link)}" style="width:100%"><button class="btn small" id="cv-cp" style="margin-top:6px">Copiar link</button>`;
      $('#cv-cp', m.el).onclick = () => copiar(link); ev.target.hidden = true;
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  m.el.addEventListener('click', (e) => { if (e.target.closest('[data-close]') && ui.aba === 'acessos') render(root); });
}

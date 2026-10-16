// Portal do Cliente: acesso por convite, separado dos usuários internos. Tudo vem de funções do banco que devolvem
// só o que o cliente pode ver (títulos, notas e XML, compras, pedidos de prorrogação).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, $$, esc, money, dateBR, today, toast, fail, modal } from './lib/ui.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const main = $('#pt-main');
const token = new URLSearchParams(location.search).get('convite');
const S = { clientes: [], fav: null, aba: 'titulos' };
const base = () => location.href.split('#')[0].split('?')[0];

// ---------------------------------------------------------------- autenticação
async function telaLogin(cadastro = false, conviteInfo = null) {
  $('#pt-user').hidden = true; $('#pt-quem').textContent = '';
  main.innerHTML = `<div class="card pt-auth"><h2 style="margin-top:0">${cadastro ? 'Criar acesso' : 'Entrar'}</h2>
    ${conviteInfo ? `<p class="small">Convite de <b>${esc(conviteInfo.empresa)}</b> para <b>${esc(conviteInfo.cliente)}</b>. Crie sua senha; depois confirme o e-mail pelo link que vai chegar.</p>` : ''}
    <form id="pt-f"><label>E-mail<input name="email" type="email" required autocomplete="email" value="${esc(conviteInfo?.email || '')}"></label>
      <label>Senha<input name="senha" type="password" required minlength="6" autocomplete="${cadastro ? 'new-password' : 'current-password'}"></label>
      <div id="pt-msg" class="msg"></div>
      <button class="btn primary" type="submit">${cadastro ? 'Criar acesso' : 'Entrar'}</button></form>
    <p class="small" style="margin-bottom:0">${cadastro ? '<a href="#" id="pt-tg">Já tenho acesso</a>' : '<a href="#" id="pt-tg">Recebi um convite</a> · <a href="#" id="pt-esq">Esqueci a senha</a>'}</p></div>`;
  $('#pt-tg').onclick = (e) => { e.preventDefault(); telaLogin(!cadastro, conviteInfo); };
  $('#pt-esq') && ($('#pt-esq').onclick = async (e) => { e.preventDefault(); const em = $('#pt-f [name=email]').value.trim(); if (!em) return toast('Digite seu e-mail', true);
    const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: base() }); error ? fail(error) : toast('Enviamos um link para redefinir a senha'); });
  $('#pt-f').onsubmit = async (e) => {
    e.preventDefault(); const em = e.target.email.value.trim(), pw = e.target.senha.value, msg = $('#pt-msg');
    if (cadastro) {
      const { error } = await sb.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: base() } });
      msg.innerHTML = error ? `<span class="neg">${esc(error.message)}</span>` : 'Acesso criado. Confirme o e-mail pelo link que enviamos e depois entre aqui.';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (error) msg.innerHTML = `<span class="neg">${error.message.includes('Invalid') ? 'E-mail ou senha incorretos.' : esc(error.message)}</span>`; else iniciar();
    }
  };
}

async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    let ci = null; if (token) { try { ci = (await q(sb.rpc('portal_ver_convite', { p_token: token })))?.[0] || null; } catch {} }
    if (token && !ci) toast('Este convite não vale mais (usado, cancelado ou vencido).', true);
    return telaLogin(!!ci, ci);
  }
  try {
    await q(sb.rpc('portal_aceitar_convites'));
    S.clientes = await q(sb.rpc('portal_meus_clientes'));
  } catch (err) { fail(err); S.clientes = []; }
  $('#pt-user').hidden = false; $('#pt-quem').textContent = session.user.email;
  if (!S.clientes.length) {
    main.innerHTML = `<div class="card pt-auth"><h2 style="margin-top:0">Acesso ainda não liberado</h2><p>Seu login funciona, mas este e-mail não tem convite ativo do portal${session.user.email_confirmed_at ? '' : ' ou ainda não foi confirmado (veja o link que enviamos)'}. Fale com o financeiro da empresa.</p></div>`;
    return;
  }
  $('#pt-cli').innerHTML = S.clientes.map((c, i) => `<option value="${i}">${esc(c.cliente)}${S.clientes.some((x, j) => j !== i && x.empresa !== c.empresa) ? ' — ' + esc(c.empresa) : ''}</option>`).join('');
  $('#pt-cli').hidden = S.clientes.length < 2;
  $('#pt-cli').onchange = (e) => { S.fav = S.clientes[+e.target.value]; pintar(); };
  S.fav = S.clientes[0]; pintar();
}
$('#pt-sair').onclick = async () => { await sb.auth.signOut(); location.href = base(); };
$('#pt-senha').onclick = () => {
  const m = modal({ title: 'Alterar senha', body: `<label>Nova senha<input type="password" id="ns1" minlength="6"></label><label style="margin-top:8px">Repita<input type="password" id="ns2"></label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ns-ok">Salvar</button>` });
  $('#ns-ok', m.el).onclick = async () => { const a = $('#ns1', m.el).value, b = $('#ns2', m.el).value; if (a.length < 6 || a !== b) return toast('As senhas precisam ser iguais e ter 6+ caracteres', true);
    const { error } = await sb.auth.updateUser({ password: a }); if (error) return fail(error); m.close(); toast('Senha alterada'); };
};
sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') setTimeout(() => $('#pt-senha').click(), 300); });

// ---------------------------------------------------------------- telas
function pintar() {
  const c = S.fav;
  main.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">${esc(c.cliente)}</h2><div class="muted small">${esc(c.documento || '')} · fornecedor: ${esc(c.empresa)}</div></div></div>
    <div class="card toolbar"><div class="chips" id="pt-abas">${[['titulos', 'Títulos'], ['notas', 'Notas fiscais'], ['compras', 'O que comprei'], ['pedidos', 'Pedidos de prorrogação']]
      .map(([k, t]) => `<span class="chip ${S.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div id="pt-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#pt-abas').onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { S.aba = a; pintar(); } };
  ({ titulos, notas, compras, pedidos })[S.aba]().catch(err => { fail(err); $('#pt-corpo').innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; });
}

async function titulos() {
  const T = await q(sb.rpc('portal_titulos', { p_fav: S.fav.favorecido_id })), h = today();
  const ab = T.filter(t => t.situacao === 'aberto'), neg = T.filter(t => t.situacao === 'negociado'), pg = T.filter(t => t.situacao === 'pago').reverse();
  const venc = ab.filter(t => t.data < h), tot = (a) => a.reduce((s, t) => s + +t.valor, 0);
  $('#pt-corpo').innerHTML = `<div class="kpis"><div class="kpi"><div class="k-label">A pagar</div><div class="k-value">${money(tot(ab))}</div><div class="k-sub">${ab.length} título(s)</div></div>
      <div class="kpi"><div class="k-label">Vencidos</div><div class="k-value ${venc.length ? 'neg' : ''}">${money(tot(venc))}</div><div class="k-sub">${venc.length} título(s)</div></div>
      ${neg.length ? `<div class="kpi"><div class="k-label">Com banco</div><div class="k-value">${money(tot(neg))}</div><div class="k-sub">${neg.length} título(s)</div></div>` : ''}</div>
    <div class="card flush" style="margin-top:12px"><div style="padding:14px 16px 0"><h2>A pagar</h2></div><div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Documento</th><th class="num">Valor</th><th>Prorrogação</th><th></th></tr></thead><tbody>
      ${ab.map(t => `<tr><td class="${t.data < h ? 'neg' : ''}">${dateBR(t.data)}</td><td>${esc(t.documento || '')}</td><td class="num">${money(t.valor)}</td><td class="small">${esc(rotPr(t.prorrogacao))}</td>
        <td>${t.pode_prorrogar ? `<button class="btn ghost small" data-pr="${t.id}">Pedir prorrogação</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum título em aberto.</td></tr>'}</tbody></table></div></div>
    ${neg.length ? `<div class="card flush" style="margin-top:12px"><div style="padding:14px 16px 0"><h2>Pagar pelo boleto do banco</h2><p class="pt-aviso" style="margin:0 0 12px">Estes títulos foram transferidos a uma instituição financeira. O pagamento deve ser feito pelo boleto enviado pelo banco; dúvidas sobre eles, inclusive prorrogação, são tratadas com a instituição indicada no boleto.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Vencimento</th><th>Documento</th><th class="num">Valor</th></tr></thead><tbody>${neg.map(t => `<tr><td>${dateBR(t.data)}</td><td>${esc(t.documento || '')}</td><td class="num">${money(t.valor)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="card flush" style="margin-top:12px"><div style="padding:14px 16px 0"><h2>Pagos — 12 meses</h2></div><div class="table-wrap" style="max-height:360px"><table><thead><tr><th>Pago em</th><th>Documento</th><th class="num">Valor</th></tr></thead><tbody>
      ${pg.map(t => `<tr><td>${dateBR(t.data)}</td><td>${esc(t.documento || '')}</td><td class="num">${money(t.valor)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhum pagamento registrado.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-pr]').forEach(b => b.onclick = () => pedir(ab.find(t => t.id === b.dataset.pr)));
}
const rotPr = (s) => !s ? '' : s.startsWith('pendente') ? 'em análise' : s.startsWith('aprovada') ? 'aprovada' : s.startsWith('recusada') ? 'recusada' + s.slice(8) : '';

function pedir(t) {
  const m = modal({ title: `Pedir prorrogação — ${t.documento || ''}`, body: `<p class="small" style="margin-top:0">Vencimento atual ${dateBR(t.data)} · ${money(t.valor)}. O pedido vai para o financeiro; o vencimento só muda se for aprovado.</p>
    <label>Nova data<input type="date" id="pr-d" min="${t.data}"></label><label style="margin-top:8px">Motivo<input id="pr-m" maxlength="300"></label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pr-ok">Enviar pedido</button>` });
  $('#pr-ok', m.el).onclick = async (ev) => {
    ev.target.disabled = true;
    try { await q(sb.rpc('portal_solicitar_prorrogacao', { p_fav: S.fav.favorecido_id, p_lancamento: t.id, p_nova_data: $('#pr-d', m.el).value || null, p_motivo: $('#pr-m', m.el).value }));
      m.close(); toast('Pedido enviado. Você vê a resposta em "Pedidos de prorrogação".'); titulos(); } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

async function notas() {
  const N = await q(sb.rpc('portal_notas', { p_fav: S.fav.favorecido_id, p_de: new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10) }));
  $('#pt-corpo').innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:70vh"><table><thead><tr><th>Nota</th><th>Emissão</th><th class="num">Valor</th><th class="pt-hide-sm">Parcelas</th><th class="pt-hide-sm">Chave de acesso</th><th></th></tr></thead><tbody>
    ${N.map(n => `<tr><td>${n.numero}${n.serie ? '-' + esc(n.serie) : ''}</td><td>${dateBR(n.emissao)}</td><td class="num">${money(n.valor)}</td>
      <td class="small pt-hide-sm">${(n.parcelas || []).map(p => `${dateBR(p.vencimento)} ${money(p.valor)}`).join('<br>')}</td><td class="small pt-hide-sm" style="font-family:monospace">${esc(n.chave || '')}</td>
      <td>${n.tem_xml ? `<button class="btn ghost small" data-x="${n.id}" data-n="${n.numero}">XML</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma nota nos últimos 13 meses.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">A DANFE pode ser consultada no portal da NF-e com a chave de acesso.</p>`;
  $$('[data-x]').forEach(b => b.onclick = async () => {
    try { const xml = await q(sb.rpc('portal_nota_xml', { p_fav: S.fav.favorecido_id, p_nota: b.dataset.x })); if (!xml) return toast('XML indisponível', true);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' })); a.download = `NFe_${b.dataset.n}.xml`; a.click(); URL.revokeObjectURL(a.href); } catch (err) { fail(err); }
  });
}

async function compras() {
  const C = await q(sb.rpc('portal_compras', { p_fav: S.fav.favorecido_id }));
  $('#pt-corpo').innerHTML = `<div class="card flush"><div style="padding:14px 16px 0"><h2>Produtos comprados — 12 meses</h2></div><div class="table-wrap"><table><thead><tr><th>Produto</th><th class="num">Quantidade</th><th class="num">Valor</th><th class="num">Notas</th><th>Última compra</th></tr></thead><tbody>
    ${C.map(p => `<tr><td class="wrap">${esc(p.codigo || '')} — ${esc(p.descricao || '')}</td><td class="num">${(+p.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${esc(p.unidade || '')}</td>
      <td class="num">${money(p.valor)}</td><td class="num">${p.notas}</td><td>${dateBR(p.ultima)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma compra nos últimos 12 meses.</td></tr>'}</tbody></table></div></div>`;
}

async function pedidos() {
  const P = await q(sb.rpc('portal_minhas_solicitacoes', { p_fav: S.fav.favorecido_id }));
  const st = { pendente: ['Em análise', 'aberto'], aprovada: ['Aprovada', 'pago'], recusada: ['Recusada', 'vencido'], cancelada: ['Cancelada', ''] };
  $('#pt-corpo').innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Pedido em</th><th>Documento</th><th class="num">Valor</th><th>De</th><th>Para</th><th>Situação</th><th>Resposta</th></tr></thead><tbody>
    ${P.map(s => `<tr><td>${dateBR(s.solicitado_em)}</td><td>${esc(s.documento || '')}</td><td class="num">${money(s.valor)}</td><td>${dateBR(s.vencimento_atual)}</td><td>${dateBR(s.nova_data)}</td>
      <td><span class="badge ${st[s.status]?.[1] || ''}">${st[s.status]?.[0] || s.status}</span></td><td class="wrap small">${esc(s.resposta || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum pedido.</td></tr>'}</tbody></table></div></div>`;
}

iniciar();

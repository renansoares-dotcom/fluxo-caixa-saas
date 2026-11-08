// Portal do Cliente: acesso por convite, separado dos usuários internos. Tudo vem de funções do banco que devolvem
// só o que o cliente pode ver (títulos, notas e XML, compras, pedidos de prorrogação e a aprovação das artes de embalagem).
import { createClient } from '../vendor/supabase-2.117.2.esm.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, $$, esc, money, dateBR, today, toast, fail, modal } from './lib/ui.js';
import * as PI from './lib/preimpressao.js';
import { CSS as CSS_ARTE } from './lib/preimpressao-css.js';
import { exigirTermo } from './lib/lgpd-termo.js';
import { viewer, prepararArquivo, subirArquivos, linksArte, conferirArquivo, ACEITOS } from './lib/arte-viewer.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const avisar = () => { sb.functions.invoke('notificar', { body: {} }).catch(() => {}); sb.functions.invoke('email', { body: {} }).catch(() => {}); };   // manda já o aviso à equipe (o agendamento também manda)
const main = $('#pt-main');
const token = new URLSearchParams(location.search).get('convite');
const S = { clientes: [], fav: null, aba: new URLSearchParams(location.search).get('arte') ? 'artes' : 'titulos', pend: 0, arte: new URLSearchParams(location.search).get('arte') };
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
  exigirTermo(sb, 'portal_termo_pendente', {}, { sair: () => $('#pt-sair').click() });
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
async function pintar() {
  const c = S.fav;
  try { S.lista = await q(sb.rpc('portal_artes', { p_fav: c.favorecido_id })); } catch { S.lista = []; }
  S.pend = S.lista.filter(a => a.pendente).length;
  if (S.pend && S.aba === 'titulos' && !S.vistoArtes) { S.vistoArtes = true; }
  main.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">${esc(c.cliente)}</h2><div class="muted small">${esc(c.documento || '')} · fornecedor: ${esc(c.empresa)}</div></div></div>
    <div class="card toolbar"><div class="chips" id="pt-abas">${[['titulos', 'Títulos'], ['notas', 'Notas fiscais'], ['compras', 'O que comprei'], ['pedidos', 'Pedidos de prorrogação'], ...(S.lista.length ? [['artes', 'Artes para aprovar']] : [])]
      .map(([k, t]) => `<span class="chip ${S.aba === k ? 'on' : ''}" data-a="${k}">${t}${k === 'artes' && S.pend ? ` <b class="pt-n">${S.pend}</b>` : ''}</span>`).join('')}</div></div>
    ${S.pend && S.aba !== 'artes' ? `<div class="pt-aviso" style="margin-top:12px;cursor:pointer" id="pt-ir-artes">🎨 <b>${S.pend} arte(s) aguardando a sua aprovação.</b> Clique para conferir e aprovar.</div>` : ''}
    <div id="pt-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#pt-abas').onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { S.aba = a; S.arte = null; pintar(); } };
  $('#pt-ir-artes') && ($('#pt-ir-artes').onclick = () => { S.aba = 'artes'; pintar(); });
  ({ titulos, notas, compras, pedidos, artes })[S.aba]().catch(err => { fail(err); $('#pt-corpo').innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; });
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
      avisar(); m.close(); toast('Pedido enviado. Você vê a resposta em "Pedidos de prorrogação".'); titulos(); } catch (err) { fail(err); ev.target.disabled = false; }
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

// ---------------------------------------------------------------- artes para aprovar (pré-impressão)
const SIT_CLIENTE = { em_criacao: ['Em preparação pela equipe', 'info'], aguardando_cliente: ['Aguardando a sua aprovação', 'warn'], alteracao_solicitada: ['Alteração pedida — em ajuste', 'neg'],
  reprovada: ['Reprovada — em ajuste', 'neg'], aprovada: ['Aprovada', 'pos'], na_clicheria: ['Aprovada · gravando clichês', 'pos'], liberada: ['Aprovada · em produção', 'pos'] };
const seloC = (s) => { const [t, c] = SIT_CLIENTE[s] || [s, '']; return `<span class="pi-sel ${c}">${esc(t)}</span>`; };
const horaC = (t) => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const nfC = (v, c = 1) => v == null ? '–' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: c });
let VW = null;

async function artes() {
  VW?.destruir(); VW = null;
  if (S.arte) return arte(S.arte);
  const L = S.lista || [];
  $('#pt-corpo').innerHTML = `${CSS_ARTE}<div class="pt-artes">${L.map(a => `<div class="pi-card ${a.pendente ? 'pt-pend' : ''}" data-ar="${a.id}"><div class="im" data-im="${a.versao_id || ''}"></div>
      <div class="tx"><b>${esc(a.nome)}</b><div class="muted">${a.codigo_cliente ? esc(a.codigo_cliente) + ' · ' : ''}arte nº ${a.numero}${a.versao ? ' · versão ' + a.versao : ''}</div>
      <div style="margin-top:6px">${seloC(a.situacao)}</div>${a.pendente && a.prazo ? `<div class="small ${a.prazo < today() ? 'neg' : 'muted'}" style="margin-top:4px">Responder até ${dateBR(a.prazo)}</div>` : ''}</div></div>`).join('')
    || '<div class="card"><div class="empty">Nenhuma arte.</div></div>'}</div>
    <p class="small muted">Aqui você confere cada arte antes da impressão: amplie, compare com a versão anterior, marque pontos com comentários e aprove — ou peça a alteração.</p>`;
  $('#pt-corpo').onclick = (e) => { const c = e.target.closest('[data-ar]'); if (c) { S.arte = c.dataset.ar; artes(); } };
  // miniaturas: a ficha de cada arte traz o caminho da prévia
  for (const a of L.filter(x => x.versao_id)) {
    q(sb.rpc('portal_arte', { p_fav: S.fav.favorecido_id, p_projeto: a.id })).then(async (A) => {
      const v = A.versoes.find(x => x.id === a.versao_id); if (!v?.previa) return;
      const U = await linksArte(sb, [v.previa]); const el = document.querySelector(`[data-ar="${a.id}"] .im`); if (el && U[v.previa]) el.innerHTML = `<img src="${U[v.previa]}" alt="">`;
    }).catch(() => {});
  }
}

async function arte(id, versaoSel = null) {
  VW?.destruir(); VW = null;
  const corpo = $('#pt-corpo');
  corpo.innerHTML = '<div class="loading">Abrindo a arte…</div>';
  let A; try { A = await q(sb.rpc('portal_arte', { p_fav: S.fav.favorecido_id, p_projeto: id })); } catch (err) { fail(err); S.arte = null; return artes(); }
  const p = A.projeto, Vs = A.versoes, enviadas = Vs.filter(v => v.enviada_em), ultEnv = enviadas.at(-1);
  const pend = p.situacao === 'aguardando_cliente' && ultEnv;
  const v = Vs.find(x => x.id === versaoSel) || (pend ? ultEnv : Vs.find(x => x.id === p.versao_aprovada_id) || Vs.at(-1));
  if (!v) { corpo.innerHTML = '<div class="card"><div class="empty">A equipe ainda está preparando esta arte.</div></div>'; return; }
  const ant = enviadas.filter(x => x.numero < v.numero).at(-1);
  const comV = A.comentarios.filter(c => c.versao_id === v.id).map((c, i) => ({ ...c, n: i + 1 }));
  const decV = A.decisoes.filter(d => d.versao_id === v.id).at(-1);
  const podeDecidir = pend && v.id === ultEnv.id, podeComentar = !['cancelada', 'liberada'].includes(p.situacao) && (v.enviada_em || v.origem === 'cliente');
  const podeEnviar = !['aprovada', 'na_clicheria', 'liberada', 'cancelada'].includes(p.situacao);
  const g = p.ean ? PI.gtin(p.ean) : null;
  let marca = null;
  corpo.innerHTML = `${CSS_ARTE}<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn ghost small" id="pa-volta">← Todas as artes</button><div>${seloC(p.situacao)}</div></div>
    <div class="card" style="margin-bottom:12px"><h2 style="margin:0 0 4px">${esc(p.nome)}</h2><div class="small muted">Arte nº ${p.numero}${p.codigo_cliente ? ' · seu código ' + esc(p.codigo_cliente) : ''}</div>
      <div class="pi-dados" style="margin-top:10px"><div><span>Dimensões</span>${p.largura_mm ? `${nfC(p.largura_mm, 2)} × ${nfC(p.altura_mm, 2)} mm` : '—'}</div><div><span>Material</span>${esc(p.substrato || '—')}</div>
        <div><span>Código de barras</span>${p.ean ? `${esc(p.ean)} <span class="${g.ok ? 'pos' : 'neg'}">${g.ok ? '✓ válido' : '✕ ' + esc(g.msg)}</span>` : '—'}</div><div><span>Desbobinamento</span>${p.desbobinamento ? `posição ${p.desbobinamento}` : '—'}</div>
        <div class="w2"><span>Cores</span>${(p.cores || []).map(c => `<span class="pi-chip-cor"><i style="background:${esc(c.hex || '#ccc')}"></i>${esc(c.pantone || c.nome || '')}</span>`).join('') || '—'}</div>
        ${p.desbobinamento ? `<div class="w2">${PI.desbobinamentoSvg(p.desbobinamento, { w: 140, h: 70 })}</div>` : ''}</div></div>
    ${podeDecidir ? `<div class="card pt-decida"><div><b>Esta arte aguarda a sua aprovação.</b><div class="small">Confira textos, cores, medidas e o código de barras. Para apontar um ajuste, use <b>📍 Marcar na arte</b> e escreva o comentário.${p.prazo ? ` Responda até <b>${dateBR(p.prazo)}</b>.` : ''}</div></div>
      <div class="pt-botoes"><button class="btn danger" data-dec="reprovada">Reprovar</button><button class="btn" data-dec="alteracao">Pedir alteração</button><button class="btn primary" data-dec="aprovada">Aprovar a arte</button></div></div>` : ''}
    ${decV?.decisao === 'aprovada' ? `<div class="card pt-ok">✓ Versão ${v.numero} aprovada por <b>${esc(decV.nome || '')}</b> em ${horaC(decV.criado_em)}. <button class="btn ghost small" id="pa-comp">Comprovante</button></div>` : ''}
    <div class="pi-arte"><div><div class="pi-vers">${Vs.map(x => `<span class="chip ${x.id === v.id ? 'on' : ''} ${x.id === p.versao_aprovada_id ? 'ap' : ''}" data-v="${x.id}">Versão ${x.numero}${x.origem === 'cliente' ? ' (sua)' : ''}${x.id === p.versao_aprovada_id ? ' ✓' : ''}</span>`).join('')}
        ${ant?.previa && v.previa ? `<span class="spacer"></span><label class="chk"><input type="checkbox" id="pa-cmp"> Comparar com a versão ${ant.numero}</label>` : ''}</div>
        <div id="pa-vw">${v.previa ? '' : '<div class="pi-drop" style="cursor:default">Sem visualização para este arquivo. Baixe o original.</div>'}</div></div>
      <aside class="pi-lado">
        <div class="pi-bloco"><h3>Versão ${v.numero}</h3>${v.observacao ? `<div class="small">“${esc(v.observacao)}”</div>` : ''}<div class="small muted">${horaC(v.enviada_em || v.criado_em)} · ${esc(v.nome)}</div>
          <div class="pi-hash" title="${v.hash}">Impressão digital (SHA-256): ${PI.hashCurto(v.hash)}</div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn ghost small" id="pa-baixar">Baixar o arquivo</button><button class="btn ghost small" id="pa-conf">Conferir integridade</button>
            ${podeEnviar ? '<button class="btn ghost small" id="pa-env">Enviar um arquivo</button>' : ''}</div></div>
        <div class="pi-bloco"><h3>Comentários (${comV.length})</h3><div id="pa-cl">${comV.map(c => `<div class="pi-com ${c.resolvido ? 'ok' : ''}" data-c="${c.id}"><span class="n ${c.x == null ? 'ger' : c.origem === 'cliente' ? '' : 'eq'}">${c.x == null ? '•' : c.n}</span>
            <div style="min-width:0;flex:1"><div class="t">${esc(c.texto)}</div><div class="q">${c.origem === 'cliente' ? esc(c.autor || 'Você') : 'Equipe de pré-impressão'} · ${horaC(c.criado_em)}${c.resolvido ? ' · resolvido' : ''}</div></div></div>`).join('') || '<div class="small muted">Nenhum comentário.</div>'}</div>
          ${podeComentar ? `<div style="margin-top:8px"><div class="small muted" id="pa-pin">Comentário geral — ou clique em 📍 Marcar na arte</div><textarea id="pa-ct" rows="3" maxlength="2000" placeholder="ex.: trocar o texto da validade; o vermelho está mais escuro que o padrão"></textarea>
            <div style="text-align:right;margin-top:6px"><button class="btn small" id="pa-cs">Comentar</button></div></div>` : ''}</div>
        <div class="pi-bloco"><h3>Andamento</h3><div class="pi-tl">${[...A.eventos].reverse().slice(0, 12).map(e => `<div>${esc(e.texto)}<small>${horaC(e.criado_em)}</small></div>`).join('')}</div></div>
      </aside></div>`;
  $('#pa-volta').onclick = () => { S.arte = null; artes(); };
  $$('[data-v]', corpo).forEach(c => c.onclick = () => arte(id, c.dataset.v));
  $('#pa-baixar').onclick = async () => { try { const { data, error } = await sb.storage.from('artes').createSignedUrl(v.caminho, 300, { download: v.nome }); if (error) throw error; window.open(data.signedUrl, '_blank'); } catch (e) { fail(e); } };
  $('#pa-conf').onclick = async (ev) => { ev.target.disabled = true; try { const r = await conferirArquivo(sb, v.caminho, v.hash); r.ok ? toast('✓ Arquivo íntegro: é exatamente o arquivo desta versão.') : toast('O arquivo não confere com o registrado. Fale com a equipe.', true); } catch (e) { fail(e); } ev.target.disabled = false; };
  $('#pa-env') && ($('#pa-env').onclick = () => enviarArquivo(p, () => arte(id)));
  $('#pa-comp') && ($('#pa-comp').onclick = () => comprovante(p, v, decV));
  $('#pa-cs') && ($('#pa-cs').onclick = async (ev) => {
    const t = $('#pa-ct').value.trim(); if (!t) return toast('Escreva o comentário', true);
    ev.target.disabled = true;
    try { await q(sb.rpc('portal_arte_comentar', { p_fav: S.fav.favorecido_id, p_versao: v.id, p_x: marca?.x ?? null, p_y: marca?.y ?? null, p_texto: t })); toast('Comentário enviado à equipe'); avisar(); arte(id, v.id); }
    catch (err) { fail(err); ev.target.disabled = false; }
  });
  $('#pa-cl').onclick = (e) => { const c = e.target.closest('[data-c]'); if (c && VW) VW.centrar(c.dataset.c); };
  $$('[data-dec]', corpo).forEach(b => b.onclick = () => decidir(p, v, b.dataset.dec, A.termo, comV.filter(c => c.origem === 'cliente').length, () => { S.arte = id; pintar(); }));
  if (!v.previa) return;
  const montar = async (cmp) => {
    VW?.destruir();
    const U = await linksArte(sb, [v.previa, cmp ? ant.previa : null].filter(Boolean));
    VW = viewer($('#pa-vw'), { a: { url: U[v.previa], rotulo: `Versão ${v.numero}` }, b: cmp ? { url: U[ant.previa], rotulo: `Versão ${ant.numero}` } : null, modo: 'cortina',
      pinos: comV.map(c => ({ id: c.id, n: c.n, x: c.x == null ? null : +c.x, y: c.y == null ? null : +c.y, texto: c.texto, classe: c.resolvido ? 'ok' : c.origem === 'cliente' ? '' : 'eq' })),
      podeMarcar: podeComentar,
      onMarcar: (x, y) => { marca = { x, y }; const s = $('#pa-pin'); if (s) s.innerHTML = `📍 Ponto marcado — escreva o comentário <a href="#" id="pa-px">tirar</a>`; $('#pa-px') && ($('#pa-px').onclick = (e) => { e.preventDefault(); marca = null; s.textContent = 'Comentário geral — ou clique em 📍 Marcar na arte'; }); VW.marcar(false); $('#pa-ct')?.focus(); },
      onPino: (pi) => corpo.querySelector(`[data-c="${pi.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) });
  };
  try { await montar(false); } catch (err) { fail(err); }
  $('#pa-cmp') && ($('#pa-cmp').onchange = (e) => montar(e.target.checked).catch(fail));
}

function decidir(p, v, dec, termo, pinos, depois) {
  const ap = dec === 'aprovada';
  const m = modal({ title: ap ? `Aprovar a arte — versão ${v.numero}` : dec === 'alteracao' ? 'Pedir alteração' : 'Reprovar a arte', body: ap ? `
      <p class="small" style="margin-top:0">${esc(p.nome)} · arquivo <b>${esc(v.nome)}</b><br><span class="pi-hash">SHA-256 ${esc(v.hash)}</span></p>
      <div class="pt-termo">${esc(termo)}</div>
      <label class="chk" style="margin-top:10px;display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="dc-ac" style="width:auto;min-height:0;margin-top:3px"> <span>Li e concordo com a declaração acima.</span></label>
      <label style="margin-top:10px">Seu nome completo (vale como assinatura)<input id="dc-n" maxlength="120" autocomplete="name"></label>
      <label style="margin-top:8px">Observação (opcional)<input id="dc-c" maxlength="500"></label>
      <p class="small muted" style="margin-bottom:0">Ficam registrados com a aprovação: seu nome, seu usuário (${esc($('#pt-quem').textContent)}), data e hora, IP e navegador, e a impressão digital do arquivo aprovado.</p>`
    : `<p class="small" style="margin-top:0">${pinos ? `Você marcou ${pinos} ponto(s) na arte; eles vão junto com o pedido.` : 'Diga o que precisa mudar (ou feche e marque pontos na arte).'}</p>
      <label>${dec === 'alteracao' ? 'O que precisa mudar' : 'Motivo da reprovação'}<textarea id="dc-c" rows="4" maxlength="2000"></textarea></label>`,
    foot: `<button class="btn" data-close>Voltar</button><button class="btn ${ap ? 'primary' : dec === 'reprovada' ? 'danger' : 'primary'}" id="dc-ok">${ap ? 'Aprovar' : dec === 'alteracao' ? 'Enviar pedido de alteração' : 'Reprovar'}</button>` });
  $('#dc-ok', m.el).onclick = async (ev) => {
    const nome = $('#dc-n', m.el)?.value.trim() || null, com = $('#dc-c', m.el)?.value.trim() || null;
    if (ap && !$('#dc-ac', m.el).checked) return toast('Marque a declaração para aprovar', true);
    if (ap && (!nome || nome.split(/\s+/).length < 2)) return toast('Digite o seu nome completo', true);
    if (!ap && !com && !pinos) return toast('Diga o que precisa mudar', true);
    ev.target.disabled = true;
    try { await q(sb.rpc('portal_arte_decidir', { p_fav: S.fav.favorecido_id, p_versao: v.id, p_decisao: dec, p_comentario: com, p_nome: nome, p_aceite: ap ? true : false }));
      avisar(); m.close(); toast(ap ? 'Arte aprovada. Obrigado! A produção dos clichês vai começar.' : 'Pedido enviado à equipe de pré-impressão.'); depois(); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
}

function enviarArquivo(p, depois) {
  const m = modal({ title: 'Enviar um arquivo para a equipe', body: `<div class="pi-drop" id="ea-dz"><b>Arraste o arquivo aqui</b><div class="small muted">ou clique para escolher · PDF de preferência, até 50 MB</div><input type="file" id="ea-f" accept="${ACEITOS}" hidden></div>
    <div id="ea-pv" class="small" style="margin-top:8px"></div><label style="margin-top:10px">Observação<textarea id="ea-o" rows="2" maxlength="600" placeholder="ex.: arte final da nossa agência; nova tabela nutricional"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ea-ok" disabled>Enviar</button>` });
  let f = null, prep = null; const dz = $('#ea-dz', m.el), fi = $('#ea-f', m.el);
  const ler = async (x) => { f = x; $('#ea-pv', m.el).textContent = 'Lendo o arquivo…'; try { prep = await prepararArquivo(x); $('#ea-pv', m.el).innerHTML = `<b>${esc(x.name)}</b> · SHA-256 <span class="pi-hash">${PI.hashCurto(prep.hash)}</span>${prep.previa ? '' : ' · sem prévia (a equipe abre o original)'}`; $('#ea-ok', m.el).disabled = false; } catch (err) { fail(err); $('#ea-pv', m.el).textContent = ''; } };
  dz.onclick = () => fi.click(); fi.onchange = () => fi.files[0] && ler(fi.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('sobre'); }; dz.ondragleave = () => dz.classList.remove('sobre'); dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('sobre'); e.dataTransfer.files[0] && ler(e.dataTransfer.files[0]); };
  $('#ea-ok', m.el).onclick = async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Enviando…';
    try { const c = await subirArquivos(sb, p, f, prep);
      await q(sb.rpc('portal_arte_enviar', { p_fav: S.fav.favorecido_id, p_projeto: p.id, p_caminho: c.caminho, p_previa: c.previa, p_nome: f.name, p_tipo: f.type || null, p_tamanho: f.size, p_hash: prep.hash,
        p_obs: $('#ea-o', m.el).value.trim() || null, p_largura: prep.previa?.largura || null, p_altura: prep.previa?.altura || null,
        p_mm_largura: prep.previa?.mmLargura ? Math.round(prep.previa.mmLargura * 10) / 10 : null, p_mm_altura: prep.previa?.mmAltura ? Math.round(prep.previa.mmAltura * 10) / 10 : null, p_paginas: prep.previa?.paginas || null }));
      avisar(); m.close(); toast('Arquivo enviado. A equipe vai revisar e mandar a versão para a sua aprovação.'); depois(); }
    catch (err) { fail(err); ev.target.disabled = false; ev.target.textContent = 'Enviar'; }
  };
}

function comprovante(p, v, d) {
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas do navegador', true);
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Comprovante de aprovação — arte ${p.numero}</title><style>body{font:11pt Georgia,serif;max-width:720px;margin:24px auto;color:#111}
    h1{font-size:15pt;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:12px}td{border-bottom:1px solid #bbb;padding:6px 4px;vertical-align:top}td:first-child{width:34%;color:#444}.h{font-family:Consolas,monospace;font-size:9pt;word-break:break-all}</style></head>
    <body onload="setTimeout(()=>print(),300)"><h1>Comprovante de aprovação de arte</h1><div>${esc(S.fav.cliente)} — fornecedor ${esc(S.fav.empresa)}</div><table>
    <tr><td>Arte</td><td>nº ${p.numero} · ${esc(p.nome)}${p.codigo_cliente ? ' · ' + esc(p.codigo_cliente) : ''}</td></tr><tr><td>Versão aprovada</td><td>${v.numero} · ${esc(v.nome)}</td></tr>
    <tr><td>Impressão digital (SHA-256)</td><td class="h">${esc(d.hash)}</td></tr><tr><td>Aprovado por</td><td><b>${esc(d.nome || '')}</b></td></tr><tr><td>Data e hora</td><td>${new Date(d.criado_em).toLocaleString('pt-BR')}</td></tr></table>
    <p style="font-size:9pt;color:#444;margin-top:16px">A aprovação vale para o arquivo com a impressão digital acima. Qualquer mudança no arquivo gera outra impressão digital e precisa de nova aprovação.</p></body></html>`);
  w.document.close();
}

iniciar();

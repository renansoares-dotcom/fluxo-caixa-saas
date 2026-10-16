import { sb, state, q, loadCadastros, anosSelect, temArea } from './lib/data.js';
import { $, $$, esc, toast, fail, formData, loading, lerCores, modal } from './lib/ui.js';
import { SUPABASE_URL } from './config.js';
import { iniciarNotificacoes, pararNotificacoes } from './lib/notif.js';
import { iniciarBusca } from './lib/busca.js';

// cada abertura da plataforma busca as telas atualizadas (evita ficar com uma versão antiga em cache)
const V = Date.now();
const routes = {
  'dashboard': () => import(`./pages/dashboard.js?v=${V}`),
  'lancamentos': () => import(`./pages/lancamentos.js?v=${V}`),
  'conciliacao': () => import(`./pages/conciliacao.js?v=${V}`),
  'notas': () => import(`./pages/notas.js?v=${V}`),
  'fiscal/apuracao': () => import(`./pages/fiscal-apuracao.js?v=${V}`),
  'abertos': () => import(`./pages/abertos.js?v=${V}`),
  'creditos': () => import(`./pages/creditos.js?v=${V}`),
  'conta-fornecedor': () => import(`./pages/conta-fornecedor.js?v=${V}`),
  'paraquedas': () => import(`./pages/paraquedas.js?v=${V}`),
  'autorizacao': () => import(`./pages/autorizacao.js?v=${V}`),
  'fluxo-mensal': () => import(`./pages/fluxo-mensal.js?v=${V}`),
  'fluxo-diario': () => import(`./pages/fluxo-diario.js?v=${V}`),
  'necessidade-caixa': () => import(`./pages/necessidade-caixa.js?v=${V}`),
  'dre': () => import(`./pages/dre.js?v=${V}`),
  'contab/balancete': () => import(`./pages/contab-balancete.js?v=${V}`),
  'contab/depara': () => import(`./pages/contab-depara.js?v=${V}`),
  'contab/balanco': () => import(`./pages/contab-balanco.js?v=${V}`),
  'contab/dre': () => import(`./pages/contab-dre.js?v=${V}`),
  'contab/dfc': () => import(`./pages/contab-dfc.js?v=${V}`),
  'conferencia': () => import(`./pages/conferencia.js?v=${V}`),
  'fechamento': () => import(`./pages/fechamento.js?v=${V}`),
  'orcamento': () => import(`./pages/orcamento.js?v=${V}`),
  'orcado-realizado': () => import(`./pages/orcado-realizado.js?v=${V}`),
  'controle-orcamento': () => import(`./pages/controle-orcamento.js?v=${V}`),
  'fidc': () => import(`./pages/fidc.js?v=${V}`),
  'fidc-propostas': () => import(`./pages/fidc-propostas.js?v=${V}`),
  'duplicatas': () => import(`./pages/duplicatas.js?v=${V}`),
  'cadastros/plano': () => import(`./pages/cad-plano.js?v=${V}`),
  'cadastros/contas': () => import(`./pages/cad-contas.js?v=${V}`),
  'cadastros/favorecidos': () => import(`./pages/cad-favorecidos.js?v=${V}`),
  'cadastros/centros': () => import(`./pages/cad-centros.js?v=${V}`),
  'config': () => import(`./pages/config.js?v=${V}`),
  'auditoria': () => import(`./pages/auditoria.js?v=${V}`),
};

// ---------- Tema ----------
const savedTheme = (() => { try { return localStorage.getItem('fc-theme'); } catch { return null; } })();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('#theme-btn').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('fc-theme', next); } catch {}
  render();
};

function show(view) {
  for (const id of ['auth-view', 'empresa-view', 'app-view']) $('#' + id).classList.toggle('hidden', id !== view);
}

// ---------- Autenticação ----------
let modoCadastro = false;
$('#auth-toggle').onclick = () => {
  modoCadastro = !modoCadastro;
  $('#auth-submit').textContent = modoCadastro ? 'Criar conta' : 'Entrar';
  $('#auth-toggle').textContent = modoCadastro ? 'Já tenho conta' : 'Não tem conta? Cadastre-se';
};
$('#auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const { email, password } = formData(e.target);
  const msg = $('#auth-msg'); msg.textContent = '';
  try {
    if (modoCadastro) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } });
      if (error) throw error;
      if (!data.session) msg.textContent = 'Conta criada. Confira seu e-mail para confirmar o cadastro e depois entre.';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) { msg.innerHTML = `<span class="neg">${esc(err.message)}</span>`; }
};
$('#auth-reset').onclick = async () => {
  const email = $('#auth-form [name=email]').value;
  if (!email) return toast('Digite seu e-mail primeiro', true);
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
  error ? fail(error) : toast('Enviamos um link de redefinição para seu e-mail');
};
// ---------- Convite (link ?convite=…) ----------
const conviteToken = new URLSearchParams(location.search).get('convite');
async function prepararConvite() {
  if (!conviteToken) return;
  const box = $('#auth-convite');
  try {
    const { data, error } = await sb.rpc('ver_convite', { p_token: conviteToken });
    if (error) throw error;
    const c = data?.[0];
    box.classList.remove('hidden');
    if (!c) { box.innerHTML = '<span class="neg">Este convite não vale mais (já usado, cancelado ou vencido). Peça um novo ao administrador.</span>'; return; }
    box.innerHTML = `Convite para entrar em <strong>${esc(c.empresa)}</strong> como <strong>${esc(c.papel)}</strong>.<br>Crie sua senha abaixo. Se já tem conta, clique em “Já tenho conta” e entre normalmente.`;
    $('#auth-form [name=email]').value = c.email;
    if (!modoCadastro) $('#auth-toggle').click();
  } catch (err) { box.classList.remove('hidden'); box.innerHTML = `<span class="neg">${esc(err.message)}</span>`; }
}
prepararConvite();

// ---------- Nova senha (link "Esqueci minha senha" ou botão "Alterar senha") ----------
function trocarSenha(recuperacao = false) {
  const m = modal({
    title: recuperacao ? 'Crie sua nova senha' : 'Alterar senha',
    body: `<form id="ns-form" class="form">
      ${recuperacao ? '<p class="muted small" style="margin-top:0">Você entrou pelo link de recuperação. Defina a nova senha para usar nos próximos acessos.</p>' : ''}
      <label>Nova senha<input type="password" name="p1" required minlength="6" autocomplete="new-password"></label>
      <label>Repita a nova senha<input type="password" name="p2" required minlength="6" autocomplete="new-password"></label>
      <div id="ns-msg" class="msg"></div>
      <button class="btn primary" type="submit">Salvar nova senha</button></form>`,
    onMount: (el, close) => {
      $('#ns-form', el).onsubmit = async (ev) => {
        ev.preventDefault();
        const { p1, p2 } = formData(ev.target); const msg = $('#ns-msg', el);
        if (p1 !== p2) { msg.innerHTML = '<span class="neg">As duas senhas não são iguais.</span>'; return; }
        const { error } = await sb.auth.updateUser({ password: p1 });
        if (error) { msg.innerHTML = `<span class="neg">${esc(error.message)}</span>`; return; }
        close(); toast('Senha alterada. Use a nova senha no próximo acesso.');
      };
    },
  });
  setTimeout(() => $('#ns-form [name=p1]', m.el)?.focus(), 50);
}
$('#trocar-senha').onclick = () => trocarSenha(false);

const logout = async () => { pararNotificacoes(); await sb.auth.signOut(); location.hash = ''; };
$('#logout').onclick = logout; $('#logout-2').onclick = logout;

// ---------- Empresas ----------
async function escolherEmpresa() {
  show('empresa-view');
  const list = $('#empresa-list'); loading(list);
  try {
    let podeCriar = false;
    try { podeCriar = !!(await q(sb.rpc('pode_criar_empresa'))); } catch {}
    $('#empresa-form').classList.toggle('hidden', !podeCriar);
    const rows = await q(sb.from('membros').select('*, empresas(*)').eq('user_id', state.user.id));
    if (!rows.length) list.innerHTML = podeCriar
      ? '<p class="muted">Você ainda não participa de nenhuma empresa. Crie a primeira abaixo, ou peça a um administrador para adicionar seu e-mail.</p>'
      : '<p class="muted">Você ainda não participa de nenhuma empresa. Peça ao administrador um convite para o seu e-mail; depois saia e entre de novo que o acesso aparece aqui.</p>';
    else list.innerHTML = rows.map(r => `<div class="empresa-item" data-id="${r.empresas.id}">
      <div><strong>${esc(r.empresas.nome)}</strong><div class="muted small">${esc(r.empresas.cnpj || '')}</div></div>
      <span class="badge negoc">${esc(r.papel)}</span></div>`).join('');
    $$('.empresa-item', list).forEach(el => el.onclick = () => {
      const r = rows.find(x => x.empresas.id === el.dataset.id);
      entrarEmpresa(r.empresas, r.papel, r.areas);
    });
    if (rows.length === 1 && !sessionStorage.getItem('fc-escolher')) entrarEmpresa(rows[0].empresas, rows[0].papel, rows[0].areas);
  } catch (e) { fail(e); }
}
$('#empresa-form').onsubmit = async (e) => {
  e.preventDefault();
  const { nome, cnpj } = formData(e.target);
  try {
    const id = await q(sb.rpc('criar_empresa', { p_nome: nome, p_cnpj: cnpj }));
    const emp = await q(sb.from('empresas').select('*').eq('id', id).single());
    toast('Empresa criada com um plano de contas modelo');
    entrarEmpresa(emp, 'admin');
  } catch (err) { fail(err); }
};
$('#empresa-switch').onclick = () => { sessionStorage.setItem('fc-escolher', '1'); state.empresa = null; state.cad = null; escolherEmpresa(); };

// esconde do menu as áreas que o usuário não acessa (Dashboard faz parte do Financeiro)
function aplicarAreas() {
  $$('#nav .nav-area[data-area]').forEach(el => { if (['fin', 'cpd', 'cont'].includes(el.dataset.area)) el.hidden = !temArea(el.dataset.area); });
  const dash = $('#nav > a[data-route="dashboard"]'); if (dash) dash.hidden = !temArea('fin');
}
// primeira tela liberada no menu (para onde vai quem não tem o Financeiro)
function primeiraRota() {
  const a = $$('#nav a[data-route]').find(x => !x.hidden && !x.closest('.nav-area')?.hidden);
  return a?.dataset.route || 'cadastros/plano';
}
const areaDaRota = (route) => route === 'dashboard' ? 'fin' : $(`#nav a[data-route="${route}"]`)?.closest('.nav-area')?.dataset.area;

async function entrarEmpresa(emp, papel, areas) {
  sessionStorage.removeItem('fc-escolher');
  state.empresa = emp; state.papel = papel; state.cad = null;
  state.areas = Array.isArray(areas) && areas.length ? areas : null;
  aplicarAreas();
  iniciarNotificacoes();
  iniciarBusca();
  try { localStorage.setItem('fc-empresa', emp.id); } catch {}
  $('#empresa-switch').textContent = emp.nome + ' ▾';
  $('#user-email').textContent = state.user.email;
  anosSelect($('#ano-global'));
  show('app-view');
  try { await loadCadastros(); } catch (e) { fail(e); }
  // papel "compras": só a tela de paraquedas (o banco também não deixa ler o resto)
  document.body.classList.toggle('so-compras', papel === 'compras');
  $$('#nav .nav-audit').forEach(el => el.hidden = !['admin', 'diretor'].includes(papel));
  if (papel === 'compras') { if (location.hash !== '#/paraquedas') location.hash = '#/paraquedas'; else render(); return; }
  if (!location.hash || location.hash === '#/') location.hash = '#/' + (temArea('fin') ? 'dashboard' : primeiraRota()); else render();
}

$('#ano-global').onchange = (e) => { state.ano = +e.target.value; render(); };
// menu em cascata: um grupo aberto por vez
$$('#nav details').forEach(d => d.addEventListener('toggle', () => { if (d.open) $$('#nav details').forEach(o => { if (o !== d) o.open = false; }); }));
// menu lateral no celular: abre por cima do conteúdo, fecha no fundo escuro, no Esc ou ao navegar
const menu = (abrir) => { $('#sidebar').classList.toggle('open', abrir); $('#sidebar-backdrop').hidden = !abrir; document.body.classList.toggle('menu-aberto', abrir); };
$('#menu-btn').onclick = () => menu(!$('#sidebar').classList.contains('open'));
$('#sidebar-backdrop').onclick = () => menu(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#sidebar').classList.contains('open')) menu(false); });

// ---------- Roteamento ----------
let renderSeq = 0;
async function render() {
  if (!state.empresa) return;
  if (!state.cad) { try { await loadCadastros(); } catch (e) { fail(e); return; } }
  lerCores();
  const route = location.hash.replace(/^#\//, '').split('?')[0] || 'dashboard';
  if (state.papel === 'compras' && route !== 'paraquedas') { location.hash = '#/paraquedas'; return; }
  { const ar = routes[route] ? areaDaRota(route) : 'fin'; if (['fin', 'cpd', 'cont'].includes(ar) && !temArea(ar)) { location.hash = '#/' + primeiraRota(); return; } }
  const loader = routes[route] || routes.dashboard;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === route));
  // menu em cascata: abre o grupo da página atual
  const ativo = $(`#nav a[data-route="${route}"]`)?.closest('details'); if (ativo && !ativo.open) { $$('#nav details').forEach(d => { d.open = d === ativo; }); }
  $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').hidden = true; document.body.classList.remove('menu-aberto');
  const old = $('#page'); const page = old.cloneNode(false); old.replaceWith(page); loading(page);
  const seq = ++renderSeq;
  try {
    const mod = await loader();
    if (seq !== renderSeq) return;
    $('#page-title').textContent = mod.title;
    // trilha: Área › Seção (de onde a página fica no menu)
    { const a = $(`#nav a[data-route="${route}"]`); const area = a?.closest('.nav-area'); const sec = a?.closest('details')?.querySelector('summary')?.textContent;
      const tit = area?.querySelector('.nav-area-tit')?.textContent; const tr = $('#page-trilha');
      tr.textContent = [tit, sec].filter(Boolean).join(' › '); tr.dataset.area = area?.dataset.area || ''; }
    document.title = `${mod.title} · ${state.empresa.nome}`;
    // os cadastros podem ter sido descartados no meio do caminho (sessão renovada, troca de empresa): recarrega antes de desenhar
    if (!state.cad) await loadCadastros();
    if (seq !== renderSeq) return;
    page.innerHTML = '';
    await mod.render(page);
  } catch (e) { fail(e); page.innerHTML = `<div class="card empty">Não foi possível carregar esta tela.<br><span class="small">${esc(e.message || e)}</span></div>`; }
}
window.addEventListener('hashchange', render);
export const rerender = render;

// ---------- Inicialização ----------
if (SUPABASE_URL.includes('SEU-PROJETO')) {
  show('auth-view');
  $('#auth-msg').innerHTML = '<span class="neg">Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js.</span>';
}
let authIniciado = false;
sb.auth.onAuthStateChange((ev, session) => {
  // entrou pelo link de "Esqueci minha senha": pede a nova senha
  if (ev === 'PASSWORD_RECOVERY') setTimeout(() => trocarSenha(true), 300);
  const u = session?.user || null;
  if (authIniciado && u?.id === state.user?.id) return;
  authIniciado = true;
  state.user = u;
  if (!u) { state.empresa = null; state.cad = null; show('auth-view'); return; }
  setTimeout(boot, 0);
});
async function boot() {
  // convites pendentes para o e-mail da pessoa: entra na empresa com o papel definido pelo administrador
  try {
    const n = await q(sb.rpc('aceitar_convites'));
    if (n) { toast(n === 1 ? 'Convite aceito: acesso liberado' : `${n} convites aceitos`); try { localStorage.removeItem('fc-empresa'); } catch {} }
  } catch {}
  if (conviteToken) history.replaceState(null, '', location.pathname + location.hash);
  const last = (() => { try { return localStorage.getItem('fc-empresa'); } catch { return null; } })();
  if (last && !sessionStorage.getItem('fc-escolher')) {
    try {
      const r = await q(sb.from('membros').select('*, empresas(*)').eq('user_id', state.user.id).eq('empresa_id', last).maybeSingle());
      if (r) return entrarEmpresa(r.empresas, r.papel, r.areas);
    } catch {}
  }
  escolherEmpresa();
}

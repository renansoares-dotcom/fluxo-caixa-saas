import { sb, state, q, loadCadastros, anosSelect } from './lib/data.js';
import { $, $$, esc, toast, fail, formData, loading, lerCores } from './lib/ui.js';
import { SUPABASE_URL } from './config.js';

const routes = {
  'dashboard': () => import('./pages/dashboard.js'),
  'lancamentos': () => import('./pages/lancamentos.js'),
  'conciliacao': () => import('./pages/conciliacao.js'),
  'notas': () => import('./pages/notas.js'),
  'abertos': () => import('./pages/abertos.js'),
  'autorizacao': () => import('./pages/autorizacao.js'),
  'fluxo-mensal': () => import('./pages/fluxo-mensal.js'),
  'fluxo-diario': () => import('./pages/fluxo-diario.js'),
  'dre': () => import('./pages/dre.js'),
  'fechamento': () => import('./pages/fechamento.js'),
  'orcamento': () => import('./pages/orcamento.js'),
  'orcado-realizado': () => import('./pages/orcado-realizado.js'),
  'controle-orcamento': () => import('./pages/controle-orcamento.js'),
  'fidc': () => import('./pages/fidc.js'),
  'fidc-propostas': () => import('./pages/fidc-propostas.js'),
  'duplicatas': () => import('./pages/duplicatas.js'),
  'cadastros/plano': () => import('./pages/cad-plano.js'),
  'cadastros/contas': () => import('./pages/cad-contas.js'),
  'cadastros/favorecidos': () => import('./pages/cad-favorecidos.js'),
  'cadastros/centros': () => import('./pages/cad-centros.js'),
  'config': () => import('./pages/config.js'),
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
const logout = async () => { await sb.auth.signOut(); location.hash = ''; };
$('#logout').onclick = logout; $('#logout-2').onclick = logout;

// ---------- Empresas ----------
async function escolherEmpresa() {
  show('empresa-view');
  const list = $('#empresa-list'); loading(list);
  try {
    const rows = await q(sb.from('membros').select('papel, empresas(*)').eq('user_id', state.user.id));
    if (!rows.length) list.innerHTML = '<p class="muted">Você ainda não participa de nenhuma empresa. Crie a primeira abaixo, ou peça a um administrador para adicionar seu e-mail.</p>';
    else list.innerHTML = rows.map(r => `<div class="empresa-item" data-id="${r.empresas.id}">
      <div><strong>${esc(r.empresas.nome)}</strong><div class="muted small">${esc(r.empresas.cnpj || '')}</div></div>
      <span class="badge negoc">${esc(r.papel)}</span></div>`).join('');
    $$('.empresa-item', list).forEach(el => el.onclick = () => {
      const r = rows.find(x => x.empresas.id === el.dataset.id);
      entrarEmpresa(r.empresas, r.papel);
    });
    if (rows.length === 1 && !sessionStorage.getItem('fc-escolher')) entrarEmpresa(rows[0].empresas, rows[0].papel);
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

async function entrarEmpresa(emp, papel) {
  sessionStorage.removeItem('fc-escolher');
  state.empresa = emp; state.papel = papel; state.cad = null;
  try { localStorage.setItem('fc-empresa', emp.id); } catch {}
  $('#empresa-switch').textContent = emp.nome + ' ▾';
  $('#user-email').textContent = state.user.email;
  anosSelect($('#ano-global'));
  show('app-view');
  try { await loadCadastros(); } catch (e) { fail(e); }
  if (!location.hash || location.hash === '#/') location.hash = '#/dashboard'; else render();
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
  if (!state.empresa || !state.cad) return;
  lerCores();
  const route = location.hash.replace(/^#\//, '').split('?')[0] || 'dashboard';
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
    document.title = `${mod.title} · ${state.empresa.nome}`;
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
sb.auth.onAuthStateChange((_ev, session) => {
  const u = session?.user || null;
  if (authIniciado && u?.id === state.user?.id) return;
  authIniciado = true;
  state.user = u;
  if (!u) { state.empresa = null; state.cad = null; show('auth-view'); return; }
  setTimeout(boot, 0);
});
async function boot() {
  const last = (() => { try { return localStorage.getItem('fc-empresa'); } catch { return null; } })();
  if (last && !sessionStorage.getItem('fc-escolher')) {
    try {
      const r = await q(sb.from('membros').select('papel, empresas(*)').eq('user_id', state.user.id).eq('empresa_id', last).maybeSingle());
      if (r) return entrarEmpresa(r.empresas, r.papel);
    } catch {}
  }
  escolherEmpresa();
}

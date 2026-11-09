import { sb, state, q, loadCadastros, anosSelect, temArea, temRH, limparCacheCadastros } from './lib/data.js';
import { $, $$, esc, toast, fail, formData, loading, lerCores, modal } from './lib/ui.js';
import { SUPABASE_URL } from './config.js';
import { iniciarNotificacoes, pararNotificacoes } from './lib/notif.js';
import { iniciarBusca } from './lib/busca.js';
import { iniciarSelectBusca } from './lib/select-busca.js';
import { manualDaRota } from './lib/tutoriais.js';
import { verificarAoEntrar, gerenciar as gerenciarMFA } from './lib/mfa.js';
import { iniciarChat, pararChat, setAberta as chatFechado } from './lib/chat.js';
import { alternarMini, fecharMini } from './lib/mini-chat.js';
import { carregarIdentidade } from './lib/identidade.js';
import { esquecerRegimes } from './lib/regime.js';
import { abrirLancamento } from './lib/lanc-form.js';
import { montarMenu, marcarTela, modoPainel, cliqueArea, fecharPainel } from './lib/menu.js';
import { codigoDa } from './lib/telas.js';
import { iniciarUso, pararUso, telaUso, cargaUso } from './lib/uso.js';
import { exigirTermo } from './lib/lgpd-termo.js';
import { iniciarOffline, guardarEntrada, lerEntrada } from './lib/offline.js';

// cada abertura da plataforma busca as telas atualizadas (evita ficar com uma versão antiga em cache)
const V = Date.now();
const routes = {
  'hoje': () => import(`./pages/hoje.js?v=${V}`),
  'decisoes': () => import(`./pages/decisoes.js?v=${V}`),
  'decisao-dia': () => import(`./pages/decisao-dia.js?v=${V}`),
  'executivo': () => import(`./pages/executivo.js?v=${V}`),
  'compras': () => import(`./pages/compras-painel.js?v=${V}`),
  'compras/requisicoes': () => import(`./pages/compras-requisicoes.js?v=${V}`),
  'compras/pedidos': () => import(`./pages/compras-pedidos.js?v=${V}`),
  'compras/recebimentos': () => import(`./pages/compras-recebimentos.js?v=${V}`),
  'estoque': () => import(`./pages/estoque.js?v=${V}`),
  'estoque/produtos': () => import(`./pages/produtos.js?v=${V}`),
  'estoque/depara': () => import(`./pages/produtos-depara.js?v=${V}`),
  'estoque/kardex': () => import(`./pages/estoque-kardex.js?v=${V}`),
  'estoque/parametros': () => import(`./pages/estoque-parametros.js?v=${V}`),
  'comercial': () => import(`./pages/comercial.js?v=${V}`),
  'comercial/carteira': () => import(`./pages/comercial-carteira.js?v=${V}`),
  'comercial/funil': () => import(`./pages/comercial-funil.js?v=${V}`),
  'comercial/mapa': () => import(`./pages/comercial-mapa.js?v=${V}`),
  'comercial/comissoes': () => import(`./pages/comercial-comissoes.js?v=${V}`),
  'comercial/vendedores': () => import(`./pages/comercial-vendedores.js?v=${V}`),
  'aprovacoes': () => import(`./pages/aprovacoes.js?v=${V}`),
  'orcamento-cc': () => import(`./pages/orcamento-cc.js?v=${V}`),
  'config/email': () => import(`./pages/config-email.js?v=${V}`),
  'config/whatsapp': () => import(`./pages/config-whatsapp.js?v=${V}`),
  'fidc-recompras': () => import(`./pages/fidc-recompras.js?v=${V}`),
  'lanc-regras': () => import(`./pages/lanc-regras.js?v=${V}`),
  'lanc-recorrentes': () => import(`./pages/lanc-recorrentes.js?v=${V}`),
  'meus-avisos': () => import(`./pages/meus-avisos.js?v=${V}`),
  'preimpressao': () => import(`./pages/preimpressao.js?v=${V}`),
  'preimpressao/artes': () => import(`./pages/preimpressao-artes.js?v=${V}`),
  'portal-clientes': () => import(`./pages/portal-admin.js?v=${V}`),
  'producao': () => import(`./pages/producao.js?v=${V}`),
  'producao/ordens': () => import(`./pages/producao-ordens.js?v=${V}`),
  'producao/programacao': () => import(`./pages/producao-programacao.js?v=${V}`),
  'producao/sequenciamento': () => import(`./pages/producao-sequenciamento.js?v=${V}`),
  'producao/terminal': () => import(`./pages/producao-terminal.js?v=${V}`),
  'producao/cadastros': () => import(`./pages/producao-cadastros.js?v=${V}`),
  'producao/importar': () => import(`./pages/producao-importar.js?v=${V}`),
  'manutencao': () => import(`./pages/manutencao.js?v=${V}`),
  'manutencao/ordens': () => import(`./pages/manutencao-ordens.js?v=${V}`),
  'manutencao/equipamentos': () => import(`./pages/manutencao-equipamentos.js?v=${V}`),
  'manutencao/celular': () => import(`./pages/manutencao-celular.js?v=${V}`),
  'qualidade': () => import(`./pages/qualidade.js?v=${V}`),
  'qualidade/inspecoes': () => import(`./pages/qualidade-inspecoes.js?v=${V}`),
  'qualidade/nao-conformidades': () => import(`./pages/qualidade-rnc.js?v=${V}`),
  'qualidade/planos': () => import(`./pages/qualidade-planos.js?v=${V}`),
  'tintas': () => import(`./pages/tintas.js?v=${V}`),
  'tintas/ordens': () => import(`./pages/tintas-ordens.js?v=${V}`),
  'tintas/receitas': () => import(`./pages/tintas-receitas.js?v=${V}`),
  'producao/planta': () => import(`./pages/producao-planta.js?v=${V}`),
  'logistica': () => import(`./pages/logistica.js?v=${V}`),
  'logistica/motorista': () => import(`./pages/logistica-motorista.js?v=${V}`),
  'logistica/frota': () => import(`./pages/logistica-frota.js?v=${V}`),
  'logistica/fretes': () => import(`./pages/logistica-fretes.js?v=${V}`),
  'logistica/gestao-frota': () => import(`./pages/frota.js?v=${V}`),
  'logistica/indicadores': () => import(`./pages/logistica-indicadores.js?v=${V}`),
  'rh/colaboradores': () => import(`./pages/rh-colaboradores.js?v=${V}`),
  'rh/folha': () => import(`./pages/rh-folha.js?v=${V}`),
  'rh/decimo': () => import(`./pages/rh-decimo.js?v=${V}`),
  'dashboard': () => import(`./pages/dashboard.js?v=${V}`),
  'lancamentos': () => import(`./pages/lancamentos.js?v=${V}`),
  'conciliacao': () => import(`./pages/conciliacao.js?v=${V}`),
  'notas': () => import(`./pages/notas.js?v=${V}`),
  'fiscal/apuracao': () => import(`./pages/fiscal-apuracao.js?v=${V}`),
  'fiscal/notas-debito': () => import(`./pages/fiscal-notas-debito.js?v=${V}`),
  'abertos': () => import(`./pages/abertos.js?v=${V}`),
  'cobranca': () => import(`./pages/cobranca.js?v=${V}`),
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
  'contab/indices': () => import(`./pages/contab-indices.js?v=${V}`),
  'estoque/implantacao': () => import(`./pages/estoque-implantacao.js?v=${V}`),
  'producao/oee': () => import(`./pages/producao-oee.js?v=${V}`),
  'producao/custos': () => import(`./pages/producao-custos.js?v=${V}`),
  'producao/rastreio': () => import(`./pages/producao-rastreio.js?v=${V}`),
  'manutencao/preventivas': () => import(`./pages/manutencao-preventivas.js?v=${V}`),
  'tintas/previsao': () => import(`./pages/tintas-previsao.js?v=${V}`),
  'estoque/reposicao': () => import(`./pages/estoque-reposicao.js?v=${V}`),
  'estoque/inventario': () => import(`./pages/estoque-inventario.js?v=${V}`),
  'contab/dre': () => import(`./pages/contab-dre.js?v=${V}`),
  'contab/dfc': () => import(`./pages/contab-dfc.js?v=${V}`),
  'estoque/cadastro-notas': () => import(`./pages/cadastro-notas.js?v=${V}`),
  'contab/imobilizado': () => import(`./pages/imobilizado.js?v=${V}`),
  'contab/imobilizado-parametros': () => import(`./pages/imobilizado-parametros.js?v=${V}`),
  'contab/inventario': () => import(`./pages/inventario-patrimonial.js?v=${V}`),
  'conferencia': () => import(`./pages/conferencia.js?v=${V}`),
  'fechamento': () => import(`./pages/fechamento.js?v=${V}`),
  'tutoriais': () => import(`./pages/tutoriais.js?v=${V}`),
  'conversas': () => import(`./pages/conversas.js?v=${V}`),
  'orcamento': () => import(`./pages/orcamento.js?v=${V}`),
  'orcado-realizado': () => import(`./pages/orcado-realizado.js?v=${V}`),
  'controle-orcamento': () => import(`./pages/controle-orcamento.js?v=${V}`),
  'fidc': () => import(`./pages/fidc.js?v=${V}`),
  'fidc-propostas': () => import(`./pages/fidc-propostas.js?v=${V}`),
  'fidc-carteira': () => import(`./pages/fidc-carteira.js?v=${V}`),
  'duplicatas': () => import(`./pages/duplicatas.js?v=${V}`),
  'cadastros/plano': () => import(`./pages/cad-plano.js?v=${V}`),
  'cadastros/contas': () => import(`./pages/cad-contas.js?v=${V}`),
  'cadastros/favorecidos': () => import(`./pages/cad-favorecidos.js?v=${V}`),
  'cadastros/centros': () => import(`./pages/cad-centros.js?v=${V}`),
  'cadastros/empresa': () => import(`./pages/cad-empresa.js?v=${V}`),
  'contratos': () => import(`./pages/contratos.js?v=${V}`),
  'config': () => import(`./pages/config.js?v=${V}`),
  'auditoria': () => import(`./pages/auditoria.js?v=${V}`),
  'uso': () => import(`./pages/uso.js?v=${V}`),
  'lgpd': () => import(`./pages/lgpd.js?v=${V}`),
  'integracoes': () => import(`./pages/integracoes.js?v=${V}`),
  'diretoria': () => import(`./pages/diretoria.js?v=${V}`),
  'perguntar': () => import(`./pages/perguntar.js?v=${V}`),
  'relatorios': () => import(`./pages/relatorios.js?v=${V}`),
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

const logout = async () => { limparCacheCadastros(); pararUso(); pararNotificacoes(); fecharMini(); pararChat(); await sb.auth.signOut(); location.hash = ''; };
$('#logout').onclick = logout; $('#logout-2').onclick = logout;
$('#mfa-btn') && ($('#mfa-btn').onclick = () => gerenciarMFA());
// balão do topo: no computador abre o mini-chat por cima da tela; no celular vai para a tela Conversas
$('#chat-btn') && ($('#chat-btn').onclick = (e) => { if (matchMedia('(max-width: 900px)').matches || location.hash.startsWith('#/conversas')) return; e.preventDefault(); alternarMini(); });

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
  const { nome, cnpj, regime, vigencia_inicio, cnae, anexo, uf } = formData(e.target);
  try {
    // com o regime: criar_empresa_completa (SQL 078) grava o regime e ajusta as contas de tributos do plano modelo
    const trib = regime ? { regime, vigencia_inicio: vigencia_inicio || null, uf: uf || null, cnae_principal: cnae || null, fonte: 'Informado na criação da empresa',
      simples_atividades: regime === 'simples' && (anexo || cnae) ? [{ cnae: cnae || null, descricao: null, anexo: anexo || null, fator_r: anexo === 'V' }] : [] } : null;
    const id = trib ? await q(sb.rpc('criar_empresa_completa', { p_nome: nome, p_cnpj: cnpj || null, p_ano: vigencia_inicio ? +vigencia_inicio.slice(0, 4) : null, p_trib: trib }))
      : await q(sb.rpc('criar_empresa', { p_nome: nome, p_cnpj: cnpj }));
    const emp = await q(sb.from('empresas').select('*').eq('id', id).single());
    toast('Empresa criada com um plano de contas modelo');
    entrarEmpresa(emp, 'admin');
  } catch (err) { fail(err); }
};
$('#empresa-form [name=regime]').onchange = (e) => { $('#empresa-form .nt-simples').hidden = e.target.value !== 'simples'; };
$('#empresa-switch').onclick = () => { sessionStorage.setItem('fc-escolher', '1'); fecharMini(); pararChat(); state.empresa = null; state.cad = null; escolherEmpresa(); };

// esconde do menu as áreas que o usuário não acessa (Dashboard faz parte do Financeiro)
function aplicarAreas() {
  $$('#nav .nav-area[data-area]').forEach(el => { if (['fin', 'com', 'cmp', 'prd', 'log', 'cpd', 'cont'].includes(el.dataset.area)) el.hidden = !temArea(el.dataset.area); });
  for (const r of ['decisao-dia', 'decisoes', 'executivo']) { const a = $(`#nav a[data-route="${r}"]`); if (a) a.hidden = !temArea('fin'); }
  const pain = $('#nav .nav-area[data-area="pain"]'); if (pain) pain.hidden = !temArea('fin');
  // RH: só administrador ou quem tem a área "rh" marcada (sem marcação não dá acesso — salário é sigiloso)
  const rh = $('#nav .nav-area[data-area="rh"]'); if (rh) rh.hidden = !temRH();
}
// primeira tela liberada no menu (para onde vai quem não tem o Financeiro)
function primeiraRota() {
  const a = $$('#nav a[data-route]').find(x => !x.hidden && !x.closest('.nav-area')?.hidden && x.dataset.route !== 'conversas');
  return a?.dataset.route || 'cadastros/plano';
}
const areaDaRota = (route) => ['decisao-dia', 'decisoes', 'executivo'].includes(route) ? 'fin' : $(`#nav a[data-route="${route}"]`)?.closest('.nav-area')?.dataset.area;

// número de aprovações pendentes ao lado de "Minhas aprovações" no menu (a cada 5 minutos)
let apTimer = null;
async function contarAprovacoesMenu() {
  clearInterval(apTimer);
  const conta = async () => { if (!state.empresa) return; const { contarAprovacoes } = await import(`./pages/aprovacoes.js?v=${V}`); const n = await contarAprovacoes();
    document.querySelectorAll('.ap-n').forEach(el => { el.hidden = !n; el.textContent = n > 99 ? '99+' : n; }); };
  conta().catch(() => {}); apTimer = setInterval(() => conta().catch(() => {}), 300000);
}

async function entrarEmpresa(emp, papel, areas) {
  sessionStorage.removeItem('fc-escolher');
  state.empresa = emp; state.papel = papel; state.cad = null; esquecerRegimes();
  state.areas = Array.isArray(areas) && areas.length ? areas : null;
  aplicarAreas();
  iniciarNotificacoes();
  iniciarUso().catch(() => {});
  exigirTermo(sb, 'lgpd_entrar', { p_empresa: emp.id }, { sair: logout }).catch(() => {});   // grava o último acesso e pede o termo (SQL 100)
  contarAprovacoesMenu();
  iniciarChat();
  iniciarBusca();
  iniciarSelectBusca();
  try { localStorage.setItem('fc-empresa', emp.id); } catch {}
  guardarEntrada(state.user.id, emp, papel, areas);
  $('#empresa-switch').textContent = emp.nome + ' ▾';
  $('#user-email').textContent = state.user.email;
  anosSelect($('#ano-global'));
  show('app-view');
  try { await loadCadastros(); } catch (e) { fail(e); }
  carregarIdentidade(emp.id).catch(() => {});
  // papel "compras": só a tela de paraquedas (o banco também não deixa ler o resto)
  document.body.classList.toggle('so-compras', papel === 'compras');
  document.body.classList.toggle('so-vendas', papel === 'vendas');
  document.body.classList.toggle('so-producao', papel === 'producao');
  document.body.classList.toggle('so-motorista', papel === 'motorista');
  $$('#nav .nav-audit').forEach(el => el.hidden = !['admin', 'diretor'].includes(papel));
  $$('#nav .nav-admin').forEach(el => el.hidden = papel !== 'admin');
  if (papel === 'compras') { if (!rotaDeCompras(location.hash.replace(/^#\//, ''))) location.hash = '#/compras'; else render(); return; }
  if (papel === 'vendas') { if (!rotaDeVendas(location.hash.replace(/^#\//, ''))) location.hash = '#/comercial'; else render(); return; }
  if (papel === 'producao') { if (!rotaDeProducao(location.hash.replace(/^#\//, ''))) location.hash = '#/producao/terminal'; else render(); return; }
  if (papel === 'motorista') { if (!rotaDeMotorista(location.hash.replace(/^#\//, ''))) location.hash = '#/logistica/motorista'; else render(); return; }
  if (!location.hash || location.hash === '#/') location.hash = '#/' + (temArea('fin') ? 'hoje' : primeiraRota()); else render();
}

$('#ano-global').onchange = (e) => { state.ano = +e.target.value; render(); };
// menu: ícones, códigos de tela, busca, favoritos, recentes e modo recolhido (js/lib/menu.js)
montarMenu();
// menu em cascata: um grupo aberto por vez
$$('#nav details').forEach(d => d.addEventListener('toggle', () => { if (d.open && !modoPainel() && !$('#nav').classList.contains('nav-filtrando')) $$('#nav details').forEach(o => { if (o !== d) o.open = false; }); }));
// menu em acordeão também nas áreas: uma área aberta por vez (a da tela atual abre sozinha; a última aberta fica guardada)
function abrirArea(area, guardar = true) {
  $$('#nav .nav-area').forEach(a => a.classList.toggle('aberta', a === area));
  if (guardar && area) { try { localStorage.setItem('nav-area', area.dataset.area); } catch {} }
}
$$('#nav .nav-area-tit').forEach(t => { t.setAttribute('role', 'button'); t.tabIndex = 0;
  const alterna = (e) => { const a = t.closest('.nav-area'); if (cliqueArea(a, e?.type === 'keydown')) return; a.classList.contains('aberta') ? a.classList.remove('aberta') : abrirArea(a); };
  t.addEventListener('click', alterna); t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowRight' && modoPainel())) { e.preventDefault(); alterna(e); } }); });
if (!modoPainel()) { let g = null; try { g = localStorage.getItem('nav-area'); } catch {} const a = g && $(`#nav .nav-area[data-area="${g}"]`); if (a) abrirArea(a, false); }
// menu lateral no celular: abre por cima do conteúdo, fecha no fundo escuro, no Esc ou ao navegar
const menu = (abrir) => { $('#sidebar').classList.toggle('open', abrir); $('#sidebar-backdrop').hidden = !abrir; document.body.classList.toggle('menu-aberto', abrir); };
$('#menu-btn').onclick = () => menu(!$('#sidebar').classList.contains('open'));
$('#sidebar-backdrop').onclick = () => menu(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#sidebar').classList.contains('open')) menu(false); });

// ---------- Roteamento ----------
// perfil compras: Pagamentos Antecipados e o módulo Compras
// perfil vendas (representante): só a área Comercial
// perfil producao (operador no terminal do setor)
const rotaDeMotorista = (r) => ['logistica/motorista', 'tutoriais', 'meus-avisos'].includes(r);   // motorista: só o app (melhoria 7.1)
const rotaDeProducao = (r) => ['hoje', 'orcamento-cc', 'perguntar', 'producao/terminal', 'producao/ordens', 'producao/rastreio', 'manutencao/celular', 'manutencao/ordens', 'qualidade/inspecoes', 'qualidade/nao-conformidades', 'tintas/ordens', 'tintas/receitas', 'tintas/previsao', 'preimpressao', 'preimpressao/artes', 'estoque/kardex', 'estoque/inventario', 'tutoriais', 'conversas', 'meus-avisos'].includes(r);
const rotaDeVendas = (r) => r === 'comercial' || ['hoje', 'orcamento-cc', 'perguntar', 'comercial/carteira', 'comercial/funil', 'comercial/mapa', 'comercial/comissoes', 'preimpressao', 'preimpressao/artes', 'tutoriais', 'conversas', 'meus-avisos'].includes(r);
const rotaDeCompras = (r) => ['hoje', 'orcamento-cc', 'perguntar', 'paraquedas', 'compras', 'estoque', 'estoque/implantacao', 'estoque/reposicao', 'estoque/inventario', 'estoque/produtos', 'estoque/kardex', 'estoque/parametros', 'qualidade/inspecoes', 'tutoriais', 'conversas', 'meus-avisos'].includes(r) || r.startsWith('compras/');
let renderSeq = 0;
async function render() {
  if (!state.empresa) return;
  if (!state.cad) { try { await loadCadastros(); } catch (e) { fail(e); return; } }
  lerCores();
  chatFechado(null);            // a tela Conversas diz qual conversa está aberta
  let route = location.hash.replace(/^#\//, '').split('?')[0] || 'hoje';
  state.rota = route;   // o modo sem internet guarda as leituras só das telas de chão de fábrica
  // Decisão do Dia virou uma aba da Central de Decisões (melhoria 2.3): os links antigos continuam funcionando
  if (route === 'decisao-dia') { const qs = location.hash.split('?')[1]; history.replaceState(null, '', '#/decisoes?aba=pagamentos' + (qs ? '&' + qs : '')); route = 'decisoes'; }
  // link direto para um registro (cartão das Conversas): #/<tela>?abrir=<id> abre o registro na tela
  { const ab = new URLSearchParams(location.hash.split('?')[1] || '').get('abrir');
    const TIPO = { 'compras/pedidos': 'pedido', 'producao/ordens': 'op', 'fidc-propostas': 'proposta', 'paraquedas': 'pa', 'logistica/fretes': 'frete', 'lancamentos': 'lancamento', 'contab/imobilizado': 'bem', 'manutencao/ordens': 'os', 'manutencao/equipamentos': 'equip', 'qualidade/inspecoes': 'insp', 'qualidade/nao-conformidades': 'rnc', 'tintas/ordens': 'tinta', 'preimpressao/artes': 'arte', 'compras/requisicoes': 'requisicao' };
    if (ab && TIPO[route]) { state.abrir = { tipo: TIPO[route], id: ab }; history.replaceState(null, '', '#/' + route); } }
  if (state.papel === 'compras' && !rotaDeCompras(route)) { location.hash = '#/compras'; return; }
  if (state.papel === 'vendas' && !rotaDeVendas(route)) { location.hash = '#/comercial'; return; }
  if (state.papel === 'producao' && !rotaDeProducao(route)) { location.hash = '#/producao/terminal'; return; }
  if (state.papel === 'motorista' && !rotaDeMotorista(route)) { location.hash = '#/logistica/motorista'; return; }
  { const ar = routes[route] ? areaDaRota(route) : 'fin'; if ((['fin', 'com', 'cmp', 'prd', 'log', 'cpd', 'cont'].includes(ar) && !temArea(ar)) || (ar === 'rh' && !temRH())) { location.hash = '#/' + primeiraRota(); return; } }
  const loader = routes[route] || routes.dashboard;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === route));
  // menu em cascata: abre o grupo da página atual
  if (modoPainel()) fecharPainel();
  else {
    const ativo = $(`#nav a[data-route="${route}"]`)?.closest('details'); if (ativo && !ativo.open) { $$('#nav details').forEach(d => { d.open = d === ativo; }); }
    const ar = $(`#nav a[data-route="${route}"]`)?.closest('.nav-area'); if (ar && !ar.classList.contains('aberta')) abrirArea(ar);
  }
  $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').hidden = true; document.body.classList.remove('menu-aberto');
  const old = $('#page'); const page = old.cloneNode(false); old.replaceWith(page); loading(page);
  const seq = ++renderSeq, t0 = performance.now();   // tempo de abertura da tela (melhoria 1.9)
  try {
    const mod = await loader();
    if (seq !== renderSeq) return;
    // nome oficial da tela = nome do menu (js/lib/menu.js preenche data-nome); fora do menu, o título do módulo
    const nomeTela = $(`#nav a[data-route="${CSS.escape(route)}"]`)?.dataset.nome || mod.title;
    $('#page-title').textContent = nomeTela;
    // código da tela (js/lib/telas.js), como no Iniflex
    { const cod = codigoDa(route), pc = $('#page-cod'); if (pc) { pc.textContent = cod; pc.hidden = !cod; } marcarTela(route); telaUso(route); }
    // botão "?": manual de uso desta tela (Ajuda › Tutoriais)
    { const man = manualDaRota(route), b = $('#ajuda-btn'); if (b) { b.hidden = !man || (man.rh && !temRH()); if (man) b.href = `#/tutoriais?m=${man.id}`; } }
    // trilha: Área › Seção (de onde a página fica no menu)
    { const a = $(`#nav a[data-route="${route}"]`); const area = a?.closest('.nav-area'); const sec = a?.closest('details')?.querySelector('summary')?.textContent;
      const tit = area?.querySelector('.nav-area-tit')?.dataset.nome; const tr = $('#page-trilha');
      tr.textContent = [tit, sec].filter(Boolean).join(' › '); tr.dataset.area = area?.dataset.area || ''; }
    document.title = `${codigoDa(route) ? codigoDa(route) + ' · ' : ''}${nomeTela} · ${state.empresa.nome}`;
    // os cadastros podem ter sido descartados no meio do caminho (sessão renovada, troca de empresa): recarrega antes de desenhar
    if (!state.cad) await loadCadastros();
    if (seq !== renderSeq) return;
    page.innerHTML = '';
    await mod.render(page);
    if (seq === renderSeq) cargaUso(route, performance.now() - t0);
    if (state.abrir?.tipo === 'lancamento') { const id = state.abrir.id; delete state.abrir; abrirLancamentoPorId(id); }
  } catch (e) { fail(e); page.innerHTML = `<div class="card empty">Não foi possível carregar esta tela.<br><span class="small">${esc(e.message || e)}</span></div>`; }
}
async function abrirLancamentoPorId(id) {
  try {
    const l = await q(sb.from('lancamentos').select('*').eq('id', id).maybeSingle());
    if (!l) return toast('Lançamento não encontrado (pode ter sido excluído)', true);
    abrirLancamento(l, () => render());
  } catch (e) { fail(e); }
}
// tabela que rola para o lado: marca a borda onde há mais colunas (.rola-esq / .rola-dir; o CSS esmaece a borda no celular)
function marcarRolagem(w) {
  const max = w.scrollWidth - w.clientWidth;
  w.classList.toggle('rola-esq', max > 2 && w.scrollLeft > 2);
  w.classList.toggle('rola-dir', max > 2 && w.scrollLeft < max - 2);
}
{ let t = null; const todas = () => { clearTimeout(t); t = setTimeout(() => $$('.table-wrap').forEach(marcarRolagem), 120); };
  new MutationObserver(todas).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', todas);
  document.addEventListener('scroll', (e) => { if (e.target?.classList?.contains('table-wrap')) marcarRolagem(e.target); }, true); }
window.addEventListener('hashchange', render);
iniciarOffline(V);   // modo sem internet: service worker, selo no topo e envio da fila quando o sinal voltar
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
  // verificação em duas etapas: código do autenticador (se a conta tem) e ativação obrigatória (se a empresa exige para o perfil)
  try { if (!await verificarAoEntrar(logout)) return; } catch (e) { console.warn('MFA', e); }
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
  // sem internet: entra com a última empresa e o último perfil guardados neste aparelho (modo sem internet, melhoria 1.5)
  if (navigator.onLine === false) { const g = lerEntrada(state.user.id); if (g?.emp) return entrarEmpresa(g.emp, g.papel, g.areas); }
  escolherEmpresa();
}

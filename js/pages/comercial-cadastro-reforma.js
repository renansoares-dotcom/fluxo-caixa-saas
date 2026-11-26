// Comercial › Atualização Cadastral da Reforma (COM010) — SQL 198, 26/11/2026.
// Renan: "enviar aos clientes um questionário de atualização cadastral para a reforma tributária: eu escolho o cliente, a
// plataforma gera um link, o cliente preenche e dá ok, e as informações chegam pra gente". O link abre cadastro.html, sem
// login; a resposta chega com aviso e fica pendente até alguém com o papel de aplicar conferir as diferenças e aplicar
// (Renan: "eu revejo e aplico"). O perfil fiscal aplicado passa a alimentar a Análise de Competitividade (COM009).
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, dateBR, today, exportXLSX } from '../lib/ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { CAMPOS, comparar, atualDoCadastro, texto } from '../lib/cadastro-reforma.js';

export const title = 'Atualização Cadastral da Reforma';
const SIT = { enviado: 'Enviado', aberto: 'Aberto pelo cliente', respondido: 'Respondido — conferir', aplicado: 'Aplicado', descartado: 'Descartado', cancelado: 'Cancelado' };
const SITB = { enviado: '', aberto: 'negoc', respondido: 'vencido', aplicado: 'pago', descartado: '', cancelado: '' };
const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['vendas', 'Vendas'], ['leitura', 'Leitura'], ['compras', 'Compras'], ['producao', 'Produção']];
const ui = { aba: 'enviar', busca: '', filtro: 'sem', sel: new Set(), hb: '', hs: '' };
let D = null;
const link = (t) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}cadastro.html?t=${t}`;
const vencido = (x) => ['enviado', 'aberto'].includes(x.situacao) && x.expira_em < today();
const sitTxt = (x) => (vencido(x) ? 'Vencido sem resposta' : SIT[x.situacao]);
const textoConvite = (x) => `Olá! ${state.empresa?.nome || 'Nós'} está atualizando o cadastro dos clientes para a reforma tributária. Pedimos que ${x.cliente} preencha o questionário (uns 5 minutos) até ${dateBR(x.expira_em)}: ${link(x.token)}`;
const wa = (tel, txt) => (tel ? `https://wa.me/55${String(tel).replace(/\D/g, '').replace(/^55/, '')}?text=${encodeURIComponent(txt)}` : `https://wa.me/?text=${encodeURIComponent(txt)}`);
const mail = (email, x) => `mailto:${encodeURIComponent(email || '')}?subject=${encodeURIComponent(`Atualização cadastral — reforma tributária — ${state.empresa?.nome || ''}`)}&body=${encodeURIComponent(textoConvite(x))}`;

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id, ac = await q(sb.rpc('cadq_acesso', { p_empresa: e }));
    if (!ac?.usa) { root.innerHTML = '<div class="card"><div class="empty">Seu perfil não usa a atualização cadastral. O administrador libera em Atualização Cadastral › Parâmetros.</div></div>'; return; }
    const [clientes, lista, cfg] = await Promise.all([
      q(sb.rpc('comercial_clientes', { p_empresa: e })).catch(() => []),
      fetchAll(() => sb.from('cadq_questionarios').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
      q(sb.from('cadq_config').select('*').eq('empresa_id', e).maybeSingle())]);
    D = { ac, cfg: cfg || {}, clientes: (clientes || []).filter(c => c.ativo !== false), lista, root };
    pintar();
    const abrir = new URLSearchParams(location.hash.split('?')[1] || '').get('abrir');
    const x = abrir && D.lista.find(y => y.id === abrir);
    if (x) { ui.aba = 'lista'; pintar(); conferirResposta(x); }
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 198 já foi executado.</div></div>'; }
}
const recarregar = () => render(D.root);

function pintar() {
  const L = D.lista, n = (f) => L.filter(f).length;
  D.root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Atualização Cadastral da Reforma</h2><div class="muted small">Escolha os clientes, gere o link e mande por WhatsApp ou e-mail. O cliente responde sem login; você confere as diferenças e aplica ao cadastro.</div></div></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Enviados</div><div class="k-value">${n(x => x.situacao !== 'cancelado')}</div><div class="k-sub">${n(x => x.situacao === 'aberto' && !vencido(x))} aberto(s) pelo cliente</div></div>
      <div class="kpi"><div class="k-label">Para conferir</div><div class="k-value">${n(x => x.situacao === 'respondido')}</div><div class="k-sub">respondidos, ainda não aplicados</div></div>
      <div class="kpi"><div class="k-label">Aplicados</div><div class="k-value">${n(x => x.situacao === 'aplicado')}</div><div class="k-sub">cadastro atualizado</div></div>
      <div class="kpi"><div class="k-label">Vencidos sem resposta</div><div class="k-value">${n(vencido)}</div><div class="k-sub">prorrogue ou gere outro link</div></div>
    </div>
    <div class="chips" id="cq-abas" style="margin:4px 0 10px">${[['enviar', 'Enviar'], ['lista', `Questionários (${L.length})`], ['parametros', 'Parâmetros']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div><div id="cq-corpo"></div>`;
  $('#cq-abas', D.root).onclick = (ev) => { const a = ev.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(); } };
  ({ enviar: abaEnviar, lista: abaLista, parametros: abaParametros })[ui.aba]($('#cq-corpo', D.root));
}

// ============================================================ enviar
function ultimo(fav) { return D.lista.find(x => x.favorecido_id === fav && x.situacao !== 'cancelado'); }
function abaEnviar(el) {
  const filtrar = () => {
    const b = ui.busca.trim().toLowerCase();
    return D.clientes.filter(c => (!b || `${c.nome} ${c.nome_fantasia || ''} ${c.documento || ''}`.toLowerCase().includes(b))
      && (ui.filtro === 'todos' || (ui.filtro === 'sem' ? !ultimo(c.id) : ui.filtro === 'pendente' ? ['enviado', 'aberto'].includes(ultimo(c.id)?.situacao) : ultimo(c.id)?.situacao === 'aplicado')));
  };
  el.innerHTML = `<div class="card"><div class="toolbar">
      <label>Procurar<input id="e-b" value="${esc(ui.busca)}" placeholder="nome, fantasia ou CNPJ"></label>
      <label>Mostrar<select id="e-f">${[['sem', 'Sem questionário'], ['pendente', 'Enviado, sem resposta'], ['aplicado', 'Já atualizados'], ['todos', 'Todos']].map(([v, t]) => `<option value="${v}" ${v === ui.filtro ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div style="flex:1"></div><span class="muted small" id="e-n"></span><button class="btn primary" id="e-ger">Gerar links</button></div>
      <div class="grid-form" style="margin:6px 0"><label class="full">Mensagem para o cliente (opcional, sai no alto do questionário)<textarea id="e-msg" rows="2" maxlength="600" placeholder="${esc(D.cfg.mensagem || 'Ex.: Qualquer dúvida, fale com o seu representante.')}"></textarea></label></div>
      <div class="tbl-wrap" id="e-t"></div></div>`;
  const pin = () => {
    const L = filtrar();
    $('#e-t', el).innerHTML = `<table><thead><tr><th><input type="checkbox" id="e-all"></th><th>Cliente</th><th>CNPJ/CPF</th><th>Representante</th><th>E-mail</th><th>Telefone</th><th>Último questionário</th></tr></thead><tbody>
      ${L.map(c => { const u = ultimo(c.id); return `<tr><td><input type="checkbox" data-c="${c.id}" ${ui.sel.has(c.id) ? 'checked' : ''}></td><td>${esc(c.nome)}${c.nome_fantasia ? `<div class="muted small">${esc(c.nome_fantasia)}</div>` : ''}</td>
        <td>${esc(c.documento || '')}</td><td>${esc(c.representante || '')}</td><td class="small">${esc(c.email || '')}</td><td class="small">${esc(c.telefone || '')}</td>
        <td>${u ? `<span class="badge ${vencido(u) ? 'vencido' : SITB[u.situacao]}">${sitTxt(u)}</span> <span class="muted small">nº ${u.numero} · ${dateBR(String(u.criado_em).slice(0, 10))}</span>` : '<span class="muted small">nunca enviado</span>'}</td></tr>`; }).join('')
        || '<tr><td colspan="7" class="empty">Nenhum cliente neste filtro.</td></tr>'}</tbody></table>`;
    $('#e-n', el).textContent = ui.sel.size ? `${ui.sel.size} cliente(s) escolhido(s)` : '';
    $('#e-all', el).onchange = (ev) => { L.forEach(c => (ev.target.checked ? ui.sel.add(c.id) : ui.sel.delete(c.id))); pin(); };
  };
  el.addEventListener('input', (ev) => { if (ev.target.id === 'e-b') { ui.busca = ev.target.value; pin(); } });
  el.addEventListener('change', (ev) => {
    if (ev.target.id === 'e-f') { ui.filtro = ev.target.value; pin(); }
    if (ev.target.dataset.c) { ev.target.checked ? ui.sel.add(ev.target.dataset.c) : ui.sel.delete(ev.target.dataset.c); $('#e-n', el).textContent = ui.sel.size ? `${ui.sel.size} cliente(s) escolhido(s)` : ''; }
  });
  $('#e-ger', el).onclick = async () => {
    if (!ui.sel.size) return toast('Marque pelo menos um cliente', true);
    try {
      const r = await q(sb.rpc('cadq_gerar', { p_empresa: state.empresa.id, p_favorecidos: [...ui.sel], p_mensagem: $('#e-msg', el).value || null }));
      ui.sel.clear(); mostrarLinks(r); recarregar();
    } catch (err) { fail(err); }
  };
  pin();
}
function mostrarLinks(R) {
  const novos = R.filter(x => x.novo).length;
  const m = modal({ title: `Links gerados (${R.length})`, wide: true, body: `<p class="small">${novos} novo(s)${R.length - novos ? `; ${R.length - novos} cliente(s) já tinham link válido, que foi mantido` : ''}. Mande pelo WhatsApp, pelo e-mail ou copie o link.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Nº</th><th>Cliente</th><th>Válido até</th><th></th></tr></thead><tbody>
    ${R.map(x => `<tr><td>${x.numero}</td><td>${esc(x.cliente)}</td><td>${dateBR(x.expira_em)}</td><td style="white-space:nowrap">${botoesEnvio(x)}</td></tr>`).join('')}</tbody></table></div>`,
    foot: '<button class="btn" id="l-todos">Copiar todos</button><button class="btn primary" data-close>Fechar</button>' });
  ligarEnvio(m.el, R);
  $('#l-todos', m.el).onclick = () => copiar(R.map(x => `${x.cliente}: ${link(x.token)}`).join('\n'), 'Links copiados');
}
const botoesEnvio = (x) => `<button class="btn sm" data-cp="${x.token}">Copiar link</button> <a class="btn sm ghost" target="_blank" rel="noopener" data-wa="${x.id}">WhatsApp</a> <a class="btn sm ghost" data-ml="${x.id}">E-mail</a>`;
function ligarEnvio(el, R) {
  $$('[data-cp]', el).forEach(b => b.onclick = () => copiar(link(b.dataset.cp), 'Link copiado'));
  $$('[data-wa]', el).forEach(a => { const x = R.find(y => y.id === a.dataset.wa); a.href = wa(x.telefone ?? D.clientes.find(c => c.id === x.favorecido_id)?.telefone, textoConvite(x)); });
  $$('[data-ml]', el).forEach(a => { const x = R.find(y => y.id === a.dataset.ml); a.href = mail(x.email ?? D.clientes.find(c => c.id === x.favorecido_id)?.email, x); });
}
async function copiar(t, msg) { try { await navigator.clipboard.writeText(t); toast(msg); } catch { prompt('Copie:', t); } }

// ============================================================ lista
function abaLista(el) {
  el.innerHTML = `<div class="card"><div class="toolbar">
      <label>Procurar<input id="l-b" value="${esc(ui.hb)}" placeholder="cliente ou nº"></label>
      <label>Situação<select id="l-s"><option value="">Todas</option>${Object.entries(SIT).map(([v, t]) => `<option value="${v}" ${v === ui.hs ? 'selected' : ''}>${t}</option>`).join('')}<option value="vencido" ${ui.hs === 'vencido' ? 'selected' : ''}>Vencido sem resposta</option></select></label>
      <div style="flex:1"></div><button class="btn" id="l-xls">Excel</button><button class="btn" id="l-pdf">Relatório (PDF)</button></div><div class="tbl-wrap" id="l-t"></div></div>`;
  const filt = () => { const b = ui.hb.trim().toLowerCase(); return D.lista.filter(x => (!b || `${x.numero} ${x.cliente}`.toLowerCase().includes(b)) && (!ui.hs || (ui.hs === 'vencido' ? vencido(x) : x.situacao === ui.hs && !vencido(x)))); };
  const pin = () => {
    const L = filt();
    $('#l-t', el).innerHTML = `<table><thead><tr><th>Nº</th><th>Cliente</th><th>Enviado</th><th>Válido até</th><th>Situação</th><th>Respondido por</th><th></th></tr></thead><tbody>
      ${L.map(x => `<tr><td>${x.numero}</td><td>${esc(x.cliente)}</td><td>${dateBR(String(x.criado_em).slice(0, 10))}</td><td>${dateBR(x.expira_em)}</td>
        <td><span class="badge ${vencido(x) ? 'vencido' : SITB[x.situacao]}">${sitTxt(x)}</span>${x.obs ? `<div class="muted small">${esc(x.obs)}</div>` : ''}</td>
        <td class="small">${esc(x.respondido_por || '')}${x.respondido_em ? `<div class="muted">${new Date(x.respondido_em).toLocaleString('pt-BR').slice(0, 17)}</div>` : ''}</td>
        <td style="white-space:nowrap">${['respondido', 'aplicado', 'descartado'].includes(x.situacao) ? `<button class="btn sm ${x.situacao === 'respondido' ? 'primary' : ''}" data-cf="${x.id}">${x.situacao === 'respondido' ? 'Conferir e aplicar' : 'Ver'}</button>` : ''}
          ${['enviado', 'aberto'].includes(x.situacao) ? `${botoesEnvio(x)} <button class="btn sm ghost" data-pr="${x.id}">Prorrogar</button> <button class="btn sm ghost" data-cx="${x.id}">Cancelar</button>` : ''}</td></tr>`).join('')
        || `<tr><td colspan="7" class="empty">Nenhum questionário${D.lista.length ? ' neste filtro' : ': gere os primeiros na aba Enviar'}.</td></tr>`}</tbody></table>`;
    ligarEnvio($('#l-t', el), L);
  };
  el.addEventListener('input', () => { ui.hb = $('#l-b', el).value; ui.hs = $('#l-s', el).value; pin(); });
  el.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.id === 'l-xls') return exportXLSX($('#l-t table', el), 'atualizacao_cadastral_reforma');
    if (t.id === 'l-pdf') return pdfLista(filt());
    const x = D.lista.find(y => y.id === (t.dataset.cf || t.dataset.pr || t.dataset.cx));
    if (!x) return;
    if (t.dataset.cf) return conferirResposta(x);
    try {
      if (t.dataset.pr) { await q(sb.rpc('cadq_situacao', { p_id: x.id, p_acao: 'prorrogar' })); toast(`Link nº ${x.numero} prorrogado`); }
      if (t.dataset.cx) { await q(sb.rpc('cadq_situacao', { p_id: x.id, p_acao: 'cancelar' })); toast(`Link nº ${x.numero} cancelado`); }
      recarregar();
    } catch (err) { fail(err); }
  });
  pin();
}

async function conferirResposta(x) {
  let f = {}, pf = null;
  try {
    [f, pf] = await Promise.all([q(sb.from('favorecidos').select('*').eq('id', x.favorecido_id).maybeSingle()).catch(() => ({})),
      q(sb.from('cad_perfil_fiscal').select('*').eq('empresa_id', state.empresa.id).eq('favorecido_id', x.favorecido_id).maybeSingle()).catch(() => null)]);
  } catch (err) { fail(err); }
  const r = x.resposta || {}, atual = atualDoCadastro(f || {}, pf), L = comparar(r, atual), pode = D.ac.aplica && x.situacao === 'respondido';
  const blocos = [...new Set(L.map(c => c.bloco))];
  const m = modal({ title: `Questionário nº ${x.numero} — ${x.cliente}`, wide: true, body: `
    <p class="small">Respondido por <b>${esc(x.respondido_por || '')}</b> em ${x.respondido_em ? new Date(x.respondido_em).toLocaleString('pt-BR').slice(0, 17) : '—'}.
      ${x.situacao === 'aplicado' ? `Aplicado por ${esc(x.aplicado_por || '')} em ${new Date(x.aplicado_em).toLocaleString('pt-BR').slice(0, 17)}.` : ''}
      ${x.situacao === 'descartado' ? `Descartado: ${esc(x.obs || '')}.` : ''}</p>
    ${pode ? '<p class="small muted">Vêm marcados os campos que mudam. Desmarque o que não quiser levar para o cadastro.</p>' : ''}
    <div class="tbl-wrap"><table><thead><tr>${pode ? '<th></th>' : ''}<th>Campo</th><th>Cadastro atual</th><th>Resposta do cliente</th></tr></thead><tbody>
    ${blocos.map(b => `<tr><th colspan="${pode ? 4 : 3}" style="background:var(--bg2,#f6f6f6)">${esc(b)}</th></tr>${L.filter(c => c.bloco === b).map(c => `<tr class="${c.muda ? '' : 'muted'}">
      ${pode ? `<td><input type="checkbox" data-k="${c.chave}" ${c.muda ? 'checked' : ''}></td>` : ''}<td>${esc(c.rotulo)}${c.muda ? '' : ' <span class="small">(igual)</span>'}</td>
      <td class="small">${esc(c.atual || '—')}</td><td class="small"><b>${esc(c.novo)}</b></td></tr>`).join('')}`).join('')}</tbody></table></div>`,
    foot: `<button class="btn" id="r-pdf">PDF da resposta</button>${pode ? '<button class="btn ghost" id="r-desc">Descartar</button><button class="btn primary" id="r-ap">Aplicar ao cadastro</button>' : '<button class="btn primary" data-close>Fechar</button>'}` });
  $('#r-pdf', m.el).onclick = () => pdfResposta(x, L);
  if (!pode) return;
  $('#r-ap', m.el).onclick = async () => {
    const campos = $$('[data-k]:checked', m.el).map(i => i.dataset.k);
    if (!campos.length) return toast('Marque pelo menos um campo, ou use Descartar', true);
    try { await q(sb.rpc('cadq_aplicar', { p_id: x.id, p_campos: campos })); m.close(); toast(`${campos.length} campo(s) aplicados ao cadastro de ${x.cliente}`); recarregar(); } catch (err) { fail(err); }
  };
  $('#r-desc', m.el).onclick = async () => {
    const mot = prompt('Motivo do descarte (ex.: respondido pela empresa errada):'); if (!mot) return;
    try { await q(sb.rpc('cadq_situacao', { p_id: x.id, p_acao: 'descartar', p_obs: mot })); m.close(); toast('Resposta descartada'); recarregar(); } catch (err) { fail(err); }
  };
}

function pdfResposta(x, L) {
  const blocos = [...new Set(L.map(c => c.bloco))];
  let n = 0;
  const corpo = `<h2>${++n}. Identificação</h2><table><tbody><tr><td>Questionário</td><td>nº ${x.numero}, enviado em ${dateBR(String(x.criado_em).slice(0, 10))}</td></tr>
      <tr><td>Cliente</td><td>${esc(x.cliente)}</td></tr><tr><td>Respondido por</td><td>${esc(x.respondido_por || '—')}${x.respondido_em ? ` em ${new Date(x.respondido_em).toLocaleString('pt-BR').slice(0, 17)}` : ''}</td></tr>
      <tr><td>Situação</td><td>${esc(sitTxt(x))}${x.aplicado_por ? ` por ${esc(x.aplicado_por)}` : ''}</td></tr></tbody></table>
    ${blocos.map(b => `<h2>${++n}. ${esc(b)}</h2><table><thead><tr><th>Campo</th><th>Cadastro antes</th><th>Resposta</th><th>Aplicado</th></tr></thead><tbody>
      ${L.filter(c => c.bloco === b).map(c => `<tr><td>${esc(c.rotulo)}</td><td>${esc(c.atual || '—')}</td><td>${esc(c.novo)}</td><td>${(x.aplicado_campos || []).includes(c.chave) ? 'sim' : c.muda ? 'não' : 'igual'}</td></tr>`).join('')}</tbody></table>`).join('')}
    <p>O cliente declarou que as informações são verdadeiras e autorizou o uso delas no cadastro e na emissão das notas fiscais.</p>`;
  abrirRelatorio({ rel: 'Atualização cadastral (reforma)', nome: 'Atualização Cadastral da Reforma', titulo: `ATUALIZAÇÃO CADASTRAL — ${x.cliente.toUpperCase()}`, corpo,
    parametros: [['Questionário', `nº ${x.numero}`], ['Cliente', x.cliente]], rodape: 'Base: Atualização Cadastral da Reforma (COM010). Resposta do cliente pelo link, sem login.' });
}
function pdfLista(L) {
  const c = (s) => L.filter(x => (s === 'vencido' ? vencido(x) : x.situacao === s && !vencido(x))).length;
  const corpo = `<h2>1. Resumo</h2><p>${L.length} questionário(s): ${c('enviado') + c('aberto')} aguardando resposta, ${c('respondido')} para conferir, ${c('aplicado')} aplicado(s), ${c('vencido')} vencido(s) sem resposta, ${c('cancelado')} cancelado(s).</p>
    <h2>2. Questionários</h2><table><thead><tr><th class="n">Nº</th><th>Cliente</th><th>Enviado</th><th>Válido até</th><th>Situação</th><th>Respondido por</th></tr></thead><tbody>
    ${L.map(x => `<tr><td class="n">${x.numero}</td><td>${esc(x.cliente)}</td><td>${dateBR(String(x.criado_em).slice(0, 10))}</td><td>${dateBR(x.expira_em)}</td><td>${esc(sitTxt(x))}</td><td>${esc(x.respondido_por || '')}</td></tr>`).join('') || '<tr><td colspan="6">Nenhum.</td></tr>'}</tbody></table>`;
  abrirRelatorio({ rel: 'Atualização cadastral (reforma)', nome: 'Atualização Cadastral da Reforma', titulo: 'ATUALIZAÇÃO CADASTRAL DOS CLIENTES — REFORMA TRIBUTÁRIA', corpo,
    parametros: [['Situação', ui.hs ? (SIT[ui.hs] || 'Vencido sem resposta') : 'Todas'], ['Procura', ui.hb || '—']], rodape: 'Base: Atualização Cadastral da Reforma (COM010).' });
}

// ============================================================ parâmetros
function abaParametros(el) {
  const adm = D.ac.admin, cfg = { validade_dias: 30, mensagem: '', papeis_usa: ['admin', 'diretor', 'financeiro', 'vendas'], papeis_aplicar: ['admin', 'diretor', 'financeiro'], ...D.cfg };
  const dis = adm ? '' : 'disabled';
  const chks = (k, sel) => PAPEIS.map(([v, t]) => `<label class="chk"><input type="checkbox" data-${k}="${v}" ${sel.includes(v) ? 'checked' : ''} ${dis}> ${t}</label>`).join('');
  el.innerHTML = `<div class="card">${adm ? '' : '<p class="small muted">Consulta. Só o administrador altera os parâmetros.</p>'}
    <div class="grid-form"><label>Validade do link (dias)<input id="p-val" type="number" min="1" max="365" value="${cfg.validade_dias}" ${dis}></label>
      <label class="span2">Mensagem padrão (sai no alto do questionário)<textarea id="p-msg" rows="3" maxlength="600" ${dis}>${esc(cfg.mensagem || '')}</textarea></label></div>
    <div class="small" style="font-weight:600;margin-top:10px">Quem usa a tela (gera e acompanha os links)</div><div class="areas-chk cq-chk">${chks('u', cfg.papeis_usa)}</div>
    <div class="small" style="font-weight:600;margin-top:8px">Quem confere e aplica as respostas ao cadastro (e recebe o aviso)</div><div class="areas-chk cq-chk">${chks('a', cfg.papeis_aplicar)}</div>
    <p class="muted small">O vendedor vê e envia só para os clientes da carteira dele.</p>
    ${adm ? '<button class="btn primary" id="p-ok">Salvar</button>' : ''}</div>`;
  if (!adm) return;
  $('#p-ok', el).onclick = async () => {
    const marc = (k) => $$(`[data-${k}]:checked`, el).map(x => x.dataset[k]);
    try { await q(sb.rpc('cadq_config_salvar', { p_empresa: state.empresa.id, p: { validade_dias: +$('#p-val', el).value, mensagem: $('#p-msg', el).value, papeis_usa: marc('u'), papeis_aplicar: marc('a') } })); toast('Parâmetros salvos'); recarregar(); } catch (err) { fail(err); }
  };
}

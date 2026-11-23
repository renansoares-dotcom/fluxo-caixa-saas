// Painéis › Gestão de Processos (PAI016) — SQL 196, 23/11/2026 (Renan: "Na plataforma temos uma ferramenta de gestão de
// processo?" › "Inicialmente 1 e 2": mapa dos processos e POPs). O fluxograma é gerado das etapas; o POP é aprovado pelo dono
// do processo (a Diretoria aprova no lugar dele quando ele mesmo escreveu, e também nos processos críticos); a plataforma
// sugere os processos que ela executa e quem mantém o mapa revisa.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, dateBR, today, exportXLSX, confirmDialog } from '../lib/ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { codigoDa } from '../lib/telas.js';
import { svgFluxo, conferir, raias, TIPOS_ETAPA } from '../lib/fluxograma.js';
import { situacaoPop, pendenciasPop, mesesTxt, textoPop } from '../lib/processos.js';

export const title = 'Gestão de Processos';
const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['compras', 'Compras'], ['producao', 'Produção'], ['vendas', 'Vendas'], ['leitura', 'Leitura']];
const PAP = Object.fromEntries(PAPEIS);
const CFG0 = { papeis_gestor: ['admin', 'diretor'], papeis_ve: ['admin', 'financeiro', 'diretor', 'compras', 'producao', 'vendas', 'leitura'], papeis_elabora: ['admin', 'financeiro', 'diretor', 'compras', 'producao', 'vendas'],
  papeis_diretoria: ['diretor'], criticos_diretoria: true, autoaprovacao: false, revisao_meses: 12, aviso_revisao_dias: 30, leitura_dias: 7, cobrar_leitura: true };
const SITV = { rascunho: ['Rascunho', ''], em_aprovacao: ['Em aprovação', 'negoc'], vigente: ['Em vigor', 'pago'], obsoleta: ['Obsoleta', ''] };
const badge = (m, k) => `<span class="badge ${m[k]?.[1] || ''}">${m[k]?.[0] || k}</span>`;
let D = null;
const ui = { aba: 'mapa', busca: '', macro: '', sit: 'ativos' };

// nome das telas: o próprio menu
const limpaNome = (t) => String(t || '').replace(/\s*[A-Z]{3}\d{3}\s*$/, '').trim();
const nomeTela = (r) => limpaNome(document.querySelector(`a[data-route="${CSS.escape(r)}"]`)?.textContent) || r;
const telaTxt = (r) => (r ? `${codigoDa(r) || ''} ${nomeTela(r)}`.trim() : '');
function telasMenu() {
  const vistos = new Set(), L = [];
  for (const a of document.querySelectorAll('a[data-route]')) { const r = a.dataset.route; if (!vistos.has(r) && codigoDa(r)) { vistos.add(r); L.push([r, `${codigoDa(r)} — ${limpaNome(a.textContent)}`]); } }
  return L.sort((a, b) => a[1].localeCompare(b[1]));
}

export async function render(root) {
  const par = new URLSearchParams(location.hash.split('?')[1] || '');
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id, ac = await q(sb.rpc('proc_acesso', { p_empresa: e }));
    if (!ac?.ve) { root.innerHTML = '<div class="card"><div class="empty">Seu perfil não consulta a gestão de processos. O administrador libera em Gestão de Processos › Parâmetros.</div></div>'; return; }
    const carregar = () => Promise.all([q(sb.from('proc_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.from('proc_macros').select('*').eq('empresa_id', e).order('ordem')),
      q(sb.from('proc_processos').select('*').eq('empresa_id', e).order('ordem')),
      fetchAll(() => sb.from('proc_etapas').select('*').eq('empresa_id', e).order('n')),
      q(sb.from('proc_pops').select('*').eq('empresa_id', e).order('codigo')),
      fetchAll(() => sb.from('proc_versoes').select('*').eq('empresa_id', e).order('versao')),
      q(sb.from('proc_leituras').select('versao_id,lido_em').eq('empresa_id', e).eq('user_id', state.user.id)),
      q(sb.rpc('proc_pessoas', { p_empresa: e }))]);
    let r = await carregar();
    // primeira vez: quem mantém o mapa já recebe os processos que a plataforma executa, para revisar
    if (ac.gestor && !r[1].length) {
      try { const k = await q(sb.rpc('proc_configurar', { p_empresa: e })); if (k) { toast(`${k} processos sugeridos pela plataforma, com as etapas: revise, defina os donos e ajuste`); r = await carregar(); } }
      catch (err) { fail(err); }
    }
    const [cfg, macros, procs, etapas, pops, versoes, lidas, pessoas] = r;
    D = { ac, cfg: { ...CFG0, ...(cfg || {}) }, macros, procs, etapas, pops, versoes, lidas: new Set(lidas.map(l => l.versao_id)), pessoas, root,
      pes: Object.fromEntries(pessoas.map(p => [p.user_id, p])), mac: Object.fromEntries(macros.map(m => [m.id, m])), pr: Object.fromEntries(procs.map(p => [p.id, p])) };
    D.etapasDe = (id) => D.etapas.filter(x => x.processo_id === id).sort((a, b) => a.n - b.n);
    D.popsDe = (id) => D.pops.filter(x => x.processo_id === id);
    D.versoesDe = (id) => D.versoes.filter(x => x.pop_id === id).sort((a, b) => a.versao - b.versao);
    D.pend = pendenciasPop({ eu: state.user.id, papel: state.papel, diretoria: ac.diretoria, pops, versoes, procs, lidas: D.lidas, hoje: today(), avisoDias: D.cfg.aviso_revisao_dias, autoaprovacao: D.cfg.autoaprovacao });
    pintar(root);
    if (par.get('pop')) { history.replaceState(null, '', '#/processos'); const p = pops.find(x => x.id === par.get('pop')); p ? verPop(p) : toast('POP não encontrado ou sem acesso.', true); }
    else if (par.get('proc')) { history.replaceState(null, '', '#/processos'); const p = D.pr[par.get('proc')]; p ? ficha(p) : toast('Processo não encontrado.', true); }
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 196 já foi executado.</div></div>'; }
}
const recarregar = () => render(D.root);
const nomeP = (id) => (id ? D.pes[id]?.nome || '—' : '');

function pintar(root) {
  const P = D.pend, nPend = P.aprovar.length + P.ler.length + P.revisar.length + P.rascunhos.length;
  const ativos = D.procs.filter(p => p.ativo), vig = D.pops.filter(p => p.ativo && p.versao_vigente);
  const abas = [['mapa', `Mapa (${ativos.length})`], ['pops', `POPs (${D.pops.filter(p => p.ativo).length})`], ['mim', `Para mim${nPend ? ` · ${nPend}` : ''}`], ...(D.ac.admin ? [['parametros', 'Parâmetros']] : [])];
  if (!abas.some(a => a[0] === ui.aba)) ui.aba = 'mapa';
  const sug = ativos.filter(p => p.sugerido).length, venc = vig.filter(p => p.revisar_em && p.revisar_em < today()).length;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Gestão de Processos</h2><div class="muted small">Os processos da empresa: quem é o dono, as etapas em fluxograma, onde cada etapa acontece na plataforma e os POPs que padronizam o trabalho.</div></div></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Processos</div><div class="k-value">${ativos.length}</div><div class="k-sub">${ativos.filter(p => !p.dono_id).length} sem dono</div></div>
      <div class="kpi"><div class="k-label">POPs em vigor</div><div class="k-value">${vig.length}</div><div class="k-sub">${ativos.filter(p => !D.popsDe(p.id).some(x => x.ativo && x.versao_vigente)).length} processo(s) sem POP</div></div>
      <div class="kpi"><div class="k-label">Revisões vencidas</div><div class="k-value ${venc ? 'warn' : ''}">${venc}</div><div class="k-sub">revisão a cada ${mesesTxt(D.cfg.revisao_meses)}</div></div>
      <div class="kpi"><div class="k-label">Para mim</div><div class="k-value ${nPend ? 'warn' : ''}">${nPend}</div><div class="k-sub">${P.aprovar.length} aprovar · ${P.ler.length} ler · ${P.revisar.length} revisar</div></div>
    </div>
    ${sug ? `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">${sug} processo(s) <b>sugerido(s) pela plataforma</b> ainda não revisado(s). Abra cada um, confira as etapas, defina o dono e salve: a marca de sugerido sai.</div>` : ''}
    <div class="chips" id="pc-abas" style="margin:4px 0 10px">${abas.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div><div id="pc-corpo"></div>`;
  $('#pc-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(root); } };
  ({ mapa: abaMapa, pops: abaPops, mim: abaMim, parametros: abaParametros })[ui.aba]($('#pc-corpo', root));
}

// ------------------------------------------------------------ mapa
function abaMapa(c) {
  const t = ui.busca.trim().toLowerCase();
  const L = D.procs.filter(p => (ui.sit === 'todos' || (ui.sit === 'ativos' ? p.ativo : ui.sit === 'semdono' ? p.ativo && !p.dono_id : ui.sit === 'sugeridos' ? p.ativo && p.sugerido : !p.ativo))
    && (!ui.macro || p.macro_id === ui.macro)
    && (!t || [p.codigo, p.nome, p.objetivo, nomeP(p.dono_id), ...D.etapasDe(p.id).map(e => `${e.o_que} ${e.responsavel}`)].join(' ').toLowerCase().includes(t)));
  const grupos = D.macros.filter(m => L.some(p => p.macro_id === m.id));
  c.innerHTML = `<div class="card" style="margin-bottom:12px"><div style="display:grid;grid-template-columns:minmax(0,2fr) repeat(2,minmax(0,1fr));gap:10px">
      <label>Procurar<input id="mp-b" value="${esc(ui.busca)}" placeholder="código, nome, dono, etapa ou responsável"></label>
      <label>Macroprocesso<select id="mp-m"><option value="">Todos</option>${D.macros.map(m => `<option value="${m.id}" ${ui.macro === m.id ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.nome)}</option>`).join('')}</select></label>
      <label>Situação<select id="mp-s">${[['ativos', 'Ativos'], ['semdono', 'Sem dono'], ['sugeridos', 'Sugeridos (a revisar)'], ['inativos', 'Desativados'], ['todos', 'Todos']].map(([k, v]) => `<option value="${k}" ${ui.sit === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${D.ac.gestor ? '<button class="btn primary" id="mp-novo">Novo processo</button><button class="btn" id="mp-mac">Macroprocessos</button>' : ''}
      <button class="btn ghost" id="mp-xls">Excel</button><button class="btn ghost" id="mp-rel">Mapa (PDF)</button><span class="spacer"></span><span class="small muted">${L.length} processo(s)</span></div></div>
    <div class="card flush"><div class="table-wrap"><table id="mp-tab"><thead><tr><th>Código</th><th>Processo</th><th>Dono</th><th class="num">Etapas</th><th>POPs</th><th></th></tr></thead><tbody>
    ${grupos.map(m => `<tr><td colspan="6" style="background:var(--bg2,#f3f3f3)"><b>${esc(m.codigo)} — ${esc(m.nome)}</b></td></tr>
      ${L.filter(p => p.macro_id === m.id).map(p => { const ps = D.popsDe(p.id).filter(x => x.ativo);
        return `<tr data-p="${p.id}" style="cursor:pointer"><td><b>${esc(p.codigo)}</b></td><td class="wrap">${esc(p.nome)}${p.objetivo ? `<div class="small muted">${esc(p.objetivo)}</div>` : ''}</td>
        <td>${p.dono_id ? esc(nomeP(p.dono_id)) : '<span class="badge vencido">sem dono</span>'}</td><td class="num">${D.etapasDe(p.id).length}</td>
        <td class="small">${ps.length ? ps.map(x => `${esc(x.codigo)} ${x.versao_vigente ? `v${x.versao_vigente}` : '<span class="muted">em elaboração</span>'}`).join('<br>') : '<span class="muted">—</span>'}</td>
        <td>${p.sugerido ? '<span class="badge aberto">sugerido</span> ' : ''}${p.critico ? '<span class="badge negoc">crítico</span> ' : ''}${p.ativo ? '' : '<span class="badge">desativado</span>'}</td></tr>`; }).join('')}`).join('')
      || `<tr><td colspan="6" class="empty">Nenhum processo. ${D.ac.gestor ? 'Use Novo processo.' : ''}</td></tr>`}</tbody></table></div></div>`;
  const deb = (f) => { clearTimeout(ui.t); ui.t = setTimeout(f, 300); };
  $('#mp-b', c).oninput = (ev) => deb(() => { ui.busca = ev.target.value; abaMapa(c); const i = $('#mp-b', c); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#mp-m', c).onchange = (ev) => { ui.macro = ev.target.value; abaMapa(c); }; $('#mp-s', c).onchange = (ev) => { ui.sit = ev.target.value; abaMapa(c); };
  $$('[data-p]', c).forEach(tr => tr.onclick = () => ficha(D.pr[tr.dataset.p]));
  $('#mp-novo', c) && ($('#mp-novo', c).onclick = () => editar(null));
  $('#mp-mac', c) && ($('#mp-mac', c).onclick = macros);
  $('#mp-xls', c).onclick = () => exportXLSX($('#mp-tab', c), 'mapa_de_processos');
  $('#mp-rel', c).onclick = () => abrirRelatorio({ rel: 'Mapa de processos', nome: 'Mapa de Processos', titulo: 'MAPA DE PROCESSOS', paisagem: true,
    corpo: grupos.map((m, i) => `<h2>${i + 1}. ${esc(m.codigo)} — ${esc(m.nome)}</h2><table><thead><tr><th>Código</th><th>Processo</th><th>Objetivo</th><th>Dono</th><th>Entradas</th><th>Saídas</th><th>POPs em vigor</th></tr></thead><tbody>
      ${L.filter(p => p.macro_id === m.id).map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nome)}${p.critico ? ' (crítico)' : ''}</td><td>${esc(p.objetivo || '')}</td><td>${esc(nomeP(p.dono_id) || 'sem dono')}</td><td>${esc(p.entradas || '')}</td><td>${esc(p.saidas || '')}</td>
        <td>${D.popsDe(p.id).filter(x => x.ativo && x.versao_vigente).map(x => `${esc(x.codigo)} v${x.versao_vigente}`).join(', ') || '—'}</td></tr>`).join('')}</tbody></table>`).join(''),
    rodape: `${L.length} processo(s). Base: Gestão de Processos (PAI016).` });
}

function macros() {
  const m = modal({ title: 'Macroprocessos', body: `<p class="small muted" style="margin-top:0">O código (2 a 5 letras) entra no código dos processos (ex.: SUP-01) e dos POPs (POP-SUP-001) e não muda depois de criado.</p>
    <div class="table-wrap"><table class="small"><thead><tr><th>Código</th><th>Nome</th><th class="num">Ordem</th><th>Ativo</th></tr></thead><tbody>
    ${D.macros.map(x => `<tr data-m="${x.id}"><td><b>${esc(x.codigo)}</b></td><td><input data-f="nome" value="${esc(x.nome)}" maxlength="60"></td><td><input data-f="ordem" type="number" value="${x.ordem}" style="width:70px"></td>
      <td><input type="checkbox" data-f="ativo" ${x.ativo ? 'checked' : ''} style="width:auto"></td></tr>`).join('')}
    <tr data-m=""><td><input data-f="codigo" maxlength="5" placeholder="Novo" style="width:70px;text-transform:uppercase"></td><td><input data-f="nome" maxlength="60" placeholder="Nome do novo macroprocesso"></td><td></td><td></td></tr></tbody></table></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mc-ok">Salvar</button>' });
  $('#mc-ok', m.el).onclick = async () => {
    try {
      for (const tr of $$('[data-m]', m.el)) {
        const g = (f) => $(`[data-f=${f}]`, tr), id = tr.dataset.m, x = D.macros.find(y => y.id === id);
        if (!id) { if (g('nome').value.trim() || g('codigo').value.trim()) await q(sb.rpc('proc_macro_salvar', { p_empresa: state.empresa.id, p: { codigo: g('codigo').value, nome: g('nome').value } })); continue; }
        if (x.nome !== g('nome').value.trim() || x.ordem !== +g('ordem').value || x.ativo !== g('ativo').checked)
          await q(sb.rpc('proc_macro_salvar', { p_empresa: state.empresa.id, p: { id, nome: g('nome').value, ordem: +g('ordem').value, ativo: g('ativo').checked } }));
      }
      m.close(); toast('Macroprocessos salvos'); recarregar();
    } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------ ficha do processo
const podeEditar = (p) => D.ac.gestor || p.dono_id === state.user.id;
const podePop = (p) => p.ativo && (D.ac.elabora || p.dono_id === state.user.id);
const fluxoDe = (p, destaque) => svgFluxo(D.etapasDe(p.id), { codigo: codigoDa, destaque });
const tabEtapas = (E) => `<table class="small"><thead><tr><th class="num">Nº</th><th>Tipo</th><th>Responsável</th><th>O que é feito</th><th>Prazo</th><th>Onde, na plataforma</th><th>Segue para</th></tr></thead><tbody>
  ${E.map(e => `<tr><td class="num">${e.n}</td><td>${TIPOS_ETAPA[e.tipo]}</td><td>${esc(e.responsavel)}</td><td class="wrap">${esc(e.o_que)}${e.detalhe ? `<div class="muted">${esc(e.detalhe)}</div>` : ''}</td><td>${esc(e.prazo || '')}</td>
    <td>${e.tela ? `<a href="#/${esc(e.tela)}">${esc(telaTxt(e.tela))}</a>` : ''}</td><td>${e.tipo === 'decisao' ? `sim: ${e.sim || e.n + 1} · não: ${e.nao}` : e.tipo === 'fim' ? '—' : e.ir || (e.n < E.length ? e.n + 1 : '—')}</td></tr>`).join('')}</tbody></table>`;

function ficha(p) {
  if (!p) return;
  const E = D.etapasDe(p.id), ps = D.popsDe(p.id), cf = conferir(E);
  const m = modal({ title: `${p.codigo} — ${p.nome}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Macroprocesso</span><div>${esc(D.mac[p.macro_id]?.nome || '')}</div></div>
      <div><span class="muted">Dono</span><div>${p.dono_id ? esc(nomeP(p.dono_id)) : '<span class="badge vencido">sem dono</span>'}${p.critico ? ' <span class="badge negoc">crítico</span>' : ''}${p.sugerido ? ' <span class="badge aberto">sugerido</span>' : ''}</div></div>
      ${p.objetivo ? `<div class="span2"><span class="muted">Objetivo</span><div>${esc(p.objetivo)}</div></div>` : ''}
      <div><span class="muted">Entradas</span><div>${esc(p.entradas || '—')}</div></div><div><span class="muted">Saídas</span><div>${esc(p.saidas || '—')}</div></div>
      <div class="span2"><span class="muted">Clientes do processo</span><div>${esc(p.clientes || '—')}</div></div></div>
    ${cf.avisos.length ? `<p class="small" style="color:var(--warn)">${cf.avisos.map(esc).join(' ')}</p>` : ''}
    <h3 style="margin:14px 0 6px">Fluxograma</h3>
    <div style="overflow:auto;border:1px solid var(--border,#ddd);border-radius:6px;max-height:70vh;background:#fff">${fluxoDe(p) || '<div class="empty">Sem etapas. Use Editar para cadastrar.</div>'}</div>
    <h3 style="margin:14px 0 6px">Etapas</h3><div class="table-wrap">${tabEtapas(E)}</div>
    <div style="display:flex;align-items:center;gap:8px;margin:14px 0 6px"><h3 style="margin:0">POPs (${ps.length})</h3><span class="spacer"></span>${podePop(p) ? '<button class="btn primary small" id="fp-pop">Novo POP</button>' : ''}</div>
    <div class="table-wrap"><table class="small"><thead><tr><th>Código</th><th>Título</th><th>Situação</th><th>Revisar em</th></tr></thead><tbody>
    ${ps.map(x => `<tr data-pop="${x.id}" style="cursor:pointer"><td><b>${esc(x.codigo)}</b></td><td>${esc(x.titulo)}</td><td>${situacaoPop(x, D.versoesDe(x.id)).html}</td><td>${dateBR(x.revisar_em)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">Nenhum POP para este processo.</td></tr>'}</tbody></table></div>
    ${p.atualizado_em ? `<p class="small muted">Alterado por ${esc(p.atualizado_nome || '')} em ${dateBR(p.atualizado_em)}.</p>` : ''}`,
    foot: `${D.ac.gestor && !ps.length ? '<button class="btn ghost" id="fp-ex">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" id="fp-pdf">Imprimir</button>${podeEditar(p) ? '<button class="btn" id="fp-ed">Editar</button>' : ''}<button class="btn" data-close>Fechar</button>` });
  $$('[data-pop]', m.el).forEach(tr => tr.onclick = () => { m.close(); verPop(D.pops.find(x => x.id === tr.dataset.pop)); });
  $('#fp-ed', m.el) && ($('#fp-ed', m.el).onclick = () => { m.close(); editar(p); });
  $('#fp-pop', m.el) && ($('#fp-pop', m.el).onclick = () => { m.close(); novoPop(p); });
  $('#fp-ex', m.el) && ($('#fp-ex', m.el).onclick = async () => { if (!await confirmDialog(`Excluir o processo ${p.codigo}? As etapas são apagadas.`)) return;
    try { await q(sb.rpc('proc_excluir', { p_processo: p.id })); m.close(); toast('Processo excluído'); recarregar(); } catch (err) { fail(err); } });
  $('#fp-pdf', m.el).onclick = () => abrirRelatorio({ rel: 'Processo', tipo: 'documento', nome: `Processo ${p.codigo}`, titulo: `PROCESSO ${p.codigo}`, subtitulo: esc(p.nome),
    corpo: `<h2>1. Identificação</h2><table><tbody><tr><th style="width:24%">Macroprocesso</th><td>${esc(D.mac[p.macro_id]?.nome || '')}</td></tr><tr><th>Dono</th><td>${esc(nomeP(p.dono_id) || 'sem dono')}${p.critico ? ' — processo crítico' : ''}</td></tr>
      <tr><th>Objetivo</th><td>${esc(p.objetivo || '')}</td></tr><tr><th>Entradas</th><td>${esc(p.entradas || '')}</td></tr><tr><th>Saídas</th><td>${esc(p.saidas || '')}</td></tr><tr><th>Clientes</th><td>${esc(p.clientes || '')}</td></tr></tbody></table>
      <h2>2. Fluxograma</h2><div class="fx">${fluxoDe(p)}</div><h2>3. Etapas</h2>${tabEtapas(E)}
      <h2>4. POPs</h2><table><thead><tr><th>Código</th><th>Título</th><th>Versão em vigor</th><th>Revisar em</th></tr></thead><tbody>${ps.filter(x => x.ativo).map(x => `<tr><td>${esc(x.codigo)}</td><td>${esc(x.titulo)}</td><td>${x.versao_vigente ? 'v' + x.versao_vigente : 'em elaboração'}</td><td>${dateBR(x.revisar_em)}</td></tr>`).join('') || '<tr><td colspan="4">Nenhum.</td></tr>'}</tbody></table>`,
    extraCss: '.fx svg{max-width:100%;height:auto}.fx{page-break-inside:auto}', rodape: 'Base: Gestão de Processos (PAI016).' });
}

// ------------------------------------------------------------ editor do processo (com as etapas e o fluxograma ao vivo)
let seqLinha = 0;
function editar(p) {
  const g = D.ac.gestor, T = telasMenu();
  // cada linha tem uma chave própria; os destinos guardam a chave, então mover ou apagar linhas não embaralha as setas
  let L = (p ? D.etapasDe(p.id) : [{ tipo: 'inicio', responsavel: '', o_que: '' }, { tipo: 'atividade', responsavel: '', o_que: '' }, { tipo: 'fim', responsavel: '', o_que: '' }])
    .map(e => ({ ...e, k: ++seqLinha }));
  const porN = (n) => L[n - 1]?.k ?? null;
  L.forEach(e => { e.irK = porN(e.ir); e.simK = porN(e.sim); e.naoK = porN(e.nao); });
  const donos = D.pessoas.filter(x => x.papel !== 'leitura');
  const m = modal({ title: p ? `Editar ${p.codigo} — ${p.nome}` : 'Novo processo', wide: true, body: `<div class="grid-form">
      <label>Macroprocesso<select id="ep-m" ${!g ? 'disabled' : ''}>${D.macros.filter(x => x.ativo || x.id === p?.macro_id).map(x => `<option value="${x.id}" ${x.id === (p?.macro_id || ui.macro) ? 'selected' : ''}>${esc(x.codigo)} — ${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Nome<input id="ep-n" maxlength="80" value="${esc(p?.nome || '')}"></label>
      <label class="span2">Objetivo<input id="ep-o" maxlength="500" value="${esc(p?.objetivo || '')}" placeholder="para que o processo existe"></label>
      <label>Entradas<input id="ep-en" maxlength="500" value="${esc(p?.entradas || '')}"></label><label>Saídas<input id="ep-sa" maxlength="500" value="${esc(p?.saidas || '')}"></label>
      <label>Clientes do processo<input id="ep-cl" maxlength="300" value="${esc(p?.clientes || '')}" placeholder="quem recebe o resultado"></label>
      <label>Dono<select id="ep-d" ${!g ? 'disabled' : ''}><option value="">— sem dono —</option>${donos.map(x => `<option value="${x.user_id}" ${x.user_id === p?.dono_id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label class="span2" style="flex-direction:row;align-items:center;gap:8px;font-weight:400;display:flex"><input type="checkbox" id="ep-c" style="width:auto;margin:0" ${p?.critico ? 'checked' : ''} ${!g ? 'disabled' : ''}> Processo crítico${D.cfg.criticos_diretoria ? ' (o POP também passa pela Diretoria)' : ''}</label>
      ${p ? `<label style="flex-direction:row;align-items:center;gap:8px;font-weight:400;display:flex"><input type="checkbox" id="ep-a" style="width:auto;margin:0" ${p.ativo ? 'checked' : ''}> Ativo</label>` : ''}</div>
    <h3 style="margin:14px 0 6px">Etapas</h3>
    <p class="small muted" style="margin-top:0">O responsável é a raia do fluxograma: use sempre o mesmo nome para o mesmo setor ou função. A etapa segue para a de baixo, a não ser que você escolha outra em "segue para". A decisão tem o "sim" (padrão: a de baixo) e o "não".</p>
    <datalist id="ep-raias"></datalist><div class="table-wrap"><table class="small" id="ep-t"><thead><tr><th>Nº</th><th>Tipo</th><th>Responsável</th><th>O que é feito</th><th>Prazo</th><th>Tela</th><th>Segue para</th><th></th></tr></thead><tbody></tbody></table></div>
    <div style="margin:6px 0"><button class="btn small" id="ep-add">+ Etapa</button></div>
    <div id="ep-msg" class="small"></div>
    <h3 style="margin:14px 0 6px">Prévia do fluxograma</h3><div id="ep-fx" style="overflow:auto;border:1px solid var(--border,#ddd);border-radius:6px;max-height:60vh;background:#fff"></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ep-ok">Salvar</button>' });
  const tb = $('#ep-t tbody', m.el);
  const destOpts = (e, campo, vazio) => `<option value="">${vazio}</option>${L.filter(x => x.k !== e.k).map((x, _, __) => { const n = L.indexOf(x) + 1; return `<option value="${x.k}" ${e[campo] === x.k ? 'selected' : ''}>${n} — ${esc(String(x.o_que || '').slice(0, 30))}</option>`; }).join('')}`;
  const paraBanco = () => L.map(e => ({ tipo: e.tipo, responsavel: e.responsavel, o_que: e.o_que, detalhe: e.detalhe || null, prazo: e.prazo || null, tela: e.tela || null,
    ir: e.tipo === 'inicio' || e.tipo === 'atividade' ? (e.irK ? L.findIndex(x => x.k === e.irK) + 1 || null : null) : null,
    sim: e.tipo === 'decisao' ? (e.simK ? L.findIndex(x => x.k === e.simK) + 1 || null : null) : null,
    nao: e.tipo === 'decisao' ? (e.naoK ? L.findIndex(x => x.k === e.naoK) + 1 || null : null) : null }));
  const previa = () => {
    const E = paraBanco(), cf = conferir(E);
    $('#ep-raias', m.el).innerHTML = raias(E).map(r => `<option value="${esc(r)}">`).join('');
    $('#ep-msg', m.el).innerHTML = [...cf.erros.map(x => `<div style="color:var(--danger,#c00)">${esc(x)}</div>`), ...cf.avisos.map(x => `<div style="color:var(--warn)">${esc(x)}</div>`)].join('');
    $('#ep-fx', m.el).innerHTML = cf.erros.length ? '<div class="empty">Corrija as etapas para ver o fluxograma.</div>' : svgFluxo(E, { codigo: codigoDa });
  };
  const linhas = () => {
    tb.innerHTML = L.map((e, i) => `<tr data-k="${e.k}"><td class="num">${i + 1}</td>
      <td><select data-f="tipo">${Object.entries(TIPOS_ETAPA).map(([k, v]) => `<option value="${k}" ${e.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input data-f="responsavel" list="ep-raias" maxlength="40" value="${esc(e.responsavel || '')}" style="min-width:110px"></td>
      <td><input data-f="o_que" maxlength="160" value="${esc(e.o_que || '')}" style="min-width:200px"></td>
      <td><input data-f="prazo" maxlength="40" value="${esc(e.prazo || '')}" style="width:100px"></td>
      <td><select data-f="tela" style="min-width:150px;max-width:190px"><option value="">—</option>${T.map(([r, t]) => `<option value="${r}" ${e.tela === r ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
      <td>${e.tipo === 'decisao' ? `<div style="display:flex;flex-direction:column;gap:4px"><select data-f="simK" title="Sim" style="max-width:170px">${destOpts(e, 'simK', 'sim: a de baixo')}</select><select data-f="naoK" title="Não" style="max-width:170px">${destOpts(e, 'naoK', 'não: escolha')}</select></div>`
        : e.tipo === 'fim' ? '<span class="muted">—</span>' : `<select data-f="irK" style="max-width:170px">${destOpts(e, 'irK', 'a de baixo')}</select>`}</td>
      <td style="white-space:nowrap"><button class="btn ghost small" data-mv="-1" title="Subir">↑</button><button class="btn ghost small" data-mv="1" title="Descer">↓</button><button class="btn ghost small" data-del title="Apagar">✕</button></td></tr>`).join('');
    previa();
  };
  tb.addEventListener('input', (ev) => { const tr = ev.target.closest('tr'), f = ev.target.dataset.f; if (!tr || !f) return; const e = L.find(x => x.k === +tr.dataset.k);
    e[f] = /K$/.test(f) ? (ev.target.value ? +ev.target.value : null) : ev.target.value; if (f === 'tipo') linhas(); else if (f === 'o_que') { clearTimeout(ui.tp); ui.tp = setTimeout(previa, 400); } else previa(); });
  tb.addEventListener('change', (ev) => { if (ev.target.tagName === 'SELECT') previa(); });
  tb.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; const tr = b.closest('tr'), i = L.findIndex(x => x.k === +tr.dataset.k);
    if (b.dataset.del !== undefined) { const k = L[i].k; L.splice(i, 1); L.forEach(e => { for (const c of ['irK', 'simK', 'naoK']) if (e[c] === k) e[c] = null; }); }
    else { const j = i + +b.dataset.mv; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; }
    linhas(); });
  $('#ep-add', m.el).onclick = () => { const ult = L[L.length - 1], nova = { k: ++seqLinha, tipo: 'atividade', responsavel: ult?.responsavel || '', o_que: '' };
    if (ult?.tipo === 'fim') L.splice(L.length - 1, 0, nova); else L.push(nova); linhas(); };
  linhas();
  $('#ep-ok', m.el).onclick = async () => {
    const E = paraBanco(), cf = conferir(E); if (cf.erros.length) return toast(cf.erros[0], true);
    try {
      const id = await q(sb.rpc('proc_salvar', { p_empresa: state.empresa.id, p: { id: p?.id || null, macro_id: $('#ep-m', m.el).value, nome: $('#ep-n', m.el).value, objetivo: $('#ep-o', m.el).value,
        entradas: $('#ep-en', m.el).value, saidas: $('#ep-sa', m.el).value, clientes: $('#ep-cl', m.el).value, dono_id: $('#ep-d', m.el).value || null, critico: $('#ep-c', m.el).checked,
        ativo: $('#ep-a', m.el) ? $('#ep-a', m.el).checked : true, etapas: E } }));
      m.close(); toast('Processo salvo'); await recarregar(); ficha(D.pr[id]);
    } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------ POPs
function abaPops(c) {
  const t = ui.busca.trim().toLowerCase();
  const L = D.pops.filter(p => (ui.sitPop === 'obsoletos' ? !p.ativo : p.ativo) && (!t || `${p.codigo} ${p.titulo} ${D.pr[p.processo_id]?.codigo} ${D.pr[p.processo_id]?.nome}`.toLowerCase().includes(t)));
  c.innerHTML = `<div class="card" style="margin-bottom:12px"><div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:10px">
    <label>Procurar<input id="pp-b" value="${esc(ui.busca)}" placeholder="código, título ou processo"></label>
    <label>Mostrar<select id="pp-s"><option value="">Em uso e em elaboração</option><option value="obsoletos" ${ui.sitPop === 'obsoletos' ? 'selected' : ''}>Obsoletos</option></select></label></div>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn ghost" id="pp-xls">Excel</button><button class="btn ghost" id="pp-rel">Lista mestra (PDF)</button><span class="spacer"></span><span class="small muted">${L.length} POP(s). Para escrever um POP, abra o processo no Mapa e use Novo POP.</span></div></div>
    <div class="card flush"><div class="table-wrap"><table id="pp-tab"><thead><tr><th>Código</th><th>Título</th><th>Processo</th><th>Situação</th><th>Em vigor desde</th><th>Revisar em</th><th>Minha leitura</th></tr></thead><tbody>
    ${L.map(p => { const V = D.versoesDe(p.id), vg = V.find(v => v.situacao === 'vigente'), s = situacaoPop(p, V), deve = vg && D.pend.ler.some(x => x.versao.id === vg.id);
      return `<tr data-pop="${p.id}" style="cursor:pointer"><td><b>${esc(p.codigo)}</b></td><td class="wrap">${esc(p.titulo)}</td><td>${esc(D.pr[p.processo_id]?.codigo || '')}</td><td>${s.html}</td>
        <td>${dateBR(vg?.vigente_desde)}</td><td>${p.revisar_em ? (p.revisar_em < today() ? `<span class="badge vencido">${dateBR(p.revisar_em)}</span>` : dateBR(p.revisar_em)) : ''}</td>
        <td>${vg ? (D.lidas.has(vg.id) ? '<span class="badge pago">lida</span>' : deve ? '<span class="badge vencido">pendente</span>' : '<span class="muted small">não obrigatória</span>') : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="7" class="empty">Nenhum POP.</td></tr>'}</tbody></table></div></div>`;
  $('#pp-b', c).oninput = (ev) => { clearTimeout(ui.t); ui.t = setTimeout(() => { ui.busca = ev.target.value; abaPops(c); const i = $('#pp-b', c); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  $('#pp-s', c).onchange = (ev) => { ui.sitPop = ev.target.value; abaPops(c); };
  $$('[data-pop]', c).forEach(tr => tr.onclick = () => verPop(D.pops.find(x => x.id === tr.dataset.pop)));
  $('#pp-xls', c).onclick = () => exportXLSX($('#pp-tab', c), 'lista_de_pops');
  $('#pp-rel', c).onclick = () => abrirRelatorio({ rel: 'Lista mestra de POPs', nome: 'Lista Mestra de POPs', titulo: 'LISTA MESTRA DE POPs',
    corpo: `<table><thead><tr><th>Código</th><th>Título</th><th>Processo</th><th>Versão</th><th>Em vigor desde</th><th>Aprovado por</th><th>Revisar em</th></tr></thead><tbody>
      ${L.map(p => { const vg = D.versoesDe(p.id).find(v => v.situacao === 'vigente'); return `<tr><td>${esc(p.codigo)}</td><td>${esc(p.titulo)}</td><td>${esc(D.pr[p.processo_id]?.codigo || '')}</td><td>${vg ? 'v' + vg.versao : 'em elaboração'}</td>
        <td>${dateBR(vg?.vigente_desde)}</td><td>${esc([vg?.aprovado_nome, vg?.diretoria_nome].filter(Boolean).join(' / '))}</td><td>${dateBR(p.revisar_em)}</td></tr>`; }).join('')}</tbody></table>`,
    rodape: 'Só vale a versão em vigor na plataforma; cópia impressa é para consulta. Base: Gestão de Processos (PAI016).' });
}

async function novoPop(p) {
  const m = modal({ title: `Novo POP — ${p.codigo} ${p.nome}`, narrow: true, body: `<label>Título do POP<input id="np-t" maxlength="120" placeholder="ex.: Cotação de compras"></label>
    <p class="small muted">O código sai sozinho (POP-${esc(D.mac[p.macro_id]?.codigo || '')}-…). Depois você escreve o conteúdo e envia para aprovação.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="np-ok">Criar</button>' });
  $('#np-ok', m.el).onclick = async () => {
    try { const id = await q(sb.rpc('proc_pop_criar', { p_processo: p.id, p_titulo: $('#np-t', m.el).value })); m.close(); await recarregar(); const pp = D.pops.find(x => x.id === id);
      editarVersao(pp, D.versoesDe(id)[0]); } catch (err) { fail(err); }
  };
}

const podeEscrever = (pp, v) => v.situacao === 'rascunho' && (D.ac.gestor || (D.ac.elabora && v.elaborado_por === state.user.id) || D.pr[pp.processo_id]?.dono_id === state.user.id);
const aprovador = (pp, v) => {
  if (v.situacao !== 'em_aprovacao') return false;
  if (v.elaborado_por === state.user.id && !D.cfg.autoaprovacao) return false;
  if (v.fase === 1 && v.aprovador_tipo === 'dono') return D.pr[pp.processo_id]?.dono_id === state.user.id;
  return D.ac.diretoria && !(v.fase === 2 && v.aprovado_por === state.user.id);
};

function verPop(pp, vid) {
  if (!pp) return;
  const V = D.versoesDe(pp.id), x = D.pr[pp.processo_id] || {}, E = D.etapasDe(x.id);
  const v = V.find(y => y.id === vid) || V.find(y => y.situacao === 'vigente') || V[V.length - 1];
  if (!v) return toast('POP sem versão.', true);
  const aberta = V.find(y => ['rascunho', 'em_aprovacao'].includes(y.situacao)), vg = V.find(y => y.situacao === 'vigente');
  const lida = D.lidas.has(v.id), donoOuGestor = D.ac.gestor || x.dono_id === state.user.id;
  const fase = v.situacao === 'em_aprovacao' ? (v.fase === 2 ? 'aguardando a Diretoria (processo crítico)' : v.aprovador_tipo === 'dono' ? `aguardando o dono (${nomeP(x.dono_id)})` : 'aguardando a Diretoria') : '';
  const m = modal({ title: `${pp.codigo} — ${pp.titulo}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Processo</span><div><a href="#" id="vp-proc">${esc(x.codigo || '')} ${esc(x.nome || '')}</a></div></div>
      <div><span class="muted">Versão</span><div>v${v.versao} ${badge(SITV, v.situacao)} ${fase ? `<span class="muted">${esc(fase)}</span>` : ''}</div></div>
      <div><span class="muted">Elaborado por</span><div>${esc(v.elaborado_nome || '')} <span class="muted">${dateBR(v.elaborado_em)}</span></div></div>
      <div><span class="muted">Aprovado por</span><div>${v.aprovado_nome ? `${esc(v.aprovado_nome)} <span class="muted">${dateBR(v.aprovado_em)}${v.aprovador_tipo === 'diretoria' ? ' (Diretoria)' : ' (dono)'}</span>` : '—'}${v.diretoria_nome ? `<br>${esc(v.diretoria_nome)} <span class="muted">${dateBR(v.diretoria_em)} (Diretoria)</span>` : ''}</div></div>
      ${v.situacao === 'vigente' ? `<div><span class="muted">Em vigor desde</span><div>${dateBR(v.vigente_desde)}</div></div><div><span class="muted">Revisar até</span><div>${pp.revisar_em < today() ? `<span class="badge vencido">${dateBR(pp.revisar_em)}</span>` : dateBR(pp.revisar_em)}</div></div>` : ''}
      ${!pp.ativo ? `<div class="span2"><span class="badge">obsoleto</span> ${esc(pp.obsoleto_motivo || '')}</div>` : ''}
      ${v.recusa_motivo && v.situacao === 'rascunho' ? `<div class="span2" style="color:var(--danger,#c00)"><b>Recusado</b> por ${esc(v.recusado_nome || '')} em ${dateBR(v.recusado_em)}: ${esc(v.recusa_motivo)}</div>` : ''}</div>
    ${v.situacao === 'vigente' && !lida ? `<div class="card small" style="border-left:3px solid var(--warn);margin:10px 0">Leia o procedimento abaixo e confirme a leitura no fim da janela.</div>` : ''}
    <div class="pop-texto" style="margin-top:10px">${textoPop(v, E, { esc, tela: telaTxt })}</div>
    ${v.anexo_caminho ? `<p><button class="btn small" id="vp-anx">📎 ${esc(v.anexo_nome || 'Anexo')}</button></p>` : ''}
    ${v.etapas?.length && E.length ? `<h3 style="margin:14px 0 6px">Onde está no processo</h3><div style="overflow:auto;border:1px solid var(--border,#ddd);border-radius:6px;max-height:50vh;background:#fff">${svgFluxo(E, { codigo: codigoDa, destaque: v.etapas })}</div>` : ''}
    <h3 style="margin:14px 0 6px">Histórico</h3><div class="table-wrap"><table class="small"><thead><tr><th>Versão</th><th>Situação</th><th>O que mudou</th><th>Elaborado</th><th>Em vigor</th><th></th></tr></thead><tbody>
    ${V.slice().reverse().map(y => `<tr><td>v${y.versao}</td><td>${badge(SITV, y.situacao)}</td><td class="wrap">${esc(y.motivo || (y.versao === 1 ? 'Emissão inicial' : ''))}</td><td>${esc(y.elaborado_nome || '')}</td>
      <td>${dateBR(y.vigente_desde)}${y.obsoleta_em ? ` a ${dateBR(y.obsoleta_em)}` : ''}</td><td>${y.id !== v.id ? `<button class="btn ghost small" data-vv="${y.id}">Ver</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div id="vp-lei"></div>`,
    foot: `<button class="btn ghost" id="vp-pdf">Imprimir</button>${['vigente', 'em_aprovacao'].includes(v.situacao) && (donoOuGestor || v.elaborado_por === state.user.id) ? '<button class="btn ghost" id="vp-leit">Quem leu</button>' : ''}
      ${donoOuGestor && pp.ativo && !aberta ? '<button class="btn ghost" id="vp-obs">Tornar obsoleto</button>' : ''}<span class="spacer"></span>
      ${podeEscrever(pp, v) ? '<button class="btn ghost" id="vp-desc">Descartar rascunho</button><button class="btn" id="vp-ed">Editar</button><button class="btn primary" id="vp-env">Enviar para aprovação</button>' : ''}
      ${aprovador(pp, v) ? '<button class="btn" id="vp-rec">Recusar</button><button class="btn primary" id="vp-apr">Aprovar</button>' : ''}
      ${v.situacao === 'vigente' && !aberta && (D.ac.elabora || x.dono_id === state.user.id) ? '<button class="btn" id="vp-rev">Nova revisão</button>' : ''}
      ${aberta && aberta.id !== v.id ? `<button class="btn" data-vv="${aberta.id}">Ver a v${aberta.versao} (${aberta.situacao === 'rascunho' ? 'rascunho' : 'em aprovação'})</button>` : ''}
      ${v.situacao === 'vigente' && !lida ? '<button class="btn primary" id="vp-ler">Li e entendi</button>' : ''}${v.situacao === 'vigente' && lida ? '<span class="badge pago">leitura confirmada</span>' : ''}
      <button class="btn" data-close>Fechar</button>` });
  const rpc = async (f, a, msg) => { try { const r = await q(sb.rpc(f, a)); if (msg) toast(typeof msg === 'function' ? msg(r) : msg); m.close(); await recarregar(); return r; } catch (err) { fail(err); return undefined; } };
  $('#vp-proc', m.el).onclick = (ev) => { ev.preventDefault(); m.close(); ficha(x); };
  $$('[data-vv]', m.el).forEach(b => b.onclick = () => { m.close(); verPop(pp, b.dataset.vv); });
  $('#vp-anx', m.el) && ($('#vp-anx', m.el).onclick = async () => { const w = window.open('', '_blank'); const { data, error } = await sb.storage.from('processos').createSignedUrl(v.anexo_caminho, 600);
    if (error) { w?.close(); return fail(error); } if (w) w.location = data.signedUrl; else location.href = data.signedUrl; });
  $('#vp-ed', m.el) && ($('#vp-ed', m.el).onclick = () => { m.close(); editarVersao(pp, v); });
  $('#vp-env', m.el) && ($('#vp-env', m.el).onclick = async () => { const r = await rpc('proc_versao_enviar', { p_versao: v.id }, (t) => t === 'dono' ? 'Enviado ao dono do processo para aprovar' : 'Enviado à Diretoria para aprovar'); if (r !== undefined) verPop(D.pops.find(y => y.id === pp.id), v.id); });
  $('#vp-desc', m.el) && ($('#vp-desc', m.el).onclick = async () => { if (!await confirmDialog(`Descartar o rascunho v${v.versao}?${V.length === 1 ? ' O POP só tem este rascunho e será excluído.' : ''}`)) return; rpc('proc_versao_descartar', { p_versao: v.id }, 'Rascunho descartado'); });
  $('#vp-apr', m.el) && ($('#vp-apr', m.el).onclick = async () => { if (!await confirmDialog(`Aprovar o ${pp.codigo} v${v.versao}?`)) return;
    const r = await rpc('proc_versao_decidir', { p_versao: v.id, p_aprovar: true, p_motivo: null }, (t) => t === 'vigente' ? 'POP em vigor: quem precisa ler foi avisado' : 'Aprovado. Processo crítico: segue para a Diretoria'); if (r !== undefined) verPop(D.pops.find(y => y.id === pp.id), v.id); });
  $('#vp-rec', m.el) && ($('#vp-rec', m.el).onclick = () => { const mm = modal({ title: 'Recusar o POP', narrow: true, body: '<label>O que precisa mudar<textarea id="rc-m" rows="4" maxlength="500"></textarea></label>',
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn danger" id="rc-ok">Recusar</button>' });
    $('#rc-ok', mm.el).onclick = async () => { try { await q(sb.rpc('proc_versao_decidir', { p_versao: v.id, p_aprovar: false, p_motivo: $('#rc-m', mm.el).value })); mm.close(); m.close(); toast('Recusado: volta para quem elaborou'); recarregar(); } catch (err) { fail(err); } }; });
  $('#vp-rev', m.el) && ($('#vp-rev', m.el).onclick = async () => { const id = await rpc('proc_pop_revisar', { p_pop: pp.id }, 'Nova versão em rascunho, com o texto da versão em vigor'); if (id) editarVersao(D.pops.find(y => y.id === pp.id), D.versoes.find(y => y.id === id)); });
  $('#vp-ler', m.el) && ($('#vp-ler', m.el).onclick = () => rpc('proc_ler', { p_versao: v.id }, 'Leitura confirmada'));
  $('#vp-obs', m.el) && ($('#vp-obs', m.el).onclick = () => { const mm = modal({ title: `Tornar ${pp.codigo} obsoleto`, narrow: true, body: '<label>Motivo<input id="ob-m" maxlength="300" placeholder="ex.: substituído pelo POP-SUP-004"></label><p class="small muted">O POP deixa de valer; o histórico fica.</p>',
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn danger" id="ob-ok">Tornar obsoleto</button>' });
    $('#ob-ok', mm.el).onclick = async () => { try { await q(sb.rpc('proc_pop_obsoletar', { p_pop: pp.id, p_motivo: $('#ob-m', mm.el).value })); mm.close(); m.close(); toast('POP obsoleto'); recarregar(); } catch (err) { fail(err); } }; });
  $('#vp-leit', m.el) && ($('#vp-leit', m.el).onclick = async () => {
    try { const R = await q(sb.rpc('proc_leitores', { p_versao: v.id })), obr = R.filter(r => r.obrigatorio);
      $('#vp-lei', m.el).innerHTML = `<h3 style="margin:14px 0 6px">Leitura da v${v.versao}: ${obr.filter(r => r.lido_em).length} de ${obr.length} obrigatória(s)</h3><div class="table-wrap"><table class="small"><thead><tr><th>Pessoa</th><th>Perfil</th><th>Leu em</th></tr></thead><tbody>
        ${R.map(r => `<tr><td>${esc(r.nome)}${r.obrigatorio ? '' : ' <span class="muted">(não obrigatória)</span>'}</td><td>${esc(PAP[r.papel] || r.papel)}</td><td>${r.lido_em ? dateBR(r.lido_em) : '<span class="badge vencido">pendente</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Ninguém.</td></tr>'}</tbody></table></div>`;
      $('#vp-lei', m.el).scrollIntoView({ behavior: 'smooth' });
    } catch (err) { fail(err); } });
  $('#vp-pdf', m.el).onclick = () => abrirRelatorio({ rel: 'POP', tipo: 'documento', nome: `${pp.codigo} v${v.versao}`, titulo: `PROCEDIMENTO OPERACIONAL PADRÃO`, subtitulo: `${esc(pp.codigo)} — ${esc(pp.titulo)}`,
    corpo: `<table><tbody><tr><th style="width:22%">Código</th><td>${esc(pp.codigo)}</td><th style="width:18%">Versão</th><td>v${v.versao} — ${SITV[v.situacao][0].toLowerCase()}</td></tr>
      <tr><th>Processo</th><td>${esc(x.codigo || '')} ${esc(x.nome || '')}</td><th>Em vigor desde</th><td>${dateBR(v.vigente_desde) || '—'}</td></tr>
      <tr><th>Elaborado por</th><td>${esc(v.elaborado_nome || '')} em ${dateBR(v.elaborado_em)}</td><th>Revisar até</th><td>${v.situacao === 'vigente' ? dateBR(pp.revisar_em) : '—'}</td></tr>
      <tr><th>Aprovado por</th><td colspan="3">${esc([v.aprovado_nome && `${v.aprovado_nome} em ${dateBR(v.aprovado_em)}`, v.diretoria_nome && `${v.diretoria_nome} (Diretoria) em ${dateBR(v.diretoria_em)}`].filter(Boolean).join('; ') || '—')}</td></tr></tbody></table>
      ${textoPop(v, E, { esc, tela: telaTxt, numerar: true })}
      ${v.etapas?.length && E.length ? `<h2>Onde está no processo</h2><div class="fx">${svgFluxo(E, { codigo: codigoDa, destaque: v.etapas })}</div>` : ''}
      <h2>Histórico de versões</h2><table><thead><tr><th>Versão</th><th>O que mudou</th><th>Em vigor</th></tr></thead><tbody>${V.filter(y => y.vigente_desde).map(y => `<tr><td>v${y.versao}</td><td>${esc(y.motivo || (y.versao === 1 ? 'Emissão inicial' : ''))}</td><td>${dateBR(y.vigente_desde)}${y.obsoleta_em ? ' a ' + dateBR(y.obsoleta_em) : ''}</td></tr>`).join('') || '<tr><td colspan="3">Ainda não entrou em vigor.</td></tr>'}</tbody></table>`,
    extraCss: '.fx svg{max-width:100%;height:auto}', rodape: `Cópia impressa não controlada: só vale a versão em vigor na plataforma (PAI016). ${v.situacao !== 'vigente' ? 'ESTA VERSÃO NÃO ESTÁ EM VIGOR.' : ''}` });
}

function editarVersao(pp, v) {
  if (!pp || !v) return;
  const x = D.pr[pp.processo_id] || {}, E = D.etapasDe(x.id), et = new Set(v.etapas || []);
  const campo = (k, rot, rows, dica = '', max = 1000) => `<label class="span2">${rot}${dica ? ` <span class="muted small" style="font-weight:400">${dica}</span>` : ''}<textarea data-f="${k}" rows="${rows}" maxlength="${max}">${esc(v[k] || '')}</textarea></label>`;
  const chk = (attr, val, on, txt) => `<label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin:0 14px 6px 0;font-weight:400"><input type="checkbox" style="width:auto;margin:0" ${attr}="${val}" ${on ? 'checked' : ''}> ${esc(txt)}</label>`;
  const m = modal({ title: `${pp.codigo} v${v.versao} — rascunho`, wide: true, body: `<div class="grid-form">
      <label class="span2">Título<input id="ev-t" maxlength="120" value="${esc(pp.titulo)}"></label>
      ${v.versao > 1 ? campo('motivo', 'O que mudou nesta versão', 2, 'obrigatório para enviar', 500) : ''}
      ${campo('objetivo', '1. Objetivo', 2)}${campo('aplicacao', '2. Aplicação', 2, 'onde e a quem se aplica')}
      ${campo('responsabilidades', '3. Responsabilidades', 3, 'quem faz o quê', 2000)}${campo('materiais', '4. Materiais, equipamentos e EPI', 2)}
      ${campo('procedimento', '5. Procedimento', 12, 'o passo a passo; uma linha por passo (1., 2., 3.…)', 20000)}
      ${campo('registros', '6. Registros', 2, 'o que fica registrado e onde (tela da plataforma, formulário)')}${campo('referencias', '7. Referências', 2, 'normas, outros POPs')}</div>
    <h3 style="margin:14px 0 6px">Etapas do processo que este POP cobre</h3>
    <div>${E.map(e => chk('data-et', e.n, et.has(e.n), `${e.n}. ${e.o_que}`)).join('') || '<span class="muted small">O processo não tem etapas.</span>'}</div>
    <h3 style="margin:14px 0 6px">Quem precisa ler</h3><div class="small muted">Perfis:</div>
    <div>${PAPEIS.map(([k, t]) => chk('data-pub', k, v.publico?.includes(k), t)).join('')}</div>
    <div class="small muted" style="margin-top:4px">E estas pessoas:</div><div>${D.pessoas.map(p => chk('data-lei', p.user_id, v.leitores?.includes(p.user_id), p.nome)).join('')}</div>
    <h3 style="margin:14px 0 6px">Anexo <span class="muted small" style="font-weight:400">(opcional: formulário, foto ou desenho em PDF, JPG ou PNG, até 20 MB)</span></h3>
    <div id="ev-anx" class="small">${v.anexo_caminho ? `📎 ${esc(v.anexo_nome || 'anexo')} <button class="btn ghost small" id="ev-anx-x">Tirar</button>` : '<span class="muted">sem anexo</span>'}</div>
    <label class="btn small" style="margin-top:6px;cursor:pointer;display:inline-block">Escolher arquivo<input type="file" id="ev-up" accept="application/pdf,image/jpeg,image/png" hidden></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn" id="ev-ok">Salvar rascunho</button><button class="btn primary" id="ev-env">Salvar e enviar para aprovação</button>' });
  let anexo = v.anexo_caminho ? { caminho: v.anexo_caminho, nome: v.anexo_nome } : null;
  const pinta = () => { $('#ev-anx', m.el).innerHTML = anexo ? `📎 ${esc(anexo.nome || 'anexo')} <button class="btn ghost small" id="ev-anx-x">Tirar</button>` : '<span class="muted">sem anexo</span>';
    const b = $('#ev-anx-x', m.el); if (b) b.onclick = () => { anexo = null; pinta(); }; };
  pinta();
  $('#ev-up', m.el).onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) return toast('Só PDF, JPG ou PNG.', true);
    if (f.size > 20971520) return toast('Arquivo acima de 20 MB.', true);
    const ext = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : 'jpg', cam = `${state.empresa.id}/${pp.id}/${crypto.randomUUID()}.${ext}`;
    $('#ev-anx', m.el).textContent = `Enviando ${f.name}…`;
    const { error } = await sb.storage.from('processos').upload(cam, f, { contentType: f.type, upsert: false });
    if (error) { fail(error); return pinta(); }
    anexo = { caminho: cam, nome: f.name }; pinta();
  };
  const salvar = async () => {
    const p = { titulo: $('#ev-t', m.el).value, etapas: $$('[data-et]', m.el).filter(c => c.checked).map(c => +c.dataset.et), publico: $$('[data-pub]', m.el).filter(c => c.checked).map(c => c.dataset.pub),
      leitores: $$('[data-lei]', m.el).filter(c => c.checked).map(c => c.dataset.lei), anexo_caminho: anexo?.caminho || null, anexo_nome: anexo?.nome || null };
    for (const t of $$('[data-f]', m.el)) p[t.dataset.f] = t.value;
    if (v.versao === 1) p.motivo = null;
    await q(sb.rpc('proc_versao_salvar', { p_versao: v.id, p }));
  };
  $('#ev-ok', m.el).onclick = async () => { try { await salvar(); m.close(); toast('Rascunho salvo'); await recarregar(); verPop(D.pops.find(y => y.id === pp.id), v.id); } catch (err) { fail(err); } };
  $('#ev-env', m.el).onclick = async () => { try { await salvar(); const t = await q(sb.rpc('proc_versao_enviar', { p_versao: v.id })); m.close();
    toast(t === 'dono' ? 'Enviado ao dono do processo para aprovar' : 'Enviado à Diretoria para aprovar'); await recarregar(); verPop(D.pops.find(y => y.id === pp.id), v.id); } catch (err) { fail(err); await recarregar(); } };
}

// ------------------------------------------------------------ para mim
function abaMim(c) {
  const P = D.pend, linha = (pp, v, txt) => `<tr data-pop="${pp.id}" data-v="${v?.id || ''}" style="cursor:pointer"><td><b>${esc(pp.codigo)}</b></td><td class="wrap">${esc(pp.titulo)}</td><td>${esc(D.pr[pp.processo_id]?.codigo || '')}</td><td class="small">${txt}</td></tr>`;
  const bloco = (tit, dica, L, f) => `<div class="card flush" style="margin-bottom:12px"><div style="padding:10px 14px 0"><h3 style="margin:0">${tit} (${L.length})</h3><div class="small muted">${dica}</div></div>
    <div class="table-wrap"><table class="small"><tbody>${L.map(f).join('') || '<tr><td class="empty">Nada pendente.</td></tr>'}</tbody></table></div></div>`;
  c.innerHTML = bloco('Aprovar', 'POPs aguardando a sua aprovação (como dono do processo ou pela Diretoria).', P.aprovar, (x) => linha(x.pop, x.versao, `v${x.versao.versao} · enviado em ${dateBR(x.versao.enviado_em)} por ${esc(x.versao.elaborado_nome || '')}`))
    + bloco('Ler e confirmar', `POPs em vigor que o seu perfil ou você precisa ler. Prazo: ${D.cfg.leitura_dias} dia(s) depois de entrar em vigor.`, P.ler, (x) => linha(x.pop, x.versao, `v${x.versao.versao} · em vigor desde ${dateBR(x.versao.vigente_desde)}`))
    + bloco('Revisar', `POPs dos seus processos (ou que você escreveu) com a revisão vencida ou vencendo nos próximos ${D.cfg.aviso_revisao_dias} dias.`, P.revisar, (x) => linha(x.pop, null, x.pop.revisar_em < today() ? `<span class="badge vencido">vencida em ${dateBR(x.pop.revisar_em)}</span>` : `até ${dateBR(x.pop.revisar_em)}`))
    + bloco('Meus rascunhos', 'Rascunhos que você escreveu, inclusive os recusados.', P.rascunhos, (x) => linha(x.pop, x.versao, x.versao.recusa_motivo ? `<span class="badge vencido">recusado</span> ${esc(x.versao.recusa_motivo)}` : `v${x.versao.versao} · rascunho`))
    + (D.ac.gestor ? bloco('Processos sem dono', 'Defina o dono para que os POPs tenham quem aprove.', D.procs.filter(p => p.ativo && !p.dono_id), (p) => `<tr data-p="${p.id}" style="cursor:pointer"><td><b>${esc(p.codigo)}</b></td><td>${esc(p.nome)}</td></tr>`) : '');
  $$('[data-pop]', c).forEach(tr => tr.onclick = () => verPop(D.pops.find(x => x.id === tr.dataset.pop), tr.dataset.v || undefined));
  $$('[data-p]', c).forEach(tr => tr.onclick = () => ficha(D.pr[tr.dataset.p]));
}

// ------------------------------------------------------------ parâmetros
function abaParametros(c) {
  const g = D.cfg, chk = (grp, k, on, dis) => `<label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin:0 14px 6px 0;font-weight:400"><input type="checkbox" style="width:auto;margin:0" data-${grp}="${k}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}> ${esc(PAP[k])}</label>`;
  c.innerHTML = `<div class="card" style="max-width:900px">
      <h3 style="margin-top:0">Quem mantém o mapa</h3><p class="small muted" style="margin-top:0">Cria e altera processos, define os donos e marca os críticos. O dono de cada processo altera o próprio processo.</p>
      <div>${PAPEIS.map(([k]) => chk('g', k, g.papeis_gestor.includes(k), k === 'admin')).join('')}</div>
      <h3>Quem consulta o mapa e os POPs</h3><div>${PAPEIS.map(([k]) => chk('v', k, g.papeis_ve.includes(k))).join('')}</div>
      <h3>Quem escreve POPs</h3><div>${PAPEIS.slice(0, 6).map(([k]) => chk('e', k, g.papeis_elabora.includes(k))).join('')}</div>
      <h3>Quem aprova pela Diretoria</h3><p class="small muted" style="margin-top:0">Aprova quando o processo não tem dono ou quando o próprio dono escreveu o POP, e depois do dono nos processos críticos.</p>
      <div>${PAPEIS.slice(0, 2).map(([k]) => chk('d', k, g.papeis_diretoria.includes(k))).join('')}</div>
      <label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="pr-cd" style="width:auto;margin:0" ${g.criticos_diretoria ? 'checked' : ''}> Processo crítico: depois do dono, a Diretoria também aprova o POP</label>
      <div class="grid-form" style="margin-top:10px">
        <label>Revisão do POP (meses)<input type="number" id="pr-rm" min="1" max="60" value="${g.revisao_meses}"></label>
        <label>Avisar antes da revisão (dias)<input type="number" id="pr-ad" min="0" max="120" value="${g.aviso_revisao_dias}"></label>
        <label>Prazo para ler o POP (dias)<input type="number" id="pr-ld" min="1" max="60" value="${g.leitura_dias}"></label>
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="pr-cl" style="width:auto;margin:0" ${g.cobrar_leitura ? 'checked' : ''}> Cobrar quem não leu (toda segunda-feira)</label></div>
      <h3>Exceção</h3><label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="pr-aa" style="width:auto;margin:0" ${g.autoaprovacao ? 'checked' : ''}> Quem escreveu o POP pode aprová-lo (deixa de haver a segunda pessoa; use só em empresa muito pequena)</label>
      <div style="margin-top:12px"><button class="btn primary" id="pr-ok">Salvar</button>${D.ac.gestor ? ' <button class="btn ghost" id="pr-sug">Trazer de novo os processos sugeridos que faltam</button>' : ''}</div></div>`;
  const marc = (grp) => $$(`[data-${grp}]`, c).filter(x => x.checked).map(x => x.dataset[grp]);
  $('#pr-ok', c).onclick = async () => { try { await q(sb.rpc('proc_config_salvar', { p_empresa: state.empresa.id, p: { papeis_gestor: marc('g'), papeis_ve: marc('v'), papeis_elabora: marc('e'), papeis_diretoria: marc('d'),
    criticos_diretoria: $('#pr-cd', c).checked, autoaprovacao: $('#pr-aa', c).checked, revisao_meses: +$('#pr-rm', c).value, aviso_revisao_dias: +$('#pr-ad', c).value, leitura_dias: +$('#pr-ld', c).value, cobrar_leitura: $('#pr-cl', c).checked } }));
    toast('Parâmetros salvos'); recarregar(); } catch (err) { fail(err); } };
  $('#pr-sug', c) && ($('#pr-sug', c).onclick = async () => { try { const k = await q(sb.rpc('proc_configurar', { p_empresa: state.empresa.id })); toast(k ? `${k} processo(s) sugerido(s) incluído(s)` : 'Todos os processos sugeridos já estão no mapa.'); recarregar(); } catch (err) { fail(err); } });
}

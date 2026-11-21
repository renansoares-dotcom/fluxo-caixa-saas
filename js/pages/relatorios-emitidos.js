// Painéis › Relatórios emitidos (PAI014, SQL 174): histórico das emissões de relatório (PDF e Excel) com os parâmetros
// usados, botão Repetir (volta à tela com os mesmos filtros), variantes salvas, catálogo de códigos e parâmetros.
// Cada pessoa vê as suas emissões; administrador e diretor veem as de todos.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, exportXLSX, today, dateBR, erroTela } from '../lib/ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { numeroEmissao, parametros } from '../lib/relatorio-padrao.js';
import { pedirRepeticao } from '../lib/relatorio-filtros.js';
import { resumoParametros } from '../lib/relatorio-variantes-ui.js';
import { filtrarEmissoes, resumoEmissoes } from '../lib/relatorio-historico.js';

export const title = 'Relatórios emitidos';
const menos = (iso, d) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
const ui = { aba: 'emitidos', de: menos(today(), 30), ate: today(), codigo: '', formato: '', usuario: '', busca: '' };
let D = null;
const gerencia = () => ['admin', 'diretor'].includes(state.papel);
const quando = (t) => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' });
const FORMATO = { pdf: 'PDF', xlsx: 'Excel' };

async function carregar() {
  const e = state.empresa.id;
  const [emissoes, variantes, catalogo, cfg] = await Promise.all([
    fetchAll(() => sb.from('relp_emissoes').select('*').eq('empresa_id', e).gte('emitido_em', ui.de + 'T00:00:00-03:00').lte('emitido_em', ui.ate + 'T23:59:59-03:00').order('numero', { ascending: false })),
    q(sb.from('relp_variantes').select('*').eq('empresa_id', e).order('rota').order('nome')),
    q(sb.from('relp_catalogo').select('*').order('codigo')),
    q(sb.from('relp_config').select('*').eq('empresa_id', e).maybeSingle())]);
  D = { emissoes, variantes, catalogo, cfg: cfg || { registrar: true, meses_historico: 24, variante_publica: 'gerencia', cnpj_cabecalho: true } };
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (err) {
    console.error(err);
    root.innerHTML = /relp_|does not exist|schema cache/.test(err?.message || '') ? '<div class="card"><span class="badge vencido">SQL 174 pendente</span> O histórico de relatórios ainda não foi criado no banco. Os relatórios já saem no padrão novo, sem o número da emissão.</div>' : erroTela('os relatórios emitidos');
    return;
  }
  pintar(root);
}

function pintar(root) {
  const L = filtrarEmissoes(D.emissoes, ui), R = resumoEmissoes(L);
  const rels = [...new Map(D.emissoes.map(x => [x.codigo, x.nome])).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const pessoas = [...new Set(D.emissoes.map(x => x.usuario_nome).filter(Boolean))].sort();
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Relatórios emitidos</h2><div class="muted small">Todo relatório em PDF ou Excel sai com código, número de emissão e os filtros usados. Aqui fica o histórico: confira os parâmetros e repita o relatório com os mesmos filtros.${gerencia() ? '' : ' Você vê as suas emissões.'}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:nowrap">${ui.aba === 'emitidos' ? '<button class="btn ghost" id="re-xls">Excel</button><button class="btn" id="re-pdf">PDF</button>' : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Emissões no período</div><div class="k-value">${R.total}</div><div class="k-sub">${R.pdf} em PDF · ${R.xlsx} em Excel</div></div>
      <div class="kpi"><div class="k-label">Relatórios diferentes</div><div class="k-value">${R.relatorios}</div><div class="k-sub">de ${D.catalogo.length} no catálogo</div></div>
      <div class="kpi"><div class="k-label">Pessoas</div><div class="k-value">${R.pessoas}</div><div class="k-sub">emitiram no período</div></div>
      <div class="kpi"><div class="k-label">Mais emitido</div><div class="k-value" style="font-size:1.05rem">${esc(R.mais?.codigo || '—')}</div><div class="k-sub">${R.mais ? `${esc(R.mais.nome)} · ${R.mais.n} vez(es)` : 'nenhuma emissão'}</div></div>
    </div>
    <div class="toolbar"><div class="chips" id="re-abas" data-rotulo="Aba">${[['emitidos', 'Emitidos'], ['variantes', `Variantes${D.variantes.length ? ' · ' + D.variantes.length : ''}`], ['catalogo', 'Catálogo de códigos'], ...(gerencia() ? [['parametros', 'Parâmetros']] : [])].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      ${ui.aba === 'emitidos' ? `<label>De<input type="date" id="re-de" value="${ui.de}"></label><label>Até<input type="date" id="re-ate" value="${ui.ate}"></label>
      <label>Relatório<select id="re-cod"><option value="">Todos</option>${rels.map(([c, n]) => `<option value="${esc(c)}" ${ui.codigo === c ? 'selected' : ''}>${esc(c)} – ${esc(n)}</option>`).join('')}</select></label>
      <label>Formato<select id="re-fmt"><option value="">Todos</option><option value="pdf" ${ui.formato === 'pdf' ? 'selected' : ''}>PDF</option><option value="xlsx" ${ui.formato === 'xlsx' ? 'selected' : ''}>Excel</option></select></label>
      ${gerencia() ? `<label>Emitido por<select id="re-usu"><option value="">Todos</option>${pessoas.map(p => `<option ${ui.usuario === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
      <input id="re-bus" placeholder="Relatório, código ou parâmetro" value="${esc(ui.busca)}" style="min-width:220px">` : ''}</div>
    <div id="re-corpo"></div>`;
  $('#re-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(root); } };
  const recarrega = async () => { try { await carregar(); pintar(root); } catch (err) { fail(err); } };
  $('#re-de', root) && ($('#re-de', root).onchange = (e) => { if (e.target.value) { ui.de = e.target.value; recarrega(); } });
  $('#re-ate', root) && ($('#re-ate', root).onchange = (e) => { if (e.target.value) { ui.ate = e.target.value; recarrega(); } });
  $('#re-cod', root) && ($('#re-cod', root).onchange = (e) => { ui.codigo = e.target.value; pintar(root); });
  $('#re-fmt', root) && ($('#re-fmt', root).onchange = (e) => { ui.formato = e.target.value; pintar(root); });
  $('#re-usu', root) && ($('#re-usu', root).onchange = (e) => { ui.usuario = e.target.value; pintar(root); });
  let t; $('#re-bus', root) && ($('#re-bus', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.busca = e.target.value; corpo(root, filtrarEmissoes(D.emissoes, ui)); }, 250); });
  $('#re-xls', root) && ($('#re-xls', root).onclick = () => exportXLSX([['Nº', 'Data e hora', 'Código', 'Relatório', 'Formato', 'Tipo', 'Emitido por', 'Parâmetros'],
    ...filtrarEmissoes(D.emissoes, ui).map(x => [x.numero, quando(x.emitido_em), x.codigo, x.nome, FORMATO[x.formato], x.tipo === 'documento' ? 'Documento' : 'Relatório', x.usuario_nome || '', resumoParametros(x.parametros)])], 'relatorios_emitidos'));
  $('#re-pdf', root) && ($('#re-pdf', root).onclick = () => { const X = filtrarEmissoes(D.emissoes, ui);
    abrirRelatorio({ nome: 'Relatórios emitidos', titulo: 'Relatórios emitidos', subtitulo: `Emissões de ${dateBR(ui.de)} a ${dateBR(ui.ate)}`, paisagem: true, tipo: 'relatorio', rodape: 'Fonte: Painéis › Relatórios emitidos.',
      corpo: `<h2>1. Emissões</h2><table><thead><tr><th>Nº</th><th>Data e hora</th><th>Código</th><th>Relatório</th><th>Formato</th><th>Emitido por</th><th>Parâmetros</th></tr></thead><tbody>
        ${X.map(x => `<tr><td>${numeroEmissao(x.numero)}</td><td>${quando(x.emitido_em)}</td><td>${esc(x.codigo)}</td><td>${esc(x.nome)}</td><td>${FORMATO[x.formato]}</td><td>${esc(x.usuario_nome || '')}</td><td>${esc(resumoParametros(x.parametros))}</td></tr>`).join('')}
        <tr class="tot"><td colspan="7">${X.length} emissão(ões)</td></tr></tbody></table>` }); });
  corpo(root, L);
}

function corpo(root, L) {
  const c = $('#re-corpo', root);
  if (ui.aba === 'variantes') return abaVariantes(root, c);
  if (ui.aba === 'catalogo') return abaCatalogo(c);
  if (ui.aba === 'parametros') return abaParametros(root, c);
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:62vh"><table><thead><tr><th class="num">Nº</th><th>Data e hora</th><th>Código</th><th>Relatório</th><th>Formato</th><th>Emitido por</th><th>Parâmetros</th><th></th></tr></thead><tbody>
    ${L.slice(0, 1000).map(x => `<tr class="clickable" data-id="${x.id}"><td class="num">${numeroEmissao(x.numero)}</td><td>${quando(x.emitido_em)}</td><td>${esc(x.codigo)}</td><td class="wrap">${esc(x.nome)}${x.tipo === 'documento' ? ' <span class="badge">documento</span>' : ''}</td>
      <td>${FORMATO[x.formato]}</td><td class="small">${esc(x.usuario_nome || '')}</td><td class="small wrap">${esc(resumoParametros(x.parametros, 4)) || '<span class="muted">—</span>'}</td>
      <td>${podeRepetir(x) ? `<button class="btn small" data-rep="${x.id}">Repetir</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">Nenhuma emissão neste filtro. Emita um relatório em qualquer tela (botão PDF, Imprimir ou Excel) e ele aparece aqui.</td></tr>'}
    </tbody></table></div></div><p class="small muted">${L.length} emissão(ões)${L.length > 1000 ? ' · mostrando as 1.000 mais recentes' : ''}. Clique na linha para ver todos os parâmetros. O histórico guarda ${D.cfg.meses_historico} meses.</p>`;
  $$('tr[data-id]', c).forEach(tr => tr.onclick = (e) => { const x = D.emissoes.find(y => y.id === tr.dataset.id); if (e.target.closest('[data-rep]')) return repetir(x); detalhe(x); });
}
const podeRepetir = (x) => x.tipo === 'relatorio' && x.rota && x.filtros?.c;
function repetir(x) {
  pedirRepeticao(x.rota, x.filtros, { rotulo: `Filtros da emissão nº ${numeroEmissao(x.numero)} aplicados` });
  location.hash = '#/' + x.rota;
}

function detalhe(x) {
  const P = parametros(x.parametros);
  const m = modal({ title: `Emissão nº ${numeroEmissao(x.numero)} — ${x.codigo}`, body: `
    <div class="grid-form small"><div><span class="muted">Relatório</span><div>${esc(x.nome)}</div></div><div><span class="muted">Formato</span><div>${FORMATO[x.formato]}</div></div>
      <div><span class="muted">Emitido por</span><div>${esc(x.usuario_nome || '')}</div></div><div><span class="muted">Data e hora</span><div>${quando(x.emitido_em)}</div></div></div>
    <h3 style="margin:14px 0 6px">Parâmetros do relatório</h3>
    ${P.length ? `<div class="table-wrap"><table><tbody>${P.map(([r, v]) => `<tr><td><b>${esc(r)}</b></td><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="small muted">${x.tipo === 'documento' ? 'Documento (pedido, ordem, laudo…): não tem filtros. Para emitir de novo, abra o registro na tela de origem.' : 'Emitido sem filtros.'}</p>`}`,
    foot: `${x.rota ? `<a class="btn ghost" href="#/${esc(x.rota)}" data-close>Abrir a tela</a>` : ''}<span class="spacer"></span><button class="btn" data-close>Fechar</button>${podeRepetir(x) ? '<button class="btn" id="de-var">Salvar como variante</button><button class="btn primary" id="de-rep">Repetir</button>' : ''}` });
  $('#de-rep', m.el) && ($('#de-rep', m.el).onclick = () => { m.close(); repetir(x); });
  $('#de-var', m.el) && ($('#de-var', m.el).onclick = () => {
    const mv = modal({ title: 'Salvar como variante', narrow: true, body: `<label>Nome da variante<input id="sv-nome" maxlength="60" placeholder="ex.: Mensal – todos os locais"></label>
      <p class="small muted">Os filtros desta emissão ficam salvos na tela de origem (botão Filtros salvos).</p>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="sv-ok">Salvar</button>' });
    $('#sv-ok', mv.el).onclick = async () => {
      const nome = $('#sv-nome', mv.el).value.trim(); if (nome.length < 2) return toast('Dê um nome à variante', true);
      try { await q(sb.rpc('relp_variante_salvar', { p_empresa: state.empresa.id, p_id: null, p_tela: x.tela, p_rota: x.rota, p_nome: nome, p_filtros: x.filtros, p_parametros: (x.parametros || []).filter(([r]) => r !== 'Ano de trabalho' && r !== 'Variante'), p_publica: false }));
        toast('Variante salva'); mv.close(); m.close(); await carregar(); pintar(document.querySelector('#page')); } catch (err) { fail(err); }
    };
  });
}

function abaVariantes(root, c) {
  c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Tela</th><th>Variante</th><th>Filtros</th><th>De quem</th><th>Atualizada</th><th></th></tr></thead><tbody>
    ${D.variantes.map(v => `<tr><td>${esc(v.tela)} <span class="small muted">${esc(v.rota)}</span></td><td><b>${esc(v.nome)}</b>${v.publica ? ' <span class="badge">da empresa</span>' : ''}</td><td class="small wrap">${esc(resumoParametros(v.parametros, 6))}</td>
      <td class="small">${esc(v.usuario_nome || '')}</td><td class="small">${quando(v.atualizado_em)}</td>
      <td style="white-space:nowrap"><button class="btn small" data-ap="${v.id}">Aplicar</button>${v.usuario_id === state.user.id || gerencia() ? ` <button class="btn small ghost" data-del="${v.id}" title="Excluir">✕</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nenhuma variante. Em qualquer tela, escolha os filtros e use o botão <b>Filtros salvos</b>, no alto, para guardar com um nome.</td></tr>'}
    </tbody></table></div></div><p class="small muted">Variante é um conjunto de filtros com nome. "Da empresa" aparece para todos; as demais, só para quem criou.</p>`;
  $$('[data-ap]', c).forEach(b => b.onclick = () => { const v = D.variantes.find(x => x.id === b.dataset.ap); pedirRepeticao(v.rota, v.filtros, { nome: v.nome, rotulo: `Variante "${v.nome}" aplicada` }); location.hash = '#/' + v.rota; });
  $$('[data-del]', c).forEach(b => b.onclick = async () => { if (!await confirmDialog('Excluir esta variante?')) return;
    try { await q(sb.rpc('relp_variante_excluir', { p_id: b.dataset.del })); toast('Variante excluída'); await carregar(); pintar(root); } catch (err) { fail(err); } });
}

function abaCatalogo(c) {
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:62vh"><table><thead><tr><th>Código</th><th>Relatório</th><th>Tela</th><th>Onde fica</th></tr></thead><tbody>
    ${D.catalogo.map(x => `<tr><td><b>${esc(x.codigo)}</b></td><td>${esc(x.nome)}</td><td>${esc(x.tela)}</td><td>${x.rota ? `<a href="#/${esc(x.rota)}">${esc(x.rota)}</a>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">O catálogo se forma sozinho: cada relatório ganha o seu código na primeira emissão.</td></tr>'}
    </tbody></table></div></div><p class="small muted">O código é o da tela mais um número de ordem (R01, R02…). Nasce na primeira emissão e não muda mais.</p>`;
}

function abaParametros(root, c) {
  const g = D.cfg;
  c.innerHTML = `<div class="card" style="max-width:720px"><h2 style="margin-top:0">Parâmetros dos relatórios</h2>
    <div class="grid-form">
      <label class="full" style="grid-column:1/-1;display:flex;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="pa-reg" style="width:auto;margin:0" ${g.registrar ? 'checked' : ''}> Registrar cada emissão no histórico (desligado: o relatório sai sem número de emissão e não pode ser repetido por aqui)</label>
      <label>Guardar o histórico por (meses)<input type="number" id="pa-meses" min="1" max="120" value="${g.meses_historico}"></label>
      <label>Quem publica variante para a empresa<select id="pa-pub"><option value="gerencia" ${g.variante_publica === 'gerencia' ? 'selected' : ''}>Administrador e diretor</option><option value="todos" ${g.variante_publica === 'todos' ? 'selected' : ''}>Qualquer pessoa</option></select></label>
      <label class="full" style="grid-column:1/-1;display:flex;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="pa-cnpj" style="width:auto;margin:0" ${g.cnpj_cabecalho ? 'checked' : ''}> Mostrar o CNPJ abaixo do nome da empresa no cabeçalho</label>
    </div>
    <p class="small muted">O nome da empresa no cabeçalho vem de Cadastros › Empresa. O leiaute (preto, sem logotipo, filtros impressos) é o padrão da plataforma e vale para todos os relatórios.</p>
    <button class="btn primary" id="pa-ok">Salvar</button></div>`;
  $('#pa-ok', c).onclick = async (ev) => {
    ev.target.disabled = true;
    try { await q(sb.rpc('relp_config_salvar', { p_empresa: state.empresa.id, p_registrar: $('#pa-reg', c).checked, p_meses: +$('#pa-meses', c).value, p_variante_publica: $('#pa-pub', c).value, p_cnpj: $('#pa-cnpj', c).checked }));
      toast('Parâmetros salvos'); await carregar(); pintar(root); } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

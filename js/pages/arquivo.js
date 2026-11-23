// Cadastros › Arquivo Morto (CAD015) — SQL 194, 22/11/2026 (Renan: organizar os arquivos mortos do administrativo, financeiro,
// fiscal/contábil e RH, junto com o almoxarifado, a partir de 01/12). Caixas-arquivo numeradas e etiquetadas em estantes, com o
// conteúdo por tipo de documento e período; retirada e devolução; prazo de guarda por tipo (sugestão até ser confirmado) e
// descarte com proposta, aprovação por outra pessoa, execução e termo.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, dateBR, today, exportXLSX } from '../lib/ui.js';
import { AREAS_ARQ, periodoCaixa, guardaCaixa, codigoEtiqueta, estantes, codigosEndereco, numPasta } from '../lib/etiquetas.js';
import { imprimirCaixas, imprimirEnderecos, imprimirPastas } from '../lib/etiquetas-ui.js';
import { aoLer } from '../lib/leitura-ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';

export const title = 'Arquivo Morto';
const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['compras', 'Compras'], ['producao', 'Produção'], ['vendas', 'Vendas'], ['leitura', 'Leitura']];
const CFG0 = { papeis_gestor: ['admin', 'financeiro', 'diretor'], arquivistas: [], papeis_consulta: ['admin', 'financeiro', 'diretor', 'compras'], papeis_descarte: ['admin', 'diretor'], emprestimo_dias: 7, descarte_suspenso: false };
const FORMAS = { fragmentacao: 'Fragmentação (picotadora)', reciclagem: 'Entrega para reciclagem', incineracao: 'Incineração', empresa_especializada: 'Empresa especializada (com certificado)' };
const SIT = { arquivada: ['Arquivada', 'pago'], emprestada: ['Retirada', 'negoc'], descartada: ['Descartada', ''] };
const SITD = { proposto: ['Proposto', 'aberto'], aprovado: ['Aprovado', 'negoc'], recusado: ['Recusado', 'vencido'], executado: ['Executado', 'pago'], cancelado: ['Cancelado', ''] };
const badge = (m, k) => `<span class="badge ${m[k]?.[1] || ''}">${m[k]?.[0] || k}</span>`;
const n4 = (n) => String(n).padStart(4, '0');
let D = null;
const ui = { aba: 'caixas', busca: '', area: '', ano: '', sit: 'ativas', sel: new Set(), sala: '' };

export async function render(root) {
  const par = new URLSearchParams(location.hash.split('?')[1] || '');
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id;
    const [cfg, gestor, aprova, consulta] = await Promise.all([q(sb.from('arq_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.rpc('_arq_gestor', { p_empresa: e })), q(sb.rpc('_arq_aprova', { p_empresa: e })), q(sb.rpc('_arq_consulta', { p_empresa: e }))]);
    if (!consulta) { root.innerHTML = '<div class="card"><div class="empty">Seu perfil não consulta o arquivo morto. O administrador libera em Arquivo Morto › Parâmetros.</div></div>'; return; }
    const [tipos, locais, ends, caixas, itens, emps] = await Promise.all([
      q(sb.from('arq_tipos').select('*').eq('empresa_id', e).order('area').order('nome')),
      q(sb.from('arq_locais').select('*').eq('empresa_id', e).order('nome')),
      fetchAll(() => sb.from('arq_enderecos').select('*').eq('empresa_id', e).order('ordem')),
      fetchAll(() => sb.from('arq_caixas').select('*').eq('empresa_id', e).order('numero')),
      fetchAll(() => sb.from('arq_itens').select('caixa_id,tipo_id,descricao,inicio,fim,ordem').eq('empresa_id', e)),
      q(sb.from('arq_emprestimos').select('*').eq('empresa_id', e).order('pedido_em', { ascending: false, nullsFirst: false }).limit(300))]);
    // pastas e digitalização (SQL 195); sem o SQL, a tela funciona sem elas
    const [pastas, arqs] = await Promise.all([fetchAll(() => sb.from('arq_pastas').select('*').eq('empresa_id', e).order('numero')).catch(() => null),
      fetchAll(() => sb.from('arq_arquivos').select('*').eq('empresa_id', e).order('enviado_em')).catch(() => [])]);
    D = { cfg: { ...CFG0, ...(cfg || {}) }, gestor, aprova, tipos, tipo: Object.fromEntries(tipos.map(t => [t.id, t])), locais, loc: Object.fromEntries(locais.map(l => [l.id, l])),
      ends, end: Object.fromEntries(ends.map(x => [x.id, x])), caixas, cx: Object.fromEntries(caixas.map(c => [c.id, c])), itens, emps, root,
      pastas: pastas || [], temPastas: pastas !== null, arqs };
    D.pastasDe = (id) => D.pastas.filter(p => p.caixa_id === id).sort((a, b) => a.numero - b.numero);
    D.arqsDe = (id) => D.arqs.filter(a => a.pasta_id === id);
    D.itensDe = (id) => D.itens.filter(i => i.caixa_id === id).sort((a, b) => a.ordem - b.ordem);
    if (!ui.sala) ui.sala = locais.find(l => l.ativo)?.id || '';
    // primeira vez: quem cuida do arquivo já recebe os tipos de documento com prazo SUGERIDO (o descarte continua travado até confirmar)
    if (gestor && !tipos.length) {
      try { const k = await q(sb.rpc('arq_configurar', { p_empresa: e })); if (k) { tipos.push(...await q(sb.from('arq_tipos').select('*').eq('empresa_id', e).order('area').order('nome')));
        D.tipo = Object.fromEntries(tipos.map(t => [t.id, t])); toast(`${k} tipos de documento preparados, com prazo de guarda sugerido (confirme em Tipos e prazos)`); } }
      catch (err) { fail(err); }
    }
    const etq = codigoEtiqueta(par.get('etq'));
    if (etq?.alvo === 'caixa') { const c = caixas.find(x => x.etiqueta === etq.codigo); history.replaceState(null, '', '#/arquivo'); pintar(root); return c ? ficha(c) : toast(`Etiqueta ${etq.codigo}: caixa não encontrada ou sem acesso.`, true); }
    if (etq?.alvo === 'pasta') { const pa = D.pastas.find(x => x.etiqueta === etq.codigo); history.replaceState(null, '', '#/arquivo'); pintar(root); return pa ? pasta(pa) : toast(`Etiqueta ${etq.codigo}: pasta não encontrada ou sem acesso.`, true); }
    if (etq?.alvo === 'arq_endereco') { const x = ends.find(y => y.etiqueta === etq.codigo); history.replaceState(null, '', '#/arquivo'); if (x) { ui.aba = 'enderecos'; ui.sala = x.local_id; ui.endAtual = x.id; } else toast(`Etiqueta ${etq.codigo}: prateleira não encontrada.`, true); }
    pintar(root);
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 194 já foi executado.</div></div>'; }
}
const recarregar = () => render(D.root);
const endTxt = (id) => { const x = D.end[id]; return x ? `${D.loc[x.local_id]?.nome || ''} · ${x.codigo}` : ''; };

function pintar(root) {
  const pend = D.emps.filter(x => x.situacao === 'pedido').length, fora = D.emps.filter(x => x.situacao === 'retirada'), atras = fora.filter(x => x.previsto < today()).length;
  const abas = [['caixas', `Caixas (${D.caixas.filter(c => c.situacao !== 'descartada').length})`], ['retiradas', `Retiradas${pend + fora.length ? ` · ${pend + fora.length}` : ''}`],
    ...(D.gestor || D.aprova ? [['descarte', 'Descarte']] : []), ['enderecos', 'Salas e endereços'], ['tipos', 'Tipos e prazos'], ...(state.papel === 'admin' ? [['parametros', 'Parâmetros']] : [])];
  if (!abas.some(a => a[0] === ui.aba)) ui.aba = 'caixas';
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Arquivo Morto</h2><div class="muted small">Caixas-arquivo do administrativo, financeiro, fiscal, contábil e RH: onde está cada documento, quem levou e até quando guardar.</div></div></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Caixas arquivadas</div><div class="k-value">${D.caixas.filter(c => c.situacao === 'arquivada').length}</div><div class="k-sub">${D.caixas.filter(c => c.situacao !== 'descartada' && !c.endereco_id).length} sem endereço</div></div>
      <div class="kpi"><div class="k-label">Fora do arquivo</div><div class="k-value ${atras ? 'warn' : ''}">${fora.length}</div><div class="k-sub">${atras ? `${atras} com devolução atrasada` : 'nenhuma atrasada'}</div></div>
      <div class="kpi"><div class="k-label">Pedidos de caixa</div><div class="k-value">${pend}</div><div class="k-sub">aguardando a retirada</div></div>
      <div class="kpi"><div class="k-label">Podem ser descartadas</div><div class="k-value">${D.caixas.filter(c => c.situacao === 'arquivada' && c.descartar_em && c.descartar_em <= today() && !c.prazo_pendente && !c.reter).length}</div><div class="k-sub">${D.cfg.descarte_suspenso ? 'descarte suspenso' : 'prazo de guarda vencido'}</div></div>
    </div>
    ${D.tipos.some(t => !t.prazo_confirmado && t.prazo_anos != null) ? `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">${D.tipos.filter(t => !t.prazo_confirmado && t.prazo_anos != null).length} tipo(s) de documento com prazo de guarda <b>sugerido</b>, ainda não confirmado. Caixa com esses documentos não entra no descarte até a contabilidade (ou o jurídico) confirmar o prazo em Tipos e prazos.</div>` : ''}
    <div class="chips" id="ar-abas" style="margin:4px 0 10px">${abas.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div><div id="ar-corpo"></div>`;
  $('#ar-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(root); } };
  const c = $('#ar-corpo', root);
  ({ caixas: abaCaixas, retiradas: abaRetiradas, descarte: abaDescarte, enderecos: abaEnderecos, tipos: abaTipos, parametros: abaParametros })[ui.aba](c);
}

// ------------------------------------------------------------ caixas: busca, cadastro, etiquetas
function filtradas() {
  const t = ui.busca.trim().toUpperCase(), ano = +ui.ano;
  return D.caixas.filter(c => (ui.sit === 'todas' || (ui.sit === 'ativas' ? c.situacao !== 'descartada' : ui.sit === 'semend' ? c.situacao !== 'descartada' && !c.endereco_id : c.situacao === ui.sit))
    && (!ui.area || c.area === ui.area)
    && (!ano || D.itensDe(c.id).some(i => +i.inicio.slice(0, 4) <= ano && +i.fim.slice(0, 4) >= ano))
    && (!t || String(c.numero) === t.replace(/^0+/, '') || [c.titulo, c.setor, c.etiqueta, ...D.itensDe(c.id).map(i => `${i.descricao || ''} ${D.tipo[i.tipo_id]?.nome || ''}`), ...D.pastasDe(c.id).map(p => `${p.titulo} ${p.descricao || ''} ${p.etiqueta}`)].join(' ').toUpperCase().includes(t)));
}
function abaCaixas(c) {
  const L = filtradas(), anos = [...new Set(D.itens.flatMap(i => { const a = []; for (let y = +i.inicio.slice(0, 4); y <= +i.fim.slice(0, 4) && a.length < 80; y++) a.push(y); return a; }))].sort((a, b) => b - a);
  c.innerHTML = `<div class="card" style="margin-bottom:12px"><div style="display:grid;grid-template-columns:minmax(0,2.2fr) repeat(3,minmax(0,1fr));gap:10px">
      <label>Procurar<input id="cx-b" value="${esc(ui.busca)}" placeholder="número, título, setor ou documento (ex.: rescisão, nota de entrada)"></label>
      <label>Área<select id="cx-a"><option value="">Todas</option>${Object.entries(AREAS_ARQ).map(([k, v]) => `<option value="${k}" ${ui.area === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Ano do documento<select id="cx-y"><option value="">Todos</option>${anos.map(y => `<option ${+ui.ano === y ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <label>Situação<select id="cx-s">${[['ativas', 'No arquivo ou retiradas'], ['arquivada', 'Arquivadas'], ['emprestada', 'Retiradas'], ['semend', 'Sem endereço'], ['descartada', 'Descartadas'], ['todas', 'Todas']].map(([k, v]) => `<option value="${k}" ${ui.sit === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${D.gestor ? '<button class="btn primary" id="cx-novo">Nova caixa</button>' : ''}
      <button class="btn" id="cx-etq">Etiquetas${ui.sel.size ? ` (${ui.sel.size})` : ' das mostradas'}</button>${D.gestor ? '<button class="btn" id="cx-mv">Guardar os marcados em…</button>' : ''}
      <button class="btn ghost" id="cx-xls">Excel</button><button class="btn ghost" id="cx-rel">Relação (PDF)</button><span class="spacer"></span><span class="small muted">${L.length} caixa(s)</span></div>
    ${D.tipos.length ? '' : `<p class="small" style="color:var(--warn);margin-bottom:0">Ainda não há tipos de documento. ${D.gestor ? 'Abra a aba Tipos e prazos e use Preparar os tipos sugeridos.' : 'Peça a quem cuida do arquivo.'}</p>`}</div>
    <div class="card flush"><div class="table-wrap"><table id="cx-tab"><thead><tr><th style="width:28px"><input type="checkbox" id="cx-all"></th><th>Nº</th><th>Área</th><th>Título</th><th>Período</th><th>Endereço</th><th>Guarda</th><th>Situação</th></tr></thead><tbody>
    ${L.slice(0, 800).map(x => `<tr data-c="${x.id}" style="cursor:pointer"><td><input type="checkbox" data-s="${x.id}" ${ui.sel.has(x.id) ? 'checked' : ''}></td><td><b>${n4(x.numero)}</b></td><td>${esc(AREAS_ARQ[x.area])}${x.setor ? `<div class="small muted">${esc(x.setor)}</div>` : ''}</td>
      <td class="wrap">${esc(x.titulo)}${x.reter ? ' <span class="badge vencido" title="' + esc(x.reter_motivo || '') + '">retida</span>' : ''}</td><td>${esc(periodoCaixa(x.periodo_inicio, x.periodo_fim))}</td>
      <td>${x.endereco_id ? esc(endTxt(x.endereco_id)) : '<span class="muted">—</span>'}</td><td class="small">${esc(guardaCaixa(x))}</td><td>${badge(SIT, x.situacao)}</td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">Nenhuma caixa. Use Nova caixa para registrar a primeira: área, título, endereço e o que tem dentro.</td></tr>'}</tbody></table></div></div>`;
  const rp = () => abaCaixas(c), deb = (f) => { clearTimeout(ui.t); ui.t = setTimeout(f, 300); };
  $('#cx-b', c).oninput = (ev) => deb(() => { ui.busca = ev.target.value; rp(); const i = $('#cx-b', c); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  $('#cx-a', c).onchange = (ev) => { ui.area = ev.target.value; rp(); }; $('#cx-y', c).onchange = (ev) => { ui.ano = ev.target.value; rp(); }; $('#cx-s', c).onchange = (ev) => { ui.sit = ev.target.value; rp(); };
  $('#cx-all', c).onchange = (ev) => { L.forEach(x => ev.target.checked ? ui.sel.add(x.id) : ui.sel.delete(x.id)); rp(); };
  $$('[data-s]', c).forEach(b => b.onclick = (ev) => { ev.stopPropagation(); b.checked ? ui.sel.add(b.dataset.s) : ui.sel.delete(b.dataset.s); $('#cx-etq', c).textContent = `Etiquetas${ui.sel.size ? ` (${ui.sel.size})` : ' das mostradas'}`; });
  $$('[data-c]', c).forEach(tr => tr.onclick = () => ficha(D.cx[tr.dataset.c]));
  $('#cx-novo', c) && ($('#cx-novo', c).onclick = () => editar(null));
  $('#cx-etq', c).onclick = () => imprimirCaixas((ui.sel.size ? D.caixas.filter(x => ui.sel.has(x.id)) : L).filter(x => x.situacao !== 'descartada')
    .map(x => ({ ...x, endereco: D.end[x.endereco_id]?.codigo, local: D.loc[D.end[x.endereco_id]?.local_id]?.nome })));
  $('#cx-mv', c) && ($('#cx-mv', c).onclick = () => mover([...ui.sel]));
  $('#cx-xls', c).onclick = () => exportXLSX($('#cx-tab', c), 'arquivo_morto');
  $('#cx-rel', c).onclick = () => relacao(L);
}

function relacao(L) {
  abrirRelatorio({ nome: 'Arquivo morto — relação de caixas', titulo: 'Arquivo morto — relação de caixas', paisagem: true, subtitulo: `${L.length} caixa(s)`,
    corpo: `<table><thead><tr><th>Nº</th><th>Área</th><th>Título</th><th>Conteúdo</th><th>Período</th><th>Endereço</th><th>Guarda</th><th>Situação</th></tr></thead><tbody>
      ${L.map(x => `<tr><td>${n4(x.numero)}</td><td>${esc(AREAS_ARQ[x.area])}${x.setor ? ' · ' + esc(x.setor) : ''}</td><td>${esc(x.titulo)}</td>
        <td>${D.itensDe(x.id).map(i => `${esc(D.tipo[i.tipo_id]?.nome || '')}${i.descricao ? ' — ' + esc(i.descricao) : ''} (${esc(periodoCaixa(i.inicio, i.fim))})`).join('<br>')}</td>
        <td>${esc(periodoCaixa(x.periodo_inicio, x.periodo_fim))}</td><td>${esc(endTxt(x.endereco_id))}</td><td>${esc(guardaCaixa(x))}</td><td>${SIT[x.situacao][0]}</td></tr>`).join('')}</tbody></table>`,
    tipo: 'relatorio', parametros: [['Procurar', ui.busca || '—'], ['Área', AREAS_ARQ[ui.area] || 'Todas'], ['Ano', ui.ano || 'Todos']] });
}

function ficha(x) {
  if (!x) return;
  const its = D.itensDe(x.id), hist = D.emps.filter(e => e.caixa_id === x.id), aberto = hist.find(e => e.situacao === 'retirada'), meuPedido = hist.find(e => e.situacao === 'pedido' && e.pedido_por === state.user.id);
  const m = modal({ title: `Caixa ${n4(x.numero)} — ${x.titulo}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Área</span><div><b>${esc(AREAS_ARQ[x.area])}</b>${x.setor ? ' · ' + esc(x.setor) : ''}</div></div>
      <div><span class="muted">Endereço</span><div><b>${esc(endTxt(x.endereco_id) || 'sem endereço')}</b></div></div>
      <div><span class="muted">Situação</span><div>${badge(SIT, x.situacao)}${aberto ? ` com ${esc(aberto.para_nome)}, devolver até ${dateBR(aberto.previsto)}` : ''}</div></div>
      <div><span class="muted">Guarda</span><div>${esc(guardaCaixa(x))}${x.reter ? `<div style="color:var(--warn)">Retida: ${esc(x.reter_motivo || '')}</div>` : ''}</div></div>
      <div><span class="muted">Etiqueta</span><div style="font-family:monospace">${esc(x.etiqueta)}</div></div>${x.observacao ? `<div class="span2"><span class="muted">Observação</span><div>${esc(x.observacao)}</div></div>` : ''}</div>
    <h3 style="margin:14px 0 6px">Conteúdo</h3>
    <div class="table-wrap"><table class="small"><thead><tr><th>Documento</th><th>Descrição</th><th>Período</th><th>Prazo</th></tr></thead><tbody>
    ${its.map(i => { const t = D.tipo[i.tipo_id] || {}; return `<tr><td>${esc(t.nome || '')}</td><td>${esc(i.descricao || '')}</td><td>${esc(periodoCaixa(i.inicio, i.fim))}</td><td>${t.prazo_anos == null ? 'permanente' : `${t.prazo_anos} anos${t.prazo_confirmado ? '' : ' <span class="badge aberto">sugerido</span>'}`}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">Sem conteúdo registrado.</td></tr>'}</tbody></table></div>
    ${D.temPastas ? `<div style="display:flex;align-items:center;gap:8px;margin:14px 0 6px"><h3 style="margin:0">Pastas</h3><span class="spacer"></span>
      ${D.gestor && x.situacao !== 'descartada' ? '<button class="btn small" id="fc-np">Nova pasta</button>' : ''}${D.pastasDe(x.id).length ? '<button class="btn ghost small" id="fc-ep">Etiquetas das pastas</button>' : ''}</div>
    <div class="table-wrap"><table class="small"><thead><tr><th>Pasta</th><th>Título</th><th>Período</th><th class="num">PDFs</th></tr></thead><tbody>
    ${D.pastasDe(x.id).map(p => `<tr data-pa="${p.id}" style="cursor:pointer"><td><b>${numPasta(x.numero, p.numero)}</b></td><td>${esc(p.titulo)}</td><td>${esc(periodoCaixa(p.inicio, p.fim))}</td><td class="num">${D.arqsDe(p.id).length || ''}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">Nenhuma pasta. Cada pasta ganha a sua etiqueta e pode ter os PDFs digitalizados.</td></tr>'}</tbody></table></div>` : ''}
    ${hist.length ? `<h3 style="margin:14px 0 6px">Retiradas</h3><div class="table-wrap"><table class="small"><thead><tr><th>Situação</th><th>Quem levou / pediu</th><th>Motivo</th><th>Retirada</th><th>Devolver até</th><th>Devolvida</th></tr></thead><tbody>
      ${hist.map(e => `<tr><td>${esc({ pedido: 'Pedido', retirada: 'Fora', devolvida: 'Devolvida', cancelado: 'Cancelado' }[e.situacao])}</td><td>${esc(e.para_nome || e.pedido_nome || '')}</td><td class="wrap">${esc(e.motivo || '')}</td>
        <td>${e.retirado_em ? dateBR(e.retirado_em) : ''}</td><td>${e.previsto ? dateBR(e.previsto) : ''}</td><td>${e.devolvido_em ? dateBR(e.devolvido_em) : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
    foot: `<button class="btn" id="fc-etq">Etiqueta</button>${D.gestor && x.situacao !== 'descartada' ? '<button class="btn" id="fc-ed">Editar</button>' : ''}<span class="spacer"></span>
      ${x.situacao === 'arquivada' && !meuPedido && !D.gestor ? '<button class="btn primary" id="fc-ped">Pedir esta caixa</button>' : ''}
      ${D.gestor && x.situacao === 'arquivada' ? '<button class="btn primary" id="fc-ret">Registrar retirada</button>' : ''}${D.gestor && aberto ? '<button class="btn primary" id="fc-dev">Registrar devolução</button>' : ''}<button class="btn" data-close>Fechar</button>` });
  $('#fc-np', m.el) && ($('#fc-np', m.el).onclick = () => { m.close(); editarPasta(null, x); });
  $('#fc-ep', m.el) && ($('#fc-ep', m.el).onclick = () => imprimirPastas(D.pastasDe(x.id).map(p => ({ ...p, caixa_numero: x.numero })), tamPasta()));
  $$('[data-pa]', m.el).forEach(tr => tr.onclick = () => { m.close(); pasta(D.pastas.find(p => p.id === tr.dataset.pa)); });
  $('#fc-etq', m.el).onclick = () => imprimirCaixas([{ ...x, endereco: D.end[x.endereco_id]?.codigo, local: D.loc[D.end[x.endereco_id]?.local_id]?.nome }]);
  $('#fc-ed', m.el) && ($('#fc-ed', m.el).onclick = () => { m.close(); editar(x); });
  $('#fc-ped', m.el) && ($('#fc-ped', m.el).onclick = async () => { const mot = (prompt('Para que precisa da caixa?') || '').trim(); if (!mot) return;
    try { await q(sb.rpc('arq_emp_pedir', { p_caixa: x.id, p_motivo: mot })); m.close(); toast('Pedido registrado: quem cuida do arquivo vai separar a caixa'); recarregar(); } catch (err) { fail(err); } });
  $('#fc-ret', m.el) && ($('#fc-ret', m.el).onclick = () => { m.close(); retirar(x, [...hist].reverse().find(e => e.situacao === 'pedido') || null); });   // atende o pedido mais antigo, se houver
  $('#fc-dev', m.el) && ($('#fc-dev', m.el).onclick = async () => { try { await q(sb.rpc('arq_emp_devolver', { p_emprestimo: aberto.id })); m.close(); toast(`Caixa ${n4(x.numero)} devolvida. Guarde em ${endTxt(x.endereco_id) || 'um endereço'}.`); recarregar(); } catch (err) { fail(err); } });
}

// ------------------------------------------------------------ pastas e digitalização (SQL 195)
const tamPasta = () => ({ largura_mm: D.cfg.pasta_largura_mm || 70, altura_mm: D.cfg.pasta_altura_mm || 35 });
const kb = (n) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function pasta(pa) {
  if (!pa) return;
  const x = D.cx[pa.caixa_id] || {}, A = D.arqsDe(pa.id), pode = D.gestor && x.situacao !== 'descartada';
  const m = modal({ title: `Pasta ${numPasta(x.numero, pa.numero)} — ${pa.titulo}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Caixa</span><div><b>${String(x.numero).padStart(4, '0')}</b> ${esc(x.titulo || '')}</div></div>
      <div><span class="muted">Onde está</span><div>${esc(endTxt(x.endereco_id) || 'sem endereço')}${x.situacao === 'emprestada' ? ' · caixa retirada' : ''}</div></div>
      <div><span class="muted">Documento</span><div>${esc(D.tipo[pa.tipo_id]?.nome || '—')}</div></div><div><span class="muted">Período</span><div>${esc(periodoCaixa(pa.inicio, pa.fim) || '—')}</div></div>
      <div><span class="muted">Etiqueta</span><div style="font-family:monospace">${esc(pa.etiqueta)}</div></div>${pa.descricao ? `<div class="span2"><span class="muted">Descrição</span><div>${esc(pa.descricao)}</div></div>` : ''}</div>
    <div style="display:flex;align-items:center;gap:8px;margin:14px 0 6px"><h3 style="margin:0">Digitalização (${A.length})</h3><span class="spacer"></span>
      ${pode ? '<label class="btn primary small" style="margin:0;cursor:pointer">Enviar PDFs<input type="file" id="pa-up" accept="application/pdf,.pdf" multiple hidden></label>' : ''}</div>
    <div id="pa-prog" class="small"></div>
    <div class="table-wrap"><table class="small"><thead><tr><th>Arquivo</th><th class="num">Tamanho</th><th>Enviado</th><th></th></tr></thead><tbody>
    ${A.map(a => `<tr><td><a href="#" data-ab="${a.id}">${esc(a.nome)}</a></td><td class="num">${kb(a.tamanho)}</td><td>${esc(a.enviado_nome || '')} <span class="muted">${dateBR(a.enviado_em)}</span></td>
      <td style="white-space:nowrap"><button class="btn ghost small" data-ab="${a.id}">Abrir</button>${D.gestor ? ` <button class="btn ghost small" data-ap="${a.id}">Apagar</button>` : ''}</td></tr>`).join('')
      || `<tr><td colspan="4" class="empty">${pode ? 'Nenhum PDF ainda. Digitalize as folhas da pasta no scanner e use Enviar PDFs (pode escolher vários de uma vez, até 50 MB cada).' : 'Nenhum PDF.'}</td></tr>`}</tbody></table></div>
    <p class="small muted">A digitalização é para consulta: o papel continua guardado até o prazo de guarda da caixa.</p>`,
    foot: `<button class="btn" id="pa-etq">Etiqueta</button>${pode ? '<button class="btn" id="pa-ed">Editar</button>' : ''}${pode && !A.length ? '<button class="btn ghost" id="pa-ex">Excluir a pasta</button>' : ''}<span class="spacer"></span>
      <button class="btn" id="pa-cx">Ver a caixa</button><button class="btn" data-close>Fechar</button>` });
  $('#pa-etq', m.el).onclick = () => imprimirPastas([{ ...pa, caixa_numero: x.numero }], tamPasta());
  $('#pa-cx', m.el).onclick = () => { m.close(); ficha(x); };
  $('#pa-ed', m.el) && ($('#pa-ed', m.el).onclick = () => { m.close(); editarPasta(pa, x); });
  $('#pa-ex', m.el) && ($('#pa-ex', m.el).onclick = async () => { if (!confirm('Excluir esta pasta? A etiqueta dela deixa de valer.')) return;
    try { await q(sb.rpc('arq_pasta_excluir', { p_pasta: pa.id })); m.close(); toast('Pasta excluída'); recarregar(); } catch (err) { fail(err); } });
  $$('[data-ab]', m.el).forEach(b => b.onclick = async (ev) => { ev.preventDefault(); const a = A.find(y => y.id === b.dataset.ab);
    const w = window.open('', '_blank'); const { data, error } = await sb.storage.from('arquivo').createSignedUrl(a.caminho, 600);
    if (error) { w?.close(); return fail(error); } if (w) w.location = data.signedUrl; else location.href = data.signedUrl; });
  $$('[data-ap]', m.el).forEach(b => b.onclick = async () => { const a = A.find(y => y.id === b.dataset.ap); if (!confirm(`Apagar a digitalização "${a.nome}"? O papel não é afetado.`)) return;
    try { const cam = await q(sb.rpc('arq_arquivo_excluir', { p_arquivo: a.id })); await sb.storage.from('arquivo').remove([cam]); m.close(); toast('Digitalização apagada'); await recarregar(); pasta(D.pastas.find(p => p.id === pa.id)); } catch (err) { fail(err); } });
  const up = $('#pa-up', m.el); if (up) up.onchange = async () => {
    const fs = [...up.files]; up.value = ''; if (!fs.length) return;
    const ruins = fs.filter(f => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf'), grandes = fs.filter(f => f.size > 52428800);
    if (ruins.length) return toast(`Só PDF: ${ruins.map(f => f.name).join(', ')}`, true);
    if (grandes.length) return toast(`Acima de 50 MB: ${grandes.map(f => f.name).join(', ')}. Digitalize em partes ou com menos resolução (200 dpi, preto e branco).`, true);
    const prog = $('#pa-prog', m.el); let ok = 0;
    for (const [k, f] of fs.entries()) {
      prog.textContent = `Enviando ${k + 1} de ${fs.length}: ${f.name}…`;
      const cam = `${state.empresa.id}/${x.id}/${pa.id}/${crypto.randomUUID()}.pdf`;
      try { const { error } = await sb.storage.from('arquivo').upload(cam, f, { contentType: 'application/pdf', upsert: false }); if (error) throw error;
        await q(sb.rpc('arq_arquivo_registrar', { p_pasta: pa.id, p_caminho: cam, p_nome: f.name })); ok++; }
      catch (err) { fail(err); await sb.storage.from('arquivo').remove([cam]).catch(() => {}); }
    }
    toast(`${ok} de ${fs.length} PDF(s) enviado(s)`); m.close(); await recarregar(); pasta(D.pastas.find(p => p.id === pa.id));
  };
}
function editarPasta(pa, x) {
  const m = modal({ title: pa ? `Editar a pasta ${numPasta(x.numero, pa.numero)}` : `Nova pasta na caixa ${String(x.numero).padStart(4, '0')}`, body: `<div class="grid-form">
      <label class="span2">Título<input id="pp-t" maxlength="120" value="${esc(pa?.titulo || '')}" placeholder="ex.: Notas de entrada — janeiro"></label>
      <label class="span2">Documento (opcional)<select id="pp-tp"><option value="">—</option>${D.tipos.filter(t => t.ativo || t.id === pa?.tipo_id).map(t => `<option value="${t.id}" ${t.id === pa?.tipo_id ? 'selected' : ''}>${esc(AREAS_ARQ[t.area])} · ${esc(t.nome)}</option>`).join('')}</select></label>
      <label>De (mês)<input type="month" id="pp-i" value="${(pa?.inicio || '').slice(0, 7)}"></label><label>Até (mês)<input type="month" id="pp-f" value="${(pa?.fim || '').slice(0, 7)}"></label>
      <label class="span2">Descrição (opcional)<input id="pp-d" maxlength="300" value="${esc(pa?.descricao || '')}"></label></div>`,
    foot: `<button class="btn" data-close>Cancelar</button>${pa ? '' : '<button class="btn" id="pp-ok2">Salvar e nova</button>'}<button class="btn primary" id="pp-ok">Salvar</button>` });
  $('#pp-i', m.el).onchange = (ev) => { if (!$('#pp-f', m.el).value) $('#pp-f', m.el).value = ev.target.value; };
  const salvar = async (nova) => {
    const p = { id: pa?.id, caixa_id: x.id, titulo: $('#pp-t', m.el).value, tipo_id: $('#pp-tp', m.el).value || null, inicio: mesIni($('#pp-i', m.el).value) || null, fim: mesFim($('#pp-f', m.el).value) || null, descricao: $('#pp-d', m.el).value };
    try { const id = await q(sb.rpc('arq_pasta_salvar', { p_empresa: state.empresa.id, p })); m.close(); toast(pa ? 'Pasta salva' : 'Pasta criada: imprima a etiqueta'); await recarregar();
      if (nova) editarPasta(null, D.cx[x.id]); else pasta(D.pastas.find(y => y.id === id)); } catch (err) { fail(err); } };
  $('#pp-ok', m.el).onclick = () => salvar(false); $('#pp-ok2', m.el) && ($('#pp-ok2', m.el).onclick = () => salvar(true));
}

const mesIni = (v) => (v ? v + '-01' : ''), mesFim = (v) => { if (!v) return ''; const [a, mm] = v.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };
function editar(x, modelo = null) {
  const base = x || modelo || {}, ativos = D.ends.filter(e => e.ativo && D.loc[e.local_id]?.ativo);
  let linhas = x ? D.itensDe(x.id).map(i => ({ ...i })) : [{ tipo_id: '', descricao: '', inicio: '', fim: '' }];
  const optTipo = (sel, area) => { const ts = D.tipos.filter(t => t.ativo || t.id === sel); const pri = ts.filter(t => t.area === area), out = ts.filter(t => t.area !== area);
    return `<option value="">Escolha…</option>${pri.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}${out.length ? `<optgroup label="Outras áreas">${out.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(AREAS_ARQ[t.area])} · ${esc(t.nome)}</option>`).join('')}</optgroup>` : ''}`; };
  const m = modal({ title: x ? `Editar a caixa ${n4(x.numero)}` : 'Nova caixa', wide: true, body: `<div class="grid-form">
      <label>Área<select id="ed-a"><option value="">Escolha…</option>${Object.entries(AREAS_ARQ).map(([k, v]) => `<option value="${k}" ${base.area === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Setor (opcional)<input id="ed-s" maxlength="60" value="${esc(base.setor || '')}" placeholder="ex.: Departamento Pessoal"></label>
      <label class="span2">Título (o que a caixa guarda)<input id="ed-t" maxlength="120" value="${esc(x?.titulo || '')}" placeholder="ex.: Notas fiscais de entrada — 2019"></label>
      <label class="span2">Endereço<select id="ed-e"><option value="">— sem endereço —</option>${D.locais.map(l => `<optgroup label="${esc(l.nome)}">${ativos.filter(e => e.local_id === l.id).map(e => `<option value="${e.id}" ${base.endereco_id === e.id ? 'selected' : ''}>${esc(e.codigo)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="span2" style="display:flex;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="ed-r" style="width:auto;margin:0" ${x?.reter ? 'checked' : ''}> Reter esta caixa (não entra no descarte mesmo com o prazo vencido)</label>
      <label class="span2" id="ed-rm-l" ${x?.reter ? '' : 'hidden'}>Motivo da retenção<input id="ed-rm" maxlength="300" value="${esc(x?.reter_motivo || '')}" placeholder="ex.: processo trabalhista nº…, fiscalização, recuperação judicial"></label>
      <label class="span2">Observação<input id="ed-o" maxlength="300" value="${esc(x?.observacao || '')}"></label></div>
    <h3 style="margin:14px 0 6px">Conteúdo</h3><p class="small muted" style="margin-top:0">Uma linha por tipo de documento e período. O prazo de guarda da caixa sai do conteúdo: vale o documento que precisa ficar mais tempo. Sem conteúdo a caixa é salva, mas fica sem prazo de guarda.</p>
    ${D.tipos.length ? '' : '<p class="small" style="color:var(--warn)">Ainda não há tipos de documento para escolher. Abra a aba Tipos e prazos e use Preparar os tipos sugeridos (ou peça a quem cuida do arquivo).</p>'}
    <div class="table-wrap"><table class="small"><thead><tr><th>Documento</th><th>Descrição (opcional)</th><th style="width:130px">De (mês)</th><th style="width:130px">Até (mês)</th><th></th></tr></thead><tbody id="ed-it"></tbody></table></div>
    <button class="btn ghost small" id="ed-mais" style="margin-top:6px">+ linha</button>`,
    foot: `<button class="btn" data-close>Cancelar</button>${x ? '' : '<button class="btn" id="ed-ok2">Salvar e nova</button>'}<button class="btn primary" id="ed-ok">Salvar</button>` });
  const ler = () => { linhas = $$('#ed-it tr', m.el).map(tr => ({ tipo_id: $('[data-f=t]', tr).value, descricao: $('[data-f=d]', tr).value, inicio: mesIni($('[data-f=i]', tr).value), fim: mesFim($('[data-f=f]', tr).value) })); };
  const pinta = () => { const area = $('#ed-a', m.el).value;
    $('#ed-it', m.el).innerHTML = linhas.map((l, k) => `<tr><td><select data-f="t">${optTipo(l.tipo_id, area)}</select></td><td><input data-f="d" maxlength="200" value="${esc(l.descricao || '')}"></td>
      <td><input type="month" data-f="i" value="${(l.inicio || '').slice(0, 7)}"></td><td><input type="month" data-f="f" value="${(l.fim || '').slice(0, 7)}"></td><td><button class="btn ghost small" data-x="${k}">×</button></td></tr>`).join('');
    $$('[data-x]', m.el).forEach(b => b.onclick = () => { ler(); linhas.splice(+b.dataset.x, 1); pinta(); });
    $$('[data-f=i]', m.el).forEach(i => i.onchange = () => { const f = $('[data-f=f]', i.closest('tr')); if (!f.value) f.value = i.value.slice(0, 4) + '-12'; }); };
  pinta();
  $('#ed-a', m.el).onchange = () => { ler(); pinta(); };
  $('#ed-r', m.el).onchange = (ev) => { $('#ed-rm-l', m.el).hidden = !ev.target.checked; };
  $('#ed-mais', m.el).onclick = () => { ler(); const u = linhas[linhas.length - 1] || {}; linhas.push({ tipo_id: u.tipo_id || '', descricao: '', inicio: u.inicio || '', fim: u.fim || '' }); pinta(); };
  const salvar = async (nova) => { ler();
    const its = linhas.filter(l => l.tipo_id || l.inicio || l.fim || l.descricao);
    const k = its.findIndex(l => !l.tipo_id || !l.inicio || !l.fim);
    if (k >= 0) { const l = its[k], falta = [!l.tipo_id && 'o documento', !l.inicio && 'o mês de início', !l.fim && 'o mês de fim'].filter(Boolean);
      return toast(`Linha ${k + 1} do conteúdo: falta ${falta.join(', ').replace(/, ([^,]*)$/, ' e $1')}. Se não for registrar o conteúdo agora, apague a linha (×).`, true); }
    const p = { id: x?.id, area: $('#ed-a', m.el).value, setor: $('#ed-s', m.el).value, titulo: $('#ed-t', m.el).value, endereco_id: $('#ed-e', m.el).value || null,
      reter: $('#ed-r', m.el).checked, reter_motivo: $('#ed-rm', m.el).value, observacao: $('#ed-o', m.el).value, itens: its };
    try { const id = await q(sb.rpc('arq_caixa_salvar', { p_empresa: state.empresa.id, p })); m.close(); toast(x ? 'Caixa salva' : 'Caixa registrada: imprima a etiqueta'); await recarregar();
      if (nova) editar(null, { area: p.area, setor: p.setor, endereco_id: p.endereco_id }); else if (!x) ficha(D.cx[id]); } catch (err) { fail(err); } };
  $('#ed-ok', m.el).onclick = () => salvar(false); $('#ed-ok2', m.el) && ($('#ed-ok2', m.el).onclick = () => salvar(true));
}

function mover(ids) {
  if (!ids.length) return toast('Marque as caixas', true);
  const ativos = D.ends.filter(e => e.ativo && D.loc[e.local_id]?.ativo);
  const m = modal({ title: `Guardar ${ids.length} caixa(s)`, body: `<label>Endereço<select id="mv-e"><option value="">— sem endereço —</option>${D.locais.map(l => `<optgroup label="${esc(l.nome)}">${ativos.filter(e => e.local_id === l.id).map(e => `<option value="${e.id}">${esc(e.codigo)}</option>`).join('')}</optgroup>`).join('')}</select></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mv-ok">Guardar</button>' });
  $('#mv-ok', m.el).onclick = async () => { try { const k = await q(sb.rpc('arq_caixa_mover', { p_empresa: state.empresa.id, p_caixas: ids, p_endereco: $('#mv-e', m.el).value || null })); m.close(); ui.sel.clear(); toast(`${k} caixa(s) guardada(s)`); recarregar(); } catch (err) { fail(err); } };
}

// ------------------------------------------------------------ retiradas
async function retirar(x, pedido) {
  let P = []; try { P = await q(sb.rpc('arq_pessoas', { p_empresa: state.empresa.id })); } catch (err) { return fail(err); }
  const prev = new Date(); prev.setDate(prev.getDate() + D.cfg.emprestimo_dias);
  const m = modal({ title: `Retirada da caixa ${n4(x.numero)} — ${x.titulo}`, body: `<div class="grid-form">
      <label class="span2">Quem está levando<select id="rt-p"><option value="">Outra pessoa (digite o nome)</option>${P.map(p => `<option value="${p.user_id}" ${pedido?.pedido_por === p.user_id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>
      <label class="span2" id="rt-n-l" ${pedido ? 'hidden' : ''}>Nome<input id="rt-n" maxlength="120" placeholder="ex.: Dr. Fulano, escritório de contabilidade"></label>
      <label class="span2">Motivo<input id="rt-m" maxlength="300" value="${esc(pedido?.motivo || '')}"></label>
      <label>Devolver até<input type="date" id="rt-d" value="${prev.toISOString().slice(0, 10)}"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rt-ok">Registrar a retirada</button>' });
  const sel = $('#rt-p', m.el); sel.onchange = () => { $('#rt-n-l', m.el).hidden = !!sel.value; }; sel.onchange();
  $('#rt-ok', m.el).onclick = async () => { try { await q(sb.rpc('arq_emp_retirar', { p_caixa: x.id, p_pedido: pedido?.id || null, p_para: sel.value || null, p_para_nome: $('#rt-n', m.el).value, p_motivo: $('#rt-m', m.el).value, p_previsto: $('#rt-d', m.el).value }));
    m.close(); toast(`Caixa ${n4(x.numero)} retirada`); recarregar(); } catch (err) { fail(err); } };
}
function abaRetiradas(c) {
  const ped = D.emps.filter(e => e.situacao === 'pedido'), fora = D.emps.filter(e => e.situacao === 'retirada').sort((a, b) => a.previsto.localeCompare(b.previsto)), hist = D.emps.filter(e => ['devolvida', 'cancelado'].includes(e.situacao)).slice(0, 60);
  const cx = (e) => D.cx[e.caixa_id] || {}, nome = (e) => `<b>${n4(cx(e).numero)}</b> ${esc(cx(e).titulo || '')}<div class="small muted">${esc(endTxt(cx(e).endereco_id))}</div>`;
  c.innerHTML = `<div class="card flush" style="margin-bottom:12px"><h3 style="margin:12px 14px 6px">Pedidos (${ped.length})</h3><div class="table-wrap"><table class="small"><thead><tr><th>Caixa</th><th>Pedido por</th><th>Motivo</th><th>Em</th><th></th></tr></thead><tbody>
      ${ped.map(e => `<tr><td>${nome(e)}</td><td>${esc(e.pedido_nome || '')}</td><td class="wrap">${esc(e.motivo || '')}</td><td>${dateBR(e.pedido_em)}</td>
        <td style="white-space:nowrap">${D.gestor && cx(e).situacao === 'arquivada' ? `<button class="btn primary small" data-rt="${e.id}">Registrar retirada</button> ` : D.gestor ? '<span class="small muted">caixa fora</span> ' : ''}${D.gestor || e.pedido_por === state.user.id ? `<button class="btn ghost small" data-cn="${e.id}">Cancelar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum pedido. Quem precisa de uma caixa abre a caixa e usa Pedir esta caixa.</td></tr>'}</tbody></table></div></div>
    <div class="card flush" style="margin-bottom:12px"><h3 style="margin:12px 14px 6px">Fora do arquivo (${fora.length})</h3><div class="table-wrap"><table class="small"><thead><tr><th>Caixa</th><th>Com</th><th>Motivo</th><th>Retirada</th><th>Devolver até</th><th></th></tr></thead><tbody>
      ${fora.map(e => `<tr><td>${nome(e)}</td><td>${esc(e.para_nome || '')}</td><td class="wrap">${esc(e.motivo || '')}</td><td>${dateBR(e.retirado_em)}</td>
        <td>${dateBR(e.previsto)}${e.previsto < today() ? ' <span class="badge vencido">atrasada</span>' : ''}</td><td>${D.gestor ? `<button class="btn primary small" data-dv="${e.id}">Registrar devolução</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma caixa fora do arquivo.</td></tr>'}</tbody></table></div></div>
    <div class="card flush"><h3 style="margin:12px 14px 6px">Últimas devoluções</h3><div class="table-wrap"><table class="small"><thead><tr><th>Caixa</th><th>Com</th><th>Retirada</th><th>Devolvida</th><th>Situação</th></tr></thead><tbody>
      ${hist.map(e => `<tr><td>${nome(e)}</td><td>${esc(e.para_nome || e.pedido_nome || '')}</td><td>${e.retirado_em ? dateBR(e.retirado_em) : '—'}</td><td>${e.devolvido_em ? dateBR(e.devolvido_em) : '—'}</td><td>${e.situacao === 'devolvida' ? 'Devolvida' : 'Pedido cancelado'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nada ainda.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-rt]', c).forEach(b => b.onclick = () => { const e = D.emps.find(x => x.id === b.dataset.rt); retirar(D.cx[e.caixa_id], e); });
  $$('[data-dv]', c).forEach(b => b.onclick = async () => { try { await q(sb.rpc('arq_emp_devolver', { p_emprestimo: b.dataset.dv })); toast('Devolução registrada'); recarregar(); } catch (err) { fail(err); } });
  $$('[data-cn]', c).forEach(b => b.onclick = async () => { const mot = prompt('Motivo do cancelamento (opcional)'); if (mot === null) return;
    try { await q(sb.rpc('arq_emp_cancelar', { p_emprestimo: b.dataset.cn, p_motivo: mot })); toast('Pedido cancelado'); recarregar(); } catch (err) { fail(err); } });
}

// ------------------------------------------------------------ descarte
async function abaDescarte(c) {
  let V = [], P = [], PC = [];
  try { [V, P, PC] = await Promise.all([q(sb.rpc('arq_descartaveis', { p_empresa: state.empresa.id })), q(sb.from('arq_descartes').select('*').eq('empresa_id', state.empresa.id).order('numero', { ascending: false }).limit(50)),
    q(sb.from('arq_descarte_caixas').select('descarte_id,caixa_id'))]); } catch (err) { return fail(err); }
  const selD = new Set(), digDesc = D.arqs.filter(a => D.cx[D.pastas.find(p => p.id === a.pasta_id)?.caixa_id]?.situacao === 'descartada');
  c.innerHTML = `${D.cfg.descarte_suspenso ? `<div class="card small" style="border-left:3px solid var(--danger,#c33);margin-bottom:12px"><b>Descarte suspenso.</b> ${esc(D.cfg.descarte_suspenso_motivo || '')}. Nenhuma caixa é descartada enquanto a suspensão estiver ligada (Parâmetros).</div>` : ''}
    <div class="card flush" style="margin-bottom:12px"><div style="display:flex;align-items:center;gap:8px;padding:12px 14px 6px"><h3 style="margin:0">Prazo de guarda vencido ou vencendo em 12 meses (${V.length})</h3><span class="spacer"></span>
      ${D.gestor && !D.cfg.descarte_suspenso ? '<button class="btn primary" id="ds-pr" disabled>Propor o descarte dos marcados</button>' : ''}</div>
      <div class="table-wrap"><table class="small"><thead><tr><th style="width:28px"></th><th>Caixa</th><th>Área</th><th>Período</th><th>Pode sair a partir de</th><th>Situação</th></tr></thead><tbody>
      ${V.map(v => `<tr><td>${!v.impede && D.gestor ? `<input type="checkbox" data-v="${v.caixa_id}">` : ''}</td><td><b>${n4(v.numero)}</b> ${esc(v.titulo)}</td><td>${esc(AREAS_ARQ[v.area])}</td><td>${esc(periodoCaixa(v.periodo_inicio, v.periodo_fim))}</td>
        <td>${dateBR(v.descartar_em)}</td><td>${v.impede ? `<span class="small muted">${esc(v.impede)}</span>` : '<span class="badge pago">pode ser descartada</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma caixa com o prazo vencendo.</td></tr>'}</tbody></table></div></div>
    ${digDesc.length && D.gestor ? `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px;display:flex;align-items:center;gap:10px"><span>${digDesc.length} PDF(s) digitalizado(s) de caixas já descartadas continuam guardados. Com o papel descartado pelo prazo, apague também as cópias digitais.</span><span class="spacer"></span><button class="btn small" id="ds-dig">Apagar as cópias digitais</button></div>` : ''}
    <div class="card flush"><h3 style="margin:12px 14px 6px">Propostas de descarte</h3><div class="table-wrap"><table class="small"><thead><tr><th>Nº</th><th>Situação</th><th class="num">Caixas</th><th>Proposto por</th><th>Decidido por</th><th>Executado</th><th></th></tr></thead><tbody>
      ${P.map(d => { const n = PC.filter(x => x.descarte_id === d.id).length; return `<tr><td><b>${d.numero}</b></td><td>${badge(SITD, d.situacao)}${d.motivo ? `<div class="small muted">${esc(d.motivo)}</div>` : ''}</td><td class="num">${n}</td>
        <td>${esc(d.proposto_nome || '')} <span class="small muted">${dateBR(d.proposto_em)}</span></td><td>${esc(d.decidido_nome || '')} <span class="small muted">${d.decidido_em ? dateBR(d.decidido_em) : ''}</span></td>
        <td>${d.executado_em ? `${dateBR(d.executado_em)} · ${esc(FORMAS[d.forma] || '')}` : ''}</td>
        <td style="white-space:nowrap">${D.aprova && d.situacao === 'proposto' && d.proposto_por !== state.user.id ? `<button class="btn primary small" data-ap="${d.id}">Aprovar</button> <button class="btn ghost small" data-rc="${d.id}">Recusar</button> ` : ''}
          ${D.gestor && d.situacao === 'aprovado' ? `<button class="btn primary small" data-ex="${d.id}">Registrar o descarte</button> ` : ''}${['proposto', 'aprovado'].includes(d.situacao) ? `<button class="btn ghost small" data-cc="${d.id}">Cancelar</button> ` : ''}
          <button class="btn ghost small" data-tm="${d.id}">${d.situacao === 'executado' ? 'Termo de descarte' : 'Lista'}</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Nenhuma proposta.</td></tr>'}</tbody></table></div></div>`;
  $('#ds-dig', c) && ($('#ds-dig', c).onclick = async (ev) => { if (!confirm(`Apagar ${digDesc.length} PDF(s) de caixas descartadas? Não dá para desfazer.`)) return; ev.target.disabled = true; let k = 0;
    for (const a of digDesc) { try { const cam = await q(sb.rpc('arq_arquivo_excluir', { p_arquivo: a.id })); await sb.storage.from('arquivo').remove([cam]); k++; } catch (err) { fail(err); } }
    toast(`${k} cópia(s) digital(is) apagada(s)`); recarregar(); });
  $$('[data-v]', c).forEach(b => b.onchange = () => { b.checked ? selD.add(b.dataset.v) : selD.delete(b.dataset.v); const bt = $('#ds-pr', c); if (bt) { bt.disabled = !selD.size; bt.textContent = `Propor o descarte dos marcados${selD.size ? ` (${selD.size})` : ''}`; } });
  $('#ds-pr', c) && ($('#ds-pr', c).onclick = async () => { const obs = prompt(`Propor o descarte de ${selD.size} caixa(s)? Outra pessoa (${D.cfg.papeis_descarte.join(', ')}) aprova. Observação (opcional):`); if (obs === null) return;
    try { await q(sb.rpc('arq_descarte_propor', { p_empresa: state.empresa.id, p_caixas: [...selD], p_obs: obs })); toast('Proposta de descarte enviada para aprovação'); recarregar(); } catch (err) { fail(err); } });
  $$('[data-ap]', c).forEach(b => b.onclick = async () => { if (!confirm('Aprovar o descarte? As caixas só saem do arquivo quando o descarte físico for registrado.')) return;
    try { await q(sb.rpc('arq_descarte_decidir', { p_descarte: b.dataset.ap, p_aprovar: true, p_motivo: null })); toast('Descarte aprovado'); recarregar(); } catch (err) { fail(err); } });
  $$('[data-rc]', c).forEach(b => b.onclick = async () => { const mot = (prompt('Motivo da recusa') || '').trim(); if (!mot) return;
    try { await q(sb.rpc('arq_descarte_decidir', { p_descarte: b.dataset.rc, p_aprovar: false, p_motivo: mot })); toast('Descarte recusado'); recarregar(); } catch (err) { fail(err); } });
  $$('[data-cc]', c).forEach(b => b.onclick = async () => { const mot = (prompt('Motivo do cancelamento') || '').trim(); if (!mot) return;
    try { await q(sb.rpc('arq_descarte_cancelar', { p_descarte: b.dataset.cc, p_motivo: mot })); toast('Proposta cancelada'); recarregar(); } catch (err) { fail(err); } });
  $$('[data-ex]', c).forEach(b => b.onclick = () => executar(P.find(d => d.id === b.dataset.ex)));
  $$('[data-tm]', c).forEach(b => b.onclick = () => termo(P.find(d => d.id === b.dataset.tm), PC.filter(x => x.descarte_id === b.dataset.tm).map(x => D.cx[x.caixa_id]).filter(Boolean)));
}
function executar(d) {
  const m = modal({ title: `Registrar o descarte nº ${d.numero}`, body: `<div class="grid-form">
      <label>Data do descarte<input type="date" id="ex-d" value="${today()}"></label><label>Forma<select id="ex-f">${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="span2">Responsável pelo descarte<input id="ex-r" maxlength="120" placeholder="nome de quem fez (ou a empresa contratada)"></label>
      <label class="span2">Testemunha (opcional)<input id="ex-t" maxlength="120"></label></div>
    <p class="small muted">Registre depois de o descarte físico acontecer. As caixas saem do arquivo e o termo de descarte fica disponível para assinatura.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ex-ok">Registrar</button>' });
  $('#ex-ok', m.el).onclick = async () => { try { const k = await q(sb.rpc('arq_descarte_executar', { p_descarte: d.id, p_data: $('#ex-d', m.el).value, p_forma: $('#ex-f', m.el).value, p_responsavel: $('#ex-r', m.el).value, p_testemunha: $('#ex-t', m.el).value }));
    m.close(); toast(`${k} caixa(s) descartada(s). Imprima o termo.`); recarregar(); } catch (err) { fail(err); } };
}
function termo(d, cxs) {
  const exec = d.situacao === 'executado';
  abrirRelatorio({ nome: exec ? 'Termo de descarte de documentos' : 'Proposta de descarte de documentos', titulo: `${exec ? 'Termo' : 'Proposta'} de descarte de documentos nº ${d.numero}`, tipo: 'documento',
    subtitulo: exec ? `Descarte realizado em ${dateBR(d.executado_em)} · ${esc(FORMAS[d.forma] || '')}` : `Situação: ${SITD[d.situacao][0]}`,
    corpo: `<p>${exec ? 'Declaramos que os documentos abaixo, com prazo de guarda vencido, foram descartados na data e da forma indicadas.' : 'Relação das caixas propostas para descarte por prazo de guarda vencido.'}</p>
      <table><thead><tr><th>Caixa</th><th>Área</th><th>Conteúdo</th><th>Período</th><th>Guarda até</th></tr></thead><tbody>
      ${cxs.map(x => `<tr><td>${n4(x.numero)}</td><td>${esc(AREAS_ARQ[x.area])}</td><td>${esc(x.titulo)}<br>${D.itensDe(x.id).map(i => `${esc(D.tipo[i.tipo_id]?.nome || '')} (${esc(periodoCaixa(i.inicio, i.fim))}; prazo ${D.tipo[i.tipo_id]?.prazo_anos} anos)`).join('<br>')}</td>
        <td>${esc(periodoCaixa(x.periodo_inicio, x.periodo_fim))}</td><td>${esc(guardaCaixa(x).replace('Guardar até ', ''))}</td></tr>`).join('')}</tbody></table>
      <table style="margin-top:14px"><tbody><tr><td>Proposto por</td><td>${esc(d.proposto_nome || '')} em ${dateBR(d.proposto_em)}</td></tr><tr><td>Aprovado por</td><td>${esc(d.decidido_nome || '—')}${d.decidido_em ? ' em ' + dateBR(d.decidido_em) : ''}</td></tr>
        ${exec ? `<tr><td>Responsável pelo descarte</td><td>${esc(d.responsavel || '')}</td></tr><tr><td>Testemunha</td><td>${esc(d.testemunha || '—')}</td></tr><tr><td>Registrado por</td><td>${esc(d.registrado_nome || '')} em ${dateBR(d.registrado_em)}</td></tr>` : ''}</tbody></table>
      ${exec ? '<p style="margin-top:40px">______________________________ &nbsp;&nbsp;&nbsp; ______________________________ &nbsp;&nbsp;&nbsp; ______________________________<br>Responsável pelo descarte &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Aprovação &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Testemunha</p>' : ''}` });
}

// ------------------------------------------------------------ salas e endereços (com o leitor: a prateleira e depois as caixas)
function abaEnderecos(c) {
  const sala = D.loc[ui.sala], es = D.ends.filter(e => e.local_id === ui.sala), conta = new Map(); for (const x of D.caixas) if (x.endereco_id && x.situacao !== 'descartada') conta.set(x.endereco_id, (conta.get(x.endereco_id) || 0) + 1);
  c.innerHTML = `<div class="card" style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:end">
      <label style="margin:0;min-width:220px">Sala<select id="en-s">${D.locais.map(l => `<option value="${l.id}" ${l.id === ui.sala ? 'selected' : ''}>${esc(l.nome)}${l.ativo ? '' : ' (inativa)'}</option>`).join('') || '<option value="">Nenhuma sala</option>'}</select></label>
      ${D.gestor ? `<button class="btn" id="en-ns">Nova sala</button>${sala ? '<button class="btn primary" id="en-g">Gerar endereços</button>' : ''}` : ''}${es.length ? '<button class="btn" id="en-etq">Etiquetas de prateleira</button>' : ''}</div>
    ${D.gestor && es.length ? `<div class="card" style="margin-bottom:12px"><div id="en-at" style="font-size:1.2em;margin-bottom:6px"></div>
      <form id="en-f" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end"><label>Guardar com o leitor: leia a etiqueta da prateleira e depois a de cada caixa<input id="en-cod" autocomplete="off" placeholder="etiqueta da prateleira (S…) ou da caixa (C…), ou o número da caixa"></label><button class="btn primary">Ler</button></form>
      <div id="en-log" class="small" style="margin-top:6px"></div></div>` : ''}
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Endereço</th><th>Descrição</th><th class="num">Caixas</th><th>Etiqueta</th><th>Situação</th></tr></thead><tbody>
      ${es.map(e => `<tr ${e.id === ui.endAtual ? 'style="background:var(--hover,#eef)"' : ''}><td><b>${esc(e.codigo)}</b></td><td>${esc(e.descricao || '')}</td><td class="num">${conta.get(e.id) || ''}</td><td class="small" style="font-family:monospace">${esc(e.etiqueta)}</td><td>${e.ativo ? '<span class="badge pago">ativo</span>' : '<span class="badge">inativo</span>'}</td></tr>`).join('')
      || `<tr><td colspan="5" class="empty">${sala ? 'Nenhum endereço nesta sala. Use Gerar endereços (estantes, prateleiras e níveis).' : 'Cadastre a sala do arquivo em Nova sala.'}</td></tr>`}</tbody></table></div></div>`;
  $('#en-s', c) && ($('#en-s', c).onchange = (ev) => { ui.sala = ev.target.value; ui.endAtual = null; abaEnderecos(c); });
  $('#en-ns', c) && ($('#en-ns', c).onclick = async () => { const nome = (prompt('Nome da sala (ex.: Arquivo do administrativo, Mezanino)') || '').trim(); if (!nome) return;
    try { ui.sala = await q(sb.rpc('arq_local_salvar', { p_empresa: state.empresa.id, p: { nome } })); toast('Sala cadastrada'); recarregar(); } catch (err) { fail(err); } });
  $('#en-etq', c) && ($('#en-etq', c).onclick = () => imprimirEnderecos(es.filter(e => e.ativo).map(e => ({ etiqueta: e.etiqueta, codigo: e.codigo, local: sala?.nome, descricao: e.descricao }))));
  $('#en-g', c) && ($('#en-g', c).onclick = () => {
    const m = modal({ title: `Gerar endereços — ${sala.nome}`, body: `<div class="grid-form"><label class="span2">Estantes<input id="g-e" value="A-D" placeholder="ex.: A-F"></label>
        <label>Prateleiras por estante<input type="number" id="g-p" min="1" max="99" value="5"></label><label>Níveis por prateleira<input type="number" id="g-n" min="0" max="20" value="0"></label></div><div id="g-pv" class="small"></div>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="g-ok">Gerar</button>' });
    const pv = () => { const e = estantes($('#g-e', m.el).value); $('#g-pv', m.el).innerHTML = e.erro ? `<span class="neg">${esc(e.erro)}</span>` : (() => { const cs = codigosEndereco(e.lista, +$('#g-p', m.el).value || 1, +$('#g-n', m.el).value || 0); return `${cs.length} endereço(s): ${esc(cs.slice(0, 4).join(', '))}${cs.length > 4 ? ' … ' + esc(cs[cs.length - 1]) : ''}`; })(); };
    ['g-e', 'g-p', 'g-n'].forEach(id => $('#' + id, m.el).oninput = pv); pv();
    $('#g-ok', m.el).onclick = async () => { const e = estantes($('#g-e', m.el).value); if (e.erro) return toast(e.erro, true);
      try { const k = await q(sb.rpc('arq_end_gerar', { p_empresa: state.empresa.id, p_local: sala.id, p_estantes: e.lista, p_prateleiras: +$('#g-p', m.el).value, p_niveis: +$('#g-n', m.el).value, p_digitos: 2 })); m.close(); toast(`${k} endereço(s) criado(s)`); recarregar(); } catch (err) { fail(err); } };
  });
  const f = $('#en-f', c); if (!f) return;
  let atual = D.end[ui.endAtual] || null; const log = [];
  const mostra = () => { $('#en-at', c).innerHTML = atual ? `Prateleira atual: <b>${esc(atual.codigo)}</b>` : '<span class="muted">Leia a etiqueta da prateleira para começar.</span>'; $('#en-log', c).innerHTML = log.slice(0, 8).join('<br>'); };
  const ler = async (t) => {
    const etq = codigoEtiqueta(t), T = String(t || '').trim().toUpperCase();
    if (etq?.alvo === 'arq_endereco' || (!etq && es.some(e => e.codigo === T))) { const e = etq ? D.ends.find(x => x.etiqueta === etq.codigo) : es.find(x => x.codigo === T);
      if (!e) return toast('Prateleira não encontrada', true); if (e.local_id !== ui.sala) { ui.sala = e.local_id; ui.endAtual = e.id; return abaEnderecos(c); } atual = e; ui.endAtual = e.id; return mostra(); }
    const x = etq?.alvo === 'caixa' ? D.caixas.find(y => y.etiqueta === etq.codigo) : /^\d{1,6}$/.test(T) ? D.caixas.find(y => y.numero === +T) : null;
    if (!x) return toast(`Código ${t}: caixa não encontrada`, true);
    if (!atual) return toast('Leia primeiro a etiqueta da prateleira', true);
    try { await q(sb.rpc('arq_caixa_mover', { p_empresa: state.empresa.id, p_caixas: [x.id], p_endereco: atual.id }));
      const antes = x.endereco_id && x.endereco_id !== atual.id ? ` (estava em ${endTxt(x.endereco_id)})` : ''; x.endereco_id = atual.id;
      log.unshift(`Caixa <b>${n4(x.numero)}</b> ${esc(x.titulo)} → <b>${esc(atual.codigo)}</b>${esc(antes)}`); mostra(); toast(`Caixa ${n4(x.numero)} → ${atual.codigo}`); } catch (err) { fail(err); }
  };
  f.onsubmit = (ev) => { ev.preventDefault(); const i = $('#en-cod', c), v = i.value; i.value = ''; ler(v); i.focus(); };
  aoLer('etiqueta', (r) => ler(r.codigo), c); mostra();
}

// ------------------------------------------------------------ tipos de documento e prazo de guarda
function abaTipos(c) {
  c.innerHTML = `<div class="card small" style="margin-bottom:12px">O prazo de guarda conta a partir de 1º de janeiro do ano seguinte ao fim do período do documento. Os prazos que vêm prontos são <b>sugestões</b>: o descarte só acontece depois que alguém que aprova o descarte (${D.cfg.papeis_descarte.join(', ')}) confirmar cada prazo, de preferência com a contabilidade e o jurídico. Sem prazo = guarda permanente.
      <div style="margin-top:8px;display:flex;gap:8px">${D.gestor ? `${D.tipos.length ? '' : '<button class="btn primary" id="tp-prep">Preparar os tipos sugeridos</button>'}<button class="btn" id="tp-novo">Novo tipo</button>` : ''}</div></div>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>Área</th><th>Documento</th><th class="num">Prazo (anos)</th><th>Prazo</th><th>Observação</th><th></th></tr></thead><tbody>
      ${D.tipos.map(t => `<tr ${t.ativo ? '' : 'class="muted"'}><td>${esc(AREAS_ARQ[t.area])}</td><td>${esc(t.nome)}</td><td class="num">${t.prazo_anos ?? 'permanente'}</td>
        <td>${t.prazo_anos == null ? '' : t.prazo_confirmado ? `<span class="badge pago">confirmado</span> <span class="muted">${esc(t.confirmado_nome || '')} ${t.confirmado_em ? dateBR(t.confirmado_em) : ''}</span>` : '<span class="badge aberto">sugerido</span>'}</td>
        <td class="wrap">${esc(t.observacao || '')}</td><td>${D.gestor || D.aprova ? `<button class="btn ghost small" data-t="${t.id}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum tipo de documento.</td></tr>'}</tbody></table></div></div>`;
  $('#tp-prep', c) && ($('#tp-prep', c).onclick = async () => { try { const k = await q(sb.rpc('arq_configurar', { p_empresa: state.empresa.id })); toast(`${k} tipos criados, com prazo sugerido a confirmar`); recarregar(); } catch (err) { fail(err); } });
  $('#tp-novo', c) && ($('#tp-novo', c).onclick = () => tipo(null));
  $$('[data-t]', c).forEach(b => b.onclick = () => tipo(D.tipo[b.dataset.t]));
}
function tipo(t) {
  const m = modal({ title: t ? t.nome : 'Novo tipo de documento', body: `<div class="grid-form">
      <label>Área<select id="tp-a">${Object.entries(AREAS_ARQ).map(([k, v]) => `<option value="${k}" ${t?.area === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Prazo de guarda (anos)<input type="number" id="tp-p" min="1" max="100" value="${t?.prazo_anos ?? ''}" placeholder="vazio = permanente"></label>
      <label class="span2">Documento<input id="tp-n" maxlength="80" value="${esc(t?.nome || '')}"></label>
      <label class="span2">Observação (fundamento, quem orientou)<input id="tp-o" maxlength="300" value="${esc(t?.observacao || '')}"></label>
      ${D.aprova ? `<label class="span2" style="display:flex;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="tp-c" style="width:auto;margin:0" ${t?.prazo_confirmado ? 'checked' : ''}> Prazo confirmado (libera o descarte deste documento)</label>` : '<p class="small muted span2">Mudar o prazo faz ele voltar a ser sugestão até alguém que aprova o descarte confirmar.</p>'}
      ${t ? `<label class="span2" style="display:flex;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="tp-at" style="width:auto;margin:0" ${t.ativo ? 'checked' : ''}> Ativo</label>` : ''}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="tp-ok">Salvar</button>' });
  $('#tp-ok', m.el).onclick = async () => {
    const p = { id: t?.id, area: $('#tp-a', m.el).value, nome: $('#tp-n', m.el).value, prazo_anos: $('#tp-p', m.el).value || null, observacao: $('#tp-o', m.el).value };
    if ($('#tp-c', m.el)) p.prazo_confirmado = $('#tp-c', m.el).checked; if ($('#tp-at', m.el)) p.ativo = $('#tp-at', m.el).checked;
    try { await q(sb.rpc('arq_tipo_salvar', { p_empresa: state.empresa.id, p })); m.close(); toast('Tipo salvo'); recarregar(); } catch (err) { fail(err); }
  };
}

// ------------------------------------------------------------ parâmetros (administrador)
async function abaParametros(c) {
  let P = []; try { P = await q(sb.rpc('arq_pessoas', { p_empresa: state.empresa.id })); } catch (err) { return fail(err); }
  const g = D.cfg, chk = (grp, k, on) => `<label style="display:inline-flex;flex-direction:row;align-items:center;gap:6px;margin:0 14px 6px 0;font-weight:400"><input type="checkbox" style="width:auto;margin:0" data-${grp}="${k}" ${on ? 'checked' : ''}> ${esc(k.length === 36 ? P.find(p => p.user_id === k)?.nome || k : PAPEIS.find(x => x[0] === k)?.[1] || k)}</label>`;
  c.innerHTML = `<div class="card" style="max-width:900px"><h3 style="margin-top:0">Quem cuida do arquivo</h3><p class="small muted" style="margin-top:0">Cadastra caixas, guarda nos endereços, registra retirada, devolução e o descarte.</p>
      <div>${PAPEIS.map(([k]) => chk('g', k, g.papeis_gestor.includes(k))).join('')}</div>
      <div class="small muted" style="margin:6px 0">E estas pessoas (também abrem as caixas do RH):</div><div>${P.map(p => chk('a', p.user_id, g.arquivistas.includes(p.user_id))).join('')}</div>
      <h3>Quem consulta e pede caixas</h3><div>${PAPEIS.map(([k]) => chk('c', k, g.papeis_consulta.includes(k))).join('')}</div>
      <p class="small muted">As caixas do RH só aparecem para quem vê o RH, para o administrador, o diretor e as pessoas nomeadas acima.</p>
      <h3>Quem confirma os prazos e aprova o descarte</h3><div>${PAPEIS.slice(0, 3).map(([k]) => chk('d', k, g.papeis_descarte.includes(k))).join('')}</div>
      <div class="grid-form" style="margin-top:10px"><label>Prazo de devolução (dias)<input type="number" id="pa-d" min="1" max="90" value="${g.emprestimo_dias}"></label><span></span>
        <label>Etiqueta da pasta: largura (mm)<input type="number" id="pa-pl" min="30" max="210" value="${g.pasta_largura_mm || 70}"></label><label>Etiqueta da pasta: altura (mm)<input type="number" id="pa-pa" min="15" max="297" value="${g.pasta_altura_mm || 35}"></label></div>
      <h3>Suspender o descarte</h3><label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="pa-s" style="width:auto;margin:0" ${g.descarte_suspenso ? 'checked' : ''}> Nada é descartado enquanto ligado (por exemplo, durante processo judicial ou fiscalização)</label>
      <label>Motivo<input id="pa-sm" maxlength="300" value="${esc(g.descarte_suspenso_motivo || '')}"></label>
      <div style="margin-top:12px"><button class="btn primary" id="pa-ok">Salvar</button></div></div>`;
  const marc = (grp) => $$(`[data-${grp}]`, c).filter(x => x.checked).map(x => x.dataset[grp]);
  $('#pa-ok', c).onclick = async () => { try { await q(sb.rpc('arq_config_salvar', { p_empresa: state.empresa.id, p: { papeis_gestor: marc('g'), arquivistas: marc('a'), papeis_consulta: marc('c'), papeis_descarte: marc('d'),
    emprestimo_dias: +$('#pa-d', c).value, pasta_largura_mm: +$('#pa-pl', c).value, pasta_altura_mm: +$('#pa-pa', c).value, descarte_suspenso: $('#pa-s', c).checked, descarte_suspenso_motivo: $('#pa-sm', c).value } })); toast('Parâmetros salvos'); recarregar(); } catch (err) { fail(err); } };
}

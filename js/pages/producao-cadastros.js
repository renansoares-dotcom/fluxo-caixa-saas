// Produção › Cadastros: setores, máquinas, motivos de parada/refugo, operadores, clichês/cilindros/facas e roteiros por produto.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { cadProducao, limparCadProducao, podePCP, TIPOS_FERR } from '../lib/producao.js';
import { carregarProdutos, datalistProdutos, acharProduto } from '../lib/produtos.js';
import { qtd, inp, num } from '../lib/compras.js';
import { TIPOS_VISUAIS } from '../lib/planta.js';

export const title = 'Cadastros de produção';
const ui = { aba: 'setores', prod: '' };
let C = null, PRODS = [], MEMB = [];

const ABAS = {
  setores: { t: 'Setores', tab: 'prod_setores', cols: [['nome', 'Nome', 'text', true], ['ordem', 'Ordem no fluxo', 'num'], ['horas_dia', 'Horas produtivas/dia', 'num'], ['ativo', 'Ativo', 'bool']], ordem: 'ordem' },
  maquinas: { t: 'Máquinas', tab: 'prod_maquinas', cols: [['codigo', 'Código', 'text', true], ['nome', 'Nome', 'text', true], ['setor_id', 'Setor', 'setor', true], ['capacidade_kg_h', 'Capacidade (kg/h)', 'num'], ['tipo_visual', 'Desenho na planta', 'tipo_vis'], ['ativo', 'Ativa', 'bool'], ['observacao', 'Observação', 'text']], ordem: 'codigo' },
  motivos: { t: 'Motivos', tab: 'prod_motivos', cols: [['tipo', 'Tipo', 'tipo_motivo', true], ['nome', 'Nome', 'text', true], ['planejada', 'Parada planejada', 'bool'], ['ativo', 'Ativo', 'bool']], ordem: 'nome' },
  operadores: { t: 'Operadores', tab: 'prod_operadores', cols: [['nome', 'Nome', 'text', true], ['matricula', 'Matrícula', 'text'], ['user_id', 'Usuário (perfil Produção)', 'usuario'], ['setores', 'Setores', 'setores'], ['ativo', 'Ativo', 'bool']], ordem: 'nome' },
  ferramentas: { t: 'Clichês, cilindros e facas', tab: 'prod_ferramentas', cols: [['tipo', 'Tipo', 'tipo_ferr', true], ['codigo', 'Código', 'text', true], ['descricao', 'Descrição', 'text'], ['produto_id', 'Produto', 'produto'],
    ['cores', 'Cores', 'num'], ['vida_util_m', 'Vida útil (m)', 'num'], ['metros_usados', 'Metros usados', 'num'], ['localizacao', 'Localização', 'text'], ['situacao', 'Situação', 'sit_ferr']], ordem: 'codigo' },
  roteiros: { t: 'Roteiros' },
};

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Cadastros de produção</h2><div class="muted small">Base para OP, terminal, programação e OEE. ${podePCP() ? '' : 'Só admin, financeiro ou diretor alteram.'}</div></div></div>
    <div class="card toolbar"><div class="chips" id="pc-abas">${Object.entries(ABAS).map(([k, a]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${a.t}</span>`).join('')}</div></div>
    <div id="pc-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#pc-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  try {
    limparCadProducao();
    [C, PRODS] = await Promise.all([cadProducao(true), carregarProdutos().catch(() => [])]);
    if (ui.aba === 'operadores') MEMB = await q(sb.rpc('listar_membros', { p_empresa: state.empresa.id })).catch(() => []);
    ui.aba === 'roteiros' ? await roteiros(root) : await tabela(root, ABAS[ui.aba]);
  } catch (err) { fail(err); $('#pc-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}

const MOTIVOS_PADRAO = [['parada', 'Setup / troca de produto', true], ['parada', 'Troca de bobina', true], ['parada', 'Limpeza programada', true], ['parada', 'Manutenção corretiva', false],
  ['parada', 'Falta de matéria-prima', false], ['parada', 'Falta de operador', false], ['parada', 'Falta de energia', false], ['parada', 'Aguardando programação', false],
  ['refugo', 'Início de produção (acerto)', false], ['refugo', 'Furo / rasgo', false], ['refugo', 'Espessura fora', false], ['refugo', 'Impressão / registro', false],
  ['refugo', 'Solda', false], ['refugo', 'Refile / apara de borda', false], ['refugo', 'Gel / contaminação', false]];

function valorTxt(c, v) {
  if (v == null || v === '') return '';
  if (c[2] === 'bool') return v ? 'sim' : 'não';
  if (c[2] === 'setor') return C.setorById[v]?.nome || '';
  if (c[2] === 'produto') { const p = PRODS.find(x => x.id === v); return p ? `${p.codigo} — ${p.descricao}` : ''; }
  if (c[2] === 'usuario') return MEMB.find(x => x.user_id === v)?.email || 'usuário';
  if (c[2] === 'setores') return (v || []).map(id => C.setorById[id]?.nome).filter(Boolean).join(', ') || 'todos';
  if (c[2] === 'tipo_ferr') return TIPOS_FERR[v] || v;
  if (c[2] === 'tipo_vis') return TIPOS_VISUAIS[v]?.t || v;
  if (c[2] === 'num') return qtd(v);
  return String(v);
}
async function tabela(root, A) {
  const rows = await q(sb.from(A.tab).select('*').eq('empresa_id', state.empresa.id).order(A.ordem));
  const corpo = $('#pc-corpo', root);
  corpo.innerHTML = `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">${A.t}</h2><div style="display:flex;gap:8px">
      ${A.tab === 'prod_motivos' && podePCP() && !rows.length ? '<button class="btn ghost small" id="pc-padrao">Criar motivos padrão</button>' : ''}${podePCP() ? '<button class="btn primary small" id="pc-novo">Incluir</button>' : ''}</div></div>
    <div class="table-wrap"><table><thead><tr>${A.cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr class="${podePCP() ? 'clickable' : ''}" data-id="${r.id}">${A.cols.map(c => `<td class="${c[2] === 'num' ? 'num' : ''}">${esc(valorTxt(c, r[c[0]]))}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${A.cols.length}" class="empty">Nada cadastrado.</td></tr>`}</tbody></table></div></div>
    ${A.tab === 'prod_operadores' ? '<p class="small muted">O operador entra no terminal com o próprio usuário (convite com perfil "Produção" em Empresa e Usuários) e aqui você liga o usuário ao operador e aos setores dele.</p>' : ''}`;
  $('#pc-novo', corpo) && ($('#pc-novo', corpo).onclick = () => editar(A, null, root));
  $('#pc-padrao', corpo) && ($('#pc-padrao', corpo).onclick = async () => {
    try { await q(sb.from('prod_motivos').insert(MOTIVOS_PADRAO.map(([tipo, nome, planejada]) => ({ empresa_id: state.empresa.id, tipo, nome, planejada })))); toast('Motivos criados'); render(root); } catch (err) { fail(err); } });
  if (podePCP()) $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => editar(A, rows.find(r => r.id === tr.dataset.id), root));
}

function campo(c, v) {
  const id = 'f-' + c[0];
  switch (c[2]) {
    case 'bool': return `<label class="chk"><input type="checkbox" id="${id}" ${v ?? true ? 'checked' : ''}> ${c[1]}</label>`;
    case 'num': return `<label>${c[1]}<input id="${id}" value="${inp(v)}"></label>`;
    case 'setor': return `<label>${c[1]}<select id="${id}">${C.setores.map(s => `<option value="${s.id}" ${v === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></label>`;
    case 'tipo_motivo': return `<label>${c[1]}<select id="${id}"><option value="parada" ${v === 'parada' ? 'selected' : ''}>Parada</option><option value="refugo" ${v === 'refugo' ? 'selected' : ''}>Refugo / apara</option></select></label>`;
    case 'tipo_ferr': return `<label>${c[1]}<select id="${id}">${Object.entries(TIPOS_FERR).map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    case 'tipo_vis': return `<label>${c[1]}<select id="${id}">${Object.entries(TIPOS_VISUAIS).map(([k, x]) => `<option value="${k}" ${(v || 'generica') === k ? 'selected' : ''}>${x.t}</option>`).join('')}</select></label>`;
    case 'sit_ferr': return `<label>${c[1]}<select id="${id}">${['ativa', 'manutencao', 'descartada'].map(k => `<option value="${k}" ${(v || 'ativa') === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`;
    case 'produto': { const p = PRODS.find(x => x.id === v); return `<label class="span2">${c[1]}<input id="${id}" list="dl-pr" value="${p ? esc(`${p.codigo} — ${p.descricao}`) : ''}">${datalistProdutos('dl-pr', PRODS)}</label>`; }
    case 'usuario': return `<label>${c[1]}<select id="${id}"><option value="">—</option>${MEMB.filter(x => x.papel === 'producao' || x.user_id === v).map(x => `<option value="${x.user_id}" ${v === x.user_id ? 'selected' : ''}>${esc(x.email)}</option>`).join('')}</select></label>`;
    case 'setores': return `<div class="span2"><div class="small muted">${c[1]} (nenhum marcado = todos)</div><div class="areas-chk">${C.setores.map(s => `<label class="chk"><input type="checkbox" class="f-setores" value="${s.id}" ${(v || []).includes(s.id) ? 'checked' : ''}> ${esc(s.nome)}</label>`).join('')}</div></div>`;
    default: return `<label>${c[1]}<input id="${id}" value="${esc(v ?? '')}"></label>`;
  }
}
function ler(c, el) {
  const f = $('#f-' + c[0], el);
  switch (c[2]) {
    case 'bool': return f.checked;
    case 'num': return f.value.trim() ? num(f.value) : null;
    case 'produto': return acharProduto(f.value, PRODS)?.id || null;
    case 'setores': return $$('.f-setores', el).filter(x => x.checked).map(x => x.value);
    case 'usuario': case 'setor': return f.value || null;
    default: return f.value.trim() || null;
  }
}
function editar(A, r, root) {
  const m = modal({ title: `${r ? 'Editar' : 'Incluir'} — ${A.t}`, body: `<div class="grid-form">${A.cols.map(c => campo(c, r?.[c[0]])).join('')}</div>`,
    foot: `${r ? '<button class="btn danger" id="ce-del" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ce-ok">Salvar</button>` });
  $('#ce-ok', m.el).onclick = async (ev) => {
    const row = Object.fromEntries(A.cols.map(c => [c[0], ler(c, m.el)]));
    const falta = A.cols.find(c => c[3] && (row[c[0]] == null || row[c[0]] === '')); if (falta) return toast(`Preencha ${falta[1]}`, true);
    ev.target.disabled = true;
    try { if (r) await q(sb.from(A.tab).update(row).eq('id', r.id)); else await q(sb.from(A.tab).insert({ ...row, empresa_id: state.empresa.id }));
      m.close(); toast('Salvo'); render(root); } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#ce-del', m.el) && ($('#ce-del', m.el).onclick = async () => { if (!await confirmDialog('Excluir? Se já houver uso em OPs ou apontamentos, prefira desativar.')) return;
    try { await q(sb.from(A.tab).delete().eq('id', r.id)); m.close(); render(root); } catch (err) { fail(err); } });
}

async function roteiros(root) {
  const rots = await q(sb.from('prod_roteiros').select('*').eq('empresa_id', state.empresa.id).order('seq'));
  const comRot = [...new Set(rots.map(r => r.produto_id))];
  const p = PRODS.find(x => x.id === ui.prod);
  const corpo = $('#pc-corpo', root);
  corpo.innerHTML = `<div class="card"><div class="grid-form"><label class="span2">Produto<input id="ro-p" list="ro-dl" value="${p ? esc(`${p.codigo} — ${p.descricao}`) : ''}" placeholder="escolha o produto">${datalistProdutos('ro-dl', PRODS.filter(x => ['produto_acabado', 'semiacabado'].includes(x.tipo)))}</label></div>
      <p class="small muted">${comRot.length} produto(s) com roteiro: ${comRot.slice(0, 12).map(id => esc(PRODS.find(x => x.id === id)?.codigo || '')).join(', ')}${comRot.length > 12 ? '…' : ''}</p></div>
    <div id="ro-lista" style="margin-top:12px"></div>`;
  $('#ro-p', corpo).onchange = () => { ui.prod = acharProduto($('#ro-p', corpo).value, PRODS)?.id || ''; roteiros(root); };
  if (!p) return;
  const L = rots.filter(r => r.produto_id === p.id);
  $('#ro-lista', corpo).innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>#</th><th>Setor</th><th>Máquina padrão</th><th class="num">Velocidade (kg/h)</th><th class="num">Setup (min)</th>${podePCP() ? '<th></th>' : ''}</tr></thead><tbody>
    ${L.map(r => `<tr><td>${r.seq}</td><td>${esc(C.setorById[r.setor_id]?.nome || '')}</td><td>${esc(C.maqById[r.maquina_id]?.codigo || '–')}</td><td class="num">${r.velocidade_kg_h ? qtd(r.velocidade_kg_h) : ''}</td><td class="num">${r.setup_min ? qtd(r.setup_min) : ''}</td>
      ${podePCP() ? `<td><button class="btn ghost icon" data-x="${r.id}">✕</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="empty">Sem roteiro.</td></tr>'}</tbody></table></div>
    ${podePCP() ? `<div class="grid-form" style="padding:12px 16px"><label>Setor<select id="ro-s">${C.setores.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}</select></label>
      <label>Máquina padrão<select id="ro-m"><option value="">—</option>${C.maquinas.filter(mq => mq.ativo).map(mq => `<option value="${mq.id}">${esc(mq.codigo)} — ${esc(mq.nome)}</option>`).join('')}</select></label>
      <label>Velocidade (kg/h)<input id="ro-v"></label><label>Setup (min)<input id="ro-su"></label><div style="align-self:end"><button class="btn small" id="ro-ok">+ Etapa</button></div></div>` : ''}</div>`;
  $$('[data-x]', corpo).forEach(b => b.onclick = async () => { try { await q(sb.from('prod_roteiros').delete().eq('id', b.dataset.x)); roteiros(root); } catch (err) { fail(err); } });
  $('#ro-ok', corpo) && ($('#ro-ok', corpo).onclick = async () => {
    try { await q(sb.from('prod_roteiros').insert({ empresa_id: state.empresa.id, produto_id: p.id, seq: (L[L.length - 1]?.seq || 0) + 1, setor_id: $('#ro-s', corpo).value, maquina_id: $('#ro-m', corpo).value || null,
      velocidade_kg_h: $('#ro-v', corpo).value.trim() ? num($('#ro-v', corpo).value) : null, setup_min: $('#ro-su', corpo).value.trim() ? num($('#ro-su', corpo).value) : null })); roteiros(root); } catch (err) { fail(err); }
  });
}

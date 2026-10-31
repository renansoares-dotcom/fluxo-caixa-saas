// Estoque › Parâmetros (SQL 075): locais (partições), famílias de item, tipos de movimento, regras por CFOP e fechamento do mês.
// Leitura: quem participa. Alteração: administrador e financeiro (o banco confere). Reabrir mês: administrador.
import { sb, state, q, podeEditar, isAdmin, loadCadastros } from '../lib/data.js';
import { $, $$, esc, dateBR, toast, fail, modal, confirmDialog, exportXLSX, erroTela } from '../lib/ui.js';
import { FINALIDADES, POSSE, TIPOS_SPED, SENTIDOS, DOCUMENTOS, PAPEIS, periodoAberto } from '../lib/estoque-kardex.js';

export const title = 'Parâmetros do estoque';
const ABAS = [['locais', 'Locais'], ['familias', 'Famílias de item'], ['tipos', 'Tipos de movimento'], ['regras', 'Regras por CFOP'], ['fechamento', 'Fechamento']];
const ui = { aba: 'locais', sentido: 'entrada', busca: '' };
let D = null;
const sim = (b) => b ? 'Sim' : '<span class="muted">Não</span>';
const MES = (iso) => iso ? iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';

async function carregar() {
  const e = state.empresa.id;
  const [locais, familias, tipos, regras, fech, setores] = await Promise.all([
    q(sb.from('est_locais').select('*').eq('empresa_id', e).order('ordem').order('codigo')),
    q(sb.from('est_familias').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('est_tipos_movimento').select('*').eq('empresa_id', e).order('sentido').order('codigo')),
    q(sb.from('est_regras_cfop').select('*').eq('empresa_id', e).order('sentido').order('cfop').order('prioridade')),
    q(sb.from('est_fechamentos').select('*').eq('empresa_id', e).order('mes', { ascending: false })),
    q(sb.from('prod_setores').select('id,nome,ordem').eq('empresa_id', e).order('ordem')).catch(() => [])]);
  await loadCadastros().catch(() => {});
  D = { locais, familias, tipos, regras, fech, setores, loc: Object.fromEntries(locais.map(l => [l.id, l])), fam: Object.fromEntries(familias.map(f => [f.id, f])), tm: Object.fromEntries(tipos.map(t => [t.id, t])) };
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (err) {
    console.error(err);
    root.innerHTML = /est_locais|does not exist|schema cache/.test(err?.message || '') ? '<div class="card"><span class="badge vencido">SQL 075 pendente</span> A parametrização do estoque ainda não foi criada no banco.</div>' : erroTela('os parâmetros do estoque');
    return;
  }
  pintar(root);
}

function pintar(root) {
  const ed = podeEditar(), per = periodoAberto(D.fech);
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Parâmetros do estoque</h2><div class="muted small">Como cada item entra, onde fica, quem movimenta e como o custo se forma. Custo médio ponderado móvel por produto, sem os impostos recuperáveis.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="ep-xls">Excel</button>${ed ? '<button class="btn" id="ep-padrao" title="Cria o que faltar da configuração inicial; não altera o que já foi ajustado">Completar com o padrão</button>' : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Locais ativos</div><div class="k-value">${D.locais.filter(l => l.ativo).length}</div><div class="k-sub">${D.locais.filter(l => l.finalidade === 'processo' && l.ativo).length} em processo</div></div>
      <div class="kpi"><div class="k-label">Famílias</div><div class="k-value">${D.familias.filter(f => f.ativo).length}</div><div class="k-sub">${D.familias.filter(f => f.controla_lote).length} controlam lote</div></div>
      <div class="kpi"><div class="k-label">Regras por CFOP</div><div class="k-value">${D.regras.filter(r => r.ativo).length}</div><div class="k-sub">${D.regras.filter(r => r.ativo && !r.tipo_movimento_id).length} não movimentam</div></div>
      <div class="kpi"><div class="k-label">Estoque fechado até</div><div class="k-value">${per.fechadoAte ? MES(per.fechadoAte) : '—'}</div><div class="k-sub">${per.abertoDesde ? 'aceita movimentos a partir de ' + dateBR(per.abertoDesde) : 'nenhum mês fechado'}</div></div>
    </div>
    <div class="chips" id="ep-abas" style="margin:4px 0 10px">${ABAS.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
    <div id="ep-corpo"></div>`;
  $('#ep-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(root); } };
  $('#ep-xls', root).onclick = () => { const t = $('#ep-corpo table', root); if (t) exportXLSX(t, 'estoque_' + ui.aba); };
  $('#ep-padrao', root) && ($('#ep-padrao', root).onclick = async () => {
    if (!await confirmDialog('Criar os locais, famílias, tipos de movimento e regras padrão que estiverem faltando? O que já existe não muda.')) return;
    try { await q(sb.rpc('est_configurar_padrao', { p_empresa: state.empresa.id })); toast('Parametrização completada'); await recarregar(root); } catch (err) { fail(err); }
  });
  ({ locais, familias, tipos, regras, fechamento })[ui.aba](root, ed);
}
async function recarregar(root) { await carregar(); pintar(root); }
const corpo = (root, html) => { $('#ep-corpo', root).innerHTML = html; };
const novoBtn = (ed, id, txt) => ed ? `<div class="toolbar" style="margin:0 0 8px"><span class="spacer"></span><button class="btn primary" id="${id}">${txt}</button></div>` : '';
const clicar = (root, lista, fn) => $$('#ep-corpo tr[data-id]', root).forEach(tr => tr.onclick = () => fn(lista.find(x => x.id === tr.dataset.id)));

/** formulário genérico: campos [{ k, t, tipo: 'text'|'num'|'chk'|'sel'|'multi', op, span }] */
function form({ titulo, campos, v, tabela, root, excluir }) {
  const campo = (c) => {
    const val = v[c.k];
    if (c.tipo === 'chk') return `<label class="chk"><input type="checkbox" data-k="${c.k}" ${val ? 'checked' : ''}> ${c.t}</label>`;
    if (c.tipo === 'sel') return `<label class="${c.span ? 'span2' : ''}">${c.t}<select data-k="${c.k}">${c.vazio !== false ? `<option value="">${c.vazio || '—'}</option>` : ''}${Object.entries(c.op).map(([k, t]) => `<option value="${esc(k)}" ${String(val ?? '') === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    if (c.tipo === 'multi') return `<div class="span2"><div class="small muted">${c.t}</div>${Object.entries(c.op).map(([k, t]) => `<label class="chk" style="display:inline-flex;margin-right:12px"><input type="checkbox" data-m="${c.k}" value="${k}" ${(val || []).includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}<div class="small muted">${c.dica || ''}</div></div>`;
    return `<label class="${c.span ? 'span2' : ''}">${c.t}<input data-k="${c.k}" ${c.tipo === 'num' ? 'type="number"' : ''} value="${esc(val ?? '')}" ${c.ph ? `placeholder="${esc(c.ph)}"` : ''}></label>`;
  };
  const m = modal({ title: titulo, wide: true, body: `<div class="grid-form">${campos.map(campo).join('')}</div>`,
    foot: `${excluir && v.id ? '<button class="btn danger" id="pf-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-ok">Salvar</button>` });
  $('#pf-ok', m.el).onclick = async (ev) => {
    const row = {};
    for (const c of campos) {
      if (c.tipo === 'multi') { const s = $$(`[data-m="${c.k}"]:checked`, m.el).map(x => x.value); row[c.k] = s.length ? s : null; continue; }
      const el = $(`[data-k="${c.k}"]`, m.el);
      row[c.k] = c.tipo === 'chk' ? el.checked : c.tipo === 'num' ? (el.value === '' ? null : +el.value) : (el.value.trim() || null);
      if (c.obrig && row[c.k] == null) return toast(`Informe: ${c.t}`, true);
    }
    ev.target.disabled = true;
    try {
      if (v.id) await q(sb.from(tabela).update(row).eq('id', v.id));
      else await q(sb.from(tabela).insert({ ...row, empresa_id: state.empresa.id }));
      m.close(); toast('Salvo'); await recarregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#pf-del', m.el) && ($('#pf-del', m.el).onclick = async () => {
    if (!await confirmDialog('Excluir? Se já houver movimento ligado, o banco recusa: nesse caso, desative.')) return;
    try { await q(sb.from(tabela).delete().eq('id', v.id)); m.close(); toast('Excluído'); await recarregar(root); } catch (err) { fail(err); }
  });
}

// ------------------------------------------------------------ locais
function locais(root, ed) {
  const set = Object.fromEntries(D.setores.map(s => [s.id, s.nome]));
  corpo(root, `${novoBtn(ed, 'ep-novo', 'Novo local')}<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Local</th><th>Finalidade</th><th>Posse</th><th>Setor</th><th>Controla saldo</th><th>Compõe custo</th><th>Saldo negativo</th><th>Quem movimenta</th><th>Conta contábil</th><th>Situação</th></tr></thead><tbody>
    ${D.locais.map(l => `<tr class="${ed ? 'clickable' : ''}" data-id="${l.id}"><td>${esc(l.codigo)}</td><td class="wrap">${esc(l.nome)}</td><td>${FINALIDADES[l.finalidade]}</td><td class="small">${POSSE[l.posse]}</td><td>${esc(set[l.setor_id] || '')}</td>
      <td>${sim(l.controla_saldo)}</td><td>${sim(l.compoe_custo)}</td><td>${l.permite_negativo ? '<span class="badge vencido">permite</span>' : '<span class="muted">bloqueia</span>'}</td>
      <td class="small">${l.papeis ? l.papeis.map(p => PAPEIS[p] || p).join(', ') : '<span class="muted">todos que movimentam</span>'}</td><td>${esc(l.conta_contabil || '')}</td><td>${l.ativo ? '' : '<span class="badge">inativo</span>'}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">Nenhum local. Use "Completar com o padrão".</td></tr>'}
  </tbody></table></div></div>
  <p class="small muted">"Compõe custo" desligado = não entra no valor do estoque nem no custo médio (ex.: material de terceiros em nosso poder). "Quem movimenta" vazio = todos os perfis que movimentam estoque (administrador, financeiro, diretor, compras e produção); o administrador sempre pode.</p>`);
  const abrir = (l) => ed && form({ titulo: l?.id ? `Local ${l.codigo}` : 'Novo local', tabela: 'est_locais', root, excluir: true, v: l || { finalidade: 'materia_prima', posse: 'propria', controla_saldo: true, compoe_custo: true, ativo: true, ordem: 200 },
    campos: [{ k: 'codigo', t: 'Código', obrig: true }, { k: 'nome', t: 'Nome', obrig: true, span: true }, { k: 'finalidade', t: 'Finalidade', tipo: 'sel', op: FINALIDADES, vazio: false },
      { k: 'posse', t: 'Posse', tipo: 'sel', op: POSSE, vazio: false }, { k: 'setor_id', t: 'Setor da produção (em processo)', tipo: 'sel', op: Object.fromEntries(D.setores.map(s => [s.id, s.nome])) },
      { k: 'conta_contabil', t: 'Conta contábil', ph: 'ex.: 1.1.4.01' }, { k: 'ordem', t: 'Ordem', tipo: 'num' },
      { k: 'controla_saldo', t: 'Controla saldo', tipo: 'chk' }, { k: 'compoe_custo', t: 'Compõe custo', tipo: 'chk' }, { k: 'permite_negativo', t: 'Permite saldo negativo', tipo: 'chk' }, { k: 'ativo', t: 'Ativo', tipo: 'chk' },
      { k: 'papeis', t: 'Quem movimenta (nenhum marcado = todos)', tipo: 'multi', op: { financeiro: 'Financeiro', diretor: 'Diretor', compras: 'Compras', producao: 'Produção' } }] });
  $('#ep-novo', root) && ($('#ep-novo', root).onclick = () => abrir(null));
  clicar(root, D.locais, abrir);
}

// ------------------------------------------------------------ famílias
function familias(root, ed) {
  const planos = Object.fromEntries((state.cad?.contasPlano || []).filter(p => p.tipo === 'S').map(p => [p.id, `${p.codigo} ${p.nome}`]));
  corpo(root, `${novoBtn(ed, 'ep-novo', 'Nova família')}<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Família</th><th>Tipo do item (SPED)</th><th>Local padrão de entrada</th><th>Lote</th><th>Conta na compra</th><th>Situação</th></tr></thead><tbody>
    ${D.familias.map(f => `<tr class="${ed ? 'clickable' : ''}" data-id="${f.id}"><td>${esc(f.codigo)}</td><td>${esc(f.nome)}</td><td>${f.tipo_sped} – ${TIPOS_SPED[f.tipo_sped]}</td><td>${esc(D.loc[f.local_padrao_id]?.nome || '—')}</td>
      <td>${f.controla_lote ? '<span class="badge pago">controla</span>' : ''}</td><td class="small">${esc(planos[f.plano_id] || '')}</td><td>${f.ativo ? '' : '<span class="badge">inativa</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhuma família.</td></tr>'}
  </tbody></table></div></div>
  <p class="small muted">Todo produto pertence a uma família. Ao cadastrar, a família vem da classificação do produto; dela saem o tipo do item no SPED, o local onde a compra entra e o controle por lote (resina pelo lote do fornecedor, bobina pelo número). Trocar a família de um produto leva junto o tipo SPED e o local.</p>`);
  const abrir = (f) => ed && form({ titulo: f?.id ? `Família ${f.codigo}` : 'Nova família', tabela: 'est_familias', root, excluir: true, v: f || { tipo_sped: '07', ativo: true },
    campos: [{ k: 'codigo', t: 'Código', obrig: true }, { k: 'nome', t: 'Nome', obrig: true, span: true }, { k: 'tipo_sped', t: 'Tipo do item (SPED)', tipo: 'sel', op: Object.fromEntries(Object.entries(TIPOS_SPED).map(([k, t]) => [k, `${k} – ${t}`])), vazio: false },
      { k: 'local_padrao_id', t: 'Local padrão de entrada', tipo: 'sel', op: Object.fromEntries(D.locais.filter(l => l.ativo).map(l => [l.id, l.nome])) },
      { k: 'plano_id', t: 'Conta do plano na compra', tipo: 'sel', op: planos, span: true }, { k: 'controla_lote', t: 'Controla lote', tipo: 'chk' }, { k: 'ativo', t: 'Ativa', tipo: 'chk' }] });
  $('#ep-novo', root) && ($('#ep-novo', root).onclick = () => abrir(null));
  clicar(root, D.familias, abrir);
}

// ------------------------------------------------------------ tipos de movimento
function tipos(root, ed) {
  corpo(root, `${novoBtn(ed, 'ep-novo', 'Novo tipo de movimento')}<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Tipo de movimento</th><th>Sentido</th><th>Origem padrão</th><th>Destino padrão</th><th>Forma custo</th><th>Gera financeiro</th><th>Documento</th><th>Situação</th></tr></thead><tbody>
    ${D.tipos.map(t => `<tr class="${ed ? 'clickable' : ''}" data-id="${t.id}"><td>${esc(t.codigo)}${t.sistema ? ' <span class="badge" title="Usado pela plataforma">sistema</span>' : ''}</td><td>${esc(t.nome)}</td><td>${SENTIDOS[t.sentido]}</td>
      <td class="small">${esc(D.loc[t.local_origem_id]?.nome || '')}</td><td class="small">${esc(D.loc[t.local_destino_id]?.nome || '')}</td><td>${sim(t.afeta_custo)}</td><td>${sim(t.gera_financeiro)}</td><td>${DOCUMENTOS[t.documento]}</td><td>${t.ativo ? '' : '<span class="badge">inativo</span>'}</td></tr>`).join('')}
  </tbody></table></div></div>
  <p class="small muted">"Forma custo": a entrada entra pelo custo informado e recalcula o custo médio (compra, produção, saldo inicial). As demais entradas e todas as saídas usam o custo médio do momento. Os tipos "sistema" não se excluem (podem ser desativados).</p>`);
  const L = Object.fromEntries(D.locais.filter(l => l.ativo).map(l => [l.id, l.nome]));
  const abrir = (t) => ed && form({ titulo: t?.id ? `Tipo ${t.codigo}` : 'Novo tipo de movimento', tabela: 'est_tipos_movimento', root, excluir: !t?.sistema, v: t || { sentido: 'S', documento: 'nenhum', ativo: true },
    campos: [{ k: 'codigo', t: 'Código', obrig: true }, { k: 'nome', t: 'Nome', obrig: true, span: true }, { k: 'sentido', t: 'Sentido', tipo: 'sel', op: SENTIDOS, vazio: false },
      { k: 'documento', t: 'Documento exigido', tipo: 'sel', op: DOCUMENTOS, vazio: false }, { k: 'local_origem_id', t: 'Origem padrão', tipo: 'sel', op: L }, { k: 'local_destino_id', t: 'Destino padrão', tipo: 'sel', op: L },
      { k: 'afeta_custo', t: 'Forma custo (entrada pelo custo informado)', tipo: 'chk' }, { k: 'gera_financeiro', t: 'Gera financeiro', tipo: 'chk' }, { k: 'ativo', t: 'Ativo', tipo: 'chk' }] });
  $('#ep-novo', root) && ($('#ep-novo', root).onclick = () => abrir(null));
  clicar(root, D.tipos, abrir);
}

// ------------------------------------------------------------ regras por CFOP
function regras(root, ed) {
  const b = ui.busca.trim();
  const L = D.regras.filter(r => r.sentido === ui.sentido && (!b || r.cfop.includes(b.replace(/\D/g, '').slice(-3)) || (r.observacao || '').toLowerCase().includes(b.toLowerCase())));
  corpo(root, `<div class="toolbar" style="margin:0 0 8px"><div class="chips" id="ep-sent">${[['entrada', 'Entradas (compras e retornos)'], ['saida', 'Saídas (vendas e remessas)']].map(([k, t]) => `<span class="chip ${ui.sentido === k ? 'on' : ''}" data-s="${k}">${t}</span>`).join('')}</div>
      <input id="ep-bus" placeholder="CFOP ou descrição" value="${esc(ui.busca)}"><span class="spacer"></span>${ed ? '<button class="btn primary" id="ep-novo">Nova regra</button>' : ''}</div>
    <div class="card flush"><div class="table-wrap" style="max-height:60vh"><table><thead><tr><th>CFOP</th><th>Quando o item for</th><th>Movimento</th><th>Local</th><th class="num">Prioridade</th><th>Observação</th><th>Situação</th></tr></thead><tbody>
    ${L.map(r => `<tr class="${ed ? 'clickable' : ''}" data-id="${r.id}"><td>${r.cfop.length === 3 ? `x${r.cfop} <span class="small muted">(todas as UF)</span>` : r.cfop}</td>
      <td class="small">${r.familia_id ? 'família ' + esc(D.fam[r.familia_id]?.nome || '?') : r.tipo_sped ? `tipo ${r.tipo_sped} – ${TIPOS_SPED[r.tipo_sped]}` : '<span class="muted">qualquer item</span>'}</td>
      <td>${r.tipo_movimento_id ? esc(D.tm[r.tipo_movimento_id]?.nome || '?') : '<span class="badge">não movimenta</span>'}</td><td class="small">${esc(D.loc[r.local_id]?.nome || (r.tipo_movimento_id ? 'padrão do produto' : ''))}</td>
      <td class="num">${r.prioridade}</td><td class="wrap small">${esc(r.observacao || '')}</td><td>${r.ativo ? '' : '<span class="badge">inativa</span>'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhuma regra.</td></tr>'}
  </tbody></table></div></div>
  <p class="small muted">Cada item de NF-e procura a regra do seu CFOP: o CFOP completo (ex.: 5101) vale mais que o final (x101, que vale para 5101, 6101 e 7101); regra de uma família ou tipo de item vale mais que "qualquer item"; empate, a menor prioridade. Sem local na regra, a entrada vai para o local padrão do produto (da família). Item sem regra fica na fila de pendências do estoque. Os movimentos automáticos pelas notas entram na próxima etapa.</p>`);
  $('#ep-sent', root).onclick = (e) => { const s = e.target.closest('[data-s]')?.dataset.s; if (s) { ui.sentido = s; regras(root, ed); } };
  let t; $('#ep-bus', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.busca = e.target.value; regras(root, ed); $('#ep-bus', root).focus(); }, 300); };
  const abrir = (r) => ed && form({ titulo: r?.id ? `Regra ${r.cfop}` : 'Nova regra por CFOP', tabela: 'est_regras_cfop', root, excluir: true, v: r || { sentido: ui.sentido, prioridade: 100, ativo: true },
    campos: [{ k: 'cfop', t: 'CFOP (4 dígitos ou só o final, 3)', obrig: true }, { k: 'sentido', t: 'Sentido', tipo: 'sel', op: { entrada: 'Entrada', saida: 'Saída' }, vazio: false },
      { k: 'familia_id', t: 'Só para a família', tipo: 'sel', op: Object.fromEntries(D.familias.map(f => [f.id, f.nome])), vazio: 'qualquer' },
      { k: 'tipo_sped', t: 'Só para o tipo de item', tipo: 'sel', op: Object.fromEntries(Object.entries(TIPOS_SPED).map(([k, t]) => [k, `${k} – ${t}`])), vazio: 'qualquer' },
      { k: 'tipo_movimento_id', t: 'Tipo de movimento', tipo: 'sel', op: Object.fromEntries(D.tipos.filter(t => t.ativo && t.sentido !== 'T').map(t => [t.id, `${SENTIDOS[t.sentido]} · ${t.nome}`])), vazio: 'não movimenta estoque', span: true },
      { k: 'local_id', t: 'Local', tipo: 'sel', op: Object.fromEntries(D.locais.filter(l => l.ativo).map(l => [l.id, l.nome])), vazio: 'padrão do produto' },
      { k: 'prioridade', t: 'Prioridade', tipo: 'num' }, { k: 'observacao', t: 'Observação', span: true }, { k: 'ativo', t: 'Ativa', tipo: 'chk' }] });
  $('#ep-novo', root) && ($('#ep-novo', root).onclick = () => abrir(null));
  clicar(root, L, abrir);
}

// ------------------------------------------------------------ fechamento
function fechamento(root, ed) {
  const per = periodoAberto(D.fech);
  const sug = per.abertoDesde || new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10);
  corpo(root, `<div class="card"><p style="margin-top:0">Fechar o mês trava o estoque: nenhum movimento com data até o fim do mês fechado é aceito (correções entram por estorno com data do mês aberto). Fechar um mês fecha também os anteriores. Só o administrador reabre.</p>
    ${ed ? `<div class="toolbar" style="margin:0"><label>Mês<input type="month" id="ep-mes" value="${sug.slice(0, 7)}"></label><button class="btn primary" id="ep-fechar">Fechar o mês</button>${isAdmin() && per.fechadoAte ? `<button class="btn" id="ep-reabrir">Reabrir ${MES(per.fechadoAte)}</button>` : ''}</div>` : ''}</div>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Mês</th><th>Fechado em</th></tr></thead><tbody>
    ${D.fech.map(f => `<tr><td>${MES(f.mes)}</td><td>${dateBR(f.fechado_em)}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Nenhum mês fechado.</td></tr>'}</tbody></table></div></div>`);
  $('#ep-fechar', root) && ($('#ep-fechar', root).onclick = async () => {
    const m = $('#ep-mes', root).value; if (!m) return toast('Escolha o mês', true);
    if (!await confirmDialog(`Fechar o estoque de ${m.slice(5)}/${m.slice(0, 4)}?`)) return;
    try { await q(sb.rpc('est_fechar_mes', { p_empresa: state.empresa.id, p_mes: m + '-01' })); toast('Mês fechado'); await recarregar(root); } catch (err) { fail(err); }
  });
  $('#ep-reabrir', root) && ($('#ep-reabrir', root).onclick = async () => {
    if (!await confirmDialog(`Reabrir ${MES(per.fechadoAte)}? Movimentos com data nesse mês voltam a ser aceitos.`)) return;
    try { await q(sb.rpc('est_fechar_mes', { p_empresa: state.empresa.id, p_mes: per.fechadoAte, p_reabrir: true })); toast('Mês reaberto'); await recarregar(root); } catch (err) { fail(err); }
  });
}

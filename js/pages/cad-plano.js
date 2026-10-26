import { sb, state, q, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, options, modal, formData, toast, fail } from '../lib/ui.js';

export const title = 'Plano de contas';
const SECOES = [['', '(fora da DRE)'], ['receita_bruta', 'Receita operacional bruta'], ['custos_diretos', 'Custos diretos'], ['despesas_operacionais', 'Despesas operacionais'],
  ['receitas_financeiras', 'Receitas financeiras'], ['despesas_financeiras', 'Despesas financeiras'], ['tributos', 'Tributos'],
  ['nao_operacionais', 'Movimentos não operacionais'], ['capital_giro', 'Capital de giro (adiantamentos)']];
const TIPOS = { E: 'Entradas', S: 'Saídas', T: 'Transferências' };

const ui = { busca: '', inativas: true, fechadas: new Set() };
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function marca(txt, termo) {
  const t = norm(termo).trim(); if (!t) return esc(txt);
  const n = norm(txt), k = n.indexOf(t); if (k < 0) return esc(txt);
  return esc(txt.slice(0, k)) + '<mark>' + esc(txt.slice(k, k + t.length)) + '</mark>' + esc(txt.slice(k + t.length));
}

export async function render(root) {
  const ed = podeEditar();
  root.innerHTML = `<div class="card"><div class="card-head"><p class="muted small" style="margin:0;max-width:760px">
      Dois níveis: <strong>classificação</strong> (ex.: 2.05) e <strong>conta</strong> (ex.: 2.05.09). Na classificação você define em qual bloco da DRE ela entra
      e a <strong>prioridade</strong> padrão na Autorização de Pagamentos (Obrigatório / Negociável). Contas usadas em lançamentos não podem ser excluídas — inative-as.</p>
      ${ed ? '<button class="btn primary" id="nova-cl">+ Nova classificação</button>' : ''}</div>
      <div class="toolbar" style="padding:0;margin-top:10px">
        <label class="grow">Buscar<input id="pl-busca" type="search" placeholder="código ou parte do nome — ex.: 2.07, tarifa, juros" value="${esc(ui.busca)}" autocomplete="off"></label>
        <label class="chk"><input type="checkbox" id="pl-inat" ${ui.inativas ? 'checked' : ''}> mostrar inativas</label>
        <button class="btn small" id="pl-rec" type="button">Recolher todas</button><button class="btn small" id="pl-exp" type="button">Expandir todas</button>
        <span class="muted small" id="pl-cont"></span></div></div>
    <div id="pl-corpo"></div>`;
  const pinta = () => pintar(root);
  const b = $('#pl-busca', root);
  b.oninput = () => { ui.busca = b.value; pinta(); };
  b.onkeydown = (e) => { if (e.key === 'Escape') { b.value = ''; ui.busca = ''; pinta(); } };
  $('#pl-inat', root).onchange = (e) => { ui.inativas = e.target.checked; pinta(); };
  $('#pl-rec', root).onclick = () => { state.cad.classes.forEach(cl => ui.fechadas.add(cl.id)); pinta(); };
  $('#pl-exp', root).onclick = () => { ui.fechadas.clear(); pinta(); };
  pinta();
  b.focus();
  root.onclick = (e) => {
    const t = e.target.closest('[data-tg]'); if (t && !e.target.closest('button')) { const id = t.dataset.tg; ui.fechadas.has(id) ? ui.fechadas.delete(id) : ui.fechadas.add(id); pinta(); return; }
    if (!ed) return;
    const c = state.cad;
    const bt = e.target.closest('button'); if (!bt) return;
    if (bt.id === 'nova-cl') editar({ nivel: 1, tipo: 'S', ativo: true }, root);
    if (bt.dataset.ed) editar(c.planoById[bt.dataset.ed], root);
    if (bt.dataset.add) {
      const pai = c.planoById[bt.dataset.add];
      const irm = c.contasPlano.filter(p => p.pai_id === pai.id).map(p => +p.codigo.split('.').pop());
      editar({ nivel: 2, pai_id: pai.id, tipo: pai.tipo, natureza: pai.natureza, ativo: true, codigo: `${pai.codigo}.${String((Math.max(0, ...irm) + 1)).padStart(2, '0')}` }, root);
    }
  };
}

function pintar(root) {
  const c = state.cad, ed = podeEditar(), termo = ui.busca.trim(), t = norm(termo);
  const casa = (p) => !t || norm(p.codigo).startsWith(t) || norm(`${p.codigo} ${p.nome}`).includes(t);
  const vis = (p) => ui.inativas || p.ativo;
  let n = 0;
  const html = ['E', 'S', 'T'].map(tp => {
    const blocos = c.classes.filter(x => x.tipo === tp && vis(x)).map(cl => {
      const filhas = c.contasPlano.filter(p => p.pai_id === cl.id && vis(p));
      const clCasa = casa(cl);
      const fs = t ? (clCasa ? filhas : filhas.filter(casa)) : filhas;
      if (t && !clCasa && !fs.length) return '';
      n += t ? fs.length + (clCasa ? 1 : 0) : 0;
      const fechada = !t && ui.fechadas.has(cl.id);
      return `<tr class="row-l1" data-tg="${cl.id}" style="cursor:pointer" title="Clique para ${fechada ? 'expandir' : 'recolher'}"><td class="nowrap"><span class="muted">${fechada ? '▸' : '▾'}</span> ${marca(cl.codigo, termo)}</td><td>${marca(cl.nome, termo)} <span class="muted small">(${filhas.length})</span></td><td>${esc(SECOES.find(s => s[0] === (cl.dre_secao || ''))[1])}</td>
          <td>${tp === 'S' ? `<span class="badge ${cl.prioridade === 'Obrigatório' ? 'obrig' : 'negoc'}">${cl.prioridade || 'Negociável (padrão)'}</span>` : ''}</td>
          <td>${cl.ativo ? '' : '<span class="badge vencido">inativa</span>'}</td>
          <td class="nowrap">${ed ? `<button class="btn small" data-ed="${cl.id}">Editar</button><button class="btn small" data-add="${cl.id}">+ Conta</button>` : ''}</td></tr>
        ${fechada ? '' : fs.map(p => `<tr><td style="padding-left:30px">${marca(p.codigo, termo)}</td><td>${marca(p.nome, termo)}</td><td></td><td></td>
          <td>${p.ativo ? '' : '<span class="badge vencido">inativa</span>'}</td><td>${ed ? `<button class="btn small" data-ed="${p.id}">Editar</button>` : ''}</td></tr>`).join('')}`;
    }).join('');
    if (!blocos) return '';
    return `<div class="card flush"><div style="padding:16px 16px 0"><h2>${TIPOS[tp]}</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Código</th><th>Nome</th><th>DRE</th><th>Prioridade</th><th>Situação</th><th></th></tr></thead><tbody>${blocos}</tbody></table></div></div>`;
  }).join('');
  $('#pl-corpo', root).innerHTML = html || `<div class="card"><div class="empty">Nenhuma conta com “${esc(termo)}”.</div></div>`;
  $('#pl-cont', root).textContent = t ? `${n} encontrada(s)` : '';
}

function editar(p, root) {
  const l1 = p.nivel === 1;
  const m = modal({
    title: p.id ? `Editar ${p.codigo}` : (l1 ? 'Nova classificação' : 'Nova conta'),
    body: `<form id="pf" class="grid-form">
      <label>Código<input name="codigo" value="${esc(p.codigo || '')}" required placeholder="${l1 ? '2.15' : '2.05.30'}"></label>
      <label class="span2">Nome<input name="nome" value="${esc(p.nome || '')}" required></label>
      ${l1 ? `<label>Tipo<select name="tipo" ${p.id ? 'disabled' : ''}>${options(Object.entries(TIPOS).map(([id, nome]) => ({ id, nome })), { selected: p.tipo })}</select></label>
      <label>Natureza (transferências)<select name="natureza" ${p.id ? 'disabled' : ''}><option value="">Automática</option><option value="C" ${p.natureza === 'C' ? 'selected' : ''}>Crédito (+)</option><option value="D" ${p.natureza === 'D' ? 'selected' : ''}>Débito (−)</option></select></label>
      <label>Bloco da DRE<select name="dre_secao">${options(SECOES.map(([id, nome]) => ({ id, nome })), { selected: p.dre_secao || '' })}</select></label>
      <label>Prioridade (saídas)<select name="prioridade"><option value="">Negociável (padrão)</option>${options([{ id: 'Obrigatório' }, { id: 'Negociável' }], { label: 'id', selected: p.prioridade })}</select></label>` : ''}
      <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''}> Ativa</label>
    </form>`,
    foot: `${p.id ? '<button class="btn danger" id="pdel" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="psave">Salvar</button>`,
  });
  $('#psave', m.el).onclick = async () => {
    const form = $('#pf', m.el); if (!form.reportValidity()) return;
    const d = formData(form);
    const row = { codigo: d.codigo.trim(), nome: d.nome.trim(), ativo: !!d.ativo };
    if (l1) {
      row.dre_secao = d.dre_secao || null; row.prioridade = d.prioridade || null;
      if (!p.id) { row.tipo = d.tipo; row.natureza = d.natureza || (d.tipo === 'E' ? 'C' : 'D'); }
    }
    try {
      if (p.id) await q(sb.from('plano_contas').update(row).eq('id', p.id));
      else await q(sb.from('plano_contas').insert({ ...row, empresa_id: state.empresa.id, nivel: p.nivel, pai_id: p.pai_id || null, tipo: row.tipo || p.tipo, natureza: row.natureza || p.natureza }));
      await loadCadastros(true); toast('Plano de contas salvo'); m.close(); render(root);
    } catch (e) { fail(e); }
  };
  if (p.id) $('#pdel', m.el).onclick = async () => {
    if (!confirm('Excluir? Só é possível se não houver lançamentos nesta conta.')) return;
    try { await q(sb.from('plano_contas').delete().eq('id', p.id)); await loadCadastros(true); toast('Excluído'); m.close(); render(root); }
    catch (e) { fail(e.code === '23503' ? new Error('Há lançamentos usando esta conta. Inative-a em vez de excluir.') : e); }
  };
}

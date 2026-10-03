import { sb, state, q, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, options, modal, formData, toast, fail } from '../lib/ui.js';

export const title = 'Plano de contas';
const SECOES = [['', '(fora da DRE)'], ['receita_bruta', 'Receita operacional bruta'], ['custos_diretos', 'Custos diretos'], ['despesas_operacionais', 'Despesas operacionais'],
  ['receitas_financeiras', 'Receitas financeiras'], ['despesas_financeiras', 'Despesas financeiras'], ['tributos', 'Tributos'],
  ['nao_operacionais', 'Movimentos não operacionais'], ['capital_giro', 'Capital de giro (adiantamentos)']];
const TIPOS = { E: 'Entradas', S: 'Saídas', T: 'Transferências' };

export async function render(root) {
  const c = state.cad, ed = podeEditar();
  root.innerHTML = `<div class="card"><div class="card-head"><p class="muted small" style="margin:0;max-width:760px">
      Dois níveis: <strong>classificação</strong> (ex.: 2.05) e <strong>conta</strong> (ex.: 2.05.09). Na classificação você define em qual bloco da DRE ela entra
      e a <strong>prioridade</strong> padrão na Autorização de Pagamentos (Obrigatório / Negociável). Contas usadas em lançamentos não podem ser excluídas — inative-as.</p>
      ${ed ? '<button class="btn primary" id="nova-cl">+ Nova classificação</button>' : ''}</div></div>
    ${['E', 'S', 'T'].map(t => `<div class="card flush"><div style="padding:16px 16px 0"><h2>${TIPOS[t]}</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Código</th><th>Nome</th><th>DRE</th><th>Prioridade</th><th>Situação</th><th></th></tr></thead><tbody>
      ${c.classes.filter(x => x.tipo === t).map(cl => `
        <tr class="row-l1"><td>${esc(cl.codigo)}</td><td>${esc(cl.nome)}</td><td>${esc(SECOES.find(s => s[0] === (cl.dre_secao || ''))[1])}</td>
          <td>${t === 'S' ? `<span class="badge ${cl.prioridade === 'Obrigatório' ? 'obrig' : 'negoc'}">${cl.prioridade || 'Negociável (padrão)'}</span>` : ''}</td>
          <td>${cl.ativo ? '' : '<span class="badge vencido">inativa</span>'}</td>
          <td>${ed ? `<button class="btn small" data-ed="${cl.id}">Editar</button><button class="btn small" data-add="${cl.id}">+ Conta</button>` : ''}</td></tr>
        ${c.contasPlano.filter(p => p.pai_id === cl.id).map(p => `<tr><td style="padding-left:22px">${esc(p.codigo)}</td><td>${esc(p.nome)}</td><td></td><td></td>
          <td>${p.ativo ? '' : '<span class="badge vencido">inativa</span>'}</td><td>${ed ? `<button class="btn small" data-ed="${p.id}">Editar</button>` : ''}</td></tr>`).join('')}`).join('')}
      </tbody></table></div></div>`).join('')}`;
  if (!ed) return;
  root.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'nova-cl') editar({ nivel: 1, tipo: 'S', ativo: true }, root);
    if (b.dataset.ed) editar(c.planoById[b.dataset.ed], root);
    if (b.dataset.add) {
      const pai = c.planoById[b.dataset.add];
      const irm = c.contasPlano.filter(p => p.pai_id === pai.id).map(p => +p.codigo.split('.').pop());
      editar({ nivel: 2, pai_id: pai.id, tipo: pai.tipo, natureza: pai.natureza, ativo: true, codigo: `${pai.codigo}.${String((Math.max(0, ...irm) + 1)).padStart(2, '0')}` }, root);
    }
  };
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

// Formulário de lançamento (novo / editar / duplicar) reutilizado em várias telas
import { sb, state, q, podeEditar, loadCadastros } from './data.js';
import { modal, options, esc, $, toast, fail, parseNum, today, money } from './ui.js';

export function planoOptions(selected, tipos = ['E', 'S', 'T']) {
  const c = state.cad;
  return c.classes.filter(cl => tipos.includes(cl.tipo) && cl.ativo).map(cl => {
    const filhos = c.contasPlano.filter(p => p.pai_id === cl.id && (p.ativo || p.id === selected));
    if (!filhos.length) return '';
    return `<optgroup label="${esc(cl.label)}">${options(filhos, { label: 'label', selected })}</optgroup>`;
  }).join('');
}

export function favDatalist() {
  return `<datalist id="dl-fav">${state.cad.favorecidos.filter(f => f.ativo).map(f => `<option value="${esc(f.label)}">`).join('')}</datalist>`;
}

async function resolverFavorecido(label, plano) {
  if (!label) return null;
  const c = state.cad;
  const found = c.favorecidos.find(f => f.label.toLowerCase() === label.toLowerCase().trim())
    || c.favorecidos.find(f => f.nome.toLowerCase() === label.toLowerCase().trim());
  if (found) return found.id;
  // cria favorecido novo automaticamente
  const tipo = plano?.tipo === 'E' ? 'CLIENTES' : 'FORNECEDORES';
  const sigla = tipo === 'CLIENTES' ? 'CLI' : 'FOR';
  let nome = label.trim();
  const m = nome.match(/^([A-ZÁÉÍÓÚÇ]{3})\s*-\s*(.+)$/); if (m) nome = m[2];
  const novo = await q(sb.from('favorecidos').insert({ empresa_id: state.empresa.id, tipo, sigla, nome: nome.toUpperCase() }).select().single());
  toast(`Favorecido "${novo.nome}" cadastrado`);
  await loadCadastros(true);
  return novo.id;
}

/**
 * Abre o modal do lançamento. `base` pode ser um lançamento existente (editar) ou parcial (novo).
 * `onSaved` é chamado após salvar/excluir.
 */
export function abrirLancamento(base = {}, onSaved = () => {}, { duplicar = false } = {}) {
  const c = state.cad;
  const editando = base.id && !duplicar;
  const l = { data: today(), status: 'Pago', ...base };
  const fav = l.favorecido_id ? c.favById[l.favorecido_id]?.label : '';
  const ro = !podeEditar();
  const body = `<form id="lanc-form" class="grid-form">
    <label>Data / vencimento<input type="date" name="data" value="${esc(l.data)}" required></label>
    <label>Status<select name="status">${options([{ id: 'Pago' }, { id: 'Em aberto' }], { label: 'id', selected: l.status })}</select></label>
    <label>Valor (R$)<input name="valor" inputmode="decimal" value="${l.valor != null ? money(l.valor) : ''}" required placeholder="0,00"></label>
    <label class="span2">Plano de contas<select name="plano_id" required><option value="">Selecione…</option>${planoOptions(l.plano_id)}</select></label>
    <label>Conta / banco<select name="conta_id">${options(c.contas.filter(x => x.ativo || x.id === l.conta_id), { empty: '(sem conta)', selected: l.conta_id })}</select></label>
    <label class="span2">Descrição<input name="descricao" value="${esc(l.descricao)}"></label>
    <label>Centro de custo<select name="centro_custo_id">${options(c.cc, { empty: '—', selected: l.centro_custo_id })}</select></label>
    <label class="span2">Favorecido<input name="favorecido" list="dl-fav" value="${esc(fav)}" placeholder="Digite para buscar ou cadastrar">${favDatalist()}</label>
    <label>Prioridade (pagamentos)<select name="prioridade"><option value="">Padrão da classificação</option>${options([{ id: 'Obrigatório' }, { id: 'Negociável' }], { label: 'id', selected: l.prioridade })}</select></label>
    <label>NF / documento<input name="documento" value="${esc(l.documento)}" placeholder="ex.: 36077-1"></label>
    <label>Emissão<input type="date" name="emissao" value="${esc(l.emissao || '')}"></label>
    <label>Opcional 1<input name="opc1" value="${esc(l.opc1)}"></label>
    <label>Opcional 2<input name="opc2" value="${esc(l.opc2)}"></label>
    <label>Opcional 3<input name="opc3" value="${esc(l.opc3)}"></label>
    <label>Opcional 4<input name="opc4" value="${esc(l.opc4)}"></label>
  </form>`;
  const foot = ro ? '<button class="btn" data-close>Fechar</button>' :
    `${editando ? '<button class="btn danger" id="lf-del" style="margin-right:auto">Excluir</button><button class="btn" id="lf-dup">Duplicar</button>' : ''}
     <button class="btn" data-close>Cancelar</button><button class="btn primary" id="lf-save">Salvar</button>`;
  const m = modal({ title: editando ? 'Editar lançamento' : 'Novo lançamento', body: (editando && l.fidc_proposta_id ? '<p class="small muted" style="margin-top:0">Título vinculado a uma proposta de borderô FIDC.</p>' : '') + body, foot });
  const form = $('#lanc-form', m.el);
  if (ro) form.querySelectorAll('input,select').forEach(i => i.disabled = true);
  if (ro) return;
  // lançamento conciliado com o extrato: só descrição e opcionais; sem exclusão
  const LIVRES = ['descricao', 'opc1', 'opc2', 'opc3', 'opc4'];
  let conciliado = false;
  if (editando) {
    q(sb.from('conciliacoes').select('id').eq('lancamento_id', l.id).limit(1)).then((r) => {
      if (!r?.length) return;
      conciliado = true;
      form.querySelectorAll('input,select').forEach(i => { if (!LIVRES.includes(i.name)) i.disabled = true; });
      $('#lf-del', m.el)?.remove();
      form.insertAdjacentHTML('beforebegin', '<p class="small" style="margin-top:0"><span class="badge pago">conciliado</span> Lançamento conciliado com o extrato bancário: só a descrição e os opcionais podem ser alterados. Para mudar valor, data, conta ou classificação, desfaça a conciliação em Conciliação Bancária.</p>');
    }).catch(() => {});
  }

  $('#lf-save', m.el).onclick = async () => {
    if (!form.reportValidity()) return;
    const fd = Object.fromEntries(new FormData(form).entries());
    if (conciliado) {
      try {
        const salvo = await q(sb.from('lancamentos').update(Object.fromEntries(LIVRES.map(k => [k, (fd[k] || '').trim() || null]))).eq('id', l.id).select().single());
        toast('Descrição salva'); m.close(); onSaved(salvo);
      } catch (e) { fail(e); }
      return;
    }
    try {
      const plano = c.planoById[fd.plano_id];
      const row = {
        empresa_id: state.empresa.id, data: fd.data, status: fd.status, valor: Math.abs(parseNum(fd.valor)),
        plano_id: fd.plano_id, conta_id: fd.conta_id || null, descricao: fd.descricao || null,
        centro_custo_id: fd.centro_custo_id || null, prioridade: fd.prioridade || null,
        opc1: fd.opc1 || null, opc2: fd.opc2 || null, opc3: fd.opc3 || null, opc4: fd.opc4 || null,
        documento: (fd.documento || '').trim() || null, emissao: fd.emissao || null,
        favorecido_id: await resolverFavorecido(fd.favorecido, plano),
      };
      if (!row.valor) throw new Error('Informe um valor maior que zero');
      let salvo;
      if (editando) salvo = await q(sb.from('lancamentos').update(row).eq('id', l.id).select().single());
      else salvo = await q(sb.from('lancamentos').insert(row).select().single());
      toast('Lançamento salvo'); m.close(); onSaved(salvo);
    } catch (e) { fail(e); }
  };
  if (editando) {
    $('#lf-del', m.el).onclick = async () => {
      if (!confirm('Excluir este lançamento?')) return;
      try { await q(sb.from('lancamentos').delete().eq('id', l.id)); toast('Lançamento excluído'); m.close(); onSaved(); } catch (e) { fail(e); }
    };
    $('#lf-dup', m.el).onclick = () => { m.close(); abrirLancamento({ ...l, id: undefined }, onSaved, { duplicar: true }); };
  }
}

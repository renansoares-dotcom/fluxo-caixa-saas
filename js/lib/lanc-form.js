// Formulário de lançamento (novo / editar / duplicar) reutilizado em várias telas
import { sb, state, q, podeEditar, loadCadastros } from './data.js';
import { modal, options, esc, $, toast, fail, parseNum, today, money } from './ui.js';
import { conversaNoModal } from './mini-chat.js';

// transferência é um lançamento só (origem → destino) no plano de saída 3.02; os planos de entrada de transferência
// (3.01) só aparecem quando o lançamento já é um deles (transferências antigas, em duas pontas)
export const ehTransfUnica = (p) => p?.tipo === 'T' && p?.natureza === 'D';
export function planoOptions(selected, tipos = ['E', 'S', 'T']) {
  const c = state.cad;
  return c.classes.filter(cl => tipos.includes(cl.tipo) && cl.ativo).map(cl => {
    const filhos = c.contasPlano.filter(p => p.pai_id === cl.id && (p.ativo || p.id === selected) && !(p.tipo === 'T' && p.natureza === 'C' && p.id !== selected));
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
    <label><span id="lf-lconta">Conta / banco</span><select name="conta_id">${options(c.contas.filter(x => x.ativo || x.id === l.conta_id), { empty: '(sem conta)', selected: l.conta_id })}</select></label>
    <label id="lf-dest" hidden>Para a conta (destino)<select name="conta_destino_id">${options(c.contas.filter(x => x.ativo || x.id === l.conta_destino_id), { empty: 'Selecione…', selected: l.conta_destino_id })}</select></label>
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
    <fieldset id="lf-enc" class="span2" style="grid-column:1/-1;border:1px solid var(--line, #ddd);border-radius:8px;padding:8px 12px;margin:4px 0 0" hidden>
      <legend class="small" style="padding:0 4px">Juros e multa (pago com atraso)</legend>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label>Juros (R$)<input name="enc_juros" inputmode="decimal" placeholder="0,00"></label>
        <label>Multa (R$)<input name="enc_multa" inputmode="decimal" placeholder="0,00"></label>
        <label>Desconto (R$)<input name="enc_desconto" inputmode="decimal" placeholder="0,00"></label>
        <div class="small" id="lf-enc-tot" style="padding-bottom:8px"></div>
      </div>
      <p class="small muted" style="margin:6px 0 0" id="lf-enc-info"></p>
    </fieldset>
  </form>`;
  const hist = editando && ['admin', 'diretor'].includes(state.papel) ? '<button class="btn ghost" id="lf-hist">Histórico</button>' : '';
  const foot = ro ? `${hist}<button class="btn" data-close>Fechar</button>` :
    `${editando ? '<button class="btn danger" id="lf-del" style="margin-right:auto">Excluir</button>' + hist + '<button class="btn" id="lf-dup">Duplicar</button>' : ''}
     <button class="btn" data-close>Cancelar</button><button class="btn primary" id="lf-save">Salvar</button>`;
  const m = modal({ title: editando ? 'Editar lançamento' : 'Novo lançamento', body: (editando && l.fidc_proposta_id ? '<p class="small muted" style="margin-top:0">Título vinculado a uma proposta de borderô FIDC.</p>' : '') + body, foot });
  if (editando) conversaNoModal(m, 'lancamento', l.id);
  const form = $('#lanc-form', m.el);
  // transferência: "De" (conta) → "Para" (destino)
  const modoTransf = () => {
    const t = ehTransfUnica(c.planoById[form.plano_id.value]);
    $('#lf-dest', m.el).hidden = !t; form.conta_destino_id.required = t && !l.id ? true : t && !!l.conta_destino_id;
    $('#lf-lconta', m.el).textContent = t ? 'De (conta de origem)' : 'Conta / banco';
    form.conta_id.required = t;
  };
  form.plano_id.addEventListener('change', modoTransf); modoTransf();
  // juros, multa e desconto: lançamentos próprios ligados ao título (origem encargo:<id>:<tipo>), mesma data e conta
  let encExist = [];
  const encBox = $('#lf-enc', m.el);
  const encModo = () => {
    const p = c.planoById[form.plano_id.value];
    const ok = form.status.value === 'Pago' && p && !ehTransfUnica(p) && p.tipo !== 'T';
    encBox.hidden = !ok && !encExist.length;
    if (!p) return;
    const pl = planosEncargo(p);
    $('#lf-enc-info', m.el).textContent = `Viram lançamentos separados, na mesma data e conta: juros em ${pl.juros?.label || '—'}, multa em ${pl.multa?.label || '—'}, desconto em ${pl.desconto?.label || '—'}. O valor do título continua o original.`;
    const v = Math.abs(parseNum(form.valor.value) || 0), j = parseNum(form.enc_juros.value) || 0, mu = parseNum(form.enc_multa.value) || 0, d = parseNum(form.enc_desconto.value) || 0;
    $('#lf-enc-tot', m.el).innerHTML = j || mu || d ? `Total ${p.natureza === 'C' ? 'recebido' : 'pago'}: <strong>${money(v + j + mu - d)}</strong>` : '';
  };
  form.addEventListener('input', encModo); form.addEventListener('change', encModo);
  if (editando) {
    q(sb.from('lancamentos').select('id,valor,plano_id,origem').eq('empresa_id', state.empresa.id).like('origem', `encargo:${l.id}:%`)).then((r) => {
      encExist = r || [];
      for (const x of encExist) { const t = x.origem.split(':')[2]; if (form['enc_' + t]) form['enc_' + t].value = money(x.valor); }
      encModo();
    }).catch(() => {});
  }
  encModo();
  $('#lf-hist', m.el) && ($('#lf-hist', m.el).onclick = async () => {
    const { abrirHistorico } = await import(`../pages/auditoria.js?v=${Date.now()}`); abrirHistorico('lancamentos', l.id);
  });
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
        conta_destino_id: ehTransfUnica(plano) ? (fd.conta_destino_id || null) : null,
        centro_custo_id: fd.centro_custo_id || null, prioridade: fd.prioridade || null,
        opc1: fd.opc1 || null, opc2: fd.opc2 || null, opc3: fd.opc3 || null, opc4: fd.opc4 || null,
        documento: (fd.documento || '').trim() || null, emissao: fd.emissao || null,
        favorecido_id: await resolverFavorecido(fd.favorecido, plano),
      };
      if (!row.valor) throw new Error('Informe um valor maior que zero');
      if (row.conta_destino_id && row.conta_destino_id === row.conta_id) throw new Error('A conta de destino precisa ser diferente da conta de origem');
      let salvo;
      if (editando) salvo = await q(sb.from('lancamentos').update(row).eq('id', l.id).select().single());
      else salvo = await q(sb.from('lancamentos').insert(row).select().single());
      let encMsg = '';
      try { encMsg = await gravarEncargos(salvo, plano, { juros: parseNum(fd.enc_juros) || 0, multa: parseNum(fd.enc_multa) || 0, desconto: parseNum(fd.enc_desconto) || 0 }, encExist); }
      catch (e) { fail(new Error(`Lançamento salvo, mas juros/multa não: ${e.message || e}`)); }
      toast('Lançamento salvo' + encMsg); m.close(); onSaved(salvo);
      avisarCaixaNegativo(salvo);
    } catch (e) { fail(e); }
  };
  if (editando) {
    $('#lf-del', m.el).onclick = async () => {
      if (!confirm('Excluir este lançamento?')) return;
      try {
        await q(sb.from('lancamentos').delete().eq('id', l.id));
        if (encExist.length) await sb.from('lancamentos').delete().in('id', encExist.map(x => x.id));   // juros/multa do título (os conciliados ficam)
        toast('Lançamento excluído'); m.close(); onSaved();
      } catch (e) { fail(e); }
    };
    $('#lf-dup', m.el).onclick = () => { m.close(); abrirLancamento({ ...l, id: undefined }, onSaved, { duplicar: true }); };
  }
}

// dinheiro em espécie (conta do tipo Caixa) não pode terminar o dia negativo: avisa logo depois de salvar
async function avisarCaixaNegativo(l) {
  if (!l || l.status !== 'Pago') return;
  const contas = [l.conta_id, l.conta_destino_id].filter(id => id && /^caixa$/i.test(state.cad.contaById[id]?.tipo || ''));
  if (!contas.length) return;
  try {
    const s = await q(sb.rpc('saldos_contas', { p_empresa: state.empresa.id, p_ate: l.data }));
    for (const id of contas) {
      const x = s.find(r => r.conta_id === id);
      if (x && +x.saldo_pago < -0.005) toast(`Atenção: ${state.cad.contaById[id].nome} termina ${l.data.split('-').reverse().join('/')} NEGATIVO (${money(x.saldo_pago)}). Caixa em espécie não pode ficar negativo: falta lançar a entrada (saque/suprimento) ou há saída a mais.`, true);
    }
  } catch { /* só aviso */ }
}

// planos de juros/multa/desconto conforme o título seja pagamento (D) ou recebimento (C)
export function planosEncargo(p) {
  const by = (cod) => state.cad.plano.find(x => x.codigo === cod) || null;
  return p?.natureza === 'C'
    ? { juros: by('1.02.17'), multa: by('1.02.17'), desconto: by('2.07.05') }
    : { juros: by('2.07.10'), multa: by('2.07.05'), desconto: by('1.02.15') };
}

/** Cria/atualiza/remove os lançamentos de juros, multa e desconto do título `t` (só quando pago). */
export async function gravarEncargos(t, plano, vals, existentes = []) {
  const pl = planosEncargo(plano), out = [];
  const pago = t.status === 'Pago' && !ehTransfUnica(plano) && plano?.tipo !== 'T';
  for (const tipo of ['juros', 'multa', 'desconto']) {
    const v = pago ? Math.round(Math.abs(vals[tipo] || 0) * 100) / 100 : 0;
    const ex = existentes.find(x => x.origem === `encargo:${t.id}:${tipo}`);
    const nome = { juros: 'Juros', multa: 'Multa', desconto: 'Desconto' }[tipo];
    const row = { empresa_id: t.empresa_id, data: t.data, status: 'Pago', valor: v, plano_id: pl[tipo]?.id, conta_id: t.conta_id,
      favorecido_id: t.favorecido_id, centro_custo_id: t.centro_custo_id, documento: t.documento,
      descricao: `${nome} — ${t.descricao || t.documento || 'título'}`.slice(0, 500), origem: `encargo:${t.id}:${tipo}` };
    if (v > 0 && !pl[tipo]) throw new Error(`plano de ${nome.toLowerCase()} não encontrado`);
    if (ex && v <= 0) { await q(sb.from('lancamentos').delete().eq('id', ex.id)); out.push(`${nome.toLowerCase()} removido`); }
    else if (ex) { await q(sb.from('lancamentos').update(row).eq('id', ex.id)); if (Math.abs(+ex.valor - v) > 0.005) out.push(`${nome.toLowerCase()} ${money(v)}`); }   // mantém data/conta iguais às do título
    else if (v > 0) { await q(sb.from('lancamentos').insert(row)); out.push(`${nome.toLowerCase()} ${money(v)}`); }
  }
  return out.length ? ' · ' + out.join(', ') : '';
}

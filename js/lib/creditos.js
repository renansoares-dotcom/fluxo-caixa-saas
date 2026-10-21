// Créditos e adiantamentos de clientes e fornecedores e o uso deles nas parcelas das notas.
// - adiantamento: o cliente pagou (ou a IPLAMM pagou ao fornecedor) antes de existir a nota
// - devolução / desconto / acordo / outro: crédito que o cliente tem a abater
// - pagamento a maior: o pagamento ligado à nota passou do valor dela; a diferença fica de crédito com o fornecedor
// O uso do crédito numa parcela conta como recebido (ou pago) sem movimento de caixa — o caixa já entrou/saiu
// quando o adiantamento foi recebido/pago. O crédito também pode ser DEVOLVIDO EM DINHEIRO: o uso fica ligado ao
// lançamento em que o dinheiro voltou (creditos_usos.lancamento_id), sem nota.
import { sb, state, q, fetchAll, podeEditar } from './data.js';
import { $, esc, money, dateBR, fail, toast, modal, options, parseNum } from './ui.js';

export const TIPOS = { adiantamento: 'Adiantamento', pago_maior: 'Pagamento a maior', devolucao: 'Crédito por devolução', desconto: 'Desconto / abatimento', acordo: 'Acordo comercial', outro: 'Outro crédito' };
const dig = (s) => String(s || '').replace(/\D/g, '');
const chunks = (a, k = 150) => { const o = []; for (let i = 0; i < a.length; i += k) o.push(a.slice(i, i + k)); return o; };

/** Usos de crédito por nota: Map nota_id → [{id, parcela_id, valor, data, credito}]. Sem a estrutura no banco → Map vazio e CRED.ok = false. */
export const CRED = { ok: true };
export async function usosPorNota(notaIds) {
  const out = new Map(); if (!notaIds.length) return out;
  try {
    for (const c of chunks(notaIds)) for (const u of await q(sb.from('creditos_usos').select('id,nota_id,parcela_id,valor,data,observacao,c:creditos(id,tipo,descricao,data,natureza)').in('nota_id', c)))
      (out.get(u.nota_id) || out.set(u.nota_id, []).get(u.nota_id)).push(u);
    CRED.ok = true;
  } catch { CRED.ok = false; }
  return out;
}

/** favorecidos do mesmo grupo de CNPJ (raiz) — cadastros duplicados do mesmo cliente enxergam os mesmos créditos */
export function mesmoGrupo(favId) {
  const f = state.cad.favById[favId]; const r = dig(f?.documento).slice(0, 8);
  if (!r || r.length < 8) return [favId].filter(Boolean);
  return state.cad.favorecidos.filter(x => dig(x.documento).slice(0, 8) === r).map(x => x.id);
}

/** Créditos com saldo: [{...credito, usado, saldo}] */
export async function creditosComSaldo({ favorecidos = null, natureza = null, todos = false } = {}) {
  let qy = sb.from('creditos').select('*, u:creditos_usos(valor)').eq('empresa_id', state.empresa.id).eq('cancelado', false);
  if (natureza) qy = qy.eq('natureza', natureza);
  if (favorecidos) qy = qy.in('favorecido_id', favorecidos);
  const rows = await q(qy.order('data'));
  return rows.map(c => { const usado = (c.u || []).reduce((s, u) => s + +u.valor, 0); return { ...c, usado, saldo: +(+c.valor - usado).toFixed(2) }; })
    .filter(c => todos || c.saldo > 0.005);
}

/** Usar crédito do cliente/fornecedor nas parcelas da nota `n` (com n.parcelas e o recebido por parcela em recPorParc). */
export async function usarCredito(n, recPorParc, onDone) {
  const natureza = n.tipo === 'saida' ? 'cliente' : 'fornecedor';
  if (!n.favorecido_id) return toast('A nota não está ligada a um cadastro de cliente/fornecedor (Beneficiários).', true);
  let creds;
  try { creds = await creditosComSaldo({ favorecidos: mesmoGrupo(n.favorecido_id), natureza }); } catch (e) { return fail(new Error('A estrutura de créditos ainda não foi instalada no banco (rodar o SQL de créditos e adiantamentos).')); }
  const parc = n.parcelas.map(p => ({ ...p, falta: +(+p.valor - (recPorParc.get(p.id) || 0)).toFixed(2) })).filter(p => p.falta > 0.005);
  if (!creds.length) return toast(`${natureza === 'cliente' ? 'O cliente' : 'O fornecedor'} não tem crédito com saldo. Cadastre em Movimento › Créditos e adiantamentos.`, true);
  if (!parc.length) return toast('Todas as parcelas já estão quitadas.', true);
  const m = modal({ title: `Usar crédito — NF ${n.numero}`, wide: true, body: `
    <p class="small muted" style="margin-top:0">A parcela passa a contar como ${natureza === 'cliente' ? 'recebida' : 'paga'} no valor usado, sem movimento de caixa (o dinheiro entrou/saiu quando o crédito nasceu).</p>
    <label>Crédito<select id="cr">${creds.map(c => `<option value="${c.id}">${esc(TIPOS[c.tipo])} · ${dateBR(c.data)} · saldo ${money(c.saldo)}${c.descricao ? ' · ' + esc(c.descricao.slice(0, 50)) : ''}</option>`).join('')}</select></label>
    <label>Data do uso<input type="date" id="dt" value="${new Date().toISOString().slice(0, 10)}"></label>
    <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Falta</th><th class="num">Usar do crédito</th></tr></thead><tbody>
    ${parc.map(p => `<tr><td>${p.numero}</td><td>${dateBR(p.vencimento)}</td><td class="num">${money(p.valor)}</td><td class="num">${money(p.falta)}</td><td class="num"><input data-p="${p.id}" data-falta="${p.falta}" style="width:120px;text-align:right" value=""></td></tr>`).join('')}
    </tbody></table></div><p class="small" id="tot"></p>
    <label>Observação<input id="obs" placeholder="ex.: cliente pagou a diferença; crédito da devolução NF 34311"></label>`,
    foot: '<button class="btn" id="auto">Preencher com o saldo</button><span style="flex:1"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Usar crédito</button>' });
  const cred = () => creds.find(c => c.id === $('#cr', m.el).value);
  const lidos = () => [...m.el.querySelectorAll('[data-p]')].map(i => ({ parcela_id: i.dataset.p, falta: +i.dataset.falta, valor: parseNum(i.value) || 0 })).filter(x => x.valor > 0);
  const tot = () => { const t = lidos().reduce((s, x) => s + x.valor, 0); $('#tot', m.el).innerHTML = `Total a usar: <strong>${money(t)}</strong> · saldo do crédito ${money(cred()?.saldo)}${t > (cred()?.saldo || 0) + 0.005 ? ' <span class="neg">— passa do saldo</span>' : ''}`; };
  m.el.addEventListener('input', tot); $('#cr', m.el).onchange = tot; tot();
  $('#auto', m.el).onclick = () => { let s = cred()?.saldo || 0; for (const i of m.el.querySelectorAll('[data-p]')) { const u = Math.min(+i.dataset.falta, s); i.value = u > 0 ? u.toFixed(2).replace('.', ',') : ''; s -= u; } tot(); };
  $('#ok', m.el).onclick = async () => {
    const L = lidos(), c = cred(), t = L.reduce((s, x) => s + x.valor, 0);
    if (!L.length) return toast('Informe quanto usar em pelo menos uma parcela', true);
    if (L.some(x => x.valor > x.falta + 0.005)) return toast('O valor usado não pode passar do que falta na parcela', true);
    if (t > c.saldo + 0.005) return toast('O total passa do saldo do crédito', true);
    try {
      await q(sb.from('creditos_usos').insert(L.map(x => ({ empresa_id: state.empresa.id, credito_id: c.id, nota_id: n.id, parcela_id: x.parcela_id, data: $('#dt', m.el).value, valor: +x.valor.toFixed(2), observacao: $('#obs', m.el).value.trim() || null }))));
      toast(`Crédito de ${money(t)} usado na NF ${n.numero}`); m.close(); onDone && onDone();
    } catch (e) { fail(e); }
  };
}

export async function desfazerUso(uso, onDone) {
  if (!confirm(`Desfazer o uso de ${money(uso.valor)} do crédito nesta nota? O valor volta para o saldo do crédito.`)) return;
  try { await q(sb.from('creditos_usos').delete().eq('id', uso.id)); toast('Uso desfeito'); onDone && onDone(); } catch (e) { fail(e); }
}

/** Formulário de novo crédito/adiantamento. preset = { natureza, favorecido_id, tipo } */
export function novoCredito(preset = {}, onDone) {
  const favs = state.cad.favorecidos;
  const m = modal({ title: 'Novo crédito / adiantamento', wide: true, body: `
    <div class="grid2">
      <label>De quem<select id="nat"><option value="cliente">Cliente (crédito a abater nas notas de venda)</option><option value="fornecedor">Fornecedor (adiantamento a abater nas notas de compra)</option></select></label>
      <label>Tipo<select id="tp">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label class="grow">Cliente / fornecedor<input id="fav" list="favs" placeholder="digite o nome ou CNPJ"><datalist id="favs">${favs.map(f => `<option value="${esc(f.nome)}${f.documento ? ' · ' + esc(f.documento) : ''}"></option>`).join('')}</datalist></label>
      <label>Data<input type="date" id="dt" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Valor<input id="vl" placeholder="0,00"></label>
      <label class="grow">Descrição<input id="ds" placeholder="ex.: PIX antecipado do pedido 1234; devolução NF 34311"></label>
    </div>
    <h3 style="margin:12px 0 6px">Recebimento / pagamento ligado (opcional)</h3>
    <p class="small muted" style="margin:0 0 6px">Para adiantamento, ligue o lançamento em que o dinheiro entrou/saiu — assim ele não aparece como recebimento sem nota.</p>
    <div id="lcs" class="small muted">Escolha o cliente/fornecedor para ver os lançamentos.</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button>' });
  if (preset.natureza) $('#nat', m.el).value = preset.natureza;
  if (preset.tipo) $('#tp', m.el).value = preset.tipo;
  const achaFav = () => { const v = $('#fav', m.el).value.trim(); const doc = dig(v.split('·')[1]); return favs.find(f => (doc && dig(f.documento) === doc) || f.nome === v.split(' · ')[0].trim()) || null; };
  if (preset.favorecido_id) { const f = state.cad.favById[preset.favorecido_id]; if (f) $('#fav', m.el).value = `${f.nome}${f.documento ? ' · ' + f.documento : ''}`; }
  let lancSel = null;
  const listar = async () => {
    const f = achaFav(); const box = $('#lcs', m.el); lancSel = null;
    if (!f) { box.innerHTML = 'Escolha o cliente/fornecedor para ver os lançamentos.'; return; }
    box.innerHTML = 'Procurando…';
    try {
      const ls = await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,conta_id,status,plano_id,v:nfe_vinculos(id)').eq('empresa_id', state.empresa.id).in('favorecido_id', mesmoGrupo(f.id)).eq('status', 'Pago').order('data', { ascending: false }).limit(60));
      const nat = $('#nat', m.el).value, livres = ls.filter(l => !l.v?.length && (state.cad.planoById[l.plano_id]?.natureza === (nat === 'cliente' ? 'C' : 'D')));
      box.innerHTML = livres.length ? `<div class="table-wrap" style="max-height:200px"><table><tbody>${livres.map(l => `<tr class="clickable" data-l="${l.id}"><td><input type="radio" name="lsel" value="${l.id}"></td><td>${dateBR(l.data)}</td><td class="num">${money(l.valor)}</td><td>${esc(state.cad.contaById[l.conta_id]?.nome || '—')}</td><td class="wrap">${esc(state.cad.planoById[l.plano_id]?.codigo || '')} ${esc(l.descricao || l.documento || '')}</td></tr>`).join('')}</tbody></table></div>`
        : 'Nenhum lançamento pago sem nota para esse cadastro.';
      box.onchange = (e) => { lancSel = livres.find(l => l.id === e.target.value) || null; if (lancSel && !parseNum($('#vl', m.el).value)) $('#vl', m.el).value = (+lancSel.valor).toFixed(2).replace('.', ','); };
    } catch (e) { box.innerHTML = 'Não foi possível listar.'; }
  };
  $('#fav', m.el).onchange = listar; $('#nat', m.el).onchange = listar; if (preset.favorecido_id) listar();
  $('#ok', m.el).onclick = async () => {
    const f = achaFav(), valor = parseNum($('#vl', m.el).value);
    if (!f) return toast('Escolha o cliente/fornecedor da lista', true);
    if (!(valor > 0)) return toast('Informe o valor', true);
    try {
      await q(sb.from('creditos').insert({ empresa_id: state.empresa.id, favorecido_id: f.id, natureza: $('#nat', m.el).value, tipo: $('#tp', m.el).value, data: $('#dt', m.el).value, valor: +valor.toFixed(2),
        descricao: $('#ds', m.el).value.trim() || null, lancamento_id: lancSel?.id || null, nota_id: preset.nota_id || null }));
      toast('Crédito cadastrado'); m.close(); onDone && onDone();
    } catch (e) { fail(/relation|does not exist|schema cache/i.test(e.message || '') ? new Error('A estrutura de créditos ainda não foi instalada no banco (rodar o SQL de créditos e adiantamentos).') : e); }
  };
}

const SEM_ESTRUTURA = /creditos_usos_destino|lancamento_id|pago_maior|creditos_tipo_check|null value in column "nota_id"/i;
const erroEstrutura = (e) => SEM_ESTRUTURA.test(e?.message || '') ? new Error('Falta rodar o SQL 20261021000047_credito_pago_maior.sql no Supabase (pagamento a maior e devolução de crédito).') : e;

/** Pagamento a maior: a diferença entre o pago e a nota vira crédito com o fornecedor. */
export async function registrarPagoMaior({ favorecido_id, valor, data, lancamento_id, nota, natureza = 'fornecedor' }) {
  try {
    return await q(sb.from('creditos').insert({ empresa_id: state.empresa.id, favorecido_id, natureza, tipo: 'pago_maior', data, valor: +(+valor).toFixed(2),
      descricao: `Pagamento a maior${nota ? ` na NF ${nota.numero}` : ''}`, lancamento_id: lancamento_id || null, nota_id: nota?.id || null }).select().single());
  } catch (e) { throw erroEstrutura(e); }
}

/**
 * Devolução do crédito em dinheiro (o fornecedor devolve o que foi pago a mais; ou a IPLAMM devolve ao cliente).
 * Liga um lançamento que já existe (entrada do fornecedor / saída para o cliente, sem nota) ou cria um novo.
 */
export async function devolverCredito(c, onDone) {
  const cad = state.cad, forn = c.natureza === 'fornecedor', f = cad.favById[c.favorecido_id];
  const saldo = +(+c.saldo).toFixed(2);
  if (!(saldo > 0.005)) return toast('Este crédito não tem saldo.', true);
  const natLanc = forn ? 'C' : 'D';
  let livres = [];
  try {
    const usados = new Set((await q(sb.from('creditos_usos').select('lancamento_id').eq('empresa_id', state.empresa.id).not('lancamento_id', 'is', null))).map(u => u.lancamento_id));
    livres = (await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,conta_id,plano_id,v:nfe_vinculos(id)').eq('empresa_id', state.empresa.id).in('favorecido_id', mesmoGrupo(c.favorecido_id)).eq('status', 'Pago').gte('data', c.data).order('data')))
      .filter(l => !usados.has(l.id) && !l.v?.length && cad.planoById[l.plano_id]?.natureza === natLanc && cad.planoById[l.plano_id]?.tipo !== 'T');
  } catch (e) { return fail(erroEstrutura(e)); }
  const planoPadrao = cad.contasPlano.find(p => p.codigo === (forn ? '1.02.09' : '2.04.04'));
  const planos = cad.contasPlano.filter(p => p.natureza === natLanc && p.tipo !== 'T' && p.ativo !== false);
  const m = modal({ title: `Devolver crédito em dinheiro — ${f?.nome || ''}`, wide: true, body: `
    <p class="small muted" style="margin-top:0">${esc(TIPOS[c.tipo] || c.tipo)} de ${dateBR(c.data)} · valor ${money(c.valor)} · saldo <strong>${money(saldo)}</strong>.
      ${forn ? 'O fornecedor devolve o valor: o dinheiro entra na conta e o crédito é baixado.' : 'A empresa devolve o valor ao cliente: o dinheiro sai da conta e o crédito é baixado.'}</p>
    <label>Valor devolvido<input id="vl" value="${saldo.toFixed(2).replace('.', ',')}"></label>
    <h3 style="margin:12px 0 6px">${forn ? 'Entrada' : 'Saída'} já lançada (opcional)</h3>
    ${livres.length ? `<div class="table-wrap" style="max-height:180px"><table><tbody>${livres.map(l => `<tr><td><input type="radio" name="lx" value="${l.id}"></td><td>${dateBR(l.data)}</td><td class="num">${money(l.valor)}</td><td>${esc(cad.contaById[l.conta_id]?.nome || '—')}</td><td class="wrap small">${esc(cad.planoById[l.plano_id]?.codigo || '')} ${esc(l.descricao || '')}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="small muted">Nenhum lançamento de ${forn ? 'entrada' : 'saída'} desse cadastro sem nota depois de ${dateBR(c.data)}.</p>`}
    <h3 style="margin:12px 0 6px">Ou lançar agora</h3>
    <div class="grid2">
      <label>Data<input type="date" id="dt" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Conta<select id="ct">${options(cad.contas.filter(x => x.ativo !== false), { empty: 'Selecione…' })}</select></label>
      <label class="grow">Plano de contas<select id="pl">${options(planos, { label: 'label', selected: planoPadrao?.id })}</select></label>
      <label class="grow">Descrição<input id="ds" value="${esc(`Devolução de ${(TIPOS[c.tipo] || 'crédito').toLowerCase()}${c.descricao ? ' — ' + c.descricao : ''}`)}"></label>
    </div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Baixar crédito</button>' });
  m.el.addEventListener('change', (e) => { if (e.target.name === 'lx') { const l = livres.find(x => x.id === e.target.value); if (l) $('#vl', m.el).value = Math.min(+l.valor, saldo).toFixed(2).replace('.', ','); } });
  $('#ok', m.el).onclick = async () => {
    const valor = parseNum($('#vl', m.el).value), sel = m.el.querySelector('[name=lx]:checked')?.value;
    if (!(valor > 0)) return toast('Informe o valor devolvido', true);
    if (valor > saldo + 0.005) return toast('O valor passa do saldo do crédito', true);
    let lancId = sel || null, data = $('#dt', m.el).value;
    try {
      if (!lancId) {
        const conta = $('#ct', m.el).value, plano = $('#pl', m.el).value;
        if (!conta || !plano) return toast('Escolha um lançamento já feito ou informe conta e plano para lançar agora', true);
        const l = await q(sb.from('lancamentos').insert({ empresa_id: state.empresa.id, data, plano_id: plano, conta_id: conta, status: 'Pago', valor: +valor.toFixed(2),
          favorecido_id: c.favorecido_id, descricao: $('#ds', m.el).value.trim() || null, origem: `credito:${c.id}` }).select().single());
        lancId = l.id;
      } else data = livres.find(x => x.id === lancId)?.data || data;
      try { await q(sb.from('creditos_usos').insert({ empresa_id: state.empresa.id, credito_id: c.id, nota_id: null, lancamento_id: lancId, data, valor: +valor.toFixed(2), observacao: 'Devolução em dinheiro' })); }
      catch (e) { if (!sel) await sb.from('lancamentos').delete().eq('id', lancId); throw e; }   // não deixa o lançamento novo solto
      toast(`Crédito baixado: ${money(valor)} devolvido${sel ? '' : ' (lançamento criado)'}`); m.close(); onDone && onDone();
    } catch (e) { fail(erroEstrutura(e)); }
  };
}

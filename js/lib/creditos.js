// Créditos e adiantamentos de clientes e fornecedores e o uso deles nas parcelas das notas.
// - adiantamento: o cliente pagou (ou a IPLAMM pagou ao fornecedor) antes de existir a nota
// - devolução / desconto / acordo / outro: crédito que o cliente tem a abater
// O uso do crédito numa parcela conta como recebido (ou pago) sem movimento de caixa — o caixa já entrou/saiu
// quando o adiantamento foi recebido/pago.
import { sb, state, q, fetchAll, podeEditar } from './data.js';
import { $, esc, money, dateBR, fail, toast, modal, options, parseNum } from './ui.js';

export const TIPOS = { adiantamento: 'Adiantamento', devolucao: 'Crédito por devolução', desconto: 'Desconto / abatimento', acordo: 'Acordo comercial', outro: 'Outro crédito' };
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

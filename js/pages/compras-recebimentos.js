// Compras › Recebimentos: confere o pedido contra a NF-e de entrada importada (itens, quantidades, preços, parcelas),
// registra o que chegou e, se pedido, lança as parcelas da nota no contas a pagar (a previsão do pedido é refeita pelo que falta).
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal } from '../lib/ui.js';
import { cadCompras, ST_PED, badge, ABERTOS, qtd, inp, unit, num, diasTxt } from '../lib/compras.js';
import { carregarPedidos } from './compras-pedidos.js';

export const title = 'Recebimentos';
let P = [], C = null, H = [];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Recebimentos</h2><div class="muted small">Importe o XML da nota em Notas Fiscais (entradas) e confira aqui contra o pedido.</div></div></div>
    <div id="rc-corpo"><div class="loading">Carregando…</div></div>`;
  const ab = state.abrir?.tipo === 'receber' ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if (ab) { const p = P.find(x => x.id === ab.id); if (p) receber(p, root); }
}

async function carregar(root) {
  try {
    const e = state.empresa.id;
    [C, P, H] = await Promise.all([cadCompras(), carregarPedidos(),
      q(sb.from('compras_recebimentos').select('id,pedido_id,data,nfe_nota_id,divergencias,observacao').eq('empresa_id', e).order('data', { ascending: false }).limit(200))]);
    pintar(root);
  } catch (err) { fail(err); $('#rc-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; }
}

function pintar(root) {
  const h = today(), ab = P.filter(p => ABERTOS.includes(p.status)).sort((a, b) => (a.entrega_prevista || '9').localeCompare(b.entrega_prevista || '9'));
  const pedById = Object.fromEntries(P.map(p => [p.id, p]));
  $('#rc-corpo', root).innerHTML = `<div class="card flush"><div style="padding:14px 16px 0" class="card-head"><h2 style="margin:0">A receber</h2><span class="muted small">${ab.length} pedido(s) · ${money(ab.reduce((t, p) => t + p.aReceber, 0))}</span></div>
    <div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Fornecedor</th><th>Entrega prevista</th><th>Itens</th><th class="num">Falta receber</th><th>Situação</th><th></th></tr></thead><tbody>
    ${ab.map(p => `<tr><td>PC ${p.numero}</td><td>${esc(C.forById[p.favorecido_id]?.nome || '')}</td><td class="${p.entrega_prevista && p.entrega_prevista < h ? 'neg' : ''}">${dateBR(p.entrega_prevista) || '–'}</td>
      <td class="wrap">${esc(p.itens.filter(i => +i.qtd_recebida < +i.quantidade).map(i => `${qtd(i.quantidade - i.qtd_recebida)} ${i.unidade} ${i.descricao}`).join(' · '))}</td>
      <td class="num">${money(p.aReceber)}</td><td>${badge(ST_PED, p.status)}</td><td><button class="btn primary small" data-rc="${p.id}">Receber</button></td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">Nenhum pedido aprovado aguardando entrega.</td></tr>'}</tbody></table></div></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Últimos recebimentos</h2></div><div class="table-wrap"><table><thead><tr><th>Data</th><th>Pedido</th><th>Fornecedor</th><th>Nota</th><th>Divergências</th><th>Observação</th></tr></thead><tbody>
    ${H.map(r => { const p = pedById[r.pedido_id]; return `<tr><td>${dateBR(r.data)}</td><td>${p ? 'PC ' + p.numero : ''}</td><td>${esc(C.forById[p?.favorecido_id]?.nome || '')}</td><td>${r.nfe_nota_id ? 'com nota' : 'sem nota'}</td>
      <td class="wrap">${(r.divergencias || []).length ? `<span class="warn">${r.divergencias.map(d => esc(d.texto)).join(' · ')}</span>` : '<span class="pos">sem divergência</span>'}</td><td class="wrap">${esc(r.observacao || '')}</td></tr>`; }).join('')
    || '<tr><td colspan="6" class="empty">Nenhum recebimento registrado.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-rc]', root).forEach(b => b.onclick = () => receber(P.find(p => p.id === b.dataset.rc), root));
}

// casa os itens do pedido com os itens da nota: mesma descrição/NCM primeiro, depois pela ordem
// casa os itens do pedido com os itens da nota: 1º pelo de-para (produto × código do fornecedor), depois descrição/NCM, depois a ordem.
// fator (de-para): 1 unidade da nota = fator unidades do produto
let PF = [];
const fatorDe = (i, x, doc) => +(PF.find(f => f.produto_id === i.produto_id && f.emit_doc === doc && f.codigo_fornecedor === x.cprod)?.fator || 1);
function casar(itens, nitens, doc) {
  const usados = new Set(), norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pelaRegra = itens.map(i => (i.produto_id ? nitens.find(x => PF.some(f => f.produto_id === i.produto_id && f.emit_doc === doc && f.codigo_fornecedor === x.cprod)) : null) || null);
  pelaRegra.forEach(n => n && usados.add(n.id));
  return itens.map((i, k) => {
    let n = pelaRegra[k];
    if (!n) n = nitens.find(x => !usados.has(x.id) && (norm(x.xprod).includes(norm(i.descricao)) || norm(i.descricao).includes(norm(x.xprod))))
      || nitens.find(x => !usados.has(x.id) && i.ncm && x.ncm === i.ncm) || nitens.filter(x => !usados.has(x.id))[0];
    if (n) usados.add(n.id);
    return n || null;
  });
}

async function receber(p, root) {
  let notas = [];
  try {
    const ids = [...new Set(p.itens.map(i => i.produto_id).filter(Boolean))];
    [notas, PF] = await Promise.all([q(sb.rpc('compras_notas_candidatas', { p_pedido: p.id })),
      ids.length ? q(sb.from('produto_fornecedores').select('produto_id,emit_doc,codigo_fornecedor,fator').in('produto_id', ids)) : []]);
  } catch (err) { return fail(err); }
  const pend = p.itens.filter(i => +i.qtd_recebida < +i.quantidade);
  const m = modal({ title: `Receber PC ${p.numero} — ${C.forById[p.favorecido_id]?.nome || ''}`, wide: true, body: `
    <h3 style="margin:0 0 6px">Nota fiscal</h3>
    <div id="rc-notas" style="display:grid;gap:6px">
      ${notas.map(n => `<label class="chk" style="align-items:flex-start"><input type="radio" name="rc-n" value="${n.id}" ${n.ja_recebida ? '' : ''}>
        <span>NF ${n.numero}${n.serie ? '-' + esc(n.serie) : ''} de ${dateBR(n.emissao)} · ${money(n.v_nf)} · ${n.itens.length} item(ns)${n.ja_recebida ? ' · <span class="warn">já usada em outro recebimento</span>' : ''}</span></label>`).join('')}
      <label class="chk"><input type="radio" name="rc-n" value="" ${notas.length ? '' : 'checked'}> <span>Sem nota (recebimento físico; a nota vem depois)</span></label>
    </div>
    ${notas.length ? '' : '<p class="small muted">Nenhuma nota de entrada deste fornecedor foi importada desde 30 dias antes do pedido. Importe o XML em Notas Fiscais › Entradas.</p>'}
    <div class="grid-form" style="margin-top:12px"><label>Data do recebimento<input type="date" id="rc-dt" value="${today()}"></label><label class="span2">Observação<input id="rc-obs"></label></div>
    <div id="rc-conf" style="margin-top:12px"></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rc-ok">Registrar recebimento</button>` });
  let nota = null, casados = [];
  const conf = $('#rc-conf', m.el);
  const pintarConf = () => {
    casados = nota ? casar(pend, nota.itens, nota.emit_doc) : pend.map(() => null);
    conf.innerHTML = `<h3 style="margin:0 0 6px">Conferência pedido × ${nota ? 'nota' : 'recebido'}</h3>
      <div class="table-wrap"><table><thead><tr><th>Item do pedido</th><th class="num">Falta</th><th class="num">Unit. pedido</th>${nota ? '<th>Item da nota</th><th class="num">Quant. nota</th><th class="num">Unit. nota</th>' : ''}<th>Recebido agora</th><th>Conferência</th></tr></thead><tbody>
      ${pend.map((i, k) => { const n = casados[k], falta = i.quantidade - i.qtd_recebida;
        return `<tr data-k="${k}"><td class="wrap">${esc(i.descricao)} <span class="muted small">${esc(i.unidade)}</span></td><td class="num">${qtd(falta)}</td><td class="num">${unit(i.valor_unitario)}</td>
        ${nota ? `<td><select class="rc-ni" style="max-width:240px"><option value="">— não veio na nota —</option>${nota.itens.map(x => `<option value="${x.id}" ${n?.id === x.id ? 'selected' : ''}>${x.n_item}. ${esc(x.xprod)} (${esc(x.ucom || '')})</option>`).join('')}</select></td>
          <td class="num rc-nq"></td><td class="num rc-nv"></td>` : ''}
        <td><input class="rc-q" value="${inp(nota ? (n ? Math.min(+n.qcom * fatorDe(i, n, nota.emit_doc), falta) : 0) : falta)}" style="width:100px"></td><td class="small rc-st"></td></tr>`; }).join('')}</tbody></table></div>
      ${nota ? `<div id="rc-parc" class="small" style="margin-top:10px"></div>` : ''}`;
    const atual = () => {
      const div = [];
      $$('tr[data-k]', conf).forEach(tr => {
        const i = pend[+tr.dataset.k], nid = nota ? $('.rc-ni', tr).value : '', n = nota?.itens.find(x => x.id === nid), q2 = num($('.rc-q', tr).value), falta = i.quantidade - i.qtd_recebida, st = [];
        const fa = n ? fatorDe(i, n, nota.emit_doc) : 1, nq = n ? +n.qcom * fa : 0, nv = n ? +n.vuncom / fa : 0;   // na unidade do pedido
        if (nota) { $('.rc-nq', tr).textContent = n ? qtd(nq) + (fa !== 1 ? ` (${qtd(n.qcom)} ${n.ucom || ''})` : '') : ''; $('.rc-nv', tr).textContent = n ? unit(nv) : ''; }
        if (q2 > falta + 1e-9) st.push(`acima do pedido (+${qtd(q2 - falta)})`);
        if (q2 > 0 && q2 < falta - 1e-9) st.push(`parcial (faltam ${qtd(falta - q2)})`);
        if (n && Math.abs(nq - q2) > 1e-6) st.push(`nota ${qtd(nq)} ≠ recebido`);
        if (n && i.valor_unitario > 0 && Math.abs(nv / i.valor_unitario - 1) > 0.005) st.push(`preço ${unit(nv)} × pedido ${unit(i.valor_unitario)} (${nv > i.valor_unitario ? '+' : ''}${((nv / i.valor_unitario - 1) * 100).toFixed(1).replace('.', ',')}%)`);
        if (nota && !n && q2 > 0) st.push('item não está na nota');
        $('.rc-st', tr).innerHTML = st.length ? `<span class="warn">${esc(st.join(' · '))}</span>` : '<span class="pos">ok</span>';
        for (const s of st) if (!s.startsWith('parcial')) div.push({ item: i.descricao, texto: `${i.descricao}: ${s}` });
      });
      if (nota) {
        const livres = nota.parcelas.filter(x => !x.vinculada), esperado = (p.parcelas_dias || []).length;
        const parcDiv = nota.parcelas.length && esperado && nota.parcelas.length !== esperado ? `A nota tem ${nota.parcelas.length} parcela(s); o pedido previa ${esperado} (${diasTxt(p.parcelas_dias)}).` : '';
        if (parcDiv) div.push({ texto: parcDiv });
        $('#rc-parc', conf).innerHTML = `<div><b>Parcelas da nota:</b> ${nota.parcelas.map(x => `${x.numero}ª ${dateBR(x.vencimento)} ${money(x.valor)}${x.vinculada ? ' (já no contas a pagar)' : ''}`).join(' · ') || 'nenhuma'}</div>
          ${parcDiv ? `<div class="warn">${esc(parcDiv)}</div>` : ''}
          ${livres.length ? `<label class="chk" style="margin-top:6px"><input type="checkbox" id="rc-lanc" checked> Lançar as ${livres.length} parcela(s) da nota no contas a pagar (${money(livres.reduce((t, x) => t + +x.valor, 0))}), com a classificação do pedido</label>` : '<div class="muted">Todas as parcelas da nota já estão no contas a pagar.</div>'}
          <div class="muted">A previsão do pedido é refeita pelo valor que ainda falta receber.</div>`;
      }
      return div;
    };
    conf.oninput = conf.onchange = atual; atual();
    conf._div = atual;
  };
  $('#rc-notas', m.el).onchange = () => { const id = $('input[name=rc-n]:checked', m.el)?.value; nota = notas.find(n => n.id === id) || null; pintarConf(); };
  if (notas.length === 1 && !notas[0].ja_recebida) { $('input[name=rc-n]', m.el).checked = true; nota = notas[0]; }
  pintarConf();
  $('#rc-ok', m.el).onclick = async (ev) => {
    if (!$('input[name=rc-n]:checked', m.el)) return toast('Escolha a nota ou "sem nota"', true);
    const itens = $$('tr[data-k]', conf).map(tr => { const i = pend[+tr.dataset.k], nid = nota ? $('.rc-ni', tr).value : '';
      return { pedido_item_id: i.id, quantidade: num($('.rc-q', tr).value), valor_unitario: nid ? +nota.itens.find(x => x.id === nid).vuncom / fatorDe(i, nota.itens.find(x => x.id === nid), nota.emit_doc) : +i.valor_unitario, nfe_item_id: nid || null }; })
      .filter(x => x.quantidade > 0);
    if (!itens.length) return toast('Informe a quantidade recebida de ao menos um item', true);
    ev.target.disabled = true;
    try {
      await q(sb.rpc('compras_receber', { p_pedido: p.id, p_nota: nota?.id || null, p_data: $('#rc-dt', m.el).value || today(), p_itens: itens,
        p_divergencias: conf._div(), p_lancar_parcelas: !!$('#rc-lanc', m.el)?.checked, p_observacao: $('#rc-obs', m.el).value.trim() || null }));
      m.close(); toast('Recebimento registrado'); await carregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

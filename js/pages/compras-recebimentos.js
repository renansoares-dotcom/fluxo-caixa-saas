// Compras › Recebimentos: confere o pedido contra a NF-e de entrada importada (itens, quantidades, preços, parcelas),
// registra o que chegou e, se pedido, lança as parcelas da nota no contas a pagar (a previsão do pedido é refeita pelo que falta).
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal } from '../lib/ui.js';
import { cadCompras, ST_PED, badge, ABERTOS, qtd, inp, unit, num, diasTxt } from '../lib/compras.js';
import { carregarPedidos } from './compras-pedidos.js';
import { TIPOS, SITUACOES, situacaoNota, resumo, podeLiberar, filtrar } from '../lib/confronto.js';

export const title = 'Recebimentos';
let P = [], C = null, H = [], PAR = {};
const ui = { aba: 'receber', filtro: 'pendentes', dias: 60 };

export async function render(root) {
  if (/[?&]aba=confronto/.test(location.hash)) ui.aba = 'confronto';
  const gestor = ['admin', 'diretor'].includes(state.papel);
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Recebimentos</h2><div class="muted small">Importe o XML da nota em Notas Fiscais (entradas) e confira aqui contra o pedido. Nota que diverge do pedido tem o pagamento bloqueado até a liberação.</div></div>
      ${gestor ? '<button class="btn ghost" id="rc-par">Parâmetros do confronto</button>' : ''}</div>
    <div class="card toolbar"><div class="chips" id="rc-abas">${[['receber', 'A receber'], ['confronto', 'Confronto pedido × nota']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div id="rc-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#rc-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a && a !== ui.aba) { ui.aba = a; render(root); } };
  $('#rc-par', root) && ($('#rc-par', root).onclick = () => parametros(root));
  PAR = (await q(sb.from('compras_parametros').select('*').eq('empresa_id', state.empresa.id)).catch(() => []))[0] || {};
  if (ui.aba === 'confronto') return confronto(root);
  const ab = state.abrir?.tipo === 'receber' ? state.abrir : null; if (ab) delete state.abrir;
  await carregar(root);
  if (ab) { const p = P.find(x => x.id === ab.id); if (p) receber(p, root); }
}

async function carregar(root) {
  if (ui.aba === 'confronto') return confronto(root);
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
      ${nota ? `<div id="rc-parc" class="small" style="margin-top:10px"></div>` : ''}<div id="rc-prev"></div>`;
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
        for (const s of st) div.push({ item: i.descricao, texto: `${i.descricao}: ${s}`, tipo: s.startsWith('parcial') ? 'parcial' : s.startsWith('nota ') ? 'nota_qtd' : s.startsWith('item não') ? 'nao_veio' : 'tela' });
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
    let tm = null;
    const previa = () => { clearTimeout(tm); tm = setTimeout(async () => {   // o confronto do banco (o mesmo que decide o bloqueio)
      const box = $('#rc-prev', m.el); if (!box) return;
      try {
        const d = await q(sb.rpc('compras_confrontar', { p_pedido: p.id, p_nota: nota?.id || null, p_itens: itensTela(), p_data: $('#rc-dt', m.el).value || today() }));
        const r = resumo(d || []);
        box.innerHTML = r.bloqueia
          ? `<div class="card" style="border-color:var(--neg);margin-top:10px"><b class="neg">🔒 ${PAR.conf_bloquear === false ? 'Divergência acima da tolerância (o bloqueio está desligado nos parâmetros)' : 'O pagamento desta nota ficará bloqueado'}</b>${r.valor ? ` — ${money(r.valor)} divergente` : ''}<ul class="small" style="margin:6px 0 0">${r.bloqueantes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
              <div class="small muted">Registre assim mesmo se a mercadoria chegou; a liberação do pagamento fica em Confronto pedido × nota, com o motivo.</div></div>`
          : r.avisos.length ? `<div class="small warn" style="margin-top:10px">${r.avisos.map(esc).join(' · ')}</div>` : `<div class="small pos" style="margin-top:10px">Dentro das tolerâncias do confronto: o pagamento segue livre.</div>`;
      } catch { box.innerHTML = ''; }
    }, 350); };
    conf.oninput = conf.onchange = () => { atual(); previa(); }; atual(); previa();
    conf._div = atual;
  };
  $('#rc-notas', m.el).onchange = () => { const id = $('input[name=rc-n]:checked', m.el)?.value; nota = notas.find(n => n.id === id) || null; pintarConf(); };
  if (notas.length === 1 && !notas[0].ja_recebida) { $('input[name=rc-n]', m.el).checked = true; nota = notas[0]; }
  pintarConf();
  function itensTela() {
    return $$('tr[data-k]', conf).map(tr => { const i = pend[+tr.dataset.k], nid = nota ? $('.rc-ni', tr).value : '';
      return { pedido_item_id: i.id, quantidade: num($('.rc-q', tr).value), valor_unitario: nid ? +nota.itens.find(x => x.id === nid).vuncom / fatorDe(i, nota.itens.find(x => x.id === nid), nota.emit_doc) : +i.valor_unitario, nfe_item_id: nid || null }; })
      .filter(x => x.quantidade > 0);
  }
  $('#rc-ok', m.el).onclick = async (ev) => {
    if (!$('input[name=rc-n]:checked', m.el)) return toast('Escolha a nota ou "sem nota"', true);
    const itens = itensTela();
    if (!itens.length) return toast('Informe a quantidade recebida de ao menos um item', true);
    ev.target.disabled = true;
    try {
      await q(sb.rpc('compras_receber', { p_pedido: p.id, p_nota: nota?.id || null, p_data: $('#rc-dt', m.el).value || today(), p_itens: itens,
        p_divergencias: conf._div(), p_lancar_parcelas: !!$('#rc-lanc', m.el)?.checked, p_observacao: $('#rc-obs', m.el).value.trim() || null }));
      m.close(); toast('Recebimento registrado'); await carregar(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ---------- Confronto pedido × nota ----------
async function confronto(root) {
  const c = $('#rc-corpo', root);
  let L = [];
  try { L = await q(sb.rpc('compras_confronto_lista', { p_empresa: state.empresa.id, p_de: new Date(Date.now() - ui.dias * 864e5).toISOString().slice(0, 10) })); }
  catch (err) { fail(err); c.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. O SQL 133 já foi aplicado?</div></div>'; return; }
  const libera = podeLiberar(state.papel, PAR.conf_papeis_liberar);
  const cont = (f) => filtrar(L, f).length, V = filtrar(L, ui.filtro);
  const bloq = L.filter(n => situacaoNota(n) === 'bloqueada');
  c.innerHTML = `<div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="muted small">Notas bloqueadas</div><div class="v ${bloq.length ? 'neg' : ''}">${bloq.length}</div><div class="small muted">${money(bloq.reduce((t, n) => t + +n.v_nf, 0))} em notas</div></div>
      <div class="kpi"><div class="muted small">Divergência que bloqueia</div><div class="v">${money(bloq.reduce((t, n) => t + +(n.bloqueio?.valor_divergente || 0), 0))}</div><div class="small muted">a cobrar do fornecedor ou aceitar</div></div>
      <div class="kpi"><div class="muted small">Notas sem pedido</div><div class="v ${cont('sem_pedido') ? 'warn' : ''}">${cont('sem_pedido')}</div><div class="small muted">entradas de fornecedor nos últimos ${ui.dias} dias</div></div></div>
    <div class="card toolbar"><div class="chips" id="cf-f">${[['pendentes', 'Pendentes'], ['bloqueada', 'Bloqueadas'], ['divergente', 'Com divergência'], ['sem_pedido', 'Sem pedido'], ['liberada', 'Liberadas'], ['ok', 'Conferem'], ['todas', 'Todas']]
        .map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t} <span class="muted">${cont(k)}</span></span>`).join('')}</div>
      <span class="small" style="display:flex;align-items:center;gap:6px;white-space:nowrap">Emitidas nos últimos <select id="cf-d" style="width:auto">${[30, 60, 90, 180, 365].map(d => `<option ${d === ui.dias ? 'selected' : ''}>${d}</option>`).join('')}</select> dias</span></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Nota</th><th>Fornecedor</th><th class="num">Valor</th><th>Pedido</th><th>Divergências</th><th>Títulos</th><th>Situação</th></tr></thead><tbody>
    ${V.map(n => { const st = situacaoNota(n), [rot, cls] = SITUACOES[st], tit = n.titulos || [];
      return `<tr><td style="white-space:nowrap">NF ${n.numero}${n.serie ? '-' + esc(n.serie) : ''}<div class="small muted">${dateBR(n.emissao)}</div></td><td class="wrap">${esc(n.fornecedor || '')}</td><td class="num">${money(n.v_nf)}</td>
        <td>${(n.pedidos || []).map(p => 'PC ' + p.numero).join(', ') || '<span class="muted">—</span>'}</td>
        <td class="wrap small">${(n.divergencias || []).filter(d => d.tipo !== 'parcial').map(d => `<div class="${d.bloqueia === true ? 'neg' : 'warn'}">${d.bloqueia === true ? '🔒 ' : ''}${esc(d.texto)}</div>`).join('') || (st === 'sem_pedido' ? '<span class="muted">sem recebimento contra pedido</span>' : '<span class="pos">sem divergência</span>')}
          ${n.bloqueio?.situacao === 'liberada' ? `<div class="muted">Liberada por ${esc(n.bloqueio.liberado_por || '')} em ${dateBR(String(n.bloqueio.liberado_em).slice(0, 10))}: ${esc(n.bloqueio.liberado_motivo || '')}</div>` : ''}</td>
        <td class="small" style="white-space:nowrap">${tit.length ? tit.map(t => `${t.bloqueado ? '🔒 ' : ''}${dateBR(t.data)} ${money(t.valor)}${t.status === 'Pago' ? ' (pago)' : ''}`).join('<br>') : '<span class="muted">nenhum</span>'}</td>
        <td><span class="${cls}">${rot}</span>${st === 'bloqueada' && libera ? `<div style="margin-top:6px"><button class="btn small" data-lib="${n.bloqueio.id}">Liberar pagamento</button></div>` : ''}</td></tr>`; }).join('')
    || '<tr><td colspan="7" class="empty">Nenhuma nota nesta situação.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Tolerâncias: preço ${String(PAR.conf_tol_preco_pct ?? 2).replace('.', ',')}% · quantidade ${String(PAR.conf_tol_qtd_pct ?? 5).replace('.', ',')}% · itens fora do pedido ${money(PAR.conf_tol_valor ?? 10)} · vencimento ${PAR.conf_tol_prazo_dias ?? 3} dia(s) antes do combinado · entrega ${PAR.conf_tol_entrega_dias ?? 2} dia(s) (só informa). ${PAR.conf_bloquear === false ? '<b>O bloqueio do pagamento está desligado.</b>' : ''}</p>`;
  $('#cf-f', c).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; confronto(root); } };
  $('#cf-d', c).onchange = (e) => { ui.dias = +e.target.value; confronto(root); };
  $$('[data-lib]', c).forEach(b => b.onclick = () => liberar(L.find(n => n.bloqueio?.id === b.dataset.lib), root));
}

function liberar(n, root) {
  const r = resumo(n.bloqueio.divergencias || []);
  const m = modal({ title: `Liberar pagamento — NF ${n.numero} · ${n.fornecedor || ''}`, body: `
    <p class="small">A nota diverge do ${(n.pedidos || []).map(p => 'PC ' + p.numero).join(', ')} em <b>${money(n.bloqueio.valor_divergente)}</b>:</p>
    <ul class="small">${r.bloqueantes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <label>Motivo da liberação<textarea id="lb-m" rows="3" placeholder="Ex.: fornecedor emitiu nota de débito; diferença de preço aprovada pela diretoria; reajuste combinado por e-mail"></textarea></label>
    <p class="small muted">Os títulos da nota voltam a poder ser autorizados e pagos. A liberação fica registrada com o seu nome, a data e o motivo.</p>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lb-ok">Liberar</button>` });
  $('#lb-ok', m.el).onclick = async (ev) => {
    const mot = $('#lb-m', m.el).value.trim(); if (mot.length < 5) return toast('Informe o motivo', true);
    ev.target.disabled = true;
    try { const k = await q(sb.rpc('compras_liberar_pagamento', { p_bloqueio: n.bloqueio.id, p_motivo: mot })); m.close(); toast(`Pagamento liberado (${k} título(s))`); confronto(root); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
}

function parametros(root) {
  const p = PAR, papeis = [['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['compras', 'Compras']], sel = p.conf_papeis_liberar || ['admin', 'diretor', 'financeiro'];
  const v = (x, d) => String(x ?? d).replace('.', ',');
  const m = modal({ title: 'Parâmetros do confronto pedido × nota', body: `
    <label class="chk"><input type="checkbox" id="pf-b" ${p.conf_bloquear === false ? '' : 'checked'}> Bloquear o pagamento da nota que diverge do pedido acima das tolerâncias</label>
    <div class="grid-form" style="margin-top:10px">
      <label class="xs">Preço acima do pedido (%)<input id="pf-p" inputmode="decimal" value="${v(p.conf_tol_preco_pct, 2)}"></label>
      <label class="xs">Quantidade acima do pedido (%)<input id="pf-q" inputmode="decimal" value="${v(p.conf_tol_qtd_pct, 5)}"></label>
      <label class="xs">Itens da nota fora do pedido (R$)<input id="pf-v" inputmode="decimal" value="${v(p.conf_tol_valor, 10)}"></label>
      <label class="xs">Vencimento antes do combinado (dias)<input id="pf-d" type="number" min="0" max="60" value="${p.conf_tol_prazo_dias ?? 3}"></label>
      <label class="xs">Entrega depois do previsto (dias; só informa)<input id="pf-e" type="number" min="0" max="60" value="${p.conf_tol_entrega_dias ?? 2}"></label></div>
    <div style="margin-top:10px"><b class="small">Quem libera o pagamento bloqueado</b> <span class="small muted">(o administrador sempre libera)</span>
      <div style="display:flex;gap:14px;margin-top:4px">${papeis.map(([k, t]) => `<label class="chk"><input type="checkbox" class="pf-r" value="${k}" ${sel.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
    <p class="small muted">O prazo de pagamento conta da emissão da nota: cada parcela é comparada com os dias da condição do pedido.</p>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-ok">Salvar</button>` });
  $('#pf-ok', m.el).onclick = async (ev) => {
    const row = { empresa_id: state.empresa.id, conf_bloquear: $('#pf-b', m.el).checked, conf_tol_preco_pct: num($('#pf-p', m.el).value), conf_tol_qtd_pct: num($('#pf-q', m.el).value),
      conf_tol_valor: num($('#pf-v', m.el).value), conf_tol_prazo_dias: +$('#pf-d', m.el).value || 0, conf_tol_entrega_dias: +$('#pf-e', m.el).value || 0,
      conf_papeis_liberar: ['admin', ...$$('.pf-r:checked', m.el).map(x => x.value)] };
    if ([row.conf_tol_preco_pct, row.conf_tol_qtd_pct].some(x => !(x >= 0 && x <= 100))) return toast('Percentual entre 0 e 100', true);
    ev.target.disabled = true;
    try { await q(sb.from('compras_parametros').upsert(row)); m.close(); toast('Parâmetros salvos'); render(root); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
}

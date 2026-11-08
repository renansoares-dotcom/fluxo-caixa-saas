// Compras › Estoque › Inventário Cíclico (EST009) — melhoria 5.5 (SQL 120, 08/11/2026).
// Contagens pequenas e frequentes pela curva ABC; contagem cega pelo celular com leitura da etiqueta; recontagem quando
// a divergência passa da tolerância; aprovação que gera os ajustes de inventário no Kardex. Parâmetros na tela.
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, fail, toast, modal, dateBR, parseNum } from '../lib/ui.js';

export const title = 'Inventário Cíclico';
const ui = { aberta: null };
const abrir = (root, id) => { history.replaceState(null, '', '#/estoque/inventario' + (id ? '?c=' + id : '')); render(root); };
let D = null;
const n = (v, d = 3) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }));
const SIT = { aberta: ['Contando', 'aberto'], em_aprovacao: ['Para aprovar', 'negoc'], aprovada: ['Aprovada', 'pago'], recusada: ['Recusada', 'vencido'], cancelada: ['Cancelada', ''] };
const SIT_I = { pendente: ['A contar', ''], recontar: ['Recontar', 'aberto'], ok: ['OK', 'pago'], divergente: ['Divergente', 'vencido'], ajustado: ['Ajustado', 'negoc'] };
const quem = (e) => esc((e || '').split('@')[0]);
const podeContar = () => ['admin', 'financeiro', 'diretor', 'compras', 'producao'].includes(state.papel);

export async function render(root) {
  ui.aberta = new URLSearchParams(location.hash.split('?')[1] || '').get('c'); // a contagem aberta vive no endereço
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id;
    const [cont, itens, locais, cfg, abc, impl] = await Promise.all([
      q(sb.from('est_inv_contagens').select('*').eq('empresa_id', e).order('numero', { ascending: false }).limit(200)),
      q(sb.from('est_inv_itens').select('*').eq('empresa_id', e).order('id').limit(5000)),
      q(sb.from('est_locais').select('id,codigo,nome').eq('empresa_id', e).eq('ativo', true).eq('controla_saldo', true).order('ordem')),
      q(sb.from('est_inv_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.rpc('est_inv_abc', { p_empresa: e })).catch(() => []),
      q(sb.from('est_config').select('implantado_em').eq('empresa_id', e).maybeSingle()).catch(() => null)]);
    const ids = [...new Set(itens.map(i => i.produto_id))], lotes = [...new Set(itens.map(i => i.lote_id).filter(Boolean))];
    const [prods, lts] = await Promise.all([ids.length ? q(sb.from('produtos').select('id,codigo,descricao,unidade').in('id', ids)) : [], lotes.length ? q(sb.from('est_lotes').select('id,codigo').in('id', lotes)) : []]);
    D = { cont, itens, locais, cfg: { dias_a: 30, dias_b: 60, dias_c: 120, itens_por_contagem: 20, tolerancia_pct: 2, tolerancia_valor: 100, contagem_cega: true, recontar: true, papeis_aprovacao: ['admin', 'diretor', 'financeiro'], ...(cfg || {}) },
      abc, implantado: !!impl?.implantado_em, prod: Object.fromEntries(prods.map(p => [p.id, p])), lote: Object.fromEntries(lts.map(l => [l.id, l])), loc: Object.fromEntries(locais.map(l => [l.id, l])) };
    const c = ui.aberta && D.cont.find(x => x.id === ui.aberta);
    if (c) return c.situacao === 'aberta' ? contar(root, c) : revisar(root, c);
    lista(root);
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 120 já foi executado.</div></div>'; }
}

function lista(root) {
  const cfg = D.cfg, hoje = Date.now(), dias = { A: cfg.dias_a, B: cfg.dias_b, C: cfg.dias_c };
  const abc = ['A', 'B', 'C'].map(k => { const l = D.abc.filter(x => x.classe === k); const em = l.filter(x => x.ultima_contagem && (hoje - new Date(x.ultima_contagem)) / 864e5 <= dias[k]).length; return { k, n: l.length, em, pct: l.length ? em / l.length : null }; });
  const res = (c) => { const it = D.itens.filter(i => i.contagem_id === c.id); return { n: it.length, cont: it.filter(i => !['pendente', 'recontar'].includes(i.situacao)).length, div: it.filter(i => ['divergente', 'ajustado'].includes(i.situacao)).length,
    val: it.filter(i => ['divergente', 'ajustado'].includes(i.situacao)).reduce((s, i) => s + ((+(i.recontado ?? i.contado) || 0) - (+i.saldo_sistema || 0)) * (+i.custo || 0), 0) }; };
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Inventário Cíclico</h2><div class="muted small">Contagens pequenas e frequentes pela curva ABC, pelo celular, com aprovação dos ajustes.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${podeEditar() ? '<button class="btn" id="iv-par">Parâmetros</button>' : ''}${podeContar() && D.implantado ? '<button class="btn primary" id="iv-novo">Nova contagem</button>' : ''}</div></div>
    ${D.implantado ? '' : '<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">O inventário cíclico começa depois da implantação do saldo inicial do estoque (Estoque › Implantação do Estoque).</div>'}
    <div class="kpis" style="margin-bottom:12px">${abc.map(x => `<div class="kpi"><div class="k-label">Classe ${x.k} · a cada ${dias[x.k]} dias</div><div class="k-value">${x.pct == null ? '—' : Math.round(x.pct * 100) + '%'}</div><div class="k-sub">${x.em} de ${x.n} contados no prazo</div></div>`).join('')}
      <div class="kpi"><div class="k-label">Para aprovar</div><div class="k-value ${D.cont.some(c => c.situacao === 'em_aprovacao') ? 'warn' : ''}">${D.cont.filter(c => c.situacao === 'em_aprovacao').length}</div><div class="k-sub">contagens com divergência</div></div></div>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Local</th><th>Criada</th><th class="num">Itens</th><th class="num">Contados</th><th class="num">Divergentes</th><th class="num">Valor da divergência</th><th>Situação</th></tr></thead><tbody>
      ${D.cont.map(c => { const r = res(c), s = SIT[c.situacao]; return `<tr data-c="${c.id}" style="cursor:pointer"><td><b>${c.numero}</b></td><td>${esc(D.loc[c.local_id]?.nome || '')}</td><td>${dateBR(c.criada_em)} <span class="muted small">${quem(c.criada_por)}</span></td>
        <td class="num">${r.n}</td><td class="num">${r.cont}</td><td class="num">${r.div}</td><td class="num ${r.val < 0 ? 'neg' : ''}">${money(r.val)}</td><td><span class="badge ${s[1]}">${s[0]}</span></td></tr>`; }).join('')
        || '<tr><td colspan="8" class="empty">Nenhuma contagem. Use Nova contagem: a plataforma escolhe os itens do local pela curva ABC.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-c]', root).forEach(tr => tr.onclick = () => abrir(root, tr.dataset.c));
  $('#iv-par', root) && ($('#iv-par', root).onclick = () => parametros(root));
  $('#iv-novo', root) && ($('#iv-novo', root).onclick = () => nova(root));
}

function nova(root) {
  const m = modal({ title: 'Nova contagem cíclica', body: `<label>Local<select id="nv-l">${D.locais.map(l => `<option value="${l.id}">${esc(l.codigo)} — ${esc(l.nome)}</option>`).join('')}</select></label>
    <label style="margin-top:8px">Quantos itens (no máximo)<input type="number" id="nv-q" min="1" max="200" value="${D.cfg.itens_por_contagem}"></label>
    <p class="small muted">Entram os itens com saldo no local cuja última contagem passou da frequência da classe (A ${D.cfg.dias_a}, B ${D.cfg.dias_b}, C ${D.cfg.dias_c} dias), primeiro a classe A e os mais atrasados.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nv-ok">Gerar</button>' });
  $('#nv-ok', m.el).onclick = async () => {
    try { const id = await q(sb.rpc('est_inv_gerar', { p_empresa: state.empresa.id, p_local: $('#nv-l', m.el).value, p_qtd: +$('#nv-q', m.el).value || null, p_produtos: null })); m.close(); abrir(root, id); } catch (e) { fail(e); }
  };
}

// tela de contagem (celular): lê a etiqueta, mostra o item, digita a quantidade
function contar(root, c) {
  const its = D.itens.filter(i => i.contagem_id === c.id), cega = D.cfg.contagem_cega;
  const rot = (i) => `${esc(D.prod[i.produto_id]?.codigo || '')} ${esc(D.prod[i.produto_id]?.descricao || '')}${i.lote_id ? ` · lote ${esc(D.lote[i.lote_id]?.codigo || '')}` : ''}`;
  const falta = its.filter(i => ['pendente', 'recontar'].includes(i.situacao));
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Contagem nº ${c.numero} — ${esc(D.loc[c.local_id]?.nome || '')}</h2><div class="muted small">${its.length - falta.length} de ${its.length} contados${cega ? ' · contagem cega (o saldo do sistema não aparece)' : ''}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="ct-v">← Contagens</button>${podeEditar() ? '<button class="btn" id="ct-x">Cancelar contagem</button>' : ''}<button class="btn primary" id="ct-env" ${falta.length ? 'disabled' : ''}>Enviar para aprovação</button></div></div>
    <form id="ct-f" class="card" style="display:grid;grid-template-columns:1fr 160px auto;gap:8px;align-items:end;margin-bottom:12px">
      <label>Leia a etiqueta ou digite o código<input id="ct-cod" autocomplete="off" placeholder="Código do produto ou do lote" style="font-size:1.1em" autofocus></label>
      <label>Quantidade contada<input id="ct-q" inputmode="decimal" style="font-size:1.1em"></label><button class="btn primary" style="min-height:44px">Registrar</button>
      <div id="ct-it" class="small" style="grid-column:1/-1"></div></form>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>Item</th><th>Classe</th>${cega ? '' : '<th class="num">Sistema</th>'}<th class="num">Contado</th><th class="num">Recontado</th><th>Situação</th><th></th></tr></thead><tbody>
      ${its.sort((a, b) => (['recontar', 'pendente'].indexOf(b.situacao)) - (['recontar', 'pendente'].indexOf(a.situacao))).map(i => `<tr><td>${rot(i)}</td><td>${i.classe || ''}</td>${cega ? '' : `<td class="num">${n(i.saldo_sistema)}</td>`}
        <td class="num">${n(i.contado)}</td><td class="num">${n(i.recontado)}</td><td><span class="badge ${SIT_I[i.situacao][1]}">${SIT_I[i.situacao][0]}</span></td>
        <td>${['pendente', 'recontar'].includes(i.situacao) ? `<button class="btn ghost small" data-it="${i.id}">Contar</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
  let alvo = null;
  const escolher = (i) => { alvo = i; $('#ct-it', root).innerHTML = i ? `<b>${rot(i)}</b> · ${D.prod[i.produto_id]?.unidade || ''}${i.situacao === 'recontar' ? ' · <span class="badge aberto">recontar: a primeira contagem ficou fora da tolerância</span>' : ''}` : ''; if (i) $('#ct-q', root).focus(); };
  const achar = (cod) => { const t = cod.trim().toUpperCase(); return its.find(i => (D.lote[i.lote_id]?.codigo || '').toUpperCase() === t) || its.find(i => (D.prod[i.produto_id]?.codigo || '').toUpperCase() === t); };
  $('#ct-cod', root).onchange = async (e) => {
    const cod = e.target.value.replace(/^.*[?&]b=([^&#]+).*$/i, '$1'); if (!cod.trim()) return escolher(null);
    const i = achar(decodeURIComponent(cod)); if (i) return escolher(i);
    // achado fora da lista: inclui o produto na contagem
    try { const p = (await q(sb.from('produtos').select('id,codigo,descricao,unidade').eq('empresa_id', state.empresa.id).ilike('codigo', cod.trim()).limit(1)))[0];
      if (!p) return toast('Código não encontrado', true);
      if (!confirm(`${p.codigo} não está nesta contagem. Incluir?`)) return;
      await q(sb.rpc('est_inv_incluir', { p_contagem: c.id, p_produto: p.id, p_lote: null })); toast('Item incluído'); render(root);
    } catch (err) { fail(err); }
  };
  $$('[data-it]', root).forEach(b => b.onclick = () => { const i = its.find(x => x.id === b.dataset.it); $('#ct-cod', root).value = D.prod[i.produto_id]?.codigo || ''; escolher(i); });
  $('#ct-f', root).onsubmit = async (e) => {
    e.preventDefault(); if (!alvo) return toast('Leia a etiqueta do item', true);
    const qv = parseNum($('#ct-q', root).value); if (!(qv >= 0) || $('#ct-q', root).value.trim() === '') return toast('Informe a quantidade', true);
    let just = null; if (alvo.situacao === 'recontar') just = prompt('Justificativa da diferença (opcional)') || null;
    try { const r = await q(sb.rpc('est_inv_contar', { p_item: alvo.id, p_qtd: qv, p_justificativa: just }));
      toast(r === 'ok' ? 'Contagem confere' : r === 'recontar' ? 'Fora da tolerância: reconte o item' : 'Divergência registrada para aprovação'); render(root); } catch (err) { fail(err); }
  };
  $('#ct-v', root).onclick = () => abrir(root, null);
  $('#ct-env', root).onclick = async () => { try { await q(sb.rpc('est_inv_enviar', { p_contagem: c.id })); toast('Enviada para aprovação'); render(root); } catch (err) { fail(err); } };
  $('#ct-x', root) && ($('#ct-x', root).onclick = () => cancelar(c, root));
}

// revisão e aprovação: sistema × contado, diferença e valor
function revisar(root, c) {
  const its = D.itens.filter(i => i.contagem_id === c.id), cfg = D.cfg;
  const podeAprovar = cfg.papeis_aprovacao.includes(state.papel) && c.situacao === 'em_aprovacao';
  const dif = (i) => (+(i.recontado ?? i.contado) || 0) - (+i.saldo_sistema || 0);
  const tot = its.filter(i => ['divergente', 'ajustado'].includes(i.situacao)).reduce((s, i) => s + dif(i) * (+i.custo || 0), 0);
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Contagem nº ${c.numero} — ${esc(D.loc[c.local_id]?.nome || '')}</h2><div class="muted small"><span class="badge ${SIT[c.situacao][1]}">${SIT[c.situacao][0]}</span> · criada em ${dateBR(c.criada_em)} por ${quem(c.criada_por)}${c.decidida_por ? ` · decidida por ${quem(c.decidida_por)} em ${dateBR(c.decidida_em)}` : ''}${c.motivo ? ` · ${esc(c.motivo)}` : ''}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="rv-v">← Contagens</button>${podeAprovar ? '<button class="btn" id="rv-r">Recusar (recontar)</button><button class="btn primary" id="rv-a">Aprovar e ajustar</button>' : ''}${c.situacao === 'em_aprovacao' && podeEditar() ? '<button class="btn" id="rv-x">Cancelar</button>' : ''}</div></div>
    <div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="k-label">Itens</div><div class="k-value">${its.length}</div></div><div class="kpi"><div class="k-label">Divergentes</div><div class="k-value">${its.filter(i => ['divergente', 'ajustado'].includes(i.situacao)).length}</div></div>
      <div class="kpi"><div class="k-label">Valor da divergência</div><div class="k-value ${tot < 0 ? 'neg' : ''}">${money(tot)}</div><div class="k-sub">pelo custo médio</div></div>
      <div class="kpi"><div class="k-label">Acurácia</div><div class="k-value">${its.length ? Math.round(its.filter(i => i.situacao === 'ok').length / its.length * 100) + '%' : '—'}</div><div class="k-sub">itens dentro da tolerância</div></div></div>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>Item</th><th class="num">Sistema</th><th class="num">Contado</th><th class="num">Recontado</th><th class="num">Diferença</th><th class="num">Valor</th><th>Justificativa / quem contou</th><th>Situação</th></tr></thead><tbody>
      ${its.map(i => { const d = dif(i); return `<tr><td>${esc(D.prod[i.produto_id]?.codigo || '')} ${esc(D.prod[i.produto_id]?.descricao || '')}${i.lote_id ? ` · lote ${esc(D.lote[i.lote_id]?.codigo || '')}` : ''}</td>
        <td class="num">${n(i.saldo_sistema)}</td><td class="num">${n(i.contado)}</td><td class="num">${n(i.recontado)}</td><td class="num ${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}">${d > 0 ? '+' : ''}${n(d)}</td><td class="num">${money(d * (+i.custo || 0))}</td>
        <td>${esc(i.justificativa || '')}${i.contado_por ? `<span class="muted">${i.justificativa ? ' · ' : ''}${quem(i.contado_por)}</span>` : ''}</td><td><span class="badge ${SIT_I[i.situacao][1]}">${SIT_I[i.situacao][0]}</span></td></tr>`; }).join('')}</tbody></table></div></div>
    <p class="small muted">Aprovar gera um ajuste de inventário (AJ+ para sobra, AJ− para falta) no Kardex para cada item divergente, na data de hoje e pelo custo médio. Recusar devolve os divergentes para recontagem.</p>`;
  $('#rv-v', root).onclick = () => abrir(root, null);
  $('#rv-a', root) && ($('#rv-a', root).onclick = async () => { try { const k = await q(sb.rpc('est_inv_aprovar', { p_contagem: c.id, p_aprovar: true, p_motivo: null })); toast(`Aprovada: ${k} ajuste(s) no Kardex`); render(root); } catch (e) { fail(e); } });
  $('#rv-r', root) && ($('#rv-r', root).onclick = () => { const mt = prompt('Motivo da recusa (o que conferir na recontagem)'); if (mt) q(sb.rpc('est_inv_aprovar', { p_contagem: c.id, p_aprovar: false, p_motivo: mt })).then(() => { toast('Devolvida para recontagem'); render(root); }).catch(fail); });
  $('#rv-x', root) && ($('#rv-x', root).onclick = () => cancelar(c, root));
}

function cancelar(c, root) {
  const mt = prompt(`Motivo do cancelamento da contagem nº ${c.numero}`); if (!mt) return;
  q(sb.rpc('est_inv_cancelar', { p_contagem: c.id, p_motivo: mt })).then(() => { toast('Contagem cancelada'); abrir(root, null); }).catch(fail);
}

function parametros(root) {
  const c = D.cfg, PAP = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['compras', 'Compras']];
  const m = modal({ title: 'Parâmetros do inventário cíclico', body: `<div class="grid-form">
      <label>Classe A: contar a cada (dias)<input type="number" id="ip-a" min="7" max="365" value="${c.dias_a}"></label>
      <label>Classe B: a cada (dias)<input type="number" id="ip-b" min="7" max="365" value="${c.dias_b}"></label>
      <label>Classe C: a cada (dias)<input type="number" id="ip-c" min="7" max="730" value="${c.dias_c}"></label>
      <label>Itens por contagem (1 a 200)<input type="number" id="ip-n" min="1" max="200" value="${c.itens_por_contagem}"></label>
      <label>Tolerância (% da quantidade)<input type="number" id="ip-t" min="0" max="50" step="0.5" value="${c.tolerancia_pct}"></label>
      <label>Tolerância (R$ da diferença)<input type="number" id="ip-v" min="0" step="10" value="${c.tolerancia_valor}"></label></div>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="ip-cg" ${c.contagem_cega ? 'checked' : ''}> Contagem cega (quem conta não vê o saldo do sistema)</label>
    <label class="chk"><input type="checkbox" id="ip-rc" ${c.recontar ? 'checked' : ''}> Pedir recontagem quando a primeira contagem passar da tolerância</label>
    <div class="small" style="margin:8px 0 2px">Quem aprova os ajustes:</div><div style="display:flex;gap:4px 14px;flex-wrap:wrap">${PAP.map(([k, t]) => `<label class="chk" style="font-weight:400"><input type="checkbox" class="ip-p" value="${k}" ${c.papeis_aprovacao.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div>
    <p class="small muted">Um item fica OK quando a diferença está dentro das duas tolerâncias (percentual e valor). Classes pela curva ABC do valor em estoque: A até 80%, B até 95%, C o resto.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ip-ok">Salvar</button>' });
  $('#ip-ok', m.el).onclick = async () => {
    const v = (id) => +$(id, m.el).value, reg = { empresa_id: state.empresa.id, dias_a: v('#ip-a'), dias_b: v('#ip-b'), dias_c: v('#ip-c'), itens_por_contagem: v('#ip-n'), tolerancia_pct: v('#ip-t'), tolerancia_valor: v('#ip-v'),
      contagem_cega: $('#ip-cg', m.el).checked, recontar: $('#ip-rc', m.el).checked, papeis_aprovacao: $$('.ip-p:checked', m.el).map(x => x.value), atualizado_em: new Date().toISOString() };
    if (!reg.papeis_aprovacao.length) return toast('Escolha quem aprova', true);
    if (!(reg.dias_a >= 7 && reg.dias_b >= 7 && reg.dias_c >= 7 && reg.itens_por_contagem >= 1 && reg.itens_por_contagem <= 200 && reg.tolerancia_pct >= 0 && reg.tolerancia_pct <= 50 && reg.tolerancia_valor >= 0)) return toast('Confira as faixas', true);
    try { await q(sb.from('est_inv_config').upsert(reg)); m.close(); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
  };
}

// Crédito / FIDC › Recompras (FIN021): título negociado no fundo que a empresa recomprou. Registrar cria a saída da recompra
// (2.07.11) e os encargos (diferença cobrada pelo fundo) na conta escolhida, e devolve o título para a carteira EM ABERTO
// (a baixa depois vale em qualquer conta). Recompras lançadas à mão e as informadas no relatório do fundo aparecem como
// pendências para registrar ou vincular. Pedido do Renan em 20/10 (caso 1-34724/1 Mastercola).
import { sb, state, q, loadCadastros, fetchAll } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, dateBR, today, options, parseNum, exportXLSX } from '../lib/ui.js';
import { kpiGrid } from '../lib/componentes.js';

export const title = 'Recompras';
const ui = { f: 'aberto' };
const pode = () => ['admin', 'financeiro'].includes(state.papel);
const CSS = `<style>
  .rc-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
  .rc-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.rc-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .rc-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.rc-sel.muted{background:var(--surface-2);color:var(--muted)}
  .rc-kpis{grid-template-columns:repeat(5,minmax(0,1fr))!important}@media(max-width:1000px){.rc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
  .rc-res{max-height:230px;overflow:auto;border:1px solid var(--border);border-radius:10px;margin-top:6px}
  .rc-res div{padding:8px 10px;border-top:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;gap:10px}.rc-res div:first-child{border-top:0}
  .rc-res div:hover,.rc-res div.on{background:var(--primary-soft)}
  .rc-titulo{border:1px solid var(--primary);border-radius:10px;padding:10px 12px;background:var(--primary-soft);margin:8px 0}
  .rc-calc{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px;font-size:13px}.rc-calc div{border:1px solid var(--border);border-radius:8px;padding:8px}.rc-calc span{display:block;color:var(--muted);font-size:11.5px}
  .card label.chk,.modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input,.modal label.chk input{width:auto;min-height:0}
</style>`;

/** alertas para a Central de Decisões (regra 22) */
export async function alertasDecisao() {
  try {
    const e = state.empresa.id, [L, P] = await Promise.all([q(sb.rpc('fidc_recompras_lista', { p_empresa: e })), q(sb.rpc('fidc_recompras_pendentes', { p_empresa: e }))]);
    const venc = L.filter(x => !x.cancelada && x.reaberto_status === 'Em aberto' && x.reaberto_venc < today());
    const a = [];
    if (venc.length) a.push({ nivel: 'alto', titulo: `${venc.length} título(s) recomprado(s) vencido(s) sem receber`, valor: venc.reduce((s, x) => s + +x.valor_titulo, 0), detalhe: venc.slice(0, 4).map(x => `${x.documento} ${x.cliente || ''}`).join(' · ') });
    if (P.length) a.push({ nivel: 'medio', titulo: `${P.length} recompra(s) sem registro (relatório do fundo ou lançada à mão)`, valor: P.reduce((s, x) => s + +x.valor, 0), detalhe: 'Registre ou vincule para o título voltar para a carteira.' });
    return a;
  } catch { return []; }
}

export async function render(root) {
  const e = state.empresa.id;
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Recompras</h2><div class="muted small">Título negociado no fundo e recomprado pela empresa: a saída da recompra, os encargos e o título de volta na carteira, em aberto até o cliente pagar.</div></div>
      <div class="pi-acoes" style="display:flex;gap:8px;align-items:end"><button class="btn ghost" id="rc-xls">Excel</button>${pode() ? '<button class="btn ghost" id="rc-par">Parâmetros</button><button class="btn primary" id="rc-novo">Registrar recompra</button>' : ''}</div></div>
    <div id="rc-corpo"><div class="loading">Carregando…</div></div>`;
  let L, P, Cf;
  try {
    await loadCadastros();
    [L, P, Cf] = await Promise.all([q(sb.rpc('fidc_recompras_lista', { p_empresa: e })), q(sb.rpc('fidc_recompras_pendentes', { p_empresa: e })), q(sb.from('fidc_recompra_config').select('*').eq('empresa_id', e))]);
  } catch (err) { fail(err); $('#rc-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 093 (recompras) já foi executado.</div></div>'; return; }
  const re = () => render(root), hoje = today(), ano = hoje.slice(0, 4);
  const at = L.filter(x => !x.cancelada), ab = at.filter(x => x.reaberto_status === 'Em aberto'), venc = ab.filter(x => x.reaberto_venc < hoje);
  const rec = at.filter(x => x.reaberto_status === 'Pago' && String(x.recebido_em).startsWith(ano));
  $('#rc-novo', root) && ($('#rc-novo', root).onclick = () => registrar(e, Cf[0], {}, re));
  $('#rc-par', root) && ($('#rc-par', root).onclick = () => parametros(e, Cf[0], re));
  const corpo = $('#rc-corpo', root);
  const sit = (x) => x.cancelada ? '<span class="rc-sel muted">cancelada</span>' : x.reaberto_status === 'Pago' ? `<span class="rc-sel pos">recebido ${dateBR(x.recebido_em)}</span><div class="small muted">${esc(x.recebido_conta || '')}</div>`
    : x.reaberto_status === 'Em aberto' ? `<span class="rc-sel ${x.reaberto_venc < hoje ? 'neg' : 'warn'}">${x.reaberto_venc < hoje ? 'vencido' : 'em aberto'} · ${dateBR(x.reaberto_venc)}</span>` : '<span class="rc-sel muted">sem título</span>';
  const pintar = () => {
    const V = L.filter(x => ui.f === 'todas' || (ui.f === 'canceladas' ? x.cancelada : !x.cancelada && (ui.f === 'aberto' ? x.reaberto_status === 'Em aberto' : x.reaberto_status === 'Pago')));
    corpo.innerHTML = `${P.length ? `<div class="card" style="border-left:4px solid var(--warn);margin-bottom:12px"><h2 style="margin-top:0">Recompras sem registro (${P.length})</h2>
        <div class="small muted" style="margin-bottom:8px">Do relatório de títulos pagos do fundo (tipo recompra) e saídas lançadas à mão em 2.07.11. Registre ou vincule para o título voltar para a carteira.</div>
        <div class="table-wrap"><table><thead><tr><th>Data</th><th>Origem</th><th>Documento</th><th class="num">Valor</th><th>Título sugerido</th><th></th></tr></thead><tbody>
        ${P.map((x, i) => `<tr><td>${dateBR(x.data)}</td><td class="small">${x.origem === 'fundo' ? 'Relatório do fundo' : 'Lançada à mão'}${x.fundo ? `<div class="muted">${esc(x.fundo)}</div>` : ''}</td>
          <td class="wrap small">${esc(x.documento || '')}${x.cliente ? `<div class="muted">${esc(x.cliente)}</div>` : ''}</td><td class="num">${money(x.valor)}</td>
          <td class="small wrap">${x.sugestao_id ? `${esc(x.sugestao_doc)} · ${money(x.sugestao_valor)}` : '<span class="muted">nenhum: escolha ao registrar</span>'}</td>
          <td>${pode() ? `<button class="btn small primary" data-p="${i}">${x.origem === 'manual' ? 'Vincular' : 'Registrar'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div id="rc-kpis"></div>
      <div class="card toolbar" style="margin-top:12px"><div class="chips" id="rc-f">${[['aberto', 'Título em aberto'], ['recebidas', 'Recebidos'], ['canceladas', 'Canceladas'], ['todas', 'Todas']].map(([k, t]) => `<span class="chip ${ui.f === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div></div>
      <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table id="rc-tab"><thead><tr><th>Nº</th><th>Título</th><th>Fundo</th><th>Recompra</th><th class="num">Valor</th><th>Título de volta</th><th></th></tr></thead><tbody>
      ${V.map(x => `<tr><td><b>${x.numero}</b>${x.vinculada ? '<div class="small muted">vinculada</div>' : ''}</td>
        <td class="wrap"><a href="#/lancamentos?abrir=${x.lancamento_id}">${esc(x.documento || '')}</a><div class="small muted">${esc(x.cliente || '')}</div></td>
        <td>${esc(x.fundo || '—')}</td><td>${dateBR(x.data)}<div class="small muted">${esc(x.conta || '')}</div></td>
        <td class="num">${money(x.valor_recompra)}${+x.encargos ? `<div class="small muted">título ${money(x.valor_titulo)} + encargos ${money(x.encargos)}</div>` : ''}</td>
        <td>${sit(x)}${x.lanc_reaberto_id ? `<div class="small"><a href="#/lancamentos?abrir=${x.lanc_reaberto_id}">abrir o título</a></div>` : ''}</td>
        <td>${pode() && !x.cancelada && x.reaberto_status !== 'Pago' ? `<button class="btn ghost small" data-c="${x.id}">Cancelar</button>` : ''}${x.cancelada && x.motivo ? `<div class="small muted wrap">${esc(x.motivo)}</div>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Nenhuma recompra neste filtro.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">A recompra sai em 2.07.11 RECOMPRA/DEVOLUÇÃO DE TÍTULOS NEGOCIADOS; o que o fundo cobrar além do título sai como encargos. O título volta como conta a receber, e o recebimento do cliente entra como receita na conta em que ele pagar.</p>`;
    $('#rc-kpis', corpo).classList.add('rc-kpis');
    kpiGrid($('#rc-kpis', corpo), [
      { id: 'ab', label: 'Recomprados em aberto', valor: money(ab.reduce((s, x) => s + +x.valor_titulo, 0)), sub: `${ab.length} título(s)` },
      { id: 'vc', label: 'Vencidos sem receber', valor: money(venc.reduce((s, x) => s + +x.valor_titulo, 0)), sub: `${venc.length} título(s)`, tom: venc.length ? 'neg' : '' },
      { id: 'rc', label: `Recebidos em ${ano}`, valor: money(rec.reduce((s, x) => s + +x.valor_titulo, 0)), sub: `${rec.length} título(s)`, tom: 'pos' },
      { id: 'en', label: `Encargos de recompra em ${ano}`, valor: money(at.filter(x => String(x.data).startsWith(ano)).reduce((s, x) => s + +x.encargos, 0)), sub: 'cobrado pelos fundos além do título' },
      { id: 'pd', label: 'Sem registro', valor: String(P.length), sub: P.length ? money(P.reduce((s, x) => s + +x.valor, 0)) : 'nenhuma pendência', tom: P.length ? 'warn' : '' },
    ]);
    $('#rc-f', corpo).onclick = (ev) => { const f = ev.target.closest('[data-f]')?.dataset.f; if (f) { ui.f = f; pintar(); } };
    $$('[data-p]', corpo).forEach(b => b.onclick = () => { const x = P[+b.dataset.p]; registrar(e, Cf[0], x.origem === 'manual'
      ? { tituloId: x.sugestao_id, saida: x, data: x.data, valor: x.valor } : { tituloId: x.sugestao_id, liquidacao: x.id, data: x.data, valor: x.valor, busca: x.documento }, re); });
    $$('[data-c]', corpo).forEach(b => b.onclick = () => cancelar(b.dataset.c, re));
  };
  $('#rc-xls', root).onclick = () => exportXLSX($('#rc-tab', root), 'recompras');
  pintar();
}

function registrar(e, cfg, pre, depois) {
  const contas = state.cad.contas.filter(c => c.ativo !== false);
  const m = modal({ title: pre.saida ? 'Vincular recompra lançada à mão' : 'Registrar recompra', wide: true, body: `
    ${pre.saida ? `<div class="rc-titulo small"><b>Saída já lançada:</b> ${dateBR(pre.saida.data)} · ${esc(pre.saida.documento)} · ${money(pre.saida.valor)}. Ela fica vinculada (nada é lançado de novo).</div>` : ''}
    <label>Título negociado (procure pelo número, cliente ou valor)<input id="rc-b" placeholder="ex.: 34724" value="${esc(pre.busca ? String(pre.busca).split('-')[0] : '')}"></label>
    <div class="rc-res" id="rc-r"><div class="muted" style="cursor:default">Digite para procurar entre os títulos cedidos.</div></div>
    <div id="rc-t"></div>
    <div class="grid-form" style="margin-top:8px">
      <label class="xs">Data da recompra<input type="date" id="rc-d" value="${pre.data || today()}" ${pre.saida ? 'disabled' : ''}></label>
      <label class="xs">Valor da recompra (R$)<input id="rc-v" inputmode="decimal" value="${pre.valor != null ? (+pre.valor).toFixed(2).replace('.', ',') : ''}" ${pre.saida ? 'disabled' : ''}></label>
      <label class="c4">Saiu da conta<select id="rc-c" ${pre.saida ? 'disabled' : ''}>${options(contas, { selected: null, empty: '— a conta do fundo —' })}</select></label>
      <label class="c4">O título volta com vencimento<input type="date" id="rc-vt"></label></div>
    <div class="rc-calc" id="rc-calc"></div>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="rc-pg"> O cliente já pagou este título (vincular o recebimento lançado)</label>
    <div id="rc-pgl" hidden></div>
    <label style="margin-top:8px">Observação<input id="rc-o" maxlength="300"></label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rc-ok" disabled>${pre.saida ? 'Vincular' : 'Registrar a recompra'}</button>` });
  let tit = null, recebido = null, busc = 0;
  const calc = () => {
    const v = pre.saida ? +pre.saida.valor : parseNum($('#rc-v', m.el).value || '0');
    if (!tit) { $('#rc-calc', m.el).innerHTML = ''; return; }
    const enc = Math.max(0, Math.round((v - tit.valor) * 100) / 100);
    $('#rc-calc', m.el).innerHTML = `<div><span>Recompra (2.07.11)</span>${money(Math.min(v, tit.valor))}</div><div><span>Encargos do fundo</span>${money(enc)}</div><div><span>Volta para a carteira (em aberto)</span>${recebido ? 'já recebido' : money(tit.valor)}</div>`;
    $('#rc-ok', m.el).disabled = !(v > 0);
  };
  const escolher = (t) => {
    tit = t; $$('#rc-r [data-i]', m.el).forEach(d => d.classList.toggle('on', d.dataset.i === t.id));
    $('#rc-t', m.el).innerHTML = `<div class="rc-titulo"><b>${esc(t.documento)}</b> · ${esc(t.cliente || '')} · ${money(t.valor)}<div class="small">Cedido em ${dateBR(t.data)} ao fundo ${esc(t.fundo)} (conta ${esc(t.conta)})${t.vencimento ? ` · vencimento original ${dateBR(t.vencimento)}` : ''}</div></div>`;
    const vt = $('#rc-vt', m.el); if (!vt.value) vt.value = cfg?.prazo_dias ? new Date(Date.now() + cfg.prazo_dias * 864e5).toISOString().slice(0, 10) : (t.vencimento && t.vencimento >= today() ? t.vencimento : today());
    if (!pre.saida && !$('#rc-c', m.el).value) { const c = state.cad.contas.find(c => c.nome === t.conta); if (c) $('#rc-c', m.el).value = c.id; }
    calc(); carregarRecebidos();
  };
  const buscar = async () => {
    const n = ++busc, txt = $('#rc-b', m.el).value.trim();
    try { const R = await q(sb.rpc('fidc_cedidos_busca', { p_empresa: e, p_busca: txt })); if (n !== busc) return;
      $('#rc-r', m.el).innerHTML = R.map(t => `<div data-i="${t.id}"><span><b>${esc(t.documento)}</b> · ${esc(t.cliente || '')}<span class="small muted"> · ${esc(t.fundo)} · ${dateBR(t.data)}</span></span><span>${money(t.valor)}</span></div>`).join('') || '<div class="muted" style="cursor:default">Nenhum título cedido encontrado.</div>';
      $$('#rc-r [data-i]', m.el).forEach(d => d.onclick = () => escolher(R.find(t => t.id === d.dataset.i)));
      if (pre.tituloId && !tit) { const t = R.find(x => x.id === pre.tituloId); if (t) escolher(t); }
    } catch (err) { fail(err); }
  };
  async function carregarRecebidos() {
    if (!$('#rc-pg', m.el).checked || !tit) { $('#rc-pgl', m.el).hidden = true; recebido = null; calc(); return; }
    const t0 = state.cad.planoById; const doc = String(tit.documento || '').split(' ')[0];
    const R = await q(sb.from('lancamentos').select('id,data,descricao,valor,conta_id,plano_id').eq('empresa_id', e).eq('status', 'Pago').neq('id', tit.id).gte('data', tit.data)
      .or(`descricao.ilike.%${doc.replace(/[%,()]/g, '')}%,valor.eq.${tit.valor}`).order('data', { ascending: false }).limit(20)).catch(() => []);
    const E = R.filter(l => t0[l.plano_id]?.tipo === 'E' && l.conta_id !== state.cad.contas.find(c => c.nome === tit.conta)?.id);
    $('#rc-pgl', m.el).hidden = false;
    $('#rc-pgl', m.el).innerHTML = `<div class="rc-res">${E.map(l => `<div data-l="${l.id}"><span>${dateBR(l.data)} · ${esc(l.descricao || '')}<span class="small muted"> · ${esc(state.cad.contaById[l.conta_id]?.nome || '')}</span></span><span>${money(l.valor)}</span></div>`).join('') || '<div class="muted" style="cursor:default">Nenhum recebimento parecido. Desmarque: o título volta em aberto e você baixa quando o cliente pagar.</div>'}</div>`;
    $$('#rc-pgl [data-l]', m.el).forEach(d => d.onclick = () => { recebido = d.dataset.l; $$('#rc-pgl [data-l]', m.el).forEach(x => x.classList.toggle('on', x === d)); calc(); });
  }
  $('#rc-b', m.el).oninput = () => { clearTimeout(m._t); m._t = setTimeout(buscar, 250); };
  $('#rc-v', m.el).oninput = calc; $('#rc-pg', m.el).onchange = carregarRecebidos;
  buscar();
  $('#rc-ok', m.el).onclick = async (ev) => {
    if (!tit) return toast('Escolha o título negociado', true);
    if ($('#rc-pg', m.el).checked && !recebido) return toast('Escolha o recebimento do cliente, ou desmarque a opção', true);
    ev.target.disabled = true;
    try {
      await q(sb.rpc('fidc_recompra_registrar', { p_lancamento: tit.id, p_data: pre.saida ? pre.saida.data : $('#rc-d', m.el).value, p_valor_recompra: pre.saida ? +pre.saida.valor : parseNum($('#rc-v', m.el).value),
        p_conta: pre.saida ? null : ($('#rc-c', m.el).value || null), p_vencimento: $('#rc-vt', m.el).value || null, p_obs: $('#rc-o', m.el).value.trim() || null,
        p_lanc_recompra: pre.saida?.id || null, p_lanc_recebido: recebido, p_liquidacao: pre.liquidacao || null }));
      m.close(); toast(pre.saida ? 'Recompra vinculada' : recebido ? 'Recompra registrada e o recebimento vinculado' : 'Recompra registrada: o título voltou para a carteira, em aberto'); depois();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

function cancelar(id, depois) {
  const m = modal({ title: 'Cancelar a recompra', narrow: true, body: '<p class="small" style="margin-top:0">Os lançamentos que a recompra criou (saída, encargos e o título reaberto) são apagados. Recompra vinculada só perde o vínculo.</p><label>Motivo<input id="rc-m" maxlength="300"></label>',
    foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="rc-mok">Cancelar a recompra</button>' });
  $('#rc-mok', m.el).onclick = async (ev) => { ev.target.disabled = true;
    try { await q(sb.rpc('fidc_recompra_cancelar', { p_id: id, p_motivo: $('#rc-m', m.el).value })); m.close(); toast('Recompra cancelada'); depois(); } catch (err) { fail(err); ev.target.disabled = false; } };
}

function parametros(e, cfg = {}, depois) {
  const S = state.cad.plano.filter(p => p.tipo === 'S' && p.nivel === 2);
  const pad = (c) => S.find(p => p.codigo === c)?.id;
  const m = modal({ title: 'Parâmetros da recompra', body: `<div class="grid-form">
      <label class="full">Plano da recompra<select id="rp-r">${options(S, { label: 'label', selected: cfg?.plano_recompra_id || pad('2.07.11'), empty: '—' })}</select></label>
      <label class="full">Plano dos encargos (o que o fundo cobra além do título)<select id="rp-e">${options(S, { label: 'label', selected: cfg?.plano_encargos_id || pad('2.07.08'), empty: '—' })}</select></label>
      <label class="c4">Vencimento sugerido do título reaberto (dias)<input id="rp-d" inputmode="numeric" value="${cfg?.prazo_dias ?? 0}"></label></div>
    <p class="small muted">0 dia = usa o vencimento original do título (ou hoje, se já passou).</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rp-ok">Salvar</button>' });
  $('#rp-ok', m.el).onclick = async () => {
    try { await q(sb.from('fidc_recompra_config').upsert({ empresa_id: e, plano_recompra_id: $('#rp-r', m.el).value || null, plano_encargos_id: $('#rp-e', m.el).value || null, prazo_dias: Math.max(0, parseInt($('#rp-d', m.el).value) || 0), atualizado_em: new Date().toISOString() }));
      m.close(); toast('Parâmetros salvos'); depois(); } catch (err) { fail(err); }
  };
}

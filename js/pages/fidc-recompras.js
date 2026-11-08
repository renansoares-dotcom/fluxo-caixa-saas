// Crédito / FIDC › Recompras (FIN021): título negociado no fundo que a empresa recomprou. Registrar cria a saída da recompra
// (2.07.11) e os encargos (diferença cobrada pelo fundo) na conta escolhida. O MOTIVO (SQL 094, cadastro configurável) decide
// o que acontece com o título (volta em aberto, não volta na devolução, trocado por outro, já recebido), a linha da recompra
// na DRE Gerencial e a contrapartida contábil. Recompras lançadas à mão e as informadas no relatório do fundo aparecem como
// pendências para registrar ou vincular. Pedido do Renan em 20/10 (caso 1-34724/1 Mastercola) e em 07/11 (motivos).
import { sb, state, q, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, pct, dateBR, today, options, parseNum, exportXLSX } from '../lib/ui.js';
import { kpiGrid } from '../lib/componentes.js';
import { ACOES, SECOES, carregarMotivos, motivosModal, corMotivo } from '../lib/recompra-motivos.js';
import { botaoConversa } from '../lib/mini-chat.js';

export const title = 'Recompras';
const ui = { f: 'aberto', mot: '' };
const pode = () => ['admin', 'financeiro'].includes(state.papel);
const CSS = `<style>
  .rc-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
  .rc-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.rc-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .rc-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.rc-sel.muted{background:var(--surface-2);color:var(--muted)}
  .rc-mot{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:6px;border:1px solid var(--border);white-space:nowrap}
  .rc-mot i{width:8px;height:8px;border-radius:2px;display:inline-block}
  .rc-kpis{grid-template-columns:repeat(5,minmax(0,1fr))!important}@media(max-width:1000px){.rc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
  .rc-res{max-height:230px;overflow:auto;border:1px solid var(--border);border-radius:10px;margin-top:6px}
  .rc-res div{padding:8px 10px;border-top:1px solid var(--border);cursor:pointer;display:flex;justify-content:space-between;gap:10px}.rc-res div:first-child{border-top:0}
  .rc-res div:hover,.rc-res div.on{background:var(--primary-soft)}
  .rc-titulo{border:1px solid var(--primary);border-radius:10px;padding:10px 12px;background:var(--primary-soft);margin:8px 0}
  .rc-calc{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px;font-size:13px}.rc-calc div{border:1px solid var(--border);border-radius:8px;padding:8px}.rc-calc span{display:block;color:var(--muted);font-size:11.5px}
  .rc-mots{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 2px}.rc-mots button{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
  .rc-mots button.on{border-color:var(--primary);background:var(--primary-soft);font-weight:600}.rc-mots i{width:9px;height:9px;border-radius:3px;display:inline-block}
  .rc-hint{font-size:12.5px;color:var(--muted);margin:4px 0 0}
  .rc-paineis{display:grid;grid-template-columns:1.1fr 1fr;gap:12px;margin-top:12px}@media(max-width:1000px){.rc-paineis{grid-template-columns:1fr}}
  .rc-bar{display:grid;grid-template-columns:minmax(150px,250px) 1fr 104px;gap:10px;align-items:center;font-size:13px;padding:5px 0}
  .rc-bar .t{height:10px;border-radius:5px;background:var(--surface-2);overflow:hidden}.rc-bar .t b{display:block;height:100%;border-radius:5px}
  .rc-taxa{font-size:28px;font-weight:700;line-height:1.1}
  .card label.chk,.modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input,.modal label.chk input{width:auto;min-height:0}
</style>`;

/** alertas para a Central de Decisões (regra 22) */
export async function alertasDecisao() {
  try {
    const e = state.empresa.id, ano = +today().slice(0, 4);
    const [L, P, Rz, Cf] = await Promise.all([q(sb.rpc('fidc_recompras_lista', { p_empresa: e })), q(sb.rpc('fidc_recompras_pendentes', { p_empresa: e })),
      q(sb.rpc('fidc_recompras_resumo', { p_empresa: e, p_ano: ano })).catch(() => null), q(sb.from('fidc_recompra_config').select('limite_taxa_cliente').eq('empresa_id', e)).catch(() => [])]);
    const venc = L.filter(x => !x.cancelada && x.reaberto_status === 'Em aberto' && x.reaberto_venc < today());
    const a = [];
    if (venc.length) a.push({ nivel: 'alto', titulo: `${venc.length} título(s) recomprado(s) vencido(s) sem receber`, valor: venc.reduce((s, x) => s + +x.valor_titulo, 0), detalhe: venc.slice(0, 4).map(x => `${x.documento} ${x.cliente || ''}`).join(' · ') });
    if (P.length) a.push({ nivel: 'medio', titulo: `${P.length} recompra(s) sem registro (relatório do fundo ou lançada à mão)`, valor: P.reduce((s, x) => s + +x.valor, 0), detalhe: 'Registre ou vincule com o motivo para o título voltar para a carteira e a DRE ficar certa.' });
    const lim = +(Cf[0]?.limite_taxa_cliente ?? 10);
    const altos = lim > 0 ? (Rz?.clientes || []).filter(c => +c.cedido > 0 && +c.recomprado / +c.cedido * 100 > lim) : [];
    if (altos.length) a.push({ nivel: 'medio', titulo: `${altos.length} cliente(s) com taxa de recompra acima de ${lim}% em ${ano}`, valor: altos.reduce((s, c) => s + +c.recomprado, 0),
      detalhe: altos.slice(0, 3).map(c => `${c.cliente || 'sem cliente'} ${(+c.recomprado / +c.cedido * 100).toFixed(1).replace('.', ',')}% (${c.motivos || ''})`).join(' · ') + '. Avalie antes de ceder novos títulos deste cliente.' });
    return a;
  } catch { return []; }
}

export async function render(root) {
  const e = state.empresa.id, ano = +today().slice(0, 4);
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Recompras</h2><div class="muted small">Título negociado no fundo e recomprado pela empresa: a saída da recompra, os encargos e o que acontece com o título, conforme o motivo.</div></div>
      <div class="pi-acoes" style="display:flex;gap:8px;align-items:end"><button class="btn ghost" id="rc-xls">Excel</button><button class="btn ghost" id="rc-mtv">Motivos</button>${pode() ? '<button class="btn ghost" id="rc-par">Parâmetros</button><button class="btn primary" id="rc-novo">Registrar recompra</button>' : ''}</div></div>
    <div id="rc-corpo"><div class="loading">Carregando…</div></div>`;
  let L, P, Cf, M, Rz;
  try {
    await loadCadastros();
    [L, P, Cf, M, Rz] = await Promise.all([q(sb.rpc('fidc_recompras_lista', { p_empresa: e })), q(sb.rpc('fidc_recompras_pendentes', { p_empresa: e })),
      q(sb.from('fidc_recompra_config').select('*').eq('empresa_id', e)), carregarMotivos(e), q(sb.rpc('fidc_recompras_resumo', { p_empresa: e, p_ano: ano }))]);
  } catch (err) { fail(err); $('#rc-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se os SQL 093 (recompras) e 094 (motivos) já foram executados.</div></div>'; return; }
  const re = () => render(root), hoje = today(), cfg = Cf[0] || {};
  const cor = (id) => corMotivo(Math.max(0, M.findIndex(m => m.id === id)));
  const at = L.filter(x => !x.cancelada), ab = at.filter(x => x.reaberto_status === 'Em aberto' && x.titulo_acao !== 'recebido'), venc = ab.filter(x => x.reaberto_venc < hoje);
  const rec = at.filter(x => x.reaberto_status === 'Pago' && String(x.recebido_em).startsWith(String(ano)));
  $('#rc-novo', root) && ($('#rc-novo', root).onclick = () => registrar(e, cfg, M, {}, re));
  $('#rc-par', root) && ($('#rc-par', root).onclick = () => parametros(e, cfg, re));
  $('#rc-mtv', root).onclick = () => motivosModal(e, pode(), re);
  const corpo = $('#rc-corpo', root);
  const sit = (x) => x.cancelada ? '<span class="rc-sel muted">cancelada</span>'
    : x.titulo_acao === 'substituir' ? `<span class="rc-sel muted">substituído</span>${x.titulo_novo_doc ? `<div class="small muted">por ${esc(x.titulo_novo_doc)}</div>` : ''}`
    : !x.lanc_reaberto_id ? `<span class="rc-sel muted">${x.titulo_acao === 'baixar' ? 'não volta (devolução)' : 'não volta'}</span>`
    : x.reaberto_status === 'Pago' ? `<span class="rc-sel pos">recebido ${dateBR(x.recebido_em)}</span><div class="small muted">${esc(x.recebido_conta || '')}</div>`
    : `<span class="rc-sel ${x.reaberto_venc < hoje ? 'neg' : 'warn'}">${x.reaberto_venc < hoje ? 'vencido' : 'em aberto'} · ${dateBR(x.reaberto_venc)}</span>${x.valor_reaberto && +x.valor_reaberto < +x.valor_titulo ? `<div class="small muted">saldo ${money(x.valor_reaberto)}</div>` : ''}`;
  const etiqueta = (x) => x.motivo_id ? `<span class="rc-mot"><i style="background:${cor(x.motivo_id)}"></i>${esc(x.motivo_nome)}</span>` : '<span class="rc-mot">sem motivo</span>';
  const paineis = () => {
    const tot = +Rz.recomprado || 0, taxa = +Rz.cedido ? tot / +Rz.cedido : null, lim = +(cfg.limite_taxa_cliente ?? 10);
    const mot = (Rz.motivos || []), max = Math.max(1, ...mot.map(x => +x.valor));
    return `<div class="rc-paineis">
      <div class="card"><h2 style="margin-top:0">Recompras por motivo em ${ano}</h2>
        ${mot.length ? mot.map(x => `<div class="rc-bar"><span class="wrap"><span class="rc-mot" style="border:0;padding:0"><i style="background:${cor(x.id)}"></i>${esc(x.nome)}</span> <span class="small muted">· ${x.qtd}</span></span>
          <span class="t"><b style="width:${(+x.valor / max * 100).toFixed(1)}%;background:${cor(x.id)}"></b></span><span class="num">${money(x.valor)}<div class="small muted">${tot ? pct(+x.valor / tot) : ''}</div></span></div>`).join('')
          : '<div class="empty">Nenhuma recompra no ano.</div>'}
        <p class="small muted" style="margin-bottom:0">Na DRE Gerencial cada motivo tem a sua linha (deduções da receita, despesas financeiras…); no fluxo de caixa tudo continua na 2.07.11.</p></div>
      <div class="card"><h2 style="margin-top:0">Taxa de recompra em ${ano}</h2>
        <div style="display:flex;gap:24px;align-items:end;flex-wrap:wrap"><div><div class="rc-taxa ${taxa > lim / 100 ? 'neg' : ''}">${taxa == null ? '–' : pct(taxa)}</div><div class="small muted">${money(tot)} recomprados de ${money(Rz.cedido)} cedidos</div></div>
          <div class="small">${(Rz.fundos || []).filter(f => +f.cedido || +f.recomprado).map(f => `<div><b>${esc(f.fundo || '—')}</b>: ${+f.cedido ? pct(+f.recomprado / +f.cedido) : '–'} <span class="muted">(${money(f.recomprado)} de ${money(f.cedido)})</span></div>`).join('')}</div></div>
        <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Cliente</th><th class="num">Cedido</th><th class="num">Recomprado</th><th class="num">Taxa</th></tr></thead><tbody>
        ${(Rz.clientes || []).slice(0, 6).map(c => { const t = +c.cedido ? +c.recomprado / +c.cedido : null; return `<tr><td class="wrap">${esc(c.cliente || '—')}<div class="small muted">${esc(c.motivos || '')}</div></td><td class="num">${money(c.cedido)}</td><td class="num">${money(c.recomprado)}</td>
          <td class="num"><span class="rc-sel ${t != null && lim > 0 && t * 100 > lim ? 'neg' : 'muted'}">${t == null ? '–' : pct(t)}</span></td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">Sem recompras no ano.</td></tr>'}</tbody></table></div>
        ${lim > 0 ? `<p class="small muted" style="margin-bottom:0">Acima de ${lim}% o cliente aparece na Central de Decisões (muda em Parâmetros).</p>` : ''}</div></div>`;
  };
  const pintar = () => {
    const V = L.filter(x => (ui.f === 'todas' || (ui.f === 'canceladas' ? x.cancelada : !x.cancelada && (ui.f === 'aberto' ? x.reaberto_status === 'Em aberto' && x.titulo_acao !== 'recebido' : ui.f === 'recebidas' ? x.reaberto_status === 'Pago' : !x.lanc_reaberto_id || x.titulo_acao === 'recebido')))
      && (!ui.mot || x.motivo_id === ui.mot));
    corpo.innerHTML = `${P.length ? `<div class="card" style="border-left:4px solid var(--warn);margin-bottom:12px"><h2 style="margin-top:0">Recompras sem registro (${P.length})</h2>
        <div class="small muted" style="margin-bottom:8px">Do relatório de títulos pagos do fundo (tipo recompra) e saídas lançadas à mão em 2.07.11. Registre ou vincule com o motivo: sem ele, a recompra fica nas despesas financeiras da DRE.</div>
        <div class="table-wrap"><table><thead><tr><th>Data</th><th>Origem</th><th>Documento</th><th class="num">Valor</th><th>Título sugerido</th><th></th></tr></thead><tbody>
        ${P.map((x, i) => `<tr><td>${dateBR(x.data)}</td><td class="small">${x.origem === 'fundo' ? 'Relatório do fundo' : 'Lançada à mão'}${x.fundo ? `<div class="muted">${esc(x.fundo)}</div>` : ''}</td>
          <td class="wrap small">${esc(x.documento || '')}${x.cliente ? `<div class="muted">${esc(x.cliente)}</div>` : ''}</td><td class="num">${money(x.valor)}</td>
          <td class="small wrap">${x.sugestao_id ? `${esc(x.sugestao_doc)} · ${money(x.sugestao_valor)}` : '<span class="muted">nenhum: escolha ao registrar</span>'}</td>
          <td>${pode() ? `<button class="btn small primary" data-p="${i}">${x.origem === 'manual' ? 'Vincular' : 'Registrar'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div id="rc-kpis"></div>
      ${paineis()}
      <div class="card toolbar" style="margin-top:12px"><div class="chips" id="rc-f">${[['aberto', 'Título em aberto'], ['recebidas', 'Recebidos'], ['naovolta', 'Não voltou'], ['canceladas', 'Canceladas'], ['todas', 'Todas']].map(([k, t]) => `<span class="chip ${ui.f === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
        <span class="spacer"></span><label>Motivo<select id="rc-fm">${options(M, { selected: ui.mot, empty: 'Todos' })}</select></label></div>
      <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table id="rc-tab"><thead><tr><th>Nº</th><th>Título</th><th>Motivo</th><th>Recompra</th><th class="num">Valor</th><th>O título</th><th></th></tr></thead><tbody>
      ${V.map(x => `<tr><td><b>${x.numero}</b>${x.vinculada ? '<div class="small muted">vinculada</div>' : ''}</td>
        <td class="wrap"><a href="#/lancamentos?abrir=${x.lancamento_id}">${esc(x.documento || '')}</a><div class="small muted">${esc(x.cliente || '')}</div></td>
        <td class="wrap">${etiqueta(x)}${x.nota_numero ? `<div class="small muted">NF-e de devolução ${x.nota_numero}</div>` : ''}${x.rnc_numero ? `<div class="small"><a href="#/qualidade/nao-conformidades">RNC ${x.rnc_numero}</a></div>` : ''}${x.observacao ? `<div class="small muted wrap">${esc(x.observacao)}</div>` : ''}</td>
        <td>${dateBR(x.data)}<div class="small muted">${esc(x.fundo || '')} · ${esc(x.conta || '')}</div></td>
        <td class="num">${money(x.valor_recompra)}${+x.encargos ? `<div class="small muted">título ${money(x.valor_titulo)} + encargos ${money(x.encargos)}</div>` : ''}</td>
        <td>${sit(x)}${x.lanc_reaberto_id ? `<div class="small"><a href="#/lancamentos?abrir=${x.lanc_reaberto_id}">abrir o título</a></div>` : ''}</td>
        <td>${botaoConversa('fidc_recompra', x.id, '💬')} ${pode() && !x.cancelada ? `<button class="btn ghost small" data-m="${x.id}">Motivo</button>${x.reaberto_status !== 'Pago' || x.titulo_acao === 'recebido' ? ` <button class="btn ghost small" data-c="${x.id}">Cancelar</button>` : ''}` : ''}${x.cancelada && x.motivo ? `<div class="small muted wrap">${esc(x.motivo)}</div>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Nenhuma recompra neste filtro.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">A recompra sai em 2.07.11 RECOMPRA/DEVOLUÇÃO DE TÍTULOS NEGOCIADOS e o que o fundo cobrar além do título sai como encargos. O motivo decide o que acontece com o título, a linha na DRE Gerencial e a contrapartida contábil (botão Motivos).</p>`;
    $('#rc-kpis', corpo).classList.add('rc-kpis');
    kpiGrid($('#rc-kpis', corpo), [
      { id: 'ab', label: 'Recomprados em aberto', valor: money(ab.reduce((s, x) => s + +(x.valor_reaberto ?? x.valor_titulo), 0)), sub: `${ab.length} título(s)` },
      { id: 'vc', label: 'Vencidos sem receber', valor: money(venc.reduce((s, x) => s + +(x.valor_reaberto ?? x.valor_titulo), 0)), sub: `${venc.length} título(s)`, tom: venc.length ? 'neg' : '' },
      { id: 'rc', label: `Recebidos em ${ano}`, valor: money(rec.reduce((s, x) => s + +(x.valor_reaberto ?? x.valor_titulo), 0)), sub: `${rec.length} título(s)`, tom: 'pos' },
      { id: 'en', label: `Encargos de recompra em ${ano}`, valor: money(Rz.encargos), sub: 'cobrado pelos fundos além do título' },
      { id: 'pd', label: 'Sem registro', valor: String(P.length), sub: P.length ? money(P.reduce((s, x) => s + +x.valor, 0)) : 'nenhuma pendência', tom: P.length ? 'warn' : '' },
    ]);
    $('#rc-f', corpo).onclick = (ev) => { const f = ev.target.closest('[data-f]')?.dataset.f; if (f) { ui.f = f; pintar(); } };
    $('#rc-fm', corpo).onchange = (ev) => { ui.mot = ev.target.value; pintar(); };
    $$('[data-p]', corpo).forEach(b => b.onclick = () => { const x = P[+b.dataset.p]; registrar(e, cfg, M, x.origem === 'manual'
      ? { tituloId: x.sugestao_id, saida: x, data: x.data, valor: x.valor } : { tituloId: x.sugestao_id, liquidacao: x.id, data: x.data, valor: x.valor, busca: x.documento }, re); });
    $$('[data-c]', corpo).forEach(b => b.onclick = () => cancelar(b.dataset.c, re));
    $$('[data-m]', corpo).forEach(b => b.onclick = () => trocarMotivo(e, L.find(x => x.id === b.dataset.m), M, re));
  };
  $('#rc-xls', root).onclick = () => exportXLSX($('#rc-tab', root), 'recompras');
  pintar();
}

// botões de motivo (só os ativos) com a cor e a dica
const botoesMotivo = (M, sel) => `<div class="rc-mots" id="rc-mo">${M.filter(m => m.ativo).map(m => `<button type="button" data-mo="${m.id}" class="${m.id === sel ? 'on' : ''}"><i style="background:${corMotivo(M.indexOf(m))}"></i>${esc(m.nome)}</button>`).join('')}</div>`;

function registrar(e, cfg, M, pre, depois) {
  const contas = state.cad.contas.filter(c => c.ativo !== false);
  const ativos = M.filter(m => m.ativo);
  if (!ativos.length) return toast('Cadastre ao menos um motivo ativo (botão Motivos)', true);
  let mot = (ativos.find(m => m.codigo === 'inadimplencia') || ativos[0]);
  const m = modal({ title: pre.saida ? 'Vincular recompra lançada à mão' : 'Registrar recompra', wide: true, body: `
    ${pre.saida ? `<div class="rc-titulo small"><b>Saída já lançada:</b> ${dateBR(pre.saida.data)} · ${esc(pre.saida.documento)} · ${money(pre.saida.valor)}. Ela fica vinculada (nada é lançado de novo).</div>` : ''}
    <label>Título negociado (procure pelo número, cliente ou valor)<input id="rc-b" placeholder="ex.: 34724" value="${esc(pre.busca ? String(pre.busca).split('-')[0] : '')}"></label>
    <div class="rc-res" id="rc-r"><div class="muted" style="cursor:default">Digite para procurar entre os títulos cedidos.</div></div>
    <div id="rc-t"></div>
    <div style="margin-top:6px"><div class="small" style="font-weight:600">Motivo da recompra</div>${botoesMotivo(M, mot.id)}<p class="rc-hint" id="rc-mh"></p></div>
    <div class="grid-form" style="margin-top:8px">
      <label class="xs">Data da recompra<input type="date" id="rc-d" value="${pre.data || today()}" ${pre.saida ? 'disabled' : ''}></label>
      <label class="xs">Valor da recompra (R$)<input id="rc-v" inputmode="decimal" value="${pre.valor != null ? (+pre.valor).toFixed(2).replace('.', ',') : ''}" ${pre.saida ? 'disabled' : ''}></label>
      <label class="c4">Saiu da conta<select id="rc-c" ${pre.saida ? 'disabled' : ''}>${options(contas, { selected: null, empty: '— a conta do fundo —' })}</select></label>
      <label class="xs" id="rc-vtl">O título volta com vencimento<input type="date" id="rc-vt"></label>
      <label class="xs" id="rc-vrl">Volta para a carteira (R$)<input id="rc-vr" inputmode="decimal"></label></div>
    <div id="rc-extra"></div>
    <div class="rc-calc" id="rc-calc"></div>
    <label style="margin-top:8px"><span id="rc-ol">Observação</span><input id="rc-o" maxlength="300"></label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rc-ok" disabled>${pre.saida ? 'Vincular' : 'Registrar a recompra'}</button>` });
  let tit = null, recebido = null, nota = null, subst = null, busc = 0;
  const volta = () => {
    if (!tit) return 0;
    if (mot.titulo_acao === 'reabrir') return mot.permite_parcial ? parseNum($('#rc-vr', m.el).value || '0') : +tit.valor;
    if (mot.titulo_acao === 'baixar' && mot.permite_parcial) return parseNum($('#rc-vr', m.el).value || '0');
    return 0;
  };
  const calc = () => {
    const v = pre.saida ? +pre.saida.valor : parseNum($('#rc-v', m.el).value || '0');
    if (!tit) { $('#rc-calc', m.el).innerHTML = ''; return; }
    const enc = Math.max(0, Math.round((v - tit.valor) * 100) / 100), vt = volta();
    const txtVolta = mot.titulo_acao === 'recebido' ? (recebido ? 'já recebido (vinculado)' : 'escolha o recebimento')
      : mot.titulo_acao === 'substituir' ? (subst ? `trocado por ${esc(subst.documento)}` : 'escolha o título novo')
      : vt > 0 ? `${money(vt)}${vt < tit.valor ? ` <span class="small muted">(de ${money(tit.valor)})</span>` : ''}` : 'não volta';
    $('#rc-calc', m.el).innerHTML = `<div><span>Recompra (2.07.11 · na DRE: ${esc(SECOES[mot.dre_secao].toLowerCase())})</span>${money(Math.min(v, tit.valor))}</div><div><span>Encargos do fundo</span>${money(enc)}</div><div><span>Volta para a carteira (em aberto)</span>${txtVolta}</div>`;
    $('#rc-ok', m.el).disabled = !(v > 0);
  };
  const mostrarMotivo = () => {
    $$('#rc-mo [data-mo]', m.el).forEach(b => b.classList.toggle('on', b.dataset.mo === mot.id));
    $('#rc-mh', m.el).textContent = mot.descricao || ACOES[mot.titulo_acao] + '.';
    const reabre = mot.titulo_acao === 'reabrir' || (mot.titulo_acao === 'baixar' && mot.permite_parcial);
    $('#rc-vtl', m.el).hidden = !reabre; $('#rc-vrl', m.el).hidden = !(reabre && mot.permite_parcial);
    $('#rc-vrl', m.el).firstChild.textContent = mot.titulo_acao === 'baixar' ? 'Saldo não devolvido que volta (R$)' : 'Volta para a carteira (R$)';
    if (tit && mot.permite_parcial && !$('#rc-vr', m.el).dataset.mexeu) $('#rc-vr', m.el).value = mot.titulo_acao === 'baixar' ? '0,00' : (+tit.valor).toFixed(2).replace('.', ',');
    $('#rc-ol', m.el).textContent = mot.exige_obs ? 'Observação (obrigatória para este motivo)' : 'Observação';
    recebido = mot.titulo_acao === 'recebido' ? recebido : null; subst = mot.titulo_acao === 'substituir' || mot.exige_substituto ? subst : null;
    extras(); calc();
  };
  // campos que o motivo pede: nota de devolução, RNC, título substituto, recebimento
  async function extras() {
    const box = $('#rc-extra', m.el), partes = [];
    const querNota = mot.exige_nota || mot.titulo_acao === 'baixar', querSub = mot.titulo_acao === 'substituir' || mot.exige_substituto, querRec = mot.titulo_acao === 'recebido';
    if (querNota) partes.push(`<div class="grid-form" style="margin-top:8px"><label class="c6">Nota de devolução${mot.exige_nota ? '' : ' (opcional)'}<select id="rc-nf"><option value="">${tit ? 'carregando…' : 'escolha o título primeiro'}</option></select></label>
      <label class="c6">Reclamação na Qualidade (RNC, opcional)<select id="rc-rnc"><option value="">—</option></select></label></div>`);
    if (querSub) partes.push(`<label style="margin-top:8px">Título cedido no lugar deste (o novo)<input id="rc-sb" placeholder="procure o título novo pelo número, cliente ou valor"></label><div class="rc-res" id="rc-sr"></div>`);
    if (querRec) partes.push('<div class="small" style="margin-top:8px;font-weight:600">Recebimento do cliente</div><div id="rc-pgl"></div>');
    box.innerHTML = partes.join('');
    if (querNota && tit) {
      const [N, R] = await Promise.all([q(sb.rpc('fidc_recompra_notas', { p_empresa: e, p_favorecido: tit.favorecido_id || null, p_busca: '' })).catch(() => []),
        q(sb.from('qual_rnc').select('id,numero,descricao,favorecido_id,situacao').eq('empresa_id', e).neq('situacao', 'cancelada').order('numero', { ascending: false }).limit(50)).catch(() => [])]);
      const nf = $('#rc-nf', m.el), rn = $('#rc-rnc', m.el); if (!nf) return;
      nf.innerHTML = `<option value="">${N.length ? '— escolha —' : 'nenhuma nota de devolução importada'}</option>` + N.map(n => `<option value="${n.id}" ${n.id === nota ? 'selected' : ''}>${n.do_cliente ? '★ ' : ''}NF-e ${n.numero} · ${dateBR(n.emissao)} · ${esc(n.parte || '')} · ${money(n.valor)}</option>`).join('');
      nf.onchange = () => { nota = nf.value || null; const n = N.find(x => x.id === nota); if (n && mot.titulo_acao === 'baixar' && mot.permite_parcial && !$('#rc-vr', m.el).dataset.mexeu) { $('#rc-vr', m.el).value = Math.max(0, Math.round((tit.valor - n.valor) * 100) / 100).toFixed(2).replace('.', ','); calc(); } };
      const RR = R.sort((a, b) => (b.favorecido_id === tit.favorecido_id) - (a.favorecido_id === tit.favorecido_id));
      rn.innerHTML = '<option value="">—</option>' + RR.map(r => `<option value="${r.id}">${r.favorecido_id === tit.favorecido_id ? '★ ' : ''}RNC ${r.numero} · ${esc(String(r.descricao || '').slice(0, 60))}</option>`).join('');
    }
    if (querSub) {
      let n2 = 0; const sb2 = $('#rc-sb', m.el);
      const busca2 = async () => { const k = ++n2; const R = await q(sb.rpc('fidc_cedidos_busca', { p_empresa: e, p_busca: sb2.value.trim() || (tit?.cliente || '') })).catch(() => []); if (k !== n2) return;
        const R2 = R.filter(t => t.id !== tit?.id);
        $('#rc-sr', m.el).innerHTML = R2.map(t => `<div data-s="${t.id}" class="${subst?.id === t.id ? 'on' : ''}"><span><b>${esc(t.documento)}</b> · ${esc(t.cliente || '')}<span class="small muted"> · ${esc(t.fundo)} · ${dateBR(t.data)}</span></span><span>${money(t.valor)}</span></div>`).join('') || '<div class="muted" style="cursor:default">Nenhum outro título cedido encontrado.</div>';
        $$('#rc-sr [data-s]', m.el).forEach(d => d.onclick = () => { subst = R2.find(t => t.id === d.dataset.s); $$('#rc-sr [data-s]', m.el).forEach(x => x.classList.toggle('on', x === d)); calc(); }); };
      sb2.oninput = () => { clearTimeout(m._t2); m._t2 = setTimeout(busca2, 250); }; busca2();
    }
    if (querRec) carregarRecebidos();
  }
  const escolher = (t) => {
    tit = t; $$('#rc-r [data-i]', m.el).forEach(d => d.classList.toggle('on', d.dataset.i === t.id));
    $('#rc-t', m.el).innerHTML = `<div class="rc-titulo"><b>${esc(t.documento)}</b> · ${esc(t.cliente || '')} · ${money(t.valor)}<div class="small">Cedido em ${dateBR(t.data)} ao fundo ${esc(t.fundo)} (conta ${esc(t.conta)})${t.vencimento ? ` · vencimento original ${dateBR(t.vencimento)}` : ''}</div></div>`;
    const vt = $('#rc-vt', m.el); if (!vt.value) vt.value = cfg?.prazo_dias ? new Date(Date.now() + cfg.prazo_dias * 864e5).toISOString().slice(0, 10) : (t.vencimento && t.vencimento >= today() ? t.vencimento : today());
    if (!pre.saida && !$('#rc-c', m.el).value) { const c = state.cad.contas.find(c => c.nome === t.conta); if (c) $('#rc-c', m.el).value = c.id; }
    delete $('#rc-vr', m.el).dataset.mexeu; mostrarMotivo();
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
    const box = $('#rc-pgl', m.el); if (!box) return;
    if (!tit) { box.innerHTML = '<div class="muted small">Escolha o título primeiro.</div>'; return; }
    const t0 = state.cad.planoById; const doc = String(tit.documento || '').split(' ')[0];
    const R = await q(sb.from('lancamentos').select('id,data,descricao,valor,conta_id,plano_id').eq('empresa_id', e).eq('status', 'Pago').neq('id', tit.id).gte('data', tit.data)
      .or(`descricao.ilike.%${doc.replace(/[%,()]/g, '')}%,valor.eq.${tit.valor}`).order('data', { ascending: false }).limit(20)).catch(() => []);
    const E = R.filter(l => t0[l.plano_id]?.tipo === 'E' && l.conta_id !== state.cad.contas.find(c => c.nome === tit.conta)?.id);
    box.innerHTML = `<div class="rc-res">${E.map(l => `<div data-l="${l.id}" class="${recebido === l.id ? 'on' : ''}"><span>${dateBR(l.data)} · ${esc(l.descricao || '')}<span class="small muted"> · ${esc(state.cad.contaById[l.conta_id]?.nome || '')}</span></span><span>${money(l.valor)}</span></div>`).join('') || '<div class="muted" style="cursor:default">Nenhum recebimento parecido. Lance o recebimento primeiro, ou escolha outro motivo (inadimplência: o título volta em aberto).</div>'}</div>`;
    $$('#rc-pgl [data-l]', m.el).forEach(d => d.onclick = () => { recebido = d.dataset.l; $$('#rc-pgl [data-l]', m.el).forEach(x => x.classList.toggle('on', x === d)); calc(); });
  }
  $('#rc-mo', m.el).onclick = (ev) => { const id = ev.target.closest('[data-mo]')?.dataset.mo; if (!id) return; mot = M.find(x => x.id === id); delete $('#rc-vr', m.el).dataset.mexeu; mostrarMotivo(); };
  $('#rc-b', m.el).oninput = () => { clearTimeout(m._t); m._t = setTimeout(buscar, 250); };
  $('#rc-v', m.el).oninput = calc; $('#rc-vr', m.el).oninput = (ev) => { ev.target.dataset.mexeu = '1'; calc(); };
  mostrarMotivo(); buscar();
  $('#rc-ok', m.el).onclick = async (ev) => {
    if (!tit) return toast('Escolha o título negociado', true);
    if (mot.titulo_acao === 'recebido' && !recebido) return toast('Escolha o recebimento do cliente', true);
    if ((mot.titulo_acao === 'substituir' || mot.exige_substituto) && !subst) return toast('Escolha o título cedido no lugar deste', true);
    nota = $('#rc-nf', m.el)?.value || null;
    if (mot.exige_nota && !nota) return toast('Escolha a nota de devolução', true);
    if (mot.exige_obs && !$('#rc-o', m.el).value.trim()) return toast('Este motivo pede uma observação', true);
    ev.target.disabled = true;
    try {
      const vr = $('#rc-vrl', m.el).hidden ? null : parseNum($('#rc-vr', m.el).value || '0');
      await q(sb.rpc('fidc_recompra_registrar', { p_lancamento: tit.id, p_data: pre.saida ? pre.saida.data : $('#rc-d', m.el).value, p_valor_recompra: pre.saida ? +pre.saida.valor : parseNum($('#rc-v', m.el).value),
        p_conta: pre.saida ? null : ($('#rc-c', m.el).value || null), p_vencimento: $('#rc-vt', m.el).value || null, p_obs: $('#rc-o', m.el).value.trim() || null,
        p_lanc_recompra: pre.saida?.id || null, p_lanc_recebido: recebido, p_liquidacao: pre.liquidacao || null,
        p_motivo: mot.id, p_valor_reaberto: vr, p_nota: nota, p_rnc: $('#rc-rnc', m.el)?.value || null, p_titulo_novo: subst?.id || null }));
      m.close(); toast(`Recompra registrada (${mot.nome.toLowerCase()})${volta() > 0 ? ': o título voltou para a carteira, em aberto' : ''}`); depois();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// trocar o motivo de uma recompra já registrada (só entre motivos que tratam o título do mesmo jeito)
function trocarMotivo(e, x, M, depois) {
  let mot = M.find(m => m.id === x.motivo_id) || M.find(m => m.ativo);
  const m = modal({ title: `Motivo da recompra ${x.numero}`, body: `<p class="small" style="margin-top:0">${esc(x.documento || '')} · ${esc(x.cliente || '')} · ${money(x.valor_titulo)}. Os lançamentos não mudam: muda a linha na DRE e a contrapartida contábil.
      Para um motivo que trata o título de outro jeito (ex.: devolução ↔ inadimplência), cancele e registre de novo.</p>
    ${botoesMotivo(M, mot?.id)}<p class="rc-hint" id="tm-h"></p><label style="margin-top:8px">Observação<input id="tm-o" maxlength="300" value="${esc(x.observacao || '')}"></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="tm-ok">Salvar</button>' });
  const dica = () => { $$('#rc-mo [data-mo]', m.el).forEach(b => b.classList.toggle('on', b.dataset.mo === mot?.id)); $('#tm-h', m.el).textContent = mot ? (mot.descricao || ACOES[mot.titulo_acao] + '.') : ''; };
  $('#rc-mo', m.el).onclick = (ev) => { const id = ev.target.closest('[data-mo]')?.dataset.mo; if (id) { mot = M.find(z => z.id === id); dica(); } };
  dica();
  $('#tm-ok', m.el).onclick = async (ev) => { ev.target.disabled = true;
    try { await q(sb.rpc('fidc_recompra_motivo_trocar', { p_id: x.id, p_motivo: mot.id, p_obs: $('#tm-o', m.el).value.trim() || null })); m.close(); toast('Motivo atualizado'); depois(); }
    catch (err) { fail(err); ev.target.disabled = false; } };
}

function cancelar(id, depois) {
  const m = modal({ title: 'Cancelar a recompra', narrow: true, body: '<p class="small" style="margin-top:0">Os lançamentos que a recompra criou (saída, encargos e o título reaberto) são apagados. Recompra vinculada só perde o vínculo.</p><label>Motivo do cancelamento<input id="rc-m" maxlength="300"></label>',
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
      <label class="c6">Vencimento sugerido do título reaberto (dias)<input id="rp-d" inputmode="numeric" value="${cfg?.prazo_dias ?? 0}"></label>
      <label class="c6">Alerta de taxa de recompra por cliente (%)<input id="rp-l" inputmode="decimal" value="${String(cfg?.limite_taxa_cliente ?? 10).replace('.', ',')}"></label></div>
    <p class="small muted">0 dia = usa o vencimento original do título (ou hoje, se já passou). Taxa = valor recomprado ÷ valor cedido do cliente no ano; acima do limite o cliente aparece na Central de Decisões (0 = sem alerta). Os motivos ficam no botão Motivos.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rp-ok">Salvar</button>' });
  $('#rp-ok', m.el).onclick = async () => {
    try { await q(sb.from('fidc_recompra_config').upsert({ empresa_id: e, plano_recompra_id: $('#rp-r', m.el).value || null, plano_encargos_id: $('#rp-e', m.el).value || null,
        prazo_dias: Math.max(0, parseInt($('#rp-d', m.el).value) || 0), limite_taxa_cliente: Math.max(0, parseNum($('#rp-l', m.el).value || '0')), atualizado_em: new Date().toISOString() }));
      m.close(); toast('Parâmetros salvos'); depois(); } catch (err) { fail(err); }
  };
}

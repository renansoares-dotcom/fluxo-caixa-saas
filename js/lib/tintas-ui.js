// Casa de Tintas (SQL 088) — dados, nova ordem, ficha de pesagem (passo a passo, balança, correção de proporção, ajustes,
// medições com ΔE), aprovação, etiqueta do lote, entrega/retorno e a ordem impressa.
import { sb, state, q, fetchAll, loadCadastros } from './data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, today, dateBR, money, options, parseNum } from './ui.js';
import { abrirRelatorio } from './relatorio.js';
import { carregarProdutos } from './produtos.js';
import { temBalanca, lerBalanca } from './balanca.js';
import * as T from './tintas.js';
import { conversaNoModal } from './mini-chat.js';

export const podeGerir = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
export const podeTintas = () => ['admin', 'financeiro', 'diretor', 'producao'].includes(state.papel);
export const podeAprovar = (D) => state.papel === 'admin' || (D?.P?.papeis_aprovacao || ['admin', 'diretor', 'financeiro']).includes(state.papel);
export const nf = (v, c = 3) => v == null || v === '' ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
const hora = (t) => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
export const selo = (txt, cls = '') => `<span class="tn-sel ${cls}">${esc(txt)}</span>`;
export const clsOrdem = (s) => ({ aberta: 'warn', em_pesagem: 'info', em_ajuste: 'warn', aprovada: 'pos', entregue: 'pos', encerrada: 'muted', cancelada: 'muted' }[s] || '');
export const clsVersao = (s) => ({ rascunho: 'muted', em_teste: 'warn', aprovada: 'pos', bloqueada: 'neg', obsoleta: 'muted' }[s] || '');
export const amostra = (hex) => `<span class="tn-cor" style="background:${esc(hex || '#ccc')}"></span>`;
export const CSS = `<style>
  .tn-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--primary-soft);white-space:nowrap}
  .tn-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.tn-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .tn-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.tn-sel.info{background:color-mix(in srgb,var(--brand-cyan) 14%,transparent);color:var(--brand-cyan)}.tn-sel.muted{color:var(--muted)}
  .tn-cor{display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid var(--border);vertical-align:-3px;margin-right:6px}
  .tn-kpis6{grid-template-columns:repeat(6,minmax(0,1fr))!important}@media(max-width:1100px){.tn-kpis6{grid-template-columns:repeat(3,minmax(0,1fr))!important}}@media(max-width:600px){.tn-kpis6{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
  .mm-topo .tn-acoes{display:flex;gap:8px;align-items:end;flex-wrap:nowrap;white-space:nowrap}
  .card label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input{width:auto;min-height:0}
  .tn-pes tr.prox{background:color-mix(in srgb,var(--brand-cyan) 8%,transparent)}.tn-pes td{vertical-align:middle}
  .tn-pes .tn-in{display:flex;gap:6px;align-items:center}.tn-pes .tn-in input{width:110px;font-size:16px;font-weight:600}
  .tn-barra{height:6px;border-radius:3px;background:var(--bg);overflow:hidden;margin-top:4px}.tn-barra i{display:block;height:100%;background:var(--primary)}
  .tn-barra i.acima{background:var(--neg)}.tn-barra i.ok{background:var(--pos)}
  @media(max-width:700px){.tn-pes thead{display:none}.tn-pes,.tn-pes tbody,.tn-pes tr,.tn-pes td{display:block;width:100%;box-sizing:border-box}.tn-pes tr{border-bottom:1px solid var(--border);padding:8px 0}.tn-pes td{border:0!important;padding:3px 0!important}.tn-pes td.num{text-align:left!important}.tn-pes td[data-l]::before{content:attr(data-l) ': ';color:var(--muted);font-size:12px}.tn-pes .tn-barra{max-width:220px}}
</style>`;

/** tudo o que as telas da casa de tintas usam */
export async function carregarTintas({ meses = 6 } = {}) {
  const e = state.empresa.id; await loadCadastros();
  const desde = new Date(); desde.setMonth(desde.getMonth() - meses);
  const seg = (p, v = []) => p.catch(() => v);
  const [Pm, Si, Co, Re, Ve, It, O1, O2, Pr, Lc, Op] = await Promise.all([
    q(sb.from('tin_parametros').select('*').eq('empresa_id', e)),
    q(sb.from('tin_sistemas').select('*').eq('empresa_id', e).order('nome')),
    q(sb.from('tin_cores').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('tin_receitas').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('tin_versoes').select('*').eq('empresa_id', e).order('numero')),
    fetchAll(() => sb.from('tin_itens').select('*').eq('empresa_id', e).order('seq')),
    fetchAll(() => sb.from('tin_ordens').select('*').eq('empresa_id', e).gte('criado_em', desde.toISOString()).order('numero', { ascending: false })),
    q(sb.from('tin_ordens').select('*').eq('empresa_id', e).in('situacao', ['aberta', 'em_pesagem', 'em_ajuste', 'aprovada', 'entregue']).order('numero', { ascending: false })),
    seg(carregarProdutos()), seg(q(sb.from('est_locais').select('id,codigo,nome,finalidade,ativo').eq('empresa_id', e).order('ordem'))),
    seg(q(sb.from('prod_ordens').select('id,numero,numero_iniflex,descricao,cliente,status').eq('empresa_id', e).in('status', ['planejada', 'liberada', 'em_producao', 'concluida']).order('numero', { ascending: false }).limit(300))),
  ]);
  const O = [...new Map([...O1, ...O2].map(x => [x.id, x])).values()].sort((a, b) => b.numero - a.numero);
  const byId = (L) => Object.fromEntries(L.map(x => [x.id, x]));
  const P = Pm[0] || { tolerancia_pct: 2, validade_dias: 30, criar_produto: true, papeis_aprovacao: ['admin', 'diretor', 'financeiro'], balanca_baud: 9600 };
  const D = { P, Si, Co, Re, Ve, It, O, Pr, Lc, Op, semConfig: !Pm[0], coById: byId(Co), reById: byId(Re), veById: byId(Ve), prById: byId(Pr), lcById: byId(Lc), opById: byId(Op), siById: byId(Si) };
  // custos dos insumos (custo médio do estoque ou último preço de compra)
  const ids = [...new Set(It.map(i => i.produto_id))];
  D.custos = {};
  if (ids.length) {
    const [Cu, Pf] = await Promise.all([seg(q(sb.from('est_custos').select('produto_id,custo_medio').in('produto_id', ids))),
      seg(q(sb.from('produto_fornecedores').select('produto_id,ultimo_preco,ultima_compra').in('produto_id', ids).not('ultimo_preco', 'is', null)))]);
    Pf.sort((a, b) => String(b.ultima_compra || '').localeCompare(String(a.ultima_compra || ''))).forEach(x => { if (D.custos[x.produto_id] == null) D.custos[x.produto_id] = +x.ultimo_preco; });
    Cu.filter(x => +x.custo_medio > 0).forEach(x => { D.custos[x.produto_id] = +x.custo_medio; });
  }
  // sobras de tinta pronta (lotes na casa de tintas)
  D.sobras = [];
  if (P.local_tinta_id) {
    const S = await seg(q(sb.from('est_saldos').select('produto_id,lote_id,quantidade,valor').eq('local_id', P.local_tinta_id).gt('quantidade', 0)));
    const lotes = S.length ? await seg(q(sb.from('est_lotes').select('id,codigo,validade,fabricacao').in('id', S.map(x => x.lote_id).filter(Boolean)))) : [];
    const lb = byId(lotes);
    D.sobras = S.map(x => ({ ...x, lote: lb[x.lote_id]?.codigo, validade: lb[x.lote_id]?.validade, cor: Co.find(c => c.produto_id === x.produto_id) }));
  }
  D.aprovada = (receitaId) => Ve.find(v => v.receita_id === receitaId && v.situacao === 'aprovada');
  D.itensDe = (versaoId) => It.filter(i => i.versao_id === versaoId).sort((a, b) => a.seq - b.seq);
  return D;
}
export const nomeProd = (D, id) => { const p = D.prById[id]; return p ? `${p.codigo} · ${p.descricao}` : '—'; };
export const opTxt = (D, id) => { const o = D.opById[id]; return o ? `OP ${o.numero}${o.cliente ? ' · ' + o.cliente : ''}` : ''; };
export const corTxt = (D, id) => { const c = D.coById[id]; return c ? `${c.codigo} · ${c.nome}` : '—'; };
export const versaoTxt = (D, id) => { const v = D.veById[id], r = v && D.reById[v.receita_id]; return r ? `${r.codigo} v${v.numero}` : '—'; };

/** nova ordem de preparação: receita aprovada, quantidade, OP; mostra a sobra da cor para aproveitar */
export function novaOrdem(D, { pre = {}, onSalvo } = {}) {
  const recs = D.Re.filter(r => r.ativo && D.aprovada(r.id));
  const md = modal({ title: 'Nova ordem de preparação', body: `<form id="no"><div class="grid-form">
    <label class="span2">Receita aprovada *<select name="rec" required>${options(recs.map(r => ({ id: r.id, nome: `${r.codigo} · ${r.nome} (v${D.aprovada(r.id).numero})` })), { selected: pre.receita_id, empty: '— escolha —' })}</select></label>
    <label>Quantidade (kg) *<input name="qtd" inputmode="decimal" required value="${pre.quantidade ? nf(pre.quantidade) : ''}"></label>
    <label class="span2">Ordem de produção (impressão)<select name="op">${options(D.Op.map(o => ({ id: o.id, nome: `OP ${o.numero} · ${o.descricao || ''}${o.cliente ? ' · ' + o.cliente : ''}` })), { selected: pre.ordem_id, empty: '—' })}</select></label>
    <label>Responsável<input name="resp" value="${esc(state.user?.user_metadata?.nome || '')}"></label>
    <label class="full">Observação<input name="obs"></label></div>
    <div id="no-info" class="small" style="margin-top:10px"></div></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="no-ok">Abrir ordem</button>` });
  const f = $('#no', md.el), info = $('#no-info', md.el);
  const mostrar = () => {
    const r = D.reById[f.rec.value]; if (!r) { info.innerHTML = ''; return; }
    const v = D.aprovada(r.id), its = D.itensDe(v.id), qtd = parseNum(f.qtd.value) || 0, ct = T.custoTeorico(its, D.custos), c = D.coById[r.cor_id];
    const sob = D.sobras.filter(s => c?.produto_id && s.produto_id === c.produto_id);
    info.innerHTML = `${amostra(c?.hex)}<b>${esc(c?.nome || '')}</b> ${esc(c?.referencia || '')} · base ${nf(v.base_kg)} kg · custo teórico ${ct?.custoKg != null ? money(ct.custoKg) + '/kg' : '–'}${qtd && ct?.custoKg ? ` · ${money(ct.custoKg * qtd)} nesta ordem` : ''}
      ${qtd ? `<div class="muted" style="margin-top:4px">${its.map(i => `${esc(D.prById[i.produto_id]?.codigo || '')} ${nf(T.prevista(i, v, qtd))} kg`).join(' · ')}</div>` : ''}
      ${sob.length ? `<div style="margin-top:8px">♻ Há <b>${nf(sob.reduce((s, x) => s + +x.quantidade, 0), 1)} kg</b> de sobra desta cor (${sob.map(x => `${esc(x.lote || '')}${x.validade ? ' até ' + dateBR(x.validade) : ''}`).join(', ')}). Use na pesagem, como ajuste "Aproveitar sobra", e reduza a quantidade nova.</div>` : ''}`;
  };
  f.rec.onchange = mostrar; f.qtd.oninput = mostrar; mostrar();
  $('#no-ok', md.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const r = D.reById[f.rec.value], v = D.aprovada(r.id), qtd = parseNum(f.qtd.value); if (!(qtd > 0)) return toast('Informe a quantidade', true);
    try { const [o] = await q(sb.from('tin_ordens').insert({ empresa_id: state.empresa.id, versao_id: v.id, cor_id: r.cor_id, quantidade: qtd, ordem_id: f.op.value || null,
      responsavel: f.resp.value.trim() || null, observacao: f.obs.value.trim() || null }).select()); md.close(); toast(`Ordem ${o.numero} aberta`); onSalvo?.(o); } catch (e) { fail(e); }
  };
}

/** ficha da ordem: pesagem passo a passo, ajustes, medições, aprovação, etiqueta, entrega e retorno */
export async function fichaOrdem(D, o, { onMudou } = {}) {
  const v = D.veById[o.versao_id], r = D.reById[v?.receita_id], c = D.coById[o.cor_id], its = D.itensDe(o.versao_id);
  const [Pe, Me] = await Promise.all([q(sb.from('tin_pesagens').select('*').eq('ordem_id', o.id).order('criado_em')), q(sb.from('tin_medicoes').select('*').eq('ordem_id', o.id).order('criado_em'))]);
  const and = T.andamento(its, Pe, v, o.quantidade, +D.P.tolerancia_pct || 2), cor = T.correcaoProporcao(and, o.quantidade);
  const aberta = T.ABERTAS.includes(o.situacao), pode = podeTintas(), ult = Me[Me.length - 1];
  const sobrasCor = D.sobras.filter(s => c?.produto_id && s.produto_id === c.produto_id);
  const ajProds = [...D.Pr.filter(p => p.ativo && ['tinta_solvente', 'aditivo'].includes(p.tipo)), ...(c?.produto_id && D.prById[c.produto_id] ? [D.prById[c.produto_id]] : [])];
  const md = modal({ title: `Tinta ${o.numero} — ${corTxt(D, o.cor_id)}`, wide: true, body: `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${amostra(c?.hex)}${selo(T.SIT_ORDEM[o.situacao], clsOrdem(o.situacao))}${selo(versaoTxt(D, o.versao_id))}${o.lote_codigo ? selo('Lote ' + o.lote_codigo, 'pos') : ''}${o.concessao ? selo('Concessão', 'warn') : ''}
      <span class="muted small">${esc([c?.referencia, r?.nome, opTxt(D, o.ordem_id), o.responsavel].filter(Boolean).join(' · '))}</span></div>
    <div class="kpis" style="margin-top:10px">
      <div class="kpi"><div class="k-label">Planejado</div><div class="k-value">${nf(o.quantidade)} kg</div><div class="k-sub">base da receita ${nf(v?.base_kg)} kg</div></div>
      <div class="kpi"><div class="k-label">Pesado</div><div class="k-value">${nf(and.total)} kg</div><div class="k-sub">${and.ajustes.length} ajuste(s)</div></div>
      <div class="kpi"><div class="k-label">Custo real</div><div class="k-value">${money(and.custo)}</div><div class="k-sub">${and.custoKg != null ? money(and.custoKg) + '/kg' : '–'} · teórico ${(() => { const ct = T.custoTeorico(its, D.custos); return ct?.custoKg != null ? money(ct.custoKg) : '–'; })()}</div></div>
      <div class="kpi"><div class="k-label">Padrão</div><div class="k-value" style="font-size:15px">${v?.viscosidade_alvo != null ? `${nf(v.viscosidade_alvo, 1)} ± ${nf(v.viscosidade_tol, 1)} s` : '–'}</div><div class="k-sub">${v?.delta_e_max != null ? `ΔE ≤ ${nf(v.delta_e_max, 2)}` : ''}${v?.densidade_alvo != null ? ` · dens. ${nf(v.densidade_alvo, 3)}` : ''}</div></div>
      <div class="kpi"><div class="k-label">Entregue / voltou</div><div class="k-value">${nf(o.entregue_kg)} / ${nf(o.retorno_kg)}</div><div class="k-sub">${o.validade ? 'validade ' + dateBR(o.validade) : ''}</div></div></div>
    <h4 style="margin:14px 0 4px">Pesagem</h4>
    <div class="table-wrap"><table class="tn-pes"><thead><tr><th>#</th><th>Insumo</th><th class="num">Previsto</th><th class="num">Pesado</th><th>Desvio</th>${aberta && pode ? '<th>Pesar (kg)</th>' : ''}</tr></thead><tbody>
      ${and.linhas.map(l => `<tr class="${and.proxima?.item.id === l.item.id && aberta ? 'prox' : ''}"><td>${l.item.seq}</td><td><b>${esc(nomeProd(D, l.item.produto_id))}</b><div class="small muted">${esc(T.FUNCOES[l.item.funcao])}${l.item.instrucao ? ' · ' + esc(l.item.instrucao) : ''}</div></td>
        <td class="num" data-l="Previsto"><b>${nf(l.prevista)}</b></td><td class="num" data-l="Pesado">${l.pesada ? nf(l.pesada) : '–'}<div class="tn-barra"><i class="${l.status === 'acima' ? 'acima' : l.status === 'ok' ? 'ok' : ''}" style="width:${Math.min(100, l.prevista ? l.pesada / l.prevista * 100 : 0).toFixed(0)}%"></i></div></td>
        <td>${l.status === 'falta' ? selo('Pesar', 'muted') : l.status === 'ok' ? selo(`${l.desvio > 0 ? '+' : ''}${nf(l.desvio, 2)}%`, 'pos') : l.status === 'acima' ? selo(`+${nf(l.desvio, 2)}% acima`, 'neg') : selo(`faltam ${nf(l.falta)} kg`, 'warn')}<div class="small muted">tolerância ±${nf(l.tol, 2)}%</div></td>
        ${aberta && pode ? `<td><div class="tn-in"><input data-peso="${l.item.id}" inputmode="decimal" placeholder="${l.status === 'falta' ? nf(l.prevista) : l.status === 'abaixo' ? nf(l.falta) : ''}">${temBalanca() ? `<button class="btn small" data-bal="${l.item.id}" type="button" title="Ler da balança">⚖</button>` : ''}<button class="btn small primary" data-pesar="${l.item.id}" type="button">Pesar</button></div></td>` : ''}</tr>`).join('')
        || '<tr><td colspan="6" class="empty">A receita não tem itens.</td></tr>'}</tbody></table></div>
    ${cor && aberta ? `<div class="card" style="margin:10px 0;border-left:4px solid var(--warn);padding:10px">⚠ <b>${esc(D.prById[cor.item.produto_id]?.codigo || '')}</b> passou do previsto. Para manter a fórmula, a ordem passa de ${nf(o.quantidade)} para <b>${nf(cor.nova)} kg</b> (+${nf(cor.acrescimo)} kg) e os outros itens são pesados pela nova quantidade.
      ${pode ? ` <button class="btn small" id="fo-corr" type="button">Corrigir proporção</button>` : ''}</div>` : ''}
    ${and.ajustes.length || (aberta && pode) ? `<h4 style="margin:12px 0 4px">Ajustes e aproveitamento de sobra</h4>` : ''}
    ${and.ajustes.map(p => `<div class="small">+ ${nf(p.pesada)} kg ${esc(nomeProd(D, p.produto_id))} — ${esc(p.justificativa || '')}</div>`).join('')}
    ${aberta && pode ? `<div class="grid-form" style="align-items:end;margin-top:6px"><label class="span2">Produto<select id="aj-p">${options(ajProds.map(p => ({ id: p.id, nome: `${p.codigo} · ${p.descricao}` })), { empty: '— escolha —', selected: sobrasCor.length ? c.produto_id : null })}</select></label>
      <label class="xs">kg<input id="aj-q" inputmode="decimal"></label><label>Motivo<input id="aj-m" placeholder="${sobrasCor.length ? 'Aproveitar a sobra do lote ' + esc(sobrasCor[0].lote || '') : 'Ex.: viscosidade alta, cor fraca'}"></label>
      <div style="display:flex;align-items:end"><button class="btn" id="aj-ok" type="button">Lançar ajuste</button></div></div>
      ${sobrasCor.length ? `<p class="small muted">♻ Sobra desta cor na casa de tintas: ${sobrasCor.map(s => `${nf(s.quantidade, 1)} kg do lote ${esc(s.lote || '')}${s.validade ? ` (até ${dateBR(s.validade)})` : ''}`).join(' · ')}.</p>` : ''}` : ''}
    <h4 style="margin:12px 0 4px">Medições</h4>
    <div class="table-wrap"><table><thead><tr><th>Quando</th><th class="num">Viscosidade</th><th class="num">Densidade</th><th class="num">ΔE</th><th>Resultado</th><th>Observação</th></tr></thead><tbody>
      ${Me.map(m => `<tr><td class="small">${hora(m.criado_em)}</td><td class="num">${nf(m.viscosidade, 1)}</td><td class="num">${nf(m.densidade, 3)}</td><td class="num">${nf(m.delta_e, 2)}</td><td>${selo(m.ok ? 'Dentro do padrão' : 'Fora — ajustar', m.ok ? 'pos' : 'neg')}</td><td class="small wrap">${esc(m.observacao || '')}</td></tr>`).join('')
        || '<tr><td colspan="6" class="empty">Sem medição.</td></tr>'}</tbody></table></div>
    ${aberta && pode ? `<div class="grid-form" style="align-items:end;margin-top:6px">
      <label class="xs">Viscosidade (s)<input id="me-v" inputmode="decimal"></label><label class="xs">Densidade<input id="me-d" inputmode="decimal"></label>
      <label class="xs">ΔE<input id="me-e" inputmode="decimal" placeholder="${c?.lab_l != null ? 'ou L a b' : ''}"></label>
      ${c?.lab_l != null ? `<label class="xs">L* a* b* medidos<input id="me-lab" placeholder="52,1 -2,3 -44,8"></label>` : ''}
      <label class="xs">Temperatura (°C)<input id="me-t" inputmode="decimal"></label><label>Observação<input id="me-o"></label>
      <div style="display:flex;align-items:end"><button class="btn" id="me-ok" type="button">Registrar medição</button></div></div>
      ${c?.lab_l != null ? `<p class="small muted">Padrão da cor: L* ${nf(c.lab_l, 2)} a* ${nf(c.lab_a, 2)} b* ${nf(c.lab_b, 2)} — informando o L* a* b* medido, o ΔE (CIEDE2000) é calculado.</p>` : ''}` : ''}
    <h4 style="margin:12px 0 4px">Histórico das pesagens</h4>
    <div class="table-wrap" style="max-height:220px"><table><tr><th>Quando</th><th>Produto</th><th class="num">kg</th><th class="num">Custo</th><th></th></tr>
      ${Pe.map(p => `<tr style="${p.situacao === 'estornada' ? 'opacity:.5;text-decoration:line-through' : ''}"><td class="small">${hora(p.criado_em)}${p.balanca ? ' ⚖' : ''}</td><td class="small">${esc(nomeProd(D, p.produto_id))}${p.ajuste ? ' (ajuste)' : ''}${p.fora_tolerancia ? ' ' + selo('fora', 'neg') : ''}${p.justificativa ? `<div class="muted">${esc(p.justificativa)}</div>` : ''}</td>
        <td class="num">${nf(p.pesada)}</td><td class="num">${money(p.custo)}</td><td>${aberta && pode && p.situacao === 'pesada' ? `<button class="btn small ghost" data-est="${p.id}">Estornar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma pesagem.</td></tr>'}</table></div>`,
    foot: `${aberta && pode && !Pe.some(p => p.situacao === 'pesada') ? '<button class="btn danger" id="fo-canc">Cancelar ordem</button>' : ''}<span class="spacer"></span><button class="btn" id="fo-imp">Imprimir ordem</button>
      ${o.lote_codigo ? '<button class="btn" id="fo-etq">Etiqueta do lote</button>' : ''}
      ${pode && ['aprovada', 'entregue'].includes(o.situacao) ? '<button class="btn" id="fo-ret">Retorno de sobra</button><button class="btn primary" id="fo-ent">Entregar à máquina</button>' : ''}
      ${pode && ['aprovada', 'entregue'].includes(o.situacao) ? '<button class="btn" id="fo-enc">Encerrar</button>' : ''}
      ${aberta && pode && Pe.length ? '<button class="btn primary" id="fo-apr">✔ Aprovar tinta</button>' : ''}` });
  conversaNoModal(md, 'tin_ordem', o.id);
  const el = md.el, re = () => { md.close(); fichaOrdemAtualizada(D, o.id, onMudou); };
  const b = (sel, fn) => { const x = $(sel, el); if (x) x.onclick = async () => { try { await fn(x); } catch (e) { fail(e); } }; };
  const pesar = async (itemId, qtd, balanca = false) => {
    const l = and.linhas.find(x => x.item.id === itemId);
    if (!(qtd > 0)) return toast('Informe o peso', true);
    let just = null;
    const desv = l.prevista ? ((l.pesada + qtd) - l.prevista) / l.prevista * 100 : 0;
    if (desv > l.tol) {
      just = prompt(`${nf(qtd)} kg deixa o item ${nf(desv, 2)}% acima do previsto (tolerância ±${nf(l.tol, 2)}%).\nJustifique para pesar assim — ou cancele e use "Corrigir proporção" depois de pesar.`);
      if (!just?.trim()) return;
    }
    const res = await q(sb.rpc('tin_pesar', { p_ordem: o.id, p_item: itemId, p_produto: null, p_qtd: qtd, p_lote: null, p_justificativa: just, p_balanca: balanca }));
    toast(`Pesado ${nf(qtd)} kg${res?.estoque ? ' — saiu do estoque' : ''}`); re();
  };
  $$('[data-pesar]', el).forEach(x => x.onclick = async () => { try { await pesar(x.dataset.pesar, parseNum($(`[data-peso="${x.dataset.pesar}"]`, el).value)); } catch (e) { fail(e); } });
  $$('[data-peso]', el).forEach(x => x.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $(`[data-pesar="${x.dataset.peso}"]`, el).click(); } });
  $$('[data-bal]', el).forEach(x => x.onclick = async () => {
    try { x.disabled = true; const p = await lerBalanca({ baud: D.P.balanca_baud }); $(`[data-peso="${x.dataset.bal}"]`, el).value = nf(p, 4); x.dataset.lido = '1'; toast(`Balança: ${nf(p, 4)} kg`); }
    catch (e) { fail(e); } finally { x.disabled = false; }
  });
  setTimeout(() => $(`[data-peso="${and.proxima?.item.id}"]`, el)?.focus(), 50);
  b('#fo-corr', async () => { if (!await confirmDialog(`Corrigir a ordem para ${nf(cor.nova)} kg?`)) return; await q(sb.rpc('tin_reescalar', { p_ordem: o.id, p_quantidade: cor.nova })); toast(`Ordem corrigida para ${nf(cor.nova)} kg`); o.quantidade = cor.nova; re(); });
  b('#aj-ok', async () => {
    const p = $('#aj-p', el).value, qt = parseNum($('#aj-q', el).value), m = $('#aj-m', el).value.trim() || $('#aj-m', el).placeholder.startsWith('Aproveitar') && p === c?.produto_id && $('#aj-m', el).placeholder;
    if (!p || !(qt > 0)) return toast('Escolha o produto e o peso', true); if (!m) return toast('Diga o motivo do ajuste', true);
    await q(sb.rpc('tin_pesar', { p_ordem: o.id, p_item: null, p_produto: p, p_qtd: qt, p_lote: null, p_justificativa: m, p_balanca: false })); toast('Ajuste lançado'); re();
  });
  b('#me-ok', async () => {
    let de = $('#me-e', el).value.trim() ? parseNum($('#me-e', el).value) : null;
    const lab = $('#me-lab', el)?.value.trim();
    if (lab && c?.lab_l != null) { const [l, a, bb] = lab.split(/[\s;]+/).map(parseNum); if ([l, a, bb].some(x => x == null || isNaN(x))) return toast('Informe L*, a* e b* separados por espaço', true); de = T.deltaE00({ l: +c.lab_l, a: +c.lab_a, b: +c.lab_b }, { l, a, b: bb }); }
    const reg = { empresa_id: state.empresa.id, ordem_id: o.id, viscosidade: $('#me-v', el).value.trim() ? parseNum($('#me-v', el).value) : null, densidade: $('#me-d', el).value.trim() ? parseNum($('#me-d', el).value) : null,
      delta_e: de, temperatura: $('#me-t', el).value.trim() ? parseNum($('#me-t', el).value) : null, observacao: $('#me-o', el).value.trim() || (lab ? `L*a*b* ${lab}` : null) };
    if (reg.viscosidade == null && reg.densidade == null && reg.delta_e == null) return toast('Informe ao menos uma medição', true);
    const ok = T.medicaoOk(reg, v).ok;
    await q(sb.from('tin_medicoes').insert(reg)); toast(ok ? 'Medição dentro do padrão' : 'Medição fora: faça o ajuste e meça de novo', !ok); re();
  });
  $$('[data-est]', el).forEach(x => x.onclick = async () => { if (!await confirmDialog('Estornar esta pesagem? O insumo volta ao estoque.')) return; try { await q(sb.rpc('tin_estornar_pesagem', { p_pesagem: x.dataset.est, p_motivo: null })); toast('Pesagem estornada'); re(); } catch (e) { fail(e); } });
  b('#fo-apr', async () => {
    const precisa = !ult?.ok || !and.completa;
    let conc = null;
    if (precisa) {
      if (!podeAprovar(D)) return toast(!and.completa ? 'Falta completar a pesagem' : 'A última medição está fora do padrão: ajuste e meça de novo', true);
      conc = prompt(`${!and.completa ? 'A pesagem não está completa' : 'A última medição está fora do padrão (ou não há medição)'}.\nPara aprovar mesmo assim (concessão), informe o motivo:`); if (!conc?.trim()) return;
    }
    const x = await q(sb.rpc('tin_aprovar_ordem', { p_ordem: o.id, p_concessao: conc })); toast(`Tinta aprovada — lote ${x.lote}${x.estoque ? ' no estoque da casa de tintas' : ''}`); re();
  });
  b('#fo-ent', async () => { const disp = +(o.quantidade_real || 0) - +o.entregue_kg + +o.retorno_kg; const v2 = parseNum(prompt(`Quantos kg vão para a máquina? (disponível ${nf(disp)} kg)`, nf(disp)) || ''); if (!(v2 > 0)) return;
    await q(sb.rpc('tin_movimentar', { p_ordem: o.id, p_tipo: 'entrega', p_qtd: v2, p_local: null })); toast(`${nf(v2)} kg entregues à máquina`); re(); });
  b('#fo-ret', async () => { const v2 = parseNum(prompt('Quantos kg de sobra voltaram da máquina? (pese o balde)') || ''); if (!(v2 > 0)) return;
    await q(sb.rpc('tin_movimentar', { p_ordem: o.id, p_tipo: 'retorno', p_qtd: v2, p_local: null })); toast(`${nf(v2)} kg de sobra de volta à casa de tintas`); re(); });
  b('#fo-enc', async () => { if (!await confirmDialog('Encerrar a ordem? A sobra que estiver na casa de tintas continua disponível para outras ordens.')) return; await q(sb.from('tin_ordens').update({ situacao: 'encerrada' }).eq('id', o.id)); toast('Ordem encerrada'); md.close(); onMudou?.(); });
  b('#fo-canc', async () => { if (!await confirmDialog('Cancelar a ordem?')) return; await q(sb.from('tin_ordens').update({ situacao: 'cancelada' }).eq('id', o.id)); toast('Ordem cancelada'); md.close(); onMudou?.(); });
  b('#fo-imp', async () => imprimirOrdem(D, o, and, Me));
  b('#fo-etq', async () => etiqueta(D, o, ult));
}
async function fichaOrdemAtualizada(D, id, onMudou) {
  const [o] = await q(sb.from('tin_ordens').select('*').eq('id', id));
  const i = D.O.findIndex(x => x.id === id); if (i >= 0) D.O[i] = o; else D.O.unshift(o);
  onMudou?.({ silencioso: true }); fichaOrdem(D, o, { onMudou });
}

const T2 = (cab, L, num = []) => `<table><thead><tr>${cab.map((h, i) => `<th${num.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${L.map(l => `<tr>${l.map((v, i) => `<td${num.includes(i) ? ' class="num"' : ''}>${v ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cab.length}">—</td></tr>`}</tbody></table>`;
/** ordem de preparação impressa (para a bancada) */
export function imprimirOrdem(D, o, and, Me = []) {
  const v = D.veById[o.versao_id], c = D.coById[o.cor_id];
  abrirRelatorio({ nome: `Tinta ${o.numero}`, titulo: `ORDEM DE PREPARAÇÃO DE TINTA Nº ${o.numero}`, subtitulo: `${esc(corTxt(D, o.cor_id))} — ${esc(versaoTxt(D, o.versao_id))}`,
    extraCss: '.num{text-align:right} .cx{display:inline-block;width:70px;border-bottom:1px solid #000} .ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px} .ass div{border-top:1px solid #000;padding-top:4px;text-align:center;font-size:10pt}',
    corpo: `<h2>1. Identificação</h2>${T2(['Campo', 'Valor'], [['Cor', `${esc(corTxt(D, o.cor_id))} · ${esc(c?.referencia || '')}`], ['Receita', esc(versaoTxt(D, o.versao_id))], ['Quantidade planejada', `${nf(o.quantidade)} kg`],
      ['Ordem de produção', esc(opTxt(D, o.ordem_id)) || '—'], ['Padrão', `${v?.viscosidade_alvo != null ? `viscosidade ${nf(v.viscosidade_alvo, 1)} ± ${nf(v.viscosidade_tol, 1)} s (${esc(v.viscosidade_metodo || '')})` : ''}${v?.delta_e_max != null ? ` · ΔE ≤ ${nf(v.delta_e_max, 2)}` : ''}`],
      ['Lote / validade', o.lote_codigo ? `${o.lote_codigo} · ${dateBR(o.validade)}` : 'a definir na aprovação']])}
      <h2>2. Pesagem (na ordem)</h2>${T2(['#', 'Insumo', 'Previsto (kg)', 'Tolerância', 'Pesado (kg)', 'Visto'], and.linhas.map(l => [l.item.seq, esc(nomeProd(D, l.item.produto_id)) + (l.item.instrucao ? `<br><small>${esc(l.item.instrucao)}</small>` : ''), nf(l.prevista), `±${nf(l.tol, 2)}%`, l.pesada ? nf(l.pesada) : '<span class="cx"></span>', '<span class="cx"></span>']), [2, 4])}
      <h2>3. Medições</h2>${T2(['Viscosidade', 'Densidade', 'ΔE', 'Resultado'], (Me.length ? Me.map(m => [nf(m.viscosidade, 1), nf(m.densidade, 3), nf(m.delta_e, 2), m.ok ? 'Dentro' : 'Fora']) : [['<span class="cx"></span>', '<span class="cx"></span>', '<span class="cx"></span>', '']]))}
      <div class="ass"><div>Tinteiro</div><div>Aprovação da cor</div></div>`, rodape: 'Base: casa de tintas na plataforma' });
}

let qrLib = null;
async function qr() { if (qrLib) return qrLib; await new Promise((ok, err) => { const s = document.createElement('script'); s.src = new URL('../../vendor/qrcode-generator-1.4.4.js', import.meta.url).href; s.onload = ok; s.onerror = err; document.head.appendChild(s); }); qrLib = window.qrcode; return qrLib; }
/** etiqueta do lote de tinta pronta (10 × 7 cm), com QR para abrir a ordem */
export async function etiqueta(D, o, med) {
  const lib = await qr(), c = D.coById[o.cor_id], url = `${location.origin}${location.pathname}#/tintas/ordens?abrir=${o.id}`;
  const g = lib(0, 'M'); g.addData(url); g.make();
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas do navegador para imprimir a etiqueta', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta ${esc(o.lote_codigo)}</title><style>@page{size:100mm 70mm;margin:3mm}body{font:11pt Arial,sans-serif;margin:0}
    .e{width:94mm;height:64mm;border:1px solid #000;padding:3mm;box-sizing:border-box;display:grid;grid-template-columns:1fr 30mm;gap:2mm}.c{display:inline-block;width:10mm;height:10mm;border:1px solid #000;vertical-align:middle;margin-right:2mm}
    h1{font-size:15pt;margin:0 0 1mm}.l{font-size:9pt;color:#333}.v{font-size:11pt;font-weight:bold}</style></head><body onload="setTimeout(()=>print(),300)"><div class="e"><div>
    <h1><span class="c" style="background:${esc(c?.hex || '#fff')}"></span>${esc(c?.codigo || '')}</h1><div class="v">${esc(c?.nome || '')}</div><div class="l">${esc(c?.referencia || '')}</div>
    <div class="l" style="margin-top:2mm">Lote</div><div class="v">${esc(o.lote_codigo)}</div>
    <div class="l">Peso / validade</div><div class="v">${nf(o.quantidade_real)} kg · ${dateBR(o.validade)}</div>
    <div class="l">Receita / OP</div><div class="v" style="font-size:9.5pt">${esc(versaoTxt(D, o.versao_id))}${o.ordem_id ? ' · ' + esc(opTxt(D, o.ordem_id)) : ''}</div>
    ${med ? `<div class="l">Viscosidade / ΔE</div><div class="v">${nf(med.viscosidade, 1)} s · ${nf(med.delta_e, 2)}</div>` : ''}</div>
    <div style="text-align:center">${g.createSvgTag({ cellSize: 3, margin: 0 })}<div class="l">Tinta ${o.numero}</div><div class="l">${hora(o.aprovada_em)}</div></div></div></body></html>`);
  w.document.close();
}

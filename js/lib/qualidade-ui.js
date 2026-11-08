// Qualidade (SQL 087) — dados e fichas usados pelo Painel, Inspeções, Não Conformidades e Planos.
import { sb, state, q, fetchAll, loadCadastros } from './data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, today, dateBR, money, options, parseNum } from './ui.js';
import { abrirRelatorio } from './relatorio.js';
import { carregarProdutos, datalistProdutos, acharProduto } from './produtos.js';
import * as Q from './qualidade.js';
import { conversaNoModal } from './mini-chat.js';

export const BUCKET = 'qualidade';
export const podeGerir = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
export const podeRegistrar = () => ['admin', 'financeiro', 'diretor', 'compras', 'producao'].includes(state.papel);
export const podeDecidir = (D) => state.papel === 'admin' || (D?.P?.papeis_decisao || ['admin', 'diretor', 'financeiro']).includes(state.papel);
export const nf = (v, c = 2) => v == null || v === '' ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
const hora = (t) => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
export const selo = (txt, cls = '') => `<span class="ql-sel ${cls}">${esc(txt)}</span>`;
export const clsSit = (s) => ({ pendente: 'warn', em_inspecao: 'info', aprovada: 'pos', aprovada_concessao: 'warn', reprovada: 'neg', cancelada: 'muted' }[s] || '');
export const clsRnc = (s) => ({ aberta: 'neg', em_analise: 'warn', acao: 'info', verificacao: 'info', encerrada: 'pos', cancelada: 'muted' }[s] || '');
export const clsGrav = (g) => ({ baixa: 'muted', media: '', alta: 'warn', critica: 'neg' }[g] || '');
export const CSS = `<style>
  .ql-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--primary-soft);white-space:nowrap}
  .ql-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.ql-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .ql-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.ql-sel.info{background:color-mix(in srgb,var(--brand-cyan) 14%,transparent);color:var(--brand-cyan)}.ql-sel.muted{color:var(--muted)}
  .ql-res td{vertical-align:top}.ql-res input{display:block;width:100%;box-sizing:border-box}.ql-res td:last-child{min-width:170px}
  @media(max-width:700px){.ql-res thead{display:none}.ql-res,.ql-res tbody,.ql-res tr,.ql-res td{display:block;width:100%;box-sizing:border-box}.ql-res tr{border-bottom:1px solid var(--border);padding:8px 0}.ql-res td{border:0!important;padding:3px 0!important}.ql-res td:last-child{min-width:0}}.ql-sug{border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--bg);border-left:4px solid var(--border)}
  .ql-sug.pos{border-left-color:var(--pos)}.ql-sug.neg{border-left-color:var(--neg)}.ql-sug.warn{border-left-color:var(--warn)}
  .ql-kpis6{grid-template-columns:repeat(6,minmax(0,1fr))!important}@media(max-width:1100px){.ql-kpis6{grid-template-columns:repeat(3,minmax(0,1fr))!important}}@media(max-width:600px){.ql-kpis6{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
  .card label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input{width:auto;min-height:0}
  .mm-topo .ql-acoes{display:flex;gap:8px;align-items:end;flex-wrap:nowrap;white-space:nowrap}
  .ql-car{display:grid;grid-template-columns:2fr 1.2fr .8fr .8fr .8fr .8fr 1.2fr auto auto;gap:6px;align-items:center;margin-bottom:6px}.ql-car input,.ql-car select{width:100%;box-sizing:border-box}
  @media(max-width:900px){.ql-car{grid-template-columns:1fr 1fr 1fr}}
</style>`;

/** tudo o que as telas da qualidade usam */
export async function carregarQualidade({ meses = 13 } = {}) {
  const e = state.empresa.id; await loadCadastros();
  const desde = new Date(); desde.setMonth(desde.getMonth() - meses);
  const seg = (p, v = []) => p.catch(() => v);
  const [Pm, Pl, Am, I1, I2, R, Pr, Fa, Lc, Op] = await Promise.all([
    q(sb.from('qual_parametros').select('*').eq('empresa_id', e)),
    q(sb.from('qual_planos').select('*').eq('empresa_id', e).order('nome')),
    q(sb.from('qual_amostragem').select('*').eq('empresa_id', e).order('lote_min')),
    fetchAll(() => sb.from('qual_inspecoes').select('*').eq('empresa_id', e).gte('criado_em', desde.toISOString()).order('numero', { ascending: false })),
    q(sb.from('qual_inspecoes').select('*').eq('empresa_id', e).in('situacao', Q.ABERTAS).order('numero', { ascending: false })),
    fetchAll(() => sb.from('qual_rnc').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
    seg(carregarProdutos()), seg(q(sb.from('est_familias').select('id,codigo,nome').eq('empresa_id', e).order('codigo'))),
    seg(q(sb.from('est_locais').select('id,codigo,nome,finalidade,ativo').eq('empresa_id', e).order('ordem'))),
    seg(q(sb.from('prod_ordens').select('id,numero,numero_iniflex,descricao,produto_id,status').eq('empresa_id', e).order('numero', { ascending: false }).limit(300))),
  ]);
  const I = [...new Map([...I1, ...I2].map(x => [x.id, x])).values()].sort((a, b) => b.numero - a.numero);
  const P = Pm[0] || { inspecionar_recebimento: true, prazo_horas: 24, papeis_decisao: ['admin', 'diretor', 'financeiro'], meta_aprovacao_pct: 95, prazo_rnc_dias: 15 };
  const byId = (L) => Object.fromEntries(L.map(x => [x.id, x]));
  const D = { P, Pl, Am, I, R, Pr, Fa, Lc, Op, semConfig: !Pm[0], plById: byId(Pl), prById: byId(Pr), lcById: byId(Lc), opById: byId(Op), faById: byId(Fa),
    favById: state.cad.favById || {} };
  // valor em quarentena e itens bloqueados
  D.quarentena = { valor: 0, qtd: 0 };
  if (P.local_quarentena_id) {
    const S = await seg(q(sb.from('est_saldos').select('produto_id,quantidade,valor').eq('local_id', P.local_quarentena_id).gt('quantidade', 0)));
    D.quarentena = { valor: S.reduce((s, x) => s + +x.valor, 0), qtd: S.length };
  }
  const [Lb, Bb] = await Promise.all([seg(q(sb.from('est_lotes').select('*').eq('empresa_id', e).eq('bloqueado', true))),
    seg(q(sb.from('prod_bobinas').select('id,codigo,ordem_id,peso_kg,situacao,qualidade,qual_inspecao_id,criado_em').eq('empresa_id', e).neq('qualidade', 'liberada').limit(500)))]);
  D.lotesBloq = Lb; D.bobinasBloq = Bb;
  D.ranking = Q.rankingFornecedores(I, Object.fromEntries(Object.values(D.favById).map(f => [f.id, f.nome])));
  return D;
}
export const nomeProd = (D, id) => { const p = D.prById[id]; return p ? `${p.codigo} · ${p.descricao}` : '—'; };
export const nomeFav = (D, id) => D.favById[id]?.nome || '';
export const opTxt = (D, id) => { const o = D.opById[id]; return o ? `OP ${o.numero}${o.numero_iniflex ? ' (Iniflex ' + o.numero_iniflex + ')' : ''}` : ''; };
export const refTxt = (D, i) => { const ob = i.observacao && i.origem === 'nfe' ? i.observacao : null, fv = nomeFav(D, i.fornecedor_id);
  return [i.lote_texto && `lote ${i.lote_texto}`, ob, opTxt(D, i.ordem_id), fv && !(ob || '').includes(fv) ? fv : null].filter(Boolean).join(' · '); };

/** nova inspeção manual (produto, etapa, lote, quantidade, OP) */
export async function novaInspecao(D, { pre = {}, onSalvo } = {}) {
  const md = modal({ title: 'Nova inspeção', body: `<form id="ni"><div class="grid-form">
    <label class="span2">Produto *<input name="prod" list="ni-pl" required value="${pre.produto_id && D.prById[pre.produto_id] ? esc(D.prById[pre.produto_id].codigo + ' — ' + D.prById[pre.produto_id].descricao) : ''}" placeholder="código ou descrição">${datalistProdutos('ni-pl', D.Pr)}</label>
    <label>Etapa<select name="etapa">${Object.entries(Q.ETAPAS).map(([k, t]) => `<option value="${k}" ${(pre.etapa || 'recebimento') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Origem<select name="origem">${['manual', 'reclamacao', 'estoque', 'op'].map(k => `<option value="${k}" ${pre.origem === k ? 'selected' : ''}>${Q.ORIGENS[k]}</option>`).join('')}</select></label>
    <label class="xs">Quantidade<input name="qtd" inputmode="decimal"></label><label>Lote / bobina<input name="lote"></label>
    <label>Fornecedor<select name="forn">${options(state.cad.favorecidos, { label: 'label', empty: '—' })}</select></label>
    <label>Ordem de produção<select name="op">${options(D.Op.map(o => ({ id: o.id, nome: `OP ${o.numero} · ${o.descricao || ''}` })), { empty: '—', selected: pre.ordem_id })}</select></label>
    <label>Observação<input name="obs"></label></div>
    <p class="muted small">O plano de inspeção do produto nesta etapa é escolhido sozinho (o do produto vence o da família), com a amostra pela tabela do tamanho do lote.</p></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ni-ok">Abrir inspeção</button>` });
  $('#ni-ok', md.el).onclick = async () => {
    const f = $('#ni', md.el); if (!f.reportValidity()) return;
    const p = acharProduto(f.prod.value, D.Pr); if (!p) return toast('Escolha o produto na lista', true);
    try {
      const [x] = await q(sb.from('qual_inspecoes').insert({ empresa_id: state.empresa.id, produto_id: p.id, etapa: f.etapa.value, origem: f.origem.value, quantidade: f.qtd.value.trim() ? parseNum(f.qtd.value) : null,
        unidade: p.unidade, lote_texto: f.lote.value.trim() || null, fornecedor_id: f.forn.value || null, ordem_id: f.op.value || null, observacao: f.obs.value.trim() || null }).select());
      md.close(); toast(`Inspeção ${x.numero} aberta${x.plano_id ? '' : ' (sem plano: cadastre em Planos e Parâmetros)'}`); onSalvo?.(x);
    } catch (e) { fail(e); }
  };
}

const parseValores = (s) => String(s || '').split(/[;\s]+/).map(t => t.trim()).filter(Boolean).map(t => parseNum(t)).filter(v => v != null && !isNaN(v));

/** ficha da inspeção: resultados por característica (com a avaliação ao vivo), laudo, decisão, anexos e laudo impresso */
export async function fichaInspecao(D, i, { onMudou } = {}) {
  const pl = D.plById[i.plano_id] || { caracteristicas: [] }, car = pl.caracteristicas || [], aberta = Q.ABERTAS.includes(i.situacao);
  const reg = podeRegistrar() && aberta, dec = podeDecidir(D) && aberta;
  const A = await q(sb.from('qual_anexos').select('*').eq('inspecao_id', i.id).order('criado_em')).catch(() => []);
  const rnc = D.R.find(x => x.inspecao_id === i.id);
  const res = JSON.parse(JSON.stringify(i.resultados || []));
  const md = modal({ title: `Inspeção ${i.numero} — ${nomeProd(D, i.produto_id)}`, wide: true, body: `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${selo(Q.SITUACOES[i.situacao], clsSit(i.situacao))}${selo(Q.ETAPAS[i.etapa])}${selo(Q.ORIGENS[i.origem] || i.origem, i.origem === 'liberacao' ? 'warn' : '')}
      ${Q.atrasada(i) ? selo('Fora do prazo', 'neg') : ''}${i.movimento_id ? selo('Material na quarentena', 'warn') : ''}<span class="muted small">${esc(refTxt(D, i))}</span></div>
    <div class="kpis" style="margin-top:10px">
      <div class="kpi"><div class="k-label">Quantidade do lote</div><div class="k-value">${nf(i.quantidade)} ${esc(i.unidade || '')}</div></div>
      <div class="kpi"><div class="k-label">Amostra</div><div class="k-value">${i.amostra ?? '–'}</div><div class="k-sub">aceita ${i.ac ?? 0} · rejeita ${i.re ?? 1} defeito(s)</div></div>
      <div class="kpi"><div class="k-label">Plano</div><div class="k-value" style="font-size:15px">${esc(pl.nome || 'Sem plano')}</div><div class="k-sub">${car.length} característica(s)</div></div>
      <div class="kpi"><div class="k-label">Prazo</div><div class="k-value" style="font-size:15px">${hora(i.prazo) || '–'}</div><div class="k-sub">aberta ${hora(i.criado_em)}</div></div>
      <div class="kpi"><div class="k-label">Destino se aprovado</div><div class="k-value" style="font-size:15px">${esc(D.lcById[i.local_destino_id]?.nome || (i.movimento_id ? '—' : 'sem estoque'))}</div></div></div>
    ${pl.instrucoes ? `<p class="small" style="margin:10px 0"><b>Instruções:</b> ${esc(pl.instrucoes)}</p>` : ''}
    <div class="table-wrap" style="margin-top:10px"><table class="ql-res"><thead><tr><th>Característica</th><th>Especificação</th><th style="width:34%">Resultado</th><th>Avaliação</th></tr></thead><tbody id="fi-res">
      ${car.map((c, k) => { const r0 = res.find(x => x.nome === c.nome) || {}; return `<tr data-k="${k}"><td><b>${esc(c.nome)}</b>${c.critica ? ' ' + selo('Crítica', 'neg') : ''}<div class="small muted">${esc(c.metodo || '')}</div></td>
        <td class="small">${c.tipo === 'atributo' ? 'Sem defeito' : [c.nominal != null && c.nominal !== '' ? `nominal ${nf(c.nominal, 4)}` : '', `${c.min != null && c.min !== '' ? nf(c.min, 4) : '–'} a ${c.max != null && c.max !== '' ? nf(c.max, 4) : '–'}`].filter(Boolean).join(' · ')} ${esc(c.unidade || '')}</td>
        <td>${c.tipo === 'atributo' ? `<input type="number" min="0" data-def="${k}" value="${r0.defeitos ?? ''}" placeholder="nº de defeitos na amostra" ${reg ? '' : 'disabled'}>`
          : `<input data-val="${k}" value="${esc((r0.valores || []).map(v => nf(v, 4)).join('; '))}" placeholder="valores separados por ; (ex.: 50,2; 49,8)" ${reg ? '' : 'disabled'}>`}
          <input data-obs="${k}" value="${esc(r0.obs || '')}" placeholder="observação" style="margin-top:4px" ${reg ? '' : 'disabled'}></td><td data-av="${k}"></td></tr>`; }).join('')
        || '<tr><td colspan="4" class="empty">O plano não tem características. Registre o resultado na observação e decida.</td></tr>'}</tbody></table></div>
    <div class="ql-sug" id="fi-sug"></div>
    <div class="grid-form">
      ${pl.exige_laudo ? `<label class="chk"><input type="checkbox" id="fi-laudo" ${i.laudo_ok ? 'checked' : ''} ${reg ? '' : 'disabled'}> Laudo do fornecedor conferido</label>` : ''}
      <label>Inspetor<input id="fi-insp" value="${esc(i.inspetor || state.user?.user_metadata?.nome || '')}" ${reg ? '' : 'disabled'}></label>
      <label class="span2">Observação<input id="fi-obs" value="${esc(i.observacao || '')}" ${reg ? '' : 'disabled'}></label></div>
    ${i.decidida_em ? `<p class="small" style="margin-top:10px"><b>Decisão:</b> ${esc(Q.SITUACOES[i.situacao])} por ${esc(i.decidida_por || '')} em ${hora(i.decidida_em)}${i.qtd_aprovada != null ? ` · aprovado ${nf(i.qtd_aprovada)} · reprovado ${nf(i.qtd_reprovada)}` : ''}${i.motivo ? ` · ${esc(i.motivo)}` : ''}</p>` : ''}
    ${rnc ? `<p class="small"><a href="#/qualidade/nao-conformidades?abrir=${rnc.id}">RNC ${rnc.numero}</a> — ${esc(Q.SIT_RNC[rnc.situacao])} · disposição: ${esc(Q.DISPOSICOES[rnc.disposicao])}</p>` : ''}
    <h4 style="margin:12px 0 4px">Fotos, laudos e certificados</h4>
    ${podeRegistrar() ? '<div class="toolbar"><input type="file" id="fa-a" accept="image/*,application/pdf" capture="environment" multiple><button class="btn small" id="fa-ok" type="button">Enviar</button></div>' : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">${A.map(a => `<a href="#" data-ver="${esc(a.caminho)}" class="btn small ghost">📎 ${esc(a.nome)}</a>`).join('') || '<span class="muted small">Sem anexos.</span>'}</div>`,
    foot: `${aberta && podeGerir() && !i.movimento_id ? '<button class="btn danger" id="fi-canc">Cancelar</button>' : ''}<span class="spacer"></span><button class="btn" id="fi-imp">Imprimir laudo</button>
      ${reg ? '<button class="btn" id="fi-salva">Salvar resultados</button>' : ''}${dec ? '<button class="btn" id="fi-rep">✕ Reprovar</button><button class="btn" id="fi-conc">Aprovar com concessão</button><button class="btn primary" id="fi-apr">✔ Aprovar</button>' : ''}` });
  conversaNoModal(md, 'qual_inspecao', i.id);
  const el = md.el;
  const ler = () => {
    const out = car.map((c, k) => {
      const o = { nome: c.nome, obs: $(`[data-obs="${k}"]`, el)?.value.trim() || null };
      if (c.tipo === 'atributo') { const v = $(`[data-def="${k}"]`, el).value; o.defeitos = v === '' ? null : +v; }
      else o.valores = parseValores($(`[data-val="${k}"]`, el).value);
      return o;
    });
    return out;
  };
  let ultima = null;
  const pintar = () => {
    const r = ler(), av = Q.avaliar(car, r), insp = { ...i, laudo_ok: $('#fi-laudo', el)?.checked ?? i.laudo_ok };
    av.linhas.forEach((l, k) => { const td = $(`[data-av="${k}"]`, el); if (!td) return;
      td.innerHTML = !l.preenchido ? '<span class="muted small">—</span>' : l.tipo === 'atributo' ? `${selo(l.ok ? 'OK' : `${l.defeitos} defeito(s)`, l.ok ? 'pos' : 'neg')}`
        : `${selo(l.ok ? 'Dentro' : `${l.fora} fora`, l.ok ? 'pos' : 'neg')}<div class="small muted">n ${l.n} · média ${nf(l.media, 3)} · ${nf(l.min, 3)} a ${nf(l.max, 3)}${l.cpk != null ? ` · Cpk ${nf(l.cpk)}` : ''}</div>`; });
    const s = Q.sugestao(insp, av, { exigeLaudo: !!pl.exige_laudo }); ultima = s;
    const box = $('#fi-sug', el); box.className = 'ql-sug ' + (s.decisao === 'aprovada' ? 'pos' : s.decisao === 'reprovada' ? 'neg' : 'warn');
    box.innerHTML = `<b>${s.decisao === 'aprovada' ? 'Sugestão: aprovar' : s.decisao === 'reprovada' ? 'Sugestão: reprovar' : 'Sem sugestão ainda'}</b> — ${esc(s.txt)} <span class="muted small">(${av.defeitos} defeito(s) na amostra)</span>`;
    return { r, av };
  };
  pintar(); el.addEventListener('input', pintar); el.addEventListener('change', pintar);
  const salvar = async (extra = {}) => {
    const { r, av } = pintar();
    await q(sb.from('qual_inspecoes').update({ resultados: r, defeitos: av.defeitos, laudo_ok: $('#fi-laudo', el)?.checked ?? null, inspetor: $('#fi-insp', el).value.trim() || null,
      observacao: $('#fi-obs', el).value.trim() || null, situacao: 'em_inspecao', ...extra }).eq('id', i.id));
  };
  const b = (id, fn) => { const x = $(id, el); if (x) x.onclick = async () => { try { await fn(); } catch (e) { fail(e); } }; };
  b('#fi-salva', async () => { await salvar(); toast('Resultados salvos'); md.close(); onMudou?.(); });
  b('#fi-imp', async () => imprimirLaudo(D, { ...i, resultados: ler() }));
  b('#fi-canc', async () => { const m = prompt('Motivo do cancelamento:'); if (!m?.trim()) return; await q(sb.from('qual_inspecoes').update({ situacao: 'cancelada', observacao: m.trim() }).eq('id', i.id)); toast('Inspeção cancelada'); md.close(); onMudou?.(); });
  const decidir = async (decisao) => {
    if (decisao === 'aprovada' && ultima?.decisao === 'reprovada' && !await confirmDialog('A avaliação sugere reprovar. Aprovar mesmo assim? (prefira "Aprovar com concessão", que registra o motivo)')) return;
    if (podeRegistrar()) await salvar();
    janelaDecisao(D, i, decisao, async () => { md.close(); onMudou?.(); });
  };
  b('#fi-apr', () => decidir('aprovada')); b('#fi-conc', () => decidir('aprovada_concessao')); b('#fi-rep', () => decidir('reprovada'));
  b('#fa-ok', async () => {
    const fs = [...$('#fa-a', el).files]; if (!fs.length) return toast('Escolha a foto ou o arquivo', true);
    for (const f of fs) { const cam = `${state.empresa.id}/insp/${i.id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`; const { error } = await sb.storage.from(BUCKET).upload(cam, f); if (error) throw error;
      await q(sb.from('qual_anexos').insert({ empresa_id: state.empresa.id, inspecao_id: i.id, caminho: cam, nome: f.name, tipo: f.type.startsWith('image/') ? 'foto' : 'laudo' })); }
    toast('Enviado'); md.close(); fichaInspecao(D, i, { onMudou });
  });
  $$('[data-ver]', el).forEach(a => a.onclick = async (ev) => { ev.preventDefault(); try { const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.dataset.ver, 300); if (error) throw error; window.open(data.signedUrl, '_blank'); } catch (e) { fail(e); } });
}

function janelaDecisao(D, i, decisao, onFeito) {
  const tit = { aprovada: 'Aprovar', aprovada_concessao: 'Aprovar com concessão', reprovada: 'Reprovar' }[decisao];
  const temQtd = i.quantidade != null;
  const md = modal({ title: `${tit} — inspeção ${i.numero}`, narrow: true, body: `<form id="jd"><div class="grid-form">
    ${temQtd ? `<label class="span2">Quantidade aprovada (de ${nf(i.quantidade)} ${esc(i.unidade || '')})<input name="qa" inputmode="decimal" value="${decisao === 'reprovada' ? '0' : nf(i.quantidade, 4)}"></label>` : ''}
    <label class="full">${decisao === 'aprovada' ? 'Observação' : 'Motivo *'}<textarea name="mot" rows="3" ${decisao === 'aprovada' ? '' : 'required'} placeholder="${decisao === 'reprovada' ? 'Ex.: índice de fluidez 3,1 (máx. 2,2)' : decisao === 'aprovada_concessao' ? 'Ex.: largura 1 mm acima, aceito pelo cliente (e-mail de 07/11)' : ''}"></textarea></label></div>
    <p class="small muted">${i.movimento_id ? `O aprovado vai da Quarentena para <b>${esc(D.lcById[i.local_destino_id]?.nome || 'o local de destino')}</b>; o reprovado vai para o local <b>Reprovado</b> e abre a não conformidade (RNC).`
      : i.ordem_id || i.origem === 'liberacao' ? 'Aprovar libera as bobinas bloqueadas por esta inspeção; reprovar marca as bobinas como reprovadas e abre a RNC.' : 'Sem material na quarentena: a decisão fica registrada; o reprovado abre a RNC.'}</p></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Voltar</button><button class="btn ${decisao === 'reprovada' ? 'danger' : 'primary'}" id="jd-ok">${tit}</button>` });
  $('#jd-ok', md.el).onclick = async () => {
    const f = $('#jd', md.el); if (!f.reportValidity()) return;
    try {
      const r = await q(sb.rpc('qual_decidir', { p_inspecao: i.id, p_decisao: decisao, p_qtd_aprovada: temQtd ? parseNum(f.qa.value) : null, p_motivo: f.mot.value.trim() || null }));
      md.close(); toast(`Inspeção ${i.numero}: ${Q.SITUACOES[decisao].toLowerCase()}${r?.rnc_id ? ' — RNC aberta' : ''}`); onFeito?.();
    } catch (e) { fail(e); }
  };
}

/** ficha da RNC: descrição, disposição (executada no estoque), 5 porquês, ações, eficácia, custo */
export async function fichaRnc(D, r, { onMudou } = {}) {
  const reg = podeRegistrar(), dec = podeDecidir(D), aberta = Q.RNC_ABERTAS.includes(r.situacao), insp = D.I.find(x => x.id === r.inspecao_id);
  const pq = [...(r.porques || []), '', '', '', '', ''].slice(0, 5);
  const md = modal({ title: `RNC ${r.numero} — ${nomeProd(D, r.produto_id)}`, wide: true, body: `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${selo(Q.SIT_RNC[r.situacao], clsRnc(r.situacao))}${selo('Gravidade ' + Q.GRAVIDADES[r.gravidade].toLowerCase(), clsGrav(r.gravidade))}${selo(Q.ORIGENS_RNC[r.origem])}
      ${Q.rncVencida(r) ? selo('Ação vencida', 'neg') : ''}<span class="muted small">aberta ${hora(r.aberta_em)} por ${esc(r.aberta_por || '')}${insp ? ` · inspeção ${insp.numero}` : ''}${r.favorecido_id ? ' · ' + esc(nomeFav(D, r.favorecido_id)) : ''}</span></div>
    <form id="fr"><div class="grid-form" style="margin-top:10px">
      <label class="full">O que aconteceu *<textarea name="desc" rows="2" ${reg && aberta ? '' : 'disabled'}>${esc(r.descricao)}</textarea></label>
      <label class="xs">Quantidade<input name="qtd" inputmode="decimal" value="${r.quantidade != null ? nf(r.quantidade, 4) : ''}" ${reg && aberta && !insp ? '' : 'disabled'}></label>
      <label class="xs">Gravidade<select name="grav" ${reg && aberta ? '' : 'disabled'}>${Object.entries(Q.GRAVIDADES).map(([k, t]) => `<option value="${k}" ${r.gravidade === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="xs">Custo (R$)<input name="custo" inputmode="decimal" value="${+r.custo ? nf(r.custo) : ''}" ${reg && aberta ? '' : 'disabled'}></label>
      <label class="xs">Situação<select name="sit" ${reg ? '' : 'disabled'}>${Object.entries(Q.SIT_RNC).map(([k, t]) => `<option value="${k}" ${r.situacao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="full">Ação imediata (contenção)<input name="aim" value="${esc(r.acao_imediata || '')}" ${reg && aberta ? '' : 'disabled'} placeholder="Ex.: segregar o lote, avisar a expedição, inspecionar 100% as bobinas da OP"></label>
      <label class="full">Equipe (D1)<input name="equipe" value="${esc(r.equipe || '')}" ${reg && aberta ? '' : 'disabled'} placeholder="Ex.: qualidade, encarregado da extrusão, comercial"></label>
    </div>
    ${r.origem === 'cliente' || r.portal_visivel ? `<div id="fr-cli" class="ql-cli"><div class="loading small">Carregando o que veio do cliente…</div></div>` : ''}
    <h4 style="margin:12px 0 4px">Disposição do material</h4>
    <div class="grid-form" style="align-items:end">
      <label class="span2">Disposição<select name="disp" ${dec && !r.disposicao_executada_em ? '' : 'disabled'}>${Object.entries(Q.DISPOSICOES).map(([k, t]) => `<option value="${k}" ${r.disposicao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Local de destino<select name="dloc" ${dec && !r.disposicao_executada_em ? '' : 'disabled'}>${options(D.Lc.filter(l => l.ativo && l.finalidade !== 'quarentena'), { empty: 'o de destino da inspeção' })}</select></label>
      ${dec && !r.disposicao_executada_em ? '<div style="display:flex;align-items:end"><button class="btn" id="fr-disp" type="button">Executar no estoque</button></div>' : `<div class="small" style="align-self:end;padding-bottom:8px">${r.disposicao_executada_em ? `✔ Executada em ${hora(r.disposicao_executada_em)}${r.disposicao_obs ? ' · ' + esc(r.disposicao_obs) : ''}` : r.disposicao === 'devolver_fornecedor' ? 'Aguardando a NF de devolução' : ''}</div>`}
    </div>
    <h4 style="margin:12px 0 4px">Análise da causa — 5 porquês</h4>
    ${pq.map((t, k) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span class="muted small" style="width:70px">Por quê ${k + 1}?</span><input data-pq="${k}" value="${esc(t)}" style="flex:1" ${reg && aberta ? '' : 'disabled'}></div>`).join('')}
    <div class="grid-form">
      <label class="span2">Causa raiz<input name="causa" value="${esc(r.causa || '')}" ${reg && aberta ? '' : 'disabled'}></label>
      <label class="span2">Ação corretiva (para não repetir)<input name="acao" value="${esc(r.acao_corretiva || '')}" ${reg && aberta ? '' : 'disabled'}></label>
      <label>Responsável<input name="resp" value="${esc(r.responsavel || '')}" ${reg && aberta ? '' : 'disabled'}></label>
      <label class="xs">Prazo<input type="date" name="prazo" value="${r.prazo || ''}" ${reg && aberta ? '' : 'disabled'}></label>
      <label class="xs">Eficácia<select name="efi" ${reg ? '' : 'disabled'}><option value="">—</option><option value="eficaz" ${r.eficacia === 'eficaz' ? 'selected' : ''}>Eficaz</option><option value="nao_eficaz" ${r.eficacia === 'nao_eficaz' ? 'selected' : ''}>Não eficaz</option></select></label>
      <label class="xs">Verificada em<input type="date" name="efd" value="${r.eficacia_em || ''}" ${reg ? '' : 'disabled'}></label>
      <label class="full">Prevenção (D7) — o que muda para não acontecer em outros produtos<input name="prev" value="${esc(r.prevencao || '')}" ${reg ? '' : 'disabled'} placeholder="Ex.: checklist de setup da solda em todas as máquinas"></label>
    </div></form>`,
    foot: `<span class="spacer"></span><button class="btn" id="fr-imp">Imprimir RNC</button>${reg ? '<button class="btn primary" id="fr-ok">Salvar</button>' : ''}` });
  conversaNoModal(md, 'qual_rnc', r.id);
  const el = md.el, f = $('#fr', el);
  if ($('#fr-cli', el)) blocoCliente(r, $('#fr-cli', el), { reg, onMudou: () => { md.close(); onMudou?.(); } });
  $('#fr-imp', el).onclick = () => imprimirRnc(D, r);
  $('#fr-ok', el) && ($('#fr-ok', el).onclick = async () => {
    const reg2 = { descricao: f.desc.value.trim() || r.descricao, gravidade: f.grav.value, custo: f.custo.value.trim() ? parseNum(f.custo.value) : 0, situacao: f.sit.value,
      acao_imediata: f.aim.value.trim() || null, porques: $$('[data-pq]', el).map(x => x.value.trim()).filter(Boolean), causa: f.causa.value.trim() || null,
      acao_corretiva: f.acao.value.trim() || null, responsavel: f.resp.value.trim() || null, prazo: f.prazo.value || null, eficacia: f.efi.value || null, eficacia_em: f.efd.value || null,
      equipe: f.equipe.value.trim() || null, prevencao: f.prev.value.trim() || null };
    if (f.pvis && !f.pvis.disabled) reg2.portal_visivel = f.pvis.checked;
    if (!f.qtd.disabled) reg2.quantidade = f.qtd.value.trim() ? parseNum(f.qtd.value) : null;
    if (!r.disposicao_executada_em && !f.disp.disabled && f.disp.value !== r.disposicao && !(insp?.movimento_id)) reg2.disposicao = f.disp.value;
    if (reg2.situacao === 'encerrada' && reg2.eficacia !== 'eficaz' && !await confirmDialog('Encerrar sem a eficácia verificada como "Eficaz"?')) return;
    try { await q(sb.from('qual_rnc').update(reg2).eq('id', r.id)); toast('RNC salva'); md.close(); onMudou?.(); } catch (e) { fail(e); }
  });
  $('#fr-disp', el) && ($('#fr-disp', el).onclick = async () => {
    const d = f.disp.value; if (d === 'pendente') return toast('Escolha a disposição', true);
    if (!await confirmDialog(`Executar "${Q.DISPOSICOES[d]}"? ${insp?.movimento_id ? 'O material sai do local Reprovado.' : ''}`)) return;
    try { const x = await q(sb.rpc('qual_dispor', { p_rnc: r.id, p_disposicao: d, p_local: f.dloc.value || null, p_obs: null }));
      toast(x === 'aguardando_nf_devolucao' ? 'Disposição registrada: a NF de devolução vai baixar o material do Reprovado' : 'Disposição executada'); md.close(); onMudou?.(); } catch (e) { fail(e); }
  });
}

// o que veio do cliente pelo Portal (melhoria 6.6, SQL 128): nota, lote, fotos, prazo da resposta, resposta e avaliação
async function blocoCliente(r, box, { reg, onMudou }) {
  const [N, A] = await Promise.all([r.nota_id ? q(sb.from('nfe_notas').select('numero,emissao').eq('id', r.nota_id)).catch(() => []) : [],
    q(sb.from('qual_anexos').select('*').eq('rnc_id', r.id).eq('portal_visivel', true).order('criado_em')).catch(() => [])]);
  let urls = {}; if (A.length) { const { data } = await sb.storage.from(BUCKET).createSignedUrls(A.map(a => a.caminho), 3600); (data || []).forEach(x => { if (x.signedUrl) urls[x.path] = x.signedUrl; }); }
  const atras = Q.respostaAtrasada(r), nota = N[0];
  box.innerHTML = `<h4 style="margin:12px 0 4px">Cliente (Portal)</h4>
    <div class="small">${[nota ? `NF ${nota.numero} de ${dateBR(nota.emissao)}` : '', r.produto_cliente ? `produto: ${esc(r.produto_cliente)}` : '', r.lote_cliente ? `lote: ${esc(r.lote_cliente)}` : '',
      r.quantidade_cliente ? `quantidade: ${nf(r.quantidade_cliente)} ${esc(r.unidade_cliente || '')}` : ''].filter(Boolean).join(' · ') || '<span class="muted">Sem nota nem lote informados.</span>'}
      ${r.prazo_resposta && !r.respondida_em ? ` · primeira resposta até <b>${dateBR(r.prazo_resposta)}</b> ${atras ? selo('Atrasada', 'neg') : ''}` : ''}</div>
    ${A.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${A.map(a => urls[a.caminho] ? `<a href="${urls[a.caminho]}" target="_blank" rel="noopener"><img src="${urls[a.caminho]}" alt="${esc(a.nome)}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid var(--border)"></a>` : '').join('')}</div>` : ''}
    ${r.favorecido_id ? `<label class="chk" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" form="fr" name="pvis" ${r.portal_visivel ? 'checked' : ''} ${reg ? '' : 'disabled'}> O cliente acompanha esta RNC no Portal (análise 8D e resposta)</label>` : ''}
    <div style="margin-top:8px"><div class="small" style="margin-bottom:4px"><b>Resposta ao cliente</b>${r.respondida_em ? ` <span class="muted">— enviada em ${hora(r.respondida_em)} por ${esc(r.respondida_por || '')}</span>` : ''}</div>
      <textarea id="fr-resp" rows="3" style="width:100%;box-sizing:border-box" ${reg ? '' : 'disabled'} placeholder="O que foi encontrado, o que fizemos com o material dele e o que muda para não repetir">${esc(r.resposta_cliente || '')}</textarea></div>
    ${reg && r.favorecido_id ? `<div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn" type="button" id="fr-env">${r.respondida_em ? 'Enviar nova resposta' : 'Enviar resposta ao cliente'}</button></div>` : ''}
    ${r.cliente_avaliou_em ? `<div class="small" style="margin-top:6px">${r.cliente_aceite === 'aceita' ? selo('Cliente aceitou a resposta', 'pos') : selo('Cliente NÃO aceitou a resposta', 'neg')} ${r.cliente_comentario ? `“${esc(r.cliente_comentario)}”` : ''} <span class="muted">${hora(r.cliente_avaliou_em)}</span></div>` : ''}`;
  $('#fr-env', box) && ($('#fr-env', box).onclick = async (ev) => {
    const t = $('#fr-resp', box).value.trim(); if (t.length < 10) return toast('Escreva a resposta ao cliente', true);
    if (!await confirmDialog('Enviar a resposta ao cliente? Ele recebe por e-mail (e WhatsApp, se aceitou) e vê no Portal com a análise.')) return;
    ev.target.disabled = true;
    try { const n = await q(sb.rpc('qual_responder_cliente', { p_rnc: r.id, p_resposta: t }));
      sb.functions.invoke('email', { body: {} }).catch(() => {}); sb.functions.invoke('whatsapp', { body: {} }).catch(() => {});
      toast(n ? `Resposta enviada (${n} mensagem(ns))` : 'Resposta publicada no Portal (o cliente não tem e-mail ativo no Portal)'); onMudou?.(); } catch (e) { fail(e); ev.target.disabled = false; }
  });
}

/** nova RNC (reclamação de cliente, interna, auditoria) */
export function novaRnc(D, { onSalvo } = {}) {
  const md = modal({ title: 'Nova não conformidade', body: `<form id="nr"><div class="grid-form">
    <label>Origem<select name="orig">${['cliente', 'interna', 'processo', 'fornecedor', 'auditoria'].map(k => `<option value="${k}">${Q.ORIGENS_RNC[k]}</option>`).join('')}</select></label>
    <label class="span2">Produto<input name="prod" list="nr-pl" placeholder="código ou descrição">${datalistProdutos('nr-pl', D.Pr)}</label>
    <label class="span2">Cliente / fornecedor<select name="fav">${options(state.cad.favorecidos, { label: 'label', empty: '—' })}</select></label>
    <label class="xs">Gravidade<select name="grav">${Object.entries(Q.GRAVIDADES).map(([k, t]) => `<option value="${k}" ${k === 'media' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="xs">Quantidade<input name="qtd" inputmode="decimal"></label>
    <label class="full">O que aconteceu *<textarea name="desc" rows="3" required placeholder="Ex.: cliente reclamou de solda abrindo no saco 40x60 da NF 4521"></textarea></label></div></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="nr-ok">Abrir RNC</button>` });
  $('#nr-ok', md.el).onclick = async () => {
    const f = $('#nr', md.el); if (!f.reportValidity()) return;
    const p = f.prod.value.trim() ? acharProduto(f.prod.value, D.Pr) : null; if (f.prod.value.trim() && !p) return toast('Escolha o produto na lista', true);
    try { const [x] = await q(sb.from('qual_rnc').insert({ empresa_id: state.empresa.id, origem: f.orig.value, produto_id: p?.id || null, favorecido_id: f.fav.value || null, gravidade: f.grav.value,
      quantidade: f.qtd.value.trim() ? parseNum(f.qtd.value) : null, unidade: p?.unidade || null, descricao: f.desc.value.trim() }).select()); md.close(); toast(`RNC ${x.numero} aberta`); onSalvo?.(x); } catch (e) { fail(e); }
  };
}

const T = (cab, L, num = []) => `<table><thead><tr>${cab.map((h, i) => `<th${num.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${L.map(l => `<tr>${l.map((v, i) => `<td${num.includes(i) ? ' class="num"' : ''}>${v ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cab.length}">—</td></tr>`}</tbody></table>`;
export function imprimirLaudo(D, i) {
  const pl = D.plById[i.plano_id] || { caracteristicas: [] }, av = Q.avaliar(pl.caracteristicas || [], i.resultados || []), res = Object.fromEntries((i.resultados || []).map(x => [x.nome, x]));
  abrirRelatorio({ nome: `Laudo ${i.numero}`, titulo: `LAUDO DE INSPEÇÃO Nº ${i.numero}`, subtitulo: esc(nomeProd(D, i.produto_id)),
    extraCss: '.num{text-align:right} .ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:50px} .ass div{border-top:1px solid #000;padding-top:4px;text-align:center;font-size:10pt} .ok{color:#137333;font-weight:bold} .nok{color:#b3261e;font-weight:bold}',
    corpo: `<h2>1. Identificação</h2>${T(['Campo', 'Valor'], [['Etapa / origem', `${Q.ETAPAS[i.etapa]} · ${Q.ORIGENS[i.origem] || i.origem}`], ['Produto', esc(nomeProd(D, i.produto_id))], ['Referência', esc(refTxt(D, i)) || '—'],
      ['Quantidade do lote', `${nf(i.quantidade)} ${esc(i.unidade || '')}`], ['Plano / amostra', `${esc(pl.nome || 'Sem plano')} · amostra ${i.amostra ?? '–'} (aceita ${i.ac ?? 0}, rejeita ${i.re ?? 1})`],
      ['Inspetor / data', `${esc(i.inspetor || '')} · ${hora(i.inspecionada_em || i.atualizado_em)}`], ...(pl.exige_laudo ? [['Laudo do fornecedor', i.laudo_ok ? 'Conferido' : 'Não conferido']] : [])])}
      <h2>2. Resultados</h2>${T(['Característica', 'Especificação', 'Resultado', 'Avaliação'], av.linhas.map((l, k) => { const c = pl.caracteristicas[k];
        return [esc(l.nome) + (l.critica ? ' (crítica)' : ''), c.tipo === 'atributo' ? 'Sem defeito' : `${c.min != null && c.min !== '' ? nf(c.min, 4) : '–'} a ${c.max != null && c.max !== '' ? nf(c.max, 4) : '–'} ${esc(c.unidade || '')}`,
          c.tipo === 'atributo' ? `${l.defeitos} defeito(s)` : `${(res[l.nome]?.valores || []).map(v => nf(v, 4)).join('; ')}${l.n ? `<br><small>média ${nf(l.media, 3)}${l.cpk != null ? ` · Cpk ${nf(l.cpk)}` : ''}</small>` : ''}`,
          l.ok == null ? '—' : l.ok ? '<span class="ok">Conforme</span>' : '<span class="nok">Não conforme</span>']; }))}
      <h2>3. Decisão</h2><p><b>${esc(Q.SITUACOES[i.situacao])}</b>${i.qtd_aprovada != null ? ` — aprovado ${nf(i.qtd_aprovada)} · reprovado ${nf(i.qtd_reprovada)} ${esc(i.unidade || '')}` : ''}${i.decidida_por ? ` — por ${esc(i.decidida_por)} em ${hora(i.decidida_em)}` : ''}</p>
      ${i.motivo ? `<p><b>Motivo:</b> ${esc(i.motivo)}</p>` : ''}${i.observacao ? `<p><b>Observação:</b> ${esc(i.observacao)}</p>` : ''}
      <div class="ass"><div>Inspetor</div><div>Responsável pela decisão</div></div>`, rodape: 'Base: inspeções da qualidade na plataforma' });
}
export function imprimirRnc(D, r) {
  abrirRelatorio({ nome: `RNC ${r.numero}`, titulo: `RELATÓRIO DE NÃO CONFORMIDADE Nº ${r.numero}`, subtitulo: esc(nomeProd(D, r.produto_id)),
    extraCss: '.ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:50px} .ass div{border-top:1px solid #000;padding-top:4px;text-align:center;font-size:10pt}',
    corpo: `<h2>1. Identificação</h2>${T(['Campo', 'Valor'], [['Origem / gravidade', `${Q.ORIGENS_RNC[r.origem]} · ${Q.GRAVIDADES[r.gravidade]}`], ['Aberta', `${hora(r.aberta_em)} por ${esc(r.aberta_por || '')}`],
      ['Cliente / fornecedor', esc(nomeFav(D, r.favorecido_id)) || '—'], ['Quantidade', r.quantidade != null ? `${nf(r.quantidade)} ${esc(r.unidade || '')}` : '—'], ['Situação', Q.SIT_RNC[r.situacao]]])}
      <h2>2. Descrição</h2><p>${esc(r.descricao)}</p><p><b>Equipe:</b> ${esc(r.equipe || '—')}</p><p><b>Ação imediata:</b> ${esc(r.acao_imediata || '—')}</p>
      <h2>3. Disposição do material</h2><p>${esc(Q.DISPOSICOES[r.disposicao])}${r.disposicao_executada_em ? ` — executada em ${hora(r.disposicao_executada_em)}` : ''}</p>
      <h2>4. Análise da causa (5 porquês)</h2>${(r.porques || []).length ? `<ol>${r.porques.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : '<p>—</p>'}<p><b>Causa raiz:</b> ${esc(r.causa || '—')}</p>
      <h2>5. Ação corretiva</h2><p>${esc(r.acao_corretiva || '—')}</p><p><b>Responsável:</b> ${esc(r.responsavel || '—')} · <b>Prazo:</b> ${dateBR(r.prazo) || '—'}</p>
      <p><b>Eficácia:</b> ${r.eficacia === 'eficaz' ? 'Eficaz' : r.eficacia === 'nao_eficaz' ? 'Não eficaz' : 'Não verificada'}${r.eficacia_em ? ` em ${dateBR(r.eficacia_em)}` : ''} · <b>Custo da não qualidade:</b> ${money(r.custo || 0)}</p>
      <p><b>Prevenção:</b> ${esc(r.prevencao || '—')}</p>${r.resposta_cliente ? `<h2>6. Resposta ao cliente</h2><p style="white-space:pre-wrap">${esc(r.resposta_cliente)}</p><p class="small">Enviada em ${hora(r.respondida_em)}${r.cliente_aceite ? ` · cliente ${r.cliente_aceite === 'aceita' ? 'aceitou' : 'não aceitou'}${r.cliente_comentario ? ': ' + esc(r.cliente_comentario) : ''}` : ''}</p>` : ''}
      <div class="ass"><div>Qualidade</div><div>Responsável pela ação</div></div>`, rodape: 'Base: não conformidades da qualidade na plataforma' });
}

// Qualidade › Planos e Parâmetros (PRD015): planos de inspeção (características com especificação), tabela de amostragem
// (tamanho do lote → amostra, aceita e rejeita) e parâmetros (locais, prazo, quem decide, metas).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, options, parseNum, exportXLSX } from '../lib/ui.js';
import { datalistProdutos, acharProduto } from '../lib/produtos.js';
import * as Q from '../lib/qualidade.js';
import { carregarQualidade, nomeProd, selo, CSS, podeGerir, nf } from '../lib/qualidade-ui.js';

export const title = 'Planos e Parâmetros';
const ui = { aba: 'pl', etapa: '' };
let D = null;
const fx = (v) => (v == null || v === '' ? '' : nf(v, 4));
const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['compras', 'Compras'], ['producao', 'Produção']];

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Planos e Parâmetros</h2><div class="muted small">O que inspecionar em cada produto, com que amostra, e as regras da qualidade.</div></div>
      <div class="ql-acoes">${podeGerir() ? '<button class="btn" id="qc-conf">Configurar a qualidade</button>' : ''}<button class="btn ghost" id="qc-xls">Excel</button><span id="qc-acao"></span></div></div>
    <div class="card toolbar"><div class="chips" id="qc-abas">${[['pl', 'Planos de inspeção'], ['am', 'Amostragem'], ['pa', 'Parâmetros']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><select id="qc-e" style="max-width:170px"><option value="">Todas as etapas</option>${Object.entries(Q.ETAPAS).map(([k, t]) => `<option value="${k}" ${ui.etapa === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div id="qc-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#qc-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; $$('#qc-abas .chip', root).forEach(c => c.classList.toggle('on', c.dataset.a === a)); pintar(root); } };
  $('#qc-e', root).onchange = (e) => { ui.etapa = e.target.value; pintar(root); };
  $('#qc-xls', root).onclick = () => exportXLSX($('#qc-corpo table', root), 'qualidade_' + ui.aba);
  $('#qc-conf', root) && ($('#qc-conf', root).onclick = async () => {
    try { const r = await q(sb.rpc('qual_configurar', { p_empresa: state.empresa.id })); toast(`Qualidade configurada: locais Quarentena e Reprovado${+r?.faixas ? ` e ${r.faixas} faixas de amostragem` : ''}`); render(root); } catch (e) { fail(e); }
  });
  try { D = await carregarQualidade({ meses: 1 }); } catch (err) { fail(err); $('#qc-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 087 (qualidade) já foi executado.</div></div>'; return; }
  pintar(root);
}

function pintar(root) {
  const c = $('#qc-corpo', root), acao = $('#qc-acao', root), ger = podeGerir(), re = () => render(root);
  $('#qc-e', root).hidden = ui.aba !== 'pl';
  acao.innerHTML = ger && ui.aba === 'pl' ? '<button class="btn primary" id="qc-novo">Novo plano</button>' : ger && ui.aba === 'am' ? '<button class="btn primary" id="qc-novo">Nova faixa</button>' : '';
  if (ui.aba === 'pl') {
    $('#qc-novo', root) && ($('#qc-novo', root).onclick = () => formPlano(null, re));
    const L = D.Pl.filter(p => !ui.etapa || p.etapa === ui.etapa);
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Plano</th><th>Vale para</th><th>Amostragem</th><th>Características</th></tr></thead><tbody>
      ${L.map(p => `<tr class="clickable" data-p="${p.id}" style="${p.ativo ? '' : 'opacity:.55'}"><td><b>${esc(p.nome)}</b><div class="small muted">${esc(Q.ETAPAS[p.etapa])}${p.liberacao_primeira ? ' · bloqueia a OP até a liberação' : ''}${p.exige_laudo ? ' · exige laudo' : ''}${p.ativo ? '' : ' · inativo'}</div></td>
        <td>${p.produto_id ? esc(nomeProd(D, p.produto_id)) : `Família ${esc(D.faById[p.familia_id]?.codigo || '')} · ${esc(D.faById[p.familia_id]?.nome || '')}`}</td>
        <td class="small">${esc(Q.AMOSTRAGEM[p.amostragem])}${p.amostragem === 'fixa' ? ` (${p.amostra_fixa})` : ''}</td>
        <td class="small wrap">${(p.caracteristicas || []).map(x => esc(x.nome) + (x.critica ? ' ★' : '')).join(' · ') || '—'}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Nenhum plano. Comece pelo recebimento das resinas (índice de fluidez, densidade, umidade, laudo) e pela liberação de setup das extrusoras (espessura, largura, tratamento).</td></tr>'}</tbody></table></div></div>
      <p class="muted small">O plano do produto vence o da família. Recebimento: a entrada da nota de produto com plano vai para a Quarentena. Processo com "bloqueia a OP": as bobinas nascem bloqueadas até a inspeção de liberação. Final: abre a inspeção quando a OP é concluída. ★ = característica crítica (fora reprova).</p>`;
    c.onclick = (e) => { const r = e.target.closest('[data-p]'); if (r && ger) formPlano(D.Pl.find(p => p.id === r.dataset.p), re); };
  } else if (ui.aba === 'am') {
    $('#qc-novo', root) && ($('#qc-novo', root).onclick = () => formFaixa(null, re));
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th class="num">Lote de</th><th class="num">até</th><th class="num">Amostra</th><th class="num">Aceita (Ac)</th><th class="num">Rejeita (Re)</th></tr></thead><tbody>
      ${D.Am.map(a => `<tr class="clickable" data-a="${a.id}"><td class="num">${nf(a.lote_min, 3)}</td><td class="num">${a.lote_max != null ? nf(a.lote_max, 3) : 'acima'}</td><td class="num"><b>${a.amostra}</b></td><td class="num">${a.ac}</td><td class="num">${a.re}</td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">Sem tabela. Clique em "Configurar a qualidade" para criar a de partida.</td></tr>'}</tbody></table></div></div>
      <p class="muted small">A tabela de partida usa os tamanhos de amostra do nível geral de inspeção II da ABNT NBR 5426 (ISO 2859-1), com aceitação zero (Ac 0, Re 1): um defeito na amostra reprova. Ajuste o aceite e a rejeição pelo NQA (nível de qualidade aceitável) combinado com o cliente ou o fornecedor. O tamanho do lote é a quantidade da inspeção, na unidade do produto.</p>`;
    c.onclick = (e) => { const r = e.target.closest('[data-a]'); if (r && ger) formFaixa(D.Am.find(a => a.id === r.dataset.a), re); };
  } else {
    const p = D.P, dis = ger ? '' : 'disabled', locs = D.Lc.filter(l => l.ativo);
    c.innerHTML = `<div class="card"><form id="qpa"><div class="grid-form">
      <label>Local de quarentena<select name="qua" ${dis}>${options(locs.map(l => ({ id: l.id, nome: `${l.codigo} · ${l.nome}` })), { selected: p.local_quarentena_id, empty: '—' })}</select></label>
      <label>Local de reprovado<select name="rep" ${dis}>${options(locs.map(l => ({ id: l.id, nome: `${l.codigo} · ${l.nome}` })), { selected: p.local_reprovado_id, empty: '—' })}</select></label>
      <label class="xs">Prazo para inspecionar (h)<input name="prazo" type="number" min="1" value="${p.prazo_horas}" ${dis}></label>
      <label class="xs">Prazo da ação corretiva (dias)<input name="prnc" type="number" min="1" value="${p.prazo_rnc_dias}" ${dis}></label>
      <label class="xs">Meta de aprovação / IQF (%)<input name="meta" inputmode="decimal" value="${nf(p.meta_aprovacao_pct)}" ${dis}></label>
    </div>
    <label class="chk" style="margin-top:12px;display:flex;gap:8px;align-items:center"><input type="checkbox" name="rec" ${p.inspecionar_recebimento ? 'checked' : ''} ${dis}> Entrada pela nota de produto com plano de recebimento vai para a quarentena</label>
    <h4 style="margin:14px 0 6px">Quem decide (aprova, reprova, libera bloqueio e executa a disposição)</h4>
    <div style="display:flex;gap:16px;flex-wrap:wrap">${PAPEIS.map(([k, t]) => `<label class="chk" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="pap" value="${k}" ${k === 'admin' ? 'checked disabled' : (p.papeis_decisao || []).includes(k) ? 'checked' : ''} ${dis}> ${t}</label>`).join('')}</div>
    <p class="muted small" style="margin-top:10px">Registrar inspeção e abrir RNC: administrador, financeiro, diretor, compras e produção. O administrador sempre decide.</p>
    <h4 style="margin:14px 0 6px">Reclamação pelo Portal do Cliente</h4>
    <label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="prec" ${p.portal_reclamacao !== false ? 'checked' : ''} ${dis}> O cliente abre reclamação pelo Portal (vira RNC de origem "Reclamação de cliente")</label>
    <label class="chk" style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" name="p8d" ${p.portal_mostrar_8d !== false ? 'checked' : ''} ${dis}> O cliente vê a análise (8D: equipe, contenção, causa, ações, prevenção)</label>
    <div class="grid-form" style="margin-top:8px"><label class="xs">Prazo da primeira resposta (dias)<input name="pprz" type="number" min="0" max="30" value="${p.portal_prazo_resposta_dias ?? 2}" ${dis}></label></div>
    <div style="margin-top:6px" class="small">Quem recebe o aviso da reclamação:</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:4px">${[...PAPEIS, ['producao', 'Produção'], ['compras', 'Compras']].filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i).map(([k, t]) => `<label class="chk" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="pav" value="${k}" ${(p.portal_papeis_aviso || ['admin', 'diretor', 'producao']).includes(k) ? 'checked' : ''} ${dis}> ${t}</label>`).join('')}</div>
    <h4 style="margin:14px 0 6px">Certificado de qualidade da NF-e</h4>
    <label class="chk" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="cat" ${p.certificado_ativo !== false ? 'checked' : ''} ${dis}> O cliente baixa o certificado no Portal (notas com bobinas expedidas)</label>
    <div class="grid-form" style="margin-top:8px"><label class="span2">Responsável que assina<input name="cres" value="${esc(p.certificado_responsavel || '')}" ${dis} placeholder="Nome"></label>
      <label class="span2">Cargo<input name="ccar" value="${esc(p.certificado_cargo || '')}" ${dis} placeholder="Ex.: Coordenadora da Qualidade"></label>
      <label class="full">Declaração<textarea name="ctxt" rows="2" ${dis}>${esc(p.certificado_texto || 'Declaramos que os produtos desta nota fiscal foram fabricados e inspecionados conforme os planos de inspeção da empresa e atendem às especificações acordadas.')}</textarea></label></div>
    ${ger ? '<div style="text-align:right"><button class="btn primary" id="qpa-ok" type="button">Salvar parâmetros</button></div>' : ''}</form></div>`;
    $('#qpa-ok', c) && ($('#qpa-ok', c).onclick = async () => {
      const f = $('#qpa', c), pap = ['admin', ...$$('input[name=pap]:checked:not([disabled])', c).map(x => x.value)];
      if (f.qua.value && f.qua.value === f.rep.value) return toast('Quarentena e Reprovado precisam ser locais diferentes', true);
      try { await q(sb.from('qual_parametros').upsert({ empresa_id: state.empresa.id, local_quarentena_id: f.qua.value || null, local_reprovado_id: f.rep.value || null, prazo_horas: +f.prazo.value || 24,
        prazo_rnc_dias: +f.prnc.value || 15, meta_aprovacao_pct: parseNum(f.meta.value) || 95, inspecionar_recebimento: f.rec.checked, papeis_decisao: [...new Set(pap)],
        portal_reclamacao: f.prec.checked, portal_mostrar_8d: f.p8d.checked, portal_prazo_resposta_dias: Math.min(30, Math.max(0, +f.pprz.value || 0)),
        portal_papeis_aviso: $$('input[name=pav]:checked', c).map(x => x.value), certificado_ativo: f.cat.checked, certificado_responsavel: f.cres.value.trim() || null,
        certificado_cargo: f.ccar.value.trim() || null, certificado_texto: f.ctxt.value.trim() || undefined, atualizado_em: new Date().toISOString() }));
        toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
    });
    c.onclick = null;
  }
}

function formPlano(p, onFeito) {
  p = p || { etapa: 'recebimento', amostragem: 'tabela', caracteristicas: [], ativo: true };
  let car = JSON.parse(JSON.stringify(p.caracteristicas || []));
  const md = modal({ title: p.id ? p.nome : 'Novo plano de inspeção', wide: true, body: `<form id="fp"><div class="grid-form">
    <label class="span2">Nome do plano *<input name="nome" required value="${esc(p.nome || '')}" placeholder="Ex.: Recebimento de PEBD"></label>
    <label>Etapa<select name="etapa">${Object.entries(Q.ETAPAS).map(([k, t]) => `<option value="${k}" ${p.etapa === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="span2">Produto<input name="prod" list="fp-pl" value="${p.produto_id && D.prById[p.produto_id] ? esc(D.prById[p.produto_id].codigo + ' — ' + D.prById[p.produto_id].descricao) : ''}" placeholder="vazio = vale para a família">${datalistProdutos('fp-pl', D.Pr)}</label>
    <label>…ou família<select name="fam">${options(D.Fa.map(f => ({ id: f.id, nome: `${f.codigo} · ${f.nome}` })), { selected: p.familia_id, empty: '—' })}</select></label>
    <label>Amostragem<select name="amo">${Object.entries(Q.AMOSTRAGEM).map(([k, t]) => `<option value="${k}" ${p.amostragem === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="xs">Amostra fixa<input name="fixa" type="number" min="1" value="${p.amostra_fixa || ''}"></label>
    <label class="chk"><input type="checkbox" name="laudo" ${p.exige_laudo ? 'checked' : ''}> Exige laudo do fornecedor</label>
    <label class="chk"><input type="checkbox" name="lib" ${p.liberacao_primeira ? 'checked' : ''}> Processo: bloqueia a OP até liberar</label>
    <label class="chk xs"><input type="checkbox" name="at" ${p.ativo ? 'checked' : ''}> Ativo</label>
    <label class="full">Instruções para o inspetor<input name="ins" value="${esc(p.instrucoes || '')}" placeholder="Ex.: medir a espessura em 5 pontos da largura, no primeiro metro da bobina"></label></div>
    <h4 style="margin:12px 0 6px">Características</h4>
    <div class="ql-car small muted"><span>Nome</span><span>Tipo</span><span>Unidade</span><span>Nominal</span><span>Mínimo</span><span>Máximo</span><span>Método</span><span>Crítica</span><span></span></div>
    <div id="fp-car"></div><button class="btn small" id="fp-add" type="button">+ Característica</button>
    <p class="muted small">Medida: o resultado é o valor medido (vários valores separados por ponto e vírgula) e vale a faixa mínimo–máximo. Atributo: conta os defeitos na amostra. Característica crítica fora da especificação reprova o lote.</p></form>`,
    foot: `${p.id ? '<button class="btn danger" id="fp-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="fp-ok">Salvar</button>` });
  const el = md.el, box = $('#fp-car', el);
  const lerCar = () => $$('[data-c]', box).map(r => ({ nome: $('[data-n]', r).value.trim(), tipo: $('[data-t]', r).value, unidade: $('[data-u]', r).value.trim() || null,
    nominal: $('[data-no]', r).value.trim() ? parseNum($('[data-no]', r).value) : null, min: $('[data-mi]', r).value.trim() ? parseNum($('[data-mi]', r).value) : null,
    max: $('[data-ma]', r).value.trim() ? parseNum($('[data-ma]', r).value) : null, metodo: $('[data-me]', r).value.trim() || null, critica: $('[data-cr]', r).checked })).filter(x => x.nome);
  const pintaCar = () => {
    box.innerHTML = car.map((x, k) => `<div class="ql-car" data-c="${k}"><input data-n value="${esc(x.nome || '')}" placeholder="Espessura"><select data-t>${Object.entries(Q.TIPOS_CARAC).map(([v, t]) => `<option value="${v}" ${x.tipo === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${(() => { const at = x.tipo === 'atributo' ? 'disabled' : ''; return `<input data-u value="${esc(x.unidade || '')}" placeholder="${at ? '' : 'µm'}" ${at}><input data-no inputmode="decimal" value="${fx(x.nominal)}" ${at}><input data-mi inputmode="decimal" value="${fx(x.min)}" ${at}><input data-ma inputmode="decimal" value="${fx(x.max)}" ${at}>`; })()}
      <input data-me value="${esc(x.metodo || '')}" placeholder="${x.tipo === 'atributo' ? 'visual' : 'micrômetro'}"><input type="checkbox" data-cr ${x.critica ? 'checked' : ''}><button class="btn ghost small" data-rm="${k}" type="button">✕</button></div>`).join('') || '<p class="muted small">Nenhuma característica.</p>';
  };
  pintaCar();
  $('#fp-add', el).onclick = () => { car = lerCar(); car.push({ nome: '', tipo: 'medida' }); pintaCar(); $$('[data-n]', box).pop()?.focus(); };
  box.onchange = (e) => { if (e.target.matches('[data-t]')) { car = lerCar(); pintaCar(); } };
  box.onclick = (e) => { const k = e.target.closest('[data-rm]')?.dataset.rm; if (k != null) { car = lerCar(); car.splice(+k, 1); pintaCar(); } };
  $('#fp-ok', el).onclick = async () => {
    const f = $('#fp', el); if (!f.reportValidity()) return;
    const pr = f.prod.value.trim() ? acharProduto(f.prod.value, D.Pr) : null;
    if (f.prod.value.trim() && !pr) return toast('Escolha o produto na lista', true);
    if (!pr && !f.fam.value) return toast('Informe o produto ou a família', true);
    if (f.amo.value === 'fixa' && !(+f.fixa.value > 0)) return toast('Informe a amostra fixa', true);
    const cs = lerCar(); if (cs.some(x => x.tipo === 'medida' && x.min != null && x.max != null && x.min > x.max)) return toast('Mínimo maior que o máximo', true);
    const reg = { empresa_id: state.empresa.id, nome: f.nome.value.trim(), etapa: f.etapa.value, produto_id: pr?.id || null, familia_id: pr ? null : f.fam.value, amostragem: f.amo.value,
      amostra_fixa: +f.fixa.value || null, exige_laudo: f.laudo.checked, liberacao_primeira: f.lib.checked, ativo: f.at.checked, instrucoes: f.ins.value.trim() || null, caracteristicas: cs };
    try { p.id ? await q(sb.from('qual_planos').update(reg).eq('id', p.id)) : await q(sb.from('qual_planos').insert(reg)); md.close(); toast('Plano salvo'); onFeito?.(); } catch (e) { fail(e); }
  };
  $('#fp-del', el) && ($('#fp-del', el).onclick = async () => { if (!await confirmDialog('Excluir este plano? As inspeções já feitas ficam no histórico.')) return; try { await q(sb.from('qual_planos').delete().eq('id', p.id)); md.close(); toast('Plano excluído'); onFeito?.(); } catch (e) { fail(e); } });
}

function formFaixa(a, onFeito) {
  a = a || { ac: 0, re: 1 };
  const md = modal({ title: a.id ? 'Faixa de amostragem' : 'Nova faixa', narrow: true, body: `<form id="ff"><div class="grid-form">
    <label class="xs">Lote de *<input name="mi" inputmode="decimal" required value="${a.lote_min ?? ''}"></label><label class="xs">até<input name="ma" inputmode="decimal" value="${a.lote_max ?? ''}" placeholder="acima"></label>
    <label class="xs">Amostra *<input name="n" type="number" min="1" required value="${a.amostra ?? ''}"></label><label class="xs">Aceita (Ac)<input name="ac" type="number" min="0" value="${a.ac}"></label>
    <label class="xs">Rejeita (Re)<input name="re" type="number" min="1" value="${a.re}"></label></div></form>`,
    foot: `${a.id ? '<button class="btn danger" id="ff-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ff-ok">Salvar</button>` });
  $('#ff-ok', md.el).onclick = async () => {
    const f = $('#ff', md.el); if (!f.reportValidity()) return;
    const reg = { empresa_id: state.empresa.id, lote_min: parseNum(f.mi.value), lote_max: f.ma.value.trim() ? parseNum(f.ma.value) : null, amostra: +f.n.value, ac: +f.ac.value || 0, re: +f.re.value || 1 };
    if (reg.re <= reg.ac) return toast('Rejeita precisa ser maior que aceita', true);
    try { a.id ? await q(sb.from('qual_amostragem').update(reg).eq('id', a.id)) : await q(sb.from('qual_amostragem').insert(reg)); md.close(); toast('Faixa salva'); onFeito?.(); } catch (e) { fail(e); }
  };
  $('#ff-del', md.el) && ($('#ff-del', md.el).onclick = async () => { try { await q(sb.from('qual_amostragem').delete().eq('id', a.id)); md.close(); toast('Faixa excluída'); onFeito?.(); } catch (e) { fail(e); } });
}

// Estoque › Implantação do Estoque (EST007) — melhoria 5.1 (SQL 112, 08/11/2026).
// Roteiro guiado até o estoque oficial rodar sozinho pelas NF-e: cada passo com a situação calculada no banco,
// o que fazer, a tela onde fazer, responsável, data prevista e observação. Metas para dar o passo por concluído.
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, toast, fail, modal, today, dateBR } from '../lib/ui.js';
import { codigoDa } from '../lib/telas.js';
import * as K from '../lib/estoque-implantacao.js';

export const title = 'Implantação do Estoque';
let A = null, CFG = null, ETAP = [];

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Implantação do Estoque</h2><div class="muted small">Os passos até o estoque da plataforma virar o oficial e andar sozinho pelas notas fiscais, com o que falta em cada um.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${podeEditar() ? '<button class="btn" id="im-par">Metas</button>' : ''}<button class="btn" id="im-atu">Atualizar</button></div></div>
    <div id="im-corpo"><div class="loading">Conferindo o estoque…</div></div>`;
  $('#im-atu', root).onclick = () => render(root);
  $('#im-par', root) && ($('#im-par', root).onclick = () => metas(root));
  try {
    const e = state.empresa.id;
    [CFG, ETAP] = await Promise.all([
      q(sb.from('est_implantacao_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.from('est_implantacao_etapas').select('*').eq('empresa_id', e)).catch(() => []),
    ]);
    const meses = CFG?.janela_meses || K.CFG_PADRAO.janela_meses;
    const d = new Date(); d.setMonth(d.getMonth() - meses);
    const sit = await q(sb.rpc('est_implantacao_situacao', { p_empresa: e, p_desde: d.toISOString().slice(0, 10) }));
    A = K.avaliar(sit, CFG || {}, ETAP, today());
    A.sit = sit;
    pintar(root);
  } catch (err) { fail(err); $('#im-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível conferir a implantação. Confira se o SQL 112 já foi executado.</div></div>'; }
}

function pintar(root) {
  const cor = (s) => ({ feito: 'var(--pos)', andamento: 'var(--warn)', pendente: 'var(--neg)', bloqueado: 'var(--border)', dispensado: 'var(--border)' })[s];
  const passo = (e, i) => {
    const [txt, cls] = K.SIT[e.s];
    return `<div class="card" data-et="${e.k}" style="display:grid;grid-template-columns:38px 1fr auto;gap:12px;align-items:start;border-left:4px solid ${cor(e.s)};${e.s === 'bloqueado' ? 'opacity:.7' : ''}">
      <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;background:${e.s === 'feito' ? 'var(--pos)' : 'var(--surface-2)'};color:${e.s === 'feito' ? '#fff' : 'inherit'}">${e.s === 'feito' ? '✓' : i + 1}</div>
      <div style="min-width:0">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b>${esc(e.nome)}</b><span class="badge ${cls}">${txt}</span>${e.atrasada ? '<span class="badge vencido">atrasado</span>' : ''}</div>
        <div style="height:6px;background:var(--surface-2);border-radius:3px;margin:6px 0;max-width:420px"><div style="height:6px;width:${e.pct}%;background:${cor(e.s)};border-radius:3px"></div></div>
        ${e.txt.map(t => `<div class="small">${esc(t)}</div>`).join('')}
        ${e.s !== 'feito' && e.s !== 'dispensado' ? `<div class="small muted" style="margin-top:4px">${esc(e.o_que)}</div>` : ''}
        <div class="small" style="margin-top:6px;display:flex;gap:14px;flex-wrap:wrap">${e.responsavel ? `<span>Responsável: <b>${esc(e.responsavel)}</b></span>` : '<span class="muted">Sem responsável</span>'}${e.prevista ? `<span>Previsto: <b>${dateBR(e.prevista)}</b></span>` : ''}${e.observacao ? `<span class="muted">${esc(e.observacao)}</span>` : ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <a class="btn small ${A.proxima?.k === e.k ? 'primary' : ''}" href="#/${e.rota}">${esc(e.acao)}${codigoDa(e.rota) ? ` (${codigoDa(e.rota)})` : ''} →</a>
        ${podeEditar() ? `<button class="btn ghost small" data-ed="${e.k}">Responsável e prazo</button>` : ''}</div></div>`;
  };
  const sr = A.semRegra;
  $('#im-corpo', root).innerHTML = `
    <div class="card" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <div style="min-width:220px;flex:1"><div class="small muted">Implantação de ${esc(state.empresa.nome || '')}</div>
        <div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:2em;font-weight:700">${A.geral}%</span><span class="muted small">concluído</span></div>
        <div style="height:8px;background:var(--surface-2);border-radius:4px;margin-top:4px"><div style="height:8px;width:${A.geral}%;background:${A.concluida ? 'var(--pos)' : 'var(--primary)'};border-radius:4px"></div></div></div>
      <div style="flex:2;min-width:260px">${A.concluida ? '<b>Implantação concluída.</b> O estoque da plataforma é o oficial e as notas movimentam sozinhas.'
        : A.proxima ? `<div class="small muted">Próximo passo</div><b>${esc(A.proxima.nome)}</b><div class="small">${esc(A.proxima.o_que)}</div>` : 'Aguardando os passos anteriores.'}</div>
      <div class="small" style="min-width:220px"><div>Notas analisadas desde <b>${dateBR(A.sit.desde)}</b></div>
        <div>Entradas prontas: <b>${A.ent.pct == null ? '—' : A.ent.pct.toFixed(1).replace('.', ',') + '%'}</b> do valor (${A.ent.itens} itens)</div>
        <div>Saídas prontas: <b>${A.sai.pct == null ? '—' : A.sai.pct.toFixed(1).replace('.', ',') + '%'}</b> do valor (${A.sai.itens} itens)</div></div></div>
    <div style="display:flex;flex-direction:column;gap:10px">${A.etapas.map(passo).join('')}</div>
    ${sr.length ? `<h3 style="margin:18px 0 6px">CFOPs sem regra</h3><div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>Sentido</th><th>CFOP</th><th class="num">Itens</th><th class="num">Valor</th><th>Exemplo</th></tr></thead><tbody>
      ${sr.map(x => `<tr><td>${x.sentido === 'saida' ? 'Saída' : 'Entrada'}</td><td><b>${esc(x.cfop)}</b></td><td class="num">${x.itens}</td><td class="num">${money(x.valor)}</td><td class="wrap">${esc(x.exemplo || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  $$('[data-ed]', root).forEach(b => b.onclick = () => editar(b.dataset.ed, root));
}

function editar(k, root) {
  const e = A.etapas.find(x => x.k === k), at = ETAP.find(x => x.etapa === k) || {};
  const m = modal({ title: e.nome, body: `
    <label>Responsável<input id="ie-r" maxlength="120" value="${esc(at.responsavel || '')}" placeholder="Quem faz este passo"></label>
    <label style="margin-top:8px">Data prevista<input type="date" id="ie-p" value="${at.prevista || ''}"></label>
    <label style="margin-top:8px">Observação<textarea id="ie-o" rows="3" maxlength="2000">${esc(at.observacao || '')}</textarea></label>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="ie-d" ${at.dispensada ? 'checked' : ''}> Este passo não se aplica a esta empresa</label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ie-ok">Salvar</button>' });
  $('#ie-ok', m.el).onclick = async () => {
    const reg = { empresa_id: state.empresa.id, etapa: k, responsavel: $('#ie-r', m.el).value.trim() || null, prevista: $('#ie-p', m.el).value || null,
      observacao: $('#ie-o', m.el).value.trim() || null, dispensada: $('#ie-d', m.el).checked, atualizado_em: new Date().toISOString() };
    try { await q(sb.from('est_implantacao_etapas').upsert(reg)); m.close(); toast('Passo atualizado'); render(root); } catch (err) { fail(err); }
  };
}

function metas(root) {
  const c = { ...K.CFG_PADRAO, ...(CFG || {}) };
  const m = modal({ title: 'Metas da implantação', body: `
    <p class="small muted" style="margin-top:0">Quando cada passo conta como concluído. Valores de 50 a 100%.</p>
    <div class="grid-form">
      <label>Cadastro: % do valor do espelho com produto<input type="number" id="mt-c" min="50" max="100" step="0.5" value="${c.meta_cadastro_pct}"></label>
      <label>De-para: % do valor das entradas com produto<input type="number" id="mt-e" min="50" max="100" step="0.5" value="${c.meta_entrada_pct}"></label>
      <label>Vendas: % do valor das saídas prontas<input type="number" id="mt-s" min="50" max="100" step="0.5" value="${c.meta_saida_pct}"></label>
      <label>Notas analisadas: últimos N meses (1 a 24)<input type="number" id="mt-j" min="1" max="24" value="${c.janela_meses}"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mt-ok">Salvar</button>' });
  $('#mt-ok', m.el).onclick = async () => {
    const v = { c: +$('#mt-c', m.el).value, e: +$('#mt-e', m.el).value, s: +$('#mt-s', m.el).value, j: +$('#mt-j', m.el).value };
    if (![v.c, v.e, v.s].every(x => x >= 50 && x <= 100)) return toast('Metas de 50 a 100%', true);
    if (!(v.j >= 1 && v.j <= 24)) return toast('Meses: de 1 a 24', true);
    try { await q(sb.from('est_implantacao_config').upsert({ empresa_id: state.empresa.id, meta_cadastro_pct: v.c, meta_entrada_pct: v.e, meta_saida_pct: v.s, janela_meses: v.j, atualizado_em: new Date().toISOString() }));
      m.close(); toast('Metas salvas'); render(root); } catch (err) { fail(err); }
  };
}

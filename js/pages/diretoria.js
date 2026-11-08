// Painéis › Painel da Diretoria (PAI007) — melhoria 2.4 (SQL 101, 07/11/2026). Uma página com caixa, faturamento, margem,
// produção, perdas, qualidade, entregas e recuperação judicial: valor do mês, meta, situação, comparação com o mês anterior
// e o mesmo mês do ano anterior, tendência de 13 meses e link para o detalhe. Comentário por indicador e PDF da reunião
// mensal no padrão oficial de relatório à Diretoria. Metas e parâmetros: administrador e diretor.
import { sb, state, q, montarMatriz, comRecompras, montarDRE, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, today, MESES } from '../lib/ui.js';
import { INDICADORES, IND, SIT, meses13, serieAnual, saldosFimMes, montarIndicadores, fmt, fmtVar, analise, itensDeliberacao } from '../lib/diretoria-calc.js';
import { codigoDa } from '../lib/telas.js';

export const title = 'Painel da Diretoria';
const FILTROS = { p_status: ['Pago'], p_conta: null, p_grupo: null, p_cc: null, p_favorecido: null, p_disp: null };
const ui = { ref: null };
let D = null;
const podeMetas = () => ['admin', 'diretor'].includes(state.papel);
const podeComentar = () => ['admin', 'diretor', 'financeiro'].includes(state.papel);
const nomeMes = (ym) => `${MESES[+ym.slice(5) - 1].toLowerCase()} de ${ym.slice(0, 4)}`;
const curto = (ym) => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+ym.slice(5) - 1] + '/' + ym.slice(2, 4);
const mesAnterior = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const fimDoMes = (ym) => { const [a, m] = ym.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };

async function matrizAno(ano) {
  const rows = await q(sb.rpc('resumo_mensal', { p_empresa: state.empresa.id, p_ano: ano, ...FILTROS }));
  return comRecompras(montarMatriz(rows.map(r => ({ plano_id: r.plano_id, mes: r.mes, total: +r.total }))), ano, null, FILTROS);
}

// também usado pelo bloco "Indicadores da diretoria" da Minha Manhã
export { mesAnterior };
export async function carregarPainel(ref) { return carregar(ref); }
async function carregar(ref) {
  const e = state.empresa.id, meses = meses13(ref), hoje = today().slice(0, 7);
  const anos = [...new Set([...meses.map(m => +m.slice(0, 4)), +hoje.slice(0, 4)])].filter(a => a <= +hoje.slice(0, 4)).sort();
  await loadCadastros();
  const seg = (p, v) => p.catch(() => v);
  const [mats, saldos, op, metasRows, cfg, coms] = await Promise.all([
    Promise.all(anos.map(a => matrizAno(a))),
    q(sb.rpc('saldos_contas', { p_empresa: e })),
    q(sb.rpc('diretoria_operacional', { p_empresa: e, p_ref: fimDoMes(ref) })),
    q(sb.from('diretoria_metas').select('*').eq('empresa_id', e)),
    seg(q(sb.from('diretoria_config').select('*').eq('empresa_id', e).maybeSingle()), null),
    q(sb.from('diretoria_comentarios').select('*').eq('empresa_id', e).eq('mes', ref + '-01')),
  ]);
  const porAno = (f) => Object.fromEntries(anos.map((a, i) => [a, f(mats[i], a)]));
  const dre = porAno((m) => montarDRE(m).val);
  const ger = porAno((m) => m.tipo.E.map((v, i) => v + m.tipo.S[i] + m.tipo.T[i]));
  // caixa: saldo das contas escolhidas hoje, voltando mês a mês pelo movimento pago
  const c = cfg || {};
  const contas = c.caixa_contas?.length ? saldos.filter(s => c.caixa_contas.includes(s.conta_id)) : saldos.filter(s => !/bloqueio/i.test(s.nome));
  const saldoHoje = contas.reduce((t, s) => t + +s.saldo_pago, 0);
  const geracao = serieAnual(meses, ger).map(v => v || 0);
  let posteriores = 0;
  for (let ym = ref; ym < hoje;) { const [a, m] = ym.split('-').map(Number); ym = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7); if (ym <= hoje) posteriores += (ger[+ym.slice(0, 4)] || [])[+ym.slice(5) - 1] || 0; }
  const fin = { caixa: saldosFimMes(saldoHoje, geracao, posteriores), receita: serieAnual(meses, porAno((m, a) => dre[a].receita_bruta)), ebitda: serieAnual(meses, porAno((m, a) => dre[a].ebitda)) };
  const metas = {}; for (const r of metasRows) (metas[r.indicador] ||= {})[r.ano] = +r.meta;
  const comentarios = Object.fromEntries(coms.map(x => [x.indicador, x.texto]));
  const comInfo = Object.fromEntries(coms.map(x => [x.indicador, x]));
  return { ref, meses, op, fin, metas, cfg: c, comentarios, comInfo, saldoHoje, contas, metasRows,
    inds: montarIndicadores({ meses, fin, op, metas, cfg: c, comentarios }) };
}

// gráfico pequeno de 13 meses, com a linha da meta tracejada
function sparkline(serie, metas, cor) {
  const W = 240, H = 46, P = 3, val = serie.map(v => v == null ? null : +v), todos = [...val, ...metas].filter(v => v != null);
  if (val.filter(v => v != null).length < 2) return '<div class="small muted" style="height:46px;display:flex;align-items:center">sem histórico suficiente</div>';
  const mn = Math.min(...todos), mx = Math.max(...todos), y = (v) => H - P - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * (H - 2 * P), x = (i) => P + i * (W - 2 * P) / (serie.length - 1);
  const pts = val.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');
  const meta = metas.some(m => m != null) ? `<polyline points="${metas.map((m, i) => m == null ? null : `${x(i).toFixed(1)},${y(m).toFixed(1)}`).filter(Boolean).join(' ')}" fill="none" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>` : '';
  const u = val.length - 1;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:46px;display:block">${meta}<polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/>${val[u] != null ? `<circle cx="${x(u)}" cy="${y(val[u])}" r="3" fill="${cor}"/>` : ''}</svg>`;
}

export async function render(root) {
  ui.ref ||= mesAnterior();
  const opcoes = Array.from({ length: 18 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); });
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Painel da Diretoria</h2><div class="muted small">Os indicadores da empresa em uma página: meta, situação, tendência de 13 meses e o caminho para o detalhe.</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><select id="dr-ref" title="Mês de referência" style="width:auto">${opcoes.map(m => `<option value="${m}" ${m === ui.ref ? 'selected' : ''}>${nomeMes(m)}${m === today().slice(0, 7) ? ' (parcial)' : ''}</option>`).join('')}</select>
      ${podeMetas() ? '<button class="btn" id="dr-par">Metas e parâmetros</button>' : ''}<button class="btn primary" id="dr-pdf">PDF da reunião</button></div></div>
    <div id="dr-corpo"><div class="loading">Carregando…</div></div>`;
  $('#dr-ref', root).onchange = (e) => { ui.ref = e.target.value; render(root); };
  $('#dr-par', root) && ($('#dr-par', root).onclick = () => parametros(() => render(root)));
  $('#dr-pdf', root).onclick = () => D && pdfReuniao(D);
  try { D = await carregar(ui.ref); }
  catch (err) { fail(err); $('#dr-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar o painel. Confira se o SQL 101 já foi executado.</div></div>'; return; }
  pintar(root);
}

function pintar(root) {
  const I = D.inds, n = (s) => I.filter(i => i.sit === s).length, semMeta = I.filter(i => i.meta == null).length;
  const parcial = D.ref === today().slice(0, 7);
  $('#dr-corpo', root).innerHTML = `
    <div class="card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <div style="font-size:1.05em"><b>${nomeMes(D.ref).replace(/^./, c => c.toUpperCase())}</b>${parcial ? ' <span class="badge aberto">mês em andamento</span>' : ''}</div>
      <span class="badge pago">${n('ok')} na meta</span><span class="badge aberto">${n('atencao')} em atenção</span><span class="badge vencido">${n('abaixo')} fora da meta</span>
      ${semMeta ? `<span class="small muted">${semMeta} sem meta${podeMetas() ? ' — defina em Metas e parâmetros' : ''}</span>` : ''}
    </div>
    <div id="dr-grade" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">${I.map(card).join('')}</div>
    <h3 style="margin:20px 0 6px">Evolução de 13 meses</h3>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>Indicador</th>${D.meses.map(m => `<th class="num">${curto(m)}</th>`).join('')}<th class="num">Meta</th></tr></thead><tbody>
      ${I.map(i => `<tr><td style="white-space:nowrap"><b>${esc(i.nome)}</b></td>${i.serie.map((v, k) => { const s = i.metas[k] != null && v != null ? (i.sentido === 'menor' ? v <= i.metas[k] : v >= i.metas[k]) : null;
        return `<td class="num ${s === false ? 'neg' : ''}" style="white-space:nowrap">${fmt(v, i.un)}</td>`; }).join('')}<td class="num" style="white-space:nowrap">${fmt(i.meta, i.un)}</td></tr>`).join('')}</tbody></table></div></div>
    <details class="small muted" style="margin-top:10px"><summary>Como cada indicador é calculado</summary><ul>${I.map(i => `<li><b>${esc(i.nome)}</b> — ${esc(i.regra)}</li>`).join('')}
      <li>Situação: na meta; em <b>atenção</b> até ${D.cfg.tolerancia_pct ?? 10}% de distância da meta (tolerância dos Parâmetros); fora da meta além disso. Tendência = média dos 3 últimos meses contra os 3 anteriores.</li>
      <li>Caixa de meses passados: saldo de hoje das contas escolhidas menos o movimento pago dos meses seguintes.</li></ul></details>`;
  $$('[data-com]', root).forEach(b => b.onclick = () => comentar(b.dataset.com, () => render(root)));
}

function card(i) {
  const s = i.sit ? SIT[i.sit] : null, cor = s ? s.cor : 'var(--primary)', com = D.comInfo[i.k];
  const tc = i.tend.k === 'melhora' ? 'pos' : i.tend.k === 'piora' ? 'neg' : 'muted';
  return `<div class="card" data-ind="${i.k}" style="border-top:3px solid ${cor};display:flex;flex-direction:column;gap:6px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><div><div class="small muted">${esc(i.area)}</div><b>${esc(i.nome)}</b></div>${s ? `<span class="badge ${s.cls}">${s.txt}</span>` : '<span class="badge">sem meta</span>'}</div>
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:1.7em;font-weight:700">${fmt(i.valor, i.un)}</span><span class="small muted">meta ${fmt(i.meta, i.un)}</span></div>
    <div class="small" style="display:flex;gap:12px;flex-wrap:wrap"><span title="sobre o mês anterior">mês ant. <b>${fmtVar(i.varMes)}</b></span><span title="sobre o mesmo mês do ano anterior">ano ant. <b>${fmtVar(i.varAno)}</b></span><span class="${tc}">${esc(i.tend.txt)}</span></div>
    ${sparkline(i.serie, i.metas, cor)}
    <div class="small muted">${esc(i.sub)}</div>
    ${com ? `<div class="small" style="background:var(--surface-2);border-radius:6px;padding:6px 8px"><b>Comentário:</b> ${esc(com.texto)}<div class="muted">${esc(com.autor || '')}</div></div>` : ''}
    <div style="display:flex;justify-content:space-between;margin-top:auto;padding-top:4px">${podeComentar() ? `<button class="btn ghost small" data-com="${i.k}">${com ? 'Editar comentário' : 'Comentar'}</button>` : '<span></span>'}
      <a class="btn ghost small" href="#/${i.rota}">Detalhe${codigoDa(i.rota) ? ` (${codigoDa(i.rota)})` : ''} →</a></div></div>`;
}

function comentar(k, depois) {
  const atual = D.comInfo[k];
  const m = modal({ title: `${IND[k].nome} — ${nomeMes(D.ref)}`, body: `<label>Comentário para a reunião<textarea id="cm-t" rows="5" maxlength="2000" placeholder="O que explica o resultado e o que está sendo feito">${esc(atual?.texto || '')}</textarea></label>
      <p class="small muted">Aparece no painel e no PDF da reunião, com o seu nome.</p>`,
    foot: `${atual ? '<button class="btn danger" id="cm-x" style="margin-right:auto">Apagar</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cm-ok">Salvar</button>` });
  $('#cm-ok', m.el).onclick = async () => {
    const t = $('#cm-t', m.el).value.trim(); if (!t) return toast('Escreva o comentário', true);
    try { await q(sb.from('diretoria_comentarios').upsert({ empresa_id: state.empresa.id, mes: D.ref + '-01', indicador: k, texto: t, autor: state.user?.email, atualizado_em: new Date().toISOString() })); m.close(); toast('Comentário salvo'); depois(); } catch (e) { fail(e); }
  };
  $('#cm-x', m.el) && ($('#cm-x', m.el).onclick = async () => { try { await q(sb.from('diretoria_comentarios').delete().eq('empresa_id', state.empresa.id).eq('mes', D.ref + '-01').eq('indicador', k)); m.close(); depois(); } catch (e) { fail(e); } });
}

// ---------------------------------------------------------------- metas e parâmetros
async function parametros(depois) {
  const e = state.empresa.id, ano0 = +ui.ref.slice(0, 4);
  let setores = [], c = D?.cfg || {};
  try { setores = await q(sb.from('prod_setores').select('id,nome').eq('empresa_id', e).eq('ativo', true).order('ordem')); } catch { /* sem produção */ }
  const cad = state.cad, planosS = cad.contasPlano.filter(p => p.tipo === 'S');
  const metaDe = (k, a) => D.metasRows.find(r => r.indicador === k && r.ano === a)?.meta ?? '';
  const chk = (cls, v, on, txt) => `<label class="chk" style="flex-direction:row;align-items:center;gap:6px;font-weight:400"><input type="checkbox" class="${cls}" value="${v}" style="width:auto;min-height:0" ${on ? 'checked' : ''}> ${esc(txt)}</label>`;
  const m = modal({ title: 'Metas e parâmetros do painel', wide: true, body: `
    <div style="display:flex;gap:12px;align-items:flex-end"><label>Metas do ano<select id="mp-ano">${[ano0 - 1, ano0, ano0 + 1].map(a => `<option ${a === ano0 ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <label>Tolerância para "atenção" (%)<input type="number" id="mp-tol" min="0" max="50" step="0.5" value="${c.tolerancia_pct ?? 10}"></label></div>
    <div class="table-wrap" style="margin-top:10px"><table style="table-layout:fixed;width:100%"><colgroup><col style="width:70px"><col><col style="width:150px"><col style="width:170px"></colgroup>
      <thead><tr><th>No painel</th><th>Indicador</th><th>Melhor quando</th><th>Meta mensal</th></tr></thead><tbody id="mp-metas">
      ${INDICADORES.map(i => `<tr><td>${chk('mp-vis', i.k, !(c.ocultos || []).includes(i.k), '')}</td><td class="wrap"><b>${esc(i.nome)}</b> <span class="small muted">(${i.un})</span><div class="small muted">${esc(i.regra)}</div></td><td>${i.sentido === 'maior' ? 'maior' : 'menor'}</td>
        <td><input type="number" step="any" data-meta="${i.k}" value="${metaDe(i.k, ano0)}" placeholder="${i.k === 'rj' ? 'usa o previsto' : i.k === 'entregas' ? 'usa a da logística' : 'sem meta'}" style="width:100%"></td></tr>`).join('')}</tbody></table></div>
    <h3 style="margin:16px 0 6px">Recuperação judicial</h3>
    <div class="grid-form"><label>Valor mensal previsto no plano (R$)<input type="number" step="0.01" id="mp-rjv" value="${c.rj_previsto ?? 0}"></label><label>1º mês de pagamento<input type="month" id="mp-rji" value="${c.rj_inicio ? String(c.rj_inicio).slice(0, 7) : ''}"></label><label>Nº do processo<input id="mp-rjp" value="${esc(c.rj_processo || '')}" placeholder="0000000-00.0000.0.00.0000"></label></div>
    <div class="small" style="margin:8px 0 4px">Contas do plano em que os pagamentos da RJ são lançados:</div>
    <input id="mp-rjb" placeholder="Filtrar contas" style="max-width:320px">
    <div id="mp-rjl" style="max-height:170px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 10px;margin-top:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:2px">
      ${planosS.map(p => `<div data-txt="${esc(p.label.toUpperCase())}">${chk('mp-rj', p.id, (c.rj_planos || []).includes(p.id), p.label)}</div>`).join('')}</div>
    <h3 style="margin:16px 0 6px">Produção e caixa</h3>
    <div class="small" style="margin-bottom:4px">Setores que contam na produção (nenhum marcado = todos; marque só o setor final para não somar a mesma bobina duas vezes):</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px 16px">${setores.map(s => chk('mp-set', s.id, (c.producao_setores || []).includes(s.id), s.nome)).join('') || '<span class="small muted">Nenhum setor cadastrado.</span>'}</div>
    <div class="small" style="margin:10px 0 4px">Contas do caixa disponível (nenhuma marcada = todas, menos bloqueio judicial):</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px 16px">${(cad.contas || []).map(x => chk('mp-cx', x.id, (c.caixa_contas || []).includes(x.id), x.nome)).join('')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mp-ok">Salvar</button>' });
  const pintaMetas = () => { const a = +$('#mp-ano', m.el).value; $$('[data-meta]', m.el).forEach(x => { x.value = metaDe(x.dataset.meta, a); }); };
  $('#mp-ano', m.el).onchange = pintaMetas;
  $('#mp-rjb', m.el).oninput = (ev) => { const t = ev.target.value.trim().toUpperCase(); $$('#mp-rjl [data-txt]', m.el).forEach(d => { d.hidden = t && !d.dataset.txt.includes(t); }); };
  $('#mp-ok', m.el).onclick = async () => {
    const ano = +$('#mp-ano', m.el).value, tol = +$('#mp-tol', m.el).value;
    if (!(tol >= 0 && tol <= 50)) return toast('Tolerância: de 0 a 50%', true);
    const marc = (cls) => $$(`.${cls}:checked`, m.el).map(x => x.value);
    const vis = marc('mp-vis'); if (!vis.length) return toast('Deixe ao menos um indicador no painel', true);
    const cfg = { empresa_id: e, tolerancia_pct: tol, rj_previsto: +$('#mp-rjv', m.el).value || 0, rj_processo: $('#mp-rjp', m.el).value.trim() || null, rj_inicio: $('#mp-rji', m.el).value ? $('#mp-rji', m.el).value + '-01' : null, rj_planos: marc('mp-rj'),
      producao_setores: marc('mp-set').length ? marc('mp-set') : null, caixa_contas: marc('mp-cx').length ? marc('mp-cx') : null,
      ocultos: INDICADORES.map(i => i.k).filter(k => !vis.includes(k)), atualizado_por: state.user?.email, atualizado_em: new Date().toISOString() };
    const grava = [], apaga = [];
    $$('[data-meta]', m.el).forEach(x => { const v = x.value.trim(); if (v === '') apaga.push(x.dataset.meta); else grava.push({ empresa_id: e, indicador: x.dataset.meta, ano, meta: +v, atualizado_por: state.user?.email, atualizado_em: new Date().toISOString() }); });
    try {
      await q(sb.from('diretoria_config').upsert(cfg));
      if (grava.length) await q(sb.from('diretoria_metas').upsert(grava));
      if (apaga.length) await q(sb.from('diretoria_metas').delete().eq('empresa_id', e).eq('ano', ano).in('indicador', apaga));
      m.close(); toast('Metas e parâmetros salvos'); depois();
    } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- PDF da reunião (padrão de relatório à Diretoria)
async function pdfReuniao(D) {
  const itens = itensDeliberacao(D.inds);
  const m = modal({ title: 'PDF da reunião mensal', body: `
      <label>Destinatário<input id="pr-dest" value="Diretoria"></label>
      <label style="margin-top:8px">Complementa (relatório anterior, se houver)<input id="pr-comp" value="Painel da Diretoria de ${nomeMes(D.meses[11])}"></label>
      <label style="margin-top:8px">Itens para a deliberação da Diretoria (um por linha)<textarea id="pr-del" rows="7">${esc([...itens, 'Aprovar o relatório de resultados do mês.'].join('\n'))}</textarea></label>
      <p class="small muted">Sugestão: um plano de ação para cada indicador fora da meta. O documento segue o padrão oficial de relatório à Diretoria (cabeçalho e rodapé corridos, seções e tabelas numeradas e deliberação com assinaturas).</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pr-ok">Gerar PDF</button>' });
  $('#pr-ok', m.el).onclick = async () => {
    const del = $('#pr-del', m.el).value.split('\n').map(s => s.trim()).filter(Boolean), dest = $('#pr-dest', m.el).value.trim() || 'Diretoria', comp = $('#pr-comp', m.el).value.trim() || '—';
    const janela = window.open('', '_blank'); if (!janela) return toast('Libere as janelas pop-up para gerar o PDF', true);
    m.close();
    try {
      const { htmlDiretoria, dataExtenso, cnpjFmt } = await import('../lib/relatorio-diretoria.js');
      const [emp, idt] = await Promise.all([q(sb.from('empresas').select('nome,razao_social,cnpj,logradouro,municipio,uf,cep').eq('id', state.empresa.id).single()),
        q(sb.from('empresa_identidade').select('razao_documentos').eq('empresa_id', state.empresa.id).maybeSingle()).catch(() => null)]);
      janela.document.write(htmlDiretoria(especificacao(D, { emp, idt, dest, comp, del, dataExtenso, cnpjFmt })));
      janela.document.close();
    } catch (e) { janela.close(); fail(e); }
  };
}

function especificacao(D, { emp, idt, dest, comp, del, dataExtenso, cnpjFmt }) {
  const I = D.inds, nm = nomeMes(D.ref), ok = I.filter(i => i.sit === 'ok').length, ab = I.filter(i => i.sit === 'abaixo');
  const end = [emp.logradouro, emp.municipio && emp.uf ? `${emp.municipio}/${emp.uf}` : emp.municipio, emp.cep ? `CEP ${String(emp.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : ''].filter(Boolean).join(', ');
  const nomeCurto = idt?.razao_documentos || emp.razao_social || emp.nome;
  const sitTxt = (i) => i.sit === 'ok' ? 'Na meta' : i.sit === 'atencao' ? 'Atenção' : i.sit === 'abaixo' ? '<b>Fora da meta</b>' : 'Sem meta';
  const rj = I.find(i => i.k === 'rj'), parcial = D.ref === today().slice(0, 7);
  const ultimos6 = D.meses.slice(-6);
  return {
    nome: 'Painel da Diretoria', arquivo: `Painel_Diretoria_${D.ref}`, rodape: 'Documento interno – para aprovação da Diretoria',
    empresa: { nome: nomeCurto, nomeOficial: emp.razao_social || nomeCurto, cnpj: cnpjFmt(emp.cnpj), endereco: end },
    ident: [['Destinatário', dest], ['Assunto', `Resultados de ${nm}: indicadores, metas e tendência`], ['Referência', 'Plataforma de gestão: lançamentos pagos, NF-e autorizadas, apontamentos da produção, não conformidades, cargas e entregas'],
      ['Complementa', comp], ['Emissão', dataExtenso()]],
    titulo: 'Painel da Diretoria', subtitulo: `Resultados de ${nm}${parcial ? ' (mês em andamento)' : ''}, com metas e tendência de 13 meses`,
    secoes: [
      { titulo: 'Objeto', blocos: [
        `Este relatório apresenta à Diretoria os indicadores de ${nm} da empresa: caixa, faturamento, margem, produção, perdas, qualidade, entregas e recuperação judicial, comparados com a meta do ano, com o mês anterior e com o mesmo mês do ano anterior.`,
        `No mês, <b>${ok} de ${I.length}</b> indicadores ficaram na meta${ab.length ? ` e <b>${ab.length}</b> ficaram fora: ${ab.map(i => i.nome.toLowerCase()).join(', ')}` : ''}.` ] },
      { titulo: 'Quadro de indicadores', blocos: [ { tabela: { titulo: `Indicadores de ${nm}`, cab: ['Indicador', 'Resultado', 'Meta', 'Situação', 'Mês anterior', 'Ano anterior', 'Tendência'],
        larg: ['22%', '13%', '12%', '12%', '13%', '13%', '15%'], dir: [1, 2, 4, 5],
        linhas: I.map(i => [`<b>${i.nome}</b>`, fmt(i.valor, i.un), fmt(i.meta, i.un), sitTxt(i), fmt(i.ant, i.un), fmt(i.anoAnt, i.un), i.tend.txt]),
        nota: `Situação: na meta; atenção até ${D.cfg.tolerancia_pct ?? 10}% de distância da meta; fora da meta além disso. Fonte: Painel da Diretoria (PAI007), levantado em ${new Date().toLocaleDateString('pt-BR')}.` } } ] },
      { titulo: 'Análise por indicador', blocos: I.map(i => analise(i, nm)) },
      { titulo: 'Evolução dos últimos 6 meses', blocos: [ { tabela: { titulo: 'Evolução mensal dos indicadores', cab: ['Indicador', ...ultimos6.map(curto)], dir: [1, 2, 3, 4, 5, 6], larg: ['22%', ...Array(6).fill('13%')],
        linhas: I.map(i => [i.nome, ...i.serie.slice(-6).map(v => fmt(v, i.un))]), nota: 'Valores do fim de cada mês (caixa) ou do mês inteiro (demais). A série de 13 meses está no painel.' } } ] },
      ...(rj ? [{ titulo: 'Recuperação judicial', blocos: [
        `Em ${nm} foram pagos <b>${fmt(rj.valor, 'R$')}</b> nas contas do plano de recuperação judicial${rj.meta ? `, contra o previsto de ${fmt(rj.meta, 'R$')} (${Math.round((rj.valor || 0) / rj.meta * 100)}%)` : ''}${D.cfg.rj_processo ? ` (processo nº ${esc(D.cfg.rj_processo)})` : ''}.`,
        `${rj.sub.charAt(0).toUpperCase() + rj.sub.slice(1)}.` ] }] : []),
      { titulo: 'Considerações', blocos: [
        `Os números foram levantados na plataforma em ${dataExtenso()}. Os indicadores financeiros seguem o regime de caixa (lançamentos pagos) e a DRE Gerencial; não substituem as demonstrações contábeis nem parecer contábil. O caixa de meses passados é reconstituído pelo saldo atual e pelo movimento pago dos meses seguintes.`,
        'Cada indicador tem a regra de cálculo descrita no painel ("Como cada indicador é calculado") e no manual da tela.' ] },
      { titulo: 'Fontes', blocos: [ { fontes: [...new Set(I.map(i => i.rota))].map(r => [`Plataforma de gestão – ${document.querySelector(`#nav a[data-route="${r}"]`)?.dataset.nome || r}${codigoDa(r) ? ` (${codigoDa(r)})` : ''}`, '']) } ] },
      { titulo: 'Deliberação da Diretoria', novaPagina: true, blocos: [ { deliberacao: { itens: del.length ? del.map(esc) : ['Aprovar o relatório de resultados do mês.'], assinaturas: ['Diretoria', 'Financeiro / Controladoria'] } } ] },
    ],
  };
}

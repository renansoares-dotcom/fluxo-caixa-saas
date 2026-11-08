// Contabilidade › Índices Financeiros (CTB010) — melhoria 9.4 (SQL 111, 08/11/2026).
// Liquidez, endividamento, ciclo de caixa e resultado (EBITDA) com a tendência de 12 meses, a partir do balancete
// da plataforma (um ponto por mês) ou dos balancetes da contabilidade (um ponto por balancete importado).
// Cada índice tem a faixa da empresa (confortável / atenção / crítico), a leitura em linguagem simples e o detalhe com
// os componentes. Relatório em PDF no padrão oficial, para a Diretoria ou para o Administrador Judicial.
// Parâmetros (contas de cada componente, faixas, fonte, meses): quem pode editar (administrador e financeiro).
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, money0, toast, fail, modal, exportXLSX, chart, CORES, today, MESES } from '../lib/ui.js';
import { fontes, itens, arvore, fimMes } from '../lib/contab.js';
import { drawer } from '../lib/componentes.js';
import * as K from '../lib/indices-calc.js';

export const title = 'Índices Financeiros';
const ui = { fonte: null, ref: null };
let C = null;      // config da empresa
let D = null;      // resultado montado
let CACHE = { chave: null, pontos: null };

const nomeMes = (ym) => `${MESES[+ym.slice(5) - 1].toLowerCase()} de ${ym.slice(0, 4)}`;
const curto = (ym) => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+ym.slice(5) - 1] + '/' + ym.slice(2, 4);
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5) + 1;
const COR_SIT = { ok: 'var(--pos)', atencao: 'var(--warn)', abaixo: 'var(--neg)' };
const BADGE = { ok: 'pago', atencao: 'aberto', abaixo: 'vencido' };

// componentes mostrados no detalhe de cada índice (* = fluxo de 12 meses)
const COMP = {
  lc: ['ac', 'pc'], ls: ['ac', 'estoques', 'pc'], li: ['disp', 'pc'], lg: ['ac', 'rlp', 'pc', 'pnc'], cgl: ['ac', 'pc'],
  eg: ['pc', 'pnc', 'ativo'], ce: ['pc', 'pnc'], pt: ['pc', 'pnc', 'pl'], dl: ['emprest', 'disp', '*ebitda'], cj: ['*ebitda', '*despfin'],
  pmr: ['clientes', '*rb'], pme: ['estoques', '*cmv'], pmp: ['fornec', '*cmv'], cc: ['clientes', 'estoques', 'fornec', '*rb', '*cmv'],
  ebitda: ['*lucro', '*despfin', '*recfin', '*naoop', '*ir', '*deprec'], me: ['*ebitda', '*rl'], ml: ['*lucro', '*rl'],
};
const rotComp = (c) => c.startsWith('*') ? ({ ebitda: 'EBITDA', lucro: 'Resultado do período', rl: 'Receita líquida' }[c.slice(1)] || K.GRUPOS_ROT[c.slice(1)][0]) + ' (12 meses)' : K.GRUPOS_ROT[c][0];
const valComp = (p, c) => { if (!c.startsWith('*')) return p.v[c]; const k = c.slice(1); return p.f.dias ? p.f[k] * 360 / p.f.dias : null; };

// ---------------------------------------------------------------- dados
async function carregarConfig() {
  try { C = await q(sb.from('indices_config').select('*').eq('empresa_id', state.empresa.id).maybeSingle()); }
  catch { C = null; }
  C = C || { fonte: 'plataforma', meses: 12, grupos: {}, faixas: {}, ocultos: [], _novo: true };
}

function acessor(A) {
  return { atu: (c) => A.g(c).atu || 0, mov: (c) => { const x = A.g(c); return (x.deb || 0) - (x.cred || 0); }, cred: (c) => A.g(c).cred || 0 };
}

// um ponto por mês da plataforma: saldo no fim do mês e movimento do mês
async function pontosPlataforma(f, G, n) {
  const hoje = today();
  const meses = [...f.meses].sort().slice(-n);
  return Promise.all(meses.map(async (m) => {
    const fim = fimMes(m) > hoje ? hoje : fimMes(m);
    const A = arvore(f.contas, await q(sb.rpc('contab_balancete_gerencial', { p_empresa: state.empresa.id, p_ini: `${m}-01`, p_fim: fim })), true);
    return { ref: m, ini: `${m}-01`, fim, dias: diasEntre(`${m}-01`, fim), parcial: fim < fimMes(m), v: K.extrair(acessor(A), G) };
  }));
}
// um ponto por balancete importado da contabilidade (o resultado é o do período do balancete)
async function pontosContabilidade(f, G, n) {
  const bals = [...f.bals].sort((a, b) => a.data_fim.localeCompare(b.data_fim)).slice(-n);
  return Promise.all(bals.map(async (b) => {
    const A = arvore(f.contas, await itens(`b:${b.id}`, f, true), false);
    return { ref: b.data_fim.slice(0, 7), ini: b.data_ini, fim: b.data_fim, dias: diasEntre(b.data_ini, b.data_fim), v: K.extrair(acessor(A), G) };
  }));
}

async function carregarPontos(f) {
  const G = K.grupos(C.grupos), meses = C.meses || 12;
  const chave = JSON.stringify([state.empresa.id, ui.fonte, G, meses]);
  if (CACHE.chave === chave) return CACHE.pontos;
  // na plataforma, para os fluxos de 12 meses do 1º ponto mostrado, são lidos mais 11 meses antes dele
  const pts = ui.fonte === 'contabilidade' ? await pontosContabilidade(f, G, meses + 1) : await pontosPlataforma(f, G, meses + 12);
  CACHE = { chave, pontos: pts };
  return pts;
}

// ---------------------------------------------------------------- tela
export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Índices Financeiros</h2><div class="muted small">Liquidez, endividamento, ciclo de caixa e geração operacional (EBITDA), com a tendência de 12 meses e a leitura em linguagem simples.</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <select id="ix-fonte" title="Fonte do balancete" style="width:auto"><option value="plataforma">Balancete da plataforma (mensal)</option><option value="contabilidade">Balancetes da contabilidade</option></select>
      <select id="ix-ref" title="Mês de referência" style="width:auto"></select>
      ${podeEditar() ? '<button class="btn" id="ix-par">Parâmetros</button>' : ''}
      <button class="btn" id="ix-xls">Exportar Excel</button><button class="btn primary" id="ix-pdf">Relatório PDF</button></div></div>
    <div id="ix-corpo"><div class="loading">Carregando…</div></div>`;
  try {
    await carregarConfig();
    ui.fonte ||= C.fonte || 'plataforma';
    $('#ix-fonte', root).value = ui.fonte;
    $('#ix-fonte', root).onchange = (e) => { ui.fonte = e.target.value; ui.ref = null; render(root); };
    $('#ix-par', root) && ($('#ix-par', root).onclick = () => parametros(root));
    const f = await fontes(true);
    const vazio = ui.fonte === 'contabilidade' ? !f.bals.length : !f.meses.length;
    if (vazio) {
      $('#ix-corpo', root).innerHTML = `<div class="card"><div class="empty">${ui.fonte === 'contabilidade' ? 'Nenhum balancete da contabilidade importado.' : 'Sem saldo de abertura e lançamentos contábeis da plataforma.'} Importe o balancete em <a href="#/contab/balancete">Contabilidade › Balancete</a>${ui.fonte === 'plataforma' && f.bals.length ? ' ou troque a fonte para "Balancetes da contabilidade"' : ''}.</div></div>`;
      ['#ix-ref', '#ix-xls', '#ix-pdf'].forEach(s => { const el = $(s, root); if (el) el.disabled = true; });
      return;
    }
    const pts = await carregarPontos(f);
    const refs = pts.map(p => p.ref);
    if (!refs.includes(ui.ref)) ui.ref = [...pts].reverse().find(p => !p.parcial)?.ref || refs[refs.length - 1];
    $('#ix-ref', root).innerHTML = [...pts].reverse().map(p => `<option value="${p.ref}" ${p.ref === ui.ref ? 'selected' : ''}>${nomeMes(p.ref)}${p.parcial ? ' (parcial)' : ''}</option>`).join('');
    $('#ix-ref', root).onchange = (e) => { ui.ref = e.target.value; montarEPintar(root, pts); };
    $('#ix-xls', root).onclick = () => D && exportar();
    $('#ix-pdf', root).onclick = () => D && relatorio();
    await montarEPintar(root, pts);
  } catch (e) { fail(e); $('#ix-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível calcular os índices. Confira se o SQL 111 já foi executado e se há balancete para o período.</div></div>'; }
}

async function montarEPintar(root, pts) {
  const ate = pts.filter(p => p.ref <= ui.ref);
  D = K.montar(ate, { meses: C.meses || 12, janela: ui.fonte === 'contabilidade' ? 'proprio' : 'acumular', faixasCfg: C.faixas, ocultos: C.ocultos || [] });
  D.ref = ui.ref;
  try { D.com = await q(sb.from('indices_comentarios').select('*').eq('empresa_id', state.empresa.id).eq('mes', ui.ref + '-01').maybeSingle()); } catch { D.com = null; }
  pintar(root);
}

function sparkline(i) {
  const W = 240, H = 44, P = 3, val = i.serie, ok = val.filter(v => v != null);
  if (ok.length < 2) return '<div class="small muted" style="height:44px;display:flex;align-items:center">sem histórico suficiente</div>';
  // escala pelos dados (com folga); a linha da faixa só aparece quando cai dentro do gráfico
  const d0 = Math.min(...ok), d1 = Math.max(...ok), folga = (d1 - d0) * 0.25 || Math.abs(d1) * 0.1 || 1;
  const mn = d0 - folga, mx = d1 + folga;
  const y = (v) => H - P - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * (H - 2 * P), x = (k) => P + k * (W - 2 * P) / (val.length - 1);
  const linha = (v, cor) => v == null || v < mn || v > mx ? '' : `<line x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${cor}" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>`;
  const pts = val.map((v, k) => v == null ? null : `${x(k).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(' ');
  const cor = COR_SIT[i.sit] || 'var(--primary)', u = val.length - 1;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:44px;display:block">${i.un !== 'R$' ? linha(i.faixa.bom, 'var(--pos)') + (i.faixa.atencao != null ? linha(i.faixa.atencao, 'var(--warn)') : '') : ''}<polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round"/>${val[u] != null ? `<circle cx="${x(u)}" cy="${y(val[u])}" r="3" fill="${cor}"/>` : ''}</svg>`;
}

function card(i) {
  const tc = i.tend.k === 'melhora' ? 'pos' : i.tend.k === 'piora' ? 'neg' : 'muted';
  const varAnt = i.valor != null && i.ant != null ? i.valor - i.ant : null;
  return `<div class="card ix-card" data-ix="${i.k}" tabindex="0" role="button" title="Ver o detalhe" style="border-top:3px solid ${COR_SIT[i.sit] || 'var(--border)'};display:flex;flex-direction:column;gap:5px;cursor:pointer">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>${esc(i.nome)}</b>${i.sit ? `<span class="badge ${BADGE[i.sit]}">${K.SIT[i.sit]}</span>` : '<span class="badge">não se aplica</span>'}</div>
    <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:1.6em;font-weight:700">${K.fmt(i.valor, i.un)}</span><span class="small muted">${esc(K.fmtFaixa(i, i.faixa))}</span></div>
    <div class="small" style="display:flex;gap:12px;flex-wrap:wrap"><span title="sobre o ponto anterior">ant. <b>${K.fmt(i.ant, i.un)}</b>${varAnt != null && i.un !== 'R$' ? ` (${varAnt >= 0 ? '+' : '−'}${K.fmt(Math.abs(varAnt), i.un)})` : ''}</span><span title="12 meses antes">12 meses antes <b>${K.fmt(i.a12, i.un)}</b></span><span class="${tc}">${esc(i.tend.txt)}</span></div>
    ${sparkline(i)}
    <div class="small">${esc(K.leitura(i, D.ult))}</div></div>`;
}

function pintar(root) {
  const R = K.resumo(D.inds), u = D.ult, parcial = u?.parcial;
  const av = u?.avisos?._parcial;
  const comp = (lbl, v) => `<div class="kpi"><div class="k-label">${lbl}</div><div class="k-value">${money0(v)}</div></div>`;
  const cc = D.inds.find(i => i.k === 'cc'), pmr = D.inds.find(i => i.k === 'pmr'), pme = D.inds.find(i => i.k === 'pme'), pmp = D.inds.find(i => i.k === 'pmp');
  const f12 = (k) => (u.f.dias ? u.f[k] * 360 / u.f.dias : 0);
  $('#ix-corpo', root).innerHTML = `
    <div class="card" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <div style="font-size:1.05em"><b>${nomeMes(D.ref).replace(/^./, c => c.toUpperCase())}</b>${parcial ? ' <span class="badge aberto">mês em andamento</span>' : ''}</div>
      <span class="badge pago">${R.ok} confortáveis</span><span class="badge aberto">${R.atencao} em atenção</span><span class="badge vencido">${R.abaixo} críticos</span>
      <span class="small muted">${ui.fonte === 'contabilidade' ? `balancete da contabilidade de ${new Date(u.ini + 'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(u.fim + 'T12:00:00').toLocaleDateString('pt-BR')}` : 'balancete da plataforma'}${av ? ` · ${esc(av)}` : ''}</span>
    </div>
    <div class="kpis" style="margin-bottom:12px">${comp('Ativo total', u.v.ativo)}${comp('Dívida total (circulante + não circulante)', u.v.pc + u.v.pnc)}${comp('Patrimônio líquido', u.v.pl)}${comp('Receita líquida (12 meses)', f12('rl'))}${comp('EBITDA (12 meses)', f12('ebitda'))}</div>
    ${K.GRUPOS_IND.map(([g, nome]) => { const l = D.inds.filter(i => i.g === g); return l.length ? `<h3 id="ix-g-${g}" style="margin:16px 0 6px;scroll-margin-top:84px">${nome}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px">${l.map(card).join('')}</div>
      ${g === 'ciclo' && cc && pmr?.valor != null && pme?.valor != null && pmp?.valor != null ? blocoCiclo(pmr.valor, pme.valor, pmp.valor) : ''}
      ${g === 'res' ? blocoPonte(u) : ''}` : ''; }).join('')}
    <h3 style="margin:20px 0 6px">Comentário da administração — ${nomeMes(D.ref)}</h3>
    <div class="card" id="ix-com" style="scroll-margin-top:120px">${D.com ? `<div style="white-space:pre-wrap">${esc(D.com.texto)}</div>` : '<div class="small muted">Sem comentário neste mês. O comentário vai para o relatório em PDF (Diretoria ou Administrador Judicial).</div>'}
      ${podeEditar() ? `<div style="margin-top:8px"><button class="btn ghost small" id="ix-com-ed">${D.com ? 'Editar comentário' : 'Escrever comentário'}</button></div>` : ''}</div>
    <h3 style="margin:20px 0 6px">Evolução</h3>
    <div class="card flush"><div class="table-wrap"><table class="small" id="ix-tab"><thead><tr><th>Índice</th>${D.pontos.map(p => `<th class="num">${curto(p.ref)}</th>`).join('')}<th>Faixa</th></tr></thead><tbody>
      ${D.inds.map(i => `<tr><td style="white-space:nowrap"><b>${esc(i.nome)}</b></td>${i.serie.map(v => { const s = K.situacao(v, i, i.faixa); return `<td class="num ${s === 'abaixo' ? 'neg' : ''}" style="white-space:nowrap">${K.fmt(v, i.un)}</td>`; }).join('')}<td class="small muted" style="white-space:nowrap">${esc(K.fmtFaixa(i, i.faixa))}</td></tr>`).join('')}</tbody></table></div></div>
    <details class="small muted" style="margin-top:10px"><summary>Como cada índice é calculado</summary><ul>${D.inds.map(i => `<li><b>${esc(i.nome)}</b> — ${esc(i.formula)}.</li>`).join('')}
      <li>Saldos de balanço: posição no fim do mês (ou do balancete). Resultado: na plataforma, soma dos 12 últimos meses (anualizado quando há menos); no balancete da contabilidade, o período do próprio balancete, anualizado. Dias = 360.</li>
      <li>O resultado do ano ainda não encerrado entra no patrimônio líquido, como no Balanço Patrimonial.</li>
      <li>EBITDA = resultado + despesas financeiras − receitas financeiras + resultado não operacional + IR e CSLL + depreciação (crédito do período na depreciação acumulada).</li>
      <li>Faixas: confortável, atenção e crítico, definidas pela empresa nos Parâmetros. Tendência = média dos 3 últimos pontos contra os 3 anteriores (±3% = estável).</li></ul></details>`;
  $$('[data-ix]', root).forEach(c => { c.onclick = () => detalhe(c.dataset.ix); c.onkeydown = (e) => { if (e.key === 'Enter') detalhe(c.dataset.ix); }; });
  $('#ix-com-ed', root) && ($('#ix-com-ed', root).onclick = () => comentar(root));
}

function blocoCiclo(pmr, pme, pmp) {
  const tot = Math.max(pmr + pme, pmp, 1), w = (v) => Math.max(0, v / tot * 100).toFixed(1);
  const cc = pmr + pme - pmp;
  return `<div class="card" id="ix-ciclo" style="margin-top:12px"><div class="small muted" style="margin-bottom:6px">Ciclo em dias: da compra do material ao recebimento da venda</div>
    <div style="display:flex;height:22px;border-radius:6px;overflow:hidden;font-size:.78em;color:#fff"><div style="width:${w(pme)}%;background:${CORES[2]};display:flex;align-items:center;padding-left:6px">estoque ${Math.round(pme)} d</div><div style="width:${w(pmr)}%;background:${CORES[0]};display:flex;align-items:center;padding-left:6px">recebimento ${Math.round(pmr)} d</div></div>
    <div style="display:flex;height:22px;border-radius:6px;overflow:hidden;font-size:.78em;color:#fff;margin-top:4px"><div style="width:${w(pmp)}%;background:${CORES[1]};display:flex;align-items:center;padding-left:6px">pagamento ${Math.round(pmp)} d</div></div>
    <div class="small" style="margin-top:6px">${cc > 0 ? `<b>${Math.round(cc)} dias</b> de operação financiados pela empresa (ciclo de caixa).` : `Os fornecedores financiam <b>${Math.round(-cc)} dias</b> da operação.`}</div></div>`;
}

function blocoPonte(u) {
  const a = (k) => (u.f.dias ? u.f[k] * 360 / u.f.dias : 0);
  const l = [['Resultado do período', a('lucro')], ['(+) Despesas financeiras', a('despfin')], ['(−) Receitas financeiras', -a('recfin')], ['(+) Resultado não operacional', a('naoop')], ['(+) IR e CSLL', a('ir')], ['(+) Depreciação', a('deprec')]];
  return `<div class="card flush" id="ix-ponte" style="margin-top:12px"><div class="table-wrap"><table class="small"><thead><tr><th>Do resultado ao EBITDA (12 meses)</th><th class="num">R$</th></tr></thead><tbody>
    ${l.map(([t, v]) => `<tr><td>${t}</td><td class="num">${money0(v)}</td></tr>`).join('')}
    <tr class="row-sec"><td><b>EBITDA</b></td><td class="num ${a('ebitda') >= 0 ? 'pos' : 'neg'}"><b>${money0(a('ebitda'))}</b></td></tr></tbody></table></div></div>`;
}

function detalhe(k) {
  const i = D.inds.find(x => x.k === k); if (!i) return;
  const comps = COMP[k] || [];
  const corpo = `<div class="small" style="margin-bottom:8px"><b>Fórmula:</b> ${esc(i.formula)}</div>
    <div style="margin-bottom:8px">${esc(K.leitura(i, D.ult))} <span class="muted">${esc(K.fraseSit(i))}</span></div>
    <div style="height:220px"><canvas id="ix-graf"></canvas></div>
    <div class="table-wrap" style="margin-top:10px"><table class="small"><thead><tr><th>Mês</th>${comps.map(c => `<th class="num">${esc(rotComp(c))}</th>`).join('')}<th class="num">${esc(i.nome)}</th></tr></thead><tbody>
      ${[...D.pontos].reverse().map(p => `<tr><td>${curto(p.ref)}</td>${comps.map(c => `<td class="num">${money0(valComp(p, c))}</td>`).join('')}<td class="num"><b>${K.fmt(p.x[k], i.un)}</b></td></tr>`).join('')}</tbody></table></div>
    <div class="small muted" style="margin-top:8px">Contas de cada componente: ${comps.map(c => c.replace('*', '')).filter((c, n, a) => a.indexOf(c) === n && K.GRUPOS_ROT[c]).map(c => `${esc(K.GRUPOS_ROT[c][0])} = ${esc((K.grupos(C.grupos)[c] || []).join(', ') || 'nenhuma')}`).join(' · ')}.${podeEditar() ? ' Ajuste em Parâmetros.' : ''}</div>`;
  const d = drawer({ titulo: i.nome, subtitulo: `${K.fmt(i.valor, i.un)} em ${nomeMes(D.ref)} · ${K.fmtFaixa(i, i.faixa)}`, corpo });
  const cv = d.el.querySelector('#ix-graf');
  const ds = [{ label: i.nome, data: i.serie, borderColor: CORES[0], backgroundColor: CORES[0], tension: 0.25, spanGaps: true }];
  if (i.un !== 'R$') {
    ds.push({ label: 'confortável', data: i.serie.map(() => i.faixa.bom), borderColor: CORES[3], borderDash: [4, 4], pointRadius: 0, borderWidth: 1 });
    if (i.faixa.atencao != null) ds.push({ label: 'mínimo (atenção)', data: i.serie.map(() => i.faixa.atencao), borderColor: CORES[4], borderDash: [4, 4], pointRadius: 0, borderWidth: 1 });
  }
  chart(cv, { type: 'line', data: { labels: D.pontos.map(p => curto(p.ref)), datasets: ds }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
}

function comentar(root) {
  const m = modal({ title: `Comentário da administração — ${nomeMes(D.ref)}`, body: `<label>O que explica os índices do mês e o que está sendo feito<textarea id="ixc-t" rows="7" maxlength="4000">${esc(D.com?.texto || '')}</textarea></label>
      <p class="small muted">Vai para o relatório em PDF, na seção "Comentário da administração".</p>`,
    foot: `${D.com ? '<button class="btn danger" id="ixc-x" style="margin-right:auto">Apagar</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ixc-ok">Salvar</button>` });
  $('#ixc-ok', m.el).onclick = async () => {
    const t = $('#ixc-t', m.el).value.trim(); if (!t) return toast('Escreva o comentário', true);
    try { await q(sb.from('indices_comentarios').upsert({ empresa_id: state.empresa.id, mes: D.ref + '-01', texto: t, atualizado_em: new Date().toISOString() })); m.close(); toast('Comentário salvo'); render(root); } catch (e) { fail(e); }
  };
  $('#ixc-x', m.el) && ($('#ixc-x', m.el).onclick = async () => { try { await q(sb.from('indices_comentarios').delete().eq('empresa_id', state.empresa.id).eq('mes', D.ref + '-01')); m.close(); render(root); } catch (e) { fail(e); } });
}

function exportar() {
  const rows = [['Índice', ...D.pontos.map(p => p.ref), 'Fórmula']];
  for (const i of D.inds) rows.push([i.nome + (i.un !== 'x' ? ` (${i.un})` : ''), ...i.serie.map(v => v), i.formula]);
  rows.push([]); rows.push(['Componente (R$)', ...D.pontos.map(p => p.ref)]);
  for (const c of Object.keys(K.GRUPOS_ROT)) rows.push([K.GRUPOS_ROT[c][0] + (K.GRUPOS_ROT[c][1] === 'resultado' ? ' (12 meses)' : ''), ...D.pontos.map(p => Math.round((K.GRUPOS_ROT[c][1] === 'resultado' ? valComp(p, '*' + c) : p.v[c]) * 100) / 100)]);
  rows.push(['EBITDA (12 meses)', ...D.pontos.map(p => Math.round(valComp(p, '*ebitda') * 100) / 100)]);
  exportXLSX(rows, `indices_financeiros_${D.ref}`);
}

// ---------------------------------------------------------------- parâmetros
async function parametros(root) {
  const f = await fontes();
  const G = K.grupos(C.grupos), FX = K.faixas(C.faixas), byCls = new Map(f.contas.map(c => [c.classificacao, c.descricao]));
  const desc = (lista) => lista.map(c => byCls.get(c) ? `${c} ${byCls.get(c)}` : `${c} (não encontrada)`).join(' · ') || 'nenhuma conta';
  const m = modal({ title: 'Parâmetros dos índices financeiros', wide: true, body: `
    <div class="grid-form"><label>Fonte padrão<select id="ip-fonte"><option value="plataforma">Balancete da plataforma (mensal)</option><option value="contabilidade">Balancetes da contabilidade</option></select></label>
      <label>Pontos da tendência (6 a 24)<input type="number" id="ip-meses" min="6" max="24" value="${C.meses || 12}"></label></div>
    <h3 style="margin:14px 0 4px">Contas de cada componente</h3>
    <p class="small muted" style="margin:0 0 6px">Classificações do plano contábil, separadas por vírgula. Cada uma soma a conta com todas as contas abaixo dela. Depreciação: crédito do período na conta de depreciação acumulada.</p>
    <div class="table-wrap"><table class="small" style="table-layout:fixed;width:100%"><colgroup><col style="width:220px"><col style="width:200px"><col></colgroup><thead><tr><th>Componente</th><th>Classificações</th><th>Contas encontradas</th></tr></thead><tbody>
      ${Object.entries(K.GRUPOS_ROT).map(([k, [nome, tipo]]) => `<tr><td><b>${esc(nome)}</b> <span class="muted">(${tipo})</span></td><td><input data-g="${k}" value="${esc(G[k].join(', '))}" placeholder="${esc(K.GRUPOS_PADRAO[k].join(', ') || 'nenhuma')}" style="width:100%"></td><td class="wrap muted" data-gd="${k}">${esc(desc(G[k]))}</td></tr>`).join('')}</tbody></table></div>
    <h3 style="margin:14px 0 4px">Faixas de cada índice</h3>
    <p class="small muted" style="margin:0 0 6px">Confortável a partir de (ou até) o primeiro valor; atenção até o segundo; além disso, crítico. Desmarque para esconder o índice da tela e do relatório.</p>
    <div class="table-wrap"><table class="small" style="table-layout:fixed;width:100%"><colgroup><col style="width:56px"><col><col style="width:110px"><col style="width:130px"><col style="width:130px"></colgroup><thead><tr><th>Mostrar</th><th>Índice</th><th>Melhor quando</th><th>Confortável</th><th>Atenção</th></tr></thead><tbody>
      ${K.INDICES.map(i => `<tr><td><input type="checkbox" class="ip-vis" value="${i.k}" style="width:auto;min-height:0" ${(C.ocultos || []).includes(i.k) ? '' : 'checked'}></td><td class="wrap"><b>${esc(i.nome)}</b> <span class="muted">(${esc(i.un)})</span></td><td>${i.sentido}</td>
        <td><input type="number" step="any" data-fb="${i.k}" value="${FX[i.k].bom}" style="width:100%"></td><td>${i.atencao == null ? '<span class="muted">—</span>' : `<input type="number" step="any" data-fa="${i.k}" value="${FX[i.k].atencao}" style="width:100%">`}</td></tr>`).join('')}</tbody></table></div>`,
    foot: '<button class="btn" id="ip-pad" style="margin-right:auto">Voltar ao padrão</button><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ip-ok">Salvar</button>' });
  $('#ip-fonte', m.el).value = C.fonte || 'plataforma';
  const lista = (s) => s.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  $$('[data-g]', m.el).forEach(inp => { inp.oninput = () => { $(`[data-gd="${inp.dataset.g}"]`, m.el).textContent = desc(lista(inp.value)); }; });
  $('#ip-pad', m.el).onclick = () => {
    $$('[data-g]', m.el).forEach(inp => { inp.value = K.GRUPOS_PADRAO[inp.dataset.g].join(', '); inp.oninput(); });
    K.INDICES.forEach(i => { $(`[data-fb="${i.k}"]`, m.el).value = i.bom; const a = $(`[data-fa="${i.k}"]`, m.el); if (a) a.value = i.atencao; });
    $$('.ip-vis', m.el).forEach(x => { x.checked = true; });
  };
  $('#ip-ok', m.el).onclick = async () => {
    const meses = +$('#ip-meses', m.el).value;
    if (!(meses >= 6 && meses <= 24)) return toast('Pontos da tendência: de 6 a 24', true);
    const grupos = {}, faixas = {};
    $$('[data-g]', m.el).forEach(inp => { const l = lista(inp.value); if (JSON.stringify(l) !== JSON.stringify(K.GRUPOS_PADRAO[inp.dataset.g])) grupos[inp.dataset.g] = l; });
    for (const i of K.INDICES) {
      const b = $(`[data-fb="${i.k}"]`, m.el).value, a = $(`[data-fa="${i.k}"]`, m.el)?.value;
      if (b === '' || !isFinite(+b)) return toast(`Informe a faixa confortável de ${i.nome}`, true);
      if (a != null && a !== '') {
        if (i.sentido === 'maior' ? +a > +b : +a < +b) return toast(`${i.nome}: o limite de atenção deve ficar ${i.sentido === 'maior' ? 'abaixo' : 'acima'} do confortável`, true);
      }
      if (+b !== i.bom || (a != null && a !== '' && +a !== i.atencao)) faixas[i.k] = { bom: +b, ...(a != null && a !== '' ? { atencao: +a } : {}) };
    }
    const vis = $$('.ip-vis:checked', m.el).map(x => x.value); if (!vis.length) return toast('Deixe ao menos um índice visível', true);
    const reg = { empresa_id: state.empresa.id, fonte: $('#ip-fonte', m.el).value, meses, grupos, faixas, ocultos: K.INDICES.map(i => i.k).filter(k => !vis.includes(k)), atualizado_em: new Date().toISOString() };
    try { await q(sb.from('indices_config').upsert(reg)); m.close(); toast('Parâmetros salvos'); CACHE.chave = null; ui.fonte = null; render(root); } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- relatório (padrão oficial)
async function relatorio() {
  const e = state.empresa.id;
  let dir = null; try { dir = await q(sb.from('diretoria_config').select('rj_processo').eq('empresa_id', e).maybeSingle()); } catch { /* sem SQL 101 */ }
  const criticos = D.inds.filter(i => i.sit === 'abaixo');
  const m = modal({ title: 'Relatório dos índices financeiros', body: `
    <label>Destinatário<select id="ir-dest"><option value="dir">Diretoria</option><option value="aj">Administrador Judicial</option></select></label>
    <div id="ir-aj" hidden style="margin-top:8px"><label>Nome do Administrador Judicial<input id="ir-ajn" placeholder="Nome ou escritório"></label>
      <label style="margin-top:8px">Nº do processo de recuperação judicial<input id="ir-proc" value="${esc(dir?.rj_processo || '')}" placeholder="0000000-00.0000.0.00.0000"></label></div>
    <label style="margin-top:8px">Complementa (relatório anterior, se houver)<input id="ir-comp" placeholder="—"></label>
    <div id="ir-deldiv"><label style="margin-top:8px">Itens para a deliberação da Diretoria (um por linha)<textarea id="ir-del" rows="5">${esc([...criticos.map(i => `Aprovar plano de ação para ${i.nome.toLowerCase()} (${K.fmt(i.valor, i.un)}; faixa ${K.fmtFaixa(i, i.faixa)}).`), 'Aprovar o relatório dos índices financeiros do mês.'].join('\n'))}</textarea></label></div>
    <p class="small muted">Segue o padrão oficial de relatório (cabeçalho e rodapé corridos, seções, parágrafos e tabelas numerados). Para o Administrador Judicial sai sem a deliberação, com a assinatura dos responsáveis pelas informações.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ir-ok">Gerar PDF</button>' });
  $('#ir-dest', m.el).onchange = (ev) => { const aj = ev.target.value === 'aj'; $('#ir-aj', m.el).hidden = !aj; $('#ir-deldiv', m.el).hidden = aj; };
  $('#ir-ok', m.el).onclick = async () => {
    const aj = $('#ir-dest', m.el).value === 'aj';
    const op = { aj, ajNome: $('#ir-ajn', m.el).value.trim(), proc: $('#ir-proc', m.el).value.trim(), comp: $('#ir-comp', m.el).value.trim() || '—',
      del: $('#ir-del', m.el).value.split('\n').map(s => s.trim()).filter(Boolean) };
    const janela = window.open('', '_blank'); if (!janela) return toast('Libere as janelas pop-up para gerar o PDF', true);
    m.close();
    try {
      const { htmlDiretoria, dataExtenso, cnpjFmt } = await import('../lib/relatorio-diretoria.js');
      const [emp, idt] = await Promise.all([q(sb.from('empresas').select('nome,razao_social,cnpj,logradouro,municipio,uf,cep').eq('id', e).single()),
        q(sb.from('empresa_identidade').select('razao_documentos').eq('empresa_id', e).maybeSingle()).catch(() => null)]);
      janela.document.write(htmlDiretoria(especificacao({ emp, idt, op, dataExtenso, cnpjFmt })));
      janela.document.close();
    } catch (err) { janela.close(); fail(err); }
  };
}

export function especificacao({ emp, idt, op, dataExtenso, cnpjFmt }) {
  const I = D.inds, u = D.ult, nm = nomeMes(D.ref), R = K.resumo(I);
  const end = [emp.logradouro, emp.municipio && emp.uf ? `${emp.municipio}/${emp.uf}` : emp.municipio, emp.cep ? `CEP ${String(emp.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : ''].filter(Boolean).join(', ');
  const nomeCurto = idt?.razao_documentos || emp.razao_social || emp.nome;
  const sitTxt = (i) => (i.sit === 'abaixo' ? '<b>Crítico</b>' : i.sit ? K.SIT[i.sit] : 'Não se aplica');
  const ult6 = D.pontos.slice(-6);
  const a = (k) => (u.f.dias ? u.f[k] * 360 / u.f.dias : 0);
  const fonteTxt = ui.fonte === 'contabilidade' ? `balancete da contabilidade de ${new Date(u.ini + 'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(u.fim + 'T12:00:00').toLocaleDateString('pt-BR')}` : 'balancete mensal elaborado pela plataforma a partir do saldo de abertura e dos lançamentos contábeis gerados';
  const nome = 'Índices Financeiros', dest = op.aj ? `Administrador Judicial${op.ajNome ? ` – ${op.ajNome}` : ''}` : 'Diretoria';
  const secoes = [
    { titulo: 'Objeto', blocos: [
      `Este relatório apresenta ${op.aj ? 'ao Administrador Judicial' : 'à Diretoria'} os índices financeiros da empresa em ${nm}${u.parcial ? ' (mês em andamento)' : ''}: liquidez, endividamento, ciclo de caixa e geração operacional de caixa (EBITDA), com a evolução dos últimos ${D.pontos.length} ${D.pontos.length === 1 ? 'ponto' : 'pontos'}${op.aj && op.proc ? `, para acompanhamento do processo de recuperação judicial nº ${op.proc}` : ''}.`,
      `Dos ${I.length} índices acompanhados, <b>${R.ok}</b> estão na faixa confortável, <b>${R.atencao}</b> em atenção e <b>${R.abaixo}</b> em situação crítica${R.criticos.length ? `: ${R.criticos.map(s => s.toLowerCase()).join(', ')}` : ''}. As faixas são definidas pela própria empresa.` ] },
    { titulo: 'Posição patrimonial e resultado', blocos: [ { tabela: { titulo: `Componentes em ${nm}`, cab: ['Componente', 'Valor (R$)'], dir: [1], larg: ['70%', '30%'],
      linhas: [['Ativo circulante', u.v.ac], ['Realizável a longo prazo', u.v.rlp], ['Ativo total', u.v.ativo], ['Passivo circulante', u.v.pc], ['Passivo não circulante', u.v.pnc], ['Patrimônio líquido', u.v.pl],
        ['Receita líquida (12 meses)', a('rl')], ['Resultado do período (12 meses)', a('lucro')], ['EBITDA (12 meses)', a('ebitda')]].map(([t, v]) => [t, money0(v)]),
      nota: `Fonte: ${fonteTxt}. Resultado de 12 meses ${u.f.n < 12 && ui.fonte !== 'contabilidade' ? `anualizado a partir de ${u.f.n} ${u.f.n === 1 ? 'mês' : 'meses'}` : ui.fonte === 'contabilidade' ? 'anualizado a partir do período do balancete' : 'somado mês a mês'}.` } } ] },
    { titulo: 'Quadro de índices', blocos: [ { tabela: { titulo: `Índices financeiros de ${nm}`, cab: ['Índice', 'Resultado', 'Faixa da empresa', 'Situação', 'Ponto anterior', '12 meses antes', 'Tendência'],
      larg: ['20%', '11%', '21%', '10%', '11%', '11%', '16%'], dir: [1, 4, 5],
      linhas: I.map(i => [`<b>${i.nome}</b>`, K.fmt(i.valor, i.un), K.fmtFaixa(i, i.faixa), sitTxt(i), K.fmt(i.ant, i.un), K.fmt(i.a12, i.un), i.tend.txt]),
      nota: 'Situação: confortável; atenção entre a faixa confortável e a mínima; crítico além da mínima. Tendência: média dos 3 últimos pontos contra os 3 anteriores.' } } ] },
    ...K.GRUPOS_IND.map(([g, t]) => ({ g, t, l: I.filter(i => i.g === g) })).filter(x => x.l.length).map(x => ({ titulo: `Leitura: ${x.t.toLowerCase()}`,
      blocos: x.l.map(i => `<b>${i.nome}: ${K.fmt(i.valor, i.un)}.</b> ${K.leitura(i, u)} ${K.fraseSit(i)}`) })),
    { titulo: 'Evolução', blocos: [ { tabela: { titulo: 'Evolução dos índices', cab: ['Índice', ...ult6.map(p => curto(p.ref))], dir: ult6.map((_, k) => k + 1), larg: ['28%', ...ult6.map(() => `${(72 / ult6.length).toFixed(1)}%`)],
      linhas: I.map(i => [i.nome, ...ult6.map(p => K.fmt(p.x[i.k], i.un))]), nota: `Últimos ${ult6.length} pontos; a série completa está na tela Índices Financeiros (CTB010).` } } ] },
    ...(D.com ? [{ titulo: 'Comentário da administração', blocos: D.com.texto.split(/\n+/).map(s => esc(s.trim())).filter(Boolean) }] : []),
    { titulo: 'Metodologia e considerações', blocos: [
      `Os índices foram calculados em ${dataExtenso()} a partir do ${fonteTxt}. Saldos de balanço são a posição no fim do período; o resultado do ano ainda não encerrado integra o patrimônio líquido, como no Balanço Patrimonial.`,
      'Fórmulas utilizadas:', { itens: I.map(i => `${i.nome}: ${i.formula}`) },
      'O EBITDA corresponde ao resultado antes das despesas e receitas financeiras, do resultado não operacional, do imposto de renda e da contribuição social sobre o lucro e da depreciação. Os prazos médios usam o ano de 360 dias; títulos cedidos a fundos de recebíveis (FIDC) deixam a carteira de clientes e reduzem o prazo médio de recebimento.',
      'Este relatório é gerencial e não substitui as demonstrações contábeis assinadas pelo contador responsável nem parecer de auditoria.' ] },
    { titulo: 'Fontes', blocos: [ { fontes: [[`Plataforma de gestão – Índices Financeiros (CTB010), ${ui.fonte === 'contabilidade' ? 'balancetes importados da contabilidade' : 'balancete da plataforma'}`, ''], ['Plataforma de gestão – Balanço Patrimonial (CTB003) e DRE Contábil (CTB004)', '']] } ] },
  ];
  secoes.push(op.aj
    ? { titulo: 'Responsáveis pelas informações', novaPagina: false, blocos: [ { assinaturas: ['Diretoria', 'Financeiro / Controladoria'] } ] }
    : { titulo: 'Deliberação da Diretoria', novaPagina: true, blocos: [ { deliberacao: { itens: op.del.length ? op.del.map(esc) : ['Aprovar o relatório dos índices financeiros do mês.'], assinaturas: ['Diretoria', 'Financeiro / Controladoria'] } } ] });
  return {
    nome, arquivo: `Indices_Financeiros_${D.ref}`, rodape: op.aj ? 'Documento informativo – Administrador Judicial' : 'Documento interno – para aprovação da Diretoria',
    empresa: { nome: nomeCurto, nomeOficial: emp.razao_social || nomeCurto, cnpj: cnpjFmt(emp.cnpj), endereco: end },
    ident: [['Destinatário', dest], ['Assunto', `Índices financeiros de ${nm}: liquidez, endividamento, ciclo de caixa e EBITDA`],
      ...(op.aj && op.proc ? [['Processo', `Recuperação judicial nº ${op.proc}`]] : []),
      ['Referência', ui.fonte === 'contabilidade' ? 'Balancetes da contabilidade' : 'Balancete da plataforma'], ['Complementa', op.comp], ['Emissão', dataExtenso()]],
    titulo: 'Índices Financeiros', subtitulo: `Posição de ${nm}, com a evolução de ${D.pontos.length} ${D.pontos.length === 1 ? 'ponto' : 'pontos'}`,
    secoes,
  };
}

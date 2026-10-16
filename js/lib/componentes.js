// Biblioteca de componentes de painel (inspirada no dtv-components do ERP Consultoria, refeita no padrão desta plataforma).
// Regra: componente é puro — recebe dado + configuração e desenha. Nenhum componente busca dado no banco.
import { esc, money0, pct } from './ui.js';

// ------------------------------------------------------------ tendência
// trend(variacao, { bomSeSobe = true, casas = 1 }) -> "▲ 12,3%" verde/vermelho conforme o que é bom para o indicador
export function trend(v, { bomSeSobe = true, casas = 1, sufixo = '' } = {}) {
  if (v == null || !isFinite(v) || Math.abs(v) < 0.0005) return `<span class="cp-trend neutro">= ${sufixo || 'estável'}</span>`;
  const bom = (v > 0) === bomSeSobe;
  return `<span class="cp-trend ${bom ? 'bom' : 'ruim'}">${v > 0 ? '▲' : '▼'} ${pct(Math.abs(v), casas)}${sufixo ? ' ' + esc(sufixo) : ''}</span>`;
}
export const variacao = (atual, anterior) => (anterior ? (atual - anterior) / Math.abs(anterior) : null);

// ------------------------------------------------------------ KPI
// kpiCard({ id, label, valor, sub, tom: 'pos'|'neg'|'warn'|'', trendHtml, clicavel })
export function kpiCard(k) {
  return `<div class="kpi cp-kpi ${k.clicavel ? 'clickable' : ''}" ${k.id ? `data-kpi="${esc(k.id)}"` : ''}>
    <div class="k-label">${esc(k.label)}</div>
    <div class="k-value ${k.tom || ''}">${esc(k.valor)}</div>
    ${k.trendHtml || k.sub ? `<div class="k-sub">${k.trendHtml || ''}${k.trendHtml && k.sub ? ' · ' : ''}${esc(k.sub || '')}</div>` : ''}</div>`;
}
// kpiGrid(el, kpis, onClick(id)) — desenha a grade e liga o clique (um listener só, mesmo redesenhando)
export function kpiGrid(el, kpis, onClick) {
  el.classList.add('kpis');
  el.innerHTML = kpis.map(kpiCard).join('');
  el._cpClick = onClick;
  if (!el._cpLigado) { el._cpLigado = true; el.addEventListener('click', (e) => { const c = e.target.closest('[data-kpi]'); if (c && el._cpClick) el._cpClick(c.dataset.kpi); }); }
}

// ------------------------------------------------------------ drawer (painel lateral)
// drawer({ titulo, subtitulo, corpo: html|Node, acoes: [{ label, primary, onClick(close) }] }) -> { el, close, corpo(htmlOuNode) }
export function drawer({ titulo, subtitulo = '', corpo = '', acoes = [] }) {
  document.querySelector('.cp-drawer-back')?.remove();
  const back = document.createElement('div'); back.className = 'cp-drawer-back';
  back.innerHTML = `<aside class="cp-drawer" role="dialog" aria-label="${esc(titulo)}">
    <div class="cp-drawer-head"><div><div class="cp-drawer-tit">${esc(titulo)}</div>${subtitulo ? `<div class="cp-drawer-sub">${esc(subtitulo)}</div>` : ''}</div>
      <button class="btn ghost icon" data-close aria-label="Fechar">✕</button></div>
    <div class="cp-drawer-body"></div>${acoes.length ? '<div class="cp-drawer-foot"></div>' : ''}</aside>`;
  const body = back.querySelector('.cp-drawer-body');
  const setCorpo = (c) => { body.innerHTML = ''; typeof c === 'string' ? body.innerHTML = c : body.appendChild(c); };
  setCorpo(corpo);
  const close = () => { back.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  const foot = back.querySelector('.cp-drawer-foot');
  for (const a of acoes) { const b = document.createElement('button'); b.className = `btn ${a.primary ? 'primary' : 'ghost'}`; b.textContent = a.label; b.onclick = () => a.onClick(close); foot.appendChild(b); }
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add('aberto'));
  return { el: back, close, corpo: setCorpo };
}

// ------------------------------------------------------------ composição (lista de valores dentro do drawer)
// composicao([{ nome, valor, sub, onClick }], { total: true, pctDe }) -> Node
export function composicao(itens, { total = false, rotuloTotal = 'Total', pctDe = null } = {}) {
  const el = document.createElement('div'); el.className = 'cp-comp';
  const mesmoSinal = itens.every(x => x.valor >= 0) || itens.every(x => x.valor <= 0);   // % só faz sentido sem sinais misturados
  const base = pctDe ?? (mesmoSinal ? itens.reduce((t, x) => t + Math.abs(x.valor), 0) : 0);
  el.innerHTML = itens.map((x, i) => `<div class="cp-comp-linha ${x.onClick ? 'clickable' : ''}" data-i="${i}">
      <div><div>${esc(x.nome)}</div>${x.sub ? `<div class="small muted">${esc(x.sub)}</div>` : ''}</div>
      <div class="num ${x.valor < 0 ? 'neg' : ''}">${money0(x.valor)}${base ? `<div class="small muted">${pct(Math.abs(x.valor) / base)}</div>` : ''}</div></div>`).join('')
    + (total ? `<div class="cp-comp-linha cp-comp-total"><div>${esc(rotuloTotal)}</div><div class="num">${money0(itens.reduce((t, x) => t + x.valor, 0))}</div></div>` : '')
    || '<div class="empty">Nada para mostrar.</div>';
  el.addEventListener('click', (e) => { const l = e.target.closest('[data-i]'); const it = l && itens[+l.dataset.i]; if (it?.onClick) it.onClick(); });
  return el;
}

// ------------------------------------------------------------ lista de barras
// barList(el, [{ nome, valor, txt, sub, onClick }], { cor }) — barras horizontais proporcionais ao maior valor
export function barList(el, itens, { vazio = 'Sem dados no período.' } = {}) {
  if (!itens.length) { el.innerHTML = `<div class="empty">${esc(vazio)}</div>`; return; }
  const max = Math.max(...itens.map(x => Math.abs(x.valor)), 1);
  el.innerHTML = itens.map((x, i) => `<div class="cp-bar ${x.onClick ? 'clickable' : ''}" data-i="${i}">
      <div class="cp-bar-topo"><span class="cp-bar-nome">${esc(x.nome)}</span><span class="num">${esc(x.txt ?? money0(x.valor))}</span></div>
      <div class="cp-bar-trilho"><div class="cp-bar-fill" style="width:${(Math.abs(x.valor) / max * 100).toFixed(1)}%;background:var(--c${(x.cor ?? i) % 8 + 1})"></div></div>
      ${x.sub ? `<div class="small muted">${esc(x.sub)}</div>` : ''}</div>`).join('');
  el.onclick = (e) => { const l = e.target.closest('[data-i]'); const it = l && itens[+l.dataset.i]; if (it?.onClick) it.onClick(); };
}

// ------------------------------------------------------------ score 0–100
// calcScore(fatores [{ nota 0-100, peso }]) -> nota ponderada (fatores sem nota são ignorados)
export function calcScore(fatores) {
  const v = fatores.filter(f => f.nota != null && isFinite(f.nota)); const p = v.reduce((t, f) => t + (f.peso ?? 1), 0);
  return p ? Math.round(Math.max(0, Math.min(100, v.reduce((t, f) => t + f.nota * (f.peso ?? 1), 0) / p))) : null;
}
// faixa(valor, pior, melhor) -> 0..100 linear entre o pior e o melhor valor (funciona nos dois sentidos)
export const faixa = (v, pior, melhor) => (v == null || !isFinite(v)) ? null : Math.round(Math.max(0, Math.min(1, (v - pior) / (melhor - pior))) * 100);
export const tomScore = (n) => n == null ? '' : n >= 80 ? 'excelente' : n >= 60 ? 'boa' : n >= 40 ? 'atencao' : 'critica';
const TOM_TXT = { excelente: 'Excelente', boa: 'Boa', atencao: 'Atenção', critica: 'Crítica', '': 'Sem dados' };
// score(el, { nome, fatores: [{ nome, nota, peso, valorTxt, regra }] })
export function score(el, { nome, fatores }) {
  const n = calcScore(fatores), t = tomScore(n);
  el.innerHTML = `<div class="cp-score">
      <div class="cp-score-topo"><div class="cp-score-nota tom-${t}">${n ?? '–'}<span>/100</span></div>
        <div><div class="cp-score-rot tom-${t}">${TOM_TXT[t]}</div><div class="muted small">${esc(nome)}</div></div></div>
      <div class="cp-score-trilho"><div class="tom-${t}" style="width:${n ?? 0}%"></div></div>
      <div class="cp-score-fatores">${fatores.map(f => { const tf = tomScore(f.nota); return `<div class="cp-fator" title="${esc(f.regra || '')}">
        <div class="cp-fator-nome">${esc(f.nome)} <span class="muted small">peso ${Math.round((f.peso ?? 1) * 100)}%</span></div>
        <div class="cp-fator-val">${esc(f.valorTxt ?? '')}</div>
        <div class="cp-fator-nota tom-${tf}">${f.nota ?? '–'}</div></div>`; }).join('')}</div>
      <details class="small muted"><summary>Como é calculado</summary><ul style="margin:6px 0 0;padding-left:18px">${fatores.map(f => `<li><b>${esc(f.nome)}:</b> ${esc(f.regra || '')}</li>`).join('')}</ul>
        Nota final = média ponderada das notas dos fatores com dados. 80+ excelente, 60–79 boa, 40–59 atenção, abaixo de 40 crítica.</details></div>`;
  return n;
}

// ------------------------------------------------------------ insight
// insight({ categoria, texto, tendencia: 'alta'|'baixa'|'neutra', bom: true|false|null }) -> HTML
export function insight(i) {
  const seta = i.tendencia === 'alta' ? '▲' : i.tendencia === 'baixa' ? '▼' : '•';
  const tom = i.bom == null ? 'neutro' : i.bom ? 'bom' : 'ruim';
  return `<div class="cp-insight"><div class="cp-insight-cat">${esc(i.categoria)}</div><div><span class="cp-trend ${tom}">${seta}</span> ${esc(i.texto)}</div></div>`;
}

// ------------------------------------------------------------ tabela simples
// tabela(cols [{ titulo, num }], linhas [{ celulas: [texto], onClick }]) -> Node (célula com {html} não é escapada)
export function tabela(cols, linhas, { vazio = 'Nenhum registro.' } = {}) {
  const w = document.createElement('div'); w.className = 'table-wrap';
  const cel = (c) => (c && typeof c === 'object' && 'html' in c) ? c.html : esc(c ?? '');
  w.innerHTML = `<table class="tbl"><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.titulo)}</th>`).join('')}</tr></thead><tbody>${
    linhas.map((l, i) => `<tr data-i="${i}" class="${l.onClick ? 'clickable' : ''}">${l.celulas.map((c, j) => `<td class="${cols[j]?.num ? 'num' : ''}">${cel(c)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${cols.length}" class="empty">${esc(vazio)}</td></tr>`}</tbody></table>`;
  w.addEventListener('click', (e) => { const r = e.target.closest('tr[data-i]'); const l = r && linhas[+r.dataset.i]; if (l?.onClick) l.onClick(); });
  return w;
}

// ------------------------------------------------------------ aging (faixas de vencimento)
// aging(titulos [{ data, valor }], hoje) -> faixas com { nome, valor, qtd, itens }
export function aging(titulos, hoje) {
  const d0 = new Date(hoje + 'T12:00:00');
  const dias = (s) => Math.round((new Date(s + 'T12:00:00') - d0) / 86400000);
  const F = [
    { nome: 'Vencido há mais de 30 dias', t: (d) => d < -30 }, { nome: 'Vencido até 30 dias', t: (d) => d < 0 && d >= -30 },
    { nome: 'A vencer em 7 dias', t: (d) => d >= 0 && d <= 7 }, { nome: 'A vencer de 8 a 30 dias', t: (d) => d > 7 && d <= 30 },
    { nome: 'A vencer de 31 a 60 dias', t: (d) => d > 30 && d <= 60 }, { nome: 'A vencer após 60 dias', t: (d) => d > 60 },
  ].map(f => ({ ...f, valor: 0, qtd: 0, itens: [] }));
  for (const x of titulos) { const d = dias(x.data), f = F.find(f => f.t(d)); if (f) { f.valor += Math.abs(+x.valor); f.qtd++; f.itens.push(x); } }
  return F;
}

// Cadastros › Uso da Plataforma (CAD010) — só administrador. Quais telas cada perfil usa e por quanto tempo, quem não entrou,
// onde as pessoas desistem (formulários fechados sem salvar e telas de onde saem logo) e os erros mais vistos.
// O registro é feito por js/lib/uso.js; o banco agrega em uso_resumo (SQL 099). Melhoria 1.4 (07/11/2026).
import { sb, state, q, isAdmin } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, dateBR } from '../lib/ui.js';
import { codigoDa } from '../lib/telas.js';
import { fmtTempo, perfisResumo, telasSemUso, taxaDesistencia, periodo } from '../lib/uso-calc.js';

export const title = 'Uso da Plataforma';
const PAPEIS = { admin: 'Administrador', diretor: 'Diretor', financeiro: 'Financeiro', leitura: 'Leitura', compras: 'Compras', vendas: 'Vendas', producao: 'Produção' };
const ABAS = [['telas', 'Telas'], ['perfis', 'Perfis'], ['pessoas', 'Pessoas'], ['forms', 'Onde desistem'], ['erros', 'Erros'], ['sem', 'Telas sem uso']];
const ui = { dias: 30, de: null, ate: null, papel: '', aba: 'telas' };

// nome e área da tela pelo menu (o mesmo nome que aparece para quem usa)
const menuTelas = () => $$('#nav a[data-route]').map(a => ({ rota: a.dataset.route, nome: a.dataset.nome || a.textContent.trim(),
  area: a.closest('.nav-area')?.querySelector('.nav-area-tit')?.dataset.nome || a.closest('.nav-area')?.querySelector('.nav-area-tit')?.textContent || '' }))
  .filter((m, i, l) => l.findIndex(x => x.rota === m.rota) === i);
const nomeTela = (r, M) => M.find(m => m.rota === r)?.nome || r;
const barra = (pct, cor = 'var(--primary)') => `<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;min-width:70px;height:6px;border-radius:3px;background:var(--border)"><div style="width:${Math.min(100, Math.max(0, pct))}%;height:100%;border-radius:3px;background:${cor}"></div></div><span class="small" style="min-width:42px;text-align:right">${pct}%</span></div>`;

export async function render(root) {
  if (!isAdmin()) { root.innerHTML = '<div class="card"><div class="empty">Só o administrador vê o uso da plataforma.</div></div>'; return; }
  const p = ui.dias ? periodo(ui.dias) : { de: ui.de, ate: ui.ate };
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Uso da Plataforma</h2><div class="muted small">Quais telas cada perfil usa, por quanto tempo e onde as pessoas desistem. Visível só para o administrador.</div></div>
    <div style="display:flex;gap:8px"><button class="btn" id="us-par">Parâmetros</button></div></div>
    <div class="card toolbar"><div class="chips" id="us-p">${[[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [0, 'Período']].map(([d, t]) => `<span class="chip ${ui.dias === d ? 'on' : ''}" data-d="${d}">${t}</span>`).join('')}</div>
      <span id="us-dt" ${ui.dias ? 'hidden' : ''}><label>De<input type="date" id="us-de" value="${p.de || ''}"></label><label>Até<input type="date" id="us-ate" value="${p.ate || ''}"></label></span>
      <label>Perfil<select id="us-papel"><option value="">Todos</option>${Object.entries(PAPEIS).map(([k, t]) => `<option value="${k}" ${ui.papel === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <span class="spacer"></span><span class="small muted">${dateBR(p.de)} a ${dateBR(p.ate)}</span></div>
    <div id="us-corpo"><div class="loading">Carregando…</div></div>`;
  const re = () => render(root);
  $('#us-p', root).onclick = (ev) => { const d = ev.target.closest('[data-d]'); if (!d) return; ui.dias = +d.dataset.d; if (!ui.dias) { const x = periodo(30); ui.de ||= x.de; ui.ate ||= x.ate; } re(); };
  $('#us-de', root).onchange = (ev) => { ui.de = ev.target.value; re(); };
  $('#us-ate', root).onchange = (ev) => { ui.ate = ev.target.value; re(); };
  $('#us-papel', root).onchange = (ev) => { ui.papel = ev.target.value; re(); };
  $('#us-par', root).onclick = () => parametros(re);
  if (!p.de || !p.ate) return;
  let R;
  try { R = await q(sb.rpc('uso_resumo', { p_empresa: state.empresa.id, p_de: p.de, p_ate: p.ate, p_papel: ui.papel || null })); }
  catch (err) { fail(err); $('#us-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 099 já foi executado.</div></div>'; return; }
  const M = menuTelas(), k = R.kpis || {};
  const pctAb = k.forms ? Math.round(100 * k.abandonos / k.forms) : 0;
  const dias = R.dias || [], maxU = Math.max(1, ...dias.map(d => +d.usuarios));
  $('#us-corpo', root).innerHTML = `<div class="kpis" id="us-kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Usuários ativos</div><div class="k-value">${k.usuarios || 0}</div><div class="k-sub">de ${k.membros || 0} com acesso${(R.sem_acesso || []).length ? ` · ${R.sem_acesso.length} não entrou` : ''}</div></div>
      <div class="kpi"><div class="k-label">Tempo de uso</div><div class="k-value">${fmtTempo((+k.horas || 0) * 3600)}</div><div class="k-sub">${k.dias_pessoa ? `${fmtTempo((+k.horas || 0) * 3600 / k.dias_pessoa)} por pessoa por dia` : 'tempo com a tela à frente'}</div></div>
      <div class="kpi"><div class="k-label">Telas abertas</div><div class="k-value">${k.acessos || 0}</div><div class="k-sub">${(R.telas || []).length} tela(s) diferente(s)</div></div>
      <div class="kpi"><div class="k-label">Formulários abandonados</div><div class="k-value ${pctAb >= 30 ? 'neg' : ''}">${k.abandonos || 0}</div><div class="k-sub">${pctAb}% dos ${k.forms || 0} abertos</div></div>
      <div class="kpi"><div class="k-label">Erros mostrados</div><div class="k-value ${k.erros ? 'neg' : ''}">${k.erros || 0}</div><div class="k-sub">mensagens em vermelho</div></div></div>
    ${dias.length > 1 ? `<div class="card" style="margin-bottom:12px"><div class="small muted" style="margin-bottom:6px">Pessoas por dia</div><div style="display:flex;align-items:flex-end;gap:2px;height:60px">${dias.map(d => `<div title="${dateBR(d.dia)}: ${d.usuarios} pessoa(s), ${fmtTempo(+d.horas * 3600)}" style="flex:1;background:var(--primary);opacity:.75;border-radius:2px 2px 0 0;height:${Math.max(4, Math.round(100 * d.usuarios / maxU))}%"></div>`).join('')}</div></div>` : ''}
    <div class="card toolbar"><div class="chips" id="us-abas">${ABAS.map(([a, t]) => `<span class="chip ${ui.aba === a ? 'on' : ''}" data-a="${a}">${t}</span>`).join('')}</div></div>
    <div id="us-aba"></div>
    <p class="small muted">O registro guarda só a tela, o tempo com ela à frente (aba escondida ou 5 minutos parado não contam), o nome do formulário e as mensagens de erro. Não grava o que foi digitado. Os dados são apagados depois de ${R.guardar_dias || 'alguns'} dias (Parâmetros).</p>`;
  const aba = () => { $$('#us-abas [data-a]', root).forEach(b => b.classList.toggle('on', b.dataset.a === ui.aba)); $('#us-aba', root).innerHTML = pintar[ui.aba](R, M); };
  $('#us-abas', root).onclick = (ev) => { const a = ev.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; aba(); } };
  aba();
}

const tabela = (cab, linhas, vazio, cols) => `<div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr>${cab}</tr></thead><tbody>${linhas || `<tr><td colspan="${cols}" class="empty">${vazio}</td></tr>`}</tbody></table></div></div>`;
const telaCel = (r, M) => `<b>${esc(nomeTela(r, M))}</b>${codigoDa(r) ? ` <span class="small muted">${codigoDa(r)}</span>` : ''}`;

const pintar = {
  telas: (R, M) => {
    const rej = R.rejeicao_segundos || 10, max = Math.max(1, ...(R.telas || []).map(t => +t.segundos));
    return tabela(`<th>Tela</th><th class="num">Aberturas</th><th class="num">Pessoas</th><th>Tempo total</th><th class="num">Média por visita</th><th title="Visitas de menos de ${rej} s">Saiu logo</th>`,
      (R.telas || []).map(t => `<tr><td class="wrap">${telaCel(t.rota, M)}</td><td class="num">${t.acessos}</td><td class="num">${t.usuarios}</td>
        <td style="min-width:160px"><div class="small">${fmtTempo(t.segundos)}</div><div style="height:6px;border-radius:3px;background:var(--border)"><div style="width:${Math.round(100 * t.segundos / max)}%;height:100%;border-radius:3px;background:var(--primary)"></div></div></td>
        <td class="num">${fmtTempo(t.media)}</td><td style="min-width:110px">${barra(+t.rejeicao, +t.rejeicao >= 50 ? 'var(--neg)' : 'var(--muted)')}</td></tr>`).join(''),
      'Nenhum acesso no período. O registro começa quando as pessoas entram depois do SQL 099.', 6)
      + `<p class="small muted">"Saiu logo" = visitas de menos de ${rej} segundos. Muito alto numa tela de trabalho pode indicar menu confuso (a pessoa entrou na tela errada) ou tela lenta.</p>`;
  },
  perfis: (R, M) => {
    const P = perfisResumo(R.perfis);
    return P.length ? `<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px">${P.map(p => `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><h3 style="margin:0">${esc(PAPEIS[p.papel] || p.papel)}</h3><span class="small muted">${fmtTempo(p.segundos)} · ${p.acessos} abertura(s)</span></div>
        <table style="margin-top:8px;width:100%;table-layout:fixed"><tbody>${p.telas.map(t => `<tr><td class="wrap small">${esc(nomeTela(t.rota, M))}</td><td style="width:50%">${barra(t.fatia)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</div>
      <p class="small muted">Fatia do tempo de cada perfil nas telas em que ele mais trabalha. Ajuda a decidir o que treinar e o que simplificar no menu de cada perfil.</p>` : '<div class="card" style="margin-top:12px"><div class="empty">Nenhum acesso no período.</div></div>';
  },
  pessoas: (R, M) => tabela('<th>Pessoa</th><th>Perfil</th><th class="num">Dias com uso</th><th class="num">Aberturas</th><th>Tempo</th><th>Tela mais usada</th><th>Último acesso</th>',
    (R.pessoas || []).map(u => `<tr><td class="wrap"><b>${esc(u.nome || '')}</b><div class="small muted">${esc(u.email || '')}</div></td><td>${esc(PAPEIS[u.papel] || u.papel || '')}</td>
      <td class="num">${u.dias}</td><td class="num">${u.acessos}</td><td>${fmtTempo(u.segundos)}</td><td class="small">${esc(nomeTela(u.tela_mais, M))}</td><td class="small">${dateBR(String(u.ultimo).slice(0, 10))}</td></tr>`).join('')
    + (R.sem_acesso || []).map(u => `<tr class="muted"><td class="wrap"><b>${esc(u.nome || '')}</b><div class="small">${esc(u.email || '')}</div></td><td>${esc(PAPEIS[u.papel] || u.papel || '')}</td>
      <td colspan="4" class="small"><span class="badge">não entrou no período</span></td><td class="small">${u.ultimo ? dateBR(String(u.ultimo).slice(0, 10)) : 'nunca registrado'}</td></tr>`).join(''),
    'Ninguém no período.', 7) + '<p class="small muted">Quem tem acesso e não entrou no período aparece no fim, em cinza: vale revisar se ainda precisa do acesso (Empresa e Usuários).</p>',
  forms: (R, M) => tabela('<th>Tela</th><th>Formulário</th><th class="num">Abertos</th><th class="num">Concluídos</th><th class="num">Desistências</th><th>Taxa</th><th class="num">Tempo até desistir</th>',
    (R.forms || []).map(f => { const t = taxaDesistencia(f); return `<tr><td class="small">${esc(nomeTela(f.rota, M))}</td><td class="wrap"><b>${esc(f.titulo || '')}</b></td><td class="num">${f.abertos}</td><td class="num">${f.concluidos}</td>
      <td class="num ${t >= 40 ? 'neg' : ''}">${f.abandonos}</td><td style="min-width:110px">${barra(t, t >= 40 ? 'var(--neg)' : 'var(--muted)')}</td><td class="num">${f.seg_ate_desistir != null ? fmtTempo(f.seg_ate_desistir) : '—'}</td></tr>`; }).join(''),
    'Nenhum formulário aberto ao menos 2 vezes no período.', 7)
    + '<p class="small muted">Desistência = o formulário foi fechado pelo ✕ ou clicando fora, sem salvar. Taxa alta com pouco tempo costuma ser formulário aberto por engano; com muito tempo, campo difícil ou informação que a pessoa não tem.</p>',
  erros: (R, M) => tabela('<th>Tela</th><th>Mensagem</th><th class="num">Vezes</th><th class="num">Pessoas</th><th>Última</th>',
    (R.erros || []).map(e => `<tr><td class="small">${esc(nomeTela(e.rota, M))}</td><td class="wrap">${esc(e.titulo || '')}</td><td class="num">${e.vezes}</td><td class="num">${e.usuarios}</td><td class="small">${dateBR(String(e.ultimo).slice(0, 10))}</td></tr>`).join(''),
    'Nenhum erro mostrado no período.', 5) + '<p class="small muted">Inclui avisos de validação ("Informe o valor") e falhas. Números foram trocados por # para agrupar mensagens iguais.</p>',
  sem: (R, M) => { const L = telasSemUso(M, R.telas);
    return tabela('<th>Tela</th><th>Área</th><th>Código</th>', L.map(m => `<tr><td><b>${esc(m.nome)}</b></td><td class="small">${esc(m.area)}</td><td class="small muted">${codigoDa(m.rota) || ''}</td></tr>`).join(''),
      'Todas as telas do menu foram abertas no período.', 3) + `<p class="small muted">${L.length} tela(s) do menu sem nenhuma abertura no período${ui.papel ? ' por este perfil' : ''}. Pode ser rotina rara (fechamento anual), falta de treinamento ou tela que não faz falta.</p>`; },
};

async function parametros(depois) {
  let c = {};
  try { c = (await q(sb.from('uso_config').select('*').eq('empresa_id', state.empresa.id).maybeSingle())) || {}; } catch (e) { fail(e); return; }
  const m = modal({ title: 'Parâmetros do uso da plataforma', narrow: true, body: `<div class="grid-form" style="grid-template-columns:1fr">
      <label class="chk" style="flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="up-at" style="width:auto;min-height:0" ${c.ativo !== false ? 'checked' : ''}> Registrar o uso da plataforma</label>
      <label>Guardar os registros por (dias)<input type="number" id="up-dias" min="30" max="730" value="${c.guardar_dias || 180}"><span class="small muted">De 30 a 730. Depois disso são apagados, todo dia de manhã.</span></label>
      <label>"Saiu logo" = visita de menos de (segundos)<input type="number" id="up-rej" min="3" max="120" value="${c.rejeicao_segundos || 10}"></label>
      <div class="small muted">Desligado, nada mais é gravado; o que já foi registrado continua no relatório até o prazo de guarda.</div></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="up-ok">Salvar</button>' });
  $('#up-ok', m.el).onclick = async () => {
    const dias = +$('#up-dias', m.el).value, rej = +$('#up-rej', m.el).value;
    if (!(dias >= 30 && dias <= 730)) return toast('Guarda: de 30 a 730 dias', true);
    if (!(rej >= 3 && rej <= 120)) return toast('"Saiu logo": de 3 a 120 segundos', true);
    try { await q(sb.from('uso_config').upsert({ empresa_id: state.empresa.id, ativo: $('#up-at', m.el).checked, guardar_dias: dias, rejeicao_segundos: rej, atualizado_por: state.user?.email, atualizado_em: new Date().toISOString() })); toast('Parâmetros salvos'); m.close(); depois(); }
    catch (e) { fail(e); }
  };
}

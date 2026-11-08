// Cadastros › Privacidade e Acessos (CAD011) — só administrador. Melhoria 1.10 (SQL 100, 07/11/2026).
// Abas: Acessos (último acesso, suspensão automática de quem não entra, revisão periódica, suspensos e Portal),
// Termos (termo de uso da equipe e aviso do Portal, com versão e aceites), Dados pessoais (busca por titular, relatório
// e anonimização) e Solicitações (pedidos dos titulares com o prazo de resposta).
import { sb, state, q, isAdmin, AREAS } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, dateBR, today } from '../lib/ui.js';
import { termoHTML, situacaoAcesso, prazoSolicitacao, mascararCPF, modeloTermo, TIPOS_SOLIC, ORIGENS } from '../lib/lgpd-calc.js';

export const title = 'Privacidade e Acessos';
const PAPEIS = { admin: 'Administrador', diretor: 'Diretor', financeiro: 'Financeiro', leitura: 'Leitura', compras: 'Compras', vendas: 'Vendas', producao: 'Produção', motorista: 'Motorista' };
const ABAS = [['acessos', 'Acessos'], ['termos', 'Termos de uso'], ['titular', 'Dados pessoais'], ['solic', 'Solicitações dos titulares']];
const ui = { aba: 'acessos', busca: '', res: null };
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const dt = (v) => v ? dateBR(String(v).slice(0, 10)) : '—';
const chk = (id, on, txt) => `<label class="chk" style="flex-direction:row;align-items:center;gap:8px;font-weight:400"><input type="checkbox" id="${id}" style="width:auto;min-height:0" ${on ? 'checked' : ''}> ${txt}</label>`;

export async function render(root) {
  if (!isAdmin()) { root.innerHTML = '<div class="card"><div class="empty">Só o administrador vê esta tela.</div></div>'; return; }
  const prm = new URLSearchParams(location.hash.split('?')[1] || '');
  if (ABAS.some(([a]) => a === prm.get('aba'))) { ui.aba = prm.get('aba'); if (prm.get('q')) { ui.busca = prm.get('q'); ui.res = null; ui.auto = true; } history.replaceState(null, '', '#/lgpd'); }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Privacidade e Acessos</h2><div class="muted small">LGPD: quem acessa a plataforma, o termo de uso, os dados pessoais guardados e os pedidos dos titulares.</div></div>
    <div style="display:flex;gap:8px"><button class="btn" id="lg-par">Parâmetros</button></div></div>
    <div class="card toolbar"><div class="chips" id="lg-abas">${ABAS.map(([a, t]) => `<span class="chip ${ui.aba === a ? 'on' : ''}" data-a="${a}">${t}</span>`).join('')}</div></div>
    <div id="lg-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  const re = () => render(root);
  $('#lg-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a && a !== ui.aba) { ui.aba = a; re(); } };
  $('#lg-par', root).onclick = () => parametros(re);
  const corpo = $('#lg-corpo', root);
  try { await ({ acessos, termos, titular, solic })[ui.aba](corpo, re, root); }
  catch (err) { fail(err); corpo.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 100 já foi executado.</div></div>'; }
}

// ---------------------------------------------------------------- Acessos
async function acessos(el, re) {
  const S = await q(sb.rpc('acessos_situacao', { p_empresa: state.empresa.id }));
  const c = S.config, M = S.membros.map(m => ({ ...m, sit: situacaoAcesso(m, c) }));
  const sus = S.suspensos.filter(s => !s.reativado_em), portalOff = S.portal.filter(p => !p.ativo).length;
  const venc = S.proxima_revisao && S.proxima_revisao <= today();
  el.innerHTML = `<div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Pessoas com acesso</div><div class="k-value">${M.length}</div><div class="k-sub">${M.filter(m => m.dias <= 7).length} entraram nos últimos 7 dias</div></div>
      <div class="kpi"><div class="k-label">Vão ser suspensas</div><div class="k-value ${M.some(m => m.sit.k === 'aviso') ? 'neg' : ''}">${M.filter(m => m.sit.k === 'aviso').length}</div><div class="k-sub">nos próximos ${c.aviso_dias} dias, sem entrar</div></div>
      <div class="kpi"><div class="k-label">Acessos suspensos</div><div class="k-value">${sus.length}</div><div class="k-sub">${c.inativos_acao === 'suspender' ? `automático após ${c.inativos_dias} dias sem entrar` : 'suspensão automática desligada'}</div></div>
      <div class="kpi"><div class="k-label">Portal do Cliente</div><div class="k-value">${S.portal.length - portalOff}</div><div class="k-sub">ativos · ${portalOff} bloqueado(s)</div></div>
      <div class="kpi"><div class="k-label">Próxima revisão</div><div class="k-value ${venc ? 'neg' : ''}" style="font-size:1.3em">${dt(S.proxima_revisao)}</div><div class="k-sub">${S.ultima_revisao ? `última em ${dt(S.ultima_revisao)}` : 'nenhuma revisão feita'} · a cada ${c.revisao_meses} meses</div></div></div>
    ${venc ? `<div class="card" style="background:var(--warn-soft);margin-bottom:12px;display:flex;align-items:center;gap:12px"><div style="flex:1"><b>Revisão de acessos vencida.</b> Confirme quem continua precisando de acesso e suspenda quem saiu ou mudou de função.</div><button class="btn primary" id="ac-rev2">Fazer a revisão agora</button></div>` : ''}
    <div class="card toolbar"><b>Pessoas com acesso</b><span class="spacer"></span><button class="btn primary" id="ac-rev">Fazer a revisão de acessos</button></div>
    <div class="card flush" style="margin-top:8px"><div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Papel</th><th>Na empresa desde</th><th>Último acesso</th><th class="num">Dias sem entrar</th><th>Situação</th><th></th></tr></thead><tbody>
    ${M.map(m => `<tr><td class="wrap"><b>${esc(m.nome)}</b>${m.eu ? ' <span class="small muted">(você)</span>' : ''}<div class="small muted">${esc(m.email)}</div></td><td>${esc(PAPEIS[m.papel] || m.papel)}</td>
      <td class="small">${dt(m.desde)}</td><td class="small">${dt(m.ultimo)}</td><td class="num">${m.dias}</td>
      <td><span class="badge ${m.sit.cls}">${esc(m.sit.txt)}</span>${m.avisado_em ? `<div class="small muted">avisado em ${dt(m.avisado_em)}</div>` : ''}</td>
      <td>${m.eu ? '' : `<button class="btn ghost small" data-sus="${m.user_id}">Suspender</button>`}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="small muted">Último acesso = a última vez que a pessoa entrou nesta empresa. ${c.inativos_acao === 'suspender' ? `Quem passa ${c.inativos_dias} dias sem entrar recebe um aviso ${c.aviso_dias} dias antes e é suspenso automaticamente (todo dia de manhã).` : `Quem passa ${c.inativos_dias} dias sem entrar gera um aviso para o administrador (a suspensão automática está desligada).`} ${c.incluir_admin ? '' : 'Administradores não são suspensos automaticamente.'} Suspender guarda o papel e as áreas: reativar devolve o mesmo acesso.</p>
    <h3 style="margin:18px 0 6px">Acessos suspensos</h3>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Papel</th><th>Motivo</th><th>Suspenso em</th><th>Situação</th><th></th></tr></thead><tbody>
    ${S.suspensos.map(s => `<tr class="${s.reativado_em ? 'muted' : ''}"><td class="wrap"><b>${esc(s.nome || s.email || '')}</b><div class="small muted">${esc(s.email || '')}</div></td><td>${esc(PAPEIS[s.papel] || s.papel)}</td>
      <td class="wrap small">${esc(s.motivo)}${s.automatico ? ' <span class="badge">automático</span>' : ''}</td><td class="small">${dt(s.suspenso_em)}<div class="muted">${esc(s.suspenso_por || '')}</div></td>
      <td class="small">${s.reativado_em ? `reativado em ${dt(s.reativado_em)}` : '<span class="badge vencido">suspenso</span>'}</td>
      <td>${s.reativado_em ? '' : `<button class="btn ghost small" data-rea="${s.id}">Reativar</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum acesso suspenso.</td></tr>'}</tbody></table></div></div>
    <h3 style="margin:18px 0 6px">Portal do Cliente</h3>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Cliente</th><th>E-mail</th><th>Último acesso</th><th class="num">Dias</th><th>Situação</th></tr></thead><tbody>
    ${S.portal.map(p => `<tr><td class="wrap">${esc(p.cliente)}</td><td>${esc(p.email)}</td><td class="small">${p.nunca ? 'nunca entrou' : dt(p.ultimo)}</td><td class="num">${p.dias}</td>
      <td>${p.ativo ? (p.dias >= c.inativos_dias - c.aviso_dias && c.incluir_portal ? '<span class="badge aberto">sem uso</span>' : '<span class="badge pago">ativo</span>') : '<span class="badge">bloqueado</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum cliente com acesso ao Portal.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">${c.incluir_portal ? `Acesso do Portal sem uso há ${c.inativos_dias} dias é bloqueado automaticamente. Para liberar de novo, use Financeiro › Portal do Cliente.` : 'O bloqueio automático do Portal está desligado (Parâmetros).'}</p>
    ${S.revisoes.length ? `<h3 style="margin:18px 0 6px">Revisões feitas</h3><div class="card flush"><div class="table-wrap"><table><thead><tr><th>Data</th><th>Por</th><th class="num">Mantidos</th><th class="num">Suspensos</th><th>Observação</th></tr></thead><tbody>
      ${S.revisoes.map(v => `<tr><td>${dt(v.revisado_em)}</td><td class="small">${esc(v.revisado_por || '')}</td><td class="num">${v.mantidos}</td><td class="num">${v.suspensos}</td><td class="wrap small">${esc(v.observacao || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  const rev = () => revisar(M, re);
  $('#ac-rev', el).onclick = rev; $('#ac-rev2', el) && ($('#ac-rev2', el).onclick = rev);
  $$('[data-sus]', el).forEach(b => b.onclick = () => { const m = M.find(x => x.user_id === b.dataset.sus);
    const d = modal({ title: `Suspender o acesso de ${m.nome}`, narrow: true, body: `<label>Motivo<input id="su-m" placeholder="Ex.: saiu da empresa, mudou de função"></label><p class="small muted">A pessoa deixa de entrar nesta empresa na hora. O papel e as áreas ficam guardados para reativar.</p>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn danger" id="su-ok">Suspender</button>' });
    $('#su-ok', d.el).onclick = async () => { try { await q(sb.rpc('acesso_suspender', { p_empresa: state.empresa.id, p_user: m.user_id, p_motivo: $('#su-m', d.el).value })); d.close(); toast('Acesso suspenso'); re(); } catch (e) { fail(e); } }; });
  $$('[data-rea]', el).forEach(b => b.onclick = async () => { if (!confirm('Reativar este acesso com o mesmo papel e as mesmas áreas?')) return;
    try { await q(sb.rpc('acesso_reativar', { p_id: b.dataset.rea })); toast('Acesso reativado'); re(); } catch (e) { fail(e); } });
}

function revisar(M, re) {
  const d = modal({ title: 'Revisão de acessos', wide: true, body: `<p class="small muted" style="margin-top:0">Para cada pessoa, confirme se ela ainda precisa do acesso com este papel. Quem saiu da empresa ou mudou de função deve ser suspenso. A revisão fica registrada com a data e o seu nome.</p>
      <div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Papel e áreas</th><th>Último acesso</th><th>Decisão</th><th>Motivo (se suspender)</th></tr></thead><tbody>
      ${M.map(m => `<tr data-u="${m.user_id}"><td class="wrap"><b>${esc(m.nome)}</b><div class="small muted">${esc(m.email)}</div></td>
        <td class="small">${esc(PAPEIS[m.papel] || m.papel)}<div class="muted">${esc(m.areas ? m.areas.map(a => a === 'rh' ? 'RH' : (AREAS.find(([k]) => k === a)?.[1] || a)).join(', ') : 'todas as áreas')}</div></td>
        <td class="small">${dt(m.ultimo)}<div class="${m.sit.k === 'ok' ? 'muted' : 'neg'}">${m.dias} dia(s)</div></td>
        <td>${m.eu ? '<span class="small muted">manter (você)</span>' : `<select class="rv-d"><option value="manter">Manter</option><option value="suspender">Suspender</option></select>`}</td>
        <td>${m.eu ? '' : '<input class="rv-m" placeholder="motivo">'}</td></tr>`).join('')}</tbody></table></div>
      <label style="margin-top:10px">Observação da revisão<textarea id="rv-obs" rows="2" placeholder="Ex.: revisão semestral com a diretoria"></textarea></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rv-ok">Registrar a revisão</button>' });
  $('#rv-ok', d.el).onclick = async () => {
    const itens = $$('tr[data-u]', d.el).map(tr => ({ user_id: tr.dataset.u, decisao: $('.rv-d', tr)?.value || 'manter', motivo: $('.rv-m', tr)?.value || '' }));
    const n = itens.filter(i => i.decisao === 'suspender').length;
    if (n && !confirm(`Suspender ${n} acesso(s) agora?`)) return;
    try { await q(sb.rpc('acessos_revisar', { p_empresa: state.empresa.id, p_itens: itens, p_obs: $('#rv-obs', d.el).value })); d.close(); toast(`Revisão registrada${n ? ` · ${n} suspenso(s)` : ''}`); re(); } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- Termos
async function termos(el, re) {
  const [T, cfg] = await Promise.all([q(sb.rpc('lgpd_termos_situacao', { p_empresa: state.empresa.id })), config()]);
  const card = (pub, nome, quem) => { const t = T[pub], P = t?.pessoas || [], ok = P.filter(p => p.aceito_em).length;
    return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h3 style="margin:0">${nome}</h3>${t ? `<span class="badge pago">versão ${t.versao}</span>` : '<span class="badge aberto">não publicado</span>'}</div>
      <div class="small muted" style="margin:4px 0 10px">${quem}</div>
      ${t ? `<div class="small">Publicado em ${dt(t.publicado_em)} por ${esc(t.publicado_por || '')}</div>
        <div style="margin:10px 0"><b>${ok}</b> de ${P.length} aceitaram esta versão</div>
        <div class="table-wrap" style="max-height:220px;overflow:auto"><table><tbody>${P.map(p => `<tr><td class="small wrap">${esc(p.nome || p.email)}<div class="muted">${esc(p.email || '')}</div></td><td class="small">${p.aceito_em ? `aceito em ${dt(p.aceito_em)}` : '<span class="badge aberto">pendente</span>'}</td></tr>`).join('') || '<tr><td class="empty small">Ninguém neste público.</td></tr>'}</tbody></table></div>`
      : '<p class="small">Enquanto não houver termo publicado, ninguém precisa aceitar nada ao entrar.</p>'}
      <div style="display:flex;gap:8px;margin-top:12px">${t ? `<button class="btn" data-ver="${pub}">Ver o texto</button>` : ''}<button class="btn primary" data-ed="${pub}">${t ? 'Editar e publicar nova versão' : 'Escrever e publicar'}</button></div></div>`; };
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:12px">
      ${card('equipe', 'Termo de uso da plataforma', 'Aparece para a equipe no primeiro acesso e a cada nova versão. Sem aceitar, a pessoa não usa a plataforma.')}
      ${card('portal', 'Aviso de privacidade do Portal do Cliente', 'Aparece para o cliente ao entrar no Portal.')}</div>
    <p class="small muted">Publicar uma nova versão pede que <b>todos aceitem de novo</b>. O aceite fica registrado com a data, a versão e o navegador, e aparece no relatório de dados pessoais da pessoa.</p>`;
  $$('[data-ver]', el).forEach(b => b.onclick = () => { const t = T[b.dataset.ver]; modal({ title: `${t.titulo} — versão ${t.versao}`, wide: true, body: `<div style="line-height:1.55">${termoHTML(t.texto)}</div>` }); });
  $$('[data-ed]', el).forEach(b => b.onclick = () => editarTermo(b.dataset.ed, T[b.dataset.ed], cfg, re));
}

function editarTermo(pub, t, cfg, re) {
  const modelo = () => modeloTermo(pub, { empresa: state.empresa.nome, encarregado: cfg.encarregado_nome || undefined, email: cfg.encarregado_email || undefined });
  const d = modal({ title: pub === 'equipe' ? 'Termo de uso da plataforma' : 'Aviso de privacidade do Portal', wide: true,
    body: `<label>Título<input id="te-t" value="${esc(t?.titulo || (pub === 'equipe' ? 'Termo de uso e aviso de privacidade' : 'Aviso de privacidade do Portal do Cliente'))}"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
        <label>Texto<textarea id="te-x" rows="20" style="font-family:inherit">${esc(t?.texto || modelo())}</textarea><span class="small muted">"## " no começo da linha = título · "- " = item de lista · **negrito**. Linha em branco separa parágrafos.</span></label>
        <div><div class="small muted" style="margin-bottom:4px">Prévia</div><div id="te-p" style="border:1px solid var(--border);border-radius:8px;padding:6px 14px;max-height:430px;overflow:auto;line-height:1.5"></div></div></div>
      ${!cfg.encarregado_email ? '<p class="small neg">Informe o encarregado de dados (nome e e-mail) em Parâmetros: o modelo usa esses dados.</p>' : ''}`,
    foot: `<button class="btn" id="te-mod" style="margin-right:auto">Usar o modelo</button><button class="btn" data-close>Cancelar</button><button class="btn primary" id="te-ok">Publicar versão ${(t?.versao || 0) + 1}</button>` });
  const pv = () => { $('#te-p', d.el).innerHTML = termoHTML($('#te-x', d.el).value); };
  $('#te-x', d.el).oninput = pv; pv();
  $('#te-mod', d.el).onclick = () => { if ($('#te-x', d.el).value.trim() && !confirm('Trocar o texto atual pelo modelo?')) return; $('#te-x', d.el).value = modelo(); pv(); };
  $('#te-ok', d.el).onclick = async () => {
    if (/\[(EMPRESA|NOME DO ENCARREGADO|E-MAIL DO ENCARREGADO)\]/.test($('#te-x', d.el).value)) return toast('Troque os campos entre colchetes [ ] antes de publicar', true);
    if (t && !confirm('Publicar a nova versão? Todos vão precisar aceitar de novo ao entrar.')) return;
    try { const v = await q(sb.rpc('lgpd_publicar_termo', { p_empresa: state.empresa.id, p_publico: pub, p_titulo: $('#te-t', d.el).value, p_texto: $('#te-x', d.el).value })); d.close(); toast(`Versão ${v} publicada`); re(); } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- Dados pessoais
async function titular(el, re) {
  if (ui.auto) { ui.auto = false; ui.res = await q(sb.rpc('lgpd_dados_titular', { p_empresa: state.empresa.id, p_busca: ui.busca })); }
  const abertas = await q(sb.from('lgpd_solicitacoes').select('id,titular_nome,tipo,prazo').eq('empresa_id', state.empresa.id).eq('status', 'aberta').order('prazo'));
  el.innerHTML = `<div class="card toolbar"><label style="flex:1">CPF, nome ou e-mail do titular<input id="ti-b" value="${esc(ui.busca)}" placeholder="Ex.: 123.456.789-09 ou maria@exemplo.com"></label>
      <button class="btn primary" id="ti-go">Buscar</button>${ui.res?.length ? '<button class="btn" id="ti-pdf">Relatório para o titular</button>' : ''}</div>
    <div id="ti-res" style="margin-top:12px"></div>
    <p class="small muted">A busca olha usuários da plataforma, Portal do Cliente, beneficiários pessoa física, colaboradores, motoristas, vendedores, transportadores autônomos e crachás de terceiros. Só o administrador consulta. Os lançamentos, as notas fiscais e a folha não são apagados: a lei obriga a guardá-los (base legal de cada cadastro no relatório).</p>`;
  const buscar = async () => { ui.busca = $('#ti-b', el).value.trim(); try { ui.res = await q(sb.rpc('lgpd_dados_titular', { p_empresa: state.empresa.id, p_busca: ui.busca })); re(); } catch (e) { fail(e); } };
  $('#ti-go', el).onclick = buscar; $('#ti-b', el).onkeydown = (e) => { if (e.key === 'Enter') buscar(); };
  $('#ti-pdf', el) && ($('#ti-pdf', el).onclick = () => relatorioTitular(ui.res));
  const R = ui.res;
  if (!R) return;
  $('#ti-res', el).innerHTML = R.length ? R.map((r, i) => `<div class="card" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
      <div><span class="small muted">${esc(ORIGENS[r.origem] || r.origem)}</span><h3 style="margin:2px 0">${esc(r.nome)}</h3></div>
      <div style="display:flex;gap:8px;align-items:center">${r.ativo ? '<span class="badge pago">ativo</span>' : '<span class="badge">inativo</span>'}
        ${r.origem === 'usuario' ? '<span class="small muted">para tirar o acesso: aba Acessos › Suspender</span>' : String(r.nome).startsWith('TITULAR ANONIMIZADO') ? '' : `<button class="btn ghost small danger" data-an="${i}">Anonimizar</button>`}</div></div>
      <table style="margin-top:8px"><tbody>${Object.entries(r.campos || {}).map(([k, v]) => `<tr><td class="small muted" style="width:200px">${esc(k)}</td><td class="small wrap">${esc(/CPF/.test(k) ? mascararCPF(v) : (v ?? ''))}</td></tr>`).join('')}</tbody></table>
      <div class="small" style="margin-top:6px"><b>Base legal:</b> ${esc(r.base_legal)}</div></div>`).join('')
    : `<div class="card"><div class="empty">Nenhum dado pessoal encontrado para "${esc(ui.busca)}".</div></div>`;
  $$('[data-an]', el).forEach(b => b.onclick = () => anonimizar(R[+b.dataset.an], abertas, re));
}

function anonimizar(r, abertas, re) {
  const d = modal({ title: `Anonimizar ${r.nome}`, body: `<p style="margin-top:0">O nome vira <b>TITULAR ANONIMIZADO</b> e são apagados o CPF, e-mail, telefone, endereço, Pix, dados bancários, foto e observações deste cadastro. As versões guardadas na Auditoria também perdem esses dados.</p>
      <p class="small">Continuam (obrigação legal): os lançamentos, as notas fiscais, a folha e o histórico salarial, agora ligados ao nome anonimizado. <b>Não dá para desfazer.</b></p>
      ${abertas.length ? `<label>Solicitação do titular<select id="an-s"><option value="">— sem solicitação —</option>${abertas.map(s => `<option value="${s.id}" ${norm(s.titular_nome) === norm(r.nome) ? 'selected' : ''}>${esc(s.titular_nome)} · ${esc(TIPOS_SOLIC[s.tipo])} · prazo ${dt(s.prazo)}</option>`).join('')}</select></label>` : ''}
      <div style="margin-top:10px">${chk('an-c', false, 'Entendi que não dá para desfazer')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn danger" id="an-ok">Anonimizar</button>' });
  $('#an-ok', d.el).onclick = async () => {
    if (!$('#an-c', d.el).checked) return toast('Marque a confirmação', true);
    try { await q(sb.rpc('lgpd_anonimizar', { p_empresa: state.empresa.id, p_origem: r.origem, p_id: r.id, p_solicitacao: $('#an-s', d.el)?.value || null })); d.close(); toast('Dados anonimizados'); ui.res = null; ui.busca = ''; re(); }
    catch (e) { fail(e); }
  };
}

async function relatorioTitular(R) {
  const { abrirRelatorio } = await import('../lib/relatorio.js');
  const cfg = await config();
  abrirRelatorio({ nome: 'Relatório de dados pessoais', titulo: 'Relatório de dados pessoais do titular', subtitulo: `Busca: ${ui.busca} · emitido em ${dateBR(today())}`,
    corpo: `<p>Em atendimento à Lei 13.709/2018 (LGPD), art. 18, seguem os dados pessoais do titular tratados por ${esc(state.empresa.nome)}, com a origem e a base legal de cada tratamento.</p>
      ${R.map(r => `<h3>${esc(ORIGENS[r.origem] || r.origem)}: ${esc(r.nome)}</h3><table><tbody>${Object.entries(r.campos || {}).map(([k, v]) => `<tr><td style="width:35%">${esc(k)}</td><td>${esc(v ?? '')}</td></tr>`).join('')}</tbody></table><p><b>Base legal:</b> ${esc(r.base_legal)}</p>`).join('')}
      <p>Os dados são guardados em servidores contratados para a hospedagem da plataforma, com acesso restrito por perfil e registro de auditoria. Dúvidas e pedidos: ${esc(cfg.encarregado_nome || 'encarregado de dados')}${cfg.encarregado_email ? ` (${esc(cfg.encarregado_email)})` : ''}.</p>`,
    rodape: 'Documento com dados pessoais: entregar somente ao titular.' });
}

// ---------------------------------------------------------------- Solicitações
async function solic(el, re) {
  const S = await q(sb.from('lgpd_solicitacoes').select('*').eq('empresa_id', state.empresa.id).order('status').order('prazo'));
  const ab = S.filter(s => s.status === 'aberta'), atr = ab.filter(s => prazoSolicitacao(s.prazo).dias < 0);
  el.innerHTML = `<div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Em aberto</div><div class="k-value">${ab.length}</div><div class="k-sub">${ab.filter(s => prazoSolicitacao(s.prazo).dias >= 0 && prazoSolicitacao(s.prazo).dias <= 3).length} vencem em até 3 dias</div></div>
      <div class="kpi"><div class="k-label">Atrasadas</div><div class="k-value ${atr.length ? 'neg' : ''}">${atr.length}</div><div class="k-sub">passaram do prazo de resposta</div></div>
      <div class="kpi"><div class="k-label">Atendidas</div><div class="k-value">${S.filter(s => s.status !== 'aberta').length}</div><div class="k-sub">desde o início</div></div></div>
    <div class="card toolbar"><b>Pedidos dos titulares</b><span class="spacer"></span><button class="btn primary" id="so-novo">Registrar solicitação</button></div>
    <div class="card flush" style="margin-top:8px"><div class="table-wrap"><table><thead><tr><th>Recebida</th><th>Titular</th><th>Pedido</th><th>Prazo</th><th>Situação</th><th></th></tr></thead><tbody>
    ${S.map(s => { const p = prazoSolicitacao(s.prazo); return `<tr class="${s.status === 'aberta' ? '' : 'muted'}"><td>${dt(s.recebida_em)}</td><td class="wrap"><b>${esc(s.titular_nome)}</b><div class="small muted">${esc([mascararCPF(s.titular_documento), s.titular_contato].filter(Boolean).join(' · '))}</div></td>
      <td class="wrap small">${esc(TIPOS_SOLIC[s.tipo] || s.tipo)}${s.descricao ? `<div class="muted">${esc(s.descricao)}</div>` : ''}${s.registros?.length ? `<div class="muted">${s.registros.length} cadastro(s) anonimizado(s)</div>` : ''}</td>
      <td>${dt(s.prazo)}${s.status === 'aberta' ? `<div><span class="badge ${p.cls}">${p.txt}</span></div>` : ''}</td>
      <td class="small wrap" style="max-width:260px">${s.status === 'aberta' ? '<span class="badge aberto">aberta</span>' : `${s.status === 'atendida' ? 'atendida' : 'negada'} em ${dt(s.atendida_em)}<div class="muted wrap">${esc(s.resposta || '')}</div>`}</td>
      <td style="min-width:120px">${s.status === 'aberta' ? `<div style="display:flex;flex-direction:column;gap:4px;align-items:stretch"><button class="btn small" data-at="${s.id}">Responder</button><button class="btn ghost small" data-bus="${s.id}">Buscar dados</button></div>` : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="6" class="empty">Nenhuma solicitação registrada. Quando um titular pedir acesso, correção ou eliminação dos dados, registre aqui para controlar o prazo.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">O prazo padrão é de 15 dias corridos (LGPD, art. 19), ajustável em Parâmetros. Para pedidos de acesso, use "Buscar dados" e entregue o relatório ao titular; para eliminação, anonimize os cadastros pela aba Dados pessoais.</p>`;
  $('#so-novo', el).onclick = () => novaSolic(re);
  $$('[data-bus]', el).forEach(b => b.onclick = () => { const s = S.find(x => x.id === b.dataset.bus); ui.busca = s.titular_documento || s.titular_contato || s.titular_nome; ui.aba = 'titular'; ui.res = null; re(); });
  $$('[data-at]', el).forEach(b => b.onclick = () => responder(S.find(x => x.id === b.dataset.at), re));
}

function novaSolic(re) {
  const d = modal({ title: 'Registrar solicitação do titular', body: `<div class="grid-form">
      <label class="span2">Nome do titular<input id="ns-n"></label><label>CPF<input id="ns-d"></label><label>Contato (e-mail ou telefone)<input id="ns-c"></label>
      <label>Pedido<select id="ns-t">${Object.entries(TIPOS_SOLIC).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Recebida em<input type="date" id="ns-r" value="${today()}"></label>
      <label class="span2">Detalhes<textarea id="ns-x" rows="3" placeholder="Como chegou o pedido e o que foi pedido"></textarea></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ns-ok">Registrar</button>' });
  $('#ns-ok', d.el).onclick = async () => {
    const nome = $('#ns-n', d.el).value.trim(); if (nome.length < 3) return toast('Informe o nome do titular', true);
    try { await q(sb.from('lgpd_solicitacoes').insert({ empresa_id: state.empresa.id, titular_nome: nome, titular_documento: $('#ns-d', d.el).value.trim() || null, titular_contato: $('#ns-c', d.el).value.trim() || null,
      tipo: $('#ns-t', d.el).value, recebida_em: $('#ns-r', d.el).value || today(), descricao: $('#ns-x', d.el).value.trim() || null }));
      d.close(); toast('Solicitação registrada'); re(); } catch (e) { fail(e); }
  };
}

function responder(s, re) {
  const d = modal({ title: `Responder: ${s.titular_nome}`, body: `<div class="small muted" style="margin-bottom:8px">${esc(TIPOS_SOLIC[s.tipo])} · recebida em ${dt(s.recebida_em)} · prazo ${dt(s.prazo)}</div>
      <label>Resultado<select id="rs-s"><option value="atendida">Atendida</option><option value="negada">Negada (com a justificativa)</option></select></label>
      <label style="margin-top:8px">Resposta enviada ao titular<textarea id="rs-r" rows="4" placeholder="O que foi feito ou por que não foi possível (ex.: dados guardados por obrigação fiscal)"></textarea></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rs-ok">Concluir</button>' });
  $('#rs-ok', d.el).onclick = async () => {
    const r = $('#rs-r', d.el).value.trim(); if (r.length < 5) return toast('Escreva a resposta dada ao titular', true);
    try { await q(sb.from('lgpd_solicitacoes').update({ status: $('#rs-s', d.el).value, resposta: r }).eq('id', s.id)); d.close(); toast('Solicitação concluída'); re(); } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- Parâmetros
async function config() {
  return (await q(sb.from('lgpd_config').select('*').eq('empresa_id', state.empresa.id).maybeSingle())) || {};
}
async function parametros(re) {
  let c; try { c = await config(); } catch (e) { fail(e); return; }
  const v = (k, p) => c[k] ?? p;
  const d = modal({ title: 'Parâmetros de privacidade e acessos', body: `<div class="grid-form">
      <label>Dias sem entrar para perder o acesso<input type="number" id="pa-d" min="15" max="365" value="${v('inativos_dias', 60)}"></label>
      <label>Avisar a pessoa quantos dias antes<input type="number" id="pa-a" min="0" max="30" value="${v('aviso_dias', 7)}"></label>
      <label>Ao passar do prazo<select id="pa-ac"><option value="suspender" ${v('inativos_acao', 'suspender') === 'suspender' ? 'selected' : ''}>Suspender o acesso</option><option value="avisar" ${v('inativos_acao') === 'avisar' ? 'selected' : ''}>Só avisar o administrador</option></select></label>
      <label>Revisão de acessos a cada (meses)<input type="number" id="pa-r" min="1" max="24" value="${v('revisao_meses', 6)}"></label>
      <label>Prazo de resposta ao titular (dias)<input type="number" id="pa-p" min="1" max="60" value="${v('prazo_resposta_dias', 15)}"></label>
      <div></div>
      <label>Encarregado de dados (nome)<input id="pa-en" value="${esc(v('encarregado_nome', ''))}"></label>
      <label>E-mail do encarregado<input type="email" id="pa-ee" value="${esc(v('encarregado_email', ''))}"></label></div>
    <div style="margin-top:12px;display:grid;gap:6px">${chk('pa-adm', v('incluir_admin', false), 'Suspender também administradores sem uso (nunca o último administrador)')}
      ${chk('pa-por', v('incluir_portal', true), 'Bloquear o acesso do Portal do Cliente sem uso no mesmo prazo')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pa-ok">Salvar</button>' });
  $('#pa-ok', d.el).onclick = async () => {
    const n = (id) => +$(id, d.el).value;
    const row = { empresa_id: state.empresa.id, inativos_dias: n('#pa-d'), aviso_dias: n('#pa-a'), inativos_acao: $('#pa-ac', d.el).value, revisao_meses: n('#pa-r'), prazo_resposta_dias: n('#pa-p'),
      encarregado_nome: $('#pa-en', d.el).value.trim() || null, encarregado_email: $('#pa-ee', d.el).value.trim() || null, incluir_admin: $('#pa-adm', d.el).checked, incluir_portal: $('#pa-por', d.el).checked,
      atualizado_por: state.user?.email, atualizado_em: new Date().toISOString() };
    if (!(row.inativos_dias >= 15 && row.inativos_dias <= 365)) return toast('Dias sem entrar: de 15 a 365', true);
    if (!(row.aviso_dias >= 0 && row.aviso_dias < row.inativos_dias && row.aviso_dias <= 30)) return toast('Aviso: de 0 a 30 dias, menor que o prazo', true);
    if (!(row.revisao_meses >= 1 && row.revisao_meses <= 24)) return toast('Revisão: de 1 a 24 meses', true);
    if (!(row.prazo_resposta_dias >= 1 && row.prazo_resposta_dias <= 60)) return toast('Prazo de resposta: de 1 a 60 dias', true);
    try { await q(sb.from('lgpd_config').upsert(row)); d.close(); toast('Parâmetros salvos'); re(); } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- Central de Decisões (regra 25)
export async function alertasDecisao() {
  if (!isAdmin()) return [];
  try {
    const [S, sol] = await Promise.all([q(sb.rpc('acessos_situacao', { p_empresa: state.empresa.id })), q(sb.from('lgpd_solicitacoes').select('titular_nome,prazo').eq('empresa_id', state.empresa.id).eq('status', 'aberta'))]);
    const out = [], c = S.config;
    const av = S.membros.filter(m => ['aviso', 'avisar', 'suspender'].includes(situacaoAcesso(m, c).k));
    const urg = sol.filter(s => prazoSolicitacao(s.prazo).dias <= 3);
    if (urg.length) out.push({ nivel: urg.some(s => prazoSolicitacao(s.prazo).dias < 0) ? 'alto' : 'medio', titulo: `${urg.length} solicitação(ões) de titular com prazo`, detalhe: urg.map(s => `${s.titular_nome} (${prazoSolicitacao(s.prazo).txt})`).join(', '), aba: 'solic' });
    if (S.proxima_revisao && S.proxima_revisao <= today()) out.push({ nivel: 'medio', titulo: 'Revisão de acessos vencida', detalhe: `prevista para ${dt(S.proxima_revisao)}`, aba: 'acessos' });
    if (av.length) out.push({ nivel: 'baixo', titulo: `${av.length} acesso(s) sem uso`, detalhe: av.slice(0, 5).map(m => `${m.nome} (${m.dias} dias)`).join(', '), aba: 'acessos' });
    return out;
  } catch { return []; }
}

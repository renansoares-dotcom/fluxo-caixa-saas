// Auditoria: quem incluiu, alterou ou excluiu, quando, e o que mudou (antes → depois)
// Leitura só para administrador e diretor (o banco também restringe). Grava a partir da migração 038.
// Melhoria 10.3 (SQL 098): abas "Por registro" (busca pelo que foi gravado, linha do tempo e comparação de duas versões)
// e "Alertas" (ações sensíveis configuráveis: exclusões, dados bancários, papel de usuário, valor pago, travas).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, fail, loading, modal, options, exportXLSX, today, toast } from '../lib/ui.js';
import { versoes, diferencas } from '../lib/auditoria-versoes.js';
export { versoes, diferencas };

export const title = 'Auditoria';

export const TABELAS = {
  lancamentos: 'Lançamento', contas: 'Conta bancária', favorecidos: 'Beneficiário', plano_contas: 'Plano de contas',
  centros_custo: 'Centro de custo', grupos: 'Grupo', orcamentos: 'Orçamento', orcamento_rateio_cc: 'Rateio do orçamento',
  paraquedas: 'Pagamento antecipado', fidc_propostas: 'Proposta de borderô', contas_travas: 'Trava de conta',
  conciliacoes: 'Conciliação', conferencias_dia: 'Conferência do dia', membros: 'Usuário da empresa', creditos: 'Crédito / adiantamento',
  duplicatas: 'Duplicata', autorizacoes: 'Autorização de pagamento', nfe_vinculos: 'Vínculo nota × recebimento',
  contab_depara_plano: 'De-para contábil (classificação)', contab_depara_conta: 'De-para contábil (conta bancária)',
  contab_depara_favorecido: 'De-para contábil (beneficiário)',
};
const CAMPOS = {
  data: 'Data', valor: 'Valor', status: 'Status', plano_id: 'Classificação', conta_id: 'Conta', conta_destino_id: 'Conta de destino',
  favorecido_id: 'Beneficiário', centro_custo_id: 'Centro de custo', descricao: 'Descrição', documento: 'NF / documento', dados_bancarios: 'Dados bancários', pix: 'Pix', forma_pagamento: 'Forma de pagamento',
  emissao: 'Emissão', prioridade: 'Prioridade', opc1: 'Opcional 1', opc2: 'Opcional 2', opc3: 'Opcional 3', opc4: 'Opcional 4',
  nome: 'Nome', codigo: 'Código', ativo: 'Ativo', papel: 'Papel', areas: 'Áreas', saldo_inicial: 'Saldo inicial',
  motivo: 'Motivo', numero: 'Número', razao_social: 'Razão social', documento_cnpj: 'CNPJ', ate: 'Travada até', situacao: 'Situação',
  lancamento_id: 'Lançamento', extrato_id: 'Item do extrato', origem: 'Origem', conta_contabil_id: 'Conta contábil',
};
const ACOES = { incluiu: 'Incluiu', alterou: 'Alterou', excluiu: 'Excluiu' };
const VALOR = /valor|saldo|desagio|liquido|tarifa|face|total/;

let emails = {};
const lancCache = {};

// texto legível de um valor gravado (ids viram nomes do cadastro)
export function fmt(campo, v) {
  if (v == null || v === '') return '<span class="muted">—</span>';
  const c = state.cad;
  if (campo === 'plano_id') return esc(c.planoById[v]?.label || v);
  if (campo === 'conta_id' || campo === 'conta_destino_id') return esc(c.contaById[v]?.nome || v);
  if (campo === 'favorecido_id') return esc(c.favById[v]?.label || v);
  if (campo === 'centro_custo_id') return esc(c.ccById[v]?.nome || v);
  if (campo === 'user_id') return esc(emails[v] || v);
  if (typeof v === 'number' && VALOR.test(campo)) return money(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return dateBR(v);
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'object') return `<code class="small">${esc(JSON.stringify(v))}</code>`;
  return esc(v);
}

// resumo do registro numa linha (para lançamentos usa o lançamento atual ou o gravado)
function resumo(a) {
  const c = state.cad, r = { ...(a.antes || {}), ...(a.depois || {}), ...(lancCache[a.registro_id] || {}) };
  if (a.tabela === 'lancamentos') {
    const p = c.planoById[r.plano_id];
    return [r.data && dateBR(r.data), r.valor != null && money(r.valor), p?.label, c.favById[r.favorecido_id]?.nome, r.descricao].filter(Boolean).join(' · ');
  }
  if (a.tabela === 'plano_contas') return c.planoById[a.registro_id]?.label || [r.codigo, r.nome].filter(Boolean).join(' ');
  if (a.tabela === 'favorecidos') return c.favById[a.registro_id]?.label || r.nome;
  if (a.tabela === 'contas') return c.contaById[a.registro_id]?.nome || r.nome;
  if (a.tabela === 'centros_custo') return c.ccById[a.registro_id]?.nome || r.nome;
  if (a.tabela === 'membros') return emails[r.user_id] || r.user_id;
  if (a.tabela === 'paraquedas') return r.numero ? `PA nº ${r.numero}` : '';
  if (a.tabela === 'fidc_propostas') return r.numero ? `Proposta nº ${r.numero}` : '';
  if (a.tabela === 'contas_travas') return [c.contaById[r.conta_id]?.nome, r.ate && 'até ' + dateBR(r.ate)].filter(Boolean).join(' ');
  if (a.tabela === 'conferencias_dia') return [c.contaById[r.conta_id]?.nome, r.data && dateBR(r.data), r.situacao].filter(Boolean).join(' · ');
  return r.nome || r.descricao || '';
}

const quando = (iso) => { const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const quem = (a) => esc(emails[a.user_id] || a.user_email || (a.user_id ? a.user_id.slice(0, 8) : 'sistema / importação'));

export function detalhe(a) {
  const campos = a.acao === 'alterou' ? a.campos : Object.keys(a.antes || a.depois || {}).filter(k => k !== 'empresa_id');
  const linhas = campos.map(k => `<tr><td>${esc(CAMPOS[k] || k)}</td>
    ${a.acao !== 'incluiu' ? `<td>${fmt(k, a.antes?.[k])}</td>` : ''}${a.acao !== 'excluiu' ? `<td>${fmt(k, a.depois?.[k])}</td>` : ''}</tr>`).join('');
  const pode = ['admin', 'diretor'].includes(state.papel);
  const m = modal({ title: `${ACOES[a.acao]} · ${TABELAS[a.tabela] || a.tabela}`, wide: true, body: `
    <p class="small muted" style="margin-top:0">${quando(a.criado_em)} · ${quem(a)}${resumo(a) ? ' · ' + esc(resumo(a)) : ''}</p>
    ${a.operacao ? `<p class="small" style="margin-top:0">Faz parte da operação <strong>${esc(a.operacao_nome || '')}</strong>: desfazer volta a operação inteira.</p>` : ''}
    <div class="table-wrap"><table><thead><tr><th>Campo</th>${a.acao !== 'incluiu' ? '<th>Antes</th>' : ''}${a.acao !== 'excluiu' ? '<th>Depois</th>' : ''}</tr></thead>
    <tbody>${linhas || '<tr><td colspan="3" class="empty">Sem campos.</td></tr>'}</tbody></table></div>`,
    foot: `<button class="btn" data-close>Fechar</button>${pode ? '<button class="btn danger" id="au-desf">Desfazer</button>' : ''}` });
  const b = $('#au-desf', m.el);
  if (b) b.onclick = async () => {
    if (!confirm(a.operacao ? `Desfazer a operação "${a.operacao_nome || ''}" inteira?` : 'Desfazer esta alteração?')) return;
    b.disabled = true;
    try {
      const r = a.operacao ? await q(sb.rpc('desfazer_operacao', { p_operacao: a.operacao })) : await q(sb.rpc('desfazer_auditoria', { p_id: a.id }));
      toast(a.operacao ? `Operação desfeita (${(r || []).length} passo(s))` : `Desfeito: ${r}`); m.close();
    } catch (err) { fail(err); b.disabled = false; }
  };
}

async function carregarEmails() {
  try { for (const m of await q(sb.rpc('listar_membros', { p_empresa: state.empresa.id }))) emails[m.user_id] = m.email; } catch {}
}
async function completarLancamentos(rows) {
  const ids = [...new Set(rows.filter(a => a.tabela === 'lancamentos' && !lancCache[a.registro_id]).map(a => a.registro_id))];
  for (let i = 0; i < ids.length; i += 150) {
    try { for (const l of await q(sb.from('lancamentos').select('id,data,valor,plano_id,favorecido_id,descricao').in('id', ids.slice(i, i + 150)))) lancCache[l.id] = l; } catch {}
  }
}

const podeVer = () => ['admin', 'diretor'].includes(state.papel);

export async function render(root) {
  if (!podeVer()) { root.innerHTML = '<div class="card"><p>A auditoria é visível só para o administrador e o diretor.</p></div>'; return; }
  const naoVistos = (await q(sb.from('audit_alertas').select('id').eq('empresa_id', state.empresa.id).is('visto_em', null).limit(100)).catch(() => [])).length;
  const prm = new URLSearchParams(location.hash.split('?')[1] || '');
  if (['movimentos', 'registro', 'alertas'].includes(prm.get('aba'))) ABA.v = prm.get('aba');
  if (!ABA.v) ABA.v = 'movimentos';
  const abas = `<div class="card toolbar" style="margin-bottom:12px"><div class="chips" id="au-abas">${[['movimentos', 'Movimentos'], ['registro', 'Por registro'], ['alertas', `Alertas${naoVistos ? ` <span class="badge vencido">${naoVistos}</span>` : ''}`]].map(([k, t]) => `<span class="chip ${ABA.v === k ? 'on' : ''}" data-ab="${k}">${t}</span>`).join('')}</div></div>`;
  if (ABA.v === 'registro') return porRegistro(root, abas);
  if (ABA.v === 'alertas') return alertas(root, abas);
  const d7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  root.innerHTML = `${abas}<div class="toolbar card">
      <label>De<input type="date" id="au-de" value="${d7}"></label>
      <label>Até<input type="date" id="au-ate" value="${today()}"></label>
      <label>Onde<select id="au-tab"><option value="">Tudo</option>${Object.entries(TABELAS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label>Ação<select id="au-acao"><option value="">Todas</option>${options(Object.entries(ACOES).map(([id, nome]) => ({ id, nome })))}</select></label>
      <label>Usuário<select id="au-user"><option value="">Todos</option></select></label>
      <label>Procurar<input id="au-busca" placeholder="valor, descrição, nº…"></label>
      <span class="spacer"></span><button class="btn" id="au-exp">Exportar Excel</button>
    </div>
    <p class="small muted">Registro de inclusões, alterações e exclusões a partir da ativação da auditoria. Clique numa linha para ver o antes e o depois.</p>
    <div class="card flush"><div class="table-wrap" id="au-tbl"></div></div>
    <div style="text-align:center;margin:10px" id="au-mais"></div>`;
  ligarAbas(root);
  await carregarEmails();
  $('#au-user', root).innerHTML = '<option value="">Todos</option><option value="sistema">Sistema / importação</option>' +
    Object.entries(emails).map(([id, e]) => `<option value="${id}">${esc(e)}</option>`).join('');
  let rows = [], pagina = 0;
  const PAG = 300;
  const buscar = async (mais = false) => {
    const tbl = $('#au-tbl', root);
    if (!mais) { rows = []; pagina = 0; loading(tbl); }
    try {
      const ate = new Date($('#au-ate', root).value + 'T00:00:00'); ate.setDate(ate.getDate() + 1);
      let qy = sb.from('auditoria').select('*').eq('empresa_id', state.empresa.id)
        .gte('criado_em', $('#au-de', root).value + 'T00:00:00').lt('criado_em', ate.toISOString().slice(0, 10) + 'T00:00:00')
        .order('criado_em', { ascending: false }).order('id', { ascending: false }).range(pagina * PAG, pagina * PAG + PAG - 1);
      if ($('#au-tab', root).value) qy = qy.eq('tabela', $('#au-tab', root).value);
      if ($('#au-acao', root).value) qy = qy.eq('acao', $('#au-acao', root).value);
      const u = $('#au-user', root).value;
      if (u === 'sistema') qy = qy.is('user_id', null); else if (u) qy = qy.eq('user_id', u);
      const novos = await q(qy);
      await completarLancamentos(novos);
      rows = rows.concat(novos); pagina++;
      $('#au-mais', root).innerHTML = novos.length === PAG ? '<button class="btn" id="au-mais-btn">Carregar mais</button>' : '';
      $('#au-mais-btn', root) && ($('#au-mais-btn', root).onclick = () => buscar(true));
      pintar();
    } catch (e) {
      fail(e);
      tbl.innerHTML = /auditoria/.test(e?.message || '') ? '<div class="empty">Não foi possível carregar a auditoria. Recarregue a página.</div>' : '';
    }
  };
  const visiveis = () => {
    const t = $('#au-busca', root).value.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(a => (resumo(a) + ' ' + JSON.stringify(a.antes || '') + ' ' + JSON.stringify(a.depois || '') + ' ' + (a.registro_id || '')).toLowerCase().includes(t));
  };
  const pintar = () => {
    const v = visiveis();
    $('#au-tbl', root).innerHTML = `<table><thead><tr><th>Quando</th><th>Usuário</th><th>Onde</th><th>Ação</th><th>Registro</th><th>O que mudou</th></tr></thead><tbody>
      ${v.map((a, i) => `<tr class="clickable" data-i="${rows.indexOf(a)}">
        <td class="nowrap">${quando(a.criado_em)}</td><td>${quem(a)}</td><td>${esc(TABELAS[a.tabela] || a.tabela)}</td>
        <td><span class="badge ${a.acao === 'excluiu' ? 'vencido' : a.acao === 'incluiu' ? 'pago' : 'aberto'}">${ACOES[a.acao]}</span></td>
        <td class="wrap">${esc(resumo(a))}</td>
        <td class="wrap small">${a.acao === 'alterou' ? a.campos.map(k => `${esc(CAMPOS[k] || k)}: ${fmt(k, a.antes?.[k])} → ${fmt(k, a.depois?.[k])}`).join('<br>') : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nada registrado no período.</td></tr>'}</tbody></table>`;
    $$('tr[data-i]', root).forEach(tr => tr.onclick = () => detalhe(rows[+tr.dataset.i]));
  };
  ['au-de', 'au-ate', 'au-tab', 'au-acao', 'au-user'].forEach(id => $('#' + id, root).onchange = () => buscar());
  $('#au-busca', root).oninput = pintar;
  $('#au-exp', root).onclick = () => exportXLSX([['Quando', 'Usuário', 'Onde', 'Ação', 'Registro', 'Campos', 'Antes', 'Depois'],
    ...visiveis().map(a => [quando(a.criado_em), emails[a.user_id] || a.user_email || 'sistema', TABELAS[a.tabela] || a.tabela, ACOES[a.acao],
      resumo(a), (a.campos || []).join(', '), JSON.stringify(a.antes || ''), JSON.stringify(a.depois || '')])], `auditoria_${today()}`);
  await buscar();
}

// histórico de um registro (botão "Histórico" no lançamento e nas outras telas): linha do tempo com as versões
export async function abrirHistorico(tabela, id, titulo = '') { return linhaDoTempo(tabela, id, titulo); }

const ABA = { v: null };
function ligarAbas(root) { $('#au-abas', root).onclick = (e) => { const a = e.target.closest('[data-ab]')?.dataset.ab; if (a && a !== ABA.v) { ABA.v = a; if (location.hash.includes('?')) history.replaceState(null, '', '#/auditoria'); render(root); } }; }

export async function linhaDoTempo(tabela, id, titulo = '') {
  try {
    if (!Object.keys(emails).length) await carregarEmails();
    const rows = await q(sb.from('auditoria').select('*').eq('empresa_id', state.empresa.id).eq('tabela', tabela).eq('registro_id', id).order('criado_em').order('id').limit(500));
    let atual = null;
    if (/^[0-9a-f-]{36}$/.test(id)) atual = await q(sb.from(tabela).select('*').eq('id', id).maybeSingle()).catch(() => null);
    const V = versoes(rows, atual);
    let A = Math.max(0, V.length - 2), B = V.length - 1, todos = false;
    const m = modal({ title: `Histórico · ${TABELAS[tabela] || tabela}${titulo ? ' · ' + titulo : ''}`, wide: true, body: '<div id="lt"></div>', foot: '<button class="btn" data-close>Fechar</button>' });
    const pintar = () => {
      if (!V.length) { $('#lt', m.el).innerHTML = '<p class="muted">Nenhum registro de alteração desde a ativação da auditoria.</p>'; return; }
      const va = V[A]?.estado || {}, vb = V[B]?.estado || {}, ks = diferencas(va, vb, todos);
      $('#lt', m.el).innerHTML = `<p class="small muted" style="margin-top:0">${V.length} versão(ões). Marque <b>A</b> e <b>B</b> para comparar; clique na linha para ver o antes e o depois daquela mudança.${!atual && V[V.length - 1]?.excluido ? ' <b class="neg">O registro foi excluído</b>: as versões são montadas pela auditoria.' : ''}</p>
        <div class="table-wrap" style="max-height:34vh"><table><thead><tr><th>A</th><th>B</th><th>Versão</th><th>Quando</th><th>Usuário</th><th>Ação</th><th>O que mudou</th></tr></thead><tbody>
        ${V.map((v, i) => { const a = v.e; return `<tr class="clickable ${i === A || i === B ? 'row-sel' : ''}" data-i="${i}"><td><input type="radio" name="va" value="${i}" ${i === A ? 'checked' : ''}></td><td><input type="radio" name="vb" value="${i}" ${i === B ? 'checked' : ''}></td>
          <td><b>v${i + 1}</b></td><td class="nowrap">${quando(a.criado_em)}</td><td>${quem(a)}</td><td><span class="badge ${a.acao === 'excluiu' ? 'vencido' : a.acao === 'incluiu' ? 'pago' : 'aberto'}">${ACOES[a.acao]}</span></td>
          <td class="wrap small">${a.acao === 'alterou' ? a.campos.map(k => `${esc(CAMPOS[k] || k)}: ${fmt(k, a.antes?.[k])} → ${fmt(k, a.depois?.[k])}`).join('<br>') : ''}</td></tr>`; }).join('')}</tbody></table></div>
        <div style="display:flex;align-items:center;gap:16px;margin:14px 0 6px"><h3 style="margin:0">Comparar v${A + 1} × v${B + 1}</h3><span class="small" style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="lt-todos" ${todos ? 'checked' : ''} style="width:auto;min-height:0"> mostrar todos os campos</span></div>
        <div class="table-wrap" style="max-height:34vh"><table><thead><tr><th>Campo</th><th>v${A + 1} · ${quando(V[A].e.criado_em)}</th><th>v${B + 1} · ${quando(V[B].e.criado_em)}</th></tr></thead><tbody>
        ${ks.map(k => { const d = JSON.stringify(va[k] ?? null) !== JSON.stringify(vb[k] ?? null); return `<tr class="${d ? '' : 'muted'}"><td>${d ? '<b>' : ''}${esc(CAMPOS[k] || k)}${d ? '</b>' : ''}</td><td>${fmt(k, va[k])}</td><td>${d ? `<b>${fmt(k, vb[k])}</b>` : fmt(k, vb[k])}</td></tr>`; }).join('')
          || '<tr><td colspan="3" class="empty">As duas versões são iguais.</td></tr>'}</tbody></table></div>`;
      $('#lt-todos', m.el).onchange = (e) => { todos = e.target.checked; pintar(); };
      $$('tr[data-i]', m.el).forEach(tr => tr.onclick = (e) => {
        if (e.target.name === 'va') { A = +e.target.value; return pintar(); }
        if (e.target.name === 'vb') { B = +e.target.value; return pintar(); }
        detalhe(V[+tr.dataset.i].e);
      });
    };
    pintar();
  } catch (e) { fail(e); }
}

// aba "Por registro": busca pelo que foi gravado (nº, nome, valor, descrição, id) e abre a linha do tempo
async function porRegistro(root, abas) {
  root.innerHTML = `${abas}<div class="toolbar card">
      <label>Onde<select id="pr-tab"><option value="">Tudo</option>${Object.entries(TABELAS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label class="grow">Procurar o registro<input id="pr-b" placeholder="ex.: 4357, MASTERCOLA, PA nº 21, 3186.08, ALUGUEL…"></label>
      <label>De<input type="date" id="pr-de"></label><label>Até<input type="date" id="pr-ate"></label><button class="btn primary" id="pr-ok">Buscar</button></div>
    <p class="small muted">Procura em tudo o que foi gravado na auditoria: número, nome, descrição, valor (com ponto: 3186.08) ou o identificador. Clique no registro para ver a linha do tempo e comparar as versões.</p>
    <div class="card flush"><div class="table-wrap" id="pr-res"><div class="empty">Digite o que procurar.</div></div></div>`;
  ligarAbas(root);
  await carregarEmails();
  const buscar = async () => {
    const t = $('#pr-b', root).value.trim(); if (t.length < 2) return toast('Digite pelo menos 2 caracteres', true);
    const box = $('#pr-res', root); loading(box);
    try {
      const R = await q(sb.rpc('auditoria_registros', { p_empresa: state.empresa.id, p_tabela: $('#pr-tab', root).value || null, p_busca: t, p_de: $('#pr-de', root).value || null, p_ate: $('#pr-ate', root).value || null }));
      const res = (r) => resumo({ tabela: r.tabela, registro_id: r.registro_id, antes: r.foto, depois: r.foto });
      box.innerHTML = R.length ? `<table><thead><tr><th>Onde</th><th>Registro</th><th class="num">Mudanças</th><th>Primeira</th><th>Última</th><th>Quem mexeu</th></tr></thead><tbody>
        ${R.map((r, i) => `<tr class="clickable" data-i="${i}"><td>${esc(TABELAS[r.tabela] || r.tabela)}</td><td class="wrap">${esc(res(r) || r.registro_id)}${r.excluido ? ' <span class="badge vencido">excluído</span>' : ''}</td>
          <td class="num">${r.eventos}</td><td class="nowrap">${quando(r.primeiro)}</td><td class="nowrap">${quando(r.ultimo)}</td><td class="small wrap">${esc(r.usuarios || '')}</td></tr>`).join('')}</tbody></table>`
        : '<div class="empty">Nenhum registro com esse texto na auditoria.</div>';
      $$('tr[data-i]', box).forEach(tr => tr.onclick = () => { const r = R[+tr.dataset.i]; linhaDoTempo(r.tabela, r.registro_id, res(r)); });
    } catch (e) { fail(e); box.innerHTML = '<div class="empty">Não foi possível buscar. Confira se o SQL 098 já foi executado.</div>'; }
  };
  $('#pr-ok', root).onclick = buscar; $('#pr-b', root).onkeydown = (e) => { if (e.key === 'Enter') buscar(); };
  // link direto: #/auditoria?aba=registro&q=texto (ex.: a partir de outra tela)
  const qq = new URLSearchParams(location.hash.split('?')[1] || '').get('q'); if (qq) { $('#pr-b', root).value = qq; buscar(); }
}

// aba "Alertas": ações sensíveis (SQL 098)
const REGRAS = {
  exclusao: ['Exclusões', 'Exclusão de lançamento, beneficiário, conta, plano de contas, PA, borderô, contrato, conciliação ou usuário (as tabelas são escolhidas abaixo).'],
  banco_beneficiario: ['Dados bancários de beneficiário', 'Mudança de dados bancários, Pix, forma de pagamento ou CNPJ/CPF do beneficiário (golpe do fornecedor).'],
  papel_usuario: ['Usuários e permissões', 'Usuário incluído ou removido da empresa, ou com o papel / as áreas alteradas.'],
  valor_pago: ['Valor de lançamento pago', 'Valor alterado em lançamento já pago.'],
  trava_conta: ['Trava de conta', 'Trava do fechamento removida ou alterada.'],
  conta_bancaria: ['Dados da conta bancária', 'Número, agência, banco, vínculo do extrato ou saldo inicial da conta alterados.'],
  fora_horario: ['Fora do horário', 'Qualquer mudança em lançamentos, beneficiários, contas, PAs ou usuários fora do horário de trabalho ou no fim de semana.'],
};
async function alertas(root, abas) {
  root.innerHTML = `${abas}<div class="toolbar card"><div class="chips" id="al-f"><span class="chip on" data-f="nao">Não vistos</span><span class="chip" data-f="todos">Todos</span></div>
      <span class="spacer"></span><button class="btn" id="al-visto" disabled>Marcar como visto</button><button class="btn" id="al-par">Parâmetros</button></div>
    <div class="card flush"><div class="table-wrap" id="al-tbl"><div class="loading">Carregando…</div></div></div>
    <p class="small muted">Os alertas avisam o administrador e o diretor (configurável) no sino, no celular e por e-mail, conforme as preferências em Meus avisos (tipo "Ações sensíveis"). Quem fez a ação não recebe o próprio alerta.</p>`;
  ligarAbas(root);
  let f = 'nao', R = [], cfg = null;
  const carregar = async () => {
    try {
      let qy = sb.from('audit_alertas').select('*').eq('empresa_id', state.empresa.id).order('criado_em', { ascending: false }).limit(500);
      if (f === 'nao') qy = qy.is('visto_em', null);
      [R, cfg] = await Promise.all([q(qy), q(sb.from('audit_alertas_config').select('*').eq('empresa_id', state.empresa.id)).then(x => x[0] || null)]);
    } catch (e) { fail(e); $('#al-tbl', root).innerHTML = '<div class="empty">Não foi possível carregar. Confira se o SQL 098 já foi executado.</div>'; return; }
    $('#al-tbl', root).innerHTML = R.length ? `<table><thead><tr><th><input type="checkbox" id="al-all"></th><th>Quando</th><th>Alerta</th><th>Detalhe</th><th>Quem fez</th><th>Visto</th><th></th></tr></thead><tbody>
      ${R.map((a, i) => `<tr><td>${a.visto_em ? '' : `<input type="checkbox" data-al="${a.id}">`}</td><td class="nowrap">${quando(a.criado_em)}</td><td><b>${esc(a.titulo)}</b><div class="small muted">${esc(REGRAS[a.regra]?.[0] || a.regra)}</div></td>
        <td class="wrap small">${esc(a.detalhe || '')}</td><td class="small">${esc(a.user_email || 'sistema')}</td><td class="small">${a.visto_em ? `${esc(a.visto_por || '')}<div class="muted">${quando(a.visto_em)}</div>` : '<span class="badge vencido">novo</span>'}</td>
        <td>${a.auditoria_id ? `<button class="btn ghost small" data-ver="${i}">Ver</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${f === 'nao' ? 'Nenhum alerta novo.' : 'Nenhum alerta registrado.'}</div>`;
    const marcados = () => $$('[data-al]:checked', root).map(x => +x.dataset.al);
    $('#al-all', root) && ($('#al-all', root).onchange = (e) => { $$('[data-al]', root).forEach(x => x.checked = e.target.checked); $('#al-visto', root).disabled = !marcados().length; });
    $('#al-tbl', root).onchange = () => { $('#al-visto', root).disabled = !marcados().length; };
    $$('[data-ver]', root).forEach(b => b.onclick = async () => { try { const [a] = await q(sb.from('auditoria').select('*').eq('id', R[+b.dataset.ver].auditoria_id)); if (a) { await carregarEmails(); detalhe(a); } } catch (e) { fail(e); } });
  };
  $('#al-f', root).onclick = (e) => { const x = e.target.closest('[data-f]'); if (!x) return; f = x.dataset.f; $$('#al-f .chip', root).forEach(c => c.classList.toggle('on', c === x)); carregar(); };
  $('#al-visto', root).onclick = async (ev) => { const ids = $$('[data-al]:checked', root).map(x => +x.dataset.al); if (!ids.length) return; ev.target.disabled = true;
    try { const n = await q(sb.rpc('audit_alertas_visto', { p_ids: ids })); toast(`${n} alerta(s) marcado(s) como visto(s)`); render(root); } catch (e) { fail(e); ev.target.disabled = false; } };
  $('#al-par', root).onclick = () => parametrosAlertas(cfg, () => carregar());
  await carregar();
}

function parametrosAlertas(cfg, depois) {
  const c = cfg || {}, rg = { exclusao: true, banco_beneficiario: true, papel_usuario: true, valor_pago: true, trava_conta: true, conta_bancaria: true, fora_horario: false, ...(c.regras || {}) };
  const tabs = c.tabelas_exclusao || ['lancamentos', 'favorecidos', 'contas', 'plano_contas', 'paraquedas', 'fidc_propostas', 'contratos', 'conciliacoes', 'membros'];
  const papeis = c.papeis || ['admin', 'diretor'];
  const ROT_P = { admin: 'Administrador', diretor: 'Diretor', financeiro: 'Financeiro' };
  const chk = (attr, val, on, txt) => `<label style="display:inline-flex;flex-direction:row;gap:6px;align-items:center;font-weight:400;margin:0 14px 6px 0"><input type="checkbox" ${attr}="${val}" ${on ? 'checked' : ''} style="width:auto;min-height:0"> ${txt}</label>`;
  const m = modal({ title: 'Parâmetros dos alertas', wide: true, body: `<h3 style="margin-top:0">O que gera alerta</h3>
    ${Object.entries(REGRAS).map(([k, [t, d]]) => `<div style="margin-bottom:6px">${chk('data-rg', k, rg[k], `<b>${t}</b>`)}<div class="small muted" style="margin:-4px 0 0 24px">${d}</div></div>`).join('')}
    <h3>Exclusões de</h3><div>${Object.entries(TABELAS).map(([k, v]) => chk('data-tb', k, tabs.includes(k), v)).join('')}</div>
    <div class="grid-form" style="margin-top:8px"><label class="c3">Horário de trabalho: início (h)<input id="ap-hi" inputmode="numeric" value="${c.horario_ini ?? 7}"></label><label class="c3">fim (h)<input id="ap-hf" inputmode="numeric" value="${c.horario_fim ?? 20}"></label></div>
    <h3>Quem recebe</h3><div>${Object.entries(ROT_P).map(([k, v]) => chk('data-pp', k, papeis.includes(k), v)).join('')}</div>
    ${chk('id', 'ap-sis', c.ignorar_sistema !== false, 'Não alertar rotinas e importações sem usuário')}`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ap-ok">Salvar</button>' });
  $('#ap-ok', m.el).onclick = async (ev) => {
    const regras = Object.fromEntries(Object.keys(REGRAS).map(k => [k, !!m.el.querySelector(`[data-rg="${k}"]`)?.checked]));
    const row = { empresa_id: state.empresa.id, regras, tabelas_exclusao: $$('[data-tb]', m.el).filter(x => x.checked).map(x => x.dataset.tb), papeis: $$('[data-pp]', m.el).filter(x => x.checked).map(x => x.dataset.pp),
      horario_ini: Math.min(23, Math.max(0, parseInt($('#ap-hi', m.el).value, 10) || 0)), horario_fim: Math.min(24, Math.max(1, parseInt($('#ap-hf', m.el).value, 10) || 24)),
      ignorar_sistema: m.el.querySelector('[id="ap-sis"]').checked, atualizado_em: new Date().toISOString() };
    if (!row.papeis.length) return toast('Escolha ao menos um papel para receber os alertas', true);
    ev.target.disabled = true;
    try { await q(sb.from('audit_alertas_config').upsert(row)); m.close(); toast('Parâmetros salvos'); depois(); } catch (e) { fail(e); ev.target.disabled = false; }
  };
}

/** alertas para a Central de Decisões (regra 24) */
export async function alertasDecisao() {
  if (!podeVer()) return [];
  try {
    const R = await q(sb.from('audit_alertas').select('regra,titulo,detalhe,user_email').eq('empresa_id', state.empresa.id).is('visto_em', null).order('criado_em', { ascending: false }).limit(200));
    if (!R.length) return [];
    const cont = {}; for (const a of R) cont[a.titulo] = (cont[a.titulo] || 0) + 1;
    return [{ nivel: R.some(a => ['banco_beneficiario', 'papel_usuario'].includes(a.regra)) ? 'alto' : 'medio', titulo: `${R.length} ação(ões) sensível(is) para conferir`, valor: 0,
      detalhe: Object.entries(cont).slice(0, 4).map(([t, n]) => `${t} (${n})`).join(' · ') }];
  } catch { return []; }
}

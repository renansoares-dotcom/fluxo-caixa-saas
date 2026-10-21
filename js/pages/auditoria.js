// Auditoria: quem incluiu, alterou ou excluiu, quando, e o que mudou (antes → depois)
// Leitura só para administrador e diretor (o banco também restringe). Grava a partir da migração 038.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, fail, loading, modal, options, exportXLSX, today, toast } from '../lib/ui.js';

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
  favorecido_id: 'Beneficiário', centro_custo_id: 'Centro de custo', descricao: 'Descrição', documento: 'NF / documento',
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
function fmt(campo, v) {
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
  const d7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  root.innerHTML = `<div class="toolbar card">
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
      tbl.innerHTML = /auditoria/.test(e?.message || '') ? '<div class="empty">Rode a migração 20261016000038_auditoria.sql para ligar a auditoria.</div>' : '';
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

// histórico de um registro (botão "Histórico" no lançamento)
export async function abrirHistorico(tabela, id) {
  try {
    if (!Object.keys(emails).length) await carregarEmails();
    const rows = await q(sb.from('auditoria').select('*').eq('empresa_id', state.empresa.id).eq('tabela', tabela).eq('registro_id', id).order('criado_em', { ascending: false }).limit(200));
    const m = modal({ title: 'Histórico', wide: true, body: rows.length ? `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>O que mudou</th></tr></thead><tbody>
      ${rows.map((a, i) => `<tr class="clickable" data-i="${i}"><td class="nowrap">${quando(a.criado_em)}</td><td>${quem(a)}</td><td>${ACOES[a.acao]}</td>
        <td class="wrap small">${a.acao === 'alterou' ? a.campos.map(k => `${esc(CAMPOS[k] || k)}: ${fmt(k, a.antes?.[k])} → ${fmt(k, a.depois?.[k])}`).join('<br>') : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">Nenhum registro de alteração desde a ativação da auditoria.</p>' });
    $$('tr[data-i]', m.el).forEach(tr => tr.onclick = () => detalhe(rows[+tr.dataset.i]));
  } catch (e) { fail(e); }
}

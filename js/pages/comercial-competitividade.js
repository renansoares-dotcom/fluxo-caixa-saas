// Comercial › Análise de Competitividade de Preço (COM009) — SQL 197, 26/11/2026.
// Renan: "comparar a nossa proposta com o preço que o cliente já paga a outro fornecedor, vendo o custo líquido para o cliente
// depois dos créditos e dos impostos de cada caminho". Cálculo em js/lib/competitividade.js (testes com o caso real Sergipe × PE);
// parâmetros por vigência e por empresa (alíquota interna por UF/NCM, regra interestadual, antecipação) pré-carregados e editáveis;
// PRODEPE/FEEF/PIS-COFINS da Apuração (fisc_param) e CBS/IBS do Simulador da reforma (trib_aliquotas). A margem é interna:
// só os papéis liberados e os usuários liberados um a um veem (Parâmetros).
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, money, dateBR, today, exportXLSX, parseNum, confirmDialog } from '../lib/ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { TIPOS_CLIENTE, REGIMES_CLIENTE, UFS, STATUS, perfilPadrao, aliqInterna, regraInter, aliqInterSugerida, antecipacaoPct,
  analisar, simularReforma, br, fmtPct } from '../lib/competitividade.js';
import { relatorioAnalise, relatorioHistorico } from '../lib/competitividade-relatorio.js';

export const title = 'Análise de Competitividade de Preço';
const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['vendas', 'Vendas'], ['leitura', 'Leitura'], ['compras', 'Compras'], ['producao', 'Produção']];
const STB = { negociacao: 'negoc', ganha: 'pago', perdida: 'vencido' };
const opt = (L, sel) => L.map(([v, t]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
const num = (v) => (v == null || v === '' ? '' : String(+v).replace('.', ','));
let D = null;
const ui = { aba: 'nova', busca: '', status: '', de: '', ate: '' };

const F0 = () => ({
  id: null, numero: null, data: today(), status: 'negociacao',
  cliente_id: '', cliente_nome: '', cliente: { uf: 'PE', tipo: 'industria', regime: 'real', cred_icms: true, cred_pc: true, documento: '' },
  produto_id: '', produto_desc: '', ncm: '',
  concorrente: { nome: '', uf: '', preco: '', aliq: '', aliq_manual: false, importado: false, simples: false, credito_simples_pct: '', frete_tipo: 'CIF', frete_un: '', prazo_dias: '' },
  proposta: { preco: '', aliq: '', aliq_manual: false, frete_tipo: 'CIF', frete_un: '', prazo_dias: '', credito_simples_pct: '' },
  margem: { custo_un: '', custo_fonte: '', cred_insumos_un: '', despesas_pct: null, margem_min_pct: null },
  reforma: false,
});

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id, ac = await q(sb.rpc('comp_acesso', { p_empresa: e }));
    if (!ac?.usa) { root.innerHTML = '<div class="card"><div class="empty">Seu perfil não usa a análise de competitividade. O administrador libera em Análise de Competitividade › Parâmetros.</div></div>'; return; }
    try { const k = await q(sb.rpc('comp_configurar', { p_empresa: e })); if (k) toast('Parâmetros pré-carregados: alíquota interna das 27 UFs, regra interestadual e antecipação de PE (a conferir em Parâmetros)'); } catch (err) { fail(err); }
    const [cfg, interna, regra, antec, base, clientes, geo, produtos, analises, margens] = await Promise.all([
      q(sb.from('com_comp_config').select('*').eq('empresa_id', e).maybeSingle()),
      fetchAll(() => sb.from('fisc_icms_interna').select('*').eq('empresa_id', e).order('uf')),
      q(sb.from('fisc_icms_inter_regra').select('*').eq('empresa_id', e).order('vigencia_inicio')),
      q(sb.from('fisc_antecipacao').select('*').eq('empresa_id', e).order('uf_destino')),
      q(sb.rpc('comp_base', { p_empresa: e })),
      q(sb.rpc('comercial_clientes', { p_empresa: e })).catch(() => []),
      q(sb.rpc('comercial_geo_clientes', { p_empresa: e })).catch(() => []),
      fetchAll(() => sb.from('produtos').select('id,codigo,descricao,ncm,unidade,ativo').eq('empresa_id', e).eq('ativo', true).order('descricao')).catch(() => []),
      fetchAll(() => sb.from('com_competitividade').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
      ac.margem ? fetchAll(() => sb.from('com_competitividade_margem').select('*').eq('empresa_id', e)) : Promise.resolve([])]);
    const ufCli = Object.fromEntries((geo || []).filter(g => g.uf).map(g => [g.id, g.uf]));
    D = { ac, cfg: cfg || {}, interna, regra, antec, base: base || {}, clientes: (clientes || []).filter(c => c.ativo !== false), ufCli, produtos, analises,
      margens: Object.fromEntries(margens.map(m => [m.analise_id, m.dados])), root, F: D?.F || { ...F0(), reforma: !!cfg?.reforma_padrao } };
    pintar();
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 197 já foi executado.</div></div>'; }
}
const recarregar = () => render(D.root);

function pintar() {
  const root = D.root, abas = [['nova', D.F.id ? `Análise nº ${D.F.numero}` : 'Nova análise'], ['historico', `Histórico (${D.analises.length})`], ['parametros', 'Parâmetros']];
  const L = D.analises, fech = L.filter(a => a.status !== 'negociacao'), ganhas = L.filter(a => a.status === 'ganha').length;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Análise de Competitividade de Preço</h2><div class="muted small">Compara o custo líquido para o cliente — preço menos os créditos de ICMS e PIS/COFINS, mais o DIFAL ou a antecipação que ele não recupera — entre o fornecedor atual e a nossa proposta.</div></div></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Análises</div><div class="k-value">${L.length}</div><div class="k-sub">${L.filter(a => a.status === 'negociacao').length} em negociação</div></div>
      <div class="kpi"><div class="k-label">Ganhas</div><div class="k-value">${ganhas}</div><div class="k-sub">${fech.length ? `${Math.round(ganhas / fech.length * 100)}% das fechadas` : 'nenhuma fechada'}</div></div>
      <div class="kpi"><div class="k-label">Perdidas</div><div class="k-value">${L.filter(a => a.status === 'perdida').length}</div><div class="k-sub">motivo registrado no status</div></div>
      <div class="kpi"><div class="k-label">Nossa empresa</div><div class="k-value">${esc(D.base.uf || '—')}</div><div class="k-sub">${esc(({ real: 'Lucro Real', presumido: 'Lucro Presumido', simples: 'Simples Nacional', mei: 'MEI' })[D.base.regime] || 'regime não cadastrado')}</div></div>
    </div>
    <div class="chips" id="cp-abas" style="margin:4px 0 10px">${abas.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div><div id="cp-corpo"></div>`;
  $('#cp-abas', root).onclick = (ev) => { const a = ev.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(); } };
  ({ nova: abaNova, historico: abaHistorico, parametros: abaParametros })[ui.aba]($('#cp-corpo', root));
}

// ============================================================ cálculo a partir do formulário
function montar(F = D.F) {
  const c = F.cliente, k = F.concorrente, p = F.proposta, data = F.data || today();
  const nossaUf = D.base.uf || '', simplesNos = ['simples', 'mei'].includes(D.base.regime);
  const regra = regraInter(D.regra, data), intRow = aliqInterna(D.interna, c.uf, F.ncm, data), intd = intRow ? +intRow.aliquota : null;
  const aliqDe = (uf, importado) => (uf && uf === c.uf ? intd : aliqInterSugerida(uf, c.uf, importado, regra));
  const kAliq = k.aliq_manual && k.aliq !== '' ? parseNum(k.aliq) : aliqDe(k.uf, k.importado);
  const pAliq = p.aliq_manual && p.aliq !== '' ? parseNum(p.aliq) : aliqDe(nossaUf, false);
  const ant = (uf, al) => (uf && uf !== c.uf && c.tipo === 'comercio' ? antecipacaoPct(D.antec, c.uf, al, intd, c.tipo, data) : null);
  const kAnt = ant(k.uf, kAliq), pAnt = ant(nossaUf, pAliq);
  const cfg = D.cfg, P = { pc_pct: +(cfg.pc_pct ?? 9.25), pc_excluir_icms: cfg.pc_excluir_icms !== false, taxa_mensal: +(cfg.taxa_mensal || 0) };
  const conc = { preco: parseNum(k.preco), uf_origem: k.uf, aliq: kAliq, interna_dest: intd, simples: k.simples, credito_simples_pct: parseNum(k.credito_simples_pct),
    antecip_pct: kAnt?.pct || 0, frete_tipo: k.frete_tipo, frete_un: parseNum(k.frete_un), prazo_dias: parseNum(k.prazo_dias) };
  const nos = { preco: parseNum(p.preco), uf_origem: nossaUf, aliq: pAliq, interna_dest: intd, simples: simplesNos, credito_simples_pct: parseNum(p.credito_simples_pct),
    antecip_pct: pAnt?.pct || 0, frete_tipo: p.frete_tipo, frete_un: parseNum(p.frete_un), prazo_dias: parseNum(p.prazo_dias) };
  let m = null;
  if (D.ac.margem) {
    const f = D.base.fisc || {}, pcReg = D.base.pis_cofins, mm = F.margem;
    m = { aliq: pAliq, ncm: F.ncm, cfop: nossaUf === c.uf ? '5101' : '6101', custo_un: parseNum(mm.custo_un), custo_fonte: mm.custo_fonte || 'informado',
      cred_insumos_un: parseNum(mm.cred_insumos_un), frete_cif_un: p.frete_tipo === 'CIF' ? parseNum(p.frete_un) : 0,
      despesas_pct: mm.despesas_pct ?? +(cfg.despesas_pct || 0),
      prodepe: { ativo: !!f.prodepe_ativo, pct: +f.prodepe_credito_pct || 0, base: f.prodepe_base, ncm: f.prodepe_ncm || [], cfops: f.prodepe_cfops || [] },
      feef: { pct: +f.feef_pct || 0, base: f.feef_base },
      pc: simplesNos ? null : { pct: pcReg === 'cumulativo' ? +(cfg.pc_cumulativo_pct ?? 3.65) : (f.id ? (+f.pis_pct || 0) + (+f.cofins_pct || 0) : 9.25) },
      simples_pct: simplesNos ? cfg.simples_pct : null };
  }
  const E = { cli: c, conc, nos, P, m, margem_min_pct: F.margem.margem_min_pct ?? +(cfg.margem_min_pct ?? 10) };
  const ok = conc.preco > 0 && nos.preco > 0 && intd != null && kAliq != null && pAliq != null && !!c.uf && !!k.uf && !!nossaUf;
  const R = ok ? analisar(E) : null;
  const reforma = ok && F.reforma ? simularReforma(E, D.base.reforma || []) : [];
  return { E, R, reforma, ok, intRow, kAliq, pAliq, kAnt, pAnt, regra, nossaUf, falta: !c.uf ? 'a UF do cliente' : !k.uf ? 'a UF do fornecedor atual' : !nossaUf ? 'a UF da nossa empresa (Configurações › Empresa › Regime tributário)'
    : intd == null ? `a alíquota interna de ${c.uf} (Parâmetros)` : !(conc.preco > 0) ? 'o preço atual' : !(nos.preco > 0) ? 'o nosso preço' : '' };
}

// ============================================================ nova análise
function abaNova(el) {
  const F = D.F, c = F.cliente, k = F.concorrente, p = F.proposta, mm = F.margem;
  const ufOpt = (sel, vazio = '—') => `<option value="">${vazio}</option>${UFS.map(u => `<option ${u === sel ? 'selected' : ''}>${u}</option>`).join('')}`;
  const cliOpt = D.clientes.map(x => `<option value="${x.id}" ${x.id === F.cliente_id ? 'selected' : ''}>${esc(x.nome)}${x.documento ? ` · ${esc(x.documento)}` : ''}</option>`).join('');
  el.innerHTML = `<div class="cp-grade">
   <div>
    <div class="card cp-bloco"><h3>1. Cliente</h3><div class="grid-form">
      <label class="span2">Do cadastro<select id="f-cli"><option value="">— cliente avulso (possível cliente) —</option>${cliOpt}</select></label>
      <label class="span2">Nome${F.cliente_id ? '' : ' do possível cliente'}<input id="f-cnome" value="${esc(F.cliente_nome)}" ${F.cliente_id ? 'readonly' : ''} maxlength="120"></label>
      <label>UF<select id="f-cuf">${ufOpt(c.uf)}</select></label>
      <label>Tipo<select id="f-ctipo">${opt(TIPOS_CLIENTE, c.tipo)}</select></label>
      <label>Regime<select id="f-creg">${opt(REGIMES_CLIENTE, c.regime)}</select></label>
      <label>CNPJ/CPF<input id="f-cdoc" value="${esc(c.documento || '')}" maxlength="20"></label>
      <label class="chk span2"><input type="checkbox" id="f-cicms" ${c.cred_icms ? 'checked' : ''}> Aproveita o crédito do ICMS</label>
      <label class="chk span2"><input type="checkbox" id="f-cpc" ${c.cred_pc ? 'checked' : ''}> Aproveita o crédito de PIS/COFINS (não cumulativo)</label></div>
      <p class="muted small" id="f-cdica"></p></div>
    <div class="card cp-bloco"><h3>2. Produto</h3><div class="grid-form">
      <label class="span2">Do cadastro<input id="f-prod" list="f-prods" placeholder="procure pelo código ou descrição" value="${esc(F.produto_desc)}"><datalist id="f-prods">${D.produtos.map(x => `<option value="${esc(`${x.codigo} — ${x.descricao}`)}">`).join('')}</datalist></label>
      <label>NCM<input id="f-ncm" value="${esc(F.ncm)}" maxlength="10" inputmode="numeric"></label>
      <label>Data da análise<input type="date" id="f-data" value="${F.data}"></label></div>
      <p class="muted small" id="f-pdica"></p></div>
    <div class="card cp-bloco"><h3>3. Fornecedor atual</h3><div class="grid-form">
      <label class="span2">Nome (só na versão interna)<input id="k-nome" value="${esc(k.nome)}" maxlength="80"></label>
      <label>UF de origem<select id="k-uf">${ufOpt(k.uf)}</select></label>
      <label>Preço unitário (R$)<input id="k-preco" inputmode="decimal" value="${esc(num(k.preco))}"></label>
      <label>ICMS da operação (%)<input id="k-aliq" inputmode="decimal" value="${esc(num(k.aliq))}"></label>
      <label class="chk"><input type="checkbox" id="k-imp" ${k.importado ? 'checked' : ''}> Importado (4%)</label>
      <label class="chk"><input type="checkbox" id="k-simp" ${k.simples ? 'checked' : ''}> Fornecedor do Simples</label>
      <label id="k-csl">Crédito permitido (%)<input id="k-cs" inputmode="decimal" value="${esc(num(k.credito_simples_pct))}"></label>
      <label>Frete<select id="k-ft">${opt([['CIF', 'CIF (no preço)'], ['FOB', 'FOB (cliente paga)']], k.frete_tipo)}</select></label>
      <label id="k-fvl">Frete por unidade (R$)<input id="k-fv" inputmode="decimal" value="${esc(num(k.frete_un))}"></label>
      <label>Prazo (dias)<input id="k-pz" inputmode="numeric" value="${esc(num(k.prazo_dias))}"></label></div></div>
    <div class="card cp-bloco"><h3>4. Nossa proposta</h3><div class="grid-form">
      <label>Preço unitário (R$)<input id="p-preco" inputmode="decimal" value="${esc(num(p.preco))}"></label>
      <label>ICMS da operação (%)<input id="p-aliq" inputmode="decimal" value="${esc(num(p.aliq))}"></label>
      ${['simples', 'mei'].includes(D.base.regime) ? `<label>Crédito permitido ao cliente (%)<input id="p-cs" inputmode="decimal" value="${esc(num(p.credito_simples_pct))}"></label>` : ''}
      <label>Frete<select id="p-ft">${opt([['CIF', 'CIF (no preço)'], ['FOB', 'FOB (cliente paga)']], p.frete_tipo)}</select></label>
      <label>Frete por unidade (R$)<input id="p-fv" inputmode="decimal" value="${esc(num(p.frete_un))}"></label>
      <label>Prazo (dias)<input id="p-pz" inputmode="numeric" value="${esc(num(p.prazo_dias))}"></label></div></div>
    ${D.ac.margem ? `<div class="card cp-bloco cp-interno"><h3>5. Nossa margem <span class="badge">uso interno</span></h3><div class="grid-form">
      <label>Custo do produto por unidade (R$)<input id="m-custo" inputmode="decimal" value="${esc(num(mm.custo_un))}"></label>
      <label>Crédito de ICMS dos insumos por unidade (R$)<input id="m-cred" inputmode="decimal" value="${esc(num(mm.cred_insumos_un))}"></label>
      <label>Despesas variáveis de venda (%)<input id="m-desp" inputmode="decimal" value="${esc(num(mm.despesas_pct ?? D.cfg.despesas_pct ?? 0))}"></label>
      <label>Margem mínima (%)<input id="m-min" inputmode="decimal" value="${esc(num(mm.margem_min_pct ?? D.cfg.margem_min_pct ?? 10))}"></label></div>
      <p class="muted small" id="m-dica"></p></div>` : ''}
    <label class="chk" style="margin:4px 0 12px"><input type="checkbox" id="f-ref" ${F.reforma ? 'checked' : ''}> Simular a reforma tributária (2027 em diante, com as alíquotas do Simulador da reforma)</label>
   </div>
   <div><div class="card cp-res" id="cp-res"></div></div>
  </div>`;
  const ler = () => {
    const v = (id) => $(id, el)?.value ?? '', ck = (id) => !!$(id, el)?.checked;
    c.uf = v('#f-cuf'); c.tipo = v('#f-ctipo'); c.regime = v('#f-creg'); c.documento = v('#f-cdoc'); c.cred_icms = ck('#f-cicms'); c.cred_pc = ck('#f-cpc');
    F.cliente_nome = v('#f-cnome'); F.ncm = v('#f-ncm').replace(/\D/g, ''); F.data = v('#f-data') || today(); F.reforma = ck('#f-ref');
    Object.assign(k, { nome: v('#k-nome'), uf: v('#k-uf'), preco: v('#k-preco'), aliq: v('#k-aliq'), importado: ck('#k-imp'), simples: ck('#k-simp'), credito_simples_pct: v('#k-cs'),
      frete_tipo: v('#k-ft'), frete_un: v('#k-fv'), prazo_dias: v('#k-pz') });
    Object.assign(p, { preco: v('#p-preco'), aliq: v('#p-aliq'), frete_tipo: v('#p-ft'), frete_un: v('#p-fv'), prazo_dias: v('#p-pz'), credito_simples_pct: v('#p-cs') });
    if (D.ac.margem) Object.assign(mm, { custo_un: v('#m-custo'), cred_insumos_un: v('#m-cred'), despesas_pct: parseNum(v('#m-desp')), margem_min_pct: parseNum(v('#m-min')) });
  };
  const mostrar = () => {
    $('#k-csl', el).style.display = k.simples ? '' : 'none';
    $('#k-fvl', el).style.opacity = k.frete_tipo === 'FOB' ? 1 : .55;
    const M = montar();
    // alíquotas sugeridas, enquanto não forem digitadas à mão
    if (!k.aliq_manual) { $('#k-aliq', el).value = M.kAliq == null ? '' : num(M.kAliq); k.aliq = $('#k-aliq', el).value; }
    if (!p.aliq_manual) { $('#p-aliq', el).value = M.pAliq == null ? '' : num(M.pAliq); p.aliq = $('#p-aliq', el).value; }
    const pf = perfilPadrao(c.tipo, c.regime);
    $('#f-cdica', el).textContent = `Normalmente: ${pf.cred_icms ? 'aproveita' : 'não aproveita'} o crédito do ICMS e ${pf.cred_pc ? 'aproveita' : 'não aproveita'} o de PIS/COFINS. ${c.tipo === 'comercio' ? 'Comércio de outra UF recolhe a antecipação parcial.' : c.tipo === 'nao_contrib' ? 'O DIFAL de compra interestadual é do fornecedor.' : !c.cred_icms ? 'Sem crédito em compra de outra UF: DIFAL com base dupla.' : ''}`;
    $('#f-pdica', el).textContent = M.intRow ? `Alíquota interna de ${c.uf}${M.intRow.ncm_prefixo ? ` para o NCM ${M.intRow.ncm_prefixo}…` : ''}: ${fmtPct(M.intRow.aliquota)} desde ${dateBR(M.intRow.vigencia_inicio)} (${M.intRow.norma || 'norma não informada'})${M.intRow.situacao === 'a_conferir' ? ' — a conferir em Parâmetros' : ''}.`
      : c.uf ? `Sem alíquota interna de ${c.uf} cadastrada em Parâmetros.` : '';
    if (D.ac.margem) $('#m-dica', el).textContent = `${mm.custo_fonte ? `Custo: ${mm.custo_fonte}. ` : ''}${D.base.fisc ? `PRODEPE ${D.base.fisc.prodepe_ativo ? `${fmtPct(D.base.fisc.prodepe_credito_pct)} (${D.base.fisc.prodepe_base === 'debito_incentivado' ? 'sobre o débito' : 'sobre o saldo'})` : 'desligado'}, FEEF ${fmtPct(D.base.fisc.feef_pct || 0)}: Fiscal › Apuração › Parâmetros.` : 'Sem parâmetros da apuração (PRODEPE, PIS/COFINS) cadastrados: Fiscal › Apuração › Parâmetros.'}`;
    pintarResultado($('#cp-res', el), M);
  };
  el.addEventListener('input', (ev) => {
    if (ev.target.id === 'k-aliq') k.aliq_manual = ev.target.value !== '';
    if (ev.target.id === 'p-aliq') p.aliq_manual = ev.target.value !== '';
    if (ev.target.id === 'f-prod') return;
    ler(); mostrar();
  });
  el.addEventListener('change', async (ev) => {
    const id = ev.target.id;
    if (id === 'f-ctipo' || id === 'f-creg') { ler(); const pf = perfilPadrao(c.tipo, c.regime); c.cred_icms = pf.cred_icms; c.cred_pc = pf.cred_pc; $('#f-cicms', el).checked = pf.cred_icms; $('#f-cpc', el).checked = pf.cred_pc; }
    if (id === 'k-uf' || id === 'k-imp') { k.aliq_manual = false; }
    if (id === 'f-cuf') { k.aliq_manual = false; p.aliq_manual = false; }
    if (id === 'f-cli') {
      const x = D.clientes.find(y => y.id === ev.target.value);
      F.cliente_id = x?.id || ''; F.cliente_nome = x?.nome || ''; c.documento = x?.documento || '';
      // o perfil fiscal da última análise do cliente; senão a UF do cadastro
      const ult = x && D.analises.find(a => a.cliente_id === x.id);
      if (ult) Object.assign(c, ult.cliente, { documento: x.documento || '' }); else if (x && D.ufCli[x.id]) c.uf = D.ufCli[x.id];
      k.aliq_manual = p.aliq_manual = false;
      return abaNova(el);
    }
    if (id === 'f-prod') {
      const t = ev.target.value, x = D.produtos.find(y => `${y.codigo} — ${y.descricao}` === t);
      F.produto_id = x?.id || ''; F.produto_desc = x ? `${x.codigo} — ${x.descricao}` : t; if (x?.ncm) F.ncm = String(x.ncm).replace(/\D/g, '');
      if (x && D.ac.margem) {
        try {
          const b = await q(sb.rpc('comp_base', { p_empresa: state.empresa.id, p_produto: x.id, p_data: F.data }));
          if (b?.custo?.custo_medio > 0) { mm.custo_un = String(Math.round(b.custo.custo_medio * 10000) / 10000); mm.custo_fonte = `custo médio do Kardex${b.custo.ultima_entrada ? ` (última entrada ${dateBR(b.custo.ultima_entrada)})` : ''}`; }
          else mm.custo_fonte = 'sem custo no Kardex: informe';
        } catch (err) { fail(err); }
      }
      return abaNova(el);
    }
    ler(); mostrar();
  });
  mostrar();
}

function pintarResultado(el, M) {
  const F = D.F;
  if (!M.ok) { el.innerHTML = `<h3>Resultado</h3><div class="empty">Falta ${esc(M.falta)}.</div>`; return; }
  const R = M.R, mg = R.margem, ganha = R.ganha;
  const linhas = (L) => L.map(l => `<tr class="${l.k === 'custo' || l.k === 'vp' ? 'cp-tot' : ''}"><td>${esc(l.txt)}${l.obs ? `<div class="muted small">${esc(l.obs)}</div>` : ''}</td><td class="num">${br(l.v)}</td></tr>`).join('');
  const av = [...R.conc.avisos, ...R.nos.avisos];
  el.innerHTML = `<h3>Resultado</h3>
    <div class="cp-kpis">
      <div><span>Custo atual</span><b>${br(R.conc.custoVp)}</b></div>
      <div><span>Nosso custo</span><b>${br(R.nos.custoVp)}</b></div>
      <div class="${ganha ? 'pos' : 'neg'}"><span>Diferença</span><b>${R.dif > 0 ? '+' : ''}${br(R.dif)}</b><small>${R.dif > 0 ? '+' : ''}${(Math.round(R.difPct * 10) / 10).toLocaleString('pt-BR')}%</small></div>
      <div><span>Preço de empate</span><b>${R.empate == null ? '–' : br(R.empate)}</b></div>
    </div>
    <p class="small">${ganha ? `<b>Nossa proposta já é mais barata</b> para o cliente em ${br(-R.dif)} por unidade.` : `Nossa proposta fica <b>${br(R.dif)}</b> mais cara por unidade. Para empatar, o preço precisa ir a <b>${br(R.empate)}</b> (o valor exato, ${(+R.empateBruto).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}, arredonda para baixo).`}</p>
    ${mg ? `<div class="cp-interno small">${R.faixa.viavel ? `<b>Faixa sugerida:</b> de ${br(R.faixa.de)} (margem mínima de ${fmtPct(M.E.margem_min_pct)}) a ${br(R.faixa.ate)} (empate).`
      : `<b>Sem faixa competitiva</b> com a margem mínima de ${fmtPct(M.E.margem_min_pct)}: ela pede ${R.faixa.de == null ? '—' : br(R.faixa.de)}, acima do empate.`}
      <table class="cp-mt"><thead><tr><th></th><th class="num">Preço</th><th class="num">Margem</th><th class="num">%</th></tr></thead><tbody>
      ${[['Proposta', M.E.nos.preco, mg.proposta], ['Empate', R.empate, mg.empate], ['Margem mínima', R.faixa.de, mg.piso]].filter(x => x[2]).map(([t, v, m]) => `<tr><td>${t}</td><td class="num">${br(v)}</td><td class="num ${m.margem < 0 ? 'neg' : ''}">${br(m.margem)}</td><td class="num">${br(m.pct)}%</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${av.length ? `<div class="cp-aviso small">${av.map(esc).join('<br>')}</div>` : ''}
    <details open><summary><b>Memória de cálculo — fornecedor atual (${esc(F.concorrente.uf)})</b></summary><table class="cp-mt"><tbody>${linhas(R.conc.linhas)}</tbody></table></details>
    <details open><summary><b>Memória de cálculo — nossa proposta (${esc(M.nossaUf)})</b></summary><table class="cp-mt"><tbody>${linhas(R.nos.linhas)}</tbody></table></details>
    ${mg ? `<details class="cp-interno"><summary><b>Memória da nossa margem no preço proposto</b></summary><table class="cp-mt"><tbody>${mg.proposta.linhas.map(l => `<tr><td>${esc(l.txt)}${l.obs ? `<div class="muted small">${esc(l.obs)}</div>` : ''}</td><td class="num">${br(l.v)}</td></tr>`).join('')}</tbody></table></details>` : ''}
    ${M.reforma.length ? `<details open><summary><b>Reforma tributária</b></summary><table class="cp-mt"><thead><tr><th>Ano</th><th class="num">ICMS</th><th class="num">CBS+IBS</th><th class="num">Atual</th><th class="num">Nosso</th><th class="num">Dif.</th><th class="num">Empate</th>${mg ? '<th class="num">Margem</th>' : ''}</tr></thead><tbody>
      ${M.reforma.map(r => `<tr><td>${r.ano}</td><td class="num">${fmtPct(r.icms_pct)}</td><td class="num">${fmtPct(r.t)}</td><td class="num">${br(r.conc)}</td><td class="num">${br(r.nos)}</td><td class="num">${br(r.dif)}</td><td class="num">${br(r.empate)}</td>${mg ? `<td class="num">${r.margem == null ? '–' : br(r.margem) + '%'}</td>` : ''}</tr>`).join('')}</tbody></table>
      <p class="muted small">ICMS reduzido na proporção da transição; CBS e IBS por fora, sem o ICMS na base, com crédito integral para o contribuinte.</p></details>`
      : F.reforma ? '<p class="muted small">Sem alíquotas de 2027 em diante no Simulador da reforma (Fiscal › Apuração › Reforma).</p>' : ''}
    <div class="cp-acoes">
      <button class="btn primary" id="cp-salvar">${F.id ? `Salvar a análise nº ${F.numero}` : 'Salvar a análise'}</button>
      ${D.ac.margem ? '<button class="btn" id="cp-pdfi">PDF interno</button>' : ''}<button class="btn" id="cp-pdfc">PDF para o cliente</button>
      <button class="btn ghost" id="cp-nova">Nova análise</button></div>`;
  $('#cp-salvar', el).onclick = () => salvar(M);
  $('#cp-pdfc', el).onclick = () => pdfAnalise(registroDaTela(M), D.ac.margem ? margemDaTela(M) : null, false);
  if ($('#cp-pdfi', el)) $('#cp-pdfi', el).onclick = () => pdfAnalise(registroDaTela(M), margemDaTela(M), true);
  $('#cp-nova', el).onclick = () => { D.F = { ...F0(), reforma: !!D.cfg.reforma_padrao }; pintar(); };
}

// o que é gravado: sem a margem; a margem vai separada (só quem tem a liberação)
function registroDaTela(M) {
  const F = D.F, R = M.R, enxuto = (x) => ({ custo: x.custo, custoVp: x.custoVp, icms: x.icms, cred: x.cred, difal: x.difal, baseDifal: x.baseDifal, antecip: x.antecip, credPc: x.credPc, linhas: x.linhas, avisos: x.avisos });
  return { id: F.id, numero: F.numero, data: F.data, status: F.status, cliente_id: F.cliente_id || null, cliente_nome: F.cliente_nome.trim(),
    cliente: { ...F.cliente }, produto_id: F.produto_id || null, produto_desc: F.produto_desc, ncm: F.ncm,
    concorrente: { ...F.concorrente, preco: M.E.conc.preco, aliq: M.E.conc.aliq, frete_un: M.E.conc.frete_un, prazo_dias: M.E.conc.prazo_dias, credito_simples_pct: M.E.conc.credito_simples_pct },
    proposta: { ...F.proposta, uf: M.nossaUf, preco: M.E.nos.preco, aliq: M.E.nos.aliq, frete_un: M.E.nos.frete_un, prazo_dias: M.E.nos.prazo_dias },
    resultado: { conc: enxuto(R.conc), nos: enxuto(R.nos), dif: R.dif, difPct: R.difPct, empate: R.empate, empateBruto: R.empateBruto, ganha: R.ganha,
      reforma: M.reforma.map(({ margem, ...r }) => r) },
    parametros: { data: F.data, interna: M.intRow && { uf: M.intRow.uf, ncm_prefixo: M.intRow.ncm_prefixo, aliquota: +M.intRow.aliquota, vigencia_inicio: M.intRow.vigencia_inicio, norma: M.intRow.norma, situacao: M.intRow.situacao },
      antecipacao: (M.kAnt || M.pAnt) && { pct: +(M.kAnt || M.pAnt).pct, norma: (M.kAnt || M.pAnt).norma }, regra: M.regra && { vigencia_inicio: M.regra.vigencia_inicio, aliq_ss_para_nne: M.regra.aliq_ss_para_nne, aliq_geral: M.regra.aliq_geral, aliq_importado: M.regra.aliq_importado },
      pc_pct: M.E.P.pc_pct, pc_excluir_icms: M.E.P.pc_excluir_icms, taxa_mensal: M.E.P.taxa_mensal, regime_empresa: D.base.regime, reforma: !!F.reforma },
    responsavel_nome: D.analises.find(a => a.id === F.id)?.responsavel_nome || state.user?.email?.split('@')[0] };
}
function margemDaTela(M) {
  const R = M.R; if (!R.margem) return null;
  const sl = (m) => m && { margem: m.margem, pct: m.pct, linhas: m.linhas };
  return { proposta: sl(R.margem.proposta), empate: sl(R.margem.empate), piso: sl(R.margem.piso), faixa: R.faixa, margem_min_pct: M.E.margem_min_pct,
    custo_un: M.E.m.custo_un, custo_fonte: M.E.m.custo_fonte, cred_insumos_un: M.E.m.cred_insumos_un, despesas_pct: M.E.m.despesas_pct,
    prodepe: M.E.m.prodepe, reforma: M.reforma.map(r => ({ ano: r.ano, margem: r.margem })), fisc_vigencia: D.base.fisc?.vigencia_inicio || null };
}

async function salvar(M) {
  const F = D.F;
  if (!F.cliente_nome.trim()) return toast('Informe o cliente (do cadastro ou o nome do possível cliente).', true);
  const reg = registroDaTela(M), mg = D.ac.margem ? margemDaTela(M) : null;
  const { numero, responsavel_nome, status, ...p } = reg;
  try {
    const r = await q(sb.rpc('comp_salvar', { p_empresa: state.empresa.id, p, p_margem: mg }));
    toast(F.id ? `Análise nº ${r.numero} atualizada` : `Análise nº ${r.numero} salva — status: em negociação`);
    F.id = r.id; F.numero = r.numero; recarregar();
  } catch (err) { fail(err); }
}

async function pdfAnalise(a, mg, interna) {
  const corpo = relatorioAnalise(a, interna ? mg : null, { esc, money, dateBR, interna, empresa: state.empresa?.nome ? `Nossa proposta (${state.empresa.nome})` : 'Nossa proposta' });
  abrirRelatorio({ rel: interna ? 'Análise de competitividade de preço (interna)' : 'Análise de custo líquido para o cliente', nome: interna ? 'Análise de Competitividade de Preço' : 'Análise de Custo Líquido de Aquisição',
    titulo: interna ? 'ANÁLISE DE COMPETITIVIDADE DE PREÇO — USO INTERNO' : 'ANÁLISE DE CUSTO LÍQUIDO DE AQUISIÇÃO', tipo: 'relatorio', corpo,
    parametros: [['Análise', a.numero ? `nº ${a.numero}` : 'não salva'], ['Data', dateBR(a.data)], ['Cliente', a.cliente_nome || '—'], ['Produto', a.produto_desc || '—'], ['Versão', interna ? 'interna (com margem)' : 'para o cliente']],
    rodape: interna ? 'Base: Análise de Competitividade de Preço (COM009). Parâmetros por vigência: alíquotas internas e interestaduais, antecipação (Parâmetros da tela), PRODEPE/FEEF e PIS/COFINS (Fiscal › Apuração), CBS/IBS (Simulador da reforma). Documento interno: contém margem.'
      : 'Simulação com as regras vigentes na data da análise. Valores por unidade.' });
}

// ============================================================ histórico
function filtrados() {
  const b = ui.busca.trim().toLowerCase();
  return D.analises.filter(a => (!ui.status || a.status === ui.status) && (!ui.de || a.data >= ui.de) && (!ui.ate || a.data <= ui.ate)
    && (!b || `${a.numero} ${a.cliente_nome} ${a.produto_desc || ''} ${a.concorrente?.nome || ''} ${a.responsavel_nome || ''}`.toLowerCase().includes(b)));
}
function abaHistorico(el) {
  el.innerHTML = `<div class="card"><div class="toolbar">
      <label>Procurar<input id="h-b" value="${esc(ui.busca)}" placeholder="cliente, produto, fornecedor, nº"></label>
      <label>Status<select id="h-s"><option value="">Todos</option>${opt(Object.entries(STATUS), ui.status)}</select></label>
      <label>De<input type="date" id="h-de" value="${ui.de}"></label><label>Até<input type="date" id="h-ate" value="${ui.ate}"></label>
      <div style="flex:1"></div><button class="btn" id="h-xls">Excel</button><button class="btn" id="h-pdf">Relatório (PDF)</button></div>
    <div class="tbl-wrap" id="h-t"></div></div>`;
  const pin = () => {
    const L = filtrados(), mgOn = D.ac.margem;
    $('#h-t', el).innerHTML = `<table><thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Produto</th><th>Fornecedor atual</th><th class="num">Preço atual</th><th class="num">Nosso preço</th><th class="num">Custo atual</th><th class="num">Nosso custo</th><th class="num">Dif.</th><th class="num">Empate</th>${mgOn ? '<th class="num">Margem</th>' : ''}<th>Status</th><th>Responsável</th><th></th></tr></thead><tbody>
      ${L.map(a => { const R = a.resultado || {}, k = a.concorrente || {}, m = D.margens[a.id];
        return `<tr><td>${a.numero}</td><td>${dateBR(a.data)}</td><td>${esc(a.cliente_nome)}</td><td>${esc(a.produto_desc || '')}</td><td>${esc(k.nome ? `${k.nome} (${k.uf})` : k.uf || '')}</td>
        <td class="num">${br(k.preco)}</td><td class="num">${br(a.proposta?.preco)}</td><td class="num">${br(R.conc?.custoVp)}</td><td class="num">${br(R.nos?.custoVp)}</td>
        <td class="num ${R.ganha ? 'pos' : 'neg'}">${br(R.difPct)}%</td><td class="num">${br(R.empate)}</td>${mgOn ? `<td class="num">${m?.proposta ? br(m.proposta.pct) + '%' : '–'}</td>` : ''}
        <td><span class="badge ${STB[a.status]}">${STATUS[a.status]}</span>${a.status_obs ? `<div class="muted small">${esc(a.status_obs)}</div>` : ''}</td><td>${esc(a.responsavel_nome || '')}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-abrir="${a.id}">Abrir</button> <button class="btn sm" data-st="${a.id}">Status</button> <button class="btn sm ghost" data-dup="${a.id}" title="Duplicar">⧉</button>
          <button class="btn sm ghost" data-pdf="${a.id}" title="PDF">PDF</button> <button class="btn sm ghost" data-del="${a.id}" title="Excluir">✕</button></td></tr>`; }).join('') || `<tr><td colspan="15" class="empty">Nenhuma análise${D.analises.length ? ' neste filtro' : ': faça a primeira na aba Nova análise'}.</td></tr>`}</tbody></table>`;
  };
  el.addEventListener('input', () => { ui.busca = $('#h-b', el).value; ui.status = $('#h-s', el).value; ui.de = $('#h-de', el).value; ui.ate = $('#h-ate', el).value; pin(); });
  el.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    const a = D.analises.find(x => x.id === (t.dataset.abrir || t.dataset.st || t.dataset.dup || t.dataset.pdf || t.dataset.del));
    if (t.id === 'h-xls') return exportXLSX($('#h-t table', el), 'analises_competitividade');
    if (t.id === 'h-pdf') return pdfHistorico();
    if (!a) return;
    if (t.dataset.abrir || t.dataset.dup) { carregar(a, !!t.dataset.dup); ui.aba = 'nova'; return pintar(); }
    if (t.dataset.pdf) return escolherPdf(a);
    if (t.dataset.st) return mudarStatus(a);
    if (t.dataset.del && await confirmDialog(`Excluir a análise nº ${a.numero} (${a.cliente_nome})?`)) {
      try { await q(sb.rpc('comp_excluir', { p_id: a.id })); toast('Análise excluída'); if (D.F.id === a.id) D.F = F0(); recarregar(); } catch (err) { fail(err); }
    }
  });
  pin();
}
function carregar(a, duplicar) {
  const F = F0(), mg = D.margens[a.id];
  Object.assign(F, { id: duplicar ? null : a.id, numero: duplicar ? null : a.numero, data: duplicar ? today() : a.data, status: a.status, cliente_id: a.cliente_id || '', cliente_nome: a.cliente_nome,
    produto_id: a.produto_id || '', produto_desc: a.produto_desc || '', ncm: a.ncm || '', reforma: !!a.parametros?.reforma });
  Object.assign(F.cliente, a.cliente || {});
  Object.assign(F.concorrente, a.concorrente || {}, { aliq_manual: true });
  Object.assign(F.proposta, a.proposta || {}, { aliq_manual: true });
  if (mg) Object.assign(F.margem, { custo_un: mg.custo_un, custo_fonte: mg.custo_fonte, cred_insumos_un: mg.cred_insumos_un, despesas_pct: mg.despesas_pct, margem_min_pct: mg.margem_min_pct });
  D.F = F;
  if (duplicar) toast(`Cópia da análise nº ${a.numero}: ajuste e salve como nova`);
}
function escolherPdf(a) {
  if (!D.ac.margem) return pdfAnalise(a, null, false);
  const m = modal({ title: `PDF da análise nº ${a.numero}`, narrow: true, body: '<p>Qual versão?</p>',
    foot: '<button class="btn" data-v="c">Para o cliente (sem margem)</button><button class="btn primary" data-v="i">Interna (com margem)</button>' });
  m.el.addEventListener('click', (ev) => { const v = ev.target.closest('[data-v]')?.dataset.v; if (!v) return; m.close(); pdfAnalise(a, D.margens[a.id] || null, v === 'i'); });
}
function mudarStatus(a) {
  const m = modal({ title: `Status da análise nº ${a.numero}`, narrow: true, body: `<div class="grid-form">
      <label>Status<select id="s-s">${opt(Object.entries(STATUS), a.status)}</select></label>
      <label class="span2">Observação / motivo da perda<input id="s-o" maxlength="200" value="${esc(a.status_obs || '')}" placeholder="ex.: preço, prazo, qualidade, frete"></label></div>
      <div class="small muted" style="margin-top:8px">${(a.historico || []).slice().reverse().map(h => `${dateBR(String(h.em).slice(0, 10))} · ${esc(h.por || '')} · ${esc(STATUS[h.status] || h.status)}${h.obs ? ` — ${esc(h.obs)}` : ''}`).join('<br>')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="s-ok">Salvar</button>' });
  $('#s-ok', m.el).onclick = async () => {
    try { await q(sb.rpc('comp_status', { p_id: a.id, p_status: $('#s-s', m.el).value, p_obs: $('#s-o', m.el).value })); m.close(); toast('Status atualizado'); recarregar(); } catch (err) { fail(err); }
  };
}
function pdfHistorico() {
  const L = filtrados(), interna = D.ac.margem;
  const corpo = relatorioHistorico(L, interna ? D.margens : null, { esc, money, dateBR, interna });
  abrirRelatorio({ rel: 'Análises de competitividade de preço', nome: 'Análises de Competitividade de Preço', titulo: 'ANÁLISES DE COMPETITIVIDADE DE PREÇO', paisagem: true, corpo,
    parametros: [['Período', ui.de || ui.ate ? `${ui.de ? dateBR(ui.de) : 'início'} a ${ui.ate ? dateBR(ui.ate) : 'hoje'}` : 'todos'], ['Status', STATUS[ui.status] || 'Todos'], ['Procura', ui.busca || '—'], ['Margem', interna ? 'incluída (uso interno)' : 'fora']],
    rodape: 'Base: Análise de Competitividade de Preço (COM009). Custo líquido = preço − créditos recuperáveis do cliente + DIFAL/antecipação não recuperável. Empate arredondado para baixo.' });
}

// ============================================================ parâmetros
function abaParametros(el) {
  const adm = D.ac.admin, cfg = { papeis_usa: ['admin', 'diretor', 'financeiro', 'vendas'], papeis_margem: ['admin', 'diretor'], usuarios_margem: [], margem_min_pct: 10, despesas_pct: 0, taxa_mensal: 0,
    pc_pct: 9.25, pc_excluir_icms: true, pc_cumulativo_pct: 3.65, simples_pct: null, reforma_padrao: false, ...D.cfg };
  const chks = (nome, sel) => PAPEIS.map(([v, t]) => `<label class="chk"><input type="checkbox" data-${nome}="${v}" ${sel.includes(v) ? 'checked' : ''} ${adm ? '' : 'disabled'}> ${t}</label>`).join('');
  const dis = adm ? '' : 'disabled';
  el.innerHTML = `${adm ? '' : '<div class="card small muted">Consulta. Só o administrador altera os parâmetros.</div>'}
    <div class="card"><h3>Acesso e padrões</h3>
      <div class="small" style="font-weight:600">Quem usa a tela</div><div class="areas-chk">${chks('usa', cfg.papeis_usa)}</div>
      <div class="small" style="font-weight:600;margin-top:8px">Quem vê a margem (custo, PRODEPE, margem, faixa)</div><div class="areas-chk">${chks('mg', cfg.papeis_margem)}</div>
      <div class="small" style="font-weight:600;margin-top:8px">Liberação individual da margem (ex.: gerente comercial)</div><div class="areas-chk" id="pp-us"><span class="muted small">${adm ? 'carregando…' : `${cfg.usuarios_margem.length} usuário(s) liberado(s)`}</span></div>
      <div class="grid-form" style="margin-top:10px">
        <label>Margem mínima da faixa (%)<input id="pp-mm" inputmode="decimal" value="${num(cfg.margem_min_pct)}" ${dis}></label>
        <label>Despesas variáveis de venda (%)<input id="pp-dv" inputmode="decimal" value="${num(cfg.despesas_pct)}" ${dis}></label>
        <label>Valor presente do prazo (% a.m.; 0 = desligado)<input id="pp-tx" inputmode="decimal" value="${num(cfg.taxa_mensal)}" ${dis}></label>
        <label>Crédito de PIS/COFINS do cliente (%)<input id="pp-pc" inputmode="decimal" value="${num(cfg.pc_pct)}" ${dis}></label>
        <label>PIS/COFINS cumulativo da nossa empresa (%)<input id="pp-pcc" inputmode="decimal" value="${num(cfg.pc_cumulativo_pct)}" ${dis}></label>
        <label>Simples: alíquota efetiva do DAS (%)<input id="pp-sn" inputmode="decimal" value="${num(cfg.simples_pct)}" ${dis} placeholder="só empresa do Simples"></label>
        <label class="chk span2"><input type="checkbox" id="pp-ex" ${cfg.pc_excluir_icms ? 'checked' : ''} ${dis}> ICMS fora da base do crédito de PIS/COFINS (Lei 14.592/2023)</label>
        <label class="chk span2"><input type="checkbox" id="pp-rf" ${cfg.reforma_padrao ? 'checked' : ''} ${dis}> Simular a reforma por padrão</label></div>
      ${adm ? '<div style="margin-top:10px"><button class="btn primary" id="pp-ok">Salvar os parâmetros</button></div>' : ''}
      <p class="muted small">PRODEPE, FEEF e PIS/COFINS da nossa empresa vêm de <a href="#/fiscal/apuracao">Fiscal › Apuração › Parâmetros</a>; a UF e o regime, de Configurações › Empresa; CBS/IBS por ano, do Simulador da reforma.</p></div>
    <div class="card"><div class="toolbar"><h3 style="margin:0">Alíquota interna por UF</h3><div style="flex:1"></div>${adm ? '<button class="btn" id="pi-nova">+ Nova alíquota / vigência</button>' : ''}</div>
      <p class="muted small">Regra geral (modal) de cada UF; uma linha com NCM vale para os produtos que começam por ele. A mais recente com vigência até a data da análise vale. A pré-carga fica "a conferir" até a contabilidade confirmar.</p>
      <div class="tbl-wrap"><table><thead><tr><th>UF</th><th>NCM</th><th class="num">Alíquota</th><th class="num">FECP</th><th>Desde</th><th>Norma</th><th>Situação</th><th></th></tr></thead><tbody>
      ${D.interna.map(x => `<tr class="${x.ativo ? '' : 'muted'}"><td>${x.uf}</td><td>${esc(x.ncm_prefixo || 'geral')}</td><td class="num">${fmtPct(x.aliquota)}</td><td class="num">${+x.fecp ? fmtPct(x.fecp) : '–'}</td><td>${dateBR(x.vigencia_inicio)}</td>
        <td class="small">${esc(x.norma || '')}</td><td><span class="badge ${x.situacao === 'vigente' ? 'pago' : 'negoc'}">${x.situacao === 'vigente' ? 'Conferida' : 'A conferir'}</span></td>
        <td style="white-space:nowrap">${adm ? `${x.situacao !== 'vigente' ? `<button class="btn sm" data-conf="${x.id}">Conferida</button> ` : ''}<button class="btn sm ghost" data-ied="${x.id}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${adm && D.interna.some(x => x.situacao !== 'vigente') ? '<button class="btn sm" id="pi-todas" style="margin-top:6px">Marcar todas como conferidas</button>' : ''}</div>
    <div class="card"><div class="toolbar"><h3 style="margin:0">Alíquota interestadual</h3><div style="flex:1"></div>${adm ? '<button class="btn" id="pr-nova">+ Nova vigência</button>' : ''}</div>
      <table><thead><tr><th>Desde</th><th>Origens com alíquota reduzida</th><th class="num">Para N/NE/CO/ES</th><th class="num">Demais</th><th class="num">Importado</th><th>Norma</th></tr></thead><tbody>
      ${D.regra.map(x => `<tr><td>${dateBR(x.vigencia_inicio)}</td><td>${esc((x.ufs_sul_sudeste || []).join(', '))}</td><td class="num">${fmtPct(x.aliq_ss_para_nne)}</td><td class="num">${fmtPct(x.aliq_geral)}</td><td class="num">${fmtPct(x.aliq_importado)}</td><td class="small">${esc(x.norma || '')}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">A alíquota sugerida na análise pode ser trocada à mão (benefício na origem, mercadoria com conteúdo importado etc.).</p></div>
    <div class="card"><div class="toolbar"><h3 style="margin:0">Antecipação parcial (destino)</h3><div style="flex:1"></div>${adm ? '<button class="btn" id="pa-nova">+ Novo percentual</button>' : ''}</div>
      <table><thead><tr><th>Destino</th><th class="num">ICMS da operação</th><th class="num">Interna</th><th class="num">Antecipação</th><th>Clientes</th><th>Desde</th><th>Norma</th><th></th></tr></thead><tbody>
      ${D.antec.map(x => `<tr class="${x.ativo ? '' : 'muted'}"><td>${x.uf_destino}</td><td class="num">${fmtPct(x.aliq_inter)}</td><td class="num">${x.aliq_interna == null ? 'qualquer' : fmtPct(x.aliq_interna)}</td><td class="num">${fmtPct(x.pct)}</td>
        <td>${esc((x.tipos_cliente || []).map(t => Object.fromEntries(TIPOS_CLIENTE)[t]?.split(' (')[0] || t).join(', '))}</td><td>${dateBR(x.vigencia_inicio)}</td><td class="small">${esc(x.norma || '')}</td>
        <td>${adm ? `<button class="btn sm ghost" data-aed="${x.id}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhum percentual.</td></tr>'}</tbody></table>
      <p class="muted small">A antecipação do comércio que aproveita o crédito tem efeito só no caixa (paga na entrada e credita na apuração); sem crédito, vira custo.</p></div>`;
  if (!adm) return;
  q(sb.rpc('comp_pessoas', { p_empresa: state.empresa.id })).then(P => {
    $('#pp-us', el).innerHTML = P.filter(x => !cfg.papeis_margem.includes(x.papel) || cfg.usuarios_margem.includes(x.user_id)).map(x => `<label class="chk"><input type="checkbox" data-us="${x.user_id}" ${cfg.usuarios_margem.includes(x.user_id) ? 'checked' : ''}> ${esc(x.nome)} <span class="muted">(${esc(x.papel)})</span></label>`).join('') || '<span class="muted small">Todos já veem pelo papel.</span>';
  }).catch(fail);
  $('#pp-ok', el).onclick = async () => {
    const marc = (k) => $$(`[data-${k}]:checked`, el).map(x => x.dataset[k]);
    try {
      await q(sb.rpc('comp_config_salvar', { p_empresa: state.empresa.id, p: { papeis_usa: marc('usa'), papeis_margem: marc('mg'), usuarios_margem: marc('us'),
        margem_min_pct: parseNum($('#pp-mm', el).value), despesas_pct: parseNum($('#pp-dv', el).value), taxa_mensal: parseNum($('#pp-tx', el).value), pc_pct: parseNum($('#pp-pc', el).value),
        pc_cumulativo_pct: parseNum($('#pp-pcc', el).value), simples_pct: $('#pp-sn', el).value.trim() === '' ? '' : parseNum($('#pp-sn', el).value),
        pc_excluir_icms: $('#pp-ex', el).checked, reforma_padrao: $('#pp-rf', el).checked } }));
      toast('Parâmetros salvos'); recarregar();
    } catch (err) { fail(err); }
  };
  const salvarLinha = async (tab, row, id) => { try { await q(id ? sb.from(tab).update(row).eq('id', id) : sb.from(tab).insert({ ...row, empresa_id: state.empresa.id })); toast('Salvo'); recarregar(); } catch (err) { fail(err); } };
  el.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.conf) return salvarLinha('fisc_icms_interna', { situacao: 'vigente', atualizado_em: new Date().toISOString() }, t.dataset.conf);
    if (t.id === 'pi-todas') { try { await q(sb.from('fisc_icms_interna').update({ situacao: 'vigente' }).eq('empresa_id', state.empresa.id).eq('situacao', 'a_conferir')); toast('Alíquotas marcadas como conferidas'); recarregar(); } catch (err) { fail(err); } return; }
    if (t.id === 'pi-nova' || t.dataset.ied) {
      const x = D.interna.find(y => y.id === t.dataset.ied) || { uf: 'PE', ncm_prefixo: '', aliquota: '', fecp: 0, vigencia_inicio: today(), norma: '', situacao: 'vigente', ativo: true };
      const m = modal({ title: x.id ? `Alíquota interna de ${x.uf}` : 'Nova alíquota interna', body: `<div class="grid-form">
        <label>UF<select id="i-uf" ${x.id ? 'disabled' : ''}>${UFS.map(u => `<option ${u === x.uf ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label>NCM (prefixo; vazio = geral)<input id="i-ncm" value="${esc(x.ncm_prefixo || '')}" ${x.id ? 'disabled' : ''} maxlength="8" inputmode="numeric"></label>
        <label>Alíquota total (%)<input id="i-al" inputmode="decimal" value="${num(x.aliquota)}"></label><label>Parcela de FECP (%)<input id="i-fe" inputmode="decimal" value="${num(x.fecp)}"></label>
        <label>Desde<input type="date" id="i-vg" value="${x.vigencia_inicio}" ${x.id ? 'disabled' : ''}></label>
        <label class="span2">Norma<input id="i-no" value="${esc(x.norma || '')}"></label>
        <label class="chk"><input type="checkbox" id="i-at" ${x.ativo !== false ? 'checked' : ''}> Ativa</label></div>
        <p class="muted small">${x.id ? 'Mudança de alíquota: use "+ Nova alíquota / vigência", para as análises antigas continuarem com a regra da época.' : ''}</p>`,
        foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="i-ok">Salvar</button>' });
      $('#i-ok', m.el).onclick = () => { m.close(); salvarLinha('fisc_icms_interna', { ...(x.id ? {} : { uf: $('#i-uf', m.el).value, ncm_prefixo: $('#i-ncm', m.el).value.replace(/\D/g, ''), vigencia_inicio: $('#i-vg', m.el).value }),
        aliquota: parseNum($('#i-al', m.el).value), fecp: parseNum($('#i-fe', m.el).value), norma: $('#i-no', m.el).value, ativo: $('#i-at', m.el).checked, situacao: 'vigente', fonte: x.fonte || 'informada na tela' }, x.id); };
    }
    if (t.id === 'pr-nova') {
      const u = D.regra[D.regra.length - 1] || {};
      const m = modal({ title: 'Nova vigência da regra interestadual', body: `<div class="grid-form"><label>Desde<input type="date" id="r-vg" value="${today()}"></label>
        <label class="span2">Origens com alíquota reduzida<input id="r-ss" value="${esc((u.ufs_sul_sudeste || ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']).join(', '))}"></label>
        <label>Para N/NE/CO/ES (%)<input id="r-a1" value="${num(u.aliq_ss_para_nne ?? 7)}"></label><label>Demais (%)<input id="r-a2" value="${num(u.aliq_geral ?? 12)}"></label><label>Importado (%)<input id="r-a3" value="${num(u.aliq_importado ?? 4)}"></label>
        <label class="span2">Norma<input id="r-no" value="${esc(u.norma || '')}"></label></div>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="r-ok">Salvar</button>' });
      $('#r-ok', m.el).onclick = () => { m.close(); salvarLinha('fisc_icms_inter_regra', { vigencia_inicio: $('#r-vg', m.el).value, ufs_sul_sudeste: $('#r-ss', m.el).value.toUpperCase().split(/[^A-Z]+/).filter(Boolean),
        aliq_ss_para_nne: parseNum($('#r-a1', m.el).value), aliq_geral: parseNum($('#r-a2', m.el).value), aliq_importado: parseNum($('#r-a3', m.el).value), norma: $('#r-no', m.el).value, fonte: 'informada na tela' }); };
    }
    if (t.id === 'pa-nova' || t.dataset.aed) {
      const x = D.antec.find(y => y.id === t.dataset.aed) || { uf_destino: 'PE', aliq_inter: 12, aliq_interna: 20.5, pct: '', tipos_cliente: ['comercio'], vigencia_inicio: today(), norma: '', ativo: true };
      const m = modal({ title: x.id ? 'Antecipação parcial' : 'Novo percentual de antecipação', body: `<div class="grid-form">
        <label>Destino<select id="a-uf" ${x.id ? 'disabled' : ''}>${UFS.map(u => `<option ${u === x.uf_destino ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label>ICMS da operação (%)<input id="a-ai" value="${num(x.aliq_inter)}" ${x.id ? 'disabled' : ''}></label><label>Interna do destino (%)<input id="a-in" value="${num(x.aliq_interna)}" ${x.id ? 'disabled' : ''}></label>
        <label>Antecipação (%)<input id="a-pc" value="${num(x.pct)}"></label><label>Desde<input type="date" id="a-vg" value="${x.vigencia_inicio}" ${x.id ? 'disabled' : ''}></label>
        <div class="span2 areas-chk">${TIPOS_CLIENTE.map(([v, tt]) => `<label class="chk"><input type="checkbox" data-tc="${v}" ${(x.tipos_cliente || []).includes(v) ? 'checked' : ''}> ${esc(tt.split(' (')[0])}</label>`).join('')}</div>
        <label class="span2">Norma<input id="a-no" value="${esc(x.norma || '')}"></label><label class="chk"><input type="checkbox" id="a-at" ${x.ativo !== false ? 'checked' : ''}> Ativo</label></div>`,
        foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="a-ok">Salvar</button>' });
      $('#a-ok', m.el).onclick = () => { const tc = $$('[data-tc]:checked', m.el).map(i => i.dataset.tc); m.close();
        salvarLinha('fisc_antecipacao', { ...(x.id ? {} : { uf_destino: $('#a-uf', m.el).value, aliq_inter: parseNum($('#a-ai', m.el).value), aliq_interna: $('#a-in', m.el).value.trim() ? parseNum($('#a-in', m.el).value) : null, vigencia_inicio: $('#a-vg', m.el).value }),
          pct: parseNum($('#a-pc', m.el).value), tipos_cliente: tc, norma: $('#a-no', m.el).value, ativo: $('#a-at', m.el).checked, fonte: x.fonte || 'informada na tela' }, x.id); };
    }
  });
}

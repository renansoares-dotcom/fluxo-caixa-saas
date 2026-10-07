// Cadastro de beneficiários (tabela favorecidos) separado por abas, com os parâmetros de cada tipo.
// Fundos (FIDC) vêm de fidc_fundos (condições) + beneficiarios_endosso (dados cadastrais), editados juntos.
import { sb, state, q, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, money, options, fail, toast, modal, parseNum, exportXLSX } from '../lib/ui.js';
import { analisaDocumento, somenteDoc } from '../lib/documentos.js';

export const title = 'Beneficiários';

const ABAS = [
  { k: 'cli', nome: 'Clientes', tipos: ['CLIENTES', 'TERCEIROS - CLIENTES'], novo: 'CLIENTES' },
  { k: 'for', nome: 'Fornecedores', tipos: ['FORNECEDORES'], novo: 'FORNECEDORES' },
  { k: 'fun', nome: 'Fundos (FIDC)', fundos: true },
  { k: 'rep', nome: 'Representantes', tipos: ['REPRESENTANTES', 'CONSULTORES'], novo: 'REPRESENTANTES' },
  { k: 'pes', nome: 'Funcionários e sócios', tipos: ['FUNCIONÁRIOS', 'SÓCIOS'], novo: 'FUNCIONÁRIOS' },
  { k: 'out', nome: 'Outros', tipos: ['OUTROS'], novo: 'OUTROS' },
];
const SIGLA = { FORNECEDORES: 'FOR', CLIENTES: 'CLI', 'FUNCIONÁRIOS': 'FUN', 'SÓCIOS': 'SÓC', CONSULTORES: 'CON', OUTROS: 'OUT', 'TERCEIROS - CLIENTES': 'TER', REPRESENTANTES: 'REP' };
const REGIMES = ['Simples Nacional', 'MEI', 'Lucro Presumido', 'Lucro Real', 'Não se aplica'];
const ICMS = [['1', '1 – Contribuinte do ICMS'], ['2', '2 – Contribuinte isento'], ['9', '9 – Não contribuinte']];
const RET = [['irrf', 'IRRF', 1.5], ['csrf', 'PIS/COFINS/CSLL (CSRF)', 4.65], ['inss', 'INSS', 11], ['iss', 'ISS', 5]];
const ui = { aba: 'cli', busca: '', pend: false, inativos: false };
let fundos = [], benefs = [];

// pendências de conformidade do cadastro
function pendencias(f, dupDocs) {
  const p = []; const d = analisaDocumento(f.documento);
  if (d.vazio) p.push('sem CNPJ/CPF'); else if (!d.valido) p.push('CNPJ/CPF inválido');
  if (!d.vazio && dupDocs.has(somenteDoc(f.documento))) p.push('CNPJ/CPF repetido');
  if (['CLIENTES', 'TERCEIROS - CLIENTES', 'FORNECEDORES'].includes(f.tipo)) {
    if (!f.logradouro || !f.municipio || !f.uf) p.push('endereço incompleto');
    if (d.tipo === 'PJ' && !f.regime_tributario) p.push('sem regime tributário');
    if (f.tipo !== 'FORNECEDORES' && d.tipo === 'PJ' && !f.contribuinte_icms) p.push('sem indicador de ICMS');
  }
  return p;
}

export async function render(root) {
  root.innerHTML = `<div class="card"><div class="card-head" style="margin-bottom:0">
      <div class="chips" id="abas">${ABAS.map(a => `<span class="chip ${ui.aba === a.k ? 'on' : ''}" data-k="${a.k}">${a.nome} <span class="muted" data-n="${a.k}"></span></span>`).join('')}</div>
      <div style="display:flex;gap:8px"><button class="btn" id="exp">Exportar Excel</button>${podeEditar() ? '<button class="btn primary" id="novo">+ Novo</button>' : ''}</div></div></div>
    <div id="corpo"></div>`;
  $('#abas', root).onclick = (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) { ui.aba = k; render(root); } };
  try {
    await loadCadastros(true);
    [fundos, benefs] = await Promise.all([
      q(sb.from('fidc_fundos').select('*').eq('empresa_id', state.empresa.id).order('nome')),
      q(sb.from('beneficiarios_endosso').select('*').eq('empresa_id', state.empresa.id)),
    ]);
  } catch (e) { return fail(e); }
  for (const a of ABAS) { const n = a.fundos ? fundos.length : state.cad.favorecidos.filter(f => a.tipos.includes(f.tipo)).length; const el = root.querySelector(`[data-n="${a.k}"]`); if (el) el.textContent = n; }
  const aba = ABAS.find(a => a.k === ui.aba);
  $('#novo', root) && ($('#novo', root).onclick = () => aba.fundos ? editarFundo({ ativo: true }, root) : editar({ tipo: aba.novo, ativo: true, tipo_pessoa: 'PJ' }, root));
  $('#exp', root).onclick = () => exportXLSX($('#corpo table', root), `beneficiarios_${aba.k}`);
  if (aba.fundos) return listaFundos($('#corpo', root), root);
  lista($('#corpo', root), aba, root);
}

function lista(c, aba, root) {
  const todos = state.cad.favorecidos;
  const cont = {}; for (const f of todos) { const d = somenteDoc(f.documento); if (d) cont[d] = (cont[d] || 0) + 1; }
  const dup = new Set(Object.keys(cont).filter(k => cont[k] > 1));
  const base = todos.filter(f => aba.tipos.includes(f.tipo));
  const rows = base.map(f => ({ f, p: pendencias(f, dup) }))
    .filter(({ f, p }) => (ui.inativos || f.ativo !== false) && (!ui.pend || p.length)
      && (!ui.busca || `${f.nome} ${f.nome_fantasia || ''} ${f.documento || ''} ${f.municipio || ''}`.toUpperCase().includes(ui.busca.toUpperCase())));
  const comPend = base.filter(f => f.ativo !== false && pendencias(f, dup).length).length;
  const ativos = base.filter(f => f.ativo !== false).length;
  const cli = aba.k === 'cli', forn = aba.k === 'for';
  const plano = (id) => state.cad.planoById[id]?.codigo || '';
  c.innerHTML = `<div class="kpis">
      <div class="kpi"><div class="k-label">${aba.nome} ativos</div><div class="k-value">${ativos}</div><div class="k-sub">${base.length - ativos} inativo(s)</div></div>
      <div class="kpi"><div class="k-label">Cadastro completo</div><div class="k-value">${ativos ? Math.round((ativos - comPend) / ativos * 100) : 0}%</div><div class="k-sub">${ativos - comPend} sem pendência</div></div>
      <div class="kpi"><div class="k-label">Com pendência</div><div class="k-value ${comPend ? 'neg' : ''}">${comPend}</div><div class="k-sub">CNPJ, endereço ou dados fiscais</div></div>
      <div class="kpi"><div class="k-label">Com CNPJ/CPF válido</div><div class="k-value">${base.filter(f => analisaDocumento(f.documento).valido).length}</div><div class="k-sub">de ${base.length}</div></div>
    </div>
    <div class="card flush"><div class="toolbar" id="flt" style="padding:12px">
      <label class="grow">Buscar<input name="busca" value="${esc(ui.busca)}" placeholder="nome, fantasia, CNPJ/CPF, cidade"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="pend" ${ui.pend ? 'checked' : ''}> Só com pendência</label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="inativos" ${ui.inativos ? 'checked' : ''}> Mostrar inativos</label>
      <span class="muted small">${rows.length} de ${base.length}</span></div>
      <div class="table-wrap">${rows.length ? `<table><thead><tr><th>Nome / razão social</th><th>CNPJ / CPF</th><th>Cidade</th>
        ${cli ? '<th>Regime</th><th>ICMS</th><th class="num">Limite de crédito</th><th>Prazo</th><th>Receita padrão</th>' : ''}
        ${forn ? '<th>Regime</th><th>Despesa padrão</th><th>Prazo</th><th>Retenções</th><th>Pagamento</th>' : ''}
        ${!cli && !forn ? '<th>Tipo</th><th>Pagamento</th>' : ''}</tr></thead><tbody>
        ${rows.map(({ f, p }) => { const d = analisaDocumento(f.documento); const ret = f.retencoes ? RET.filter(([k]) => f.retencoes[k]).map(([, n]) => n.split(' ')[0]).join(', ') : '';
          return `<tr class="clickable" data-id="${f.id}"><td class="wrap"><strong>${esc(f.nome)}</strong>${f.nome_fantasia ? `<div class="small muted">${esc(f.nome_fantasia)}</div>` : ''}${f.ativo === false ? ' <span class="badge vencido">inativo</span>' : ''}<div class="pend">${p.length ? p.map(x => `<span class="badge aberto">${x}</span>`).join(' ') : '<span class="badge pago">cadastro ok</span>'}</div></td>
          <td>${d.vazio ? '<span class="muted">—</span>' : `${esc(d.formatado)}${d.valido ? '' : ' <span class="badge vencido">inválido</span>'}`}</td><td>${esc([f.municipio, f.uf].filter(Boolean).join('/'))}</td>
          ${cli ? `<td class="small">${esc(f.regime_tributario || '')}</td><td>${esc(f.contribuinte_icms || '')}</td><td class="num">${f.limite_credito ? money(f.limite_credito) : ''}</td><td>${esc(f.prazo_padrao || '')}</td><td>${esc(plano(f.plano_padrao_id))}</td>` : ''}
          ${forn ? `<td class="small">${esc(f.regime_tributario || '')}</td><td>${esc(plano(f.plano_padrao_id))}</td><td>${esc(f.prazo_padrao || '')}</td><td class="small">${esc(ret)}</td><td class="small">${esc(f.forma_pagamento || '')}</td>` : ''}
          ${!cli && !forn ? `<td class="small">${esc(f.tipo)}</td><td class="small">${esc(f.forma_pagamento || '')}</td>` : ''}</tr>`; }).join('')}
        </tbody></table>` : '<div class="empty">Nenhum cadastro neste filtro.</div>'}</div></div>`;
  $('#flt', c).addEventListener('change', (e) => { ui[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; lista(c, aba, root); });
  $('table', c)?.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) editar(state.cad.favById[tr.dataset.id], root); });
}

// ---------------------------------------------------------------------------------------------
// Formulário do beneficiário (identificação, endereço, contato, fiscal, comercial/financeiro)
// ---------------------------------------------------------------------------------------------
function editar(f, root) {
  const ed = podeEditar();
  const tipos = Object.keys(SIGLA);
  const ehCli = (t) => ['CLIENTES', 'TERCEIROS - CLIENTES'].includes(t), ehFor = (t) => t === 'FORNECEDORES';
  const planos = (pref) => state.cad.contasPlano.filter(p => p.codigo.startsWith(pref) && (p.ativo !== false || p.id === f.plano_padrao_id));
  const reps = state.cad.favorecidos.filter(x => ['REPRESENTANTES', 'CONSULTORES'].includes(x.tipo));
  const v = (k) => esc(f[k] ?? '');
  const ret = f.retencoes || {};
  const m = modal({
    title: f.id ? `Beneficiário — ${f.nome}` : 'Novo beneficiário', wide: true,
    body: `<form id="bf" class="benef-form">
      <fieldset><legend>Identificação</legend><div class="grid-form">
        <label>Tipo<select name="tipo">${tipos.map(t => `<option ${t === f.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Pessoa<select name="tipo_pessoa"><option value="PJ" ${f.tipo_pessoa !== 'PF' ? 'selected' : ''}>Jurídica (CNPJ)</option><option value="PF" ${f.tipo_pessoa === 'PF' ? 'selected' : ''}>Física (CPF)</option></select></label>
        <label>CNPJ / CPF<input name="documento" value="${esc(analisaDocumento(f.documento).formatado || '')}" placeholder="só números ou formatado"><span class="small" id="doc-msg"></span></label>
        <label class="span2">Nome / razão social *<input name="nome" required value="${v('nome')}"></label>
        <label>Nome fantasia<input name="nome_fantasia" value="${v('nome_fantasia')}"></label>
        <label>Inscrição estadual<input name="ie" value="${v('ie')}"></label>
        <label>Inscrição municipal<input name="im" value="${v('im')}"></label>
        <label>Segmento<input name="segmento" value="${v('segmento')}"></label>
        <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="ativo" ${f.ativo !== false ? 'checked' : ''}> Ativo</label>
      </div></fieldset>
      <fieldset><legend>Endereço e contato</legend><div class="grid-form">
        <label class="span2">Logradouro<input name="logradouro" value="${v('logradouro')}"></label><label>Número<input name="numero" value="${v('numero')}"></label>
        <label>Complemento<input name="complemento" value="${v('complemento')}"></label><label>Bairro<input name="bairro" value="${v('bairro')}"></label>
        <label>Município<input name="municipio" value="${v('municipio')}"></label><label>UF<input name="uf" maxlength="2" value="${v('uf')}"></label><label>CEP<input name="cep" value="${v('cep')}"></label>
        <label>E-mail<input name="email" type="email" value="${v('email')}"></label><label>Telefone<input name="telefone" value="${v('telefone')}"></label>
      </div></fieldset>
      <fieldset class="so-pj-cf"><legend>Fiscal</legend><div class="grid-form">
        <label>Regime tributário<select name="regime_tributario"><option value="">—</option>${REGIMES.map(r => `<option ${r === f.regime_tributario ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="so-cli">Indicador de ICMS (NF-e)<select name="contribuinte_icms"><option value="">—</option>${ICMS.map(([k, n]) => `<option value="${k}" ${k === f.contribuinte_icms ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="so-cli" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="consumidor_final" ${f.consumidor_final ? 'checked' : ''}> Consumidor final</label>
      </div>
      <div class="so-for" style="margin-top:10px"><div class="small muted" style="margin-bottom:6px">Retenções na fonte sobre serviços prestados por este fornecedor (% sobre o valor do serviço)</div><div class="grid-form">
        ${RET.map(([k, n, def]) => `<label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="ret_${k}" ${ret[k] ? 'checked' : ''}> ${n}<input name="aliq_${k}" inputmode="decimal" style="width:80px;margin-left:auto" value="${String(ret[k] || def).replace('.', ',')}"> %</label>`).join('')}
      </div></div></fieldset>
      <fieldset><legend>Comercial e financeiro</legend><div class="grid-form">
        <label class="so-cli">Limite de crédito (R$)<input name="limite_credito" inputmode="decimal" value="${f.limite_credito != null ? money(f.limite_credito) : ''}"></label>
        <label class="so-cf">Prazo padrão (dias)<input name="prazo_padrao" value="${v('prazo_padrao')}" placeholder="ex.: 28/42/56"></label>
        <label class="so-cli span2">Plano de contas padrão (receita)<select name="plano_cli"><option value="">—</option>${options(planos('1.'), { label: 'label', selected: f.plano_padrao_id })}</select></label>
        <label class="so-for span2">Plano de contas padrão (despesa)<select name="plano_for"><option value="">—</option>${options(planos('2.'), { label: 'label', selected: f.plano_padrao_id })}</select></label>
        <label class="so-for">Centro de custo padrão<select name="centro_custo_padrao_id">${options(state.cad.cc, { empty: '—', selected: f.centro_custo_padrao_id })}</select></label>
        <label class="so-for">Prioridade de pagamento<select name="prioridade_padrao"><option value="">Padrão da classificação</option>${['Obrigatório', 'Negociável'].map(x => `<option ${x === f.prioridade_padrao ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="so-cli">Representante<select name="representante_id">${options(reps, { empty: '—', selected: f.representante_id })}</select></label>
        <label>Forma de pagamento / recebimento<input name="forma_pagamento" value="${v('forma_pagamento')}"></label>
        <label>Periodicidade<input name="periodicidade" value="${v('periodicidade')}"></label>
        <label>Chave PIX<input name="pix" value="${v('pix')}"></label>
        <label class="span2">Dados bancários<input name="dados_bancarios" value="${v('dados_bancarios')}"></label>
        <label class="span2">Observação<input name="observacao" value="${v('observacao')}"></label>
      </div></fieldset></form>`,
    foot: ed ? `${f.id ? '<button class="btn danger" id="b-inat" style="margin-right:auto">' + (f.ativo === false ? 'Reativar' : 'Inativar') + '</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="b-ok">Salvar</button>` : '<button class="btn" data-close>Fechar</button>',
  });
  const form = $('#bf', m.el); const F = (n) => form.querySelector(`[name="${n}"]`);
  if (!ed) form.querySelectorAll('input,select').forEach(i => i.disabled = true);
  // mostra só os campos do tipo escolhido
  const ajusta = () => {
    const t = F('tipo').value;
    form.querySelectorAll('.so-cli').forEach(x => x.hidden = !ehCli(t));
    form.querySelectorAll('.so-for').forEach(x => x.hidden = !ehFor(t));
    form.querySelectorAll('.so-cf').forEach(x => x.hidden = !(ehCli(t) || ehFor(t)));
    form.querySelectorAll('.so-pj-cf').forEach(x => x.hidden = !(ehCli(t) || ehFor(t)));
  };
  const valida = () => {
    const d = analisaDocumento(F('documento').value); const msg = $('#doc-msg', m.el);
    if (d.vazio) { msg.textContent = ''; return d; }
    const dupl = state.cad.favorecidos.filter(x => x.id !== f.id && somenteDoc(x.documento) === somenteDoc(F('documento').value));
    msg.innerHTML = d.valido ? `<span class="pos">${d.tipo === 'PJ' ? 'CNPJ' : 'CPF'} válido</span>${dupl.length ? ` · <span class="neg">já cadastrado em ${esc(dupl.map(x => x.nome).join(', '))}</span>` : ''}` : '<span class="neg">número inválido</span>';
    if (d.valido && d.tipo) F('tipo_pessoa').value = d.tipo;
    return d;
  };
  F('tipo').onchange = ajusta; F('documento').oninput = valida; ajusta(); valida();
  if (!ed) return;
  $('#b-inat', m.el) && ($('#b-inat', m.el).onclick = async () => {
    try { await q(sb.from('favorecidos').update({ ativo: f.ativo === false }).eq('id', f.id)); toast(f.ativo === false ? 'Reativado' : 'Inativado'); m.close(); render(root); } catch (e) { fail(e); }
  });
  $('#b-ok', m.el).onclick = async () => {
    if (!form.reportValidity()) return;
    const d = analisaDocumento(F('documento').value);
    if (!d.vazio && !d.valido && !confirm('O CNPJ/CPF parece inválido. Salvar mesmo assim?')) return;
    const t = F('tipo').value; const txt = (k) => (F(k)?.value || '').trim() || null;
    const row = { empresa_id: state.empresa.id, tipo: t, sigla: SIGLA[t] || 'OUT', nome: F('nome').value.trim().toUpperCase(), tipo_pessoa: F('tipo_pessoa').value,
      documento: d.vazio ? null : somenteDoc(F('documento').value), nome_fantasia: txt('nome_fantasia'), ie: txt('ie'), im: txt('im'), segmento: txt('segmento'), ativo: F('ativo').checked,
      logradouro: txt('logradouro'), numero: txt('numero'), complemento: txt('complemento'), bairro: txt('bairro'), municipio: txt('municipio')?.toUpperCase() || null,
      uf: txt('uf')?.toUpperCase() || null, cep: (txt('cep') || '').replace(/\D/g, '') || null, email: txt('email'), telefone: txt('telefone'),
      forma_pagamento: txt('forma_pagamento'), periodicidade: txt('periodicidade'), pix: txt('pix'), dados_bancarios: txt('dados_bancarios'), observacao: txt('observacao'),
      regime_tributario: (ehCli(t) || ehFor(t)) ? txt('regime_tributario') : null, updated_at: new Date().toISOString() };
    if (ehCli(t)) Object.assign(row, { contribuinte_icms: txt('contribuinte_icms'), consumidor_final: F('consumidor_final').checked, limite_credito: txt('limite_credito') ? parseNum(F('limite_credito').value) : null,
      prazo_padrao: txt('prazo_padrao'), plano_padrao_id: txt('plano_cli'), representante_id: txt('representante_id') });
    if (ehFor(t)) Object.assign(row, { prazo_padrao: txt('prazo_padrao'), plano_padrao_id: txt('plano_for'), centro_custo_padrao_id: txt('centro_custo_padrao_id'), prioridade_padrao: txt('prioridade_padrao'),
      retencoes: Object.fromEntries(RET.filter(([k]) => F('ret_' + k).checked).map(([k]) => [k, parseNum(F('aliq_' + k).value) || 0])) });
    try {
      if (f.id) await q(sb.from('favorecidos').update(row).eq('id', f.id)); else await q(sb.from('favorecidos').insert(row));
      toast('Cadastro salvo'); m.close(); render(root);
    } catch (e) { fail(String(e.message || e).includes('duplicate') ? new Error('Já existe um cadastro com esse tipo e nome') : e); }
  };
}

// ---------------------------------------------------------------------------------------------
// Fundos (FIDC): condições da operação (fidc_fundos) + dados cadastrais (beneficiarios_endosso)
// ---------------------------------------------------------------------------------------------
const CAMPOS_FUNDO = [['taxa_am', 'Taxa a.m. (%)'], ['ad_valorem_pct', 'Ad valorem (% face)'], ['tarifa_operacao', 'TED / tarifa por borderô (R$)'], ['custo_assinatura', 'Assinatura por borderô (R$)'],
  ['tarifa_titulo', 'Boleto por título (R$)'], ['custo_consulta', 'Consulta Serasa por sacado novo (R$)'], ['iof_pct', 'IOF (% face)'], ['dias_compensacao', 'Dias de compensação'],
  ['prazo_min', 'Prazo mín. (dias)'], ['prazo_max', 'Prazo máx. (dias)'], ['limite_credito', 'Limite de crédito (R$)'], ['limite_sacado_pct', 'Limite por sacado (%)']];
const benefDo = (fu) => benefs.find(b => b.fundo_id === fu.id) || {};

function listaFundos(c, root) {
  const conta = (id) => state.cad.contaById[id]?.nome || '—';
  c.innerHTML = `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2>Fundos (FIDC)</h2><p class="muted small">Dados cadastrais (usados no endosso) e condições da operação (usadas na simulação das propostas de borderô).</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Fundo</th><th>Razão social</th><th>CNPJ</th><th>Cidade / praça</th><th class="num">Taxa a.m.</th><th>Deságio</th><th class="num">Dias comp.</th><th class="num">Tarifas fixas</th><th class="num">Boleto</th><th>Conta do fundo</th><th>Crédito</th><th>Pendências</th></tr></thead><tbody>
    ${fundos.map(fu => { const b = benefDo(fu); const d = analisaDocumento(b.cnpj); const p = [d.vazio ? 'sem CNPJ' : d.valido ? '' : 'CNPJ inválido', b.municipio ? '' : 'sem cidade', b.praca_pagamento ? '' : 'sem praça', fu.conta_id ? '' : 'sem conta'].filter(Boolean);
      return `<tr class="clickable" data-id="${fu.id}"><td><strong>${esc(fu.nome)}</strong>${fu.ativo ? '' : ' <span class="badge vencido">inativo</span>'}</td><td class="wrap small">${esc(b.razao_social || '—')}</td><td>${esc(d.formatado || '—')}</td>
      <td class="small">${esc([b.municipio, b.uf].filter(Boolean).join('/'))}${b.praca_pagamento ? `<div class="muted">praça ${esc(b.praca_pagamento)}</div>` : ''}</td><td class="num">${String(fu.taxa_am).replace('.', ',')}%</td><td class="small">${fu.metodo_desagio === 'simples' ? 'juros simples' : 'por dentro'}</td>
      <td class="num">${fu.dias_compensacao || 0}</td><td class="num">${money(+fu.tarifa_operacao + +(fu.custo_assinatura || 0))}</td><td class="num">${money(fu.tarifa_titulo)}</td><td>${esc(conta(fu.conta_id))}</td><td>${esc(conta(fu.conta_credito_id))}</td>
      <td class="small">${p.length ? p.map(x => `<span class="badge aberto">${x}</span>`).join(' ') : '<span class="badge pago">ok</span>'}</td></tr>`; }).join('') || '<tr><td colspan="12" class="muted">Nenhum fundo.</td></tr>'}</tbody></table></div></div>`;
  $('table', c).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) editarFundo(fundos.find(x => x.id === tr.dataset.id), root); };
}

function editarFundo(fu, root) {
  const ed = podeEditar(); const b = fu.id ? benefDo(fu) : {};
  const n = (k) => fu[k] == null ? '' : String(fu[k]).replace('.', ',');
  const m = modal({
    title: fu.id ? `Fundo — ${fu.nome}` : 'Novo fundo', wide: true,
    body: `<form id="ff" class="benef-form">
      <fieldset><legend>Cadastro (vai para o endosso)</legend><div class="grid-form">
        <label>Nome curto *<input name="nome" required value="${esc(fu.nome || '')}"></label>
        <label class="span2">Razão social<input name="razao_social" value="${esc(b.razao_social || '')}"></label>
        <label>CNPJ<input name="cnpj" value="${esc(analisaDocumento(b.cnpj).formatado || '')}"><span class="small" id="cnpj-msg"></span></label>
        <label class="span2">Endereço<input name="logradouro" value="${esc(b.logradouro || '')}"></label>
        <label>Município<input name="municipio" value="${esc(b.municipio || '')}"></label><label>UF<input name="uf" maxlength="2" value="${esc(b.uf || '')}"></label><label>CEP<input name="cep" value="${esc(b.cep || '')}"></label>
        <label>Praça de pagamento<input name="praca_pagamento" value="${esc(b.praca_pagamento || '')}" placeholder="SAO PAULO/SP"></label>
        <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="ativo" ${fu.ativo !== false ? 'checked' : ''}> Ativo</label>
      </div></fieldset>
      <fieldset><legend>Condições da operação (simulação do borderô)</legend><div class="grid-form">
        <label>Conta do fundo<select name="conta_id">${options(state.cad.contas, { empty: '—', selected: fu.conta_id })}</select></label>
        <label>Conta de crédito do líquido<select name="conta_credito_id">${options(state.cad.contas, { empty: '—', selected: fu.conta_credito_id })}</select></label>
        <label>Cálculo do deságio<select name="metodo_desagio"><option value="fator" ${fu.metodo_desagio !== 'simples' ? 'selected' : ''}>Por dentro — v·k/(1+k)</option><option value="simples" ${fu.metodo_desagio === 'simples' ? 'selected' : ''}>Juros simples sobre a face</option></select></label>
        ${CAMPOS_FUNDO.map(([k, t]) => `<label>${t}<input name="${k}" inputmode="decimal" value="${n(k)}"></label>`).join('')}
        <label class="span2">Observação<input name="observacao" value="${esc(fu.observacao || '')}"></label>
      </div></fieldset></form>`,
    foot: ed ? '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="f-ok">Salvar</button>' : '<button class="btn" data-close>Fechar</button>',
  });
  const form = $('#ff', m.el); const F = (k) => form.querySelector(`[name="${k}"]`);
  const vc = () => { const d = analisaDocumento(F('cnpj').value); $('#cnpj-msg', m.el).innerHTML = d.vazio ? '' : d.valido ? '<span class="pos">CNPJ válido</span>' : '<span class="neg">CNPJ inválido</span>'; };
  F('cnpj').oninput = vc; vc();
  if (!ed) { form.querySelectorAll('input,select').forEach(i => i.disabled = true); return; }
  $('#f-ok', m.el).onclick = async () => {
    if (!form.reportValidity()) return;
    const txt = (k) => (F(k).value || '').trim() || null;
    const row = { empresa_id: state.empresa.id, nome: F('nome').value.trim(), conta_id: txt('conta_id'), conta_credito_id: txt('conta_credito_id'), metodo_desagio: F('metodo_desagio').value,
      ativo: F('ativo').checked, observacao: txt('observacao'), updated_at: new Date().toISOString() };
    for (const [k] of CAMPOS_FUNDO) { const v = (F(k).value || '').trim(); row[k] = v === '' ? (['prazo_min', 'prazo_max', 'limite_credito', 'limite_sacado_pct'].includes(k) ? null : 0) : parseNum(v); }
    const cad = { empresa_id: state.empresa.id, nome: row.nome, tipo: 'FIDC', razao_social: txt('razao_social'), cnpj: somenteDoc(F('cnpj').value) || null, logradouro: txt('logradouro'),
      municipio: txt('municipio')?.toUpperCase() || null, uf: txt('uf')?.toUpperCase() || null, cep: (txt('cep') || '').replace(/\D/g, '') || null, praca_pagamento: txt('praca_pagamento')?.toUpperCase() || null, ativo: row.ativo, updated_at: row.updated_at };
    try {
      let id = fu.id;
      if (id) await q(sb.from('fidc_fundos').update(row).eq('id', id)); else id = (await q(sb.from('fidc_fundos').insert(row).select().single())).id;
      if (b.id) await q(sb.from('beneficiarios_endosso').update(cad).eq('id', b.id)); else await q(sb.from('beneficiarios_endosso').insert({ ...cad, fundo_id: id }));
      toast('Fundo salvo'); m.close(); render(root);
    } catch (e) { fail(e); }
  };
}

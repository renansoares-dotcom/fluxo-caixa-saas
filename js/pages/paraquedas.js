// Paraquedas: pagamentos pedidos antes da nota fiscal (adiantamentos e compras do dia).
// Fluxo: lançado (compras/financeiro) → autorizado pelo diretor ou financeiro → programado (vira lançamento "Em aberto" no fluxo
// do dia) → pago (vira adiantamento ao fornecedor) → nota recebida (a nota abate o adiantamento).
// "Terá nota fiscal = não" fica separado para o controle de pagamentos sem lastro fiscal.
import { sb, state, q, fetchAll, loadCadastros, podeEditar } from '../lib/data.js';
import { $, esc, money, dateBR, fail, toast, modal, options, parseNum, exportXLSX, today, logoPNG } from '../lib/ui.js';
import { dispararAvisos } from '../lib/notif.js';

export const title = 'Pagamentos Antecipados';
const ST = { aguardando: 'Aguardando aprovação', aprovado: 'Aprovado', rejeitado: 'Rejeitado', cancelado: 'Cancelado', pago: 'Pago — aguardando nota', nota_recebida: 'Nota recebida' };
const ST_CLS = { aguardando: 'aberto', aprovado: 'conc', rejeitado: 'vencido', cancelado: '', pago: 'aberto', nota_recebida: 'pago' };
const PIX = { cnpj: 'CNPJ', cpf: 'CPF', email: 'E-mail', telefone: 'Telefone', aleatoria: 'Chave aleatória' };
const ui = { aba: null, busca: '' };
let L = [], LANC = new Map(), SEM_TABELA = false, VIS = { R: [], aba: '' };

const dig = (s) => String(s || '').replace(/\D/g, '');
const fmtDoc = (d) => { d = dig(d); return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d; };
const dias = (a) => Math.round((new Date(today()) - new Date(a)) / 864e5);
const compras = () => state.papel === 'compras';
// quem autoriza paraquedas: diretor ou financeiro (e o administrador)
const aprova = () => ['admin', 'diretor', 'financeiro'].includes(state.papel);
const ehMeu = (p) => p.criado_por === state.user?.id;

/** situação na tela: "aprovado" se divide em "a programar" (sem lançamento) e "no fluxo" (com lançamento) */
function fase(p) {
  if (p.status === 'aprovado') { const l = LANC.get(p.lancamento_id); return !p.lancamento_id ? 'programar' : l?.status === 'Pago' ? 'pago_sist' : 'fluxo'; }
  if (p.status === 'pago') return p.tera_nota ? 'sem_nf' : 'sem_lastro';
  return p.status;
}
const ABAS = [
  ['aguardando', 'Aguardando aprovação', (p) => p.status === 'aguardando'],
  ['programar', 'Aprovados a programar', (p) => fase(p) === 'programar'],
  ['fluxo', 'No fluxo / pagos', (p) => ['fluxo', 'pago_sist'].includes(fase(p))],
  ['nota', 'Pagos aguardando nota', (p) => fase(p) === 'sem_nf'],
  ['semnota', 'Sem nota fiscal', (p) => !p.tera_nota && !['rejeitado', 'cancelado'].includes(p.status)],
  ['ok', 'Concluídos', (p) => p.status === 'nota_recebida'],
  ['fora', 'Rejeitados / cancelados', (p) => ['rejeitado', 'cancelado'].includes(p.status)],
];
const ABAS_COMPRAS = [['meus', 'Meus pedidos', () => true]];

export async function render(root) {
  await loadCadastros();
  const abas = compras() ? ABAS_COMPRAS : ABAS;
  if (!abas.some(a => a[0] === ui.aba)) ui.aba = abas[0][0];
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div><h2 style="margin:0">Pagamentos Antecipados</h2><p class="muted small" style="margin:4px 0 0">Pagamentos pedidos antes da nota fiscal. O diretor ou o financeiro autoriza; o financeiro programa no fluxo do dia; depois de pago, a nota fiscal abate o adiantamento.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="novo">+ Novo pagamento antecipado</button><button class="btn" id="pdf" title="Relatório da aba aberta (com a busca aplicada) para imprimir ou salvar em PDF">Relatório (PDF)</button>${compras() ? '' : '<button class="btn" id="exp">Exportar Excel</button>'}</div></div>
      <div class="toolbar" style="margin-top:10px"><label class="grow">Buscar<input id="busca" placeholder="fornecedor, CNPJ, descrição, nº" value="${esc(ui.busca)}"></label></div></div>
    <div class="kpis" id="pq-kpis"></div><div id="pq-alertas"></div>
    <div class="card" style="padding-bottom:8px"><div class="chips" id="pq-abas"></div></div>
    <div id="pq-corpo"><div class="loading">Carregando…</div></div>`;
  $('#novo', root).onclick = () => editar(null, root);
  $('#exp', root) && ($('#exp', root).onclick = () => exportXLSX($('#pq-corpo table', root), 'pagamentos_antecipados'));
  $('#pdf', root).onclick = () => relatorioPDF();
  $('#busca', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  $('#pq-abas', root).onclick = (e) => { const a = e.target.closest('[data-aba]')?.dataset.aba; if (a) { ui.aba = a; pintar(root); } };
  const ab = ['pa', 'pa-novo'].includes(state.abrir?.tipo) ? state.abrir : null;   // vindo da busca global ou de um pedido de compra
  if (ab) delete state.abrir;
  await carregar(root);
  if (ab?.tipo === 'pa') { const p = L.find(x => x.id === ab.id); if (p) editar(p, root, true); }
  if (ab?.tipo === 'pa-novo') editar(null, root, false, ab.v);
}

async function carregar(root) {
  try {
    L = await fetchAll(() => sb.from('paraquedas').select('*').eq('empresa_id', state.empresa.id).order('data_pagamento').order('numero'));
    SEM_TABELA = false;
  } catch (e) {
    if (/paraquedas|relation|schema cache|does not exist/i.test(e.message || '')) { SEM_TABELA = true; L = []; }
    else { fail(e); L = []; }
  }
  LANC = new Map();
  const ids = L.map(p => p.lancamento_id).filter(Boolean);
  if (ids.length && !compras()) for (let i = 0; i < ids.length; i += 150) for (const l of await q(sb.from('lancamentos').select('id,status,data,valor,conta_id').in('id', ids.slice(i, i + 150)))) LANC.set(l.id, l);
  pintar(root);
}

function pintar(root) {
  if (SEM_TABELA) {
    $('#pq-corpo', root).innerHTML = '<div class="card"><div class="empty">A estrutura de Pagamentos Antecipados ainda não foi instalada no banco. Rode o SQL <strong>20261012000027_paraquedas.sql</strong> no SQL Editor do Supabase.</div></div>';
    $('#pq-abas', root).innerHTML = ''; $('#pq-kpis', root).innerHTML = ''; return;
  }
  const abas = compras() ? ABAS_COMPRAS : ABAS, b = ui.busca.trim().toLowerCase();
  const filtra = (p) => !b || `${p.numero} ${p.razao_social} ${p.cnpj} ${fmtDoc(p.cnpj)} ${p.descricao} ${p.pedido} ${p.solicitante}`.toLowerCase().includes(b);
  $('#pq-abas', root).innerHTML = abas.map(([k, t, f]) => { const n = L.filter(f).length; return `<button class="chip ${ui.aba === k ? 'on' : ''}" data-aba="${k}">${t}${n ? ` (${n})` : ''}</button>`; }).join('');
  const soma = (f) => L.filter(f).reduce((s, p) => s + +p.valor, 0), cont = (f) => L.filter(f).length;
  const hoje = today();
  const semNf = L.filter(p => fase(p) === 'sem_nf'), velho = semNf.reduce((m, p) => Math.max(m, dias(LANC.get(p.lancamento_id)?.data || p.data_pagamento)), 0);
  $('#pq-kpis', root).innerHTML = compras() ? `
    <div class="kpi"><div class="k-label">Aguardando aprovação</div><div class="k-value">${money(soma(p => p.status === 'aguardando'))}</div><div class="k-sub">${cont(p => p.status === 'aguardando')} pedido(s)</div></div>
    <div class="kpi"><div class="k-label">Aprovados</div><div class="k-value">${money(soma(p => ['aprovado', 'pago', 'nota_recebida'].includes(p.status)))}</div></div>
    <div class="kpi"><div class="k-label">Rejeitados</div><div class="k-value">${cont(p => p.status === 'rejeitado')}</div><div class="k-sub">corrija e reenvie</div></div>` : `
    <div class="kpi"><div class="k-label">Aguardando aprovação</div><div class="k-value">${money(soma(p => p.status === 'aguardando'))}</div><div class="k-sub">${cont(p => p.status === 'aguardando')} pedido(s) · ${cont(p => p.status === 'aguardando' && p.prioridade === 'urgente')} urgente(s)</div></div>
    <div class="kpi"><div class="k-label">Aprovados para hoje</div><div class="k-value">${money(soma(p => ['programar', 'fluxo'].includes(fase(p)) && p.data_pagamento <= hoje))}</div><div class="k-sub">${cont(p => fase(p) === 'programar')} ainda fora do fluxo</div></div>
    <div class="kpi"><div class="k-label">Pagos aguardando nota</div><div class="k-value ${velho > 30 ? 'neg' : ''}">${money(semNf.reduce((s, p) => s + +p.valor, 0))}</div><div class="k-sub">${semNf.length} PA${semNf.length ? ` · mais antigo ${velho} dias` : ''}</div></div>
    <div class="kpi"><div class="k-label">Sem nota fiscal (sem lastro)</div><div class="k-value">${money(soma(p => !p.tera_nota && ['aprovado', 'pago'].includes(p.status)))}</div><div class="k-sub">aprovados ou pagos</div></div>`;
  const pagosSist = L.filter(p => fase(p) === 'pago_sist');
  $('#pq-alertas', root).innerHTML = !compras() && podeEditar() && pagosSist.length ? `<div class="card"><div class="alert-list"><div class="alert-row"><span class="alert-tag">Pagamento</span><div class="small">${pagosSist.length} pagamento(s) antecipado(s) já pago(s) no fluxo (${money(pagosSist.reduce((s, p) => s + +p.valor, 0))}). Confirme para virarem adiantamento ao fornecedor e aguardarem a nota. <button class="btn small" id="conf-pagos">Confirmar pagos</button></div></div></div></div>` : '';
  $('#conf-pagos', root) && ($('#conf-pagos', root).onclick = () => confirmarPagos(pagosSist, root));

  const R = L.filter(abas.find(a => a[0] === ui.aba)[2]).filter(filtra);
  VIS = { R, aba: abas.find(a => a[0] === ui.aba)[1] };
  const sel = ui.aba === 'aguardando' && aprova();
  const box = $('#pq-corpo', root);
  if (!R.length) { box.innerHTML = '<div class="card"><div class="empty">Nenhum pagamento antecipado aqui.</div></div>'; return; }
  box.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr>${sel ? '<th><input type="checkbox" id="pq-all"></th>' : ''}<th>Nº</th><th>Pagar em</th><th>Quem recebe</th><th>Descrição</th><th>Nota fiscal</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
    ${R.map(p => linha(p, sel)).join('')}
    </tbody><tfoot><tr>${sel ? '<th></th>' : ''}<th colspan="5">${R.length} pagamento(s) antecipado(s)</th><th class="num">${money(R.reduce((s, p) => s + +p.valor, 0))}</th><th colspan="2"></th></tr></tfoot></table></div>
    ${sel ? `<div class="toolbar" style="padding:12px;justify-content:flex-end;gap:8px"><span class="small" id="pq-seltot"></span><button class="btn" id="pq-rej">Rejeitar</button><button class="btn primary" id="pq-apr">Aprovar selecionados</button></div>` : ''}</div>`;
  box.onclick = (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const p = L.find(x => x.id === a.dataset.id); const act = a.dataset.act;
    if (act === 'editar' || act === 'ver') editar(p, root, act === 'ver');
    else if (act === 'programar') programar(p, root);
    else if (act === 'nota') ligarNota(p, root);
    else if (act === 'cancelar') cancelar(p, root);
    else if (act === 'concluir') concluirSemNota(p, root);
    else if (act === 'comprovante') anexarComprovante(p, root);
    else if (act === 'vercomp') verComprovante(p);
  };
  if (sel) {
    const marcados = () => [...box.querySelectorAll('[data-sel]:checked')].map(i => L.find(p => p.id === i.dataset.sel));
    const tot = () => { const m = marcados(); $('#pq-seltot', box).textContent = m.length ? `${m.length} selecionado(s) · ${money(m.reduce((s, p) => s + +p.valor, 0))}` : ''; };
    $('#pq-all', box).onchange = (e) => { box.querySelectorAll('[data-sel]').forEach(i => { i.checked = e.target.checked; }); tot(); };
    box.addEventListener('change', tot);
    $('#pq-apr', box).onclick = () => decidir(marcados(), 'aprovado', root);
    $('#pq-rej', box).onclick = () => decidir(marcados(), 'rejeitado', root);
  }
}

function linha(p, sel) {
  const f = fase(p), l = LANC.get(p.lancamento_id), ed = podeEditar();
  const sit = f === 'programar' ? '<span class="badge conc">Aprovado · a programar</span>' : f === 'fluxo' ? `<span class="badge conc">No fluxo · ${esc(l?.status || 'lançamento')}</span>`
    : f === 'pago_sist' ? '<span class="badge pago">Pago no fluxo</span>' : f === 'sem_lastro' ? '<span class="badge pago">Pago · sem nota</span>'
    : p.status === 'nota_recebida' && !p.tera_nota ? '<span class="badge pago">Concluído sem nota</span>' : `<span class="badge ${ST_CLS[p.status]}">${ST[p.status]}</span>`;
  const atraso = f === 'sem_nf' ? dias(l?.data || p.data_pagamento) : 0;
  const acoes = [];
  if ((ehMeu(p) && ['aguardando', 'rejeitado'].includes(p.status)) || (ed && ['aguardando', 'rejeitado'].includes(p.status))) acoes.push(['editar', p.status === 'rejeitado' ? 'Corrigir e reenviar' : 'Editar']);
  else acoes.push(['ver', 'Ver']);
  if (!compras() && ed && f === 'programar') acoes.push(['programar', 'Programar no fluxo']);
  if (!compras() && ed && f === 'sem_nf') acoes.push(['nota', 'Ligar nota']);
  if (!compras() && ed && f === 'sem_lastro') acoes.push(['concluir', 'Concluir']);
  if (p.comprovante_path) acoes.push(['vercomp', '📎 Comprovante']);
  if (!compras() && ed && ['aprovado', 'pago', 'nota_recebida'].includes(p.status)) acoes.push(['comprovante', p.comprovante_path ? 'Trocar comprovante' : 'Anexar comprovante']);
  if ((ehMeu(p) && ['aguardando', 'rejeitado'].includes(p.status)) || (ed && ['aguardando', 'rejeitado', 'aprovado'].includes(p.status) && f !== 'pago_sist')) acoes.push(['cancelar', 'Cancelar']);
  return `<tr>${sel ? `<td><input type="checkbox" data-sel="${p.id}"></td>` : ''}<td><strong>${p.numero}</strong>${p.prioridade === 'urgente' ? ' <span class="badge vencido">urgente</span>' : ''}</td>
    <td>${dateBR(p.data_pagamento)}</td>
    <td class="wrap">${esc(p.razao_social)}<div class="small muted">${esc(fmtDoc(p.cnpj))}${p.pix_chave ? ` · Pix ${esc(PIX[p.pix_tipo] || '')}: ${esc(p.pix_chave)}` : ''}${p.conta_bancaria ? ` · ${esc(p.banco || '')} ag ${esc(p.agencia || '')} cc ${esc(p.conta_bancaria)}` : ''}</div></td>
    <td class="wrap small">${esc(p.descricao)}${p.pedido ? `<div class="muted">pedido ${esc(p.pedido)}</div>` : ''}${p.solicitante ? `<div class="muted">por ${esc(p.solicitante)}</div>` : ''}${p.motivo ? `<div class="neg">${esc(p.motivo)}</div>` : ''}</td>
    <td class="small">${p.tera_nota ? `Sim${p.previsao_nota ? ` · prev. ${dateBR(p.previsao_nota)}` : ''}${atraso ? `<div class="${atraso > 30 ? 'neg' : 'muted'}">pago há ${atraso} dias</div>` : ''}` : '<span class="badge vencido">Não terá</span>'}</td>
    <td class="num">${money(p.valor)}</td><td>${sit}</td>
    <td style="white-space:nowrap">${acoes.map(([a, t]) => `<button class="btn ghost small" data-act="${a}" data-id="${p.id}">${t}</button>`).join('')}</td></tr>`;
}

// ---------------------------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------------------------
function editar(p, root, soVer = false, pre = null) {
  const novo = !p, ed = podeEditar(), cad = state.cad;
  const v = p || { prioridade: 'normal', tera_nota: true, data_pagamento: today(), solicitante: state.user?.email?.split('@')[0] || '', ...(pre || {}) };
  const favs = compras() ? [] : cad.favorecidos.filter(f => f.tipo !== 'CLIENTES');
  const dis = soVer ? 'disabled' : '';
  const m = modal({ title: novo ? 'Novo pagamento antecipado' : `Pagamento antecipado — PA nº ${p.numero}${soVer ? '' : ' — editar'}`, wide: true, body: `
    ${p?.motivo && p.status === 'rejeitado' ? `<p class="neg small" style="margin-top:0">Rejeitado: ${esc(p.motivo)}. Corrija e salve para reenviar à aprovação.</p>` : ''}
    <h3 style="margin:0 0 6px">Quem recebe</h3>
    <div class="grid2">
      <label class="grow">Razão social / nome *<input id="rs" ${dis} list="pq-favs" value="${esc(v.razao_social || '')}" placeholder="como está no CNPJ">${favs.length ? `<datalist id="pq-favs">${favs.map(f => `<option value="${esc(f.nome)}"></option>`).join('')}</datalist>` : ''}</label>
      <label>CNPJ / CPF<input id="doc" ${dis} value="${esc(fmtDoc(v.cnpj))}" placeholder="00.000.000/0000-00"></label>
      <label>Pix — tipo<select id="pxt" ${dis}><option value="">—</option>${Object.entries(PIX).map(([k, t]) => `<option value="${k}" ${v.pix_tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="grow">Pix — chave<input id="pxc" ${dis} value="${esc(v.pix_chave || '')}"></label>
      <label>Banco<input id="bco" ${dis} value="${esc(v.banco || '')}" placeholder="ex.: 237 Bradesco"></label>
      <label>Agência<input id="ag" ${dis} value="${esc(v.agencia || '')}"></label>
      <label>Conta<input id="cc" ${dis} value="${esc(v.conta_bancaria || '')}"></label>
    </div>
    <h3 style="margin:12px 0 6px">O pagamento</h3>
    <div class="grid2">
      <label>Valor *<input id="vl" ${dis} value="${v.valor ? (+v.valor).toFixed(2).replace('.', ',') : ''}" placeholder="0,00"></label>
      <label>Pagar em *<input type="date" id="dt" ${dis} value="${v.data_pagamento || ''}"></label>
      <label>Prioridade<select id="pri" ${dis}><option value="normal">Normal</option><option value="urgente" ${v.prioridade === 'urgente' ? 'selected' : ''}>Urgente</option></select></label>
      <label>Terá nota fiscal? *<select id="nf" ${dis}><option value="sim">Sim</option><option value="nao" ${v.tera_nota === false ? 'selected' : ''}>Não</option></select></label>
      <label>Previsão da nota<input type="date" id="pnf" ${dis} value="${v.previsao_nota || ''}"></label>
      <label>Pedido / proforma<input id="ped" ${dis} value="${esc(v.pedido || '')}"></label>
      <label class="grow">Descrição / motivo *<input id="ds" ${dis} value="${esc(v.descricao || '')}" placeholder="ex.: adiantamento resina importação 3; frete Manaus"></label>
      <label class="grow">Anexo (link do pedido, proforma, boleto)<input id="anx" ${dis} value="${esc(v.anexo_url || '')}" placeholder="https://…"></label>
      <label>Solicitante<input id="sol" ${dis} value="${esc(v.solicitante || '')}"></label>
    </div>
    ${!compras() ? `<h3 style="margin:12px 0 6px">Classificação (financeiro)</h3>
    <div class="grid2">
      <label class="grow">Plano de contas<select id="pl" ${soVer || !ed ? 'disabled' : ''}>${options(cad.contasPlano.filter(x => x.natureza !== 'C'), { label: 'label', selected: v.plano_id, empty: '— definir ao programar —' })}</select></label>
      <label>Centro de custo<select id="ccu" ${soVer || !ed ? 'disabled' : ''}>${options(cad.cc, { selected: v.centro_custo_id, empty: '—' })}</select></label>
      <label>Conta de saída<select id="cta" ${soVer || !ed ? 'disabled' : ''}>${options(cad.contas, { selected: v.conta_id, empty: '—' })}</select></label>
    </div>` : ''}
    ${p?.aprovado_em ? `<p class="small muted">${p.status === 'rejeitado' ? 'Rejeitado' : 'Aprovado'} em ${dateBR(p.aprovado_em)}.</p>` : ''}`,
    foot: soVer ? '<button class="btn" data-close>Fechar</button>' : `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">${novo ? 'Enviar para aprovação' : p.status === 'rejeitado' ? 'Reenviar para aprovação' : 'Salvar'}</button>` });
  if (soVer) return;
  // escolher um fornecedor do cadastro preenche CNPJ
  $('#rs', m.el).onchange = () => { const f = favs.find(x => x.nome === $('#rs', m.el).value.trim()); if (f && f.documento && !dig($('#doc', m.el).value)) $('#doc', m.el).value = fmtDoc(f.documento); };
  $('#nf', m.el).onchange = () => { $('#pnf', m.el).disabled = $('#nf', m.el).value === 'nao'; };
  $('#ok', m.el).onclick = async () => {
    const g = (id) => $('#' + id, m.el)?.value?.trim() || '';
    const valor = parseNum(g('vl')), doc = dig(g('doc'));
    if (!g('rs')) return toast('Informe a razão social / nome de quem recebe', true);
    if (doc && ![11, 14].includes(doc.length)) return toast('CNPJ deve ter 14 dígitos (CPF, 11)', true);
    if (!(valor > 0)) return toast('Informe o valor', true);
    if (!g('dt')) return toast('Informe a data do pagamento', true);
    if (!g('ds')) return toast('Informe a descrição / motivo', true);
    if (!g('pxc') && !g('cc')) return toast('Informe a chave Pix ou a conta bancária de quem recebe', true);
    if (g('pxc') && !g('pxt')) return toast('Escolha o tipo da chave Pix', true);
    const fav = favs.find(f => (doc && dig(f.documento) === doc) || f.nome === g('rs'));
    const row = { razao_social: g('rs'), cnpj: doc || null, pix_tipo: g('pxt') || null, pix_chave: g('pxc') || null, banco: g('bco') || null, agencia: g('ag') || null, conta_bancaria: g('cc') || null,
      valor: +valor.toFixed(2), data_pagamento: g('dt'), prioridade: g('pri'), tera_nota: g('nf') === 'sim', previsao_nota: g('nf') === 'sim' ? g('pnf') || null : null,
      pedido: g('ped') || null, descricao: g('ds'), anexo_url: g('anx') || null, solicitante: g('sol') || null };
    if (!compras()) Object.assign(row, { favorecido_id: fav?.id || p?.favorecido_id || null });
    if (!compras() && podeEditar()) Object.assign(row, { plano_id: g('pl') || null, centro_custo_id: g('ccu') || null, conta_id: g('cta') || null });
    if (p?.status === 'rejeitado') Object.assign(row, { status: 'aguardando', motivo: null });
    const btn = $('#ok', m.el); btn.disabled = true;
    try {
      if (novo) { const [r] = await q(sb.from('paraquedas').insert({ ...row, empresa_id: state.empresa.id }).select('numero')); toast(`PA nº ${r?.numero || ''} enviado para autorização`); }
      else { await q(sb.from('paraquedas').update(row).eq('id', p.id)); toast(p.status === 'rejeitado' ? 'Reenviado para aprovação' : 'Pagamento antecipado salvo'); }
      m.close(); carregar(root); dispararAvisos();
    } catch (e) { btn.disabled = false; fail(e); }
  };
}

// ---------------------------------------------------------------------------------------------
// Aprovação (diretor ou financeiro)
// ---------------------------------------------------------------------------------------------
function decidir(sel, status, root) {
  if (!sel.length) return toast('Marque pelo menos um pagamento antecipado', true);
  const tot = sel.reduce((s, p) => s + +p.valor, 0), apr = status === 'aprovado';
  const m = modal({ title: apr ? 'Autorizar pagamentos antecipados' : 'Recusar pagamentos antecipados', body: `
    <p style="margin-top:0">${sel.length} PA · <strong>${money(tot)}</strong>${sel.some(p => !p.tera_nota) ? `<br><span class="neg small">${sel.filter(p => !p.tera_nota).length} sem nota fiscal (${money(sel.filter(p => !p.tera_nota).reduce((s, p) => s + +p.valor, 0))})</span>` : ''}</p>
    <ul class="small" style="max-height:220px;overflow:auto">${sel.map(p => `<li>nº ${p.numero} · ${esc(p.razao_social)} · ${money(p.valor)} · ${dateBR(p.data_pagamento)}</li>`).join('')}</ul>
    ${apr ? '' : '<label>Motivo da rejeição *<input id="mot" placeholder="volta para quem pediu corrigir"></label>'}`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">${apr ? 'Aprovar' : 'Rejeitar'}</button>` });
  $('#ok', m.el).onclick = async () => {
    const motivo = apr ? null : $('#mot', m.el).value.trim(); if (!apr && !motivo) return toast('Informe o motivo', true);
    try {
      await q(sb.from('paraquedas').update({ status, motivo }).in('id', sel.map(p => p.id)));
      toast(apr ? `${sel.length} aprovado(s) · ${money(tot)}` : `${sel.length} rejeitado(s)`); m.close(); carregar(root); dispararAvisos();
    } catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------------------------------------
// Programar: vira lançamento "Em aberto" no fluxo do dia
// ---------------------------------------------------------------------------------------------
function programar(p, root) {
  const cad = state.cad, doc = dig(p.cnpj);
  const fav = cad.favById[p.favorecido_id] || cad.favorecidos.find(f => doc && dig(f.documento) === doc) || cad.favorecidos.find(f => doc.length === 14 && dig(f.documento).slice(0, 8) === doc.slice(0, 8)) || cad.favorecidos.find(f => f.nome === p.razao_social);
  const m = modal({ title: `Programar PA nº ${p.numero}`, wide: true, body: `
    <p class="small muted" style="margin-top:0">Cria o lançamento <strong>Em aberto</strong> em ${dateBR(p.data_pagamento)} — ele entra no fluxo diário, em Contas a pagar e na Autorização de pagamentos. A baixa é feita como em qualquer título.</p>
    <p><strong>${esc(p.razao_social)}</strong> ${esc(fmtDoc(p.cnpj))} · ${money(p.valor)} · ${esc(p.descricao)}</p>
    <div class="grid2">
      <label class="grow">Plano de contas *<select id="pl">${options(cad.contasPlano.filter(x => x.natureza !== 'C'), { label: 'label', selected: p.plano_id, empty: '— escolha —' })}</select></label>
      <label>Centro de custo<select id="ccu">${options(cad.cc, { selected: p.centro_custo_id, empty: '—' })}</select></label>
      <label>Conta de saída<select id="cta">${options(cad.contas, { selected: p.conta_id, empty: '—' })}</select></label>
      <label>Data<input type="date" id="dt" value="${p.data_pagamento < today() ? today() : p.data_pagamento}"></label>
      <label class="grow">Fornecedor no cadastro<select id="fv">${fav ? `<option value="${fav.id}">${esc(fav.nome)} ${esc(fav.documento || '')}</option>` : ''}<option value="">— sem cadastro —</option>${podeEditar() && !fav ? '<option value="novo" selected>Cadastrar agora com a razão social e o CNPJ do pagamento antecipado</option>' : ''}</select></label>
    </div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Criar lançamento</button>' });
  $('#ok', m.el).onclick = async () => {
    const pl = $('#pl', m.el).value; if (!pl) return toast('Escolha o plano de contas', true);
    const btn = $('#ok', m.el); btn.disabled = true;
    try {
      let favId = $('#fv', m.el).value || null;
      if (favId === 'novo') {
        const [f] = await q(sb.from('favorecidos').insert({ empresa_id: state.empresa.id, nome: p.razao_social.toUpperCase(), documento: dig(p.cnpj) || null, tipo: 'FORNECEDORES', ativo: true,
          dados_bancarios: [p.pix_chave ? `Pix ${PIX[p.pix_tipo] || ''}: ${p.pix_chave}` : '', p.conta_bancaria ? `${p.banco || ''} ag ${p.agencia || ''} cc ${p.conta_bancaria}` : ''].filter(Boolean).join(' · ') || null }).select('id'));
        favId = f.id; await loadCadastros(true);
      }
      const [l] = await q(sb.from('lancamentos').insert({ empresa_id: state.empresa.id, data: $('#dt', m.el).value, plano_id: pl, conta_id: $('#cta', m.el).value || null, centro_custo_id: $('#ccu', m.el).value || null,
        favorecido_id: favId, valor: +p.valor, status: 'Em aberto', descricao: `PA ${p.numero} — ${p.descricao}`.slice(0, 250), origem: 'paraquedas' }).select('id'));
      await q(sb.from('paraquedas').update({ lancamento_id: l.id, plano_id: pl, conta_id: $('#cta', m.el).value || null, centro_custo_id: $('#ccu', m.el).value || null, favorecido_id: favId }).eq('id', p.id));
      toast(`PA nº ${p.numero} no fluxo de ${dateBR($('#dt', m.el).value)}`); m.close(); carregar(root);
    } catch (e) { btn.disabled = false; fail(e); }
  };
}

/** lançamentos dos paraquedas já baixados (Pago): com nota → adiantamento ao fornecedor; sem nota → pago sem lastro */
async function confirmarPagos(lista, root) {
  const comNf = lista.filter(p => p.tera_nota && p.favorecido_id), semFav = lista.filter(p => p.tera_nota && !p.favorecido_id);
  if (!confirm(`Confirmar ${lista.length} pagamento(s) antecipado(s) pago(s)?\n\n${comNf.length} viram adiantamento ao fornecedor (aguardam a nota).\n${lista.filter(p => !p.tera_nota).length} sem nota ficam como pagos sem lastro.${semFav.length ? `\n${semFav.length} sem fornecedor no cadastro ficam pagos sem virar adiantamento.` : ''}`)) return;
  let k = 0;
  try {
    for (const p of lista) {
      const l = LANC.get(p.lancamento_id); let credito_id = null;
      if (p.tera_nota && p.favorecido_id) {
        const [c] = await q(sb.from('creditos').insert({ empresa_id: state.empresa.id, favorecido_id: p.favorecido_id, natureza: 'fornecedor', tipo: 'adiantamento', data: l?.data || p.data_pagamento,
          valor: +p.valor, descricao: `PA ${p.numero} — ${p.descricao}`.slice(0, 200), lancamento_id: p.lancamento_id }).select('id'));
        credito_id = c.id;
      }
      await q(sb.from('paraquedas').update({ status: 'pago', credito_id }).eq('id', p.id)); k++;
    }
    toast(`${k} pagamento(s) antecipado(s) confirmado(s) como pagos`);
  } catch (e) { fail(e); }
  carregar(root); dispararAvisos();
}

// ---------------------------------------------------------------------------------------------
// Nota recebida: a nota de entrada abate o adiantamento
// ---------------------------------------------------------------------------------------------
async function ligarNota(p, root) {
  const e = state.empresa.id, doc = dig(p.cnpj), raiz = doc.length === 14 ? doc.slice(0, 8) : doc;
  let notas = [];
  try {
    const cols = 'id,numero,emissao,emit_nome,emit_doc,v_nf,favorecido_id,situacao';
    const a = p.favorecido_id ? await q(sb.from('nfe_notas').select(cols).eq('empresa_id', e).eq('tipo', 'entrada').eq('emissao_propria', false).eq('favorecido_id', p.favorecido_id).order('emissao', { ascending: false }).limit(100)) : [];
    const b = raiz ? await q(sb.from('nfe_notas').select(cols).eq('empresa_id', e).eq('tipo', 'entrada').eq('emissao_propria', false).like('emit_doc', raiz + '%').order('emissao', { ascending: false }).limit(100)) : [];
    const mp = new Map(); for (const n of [...a, ...b]) if (n.situacao !== 'cancelada') mp.set(n.id, n); notas = [...mp.values()];
    const usos = notas.length ? await q(sb.from('creditos_usos').select('nota_id,valor').in('nota_id', notas.map(n => n.id))) : [];
    for (const n of notas) n.falta = +(+n.v_nf - usos.filter(u => u.nota_id === n.id).reduce((s, u) => s + +u.valor, 0)).toFixed(2);
    notas = notas.filter(n => n.falta > 0.005).sort((x, y) => Math.abs(x.falta - p.valor) - Math.abs(y.falta - p.valor));
  } catch (err) { return fail(err); }
  let cred = null;
  if (p.credito_id) { const [c] = await creditoSaldo(p.credito_id); cred = c; }
  const m = modal({ title: `Nota do PA nº ${p.numero}`, wide: true, body: `
    <p class="small muted" style="margin-top:0">${esc(p.razao_social)} · pago ${money(p.valor)}${cred ? ` · saldo do adiantamento ${money(cred.saldo)}` : ''}. Escolha a nota de entrada; o valor dela abate o adiantamento. Se a nota ainda não foi importada, importe o XML em Notas Fiscais.</p>
    ${notas.length ? `<div class="table-wrap" style="max-height:320px"><table><thead><tr><th></th><th>NF</th><th>Emissão</th><th>Emitente</th><th class="num">Valor</th><th class="num">Falta abater</th></tr></thead><tbody>
      ${notas.map((n, i) => `<tr><td><input type="radio" name="nt" value="${n.id}" ${i === 0 ? 'checked' : ''}></td><td>${n.numero}</td><td>${dateBR(n.emissao)}</td><td class="wrap small">${esc(n.emit_nome)}</td><td class="num">${money(n.v_nf)}</td><td class="num">${money(n.falta)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Nenhuma nota de entrada deste fornecedor com valor a abater.</div>'}`,
    foot: `<button class="btn" data-close>Fechar</button>${notas.length ? '<button class="btn primary" id="ok">Ligar e abater</button>' : ''}` });
  $('#ok', m.el) && ($('#ok', m.el).onclick = async () => {
    const n = notas.find(x => x.id === m.el.querySelector('[name=nt]:checked')?.value); if (!n) return;
    try {
      const valor = cred ? Math.min(cred.saldo, n.falta) : 0;
      if (valor > 0.005) await q(sb.from('creditos_usos').insert({ empresa_id: e, credito_id: cred.id, nota_id: n.id, parcela_id: null, data: n.emissao, valor: +valor.toFixed(2), observacao: `PA ${p.numero}` }));
      await q(sb.from('paraquedas').update({ status: 'nota_recebida', nota_id: n.id }).eq('id', p.id));
      toast(`NF ${n.numero} ligada${valor > 0.005 ? ` · ${money(valor)} abatido` : ''}${cred && cred.saldo - valor > 0.005 ? ` · sobra ${money(cred.saldo - valor)} de adiantamento` : ''}`); m.close(); carregar(root);
    } catch (err) { fail(err); }
  });
}
async function creditoSaldo(id) {
  const rows = await q(sb.from('creditos').select('id,valor,u:creditos_usos(valor)').eq('id', id));
  return rows.map(c => ({ ...c, saldo: +(+c.valor - (c.u || []).reduce((s, u) => s + +u.valor, 0)).toFixed(2) }));
}

async function concluirSemNota(p, root) {
  if (!confirm(`Concluir o PA nº ${p.numero} sem nota fiscal (${money(p.valor)})? Ele continua na aba "Sem nota fiscal".`)) return;
  try { await q(sb.from('paraquedas').update({ status: 'nota_recebida' }).eq('id', p.id)); toast('Concluído'); carregar(root); } catch (e) { fail(e); }
}

// Comprovante de pagamento (PDF ou imagem, até 10 MB) — guardado no espaço privado "paraquedas"
function anexarComprovante(p, root) {
  const m = modal({ title: `Comprovante de pagamento — PA nº ${p.numero}`, body: `
    <p class="small muted" style="margin-top:0">${esc(p.razao_social)} · ${money(p.valor)}. PDF ou foto (JPG, PNG), até 10 MB. Quem lançou o pagamento antecipado é avisado.</p>
    ${p.comprovante_path ? `<p class="small">Atual: ${esc(p.comprovante_nome || 'comprovante')} — será substituído.</p>` : ''}
    <input type="file" id="arq" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic">`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Anexar</button>' });
  $('#ok', m.el).onclick = async () => {
    const f = $('#arq', m.el).files[0]; if (!f) return toast('Escolha o arquivo', true);
    if (f.size > 10 * 1024 * 1024) return toast('Arquivo maior que 10 MB', true);
    const btn = $('#ok', m.el); btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const nome = f.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
      const path = `${state.empresa.id}/${p.id}/${Date.now()}-${nome}`;
      const up = await sb.storage.from('paraquedas').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (up.error) throw up.error;
      const antigo = p.comprovante_path;
      await q(sb.from('paraquedas').update({ comprovante_path: path, comprovante_nome: f.name.slice(0, 200), comprovante_em: new Date().toISOString(), comprovante_por: state.user?.email || null }).eq('id', p.id));
      if (antigo) await sb.storage.from('paraquedas').remove([antigo]);
      toast('Comprovante anexado'); m.close(); carregar(root); dispararAvisos();
    } catch (e) { btn.disabled = false; btn.textContent = 'Anexar'; fail(/bucket|not found/i.test(e.message || '') ? new Error('O espaço de comprovantes ainda não foi criado: rode a migration 20261015000036.') : e); }
  };
}
async function verComprovante(p) {
  const w = window.open('', '_blank');
  try {
    const { data, error } = await sb.storage.from('paraquedas').createSignedUrl(p.comprovante_path, 300);
    if (error) throw error;
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  } catch (e) { if (w) w.close(); fail(e); }
}

async function cancelar(p, root) {
  const l = LANC.get(p.lancamento_id);
  const motivo = prompt(`Cancelar o PA nº ${p.numero} (${money(p.valor)})?${l ? '\nO lançamento em aberto no fluxo também será excluído.' : ''}\n\nMotivo:`);
  if (motivo === null) return;
  try {
    if (l) { if (l.status === 'Pago') return toast('O lançamento já foi pago — não dá para cancelar.', true); await q(sb.from('lancamentos').delete().eq('id', l.id)); }
    await q(sb.from('paraquedas').update({ status: 'cancelado', motivo: motivo || 'cancelado', lancamento_id: null }).eq('id', p.id));
    toast('Pagamento antecipado cancelado'); carregar(root); dispararAvisos();
  } catch (e) { fail(e); }
}

// ---------------------------------------------------------------------------------------------
// Relatório em PDF (A4 deitado) da aba aberta, com a busca aplicada
// ---------------------------------------------------------------------------------------------
const pdfTxt = (t) => String(t ?? '').replace(/[−–—]/g, '-').replace(/×/g, 'x').replace(/ /g, ' ').replace(/[✓✕·]/g, (c) => c === '·' ? '-' : '');
function situacaoTxt(p) {
  const f = fase(p), l = LANC.get(p.lancamento_id);
  return f === 'programar' ? 'Aprovado - a programar' : f === 'fluxo' ? `No fluxo (${l?.status || 'lançamento'})` : f === 'pago_sist' ? 'Pago no fluxo'
    : f === 'sem_lastro' ? 'Pago - sem nota' : p.status === 'nota_recebida' && !p.tera_nota ? 'Concluído sem nota' : ST[p.status];
}
async function relatorioPDF() {
  const R = VIS.R;
  if (!R.length) return toast('Nenhum pagamento antecipado nesta aba para o relatório', true);
  if (!window.jspdf) return toast('Biblioteca de PDF ainda carregando, tente de novo em instantes', true);
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  if (!doc.autoTable) return toast('Biblioteca de tabelas do PDF ainda carregando', true);
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 10;
  const azul = [43, 85, 152], marinho = [42, 31, 111];
  const logo = await logoPNG();
  const titulo = `Pagamentos Antecipados - ${VIS.aba}`;
  const cabecalho = () => {
    if (logo) doc.addImage(logo.data, 'PNG', M, 7, 11 * logo.ratio, 11);
    doc.setTextColor(...marinho); doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text(pdfTxt(titulo), W - M, 12, { align: 'right' });
    doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90);
    doc.text(pdfTxt(`${state.empresa.nome} - pagamentos pedidos antes da nota fiscal - emitido em ${new Date().toLocaleString('pt-BR')}${ui.busca.trim() ? ` - busca: "${ui.busca.trim()}"` : ''}`), W - M, 17, { align: 'right' });
    doc.setDrawColor(...marinho); doc.setLineWidth(.5); doc.line(M, 20, W - M, 20); doc.setTextColor(20);
  };
  cabecalho();
  // resumo
  const tot = R.reduce((s, p) => s + +p.valor, 0), urg = R.filter(p => p.prioridade === 'urgente'), semNf = R.filter(p => !p.tera_nota);
  const datas = R.map(p => p.data_pagamento).filter(Boolean).sort();
  const kpis = [['Pagamentos antecipados', String(R.length), datas.length ? `pagamento de ${dateBR(datas[0])} a ${dateBR(datas[datas.length - 1])}` : ''],
    ['Valor total', money(tot), ''], ['Urgentes', String(urg.length), money(urg.reduce((s, p) => s + +p.valor, 0))],
    ['Sem nota fiscal', String(semNf.length), money(semNf.reduce((s, p) => s + +p.valor, 0))]];
  doc.autoTable({ startY: 23, theme: 'plain', body: [kpis.map(k => k[0]), kpis.map(k => k[1]), kpis.map(k => k[2])].map(r => r.map(pdfTxt)), margin: { left: M, right: M },
    styles: { fontSize: 8, cellPadding: { top: .5, bottom: .5, left: 1.5, right: 1.5 } }, columnStyles: Object.fromEntries([0, 1, 2, 3].map(i => [i, { cellWidth: (W - 2 * M) / 4 }])),
    didParseCell: (d) => { const r = d.row.index; if (r !== 1) { d.cell.styles.textColor = 110; d.cell.styles.fontSize = 7.2; } else { d.cell.styles.fontSize = 12; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = marinho; } } });
  // tabela
  const banco = (p) => [p.pix_chave ? `Pix ${PIX[p.pix_tipo] || ''}: ${p.pix_chave}` : '', p.conta_bancaria ? `${p.banco || ''} ag ${p.agencia || ''} cc ${p.conta_bancaria}` : ''].filter(Boolean).join('\n') || '-';
  const body = R.map(p => [
    String(p.numero) + (p.prioridade === 'urgente' ? '\nURGENTE' : ''),
    dateBR(p.data_pagamento),
    `${p.razao_social}${p.cnpj ? `\n${fmtDoc(p.cnpj)}` : ''}`,
    banco(p),
    `${p.descricao}${p.pedido ? `\npedido ${p.pedido}` : ''}${p.solicitante ? `\npor ${p.solicitante}` : ''}${p.motivo ? `\n${p.motivo}` : ''}`,
    p.tera_nota ? `Sim${p.previsao_nota ? `\nprev. ${dateBR(p.previsao_nota)}` : ''}` : 'Não terá',
    situacaoTxt(p) + (p.aprovado_em ? `\n${['rejeitado'].includes(p.status) ? 'decidido' : 'aprovado'} ${dateBR(p.aprovado_em.slice(0, 10))}` : ''),
    money(p.valor),
  ].map(pdfTxt));
  doc.autoTable({ startY: (doc.lastAutoTable?.finalY ?? 30) + 3, theme: 'grid', margin: { left: M, right: M, top: 24 },
    head: [['Nº', 'Pagar em', 'Quem recebe', 'Pix / dados bancários', 'Descrição', 'Nota fiscal', 'Situação', 'Valor']],
    body, foot: [['', '', `${R.length} PA`, '', '', '', 'Total', money(tot)]],
    styles: { fontSize: 7.4, cellPadding: 1.3, lineColor: [226, 231, 239], valign: 'top' }, headStyles: { fillColor: azul, textColor: 255 },
    footStyles: { fillColor: [232, 238, 248], textColor: 20, fontStyle: 'bold' }, showFoot: 'lastPage',
    columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 18 }, 2: { cellWidth: 52 }, 3: { cellWidth: 46 }, 4: { cellWidth: 'auto' }, 5: { cellWidth: 24 }, 6: { cellWidth: 34 }, 7: { cellWidth: 24, halign: 'right' } },
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0 && /URGENTE/.test(d.cell.raw)) d.cell.styles.textColor = [192, 53, 43]; if (d.column.index === 7) d.cell.styles.halign = 'right'; },
    didDrawPage: (d) => { if (d.pageNumber > 1) cabecalho(); } });
  // assinaturas
  let y = doc.lastAutoTable.finalY + 18;
  if (y > H - 20) { doc.addPage(); cabecalho(); y = 45; }
  const larg = (W - 2 * M - 20) / 3;
  ['Solicitante / Compras', 'Financeiro', 'Autorizado por (diretor / financeiro)'].forEach((t, i) => {
    const x = M + i * (larg + 10);
    doc.setDrawColor(120); doc.setLineWidth(.2); doc.line(x, y, x + larg, y);
    doc.setFontSize(8); doc.setTextColor(90); doc.text(pdfTxt(t), x + larg / 2, y + 4, { align: 'center' });
  });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7); doc.setTextColor(130); doc.text(`Página ${i} de ${n}`, W - M, H - 5, { align: 'right' }); doc.text('Fonte: Pagamentos Antecipados (fluxo-caixa-saas)', M, H - 5); }
  doc.save(`pagamentos_antecipados_${VIS.aba.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')}_${today()}.pdf`);
}

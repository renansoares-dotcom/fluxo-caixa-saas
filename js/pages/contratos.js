// Contratos (SQL 068) — só administradores. Cadastro, PDF assinado (gov.br) e aditivos, alertas de vencimento,
// aviso prévio e reajuste, parcelas no fluxo de caixa e reajuste proposto → aprovado.
import { sb, state, q, isAdmin, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, today, dateBR, money, options, erroTela, logoPNG } from '../lib/ui.js';
import * as K from '../lib/contratos.js';
import * as M from '../lib/contratos-modelos.js';

export const title = 'Contratos';
const BUCKET = 'contratos';
const ui = { filtro: 'vigentes', busca: '' };
let D = null;

async function carregar() {
  const e = state.empresa.id;
  await loadCadastros();
  const seguro = (p) => p.catch(() => []);
  const [C, A, R, T, P, L] = await Promise.all([
    q(sb.from('contratos').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
    q(sb.from('contrato_arquivos').select('*').eq('empresa_id', e).order('enviado_em', { ascending: false })),
    q(sb.from('contrato_reajustes').select('*').eq('empresa_id', e).order('data_base', { ascending: false })),
    seguro(q(sb.from('log_transportadores').select('id,nome,documento,favorecido_id,rntrc,veiculos').eq('empresa_id', e).order('nome'))),
    seguro(q(sb.from('rh_colaboradores').select('id,nome,cpf,situacao').eq('empresa_id', e).order('nome'))),
    q(sb.from('lancamentos').select('id,contrato_id,data,valor,status').eq('empresa_id', e).not('contrato_id', 'is', null)),
  ]);
  const por = (xs, k = 'contrato_id') => { const m = {}; for (const x of xs) (m[x[k]] ||= []).push(x); return m; };
  D = { C, A: por(A), R: por(R), T, P, L: por(L), hoje: today() };
  return D;
}
const arqDe = (c) => D.A[c.id] || [], reaDe = (c) => D.R[c.id] || [], parcDe = (c) => D.L[c.id] || [];
const alertasDe = (c) => K.alertas(c, arqDe(c), reaDe(c), D.hoje);

export async function render(root) {
  if (!isAdmin()) { root.innerHTML = '<div class="card"><div class="empty">Contratos: acesso só para administradores da empresa.</div></div>'; return; }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Contratos</h2><div class="muted small">Vigência, aviso prévio, reajuste, PDF assinado e parcelas no fluxo de caixa. Acesso só de administradores.</div></div>
      <button class="btn primary" id="ct-novo">Novo contrato</button></div><div id="ct-corpo"><div class="loading">Carregando…</div></div>`;
  $('#ct-novo', root).onclick = () => ficha(null, root);
  try { await carregar(); } catch (err) { console.error(err); $('#ct-corpo', root).innerHTML = erroTela('os contratos'); return; }
  lista($('#ct-corpo', root), root);
  const ab = state.abrir?.tipo === 'contrato' ? state.abrir : null;
  if (ab) { delete state.abrir; const c = D.C.find(x => x.id === ab.id); if (c) ficha(c, root); }
}

function lista(corpo, root) {
  const vig = D.C.filter(c => c.status === 'vigente');
  const comAlerta = vig.filter(c => alertasDe(c).some(a => a.nivel !== 'info'));
  const pagar = vig.filter(c => c.natureza === 'pagar').reduce((s, c) => s + K.valorMensal(c), 0);
  const receber = vig.filter(c => c.natureza === 'receber').reduce((s, c) => s + K.valorMensal(c), 0);
  const semPdf = vig.filter(c => !arqDe(c).some(a => a.tipo === 'assinado')).length;
  const t = (ui.busca || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const xs = D.C.filter(c => ui.filtro === 'todos' || (ui.filtro === 'vigentes' && c.status === 'vigente') || (ui.filtro === 'alertas' && comAlerta.includes(c))
      || (ui.filtro === 'encerrados' && ['encerrado', 'rescindido'].includes(c.status)) || (ui.filtro === 'rascunho' && c.status === 'rascunho'))
    .filter(c => !t || `${c.numero} ${c.parte_nome} ${c.objeto} ${K.TIPOS[c.tipo]} ${c.parte_documento || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(t));
  const kpi = (r, v, s = '', cl = '') => `<div class="kpi"><div class="k-label">${r}</div><div class="k-value ${cl}">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  corpo.innerHTML = `<div class="kpis">${kpi('Contratos vigentes', vig.length)}${kpi('A pagar por mês', money(pagar), 'equivalente mensal')}${kpi('A receber por mês', money(receber), 'equivalente mensal')}
      ${kpi('Com alerta', comAlerta.length, comAlerta.length ? 'vencimento, aviso ou reajuste' : 'nenhum', comAlerta.length ? 'neg' : '')}${kpi('Sem PDF assinado', semPdf, semPdf ? 'anexe o contrato assinado' : 'todos anexados', semPdf ? 'warn' : '')}</div>
    <div class="card toolbar" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <div class="chips" id="ct-f">${[['vigentes', 'Vigentes'], ['alertas', 'Com alerta'], ['rascunho', 'Rascunhos'], ['encerrados', 'Encerrados'], ['todos', 'Todos']].map(([k, n]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${n}</span>`).join('')}</div>
      <input id="ct-busca" placeholder="Buscar nº, parte, objeto, CNPJ…" value="${esc(ui.busca)}" style="min-width:240px;margin-left:auto"></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Parte</th><th>Tipo / objeto</th><th class="num">Valor</th><th>Vigência</th><th>Reajuste</th><th>Situação</th></tr></thead><tbody>
    ${xs.map(c => { const al = alertasDe(c);
      return `<tr class="clickable" data-id="${c.id}"><td><b>${c.numero}</b></td><td style="white-space:normal;min-width:220px">${esc(c.parte_nome)}<div class="small muted">${esc(c.parte_documento || '')}</div>
          ${al.map(a => `<div class="small ${a.nivel === 'neg' ? 'neg' : a.nivel === 'warn' ? 'warn' : 'muted'}">${esc(a.txt)}</div>`).join('')}</td>
        <td style="white-space:normal;max-width:280px">${esc(K.TIPOS[c.tipo] || c.tipo)}<div class="small muted">${esc(c.objeto)}</div></td>
        <td class="num">${c.natureza === 'sem_valor' ? '<span class="muted">—</span>' : `${money(c.valor)}<div class="small muted">${K.PERIODO[c.periodicidade]} · ${K.NATUREZA[c.natureza].toLowerCase()}</div>`}</td>
        <td class="small">${dateBR(c.inicio)} a ${c.fim ? dateBR(c.fim) : 'indeterminado'}${c.renovacao_automatica ? '<div class="muted">renovação automática</div>' : ''}</td>
        <td class="small">${c.indice === 'nenhum' || c.natureza === 'sem_valor' ? '<span class="muted">—</span>' : `${esc(c.indice)}${c.data_base ? `<div class="muted">${dateBR(c.data_base)}</div>` : ''}`}</td>
        <td><span class="badge ${c.status === 'vigente' ? 'pago' : c.status === 'rascunho' ? 'aberto' : ''}">${K.STATUS[c.status]}</span></td></tr>`; }).join('')
      || '<tr><td colspan="7" class="empty">Nenhum contrato neste filtro.</td></tr>'}</tbody></table></div></div>`;
  $('#ct-f', corpo).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; lista(corpo, root); } };
  $('#ct-busca', corpo).oninput = (e) => { ui.busca = e.target.value; const p = e.target.selectionStart; lista(corpo, root); const i = $('#ct-busca', corpo); i.focus(); i.setSelectionRange(p, p); };
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => ficha(D.C.find(c => c.id === tr.dataset.id), root));
}

// ---------------------------------------------------------------- ficha
function ficha(c0, root) {
  const c = c0 || { tipo: 'servico', natureza: 'pagar', parte_tipo: 'favorecido', periodicidade: 'mensal', inicio: D.hoje, aviso_previo_dias: 30, indice: 'IPCA', status: 'vigente', renovacao_automatica: false };
  const cad = state.cad;
  const favs = cad.favorecidos.filter(f => f.ativo || f.id === c.favorecido_id);
  const sel = (id, obj, v) => `<select id="${id}">${Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const md = modal({ title: c0 ? `Contrato nº ${c0.numero}` : 'Novo contrato', wide: true, body: `
    <div class="grid2">
      <label>Tipo${sel('k-tipo', K.TIPOS, c.tipo)}</label>
      <label>Natureza${sel('k-nat', K.NATUREZA, c.natureza)}</label>
      <label class="span2">Objeto *<input id="k-obj" value="${esc(c.objeto || '')}" placeholder="ex.: Locação de caminhão baú placa ABC1D23 com motorista"></label>
      <label>Outra parte vem de${sel('k-pt', { favorecido: 'Beneficiários (fornecedor/cliente)', transportador: 'Transportadores', colaborador: 'Colaboradores (RH)', outro: 'Digitar nome e documento' }, c.parte_tipo)}</label>
      <label id="k-parte-w">Parte</label>
      <label>Nome da parte *<input id="k-nome" value="${esc(c.parte_nome || '')}"></label>
      <label>CPF / CNPJ<input id="k-doc" value="${esc(c.parte_documento || '')}"></label>
    </div>
    <h3 style="margin:16px 0 6px">Valor e vigência</h3>
    <div class="grid2">
      <label>Valor (R$)<input id="k-valor" type="number" step="0.01" min="0" value="${c.valor ?? ''}"></label>
      <label>Periodicidade${sel('k-per', K.PERIODO, c.periodicidade)}</label>
      <label>Dia do vencimento<input id="k-dia" type="number" min="1" max="31" value="${c.dia_vencimento ?? ''}" placeholder="mesmo dia do início"></label>
      <label>Início *<input id="k-ini" type="date" value="${c.inicio || ''}"></label>
      <label>Fim<input id="k-fim" type="date" value="${c.fim || ''}"><span class="small muted">vazio = prazo indeterminado</span></label>
      <label>Aviso prévio (dias)<input id="k-aviso" type="number" min="0" max="365" value="${c.aviso_previo_dias ?? 30}"></label>
      <label class="span2" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="k-renova" ${c.renovacao_automatica ? 'checked' : ''} style="width:auto"> Renovação automática no fim do prazo</label>
      <label>Índice de reajuste${sel('k-ind', K.INDICES, c.indice)}</label>
      <label>Próxima data-base<input id="k-base" type="date" value="${c.data_base || ''}"><span class="small muted">normalmente o aniversário do contrato</span></label>
      <label id="k-fixo-w" ${c.indice === 'fixo' ? '' : 'hidden'}>Percentual fixo (% a.a.)<input id="k-fixo" type="number" step="0.01" value="${c.reajuste_fixo_pct ?? ''}"></label>
    </div>
    <h3 style="margin:16px 0 6px">Fluxo de caixa</h3>
    <div class="grid2">
      <label class="span2">Conta do plano (parcelas)<select id="k-plano">${options(cad.contasPlano, { value: 'id', label: 'label', selected: c.plano_id, empty: '— escolha para gerar parcelas —' })}</select></label>
      <label>Centro de custo<select id="k-cc">${options(cad.cc, { selected: c.centro_custo_id, empty: '—' })}</select></label>
      <label>Conta bancária<select id="k-conta">${options(cad.contas, { selected: c.conta_id, empty: '—' })}</select></label>
      <label>Responsável<input id="k-resp" value="${esc(c.responsavel || '')}" placeholder="quem acompanha o contrato"></label>
      <label>Situação${sel('k-st', K.STATUS, c.status)}</label>
      <label class="span2">Observações<textarea id="k-obs" rows="2">${esc(c.observacoes || '')}</textarea></label>
    </div>
    ${c0 ? `<div id="k-extra"></div>` : '<p class="small muted">Salve para anexar o PDF assinado, gerar as parcelas e propor reajustes.</p>'}`,
    foot: `${c0 ? '<button class="btn danger" id="k-enc" style="margin-right:auto">Encerrar / rescindir</button>' : ''}<button class="btn" data-close>Fechar</button><button class="btn primary" id="k-ok">Salvar</button>` });
  const el = md.el, F = (id) => $('#' + id, el);
  const parteSel = () => {
    const pt = F('k-pt').value, w = F('k-parte-w');
    const lst = pt === 'favorecido' ? favs.map(f => ({ id: f.id, nome: f.label, doc: f.documento }))
      : pt === 'transportador' ? D.T.map(t => ({ id: t.id, nome: t.nome, doc: t.documento })) : pt === 'colaborador' ? D.P.map(p => ({ id: p.id, nome: p.nome, doc: p.cpf })) : null;
    if (!lst) { w.innerHTML = 'Parte<input disabled value="digite nome e documento ao lado">'; return; }
    const atual = pt === 'favorecido' ? c.favorecido_id : pt === 'transportador' ? c.transportador_id : c.colaborador_id;
    w.innerHTML = `Parte<select id="k-parte"><option value="">— escolha —</option>${lst.map(x => `<option value="${x.id}" ${x.id === atual ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>`;
    F('k-parte').onchange = (e) => { const x = lst.find(y => y.id === e.target.value); if (x) { F('k-nome').value = (x.nome || '').replace(/^.* - /, '') || x.nome; if (x.doc) F('k-doc').value = x.doc; } };
  };
  parteSel(); F('k-pt').onchange = parteSel;
  F('k-ind').onchange = (e) => { F('k-fixo-w').hidden = e.target.value !== 'fixo'; };
  F('k-ini').onchange = (e) => { if (!F('k-base').value && e.target.value) { const d = new Date(e.target.value + 'T12:00:00'); d.setFullYear(d.getFullYear() + 1); F('k-base').value = d.toISOString().slice(0, 10); } };

  F('k-ok').onclick = async (ev) => {
    const pt = F('k-pt').value, pid = $('#k-parte', el)?.value || null;
    const row = { empresa_id: state.empresa.id, tipo: F('k-tipo').value, natureza: F('k-nat').value, objeto: F('k-obj').value.trim(), parte_tipo: pt,
      favorecido_id: pt === 'favorecido' ? pid : null, transportador_id: pt === 'transportador' ? pid : null, colaborador_id: pt === 'colaborador' ? pid : null,
      parte_nome: F('k-nome').value.trim(), parte_documento: F('k-doc').value.replace(/\D/g, '') || null,
      valor: +F('k-valor').value || 0, periodicidade: F('k-nat').value === 'sem_valor' ? 'sem_valor' : F('k-per').value, dia_vencimento: +F('k-dia').value || null,
      inicio: F('k-ini').value, fim: F('k-fim').value || null, aviso_previo_dias: +F('k-aviso').value || 0, renovacao_automatica: F('k-renova').checked,
      indice: F('k-ind').value, reajuste_fixo_pct: F('k-ind').value === 'fixo' ? (+F('k-fixo').value || null) : null, data_base: F('k-base').value || null,
      plano_id: F('k-plano').value || null, centro_custo_id: F('k-cc').value || null, conta_id: F('k-conta').value || null,
      responsavel: F('k-resp').value.trim() || null, status: F('k-st').value, observacoes: F('k-obs').value.trim() || null };
    if (!row.objeto || !row.parte_nome || !row.inicio) return toast('Preencha objeto, nome da parte e início', true);
    if (row.fim && row.fim < row.inicio) return toast('O fim não pode ser antes do início', true);
    if (pt === 'transportador' && pid) row.favorecido_id = D.T.find(t => t.id === pid)?.favorecido_id || null;
    ev.target.disabled = true;
    try {
      if (c0) await q(sb.from('contratos').update(row).eq('id', c0.id));
      else { const [n] = await q(sb.from('contratos').insert(row).select('*')); c0 ? null : Object.assign(c, n); }
      toast('Contrato salvo'); md.close(); await carregar(); lista($('#ct-corpo', root), root);
      const novo = D.C.find(x => x.id === (c0?.id || c.id)); if (novo && !c0) ficha(novo, root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  if (c0) { extras(c0, el, md, root); F('k-enc').onclick = () => encerrar(c0, md, root); }
}

function extras(c, el, md, root) {
  const box = $('#k-extra', el), arqs = arqDe(c), reas = reaDe(c), parc = parcDe(c);
  const abertas = parc.filter(p => p.status === 'Em aberto').sort((a, b) => a.data.localeCompare(b.data));
  const al = alertasDe(c);
  box.innerHTML = `
    ${al.length ? `<div class="card" style="margin-top:12px;background:var(--bg-soft,#f6f7fb)">${al.map(a => `<div class="small ${a.nivel === 'neg' ? 'neg' : a.nivel === 'warn' ? 'warn' : 'muted'}">• ${esc(a.txt)}</div>`).join('')}
      ${al.some(a => a.k === 'renovar') ? `<button class="btn small" id="k-renovar" style="margin-top:6px">Renovar até ${dateBR(K.proximaVigencia(c))}</button>` : ''}</div>` : ''}
    <div id="k-min"></div>
    <h3 style="margin:16px 0 6px">Documentos</h3>
    <div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Arquivo</th><th>Assinatura</th><th>Enviado</th><th></th></tr></thead><tbody>
      ${arqs.map(a => `<tr><td>${esc(K.ARQ[a.tipo] || a.tipo)}</td><td>${esc(a.nome)}${a.descricao ? `<div class="small muted">${esc(a.descricao)}</div>` : ''}</td>
        <td class="small">${a.assinatura_digital ? '<span class="pos">digital ✓</span>' : a.nome.toLowerCase().endsWith('.pdf') ? '<span class="warn">sem assinatura digital</span>' : '<span class="muted">—</span>'}</td>
        <td class="small">${dateBR(a.enviado_em)}</td><td><button class="btn small" data-abrir="${a.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum documento anexado.</td></tr>'}</tbody></table></div>
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:8px">
      <label>Tipo<select id="k-at">${Object.entries(K.ARQ).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label class="grow">Descrição<input id="k-ad" placeholder="ex.: assinado no gov.br por ambas as partes"></label>
      <input type="file" id="k-arq" accept="application/pdf,image/png,image/jpeg" hidden><button class="btn" id="k-env">Anexar arquivo</button></div>
    <p class="small muted">Assinatura: baixe a minuta, assine em <b>assinador.iti.br</b> (gov.br) e peça à outra parte que assine o mesmo arquivo. Depois anexe aqui como "Contrato assinado". A plataforma confere se o PDF tem assinatura digital.</p>
    ${c.natureza !== 'sem_valor' ? `<h3 style="margin:16px 0 6px">Parcelas no fluxo</h3>
    <p class="small">${parc.length} parcela(s) geradas · ${abertas.length} em aberto${abertas.length ? ` · próxima ${dateBR(abertas[0].data)} (${money(abertas[0].valor)})` : ''}.</p>
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><label>Gerar até<input type="date" id="k-ate" value="${K.addDias(D.hoje, 365)}"></label>
      <button class="btn" id="k-gerar" ${c.status !== 'vigente' || !c.plano_id || !(+c.valor > 0) ? 'disabled' : ''}>Gerar parcelas que faltam</button>
      ${parc.length ? '<a class="btn ghost" id="k-verlanc" href="#/lancamentos">Ver em Lançamentos</a>' : ''}</div>
    ${!c.plano_id ? '<p class="small warn">Escolha a conta do plano e salve para gerar as parcelas.</p>' : ''}
    <h3 style="margin:16px 0 6px">Reajustes</h3>
    <div class="table-wrap"><table><thead><tr><th>Data-base</th><th>Índice</th><th class="num">%</th><th class="num">De</th><th class="num">Para</th><th>Situação</th><th></th></tr></thead><tbody>
      ${reas.map(r => `<tr><td>${dateBR(r.data_base)}</td><td class="small">${esc(r.indice)}<div class="muted">${esc(r.fonte || '')}</div></td><td class="num">${K.pctBR(r.percentual)}</td>
        <td class="num">${money(r.valor_anterior)}</td><td class="num">${money(r.valor_novo)}</td><td><span class="badge ${r.status === 'aprovado' ? 'pago' : r.status === 'proposto' ? 'aberto' : ''}">${r.status}</span></td>
        <td>${r.status === 'proposto' ? `<button class="btn small primary" data-apr="${r.id}">Aprovar</button> <button class="btn small" data-rec="${r.id}">Recusar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum reajuste.</td></tr>'}</tbody></table></div>
    ${c.indice !== 'nenhum' && c.data_base && !reas.some(r => r.data_base === c.data_base) ? `<button class="btn" id="k-calc" style="margin-top:8px">Calcular reajuste de ${dateBR(c.data_base)}</button>` : ''}` : ''}`;

  minuta(c, $('#k-min', box), md, root);
  $$('[data-abrir]', box).forEach(b => b.onclick = async () => {
    const a = arqs.find(x => x.id === b.dataset.abrir);
    try { const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.path, 300); if (error) throw error; window.open(data.signedUrl, '_blank', 'noopener'); } catch (err) { fail(err); }
  });
  $('#k-env', box).onclick = () => $('#k-arq', box).click();
  $('#k-arq', box).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 15 * 1024 * 1024) return toast('Arquivo acima de 15 MB', true);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const sig = pdf ? K.temAssinaturaDigital(buf) : null;
      const tipo = $('#k-at', box).value;
      if (tipo === 'assinado' && pdf && !sig && !(await confirmDialog('Este PDF não tem assinatura digital (gov.br ou certificado). Anexar mesmo assim como contrato assinado?'))) return;
      const nome = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
      const path = `${state.empresa.id}/${c.id}/${Date.now()}-${nome}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/pdf' }); if (error) throw error;
      await q(sb.from('contrato_arquivos').insert({ empresa_id: state.empresa.id, contrato_id: c.id, tipo, nome: f.name, path, assinatura_digital: sig, descricao: $('#k-ad', box).value.trim() || null }));
      toast(sig ? 'Anexado · assinatura digital encontrada' : 'Anexado'); await refazer(c, md, root);
    } catch (err) { fail(err); }
  };
  $('#k-gerar', box)?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try { const n = await q(sb.rpc('contrato_gerar_parcelas', { p_contrato: c.id, p_ate: $('#k-ate', box).value || null })); toast(n ? `${n} parcela(s) criadas no fluxo` : 'Nenhuma parcela faltando'); await refazer(c, md, root); }
    catch (err) { fail(err); ev.target.disabled = false; }
  });
  $('#k-calc', box)?.addEventListener('click', () => propor(c, md, root));
  $$('[data-apr],[data-rec]', box).forEach(b => b.onclick = async () => {
    const apr = !!b.dataset.apr, id = b.dataset.apr || b.dataset.rec, r = reas.find(x => x.id === id);
    if (!(await confirmDialog(apr ? `Aprovar o reajuste de ${K.pctBR(r.percentual)}? O valor passa para ${money(r.valor_novo)} e as parcelas em aberto a partir de ${dateBR(r.data_base)} serão atualizadas.` : 'Recusar este reajuste? O valor continua o mesmo e a próxima data-base passa para daqui a um ano.'))) return;
    try { await q(sb.rpc('contrato_decidir_reajuste', { p_reajuste: id, p_aprovar: apr })); toast(apr ? 'Reajuste aprovado' : 'Reajuste recusado'); await refazer(c, md, root); } catch (err) { fail(err); }
  });
  $('#k-renovar', box)?.addEventListener('click', async () => {
    const nv = K.proximaVigencia(c);
    try { await q(sb.from('contratos').update({ fim: nv }).eq('id', c.id)); toast(`Vigência renovada até ${dateBR(nv)}`); await refazer(c, md, root); } catch (err) { fail(err); }
  });
}

async function refazer(c, md, root) { md.close(); await carregar(); lista($('#ct-corpo', root), root); const n = D.C.find(x => x.id === c.id); if (n) ficha(n, root); }

function propor(c, md0, root) {
  const md = modal({ title: `Reajuste — contrato nº ${c.numero}`, body: `
    <p class="small muted" style="margin-top:0">Data-base ${dateBR(c.data_base)} · índice ${esc(K.INDICES[c.indice])} · valor atual ${money(c.valor)}. O reajuste fica <b>proposto</b> e só muda os valores depois de aprovado.</p>
    <div class="grid2"><label>Percentual (%)<input id="r-pct" type="number" step="0.0001" value="${c.indice === 'fixo' ? (c.reajuste_fixo_pct ?? '') : ''}"></label>
      <label>Novo valor<input id="r-novo" disabled></label><label class="span2">Fonte<input id="r-fonte" value="${c.indice === 'fixo' ? 'Percentual fixo do contrato' : ''}"></label></div>
    <p class="small" id="r-msg">${c.indice === 'fixo' ? '' : 'Buscando o índice no Banco Central…'}</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="r-ok">Propor reajuste</button>' });
  const el = md.el, atual = () => { const p = +$('#r-pct', el).value; $('#r-novo', el).value = isFinite(p) && $('#r-pct', el).value !== '' ? money(K.reajustar(c.valor, p)) : ''; };
  $('#r-pct', el).oninput = atual; atual();
  if (c.indice !== 'fixo') K.indiceAcumulado(c.indice, c.data_base).then(r => { $('#r-pct', el).value = r.percentual; $('#r-fonte', el).value = r.fonte; $('#r-msg', el).textContent = `Acumulado em 12 meses: ${K.pctBR(r.percentual)}. Confira antes de propor.`; atual(); })
    .catch(err => { $('#r-msg', el).innerHTML = `<span class="warn">Não foi possível buscar o índice (${esc(err.message)}). Informe o percentual acumulado e a fonte.</span>`; $('#r-fonte', el).value = 'informado'; });
  $('#r-ok', el).onclick = async (ev) => {
    const p = $('#r-pct', el).value; if (p === '' || !isFinite(+p)) return toast('Informe o percentual', true);
    ev.target.disabled = true;
    try {
      await q(sb.from('contrato_reajustes').insert({ empresa_id: state.empresa.id, contrato_id: c.id, data_base: c.data_base, indice: c.indice, percentual: +p,
        valor_anterior: c.valor, valor_novo: K.reajustar(c.valor, +p), fonte: $('#r-fonte', el).value.trim() || null }));
      md.close(); toast('Reajuste proposto: aprove na ficha do contrato'); await refazer(c, md0, root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

function encerrar(c, md0, root) {
  const futuras = parcDe(c).filter(p => p.status === 'Em aberto' && p.data > D.hoje);
  const md = modal({ title: `Encerrar contrato nº ${c.numero}`, body: `
    <div class="grid2"><label>Situação<select id="e-st"><option value="encerrado">Encerrado (fim do prazo ou acordo)</option><option value="rescindido">Rescindido</option></select></label>
      <label>Data<input type="date" id="e-d" value="${D.hoje}"></label><label class="span2">Motivo<input id="e-m"></label></div>
    ${futuras.length ? `<label style="flex-direction:row;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="e-del" checked style="width:auto"> Excluir as ${futuras.length} parcela(s) em aberto depois desta data (${money(futuras.reduce((s, p) => s + +p.valor, 0))})</label>` : ''}`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn danger" id="e-ok">Encerrar</button>' });
  $('#e-ok', md.el).onclick = async (ev) => {
    const d = $('#e-d', md.el).value; ev.target.disabled = true;
    try {
      await q(sb.from('contratos').update({ status: $('#e-st', md.el).value, encerrado_em: d, motivo_encerramento: $('#e-m', md.el).value.trim() || null }).eq('id', c.id));
      if ($('#e-del', md.el)?.checked) { const ids = futuras.filter(p => p.data > d).map(p => p.id); if (ids.length) await q(sb.from('lancamentos').delete().in('id', ids)); }
      md.close(); md0.close(); toast('Contrato encerrado'); await carregar(); lista($('#ct-corpo', root), root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ---------------------------------------------------------------- minuta (modelos — SQL 069)
function parteDe(c) {
  if (c.parte_tipo === 'favorecido' && c.favorecido_id) {
    const f = state.cad.favById[c.favorecido_id] || {};
    const end = [[f.logradouro, f.numero].filter(Boolean).join(', '), f.complemento, f.bairro, f.municipio && f.uf ? `${f.municipio}/${f.uf}` : f.municipio, f.cep && `CEP ${f.cep}`].filter(Boolean).join(', ');
    return { nome: c.parte_nome, doc: c.parte_documento || f.documento, endereco: f.logradouro ? end : '' };
  }
  return { nome: c.parte_nome, doc: c.parte_documento, endereco: '' };
}
function preencherDados(c, modelo) {
  const d = structuredClone(c.dados || {});
  const t = c.parte_tipo === 'transportador' ? D.T.find(x => x.id === c.transportador_id) : null;
  if (t) { d.rntrc ||= t.rntrc || ''; const ve = (t.veiculos || [])[0]; if (ve && !d.veiculo?.placa) d.veiculo = { ...(d.veiculo || {}), placa: ve.placa }; }
  if (modelo === 'vistoria') d.vistoria = { momento: 'Entrega', data: M.dataBR(D.hoje), ...(d.vistoria || {}) };
  return d;
}
function minuta(c, box, md, root) {
  const modelo = c.modelo || M.MODELO_PADRAO(c.tipo);
  const d = preencherDados(c, modelo), m = M.MODELOS[modelo];
  const campo = (k) => {
    const def = M.CAMPOS[k]; if (!def) return '';
    if (def.bool) return `<label style="grid-column:1/-1;flex-direction:row;gap:8px;align-items:center"><input type="checkbox" data-k="${k}" ${d[k] ? 'checked' : ''} style="width:auto"> ${def.t}</label>`;
    if (def.sub) return `<fieldset style="grid-column:1/-1;border:1px solid var(--line,#ddd);border-radius:8px;padding:8px 10px;margin:0"><legend class="small">${def.t}</legend><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
      ${def.sub.map(([sk, st]) => `<label>${st}<input data-k="${k}.${sk}" value="${esc(d[k]?.[sk] ?? '')}"></label>`).join('')}</div></fieldset>`;
    return `<label style="${k === 'escopo' || k === 'rota' || k === 'uso' ? 'grid-column:1/-1' : ''}">${def.t}<input data-k="${k}" value="${esc(d[k] ?? '')}" ${def.num ? 'type="number" min="1"' : ''} placeholder="${esc(def.ph || '')}"></label>`;
  };
  box.innerHTML = `<h3 style="margin:16px 0 6px">Minuta para assinatura</h3>
    <div class="grid2"><label>Modelo<select id="m-mod">${Object.entries(M.MODELOS).map(([k, x]) => `<option value="${k}" ${k === modelo ? 'selected' : ''}>${esc(x.titulo)}${x.termo ? ' (termo)' : ''}</option>`).join('')}</select></label>
      <div class="small muted" style="align-self:end">Preenchido com os dados da empresa, da outra parte e deste contrato. Minuta-base: revise com o jurídico antes do primeiro uso.</div>
      ${m.campos.map(campo).join('')}</div>
    <div id="m-falta" class="small warn" style="margin-top:6px"></div>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn" id="m-salvar">Salvar campos</button><button class="btn primary" id="m-gerar">Gerar minuta (PDF)</button></div>`;
  const ler = () => {
    const nd = structuredClone(d);
    $$('[data-k]', box).forEach(i => { const [k, sk] = i.dataset.k.split('.'); const val = i.type === 'checkbox' ? i.checked : i.value.trim();
      if (sk) { nd[k] = { ...(nd[k] || {}), [sk]: val }; } else nd[k] = i.type === 'number' ? (+val || null) : val; });
    return nd;
  };
  const ctx = (dados, logo = null) => M.contexto({ empresa: state.empresa, ident: state.identidade || {}, contrato: { ...c, dados }, parte: parteDe(c), logo });
  const mostrarFaltas = () => { const f = M.faltas($('#m-mod', box).value, ctx(ler())); $('#m-falta', box).textContent = f.length ? `Vai sair com espaço em branco para: ${f.join(', ')}.` : ''; };
  mostrarFaltas(); box.oninput = mostrarFaltas;
  $('#m-mod', box).onchange = async (e) => { try { await q(sb.from('contratos').update({ modelo: e.target.value, dados: ler() }).eq('id', c.id)); c.modelo = e.target.value; c.dados = ler(); minuta(c, box, md, root); } catch (err) { fail(err); } };
  $('#m-salvar', box).onclick = async () => { try { const nd = ler(); await q(sb.from('contratos').update({ modelo: $('#m-mod', box).value, dados: nd }).eq('id', c.id)); c.dados = nd; toast('Campos salvos'); } catch (err) { fail(err); } };
  $('#m-gerar', box).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const nd = ler(), mod = $('#m-mod', box).value;
      await q(sb.from('contratos').update({ modelo: mod, dados: nd }).eq('id', c.id)); c.dados = nd; c.modelo = mod;
      const logo = (await logoPNG(160).catch(() => null))?.data || null;   // logo da identidade da empresa (ou o padrão da plataforma)
      const html = M.documento(mod, ctx(nd, logo), { data: D.hoje });
      document.getElementById('ct-print')?.remove();
      const fr = document.createElement('iframe'); fr.id = 'ct-print'; fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(fr);
      fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
      await new Promise(r => setTimeout(r, 500));
      fr.contentWindow.focus(); fr.contentWindow.print();
    } catch (err) { fail(err); } finally { ev.target.disabled = false; }
  };
}

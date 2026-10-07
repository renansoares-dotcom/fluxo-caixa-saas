// Duplicatas para endosso: títulos à esquerda, duplicata montada em tempo real à direita.
// Gera o PDF (uma duplicata por página: frente + endosso) para assinatura com certificado digital
// e registra em `duplicatas` quais títulos foram endossados, para quem e quando.
import { sb, state, q, fetchAll, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, money, money0, dateBR, fail, toast, modal, formData, logoPNG } from '../lib/ui.js';
import { valorExtenso, dataExtenso } from '../lib/extenso.js';

export const title = 'Duplicatas para endosso';

const ui = { modalidade: '', referencia: '', sel: new Set(), benefId: '', dataEndosso: '', praca: '', busca: '', venDe: '', venAte: '', soSel: false, origem: '', vista: 0 };
let historico = [], titulos = [], benefs = [], emitidas = {}, propostas = [], itensProp = {}, fundos = [];

const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const soDig = (s) => String(s || '').replace(/\D/g, '');
const fmtDoc = (s) => { const d = soDig(s); return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : (s || ''); };
const fmtCep = (s) => { const d = soDig(s); return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : (s || ''); };
const fav = (t) => state.cad.favById[t.favorecido_id] || {};
const enderecoFav = (f) => [f.logradouro, f.numero, f.complemento, f.bairro].filter(Boolean).join(', ');
const cidadeFav = (f) => [f.municipio, f.uf].filter(Boolean).join('/');
const fatura = (doc) => String(doc || '').split(/[-\/]/)[0];
// chave de acesso da NF-e (44 dígitos), gravada na importação do XML em origem = 'nfe:<chave>'
const chaveNFe = (t) => { const m = String(t.origem || '').match(/^nfe:(\d{44})$/); return m ? m[1] : ''; };
const fmtChave = (c) => c ? c.replace(/(\d{4})(?=\d)/g, '$1 ') : '';
// beneficiário ligado a um favorecido (fornecedor): os dados vêm do cadastro de Beneficiários, o que faltar fica do beneficiário
function dadosBenef(b) {
  if (!b) return null;
  const f = b.favorecido_id ? state.cad.favById[b.favorecido_id] : null;
  const g = (k, kf = k) => (f && f[kf]) || b[k] || '';
  return { ...b, razao_social: g('razao_social', 'nome'), cnpj: g('cnpj', 'documento'), logradouro: f && f.logradouro ? [f.logradouro, f.numero, f.complemento, f.bairro].filter(Boolean).join(', ') : b.logradouro,
    municipio: g('municipio'), uf: g('uf'), cep: g('cep'), praca_pagamento: b.praca_pagamento || (f && f.municipio ? [f.municipio, f.uf].filter(Boolean).join('/') : '') };
}
const modalidadeDe = (b) => ui.modalidade || (b?.tipo === 'Fornecedor' ? 'garantia' : 'translativo');
const TIPO_ROT = { FIDC: 'FIDC', Fornecedor: 'Fornecedor', Banco: 'Banco', Outro: 'Outro' };

export async function render(root) {
  if (!ui.dataEndosso) ui.dataEndosso = hojeISO();
  if (state.duplicataSel?.length) { ui.sel = new Set(state.duplicataSel); ui.soSel = true; delete state.duplicataSel; }
  const vindaProp = state.duplicataProp; delete state.duplicataProp;
  root.innerHTML = `<div id="corpo"></div>`;
  $('#corpo', root).innerHTML = '<div class="card"><div class="empty">Carregando…</div></div>';
  try {
    await carregar();
    if (vindaProp) usarProposta(vindaProp);
    desenhar(root);
  } catch (e) { fail(e); }
}

// marca os títulos de uma proposta e sugere o beneficiário ligado ao fundo dela
function usarProposta(id) {
  const p = propostas.find(x => x.id === id); if (!p) return;
  ui.origem = id; ui.vista = 0;
  ui.sel = new Set(titulos.filter(t => itensProp[t.id]?.id === id).map(t => t.id));
  const b = benefs.find(x => x.fundo_id === p.fundo_id && x.ativo); if (b) { ui.benefId = b.id; ui.praca = ''; }
}

async function carregar() {
  await loadCadastros();
  const e = state.empresa.id;
  const receitas = state.cad.plano.filter(p => p.nivel === 2 && p.codigo.startsWith('1.01')).map(p => p.id);
  const cols = 'id,data,emissao,documento,descricao,favorecido_id,valor,status,fidc_proposta_id,origem';
  let abertos, dups, itens;
  [abertos, benefs, dups, propostas, itens, fundos] = await Promise.all([
    receitas.length ? fetchAll(() => sb.from('lancamentos').select(cols).eq('empresa_id', e).eq('status', 'Em aberto').in('plano_id', receitas).order('data')) : [],
    q(sb.from('beneficiarios_endosso').select('*').eq('empresa_id', e).order('nome')),
    fetchAll(() => sb.from('duplicatas').select('id,lancamento_id,beneficiario_id,emitida_em,lote,modalidade,referencia,numero,valor,vencimento,status,cancelada_em,motivo_cancelamento,dados').eq('empresa_id', e).order('emitida_em')),
    q(sb.from('fidc_propostas').select('id,numero,status,fundo_id,data_operacao').eq('empresa_id', e).in('status', ['Rascunho', 'Pendente', 'Aprovada']).order('numero', { ascending: false })),
    q(sb.from('fidc_proposta_itens').select('lancamento_id,proposta_id').eq('empresa_id', e)),
    q(sb.from('fidc_fundos').select('id,nome').eq('empresa_id', e)),
  ]);
  const ativas = new Set(propostas.map(p => p.id));
  itensProp = {};
  for (const i of itens || []) if (i.lancamento_id && ativas.has(i.proposta_id)) itensProp[i.lancamento_id] = propostas.find(p => p.id === i.proposta_id);
  // títulos de propostas aprovadas já estão "Pago" (na conta do fundo): entram também, para endossar
  const faltam = Object.keys(itensProp).filter(id => !abertos.some(t => t.id === id));
  let extras = [];
  for (let i = 0; i < faltam.length; i += 200) extras = extras.concat(await q(sb.from('lancamentos').select(cols).in('id', faltam.slice(i, i + 200))));
  titulos = [...abertos, ...extras].sort((a, b) => a.data.localeCompare(b.data));
  emitidas = {};
  historico = dups || [];
  for (const d of historico) if (d.lancamento_id && d.status !== 'cancelada') (emitidas[d.lancamento_id] ||= []).push(d);
  for (const id of [...ui.sel]) if (!titulos.some(t => t.id === id)) ui.sel.delete(id);
  if (ui.benefId && !benefs.some(b => b.id === ui.benefId)) ui.benefId = '';
}

function desenhar(root) {
  const c = $('#corpo', root);
  const ed = podeEditar();
  const prop = ui.origem ? propostas.find(p => p.id === ui.origem) : null;
  const filt = titulos.filter(t => (!ui.busca || `${fav(t).nome || ''} ${t.documento || ''}`.toUpperCase().includes(ui.busca.toUpperCase()))
    && (!ui.venDe || t.data >= ui.venDe) && (!ui.venAte || t.data <= ui.venAte) && (!ui.soSel || ui.sel.has(t.id))
    && (!prop || itensProp[t.id]?.id === prop.id));
  const nomeFundo = (id) => fundos.find(f => f.id === id)?.nome || '';
  c.innerHTML = `
    <div class="card"><div class="toolbar" id="flt">
      <label>Buscar cliente / NF<input name="busca" value="${esc(ui.busca)}" placeholder="nome ou número"></label>
      <label>Vencimento de<input type="date" name="venDe" value="${ui.venDe}"></label>
      <label>até<input type="date" name="venAte" value="${ui.venAte}"></label>
      <label>Proposta de borderô<select name="origem"><option value="">Todos os títulos</option>${propostas.map(p => `<option value="${p.id}" ${ui.origem === p.id ? 'selected' : ''}>nº ${p.numero} · ${esc(nomeFundo(p.fundo_id))} · ${p.status.toLowerCase()}</option>`).join('')}</select></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="soSel" ${ui.soSel ? 'checked' : ''}> Só os marcados</label>
      <span class="spacer"></span><button class="btn" id="hist" type="button">Endossos emitidos${historico.filter(d => d.status !== 'cancelada').length ? ` (${new Set(historico.filter(d => d.status !== 'cancelada').map(d => d.lote)).size} lote(s))` : ''}</button>
    </div></div>
    <div class="grid2 prop-grid">
      <div class="card flush"><div class="card-head"><div><h2>Títulos</h2><p class="muted small">Duplicatas a receber em aberto e títulos de propostas de borderô. Marque os que vão ser endossados.</p></div>
        ${ed ? `<div class="toolbar"><button class="btn small" id="sel-todos">Marcar filtrados</button><button class="btn small" id="sel-nenhum">Limpar</button></div>` : ''}</div>
        <div class="table-wrap" style="max-height:620px">${filt.length ? `<table id="tt"><thead><tr><th></th><th>Vencimento</th><th>Cliente (sacado)</th><th>NF / parcela</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
          ${filt.map(t => { const em = emitidas[t.id]; const ult = em?.[em.length - 1]; const p = itensProp[t.id]; const f = fav(t);
            return `<tr class="clickable" data-id="${t.id}"><td><input type="checkbox" ${ui.sel.has(t.id) ? 'checked' : ''} ${ed ? '' : 'disabled'} aria-label="Selecionar"></td>
            <td>${dateBR(t.data)}</td><td class="wrap">${esc(f.nome || t.descricao || '')}${!f.logradouro ? '<div class="small neg">sem endereço no cadastro</div>' : ''}</td><td>${esc(t.documento || '—')}</td><td class="num">${money(t.valor)}</td>
            <td class="small">${p ? `<span class="badge ${p.status === 'Aprovada' ? 'pago' : 'aberto'}">proposta nº ${p.numero} · ${esc(nomeFundo(p.fundo_id))}</span>` : ''}
              ${ult ? `<div>endossada${ult.modalidade === 'garantia' ? ' em garantia' : ''} ${esc(benefs.find(b => b.id === ult.beneficiario_id)?.nome || '')} em ${dateBR((ult.emitida_em || new Date().toISOString()).slice(0, 10))}${em.length > 1 ? ` (${em.length}×)` : ''}</div>` : ''}</td></tr>`; }).join('')}
          </tbody></table>` : `<div class="empty">${titulos.length ? 'Nenhum título no filtro.' : 'Nenhum título em aberto.'}</div>`}</div></div>
      <div id="painel"></div>
    </div>`;
  $('#hist', c).onclick = () => endossos(root);
  const fl = $('#flt', c);
  fl.addEventListener('change', (e) => {
    ui[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.name === 'origem' && ui.origem) usarProposta(ui.origem); // escolheu uma proposta
    ui.vista = 0; desenhar(root);
  });
  if (ed) {
    $('#tt', c)?.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = tr.dataset.id; ui.sel.has(id) ? ui.sel.delete(id) : ui.sel.add(id);
      const cb = $('input[type=checkbox]', tr); if (cb) cb.checked = ui.sel.has(id);
      // ao marcar um título de proposta, sugere o beneficiário do fundo dela
      const p = itensProp[id]; if (ui.sel.has(id) && p && !ui.benefId) { const b = benefs.find(x => x.fundo_id === p.fundo_id && x.ativo); if (b) ui.benefId = b.id; }
      ui.vista = Math.max(0, [...titulos.filter(t => ui.sel.has(t.id))].findIndex(t => t.id === id));
      painel($('#painel', c), root);
    });
    $('#sel-todos', c).onclick = () => { filt.forEach(t => ui.sel.add(t.id)); desenhar(root); };
    $('#sel-nenhum', c).onclick = () => { ui.sel.clear(); ui.vista = 0; desenhar(root); };
  }
  painel($('#painel', c), root);
}

// ======================================================================
// Painel: beneficiário, verificações e a duplicata em tempo real
// ======================================================================
function dadosDuplicata(t, b0) {
  const e = state.empresa, f = fav(t); const b = dadosBenef(b0);
  return {
    numero: t.documento || t.id.slice(0, 8), fatura: fatura(t.documento) || '', emissao: t.emissao || ui.dataEndosso, vencimento: t.data, valor: +t.valor,
    emitente: { nome: e.razao_social || e.nome, cnpj: fmtDoc(e.cnpj), ie: e.ie || '', logradouro: e.logradouro || '', cidade: [e.municipio, e.uf].filter(Boolean).join('/'), cep: fmtCep(e.cep),
      responsavel: e.responsavel_nome || '', responsavel_cpf: e.responsavel_cpf || '', avalista: e.avalista_nome || '', avalista_cpf: e.avalista_cpf || '' },
    sacado: { id: f.id, nome: f.nome || t.descricao || '', cnpj: fmtDoc(f.documento), ie: f.ie || '', endereco: enderecoFav(f), cidade: cidadeFav(f), cep: fmtCep(f.cep), chave: fmtChave(chaveNFe(t)) },
    beneficiario: b ? { id: b.id, nome: b.razao_social || b.nome, curto: b.nome, cnpj: fmtDoc(b.cnpj), endereco: b.logradouro || '', cidade: [b.municipio, b.uf].filter(Boolean).join('/') } : null,
    praca: ui.praca || b?.praca_pagamento || [state.empresa.municipio, state.empresa.uf].filter(Boolean).join('/'),
    local: [state.empresa.municipio, state.empresa.uf].filter(Boolean).join('/'), dataEndosso: ui.dataEndosso,
    modalidade: modalidadeDe(b0), referencia: (ui.referencia || '').trim(), tipoBenef: b0?.tipo || 'FIDC',
  };
}

// Texto do endosso. Translativo: transfere o título. Em garantia (endosso-caução, art. 19 da LUG / art. 918 do CC):
// o título fica com o beneficiário como garantia, com a cláusula "valor em garantia".
function textoEndosso(d) {
  const b = d.beneficiario; if (!b) return '';
  const quem = `${b.nome}${b.cnpj ? `, CNPJ/MF nº ${b.cnpj}` : ''}${b.endereco ? `, ${b.endereco}` : ''}${b.cidade ? `, ${b.cidade}` : ''}`;
  const valor = `R$ ${money(d.valor)} (${valorExtenso(d.valor)})`;
  if (d.modalidade === 'garantia')
    return `Pague-se a ${quem}, ou à sua ordem, VALOR EM GARANTIA${d.referencia ? ` do pagamento de ${d.referencia}` : ' das obrigações do endossante perante o endossatário'}, a importância de ${valor}, referente à duplicata nº ${d.numero}.`;
  return `Pague-se a ${quem}, ou à sua ordem, a importância de ${valor}, referente à duplicata nº ${d.numero}.`;
}

function htmlDuplicata(d) {
  const L = (rot, val, cls = '') => `<div class="dp-campo ${cls}"><span>${rot}</span><strong>${esc(val || '—')}</strong></div>`;
  return `<div class="dp">
    <div class="dp-frente">
      <div class="dp-tira"><div>Responsável legal: ${esc(d.emitente.responsavel || '—')}<br>${esc(d.emitente.responsavel_cpf)}</div><div>Avalista: ${esc(d.emitente.avalista || '—')}<br>${esc(d.emitente.avalista_cpf)}</div></div>
      <div class="dp-corpo">
        <div class="dp-topo"><div class="dp-tit">DUPLICATA MERCANTIL</div><div>Vencimento: <strong>${dateBR(d.vencimento)}</strong></div></div>
        <div class="dp-linha">${L('Nº da duplicata', d.numero, 'box')}${L('Fatura / NF', d.fatura)}${L('Emissão', dateBR(d.emissao))}${L('R$', money(d.valor), 'box valor')}</div>
        <p class="dp-texto">${esc(dataExtenso(d.vencimento, { modelo: 'nota' }))} pagarei(emos) por esta única via de <strong>DUPLICATA</strong> a <strong>${esc(d.emitente.nome)}</strong> — CNPJ/MF nº ${esc(d.emitente.cnpj)}, ou à sua ordem, a quantia de</p>
        <div class="dp-extenso">${esc(valorExtenso(d.valor))} *****</div>
        <div class="dp-linha">${L('Pagável em', d.praca)}${L('Emitida em', `${d.local}, ${dateBR(d.emissao)}`)}</div>
        <div class="dp-sacado"><span>SACADO</span><strong>${esc(d.sacado.nome)}</strong>
          <div>CNPJ/CPF ${esc(d.sacado.cnpj || '—')}${d.sacado.ie ? ` · IE ${esc(d.sacado.ie)}` : ''}</div>
          <div>${esc(d.sacado.endereco || 'endereço não cadastrado')}${d.sacado.cidade ? ` — ${esc(d.sacado.cidade)}` : ''}${d.sacado.cep ? ` · CEP ${esc(d.sacado.cep)}` : ''}</div>
          <div>Chave da NF-e: ${d.sacado.chave ? esc(d.sacado.chave) : '<span class="neg">não informada (NF sem XML importado)</span>'}</div></div>
        <div class="dp-rodape">
          <div class="dp-emit"><strong>${esc(d.emitente.nome)}</strong><div>CNPJ/MF ${esc(d.emitente.cnpj)}${d.emitente.ie ? ` · IE ${esc(d.emitente.ie)}` : ''}</div><div>${esc(d.emitente.logradouro)}</div><div>${esc(d.emitente.cidade)}</div></div>
          <div class="dp-ass"><div class="dp-lin"></div>${esc(d.emitente.nome)}<br><span class="muted">emitente</span></div>
        </div>
      </div>
    </div>
    <div class="dp-verso"><div class="dp-tit">${d.modalidade === 'garantia' ? 'ENDOSSO EM GARANTIA (endosso-caução)' : 'ENDOSSO'}</div>
      ${d.beneficiario ? `<p>${esc(textoEndosso(d))}</p>
      <p>${esc(d.local)}, ${esc(dataExtenso(d.dataEndosso))}.</p>
      <div class="dp-ass" style="max-width:320px"><div class="dp-lin"></div>${esc(d.emitente.nome)} — endossante<br><span class="muted">assinatura digital (certificado ICP-Brasil)</span></div>` : '<p class="neg">Escolha o beneficiário do endosso.</p>'}
    </div></div>`;
}

function verificacoes(d, tits, b) {
  const out = [];
  if (!b) out.push(['atencao', 'Beneficiário', 'Escolha para quem as duplicatas serão endossadas.']);
  else {
    const bd = dadosBenef(b);
    const falta = [['razao_social', 'razão social'], ['cnpj', 'CNPJ'], ['logradouro', 'endereço'], ['municipio', 'município']].filter(([k]) => !bd[k]).map(([, n]) => n);
    out.push([falta.length ? 'atencao' : 'ok', `Beneficiário — ${b.nome} (${TIPO_ROT[b.tipo] || 'FIDC'})`, falta.length ? `Falta no cadastro${b.favorecido_id ? ' do fornecedor (Beneficiários)' : ''}: ${falta.join(', ')}. Clique em “Gerenciar beneficiários” para completar.` : `${bd.razao_social} · CNPJ ${fmtDoc(bd.cnpj)} · ${[bd.municipio, bd.uf].filter(Boolean).join('/')}`]);
    if (d.modalidade === 'garantia' && !d.referencia) out.push(['info', 'Endosso em garantia', 'Informe o que está sendo garantido (ex.: pedido ou NF de compra de resina) para constar no endosso.']);
  }
  const e = state.empresa;
  const faltaE = [['razao_social', 'razão social'], ['cnpj', 'CNPJ'], ['logradouro', 'endereço'], ['municipio', 'município']].filter(([k]) => !e[k]).map(([, n]) => n);
  if (faltaE.length) out.push(['atencao', 'Emitente', `Falta em Empresa e usuários: ${faltaE.join(', ')}.`]);
  const semEnd = tits.filter(t => !fav(t).logradouro); const semDoc = tits.filter(t => !soDig(fav(t).documento));
  if (semEnd.length || semDoc.length) out.push(['atencao', 'Sacados', `${semEnd.length ? `${semEnd.length} título(s) de cliente sem endereço` : ''}${semEnd.length && semDoc.length ? ' · ' : ''}${semDoc.length ? `${semDoc.length} sem CNPJ` : ''}. Importe de novo o XML da NF (completa o cadastro) ou edite em Beneficiários.`]);
  else out.push(['ok', 'Sacados', 'Todos com CNPJ e endereço.']);
  const ja = tits.filter(t => emitidas[t.id]?.length);
  if (ja.length) out.push(['atencao', 'Já endossadas', `${ja.length} título(s) já tiveram duplicata gerada antes; gerar de novo cria outro registro.`]);
  const pago = tits.filter(t => t.status === 'Pago' && !itensProp[t.id]);
  if (pago.length) out.push(['info', 'Títulos pagos', `${pago.length} título(s) já constam como pagos.`]);
  if (b?.fundo_id) { const outros = tits.filter(t => itensProp[t.id] && itensProp[t.id].fundo_id !== b.fundo_id); if (outros.length) out.push(['atencao', 'Fundo diferente da proposta', `${outros.length} título(s) estão em proposta de outro fundo.`]); }
  return out;
}

function painel(el, root) {
  const tits = titulos.filter(t => ui.sel.has(t.id));
  const ativos = benefs.filter(b => b.ativo);
  const b = benefs.find(x => x.id === ui.benefId) || null;
  const total = tits.reduce((s, t) => s + +t.valor, 0);
  if (ui.vista >= tits.length) ui.vista = Math.max(0, tits.length - 1);
  const ROT = { atencao: ['⚠', 'Atenção'], info: ['ℹ', 'Info'], ok: ['✓', 'OK'] };
  const escolha = `<div class="fundo-pick" id="bpick" role="radiogroup" aria-label="Beneficiário do endosso">
    ${ativos.map(x => `<button type="button" class="fundo-op${b && x.id === b.id ? ' on' : ''}" data-b="${x.id}" role="radio" aria-checked="${b && x.id === b.id}">
      <span class="fo-nome">${esc(x.nome)} <span class="badge ${x.tipo === 'Fornecedor' ? 'aberto' : 'negoc'}">${TIPO_ROT[x.tipo] || 'FIDC'}</span></span><span class="small muted">${dadosBenef(x).cnpj ? esc(fmtDoc(dadosBenef(x).cnpj)) : '<span class="neg">sem CNPJ</span>'}</span></button>`).join('')}
    ${podeEditar() ? '<button type="button" class="fundo-op" id="add-forn"><span class="fo-nome">+ Fornecedor</span><span class="small muted">escolher do cadastro de favorecidos</span></button><button type="button" class="fundo-op" id="ger-b"><span class="fo-nome">Gerenciar beneficiários</span><span class="small muted">incluir ou completar dados</span></button>' : ''}</div>`;
  if (!tits.length) {
    el.innerHTML = `<div class="card"><h2>Duplicatas</h2><h3 style="margin:8px 0">Beneficiário do endosso</h3>${escolha}<div class="empty" style="margin-top:12px">Marque os títulos ao lado para montar as duplicatas.</div></div>`;
  } else {
    const d = dadosDuplicata(tits[ui.vista], b);
    const chk = verificacoes(d, tits, b);
    el.innerHTML = `<div class="card">
      <div class="card-head"><h2>Duplicatas para endosso</h2><span class="muted small">${tits.length} título(s) · ${money0(total)}</span></div>
      <h3 style="margin:4px 0 8px">Beneficiário do endosso</h3>${escolha}
      <form id="df" class="toolbar" style="margin-top:12px">
        <label>Data do endosso<input type="date" name="dataEndosso" value="${ui.dataEndosso}"></label>
        <label class="grow">Praça de pagamento<input name="praca" value="${esc(ui.praca || dadosBenef(b)?.praca_pagamento || '')}" placeholder="${esc([state.empresa.municipio, state.empresa.uf].filter(Boolean).join('/'))}"></label>
        <label>Modalidade do endosso<select name="modalidade"><option value="translativo" ${modalidadeDe(b) === 'translativo' ? 'selected' : ''}>Translativo (transfere o título)</option><option value="garantia" ${modalidadeDe(b) === 'garantia' ? 'selected' : ''}>Em garantia (endosso-caução)</option></select></label>
        ${modalidadeDe(b) === 'garantia' ? `<label class="grow">Garantia do pagamento de<input name="referencia" value="${esc(ui.referencia)}" placeholder="ex.: pedido 1234 / NF 5678 de resina PEAD"></label>` : ''}
      </form>
      <div class="alert-list" style="margin-top:12px">${chk.map(([st, t, x]) => `<div class="alert-row ${st}"><span class="alert-tag">${ROT[st][0]} ${ROT[st][1]}</span><div><strong>${esc(t)}</strong><div class="small muted">${esc(x)}</div></div></div>`).join('')}</div>
      <div class="toolbar" style="margin:14px 0 8px"><h3 style="margin:0">Pré-visualização</h3><span class="spacer"></span>
        <button class="btn small" id="ant" ${ui.vista ? '' : 'disabled'}>‹</button><span class="small">${ui.vista + 1} de ${tits.length}</span><button class="btn small" id="prox" ${ui.vista < tits.length - 1 ? '' : 'disabled'}>›</button></div>
      ${htmlDuplicata(d)}
      <div class="toolbar" style="margin-top:14px;justify-content:flex-end">
        <span class="muted small">PDF com ${tits.length} duplicata(s), uma por página (frente + endosso), para assinar com o certificado digital.</span>
        <button class="btn primary" id="gerar" ${b && podeEditar() ? '' : 'disabled'}>Gerar PDF${b ? ` — endosso${modalidadeDe(b) === 'garantia' ? ' em garantia' : ''} ${esc(b.nome)}` : ''}</button></div>
    </div>`;
    $('#ant', el).onclick = () => { ui.vista--; painel(el, root); };
    $('#prox', el).onclick = () => { ui.vista++; painel(el, root); };
    $('#df', el).addEventListener('change', (e) => { ui[e.target.name] = e.target.value; painel(el, root); });
    $('#gerar', el).onclick = () => gerar(tits, b, root);
  }
  $('#bpick', el).onclick = (e) => {
    if (e.target.closest('#ger-b')) return gerenciar(root);
    if (e.target.closest('#add-forn')) return addFornecedor(root);
    const x = e.target.closest('[data-b]'); if (!x) return; ui.benefId = x.dataset.b; ui.praca = ''; ui.modalidade = ''; painel(el, root);
  };
}

// ======================================================================
// Endossos emitidos: histórico por lote e cancelamento (recusa do beneficiário ou desistência)
// ======================================================================
function endossos(root) {
  const lotes = {};
  for (const d of historico) (lotes[d.lote || d.emitida_em.slice(0, 16)] ||= []).push(d);
  const ks = Object.keys(lotes).sort((a, b) => lotes[b][0].emitida_em.localeCompare(lotes[a][0].emitida_em));
  const ed = podeEditar();
  const m = modal({
    title: 'Endossos emitidos', wide: true,
    body: ks.length ? `<p class="small muted" style="margin-top:0">Cancelar um endosso libera os títulos para um novo endosso e fica registrado com o motivo. Se o PDF já foi assinado e entregue, gere o termo de cancelamento para o beneficiário assinar e devolver as duplicatas.</p>
      <div class="table-wrap" style="max-height:480px"><table><thead><tr><th>Emitido em</th><th>Beneficiário</th><th>Modalidade</th><th class="num">Duplicatas</th><th class="num">Total</th><th>Situação</th><th></th></tr></thead><tbody>
      ${ks.map(k => { const ds = lotes[k]; const at = ds.filter(d => d.status !== 'cancelada'); const b = benefs.find(x => x.id === ds[0].beneficiario_id);
        return `<tr data-lote="${esc(k)}"><td>${dateBR(ds[0].emitida_em.slice(0, 10))}</td><td>${esc(b?.nome || ds[0].dados?.beneficiario?.curto || '—')}</td><td>${ds[0].modalidade === 'garantia' ? 'em garantia' : 'translativo'}${ds[0].referencia ? `<div class="small muted">${esc(ds[0].referencia)}</div>` : ''}</td>
          <td class="num">${ds.length}</td><td class="num">${money(ds.reduce((s, d) => s + +d.valor, 0))}</td>
          <td>${at.length === ds.length ? '<span class="badge pago">ativo</span>' : at.length ? `<span class="badge aberto">${ds.length - at.length} cancelada(s)</span>` : `<span class="badge vencido">cancelado</span><div class="small muted">${esc(ds[0].motivo_cancelamento || '')}</div>`}</td>
          <td style="white-space:nowrap">${ed && at.length ? '<button class="btn small" data-a="ver">Duplicatas</button> <button class="btn small danger" data-a="cancelar">Cancelar lote</button>' : '<button class="btn small" data-a="ver">Duplicatas</button>'} ${ds.length > at.length ? '<button class="btn small" data-a="termo">Termo de cancelamento</button>' : ''}</td></tr>
          <tr class="sub" data-det="${esc(k)}" hidden><td colspan="7"><table><tbody>${ds.map(d => `<tr><td>${esc(d.numero)}</td><td>venc. ${dateBR(d.vencimento)}</td><td class="num">${money(d.valor)}</td>
            <td>${d.status === 'cancelada' ? `<span class="badge vencido">cancelada em ${dateBR((d.cancelada_em || '').slice(0, 10))}</span>` : '<span class="badge pago">ativa</span>'}</td>
            <td>${ed && d.status !== 'cancelada' ? `<button class="btn small danger" data-cancelar="${d.id}">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table></td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">Nenhum endosso emitido ainda.</div>',
    foot: '<button class="btn" data-close>Fechar</button>',
  });
  const cancelar = async (ids, rotulo) => {
    const mot = prompt(`Cancelar ${rotulo}?\nOs títulos ficam livres para novo endosso; o registro continua no histórico.\n\nMotivo (ex.: recusado pelo beneficiário, desistência da IPLAMM):`, '');
    if (mot === null) return; if (!mot.trim()) return toast('Informe o motivo', true);
    try {
      await q(sb.from('duplicatas').update({ status: 'cancelada', cancelada_em: new Date().toISOString(), motivo_cancelamento: mot.trim() }).in('id', ids));
      toast(`${ids.length} endosso(s) cancelado(s)`); m.close(); await carregar(); desenhar(root); endossos(root);
    } catch (e) { fail(e); }
  };
  m.el.querySelector('tbody')?.addEventListener('click', (e) => {
    const bc = e.target.closest('[data-cancelar]'); if (bc) return cancelar([bc.dataset.cancelar], 'este endosso');
    const bt = e.target.closest('[data-a]'); if (!bt) return;
    const k = bt.closest('tr[data-lote]').dataset.lote; const ds = lotes[k];
    if (bt.dataset.a === 'ver') { const det = m.el.querySelector(`tr[data-det="${CSS.escape(k)}"]`); det.hidden = !det.hidden; }
    if (bt.dataset.a === 'cancelar') cancelar(ds.filter(d => d.status !== 'cancelada').map(d => d.id), `o lote inteiro (${ds.filter(d => d.status !== 'cancelada').length} duplicata(s))`);
    if (bt.dataset.a === 'termo') termoCancelamento(ds.filter(d => d.status === 'cancelada'), benefs.find(x => x.id === ds[0].beneficiario_id));
  });
}

// Termo de cancelamento de endosso / devolução das duplicatas, para o beneficiário assinar
async function termoCancelamento(ds, b0) {
  if (!ds.length) return;
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const e = state.empresa; const bd = dadosBenef(b0) || {}; const bs = ds[0].dados?.beneficiario || {};
  const B = { nome: bd.razao_social || bs.nome || b0?.nome || '', cnpj: fmtDoc(bd.cnpj || bs.cnpj || ''), end: bd.logradouro || bs.endereco || '', cid: [bd.municipio, bd.uf].filter(Boolean).join('/') || bs.cidade || '' };
  const E = { nome: e.razao_social || e.nome, cnpj: fmtDoc(e.cnpj), end: e.logradouro || '', cid: [e.municipio, e.uf].filter(Boolean).join('/') };
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 18, CW = W - 2 * M;
  const azul = [43, 85, 152], marinho = [42, 31, 111], cinza = [102, 112, 133];
  const garantia = ds[0].modalidade === 'garantia';
  const total = ds.reduce((s, d) => s + +d.valor, 0);
  const idDoc = `TC-${(ds[0].lote || '').replace(/\D+/g, '').slice(0, 12) || hojeISO().replace(/-/g, '')}`;
  // cabeçalho
  const logo = await logoPNG().catch(() => null);
  if (logo) doc.addImage(logo.data, 'PNG', M, 12, 11 * logo.ratio, 11);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...cinza);
  doc.text(pdfTxt(E.nome), W - M, 14.5, { align: 'right' }); doc.text(`CNPJ ${E.cnpj}`, W - M, 18.5, { align: 'right' }); doc.text(pdfTxt(E.cid), W - M, 22.5, { align: 'right' });
  doc.setDrawColor(...marinho); doc.setLineWidth(0.6); doc.line(M, 27, W - M, 27);
  doc.setTextColor(...marinho); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('TERMO DE CANCELAMENTO DE ENDOSSO', W / 2, 38, { align: 'center' });
  doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); doc.text('e devolução de duplicatas mercantis', W / 2, 44, { align: 'center' });
  doc.setFontSize(8); doc.setTextColor(...cinza); doc.text(`Documento ${idDoc}`, W / 2, 49.5, { align: 'center' });
  // partes
  let y = 56;
  const parte = (x, rot, P) => {
    doc.setFillColor(240, 243, 248); doc.setDrawColor(226, 231, 239); doc.setLineWidth(0.2); doc.roundedRect(x, y, CW / 2 - 3, 31, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...azul); doc.text(rot, x + 4, y + 5.5);
    doc.setFontSize(9.5); doc.setTextColor(20); doc.text(doc.splitTextToSize(pdfTxt(P.nome), CW / 2 - 11).slice(0, 2), x + 4, y + 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60);
    doc.text(`CNPJ/MF: ${P.cnpj || 'não informado'}`, x + 4, y + 19.5);
    doc.setFontSize(8); doc.text(doc.splitTextToSize(pdfTxt([P.end, P.cid].filter(Boolean).join(' - ') || 'endereço não informado'), CW / 2 - 11).slice(0, 2), x + 4, y + 24);
  };
  parte(M, 'ENDOSSANTE', E); parte(M + CW / 2 + 3, 'ENDOSSATÁRIO', B);
  y += 40;
  // cláusulas
  const clausula = (n, titulo, texto) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...marinho); doc.text(`${n}. ${titulo}`, M, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30);
    const l = doc.splitTextToSize(pdfTxt(texto), CW); doc.text(l, M, y, { lineHeightFactor: 1.35 }); y += l.length * 4.6 + 4;
  };
  clausula(1, 'Objeto', `As partes acima qualificadas declaram cancelado, para todos os fins de direito, o endosso${garantia ? ' em garantia (endosso-caução)' : ''} realizado em ${dateBR(ds[0].emitida_em.slice(0, 10))}${ds[0].referencia ? `, em garantia do pagamento de ${ds[0].referencia}` : ''}, das duplicatas relacionadas no quadro abaixo, no valor total de R$ ${money(total)} (${valorExtenso(total)}).`);
  clausula(2, 'Devolução', 'O endossatário devolve as duplicatas ao endossante, que as recebe livres de qualquer ônus, comprometendo-se o endossatário a não cobrá-las, negociá-las, transferi-las ou levá-las a protesto, e a inutilizar eventuais vias em seu poder.');
  if (ds[0].motivo_cancelamento) clausula(3, 'Motivo', ds[0].motivo_cancelamento.charAt(0).toUpperCase() + ds[0].motivo_cancelamento.slice(1) + '.');
  // quadro das duplicatas
  doc.autoTable({ startY: y, theme: 'plain', margin: { left: M, right: M },
    head: [['Duplicata', 'Sacado', 'CNPJ do sacado', 'Vencimento', 'Valor (R$)']],
    body: ds.map(d => [d.numero, pdfTxt(d.dados?.sacado?.nome || ''), d.dados?.sacado?.cnpj || '', dateBR(d.vencimento), money(d.valor)]),
    foot: [[{ content: `${ds.length} duplicata(s)`, colSpan: 3 }, 'Total', money(total)]],
    styles: { fontSize: 8.5, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, textColor: 30, lineColor: [226, 231, 239], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: azul, textColor: 255, fontStyle: 'bold' }, footStyles: { fillColor: [232, 238, 248], textColor: 20, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 36 }, 3: { cellWidth: 24, halign: 'center' }, 4: { cellWidth: 28, halign: 'right' } },
    didParseCell: (h) => { if ((h.section === 'head' || h.section === 'foot') && h.column.index === 4) h.cell.styles.halign = 'right'; if (h.section === 'head' && h.column.index === 3) h.cell.styles.halign = 'center'; } });
  y = doc.lastAutoTable.finalY + 10;
  // local e data + assinaturas
  if (y > H - 70) { doc.addPage(); y = 30; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(30);
  doc.text(pdfTxt(`${E.cid}, ${dataExtenso(hojeISO())}.`), M, y);
  y += 26;
  const ass = (x, P, papel) => {
    doc.setDrawColor(60); doc.setLineWidth(0.3); doc.line(x, y, x + 78, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(20); doc.text(doc.splitTextToSize(pdfTxt(P.nome), 78)[0], x + 39, y + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...cinza); doc.text(`${papel}${P.cnpj ? ` · CNPJ ${P.cnpj}` : ''}`, x + 39, y + 8.5, { align: 'center' });
  };
  ass(M, B, 'ENDOSSATÁRIO'); ass(W - M - 78, E, 'ENDOSSANTE');
  // rodapé
  doc.setDrawColor(226, 231, 239); doc.setLineWidth(0.2); doc.line(M, H - 16, W - M, H - 16);
  doc.setFontSize(7); doc.setTextColor(...cinza);
  doc.text('Documento para assinatura digital com certificado ICP-Brasil (MP 2.200-2/2001).', M, H - 11.5);
  doc.text(`${idDoc} · página 1 de ${doc.getNumberOfPages()}`, W - M, H - 11.5, { align: 'right' });
  doc.setProperties({ title: 'Termo de cancelamento de endosso', subject: idDoc, author: E.nome });
  doc.save(`termo_cancelamento_endosso_${(b0?.nome || 'beneficiario').replace(/\W+/g, '_')}_${hojeISO()}.pdf`);
}

// ======================================================================
// Cadastro dos beneficiários
// ======================================================================
const fornecedores = () => state.cad.favorecidos.filter(f => f.ativo !== false && (f.tipo === 'FORNECEDORES' || f.sigla === 'FOR')).sort((a, b) => a.nome.localeCompare(b.nome));
const nomeCurto = (n) => { const w = n.split(/\s+/).filter(x => !/^(D[AEO]S?|E|LTDA|S\/?A|ME|EPP|EIRELI|-)$/i.test(x)); return w.slice(0, 2).join(' ') || n; };
const deFavorecido = (fv) => ({ nome: nomeCurto(fv.nome), razao_social: fv.nome, cnpj: fmtDoc(fv.documento) || '',
  logradouro: [fv.logradouro, fv.numero, fv.complemento, fv.bairro].filter(Boolean).join(', '), municipio: fv.municipio || '', uf: fv.uf || '', cep: fv.cep || '',
  praca_pagamento: fv.municipio ? [fv.municipio, fv.uf].filter(Boolean).join('/') : '' });

// Atalho: escolhe um fornecedor de Favorecidos e já usa como beneficiário (completa no cadastro o que faltar)
function addFornecedor(root) {
  const lista = fornecedores();
  const m = modal({
    title: 'Endossar para um fornecedor', wide: true,
    body: `<p class="small muted" style="margin-top:0">Escolha o fornecedor (ex.: de resina). Os dados vêm do cadastro de Beneficiários; complete o que faltar e eles ficam salvos no cadastro do fornecedor.</p>
      <form id="ff" class="grid-form">
        <label class="span2">Fornecedor *<input name="fav" list="dl-forn2" required placeholder="digite para buscar"><datalist id="dl-forn2">${lista.map(f => `<option value="${esc(f.nome)}">`).join('')}</datalist></label>
        <label>CNPJ<input name="documento"></label><label>Inscrição estadual<input name="ie"></label>
        <label class="span2">Endereço (rua)<input name="logradouro"></label><label>Número<input name="numero"></label><label>Bairro<input name="bairro"></label>
        <label>Município<input name="municipio"></label><label>UF<input name="uf" maxlength="2"></label><label>CEP<input name="cep"></label>
      </form>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ff-ok">Usar como beneficiário</button>',
  });
  const f = $('#ff', m.el); const F = (n) => f.querySelector(`[name=${n}]`);
  const ks = ['documento', 'ie', 'logradouro', 'numero', 'bairro', 'municipio', 'uf', 'cep'];
  F('fav').onchange = () => { const fv = lista.find(x => x.nome === F('fav').value.trim()); if (!fv) return; for (const k of ks) F(k).value = k === 'documento' ? fmtDoc(fv[k]) : (fv[k] || ''); };
  $('#ff-ok', m.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const fv = lista.find(x => x.nome === F('fav').value.trim()); if (!fv) return toast('Escolha um fornecedor da lista', true);
    try {
      const patch = {}; for (const k of ks) { const v = F(k).value.trim(); if (v && v !== (k === 'documento' ? fmtDoc(fv[k]) : (fv[k] || ''))) patch[k] = k === 'uf' ? v.toUpperCase() : (k === 'documento' ? soDig(v) : v); }
      if (Object.keys(patch).length) { await q(sb.from('favorecidos').update(patch).eq('id', fv.id)); await loadCadastros(true); }
      let b = benefs.find(x => x.favorecido_id === fv.id);
      if (!b) b = await q(sb.from('beneficiarios_endosso').insert({ empresa_id: state.empresa.id, tipo: 'Fornecedor', favorecido_id: fv.id, nome: deFavorecido(fv).nome, razao_social: fv.nome, ativo: true }).select().single());
      else if (!b.ativo) await q(sb.from('beneficiarios_endosso').update({ ativo: true }).eq('id', b.id));
      ui.benefId = b.id; ui.modalidade = ''; ui.praca = '';
      toast(`${fv.nome} pronto como beneficiário`); m.close(); await carregar(); desenhar(root);
    } catch (e) { fail(e); }
  };
}
function gerenciar(root) {
  const campos = [['nome', 'Nome curto *'], ['razao_social', 'Razão social', 1], ['cnpj', 'CNPJ'], ['praca_pagamento', 'Praça de pagamento (ex.: SAO PAULO/SP)'],
    ['logradouro', 'Endereço', 1], ['municipio', 'Município'], ['uf', 'UF'], ['cep', 'CEP']];
  const m = modal({
    title: 'Beneficiários do endosso', wide: true,
    body: `<p class="small muted" style="margin-top:0">Fundos, fornecedores, bancos ou factorings que recebem as duplicatas por endosso. Beneficiário ligado a um fornecedor usa os dados do cadastro de Beneficiários (CNPJ, endereço); o que faltar lá pode ser preenchido aqui.</p>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Razão social</th><th>CNPJ</th><th>Cidade</th><th>Praça</th><th>Vínculo</th><th></th></tr></thead><tbody>
      ${benefs.map(b0 => { const b = dadosBenef(b0); return `<tr class="clickable" data-id="${b.id}"><td><strong>${esc(b.nome)}</strong></td><td>${TIPO_ROT[b.tipo] || 'FIDC'}</td><td class="wrap small">${esc(b.razao_social || '—')}</td><td>${esc(fmtDoc(b.cnpj) || '—')}</td><td>${esc([b.municipio, b.uf].filter(Boolean).join('/'))}</td><td>${esc(b.praca_pagamento || '')}</td><td class="small">${esc(fundos.find(f => f.id === b.fundo_id)?.nome || (b.favorecido_id ? 'Beneficiários' : ''))}</td><td>${b.ativo ? '' : '<span class="badge vencido">inativo</span>'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <form id="bf" class="grid-form" style="margin-top:14px"><input type="hidden" name="id">
        ${campos.map(([k, t, sp]) => `<label class="${sp ? 'span2' : ''}">${t}<input name="${k}" ${k === 'nome' ? 'required' : ''}></label>`).join('')}
        <label>Tipo<select name="tipo">${Object.keys(TIPO_ROT).map(k => `<option value="${k}">${k}</option>`).join('')}</select></label>
        <label class="span2">Fornecedor do cadastro (puxa CNPJ e endereço)<input name="fav" list="dl-forn" placeholder="digite para buscar em Beneficiários"><datalist id="dl-forn">${fornecedores().map(f => `<option value="${esc(f.nome)}">`).join('')}</datalist></label>
        <label>Fundo vinculado<select name="fundo_id"><option value="">—</option>${fundos.map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select></label>
        <label>Ativo<select name="ativo"><option value="1">sim</option><option value="0">não</option></select></label>
      </form>`,
    foot: '<button class="btn" id="b-novo" style="margin-right:auto">Novo</button><button class="btn" data-close>Fechar</button><button class="btn primary" id="b-salvar">Salvar beneficiário</button>',
  });
  const f = $('#bf', m.el); const F = (n) => f.querySelector(`[name=${n}]`);
  const preencher = (b = {}) => { F('id').value = b.id || ''; for (const [k] of campos) F(k).value = b[k] || ''; F('fundo_id').value = b.fundo_id || ''; F('ativo').value = b.ativo === false ? '0' : '1';
    F('tipo').value = b.tipo || 'FIDC'; F('fav').value = b.favorecido_id ? (state.cad.favById[b.favorecido_id]?.nome || '') : ''; };
  // ao escolher um fornecedor, puxa os dados dele para o formulário
  F('fav').onchange = () => { const fv = fornecedores().find(x => x.nome === F('fav').value.trim()); if (!fv) return; const d = deFavorecido(fv);
    for (const [k] of campos) if (d[k] && !F(k).value) F(k).value = d[k]; F('tipo').value = 'Fornecedor'; };
  m.el.querySelector('tbody').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) preencher(benefs.find(b => b.id === tr.dataset.id)); };
  $('#b-novo', m.el).onclick = () => preencher();
  $('#b-salvar', m.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const d = formData(f);
    const fv = d.fav ? fornecedores().find(x => x.nome === String(d.fav).trim()) : null;
    if (d.fav && !fv) return toast('Fornecedor não encontrado em Beneficiários', true);
    const row = { empresa_id: state.empresa.id, fundo_id: d.fundo_id || null, ativo: d.ativo !== '0', tipo: d.tipo || 'FIDC', favorecido_id: fv?.id || null, updated_at: new Date().toISOString() };
    for (const [k] of campos) row[k] = String(d[k] || '').trim() || null;
    if (row.uf) row.uf = row.uf.toUpperCase();
    try {
      if (d.id) await q(sb.from('beneficiarios_endosso').update(row).eq('id', d.id));
      else { const n = await q(sb.from('beneficiarios_endosso').insert(row).select().single()); ui.benefId = n?.id || ui.benefId; }
      toast('Beneficiário salvo'); m.close(); await carregar(); desenhar(root);
    } catch (e) { fail(e); }
  };
}

// ======================================================================
// PDF: uma duplicata por página (frente no modelo da nota promissória + endosso)
// ======================================================================
const pdfTxt = (s) => String(s ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...');

function desenharPdf(doc, d, pag, totPag, lote) {
  const W = doc.internal.pageSize.getWidth();
  const x0 = 12, y0 = 14, w = W - 24, h = 132, tira = 24;
  doc.setDrawColor(40); doc.setLineWidth(0.5); doc.rect(x0, y0, w, h);
  doc.setLineWidth(0.3); doc.line(x0 + tira, y0, x0 + tira, y0 + h);
  // tira lateral (texto vertical)
  doc.setFont('courier', 'bold'); doc.setFontSize(8); doc.setTextColor(20);
  doc.text(pdfTxt(`Responsável Legal: ${d.emitente.responsavel}`), x0 + 7, y0 + h - 4, { angle: 90 });
  doc.text(pdfTxt(d.emitente.responsavel_cpf), x0 + 10.5, y0 + h - 4, { angle: 90 });
  doc.text(pdfTxt(`Avalista: ${d.emitente.avalista}`), x0 + 17, y0 + h - 4, { angle: 90 });
  doc.text(pdfTxt(d.emitente.avalista_cpf), x0 + 20.5, y0 + h - 4, { angle: 90 });
  const X = x0 + tira + 5, R = x0 + w - 5;
  // topo
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('DUPLICATA MERCANTIL', X, y0 + 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Vencimento:', R - 40, y0 + 8);
  doc.setFont('courier', 'bold'); doc.setFontSize(10); doc.text(dateBR(d.vencimento), R, y0 + 8, { align: 'right' });
  // caixas: nº, fatura, emissão, valor
  const caixa = (rot, val, x, wd, y = y0 + 13) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(rot, x, y + 2.5);
    doc.rect(x, y + 4, wd, 7); doc.setFont('courier', 'bold'); doc.setFontSize(10); doc.text(pdfTxt(val), x + 2, y + 9);
  };
  caixa('Nº da duplicata', d.numero, X, 38); caixa('Fatura / NF', d.fatura, X + 42, 28); caixa('Emissão', dateBR(d.emissao), X + 74, 28);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text('R$', R - 46, y0 + 15.5);
  doc.rect(R - 46, y0 + 17, 46, 7); doc.setFont('courier', 'bold'); doc.setFontSize(11); doc.text(money(d.valor), R - 2, y0 + 22, { align: 'right' });
  // texto
  let y = y0 + 32;
  doc.setFont('courier', 'bold'); doc.setFontSize(9);
  const linhas = doc.splitTextToSize(pdfTxt(`${dataExtenso(d.vencimento, { modelo: 'nota' })} pagarei(emos) por esta única via de DUPLICATA a ${d.emitente.nome} - CNPJ/MF nº ${d.emitente.cnpj}, ou à sua ordem, a quantia de:`), R - X);
  doc.text(linhas, X, y); y += linhas.length * 4.2 + 1;
  const ext = doc.splitTextToSize(pdfTxt(valorExtenso(d.valor)) + ' ' + '*'.repeat(60), R - X - 4);
  doc.rect(X, y - 1, R - X, ext.slice(0, 2).length * 4.5 + 3); doc.text(ext.slice(0, 2), X + 2, y + 3); y += ext.slice(0, 2).length * 4.5 + 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text('EM MOEDA CORRENTE DESTE PAÍS', R, y - 1, { align: 'right' });
  doc.setFontSize(9); doc.text('Pagável em', X, y + 4); doc.setFont('courier', 'bold'); doc.text(pdfTxt(d.praca || '-'), X + 19, y + 4);
  doc.text(pdfTxt(`${d.local || ''}, ${dataExtenso(d.emissao)}`.toUpperCase()), R, y + 9, { align: 'right' });
  // sacado
  y += 13; doc.setLineWidth(0.2); doc.rect(X, y, R - X, 24);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text('SACADO', X + 2, y + 3.5);
  doc.setFont('courier', 'bold'); doc.setFontSize(9);
  doc.text(pdfTxt(d.sacado.nome).slice(0, 80), X + 2, y + 8);
  doc.setFont('courier', 'normal'); doc.setFontSize(8.5);
  doc.text(pdfTxt(`CNPJ/CPF: ${d.sacado.cnpj || '-'}${d.sacado.ie ? `   IE: ${d.sacado.ie}` : ''}`), X + 2, y + 12);
  doc.text(pdfTxt(`${d.sacado.endereco || 'ENDEREÇO NÃO CADASTRADO'}${d.sacado.cidade ? ` - ${d.sacado.cidade}` : ''}${d.sacado.cep ? `  CEP ${d.sacado.cep}` : ''}`).slice(0, 95), X + 2, y + 16);
  doc.setFont('courier', 'normal'); doc.setFontSize(8.3); doc.text(pdfTxt(`CHAVE NF-e: ${d.sacado.chave || '-'}`), X + 2, y + 20.5);
  // emitente + assinaturas
  y += 28;
  const maxW = R - 66 - X; const campoEmit = (val, rot, yy) => { doc.setFont('courier', 'bold'); let fs = 9; doc.setFontSize(fs); const tv = pdfTxt(val); while (fs > 6.5 && doc.getTextWidth(tv) > maxW) doc.setFontSize(fs -= 0.5); doc.text(tv, X, yy); doc.setLineWidth(0.2); doc.line(X, yy + 1, X + maxW, yy + 1); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text(rot, X, yy + 3.6); };
  campoEmit(d.emitente.nome, 'EMITENTE', y); campoEmit(`${d.emitente.cnpj}${d.emitente.ie ? `   IE ${d.emitente.ie}` : ''}`, 'CNPJ/MF DO EMITENTE', y + 7.5);
  campoEmit(d.emitente.logradouro, 'LOGRADOURO DO EMITENTE', y + 15); campoEmit(d.emitente.cidade, 'MUNICÍPIO/UF DO EMITENTE', y + 22.5);
  const ass = (txt, sub, xa, ya) => { doc.setLineWidth(0.3); doc.line(xa, ya, xa + 62, ya); doc.setFont('courier', 'bold'); doc.setFontSize(8); doc.text(pdfTxt(txt).slice(0, 38), xa + 31, ya + 3.5, { align: 'center' }); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.text(sub, xa + 31, ya + 6.5, { align: 'center' }); };
  ass(d.emitente.nome, 'EMITENTE', R - 62, y + 22);
  // endosso (verso)
  const yv = y0 + h + 14;
  doc.setLineDashPattern([1.5, 1.5], 0); doc.setDrawColor(150); doc.line(x0, yv - 6, x0 + w, yv - 6); doc.setLineDashPattern([], 0); doc.setDrawColor(40);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120); doc.text('VERSO', x0 + w / 2, yv - 7, { align: 'center' }); doc.setTextColor(20);
  doc.setLineWidth(0.5); doc.rect(x0, yv, w, 70);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(d.modalidade === 'garantia' ? 'ENDOSSO EM GARANTIA (ENDOSSO-CAUÇÃO)' : 'ENDOSSO', x0 + 6, yv + 9);
  doc.setFont('courier', 'bold'); doc.setFontSize(10);
  const b = d.beneficiario;
  const txtEnd = doc.splitTextToSize(pdfTxt(textoEndosso(d)), w - 12);
  doc.text(txtEnd, x0 + 6, yv + 18);
  doc.text(pdfTxt(`${d.local}, ${dataExtenso(d.dataEndosso)}.`), x0 + 6, yv + 20 + txtEnd.length * 4.6);
  doc.setLineWidth(0.3); doc.line(x0 + w - 96, yv + 56, x0 + w - 6, yv + 56);
  doc.setFont('courier', 'bold'); doc.setFontSize(9); doc.text(pdfTxt(d.emitente.nome), x0 + w - 51, yv + 60, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(pdfTxt(`ENDOSSANTE - CNPJ/MF ${d.emitente.cnpj}`), x0 + w - 51, yv + 63.5, { align: 'center' });
  doc.text('Assinatura digital com certificado ICP-Brasil (MP 2.200-2/2001)', x0 + w - 51, yv + 67, { align: 'center' });
  doc.setFontSize(7); doc.setTextColor(120);
  doc.text(pdfTxt(`Duplicata ${d.numero} · endosso${d.modalidade === 'garantia' ? ' em garantia' : ''} a ${b.curto} · lote ${lote}`), x0, 290); doc.text(`Página ${pag} de ${totPag}`, x0 + w, 290, { align: 'right' }); doc.setTextColor(20);
}

async function gerar(tits, b, root) {
  if (!b) return toast('Escolha o beneficiário', true);
  const ja = tits.filter(t => emitidas[t.id]?.length);
  if (ja.length && !confirm(`${ja.length} título(s) já tiveram duplicata gerada. Gerar de novo?`)) return;
  if (!window.jspdf) return fail(new Error('Gerador de PDF não carregado'));
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const agora = new Date(); const lote = `${b.nome}-${new Date(agora.getTime() - agora.getTimezoneOffset() * 6e4).toISOString().slice(0, 16).replace(/\D/g, '')}`;
  const dados = tits.map(t => ({ t, d: dadosDuplicata(t, b) }));
  dados.forEach(({ d }, i) => { if (i) doc.addPage(); desenharPdf(doc, d, i + 1, dados.length, lote); });
  doc.setProperties({ title: `Duplicatas para endosso - ${b.nome}`, subject: `Lote ${lote}`, author: state.empresa.razao_social || state.empresa.nome });
  doc.save(`duplicatas_endosso_${b.nome.replace(/\W+/g, '_')}_${ui.dataEndosso}.pdf`);
  try {
    const rows = dados.map(({ t, d }) => ({ empresa_id: state.empresa.id, lancamento_id: t.id, numero: d.numero, fatura: d.fatura || null, emissao: d.emissao || null, vencimento: d.vencimento,
      valor: d.valor, sacado_id: t.favorecido_id || null, beneficiario_id: b.id, proposta_id: itensProp[t.id]?.id || null, lote, dados: d, modalidade: d.modalidade, referencia: d.referencia || null }));
    for (let i = 0; i < rows.length; i += 200) await q(sb.from('duplicatas').insert(rows.slice(i, i + 200)));
    toast(`${rows.length} duplicata(s) gerada(s) e registrada(s) — endosso${rows[0]?.modalidade === 'garantia' ? ' em garantia' : ''} a ${b.nome}`);
    await carregar(); desenhar(root);
  } catch (e) { fail(e); }
}

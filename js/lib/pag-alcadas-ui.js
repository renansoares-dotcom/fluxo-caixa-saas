// Autorização de pagamentos (melhoria 3.6): alçadas de aprovação e remessa CNAB 240.
import { sb, state, q, fetchAll, podeEditar } from './data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal, confirmDialog, parseNum } from './ui.js';
import * as C from './cnab240.js';
import { ehDiaUtil } from './fidc-condicoes.js';

const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro']];
const SIT = { pendente: ['pendente', 'aberto'], aprovado: ['aprovado', 'pago'], recusado: ['recusado', 'vencido'] };
const iso = (d) => d.toISOString().slice(0, 10);
const proxUtil = (s) => { let d = new Date(s + 'T12:00:00Z'); while (!ehDiaUtil(iso(d))) d.setUTCDate(d.getUTCDate() + 1); return iso(d); };
const baixar = (texto, nome) => { const b = new Blob([texto], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

// ---------- alçadas ----------
export async function modalAlcadas(depois) {
  const e = state.empresa.id;
  let L, CFG, MB;
  try {
    [L, CFG, MB] = await Promise.all([q(sb.from('pag_alcadas').select('*').eq('empresa_id', e).order('ordem').order('valor_min')),
      q(sb.from('pag_config').select('*').eq('empresa_id', e).maybeSingle()), q(sb.rpc('listar_membros', { p_empresa: e })).catch(() => [])]);
  } catch (er) { return fail(/pag_alcadas/.test(er.message || '') ? new Error('As alçadas precisam do SQL 109.') : er); }
  const cfg = { quem_elabora_nao_aprova: true, avisar_aprovadores: true, ...(CFG || {}) };
  const nome = (u) => { const m = MB.find(x => x.user_id === u); return m ? (m.nome || m.email) : 'pessoa'; };
  const faixa = (a) => `${money(a.valor_min)} ${a.valor_max != null ? `a ${money(a.valor_max)}` : 'ou mais'}`;
  const m = modal({ title: 'Alçadas de aprovação de pagamentos', wide: true, body: `
    <p class="small muted" style="margin-top:0">Cada título marcado numa autorização cai na alçada do seu valor (e do centro de custo, se a faixa for de um centro). Quem a alçada indica aprova ou recusa pela tela ou em lote por <b>Minhas aprovações</b>. Com <b>2 aprovações</b>, o título precisa de duas pessoas diferentes. Sem nenhuma alçada ativa, vale a regra antiga: o diretor aprova a autorização inteira.</p>
    <div class="table-wrap"><table><thead><tr><th>Alçada</th><th>Faixa de valor</th><th>Centro de custo</th><th>Quem aprova</th><th class="num">Aprovações</th><th></th></tr></thead><tbody>
    ${L.map(a => `<tr data-id="${a.id}" class="${a.ativo ? '' : 'muted'}"><td><b>${esc(a.nome)}</b>${a.ativo ? '' : ' <span class="badge">inativa</span>'}</td><td class="nowrap">${faixa(a)}</td>
      <td>${esc(state.cad.ccById?.[a.centro_custo_id]?.nome || 'qualquer')}</td>
      <td class="small">${[...a.papeis.map(p => PAPEIS.find(x => x[0] === p)?.[1] || p), ...a.usuarios.map(nome)].map(esc).join(', ') || '—'}</td>
      <td class="num">${a.aprovacoes}</td><td class="nowrap"><button class="btn ghost small" data-ed>Editar</button><button class="btn ghost small" data-del>Excluir</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma alçada: vale a aprovação da autorização inteira pelo diretor.</td></tr>'}
    </tbody></table></div>
    <div class="grid-form" style="margin-top:12px">
      <label class="chk span2"><input type="checkbox" id="al-seg" ${cfg.quem_elabora_nao_aprova ? 'checked' : ''}> Quem elaborou a autorização não aprova os títulos dela (segregação de funções)</label>
      <label class="chk span2"><input type="checkbox" id="al-av" ${cfg.avisar_aprovadores ? 'checked' : ''}> Avisar os aprovadores quando a autorização é gerada</label></div>`,
    foot: '<button class="btn" id="al-cfg">Salvar opções</button><span class="spacer"></span><button class="btn" data-close>Fechar</button><button class="btn primary" id="al-novo">+ Nova alçada</button>' });
  $('#al-cfg', m.el).onclick = async () => {
    try { await q(sb.from('pag_config').upsert({ empresa_id: e, quem_elabora_nao_aprova: $('#al-seg', m.el).checked, avisar_aprovadores: $('#al-av', m.el).checked }, { onConflict: 'empresa_id' })); toast('Opções salvas'); } catch (er) { fail(er); }
  };
  const re = () => { m.close(); modalAlcadas(depois); depois?.(); };
  $('#al-novo', m.el).onclick = () => editarAlcada({ nome: '', valor_min: 0, valor_max: null, papeis: ['diretor'], usuarios: [], aprovacoes: 1, ordem: L.length + 1, ativo: true }, MB, re);
  m.el.querySelector('tbody').onclick = async (ev) => {
    const id = ev.target.closest('tr')?.dataset.id; if (!id) return; const a = L.find(x => x.id === id);
    if (ev.target.closest('[data-ed]')) editarAlcada(a, MB, re);
    if (ev.target.closest('[data-del]') && await confirmDialog(`Excluir a alçada "${a.nome}"? Títulos já enviados continuam com o histórico.`)) {
      try { await q(sb.from('pag_alcadas').delete().eq('id', id)); toast('Alçada excluída'); re(); } catch (er) { fail(er); }
    }
  };
}

function editarAlcada(a, MB, depois) {
  const m = modal({ title: a.id ? `Alçada ${a.nome}` : 'Nova alçada', body: `<div class="grid-form">
      <label class="span2">Nome<input id="ea-n" maxlength="60" value="${esc(a.nome)}" placeholder="ex.: Até R$ 5 mil"></label>
      <label>Valor de (R$)<input id="ea-min" inputmode="decimal" value="${money(a.valor_min)}"></label>
      <label>Valor até (R$, vazio = sem teto)<input id="ea-max" inputmode="decimal" value="${a.valor_max != null ? money(a.valor_max) : ''}"></label>
      <label>Centro de custo<select id="ea-cc"><option value="">Qualquer</option>${(state.cad.cc || []).map(c => `<option value="${c.id}" ${c.id === a.centro_custo_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Aprovações necessárias<select id="ea-q">${[1, 2, 3].map(n => `<option ${n === a.aprovacoes ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="span2"><span class="small">Perfis que aprovam</span><div class="fc-chks">${PAPEIS.map(([k, l]) => `<label class="chk"><input type="checkbox" class="ea-p" value="${k}" ${a.papeis.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
      <div class="span2"><span class="small">Pessoas que aprovam (além dos perfis)</span><div class="fc-chks">${MB.filter(x => ['admin', 'diretor', 'financeiro'].includes(x.papel)).map(x => `<label class="chk"><input type="checkbox" class="ea-u" value="${x.user_id}" ${a.usuarios.includes(x.user_id) ? 'checked' : ''}> ${esc(x.nome || x.email)}</label>`).join('')}</div></div>
      <label>Ordem<input id="ea-o" type="number" min="0" max="99" value="${a.ordem}"></label>
      <label class="chk"><input type="checkbox" id="ea-at" ${a.ativo ? 'checked' : ''}> Ativa</label></div>
      <p class="small muted">Se duas faixas cobrem o mesmo valor, vale a do centro de custo do título; depois, a de menor ordem.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ea-ok">Salvar</button>' });
  $('#ea-ok', m.el).onclick = async () => {
    const reg = { nome: $('#ea-n', m.el).value.trim(), valor_min: parseNum($('#ea-min', m.el).value) || 0, valor_max: $('#ea-max', m.el).value.trim() ? parseNum($('#ea-max', m.el).value) : null,
      centro_custo_id: $('#ea-cc', m.el).value || null, aprovacoes: +$('#ea-q', m.el).value, ordem: +$('#ea-o', m.el).value || 0, ativo: $('#ea-at', m.el).checked,
      papeis: $$('.ea-p', m.el).filter(i => i.checked).map(i => i.value), usuarios: $$('.ea-u', m.el).filter(i => i.checked).map(i => i.value) };
    if (!reg.nome) return toast('Dê um nome à alçada', true);
    if (reg.valor_max != null && reg.valor_max < reg.valor_min) return toast('O valor final é menor que o inicial', true);
    if (!reg.papeis.length && !reg.usuarios.length) return toast('Escolha quem aprova', true);
    try { if (a.id) await q(sb.from('pag_alcadas').update(reg).eq('id', a.id)); else await q(sb.from('pag_alcadas').insert({ ...reg, empresa_id: state.empresa.id })); toast('Alçada salva'); m.close(); depois(); } catch (e) { fail(e); }
  };
}

/** títulos da autorização com a alçada, as aprovações e a decisão de quem está logado */
export async function detalheAlcadas(aut, depois) {
  let IT, AL, AP;
  try {
    [IT, AL, AP] = await Promise.all([q(sb.from('autorizacao_itens').select('*').eq('autorizacao_id', aut.id).eq('autoriza', true).order('valor_autorizado', { ascending: false })),
      q(sb.from('pag_alcadas').select('*').eq('empresa_id', state.empresa.id)), q(sb.from('pag_aprovacoes').select('*').eq('empresa_id', state.empresa.id))]);
  } catch (e) { return fail(e); }
  const meu = (it) => { const a = AL.find(x => x.id === it.alcada_id); return a && (a.usuarios.includes(state.user?.id) || a.papeis.includes(state.papel)); };
  const aprs = (it) => AP.filter(x => x.item_id === it.id);
  const podeDecidir = aut.status === 'Pendente';
  const m = modal({ title: `Autorização nº ${aut.numero} — aprovações por alçada`, wide: true, body: `
    <div class="table-wrap"><table id="da-t"><thead><tr>${podeDecidir ? '<th><input type="checkbox" id="da-all"></th>' : ''}<th>Vencimento</th><th>Favorecido</th><th class="num">Valor</th><th>Alçada</th><th>Aprovações</th><th>Situação</th></tr></thead><tbody>
    ${IT.map(it => { const a = AL.find(x => x.id === it.alcada_id), ap = aprs(it), pode = podeDecidir && it.situacao === 'pendente' && meu(it) && !ap.some(x => x.user_id === state.user?.id);
      return `<tr data-id="${it.id}">${podeDecidir ? `<td>${pode ? '<input type="checkbox" class="da-c">' : ''}</td>` : ''}<td>${dateBR(it.vencimento)}</td><td class="wrap">${esc(it.favorecido || '')}<div class="small muted">${esc(it.descricao || '')}</div></td>
        <td class="num">${money(it.valor_autorizado)}</td><td class="small">${a ? esc(a.nome) : '<span class="neg">sem alçada</span>'}</td>
        <td class="small">${ap.map(x => `${x.aprovado ? '✔' : '✕'} ${esc((x.email || '').split('@')[0])}${x.motivo ? ` (${esc(x.motivo)})` : ''}`).join('<br>') || '—'}${a ? `<div class="muted">${ap.filter(x => x.aprovado).length} de ${a.aprovacoes}</div>` : ''}</td>
        <td><span class="badge ${SIT[it.situacao]?.[1] || ''}">${SIT[it.situacao]?.[0] || it.situacao}</span></td></tr>`; }).join('')}
    </tbody></table></div>`,
    foot: podeDecidir ? '<button class="btn" data-close>Fechar</button><button class="btn danger" id="da-rec">Recusar marcados…</button><button class="btn primary" id="da-ok">Aprovar marcados</button>' : '<button class="btn" data-close>Fechar</button>' });
  if (!podeDecidir) return;
  $('#da-all', m.el).onchange = (e) => $$('.da-c', m.el).forEach(c => { c.checked = e.target.checked; });
  const marcados = () => $$('.da-c', m.el).filter(c => c.checked).map(c => c.closest('tr').dataset.id);
  const decidir = async (aprovar, motivo) => {
    const ids = marcados(); if (!ids.length) return toast('Marque os títulos da sua alçada', true);
    try { const r = await q(sb.rpc('pag_decidir', { p_autorizacao: aut.id, p_itens: ids, p_aprovar: aprovar, p_motivo: motivo || null }));
      toast(`${r.decididos} título(s) ${aprovar ? 'aprovado(s)' : 'recusado(s)'}${r.pendentes ? ` · faltam ${r.pendentes}` : ' · autorização concluída'}`); m.close(); depois?.(); } catch (e) { fail(e); }
  };
  $('#da-ok', m.el).onclick = () => decidir(true);
  $('#da-rec', m.el).onclick = () => {
    const mm = modal({ title: 'Recusar títulos', narrow: true, body: '<label>Motivo *<input id="dr-m" maxlength="300" placeholder="ex.: negociar o prazo com o fornecedor"></label>', foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="dr-ok">Recusar</button>' });
    $('#dr-ok', mm.el).onclick = () => { const v = $('#dr-m', mm.el).value.trim(); if (v.length < 5) return toast('Diga o motivo', true); mm.close(); decidir(false, v); };
  };
}

// ---------- remessa CNAB 240 ----------
export async function modalRemessa(aut, depois) {
  const e = state.empresa.id;
  let IT, CT, EMP, REM;
  try {
    [IT, CT, EMP, REM] = await Promise.all([
      q(sb.from('autorizacao_itens').select('*').eq('autorizacao_id', aut.id).eq('autoriza', true)),
      q(sb.from('contas').select('id,nome,banco_codigo,agencia,agencia_dv,numero,conta_dv,cnab_convenio,cnab_nsa,cnab_layout,ativo').eq('empresa_id', e).eq('ativo', true).order('nome')),
      q(sb.from('empresas').select('*').eq('id', e).single()),
      q(sb.from('pag_remessa_itens').select('lancamento_id,remessa_id,r:pag_remessas(nsa,situacao)').eq('empresa_id', e)),
    ]);
  } catch (er) { return fail(/banco_codigo|pag_remessa/.test(er.message || '') ? new Error('A remessa CNAB precisa do SQL 109.') : er); }
  const itens = IT.filter(i => !i.alcada_id || i.situacao === 'aprovado');
  const lancIds = itens.map(i => i.lancamento_id).filter(Boolean);
  const LC = lancIds.length ? await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,favorecido_id,codigo_barras').in('id', lancIds)) : [];
  const favIds = [...new Set(LC.map(l => l.favorecido_id).filter(Boolean))];
  const FV = favIds.length ? await q(sb.from('favorecidos').select('id,nome,documento,logradouro,municipio,uf,cep,pix,pix_tipo,banco_codigo,agencia,agencia_dv,conta_numero,conta_dv,conta_tipo').in('id', favIds)) : [];
  const naRem = new Map(REM.filter(r => r.r?.situacao === 'gerada').map(r => [r.lancamento_id, r.r.nsa]));
  const contasCnab = CT.filter(c => c.banco_codigo);
  let conta = contasCnab[0] || null;
  const T = itens.map(i => { const l = LC.find(x => x.id === i.lancamento_id) || {}; const fav = FV.find(x => x.id === l.favorecido_id) || { nome: i.favorecido };
    return { item_id: i.id, lancamento_id: i.lancamento_id, favorecido: i.favorecido, valor: +i.valor_autorizado, vencimento: i.vencimento || l.data, descricao: [l.descricao, l.documento && 'NF ' + l.documento].filter(Boolean).join(' ').slice(0, 40),
      codigo_barras: l.codigo_barras || '', fav, seu_numero: (i.lancamento_id || i.id).replace(/-/g, '').slice(0, 20), nsa: naRem.get(i.lancamento_id) }; });
  T.forEach(t => { t.forma = C.formaSugerida(t, conta?.banco_codigo) || 'ted'; });
  const dataPag = proxUtil(today());
  const m = modal({ title: `Remessa CNAB 240 — autorização nº ${aut.numero}`, wide: true, body: `
    <div class="toolbar" style="padding:0"><label>Conta de débito<select id="rm-ct">${contasCnab.map(c => `<option value="${c.id}">${esc(c.nome)} (${c.banco_codigo})</option>`).join('') || '<option value="">Nenhuma conta com o banco informado</option>'}</select></label>
      <button class="btn small" id="rm-cfg">Dados da conta para a remessa</button>
      <label>Data do pagamento<input type="date" id="rm-dt" value="${dataPag}" min="${today()}"></label><span class="spacer"></span><span class="small muted" id="rm-tot"></span></div>
    <p class="small muted">Padrão FEBRABAN 240. A forma vem do que existe no cadastro: boleto (linha digitável), Pix (chave e tipo no beneficiário), crédito em conta (mesmo banco) ou TED. Antes de usar com dinheiro de verdade, homologue o primeiro arquivo com o banco.</p>
    <div class="table-wrap" style="max-height:50vh"><table id="rm-t"><thead><tr><th><input type="checkbox" id="rm-all" checked></th><th>Favorecido</th><th class="num">Valor</th><th>Forma</th><th>Linha digitável (boleto)</th><th>Pendências</th></tr></thead><tbody></tbody></table></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rm-ok">Gerar o arquivo</button>' });
  const tb = $('#rm-t tbody', m.el);
  const pintar = () => {
    tb.innerHTML = T.map((t, i) => { const p = C.pendencias(t, t.forma); return `<tr data-i="${i}" class="${t.nsa ? 'muted' : ''}"><td>${t.nsa ? '' : `<input type="checkbox" class="rm-c" ${p.length ? '' : 'checked'}>`}</td>
      <td class="wrap">${esc(t.favorecido || '')}<div class="small muted">${dateBR(t.vencimento)} · ${esc(t.descricao)}</div></td><td class="num">${money(t.valor)}</td>
      <td><select class="rm-f" ${t.nsa ? 'disabled' : ''}>${Object.entries(C.FORMAS).map(([k, f]) => `<option value="${k}" ${k === t.forma ? 'selected' : ''}>${f.nome}</option>`).join('')}</select></td>
      <td><input class="rm-b" value="${esc(t.codigo_barras)}" placeholder="47 números" style="min-width:230px" ${t.nsa ? 'disabled' : ''}></td>
      <td class="small">${t.nsa ? `já na remessa nº ${t.nsa}` : p.length ? `<span class="neg">${p.map(esc).join(' · ')}</span>` : '<span class="pos">ok</span>'}</td></tr>`; }).join('');
    const sel = $$('.rm-c', m.el).filter(c => c.checked).map(c => T[+c.closest('tr').dataset.i]);
    $('#rm-tot', m.el).textContent = `${sel.length} título(s) · ${money(sel.reduce((s, t) => s + t.valor, 0))}`;
  };
  pintar();
  tb.onchange = async (ev) => {
    const i = +ev.target.closest('tr').dataset.i, t = T[i];
    if (ev.target.matches('.rm-f')) t.forma = ev.target.value;
    if (ev.target.matches('.rm-b')) {
      t.codigo_barras = ev.target.value.replace(/\D/g, '');
      if (t.codigo_barras) t.forma = 'boleto';
      if (t.lancamento_id) await q(sb.from('lancamentos').update({ codigo_barras: t.codigo_barras || null }).eq('id', t.lancamento_id)).catch(fail);
    }
    pintar();
  };
  $('#rm-all', m.el).onchange = (ev) => { $$('.rm-c', m.el).forEach(c => { c.checked = ev.target.checked; }); pintar(); };
  $('#rm-ct', m.el).onchange = (ev) => { conta = contasCnab.find(c => c.id === ev.target.value); T.forEach(t => { if (!t.nsa) t.forma = C.formaSugerida(t, conta?.banco_codigo) || t.forma; }); pintar(); };
  $('#rm-cfg', m.el).onclick = () => dadosConta(CT, conta, () => { m.close(); modalRemessa(aut, depois); });
  $('#rm-ok', m.el).onclick = async () => {
    if (!conta) return toast('Escolha a conta de débito (informe o banco dela em "Dados da conta para a remessa")', true);
    const sel = $$('.rm-c', m.el).filter(c => c.checked).map(c => T[+c.closest('tr').dataset.i]);
    if (!sel.length) return toast('Marque os títulos da remessa', true);
    const ruim = sel.filter(t => C.pendencias(t, t.forma).length); if (ruim.length) return toast(`${ruim.length} título(s) marcados com pendência: complete o cadastro ou desmarque.`, true);
    const data = $('#rm-dt', m.el).value; if (!data || data < today()) return toast('Escolha a data do pagamento', true);
    try {
      const r = await q(sb.rpc('pag_remessa_criar', { p_conta: conta.id, p_autorizacao: aut.id, p_data: data,
        p_itens: sel.map(t => ({ item_id: t.item_id, lancamento_id: t.lancamento_id, forma: t.forma, valor: t.valor, favorecido: t.favorecido })) }));
      const R = C.gerarRemessa({ E: EMP, C: { banco: conta.banco_codigo, agencia: conta.agencia, agencia_dv: conta.agencia_dv, conta: conta.numero, conta_dv: conta.conta_dv, convenio: conta.cnab_convenio, layout: conta.cnab_layout },
        titulos: sel, nsa: r.nsa, data });
      await q(sb.rpc('pag_remessa_gravar', { p_remessa: r.id, p_arquivo: R.texto, p_nome: R.nome }));
      baixar(R.texto, R.nome);
      toast(`Remessa nº ${r.nsa} gerada: ${sel.length} título(s), ${money(R.total)}. Envie o arquivo pelo internet banking.`); m.close(); depois?.();
    } catch (e) { fail(e); }
  };
}

function dadosConta(CT, atual, depois) {
  const c = atual || CT[0]; if (!c) return toast('Cadastre uma conta bancária', true);
  const L = { ...C.LAYOUT_PADRAO, ...(c.cnab_layout || {}) };
  const m = modal({ title: 'Dados da conta para a remessa CNAB', body: `<div class="grid-form">
      <label class="span2">Conta<select id="dc-c">${CT.map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Banco (código)<input id="dc-b" maxlength="3" value="${esc(c.banco_codigo || '')}" placeholder="ex.: 341"><span class="small muted" id="dc-bn">${esc(C.BANCOS[c.banco_codigo] || '')}</span></label>
      <label>Convênio / código da empresa no banco<input id="dc-cv" value="${esc(c.cnab_convenio || '')}"></label>
      <label>Agência<input id="dc-ag" value="${esc(c.agencia || '')}"></label><label>Dígito da agência<input id="dc-agd" maxlength="1" value="${esc(c.agencia_dv || '')}"></label>
      <label>Conta<input id="dc-n" value="${esc(c.numero || '')}"></label><label>Dígito da conta<input id="dc-nd" maxlength="1" value="${esc(c.conta_dv || '')}"></label>
      <label>Próximo nº do arquivo (NSA)<input value="${(c.cnab_nsa || 0) + 1}" disabled></label><span></span>
      <label>Versão do arquivo<input id="dc-va" maxlength="3" value="${esc(L.versao_arquivo)}"></label><label>Versão do lote (crédito/TED/Pix)<input id="dc-vl" maxlength="3" value="${esc(L.versao_lote)}"></label>
      <label>Versão do lote de boletos<input id="dc-vj" maxlength="3" value="${esc(L.versao_lote_j || '040')}"></label><label>Finalidade da TED<input id="dc-ft" maxlength="5" value="${esc(L.finalidade_ted)}"></label>
      <label class="chk"><input type="checkbox" id="dc-j52" ${L.j52 ? 'checked' : ''}> Segmento J-52 nos boletos</label>
      <label class="chk"><input type="checkbox" id="dc-pb" ${L.pix_segmento_b ? 'checked' : ''}> Chave Pix no segmento B (FEBRABAN 10.11)</label></div>
      <p class="small muted">As versões e a finalidade variam por banco: confirme com o gerente ou o manual CNAB 240 do banco.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="dc-ok">Salvar</button>' });
  $('#dc-c', m.el).onchange = (ev) => { m.close(); dadosConta(CT, CT.find(x => x.id === ev.target.value), depois); };
  $('#dc-b', m.el).oninput = (ev) => { $('#dc-bn', m.el).textContent = C.BANCOS[ev.target.value] || ''; };
  $('#dc-ok', m.el).onclick = async () => {
    const v = (id) => $('#' + id, m.el).value.trim();
    if (v('dc-b') && !/^\d{3}$/.test(v('dc-b'))) return toast('O código do banco tem 3 números', true);
    const reg = { banco_codigo: v('dc-b') || null, cnab_convenio: v('dc-cv') || null, agencia: v('dc-ag') || null, agencia_dv: v('dc-agd') || null, numero: v('dc-n') || null, conta_dv: v('dc-nd') || null,
      cnab_layout: { versao_arquivo: v('dc-va'), versao_lote: v('dc-vl'), versao_lote_j: v('dc-vj'), finalidade_ted: v('dc-ft'), j52: $('#dc-j52', m.el).checked, pix_segmento_b: $('#dc-pb', m.el).checked } };
    try { await q(sb.from('contas').update(reg).eq('id', $('#dc-c', m.el).value)); toast('Dados da conta salvos'); m.close(); depois(); } catch (e) { fail(e); }
  };
}

export async function listaRemessas() {
  let R;
  try { R = await q(sb.from('pag_remessas').select('*').eq('empresa_id', state.empresa.id).order('gerado_em', { ascending: false }).limit(60)); }
  catch (e) { return fail(/pag_remessas/.test(e.message || '') ? new Error('A remessa CNAB precisa do SQL 109.') : e); }
  const m = modal({ title: 'Remessas CNAB geradas', wide: true, body: R.length ? `<div class="table-wrap"><table id="lr-t"><thead><tr><th>Nº (NSA)</th><th>Conta</th><th>Gerada em</th><th>Pagamento</th><th class="num">Títulos</th><th class="num">Total</th><th>Situação</th><th></th></tr></thead><tbody>
    ${R.map(r => `<tr data-id="${r.id}"><td><b>${r.nsa}</b></td><td>${esc(state.cad.contaById?.[r.conta_id]?.nome || '')}</td><td>${new Date(r.gerado_em).toLocaleString('pt-BR')}</td><td>${dateBR(r.data_pagamento)}</td>
      <td class="num">${r.qtd}</td><td class="num">${money(r.total)}</td><td>${r.situacao === 'gerada' ? '<span class="badge pago">gerada</span>' : `<span class="badge vencido" title="${esc(r.motivo_cancelamento || '')}">cancelada</span>`}</td>
      <td class="nowrap">${r.arquivo ? '<button class="btn ghost small" data-b>Baixar</button>' : ''}${r.situacao === 'gerada' && podeEditar() ? '<button class="btn ghost small" data-c>Cancelar</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Cancelar libera os títulos para outra remessa (ex.: o banco recusou o arquivo). O número sequencial não volta: o próximo arquivo usa o número seguinte.</p>` : '<div class="empty">Nenhuma remessa gerada.</div>',
    foot: '<button class="btn" data-close>Fechar</button>' });
  m.el.querySelector('tbody')?.addEventListener('click', async (ev) => {
    const id = ev.target.closest('tr')?.dataset.id; const r = R.find(x => x.id === id); if (!r) return;
    if (ev.target.closest('[data-b]')) baixar(r.arquivo, r.nome_arquivo || `remessa_${r.nsa}.rem`);
    if (ev.target.closest('[data-c]')) {
      const mm = modal({ title: `Cancelar a remessa nº ${r.nsa}`, narrow: true, body: '<label>Motivo *<input id="lc-m" maxlength="300" placeholder="ex.: o banco recusou o arquivo"></label>', foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="lc-ok">Cancelar a remessa</button>' });
      $('#lc-ok', mm.el).onclick = async () => { const v = $('#lc-m', mm.el).value.trim(); if (v.length < 5) return toast('Diga o motivo', true);
        try { await q(sb.rpc('pag_remessa_cancelar', { p_remessa: r.id, p_motivo: v })); toast('Remessa cancelada'); mm.close(); m.close(); listaRemessas(); } catch (e) { fail(e); } };
    }
  });
}

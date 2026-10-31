// CPD › Fiscal › Notas de débito (SQL 074): fila das NF-e de débito de juros e multa (finNFe 6, tpNFDebito 04) a emitir.
// Gerada sozinha quando entra um recebimento de juros (lançamento em 1.02.17 ligado ao título) e, como "a decidir",
// quando o relatório de pagos do fundo traz mora paga pelo cliente. A emissão ainda é feita fora; aqui fica o controle.
import { sb, state, q, fetchAll, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, money, dateBR, toast, fail, modal, today, exportXLSX, erroTela } from '../lib/ui.js';
import { carregarAliquotas } from '../lib/reforma-ui.js';
import { pctBR } from '../lib/reforma.js';
import { STATUS, ORIGEM, PLANO_JUROS, PRAZO_ALERTA, dadosND, diasDesde, nivel } from '../lib/notas-debito.js';

export const title = 'Notas de débito (juros e multa)';
const ui = { status: 'abertas', busca: '' };
let D = null;
const BADGE = { pendente: 'aberto', a_decidir: '', emitida: 'pago', dispensada: '' };

async function carregar() {
  const e = state.empresa.id;
  const nd = await fetchAll(() => sb.from('fiscal_notas_debito').select('*').eq('empresa_id', e).order('data_recebimento', { ascending: false }).order('id')).catch(() => null);
  D = { nd: nd || [], semTabela: nd === null, hoje: today() };
  return D;
}

/** alertas para o Decision Center */
export async function alertasDecisao() {
  const d = await carregar(); if (d.semTabela) return [];
  const p = d.nd.filter(x => x.status === 'pendente');
  return p.length ? [{ n: p.length, valor: p.reduce((s, x) => s + +x.valor, 0), atrasadas: p.filter(x => nivel(x, d.hoje) === 'neg').length, maisAntiga: p.reduce((m, x) => x.data_recebimento < m ? x.data_recebimento : m, d.hoje) }] : [];
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (err) { console.error(err); root.innerHTML = erroTela('as notas de débito'); return; }
  pintar(root);
}

function pintar(root) {
  const N = D.nd, mes = D.hoje.slice(0, 7);
  const soma = (a) => a.reduce((s, x) => s + +x.valor, 0);
  const pend = N.filter(x => x.status === 'pendente'), atr = pend.filter(x => nivel(x, D.hoje) === 'neg'), dec = N.filter(x => x.status === 'a_decidir'), emi = N.filter(x => x.status === 'emitida' && (x.emitida_em || '').startsWith(mes));
  root.innerHTML = `
    ${D.semTabela ? '<div class="card"><span class="badge vencido">SQL 074 pendente</span> A fila de notas de débito ainda não foi criada no banco.</div>' : ''}
    <div class="card"><p class="small" style="margin:0">Juros, multa e acréscimos recebidos por atraso entram na base da CBS e do IBS (LC 214/2025, art. 12, § 1º, II). No dia do recebimento, emita a
      <strong>NF-e de débito</strong> (finalidade 6, tipo 04 – Multa e juros) referenciando a nota de origem. Cada recebimento de juros entra aqui sozinho; enquanto a plataforma não emite NF-e, emita no sistema emissor e informe o número.</p></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">A emitir</div><div class="k-value ${pend.length ? 'neg' : ''}">${pend.length}</div><div class="k-sub">${money(soma(pend))} de juros/multa</div></div>
      <div class="kpi"><div class="k-label">Há mais de ${PRAZO_ALERTA} dias</div><div class="k-value ${atr.length ? 'neg' : ''}">${atr.length}</div><div class="k-sub">${money(soma(atr))}</div></div>
      <div class="kpi"><div class="k-label">A decidir (recebidos pelo fundo)</div><div class="k-value">${dec.length}</div><div class="k-sub">${money(soma(dec))} · definir com a contabilidade</div></div>
      <div class="kpi"><div class="k-label">Emitidas no mês</div><div class="k-value">${emi.length}</div><div class="k-sub">${money(soma(emi))}</div></div>
    </div>
    <div class="card"><div class="toolbar" style="margin-bottom:0">
      <div class="chips" id="nd-st">${[['abertas', 'A emitir + a decidir'], ['pendente', STATUS.pendente], ['a_decidir', 'A decidir'], ['emitida', 'Emitidas'], ['dispensada', 'Dispensadas'], ['', 'Todas']].map(([k, t]) => `<span class="chip ${ui.status === k ? 'on' : ''}" data-s="${k}">${t}</span>`).join('')}</div>
      <label class="grow">Buscar<input id="nd-busca" value="${esc(ui.busca)}" placeholder="cliente, NF"></label>
      <span class="spacer"></span><button class="btn" id="nd-xls">Excel</button>${podeEditar() && !D.semTabela ? '<button class="btn primary" id="nd-novo">Registrar juros recebidos</button>' : ''}
    </div></div>
    <div id="nd-lista"></div>`;
  $('#nd-st', root).onclick = (e) => { const s = e.target.closest('[data-s]')?.dataset.s; if (s != null) { ui.status = s; pintar(root); } };
  let t; $('#nd-busca', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.busca = e.target.value; lista(root); }, 250); };
  $('#nd-xls', root).onclick = () => { const tb = $('#nd-lista table', root); if (tb) exportXLSX(tb, `notas_debito_${D.hoje}`); };
  $('#nd-novo', root) && ($('#nd-novo', root).onclick = () => registrar(root));
  lista(root);
}

function lista(root) {
  const b = ui.busca.trim().toLowerCase();
  const L = D.nd.filter(x => (ui.status === 'abertas' ? ['pendente', 'a_decidir'].includes(x.status) : !ui.status || x.status === ui.status)
    && (!b || `${x.cliente_nome || ''} ${x.nf_numero || ''} ${x.cliente_doc || ''}`.toLowerCase().includes(b)));
  const c = $('#nd-lista', root);
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:62vh"><table><thead><tr><th>Recebido em</th><th>Cliente</th><th>NF-e de origem</th><th class="num">Juros/multa</th><th>Quem recebeu</th><th>Situação</th><th>Nota de débito</th></tr></thead><tbody>
    ${L.map(x => { const nv = nivel(x, D.hoje), d = diasDesde(x.data_recebimento, D.hoje);
      return `<tr class="clickable" data-id="${x.id}"><td>${dateBR(x.data_recebimento)}${x.status === 'pendente' ? `<div class="small ${nv === 'neg' ? 'neg' : 'muted'}">há ${d} dia(s)</div>` : ''}</td><td class="wrap">${esc(x.cliente_nome || '—')}</td>
        <td>${x.nf_numero ? `NF ${x.nf_numero}${x.parcela ? '-' + x.parcela : ''}` : '<span class="badge vencido">sem nota</span>'}${x.nota_id ? '' : x.nf_numero ? ' <span class="small muted">(XML não importado)</span>' : ''}</td>
        <td class="num">${money(x.valor)}</td><td class="small">${ORIGEM[x.origem]}</td><td><span class="badge ${nv === 'neg' ? 'vencido' : BADGE[x.status]}">${STATUS[x.status]}</span></td>
        <td class="small">${x.status === 'emitida' ? `nº ${esc(x.nd_numero || '')} · ${dateBR(x.emitida_em)}` : x.status === 'dispensada' ? esc(x.motivo || '') : ''}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Nenhuma nota de débito nesta situação.</td></tr>'}
  </tbody></table></div></div>`;
  c.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr[data-id]')?.dataset.id; if (id) detalhe(D.nd.find(x => x.id === id), root); };
}

async function detalhe(p, root) {
  let nota = null, itens = [];
  try {
    if (p.nota_id) {
      [nota] = await q(sb.from('nfe_notas').select('id,chave,numero,serie,emissao,dest_nome,dest_doc,dest_uf,v_nf').eq('id', p.nota_id));
      itens = await q(sb.from('nfe_itens').select('n_item,cprod,xprod,ncm,cfop,vprod,vdesc,vfrete,voutro,cst_ibscbs,cclass_trib').eq('nota_id', p.nota_id).order('n_item'));
    }
  } catch (e) { fail(e); }
  const lista = await carregarAliquotas();
  const nd = dadosND(p, nota, itens, lista, state.empresa);
  const ed = podeEditar(), aberta = ['pendente', 'a_decidir'].includes(p.status);
  const m = modal({ title: `Nota de débito — ${p.cliente_nome || 'cliente'} · ${money(p.valor)}`, wide: true, body: `
    <div class="grid2 small">
      <div><strong>Recebimento</strong><br>${dateBR(p.data_recebimento)} · ${money(p.valor)} de juros/multa · ${ORIGEM[p.origem]}${p.motivo ? `<br><span class="muted">${esc(p.motivo)}</span>` : ''}</div>
      <div><strong>NF-e de origem</strong><br>${nota ? `nº ${nota.numero} série ${esc(nota.serie || '')} · ${dateBR(nota.emissao)} · ${money(nota.v_nf)}<br><span class="muted">chave ${esc(nota.chave || '—')}</span>` : `<span class="badge vencido">não encontrada</span> ${p.nf_numero ? `NF ${p.nf_numero}: importe o XML em Notas Fiscais para montar os itens.` : 'Sem NF no título: informe a nota ao emitir.'}`}</div>
    </div>
    ${nd.det.length ? `<h3 style="margin:14px 0 6px">Itens da nota de débito (rateio proporcional aos itens da nota de origem)</h3>
      <div class="table-wrap"><table><thead><tr><th>Item origem</th><th>Produto</th><th>NCM</th><th>CFOP</th><th>CST</th><th>cClassTrib</th><th class="num">Valor</th><th class="num">CBS</th><th class="num">IBS</th></tr></thead><tbody>
      ${nd.det.map(d => `<tr><td>${d.nItem}</td><td class="wrap">${esc(d.cprod || '')} ${esc(d.xprod || '')}</td><td>${esc(d.ncm || '')}</td><td>${esc(d.cfop || '')}</td><td>${esc(d.cst_ibscbs)}</td><td>${esc(d.cclass_trib)}</td><td class="num">${money(d.valor)}</td><td class="num">${money(d.cbs)}</td><td class="num">${money(d.ibs)}</td></tr>`).join('')}
      <tr class="row-sec"><td colspan="6">Total</td><td class="num">${money(nd.total.valor)}</td><td class="num">${money(nd.total.cbs)}</td><td class="num">${money(nd.total.ibs)}</td></tr></tbody></table></div>
      <p class="small muted">Alíquotas de ${nd.aliquotas?.ano} (ano da nota de origem): CBS ${pctBR(nd.aliquotas?.cbs || 0)} e IBS ${pctBR(nd.aliquotas?.ibs || 0)}. Finalidade 6 · tipo de débito 04 · cada item referencia a chave e o item da nota de origem · sem ICMS.</p>
      <p class="small"><strong>Informações complementares:</strong> ${esc(nd.infCpl || '')}</p>` : ''}
    ${p.status === 'emitida' ? `<p><span class="badge pago">Emitida</span> nº ${esc(p.nd_numero || '')} série ${esc(p.nd_serie || '')} em ${dateBR(p.emitida_em)}${p.nd_chave ? ` · chave ${esc(p.nd_chave)}` : ''}</p>` : ''}
    ${ed && aberta ? `<h3 style="margin:14px 0 6px">Informar a emissão</h3><div class="grid2">
      <label>Número<input id="nd-num"></label><label>Série<input id="nd-ser" value="1"></label>
      <label>Data de emissão<input type="date" id="nd-dt" value="${today()}"></label><label>Chave de acesso (44 dígitos)<input id="nd-ch" maxlength="44"></label></div>` : ''}`,
    foot: `<button class="btn" id="nd-cop">Copiar dados para o emissor</button><span class="spacer"></span>
      ${ed && aberta ? `${p.status === 'a_decidir' ? '<button class="btn" id="nd-pend">Passar para "a emitir"</button>' : ''}<button class="btn" id="nd-disp">Dispensar</button><button class="btn primary" id="nd-ok">Marcar como emitida</button>` : ''}
      ${ed && !aberta ? '<button class="btn" id="nd-reab">Reabrir</button>' : ''}<button class="btn" data-close>Fechar</button>` });
  const salvar = async (patch, msg) => { try { await q(sb.from('fiscal_notas_debito').update({ ...patch, atualizado_em: new Date().toISOString() }).eq('id', p.id)); toast(msg); m.close(); await carregar(); pintar(root); } catch (e) { fail(e); } };
  $('#nd-cop', m.el).onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(nd, null, 2)); toast('Dados copiados'); } catch { toast('Não foi possível copiar', true); } };
  $('#nd-ok', m.el) && ($('#nd-ok', m.el).onclick = () => {
    const num = $('#nd-num', m.el).value.trim(), ch = $('#nd-ch', m.el).value.replace(/\D/g, '');
    if (!num) return toast('Informe o número da nota de débito', true);
    if (ch && ch.length !== 44) return toast('A chave de acesso tem 44 dígitos', true);
    salvar({ status: 'emitida', nd_numero: num, nd_serie: $('#nd-ser', m.el).value.trim() || null, nd_chave: ch || null, emitida_em: $('#nd-dt', m.el).value || today(), payload: nd }, 'Nota de débito registrada');
  });
  $('#nd-disp', m.el) && ($('#nd-disp', m.el).onclick = () => {
    const mot = prompt('Motivo da dispensa (ex.: juros recebidos pelo fundo, valor estornado ao cliente):'); if (!mot) return;
    salvar({ status: 'dispensada', motivo: mot }, 'Dispensada');
  });
  $('#nd-pend', m.el) && ($('#nd-pend', m.el).onclick = () => salvar({ status: 'pendente' }, 'Passou para "a emitir"'));
  $('#nd-reab', m.el) && ($('#nd-reab', m.el).onclick = () => salvar({ status: p.origem === 'fidc' ? 'a_decidir' : 'pendente', nd_numero: null, nd_serie: null, nd_chave: null, emitida_em: null }, 'Reaberta'));
}

// juros recebidos sem passar pela conciliação ou pelo importador: lança 1.02.17 ligado ao título (a pendência nasce sozinha)
async function registrar(root) {
  await loadCadastros();
  const c = state.cad, plano = c.contasPlano.find(p => p.codigo === PLANO_JUROS);
  if (!plano) return toast(`Cadastre a conta ${PLANO_JUROS} JUROS E MULTAS RECEBIDOS no plano de contas`, true);
  const m = modal({ title: 'Registrar juros/multa recebidos', body: `
    <label>Título recebido (NF-parcela)<input id="rj-doc" placeholder="ex.: 36138-2"></label><div id="rj-tit" class="small muted" style="margin:4px 0 8px"></div>
    <div class="grid2"><label>Data do recebimento<input type="date" id="rj-dt" value="${today()}"></label><label>Juros/multa recebidos (R$)<input type="number" step="0.01" id="rj-v"></label>
    <label>Conta<select id="rj-conta">${c.contas.filter(x => x.ativo !== false).map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label></div>
    <p class="small muted">Cria o lançamento em ${PLANO_JUROS} (Pago) ligado ao título; a nota de débito entra na fila sozinha. O título continua com o valor de face.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rj-ok" disabled>Registrar</button>' });
  let tit = null, tm;
  $('#rj-doc', m.el).oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => {
    const doc = e.target.value.trim(); tit = null; $('#rj-ok', m.el).disabled = true; if (doc.length < 4) { $('#rj-tit', m.el).textContent = ''; return; }
    const r = await q(sb.from('lancamentos').select('id,documento,valor,data,status,favorecido_id,conta_id').eq('empresa_id', state.empresa.id).ilike('documento', doc.replace(/[-/]0*/, '%')).limit(5)).catch(() => []);
    tit = r.find(x => x.documento === doc) || r[0] || null;
    $('#rj-tit', m.el).innerHTML = tit ? `Título ${esc(tit.documento)} · ${esc(c.favById[tit.favorecido_id]?.nome || '')} · ${money(tit.valor)} · ${tit.status} em ${dateBR(tit.data)}` : '<span class="neg">Título não encontrado</span>';
    if (tit) { $('#rj-ok', m.el).disabled = false; if (tit.conta_id) $('#rj-conta', m.el).value = tit.conta_id; }
  }, 300); };
  $('#rj-ok', m.el).onclick = async () => {
    const v = +$('#rj-v', m.el).value; if (!(v > 0)) return toast('Informe o valor dos juros/multa', true);
    try {
      await q(sb.from('lancamentos').insert({ empresa_id: state.empresa.id, data: $('#rj-dt', m.el).value, plano_id: plano.id, status: 'Pago', valor: v, conta_id: $('#rj-conta', m.el).value,
        favorecido_id: tit.favorecido_id, documento: tit.documento, descricao: `Juros/multa recebidos — título ${tit.documento}`, juros_de: tit.id, origem: `juros:${tit.id}:${Date.now()}` }));
      toast('Juros registrados; nota de débito na fila'); m.close(); await carregar(); pintar(root);
    } catch (e) { fail(e); }
  };
}

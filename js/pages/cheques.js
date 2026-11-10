// Financeiro › Cheques (FIN025, SQL 154): controle dos cheques de terceiros (recebidos de clientes: carteira, depósito,
// compensação, devolução, reapresentação, resgate, cobrança, perda, repasse a fornecedor e envio ao FIDC pela Proposta de
// Borderô) e dos cheques próprios (talões, emissão ligada aos títulos a pagar, compensação, cancelamento e sustação).
// O dinheiro anda por duas contas de cheques (em carteira e emitidos a compensar); toda movimentação é feita por função do banco.
// Pedido do Renan em 10/11/2026.
import { sb, state, q, fetchAll, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, dateBR, today, options, parseNum, exportXLSX, confirmDialog } from '../lib/ui.js';
import { kpiGrid } from '../lib/componentes.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { lerCMC7, ALINEAS, alineaTexto, rotuloSituacao, tomSituacao, prazos, proximoPasso, historicoEmitentes, riscoEmitente, alertas, agenda, folhasTalao, valorPorExtenso, validarRecebimento } from '../lib/cheques.js';

export const title = 'Cheques';
const ui = { aba: 'carteira', sel: new Set(), busca: '' };
const pode = () => ['admin', 'financeiro'].includes(state.papel);
const ABAS = [['carteira', 'Em carteira'], ['depositos', 'Depósitos'], ['devolvidos', 'Devolvidos'], ['fora', 'FIDC e repasses'], ['emitidos', 'Emitidos (próprios)'], ['agenda', 'Agenda'], ['emitentes', 'Emitentes'], ['todos', 'Todos']];
const CSS = `<style>
  .cq-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
  .cq-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.cq-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .cq-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.cq-sel.muted{background:var(--surface-2);color:var(--muted)}
  .cq-sel.info{background:var(--primary-soft);color:var(--primary)}
  .cq-kpis{grid-template-columns:repeat(6,minmax(0,1fr))!important}@media(max-width:1100px){.cq-kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
  .cq-al{border-left:4px solid var(--warn);margin-bottom:12px}.cq-al.alto{border-left-color:var(--neg)}
  .cq-al li{margin:3px 0}.cq-al ul{margin:6px 0 0;padding-left:18px}
  .cq-linha{display:grid;grid-template-columns:64px 70px 96px 92px 112px 128px 1fr 132px 34px;gap:6px;align-items:end;margin-bottom:6px}
  .cq-linha input{min-width:0}.cq-linha label{font-size:11px}
  @media(max-width:900px){.cq-linha{grid-template-columns:repeat(3,minmax(0,1fr))}}
  .cq-tits{max-height:190px;overflow:auto;border:1px solid var(--border);border-radius:10px}
  .cq-tits label{display:flex;gap:8px;align-items:center;padding:7px 10px;border-top:1px solid var(--border);font-weight:400;font-size:13px;flex-direction:row}.cq-tits label:first-child{border-top:0}
  .cq-tits input{width:auto;min-height:0}.cq-tits span.v{margin-left:auto;font-variant-numeric:tabular-nums}
  .cq-soma{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0;font-size:13px}.cq-soma div{border:1px solid var(--border);border-radius:8px;padding:8px}.cq-soma span{display:block;color:var(--muted);font-size:11.5px}
  .cq-hist{border-left:2px solid var(--border);margin:6px 0 0 6px;padding-left:12px}.cq-hist div{margin:6px 0;font-size:13px}
  .cq-ag{display:grid;grid-template-columns:92px 1fr 110px 110px 120px;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--border);font-size:13px}.cq-ag:first-child{border-top:0}
  .cq-ag .b{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--surface-2)}.cq-ag .b i{display:block;height:100%}
  .cq-tal{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
  .cq-tal .t{border:1px solid var(--border);border-radius:10px;padding:10px 12px}.cq-tal .p{height:8px;border-radius:4px;background:var(--surface-2);overflow:hidden;margin:6px 0}.cq-tal .p i{display:block;height:100%;background:var(--primary)}
  .modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;font-size:13px}.modal label.chk input{width:auto;min-height:0}
</style>`;
const sel = (s) => `<span class="cq-sel ${tomSituacao(s)}">${esc(rotuloSituacao(s))}</span>`;
const soma = (L) => L.reduce((s, x) => s + +x.valor, 0);
const addMes = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

async function dados(e) {
  const [Cf, Ch, Dp, Em, Tl] = await Promise.all([
    q(sb.from('chq_config').select('*').eq('empresa_id', e)),
    fetchAll(() => sb.from('chq_cheques').select('*').eq('empresa_id', e).order('bom_para')),
    q(sb.from('chq_depositos').select('*').eq('empresa_id', e).order('numero', { ascending: false }).limit(200)),
    fetchAll(() => sb.from('chq_emitidos').select('*').eq('empresa_id', e).order('emissao', { ascending: false })),
    q(sb.from('chq_taloes').select('*').eq('empresa_id', e).order('numero_ini')),
  ]);
  return { cfg: Cf[0] || null, Ch, Dp, Em, Tl };
}

/** alertas para a Central de Decisões (regra 28) */
export async function alertasDecisao() {
  try {
    const D = await dados(state.empresa.id);
    if (!D.cfg) return [];
    return alertas({ cheques: D.Ch, emitidos: D.Em, cfg: D.cfg, hoje: today() });
  } catch { return []; }
}

export async function render(root) {
  const e = state.empresa.id, hoje = today();
  const prm = new URLSearchParams(location.hash.split('?')[1] || '');
  if (ABAS.some(a => a[0] === prm.get('aba'))) ui.aba = prm.get('aba');
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Cheques</h2><div class="muted small">Cheques de clientes e cheques próprios, do recebimento à compensação.</div></div>
      <div class="pi-acoes" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap"><button class="btn ghost" id="cq-xls">Excel</button>${pode() ? '<button class="btn ghost" id="cq-par">Parâmetros</button><button class="btn ghost" id="cq-emi">Emitir cheque</button><button class="btn primary" id="cq-rec">Receber cheques</button>' : ''}</div></div>
    <div id="cq-corpo"><div class="loading">Carregando…</div></div>`;
  let D;
  try { await loadCadastros(); D = await dados(e); }
  catch (err) { fail(err); $('#cq-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 154 (cheques) já foi executado.</div></div>'; return; }
  const re = () => render(root), corpo = $('#cq-corpo', root), c = state.cad, cfg = D.cfg;
  const fav = (id) => c.favById[id]?.nome || '', conta = (id) => c.contaById[id]?.nome || '';
  const bancos = () => c.contas.filter(x => x.tipo !== 'Cheques' && x.id !== cfg?.conta_carteira_id && x.id !== cfg?.conta_emitidos_id && x.ativo !== false);
  const ctx = { e, D, cfg, re, fav, conta, bancos, hoje };
  $('#cq-par', root) && ($('#cq-par', root).onclick = () => parametros(ctx));
  if (!cfg?.conta_carteira_id || !cfg?.plano_transferencia_id) {
    corpo.innerHTML = `<div class="card"><h2 style="margin-top:0">Primeiro passo: configurar</h2>
      <p>O controle usa duas contas de movimento: <b>Cheques em carteira</b> (cheques de clientes que ainda não viraram dinheiro no banco) e <b>Cheques emitidos a compensar</b> (cheques próprios entregues e ainda não debitados). O botão abaixo cria as duas e sugere as contas do plano; depois você confere tudo em Parâmetros.</p>
      ${pode() ? '<button class="btn primary" id="cq-cfg">Configurar padrão</button>' : '<p class="muted">Peça ao financeiro ou ao administrador para configurar.</p>'}</div>`;
    $('#cq-cfg', corpo) && ($('#cq-cfg', corpo).onclick = async (ev) => { ev.target.disabled = true;
      try { await q(sb.rpc('chq_configurar_padrao', { p_empresa: e })); await loadCadastros(true); toast('Contas criadas. Confira os Parâmetros.'); await render(root); parametros({ ...ctx, cfg: (await dados(e)).cfg, re: () => render(root) }); } catch (err) { fail(err); ev.target.disabled = false; } });
    ['#cq-rec', '#cq-emi'].forEach(s => $(s, root) && ($(s, root).disabled = true));
    return;
  }
  $('#cq-rec', root) && ($('#cq-rec', root).onclick = () => receber(ctx));
  $('#cq-emi', root) && ($('#cq-emi', root).onclick = () => emitir(ctx));
  const ativos = D.Ch.filter(x => x.situacao !== 'cancelado');
  const cart = ativos.filter(x => x.situacao === 'carteira'), prontos = cart.filter(x => x.bom_para <= hoje), dep = ativos.filter(x => x.situacao === 'depositado'),
    dev = ativos.filter(x => x.situacao === 'devolvido'), fidc = ativos.filter(x => x.situacao === 'fidc'), rep = ativos.filter(x => x.situacao === 'repassado'),
    emAb = D.Em.filter(x => x.situacao === 'emitido' && +x.valor > 0);
  const AL = alertas({ cheques: D.Ch, emitidos: D.Em, cfg, hoje });
  const passo = (x) => { const p = proximoPasso(x, cfg, hoje); return p.texto ? `<div class="small ${p.tom === 'neg' ? 'neg' : 'muted'}">${esc(p.texto)}</div>` : ''; };
  const linhaCh = (x, { marca = false, acoes = '' } = {}) => `<tr>${marca ? `<td><input type="checkbox" data-s="${x.id}" ${ui.sel.has(x.id) ? 'checked' : ''} style="width:auto;min-height:0"></td>` : ''}
    <td><a href="#" data-d="${x.id}"><b>${esc(x.numero)}</b></a><div class="small muted">bco ${esc(x.banco)}${x.agencia ? ' · ag ' + esc(x.agencia) : ''}${x.conta ? ' · cc ' + esc(x.conta) : ''}</div></td>
    <td class="wrap">${esc(fav(x.favorecido_id) || '—')}${x.emitente && x.emitente !== fav(x.favorecido_id) ? `<div class="small muted">emitente: ${esc(x.emitente)}</div>` : ''}</td>
    <td>${dateBR(x.bom_para)}<div class="small muted">recebido ${dateBR(x.recebido_em)}</div></td><td class="num">${money(x.valor)}</td>
    <td>${sel(x.situacao)}${x.situacao === 'devolvido' ? `<div class="small neg">${esc(alineaTexto(x.alinea))}${+x.devolucoes > 1 ? ` · ${x.devolucoes}ª vez` : ''}</div>` : ''}${x.situacao === 'fidc' ? `<div class="small muted">${esc(x.fundo || '')}</div>` : ''}${x.situacao === 'repassado' ? `<div class="small muted">${esc(fav(x.repasse_favorecido_id))}</div>` : ''}${x.situacao === 'depositado' ? `<div class="small muted">${esc(conta(x.conta_deposito_id))}</div>` : ''}${passo(x)}</td>
    <td style="white-space:nowrap">${acoes}</td></tr>`;
  const tabCh = (L, o = {}) => `<div class="card flush"><div class="table-wrap"><table id="cq-tab"><thead><tr>${o.marca ? '<th style="width:28px"><input type="checkbox" id="cq-todos" style="width:auto;min-height:0"></th>' : ''}<th>Cheque</th><th>Cliente</th><th>Bom para</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
    ${L.map(x => linhaCh(x, { marca: o.marca, acoes: o.acoes ? o.acoes(x) : '' })).join('') || `<tr><td colspan="${o.marca ? 7 : 6}" class="empty">${o.vazio || 'Nenhum cheque aqui.'}</td></tr>`}</tbody>
    ${L.length ? `<tfoot><tr><td colspan="${o.marca ? 4 : 3}"><b>${L.length} cheque(s)</b></td><td class="num"><b>${money(soma(L))}</b></td><td colspan="2"></td></tr></tfoot>` : ''}</table></div></div>`;
  const filtra = (L) => { const b = ui.busca.trim().toLowerCase(); return !b ? L : L.filter(x => [x.numero, x.banco, x.emitente, x.emitente_doc, fav(x.favorecido_id), x.fundo, String(x.valor)].some(v => String(v || '').toLowerCase().includes(b))); };
  const bt = (k, id, t, cl = 'ghost') => pode() ? `<button class="btn ${cl} small" data-a="${k}" data-id="${id}">${t}</button> ` : '';

  const abasHtml = {
    carteira: () => `${pode() ? `<div class="card toolbar" style="margin-bottom:12px"><span class="small muted" id="cq-ns">Marque os cheques e escolha o destino.</span><span class="spacer"></span>
        <button class="btn" id="cq-dep">Depositar</button><button class="btn ghost" id="cq-rep">Repassar a fornecedor</button><a class="btn ghost" href="#/fidc-propostas">Enviar ao FIDC</a></div>` : ''}
      ${tabCh(filtra(cart), { marca: pode(), vazio: 'Nenhum cheque em carteira. Use "Receber cheques".' })}
      <p class="small muted">O título do cliente já está baixado na conta ${esc(conta(cfg.conta_carteira_id))}. Para enviar ao FIDC, abra a Proposta de Borderô: os cheques em carteira aparecem junto com os títulos.</p>`,
    depositos: () => `${tabCh(filtra(dep), { vazio: 'Nenhum cheque depositado aguardando compensação.', acoes: (x) => bt('comp', x.id, 'Compensou', 'primary') + bt('dev', x.id, 'Devolvido') })}
      <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Depósito</th><th>Data</th><th>Conta</th><th class="num">Cheques</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${D.Dp.map(d => { const ab = D.Ch.filter(x => x.deposito_id === d.id && x.situacao === 'depositado').length; return `<tr><td><b>nº ${d.numero}</b></td><td>${dateBR(d.data)}</td><td>${esc(conta(d.conta_id))}</td><td class="num">${d.qtd}${ab ? `<div class="small muted">${ab} a compensar</div>` : ''}</td><td class="num">${money(d.valor)}</td>
        <td style="white-space:nowrap"><button class="btn ghost small" data-a="bord" data-id="${d.id}">Borderô</button> ${ab ? bt('compdep', d.id, 'Compensar todos') : ''}${ab === d.qtd ? bt('candep', d.id, 'Cancelar') : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Nenhum depósito ainda.</td></tr>'}</tbody></table></div></div>`,
    devolvidos: () => `${tabCh(filtra(dev), { vazio: 'Nenhum cheque devolvido em aberto.', acoes: (x) => (proximoPasso(x, cfg, hoje).k === 'reapresentar' ? bt('reap', x.id, 'Reapresentar') : '') + bt('resg', x.id, 'Cliente pagou', 'primary') + bt('cob', x.id, 'Cobrança') + bt('perda', x.id, 'Perda') })}
      <p class="small muted"><b>Cliente pagou</b>: o cliente quitou o cheque (PIX, dinheiro) e levou o cheque. <b>Cobrança</b>: tira o cheque da carteira e abre um título a receber contra o cliente (aparece em Contas a Receber e na Cobrança). <b>Perda</b>: baixa definitiva.</p>
      ${ativos.some(x => x.situacao === 'cobranca') ? `<h3>Em cobrança</h3>${tabCh(filtra(ativos.filter(x => x.situacao === 'cobranca')), { acoes: (x) => x.lanc_cobranca_id ? `<a class="btn ghost small" href="#/lancamentos?abrir=${x.lanc_cobranca_id}">Abrir o título</a>` : '' })}` : ''}`,
    fora: () => `<h3 style="margin-top:0">No FIDC</h3>${tabCh(filtra(fidc), { vazio: 'Nenhum cheque em fundo.', acoes: (x) => bt('comp', x.id, 'Liquidado', 'primary') + bt('dev', x.id, 'Devolvido pelo fundo') })}
      <h3>Repassados a fornecedor</h3>${tabCh(filtra(rep), { vazio: 'Nenhum cheque repassado em aberto.', acoes: (x) => bt('comp', x.id, 'Compensou', 'primary') + bt('dev', x.id, 'Voltou') })}
      <p class="small muted">Cheque devolvido pelo fundo volta para a carteira como devolvido; a recompra cobrada pelo fundo continua sendo registrada em Crédito / FIDC, como hoje.</p>`,
    emitidos: () => {
      const b = ui.busca.trim().toLowerCase(), L = D.Em.filter(x => !b || [String(x.numero), x.nominal, fav(x.favorecido_id), conta(x.conta_id), String(x.valor)].some(v => String(v || '').toLowerCase().includes(b)));
      return `<div class="cq-tal" style="margin-bottom:12px">${D.Tl.map(t => { const f = folhasTalao(t, D.Em); return `<div class="t"><b>${esc(conta(t.conta_id))}</b>${t.ativo ? '' : ' <span class="cq-sel muted">inativo</span>'}<div class="small muted">folhas ${t.numero_ini} a ${t.numero_fim}</div>
          <div class="p"><i style="width:${(f.usadas / f.total * 100).toFixed(0)}%"></i></div><div class="small">${f.livres} livre(s) de ${f.total}${f.proxima ? ` · próxima <b>${f.proxima}</b>` : ' · <span class="neg">talão esgotado</span>'}</div>
          ${pode() ? `<div style="margin-top:6px"><button class="btn ghost small" data-a="inut" data-id="${t.id}">Inutilizar folha</button> <button class="btn ghost small" data-a="talat" data-id="${t.id}">${t.ativo ? 'Desativar' : 'Ativar'}</button></div>` : ''}</div>`; }).join('')}
        ${pode() ? '<div class="t" style="display:flex;align-items:center;justify-content:center;border-style:dashed"><button class="btn ghost" id="cq-ntal">+ Cadastrar talão</button></div>' : ''}</div>
      <div class="card flush"><div class="table-wrap"><table id="cq-tab"><thead><tr><th>Cheque</th><th>Favorecido</th><th>Emissão</th><th>Bom para</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
      ${L.map(x => `<tr><td><a href="#" data-de="${x.id}"><b>${x.numero}</b></a><div class="small muted">${esc(conta(x.conta_id))}</div></td><td class="wrap">${esc(fav(x.favorecido_id) || x.nominal || '—')}${x.observacao ? `<div class="small muted">${esc(x.observacao)}</div>` : ''}</td>
        <td>${dateBR(x.emissao)}</td><td>${dateBR(x.bom_para)}${x.situacao === 'emitido' && x.bom_para < hoje ? '<div class="small muted">já pode ter sido apresentado</div>' : ''}</td><td class="num">${+x.valor ? money(x.valor) : '—'}</td>
        <td>${sel(x.situacao)}${x.situacao === 'compensado' ? `<div class="small muted">${dateBR(x.compensado_em)}</div>` : ''}${x.situacao === 'devolvido' ? `<div class="small neg">${esc(alineaTexto(x.alinea))}</div>` : ''}${x.motivo ? `<div class="small muted">${esc(x.motivo)}</div>` : ''}</td>
        <td style="white-space:nowrap">${+x.valor ? `<button class="btn ghost small" data-a="copia" data-id="${x.id}">Cópia</button> ` : ''}${['emitido', 'devolvido'].includes(x.situacao) ? bt('ecomp', x.id, 'Compensou', 'primary') + (x.situacao === 'emitido' ? bt('edev', x.id, 'Devolvido') : '') + bt('ecan', x.id, 'Cancelar') : ''}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Nenhum cheque próprio emitido.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">Ao emitir, o título do fornecedor é baixado na conta ${esc(conta(cfg.conta_emitidos_id))}; o saldo do banco só cai quando você marca <b>Compensou</b> (a data do débito no extrato).</p>`; },
    agenda: () => { const G = agenda({ cheques: D.Ch, emitidos: D.Em, hoje, dias: 60 }), max = Math.max(1, ...G.map(x => Math.max(x.entra, x.sai)));
      return `<div class="card"><h2 style="margin-top:0">Agenda de compensação — próximos 60 dias</h2>
        <div class="small muted" style="margin-bottom:8px">Entradas: cheques de clientes em carteira e depositados, pela data "bom para". Saídas: cheques próprios a compensar. Os atrasados aparecem em hoje.</div>
        ${G.length ? `<div class="cq-ag small muted" style="border:0"><span>Dia</span><span></span><span class="num">Entra</span><span class="num">Sai</span><span class="num">Acumulado</span></div>` + G.map(x => `<div class="cq-ag"><span><b>${dateBR(x.data).slice(0, 5)}</b>${x.data === hoje ? ' <span class="small muted">hoje</span>' : ''}</span>
          <span><span class="b"><i style="width:${(x.entra / max * 50).toFixed(1)}%;background:var(--pos)"></i><i style="width:${(x.sai / max * 50).toFixed(1)}%;background:var(--neg)"></i></span><span class="small muted">${x.itens.map(i => `${i.tipo === 'sai' ? '−' : '+'} nº ${esc(i.numero)}`).slice(0, 8).join(' · ')}${x.itens.length > 8 ? ' …' : ''}</span></span>
          <span class="num pos">${x.entra ? money(x.entra) : ''}</span><span class="num neg">${x.sai ? money(x.sai) : ''}</span><span class="num ${x.acumulado < 0 ? 'neg' : ''}"><b>${money(x.acumulado)}</b></span></div>`).join('') : '<div class="empty">Nada a compensar nos próximos 60 dias.</div>'}</div>
        <p class="small muted">Esta agenda completa a Necessidade de Caixa: como o título é baixado quando o cheque é recebido ou emitido, é aqui que você vê quando o dinheiro realmente entra e sai do banco.</p>`; },
    emitentes: () => { const H = historicoEmitentes(D.Ch), lim = +cfg.alerta_devolucoes || 1;
      return `<div class="card flush"><div class="table-wrap"><table id="cq-tab"><thead><tr><th>Emitente</th><th class="num">Cheques</th><th class="num">Valor</th><th class="num">Devolvidos</th><th class="num">Taxa</th><th class="num">Em aberto</th><th class="num">Perdas</th></tr></thead><tbody>
        ${H.map(h => `<tr><td class="wrap">${esc(h.emitente || fav(h.favorecido_id) || '—')}${h.doc ? `<div class="small muted">${esc(h.doc)}</div>` : ''}</td><td class="num">${h.qtd}</td><td class="num">${money(h.valor)}</td>
          <td class="num">${h.devolvidos ? `${h.devolvidos} · ${money(h.valorDevolvido)}` : '—'}</td><td class="num"><span class="cq-sel ${h.devolvidos >= lim ? 'neg' : 'muted'}">${(h.taxa * 100).toFixed(0)}%</span></td><td class="num">${money(h.aberto)}</td><td class="num">${h.perdas ? money(h.perdas) : '—'}</td></tr>`).join('')
          || '<tr><td colspan="7" class="empty">Sem histórico ainda.</td></tr>'}</tbody></table></div></div>
        <p class="small muted">Agrupado pelo CPF/CNPJ do emitente do cheque (ou pelo cliente, quando o documento não foi informado). Quem já teve ${lim} devolução(ões) acende o aviso na hora de receber um novo cheque.</p>`; },
    todos: () => tabCh(filtra(D.Ch).slice().sort((a, b) => b.recebido_em.localeCompare(a.recebido_em)).slice(0, 500), { acoes: (x) => x.situacao === 'compensado' && x.conta_deposito_id && !x.fundo && !x.repasse_favorecido_id ? bt('dev', x.id, 'Voltou') : '' }),
  };

  const pintar = () => {
    corpo.innerHTML = `${AL.length ? `<div class="card cq-al ${AL.some(a => a.nivel === 'alto') ? 'alto' : ''}"><b>Atenção</b><ul>${AL.map(a => `<li>${esc(a.titulo)} — <b>${money(a.valor)}</b>${a.detalhe ? ` <span class="small muted">${esc(a.detalhe)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      <div id="cq-kpis"></div>
      <div class="card toolbar" style="margin:12px 0"><div class="chips" id="cq-abas">${ABAS.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div><span class="spacer"></span>
        <label>Buscar<input id="cq-b" value="${esc(ui.busca)}" placeholder="nº, cliente, emitente, valor" style="min-width:210px"></label></div>
      <div id="cq-aba">${abasHtml[ui.aba]()}</div>`;
    $('#cq-kpis', corpo).classList.add('cq-kpis');
    kpiGrid($('#cq-kpis', corpo), [
      { id: 'carteira', label: 'Em carteira', valor: money(soma(cart)), sub: `${cart.length} cheque(s)` },
      { id: 'carteira2', label: 'Prontos para depositar', valor: money(soma(prontos)), sub: `${prontos.length} já no "bom para"`, tom: prontos.length ? 'pos' : '' },
      { id: 'depositos', label: 'Depositados a compensar', valor: money(soma(dep)), sub: `${dep.length} cheque(s)`, tom: dep.length ? 'warn' : '' },
      { id: 'devolvidos', label: 'Devolvidos', valor: money(soma(dev)), sub: `${dev.length} aguardando ação`, tom: dev.length ? 'neg' : '' },
      { id: 'fora', label: 'No FIDC e repassados', valor: money(soma(fidc) + soma(rep)), sub: `${fidc.length} no fundo · ${rep.length} repassado(s)` },
      { id: 'emitidos', label: 'Próprios a compensar', valor: money(soma(emAb)), sub: `${emAb.length} cheque(s) emitido(s)`, tom: emAb.length ? 'warn' : '' },
    ], (id) => { ui.aba = id === 'carteira2' ? 'carteira' : id; pintar(); });
    $('#cq-abas', corpo).onclick = (ev) => { const f = ev.target.closest('[data-f]')?.dataset.f; if (f) { ui.aba = f; ui.sel.clear(); pintar(); } };
    $('#cq-b', corpo).oninput = (ev) => { ui.busca = ev.target.value; clearTimeout(pintar._t); pintar._t = setTimeout(() => { $('#cq-aba', corpo).innerHTML = abasHtml[ui.aba](); ligar(); $('#cq-b', corpo).focus(); }, 250); };
    ligar();
  };
  const marcados = () => D.Ch.filter(x => ui.sel.has(x.id) && x.situacao === 'carteira');
  const ligar = () => {
    const ns = () => { const M = marcados(); $('#cq-ns', corpo) && ($('#cq-ns', corpo).innerHTML = M.length ? `<b>${M.length}</b> cheque(s) marcado(s) · <b>${money(soma(M))}</b>` : 'Marque os cheques e escolha o destino.'); };
    $$('[data-s]', corpo).forEach(i => i.onchange = () => { i.checked ? ui.sel.add(i.dataset.s) : ui.sel.delete(i.dataset.s); ns(); });
    $('#cq-todos', corpo) && ($('#cq-todos', corpo).onchange = (ev) => { $$('[data-s]', corpo).forEach(i => { i.checked = ev.target.checked; i.checked ? ui.sel.add(i.dataset.s) : ui.sel.delete(i.dataset.s); }); ns(); });
    ns();
    $('#cq-dep', corpo) && ($('#cq-dep', corpo).onclick = () => { const M = marcados(); if (!M.length) return toast('Marque os cheques', true); depositar(ctx, M); });
    $('#cq-rep', corpo) && ($('#cq-rep', corpo).onclick = () => { const M = marcados(); if (!M.length) return toast('Marque os cheques', true); repassar(ctx, M); });
    $('#cq-ntal', corpo) && ($('#cq-ntal', corpo).onclick = () => novoTalao(ctx));
    $$('[data-d]', corpo).forEach(a => a.onclick = (ev) => { ev.preventDefault(); detalhe(ctx, D.Ch.find(x => x.id === a.dataset.d)); });
    $$('[data-de]', corpo).forEach(a => a.onclick = (ev) => { ev.preventDefault(); detalheEmitido(ctx, D.Em.find(x => x.id === a.dataset.de)); });
    $$('[data-a]', corpo).forEach(b => b.onclick = () => acao(ctx, b.dataset.a, b.dataset.id));
  };
  $('#cq-xls', root).onclick = () => $('#cq-tab', root) ? exportXLSX($('#cq-tab', root), 'cheques-' + ui.aba) : toast('Esta aba não tem tabela para exportar', true);
  pintar();
}

// ---------------------------------------------------------------- ações rápidas
const rpc = async (nome, args, ok, re, m) => { try { await q(sb.rpc(nome, args)); toast(ok); m?.close(); ui.sel.clear(); re(); } catch (err) { fail(err); throw err; } };
/** pequeno formulário em modal: campos [{k, t, type, value, html}], devolve os valores no onOk */
function form({ titulo, texto = '', campos, botao = 'Confirmar', onOk, wide = false }) {
  const m = modal({ title: titulo, narrow: !wide, wide, body: `${texto ? `<p class="small muted" style="margin-top:0">${texto}</p>` : ''}<div class="form-grid" style="display:grid;gap:10px">${campos.map(f => f.html || `<label>${esc(f.t)}${f.type === 'select'
      ? `<select id="f-${f.k}">${f.options}</select>` : f.type === 'textarea' ? `<textarea id="f-${f.k}" rows="2">${esc(f.value || '')}</textarea>` : `<input id="f-${f.k}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`}</label>`).join('')}</div>`,
    foot: `<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="f-ok">${esc(botao)}</button>` });
  $('#f-ok', m.el).onclick = async (ev) => { const v = {}; campos.forEach(f => { if (!f.html) v[f.k] = $('#f-' + f.k, m.el).value; }); ev.target.disabled = true; try { await onOk(v, m); } catch { ev.target.disabled = false; } };
  return m;
}
const optAlineas = (s = '11') => ALINEAS.map(a => `<option value="${a[0]}" ${a[0] === s ? 'selected' : ''}>${a[0]} — ${esc(a[1])}</option>`).join('');

async function acao(ctx, k, id) {
  const { e, D, cfg, re, bancos, hoje, conta } = ctx, ch = D.Ch.find(x => x.id === id), em = D.Em.find(x => x.id === id);
  if (k === 'comp') return form({ titulo: `Cheque nº ${ch.numero} compensado`, texto: ch.situacao === 'fidc' ? 'O fundo recebeu o cheque. Nada muda no caixa: só encerra o cheque.' : 'Confirme a data em que o cheque compensou. Nada muda no caixa (o depósito já entrou no banco).',
    campos: [{ k: 'data', t: 'Data', type: 'date', value: hoje }], onOk: (v, m) => rpc('chq_compensar', { p_ids: [id], p_data: v.data }, 'Cheque compensado', re, m) });
  if (k === 'compdep') { const ids = D.Ch.filter(x => x.deposito_id === id && x.situacao === 'depositado').map(x => x.id);
    return form({ titulo: 'Compensar todos os cheques do depósito', texto: `${ids.length} cheque(s) ainda a compensar. Se algum voltou, marque-o como devolvido antes.`, campos: [{ k: 'data', t: 'Data', type: 'date', value: hoje }], onOk: (v, m) => rpc('chq_compensar', { p_ids: ids, p_data: v.data }, 'Cheques compensados', re, m) }); }
  if (k === 'candep') { if (await confirmDialog('Cancelar este depósito? Os cheques voltam para a carteira e a transferência é apagada.')) rpc('chq_deposito_cancelar', { p_deposito: id }, 'Depósito cancelado', re).catch(() => {}); return; }
  if (k === 'bord') return bordero(ctx, D.Dp.find(d => d.id === id));
  if (k === 'dev') return form({ titulo: `Cheque nº ${ch.numero} devolvido`, texto: ch.situacao === 'fidc' ? `Devolvido pelo ${esc(ch.fundo || 'fundo')}: o cheque volta para a carteira como devolvido. A recompra cobrada pelo fundo é registrada em Crédito / FIDC.` : ch.situacao === 'repassado' ? 'O fornecedor devolveu o cheque: ele volta para a carteira e a dívida com o fornecedor reabre como título a pagar.' : `O valor sai de ${esc(conta(ch.conta_deposito_id))} e volta para a carteira.`,
    campos: [{ k: 'data', t: 'Data da devolução', type: 'date', value: hoje }, { k: 'alinea', t: 'Motivo (alínea)', type: 'select', options: optAlineas(+ch.devolucoes ? '12' : '11') }, ...(ch.situacao === 'depositado' || ch.situacao === 'compensado' ? [{ k: 'tarifa', t: 'Tarifa de devolução cobrada pelo banco (opcional)', value: '' }] : [])],
    onOk: (v, m) => { if (parseNum(v.tarifa || '0') > 0 && !cfg.plano_tarifa_id) { toast('Defina a conta do plano da tarifa nos Parâmetros', true); return Promise.reject(); } return rpc('chq_devolver', { p_id: id, p_data: v.data, p_alinea: v.alinea, p_tarifa: parseNum(v.tarifa || '0') || 0 }, 'Devolução registrada', re, m); } });
  if (k === 'reap') return depositar(ctx, [ch]);
  if (k === 'resg') return form({ titulo: `Cliente pagou o cheque nº ${ch.numero}`, texto: `O cliente quitou ${money(ch.valor)} por outro meio e leva o cheque.`, campos: [{ k: 'data', t: 'Data', type: 'date', value: hoje }, { k: 'conta', t: 'Conta em que o dinheiro entrou', type: 'select', options: options(bancos(), { empty: 'Escolha' }) }, { k: 'juros', t: 'Juros e multa recebidos (opcional)', value: '' }],
    onOk: (v, m) => { if (!v.conta) { toast('Escolha a conta', true); return Promise.reject(); } return rpc('chq_resgatar', { p_id: id, p_conta: v.conta, p_data: v.data, p_juros: parseNum(v.juros || '0') || 0 }, 'Resgate registrado', re, m); } });
  if (k === 'cob') return form({ titulo: `Enviar o cheque nº ${ch.numero} para cobrança`, texto: 'O cheque sai da carteira e abre um título a receber contra o cliente, que segue a régua da Cobrança.', campos: [{ k: 'data', t: 'Data', type: 'date', value: hoje }, { k: 'venc', t: 'Vencimento do título', type: 'date', value: hoje }],
    onOk: (v, m) => rpc('chq_cobrar', { p_id: id, p_data: v.data, p_vencimento: v.venc }, 'Título de cobrança aberto', re, m) });
  if (k === 'perda') return form({ titulo: `Baixar o cheque nº ${ch.numero} como perda`, texto: `Baixa definitiva de ${money(ch.valor)}. Use quando não há mais como receber.`, campos: [{ k: 'data', t: 'Data', type: 'date', value: hoje }, { k: 'motivo', t: 'Motivo', type: 'textarea' }], botao: 'Baixar como perda',
    onOk: (v, m) => rpc('chq_perda', { p_id: id, p_data: v.data, p_motivo: v.motivo }, 'Perda registrada', re, m) });
  if (k === 'ecomp') return form({ titulo: `Cheque próprio nº ${em.numero} compensado`, texto: `${money(em.valor)} saem de ${esc(conta(em.conta_id))} na data informada (a do débito no extrato).`, campos: [{ k: 'data', t: 'Data do débito', type: 'date', value: em.bom_para > hoje ? hoje : em.bom_para }],
    onOk: (v, m) => rpc('chq_emitido_compensar', { p_id: id, p_data: v.data }, 'Cheque compensado', re, m) });
  if (k === 'edev') return form({ titulo: `Cheque próprio nº ${em.numero} devolvido`, texto: 'Registra a devolução. O título continua baixado: depois, marque como compensado (reapresentado e pago) ou cancele o cheque para reabrir o título.', campos: [{ k: 'data', t: 'Data', type: 'date', value: hoje }, { k: 'alinea', t: 'Motivo (alínea)', type: 'select', options: optAlineas('11') }],
    onOk: (v, m) => rpc('chq_emitido_devolver', { p_id: id, p_data: v.data, p_alinea: v.alinea }, 'Devolução registrada', re, m) });
  if (k === 'ecan') return form({ titulo: `Cancelar o cheque próprio nº ${em.numero}`, texto: 'Os títulos pagos com este cheque voltam a ficar em aberto, no vencimento original. A folha não pode ser usada de novo.', campos: [{ k: 'motivo', t: 'Motivo', type: 'textarea' }, { html: '<label class="chk"><input type="checkbox" id="f-sustar"> O cheque foi sustado no banco (contraordem)</label>' }], botao: 'Cancelar o cheque',
    onOk: (v, m) => rpc('chq_emitido_cancelar', { p_id: id, p_motivo: v.motivo, p_sustar: $('#f-sustar', m.el).checked }, 'Cheque cancelado', re, m) });
  if (k === 'copia') return copia(ctx, em);
  if (k === 'inut') { const t = D.Tl.find(x => x.id === id), f = folhasTalao(t, D.Em);
    return form({ titulo: 'Inutilizar folha', texto: 'Folha rasurada, extraviada ou anulada: o número fica ocupado, sem valor.', campos: [{ k: 'num', t: 'Número da folha', type: 'number', value: f.proxima || '' }, { k: 'motivo', t: 'Motivo', type: 'textarea' }],
      onOk: (v, m) => rpc('chq_folha_inutilizar', { p_empresa: e, p_conta: t.conta_id, p_numero: +v.num, p_motivo: v.motivo }, 'Folha inutilizada', re, m) }); }
  if (k === 'talat') { const t = D.Tl.find(x => x.id === id); try { await q(sb.from('chq_taloes').update({ ativo: !t.ativo }).eq('id', id)); re(); } catch (err) { fail(err); } }
}

function novoTalao({ e, re, bancos }) {
  form({ titulo: 'Cadastrar talão', texto: 'Com o talão cadastrado, a plataforma sugere a próxima folha livre e avisa quando ele está acabando.', campos: [{ k: 'conta', t: 'Conta bancária', type: 'select', options: options(bancos(), { empty: 'Escolha' }) }, { k: 'ini', t: 'Primeira folha', type: 'number' }, { k: 'fim', t: 'Última folha', type: 'number' }],
    onOk: async (v, m) => { if (!v.conta || !(+v.ini > 0) || +v.fim < +v.ini) { toast('Informe a conta e a numeração', true); throw 0; }
      try { await q(sb.from('chq_taloes').insert({ empresa_id: e, conta_id: v.conta, numero_ini: +v.ini, numero_fim: +v.fim })); toast('Talão cadastrado'); m.close(); re(); } catch (err) { fail(err); throw err; } } });
}

// ---------------------------------------------------------------- receber cheques
async function receber(ctx) {
  const { e, D, cfg, re, hoje } = ctx, c = state.cad;
  const entradas = c.contasPlano.filter(p => p.natureza === 'C' && p.tipo !== 'T');
  let linhas = [{}], tits = [], marc = new Set();
  const m = modal({ title: 'Receber cheques', wide: true, body: `
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px"><label>Cliente<select id="cr-f">${options(c.favorecidos, { label: 'label', empty: 'Escolha o cliente' })}</select></label>
      <label>Data do recebimento<input type="date" id="cr-d" value="${hoje}"></label></div>
    <h3 style="margin:14px 0 6px">Títulos pagos com estes cheques</h3><div id="cr-t" class="muted small">Escolha o cliente para ver os títulos em aberto. Sem título, o valor entra como recebimento avulso.</div>
    <h3 style="margin:14px 0 6px">Cheques</h3>
    <label style="margin-bottom:8px">Leitora ou digitação do CMC-7 (os números do rodapé do cheque)<input id="cr-cmc" placeholder="passe o cheque na leitora ou digite os 30 números e tecle Enter" autocomplete="off"></label>
    <div id="cr-l"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost small" id="cr-add">+ Outro cheque</button><button class="btn ghost small" id="cr-rep">+ Repetir o último (nº seguinte, 30 dias depois)</button></div>
    <div class="cq-soma"><div><span>Títulos marcados</span><b id="cr-st">–</b></div><div><span>Cheques</span><b id="cr-sc">–</b></div><div><span>Diferença (recebimento avulso)</span><b id="cr-sd">–</b></div></div>
    <label id="cr-pl-l" hidden>Conta do plano para a diferença / recebimento sem título<select id="cr-pl">${options(entradas, { label: 'label', selected: cfg.plano_avulso_id, empty: 'Escolha' })}</select></label>
    <div id="cr-av"></div>`,
    foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="cr-ok">Receber</button>' });
  const ler = () => { $$('.cq-linha', m.el).forEach((r, i) => { const g = (k) => $(`[data-k="${k}"]`, r).value; linhas[i] = { banco: g('banco').trim(), agencia: g('agencia').trim(), conta: g('conta').trim(), numero: g('numero').trim(), valor: parseNum(g('valor') || '0') || 0, bom_para: g('bom_para'),
    emitente: g('emitente').trim(), emitente_doc: g('emitente_doc').trim(), praca_outra: linhas[i]?.praca_outra || false, cmc7: linhas[i]?.cmc7 || null }; }); };
  const somas = () => { ler(); const st = tits.filter(t => marc.has(t.id)).reduce((s, t) => s + +t.valor, 0), sc = linhas.reduce((s, x) => s + (x.valor || 0), 0), d = sc - st;
    $('#cr-st', m.el).textContent = money(st); $('#cr-sc', m.el).textContent = money(sc); $('#cr-sd', m.el).textContent = money(d); $('#cr-sd', m.el).className = d < -0.05 ? 'neg' : '';
    $('#cr-pl-l', m.el).hidden = !(d > 0.05);
    const av = linhas.map(x => riscoEmitente(D.Ch, { ...x, favorecido_id: $('#cr-f', m.el).value || null })).filter(h => h && h.devolvidos >= (+cfg.alerta_devolucoes || 1));
    const lim = +cfg.limite_cliente, fid = $('#cr-f', m.el).value, ab = fid ? D.Ch.filter(x => x.favorecido_id === fid && ['carteira', 'depositado', 'devolvido', 'fidc', 'repassado'].includes(x.situacao)).reduce((s, x) => s + +x.valor, 0) : 0;
    $('#cr-av', m.el).innerHTML = (av.length ? `<div class="card cq-al alto" style="margin:8px 0 0"><b>Atenção ao emitente</b>: ${[...new Map(av.map(h => [h.chave, h])).values()].map(h => `${esc(h.emitente || 'este cliente')} já teve ${h.devolvidos} cheque(s) devolvido(s) de ${h.qtd} (${money(h.valorDevolvido)})`).join(' · ')}.</div>` : '')
      + (lim > 0 && fid && ab + sc > lim ? `<div class="card cq-al" style="margin:8px 0 0">Com estes cheques o cliente fica com <b>${money(ab + sc)}</b> em cheques em aberto, acima do limite de ${money(lim)}. Só o administrador recebe acima do limite.</div>` : ''); };
  const pintarL = () => { $('#cr-l', m.el).innerHTML = linhas.map((x, i) => `<div class="cq-linha" data-i="${i}">
      <label>Banco<input data-k="banco" value="${esc(x.banco || '')}" maxlength="3"></label><label>Agência<input data-k="agencia" value="${esc(x.agencia || '')}"></label><label>Conta<input data-k="conta" value="${esc(x.conta || '')}"></label>
      <label>Nº cheque<input data-k="numero" value="${esc(x.numero || '')}"></label><label>Valor<input data-k="valor" value="${x.valor ? String(x.valor.toFixed(2)).replace('.', ',') : ''}" inputmode="decimal"></label>
      <label>Bom para<input type="date" data-k="bom_para" value="${x.bom_para || hoje}"></label><label>Emitente (nome no cheque)<input data-k="emitente" value="${esc(x.emitente || '')}"></label><label>CPF/CNPJ<input data-k="emitente_doc" value="${esc(x.emitente_doc || '')}"></label>
      <button class="btn ghost icon small" data-x="${i}" title="Tirar este cheque" ${linhas.length === 1 ? 'disabled' : ''}>✕</button></div>`).join('');
    $$('.cq-linha input', m.el).forEach(i => i.oninput = somas);
    $$('[data-x]', m.el).forEach(b => b.onclick = () => { ler(); linhas.splice(+b.dataset.x, 1); pintarL(); });
    somas(); };
  const titulos = async () => { const f = $('#cr-f', m.el).value; marc = new Set(); tits = [];
    if (!f) { $('#cr-t', m.el).innerHTML = 'Escolha o cliente para ver os títulos em aberto.'; return somas(); }
    try { const L = await q(sb.from('lancamentos').select('id,data,descricao,documento,valor,plano_id').eq('empresa_id', e).eq('favorecido_id', f).eq('status', 'Em aberto').is('fidc_proposta_id', null).order('data').limit(300));
      tits = L.filter(l => c.planoById[l.plano_id]?.natureza === 'C' && c.planoById[l.plano_id]?.tipo !== 'T');
      $('#cr-t', m.el).className = tits.length ? 'cq-tits' : 'muted small';
      $('#cr-t', m.el).innerHTML = tits.map(t => `<label><input type="checkbox" data-t="${t.id}"><span>${dateBR(t.data)} · ${esc(t.documento || t.descricao || '')}${t.data < hoje ? ' <span class="cq-sel neg">vencido</span>' : ''}</span><span class="v">${money(t.valor)}</span></label>`).join('') || 'Este cliente não tem título em aberto: o valor entra como recebimento avulso.';
      $$('[data-t]', m.el).forEach(i => i.onchange = () => { i.checked ? marc.add(i.dataset.t) : marc.delete(i.dataset.t); somas(); });
      const nome = c.favById[f]?.nome || ''; ler(); linhas.forEach(x => { if (!x.emitente) x.emitente = nome; }); pintarL();
    } catch (err) { fail(err); } };
  $('#cr-f', m.el).onchange = titulos;
  $('#cr-add', m.el).onclick = () => { ler(); linhas.push({ emitente: linhas.at(-1)?.emitente, emitente_doc: linhas.at(-1)?.emitente_doc, banco: linhas.at(-1)?.banco, agencia: linhas.at(-1)?.agencia, conta: linhas.at(-1)?.conta }); pintarL(); };
  $('#cr-rep', m.el).onclick = () => { ler(); const u = linhas.at(-1); if (!u?.numero) return toast('Preencha o primeiro cheque', true);
    const n = String(+u.numero.replace(/\D/g, '') + 1).padStart(u.numero.length, '0'); linhas.push({ ...u, numero: n, cmc7: null, bom_para: u.bom_para ? addMes(u.bom_para, 1) : hoje }); pintarL(); };
  $('#cr-cmc', m.el).onkeydown = (ev) => { if (ev.key !== 'Enter') return; ev.preventDefault(); const r = lerCMC7(ev.target.value);
    if (!r) return toast('O CMC-7 tem 30 números', true);
    ler(); const vazio = linhas.findIndex(x => !x.numero && !x.banco), nova = { ...(vazio >= 0 ? linhas[vazio] : { emitente: linhas.at(-1)?.emitente, emitente_doc: linhas.at(-1)?.emitente_doc }), banco: r.banco, agencia: r.agencia, conta: r.conta, numero: r.numero, cmc7: r.cmc7 };
    vazio >= 0 ? linhas[vazio] = nova : linhas.push(nova); ev.target.value = ''; pintarL();
    toast(r.valido ? `Cheque nº ${r.numero} lido` : 'Lido, mas os dígitos de conferência não batem: confira os números', !r.valido);
    $(`.cq-linha[data-i="${vazio >= 0 ? vazio : linhas.length - 1}"] [data-k="valor"]`, m.el)?.focus(); };
  pintarL();
  $('#cr-ok', m.el).onclick = async (ev) => { ler();
    const st = tits.filter(t => marc.has(t.id)).reduce((s, t) => s + +t.valor, 0), prob = validarRecebimento(linhas, { titulos: st, existentes: D.Ch });
    if (!$('#cr-f', m.el).value) prob.unshift('Escolha o cliente.');
    const sobra = linhas.reduce((s, x) => s + x.valor, 0) - st;
    if (sobra > 0.05 && !$('#cr-pl', m.el).value) prob.push('Escolha a conta do plano para o recebimento avulso.');
    if (prob.length) return toast(prob[0], true);
    ev.target.disabled = true;
    try { await rpc('chq_receber', { p_empresa: e, p_favorecido: $('#cr-f', m.el).value, p_data: $('#cr-d', m.el).value, p_cheques: linhas, p_titulos: [...marc], p_plano: sobra > 0.05 ? $('#cr-pl', m.el).value : null }, `${linhas.length} cheque(s) na carteira`, re, m); ui.aba = 'carteira'; }
    catch { ev.target.disabled = false; } };
}

// ---------------------------------------------------------------- depósito, repasse
function depositar({ e, re, bancos, hoje, cfg }, M) {
  const fut = M.filter(x => x.bom_para > hoje);
  form({ titulo: M[0].situacao === 'devolvido' ? `Reapresentar o cheque nº ${M[0].numero}` : `Depositar ${M.length} cheque(s)`, texto: `Total de <b>${money(soma(M))}</b>. O valor sai da carteira e entra na conta escolhida; depois você confirma a compensação ou a devolução de cada cheque.${fut.length ? `<br><span class="neg">${fut.length} cheque(s) ainda não chegaram na data "bom para".</span>` : ''}`,
    campos: [{ k: 'conta', t: 'Conta do depósito', type: 'select', options: options(bancos(), { empty: 'Escolha' }) }, { k: 'data', t: 'Data do depósito', type: 'date', value: hoje }], botao: 'Depositar',
    onOk: (v, m) => { if (!v.conta) { toast('Escolha a conta', true); return Promise.reject(); } return rpc('chq_depositar', { p_empresa: e, p_ids: M.map(x => x.id), p_conta: v.conta, p_data: v.data }, 'Depósito registrado. O borderô está na aba Depósitos.', re, m).then(() => { ui.aba = 'depositos'; }); } });
}

async function repassar({ e, re, hoje }, M) {
  const c = state.cad, saidas = c.contasPlano.filter(p => p.natureza === 'D' && p.tipo !== 'T'); let tits = [], marc = new Set();
  const m = modal({ title: `Repassar ${M.length} cheque(s) a fornecedor`, body: `<p class="small muted" style="margin-top:0">Os cheques (${money(soma(M))}) pagam títulos do fornecedor direto da carteira, sem passar pelo banco.</p>
    <label>Fornecedor<select id="rp-f">${options(c.favorecidos, { label: 'label', empty: 'Escolha' })}</select></label><label style="margin-top:8px">Data<input type="date" id="rp-d" value="${hoje}"></label>
    <h3 style="margin:12px 0 6px">Títulos a pagar</h3><div id="rp-t" class="muted small">Escolha o fornecedor.</div>
    <div class="cq-soma"><div><span>Títulos</span><b id="rp-st">–</b></div><div><span>Cheques</span><b>${money(soma(M))}</b></div><div><span>Diferença</span><b id="rp-sd">–</b></div></div>
    <label id="rp-pl-l" hidden>Conta do plano para a diferença (pagamento sem título)<select id="rp-pl">${options(saidas, { label: 'label', empty: 'Escolha' })}</select></label>`,
    foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="rp-ok">Repassar</button>' });
  const somas = () => { const st = tits.filter(t => marc.has(t.id)).reduce((s, t) => s + +t.valor, 0), d = soma(M) - st; $('#rp-st', m.el).textContent = money(st); $('#rp-sd', m.el).textContent = money(d); $('#rp-sd', m.el).className = d < -0.05 ? 'neg' : ''; $('#rp-pl-l', m.el).hidden = !(d > 0.05); return d; };
  $('#rp-f', m.el).onchange = async (ev) => { marc = new Set(); tits = []; if (!ev.target.value) return;
    try { const L = await q(sb.from('lancamentos').select('id,data,descricao,documento,valor,plano_id').eq('empresa_id', e).eq('favorecido_id', ev.target.value).eq('status', 'Em aberto').order('data').limit(300));
      tits = L.filter(l => c.planoById[l.plano_id]?.natureza === 'D' && c.planoById[l.plano_id]?.tipo !== 'T');
      $('#rp-t', m.el).className = tits.length ? 'cq-tits' : 'muted small';
      $('#rp-t', m.el).innerHTML = tits.map(t => `<label><input type="checkbox" data-t="${t.id}"><span>${dateBR(t.data)} · ${esc(t.documento || t.descricao || '')}</span><span class="v">${money(t.valor)}</span></label>`).join('') || 'Sem título em aberto: escolha a conta do plano do pagamento.';
      $$('[data-t]', m.el).forEach(i => i.onchange = () => { i.checked ? marc.add(i.dataset.t) : marc.delete(i.dataset.t); somas(); }); somas(); } catch (err) { fail(err); } };
  somas();
  $('#rp-ok', m.el).onclick = async (ev) => { const d = somas(); if (!$('#rp-f', m.el).value) return toast('Escolha o fornecedor', true);
    if (d < -0.05) return toast('Os cheques somam menos que os títulos marcados', true); if (d > 0.05 && !$('#rp-pl', m.el).value) return toast('Escolha a conta do plano para a diferença', true);
    ev.target.disabled = true;
    try { await rpc('chq_repassar', { p_empresa: e, p_ids: M.map(x => x.id), p_favorecido: $('#rp-f', m.el).value, p_data: $('#rp-d', m.el).value, p_titulos: [...marc], p_plano: d > 0.05 ? $('#rp-pl', m.el).value : null }, 'Cheques repassados', re, m); ui.aba = 'fora'; } catch { ev.target.disabled = false; } };
}

// ---------------------------------------------------------------- emitir cheque próprio
async function emitir({ e, D, re, bancos, hoje, conta }) {
  const c = state.cad, saidas = c.contasPlano.filter(p => p.natureza === 'D' && p.tipo !== 'T'); let tits = [], marc = new Set();
  const m = modal({ title: 'Emitir cheque próprio', body: `
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px"><label>Conta bancária<select id="em-c">${options(bancos(), { empty: 'Escolha' })}</select></label><label>Nº do cheque<input id="em-n" type="number" placeholder="próxima folha"></label></div>
    <div class="small muted" id="em-tal" style="margin:4px 0 8px"></div>
    <label>Favorecido<select id="em-f">${options(c.favorecidos, { label: 'label', empty: 'Sem cadastro (informe o nominal)' })}</select></label>
    <label style="margin-top:8px">Nominal a<input id="em-nom" placeholder="nome que vai escrito no cheque"></label>
    <h3 style="margin:12px 0 6px">Títulos pagos com este cheque</h3><div id="em-t" class="muted small">Escolha o favorecido para ver os títulos a pagar. Sem título, informe a conta do plano.</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px"><label>Valor<input id="em-v" inputmode="decimal"></label><label>Emissão<input type="date" id="em-d" value="${hoje}"></label><label>Bom para<input type="date" id="em-b" value="${hoje}"></label></div>
    <div class="small muted" id="em-ext" style="margin-top:4px"></div>
    <label id="em-pl-l" style="margin-top:8px">Conta do plano (cheque sem título)<select id="em-pl">${options(saidas, { label: 'label', empty: 'Escolha' })}</select></label>
    <label style="margin-top:8px">Observação<input id="em-o"></label>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="em-x" checked> Cheque cruzado</label>`,
    foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="em-ok">Emitir</button>' });
  const talao = () => { const ct = $('#em-c', m.el).value, T = D.Tl.filter(t => t.conta_id === ct && t.ativo).map(t => ({ t, f: folhasTalao(t, D.Em) })), prox = T.find(x => x.f.proxima);
    $('#em-tal', m.el).innerHTML = !ct ? '' : prox ? `Próxima folha livre: <b>${prox.f.proxima}</b> (${T.reduce((s, x) => s + x.f.livres, 0)} folha(s) livre(s))` : T.length ? '<span class="neg">Talões desta conta esgotados: cadastre um novo ou informe o número.</span>' : 'Sem talão cadastrado para esta conta: informe o número do cheque.';
    $('#em-n', m.el).placeholder = prox ? String(prox.f.proxima) : 'número'; };
  const ext = () => { const v = parseNum($('#em-v', m.el).value || '0') || 0; $('#em-ext', m.el).textContent = v > 0 ? valorPorExtenso(v) : ''; };
  const somas = () => { const st = tits.filter(t => marc.has(t.id)).reduce((s, t) => s + +t.valor, 0); $('#em-pl-l', m.el).hidden = st > 0; if (st > 0) { $('#em-v', m.el).value = st.toFixed(2).replace('.', ','); $('#em-v', m.el).readOnly = true; } else $('#em-v', m.el).readOnly = false; ext(); };
  $('#em-c', m.el).onchange = talao; $('#em-v', m.el).oninput = ext;
  $('#em-f', m.el).onchange = async (ev) => { marc = new Set(); tits = []; const f = ev.target.value; if (f && !$('#em-nom', m.el).value) $('#em-nom', m.el).value = c.favById[f]?.nome || '';
    if (!f) { $('#em-t', m.el).className = 'muted small'; $('#em-t', m.el).innerHTML = 'Sem título: informe a conta do plano.'; return somas(); }
    try { const L = await q(sb.from('lancamentos').select('id,data,descricao,documento,valor,plano_id').eq('empresa_id', e).eq('favorecido_id', f).eq('status', 'Em aberto').order('data').limit(300));
      tits = L.filter(l => c.planoById[l.plano_id]?.natureza === 'D' && c.planoById[l.plano_id]?.tipo !== 'T');
      $('#em-t', m.el).className = tits.length ? 'cq-tits' : 'muted small';
      $('#em-t', m.el).innerHTML = tits.map(t => `<label><input type="checkbox" data-t="${t.id}"><span>${dateBR(t.data)} · ${esc(t.documento || t.descricao || '')}</span><span class="v">${money(t.valor)}</span></label>`).join('') || 'Sem título a pagar em aberto: informe a conta do plano.';
      $$('[data-t]', m.el).forEach(i => i.onchange = () => { i.checked ? marc.add(i.dataset.t) : marc.delete(i.dataset.t); somas(); }); somas(); } catch (err) { fail(err); } };
  $('#em-ok', m.el).onclick = async (ev) => { const v = parseNum($('#em-v', m.el).value || '0') || 0;
    if (!$('#em-c', m.el).value) return toast('Escolha a conta bancária', true); if (!(v > 0)) return toast('Informe o valor', true);
    if (!marc.size && !$('#em-pl', m.el).value) return toast('Marque os títulos ou escolha a conta do plano', true);
    ev.target.disabled = true;
    try { const id = await q(sb.rpc('chq_emitir', { p_empresa: e, p_conta: $('#em-c', m.el).value, p_numero: +$('#em-n', m.el).value || null, p_favorecido: $('#em-f', m.el).value || null, p_nominal: $('#em-nom', m.el).value, p_valor: v,
        p_emissao: $('#em-d', m.el).value, p_bom_para: $('#em-b', m.el).value || null, p_titulos: [...marc], p_plano: marc.size ? null : $('#em-pl', m.el).value, p_obs: $('#em-o', m.el).value, p_cruzado: $('#em-x', m.el).checked }));
      toast('Cheque emitido'); m.close(); ui.aba = 'emitidos'; await re();
      const em = (await q(sb.from('chq_emitidos').select('*').eq('id', id)))[0]; if (em && await confirmDialog(`Cheque nº ${em.numero} emitido. Imprimir a cópia de cheque agora?`)) copia({ conta, D }, em);
    } catch (err) { fail(err); ev.target.disabled = false; } };
}

// ---------------------------------------------------------------- detalhe do cheque
async function detalhe(ctx, ch) {
  const { cfg, re, fav, conta, hoje } = ctx, p = prazos(ch, cfg), pp = proximoPasso(ch, cfg, hoje), edita = pode() && ch.situacao === 'carteira';
  const m = modal({ title: `Cheque nº ${ch.numero}`, wide: true, body: `<div style="display:grid;grid-template-columns:1.2fr 1fr;gap:16px">
    <div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="font-size:22px;font-weight:700">${money(ch.valor)}</span>${sel(ch.situacao)}${pp.texto ? `<span class="small ${pp.tom === 'neg' ? 'neg' : 'muted'}">${esc(pp.texto)}</span>` : ''}</div>
      <p class="small" style="margin:8px 0">Cliente: <b>${esc(fav(ch.favorecido_id) || '—')}</b><br>Recebido em ${dateBR(ch.recebido_em)} · bom para <b>${dateBR(ch.bom_para)}</b>${p ? `<br>Apresentar até ${dateBR(p.apresentar)} · prescreve em ${dateBR(p.prescreve)}` : ''}
        ${ch.situacao === 'devolvido' || ch.alinea ? `<br>Última devolução: ${dateBR(ch.devolvido_em)} · ${esc(alineaTexto(ch.alinea))} (${ch.devolucoes}ª)` : ''}${ch.fundo ? `<br>Fundo: ${esc(ch.fundo)}` : ''}${ch.conta_deposito_id ? `<br>Depositado em ${esc(conta(ch.conta_deposito_id))}` : ''}</p>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">${[['banco', 'Banco'], ['agencia', 'Agência'], ['conta', 'Conta'], ['numero', 'Número']].map(([k, t]) => `<label>${t}<input id="dc-${k}" value="${esc(ch[k] || '')}" ${edita ? '' : 'disabled'}></label>`).join('')}</div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin-top:8px"><label>Emitente<input id="dc-emitente" value="${esc(ch.emitente || '')}" ${pode() ? '' : 'disabled'}></label><label>CPF/CNPJ<input id="dc-emitente_doc" value="${esc(ch.emitente_doc || '')}" ${pode() ? '' : 'disabled'}></label><label>Bom para<input type="date" id="dc-bom_para" value="${ch.bom_para}" ${edita ? '' : 'disabled'}></label></div>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="dc-praca" ${ch.praca_outra ? 'checked' : ''} ${edita ? '' : 'disabled'}> Cheque de outra praça (prazo de apresentação maior)</label>
      <label style="margin-top:8px">Observação<input id="dc-observacao" value="${esc(ch.observacao || '')}" ${pode() ? '' : 'disabled'}></label>
      <h3 style="margin:14px 0 6px">Imagem do cheque</h3><div id="dc-fotos" class="small muted">${(ch.fotos || []).length ? '' : 'Nenhuma imagem.'}</div>${pode() ? '<input type="file" id="dc-up" accept="image/*,application/pdf" style="margin-top:6px">' : ''}</div>
    <div><h3 style="margin:0 0 6px">Títulos deste recebimento</h3><div id="dc-tit" class="small muted">Carregando…</div><h3 style="margin:14px 0 6px">Histórico</h3><div id="dc-hist" class="cq-hist small muted">Carregando…</div></div></div>`,
    foot: `${edita ? '<button class="btn ghost" id="dc-can" style="margin-right:auto">Cancelar o recebimento</button>' : ''}<button class="btn ghost" data-close>Fechar</button>${pode() ? '<button class="btn primary" id="dc-ok">Salvar</button>' : ''}` });
  const fotos = async () => { const F = ch.fotos || []; if (!F.length) return; const U = await Promise.all(F.map(f => sb.storage.from('cheques').createSignedUrl(f, 600).then(r => r.data?.signedUrl).catch(() => null)));
    $('#dc-fotos', m.el).innerHTML = F.map((f, i) => U[i] ? `<a href="${U[i]}" target="_blank" rel="noopener">${/\.pdf$/i.test(f) ? 'Abrir PDF' : `<img src="${U[i]}" alt="imagem do cheque" style="max-width:100%;max-height:150px;border-radius:8px;border:1px solid var(--border);margin:0 6px 6px 0">`}</a>` : '').join(''); };
  fotos();
  Promise.all([q(sb.from('chq_eventos').select('*').eq('cheque_id', ch.id).order('created_at')), q(sb.from('chq_receb_titulos').select('lancamento_id,avulso,lancamentos(descricao,documento,valor)').eq('recebimento', ch.recebimento))]).then(([E, T]) => {
    $('#dc-hist', m.el).innerHTML = E.map(x => `<div><b>${esc(x.tipo)}</b> · ${dateBR(x.data)}${x.detalhe ? `<br><span class="muted">${esc(x.detalhe)}</span>` : ''}</div>`).join('') || 'Sem eventos.';
    const irm = ctx.D.Ch.filter(x => x.recebimento === ch.recebimento && x.id !== ch.id);
    $('#dc-tit', m.el).innerHTML = (T.map(t => `<div><a href="#/lancamentos?abrir=${t.lancamento_id}" data-close>${esc(t.lancamentos?.documento || t.lancamentos?.descricao || 'título')}</a>${t.avulso ? ' (avulso)' : ''} · ${money(t.lancamentos?.valor)}</div>`).join('') || 'Nenhum título ligado.')
      + (irm.length ? `<div style="margin-top:6px">Recebido junto com ${irm.length} cheque(s): ${irm.map(x => `nº ${esc(x.numero)}`).join(', ')}.</div>` : ''); }).catch(() => {});
  $('#dc-up', m.el) && ($('#dc-up', m.el).onchange = async (ev) => { const f = ev.target.files[0]; if (!f) return; if (f.size > 8 * 1048576) return toast('Arquivo acima de 8 MB', true);
    try { const path = `${ch.empresa_id}/${ch.id}/${Date.now()}.${(f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')}`; const { error } = await sb.storage.from('cheques').upload(path, f, { contentType: f.type, upsert: false }); if (error) throw error;
      ch.fotos = [...(ch.fotos || []), path]; await q(sb.rpc('chq_editar', { p_id: ch.id, p_dados: { fotos: ch.fotos } })); toast('Imagem guardada'); fotos(); } catch (err) { fail(err); } });
  $('#dc-ok', m.el) && ($('#dc-ok', m.el).onclick = async (ev) => { const g = (k) => $('#dc-' + k, m.el).value.trim(), d = { emitente: g('emitente'), emitente_doc: g('emitente_doc'), observacao: g('observacao') };
    if (edita) Object.assign(d, { banco: g('banco'), agencia: g('agencia'), conta: g('conta'), numero: g('numero'), bom_para: g('bom_para'), praca_outra: $('#dc-praca', m.el).checked });
    ev.target.disabled = true; try { await rpc('chq_editar', { p_id: ch.id, p_dados: d }, 'Cheque atualizado', re, m); } catch { ev.target.disabled = false; } });
  $('#dc-can', m.el) && ($('#dc-can', m.el).onclick = () => form({ titulo: 'Cancelar o recebimento', texto: 'Todos os cheques deste recebimento saem da carteira e os títulos voltam a ficar em aberto, no vencimento original.', campos: [{ k: 'motivo', t: 'Motivo', type: 'textarea' }], botao: 'Cancelar o recebimento',
    onOk: (v, m2) => rpc('chq_cancelar_recebimento', { p_recebimento: ch.recebimento, p_motivo: v.motivo }, 'Recebimento cancelado', re, m2).then(() => m.close()) }));
}

async function detalheEmitido({ fav, conta }, em) {
  const m = modal({ title: `Cheque próprio nº ${em.numero}`, body: `<div style="display:flex;gap:10px;align-items:center"><span style="font-size:22px;font-weight:700">${money(em.valor)}</span>${sel(em.situacao)}</div>
    <p class="small">${esc(conta(em.conta_id))}<br>Favorecido: <b>${esc(fav(em.favorecido_id) || em.nominal || '—')}</b>${em.nominal ? `<br>Nominal a ${esc(em.nominal)}` : ''}<br>Emissão ${dateBR(em.emissao)} · bom para ${dateBR(em.bom_para)}${em.cruzado ? ' · cruzado' : ''}${em.observacao ? `<br>${esc(em.observacao)}` : ''}</p>
    <h3 style="margin:10px 0 6px">Títulos pagos</h3><div id="de-t" class="small muted">Carregando…</div><h3 style="margin:14px 0 6px">Histórico</h3><div id="de-h" class="cq-hist small muted">Carregando…</div>`, foot: '<button class="btn ghost" data-close>Fechar</button>' });
  Promise.all([q(sb.from('chq_eventos').select('*').eq('emitido_id', em.id).order('created_at')), q(sb.from('chq_emitido_titulos').select('lancamento_id,avulso,lancamentos(descricao,documento,valor)').eq('emitido_id', em.id))]).then(([E, T]) => {
    $('#de-h', m.el).innerHTML = E.map(x => `<div><b>${esc(x.tipo)}</b> · ${dateBR(x.data)}${x.detalhe ? `<br><span class="muted">${esc(x.detalhe)}</span>` : ''}</div>`).join('') || 'Sem eventos.';
    $('#de-t', m.el).innerHTML = T.map(t => `<div><a href="#/lancamentos?abrir=${t.lancamento_id}" data-close>${esc(t.lancamentos?.documento || t.lancamentos?.descricao || 'título')}</a> · ${money(t.lancamentos?.valor)}</div>`).join('') || 'Nenhum título ligado (cancelado ou folha inutilizada).'; }).catch(() => {});
}

// ---------------------------------------------------------------- impressos
const CSS_IMP = `.cq-t{width:100%;border-collapse:collapse;font-size:11px}.cq-t th,.cq-t td{border-bottom:1px solid #ccc;padding:5px 6px;text-align:left}.cq-t .n{text-align:right;font-variant-numeric:tabular-nums}.cq-t tfoot td{font-weight:700;border-top:2px solid #111;border-bottom:0}
  .cq-ass{display:flex;gap:40px;margin-top:46px}.cq-ass div{flex:1;border-top:1px solid #111;padding-top:4px;font-size:10.5px;text-align:center}
  .cq-chq{border:1.5px solid #111;border-radius:6px;padding:14px 16px;margin:10px 0 16px}.cq-chq .l{display:flex;justify-content:space-between;gap:12px;font-size:11px}.cq-chq .v{font-size:17px;font-weight:700}.cq-chq .e{margin:10px 0;font-size:12.5px;border-bottom:1px solid #999;padding-bottom:4px}`;
async function bordero({ D, conta, fav }, d) {
  const L = D.Ch.filter(x => x.deposito_id === d.id), w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para gerar o PDF', true);
  if (!L.length) { w.close(); return toast('Os cheques deste depósito já mudaram de situação (devolvidos e reapresentados em outro depósito)', true); }
  await abrirRelatorio({ janela: w, nome: `Borderô de depósito nº ${d.numero}`, titulo: `Borderô de depósito de cheques nº ${d.numero}`, subtitulo: `${esc(conta(d.conta_id))} · ${dateBR(d.data)}`, extraCss: CSS_IMP,
    corpo: `<table class="cq-t"><thead><tr><th>#</th><th>Banco</th><th>Agência</th><th>Conta</th><th>Nº cheque</th><th>Emitente</th><th>Cliente</th><th>Bom para</th><th class="n">Valor</th></tr></thead><tbody>
      ${L.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.banco)}</td><td>${esc(x.agencia)}</td><td>${esc(x.conta)}</td><td>${esc(x.numero)}</td><td>${esc(x.emitente || '')}</td><td>${esc(fav(x.favorecido_id))}</td><td>${dateBR(x.bom_para)}</td><td class="n">${money(x.valor)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="8">${L.length} cheque(s)</td><td class="n">${money(soma(L))}</td></tr></tfoot></table>
      <div class="cq-ass"><div>Preparado por</div><div>Conferido por</div><div>Recebido pelo banco (data e carimbo)</div></div>`,
    rodape: `Controle de Cheques · depósito nº ${d.numero} · ${esc(state.empresa?.nome || '')}` });
}
async function copia({ conta }, em) {
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para gerar o PDF', true);
  const T = await q(sb.from('chq_emitido_titulos').select('avulso,lancamentos(data,descricao,documento,valor)').eq('emitido_id', em.id)).catch(() => []);
  const nome = em.nominal || state.cad.favById[em.favorecido_id]?.nome || '';
  await abrirRelatorio({ janela: w, nome: `Cópia de cheque nº ${em.numero}`, titulo: 'Cópia de cheque', subtitulo: `${esc(conta(em.conta_id))} · cheque nº ${em.numero}`, extraCss: CSS_IMP,
    corpo: `<div class="cq-chq"><div class="l"><span>${esc(conta(em.conta_id))}</span><span>Cheque nº <b>${em.numero}</b></span><span class="v">R$ ${money(em.valor).replace(/^R\$\s?/, '')}</span></div>
        <div class="e">Pague por este cheque a quantia de <b>${esc(valorPorExtenso(em.valor))}</b></div><div class="e">a <b>${esc(nome || '— ao portador —')}</b>${em.cruzado ? ' · cruzado' : ''}</div>
        <div class="l"><span>Emissão: ${dateBR(em.emissao)}</span><span>Bom para: <b>${dateBR(em.bom_para)}</b></span><span>${esc(state.empresa?.nome || '')}</span></div></div>
      <table class="cq-t"><thead><tr><th>Referente a</th><th>Vencimento</th><th class="n">Valor</th></tr></thead><tbody>${T.map(t => `<tr><td>${esc(t.lancamentos?.documento ? t.lancamentos.documento + ' · ' : '')}${esc(t.lancamentos?.descricao || '')}</td><td>${dateBR(t.lancamentos?.data)}</td><td class="n">${money(t.lancamentos?.valor)}</td></tr>`).join('') || `<tr><td colspan="3">${esc(em.observacao || 'Pagamento')}</td></tr>`}</tbody></table>
      ${em.observacao ? `<p style="font-size:11px">Observação: ${esc(em.observacao)}</p>` : ''}
      <div class="cq-ass"><div>Emitido por</div><div>Autorizado por</div><div>Recebi o cheque acima (nome, documento e data)</div></div>`,
    rodape: `Controle de Cheques · cópia de cheque · ${esc(state.empresa?.nome || '')}` });
}

// ---------------------------------------------------------------- parâmetros
function parametros({ e, cfg, re }) {
  const c = state.cad, f = cfg || {}, contasChq = c.contas;
  const pl = (k, t, nat, dica) => `<label>${t}<select id="pp-${k}">${options(c.contasPlano.filter(p => nat === 'T' ? p.tipo === 'T' && p.natureza === 'D' : p.natureza === nat && p.tipo !== 'T'), { label: 'label', selected: f[k], empty: 'Não definida' })}</select>${dica ? `<span class="small muted">${dica}</span>` : ''}</label>`;
  const m = modal({ title: 'Parâmetros dos cheques', wide: true, body: `
    <h3 style="margin-top:0">Contas de movimento</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label>Cheques em carteira<select id="pp-conta_carteira_id">${options(contasChq, { selected: f.conta_carteira_id, empty: 'Não definida' })}</select><span class="small muted">onde ficam os cheques de clientes até virarem dinheiro</span></label>
      <label>Cheques emitidos a compensar<select id="pp-conta_emitidos_id">${options(contasChq, { selected: f.conta_emitidos_id, empty: 'Não definida' })}</select><span class="small muted">cheques próprios entregues e ainda não debitados</span></label></div>
    <h3>Contas do plano</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${pl('plano_transferencia_id', 'Transferência entre contas', 'T', 'depósito, compensação, resgate')}${pl('plano_avulso_id', 'Recebimento em cheque sem título', 'C', 'entrada quando não há título a baixar')}
      ${pl('plano_devolvido_receber_id', 'Título do cheque devolvido (cobrança)', 'C', 'conta do título a receber aberto contra o cliente')}${pl('plano_estorno_id', 'Saída ao tirar o devolvido da carteira', 'D', 'usada na cobrança (e na perda, se não houver conta própria)')}
      ${pl('plano_perda_id', 'Perda com cheque', 'D', 'baixa definitiva')}${pl('plano_juros_id', 'Juros e multa recebidos', 'C', 'no resgate do cheque devolvido')}
      ${pl('plano_tarifa_id', 'Tarifa de devolução', 'D', 'cobrada pelo banco')}${pl('plano_fidc_devolvido_id', 'Cheque devolvido pelo FIDC', 'C', 'entrada do cheque que volta do fundo para a carteira')}
      ${pl('plano_repasse_entrada_id', 'Cheque repassado que voltou', 'C', 'entrada na carteira')}${pl('plano_repasse_pagar_id', 'Dívida que reabre com o fornecedor', 'D', 'título a pagar do repasse devolvido')}</div>
    <h3>Regras</h3><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
      <label>Prazo de apresentação — mesma praça (dias)<input type="number" id="pp-prazo_praca" value="${f.prazo_praca ?? 30}"></label><label>Prazo de apresentação — outra praça (dias)<input type="number" id="pp-prazo_fora" value="${f.prazo_fora ?? 60}"></label>
      <label>Prescrição depois do prazo (meses)<input type="number" id="pp-prescricao_meses" value="${f.prescricao_meses ?? 6}"></label><label>Reapresentações permitidas<input type="number" id="pp-max_reapresentacoes" value="${f.max_reapresentacoes ?? 1}"></label>
      <label>Limite de cheques em aberto por cliente (R$, 0 = sem limite)<input id="pp-limite_cliente" value="${String(f.limite_cliente ?? 0).replace('.', ',')}"></label><label>Devoluções do emitente que acendem o aviso<input type="number" id="pp-alerta_devolucoes" value="${f.alerta_devolucoes ?? 1}"></label></div>`,
    foot: '<button class="btn ghost" id="pp-pad" style="margin-right:auto">Configurar padrão</button><button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="pp-ok">Salvar</button>' });
  $('#pp-pad', m.el).onclick = async (ev) => { ev.target.disabled = true; try { await q(sb.rpc('chq_configurar_padrao', { p_empresa: e })); await loadCadastros(true); toast('Preenchido o que faltava'); m.close(); await re(); } catch (err) { fail(err); ev.target.disabled = false; } };
  $('#pp-ok', m.el).onclick = async (ev) => { const v = (k) => $('#pp-' + k, m.el).value, d = { empresa_id: e, atualizado_em: new Date().toISOString() };
    ['conta_carteira_id', 'conta_emitidos_id', 'plano_transferencia_id', 'plano_avulso_id', 'plano_devolvido_receber_id', 'plano_estorno_id', 'plano_perda_id', 'plano_juros_id', 'plano_tarifa_id', 'plano_fidc_devolvido_id', 'plano_repasse_entrada_id', 'plano_repasse_pagar_id'].forEach(k => d[k] = v(k) || null);
    ['prazo_praca', 'prazo_fora', 'prescricao_meses', 'max_reapresentacoes', 'alerta_devolucoes'].forEach(k => d[k] = +v(k));
    d.limite_cliente = parseNum(v('limite_cliente') || '0') || 0;
    if (d.conta_carteira_id && d.conta_carteira_id === d.conta_emitidos_id) return toast('As duas contas de cheques precisam ser diferentes', true);
    ev.target.disabled = true; try { await q(sb.from('chq_config').upsert(d)); toast('Parâmetros salvos'); m.close(); re(); } catch (err) { fail(err); ev.target.disabled = false; } };
}

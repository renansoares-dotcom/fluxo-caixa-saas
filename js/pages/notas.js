// Notas fiscais: importação dos XML (notas completas, itens e impostos), consulta por mês, impostos por CFOP
// e casamento das parcelas com os lançamentos de recebimento já existentes (vínculo só após aprovação).
import { sb, state, q, fetchAll, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, money, dateBR, fail, toast, modal, exportXLSX } from '../lib/ui.js';
import { lerArquivos } from '../lib/nf-titulos.js';
import { lerNFeCompleta, prepararNotas, casarBorderos, CFOP_SEM_FINANCEIRO } from '../lib/nfe-fiscal.js';
import { pintarRecebimentos, autoVincular, marcarCancelada, desfazerCancelamento, gerarContasReceber } from '../lib/nfe-receb.js';
import { importarBeneficiariosNFe } from '../lib/nfe-benef.js';

export const title = 'Notas fiscais';

const hoje = new Date();
const ant = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
const ui = { mes: `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`, tipo: 'saida', aba: 'notas', busca: '' };
let D = null;
const COLS = 'id,chave,serie,numero,emissao,tipo,emissao_propria,finalidade,natureza,cfops,dest_doc,dest_nome,emit_doc,emit_nome,favorecido_id,v_prod,v_desc,v_nf,v_bc_icms,v_icms,v_st,v_ipi,v_pis,v_cofins,v_ibs,v_cbs,situacao,eventos';
const fimMes = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const soma = (arr, k) => arr.reduce((s, x) => s + (+x[k] || 0), 0);
const venda = (n) => n.tipo === 'saida' && n.finalidade === '1' && n.situacao === 'autorizada';
const parte = (n) => n.tipo === 'saida' ? n.dest_nome : n.emissao_propria ? n.dest_nome : n.emit_nome;
const chunks = (arr, k = 150) => { const o = []; for (let i = 0; i < arr.length; i += k) o.push(arr.slice(i, i + k)); return o; };

export async function render(root) {
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div class="toolbar" id="flt">
        <label>Mês de emissão<input type="month" name="mes" value="${ui.mes}"></label>
        <label>Emissão de<input type="date" name="de" value="${ui.de || `${ui.mes}-01`}"></label>
        <label>até<input type="date" name="ate" value="${ui.ate || fimMes(ui.mes)}"></label>
        <label>Tipo<select name="tipo"><option value="saida" ${ui.tipo === 'saida' ? 'selected' : ''}>Saídas (vendas)</option><option value="entrada" ${ui.tipo === 'entrada' ? 'selected' : ''}>Entradas</option></select></label>
        <label class="grow">Buscar<input name="busca" value="${esc(ui.busca)}" placeholder="nº, cliente, CNPJ, natureza"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="exp">Exportar Excel</button>
        ${podeEditar() ? '<button class="btn primary" id="imp">Importar XML</button>' : ''}
      </div></div>
      <div class="chips" id="abas" style="margin-top:12px">${[['notas', 'Notas'], ['impostos', 'Impostos por CFOP'], ['recebimentos', 'Recebimentos × Notas'], ['borderos', 'Borderôs FIDC']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div class="kpis" id="kpis"></div>
    <div id="corpo"></div>`;
  $('#flt', root).addEventListener('change', (e) => {
    const nm = e.target.name; if (!nm || nm === 'busca') return;
    ui[nm] = e.target.value;
    if (nm === 'mes' && ui.mes) { ui.de = `${ui.mes}-01`; ui.ate = fimMes(ui.mes); $('#flt [name=de]', root).value = ui.de; $('#flt [name=ate]', root).value = ui.ate; }
    if ((nm === 'de' || nm === 'ate') && ui.de && ui.ate && ui.de > ui.ate) { toast('A data inicial é depois da final', true); return; }
    carregar(root);
  });
  let t; $('#flt [name=busca]', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.busca = e.target.value; pintar(root); }, 300); };
  $('#abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; root.querySelectorAll('#abas .chip').forEach(c => c.classList.toggle('on', c.dataset.a === a)); pintar(root); } };
  $('#imp', root) && ($('#imp', root).onclick = () => importar(root));
  $('#exp', root).onclick = () => exportXLSX($('#corpo table', root), `notas_${ui.tipo}_${D?.ini || ui.mes}_${D?.fim || ''}`);
  await carregar(root);
}

async function carregar(root) {
  $('#corpo', root).innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregarDados(); } catch (err) { fail(err); $('#corpo', root).innerHTML = '<div class="empty">Não foi possível carregar. A estrutura de notas fiscais foi criada?</div>'; return; }
  pintar(root);
}
async function carregarDados() {
  const e = state.empresa.id, ini = ui.de || `${ui.mes}-01`, fim = ui.ate || fimMes(ui.mes);
  {
    const notas = await fetchAll(() => sb.from('nfe_notas').select(COLS).eq('empresa_id', e).eq('tipo', ui.tipo).gte('emissao', ini).lte('emissao', fim).order('numero'));
    const ids = notas.map(n => n.id); const parcelas = [], vinc = [], fv = [];
    for (const c of chunks(ids)) {
      const [p, v, f] = await Promise.all([q(sb.from('nfe_parcelas').select('*').in('nota_id', c)), q(sb.from('nfe_vinculos').select('id,nota_id,parcela_id,lancamento_id,tipo').in('nota_id', c)),
        q(sb.from('nfe_fidc_vinculos').select('id,nota_id,parcela_id,tipo,t:fidc_titulos(id,operacao_id,fundo,bordero,data_operacao,titulo,vencimento,valor)').in('nota_id', c))]);
      parcelas.push(...p); vinc.push(...v); fv.push(...f);
    }
    const lv = new Map();
    for (const c of chunks([...new Set(vinc.map(v => v.lancamento_id))])) for (const l of await q(sb.from('lancamentos').select('id,data,valor,descricao,conta_id,status').in('id', c))) lv.set(l.id, l);
    for (const n of notas) { n.parcelas = parcelas.filter(p => p.nota_id === n.id).sort((a, b) => a.numero - b.numero); n.vinc = vinc.filter(v => v.nota_id === n.id).map(v => ({ ...v, l: lv.get(v.lancamento_id) })); n.fidc = fv.filter(v => v.nota_id === n.id); }
    D = { notas, ini, fim };
  }
}

// depois de vincular na aba Recebimentos × Notas: recarrega os dados e só os indicadores (a aba continua como está)
async function carregarSilencioso() { try { await carregarDados(); pintarKpis(document); } catch (e) { fail(e); } }
const recebido = (n) => n.vinc.reduce((s, v) => s + (v.l?.status === 'Pago' ? +v.l.valor || 0 : 0), 0);
const aReceber = (n) => n.vinc.reduce((s, v) => s + (v.l && v.l.status !== 'Pago' ? +v.l.valor || 0 : 0), 0);
function statusFin(n) {
  if (n.situacao === 'cancelada') return '<span class="badge vencido">cancelada</span>';
  if (!n.parcelas.length) return '<span class="badge">sem financeiro</span>';
  const tot = soma(n.parcelas, 'valor'), r = recebido(n), falta = tot - r;
  const fidc = n.fidc.length ? ' <span class="badge" title="Parcela(s) antecipada(s) em borderô FIDC">FIDC</span>' : '';
  if (falta <= 0.05) return `<span class="badge pago">Recebida</span>${fidc}`;
  if (r > 0.005) return `<span class="badge aberto">Parcial · falta ${money(falta)}</span>${fidc}`;
  if (n.fidc.length) return '<span class="badge pago">Antecipada FIDC</span>';
  if (aReceber(n) > 0.005) return `<span class="badge aberto">A receber · ${money(aReceber(n))}</span>`;
  return '<span class="badge">Em aberto</span>';
}

function filtradas() {
  const b = ui.busca.trim().toLowerCase();
  return D.notas.filter(n => !b || `${n.numero} ${parte(n)} ${n.dest_doc} ${n.emit_doc} ${n.natureza} ${(n.cfops || []).join(' ')}`.toLowerCase().includes(b));
}

function pintarKpis(root) {
  if (!D || !$('#kpis', root)) return;
  const N = filtradas(), V = N.filter(venda), aut = N.filter(n => n.situacao === 'autorizada');
  const comFin = V.filter(n => n.parcelas.length), totParc = comFin.reduce((s, n) => s + soma(n.parcelas, 'valor'), 0), rec = comFin.reduce((s, n) => s + Math.min(recebido(n), soma(n.parcelas, 'valor')), 0);
  $('#kpis', root).innerHTML = `
    <div class="kpi"><div class="k-label">Notas no período</div><div class="k-value">${aut.length}</div><div class="k-sub">${N.length - aut.length ? `${N.length - aut.length} cancelada(s) · ` : ''}${N.filter(n => n.finalidade === '4').length} devolução(ões)</div></div>
    <div class="kpi"><div class="k-label">${ui.tipo === 'saida' ? 'Faturamento (vendas)' : 'Valor das notas'}</div><div class="k-value">${money(soma(ui.tipo === 'saida' ? V : aut, 'v_nf'))}</div><div class="k-sub">produtos ${money(soma(ui.tipo === 'saida' ? V : aut, 'v_prod'))}</div></div>
    <div class="kpi"><div class="k-label">ICMS · IPI</div><div class="k-value">${money(soma(aut, 'v_icms'))}</div><div class="k-sub">IPI ${money(soma(aut, 'v_ipi'))}${soma(aut, 'v_st') ? ` · ST ${money(soma(aut, 'v_st'))}` : ''}</div></div>
    <div class="kpi"><div class="k-label">PIS · COFINS</div><div class="k-value">${money(soma(aut, 'v_pis') + soma(aut, 'v_cofins'))}</div><div class="k-sub">PIS ${money(soma(aut, 'v_pis'))} · COFINS ${money(soma(aut, 'v_cofins'))}</div></div>
    <div class="kpi"><div class="k-label">IBS · CBS (teste 2026)</div><div class="k-value">${money(soma(aut, 'v_ibs') + soma(aut, 'v_cbs'))}</div><div class="k-sub">IBS ${money(soma(aut, 'v_ibs'))} · CBS ${money(soma(aut, 'v_cbs'))}</div></div>
    ${ui.tipo === 'saida' ? `<div class="kpi"><div class="k-label">Parcelas com recebimento vinculado</div><div class="k-value">${totParc ? Math.round(rec / totParc * 100) : 0}%</div><div class="k-sub">${money(rec)} de ${money(totParc)}</div></div>` : ''}
    ${ui.tipo === 'saida' ? (() => { const F = comFin.flatMap(n => n.fidc), vF = F.reduce((s, v) => s + (+v.t?.valor || 0), 0); return `<div class="kpi"><div class="k-label">Em borderô FIDC</div><div class="k-value">${totParc ? Math.round(vF / totParc * 100) : 0}%</div><div class="k-sub">${F.length} título(s) · ${money(vF)}</div></div>`; })() : ''}`;
}

function pintar(root) {
  if (!D) return;
  pintarKpis(root);
  const N = filtradas();
  const c = $('#corpo', root);
  if (ui.aba === 'recebimentos') return ui.tipo === 'saida' ? pintarRecebimentos(c, root, () => carregarSilencioso(), ui.mes) : (c.innerHTML = '<div class="card"><div class="empty">Recebimentos × Notas vale para as notas de saída.</div></div>');
  if (!D.notas.length) { c.innerHTML = `<div class="card"><div class="empty">Nenhuma nota ${ui.tipo === 'saida' ? 'de saída' : 'de entrada'} importada com emissão de ${dateBR(D.ini)} a ${dateBR(D.fim)}. Use “Importar XML”.</div></div>`; return; }
  if (ui.aba === 'impostos') return pintarImpostos(c, N);
  if (ui.aba === 'borderos') return pintarBorderos(c, root);
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:66vh"><table><thead><tr><th>Nº</th><th>Emissão</th><th>${ui.tipo === 'saida' ? 'Cliente' : 'Emitente / destinatário'}</th><th>CFOP</th><th class="num">Valor</th><th class="num">ICMS</th><th class="num">IPI</th><th class="num">PIS+COFINS</th><th>Parcelas</th><th>Financeiro</th></tr></thead><tbody>
    ${N.map(n => `<tr class="clickable ${n.situacao === 'cancelada' ? 'muted' : ''}" data-id="${n.id}"><td>${n.numero}${n.serie !== '1' ? `<span class="muted small"> s.${esc(n.serie)}</span>` : ''}</td><td>${dateBR(n.emissao)}</td>
      <td class="wrap">${esc(parte(n))}<div class="small muted">${esc(n.natureza || '')}${n.finalidade === '4' ? ' · devolução' : ''}${(n.eventos || []).some(e => e.tipo === '110110') ? ' · carta de correção' : ''}</div></td>
      <td class="small">${esc((n.cfops || []).join(', '))}</td><td class="num">${money(n.v_nf)}</td><td class="num">${money(n.v_icms)}</td><td class="num">${money(n.v_ipi)}</td><td class="num">${money(+n.v_pis + +n.v_cofins)}</td>
      <td class="small">${n.parcelas.length ? `${n.parcelas.length}${n.parcelas[0].a_vista ? ' (à vista)' : ''}` : '—'}${n.fidc.length ? `<div class="muted">${[...new Set(n.fidc.map(v => `${v.t?.fundo} ${v.t?.bordero}`))].map(esc).join(', ')}</div>` : ''}</td><td>${statusFin(n)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  $('tbody', c).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) detalhe(D.notas.find(n => n.id === tr.dataset.id), root); };
}

function pintarImpostos(c, N) {
  const g = new Map();
  for (const n of N.filter(n => n.situacao === 'autorizada')) {
    const k = (n.cfops || []).join(', ') || '—';
    const r = g.get(k) || { cfop: k, nat: n.natureza, n: 0, v_nf: 0, v_bc_icms: 0, v_icms: 0, v_st: 0, v_ipi: 0, v_pis: 0, v_cofins: 0, v_ibs: 0, v_cbs: 0 };
    r.n++; for (const f of ['v_nf', 'v_bc_icms', 'v_icms', 'v_st', 'v_ipi', 'v_pis', 'v_cofins', 'v_ibs', 'v_cbs']) r[f] += +n[f] || 0; g.set(k, r);
  }
  const L = [...g.values()].sort((a, b) => b.v_nf - a.v_nf); const T = (f) => money(soma(L, f));
  c.innerHTML = `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2>Impostos destacados nas notas por CFOP</h2><p class="muted small">Valores das notas autorizadas no mês (canceladas fora). É a base para a apuração; créditos virão das notas de entrada.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>CFOP</th><th>Natureza</th><th class="num">Notas</th><th class="num">Valor</th><th class="num">BC ICMS</th><th class="num">ICMS</th><th class="num">ICMS-ST</th><th class="num">IPI</th><th class="num">PIS</th><th class="num">COFINS</th><th class="num">IBS</th><th class="num">CBS</th></tr></thead><tbody>
    ${L.map(r => `<tr><td>${esc(r.cfop)}${(r.cfop.split(', ')).every(x => CFOP_SEM_FINANCEIRO.has(x)) ? ' <span class="badge">sem financeiro</span>' : ''}</td><td class="small wrap">${esc(r.nat || '')}</td><td class="num">${r.n}</td><td class="num">${money(r.v_nf)}</td><td class="num">${money(r.v_bc_icms)}</td><td class="num">${money(r.v_icms)}</td><td class="num">${money(r.v_st)}</td><td class="num">${money(r.v_ipi)}</td><td class="num">${money(r.v_pis)}</td><td class="num">${money(r.v_cofins)}</td><td class="num">${money(r.v_ibs)}</td><td class="num">${money(r.v_cbs)}</td></tr>`).join('')}
    <tr style="font-weight:600"><td>Total</td><td></td><td class="num">${soma(L, 'n')}</td><td class="num">${T('v_nf')}</td><td class="num">${T('v_bc_icms')}</td><td class="num">${T('v_icms')}</td><td class="num">${T('v_st')}</td><td class="num">${T('v_ipi')}</td><td class="num">${T('v_pis')}</td><td class="num">${T('v_cofins')}</td><td class="num">${T('v_ibs')}</td><td class="num">${T('v_cbs')}</td></tr>
    </tbody></table></div></div>`;
}

// ---------------------------------------------------------------------------------------------
// Detalhe da nota
// ---------------------------------------------------------------------------------------------
async function detalhe(n, root) {
  let itens = [];
  try { itens = await q(sb.from('nfe_itens').select('*').eq('nota_id', n.id).order('n_item')); } catch (e) { return fail(e); }
  const conta = (id) => state.cad.contaById[id]?.nome || '—';
  const m = modal({ title: `NF-e ${n.numero} — ${parte(n)}`, wide: true, body: `
    <p class="small muted" style="margin-top:0">Emissão ${dateBR(n.emissao)} · ${esc(n.natureza || '')} · chave ${esc(n.chave)} · ${n.situacao}${(n.eventos || []).length ? ` · eventos: ${n.eventos.map(e => esc(e.descricao || e.tipo)).join(', ')}` : ''}</p>
    <div class="kpis" style="margin:0 0 12px">
      <div class="kpi"><div class="k-label">Valor da nota</div><div class="k-value">${money(n.v_nf)}</div><div class="k-sub">produtos ${money(n.v_prod)}${+n.v_desc ? ` · desc. ${money(n.v_desc)}` : ''}</div></div>
      <div class="kpi"><div class="k-label">ICMS</div><div class="k-value">${money(n.v_icms)}</div><div class="k-sub">BC ${money(n.v_bc_icms)}${+n.v_st ? ` · ST ${money(n.v_st)}` : ''}</div></div>
      <div class="kpi"><div class="k-label">IPI · PIS · COFINS</div><div class="k-value">${money(+n.v_ipi + +n.v_pis + +n.v_cofins)}</div><div class="k-sub">${money(n.v_ipi)} · ${money(n.v_pis)} · ${money(n.v_cofins)}</div></div>
      <div class="kpi"><div class="k-label">IBS · CBS</div><div class="k-value">${money(+n.v_ibs + +n.v_cbs)}</div><div class="k-sub">${money(n.v_ibs)} · ${money(n.v_cbs)}</div></div></div>
    <h3 style="margin:8px 0">Itens</h3>
    <div class="table-wrap" style="max-height:260px"><table><thead><tr><th>#</th><th>Produto</th><th>NCM</th><th>CFOP</th><th class="num">Qtde</th><th class="num">Valor</th><th>CST ICMS</th><th class="num">ICMS</th><th class="num">IPI</th><th class="num">PIS</th><th class="num">COFINS</th><th class="num">IBS+CBS</th></tr></thead><tbody>
    ${itens.map(i => `<tr><td>${i.n_item}</td><td class="wrap small">${esc(i.xprod)}<div class="muted">${esc(i.cprod || '')}</div></td><td>${esc(i.ncm || '')}</td><td>${esc(i.cfop || '')}</td><td class="num">${(+i.qcom).toLocaleString('pt-BR')} ${esc(i.ucom || '')}</td><td class="num">${money(i.vprod)}</td>
      <td>${esc(i.cst_icms || '')}${i.p_icms ? `<div class="small muted">${String(+i.p_icms).replace('.', ',')}%</div>` : ''}</td><td class="num">${money(i.v_icms)}</td><td class="num">${money(i.v_ipi)}</td><td class="num">${money(i.v_pis)}</td><td class="num">${money(i.v_cofins)}</td><td class="num">${money(+i.v_ibs + +i.v_cbs)}</td></tr>`).join('')}</tbody></table></div>
    <h3 style="margin:14px 0 8px">Parcelas, borderôs e recebimentos vinculados</h3>
    ${n.parcelas.length ? `<div class="table-wrap"><table><thead><tr><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th>Borderô FIDC (fundo · nº · data · título · valor)</th><th>Recebimentos (data · valor · conta · descrição)</th></tr></thead><tbody>
      ${n.parcelas.map(p => { const vs = n.vinc.filter(v => v.parcela_id === p.id), fs = n.fidc.filter(v => v.parcela_id === p.id); return `<tr><td>${p.numero}${p.a_vista ? ' (à vista)' : ''}</td><td>${dateBR(p.vencimento)}</td><td class="num">${money(p.valor)}</td>
        <td class="small">${fs.map(v => `${esc(v.t?.fundo)} · ${esc(v.t?.bordero)} · ${dateBR(v.t?.data_operacao)} · ${esc(v.t?.titulo)} · <span class="${Math.abs(+v.t?.valor - +p.valor) <= 0.05 ? '' : 'neg'}">${money(v.t?.valor)}</span>`).join('<br>') || '<span class="muted">—</span>'}</td>
        <td class="small">${vs.map(v => `${dateBR(v.l?.data)} · ${money(v.l?.valor)} · ${esc(conta(v.l?.conta_id))} · ${esc(v.l?.descricao || '')}${v.l && v.l.status !== 'Pago' ? ' <span class="badge aberto">título em aberto</span>' : ''}${podeEditar() ? ` <button class="btn ghost small" data-dv="${v.id}" title="Desfazer este vínculo">✕</button>` : ''}`).join('<br>') || '<span class="muted">—</span>'}</td></tr>`; }).join('')}
      ${n.vinc.filter(v => !v.parcela_id).length ? `<tr><td colspan="4" class="small">Vinculados à nota (sem parcela definida)</td><td class="small">${n.vinc.filter(v => !v.parcela_id).map(v => `${dateBR(v.l?.data)} · ${money(v.l?.valor)} · ${esc(conta(v.l?.conta_id))} · ${esc(v.l?.descricao || '')}${v.l && v.l.status !== 'Pago' ? ' <span class="badge aberto">título em aberto</span>' : ''}${podeEditar() ? ` <button class="btn ghost small" data-dv="${v.id}" title="Desfazer este vínculo">✕</button>` : ''}`).join('<br>')}</td></tr>` : ''}
      </tbody></table></div>` : '<p class="small muted">Nota sem parcelas (sem financeiro).</p>'}`,
    foot: `<span style="margin-right:auto;display:flex;gap:6px">${podeEditar() && n.tipo === 'saida' && n.situacao === 'autorizada' ? '<button class="btn" id="mcanc">Marcar como cancelada</button>' : ''}${podeEditar() && (n.eventos || []).some(x => x.tipo === 'cancelamento_manual') && n.situacao === 'cancelada' ? '<button class="btn" id="dcanc">Desfazer cancelamento informado</button>' : ''}${podeEditar() && n.vinc.length ? '<button class="btn danger" id="desv">Desfazer vínculos de recebimento</button>' : ''}${podeEditar() && n.fidc.length ? '<button class="btn danger" id="desf">Desfazer ligação com borderô</button>' : ''}</span><button class="btn" id="xml">Baixar XML</button><button class="btn" data-close>Fechar</button>` });
  $('#xml', m.el).onclick = async () => {
    try { const r = await q(sb.from('nfe_notas').select('xml').eq('id', n.id).single()); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.xml || ''], { type: 'application/xml' })); a.download = `${n.chave}.xml`; a.click(); } catch (e) { fail(e); }
  };
  $('#desv', m.el) && ($('#desv', m.el).onclick = async () => {
    if (!confirm(`Desfazer os ${n.vinc.length} vínculo(s) desta nota com lançamentos? Os lançamentos não são alterados.`)) return;
    try { await q(sb.from('nfe_vinculos').delete().eq('nota_id', n.id)); toast('Vínculos desfeitos'); m.close(); carregar(root); } catch (e) { fail(e); }
  });
  $('#mcanc', m.el) && ($('#mcanc', m.el).onclick = () => { m.close(); marcarCancelada(n.id, '', () => carregar(root)); });
  $('#dcanc', m.el) && ($('#dcanc', m.el).onclick = () => { m.close(); desfazerCancelamento(n, () => carregar(root)); });
  m.el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-dv]'); if (!b) return;
    const v = n.vinc.find(x => x.id === b.dataset.dv);
    if (!confirm(`Desfazer o vínculo com o recebimento de ${dateBR(v?.l?.data)} (${money(v?.l?.valor)})? O lançamento não é alterado.`)) return;
    try { await q(sb.from('nfe_vinculos').delete().eq('id', b.dataset.dv)); toast('Vínculo desfeito'); m.close(); await carregar(root); detalhe(D.notas.find(x => x.id === n.id), root); } catch (e) { fail(e); }
  });
  $('#desf', m.el) && ($('#desf', m.el).onclick = async () => {
    if (!confirm(`Desfazer a ligação desta nota com ${n.fidc.length} título(s) de borderô? O borderô e os títulos da base FIDC não são alterados.`)) return;
    try { await q(sb.from('nfe_fidc_vinculos').delete().eq('nota_id', n.id)); toast('Ligação com borderô desfeita'); m.close(); carregar(root); } catch (e) { fail(e); }
  });
}

// ---------------------------------------------------------------------------------------------
// Borderôs FIDC: liga cada título da base FIDC à parcela da nota (nada nos borderôs é alterado)
// ---------------------------------------------------------------------------------------------
const CATB = {
  exata: ['Título = parcela', 'pago', true, 'O título do borderô cita a nota e a parcela, e o valor é o mesmo.'],
  valor_diferente: ['Valor do título diferente', 'aberto', false, 'Achou a parcela, mas o título foi descontado por outro valor (título parcial, nota alterada…). Confira antes de ligar.'],
  outro_sacado: ['Sacado ≠ cliente da nota', 'vencido', false, 'O CNPJ do sacado no borderô é de outra empresa. Provavelmente é outra nota com o mesmo número — confira.'],
  sem_parcela: ['Parcela não identificada', 'vencido', false, 'O título cita a nota, mas não dá para saber a parcela (sem nº e com valor diferente, ou parcela já ligada). Se marcar, liga só à nota.'],
};
let BOR = null; const marcB = new Set();

async function pintarBorderos(c, root) {
  if (ui.tipo !== 'saida') { c.innerHTML = '<div class="card"><div class="empty">Borderôs valem para as notas de saída.</div></div>'; return; }
  c.innerHTML = '<div class="loading">Procurando os títulos das notas nos borderôs…</div>';
  try {
    const notas = D.notas.filter(n => n.tipo === 'saida' && n.situacao === 'autorizada');
    const maxV = notas.flatMap(n => n.parcelas.map(p => p.vencimento)).filter(Boolean).sort().pop() || D.fim;
    const tits = await fetchAll(() => sb.from('fidc_titulos').select('id,fundo,bordero,data_operacao,titulo,vencimento,valor,cnpj_sacado,sacado,v:nfe_fidc_vinculos(id)')
      .eq('empresa_id', state.empresa.id).gte('data_operacao', D.ini).lte('data_operacao', maxV).order('data_operacao'));
    const livres = tits.filter(t => !t.v?.length);
    const ocupadas = new Set(notas.flatMap(n => n.fidc.map(v => v.parcela_id).filter(Boolean)));
    BOR = casarBorderos(notas, livres, ocupadas);
    marcB.clear(); BOR.grupos.forEach((g, i) => { g.i = i; if (CATB[g.cat][2]) marcB.add(i); });
  } catch (err) { fail(err); c.innerHTML = ''; return; }
  desenharBorderos(c, root);
}

function desenharBorderos(c, root) {
  const G = BOR.grupos, por = (k) => G.filter(g => g.cat === k), vt = (L) => L.reduce((s, g) => s + +g.titulo.valor, 0);
  const ligados = D.notas.flatMap(n => n.fidc);
  const venc = (g) => g.parcela && g.titulo.vencimento && g.titulo.vencimento !== g.parcela.vencimento ? ` <span class="small muted">(borderô ${dateBR(g.titulo.vencimento)})</span>` : '';
  c.innerHTML = `<div class="card"><p class="small" style="margin-top:0">Liga cada título dos borderôs (base FIDC) à parcela da nota de onde ele veio. Borderôs, títulos, lançamentos e notas <strong>não são alterados</strong>.
      Os casos verdes vêm marcados; os amarelos e vermelhos ficam para você conferir.</p>
    <div class="kpis" style="margin:0">
      <div class="kpi"><div class="k-label"><span class="badge pago">Já ligados</span></div><div class="k-value">${ligados.length}</div><div class="k-sub">${money(ligados.reduce((s, v) => s + (+v.t?.valor || 0), 0))}</div></div>
      ${Object.entries(CATB).map(([k, [t, cor]]) => `<div class="kpi"><div class="k-label"><span class="badge ${cor}">${t}</span></div><div class="k-value">${por(k).length}</div><div class="k-sub">${money(vt(por(k)))}</div></div>`).join('')}
      <div class="kpi"><div class="k-label"><span class="badge">Parcelas fora de borderô</span></div><div class="k-value">${BOR.fora.length}</div><div class="k-sub">${money(BOR.fora.reduce((s, x) => s + +x.parcela.valor, 0))} · a prazo</div></div></div>
    ${podeEditar() && G.length ? `<div class="toolbar" style="margin-top:8px"><button class="btn primary" id="gravab" ${marcB.size ? '' : 'disabled'}>Ligar ${marcB.size} título(s) marcado(s)</button></div>` : ''}</div>
    ${ligados.length ? `<div class="card"><p class="small" style="margin:0">Os borderôs (fundo, custos, líquido, títulos e aprovação) ficam em <a href="#/fidc-propostas">Propostas de borderô</a> › aba Propostas. Aqui fica só a ligação dos títulos com as notas.</p></div>` : ''}
    ${Object.entries(CATB).map(([k, [t, cor, , dica]]) => { const L = por(k); if (!L.length) return ''; return `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2><span class="badge ${cor}">${t}</span> ${L.length}</h2><p class="muted small">${dica}</p></div>
      ${podeEditar() ? `<div style="display:flex;gap:6px"><button class="btn small" data-todos="${k}" data-v="1">Marcar todos</button><button class="btn small" data-todos="${k}" data-v="0">Desmarcar</button></div>` : ''}</div>
      <div class="table-wrap" style="max-height:${k === 'exata' ? 320 : 420}px"><table><thead><tr><th></th><th>Fundo · borderô</th><th>Data</th><th>Título</th><th>Sacado (borderô)</th><th class="num">Valor título</th><th>NF / parcela</th><th>Cliente da nota</th><th>Vencimento</th><th class="num">Valor parcela</th></tr></thead><tbody>
      ${L.map(g => `<tr data-g="${g.i}"><td><input type="checkbox" ${marcB.has(g.i) ? 'checked' : ''}></td><td>${esc(g.titulo.fundo)} · ${esc(g.titulo.bordero)}</td><td>${dateBR(g.titulo.data_operacao)}</td><td>${esc(g.titulo.titulo)}</td>
        <td class="wrap small">${esc(g.titulo.sacado || '')}${g.titulo.cnpj_sacado ? `<div class="muted">${esc(g.titulo.cnpj_sacado)}</div>` : ''}</td><td class="num">${money(g.titulo.valor)}</td>
        <td>${g.nota.numero}${g.parcela ? ` / ${g.parcela.a_vista ? 'à vista' : g.parcela.numero}` : ` <span class="small muted">(${g.nota.parcelas.length} parcela(s))</span>`}</td><td class="wrap small">${esc(g.nota.dest_nome || '')}</td>
        <td class="small">${g.parcela ? dateBR(g.parcela.vencimento) + venc(g) : ''}</td>
        <td class="num ${g.parcela && Math.abs(+g.parcela.valor - +g.titulo.valor) > 0.05 ? 'neg' : ''}">${g.parcela ? money(g.parcela.valor) : money(g.nota.parcelas.reduce((s, p) => s + +p.valor, 0))}</td></tr>`).join('')}
      </tbody></table></div></div>`; }).join('')}
    ${BOR.fora.length ? `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2><span class="badge">Parcelas a prazo fora de borderô</span> ${BOR.fora.length}</h2><p class="muted small">Nenhum título de borderô cita estas parcelas: ficaram em carteira / cobrança própria. Só para consulta.</p></div></div>
      <div class="table-wrap" style="max-height:360px"><table><thead><tr><th>NF / parcela</th><th>Cliente</th><th>Vencimento</th><th class="num">Valor</th><th>Recebimento vinculado</th></tr></thead><tbody>
      ${BOR.fora.map(x => { const vs = x.nota.vinc.filter(v => v.parcela_id === x.parcela.id); return `<tr><td>${x.nota.numero} / ${x.parcela.numero}</td><td class="wrap small">${esc(x.nota.dest_nome || '')}</td><td>${dateBR(x.parcela.vencimento)}</td><td class="num">${money(x.parcela.valor)}</td>
        <td class="small">${vs.map(v => `${dateBR(v.l?.data)} · ${money(v.l?.valor)} · ${esc(state.cad.contaById[v.l?.conta_id]?.nome || '—')}`).join('<br>') || '<span class="muted">—</span>'}</td></tr>`; }).join('')}
      </tbody></table></div></div>` : ''}`;
  c.onchange = (e) => { const tr = e.target.closest('tr[data-g]'); if (!tr || e.target.type !== 'checkbox') return; e.target.checked ? marcB.add(+tr.dataset.g) : marcB.delete(+tr.dataset.g); const b = $('#gravab', c); if (b) { b.disabled = !marcB.size; b.textContent = `Ligar ${marcB.size} título(s) marcado(s)`; } };
  c.onclick = async (e) => {
    const t = e.target.closest('[data-todos]'); if (t) { for (const g of G.filter(g => g.cat === t.dataset.todos)) t.dataset.v === '1' ? marcB.add(g.i) : marcB.delete(g.i); return desenharBorderos(c, root); }
    if (e.target.id !== 'gravab') return;
    const sel = G.filter(g => marcB.has(g.i));
    const rows = sel.map(g => ({ empresa_id: state.empresa.id, nota_id: g.nota.id, parcela_id: g.parcela?.id || null, fidc_titulo_id: g.titulo.id, tipo: g.cat === 'exata' || g.cat === 'valor_diferente' ? g.cat : 'manual' }));
    if (!rows.length || !confirm(`Ligar ${rows.length} título(s) de borderô às notas? Borderôs, títulos e lançamentos não serão alterados.`)) return;
    e.target.disabled = true;
    try { for (const ch of chunks(rows, 300)) await q(sb.from('nfe_fidc_vinculos').insert(ch)); toast(`${rows.length} título(s) ligado(s)`); await carregar(root); }
    catch (err) { fail(String(err.message || err).includes('duplicate') ? new Error('Algum título já estava ligado a outra nota. Recarregue a página.') : err); e.target.disabled = false; }
  };
}

// Localiza o cadastro (cliente/fornecedor) da nota: CNPJ completo, raiz do CNPJ (filial) e, por fim, nome
const normN = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
function localizadorFav() {
  const favs = state.cad.favorecidos; const d = (f) => String(f.documento || '').replace(/\D/g, '');
  const CLI = ['CLIENTES', 'TERCEIROS - CLIENTES'];
  const porDoc = new Map(), porRaiz = new Map(), porNome = new Map();
  for (const f of favs) { const x = d(f); if (x) { porDoc.set(x, f); if (x.length === 14 && !porRaiz.has(x.slice(0, 8))) porRaiz.set(x.slice(0, 8), f); } const k = normN(f.nome); if (!porNome.has(k) || CLI.includes(f.tipo)) porNome.set(k, f); }
  return (doc, nome, cliente) => {
    const x = String(doc || '').replace(/\D/g, '');
    const pref = (f) => f && (cliente ? CLI.includes(f.tipo) : f.tipo === 'FORNECEDORES') ? f : null;
    return porDoc.get(x) || (x.length === 14 ? porRaiz.get(x.slice(0, 8)) : null) || pref(porNome.get(normN(nome))) || porNome.get(normN(nome)) || null;
  };
}
// liga ao cadastro as notas ainda sem cliente/fornecedor (depois de atualizar os cadastros)
async function ligarFavorecidos() {
  await loadCadastros(true);
  const acharFav = localizadorFav(); const e = state.empresa.id;
  const sem = await fetchAll(() => sb.from('nfe_notas').select('id,tipo,finalidade,emissao_propria,dest_doc,dest_nome,emit_doc,emit_nome').eq('empresa_id', e).is('favorecido_id', null));
  const grupos = new Map();
  for (const n of sem) { const out = n.tipo === 'saida' || n.emissao_propria; const f = acharFav(out ? n.dest_doc : n.emit_doc, out ? n.dest_nome : n.emit_nome, n.tipo === 'saida' && n.finalidade !== '4'); if (f) (grupos.get(f.id) || grupos.set(f.id, []).get(f.id)).push(n.id); }
  let k = 0; for (const [fid, ids] of grupos) for (const c of chunks(ids, 200)) { await q(sb.from('nfe_notas').update({ favorecido_id: fid }).in('id', c)); k += c.length; }
  return k;
}

// ---------------------------------------------------------------------------------------------
// Importação dos XML
// ---------------------------------------------------------------------------------------------
function importar(root) {
  let textos = [], prep = null;
  const m = modal({ title: 'Importar notas fiscais (XML)', wide: true,
    body: `<p class="small muted" style="margin-top:0">Selecione a pasta do mês (ex.: <em>1.7 NF-e Saídas (XML)</em>), os arquivos XML ou um .zip. Entradas e saídas são reconhecidas pelo próprio XML.
      Notas já importadas (mesma chave) são ignoradas; eventos de cancelamento e carta de correção são aplicados. Os lançamentos não são alterados.</p>
      <div class="toolbar"><label>Pasta<input type="file" id="ni-pasta" webkitdirectory directory multiple></label><label>ou arquivos XML / .zip<input type="file" id="ni-arq" accept=".xml,.zip" multiple></label></div>
      <div id="ni-res" style="margin-top:12px"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="ni-ok" disabled>Importar</button>' });
  const ler = async (files) => {
    if (!files.length) return;
    $('#ni-res', m.el).innerHTML = `<p class="small">Lendo ${files.length} arquivo(s)…</p>`;
    try {
      textos = await lerArquivos(files);
      const lidos = textos.map(t => { const r = lerNFeCompleta(t.xml); if (r?.tipo === 'nfe') r.arquivo = t.nome; if (r?.tipo === 'nfe') r.xml = t.xml; return r; }).filter(Boolean);
      prep = prepararNotas(lidos, state.empresa?.cnpj); prep.naoNFe = textos.length - lidos.length;
      const ch = prep.notas.map(n => n.nota.chave); const exist = new Set();
      for (const c of chunks(ch, 100)) for (const r of await q(sb.from('nfe_notas').select('chave').eq('empresa_id', state.empresa.id).in('chave', c))) exist.add(r.chave);
      prep.novas = prep.notas.filter(n => !exist.has(n.nota.chave)); prep.existentes = prep.notas.filter(n => exist.has(n.nota.chave));
      const t = (L, f) => L.reduce((s, n) => s + (+n.nota[f] || 0), 0);
      const S = prep.novas.filter(n => n.nota.tipo === 'saida'), E = prep.novas.filter(n => n.nota.tipo === 'entrada');
      const meses = [...new Set(prep.novas.map(n => n.nota.emissao.slice(0, 7)))].sort();
      $('#ni-res', m.el).innerHTML = `<div class="kpis" style="margin:0">
        <div class="kpi"><div class="k-label">Notas novas</div><div class="k-value">${prep.novas.length}</div><div class="k-sub">${S.length} saída(s) · ${E.length} entrada(s) · emissão ${meses.map(x => x.slice(5) + '/' + x.slice(0, 4)).join(', ') || '—'}</div></div>
        <div class="kpi"><div class="k-label">Valor das saídas</div><div class="k-value">${money(t(S.filter(n => n.nota.situacao === 'autorizada'), 'v_nf'))}</div><div class="k-sub">${S.reduce((s, n) => s + n.itens.length, 0)} itens · ICMS ${money(t(S, 'v_icms'))}</div></div>
        <div class="kpi"><div class="k-label">Já importadas</div><div class="k-value">${prep.existentes.length}</div><div class="k-sub">conferidas: completa o que faltar (itens, parcelas, eventos)</div></div>
        <div class="kpi"><div class="k-label">Eventos</div><div class="k-value">${prep.eventos.length}</div><div class="k-sub">${prep.notas.filter(n => n.nota.situacao === 'cancelada').length} cancelamento(s) · ${prep.eventos.filter(e => e.tpEvento === '110110').length} carta(s) de correção</div></div></div>
        ${prep.ignoradas.length ? `<p class="small muted">${prep.ignoradas.length} nota(s) ignorada(s): ${[...new Set(prep.ignoradas.map(x => x.motivo))].join(', ')}.</p>` : ''}
        ${prep.repetidas ? `<p class="small muted">${prep.repetidas} XML repetido(s) na seleção (mesma chave) — considerados uma vez.</p>` : ''}
        ${prep.naoNFe ? `<p class="small muted">${prep.naoNFe} arquivo(s) não são NF-e.</p>` : ''}`;
      $('#ni-ok', m.el).disabled = !prep.notas.length;
    } catch (err) { fail(err); $('#ni-res', m.el).innerHTML = ''; }
  };
  $('#ni-pasta', m.el).onchange = (e) => ler([...e.target.files]);
  $('#ni-arq', m.el).onchange = (e) => ler([...e.target.files]);
  // parcelas da nota (sempre com as mesmas colunas, para o insert em lote)
  const parcelasDe = (x) => {
    const n = x.nota;
    if (x.parcelas.length) return x.parcelas.map(p => ({ numero: p.numero, vencimento: p.vencimento, valor: p.valor, a_vista: false }));
    // venda sem duplicatas: parcela única à vista (não vale para remessa/bonificação/devolução)
    if (n.tipo === 'saida' && n.finalidade === '1' && n.cfops.some(c => !CFOP_SEM_FINANCEIRO.has(c))) return [{ numero: 1, vencimento: n.emissao, valor: n.v_nf, a_vista: true }];
    return [];
  };
  // Grava de forma retomável: a cada lote confere o que já está no banco e só completa o que falta
  // (nota, itens, parcelas). Importar de novo a mesma pasta nunca duplica e conserta importações interrompidas.
  $('#ni-ok', m.el).onclick = async () => {
    const btn = $('#ni-ok', m.el); btn.disabled = true; const e = state.empresa.id; let feitas = 0, novas = 0, completadas = 0;
    const acharFav = localizadorFav(); const todas = [...prep.novas, ...prep.existentes];
    try {
      for (const lote of chunks(todas, 25)) {
        btn.textContent = `Gravando ${feitas}/${todas.length}…`;
        const idPor = new Map();
        for (const r of await q(sb.from('nfe_notas').select('id,chave').eq('empresa_id', e).in('chave', lote.map(x => x.nota.chave)))) idPor.set(r.chave, r.id);
        const faltam = lote.filter(x => !idPor.has(x.nota.chave));
        if (faltam.length) {
          const rows = faltam.map(x => { const { tp_nf, ...n } = x.nota; const out = n.tipo === 'saida' || n.emissao_propria; const doc = String((out ? n.dest_doc : n.emit_doc) || '').replace(/\D/g, '');
            return { ...n, empresa_id: e, favorecido_id: acharFav(doc, out ? n.dest_nome : n.emit_nome, n.tipo === 'saida' && n.finalidade !== '4')?.id || null, arquivo: x.arquivo, xml: x.xml }; });
          for (const r of await q(sb.from('nfe_notas').insert(rows).select('id,chave'))) idPor.set(r.chave, r.id);
          novas += faltam.length;
        }
        const ids = [...idPor.values()];
        const comItens = new Set((await q(sb.from('nfe_itens').select('nota_id').in('nota_id', ids))).map(r => r.nota_id));
        const comParc = new Set((await q(sb.from('nfe_parcelas').select('nota_id').in('nota_id', ids))).map(r => r.nota_id));
        const itens = [], parcelas = [];
        for (const x of lote) {
          const id = idPor.get(x.nota.chave); let fez = false;
          if (!comItens.has(id) && x.itens.length) { itens.push(...x.itens.map(i => ({ ...i, empresa_id: e, nota_id: id }))); fez = true; }
          const ps = parcelasDe(x); if (!comParc.has(id) && ps.length) { parcelas.push(...ps.map(p => ({ ...p, empresa_id: e, nota_id: id }))); fez = true; }
          if (fez && !faltam.includes(x)) completadas++;
        }
        for (const ch of chunks(itens, 400)) await q(sb.from('nfe_itens').insert(ch));
        for (const ch of chunks(parcelas, 400)) await q(sb.from('nfe_parcelas').insert(ch));
        // eventos (cancelamento / carta de correção) em notas que já existiam
        for (const x of lote.filter(x => !faltam.includes(x) && x.nota.eventos.length)) await q(sb.from('nfe_notas').update({ eventos: x.nota.eventos, situacao: x.nota.situacao }).eq('id', idPor.get(x.nota.chave)));
        feitas += lote.length;
      }
      let auto = 0;
      try { const ids = []; for (const lote of chunks(todas.filter(x => x.nota.tipo === 'saida').map(x => x.nota.chave), 100)) for (const r of await q(sb.from('nfe_notas').select('id').eq('empresa_id', e).in('chave', lote))) ids.push(r.id); auto = await autoVincular(ids); }
      catch (err) { console.warn('vínculo automático', err); }
      toast(`${novas} nota(s) importada(s)${completadas ? ` · ${completadas} completada(s)` : ''}${auto ? ` · ${auto} recebimento(s) vinculado(s) automaticamente` : ''}`); m.close();
      const meses = [...new Set(todas.map(n => n.nota.emissao.slice(0, 7)))].sort(); if (meses.length) { ui.mes = meses[0]; ui.de = `${ui.mes}-01`; ui.ate = fimMes(ui.mes); }
      if (todas.some(n => n.nota.tipo === 'saida')) ui.tipo = 'saida';
      await render(root);
      // notas recentes: abre o lançamento das contas a receber (títulos em aberto para borderô/cobrança)
      const hoje = new Date().toISOString().slice(0, 10), lim = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
      const emSaida = todas.filter(n => n.nota.tipo === 'saida' && n.nota.situacao === 'autorizada').map(n => n.nota.emissao).sort();
      const contasReceber = () => { if (emSaida.length && emSaida.at(-1) >= lim) gerarContasReceber({ de: emSaida[0] > lim ? emSaida[0] : lim, ate: emSaida.at(-1) > hoje ? emSaida.at(-1) : hoje }, () => carregar(root)); };
      if (confirm('Notas gravadas. Quer conferir agora o cadastro dos clientes/fornecedores dessas notas (novos e diferenças para aprovação)?'))
        importarBeneficiariosNFe(async () => { const n = await ligarFavorecidos(); if (n) toast(`${n} nota(s) ligadas ao cadastro do cliente/fornecedor`); carregar(root); contasReceber(); }, { textos });
      else contasReceber();
    } catch (err) { fail(new Error(`Parou em ${feitas}/${todas.length}: ${err.message || err}. O que já foi gravado fica; clique em Importar de novo para completar (nada é duplicado).`)); btn.disabled = false; btn.textContent = 'Importar'; }
  };
}

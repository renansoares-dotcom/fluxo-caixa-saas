// Notas fiscais: importação dos XML (notas completas, itens e impostos), consulta por mês, impostos por CFOP
// e casamento das parcelas com os lançamentos de recebimento já existentes (vínculo só após aprovação).
import { sb, state, q, fetchAll, podeEditar, loadCadastros } from '../lib/data.js';
import { $, esc, money, dateBR, fail, toast, modal, exportXLSX } from '../lib/ui.js';
import { lerArquivos } from '../lib/nf-titulos.js';
import { lerNFeCompleta, prepararNotas, casarNotas, CFOP_SEM_FINANCEIRO } from '../lib/nfe-fiscal.js';
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
        <label>Tipo<select name="tipo"><option value="saida" ${ui.tipo === 'saida' ? 'selected' : ''}>Saídas (vendas)</option><option value="entrada" ${ui.tipo === 'entrada' ? 'selected' : ''}>Entradas</option></select></label>
        <label class="grow">Buscar<input name="busca" value="${esc(ui.busca)}" placeholder="nº, cliente, CNPJ, natureza"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="exp">Exportar Excel</button>
        ${podeEditar() ? '<button class="btn primary" id="imp">Importar XML</button>' : ''}
      </div></div>
      <div class="chips" id="abas" style="margin-top:12px">${[['notas', 'Notas'], ['impostos', 'Impostos por CFOP'], ['casamento', 'Casamento com lançamentos']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div class="kpis" id="kpis"></div>
    <div id="corpo"></div>`;
  $('#flt', root).addEventListener('change', (e) => { if (e.target.name !== 'busca') { ui[e.target.name] = e.target.value; carregar(root); } });
  let t; $('#flt [name=busca]', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ui.busca = e.target.value; pintar(root); }, 300); };
  $('#abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; root.querySelectorAll('#abas .chip').forEach(c => c.classList.toggle('on', c.dataset.a === a)); pintar(root); } };
  $('#imp', root) && ($('#imp', root).onclick = () => importar(root));
  $('#exp', root).onclick = () => exportXLSX($('#corpo table', root), `notas_${ui.tipo}_${ui.mes}`);
  await carregar(root);
}

async function carregar(root) {
  const e = state.empresa.id, ini = `${ui.mes}-01`, fim = fimMes(ui.mes);
  $('#corpo', root).innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const notas = await fetchAll(() => sb.from('nfe_notas').select(COLS).eq('empresa_id', e).eq('tipo', ui.tipo).gte('emissao', ini).lte('emissao', fim).order('numero'));
    const ids = notas.map(n => n.id); const parcelas = [], vinc = [];
    for (const c of chunks(ids)) {
      const [p, v] = await Promise.all([q(sb.from('nfe_parcelas').select('*').in('nota_id', c)), q(sb.from('nfe_vinculos').select('id,nota_id,parcela_id,lancamento_id,tipo').in('nota_id', c))]);
      parcelas.push(...p); vinc.push(...v);
    }
    const lv = new Map();
    for (const c of chunks([...new Set(vinc.map(v => v.lancamento_id))])) for (const l of await q(sb.from('lancamentos').select('id,data,valor,descricao,conta_id,status').in('id', c))) lv.set(l.id, l);
    for (const n of notas) { n.parcelas = parcelas.filter(p => p.nota_id === n.id).sort((a, b) => a.numero - b.numero); n.vinc = vinc.filter(v => v.nota_id === n.id).map(v => ({ ...v, l: lv.get(v.lancamento_id) })); }
    D = { notas, ini, fim };
  } catch (err) { fail(err); $('#corpo', root).innerHTML = '<div class="empty">Não foi possível carregar. A estrutura de notas fiscais foi criada?</div>'; return; }
  pintar(root);
}

const recebido = (n) => n.vinc.reduce((s, v) => s + (+v.l?.valor || 0), 0);
function statusFin(n) {
  if (n.situacao === 'cancelada') return '<span class="badge vencido">cancelada</span>';
  if (!n.parcelas.length) return '<span class="badge">sem financeiro</span>';
  const tot = soma(n.parcelas, 'valor'), r = recebido(n);
  if (!n.vinc.length) return '<span class="badge aberto">sem vínculo</span>';
  const pc = tot ? Math.round(r / tot * 100) : 0;
  return `<span class="badge ${pc >= 100 ? 'pago' : 'aberto'}">${pc >= 100 ? 'recebida' : `recebida ${pc}%`}</span>`;
}

function filtradas() {
  const b = ui.busca.trim().toLowerCase();
  return D.notas.filter(n => !b || `${n.numero} ${parte(n)} ${n.dest_doc} ${n.emit_doc} ${n.natureza} ${(n.cfops || []).join(' ')}`.toLowerCase().includes(b));
}

function pintar(root) {
  if (!D) return;
  const N = filtradas(), V = N.filter(venda), aut = N.filter(n => n.situacao === 'autorizada');
  const comFin = V.filter(n => n.parcelas.length), totParc = comFin.reduce((s, n) => s + soma(n.parcelas, 'valor'), 0), rec = comFin.reduce((s, n) => s + Math.min(recebido(n), soma(n.parcelas, 'valor')), 0);
  $('#kpis', root).innerHTML = `
    <div class="kpi"><div class="k-label">Notas no mês</div><div class="k-value">${aut.length}</div><div class="k-sub">${N.length - aut.length ? `${N.length - aut.length} cancelada(s) · ` : ''}${N.filter(n => n.finalidade === '4').length} devolução(ões)</div></div>
    <div class="kpi"><div class="k-label">${ui.tipo === 'saida' ? 'Faturamento (vendas)' : 'Valor das notas'}</div><div class="k-value">${money(soma(ui.tipo === 'saida' ? V : aut, 'v_nf'))}</div><div class="k-sub">produtos ${money(soma(ui.tipo === 'saida' ? V : aut, 'v_prod'))}</div></div>
    <div class="kpi"><div class="k-label">ICMS · IPI</div><div class="k-value">${money(soma(aut, 'v_icms'))}</div><div class="k-sub">IPI ${money(soma(aut, 'v_ipi'))}${soma(aut, 'v_st') ? ` · ST ${money(soma(aut, 'v_st'))}` : ''}</div></div>
    <div class="kpi"><div class="k-label">PIS · COFINS</div><div class="k-value">${money(soma(aut, 'v_pis') + soma(aut, 'v_cofins'))}</div><div class="k-sub">PIS ${money(soma(aut, 'v_pis'))} · COFINS ${money(soma(aut, 'v_cofins'))}</div></div>
    <div class="kpi"><div class="k-label">IBS · CBS (teste 2026)</div><div class="k-value">${money(soma(aut, 'v_ibs') + soma(aut, 'v_cbs'))}</div><div class="k-sub">IBS ${money(soma(aut, 'v_ibs'))} · CBS ${money(soma(aut, 'v_cbs'))}</div></div>
    ${ui.tipo === 'saida' ? `<div class="kpi"><div class="k-label">Parcelas com recebimento vinculado</div><div class="k-value">${totParc ? Math.round(rec / totParc * 100) : 0}%</div><div class="k-sub">${money(rec)} de ${money(totParc)}</div></div>` : ''}`;
  const c = $('#corpo', root);
  if (!D.notas.length) { c.innerHTML = `<div class="card"><div class="empty">Nenhuma nota ${ui.tipo === 'saida' ? 'de saída' : 'de entrada'} importada com emissão em ${dateBR(D.ini).slice(3)}. Use “Importar XML”.</div></div>`; return; }
  if (ui.aba === 'impostos') return pintarImpostos(c, N);
  if (ui.aba === 'casamento') return pintarCasamento(c, root);
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:66vh"><table><thead><tr><th>Nº</th><th>Emissão</th><th>${ui.tipo === 'saida' ? 'Cliente' : 'Emitente / destinatário'}</th><th>CFOP</th><th class="num">Valor</th><th class="num">ICMS</th><th class="num">IPI</th><th class="num">PIS+COFINS</th><th>Parcelas</th><th>Financeiro</th></tr></thead><tbody>
    ${N.map(n => `<tr class="clickable ${n.situacao === 'cancelada' ? 'muted' : ''}" data-id="${n.id}"><td>${n.numero}${n.serie !== '1' ? `<span class="muted small"> s.${esc(n.serie)}</span>` : ''}</td><td>${dateBR(n.emissao)}</td>
      <td class="wrap">${esc(parte(n))}<div class="small muted">${esc(n.natureza || '')}${n.finalidade === '4' ? ' · devolução' : ''}${(n.eventos || []).some(e => e.tipo === '110110') ? ' · carta de correção' : ''}</div></td>
      <td class="small">${esc((n.cfops || []).join(', '))}</td><td class="num">${money(n.v_nf)}</td><td class="num">${money(n.v_icms)}</td><td class="num">${money(n.v_ipi)}</td><td class="num">${money(+n.v_pis + +n.v_cofins)}</td>
      <td class="small">${n.parcelas.length ? `${n.parcelas.length}${n.parcelas[0].a_vista ? ' (à vista)' : ''}` : '—'}</td><td>${statusFin(n)}</td></tr>`).join('')}
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
    <h3 style="margin:14px 0 8px">Parcelas e recebimentos vinculados</h3>
    ${n.parcelas.length ? `<div class="table-wrap"><table><thead><tr><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th>Recebimentos (data · valor · conta · descrição)</th></tr></thead><tbody>
      ${n.parcelas.map(p => { const vs = n.vinc.filter(v => v.parcela_id === p.id); return `<tr><td>${p.numero}${p.a_vista ? ' (à vista)' : ''}</td><td>${dateBR(p.vencimento)}</td><td class="num">${money(p.valor)}</td><td class="small">${vs.map(v => `${dateBR(v.l?.data)} · ${money(v.l?.valor)} · ${esc(conta(v.l?.conta_id))} · ${esc(v.l?.descricao || '')}`).join('<br>') || '<span class="muted">—</span>'}</td></tr>`; }).join('')}
      ${n.vinc.filter(v => !v.parcela_id).length ? `<tr><td colspan="3" class="small">Vinculados à nota (sem parcela definida)</td><td class="small">${n.vinc.filter(v => !v.parcela_id).map(v => `${dateBR(v.l?.data)} · ${money(v.l?.valor)} · ${esc(conta(v.l?.conta_id))} · ${esc(v.l?.descricao || '')} <span class="badge">${v.tipo}</span>`).join('<br>')}</td></tr>` : ''}
      </tbody></table></div>` : '<p class="small muted">Nota sem parcelas (sem financeiro).</p>'}`,
    foot: `${podeEditar() && n.vinc.length ? '<button class="btn danger" id="desv" style="margin-right:auto">Desfazer vínculos desta nota</button>' : ''}<button class="btn" id="xml">Baixar XML</button><button class="btn" data-close>Fechar</button>` });
  $('#xml', m.el).onclick = async () => {
    try { const r = await q(sb.from('nfe_notas').select('xml').eq('id', n.id).single()); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.xml || ''], { type: 'application/xml' })); a.download = `${n.chave}.xml`; a.click(); } catch (e) { fail(e); }
  };
  $('#desv', m.el) && ($('#desv', m.el).onclick = async () => {
    if (!confirm(`Desfazer os ${n.vinc.length} vínculo(s) desta nota com lançamentos? Os lançamentos não são alterados.`)) return;
    try { await q(sb.from('nfe_vinculos').delete().eq('nota_id', n.id)); toast('Vínculos desfeitos'); m.close(); carregar(root); } catch (e) { fail(e); }
  });
}

// ---------------------------------------------------------------------------------------------
// Casamento com os lançamentos de recebimento
// ---------------------------------------------------------------------------------------------
const CAT = {
  exata: ['Casadas (parcela e valor)', 'pago', true, 'Mesma nota, mesma parcela e mesmo valor.'],
  soma: ['Vários recebimentos = parcela', 'pago', true, 'A parcela foi recebida em mais de um lançamento que somam o valor exato.'],
  nota: ['Recebimentos = restante da nota', 'pago', true, 'Os lançamentos citam a nota sem parcela clara, mas somam exatamente o que faltava.'],
  parcial: ['Recebido a menor', 'aberto', false, 'Lançamentos da nota somam menos que as parcelas (recebimento parcial, desconto, deságio ou parte ainda em aberto).'],
  valor_diferente: ['Recebido a maior', 'vencido', false, 'Lançamentos que citam a nota somam mais que as parcelas — confira se não são de outra nota/cliente.'],
  pendente: ['Parcelas sem recebimento', 'aberto', null, 'Nenhum lançamento encontrado para a parcela (ainda a receber, ou recebido com outra descrição).'],
};
let CAS = null; const marcados = new Set();

async function pintarCasamento(c, root) {
  if (ui.tipo !== 'saida') { c.innerHTML = '<div class="card"><div class="empty">O casamento com recebimentos vale para as notas de saída.</div></div>'; return; }
  c.innerHTML = '<div class="loading">Procurando os recebimentos das notas…</div>';
  try {
    const e = state.empresa.id;
    const notas = D.notas.filter(n => n.tipo === 'saida' && n.finalidade === '1');
    // parcelas ainda sem vínculo
    // só o que falta: parcelas ainda sem vínculo (notas totalmente vinculadas ou vinculadas "pela nota" ficam fora)
    const N = notas.filter(n => n.situacao === 'cancelada' || !n.vinc.some(v => !v.parcela_id))
      .map(n => ({ ...n, parcelas: n.parcelas.filter(p => !n.vinc.some(v => v.parcela_id === p.id)) }))
      .filter(n => n.situacao === 'cancelada' || n.parcelas.length || !D.notas.find(x => x.id === n.id).parcelas.length);
    const receitas = state.cad.contasPlano.filter(p => p.codigo.startsWith('1.01')).map(p => p.id);
    const maxV = notas.flatMap(n => n.parcelas.map(p => p.vencimento)).filter(Boolean).sort().pop() || D.fim;
    const ls = await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,favorecido_id,conta_id,status').eq('empresa_id', e).in('plano_id', receitas).gte('data', addDias(D.ini, -20)).lte('data', addDias(maxV, 120)).order('data'));
    const usados = new Set();
    for (const ch of chunks(ls.map(l => l.id), 200)) for (const v of await q(sb.from('nfe_vinculos').select('lancamento_id').in('lancamento_id', ch))) usados.add(v.lancamento_id);
    const livres = ls.filter(l => !usados.has(l.id)).map(l => ({ ...l, fav_doc: state.cad.favById[l.favorecido_id]?.documento || null, fav_nome: state.cad.favById[l.favorecido_id]?.nome || '' }));
    CAS = casarNotas(N, livres);
    marcados.clear(); CAS.grupos.forEach((g, i) => { g.i = i; if (CAT[g.cat][2]) marcados.add(i); });
  } catch (err) { fail(err); c.innerHTML = ''; return; }
  desenharCasamento(c, root);
}

function desenharCasamento(c, root) {
  const G = CAS.grupos; const por = (k) => G.filter(g => g.cat === k);
  const conta = (id) => state.cad.contaById[id]?.nome || '—';
  const nMarc = [...marcados].length;
  c.innerHTML = `<div class="card"><p class="small" style="margin-top:0">O casamento só <strong>liga</strong> a parcela da nota ao lançamento de recebimento: data, valor, conta e conciliação dos lançamentos não mudam.
      As categorias verdes vêm marcadas; as amarelas e vermelhas ficam para você conferir e marcar.</p>
    <div class="kpis" style="margin:0">${Object.entries(CAT).map(([k, [t, cor]]) => { const L = por(k); return `<div class="kpi"><div class="k-label"><span class="badge ${cor}">${t}</span></div><div class="k-value">${L.length}</div><div class="k-sub">notas ${money(soma(L, 'valorNota'))}${k !== 'pendente' ? ` · lanç. ${money(soma(L, 'valorLanc'))}` : ''}</div></div>`; }).join('')}
      <div class="kpi"><div class="k-label"><span class="badge">Sem financeiro</span></div><div class="k-value">${CAS.semFinanceiro.length}</div><div class="k-sub">remessas/bonificações ${money(soma(CAS.semFinanceiro, 'v_nf'))}</div></div></div>
    ${CAS.outroCliente.length ? `<p class="small neg">${CAS.outroCliente.length} lançamento(s) citam o número de uma nota mas são de outro cliente — não foram casados: ${CAS.outroCliente.slice(0, 8).map(x => `NF ${x.nota.numero} × ${esc(x.lanc.descricao)} (${money(x.lanc.valor)})`).join('; ')}</p>` : ''}
    ${CAS.cancelados.length ? `<p class="small neg">Notas canceladas citadas em lançamentos: ${CAS.cancelados.map(x => `NF ${x.nota.numero} (${x.lancs.length} lanç.)`).join(', ')}</p>` : ''}
    ${podeEditar() ? `<div class="toolbar" style="margin-top:8px"><button class="btn primary" id="grava" ${nMarc ? '' : 'disabled'}>Gravar ${nMarc} vínculo(s) marcado(s)</button></div>` : ''}</div>
    ${Object.entries(CAT).map(([k, [t, cor, , dica]]) => { const L = por(k); if (!L.length) return ''; return `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2><span class="badge ${cor}">${t}</span> ${L.length}</h2><p class="muted small">${dica}</p></div>
      ${k !== 'pendente' && podeEditar() ? `<div style="display:flex;gap:6px"><button class="btn small" data-todos="${k}" data-v="1">Marcar todos</button><button class="btn small" data-todos="${k}" data-v="0">Desmarcar</button></div>` : ''}</div>
      <div class="table-wrap" style="max-height:${k === 'exata' ? 300 : 420}px"><table><thead><tr>${k !== 'pendente' ? '<th></th>' : ''}<th>NF / parcela</th><th>Cliente</th><th>Vencimento</th><th class="num">Valor nota</th><th>Recebimentos (data · valor · conta · descrição)</th><th class="num">Recebido</th></tr></thead><tbody>
      ${L.map(g => { const ps = g.parcelas || (g.parcela ? [g.parcela] : []); return `<tr data-g="${g.i}">${k !== 'pendente' ? `<td><input type="checkbox" ${marcados.has(g.i) ? 'checked' : ''}></td>` : ''}
        <td>${g.nota.numero}${ps.length ? ` / ${ps.map(p => p.a_vista ? 'à vista' : p.numero).join(', ')}` : ''}</td><td class="wrap small">${esc(g.nota.dest_nome || '')}</td><td class="small">${ps.map(p => dateBR(p.vencimento)).join(', ')}</td>
        <td class="num">${money(g.valorNota)}</td><td class="small">${g.lancs.map(l => `${dateBR(l.data)} · ${money(l.valor)} · ${esc(conta(l.conta_id))} · ${esc(l.descricao || '')}`).join('<br>') || (g.possiveis?.length ? `<span class="muted">Possíveis do mesmo cliente (sem citar a nota):</span><br>${g.possiveis.map(l => `${dateBR(l.data)} · ${money(l.valor)} · ${esc(conta(l.conta_id))} · ${esc(l.descricao || '')}`).join('<br>')}` : '<span class="muted">nenhum lançamento do cliente perto do vencimento</span>')}</td>
        <td class="num ${k === 'pendente' ? '' : Math.abs(g.valorLanc - g.valorNota) < 0.01 ? 'pos' : 'neg'}">${k === 'pendente' ? '' : money(g.valorLanc)}</td></tr>`; }).join('')}
      </tbody></table></div></div>`; }).join('')}`;
  c.onchange = (e) => { const tr = e.target.closest('tr[data-g]'); if (!tr || e.target.type !== 'checkbox') return; e.target.checked ? marcados.add(+tr.dataset.g) : marcados.delete(+tr.dataset.g); const b = $('#grava', c); if (b) { b.disabled = !marcados.size; b.textContent = `Gravar ${marcados.size} vínculo(s) marcado(s)`; } };
  c.onclick = async (e) => {
    const t = e.target.closest('[data-todos]'); if (t) { for (const g of G.filter(g => g.cat === t.dataset.todos)) t.dataset.v === '1' ? marcados.add(g.i) : marcados.delete(g.i); return desenharCasamento(c, root); }
    if (e.target.id !== 'grava') return;
    const sel = G.filter(g => marcados.has(g.i) && g.lancs.length);
    const rows = sel.flatMap(g => g.lancs.map(l => ({ empresa_id: state.empresa.id, nota_id: g.nota.id, parcela_id: g.parcela && !g.parcelas?.length ? g.parcela.id : (g.parcelas?.length === 1 ? g.parcelas[0].id : null), lancamento_id: l.id, tipo: g.cat })));
    if (!rows.length || !confirm(`Gravar ${rows.length} vínculo(s) entre ${sel.length} parcela(s)/nota(s) e lançamentos? Os lançamentos não serão alterados.`)) return;
    e.target.disabled = true;
    try { for (const ch of chunks(rows, 300)) await q(sb.from('nfe_vinculos').insert(ch)); toast(`${rows.length} vínculo(s) gravado(s)`); await carregar(root); }
    catch (err) { fail(String(err.message || err).includes('duplicate') ? new Error('Algum lançamento já estava vinculado a outra nota. Recarregue a página.') : err); e.target.disabled = false; }
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
        <div class="kpi"><div class="k-label">Já importadas</div><div class="k-value">${prep.existentes.length}</div><div class="k-sub">ignoradas (eventos novos são aplicados)</div></div>
        <div class="kpi"><div class="k-label">Eventos</div><div class="k-value">${prep.eventos.length}</div><div class="k-sub">${prep.notas.filter(n => n.nota.situacao === 'cancelada').length} cancelamento(s) · ${prep.eventos.filter(e => e.tpEvento === '110110').length} carta(s) de correção</div></div></div>
        ${prep.ignoradas.length ? `<p class="small muted">${prep.ignoradas.length} nota(s) ignorada(s): ${[...new Set(prep.ignoradas.map(x => x.motivo))].join(', ')}.</p>` : ''}
        ${prep.repetidas ? `<p class="small muted">${prep.repetidas} XML repetido(s) na seleção (mesma chave) — considerados uma vez.</p>` : ''}
        ${prep.naoNFe ? `<p class="small muted">${prep.naoNFe} arquivo(s) não são NF-e.</p>` : ''}`;
      $('#ni-ok', m.el).disabled = !(prep.novas.length || prep.existentes.some(n => n.nota.eventos.length));
    } catch (err) { fail(err); $('#ni-res', m.el).innerHTML = ''; }
  };
  $('#ni-pasta', m.el).onchange = (e) => ler([...e.target.files]);
  $('#ni-arq', m.el).onchange = (e) => ler([...e.target.files]);
  $('#ni-ok', m.el).onclick = async () => {
    const btn = $('#ni-ok', m.el); btn.disabled = true; const e = state.empresa.id; let feitas = 0;
    const acharFav = localizadorFav();
    try {
      for (const lote of chunks(prep.novas, 25)) {
        btn.textContent = `Gravando ${feitas}/${prep.novas.length}…`;
        const rows = lote.map(x => { const { tp_nf, ...n } = x.nota; const doc = String((n.tipo === 'saida' || n.emissao_propria ? n.dest_doc : n.emit_doc) || '').replace(/\D/g, '');
          return { ...n, empresa_id: e, favorecido_id: acharFav(doc, n.tipo === 'saida' || n.emissao_propria ? n.dest_nome : n.emit_nome, n.tipo === 'saida' && n.finalidade !== '4')?.id || null, arquivo: x.arquivo, xml: x.xml }; });
        const ins = await q(sb.from('nfe_notas').insert(rows).select('id,chave'));
        const idPor = new Map(ins.map(r => [r.chave, r.id]));
        const itens = lote.flatMap(x => x.itens.map(i => ({ ...i, empresa_id: e, nota_id: idPor.get(x.nota.chave) })));
        const parcelas = lote.flatMap(x => {
          const n = x.nota; const id = idPor.get(n.chave);
          if (x.parcelas.length) return x.parcelas.map(p => ({ ...p, empresa_id: e, nota_id: id }));
          // venda sem duplicatas: parcela única à vista (não vale para remessa/bonificação/devolução)
          if (n.tipo === 'saida' && n.finalidade === '1' && n.cfops.some(c => !CFOP_SEM_FINANCEIRO.has(c))) return [{ numero: 1, vencimento: n.emissao, valor: n.v_nf, a_vista: true, empresa_id: e, nota_id: id }];
          return [];
        });
        for (const ch of chunks(itens, 400)) await q(sb.from('nfe_itens').insert(ch));
        if (parcelas.length) await q(sb.from('nfe_parcelas').insert(parcelas));
        feitas += lote.length;
      }
      // eventos novos em notas já importadas (cancelamento / carta de correção)
      for (const x of prep.existentes.filter(x => x.nota.eventos.length)) await q(sb.from('nfe_notas').update({ eventos: x.nota.eventos, situacao: x.nota.situacao }).eq('empresa_id', e).eq('chave', x.nota.chave));
      toast(`${feitas} nota(s) importada(s)`); m.close();
      const meses = [...new Set(prep.novas.map(n => n.nota.emissao.slice(0, 7)))].sort(); if (meses.length) ui.mes = meses[0];
      if (prep.novas.some(n => n.nota.tipo === 'saida')) ui.tipo = 'saida';
      await render(root);
      if (confirm('Notas gravadas. Quer conferir agora o cadastro dos clientes/fornecedores dessas notas (novos e diferenças para aprovação)?'))
        importarBeneficiariosNFe(async () => { const n = await ligarFavorecidos(); if (n) toast(`${n} nota(s) ligadas ao cadastro do cliente/fornecedor`); carregar(root); }, { textos });
    } catch (err) { fail(new Error(`Parou após ${feitas} nota(s): ${err.message || err}. As já gravadas ficam; importe de novo para continuar (as repetidas são ignoradas).`)); btn.disabled = false; btn.textContent = 'Importar'; }
  };
}

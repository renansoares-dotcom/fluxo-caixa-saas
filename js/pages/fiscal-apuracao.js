// CPD › Fiscal › Apuração de impostos — memória de cálculo a partir dos itens das notas importadas.
// Etapa 1: livro por CFOP/CST (item a item) e resumo dos impostos destacados. Só leitura.
// Reforma tributária (30/10/2026): conferência IBS/CBS, simulador 2027 e alíquotas por vigência (js/lib/reforma-ui.js, SQL 072).
// As regras de apuração (PRODEPE, FEEF, AD/DIPER, FECEP, créditos de PIS/COFINS) entram quando os parâmetros forem definidos.
import { sb, state, fetchAll } from '../lib/data.js';
import { $, esc, money, dateBR, fail, loading, exportXLSX, MESES_CURTO } from '../lib/ui.js';
import { pintarAliquotas, pintarSimulador, pintarConferencia } from '../lib/reforma-ui.js';

export const title = 'Apuração de impostos';

const hoje = new Date(); const ant = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
const ui = { mes: `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`, aba: 'livro', lado: 'saidas', agrupar: 'cfop', abertas: new Set() };
let D = null;

const fimMes = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };
const r2 = (v) => Math.round(v * 100) / 100;

// descrição resumida do CFOP pelos 3 últimos dígitos (5/6 = saída; 1/2 = entrada)
const CFOP_S = { '101': 'Venda de produção do estabelecimento', '102': 'Venda de mercadoria adquirida de terceiros', '105': 'Venda de produção que não transita pelo estabelecimento',
  '106': 'Venda de mercadoria adquirida que não transita pelo estabelecimento', '108': 'Venda de mercadoria adquirida a não contribuinte', '118': 'Venda de produção entregue por conta e ordem do adquirente',
  '124': 'Industrialização efetuada para outra empresa', '125': 'Industrialização para outra empresa sem transitar', '201': 'Devolução de compra para industrialização',
  '202': 'Devolução de compra para comercialização', '252': 'Venda de energia elétrica para estabelecimento industrial', '253': 'Venda de energia elétrica para estabelecimento comercial',
  '401': 'Venda de produção com substituição tributária', '403': 'Venda de mercadoria adquirida com ST (substituto)', '405': 'Venda de mercadoria adquirida com ST (substituído)',
  '551': 'Venda de bem do ativo imobilizado', '553': 'Devolução de compra de bem do ativo imobilizado', '556': 'Devolução de compra de material de uso ou consumo',
  '655': 'Venda de combustível ou lubrificante (ST)', '656': 'Venda de combustível ou lubrificante a consumidor final', '901': 'Remessa para industrialização por encomenda',
  '902': 'Retorno de mercadoria usada em industrialização por encomenda', '910': 'Remessa em bonificação, doação ou brinde', '915': 'Remessa para conserto ou reparo',
  '916': 'Retorno de mercadoria recebida para conserto', '923': 'Remessa por conta e ordem de terceiros (venda à ordem)', '924': 'Remessa para industrialização por conta e ordem do adquirente',
  '925': 'Retorno de mercadoria recebida para industrialização por conta e ordem', '929': 'Lançamento de operação registrada em ECF', '949': 'Outra saída não especificada' };
const CFOP_E = { '101': 'Compra para industrialização', '102': 'Compra para comercialização', '201': 'Devolução de venda de produção', '202': 'Devolução de venda de mercadoria adquirida',
  '949': 'Outra entrada não especificada' };
const descCfop = (c) => { if (!c) return '—'; const d = c[0], f = c.slice(1); const t = (d === '1' || d === '2' || d === '3') ? CFOP_E[f] : CFOP_S[f]; const esc_ = d === '1' || d === '5' ? 'estadual' : d === '2' || d === '6' ? 'interestadual' : 'exterior'; return (t || 'Operação ' + c) + ` (${esc_})`; };

const AGR = { cfop: ['CFOP', (i) => i.cfop || '—'], cfop_cst: ['CFOP + CST ICMS', (i) => `${i.cfop || '—'} · CST ${i.cst_icms || '—'}`],
  cst_icms: ['CST ICMS', (i) => i.cst_icms || '—'], cst_ipi: ['CST IPI', (i) => i.cst_ipi || '—'], cst_pis: ['CST PIS/COFINS', (i) => `${i.cst_pis || '—'} / ${i.cst_cofins || '—'}`] };
const CAMPOS = [['vc', 'Valor contábil'], ['bc', 'Base ICMS'], ['icms', 'ICMS'], ['st', 'ICMS-ST'], ['ipi', 'IPI'], ['pis', 'PIS'], ['cofins', 'COFINS']];

export async function render(root) {
  root.innerHTML = `
    <div class="toolbar">
      <label>Mês<select id="mes">${[hoje.getFullYear() - 1, hoje.getFullYear()].flatMap(a => MESES_CURTO.map((n, i) => `${a}-${String(i + 1).padStart(2, '0')}`)).filter(m => m <= hoje.toISOString().slice(0, 7)).reverse()
        .map(m => `<option value="${m}" ${m === ui.mes ? 'selected' : ''}>${MESES_CURTO[+m.slice(5) - 1]}/${m.slice(0, 4)}</option>`).join('')}</select></label>
      <div class="chips" id="abas"></div>
      <span class="spacer"></span><button class="btn" id="exp">Exportar Excel</button>
    </div>
    <div id="info" class="muted small" style="margin-bottom:8px"></div>
    <div id="corpo"></div>`;
  $('#mes', root).onchange = (e) => { ui.mes = e.target.value; carregar(root); };
  $('#abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(root); } };
  $('#exp', root).onclick = () => { const t = $('#corpo table', root); if (t) exportXLSX(t, `apuracao_${ui.aba}_${ui.mes}`); };
  if (ui.aba === 'simulador' || ui.aba === 'aliquotas') return pintar(root);   // não dependem do mês
  await carregar(root);
}

async function carregar(root) {
  loading($('#corpo', root));
  try {
    const ini = ui.mes + '-01', fim = fimMes(ui.mes);
    const its = await fetchAll(() => sb.from('nfe_itens')
      .select('nota_id, cfop, cst_icms, cst_ipi, cst_pis, cst_cofins, vprod, vdesc, vfrete, voutro, v_bc_icms, v_icms, v_st, v_ipi, v_pis, v_cofins, nfe_notas!inner(id, numero, serie, emissao, tipo, situacao, emissao_propria, finalidade, emit_nome, dest_nome)')
      .eq('nfe_notas.empresa_id', state.empresa.id).gte('nfe_notas.emissao', ini).lte('nfe_notas.emissao', fim));
    const vc = (i) => (+i.vprod || 0) - (+i.vdesc || 0) + (+i.vfrete || 0) + (+i.voutro || 0) + (+i.v_ipi || 0) + (+i.v_st || 0);
    const itens = [], canc = new Map();
    for (const i of its) {
      const n = i.nfe_notas;
      const x = { ...i, n, lado: n.emissao_propria && n.tipo === 'saida' ? 'saidas' : 'entradas', terceiro: !n.emissao_propria,
        vc: vc(i), bc: +i.v_bc_icms || 0, icms: +i.v_icms || 0, st: +i.v_st || 0, ipi: +i.v_ipi || 0, pis: +i.v_pis || 0, cofins: +i.v_cofins || 0 };
      if (n.situacao !== 'autorizada') { canc.set(n.id, (canc.get(n.id) || 0) + x.vc); continue; }
      itens.push(x);
    }
    D = { itens, canc };
    $('#info', root).innerHTML = `${itens.length} itens de ${new Set(itens.map(i => i.nota_id)).size} notas autorizadas em ${MESES_CURTO[+ui.mes.slice(5) - 1]}/${ui.mes.slice(0, 4)}`
      + (canc.size ? ` · ${canc.size} nota(s) cancelada(s) fora da apuração (${money([...canc.values()].reduce((a, b) => a + b, 0))})` : '');
    pintar(root);
  } catch (e) { fail(e); $('#corpo', root).innerHTML = ''; }
}

function pintar(root) {
  $('#abas', root).innerHTML = [['livro', 'Livro por CFOP / CST'], ['resumo', 'Resumo dos impostos'], ['conferencia', 'Conferência IBS/CBS'], ['simulador', 'Reforma: simulador 2027'], ['aliquotas', 'Alíquotas por vigência'], ['regras', 'Regras e parâmetros']]
    .map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('');
  const c = $('#corpo', root);
  $('#exp', root).style.display = ['simulador', 'aliquotas', 'conferencia'].includes(ui.aba) ? 'none' : '';
  $('#info', root).style.display = ['simulador', 'aliquotas', 'conferencia'].includes(ui.aba) ? 'none' : '';
  $('#mes', root).closest('label').style.display = ['simulador', 'aliquotas'].includes(ui.aba) ? 'none' : '';
  if (ui.aba === 'aliquotas') return pintarAliquotas(c);
  if (ui.aba === 'simulador') return pintarSimulador(c);
  if (ui.aba === 'conferencia') return pintarConferencia(c, ui.mes);
  if (!D) return carregar(root);
  if (ui.aba === 'livro') return livro(c, root);
  if (ui.aba === 'resumo') return resumo(c);
  c.innerHTML = `<div class="card"><h2>Regras de apuração — aguardando parâmetros</h2>
    <p>Regime confirmado: <strong>Lucro Real</strong>, PIS/COFINS não cumulativo. Incentivo: <strong>PRODEPE</strong>.</p>
    <p class="small">Para calcular o imposto a recolher (e não só o destacado nas notas), faltam:</p>
    <ul class="small"><li>PRODEPE: percentual de crédito presumido, produtos/operações incentivadas e forma de cálculo do FEEF e da taxa AD/DIPER;</li>
      <li>FECEP: base e alíquota;</li><li>créditos de PIS/COFINS aceitos pela empresa (insumos, energia, fretes, depreciação, aluguéis…);</li>
      <li>uma apuração já feita pela contabilidade (livro de ICMS/IPI, EFD Contribuições e guias) para calibrar e conferir.</li></ul>
    <p class="small muted">Nada é calculado por suposição: cada regra entra com fonte (lei/regime/apuração da contabilidade) e data de vigência.</p></div>`;
}

function soma(arr) { const t = { vc: 0, bc: 0, icms: 0, st: 0, ipi: 0, pis: 0, cofins: 0, notas: new Set() }; for (const i of arr) { for (const [k] of CAMPOS) t[k] += i[k]; t.notas.add(i.nota_id); } return t; }

function livro(c, root) {
  const sel = D.itens.filter(i => i.lado === ui.lado);
  const [titAgr, chave] = AGR[ui.agrupar];
  const g = new Map(); for (const i of sel) { const k = chave(i); (g.get(k) || g.set(k, []).get(k)).push(i); }
  const grupos = [...g].map(([k, arr]) => ({ k, arr, t: soma(arr) })).sort((a, b) => b.t.vc - a.t.vc);
  const T = soma(sel);
  c.innerHTML = `
    <div class="toolbar" style="margin-bottom:8px">
      <div class="chips" id="lado">${[['saidas', 'Saídas (notas emitidas)'], ['entradas', 'Entradas (compras e devoluções)']].map(([k, t]) => `<span class="chip ${ui.lado === k ? 'on' : ''}" data-l="${k}">${t}</span>`).join('')}</div>
      <label>Agrupar por<select id="agr">${Object.entries(AGR).map(([k, [t]]) => `<option value="${k}" ${k === ui.agrupar ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <div class="kpis" style="margin-bottom:12px">${[['Notas', T.notas.size, 0], ...CAMPOS.filter(([k]) => k !== 'st' || T.st).map(([k, t]) => [t, T[k], 1])]
      .map(([t, v, m]) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value">${m ? money(v) : v}</div></div>`).join('')}</div>
    ${ui.lado === 'entradas' ? '<p class="small muted" style="margin:0 0 8px">Nas notas de fornecedores o CFOP e o CST são os do emitente (a operação vista por quem vendeu). O ICMS e o IPI destacados são a base dos créditos; PIS/COFINS de crédito serão calculados pelas regras da empresa.</p>' : ''}
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>${titAgr}</th><th>Descrição</th><th class="num">Notas</th>${CAMPOS.map(([, t]) => `<th class="num">${t}</th>`).join('')}</tr></thead><tbody>
      ${grupos.map(gr => { const ab = ui.abertas.has(gr.k);
        const linha = `<tr class="dre-l" data-k="${esc(gr.k)}"><td class="nowrap"><span class="bal-tg">${ab ? '▾' : '▸'}</span>${esc(gr.k)}</td><td class="small">${ui.agrupar.startsWith('cfop') ? esc(descCfop(gr.arr[0].cfop)) : ''}</td><td class="num">${gr.t.notas.size}</td>${CAMPOS.map(([k]) => `<td class="num">${money(gr.t[k])}</td>`).join('')}</tr>`;
        if (!ab) return linha;
        const porNota = new Map(); for (const i of gr.arr) (porNota.get(i.nota_id) || porNota.set(i.nota_id, []).get(i.nota_id)).push(i);
        return linha + [...porNota.values()].map(arr => { const n = arr[0].n, t = soma(arr);
          return `<tr class="small"><td style="padding-left:28px">${n.serie ? n.serie + '-' : ''}${n.numero}</td><td>${dateBR(n.emissao)} · ${esc((n.emissao_propria ? n.dest_nome : n.emit_nome) || '')}</td><td class="num">${arr.length} it.</td>${CAMPOS.map(([k]) => `<td class="num">${money(t[k])}</td>`).join('')}</tr>`; }).join('');
      }).join('')}
      <tr class="row-sec"><td colspan="2">Total</td><td class="num">${T.notas.size}</td>${CAMPOS.map(([k]) => `<td class="num">${money(T[k])}</td>`).join('')}</tr>
    </tbody></table></div></div>`;
  $('#lado', c).onclick = (e) => { const l = e.target.closest('[data-l]')?.dataset.l; if (l) { ui.lado = l; ui.abertas.clear(); livro(c, root); } };
  $('#agr', c).onchange = (e) => { ui.agrupar = e.target.value; ui.abertas.clear(); livro(c, root); };
  c.querySelector('tbody').onclick = (e) => { const k = e.target.closest('tr.dre-l')?.dataset.k; if (k == null) return; ui.abertas.has(k) ? ui.abertas.delete(k) : ui.abertas.add(k); livro(c, root); };
}

// impostos destacados: débitos nas saídas, créditos destacados nas entradas (ainda sem as regras da empresa)
function resumo(c) {
  const S = soma(D.itens.filter(i => i.lado === 'saidas'));
  const Edev = soma(D.itens.filter(i => i.lado === 'entradas' && !i.terceiro));
  const Eter = soma(D.itens.filter(i => i.lado === 'entradas' && i.terceiro));
  const linha = (t, a, b, cc, cls = '') => `<tr class="${cls}"><td>${t}</td><td class="num">${a == null ? '' : money(a)}</td><td class="num">${b == null ? '' : money(b)}</td><td class="num">${cc == null ? '' : money(cc)}</td></tr>`;
  c.innerHTML = `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2>Impostos destacados nas notas — ${MESES_CURTO[+ui.mes.slice(5) - 1]}/${ui.mes.slice(0, 4)}</h2>
    <p class="muted small">Prévia: soma do que está nas notas autorizadas. Ainda <strong>não</strong> é o imposto a recolher — faltam PRODEPE, FEEF, AD/DIPER, FECEP, estornos e os créditos de PIS/COFINS pelas regras da empresa (aba Regras e parâmetros).</p></div></div>
    <div class="table-wrap"><table><thead><tr><th></th><th class="num">ICMS</th><th class="num">IPI</th><th class="num">PIS / COFINS</th></tr></thead><tbody>
      ${linha('Débitos — saídas (notas emitidas)', S.icms, S.ipi, null)}
      ${linha('&nbsp;&nbsp;PIS', null, null, S.pis)}${linha('&nbsp;&nbsp;COFINS', null, null, S.cofins)}
      ${linha('(−) Devoluções de clientes (notas de entrada emitidas por nós)', -Edev.icms, -Edev.ipi, -(Edev.pis + Edev.cofins))}
      ${linha('(−) Créditos destacados nas compras (notas de fornecedores)', -Eter.icms, -Eter.ipi, null)}
      ${linha('Saldo antes das regras da empresa', r2(S.icms - Edev.icms - Eter.icms), r2(S.ipi - Edev.ipi - Eter.ipi), r2(S.pis + S.cofins - Edev.pis - Edev.cofins), 'row-sec')}
    </tbody></table></div>
    <p class="small muted" style="padding:0 12px 12px">PIS/COFINS: créditos das compras não entram aqui porque o crédito é calculado pelas alíquotas e regras da empresa, não pelo valor destacado pelo fornecedor.</p></div>`;
}

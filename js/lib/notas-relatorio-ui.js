// Notas fiscais › aba Relatórios: faturamento (saídas) e compras (entradas) por mês, cliente/fornecedor, produto, UF e CFOP,
// com devoluções deduzidas, comparativo com o mesmo período do ano anterior, ticket médio e curva ABC. Tela, PDF e Excel.
import { sb, state, fetchAll } from './data.js';
import { $, esc, money, pct, dateBR, fail, exportXLSX, MESES_CURTO } from './ui.js';
import { abrirRelatorio } from './relatorio.js';
import { linhas, relatorio, AGRUPAR, anoAnterior } from './fat-relatorio.js';

const rel = { tipo: null, agrupar: null, ag: 'mes', comparar: true };   // agrupar: escolha do usuário; ag: em uso (sem escolha: por cliente num mês só, por mês num período maior)
let cache = { chave: null, atual: null, anterior: null };
const SEL = 'nota_id, cfop, cprod, xprod, ucom, qcom, vprod, vdesc, vfrete, voutro, v_icms, v_st, v_ipi, v_pis, v_cofins, nfe_notas!inner(id, numero, serie, emissao, tipo, situacao, emissao_propria, finalidade, dest_nome, dest_doc, dest_uf, emit_nome, emit_doc)';
const itens = (ini, fim) => fetchAll(() => sb.from('nfe_itens').select(SEL).eq('nfe_notas.empresa_id', state.empresa.id).gte('nfe_notas.emissao', ini).lte('nfe_notas.emissao', fim).order('id'));
const mesBR = (m) => `${MESES_CURTO[+m.slice(5) - 1]}/${m.slice(0, 4)}`;
const varTxt = (v) => v == null ? '–' : `<span class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${pct(v)}</span>`;
const nomeRel = (t) => t === 'faturamento' ? 'Faturamento' : 'Compras';

/** pinta a aba; tipoNotas = 'saida' | 'entrada' (do filtro da tela), ini/fim = período de emissão */
export async function pintarRelatorios(c, { ini, fim, tipoNotas }) {
  rel.tipo = rel.tipo || (tipoNotas === 'entrada' ? 'compras' : 'faturamento');
  if (rel._tipoNotas !== tipoNotas) { rel.tipo = tipoNotas === 'entrada' ? 'compras' : 'faturamento'; rel._tipoNotas = tipoNotas; }
  const chave = `${state.empresa.id}|${ini}|${fim}`;
  if (cache.chave !== chave) {
    c.innerHTML = '<div class="loading">Carregando os itens das notas…</div>';
    try {
      const [a, b] = await Promise.all([itens(ini, fim), itens(anoAnterior(ini), anoAnterior(fim))]);
      cache = { chave, atual: linhas(a, state.empresa.uf), anterior: linhas(b, state.empresa.uf) };
    } catch (e) { fail(e); c.innerHTML = '<div class="empty">Não foi possível carregar os itens das notas.</div>'; return; }
  }
  desenhar(c, ini, fim);
}

function calcular() { return relatorio(cache.atual, { tipo: rel.tipo, agrupar: rel.ag, anterior: rel.comparar ? cache.anterior : null }); }

function tabela(R, { pdf = false } = {}) {
  const A = rel.ag, comp = rel.comparar, prod = A === 'produto', mes = A === 'mes';
  const titulo = AGRUPAR[A][R.tipo], dev = R.tipo === 'faturamento' ? 'Devoluções de clientes' : 'Devoluções a fornecedores';
  const max = Math.max(...R.rows.map(r => Math.max(r.liquido, r.anterior || 0)), 1);
  const head = `<tr><th>${titulo}</th><th class="num">Notas</th>${prod ? '<th class="num">Quantidade</th>' : ''}<th class="num">${R.tipo === 'faturamento' ? 'Vendas' : 'Compras'}</th><th class="num">${dev}</th><th class="num">Líquido</th>`
    + `${mes ? '' : '<th class="num">Ticket médio</th>'}<th class="num">Part.</th>${mes ? '' : '<th class="num">Acum.</th><th>ABC</th>'}${comp ? '<th class="num">Ano anterior</th><th class="num">Variação</th>' : ''}${mes && !pdf ? '<th style="min-width:140px"></th>' : ''}</tr>`;
  const linha = (r) => `<tr><td class="${prod || A === 'parte' ? 'wrap' : 'nowrap'}">${esc(mes ? mesBR(r.chave) : r.chave)}</td><td class="num">${r.notas}${r.notasDev ? `<span class="muted small"> +${r.notasDev} dev.</span>` : ''}</td>`
    + `${prod ? `<td class="num">${r.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${esc(r.ucom)}</td>` : ''}<td class="num">${money(r.bruto)}</td><td class="num">${r.dev ? money(-r.dev) : '–'}</td><td class="num"><strong>${money(r.liquido)}</strong></td>`
    + `${mes ? '' : `<td class="num">${r.ticket == null ? '–' : money(r.ticket)}</td>`}<td class="num">${pct(r.part)}</td>${mes ? '' : `<td class="num">${pct(r.acumulado)}</td><td><span class="badge ${r.classe === 'A' ? 'pago' : r.classe === 'B' ? 'aberto' : ''}">${r.classe}</span></td>`}`
    + `${comp ? `<td class="num">${money(r.anterior)}</td><td class="num">${varTxt(r.variacao)}</td>` : ''}`
    + `${mes && !pdf ? `<td><div title="${money(r.liquido)}" style="height:8px;border-radius:4px;background:var(--primary);width:${Math.max(0, r.liquido / max * 100).toFixed(1)}%"></div>${comp ? `<div title="ano anterior ${money(r.anterior)}" style="height:4px;margin-top:2px;border-radius:2px;background:var(--muted,#94a3b8);opacity:.6;width:${Math.max(0, (r.anterior || 0) / max * 100).toFixed(1)}%"></div>` : ''}</td>` : ''}</tr>`;
  const T = R.total;
  const tot = `<tr class="row-sec"><td>Total</td><td class="num">${T.notas}</td>${prod ? '<td></td>' : ''}<td class="num">${money(T.bruto)}</td><td class="num">${T.dev ? money(-T.dev) : '–'}</td><td class="num">${money(T.liquido)}</td>`
    + `${mes ? '' : `<td class="num">${T.ticket == null ? '–' : money(T.ticket)}</td>`}<td class="num">100%</td>${mes ? '' : '<td></td><td></td>'}${comp ? `<td class="num">${money(T.anterior)}</td><td class="num">${varTxt(T.variacao)}</td>` : ''}${mes && !pdf ? '<td></td>' : ''}</tr>`;
  return `<table><thead>${head}</thead><tbody>${R.rows.map(linha).join('')}${tot}</tbody></table>`;
}

const fora = (R) => { const T = R.total; return `${T.notasOutras} nota(s) de ${R.tipo === 'faturamento' ? 'remessa e outras saídas' : 'outras entradas'} (${money(T.vOutras)}) e ${T.canceladas} cancelada(s) (${money(T.vCanceladas)})`; };
function kpis(R) {
  const T = R.total, f = R.tipo === 'faturamento';
  return [[f ? 'Vendas (bruto)' : 'Compras (bruto)', money(T.bruto), `${T.notas} nota(s)`],
    [f ? 'Devoluções de clientes' : 'Devoluções a fornecedores', money(-T.dev), `${T.notasDev} nota(s)`],
    [f ? 'Faturamento líquido' : 'Compras líquidas', money(T.liquido), rel.comparar ? `ano anterior ${money(T.anterior)} · ${T.variacao == null ? '–' : (T.variacao > 0 ? '+' : '') + pct(T.variacao)}` : ''],
    ['Ticket médio', T.ticket == null ? '–' : money(T.ticket), 'por nota'],
    ['Impostos nas notas', money(T.impostos), 'ICMS, ST, IPI, PIS e Cofins']];
}

function desenhar(c, ini, fim) {
  rel.ag = rel.agrupar || (ini.slice(0, 7) === fim.slice(0, 7) ? 'parte' : 'mes');
  const R = calcular(), per = `${dateBR(ini)} a ${dateBR(fim)}`, perA = `${dateBR(anoAnterior(ini))} a ${dateBR(anoAnterior(fim))}`;
  c.innerHTML = `
    <div class="card"><div class="toolbar" style="margin-bottom:0">
      <div class="chips" id="rl-tipo">${[['faturamento', 'Faturamento (saídas)'], ['compras', 'Compras (entradas)']].map(([k, t]) => `<span class="chip ${rel.tipo === k ? 'on' : ''}" data-t="${k}">${t}</span>`).join('')}</div>
      <label>Agrupar por<select id="rl-agr">${Object.entries(AGRUPAR).map(([k, v]) => `<option value="${k}" ${rel.ag === k ? 'selected' : ''}>${v[rel.tipo]}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="rl-comp" ${rel.comparar ? 'checked' : ''}> Comparar com ${perA}</label>
      <span class="spacer"></span><button class="btn" id="rl-pdf">PDF</button><button class="btn" id="rl-xls">Excel</button>
    </div><p class="small muted" style="margin:8px 0 0">Período de emissão ${per} (o filtro de datas no alto da tela). ${rel.tipo === 'faturamento'
      ? 'Vendas = notas emitidas com CFOP de venda; devoluções = notas de devolução de clientes (as nossas de entrada e as emitidas pelo cliente).'
      : 'Compras = notas de fornecedores com CFOP de venda e as nossas notas de entrada de compra; devoluções = as nossas notas de devolução a fornecedores.'} Valores com IPI e ST. Fora do relatório: ${fora(R)}.</p></div>
    <div class="kpis">${kpis(R).map(([t, v, s]) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value">${v}</div><div class="k-sub">${s}</div></div>`).join('')}</div>
    ${R.rows.length ? `<div class="card flush"><div class="table-wrap" style="max-height:66vh" id="rl-tab">${tabela(R)}</div></div>` : `<div class="card"><div class="empty">Nenhuma nota de ${rel.tipo === 'faturamento' ? 'venda' : 'compra'} no período.</div></div>`}`;
  $('#rl-tipo', c).onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (t) { rel.tipo = t; desenhar(c, ini, fim); } };
  $('#rl-agr', c).onchange = (e) => { rel.agrupar = rel.ag = e.target.value; desenhar(c, ini, fim); };
  $('#rl-comp', c).onchange = (e) => { rel.comparar = e.target.checked; desenhar(c, ini, fim); };
  $('#rl-xls', c).onclick = () => { const t = $('#rl-tab table', c); if (t) exportXLSX(t, `${rel.tipo}_${rel.ag}_${ini}_${fim}`); };
  $('#rl-pdf', c).onclick = () => imprimir(R, per, perA);
}

function imprimir(R, per, perA) {
  const K = kpis(R), titulo = `${nomeRel(R.tipo)} por ${AGRUPAR[rel.ag][R.tipo].toLowerCase()}`;
  const corpo = `<h2>1. Resumo</h2><table><tbody>${K.map(([t, v, s]) => `<tr><td>${t}</td><td class="num"><strong>${v}</strong></td><td>${esc(s)}</td></tr>`).join('')}</tbody></table>
    <h2>2. ${esc(titulo)}</h2>${tabela(R, { pdf: true })}
    <p class="nota">${R.tipo === 'faturamento' ? 'Vendas: notas emitidas com CFOP de venda (5.101 a 5.125, 6.101 a 6.125, ST e exportação). Devoluções: notas de devolução de clientes.' : 'Compras: notas de fornecedores com CFOP de venda e notas próprias de entrada de compra, energia, comunicação, transporte, ativo e uso e consumo. Devoluções: notas próprias de devolução a fornecedores.'}
    Fora do relatório: ${fora(R)}. Valores com IPI e ST. ABC: A até 80% do acumulado, B até 95%, C o restante.</p>`;
  abrirRelatorio({ nome: titulo, titulo: `Relatório de ${nomeRel(R.tipo).toLowerCase()}`, subtitulo: `Emissão de ${per}${rel.comparar ? ` · comparativo com ${perA}` : ''}`, corpo,
    rodape: 'Base: XML das NF-e importados na plataforma (Notas fiscais).', paisagem: !(rel.ag === 'mes' && !rel.comparar), extraCss: '.nota{font-size:9pt;margin-top:8px}' });
}

/** limpa o cache (depois de importar notas) */
export const limparCacheRelatorios = () => { cache = { chave: null, atual: null, anterior: null }; };

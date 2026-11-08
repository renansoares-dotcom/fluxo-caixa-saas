// Produção › Custo das OPs (PRD020) — melhoria 6.3 (SQL 114, 08/11/2026).
// Custo real de cada OP (material, tinta, horas de máquina e manutenção rateada) contra o orçado pela estrutura do produto,
// e a margem pelo preço médio de venda. Custo-hora por máquina e setor, rateio e limites: administrador e financeiro.
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, fail, toast, modal, today, exportXLSX } from '../lib/ui.js';
import { drawer } from '../lib/componentes.js';
import { cadProducao, addDias, limparCadProducao } from '../lib/producao.js';
import * as K from '../lib/custo-op.js';

export const title = 'Custo das OPs';
const ui = { dias: 90, filtro: '' };
let D = null;
const pc = (v) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%');
const rkg = (v) => (v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const kg = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const sinal = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')}%`);

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Custo das OPs</h2><div class="muted small">Quanto cada ordem de produção custou de verdade, contra o orçado pela estrutura do produto, e a margem pelo preço de venda.</div></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <select id="co-d" title="Período" style="width:auto">${[[30, '30 dias'], [90, '90 dias'], [180, '6 meses'], [365, '12 meses']].map(([d, t]) => `<option value="${d}" ${ui.dias === d ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="co-f" title="Mostrar" style="width:auto"><option value="">Todas as OPs</option><option value="acima">Custo acima do orçado</option><option value="margem">Margem abaixo da mínima</option><option value="alerta">Com dado faltando</option></select>
      ${podeEditar() ? '<button class="btn" id="co-par">Custo-hora e parâmetros</button>' : ''}<button class="btn" id="co-xls">Exportar Excel</button></div></div>
    <div id="co-corpo"><div class="loading">Calculando o custo das OPs…</div></div>`;
  $('#co-f', root).value = ui.filtro;
  $('#co-d', root).onchange = (e) => { ui.dias = +e.target.value; render(root); };
  $('#co-f', root).onchange = (e) => { ui.filtro = e.target.value; pintar(root); };
  $('#co-par', root) && ($('#co-par', root).onclick = () => parametros(root));
  $('#co-xls', root).onclick = () => D && exportar();
  try {
    const e = state.empresa.id, ate = today(), de = addDias(ate, -(ui.dias - 1));
    const [cfg, lista] = await Promise.all([
      q(sb.from('prod_custo_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.rpc('prod_custo_ops', { p_empresa: e, p_de: de, p_ate: ate }))]);
    const c = { ...K.CFG_PADRAO, ...(cfg || {}) };
    const brutos = (lista || []).map(x => (x && x.prod_custo_ops) || x);
    D = { cfg: c, brutos, ops: brutos.map(j => K.resumir(j, c)), de, ate };
    pintar(root);
  } catch (err) { fail(err); $('#co-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível calcular o custo das OPs. Confira se o SQL 114 já foi executado.</div></div>'; }
}

const filtrar = () => D.ops.filter(r => !ui.filtro || (ui.filtro === 'acima' ? ['acima', 'acima_margem'].includes(r.sit) : ui.filtro === 'margem' ? ['margem', 'acima_margem'].includes(r.sit) : r.alertas.length));

function pintar(root) {
  const L = filtrar(), T = K.totais(L), c = D.cfg;
  const kpi = (rot, v, sub, tom = '') => `<div class="kpi"><div class="k-label">${rot}</div><div class="k-value ${tom}">${v}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
  $('#co-corpo', root).innerHTML = `
    <div class="kpis" style="margin-bottom:12px">
      ${kpi('OPs no período', T.ops, `${kg(T.bom)} kg bons`)}
      ${kpi('Custo total', money(T.total), `${rkg(T.custoKg)} por kg`)}
      ${kpi('Real × orçado', sinal(T.desvio), `${T.acima} OP(s) acima de ${c.tolerancia_pct}%`, T.desvio > c.tolerancia_pct / 100 ? 'neg' : T.desvio != null ? 'pos' : '')}
      ${kpi('Margem', pc(T.margemPct), `${T.margemBaixa} OP(s) abaixo de ${c.margem_minima_pct}%`, T.margemPct != null && T.margemPct * 100 < c.margem_minima_pct ? 'neg' : T.margemPct != null ? 'pos' : '')}
      ${kpi('Refugo', pc(T.bom + T.refugo ? T.refugo / (T.bom + T.refugo) : null), `${kg(T.refugo)} kg`)}</div>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>OP</th><th>Produto</th><th>Cliente</th><th class="num">Bom (kg)</th><th class="num">Refugo</th><th class="num">Custo real/kg</th><th class="num">Orçado/kg</th><th class="num">Desvio</th><th class="num">Preço/kg</th><th class="num">Margem</th><th>Situação</th></tr></thead><tbody>
      ${L.map(r => { const s = K.SIT[r.sit];
        return `<tr data-op="${r.id}" style="cursor:pointer"><td><b>${r.numero}</b>${r.numero_iniflex ? ` <span class="muted">(${esc(r.numero_iniflex)})</span>` : ''}</td><td class="wrap">${esc(r.produto)}</td><td>${esc(r.cliente || '')}</td>
          <td class="num">${kg(r.bom)}</td><td class="num">${pc(r.refugoPct)}</td><td class="num"><b>${rkg(r.custoKg)}</b></td><td class="num">${rkg(r.orcado.custoKg)}</td>
          <td class="num ${r.desvio > c.tolerancia_pct / 100 ? 'neg' : ''}">${sinal(r.desvio)}</td><td class="num">${rkg(r.preco)}</td><td class="num ${r.margemPct != null && r.margemPct * 100 < c.margem_minima_pct ? 'neg' : ''}">${pc(r.margemPct)}</td>
          <td>${s ? `<span class="badge ${s[1]}">${s[0]}</span>` : ''}${r.alertas.length ? ` <span title="${esc(r.alertas.join('; '))}" class="muted">⚠ ${r.alertas.length}</span>` : ''}</td></tr>`; }).join('')
        || `<tr><td colspan="11" class="empty">${D.ops.length ? 'Nenhuma OP neste filtro.' : 'Nenhuma OP com apontamento no período.'}</td></tr>`}</tbody></table></div></div>
    <details class="small muted" style="margin-top:10px"><summary>Como o custo é calculado</summary><ul>
      <li><b>Material</b>: consumos apontados na OP × custo médio do estoque; sem custo médio, o último preço de compra do de-para.</li>
      <li><b>Tinta</b>: ordens da Casa de Tintas ligadas à OP (custo por kg × entregue − retorno).</li>
      <li><b>Máquina</b>: horas apontadas × custo-hora da máquina (ou do setor, ou o padrão da empresa).</li>
      <li><b>Manutenção</b>${c.ratear_manutencao ? '' : ' (desligada nos parâmetros)'}: custo das OS concluídas no mês na máquina (terceiros, peças e horas) dividido pelas horas apontadas no mês × horas da OP.</li>
      <li><b>Orçado</b>: estrutura do produto × quantidade da OP (com a perda) + horas previstas das etapas × custo-hora. <b>Custo/kg</b>: real ÷ quantidade boa da última etapa; orçado ÷ quantidade da OP.</li>
      <li><b>Preço</b>: média das NF-e de venda do produto nos ${c.dias_preco} dias antes da conclusão. Margem = (preço × bom − custo real) ÷ receita.</li></ul></details>`;
  $$('[data-op]', root).forEach(tr => tr.onclick = () => detalhe(tr.dataset.op));
}

export function detalhe(id, bruto = null, cfg = null) {
  const j = bruto || D.brutos.find(b => b.ordem?.id === id), c = cfg || D.cfg, r = K.resumir(j, c);
  const linha = (t, v, o) => `<tr><td>${t}</td><td class="num">${money(v)}</td><td class="num">${o == null ? '—' : money(o)}</td><td class="num">${r.total ? pc(v / r.total) : '—'}</td></tr>`;
  const det = (tit, l, cols) => l.length ? `<h4 style="margin:12px 0 4px">${tit}</h4><div class="table-wrap"><table class="small"><tbody>${l.map(cols).join('')}</tbody></table></div>` : '';
  drawer({ titulo: `OP ${r.numero}${r.numero_iniflex ? ` (${r.numero_iniflex})` : ''}`, subtitulo: `${r.produto} · ${kg(r.bom)} kg bons de ${kg(r.quantidade)} ${r.unidade || ''}`, corpo: `
    <div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="k-label">Custo real/kg</div><div class="k-value">${rkg(r.custoKg)}</div><div class="k-sub">orçado ${rkg(r.orcado.custoKg)} · ${sinal(r.desvio)}</div></div>
      <div class="kpi"><div class="k-label">Margem</div><div class="k-value">${pc(r.margemPct)}</div><div class="k-sub">${r.preco != null ? `preço ${rkg(r.preco)}/kg · ${money(r.margem)}` : 'sem preço de venda'}</div></div></div>
    ${r.alertas.length ? `<div class="small" style="border-left:3px solid var(--warn);padding:4px 8px;margin-bottom:8px">${r.alertas.map(esc).join('<br>')}</div>` : ''}
    <div class="table-wrap"><table class="small"><thead><tr><th>Composição</th><th class="num">Real</th><th class="num">Orçado</th><th class="num">% do custo</th></tr></thead><tbody>
      ${r.partes.map(([t, v, o]) => linha(t, v, o)).join('')}<tr class="row-sec"><td><b>Total</b></td><td class="num"><b>${money(r.total)}</b></td><td class="num">${money(r.orcado.total)}</td><td></td></tr></tbody></table></div>
    ${det('Materiais', j.material || [], x => `<tr><td>${esc(x.codigo || '')} ${esc(x.descricao || '')}</td><td class="num">${Number(x.qtd).toLocaleString('pt-BR')}</td><td class="num">${rkg(x.custo)}</td><td class="muted">${esc(x.fonte)}</td><td class="num">${money(x.valor)}</td></tr>`)}
    ${det('Tintas', j.tinta || [], x => `<tr><td>Ordem ${x.numero} — ${esc(x.cor || '')}</td><td class="num">${Number(x.kg).toLocaleString('pt-BR')} kg</td><td class="num">${money(x.valor)}</td></tr>`)}
    ${det('Máquinas', j.maquina || [], x => `<tr><td>${esc(x.codigo || '')} ${esc(x.nome || '')} <span class="muted">${esc(x.setor || '')}</span></td><td class="num">${Number(x.horas).toLocaleString('pt-BR')} h</td><td class="num">${money(x.custo_hora)}/h</td><td class="num">${money(x.valor)}</td></tr>`)}
    ${det('Manutenção rateada', j.manutencao || [], x => `<tr><td>${String(x.mes).slice(5, 7)}/${String(x.mes).slice(0, 4)}</td><td class="num">${Number(x.horas_op).toLocaleString('pt-BR')} h de ${Number(x.horas_mes).toLocaleString('pt-BR')} h</td><td class="num">OS ${money(x.custo_mes)}</td><td class="num">${money(x.valor)}</td></tr>`)}` });
}

function exportar() {
  const rows = [['OP', 'OP Iniflex', 'Produto', 'Cliente', 'Quantidade', 'Bom (kg)', 'Refugo (kg)', 'Material', 'Tinta', 'Máquina', 'Manutenção', 'Custo total', 'Custo/kg', 'Orçado/kg', 'Desvio', 'Preço/kg', 'Receita', 'Margem', 'Margem %', 'Alertas']];
  for (const r of filtrar()) rows.push([r.numero, r.numero_iniflex || '', r.produto, r.cliente || '', r.quantidade, r.bom, r.refugo, r.material, r.tinta, r.maquina, r.manutencao, r.total, r.custoKg, r.orcado.custoKg, r.desvio, r.preco, r.receita, r.margem, r.margemPct, r.alertas.join('; ')]);
  exportXLSX(rows, `custo_ops_${D.de}_${D.ate}`);
}

async function parametros(root) {
  const C = await cadProducao(true), c = D.cfg;
  const m = modal({ title: 'Custo-hora e parâmetros', wide: true, body: `
    <div class="grid-form">
      <label>Custo-hora padrão da empresa (R$/h)<input type="number" id="cp-h" min="0" step="0.01" value="${c.custo_hora_padrao}"></label>
      <label>Preço médio de venda: últimos N dias (7 a 365)<input type="number" id="cp-d" min="7" max="365" value="${c.dias_preco}"></label>
      <label>Tolerância real × orçado (%)<input type="number" id="cp-t" min="0" max="100" step="0.5" value="${c.tolerancia_pct}"></label>
      <label>Margem mínima (%)<input type="number" id="cp-m" min="-100" max="100" step="0.5" value="${c.margem_minima_pct}"></label></div>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="cp-r" ${c.ratear_manutencao ? 'checked' : ''}> Ratear o custo das OS de manutenção pelas horas de máquina</label>
    <p class="small muted">Custo-hora: o da máquina vale primeiro; sem ele, o do setor; sem ele, o padrão. Inclua mão de obra direta, energia e depreciação da máquina.</p>
    <div class="grid2"><div><h4 style="margin:6px 0">Por setor (R$/h)</h4>${C.setores.map(s => `<label class="small">${esc(s.nome)}<input type="number" min="0" step="0.01" data-cs="${s.id}" value="${s.custo_hora ?? ''}" placeholder="padrão"></label>`).join('')}</div>
      <div><h4 style="margin:6px 0">Por máquina (R$/h)</h4>${C.maquinas.filter(x => x.ativo).map(x => `<label class="small">${esc(x.codigo)} ${esc(x.nome)}<input type="number" min="0" step="0.01" data-cm="${x.id}" value="${x.custo_hora ?? ''}" placeholder="do setor"></label>`).join('')}</div></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cp-ok">Salvar</button>' });
  $('#cp-ok', m.el).onclick = async () => {
    const v = (id) => +$(id, m.el).value;
    const reg = { empresa_id: state.empresa.id, custo_hora_padrao: v('#cp-h'), dias_preco: v('#cp-d'), tolerancia_pct: v('#cp-t'), margem_minima_pct: v('#cp-m'), ratear_manutencao: $('#cp-r', m.el).checked, atualizado_em: new Date().toISOString() };
    if (!(reg.custo_hora_padrao >= 0) || !(reg.dias_preco >= 7 && reg.dias_preco <= 365) || !(reg.tolerancia_pct >= 0 && reg.tolerancia_pct <= 100) || !(reg.margem_minima_pct >= -100 && reg.margem_minima_pct <= 100)) return toast('Confira os valores (faixas indicadas)', true);
    const num = (x) => (x.value === '' ? null : +x.value);
    if ($$('[data-cs],[data-cm]', m.el).some(x => x.value !== '' && !(+x.value >= 0))) return toast('Custo-hora não pode ser negativo', true);
    try {
      await q(sb.from('prod_custo_config').upsert(reg));
      for (const x of $$('[data-cs]', m.el)) { const s = C.setores.find(y => y.id === x.dataset.cs); if ((s.custo_hora ?? null) !== num(x)) await q(sb.from('prod_setores').update({ custo_hora: num(x) }).eq('id', s.id)); }
      for (const x of $$('[data-cm]', m.el)) { const s = C.maquinas.find(y => y.id === x.dataset.cm); if ((s.custo_hora ?? null) !== num(x)) await q(sb.from('prod_maquinas').update({ custo_hora: num(x) }).eq('id', s.id)); }
      limparCadProducao(); m.close(); toast('Parâmetros salvos'); render(root);
    } catch (err) { fail(err); }
  };
}

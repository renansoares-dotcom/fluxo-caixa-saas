// Produção › Casa de Tintas › Previsão de Tinta (PRD023) — melhoria 6.7 (SQL 117, 08/11/2026).
// Quanto de cada cor a impressão vai precisar nos próximos dias, pelas OPs da programação, o que já existe em sobras e o
// que falta preparar; insumos das receitas contra o saldo; sobras sem uso previsto. Aba "Cores dos produtos": a ficha
// de cores de cada embalagem com o consumo (g/kg) cadastrado e o real das últimas OPs.
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, dateBR, parseNum, exportXLSX } from '../lib/ui.js';

export const title = 'Previsão de Tinta';
const ui = { aba: 'previsao' };
let D = null;
const kg = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }) + ' kg');
const g = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' g/kg');
const pode = () => ['admin', 'financeiro', 'diretor', 'producao'].includes(state.papel);
const bola = (hex) => `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${esc(hex || '#ccc')};border:1px solid var(--border);vertical-align:-2px;margin-right:6px"></span>`;

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Previsão de Tinta</h2><div class="muted small">A tinta que a impressão vai precisar, pela programação, o que já existe em sobras e o que falta preparar.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${podeEditar() ? '<button class="btn" id="tp-par">Parâmetros</button>' : ''}<button class="btn" id="tp-xls">Exportar Excel</button></div></div>
    <div class="tabs" style="margin-bottom:12px;display:flex;gap:6px"><button class="chip${ui.aba === 'previsao' ? ' on' : ''}" data-aba="previsao">Previsão</button><button class="chip${ui.aba === 'cores' ? ' on' : ''}" data-aba="cores">Cores dos produtos</button></div>
    <div id="tp-corpo"><div class="loading">Calculando…</div></div>`;
  $$('[data-aba]', root).forEach(b => b.onclick = () => { ui.aba = b.dataset.aba; render(root); });
  $('#tp-par', root) && ($('#tp-par', root).onclick = () => parametros(root));
  $('#tp-xls', root).onclick = () => D && exportar();
  try {
    const e = state.empresa.id;
    const [prev, real, fichas, cores, receitas, cfg, setores] = await Promise.all([
      q(sb.rpc('tin_previsao', { p_empresa: e })), q(sb.rpc('tin_consumo_real', { p_empresa: e })),
      q(sb.from('tin_produto_cores').select('*').eq('empresa_id', e)), q(sb.from('tin_cores').select('id,codigo,nome,hex').eq('empresa_id', e).eq('ativo', true).order('codigo')),
      q(sb.from('tin_receitas').select('id,codigo,nome,cor_id').eq('empresa_id', e).eq('ativo', true).order('codigo')),
      q(sb.from('tin_previsao_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.from('prod_setores').select('id,nome').eq('empresa_id', e).order('ordem'))]);
    const ids = [...new Set([...fichas.map(f => f.produto_id), ...real.map(r => r.produto_id), ...prev.sem_ficha.map(s => s.produto_id)].filter(Boolean))];
    const prods = ids.length ? await q(sb.from('produtos').select('id,codigo,descricao').in('id', ids)) : [];
    D = { prev, real, fichas, cores, receitas, cfg: { horizonte_dias: 14, ops_media: 10, consumo_padrao_g_kg: 0, setor_impressao_id: null, ...(cfg || {}) }, setores, prods,
      corById: Object.fromEntries(cores.map(c => [c.id, c])), prodById: Object.fromEntries(prods.map(p => [p.id, p])) };
    ui.aba === 'cores' ? pintarCores(root) : pintarPrevisao(root);
  } catch (err) { fail(err); $('#tp-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível calcular a previsão. Confira se o SQL 117 já foi executado.</div></div>'; }
}

function pintarPrevisao(root) {
  const P = D.prev, tot = P.cores.reduce((a, c) => ({ n: a.n + +c.necessidade, s: a.s + Math.min(+c.sobra, +c.necessidade), p: a.p + +c.preparar }), { n: 0, s: 0, p: 0 });
  const falta = P.insumos.filter(i => i.saldo != null && +i.saldo < +i.necessidade);
  $('#tp-corpo', root).innerHTML = `
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Tinta necessária</div><div class="k-value">${kg(tot.n)}</div><div class="k-sub">${P.cores.length} cor(es) até ${dateBR(P.ate)}</div></div>
      <div class="kpi"><div class="k-label">Das sobras</div><div class="k-value pos">${kg(tot.s)}</div><div class="k-sub">reaproveitadas da mesma cor</div></div>
      <div class="kpi"><div class="k-label">A preparar</div><div class="k-value">${kg(tot.p)}</div><div class="k-sub">necessidade − sobras</div></div>
      <div class="kpi"><div class="k-label">Insumos em falta</div><div class="k-value ${falta.length ? 'neg' : ''}">${falta.length}</div><div class="k-sub">${P.insumos.some(i => i.saldo == null) ? 'estoque não implantado' : 'contra o saldo do estoque'}</div></div></div>
    ${P.sem_ficha.length ? `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px"><b>${P.sem_ficha.length} OP(s) sem a ficha de cores do produto</b> ficam fora da previsão: ${P.sem_ficha.slice(0, 6).map(s => `OP ${s.op} (${esc(s.produto)})`).join(', ')}${P.sem_ficha.length > 6 ? '…' : ''}. Cadastre em <a href="#" id="tp-ir">Cores dos produtos</a>.</div>` : ''}
    ${P.sem_consumo.length ? `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">${P.sem_consumo.length} cor(es) de produto sem consumo (sem ficha, sem histórico e sem consumo padrão) ficam fora.</div>` : ''}
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Cor</th><th class="num">Necessidade</th><th class="num">Sobras na validade</th><th class="num">A preparar</th><th>Primeira OP</th><th>Reaproveitar</th></tr></thead><tbody>
      ${P.cores.map(c => `<tr data-cor="${c.cor_id}" style="cursor:pointer"><td>${bola(c.hex)}<b>${esc(c.codigo)}</b> ${esc(c.nome)}${c.tem_receita ? '' : ' <span class="badge vencido">sem receita aprovada</span>'}</td>
        <td class="num">${kg(c.necessidade)}</td><td class="num">${kg(c.sobra)}</td><td class="num"><b>${kg(c.preparar)}</b></td><td>${dateBR(c.primeira)} <span class="muted small">(${c.ops.length} OP)</span></td>
        <td class="small">${c.sobras.length ? c.sobras.map(s => `lote ${esc(s.lote || 'ordem ' + s.ordem)}: ${kg(s.kg)}${s.validade ? ` (vence ${dateBR(s.validade)})` : ''}`).join('<br>') : '<span class="muted">—</span>'}</td></tr>`).join('')
        || `<tr><td colspan="6" class="empty">Nenhuma OP com impressão prevista até ${dateBR(P.ate)}${P.sem_ficha.length ? ' com ficha de cores' : ''}.</td></tr>`}</tbody></table></div></div>
    <div class="grid2" style="margin-top:12px">
      <div class="card flush"><div style="padding:12px 16px 0"><h3 style="margin:0">Insumos para preparar</h3><div class="small muted">Pela versão aprovada da receita de cada cor.</div></div><div class="table-wrap"><table class="small"><thead><tr><th>Insumo</th><th class="num">Necessário</th><th class="num">Saldo</th></tr></thead><tbody>
        ${P.insumos.map(i => `<tr><td>${esc(i.codigo)} ${esc(i.descricao)}</td><td class="num">${kg(i.necessidade, 2)}</td><td class="num ${i.saldo != null && +i.saldo < +i.necessidade ? 'neg' : ''}">${i.saldo == null ? '—' : kg(i.saldo, 2)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nada a preparar.</td></tr>'}</tbody></table></div></div>
      <div class="card flush"><div style="padding:12px 16px 0"><h3 style="margin:0">Sobras sem uso previsto</h3><div class="small muted">Use como ingrediente "sobra" numa receita da mesma cor ou de cor mais escura, antes de vencer.</div></div><div class="table-wrap"><table class="small"><thead><tr><th>Cor</th><th>Lote</th><th class="num">Kg</th><th>Validade</th></tr></thead><tbody>
        ${P.sobras_paradas.map(s => `<tr><td>${bola(s.hex)}${esc(s.cor)}</td><td>${esc(s.lote || 'ordem ' + s.ordem)}</td><td class="num">${kg(s.kg)}</td><td class="${s.validade && s.validade <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) ? 'neg' : ''}">${dateBR(s.validade) || '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhuma sobra parada.</td></tr>'}</tbody></table></div></div></div>
    <details class="small muted" style="margin-top:10px"><summary>Como a previsão é calculada</summary><ul>
      <li>Entram as OPs abertas com a etapa de impressão prevista até ${dateBR(P.ate)} (horizonte de ${P.horizonte} dias nos Parâmetros), pela quantidade que falta imprimir.</li>
      <li>Kg de tinta = kg de produto × consumo (g/kg) ÷ 1.000, para cada cor da ficha do produto. Consumo: o da ficha; sem ele, a média real das últimas ${D.cfg.ops_media} OPs (tinta entregue − retorno ÷ kg bons na impressão); sem histórico, o consumo padrão.</li>
      <li>Sobras: o que voltou da máquina, ainda na validade, menos o que já foi pesado como ingrediente "sobra".</li></ul></details>`;
  $('#tp-ir', root) && ($('#tp-ir', root).onclick = (e) => { e.preventDefault(); ui.aba = 'cores'; render(root); });
  $$('[data-cor]', root).forEach(tr => tr.onclick = () => {
    const c = P.cores.find(x => x.cor_id === tr.dataset.cor);
    modal({ title: `${c.codigo} ${c.nome} — OPs`, wide: true, body: `<div class="table-wrap"><table class="small"><thead><tr><th>OP</th><th>Produto</th><th>Cliente</th><th>Impressão</th><th class="num">Produto</th><th class="num">Consumo</th><th>Fonte</th><th class="num">Tinta</th></tr></thead><tbody>
      ${c.ops.map(o => `<tr><td>${o.op}${o.numero_iniflex ? ` (${esc(o.numero_iniflex)})` : ''}</td><td>${esc(o.produto)}</td><td>${esc(o.cliente || '')}</td><td>${dateBR(o.data)}</td><td class="num">${kg(o.kg_produto)}</td><td class="num">${g(o.g_kg)}</td><td class="muted">${esc(o.fonte)}</td><td class="num"><b>${kg(o.kg_tinta, 2)}</b></td></tr>`).join('')}</tbody></table></div>`, foot: '<button class="btn" data-close>Fechar</button>' });
  });
}

function pintarCores(root) {
  const realDe = (p, c) => D.real.find(r => r.produto_id === p && r.cor_id === c);
  const porProd = new Map();
  for (const f of D.fichas) (porProd.get(f.produto_id) || porProd.set(f.produto_id, []).get(f.produto_id)).push(f);
  for (const s of D.prev.sem_ficha) if (s.produto_id && !porProd.has(s.produto_id)) porProd.set(s.produto_id, []);
  const linhas = [...porProd].map(([pid, fs]) => ({ p: D.prodById[pid] || { id: pid, codigo: '?', descricao: '' }, fs })).sort((a, b) => a.p.codigo.localeCompare(b.p.codigo));
  $('#tp-corpo', root).innerHTML = `<div class="card flush"><div style="padding:12px 16px 0;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><h3 style="margin:0">Cores dos produtos</h3><div class="small muted">Consumo em gramas de tinta por kg de produto. Vazio: vale a média real das OPs.</div></div>${pode() ? '<button class="btn small" id="tp-novo">+ Cor em um produto</button>' : ''}</div>
    <div class="table-wrap"><table class="small"><thead><tr><th>Produto</th><th>Cor</th><th>Receita</th><th class="num">Ficha</th><th class="num">Real (últimas OPs)</th><th></th></tr></thead><tbody>
    ${linhas.map(({ p, fs }) => fs.length ? fs.map((f, i) => { const c = D.corById[f.cor_id], r = realDe(p.id, f.cor_id), rec = D.receitas.find(x => x.id === f.receita_id);
      const dif = r?.g_kg && f.consumo_g_kg ? r.g_kg / f.consumo_g_kg - 1 : null;
      return `<tr>${i === 0 ? `<td rowspan="${fs.length}"><b>${esc(p.codigo)}</b> ${esc(p.descricao)}</td>` : ''}<td>${bola(c?.hex)}${esc(c ? c.codigo + ' ' + c.nome : '?')}</td><td class="muted">${esc(rec ? rec.codigo : 'aprovada da cor')}</td>
        <td class="num">${g(f.consumo_g_kg)}</td><td class="num">${r ? `${g(r.g_kg)} <span class="muted">(${r.ops} OP)</span>${dif != null && Math.abs(dif) > 0.15 ? ` <span class="badge aberto">${dif > 0 ? '+' : ''}${Math.round(dif * 100)}%</span>` : ''}` : '—'}</td>
        <td>${pode() ? `<button class="btn ghost small" data-fc="${f.id}">Editar</button>` : ''}</td></tr>`; }).join('')
      : `<tr><td><b>${esc(p.codigo)}</b> ${esc(p.descricao)}</td><td colspan="4"><span class="badge vencido">sem ficha de cores</span> <span class="muted">tem OP prevista na impressão</span></td><td>${pode() ? `<button class="btn ghost small" data-np="${p.id}">+ Cor</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nenhuma ficha de cores. Comece pelos produtos com OP na programação.</td></tr>'}</tbody></table></div></div>`;
  $('#tp-novo', root) && ($('#tp-novo', root).onclick = () => ficha(null, null, root));
  $$('[data-fc]', root).forEach(b => b.onclick = () => ficha(D.fichas.find(f => f.id === b.dataset.fc), null, root));
  $$('[data-np]', root).forEach(b => b.onclick = () => ficha(null, b.dataset.np, root));
}

async function ficha(f, produtoId, root) {
  let prods = D.prods;
  if (!f && !produtoId) { try { prods = await q(sb.from('produtos').select('id,codigo,descricao').eq('empresa_id', state.empresa.id).eq('tipo_sped', '04').order('codigo').limit(3000)); } catch { /* lista curta */ } }
  const pAtual = f ? D.prodById[f.produto_id] : produtoId ? D.prodById[produtoId] : null;
  const m = modal({ title: f ? 'Cor do produto' : 'Nova cor em um produto', body: `
    <label>Produto<input id="fc-p" list="fc-dl" ${pAtual ? `value="${esc(pAtual.codigo + ' — ' + pAtual.descricao)}" disabled` : ''} placeholder="Código ou descrição"><datalist id="fc-dl">${prods.map(x => `<option value="${esc(x.codigo + ' — ' + x.descricao)}">`).join('')}</datalist></label>
    <label style="margin-top:8px">Cor<select id="fc-c" ${f ? 'disabled' : ''}>${D.cores.map(c => `<option value="${c.id}" ${f?.cor_id === c.id ? 'selected' : ''}>${esc(c.codigo + ' ' + c.nome)}</option>`).join('')}</select></label>
    <label style="margin-top:8px">Receita (vazio = a aprovada da cor)<select id="fc-r"><option value="">—</option></select></label>
    <label style="margin-top:8px">Consumo (g de tinta por kg de produto; vazio = média real)<input id="fc-g" inputmode="decimal" value="${f?.consumo_g_kg ?? ''}"></label>
    <label style="margin-top:8px">Observação<input id="fc-o" maxlength="300" value="${esc(f?.observacao || '')}"></label>`,
    foot: `${f ? '<button class="btn danger" id="fc-x" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fc-ok">Salvar</button>` });
  const recs = () => { const c = $('#fc-c', m.el).value; $('#fc-r', m.el).innerHTML = '<option value="">—</option>' + D.receitas.filter(r => r.cor_id === c).map(r => `<option value="${r.id}" ${f?.receita_id === r.id ? 'selected' : ''}>${esc(r.codigo + ' ' + r.nome)}</option>`).join(''); };
  recs(); $('#fc-c', m.el).onchange = recs;
  $('#fc-ok', m.el).onclick = async () => {
    const gv = $('#fc-g', m.el).value.trim() ? parseNum($('#fc-g', m.el).value) : null;
    if (gv != null && !(gv > 0)) return toast('Consumo maior que zero (ou vazio)', true);
    const reg = { receita_id: $('#fc-r', m.el).value || null, consumo_g_kg: gv, observacao: $('#fc-o', m.el).value.trim() || null };
    try {
      if (f) await q(sb.from('tin_produto_cores').update(reg).eq('id', f.id));
      else {
        const v = $('#fc-p', m.el).value, p = pAtual || prods.find(x => `${x.codigo} — ${x.descricao}` === v) || prods.find(x => x.codigo === v.trim());
        if (!p) return toast('Escolha o produto da lista', true);
        await q(sb.from('tin_produto_cores').insert({ empresa_id: state.empresa.id, produto_id: p.id, cor_id: $('#fc-c', m.el).value, ...reg }));
      }
      m.close(); toast('Ficha salva'); render(root);
    } catch (e) { fail(e); }
  };
  $('#fc-x', m.el) && ($('#fc-x', m.el).onclick = async () => { try { await q(sb.from('tin_produto_cores').delete().eq('id', f.id)); m.close(); render(root); } catch (e) { fail(e); } });
}

function exportar() {
  const rows = [['Cor', 'OP', 'Produto', 'Cliente', 'Impressão', 'Kg de produto', 'Consumo (g/kg)', 'Fonte', 'Kg de tinta']];
  for (const c of D.prev.cores) for (const o of c.ops) rows.push([`${c.codigo} ${c.nome}`, o.op, o.produto, o.cliente || '', o.data, o.kg_produto, o.g_kg, o.fonte, o.kg_tinta]);
  rows.push([]); rows.push(['Cor', 'Necessidade (kg)', 'Sobras (kg)', 'A preparar (kg)']);
  for (const c of D.prev.cores) rows.push([`${c.codigo} ${c.nome}`, c.necessidade, c.sobra, c.preparar]);
  rows.push([]); rows.push(['Insumo', 'Necessário', 'Saldo']);
  for (const i of D.prev.insumos) rows.push([`${i.codigo} ${i.descricao}`, i.necessidade, i.saldo]);
  exportXLSX(rows, `previsao_tinta_${D.prev.ate}`);
}

function parametros(root) {
  const c = D.cfg;
  const m = modal({ title: 'Parâmetros da previsão de tinta', body: `
    <div class="grid-form">
      <label>Horizonte (dias, 1 a 60)<input type="number" id="pt-h" min="1" max="60" value="${c.horizonte_dias}"></label>
      <label>Setor da impressão<select id="pt-s"><option value="">O setor com "impress" no nome</option>${D.setores.map(s => `<option value="${s.id}" ${c.setor_impressao_id === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></label>
      <label>Média real: últimas N OPs (1 a 50)<input type="number" id="pt-n" min="1" max="50" value="${c.ops_media}"></label>
      <label>Consumo padrão (g/kg; 0 = sem padrão)<input id="pt-g" inputmode="decimal" value="${c.consumo_padrao_g_kg}"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pt-ok">Salvar</button>' });
  $('#pt-ok', m.el).onclick = async () => {
    const reg = { empresa_id: state.empresa.id, horizonte_dias: +$('#pt-h', m.el).value, setor_impressao_id: $('#pt-s', m.el).value || null, ops_media: +$('#pt-n', m.el).value, consumo_padrao_g_kg: parseNum($('#pt-g', m.el).value) || 0, atualizado_em: new Date().toISOString() };
    if (!(reg.horizonte_dias >= 1 && reg.horizonte_dias <= 60) || !(reg.ops_media >= 1 && reg.ops_media <= 50) || reg.consumo_padrao_g_kg < 0) return toast('Confira as faixas indicadas', true);
    try { await q(sb.from('tin_previsao_config').upsert(reg)); m.close(); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
  };
}

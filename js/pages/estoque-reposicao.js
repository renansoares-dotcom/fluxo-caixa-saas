// Compras › Estoque › Reposição (EST008) — melhoria 5.4 (SQL 119, 08/11/2026).
// Estoque de segurança, ponto de pedido e máximo calculados pelo consumo real; cobertura em dias, giro, itens parados;
// sugestão de compra com requisição; aplicar os valores calculados no cadastro do produto. Parâmetros na tela.
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, fail, toast, modal, parseNum, exportXLSX } from '../lib/ui.js';

export const title = 'Reposição de Estoque';
const ui = { filtro: 'acao', busca: '' };
let D = null;
const n = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }));
const SIT = { critico: ['Crítico', 'vencido'], comprar: ['Comprar', 'aberto'], excesso: ['Excesso', 'negoc'], parado: ['Parado', ''], ok: ['OK', 'pago'], sem_estoque: ['Sem saldo', ''] };
const podeComprar = () => ['admin', 'financeiro', 'diretor', 'compras'].includes(state.papel);

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Reposição de Estoque</h2><div class="muted small">Mínimo, ponto de pedido e máximo pelo consumo real; cobertura, giro, itens parados e o que comprar.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${podeEditar() ? '<button class="btn" id="rp-par">Parâmetros</button>' : ''}<button class="btn" id="rp-xls">Exportar Excel</button></div></div>
    <div id="rp-corpo"><div class="loading">Calculando o consumo…</div></div>`;
  $('#rp-par', root) && ($('#rp-par', root).onclick = () => parametros(root));
  $('#rp-xls', root).onclick = () => D && exportar();
  try {
    const e = state.empresa.id;
    const [lista, cfg] = await Promise.all([q(sb.rpc('est_reposicao', { p_empresa: e })), q(sb.from('est_reposicao_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null)]);
    D = { lista, cfg: { janela_dias: 90, nivel_servico: 95, lead_time_padrao: 15, intervalo_compra_dias: 15, parado_dias: 90, fonte: 'auto', ...(cfg || {}) } };
    pintar(root);
  } catch (err) { fail(err); $('#rp-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível calcular. Confira se o SQL 119 já foi executado.</div></div>'; }
}

function filtrada() {
  const t = ui.busca.trim().toUpperCase();
  return D.lista.filter(r => (ui.filtro === 'todos' || (ui.filtro === 'acao' ? ['critico', 'comprar'].includes(r.situacao) : r.situacao === ui.filtro))
    && (!t || `${r.codigo} ${r.descricao} ${r.familia || ''}`.toUpperCase().includes(t)));
}

function pintar(root) {
  const L = D.lista, c = (s) => L.filter(r => r.situacao === s).length;
  const valParado = L.filter(r => r.situacao === 'parado').reduce((s, r) => s + +(r.valor_saldo || 0), 0);
  const fonte = L[0]?.fonte || (D.cfg.fonte === 'compras' ? 'compras' : 'kardex');
  const F = filtrada();
  $('#rp-corpo', root).innerHTML = `
    ${fonte === 'compras' ? `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">O estoque ainda não foi implantado: o consumo vem das <b>compras</b> pelas notas de entrada (de-para), e saldo, cobertura e sugestão de compra aparecem depois da implantação. O ponto de pedido já pode ser aplicado no cadastro.</div>` : ''}
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Crítico</div><div class="k-value ${c('critico') ? 'neg' : ''}">${c('critico')}</div><div class="k-sub">saldo no estoque de segurança</div></div>
      <div class="kpi"><div class="k-label">Comprar</div><div class="k-value">${c('comprar')}</div><div class="k-sub">saldo + pedidos ≤ ponto de pedido</div></div>
      <div class="kpi"><div class="k-label">Excesso</div><div class="k-value">${c('excesso')}</div><div class="k-sub">acima de 2× o máximo</div></div>
      <div class="kpi"><div class="k-label">Parado</div><div class="k-value">${c('parado')}</div><div class="k-sub">${money(valParado)} sem saída há ${D.cfg.parado_dias}+ dias</div></div></div>
    <div class="card" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <select id="rp-f" style="width:auto">${[['acao', 'Crítico e comprar'], ['todos', 'Todos'], ['critico', 'Crítico'], ['comprar', 'Comprar'], ['excesso', 'Excesso'], ['parado', 'Parados'], ['ok', 'OK']].map(([k, t]) => `<option value="${k}" ${ui.filtro === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input id="rp-b" placeholder="Código, descrição ou família" value="${esc(ui.busca)}" style="max-width:280px">
      <span class="small muted">${F.length} item(ns) · consumo de ${D.cfg.janela_dias} dias pelas ${fonte === 'compras' ? 'compras' : 'saídas do Kardex'} · nível de serviço ${D.cfg.nivel_servico}%</span><span style="flex:1"></span>
      ${podeEditar() ? '<button class="btn small" id="rp-apl">Aplicar no cadastro (marcados)</button>' : ''}${podeComprar() ? '<button class="btn small primary" id="rp-req">Requisição de compra (marcados)</button>' : ''}</div>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th><input type="checkbox" id="rp-all" style="width:auto;min-height:0"></th><th>Material</th><th class="num">Consumo/dia</th><th class="num">Prazo</th><th class="num">Mínimo (seg.)</th><th class="num">Ponto de pedido</th><th class="num">Máximo</th><th class="num">No cadastro</th><th class="num">Saldo</th><th class="num">Pedidos</th><th class="num">Cobertura</th><th class="num">Giro</th><th class="num">Comprar</th><th>Situação</th></tr></thead><tbody>
      ${F.map(r => { const s = SIT[r.situacao] || [r.situacao, ''];
        const dif = r.ponto_atual != null && +r.ponto_pedido > 0 ? +r.ponto_atual / +r.ponto_pedido - 1 : null;
        return `<tr><td><input type="checkbox" class="rp-sel" value="${r.produto_id}" style="width:auto;min-height:0"></td><td><b>${esc(r.codigo)}</b> ${esc(r.descricao)}<div class="muted">${esc(r.familia || '')}</div></td>
          <td class="num">${n(r.consumo_dia, 2)} ${esc(r.unidade || '')}</td><td class="num"><a href="#" data-lt="${r.produto_id}" title="Prazo de entrega: ${esc(r.lead_fonte)}">${n(r.lead_time, 0)} d</a><div class="muted">${esc(r.lead_fonte)}</div></td>
          <td class="num">${n(r.estoque_seguranca)}</td><td class="num"><b>${n(r.ponto_pedido)}</b></td><td class="num">${n(r.estoque_maximo)}</td>
          <td class="num ${dif != null && Math.abs(dif) > 0.25 ? 'warn' : ''}" title="mínimo / ponto de pedido do cadastro">${n(r.minimo_atual)} / ${n(r.ponto_atual)}</td>
          <td class="num">${n(r.saldo)}</td><td class="num">${+r.em_pedido ? n(r.em_pedido) : '—'}</td><td class="num">${r.cobertura_dias == null ? '—' : n(r.cobertura_dias, 0) + ' d'}</td><td class="num">${n(r.giro_anual, 1)}</td>
          <td class="num">${+r.sugestao ? `<b>${n(r.sugestao)}</b>` : '—'}</td><td><span class="badge ${s[1]}">${s[0]}</span>${r.situacao === 'parado' && r.dias_sem_saida != null ? `<div class="muted">${r.dias_sem_saida} dias</div>` : ''}</td></tr>`; }).join('')
        || '<tr><td colspan="14" class="empty">Nenhum material neste filtro.</td></tr>'}</tbody></table></div></div>
    <details class="small muted" style="margin-top:10px"><summary>Como é calculado</summary><ul>
      <li><b>Consumo/dia</b> = consumo dos últimos ${D.cfg.janela_dias} dias ÷ dias; a variação (σ) vem do consumo semana a semana.</li>
      <li><b>Mínimo</b> (estoque de segurança) = z × σ × √prazo, com z pelo nível de serviço (${D.cfg.nivel_servico}%). <b>Ponto de pedido</b> = consumo/dia × prazo + mínimo. <b>Máximo</b> = ponto de pedido + consumo/dia × ${D.cfg.intervalo_compra_dias} dias (intervalo entre compras).</li>
      <li><b>Prazo</b>: o do cadastro do produto; sem ele, a média real (do pedido de compra à primeira nota do fornecedor com o produto); sem histórico, ${D.cfg.lead_time_padrao} dias. Clique no prazo para fixar o do produto.</li>
      <li><b>Comprar</b> = máximo − saldo − pedidos em aberto, quando saldo + pedidos ≤ ponto de pedido. <b>Cobertura</b> = saldo ÷ consumo/dia. <b>Giro</b> = consumo de um ano ÷ saldo.</li></ul></details>`;
  $('#rp-f', root).onchange = (e) => { ui.filtro = e.target.value; pintar(root); };
  $('#rp-b', root).oninput = (e) => { ui.busca = e.target.value; clearTimeout(pintar._t); pintar._t = setTimeout(() => { pintar(root); const i = $('#rp-b', root); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  $('#rp-all', root).onchange = (e) => $$('.rp-sel', root).forEach(x => { x.checked = e.target.checked; });
  const marcados = () => $$('.rp-sel:checked', root).map(x => D.lista.find(r => r.produto_id === x.value));
  $('#rp-apl', root) && ($('#rp-apl', root).onclick = () => aplicar(marcados(), root));
  $('#rp-req', root) && ($('#rp-req', root).onclick = () => requisicao(marcados()));
  $$('[data-lt]', root).forEach(a => a.onclick = (e) => { e.preventDefault(); prazo(D.lista.find(r => r.produto_id === a.dataset.lt), root); });
}

async function aplicar(lista, root) {
  const ok = lista.filter(r => +r.consumo_dia > 0);
  if (!ok.length) return toast('Marque materiais com consumo', true);
  const m = modal({ title: 'Aplicar no cadastro', body: `<p>Gravar o mínimo, o ponto de pedido e o máximo calculados em <b>${ok.length}</b> produto(s)? Os valores atuais do cadastro serão substituídos (fica registrado na Auditoria).</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ap-ok">Aplicar</button>' });
  $('#ap-ok', m.el).onclick = async () => {
    try { const k = await q(sb.rpc('est_reposicao_aplicar', { p_empresa: state.empresa.id, p_itens: ok.map(r => ({ produto_id: r.produto_id, minimo: +r.estoque_seguranca, ponto_pedido: +r.ponto_pedido, maximo: +r.estoque_maximo })) }));
      m.close(); toast(`${k} produto(s) atualizado(s)`); render(root); } catch (e) { fail(e); }
  };
}

async function requisicao(lista) {
  const it = lista.map(r => ({ r, q: +r.sugestao || Math.max(0, +r.estoque_maximo - (+r.saldo || 0) - (+r.em_pedido || 0)) })).filter(x => x.q > 0);
  if (!it.length) return toast('Nenhum item marcado com quantidade a comprar', true);
  const m = modal({ title: 'Requisição de compra', wide: true, body: `<div class="table-wrap"><table class="small"><thead><tr><th>Material</th><th class="num">Saldo</th><th class="num">Comprar</th></tr></thead><tbody>
    ${it.map((x, i) => `<tr><td>${esc(x.r.codigo)} ${esc(x.r.descricao)}</td><td class="num">${n(x.r.saldo)}</td><td class="num"><input data-q="${i}" inputmode="decimal" value="${n(x.q, 3)}" style="width:110px;text-align:right"></td></tr>`).join('')}</tbody></table></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rq-ok">Criar requisição</button>' });
  $('#rq-ok', m.el).onclick = async () => {
    const itens = it.map((x, i) => ({ ...x, q: parseNum($(`[data-q="${i}"]`, m.el).value) || 0 })).filter(x => x.q > 0);
    try { const e = state.empresa.id;
      const r = await q(sb.from('compras_requisicoes').insert({ empresa_id: e, solicitante: 'Estoque (reposição pelo consumo)', prioridade: itens.some(x => x.r.situacao === 'critico') ? 'urgente' : 'normal', observacao: 'Materiais no ponto de pedido pela reposição calculada' }).select('id,numero').single());
      await q(sb.from('compras_requisicao_itens').insert(itens.map(x => ({ empresa_id: e, requisicao_id: r.id, produto_id: x.r.produto_id, descricao: `${x.r.codigo} — ${x.r.descricao}`.slice(0, 200), unidade: x.r.unidade || 'UN', quantidade: Math.ceil(x.q * 1000) / 1000 }))));
      m.close(); toast(`Requisição nº ${r.numero} criada`); } catch (err) { fail(err); }
  };
}

function prazo(r, root) {
  if (!podeEditar()) return;
  const m = modal({ title: `Prazo de entrega — ${r.codigo}`, narrow: true, body: `<label>Dias do pedido à entrega (vazio = média real ou padrão)<input id="lt-d" type="number" min="0" max="365" value="${r.lead_fonte === 'produto' ? n(r.lead_time, 0) : ''}"></label><p class="small muted">Hoje: ${n(r.lead_time, 0)} dias (${esc(r.lead_fonte)}).</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lt-ok">Salvar</button>' });
  $('#lt-ok', m.el).onclick = async () => { const v = $('#lt-d', m.el).value.trim(); if (v !== '' && !(+v >= 0 && +v <= 365)) return toast('De 0 a 365 dias', true);
    try { await q(sb.from('produtos').update({ lead_time_dias: v === '' ? null : +v }).eq('id', r.produto_id)); m.close(); render(root); } catch (e) { fail(e); } };
}

function exportar() {
  const rows = [['Código', 'Descrição', 'Família', 'Consumo na janela', 'Consumo/dia', 'Prazo (dias)', 'Fonte do prazo', 'Mínimo', 'Ponto de pedido', 'Máximo', 'Mínimo atual', 'Ponto atual', 'Saldo', 'Pedidos', 'Cobertura (dias)', 'Giro anual', 'Dias sem saída', 'Valor do saldo', 'Comprar', 'Situação']];
  for (const r of filtrada()) rows.push([r.codigo, r.descricao, r.familia || '', +r.consumo_janela, +r.consumo_dia, +r.lead_time, r.lead_fonte, +r.estoque_seguranca, +r.ponto_pedido, +r.estoque_maximo, r.minimo_atual, r.ponto_atual, r.saldo, +r.em_pedido, r.cobertura_dias, r.giro_anual, r.dias_sem_saida, r.valor_saldo, +r.sugestao, r.situacao]);
  exportXLSX(rows, 'reposicao_estoque');
}

function parametros(root) {
  const c = D.cfg;
  const m = modal({ title: 'Parâmetros da reposição', body: `<div class="grid-form">
      <label>Consumo dos últimos (dias, 30 a 365)<input type="number" id="pr-j" min="30" max="365" value="${c.janela_dias}"></label>
      <label>Nível de serviço<select id="pr-n">${[90, 95, 98, 99].map(v => `<option value="${v}" ${+c.nivel_servico === v ? 'selected' : ''}>${v}% (falta em ${100 - v} de cada 100 ciclos)</option>`).join('')}</select></label>
      <label>Prazo de entrega padrão (dias, 1 a 180)<input type="number" id="pr-l" min="1" max="180" value="${c.lead_time_padrao}"></label>
      <label>Intervalo entre compras (dias, 1 a 180)<input type="number" id="pr-i" min="1" max="180" value="${c.intervalo_compra_dias}"></label>
      <label>Parado: sem saída há (dias, 30 a 365)<input type="number" id="pr-p" min="30" max="365" value="${c.parado_dias}"></label>
      <label>Consumo vem de<select id="pr-f"><option value="auto">Automático (Kardex depois de 30 dias da implantação)</option><option value="kardex">Saídas do Kardex</option><option value="compras">Compras pelas notas de entrada</option></select></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pr-ok">Salvar</button>' });
  $('#pr-f', m.el).value = c.fonte;
  $('#pr-ok', m.el).onclick = async () => {
    const v = (id) => +$(id, m.el).value, reg = { empresa_id: state.empresa.id, janela_dias: v('#pr-j'), nivel_servico: v('#pr-n'), lead_time_padrao: v('#pr-l'), intervalo_compra_dias: v('#pr-i'), parado_dias: v('#pr-p'), fonte: $('#pr-f', m.el).value, atualizado_em: new Date().toISOString() };
    if (!(reg.janela_dias >= 30 && reg.janela_dias <= 365) || !(reg.lead_time_padrao >= 1 && reg.lead_time_padrao <= 180) || !(reg.intervalo_compra_dias >= 1 && reg.intervalo_compra_dias <= 180) || !(reg.parado_dias >= 30 && reg.parado_dias <= 365)) return toast('Confira as faixas indicadas', true);
    try { await q(sb.from('est_reposicao_config').upsert(reg)); m.close(); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
  };
}

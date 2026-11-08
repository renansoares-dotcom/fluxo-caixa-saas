// Produção › Manutenção › Preventivas e Peças (PRD022) — melhoria 6.5 (SQL 116, 08/11/2026).
// Planos por horas com as horas reais de máquina (horímetro + apontamentos depois da leitura), o ritmo de horas/dia e a
// data prevista da próxima preventiva; peças críticas com saldo, mínimo, ponto de pedido, consumo e o que os planos vão
// pedir no horizonte, com requisição de compra. Parâmetros: percentual que gera a OS, dias do ritmo, horizonte e aviso.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, dateBR, money, parseNum } from '../lib/ui.js';
import { podePCP, podeApontar } from '../lib/manutencao-ui.js';

export const title = 'Preventivas e Peças';
let P = null;
const nf = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }));
const SIT = { abaixo: ['Abaixo do mínimo', 'vencido'], comprar: ['Comprar', 'aberto'], ok: ['OK', 'pago'], sem_estoque: ['Estoque não implantado', ''] };

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Preventivas e Peças Críticas</h2><div class="muted small">Quando cada preventiva por horas vai vencer, pelo ritmo real das máquinas, e se as peças críticas estão no estoque.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${podePCP() ? '<button class="btn" id="pv-par">Parâmetros</button><button class="btn" id="pv-ger">Gerar preventivas</button>' : ''}</div></div>
    <div id="pv-corpo"><div class="loading">Calculando as horas de máquina…</div></div>`;
  $('#pv-par', root) && ($('#pv-par', root).onclick = () => parametros(root));
  $('#pv-ger', root) && ($('#pv-ger', root).onclick = async () => { try { const n = await q(sb.rpc('man_gerar_preventivas', { p_empresa: state.empresa.id, p_ate: null })); toast(+n ? `${n} OS preventiva(s) gerada(s)` : 'Nenhuma preventiva a gerar agora'); render(root); } catch (e) { fail(e); } });
  try {
    const e = state.empresa.id;
    const [hor, pec, par, eqs, prods] = await Promise.all([
      q(sb.rpc('man_preventivas_horas', { p_empresa: e })), q(sb.rpc('man_pecas_situacao', { p_empresa: e })),
      q(sb.from('man_parametros').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.from('man_equipamentos').select('id,codigo,nome,horimetro,horimetro_em').eq('empresa_id', e).neq('situacao', 'inativo').order('codigo')),
      q(sb.from('produtos').select('id,codigo,descricao,unidade').eq('empresa_id', e).neq('tipo_sped', '04').order('codigo').limit(3000)).catch(() => [])]);
    P = { hor, pec, par: { gerar_horas_pct: 90, dias_ritmo: 30, horizonte_pecas_dias: 30, avisar_pecas: true, avisar_pecas_dias: 7, ...(par || {}) }, eqs, prods };
    pintar(root);
  } catch (err) { fail(err); $('#pv-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 116 já foi executado.</div></div>'; }
}

function pintar(root) {
  const pr = P.par, gera = +pr.gerar_horas_pct;
  const barra = (pct) => { const c = pct >= 100 ? 'var(--neg)' : pct >= gera ? 'var(--warn)' : 'var(--pos)';
    return `<div style="height:8px;background:var(--surface-2);border-radius:4px;min-width:120px"><div style="height:8px;width:${Math.min(100, pct || 0)}%;background:${c};border-radius:4px"></div></div>`; };
  const abaixo = P.pec.filter(p => p.situacao === 'abaixo' || p.situacao === 'comprar');
  $('#pv-corpo', root).innerHTML = `
    <div class="card flush"><div style="padding:12px 16px 0;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><h3 style="margin:0">Preventivas por horas</h3>
      <div class="small muted">Horas de máquina = última leitura do horímetro + horas apontadas na produção depois dela. A OS é gerada a partir de ${gera}% do intervalo. Ritmo = média de horas/dia dos últimos ${pr.dias_ritmo} dias.</div></div>
      ${podeApontar() ? '<button class="btn small" id="pv-hor">Lançar leitura do horímetro</button>' : ''}</div>
      <div class="table-wrap"><table class="small"><thead><tr><th>Plano</th><th>Equipamento</th><th class="num">Intervalo</th><th class="num">Desde a última</th><th style="min-width:140px">Uso do intervalo</th><th class="num">Ritmo</th><th>Previsão</th><th>Fonte das horas</th><th>OS</th></tr></thead><tbody>
      ${P.hor.map(h => `<tr><td><b>${esc(h.plano)}</b></td><td>${esc(h.equipamento)} <span class="muted">${esc(h.criticidade || '')}</span></td><td class="num">${nf(h.a_cada_horas, 0)} h</td>
        <td class="num">${nf(h.desde_ultima)} h</td><td>${barra(+h.pct)}<div class="muted">${nf(h.pct)}%</div></td><td class="num">${h.ritmo_h_dia > 0 ? nf(h.ritmo_h_dia) + ' h/dia' : '—'}</td>
        <td>${+h.pct >= 100 ? '<span class="badge vencido">vencida</span>' : h.previsao ? `${dateBR(h.previsao)} <span class="muted">(${nf(h.dias_restantes, 0)} dias)</span>` : '<span class="muted">máquina parada</span>'}</td>
        <td class="muted">${esc(h.fonte)}</td><td>${h.os_aberta ? '<span class="badge aberto">aberta</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nenhum plano por horas. Cadastre o intervalo em horas no plano (Equipamentos e Planos).</td></tr>'}</tbody></table></div></div>
    <div class="card flush" id="pv-pec" style="margin-top:12px;scroll-margin-top:84px"><div style="padding:12px 16px 0;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><h3 style="margin:0">Peças críticas</h3>
      <div class="small muted">Previsto = peças dos planos que vencem nos próximos ${pr.horizonte_pecas_dias} dias. "Comprar" = saldo no ponto de pedido ou saldo − previsto abaixo do mínimo.</div></div>
      <div style="display:flex;gap:6px">${podePCP() ? '<button class="btn small" id="pv-nova">+ Peça crítica</button>' : ''}${abaixo.length && podePCP() ? `<button class="btn small primary" id="pv-req">Requisição de compra (${abaixo.length})</button>` : ''}</div></div>
      <div class="table-wrap"><table class="small"><thead><tr><th>Peça</th><th>Equipamento</th><th class="num">Saldo</th><th class="num">Mínimo</th><th class="num">Ponto de pedido</th><th class="num">Previsto nos planos</th><th class="num">Consumo 12 meses</th><th class="num">Último preço</th><th>Situação</th><th></th></tr></thead><tbody>
      ${P.pec.map(p => `<tr><td><b>${esc(p.codigo)}</b> ${esc(p.descricao)}</td><td>${esc(p.equipamento || 'várias')}</td><td class="num">${p.saldo == null ? '—' : nf(p.saldo, 3)}</td><td class="num">${nf(p.minimo, 3)}</td><td class="num">${nf(p.ponto_pedido, 3)}</td>
        <td class="num">${nf(p.previsto_planos, 3)}</td><td class="num">${nf(p.consumo_12m, 3)}</td><td class="num">${p.ultimo_preco != null ? money(p.ultimo_preco) : '—'}</td>
        <td><span class="badge ${SIT[p.situacao]?.[1] || ''}">${SIT[p.situacao]?.[0] || p.situacao}</span></td><td>${podePCP() ? `<button class="btn ghost small" data-ed="${p.id}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Nenhuma peça crítica cadastrada.</td></tr>'}</tbody></table></div></div>`;
  $('#pv-nova', root) && ($('#pv-nova', root).onclick = () => peca(null, root));
  $$('[data-ed]', root).forEach(b => b.onclick = () => peca(P.pec.find(p => p.id === b.dataset.ed), root));
  $('#pv-req', root) && ($('#pv-req', root).onclick = () => requisicao(abaixo, root));
  $('#pv-hor', root) && ($('#pv-hor', root).onclick = () => leitura(root));
}

function peca(p, root) {
  const m = modal({ title: p ? `Peça crítica — ${p.codigo}` : 'Nova peça crítica', body: `
    <label>Peça<input id="pc-p" list="pc-dl" value="${p ? esc(p.codigo + ' — ' + p.descricao) : ''}" ${p ? 'disabled' : ''} placeholder="Código ou descrição"><datalist id="pc-dl">${P.prods.map(x => `<option value="${esc(x.codigo + ' — ' + x.descricao)}">`).join('')}</datalist></label>
    <label style="margin-top:8px">Equipamento (vazio = peça comum a várias máquinas)<select id="pc-e" ${p ? 'disabled' : ''}><option value="">—</option>${P.eqs.map(e => `<option value="${e.id}">${esc(e.codigo + ' ' + e.nome)}</option>`).join('')}</select></label>
    <div class="grid-form" style="margin-top:8px"><label>Mínimo<input id="pc-m" inputmode="decimal" value="${p ? nf(p.minimo, 3) : ''}"></label><label>Ponto de pedido (≥ mínimo)<input id="pc-pp" inputmode="decimal" value="${p?.ponto_pedido != null ? nf(p.ponto_pedido, 3) : ''}"></label></div>
    <label style="margin-top:8px">Observação<input id="pc-o" maxlength="500" value="${esc(p?.observacao || '')}" placeholder="Ex.: prazo de entrega de 30 dias, importada"></label>
    ${p && p.consumo_12m > 0 ? `<p class="small muted">Consumo nos últimos 12 meses: ${nf(p.consumo_12m, 3)} — cerca de ${nf(p.consumo_12m / 12, 2)} por mês.</p>` : ''}`,
    foot: `${p ? '<button class="btn danger" id="pc-x" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pc-ok">Salvar</button>` });
  $('#pc-ok', m.el).onclick = async () => {
    const min = parseNum($('#pc-m', m.el).value), pp = $('#pc-pp', m.el).value.trim() ? parseNum($('#pc-pp', m.el).value) : null;
    if (!(min > 0)) return toast('Informe o mínimo', true);
    if (pp != null && pp < min) return toast('O ponto de pedido não pode ficar abaixo do mínimo', true);
    try {
      if (p) await q(sb.from('man_pecas_criticas').update({ minimo: min, ponto_pedido: pp, observacao: $('#pc-o', m.el).value.trim() || null }).eq('id', p.id));
      else {
        const v = $('#pc-p', m.el).value, prod = P.prods.find(x => `${x.codigo} — ${x.descricao}` === v) || P.prods.find(x => x.codigo === v.trim());
        if (!prod) return toast('Escolha a peça da lista', true);
        await q(sb.from('man_pecas_criticas').insert({ empresa_id: state.empresa.id, produto_id: prod.id, equipamento_id: $('#pc-e', m.el).value || null, minimo: min, ponto_pedido: pp, observacao: $('#pc-o', m.el).value.trim() || null }));
      }
      m.close(); toast('Peça crítica salva'); render(root);
    } catch (e) { fail(e); }
  };
  $('#pc-x', m.el) && ($('#pc-x', m.el).onclick = async () => { try { await q(sb.from('man_pecas_criticas').delete().eq('id', p.id)); m.close(); render(root); } catch (e) { fail(e); } });
}

async function requisicao(lista, root) {
  // quantidade sugerida: até o ponto de pedido (ou o mínimo) mais o previsto nos planos
  const itens = lista.map(p => ({ p, q: Math.max(0, (+(p.ponto_pedido ?? p.minimo)) + (+p.previsto_planos || 0) - (+p.saldo || 0)) })).filter(x => x.q > 0);
  if (!itens.length) return toast('Nada a comprar pelo saldo atual', true);
  const m = modal({ title: 'Requisição de compra das peças críticas', body: `<div class="table-wrap"><table class="small"><thead><tr><th>Peça</th><th class="num">Saldo</th><th class="num">Comprar</th></tr></thead><tbody>
    ${itens.map((x, i) => `<tr><td>${esc(x.p.codigo)} ${esc(x.p.descricao)}</td><td class="num">${nf(x.p.saldo, 3)}</td><td class="num"><input data-q="${i}" inputmode="decimal" value="${nf(x.q, 3)}" style="width:90px;text-align:right"></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Sugestão: até o ponto de pedido mais o previsto nos planos, menos o saldo.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rq-ok">Criar requisição</button>' });
  $('#rq-ok', m.el).onclick = async () => {
    const it = itens.map((x, i) => ({ ...x, q: parseNum($(`[data-q="${i}"]`, m.el).value) || 0 })).filter(x => x.q > 0);
    if (!it.length) return toast('Informe as quantidades', true);
    try { const e = state.empresa.id;
      const r = await q(sb.from('compras_requisicoes').insert({ empresa_id: e, solicitante: 'Manutenção (peças críticas)', prioridade: it.some(x => x.p.situacao === 'abaixo') ? 'urgente' : 'normal', observacao: 'Peças críticas abaixo do mínimo ou no ponto de pedido' }).select('id,numero').single());
      await q(sb.from('compras_requisicao_itens').insert(it.map(x => ({ empresa_id: e, requisicao_id: r.id, produto_id: x.p.produto_id, descricao: `${x.p.codigo} — ${x.p.descricao}`.slice(0, 200), unidade: x.p.unidade || 'UN', quantidade: Math.ceil(x.q * 1000) / 1000 }))));
      m.close(); toast(`Requisição nº ${r.numero} criada`); } catch (err) { fail(err); }
  };
}

function leitura(root) {
  const m = modal({ title: 'Leitura do horímetro', narrow: true, body: `
    <label>Equipamento<select id="lh-e">${P.eqs.map(e => `<option value="${e.id}">${esc(e.codigo + ' ' + e.nome)}${e.horimetro != null ? ` — última ${nf(e.horimetro)} h em ${dateBR(e.horimetro_em)}` : ''}</option>`).join('')}</select></label>
    <div class="grid-form" style="margin-top:8px"><label>Horímetro (h)<input id="lh-h" inputmode="decimal"></label><label>Data<input type="date" id="lh-d" value="${new Date().toISOString().slice(0, 10)}"></label></div>
    <p class="small muted">Depois da leitura, as horas de máquina passam a ser esta leitura mais as horas apontadas na produção.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lh-ok">Lançar</button>' });
  $('#lh-ok', m.el).onclick = async () => {
    const h = parseNum($('#lh-h', m.el).value); if (!(h >= 0)) return toast('Informe o horímetro', true);
    const eq = P.eqs.find(x => x.id === $('#lh-e', m.el).value);
    if (eq?.horimetro != null && h < +eq.horimetro) return toast(`A leitura não pode ser menor que a última (${nf(eq.horimetro)} h)`, true);
    try { await q(sb.from('man_leituras').insert({ empresa_id: state.empresa.id, equipamento_id: eq.id, horimetro: h, data: $('#lh-d', m.el).value })); m.close(); toast('Leitura lançada'); render(root); } catch (e) { fail(e); }
  };
}

function parametros(root) {
  const c = P.par;
  const m = modal({ title: 'Parâmetros das preventivas e peças', body: `
    <div class="grid-form">
      <label>Gerar a OS por horas a partir de (% do intervalo, 50 a 100)<input type="number" id="pp-g" min="50" max="100" step="1" value="${c.gerar_horas_pct}"></label>
      <label>Ritmo: média de horas/dia dos últimos N dias (7 a 180)<input type="number" id="pp-r" min="7" max="180" value="${c.dias_ritmo}"></label>
      <label>Peças previstas: planos que vencem nos próximos N dias (7 a 180)<input type="number" id="pp-h" min="7" max="180" value="${c.horizonte_pecas_dias}"></label>
      <label>Repetir o aviso da mesma peça a cada N dias (1 a 60)<input type="number" id="pp-a" min="1" max="60" value="${c.avisar_pecas_dias}"></label></div>
    <label class="chk" style="margin-top:8px"><input type="checkbox" id="pp-av" ${c.avisar_pecas ? 'checked' : ''}> Avisar todo dia (7h37) quando uma peça crítica ficar abaixo do mínimo — administrador, diretor, compras e produção</label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pp-ok">Salvar</button>' });
  $('#pp-ok', m.el).onclick = async () => {
    const v = (id) => +$(id, m.el).value, reg = { empresa_id: state.empresa.id, gerar_horas_pct: v('#pp-g'), dias_ritmo: v('#pp-r'), horizonte_pecas_dias: v('#pp-h'), avisar_pecas_dias: v('#pp-a'), avisar_pecas: $('#pp-av', m.el).checked, atualizado_em: new Date().toISOString() };
    if (!(reg.gerar_horas_pct >= 50 && reg.gerar_horas_pct <= 100) || !(reg.dias_ritmo >= 7 && reg.dias_ritmo <= 180) || !(reg.horizonte_pecas_dias >= 7 && reg.horizonte_pecas_dias <= 180) || !(reg.avisar_pecas_dias >= 1 && reg.avisar_pecas_dias <= 60)) return toast('Confira as faixas indicadas', true);
    try { await q(sb.from('man_parametros').upsert(reg)); m.close(); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
  };
}

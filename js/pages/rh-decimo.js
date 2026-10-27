// RH › 13º salário: provisão por colaborador (avos pela admissão, médias, o que já foi adiantado) e as datas de caixa:
// 1ª parcela até 30/11, 2ª até 20/12, INSS e FGTS sobre o 13º. Vira previsão no fluxo como a folha do mês.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, money, dateBR, toast, fail } from '../lib/ui.js';
import { itensDecimo, eventosDecimo, calcDecimo, EVENTOS, VINCULOS } from '../lib/rh.js';
import { temRH, podeRH, carregarBase, carregarFolha, gravarFolha, salvarEventos, blocoEventos, avisoMigracao, kpi } from '../lib/rh-dados.js';
import { inp, num } from '../lib/compras.js';

export const title = 'RH — 13º salário';
const ui = { ano: new Date().getFullYear() };

export async function render(root) {
  if (!temRH()) { root.innerHTML = '<div class="card"><div class="empty">Acesso ao RH só para administrador ou quem tem a área RH liberada.</div></div>'; return; }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">13º salário</h2><div class="muted small">Provisão e caixa: 1ª parcela até 30/11, 2ª até 20/12, encargos em dezembro e janeiro.</div></div>
      <label class="small" style="display:flex;gap:6px;align-items:center">Ano <select id="rd-ano" data-nobusca>${[ui.ano - 1, ui.ano, ui.ano + 1].map(a => `<option ${a === ui.ano ? 'selected' : ''}>${a}</option>`).join('')}</select></label></div>
    <div id="rd-corpo"><div class="loading">Carregando…</div></div>`;
  $('#rd-ano', root).onchange = (e) => { ui.ano = +e.target.value; render(root); };
  let B; try { B = await carregarBase(); } catch (err) { console.error(err); $('#rd-corpo', root).innerHTML = avisoMigracao; return; }
  try { await corpo($('#rd-corpo', root), B, root); } catch (err) { fail(err); }
}

async function adiantadosNoAno(B) {
  // 13º adiantado pelo financeiro no ano (plano 2.13.04 "13° SALÁRIO" dos adiantamentos e o plano do 13º): ajuda a preencher "já adiantado"
  const pls = state.cad.contasPlano.filter(p => p.codigo === '2.13.04' || p.id === B.planos.decimo).map(p => p.id);
  if (!pls.length) return [];
  return fetchAll(() => sb.from('lancamentos').select('data,valor,descricao,origem').eq('empresa_id', state.empresa.id).eq('status', 'Pago').in('plano_id', pls)
    .gte('data', `${ui.ano}-01-01`).lte('data', `${ui.ano}-12-31`).order('data'));
}

async function corpo(el, B, root) {
  const competencia = `${ui.ano}-12-01`;
  const F = await carregarFolha(competencia, 'decimo');
  const adiant = (await adiantadosNoAno(B).catch(() => [])).filter(l => !String(l.origem || '').startsWith('rh:'));
  const totAd = adiant.reduce((s, l) => s + +l.valor, 0);
  const blocoAd = adiant.length ? `<details class="card" style="margin-top:12px"><summary><b>13º já adiantado em ${ui.ano} pelo financeiro: ${money(totAd)}</b> (${adiant.length} pagamento(s)) — distribua por pessoa na coluna "Já adiantado"</summary>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>${adiant.map(l => `<tr><td>${dateBR(l.data)}</td><td>${esc(l.descricao || '')}</td><td class="num">${money(l.valor)}</td></tr>`).join('')}</tbody></table></div></details>` : '';
  if (!F) {
    const it = itensDecimo(B.colabs, B.P, ui.ano), ev = eventosDecimo(ui.ano, it, B.colabById, B.P);
    const semAdm = it.filter(x => !B.colabById[x.colaborador_id]?.admissao).length;
    el.innerHTML = `<div class="kpis">${kpi('Com direito', it.length)}${kpi('13º bruto', money(it.reduce((s, x) => s + x.bruto, 0)))}
        ${ev.map(e => kpi(EVENTOS[e.evento], money(e.valor), dateBR(e.vencimento))).join('')}${kpi('Caixa total', money(ev.reduce((s, e) => s + e.valor, 0)))}</div>
      <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Estimativa do 13º de ${ui.ano} (ainda não gravada)</h2>
        <p>Pelo cadastro: salário × avos/12. ${semAdm ? `<span class="warn">${semAdm} pessoa(s) sem data de admissão entram com 12 avos</span> — preencha a admissão de quem entrou em ${ui.ano}.` : ''}
        Médias de horas extras e o que já foi adiantado entram por pessoa depois de montar.</p>
        ${podeRH() && it.length ? '<button class="btn primary" id="rd-montar">Montar o 13º</button>' : ''}${!it.length ? '<p class="empty">Cadastre os colaboradores primeiro.</p>' : ''}</div>${blocoAd}`;
    $('#rd-montar', el) && ($('#rd-montar', el).onclick = async (e) => {
      e.target.disabled = true;
      try { await gravarFolha(B, { competencia, tipo: 'decimo', itens: it, eventos: ev }); toast('13º montado'); render(root); } catch (err) { fail(err); e.target.disabled = false; }
    });
    return;
  }
  const pode = podeRH() && F.status !== 'encerrada';
  const itens = F.itens.map(it => ({ ...it, c: B.colabById[it.colaborador_id] || { nome: '?' } })).sort((a, b) => a.c.nome.localeCompare(b.c.nome));
  const soma = (k) => itens.reduce((s, it) => s + (+it[k] || 0), 0);
  el.innerHTML = `<div class="kpis">${kpi('Com direito', itens.length)}${kpi('13º bruto', money(soma('bruto')))}${kpi('1ª parcela', money(soma('adiantamento')))}${kpi('2ª parcela', money(soma('liquido')))}
      ${kpi('Já adiantado', money(soma('adiant_pago')), totAd ? `financeiro pagou ${money(totAd)} no ano` : '', totAd && Math.abs(totAd - soma('adiant_pago')) > 1 ? 'warn' : '')}</div>
    <div id="rd-ev" style="margin-top:12px"></div>${blocoAd}
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Por colaborador</h2>
      <div style="display:flex;gap:8px">${pode ? '<button class="btn small" id="rd-recalc">Refazer pelo cadastro</button><button class="btn small primary" id="rd-salvar">Salvar e atualizar pagamentos</button>' : ''}</div></div>
      <div class="table-wrap" style="max-height:60vh"><table><thead><tr><th>Nome</th><th>Cargo</th><th>Admissão</th><th class="num">Salário</th><th class="num">Avos</th><th class="num">Médias (HE etc.)</th><th class="num">Já adiantado</th>
        <th class="num">Bruto</th><th class="num">1ª parcela</th><th class="num">Descontos</th><th class="num">2ª parcela</th></tr></thead><tbody>
      ${itens.map(it => `<tr data-id="${it.id}"><td>${esc(it.c.nome)}</td><td class="small">${esc(it.c.cargo || '')}${it.c.vinculo !== 'clt' ? ` · ${VINCULOS[it.c.vinculo]}` : ''}</td><td>${dateBR(it.c.admissao) || '<span class="muted">—</span>'}</td><td class="num">${money(it.salario)}</td>
        <td class="num">${pode ? `<input class="it-avos num" style="width:50px" value="${it.avos ?? 12}">` : it.avos}</td>
        ${['proventos', 'adiant_pago'].map(k => `<td class="num">${pode ? `<input class="it-${k} num" style="width:95px" value="${inp(it[k])}">` : money(it[k])}</td>`).join('')}
        <td class="num it-bruto">${money(it.bruto)}</td><td class="num it-p1">${money(it.adiantamento)}</td><td class="num it-desc">${money(it.descontos)}</td><td class="num it-p2">${money(it.liquido)}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="small muted">Bruto = salário × avos/12 + médias. 1ª parcela = metade do bruto − já adiantado (sem descontos). 2ª = bruto − 1ª − já adiantado − descontos (${(+B.P.desc13_pct).toLocaleString('pt-BR')}% do bruto, estimativa de INSS/IRRF do empregado).
      INSS sobre o 13º: ${(+B.P.inss_pct).toLocaleString('pt-BR')}% do bruto na guia de dezembro; FGTS ${(+B.P.fgts_pct).toLocaleString('pt-BR')}% da 1ª parcela em dezembro e da 2ª em janeiro. Avos: meses com 15 dias ou mais trabalhados no ano.</p>`;
  await blocoEventos($('#rd-ev', el), B, F, () => render(root));
  const ler = () => itens.map(it => { const tr = $(`tr[data-id="${it.id}"]`, el); if (!tr || !$('.it-avos', tr)) return it;
    return calcDecimo({ ...it, avos: Math.max(0, Math.min(12, Math.round(num($('.it-avos', tr).value)))), proventos: num($('.it-proventos', tr).value), adiant_pago: num($('.it-adiant_pago', tr).value) }, B.P); });
  el.addEventListener('input', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr || !e.target.matches('[class^="it-"]')) return;
    const x = ler().find(i => i.id === tr.dataset.id); $('.it-bruto', tr).textContent = money(x.bruto); $('.it-p1', tr).textContent = money(x.adiantamento); $('.it-desc', tr).textContent = money(x.descontos); $('.it-p2', tr).textContent = money(x.liquido); });
  $('#rd-salvar', el) && ($('#rd-salvar', el).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const xs = ler();
      for (const x of xs) { const o = itens.find(i => i.id === x.id); if (['avos', 'proventos', 'adiant_pago', 'bruto', 'adiantamento', 'descontos', 'liquido'].some(k => +o[k] !== +x[k]))
        await q(sb.from('rh_folha_itens').update({ avos: x.avos, proventos: x.proventos, adiant_pago: x.adiant_pago, bruto: x.bruto, adiantamento: x.adiantamento, descontos: x.descontos, liquido: x.liquido }).eq('id', x.id)); }
      const ev = eventosDecimo(ui.ano, xs, B.colabById, B.P).map(n => ({ ...n, vencimento: F.eventos.find(a => a.evento === n.evento)?.vencimento || n.vencimento, conta_id: F.eventos.find(a => a.evento === n.evento)?.conta_id }));
      await salvarEventos(B, F.id, ev);
      toast(F.status === 'prevista' ? 'Salvo — clique em "Lançar previsão" para atualizar o fluxo' : 'Salvo'); render(root);
    } catch (err) { fail(err); e.target.disabled = false; }
  });
  $('#rd-recalc', el) && ($('#rd-recalc', el).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const ant = Object.fromEntries(F.itens.map(i => [i.colaborador_id, { proventos: i.proventos, adiant_pago: i.adiant_pago }]));   // mantém médias e adiantados digitados
      const it = itensDecimo(B.colabs, B.P, ui.ano, ant);
      await gravarFolha(B, { competencia, tipo: 'decimo', itens: it, eventos: eventosDecimo(ui.ano, it, B.colabById, B.P), folhaId: F.id }); toast('13º refeito pelo cadastro'); render(root);
    } catch (err) { fail(err); e.target.disabled = false; }
  });
}

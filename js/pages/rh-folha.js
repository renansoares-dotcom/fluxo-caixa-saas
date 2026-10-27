// RH › Folha do mês: monta a folha estimada da competência a partir do cadastro (adiantamento, saldo, guias de INSS/FGTS),
// ajusta por pessoa (horas extras, descontos) e lança a PREVISÃO no fluxo de caixa. A folha oficial continua no Iniflex/contabilidade.
// Aba Parâmetros: datas, percentuais, conta e plano de contas, calibrados pelo que foi pago nos últimos meses.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, toast, fail, MESES } from '../lib/ui.js';
import { itensMensal, eventosMensal, liquidoItem, datasFolha, PARAM_PADRAO, PLANO_PADRAO, VINCULOS } from '../lib/rh.js';
import { temRH, podeRH, carregarBase, carregarFolha, gravarFolha, salvarEventos, blocoEventos, historicoPago, avisoMigracao, kpi } from '../lib/rh-dados.js';
import { inp, num } from '../lib/compras.js';

export const title = 'RH — folha do mês';
const ui = { aba: 'folha', comp: new Date().toISOString().slice(0, 7) };
const nomeComp = (c) => `${MESES[+c.slice(5) - 1].toLowerCase()}/${c.slice(0, 4)}`;
const pctTxt = (v) => (v == null ? '–' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%');

export async function render(root) {
  if (!temRH()) { root.innerHTML = '<div class="card"><div class="empty">Acesso ao RH só para administrador ou quem tem a área RH liberada.</div></div>'; return; }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Folha do mês</h2><div class="muted small">Previsão de caixa da folha a partir do cadastro. A folha oficial é feita no Iniflex/contabilidade.</div></div></div>
    <div class="card toolbar" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <div class="chips" id="rf-abas">${[['folha', 'Folha'], ['param', 'Parâmetros']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      ${ui.aba === 'folha' ? `<label class="small" style="display:flex;gap:6px;align-items:center">Competência <input type="month" id="rf-comp" value="${ui.comp}"></label>` : ''}</div>
    <div id="rf-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#rf-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  $('#rf-comp', root) && ($('#rf-comp', root).onchange = (e) => { if (e.target.value) { ui.comp = e.target.value; render(root); } });
  let B; try { B = await carregarBase(); } catch (err) { console.error(err); $('#rf-corpo', root).innerHTML = avisoMigracao; return; }
  const corpo = $('#rf-corpo', root);
  try { if (ui.aba === 'param') await parametros(corpo, B, root); else await folha(corpo, B, root); } catch (err) { fail(err); }
}

async function folha(corpo, B, root) {
  const competencia = ui.comp + '-01';
  const F = await carregarFolha(competencia, 'mensal');
  const d = datasFolha(ui.comp, B.P);
  if (!F) {
    const it = itensMensal(B.colabs, B.P), ev = eventosMensal(ui.comp, it, B.colabById, B.P);
    const semSal = B.colabs.filter(c => c.situacao !== 'desligado' && !['extra_folha', 'pro_labore'].includes(c.vinculo) && !+c.salario).length;
    corpo.innerHTML = `<div class="card"><h2 style="margin-top:0">Folha de ${nomeComp(ui.comp)} ainda não montada</h2>
      ${B.colabs.length ? `<p>Pelo cadastro e pelos parâmetros: <b>${it.length}</b> colaborador(es) na folha, base ${money(it.reduce((s, x) => s + x.salario, 0))}.</p>
      <div class="table-wrap"><table><thead><tr><th>Pagamento</th><th>Data</th><th class="num">Valor estimado</th></tr></thead><tbody>
        ${ev.map(e => `<tr><td>${{ adiantamento: 'Adiantamento salarial', saldo: 'Saldo da folha', inss: 'INSS (guia)', fgts: 'FGTS (guia)', irrf: 'IRRF' }[e.evento]}</td><td>${dateBR(e.vencimento)}</td><td class="num">${money(e.valor)}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td></td><td class="num"><b>${money(ev.reduce((s, e) => s + e.valor, 0))}</b></td></tr></tbody></table></div>
      ${semSal ? `<p class="warn small">${semSal} colaborador(es) sem salário no cadastro entram com zero.</p>` : ''}
      ${podeRH() ? '<button class="btn primary" id="rf-montar" style="margin-top:12px">Montar folha a partir do cadastro</button>' : ''}`
      : '<p class="empty">Cadastre os colaboradores primeiro (RH › Colaboradores › Importar relação).</p>'}
      <p class="small muted">Datas: adiantamento dia ${B.P.dia_adiantamento} (${dateBR(d.adiantamento)}), saldo no ${B.P.dia_util_saldo}º dia útil do mês seguinte (${dateBR(d.saldo)}), guias dia ${B.P.dia_guias} (${dateBR(d.guias)}). Ajuste em Parâmetros.</p></div>`;
    $('#rf-montar', corpo) && ($('#rf-montar', corpo).onclick = async (e) => {
      e.target.disabled = true;
      try { await gravarFolha(B, { competencia, tipo: 'mensal', itens: it, eventos: ev }); toast('Folha montada'); render(root); } catch (err) { fail(err); e.target.disabled = false; }
    });
    return;
  }
  const pode = podeRH() && F.status !== 'encerrada';
  const itens = F.itens.map(it => ({ ...it, c: B.colabById[it.colaborador_id] || { nome: '?' } })).sort((a, b) => a.c.nome.localeCompare(b.c.nome));
  const soma = (k) => itens.reduce((s, it) => s + +it[k], 0);
  const novos = B.colabs.filter(c => c.situacao !== 'desligado' && !['extra_folha', 'pro_labore'].includes(c.vinculo) && !F.itens.some(it => it.colaborador_id === c.id));
  corpo.innerHTML = `<div class="kpis">${kpi('Colaboradores', itens.length, novos.length ? `<span class="warn">${novos.length} no cadastro fora desta folha</span>` : '')}
      ${kpi('Base (salários + proventos)', money(soma('salario') + soma('proventos')))}${kpi('Adiantamento', money(soma('adiantamento')))}${kpi('Saldo', money(soma('liquido')))}
      ${kpi('Caixa total previsto', money(F.eventos.reduce((s, e) => s + +e.valor, 0)), 'com as guias')}</div>
    <div id="rf-ev" style="margin-top:12px"></div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Por colaborador</h2>
      <div style="display:flex;gap:8px">${pode ? '<button class="btn small" id="rf-recalc">Refazer pelo cadastro</button><button class="btn small primary" id="rf-salvar">Salvar e atualizar pagamentos</button>' : ''}</div></div>
      <div class="table-wrap" style="max-height:60vh"><table><thead><tr><th>Nome</th><th>Cargo</th><th>Vínculo</th><th class="num">Salário</th><th class="num">Horas extras / proventos</th><th class="num">Descontos extras</th><th class="num">Adiantamento</th><th class="num">Saldo</th></tr></thead><tbody>
      ${itens.map(it => `<tr data-id="${it.id}"><td>${esc(it.c.nome)}</td><td class="small">${esc(it.c.cargo || '')}</td><td class="small">${VINCULOS[it.c.vinculo] || ''}</td><td class="num">${money(it.salario)}</td>
        ${['proventos', 'descontos', 'adiantamento'].map(k => `<td class="num">${pode ? `<input class="it-${k} num" style="width:100px" value="${inp(it[k])}">` : money(it[k])}</td>`).join('')}
        <td class="num it-liq">${money(it.liquido)}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="small muted">Saldo = (salário + proventos) × ${pctTxt(B.P.fator_liquido)} − descontos extras − adiantamento. O fator cobre INSS/IRRF/VT do empregado; calibre em Parâmetros pelo que foi pago.
      "Refazer pelo cadastro" refaz todos os itens (perde horas extras digitadas) e recalcula os pagamentos.</p>`;
  await blocoEventos($('#rf-ev', corpo), B, F, () => render(root));
  const lerItens = () => itens.map(it => { const tr = $(`tr[data-id="${it.id}"]`, corpo); if (!tr || !$('.it-proventos', tr)) return it;
    const x = { ...it, proventos: num($('.it-proventos', tr).value), descontos: num($('.it-descontos', tr).value), adiantamento: num($('.it-adiantamento', tr).value) };
    x.liquido = liquidoItem(x, B.P); return x; });
  corpo.addEventListener('input', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr || !e.target.matches('[class^="it-"]')) return;
    const x = lerItens().find(i => i.id === tr.dataset.id); $('.it-liq', tr).textContent = money(x.liquido); });
  $('#rf-salvar', corpo) && ($('#rf-salvar', corpo).onclick = async (e) => {
    e.target.disabled = true;
    try {
      const xs = lerItens();
      for (const x of xs) { const o = itens.find(i => i.id === x.id); if (['proventos', 'descontos', 'adiantamento', 'liquido'].some(k => +o[k] !== +x[k]))
        await q(sb.from('rh_folha_itens').update({ proventos: x.proventos, descontos: x.descontos, adiantamento: x.adiantamento, liquido: x.liquido }).eq('id', x.id)); }
      // os valores dos pagamentos são refeitos pelos itens; as datas que você mudou ficam
      const ev = eventosMensal(ui.comp, xs, B.colabById, B.P).map(n => ({ ...n, vencimento: F.eventos.find(a => a.evento === n.evento)?.vencimento || n.vencimento,
        conta_id: F.eventos.find(a => a.evento === n.evento)?.conta_id }));
      await salvarEventos(B, F.id, ev);
      toast(F.status === 'prevista' ? 'Salvo — clique em "Lançar previsão" para atualizar o fluxo' : 'Salvo'); render(root);
    } catch (err) { fail(err); e.target.disabled = false; }
  });
  $('#rf-recalc', corpo) && ($('#rf-recalc', corpo).onclick = async (e) => {
    e.target.disabled = true;
    try { const it = itensMensal(B.colabs, B.P); await gravarFolha(B, { competencia, tipo: 'mensal', itens: it, eventos: eventosMensal(ui.comp, it, B.colabById, B.P), folhaId: F.id }); toast('Folha refeita pelo cadastro'); render(root); }
    catch (err) { fail(err); e.target.disabled = false; }
  });
}

async function parametros(corpo, B, root) {
  const P = B.P, pode = podeRH();
  const H = await historicoPago(B).catch(() => []);
  const base = B.colabs.filter(c => c.situacao !== 'desligado' && !['extra_folha', 'pro_labore'].includes(c.vinculo)).reduce((s, c) => s + (+c.salario || 0), 0);
  const ult = H.slice(-3);
  const med = (k) => ult.length ? ult.reduce((s, r) => s + r[k], 0) / ult.length : null;
  const sug = base ? { pct_adiantamento: med('adiantamento') / base * 100, fator_liquido: (med('adiantamento') + med('saldo')) / base * 100, inss_pct: med('inss') / base * 100, fgts_pct: null } : {};
  const campo = (k, lab, ajuda = '') => `<label>${lab}<input id="rp-${k}" value="${inp(P[k])}" ${pode ? '' : 'disabled'}>
      <span class="small muted">${ajuda}${sug[k] ? ` · últimos 3 meses: <a href="#" class="rp-usar" data-k="${k}" data-v="${sug[k].toFixed(1)}">${pctTxt(sug[k])}</a>` : ''}</span></label>`;
  const selPlano = (k, lab) => `<label>${lab}<select id="rp-pl-${k}" ${pode ? '' : 'disabled'}>${state.cad.contasPlano.filter(p => p.tipo === 'S').map(p => `<option value="${p.id}" ${p.id === B.planos[k] ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>`;
  corpo.innerHTML = `<div class="card"><h2 style="margin-top:0">Parâmetros da folha</h2><div class="grid-form">
      ${campo('pct_adiantamento', 'Adiantamento (% do salário)', 'pago no mês da competência')}
      ${campo('dia_adiantamento', 'Dia do adiantamento', 'não útil → dia útil anterior')}
      ${campo('dia_util_saldo', 'Saldo: qual dia útil do mês seguinte', 'prazo legal: 5º dia útil')}
      ${campo('fator_liquido', 'Líquido do mês (% do bruto)', 'adiantamento + saldo ÷ salários')}
      ${campo('dia_guias', 'Dia das guias (INSS/FGTS/IRRF)', 'vencem dia 20; não útil → antecipa')}
      ${campo('inss_pct', 'Guia de INSS (% da folha)', 'inclua parcelamentos à parte, se houver')}
      ${campo('fgts_pct', 'FGTS (%)', 'aprendiz 2% e estágio 0% automáticos')}
      ${campo('irrf_mensal', 'Guia de IRRF estimada (R$/mês)', '0 = não prever')}
      ${campo('desc13_pct', '13º: descontos da 2ª parcela (% do bruto)', 'INSS/IRRF do empregado')}
      <label>Conta que paga a folha<select id="rp-conta" ${pode ? '' : 'disabled'}><option value="">—</option>${state.cad.contas.map(c => `<option value="${c.id}" ${c.id === B.conta ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      ${selPlano('salarios', 'Plano — salários')}${selPlano('inss', 'Plano — INSS')}${selPlano('fgts', 'Plano — FGTS')}${selPlano('irrf', 'Plano — IRRF')}${selPlano('decimo', 'Plano — 13º salário')}
    </div>${pode ? '<div style="margin-top:12px"><button class="btn primary" id="rp-ok">Salvar parâmetros</button> <button class="btn ghost" id="rp-pad">Voltar ao padrão</button></div>' : ''}</div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">O que foi pago (para calibrar)</h2><div class="muted small">base atual do cadastro: ${money(base)}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Mês do pagamento</th><th class="num">Adiantamento</th><th class="num">Saldo da folha</th><th class="num">Outros salários</th><th class="num">INSS</th><th class="num">FGTS</th></tr></thead><tbody>
      ${H.map(r => `<tr><td>${nomeComp(r.mes)}</td>${['adiantamento', 'saldo', 'outros', 'inss', 'fgts'].map(k => `<td class="num">${money(r[k])}${base && k !== 'outros' ? `<div class="small muted">${pctTxt(r[k] / base * 100)}</div>` : ''}</td>`).join('')}</tr>`).join('')
        || '<tr><td colspan="6" class="empty">Sem pagamentos no período.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Salários: plano ${PLANO_PADRAO.salarios}, separados pelo texto do ERP ("ADIANT FOLHA" × "PROVISAO FOLHA"); "outros" são diárias, extra folha, rescisões no mesmo plano.
      O saldo de um mês é a folha do mês anterior. INSS de agosto em diante inclui valores bem acima da folha (parcelamento?) — por isso o percentual da guia é seu, não automático.</p>`;
  $$('.rp-usar', corpo).forEach(a => a.onclick = (e) => { e.preventDefault(); const i = $('#rp-' + a.dataset.k, corpo); if (i && !i.disabled) i.value = String(a.dataset.v).replace('.', ','); });
  $('#rp-pad', corpo) && ($('#rp-pad', corpo).onclick = () => { for (const k of Object.keys(PARAM_PADRAO)) { const i = $('#rp-' + k, corpo); if (i) i.value = inp(PARAM_PADRAO[k]); } });
  $('#rp-ok', corpo) && ($('#rp-ok', corpo).onclick = async (e) => {
    const row = { empresa_id: state.empresa.id, conta_id: $('#rp-conta', corpo).value || null, atualizado_em: new Date().toISOString(),
      planos: Object.fromEntries(Object.keys(PLANO_PADRAO).map(k => [k, $('#rp-pl-' + k, corpo).value || null])) };
    for (const k of Object.keys(PARAM_PADRAO)) { const s = $('#rp-' + k, corpo).value.trim(); row[k] = s === '' ? null : num(s); }
    if (row.dia_adiantamento && (row.dia_adiantamento < 1 || row.dia_adiantamento > 31)) return toast('Dia do adiantamento entre 1 e 31', true);
    if (row.dia_util_saldo && (row.dia_util_saldo < 1 || row.dia_util_saldo > 20)) return toast('Dia útil do saldo entre 1 e 20', true);
    e.target.disabled = true;
    try { await q(sb.from('rh_parametros').upsert(row, { onConflict: 'empresa_id' })); toast('Parâmetros salvos — valem para as próximas folhas montadas (ou "Refazer pelo cadastro")'); render(root); }
    catch (err) { fail(err); e.target.disabled = false; }
  });
}

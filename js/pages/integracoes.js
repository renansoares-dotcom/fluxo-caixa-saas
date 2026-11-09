// Cadastros › Central de Integrações (CAD013, melhoria 1.6): extratos, VExpenses, NF-e, Iniflex, e-frete, remessa CNAB,
// e-mail, WhatsApp e rotinas automáticas numa tela, com a última importação, falhas, situação e o próximo passo (SQL 139).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal } from '../lib/ui.js';
import { SITUACOES, ordenar, resumo, haQuanto, textoEsperado } from '../lib/integracoes.js';

export const title = 'Central de Integrações';

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  let L;
  try { L = ordenar(await q(sb.rpc('integ_painel', { p_empresa: state.empresa.id }))); }
  catch (err) { root.innerHTML = `<div class="card"><div class="empty">${/integ_painel/.test(err.message || '') ? 'Esta tela precisa do SQL 139.' : esc(err.message || 'Não foi possível carregar.')}</div></div>`; return; }
  const R = resumo(L), admin = state.papel === 'admin';
  const dt = (t) => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' }) : '–';
  root.innerHTML = `<div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Precisam de atenção</div><div class="k-value ${R.atencao ? 'neg' : 'pos'}">${R.atencao}</div><div class="k-sub">${R.atrasadas} atrasada(s) · ${R.falhas} com falha</div></div>
      <div class="kpi"><div class="k-label">Em dia</div><div class="k-value">${R.ok} de ${R.total}</div><div class="k-sub">integrações usadas pela empresa</div></div></div>
    <div class="card toolbar"><span class="small muted">Atrasada = passou do prazo esperado (em dias úteis). Falha = erro nos últimos 7 dias. Os avisos saem nos dias úteis às 9h40 para os perfis escolhidos.</span>
      <span class="spacer"></span><button class="btn small" id="in-rec">Atualizar</button>${admin ? ' <button class="btn small" id="in-par">Parâmetros</button>' : ''}</div>
    <div class="in-grade" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;margin-top:12px">
    ${L.map(x => { const [rot, cls] = SITUACOES[x.situacao] || ['', '']; return `<div class="card" style="margin:0;${['atrasada', 'falha'].includes(x.situacao) ? 'border-color:var(--neg)' : ''}">
      <div style="display:flex;justify-content:space-between;gap:8px"><div><b>${esc(x.nome)}</b><div class="small muted">${esc(x.area)}</div></div><span class="${cls}" style="font-weight:600;white-space:nowrap">${rot}</span></div>
      <p class="small muted" style="margin:6px 0">${esc(x.descricao)}</p>
      <div class="small">Última: <b>${x.ultima ? haQuanto(x.ultima) : 'nunca'}</b>${x.ultima ? ` <span class="muted">(${dt(x.ultima)}${x.dias_uteis != null ? ` · ${x.dias_uteis} dia(s) útil(eis)` : ''})</span>` : ''}</div>
      <div class="small">Esperado: ${textoEsperado(x)} · 30 dias: ${x.qtd_30d ?? 0}${x.falhas_7d ? ` · <span class="neg">${x.falhas_7d} falha(s) em 7 dias</span>` : ''}</div>
      ${x.detalhe ? `<div class="small" style="margin-top:4px">${esc(x.detalhe)}</div>` : ''}
      ${x.ultimo_erro ? `<div class="small neg" style="margin-top:4px" title="${esc(x.ultimo_erro)}">Último erro: ${esc(String(x.ultimo_erro).slice(0, 140))}</div>` : ''}
      <div class="small" style="margin-top:8px;padding:8px;background:var(--bg-soft, #f5f7fb);border-radius:8px">${esc(x.proximo_passo)}</div>
      <div style="margin-top:8px;text-align:right">${x.codigo !== 'rotinas' ? `<a class="btn small" href="${esc(x.link)}">Abrir</a>` : ''}</div></div>`; }).join('')}</div>`;
  $('#in-rec', root).onclick = () => render(root);
  $('#in-par', root) && ($('#in-par', root).onclick = () => parametros(L, root));
}

async function parametros(L, root) {
  const G = (await q(sb.from('integ_geral').select('*').eq('empresa_id', state.empresa.id)).catch(() => []))[0] || { avisar: true, papeis: ['admin', 'financeiro'] };
  const papeis = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro']];
  const m = modal({ title: 'Parâmetros da Central de Integrações', wide: true, body: `<div class="form">
    <label class="chk"><input type="checkbox" id="ip-av" ${G.avisar ? 'checked' : ''}> Avisar nos dias úteis (9h40) o que está atrasado ou com falha</label>
    <div style="margin:6px 0 12px"><b class="small">Quem recebe</b><div style="display:flex;gap:14px;margin-top:4px">${papeis.map(([k, t]) => `<label class="chk"><input type="checkbox" class="ip-pp" value="${k}" ${(G.papeis || []).includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Integração</th><th>Usada pela empresa</th><th>Esperado a cada (dias úteis)</th></tr></thead><tbody>
    ${L.map(x => `<tr data-c="${x.codigo}"><td>${esc(x.nome)}</td><td><input type="checkbox" class="ip-on" ${x.ativo ? 'checked' : ''}></td>
      <td><input type="number" class="ip-d" min="0" max="90" style="width:90px" value="${x.max_dias ?? 0}"> <span class="small muted">padrão ${x.max_padrao}; 0 = sem aviso de atraso</span></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Nos extratos, o prazo vale para cada conta; as contas que não exigem extrato (ex.: caixa) são marcadas nos parâmetros da Conciliação Bancária.</p></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ip-ok">Salvar</button>' });
  $('#ip-ok', m.el).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      await q(sb.from('integ_geral').upsert({ empresa_id: state.empresa.id, avisar: $('#ip-av', m.el).checked, papeis: $$('.ip-pp:checked', m.el).map(x => x.value) }));
      await q(sb.from('integ_config').upsert($$('tr[data-c]', m.el).map(tr => ({ empresa_id: state.empresa.id, codigo: tr.dataset.c, ativo: $('.ip-on', tr).checked, max_dias: Math.min(90, Math.max(0, +$('.ip-d', tr).value || 0)) }))));
      m.close(); toast('Parâmetros salvos'); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

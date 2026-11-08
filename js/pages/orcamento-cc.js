// Painéis › Orçamento do meu centro (PAI008, melhoria 3.10): o responsável por um centro de custo vê o orçamento do
// centro (lançado direto no centro + a parte do rateio das contas) e APROVA ou DEVOLVE com comentário. Vale para
// qualquer perfil: a pessoa só vê os centros de que é responsável (funções do banco orcamento_cc_*).
import { sb, state, q } from '../lib/data.js';
import { $, esc, money, money0, fail, toast, modal, exportXLSX, MESES_CURTO } from '../lib/ui.js';

export const title = 'Orçamento do meu centro';
const SIT = { enviado: ['Aguardando a sua aprovação', 'aberto'], aprovado: ['Aprovado', 'pago'], devolvido: ['Devolvido', 'vencido'] };
const ui = { cc: null };

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  let L;
  try { L = await q(sb.rpc('orcamento_cc_meus', { p_empresa: state.empresa.id, p_ano: state.ano })); }
  catch (e) { root.innerHTML = `<div class="card"><div class="empty">${/orcamento_cc_meus/.test(e.message || '') ? 'Esta tela precisa do SQL 108.' : 'Não foi possível carregar.'}</div></div>`; return; }
  if (!L.length) { root.innerHTML = `<div class="card"><div class="empty">Você não é responsável por nenhum centro de custo.<br><span class="small">O financeiro escolhe o responsável de cada centro em Budget / Forecast › Centros de custo e aprovação.</span></div></div>`; return; }
  if (!L.some(x => x.centro_custo_id === ui.cc)) ui.cc = (L.find(x => x.situacao === 'enviado') || L[0]).centro_custo_id;
  root.innerHTML = `<div class="card"><div class="toolbar"><div class="nc-cens" id="occ-l">${L.map(x => `<button class="ch-chip${x.centro_custo_id === ui.cc ? ' on' : ''}" data-cc="${x.centro_custo_id}">${esc(x.nome)}${x.situacao === 'enviado' ? ' ●' : ''}</button>`).join('')}</div>
      <span class="spacer"></span><button class="btn" id="occ-exp">Exportar Excel</button></div>
      <p class="small muted" style="margin:8px 0 0">Orçamento ${state.ano} dos centros de custo de que você é responsável: o que foi orçado direto no centro mais a parte do rateio das contas da empresa.</p></div>
    <div id="occ-c"><div class="loading">Carregando…</div></div>`;
  $('#occ-l', root).onclick = (e) => { const b = e.target.closest('[data-cc]'); if (b) { ui.cc = b.dataset.cc; render(root); } };
  await centro(root, L.find(x => x.centro_custo_id === ui.cc));
}

async function centro(root, cc) {
  const box = $('#occ-c', root), cen = cc.cenario || 'budget';
  let V;
  try { V = await q(sb.rpc('orcamento_cc_valores', { p_empresa: state.empresa.id, p_ano: state.ano, p_cenario: cen, p_cc: cc.centro_custo_id })); } catch (e) { fail(e); return; }
  const contas = {};
  for (const v of V) { (contas[v.plano_id] ||= { codigo: v.codigo, nome: v.nome, tipo: v.tipo, m: Array(12).fill(0) }).m[v.mes - 1] += +v.valor; }
  const linhas = Object.values(contas).sort((a, b) => a.codigo.localeCompare(b.codigo));
  const total = linhas.reduce((s, l) => s + l.m.reduce((a, b) => a + b, 0), 0);
  const sit = SIT[cc.situacao];
  const alterado = cc.situacao && Math.abs(+cc.atual - +cc.total) > 0.5;
  box.innerHTML = `<div class="kpis">
      <div class="kpi"><div class="k-label">Situação</div><div class="k-value" style="font-size:18px">${sit ? `<span class="badge ${sit[1]}">${sit[0]}</span>` : '<span class="badge">Ainda não enviado</span>'}</div><div class="k-sub">${cc.enviado_em ? `enviado em ${new Date(cc.enviado_em).toLocaleDateString('pt-BR')}` : '&nbsp;'}</div></div>
      <div class="kpi"><div class="k-label">Total do ano (${esc(cen)})</div><div class="k-value">${money0(total)}</div><div class="k-sub">${alterado ? `<span class="warn">mudou depois do envio (era ${money0(cc.total)})</span>` : `${linhas.length} conta(s)`}</div></div>
      ${cc.comentario ? `<div class="kpi" style="grid-column:span 2"><div class="k-label">Comentário</div><div class="small">${esc(cc.comentario)}</div></div>` : ''}</div>
    ${cc.situacao === 'enviado' ? `<div class="card fc-banner"><div><strong>O financeiro enviou o orçamento deste centro para você aprovar.</strong><div class="small muted">Confira as contas e os meses. Se algo precisa mudar, devolva dizendo o quê.</div></div>
      <div class="toolbar" style="margin:0"><button class="btn danger" id="occ-dev">Devolver…</button><button class="btn primary" id="occ-ok">Aprovar</button></div></div>` : ''}
    <div class="card flush"><div class="table-wrap"><table id="occ-t"><thead><tr><th class="sticky">Conta</th>${MESES_CURTO.map(m => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
      ${linhas.map(l => `<tr><td class="sticky">${esc(l.codigo)} ${esc(l.nome)}${l.tipo === 'E' ? ' <span class="badge">entrada</span>' : ''}</td>${l.m.map(x => `<td class="num">${x ? money(x) : ''}</td>`).join('')}<td class="num"><strong>${money(l.m.reduce((a, b) => a + b, 0))}</strong></td></tr>`).join('') || '<tr><td colspan="14" class="empty">Nenhum valor orçado para este centro.</td></tr>'}
      </tbody></table></div></div>`;
  const decidir = async (aprovar, comentario) => {
    try { await q(sb.rpc('orcamento_cc_decidir', { p_empresa: state.empresa.id, p_ano: state.ano, p_cenario: cen, p_cc: cc.centro_custo_id, p_aprovar: aprovar, p_comentario: comentario || null }));
      toast(aprovar ? 'Orçamento aprovado' : 'Orçamento devolvido ao financeiro'); render(root); } catch (e) { fail(e); }
  };
  $('#occ-ok', box) && ($('#occ-ok', box).onclick = () => {
    const m = modal({ title: `Aprovar o orçamento de ${cc.nome}`, narrow: true, body: '<label>Comentário (opcional)<textarea id="oa-c" rows="3" maxlength="500"></textarea></label>',
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="oa-ok">Aprovar</button>' });
    $('#oa-ok', m.el).onclick = () => { m.close(); decidir(true, $('#oa-c', m.el).value.trim()); };
  });
  $('#occ-dev', box) && ($('#occ-dev', box).onclick = () => {
    const m = modal({ title: `Devolver o orçamento de ${cc.nome}`, narrow: true, body: '<label>O que precisa mudar? *<textarea id="od-c" rows="4" maxlength="500" placeholder="ex.: faltou a manutenção da extrusora 2 em março"></textarea></label>',
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn danger" id="od-ok">Devolver</button>' });
    $('#od-ok', m.el).onclick = () => { const v = $('#od-c', m.el).value.trim(); if (v.length < 10) return toast('Diga o que precisa mudar (pelo menos 10 letras)', true); m.close(); decidir(false, v); };
  });
  $('#occ-exp', root).onclick = () => exportXLSX([['Conta', ...MESES_CURTO, 'Total'], ...linhas.map(l => [`${l.codigo} ${l.nome}`, ...l.m, l.m.reduce((a, b) => a + b, 0)])], `orcamento_${cc.nome}_${state.ano}`);
}

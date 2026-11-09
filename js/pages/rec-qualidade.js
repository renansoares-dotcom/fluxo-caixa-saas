// Recuperadora › Qualidade do Grão (REC006): ensaios dos lotes de grão contra a especificação do material (índice de fluidez,
// umidade, densidade, contaminação), liberação ou bloqueio automático, concessão justificada, especificações e o limite de reciclado por produto.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, dateBR, toast, fail, modal, parseNum, confirmDialog } from '../lib/ui.js';
import { carregarRec, podeOperar, podeConfig, kpi, kg, kg0, rkg, badgeLote, semSQL, avisoSQL, desligada, avisoDesligada, nomeMat, optMats } from '../lib/rec-ui.js';
import { avaliarEnsaio } from '../lib/recuperadora.js';

export const title = 'Qualidade do Grão';
const ui = { aba: 'lotes' };
const n3 = (v) => v == null || v === '' ? '' : String(+v).replace('.', ',');

export async function render(root) {
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="rq-abas">${[['lotes', 'Lotes de grão e ensaios'], ['espec', 'Especificações'], ['limites', 'Limite de reciclado por produto']]
      .map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div><span class="spacer"></span><span id="rq-acoes"></span></div><div id="rq-c" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#rq-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  const c = $('#rq-c', root);
  try {
    const R = await carregarRec();
    if (desligada(R)) { c.innerHTML = avisoDesligada(); return; }
    const esp = await q(sb.from('rec_especificacoes').select('*').eq('empresa_id', state.empresa.id));
    if (ui.aba === 'lotes') await lotes(c, R, esp, root); else if (ui.aba === 'espec') espec(c, R, esp, root); else await limites(c, R, root);
  } catch (err) { c.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

async function lotes(c, R, esp, root) {
  const e = state.empresa.id, espBy = Object.fromEntries(esp.map(s => [s.material_id, s]));
  const [L, EN] = await Promise.all([q(sb.from('rec_lotes').select('*').eq('empresa_id', e).eq('tipo', 'grao').order('data', { ascending: false }).limit(500)),
    q(sb.from('rec_ensaios').select('*').eq('empresa_id', e).order('criado_em', { ascending: false }).limit(2000))]);
  const ult = new Map(); for (const x of EN) if (!ult.has(x.lote_id)) ult.set(x.lote_id, x);
  const aguard = L.filter(l => l.situacao === 'bloqueado' && !ult.has(l.id)), repr = L.filter(l => l.situacao === 'bloqueado' && ult.get(l.id)?.resultado === 'reprovado');
  const aprov = EN.filter(x => x.resultado === 'aprovado').length, tot = EN.length;
  c.innerHTML = `<div class="kpis">${kpi('Aguardando ensaio', aguard.length, kg0(aguard.reduce((s, l) => s + +l.saldo_kg, 0)), aguard.length ? 'warn' : '')}
      ${kpi('Reprovados', repr.length, kg0(repr.reduce((s, l) => s + +l.saldo_kg, 0)) + ' bloqueados', repr.length ? 'neg' : '')}
      ${kpi('Aprovação nos ensaios', tot ? Math.round(aprov / tot * 100) + '%' : '–', `${tot} ensaio(s)`)}${kpi('Grão liberado', kg0(L.filter(l => l.situacao === 'disponivel').reduce((s, l) => s + +l.saldo_kg, 0)), 'disponível para a linha ou venda')}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:62vh"><table><thead><tr><th>Lote</th><th>Grão</th><th class="num">Peso</th><th class="num">Saldo</th><th class="num">R$/kg</th><th>Último ensaio</th><th>Situação</th><th></th></tr></thead><tbody>
    ${L.map(l => { const x = ult.get(l.id); return `<tr><td><b>${esc(l.codigo)}</b><div class="small muted">${dateBR(l.data)}</div></td><td>${esc(nomeMat(R, l.material_id))}${espBy[l.material_id] ? '' : '<div class="small warn">sem especificação</div>'}</td>
      <td class="num">${kg(l.peso_kg)}</td><td class="num">${kg(l.saldo_kg)}</td><td class="num">${+l.peso_kg ? rkg(l.custo_total / l.peso_kg) : '–'}</td>
      <td class="small">${x ? `<span class="badge ${x.resultado === 'aprovado' ? 'pago' : 'vencido'}">${x.resultado}</span> ${dateBR(x.data)}<div class="muted">${[x.mfi != null ? 'IF ' + n3(x.mfi) : '', x.umidade != null ? 'umid. ' + n3(x.umidade) + '%' : '', x.densidade != null ? 'dens. ' + n3(x.densidade) : '', x.contaminacao != null ? 'contam. ' + n3(x.contaminacao) + '%' : ''].filter(Boolean).join(' · ')}${x.motivos?.length ? '<br>' + esc(x.motivos.join('; ')) : ''}</div>` : '<span class="warn">sem ensaio</span>'}</td>
      <td>${badgeLote(l.situacao)}</td><td>${podeOperar() && ['disponivel', 'bloqueado'].includes(l.situacao) ? `<button class="btn sm" data-en="${l.id}">Ensaio</button>` : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="8" class="empty">Nenhum lote de grão. Eles nascem ao concluir a ordem em Processamento.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Com "exigir ensaio" nos parâmetros, o lote de grão nasce bloqueado: o ensaio aprovado libera e o reprovado mantém bloqueado. A concessão (liberar fora da especificação) exige admin, financeiro ou diretor e a justificativa.</p>`;
  $$('[data-en]', c).forEach(b => b.onclick = () => ensaio(R, L.find(l => l.id === b.dataset.en), espBy, root));
}

function ensaio(R, l, espBy, root) {
  const s = espBy[l.material_id];
  const md = modal({ title: `Ensaio do lote ${l.codigo}`, body: `<p class="small">${esc(nomeMat(R, l.material_id))} · ${kg(l.saldo_kg)}. ${s ? `Especificação: ${[s.mfi_min != null || s.mfi_max != null ? `índice de fluidez ${n3(s.mfi_min ?? '–')} a ${n3(s.mfi_max ?? '–')}` : '', s.umidade_max != null ? `umidade até ${n3(s.umidade_max)}%` : '',
      s.densidade_min != null || s.densidade_max != null ? `densidade ${n3(s.densidade_min ?? '–')} a ${n3(s.densidade_max ?? '–')}` : '', s.contaminacao_max != null ? `contaminação até ${n3(s.contaminacao_max)}%` : ''].filter(Boolean).join(' · ')}` : '<span class="warn">Sem especificação: o ensaio é aprovado se você não reprovar.</span>'}</p>
    <form id="ef" class="grid2"><label>Índice de fluidez (g/10 min)<input name="mfi" inputmode="decimal"></label><label>Umidade (%)<input name="um" inputmode="decimal"></label>
      <label>Densidade (g/cm³)<input name="de" inputmode="decimal"></label><label>Contaminação (%)<input name="co" inputmode="decimal"></label>
      <label>Cor<input name="cor" placeholder="natural, cinza, preto…"></label><label>Observação / justificativa<input name="ob"></label></form><div id="ef-r" style="margin-top:8px"></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn danger" id="ef-rep">Reprovar</button>${podeConfig() ? '<button class="btn" id="ef-con" hidden>Liberar por concessão</button>' : ''}<button class="btn primary" id="ef-ok">Registrar</button>` });
  const f = $('#ef', md.el), val = (n) => f[n].value.trim() === '' ? null : parseNum(f[n].value);
  const prev = () => { const m = avaliarEnsaio({ mfi: val('mfi'), umidade: val('um'), densidade: val('de'), contaminacao: val('co') }, s);
    $('#ef-r', md.el).innerHTML = m.length ? `<p class="small neg">Fora da especificação: ${esc(m.join('; '))}. Registrar mantém o lote bloqueado.</p>` : '<p class="small pos">Dentro da especificação: registrar libera o lote.</p>';
    $('#ef-con', md.el) && ($('#ef-con', md.el).hidden = !m.length); };
  f.oninput = prev; prev();
  const enviar = (forcar) => async (ev) => { ev.target.disabled = true;
    try { const r = await q(sb.rpc('rec_ensaio_registrar', { p_lote: l.id, p_mfi: val('mfi'), p_umidade: val('um'), p_densidade: val('de'), p_contaminacao: val('co'), p_cor: f.cor.value, p_obs: f.ob.value || null, p_forcar: forcar }));
      md.close(); toast(r.resultado === 'aprovado' ? 'Lote aprovado e liberado' : 'Lote reprovado: continua bloqueado'); render(root); } catch (err) { ev.target.disabled = false; fail(err); } };
  $('#ef-ok', md.el).onclick = enviar(null); $('#ef-rep', md.el).onclick = enviar('reprovado'); $('#ef-con', md.el) && ($('#ef-con', md.el).onclick = enviar('aprovado'));
}

function espec(c, R, esp, root) {
  const pode = podeConfig();
  $('#rq-acoes', root).innerHTML = pode ? '<button class="btn primary" id="rq-ne">+ Especificação</button>' : '';
  c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Grão</th><th class="num">Índice de fluidez</th><th class="num">Umidade máx.</th><th class="num">Densidade</th><th class="num">Contaminação máx.</th><th>Observação</th></tr></thead><tbody>
    ${esp.map(s => `<tr class="${pode ? 'clickable' : ''}" data-id="${s.id}"><td>${esc(nomeMat(R, s.material_id))}</td><td class="num">${n3(s.mfi_min ?? '–')} a ${n3(s.mfi_max ?? '–')}</td><td class="num">${s.umidade_max != null ? n3(s.umidade_max) + '%' : '–'}</td>
      <td class="num">${n3(s.densidade_min ?? '–')} a ${n3(s.densidade_max ?? '–')}</td><td class="num">${s.contaminacao_max != null ? n3(s.contaminacao_max) + '%' : '–'}</td><td class="small">${esc(s.observacao || '')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nenhuma especificação. Cadastre a do grão que a empresa produz.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Campo vazio = não verificado. Valores de referência dependem da resina e do cliente: use a ficha técnica do produto ou a especificação combinada.</p>`;
  const abrir = (s = {}) => {
    const md = modal({ title: s.id ? 'Editar especificação' : 'Nova especificação', body: `<form id="sf" class="grid2"><label class="span2">Grão *<select name="m" ${s.id ? 'disabled' : ''}>${optMats(R, s.material_id, (m) => !esp.some(x => x.material_id === m.id && x.id !== s.id))}</select></label>
        <label>Índice de fluidez mínimo<input name="a" inputmode="decimal" value="${n3(s.mfi_min)}"></label><label>Índice de fluidez máximo<input name="b" inputmode="decimal" value="${n3(s.mfi_max)}"></label>
        <label>Umidade máxima (%)<input name="u" inputmode="decimal" value="${n3(s.umidade_max)}"></label><label>Contaminação máxima (%)<input name="co" inputmode="decimal" value="${n3(s.contaminacao_max)}"></label>
        <label>Densidade mínima<input name="d1" inputmode="decimal" value="${n3(s.densidade_min)}"></label><label>Densidade máxima<input name="d2" inputmode="decimal" value="${n3(s.densidade_max)}"></label>
        <label class="span2">Observação<input name="o" value="${esc(s.observacao || '')}"></label></form>`,
      foot: `${s.id ? '<button class="btn danger" id="sf-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="sf-ok">Salvar</button>` });
    const f = $('#sf', md.el), v = (n) => f[n].value.trim() === '' ? null : parseNum(f[n].value);
    $('#sf-ok', md.el).onclick = async () => { const d = { empresa_id: state.empresa.id, material_id: s.material_id || f.m.value, mfi_min: v('a'), mfi_max: v('b'), umidade_max: v('u'), contaminacao_max: v('co'), densidade_min: v('d1'), densidade_max: v('d2'), observacao: f.o.value.trim() || null };
      try { await q(s.id ? sb.from('rec_especificacoes').update(d).eq('id', s.id) : sb.from('rec_especificacoes').insert(d)); md.close(); toast('Especificação salva'); render(root); } catch (err) { fail(err); } };
    $('#sf-del', md.el) && ($('#sf-del', md.el).onclick = async () => { if (!await confirmDialog('Excluir a especificação?')) return; try { await q(sb.from('rec_especificacoes').delete().eq('id', s.id)); md.close(); render(root); } catch (err) { fail(err); } });
  };
  $('#rq-ne', root) && ($('#rq-ne', root).onclick = () => abrir());
  c.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr[data-id]')?.dataset.id; if (id && pode) abrir(esp.find(x => x.id === id)); };
}

async function limites(c, R, root) {
  const pode = podeConfig(), e = state.empresa.id;
  const [LIM, PR] = await Promise.all([q(sb.from('rec_limites').select('*').eq('empresa_id', e)), q(sb.from('produtos').select('id, codigo, descricao').eq('empresa_id', e).order('descricao').limit(3000)).catch(() => [])]);
  const prBy = Object.fromEntries(PR.map(p => [p.id, p]));
  $('#rq-acoes', root).innerHTML = pode ? '<button class="btn primary" id="rq-nl">+ Limite</button>' : '';
  c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Produto</th><th class="num">Reciclado máximo (% do peso da OP)</th><th></th></tr></thead><tbody>
    ${LIM.map(x => `<tr><td>${esc(prBy[x.produto_id] ? `${prBy[x.produto_id].codigo || ''} ${prBy[x.produto_id].descricao || ''}` : '?')}</td><td class="num">${n3(x.max_pct)}%</td><td>${pode ? `<button class="btn ghost sm" data-del="${x.id}">Excluir</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="3" class="empty">Sem limites. Cadastre os produtos que aceitam só parte de reciclado (ex.: filme de contato com alimento: 0%).</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Quando a saída de grão para uma OP (Lotes › Dar saída) passa do limite do produto, a plataforma avisa na hora e manda um aviso ao administrador e ao diretor.</p>`;
  $('#rq-nl', root) && ($('#rq-nl', root).onclick = () => {
    const md = modal({ title: 'Limite de reciclado', body: `<form id="lf" class="grid2"><label class="span2">Produto<select name="p">${PR.filter(p => !LIM.some(x => x.produto_id === p.id)).map(p => `<option value="${p.id}">${esc(p.codigo || '')} ${esc(p.descricao || '')}</option>`).join('')}</select></label>
      <label>Reciclado máximo (%)<input name="m" inputmode="decimal"></label></form>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lf-ok">Salvar</button>' });
    $('#lf-ok', md.el).onclick = async () => { const f = $('#lf', md.el), m = parseNum(f.m.value); if (!(m >= 0 && m <= 100)) return toast('Informe de 0 a 100', true);
      try { await q(sb.from('rec_limites').insert({ empresa_id: e, produto_id: f.p.value, max_pct: m })); md.close(); render(root); } catch (err) { fail(err); } };
  });
  $$('[data-del]', c).forEach(b => b.onclick = async () => { try { await q(sb.from('rec_limites').delete().eq('id', b.dataset.del)); render(root); } catch (err) { fail(err); } });
}

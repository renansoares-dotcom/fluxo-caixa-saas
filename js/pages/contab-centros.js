// Contabilidade › Resultado por Centro de Custo (CTB012, melhoria 9.5): resultado por nível (área › departamento › centro),
// rateio das despesas indiretas em cascata (percentual, pessoas, folha ou base informada), aplicar e fechar o mês, e as regras.
import { sb, state, q, isAdmin } from '../lib/data.js';
import { $, $$, esc, money, dateBR, fail, toast, modal, loading, exportXLSX, MESES_CURTO } from '../lib/ui.js';
import { arvore, caminho, totaisArvore } from '../lib/centros.js';

export const title = 'Resultado por Centro de Custo';
const h = new Date(), ant = new Date(h.getFullYear(), h.getMonth() - 1, 1);
const ui = { aba: 'resultado', mes: `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`, periodo: 'mes', nivel: 9, fechados: new Set() };
const CRIT = { percentual: 'Percentual fixo', pessoas: 'Pessoas no centro (RH)', folha: 'Salários do centro (RH)', base: 'Base informada (m², kg, horas…)' };
const mesBR = (m) => `${MESES_CURTO[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}`;
const fimMes = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);

export async function render(root) {
  root.innerHTML = `<div class="toolbar"><label>Mês<select id="cr-mes">${[h.getFullYear() - 1, h.getFullYear()].flatMap(a => MESES_CURTO.map((_, i) => `${a}-${String(i + 1).padStart(2, '0')}`))
      .filter(m => m <= h.toISOString().slice(0, 7)).reverse().map(m => `<option value="${m}" ${m === ui.mes ? 'selected' : ''}>${mesBR(m)}</option>`).join('')}</select></label>
    <label>Período<select id="cr-per"><option value="mes" ${ui.periodo === 'mes' ? 'selected' : ''}>Só o mês</option><option value="ano" ${ui.periodo === 'ano' ? 'selected' : ''}>Ano até o mês</option></select></label>
    <div class="chips" id="cr-abas">${[['resultado', 'Resultado'], ['rateio', 'Rateio do mês'], ['regras', 'Regras de rateio']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
    <span class="spacer"></span><span id="cr-acoes"></span></div><div id="cr-corpo" style="margin-top:12px"></div>`;
  $('#cr-mes', root).onchange = (e) => { ui.mes = e.target.value; pintar(root); };
  $('#cr-per', root).onchange = (e) => { ui.periodo = e.target.value; pintar(root); };
  $('#cr-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  pintar(root);
}

function pintar(root) {
  const c = $('#cr-corpo', root); $('#cr-acoes', root).innerHTML = '';
  $('#cr-per', root).closest('label').style.display = ui.aba === 'resultado' ? '' : 'none';
  if (ui.aba === 'resultado') return resultado(c, root);
  if (ui.aba === 'rateio') return rateio(c, root);
  return regras(c, root);
}

const erroSQL = (c, err) => { c.innerHTML = `<div class="card"><div class="empty">${/cc_r|cc_res/.test(err.message || '') ? 'Esta tela precisa do SQL 143.' : /acesso/i.test(err.message || '') ? 'O resultado por centro é do administrador, diretor e financeiro.' : esc(err.message)}</div></div>`; };

async function resultado(c, root) {
  loading(c);
  const ini = ui.periodo === 'ano' ? ui.mes.slice(0, 4) + '-01-01' : ui.mes + '-01', fim = fimMes(ui.mes);
  let R; try { R = await q(sb.rpc('cc_resultado', { p_empresa: state.empresa.id, p_ini: ini, p_fim: fim })); } catch (err) { return erroSQL(c, err); }
  const L = state.cad.cc || [], T = totaisArvore(R.linhas || [], L), maxProf = Math.max(0, ...T.nos.map(n => n.prof));
  const visiveis = T.nos.filter(n => n.prof < ui.nivel && !anc(n, T.nos).some(a => ui.fechados.has(a)));
  const aplic = R.meses_aplicados || [];
  $('#cr-acoes', root).innerHTML = `<label>Mostrar até<select id="cr-niv">${Array.from({ length: maxProf + 1 }, (_, i) => `<option value="${i + 1}" ${ui.nivel === i + 1 ? 'selected' : ''}>nível ${i + 1}</option>`).join('')}<option value="9" ${ui.nivel === 9 ? 'selected' : ''}>todos</option></select></label> <button class="btn" id="cr-xls">Excel</button>`;
  const v = (x, cls = '') => `<td class="num ${cls}">${x ? money(x) : '–'}</td>`;
  c.innerHTML = `<div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Receitas com centro</div><div class="k-value">${money(T.geral.receitas)}</div><div class="k-sub">${T.semCentro.receitas ? `${money(T.semCentro.receitas)} sem centro` : '&nbsp;'}</div></div>
      <div class="kpi"><div class="k-label">Despesas com centro</div><div class="k-value">${money(T.geral.despesas)}</div><div class="k-sub">${T.semCentro.despesas ? `<span class="warn">${money(T.semCentro.despesas)} sem centro</span>` : 'todas com centro'}</div></div>
      <div class="kpi"><div class="k-label">Rateado no período</div><div class="k-value">${money(T.geral.rateio_enviado)}</div><div class="k-sub">${aplic.length ? aplic.map(m => `${mesBR(m.mes)}${m.situacao === 'fechado' ? ' 🔒' : ''}`).join(' · ') : 'rateio não aplicado'}</div></div>
      <div class="kpi"><div class="k-label">Resultado</div><div class="k-value ${T.geral.resultado < 0 ? 'neg' : ''}">${money(T.geral.resultado)}</div><div class="k-sub">${R.base === 'todos' ? 'pagos e em aberto' : 'só pagos e recebidos'}</div></div></div>
    <div class="card flush"><div class="table-wrap" id="cr-tab"><table><thead><tr><th>Centro de custo</th><th class="num">Receitas</th><th class="num">Despesas diretas</th><th class="num">Rateio recebido</th><th class="num">Rateio enviado</th><th class="num">Resultado</th><th class="num">Resultado só do centro</th></tr></thead><tbody>
    ${visiveis.map(n => `<tr class="${n.filhos ? 'dre-l' : ''}" data-n="${n.id}"><td style="padding-left:${12 + n.prof * 22}px">${n.filhos ? `<span class="bal-tg">${ui.fechados.has(n.id) ? '▸' : '▾'}</span><b>${esc(n.nome)}</b>` : esc(n.nome)}</td>
      ${v(n.total.receitas)}${v(n.total.despesas)}${v(n.total.rateio_recebido)}${v(n.total.rateio_enviado)}<td class="num ${n.total.resultado < 0 ? 'neg' : ''}"><b>${money(n.total.resultado)}</b></td><td class="num small muted">${n.filhos ? money(n.proprio.resultado) : ''}</td></tr>`).join('')}
    ${T.semCentro.receitas || T.semCentro.despesas ? `<tr><td class="muted">Sem centro de custo</td>${v(T.semCentro.receitas)}${v(T.semCentro.despesas)}<td></td><td></td><td class="num">${money(T.semCentro.resultado)}</td><td></td></tr>` : ''}
    <tr class="row-sec"><td>Total</td>${v(T.geral.receitas + T.semCentro.receitas)}${v(T.geral.despesas + T.semCentro.despesas)}${v(T.geral.rateio_recebido)}${v(T.geral.rateio_enviado)}<td class="num">${money(T.geral.resultado + T.semCentro.resultado)}</td><td></td></tr>
    </tbody></table></div></div>
    <p class="small muted">Resultado = receitas − despesas diretas − rateio recebido + rateio enviado. Cada linha soma o centro e os de baixo. ${ui.periodo === 'ano' ? 'Ano até o mês' : mesBR(ui.mes)}; o rateio entra só nos meses aplicados.</p>`;
  $('#cr-niv', root).onchange = (e) => { ui.nivel = +e.target.value; resultado(c, root); };
  $('#cr-xls', root).onclick = () => exportXLSX($('#cr-tab table', c), `resultado_centros_${ui.mes}`);
  c.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr.dre-l')?.dataset.n; if (!id) return; ui.fechados.has(id) ? ui.fechados.delete(id) : ui.fechados.add(id); resultado(c, root); };
}
const anc = (n, nos) => { const m = new Map(nos.map(x => [x.id, x])), out = []; let p = m.get(n.pai_id), k = 0; while (p && k++ < 10) { out.push(p.id); p = m.get(p.pai_id); } return out; };

async function rateio(c, root) {
  loading(c);
  const e = state.empresa.id, mes = ui.mes + '-01';
  let C, M;
  try { [C, M] = await Promise.all([q(sb.rpc('cc_rateio_calcular', { p_empresa: e, p_mes: mes })), q(sb.from('cc_rateio_meses').select('*').eq('empresa_id', e).eq('mes', mes)).then(r => r[0] || null)]); }
  catch (err) { return erroSQL(c, err); }
  const mapa = new Map((state.cad.cc || []).map(x => [x.id, x])), nome = (id) => esc(caminho(id, mapa) || '—'), grava = ['admin', 'financeiro'].includes(state.papel), fechado = M?.situacao === 'fechado';
  $('#cr-acoes', root).innerHTML = fechado ? (isAdmin() ? '<button class="btn" id="ra-reab">Reabrir</button>' : '') : grava ? `<button class="btn primary" id="ra-apl">${M ? 'Aplicar de novo' : 'Aplicar o rateio'}</button>${M ? ' <button class="btn" id="ra-fech">Fechar o mês</button>' : ''}` : '';
  c.innerHTML = `<div class="card" style="margin-bottom:12px"><p class="small" style="margin:0">${M ? `Rateio de ${mesBR(ui.mes)} <b>${fechado ? 'fechado' : 'aplicado'}</b> em ${dateBR(M.aplicado_em)}. ${fechado ? '' : 'Aplicar de novo recalcula com os lançamentos de agora.'}` : `O rateio de ${mesBR(ui.mes)} ainda não foi aplicado: a prévia abaixo usa os lançamentos de agora.`}
      As regras rodam em cascata, na ordem: o que um centro recebe entra no total que ele rateia depois.</p></div>
    ${C.map((r, i) => `<div class="card flush" style="margin-bottom:12px"><div class="card-head" style="padding:12px 12px 0"><div><h2>${i + 1}. ${esc(r.nome)}</h2>
        <p class="small muted">De <b>${nome(r.origem_cc_id)}</b> · ${CRIT[r.criterio]}${r.base_nome ? ` (${esc(r.base_nome)})` : ''} · direto ${money(r.direto)}${r.recebido ? ` + recebido ${money(r.recebido)}` : ''} = <b>${money(r.total)}</b></p>
        ${r.aviso ? `<p class="small warn" style="margin:4px 0 0">${esc(r.aviso)}</p>` : ''}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Destino</th><th class="num">${r.criterio === 'percentual' ? '%' : r.criterio === 'pessoas' ? 'Pessoas' : r.criterio === 'folha' ? 'Salários' : esc(r.base_nome || 'Base')}</th><th class="num">Participação</th><th class="num">Valor</th></tr></thead><tbody>
      ${r.destinos.map(d => `<tr><td>${nome(d.cc_id)}</td><td class="num">${r.criterio === 'folha' ? money(d.peso) : (+d.peso).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
        <td class="num">${r.soma_pesos ? ((d.peso / r.soma_pesos) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%' : '–'}</td><td class="num"><b>${money(d.valor)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sem destinos.</td></tr>'}</tbody></table></div></div>`).join('')
    || `<div class="card"><div class="empty">Nenhuma regra de rateio ativa. ${isAdmin() ? 'Cadastre na aba Regras de rateio.' : ''}</div></div>`}`;
  $('#ra-apl', root) && ($('#ra-apl', root).onclick = async (ev) => {
    const av = C.filter(r => r.aviso); if (av.length && !confirm(`${av.length} regra(s) com aviso ficam de fora:\n- ${av.map(r => r.nome + ': ' + r.aviso).join('\n- ')}\n\nAplicar assim mesmo?`)) return;
    ev.target.disabled = true; try { const n = await q(sb.rpc('cc_rateio_aplicar', { p_empresa: e, p_mes: mes })); toast(`Rateio aplicado: ${n} linha(s)`); rateio(c, root); } catch (err) { fail(err); ev.target.disabled = false; }
  });
  $('#ra-fech', root) && ($('#ra-fech', root).onclick = async () => { if (!confirm(`Fechar o rateio de ${mesBR(ui.mes)}?`)) return; try { await q(sb.rpc('cc_rateio_situacao', { p_empresa: e, p_mes: mes, p_fechar: true })); toast('Rateio fechado'); rateio(c, root); } catch (err) { fail(err); } });
  $('#ra-reab', root) && ($('#ra-reab', root).onclick = async () => { try { await q(sb.rpc('cc_rateio_situacao', { p_empresa: e, p_mes: mes, p_fechar: false })); toast('Rateio reaberto'); rateio(c, root); } catch (err) { fail(err); } });
}

async function regras(c, root) {
  loading(c);
  let R, D; try { [R, D] = await Promise.all([q(sb.from('cc_rateio_regras').select('*').eq('empresa_id', state.empresa.id).order('ordem').order('nome')), q(sb.from('cc_rateio_destinos').select('*'))]); }
  catch (err) { return erroSQL(c, err); }
  const mapa = new Map((state.cad.cc || []).map(x => [x.id, x])), nome = (id) => esc(caminho(id, mapa) || '—');
  if (isAdmin()) { $('#cr-acoes', root).innerHTML = '<button class="btn primary" id="rg-novo">Nova regra</button>'; $('#rg-novo', root).onclick = () => editar(c, root, { ativo: true, criterio: 'percentual', ordem: (R.length + 1) * 10, planos: [] }, []); }
  c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Ordem</th><th>Regra</th><th>De</th><th>Critério</th><th>Para</th><th>Contas</th><th></th></tr></thead><tbody>
    ${R.map(r => { const ds = D.filter(d => d.regra_id === r.id);
      return `<tr class="${isAdmin() ? 'clickable' : ''}" data-r="${r.id}"><td>${r.ordem}</td><td><b>${esc(r.nome)}</b></td><td class="small">${nome(r.origem_cc_id)}</td><td class="small">${CRIT[r.criterio]}${r.base_nome ? ` (${esc(r.base_nome)})` : ''}</td>
        <td class="small wrap">${ds.map(d => `${nome(d.cc_id)}${r.criterio === 'percentual' ? ` ${(+d.percentual || 0).toLocaleString('pt-BR')}%` : r.criterio === 'base' ? ` ${(+d.base || 0).toLocaleString('pt-BR')}` : ''}`).join('<br>')}</td>
        <td class="small">${r.planos?.length ? `${r.planos.length} conta(s)` : 'todas as saídas'}</td><td>${r.ativo ? '' : '<span class="badge">inativa</span>'}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Nenhuma regra de rateio.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Pessoas e salários vêm de RH › Colaboradores (centro de custo de cada pessoa). Base informada: m², kg produzidos, horas-máquina ou outra medida, por destino.</p>`;
  if (!isAdmin()) return;
  c.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr[data-r]')?.dataset.r; if (id) editar(c, root, R.find(r => r.id === id), D.filter(d => d.regra_id === id)); };
}

function editar(c, root, r, ds) {
  const A = arvore((state.cad.cc || []).filter(x => x.ativo !== false)), mapa = new Map((state.cad.cc || []).map(x => [x.id, x]));
  const optCC = (sel) => A.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${'  '.repeat(x.prof)}${esc(x.nome)}</option>`).join('');
  const planos = (state.cad.plano || []).filter(p => p.tipo === 'S').sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { numeric: true }));
  const linhaD = (d = {}) => `<tr><td><select class="rd-cc">${optCC(d.cc_id)}</select></td><td><input type="number" step="0.0001" class="rd-v" value="${d.percentual ?? d.base ?? ''}" style="width:120px"></td><td><button class="btn small ghost rd-x">✕</button></td></tr>`;
  const md = modal({ wide: true, title: r.id ? 'Regra de rateio' : 'Nova regra de rateio', body: `<div class="grid2">
      <label>Nome<input id="re-nome" value="${esc(r.nome || '')}" placeholder="ex.: Administração para as fábricas"></label><label>Ordem (cascata)<input type="number" id="re-ord" value="${r.ordem ?? 10}"></label>
      <label>Ratear as despesas de<select id="re-or">${optCC(r.origem_cc_id)}</select></label>
      <label>Critério<select id="re-cr">${Object.entries(CRIT).map(([k, t]) => `<option value="${k}" ${r.criterio === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label id="re-bn-l">Nome da base<input id="re-bn" value="${esc(r.base_nome || '')}" placeholder="m², kg, horas-máquina"></label>
      <label class="chk"><input type="checkbox" id="re-at" ${r.ativo !== false ? 'checked' : ''}> Ativa</label>
      <label>Só estas contas do plano (vazio = todas as saídas)<select id="re-pl" multiple size="6">${planos.map(p => `<option value="${p.id}" ${(r.planos || []).includes(p.id) ? 'selected' : ''}>${esc(p.codigo)} ${esc(p.nome)}</option>`).join('')}</select></label>
      <div><b class="small">Para quais centros</b><table class="small"><thead><tr><th>Centro</th><th id="re-vh">Valor</th><th></th></tr></thead><tbody id="re-ds">${(ds.length ? ds : [{}]).map(linhaD).join('')}</tbody></table>
        <button class="btn small" id="re-add">+ destino</button></div></div>
    <p class="small muted">O total rateado é a soma das saídas do centro de origem e dos de baixo, mais o que ele recebeu das regras anteriores. Ctrl/⌘ para marcar várias contas.</p>`,
    foot: `${r.id ? '<button class="btn danger" id="re-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="re-ok">Salvar</button>` });
  const crit = () => { const v = $('#re-cr', md.el).value; $('#re-vh', md.el).textContent = v === 'percentual' ? '%' : v === 'base' ? 'Base' : '—'; $('#re-bn-l', md.el).style.display = v === 'base' ? '' : 'none'; $$('.rd-v', md.el).forEach(x => { x.disabled = !['percentual', 'base'].includes(v); }); };
  crit(); $('#re-cr', md.el).onchange = crit;
  $('#re-add', md.el).onclick = () => { $('#re-ds', md.el).insertAdjacentHTML('beforeend', linhaD()); crit(); };
  $('#re-ds', md.el).onclick = (e) => { if (e.target.closest('.rd-x')) e.target.closest('tr').remove(); };
  $('#re-ok', md.el).onclick = async (ev) => {
    const v = { empresa_id: state.empresa.id, nome: $('#re-nome', md.el).value.trim(), ordem: +$('#re-ord', md.el).value || 10, origem_cc_id: $('#re-or', md.el).value, criterio: $('#re-cr', md.el).value,
      base_nome: $('#re-bn', md.el).value.trim() || null, ativo: $('#re-at', md.el).checked, planos: [...$('#re-pl', md.el).selectedOptions].map(o => o.value), atualizado_em: new Date().toISOString() };
    const dest = $$('#re-ds tr', md.el).map(tr => ({ cc_id: $('.rd-cc', tr).value, val: +$('.rd-v', tr).value || 0 })).filter(d => d.cc_id);
    if (!v.nome) return toast('Informe o nome', true);
    if (!dest.length) return toast('Informe ao menos um destino', true);
    if (new Set(dest.map(d => d.cc_id)).size !== dest.length) return toast('Centro repetido nos destinos', true);
    if (dest.some(d => d.cc_id === v.origem_cc_id)) return toast('O destino não pode ser o centro de origem', true);
    if (v.criterio === 'percentual' && Math.abs(dest.reduce((t, d) => t + d.val, 0) - 100) > 0.01) return toast('Os percentuais precisam somar 100%', true);
    ev.target.disabled = true;
    try {
      const [g] = await q(r.id ? sb.from('cc_rateio_regras').update(v).eq('id', r.id).select('id') : sb.from('cc_rateio_regras').insert(v).select('id'));
      await q(sb.from('cc_rateio_destinos').delete().eq('regra_id', g.id));
      await q(sb.from('cc_rateio_destinos').insert(dest.map(d => ({ regra_id: g.id, cc_id: d.cc_id, percentual: v.criterio === 'percentual' ? d.val : null, base: v.criterio === 'base' ? d.val : null }))));
      toast('Regra salva'); md.close(); regras(c, root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#re-del', md.el) && ($('#re-del', md.el).onclick = async () => { if (!confirm('Excluir a regra? Os rateios já aplicados com ela também saem.')) return; try { await q(sb.from('cc_rateio_regras').delete().eq('id', r.id)); toast('Regra excluída'); md.close(); regras(c, root); } catch (err) { fail(err); } });
}

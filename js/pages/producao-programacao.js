// Produção › Programação: quadro máquina × dia com as etapas programadas e a carga (horas) contra a capacidade do setor.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, dateBR, today, fail, toast, modal } from '../lib/ui.js';
import { cadProducao, podePCP, addDias } from '../lib/producao.js';
import { qtd, inp, num } from '../lib/compras.js';

export const title = 'Programação da produção';
const ui = { ini: null, setor: '' };
const segunda = (s) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

export async function render(root) {
  ui.ini ||= segunda(today());
  const dias = Array.from({ length: 7 }, (_, i) => addDias(ui.ini, i)), fim = dias[6];
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Programação da produção</h2><div class="muted small">Horas previstas = quantidade ÷ velocidade (roteiro) ou capacidade da máquina, + setup. Carga acima das horas do setor fica em destaque.</div></div>
      <div style="display:flex;gap:6px;align-items:end"><button class="btn ghost" id="pg-ant">◀</button><label>Semana de<input type="date" id="pg-ini" value="${ui.ini}"></label><button class="btn ghost" id="pg-prox">▶</button></div></div>
    <div id="pg-corpo"><div class="loading">Carregando…</div></div>`;
  $('#pg-ant', root).onclick = () => { ui.ini = addDias(ui.ini, -7); render(root); };
  $('#pg-prox', root).onclick = () => { ui.ini = addDias(ui.ini, 7); render(root); };
  $('#pg-ini', root).onchange = (e) => { ui.ini = segunda(e.target.value); render(root); };
  let C, ets, ops;
  try {
    const e = state.empresa.id;
    [C, ets] = await Promise.all([cadProducao(true), fetchAll(() => sb.from('prod_ordem_etapas').select('*').eq('empresa_id', e).neq('status', 'concluida').order('id'))]);
    const ids = [...new Set(ets.map(x => x.ordem_id))];
    ops = ids.length ? (await fetchAll(() => sb.from('prod_ordens').select('id,numero,numero_iniflex,codigo_produto,descricao,quantidade,unidade,entrega,prioridade,status,cliente').in('id', ids.slice(0, 900)).order('id'))) : [];
  } catch (err) { fail(err); $('#pg-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const opById = Object.fromEntries(ops.filter(o => !['concluida', 'cancelada'].includes(o.status)).map(o => [o.id, o]));
  const ativas = ets.filter(x => opById[x.ordem_id]);
  const semData = ativas.filter(x => !x.inicio_previsto || !x.maquina_id).sort((a, b) => opById[a.ordem_id].prioridade - opById[b.ordem_id].prioridade || String(opById[a.ordem_id].entrega || '9').localeCompare(String(opById[b.ordem_id].entrega || '9')));
  const maqs = C.maquinas.filter(m => m.ativo && (!ui.setor || m.setor_id === ui.setor));
  const cel = (m, d) => ativas.filter(x => x.maquina_id === m.id && x.inicio_previsto === d);
  const corpo = $('#pg-corpo', root);
  corpo.innerHTML = `<div class="card toolbar"><label>Setor<select id="pg-s"><option value="">Todos</option>${C.setores.map(s => `<option value="${s.id}" ${ui.setor === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></label></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table class="pg-tab"><thead><tr><th>Máquina</th>${dias.map(d => `<th>${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][dias.indexOf(d)]} ${dateBR(d).slice(0, 5)}</th>`).join('')}</tr></thead><tbody>
    ${maqs.map(m => { const hd = +(C.setorById[m.setor_id]?.horas_dia || 24);
      return `<tr><td><b>${esc(m.codigo)}</b><div class="small muted">${esc(m.nome)}</div></td>${dias.map(d => { const L = cel(m, d), hs = L.reduce((t, x) => t + (+x.horas_previstas || 0), 0);
        return `<td class="pg-cel ${hs > hd ? 'pg-cheia' : ''}">${L.map(x => { const o = opById[x.ordem_id]; return `<div class="pg-item ${o.entrega && o.entrega < d ? 'pg-atr' : ''}" data-e="${x.id}"><b>OP ${o.numero}</b> P${o.prioridade}<br><span class="small">${esc((o.codigo_produto || '') + ' ' + (o.descricao || '')).slice(0, 40)}</span><br><span class="small muted">${qtd(x.qtd_prevista || o.quantidade)} ${esc(o.unidade)}${x.horas_previstas ? ` · ${String(x.horas_previstas).replace('.', ',')} h` : ''}</span></div>`; }).join('')}
          ${hs ? `<div class="small ${hs > hd ? 'neg' : 'muted'}">${hs.toFixed(1).replace('.', ',')} / ${hd} h</div>` : ''}</td>`; }).join('')}</tr>`; }).join('') || `<tr><td colspan="8" class="empty">Cadastre as máquinas em Produção › Cadastros.</td></tr>`}</tbody></table></div></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>A programar (${semData.length})</h2></div><div class="table-wrap" style="max-height:340px"><table><thead><tr><th>OP</th><th>Etapa</th><th>Produto</th><th>Cliente</th><th class="num">Quantidade</th><th>Entrega</th><th>Prior.</th>${podePCP() ? '<th></th>' : ''}</tr></thead><tbody>
      ${semData.map(x => { const o = opById[x.ordem_id]; return `<tr><td>${o.numero}${o.numero_iniflex ? ` <span class="muted small">${esc(o.numero_iniflex)}</span>` : ''}</td><td>${x.seq}. ${esc(C.setorById[x.setor_id]?.nome || '')}</td><td class="wrap">${esc(o.codigo_produto || '')} ${esc(o.descricao || '')}</td>
        <td class="wrap">${esc(o.cliente || '')}</td><td class="num">${qtd(o.quantidade)} ${esc(o.unidade)}</td><td class="${o.entrega && o.entrega < today() ? 'neg' : ''}">${dateBR(o.entrega)}</td><td>${o.prioridade}</td>
        ${podePCP() ? `<td><button class="btn small" data-e="${x.id}">Programar</button></td>` : ''}</tr>`; }).join('') || '<tr><td colspan="8" class="empty">Tudo programado.</td></tr>'}</tbody></table></div></div>`;
  $('#pg-s', corpo).onchange = (e) => { ui.setor = e.target.value; render(root); };
  if (podePCP()) $$('[data-e]', corpo).forEach(el => el.onclick = () => programar(ativas.find(x => x.id === el.dataset.e), opById, C, root));
}

function programar(x, opById, C, root) {
  const o = opById[x.ordem_id], maqs = C.maquinas.filter(m => m.ativo && m.setor_id === x.setor_id);
  const sugHoras = (mid) => { const m = C.maqById[mid]; return o.unidade === 'KG' && m?.capacidade_kg_h ? Math.round((+(x.qtd_prevista || o.quantidade) / m.capacidade_kg_h) * 100) / 100 : null; };
  const md = modal({ title: `Programar OP ${o.numero} — ${C.setorById[x.setor_id]?.nome || ''}`, body: `
    <div class="grid-form"><label>Máquina<select id="pr-m"><option value="">—</option>${maqs.map(m => `<option value="${m.id}" ${x.maquina_id === m.id ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.nome)}${m.capacidade_kg_h ? ` (${qtd(m.capacidade_kg_h)} kg/h)` : ''}</option>`).join('')}</select></label>
      <label>Início previsto<input type="date" id="pr-d" value="${x.inicio_previsto || today()}"></label><label>Horas previstas<input id="pr-h" value="${inp(x.horas_previstas ?? sugHoras(x.maquina_id))}"></label>
      <label>Quantidade desta etapa<input id="pr-q" value="${inp(x.qtd_prevista ?? o.quantidade)}"></label></div>`,
    foot: `${x.inicio_previsto ? '<button class="btn ghost" id="pr-tirar" style="margin-right:auto">Tirar da programação</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pr-ok">Salvar</button>` });
  $('#pr-m', md.el).onchange = (e) => { if (!$('#pr-h', md.el).value.trim()) $('#pr-h', md.el).value = inp(sugHoras(e.target.value)); };
  $('#pr-ok', md.el).onclick = async () => {
    try { await q(sb.from('prod_ordem_etapas').update({ maquina_id: $('#pr-m', md.el).value || null, inicio_previsto: $('#pr-d', md.el).value || null,
      horas_previstas: $('#pr-h', md.el).value.trim() ? num($('#pr-h', md.el).value) : null, qtd_prevista: $('#pr-q', md.el).value.trim() ? num($('#pr-q', md.el).value) : null }).eq('id', x.id));
      md.close(); toast('Programado'); render(root); } catch (err) { fail(err); }
  };
  $('#pr-tirar', md.el) && ($('#pr-tirar', md.el).onclick = async () => { try { await q(sb.from('prod_ordem_etapas').update({ inicio_previsto: null }).eq('id', x.id)); md.close(); render(root); } catch (err) { fail(err); } });
}

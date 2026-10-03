import { sb, state, q, fetchAll, podeEditar, soma, z, mesesHeader } from '../lib/data.js';
import { $, $$, esc, money, cls, parseNum, fail, toast, loading, exportXLSX, MESES } from '../lib/ui.js';

export const title = 'Budget / Forecast';
let cenario = 'budget';
let atual = {};   // `${plano}|${mes}` -> {id, valor}
let edit = {};    // `${plano}|${mes}` -> valor

export async function render(root) {
  root.innerHTML = `<div class="card"><div class="toolbar">
      <label>Cenário<select id="cen"><option value="budget">Budget (planejamento inicial)</option><option value="forecast" ${cenario === 'forecast' ? 'selected' : ''}>Forecast (revisão)</option></select></label>
      <span class="spacer"></span>
      ${podeEditar() ? `<button class="btn" id="copiar">${cenario === 'forecast' ? 'Copiar budget → forecast' : 'Copiar realizado do ano anterior'}</button>
      <button class="btn" id="exp">Exportar Excel</button><button class="btn primary" id="salvar" disabled>Salvar alterações</button>` : '<button class="btn" id="exp">Exportar Excel</button>'}
    </div>
    <p class="muted small" style="margin:10px 0 0">Valores positivos. Entradas somam e saídas subtraem automaticamente pelo plano de contas. Use Tab para navegar entre as células; cole valores do Excel normalmente.</p></div>
    <div id="status-box"></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>`;
  $('#cen', root).onchange = (e) => { cenario = e.target.value; edit = {}; render(root); };
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), `${cenario}_${state.ano}`);
  if (podeEditar()) {
    $('#salvar', root).onclick = () => salvar(root);
    $('#copiar', root).onclick = () => copiar(root);
  }
  await load(root);
}

async function load(root) {
  const tbl = $('#tbl', root); loading(tbl);
  try {
    const rows = await fetchAll(() => sb.from('orcamentos').select('id,plano_id,mes,valor,centro_custo_id')
      .eq('empresa_id', state.empresa.id).eq('cenario', cenario).eq('ano', state.ano));
    atual = {}; const comCC = {};
    for (const r of rows) {
      const k = `${r.plano_id}|${r.mes}`;
      if (r.centro_custo_id) { comCC[k] = (comCC[k] || 0) + +r.valor; continue; }
      atual[k] = { id: r.id, valor: +r.valor };
    }
    if (cenario === 'forecast') await statusBox(root);
    const c = state.cad, ed = podeEditar();
    const val = (p, m) => edit[`${p}|${m}`] ?? atual[`${p}|${m}`]?.valor ?? 0;
    let body = '';
    for (const [t, nome] of [['E', 'ENTRADAS'], ['S', 'SAÍDAS']]) {
      const totT = z();
      let sec = '';
      for (const cl of c.classes.filter(x => x.tipo === t)) {
        const filhos = c.contasPlano.filter(p => p.pai_id === cl.id && p.ativo);
        if (!filhos.length) continue;
        const totC = z();
        let lin = '';
        for (const p of filhos) {
          const v = Array.from({ length: 12 }, (_, i) => val(p.id, i + 1));
          v.forEach((x, i) => { totC[i] += x; totT[i] += x; });
          lin += `<tr data-p="${p.id}"><td class="sticky" style="padding-left:22px">${esc(p.label)}</td>
            ${v.map((x, i) => `<td class="num">${ed ? `<input class="cell" data-m="${i + 1}" value="${x ? money(x) : ''}">` : money(x)}${comCC[`${p.id}|${i + 1}`] ? `<div class="muted small">+${money(comCC[`${p.id}|${i + 1}`])} por C.C.</div>` : ''}</td>`).join('')}
            <td class="num"><strong>${money(soma(v))}</strong></td></tr>`;
        }
        sec += `<tr class="row-l1"><td class="sticky">${esc(cl.label)}</td>${totC.map(x => `<td class="num">${money(x)}</td>`).join('')}<td class="num">${money(soma(totC))}</td></tr>` + lin;
      }
      body += `<tr class="row-sec"><td class="sticky">${nome}</td>${totT.map(x => `<td class="num">${money(x)}</td>`).join('')}<td class="num">${money(soma(totT))}</td></tr>` + sec;
    }
    tbl.innerHTML = `<table><thead><tr><th class="sticky">${cenario.toUpperCase()} ${state.ano}</th>${mesesHeader('<th class="num">TOTAL</th>')}</tr></thead><tbody>${body}</tbody></table>`;
    if (ed) {
      tbl.oninput = (e) => {
        if (!e.target.matches('input.cell')) return;
        const p = e.target.closest('tr').dataset.p, m = e.target.dataset.m;
        edit[`${p}|${m}`] = parseNum(e.target.value);
        $('#salvar', root).disabled = false;
        $('#salvar', root).textContent = `Salvar alterações (${Object.keys(edit).length})`;
      };
      tbl.onpaste = (e) => { // colar bloco do Excel
        if (!e.target.matches('input.cell')) return;
        const txt = e.clipboardData.getData('text'); if (!txt.includes('\t') && !txt.includes('\n')) return;
        e.preventDefault();
        const linhas = txt.replace(/\r/g, '').split('\n').filter(Boolean).map(l => l.split('\t'));
        let tr = e.target.closest('tr'); const m0 = +e.target.dataset.m;
        for (const l of linhas) {
          if (!tr) break;
          if (tr.dataset.p) l.forEach((v, j) => { const inp = $(`input[data-m="${m0 + j}"]`, tr); if (inp) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); } });
          do { tr = tr.nextElementSibling; } while (tr && !tr.dataset.p);
        }
      };
    }
  } catch (e) { fail(e); }
}

async function statusBox(root) {
  const box = $('#status-box', root);
  let st = await q(sb.from('forecast_status').select('*').eq('empresa_id', state.empresa.id).eq('ano', state.ano));
  const by = Object.fromEntries(st.map(s => [s.mes, s.status]));
  box.innerHTML = `<div class="card"><h3>Status de cada mês no forecast</h3>
    <p class="muted small" style="margin-top:0">Realizado = usa o caixa real · Prev. Ajustada = usa os valores deste forecast · Prev. Inicial = mantém o budget. Usado em Orçado x Realizado.</p>
    <div class="table-wrap"><table><thead><tr>${MESES.map(m => `<th>${m.slice(0, 3)}</th>`).join('')}</tr></thead><tbody><tr>
    ${MESES.map((_, i) => `<td><select data-m="${i + 1}" ${podeEditar() ? '' : 'disabled'}>${['Realizado', 'Prev. Ajustada', 'Prev. Inicial'].map(s => `<option ${(by[i + 1] || 'Prev. Ajustada') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>`).join('')}
    </tr></tbody></table></div></div>`;
  box.onchange = async (e) => {
    try {
      await q(sb.from('forecast_status').upsert({ empresa_id: state.empresa.id, ano: state.ano, mes: +e.target.dataset.m, status: e.target.value }));
      toast('Status atualizado');
    } catch (err) { fail(err); }
  };
}

async function salvar(root) {
  const ins = [], upd = [], del = [];
  for (const [k, v] of Object.entries(edit)) {
    const [plano_id, mes] = k.split('|'); const ex = atual[k];
    if (ex && !v) del.push(ex.id);
    else if (ex) upd.push({ id: ex.id, valor: v });
    else if (v) ins.push({ empresa_id: state.empresa.id, cenario, ano: state.ano, mes: +mes, plano_id, valor: v });
  }
  try {
    if (del.length) await q(sb.from('orcamentos').delete().in('id', del));
    for (let i = 0; i < ins.length; i += 500) await q(sb.from('orcamentos').insert(ins.slice(i, i + 500)));
    await Promise.all(upd.map(u => q(sb.from('orcamentos').update({ valor: u.valor }).eq('id', u.id))));
    edit = {}; toast('Orçamento salvo'); render(root);
  } catch (e) { fail(e); }
}

async function copiar(root) {
  const e = state.empresa.id;
  try {
    let origem;
    if (cenario === 'forecast') {
      if (!confirm('Substituir todo o forecast deste ano pelos valores do budget?')) return;
      origem = (await fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor,centro_custo_id').eq('empresa_id', e).eq('cenario', 'budget').eq('ano', state.ano)));
    } else {
      if (!confirm(`Preencher o budget ${state.ano} com o realizado de ${state.ano - 1}? (substitui o budget atual)`)) return;
      const r = await q(sb.rpc('resumo_mensal', { p_empresa: e, p_ano: state.ano - 1 }));
      origem = r.filter(x => state.cad.planoById[x.plano_id]?.tipo !== 'T').map(x => ({ plano_id: x.plano_id, mes: x.mes, valor: Math.abs(+x.total), centro_custo_id: null }));
    }
    await q(sb.from('orcamentos').delete().eq('empresa_id', e).eq('cenario', cenario).eq('ano', state.ano));
    const rows = origem.filter(o => +o.valor).map(o => ({ empresa_id: e, cenario, ano: state.ano, mes: o.mes, plano_id: o.plano_id, centro_custo_id: o.centro_custo_id, valor: +o.valor }));
    for (let i = 0; i < rows.length; i += 500) await q(sb.from('orcamentos').insert(rows.slice(i, i + 500)));
    edit = {}; toast(`${rows.length} valores copiados`); render(root);
  } catch (err) { fail(err); }
}

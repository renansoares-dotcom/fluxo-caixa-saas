// RH › SST e Treinamentos (RHT006, melhoria 8.2): situação de ASO, NR e treinamentos por pessoa (vencido, a vencer, nunca feito),
// registro do que foi feito (vencimento pela validade do tipo) e o cadastro dos tipos com a obrigatoriedade por cargo ou setor.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, dateBR, toast, fail, modal, exportXLSX } from '../lib/ui.js';
import { temRH, podeRH, carregarBase, avisoMigracao, kpi } from '../lib/rh-dados.js';
import { CATEGORIAS, SITUACOES_SST, RESULTADOS, resumoSST } from '../lib/rh-docs.js';

export const title = 'SST e Treinamentos';
const ui = { aba: 'situacao', filtro: 'atencao', busca: '' };

export async function render(root) {
  if (!temRH()) { root.innerHTML = '<div class="card"><div class="empty">Acesso ao RH só para administrador ou quem tem a área RH liberada.</div></div>'; return; }
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="ss-abas">${[['situacao', 'Situação'], ['registros', 'Registros'], ['tipos', 'Tipos de exame e treinamento']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><span id="ss-acoes"></span></div><div id="ss-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#ss-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  let B, T; try { B = await carregarBase(); T = await q(sb.from('rh_sst_tipos').select('*').eq('empresa_id', state.empresa.id).order('categoria').order('nome')); }
  catch (err) { $('#ss-corpo', root).innerHTML = /rh_sst/.test(err.message || '') ? '<div class="card"><div class="empty">Esta tela precisa do SQL 145.</div></div>' : avisoMigracao; return; }
  const c = $('#ss-corpo', root);
  try { if (ui.aba === 'situacao') await situacao(c, B, T, root); else if (ui.aba === 'registros') await registros(c, B, T, root); else tipos(c, T, root); } catch (err) { fail(err); }
}

async function situacao(c, B, T, root) {
  const Q = await q(sb.rpc('rh_sst_situacao', { p_empresa: state.empresa.id })), R = resumoSST(Q);
  const filt = { atencao: (x) => ['vencido', 'a_vencer'].includes(x.situacao) || (x.situacao === 'pendente' && x.obrigatorio), vencido: (x) => x.situacao === 'vencido', a_vencer: (x) => x.situacao === 'a_vencer', pendente: (x) => x.situacao === 'pendente', todos: () => true }[ui.filtro];
  const V = Q.filter(filt).filter(x => !ui.busca || (x.nome + ' ' + x.tipo).toLowerCase().includes(ui.busca)).sort((a, b) => ({ vencido: 0, a_vencer: 1, pendente: 2, em_dia: 3 }[a.situacao] - { vencido: 0, a_vencer: 1, pendente: 2, em_dia: 3 }[b.situacao]) || (a.dias ?? 9e9) - (b.dias ?? 9e9));
  $('#ss-acoes', root).innerHTML = `<button class="btn" id="ss-xls">Excel</button>${podeRH() ? ' <button class="btn primary" id="ss-reg">Registrar</button>' : ''}`;
  c.innerHTML = `<div class="kpis">${kpi('Vencidos', R.vencido, '', R.vencido ? 'neg' : '')}${kpi('A vencer', R.a_vencer, 'dentro da antecedência do tipo', R.a_vencer ? 'warn' : '')}${kpi('Obrigatórios nunca feitos', R.pendente, '', R.pendente ? 'warn' : '')}
      ${kpi('Em dia', R.em_dia)}${kpi('Pessoas com pendência', R.pessoas)}</div>
    ${!T.length ? '<div class="card" style="margin-top:12px"><p class="small" style="margin:0">Cadastre os tipos de exame e treinamento (aba Tipos) com a validade e para quem são obrigatórios.</p></div>' : ''}
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><div class="chips" id="ss-f">${[['atencao', 'Precisam de atenção'], ['vencido', 'Vencidos'], ['a_vencer', 'A vencer'], ['pendente', 'Nunca feitos'], ['todos', 'Todos']].map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <input id="ss-b" placeholder="Buscar pessoa ou tipo" value="${esc(ui.busca)}" style="max-width:220px"></div>
    <div class="table-wrap" id="ss-tab" style="max-height:60vh"><table><thead><tr><th>Colaborador</th><th>Exame ou treinamento</th><th>Feito em</th><th>Vence em</th><th>Situação</th><th></th></tr></thead><tbody>
    ${V.map(x => { const [t, cl] = SITUACOES_SST[x.situacao]; return `<tr><td>${esc(x.nome)}<div class="small muted">${esc(x.cargo || '')}</div></td><td>${esc(x.tipo)} <span class="small muted">${CATEGORIAS[x.categoria]}</span>${x.obrigatorio ? '' : ' <span class="small muted">(não obrigatório)</span>'}</td>
      <td>${x.realizado_em ? dateBR(x.realizado_em) : '–'}</td><td>${x.vence_em ? dateBR(x.vence_em) : x.realizado_em ? 'não vence' : '–'}${x.dias != null && x.situacao !== 'em_dia' ? `<div class="small ${cl}">${x.dias < 0 ? `há ${-x.dias} dia(s)` : `em ${x.dias} dia(s)`}</div>` : ''}</td>
      <td><span class="${cl}">${t}</span></td><td>${podeRH() ? `<button class="btn small" data-reg="${x.colaborador_id}|${x.tipo_id}">Registrar</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Nada nesta situação.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Obrigatório: tipo marcado para todos os CLT, ou cargo/setor que contém um dos termos do tipo. O aviso diário ao RH (e à pessoa, se ela tiver usuário) é configurado em RH › Documentos e Portal.</p>`;
  $('#ss-f', c).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; situacao(c, B, T, root); } };
  $('#ss-b', c).onchange = (e) => { ui.busca = e.target.value.toLowerCase(); situacao(c, B, T, root); };
  $('#ss-xls', root).onclick = () => exportXLSX($('#ss-tab table', c), 'sst_treinamentos');
  $('#ss-reg', root) && ($('#ss-reg', root).onclick = () => registrar(B, T, null, null, root));
  $$('[data-reg]', c).forEach(b => b.onclick = () => { const [co, ti] = b.dataset.reg.split('|'); registrar(B, T, co, ti, root); });
}

async function registros(c, B, T, root) {
  const R = await fetchAll(() => sb.from('rh_sst_registros').select('*').eq('empresa_id', state.empresa.id).order('realizado_em', { ascending: false }).limit(1000));
  const tp = Object.fromEntries(T.map(t => [t.id, t]));
  $('#ss-acoes', root).innerHTML = podeRH() ? '<button class="btn primary" id="ss-reg">Registrar</button>' : '';
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:65vh"><table><thead><tr><th>Feito em</th><th>Colaborador</th><th>Exame ou treinamento</th><th>Resultado</th><th>Vence em</th><th>Carga horária</th><th></th></tr></thead><tbody>
    ${R.map(r => `<tr><td>${dateBR(r.realizado_em)}</td><td>${esc(B.colabById[r.colaborador_id]?.nome || '?')}</td><td>${esc(tp[r.tipo_id]?.nome || '?')}</td><td>${RESULTADOS[r.resultado] || ''}</td>
      <td>${r.vence_em ? dateBR(r.vence_em) : 'não vence'}</td><td>${r.carga_horaria ? r.carga_horaria + ' h' : ''}</td><td>${podeRH() ? `<button class="btn small ghost" data-del="${r.id}">Excluir</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">Nenhum registro.</td></tr>'}</tbody></table></div></div>`;
  $('#ss-reg', root) && ($('#ss-reg', root).onclick = () => registrar(B, T, null, null, root));
  $$('[data-del]', c).forEach(b => b.onclick = async () => { if (!confirm('Excluir este registro?')) return; try { await q(sb.from('rh_sst_registros').delete().eq('id', b.dataset.del)); toast('Registro excluído'); render(root); } catch (err) { fail(err); } });
}

function registrar(B, T, colab, tipo, root) {
  const ativos = B.colabs.filter(x => x.situacao !== 'desligado').sort((a, b) => a.nome.localeCompare(b.nome));
  const md = modal({ title: 'Registrar exame ou treinamento', body: `<div class="grid2">
      <label>Exame ou treinamento<select id="sr-t">${T.filter(t => t.ativo).map(t => `<option value="${t.id}" ${t.id === tipo ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
      <label>Feito em<input type="date" id="sr-d" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Resultado<select id="sr-r"><option value="">—</option>${Object.entries(RESULTADOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Carga horária (h)<input type="number" step="0.5" id="sr-h"></label>
      <label>Instrutor / clínica<input id="sr-i"></label><label>Observação<input id="sr-o"></label></div>
    <label>Pessoas (Ctrl/⌘ para várias — turma)<select id="sr-c" multiple size="8">${ativos.map(x => `<option value="${x.id}" ${x.id === colab ? 'selected' : ''}>${esc(x.nome)}${x.cargo ? ' — ' + esc(x.cargo) : ''}</option>`).join('')}</select></label>
    <p class="small muted">O vencimento sai da validade do tipo.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="sr-ok">Registrar</button>' });
  $('#sr-ok', md.el).onclick = async (ev) => {
    const ids = [...$('#sr-c', md.el).selectedOptions].map(o => o.value), t = $('#sr-t', md.el).value, d = $('#sr-d', md.el).value;
    if (!t || !d || !ids.length) return toast('Escolha o tipo, a data e as pessoas', true);
    ev.target.disabled = true;
    try {
      await q(sb.from('rh_sst_registros').insert(ids.map(id => ({ empresa_id: state.empresa.id, colaborador_id: id, tipo_id: t, realizado_em: d, resultado: $('#sr-r', md.el).value || null,
        carga_horaria: +$('#sr-h', md.el).value || null, instrutor: $('#sr-i', md.el).value.trim() || null, observacao: $('#sr-o', md.el).value.trim() || null }))));
      toast(`${ids.length} registro(s)`); md.close(); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

function tipos(c, T, root) {
  $('#ss-acoes', root).innerHTML = podeRH() ? '<button class="btn primary" id="ss-novo">Novo tipo</button>' : '';
  c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Categoria</th><th>Validade</th><th>Avisar antes</th><th>Obrigatório para</th><th></th></tr></thead><tbody>
    ${T.map(t => `<tr class="${podeRH() ? 'clickable' : ''}" data-t="${t.id}"><td><b>${esc(t.nome)}</b></td><td>${CATEGORIAS[t.categoria]}</td><td>${t.validade_meses ? t.validade_meses + ' mes(es)' : 'não vence'}</td><td>${t.antecedencia_dias} dia(s)</td>
      <td class="small">${[t.todos ? 'todos os CLT' : '', t.cargos.length ? 'cargos: ' + esc(t.cargos.join(', ')) : '', t.setores.length ? 'setores: ' + esc(t.setores.join(', ')) : ''].filter(Boolean).join(' · ') || '<span class="muted">ninguém (opcional)</span>'}</td>
      <td>${t.ativo ? '' : '<span class="badge">inativo</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum tipo cadastrado.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Exemplos: ASO periódico (12 meses, todos), NR-11 operação de empilhadeira (cargos com EMPILHADEIRA), NR-12 máquinas (setor Extrusão), NR-35 trabalho em altura, brigada de incêndio. Validades e periodicidades conforme o PCMSO e o PGR da empresa.</p>`;
  const editar = (t) => {
    const md = modal({ title: t ? 'Tipo de exame ou treinamento' : 'Novo tipo', body: `<div class="grid2">
        <label>Nome<input id="st-n" value="${esc(t?.nome || '')}"></label><label>Categoria<select id="st-c">${Object.entries(CATEGORIAS).map(([k, x]) => `<option value="${k}" ${t?.categoria === k ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Validade (meses; vazio = não vence)<input type="number" id="st-v" value="${t?.validade_meses ?? ''}"></label><label>Avisar quantos dias antes<input type="number" id="st-a" value="${t?.antecedencia_dias ?? 30}"></label>
        <label class="chk"><input type="checkbox" id="st-todos" ${t?.todos ? 'checked' : ''}> Obrigatório para todos os CLT</label><label class="chk"><input type="checkbox" id="st-at" ${t?.ativo !== false ? 'checked' : ''}> Ativo</label>
        <label>Cargos que contêm (separe por vírgula)<input id="st-cg" value="${esc((t?.cargos || []).join(', '))}" placeholder="EMPILHADEIRA, ELETRICISTA"></label>
        <label>Setores que contêm<input id="st-se" value="${esc((t?.setores || []).join(', '))}"></label></div>`,
      foot: `${t ? '<button class="btn danger" id="st-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="st-ok">Salvar</button>` });
    const lista = (id) => $(id, md.el).value.split(',').map(x => x.trim()).filter(Boolean);
    $('#st-ok', md.el).onclick = async () => {
      const r = { empresa_id: state.empresa.id, nome: $('#st-n', md.el).value.trim(), categoria: $('#st-c', md.el).value, validade_meses: +$('#st-v', md.el).value || null, antecedencia_dias: +$('#st-a', md.el).value || 0,
        todos: $('#st-todos', md.el).checked, ativo: $('#st-at', md.el).checked, cargos: lista('#st-cg'), setores: lista('#st-se') };
      if (!r.nome) return toast('Informe o nome', true);
      try { await q(t ? sb.from('rh_sst_tipos').update(r).eq('id', t.id) : sb.from('rh_sst_tipos').insert(r)); toast('Tipo salvo'); md.close(); render(root); } catch (err) { fail(err); }
    };
    $('#st-del', md.el) && ($('#st-del', md.el).onclick = async () => { if (!confirm('Excluir o tipo e todos os registros dele?')) return; try { await q(sb.from('rh_sst_tipos').delete().eq('id', t.id)); md.close(); render(root); } catch (err) { fail(err); } });
  };
  $('#ss-novo', root) && ($('#ss-novo', root).onclick = () => editar(null));
  podeRH() && (c.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr[data-t]')?.dataset.t; if (id) editar(T.find(t => t.id === id)); });
}

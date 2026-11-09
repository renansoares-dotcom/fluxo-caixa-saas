// RH › Horas × Folha (RHT008, melhoria 8.3): horas apontadas na produção × horas pagas na folha, por setor e por pessoa,
// com o aproveitamento, as horas sem apontamento e o custo delas; a ligação operador × colaborador e os parâmetros.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, pct, toast, fail, exportXLSX, MESES_CURTO } from '../lib/ui.js';
import { temRH, podeRH, avisoMigracao, kpi, carregarBase } from '../lib/rh-dados.js';
import { porSetor } from '../lib/horas-folha.js';

export const title = 'Horas × Folha';
const h = new Date(), ant = new Date(h.getFullYear(), h.getMonth() - 1, 1);
const ui = { aba: 'setores', mes: `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}`, chave: 'setor', abertos: new Set() };
const n1 = (v) => (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export async function render(root) {
  if (!temRH()) { root.innerHTML = '<div class="card"><div class="empty">Acesso ao RH só para administrador ou quem tem a área RH liberada.</div></div>'; return; }
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="hf-abas">${[['setores', 'Por setor'], ['ligacao', 'Operadores × colaboradores'], ['param', 'Parâmetros']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      ${ui.aba === 'setores' ? `<label class="small">Mês <input type="month" id="hf-mes" value="${ui.mes}"></label><label class="small">Agrupar por <select id="hf-ch"><option value="setor" ${ui.chave === 'setor' ? 'selected' : ''}>setor do RH</option><option value="setor_prod" ${ui.chave === 'setor_prod' ? 'selected' : ''}>setor da produção</option></select></label>` : ''}
      <span class="spacer"></span><span id="hf-acoes"></span></div><div id="hf-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#hf-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  $('#hf-mes', root) && ($('#hf-mes', root).onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; render(root); } });
  $('#hf-ch', root) && ($('#hf-ch', root).onchange = (e) => { ui.chave = e.target.value; render(root); });
  const c = $('#hf-corpo', root);
  try { if (ui.aba === 'setores') await setores(c, root); else if (ui.aba === 'ligacao') await ligacao(c, root); else await parametros(c, root); }
  catch (err) { c.innerHTML = /hf_|prod_oper/.test(err.message || '') ? '<div class="card"><div class="empty">Esta tela precisa do SQL 146.</div></div>' : avisoMigracao; }
}

async function setores(c, root) {
  const H = await q(sb.rpc('hf_horas', { p_empresa: state.empresa.id, p_mes: ui.mes + '-01' }));
  const S = porSetor(H.pessoas || [], ui.chave, +H.horas_mes || 220), T = S.total, meta = (+H.meta_pct || 85) / 100, semLig = H.operadores_sem_ligacao || [];
  const cor = (a) => a == null ? '' : a >= meta ? 'pos' : a >= meta - 0.15 ? 'warn' : 'neg';
  $('#hf-acoes', root).innerHTML = '<button class="btn" id="hf-xls">Excel</button>';
  c.innerHTML = `<div class="kpis">${kpi('Horas pagas', n1(T.pagas), `${n1(T.extras)} h extras · ${T.pessoas} pessoa(s)`)}${kpi('Horas apontadas', n1(T.apontadas))}
      ${kpi('Aproveitamento', T.aproveitamento == null ? '–' : pct(T.aproveitamento), `meta ${pct(meta)}`, cor(T.aproveitamento))}${kpi('Horas sem apontamento', n1(T.ociosas))}${kpi('Custo dessas horas', money(T.custoOcioso), 'salário ÷ jornada × horas', T.custoOcioso ? 'warn' : '')}</div>
    ${semLig.length ? `<div class="card" style="margin-top:12px;border-left:4px solid var(--warn,#c80)"><p class="small" style="margin:0"><b>${semLig.length} operador(es) com apontamentos e sem colaborador ligado</b> (${n1(semLig.reduce((s, o) => s + +o.horas, 0))} h fora da conta): ${semLig.slice(0, 6).map(o => esc(o.nome)).join(', ')}${semLig.length > 6 ? '…' : ''}. Ligue na aba Operadores × colaboradores.</p></div>` : ''}
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" id="hf-tab"><table><thead><tr><th>Setor / pessoa</th><th class="num">Contrato</th><th class="num">Extras</th><th class="num">Pagas</th><th class="num">Apontadas</th><th class="num">Aproveitamento</th><th class="num">Sem apontamento</th><th class="num">Custo</th></tr></thead><tbody>
    ${S.linhas.map(l => `<tr class="dre-l" data-s="${esc(l.setor)}"><td><span class="bal-tg">${ui.abertos.has(l.setor) ? '▾' : '▸'}</span><b>${esc(l.setor)}</b> <span class="small muted">${l.pessoas} pessoa(s)${l.semLigacao ? ` · <span class="warn">${l.semLigacao} sem operador</span>` : ''}</span></td>
        <td class="num">${n1(l.contrato)}</td><td class="num">${n1(l.extras)}</td><td class="num">${n1(l.pagas)}</td><td class="num">${n1(l.apontadas)}</td><td class="num ${cor(l.aproveitamento)}"><b>${l.aproveitamento == null ? '–' : pct(l.aproveitamento)}</b></td>
        <td class="num">${n1(l.ociosas)}</td><td class="num">${money(l.custoOcioso)}</td></tr>
      ${ui.abertos.has(l.setor) ? l.lista.map(p => `<tr class="small"><td style="padding-left:30px">${esc(p.nome)} <span class="muted">${esc(p.cargo || '')}${p.dias_ferias ? ` · ${p.dias_ferias} dia(s) de férias` : ''}${p.ligado ? '' : ' · sem operador ligado'}</span></td>
        <td class="num">${n1(p.horas_contrato)}</td><td class="num">${n1(p.horas_extras)}</td><td class="num">${n1(p.pagas)}</td><td class="num">${n1(p.apontadas)}</td><td class="num ${cor(p.aproveitamento)}">${p.aproveitamento == null ? '–' : pct(p.aproveitamento)}</td>
        <td class="num">${n1(p.ociosas)}</td><td class="num">${money(p.custoOcioso)}</td></tr>`).join('') : ''}`).join('') || '<tr><td colspan="8" class="empty">Ninguém na comparação. Ligue os operadores aos colaboradores ou escolha os setores nos parâmetros.</td></tr>'}
    <tr class="row-sec"><td>Total</td><td></td><td class="num">${n1(T.extras)}</td><td class="num">${n1(T.pagas)}</td><td class="num">${n1(T.apontadas)}</td><td class="num">${T.aproveitamento == null ? '–' : pct(T.aproveitamento)}</td><td class="num">${n1(T.ociosas)}</td><td class="num">${money(T.custoOcioso)}</td></tr></tbody></table></div></div>
    <p class="small muted">Pagas = jornada de ${n1(H.horas_mes)} h proporcional aos dias no mês (admissão, demissão e férias) + horas extras do mês. Apontadas = soma dos apontamentos encerrados do operador ligado; apontamentos sobrepostos contam uma vez e cada um é limitado ao máximo dos parâmetros. Horas sem apontamento incluem setup, limpeza, treinamento e paradas não apontadas: use para achar onde o apontamento falta e onde a equipe sobra.</p>`;
  c.querySelector('tbody').onclick = (e) => { const s = e.target.closest('tr.dre-l')?.dataset.s; if (s == null) return; ui.abertos.has(s) ? ui.abertos.delete(s) : ui.abertos.add(s); setores(c, root); };
  $('#hf-xls', root).onclick = () => exportXLSX($('#hf-tab table', c), `horas_folha_${ui.mes}`);
}

async function ligacao(c, root) {
  const [O, B] = await Promise.all([q(sb.rpc('hf_operadores', { p_empresa: state.empresa.id })), carregarBase()]);
  const ativos = B.colabs.filter(x => x.situacao !== 'desligado').sort((a, b) => a.nome.localeCompare(b.nome));
  $('#hf-acoes', root).innerHTML = podeRH() ? '<button class="btn" id="hf-sug">Sugerir pela matrícula e pelo nome</button>' : '';
  c.innerHTML = `<div class="kpis">${kpi('Operadores', O.length)}${kpi('Ligados', O.filter(o => o.colaborador_id).length)}${kpi('Sem ligação', O.filter(o => !o.colaborador_id && o.ativo).length, '', O.some(o => !o.colaborador_id && o.ativo) ? 'warn' : '')}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:65vh"><table><thead><tr><th>Operador da produção</th><th>Matrícula</th><th>Colaborador do RH</th></tr></thead><tbody>
    ${O.map(o => `<tr><td>${esc(o.nome)}${o.ativo ? '' : ' <span class="badge">inativo</span>'}</td><td>${esc(o.matricula || '')}</td>
      <td>${podeRH() ? `<select class="hf-l" data-o="${o.id}"><option value="">— não ligado —</option>${ativos.map(x => `<option value="${x.id}" ${x.id === o.colaborador_id ? 'selected' : ''}>${esc(x.nome)}${x.matricula ? ' (' + esc(x.matricula) + ')' : ''}</option>`).join('')}</select>` : esc(B.colabById[o.colaborador_id]?.nome || '—')}</td></tr>`).join('')
      || '<tr><td colspan="3" class="empty">Nenhum operador cadastrado na produção.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Cada colaborador fica ligado a um operador só. A sugestão liga quem tem a mesma matrícula (sem zeros à esquerda) ou o mesmo nome; confira depois.</p>`;
  $('#hf-sug', root) && ($('#hf-sug', root).onclick = async () => { try { const n = await q(sb.rpc('hf_sugerir', { p_empresa: state.empresa.id })); toast(`${n} ligação(ões) sugerida(s)`); render(root); } catch (err) { fail(err); } });
  $$('.hf-l', c).forEach(s => s.onchange = async () => { try { await q(sb.rpc('hf_ligar', { p_operador: s.dataset.o, p_colaborador: s.value || null })); toast('Ligação salva'); render(root); } catch (err) { fail(err); render(root); } });
}

async function parametros(c, root) {
  const [[cfg0], B] = await Promise.all([q(sb.from('hf_config').select('*').eq('empresa_id', state.empresa.id)), carregarBase()]);
  const cfg = cfg0 || { horas_mes: 220, limite_apontamento_h: 12, descontar_ferias: true, setores_rh: [], meta_pct: 85 };
  const setores = [...new Set(B.colabs.map(x => x.setor).filter(Boolean))].sort();
  const pode = podeRH();
  c.innerHTML = `<div class="card"><h2 style="margin-top:0">Parâmetros</h2><div class="grid2">
      <label>Jornada do mês (horas)<input type="number" step="0.5" id="hp-h" value="${cfg.horas_mes}" ${pode ? '' : 'disabled'}><span class="small muted">44 h/semana: 220</span></label>
      <label>Limite de um apontamento (horas)<input type="number" step="0.5" id="hp-l" value="${cfg.limite_apontamento_h}" ${pode ? '' : 'disabled'}><span class="small muted">apontamento esquecido aberto não infla as horas</span></label>
      <label>Meta de aproveitamento (%)<input type="number" step="1" id="hp-m" value="${cfg.meta_pct}" ${pode ? '' : 'disabled'}></label>
      <label class="chk"><input type="checkbox" id="hp-f" ${cfg.descontar_ferias ? 'checked' : ''} ${pode ? '' : 'disabled'}> Descontar os dias de férias das horas pagas</label></div>
    <div><b class="small">Setores do RH na comparação</b> <span class="small muted">(nenhum marcado = só quem tem operador ligado)</span>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:6px">${setores.map(s => `<label class="chk"><input type="checkbox" class="hp-s" value="${esc(s)}" ${(cfg.setores_rh || []).includes(s) ? 'checked' : ''} ${pode ? '' : 'disabled'}> ${esc(s)}</label>`).join('') || '<span class="muted small">Sem setores no cadastro do RH.</span>'}</div></div>
    ${pode ? '<button class="btn primary" id="hp-ok" style="margin-top:12px">Salvar</button>' : ''}</div>`;
  $('#hp-ok', c) && ($('#hp-ok', c).onclick = async () => {
    try { await q(sb.from('hf_config').upsert({ empresa_id: state.empresa.id, horas_mes: +$('#hp-h', c).value || 220, limite_apontamento_h: +$('#hp-l', c).value || 12, meta_pct: +$('#hp-m', c).value || 85,
      descontar_ferias: $('#hp-f', c).checked, setores_rh: $$('.hp-s:checked', c).map(x => x.value), atualizado_em: new Date().toISOString() })); toast('Parâmetros salvos'); } catch (err) { fail(err); }
  });
}

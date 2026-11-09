// Meu Portal (melhoria 8.2): o colaborador vê os documentos dele (holerites, informes, avisos), as férias e os exames e treinamentos.
// Tudo vem de portal_meus_dados (só os dados de quem está logado); os arquivos abrem por link temporário do espaço privado rh-docs.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, dateBR, fail, toast, MESES_CURTO } from '../lib/ui.js';
import { TIPOS_DOC, SITUACOES_SST } from '../lib/rh-docs.js';
import { periodos } from '../lib/rh-calc.js';

export const title = 'Meu Portal';
const ui = { tipo: 'todos' };
const SITF = { programada: 'Programada', paga: 'Paga' };

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  let D; try { D = await q(sb.rpc('portal_meus_dados', { p_empresa: state.empresa.id })); }
  catch (err) { root.innerHTML = `<div class="card"><div class="empty">${/portal_meus/.test(err.message || '') ? 'O portal precisa do SQL 145.' : 'Não foi possível abrir o portal.'}</div></div>`; return; }
  if (!D.ligado) { root.innerHTML = '<div class="card"><div class="empty">Seu usuário ainda não está ligado ao seu cadastro de colaborador. Peça ao RH para fazer a ligação.</div></div>'; return; }
  if (!D.ativo) { root.innerHTML = '<div class="card"><div class="empty">O portal do colaborador está desligado pela empresa.</div></div>'; return; }
  const C = D.colaborador, docs = D.documentos || [], novos = docs.filter(d => !d.visto_em).length;
  const P = C.admissao ? periodos(C.admissao, new Date().toISOString().slice(0, 10), (D.ferias || []).map(f => ({ ...f, situacao: f.situacao }))) : [];
  const saldo = P.filter(p => p.completo && p.saldo > 0);
  const tipos = [...new Set(docs.map(d => d.tipo))];
  const V = ui.tipo === 'todos' ? docs : docs.filter(d => d.tipo === ui.tipo);
  root.innerHTML = `<div class="card" style="margin-bottom:12px"><h2 style="margin:0">Olá, ${esc(C.nome.split(' ')[0])}</h2>
      <p class="small muted" style="margin:4px 0 0">${esc(C.cargo || '')}${C.setor ? ' · ' + esc(C.setor) : ''}${C.matricula ? ' · matrícula ' + esc(C.matricula) : ''}${C.admissao ? ' · desde ' + dateBR(C.admissao) : ''}</p>
      ${D.mensagem ? `<p style="margin:8px 0 0">${esc(D.mensagem)}</p>` : ''}</div>
    <div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Documentos</div><div class="k-value">${docs.length}</div><div class="k-sub">${novos ? `<span class="warn">${novos} novo(s)</span>` : 'todos vistos'}</div></div>
      ${D.ferias ? `<div class="kpi"><div class="k-label">Férias a tirar</div><div class="k-value">${saldo.reduce((s, p) => s + p.saldo, 0)} dia(s)</div><div class="k-sub">${saldo[0] ? 'tirar até ' + dateBR(saldo[0].limite) : 'nenhum período completo'}</div></div>` : ''}
      ${D.sst ? `<div class="kpi"><div class="k-label">Exames e treinamentos</div><div class="k-value">${D.sst.filter(x => ['vencido', 'a_vencer'].includes(x.situacao) || (x.situacao === 'pendente' && x.obrigatorio)).length}</div><div class="k-sub">precisam de atenção</div></div>` : ''}</div>
    <div class="card flush"><div class="card-head" style="padding:12px 12px 0"><h2 style="margin:0">Meus documentos</h2>
      <div class="chips" id="po-t">${[['todos', 'Todos'], ...tipos.map(t => [t, TIPOS_DOC[t] || t])].map(([k, t]) => `<span class="chip ${ui.tipo === k ? 'on' : ''}" data-t="${k}">${t}</span>`).join('')}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Documento</th><th>Referência</th><th>Enviado</th><th></th></tr></thead><tbody>
      ${V.map(d => `<tr><td>${esc(d.titulo)} ${d.visto_em ? '' : '<span class="badge aberto">novo</span>'}<div class="small muted">${TIPOS_DOC[d.tipo] || d.tipo}</div></td>
        <td>${d.competencia ? `${MESES_CURTO[+d.competencia.slice(5, 7) - 1]}/${d.competencia.slice(0, 4)}` : '–'}</td><td class="small">${dateBR(d.enviado_em)}</td>
        <td><button class="btn small" data-ab="${d.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum documento.</td></tr>'}</tbody></table></div></div>
    ${D.ferias ? `<div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><h2 style="margin:0">Minhas férias</h2></div><div class="table-wrap"><table><thead><tr><th>Período aquisitivo</th><th>Situação</th><th class="num">Dias a tirar</th><th>Tirar até</th></tr></thead><tbody>
      ${P.slice().reverse().map(p => `<tr><td>${dateBR(p.ini)} a ${dateBR(p.fim)}</td><td>${{ em_aquisicao: 'Em aquisição', a_gozar: 'Completo', vencido: '<span class="neg">Vencido</span>', quitado: 'Sem saldo (gozado ou programado)' }[p.situacao]}</td>
        <td class="num">${p.completo ? p.saldo : `${p.avos}/12 avos`}</td><td>${p.completo && p.saldo ? dateBR(p.limite) : '–'}</td></tr>`).join('')}
      ${(D.ferias || []).filter(f => f.situacao === 'programada').map(f => `<tr><td colspan="4"><b>Programadas:</b> saída em ${dateBR(f.gozo_ini)}, ${f.dias} dia(s)${f.abono_dias ? ` e ${f.abono_dias} vendido(s)` : ''} · pagamento em ${dateBR(f.pagamento)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    ${D.sst ? `<div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><h2 style="margin:0">Meus exames e treinamentos</h2></div><div class="table-wrap"><table><thead><tr><th>Exame ou treinamento</th><th>Feito em</th><th>Vence em</th><th>Situação</th></tr></thead><tbody>
      ${D.sst.map(x => { const [t, cl] = SITUACOES_SST[x.situacao] || ['', '']; return `<tr><td>${esc(x.tipo)}</td><td>${x.realizado_em ? dateBR(x.realizado_em) : '–'}</td><td>${x.vence_em ? dateBR(x.vence_em) : x.realizado_em ? 'não vence' : '–'}</td><td><span class="${cl}">${t}</span></td></tr>`; }).join('')
        || '<tr><td colspan="4" class="empty">Nada registrado.</td></tr>'}</tbody></table></div></div>` : ''}
    <p class="small muted">Dúvidas sobre os valores do holerite ou das férias: fale com o RH. Os períodos de férias não consideram afastamentos e faltas.</p>`;
  $('#po-t', root).onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (t) { ui.tipo = t; render(root); } };
  $$('[data-ab]', root).forEach(b => b.onclick = async () => {
    const d = docs.find(x => x.id === b.dataset.ab);
    try {
      const { data, error } = await sb.storage.from('rh-docs').createSignedUrl(d.path, 120); if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener');
      if (!d.visto_em) { await q(sb.rpc('portal_doc_visto', { p_doc: d.id })); d.visto_em = new Date().toISOString(); b.closest('tr').querySelector('.badge')?.remove(); }
    } catch (err) { fail(err); }
  });
  if (novos) toast(`${novos} documento(s) novo(s) no seu portal`);
}

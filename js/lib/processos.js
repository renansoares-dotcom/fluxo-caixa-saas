// Regras da tela Gestão de Processos (PAI016, SQL 196) sem DOM: situação do POP, pendências de cada pessoa e o texto do POP.

const escPad = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const mesesTxt = (n) => (n % 12 === 0 ? `${n / 12} ano${n / 12 > 1 ? 's' : ''}` : `${n} ${n > 1 ? 'meses' : 'mês'}`);

/** situação do POP para a lista: { k, html } */
export function situacaoPop(pp, versoes) {
  const V = versoes || [], aberta = V.find(v => ['rascunho', 'em_aprovacao'].includes(v.situacao)), vg = V.find(v => v.situacao === 'vigente');
  if (!pp.ativo) return { k: 'obsoleto', html: '<span class="badge">obsoleto</span>' };
  const partes = [];
  if (vg) partes.push(`<span class="badge pago">v${vg.versao} em vigor</span>`);
  if (aberta) partes.push(aberta.situacao === 'em_aprovacao' ? `<span class="badge negoc">v${aberta.versao} em aprovação</span>`
    : `<span class="badge ${aberta.recusa_motivo ? 'vencido' : ''}">v${aberta.versao} ${aberta.recusa_motivo ? 'recusada' : 'rascunho'}</span>`);
  return { k: vg ? 'vigente' : aberta?.situacao || 'rascunho', html: partes.join(' ') };
}

/**
 * o que está pendente para a pessoa: aprovar, ler, revisar e os rascunhos dela.
 * @param {object} o { eu, papel, diretoria, pops, versoes, procs, lidas: Set(versao_id), hoje 'AAAA-MM-DD', avisoDias, autoaprovacao }
 */
export function pendenciasPop(o) {
  const proc = Object.fromEntries((o.procs || []).map(p => [p.id, p])), pop = Object.fromEntries((o.pops || []).map(p => [p.id, p]));
  const lim = new Date(o.hoje + 'T12:00:00'); lim.setDate(lim.getDate() + (o.avisoDias ?? 30)); const ate = lim.toISOString().slice(0, 10);
  const R = { aprovar: [], ler: [], revisar: [], rascunhos: [] };
  for (const v of o.versoes || []) {
    const pp = pop[v.pop_id]; if (!pp) continue; const x = proc[pp.processo_id] || {};
    if (v.situacao === 'em_aprovacao' && (v.elaborado_por !== o.eu || o.autoaprovacao)) {
      const meu = v.fase === 1 && v.aprovador_tipo === 'dono' ? x.dono_id === o.eu : o.diretoria && !(v.fase === 2 && v.aprovado_por === o.eu);
      if (meu) R.aprovar.push({ pop: pp, versao: v });
    }
    if (v.situacao === 'vigente' && pp.ativo && !o.lidas?.has(v.id) && ((v.publico || []).includes(o.papel) || (v.leitores || []).includes(o.eu))) R.ler.push({ pop: pp, versao: v });
    if (v.situacao === 'rascunho' && v.elaborado_por === o.eu) R.rascunhos.push({ pop: pp, versao: v });
    if (v.situacao === 'vigente' && pp.ativo && pp.revisar_em && pp.revisar_em <= ate && (x.dono_id === o.eu || v.elaborado_por === o.eu)
      && !(o.versoes || []).some(y => y.pop_id === pp.id && ['rascunho', 'em_aprovacao'].includes(y.situacao))) R.revisar.push({ pop: pp, versao: v });
  }
  R.revisar.sort((a, b) => a.pop.revisar_em.localeCompare(b.pop.revisar_em));
  return R;
}

/** o corpo do POP (seções numeradas), em HTML; `tela(rota)` devolve o nome da tela */
export function textoPop(v, etapas, { esc = escPad, tela = (r) => r, numerar = false } = {}) {
  const par = (t) => esc(t).replace(/\n/g, '<br>');
  const S = [['objetivo', 'Objetivo'], ['aplicacao', 'Aplicação'], ['responsabilidades', 'Responsabilidades'], ['materiais', 'Materiais, equipamentos e EPI'],
    ['procedimento', 'Procedimento'], ['registros', 'Registros'], ['referencias', 'Referências']].filter(([k]) => String(v[k] || '').trim());
  const et = (etapas || []).filter(e => (v.etapas || []).includes(e.n));
  let k = 0;
  const h = (t) => `<h${numerar ? 2 : 3} style="${numerar ? '' : 'margin:12px 0 4px'}">${++k}. ${t}</h${numerar ? 2 : 3}>`;
  return S.map(([c, t]) => `${h(t)}<p style="margin:0">${par(v[c])}</p>`).join('')
    + (et.length ? `${h('Etapas do processo')}<ul style="margin:0">${et.map(e => `<li>${e.n}. ${esc(e.o_que)} — ${esc(e.responsavel)}${e.tela ? ` (${esc(tela(e.tela))})` : ''}</li>`).join('')}</ul>` : '')
    || '<p class="muted">Rascunho sem conteúdo.</p>';
}

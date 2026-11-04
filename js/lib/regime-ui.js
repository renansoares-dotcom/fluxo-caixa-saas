// Cadastros › Empresa › aba "Regime tributário" (SQL 078). Todos os membros veem; só o administrador grava.
// Uma linha por vigência: mudar de regime, sair do sublimite ou mudar a opção do IBS/CBS = nova vigência (o histórico fica).
import { sb, state, q, isAdmin } from './data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, dateBR, today } from './ui.js';
import * as R from './regime.js';

export async function pintarTributacao(corpo) {
  corpo.innerHTML = '<div class="loading">Carregando…</div>';
  const lista = await R.carregarRegimes(state.empresa.id, true);
  if (R.semTabelaRegime()) { corpo.innerHTML = '<div class="card"><div class="empty">O cadastro do regime tributário ainda não está disponível. Recarregue a página; se continuar, avise o administrador da plataforma.</div></div>'; return; }
  const pode = isAdmin(), atual = R.vigente(lista, today());
  const ord = [...lista].sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio));
  corpo.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3 style="margin:0">Regime vigente hoje</h3>
        <div class="${atual ? '' : 'neg'}" style="margin-top:4px;font-weight:600">${esc(R.descricao(atual))}</div>
        ${atual ? `<div class="small muted">Desde ${dateBR(atual.vigencia_inicio)}${atual.fonte ? ' · fonte: ' + esc(atual.fonte) : ''}</div>` : '<div class="small muted">Sem o regime, a apuração de impostos, o simulador da reforma e o RH não sabem qual regra aplicar.</div>'}</div>
        ${pode ? '<button class="btn primary small" id="rt-nova">+ Nova vigência</button>' : ''}</div>
      ${atual?.regime === 'simples' ? atividades(atual) : ''}
    </div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><h3 style="margin:0">Histórico de vigências</h3></div>
      ${ord.length ? `<div class="table-wrap"><table><thead><tr><th>Início</th><th>Até</th><th>Regime</th><th>UF</th><th>Contabilidade</th><th>Fonte</th><th></th></tr></thead><tbody>
        ${ord.map(r => { const p = R.proxima(lista, r); return `<tr data-id="${r.id}"><td class="nowrap">${dateBR(r.vigencia_inicio)}</td>
          <td class="nowrap">${p ? dateBR(diaAntes(p.vigencia_inicio)) : '—'}${r === atual ? ' <span class="badge pago">atual</span>' : r.vigencia_inicio > today() ? ' <span class="badge negoc">futura</span>' : ''}</td>
          <td>${esc(R.descricao(r))}</td><td>${esc(r.uf || '')}</td><td class="small">${esc(r.contabilidade || '')}</td><td class="small muted">${esc(r.fonte || '')}</td>
          <td class="nowrap">${pode ? `<button class="btn ghost small" data-ed="${r.id}">Editar</button><button class="btn ghost small" data-rm="${r.id}">✕</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="small muted" style="padding:0 12px 12px">Nenhuma vigência cadastrada.</p>'}
    </div>
    <p class="small muted">Cada mudança vira uma vigência nova, com data de início: mudança de regime, entrada ou saída do sublimite (ICMS/ISS fora do DAS) e a opção semestral do Simples pelo IBS/CBS no regime regular (LC 214/2025). Os cálculos usam a vigência da data de cada operação.</p>`;
  $('#rt-nova', corpo)?.addEventListener('click', () => editar(corpo, atual ? { ...atual, id: null, vigencia_inicio: '', fonte: '' } : null));
  $$('[data-ed]', corpo).forEach(b => b.onclick = () => editar(corpo, lista.find(x => x.id === b.dataset.ed)));
  $$('[data-rm]', corpo).forEach(b => b.onclick = async () => {
    const r = lista.find(x => x.id === b.dataset.rm);
    if (!await confirmDialog(`Excluir a vigência de ${dateBR(r.vigencia_inicio)} (${R.descricao(r)})? A exclusão fica na auditoria.`)) return;
    try { await q(sb.from('empresa_tributacao').delete().eq('id', r.id)); toast('Vigência excluída'); pintarTributacao(corpo); } catch (e) { fail(e); }
  });
}

const diaAntes = (d) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

function atividades(r) {
  const at = r.simples_atividades || [];
  if (!at.length) return '<p class="small neg" style="margin-bottom:0">Nenhuma atividade com anexo cadastrada: o cálculo do DAS depende dela.</p>';
  return `<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>CNAE</th><th>Atividade</th><th>Anexo</th><th>Fator R</th></tr></thead><tbody>
    ${at.map(a => `<tr><td class="nowrap">${esc(a.cnae || '—')}</td><td>${esc(a.descricao || '')}</td><td>${esc(a.anexo || '—')}</td><td>${a.fator_r ? 'sim' : 'não'}</td></tr>`).join('')}</tbody></table></div>`;
}

/** campos do regime (reaproveitado na criação de empresa); devolve { el, valor() } */
export function camposRegime(host, r0 = {}) {
  const r = { regime: '', vigencia_inicio: '', simples_atividades: [], ...r0 };
  const opt = (obj, v) => Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(typeof t === 'string' ? t : t.t)}</option>`).join('');
  host.innerHTML = `
    <div class="grid2"><label>Regime *<select data-r="regime"><option value="">—</option>${opt(R.REGIMES, r.regime)}</select></label>
      <label>Início da vigência *<input type="date" data-r="vigencia_inicio" value="${esc(r.vigencia_inicio || '')}"></label></div>
    <div data-so="lr" class="grid2"><label>PIS/COFINS<select data-r="pis_cofins"><option value="">—</option>${opt(R.PIS_COFINS, r.pis_cofins)}</select></label>
      <label>Apuração do IRPJ/CSLL<select data-r="irpj_apuracao"><option value="">—</option>${opt(R.IRPJ, r.irpj_apuracao)}</select></label></div>
    <div data-so="simples">
      <h4 style="margin:10px 0 4px">Atividades e anexos</h4>
      <div data-at></div><button type="button" class="btn ghost small" data-at-add>+ Atividade</button>
      <label class="chk" style="margin-top:8px"><input type="checkbox" data-r="sublimite_excedido" ${r.sublimite_excedido ? 'checked' : ''}> Receita acima do sublimite (R$ 3,6 mi): ICMS e ISS recolhidos fora do DAS</label>
      <label class="chk"><input type="checkbox" data-r="ibscbs_regular" ${r.ibscbs_regular ? 'checked' : ''}> IBS e CBS pelo regime regular (fora do DAS) neste período</label>
    </div>
    <div class="grid2"><label>UF<input data-r="uf" maxlength="2" value="${esc(r.uf || '')}" style="text-transform:uppercase"></label>
      <label>Município (código IBGE)<input data-r="municipio_ibge" value="${esc(r.municipio_ibge || '')}" placeholder="ex.: 2604106"></label>
      <label>CNAE principal<input data-r="cnae_principal" value="${esc(r.cnae_principal || '')}" placeholder="0000-0/00"></label>
      <label>Incentivos fiscais<input data-r="incentivos" value="${esc(r.incentivos || '')}" placeholder="ex.: PRODEPE"></label>
      <label>Contabilidade<input data-r="contabilidade" value="${esc(r.contabilidade || '')}"></label>
      <label>Fonte da informação<input data-r="fonte" value="${esc(r.fonte || '')}" placeholder="ex.: cartão CNPJ e contabilidade"></label></div>
    <label>Observação<input data-r="observacao" value="${esc(r.observacao || '')}"></label>
    <div data-msg class="small"></div>`;
  const at = [...(r.simples_atividades || [])];
  const pintarAt = () => {
    $('[data-at]', host).innerHTML = at.length ? at.map((a, i) => `<div class="grid2" style="grid-template-columns:130px 1fr 1.4fr 90px 32px;align-items:end">
      <label>CNAE<input data-a="${i}.cnae" value="${esc(a.cnae || '')}" placeholder="0000-0/00"></label>
      <label>Descrição<input data-a="${i}.descricao" value="${esc(a.descricao || '')}"></label>
      <label>Anexo<select data-a="${i}.anexo"><option value="">—</option>${Object.entries(R.ANEXOS).map(([k, t]) => `<option value="${k}" ${k === a.anexo ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" data-a="${i}.fator_r" ${a.fator_r ? 'checked' : ''}> Fator R</label>
      <button type="button" class="btn ghost small" data-at-rm="${i}">✕</button></div>`).join('') : '<p class="small muted" style="margin:0">Nenhuma atividade.</p>';
  };
  const ver = () => { const g = $('[data-r=regime]', host).value; host.querySelector('[data-so=lr]').hidden = !['presumido', 'real'].includes(g); host.querySelector('[data-so=simples]').hidden = g !== 'simples'; };
  pintarAt(); ver();
  host.addEventListener('change', (e) => {
    if (e.target.dataset.r === 'regime') ver();
    const a = e.target.dataset.a; if (a) { const [i, k] = a.split('.'); at[+i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; }
  });
  host.addEventListener('input', (e) => { const a = e.target.dataset.a; if (a && e.target.type !== 'checkbox') { const [i, k] = a.split('.'); at[+i][k] = e.target.value; } });
  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-at-add]')) { at.push({ cnae: '', descricao: '', anexo: '', fator_r: false }); pintarAt(); }
    const rm = e.target.closest('[data-at-rm]'); if (rm) { at.splice(+rm.dataset.atRm, 1); pintarAt(); }
  });
  const valor = () => {
    const v = { simples_atividades: at };
    $$('[data-r]', host).forEach(el => { v[el.dataset.r] = el.type === 'checkbox' ? el.checked : el.value; });
    return v;
  };
  const mostrar = (c) => { $('[data-msg]', host).innerHTML = [...c.erros.map(t => `<div class="neg">• ${esc(t)}</div>`), ...c.avisos.map(t => `<div class="muted">• ${esc(t)}</div>`)].join(''); };
  return { valor, mostrar };
}

function editar(corpo, r) {
  const m = modal({ title: r?.id ? `Vigência de ${dateBR(r.vigencia_inicio)}` : 'Nova vigência do regime tributário', wide: true,
    body: '<div id="rt-campos" class="form"></div>', foot: '<button class="btn primary" id="rt-ok">Salvar</button>',
    onMount: (el, close) => {
      const f = camposRegime($('#rt-campos', el), r || {});
      $('#rt-ok', el).onclick = async () => {
        const v = f.valor(), c = R.conferir(v); f.mostrar(c);
        if (c.erros.length) return;
        const row = R.normalizar(v, state.empresa.id);
        try {
          if (r?.id) await q(sb.from('empresa_tributacao').update(row).eq('id', r.id));
          else await q(sb.from('empresa_tributacao').insert(row));
          close(); toast('Regime tributário salvo'); pintarTributacao(corpo);
        } catch (e) { fail(/duplicate key/.test(e?.message || '') ? new Error('Já existe uma vigência com esse início. Edite a existente.') : e); }
      };
    } });
  return m;
}

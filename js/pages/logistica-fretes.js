// Logística › Fretes e CIOT (SQL 054): ficha de cada frete contratado, cadastro de transportadores, piso mínimo da ANTT,
// conformidade do mês (fretes pagos sem ficha, pelo caixa, a pessoa física) e relatório para imprimir.
// Autônomo: pagamento só é liberado sem pendências (trava no banco). Transportadora: CIOT/MDF-e/piso viram aviso.
import { sb, state, q, fetchAll, loadCadastros } from '../lib/data.js';
import { $, $$, esc, money, dateBR, toast, fail, modal, confirmDialog, options, today, logoPNG } from '../lib/ui.js';
import { podeLogistica } from '../lib/logistica.js';
import { inp, num } from '../lib/compras.js';
import { TIPOS_TRANSP, TIPO_CURTO, ehAutonomo, TIPOS_ANEXO, VINCULO, calcPiso, coefDe, pendencias, pendenciasTransp, tipoPeloDoc, lerVeiculos, veiculosTxt } from '../lib/fretes.js';

export const title = 'Logística — fretes e CIOT';
const ui = { aba: 'fretes', mes: today().slice(0, 7), busca: '' };
const PLANO_FRETE = '2.06.01';
const MOTIVOS = { relacao_encerrada: 'Relação encerrada (histórico)', contratado_terceiro: 'Contratado por terceiro (CT-e em nome da IPLAMM)', nao_e_frete: 'Não é frete rodoviário', outro: 'Outro' };
const soDig = (s) => String(s || '').replace(/\D/g, '');
const fmtDoc = (d) => { d = soDig(d); return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let B = null;

async function carregar() {
  await loadCadastros();
  const e = state.empresa.id;
  const desde = new Date(); desde.setMonth(desde.getMonth() - 13);
  const [T, F, A, C, K] = await Promise.all([
    fetchAll(() => sb.from('log_transportadores').select('*').eq('empresa_id', e).order('nome')),
    fetchAll(() => sb.from('log_fretes').select('*').eq('empresa_id', e).gte('data', desde.toISOString().slice(0, 10)).order('data', { ascending: false }).order('numero', { ascending: false })),
    fetchAll(() => sb.from('log_frete_anexos').select('*').eq('empresa_id', e).order('enviado_em')),
    q(sb.from('log_piso_coef').select('*').eq('empresa_id', e).order('tabela').order('tipo_carga').order('eixos').order('vigencia', { ascending: false })),
    q(sb.from('log_cargas').select('id,numero,data,status,veiculo_id').eq('empresa_id', e).gte('data', desde.toISOString().slice(0, 10)).order('data', { ascending: false }).limit(300)).catch(() => []),
  ]);
  const ids = F.map(f => f.lancamento_id).filter(Boolean);
  const L = new Map();
  for (let i = 0; i < ids.length; i += 150) for (const l of await q(sb.from('lancamentos').select('id,status,data,valor,conta_id').in('id', ids.slice(i, i + 150)))) L.set(l.id, l);
  B = { T, F, A, C, K, L, tById: Object.fromEntries(T.map(t => [t.id, t])), plano: state.cad.contasPlano.find(p => p.codigo === PLANO_FRETE) };
  return B;
}
const anexosDe = (f) => B.A.filter(a => (f.id && a.frete_id === f.id) || (a.transportador_id && a.transportador_id === f.transportador_id && a.tipo === 'contrato'));
const pendDe = (f) => pendencias(f, B.tById[f.transportador_id], B.A);
function situacao(f) {
  const l = B.L.get(f.lancamento_id), p = pendDe(f), t = B.tById[f.transportador_id];
  if (f.status === 'cancelado') return '<span class="badge">Cancelado</span>';
  const pago = l?.status === 'Pago';
  if (!p.length) return `<span class="badge pago">${pago ? 'Pago · conforme' : 'Conforme'}</span>`;
  const cls = ehAutonomo(t) ? 'vencido' : 'aberto';
  return `<span class="badge ${cls}">${pago ? 'Pago com pendência' : ehAutonomo(t) ? 'Bloqueado para pagar' : 'Aviso'}</span><div class="small muted">${esc(p.join(', '))}</div>`;
}

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Fretes e CIOT</h2><div class="muted small">Conformidade ANTT dos fretes contratados: CIOT, MDF-e, piso mínimo, vale-pedágio e pagamento ao autônomo pela IPEF.</div></div>
      <a class="btn ghost" href="#/logistica">Cargas e entregas</a></div>
    <div class="card toolbar"><div class="chips" id="lf-abas">${[['fretes', 'Fretes'], ['transp', 'Transportadores'], ['conf', 'Conformidade do mês'], ['piso', 'Piso mínimo']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div id="lf-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#lf-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  try { await carregar(); } catch (err) { console.error(err); $('#lf-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Se a migração <b>20261028000054_fretes_ciot.sql</b> ainda não rodou, rode-a no SQL Editor do Supabase.</div></div>'; return; }
  const corpo = $('#lf-corpo', root);
  try {
    if (ui.aba === 'transp') return transportadores(corpo, root);
    if (ui.aba === 'conf') return await conformidade(corpo, root);
    if (ui.aba === 'piso') return piso(corpo, root);
    return fretes(corpo, root);
  } catch (err) { fail(err); }
}

// ---------------------------------------------------------------- Fretes
function fretes(corpo, root) {
  const pode = podeLogistica();
  const doMes = B.F.filter(f => f.data.slice(0, 7) === ui.mes);
  const t = norm(ui.busca);
  const xs = doMes.filter(f => !t || norm(`${f.numero} ${B.tById[f.transportador_id]?.nome} ${f.origem} ${f.destino} ${f.ciot} ${f.notas}`).includes(t));
  const ativos = doMes.filter(f => f.status !== 'cancelado');
  const aut = ativos.filter(f => ehAutonomo(B.tById[f.transportador_id]));
  const bloq = aut.filter(f => pendDe(f).length), abaixo = ativos.filter(f => pendDe(f).includes('abaixo do piso mínimo'));
  const kpi = (r, v, s = '', c = '') => `<div class="kpi"><div class="k-label">${r}</div><div class="k-value ${c}">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  corpo.innerHTML = `<div class="kpis">${kpi('Fretes no mês', ativos.length, money(ativos.reduce((s, f) => s + (+f.valor || 0), 0)))}${kpi('Com autônomo', aut.length, 'CIOT gerado pela IPLAMM')}
      ${kpi('Autônomo com pendência', bloq.length, bloq.length ? 'pagamento travado' : 'nenhum', bloq.length ? 'neg' : '')}${kpi('Abaixo do piso', abaixo.length, abaixo.length ? 'risco de multa ao contratante' : 'nenhum', abaixo.length ? 'neg' : '')}</div>
    <div class="card toolbar" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <label class="small" style="display:flex;gap:6px;align-items:center">Mês <input type="month" id="ff-mes" value="${ui.mes}"></label>
      <input id="ff-busca" placeholder="Buscar nº, transportador, rota, CIOT, NF…" value="${esc(ui.busca)}" style="min-width:240px">
      ${pode ? '<button class="btn primary" id="ff-novo" style="margin-left:auto">Novo frete</button>' : ''}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Transportador</th><th>Rota</th><th class="num">Valor</th><th class="num">Piso</th><th>CIOT</th><th>MDF-e</th><th>Pagamento</th><th>Situação</th></tr></thead><tbody>
    ${xs.map(f => { const tr = B.tById[f.transportador_id], l = B.L.get(f.lancamento_id);
      return `<tr class="clickable" data-id="${f.id}"><td><b>${f.numero}</b></td><td>${dateBR(f.data)}</td><td>${esc(tr?.nome || '—')}<div class="small muted">${TIPO_CURTO[tr?.tipo] || ''}</div></td>
        <td class="small">${esc(f.origem || '')}${f.destino ? ` → ${esc(f.destino)}` : ''}${f.km ? `<div class="muted">${(+f.km).toLocaleString('pt-BR')} km · ${f.eixos || '?'} eixos</div>` : ''}</td>
        <td class="num">${money(f.valor)}</td><td class="num ${f.piso != null && +f.valor < +f.piso - 0.005 ? 'neg' : ''}">${f.piso != null ? money(f.piso) : '<span class="muted">—</span>'}</td>
        <td class="small">${esc(f.ciot || '') || '<span class="muted">—</span>'}</td><td class="small">${f.mdfe_chave ? '✓' : '<span class="muted">—</span>'}</td>
        <td class="small">${l ? `${l.status === 'Pago' ? 'pago' : 'programado'} ${dateBR(l.data)}` : '<span class="muted">—</span>'}</td><td>${situacao(f)}</td></tr>`; }).join('')
      || '<tr><td colspan="10" class="empty">Nenhum frete neste mês.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Autônomo (TAC, equiparado ou cooperativa): o pagamento só passa para "Pago" com CIOT, MDF-e, contrato, RNTRC, conta indicada pelo autônomo, vale-pedágio e valor ≥ piso. Transportadora: as mesmas faltas aparecem como aviso.</p>`;
  $('#ff-mes', corpo).onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; fretes(corpo, root); } };
  $('#ff-busca', corpo).oninput = (e) => { ui.busca = e.target.value; clearTimeout(ui.tb); ui.tb = setTimeout(() => { fretes(corpo, root); const i = $('#ff-busca', corpo); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
  $('#ff-novo', corpo) && ($('#ff-novo', corpo).onclick = () => ficha(null, root));
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => ficha(B.F.find(f => f.id === tr.dataset.id), root));
}

async function enviar(arqs, base, extra) {
  for (const f of arqs) {
    if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name}: maior que 10 MB`);
    const path = `${state.empresa.id}/${base}/${Date.now()}-${f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80)}`;
    const up = await sb.storage.from('logistica').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
    if (up.error) throw up.error;
    await q(sb.from('log_frete_anexos').insert({ empresa_id: state.empresa.id, path, nome: f.name.slice(0, 200), enviado_por: state.user?.email || null, ...extra }));
  }
}
async function abrirArq(path) {
  const w = window.open('', '_blank');
  try { const { data, error } = await sb.storage.from('logistica').createSignedUrl(path, 300); if (error) throw error; if (w) w.location = data.signedUrl; else location.href = data.signedUrl; }
  catch (e) { if (w) w.close(); fail(e); }
}
const listaAnexos = (lista, pode) => lista.map(a => `<div class="small" style="display:flex;gap:6px;align-items:center;margin:2px 0"><button type="button" class="btn ghost small" data-ver="${esc(a.path)}">📎 ${esc(a.nome || 'arquivo')}</button>
  <span class="muted">${TIPOS_ANEXO[a.tipo] || a.tipo}${a.transportador_id && !a.frete_id ? ' (do transportador)' : ''} · ${dateBR(a.enviado_em)}</span>${pode ? `<button type="button" class="btn ghost small" data-del="${a.id}" title="Excluir">✕</button>` : ''}</div>`).join('') || '<span class="small muted">Nenhum anexo.</span>';

function ficha(f0, root, pre = {}) {
  const pode = podeLogistica(), dis = pode ? '' : 'disabled';
  const f = f0 || { data: today(), lotacao: true, tabela: 'A', tipo_carga: 'geral', pedagio_nao_ha: false, ...pre };
  const tipos = [...new Set(B.C.map(c => `${c.tabela}|${c.tipo_carga}`))];
  const cargas = B.K.filter(k => k.status !== 'cancelada');
  const l = B.L.get(f.lancamento_id);
  const md = modal({ title: f0 ? `Frete nº ${f0.numero}` : 'Novo frete contratado', wide: true, body: `
    <div class="grid2">
      <label class="grow">Transportador *<select id="fr-t" ${dis} data-nobusca><option value="">— escolha —</option>${B.T.filter(t => t.ativo || t.id === f.transportador_id).map(t => `<option value="${t.id}" ${t.id === f.transportador_id ? 'selected' : ''}>${esc(t.nome)} · ${TIPO_CURTO[t.tipo]}</option>`).join('')}</select>
        ${pode ? '<a href="#" id="fr-novo-t" class="small">+ cadastrar transportador</a>' : ''}</label>
      <label>Data da viagem *<input type="date" id="fr-d" value="${f.data}" ${dis}></label>
      <label>Carga da logística<select id="fr-k" ${dis} data-nobusca><option value="">—</option>${cargas.map(k => `<option value="${k.id}" ${k.id === f.carga_id ? 'selected' : ''}>Carga ${k.numero} · ${dateBR(k.data)}</option>`).join('')}</select></label>
      <label class="grow">NF-e transportadas<input id="fr-n" value="${esc(f.notas || '')}" placeholder="36435, 36440" ${dis}></label>
      <label>Origem<input id="fr-o" value="${esc(f.origem || 'Caruaru/PE')}" ${dis}></label>
      <label>Destino<input id="fr-de" value="${esc(f.destino || '')}" placeholder="cidade/UF" ${dis}></label>
      <label>Distância (km, ida) *<input id="fr-km" value="${inp(f.km)}" ${dis}></label>
      <label>Eixos carregados *<select id="fr-e" ${dis} data-nobusca><option value="">—</option>${[2, 3, 4, 5, 6, 7, 9].map(e => `<option ${+f.eixos === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      <label>Tabela / tipo de carga<select id="fr-tc" ${dis} data-nobusca>${tipos.map(x => { const [tb, tc] = x.split('|'); return `<option value="${x}" ${f.tabela === tb && f.tipo_carga === tc ? 'selected' : ''}>Tabela ${tb} · ${esc(tc)}</option>`; }).join('') || '<option value="A|geral">Tabela A · geral</option>'}</select></label>
      <label class="chk"><input type="checkbox" id="fr-lot" ${f.lotacao ? 'checked' : ''} ${dis}> Carga lotação (o piso se aplica)</label>
      <label class="chk"><input type="checkbox" id="fr-rv" ${f.retorno_vazio ? 'checked' : ''} ${dis}> Retorno vazio obrigatório</label>
      <label>Km de retorno<input id="fr-kr" value="${inp(f.km_retorno)}" ${dis}></label>
      <label>Valor do frete (R$) *<input id="fr-v" value="${inp(f.valor)}" ${dis}></label>
      <div class="span2 small" id="fr-piso"></div>
      <label>Placa<input id="fr-pl" value="${esc(f.placa || '')}" list="fr-placas" ${dis}><datalist id="fr-placas"></datalist></label>
      <label>Motorista<input id="fr-mo" value="${esc(f.motorista || '')}" ${dis}></label>
      <label>CIOT<input id="fr-ci" value="${esc(f.ciot || '')}" placeholder="nº gerado pela IPEF / transportadora" ${dis}></label>
      <label>CIOT gerado por<select id="fr-cp" ${dis} data-nobusca><option value="">—</option><option value="iplamm" ${f.ciot_por === 'iplamm' ? 'selected' : ''}>IPLAMM (IPEF)</option><option value="transportadora" ${f.ciot_por === 'transportadora' ? 'selected' : ''}>Transportadora</option></select></label>
      <label class="grow">Chave do MDF-e<input id="fr-mdf" value="${esc(f.mdfe_chave || '')}" placeholder="44 dígitos" ${dis}></label>
      <label class="grow">Chave do CT-e (transportadora)<input id="fr-cte" value="${esc(f.cte_chave || '')}" ${dis}></label>
      <label>Vale-pedágio (R$)<input id="fr-pv" value="${inp(f.pedagio_valor)}" ${dis}></label>
      <label>Comprovante do vale-pedágio<input id="fr-pc" value="${esc(f.pedagio_comprovante || '')}" ${dis}></label>
      <label class="chk"><input type="checkbox" id="fr-pn" ${f.pedagio_nao_ha ? 'checked' : ''} ${dis}> Rota sem pedágio</label>
      <label class="span2">Observação<input id="fr-obs" value="${esc(f.observacao || '')}" ${dis}></label>
    </div>
    <div id="fr-pend" style="margin-top:10px"></div>
    <h3 style="margin:14px 0 6px">Pagamento</h3>
    <div id="fr-pag" class="small">${l ? `Lançamento ${l.status === 'Pago' ? '<b>pago</b>' : 'programado'} em ${dateBR(l.data)} · ${money(l.valor)} · ${esc(state.cad.contaById[l.conta_id]?.nome || '')}` : 'Sem lançamento ligado.'}</div>
    ${f0 ? `<h3 style="margin:14px 0 6px">Anexos</h3><div id="fr-anx">${listaAnexos(anexosDe(f0), pode)}</div>
      ${pode ? `<div class="grid2" style="margin-top:6px;align-items:end"><label class="grow">Arquivos<br><input type="file" id="fr-arq" multiple accept="application/pdf,image/*,.xml"></label>
        <label>Tipo<select id="fr-at" data-nobusca>${Object.entries(TIPOS_ANEXO).filter(([k]) => k !== 'contrato' || true).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label><button type="button" class="btn" id="fr-env">Anexar</button></div>` : ''}` : '<p class="small muted">Salve a ficha para anexar CIOT, MDF-e, CT-e, contrato e comprovantes.</p>'}`,
    foot: pode ? `${f0 && f0.status !== 'cancelado' && !(l?.status === 'Pago') ? '<button class="btn danger" id="fr-canc" style="margin-right:auto">Cancelar frete</button>' : ''}
      ${f0 && !f0.lancamento_id && f0.status !== 'cancelado' ? '<button class="btn" id="fr-prog">Programar pagamento</button><button class="btn" id="fr-lig">Ligar a lançamento</button>' : ''}
      <button class="btn" data-close>Fechar</button><button class="btn primary" id="fr-ok">Salvar</button>` : '<button class="btn" data-close>Fechar</button>' });
  const g = (id) => $('#' + id, md.el);
  const ler = () => { const [tb, tc] = (g('fr-tc').value || 'A|geral').split('|'); const n = (id) => { const s = g(id).value.trim(); return s ? num(s) : null; };
    return { transportador_id: g('fr-t').value || null, data: g('fr-d').value, carga_id: g('fr-k').value || null, notas: g('fr-n').value.trim() || null, origem: g('fr-o').value.trim() || null,
      destino: g('fr-de').value.trim() || null, km: n('fr-km'), eixos: +g('fr-e').value || null, tabela: tb, tipo_carga: tc, lotacao: g('fr-lot').checked, retorno_vazio: g('fr-rv').checked,
      km_retorno: n('fr-kr'), valor: n('fr-v'), placa: g('fr-pl').value.trim().toUpperCase() || null, motorista: g('fr-mo').value.trim() || null, ciot: soDig(g('fr-ci').value) || g('fr-ci').value.trim() || null,
      ciot_por: g('fr-cp').value || null, mdfe_chave: soDig(g('fr-mdf').value) || null, cte_chave: soDig(g('fr-cte').value) || null, pedagio_valor: n('fr-pv'), pedagio_comprovante: g('fr-pc').value.trim() || null,
      pedagio_nao_ha: g('fr-pn').checked, observacao: g('fr-obs').value.trim() || null }; };
  const atualizar = () => {
    const x = { ...f, ...ler() }; x.piso = calcPiso(x, B.C);
    const t = B.tById[x.transportador_id], c = coefDe(B.C, x, x.data);
    g('fr-placas').innerHTML = (t?.veiculos || []).map(v => `<option value="${esc(v.placa)}">${v.eixos ? v.eixos + ' eixos' : ''}</option>`).join('');
    g('fr-piso').innerHTML = !x.lotacao ? '<span class="small muted">Carga fracionada: o piso mínimo não se aplica.</span>'
      : x.piso == null ? `<span class="small muted">Piso: informe km e eixos${x.eixos && !c ? ' (sem coeficiente para esses eixos na tabela)' : ''}.</span>`
      : `<span class="small">Piso mínimo: <b>${money(x.piso)}</b> = ${(+x.km).toLocaleString('pt-BR')} km × ${(+c.ccd).toLocaleString('pt-BR', { minimumFractionDigits: 4 })} + ${money(c.cc)}${x.retorno_vazio && +x.km_retorno ? ` + retorno 0,92 × CCD × ${x.km_retorno} km` : ''}
          ${x.valor != null ? (+x.valor < x.piso - 0.005 ? ` · <b class="neg">frete ${money(x.valor)} está ${money(x.piso - x.valor)} abaixo do piso</b>` : ' · <span class="pos">frete acima do piso</span>') : ''}</span>`;
    const p = pendencias(x, t, f0 ? B.A : B.A.filter(a => a.transportador_id === x.transportador_id));
    g('fr-pend').innerHTML = !t ? '' : p.length ? `<div class="${ehAutonomo(t) ? 'neg' : 'warn'} small"><b>${ehAutonomo(t) ? 'Pagamento travado (autônomo)' : 'Avisos'}:</b> falta ${esc(p.join(', '))}.</div>` : '<div class="pos small"><b>Conforme.</b></div>';
    if (ehAutonomo(t) && !g('fr-cp').value) g('fr-cp').value = 'iplamm';
    if (t && !ehAutonomo(t) && !g('fr-cp').value) g('fr-cp').value = 'transportadora';
    return x;
  };
  md.el.addEventListener('input', atualizar); md.el.addEventListener('change', atualizar); atualizar();
  g('fr-novo-t') && (g('fr-novo-t').onclick = (e) => { e.preventDefault(); editarTransp(null, root, async (novo) => { md.close(); await carregar(); ficha(f0 ? { ...f0, ...ler(), transportador_id: novo.id } : null, root, f0 ? {} : { ...ler(), transportador_id: novo.id }); }); });
  const salvar = async () => {
    const x = ler(); x.piso = calcPiso({ ...f, ...x }, B.C);
    if (!x.transportador_id) throw new Error('Escolha o transportador');
    if (!x.data) throw new Error('Informe a data');
    if (x.mdfe_chave && x.mdfe_chave.length !== 44) throw new Error('A chave do MDF-e tem 44 dígitos');
    if (f0) { await q(sb.from('log_fretes').update(x).eq('id', f0.id)); return f0.id; }
    const [r] = await q(sb.from('log_fretes').insert({ ...x, empresa_id: state.empresa.id, lancamento_id: pre.lancamento_id || null }).select('id'));
    return r.id;
  };
  g('fr-ok') && (g('fr-ok').onclick = async (ev) => { ev.target.disabled = true; try { await salvar(); md.close(); toast('Frete salvo'); render(root); } catch (err) { fail(err); ev.target.disabled = false; } });
  md.el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ver) return abrirArq(b.dataset.ver);
    if (b.dataset.del) { const a = B.A.find(x => x.id === b.dataset.del); if (!a || !await confirmDialog(`Excluir o anexo "${a.nome}"?`)) return;
      try { await q(sb.from('log_frete_anexos').delete().eq('id', a.id)); await sb.storage.from('logistica').remove([a.path]); B.A = B.A.filter(x => x.id !== a.id); g('fr-anx').innerHTML = listaAnexos(anexosDe(f0), pode); atualizar(); } catch (err) { fail(err); } return; }
    if (b.id === 'fr-env') { const arqs = [...g('fr-arq').files]; if (!arqs.length) return toast('Escolha os arquivos', true);
      b.disabled = true; try { await enviar(arqs, f0.id, { frete_id: f0.id, tipo: g('fr-at').value }); await carregar(); g('fr-anx').innerHTML = listaAnexos(anexosDe(f0), pode); g('fr-arq').value = ''; atualizar(); toast('Anexado'); }
      catch (err) { fail(/bucket|not found/i.test(err.message || '') ? new Error('Espaço de arquivos da logística não criado: rode a migração 054.') : err); } b.disabled = false; return; }
    if (b.id === 'fr-canc') { if (!await confirmDialog('Cancelar este frete? O lançamento programado em aberto, se houver, continua no fluxo — exclua lá se for o caso.')) return;
      try { await q(sb.from('log_fretes').update({ status: 'cancelado' }).eq('id', f0.id)); md.close(); render(root); } catch (err) { fail(err); } return; }
    if (b.id === 'fr-prog') { try { await salvar(); } catch (err) { return fail(err); } md.close(); await carregar(); return programar(B.F.find(x => x.id === f0.id), root); }
    if (b.id === 'fr-lig') { try { await salvar(); } catch (err) { return fail(err); } md.close(); await carregar(); return ligar(B.F.find(x => x.id === f0.id), root); }
  });
}

function programar(f, root) {
  const t = B.tById[f.transportador_id], p = pendDe(f);
  if (!B.plano) return toast(`Plano ${PLANO_FRETE} (fretes) não encontrado`, true);
  const md = modal({ title: `Programar pagamento — frete nº ${f.numero}`, body: `
    <p class="small muted" style="margin-top:0">${esc(t?.nome || '')} · ${money(f.valor)}. Cria o lançamento <b>Em aberto</b> no plano ${esc(B.plano.label)}; ele entra no fluxo e na autorização de pagamentos.
      ${ehAutonomo(t) ? '<br><b>Autônomo:</b> o pagamento deve sair pela IPEF que gerou o CIOT, na conta indicada pelo autônomo. O lançamento só pode ser baixado como pago sem pendências.' : ''}</p>
    ${p.length ? `<p class="${ehAutonomo(t) ? 'neg' : 'warn'} small">Pendências agora: ${esc(p.join(', '))}.</p>` : ''}
    <div class="grid2"><label>Vencimento<input type="date" id="pg-d" value="${f.data}"></label><label class="grow">Conta<select id="pg-c">${options(state.cad.contas, { empty: '—' })}</select></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pg-ok">Criar lançamento</button>' });
  $('#pg-ok', md.el).onclick = async (ev) => {
    if (!(+f.valor > 0)) return toast('Informe o valor do frete na ficha', true);
    ev.target.disabled = true;
    try {
      const [l] = await q(sb.from('lancamentos').insert({ empresa_id: state.empresa.id, data: $('#pg-d', md.el).value, plano_id: B.plano.id, conta_id: $('#pg-c', md.el).value || null, favorecido_id: t?.favorecido_id || null,
        valor: +f.valor, status: 'Em aberto', descricao: `Frete nº ${f.numero} — ${t?.nome || ''}${f.destino ? ' → ' + f.destino : ''}${f.ciot ? ' · CIOT ' + f.ciot : ''}`.slice(0, 250), documento: f.cte_chave ? `CT-e ${f.cte_chave.slice(25, 34)}` : `FRETE ${f.numero}`, origem: 'frete' }).select('id'));
      await q(sb.from('log_fretes').update({ lancamento_id: l.id }).eq('id', f.id));
      md.close(); toast('Pagamento programado'); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}
async function ligar(f, root) {
  const t = B.tById[f.transportador_id];
  const ja = new Set(B.F.map(x => x.lancamento_id).filter(Boolean));
  const d0 = new Date(f.data); d0.setDate(d0.getDate() - 45); const d1 = new Date(f.data); d1.setDate(d1.getDate() + 45);
  let ls = await q(sb.from('lancamentos').select('id,data,valor,status,descricao,favorecido_id,conta_id').eq('empresa_id', state.empresa.id).eq('plano_id', B.plano?.id)
    .gte('data', d0.toISOString().slice(0, 10)).lte('data', d1.toISOString().slice(0, 10)).order('data', { ascending: false }).limit(300));
  ls = ls.filter(l => !ja.has(l.id)).sort((a, b) => (b.favorecido_id === t?.favorecido_id) - (a.favorecido_id === t?.favorecido_id) || Math.abs(a.valor - f.valor) - Math.abs(b.valor - f.valor));
  const md = modal({ title: `Ligar o frete nº ${f.numero} a um lançamento`, wide: true, body: `<p class="small muted" style="margin-top:0">Lançamentos de fretes (${PLANO_FRETE}) de ±45 dias, sem ficha. Os do mesmo favorecido e valor mais próximo vêm primeiro.</p>
    <div class="table-wrap" style="max-height:50vh"><table><thead><tr><th></th><th>Data</th><th>Descrição</th><th>Conta</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
    ${ls.map((l, i) => `<tr><td><input type="radio" name="lg" value="${l.id}" ${i === 0 ? 'checked' : ''}></td><td>${dateBR(l.data)}</td><td class="wrap small">${esc(l.descricao || state.cad.favById[l.favorecido_id]?.nome || '')}</td><td class="small">${esc(state.cad.contaById[l.conta_id]?.nome || '')}</td><td class="num">${money(l.valor)}</td><td>${l.status}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum lançamento de frete sem ficha no período.</td></tr>'}</tbody></table></div>`,
    foot: `<button class="btn" data-close>Cancelar</button>${ls.length ? '<button class="btn primary" id="lg-ok">Ligar</button>' : ''}` });
  $('#lg-ok', md.el) && ($('#lg-ok', md.el).onclick = async () => { const id = md.el.querySelector('[name=lg]:checked')?.value; if (!id) return;
    try { await q(sb.from('log_fretes').update({ lancamento_id: id }).eq('id', f.id)); md.close(); toast('Frete ligado ao lançamento'); render(root); } catch (err) { fail(err); } });
}

// ---------------------------------------------------------------- Transportadores
function transportadores(corpo, root) {
  const pode = podeLogistica();
  corpo.innerHTML = `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Transportadores</h2>
      <div style="display:flex;gap:8px">${pode ? '<button class="btn small" id="tp-imp">Trazer dos fretes pagos em 2026</button><button class="btn primary small" id="tp-novo">Cadastrar</button>' : ''}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Tipo</th><th>CPF/CNPJ</th><th>RNTRC</th><th>Conta indicada</th><th>Contrato</th><th>Fretes</th><th>Pendências</th></tr></thead><tbody>
    ${B.T.map(t => { const p = pendenciasTransp(t, B.A), n = B.F.filter(f => f.transportador_id === t.id && f.status !== 'cancelado').length, ct = B.A.find(a => a.transportador_id === t.id && a.tipo === 'contrato');
      return `<tr class="clickable ${t.ativo ? '' : 'muted'}" data-id="${t.id}"><td><b>${esc(t.nome)}</b>${t.ativo ? '' : ' <span class="badge">inativo</span>'}</td><td>${TIPO_CURTO[t.tipo]}</td><td class="small">${esc(fmtDoc(t.documento)) || '<span class="neg">—</span>'}</td>
        <td class="small">${esc(t.rntrc || '') || '<span class="muted">—</span>'}${t.rntrc_validade ? `<div class="${t.rntrc_validade < today() ? 'neg' : 'muted'}">até ${dateBR(t.rntrc_validade)}</div>` : ''}</td>
        <td class="small">${t.conta_pix ? 'Pix ' + esc(t.conta_pix) : t.conta_numero ? `${esc(t.conta_banco || '')} ${esc(t.conta_agencia || '')}/${esc(t.conta_numero)}` : '<span class="muted">—</span>'}${t.conta_vinculo ? `<div class="muted">${VINCULO[t.conta_vinculo]}</div>` : ''}</td>
        <td class="small">${ct ? '✓' + (t.contrato_validade ? ` até ${dateBR(t.contrato_validade)}` : '') : ehAutonomo(t) ? '<span class="neg">falta</span>' : '<span class="muted">—</span>'}</td><td class="num">${n}</td>
        <td class="small">${p.length ? `<span class="${ehAutonomo(t) ? 'neg' : 'warn'}">${esc(p.join(', '))}</span>` : '<span class="pos">ok</span>'}</td></tr>`; }).join('')
      || '<tr><td colspan="8" class="empty">Nenhum transportador. Use "Trazer dos fretes pagos em 2026" para começar pelas transportadoras já usadas.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Autônomo = pessoa física com RNTRC (TAC). Autônomo equiparado = empresa com até 3 veículos no RNTRC (consulte o RNTRC na ANTT). Para autônomo, a conta de pagamento é a que ele indicar (dele, do cônjuge ou de parente até 2º grau) e o contrato precisa estar anexado.</p>`;
  $('#tp-novo', corpo) && ($('#tp-novo', corpo).onclick = () => editarTransp(null, root));
  $('#tp-imp', corpo) && ($('#tp-imp', corpo).onclick = () => importarTransp(root));
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => editarTransp(B.tById[tr.dataset.id], root));
}

function editarTransp(t, root, depois = null) {
  const pode = podeLogistica(), dis = pode ? '' : 'disabled';
  const favs = state.cad.favorecidos.filter(f => f.tipo !== 'CLIENTES');
  const md = modal({ title: t ? t.nome : 'Cadastrar transportador', wide: true, body: `<div class="grid2">
      <label class="grow">Nome / razão social *<input id="ct-n" value="${esc(t?.nome || '')}" ${dis}></label>
      <label>CPF / CNPJ<input id="ct-d" value="${esc(fmtDoc(t?.documento))}" ${dis}></label>
      <label>Tipo *<select id="ct-t" ${dis} data-nobusca>${Object.entries(TIPOS_TRANSP).map(([k, v]) => `<option value="${k}" ${(t?.tipo || 'etc') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="grow">Favorecido no cadastro (pagamentos)<select id="ct-f" ${dis}><option value="">—</option>${favs.map(f => `<option value="${f.id}" ${f.id === t?.favorecido_id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></label>
      <label>RNTRC<input id="ct-r" value="${esc(t?.rntrc || '')}" ${dis}></label><label>RNTRC válido até<input type="date" id="ct-rv" value="${t?.rntrc_validade || ''}" ${dis}></label>
      <label class="span2">Veículos (uma linha por veículo: placa;eixos;tipo)<textarea id="ct-vs" rows="3" ${dis} placeholder="ABC1D23;5;carreta">${esc(veiculosTxt(t?.veiculos))}</textarea></label>
      <h3 class="span2" style="margin:8px 0 0">Conta para pagamento do frete</h3>
      <label>Banco<input id="ct-b" value="${esc(t?.conta_banco || '')}" ${dis}></label><label>Agência<input id="ct-ag" value="${esc(t?.conta_agencia || '')}" ${dis}></label>
      <label>Conta<input id="ct-c" value="${esc(t?.conta_numero || '')}" ${dis}></label><label>Pix<input id="ct-px" value="${esc(t?.conta_pix || '')}" ${dis}></label>
      <label>Titular da conta<input id="ct-ti" value="${esc(t?.conta_titular || '')}" ${dis}></label>
      <label>A conta é<select id="ct-vi" ${dis} data-nobusca><option value="">—</option>${Object.entries(VINCULO).map(([k, v]) => `<option value="${k}" ${t?.conta_vinculo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>IPEF usada<input id="ct-ip" value="${esc(t?.ipef || '')}" placeholder="ex.: Repom, Pamcard, e-Frete" ${dis}></label>
      <label>Contrato válido até<input type="date" id="ct-cv" value="${t?.contrato_validade || ''}" ${dis}></label>
      <label class="span2">Observação<input id="ct-o" value="${esc(t?.observacao || '')}" ${dis}></label>
      <label class="chk"><input type="checkbox" id="ct-at" ${t?.ativo !== false ? 'checked' : ''} ${dis}> Ativo</label></div>
    ${t ? `<h3 style="margin:14px 0 6px">Contrato e documentos</h3><div id="ct-anx">${listaAnexos(B.A.filter(a => a.transportador_id === t.id), pode)}</div>
      ${pode ? `<div class="grid2" style="align-items:end"><label class="grow">Arquivos<br><input type="file" id="ct-arq" multiple accept="application/pdf,image/*"></label><label>Tipo<select id="ct-at2" data-nobusca><option value="contrato">Contrato</option><option value="outro">Outro (RNTRC, documentos)</option></select></label><button type="button" class="btn" id="ct-env">Anexar</button></div>` : ''}` : '<p class="small muted">Salve para anexar o contrato.</p>'}`,
    foot: pode ? '<button class="btn" data-close>Fechar</button><button class="btn primary" id="ct-ok">Salvar</button>' : '<button class="btn" data-close>Fechar</button>' });
  const g = (id) => $('#' + id, md.el);
  g('ct-d') && (g('ct-d').onchange = () => { if (!t) g('ct-t').value = tipoPeloDoc(g('ct-d').value); });
  g('ct-ok') && (g('ct-ok').onclick = async (ev) => {
    const doc = soDig(g('ct-d').value);
    if (!g('ct-n').value.trim()) return toast('Informe o nome', true);
    if (doc && ![11, 14].includes(doc.length)) return toast('CPF com 11 ou CNPJ com 14 dígitos', true);
    const row = { nome: g('ct-n').value.trim().toUpperCase(), documento: doc || null, tipo: g('ct-t').value, favorecido_id: g('ct-f').value || null, rntrc: g('ct-r').value.trim() || null, rntrc_validade: g('ct-rv').value || null,
      veiculos: lerVeiculos(g('ct-vs').value), conta_banco: g('ct-b').value.trim() || null, conta_agencia: g('ct-ag').value.trim() || null, conta_numero: g('ct-c').value.trim() || null, conta_pix: g('ct-px').value.trim() || null,
      conta_titular: g('ct-ti').value.trim() || null, conta_vinculo: g('ct-vi').value || null, ipef: g('ct-ip').value.trim() || null, contrato_validade: g('ct-cv').value || null, observacao: g('ct-o').value.trim() || null, ativo: g('ct-at').checked };
    ev.target.disabled = true;
    try {
      let r; if (t) { await q(sb.from('log_transportadores').update(row).eq('id', t.id)); r = { ...t, ...row }; } else { [r] = await q(sb.from('log_transportadores').insert({ ...row, empresa_id: state.empresa.id }).select()); }
      md.close(); toast('Transportador salvo'); if (depois) depois(r); else render(root);
    } catch (err) { fail(/duplicate|unique/i.test(err.message || '') ? new Error('Já existe transportador com esse CPF/CNPJ') : err); ev.target.disabled = false; }
  });
  md.el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ver) return abrirArq(b.dataset.ver);
    if (b.dataset.del) { const a = B.A.find(x => x.id === b.dataset.del); if (!a || !await confirmDialog(`Excluir o anexo "${a.nome}"?`)) return;
      try { await q(sb.from('log_frete_anexos').delete().eq('id', a.id)); await sb.storage.from('logistica').remove([a.path]); B.A = B.A.filter(x => x.id !== a.id); g('ct-anx').innerHTML = listaAnexos(B.A.filter(x => x.transportador_id === t.id), pode); } catch (err) { fail(err); } return; }
    if (b.id === 'ct-env') { const arqs = [...g('ct-arq').files]; if (!arqs.length) return toast('Escolha os arquivos', true);
      b.disabled = true; try { await enviar(arqs, t.id, { transportador_id: t.id, tipo: g('ct-at2').value }); await carregar(); g('ct-anx').innerHTML = listaAnexos(B.A.filter(x => x.transportador_id === t.id), pode); g('ct-arq').value = ''; toast('Anexado'); }
      catch (err) { fail(/bucket|not found/i.test(err.message || '') ? new Error('Espaço de arquivos da logística não criado: rode a migração 054.') : err); } b.disabled = false; }
  });
}

async function importarTransp(root) {
  if (!B.plano) return toast(`Plano ${PLANO_FRETE} não encontrado`, true);
  const ls = await fetchAll(() => sb.from('lancamentos').select('favorecido_id,valor').eq('empresa_id', state.empresa.id).eq('plano_id', B.plano.id).eq('status', 'Pago').gte('data', `${today().slice(0, 4)}-01-01`).not('favorecido_id', 'is', null));
  const porFav = {}; for (const l of ls) { const x = porFav[l.favorecido_id] || (porFav[l.favorecido_id] = { n: 0, v: 0 }); x.n++; x.v += +l.valor; }
  const ja = new Set(B.T.map(t => t.favorecido_id).filter(Boolean));
  const novos = Object.entries(porFav).filter(([id]) => !ja.has(id)).map(([id, x]) => ({ fav: state.cad.favById[id], ...x })).filter(x => x.fav && !/IPLAMM|GOL LINHAS|AIR CARGO/i.test(x.fav.nome)).sort((a, b) => b.v - a.v);
  const md = modal({ title: 'Trazer transportadores dos fretes pagos', wide: true, body: `<p class="small muted" style="margin-top:0">Favorecidos pagos no plano ${esc(B.plano.label)} em ${today().slice(0, 4)} que ainda não estão no cadastro. O tipo vem do documento (CPF = autônomo; CNPJ ou sem documento = transportadora): confira cada um e complete RNTRC e conta.</p>
    <div class="table-wrap" style="max-height:50vh"><table><thead><tr><th><input type="checkbox" id="it-all" checked></th><th>Favorecido</th><th>Documento</th><th>Tipo sugerido</th><th class="num">Pagamentos</th><th class="num">Total</th></tr></thead><tbody>
    ${novos.map((x, i) => `<tr><td><input type="checkbox" class="it" value="${i}" checked></td><td>${esc(x.fav.nome)}</td><td class="small">${esc(fmtDoc(x.fav.documento)) || '<span class="muted">sem documento</span>'}</td><td>${TIPO_CURTO[tipoPeloDoc(x.fav.documento)]}</td><td class="num">${x.n}</td><td class="num">${money(x.v)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum favorecido novo.</td></tr>'}</tbody></table></div>`,
    foot: `<button class="btn" data-close>Cancelar</button>${novos.length ? '<button class="btn primary" id="it-ok">Cadastrar marcados</button>' : ''}` });
  $('#it-all', md.el) && ($('#it-all', md.el).onchange = (e) => $$('.it', md.el).forEach(c => { c.checked = e.target.checked; }));
  $('#it-ok', md.el) && ($('#it-ok', md.el).onclick = async (ev) => {
    const sel = $$('.it:checked', md.el).map(c => novos[+c.value]); if (!sel.length) return;
    ev.target.disabled = true;
    try {
      const docs = new Set(B.T.map(t => t.documento).filter(Boolean)); const rows = [];
      for (const x of sel) { const d = soDig(x.fav.documento) || null; if (d && docs.has(d)) continue; if (d) docs.add(d);
        rows.push({ empresa_id: state.empresa.id, favorecido_id: x.fav.id, nome: x.fav.nome.toUpperCase(), documento: d, tipo: tipoPeloDoc(d), observacao: 'trazido dos fretes pagos — conferir tipo, RNTRC e conta' }); }
      if (rows.length) await q(sb.from('log_transportadores').insert(rows));
      md.close(); toast(`${rows.length} transportador(es) cadastrado(s)`); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
}

// ---------------------------------------------------------------- Conformidade do mês
async function conformidade(corpo, root) {
  const [a, m] = ui.mes.split('-').map(Number), ini = `${ui.mes}-01`, fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const ls = B.plano ? await fetchAll(() => sb.from('lancamentos').select('id,data,valor,status,descricao,favorecido_id,conta_id').eq('empresa_id', state.empresa.id).eq('plano_id', B.plano.id).gte('data', ini).lte('data', fim).order('data')) : [];
  const ligados = new Set(B.F.map(f => f.lancamento_id).filter(Boolean));
  let DSP = [];
  try { for (let i = 0; i < ls.length; i += 150) DSP.push(...await q(sb.from('log_frete_dispensas').select('*').in('lancamento_id', ls.slice(i, i + 150).map(l => l.id)))); } catch { DSP = null; }
  const dsp = new Map((DSP || []).map(d => [d.lancamento_id, d]));
  const semFicha = ls.filter(l => !ligados.has(l.id) && !dsp.has(l.id));
  const dispensados = ls.filter(l => dsp.has(l.id));
  const caixa = (l) => /CAIXA/i.test(state.cad.contaById[l.conta_id]?.nome || '') || state.cad.contaById[l.conta_id]?.tipo === 'Caixa';
  const pf = (l) => soDig(state.cad.favById[l.favorecido_id]?.documento).length === 11 || /FUNDO FIXO|MOTORISTA|AUTONOMO|AUTÔNOMO/i.test(l.descricao || '');
  const F = B.F.filter(f => f.data.slice(0, 7) === ui.mes && f.status !== 'cancelado');
  const porTipo = (k) => F.filter(f => B.tById[f.transportador_id]?.tipo === k);
  const linha = (rot, xs) => { const sem = xs.filter(f => !String(f.ciot || '').trim()).length, ab = xs.filter(f => pendDe(f).includes('abaixo do piso mínimo')).length, mdf = xs.filter(f => !f.mdfe_chave).length, pend = xs.filter(f => pendDe(f).length).length;
    return `<tr><td>${rot}</td><td class="num">${xs.length}</td><td class="num">${money(xs.reduce((s, f) => s + (+f.valor || 0), 0))}</td><td class="num ${sem ? 'neg' : ''}">${sem}</td><td class="num ${mdf ? 'warn' : ''}">${mdf}</td><td class="num ${ab ? 'neg' : ''}">${ab}</td><td class="num ${pend ? 'warn' : ''}">${pend}</td></tr>`; };
  corpo.innerHTML = `<div class="card toolbar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="small" style="display:flex;gap:6px;align-items:center">Mês <input type="month" id="cf-mes" value="${ui.mes}"></label>
      <button class="btn" id="cf-rel" style="margin-left:auto">Relatório (imprimir)</button></div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Fretes com ficha</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Tipo de transportador</th><th class="num">Fretes</th><th class="num">Valor</th><th class="num">Sem CIOT</th><th class="num">Sem MDF-e</th><th class="num">Abaixo do piso</th><th class="num">Com pendência</th></tr></thead>
      <tbody>${linha('Autônomo (TAC / equiparado / cooperativa)', F.filter(f => ehAutonomo(B.tById[f.transportador_id])))}${linha('Transportadora (ETC)', porTipo('etc'))}${linha('<b>Total</b>', F)}</tbody></table></div></div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Fretes pagos sem ficha (${semFicha.length})</h2><div class="muted small">${money(semFicha.reduce((s, l) => s + +l.valor, 0))} no plano ${esc(B.plano?.label || PLANO_FRETE)}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Favorecido / descrição</th><th>Conta</th><th class="num">Valor</th><th>Alerta</th><th></th></tr></thead><tbody>
      ${semFicha.map(l => { const al = [caixa(l) ? 'pago pelo caixa' : '', pf(l) ? 'pessoa física / autônomo?' : '', !l.favorecido_id ? 'sem favorecido' : ''].filter(Boolean);
        return `<tr><td>${dateBR(l.data)}</td><td class="wrap small">${esc(state.cad.favById[l.favorecido_id]?.nome || '')}<div class="muted">${esc(l.descricao || '')}</div></td><td class="small">${esc(state.cad.contaById[l.conta_id]?.nome || '')}</td>
          <td class="num">${money(l.valor)}</td><td class="small">${al.length ? `<span class="${caixa(l) || pf(l) ? 'neg' : 'warn'}">${al.join(' · ')}</span>` : ''}</td>
          <td style="white-space:nowrap">${podeLogistica() ? `<button class="btn ghost small" data-fic="${l.id}">Criar ficha</button>${DSP ? `<button class="btn ghost small" data-dsp="${l.id}">Dispensar</button>` : ''}` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Todos os fretes pagos do mês têm ficha ou foram dispensados.</td></tr>'}</tbody></table></div></div>
    ${dispensados.length ? `<details class="card" style="margin-top:12px"><summary><b>Dispensados com justificativa (${dispensados.length})</b> · ${money(dispensados.reduce((s, l) => s + +l.valor, 0))}</summary>
      <div class="table-wrap"><table><thead><tr><th>Data</th><th>Favorecido / descrição</th><th class="num">Valor</th><th>Motivo</th><th>Por</th><th></th></tr></thead><tbody>
      ${dispensados.map(l => { const d = dsp.get(l.id); return `<tr><td>${dateBR(l.data)}</td><td class="wrap small">${esc(state.cad.favById[l.favorecido_id]?.nome || '')}<div class="muted">${esc(l.descricao || '')}</div></td><td class="num">${money(l.valor)}</td>
        <td class="small"><b>${MOTIVOS[d.motivo]}</b><div>${esc(d.justificativa)}</div></td><td class="small">${esc((d.criado_email || '').split('@')[0])} ${dateBR(d.criado_em)}</td>
        <td>${podeLogistica() ? `<button class="btn ghost small" data-undsp="${d.id}">Desfazer</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></details>` : ''}
    <p class="small muted">Frete com autônomo pago pelo caixa, em dinheiro ou Pix direto ao motorista é irregular: o pagamento deve sair pela IPEF que gerou o CIOT. Crie a ficha de cada frete para registrar CIOT, MDF-e e piso — mesmo os antigos, para o histórico.</p>`;
  $('#cf-mes', corpo).onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; conformidade(corpo, root); } };
  $('#cf-rel', corpo).onclick = () => relatorio(F, semFicha, caixa, pf, dispensados.map(l => ({ ...l, d: dsp.get(l.id) })));
  $$('[data-dsp]', corpo).forEach(b => b.onclick = () => { const l = semFicha.find(x => x.id === b.dataset.dsp);
    const md = modal({ title: 'Dispensar da conformidade', body: `<p class="small muted" style="margin-top:0">${dateBR(l.data)} · ${money(l.valor)} · ${esc(state.cad.favById[l.favorecido_id]?.nome || l.descricao || '')}<br>O lançamento não muda; sai dos alertas com o motivo registrado (quem e quando). Dá para desfazer.</p>
      <label>Motivo<select id="ds-m" data-nobusca>${Object.entries(MOTIVOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Justificativa *<input id="ds-j" placeholder="ex.: frete Manaus contratado pelo fornecedor; CT-e em nome da IPLAMM"></label>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ds-ok">Dispensar</button>' });
    $('#ds-ok', md.el).onclick = async () => { const j = $('#ds-j', md.el).value.trim(); if (!j) return toast('Escreva a justificativa', true);
      try { await q(sb.from('log_frete_dispensas').insert({ empresa_id: state.empresa.id, lancamento_id: l.id, motivo: $('#ds-m', md.el).value, justificativa: j })); md.close(); conformidade(corpo, root); } catch (err) { fail(err); } }; });
  $$('[data-undsp]', corpo).forEach(b => b.onclick = async () => { if (!await confirmDialog('Desfazer a dispensa? O lançamento volta para os alertas.')) return;
    try { await q(sb.from('log_frete_dispensas').delete().eq('id', b.dataset.undsp)); conformidade(corpo, root); } catch (err) { fail(err); } });
  $$('[data-fic]', corpo).forEach(b => b.onclick = () => { const l = semFicha.find(x => x.id === b.dataset.fic); const t = B.T.find(x => x.favorecido_id && x.favorecido_id === l.favorecido_id);
    ficha(null, root, { data: l.data, valor: +l.valor, transportador_id: t?.id || null, lancamento_id: l.id, observacao: l.descricao || null }); });
}

async function relatorio(F, semFicha, caixa, pf, dispensados = []) {
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  const logo = await logoPNG().catch(() => null);
  const [a, m] = ui.mes.split('-'); const mesTxt = `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][+m - 1]}/${a}`;
  const linhas = F.map(f => { const t = B.tById[f.transportador_id], p = pendDe(f), l = B.L.get(f.lancamento_id);
    return `<tr><td>${f.numero}</td><td>${dateBR(f.data)}</td><td>${esc(t?.nome || '')}<br><span class="m">${TIPO_CURTO[t?.tipo] || ''}</span></td><td>${esc(f.destino || '')}${f.km ? `<br><span class="m">${(+f.km).toLocaleString('pt-BR')} km · ${f.eixos || '?'} eixos</span>` : ''}</td>
      <td class="n">${money(f.valor)}</td><td class="n">${f.piso != null ? money(f.piso) : '–'}</td><td>${esc(f.ciot || '–')}</td><td>${f.mdfe_chave ? 'sim' : 'não'}</td><td>${l ? (l.status === 'Pago' ? 'pago ' : 'prog. ') + dateBR(l.data) : '–'}</td><td>${p.length ? esc(p.join(', ')) : 'conforme'}</td></tr>`; }).join('');
  const sf = semFicha.map(l => `<tr><td>${dateBR(l.data)}</td><td>${esc(state.cad.favById[l.favorecido_id]?.nome || l.descricao || '')}</td><td>${esc(state.cad.contaById[l.conta_id]?.nome || '')}</td><td class="n">${money(l.valor)}</td><td>${[caixa(l) ? 'pago pelo caixa' : '', pf(l) ? 'pessoa física?' : ''].filter(Boolean).join(' · ')}</td></tr>`).join('');
  const tot = (xs, f = (x) => +x.valor || 0) => money(xs.reduce((s, x) => s + f(x), 0));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Conformidade de fretes — ${mesTxt}</title><style>
    @page{size:A4 landscape;margin:12mm} body{font-family:'Times New Roman',Times,serif;font-size:10.5px;color:#111;margin:0}
    .cab{display:flex;align-items:center;gap:14px;border-bottom:1px solid #111;padding-bottom:6px} .cab img{height:34px} .cab .t{font-weight:bold;font-size:11px} .cab .d{margin-left:auto;text-align:right;font-size:10px}
    h1{text-align:center;font-size:16px;margin:14px 0 2px} .sub{text-align:center;margin-bottom:10px} h2{font-size:12px;margin:14px 0 4px}
    table{width:100%;border-collapse:collapse} th{font-size:9.5px;text-align:left;border-top:1px solid #000;border-bottom:.6px solid #000;padding:3px 4px} td{padding:3px 4px;border-bottom:.25px solid #bbb;vertical-align:top} td.n,th.n{text-align:right;white-space:nowrap}
    tr{page-break-inside:avoid} thead{display:table-header-group} .m{color:#555;font-size:9.5px} .rod{margin-top:12px;font-size:9px;color:#444;border-top:.6px solid #111;padding-top:4px}
    @media screen{body{margin:20px auto;max-width:1100px}} @media print{.bar{display:none}}</style></head><body>
    <div class="bar"><button onclick="print()">Imprimir / salvar PDF</button></div>
    <div class="cab">${logo ? `<img src="${logo.data}">` : ''}<div class="t">IPLAMM – INDÚSTRIA DE PLÁSTICOS LTDA.</div><div class="d">Conformidade ANTT nos fretes<br>emitido em ${new Date().toLocaleString('pt-BR')}</div></div>
    <h1>RELATÓRIO DE CONFORMIDADE DE FRETES</h1><div class="sub">Competência ${mesTxt} · CIOT, MDF-e, piso mínimo, vale-pedágio e pagamento</div>
    <h2>1. Fretes com ficha (${F.length} · ${tot(F)})</h2>
    <table><thead><tr><th>Nº</th><th>Data</th><th>Transportador</th><th>Destino</th><th class="n">Valor</th><th class="n">Piso</th><th>CIOT</th><th>MDF-e</th><th>Pagamento</th><th>Situação</th></tr></thead><tbody>${linhas || '<tr><td colspan="10">Nenhum frete com ficha no mês.</td></tr>'}</tbody></table>
    <h2>2. Fretes pagos sem ficha (${semFicha.length} · ${tot(semFicha)})</h2>
    <table><thead><tr><th>Data</th><th>Favorecido / descrição</th><th>Conta</th><th class="n">Valor</th><th>Alerta</th></tr></thead><tbody>${sf || '<tr><td colspan="5">Nenhum.</td></tr>'}</tbody></table>
    <h2>3. Dispensados com justificativa (${dispensados.length} · ${tot(dispensados)})</h2>
    <table><thead><tr><th>Data</th><th>Favorecido / descrição</th><th class="n">Valor</th><th>Motivo</th><th>Justificativa</th><th>Por</th></tr></thead><tbody>${dispensados.map(l => `<tr><td>${dateBR(l.data)}</td><td>${esc(state.cad.favById[l.favorecido_id]?.nome || l.descricao || '')}</td><td class="n">${money(l.valor)}</td><td>${MOTIVOS[l.d.motivo]}</td><td>${esc(l.d.justificativa)}</td><td>${esc((l.d.criado_email || '').split('@')[0])} ${dateBR(l.d.criado_em)}</td></tr>`).join('') || '<tr><td colspan="6">Nenhum.</td></tr>'}</tbody></table>
    <div class="rod">Base: Resolução ANTT nº 6.078/2026, MP nº 1.343/2026 e NT MDF-e 2026.001. Frete com autônomo deve ter CIOT gerado pela IPLAMM via IPEF, MDF-e com o CIOT, valor ≥ piso mínimo e pagamento pela IPEF na conta indicada pelo autônomo.</div>
    <script>window.onload=()=>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

// ---------------------------------------------------------------- Piso mínimo
function piso(corpo, root) {
  const pode = podeLogistica();
  corpo.innerHTML = `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Coeficientes do piso mínimo</h2>${pode ? '<button class="btn small" id="pc-novo">Incluir coeficiente</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Tabela</th><th>Tipo de carga</th><th class="num">Eixos</th><th class="num">CCD (R$/km)</th><th class="num">CC (R$)</th><th>Vigência</th><th>Fonte</th><th class="num">Piso de 500 km</th></tr></thead><tbody>
    ${B.C.map(c => `<tr class="${pode ? 'clickable' : ''}" data-id="${c.id}"><td>${c.tabela}</td><td>${esc(c.tipo_carga)}</td><td class="num">${c.eixos}</td><td class="num">${(+c.ccd).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</td><td class="num">${money(c.cc)}</td><td>${dateBR(c.vigencia)}</td><td class="small muted">${esc(c.fonte || '')}</td><td class="num">${money(500 * c.ccd + +c.cc)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Sem coeficientes.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Piso = km × CCD + CC; com retorno vazio obrigatório soma 0,92 × CCD × km de retorno. Vale para carga lotação. Pedágio é à parte (vale-pedágio). Tabela A = carga lotação; B = só o cavalo; C e D = alta performance (exige contrato e frota dedicada).
      Os coeficientes carregados são da Tabela A, carga geral, com o reajuste da Portaria SUROC nº 22/2026 — confira na calculadora oficial da ANTT e ajuste aqui quando a ANTT reajustar (inclua uma linha nova com a nova vigência).</p>`;
  const editar = (c) => {
    const md = modal({ title: c ? 'Coeficiente do piso' : 'Incluir coeficiente', body: `<div class="grid2">
        <label>Tabela<select id="pc-t" data-nobusca>${['A', 'B', 'C', 'D'].map(x => `<option ${(c?.tabela || 'A') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Tipo de carga<input id="pc-tc" value="${esc(c?.tipo_carga || 'geral')}"></label><label>Eixos<input id="pc-e" value="${c?.eixos || ''}"></label>
        <label>CCD (R$/km)<input id="pc-ccd" value="${inp(c?.ccd)}"></label><label>CC (R$)<input id="pc-cc" value="${inp(c?.cc)}"></label>
        <label>Vigência<input type="date" id="pc-v" value="${c?.vigencia || today()}"></label><label class="span2">Fonte<input id="pc-f" value="${esc(c?.fonte || '')}"></label></div>`,
      foot: `${c ? '<button class="btn danger" id="pc-del" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pc-ok">Salvar</button>` });
    $('#pc-ok', md.el).onclick = async () => {
      const row = { tabela: $('#pc-t', md.el).value, tipo_carga: $('#pc-tc', md.el).value.trim() || 'geral', eixos: +$('#pc-e', md.el).value, ccd: num($('#pc-ccd', md.el).value), cc: num($('#pc-cc', md.el).value), vigencia: $('#pc-v', md.el).value, fonte: $('#pc-f', md.el).value.trim() || null };
      if (!(row.eixos >= 2 && row.eixos <= 9) || !(row.ccd > 0)) return toast('Informe eixos (2 a 9) e CCD', true);
      try { if (c) await q(sb.from('log_piso_coef').update(row).eq('id', c.id)); else await q(sb.from('log_piso_coef').insert({ ...row, empresa_id: state.empresa.id })); md.close(); render(root); } catch (err) { fail(err); }
    };
    $('#pc-del', md.el) && ($('#pc-del', md.el).onclick = async () => { try { await q(sb.from('log_piso_coef').delete().eq('id', c.id)); md.close(); render(root); } catch (err) { fail(err); } });
  };
  $('#pc-novo', corpo) && ($('#pc-novo', corpo).onclick = () => editar(null));
  if (pode) $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => editar(B.C.find(c => c.id === tr.dataset.id)));
}

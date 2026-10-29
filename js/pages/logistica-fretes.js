// Logística › Fretes e CIOT (SQL 054): ficha de cada frete contratado, cadastro de transportadores, piso mínimo da ANTT,
// conformidade do mês (fretes pagos sem ficha, pelo caixa, a pessoa física) e relatório para imprimir.
// Autônomo: pagamento só é liberado sem pendências (trava no banco). Transportadora: CIOT/MDF-e/piso viram aviso.
import { sb, state, q, fetchAll, loadCadastros } from '../lib/data.js';
import { erroTela, $, $$, esc, money, dateBR, toast, fail, modal, confirmDialog, options, today } from '../lib/ui.js';
import { abrirRelatorio } from '../lib/relatorio.js';
import { podeLogistica } from '../lib/logistica.js';
import { inp, num } from '../lib/compras.js';
import { conversaNoModal } from '../lib/mini-chat.js';
import * as MD from '../lib/mdfe.js';
import { gerarXMLMDFe } from '../lib/mdfe-xml.js';
import { pedidoCIOT, faltasCIOT, empresaGeraCIOT } from '../lib/ipef.js';
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
  // padrões do MDF-e (SQL 062); sem a migração, a parte do MDF-e fica escondida
  let P = {}, semMdfe = false, parId = null;
  try { const r = await q(sb.from('log_parametros').select('id, mdfe_padrao').eq('empresa_id', e)); P = r[0]?.mdfe_padrao || {}; parId = r[0]?.id || null; } catch { semMdfe = true; }
  const ids = F.map(f => f.lancamento_id).filter(Boolean);
  const L = new Map();
  for (let i = 0; i < ids.length; i += 150) for (const l of await q(sb.from('lancamentos').select('id,status,data,valor,conta_id').in('id', ids.slice(i, i + 150)))) L.set(l.id, l);
  B = { T, F, A, C, K, L, P, semMdfe, parId, tById: Object.fromEntries(T.map(t => [t.id, t])), plano: state.cad.contasPlano.find(p => p.codigo === PLANO_FRETE) };
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
    <div class="card toolbar"><div class="chips" id="lf-abas">${[['fretes', 'Fretes'], ['mdfe', 'MDF-e · 23/11'], ['transp', 'Transportadores'], ['conf', 'Conformidade do mês'], ['piso', 'Piso mínimo']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div id="lf-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#lf-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  try { await carregar(); } catch (err) { console.error(err); $('#lf-corpo', root).innerHTML = erroTela('os fretes'); return; }
  const corpo = $('#lf-corpo', root);
  const ab = state.abrir?.tipo === 'frete' ? state.abrir : null;
  if (ab) { delete state.abrir; ui.aba = 'fretes'; $$('#lf-abas .chip', root).forEach(c => c.classList.toggle('on', c.dataset.a === 'fretes')); }
  try {
    if (ab) { fretes(corpo, root); const fr = B.F.find(x => x.id === ab.id) || await q(sb.from('log_fretes').select('*').eq('id', ab.id).maybeSingle()).catch(() => null); if (fr) ficha(fr, root); return; }
    if (ui.aba === 'transp') return transportadores(corpo, root);
    if (ui.aba === 'conf') return await conformidade(corpo, root);
    if (ui.aba === 'piso') return piso(corpo, root);
    if (ui.aba === 'mdfe') return prontidao(corpo, root);
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
      ${B.semMdfe ? '' : `<label>Quem emite o MDF-e<select id="fr-em" ${dis} data-nobusca><option value="">—</option><option value="iplamm" ${f.mdfe_emissor === 'iplamm' ? 'selected' : ''}>IPLAMM (carga própria)</option><option value="transportadora" ${f.mdfe_emissor === 'transportadora' ? 'selected' : ''}>Transportadora (com CT-e)</option></select></label>
      <div class="small" id="fr-mdfe-st" style="align-self:end"></div>`}
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
  if (f0?.id) conversaNoModal(md, 'log_frete', f0.id);
  const g = (id) => $('#' + id, md.el);
  const ler = () => { const [tb, tc] = (g('fr-tc').value || 'A|geral').split('|'); const n = (id) => { const s = g(id).value.trim(); return s ? num(s) : null; };
    return { transportador_id: g('fr-t').value || null, data: g('fr-d').value, carga_id: g('fr-k').value || null, notas: g('fr-n').value.trim() || null, origem: g('fr-o').value.trim() || null,
      destino: g('fr-de').value.trim() || null, km: n('fr-km'), eixos: +g('fr-e').value || null, tabela: tb, tipo_carga: tc, lotacao: g('fr-lot').checked, retorno_vazio: g('fr-rv').checked,
      km_retorno: n('fr-kr'), valor: n('fr-v'), placa: g('fr-pl').value.trim().toUpperCase() || null, motorista: g('fr-mo').value.trim() || null, ciot: soDig(g('fr-ci').value) || g('fr-ci').value.trim() || null,
      ciot_por: g('fr-cp').value || null, mdfe_chave: soDig(g('fr-mdf').value) || null, cte_chave: soDig(g('fr-cte').value) || null, pedagio_valor: n('fr-pv'), pedagio_comprovante: g('fr-pc').value.trim() || null,
      pedagio_nao_ha: g('fr-pn').checked, observacao: g('fr-obs').value.trim() || null, ...(g('fr-em') ? { mdfe_emissor: g('fr-em').value || null } : {}) }; };
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
    if (g('fr-em')) {
      if (t && !g('fr-em').value) g('fr-em').value = ehAutonomo(t) ? 'iplamm' : 'transportadora';
      const fx = { ...x, mdfe_emissor: g('fr-em').value || null, mdfe: f.mdfe || {} }, fs = MD.faltasMDFe(fx, t, B.P), gr = MD.graves(fs);
      g('fr-mdfe-st').innerHTML = !fx.mdfe_emissor ? '' : fx.mdfe_emissor === 'transportadora' ? '<span class="muted">A transportadora emite o MDF-e: informe o CT-e e o CIOT dela.</span>'
        : `${gr.length ? `<span class="neg">MDF-e: falta ${gr.length} item(ns)</span>` : '<span class="pos">MDF-e: dados completos ✓</span>'} ${f0 ? '<button type="button" class="btn small" id="fr-mdfe">Dados do MDF-e</button>' : '<span class="muted">(salve a ficha para preencher)</span>'}`;
    }
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
      catch (err) { fail(err); } b.disabled = false; return; }
    if (b.id === 'fr-canc') { if (!await confirmDialog('Cancelar este frete? O lançamento programado em aberto, se houver, continua no fluxo — exclua lá se for o caso.')) return;
      try { await q(sb.from('log_fretes').update({ status: 'cancelado' }).eq('id', f0.id)); md.close(); render(root); } catch (err) { fail(err); } return; }
    if (b.id === 'fr-mdfe') { try { await salvar(); } catch (err) { return fail(err); } md.close(); await carregar(); return fichaMDFe(B.F.find(x => x.id === f0.id), root); }
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
      veiculos: lerVeiculos(g('ct-vs').value).map(v => ({ ...((t?.veiculos || []).find(o => o.placa === v.placa) || {}), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x != null)) })), conta_banco: g('ct-b').value.trim() || null, conta_agencia: g('ct-ag').value.trim() || null, conta_numero: g('ct-c').value.trim() || null, conta_pix: g('ct-px').value.trim() || null,
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
      catch (err) { fail(err); } b.disabled = false; }
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
  const [a, m] = ui.mes.split('-'); const mesTxt = `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][+m - 1]}/${a}`;
  const linhas = F.map(f => { const t = B.tById[f.transportador_id], p = pendDe(f), l = B.L.get(f.lancamento_id);
    return `<tr><td>${f.numero}</td><td>${dateBR(f.data)}</td><td>${esc(t?.nome || '')}<br><span class="m">${TIPO_CURTO[t?.tipo] || ''}</span></td><td>${esc(f.destino || '')}${f.km ? `<br><span class="m">${(+f.km).toLocaleString('pt-BR')} km · ${f.eixos || '?'} eixos</span>` : ''}</td>
      <td class="n">${money(f.valor)}</td><td class="n">${f.piso != null ? money(f.piso) : '–'}</td><td>${esc(f.ciot || '–')}</td><td>${f.mdfe_chave ? 'sim' : 'não'}</td><td>${l ? (l.status === 'Pago' ? 'pago ' : 'prog. ') + dateBR(l.data) : '–'}</td><td>${p.length ? esc(p.join(', ')) : 'conforme'}</td></tr>`; }).join('');
  const sf = semFicha.map(l => `<tr><td>${dateBR(l.data)}</td><td>${esc(state.cad.favById[l.favorecido_id]?.nome || l.descricao || '')}</td><td>${esc(state.cad.contaById[l.conta_id]?.nome || '')}</td><td class="n">${money(l.valor)}</td><td>${[caixa(l) ? 'pago pelo caixa' : '', pf(l) ? 'pessoa física?' : ''].filter(Boolean).join(' · ')}</td></tr>`).join('');
  const tot = (xs, f = (x) => +x.valor || 0) => money(xs.reduce((s, x) => s + f(x), 0));
  await abrirRelatorio({ janela: w, nome: 'Conformidade ANTT nos fretes', titulo: 'Relatório de conformidade de fretes', paisagem: true,
    subtitulo: `Competência ${mesTxt} · CIOT, MDF-e, piso mínimo, vale-pedágio e pagamento`,
    corpo: `<h2>1. Fretes com ficha (${F.length} · ${tot(F)})</h2>
    <table><thead><tr><th>Nº</th><th>Data</th><th>Transportador</th><th>Destino</th><th class="n">Valor</th><th class="n">Piso</th><th>CIOT</th><th>MDF-e</th><th>Pagamento</th><th>Situação</th></tr></thead><tbody>${linhas || '<tr><td colspan="10">Nenhum frete com ficha no mês.</td></tr>'}</tbody></table>
    <h2>2. Fretes pagos sem ficha (${semFicha.length} · ${tot(semFicha)})</h2>
    <table><thead><tr><th>Data</th><th>Favorecido / descrição</th><th>Conta</th><th class="n">Valor</th><th>Alerta</th></tr></thead><tbody>${sf || '<tr><td colspan="5">Nenhum.</td></tr>'}</tbody></table>
    <h2>3. Dispensados com justificativa (${dispensados.length} · ${tot(dispensados)})</h2>
    <table><thead><tr><th>Data</th><th>Favorecido / descrição</th><th class="n">Valor</th><th>Motivo</th><th>Justificativa</th><th>Por</th></tr></thead><tbody>${dispensados.map(l => `<tr><td>${dateBR(l.data)}</td><td>${esc(state.cad.favById[l.favorecido_id]?.nome || l.descricao || '')}</td><td class="n">${money(l.valor)}</td><td>${MOTIVOS[l.d.motivo]}</td><td>${esc(l.d.justificativa)}</td><td>${esc((l.d.criado_email || '').split('@')[0])} ${dateBR(l.d.criado_em)}</td></tr>`).join('') || '<tr><td colspan="6">Nenhum.</td></tr>'}</tbody></table>`,
    rodape: 'Base: Resolução ANTT nº 6.078/2026, MP nº 1.343/2026 e NT MDF-e 2026.001. Frete com autônomo deve ter CIOT gerado pela IPLAMM via IPEF, MDF-e com o CIOT, valor ≥ piso mínimo e pagamento pela IPEF na conta indicada pelo autônomo.' });
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

// ---------------------------------------------------------------- MDF-e (passo 3: dados prontos para emitir — SQL 062)
// NT MDF-e 2026.001: a partir de 23/11/2026 a Sefaz recusa (684) o MDF-e da IPLAMM (carga própria) com veículo de terceiro sem CIOT.
let MUNS = null;
async function municipiosNF() {
  if (MUNS) return MUNS;
  const k = 'mdfe-mun-' + state.empresa.id;
  try { const c = JSON.parse(localStorage.getItem(k) || 'null'); if (c && Date.now() - c.em < 7 * 864e5 && c.l?.length) return (MUNS = c.l); } catch {}
  MUNS = await q(sb.rpc('log_mdfe_municipios', { p_empresa: state.empresa.id })).catch(() => []);
  try { localStorage.setItem(k, JSON.stringify({ em: Date.now(), l: MUNS })); } catch {}
  return MUNS;
}
const munTxt = (m) => (m?.cmun ? `${m.xmun || ''}/${m.uf || ''} · ${m.cmun}` : '');
function lerMun(txt) {
  const s = String(txt || '').trim(); if (!s) return null;
  const cod = s.match(/\b(\d{7})\b/)?.[1];
  const achado = (MUNS || []).find(m => m.cmun === cod) || (MUNS || []).find(m => norm(`${m.xmun}/${m.uf}`) === norm(s.split('·')[0].trim()) || norm(m.xmun) === norm(s));
  if (achado) return { cmun: achado.cmun, xmun: achado.xmun, uf: achado.uf };
  return cod ? { cmun: cod, xmun: s.replace(/·?\s*\d{7}/, '').split('/')[0].trim(), uf: (s.match(/\/([A-Z]{2})/) || [])[1] || '' } : { cmun: '', xmun: s, uf: '' };
}
const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setP(o, p, v) { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach((k, i) => { if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }
const selOpts = (obj, val, vazioTxt = '—') => `<option value="">${vazioTxt}</option>` + Object.entries(obj).map(([k, v]) => `<option value="${k}" ${String(val ?? '') === k ? 'selected' : ''}>${k} · ${esc(v)}</option>`).join('');
const ufOpts = (val) => '<option value="">—</option>' + MD.UFS.map(u => `<option ${val === u ? 'selected' : ''}>${u}</option>`).join('');

async function fichaMDFe(f, root) {
  const t = B.tById[f.transportador_id], pode = podeLogistica(), dis = pode ? '' : 'disabled';
  await municipiosNF();
  const m = MD.dadosMDFe(f, B.P);
  let ciot = f.ciot || '';
  if (!m.ciot_resp && f.ciot_por === 'iplamm') m.ciot_resp = soDig(state.empresa.cnpj);
  // veículo: completa com o que já foi informado para esta placa no transportador
  const vt = (t?.veiculos || []).find(v => v.placa === m.veiculo.placa);
  if (vt) for (const k of ['renavam', 'tara', 'cap_kg', 'uf', 'tp_rod', 'tp_car']) if (m.veiculo[k] == null || m.veiculo[k] === '') m.veiculo[k] = vt[k] ?? m.veiculo[k];
  const md = modal({ title: `MDF-e do frete nº ${f.numero}`, wide: true, body: '<div id="mf-corpo"></div>',
    foot: `<button class="btn" id="mf-res">Resumo para impressão</button><button class="btn" id="mf-xml" style="margin-right:auto" title="XML do MDF-e no leiaute 3.00, em homologação e sem assinatura: serve para conferir com o emissor que for contratado">XML (teste)</button>${pode ? '<button class="btn" id="mf-pad" title="Seguradora, IPEF, produto, carregamento e responsável pelo CIOT passam a vir preenchidos nos próximos fretes">Salvar como padrão</button>' : ''}
      <button class="btn" data-close>Fechar</button>${pode ? '<button class="btn primary" id="mf-ok">Salvar</button>' : ''}` });
  const corpo = $('#mf-corpo', md.el);
  const campo = (rot, k, { tipo = 'text', ph = '', cls = '', lista = '' } = {}) => `<label class="${cls}">${rot}<input data-k="${k}" type="${tipo}" value="${esc(getP(m, k) ?? '')}" placeholder="${esc(ph)}" ${lista ? `list="${lista}"` : ''} ${dis}></label>`;
  const sel = (rot, k, opcoes, cls = '') => `<label class="${cls}">${rot}<select data-k="${k}" ${dis} data-nobusca>${opcoes}</select></label>`;
  const munCampo = (rot, k) => `<label class="grow">${rot}<input data-mun="${k}" value="${esc(munTxt(getP(m, k)))}" list="mf-muns" placeholder="cidade/UF ou código IBGE" ${dis}></label>`;
  const conferir = () => {
    const fx = { ...f, ciot, mdfe: m }, fs = MD.faltasMDFe(fx, t, {}), gr = MD.graves(fs), av = fs.filter(x => !x.grave);
    const dias = MD.diasAte(MD.DATA_CIOT_MDFE, today());
    $('#mf-check', md.el).innerHTML = `${gr.length ? `<div class="neg"><b>Falta para emitir (${gr.length}):</b> ${esc(gr.map(x => x.txt).join('; '))}.</div>` : '<div class="pos"><b>Pronto para emitir o MDF-e.</b></div>'}
      ${av.length ? `<div class="warn">Recomendado: ${esc(av.map(x => x.txt).join('; '))}.</div>` : ''}
      ${MD.ciotObrigatorio(fx, t) ? `<div class="small muted">CIOT obrigatório neste MDF-e (veículo de terceiro)${dias > 0 ? ` · a Sefaz passa a recusar sem CIOT em ${dias} dia(s), em 23/11/2026` : ' · a Sefaz já recusa sem CIOT (rejeição 684)'}.</div>` : ''}
      ${empresaGeraCIOT(f, t) && !MD.ciotValido(ciot) ? (() => { const fc = faltasCIOT(pedidoCIOT(fx, t, state.empresa, { padrao: B.P }));
        return fc.length ? `<div class="small warn">Para pedir o CIOT à IPEF falta: ${esc(fc.map(x => x.txt).join('; '))}.</div>` : '<div class="small pos">Dados completos para pedir o CIOT à IPEF.</div>'; })() : ''}`;
  };
  const pintar = () => {
    const aut = ehAutonomo(t);
    corpo.innerHTML = `<datalist id="mf-muns">${(MUNS || []).map(x => `<option value="${esc(munTxt(x))}">`).join('')}</datalist>
    <div id="mf-check" class="small card" style="padding:10px;margin-bottom:10px"></div>
    <h3 style="margin:0 0 6px">1. Viagem</h3>
    <div class="grid2">${sel('UF de início *', 'uf_ini', ufOpts(m.uf_ini))}${sel('UF de fim *', 'uf_fim', ufOpts(m.uf_fim))}
      <label class="grow">UFs do percurso (entre o início e o fim)<input data-perc value="${esc((m.percurso || []).join(', '))}" placeholder="ex.: AL, SE (só se passar por outro estado)" ${dis}></label>
      ${m.carregamento.map((c, i) => `${munCampo(`Município de carregamento ${m.carregamento.length > 1 ? i + 1 : ''} *`, `carregamento.${i}`)}`).join('') || munCampo('Município de carregamento *', 'carregamento.0')}
    </div>
    <h3 style="margin:14px 0 6px">2. NF-e e descarregamento</h3>
    <div class="small" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">${pode ? `<button type="button" class="btn small" id="mf-nfe">Buscar NF-e ${f.carga_id ? 'da carga e ' : ''}dos números da ficha</button>` : ''}
      <span class="muted">NF-e da ficha: ${esc(f.notas || '—')}. As chaves, o destino, o peso e o valor vêm do XML das notas importadas.</span></div>
    ${m.descarga.map((x, i) => `<div class="card" style="padding:8px 10px;margin-bottom:6px"><div class="grid2" style="align-items:end">${munCampo(`Descarga ${i + 1} — município *`, `descarga.${i}`)}
        ${pode ? `<button type="button" class="btn ghost small" data-rm-desc="${i}">Tirar município</button>` : ''}</div>
      <div class="small" style="margin-top:4px">${(x.chaves || []).map((c, j) => `<div style="display:flex;gap:6px;align-items:center"><code class="${MD.chaveValida(c) ? '' : 'neg'}">${esc(c)}</code><span class="muted">NF ${esc(String(+c.slice(25, 34) || ''))}</span>${pode ? `<button type="button" class="btn ghost small" data-rm-ch="${i}.${j}" title="Tirar">✕</button>` : ''}</div>`).join('') || '<span class="muted">Nenhuma NF-e neste município.</span>'}
        ${pode ? `<div style="display:flex;gap:6px;margin-top:4px"><input data-nova-ch="${i}" placeholder="colar chave de 44 dígitos" style="flex:1"><button type="button" class="btn small" data-add-ch="${i}">Incluir</button></div>` : ''}</div></div>`).join('') || '<p class="small muted">Nenhuma NF-e ainda. Use "Buscar NF-e" ou inclua um município.</p>'}
    ${pode ? '<button type="button" class="btn ghost small" id="mf-add-desc">+ Município de descarga</button>' : ''}
    <h3 style="margin:14px 0 6px">3. Veículo</h3>
    <div class="grid2">${campo('Placa do cavalo/veículo *', 'veiculo.placa', { ph: 'ABC1D23' })}${campo('RENAVAM', 'veiculo.renavam')}${campo('Tara (kg) *', 'veiculo.tara', { tipo: 'number' })}${campo('Capacidade (kg)', 'veiculo.cap_kg', { tipo: 'number' })}
      ${sel('UF do veículo *', 'veiculo.uf', ufOpts(m.veiculo.uf))}${sel('Tipo de rodado *', 'veiculo.tp_rod', selOpts(MD.TP_ROD, m.veiculo.tp_rod))}${sel('Carroceria *', 'veiculo.tp_car', selOpts(MD.TP_CAR, m.veiculo.tp_car))}</div>
    ${m.reboques.map((x, i) => `<div class="grid2" style="margin-top:6px;align-items:end"><b class="span2 small">Reboque ${i + 1}</b>${campo('Placa *', `reboques.${i}.placa`)}${campo('RENAVAM', `reboques.${i}.renavam`)}${campo('Tara (kg) *', `reboques.${i}.tara`, { tipo: 'number' })}${campo('Capacidade (kg)', `reboques.${i}.cap_kg`, { tipo: 'number' })}
      ${sel('UF *', `reboques.${i}.uf`, ufOpts(x.uf))}${sel('Carroceria', `reboques.${i}.tp_car`, selOpts(MD.TP_CAR, x.tp_car))}${pode ? `<button type="button" class="btn ghost small" data-rm-reb="${i}">Tirar reboque</button>` : ''}</div>`).join('')}
    ${pode && m.reboques.length < 3 ? '<button type="button" class="btn ghost small" id="mf-add-reb" style="margin-top:6px">+ Reboque (carreta)</button>' : ''}
    <h3 style="margin:14px 0 6px">4. Dono do veículo e motorista</h3>
    <div class="grid2"><div class="small">${t ? `<b>${esc(t.nome)}</b> · ${TIPO_CURTO[t.tipo]}<br>${esc(fmtDoc(t.documento)) || '<span class="neg">sem CPF/CNPJ</span>'} · RNTRC ${esc(t.rntrc || '') || '<span class="neg">sem RNTRC</span>'}<br><span class="muted">Corrija em Transportadores.</span>` : '<span class="neg">Escolha o transportador na ficha.</span>'}</div>
      ${sel('Tipo do proprietário *', 'prop.tp_prop', selOpts(MD.TP_PROP, m.prop.tp_prop))}${campo('Motorista *', 'condutor.nome')}${campo('CPF do motorista *', 'condutor.cpf')}</div>
    <h3 style="margin:14px 0 6px">5. Carga</h3>
    <div class="grid2">${campo('Peso bruto (kg) *', 'peso_kg', { tipo: 'number' })}${campo('Valor total da carga (R$) *', 'valor_carga', { tipo: 'number' })}
      ${sel('Tipo de carga *', 'prod.tp_carga', selOpts(MD.TP_CARGA, m.prod.tp_carga))}${campo('Produto predominante *', 'prod.nome', { ph: 'ex.: Embalagens plásticas', cls: 'grow' })}${campo('NCM', 'prod.ncm', { ph: '8 dígitos' })}</div>
    <h3 style="margin:14px 0 6px">6. CIOT</h3>
    <div class="grid2"><label>Nº do CIOT ${MD.ciotObrigatorio({ ...f, mdfe: m }, t) ? '*' : ''}<input id="mf-ciot" value="${esc(ciot)}" placeholder="12 dígitos, gerado pela IPEF" ${dis}></label>${campo('CPF/CNPJ de quem gerou o CIOT *', 'ciot_resp', { ph: 'IPLAMM (contratante) ou a transportadora' })}</div>
    ${aut ? `<h3 style="margin:14px 0 6px">7. Pagamento do frete ao autônomo</h3>
    <div class="grid2">${sel('Forma *', 'pag.forma', '<option value="ipef" ' + (m.pag.forma === 'ipef' ? 'selected' : '') + '>Pela IPEF (cartão/conta de pagamento)</option><option value="pix" ' + (m.pag.forma === 'pix' ? 'selected' : '') + '>Pix do autônomo</option><option value="banco" ' + (m.pag.forma === 'banco' ? 'selected' : '') + '>Conta bancária do autônomo</option>')}
      ${m.pag.forma === 'ipef' ? campo('CNPJ da IPEF *', 'pag.cnpj_ipef') : m.pag.forma === 'pix' ? campo('Chave Pix *', 'pag.pix') : campo('Banco (código) *', 'pag.banco') + campo('Agência *', 'pag.agencia')}
      ${sel('Pagamento *', 'pag.ind_pag', `<option value="0" ${m.pag.ind_pag !== '1' ? 'selected' : ''}>À vista</option><option value="1" ${m.pag.ind_pag === '1' ? 'selected' : ''}>A prazo</option>`)}
      <div class="small muted" style="align-self:end">Valor do contrato: <b>${money(f.valor)}</b> (da ficha)</div></div>
    ${m.pag.ind_pag === '1' ? `<div class="small" style="margin-top:6px"><b>Parcelas</b>${(m.pag.prazos || []).map((p, i) => `<div class="grid2" style="align-items:end">${campo(`Vencimento ${i + 1}`, `pag.prazos.${i}.venc`, { tipo: 'date' })}${campo('Valor (R$)', `pag.prazos.${i}.valor`, { tipo: 'number' })}</div>`).join('')}${pode ? '<button type="button" class="btn ghost small" id="mf-add-prazo">+ Parcela</button>' : ''}</div>` : ''}
    <div class="small" style="margin-top:6px"><b>Componentes do valor</b> <span class="muted">(se não informar, vai o valor total como "outros")</span>${(m.pag.comp || []).map((c, i) => `<div class="grid2" style="align-items:end">${sel(`Componente ${i + 1}`, `pag.comp.${i}.tp`, selOpts(MD.TP_COMP, c.tp))}${campo('Valor (R$)', `pag.comp.${i}.valor`, { tipo: 'number' })}</div>`).join('')}${pode ? '<button type="button" class="btn ghost small" id="mf-add-comp">+ Componente</button>' : ''}</div>` : ''}
    <h3 style="margin:14px 0 6px">${aut ? 8 : 7}. Seguro da carga</h3>
    <div class="grid2">${sel('Responsável pelo seguro', 'seguro.resp', selOpts(MD.RESP_SEG, m.seguro.resp))}${campo('Seguradora', 'seguro.nome', { cls: 'grow' })}${campo('CNPJ da seguradora', 'seguro.cnpj')}${campo('Nº da apólice', 'seguro.apolice')}
      <label class="grow">Averbações (separe por vírgula)<input data-aver value="${esc((m.seguro.averbacoes || []).join(', '))}" ${dis}></label></div>
    ${!f.pedagio_nao_ha && +f.pedagio_valor > 0 ? `<h3 style="margin:14px 0 6px">Vale-pedágio (${money(f.pedagio_valor)})</h3><div class="grid2">${campo('CNPJ do fornecedor do vale-pedágio *', 'pedagio.cnpj_forn')}${campo('CNPJ de quem pagou (se não for a IPLAMM)', 'pedagio.cnpj_pagador')}
      <div class="small muted" style="align-self:end">Nº do comprovante: ${esc(f.pedagio_comprovante || '—')} (da ficha)</div></div>` : ''}
    <label style="margin-top:10px">Informações complementares (vão no MDF-e)<input data-k="info" value="${esc(m.info || '')}" maxlength="5000" ${dis}></label>`;
    conferir();
  };
  pintar();
  corpo.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.k) setP(m, el.dataset.k, el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value);
    if (el.dataset.perc != null) m.percurso = el.value.toUpperCase().split(/[\s,;]+/).filter(Boolean);
    if (el.dataset.aver != null) m.seguro.averbacoes = el.value.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    if (el.id === 'mf-ciot') ciot = soDig(el.value);
    conferir();
  });
  corpo.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.mun) { const v = lerMun(el.value); const [lista, i] = el.dataset.mun.split('.'); m[lista][+i] = { ...(m[lista][+i] || {}), ...(v || { cmun: '', xmun: '', uf: '' }) }; el.value = munTxt(m[lista][+i]) || el.value; conferir(); }
    if (['pag.forma', 'pag.ind_pag'].includes(el.dataset.k)) pintar();
  });
  corpo.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'mf-add-desc') { m.descarga.push({ cmun: '', xmun: '', uf: '', chaves: [] }); return pintar(); }
    if (b.dataset.rmDesc != null) { m.descarga.splice(+b.dataset.rmDesc, 1); return pintar(); }
    if (b.dataset.rmCh) { const [i, j] = b.dataset.rmCh.split('.').map(Number); m.descarga[i].chaves.splice(j, 1); return pintar(); }
    if (b.dataset.addCh != null) { const i = +b.dataset.addCh, inp = corpo.querySelector(`[data-nova-ch="${i}"]`), c = soDig(inp.value);
      if (!MD.chaveValida(c)) return toast('Chave inválida: confira os 44 dígitos', true);
      if (MD.chavesDe(m).includes(c)) return toast('Esta NF-e já está no manifesto', true);
      (m.descarga[i].chaves ||= []).push(c); return pintar(); }
    if (b.id === 'mf-add-reb') { m.reboques.push({ placa: '', tara: null, cap_kg: null, uf: m.veiculo.uf || '', tp_car: m.veiculo.tp_car || '' }); return pintar(); }
    if (b.dataset.rmReb != null) { m.reboques.splice(+b.dataset.rmReb, 1); return pintar(); }
    if (b.id === 'mf-add-prazo') { (m.pag.prazos ||= []).push({ venc: '', valor: null }); return pintar(); }
    if (b.id === 'mf-add-comp') { (m.pag.comp ||= []).push({ tp: '01', valor: null }); return pintar(); }
    if (b.id === 'mf-nfe') {
      const nums = [...new Set(String(f.notas || '').split(/[^\d]+/).map(Number).filter(n => n > 0))];
      if (!nums.length && !f.carga_id) return toast('Informe os números das NF-e na ficha do frete (ou ligue a carga da logística)', true);
      b.disabled = true;
      try {
        const ns = await q(sb.rpc('log_mdfe_notas', { p_empresa: state.empresa.id, p_numeros: nums, p_carga: f.carga_id || null }));
        if (!ns.length) { toast('Nenhuma NF-e de saída encontrada com esses números. Importe os XML em CPD › Notas fiscais.', true); b.disabled = false; return; }
        const r = MD.descargaDasNotas(ns), faltam = nums.filter(n => !ns.some(x => x.numero === n));
        m.descarga = r.descarga; if (r.peso_kg) m.peso_kg = r.peso_kg; if (r.valor_carga) m.valor_carga = r.valor_carga;
        if (r.carregamento && !m.carregamento.some(c => c.cmun)) m.carregamento = r.carregamento;
        if (!m.uf_ini) m.uf_ini = r.carregamento?.[0]?.uf || m.uf_ini;
        const ufs = [...new Set(r.descarga.map(x => x.uf).filter(Boolean))]; if (ufs.length === 1) m.uf_fim = ufs[0];
        if (r.produto && !m.prod.nome) m.prod = { ...m.prod, nome: r.produto.nome, ncm: r.produto.ncm };
        pintar(); toast(`${ns.length} NF-e trazida(s)${faltam.length ? ` · não encontradas: ${faltam.join(', ')}` : ''}`);
      } catch (err) { fail(err); b.disabled = false; }
    }
  });
  const montarSalvar = () => {
    const limpo = JSON.parse(JSON.stringify(m));
    limpo.veiculo.placa = MD.limparPlaca(limpo.veiculo.placa); limpo.reboques.forEach(x => { x.placa = MD.limparPlaca(x.placa); });
    limpo.situacao = MD.prontoMDFe({ ...f, ciot, mdfe: limpo }, t, {}) ? 'pronto' : 'rascunho';
    return limpo;
  };
  $('#mf-ok', md.el) && ($('#mf-ok', md.el).onclick = async (ev) => {
    const mdfe = montarSalvar(); ev.target.disabled = true;
    try {
      await q(sb.from('log_fretes').update({ mdfe, ciot: ciot || null, placa: mdfe.veiculo.placa || f.placa || null, motorista: mdfe.condutor.nome || f.motorista || null }).eq('id', f.id));
      // guarda os dados do veículo no cadastro do transportador (próximo frete com a mesma placa já vem preenchido)
      if (t && mdfe.veiculo.placa) {
        const vs = [...(t.veiculos || [])], novos = [mdfe.veiculo, ...mdfe.reboques].filter(v => v.placa);
        for (const v of novos) { const i = vs.findIndex(o => o.placa === v.placa), d = { placa: v.placa, renavam: v.renavam || null, tara: v.tara || null, cap_kg: v.cap_kg || null, uf: v.uf || null, tp_rod: v.tp_rod || null, tp_car: v.tp_car || null };
          if (i >= 0) vs[i] = { ...vs[i], ...Object.fromEntries(Object.entries(d).filter(([, x]) => x != null)) }; else vs.push({ ...d, eixos: null, tipo: null }); }
        await q(sb.from('log_transportadores').update({ veiculos: vs }).eq('id', t.id)).catch(() => {});
      }
      md.close(); toast(mdfe.situacao === 'pronto' ? 'MDF-e pronto para emitir' : 'Dados do MDF-e salvos (ainda falta informação)'); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
  $('#mf-pad', md.el) && ($('#mf-pad', md.el).onclick = async () => {
    const pad = { ...B.P, seguro: m.seguro, prod: m.prod, carregamento: m.carregamento.filter(c => c.cmun), ciot_resp: m.ciot_resp,
      pag: { forma: m.pag.forma, cnpj_ipef: m.pag.cnpj_ipef || null, ind_pag: m.pag.ind_pag }, pedagio: { cnpj_forn: m.pedagio.cnpj_forn || null } };
    try {
      if (B.parId) await q(sb.from('log_parametros').update({ mdfe_padrao: pad }).eq('id', B.parId));
      else { const [r] = await q(sb.from('log_parametros').insert({ empresa_id: state.empresa.id, mdfe_padrao: pad }).select('id')); B.parId = r.id; }
      B.P = pad; toast('Padrões do MDF-e salvos: os próximos fretes já vêm com seguro, IPEF, produto e carregamento');
    } catch (err) { fail(err); }
  });
  $('#mf-res', md.el).onclick = () => resumoMDFe({ ...f, ciot, mdfe: montarSalvar() }, t);
  $('#mf-xml', md.el).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const [e] = await q(sb.rpc('log_mdfe_emitente', { p_empresa: state.empresa.id }));
      if (!e) throw new Error('Importe ao menos uma NF-e própria (com XML): o endereço do emitente vem dela.');
      const emp = { ...state.empresa, cnpj: state.empresa.cnpj || e.cnpj, ie: state.empresa.ie || e.ie, razao_social: state.empresa.razao_social || e.xnome };
      const ender = { xLgr: e.xlgr, nro: e.nro, xCpl: e.xcpl, xBairro: e.xbairro, cMun: e.cmun, xMun: e.xmun, CEP: e.cep, UF: e.uf, fone: e.fone };
      const { xml, chave } = gerarXMLMDFe({ ...f, ciot, mdfe: montarSalvar() }, t, emp, ender, { tpAmb: 2, serie: 999, nMDF: f.numero, padrao: B.P });
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
      a.download = `MDFe-teste-frete-${f.numero}.xml`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`XML de teste gerado (homologação, série 999, sem assinatura) · chave ${chave.slice(0, 6)}…`);
    } catch (err) { fail(err); }
    ev.target.disabled = false;
  };
}

function resumoMDFe(f, t) {
  const emp = state.empresa, x = MD.montarMDFe(f, t, emp, {}), d = MD.dadosMDFe(f, {}), fs = MD.faltasMDFe(f, t, {}), gr = MD.graves(fs);
  const lin = (r, v) => `<tr><th style="width:34%;text-align:left">${esc(r)}</th><td>${v}</td></tr>`;
  const rodo = x.infModal.rodo, vt = rodo.veicTracao;
  const corpo = `${gr.length ? `<p><b>Atenção — falta para emitir:</b> ${esc(gr.map(z => z.txt).join('; '))}.</p>` : '<p><b>Dados completos para emitir o MDF-e.</b></p>'}
    <h3>1. Identificação</h3><table>${lin('Emitente', `${esc(x.emit.xNome)} · CNPJ ${esc(fmtDoc(x.emit.CNPJ))}`)}${lin('Tipo de emitente', f.mdfe_emissor === 'iplamm' ? '2 — transportador de carga própria' : 'transportadora')}
      ${lin('UF de início → fim', `${esc(x.ide.UFIni)} → ${esc(x.ide.UFFim)}${x.ide.infPercurso.length ? ` · percurso: ${esc(x.ide.infPercurso.map(p => p.UFPer).join(', '))}` : ''}`)}
      ${lin('Carregamento', esc(x.ide.infMunCarrega.map(c => `${c.xMunCarrega} (${c.cMunCarrega})`).join('; ')))}</table>
    <h3>2. Documentos (NF-e) por município de descarga</h3><table>${x.infDoc.infMunDescarga.map(m => lin(`${m.xMunDescarga} (${m.cMunDescarga})`, m.infNFe.map(n => `<code>${esc(n.chNFe)}</code>`).join('<br>'))).join('') || lin('—', 'sem NF-e')}</table>
    <h3>3. Totais e carga</h3><table>${lin('Quantidade de NF-e', x.tot.qNFe)}${lin('Valor total da carga', money(x.tot.vCarga))}${lin('Peso bruto (kg)', (x.tot.qCarga || 0).toLocaleString('pt-BR'))}
      ${lin('Produto predominante', `${esc(MD.TP_CARGA[x.prodPred.tpCarga] || '')} · ${esc(x.prodPred.xProd || '')}${x.prodPred.NCM ? ` · NCM ${esc(x.prodPred.NCM)}` : ''}`)}</table>
    <h3>4. Rodoviário — ANTT</h3><table>${lin('CIOT', rodo.infANTT.infCIOT.map(c => `${esc(c.CIOT)} · responsável ${esc(fmtDoc(c.CPF || c.CNPJ))}`).join('<br>') || '<b>não informado</b>')}
      ${lin('Contratante', esc(rodo.infANTT.infContratante.map(c => `${c.xNome} · ${fmtDoc(c.CNPJ)}`).join('; ')))}
      ${rodo.infANTT.infPag.map(p => lin('Pagamento do frete', `${esc(p.xNome)} · ${esc(fmtDoc(p.CPF || p.CNPJ))}<br>Valor do contrato ${money(p.vContrato)} · ${p.indPag ? 'a prazo' : 'à vista'} · ${p.infBanc.CNPJIPEF ? 'IPEF CNPJ ' + esc(fmtDoc(p.infBanc.CNPJIPEF)) : p.infBanc.PIX ? 'Pix ' + esc(p.infBanc.PIX) : 'Banco ' + esc(p.infBanc.codBanco || '') + ' ag. ' + esc(p.infBanc.codAgencia || '')}
        <br>Componentes: ${esc(p.Comp.map(c => `${c.xComp} ${money(c.vComp)}`).join('; '))}${p.infPrazo ? '<br>Parcelas: ' + esc(p.infPrazo.map(z => `${z.nParcela} ${dateBR(z.dVenc)} ${money(z.vParcela)}`).join('; ')) : ''}`)).join('')}
      ${rodo.infANTT.valePed ? lin('Vale-pedágio', esc(rodo.infANTT.valePed.disp.map(v => `fornecedor ${fmtDoc(v.CNPJForn)} · comprovante ${v.nCompra} · ${money(v.vValePed)}`).join('; '))) : ''}</table>
    <h3>5. Veículo e motorista</h3><table>${lin('Veículo de tração', `${esc(vt.placa)} · RENAVAM ${esc(vt.RENAVAM || '—')} · tara ${vt.tara} kg${vt.capKG ? ` · cap. ${vt.capKG} kg` : ''} · ${esc(MD.TP_ROD[vt.tpRod] || '')} · ${esc(MD.TP_CAR[vt.tpCar] || '')} · ${esc(vt.UF)}`)}
      ${vt.prop ? lin('Proprietário', `${esc(vt.prop.xNome)} · ${esc(fmtDoc(vt.prop.CPF || vt.prop.CNPJ))} · RNTRC ${esc(vt.prop.RNTRC)} · ${esc(MD.TP_PROP[vt.prop.tpProp] || '')}`) : ''}
      ${rodo.veicReboque.map((r, i) => lin(`Reboque ${i + 1}`, `${esc(r.placa)} · tara ${r.tara} kg · cap. ${r.capKG} kg · ${esc(MD.TP_CAR[r.tpCar] || '')} · ${esc(r.UF)}`)).join('')}
      ${lin('Motorista', esc(vt.condutor.map(c => `${c.xNome} · CPF ${fmtDoc(c.CPF)}`).join('; ')))}</table>
    ${x.seg.length ? `<h3>6. Seguro</h3><table>${x.seg.map(s => lin('Seguro da carga', `${esc(MD.RESP_SEG[s.infResp.respSeg] || '')} · ${esc(s.infSeg.xSeg)} · CNPJ ${esc(fmtDoc(s.infSeg.CNPJ))} · apólice ${esc(s.nApol)}${s.nAver.length ? ' · averbação ' + esc(s.nAver.join(', ')) : ''}`)).join('')}</table>` : ''}
    ${d.info ? `<h3>Informações complementares</h3><p>${esc(d.info)}</p>` : ''}`;
  abrirRelatorio({ nome: `MDF-e do frete nº ${f.numero}`, titulo: `Dados do MDF-e — frete nº ${f.numero}`, subtitulo: `${t?.nome || ''} · ${dateBR(f.data)} · valor do frete ${money(f.valor)}`, corpo,
    rodape: 'Fonte: Logística › Fretes e CIOT (plataforma). Leiaute MDF-e 3.00 e NT 2026.001 (CIOT).' });
}

async function padroesMDFe(root) {
  const p = B.P || {}, s = p.seguro || {}, pr = p.prod || {}, pg = p.pag || {};
  await municipiosNF();
  const md = modal({ title: 'Padrões do MDF-e', wide: true, body: `<p class="small muted" style="margin-top:0">O que se repete em todo MDF-e da IPLAMM. Vem preenchido em cada frete (dá para mudar no frete).</p>
    <datalist id="pd-muns">${(MUNS || []).map(x => `<option value="${esc(munTxt(x))}">`).join('')}</datalist>
    <div class="grid2"><label class="grow">Município de carregamento<input id="pd-car" list="pd-muns" value="${esc(munTxt((p.carregamento || [])[0]))}"></label>
      <label>CPF/CNPJ de quem gera o CIOT<input id="pd-cr" value="${esc(p.ciot_resp || soDig(state.empresa.cnpj))}"></label>
      <label>Tipo de carga<select id="pd-tc" data-nobusca>${selOpts(MD.TP_CARGA, pr.tp_carga || '05')}</select></label><label class="grow">Produto predominante<input id="pd-pn" value="${esc(pr.nome || '')}" placeholder="ex.: Embalagens plásticas"></label><label>NCM<input id="pd-ncm" value="${esc(pr.ncm || '')}"></label>
      <label>Forma de pagar o autônomo<select id="pd-fp" data-nobusca><option value="ipef" ${pg.forma !== 'pix' && pg.forma !== 'banco' ? 'selected' : ''}>Pela IPEF</option><option value="pix" ${pg.forma === 'pix' ? 'selected' : ''}>Pix do autônomo</option><option value="banco" ${pg.forma === 'banco' ? 'selected' : ''}>Conta do autônomo</option></select></label>
      <label>CNPJ da IPEF contratada<input id="pd-ipef" value="${esc(pg.cnpj_ipef || '')}"></label>
      <label>Responsável pelo seguro<select id="pd-sr" data-nobusca>${selOpts(MD.RESP_SEG, s.resp || '1')}</select></label><label class="grow">Seguradora<input id="pd-sn" value="${esc(s.nome || '')}"></label><label>CNPJ da seguradora<input id="pd-sc" value="${esc(s.cnpj || '')}"></label><label>Nº da apólice<input id="pd-sa" value="${esc(s.apolice || '')}"></label>
      <label>CNPJ do fornecedor do vale-pedágio<input id="pd-vp" value="${esc(p.pedagio?.cnpj_forn || '')}"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pd-ok">Salvar</button>' });
  const g = (id) => $('#' + id, md.el).value.trim();
  $('#pd-ok', md.el).onclick = async () => {
    const car = lerMun(g('pd-car'));
    const pad = { ...p, carregamento: car?.cmun ? [car] : [], ciot_resp: soDig(g('pd-cr')), prod: { tp_carga: g('pd-tc') || '05', nome: g('pd-pn'), ncm: soDig(g('pd-ncm')) },
      pag: { ...pg, forma: g('pd-fp'), cnpj_ipef: soDig(g('pd-ipef')) || null }, seguro: { ...s, resp: g('pd-sr') || '1', nome: g('pd-sn'), cnpj: soDig(g('pd-sc')), apolice: g('pd-sa') }, pedagio: { cnpj_forn: soDig(g('pd-vp')) || null } };
    try {
      if (B.parId) await q(sb.from('log_parametros').update({ mdfe_padrao: pad }).eq('id', B.parId));
      else { const [r] = await q(sb.from('log_parametros').insert({ empresa_id: state.empresa.id, mdfe_padrao: pad }).select('id')); B.parId = r.id; }
      B.P = pad; md.close(); toast('Padrões do MDF-e salvos'); render(root);
    } catch (err) { fail(err); }
  };
}

// painel "MDF-e · 23/11": o que falta para emitir as viagens com CIOT
function prontidao(corpo, root) {
  if (B.semMdfe) { corpo.innerHTML = erroTela('o preparo do MDF-e'); return; }
  const pode = podeLogistica(), hoje = today(), dias = MD.diasAte(MD.DATA_CIOT_MDFE, hoje);
  const lim = new Date(); lim.setDate(lim.getDate() - 45); const desde = lim.toISOString().slice(0, 10);
  const fs = B.F.filter(f => f.status !== 'cancelado' && f.data >= desde).sort((a, b) => b.data.localeCompare(a.data));
  const info = fs.map(f => { const t = B.tById[f.transportador_id], fa = MD.faltasMDFe(f, t, B.P), gr = MD.graves(fa); return { f, t, gr, ciotFalta: MD.ciotObrigatorio(f, t) && !MD.ciotValido(f.ciot) }; });
  const ipl = info.filter(x => x.f.mdfe_emissor === 'iplamm'), prontos = ipl.filter(x => !x.gr.length), semCiot = ipl.filter(x => x.ciotFalta), semEm = info.filter(x => !x.f.mdfe_emissor);
  const P = B.P || {}, conf = [
    ['IPEF contratada (CNPJ nos padrões)', !!MD.docValido(P.pag?.cnpj_ipef)], ['Seguro da carga nos padrões', !!(P.seguro?.nome && P.seguro?.apolice)],
    ['Produto predominante nos padrões', !!P.prod?.nome], ['Município de carregamento nos padrões', !!(P.carregamento || []).some(c => c.cmun)],
    ['Transportadores autônomos com CPF/CNPJ e RNTRC', B.T.filter(t => t.ativo && ehAutonomo(t)).every(t => MD.docValido(t.documento) && MD.rntrcValido(t.rntrc))]];
  const kpi = (r, v, s = '', c = '') => `<div class="kpi"><div class="k-label">${r}</div><div class="k-value ${c}">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  corpo.innerHTML = `<div class="kpis">${kpi('CIOT no MDF-e', dias > 0 ? `${dias} dias` : 'em vigor', dias > 0 ? 'até 23/11/2026 (rejeição 684)' : 'MDF-e sem CIOT é recusado', dias <= 15 ? 'neg' : '')}
      ${kpi('Viagens com MDF-e da IPLAMM', ipl.length, 'últimos 45 dias e futuras')}${kpi('Prontas para emitir', prontos.length, ipl.length ? `${Math.round(prontos.length / ipl.length * 100)}%` : '', prontos.length === ipl.length && ipl.length ? 'pos' : '')}
      ${kpi('Sem CIOT', semCiot.length, semCiot.length ? 'seriam recusadas após 23/11' : 'nenhuma', semCiot.length ? 'neg' : '')}</div>
    <div class="grid2" style="margin-top:12px;align-items:start">
      <div class="card"><div class="card-head"><h3 style="margin:0">Preparação da empresa</h3>${pode ? '<button class="btn small" id="pr-pad">Padrões do MDF-e</button>' : ''}</div>
        ${conf.map(([t, ok]) => `<div class="small" style="padding:4px 0">${ok ? '<span class="pos">✓</span>' : '<span class="neg">✗</span>'} ${esc(t)}</div>`).join('')}
        <p class="small muted" style="margin-bottom:0">A IPEF gera o CIOT e paga o autônomo (Res. ANTT 6.078/2026). Sem IPEF contratada, o MDF-e com autônomo é recusado a partir de 23/11.</p></div>
      <div class="card"><h3 style="margin:0 0 6px">Como usar</h3><ol class="small" style="margin:0;padding-left:18px;line-height:1.6">
        <li>Na ficha do frete, escolha <b>Quem emite o MDF-e</b>.</li><li>Clique em <b>Dados do MDF-e</b> e use <b>Buscar NF-e</b>: chaves, destino, peso e valor vêm das notas.</li>
        <li>Complete veículo, motorista e CIOT. A lista em vermelho mostra o que falta.</li><li>Use o <b>Resumo para impressão</b> para emitir no Iniflex enquanto a emissão pela plataforma não estiver ligada.</li></ol></div></div>
    ${semEm.length ? `<div class="card warn small" style="margin-top:12px">${semEm.length} frete(s) sem "Quem emite o MDF-e" definido.</div>` : ''}
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Transportador</th><th>Emite o MDF-e</th><th>CIOT</th><th>Situação do MDF-e</th></tr></thead><tbody>
    ${info.map(({ f, t, gr, ciotFalta }) => `<tr class="clickable" data-id="${f.id}"><td><b>${f.numero}</b></td><td>${dateBR(f.data)}</td><td>${esc(t?.nome || '—')}<div class="small muted">${TIPO_CURTO[t?.tipo] || ''}</div></td>
      <td class="small">${f.mdfe_emissor === 'iplamm' ? 'IPLAMM' : f.mdfe_emissor === 'transportadora' ? 'Transportadora' : '<span class="warn">definir</span>'}</td>
      <td class="small">${MD.ciotValido(f.ciot) ? esc(f.ciot) : ciotFalta ? '<span class="neg">falta</span>' : '<span class="muted">—</span>'}</td>
      <td class="small">${f.mdfe_chave ? '<span class="badge pago">Emitido</span>' : f.mdfe_emissor !== 'iplamm' ? '<span class="muted">—</span>' : gr.length ? `<span class="badge vencido">Falta ${gr.length}</span><div class="muted">${esc(gr.slice(0, 3).map(x => x.txt).join('; '))}${gr.length > 3 ? '…' : ''}</div>` : '<span class="badge pago">Pronto para emitir</span>'}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nenhum frete nos últimos 45 dias. Cadastre em Fretes › Novo frete.</td></tr>'}</tbody></table></div></div>`;
  $('#pr-pad', corpo) && ($('#pr-pad', corpo).onclick = () => padroesMDFe(root));
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => { const f = B.F.find(x => x.id === tr.dataset.id); f.mdfe_emissor === 'iplamm' ? fichaMDFe(f, root) : ficha(f, root); });
}

// Logística › Gestão da frota (SQL 070): painel de custos, veículos (documentos e preventivas), manutenção, abastecimento,
// multas e motoristas. Acesso de quem edita a logística (admin, financeiro, diretor). Manutenção e multas geram conta a pagar.
import { sb, state, q, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, today, dateBR, money, options, erroTela } from '../lib/ui.js';
import { podeLogistica, TIPOS_VEICULO } from '../lib/logistica.js';
import * as F from '../lib/frota.js';
import { valorMensal } from '../lib/contratos.js';

export const title = 'Logística — gestão da frota';
const BUCKET = 'frota';
const ui = { aba: 'painel', mes: today().slice(0, 7), veic: '' };
let D = null;
const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const nf = (v, c = 0) => v == null || v === '' ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });

async function carregar() {
  const e = state.empresa.id; await loadCadastros();
  const seg = (p) => p.catch(() => []);
  const [V, M, Dc, P, Mn, A, Mu, C, R] = await Promise.all([
    q(sb.from('log_veiculos').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('frota_motoristas').select('*').eq('empresa_id', e).order('nome')),
    q(sb.from('frota_documentos').select('*').eq('empresa_id', e)),
    q(sb.from('frota_planos').select('*').eq('empresa_id', e)),
    q(sb.from('frota_manutencoes').select('*').eq('empresa_id', e).order('data', { ascending: false })),
    q(sb.from('frota_abastecimentos').select('*').eq('empresa_id', e).order('data', { ascending: false })),
    q(sb.from('frota_multas').select('*').eq('empresa_id', e).order('data_infracao', { ascending: false })),
    seg(q(sb.from('contratos').select('id,numero,parte_nome,objeto,valor,periodicidade,natureza,status').eq('empresa_id', e))),   // só admin lê contratos
    seg(q(sb.from('rh_colaboradores').select('id,nome,cpf,situacao').eq('empresa_id', e).order('nome'))),
  ]);
  D = { V, M, Dc, P, Mn, A, Mu, C, R, hoje: today(), vById: Object.fromEntries(V.map(v => [v.id, v])), mById: Object.fromEntries(M.map(m => [m.id, m])) };
  return D;
}
const nomeV = (id) => { const v = D.vById[id]; return v ? `${v.codigo}${v.placa ? ' · ' + v.placa : ''}` : '—'; };
const cls = (n) => n === 'neg' ? 'neg' : n === 'warn' ? 'warn' : 'muted';
const kpi = (r, v, s = '', c = '') => `<div class="kpi"><div class="k-label">${r}</div><div class="k-value ${c}">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;

export async function render(root) {
  if (!podeLogistica()) { root.innerHTML = '<div class="card"><div class="empty">Gestão da frota: acesso de administrador, financeiro ou diretor.</div></div>'; return; }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Gestão da frota</h2><div class="muted small">Documentos, manutenção, abastecimento, multas, motoristas e custo por quilômetro.</div></div>
      <a class="btn ghost" href="#/logistica/frota">Frota e parâmetros (cargas)</a></div>
    <div class="card toolbar"><div class="chips" id="gf-abas">${[['painel', 'Painel'], ['veic', 'Veículos'], ['manut', 'Manutenção'], ['abast', 'Abastecimento'], ['multas', 'Multas'], ['mot', 'Motoristas']]
      .map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div id="gf-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#gf-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  try { await carregar(); } catch (err) { console.error(err); $('#gf-corpo', root).innerHTML = erroTela('a gestão da frota'); return; }
  const c = $('#gf-corpo', root);
  const r = { painel, veic: veiculos, manut: manutencoes, abast: abastecimentos, multas, mot: motoristas }[ui.aba] || painel;
  try { r(c, root); } catch (err) { fail(err); }
}
const refazer = async (root) => { await carregar(); render(root); };

// ---------------------------------------------------------------- alertas (painel e Decision Center)
export async function alertasDecisao() { return podeLogistica() ? alertasFrota(await carregar()) : []; }
export function alertasFrota(B = D) {
  const out = [];
  for (const v of B.V.filter(x => x.situacao !== 'inativo')) {
    for (const d of F.situacaoDocs(B.Dc.filter(x => x.veiculo_id === v.id), B.hoje)) if (d.sit && d.sit.nivel !== 'ok') out.push({ nivel: d.sit.nivel, origem: v.codigo, txt: `${F.DOCS[d.tipo]}: ${d.sit.txt}` });
    for (const p of B.P.filter(x => x.veiculo_id === v.id && x.ativo)) { const s = F.preventiva(p, v.km_atual, B.hoje); if (s.nivel === 'neg' || s.nivel === 'warn') out.push({ nivel: s.nivel, origem: v.codigo, txt: `${p.descricao}: ${s.txt}` }); }
    const c = F.consumo(B.A.filter(a => a.veiculo_id === v.id)); const fm = F.foraDaMedia(c).filter(t => F.dias(t.data, B.hoje) <= 30);
    if (fm.length) out.push({ nivel: 'warn', origem: v.codigo, txt: `consumo ${nf(fm[0].kml, 2)} km/l em ${dateBR(fm[0].data)} (média ${nf(c.media, 2)})` });
  }
  for (const m of B.M) for (const a of F.alertasMotorista(m, B.hoje)) if (a.nivel !== 'info') out.push({ ...a, origem: m.nome });
  for (const mu of B.Mu) { const a = F.alertaMulta(mu, B.hoje); if (a) out.push({ ...a, origem: `Multa ${mu.auto_numero || ''} ${B.vById[mu.veiculo_id]?.codigo || ''}`.trim() }); }
  return out.sort((a, b) => (a.nivel === 'neg' ? 0 : 1) - (b.nivel === 'neg' ? 0 : 1));
}
const locacaoDe = (v) => { const c = v.contrato_id && D.C.find(x => x.id === v.contrato_id); return c && c.status === 'vigente' ? valorMensal(c) : 0; };

function painel(corpo, root) {
  const ativos = D.V.filter(v => v.situacao !== 'inativo');
  const linhas = ativos.map(v => ({ v, c: F.custoMes(v, ui.mes, { abast: D.A, manut: D.Mn, multas: D.Mu, locacaoMensal: locacaoDe(v) }), cons: F.consumo(D.A.filter(a => a.veiculo_id === v.id)) }));
  const tot = linhas.reduce((s, l) => ({ total: s.total + l.c.total, km: s.km + l.c.km, comb: s.comb + l.c.combustivel }), { total: 0, km: 0, comb: 0 });
  const al = alertasFrota();
  corpo.innerHTML = `<div class="kpis">${kpi('Veículos ativos', ativos.length, `${ativos.filter(v => v.propriedade !== 'proprio').length} locados/agregados`)}${kpi('Custo no mês', money(tot.total), `combustível ${money(tot.comb)}`)}
      ${kpi('Km rodados', nf(tot.km), 'pelo hodômetro dos abastecimentos')}${kpi('Custo por km', tot.km ? money(tot.total / tot.km) : '–', 'frota toda')}
      ${kpi('Alertas', al.length, al.filter(a => a.nivel === 'neg').length + ' urgentes', al.some(a => a.nivel === 'neg') ? 'neg' : al.length ? 'warn' : '')}</div>
    <div class="card toolbar" style="margin-top:12px"><label class="small" style="display:flex;gap:6px;align-items:center">Mês <input type="month" id="gf-mes" value="${ui.mes}"></label></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Veículo</th><th>Tipo</th><th class="num">Km no mês</th><th class="num">Combustível</th><th class="num">Manutenção</th><th class="num">Multas</th><th class="num">Locação</th><th class="num">Total</th><th class="num">Custo/km</th><th class="num">Km/l (média)</th><th class="num">Custo/km usado nas cargas</th></tr></thead><tbody>
      ${linhas.map(({ v, c, cons }) => `<tr><td><b>${esc(v.codigo)}</b><div class="small muted">${esc(v.placa || '')} · ${F.PROPRIEDADE[v.propriedade || 'proprio']}</div></td><td class="small">${esc(TIPOS_VEICULO[v.tipo] || v.tipo)}</td>
        <td class="num">${nf(c.km)}</td><td class="num">${money(c.combustivel)}</td><td class="num">${money(c.manutencao)}</td><td class="num">${money(c.multas)}</td><td class="num">${money(c.locacao)}</td><td class="num"><b>${money(c.total)}</b></td>
        <td class="num">${c.custoKm != null ? money(c.custoKm) : '–'}</td><td class="num">${cons.media != null ? nf(cons.media, 2) : '–'}</td>
        <td class="num">${v.custo_km != null ? money(v.custo_km) : '<span class="muted">—</span>'}${c.custoKm != null ? ` <button class="btn small ghost" data-ck="${v.id}" data-v="${c.custoKm}" title="Usar o custo/km deste mês na montagem das cargas">usar ${money(c.custoKm)}</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="11" class="empty">Nenhum veículo cadastrado. Inclua em Frota e parâmetros.</td></tr>'}</tbody></table></div></div>
    <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">Alertas</h3>${al.map(a => `<div class="small ${cls(a.nivel)}">• <b>${esc(a.origem)}</b> — ${esc(a.txt)}</div>`).join('') || '<div class="muted small">Nenhum alerta. Documentos, preventivas, motoristas e multas em dia.</div>'}</div>`;
  $('#gf-mes', corpo).onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; painel(corpo, root); } };
  $$('[data-ck]', corpo).forEach(b => b.onclick = async () => {
    if (!(await confirmDialog(`Usar ${money(+b.dataset.v)} por km como custo deste veículo na montagem das cargas?`))) return;
    try { await q(sb.from('log_veiculos').update({ custo_km: +b.dataset.v }).eq('id', b.dataset.ck)); toast('Custo por km atualizado'); refazer(root); } catch (err) { fail(err); }
  });
}

// ---------------------------------------------------------------- veículos
function veiculos(corpo, root) {
  corpo.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Veículo</th><th>Modelo</th><th>Propriedade</th><th class="num">Km atual</th><th>Documentos</th><th>Preventivas</th></tr></thead><tbody>
    ${D.V.map(v => { const docs = F.situacaoDocs(D.Dc.filter(d => d.veiculo_id === v.id), D.hoje); const ps = D.P.filter(p => p.veiculo_id === v.id && p.ativo);
      return `<tr class="clickable" data-id="${v.id}"><td><b>${esc(v.codigo)}</b><div class="small muted">${esc(v.placa || '')}${v.situacao !== 'disponivel' ? ' · ' + v.situacao : ''}</div></td>
        <td class="small">${esc(v.marca_modelo || '')}${v.ano_fab ? ` · ${v.ano_fab}/${v.ano_mod || v.ano_fab}` : ''}</td><td class="small">${F.PROPRIEDADE[v.propriedade || 'proprio']}</td>
        <td class="num">${nf(v.km_atual)}<div class="small muted">${v.km_atual_em ? dateBR(v.km_atual_em) : ''}</div></td>
        <td class="small" style="white-space:normal">${docs.map(d => `<span class="${cls(d.sit?.nivel)}">${F.DOCS[d.tipo]}${d.sit && d.sit.nivel !== 'ok' ? ': ' + d.sit.txt : ' ✓'}</span>`).join('<br>') || '<span class="muted">nenhum</span>'}</td>
        <td class="small" style="white-space:normal">${ps.map(p => { const s = F.preventiva(p, v.km_atual, D.hoje); return `<span class="${cls(s.nivel)}">${esc(p.descricao)}: ${esc(s.txt)}</span>`; }).join('<br>') || '<span class="muted">nenhuma</span>'}</td></tr>`; }).join('')
      || '<tr><td colspan="6" class="empty">Nenhum veículo. Inclua em Frota e parâmetros.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Capacidade, baú e parâmetros de montagem das cargas continuam em <a href="#/logistica/frota">Frota e parâmetros</a>.</p>`;
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => fichaVeiculo(D.vById[tr.dataset.id], root));
}

async function enviarArquivo(file, pasta) {
  if (!file) return null;
  if (file.size > 15 * 1024 * 1024) throw new Error('Arquivo acima de 15 MB');
  const nome = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${state.empresa.id}/${pasta}/${Date.now()}-${nome}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' }); if (error) throw error;
  return path;
}
async function abrirArquivo(path) { try { const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300); if (error) throw error; window.open(data.signedUrl, '_blank', 'noopener'); } catch (err) { fail(err); } }

function fichaVeiculo(v, root) {
  const docs = D.Dc.filter(d => d.veiculo_id === v.id).sort((a, b) => (b.validade || '').localeCompare(a.validade || ''));
  const ps = D.P.filter(p => p.veiculo_id === v.id);
  const md = modal({ title: `Veículo ${v.codigo}${v.placa ? ' · ' + v.placa : ''}`, wide: true, body: `
    <div class="grid2">
      <label>Marca e modelo<input id="v-mm" value="${esc(v.marca_modelo || '')}"></label><label>Cor<input id="v-cor" value="${esc(v.cor || '')}"></label>
      <label>Ano de fabricação<input id="v-af" type="number" value="${v.ano_fab ?? ''}"></label><label>Ano do modelo<input id="v-am" type="number" value="${v.ano_mod ?? ''}"></label>
      <label>RENAVAM<input id="v-ren" value="${esc(v.renavam || '')}"></label><label>Chassi<input id="v-ch" value="${esc(v.chassi || '')}"></label>
      <label>Propriedade<select id="v-pr">${Object.entries(F.PROPRIEDADE).map(([k, t]) => `<option value="${k}" ${k === (v.propriedade || 'proprio') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Contrato (locado/agregado)<select id="v-ct"><option value="">—</option>${D.C.map(c => `<option value="${c.id}" ${c.id === v.contrato_id ? 'selected' : ''}>nº ${c.numero} — ${esc(c.parte_nome)}</option>`).join('')}</select>
        ${D.C.length ? '' : '<span class="small muted">só administradores veem os contratos</span>'}</label>
      <label>Km atual<input id="v-km" type="number" value="${v.km_atual ?? ''}"><span class="small muted">atualizado sozinho pelos abastecimentos e manutenções</span></label>
    </div>
    <h3 style="margin:16px 0 6px">Documentos</h3>
    <div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Número</th><th>Validade</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${docs.map(d => { const s = F.validade(d.validade, D.hoje); return `<tr><td>${F.DOCS[d.tipo]}</td><td class="small">${esc(d.numero || '')}${d.emissor ? `<div class="muted">${esc(d.emissor)}</div>` : ''}</td>
        <td class="small ${cls(s?.nivel)}">${d.validade ? dateBR(d.validade) : '—'}</td><td class="num">${d.valor != null ? money(d.valor) : ''}</td>
        <td>${d.arquivo_path ? `<button class="btn small" data-arq="${esc(d.arquivo_path)}">Abrir</button>` : ''} <button class="btn small ghost" data-del-doc="${d.id}">Excluir</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nenhum documento.</td></tr>'}</tbody></table></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:8px">
      <label>Tipo<select id="d-t">${Object.entries(F.DOCS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Número / apólice<input id="d-n" style="width:150px"></label><label>Seguradora / órgão<input id="d-e" style="width:150px"></label>
      <label>Validade<input id="d-v" type="date"></label><label>Valor<input id="d-r" type="number" step="0.01" style="width:110px"></label>
      <input type="file" id="d-f" accept="application/pdf,image/png,image/jpeg" hidden><button class="btn" id="d-fb">Arquivo…</button><button class="btn primary" id="d-ok">Incluir documento</button></div>
    <h3 style="margin:16px 0 6px">Manutenção preventiva</h3>
    <div class="table-wrap"><table><thead><tr><th>Serviço</th><th>A cada</th><th>Última</th><th>Próxima</th><th></th></tr></thead><tbody>
      ${ps.map(p => { const s = F.preventiva(p, v.km_atual, D.hoje); return `<tr><td>${esc(p.descricao)}${p.ativo ? '' : ' <span class="muted">(inativo)</span>'}</td>
        <td class="small">${[p.a_cada_km && nf(p.a_cada_km) + ' km', p.a_cada_meses && p.a_cada_meses + ' meses'].filter(Boolean).join(' ou ')}</td>
        <td class="small">${p.ultima_data ? dateBR(p.ultima_data) : '—'}${p.ultimo_km ? ` · ${nf(p.ultimo_km)} km` : ''}</td><td class="small ${cls(s.nivel)}">${esc(s.txt)}</td>
        <td><button class="btn small ghost" data-del-pl="${p.id}">Excluir</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nenhum plano.</td></tr>'}</tbody></table></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:8px">
      <label class="grow">Serviço<input id="p-d" placeholder="ex.: troca de óleo e filtros"></label><label>A cada (km)<input id="p-k" type="number" style="width:110px"></label>
      <label>ou (meses)<input id="p-m" type="number" style="width:90px"></label><label>Última em<input id="p-u" type="date"></label><label>com km<input id="p-uk" type="number" style="width:110px"></label>
      <button class="btn primary" id="p-ok">Incluir plano</button></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="v-ok">Salvar veículo</button>' });
  const el = md.el, G = (id) => $('#' + id, el); let arq = null;
  G('d-fb').onclick = () => G('d-f').click(); G('d-f').onchange = (e) => { arq = e.target.files[0]; G('d-fb').textContent = arq ? arq.name.slice(0, 18) : 'Arquivo…'; };
  G('v-ok').onclick = async () => {
    try { await q(sb.from('log_veiculos').update({ marca_modelo: G('v-mm').value.trim() || null, cor: G('v-cor').value.trim() || null, ano_fab: +G('v-af').value || null, ano_mod: +G('v-am').value || null,
      renavam: G('v-ren').value.replace(/\D/g, '') || null, chassi: G('v-ch').value.trim().toUpperCase() || null, propriedade: G('v-pr').value, contrato_id: G('v-ct').value || (D.C.length ? null : v.contrato_id),
      km_atual: +G('v-km').value || null, km_atual_em: +G('v-km').value !== +v.km_atual ? D.hoje : v.km_atual_em }).eq('id', v.id)); toast('Veículo salvo'); md.close(); refazer(root); } catch (err) { fail(err); }
  };
  G('d-ok').onclick = async (ev) => {
    ev.target.disabled = true;
    try { const path = await enviarArquivo(arq, `veiculos/${v.id}`);
      await q(sb.from('frota_documentos').insert({ empresa_id: state.empresa.id, veiculo_id: v.id, tipo: G('d-t').value, numero: G('d-n').value.trim() || null, emissor: G('d-e').value.trim() || null,
        validade: G('d-v').value || null, valor: G('d-r').value ? +G('d-r').value : null, arquivo_path: path }));
      toast('Documento incluído'); md.close(); await carregar(); fichaVeiculo(D.vById[v.id], root); } catch (err) { fail(err); ev.target.disabled = false; }
  };
  G('p-ok').onclick = async () => {
    const k = +G('p-k').value || null, m = +G('p-m').value || null;
    if (!G('p-d').value.trim() || (!k && !m)) return toast('Informe o serviço e o intervalo em km ou meses', true);
    try { await q(sb.from('frota_planos').insert({ empresa_id: state.empresa.id, veiculo_id: v.id, descricao: G('p-d').value.trim(), a_cada_km: k, a_cada_meses: m, ultima_data: G('p-u').value || null, ultimo_km: +G('p-uk').value || null }));
      toast('Plano incluído'); md.close(); await carregar(); fichaVeiculo(D.vById[v.id], root); } catch (err) { fail(err); }
  };
  $$('[data-arq]', el).forEach(b => b.onclick = () => abrirArquivo(b.dataset.arq));
  $$('[data-del-doc]', el).forEach(b => b.onclick = async () => { if (!(await confirmDialog('Excluir este documento?'))) return; try { await q(sb.from('frota_documentos').delete().eq('id', b.dataset.delDoc)); md.close(); await carregar(); fichaVeiculo(D.vById[v.id], root); } catch (err) { fail(err); } });
  $$('[data-del-pl]', el).forEach(b => b.onclick = async () => { if (!(await confirmDialog('Excluir este plano de manutenção?'))) return; try { await q(sb.from('frota_planos').delete().eq('id', b.dataset.delPl)); md.close(); await carregar(); fichaVeiculo(D.vById[v.id], root); } catch (err) { fail(err); } });
}

// ---------------------------------------------------------------- conta a pagar (manutenção e multas)
function camposPagar(chave, sugestao) {
  const cad = state.cad, salvo = ls.get('gf-plano-' + chave, null);
  const sug = salvo || cad.contasPlano.find(p => sugestao.test(p.nome))?.id || null;
  return `<fieldset style="grid-column:1/-1;border:1px solid var(--line,#ddd);border-radius:8px;padding:8px 10px;margin:0"><legend class="small">Conta a pagar no fluxo</legend>
    <label style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="pg-on" checked style="width:auto"> Gerar lançamento em aberto</label>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:6px"><label>Vencimento<input type="date" id="pg-d"></label>
      <label style="grid-column:span 2">Conta do plano<select id="pg-p">${options(cad.contasPlano, { value: 'id', label: 'label', selected: sug, empty: '— escolha —' })}</select></label>
      <label>Conta bancária<select id="pg-c">${options(cad.contas, { empty: '—' })}</select></label></div></fieldset>`;
}
async function gerarPagar(el, chave, { valor, descricao, documento, favorecido_id = null, dataPadrao }) {
  if (!$('#pg-on', el)?.checked || !(+valor > 0)) return null;
  const plano = $('#pg-p', el).value; if (!plano) throw new Error('Escolha a conta do plano para a conta a pagar');
  ls.set('gf-plano-' + chave, plano);
  const [l] = await q(sb.from('lancamentos').insert({ empresa_id: state.empresa.id, data: $('#pg-d', el).value || dataPadrao, plano_id: plano, conta_id: $('#pg-c', el).value || null, favorecido_id,
    valor: +valor, status: 'Em aberto', descricao: descricao.slice(0, 250), documento, origem: 'frota' }).select('id'));
  return l.id;
}

// ---------------------------------------------------------------- manutenção
function manutencoes(corpo, root) {
  const xs = D.Mn.filter(m => (!ui.veic || m.veiculo_id === ui.veic) && m.data.slice(0, 7) <= ui.mes && m.data.slice(0, 7) >= addMesStr(ui.mes, -11));
  corpo.innerHTML = `<div class="card toolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${filtroVeic()}<span class="small muted">últimos 12 meses até</span><input type="month" id="gf-mes" value="${ui.mes}">
      <button class="btn primary" id="mn-novo" style="margin-left:auto">Registrar manutenção</button></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Data</th><th>Veículo</th><th>Tipo</th><th>Serviço</th><th>Oficina</th><th class="num">Km</th><th class="num">Valor</th><th>Fluxo</th><th></th></tr></thead><tbody>
      ${xs.map(m => `<tr><td>${dateBR(m.data)}</td><td>${esc(nomeV(m.veiculo_id))}</td><td class="small">${F.TIPOS_MANUT[m.tipo]}</td><td class="small" style="white-space:normal">${esc(m.descricao)}</td>
        <td class="small">${esc(m.oficina || state.cad.favById[m.favorecido_id]?.nome || '')}</td><td class="num">${nf(m.km)}</td><td class="num">${money(m.valor)}</td>
        <td class="small">${m.lancamento_id ? 'lançado' : '<span class="muted">—</span>'}</td><td>${m.arquivo_path ? `<button class="btn small" data-arq="${esc(m.arquivo_path)}">Nota</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="9" class="empty">Nenhuma manutenção no período.</td></tr>'}</tbody></table></div></div>
    <p class="small"><b>Total:</b> ${money(xs.reduce((s, m) => s + +m.valor, 0))}</p>`;
  ligarFiltros(corpo, root, manutencoes);
  $$('[data-arq]', corpo).forEach(b => b.onclick = () => abrirArquivo(b.dataset.arq));
  $('#mn-novo', corpo).onclick = () => novaManutencao(root);
}
const addMesStr = (m, n) => { const d = new Date(m + '-15T12:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
const filtroVeic = () => `<select id="gf-v"><option value="">Todos os veículos</option>${D.V.map(v => `<option value="${v.id}" ${v.id === ui.veic ? 'selected' : ''}>${esc(v.codigo)}${v.placa ? ' · ' + esc(v.placa) : ''}</option>`).join('')}</select>`;
function ligarFiltros(corpo, root, fn) {
  $('#gf-v', corpo).onchange = (e) => { ui.veic = e.target.value; fn(corpo, root); };
  const m = $('#gf-mes', corpo); if (m) m.onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; fn(corpo, root); } };
}

function novaManutencao(root) {
  const forn = state.cad.favorecidos.filter(f => f.ativo);
  const md = modal({ title: 'Registrar manutenção', wide: true, body: `<div class="grid2">
      <label>Veículo *<select id="m-v">${D.V.map(v => `<option value="${v.id}" ${v.id === ui.veic ? 'selected' : ''}>${esc(v.codigo)}${v.placa ? ' · ' + esc(v.placa) : ''}</option>`).join('')}</select></label>
      <label>Tipo<select id="m-t">${Object.entries(F.TIPOS_MANUT).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Plano preventivo atendido<select id="m-p"><option value="">—</option></select></label>
      <label>Data *<input type="date" id="m-d" value="${D.hoje}"></label><label>Km<input type="number" id="m-k"></label>
      <label>Oficina (beneficiário)<select id="m-f"><option value="">—</option>${forn.map(f => `<option value="${f.id}">${esc(f.label)}</option>`).join('')}</select></label>
      <label>ou nome da oficina<input id="m-o"></label>
      <label style="grid-column:1/-1">Serviço / peças *<input id="m-s" placeholder="ex.: troca de óleo, filtros e pastilhas de freio"></label>
      <label>Valor (R$)<input type="number" step="0.01" id="m-r"></label>
      <label>Nota / orçamento<input type="file" id="m-a" accept="application/pdf,image/png,image/jpeg"></label>
      ${camposPagar('manut', /manuten/i)}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="m-ok">Registrar</button>' });
  const el = md.el, G = (id) => $('#' + id, el);
  const planos = () => { G('m-p').innerHTML = '<option value="">—</option>' + D.P.filter(p => p.veiculo_id === G('m-v').value && p.ativo).map(p => `<option value="${p.id}">${esc(p.descricao)}</option>`).join(''); };
  planos(); G('m-v').onchange = planos; G('m-p').onchange = (e) => { if (e.target.value) { G('m-t').value = 'preventiva'; if (!G('m-s').value) G('m-s').value = D.P.find(p => p.id === e.target.value)?.descricao || ''; } };
  G('m-d').onchange = (e) => { if (!G('pg-d').value) G('pg-d').value = e.target.value; };
  G('m-ok').onclick = async (ev) => {
    if (!G('m-s').value.trim() || !G('m-d').value) return toast('Informe a data e o serviço', true);
    ev.target.disabled = true;
    try {
      const v = D.vById[G('m-v').value], fav = G('m-f').value || null, valor = +G('m-r').value || 0;
      const path = await enviarArquivo(G('m-a').files[0], `manutencao/${v.id}`);
      const lanc = await gerarPagar(el, 'manut', { valor, descricao: `Manutenção ${v.codigo}${v.placa ? ' ' + v.placa : ''} — ${G('m-s').value.trim()}`, documento: `MANUT ${v.codigo}`, favorecido_id: fav, dataPadrao: G('m-d').value });
      await q(sb.from('frota_manutencoes').insert({ empresa_id: state.empresa.id, veiculo_id: v.id, plano_id: G('m-p').value || null, data: G('m-d').value, km: +G('m-k').value || null, tipo: G('m-t').value,
        favorecido_id: fav, oficina: G('m-o').value.trim() || null, descricao: G('m-s').value.trim(), valor, lancamento_id: lanc, arquivo_path: path }));
      toast(lanc ? 'Manutenção registrada e lançada no fluxo' : 'Manutenção registrada'); md.close(); refazer(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ---------------------------------------------------------------- abastecimento
function abastecimentos(corpo, root) {
  const porV = {}; for (const v of D.V) porV[v.id] = F.consumo(D.A.filter(a => a.veiculo_id === v.id));
  const kml = {}; for (const c of Object.values(porV)) for (const t of c.trechos) kml[t.id] = t;
  const xs = D.A.filter(a => (!ui.veic || a.veiculo_id === ui.veic) && a.data.slice(0, 7) === ui.mes);
  const ult = ls.get('gf-abast', {});
  corpo.innerHTML = `<div class="card"><h3 style="margin:0 0 8px">Registrar abastecimento</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;align-items:end">
        <label>Veículo<select id="a-v">${D.V.filter(v => v.situacao !== 'inativo').map(v => `<option value="${v.id}" ${v.id === (ui.veic || ult.v) ? 'selected' : ''}>${esc(v.codigo)}${v.placa ? ' · ' + esc(v.placa) : ''}</option>`).join('')}</select></label>
        <label>Motorista<select id="a-m"><option value="">—</option>${D.M.filter(m => m.ativo).map(m => `<option value="${m.id}" ${m.id === ult.m ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>
        <label>Data<input type="date" id="a-d" value="${D.hoje}"></label><label>Km do hodômetro<input type="number" id="a-k"></label>
        <label>Litros<input type="number" step="0.001" id="a-l"></label><label>Valor (R$)<input type="number" step="0.01" id="a-r"></label>
        <label>Combustível<select id="a-c">${Object.entries(F.COMBUSTIVEL).map(([k, t]) => `<option value="${k}" ${k === (ult.c || 'diesel_s10') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Posto<input id="a-p" value="${esc(ult.p || '')}"></label>
        <label style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" id="a-t" checked style="width:auto"> Tanque cheio</label>
        <button class="btn primary" id="a-ok">Registrar</button></div>
      <div class="small muted" id="a-dica" style="margin-top:6px"></div></div>
    <div class="card toolbar" style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${filtroVeic()}<input type="month" id="gf-mes" value="${ui.mes}"></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Data</th><th>Veículo</th><th>Motorista</th><th class="num">Km</th><th class="num">Litros</th><th class="num">Valor</th><th class="num">R$/l</th><th class="num">Km/l</th><th>Posto</th><th></th></tr></thead><tbody>
      ${xs.map(a => { const t = kml[a.id], med = porV[a.veiculo_id]?.media, ruim = t && med && t.kml < med * 0.85;
        return `<tr><td>${dateBR(a.data)}</td><td>${esc(nomeV(a.veiculo_id))}</td><td class="small">${esc(D.mById[a.motorista_id]?.nome || '')}</td><td class="num">${nf(a.km)}</td><td class="num">${nf(a.litros, 2)}${a.tanque_cheio ? '' : ' <span class="muted small">parcial</span>'}</td>
          <td class="num">${money(a.valor)}</td><td class="num">${money(a.valor / a.litros)}</td><td class="num ${ruim ? 'neg' : ''}">${t ? nf(t.kml, 2) : '–'}${ruim ? `<div class="small">média ${nf(med, 2)}</div>` : ''}</td>
          <td class="small">${esc(a.posto || '')}</td><td><button class="btn small ghost" data-del="${a.id}" title="Excluir">✕</button></td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">Nenhum abastecimento no mês.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Km/l pelo método do tanque cheio: distância entre dois abastecimentos com tanque cheio ÷ litros colocados nesse intervalo. Em vermelho: consumo 15% pior que a média do veículo (vazamento, desvio, defeito ou erro de digitação). ARLA não entra no cálculo.</p>`;
  ligarFiltros(corpo, root, abastecimentos);
  const dica = () => { const v = D.vById[$('#a-v', corpo).value]; $('#a-dica', corpo).textContent = v?.km_atual ? `Último km registrado: ${nf(v.km_atual)} em ${dateBR(v.km_atual_em)}.` : ''; };
  dica(); $('#a-v', corpo).onchange = dica;
  $('#a-ok', corpo).onclick = async (ev) => {
    const G = (id) => $('#' + id, corpo), v = D.vById[G('a-v').value], km = +G('a-k').value, lt = +G('a-l').value, vl = +G('a-r').value;
    if (!v || !km || !lt || !(vl >= 0)) return toast('Informe veículo, km, litros e valor', true);
    if (v.km_atual && km < +v.km_atual && !(await confirmDialog(`O km ${nf(km)} é menor que o último registrado (${nf(v.km_atual)}). Registrar assim mesmo?`))) return;
    if (lt > 1200 && !(await confirmDialog(`${nf(lt, 2)} litros é muito para um abastecimento. Confirma?`))) return;
    ev.target.disabled = true;
    try {
      await q(sb.from('frota_abastecimentos').insert({ empresa_id: state.empresa.id, veiculo_id: v.id, motorista_id: G('a-m').value || null, data: G('a-d').value, km, litros: lt, valor: vl,
        combustivel: G('a-c').value, tanque_cheio: G('a-t').checked, posto: G('a-p').value.trim() || null }));
      ls.set('gf-abast', { v: v.id, m: G('a-m').value, c: G('a-c').value, p: G('a-p').value.trim() });
      toast('Abastecimento registrado'); refazer(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $$('[data-del]', corpo).forEach(b => b.onclick = async () => { if (!(await confirmDialog('Excluir este abastecimento?'))) return; try { await q(sb.from('frota_abastecimentos').delete().eq('id', b.dataset.del)); refazer(root); } catch (err) { fail(err); } });
}

// ---------------------------------------------------------------- multas
function multas(corpo, root) {
  const abertas = D.Mu.filter(m => !['paga', 'descontada', 'cancelada'].includes(m.situacao));
  const xs = D.Mu.filter(m => !ui.veic || m.veiculo_id === ui.veic);
  corpo.innerHTML = `<div class="kpis">${kpi('Multas em aberto', abertas.length, money(abertas.reduce((s, m) => s + +m.valor, 0)))}
      ${kpi('Indicar condutor', D.Mu.filter(m => m.situacao === 'a_indicar').length, 'dentro do prazo do auto', D.Mu.some(m => F.alertaMulta(m, D.hoje)?.nivel === 'neg') ? 'neg' : '')}
      ${kpi('Pontos no ano', D.Mu.filter(m => m.data_infracao.slice(0, 4) === D.hoje.slice(0, 4) && m.situacao !== 'cancelada').reduce((s, m) => s + (+m.pontos || 0), 0), 'soma de todos os motoristas')}</div>
    <div class="card toolbar" style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${filtroVeic()}<button class="btn primary" id="mu-novo" style="margin-left:auto">Registrar multa</button></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Infração</th><th>Veículo</th><th>Condutor</th><th>Auto</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
      ${xs.map(m => { const a = F.alertaMulta(m, D.hoje);
        return `<tr class="clickable" data-id="${m.id}"><td>${dateBR(m.data_infracao)}<div class="small muted" style="white-space:normal">${esc(m.infracao)}${m.pontos ? ` · ${m.pontos} pts` : ''}</div></td><td>${esc(nomeV(m.veiculo_id))}</td>
          <td class="small">${esc(D.mById[m.motorista_id]?.nome || '—')}</td><td class="small">${esc(m.auto_numero || '')}<div class="muted">${esc(m.orgao || '')}</div></td><td class="num">${money(m.valor)}</td>
          <td><span class="badge ${['paga', 'descontada'].includes(m.situacao) ? 'pago' : m.situacao === 'cancelada' ? '' : 'aberto'}">${F.SIT_MULTA[m.situacao]}</span>${m.desconto_folha ? '<div class="small muted">desconto em folha</div>' : ''}
          ${a ? `<div class="small ${cls(a.nivel)}">${esc(a.txt)}</div>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Nenhuma multa registrada.</td></tr>'}</tbody></table></div></div>`;
  ligarFiltros(corpo, root, multas);
  $('#mu-novo', corpo).onclick = () => fichaMulta(null, root);
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => fichaMulta(D.Mu.find(m => m.id === tr.dataset.id), root));
}
function fichaMulta(m0, root) {
  const m = m0 || { situacao: 'a_indicar', veiculo_id: ui.veic || D.V[0]?.id, data_infracao: D.hoje };
  const md = modal({ title: m0 ? 'Multa' : 'Registrar multa', wide: true, body: `<div class="grid2">
      <label>Veículo<select id="u-v">${D.V.map(v => `<option value="${v.id}" ${v.id === m.veiculo_id ? 'selected' : ''}>${esc(v.codigo)}${v.placa ? ' · ' + esc(v.placa) : ''}</option>`).join('')}</select></label>
      <label>Condutor<select id="u-m"><option value="">— a identificar —</option>${D.M.map(x => `<option value="${x.id}" ${x.id === m.motorista_id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Data da infração *<input type="date" id="u-d" value="${m.data_infracao || ''}"></label><label>Nº do auto<input id="u-n" value="${esc(m.auto_numero || '')}"></label>
      <label>Órgão autuador<input id="u-o" value="${esc(m.orgao || '')}" placeholder="ex.: DETRAN-PE, PRF"></label><label>Local<input id="u-l" value="${esc(m.local || '')}"></label>
      <label style="grid-column:1/-1">Infração *<input id="u-i" value="${esc(m.infracao || '')}" placeholder="ex.: transitar em velocidade superior à máxima em até 20%"></label>
      <label>Código<input id="u-c" value="${esc(m.codigo || '')}"></label><label>Pontos<input type="number" id="u-p" value="${m.pontos ?? ''}"></label>
      <label>Valor (R$)<input type="number" step="0.01" id="u-r" value="${m.valor ?? ''}"></label><label>Vencimento<input type="date" id="u-ve" value="${m.vencimento || ''}"></label>
      <label>Prazo para indicar o condutor<input type="date" id="u-pr" value="${m.prazo_indicacao || ''}"></label>
      <label>Situação<select id="u-s">${Object.entries(F.SIT_MULTA).map(([k, t]) => `<option value="${k}" ${k === m.situacao ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label style="grid-column:1/-1;flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="u-df" ${m.desconto_folha ? 'checked' : ''} style="width:auto"> Descontar do motorista em folha (termo de responsabilidade, art. 462, § 1º, da CLT)</label>
      <label>Notificação / auto (arquivo)<input type="file" id="u-a" accept="application/pdf,image/png,image/jpeg"></label>
      ${m.arquivo_path ? `<div><button class="btn small" id="u-ab">Abrir arquivo</button></div>` : '<div></div>'}
      <label style="grid-column:1/-1">Observação<input id="u-ob" value="${esc(m.observacao || '')}"></label>
      ${m.lancamento_id ? '<p class="small" style="grid-column:1/-1">Conta a pagar já lançada no fluxo.</p>' : camposPagar('multa', /multa/i)}</div>
    <p class="small muted">Indique o condutor dentro do prazo do auto: sem indicação, a multa por não identificação cai sobre a empresa. O motorista assina o formulário de identificação do condutor.</p>`,
    foot: `${m0 ? '<button class="btn danger" id="u-del" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="u-ok">Salvar</button>` });
  const el = md.el, G = (id) => $('#' + id, el);
  if (G('pg-d')) G('pg-d').value = m.vencimento || '';
  G('u-ve').onchange = (e) => { if (G('pg-d') && !G('pg-d').value) G('pg-d').value = e.target.value; };
  G('u-ab')?.addEventListener('click', () => abrirArquivo(m.arquivo_path));
  G('u-ok').onclick = async (ev) => {
    if (!G('u-d').value || !G('u-i').value.trim()) return toast('Informe a data e a infração', true);
    ev.target.disabled = true;
    try {
      const v = D.vById[G('u-v').value], valor = +G('u-r').value || 0;
      const path = await enviarArquivo(G('u-a').files[0], 'multas') || m.arquivo_path || null;
      const desc = G('u-df').checked;
      const lanc = m.lancamento_id || (['paga', 'cancelada'].includes(G('u-s').value) ? null : await gerarPagar(el, 'multa', { valor, descricao: `Multa ${v?.codigo || ''} ${v?.placa || ''} — ${G('u-i').value.trim()}${G('u-n').value ? ' · auto ' + G('u-n').value.trim() : ''}`, documento: G('u-n').value.trim() ? `AUTO ${G('u-n').value.trim()}` : 'MULTA', dataPadrao: G('u-ve').value || D.hoje }));
      const row = { empresa_id: state.empresa.id, veiculo_id: v?.id || null, motorista_id: G('u-m').value || null, data_infracao: G('u-d').value, auto_numero: G('u-n').value.trim() || null, orgao: G('u-o').value.trim() || null,
        local: G('u-l').value.trim() || null, infracao: G('u-i').value.trim(), codigo: G('u-c').value.trim() || null, pontos: +G('u-p').value || null, valor, vencimento: G('u-ve').value || null,
        prazo_indicacao: G('u-pr').value || null, situacao: G('u-s').value, desconto_folha: desc, arquivo_path: path, lancamento_id: lanc, observacao: G('u-ob').value.trim() || null };
      if (m0) await q(sb.from('frota_multas').update(row).eq('id', m0.id)); else await q(sb.from('frota_multas').insert(row));
      toast('Multa salva'); md.close(); refazer(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  G('u-del')?.addEventListener('click', async () => { if (!(await confirmDialog('Excluir esta multa? A conta a pagar no fluxo, se houver, continua lá.'))) return; try { await q(sb.from('frota_multas').delete().eq('id', m0.id)); md.close(); refazer(root); } catch (err) { fail(err); } });
}

// ---------------------------------------------------------------- motoristas
function motoristas(corpo, root) {
  corpo.innerHTML = `<div class="card toolbar" style="display:flex;justify-content:flex-end"><button class="btn primary" id="mo-novo">Incluir motorista</button></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Motorista</th><th>Vínculo</th><th>CNH</th><th>Toxicológico</th><th>MOPP</th><th>Termo</th><th>Alertas</th></tr></thead><tbody>
      ${D.M.map(m => { const al = F.alertasMotorista(m, D.hoje), v = (iso) => { const s = F.validade(iso, D.hoje); return iso ? `<span class="${cls(s.nivel === 'ok' ? '' : s.nivel)}">${dateBR(iso)}</span>` : '<span class="muted">—</span>'; };
        return `<tr class="clickable" data-id="${m.id}"><td><b>${esc(m.nome)}</b>${m.ativo ? '' : ' <span class="muted">(inativo)</span>'}<div class="small muted">${esc(m.cpf ? m.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '')}</div></td>
          <td class="small">${F.VINCULO[m.vinculo]}</td><td class="small">${esc(m.cnh_categoria || '')}${m.cnh_ear ? ' · EAR' : ''}<div>${v(m.cnh_validade)}</div></td><td class="small">${v(m.toxicologico_validade)}</td><td class="small">${v(m.mopp_validade)}</td>
          <td class="small">${m.termo_assinado_em ? dateBR(m.termo_assinado_em) : '<span class="muted">—</span>'}</td>
          <td class="small" style="white-space:normal">${al.map(a => `<div class="${cls(a.nivel)}">${esc(a.txt)}</div>`).join('')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Nenhum motorista cadastrado.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Toxicológico: obrigatório para CNH C, D e E (renovação periódica e exames na admissão e no desligamento do motorista empregado). O termo de responsabilidade pelo uso do veículo sai em Cadastros › Contratos › Minuta.</p>`;
  $('#mo-novo', corpo).onclick = () => fichaMotorista(null, root);
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => fichaMotorista(D.mById[tr.dataset.id], root));
}
function fichaMotorista(m0, root) {
  const m = m0 || { vinculo: 'empregado', ativo: true };
  const md = modal({ title: m0 ? m0.nome : 'Incluir motorista', wide: true, body: `<div class="grid2">
      <label>Colaborador (RH)<select id="o-co"><option value="">—</option>${D.R.filter(r => r.situacao !== 'desligado' || r.id === m.colaborador_id).map(r => `<option value="${r.id}" ${r.id === m.colaborador_id ? 'selected' : ''}>${esc(r.nome)}</option>`).join('')}</select>
        ${D.R.length ? '' : '<span class="small muted">sem acesso ao RH: digite os dados</span>'}</label>
      <label>Vínculo<select id="o-vi">${Object.entries(F.VINCULO).map(([k, t]) => `<option value="${k}" ${k === m.vinculo ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Nome *<input id="o-n" value="${esc(m.nome || '')}"></label><label>CPF<input id="o-cpf" value="${esc(m.cpf || '')}"></label>
      <label>CNH nº<input id="o-cn" value="${esc(m.cnh_numero || '')}"></label><label>Categoria<input id="o-cc" value="${esc(m.cnh_categoria || '')}" placeholder="ex.: D, E, AE"></label>
      <label>Validade da CNH<input type="date" id="o-cv" value="${m.cnh_validade || ''}"></label>
      <label style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="o-ear" ${m.cnh_ear ? 'checked' : ''} style="width:auto"> CNH com EAR (exerce atividade remunerada)</label>
      <label>Toxicológico — data do exame<input type="date" id="o-td" value="${m.toxicologico_data || ''}"></label>
      <label>Toxicológico — validade<input type="date" id="o-tv" value="${m.toxicologico_validade || ''}"><span class="small muted">sugestão: 2 anos e 6 meses após o exame; confira no laudo</span></label>
      <label>MOPP — validade<input type="date" id="o-mo" value="${m.mopp_validade || ''}"></label>
      <label>Termo de responsabilidade assinado em<input type="date" id="o-te" value="${m.termo_assinado_em || ''}"></label>
      <label style="grid-column:1/-1">Observação<input id="o-ob" value="${esc(m.observacao || '')}"></label>
      <label style="flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="o-at" ${m.ativo ? 'checked' : ''} style="width:auto"> Ativo</label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="o-ok">Salvar</button>' });
  const el = md.el, G = (id) => $('#' + id, el);
  G('o-co').onchange = (e) => { const r = D.R.find(x => x.id === e.target.value); if (r) { G('o-n').value = r.nome; if (r.cpf) G('o-cpf').value = r.cpf; } };
  G('o-td').onchange = (e) => { if (e.target.value && !G('o-tv').value) G('o-tv').value = F.addMeses(e.target.value, 30); };
  G('o-ok').onclick = async (ev) => {
    if (!G('o-n').value.trim()) return toast('Informe o nome', true);
    ev.target.disabled = true;
    const row = { empresa_id: state.empresa.id, colaborador_id: G('o-co').value || null, vinculo: G('o-vi').value, nome: G('o-n').value.trim().toUpperCase(), cpf: G('o-cpf').value.replace(/\D/g, '') || null,
      cnh_numero: G('o-cn').value.trim() || null, cnh_categoria: G('o-cc').value.trim().toUpperCase() || null, cnh_validade: G('o-cv').value || null, cnh_ear: G('o-ear').checked,
      toxicologico_data: G('o-td').value || null, toxicologico_validade: G('o-tv').value || null, mopp_validade: G('o-mo').value || null, termo_assinado_em: G('o-te').value || null,
      observacao: G('o-ob').value.trim() || null, ativo: G('o-at').checked };
    try { if (m0) await q(sb.from('frota_motoristas').update(row).eq('id', m0.id)); else await q(sb.from('frota_motoristas').insert(row)); toast('Motorista salvo'); md.close(); refazer(root); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
}

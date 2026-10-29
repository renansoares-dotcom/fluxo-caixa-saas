// Decisão do Dia: junta o que entra e o que sai no dia (e nos próximos dias) com os saldos dos bancos.
// Saldo de abertura = saldo pago das contas no fim do dia anterior (saldos_contas).
// Entradas: borderôs pendentes de aprovação (líquido na conta de crédito), recebimentos em aberto, o que já entrou (pago).
// Saídas: compromissos em aberto (contas a pagar), pagamentos antecipados aguardando autorização, o que já saiu (pago).
// Cada item pode ser ligado/desligado para simular a decisão; o saldo projetado (total e por banco) recalcula na hora.
// Fase 2: "Registrar decisão" grava a simulação (decisoes_dia), envia ao diretor para aprovar e, passado o dia,
// compara o decidido com o realizado (lançamentos pagos no dia, PAs, borderôs) e o saldo real dos bancos.
import { sb, state, q, fetchAll, pontas, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, cls, dateBR, today, fail, parseNum, loading, toast } from '../lib/ui.js';
import { dispararAvisos } from '../lib/notif.js';

export const title = 'Decisão do Dia';

const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } } };
const SEM = '__sem__';                       // itens sem banco definido
// bancos que entram por padrão: contas correntes e caixa (fora contas técnicas: bloqueio, reclassificação, sócio, vinculada)
const PADRAO = (c) => c && /^(conta corrente|caixa)$/i.test(c.tipo || '') && !/bloqueio|reclassif|socio|sócio|vinculada/i.test(c.nome || '');
const DIAS = 4;                               // dia escolhido + 3
const semana = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diaCurto = (d) => `${semana[new Date(d + 'T12:00:00').getDay()]} ${dateBR(d).slice(0, 5)}`;

const ui = { abertos: new Set(), dia: null, contas: null, minimo: ls.get('nc-min', 50000), vencidos: false, off: new Set(), on: new Set() };
let D = null;   // dados carregados

async function carregar() {
  const e = state.empresa.id, d0 = ui.dia, dN = addDias(d0, DIAS - 1);
  const seguro = (p, v = []) => p.catch(() => v);
  const [saldos, lancs, venc, pas, props, fundos] = await Promise.all([
    q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: addDias(d0, -1) })),
    fetchAll(() => sb.from('v_lancamentos').select('id,data,valor,plano_id,conta_id,conta_destino_id,descricao,documento,favorecido_nome,status,prioridade_efetiva,tipo')
      .eq('empresa_id', e).in('status', ['Pago', 'Em aberto']).gte('data', d0).lte('data', dN).order('data').order('id')),
    fetchAll(() => sb.from('v_lancamentos').select('id,data,valor,plano_id,conta_id,conta_destino_id,descricao,documento,favorecido_nome,status,prioridade_efetiva,tipo')
      .eq('empresa_id', e).eq('status', 'Em aberto').lt('data', d0).gte('data', addDias(d0, -120)).order('data').order('id')),
    seguro(q(sb.from('paraquedas').select('id,numero,razao_social,valor,data_pagamento,prioridade,status,conta_id,lancamento_id,descricao')
      .eq('empresa_id', e).in('status', ['aguardando', 'aprovado']).is('lancamento_id', null).lte('data_pagamento', dN).order('data_pagamento'))),
    seguro(q(sb.from('fidc_propostas').select('id,numero,fundo_id,data_operacao,status,valor_face,liquido,conta_credito_id,qtd_titulos')
      .eq('empresa_id', e).in('status', ['Pendente', 'Rascunho']).gte('data_operacao', addDias(d0, -7)).lte('data_operacao', dN).order('data_operacao'))),
    seguro(q(sb.from('fidc_fundos').select('id,nome,conta_credito_id').eq('empresa_id', e))),
  ]);
  // decisão registrada do dia (a mais recente) e as últimas decisões; null = tabela ainda não criada
  const decs = await Promise.resolve(sb.from('decisoes_dia').select('*').eq('empresa_id', e).order('data', { ascending: false }).order('numero', { ascending: false }).limit(40))
    .then(r => (r.error ? null : r.data)).catch(() => null);
  const fundo = Object.fromEntries(fundos.map(f => [f.id, f]));
  const itens = [];
  const daPonta = (l, origem) => {
    const prio = l.prioridade_efetiva || '';
    for (const p of pontas([l])) {
      const transf = !!l.conta_destino_id;
      itens.push({ key: `${origem}:${l.id}:${p.destino ? 'd' : 'o'}`, dia: origem === 'venc' ? d0 : l.data, venc: origem === 'venc' ? l.data : null,
        conta: p.conta_id || SEM, valor: p.sinal, fonte: origem === 'venc' ? 'vencido' : l.status === 'Pago' ? 'pago' : 'aberto', transf,
        desc: l.descricao || l.documento || '', fav: l.favorecido_nome || '', prio, fixo: l.status === 'Pago', lanc: l.id });
    }
  };
  for (const l of lancs) daPonta(l, 'lanc');
  for (const l of venc) if (l.tipo === 'S' || l.tipo === 'E') daPonta(l, 'venc');
  for (const p of pas) itens.push({ key: `pa:${p.id}`, dia: p.data_pagamento < d0 ? d0 : p.data_pagamento, venc: p.data_pagamento < d0 ? p.data_pagamento : null,
    conta: p.conta_id || SEM, valor: -+p.valor, fonte: 'pa', desc: `PA nº ${p.numero} · ${p.descricao || ''}`.trim(), fav: p.razao_social || '',
    prio: p.prioridade || '', fixo: false, st: p.status, ref: p.id });
  for (const p of props) {
    const f = fundo[p.fundo_id] || {};
    itens.push({ key: `bd:${p.id}`, dia: p.data_operacao < d0 ? d0 : p.data_operacao, venc: p.data_operacao < d0 ? p.data_operacao : null,
      conta: p.conta_credito_id || f.conta_credito_id || SEM, valor: +p.liquido || 0, fonte: 'bordero', desc: `Proposta de borderô nº ${p.numero} · ${p.qtd_titulos || 0} título(s), face ${money(p.valor_face)}`,
      fav: f.nome || '', prio: '', fixo: false, st: p.status, ref: p.id });
  }
    const dec = decs ? decs.find(x => x.data === d0) || null : null;
  let real = null;
  if (dec && d0 < today()) real = await realizado(dec).catch(() => null);
  return { d0, dias: Array.from({ length: DIAS }, (_, i) => addDias(d0, i)), saldos, itens, decs, dec, real };
}

// item está valendo na simulação?
function ligado(it) {
  if (it.fixo) return true;
  if (ui.off.has(it.key)) return false;
  if (ui.on.has(it.key)) return true;
  if (it.fonte === 'vencido') return ui.vencidos;
  if (it.fonte === 'bordero') return it.st === 'Pendente';      // rascunho entra desligado
  return true;
}

// transferência entre duas contas consideradas: não é entrada nem saída do total (só muda o banco a banco)
const interna = (it, contasSel) => it.transf && D.itens.filter(x => x.lanc === it.lanc && x.fonte === it.fonte).every(x => contasSel.has(x.conta));

function calcular() {
  const contasSel = new Set(ui.contas);
  const usa = (it) => it.conta === SEM || contasSel.has(it.conta);
  const porConta = new Map();
  for (const s of D.saldos) if (contasSel.has(s.conta_id)) porConta.set(s.conta_id, { id: s.conta_id, nome: s.nome, abertura: +s.saldo_pago || 0 });
  porConta.set(SEM, { id: SEM, nome: 'Sem banco definido', abertura: 0 });
  const dias = D.dias.map(d => ({ d, ini: 0, ent: 0, sai: 0, fim: 0, contas: new Map() }));
  let corr = new Map([...porConta.values()].map(c => [c.id, c.abertura]));
  for (const dd of dias) {
    dd.ini = [...corr.values()].reduce((a, v) => a + v, 0);
    const its = D.itens.filter(it => it.dia === dd.d && usa(it));
    // transferência entre duas contas selecionadas: entra e sai no mesmo total (fica no banco a banco)
    for (const it of its) {
      if (!ligado(it)) continue;
      corr.set(it.conta, (corr.get(it.conta) || 0) + it.valor);
      if (interna(it, contasSel)) continue;
      if (it.valor > 0) dd.ent += it.valor; else dd.sai += it.valor;
    }
    dd.fim = [...corr.values()].reduce((a, v) => a + v, 0);
    dd.contas = new Map(corr);
  }
  return { porConta, dias };
}

export async function render(root) {
  { const m = location.hash.match(/[?&]dia=(\d{4}-\d{2}-\d{2})/); if (m) { ui.dia = m[1]; ui.restaurado = null; } }
  ui.dia ||= today();
  root.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <label>Dia<input type="date" id="dd-dia" value="${ui.dia}"></label>
        <label>Caixa mínimo (R$)<input id="dd-min" inputmode="decimal" value="${money(ui.minimo)}" style="max-width:140px"></label>
        <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="dd-venc" ${ui.vencidos ? 'checked' : ''}> considerar títulos vencidos em aberto</label>
        <span class="spacer"></span>
        <button class="btn small" id="dd-reset">Desfazer simulação</button>
        <button class="btn small" id="dd-print">Imprimir</button>
      </div>
      <div id="dd-contas" class="dd-chips"></div>
      <p class="muted small" style="margin:8px 0 0">Saldo de abertura = saldo dos bancos no fim do dia anterior. Desmarque um item para simular adiar/não fazer; marque para incluir.
      Nada é gravado: é a simulação da decisão. Borderô em rascunho e títulos vencidos entram desmarcados.</p>
    </div>
    <div id="dd-corpo"></div>`;
  $('#dd-dia', root).onchange = (ev) => { ui.dia = ev.target.value || today(); ui.off.clear(); ui.on.clear(); ui.restaurado = null; recarregar(root); };
  $('#dd-min', root).onchange = (ev) => { ui.minimo = parseNum(ev.target.value) || 0; ls.set('nc-min', ui.minimo); ev.target.value = money(ui.minimo); pintar(root); };
  $('#dd-venc', root).onchange = (ev) => { ui.vencidos = ev.target.checked; pintar(root); };
  $('#dd-reset', root).onclick = () => { ui.off.clear(); ui.on.clear(); pintar(root); };
  $('#dd-print', root).onclick = () => window.print();
  await recarregar(root);
}

async function recarregar(root) {
  loading($('#dd-corpo', root));
  try { D = await carregar(); } catch (e) { fail(e); $('#dd-corpo', root).innerHTML = '<div class="card muted">Não foi possível carregar.</div>'; return; }
  const cad = state.cad.contaById || {};
  if (D.dec && ui.restaurado !== D.dec.id) {   // abre a simulação como foi registrada
    ui.restaurado = D.dec.id; ui.off.clear(); ui.on.clear();
    for (const it of D.dec.itens || []) (it.decisao === 'adiar' ? ui.off : ui.on).add(it.key);
    if (D.dec.contas?.length) ui.contas = D.dec.contas.filter(id => D.saldos.some(s => s.conta_id === id));
    if (+D.dec.minimo) ui.minimo = +D.dec.minimo;
  }
  if (!ui.contas) ui.contas = ls.get('dd-contas', null)?.filter(id => D.saldos.some(s => s.conta_id === id)) || D.saldos.filter(s => PADRAO(cad[s.conta_id])).map(s => s.conta_id);
  pintar(root);
}

function pintar(root) {
  if (!D) return;
  const ch = $('#dd-contas', root);
  const sel = new Set(ui.contas);
  const lista = D.saldos.filter(s => state.cad.contaById?.[s.conta_id]?.ativo !== false);
  ch.innerHTML = `<span class="small muted">Bancos:</span> ${lista.map(s => `<label class="dd-chip ${sel.has(s.conta_id) ? 'on' : ''}"><input type="checkbox" data-c="${s.conta_id}" ${sel.has(s.conta_id) ? 'checked' : ''}>${esc(s.nome)}</label>`).join('')}`;
  $$('input[data-c]', ch).forEach(i => i.onchange = () => { const s2 = new Set(ui.contas); i.checked ? s2.add(i.dataset.c) : s2.delete(i.dataset.c); ui.contas = [...s2]; ls.set('dd-contas', ui.contas); pintar(root); });

  const R = calcular(), d0 = R.dias[0], min = ui.minimo;
  const corBase = (v) => (v < 0 ? 'neg' : v < min ? 'warn' : 'pos');
  const contasSel = new Set(ui.contas), usa = (it) => it.conta === SEM || contasSel.has(it.conta);
  const its = D.itens.filter(it => it.dia === D.d0 && usa(it));
  const nomeConta = (id) => id === SEM ? 'sem banco' : (state.cad.contaById[id]?.nome || D.saldos.find(s => s.conta_id === id)?.nome || '?');
  const FONTE = { pago: 'realizado', aberto: 'em aberto', vencido: 'vencido', pa: 'pagamento antecipado', bordero: 'borderô' };
  const linha = (it) => {
    const on = ligado(it);
    return `<tr class="${on ? '' : 'dd-off'}"><td style="width:28px">${it.fixo ? '<span title="Já realizado (pago)">✓</span>' : `<input type="checkbox" data-k="${esc(it.key)}" ${on ? 'checked' : ''}>`}</td>
      <td class="wrap"><div>${esc(it.fav || it.desc || '—')}</div><div class="small muted">${it.fav ? esc(it.desc) + ' · ' : ''}${FONTE[it.fonte]}${it.venc ? ` de ${dateBR(it.venc)}` : ''}${it.st && it.fonte === 'bordero' ? ` · ${esc(it.st)}` : ''}${it.st && it.fonte === 'pa' ? ` · ${esc(it.st)}` : ''}${it.prio ? ` · <span class="badge ${it.prio === 'Obrigatório' ? 'obrig' : 'negoc'}">${esc(it.prio)}</span>` : ''}</div></td>
      <td class="small">${esc(nomeConta(it.conta))}</td><td class="num ${cls(it.valor)}">${money(it.valor)}</td></tr>`;
  };
  const MAXG = 8;   // grupos longos (ex.: vencidos) mostram os maiores e um "ver todos"
  const grupo = (titulo, arr) => {
    if (!arr.length) return '';
    const ord = arr.sort((a, b) => (ligado(b) - ligado(a)) || Math.abs(b.valor) - Math.abs(a.valor));
    const todos = ui.abertos.has(titulo) || ord.length <= MAXG, vis = todos ? ord : ord.slice(0, MAXG);
    return `<tr class="dd-gr"><td colspan="3">${titulo} <span class="muted small">(${arr.length})</span></td><td class="num">${money(arr.filter(ligado).reduce((a, it) => a + it.valor, 0))}</td></tr>${vis.map(linha).join('')}
      ${ord.length > MAXG ? `<tr><td colspan="4"><button class="btn small" data-g="${esc(titulo)}">${todos ? 'Mostrar menos' : `Ver todos (${ord.length})`}</button></td></tr>` : ''}`;
  };
  const int_ = (it) => interna(it, contasSel);
  const ent = its.filter(it => it.valor > 0 && !int_(it)), sai = its.filter(it => it.valor < 0 && !int_(it)), trf = its.filter(int_);
  const porF = (arr, f) => arr.filter(it => it.fonte === f);

  // banco a banco no dia escolhido
  const contas = [...R.porConta.values()].filter(c => c.id !== SEM || its.some(it => it.conta === SEM));
  const movConta = (cid, sinal) => its.filter(it => it.conta === cid && ligado(it) && Math.sign(it.valor) === sinal).reduce((a, it) => a + it.valor, 0);
  const tabBancos = `<table><thead><tr><th>Banco</th><th class="num">Abertura</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Fim do dia (projetado)</th></tr></thead><tbody>
    ${contas.map(c => { const ab = c.id === SEM ? 0 : c.abertura; const e2 = movConta(c.id, 1), s2 = movConta(c.id, -1), f2 = d0.contas.get(c.id) ?? ab + e2 + s2;
      return `<tr><td>${esc(c.nome)}</td><td class="num">${c.id === SEM ? '—' : money(ab)}</td><td class="num pos">${money(e2)}</td><td class="num neg">${money(s2)}</td><td class="num ${f2 < -0.005 ? 'neg' : ''}"><strong>${money(f2)}</strong></td></tr>`; }).join('')}
    </tbody><tfoot><tr><th>Total</th><th class="num">${money(d0.ini)}</th><th class="num pos">${money(d0.ent)}</th><th class="num neg">${money(d0.sai)}</th><th class="num ${corBase(d0.fim)}">${money(d0.fim)}</th></tr></tfoot></table>`;

  // sugestões
  const sug = [];
  const falta = min - d0.fim;
  if (falta > 0.005) {
    sug.push(`<strong>Falta ${money(falta)}</strong> para fechar o dia no caixa mínimo (${money(min)}).`);
    const negoc = sai.filter(it => !it.fixo && ligado(it) && !/obrigat|urgente/i.test(it.prio) && it.fonte !== 'pago').sort((a, b) => a.valor - b.valor);
    let acc = 0; const cobre = []; for (const it of negoc) { if (acc >= falta) break; acc += -it.valor; cobre.push(it); }
    if (cobre.length) sug.push(`Adiar ${cobre.length} pagamento(s) negociável(is) libera ${money(acc)}: ${cobre.slice(0, 5).map(it => esc(it.fav || it.desc)).join(', ')}${cobre.length > 5 ? '…' : ''}.`);
    const bdPend = ent.filter(it => it.fonte === 'bordero' && !ligado(it));
    if (bdPend.length) sug.push(`Há ${bdPend.length} borderô(s) fora da conta (rascunho/desmarcado) somando ${money(bdPend.reduce((a, it) => a + it.valor, 0))}.`);
    sug.push(`Antecipar recebíveis: <a href="#/fidc-propostas">montar proposta de borderô</a> · ver <a href="#/necessidade-caixa">necessidade de caixa</a>.`);
  } else sug.push(`O dia fecha <strong>${money(d0.fim - min)}</strong> acima do caixa mínimo.`);
  const pasAg = sai.filter(it => it.fonte === 'pa' && it.st === 'aguardando');
  if (pasAg.length && falta <= 0.005) sug.push(`${pasAg.length} pagamento(s) antecipado(s) aguardando autorização cabem no saldo: <a href="#/paraquedas">autorizar</a>.`);
  for (const c of contas) { if (c.id === SEM) continue; const f2 = d0.contas.get(c.id); if (f2 < -0.005) {
    const doador = contas.filter(o => o.id !== SEM && o.id !== c.id && (d0.contas.get(o.id) || 0) > -f2).sort((a, b) => d0.contas.get(b.id) - d0.contas.get(a.id))[0];
    sug.push(`<strong>${esc(c.nome)}</strong> termina negativo (${money(f2)})${doador ? `: transferir de ${esc(doador.nome)} (fica com ${money(d0.contas.get(doador.id))})` : ''}.`); } }
  const sb2 = its.filter(it => it.conta === SEM && ligado(it));
  if (sb2.length) sug.push(`${sb2.length} item(ns) sem banco definido (${money(sb2.reduce((a, it) => a + it.valor, 0))}): defina de qual conta sai/entra.`);

  $('#dd-corpo', root).innerHTML = `
    <div class="dd-dias">${R.dias.map((dd, i) => `<div class="kpi dd-dia ${i === 0 ? 'atual' : ''}"><div class="k-label">${diaCurto(dd.d)}${i === 0 ? ' · escolhido' : ''}</div>
      <div class="k-value ${corBase(dd.fim)}">${money(dd.fim)}</div><div class="k-sub">abre ${money(dd.ini)} · +${money(dd.ent)} · ${money(dd.sai)}</div></div>`).join('')}</div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Saldo de abertura</div><div class="k-value">${money(d0.ini)}</div><div class="k-sub">bancos no fim de ${dateBR(addDias(D.d0, -1))}</div></div>
      <div class="kpi"><div class="k-label">Entradas</div><div class="k-value pos">${money(d0.ent)}</div><div class="k-sub">${ent.filter(ligado).length} item(ns) considerados</div></div>
      <div class="kpi"><div class="k-label">Saídas</div><div class="k-value neg">${money(d0.sai)}</div><div class="k-sub">${sai.filter(ligado).length} item(ns) considerados</div></div>
      <div class="kpi"><div class="k-label">Saldo projetado no fim do dia</div><div class="k-value ${corBase(d0.fim)}">${money(d0.fim)}</div><div class="k-sub">mínimo ${money(min)} · ${d0.fim >= min ? 'sobra' : 'falta'} ${money(Math.abs(d0.fim - min))}</div></div>
    </div>
    ${painelDecisao(R)}
    <div class="card dd-sug"><h2>Decisão sugerida</h2><ul>${sug.map(s => `<li>${s}</li>`).join('')}</ul></div>
    <div class="card flush"><div style="padding:14px 16px 0"><h2>Saldos por banco · ${dateBR(D.d0)}</h2></div><div class="table-wrap">${tabBancos}</div></div>
    <div class="grid2 dd-listas">
      <div class="card flush"><div style="padding:14px 16px 0"><h2>Entradas · ${money(ent.filter(ligado).reduce((a, it) => a + it.valor, 0))}</h2></div><div class="table-wrap"><table><tbody>
        ${grupo('Borderôs (propostas)', porF(ent, 'bordero'))}${grupo('Recebimentos em aberto', porF(ent, 'aberto'))}${grupo('Recebimentos vencidos', porF(ent, 'vencido'))}${grupo('Já entrou (realizado)', porF(ent, 'pago'))}
        ${ent.length ? '' : '<tr><td class="muted">Nenhuma entrada prevista.</td></tr>'}</tbody></table></div></div>
      <div class="card flush"><div style="padding:14px 16px 0"><h2>Saídas · ${money(sai.filter(ligado).reduce((a, it) => a + it.valor, 0))}</h2></div><div class="table-wrap"><table><tbody>
        ${grupo('Compromissos do dia (a pagar)', porF(sai, 'aberto'))}${grupo('Pagamentos antecipados', porF(sai, 'pa'))}${grupo('Vencidos em aberto', porF(sai, 'vencido'))}${grupo('Já saiu (realizado)', porF(sai, 'pago'))}
        ${sai.length ? '' : '<tr><td class="muted">Nenhuma saída prevista.</td></tr>'}</tbody></table></div></div>
    </div>
    ${trf.length ? `<div class="card flush"><div style="padding:14px 16px 0"><h2>Transferências entre contas</h2><p class="small muted" style="margin:4px 0 0">Não mudam o total, só o saldo de cada banco.</p></div><div class="table-wrap"><table><tbody>${trf.map(linha).join('')}</tbody></table></div></div>` : ''}
    ${painelRealizado()}${painelHistorico()}`;
  ligarPainel(root, R);
  $$('#dd-corpo button[data-g]', root).forEach(b => b.onclick = () => { const g = b.dataset.g; ui.abertos.has(g) ? ui.abertos.delete(g) : ui.abertos.add(g); pintar(root); });
  $$('#dd-corpo input[data-k]', root).forEach(i => i.onchange = () => {
    const it = D.itens.find(x => x.key === i.dataset.k); if (!it) return;
    // a mesma transferência tem duas pontas: liga/desliga as duas
    const chaves = it.transf ? D.itens.filter(x => x.lanc && x.lanc === it.lanc).map(x => x.key) : [it.key];
    for (const k of chaves) { ui.off.delete(k); ui.on.delete(k); (i.checked ? ui.on : ui.off).add(k); }
    pintar(root);
  });
}

// ---------------------------------------------------------------------------------------------
// Decidido × realizado (dia que já passou): situação atual de cada item da decisão
async function realizado(dec) {
  const its = dec.itens || [];
  const lids = [...new Set(its.filter(i => i.lanc).map(i => i.lanc))];
  const pids = its.filter(i => i.fonte === 'pa' && i.ref).map(i => i.ref), bids = its.filter(i => i.fonte === 'bordero' && i.ref).map(i => i.ref);
  const [ls_, pas, bds, sal] = await Promise.all([
    lids.length ? q(sb.from('lancamentos').select('id,status,data').in('id', lids)) : [],
    pids.length ? q(sb.from('paraquedas').select('id,status,lancamento_id,data_pagamento').in('id', pids)) : [],
    bids.length ? q(sb.from('fidc_propostas').select('id,status,data_operacao').in('id', bids)) : [],
    q(sb.rpc('saldos_contas', { p_empresa: dec.empresa_id, p_ate: dec.data })),
  ]);
  const L = Object.fromEntries(ls_.map(l => [l.id, l])), P = Object.fromEntries(pas.map(x => [x.id, x])), B = Object.fromEntries(bds.map(x => [x.id, x]));
  const plids = pas.map(x => x.lancamento_id).filter(Boolean);
  const PL = plids.length ? Object.fromEntries((await q(sb.from('lancamentos').select('id,status,data').in('id', plids))).map(l => [l.id, l])) : {};
  const feito = (it) => {
    if (it.fixo) return true;
    if (it.lanc) { const l = L[it.lanc]; return !!l && l.status === 'Pago' && l.data === dec.data; }
    if (it.fonte === 'pa') { const x = P[it.ref]; const l = x?.lancamento_id && PL[x.lancamento_id]; return !!l && l.status === 'Pago' && l.data === dec.data; }
    if (it.fonte === 'bordero') { const x = B[it.ref]; return !!x && x.status === 'Aprovada' && x.data_operacao === dec.data; }
    return false;
  };
  const linhas = its.filter(it => !it.fixo).map(it => ({ ...it, feito: feito(it) }));
  const saldoReal = sal.filter(x => (dec.contas || []).includes(x.conta_id)).reduce((a, x) => a + (+x.saldo_pago || 0), 0);
  return { linhas, saldoReal };
}

function itensParaGravar() {
  const contasSel = new Set(ui.contas);
  return D.itens.filter(it => it.dia === D.d0 && (it.conta === SEM || contasSel.has(it.conta)))
    .map(it => ({ key: it.key, fonte: it.fonte, ref: it.ref || null, lanc: it.lanc || null, conta: it.conta, valor: Math.round(it.valor * 100) / 100,
      desc: it.desc, fav: it.fav, prio: it.prio, fixo: !!it.fixo, venc: it.venc || null, decisao: ligado(it) ? 'incluir' : 'adiar' }));
}

function resumoTexto(R) {
  const d0 = R.dias[0], its = itensParaGravar(), nomeConta = (id) => id === SEM ? 'sem banco' : (state.cad.contaById[id]?.nome || '?');
  const sec = (tit, arr) => arr.length ? `\n*${tit}*\n` + arr.map(i => `• ${i.fav || i.desc} — ${money(Math.abs(i.valor))} (${nomeConta(i.conta)})`).join('\n') : '';
  const inc = its.filter(i => i.decisao === 'incluir' && !i.fixo), adi = its.filter(i => i.decisao === 'adiar');
  return `*Decisão do dia ${dateBR(D.d0)}* — ${state.empresa.nome || ''}
Abertura: ${money(d0.ini)}
Entradas: ${money(d0.ent)}
Saídas: ${money(d0.sai)}
*Saldo projetado: ${money(d0.fim)}* (mínimo ${money(ui.minimo)})`
    + sec('Entra', inc.filter(i => i.valor > 0)) + sec('Paga', inc.filter(i => i.valor < 0)) + sec('Fica para depois', adi)
    + ($('#dd-obs')?.value ? `\n\nObs.: ${$('#dd-obs').value}` : '');
}

async function gravar(root, R, status) {
  const d0 = R.dias[0];
  const row = { empresa_id: state.empresa.id, data: D.d0, status, contas: ui.contas, minimo: ui.minimo, abertura: +d0.ini.toFixed(2), entradas: +d0.ent.toFixed(2),
    saidas: +d0.sai.toFixed(2), saldo_fim: +d0.fim.toFixed(2), itens: itensParaGravar(), observacao: $('#dd-obs', root)?.value || null };
  try {
    if (D.dec && ['Rascunho', 'Pendente', 'Rejeitada'].includes(D.dec.status)) await q(sb.from('decisoes_dia').update(row).eq('id', D.dec.id));
    else await q(sb.from('decisoes_dia').insert(row));
    toast(status === 'Pendente' ? 'Decisão enviada para aprovação do diretor' : 'Decisão salva');
    if (status === 'Pendente') dispararAvisos();
    ui.restaurado = null; await recarregar(root);
  } catch (e) { fail(e); }
}

function painelDecisao(R) {
  if (D.decs === null) return `<div class="card" style="border-color:var(--warn)"><strong>Registrar decisão:</strong> <span class="small">não foi possível carregar as decisões. Recarregue a página.</span></div>`;
  const dec = D.dec, ed = podeEditar(), dir = ['diretor', 'admin'].includes(state.papel);
  const st = dec?.status || 'Nova', bcls = { Aprovada: 'pago', Pendente: 'aberto', Rejeitada: 'vencido', Rascunho: '' }[st] || '';
  const podeMexer = ed && (!dec || ['Rascunho', 'Pendente', 'Rejeitada'].includes(dec.status));
  const info = dec ? `nº ${dec.numero} · <span class="badge ${bcls}">${esc(st)}</span>${dec.enviado_em ? ` · enviada ${new Date(dec.enviado_em).toLocaleString('pt-BR')}` : ''}${dec.decidido_em ? ` · ${st.toLowerCase()} em ${new Date(dec.decidido_em).toLocaleString('pt-BR')}` : ''}${dec.motivo ? ` · “${esc(dec.motivo)}”` : ''}
    ${Math.abs(+dec.saldo_fim - R.dias[0].fim) > 0.005 ? `<div class="small" style="color:var(--warn)">A simulação atual (${money(R.dias[0].fim)}) difere da registrada (${money(dec.saldo_fim)}). ${podeMexer ? 'Salve de novo para atualizar.' : ''}</div>` : ''}` : '<span class="muted">ainda não registrada</span>';
  return `<div class="card dd-reg"><div class="toolbar" style="align-items:flex-start">
      <div class="grow"><h2 style="margin:0 0 4px">Registro da decisão</h2><div class="small">${info}</div></div>
      <button class="btn small" id="dd-copiar">Copiar resumo (WhatsApp)</button>
    </div>
    <label class="grow" style="display:block;margin-top:8px">Observação<textarea id="dd-obs" rows="2" ${podeMexer ? '' : 'disabled'} placeholder="ex.: adiar Kratos para sexta; borderô Negocial aprovado por telefone">${esc(dec?.observacao || '')}</textarea></label>
    <div class="toolbar" style="margin-top:8px">
      ${podeMexer ? `<button class="btn" id="dd-salvar">Salvar rascunho</button><button class="btn primary" id="dd-enviar">${dec?.status === 'Pendente' ? 'Atualizar e reenviar' : 'Enviar para aprovação'}</button>` : ''}
      ${ed && dec && ['Rascunho', 'Rejeitada'].includes(dec.status) ? '<button class="btn ghost" id="dd-excluir">Excluir</button>' : ''}
      ${dir && dec?.status === 'Pendente' ? `<span class="spacer"></span><input id="dd-mot" placeholder="motivo / comentário (opcional)" style="min-width:240px"><button class="btn" id="dd-rej">Rejeitar</button><button class="btn primary" id="dd-apr">Aprovar</button>` : ''}
      ${dir && dec?.status === 'Aprovada' ? '<span class="spacer"></span><button class="btn small ghost" id="dd-reabrir">Reabrir (rejeitar)</button>' : ''}
    </div></div>`;
}

function painelRealizado() {
  const r = D.real; if (!r || !D.dec) return '';
  const dec = D.dec, nomeConta = (id) => id === SEM ? 'sem banco' : (state.cad.contaById[id]?.nome || '?');
  const sit = (l) => l.decisao === 'incluir' ? (l.feito ? ['✔ feito', 'pos'] : ['✕ não feito', 'neg']) : (l.feito ? ['! feito, mas estava adiado', 'warn'] : ['✔ adiado', '']);
  const ok = r.linhas.filter(l => (l.decisao === 'incluir') === l.feito).length;
  return `<div class="card flush"><div style="padding:14px 16px 0"><h2>Decidido × realizado · ${dateBR(dec.data)}</h2>
    <p class="small muted" style="margin:4px 0 0">${ok} de ${r.linhas.length} item(ns) saíram como decidido · saldo projetado ${money(dec.saldo_fim)} × saldo real dos bancos no fim do dia <strong class="${r.saldoReal < dec.saldo_fim - 0.005 ? 'neg' : 'pos'}">${money(r.saldoReal)}</strong> (diferença ${money(r.saldoReal - dec.saldo_fim)})</p></div>
    <div class="table-wrap"><table><thead><tr><th>Item</th><th>Banco</th><th class="num">Valor</th><th>Decidido</th><th>Realizado</th></tr></thead><tbody>
    ${r.linhas.sort((a, b) => (((a.decisao === 'incluir') === a.feito) - ((b.decisao === 'incluir') === b.feito)) || Math.abs(b.valor) - Math.abs(a.valor)).map(l => { const [t, c] = sit(l);
      return `<tr><td class="wrap">${esc(l.fav || l.desc)}<div class="small muted">${esc(l.fav ? l.desc : '')}</div></td><td class="small">${esc(nomeConta(l.conta))}</td><td class="num ${cls(l.valor)}">${money(l.valor)}</td><td>${l.decisao === 'incluir' ? 'fazer' : 'adiar'}</td><td class="${c}">${t}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
}

function painelHistorico() {
  if (!D.decs?.length) return '';
  const bcls = { Aprovada: 'pago', Pendente: 'aberto', Rejeitada: 'vencido', Rascunho: '' };
  return `<div class="card flush"><div style="padding:14px 16px 0"><h2>Decisões registradas</h2></div><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Dia</th><th>Situação</th><th class="num">Saldo projetado</th><th>Observação</th></tr></thead><tbody>
    ${D.decs.slice(0, 20).map(x => `<tr class="clickable" data-dia="${x.data}"><td>${x.numero}</td><td>${dateBR(x.data)}</td><td><span class="badge ${bcls[x.status] || ''}">${esc(x.status)}</span></td><td class="num ${cls(x.saldo_fim)}">${money(x.saldo_fim)}</td><td class="small wrap">${esc(x.observacao || '')}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

function ligarPainel(root, R) {
  const on = (id, fn) => { const el = $('#' + id, root); if (el) el.onclick = fn; };
  on('dd-salvar', () => gravar(root, R, 'Rascunho'));
  on('dd-enviar', () => gravar(root, R, 'Pendente'));
  on('dd-copiar', async () => { const t = resumoTexto(R); try { await navigator.clipboard.writeText(t); toast('Resumo copiado: cole no WhatsApp'); } catch { window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank'); } });
  on('dd-excluir', async () => { if (!confirm(`Excluir a decisão nº ${D.dec.numero}?`)) return; try { await q(sb.from('decisoes_dia').delete().eq('id', D.dec.id)); toast('Decisão excluída'); ui.restaurado = null; await recarregar(root); } catch (e) { fail(e); } });
  const decidir = async (apr) => { try { await q(sb.rpc('decidir_decisao_dia', { p_id: D.dec.id, p_aprovar: apr, p_motivo: $('#dd-mot', root)?.value || null })); toast(apr ? 'Decisão aprovada' : 'Decisão rejeitada'); dispararAvisos(); ui.restaurado = null; await recarregar(root); } catch (e) { fail(e); } };
  on('dd-apr', () => decidir(true)); on('dd-rej', () => decidir(false));
  on('dd-reabrir', () => { if (confirm('Reabrir a decisão aprovada? Ela volta como rejeitada para ser refeita.')) decidir(false); });
  $$('#dd-corpo tr[data-dia]', root).forEach(tr => tr.onclick = () => { ui.dia = tr.dataset.dia; $('#dd-dia', root).value = ui.dia; ui.off.clear(); ui.on.clear(); ui.restaurado = null; recarregar(root); window.scrollTo(0, 0); });
}

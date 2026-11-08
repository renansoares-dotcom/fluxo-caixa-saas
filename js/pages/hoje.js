// Minha Manhã (tela inicial): o que precisa de atenção hoje, com dados reais da plataforma.
// Melhoria 2.2 (SQL 102, 07/11/2026): montada por BLOCOS que cada pessoa escolhe e ordena (padrão pelo papel e pelas áreas):
// situação do dia · indicadores da diretoria · minhas aprovações · o que mudou desde o último acesso · resumo do dia anterior ·
// agenda · alertas · meus atalhos. Cada bloco carrega sozinho (um bloco lento não segura os outros).
import { sb, state, q, fetchAll, temArea } from '../lib/data.js';
import { $, $$, esc, money, money0, dateBR, fail, today, toast, modal } from '../lib/ui.js';
import { abrirLancamento } from '../lib/lanc-form.js';
import { BLOCO, aplicar, padrao, mover, nomeTabela, fraseMudanca, textoDesde } from '../lib/manha-blocos.js';
import { codigoDa } from '../lib/telas.js';

export const title = 'Minha Manhã';

const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const diaUtilAnterior = (s) => { let d = addDias(s, -1); while ([0, 6].includes(new Date(d + 'T12:00:00').getDay())) d = addDias(d, -1); return d; };
const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const papel = () => state.papel;
const ir = (rota) => { location.hash = '#/' + rota; };

async function carregar() {
  const e = state.empresa.id, hoje = today(), ate7 = addDias(hoje, 7), ini31 = addDias(hoje, -31);
  const seguro = (p, vazio = null) => p.catch(() => vazio);
  const [saldos, abertos, pas, props, movs, confs, travas, extratos, semConta, nec] = await Promise.all([
    q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: hoje })),
    fetchAll(() => sb.from('lancamentos').select('id,data,valor,plano_id,favorecido_id,descricao,documento,conta_id').eq('empresa_id', e).eq('status', 'Em aberto').lte('data', ate7).order('data').order('id')),
    seguro(q(sb.from('paraquedas').select('id,numero,razao_social,valor,data_pagamento,prioridade,status').eq('empresa_id', e).eq('status', 'aguardando').order('data_pagamento')), []),
    seguro(q(sb.from('fidc_propostas').select('id,numero,valor_face,data_operacao').eq('empresa_id', e).eq('status', 'Pendente')), []),
    fetchAll(() => sb.from('lancamentos').select('conta_id,conta_destino_id,data').eq('empresa_id', e).eq('status', 'Pago').gte('data', ini31).lt('data', hoje).order('id')),
    seguro(q(sb.from('conferencias_dia').select('conta_id,data').eq('empresa_id', e).gte('data', ini31)), null),
    seguro(q(sb.from('contas_travas').select('conta_id,ate').eq('empresa_id', e).eq('ativo', true)), []),
    seguro(q(sb.from('extrato_importacoes').select('conta_id,dt_fim').eq('empresa_id', e)), []),
    seguro(fetchAll(() => sb.from('lancamentos').select('id,valor').eq('empresa_id', e).eq('status', 'Pago').is('conta_id', null).order('id')), []),
    import(`./necessidade-caixa.js?v=${Date.now()}`).then(m => m.resumoNecessidade()).catch(() => null),
  ]);
  return { hoje, saldos, abertos, pas, props, movs, confs, travas, extratos, semConta, nec };
}

const card = (titulo, valor, sub, cls = '', rota = '') =>
  `<div class="kpi${rota ? ' clickable' : ''}" ${rota ? `data-ir="${rota}"` : ''}><div class="k-label">${titulo}</div><div class="k-value ${cls}">${valor}</div><div class="k-sub">${sub}</div></div>`;

// ---------------------------------------------------------------- blocos financeiros (situação, agenda, alertas)
function blocosFin(D, root) {
  const c = state.cad, hoje = D.hoje, ontem = diaUtilAnterior(hoje);
  const sinal = (l) => (c.planoById[l.plano_id]?.natureza === 'C' ? 1 : -1) * +l.valor;
  const ehT = (l) => c.planoById[l.plano_id]?.tipo === 'T';

  // ---- situação do dia
  const selSalvas = ls('nc-contas', null);
  const sel = new Set(selSalvas || D.saldos.filter(s => !/bloqueio/i.test(s.nome)).map(s => s.conta_id));
  const saldoDisp = D.saldos.filter(s => sel.has(s.conta_id)).reduce((t, s) => t + +s.saldo_pago, 0);
  // conferência: dias com movimento pago (até o último dia útil) sem visto
  let pendConf = null;
  if (D.confs) {
    const vistos = new Set(D.confs.map(x => x.conta_id + '|' + x.data)), dias = new Set();
    for (const m of D.movs) for (const ct of [m.conta_id, m.conta_destino_id]) if (ct && m.data <= ontem) dias.add(ct + '|' + m.data);
    pendConf = [...dias].filter(k => !vistos.has(k));
  }
  const ultExt = {}; for (const x of D.extratos) if (x.dt_fim && (!ultExt[x.conta_id] || x.dt_fim > ultExt[x.conta_id])) ultExt[x.conta_id] = x.dt_fim;
  const extAtras = c.contas.filter(ct => ct.ativo && (ct.ofx_conta || ultExt[ct.id])).filter(ct => !ultExt[ct.id] || ultExt[ct.id] < ontem);
  const ultTrava = {}; for (const t of D.travas) if (!ultTrava[t.conta_id] || t.ate > ultTrava[t.conta_id]) ultTrava[t.conta_id] = t.ate;
  const travaMin = Object.values(ultTrava).sort()[0];

  // ---- agenda
  const ab = D.abertos.filter(l => !ehT(l));
  const deHoje = ab.filter(l => l.data === hoje), venc = ab.filter(l => l.data < hoje), semana = ab.filter(l => l.data > hoje);
  const soma = (L, f) => L.filter(f).reduce((t, l) => t + Math.abs(sinal(l)), 0);
  const rec = (l) => sinal(l) > 0, pag = (l) => sinal(l) < 0;

  // ---- alertas
  const al = [];
  for (const s of D.saldos) {
    const ct = c.contaById[s.conta_id];
    if (+s.saldo_pago < -0.005 && /caixa/i.test(ct?.tipo || '')) al.push({ n: 'alta', txt: `${s.nome} está negativa (${money(s.saldo_pago)}) — dinheiro em espécie não pode ficar negativo.`, rota: 'conferencia' });
  }
  const neg = D.saldos.filter(s => +s.saldo_pago < -0.005 && sel.has(s.conta_id) && !/caixa/i.test(c.contaById[s.conta_id]?.tipo || ''));
  if (neg.length) al.push({ n: 'media', txt: `${neg.length} conta(s) consideradas com saldo negativo: ${neg.map(s => `${s.nome} ${money0(s.saldo_pago)}`).join(' · ')}.`, rota: 'cadastros/contas' });
  if (D.nec?.primeira) al.push({ n: 'alta', txt: `Caixa abaixo do mínimo (${money0(D.nec.minimo)}) a partir da semana de ${dateBR(D.nec.primeira.ini)}: faltam ${money0(D.nec.primeira.falta)}. Menor saldo projetado ${money0(D.nec.pior.saldo)}.`, rota: 'necessidade-caixa' });
  if (venc.length) al.push({ n: 'media', txt: `${venc.length} título(s) vencido(s) em aberto: a receber ${money0(soma(venc, rec))} · a pagar ${money0(soma(venc, pag))}.`, rota: 'abertos' });
  if (D.semConta.length) al.push({ n: 'media', txt: `${D.semConta.length} lançamento(s) pagos sem conta bancária (${money0(D.semConta.reduce((t, l) => t + +l.valor, 0))}) — não entram no saldo.`, rota: 'lancamentos' });
  if (pendConf?.length) al.push({ n: 'baixa', txt: `${pendConf.length} dia(s) de conta com movimento ainda sem visto na Conferência do dia (últimos 31 dias).`, rota: 'conferencia' });
  if (extAtras.length) al.push({ n: 'baixa', txt: `Extrato desatualizado: ${extAtras.map(ct => `${ct.nome} (${ultExt[ct.id] ? 'até ' + dateBR(ultExt[ct.id]) : 'nunca importado'})`).join(' · ')}.`, rota: 'conciliacao' });
  const ordem = { alta: 0, media: 1, baixa: 2 };
  al.sort((a, b) => ordem[a.n] - ordem[b.n]);

  const linhaL = (l) => `<tr class="clickable" data-l="${l.id}"><td class="nowrap">${dateBR(l.data)}</td><td class="wrap">${esc(c.favById[l.favorecido_id]?.nome || l.descricao || c.planoById[l.plano_id]?.nome || '')}<div class="small muted">${esc(c.planoById[l.plano_id]?.label || '')}${l.documento ? ' · NF ' + esc(l.documento) : ''}</div></td>
    <td class="num ${sinal(l) < 0 ? 'neg' : 'pos'}">${money(sinal(l))}</td></tr>`;
  const topHoje = [...deHoje].sort((a, b) => Math.abs(sinal(b)) - Math.abs(sinal(a))).slice(0, 12);

  return {
    situacao: `<div class="kpis" style="margin:0">
      ${card('Saldo disponível hoje', money0(saldoDisp), `${sel.size} conta(s) · mesmas da Necessidade de caixa`, saldoDisp < 0 ? 'neg' : '', 'necessidade-caixa')}
      ${card('Conferência até ' + dateBR(ontem).slice(0, 5), pendConf == null ? '—' : pendConf.length ? `${pendConf.length} pendente(s)` : 'em dia', pendConf == null ? 'tela de conferência não instalada' : 'dias com movimento sem visto', pendConf?.length ? 'neg' : 'pos', 'conferencia')}
      ${card('Extratos', extAtras.length ? `${extAtras.length} atrasado(s)` : 'em dia', `referência: ${dateBR(ontem)}`, extAtras.length ? 'neg' : 'pos', 'conciliacao')}
      ${card('Contas travadas até', travaMin ? dateBR(travaMin) : '—', `${Object.keys(ultTrava).length} conta(s) com trava`, travaMin && travaMin < ontem ? 'neg' : '', 'fechamento')}
    </div>`,
    agenda: `<div class="card mm-card"><div class="card-head"><h2>Agenda de hoje</h2><span class="muted small">a receber ${money0(soma(deHoje, rec))} · a pagar ${money0(soma(deHoje, pag))}</span></div>
        ${topHoje.length ? `<div class="table-wrap"><table id="mm-hoje"><tbody>${topHoje.map(linhaL).join('')}</tbody></table></div>${deHoje.length > topHoje.length ? `<p class="small muted">+ ${deHoje.length - topHoje.length} lançamento(s) em Contas a pagar / receber.</p>` : ''}` : '<div class="empty">Nada vencendo hoje.</div>'}
        <div class="mm-mini">
          <div class="clickable" data-ir="abertos"><div class="muted small">Próximos 7 dias</div><div>receber <strong class="pos">${money0(soma(semana, rec))}</strong> · pagar <strong class="neg">${money0(soma(semana, pag))}</strong></div></div>
          <div class="clickable" data-ir="abertos"><div class="muted small">Vencidos em aberto</div><div>${venc.length} título(s) · <strong>${money0(soma(venc, rec) + soma(venc, pag))}</strong></div></div>
        </div></div>`,
    alertas: `<div class="card mm-card"><div class="card-head"><h2>Alertas</h2></div>
          ${al.length ? al.map(a => `<div class="mm-item clickable" data-ir="${a.rota}"><span class="mm-dot ${a.n}"></span><span>${esc(a.txt)}</span></div>`).join('') : '<div class="empty">Sem alertas.</div>'}</div>`,
    ligar: (el) => {
      $$('[data-ir]', el).forEach(x => x.onclick = () => ir(x.dataset.ir));
      $('#mm-hoje', el)?.addEventListener('click', async (e) => {
        const id = e.target.closest('tr[data-l]')?.dataset.l; if (!id) return;
        try { const [l] = await q(sb.from('lancamentos').select('*').eq('id', id)); abrirLancamento(l, () => render(root)); } catch (err) { fail(err); }
      });
    },
  };
}

// ---------------------------------------------------------------- preferências (por pessoa e empresa)
const chaveLocal = () => `mm-pref-${state.empresa.id}`;
async function lerPref() {
  try { const r = await q(sb.from('manha_preferencias').select('blocos,atalhos').eq('empresa_id', state.empresa.id).eq('user_id', state.user.id).maybeSingle()); if (r) return r; }
  catch { /* SQL 102 ainda não executado: fica no navegador */ }
  return ls(chaveLocal(), { blocos: null, atalhos: [] });
}
async function gravarPref(p) {
  try { localStorage.setItem(chaveLocal(), JSON.stringify(p)); } catch {}
  await q(sb.from('manha_preferencias').upsert({ empresa_id: state.empresa.id, user_id: state.user.id, blocos: p.blocos, atalhos: p.atalhos, atualizado_em: new Date().toISOString() }));
}
// telas do menu que a pessoa enxerga (para os atalhos)
const telasMenu = () => $$('#nav a[data-route]')
  .filter(a => getComputedStyle(a).display !== 'none' && !a.closest('[hidden]'))
  .map(a => ({ rota: a.dataset.route, nome: a.dataset.nome || a.textContent.trim(), area: a.closest('.nav-area')?.querySelector('.nav-area-tit')?.dataset.nome || a.closest('.nav-area')?.querySelector('.nav-area-tit')?.textContent || '' }))
  .filter((t, i, l) => t.rota !== 'hoje' && l.findIndex(x => x.rota === t.rota) === i);

// ---------------------------------------------------------------- tela
export async function render(root) {
  const nome = (state.user?.email || '').split('@')[0].split(/[._]/)[0];
  const h = new Date().getHours();
  const saud = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${nome ? ', ' + nome.charAt(0).toUpperCase() + nome.slice(1) : ''}.`;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">${esc(saud)}</h2>
      <div class="muted">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
      <div style="display:flex;gap:8px"><button class="btn ghost small" id="mm-at">Atualizar</button><button class="btn small" id="mm-pers">Personalizar</button></div></div>
    <div id="mm-corpo" class="mm-blocos"><div class="loading">Montando o seu dia…</div></div>`;
  $('#mm-at', root).onclick = () => render(root);
  const pref = await lerPref();
  const lista = aplicar(pref.blocos, state.papel, temArea), ligados = lista.filter(x => x.on).map(x => x.k);
  $('#mm-pers', root).onclick = () => personalizar(lista, pref.atalhos || [], () => render(root));
  const corpo = $('#mm-corpo', root);
  if (!ligados.length) { corpo.innerHTML = '<div class="card"><div class="empty">Nenhum bloco escolhido. Clique em <b>Personalizar</b> para montar a sua manhã.</div></div>'; return; }
  corpo.innerHTML = ligados.map(k => `<div class="mm-b ${BLOCO[k].largo ? 'largo' : ''}" data-b="${k}"><div class="card mm-card"><div class="card-head"><h2>${esc(BLOCO[k].nome)}</h2></div><div class="loading">Carregando…</div></div></div>`).join('');
  const caixa = (k) => $(`[data-b="${k}"]`, corpo);
  const erro = (k) => (e) => { console.error(e); const c = caixa(k); if (c) c.innerHTML = `<div class="card mm-card"><div class="card-head"><h2>${esc(BLOCO[k].nome)}</h2></div><div class="empty small">Não foi possível carregar este bloco.</div></div>`; };
  const quer = (...ks) => ks.some(k => ligados.includes(k));

  if (quer('situacao', 'agenda', 'alertas')) carregar().then(D => { const F = blocosFin(D, root); for (const k of ['situacao', 'agenda', 'alertas']) if (caixa(k)) { caixa(k).innerHTML = F[k]; F.ligar(caixa(k)); } }).catch(e => ['situacao', 'agenda', 'alertas'].forEach(k => caixa(k) && erro(k)(e)));
  if (quer('mudou', 'ontem')) q(sb.rpc('manha_resumo', { p_empresa: state.empresa.id })).then(R => { if (caixa('mudou')) blocoMudou(caixa('mudou'), R); if (caixa('ontem')) blocoOntem(caixa('ontem'), R); })
    .catch(e => ['mudou', 'ontem'].forEach(k => caixa(k) && erro(k)(e)));
  if (quer('aprovacoes')) q(sb.rpc('minhas_aprovacoes', { p_empresa: state.empresa.id })).then(L => blocoAprovacoes(caixa('aprovacoes'), L)).catch(erro('aprovacoes'));
  if (quer('diretoria')) import(`./diretoria.js?v=${Date.now()}`).then(async m => blocoDiretoria(caixa('diretoria'), await m.carregarPainel(m.mesAnterior()), m.mesAnterior())).catch(erro('diretoria'));
  if (quer('atalhos')) blocoAtalhos(caixa('atalhos'), pref.atalhos || []);
}

const cab = (k, extra = '') => `<div class="card-head"><h2>${esc(BLOCO[k].nome)}</h2>${extra}</div>`;

function blocoAprovacoes(el, L) {
  if (!el) return;
  L.sort((a, b) => (b.urgente - a.urgente) || String(a.prazo || '9').localeCompare(String(b.prazo || '9')));
  const tot = L.reduce((t, x) => t + (+x.valor || 0), 0);
  el.innerHTML = `<div class="card mm-card">${cab('aprovacoes', L.length ? `<a class="small" href="#/aprovacoes">ver todas (${L.length})</a>` : '')}
    ${L.length ? `<div class="small muted" style="margin-bottom:4px">${L.length} esperando a sua decisão${tot ? ` · ${money0(tot)}` : ''}${L.some(x => x.urgente) ? ` · <b class="neg">${L.filter(x => x.urgente).length} urgente(s)</b>` : ''}</div>`
      + L.slice(0, 6).map(x => `<a class="mm-item" href="${x.link}" style="color:inherit;text-decoration:none"><span class="mm-dot ${x.urgente ? 'alta' : x.prazo && x.prazo < today() ? 'media' : 'baixa'}"></span>
        <span style="flex:1;min-width:0"><b>${esc(x.titulo)}</b><div class="small muted">${esc(x.detalhe || '')}${x.prazo ? ` · até ${dateBR(x.prazo)}` : ''}</div></span>${x.valor != null ? `<span class="nowrap">${money0(x.valor)}</span>` : ''}</a>`).join('')
      : '<div class="empty">Nada esperando a sua decisão.</div>'}</div>`;
}

function blocoMudou(el, R) {
  const M = R.mudou || {}, T = M.por_tabela || [], N = M.notas;
  const tot = T.reduce((t, x) => t + +x.total, 0);
  el.innerHTML = `<div class="card mm-card">${cab('mudou', `<span class="small muted">${esc(textoDesde(R.desde))}</span>`)}
    ${tot || (N && (N.saida || N.entrada)) || M.avisos ? `
      ${M.avisos ? `<a class="mm-item" href="#/meus-avisos" style="color:inherit;text-decoration:none"><span class="mm-dot media"></span><span><b>${M.avisos} aviso(s) não lido(s)</b></span></a>` : ''}
      ${N && (N.saida || N.entrada) ? `<a class="mm-item" href="#/notas" style="color:inherit;text-decoration:none"><span class="mm-dot baixa"></span><span><b>Notas fiscais importadas</b><div class="small muted">${N.saida} de saída · ${N.entrada} de entrada</div></span></a>` : ''}
      ${T.slice(0, 8).map(x => `<div class="mm-item"><span class="mm-dot baixa"></span><span style="flex:1"><b>${esc(nomeTabela(x.tabela))}</b><div class="small muted">${esc(fraseMudanca(x))}</div></span><span class="small muted nowrap">${new Date(x.ultimo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')}
      ${T.length > 8 ? `<div class="small muted">+ ${T.length - 8} módulo(s)</div>` : ''}
      ${R.detalhe_pessoas && M.recentes?.length ? `<details style="margin-top:6px"><summary class="small">Quem fez o quê (últimas ${M.recentes.length})</summary>${M.recentes.map(a => `<div class="small" style="padding:3px 0;border-top:1px solid var(--border)"><b>${esc(String(a.user_email || 'sistema').split('@')[0])}</b> ${esc(a.acao)} ${esc(nomeTabela(a.tabela).toLowerCase())}${a.rotulo ? `: ${esc(String(a.rotulo).slice(0, 60))}` : ''} <span class="muted">· ${new Date(a.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')}<a class="small" href="#/auditoria">abrir a Auditoria</a></details>` : ''}`
      : '<div class="empty">Nada mudou nas suas áreas desde o seu último acesso.</div>'}</div>`;
}

function blocoOntem(el, R) {
  const D = R.dia || {}, it = [];
  if (D.fin) it.push(['Recebido', money0(D.fin.recebido), 'pos', 'fluxo-diario'], ['Pago', money0(D.fin.pago), 'neg', 'fluxo-diario']);
  if (D.fat) it.push(['Faturamento', money0(D.fat.valor), '', 'notas', `${D.fat.notas} nota(s)`]);
  if (D.entradas) it.push(['Notas de entrada', D.entradas.notas, '', 'notas', money0(D.entradas.valor)]);
  if (D.prod) it.push(['Produção', `${Math.round(D.prod.boa).toLocaleString('pt-BR')} kg`, '', 'producao', D.prod.boa + D.prod.refugo ? `refugo ${(D.prod.refugo / (D.prod.boa + D.prod.refugo) * 100).toFixed(1).replace('.', ',')}%` : 'sem apontamento']);
  if (D.rnc != null) it.push(['Não conformidades', D.rnc, D.rnc ? 'neg' : '', 'qualidade/nao-conformidades', 'abertas no dia']);
  if (D.log) it.push(['Entregas', D.log.entregues, '', 'logistica', `${D.log.cargas} carga(s)${D.log.problemas ? ` · ${D.log.problemas} com problema` : ''}`]);
  const dia = new Date(R.ontem + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  el.innerHTML = `<div class="card mm-card">${cab('ontem', `<span class="small muted">${esc(dia)}</span>`)}
    ${it.length ? `<div class="mm-mini" style="margin-top:0">${it.map(([t, v, c, r, s]) => `<div class="clickable" data-ir="${r}"><div class="muted small">${t}</div><div><strong class="${c}">${v}</strong></div>${s ? `<div class="small muted">${esc(s)}</div>` : ''}</div>`).join('')}</div>`
      : '<div class="empty">Sem dados do dia anterior nas suas áreas.</div>'}</div>`;
  $$('[data-ir]', el).forEach(x => x.onclick = () => ir(x.dataset.ir));
}

async function blocoDiretoria(el, P, ref) {
  const { SIT, fmt } = await import('../lib/diretoria-calc.js');
  const mes = new Date(ref + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  el.innerHTML = `<div class="card mm-card">${cab('diretoria', `<a class="small" href="#/diretoria">abrir o painel (${esc(mes)})</a>`)}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px">${P.inds.map(i => { const s = i.sit ? SIT[i.sit] : null;
      return `<a href="#/diretoria" style="color:inherit;text-decoration:none;border:1px solid var(--border);border-left:3px solid ${s ? s.cor : 'var(--border)'};border-radius:8px;padding:8px 10px">
        <div class="small muted">${esc(i.nome)}</div><div style="font-weight:700;font-size:1.1em">${fmt(i.valor, i.un)}</div><div class="small">${s ? `<span class="badge ${s.cls}">${s.txt}</span>` : '<span class="muted">sem meta</span>'}</div></a>`; }).join('')}</div></div>`;
}

function blocoAtalhos(el, atalhos) {
  const T = telasMenu(), L = atalhos.map(r => T.find(t => t.rota === r) || { rota: r, nome: r }).filter(t => T.some(x => x.rota === t.rota));
  el.innerHTML = `<div class="card mm-card">${cab('atalhos')}
    ${L.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">${L.map(t => `<a class="btn" href="#/${t.rota}" style="justify-content:flex-start;text-align:left;white-space:normal;height:auto;padding:10px 12px"><span><b>${esc(t.nome)}</b>${codigoDa(t.rota) ? `<div class="small muted">${codigoDa(t.rota)}</div>` : ''}</span></a>`).join('')}</div>`
      : '<div class="empty small">Escolha as telas que você mais usa em <b>Personalizar</b>.</div>'}</div>`;
}

// ---------------------------------------------------------------- personalizar
function personalizar(lista, atalhos, depois) {
  let L = lista.map(x => ({ ...x })); const sel = new Set(atalhos), T = telasMenu();
  const m = modal({ title: 'Personalizar a Minha Manhã', wide: true, body: `<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px">
      <div><h3 style="margin:0 0 6px">Blocos</h3><p class="small muted" style="margin-top:0">Marque o que aparece e use as setas para mudar a ordem.</p><div id="ps-bl"></div></div>
      <div><h3 style="margin:0 0 6px">Meus atalhos</h3><p class="small muted" style="margin-top:0">As telas que aparecem no bloco "Meus atalhos" (ligue o bloco ao lado).</p>
        <input id="ps-b" placeholder="Filtrar telas" style="margin-bottom:6px"><div id="ps-at" style="max-height:380px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 10px">
        ${T.map(t => `<label class="chk" data-txt="${esc((t.nome + ' ' + t.area + ' ' + (codigoDa(t.rota) || '')).toUpperCase())}" style="flex-direction:row;align-items:center;gap:8px;font-weight:400;padding:2px 0"><input type="checkbox" value="${t.rota}" style="width:auto;min-height:0" ${sel.has(t.rota) ? 'checked' : ''}> ${esc(t.nome)} <span class="small muted">${esc(t.area)}${codigoDa(t.rota) ? ' · ' + codigoDa(t.rota) : ''}</span></label>`).join('')}</div></div></div>`,
    foot: '<button class="btn" id="ps-pad" style="margin-right:auto">Voltar ao padrão</button><button class="btn" data-close>Cancelar</button><button class="btn primary" id="ps-ok">Salvar</button>' });
  const pintar = () => {
    $('#ps-bl', m.el).innerHTML = L.map((x, i) => `<div class="mm-item" style="align-items:center"><input type="checkbox" data-on="${i}" style="width:auto;min-height:0" ${x.on ? 'checked' : ''}>
      <span style="flex:1"><b>${esc(BLOCO[x.k].nome)}</b><div class="small muted">${esc(BLOCO[x.k].desc)}</div></span>
      <button class="btn ghost small" data-mv="${i}|-1" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button><button class="btn ghost small" data-mv="${i}|1" ${i === L.length - 1 ? 'disabled' : ''} title="Descer">↓</button></div>`).join('');
    $$('[data-on]', m.el).forEach(c => c.onchange = () => { L[+c.dataset.on].on = c.checked; });
    $$('[data-mv]', m.el).forEach(b => b.onclick = () => { const [i, d] = b.dataset.mv.split('|').map(Number); L = mover(L, i, d); pintar(); });
  };
  pintar();
  $('#ps-b', m.el).oninput = (e) => { const t = e.target.value.trim().toUpperCase(); $$('#ps-at [data-txt]', m.el).forEach(x => { x.hidden = t && !x.dataset.txt.includes(t); }); };
  $('#ps-pad', m.el).onclick = () => { L = padrao(state.papel, temArea); pintar(); };
  $('#ps-ok', m.el).onclick = async () => {
    const at = $$('#ps-at input:checked', m.el).map(x => x.value);
    try { await gravarPref({ blocos: L, atalhos: at }); m.close(); toast('Minha Manhã personalizada'); depois(); }
    catch (e) { m.close(); toast('Preferência guardada neste navegador (falta o SQL 102 para valer em todos os aparelhos)'); depois(); }
  };
}

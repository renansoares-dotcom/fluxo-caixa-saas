// Minha Manhã (tela inicial): o que precisa de atenção hoje, com dados reais da plataforma.
// Situação do dia (saldo, conferência, extratos, travas) · agenda (hoje, 7 dias, vencidos) · decisões pendentes (por papel) · alertas.
import { sb, state, q, fetchAll, temArea } from '../lib/data.js';
import { $, $$, esc, money, money0, dateBR, fail, today } from '../lib/ui.js';
import { abrirLancamento } from '../lib/lanc-form.js';

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

export async function render(root) {
  const nome = (state.user?.email || '').split('@')[0].split(/[._]/)[0];
  const h = new Date().getHours();
  const saud = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${nome ? ', ' + nome.charAt(0).toUpperCase() + nome.slice(1) : ''}.`;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">${esc(saud)}</h2>
      <div class="muted">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
      <button class="btn ghost small" id="mm-at">Atualizar</button></div>
    <div id="mm-corpo"><div class="loading">Montando o seu dia…</div></div>`;
  $('#mm-at', root).onclick = () => render(root);
  if (!temArea('fin')) { $('#mm-corpo', root).innerHTML = '<div class="card"><p>Use o menu para abrir as telas da sua área.</p></div>'; return; }
  let D; try { D = await carregar(); } catch (e) { fail(e); $('#mm-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
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

  // ---- decisões (conforme o papel)
  const dec = [];
  if (['admin', 'diretor', 'financeiro'].includes(papel()) && D.pas.length) {
    const urg = D.pas.filter(p => p.prioridade === 'urgente').length;
    dec.push({ txt: `${D.pas.length} pagamento(s) antecipado(s) aguardando autorização · ${money0(D.pas.reduce((t, p) => t + +p.valor, 0))}${urg ? ` · ${urg} urgente(s)` : ''}`, rota: 'paraquedas', tag: 'Pagamentos' });
  }
  if (['admin', 'diretor'].includes(papel()) && D.props.length)
    dec.push({ txt: `${D.props.length} proposta(s) de borderô para aprovar · face ${money0(D.props.reduce((t, p) => t + +p.valor_face, 0))}`, rota: 'fidc-propostas', tag: 'FIDC' });
  if (deHoje.filter(pag).length && ['admin', 'financeiro', 'diretor'].includes(papel()))
    dec.push({ txt: `${deHoje.filter(pag).length} pagamento(s) vencendo hoje · ${money0(soma(deHoje, pag))} — programar ou autorizar`, rota: 'autorizacao', tag: 'Pagamentos' });

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

  $('#mm-corpo', root).innerHTML = `
    <div class="kpis">
      ${card('Saldo disponível hoje', money0(saldoDisp), `${sel.size} conta(s) · mesmas da Necessidade de caixa`, saldoDisp < 0 ? 'neg' : '', 'necessidade-caixa')}
      ${card('Conferência até ' + dateBR(ontem).slice(0, 5), pendConf == null ? '—' : pendConf.length ? `${pendConf.length} pendente(s)` : 'em dia', pendConf == null ? 'tela de conferência não instalada' : 'dias com movimento sem visto', pendConf?.length ? 'neg' : 'pos', 'conferencia')}
      ${card('Extratos', extAtras.length ? `${extAtras.length} atrasado(s)` : 'em dia', `referência: ${dateBR(ontem)}`, extAtras.length ? 'neg' : 'pos', 'conciliacao')}
      ${card('Contas travadas até', travaMin ? dateBR(travaMin) : '—', `${Object.keys(ultTrava).length} conta(s) com trava`, travaMin && travaMin < ontem ? 'neg' : '', 'fechamento')}
    </div>
    <div class="mm-grid">
      <div class="card"><div class="card-head"><h2>Agenda de hoje</h2><span class="muted small">a receber ${money0(soma(deHoje, rec))} · a pagar ${money0(soma(deHoje, pag))}</span></div>
        ${topHoje.length ? `<div class="table-wrap"><table id="mm-hoje"><tbody>${topHoje.map(linhaL).join('')}</tbody></table></div>${deHoje.length > topHoje.length ? `<p class="small muted">+ ${deHoje.length - topHoje.length} lançamento(s) em Contas a pagar / receber.</p>` : ''}` : '<div class="empty">Nada vencendo hoje.</div>'}
        <div class="mm-mini">
          <div class="clickable" data-ir="abertos"><div class="muted small">Próximos 7 dias</div><div>receber <strong class="pos">${money0(soma(semana, rec))}</strong> · pagar <strong class="neg">${money0(soma(semana, pag))}</strong></div></div>
          <div class="clickable" data-ir="abertos"><div class="muted small">Vencidos em aberto</div><div>${venc.length} título(s) · <strong>${money0(soma(venc, rec) + soma(venc, pag))}</strong></div></div>
        </div></div>
      <div>
        <div class="card"><div class="card-head"><h2>Decisões pendentes</h2></div>
          ${dec.length ? dec.map(d => `<div class="mm-item clickable" data-ir="${d.rota}"><span class="badge">${esc(d.tag)}</span><span>${esc(d.txt)}</span></div>`).join('') : '<div class="empty">Nenhuma decisão esperando por você.</div>'}</div>
        <div class="card"><div class="card-head"><h2>Alertas</h2></div>
          ${al.length ? al.map(a => `<div class="mm-item clickable" data-ir="${a.rota}"><span class="mm-dot ${a.n}"></span><span>${esc(a.txt)}</span></div>`).join('') : '<div class="empty">Sem alertas.</div>'}</div>
      </div></div>`;
  $$('[data-ir]', root).forEach(el => el.onclick = () => ir(el.dataset.ir));
  $('#mm-hoje', root)?.addEventListener('click', async (e) => {
    const id = e.target.closest('tr[data-l]')?.dataset.l; if (!id) return;
    try { const [l] = await q(sb.from('lancamentos').select('*').eq('id', id)); abrirLancamento(l, () => render(root)); } catch (err) { fail(err); }
  });
}

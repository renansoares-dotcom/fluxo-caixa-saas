// RH / Trabalhista — acesso ao banco e blocos de tela compartilhados (folha mensal e 13º).
import { sb, state, q, fetchAll } from './data.js';
import { $, $$, esc, money, dateBR, toast, fail, confirmDialog } from './ui.js';
import { param, PLANO_PADRAO, planoDoEvento, EVENTOS, tipoPagamentoSalario } from './rh.js';
import { inp, num } from './compras.js';

// acesso: administrador ou área "rh" marcada (sem marcação NÃO dá acesso — salário é sigiloso)
export const temRH = () => state.papel === 'admin' || (state.areas || []).includes('rh');
export const podeRH = () => state.papel === 'admin' || ((state.areas || []).includes('rh') && !['leitura', 'vendas', 'producao'].includes(state.papel));

const emp = () => state.empresa.id;
export const semMigracao = (err) => /rh_|does not exist|schema cache/i.test(err?.message || '');
export const avisoMigracao = '<div class="card"><div class="empty">Não foi possível carregar o RH. Se a migração <b>20261027000052_rh_base.sql</b> ainda não rodou, rode-a no SQL Editor do Supabase.</div></div>';

export async function carregarBase() {
  const [P, colabs] = await Promise.all([
    q(sb.from('rh_parametros').select('*').eq('empresa_id', emp()).maybeSingle()),
    fetchAll(() => sb.from('rh_colaboradores').select('*').eq('empresa_id', emp()).order('nome')),
  ]);
  const prm = param(P || {});
  const porCodigo = (cod) => state.cad.contasPlano.find(p => p.codigo === cod)?.id || null;
  const planos = Object.fromEntries(Object.entries(PLANO_PADRAO).map(([k, cod]) => [k, (P?.planos || {})[k] || porCodigo(cod)]));
  const conta = P?.conta_id || state.cad.contas.find(c => /SUBCONTA/i.test(c.nome))?.id || null;
  return { Prow: P, P: prm, planos, conta, colabs, colabById: Object.fromEntries(colabs.map(c => [c.id, c])) };
}

export async function carregarFolha(competencia, tipo) {
  const f = await q(sb.from('rh_folhas').select('*').eq('empresa_id', emp()).eq('competencia', competencia).eq('tipo', tipo).maybeSingle());
  if (!f) return null;
  const [itens, eventos] = await Promise.all([
    fetchAll(() => sb.from('rh_folha_itens').select('*').eq('folha_id', f.id)),
    q(sb.from('rh_folha_eventos').select('*').eq('folha_id', f.id).order('vencimento')),
  ]);
  const ids = eventos.map(e => e.lancamento_id).filter(Boolean);
  const lancs = ids.length ? await q(sb.from('lancamentos').select('id,status,valor,data').in('id', ids)) : [];
  const lById = Object.fromEntries(lancs.map(l => [l.id, l]));
  eventos.forEach(e => { e.lanc = lById[e.lancamento_id] || null; });
  return { ...f, itens, eventos };
}

/** grava uma folha nova (ou substitui itens e eventos de uma existente) */
export async function gravarFolha(B, { competencia, tipo, itens, eventos, folhaId = null }) {
  let id = folhaId;
  if (!id) {
    const f = await q(sb.from('rh_folhas').insert({ empresa_id: emp(), competencia, tipo, parametros: B.P }).select().single());
    id = f.id;
  } else {
    await q(sb.from('rh_folhas').update({ parametros: B.P }).eq('id', id));
    await q(sb.from('rh_folha_itens').delete().eq('folha_id', id));
  }
  const cols = ['colaborador_id', 'salario', 'avos', 'bruto', 'proventos', 'descontos', 'adiantamento', 'liquido', 'adiant_pago', 'observacao'];
  const linhas = itens.map(it => ({ empresa_id: emp(), folha_id: id, ...Object.fromEntries(cols.filter(k => it[k] !== undefined).map(k => [k, it[k]])) }));
  for (let i = 0; i < linhas.length; i += 500) await q(sb.from('rh_folha_itens').insert(linhas.slice(i, i + 500)));
  await salvarEventos(B, id, eventos);
  return id;
}

/** grava os eventos por (folha, evento): atualiza os que existem, inclui os novos, mantém o vínculo com a previsão já lançada */
export async function salvarEventos(B, folhaId, eventos) {
  const atuais = await q(sb.from('rh_folha_eventos').select('*').eq('folha_id', folhaId));
  const porEv = Object.fromEntries(atuais.map(e => [e.evento, e]));
  for (const e of eventos) {
    const row = { vencimento: e.vencimento, valor: e.valor, descricao: e.descricao || EVENTOS[e.evento] || e.evento,
      plano_id: e.plano_id || B.planos[planoDoEvento(e.evento)], conta_id: e.conta_id !== undefined ? e.conta_id : B.conta };
    const a = porEv[e.evento];
    if (a) await q(sb.from('rh_folha_eventos').update(row).eq('id', a.id));
    else await q(sb.from('rh_folha_eventos').insert({ ...row, empresa_id: emp(), folha_id: folhaId, evento: e.evento }));
  }
  // evento que deixou de existir (valor zerado no recálculo): zera, e a previsão em aberto sai no próximo "lançar"
  for (const a of atuais) if (!eventos.some(e => e.evento === a.evento) && +a.valor) await q(sb.from('rh_folha_eventos').update({ valor: 0 }).eq('id', a.id));
}

/** pago de verdade perto de cada evento (fora as previsões do RH): mesmo plano, ±10 dias; salário separa adiantamento × saldo pelo texto */
export async function realizadoPorEvento(eventos) {
  const comPlano = eventos.filter(e => e.plano_id && e.vencimento);
  if (!comPlano.length) return {};
  const ini = comPlano.map(e => e.vencimento).sort()[0], fim = comPlano.map(e => e.vencimento).sort().at(-1);
  const d = (s, n) => { const x = new Date(s + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const ls = await fetchAll(() => sb.from('lancamentos').select('data,valor,plano_id,descricao,origem').eq('empresa_id', emp()).eq('status', 'Pago')
    .in('plano_id', [...new Set(comPlano.map(e => e.plano_id))]).gte('data', d(ini, -10)).lte('data', d(fim, 10)));
  const out = {};
  for (const e of comPlano) {
    const sal = ['adiantamento', 'saldo'].includes(e.evento);
    const xs = ls.filter(l => l.plano_id === e.plano_id && !String(l.origem || '').startsWith('rh:') && l.data >= d(e.vencimento, -10) && l.data <= d(e.vencimento, 10)
      && (!sal || tipoPagamentoSalario(l.descricao) === e.evento));
    out[e.evento] = { valor: xs.reduce((s, l) => s + +l.valor, 0), n: xs.length };
  }
  return out;
}

/** quanto foi pago por mês nos últimos meses (para calibrar os parâmetros) */
export async function historicoPago(B, meses = 4) {
  const hoje = new Date(); const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - meses, 1)).toISOString().slice(0, 10);
  const pls = [B.planos.salarios, B.planos.inss, B.planos.fgts].filter(Boolean);
  if (!pls.length) return [];
  const ls = await fetchAll(() => sb.from('lancamentos').select('data,valor,plano_id,descricao,origem').eq('empresa_id', emp()).eq('status', 'Pago').in('plano_id', pls).gte('data', ini));
  const m = {};
  for (const l of ls) {
    if (String(l.origem || '').startsWith('rh:')) continue;
    const k = l.data.slice(0, 7), r = m[k] || (m[k] = { mes: k, adiantamento: 0, saldo: 0, outros: 0, inss: 0, fgts: 0 });
    if (l.plano_id === B.planos.inss) r.inss += +l.valor;
    else if (l.plano_id === B.planos.fgts) r.fgts += +l.valor;
    else { const t = tipoPagamentoSalario(l.descricao); r[t || 'outros'] += +l.valor; }
  }
  return Object.values(m).sort((a, b) => a.mes.localeCompare(b.mes)).filter(r => r.mes < hoje.toISOString().slice(0, 7));
}

const STATUS = { aberta: ['Aberta', 'aberto'], prevista: ['Previsão no fluxo', 'pago'], encerrada: ['Encerrada', ''] };
export const badgeFolha = (f) => { const [t, c] = STATUS[f.status || 'aberta'] || [f.status, '']; return `<span class="badge ${c}">${t}</span>`; };

/** bloco "Pagamentos da folha": eventos editáveis, previsão lançada, pago perto da data e as ações */
export async function blocoEventos(el, B, folha, recarregar) {
  const pode = podeRH() && folha.status !== 'encerrada';
  const real = await realizadoPorEvento(folha.eventos).catch(() => ({}));
  const contas = state.cad.contas;
  const sitPrev = (e) => !e.lanc ? '<span class="muted">—</span>' : e.lanc.status === 'Pago' ? '<span class="badge pago">paga</span>' : `<span class="badge aberto">em aberto ${dateBR(e.lanc.data)}</span>`;
  const tot = folha.eventos.reduce((s, e) => s + +e.valor, 0);
  el.innerHTML = `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Pagamentos da folha ${badgeFolha(folha)}</h2>
      <div class="muted small">Total ${money(tot)}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Pagamento</th><th>Vencimento</th><th class="num">Valor previsto</th><th>Conta</th><th>Previsão no fluxo</th><th class="num">Pago perto da data</th></tr></thead><tbody>
    ${folha.eventos.map(e => { const r = real[e.evento];
      return `<tr data-id="${e.id}"><td><b>${esc(e.descricao || EVENTOS[e.evento] || e.evento)}</b><div class="small muted">${esc(state.cad.planoById[e.plano_id]?.label || 'sem plano')}</div></td>
      <td>${pode ? `<input type="date" class="ev-v" value="${e.vencimento}">` : dateBR(e.vencimento)}</td>
      <td class="num">${pode ? `<input class="ev-x num" style="width:120px" value="${inp(e.valor)}">` : money(e.valor)}</td>
      <td>${pode ? `<select class="ev-c" data-nobusca><option value="">—</option>${contas.map(c => `<option value="${c.id}" ${c.id === e.conta_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>` : esc(state.cad.contaById[e.conta_id]?.nome || '')}</td>
      <td>${sitPrev(e)}</td>
      <td class="num">${r && r.n ? `${money(r.valor)}<div class="small muted">${r.n} pagamento(s)</div>` : '<span class="muted">—</span>'}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Sem pagamentos.</td></tr>'}
    </tbody></table></div>
    <div style="padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap">
      ${pode ? '<button class="btn" id="ev-salvar">Salvar datas e valores</button><button class="btn primary" id="ev-lancar">Lançar previsão no fluxo de caixa</button>' : ''}
      ${podeRH() && folha.status !== 'encerrada' ? '<button class="btn" id="ev-encerrar">Encerrar (já foi pago)</button>' : ''}
      ${podeRH() && folha.status === 'encerrada' ? '<button class="btn" id="ev-reabrir">Reabrir</button>' : ''}
      ${podeRH() ? '<button class="btn danger" id="ev-excluir" style="margin-left:auto">Excluir folha</button>' : ''}
    </div></div>
    <p class="small muted">A previsão entra como título <b>Em aberto</b> (um por pagamento, valor total) no fluxo de caixa, Decisão do Dia e Necessidade de caixa — sem nomes nem salários.
      Quando os pagamentos reais entrarem (importação do ERP / extrato, um por pessoa), use <b>Encerrar</b>: as previsões em aberto saem e ficam só os pagamentos reais.
      "Pago perto da data" soma os lançamentos pagos do mesmo plano até 10 dias antes ou depois (salário: separa adiantamento × saldo pelo texto "ADIANT FOLHA" / "PROVISAO FOLHA").</p>`;
  const lerEventos = () => $$('tr[data-id]', el).map(tr => ({ id: tr.dataset.id, vencimento: $('.ev-v', tr).value, valor: num($('.ev-x', tr).value), conta_id: $('.ev-c', tr).value || null }));
  const salvar = async () => { for (const e of lerEventos()) { if (!e.vencimento) throw new Error('Informe o vencimento de todos os pagamentos'); await q(sb.from('rh_folha_eventos').update({ vencimento: e.vencimento, valor: e.valor, conta_id: e.conta_id }).eq('id', e.id)); } };
  const bt = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } catch (err) { fail(err); } finally { b.disabled = false; } }; };
  bt('ev-salvar', async () => { await salvar(); toast('Pagamentos salvos'); recarregar(); });
  bt('ev-lancar', async () => {
    await salvar();
    const n = await q(sb.rpc('rh_lancar_previsao', { p_folha: folha.id }));
    toast(`${n} previsão(ões) no fluxo de caixa`); recarregar();
  });
  bt('ev-encerrar', async () => {
    if (!await confirmDialog('Encerrar a folha? As previsões que ainda estão em aberto saem do fluxo de caixa (os pagamentos reais já lançados não mudam).')) return;
    const n = await q(sb.rpc('rh_encerrar_folha', { p_folha: folha.id, p_reabrir: false }));
    toast(`Folha encerrada — ${n} previsão(ões) retirada(s)`); recarregar();
  });
  bt('ev-reabrir', async () => { await q(sb.rpc('rh_encerrar_folha', { p_folha: folha.id, p_reabrir: true })); recarregar(); });
  bt('ev-excluir', async () => {
    if (!await confirmDialog('Excluir esta folha? Os itens e as previsões em aberto dela saem; pagamentos reais não mudam.')) return;
    await q(sb.rpc('rh_excluir_folha', { p_folha: folha.id })); toast('Folha excluída'); recarregar();
  });
}

/** KPI simples */
export const kpi = (rot, val, sub = '', cl = '') => `<div class="kpi"><div class="k-label">${rot}</div><div class="k-value ${cl}">${val}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;

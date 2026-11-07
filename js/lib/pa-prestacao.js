// Prestação de contas dos Pagamentos Antecipados (melhoria 3.7): prazo da nota fiscal de cada PA pago, cobrança automática
// (lembrete, cobrança e escalada, no banco — SQL 097), "Cobrar agora", "Prorrogar", histórico e saldo pendente por pessoa.
import { sb, state, q, podeEditar } from './data.js';
import { $, $$, esc, money, dateBR, toast, fail, modal, today } from './ui.js';

export const ROT_ORIGEM = { padrao: 'prazo padrão', previsao: 'previsão do pedido', prorrogado: 'prorrogado' };
const ROT_TIPO = { lembrete: 'Lembrete', cobranca: 'Cobrança', escalada: 'Escalada', manual: 'Cobrança manual', prorrogacao: 'Prorrogação' };

export async function carregarPrestacao() {
  const e = state.empresa.id;
  const [S, C] = await Promise.all([q(sb.rpc('pa_prestacao', { p_empresa: e })).catch(() => null), q(sb.from('pa_config').select('*').eq('empresa_id', e)).catch(() => [])]);
  return { S: S || [], porId: new Map((S || []).map(x => [x.id, x])), cfg: C?.[0] || {}, semSQL: S == null };
}

/** etiqueta do prazo */
export function seloPrazo(s) {
  if (!s) return '';
  const d = +s.dias_restantes;
  return d < 0 ? `<span class="badge vencido">atrasada ${-d} dia(s)</span>` : d <= 2 ? `<span class="badge aberto">vence ${d ? `em ${d} dia(s)` : 'hoje'}</span>` : `<span class="badge conc">no prazo · ${d} dia(s)</span>`;
}

/** saldo pendente por pessoa (responsável = quem pediu) */
export function porPessoa(S) {
  const m = new Map();
  for (const s of S) {
    const k = s.responsavel || '—', x = m.get(k) || { pessoa: k, qtd: 0, valor: 0, atrasados: 0, valorAtrasado: 0, maiorAtraso: 0 };
    x.qtd++; x.valor += +s.valor;
    if (+s.dias_restantes < 0) { x.atrasados++; x.valorAtrasado += +s.valor; x.maiorAtraso = Math.max(x.maiorAtraso, -s.dias_restantes); }
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => b.valorAtrasado - a.valorAtrasado || b.valor - a.valor);
}

/** conteúdo da aba Prestação de contas: saldo por pessoa + lista por prazo, com as ações */
export function pintarPrestacao(box, { L, P, busca = '', soMeus = false, ligarNota, depois }) {
  const b = busca.trim().toLowerCase();
  const S = P.S.filter(s => (!soMeus || s.criado_por === state.user?.id) && (!b || `${s.numero} ${s.razao_social} ${s.responsavel}`.toLowerCase().includes(b)))
    .sort((x, y) => x.dias_restantes - y.dias_restantes);
  if (P.semSQL) { box.innerHTML = '<div class="card"><div class="empty">Rode o SQL 097 (prestação de contas do PA) para ver os prazos e as cobranças.</div></div>'; return; }
  const pessoas = porPessoa(S), ed = podeEditar() && !soMeus;
  box.innerHTML = `${!soMeus && pessoas.length ? `<div class="card" style="margin-bottom:12px"><h2 style="margin-top:0">Saldo pendente por pessoa</h2>
      <div class="table-wrap"><table><thead><tr><th>Responsável (quem pediu)</th><th class="num">PAs</th><th class="num">Aguardando nota</th><th class="num">Atrasado</th><th class="num">Maior atraso</th></tr></thead><tbody>
      ${pessoas.map(x => `<tr><td><b>${esc(x.pessoa)}</b></td><td class="num">${x.qtd}</td><td class="num">${money(x.valor)}</td><td class="num ${x.valorAtrasado ? 'neg' : ''}">${x.valorAtrasado ? `${money(x.valorAtrasado)} <span class="small">(${x.atrasados})</span>` : '—'}</td>
        <td class="num">${x.maiorAtraso ? `<span class="badge vencido">${x.maiorAtraso} dia(s)</span>` : '—'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>Total</th><th class="num">${S.length}</th><th class="num">${money(S.reduce((a, s) => a + +s.valor, 0))}</th><th class="num">${money(S.filter(s => s.dias_restantes < 0).reduce((a, s) => a + +s.valor, 0))}</th><th></th></tr></tfoot></table></div></div>` : ''}
    ${S.length ? `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Quem recebe</th><th>Responsável</th><th>Pago em</th><th>Prazo da nota</th><th>Cobranças</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${S.map(s => `<tr><td><b>${s.numero}</b></td><td class="wrap">${esc(s.razao_social)}</td><td>${esc(s.responsavel)}</td><td>${dateBR(s.data_pago)}</td>
        <td>${dateBR(s.prazo)} <div class="small muted">${ROT_ORIGEM[s.origem_prazo] || ''}</div>${seloPrazo(s)}</td>
        <td class="small">${+s.cobrancas ? `${s.cobrancas}× · última ${new Date(s.ultima_cobranca).toLocaleDateString('pt-BR')}<div class="muted">${ROT_TIPO[s.ultimo_tipo] || ''}${s.escalado ? ' · escalado' : ''}</div>` : '<span class="muted">nenhuma</span>'}</td>
        <td class="num">${money(s.valor)}</td>
        <td style="white-space:nowrap">${ed ? `<button class="btn ghost small" data-pa="nota" data-id="${s.id}">Ligar nota</button><button class="btn ghost small" data-pa="cobrar" data-id="${s.id}">Cobrar agora</button><button class="btn ghost small" data-pa="prorrogar" data-id="${s.id}">Prorrogar</button>` : ''}<button class="btn ghost small" data-pa="hist" data-id="${s.id}">Histórico</button></td></tr>`).join('')}
      </tbody></table></div></div>` : `<div class="card"><div class="empty">${soMeus ? 'Nenhuma nota fiscal pendente nos seus pedidos.' : 'Nenhum PA pago aguardando nota fiscal.'}</div></div>`}
    <p class="small muted">Prazo da nota: a previsão informada no pedido ou ${P.cfg.prazo_nota_dias ?? 15} dias depois do pagamento (muda em Parâmetros), ou o prazo prorrogado. ${P.cfg.cobrar_ativo === false ? '<b>A cobrança automática está desligada.</b>' : `Quem pediu recebe um lembrete ${P.cfg.lembrete_antes_dias ?? 2} dia(s) antes e a cobrança a cada ${P.cfg.cobrar_cada_dias ?? 3} dia(s) depois de vencido; com ${P.cfg.escalar_apos_dias ?? 10} dias de atraso, o financeiro e o diretor também são avisados.`}</p>`;
  box.onclick = (ev) => {
    const btn = ev.target.closest('[data-pa]'); if (!btn) return;
    const s = P.porId.get(btn.dataset.id), p = L.find(x => x.id === btn.dataset.id);
    if (btn.dataset.pa === 'nota' && p) ligarNota(p);
    if (btn.dataset.pa === 'cobrar') cobrar(s, depois);
    if (btn.dataset.pa === 'prorrogar') prorrogar(s, depois);
    if (btn.dataset.pa === 'hist') historico(s);
  };
}

function cobrar(s, depois) {
  const m = modal({ title: `Cobrar a nota do PA nº ${s.numero}`, body: `<p class="small" style="margin-top:0">${esc(s.razao_social)} · ${money(s.valor)} · responsável <b>${esc(s.responsavel)}</b> · prazo ${dateBR(s.prazo)} ${seloPrazo(s)}</p>
    <label>Mensagem (opcional)<textarea id="cb-m" rows="3" placeholder="Em branco: mensagem padrão pedindo a nota ao fornecedor"></textarea></label>
    <label class="chk" style="flex-direction:row;align-items:center;gap:8px;font-weight:400;margin-top:8px"><input type="checkbox" id="cb-e" style="width:auto;min-height:0"> Avisar também o financeiro e o diretor</label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cb-ok">Enviar cobrança</button>' });
  $('#cb-ok', m.el).onclick = async (ev) => { ev.target.disabled = true;
    try { await q(sb.rpc('pa_cobrar_agora', { p_id: s.id, p_mensagem: $('#cb-m', m.el).value.trim() || null, p_escalar: $('#cb-e', m.el).checked })); m.close(); toast('Cobrança enviada (aviso no sino, no celular e por e-mail, conforme as preferências)'); depois(); }
    catch (err) { fail(err); ev.target.disabled = false; } };
}

function prorrogar(s, depois) {
  const m = modal({ title: `Prorrogar o prazo do PA nº ${s.numero}`, narrow: true, body: `<p class="small" style="margin-top:0">Prazo atual ${dateBR(s.prazo)} (${ROT_ORIGEM[s.origem_prazo]}). A prorrogação fica no histórico e zera a escalada.</p>
    <label>Novo prazo<input type="date" id="pr-d" min="${today()}" value="${new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)}"></label><label>Motivo<input id="pr-m" maxlength="300" placeholder="ex.: fornecedor emite a nota na sexta"></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pr-ok">Prorrogar</button>' });
  $('#pr-ok', m.el).onclick = async (ev) => { ev.target.disabled = true;
    try { await q(sb.rpc('pa_prorrogar', { p_id: s.id, p_prazo: $('#pr-d', m.el).value, p_motivo: $('#pr-m', m.el).value })); m.close(); toast('Prazo prorrogado'); depois(); }
    catch (err) { fail(err); ev.target.disabled = false; } };
}

async function historico(s) {
  let H = [];
  try { H = await q(sb.from('pa_cobrancas').select('*').eq('paraquedas_id', s.id).order('enviado_em', { ascending: false })); } catch { /* compras não lê o histórico */ }
  modal({ title: `Cobranças do PA nº ${s.numero}`, body: H.length ? `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Tipo</th><th>Mensagem</th><th>Por</th></tr></thead><tbody>
    ${H.map(h => `<tr><td class="small">${new Date(h.enviado_em).toLocaleString('pt-BR')}</td><td>${ROT_TIPO[h.tipo]}${h.dias_atraso ? `<div class="small muted">${h.dias_atraso} dia(s) de atraso</div>` : ''}</td><td class="wrap small">${esc(h.mensagem || '')}</td><td class="small">${esc(h.enviado_por || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Nenhuma cobrança ainda.</div>', foot: '<button class="btn" data-close>Fechar</button>' });
}

/** Parâmetros da prestação de contas */
export function parametrosPA(cfg = {}, depois) {
  const P = ['financeiro', 'diretor', 'admin'];
  const m = modal({ title: 'Parâmetros da prestação de contas', body: `<div class="grid-form">
      <label class="c6">Prazo padrão da nota (dias depois do pagamento)<input id="pc-p" inputmode="numeric" value="${cfg.prazo_nota_dias ?? 15}"></label>
      <label class="c6">Lembrete antes do prazo (dias)<input id="pc-l" inputmode="numeric" value="${cfg.lembrete_antes_dias ?? 2}"></label>
      <label class="c6">Repetir a cobrança a cada (dias)<input id="pc-c" inputmode="numeric" value="${cfg.cobrar_cada_dias ?? 3}"></label>
      <label class="c6">Escalar com atraso de (dias)<input id="pc-e" inputmode="numeric" value="${cfg.escalar_apos_dias ?? 10}"></label></div>
    <div class="small" style="margin-top:8px">Na escalada, avisar: ${P.map(x => `<label class="chk" style="display:inline-flex;flex-direction:row;gap:6px;margin-right:14px;font-weight:400"><input type="checkbox" data-pap="${x}" style="width:auto;min-height:0" ${(cfg.escalar_papeis || ['financeiro', 'diretor']).includes(x) ? 'checked' : ''}> ${x === 'admin' ? 'administrador' : x}</label>`).join('')}</div>
    <label class="chk" style="flex-direction:row;align-items:center;gap:8px;font-weight:400;margin-top:10px"><input type="checkbox" id="pc-a" style="width:auto;min-height:0" ${cfg.cobrar_ativo !== false ? 'checked' : ''}> Cobrança automática ligada (todo dia às 8h)</label>
    <p class="small muted">A previsão de nota informada no pedido vale como prazo. Os avisos vão para o sino, o celular e o e-mail, conforme as preferências de cada pessoa em Meus avisos (tipo "Prestação de contas do PA").</p>`,
    foot: '<button class="btn ghost" id="pc-run" title="Roda agora a cobrança automática (lembretes, cobranças e escaladas pendentes)">Rodar a cobrança agora</button><span class="spacer" style="flex:1"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="pc-ok">Salvar</button>' });
  const n = (id, min, max) => Math.min(max, Math.max(min, parseInt($(id, m.el).value, 10) || min));
  $('#pc-ok', m.el).onclick = async (ev) => {
    const papeis = $$('[data-pap]', m.el).filter(x => x.checked).map(x => x.dataset.pap);
    ev.target.disabled = true;
    try { await q(sb.from('pa_config').upsert({ empresa_id: state.empresa.id, prazo_nota_dias: n('#pc-p', 1, 180), lembrete_antes_dias: n('#pc-l', 0, 30), cobrar_cada_dias: n('#pc-c', 1, 30),
        escalar_apos_dias: n('#pc-e', 1, 180), escalar_papeis: papeis, cobrar_ativo: $('#pc-a', m.el).checked, atualizado_em: new Date().toISOString() }));
      m.close(); toast('Parâmetros salvos'); depois(); } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#pc-run', m.el).onclick = async (ev) => { ev.target.disabled = true;
    try { const k = await q(sb.rpc('pa_cobrar_rodar', { p_empresa: state.empresa.id })); toast(k ? `${k} aviso(s) enviado(s)` : 'Nada a cobrar agora: os avisos de hoje já saíram'); m.close(); depois(); }
    catch (err) { fail(err); ev.target.disabled = false; } };
}

/** alertas para a Central de Decisões (regra 23) */
export async function alertasDecisao() {
  try {
    const { S, cfg } = await carregarPrestacao(); const at = S.filter(s => s.dias_restantes < 0);
    if (!at.length) return [];
    const pes = porPessoa(at).slice(0, 3).map(x => `${x.pessoa} ${money(x.valorAtrasado)} (${x.atrasados})`).join(' · ');
    return [{ nivel: at.some(s => -s.dias_restantes >= (cfg.escalar_apos_dias ?? 10)) ? 'alto' : 'medio', titulo: `${at.length} pagamento(s) antecipado(s) com a nota fiscal atrasada`, valor: at.reduce((a, s) => a + +s.valor, 0), detalhe: pes }];
  } catch { return []; }
}

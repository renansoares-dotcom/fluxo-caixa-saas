// Página pública da cotação (melhoria 5.2, SQL 132): o fornecedor abre o link recebido, sem login, e preenche o preço de
// cada item, o frete, o prazo de entrega, a condição de pagamento e a validade — ou diz que não vai cotar.
// Tudo passa por funções do banco que só aceitam o token do convite (cotacao_link_abrir / _responder / _recusar).
import { createClient } from '../vendor/supabase-2.117.2.esm.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { $, $$, esc, money, dateBR, toast, fail, modal } from './lib/ui.js';
import { parseParcelas } from './lib/cotacao-calc.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
const token = new URLSearchParams(location.search).get('t') || '';
const main = $('#ct-main');
const num = (s) => { const t = String(s ?? '').trim(); if (!t) return null; const v = parseFloat(t.replace(/\./g, '').replace(',', '.')); return isFinite(v) ? v : NaN; };
const qtd = (v) => (+v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const br = (v, c = 4) => v == null ? '' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: c });

async function iniciar() {
  if (!/^[0-9a-f]{64}$/.test(token)) { main.innerHTML = '<div class="card"><h2 style="margin-top:0">Link inválido</h2><p>Confira se o link foi copiado inteiro. Se o problema continuar, peça um novo link ao comprador.</p></div>'; return; }
  let C; try { C = await q(sb.rpc('cotacao_link_abrir', { p_token: token })); } catch (err) { main.innerHTML = `<div class="card"><h2 style="margin-top:0">Não foi possível abrir</h2><p>${esc(err.message)}</p></div>`; return; }
  $('#ct-emp').textContent = C.empresa || '';
  document.title = `Cotação nº ${C.numero} — ${C.empresa}`;
  pintar(C);
}

function pintar(C) {
  const r = C.resposta || {}, fechado = C.vencido || C.situacao === 'cancelado' || r.escolhida;
  const aviso = C.situacao === 'cancelado' ? '<div class="ct-aviso">O comprador cancelou este pedido de cotação.</div>'
    : r.escolhida ? '<div class="ct-ok">Esta cotação foi escolhida pelo comprador. Obrigado!</div>'
    : C.vencido ? `<div class="ct-aviso">O prazo para responder terminou em ${dateBR(C.expira_em)}.</div>`
    : C.situacao === 'respondido' ? `<div class="ct-ok">Cotação recebida em ${new Date(C.resposta.respondido_em).toLocaleString('pt-BR').slice(0, 17)}. Você pode corrigir até ${dateBR(C.expira_em)}.</div>`
    : C.situacao === 'recusado' ? `<div class="ct-aviso">Você informou que não vai cotar${C.recusa_motivo ? `: “${esc(C.recusa_motivo)}”` : ''}. Se mudar de ideia, preencha os preços abaixo até ${dateBR(C.expira_em)}.</div>`
    : `<div class="small muted">Responda até <b>${dateBR(C.expira_em)}</b>. Preencha só os itens que você fornece.</div>`;
  const dis = fechado ? 'disabled' : '';
  main.innerHTML = `<div class="card"><h2 style="margin:0">Cotação nº ${C.numero} <span class="muted small">para ${esc(C.fornecedor)}</span></h2>
      ${C.necessidade ? `<div class="small" style="margin-top:4px">Precisamos receber até <b>${dateBR(C.necessidade)}</b>.</div>` : ''}
      ${C.mensagem ? `<p style="white-space:pre-wrap;margin:10px 0 0">${esc(C.mensagem)}</p>` : ''}<div style="margin-top:10px">${aviso}</div></div>
    <form id="ct-f"><div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Quantidade</th>${C.itens.some(i => i.estimado) ? '<th class="num ct-hide-sm">Referência</th>' : ''}<th class="num">Preço unitário (R$)</th><th class="num ct-hide-sm">Total</th></tr></thead><tbody>
      ${C.itens.map(i => `<tr><td class="wrap"><b>${esc(i.descricao)}</b>${i.observacao ? `<div class="small muted">${esc(i.observacao)}</div>` : ''}</td><td class="num">${qtd(i.quantidade)} ${esc(i.unidade)}</td>
        ${C.itens.some(x => x.estimado) ? `<td class="num ct-hide-sm">${i.estimado ? br(i.estimado) : ''}</td>` : ''}
        <td class="num"><input class="ct-preco" data-i="${i.id}" data-q="${i.quantidade}" inputmode="decimal" placeholder="não cotado" value="${i.preco != null ? br(i.preco) : ''}" ${dis}></td><td class="num ct-hide-sm" data-t="${i.id}"></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:12px"><div class="grid-form">
      <label class="xs">Frete (R$)<input name="frete" inputmode="decimal" value="${r.frete != null ? br(r.frete, 2) : '0,00'}" ${dis}></label>
      <label class="xs">Prazo de entrega (dias)<input name="prazo" type="number" min="0" max="365" value="${r.prazo ?? ''}" ${dis}></label>
      <label>Condição de pagamento<input name="cond" placeholder="Ex.: 28/42/56 dias ou à vista" value="${esc(r.condicao || '')}" ${dis}></label>
      <label class="xs">Proposta válida até<input name="val" type="date" value="${r.validade || ''}" ${dis}></label>
      <label class="full">Observações<textarea name="obs" rows="2" maxlength="2000" placeholder="Impostos inclusos, marca, embalagem, quantidade mínima…" ${dis}>${esc(r.observacao || '')}</textarea></label>
      <label class="span2">Seu nome *<input name="nome" required maxlength="100" value="${esc((r.respondido_por || '').replace(/ <.*$/, ''))}" ${dis}></label>
      <label class="span2">Seu e-mail<input name="email" type="email" maxlength="120" ${dis}></label></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px"><div><b>Total da proposta: <span id="ct-tot">—</span></b></div>
        ${fechado ? '' : `<div style="display:flex;gap:8px">${C.situacao !== 'respondido' ? '<button type="button" class="btn ghost" id="ct-rec">Não vamos cotar</button>' : ''}<button type="submit" class="btn primary">${C.situacao === 'respondido' ? 'Enviar a correção' : 'Enviar a cotação'}</button></div>`}</div></div></form>
    <p class="small muted" style="margin-top:12px">Os preços vão direto para o comprador de ${esc(C.empresa)}. Esta página não pede cadastro nem senha.</p>`;
  const f = $('#ct-f');
  const somar = () => { let t = 0, ok = true;
    $$('[data-i]').forEach(i => { const v = num(i.value), cel = $(`[data-t="${i.dataset.i}"]`); if (Number.isNaN(v)) { ok = false; cel.textContent = '?'; return; } cel.textContent = v == null ? '' : money(v * +i.dataset.q); if (v != null) t += v * +i.dataset.q; });
    const fr = num(f.frete.value); $('#ct-tot').textContent = ok && !Number.isNaN(fr) ? money(t + (fr || 0)) : 'confira os valores'; };
  f.oninput = somar; somar();
  f.onsubmit = async (e) => {
    e.preventDefault(); if (!f.reportValidity()) return;
    const itens = $$('[data-i]').map(i => ({ item_id: i.dataset.i, valor_unitario: num(i.value) })).filter(x => x.valor_unitario != null);
    if (itens.some(x => Number.isNaN(x.valor_unitario) || x.valor_unitario < 0)) return toast('Confira os preços: use números, com vírgula nos centavos', true);
    if (!itens.length) return toast('Preencha o preço de pelo menos um item', true);
    const fr = num(f.frete.value); if (Number.isNaN(fr) || fr < 0) return toast('Frete inválido', true);
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      await q(sb.rpc('cotacao_link_responder', { p_token: token, p_itens: itens, p_prazo_dias: f.prazo.value === '' ? null : +f.prazo.value, p_condicao: f.cond.value || null,
        p_parcelas: parseParcelas(f.cond.value).length ? parseParcelas(f.cond.value) : null, p_frete: fr || 0, p_validade: f.val.value || null, p_observacao: f.obs.value || null,
        p_nome: f.nome.value, p_email: f.email.value || null }));
      sb.functions.invoke('notificar', { body: {} }).catch(() => {});
      toast('Cotação enviada. Obrigado!'); iniciar();
    } catch (err) { fail(err); btn.disabled = false; }
  };
  $('#ct-rec') && ($('#ct-rec').onclick = () => {
    const m = modal({ title: 'Não vamos cotar', body: '<label>Motivo (opcional)<textarea id="rc-m" rows="3" maxlength="500" placeholder="Ex.: sem estoque, não trabalhamos com este item"></textarea></label>',
      foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="rc-ok">Confirmar</button>' });
    $('#rc-ok', m.el).onclick = async () => { try { await q(sb.rpc('cotacao_link_recusar', { p_token: token, p_motivo: $('#rc-m', m.el).value || null })); m.close(); toast('Obrigado pelo retorno'); iniciar(); } catch (err) { fail(err); } };
  });
}
iniciar();

// Comunicação › Meus avisos (AJU003): aviso no celular deste aparelho, aviso de teste, horário de silêncio e, por tipo,
// se o aviso vai para o celular (e para o e-mail, quando o envio de e-mail estiver ligado). Cada pessoa vê só os seus.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail } from '../lib/ui.js';
import * as A from '../lib/avisos.js';
import { estadoPush, ativarPush, desativarPush, dispararAvisos } from '../lib/notif.js';

export const title = 'Meus avisos';
const CSS = `<style>
  .ma-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:stretch}
  .ma-est{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .ma-sel{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--primary-soft)}
  .ma-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.ma-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .ma-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}
  .card label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input{width:auto;min-height:0}
  .ma-tab td{vertical-align:middle}.ma-tab .sw{width:auto;min-height:0;transform:scale(1.2)}
  .ma-hor{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin-top:10px}.ma-hor label{width:120px}
  @media(max-width:860px){.ma-grid{grid-template-columns:1fr}}
</style>`;

export async function render(root) {
  const e = state.empresa.id;
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Meus avisos</h2><div class="muted small">O que chega no seu celular ou computador, e quando. Só você vê e muda estas escolhas.</div></div></div>
    <div id="ma-corpo"><div class="loading">Carregando…</div></div>`;
  let Ti, Pr, Ho, Ul, EMAIL_LIGADO = false, WA = null, WA_LIGADO = false;   // WhatsApp: melhoria 1.1b (SQL 125)
  try {
    [Ti, Pr, Ho, Ul] = await Promise.all([
      q(sb.from('notif_tipos').select('*').order('ordem')),
      q(sb.from('notif_preferencias').select('*').eq('empresa_id', e)),
      q(sb.from('notif_horarios').select('*').eq('empresa_id', e)),
      q(sb.from('notificacoes').select('id,tipo,titulo,criado_em,enviado_em,push_situacao,urgente').eq('empresa_id', e).order('criado_em', { ascending: false }).limit(8)),
    ]);
  } catch (err) { fail(err); $('#ma-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 090 (avisos) já foi executado.</div></div>'; return; }
  try { EMAIL_LIGADO = !!(await q(sb.from('email_config').select('ativo').eq('empresa_id', e)))[0]?.ativo; } catch { /* SQL 092 ainda não rodado */ }
  try { WA = (await q(sb.from('wa_contatos').select('*').eq('user_id', state.user.id)))[0] || {}; WA_LIGADO = !!(await q(sb.from('wa_config').select('ativo').eq('empresa_id', e)))[0]?.ativo; } catch { WA = null; }
  const temWA = WA != null, waOk = !!(WA?.numero && WA?.optin_em);
  const hor = { ...A.PADRAO, ...(Ho[0] || {}) };
  hor.inicio = String(hor.inicio).slice(0, 5); hor.fim = String(hor.fim).slice(0, 5);
  const pref = Object.fromEntries(Pr.map(p => [p.tipo, p]));
  const est = await estadoPush().catch(() => 'sem');
  const EST = { ativo: ['Ativos neste aparelho', 'pos'], inativo: ['Desligados neste aparelho', 'warn'], bloqueado: ['Bloqueados no navegador', 'neg'], ios: ['iPhone: instale o app primeiro', 'warn'], sem: ['Este navegador não recebe avisos', 'neg'] }[est];
  const grupos = [...new Set(Ti.map(t => t.grupo))];
  $('#ma-corpo', root).innerHTML = `<div class="ma-grid">
    <div class="card"><h2>Este aparelho</h2><div class="ma-est"><span class="ma-sel ${EST[1]}">${EST[0]}</span>
        ${est === 'ativo' ? '<button class="btn ghost small" id="ma-off">Desligar aqui</button>' : est === 'inativo' ? '<button class="btn primary small" id="ma-on">Ativar avisos neste aparelho</button>' : ''}
        <button class="btn small" id="ma-teste">Mandar um aviso de teste</button></div>
      <p class="small muted" style="margin-bottom:0">${est === 'bloqueado' ? 'Libere em Configurações do site › Notificações e volte aqui.' : est === 'ios' ? 'No iPhone: Compartilhar › Adicionar à Tela de Início, abra pelo ícone e ative aqui.' : 'Ative em cada aparelho que você usa (computador e celular). O teste chega em até 1 minuto.'}</p></div>
    <div class="card"><h2>Horário de silêncio</h2>
      <label class="chk"><input type="checkbox" id="ma-sil" ${hor.silencio ? 'checked' : ''}> Não mandar aviso ao celular no horário de silêncio</label>
      <div class="ma-hor"><label>Das<input type="time" id="ma-ini" value="${hor.inicio}"></label><label>Até<input type="time" id="ma-fim" value="${hor.fim}"></label>
        <label class="chk" style="width:auto"><input type="checkbox" id="ma-fds" ${hor.fim_de_semana ? 'checked' : ''}> Fim de semana inteiro</label></div>
      <p class="small" id="ma-res" style="margin:10px 0 0"></p></div></div>
    ${temWA ? `<div class="card" style="margin-top:16px"><h2>WhatsApp ${waOk ? '<span class="ma-sel pos">aceito</span>' : ''}${WA_LIGADO ? '' : ' <span class="ma-sel warn">envio ainda desligado pelo administrador</span>'}</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end"><label style="min-width:220px">Seu celular com DDD<input id="ma-wa" inputmode="tel" value="${esc(WA.numero ? WA.numero.replace(/^55(\d\d)(\d+)(\d{4})$/, '($1) $2-$3') : '')}" placeholder="(81) 99999-9999"></label>
        <label class="chk" style="width:auto"><input type="checkbox" id="ma-wa-ok" ${waOk ? 'checked' : ''}> Aceito receber os avisos marcados abaixo pelo WhatsApp</label>
        <button class="btn small" id="ma-wa-s">Salvar</button></div>
      <p class="small muted" style="margin-bottom:0">Vale para todas as empresas em que você está. Desmarque o aceite a qualquer momento para parar.</p></div>` : ''}
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0;display:flex;justify-content:space-between;align-items:center"><h2>Por tipo de aviso</h2>
        <span class="small muted">O sino da plataforma recebe tudo, sempre.</span></div>
      <div class="table-wrap"><table class="ma-tab"><thead><tr><th>Aviso</th><th style="width:110px;text-align:center">Celular</th><th style="width:110px;text-align:center">E-mail${EMAIL_LIGADO ? `<div class="small muted" style="font-weight:400">${esc(state.user.email)}</div>` : '<div class="small muted" style="font-weight:400">quando o envio for ligado</div>'}</th>${temWA ? '<th style="width:110px;text-align:center">WhatsApp</th>' : ''}</tr></thead><tbody>
      ${grupos.map(g => `<tr><td colspan="${temWA ? 4 : 3}" class="small" style="background:var(--surface-2);font-weight:600">${esc(g)}</td></tr>` + Ti.filter(t => t.grupo === g).map(t => `<tr>
        <td><b>${esc(t.nome)}</b>${t.urgente ? ' <span class="ma-sel neg">urgente: passa pelo silêncio</span>' : ''}<div class="small muted">${esc(t.descricao || '')}</div></td>
        <td style="text-align:center"><input type="checkbox" class="sw" data-t="${t.codigo}" data-c="push" ${pref[t.codigo]?.push === false ? '' : 'checked'}></td>
        <td style="text-align:center"><input type="checkbox" class="sw" data-t="${t.codigo}" data-c="email" ${pref[t.codigo]?.email ? 'checked' : ''} ${EMAIL_LIGADO || pref[t.codigo]?.email ? '' : 'disabled title="O administrador ainda não ligou o envio de e-mail (Cadastros › E-mails da Plataforma)"'} ${t.codigo === 'chat' || t.codigo === 'teste' ? 'disabled' : ''}></td>
        ${temWA ? `<td style="text-align:center"><input type="checkbox" class="sw" data-t="${t.codigo}" data-c="whatsapp" ${pref[t.codigo]?.whatsapp ? 'checked' : ''} ${waOk || pref[t.codigo]?.whatsapp ? '' : 'disabled title="Cadastre o seu celular e aceite receber pelo WhatsApp (acima)"'} ${t.codigo === 'chat' || t.codigo === 'teste' ? 'disabled' : ''}></td>` : ''}</tr>`).join('')).join('')}
      </tbody></table></div></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Seus últimos avisos</h2></div><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Aviso</th><th>No celular</th></tr></thead><tbody>
      ${Ul.map(n => `<tr><td class="small">${new Date(n.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td class="wrap">${n.urgente ? '🔴 ' : ''}${esc(n.titulo)}</td>
        <td class="small">${n.enviado_em ? esc(A.SITUACAO_PUSH[n.push_situacao] || 'Enviado') : A.emSilencio(hor) && !n.urgente ? A.SITUACAO_PUSH.silencio : 'Na fila'}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhum aviso ainda.</td></tr>'}</tbody></table></div></div>`;

  const corpo = $('#ma-corpo', root), re = () => render(root);
  const resumo = () => { $('#ma-res', corpo).innerHTML = esc(A.resumoHorario(hor)) + (A.emSilencio(hor) ? ' <span class="ma-sel warn">agora: em silêncio</span>' : ''); };
  resumo();
  $('#ma-on', corpo) && ($('#ma-on', corpo).onclick = () => ativarPush(re));
  $('#ma-off', corpo) && ($('#ma-off', corpo).onclick = () => desativarPush(re));
  $('#ma-teste', corpo).onclick = async (ev) => {
    ev.target.disabled = true;
    try { await q(sb.rpc('notif_teste', { p_empresa: e })); await dispararAvisos(); toast(est === 'ativo' ? 'Aviso de teste enviado: confira o aparelho.' : 'Aviso de teste no sino. Ative os avisos neste aparelho para recebê-lo no celular.'); setTimeout(re, 1500); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
  const salvarHor = async () => {
    Object.assign(hor, { silencio: $('#ma-sil', corpo).checked, inicio: $('#ma-ini', corpo).value || '20:00', fim: $('#ma-fim', corpo).value || '07:00', fim_de_semana: $('#ma-fds', corpo).checked });
    resumo();
    try { await q(sb.from('notif_horarios').upsert({ user_id: state.user.id, empresa_id: e, silencio: hor.silencio, inicio: hor.inicio, fim: hor.fim, fim_de_semana: hor.fim_de_semana, fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || A.PADRAO.fuso, atualizado_em: new Date().toISOString() })); toast('Horário salvo'); }
    catch (err) { fail(err); }
  };
  ['#ma-sil', '#ma-ini', '#ma-fim', '#ma-fds'].forEach(s => $(s, corpo).onchange = salvarHor);
  $('#ma-wa-s', corpo) && ($('#ma-wa-s', corpo).onclick = async () => {
    const d = $('#ma-wa', corpo).value.replace(/\D/g, '').replace(/^0+/, ''), n = /^55\d{10,11}$/.test(d) ? d : /^\d{10,11}$/.test(d) ? '55' + d : null, ok = $('#ma-wa-ok', corpo).checked;
    if (ok && !n) return toast('Informe o celular com DDD', true);
    try { await q(sb.from('wa_contatos').upsert({ user_id: state.user.id, numero: n, optin_em: ok ? (WA.optin_em || new Date().toISOString()) : null, atualizado_em: new Date().toISOString() }));
      toast(ok ? 'WhatsApp salvo: marque os avisos que quer receber' : 'Você não recebe mais avisos pelo WhatsApp'); re(); } catch (err) { fail(err); }
  });
  $$('.sw', corpo).forEach(c => c.onchange = async () => {
    const t = c.dataset.t, row = { user_id: state.user.id, empresa_id: e, tipo: t, push: $(`.sw[data-t="${t}"][data-c=push]`, corpo).checked, email: $(`.sw[data-t="${t}"][data-c=email]`, corpo).checked, atualizado_em: new Date().toISOString() };
    const w = $(`.sw[data-t="${t}"][data-c=whatsapp]`, corpo); if (w) row.whatsapp = w.checked;
    try { await q(sb.from('notif_preferencias').upsert(row)); toast(c.dataset.c === 'whatsapp' ? (row.whatsapp ? 'Esse aviso também vai pelo WhatsApp' : 'Esse aviso não vai mais pelo WhatsApp') : c.dataset.c === 'email' ? (row.email ? 'Esse aviso também vai por e-mail' : 'Esse aviso não vai mais por e-mail') : row.push ? 'Esse aviso vai para o celular' : 'Esse aviso fica só no sino'); } catch (err) { fail(err); c.checked = !c.checked; }
  });
}

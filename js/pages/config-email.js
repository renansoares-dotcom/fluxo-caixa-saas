// Cadastros › E-mails da Plataforma (CAD009): remetente, ligar/desligar o envio, e-mail de teste, modelos com prévia e a
// fila com a situação de cada e-mail. Só o administrador altera.
import { sb, state, q, isAdmin } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal } from '../lib/ui.js';
import { montar, SITUACAO } from '../lib/email.js';

export const title = 'E-mails da Plataforma';
const EXEMPLO = { empresa: '', cliente: 'SUPERMERCADOS BOA COMPRA LTDA', validade: '21/11/2026', arte: 'Biscoito Crocantíssimo Maria 200 g', numero: 41, versao: 2,
  observacao: 'Nome “Maria Tradicional” e selo “Nova receita”.', prazo: '10/11/2026', documento: 'NF 18.211', decisao: 'APROVADA', vencimento: '25/11/2026', resposta: 'Aprovado em caráter excepcional.',
  titulo: 'Arte nº 39 APROVADA pelo cliente', texto: 'Suco Pomar do Vale Laranja 1 L · Ana Paula Ribeiro', nome: 'Renata', caminho: 'portal.html' };
const CSS = `<style>
  .ce-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:stretch}
  .ce-sel{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .ce-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.ce-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .ce-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.ce-sel.muted{background:var(--surface-2);color:var(--muted)}
  .card label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input{width:auto;min-height:0}
  .ce-passos{margin:0;padding-left:18px;font-size:13px;line-height:1.7}
  .ce-prev{width:100%;height:420px;border:1px solid var(--border);border-radius:10px;background:#f3f5f9}
  .ce-ed{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
  @media(max-width:900px){.ce-grid,.ce-ed{grid-template-columns:1fr}}
</style>`;

export async function render(root) {
  const e = state.empresa.id;
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">E-mails da Plataforma</h2><div class="muted small">Convites do Portal, artes para aprovar, respostas de prorrogação e os avisos que cada pessoa escolheu receber por e-mail.</div></div></div>
    <div id="ce-corpo"><div class="loading">Carregando…</div></div>`;
  let Cf, Mo, Pa, Fi;
  try {
    [Cf, Mo, Pa, Fi] = await Promise.all([
      q(sb.from('email_config').select('*').eq('empresa_id', e)), q(sb.from('email_modelos').select('*').eq('empresa_id', e)),
      q(sb.rpc('email_padrao')), isAdmin() ? q(sb.from('email_fila').select('*').eq('empresa_id', e).order('criado_em', { ascending: false }).limit(60)) : [],
    ]);
  } catch (err) { fail(err); $('#ce-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 092 (e-mail) já foi executado.</div></div>'; return; }
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  const c = Cf[0] || { ativo: false, remetente_nome: state.empresa.nome || 'IPLAMM', remetente_email: 'avisos@iplamm.com.br', responder_para: '', url_base: base, rodape: 'Mensagem automática da plataforma.' };
  c.url_base ||= base;
  const ed = isAdmin(), modelo = (cod) => Mo.find(m => m.codigo === cod) || Pa.find(p => p.codigo === cod);
  const nomes = Object.fromEntries(Pa.map(p => [p.codigo, p.nome]));
  const pend = Fi.filter(f => f.situacao === 'pendente').length, err = Fi.filter(f => f.situacao === 'erro').length;
  $('#ce-corpo', root).innerHTML = `<div class="ce-grid">
    <div class="card"><h2>Envio ${c.ativo ? '<span class="ce-sel pos">ligado</span>' : '<span class="ce-sel warn">desligado</span>'}</h2>
      <form id="ce-f" class="grid-form">
        <label class="c4">Nome do remetente<input name="remetente_nome" value="${esc(c.remetente_nome)}" maxlength="60" ${ed ? '' : 'disabled'}></label>
        <label class="c8">E-mail do remetente<input name="remetente_email" type="email" value="${esc(c.remetente_email)}" ${ed ? '' : 'disabled'}></label>
        <label class="c4">Responder para<input name="responder_para" type="email" value="${esc(c.responder_para || '')}" placeholder="ex.: financeiro@…" ${ed ? '' : 'disabled'}></label>
        <label class="c8">Endereço da plataforma (links dos e-mails)<input name="url_base" value="${esc(c.url_base)}" ${ed ? '' : 'disabled'}></label>
        <label class="full" style="grid-column:1/-1">Rodapé<input name="rodape" value="${esc(c.rodape)}" maxlength="300" ${ed ? '' : 'disabled'}></label></form>
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="ce-on" ${c.ativo ? 'checked' : ''} ${ed ? '' : 'disabled'}> Ligar o envio (só depois de o domínio estar validado no provedor)</label>
      ${ed ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap"><button class="btn" id="ce-teste">Mandar e-mail de teste para mim</button><button class="btn primary" id="ce-salvar">Salvar</button></div>` : ''}</div>
    <div class="card"><h2>Para ligar o envio</h2><ol class="ce-passos">
        <li>Criar a conta no <b>Resend</b> (resend.com) e adicionar o domínio <b>${esc((c.remetente_email.split('@')[1]) || 'iplamm.com.br')}</b>.</li>
        <li>O TI cadastra no DNS do domínio os registros que o Resend mostrar (SPF, DKIM e o de retorno) e espera ficar <b>Verified</b>.</li>
        <li>Criar a chave de API (permissão de envio) e cadastrar no Supabase › Edge Functions › Secrets como <code>RESEND_API_KEY</code>.</li>
        <li>Aqui: marcar <b>Ligar o envio</b>, salvar e mandar o e-mail de teste.</li></ol>
      <p class="small muted" style="margin-bottom:0">Enquanto o envio estiver desligado, os e-mails ficam na fila por até 7 dias e saem quando ligar. Fila agora: <b>${pend}</b> esperando${err ? ` · <span class="neg">${err} com erro</span>` : ''}.</p></div></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Modelos</h2></div><div class="table-wrap"><table><thead><tr><th>E-mail</th><th>Assunto</th><th>Situação</th><th></th></tr></thead><tbody>
      ${Pa.map(p => { const m = modelo(p.codigo), proprio = Mo.some(x => x.codigo === p.codigo);
        return `<tr><td><b>${esc(p.nome)}</b><div class="small muted">campos: ${esc(p.campos)}</div></td><td class="wrap small">${esc(m.assunto)}</td>
          <td>${m.ativo === false ? '<span class="ce-sel muted">desligado</span>' : '<span class="ce-sel pos">ligado</span>'}${proprio ? ' <span class="small muted">· texto próprio</span>' : ''}</td>
          <td><button class="btn ghost small" data-m="${p.codigo}">${ed ? 'Editar' : 'Ver'}</button></td></tr>`; }).join('')}</tbody></table></div></div>
    ${ed ? `<div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Últimos e-mails</h2></div><div class="table-wrap" style="max-height:420px"><table><thead><tr><th>Quando</th><th>Para</th><th>E-mail</th><th>Situação</th></tr></thead><tbody>
      ${Fi.map(f => `<tr><td class="small">${new Date(f.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td class="small">${esc(f.para)}</td>
        <td class="wrap small">${esc(nomes[f.codigo] || f.codigo)}<div class="muted">${esc(montar(modelo(f.codigo) || { assunto: '', corpo: '' }, f.campos, c).assunto)}</div></td>
        <td><span class="ce-sel ${f.situacao === 'enviado' ? 'pos' : f.situacao === 'erro' ? 'neg' : f.situacao === 'pendente' ? 'warn' : 'muted'}">${SITUACAO[f.situacao]}</span>${f.erro ? `<div class="small neg wrap">${esc(f.erro)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum e-mail ainda.</td></tr>'}</tbody></table></div></div>` : ''}`;

  const corpo = $('#ce-corpo', root), re = () => render(root);
  const ler = () => ({ empresa_id: e, ...Object.fromEntries([...$('#ce-f', corpo).querySelectorAll('[name]')].map(i => [i.name, i.value.trim() || null])), ativo: $('#ce-on', corpo).checked, atualizado_em: new Date().toISOString() });
  $('#ce-salvar', corpo) && ($('#ce-salvar', corpo).onclick = async (ev) => {
    const d = ler(); if (!d.remetente_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.remetente_email)) return toast('Informe o e-mail do remetente', true);
    d.remetente_nome ||= 'IPLAMM'; d.rodape ||= ''; ev.target.disabled = true;
    try { await q(sb.from('email_config').upsert(d)); toast(d.ativo ? 'Salvo. Envio ligado.' : 'Salvo. Envio desligado: os e-mails ficam na fila.'); re(); } catch (err) { fail(err); ev.target.disabled = false; }
  });
  $('#ce-teste', corpo) && ($('#ce-teste', corpo).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      await q(sb.rpc('email_teste', { p_empresa: e }));
      const { data } = await sb.functions.invoke('email', { body: {} });
      toast(data?.enviados ? 'E-mail de teste enviado: confira a sua caixa de entrada.' : !c.ativo ? 'O teste ficou na fila: ligue o envio quando o domínio estiver validado.' : data?.sem_chave ? 'Falta o segredo RESEND_API_KEY no Supabase.' : 'O teste não saiu: veja o erro em Últimos e-mails.', !data?.enviados);
      setTimeout(re, 800);
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
  $$('[data-m]', corpo).forEach(b => b.onclick = () => editar(e, Pa.find(p => p.codigo === b.dataset.m), Mo.find(m => m.codigo === b.dataset.m), c, ed, re));
}

function editar(e, padrao, meu, cfg, ed, depois) {
  const m0 = { ...padrao, ...(meu || {}), ativo: meu ? meu.ativo : true };
  const m = modal({ title: `Modelo — ${padrao.nome}`, wide: true, body: `<div class="ce-ed"><div>
      <label>Assunto<input id="me-a" value="${esc(m0.assunto)}" maxlength="200" ${ed ? '' : 'disabled'}></label>
      <label style="margin-top:8px">Texto (linha em branco separa os parágrafos)<textarea id="me-c" rows="12" ${ed ? '' : 'disabled'}>${esc(m0.corpo)}</textarea></label>
      <label style="margin-top:8px">Texto do botão${padrao.botao ? '' : ' (este e-mail não tem link)'}<input id="me-b" value="${esc(m0.botao || '')}" maxlength="40" ${ed && padrao.botao ? '' : 'disabled'}></label>
      <label class="chk" style="margin-top:10px;display:flex;flex-direction:row;gap:8px;align-items:center"><input type="checkbox" id="me-on" style="width:auto;min-height:0" ${m0.ativo ? 'checked' : ''} ${ed && padrao.codigo !== 'teste' ? '' : 'disabled'}> Mandar este e-mail</label>
      <p class="small muted">Campos que você pode usar: ${esc(padrao.campos).split(', ').map(x => `<code>{{${x}}}</code>`).join(' ')}</p></div>
    <div><div class="small muted" style="margin-bottom:4px">Prévia (com dados de exemplo)</div><iframe class="ce-prev" id="me-p" sandbox title="Prévia do e-mail"></iframe><div class="small" id="me-as" style="margin-top:6px"></div></div></div>`,
    foot: `${ed && meu ? '<button class="btn ghost" id="me-pad">Voltar ao texto padrão</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Fechar</button>${ed ? '<button class="btn primary" id="me-ok">Salvar</button>' : ''}` });
  const atual = () => ({ assunto: $('#me-a', m.el).value, corpo: $('#me-c', m.el).value, botao: $('#me-b', m.el).value || padrao.botao, ativo: $('#me-on', m.el).checked });
  const prev = () => { const r = montar(atual(), { ...EXEMPLO, empresa: state.empresa.nome || cfg.remetente_nome }, cfg); $('#me-p', m.el).srcdoc = r.html; $('#me-as', m.el).innerHTML = `<b>Assunto:</b> ${esc(r.assunto)}`; };
  ['#me-a', '#me-c', '#me-b'].forEach(s => $(s, m.el).oninput = prev); prev();
  $('#me-ok', m.el) && ($('#me-ok', m.el).onclick = async () => {
    const a = atual(); if (!a.assunto.trim() || !a.corpo.trim()) return toast('Assunto e texto são obrigatórios', true);
    try { await q(sb.from('email_modelos').upsert({ empresa_id: e, codigo: padrao.codigo, assunto: a.assunto.trim(), corpo: a.corpo, botao: padrao.botao ? (a.botao || null) : null, ativo: a.ativo, atualizado_em: new Date().toISOString() }));
      m.close(); toast('Modelo salvo'); depois(); } catch (err) { fail(err); }
  });
  $('#me-pad', m.el) && ($('#me-pad', m.el).onclick = async () => {
    try { await q(sb.from('email_modelos').delete().eq('empresa_id', e).eq('codigo', padrao.codigo)); m.close(); toast('Voltou ao texto padrão'); depois(); } catch (err) { fail(err); }
  });
}

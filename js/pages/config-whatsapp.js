// Cadastros › WhatsApp da Plataforma (CAD012) — melhoria 1.1b (SQL 125, 08/11/2026).
// Liga o envio pela API oficial (WhatsApp Cloud API), liga cada mensagem ao modelo aprovado na Meta (nome e ordem dos
// campos), mostra o texto sugerido para aprovar, manda a mensagem de teste e lista a fila. Só o administrador altera.
import { sb, state, q, isAdmin } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal } from '../lib/ui.js';
import { previa, SITUACAO } from '../lib/whatsapp.js';

export const title = 'WhatsApp da Plataforma';
const EXEMPLO = { empresa: 'IPLAMM', arte: 'Biscoito Crocantíssimo Maria 200 g', versao: 2, prazo: '10/11/2026', documento: 'NF 18.211', decisao: 'APROVADO', vencimento: '25/11/2026',
  notas: '6120, 6121', veiculo: 'ABC1D23', nota: '6120', quando: '08/11/2026 11:32', recebedor: 'JOÃO PEREIRA', titulo: 'PA nº 9 autorizado', texto: 'R$ 1.200,00 · Beatriz Rocha', nome: 'Renata' };
const sel = (s) => `<span class="ce-sel ${SITUACAO[s]?.[1] || 'muted'}">${SITUACAO[s]?.[0] || s}</span>`;

export async function render(root) {
  const e = state.empresa.id, ed = isAdmin();
  root.innerHTML = `<style>.ce-sel{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
    .ce-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.ce-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
    .ce-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.ce-sel.muted{background:var(--surface-2);color:var(--muted)}
    .wa-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}@media(max-width:900px){.wa-grid{grid-template-columns:1fr}}
    .card label.chk,.modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input,.modal label.chk input{width:auto;min-height:0}
    .wa-bal{background:#e7f8dc;border-radius:10px;padding:10px 12px;font-size:13px;white-space:pre-wrap;color:#1d2433}</style>
    <div class="mm-topo"><div><h2 style="margin:0">WhatsApp da Plataforma</h2><div class="muted small">As mesmas mensagens do e-mail, pelo WhatsApp de quem aceitou receber: clientes do Portal e a equipe.</div></div></div>
    <div id="wa-corpo"><div class="loading">Carregando…</div></div>`;
  let Cf, Mo, Pa, Fi;
  try {
    [Cf, Mo, Pa, Fi] = await Promise.all([q(sb.from('wa_config').select('*').eq('empresa_id', e)), q(sb.from('wa_modelos').select('*').eq('empresa_id', e)).catch(() => []),
      q(sb.rpc('wa_padrao')), ed ? q(sb.from('wa_fila').select('*').eq('empresa_id', e).order('criado_em', { ascending: false }).limit(60)) : []]);
  } catch (err) { fail(err); $('#wa-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 125 (WhatsApp) já foi executado.</div></div>'; return; }
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  const c = Cf[0] || { ativo: false, phone_number_id: '', numero_exibicao: '', idioma: 'pt_BR', url_base: base };
  const modelo = (cod) => ({ ...Pa.find(p => p.codigo === cod), ...(Mo.find(m => m.codigo === cod) || {}) });
  const pend = Fi.filter(f => f.situacao === 'pendente').length, err = Fi.filter(f => f.situacao === 'erro').length;
  const corpo = $('#wa-corpo', root);
  corpo.innerHTML = `<div class="wa-grid">
    <div class="card"><h2>Envio ${c.ativo ? '<span class="ce-sel pos">ligado</span>' : '<span class="ce-sel warn">desligado</span>'}</h2>
      <div class="grid-form">
        <label class="c6">Identificação do número (Phone number ID)<input id="wa-pid" value="${esc(c.phone_number_id || '')}" inputmode="numeric" ${ed ? '' : 'disabled'}></label>
        <label class="c6">Número que o cliente vê<input id="wa-num" value="${esc(c.numero_exibicao || '')}" placeholder="(81) 3721-0000" ${ed ? '' : 'disabled'}></label>
        <label class="c4">Idioma dos modelos<input id="wa-id" value="${esc(c.idioma || 'pt_BR')}" ${ed ? '' : 'disabled'}></label>
        <label class="c8">Endereço da plataforma (links dos botões)<input id="wa-url" value="${esc(c.url_base || base)}" ${ed ? '' : 'disabled'}></label></div>
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="wa-on" ${c.ativo ? 'checked' : ''} ${ed ? '' : 'disabled'}> Ligar o envio (só depois de os modelos estarem aprovados na Meta)</label>
      ${ed ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap"><button class="btn" id="wa-teste">Mandar teste para o meu WhatsApp</button><button class="btn primary" id="wa-salvar">Salvar</button></div>` : ''}</div>
    <div class="card"><h2>Para ligar o envio</h2><ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">
      <li>No <b>Meta Business</b> da empresa, criar o app com o produto <b>WhatsApp</b> e cadastrar o número da empresa (que não esteja em uso no WhatsApp do celular).</li>
      <li>Em <b>Modelos de mensagem</b>, criar os 6 modelos da tabela abaixo, categoria <b>Utilidade</b>, idioma Português (BR), com o texto sugerido. Nos que têm link, adicionar o botão <b>Acessar site</b> com URL dinâmica: <code>${esc((c.url_base || base).replace(/\/?$/, '/'))}{{1}}</code>.</li>
      <li>Criar um <b>usuário do sistema</b> com token permanente (permissão whatsapp_business_messaging) e cadastrar no Supabase › Edge Functions › Secrets como <code>WHATSAPP_TOKEN</code>.</li>
      <li>Aqui: informar o <b>Phone number ID</b>, ligar o envio, salvar e mandar o teste (o seu celular precisa estar em Meus avisos, com o aceite).</li></ol>
      <p class="small muted" style="margin-bottom:0">Enquanto estiver desligado, as mensagens ficam na fila por até 3 dias. Fila agora: <b>${pend}</b> esperando${err ? ` · <span class="neg">${err} com erro</span>` : ''}.</p></div></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Modelos</h2><p class="small muted" style="margin:4px 0 0">Cada mensagem usa um modelo aprovado na Meta. Se o nome ou a ordem dos campos for diferente do sugerido, ajuste aqui.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Mensagem</th><th>Modelo na Meta</th><th>Campos ({{1}}, {{2}}…)</th><th>Situação</th><th></th></tr></thead><tbody>
      ${Pa.map(p => { const m = modelo(p.codigo), proprio = Mo.some(x => x.codigo === p.codigo);
        return `<tr><td><b>${esc(p.nome)}</b></td><td><code>${esc(m.template)}</code>${proprio ? ' <span class="small muted">· ajustado</span>' : ''}</td><td class="small">${(m.parametros || []).map((x, i) => `${i + 1}=${esc(x)}`).join(' · ')}${m.botao_campo ? ' · botão=link' : ''}</td>
          <td>${m.ativo === false ? '<span class="ce-sel muted">desligado</span>' : '<span class="ce-sel pos">ligado</span>'}</td><td><button class="btn ghost small" data-m="${p.codigo}">${ed ? 'Editar' : 'Ver'}</button></td></tr>`; }).join('')}</tbody></table></div></div>
    ${ed ? `<div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Últimas mensagens</h2></div><div class="table-wrap" style="max-height:420px"><table><thead><tr><th>Quando</th><th>Para</th><th>Mensagem</th><th>Situação</th></tr></thead><tbody>
      ${Fi.map(f => `<tr><td class="small">${new Date(f.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td class="small">+${esc(f.para.replace(/^55(\d\d)(\d+)(\d{4})$/, '55 $1 $2-$3'))}</td>
        <td class="small">${esc(Pa.find(p => p.codigo === f.codigo)?.nome || f.codigo)}</td><td>${sel(f.situacao)}${f.erro ? `<div class="small neg wrap">${esc(f.erro)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhuma mensagem ainda.</td></tr>'}</tbody></table></div></div>` : ''}`;
  const re = () => render(root);
  $('#wa-salvar', corpo) && ($('#wa-salvar', corpo).onclick = async (ev) => {
    const d = { empresa_id: e, phone_number_id: $('#wa-pid', corpo).value.replace(/\D/g, '') || null, numero_exibicao: $('#wa-num', corpo).value.trim() || null, idioma: $('#wa-id', corpo).value.trim() || 'pt_BR',
      url_base: $('#wa-url', corpo).value.trim() || base, ativo: $('#wa-on', corpo).checked, atualizado_em: new Date().toISOString() };
    if (d.ativo && !d.phone_number_id) return toast('Informe o Phone number ID para ligar', true);
    ev.target.disabled = true;
    try { await q(sb.from('wa_config').upsert(d)); toast(d.ativo ? 'Salvo. Envio ligado.' : 'Salvo. Envio desligado: as mensagens ficam na fila por até 3 dias.'); re(); } catch (err) { fail(err); ev.target.disabled = false; }
  });
  $('#wa-teste', corpo) && ($('#wa-teste', corpo).onclick = async (ev) => {
    ev.target.disabled = true;
    try { await q(sb.rpc('wa_teste', { p_empresa: e }));
      const { data } = await sb.functions.invoke('whatsapp', { body: {} });
      toast(data?.enviados ? 'Teste enviado: confira o seu WhatsApp.' : !c.ativo ? 'O teste ficou na fila: ligue o envio quando os modelos estiverem aprovados.' : data?.sem_token ? 'Falta o segredo WHATSAPP_TOKEN no Supabase.' : 'O teste não saiu: veja o erro em Últimas mensagens.', !data?.enviados);
      setTimeout(re, 800); } catch (err) { fail(err); ev.target.disabled = false; }
  });
  $$('[data-m]', corpo).forEach(b => b.onclick = () => editar(e, Pa.find(p => p.codigo === b.dataset.m), Mo.find(m => m.codigo === b.dataset.m), ed, re));
}

function editar(e, padrao, meu, ed, depois) {
  const m0 = { ...padrao, ...(meu || {}), ativo: meu ? meu.ativo : true };
  const md = modal({ title: `Modelo — ${padrao.nome}`, wide: true, body: `<div class="wa-grid"><div>
      <label>Nome do modelo aprovado na Meta<input id="wm-t" value="${esc(m0.template)}" ${ed ? '' : 'disabled'}></label>
      <label style="margin-top:8px">Campos na ordem ({{1}}, {{2}}…), separados por vírgula<input id="wm-p" value="${esc((m0.parametros || []).join(', '))}" ${ed ? '' : 'disabled'}></label>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="wm-b" ${m0.botao_campo ? 'checked' : ''} ${ed && padrao.botao_campo ? '' : 'disabled'}> O modelo tem o botão "Acessar site" com o link da plataforma</label>
      <label class="chk"><input type="checkbox" id="wm-on" ${m0.ativo ? 'checked' : ''} ${ed && padrao.codigo !== 'teste' ? '' : 'disabled'}> Mandar esta mensagem pelo WhatsApp</label>
      <p class="small muted">Campos disponíveis: ${(padrao.parametros || []).map(x => `<code>${esc(x)}</code>`).join(' ')}</p>
      <div class="small" style="margin-top:8px"><b>Texto sugerido para cadastrar na Meta</b> <button class="btn ghost small" id="wm-cp" type="button">Copiar</button></div>
      <textarea id="wm-tx" rows="4" readonly style="width:100%">${esc(padrao.texto)}</textarea></div>
    <div><div class="small muted" style="margin-bottom:4px">Prévia (com dados de exemplo)</div><div class="wa-bal" id="wm-pv"></div></div></div>`,
    foot: `${ed && meu ? '<button class="btn ghost" id="wm-pad">Voltar ao sugerido</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Fechar</button>${ed ? '<button class="btn primary" id="wm-ok">Salvar</button>' : ''}` });
  const ps = () => $('#wm-p', md.el).value.split(',').map(s => s.trim()).filter(Boolean);
  const pv = () => { $('#wm-pv', md.el).textContent = previa(padrao.texto, ps(), EXEMPLO) + ($('#wm-b', md.el).checked ? '\n\n[ Acessar site ]' : ''); };
  $('#wm-p', md.el).oninput = pv; $('#wm-b', md.el).onchange = pv; pv();
  $('#wm-cp', md.el).onclick = () => { navigator.clipboard?.writeText(padrao.texto); toast('Texto copiado'); };
  $('#wm-ok', md.el) && ($('#wm-ok', md.el).onclick = async () => {
    const t = $('#wm-t', md.el).value.trim().toLowerCase(); if (!/^[a-z0-9_]+$/.test(t)) return toast('Nome do modelo: letras minúsculas, números e _', true);
    const p = ps(); if (p.some(x => !(padrao.parametros || []).includes(x))) return toast('Use só os campos disponíveis', true);
    try { await q(sb.from('wa_modelos').upsert({ empresa_id: e, codigo: padrao.codigo, template: t, parametros: p, botao_campo: $('#wm-b', md.el).checked ? (padrao.botao_campo || 'caminho') : null, ativo: $('#wm-on', md.el).checked, atualizado_em: new Date().toISOString() }));
      md.close(); toast('Modelo salvo'); depois(); } catch (err) { fail(err); }
  });
  $('#wm-pad', md.el) && ($('#wm-pad', md.el).onclick = async () => { try { await q(sb.from('wa_modelos').delete().eq('empresa_id', e).eq('codigo', padrao.codigo)); md.close(); toast('Voltou ao sugerido'); depois(); } catch (err) { fail(err); } });
}

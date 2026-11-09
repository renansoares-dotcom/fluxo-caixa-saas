// Painéis › Relatórios agendados (PAI010, melhoria 1.7): relatórios montados com as consultas do catálogo da Pergunte à
// plataforma, enviados por e-mail na frequência escolhida. Quem pode: administrador, diretor e financeiro (SQL 138).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { PERIODOS, FREQUENCIAS, DIAS_SEMANA, MODELOS, descreverFrequencia, parseFiltros, filtrosTexto, validar, separarEmails } from '../lib/relatorios.js';

export const title = 'Relatórios agendados';
let CAT = {};

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  let L = [], pode = false;
  try {
    [pode, CAT] = await Promise.all([q(sb.rpc('rel_pode', { p_empresa: state.empresa.id })), q(sb.rpc('ia_catalogo'))]);
    if (pode) L = await q(sb.from('rel_agendados').select('*').eq('empresa_id', state.empresa.id).order('nome'));
  } catch (err) { root.innerHTML = `<div class="card"><div class="empty">${/rel_pode|rel_agendados/.test(err.message || '') ? 'Esta tela precisa do SQL 138.' : 'Não foi possível carregar.'}</div></div>`; return; }
  if (!pode) { root.innerHTML = '<div class="card"><div class="empty">Relatórios agendados são do administrador, do diretor e do financeiro.</div></div>'; return; }
  const dt = (t) => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' }) : '–';
  root.innerHTML = `<div class="card toolbar"><div><b>Relatórios por e-mail</b><div class="small muted">Montados com as mesmas consultas da Pergunte à plataforma e enviados sozinhos na frequência escolhida. Cada relatório roda com o acesso de quem o criou ou salvou por último.</div></div>
      <span class="spacer"></span><button class="btn primary" id="rl-novo">Novo relatório</button></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Relatório</th><th>Quando</th><th>Destinatários</th><th>Próximo envio</th><th>Último envio</th></tr></thead><tbody>
    ${L.map(r => `<tr><td><b>${esc(r.nome)}</b><div class="small muted">${r.blocos.length} bloco(s)${r.ativo ? '' : ' · <span class="warn">pausado</span>'}</div>
        <div style="margin-top:6px;white-space:nowrap"><button class="btn small" data-ed="${r.id}">Editar</button> <button class="btn small ghost" data-env="${r.id}">Enviar agora</button>
        <button class="btn small ghost" data-hist="${r.id}">Histórico</button> <button class="btn small ghost" data-del="${r.id}" title="Excluir">✕</button></div></td>
      <td class="small">${esc(descreverFrequencia(r))}</td><td class="small wrap">${r.destinatarios.map(esc).join(', ')}</td>
      <td class="small">${r.ativo ? dt(r.proximo_envio) : '–'}</td>
      <td class="small wrap">${dt(r.ultimo_envio)}${r.ultimo_erro ? `<div class="neg">${esc(r.ultimo_erro)}</div>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="5" class="empty">Nenhum relatório agendado. Clique em <b>Novo relatório</b> e comece por um modelo pronto.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">O e-mail sai pelo remetente configurado em E-mail e modelos (modelo "Relatório agendado"), com as tabelas no corpo e o link de cada tela. Os horários são de Recife.</p>`;
  $('#rl-novo', root).onclick = () => escolherModelo(root);
  $$('[data-ed]', root).forEach(b => b.onclick = () => editor(L.find(r => r.id === b.dataset.ed), root));
  $$('[data-env]', root).forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const n = await q(sb.rpc('rel_enviar_agora', { p_rel: b.dataset.env })); sb.functions.invoke('email', { body: {} }).catch(() => {}); toast(n ? `Enviado para ${n} destinatário(s)` : 'Não enviado: veja o erro no último envio'); render(root); }
    catch (err) { fail(err); b.disabled = false; }
  });
  $$('[data-hist]', root).forEach(b => b.onclick = () => historico(L.find(r => r.id === b.dataset.hist)));
  $$('[data-del]', root).forEach(b => b.onclick = async () => {
    if (!(await confirmDialog('Excluir este relatório agendado? Os envios já feitos continuam no histórico de e-mails.'))) return;
    try { await q(sb.from('rel_agendados').delete().eq('id', b.dataset.del)); toast('Excluído'); render(root); } catch (err) { fail(err); }
  });
}

function escolherModelo(root) {
  const m = modal({ title: 'Novo relatório agendado', wide: true, body: `<p class="small">Escolha um modelo pronto (você ajusta tudo depois) ou comece em branco.</p>
    <div class="rl-modelos" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">
    ${MODELOS.map(x => `<button class="card" data-m="${x.id}" style="text-align:left;cursor:pointer;margin:0"><b>${esc(x.nome)}</b><div class="small muted" style="margin-top:4px">${esc(x.descricao)}</div><div class="small" style="margin-top:6px">${esc(descreverFrequencia(x))}</div></button>`).join('')}
    <button class="card" data-m="" style="text-align:left;cursor:pointer;margin:0"><b>Em branco</b><div class="small muted" style="margin-top:4px">Monte os blocos do zero.</div></button></div>`,
    foot: '<button class="btn" data-close>Cancelar</button>' });
  $$('[data-m]', m.el).forEach(b => b.onclick = () => {
    const x = MODELOS.find(y => y.id === b.dataset.m);
    m.close();
    editor(x ? { nome: x.nome, frequencia: x.frequencia, dia_semana: x.dia_semana || 1, dia_mes: x.dia_mes || 1, hora: x.hora, blocos: structuredClone(x.blocos), destinatarios: [state.user?.email].filter(Boolean), ativo: true }
      : { nome: '', frequencia: 'semanal', dia_semana: 1, dia_mes: 1, hora: 8, blocos: [{ fonte: 'notas', metrica: 'valor', agrupar: 'cliente', periodo: 'mes_anterior', filtros: {}, limite: 15 }], destinatarios: [state.user?.email].filter(Boolean), ativo: true }, root);
  });
}

function editor(r0, root) {
  const r = structuredClone(r0);
  const opt = (obj, sel, vazio) => (vazio ? `<option value="">${vazio}</option>` : '') + Object.entries(obj || {}).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(typeof t === 'string' ? t : k)}</option>`).join('');
  const bloco = (b, i) => `<div class="card" data-b="${i}" style="margin:0 0 8px;padding:10px">
    <div class="grid-form">
      <label>Título do bloco<input class="b-t" value="${esc(b.titulo || '')}" placeholder="opcional"></label>
      <label>Fonte<select class="b-f">${opt(Object.fromEntries(Object.entries(CAT).map(([k, v]) => [k, v.rotulo || k])), b.fonte)}</select></label>
      <label>Medida<select class="b-m">${opt(CAT[b.fonte]?.metricas, b.metrica)}</select></label>
      <label>Agrupar por<select class="b-a">${opt(CAT[b.fonte]?.agrupar, b.agrupar, '— total —')}</select></label>
      <label>Período<select class="b-p">${opt(PERIODOS, b.periodo || 'mes_atual')}</select></label>
      <label class="xs">Linhas<input class="b-l" type="number" min="1" max="100" value="${b.limite || 15}"></label></div>
    <label style="margin-top:6px">Filtros <span class="small muted">(nome=valor; separados por ponto e vírgula — disponíveis: ${esc(Object.keys(CAT[b.fonte]?.filtros || {}).join(', '))})</span><input class="b-x" value="${esc(filtrosTexto(b.filtros))}"></label>
    <div style="text-align:right;margin-top:4px"><button class="btn small ghost" data-rm="${i}">Remover bloco</button></div></div>`;
  const m = modal({ title: r.id ? `Editar — ${r.nome}` : 'Novo relatório agendado', wide: true, body: `<div class="form">
    <div class="grid-form">
      <label>Nome<input id="re-n" value="${esc(r.nome)}"></label>
      <label>Frequência<select id="re-f">${opt(FREQUENCIAS, r.frequencia)}</select></label>
      <label class="xs" id="re-ds-l">Dia da semana<select id="re-ds">${DIAS_SEMANA.slice(1).map((d, i) => `<option value="${i + 1}" ${r.dia_semana === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="xs" id="re-dm-l">Dia do mês<input id="re-dm" type="number" min="1" max="28" value="${r.dia_mes || 1}"></label>
      <label class="xs">Hora<input id="re-h" type="number" min="0" max="23" value="${r.hora ?? 8}"></label></div>
    <label>Destinatários (e-mails separados por vírgula)<input id="re-d" value="${esc((r.destinatarios || []).join(', '))}"></label>
    <label>Observação no e-mail (opcional)<input id="re-o" value="${esc(r.observacao || '')}" placeholder="Ex.: valores pagos até ontem"></label>
    <label class="chk"><input type="checkbox" id="re-a" ${r.ativo !== false ? 'checked' : ''}> Ativo (desmarque para pausar os envios)</label>
    <h3 style="margin:14px 0 8px">Blocos</h3><div id="re-b"></div>
    <button class="btn small" id="re-mais">+ Bloco</button>
    <div id="re-prev" style="margin-top:12px"></div></div>`,
    foot: '<button class="btn" id="re-ver">Pré-visualizar</button><span style="flex:1"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="re-ok">Salvar</button>' });
  const ler = () => {
    r.nome = $('#re-n', m.el).value.trim(); r.frequencia = $('#re-f', m.el).value; r.dia_semana = +$('#re-ds', m.el).value; r.dia_mes = +$('#re-dm', m.el).value || 1;
    r.hora = Math.min(23, Math.max(0, +$('#re-h', m.el).value || 0)); r.destinatarios = separarEmails($('#re-d', m.el).value); r.observacao = $('#re-o', m.el).value.trim() || null; r.ativo = $('#re-a', m.el).checked;
    r.blocos = $$('[data-b]', m.el).map(el => ({ titulo: $('.b-t', el).value.trim() || null, fonte: $('.b-f', el).value, metrica: $('.b-m', el).value, agrupar: $('.b-a', el).value || null,
      periodo: $('.b-p', el).value, limite: +$('.b-l', el).value || 15, filtros: parseFiltros($('.b-x', el).value) }));
  };
  const freq = () => { const f = $('#re-f', m.el).value; $('#re-ds-l', m.el).style.display = f === 'semanal' ? '' : 'none'; $('#re-dm-l', m.el).style.display = f === 'mensal' ? '' : 'none'; };
  const blocos = () => {
    $('#re-b', m.el).innerHTML = r.blocos.map(bloco).join('');
    $$('[data-b]', m.el).forEach(el => { $('.b-f', el).onchange = () => { ler(); const b = r.blocos[+el.dataset.b]; b.metrica = Object.keys(CAT[b.fonte].metricas)[0]; b.agrupar = null; b.filtros = {}; blocos(); }; });
    $$('[data-rm]', m.el).forEach(b => b.onclick = () => { ler(); r.blocos.splice(+b.dataset.rm, 1); blocos(); });
  };
  $('#re-f', m.el).onchange = freq; freq(); blocos();
  $('#re-mais', m.el).onclick = () => { ler(); if (r.blocos.length >= 10) return toast('No máximo 10 blocos', true); r.blocos.push({ fonte: 'lancamentos', metrica: 'valor', agrupar: 'classe', periodo: 'mes_atual', filtros: {}, limite: 15 }); blocos(); };
  $('#re-ver', m.el).onclick = async () => {
    ler(); const box = $('#re-prev', m.el); box.innerHTML = '<div class="loading">Montando…</div>';
    try { box.innerHTML = previaHtml(await q(sb.rpc('rel_previa', { p_empresa: state.empresa.id, p_blocos: r.blocos }))); } catch (err) { box.innerHTML = ''; fail(err); }
  };
  $('#re-ok', m.el).onclick = async (ev) => {
    ler(); const e = validar(r, CAT); if (e.length) return toast(e[0], true);
    ev.target.disabled = true;
    const row = { empresa_id: state.empresa.id, nome: r.nome, observacao: r.observacao, blocos: r.blocos, frequencia: r.frequencia, dia_semana: r.dia_semana, dia_mes: r.dia_mes, hora: r.hora, destinatarios: r.destinatarios, ativo: r.ativo };
    try { await q(r.id ? sb.from('rel_agendados').update(row).eq('id', r.id) : sb.from('rel_agendados').insert(row)); m.close(); toast('Relatório salvo'); render(root); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
}

export function previaHtml(T) {
  return (T || []).map(t => `<div class="card" style="margin:0 0 8px"><b>${esc(t.titulo)}</b> <span class="small muted">${esc(t.periodo || '')}</span>
    ${t.erro ? `<div class="neg small">${esc(t.erro)}</div>` : `<table class="small" style="margin-top:6px;width:100%"><thead><tr><th>${esc(t.colunas[0] || '')}</th><th class="num">${esc(t.colunas[1] || '')}</th></tr></thead><tbody>
      ${t.linhas.map(l => `<tr><td>${esc(l[0])}</td><td class="num">${esc(l[1])}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">sem dados no período</td></tr>'}
      ${t.total ? `<tr><td><b>Total</b></td><td class="num"><b>${esc(t.total)}</b></td></tr>` : ''}</tbody></table>`}</div>`).join('');
}

async function historico(r) {
  let L = [];
  try { L = await q(sb.from('rel_envios').select('*').eq('rel_id', r.id).order('enviado_em', { ascending: false }).limit(30)); } catch (err) { return fail(err); }
  modal({ title: `Envios — ${r.nome}`, body: `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Como</th><th class="num">Destinatários</th><th>Resultado</th></tr></thead><tbody>
    ${L.map(e => `<tr><td class="small">${new Date(e.enviado_em).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' })}</td><td class="small">${e.manual ? 'Enviar agora' : 'Agendado'}</td>
      <td class="num">${e.destinatarios}</td><td class="small ${e.erro ? 'neg' : 'pos'}">${e.erro ? esc(e.erro) : 'na fila de e-mail'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Ainda não enviado.</td></tr>'}</tbody></table></div>
    <p class="small muted">A entrega de cada e-mail aparece em E-mail e modelos › Fila.</p>`, foot: '<button class="btn" data-close>Fechar</button>' });
}

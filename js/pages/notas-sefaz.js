// CPD › NF-e da SEFAZ (FIS004, melhoria 9.1): as notas emitidas contra o CNPJ da empresa, recebidas da Distribuição DF-e
// (resumo e XML), com a manifestação do destinatário e a importação em Notas Fiscais pelo mesmo importador dos arquivos.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, money, dateBR } from '../lib/ui.js';
import { importarXmls } from './notas.js';
import { SITUACOES, MANIFESTACOES, filtrar, prazoConclusiva, podeManifestar } from '../lib/dfe.js';

export const title = 'NF-e da SEFAZ';
const ui = { filtro: 'pendentes' };

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  const e = state.empresa.id;
  let C, R, L;
  try {
    [C, R, L] = await Promise.all([
      q(sb.from('dfe_config').select('*').eq('empresa_id', e)).then(r => r[0] || null),
      q(sb.rpc('dfe_resumo', { p_empresa: e })),
      q(sb.from('dfe_documentos').select('id,chave,nsu,emitente_doc,emitente_nome,emissao,valor,situacao_nfe,situacao,manifestacao,manifestado_em,manifestacao_erro,nota_id,recebido_em').eq('empresa_id', e).order('emissao', { ascending: false }).limit(500)),
    ]);
  } catch (err) { root.innerHTML = `<div class="card"><div class="empty">${/dfe_/.test(err.message || '') ? 'Esta tela precisa do SQL 140.' : 'Não foi possível carregar.'}</div></div>`; return; }
  if (!R) { root.innerHTML = '<div class="card"><div class="empty">As NF-e da SEFAZ são do administrador, diretor, financeiro e compras.</div></div>'; return; }
  const admin = state.papel === 'admin', V = filtrar(L, ui.filtro), dt = (t) => t ? new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' }) : '–';
  root.innerHTML = `<div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">XML para importar</div><div class="k-value ${R.xml ? 'warn' : ''}">${R.xml}</div><div class="k-sub">${money(R.valor_pendente)} em notas pendentes</div></div>
      <div class="kpi"><div class="k-label">Só o resumo</div><div class="k-value">${R.resumo}</div><div class="k-sub">o XML chega depois da ciência</div></div>
      <div class="kpi"><div class="k-label">Importadas</div><div class="k-value">${R.importadas}</div><div class="k-sub">${R.ignoradas} ignorada(s)</div></div>
      <div class="kpi"><div class="k-label">Consulta à SEFAZ</div><div class="k-value" style="font-size:16px">${C?.ativo ? (C.ultimo_erro ? '<span class="neg">com erro</span>' : 'ligada') : '<span class="muted">desligada</span>'}</div>
        <div class="k-sub">última ${dt(C?.ultima_consulta)} · próxima ${C?.ativo ? dt(C?.proxima_consulta) : '–'}</div></div></div>
    ${C?.ultimo_erro ? `<div class="card" style="border-color:var(--neg);margin-bottom:12px"><b class="neg">SEFAZ:</b> ${esc(C.ultimo_erro)}</div>` : ''}
    ${C?.validade_certificado && new Date(C.validade_certificado) < new Date(Date.now() + 30 * 864e5) ? `<div class="card" style="border-color:var(--warn);margin-bottom:12px">O certificado A1 vence em ${dateBR(C.validade_certificado)}. Renove e troque na ponte da SEFAZ.</div>` : ''}
    <div class="card toolbar"><div class="chips" id="sf-f">${[['pendentes', 'Pendentes'], ['xml_disponivel', 'XML disponível'], ['resumo', 'Só resumo'], ['manifestar', 'Sem manifestação conclusiva'], ['importada', 'Importadas'], ['ignorada', 'Ignoradas'], ['todas', 'Todas']]
        .map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t} <span class="muted">${filtrar(L, k).length}</span></span>`).join('')}</div>
      <span class="spacer"></span>
      <button class="btn primary" id="sf-imp" ${R.xml ? '' : 'disabled'}>Importar os ${R.xml} XML em Notas Fiscais</button>
      <button class="btn" id="sf-cons" ${C?.ativo ? '' : 'disabled'}>Consultar agora</button>${admin ? ' <button class="btn" id="sf-par">Parâmetros</button>' : ''}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Emissão</th><th>Emitente e chave</th><th class="num">Valor</th><th>Situação</th><th>Manifestação</th><th></th></tr></thead><tbody>
    ${V.map(d => { const [rot, cls] = SITUACOES[d.situacao] || ['', '']; const pz = prazoConclusiva(d);
      return `<tr><td>${dateBR(d.emissao)}</td><td class="wrap">${esc(d.emitente_nome || '')}<div class="small muted">${esc(d.emitente_doc || '')}</div><div class="small muted" style="font-family:monospace;font-size:11px">${esc(d.chave)}</div></td><td class="num">${money(d.valor)}</td>
        <td><span class="${cls}">${rot}</span>${d.situacao_nfe !== 'autorizada' ? `<div class="small neg">NF-e ${d.situacao_nfe}</div>` : ''}</td>
        <td class="small">${d.manifestacao ? MANIFESTACOES[d.manifestacao] : '<span class="muted">—</span>'}${d.manifestacao_erro ? `<div class="neg">${esc(d.manifestacao_erro)}</div>` : ''}${pz ? `<div class="${pz.dias <= 15 ? 'warn' : 'muted'}">conclusiva até ${dateBR(pz.ate)}</div>` : ''}</td>
        <td style="white-space:nowrap">${podeManifestar(d) ? `<button class="btn small" data-man="${d.id}">Manifestar</button> ` : ''}${d.situacao === 'importada' ? `<a class="btn small ghost" href="#/notas">Ver</a>` : `<button class="btn small ghost" data-ign="${d.id}" data-v="${d.situacao === 'ignorada' ? 0 : 1}">${d.situacao === 'ignorada' ? 'Voltar' : 'Ignorar'}</button>`}</td></tr>`; }).join('')
    || '<tr><td colspan="6" class="empty">Nenhuma nota nesta situação.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">A consulta à SEFAZ roda a cada hora (a SEFAZ só deixa consultar de novo 1 hora depois de uma consulta sem documentos). A ciência da operação libera o XML completo; a manifestação conclusiva (confirmação, desconhecimento ou operação não realizada) deve ser feita em até 180 dias da emissão.</p>`;
  $('#sf-f', root).onclick = (ev) => { const f = ev.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; render(root); } };
  $('#sf-imp', root).onclick = async () => {
    try {
      const X = await q(sb.from('dfe_documentos').select('chave,xml').eq('empresa_id', e).eq('situacao', 'xml_disponivel').not('xml', 'is', null).limit(300));
      if (!X.length) return toast('Nenhum XML disponível', true);
      importarXmls(X.map(x => ({ nome: `SEFAZ ${x.chave}.xml`, xml: x.xml })), () => render(root));
    } catch (err) { fail(err); }
  };
  $('#sf-cons', root).onclick = async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Consultando…';
    try {
      const { data, error } = await sb.functions.invoke('sefaz-dfe', { body: { acao: 'consultar', empresa_id: e } });
      if (error) throw error;
      if (data?.aviso) toast(data.aviso); else { const r = data?.empresas?.[0]; toast(r?.erro ? `SEFAZ: ${r.erro}` : `${r?.novas || 0} resumo(s), ${r?.xml || 0} XML e ${r?.ciencias || 0} ciência(s)`, !!r?.erro); }
      render(root);
    } catch (err) { fail(err); ev.target.disabled = false; ev.target.textContent = 'Consultar agora'; }
  };
  $$('[data-man]', root).forEach(b => b.onclick = () => manifestar(L.find(d => d.id === b.dataset.man), root));
  $$('[data-ign]', root).forEach(b => b.onclick = async () => { try { await q(sb.rpc('dfe_ignorar', { p_doc: b.dataset.ign, p_ignorar: b.dataset.v === '1' })); render(root); } catch (err) { fail(err); } });
  $('#sf-par', root) && ($('#sf-par', root).onclick = () => parametros(C, root));
}

function manifestar(d, root) {
  const m = modal({ title: `Manifestar — ${d.emitente_nome || ''} · ${money(d.valor)}`, body: `<div class="form">
    <p class="small">Chave ${esc(d.chave)} · emitida em ${dateBR(d.emissao)}</p>
    ${Object.entries(MANIFESTACOES).filter(([k]) => k !== 'ciencia' || !d.manifestacao).map(([k, t]) => `<label class="chk"><input type="radio" name="mf" value="${k}" ${k === 'confirmacao' ? 'checked' : ''}> <b>${t}</b></label>`).join('')}
    <label id="mf-j-l" style="display:none">Justificativa (15 a 255 caracteres)<textarea id="mf-j" rows="2" maxlength="255"></textarea></label>
    <p class="small muted">Confirmação: a mercadoria foi recebida. Desconhecimento: a empresa não reconhece a nota. Operação não realizada: a nota é conhecida, mas a operação não aconteceu (devolução, recusa). A manifestação vai para a SEFAZ com o certificado da empresa e não pode ser desfeita.</p></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mf-ok">Enviar à SEFAZ</button>' });
  $$('input[name=mf]', m.el).forEach(r => r.onchange = () => { $('#mf-j-l', m.el).style.display = $('input[name=mf]:checked', m.el).value === 'nao_realizada' ? '' : 'none'; });
  $('#mf-ok', m.el).onclick = async (ev) => {
    const tipo = $('input[name=mf]:checked', m.el).value, just = $('#mf-j', m.el).value.trim();
    if (tipo === 'nao_realizada' && just.length < 15) return toast('Justificativa de 15 a 255 caracteres', true);
    ev.target.disabled = true;
    try {
      const { data, error } = await sb.functions.invoke('sefaz-dfe', { body: { acao: 'manifestar', empresa_id: state.empresa.id, documento_id: d.id, tipo, justificativa: just } });
      if (error) throw error;
      if (data?.ok) { toast('Manifestação registrada na SEFAZ'); m.close(); render(root); } else { toast(`SEFAZ: ${data?.cStat ? data.cStat + ' — ' : ''}${data?.motivo || 'falha'}`, true); ev.target.disabled = false; }
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

function parametros(C, root) {
  const c = C || { ativo: false, ambiente: 'producao', ciencia_automatica: true, avisar: true, papeis: ['admin', 'financeiro', 'compras'] };
  const papeis = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['compras', 'Compras']];
  const m = modal({ title: 'Parâmetros — NF-e da SEFAZ', body: `<div class="form">
    <label class="chk"><input type="checkbox" id="sp-on" ${c.ativo ? 'checked' : ''}> Consultar a SEFAZ a cada hora</label>
    <label>Ambiente<select id="sp-amb"><option value="producao" ${c.ambiente === 'producao' ? 'selected' : ''}>Produção</option><option value="homologacao" ${c.ambiente === 'homologacao' ? 'selected' : ''}>Homologação (testes)</option></select></label>
    <label class="chk"><input type="checkbox" id="sp-ci" ${c.ciencia_automatica ? 'checked' : ''}> Manifestar "Ciência da Operação" sozinho para liberar o XML completo</label>
    <label class="chk"><input type="checkbox" id="sp-av" ${c.avisar ? 'checked' : ''}> Avisar quando chegarem notas</label>
    <div><b class="small">Quem recebe o aviso</b><div style="display:flex;gap:14px;margin-top:4px">${papeis.map(([k, t]) => `<label class="chk"><input type="checkbox" class="sp-p" value="${k}" ${(c.papeis || []).includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
    ${C ? `<p class="small muted">Último NSU: ${C.ultimo_nsu} de ${C.max_nsu ?? '–'} · último retorno: ${esc(C.ultimo_cstat || '–')} ${esc(C.ultimo_motivo || '')}</p>` : ''}
    <p class="small muted">A consulta usa o CNPJ e a UF do cadastro da empresa e o certificado A1 instalado na ponte da SEFAZ (segredos SEFAZ_PONTE_URL e SEFAZ_PONTE_CHAVE no Supabase).</p></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="sp-ok">Salvar</button>' });
  $('#sp-ok', m.el).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      await q(sb.from('dfe_config').upsert({ empresa_id: state.empresa.id, ativo: $('#sp-on', m.el).checked, ambiente: $('#sp-amb', m.el).value, ciencia_automatica: $('#sp-ci', m.el).checked,
        avisar: $('#sp-av', m.el).checked, papeis: $$('.sp-p:checked', m.el).map(x => x.value) }));
      m.close(); toast('Parâmetros salvos'); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

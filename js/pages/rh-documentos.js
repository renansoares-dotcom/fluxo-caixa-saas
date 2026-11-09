// RH › Documentos e Portal (RHT007, melhoria 8.2): envio de holerites e outros documentos por colaborador (vários PDFs de uma vez,
// casados pelo CPF, matrícula ou nome no arquivo), ciência pelo portal, ligação colaborador × usuário e configuração do portal.
import { sb, state, q, fetchAll } from '../lib/data.js';
import { $, $$, esc, dateBR, toast, fail, modal, MESES_CURTO } from '../lib/ui.js';
import { temRH, podeRH, carregarBase, avisoMigracao, kpi } from '../lib/rh-dados.js';
import { TIPOS_DOC, casarArquivo, caminhoDoc } from '../lib/rh-docs.js';

export const title = 'Documentos e Portal';
const h = new Date();
const ui = { aba: 'docs', comp: `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`, tipo: 'todos' };

export async function render(root) {
  if (!temRH()) { root.innerHTML = '<div class="card"><div class="empty">Acesso ao RH só para administrador ou quem tem a área RH liberada.</div></div>'; return; }
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="rd-abas">${[['docs', 'Documentos'], ['portal', 'Portal e usuários']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      ${ui.aba === 'docs' ? `<label class="small">Referência <input type="month" id="rd-comp" value="${ui.comp}"></label>` : ''}<span class="spacer"></span><span id="rd-acoes"></span></div><div id="rd-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#rd-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  $('#rd-comp', root) && ($('#rd-comp', root).onchange = (e) => { if (e.target.value) { ui.comp = e.target.value; render(root); } });
  let B; try { B = await carregarBase(); } catch { $('#rd-corpo', root).innerHTML = avisoMigracao; return; }
  try { if (ui.aba === 'docs') await documentos($('#rd-corpo', root), B, root); else await portal($('#rd-corpo', root), B, root); }
  catch (err) { $('#rd-corpo', root).innerHTML = /rh_doc|rh_portal|rh_usuarios/.test(err.message || '') ? '<div class="card"><div class="empty">Esta tela precisa do SQL 145.</div></div>' : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

async function documentos(c, B, root) {
  const ini = ui.comp + '-01';
  const D = await fetchAll(() => sb.from('rh_documentos').select('*').eq('empresa_id', state.empresa.id).eq('competencia', ini).order('enviado_em', { ascending: false }));
  const V = ui.tipo === 'todos' ? D : D.filter(d => d.tipo === ui.tipo), ativos = B.colabs.filter(x => x.situacao !== 'desligado');
  const hol = new Set(D.filter(d => d.tipo === 'holerite').map(d => d.colaborador_id));
  $('#rd-acoes', root).innerHTML = podeRH() ? '<button class="btn primary" id="rd-env">Enviar documentos</button>' : '';
  c.innerHTML = `<div class="kpis">${kpi('Documentos no mês', D.length)}${kpi('Holerites', `${hol.size} de ${ativos.filter(x => ['clt', 'aprendiz'].includes(x.vinculo)).length}`, 'colaboradores CLT ativos')}
      ${kpi('Vistos no portal', D.filter(d => d.visto_em).length, `${D.filter(d => !d.visto_em && d.publicado).length} ainda não abertos`)}</div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><div class="chips" id="rd-t">${[['todos', 'Todos'], ...Object.entries(TIPOS_DOC)].map(([k, t]) => `<span class="chip ${ui.tipo === k ? 'on' : ''}" data-t="${k}">${t}</span>`).join('')}</div></div>
    <div class="table-wrap"><table><thead><tr><th>Colaborador</th><th>Documento</th><th>Tipo</th><th>Enviado</th><th>No portal</th><th></th></tr></thead><tbody>
    ${V.map(d => `<tr><td>${esc(B.colabById[d.colaborador_id]?.nome || '?')}</td><td>${esc(d.titulo)}</td><td class="small">${TIPOS_DOC[d.tipo]}</td><td class="small">${dateBR(d.enviado_em)}</td>
      <td class="small">${!d.publicado ? '<span class="muted">oculto</span>' : d.visto_em ? `<span class="pos">visto ${dateBR(d.visto_em)}</span>` : '<span class="muted">não aberto</span>'}</td>
      <td style="white-space:nowrap"><button class="btn small" data-ab="${d.id}">Abrir</button>${podeRH() ? ` <button class="btn small ghost" data-pub="${d.id}">${d.publicado ? 'Ocultar' : 'Publicar'}</button> <button class="btn small ghost" data-del="${d.id}">Excluir</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nenhum documento nesta referência.</td></tr>'}</tbody></table></div></div>`;
  $('#rd-t', c).onclick = (e) => { const t = e.target.closest('[data-t]')?.dataset.t; if (t) { ui.tipo = t; documentos(c, B, root); } };
  $$('[data-ab]', c).forEach(b => b.onclick = async () => { const d = D.find(x => x.id === b.dataset.ab); try { const { data, error } = await sb.storage.from('rh-docs').createSignedUrl(d.path, 120); if (error) throw error; window.open(data.signedUrl, '_blank', 'noopener'); } catch (err) { fail(err); } });
  $$('[data-pub]', c).forEach(b => b.onclick = async () => { const d = D.find(x => x.id === b.dataset.pub); try { await q(sb.from('rh_documentos').update({ publicado: !d.publicado }).eq('id', d.id)); documentos(c, B, root); } catch (err) { fail(err); } });
  $$('[data-del]', c).forEach(b => b.onclick = async () => {
    const d = D.find(x => x.id === b.dataset.del); if (!confirm(`Excluir ${d.titulo}?`)) return;
    try { await sb.storage.from('rh-docs').remove([d.path]); await q(sb.from('rh_documentos').delete().eq('id', d.id)); toast('Documento excluído'); documentos(c, B, root); } catch (err) { fail(err); }
  });
  $('#rd-env', root) && ($('#rd-env', root).onclick = () => enviar(B, c, root));
}

function enviar(B, c, root) {
  const ativos = B.colabs.filter(x => x.situacao !== 'desligado').sort((a, b) => a.nome.localeCompare(b.nome));
  const [a, m] = ui.comp.split('-');
  const md = modal({ wide: true, title: 'Enviar documentos', body: `<div class="grid2">
      <label>Tipo<select id="ev-t">${Object.entries(TIPOS_DOC).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Referência<input type="month" id="ev-c" value="${ui.comp}"></label>
      <label>Título (o nome da pessoa não precisa)<input id="ev-ti" value="Holerite ${MESES_CURTO[+m - 1]}/${a}"></label>
      <label class="chk"><input type="checkbox" id="ev-pub" checked> Publicar no portal agora</label></div>
    <label>Arquivos PDF ou imagem (vários de uma vez)<input type="file" id="ev-f" multiple accept=".pdf,.png,.jpg,.jpeg"></label>
    <div id="ev-l" style="margin-top:8px"></div>
    <p class="small muted">Cada arquivo é ligado ao colaborador pelo CPF, pela matrícula ou pelo nome no nome do arquivo; confira e ajuste antes de enviar. O arquivo fica no espaço privado do RH e só a própria pessoa o vê no portal.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ev-ok" disabled>Enviar</button>' });
  let arqs = [];
  $('#ev-t', md.el).onchange = () => { const t = $('#ev-t', md.el).value, [aa, mm] = $('#ev-c', md.el).value.split('-'); $('#ev-ti', md.el).value = `${TIPOS_DOC[t]} ${MESES_CURTO[+mm - 1]}/${aa}`; };
  $('#ev-f', md.el).onchange = (e) => {
    arqs = [...e.target.files].map(f => ({ f, m: casarArquivo(f.name, ativos) }));
    $('#ev-l', md.el).innerHTML = `<table class="small"><thead><tr><th>Arquivo</th><th>Colaborador</th><th></th></tr></thead><tbody>${arqs.map((x, i) => `<tr><td>${esc(x.f.name)}</td>
      <td><select class="ev-co" data-i="${i}"><option value="">— escolha —</option>${ativos.map(co => `<option value="${co.id}" ${x.m?.colab.id === co.id ? 'selected' : ''}>${esc(co.nome)}${co.matricula ? ' (' + esc(co.matricula) + ')' : ''}</option>`).join('')}</select></td>
      <td class="muted">${x.m ? 'pelo ' + { cpf: 'CPF', matricula: 'número da matrícula', nome: 'nome' }[x.m.por] : '<span class="warn">não achei</span>'}</td></tr>`).join('')}</tbody></table>`;
    $('#ev-ok', md.el).disabled = !arqs.length;
  };
  $('#ev-ok', md.el).onclick = async (ev) => {
    const tipo = $('#ev-t', md.el).value, comp = $('#ev-c', md.el).value + '-01', titulo = $('#ev-ti', md.el).value.trim() || TIPOS_DOC[tipo];
    const sel = $$('.ev-co', md.el).map(s => s.value);
    if (sel.some(v => !v)) return toast('Escolha o colaborador de todos os arquivos', true);
    ev.target.disabled = true; let n = 0;
    try {
      for (let i = 0; i < arqs.length; i++) {
        const path = caminhoDoc(state.empresa.id, sel[i], tipo, comp, arqs[i].f.name);
        const { error } = await sb.storage.from('rh-docs').upload(path, arqs[i].f, { contentType: arqs[i].f.type || 'application/pdf' }); if (error) throw error;
        await q(sb.from('rh_documentos').insert({ empresa_id: state.empresa.id, colaborador_id: sel[i], tipo, competencia: comp, titulo, path, tamanho: arqs[i].f.size, publicado: $('#ev-pub', md.el).checked }));
        n++; ev.target.textContent = `Enviando ${n}/${arqs.length}…`;
      }
      toast(`${n} documento(s) enviado(s)`); md.close(); ui.comp = comp.slice(0, 7); render(root);
    } catch (err) { fail(err); toast(`${n} enviado(s) antes do erro`, true); ev.target.disabled = false; }
  };
}

async function portal(c, B, root) {
  const [cfgL, U] = await Promise.all([q(sb.from('rh_portal_config').select('*').eq('empresa_id', state.empresa.id)), q(sb.rpc('rh_usuarios_portal', { p_empresa: state.empresa.id }))]);
  const cfg = cfgL[0] || { ativo: true, mostrar_ferias: true, mostrar_sst: true, mensagem: '', sst_avisar: true, sst_avisar_colaborador: true };
  const ativos = B.colabs.filter(x => x.situacao !== 'desligado').sort((a, b) => a.nome.localeCompare(b.nome)), ligados = ativos.filter(x => x.user_id);
  c.innerHTML = `<div class="kpis">${kpi('Usuários com perfil colaborador', U.length)}${kpi('Ligados ao cadastro', ligados.length, `${U.filter(u => !u.colaborador_id).length} usuário(s) sem ligação`)}</div>
    <div class="grid2" style="margin-top:12px;align-items:start">
      <div class="card"><h2 style="margin-top:0">Portal do colaborador</h2>
        <label class="chk"><input type="checkbox" id="pc-at" ${cfg.ativo ? 'checked' : ''} ${podeRH() ? '' : 'disabled'}> Portal ligado</label>
        <label class="chk"><input type="checkbox" id="pc-fe" ${cfg.mostrar_ferias ? 'checked' : ''} ${podeRH() ? '' : 'disabled'}> Mostrar as férias</label>
        <label class="chk"><input type="checkbox" id="pc-ss" ${cfg.mostrar_sst ? 'checked' : ''} ${podeRH() ? '' : 'disabled'}> Mostrar exames e treinamentos</label>
        <label class="chk"><input type="checkbox" id="pc-av" ${cfg.sst_avisar ? 'checked' : ''} ${podeRH() ? '' : 'disabled'}> Avisar o RH dos vencimentos (dias úteis, de manhã)</label>
        <label class="chk"><input type="checkbox" id="pc-avc" ${cfg.sst_avisar_colaborador ? 'checked' : ''} ${podeRH() ? '' : 'disabled'}> Avisar também a pessoa (quem tem usuário)</label>
        <label>Mensagem no topo do portal<textarea id="pc-msg" rows="2" ${podeRH() ? '' : 'disabled'}>${esc(cfg.mensagem || '')}</textarea></label>
        ${podeRH() ? '<button class="btn primary" id="pc-ok">Salvar</button>' : ''}
        <p class="small muted">Para dar acesso: convide a pessoa em Configurações › Usuários com o perfil <b>colaborador</b> e ligue o usuário ao cadastro aqui ao lado. O colaborador entra só no Meu Portal.</p></div>
      <div class="card flush"><div class="card-head" style="padding:12px 12px 0"><h2 style="margin:0">Usuários do portal</h2></div><div class="table-wrap"><table><thead><tr><th>Usuário</th><th>Colaborador</th></tr></thead><tbody>
      ${U.map(u => `<tr><td class="small">${esc(u.email)}</td><td>${podeRH() ? `<select class="pu" data-u="${u.user_id}"><option value="">— não ligado —</option>${ativos.map(x => `<option value="${x.id}" ${x.id === u.colaborador_id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>` : esc(B.colabById[u.colaborador_id]?.nome || '—')}</td></tr>`).join('')
        || '<tr><td colspan="2" class="empty">Nenhum usuário com o perfil colaborador.</td></tr>'}</tbody></table></div></div></div>`;
  $('#pc-ok', c) && ($('#pc-ok', c).onclick = async () => {
    try { await q(sb.from('rh_portal_config').upsert({ empresa_id: state.empresa.id, ativo: $('#pc-at', c).checked, mostrar_ferias: $('#pc-fe', c).checked, mostrar_sst: $('#pc-ss', c).checked, sst_avisar: $('#pc-av', c).checked,
      sst_avisar_colaborador: $('#pc-avc', c).checked, mensagem: $('#pc-msg', c).value.trim() || null, atualizado_em: new Date().toISOString() })); toast('Portal salvo'); } catch (err) { fail(err); }
  });
  $$('.pu', c).forEach(s => s.onchange = async () => {
    const u = s.dataset.u, novo = s.value, antigo = U.find(x => x.user_id === u)?.colaborador_id;
    try {
      if (antigo) await q(sb.from('rh_colaboradores').update({ user_id: null }).eq('id', antigo));
      if (novo) await q(sb.from('rh_colaboradores').update({ user_id: u }).eq('id', novo));
      toast(novo ? 'Usuário ligado ao colaborador' : 'Ligação removida'); portal(c, B, root);
    } catch (err) { fail(err); portal(c, B, root); }
  });
}

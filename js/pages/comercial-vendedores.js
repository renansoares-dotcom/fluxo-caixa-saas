// Comercial › Representantes e metas: liga cada representante do cadastro a um usuário (perfil Vendas) e define as metas mensais.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money0, fail, toast, modal, MESES_CURTO } from '../lib/ui.js';
import { baseComercial, limparBaseComercial, podeConfigCom } from '../lib/comercial.js';
import { inp, num } from '../lib/compras.js';

export const title = 'Representantes e metas';
const ui = { ano: new Date().getFullYear() };

export async function render(root) {
  if (!podeConfigCom()) { root.innerHTML = '<div class="card"><p>Só admin ou diretor configura representantes e metas.</p></div>'; return; }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Representantes e metas</h2><div class="muted small">O representante do cliente vem do cadastro de beneficiários (campo Representante). Ligue-o ao usuário com perfil Vendas para ele ver a própria carteira.</div></div>
      <button class="btn primary" id="rv-novo">Novo representante</button></div><div id="rv-corpo"><div class="loading">Carregando…</div></div>`;
  $('#rv-novo', root).onclick = () => editar(null, root);
  await pintar(root);
}

let B = null, MEMB = [];
async function pintar(root) {
  const corpo = $('#rv-corpo', root);
  let metas = [];
  try {
    limparBaseComercial();
    [B, MEMB, metas] = await Promise.all([baseComercial(true), q(sb.rpc('listar_membros', { p_empresa: state.empresa.id })),
      q(sb.from('comercial_metas').select('*').eq('empresa_id', state.empresa.id).eq('ano', ui.ano))]);
  } catch (err) { fail(err); corpo.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const reps = [...new Map(B.clientes.filter(c => c.representante_id).map(c => [c.representante_id, c.representante])).entries()];
  const semVinc = reps.filter(([id]) => !B.vendedores.some(v => v.representante_id === id));
  const email = Object.fromEntries(MEMB.map(m => [m.user_id, `${m.email} (${m.papel})`]));
  const nCli = (rid) => B.clientes.filter(c => c.representante_id === rid).length;
  const linhasMeta = [{ id: '', nome: 'Empresa (total)' }, ...B.vendedores.filter(v => v.ativo)];
  const val = (vid, m) => metas.find(x => (x.vendedor_id || '') === vid && x.mes === m)?.valor;
  corpo.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Representante</th><th>No cadastro</th><th class="num">Clientes</th><th>Usuário</th><th>Situação</th></tr></thead><tbody>
    ${B.vendedores.map(v => `<tr class="clickable" data-id="${v.id}"><td>${esc(v.nome)}</td><td>${esc(reps.find(r => r[0] === v.representante_id)?.[1] || '— não ligado')}</td><td class="num">${v.representante_id ? nCli(v.representante_id) : ''}</td>
      <td>${esc(email[v.user_id] || (v.user_id ? 'usuário' : '— sem acesso'))}</td><td>${v.ativo ? '' : '<span class="badge">inativo</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum representante configurado.</td></tr>'}</tbody></table></div></div>
    ${semVinc.length ? `<p class="small">Representantes do cadastro ainda não configurados: ${semVinc.map(([id, n]) => `<a href="#" data-add="${id}">${esc(n)} (${nCli(id)} clientes)</a>`).join(' · ')}</p>` : ''}
    <div class="card" style="margin-top:16px"><div class="card-head"><h2 style="margin:0">Metas de faturamento</h2><label>Ano<input id="rv-ano" type="number" value="${ui.ano}" style="width:90px"></label></div>
      <p class="small muted" style="margin-top:0">Se a meta da empresa ficar em branco, o painel usa a soma das metas dos representantes.</p>
      <div class="table-wrap"><table id="rv-metas"><thead><tr><th>Meta</th>${MESES_CURTO.map(m => `<th class="num">${m}</th>`).join('')}<th class="num">Ano</th></tr></thead><tbody>
      ${linhasMeta.map(v => `<tr data-v="${v.id}"><td>${esc(v.nome)}</td>${MESES_CURTO.map((_, i) => `<td><input class="rv-m" data-m="${i + 1}" value="${inp(val(v.id, i + 1))}" style="width:86px"></td>`).join('')}<td class="num rv-t"></td></tr>`).join('')}</tbody></table></div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn primary" id="rv-salvar">Salvar metas de ${ui.ano}</button></div></div>`;
  const tot = () => $$('#rv-metas tbody tr', corpo).forEach(tr => { $('.rv-t', tr).textContent = money0($$('.rv-m', tr).reduce((t, i) => t + num(i.value), 0)); });
  corpo.addEventListener('input', tot); tot();
  $('#rv-ano', corpo).onchange = (e) => { ui.ano = +e.target.value || ui.ano; pintar(root); };
  $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => editar(B.vendedores.find(v => v.id === tr.dataset.id), root));
  $$('[data-add]', corpo).forEach(a => a.onclick = (e) => { e.preventDefault(); editar({ representante_id: a.dataset.add, nome: reps.find(r => r[0] === a.dataset.add)[1], ativo: true }, root); });
  $('#rv-salvar', corpo).onclick = async (ev) => {
    const rows = $$('#rv-metas tbody tr', corpo).flatMap(tr => $$('.rv-m', tr).filter(i => i.value.trim()).map(i => ({ empresa_id: state.empresa.id, vendedor_id: tr.dataset.v || null, ano: ui.ano, mes: +i.dataset.m, valor: num(i.value) })));
    ev.target.disabled = true;
    try { await q(sb.from('comercial_metas').delete().eq('empresa_id', state.empresa.id).eq('ano', ui.ano)); if (rows.length) await q(sb.from('comercial_metas').insert(rows)); toast('Metas salvas'); }
    catch (err) { fail(err); } finally { ev.target.disabled = false; }
  };
}

function editar(v, root) {
  const reps = [...new Map(B.clientes.filter(c => c.representante_id).map(c => [c.representante_id, c.representante])).entries()];
  const vendas = MEMB.filter(m => m.papel === 'vendas' || m.user_id === v?.user_id);
  const m = modal({ title: v?.id ? `Representante — ${v.nome}` : 'Novo representante', body: `
    <label>Nome *<input id="rv-n" value="${esc(v?.nome || '')}"></label>
    <label style="margin-top:8px">Representante no cadastro (define a carteira)<select id="rv-r"><option value="">—</option>${reps.map(([id, n]) => `<option value="${id}" ${v?.representante_id === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label style="margin-top:8px">Usuário com perfil Vendas<select id="rv-u"><option value="">— sem acesso à plataforma</option>${vendas.map(x => `<option value="${x.user_id}" ${v?.user_id === x.user_id ? 'selected' : ''}>${esc(x.email)}</option>`).join('')}</select></label>
    <p class="small muted">O usuário entra por convite em Empresa e Usuários, com o perfil "Vendas".</p>
    <label class="chk"><input type="checkbox" id="rv-a" ${v?.ativo !== false ? 'checked' : ''}> Ativo</label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rv-ok">Salvar</button>` });
  $('#rv-ok', m.el).onclick = async (ev) => {
    const row = { nome: $('#rv-n', m.el).value.trim(), representante_id: $('#rv-r', m.el).value || null, user_id: $('#rv-u', m.el).value || null, ativo: $('#rv-a', m.el).checked,
      email: MEMB.find(x => x.user_id === $('#rv-u', m.el).value)?.email || null };
    if (!row.nome) return toast('Informe o nome', true);
    ev.target.disabled = true;
    try { if (v?.id) await q(sb.from('comercial_vendedores').update(row).eq('id', v.id)); else await q(sb.from('comercial_vendedores').insert({ ...row, empresa_id: state.empresa.id }));
      m.close(); toast('Representante salvo'); pintar(root); } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// Empresa e Usuários (melhoria 10.2): perfis de acesso por tela, cópia de permissões e as formas de entrar (Google/Microsoft).
import { sb, state, q } from './data.js';
import { $, $$, esc, toast, fail, modal } from './ui.js';
import { codigoDa } from './telas.js';

/** telas do menu agrupadas pela área (lidas do próprio menu, para acompanhar telas novas) */
export function telasDoMenu() {
  return $$('#nav .nav-area').map(ar => ({ area: (ar.querySelector('.nav-area-tit')?.dataset.nome || ar.querySelector('.nav-area-tit')?.textContent || ar.dataset.area || '').trim(),
    telas: [...ar.querySelectorAll('a[data-route]')].map(a => ({ rota: a.dataset.route, nome: (a.dataset.nome || [...a.childNodes].find(n => n.nodeType === 3 && n.textContent.trim())?.textContent || a.querySelector('.nav-txt')?.textContent || a.textContent).trim(), codigo: codigoDa(a.dataset.route) }))
      .filter((t, i, L) => L.findIndex(x => x.rota === t.rota) === i) })).filter(g => g.telas.length);
}

export async function secaoPerfis(el, aoMudar) {
  let P; try { P = await q(sb.from('acesso_perfis').select('*').eq('empresa_id', state.empresa.id).order('nome')); }
  catch (err) { el.innerHTML = /acesso_perfis/.test(err.message || '') ? '<p class="small muted">Perfis por tela precisam do SQL 148.</p>' : ''; return []; }
  el.innerHTML = `<div class="card-head" style="padding:0"><h2 style="margin:0">Perfis de acesso por tela</h2><button class="btn" id="pf-novo">Novo perfil</button></div>
    <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Perfil</th><th class="num">Telas</th><th>Descrição</th></tr></thead><tbody>
    ${P.map(p => `<tr class="clickable" data-p="${p.id}"><td><b>${esc(p.nome)}</b></td><td class="num">${p.telas.length}</td><td class="small">${esc(p.descricao || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhum perfil.</td></tr>'}</tbody></table></div>
    <p class="small muted">O perfil limita as telas que a pessoa vê no menu e consegue abrir, além das áreas. Vale para os papéis financeiro, diretor e leitura. O que ela pode <b>alterar</b> continua pelo papel. Tutoriais, avisos, conversas e o Meu Portal ficam sempre liberados.</p>`;
  $('#pf-novo', el).onclick = () => editarPerfil(null, () => { secaoPerfis(el, aoMudar); aoMudar?.(); });
  el.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr[data-p]')?.dataset.p; if (id) editarPerfil(P.find(p => p.id === id), () => { secaoPerfis(el, aoMudar); aoMudar?.(); }); };
  return P;
}

function editarPerfil(p, depois) {
  const G = telasDoMenu(), tem = new Set(p?.telas || []);
  const md = modal({ wide: true, title: p ? `Perfil — ${p.nome}` : 'Novo perfil de acesso', body: `<div class="grid2"><label>Nome<input id="pe-n" value="${esc(p?.nome || '')}" placeholder="ex.: Contas a pagar"></label>
      <label>Descrição<input id="pe-d" value="${esc(p?.descricao || '')}"></label></div>
    <div class="small muted" style="margin:8px 0">Marque as telas que este perfil enxerga. <a href="#" id="pe-nada">Desmarcar tudo</a></div>
    <div class="perfil-telas" style="columns:3 260px;column-gap:20px">${G.map((g, i) => `<div style="break-inside:avoid;margin-bottom:12px"><label class="chk"><input type="checkbox" class="pe-area" data-g="${i}"> <b>${esc(g.area)}</b></label>
      ${g.telas.map(t => `<label class="chk small" style="margin-left:18px"><input type="checkbox" class="pe-t" data-g="${i}" value="${esc(t.rota)}" ${tem.has(t.rota) ? 'checked' : ''}> ${esc(t.nome)} ${t.codigo ? `<span class="muted">${t.codigo}</span>` : ''}</label>`).join('')}</div>`).join('')}</div>`,
    foot: `${p ? '<button class="btn danger" id="pe-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="pe-ok">Salvar</button>` });
  const marcaArea = () => $$('.pe-area', md.el).forEach(a => { const xs = $$(`.pe-t[data-g="${a.dataset.g}"]`, md.el); a.checked = xs.every(x => x.checked); a.indeterminate = !a.checked && xs.some(x => x.checked); });
  marcaArea();
  md.el.addEventListener('change', (e) => { if (e.target.matches('.pe-area')) $$(`.pe-t[data-g="${e.target.dataset.g}"]`, md.el).forEach(x => { x.checked = e.target.checked; }); marcaArea(); });
  $('#pe-nada', md.el).onclick = (e) => { e.preventDefault(); $$('.pe-t', md.el).forEach(x => { x.checked = false; }); marcaArea(); };
  $('#pe-ok', md.el).onclick = async () => {
    const r = { empresa_id: state.empresa.id, nome: $('#pe-n', md.el).value.trim(), descricao: $('#pe-d', md.el).value.trim() || null, telas: $$('.pe-t:checked', md.el).map(x => x.value), atualizado_em: new Date().toISOString() };
    if (!r.nome) return toast('Informe o nome', true);
    if (!r.telas.length) return toast('Marque ao menos uma tela', true);
    try { await q(p ? sb.from('acesso_perfis').update(r).eq('id', p.id) : sb.from('acesso_perfis').insert(r)); toast('Perfil salvo — vale no próximo acesso de quem o usa'); md.close(); depois(); } catch (err) { fail(err); }
  };
  $('#pe-del', md.el) && ($('#pe-del', md.el).onclick = async () => { if (!confirm('Excluir o perfil? Quem o usa volta a ver todas as telas das suas áreas.')) return; try { await q(sb.from('acesso_perfis').delete().eq('id', p.id)); md.close(); depois(); } catch (err) { fail(err); } });
}

export async function secaoLogin(el) {
  let c; try { const { data, error } = await sb.from('plataforma_login').select('*').eq('id', 1).maybeSingle(); if (error) throw error; c = data; } catch { el.innerHTML = ''; return; }
  if (!c) { el.innerHTML = ''; return; }
  el.innerHTML = `<h2 style="margin-top:0">Formas de entrar</h2><div class="form">
    <label class="chk"><input type="checkbox" id="lg-s" ${c.senha ? 'checked' : ''}> E-mail e senha</label>
    <label class="chk"><input type="checkbox" id="lg-g" ${c.google ? 'checked' : ''}> Entrar com Google</label>
    <label class="chk"><input type="checkbox" id="lg-m" ${c.microsoft ? 'checked' : ''}> Entrar com Microsoft (Office 365)</label>
    <label>Aviso na tela de login<input id="lg-a" value="${esc(c.aviso || '')}" placeholder="ex.: use o seu e-mail da empresa"></label>
    <div><button class="btn primary" id="lg-ok" style="margin-top:8px">Salvar</button></div></div>
    <p class="small muted">Vale para toda a plataforma (todas as empresas). Google e Microsoft só funcionam depois de ativados no servidor (Supabase › Authentication › Providers, com o cadastro do aplicativo no Google Cloud e no Azure).
      A pessoa entra com o mesmo e-mail do convite: o acesso e o papel continuam vindo do convite e desta tela. Sem e-mail e senha, a tela de login mostra um link discreto para entrar com senha.</p>`;
  $('#lg-ok', el).onclick = async () => {
    const v = { senha: $('#lg-s', el).checked, google: $('#lg-g', el).checked, microsoft: $('#lg-m', el).checked, aviso: $('#lg-a', el).value.trim() || null, atualizado_por: state.user.id, atualizado_em: new Date().toISOString() };
    if (!v.senha && !v.google && !v.microsoft) return toast('Deixe ao menos uma forma de entrar', true);
    try { const { data, error } = await sb.from('plataforma_login').update(v).eq('id', 1).select('id'); if (error) throw error; if (!data?.length) throw new Error('Só administradores alteram'); toast('Formas de entrar salvas'); } catch (err) { fail(err); }
  };
}

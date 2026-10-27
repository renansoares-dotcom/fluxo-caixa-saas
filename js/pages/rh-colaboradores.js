// RH › Colaboradores: cadastro (cargo, setor, vínculo, admissão, salário), importação da relação em planilha e setor por cargo.
// Salário é sigiloso: a tela e o banco só abrem para administrador ou quem tem a área RH (SQL 052).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, toast, fail, modal, confirmDialog, exportXLSX, logoPNG } from '../lib/ui.js';
import { VINCULOS, SITUACOES, setorDoCargo, chaveNome } from '../lib/rh.js';
import { temRH, podeRH, carregarBase, avisoMigracao, kpi } from '../lib/rh-dados.js';
import { inp, num } from '../lib/compras.js';

export const title = 'RH — colaboradores';
const ui = { busca: '', sit: 'ativos', setor: '', vinc: '' };
const soDig = (s) => String(s || '').replace(/\D/g, '');
const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s) => chaveNome(s).toLowerCase();

export async function render(root) {
  if (!temRH()) { root.innerHTML = '<div class="card"><div class="empty">Acesso ao RH só para administrador ou quem tem a área RH liberada (Empresa e usuários).</div></div>'; return; }
  let B; try { B = await carregarBase(); } catch (err) { console.error(err); root.innerHTML = avisoMigracao; return; }
  const C = B.colabs;
  const ativos = C.filter(c => c.situacao !== 'desligado');
  const naFolha = ativos.filter(c => !['extra_folha', 'pro_labore'].includes(c.vinculo));
  const base = naFolha.reduce((s, c) => s + (+c.salario || 0), 0);
  const setores = [...new Set(C.map(c => c.setor).filter(Boolean))].sort();
  const semSetor = ativos.filter(c => !c.setor).length;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Colaboradores</h2><div class="muted small">Dados sigilosos — visíveis só para quem tem acesso ao RH.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${podeRH() ? '<button class="btn" id="rc-imp">Importar relação (planilha)</button><button class="btn" id="rc-setor">Setor por cargo</button><button class="btn primary" id="rc-novo">Incluir</button>' : ''}<button class="btn" id="rc-rel" title="Relatório para imprimir ou salvar em PDF, com os filtros aplicados">Relatório (imprimir)</button><button class="btn ghost" id="rc-xls">Exportar</button></div></div>
    <div class="kpis">${kpi('Ativos', ativos.length, `${naFolha.length} na folha`)}${kpi('Salário base da folha', money(base), naFolha.length ? `média ${money(base / naFolha.length)}` : '')}
      ${kpi('Sem setor', semSetor, semSetor ? 'use "Setor por cargo"' : 'todos com setor', semSetor ? 'warn' : '')}${kpi('Sem admissão', ativos.filter(c => !c.admissao).length, 'necessária para férias e 13º proporcional')}
      ${kpi('Desligados', C.length - ativos.length)}</div>
    <div class="card toolbar" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input id="rc-busca" placeholder="Buscar nome, cargo, matrícula…" value="${esc(ui.busca)}" style="min-width:240px">
      <div class="chips" id="rc-sit">${[['ativos', 'Ativos'], ['desligados', 'Desligados'], ['todos', 'Todos']].map(([k, t]) => `<span class="chip ${ui.sit === k ? 'on' : ''}" data-s="${k}">${t}</span>`).join('')}</div>
      <select id="rc-fs" data-nobusca><option value="">Todos os setores</option><option value="-" ${ui.setor === '-' ? 'selected' : ''}>(sem setor)</option>${setores.map(s => `<option ${ui.setor === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="rc-fv" data-nobusca><option value="">Todos os vínculos</option>${Object.entries(VINCULOS).map(([k, t]) => `<option value="${k}" ${ui.vinc === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <span class="muted small" id="rc-n"></span></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" id="rc-tab"></div></div>`;
  const filtrados = () => { const t = norm(ui.busca);
    return C.filter(c => (ui.sit === 'todos' || (ui.sit === 'ativos') === (c.situacao !== 'desligado'))
      && (!ui.setor || (ui.setor === '-' ? !c.setor : c.setor === ui.setor)) && (!ui.vinc || c.vinculo === ui.vinc)
      && (!t || t.split(' ').every(p => norm(`${c.nome} ${c.cargo} ${c.matricula} ${c.setor}`).includes(p)))); };
  const tabela = () => {
    const xs = filtrados();
    $('#rc-n', root).textContent = `${xs.length} pessoa(s) · ${money(xs.reduce((s, c) => s + (+c.salario || 0), 0))}`;
    $('#rc-tab', root).innerHTML = `<table><thead><tr><th>Nome</th><th>Matrícula</th><th>Cargo</th><th>Setor</th><th>Vínculo</th><th>Admissão</th><th class="num">Salário</th><th>Situação</th></tr></thead><tbody>
      ${xs.map(c => `<tr class="clickable" data-id="${c.id}"><td><b>${esc(c.nome)}</b></td><td>${esc(c.matricula || '')}</td><td>${esc(c.cargo || '')}</td><td>${esc(c.setor || '') || '<span class="muted">—</span>'}</td>
        <td>${VINCULOS[c.vinculo] || c.vinculo}</td><td>${dateBR(c.admissao)}</td><td class="num">${money(c.salario)}</td><td>${c.situacao === 'ativo' ? 'Ativo' : `<span class="muted">${SITUACOES[c.situacao]}${c.demissao ? ' ' + dateBR(c.demissao) : ''}</span>`}</td></tr>`).join('')
        || `<tr><td colspan="8" class="empty">${C.length ? 'Ninguém com esse filtro.' : 'Nenhum colaborador. Use "Importar relação (planilha)" com a lista de funcionários.'}</td></tr>`}</tbody></table>`;
    $$('tr[data-id]', root).forEach(tr => tr.onclick = () => editar(C.find(c => c.id === tr.dataset.id), B, root));
  };
  tabela();
  $('#rc-busca', root).oninput = (e) => { ui.busca = e.target.value; tabela(); };
  $('#rc-sit', root).onclick = (e) => { const s = e.target.closest('[data-s]')?.dataset.s; if (s) { ui.sit = s; $$('#rc-sit .chip', root).forEach(x => x.classList.toggle('on', x.dataset.s === s)); tabela(); } };
  $('#rc-fs', root).onchange = (e) => { ui.setor = e.target.value; tabela(); };
  $('#rc-fv', root).onchange = (e) => { ui.vinc = e.target.value; tabela(); };
  $('#rc-xls', root).onclick = () => exportXLSX($('#rc-tab table', root), 'colaboradores');
  $('#rc-rel', root).onclick = () => opcoesRelatorio(filtrados());
  $('#rc-novo', root) && ($('#rc-novo', root).onclick = () => editar(null, B, root));
  $('#rc-imp', root) && ($('#rc-imp', root).onclick = () => importar(B, root));
  $('#rc-setor', root) && ($('#rc-setor', root).onclick = () => setorPorCargo(B, root));
}

async function editar(c, B, root) {
  const pode = podeRH(), dis = pode ? '' : 'disabled';
  const f = (id, lab, val, extra = '') => `<label>${lab}<input id="${id}" value="${val ?? ''}" ${extra} ${dis}></label>`;
  const sel = (id, lab, obj, v) => `<label>${lab}<select id="${id}" data-nobusca ${dis}>${Object.entries(obj).map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const md = modal({ title: c ? c.nome : 'Incluir colaborador', wide: true, body: `<div class="grid-form">
      ${f('fc-n', 'Nome', esc(c?.nome || ''), 'class="span2"')}${f('fc-m', 'Matrícula', esc(c?.matricula || ''))}${f('fc-cpf', 'CPF', esc(c?.cpf || ''))}
      ${f('fc-c', 'Cargo', esc(c?.cargo || ''))}${f('fc-s', 'Setor', esc(c?.setor || ''), 'list="fc-setores"')}
      <datalist id="fc-setores">${[...new Set(B.colabs.map(x => x.setor).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>
      <label>Centro de custo<select id="fc-cc" data-nobusca ${dis}><option value="">—</option>${state.cad.cc.map(x => `<option value="${x.id}" ${x.id === c?.centro_custo_id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      ${sel('fc-v', 'Vínculo', VINCULOS, c?.vinculo || 'clt')}${sel('fc-st', 'Situação', SITUACOES, c?.situacao || 'ativo')}
      ${f('fc-a', 'Admissão', c?.admissao || '', 'type="date"')}${f('fc-d', 'Desligamento', c?.demissao || '', 'type="date"')}
      ${f('fc-sal', 'Salário base (R$)', inp(c?.salario))}${f('fc-pix', 'PIX / conta para pagamento', esc(c?.pix || ''))}
      ${f('fc-o', 'Observação', esc(c?.observacao || ''), 'class="span2"')}</div>
      ${c ? '<h3 style="margin:16px 0 6px">Histórico de salário e cargo</h3><div id="fc-hist" class="small muted">Carregando…</div>' : ''}`,
    foot: pode ? `${c ? '<button class="btn danger" id="fc-del" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fc-ok">Salvar</button>` : '<button class="btn" data-close>Fechar</button>' });
  if (c) q(sb.from('rh_salarios').select('*').eq('colaborador_id', c.id).order('vigencia', { ascending: false }).order('id', { ascending: false })).then(h => {
    $('#fc-hist', md.el).innerHTML = h.length ? `<table><thead><tr><th>Desde</th><th>Cargo</th><th class="num">Salário</th></tr></thead><tbody>${h.map(x => `<tr><td>${dateBR(x.vigencia)}</td><td>${esc(x.cargo || '')}</td><td class="num">${money(x.salario)}</td></tr>`).join('')}</tbody></table>` : 'Sem histórico.';
  }).catch(() => {});
  $('#fc-ok', md.el) && ($('#fc-ok', md.el).onclick = async (ev) => {
    const v = (id) => $('#' + id, md.el).value.trim();
    const row = { nome: limpa(v('fc-n')).toUpperCase(), matricula: v('fc-m') || null, cpf: soDig(v('fc-cpf')) || null, cargo: limpa(v('fc-c')) || null, setor: limpa(v('fc-s')) || null,
      centro_custo_id: v('fc-cc') || null, vinculo: v('fc-v'), situacao: v('fc-st'), admissao: v('fc-a') || null, demissao: v('fc-d') || null,
      salario: v('fc-sal') ? num(v('fc-sal')) : null, pix: v('fc-pix') || null, observacao: v('fc-o') || null };
    if (!row.nome) return toast('Informe o nome', true);
    if (row.cpf && row.cpf.length !== 11) return toast('CPF com 11 dígitos', true);
    if (row.situacao === 'desligado' && !row.demissao) return toast('Informe a data do desligamento', true);
    ev.target.disabled = true;
    try { if (c) await q(sb.from('rh_colaboradores').update(row).eq('id', c.id)); else await q(sb.from('rh_colaboradores').insert({ ...row, empresa_id: state.empresa.id }));
      md.close(); toast('Colaborador salvo'); render(root); } catch (err) { fail(err); ev.target.disabled = false; }
  });
  $('#fc-del', md.el) && ($('#fc-del', md.el).onclick = async () => {
    if (!await confirmDialog('Excluir o cadastro? Quem já está em alguma folha não pode ser excluído — marque como "Desligado".')) return;
    try { await q(sb.from('rh_colaboradores').delete().eq('id', c.id)); md.close(); render(root); } catch (err) { fail(/foreign key|violates/i.test(err.message) ? new Error('Está em uma folha: marque como Desligado em vez de excluir') : err); }
  });
}

// ---------- importar a relação de funcionários (XLSX/CSV): nome, cargo, salário (+ matrícula, CPF, admissão, setor se houver) ----------
function lerPlanilha(buf) {
  if (typeof XLSX === 'undefined') throw new Error('Leitor de planilhas não carregado: recarregue a página.');
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const N = (s) => chaveNome(s);
  const hi = rows.findIndex(r => r && r.some(x => /CARGO|FUNCAO/.test(N(x))) && r.some(x => /SALARIO|NOME|FUNCIONARIO/.test(N(x))));
  if (hi < 0) throw new Error('Não achei o cabeçalho (precisa ter as colunas de nome, cargo e salário).');
  const h = rows[hi].map(N);
  const col = (re) => h.findIndex(x => re.test(x));
  const ix = { nome: col(/^NOME|FUNCIONARIO|COLABORADOR/), cargo: col(/CARGO|FUNCAO/), salario: col(/SALARIO/), matricula: col(/MATRICULA|CODIGO/), cpf: col(/^CPF/), admissao: col(/ADMISS/), setor: col(/SETOR|DEPARTAMENTO/) };
  if (ix.nome < 0) ix.nome = 0;
  const data = (v) => v instanceof Date ? v.toISOString().slice(0, 10) : (/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim()) || []).slice(1).reverse().join('-') || null;
  return rows.slice(hi + 1).filter(r => r && limpa(r[ix.nome])).map(r => ({
    nome: limpa(r[ix.nome]).toUpperCase(), cargo: ix.cargo >= 0 ? limpa(r[ix.cargo]) || null : undefined,
    salario: ix.salario >= 0 && r[ix.salario] != null && r[ix.salario] !== '' ? (typeof r[ix.salario] === 'number' ? r[ix.salario] : num(r[ix.salario])) : undefined,
    matricula: ix.matricula >= 0 ? limpa(r[ix.matricula]) || null : undefined, cpf: ix.cpf >= 0 ? soDig(r[ix.cpf]) || null : undefined,
    admissao: ix.admissao >= 0 ? data(r[ix.admissao]) : undefined, setor: ix.setor >= 0 ? limpa(r[ix.setor]) || null : undefined,
  }));
}

function importar(B, root) {
  const md = modal({ title: 'Importar relação de funcionários', wide: true, body: `<p class="small muted" style="margin-top:0">Planilha (XLSX/CSV) com <b>nome, cargo e salário</b>; matrícula, CPF, admissão e setor entram se existirem.
      Quem já está no cadastro é encontrado pela matrícula, CPF ou nome. Nada é gravado antes da conferência.</p>
      <input type="file" id="ri-f" accept=".xlsx,.xls,.csv,.ods"><div id="ri-prev" style="margin-top:12px"></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ri-ok" disabled>Gravar</button>' });
  let plano = null;
  $('#ri-f', md.el).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const linhas = lerPlanilha(await file.arrayBuffer());
      const porMat = {}, porCpf = {}, porNome = {};
      for (const c of B.colabs) { if (c.matricula) porMat[c.matricula] = c; if (c.cpf) porCpf[c.cpf] = c; porNome[chaveNome(c.nome)] = c; }
      const novos = [], alterados = [], iguais = [], vistos = new Set(), dup = [];
      const chaves = new Set();
      for (const l of linhas) {
        const k = chaveNome(l.nome); if (chaves.has(k)) { dup.push(l.nome); continue; } chaves.add(k);
        const c = (l.matricula && porMat[l.matricula]) || (l.cpf && porCpf[l.cpf]) || porNome[k];
        if (!c) { novos.push({ ...l, setor: l.setor ?? setorDoCargo(l.cargo) }); continue; }
        vistos.add(c.id);
        const mud = {};
        for (const f of ['cargo', 'salario', 'matricula', 'cpf', 'admissao', 'setor']) if (l[f] !== undefined && l[f] !== null && String(l[f]) !== String(c[f] ?? '') && !(f === 'salario' && +l[f] === +c.salario)) mud[f] = l[f];
        if (c.situacao === 'desligado') mud.situacao = 'ativo';
        Object.keys(mud).length ? alterados.push({ c, mud }) : iguais.push(c);
      }
      const fora = B.colabs.filter(c => c.situacao !== 'desligado' && !vistos.has(c.id));
      plano = { novos, alterados, fora };
      const tot = (xs) => money(xs.reduce((s, x) => s + (+x.salario || 0), 0));
      const fmt = (f, v) => f === 'salario' ? money(v) : f === 'admissao' ? dateBR(v) : esc(v ?? '');
      $('#ri-prev', md.el).innerHTML = `<div class="kpis">${kpi('Linhas', linhas.length, dup.length ? `${dup.length} nome(s) repetido(s) ignorado(s)` : '')}${kpi('Novos', novos.length, tot(novos))}${kpi('Com alteração', alterados.length)}${kpi('Sem mudança', iguais.length)}${kpi('No cadastro e fora da planilha', fora.length, '', fora.length ? 'warn' : '')}</div>
        ${novos.length ? `<h3 style="margin:14px 0 6px">Novos (${novos.length})</h3><div class="table-wrap" style="max-height:260px"><table><thead><tr><th>Nome</th><th>Cargo</th><th>Setor sugerido</th><th class="num">Salário</th></tr></thead><tbody>
          ${novos.map(n => `<tr><td>${esc(n.nome)}</td><td>${esc(n.cargo || '')}</td><td>${esc(n.setor || '') || '<span class="muted">—</span>'}</td><td class="num">${money(n.salario)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${alterados.length ? `<h3 style="margin:14px 0 6px">Com alteração (${alterados.length})</h3><div class="table-wrap" style="max-height:220px"><table><thead><tr><th>Nome</th><th>O que muda</th></tr></thead><tbody>
          ${alterados.map(({ c, mud }) => `<tr><td>${esc(c.nome)}</td><td>${Object.entries(mud).map(([f, v]) => `${f}: ${fmt(f, c[f])} → <b>${fmt(f, v)}</b>`).join(' · ')}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${fora.length ? `<h3 style="margin:14px 0 6px">No cadastro, mas fora da planilha (${fora.length})</h3><p class="small muted">Não mudam, a não ser que você marque abaixo.</p>
          <div class="areas-chk">${fora.map(c => `<label class="chk"><input type="checkbox" class="ri-desl" value="${c.id}"> ${esc(c.nome)} — marcar desligado</label>`).join('')}</div>
          <label style="margin-top:8px">Data do desligamento<input type="date" id="ri-dd"></label>` : ''}`;
      $('#ri-ok', md.el).disabled = !(novos.length || alterados.length || fora.length);
    } catch (err) { fail(err); }
  };
  $('#ri-ok', md.el).onclick = async (ev) => {
    if (!plano) return;
    const desl = $$('.ri-desl', md.el).filter(x => x.checked).map(x => x.value);
    const dd = $('#ri-dd', md.el)?.value;
    if (desl.length && !dd) return toast('Informe a data do desligamento', true);
    ev.target.disabled = true;
    try {
      const novos = plano.novos.map(n => Object.fromEntries(Object.entries({ ...n, empresa_id: state.empresa.id, vinculo: /APRENDIZ/i.test(n.cargo || '') ? 'aprendiz' : /ESTAGI/i.test(n.cargo || '') ? 'estagio' : 'clt' }).filter(([, v]) => v !== undefined)));
      for (let i = 0; i < novos.length; i += 200) await q(sb.from('rh_colaboradores').insert(novos.slice(i, i + 200)));
      for (const { c, mud } of plano.alterados) await q(sb.from('rh_colaboradores').update(mud).eq('id', c.id));
      for (const id of desl) await q(sb.from('rh_colaboradores').update({ situacao: 'desligado', demissao: dd }).eq('id', id));
      md.close(); toast(`Gravado: ${novos.length} novo(s), ${plano.alterados.length} alterado(s)${desl.length ? `, ${desl.length} desligado(s)` : ''}`); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ---------- setor por cargo: um campo por cargo, grava em todos os colaboradores ativos daquele cargo ----------
function setorPorCargo(B, root) {
  const grupos = {};
  for (const c of B.colabs.filter(x => x.situacao !== 'desligado')) { const k = chaveNome(c.cargo) || '(sem cargo)'; (grupos[k] || (grupos[k] = { cargo: limpa(c.cargo) || '(sem cargo)', xs: [] })).xs.push(c); }
  const lista = Object.values(grupos).sort((a, b) => b.xs.length - a.xs.length);
  const setorAtual = (g) => { const s = [...new Set(g.xs.map(c => c.setor).filter(Boolean))]; return s.length === 1 ? s[0] : s.length ? '' : (setorDoCargo(g.cargo) || ''); };
  const setores = [...new Set(B.colabs.map(c => c.setor).filter(Boolean).concat(lista.map(g => setorDoCargo(g.cargo)).filter(Boolean)))].sort();
  const md = modal({ title: 'Setor por cargo', wide: true, body: `<p class="small muted" style="margin-top:0">Preencha o setor de cada cargo; vale para todos os ativos daquele cargo. Campo em branco = não muda. Sugestões vêm do nome do cargo.</p>
    <datalist id="sp-setores">${setores.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div class="table-wrap" style="max-height:60vh"><table><thead><tr><th>Cargo</th><th class="num">Pessoas</th><th>Setor</th></tr></thead><tbody>
    ${lista.map((g, i) => { const mix = new Set(g.xs.map(c => c.setor || '')).size > 1;
      return `<tr><td>${esc(g.cargo)}</td><td class="num">${g.xs.length}</td><td><input class="sp-s" data-i="${i}" list="sp-setores" value="${esc(setorAtual(g))}" placeholder="${mix ? 'setores diferentes — deixe em branco para manter' : ''}"></td></tr>`; }).join('')}</tbody></table></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="sp-ok">Gravar setores</button>' });
  $('#sp-ok', md.el).onclick = async (ev) => {
    ev.target.disabled = true; let n = 0;
    try {
      for (const inpS of $$('.sp-s', md.el)) {
        const s = limpa(inpS.value); if (!s) continue;
        const ids = lista[+inpS.dataset.i].xs.filter(c => c.setor !== s).map(c => c.id);
        if (ids.length) { await q(sb.from('rh_colaboradores').update({ setor: s }).in('id', ids)); n += ids.length; }
      }
      md.close(); toast(`${n} colaborador(es) com setor atualizado`); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ---------- relatório para impressão (os filtros da tela valem: busca, situação, setor, vínculo) ----------
const REL = { grupo: 'setor', salario: true, matricula: true, admissao: true, vinculo: true, cpf: false, assinatura: false };
function opcoesRelatorio(xs) {
  if (!xs.length) return toast('Nenhum colaborador com os filtros atuais', true);
  const ck = (k, t) => `<label class="chk"><input type="checkbox" class="rl-c" value="${k}" ${REL[k] ? 'checked' : ''}> ${t}</label>`;
  const filtros = [ui.sit === 'ativos' ? 'ativos' : ui.sit === 'desligados' ? 'desligados' : 'todos', ui.setor ? `setor ${ui.setor === '-' ? '(sem setor)' : ui.setor}` : '', ui.vinc ? VINCULOS[ui.vinc] : '', ui.busca ? `busca "${ui.busca}"` : ''].filter(Boolean).join(' · ');
  const md = modal({ title: 'Relatório de colaboradores', body: `<p class="small muted" style="margin-top:0">${xs.length} pessoa(s) — filtros da tela: ${esc(filtros)}.</p>
      <label>Agrupar por<select id="rl-g" data-nobusca>${[['setor', 'Setor'], ['cargo', 'Cargo'], ['vinculo', 'Vínculo'], ['', 'Sem agrupar (ordem alfabética)']].map(([k, t]) => `<option value="${k}" ${REL.grupo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="small muted" style="margin-top:10px">Colunas</div><div class="areas-chk">${ck('matricula', 'Matrícula')}${ck('vinculo', 'Vínculo')}${ck('admissao', 'Admissão')}${ck('salario', 'Salário (com subtotais)')}${ck('cpf', 'CPF (mascarado)')}${ck('assinatura', 'Coluna de assinatura')}</div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rl-ok">Abrir para imprimir</button>' });
  $('#rl-ok', md.el).onclick = async () => {
    REL.grupo = $('#rl-g', md.el).value; $$('.rl-c', md.el).forEach(c => { REL[c.value] = c.checked; });
    md.close(); await imprimirRelatorio(xs, filtros);
  };
}

async function imprimirRelatorio(xs, filtros) {
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  const logo = await logoPNG().catch(() => null);
  const cpfM = (c) => c && c.length === 11 ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : '';
  const chave = (c) => REL.grupo === 'vinculo' ? (VINCULOS[c.vinculo] || c.vinculo) : REL.grupo ? (limpa(c[REL.grupo]) || `(sem ${REL.grupo})`) : '';
  const grupos = {};
  for (const c of [...xs].sort((a, b) => a.nome.localeCompare(b.nome))) (grupos[chave(c)] || (grupos[chave(c)] = [])).push(c);
  const ordem = Object.keys(grupos).sort((a, b) => (a.startsWith('(sem') - b.startsWith('(sem')) || a.localeCompare(b));
  const cols = [['#', () => ''], ['Nome', c => `<b>${esc(c.nome)}</b>`], ...(REL.matricula ? [['Matrícula', c => esc(c.matricula || '')]] : []),
    ...(REL.cpf ? [['CPF', c => cpfM(c.cpf)]] : []), ...(REL.grupo !== 'cargo' ? [['Cargo', c => esc(c.cargo || '')]] : []), ...(REL.grupo !== 'setor' ? [['Setor', c => esc(c.setor || '')]] : []),
    ...(REL.vinculo && REL.grupo !== 'vinculo' ? [['Vínculo', c => VINCULOS[c.vinculo] || '']] : []), ...(REL.admissao ? [['Admissão', c => dateBR(c.admissao)]] : []),
    ...(ui.sit !== 'ativos' ? [['Situação', c => SITUACOES[c.situacao] + (c.demissao ? ' ' + dateBR(c.demissao) : '')]] : []),
    ...(REL.salario ? [['Salário', c => money(c.salario), 'n']] : []), ...(REL.assinatura ? [['Assinatura', () => '', 'ass']] : [])];
  const soma = (l) => l.reduce((s, c) => s + (+c.salario || 0), 0);
  let k = 0;
  const corpo = ordem.map(g => { const l = grupos[g];
    return `${REL.grupo ? `<tr class="gr"><td colspan="${cols.length}">${esc(g)} <span>— ${l.length} pessoa(s)</span></td></tr>` : ''}
      ${l.map(c => { k++; return `<tr>${cols.map(([t, f, cl], i) => `<td class="${cl || ''}">${i === 0 ? k : f(c)}</td>`).join('')}</tr>`; }).join('')}
      ${REL.grupo && REL.salario ? `<tr class="st"><td colspan="${cols.length - 1 - (REL.assinatura ? 1 : 0)}">Subtotal ${esc(g)}</td><td class="n">${money(soma(l))}</td>${REL.assinatura ? '<td></td>' : ''}</tr>` : ''}`; }).join('');
  const agora = new Date();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Colaboradores — ${esc(state.empresa.nome || '')}</title><style>
    @page{size:A4 ${cols.length > 8 ? 'landscape' : 'portrait'};margin:12mm}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#111;margin:0}
    .cab{display:flex;align-items:center;gap:14px;border-bottom:2px solid #111;padding-bottom:8px} .cab img{height:38px} .cab h1{font-size:16px;margin:0} .cab .d{margin-left:auto;text-align:right;font-size:10px;color:#444}
    .res{display:flex;gap:18px;margin:8px 0 6px;font-size:11px} .res b{font-size:12px}
    table{width:100%;border-collapse:collapse} th{background:#eee;text-align:left;font-size:10px;padding:4px 5px;border-bottom:1px solid #999} thead{display:table-header-group}
    td{padding:3px 5px;border-bottom:1px solid #ddd;vertical-align:top} td.n,th.n{text-align:right;white-space:nowrap} td.ass{width:150px} tr{page-break-inside:avoid}
    tr.gr td{background:#f4f4f4;font-weight:bold;font-size:11px;border-bottom:1px solid #999;padding-top:7px} tr.gr span{font-weight:normal;color:#555}
    tr.st td{font-weight:bold;border-bottom:1px solid #999} tr.tot td{font-weight:bold;font-size:11.5px;border-top:2px solid #111;border-bottom:0}
    .rod{margin-top:10px;font-size:9px;color:#555;border-top:1px solid #ccc;padding-top:4px}
    @media screen{body{margin:20px auto;max-width:1000px}.bar{margin-bottom:12px}} @media print{.bar{display:none}}</style></head><body>
    <div class="bar"><button onclick="print()">Imprimir / salvar PDF</button></div>
    <div class="cab">${logo ? `<img src="${logo.data}">` : ''}<div><h1>Relação de colaboradores</h1><div>${esc(state.empresa.nome || '')}</div></div>
      <div class="d">Emitido em ${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}<br>${esc(state.user?.email || '')}</div></div>
    <div class="res"><div>Pessoas: <b>${xs.length}</b></div>${REL.salario ? `<div>Salário base total: <b>${money(soma(xs))}</b></div><div>Média: <b>${money(soma(xs) / xs.length)}</b></div>` : ''}<div>Filtros: ${esc(filtros)}</div></div>
    <table><thead><tr>${cols.map(([t, , cl]) => `<th class="${cl || ''}">${t}</th>`).join('')}</tr></thead><tbody>${corpo}
      ${REL.salario ? `<tr class="tot"><td colspan="${cols.length - 1 - (REL.assinatura ? 1 : 0)}">Total geral — ${xs.length} pessoa(s)</td><td class="n">${money(soma(xs))}</td>${REL.assinatura ? '<td></td>' : ''}</tr>` : ''}</tbody></table>
    <div class="rod">Documento confidencial — uso restrito ao RH e à direção. ${REL.salario ? 'Contém salários.' : ''}</div>
    <script>window.onload=()=>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

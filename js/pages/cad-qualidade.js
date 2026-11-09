// Cadastros › Qualidade do Cadastro (CAD014, melhoria 10.1): duplicados (mesmo CNPJ/CPF ou nome parecido) com mesclar ou "não é duplicado",
// indicador de cadastro completo por beneficiário e por produto, e a consulta do CNPJ na Receita (BrasilAPI) para conferir e completar.
import { sb, state, q, fetchAll, isAdmin, podeEditar, loadCadastros } from '../lib/data.js';
import { $, $$, esc, dateBR, toast, fail, modal, exportXLSX } from '../lib/ui.js';
import { analisaDocumento } from '../lib/documentos.js';
import { duplicados, completude, CAMPOS_FAV, CAMPOS_PROD, lerReceita, diferencas } from '../lib/qualidade-cadastro.js';

export const title = 'Qualidade do Cadastro';
const ui = { aba: 'benef', tipo: 'todos', ver: 'duplicados' };
const ROT = { nome: 'Razão social', nome_fantasia: 'Nome fantasia', logradouro: 'Logradouro', numero: 'Número', complemento: 'Complemento', bairro: 'Bairro', municipio: 'Município', uf: 'UF', cep: 'CEP', telefone: 'Telefone', email: 'E-mail' };
const RUIM = /BAIXADA|INAPTA|SUSPENSA|NULA/;
const curto = (t) => t.replace(/\s*\(.*\)/, '').replace('Inscrição estadual ou indicador de ICMS', 'IE/ICMS').replace('Conferido na Receita', 'Receita');

export async function render(root) {
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="qc-abas">${[['benef', 'Beneficiários'], ['prod', 'Produtos'], ['param', 'Parâmetros']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><span id="qc-acoes"></span></div><div id="qc-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#qc-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  let cfg, ign;
  try { [cfg, ign] = await Promise.all([q(sb.from('qc_config').select('*').eq('empresa_id', state.empresa.id)).then(r => r[0] || {}), q(sb.from('qc_ignorados').select('*').eq('empresa_id', state.empresa.id))]); }
  catch (err) { $('#qc-corpo', root).innerHTML = /qc_/.test(err.message || '') ? '<div class="card"><div class="empty">Esta tela precisa do SQL 147.</div></div>' : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; return; }
  const c = $('#qc-corpo', root), I = (t) => new Set(ign.filter(x => x.tabela === t).map(x => `${x.a}|${x.b}`));
  if (ui.aba === 'benef') beneficiarios(c, root, cfg, I('favorecidos'));
  else if (ui.aba === 'prod') await produtos(c, root, cfg, I('produtos'));
  else parametros(c, root, cfg);
}

const nota = (n, meta) => `<span class="${n >= meta ? 'pos' : n >= meta - 20 ? 'warn' : 'neg'}"><b>${n}</b></span>`;

function beneficiarios(c, root, cfg, ign) {
  const meta = +cfg.meta || 80, todos = state.cad.favorecidos || [];
  const tipos = [...new Set(todos.map(f => f.tipo))].sort();
  const L = todos.filter(f => f.ativo !== false && (ui.tipo === 'todos' || f.tipo === ui.tipo));
  const G = duplicados(L, { minimo: +cfg.similaridade || 0.85, ignorados: ign });
  const notas = L.map(f => ({ f, ...completude(f, CAMPOS_FAV, cfg.pesos_fav || {}) }));
  const media = notas.length ? Math.round(notas.reduce((s, x) => s + x.nota, 0) / notas.length) : 0;
  const inval = L.filter(f => { const d = analisaDocumento(f.documento); return !d.vazio && !d.valido; }), semDoc = L.filter(f => analisaDocumento(f.documento).vazio);
  const ruins = L.filter(f => RUIM.test(f.receita_situacao || '')), consultar = L.filter(f => analisaDocumento(f.documento).tipo === 'PJ' && analisaDocumento(f.documento).valido && !f.receita_consultada_em);
  $('#qc-acoes', root).innerHTML = `<button class="btn" id="qc-xls">Excel</button>${podeEditar() && consultar.length ? ` <button class="btn" id="qc-lote">Consultar ${Math.min(30, consultar.length)} na Receita</button>` : ''}`;
  c.innerHTML = `<div class="kpis">
      <div class="kpi"><div class="k-label">Cadastro completo (média)</div><div class="k-value">${nota(media, meta)}</div><div class="k-sub">meta ${meta} · ${notas.filter(x => x.nota < meta).length} abaixo</div></div>
      <div class="kpi"><div class="k-label">Possíveis duplicados</div><div class="k-value ${G.length ? 'warn' : ''}">${G.length}</div><div class="k-sub">${G.filter(g => g.motivo === 'documento').length} pelo documento · ${G.filter(g => g.motivo === 'nome').length} pelo nome</div></div>
      <div class="kpi"><div class="k-label">CNPJ/CPF inválido</div><div class="k-value ${inval.length ? 'neg' : ''}">${inval.length}</div><div class="k-sub">${semDoc.length} sem documento</div></div>
      <div class="kpi"><div class="k-label">Receita: não ativos</div><div class="k-value ${ruins.length ? 'neg' : ''}">${ruins.length}</div><div class="k-sub">${consultar.length} CNPJ ainda não consultado(s)</div></div></div>
    <div class="card toolbar" style="margin-top:12px"><div class="chips" id="qc-ver">${[['duplicados', `Duplicados (${G.length})`], ['incompletos', 'Cadastro incompleto'], ['receita', `Situação na Receita (${ruins.length})`], ['invalidos', `Documento inválido (${inval.length})`]].map(([k, t]) => `<span class="chip ${ui.ver === k ? 'on' : ''}" data-v="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><label class="small">Tipo <select id="qc-tipo"><option value="todos">todos</option>${tipos.map(t => `<option ${t === ui.tipo ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
    <div id="qc-lista" style="margin-top:12px"></div>`;
  const lista = $('#qc-lista', c), linhaF = (f, extra = '') => { const d = analisaDocumento(f.documento), n = notas.find(x => x.f.id === f.id)?.nota ?? 0;
    return `<tr><td><b>${esc(f.nome)}</b><div class="small muted">${esc(f.tipo)}${f.nome_fantasia ? ' · ' + esc(f.nome_fantasia) : ''}</div></td><td class="small">${esc(d.formatado || f.documento || '—')}${!d.vazio && !d.valido ? ' <span class="neg">inválido</span>' : ''}</td>
      <td class="small">${esc([f.municipio, f.uf].filter(Boolean).join('/') || '—')}</td><td class="small">${f.receita_situacao ? `<span class="${RUIM.test(f.receita_situacao) ? 'neg' : 'pos'}">${esc(f.receita_situacao)}</span> <span class="muted">${dateBR(f.receita_consultada_em)}</span>` : '<span class="muted">—</span>'}</td><td class="num">${nota(n, meta)}</td>${extra}</tr>`; };
  const btnRec = (f) => podeEditar() && d_pj(f) ? `<button class="btn small" data-rec="${f.id}">Receita</button>` : '';
  if (ui.ver === 'duplicados') {
    lista.innerHTML = G.map((g, i) => `<div class="card flush" style="margin-bottom:10px"><div class="card-head" style="padding:10px 12px 0"><div><b>${g.motivo === 'documento' ? `Mesmo documento ${esc(analisaDocumento(g.chave).formatado || g.chave)}` : `Nomes parecidos (${Math.round(g.semelhanca * 100)}%)`}</b></div>
        ${podeEditar() ? `<div>${g.itens.length === 2 ? `<button class="btn small ghost" data-ign="${i}">Não é duplicado</button> ` : ''}<button class="btn small primary" data-mes="${i}">Mesclar</button></div>` : ''}</div>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>CNPJ/CPF</th><th>Município</th><th>Receita</th><th class="num">Completo</th></tr></thead><tbody>${g.itens.map(f => linhaF(f)).join('')}</tbody></table></div></div>`).join('')
      || '<div class="card"><div class="empty">Nenhum possível duplicado.</div></div>';
  } else {
    const V = ui.ver === 'incompletos' ? notas.filter(x => x.nota < 100).sort((a, b) => a.nota - b.nota).map(x => x.f) : ui.ver === 'receita' ? ruins : inval;
    lista.innerHTML = `<div class="card flush"><div class="table-wrap" id="qc-tab" style="max-height:60vh"><table><thead><tr><th>Nome</th><th>CNPJ/CPF</th><th>Município</th><th>Receita</th><th class="num">Completo</th><th>O que falta</th><th></th></tr></thead><tbody>
      ${V.slice(0, 500).map(f => linhaF(f, `<td class="small wrap">${esc((notas.find(x => x.f.id === f.id)?.faltam || []).map(curto).join(' · '))}</td><td>${btnRec(f)}</td>`)).join('') || '<tr><td colspan="7" class="empty">Nada aqui.</td></tr>'}</tbody></table></div></div>
      ${V.length > 500 ? `<p class="small muted">Mostrando 500 de ${V.length}.</p>` : ''}`;
  }
  $('#qc-ver', c).onclick = (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) { ui.ver = v; beneficiarios(c, root, cfg, ign); } };
  $('#qc-tipo', c).onchange = (e) => { ui.tipo = e.target.value; beneficiarios(c, root, cfg, ign); };
  $('#qc-xls', root).onclick = () => { const t = $('#qc-lista table', c); if (t) exportXLSX(t, 'qualidade_cadastro'); };
  $$('[data-rec]', c).forEach(b => b.onclick = () => receita(todos.find(f => f.id === b.dataset.rec), root));
  $$('[data-ign]', c).forEach(b => b.onclick = async () => { const [x, y] = G[+b.dataset.ign].itens.map(f => f.id).sort();
    try { await q(sb.from('qc_ignorados').insert({ empresa_id: state.empresa.id, tabela: 'favorecidos', a: x, b: y })); toast('Marcado como não duplicado'); render(root); } catch (err) { fail(err); } });
  $$('[data-mes]', c).forEach(b => b.onclick = () => mesclar(G[+b.dataset.mes].itens, root));
  $('#qc-lote', root) && ($('#qc-lote', root).onclick = (ev) => lote(consultar.slice(0, 30), ev.target, root));
}
const d_pj = (f) => { const d = analisaDocumento(f.documento); return d.valido && d.tipo === 'PJ'; };

function mesclar(itens, root) {
  const md = modal({ title: 'Mesclar cadastros', body: `<p class="small">Escolha o cadastro que <b>fica</b>. Os lançamentos, notas, contratos e demais vínculos dos outros passam para ele, os campos vazios dele são completados com os dos outros, e os outros são excluídos.</p>
    ${itens.map((f, i) => `<label class="chk" style="margin:6px 0"><input type="radio" name="mm" value="${f.id}" ${i === 0 ? 'checked' : ''}> <b>${esc(f.nome)}</b> <span class="small muted">${esc(f.tipo)} · ${esc(analisaDocumento(f.documento).formatado || 'sem documento')}${f.email ? ' · ' + esc(f.email) : ''}</span></label>`).join('')}
    <p class="small muted">Não dá para desfazer. Cadastros com CNPJ/CPF diferentes não são mesclados.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="mm-ok">Mesclar</button>' });
  $('#mm-ok', md.el).onclick = async (ev) => {
    const fica = $('input[name=mm]:checked', md.el).value; ev.target.disabled = true;
    try {
      let n = 0; for (const f of itens.filter(x => x.id !== fica)) { const r = await q(sb.rpc('mesclar_favorecidos', { p_manter: fica, p_excluir: f.id })); n += Object.values(r.movidos || {}).reduce((s, v) => s + +v, 0); }
      await loadCadastros(); toast(`Cadastros mesclados · ${n} vínculo(s) levados`); md.close(); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

async function consultarCNPJ(doc) {
  const cnpj = String(doc).replace(/\D/g, '');
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (r.status === 404) throw new Error('CNPJ não encontrado na Receita');
  if (r.status === 429) throw new Error('Muitas consultas seguidas: aguarde um minuto');
  if (!r.ok) throw new Error(`A consulta pública do CNPJ não respondeu (${r.status})`);
  return lerReceita(await r.json());
}
const gravarReceita = (f, R, campos = {}) => q(sb.from('favorecidos').update({ ...campos, receita_situacao: R.situacao, receita_consultada_em: new Date().toISOString(),
  receita_dados: { cnae: R.cnae, abertura: R.abertura, data_situacao: R.data_situacao, simples: R.simples, mei: R.mei } }).eq('id', f.id));

async function receita(f, root) {
  let R; try { toast('Consultando a Receita…'); R = await consultarCNPJ(f.documento); } catch (err) { return fail(err); }
  const D = diferencas(f, R);
  const md = modal({ wide: true, title: `Receita — ${f.nome}`, body: `<p>Situação cadastral: <b class="${RUIM.test(R.situacao || '') ? 'neg' : 'pos'}">${esc(R.situacao || '—')}</b>${R.data_situacao ? ` desde ${dateBR(R.data_situacao)}` : ''}
      ${R.abertura ? ` · aberta em ${dateBR(R.abertura)}` : ''}${R.cnae ? `<br><span class="small">CNAE ${esc(R.cnae)}</span>` : ''}${R.simples != null ? `<br><span class="small">Simples Nacional: ${R.simples ? 'sim' : 'não'}${R.mei ? ' (MEI)' : ''}</span>` : ''}</p>
    ${D.length ? `<table class="small"><thead><tr><th></th><th>Campo</th><th>No cadastro</th><th>Na Receita</th></tr></thead><tbody>${D.map((d, i) => `<tr><td><input type="checkbox" class="rc-x" data-i="${i}" ${d.vazio ? 'checked' : ''}></td><td>${ROT[d.campo] || d.campo}</td><td class="${d.vazio ? 'muted' : ''}">${esc(d.atual || 'vazio')}</td><td><b>${esc(d.receita)}</b></td></tr>`).join('')}</tbody></table>
      <p class="small muted">Marcados vêm com os campos vazios; marque os que quer trocar pelo da Receita.</p>` : '<p class="small">O cadastro já está igual ao da Receita.</p>'}
    <p class="small muted">Fonte: consulta pública do CNPJ (BrasilAPI, dados da Receita Federal). Pode estar alguns dias atrás da Receita.</p>`,
    foot: `<button class="btn" data-close>Fechar</button>${podeEditar() ? '<button class="btn primary" id="rc-ok">Gravar</button>' : ''}` });
  $('#rc-ok', md.el) && ($('#rc-ok', md.el).onclick = async () => {
    const campos = Object.fromEntries($$('.rc-x:checked', md.el).map(x => { const d = D[+x.dataset.i]; return [d.campo, d.receita]; }));
    try { await gravarReceita(f, R, campos); await loadCadastros(); toast(`Gravado${Object.keys(campos).length ? ` · ${Object.keys(campos).length} campo(s) atualizado(s)` : ''}`); md.close(); render(root); } catch (err) { fail(err); }
  });
}

async function lote(L, btn, root) {
  if (!confirm(`Consultar ${L.length} CNPJ na Receita? Só a situação e os campos vazios são gravados; leva cerca de ${Math.ceil(L.length * 1.5)} segundos.`)) return;
  btn.disabled = true; let ok = 0, erro = 0;
  for (const [i, f] of L.entries()) {
    btn.textContent = `Consultando ${i + 1}/${L.length}…`;
    try { const R = await consultarCNPJ(f.documento); const campos = Object.fromEntries(diferencas(f, R).filter(d => d.vazio).map(d => [d.campo, d.receita])); await gravarReceita(f, R, campos); ok++; }
    catch (err) { erro++; if (/Muitas consultas/.test(err.message)) { toast(err.message, true); break; } }
    await new Promise(r => setTimeout(r, 1500));
  }
  await loadCadastros(); toast(`${ok} consultado(s)${erro ? `, ${erro} com erro` : ''}`); render(root);
}

async function produtos(c, root, cfg, ign) {
  const meta = +cfg.meta || 80;
  const P = await fetchAll(() => sb.from('produtos').select('id,codigo,descricao,tipo,unidade,ncm,grupo,estoque_minimo,ponto_pedido,ativo').eq('empresa_id', state.empresa.id).order('descricao'));
  const A = P.filter(p => p.ativo !== false), G = duplicados(A, { campoNome: 'descricao', campoDoc: null, minimo: Math.max(0.9, +cfg.similaridade || 0.85), ignorados: ign, mesmoTipo: 'tipo' });
  const notas = A.map(p => ({ p, ...completude(p, CAMPOS_PROD, cfg.pesos_prod || {}) })), media = notas.length ? Math.round(notas.reduce((s, x) => s + x.nota, 0) / notas.length) : 0;
  $('#qc-acoes', root).innerHTML = '';
  c.innerHTML = `<div class="kpis"><div class="kpi"><div class="k-label">Cadastro completo (média)</div><div class="k-value">${nota(media, meta)}</div><div class="k-sub">${A.length} produto(s) ativo(s)</div></div>
      <div class="kpi"><div class="k-label">Descrições parecidas</div><div class="k-value ${G.length ? 'warn' : ''}">${G.length}</div><div class="k-sub">mesmo tipo</div></div>
      <div class="kpi"><div class="k-label">Sem NCM válido</div><div class="k-value">${A.filter(p => !/^\d{8}$/.test(String(p.ncm || '').replace(/\D/g, ''))).length}</div></div></div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><h2 style="margin:0">Descrições parecidas</h2></div><div class="table-wrap"><table><thead><tr><th>Produtos</th><th class="num">Semelhança</th><th></th></tr></thead><tbody>
      ${G.slice(0, 100).map((g, i) => `<tr><td>${g.itens.map(p => `<div><b>${esc(p.codigo)}</b> ${esc(p.descricao)} <span class="small muted">${esc(p.unidade || '')}</span></div>`).join('')}</td><td class="num">${Math.round(g.semelhanca * 100)}%</td>
        <td style="white-space:nowrap">${podeEditar() ? `<button class="btn small ghost" data-pign="${i}">Não é duplicado</button> ${g.itens.map(p => `<button class="btn small ghost" data-inat="${p.id}">Inativar ${esc(p.codigo)}</button>`).join(' ')}` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhuma descrição parecida.</td></tr>'}</tbody></table></div></div>
    <div class="card flush" style="margin-top:12px"><div class="card-head" style="padding:12px 12px 0"><h2 style="margin:0">Cadastro incompleto</h2></div><div class="table-wrap" style="max-height:50vh"><table><thead><tr><th>Código</th><th>Descrição</th><th class="num">Completo</th><th>O que falta</th></tr></thead><tbody>
      ${notas.filter(x => x.nota < 100).sort((a, b) => a.nota - b.nota).slice(0, 300).map(x => `<tr><td>${esc(x.p.codigo)}</td><td>${esc(x.p.descricao)}</td><td class="num">${nota(x.nota, meta)}</td><td class="small wrap">${esc(x.faltam.map(curto).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Todos completos.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Produtos com movimento não são mesclados aqui: inative o repetido e ajuste o estoque pelo inventário. Para completar em massa, use Estoque › Produtos › Cadastro em massa.</p>`;
  $$('[data-pign]', c).forEach(b => b.onclick = async () => { const [x, y] = G[+b.dataset.pign].itens.map(p => p.id).sort(); try { await q(sb.from('qc_ignorados').insert({ empresa_id: state.empresa.id, tabela: 'produtos', a: x, b: y })); render(root); } catch (err) { fail(err); } });
  $$('[data-inat]', c).forEach(b => b.onclick = async () => { if (!confirm('Inativar este produto?')) return; try { await q(sb.from('produtos').update({ ativo: false }).eq('id', b.dataset.inat)); toast('Produto inativado'); render(root); } catch (err) { fail(err); } });
}

function parametros(c, root, cfg) {
  const adm = isAdmin(), pf = cfg.pesos_fav || {}, pp = cfg.pesos_prod || {};
  const linhas = (C, P, cls) => Object.entries(C).map(([k, [rot, padrao]]) => `<label>${rot}<input type="number" min="0" max="100" class="${cls}" data-k="${k}" value="${P[k] ?? padrao}" ${adm ? '' : 'disabled'}></label>`).join('');
  c.innerHTML = `<div class="card"><h2 style="margin-top:0">Parâmetros</h2><div class="grid2">
      <label>Semelhança mínima dos nomes (%)<input type="number" min="50" max="100" id="qp-s" value="${Math.round((+cfg.similaridade || 0.85) * 100)}" ${adm ? '' : 'disabled'}><span class="small muted">mais alto = menos sugestões</span></label>
      <label>Meta do cadastro completo<input type="number" min="0" max="100" id="qp-m" value="${cfg.meta ?? 80}" ${adm ? '' : 'disabled'}></label></div>
    <h3>Pesos — beneficiários <span class="small muted">(0 tira o campo do indicador)</span></h3><div class="grid2">${linhas(CAMPOS_FAV, pf, 'qp-f')}</div>
    <h3>Pesos — produtos</h3><div class="grid2">${linhas(CAMPOS_PROD, pp, 'qp-p')}</div>
    ${adm ? '<button class="btn primary" id="qp-ok" style="margin-top:12px">Salvar</button>' : '<p class="small muted">Só o administrador altera.</p>'}</div>`;
  $('#qp-ok', c) && ($('#qp-ok', c).onclick = async () => {
    const pes = (cls) => Object.fromEntries($$('.' + cls, c).map(x => [x.dataset.k, +x.value || 0]));
    try { await q(sb.from('qc_config').upsert({ empresa_id: state.empresa.id, similaridade: Math.min(1, Math.max(0.5, (+$('#qp-s', c).value || 85) / 100)), meta: +$('#qp-m', c).value || 80,
      pesos_fav: pes('qp-f'), pesos_prod: pes('qp-p'), atualizado_em: new Date().toISOString() })); toast('Parâmetros salvos'); } catch (err) { fail(err); }
  });
}

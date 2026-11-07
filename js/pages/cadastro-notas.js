// Estoque › Cadastro pelas Notas de Entrada (SQL 085): cadastra os produtos e os de-paras de uma vez, a partir dos itens das
// NF-e de entrada que ainda não têm produto. A família vem das regras de classificação (editáveis aqui), o mesmo material de
// fornecedores diferentes vira um produto só (pelo grau) e a curva ABC mostra onde está o valor. No topo, a prontidão das notas
// para a implantação do estoque (o que cada item faria, sem gravar) e os CFOPs que ainda não têm regra.
import { sb, state, q, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, money0, pct, fail, toast, modal, confirmDialog, debounce, erroTela, parseNum } from '../lib/ui.js';
import { carregarProdutos, limparCacheProdutos } from '../lib/produtos.js';
import * as C from '../lib/cadastro-massa.js';

export const title = 'Cadastro pelas Notas de Entrada';
const ui = { desde: '2026-01-01', fam: '', curva: '', busca: '', ver: 200 };
let D = null;
const MOTIVO = { ok: 'Movimenta', nao_movimenta: 'Não movimenta (decidido)', sem_produto: 'Sem produto / de-para', sem_regra: 'CFOP sem regra', sem_local: 'Produto sem local' };

async function carregar() {
  const e = state.empresa.id;
  let [K, Fm, Tm] = await Promise.all([
    q(sb.from('est_classif_regras').select('*').eq('empresa_id', e).order('ordem')),
    q(sb.from('est_familias').select('id,codigo,nome,tipo_sped,ativo').eq('empresa_id', e).order('codigo')),
    q(sb.from('est_tipos_movimento').select('id,codigo,nome,sentido').eq('empresa_id', e).order('codigo')),
  ]);
  if (!K.length && podeEditar()) {   // primeira vez: regras e famílias de partida
    await q(sb.rpc('est_cadastro_padrao', { p_empresa: e }));
    [K, Fm] = await Promise.all([q(sb.from('est_classif_regras').select('*').eq('empresa_id', e).order('ordem')), q(sb.from('est_familias').select('id,codigo,nome,tipo_sped,ativo').eq('empresa_id', e).order('codigo'))]);
  }
  const [P, Pr, Pron, Esp] = await Promise.all([q(sb.rpc('produto_depara_pendente', { p_empresa: e, p_de: ui.desde })), carregarProdutos(true),
    q(sb.rpc('est_prontidao', { p_empresa: e, p_de: ui.desde })).catch(() => null), q(sb.from('estoque_espelhos').select('id,data_ref').eq('empresa_id', e).order('data_ref', { ascending: false }).limit(1))]);
  // linhas do último espelho do Iniflex ainda sem produto: o produto novo deve nascer com o código do Iniflex (liga o saldo inicial)
  const Ini = Esp[0] ? await q(sb.from('estoque_espelho_itens').select('codigo,descricao,unidade,quantidade').eq('espelho_id', Esp[0].id).is('produto_id', null).order('codigo')).catch(() => []) : [];
  const iniPorCod = {}; for (const x of Ini) (iniPorCod[x.codigo] ||= { codigo: x.codigo, descricao: x.descricao, unidade: x.unidade, quantidade: 0 }).quantidade += +x.quantidade || 0;
  const iniLista = Object.values(iniPorCod).map(x => ({ ...x, id: 'ini:' + x.codigo, tipo: 'iniflex' })), usados = new Set();
  const fById = Object.fromEntries(Fm.map(f => [f.id, f]));
  const G = C.agrupar(P, K, Fm);
  for (const g of G) {
    g.sel = false; g.itens.forEach(i => { i.on = true; });
    if (g.nao_estoque) continue;
    const p = C.parecido(g, Pr); if (p) { g.sug = p; g.produto_id = p.id; continue; }
    const ini = C.parecido(g, iniLista.filter(x => !usados.has(x.codigo)));
    if (ini) { usados.add(ini.codigo); g.codigo = ini.codigo; g.iniflex = ini; if (ini.descricao) g.descricao = C.norm(ini.descricao); }
  }
  D = { K, Fm, Tm, fById, P, Pr, G, Pron, pr: C.prontidao(Pron), esp: Esp[0] || null, iniLista };
}

export async function render(root) {
  root.innerHTML = `<style>
    .cn-curva{display:inline-block;width:20px;text-align:center;border-radius:4px;font-weight:700;font-size:11px}.cn-curva.A{background:color-mix(in srgb,var(--pos) 18%,transparent);color:var(--pos)}
    .cn-curva.B{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}.cn-curva.C{background:var(--border);color:var(--muted)}
    .cn-bar{height:8px;border-radius:4px;background:var(--border);overflow:hidden;display:flex}.cn-bar span{display:block;height:100%}
    .cn-g td{vertical-align:top}.cn-g input.cn-desc{width:100%;min-width:220px}.cn-itens td{background:var(--bg);font-size:12px}
    .cn-fams{display:flex;gap:6px;flex-wrap:wrap}.cn-fams .chip small{opacity:.75;margin-left:4px}
  </style>
  <div class="mm-topo"><div><h2 style="margin:0">Cadastro pelas Notas de Entrada</h2><div class="muted small">Produtos e de-paras de uma vez, pelos itens das NF-e de entrada. O mesmo material de fornecedores diferentes vira um produto só.</div></div>
    <a class="btn ghost" href="#/estoque/depara">De-para item a item</a></div>
  <div id="cn-corpo"><div class="loading">Lendo as notas e classificando os itens…</div></div>`;
  try { await carregar(); } catch (err) { console.error(err); $('#cn-corpo', root).innerHTML = erroTela('o cadastro pelas notas (rode o SQL 085 se ainda não rodou)'); return; }
  pintar(root);
}

function prontidaoHTML() {
  const p = D.pr, barra = (s) => { const t = p[s].total || 1, cores = { ok: 'var(--pos)', nao_movimenta: 'var(--brand-blue)', sem_produto: 'var(--warn)', sem_regra: 'var(--neg)', sem_local: '#a855f7' };
    return `<div class="cn-bar" title="${esc(Object.entries(p[s].porMotivo).filter(([, v]) => v.itens).map(([k, v]) => `${MOTIVO[k]}: ${v.itens} itens, ${money0(v.valor)}`).join(' · '))}">${Object.entries(p[s].porMotivo).map(([k, v]) => `<span style="width:${v.valor / t * 100}%;background:${cores[k]}"></span>`).join('')}</div>`; };
  const linha = (s, nome) => `<div style="margin-top:8px"><div style="display:flex;justify-content:space-between"><b>${nome}</b><span><b>${pct(p[s].pct, 0)}</b> do valor pronto · ${p[s].itens} itens</span></div>${barra(s)}
    <div class="small muted">${Object.entries(p[s].porMotivo).filter(([, v]) => v.itens).map(([k, v]) => `${MOTIVO[k]}: ${v.itens} (${money0(v.valor)})`).join(' · ')}</div></div>`;
  const cf = D.Pron?.cfops_sem_regra || [];
  return `<div class="card"><h3 style="margin:0">Prontidão das notas para o estoque</h3><div class="muted small">O que cada item das notas desde ${ui.desde.split('-').reverse().join('/')} faria no estoque hoje, sem gravar nada. Verde movimenta; azul foi decidido que não movimenta.</div>
    ${linha('entrada', 'Notas de entrada')}${linha('saida', 'Notas de saída')}
    ${cf.length ? `<h4 style="margin:14px 0 4px">CFOPs sem regra (${cf.length})</h4><div class="table-wrap" style="max-height:220px"><table><tr><th>CFOP</th><th>Sentido</th><th class="num">Itens</th><th class="num">Valor</th><th>Exemplo</th><th></th></tr>
      ${cf.map((x, i) => `<tr><td><b>${esc(x.cfop)}</b></td><td>${x.sentido}</td><td class="num">${x.itens}</td><td class="num">${money0(x.valor)}</td><td class="wrap small">${esc(x.exemplo || '')}</td>
        <td>${podeEditar() ? `<button class="btn small" data-cf="${i}">Criar regra</button>` : ''}</td></tr>`).join('')}</table></div>` : ''}</div>`;
}

function filtrados() {
  const b = C.norm(ui.busca);
  return D.G.filter(g => (!ui.fam || (ui.fam === '-' ? !g.familia_id : g.familia_id === ui.fam)) && (!ui.curva || g.curva === ui.curva)
    && (!b || C.norm(`${g.descricao} ${g.grau || ''} ${g.ncm || ''} ${g.itens.map(i => `${i.descricao} ${i.emit_nome || ''} ${i.codigo_fornecedor}`).join(' ')}`).includes(b)));
}

function pintar(root) {
  const c = $('#cn-corpo', root), ed = podeEditar();
  const tot = D.G.reduce((s, g) => s + g.valor, 0);
  const porF = {}; for (const g of D.G) { const k = g.familia_id || '-'; (porF[k] ||= { n: 0, v: 0 }); porF[k].n++; porF[k].v += g.valor; }
  const L = filtrados(), sel = D.G.filter(g => g.sel), selV = sel.reduce((s, g) => s + g.valor, 0);
  const semEsp = !D.esp ? `<div class="card" style="margin-bottom:12px;border-color:var(--warn)"><b>Recomendado antes de gravar:</b> importe o relatório de saldo do Iniflex em <a href="#/estoque">Posição de Estoque</a>.
    Assim cada produto novo nasce com o código do Iniflex e o saldo inicial se liga sozinho na implantação. Sem o espelho, os produtos recebem o código da família (ex.: RES-0001) e o código pode ser trocado depois na ficha do produto.</div>` : '';
  c.innerHTML = `${semEsp}${prontidaoHTML()}
    <div class="card" style="margin-top:12px"><div class="toolbar">
      <label>Notas desde<input type="date" id="cn-de" value="${ui.desde}"></label>
      <input id="cn-b" placeholder="Procurar produto, grau, fornecedor, NCM" value="${esc(ui.busca)}" style="min-width:240px;flex:1">
      <select id="cn-cv"><option value="">Curvas A, B e C</option>${['A', 'B', 'C'].map(x => `<option ${ui.curva === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <span class="spacer"></span><button class="btn small" id="cn-regras">Regras de classificação</button></div>
      <div class="cn-fams" style="margin-top:8px"><span class="chip ${ui.fam ? '' : 'on'}" data-f="">Todas <small>${D.G.length}</small></span>
        ${Object.entries(porF).sort((a, b) => b[1].v - a[1].v).map(([k, v]) => `<span class="chip ${ui.fam === k ? 'on' : ''}" data-f="${k}">${esc(k === '-' ? 'Sem família' : D.fById[k]?.nome || k)} <small>${v.n} · ${pct(tot ? v.v / tot : 0, 1)}</small></span>`).join('')}</div></div>
    <div class="card" style="margin-top:12px"><div class="toolbar"><div><b>${D.G.length} produtos propostos</b><div class="muted small">de ${D.P.length} itens de compra sem de-para (${money0(tot)}) · curva A: ${D.G.filter(g => g.curva === 'A').length} produtos = 80% do valor</div></div>
      <span class="spacer"></span>${ed ? `<button class="btn small" id="cn-ab">Marcar A e B</button><button class="btn small" id="cn-vis">Marcar a lista</button><button class="btn small ghost" id="cn-limpa">Desmarcar</button>
      <button class="btn primary" id="cn-grava" ${sel.length ? '' : 'disabled'}>Gravar ${sel.length} produto(s) · ${pct(tot ? selV / tot : 0, 0)}</button>` : ''}</div>
      <div class="table-wrap" style="max-height:66vh"><table><thead><tr><th></th><th>Produto proposto<div class="small">Grau · NCM · fornecedores</div></th><th>Família</th><th>Unid.</th><th class="num">Comprado<div class="small">% · acumulado</div></th><th></th></tr></thead><tbody>
      ${L.slice(0, ui.ver).map(g => linhaGrupo(g)).join('') || '<tr><td colspan="6" class="empty">Nenhum item sem de-para com estes filtros. 👌</td></tr>'}</tbody></table></div>
      ${L.length > ui.ver ? `<div class="toolbar"><span class="muted small">Mostrando ${ui.ver} de ${L.length}.</span><button class="btn small" id="cn-mais">Mostrar mais 200</button></div>` : ''}
      <datalist id="cn-ini">${D.iniLista.map(x => `<option value="${esc(x.codigo)}">${esc(x.descricao || '')}</option>`).join('')}</datalist>
      <p class="muted small">Cada produto novo recebe o código do Iniflex sugerido pelo espelho (quando houver) ou o código da família (ex.: RES-0001, TIN-0001) e os de-paras dos itens marcados, com o fator de conversão (ex.: saco de 25 kg → 25) e o último custo da nota.
        "Não é estoque" liga os itens a um produto genérico que não movimenta (energia, serviços, obras). Nada é gravado até clicar em Gravar.</p></div>`;
  ligar(root);
}

function linhaGrupo(g) {
  const i = D.G.indexOf(g), ed = podeEditar();
  const famSel = `<select data-fam="${i}" ${ed ? '' : 'disabled'}>${g.familia_id ? '' : '<option value="">— escolha —</option>'}${D.Fm.filter(f => f.ativo !== false || f.id === g.familia_id).map(f => `<option value="${f.id}" ${f.id === g.familia_id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select>`;
  const prod = g.nao_estoque ? `<b>${esc(g.descricao)}</b><div class="small muted">${g.itens.length} itens · ${g.fornecedores} fornecedores · ligados a um produto genérico que não movimenta</div>`
    : g.produto_id ? `<div>Ligar a <b>${esc(g.sug.codigo)} — ${esc(g.sug.descricao)}</b> <button class="btn small ghost" data-novo="${i}" title="Criar produto novo em vez de ligar">criar novo</button></div><div class="small muted">${g.itens.length} item(ns) · ${g.fornecedores} fornecedor(es)</div>`
    : `<input class="cn-desc" data-d="${i}" value="${esc(g.descricao)}" ${ed ? '' : 'disabled'}>
      <div style="margin-top:4px"><input data-c="${i}" value="${esc(g.codigo || '')}" placeholder="código automático" list="cn-ini" style="width:150px" ${ed ? '' : 'disabled'} title="Código do Iniflex: é ele que liga o saldo inicial do espelho">${g.iniflex ? ` <span class="small" style="color:var(--pos)">Iniflex: ${esc(g.iniflex.descricao || '')}</span>` : ''}</div><div class="small muted">${g.grau ? `grau <b>${esc(g.grau)}</b> · ` : ''}${g.ncm ? `NCM ${esc(g.ncm)} · ` : ''}${g.itens.length} item(ns) · ${g.fornecedores} fornecedor(es)${g.revisar ? ' · <span style="color:var(--warn)">confira o fator</span>' : ''}${g.familia === 'IMOB' ? ' · <span style="color:var(--warn)">revise: ativo imobilizado ou peça?</span>' : ''}</div>`;
  return `<tr class="cn-g"><td><input type="checkbox" data-s="${i}" ${g.sel ? 'checked' : ''} ${ed ? '' : 'disabled'}></td><td>${prod}</td><td>${g.nao_estoque ? '<span class="muted">Não é estoque</span>' : famSel}</td>
    <td>${g.nao_estoque || g.produto_id ? '' : `<input data-u="${i}" value="${esc(g.unidade)}" style="width:60px" ${ed ? '' : 'disabled'}>`}</td>
    <td class="num">${money0(g.valor)}<div class="small muted"><span class="cn-curva ${g.curva}">${g.curva}</span> ${pct(g.pct, 1)} · ${pct(g.acumulado, 0)}</div></td>
    <td><button class="btn small ghost" data-x="${i}">${g.aberto ? 'Fechar' : `Itens (${g.itens.length})`}</button></td></tr>
    ${g.aberto ? `<tr class="cn-itens"><td></td><td colspan="5"><table><tr><th></th><th>Fornecedor</th><th>Código</th><th>Descrição na nota</th><th>Unid.</th><th class="num">Fator</th><th class="num">Valor</th></tr>
      ${g.itens.map((it, j) => `<tr><td><input type="checkbox" data-io="${i}:${j}" ${it.on ? 'checked' : ''} title="Desmarque para deixar este item de fora"></td><td class="wrap-m">${esc(it.emit_nome || it.emit_doc)}</td><td>${esc(it.codigo_fornecedor)}</td>
        <td class="wrap">${esc(it.descricao)}</td><td>${esc(it.unidade || '')}</td><td class="num"><input data-fa="${i}:${j}" value="${String(it.fator).replace('.', ',')}" style="width:70px;text-align:right" ${ed ? '' : 'disabled'}></td><td class="num">${money(it.valor)}</td></tr>`).join('')}</table>
      <div class="small muted">Fator = quantas unidades do produto (${esc(g.unidade)}) há em 1 unidade da nota. Item desmarcado fica fora desta gravação e volta para a lista depois.</div></td></tr>` : ''}`;
}

function ligar(root) {
  const c = $('#cn-corpo', root), redesenha = () => pintar(root);
  $('#cn-de', c).onchange = async (e) => { ui.desde = e.target.value || '2026-01-01'; c.innerHTML = '<div class="loading">Lendo as notas…</div>'; try { await carregar(); pintar(root); } catch (er) { fail(er); } };
  $('#cn-b', c).oninput = debounce((e) => { ui.busca = e.target.value; redesenha(); const b = $('#cn-b', c); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }, 300);
  $('#cn-cv', c).onchange = (e) => { ui.curva = e.target.value; redesenha(); };
  $$('[data-f]', c).forEach(x => x.onclick = () => { ui.fam = x.dataset.f; redesenha(); });
  const mais = $('#cn-mais', c); if (mais) mais.onclick = () => { ui.ver += 200; redesenha(); };
  $$('[data-s]', c).forEach(x => x.onchange = () => { D.G[+x.dataset.s].sel = x.checked; redesenha(); });
  $$('[data-x]', c).forEach(x => x.onclick = () => { const g = D.G[+x.dataset.x]; g.aberto = !g.aberto; redesenha(); });
  $$('[data-d]', c).forEach(x => x.onchange = () => { D.G[+x.dataset.d].descricao = C.norm(x.value); });
  $$('[data-u]', c).forEach(x => x.onchange = () => { D.G[+x.dataset.u].unidade = C.norm(x.value) || 'UN'; });
  $$('[data-c]', c).forEach(x => x.onchange = () => { const g = D.G[+x.dataset.c], v = C.norm(x.value); g.codigo = v || null; g.iniflex = D.iniLista.find(y => y.codigo === v) || null; redesenha(); });
  $$('[data-fam]', c).forEach(x => x.onchange = () => { const g = D.G[+x.dataset.fam]; g.familia_id = x.value || null; g.familia = D.fById[x.value]?.codigo || ''; });
  $$('[data-novo]', c).forEach(x => x.onclick = () => { const g = D.G[+x.dataset.novo]; g.produto_id = null; g.sug = null; redesenha(); });
  $$('[data-io]', c).forEach(x => x.onchange = () => { const [i, j] = x.dataset.io.split(':').map(Number); D.G[i].itens[j].on = x.checked; });
  $$('[data-fa]', c).forEach(x => x.onchange = () => { const [i, j] = x.dataset.fa.split(':').map(Number); const v = parseNum(x.value); if (v > 0) D.G[i].itens[j].fator = v; else { toast('Fator tem de ser maior que zero', true); x.value = D.G[i].itens[j].fator; } });
  const ab = $('#cn-ab', c); if (ab) ab.onclick = () => { D.G.forEach(g => { if (g.curva !== 'C' && (g.familia_id || g.nao_estoque)) g.sel = true; }); redesenha(); };
  const vis = $('#cn-vis', c); if (vis) vis.onclick = () => { filtrados().slice(0, ui.ver).forEach(g => { if (g.familia_id || g.nao_estoque || g.produto_id) g.sel = true; }); redesenha(); };
  const lp = $('#cn-limpa', c); if (lp) lp.onclick = () => { D.G.forEach(g => { g.sel = false; }); redesenha(); };
  const gr = $('#cn-grava', c); if (gr) gr.onclick = () => gravar(root);
  $('#cn-regras', c).onclick = () => regras(root);
  $$('[data-cf]', c).forEach(x => x.onclick = () => criarRegraCfop(D.Pron.cfops_sem_regra[+x.dataset.cf], root));
}

async function gravar(root) {
  const sel = D.G.filter(g => g.sel).map(g => ({ ...g, itens: g.itens.filter(i => i.on) })).filter(g => g.itens.length);
  const cods = sel.filter(g => !g.nao_estoque && !g.produto_id && g.codigo).map(g => g.codigo), dup = cods.filter((x, k) => cods.indexOf(x) !== k);
  if (dup.length) return toast(`Código repetido em mais de um produto: ${[...new Set(dup)].join(', ')}`, true);
  const ja = cods.filter(x => D.Pr.some(p => p.codigo === x)); if (ja.length) return toast(`Já existe produto com o código ${ja.join(', ')}. Use "Ligar" ou troque o código.`, true);
  const semFam = sel.filter(g => !g.nao_estoque && !g.produto_id && !g.familia_id);
  if (semFam.length) return toast(`${semFam.length} produto(s) marcado(s) sem família. Escolha a família ou desmarque.`, true);
  const novos = sel.filter(g => !g.nao_estoque && !g.produto_id).length, ligados = sel.filter(g => g.produto_id).length, ne = sel.filter(g => g.nao_estoque).reduce((s, g) => s + g.itens.length, 0);
  const nIt = sel.reduce((s, g) => s + g.itens.length, 0);
  if (!await confirmDialog(`Gravar ${novos} produto(s) novo(s), ligar ${ligados} grupo(s) a produtos existentes e marcar ${ne} item(ns) como não estoque? São ${nIt} de-paras.`)) return;
  try {
    let tot = { produtos: 0, depara: 0, ja_existiam: 0 };
    const P = C.payload(sel);
    for (let k = 0; k < P.length; k += 300) { const r = await q(sb.rpc('est_cadastro_massa', { p_empresa: state.empresa.id, p_grupos: P.slice(k, k + 300) })); for (const x in tot) tot[x] += +r[x] || 0; }
    limparCacheProdutos();
    toast(`${tot.produtos} produto(s) e ${tot.depara} de-para(s) gravados${tot.ja_existiam ? ` · ${tot.ja_existiam} já existiam` : ''}`);
    render(root);
  } catch (e) { fail(e); }
}

function regras(root) {
  const ed = podeEditar(), L = D.K.map(r => ({ ...r }));
  const famOpt = (sel) => D.Fm.map(f => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.nome)}</option>`).join('');
  const corpo = () => `<p class="muted small">A primeira regra que casa (menor ordem) dá a família. Casa quando algum prefixo de NCM bate <b>ou</b> alguma palavra aparece na descrição (sem acento; o espaço conta: " CA " não casa com "CARRO"), e o valor unitário passa do mínimo. Regra sem NCM e sem palavras vale para tudo: deixe-a por último.</p>
    <div class="table-wrap" style="max-height:60vh"><table><tr><th class="num">Ordem</th><th>Família</th><th>NCMs (prefixos)</th><th>Palavras</th><th class="num">Valor unit. mín.</th><th>Ativa</th><th></th></tr>
    ${L.map((r, i) => `<tr><td><input data-r="${i}" data-k="ordem" value="${r.ordem}" style="width:56px;text-align:right" ${ed ? '' : 'disabled'}></td><td><select data-r="${i}" data-k="familia_id" ${ed ? '' : 'disabled'}>${famOpt(r.familia_id)}</select></td>
      <td><textarea data-r="${i}" data-k="ncm_prefixos" rows="2" style="min-width:180px" ${ed ? '' : 'disabled'}>${esc((r.ncm_prefixos || []).join(', '))}</textarea></td>
      <td><textarea data-r="${i}" data-k="palavras" rows="2" style="min-width:220px" ${ed ? '' : 'disabled'}>${esc((r.palavras || []).map(p => /^\s|\s$/.test(p) ? `"${p}"` : p).join(', '))}</textarea><div class="small muted">${esc(r.observacao || '')}</div></td>
      <td><input data-r="${i}" data-k="valor_unit_min" value="${r.valor_unit_min ?? ''}" style="width:80px;text-align:right" ${ed ? '' : 'disabled'}></td>
      <td><input type="checkbox" data-r="${i}" data-k="ativo" ${r.ativo !== false ? 'checked' : ''} ${ed ? '' : 'disabled'}></td><td>${ed ? `<button class="btn small ghost" data-del="${i}">✕</button>` : ''}</td></tr>`).join('')}</table></div>`;
  const md = modal({ title: 'Regras de classificação', wide: true, body: `<div id="rg-c">${corpo()}</div>`,
    foot: ed ? '<button class="btn danger" id="rg-pad">Restaurar as de partida</button><button class="btn" id="rg-add">+ Regra</button><span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="rg-ok">Salvar e reclassificar</button>' : '<span class="spacer"></span><button class="btn" data-close>Fechar</button>' });
  const lerTela = () => $$('[data-r]', md.el).forEach(x => { const r = L[+x.dataset.r], k = x.dataset.k;
    if (k === 'ativo') r.ativo = x.checked; else if (k === 'ordem') r.ordem = +x.value || 0; else if (k === 'valor_unit_min') r.valor_unit_min = x.value.trim() === '' ? null : parseNum(x.value);
    else if (k === 'ncm_prefixos') r.ncm_prefixos = x.value.split(/[\s,;]+/).map(v => v.replace(/\D/g, '')).filter(Boolean);
    else if (k === 'palavras') r.palavras = [...x.value.matchAll(/"([^"]+)"|([^,;]+)/g)].map(m => (m[1] ?? m[2].trim())).filter(v => v.trim());
    else r[k] = x.value; });
  const reabrir = () => { $('#rg-c', md.el).innerHTML = corpo(); $$('[data-del]', md.el).forEach(b => b.onclick = () => { lerTela(); L.splice(+b.dataset.del, 1); reabrir(); }); };
  reabrir();
  if (!ed) return;
  $('#rg-add', md.el).onclick = () => { lerTela(); L.push({ ordem: 150, familia_id: D.Fm.find(f => f.codigo === 'CONSUMO')?.id || D.Fm[0]?.id, ncm_prefixos: [], palavras: [], ativo: true, empresa_id: state.empresa.id }); reabrir(); };
  $('#rg-pad', md.el).onclick = async () => {
    if (!await confirmDialog('Apagar as regras atuais e voltar às de partida?')) return;
    try { await q(sb.rpc('est_cadastro_padrao', { p_empresa: state.empresa.id, p_refazer: true })); md.close(); toast('Regras de partida restauradas'); render(root); } catch (e) { fail(e); }
  };
  $('#rg-ok', md.el).onclick = async () => {
    lerTela();
    try {
      const fora = D.K.filter(r => !L.some(x => x.id === r.id)).map(r => r.id);
      if (fora.length) await q(sb.from('est_classif_regras').delete().in('id', fora));
      for (const r of L) {
        const reg = { empresa_id: state.empresa.id, ordem: r.ordem, familia_id: r.familia_id, ncm_prefixos: r.ncm_prefixos, palavras: r.palavras, valor_unit_min: r.valor_unit_min, ativo: r.ativo !== false, observacao: r.observacao || null };
        if (r.id) await q(sb.from('est_classif_regras').update(reg).eq('id', r.id)); else await q(sb.from('est_classif_regras').insert(reg));
      }
      md.close(); toast('Regras salvas; itens reclassificados'); render(root);
    } catch (e) { fail(e); }
  };
}

function criarRegraCfop(x, root) {
  const compra = D.Tm.filter(t => t.sentido === (x.sentido === 'entrada' ? 'E' : 'S'));
  const md = modal({ title: `Regra para o CFOP ${x.cfop} (${x.sentido})`, narrow: true, body: `<p class="small">${x.itens} item(ns), ${money0(x.valor)}. Ex.: ${esc(x.exemplo || '')}</p><form id="rc"><div class="grid-form">
    <label class="full">O que fazer<select name="tm"><option value="">Não movimenta o estoque</option>${compra.map(t => `<option value="${t.id}" ${t.codigo === 'COMPRA' ? 'selected' : ''}>${esc(t.codigo)} — ${esc(t.nome)}</option>`).join('')}</select></label>
    <label class="full">Vale para<select name="ab"><option value="${x.cfop}">Só o CFOP ${x.cfop}</option><option value="${x.cfop.slice(1)}">Final ${x.cfop.slice(1)} (${['1', '2', '3'].map(d => d + x.cfop.slice(1)).join(', ')})</option></select></label>
    <label class="full">Observação<input name="obs" value="Criada pelo cadastro pelas notas"></label></div></form>`,
    foot: '<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="rc-ok">Criar regra</button>' });
  $('#rc-ok', md.el).onclick = async () => {
    const f = $('#rc', md.el);
    try { await q(sb.from('est_regras_cfop').insert({ empresa_id: state.empresa.id, cfop: f.ab.value, sentido: x.sentido, tipo_movimento_id: f.tm.value || null, prioridade: 100, observacao: f.obs.value.trim() || null }));
      md.close(); toast('Regra criada'); render(root); } catch (e) { fail(e); }
  };
}

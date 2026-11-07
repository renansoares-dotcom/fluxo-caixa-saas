// Pré-impressão (SQL 089) — dados, nova arte (ficha técnica), ficha completa (arte com pinos e comparação de versões,
// checklist, envio ao cliente, aprovação com prova, clicheria, liberação, linha do tempo), certificado de aprovação e parâmetros.
import { sb, state, q, fetchAll, loadCadastros } from './data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, today, dateBR, money, options, parseNum } from './ui.js';
import { abrirRelatorio } from './relatorio.js';
import { carregarProdutos } from './produtos.js';
import * as P from './preimpressao.js';
import { CSS } from './preimpressao-css.js';
import { viewer, prepararArquivo, subirArquivos, linksArte, conferirArquivo, ACEITOS } from './arte-viewer.js';

export const pode = () => ['admin', 'financeiro', 'diretor', 'producao', 'vendas'].includes(state.papel);
export const podeConfig = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
export const podeLiberar = (D) => state.papel === 'admin' || (D?.Pm?.papeis_liberacao || ['admin', 'diretor', 'financeiro']).includes(state.papel);
export const nf = (v, c = 1) => v == null || v === '' ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
export const hora = (t) => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const kb = (b) => b == null ? '' : b > 1048576 ? `${nf(b / 1048576, 1)} MB` : `${nf(b / 1024, 0)} kB`;
export const CLS = { em_criacao: 'info', aguardando_cliente: 'warn', alteracao_solicitada: 'neg', reprovada: 'neg', aprovada: 'pos', na_clicheria: 'info', liberada: 'pos', cancelada: 'muted' };
export const selo = (txt, cls = '') => `<span class="pi-sel ${cls}">${esc(txt)}</span>`;
export const seloSit = (s) => selo(P.SITUACOES[s] || s, CLS[s]);
export const cliTxt = (D, id) => D.fav[id]?.nome || '—';
export const prodTxt = (D, id) => { const p = D.prById[id]; return p ? `${p.codigo} — ${p.descricao}` : ''; };

export { CSS };

/** tudo o que as telas da pré-impressão usam */
export async function carregarArtes({ arquivadas = false } = {}) {
  const e = state.empresa.id; await loadCadastros();
  const seg = (p, v = []) => p.catch(() => v);
  let qp = () => { let x = sb.from('pre_projetos').select('*').eq('empresa_id', e).order('numero', { ascending: false }); if (!arquivadas) x = x.eq('arquivado', false); return x; };
  const [Pm, Pj, Ve, De, Pr, Op, Co] = await Promise.all([
    q(sb.from('pre_parametros').select('*').eq('empresa_id', e)),
    fetchAll(qp),
    fetchAll(() => sb.from('pre_versoes').select('*').eq('empresa_id', e).order('numero')),
    fetchAll(() => sb.from('pre_decisoes').select('*').eq('empresa_id', e).order('criado_em')),
    seg(carregarProdutos()),
    seg(q(sb.from('prod_ordens').select('id,numero,numero_iniflex,produto_id,descricao,cliente,status,entrega').eq('empresa_id', e).in('status', ['planejada', 'liberada', 'em_producao']).order('numero', { ascending: false }).limit(500))),
    seg(q(sb.from('tin_cores').select('id,codigo,nome,hex,referencia').eq('empresa_id', e).eq('ativo', true).order('codigo'))),
  ]);
  const byId = (L) => Object.fromEntries(L.map(x => [x.id, x]));
  const Pp = Pm[0] || { checklist: [], exigir_checklist: true, prazo_cliente_dias: 3, bloquear_op: false, papeis_liberacao: ['admin', 'diretor', 'financeiro'], termo: '' };
  const D = { Pm: Pp, semConfig: !Pm[0], Pj, Ve, De, Pr, Op, Co, pjById: byId(Pj), veById: byId(Ve), prById: byId(Pr), opById: byId(Op), coById: byId(Co), fav: state.cad.favById };
  D.versoesDe = (id) => Ve.filter(v => v.projeto_id === id).sort((a, b) => a.numero - b.numero);
  D.ultima = (id) => D.versoesDe(id).at(-1);
  D.decisoesDe = (id) => De.filter(d => d.projeto_id === id);
  // arte em vigor por produto (mais recente não cancelada) e as OPs abertas que dependem de arte não aprovada
  D.artePorProduto = {};
  for (const p of [...Pj].sort((a, b) => a.criado_em.localeCompare(b.criado_em))) if (p.produto_id && p.situacao !== 'cancelada' && !p.arquivado) D.artePorProduto[p.produto_id] = p;
  D.opsPendentes = Op.filter(o => o.produto_id && D.artePorProduto[o.produto_id] && !P.APROVADAS.includes(D.artePorProduto[o.produto_id].situacao))
    .map(o => ({ ...o, projeto_id: D.artePorProduto[o.produto_id].id }));
  D.clientes = state.cad.favorecidos.filter(f => f.ativo !== false);
  return D;
}

/** linha dos 5 passos da arte */
export function passos(p) {
  const idx = { em_criacao: 0, alteracao_solicitada: 0, reprovada: 0, aguardando_cliente: 1, aprovada: 2, na_clicheria: 3, liberada: 4 }[p.situacao] ?? 0;
  const al = ['alteracao_solicitada', 'reprovada'].includes(p.situacao);
  return `<div class="pi-passos">${['Criação', 'Aprovação do cliente', 'Aprovada', 'Clicheria', 'Liberada'].map((t, i) =>
    `<div class="${p.situacao === 'liberada' || i < idx ? 'feito' : i === idx && p.situacao !== 'cancelada' ? 'atual' + (al ? ' alerta' : '') : ''}">${i === 0 && al ? (p.situacao === 'reprovada' ? 'Reprovada — refazer' : 'Alteração pedida') : t}</div>`).join('')}</div>`;
}

export const coresHtml = (cores = []) => (cores || []).map(c => `<span class="pi-chip-cor"><i style="background:${esc(c.hex || '#ccc')}"></i>${esc(c.pantone || c.nome || '')}</span>`).join('') || '<span class="muted">—</span>';

// ---------------------------------------------------------------- ficha técnica (nova e edição)
function fichaForm(D, p = {}) {
  const tipos = Object.entries(P.TIPOS).map(([k, t]) => `<option value="${k}" ${(p.tipo || 'nova') === k ? 'selected' : ''}>${t}</option>`).join('');
  const procs = Object.entries(P.PROCESSOS).map(([k, t]) => `<option value="${k}" ${(p.processo || 'superficie') === k ? 'selected' : ''}>${t}</option>`).join('');
  const ops = D.Op.filter(o => !p.produto_id || !o.produto_id || o.produto_id === p.produto_id || o.id === p.ordem_id);
  return `<fieldset><legend>Cliente e embalagem</legend><div class="grid-form">
      <label class="c8">Cliente<select name="favorecido_id" required>${options(D.clientes, { label: 'label', selected: p.favorecido_id, empty: 'Escolha o cliente' })}</select></label>
      <label class="c4">Tipo<select name="tipo">${tipos}</select></label>
      <label class="c8">Nome da embalagem<input name="nome" required maxlength="160" value="${esc(p.nome || '')}" placeholder="ex.: Biscoito Maria 200 g — frente"></label>
      <label class="c4">Código no cliente<input name="codigo_cliente" maxlength="60" value="${esc(p.codigo_cliente || '')}"></label>
      <label class="c8">Produto<select name="produto_id">${options(D.Pr.filter(x => x.ativo !== false && ['produto_acabado', 'semiacabado'].includes(x.tipo)), { label: 'descricao', selected: p.produto_id, empty: '— sem produto (arte nova) —' })}</select></label>
      <label class="c4">Ordem de produção<select name="ordem_id"><option value="">—</option>${ops.map(o => `<option value="${o.id}" ${o.id === p.ordem_id ? 'selected' : ''}>OP ${o.numero}${o.numero_iniflex ? ' · ' + esc(o.numero_iniflex) : ''}</option>`).join('')}</select></label>
    </div></fieldset>
    <fieldset><legend>Dados técnicos</legend><div class="grid-form">
      <label class="xs">Largura (mm)<input name="largura_mm" inputmode="decimal" value="${p.largura_mm != null ? nf(p.largura_mm, 2) : ''}"></label>
      <label class="xs">Passo (mm)<input name="altura_mm" inputmode="decimal" value="${p.altura_mm != null ? nf(p.altura_mm, 2) : ''}"></label>
      <label class="xs">Substrato<input name="substrato" maxlength="80" value="${esc(p.substrato || '')}" placeholder="ex.: BOPP 20 µm"></label>
      <label class="xs">Impressão<select name="processo">${procs}</select></label>
      <label class="c4">Código de barras<input name="ean" inputmode="numeric" maxlength="20" value="${esc(p.ean || '')}"><div class="pi-ean" data-ean></div></label>
      <label class="c8">Responsável (arte-finalista)<input name="responsavel" maxlength="80" value="${esc(p.responsavel || '')}"></label>
      <label class="c4">Prazo<input name="prazo" type="date" value="${p.prazo || ''}"></label>
    </div>
    <div style="margin-top:12px"><div class="small muted" style="margin-bottom:6px">Cores (na ordem das estações da impressora)</div><div class="pi-cores" data-cores></div>
      <button type="button" class="btn ghost small" data-cor-add style="margin-top:6px">+ Cor</button></div>
    <div style="margin-top:12px"><div class="small muted" style="margin-bottom:6px">Posição de desbobinamento</div><div class="pi-desb" data-desb>
      ${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button type="button" data-d="${n}" class="${+p.desbobinamento === n ? 'on' : ''}" title="${P.DESBOBINAMENTO[n]}">${P.desbobinamentoSvg(n, { w: 130, h: 64 })}</button>`).join('')}</div></div></fieldset>
    <label class="full">Observação<textarea name="observacao" rows="2" maxlength="1000">${esc(p.observacao || '')}</textarea></label>`;
}
function ligarFicha(D, el, p = {}) {
  let cores = (p.cores || []).map(c => ({ ...c })), desb = p.desbobinamento || null;
  const box = $('[data-cores]', el);
  const pintarCores = () => {
    box.innerHTML = cores.map((c, i) => `<div class="pi-cor" data-i="${i}"><b class="small muted">${i + 1}ª</b>
      <input data-k="pantone" placeholder="Pantone / nome" maxlength="60" value="${esc(c.pantone || c.nome || '')}">
      <select data-k="tin_cor_id"><option value="">— cor da casa de tintas —</option>${D.Co.map(x => `<option value="${x.id}" ${x.id === c.tin_cor_id ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nome)}</option>`).join('')}</select>
      <input type="color" data-k="hex" value="${esc(c.hex || '#888888')}"><button type="button" class="btn ghost small" data-rm title="Tirar">✕</button></div>`).join('') || '<div class="small muted">Nenhuma cor.</div>';
  };
  pintarCores();
  box.oninput = box.onchange = (e) => {
    const r = e.target.closest('[data-i]'); if (!r) return; const c = cores[+r.dataset.i], k = e.target.dataset.k;
    if (!k) return; c[k] = e.target.value || null;
    if (k === 'pantone') c.nome = c.pantone;
    if (k === 'tin_cor_id' && c.tin_cor_id) { const tc = D.coById[c.tin_cor_id]; c.hex = tc?.hex || c.hex; if (!c.pantone) c.pantone = c.nome = tc?.referencia || tc?.nome; pintarCores(); }
  };
  box.onclick = (e) => { const r = e.target.closest('[data-rm]') && e.target.closest('[data-i]'); if (r) { cores.splice(+r.dataset.i, 1); pintarCores(); } };
  $('[data-cor-add]', el).onclick = () => { cores.push({ pantone: '', hex: '#888888' }); pintarCores(); box.querySelector('.pi-cor:last-child input')?.focus(); };
  $('[data-desb]', el).onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; desb = +b.dataset.d === desb ? null : +b.dataset.d; $$('[data-d]', el).forEach(x => x.classList.toggle('on', +x.dataset.d === desb)); };
  const ean = $('[name=ean]', el), msg = $('[data-ean]', el);
  const val = () => { const g = P.gtin(ean.value); msg.className = 'pi-ean ' + (g.vazio ? '' : g.ok ? 'ok' : 'erro'); msg.textContent = g.vazio ? '' : (g.ok ? '✓ ' : '✕ ') + g.msg; };
  ean.oninput = val; val();
  const prod = $('[name=produto_id]', el);
  prod.onchange = () => { const pr = D.prById[prod.value]; const nm = $('[name=nome]', el); if (pr && !nm.value) nm.value = pr.descricao; };
  return () => {
    const f = Object.fromEntries([...el.querySelectorAll('[name]')].map(i => [i.name, i.value.trim()]));
    const g = P.gtin(f.ean);
    if (f.ean && !g.ok) throw new Error('Código de barras: ' + g.msg);
    return { favorecido_id: f.favorecido_id || null, tipo: f.tipo, nome: f.nome, codigo_cliente: f.codigo_cliente || null, produto_id: f.produto_id || null, ordem_id: f.ordem_id || null,
      largura_mm: f.largura_mm ? parseNum(f.largura_mm) : null, altura_mm: f.altura_mm ? parseNum(f.altura_mm) : null, substrato: f.substrato || null, processo: f.processo,
      ean: f.ean || null, responsavel: f.responsavel || null, prazo: f.prazo || null, observacao: f.observacao || null,
      cores: cores.filter(c => c.pantone || c.tin_cor_id).map(c => ({ nome: c.pantone || D.coById[c.tin_cor_id]?.nome, pantone: c.pantone || null, hex: c.hex || null, tin_cor_id: c.tin_cor_id || null })),
      desbobinamento: desb };
  };
}

export function novaArte(D, { onSalvo, base = {} } = {}) {
  const m = modal({ title: 'Nova arte', wide: true, body: `<form id="pi-nf">${fichaForm(D, base)}</form>`, foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pi-nf-ok">Criar e enviar o arquivo</button>` });
  const ler = ligarFicha(D, $('#pi-nf', m.el), base);
  $('#pi-nf-ok', m.el).onclick = async (ev) => {
    let d; try { d = ler(); } catch (e) { return toast(e.message, true); }
    if (!d.favorecido_id || !d.nome) return toast('Informe o cliente e o nome da embalagem', true);
    ev.target.disabled = true;
    try { const [p] = await q(sb.from('pre_projetos').insert({ empresa_id: state.empresa.id, ...d }).select()); m.close(); toast(`Arte nº ${p.numero} criada`); onSalvo?.(p); }
    catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ---------------------------------------------------------------- nova versão (upload)
export function novaVersao(D, p, { onSalvo } = {}) {
  const ult = D.ultima(p.id);
  const m = modal({ title: `Arte nº ${p.numero} — versão ${(ult?.numero || 0) + 1}`, body: `
    <div class="pi-drop" id="pi-dz"><b>Arraste o arquivo da arte aqui</b><div class="small muted">ou clique para escolher · PDF (recomendado), PNG ou JPG até 50 MB · AI/EPS/TIFF entram sem prévia</div><input type="file" id="pi-f" accept="${ACEITOS}" hidden></div>
    <div id="pi-pv"></div>
    <label style="margin-top:12px">O que mudou nesta versão<textarea id="pi-obs" rows="2" maxlength="600" placeholder="${ult ? 'ex.: troca do nome do produto, ajuste da tabela nutricional' : 'ex.: primeira proposta'}"></textarea></label>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pi-v-ok" disabled>Salvar versão</button>` });
  let arq = null, prep = null;
  const dz = $('#pi-dz', m.el), fi = $('#pi-f', m.el);
  dz.onclick = () => fi.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('sobre'); }; dz.ondragleave = () => dz.classList.remove('sobre');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('sobre'); if (e.dataTransfer.files[0]) ler(e.dataTransfer.files[0]); };
  fi.onchange = () => fi.files[0] && ler(fi.files[0]);
  async function ler(f) {
    arq = f; prep = null; $('#pi-v-ok', m.el).disabled = true;
    $('#pi-pv', m.el).innerHTML = '<div class="loading">Lendo o arquivo, calculando o SHA-256 e gerando a prévia…</div>';
    try { prep = await prepararArquivo(f); } catch (err) { $('#pi-pv', m.el).innerHTML = ''; return fail(err); }
    const med = prep.previa ? P.confereMedidas(prep.previa, p) : null, url = prep.previa ? URL.createObjectURL(prep.previa.blob) : null;
    $('#pi-pv', m.el).innerHTML = `<div class="pi-prev">${url ? `<img src="${url}" alt="">` : '<div class="pi-drop" style="cursor:default">Sem prévia para este formato</div>'}<div class="small">
      <div><b>${esc(f.name)}</b> · ${kb(f.size)}${prep.previa?.paginas > 1 ? ` · ${prep.previa.paginas} páginas (a prévia usa a 1ª)` : ''}</div>
      ${prep.previa?.mmLargura ? `<div style="margin-top:6px">Página do PDF: <b>${nf(prep.previa.mmLargura, 1)} × ${nf(prep.previa.mmAltura, 1)} mm</b>
        ${med ? (med.ok ? `<span class="pi-sel pos">confere com a ficha${med.girada ? ' (girada)' : ''}</span>` : `<span class="pi-sel warn">ficha: ${nf(p.largura_mm)} × ${nf(p.altura_mm)} mm</span>`) : ''}</div>` : ''}
      ${!prep.previa ? '<div class="pi-sel warn" style="margin-top:6px">Sem prévia o cliente não consegue ver nem aprovar no portal: envie também o PDF.</div>' : ''}
      <div style="margin-top:8px" class="muted">Impressão digital do arquivo (SHA-256)</div><div class="pi-hash">${prep.hash}</div>
      ${D.Ve.some(v => v.projeto_id === p.id && v.hash === prep.hash) ? '<div class="pi-sel warn" style="margin-top:6px">Este arquivo é idêntico a uma versão já enviada.</div>' : ''}</div></div>`;
    $('#pi-v-ok', m.el).disabled = false;
  }
  $('#pi-v-ok', m.el).onclick = async (ev) => {
    if (!arq || !prep) return; ev.target.disabled = true; ev.target.textContent = 'Enviando…';
    try {
      const c = await subirArquivos(sb, p, arq, prep);
      const [v] = await q(sb.from('pre_versoes').insert({ empresa_id: p.empresa_id, projeto_id: p.id, caminho: c.caminho, nome: arq.name, tipo: arq.type || null, tamanho: arq.size, hash: prep.hash,
        previa: c.previa, previa_largura: prep.previa?.largura || null, previa_altura: prep.previa?.altura || null, paginas: prep.previa?.paginas || null,
        mm_largura: prep.previa?.mmLargura ? Math.round(prep.previa.mmLargura * 10) / 10 : null, mm_altura: prep.previa?.mmAltura ? Math.round(prep.previa.mmAltura * 10) / 10 : null,
        observacao: $('#pi-obs', m.el).value.trim() || null }).select());
      m.close(); toast(`Versão ${v.numero} salva. Confira o checklist e envie ao cliente.`); onSalvo?.(v);
    } catch (err) { fail(err); ev.target.disabled = false; ev.target.textContent = 'Salvar versão'; }
  };
}

// ---------------------------------------------------------------- ficha completa
const ABAS = [['arte', 'Arte'], ['ficha', 'Ficha técnica'], ['aprovacao', 'Aprovação'], ['clicheria', 'Clicheria e produção'], ['historico', 'Linha do tempo']];

export async function fichaArte(D, p0, { onMudou, aba = 'arte', versao = null } = {}) {
  if (!p0) return;
  let p = p0, Co = [], Ev = [], vw = null, sel = versao, comp = '', marca = null;
  const st = { aba };
  const m = modal({ title: `Arte nº ${p.numero} — ${p.nome}`, wide: true, body: '<div class="loading">Carregando…</div>' });
  m.el.querySelector('.modal').style.maxWidth = 'min(1380px, 97vw)';
  const fechar = m.close; m.close = () => { vw?.destruir(); fechar(); };
  m.el.addEventListener('click', (e) => { if (e.target === m.el || e.target.closest('.modal-head [data-close]')) vw?.destruir(); });
  async function recarregar(silencioso) {
    const ids = D.versoesDe(p.id).map(v => v.id);
    [Co, Ev] = await Promise.all([ids.length ? q(sb.from('pre_comentarios').select('*').in('versao_id', ids).order('criado_em')) : [], q(sb.from('pre_eventos').select('*').eq('projeto_id', p.id).order('criado_em'))]);
    if (!silencioso) pintar();
  }
  const atualizar = async () => {   // depois de uma ação: relê o projeto, as versões e as decisões
    const [[np], Vs, Ds] = await Promise.all([q(sb.from('pre_projetos').select('*').eq('id', p.id)), q(sb.from('pre_versoes').select('*').eq('projeto_id', p.id).order('numero')), q(sb.from('pre_decisoes').select('*').eq('projeto_id', p.id).order('criado_em'))]);
    p = np; Object.assign(D.pjById, { [p.id]: p }); const i = D.Pj.findIndex(x => x.id === p.id); if (i >= 0) D.Pj[i] = p; else D.Pj.unshift(p);
    D.Ve = D.Ve.filter(v => v.projeto_id !== p.id).concat(Vs); Vs.forEach(v => D.veById[v.id] = v);
    D.De = D.De.filter(d => d.projeto_id !== p.id).concat(Ds);
    await recarregar(); onMudou?.({ silencioso: true });
  };
  const acao = (fn, msg) => async (ev) => { const b = ev?.target; if (b) b.disabled = true; try { await fn(); if (msg) toast(msg); await atualizar(); } catch (err) { fail(err); if (b) b.disabled = false; } };

  function pintar() {
    vw?.destruir(); vw = null;
    const Vs = D.versoesDe(p.id), ds = D.decisoesDe(p.id), rod = P.rodadas(p, D.Ve);
    const atr = p.situacao === 'aguardando_cliente' && p.prazo && p.prazo < today();
    m.el.querySelector('.modal-head h2').textContent = `Arte nº ${p.numero} — ${p.nome}`;
    $('.modal-body', m.el).innerHTML = `${passos(p)}
      <div class="pi-dados" style="margin-bottom:12px">
        <div class="w2"><span>Cliente</span>${esc(cliTxt(D, p.favorecido_id))}${p.codigo_cliente ? ` · <span class="muted">${esc(p.codigo_cliente)}</span>` : ''}</div>
        <div><span>Situação</span>${seloSit(p.situacao)}${p.arquivado ? ' ' + selo('Arquivada', 'muted') : ''}</div>
        <div><span>${p.situacao === 'aguardando_cliente' ? 'Resposta até' : 'Prazo'}</span>${p.prazo ? `<span class="${atr ? 'neg' : ''}">${dateBR(p.prazo)}</span>` : '—'}</div>
        <div class="w2"><span>Produto</span>${esc(prodTxt(D, p.produto_id)) || '<span class="muted">sem produto</span>'}${p.ordem_id && D.opById[p.ordem_id] ? ` · OP ${D.opById[p.ordem_id].numero}` : ''}</div>
        <div><span>Versões / rodadas</span>${Vs.length} · ${rod} enviada(s) ao cliente</div>
        <div><span>Cores</span>${(p.cores || []).length || '—'}${p.desbobinamento ? ` · desbob. ${p.desbobinamento}` : ''}</div></div>
      <div class="chips tabs" id="pi-abas" style="margin-bottom:12px">${ABAS.map(([k, t]) => `<span class="chip ${st.aba === k ? 'on' : ''}" data-a="${k}">${t}${k === 'aprovacao' && ds.length ? ` (${ds.length})` : ''}</span>`).join('')}</div>
      <div id="pi-aba"></div>`;
    $('#pi-abas', m.el).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { st.aba = a; pintar(); } };
    ({ arte: abaArte, ficha: abaFicha, aprovacao: abaAprovacao, clicheria: abaClicheria, historico: abaHistorico })[st.aba]($('#pi-aba', m.el));
  }

  // ---- aba Arte
  async function abaArte(el) {
    const Vs = D.versoesDe(p.id), ok = pode() && !p.arquivado && !['cancelada', 'liberada'].includes(p.situacao);
    if (!Vs.length) {
      el.innerHTML = `<div class="pi-drop" style="cursor:${ok ? 'pointer' : 'default'}" id="pi-sem"><b>Nenhuma versão ainda</b><div class="small muted">${ok ? 'Clique para enviar o arquivo da primeira versão.' : 'Aguardando a equipe de pré-impressão.'}</div></div>`;
      ok && ($('#pi-sem', el).onclick = () => novaVersao(D, p, { onSalvo: (v) => { sel = v.id; atualizar(); } })); return;
    }
    const v = Vs.find(x => x.id === sel) || Vs.at(-1); sel = v.id;
    const vc = comp && Vs.find(x => x.id === comp && x.id !== v.id);
    const ult = Vs.at(-1), meus = Co.filter(c => c.versao_id === v.id);
    const nume = meus.map((c, i) => ({ ...c, n: i + 1 }));
    const med = P.confereMedidas({ mmLargura: v.mm_largura, mmAltura: v.mm_altura }, p);
    const decV = D.decisoesDe(p.id).filter(d => d.versao_id === v.id);
    const checklist = v.checklist || [], falta = P.faltaChecklist(checklist), podeEnviar = ok && v.id === ult.id && !v.enviada_em && !['na_clicheria'].includes(p.situacao);
    el.innerHTML = `<div class="pi-arte"><div>
        <div class="pi-vers">${Vs.map(x => `<span class="chip ${x.id === v.id ? 'on' : ''} ${x.id === p.versao_aprovada_id ? 'ap' : ''}" data-v="${x.id}" title="${esc(x.observacao || '')}"><b>V${x.numero}</b>${x.origem === 'cliente' ? ' · do cliente' : ''}${x.id === p.versao_aprovada_id ? ' ✓' : !x.enviada_em && x.origem !== 'cliente' ? ' · rascunho' : ''}</span>`).join('')}
          ${Vs.length > 1 ? `<span class="spacer"></span><label class="small" style="display:flex;flex-direction:row;gap:6px;align-items:center">Comparar com<select id="pi-cmp" style="width:auto"><option value="">—</option>${Vs.filter(x => x.id !== v.id && x.previa).map(x => `<option value="${x.id}" ${x.id === comp ? 'selected' : ''}>V${x.numero}</option>`).join('')}</select></label>` : ''}
          ${ok ? '<button class="btn small" id="pi-nv">+ Nova versão</button>' : ''}</div>
        <div id="pi-vw">${v.previa ? '' : '<div class="pi-drop" style="cursor:default;height:300px;display:flex;align-items:center;justify-content:center">Esta versão não tem prévia (formato sem visualização). Baixe o original.</div>'}</div></div>
      <aside class="pi-lado">
        <div class="pi-bloco"><h3>Versão ${v.numero} ${v.origem === 'cliente' ? selo('enviada pelo cliente', 'info') : v.enviada_em ? selo('enviada ao cliente', 'warn') : selo('rascunho interno', 'muted')} ${v.id === p.versao_aprovada_id ? selo('APROVADA', 'pos') : ''}</h3>
          <div class="small">${esc(v.nome)} · ${kb(v.tamanho)}${v.paginas > 1 ? ` · ${v.paginas} pág.` : ''}</div>
          <div class="small muted">${hora(v.criado_em)} · ${esc(v.enviado_por || '')}${v.enviada_em ? ` · ao cliente em ${hora(v.enviada_em)}` : ''}</div>
          ${v.observacao ? `<div class="small" style="margin-top:4px">“${esc(v.observacao)}”</div>` : ''}
          ${v.mm_largura ? `<div class="small" style="margin-top:4px">PDF ${nf(v.mm_largura)} × ${nf(v.mm_altura)} mm ${med ? (med.ok ? selo('medidas conferem', 'pos') : selo(`ficha ${nf(p.largura_mm)} × ${nf(p.altura_mm)}`, 'warn')) : ''}</div>` : ''}
          <div class="pi-hash" style="margin-top:4px" title="${v.hash}">SHA-256 ${P.hashCurto(v.hash)}</div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn ghost small" id="pi-baixar">Baixar original</button><button class="btn ghost small" id="pi-conf" title="Baixa o arquivo e recalcula o SHA-256">Conferir integridade</button></div>
          ${decV.map(d => `<div class="small" style="margin-top:6px">${selo(P.DECISOES[d.decisao], d.decisao === 'aprovada' ? 'pos' : 'neg')} ${esc(d.nome || '')} · ${hora(d.criado_em)}</div>`).join('')}</div>
        ${podeEnviar ? `<div class="pi-bloco"><h3>Checklist de pré-impressão ${falta ? selo(`faltam ${falta}`, 'warn') : selo('completo', 'pos')}</h3>
          <div id="pi-ck">${checklist.map((c, i) => `<label class="chk"><input type="checkbox" data-ck="${i}" ${c.ok ? 'checked' : ''}> ${esc(c.item)}</label>`).join('') || '<div class="small muted">Sem itens (configure nos parâmetros).</div>'}</div>
          <button class="btn primary" id="pi-env" style="width:100%;margin-top:8px" ${falta && D.Pm.exigir_checklist ? 'disabled' : ''}>Enviar ao cliente para aprovação</button>
          <div class="small muted" style="margin-top:4px">O cliente vê no Portal, marca pinos, aprova com assinatura ou pede alteração. Prazo: ${D.Pm.prazo_cliente_dias} dia(s).</div></div>` : ''}
        <div class="pi-bloco"><h3>Comentários da V${v.numero} (${meus.length})</h3><div id="pi-cl">${nume.map(c => `<div class="pi-com ${c.resolvido ? 'ok' : ''}" data-c="${c.id}">
            <span class="n ${c.x == null ? 'ger' : c.interno ? 'int' : c.origem === 'cliente' ? '' : 'eq'}">${c.x == null ? '•' : c.n}</span><div style="min-width:0;flex:1"><div class="t">${esc(c.texto)}</div>
            <div class="q">${c.origem === 'cliente' ? '👤 Cliente' : c.interno ? '🔒 Nota interna' : 'Equipe'} · ${esc(c.autor || '')} · ${hora(c.criado_em)}</div></div>
            ${pode() ? `<button class="btn ghost small" data-res="${c.id}" title="${c.resolvido ? 'Reabrir' : 'Marcar como resolvido'}">${c.resolvido ? '↺' : '✓'}</button>` : ''}</div>`).join('') || '<div class="small muted">Nenhum comentário. Use 📍 Marcar na arte para apontar um ponto.</div>'}</div>
          ${pode() && !p.arquivado ? `<div style="margin-top:8px"><div class="small muted" id="pi-pin">${marca ? `📍 Ponto marcado (${Math.round(marca.x * 100)}%, ${Math.round(marca.y * 100)}%) — <a href="#" id="pi-pin-x">tirar</a>` : 'Comentário geral (ou marque um ponto na arte)'}</div>
            <textarea id="pi-ct" rows="2" maxlength="2000" placeholder="Escreva o comentário"></textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><label class="chk"><input type="checkbox" id="pi-int" checked> Nota interna (o cliente não vê)</label><button class="btn small" id="pi-cs">Comentar</button></div></div>` : ''}</div>
      </aside></div>`;
    $$('[data-v]', el).forEach(c => c.onclick = () => { sel = c.dataset.v; if (comp === sel) comp = ''; marca = null; pintar(); });
    $('#pi-cmp', el) && ($('#pi-cmp', el).onchange = (e) => { comp = e.target.value; pintar(); });
    $('#pi-nv', el) && ($('#pi-nv', el).onclick = () => novaVersao(D, p, { onSalvo: (nv) => { sel = nv.id; comp = v.id; atualizar(); } }));
    $('#pi-baixar', el).onclick = async () => { try { const { data, error } = await sb.storage.from('artes').createSignedUrl(v.caminho, 300, { download: v.nome }); if (error) throw error; window.open(data.signedUrl, '_blank'); } catch (e) { fail(e); } };
    $('#pi-conf', el).onclick = async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Conferindo…';
      try { const r = await conferirArquivo(sb, v.caminho, v.hash); r.ok ? toast('✓ Arquivo íntegro: o SHA-256 é o mesmo registrado na versão.') : toast('ATENÇÃO: o arquivo armazenado não confere com o registrado.', true); } catch (e) { fail(e); }
      ev.target.disabled = false; ev.target.textContent = 'Conferir integridade'; };
    $('#pi-ck', el) && ($('#pi-ck', el).onchange = async (e) => {
      const i = +e.target.dataset.ck; const ck = checklist.map((c, j) => j === i ? { ...c, ok: e.target.checked } : c);
      try { await q(sb.from('pre_versoes').update({ checklist: ck }).eq('id', v.id)); v.checklist = ck; const f = P.faltaChecklist(ck);
        $('#pi-env', el).disabled = !!(f && D.Pm.exigir_checklist); el.querySelector('.pi-bloco:nth-child(2) h3 .pi-sel').outerHTML = f ? selo(`faltam ${f}`, 'warn') : selo('completo', 'pos'); } catch (err) { fail(err); e.target.checked = !e.target.checked; }
    });
    $('#pi-env', el) && ($('#pi-env', el).onclick = acao(() => q(sb.rpc('pre_enviar_cliente', { p_versao: v.id })), `Versão ${v.numero} enviada ao cliente`));
    $('#pi-cl', el).onclick = async (e) => {
      const r = e.target.closest('[data-res]');
      if (r) { const c = Co.find(x => x.id === r.dataset.res); try { await q(sb.from('pre_comentarios').update({ resolvido: !c.resolvido }).eq('id', c.id)); await recarregar(); } catch (err) { fail(err); } return; }
      const c = e.target.closest('[data-c]'); if (c && vw) vw.centrar(c.dataset.c);
    };
    $('#pi-pin-x', el) && ($('#pi-pin-x', el).onclick = (e) => { e.preventDefault(); marca = null; pintar(); });
    $('#pi-cs', el) && ($('#pi-cs', el).onclick = async (ev) => {
      const t = $('#pi-ct', el).value.trim(); if (!t) return toast('Escreva o comentário', true);
      ev.target.disabled = true;
      try { await q(sb.from('pre_comentarios').insert({ empresa_id: p.empresa_id, versao_id: v.id, x: marca?.x ?? null, y: marca?.y ?? null, texto: t, interno: $('#pi-int', el).checked }));
        marca = null; await recarregar(); } catch (err) { fail(err); ev.target.disabled = false; }
    });
    if (!v.previa) return;
    const caminhos = [v.previa, vc?.previa].filter(Boolean);
    let U; try { U = await linksArte(sb, caminhos); } catch (err) { $('#pi-vw', el).innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    vw = viewer($('#pi-vw', el), {
      a: { url: U[v.previa], rotulo: `V${v.numero}` }, b: vc ? { url: U[vc.previa], rotulo: `V${vc.numero}` } : null, modo: 'cortina',
      pinos: nume.map(c => ({ id: c.id, n: c.n, x: c.x == null ? null : +c.x, y: c.y == null ? null : +c.y, texto: c.texto, classe: c.resolvido ? 'ok' : c.interno ? 'int' : c.origem === 'cliente' ? '' : 'eq' })),
      podeMarcar: pode() && !p.arquivado,
      onMarcar: (x, y) => { marca = { x, y }; const s = $('#pi-pin', el); if (s) s.innerHTML = `📍 Ponto marcado (${Math.round(x * 100)}%, ${Math.round(y * 100)}%) — escreva o comentário`; vw.marcar(false); $('#pi-ct', el)?.focus(); },
      onPino: (pi) => { $$('.pi-com', el).forEach(x => x.style.background = x.dataset.c === pi.id ? 'var(--primary-soft)' : ''); el.querySelector(`[data-c="${pi.id}"]`)?.scrollIntoView({ block: 'nearest' }); },
    });
  }

  // ---- aba Ficha técnica
  function abaFicha(el) {
    const ed = pode() && !p.arquivado && p.situacao !== 'cancelada';
    if (!ed) {
      el.innerHTML = `<div class="pi-dados">${[['Tipo', P.TIPOS[p.tipo]], ['Impressão', P.PROCESSOS[p.processo]], ['Largura × passo', p.largura_mm ? `${nf(p.largura_mm, 2)} × ${nf(p.altura_mm, 2)} mm` : '—'], ['Substrato', p.substrato || '—'],
        ['Código de barras', p.ean ? `${p.ean} ${P.gtin(p.ean).ok ? '✓' : '✕'}` : '—'], ['Responsável', p.responsavel || '—'], ['Criada', hora(p.criado_em)], ['Por', p.criado_por || '']].map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}
        <div class="w2"><span>Cores</span>${coresHtml(p.cores)}</div><div class="w2"><span>Desbobinamento</span>${p.desbobinamento ? P.desbobinamentoSvg(p.desbobinamento) + `<div class="small">${P.DESBOBINAMENTO[p.desbobinamento]}</div>` : '—'}</div></div>`;
      return;
    }
    el.innerHTML = `<form id="pi-ef">${fichaForm(D, p)}</form>
      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:8px"><div style="display:flex;gap:8px">
        ${p.situacao !== 'liberada' ? '<button class="btn ghost" id="pi-canc">Cancelar a arte</button>' : ''}
        <button class="btn ghost" id="pi-arq">${p.arquivado ? 'Restaurar' : 'Arquivar'}</button>
        ${['aprovada', 'na_clicheria', 'liberada'].includes(p.situacao) ? '<button class="btn ghost" id="pi-dup" title="Nova arte (alteração) a partir desta ficha">Duplicar como alteração</button>' : ''}</div>
        <button class="btn primary" id="pi-es">Salvar a ficha</button></div>`;
    const ler = ligarFicha(D, $('#pi-ef', el), p);
    $('#pi-es', el).onclick = acao(async () => { await q(sb.from('pre_projetos').update(ler()).eq('id', p.id)); }, 'Ficha salva');
    $('#pi-canc', el) && ($('#pi-canc', el).onclick = () => {
      const mm = modal({ title: `Cancelar a arte nº ${p.numero}`, narrow: true, body: '<label>Motivo<input id="pi-mo" maxlength="300" placeholder="ex.: cliente desistiu do produto"></label>', foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="pi-mo-ok">Cancelar a arte</button>' });
      $('#pi-mo-ok', mm.el).onclick = acao(async () => { const mo = $('#pi-mo', mm.el).value.trim(); if (!mo) throw new Error('Informe o motivo'); await q(sb.from('pre_projetos').update({ situacao: 'cancelada', motivo: mo }).eq('id', p.id)); mm.close(); }, 'Arte cancelada');
    });
    $('#pi-arq', el).onclick = acao(() => q(sb.from('pre_projetos').update({ arquivado: !p.arquivado }).eq('id', p.id)), p.arquivado ? 'Arte restaurada' : 'Arte arquivada');
    $('#pi-dup', el) && ($('#pi-dup', el).onclick = () => novaArte(D, { base: { ...p, tipo: 'alteracao', ordem_id: null, prazo: null, observacao: `Alteração da arte nº ${p.numero}` }, onSalvo: (np) => { D.Pj.unshift(np); m.close(); fichaArte(D, np, { onMudou }); onMudou?.({ silencioso: true }); } }));
  }

  // ---- aba Aprovação
  function abaAprovacao(el) {
    const ds = D.decisoesDe(p.id).sort((a, b) => b.criado_em.localeCompare(a.criado_em)), ult = D.ultima(p.id);
    const reg = podeLiberar(D) && p.situacao === 'aguardando_cliente' && ult?.enviada_em;
    el.innerHTML = `${reg ? `<div class="card" style="margin-bottom:12px;border-left:4px solid var(--warn)"><b>O cliente respondeu por e-mail ou mensagem?</b><div class="small muted">Registre a decisão com a evidência (cópia do e-mail ou da conversa). A prova fica com a versão ${ult.numero} (SHA-256 ${P.hashCurto(ult.hash)}).</div>
        <div class="grid-form" style="margin-top:8px"><label class="xs">Decisão<select id="pi-rd">${Object.entries(P.DECISOES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
          <label class="c4">Quem decidiu (nome completo)<input id="pi-rn" maxlength="120"></label><label class="span2">Comentário<input id="pi-rc" maxlength="500"></label>
          <label class="full">Evidência (cole o e-mail ou a mensagem, com data e remetente)<textarea id="pi-re" rows="3" maxlength="4000"></textarea></label></div>
        <div style="text-align:right;margin-top:8px"><button class="btn primary" id="pi-rg">Registrar decisão</button></div></div>` : ''}
      <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Versão</th><th>Decisão</th><th>Quem</th><th>Origem e prova</th><th></th></tr></thead><tbody>
        ${ds.map(d => { const v = D.veById[d.versao_id]; return `<tr><td>${hora(d.criado_em)}</td><td>V${v?.numero ?? '?'}</td><td>${selo(P.DECISOES[d.decisao], d.decisao === 'aprovada' ? 'pos' : 'neg')}${d.comentario ? `<div class="small wrap">${esc(d.comentario)}</div>` : ''}</td>
          <td>${esc(d.nome || '—')}<div class="small muted">${esc(d.email || '')}</div></td>
          <td class="small">${d.origem === 'cliente' ? 'Portal do Cliente' : 'Registrada pela equipe'}${d.ip ? ` · IP ${esc(d.ip)}` : ''}<div class="pi-hash" title="${d.hash}">SHA-256 ${P.hashCurto(d.hash)}${v && v.hash === d.hash ? ' ✓' : ' ✕ não confere'}</div>${d.evidencia ? `<div class="muted wrap">${esc(d.evidencia.slice(0, 140))}${d.evidencia.length > 140 ? '…' : ''}</div>` : ''}</td>
          <td>${d.decisao === 'aprovada' ? `<button class="btn ghost small" data-cert="${d.id}">Certificado</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Nenhuma decisão ainda. Envie uma versão ao cliente pela aba Arte.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">A aprovação no portal guarda o nome digitado, o usuário, a data e a hora, o IP, o navegador, o termo aceito e o SHA-256 do arquivo aprovado. Qualquer mudança no arquivo muda o SHA-256: a aprovação vale só para aquele arquivo.</p>`;
    $('#pi-rg', el) && ($('#pi-rg', el).onclick = acao(async () => {
      await q(sb.rpc('pre_registrar_decisao', { p_versao: ult.id, p_decisao: $('#pi-rd', el).value, p_comentario: $('#pi-rc', el).value.trim() || null, p_nome: $('#pi-rn', el).value.trim() || null, p_evidencia: $('#pi-re', el).value.trim() || null }));
    }, 'Decisão registrada'));
    $$('[data-cert]', el).forEach(b => b.onclick = () => certificado(D, p, D.De.find(d => d.id === b.dataset.cert)));
  }

  // ---- aba Clicheria e produção
  function abaClicheria(el) {
    const ap = p.versao_aprovada_id && D.veById[p.versao_aprovada_id], ok = pode() && !p.arquivado;
    const ops = D.Op.filter(o => p.produto_id && o.produto_id === p.produto_id), lib = podeLiberar(D);
    const forn = state.cad.favorecidos.filter(f => f.ativo !== false);
    el.innerHTML = `<div class="grid2">
      <div class="card"><h2>Clicheria</h2>
        ${!ap ? '<div class="empty">A arte vai para a clicheria depois de aprovada pelo cliente.</div>' : `
        <div class="pi-dados" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><span>Versão aprovada</span>V${ap.numero} · ${esc(ap.nome)}</div><div><span>SHA-256</span><span class="pi-hash">${P.hashCurto(ap.hash)}</span></div>
          <div><span>Clicheria</span>${esc(p.clicheria_id ? cliTxt(D, p.clicheria_id) : '—')}</div><div><span>Enviada / previsão</span>${dateBR(p.cliche_enviado_em) || '—'}${p.cliche_previsto ? ' → ' + dateBR(p.cliche_previsto) : ''}</div>
          <div><span>Recebida</span>${dateBR(p.cliche_recebido_em) || '—'}</div><div><span>Custo / clichês</span>${p.cliche_custo != null ? money(p.cliche_custo) : '—'} · ${p.cliche_qtd ?? (p.cores || []).length} un.</div>
          ${p.ferramenta_id ? '<div class="w2"><span>Ferramenta</span>Clichê cadastrado em Produção › Cadastros (ferramentas), com o código CL-' + String(p.numero).padStart(4, '0') + '</div>' : ''}</div>
        ${ok && p.situacao === 'aprovada' ? `<div class="grid-form" style="margin-top:12px"><label class="c8">Clicheria (fornecedor)<select id="pi-cf">${options(forn, { label: 'label', selected: p.clicheria_id, empty: '—' })}</select></label>
            <label class="c4">Envio<input type="date" id="pi-ce" value="${today()}"></label><label class="c4">Previsão<input type="date" id="pi-cp"></label><label class="c4">Custo (R$)<input id="pi-cc" inputmode="decimal"></label>
            <label class="c4">Nº de clichês<input id="pi-cq" inputmode="numeric" value="${(p.cores || []).length || ''}"></label></div>
          <div style="display:flex;justify-content:space-between;margin-top:8px"><button class="btn ghost" id="pi-direto" ${lib ? '' : 'disabled title="Seu perfil não libera"'}>Liberar sem clicheria (reimpressão)</button><button class="btn primary" id="pi-cenv">Enviar para a clicheria</button></div>` : ''}
        ${ok && p.situacao === 'na_clicheria' && !p.cliche_recebido_em ? `<div class="grid-form" style="margin-top:12px"><label class="c4">Recebido em<input type="date" id="pi-cr" value="${today()}"></label><label class="c4">Custo final (R$)<input id="pi-cc2" inputmode="decimal" value="${p.cliche_custo != null ? nf(p.cliche_custo, 2) : ''}"></label></div>
          <label class="chk" style="margin-top:8px"><input type="checkbox" id="pi-cfer" checked> Cadastrar o clichê nas ferramentas da produção (para apontar o uso e a vida útil)</label>
          <div style="text-align:right;margin-top:8px"><button class="btn primary" id="pi-crec">Registrar o recebimento</button></div>` : ''}`}
      </div>
      <div class="card"><h2>Produção</h2>
        ${p.situacao === 'liberada' ? `<div>${selo('Liberada para produção', 'pos')} em ${hora(p.liberada_em)} por ${esc(p.liberada_por || '')}</div>` :
          ['aprovada', 'na_clicheria'].includes(p.situacao) ? `<p class="small">Depois de aprovada${p.situacao === 'na_clicheria' ? ' e com os clichês recebidos' : ''}, libere a arte para a produção.</p>
            <button class="btn primary" id="pi-lib" ${lib && (p.situacao === 'aprovada' || p.cliche_recebido_em) ? '' : 'disabled'}>Liberar para produção</button>${lib ? '' : '<div class="small muted">Seu perfil não libera (Parâmetros).</div>'}` :
          '<div class="empty">A liberação vem depois da aprovação do cliente.</div>'}
        <h3 style="margin:16px 0 6px;font-size:13px">OPs do produto ${D.Pm.bloquear_op ? selo('trava ligada: OP não inicia sem arte aprovada', 'info') : selo('trava desligada', 'muted')}</h3>
        ${!p.produto_id ? '<div class="small muted">Ligue a arte a um produto (Ficha técnica) para ver as OPs.</div>' : `<div class="table-wrap"><table><thead><tr><th>OP</th><th>Situação</th><th>Entrega</th></tr></thead><tbody>${ops.map(o => `<tr><td>OP ${o.numero}</td><td>${esc(o.status)}</td><td>${dateBR(o.entrega) || '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhuma OP aberta.</td></tr>'}</tbody></table></div>`}
      </div></div>`;
    const num = (id) => { const v = $(id, el)?.value.trim(); return v ? parseNum(v) : null; };
    $('#pi-cenv', el) && ($('#pi-cenv', el).onclick = acao(() => q(sb.rpc('pre_clicheria', { p_projeto: p.id, p_acao: 'enviar', p_fornecedor: $('#pi-cf', el).value || null, p_data: $('#pi-ce', el).value || null, p_previsto: $('#pi-cp', el).value || null, p_custo: num('#pi-cc'), p_qtd: num('#pi-cq') })), 'Enviada para a clicheria'));
    $('#pi-crec', el) && ($('#pi-crec', el).onclick = acao(() => q(sb.rpc('pre_clicheria', { p_projeto: p.id, p_acao: 'receber', p_data: $('#pi-cr', el).value || null, p_custo: num('#pi-cc2'), p_criar_ferramenta: $('#pi-cfer', el).checked })), 'Clichês recebidos'));
    const liberar = acao(() => q(sb.rpc('pre_liberar', { p_projeto: p.id })), 'Arte liberada para produção');
    $('#pi-lib', el) && ($('#pi-lib', el).onclick = liberar);
    $('#pi-direto', el) && ($('#pi-direto', el).onclick = async (e) => { if (await confirmDialog('Liberar sem passar pela clicheria? Use quando os clichês já existem (reimpressão sem mudança).')) liberar(e); });
  }

  // ---- aba Linha do tempo
  function abaHistorico(el) {
    el.innerHTML = `<div class="pi-tl">${[...Ev].reverse().map(e => `<div class="${e.publico ? '' : 'int'}">${esc(e.texto)}<small>${hora(e.criado_em)} · ${esc(e.autor || '')}${e.publico ? '' : ' · interno'}</small></div>`).join('') || '<div class="muted">Sem eventos.</div>'}</div>
      <p class="small muted">Os eventos com ponto azul aparecem também para o cliente no Portal.</p>`;
  }

  try { await recarregar(); } catch (err) { fail(err); m.close(); }
}

// ---------------------------------------------------------------- certificado de aprovação
let qrLib = null;
async function qr() { if (qrLib) return qrLib; await new Promise((ok, err) => { const s = document.createElement('script'); s.src = new URL('../../vendor/qrcode-generator-1.4.4.js', import.meta.url).href; s.onload = ok; s.onerror = err; document.head.appendChild(s); }); qrLib = window.qrcode; return qrLib; }
const T2 = (cab, L) => `<table><thead><tr>${cab.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${L.map(l => `<tr>${l.map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cab.length}">—</td></tr>`}</tbody></table>`;

export async function certificado(D, p, d) {
  if (!d) return;
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas do navegador para gerar o certificado', true);
  const v = D.veById[d.versao_id], fav = D.fav[p.favorecido_id];
  let img = '', qrSvg = '';
  try { if (v?.previa) img = (await linksArte(sb, [v.previa]))[v.previa] || ''; } catch { /* sem prévia */ }
  try { const g = (await qr())(0, 'M'); g.addData(`${location.origin}${location.pathname}#/preimpressao/artes?abrir=${p.id}`); g.make(); qrSvg = g.createSvgTag({ cellSize: 2, margin: 0 }); } catch { /* sem QR */ }
  const Vs = D.versoesDe(p.id).filter(x => x.enviada_em || x.origem === 'cliente'), Ds = D.decisoesDe(p.id);
  await abrirRelatorio({ janela: w, nome: `Certificado arte ${p.numero}`, titulo: `CERTIFICADO DE APROVAÇÃO DE ARTE Nº ${p.numero}-V${v?.numero}`, subtitulo: `${esc(fav?.nome || '')} — ${esc(p.nome)}`,
    extraCss: '.hash{font-family:Consolas,monospace;font-size:8.5pt;word-break:break-all} .cx{display:grid;grid-template-columns:1fr 62mm;gap:8mm;align-items:start} .cx img{width:62mm;border:1px solid #999} .termo{border:1px solid #000;padding:3mm 4mm;font-size:10pt} .qr{text-align:center;font-size:8pt;margin-top:3mm}',
    corpo: `<h2>1. Identificação</h2><div class="cx"><div>${T2(['Campo', 'Valor'], [
        ['Cliente', `${esc(fav?.nome || '')}${fav?.documento ? ' · CNPJ/CPF ' + esc(fav.documento) : ''}`], ['Embalagem', esc(p.nome) + (p.codigo_cliente ? ` · código no cliente ${esc(p.codigo_cliente)}` : '')],
        ['Produto', esc(prodTxt(D, p.produto_id)) || '—'], ['Dimensões', p.largura_mm ? `${nf(p.largura_mm, 2)} × ${nf(p.altura_mm, 2)} mm (largura × passo)` : '—'],
        ['Substrato / impressão', `${esc(p.substrato || '—')} · ${esc(P.PROCESSOS[p.processo] || '')}`], ['Cores', (p.cores || []).map(c => esc(c.pantone || c.nome)).join(', ') || '—'],
        ['Código de barras', p.ean ? `${esc(p.ean)} (${esc(P.gtin(p.ean).msg)})` : '—'], ['Desbobinamento', p.desbobinamento ? `${p.desbobinamento} — ${P.DESBOBINAMENTO[p.desbobinamento]}` : '—']])}</div>
        <div>${img ? `<img src="${esc(img)}" alt="">` : ''}${qrSvg ? `<div class="qr">${qrSvg}<div>Abrir a arte na plataforma</div></div>` : ''}</div></div>
      <h2>2. Arquivo aprovado</h2>${T2(['Campo', 'Valor'], [['Versão', `V${v?.numero} · ${esc(v?.nome || '')} · ${kb(v?.tamanho)}`], ['Enviada ao cliente', hora(v?.enviada_em) || (v?.origem === 'cliente' ? 'enviada pelo cliente' : '—')],
        ['SHA-256 (impressão digital do arquivo)', `<span class="hash">${esc(d.hash)}</span>`], ['Conferência', v && v.hash === d.hash ? 'O SHA-256 registrado na aprovação é o mesmo do arquivo da versão.' : 'ATENÇÃO: o SHA-256 não confere com a versão.']])}
      <h2>3. Aprovação</h2>${T2(['Campo', 'Valor'], [['Aprovado por (nome digitado)', `<b>${esc(d.nome || '')}</b>`], ['Usuário', esc(d.email || '')], ['Data e hora', new Date(d.criado_em).toLocaleString('pt-BR')],
        ['Origem', d.origem === 'cliente' ? 'Portal do Cliente (acesso por convite, com login e senha)' : 'Registrada pela equipe a partir de e-mail ou mensagem do cliente'], ['IP / navegador', `${esc(d.ip || '—')} · <small>${esc(d.navegador || '—')}</small>`],
        ...(d.evidencia ? [['Evidência', `<small>${esc(d.evidencia)}</small>`]] : []), ...(d.comentario ? [['Comentário', esc(d.comentario)]] : [])])}
      ${d.termo ? `<h2>4. Termo aceito</h2><div class="termo">${esc(d.termo)}</div>` : ''}
      <h2>${d.termo ? 5 : 4}. Histórico das rodadas</h2>${T2(['Versão', 'Enviada', 'Decisão', 'Por', 'Quando'], Vs.map(x => { const dd = Ds.filter(y => y.versao_id === x.id).at(-1);
        return [`V${x.numero}${x.origem === 'cliente' ? ' (do cliente)' : ''}`, hora(x.enviada_em) || '—', dd ? P.DECISOES[dd.decisao] : '—', esc(dd?.nome || ''), dd ? hora(dd.criado_em) : '']; }))}`,
    rodape: 'Para conferir a integridade, calcule o SHA-256 do arquivo (ex.: certutil -hashfile arquivo.pdf SHA256) e compare com o registrado. Base: pré-impressão da plataforma' });
}

// ---------------------------------------------------------------- parâmetros
export function parametros(D, { onSalvo } = {}) {
  const P0 = D.Pm, papeis = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['producao', 'Produção'], ['vendas', 'Vendas']];
  const m = modal({ title: 'Parâmetros da pré-impressão', body: `
    <fieldset><legend>Envio ao cliente</legend><div class="grid-form"><label class="xs">Prazo de resposta (dias)<input id="pp-pz" inputmode="numeric" value="${P0.prazo_cliente_dias ?? 3}"></label></div>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="pp-ck" ${P0.exigir_checklist !== false ? 'checked' : ''}> Só enviar ao cliente com o checklist de pré-impressão completo</label>
      <div class="small muted" style="margin:10px 0 4px">Checklist (um item por linha)</div><textarea id="pp-it" rows="7">${esc((P0.checklist || []).join('\n'))}</textarea></fieldset>
    <fieldset><legend>Aprovação e produção</legend>
      <label>Termo que o cliente aceita ao aprovar<textarea id="pp-tm" rows="4" maxlength="2000">${esc(P0.termo || '')}</textarea></label>
      <div class="small muted" style="margin:10px 0 4px">Quem registra decisão recebida por e-mail e libera para a produção</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap">${papeis.map(([k, t]) => `<label class="chk"><input type="checkbox" data-pp="${k}" ${k === 'admin' || (P0.papeis_liberacao || []).includes(k) ? 'checked' : ''} ${k === 'admin' ? 'disabled' : ''}> ${t}</label>`).join('')}</div>
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="pp-op" ${P0.bloquear_op ? 'checked' : ''}> Travar a OP: não libera nem inicia se a arte mais recente do produto não estiver aprovada</label></fieldset>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pp-ok">Salvar</button>` });
  $('#pp-ok', m.el).onclick = async (ev) => {
    const d = { empresa_id: state.empresa.id, prazo_cliente_dias: Math.max(1, parseInt($('#pp-pz', m.el).value) || 3), exigir_checklist: $('#pp-ck', m.el).checked,
      checklist: $('#pp-it', m.el).value.split('\n').map(s => s.trim()).filter(Boolean), termo: $('#pp-tm', m.el).value.trim(), bloquear_op: $('#pp-op', m.el).checked,
      papeis_liberacao: ['admin', ...$$('[data-pp]', m.el).filter(c => c.checked && c.dataset.pp !== 'admin').map(c => c.dataset.pp)], atualizado_em: new Date().toISOString() };
    if (!d.termo) return toast('Escreva o termo de aprovação', true);
    ev.target.disabled = true;
    try { await q(sb.from('pre_parametros').upsert(d)); m.close(); toast('Parâmetros salvos'); onSalvo?.(); } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// Etiqueta de mercadoria (SQL 175), etapa 2 do leitor: imprimir a etiqueta do lote ou do produto e, ao ler uma etiqueta,
// mostrar o saldo por local e movimentar (transferir ou dar saída) sem escolher produto e lote na mão.
import { sb, state, q } from './data.js';
import { $, $$, esc, modal, toast, fail, dateBR, today } from './ui.js';
import { PADRAO, TIPOS_CODIGO, expandir, documentoEtiquetas, htmlEtiqueta, cssEtiquetas, documentoEnderecos, htmlEndereco, cssEnderecos, documentoCaixas, documentoPastas } from './etiquetas.js';
import { EMPRESA_REL } from './relatorio-base.js';

const PODE_MOVIMENTAR = ['admin', 'financeiro', 'diretor', 'compras', 'producao'];
const qtd = (v) => (v == null ? '' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: 4 }));
const numBR = (t) => { const s = String(t ?? '').trim().replace(/\./g, '').replace(',', '.'); return s === '' ? NaN : +s; };
const pendente = (err) => /etiqueta|etq_config|does not exist|schema cache/i.test(err?.message || '');
const script = (arq, global) => new Promise((ok, err) => { if (window[global]) return ok(); const s = document.createElement('script'); s.src = new URL(`../../vendor/${arq}`, import.meta.url).href; s.onload = ok; s.onerror = err; document.head.appendChild(s); });

/** parâmetros da etiqueta da empresa (sem linha, ou sem o SQL 175: os padrões) */
export async function etqConfig() {
  try { return { ...PADRAO, ...((await q(sb.from('etq_config').select('*').eq('empresa_id', state.empresa.id).maybeSingle())) || {}) }; } catch { return { ...PADRAO }; }
}

/** desenha o código de barras (Code 128) e o QR do código, em SVG que estica na etiqueta */
export async function desenhar(codigo, tipo = 'ambos') {
  const out = {};
  if (tipo !== 'qr') {
    await script('jsbarcode-code128-3.11.6.min.js', 'JsBarcode');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    window.JsBarcode(svg, codigo, { format: 'CODE128', displayValue: false, margin: 0, marginLeft: 20, marginRight: 20, height: 60, width: 2 }   /* margem lateral = zona de silêncio de 10 módulos */);
    const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.removeAttribute('width'); svg.removeAttribute('height'); svg.removeAttribute('style');
    out.barras = svg.outerHTML;
  }
  if (tipo !== 'barras') {
    await script('qrcode-generator-1.4.4.js', 'qrcode');
    const g = window.qrcode(0, 'M'); g.addData(codigo); g.make(); out.qr = g.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  }
  return out;
}

/** janela de impressão: cópias e conteúdo por volume de cada item; itens = [{ etiqueta, produto_codigo, descricao, unidade, lote, lote_fornecedor, fornecedor, nota, data, quantidade }] */
export async function imprimirEtiquetas(itens, { titulo = 'Imprimir etiquetas' } = {}) {
  if (!itens?.length) return toast('Nada para etiquetar', true);
  const cfg = await etqConfig();
  const m = modal({ title: titulo, wide: true, body: `
    <p class="small muted" style="margin-top:0">Uma etiqueta por volume (saco, palete, caixa, bobina). Etiqueta de ${cfg.largura_mm} × ${cfg.altura_mm} mm, com ${{ ambos: 'código de barras e QR', barras: 'código de barras', qr: 'QR' }[cfg.codigo]} — o tamanho e o tipo de código ficam em Estoque › Parâmetros › Etiquetas.</p>
    <div class="table-wrap"><table><thead><tr><th>Produto</th><th>Lote</th><th class="num">Quantidade</th><th style="width:110px">Volumes (etiquetas)</th><th style="width:190px">Conteúdo de cada volume</th></tr></thead><tbody>
    ${itens.map((it, i) => `<tr><td class="wrap"><b>${esc(it.produto_codigo)}</b> ${esc(it.descricao)}</td><td>${esc(it.lote || '—')}<div class="small muted" style="font-family:monospace">${esc(it.etiqueta)}</div></td><td class="num">${it.quantidade != null ? `${qtd(it.quantidade)} ${esc(it.unidade || '')}` : ''}</td>
      <td><input type="number" min="0" max="200" data-c="${i}" value="${cfg.copias}"></td><td><input data-p="${i}" placeholder="ex.: 25 kg" maxlength="24"></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Volumes = 0 deixa o item sem etiqueta. Com mais de um volume, cada etiqueta sai numerada (Vol. 1/40).</p>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="eq-ok">Imprimir</button>' });
  $('#eq-ok', m.el).onclick = async () => {
    const sel = itens.map((it, i) => ({ ...it, copias: +$(`[data-c="${i}"]`, m.el).value || 0, peso: $(`[data-p="${i}"]`, m.el).value.trim() })).filter(x => x.copias > 0);
    if (!sel.length) return toast('Informe os volumes de pelo menos um item', true);
    const total = sel.reduce((t, x) => t + Math.min(200, x.copias), 0); if (total > 600) return toast('Muitas etiquetas de uma vez (máximo 600). Imprima em partes.', true);
    const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
    try {
      const svgs = {}; for (const x of sel) svgs[x.etiqueta] = svgs[x.etiqueta] || await desenhar(x.etiqueta, cfg.codigo);
      w.document.write(documentoEtiquetas(expandir(sel), cfg, svgs, EMPRESA_REL)); w.document.close();
    } catch (err) { w.close(); fail(err); }
  };
}

const itemDe = (p, l, extra = {}) => ({ etiqueta: l ? l.etiqueta : p.etiqueta, produto_codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, lote: l?.codigo || '', lote_fornecedor: l?.lote_fornecedor || '', ...extra });

/** etiquetas das mercadorias de uma nota de entrada: os lotes (ou produtos) que a nota pôs no estoque */
export async function etiquetasDaNota(nota) {
  try {
    const M = await q(sb.from('est_movimentos').select('produto_id,lote_id,quantidade,data').eq('nota_id', nota.id).gt('quantidade', 0).is('estorno_de', null));
    if (!M.length) return toast('Esta nota ainda não deu entrada no estoque. A etiqueta sai depois que os itens entram no Kardex (entrada automática pela nota ou movimento manual).', true);
    const [P, L] = await Promise.all([q(sb.from('produtos').select('id,codigo,descricao,unidade,etiqueta').in('id', [...new Set(M.map(x => x.produto_id))])),
      q(sb.from('est_lotes').select('id,codigo,lote_fornecedor,etiqueta').in('id', [...new Set(M.map(x => x.lote_id).filter(Boolean))].concat(['00000000-0000-0000-0000-000000000000'])))]);
    const g = new Map();
    for (const x of M) { const k = x.produto_id + '|' + (x.lote_id || ''); const a = g.get(k) || { ...x, quantidade: 0 }; a.quantidade += +x.quantidade; g.set(k, a); }
    const itens = [...g.values()].map(x => { const p = P.find(y => y.id === x.produto_id); return p && itemDe(p, L.find(y => y.id === x.lote_id), { fornecedor: nota.emit_nome || '', nota: nota.numero, data: dateBR(x.data), quantidade: x.quantidade }); }).filter(Boolean);
    imprimirEtiquetas(itens, { titulo: `Etiquetas da NF ${nota.numero}` });
  } catch (err) { pendente(err) ? toast('As etiquetas precisam do SQL 175.', true) : fail(err); }
}

/** etiqueta de um lote ou de um produto (Kardex) */
export const etiquetaDe = (p, l, extra = {}) => imprimirEtiquetas([itemDe(p, l, extra)], { titulo: `Etiqueta — ${p.codigo}${l ? ' · lote ' + l.codigo : ''}` });

/** etiquetas de prateleira (SQL 193): lista = [{ etiqueta, codigo, local, descricao }] */
export async function imprimirEnderecos(lista) {
  if (!lista?.length) return toast('Nenhum endereço para imprimir', true);
  if (lista.length > 1500) return toast('Muitas etiquetas de uma vez (máximo 1.500). Imprima por estante.', true);
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  try {
    const cfg = await etqConfig(), svgs = {};
    for (const x of lista) svgs[x.etiqueta] = await desenhar(x.etiqueta, cfg.codigo);
    w.document.write(documentoEnderecos(lista, cfg, svgs, EMPRESA_REL)); w.document.close();
  } catch (err) { w.close(); fail(err); }
}

/** etiquetas das caixas do arquivo morto (SQL 194): lista = [{ numero, etiqueta, area, setor, titulo, periodo_inicio, periodo_fim, descartar_em, permanente, prazo_pendente, endereco, local }] */
export async function imprimirCaixas(lista) {
  if (!lista?.length) return toast('Nenhuma caixa para imprimir', true);
  if (lista.length > 600) return toast('Muitas etiquetas de uma vez (máximo 600). Imprima em partes.', true);
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  try {
    const cfg = await etqConfig(), svgs = {};
    for (const x of lista) svgs[x.etiqueta] = await desenhar(x.etiqueta, cfg.codigo);
    w.document.write(documentoCaixas(lista, cfg, svgs, EMPRESA_REL)); w.document.close();
  } catch (err) { w.close(); fail(err); }
}

/** etiquetas das pastas do arquivo (SQL 195): tamanho dos parâmetros do arquivo (padrão 70 × 35 mm) */
export async function imprimirPastas(lista, tam) {
  if (!lista?.length) return toast('Nenhuma pasta para imprimir', true);
  if (lista.length > 600) return toast('Muitas etiquetas de uma vez (máximo 600).', true);
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  try {
    const cfg = await etqConfig(), svgs = {};
    for (const x of lista) svgs[x.etiqueta] = await desenhar(x.etiqueta, cfg.codigo);
    w.document.write(documentoPastas(lista, cfg, tam, svgs)); w.document.close();
  } catch (err) { w.close(); fail(err); }
}

/** etiqueta de prateleira lida: o que deve estar no endereço e o saldo de cada produto no local */
export async function enderecoLido(r) {
  const e = state.empresa?.id; if (!e) return;
  let en, loc, PE, P = [], S = [];
  try {
    en = await q(sb.from('est_enderecos').select('*').eq('empresa_id', e).eq('etiqueta', r.codigo).maybeSingle());
    if (!en) return toast(`Etiqueta ${r.codigo}: endereço não encontrado nesta empresa.`, true);
    [loc, PE] = await Promise.all([q(sb.from('est_locais').select('id,nome').eq('id', en.local_id).single()), q(sb.from('est_produto_enderecos').select('produto_id').eq('endereco_id', en.id))]);
    const ids = PE.map(x => x.produto_id);
    if (ids.length) [P, S] = await Promise.all([q(sb.from('produtos').select('id,codigo,descricao,unidade').in('id', ids).order('descricao')),
      q(sb.from('est_saldos').select('produto_id,quantidade').eq('local_id', en.local_id).in('produto_id', ids))]);
  } catch (err) { return pendente(err) || /est_enderecos/.test(err?.message || '') ? toast('Os endereços precisam do SQL 193.', true) : fail(err); }
  const saldo = (id) => S.filter(x => x.produto_id === id).reduce((t, x) => t + +x.quantidade, 0), viuSaldo = S.length > 0;
  const m = modal({ title: `Endereço ${en.codigo} — ${loc.nome}`, wide: true, body: `
    <div class="grid-form small"><div><span class="muted">Etiqueta lida</span><div style="font-family:monospace"><b>${esc(r.codigo)}</b></div></div>
      <div><span class="muted">Endereço</span><div><b>${esc(en.codigo)}</b>${en.descricao ? ' · ' + esc(en.descricao) : ''}${en.ativo ? '' : ' <span class="badge vencido">inativo</span>'}</div></div>
      <div><span class="muted">Produtos neste endereço</span><div><b>${P.length}</b></div></div></div>
    <h3 style="margin:14px 0 6px">O que deve estar aqui</h3>
    <div class="table-wrap"><table><thead><tr><th>Produto</th><th class="num">Saldo no local</th></tr></thead><tbody>
    ${P.map(p => `<tr><td class="wrap"><b>${esc(p.codigo)}</b> ${esc(p.descricao)}</td><td class="num">${viuSaldo ? `${qtd(saldo(p.id))} ${esc(p.unidade || '')}` : '—'}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Nenhum produto neste endereço. Use Endereçar com o leitor: leia esta etiqueta e depois a de cada produto.</td></tr>'}</tbody></table></div>
    ${P.length && !viuSaldo ? '<p class="small muted">Saldo não exibido: sem saldo no local ou local em contagem cega.</p>' : ''}`,
    foot: `<a class="btn ghost" href="#/estoque/enderecos?l=${en.local_id}" data-close>Endereços</a><span class="spacer"></span><button class="btn" data-close>Fechar</button><a class="btn primary" href="#/estoque/enderecos?l=${en.local_id}&modo=leitor&e=${en.id}" data-close>Endereçar aqui</a>` });
  return m;
}

/** etiqueta lida: saldo por local e movimentação */
export async function etiquetaLida(r) {
  const e = state.empresa?.id; if (!e) return;
  if (r.alvo === 'endereco') return enderecoLido(r);
  if (r.alvo === 'caixa' || r.alvo === 'arq_endereco' || r.alvo === 'pasta') {   // arquivo morto (SQL 194): abre a caixa ou a prateleira no Arquivo Morto
    const alvo = `#/arquivo?etq=${r.codigo}`; if (location.hash === alvo) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = alvo; return;
  }
  let p, l = null, S, LOC, TM;
  try {
    if (r.alvo === 'lote') {
      l = await q(sb.from('est_lotes').select('*').eq('empresa_id', e).eq('etiqueta', r.codigo).maybeSingle());
      if (!l) return toast(`Etiqueta ${r.codigo}: lote não encontrado nesta empresa.`, true);
      p = await q(sb.from('produtos').select('id,codigo,descricao,unidade,etiqueta,controla_lote').eq('id', l.produto_id).single());
    } else {
      p = await q(sb.from('produtos').select('id,codigo,descricao,unidade,etiqueta,controla_lote').eq('empresa_id', e).eq('etiqueta', r.codigo).maybeSingle());
      if (!p) return toast(`Etiqueta ${r.codigo}: produto não encontrado nesta empresa.`, true);
    }
    let sq = sb.from('est_saldos').select('local_id,lote_id,quantidade,ultimo_movimento').eq('empresa_id', e).eq('produto_id', p.id).neq('quantidade', 0);
    if (l) sq = sq.eq('lote_id', l.id);
    [S, LOC, TM] = await Promise.all([q(sq), q(sb.from('est_locais').select('id,codigo,nome,ativo,ordem').eq('empresa_id', e).order('ordem')),
      q(sb.from('est_tipos_movimento').select('id,codigo,nome,sentido,documento,ativo').eq('empresa_id', e).eq('ativo', true).order('nome'))]);
  } catch (err) { return pendente(err) ? toast('A leitura de etiquetas precisa do SQL 175.', true) : fail(err); }
  const loc = Object.fromEntries(LOC.map(x => [x.id, x]));
  // etiqueta de produto com lote: soma por local (a etiqueta do lote é que identifica o lote)
  const porLocal = new Map(); for (const s of S) porLocal.set(s.local_id, (porLocal.get(s.local_id) || 0) + +s.quantidade);
  const saldos = [...porLocal.entries()].filter(([, v]) => v).map(([id, v]) => ({ id, v })).sort((a, b) => (loc[a.id]?.ordem || 0) - (loc[b.id]?.ordem || 0));
  const pode = PODE_MOVIMENTAR.includes(state.papel) && (l || !p.controla_lote);
  const saidas = TM.filter(t => t.sentido === 'S' && t.documento !== 'nf'), transf = TM.filter(t => t.sentido === 'T');
  const total = saldos.reduce((t, s) => t + s.v, 0);
  const m = modal({ title: `${p.codigo} — ${p.descricao}`, wide: true, body: `
    <div class="grid-form small">
      <div><span class="muted">Etiqueta lida</span><div style="font-family:monospace"><b>${esc(r.codigo)}</b></div></div>
      <div><span class="muted">Lote</span><div>${l ? `<b>${esc(l.codigo)}</b>${l.lote_fornecedor ? ` · fornecedor ${esc(l.lote_fornecedor)}` : ''}` : (p.controla_lote ? 'etiqueta do produto (todos os lotes)' : 'produto sem controle de lote')}</div></div>
      <div><span class="muted">Saldo</span><div><b>${qtd(total)} ${esc(p.unidade)}</b></div></div>
    </div>
    <h3 style="margin:14px 0 6px">Onde está</h3>
    <div class="table-wrap"><table><thead><tr><th>Local</th><th class="num">Quantidade</th></tr></thead><tbody>
    ${saldos.map(s => `<tr><td>${esc(loc[s.id]?.nome || '')}</td><td class="num">${qtd(s.v)} ${esc(p.unidade)}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Sem saldo em nenhum local.</td></tr>'}</tbody></table></div>
    ${pode && saldos.length ? `<h3 style="margin:16px 0 6px">Movimentar</h3>
      <div class="chips" id="el-op"><span class="chip on" data-o="t">Transferir de local</span>${saidas.length ? '<span class="chip" data-o="s">Dar saída</span>' : ''}</div>
      <div class="grid-form" style="margin-top:10px">
        <label>Do local<select id="el-or">${saldos.map(s => `<option value="${s.id}" data-q="${s.v}">${esc(loc[s.id]?.nome || '')} (${qtd(s.v)})</option>`).join('')}</select></label>
        <label id="el-de-l">Para o local<select id="el-de"><option value="">Escolha…</option>${LOC.filter(x => x.ativo).map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label>
        <label id="el-tp-l" hidden>Tipo de saída<select id="el-tp">${saidas.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join('')}</select></label>
        <label>Quantidade (${esc(p.unidade)})<input id="el-q" inputmode="decimal" value="${qtd(saldos[0].v)}"></label>
        <label>Data<input type="date" id="el-dt" value="${today()}"></label>
        <label class="span2">Observação ou documento<input id="el-obs" maxlength="120" placeholder="ex.: OP 2610, requisição da extrusora 2"></label>
      </div>` : pode ? '' : `<p class="small muted" style="margin-top:12px">${p.controla_lote && !l ? 'Este produto controla lote: para movimentar, leia a etiqueta do lote.' : 'Seu perfil consulta o saldo; a movimentação é de quem movimenta o estoque.'}</p>`}`,
    foot: `<a class="btn ghost" href="#/estoque/kardex" data-close>Kardex</a><button class="btn" id="el-etq">Reimprimir etiqueta</button><span class="spacer"></span><button class="btn" data-close>Fechar</button>${pode && saldos.length ? '<button class="btn primary" id="el-ok">Transferir</button>' : ''}` });
  $('#el-etq', m.el).onclick = () => etiquetaDe(p, l, { quantidade: total });
  if (!pode || !saldos.length) return;
  let op = 't';
  const ajusta = () => { $('#el-de-l', m.el).hidden = op !== 't'; $('#el-tp-l', m.el).hidden = op !== 's'; $('#el-ok', m.el).textContent = op === 't' ? 'Transferir' : 'Dar saída'; $$('#el-op .chip', m.el).forEach(c => c.classList.toggle('on', c.dataset.o === op)); };
  $('#el-op', m.el).onclick = (ev) => { const o = ev.target.closest('[data-o]')?.dataset.o; if (o) { op = o; ajusta(); } };
  $('#el-or', m.el).onchange = (ev) => { $('#el-q', m.el).value = qtd(ev.target.selectedOptions[0].dataset.q); };
  $('#el-ok', m.el).onclick = async (ev) => {
    const or = $('#el-or', m.el).value, de = $('#el-de', m.el).value, qv = numBR($('#el-q', m.el).value), disp = +$('#el-or', m.el).selectedOptions[0].dataset.q, obs = $('#el-obs', m.el).value.trim() || null, dt = $('#el-dt', m.el).value;
    if (!(qv > 0)) return toast('Informe a quantidade', true);
    if (qv > disp + 1e-9) return toast(`O local tem ${qtd(disp)} ${p.unidade}. Confira a quantidade.`, true);
    if (!dt) return toast('Informe a data', true);
    if (op === 't' && !de) return toast('Escolha o local de destino', true);
    if (op === 't' && de === or) return toast('Origem e destino iguais', true);
    ev.target.disabled = true;
    try {
      if (op === 't') await q(sb.rpc('est_transferir', { p_empresa: e, p_data: dt, p_produto: p.id, p_origem: or, p_destino: de, p_qtd: qv, p_lote: l?.id || null, p_tipo: transf[0]?.id || null, p_obs: obs }));
      else await q(sb.from('est_movimentos').insert({ empresa_id: e, data: dt, produto_id: p.id, local_id: or, lote_id: l?.id || null, tipo_movimento_id: $('#el-tp', m.el).value, quantidade: -qv, custo_unitario: null, documento: null, observacao: obs }));
      toast(op === 't' ? `Transferido: ${qtd(qv)} ${p.unidade} para ${loc[de]?.nome || ''}` : `Saída lançada: ${qtd(qv)} ${p.unidade}`);
      m.close();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

/** aba Etiquetas dos parâmetros do estoque: tipo de código, tamanho e cópias, com a prévia da etiqueta */
export async function abaEtiquetas(c, ed) {
  const cfg = await etqConfig();
  const exemplo = { etiqueta: 'L0000123', produto_codigo: 'MP-001', descricao: 'RESINA PEBD LINEAR', lote: 'NF77310-1', lote_fornecedor: 'L2611', fornecedor: 'RESINAS DO BRASIL S.A.', nota: '77310', data: dateBR(today()), peso: '25 kg', volume: '1/40' };
  c.innerHTML = `<div class="card" style="max-width:980px"><h2 style="margin-top:0">Etiqueta de mercadoria</h2>
    <p class="small muted" style="margin-top:0">A etiqueta identifica o lote (ou o produto, quando ele não controla lote). É impressa na entrada da nota e lida pelo leitor de código de barras para consultar o saldo e movimentar.</p>
    <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
      <div class="grid-form" style="flex:1;min-width:300px">
        <label class="span2">O que sai impresso<select id="pe-cod" ${ed ? '' : 'disabled'}>${Object.entries(TIPOS_CODIGO).map(([k, t]) => `<option value="${k}" ${cfg.codigo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Largura (mm)<input type="number" id="pe-w" min="30" max="210" value="${cfg.largura_mm}" ${ed ? '' : 'disabled'}></label>
        <label>Altura (mm)<input type="number" id="pe-h" min="20" max="297" value="${cfg.altura_mm}" ${ed ? '' : 'disabled'}></label>
        <label>Volumes sugeridos por item<input type="number" id="pe-n" min="1" max="200" value="${cfg.copias}" ${ed ? '' : 'disabled'}></label>
        <label class="span2" style="display:flex;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="pe-f" style="width:auto;margin:0" ${cfg.mostrar_fornecedor ? 'checked' : ''} ${ed ? '' : 'disabled'}> Mostrar o nome do fornecedor na etiqueta</label>
        <p class="small muted span2" style="margin:0">Leitor que só lê barras (laser): use "Só código de barras" ou "os dois". Leitor de imagem (2D) lê qualquer um. Na dúvida, deixe os dois.</p>
        ${ed ? '<div class="span2"><button class="btn primary" id="pe-ok">Salvar</button> <button class="btn" id="pe-teste">Imprimir etiqueta de teste</button></div>' : '<p class="small muted span2">Só o administrador ou o diretor altera.</p>'}
      </div>
      <div><div class="small muted" style="margin-bottom:6px">Prévia (dados fictícios)</div><div id="pe-prev" style="border:1px solid var(--line);background:#fff;color:#000;display:inline-block"></div></div>
    </div></div>`;
  const lido = () => ({ codigo: $('#pe-cod', c).value, largura_mm: +$('#pe-w', c).value || 100, altura_mm: +$('#pe-h', c).value || 70, copias: +$('#pe-n', c).value || 1, mostrar_fornecedor: $('#pe-f', c).checked });
  const previa = async () => { const g = lido(); try { const svg = await desenhar(exemplo.etiqueta, g.codigo);
    $('#pe-prev', c).innerHTML = `<style>${cssEtiquetas(g).replace(/@page\{[^}]*\}/, '').replace(/html,body\{[^}]*\}/, '').replace(/body\{[^}]*\}/g, '').replace(/@media screen\{.*$/s, '')}</style><div style="font-family:Arial,Helvetica,sans-serif">${htmlEtiqueta(exemplo, g, svg, EMPRESA_REL)}</div>`; } catch { $('#pe-prev', c).textContent = 'Não foi possível desenhar a prévia.'; } };
  ['pe-cod', 'pe-w', 'pe-h', 'pe-f'].forEach(id => $('#' + id, c).onchange = previa); previa();
  $('#pe-ok', c) && ($('#pe-ok', c).onclick = async (ev) => { const g = lido(); ev.target.disabled = true;
    try { await q(sb.rpc('etq_config_salvar', { p_empresa: state.empresa.id, p_codigo: g.codigo, p_largura: g.largura_mm, p_altura: g.altura_mm, p_copias: g.copias, p_fornecedor: g.mostrar_fornecedor })); toast('Parâmetros da etiqueta salvos'); }
    catch (err) { pendente(err) ? toast('Os parâmetros da etiqueta precisam do SQL 175.', true) : fail(err); }
    ev.target.disabled = false; });
  // etiqueta de prateleira (SQL 193): tamanho próprio, o mesmo tipo de código
  const ex2 = { etiqueta: 'E0000789', codigo: 'A-03-2', local: 'Almoxarifado', descricao: 'Estante A, prateleira 3, nível 2' };
  c.firstElementChild.insertAdjacentHTML('afterend', `<div class="card" style="max-width:980px;margin-top:14px"><h2 style="margin-top:0">Etiqueta de prateleira</h2>
    <p class="small muted" style="margin-top:0">Identifica o endereço (estante, prateleira e nível) em Estoque › Endereços. Usa o mesmo tipo de código da etiqueta de mercadoria; o tamanho é próprio, porque costuma ser uma tira.</p>
    <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start"><div class="grid-form" style="flex:1;min-width:300px">
      <label>Largura (mm)<input type="number" id="pe-ew" min="30" max="210" value="${cfg.end_largura_mm}" ${ed ? '' : 'disabled'}></label>
      <label>Altura (mm)<input type="number" id="pe-eh" min="15" max="297" value="${cfg.end_altura_mm}" ${ed ? '' : 'disabled'}></label>
      ${ed ? '<div class="span2"><button class="btn primary" id="pe-eok">Salvar</button> <button class="btn" id="pe-eteste">Imprimir etiqueta de teste</button></div>' : ''}</div>
      <div><div class="small muted" style="margin-bottom:6px">Prévia (dados fictícios)</div><div id="pe-eprev" style="border:1px solid var(--line);background:#fff;color:#000;display:inline-block"></div></div></div></div>`);
  const lidoE = () => ({ ...lido(), end_largura_mm: +$('#pe-ew', c).value || 100, end_altura_mm: +$('#pe-eh', c).value || 40 });
  const previaE = async () => { const g = lidoE(); try { const svg = await desenhar(ex2.etiqueta, g.codigo);
    $('#pe-eprev', c).innerHTML = `<style>${cssEnderecos(g).replace(/@page\{[^}]*\}/, '').replace(/html,body\{[^}]*\}/, '').replace(/body\{[^}]*\}/g, '').replace(/@media screen\{.*$/s, '')}</style><div style="font-family:Arial,Helvetica,sans-serif">${htmlEndereco(ex2, g, svg, EMPRESA_REL)}</div>`; } catch { $('#pe-eprev', c).textContent = 'Não foi possível desenhar a prévia.'; } };
  ['pe-ew', 'pe-eh', 'pe-cod'].forEach(id => $('#' + id, c).addEventListener('change', previaE)); previaE();
  $('#pe-eok', c) && ($('#pe-eok', c).onclick = async (ev) => { const g = lidoE(); ev.target.disabled = true;
    try { await q(sb.rpc('etq_config_endereco_salvar', { p_empresa: state.empresa.id, p_largura: g.end_largura_mm, p_altura: g.end_altura_mm })); toast('Tamanho da etiqueta de prateleira salvo'); }
    catch (err) { /etq_config_endereco_salvar|schema cache/.test(err?.message || '') ? toast('A etiqueta de prateleira precisa do SQL 193.', true) : fail(err); }
    ev.target.disabled = false; });
  $('#pe-eteste', c) && ($('#pe-eteste', c).onclick = async () => { const g = lidoE(); const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
    try { w.document.write(documentoEnderecos([ex2], g, { [ex2.etiqueta]: await desenhar(ex2.etiqueta, g.codigo) }, EMPRESA_REL)); w.document.close(); } catch (err) { w.close(); fail(err); } });
  $('#pe-teste', c) && ($('#pe-teste', c).onclick = async () => { const g = lido(); const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
    try { w.document.write(documentoEtiquetas([exemplo], g, { [exemplo.etiqueta]: await desenhar(exemplo.etiqueta, g.codigo) }, EMPRESA_REL)); w.document.close(); } catch (err) { w.close(); fail(err); } });
}

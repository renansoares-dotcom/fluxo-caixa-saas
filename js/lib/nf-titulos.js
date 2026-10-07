// Títulos de clientes (NFs) → lançamentos em aberto na receita 1.01.01.
// Usado na aba Lançamentos e em Propostas de borderô: importação dos XML das NF-e e lançamento manual em lote.
import { sb, state, q, loadCadastros } from './data.js';
import { $, esc, money, dateBR, options, fail, toast, modal, parseNum } from './ui.js';

export const normTxt = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const padroes = () => ({ conta: state.cad.contas.find(c => c.nome === 'BRADESCO'), ccV: (state.cad.cc || []).find(c => c.nome === 'VENDAS') });
const soDig = (s) => String(s || '').replace(/\D/g, '');

/**
 * Grava títulos { documento, emissao, vencimento, cliente, cnpj, valor } como lançamentos Em aberto (1.01.01).
 * Cliente: casa por CNPJ e depois por nome; cria o favorecido CLI se não existir e completa o CNPJ que faltar.
 * Ignora NF-parcela já lançada para o mesmo cliente. Retorna { gravados, repetidos, novos }.
 */
export async function gravarTitulos(regs, { contaId = null, ccId = null } = {}) {
  const planoRec = state.cad.plano.find(p => p.codigo === '1.01.01');
  if (!planoRec) throw new Error('Plano 1.01.01 não encontrado');
  const e = state.empresa.id;
  const porDoc = {}, porNome = {};
  for (const f of state.cad.favorecidos) { if (soDig(f.documento)) porDoc[soDig(f.documento)] = f; porNome[normTxt(f.nome)] = porNome[normTxt(f.nome)] || f; }
  const acha = (x) => (x.cnpj && porDoc[x.cnpj]) || porNome[normTxt(x.cliente)];
  const novos = [], completar = new Map();
  for (const x of regs) {
    x.cnpj = soDig(x.cnpj);
    const f = acha(x);
    if (f) {
      if (!f.id) continue;
      // completa CNPJ e endereço (vindos do XML) que o cadastro ainda não tem
      const patch = { ...(completar.get(f.id) || {}) };
      if (x.cnpj && !soDig(f.documento)) patch.documento = x.cnpj;
      if (x.endereco && !f.logradouro) Object.assign(patch, x.endereco);
      if (Object.keys(patch).length) completar.set(f.id, patch);
      continue;
    }
    const n = { empresa_id: e, tipo: 'CLIENTES', sigla: 'CLI', nome: x.cliente.toUpperCase(), documento: x.cnpj || null, ativo: true, ...(x.endereco || {}) };
    novos.push(n); porNome[normTxt(n.nome)] = n; if (x.cnpj) porDoc[x.cnpj] = n;
  }
  if (novos.length) {
    const ins = await q(sb.from('favorecidos').insert(novos).select());
    for (const f of ins) { porNome[normTxt(f.nome)] = f; if (f.documento) porDoc[soDig(f.documento)] = f; }
  }
  for (const [id, patch] of completar) await q(sb.from('favorecidos').update(patch).eq('id', id));
  const docs = [...new Set(regs.map(x => x.documento))];
  const exist = new Set();
  for (let i = 0; i < docs.length; i += 300) {
    const r = await q(sb.from('lancamentos').select('documento,favorecido_id').eq('empresa_id', e).in('documento', docs.slice(i, i + 300)));
    for (const l of r || []) exist.add(`${l.documento}|${l.favorecido_id}`);
  }
  const rows = [];
  for (const x of regs) {
    const fav = acha(x); const k = `${x.documento}|${fav.id}`;
    if (exist.has(k)) continue; exist.add(k);
    rows.push({ empresa_id: e, data: x.vencimento, emissao: x.emissao || null, documento: x.documento, plano_id: planoRec.id, descricao: `NF ${x.documento} - ${fav.nome}`,
      favorecido_id: fav.id, centro_custo_id: ccId, status: 'Em aberto', conta_id: contaId, valor: +(+x.valor).toFixed(2), origem: x.origem || 'erp:nf' });
  }
  for (let i = 0; i < rows.length; i += 500) await q(sb.from('lancamentos').insert(rows.slice(i, i + 500)));
  const res = { gravados: rows.length, repetidos: regs.length - rows.length, novos: novos.length };
  toast(`${res.gravados} título(s) lançado(s)${res.repetidos ? ` · ${res.repetidos} já existiam` : ''}${res.novos ? ` · ${res.novos} cliente(s) novo(s)` : ''}`);
  if (novos.length || completar.size) await loadCadastros(true);
  return res;
}

// Divide o valor da NF em parcelas (centavos que sobram vão para a última)
export function gerarParcelas({ nf, valor, emissao, n = 1, prazos = '', primeiro = '', intervalo = 30 }) {
  const dias = String(prazos || '').split(/[\/;,\s]+/).map(Number).filter(x => x > 0);
  const qtd = dias.length || Math.max(1, +n || 1);
  const addDias = (iso, d) => { const t = new Date(iso + 'T12:00:00'); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
  const cent = Math.round(valor * 100); const base = Math.floor(cent / qtd);
  const out = [];
  for (let i = 0; i < qtd; i++) {
    const venc = dias.length ? addDias(emissao, dias[i]) : addDias(primeiro || emissao, i * (+intervalo || 30));
    out.push({ documento: `${nf}-${i + 1}`, vencimento: venc, valor: (i === qtd - 1 ? cent - base * (qtd - 1) : base) / 100 });
  }
  return out;
}

// Lançamento manual em lote: monta as parcelas de uma ou mais NFs e grava de uma vez
export function lancarNFs(onDone = () => {}) {
  const { conta, ccV } = padroes();
  const clientes = state.cad.favorecidos.filter(f => f.ativo !== false && (f.tipo === 'CLIENTES' || f.sigla === 'CLI'));
  const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  let linhas = [];
  const m = modal({
    title: 'Lançar NFs (títulos a receber)', wide: true,
    body: `<p class="small muted" style="margin-top:0">Preencha a NF e gere as parcelas; pode juntar várias NFs antes de salvar. Cada parcela vira um título em aberto (receita 1.01.01) com data = vencimento, pronto para entrar numa proposta de borderô.</p>
      <form id="nf-f" class="grid-form">
        <label class="span2">Cliente *<input name="cliente" list="dl-cli" required placeholder="Digite para buscar ou cadastrar"><datalist id="dl-cli">${clientes.map(f => `<option value="${esc(f.nome)}">`).join('')}</datalist></label>
        <label>CNPJ / CPF<input name="cnpj" inputmode="numeric"></label>
        <label>NF nº *<input name="nf" required inputmode="numeric"></label>
        <label>Emissão *<input type="date" name="emissao" value="${hoje}" required></label>
        <label>Valor total da NF *<input name="valor" inputmode="decimal" required placeholder="0,00"></label>
        <label>Prazos (dias da emissão)<input name="prazos" placeholder="ex.: 28/42/56" title="Se preenchido, define as parcelas e ignora nº de parcelas / intervalo"></label>
        <label>ou nº de parcelas<input name="n" type="number" min="1" value="1"></label>
        <label>1º vencimento<input type="date" name="primeiro"></label>
        <label>Intervalo (dias)<input name="intervalo" type="number" min="1" value="30"></label>
      </form>
      <div class="toolbar" style="margin-top:10px"><button class="btn" id="nf-gerar">Gerar parcelas</button><span class="spacer"></span>
        <label>Conta prevista<select id="nf-conta">${options(state.cad.contas, { selected: conta?.id })}</select></label>
        <label>Centro de custo<select id="nf-cc">${options(state.cad.cc || [], { empty: '—', selected: ccV?.id })}</select></label></div>
      <div id="nf-lista" style="margin-top:10px"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="nf-ok" disabled>Salvar títulos</button>',
  });
  const f = $('#nf-f', m.el); const F = (n) => f.querySelector(`[name=${n}]`);
  F('cliente').onchange = () => { const c = clientes.find(x => normTxt(x.nome) === normTxt(F('cliente').value)); if (c?.documento && !F('cnpj').value) F('cnpj').value = c.documento; };
  const desenhar = () => {
    const tot = linhas.reduce((s, x) => s + x.valor, 0);
    $('#nf-lista', m.el).innerHTML = linhas.length ? `<div class="table-wrap" style="max-height:320px"><table><thead><tr><th>Cliente</th><th>NF-parcela</th><th>Emissão</th><th>Vencimento</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${linhas.map((x, i) => `<tr data-i="${i}"><td class="wrap">${esc(x.cliente)}</td><td>${esc(x.documento)}</td><td>${dateBR(x.emissao)}</td>
        <td><input type="date" data-k="vencimento" value="${x.vencimento}"></td><td class="num"><input data-k="valor" inputmode="decimal" value="${money(x.valor)}" style="width:110px;text-align:right"></td>
        <td><button class="btn small ghost" data-del title="Remover">✕</button></td></tr>`).join('')}
      <tr class="row-total"><td colspan="4">${linhas.length} título(s)</td><td class="num">${money(tot)}</td><td></td></tr></tbody></table></div>`
      : '<div class="empty">Nenhuma parcela ainda.</div>';
    $('#nf-ok', m.el).disabled = !linhas.length;
  };
  $('#nf-lista', m.el).addEventListener('change', (e) => { const tr = e.target.closest('tr[data-i]'); if (!tr) return; const x = linhas[+tr.dataset.i];
    if (e.target.dataset.k === 'valor') x.valor = Math.abs(parseNum(e.target.value) || 0); else x.vencimento = e.target.value; desenhar(); });
  $('#nf-lista', m.el).addEventListener('click', (e) => { if (!e.target.closest('[data-del]')) return; linhas.splice(+e.target.closest('tr').dataset.i, 1); desenhar(); });
  $('#nf-gerar', m.el).onclick = () => {
    if (!f.reportValidity()) return;
    const v = Math.abs(parseNum(F('valor').value) || 0); if (!v) return toast('Informe o valor da NF', true);
    const nf = F('nf').value.trim().replace(/\s+/g, '');
    if (linhas.some(x => x.documento.startsWith(nf + '-') && normTxt(x.cliente) === normTxt(F('cliente').value))) return toast(`A NF ${nf} já está na lista`, true);
    const ps = gerarParcelas({ nf, valor: v, emissao: F('emissao').value, n: F('n').value, prazos: F('prazos').value, primeiro: F('primeiro').value, intervalo: F('intervalo').value });
    linhas.push(...ps.map(p => ({ ...p, cliente: F('cliente').value.trim(), cnpj: F('cnpj').value, emissao: F('emissao').value, origem: 'manual:nf' })));
    F('nf').value = ''; F('valor').value = ''; F('nf').focus(); desenhar();
  };
  $('#nf-ok', m.el).onclick = async () => {
    if (linhas.some(x => !x.vencimento || !(x.valor > 0))) return toast('Há parcela sem vencimento ou valor', true);
    $('#nf-ok', m.el).disabled = true;
    try { await gravarTitulos(linhas, { contaId: $('#nf-conta', m.el).value || null, ccId: $('#nf-cc', m.el).value || null }); m.close(); await onDone(); }
    catch (err) { fail(err); $('#nf-ok', m.el).disabled = false; }
  };
  desenhar();
}

// ======================================================================
// Importação dos XML das NF-e (duplicatas → títulos em aberto)
// ======================================================================
const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
let jszipP = null;
const carregarJSZip = () => globalThis.JSZip ? Promise.resolve(globalThis.JSZip) : (jszipP ??= new Promise((ok, erro) => {
  const sc = document.createElement('script'); sc.src = JSZIP;
  sc.onload = () => ok(globalThis.JSZip); sc.onerror = () => { jszipP = null; erro(new Error('não foi possível carregar o leitor de .zip')); };
  document.head.appendChild(sc);
}));

/** Lê o XML de uma NF-e (nfeProc ou NFe) ou de um evento de cancelamento. Retorna null se não for nenhum dos dois. */
export function lerNFe(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const un = (el, tag) => el?.getElementsByTagName(tag)[0] || null;
  const tx = (el, tag) => un(el, tag)?.textContent?.trim() || '';
  const ev = un(doc, 'infEvento');
  if (ev && !un(doc, 'infNFe')) {
    return tx(ev, 'tpEvento') === '110111' ? { tipo: 'cancelamento', chave: tx(ev, 'chNFe') } : null;
  }
  const inf = un(doc, 'infNFe'); if (!inf) return null;
  const ide = un(inf, 'ide'), emit = un(inf, 'emit'), dest = un(inf, 'dest'), tot = un(inf, 'ICMSTot'), prot = un(doc, 'infProt');
  const num = (v) => +String(v || '0').replace(',', '.') || 0;
  const emissao = (tx(ide, 'dhEmi') || tx(ide, 'dEmi')).slice(0, 10);
  const numero = tx(ide, 'nNF');
  const dups = [...(un(inf, 'cobr')?.getElementsByTagName('dup') || [])].map((d, i) => {
    const nd = tx(d, 'nDup'); const parc = /^\d+$/.test(nd) ? +nd : (+(nd.match(/(\d+)\s*$/)?.[1]) || i + 1);
    return { parcela: parc > 0 && parc < 1000 ? parc : i + 1, vencimento: tx(d, 'dVenc').slice(0, 10), valor: num(tx(d, 'vDup')) };
  });
  const cfops = [...new Set([...inf.getElementsByTagName('CFOP')].map(c => c.textContent.trim()))];
  return {
    tipo: 'nfe', chave: (inf.getAttribute('Id') || '').replace(/^NFe/, '') || tx(prot, 'chNFe'), numero, serie: tx(ide, 'serie'), emissao,
    tpNF: tx(ide, 'tpNF'), natOp: tx(ide, 'natOp'), cfops, emitCnpj: tx(emit, 'CNPJ'), emitNome: tx(emit, 'xNome'),
    cliente: tx(dest, 'xNome'), cnpj: tx(dest, 'CNPJ') || tx(dest, 'CPF'), valor: num(tx(tot, 'vNF')), dups,
    endereco: (() => { const e = un(dest, 'enderDest'); if (!e) return null;
      return { logradouro: tx(e, 'xLgr') || null, numero: tx(e, 'nro') || null, complemento: tx(e, 'xCpl') || null, bairro: tx(e, 'xBairro') || null,
        municipio: tx(e, 'xMun') || null, uf: tx(e, 'UF') || null, cep: tx(e, 'CEP') || null, ie: tx(dest, 'IE') || null }; })(),
    autorizada: !prot || ['100', '150'].includes(tx(prot, 'cStat')), cStat: tx(prot, 'cStat'),
  };
}

async function lerArquivos(files) {
  const textos = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const Z = await carregarJSZip(); const zip = await Z.loadAsync(await f.arrayBuffer());
      for (const e of Object.values(zip.files)) if (!e.dir && /\.xml$/i.test(e.name)) textos.push({ nome: e.name.split('/').pop(), xml: await e.async('string') });
    } else textos.push({ nome: f.name, xml: new TextDecoder('utf-8').decode(await f.arrayBuffer()) });
  }
  return textos;
}

// Classifica cada NF lida: o que será lançado por padrão e por quê
export function analisarNFes(lidas, { cnpjEmpresa = '', incluirAVista = false } = {}) {
  const canceladas = new Set(lidas.filter(x => x.tipo === 'cancelamento').map(x => x.chave));
  const vistas = new Set(); const out = [];
  const raizEmp = soDig(cnpjEmpresa).slice(0, 8);
  for (const n of lidas.filter(x => x.tipo === 'nfe')) {
    let sit = 'ok', motivo = '';
    if (vistas.has(n.chave)) continue; // mesmo XML selecionado duas vezes
    if (canceladas.has(n.chave)) { sit = 'ignorar'; motivo = 'cancelada'; }
    else if (!n.autorizada) { sit = 'ignorar'; motivo = `não autorizada (${n.cStat})`; }
    else if (n.tpNF === '0') { sit = 'ignorar'; motivo = 'NF de entrada'; }
    else if (raizEmp && soDig(n.emitCnpj).slice(0, 8) !== raizEmp) { sit = 'ignorar'; motivo = `emitida por ${n.emitNome}`; }
    else if (!n.dups.length) { sit = incluirAVista ? 'ok' : 'ignorar'; motivo = 'sem duplicatas' + (incluirAVista ? ' — 1 título na emissão' : ''); }
    vistas.add(n.chave);
    const parcelas = n.dups.length ? n.dups : [{ parcela: 1, vencimento: n.emissao, valor: n.valor }];
    out.push({ ...n, sit, motivo, parcelas, soma: parcelas.reduce((s, p) => s + p.valor, 0) });
  }
  return out.sort((a, b) => (a.emissao + a.numero).localeCompare(b.emissao + b.numero));
}

export function importarNFs(onDone = () => {}) {
  const { conta, ccV } = padroes();
  let lidas = [], lista = [], marcadas = new Set(), naoLidos = 0;
  const m = modal({
    title: 'Importar XML das notas fiscais', wide: true,
    body: `<p class="small muted" style="margin-top:0">Selecione os XML das NF-e de venda (vários de uma vez) ou um .zip com eles. Cada duplicata da NF vira um título em aberto (receita 1.01.01) com data = vencimento e documento NF-parcela. O endereço do cliente (para as duplicatas de endosso) é gravado no cadastro.
      São ignoradas: NF de entrada, emitida por outro CNPJ, não autorizada, cancelada (se o XML do cancelamento vier junto) e parcelas já lançadas.</p>
      <div class="toolbar"><input type="file" id="arq-nf" accept=".xml,.zip" multiple>
        <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="avista"> Lançar NF sem duplicatas como 1 título com vencimento na emissão</label></div>
      <div id="nf-res" style="margin-top:12px"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="imp-ok" disabled>Lançar títulos</button>',
  });
  const desenhar = () => {
    lista = analisarNFes(lidas, { cnpjEmpresa: state.empresa?.cnpj, incluirAVista: $('#avista', m.el).checked });
    marcadas = new Set(lista.filter(n => n.sit === 'ok').map(n => n.chave));
    pintar();
  };
  const pintar = () => {
    const sel = lista.filter(n => marcadas.has(n.chave)); const nt = sel.reduce((s, n) => s + n.parcelas.length, 0); const vt = sel.reduce((s, n) => s + n.soma, 0);
    const ign = lista.filter(n => n.sit !== 'ok');
    $('#nf-res', m.el).innerHTML = !lista.length ? (lidas.length || naoLidos ? '<div class="empty">Nenhuma NF-e encontrada nos arquivos.</div>' : '') : `
      <p class="small"><strong>${lista.length}</strong> NF-e lida(s)${naoLidos ? ` · ${naoLidos} arquivo(s) que não são NF-e` : ''} · <strong>${sel.length}</strong> selecionada(s) = ${nt} título(s), ${money(vt)}${ign.length ? ` · ${ign.length} ignorada(s)` : ''}.</p>
      <div class="table-wrap" style="max-height:380px"><table><thead><tr><th></th><th>NF</th><th>Emissão</th><th>Cliente</th><th>Natureza / CFOP</th><th>Parcelas (vencimento · valor)</th><th class="num">Valor NF</th><th>Situação</th></tr></thead><tbody>
      ${lista.map(n => `<tr data-ch="${n.chave}" class="${n.sit === 'ok' ? '' : 'muted'}"><td><input type="checkbox" ${marcadas.has(n.chave) ? 'checked' : ''}></td>
        <td>${esc(n.numero)}${n.serie && n.serie !== '1' ? `<span class="muted small"> s.${esc(n.serie)}</span>` : ''}</td><td>${dateBR(n.emissao)}</td>
        <td class="wrap">${esc(n.cliente)}<div class="muted small">${esc(n.cnpj)}</div></td><td class="wrap small">${esc(n.natOp)}<div class="muted">${esc(n.cfops.join(', '))}</div></td>
        <td class="small">${n.parcelas.map(p => `${n.numero}-${p.parcela} · ${dateBR(p.vencimento)} · ${money(p.valor)}`).join('<br>')}</td>
        <td class="num">${money(n.valor)}${Math.abs(n.soma - n.valor) > 0.05 && n.dups.length ? `<div class="small muted" title="Soma das duplicatas diferente do total da NF">dup. ${money(n.soma)}</div>` : ''}</td>
        <td class="small">${n.sit === 'ok' ? (n.motivo ? esc(n.motivo) : 'ok') : `<span class="neg">${esc(n.motivo)}</span>`}</td></tr>`).join('')}</tbody></table></div>
      <div class="toolbar" style="margin-top:10px">
        <label>Conta prevista do recebimento<select id="conta-nf">${options(state.cad.contas, { selected: conta?.id })}</select></label>
        <label>Centro de custo<select id="cc-nf">${options(state.cad.cc || [], { empty: '—', selected: ccV?.id })}</select></label></div>`;
    $('#imp-ok', m.el).disabled = !nt; $('#imp-ok', m.el).textContent = nt ? `Lançar ${nt} título(s)` : 'Lançar títulos';
  };
  $('#nf-res', m.el).addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-ch]'); if (!tr || e.target.type !== 'checkbox') return;
    e.target.checked ? marcadas.add(tr.dataset.ch) : marcadas.delete(tr.dataset.ch);
    const cs = $('#conta-nf', m.el)?.value, cc = $('#cc-nf', m.el)?.value; pintar();
    if (cs != null) { $('#conta-nf', m.el).value = cs; $('#cc-nf', m.el).value = cc; }
  });
  $('#avista', m.el).onchange = desenhar;
  $('#arq-nf', m.el).onchange = async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    $('#nf-res', m.el).innerHTML = '<p class="small">Lendo os arquivos…</p>';
    try {
      const textos = await lerArquivos(files);
      lidas = []; naoLidos = 0;
      for (const t of textos) { const r = lerNFe(t.xml); if (r) lidas.push(r); else naoLidos++; }
      desenhar();
    } catch (err) { fail(err); $('#nf-res', m.el).innerHTML = ''; }
  };
  $('#imp-ok', m.el).onclick = async () => {
    const regs = [];
    for (const n of lista.filter(n => marcadas.has(n.chave)))
      for (const p of n.parcelas) regs.push({ documento: `${n.numero}-${p.parcela}`, emissao: n.emissao, vencimento: p.vencimento, cliente: n.cliente, cnpj: n.cnpj, endereco: n.endereco, valor: p.valor, origem: `nfe:${n.chave}` });
    $('#imp-ok', m.el).disabled = true;
    try { await gravarTitulos(regs, { contaId: $('#conta-nf', m.el).value || null, ccId: $('#cc-nf', m.el).value || null }); m.close(); await onDone(); }
    catch (err) { fail(err); $('#imp-ok', m.el).disabled = false; }
  };
}

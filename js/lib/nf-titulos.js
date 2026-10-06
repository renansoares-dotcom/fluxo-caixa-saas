// Títulos de clientes (NFs) → lançamentos em aberto na receita 1.01.01.
// Usado na aba Lançamentos e em Propostas de borderô: importação do relatório do ERP e lançamento manual em lote.
import { sb, state, q, loadCadastros } from './data.js';
import { $, esc, money, dateBR, options, fail, toast, modal, parseNum } from './ui.js';

const ALIAS = {
  documento: ['nota', 'nf', 'n.f', 'numero', 'número', 'documento', 'titulo', 'título', 'duplicata', 'doc'],
  parcela: ['parcela', 'parc', 'prestacao', 'prestação', 'seq'],
  emissao: ['emissao', 'emissão', 'dt emis', 'data emis', 'data da nota'],
  vencimento: ['vencimento', 'venc', 'dt venc', 'data venc', 'vcto'],
  cliente: ['cliente', 'razao', 'razão', 'sacado', 'nome', 'destinatario', 'destinatário'],
  cnpj: ['cnpj', 'cpf', 'cnpj/cpf', 'documento cliente', 'inscricao', 'inscrição'],
  valor: ['valor', 'vlr', 'valor parcela', 'valor título', 'valor titulo', 'saldo', 'total'],
};
export const normTxt = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function adivinhar(cabecalhos) {
  const map = {}; const usados = new Set();
  for (const campo of ['vencimento', 'emissao', 'parcela', 'cnpj', 'valor', 'cliente', 'documento']) {
    const al = ALIAS[campo].map(normTxt);
    let ix = cabecalhos.findIndex((h, i) => !usados.has(i) && al.includes(normTxt(h)));
    if (ix < 0) ix = cabecalhos.findIndex((h, i) => !usados.has(i) && al.some(a => normTxt(h).includes(a)));
    if (ix >= 0) { map[campo] = ix; usados.add(ix); }
  }
  return map;
}
const toISO = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
};
const toNum = (v) => typeof v === 'number' ? v : parseNum(String(v ?? '').replace(/[R$\s]/g, ''));


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
    if (f) { if (x.cnpj && !soDig(f.documento) && f.id) completar.set(f.id, x.cnpj); continue; }
    const n = { empresa_id: e, tipo: 'CLIENTES', sigla: 'CLI', nome: x.cliente.toUpperCase(), documento: x.cnpj || null, ativo: true };
    novos.push(n); porNome[normTxt(n.nome)] = n; if (x.cnpj) porDoc[x.cnpj] = n;
  }
  if (novos.length) {
    const ins = await q(sb.from('favorecidos').insert(novos).select());
    for (const f of ins) { porNome[normTxt(f.nome)] = f; if (f.documento) porDoc[soDig(f.documento)] = f; }
  }
  for (const [id, doc] of completar) await q(sb.from('favorecidos').update({ documento: doc }).eq('id', id));
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

export function importarNFs(onDone = () => {}) {
  const cc = state.cad.cc || [];
  const m = modal({
    title: 'Importar notas fiscais do ERP', wide: true,
    body: `<p class="small muted" style="margin-top:0">Arquivo Excel ou CSV com uma linha por parcela (NF, parcela, emissão, vencimento, cliente, CNPJ, valor). Cada parcela vira um título em aberto (receita 1.01.01) no fluxo de caixa, com data = vencimento. Parcelas já importadas (mesma NF/parcela e cliente) são ignoradas.</p>
      <div class="toolbar"><input type="file" id="arq-nf" accept=".xlsx,.xls,.csv,.txt"></div><div id="map" style="margin-top:12px"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="imp-ok" disabled>Importar</button>',
  });
  let linhas = [], cab = [];
  const { conta, ccV } = padroes();
  $('#arq-nf', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      let wb;
      if (/\.(csv|txt)$/i.test(f.name)) {
        // CSV: lê como texto (UTF-8, ou Windows-1252 se vier com acento quebrado) sem converter valores — "1/2" não vira data e "1.234,56" fica certo
        let t = new TextDecoder('utf-8').decode(buf); if (t.includes('\uFFFD')) t = new TextDecoder('windows-1252').decode(buf);
        wb = XLSX.read(t, { type: 'string', raw: true });
      } else wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
      // cabeçalho = primeira linha com 3+ textos e alguma palavra de vencimento/valor
      let hi = rows.findIndex(r => r && r.filter(x => typeof x === 'string').length >= 3 && r.some(x => /venc|valor/i.test(String(x || ''))));
      if (hi < 0) hi = 0;
      cab = rows[hi].map(x => String(x ?? '').trim()); linhas = rows.slice(hi + 1).filter(r => r && r.some(x => x != null && x !== ''));
      const mp = adivinhar(cab);
      const sel = (campo, nome, obrig) => `<label>${nome}${obrig ? ' *' : ''}<select data-campo="${campo}"><option value="">—</option>${cab.map((h, i) => `<option value="${i}" ${mp[campo] === i ? 'selected' : ''}>${esc(h || `coluna ${i + 1}`)}</option>`).join('')}</select></label>`;
      $('#map', m.el).innerHTML = `<p class="small">Encontrei <strong>${linhas.length}</strong> linhas. Confira as colunas:</p>
        <div class="grid-form">${sel('documento', 'NF / documento', true)}${sel('parcela', 'Parcela')}${sel('emissao', 'Emissão')}${sel('vencimento', 'Vencimento', true)}${sel('cliente', 'Cliente', true)}${sel('cnpj', 'CNPJ/CPF')}${sel('valor', 'Valor', true)}
        <label>Conta prevista do recebimento<select id="conta-nf">${options(state.cad.contas, { selected: conta?.id })}</select></label>
        <label>Centro de custo<select id="cc-nf">${options(cc, { empty: '—', selected: ccV?.id })}</select></label></div>
        <div id="prev" style="margin-top:10px"></div>`;
      const prev = () => { const M = mapa(); const ok = ['documento', 'vencimento', 'cliente', 'valor'].every(k => M[k] != null);
        $('#imp-ok', m.el).disabled = !ok;
        const amostra = ok ? linhas.slice(0, 5).map(r => montar(r, M)) : [];
        $('#prev', m.el).innerHTML = ok ? `<div class="table-wrap"><table><thead><tr><th>NF/parcela</th><th>Emissão</th><th>Vencimento</th><th>Cliente</th><th>CNPJ</th><th class="num">Valor</th></tr></thead><tbody>${amostra.map(x => `<tr><td>${esc(x.documento)}</td><td>${dateBR(x.emissao || '')}</td><td>${dateBR(x.vencimento || '')}</td><td>${esc(x.cliente)}</td><td>${esc(x.cnpj || '')}</td><td class="num">${money(x.valor)}</td></tr>`).join('')}</tbody></table></div><p class="small muted">Prévia das 5 primeiras linhas.</p>` : '<p class="small neg">Indique as colunas obrigatórias (*).</p>'; };
      $('#map', m.el).onchange = prev; prev();
    } catch (err) { fail(err); }
  };
  const mapa = () => Object.fromEntries([...m.el.querySelectorAll('select[data-campo]')].map(s => [s.dataset.campo, s.value === '' ? null : +s.value]));
  const montar = (r, M) => { const doc = String(r[M.documento] ?? '').trim(); const par = M.parcela != null ? String(r[M.parcela] ?? '').trim().replace(/^(\d+)\s*\/\s*\d+$/, '$1') : '';
    return { documento: par && !doc.includes('/') && !doc.includes('-') ? `${doc}-${par}` : doc, emissao: M.emissao != null ? toISO(r[M.emissao]) : null, vencimento: toISO(r[M.vencimento]),
      cliente: String(r[M.cliente] ?? '').trim(), cnpj: M.cnpj != null ? String(r[M.cnpj] ?? '').replace(/\D/g, '') : '', valor: Math.abs(toNum(r[M.valor]) || 0) }; };
  $('#imp-ok', m.el).onclick = async () => {
    const M = mapa(); const contaId = $('#conta-nf', m.el).value || null; const ccId = $('#cc-nf', m.el).value || null;
    const regs = linhas.map(r => montar(r, M)).filter(x => x.documento && x.vencimento && x.valor > 0 && x.cliente);
    $('#imp-ok', m.el).disabled = true;
    try { await gravarTitulos(regs, { contaId, ccId }); m.close(); await onDone(); }
    catch (err) { fail(err); $('#imp-ok', m.el).disabled = false; }
  };
}

// Cadastro de beneficiários a partir dos XML das NF-e (entrada e saída).
// Saída emitida pela empresa → destinatário = CLIENTE. Entrada (empresa destinatária) → emitente = FORNECEDOR.
// Devolução (finNFe 4) inverte o papel. NF de entrada emitida pela própria empresa → destinatário = FORNECEDOR.
// Nada é sobrescrito sem aprovação: cadastros novos e diferenças campo a campo vão para revisão.
import { sb, state, q, loadCadastros } from './data.js';
import { $, esc, dateBR, fail, toast, modal } from './ui.js';
import { analisaDocumento, somenteDoc } from './documentos.js';
import { lerArquivos, normTxt } from './nf-titulos.js';

const SIGLA = { CLIENTES: 'CLI', FORNECEDORES: 'FOR' };
const GRUPO = { CLIENTES: ['CLIENTES', 'TERCEIROS - CLIENTES'], FORNECEDORES: ['FORNECEDORES'] };
const CRT = { 1: 'Simples Nacional', 2: 'Simples Nacional', 4: 'MEI' }; // 3 = regime normal (Presumido ou Real: não dá para saber pelo XML)
const ICMS = { 1: '1 – Contribuinte', 2: '2 – Isento', 9: '9 – Não contribuinte' };

// campos comparados: [chave, rótulo, normalização para comparar]
const sp = (s) => normTxt(s).replace(/[^a-z0-9]+/g, ' ').trim();
const dig = (s) => String(s ?? '').replace(/\D/g, '');
const CAMPOS = [
  ['nome', 'Razão social', sp], ['documento', 'CNPJ/CPF', somenteDoc], ['nome_fantasia', 'Nome fantasia', sp],
  ['ie', 'Inscrição estadual', (s) => /isent/i.test(s || '') ? 'ISENTO' : dig(s)], ['im', 'Inscrição municipal', dig],
  ['logradouro', 'Logradouro', sp], ['numero', 'Número', sp], ['complemento', 'Complemento', sp], ['bairro', 'Bairro', sp],
  ['municipio', 'Município', sp], ['uf', 'UF', sp], ['cep', 'CEP', dig], ['telefone', 'Telefone', dig], ['email', 'E-mail', sp],
  ['regime_tributario', 'Regime tributário', sp], ['contribuinte_icms', 'Indicador de ICMS', sp],
];
const ROT = Object.fromEntries(CAMPOS.map(([k, r]) => [k, r]));

/** Extrai da NF-e o participante (a outra parte) e o papel dele. Retorna null quando não há o que cadastrar. */
export function participanteNFe(xml, cnpjEmpresa) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const un = (el, tag) => el?.getElementsByTagName(tag)[0] || null;
  const tx = (el, tag) => un(el, tag)?.textContent?.trim() || '';
  const ev = un(doc, 'infEvento');
  if (ev && !un(doc, 'infNFe')) return tx(ev, 'tpEvento') === '110111' ? { cancelamento: tx(ev, 'chNFe') } : null;
  const inf = un(doc, 'infNFe'); if (!inf) return null;
  const ide = un(inf, 'ide'), emit = un(inf, 'emit'), dest = un(inf, 'dest'), prot = un(doc, 'infProt');
  const base = { chave: (inf.getAttribute('Id') || '').replace(/^NFe/, '') || tx(prot, 'chNFe'), numero: tx(ide, 'nNF'), serie: tx(ide, 'serie'),
    emissao: (tx(ide, 'dhEmi') || tx(ide, 'dEmi')).slice(0, 10), tpNF: tx(ide, 'tpNF'), finNFe: tx(ide, 'finNFe'), natOp: tx(ide, 'natOp'),
    autorizada: !prot || ['100', '150'].includes(tx(prot, 'cStat')), cStat: tx(prot, 'cStat') };
  const raiz = dig(cnpjEmpresa).slice(0, 8);
  const docDe = (el) => tx(el, 'CNPJ') || tx(el, 'CPF') || tx(el, 'idEstrangeiro');
  const ehEmp = (el) => !!raiz && dig(tx(el, 'CNPJ')).slice(0, 8) === raiz;
  const empEmit = ehEmp(emit), empDest = ehEmp(dest);
  if (!raiz) return { ...base, ignorar: 'CNPJ da empresa não configurado' };
  if (empEmit && empDest) return { ...base, ignorar: 'entre estabelecimentos da própria empresa' };
  if (!empEmit && !empDest) return { ...base, ignorar: `empresa não participa (${tx(emit, 'xNome')})` };
  const lado = empEmit ? dest : emit; // a outra parte
  if (!lado || !docDe(lado)) return { ...base, ignorar: 'sem destinatário identificado' };
  // papel: quem compra da empresa é cliente; quem vende para ela é fornecedor; devolução inverte
  let papel = empEmit ? (base.tpNF === '1' ? 'CLIENTES' : 'FORNECEDORES') : 'FORNECEDORES';
  const devol = base.finNFe === '4';
  if (devol) papel = papel === 'CLIENTES' ? 'FORNECEDORES' : 'CLIENTES';
  const end = un(lado, empEmit ? 'enderDest' : 'enderEmit');
  const fone = tx(end, 'fone');
  const v = (s) => (s || '').trim() || null;
  const dados = {
    documento: somenteDoc(docDe(lado)), tipo_pessoa: tx(lado, 'CPF') ? 'PF' : 'PJ', nome: v(tx(lado, 'xNome'))?.toUpperCase().replace(/\s+/g, ' ') || null,
    nome_fantasia: empEmit ? null : v(tx(emit, 'xFant')), ie: v(tx(lado, 'IE')), im: empEmit ? v(tx(dest, 'IM')) : v(tx(emit, 'IM')),
    logradouro: v(tx(end, 'xLgr')), numero: v(tx(end, 'nro')), complemento: v(tx(end, 'xCpl')), bairro: v(tx(end, 'xBairro')),
    municipio: v(tx(end, 'xMun'))?.toUpperCase() || null, uf: v(tx(end, 'UF'))?.toUpperCase() || null, cep: dig(tx(end, 'CEP')) || null,
    telefone: fone ? dig(fone) : null, email: empEmit ? v(tx(dest, 'email'))?.toLowerCase() || null : null,
    regime_tributario: empEmit ? null : CRT[tx(emit, 'CRT')] || null, contribuinte_icms: empEmit ? v(tx(dest, 'indIEDest')) : null,
  };
  const crt3 = !empEmit && tx(emit, 'CRT') === '3';
  return { ...base, papel, devol, entrada: !empEmit || base.tpNF === '0', dados, crt3, consumidorFinal: empEmit && tx(ide, 'indFinal') === '1' };
}

/** Agrupa por participante (papel + documento), usa os dados da NF mais recente e casa com o cadastro. */
export function analisarParticipantes(lidos, favorecidos) {
  const canceladas = new Set(lidos.filter(x => x.cancelamento).map(x => x.cancelamento));
  const ign = []; const grupos = new Map(); const vistas = new Set();
  for (const n of lidos) {
    if (n.cancelamento || vistas.has(n.chave)) continue; vistas.add(n.chave);
    if (n.ignorar) { ign.push({ n, motivo: n.ignorar }); continue; }
    if (canceladas.has(n.chave)) { ign.push({ n, motivo: 'cancelada' }); continue; }
    if (!n.autorizada) { ign.push({ n, motivo: `não autorizada (${n.cStat})` }); continue; }
    const k = `${n.papel}|${n.dados.documento}`;
    const g = grupos.get(k) || { papel: n.papel, nfs: [] }; g.nfs.push(n); grupos.set(k, g);
  }
  const out = [];
  for (const g of grupos.values()) {
    g.nfs.sort((a, b) => (b.emissao + b.numero).localeCompare(a.emissao + a.numero));
    const rec = g.nfs[0]; const d = { ...rec.dados };
    // completa o que faltar na mais recente com as anteriores (ex.: e-mail, IM)
    for (const n of g.nfs.slice(1)) for (const [k, val] of Object.entries(n.dados)) if (d[k] == null && val != null) d[k] = val;
    if (!d.regime_tributario && g.nfs.some(n => n.crt3)) d.regime_normal = true;
    const meses = [...new Set(g.nfs.map(n => n.emissao.slice(0, 7)))].sort();
    const grupo = GRUPO[g.papel];
    const doMesmoGrupo = favorecidos.filter(f => grupo.includes(f.tipo));
    let fav = doMesmoGrupo.find(f => somenteDoc(f.documento) === d.documento), via = 'CNPJ/CPF';
    // mesma empresa, outro estabelecimento (raiz do CNPJ igual): é o mesmo cadastro
    if (!fav && d.tipo_pessoa === 'PJ') { fav = doMesmoGrupo.find(f => somenteDoc(f.documento).length === 14 && somenteDoc(f.documento).slice(0, 8) === d.documento.slice(0, 8)); via = 'filial (raiz do CNPJ)'; }
    if (!fav) { fav = doMesmoGrupo.find(f => sp(f.nome) === sp(d.nome)); via = 'nome'; }
    if (!fav) { // nome parecido: as duas primeiras palavras iguais e um único cadastro assim
      const ini = (t) => sp(t).split(' ').filter(w => w.length >= 3).slice(0, 2).join(' ');
      const k = ini(d.nome); const L = k.includes(' ') ? doMesmoGrupo.filter(f => ini(f.nome) === k) : [];
      if (L.length === 1) { fav = L[0]; via = 'nome parecido'; }
    }
    const outros = favorecidos.filter(f => !grupo.includes(f.tipo) && somenteDoc(f.documento) === d.documento).map(f => f.tipo);
    const p = { chave: `${g.papel}|${d.documento}`, papel: g.papel, dados: d, nfs: g.nfs, meses, rec, fav: fav || null, via: fav ? via : null, outros, devol: g.nfs.every(n => n.devol) };
    p.difs = fav ? diferencas(fav, d) : [];
    if (fav && via.startsWith('filial')) p.difs = p.difs.filter(x => x.completar && x.k !== 'documento');
    p.info = [];
    if (d.regime_normal && fav && !['Lucro Presumido', 'Lucro Real'].includes(fav.regime_tributario)) p.info.push('Emitente no regime normal (CRT 3): defina Lucro Presumido ou Real no cadastro');
    if (d.regime_normal && !fav) p.info.push('Regime normal (CRT 3): defina Lucro Presumido ou Real depois');
    if (!analisaDocumento(d.documento).valido) p.info.push('CNPJ/CPF do XML não confere o dígito');
    p.sit = !fav ? 'novo' : p.difs.length ? 'dif' : 'igual';
    out.push(p);
  }
  // vários CNPJ (filiais) caindo no mesmo cadastro, ou novos da mesma raiz: um só principal; os demais ficam como informação
  const principal = (L) => L.find(p => p.fav && somenteDoc(p.fav.documento) === p.dados.documento) || L.find(p => p.dados.documento.slice(8, 12) === '0001') || [...L].sort((a, b) => b.nfs.length - a.nfs.length)[0];
  const porChave = new Map();
  for (const p of out) { const k = p.fav ? `f:${p.fav.id}` : p.dados.tipo_pessoa === 'PJ' ? `r:${p.papel}|${p.dados.documento.slice(0, 8)}` : `d:${p.chave}`; (porChave.get(k) || porChave.set(k, []).get(k)).push(p); }
  for (const L of porChave.values()) {
    if (L.length < 2) continue;
    const pr = principal(L);
    for (const p of L) if (p !== pr) {
      p.sit = 'igual'; p.difs = []; p.filialDe = pr;
      p.info.unshift(`Outro estabelecimento de ${pr.dados.nome} (${analisaDocumento(pr.dados.documento).formatado}) — usa o mesmo cadastro`);
      if (!p.fav) p.fav = pr.fav || { nome: pr.dados.nome, tipo: pr.papel, id: null };
    }
  }
  out.sort((a, b) => a.dados.nome.localeCompare(b.dados.nome));
  return { participantes: out, ignoradas: ign, nfs: vistas.size };
}

function diferencas(fav, d) {
  const difs = [];
  for (const [k, , norm] of CAMPOS) {
    const novo = d[k]; if (novo == null || novo === '') continue;
    const atual = fav[k];
    if (norm(atual ?? '') === norm(novo)) continue;
    difs.push({ k, atual: atual ?? null, novo, completar: atual == null || String(atual).trim() === '' });
  }
  return difs;
}

const fmt = (k, v) => {
  if (v == null || v === '') return '<span class="muted">vazio</span>';
  if (k === 'documento') return esc(analisaDocumento(v).formatado);
  if (k === 'cep') return esc(String(v).replace(/^(\d{5})(\d{3})$/, '$1-$2'));
  if (k === 'contribuinte_icms') return esc(ICMS[v] || v);
  return esc(v);
};

export function importarBeneficiariosNFe(onDone = () => {}, { textos: pre = null } = {}) {
  let lidos = [], res = null, naoLidos = 0, aba = 'novo';
  const aprov = new Set(); // 'n|<chave>' para novos; 'd|<chave>|<campo>' para diferenças
  const tipoNovo = new Map();
  const m = modal({
    title: 'Cadastrar beneficiários a partir das NF-e', wide: true,
    body: `<p class="small muted" style="margin-top:0">Selecione a pasta com as subpastas mensais de XML (entrada e saída), os arquivos XML ou um .zip.
      NF de saída → o destinatário vira <strong>cliente</strong>; NF de entrada → o emitente vira <strong>fornecedor</strong> (devolução inverte).
      Os dados vêm da NF mais recente de cada participante. Cadastros novos e diferenças com o cadastro atual aparecem para aprovação — nada é alterado sem marcar.</p>
      <div class="toolbar"><label>Pasta (com subpastas por mês)<input type="file" id="arq-pasta" webkitdirectory directory multiple></label>
        <label>ou arquivos XML / .zip<input type="file" id="arq-xml" accept=".xml,.zip" multiple></label></div>
      <div id="nb-res" style="margin-top:12px"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="nb-ok" disabled>Aplicar</button>',
  });
  const cnpjEmp = state.empresa?.cnpj || '';

  const processar = () => {
    res = analisarParticipantes(lidos, state.cad.favorecidos);
    aprov.clear(); tipoNovo.clear();
    for (const p of res.participantes) {
      if (p.sit === 'novo') aprov.add('n|' + p.chave);
      for (const d of p.difs) if (d.completar) aprov.add(`d|${p.chave}|${d.k}`); // só completar campo vazio vem marcado
    }
    aba = res.participantes.some(p => p.sit === 'novo') ? 'novo' : 'dif';
    pintar();
  };

  const pintar = () => {
    const c = $('#nb-res', m.el);
    if (!res) { c.innerHTML = ''; return; }
    const P = res.participantes; const by = (s) => P.filter(p => p.sit === s);
    const nE = lidos.filter(n => !n.cancelamento && !n.ignorar && n.entrada).length, nS = lidos.filter(n => !n.cancelamento && !n.ignorar && !n.entrada).length;
    const meses = [...new Set(lidos.filter(n => n.emissao).map(n => n.emissao.slice(0, 7)))].sort();
    const porMes = meses.map(mm => `${mm.slice(5)}/${mm.slice(0, 4)}: ${lidos.filter(n => n.emissao?.startsWith(mm) && !n.cancelamento).length}`).join(' · ');
    c.innerHTML = `<p class="small"><strong>${res.nfs}</strong> NF-e lida(s) (${nS} saída · ${nE} entrada)${naoLidos ? ` · ${naoLidos} arquivo(s) que não são NF-e` : ''}${res.ignoradas.length ? ` · ${res.ignoradas.length} ignorada(s)` : ''}
        <br><span class="muted">Por mês de emissão — ${porMes || '—'}</span></p>
      <div class="chips" id="nb-abas" style="margin-bottom:10px">
        <span class="chip ${aba === 'novo' ? 'on' : ''}" data-a="novo">Novos <span class="muted">${by('novo').length}</span></span>
        <span class="chip ${aba === 'dif' ? 'on' : ''}" data-a="dif">Com diferenças <span class="muted">${by('dif').length}</span></span>
        <span class="chip ${aba === 'igual' ? 'on' : ''}" data-a="igual">Sem alteração <span class="muted">${by('igual').length}</span></span>
        ${res.ignoradas.length ? `<span class="chip ${aba === 'ign' ? 'on' : ''}" data-a="ign">NFs ignoradas <span class="muted">${res.ignoradas.length}</span></span>` : ''}</div>
      <div id="nb-lista">${aba === 'novo' ? listaNovos(by('novo')) : aba === 'dif' ? listaDifs(by('dif')) : aba === 'igual' ? listaIguais(by('igual')) : listaIgn()}</div>`;
    botao();
  };
  const botao = () => {
    const nNovos = [...aprov].filter(x => x.startsWith('n|')).length, nCampos = [...aprov].filter(x => x.startsWith('d|')).length;
    const ok = $('#nb-ok', m.el); ok.disabled = !(nNovos + nCampos);
    ok.textContent = nNovos + nCampos ? `Aplicar: ${nNovos} novo(s), ${nCampos} campo(s)` : 'Aplicar';
  };

  const linhaNFs = (p) => `${p.nfs.length} NF${p.nfs.length > 1 ? 's' : ''} · última ${esc(p.rec.numero)} de ${dateBR(p.rec.emissao)}${p.meses.length > 1 ? ` · ${p.meses.length} meses` : ''}`;
  const listaNovos = (L) => !L.length ? '<div class="empty">Nenhum cadastro novo.</div>' : `
    <div class="toolbar" style="margin-bottom:6px"><button class="btn small" data-todos="n1">Marcar todos</button><button class="btn small" data-todos="n0">Desmarcar todos</button></div>
    <div class="table-wrap" style="max-height:420px"><table><thead><tr><th></th><th>Tipo</th><th>Nome / razão social</th><th>CNPJ / CPF</th><th>Cidade</th><th>IE</th><th>Fiscal</th><th>NFs</th></tr></thead><tbody>
    ${L.map(p => { const d = p.dados; const a = analisaDocumento(d.documento); const t = tipoNovo.get(p.chave) || p.papel;
      return `<tr data-n="${esc(p.chave)}"><td><input type="checkbox" ${aprov.has('n|' + p.chave) ? 'checked' : ''}></td>
      <td><select data-tipo>${['CLIENTES', 'TERCEIROS - CLIENTES', 'FORNECEDORES'].map(x => `<option ${x === t ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td class="wrap"><strong>${esc(d.nome)}</strong>${d.nome_fantasia ? `<div class="small muted">${esc(d.nome_fantasia)}</div>` : ''}
        ${p.outros.length ? `<div class="small"><span class="badge aberto">já cadastrado como ${esc(p.outros.join(', '))}</span></div>` : ''}
        ${p.devol ? '<div class="small"><span class="badge aberto">só aparece em devolução</span></div>' : ''}
        ${p.info.map(x => `<div class="small muted">${esc(x)}</div>`).join('')}</td>
      <td>${esc(a.formatado)}${a.valido ? '' : ' <span class="badge vencido">inválido</span>'}</td>
      <td class="small">${esc([d.municipio, d.uf].filter(Boolean).join('/'))}</td><td class="small">${esc(d.ie || '')}</td>
      <td class="small">${esc(d.regime_tributario || (d.regime_normal ? 'Regime normal' : ''))}${d.contribuinte_icms ? `<div class="muted">ICMS ${esc(ICMS[d.contribuinte_icms] || d.contribuinte_icms)}</div>` : ''}</td>
      <td class="small wrap">${linhaNFs(p)}</td></tr>`; }).join('')}</tbody></table></div>`;
  const listaDifs = (L) => !L.length ? '<div class="empty">Nenhuma diferença entre os XML e o cadastro.</div>' : `
    <div class="toolbar" style="margin-bottom:6px"><button class="btn small" data-todos="d1">Aprovar todas</button><button class="btn small" data-todos="dc">Só completar campos vazios</button><button class="btn small" data-todos="d0">Desmarcar todas</button></div>
    <div style="max-height:440px;overflow:auto">${L.map(p => `<div class="card" style="margin-bottom:10px;padding:10px" data-p="${esc(p.chave)}">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><strong>${esc(p.fav.nome)}</strong> <span class="muted small">${esc(p.fav.tipo)} · casado por ${p.via}</span></div>
        <div class="small muted">${linhaNFs(p)}</div></div>
      ${p.info.map(x => `<div class="small muted">${esc(x)}</div>`).join('')}
      <div class="table-wrap"><table><thead><tr><th style="width:28px"></th><th>Campo</th><th>Cadastro atual</th><th>XML (NF ${esc(p.rec.numero)})</th></tr></thead><tbody>
      ${p.difs.map(d => `<tr data-d="${esc(p.chave)}|${d.k}"><td><input type="checkbox" ${aprov.has(`d|${p.chave}|${d.k}`) ? 'checked' : ''}></td><td>${ROT[d.k]}${d.completar ? ' <span class="badge pago">completar</span>' : ' <span class="badge aberto">diverge</span>'}</td>
        <td class="wrap">${fmt(d.k, d.atual)}</td><td class="wrap"><strong>${fmt(d.k, d.novo)}</strong></td></tr>`).join('')}</tbody></table></div></div>`).join('')}</div>`;
  const listaIguais = (L) => !L.length ? '<div class="empty">—</div>' : `<div class="table-wrap" style="max-height:420px"><table><thead><tr><th>Cadastro</th><th>Tipo</th><th>CNPJ / CPF</th><th>NFs</th></tr></thead><tbody>
    ${L.map(p => `<tr><td>${esc(p.fav.nome)}${p.info.map(x => `<div class="small muted">${esc(x)}</div>`).join('')}</td><td class="small">${esc(p.fav.tipo)}</td><td>${esc(analisaDocumento(p.dados.documento).formatado)}</td><td class="small">${linhaNFs(p)}</td></tr>`).join('')}</tbody></table></div>`;
  const listaIgn = () => `<div class="table-wrap" style="max-height:420px"><table><thead><tr><th>NF</th><th>Emissão</th><th>Motivo</th></tr></thead><tbody>
    ${res.ignoradas.map(({ n, motivo }) => `<tr><td>${esc(n.numero)}</td><td>${dateBR(n.emissao)}</td><td class="small">${esc(motivo)}</td></tr>`).join('')}</tbody></table></div>`;

  $('#nb-res', m.el).addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (a) { aba = a; return pintar(); }
    const t = e.target.closest('[data-todos]')?.dataset.todos; if (!t) return;
    for (const p of res.participantes) {
      if (t[0] === 'n' && p.sit === 'novo') t === 'n1' ? aprov.add('n|' + p.chave) : aprov.delete('n|' + p.chave);
      if (t[0] === 'd') for (const d of p.difs) { const k = `d|${p.chave}|${d.k}`; (t === 'd1' || (t === 'dc' && d.completar)) ? aprov.add(k) : aprov.delete(k); }
    }
    pintar();
  });
  $('#nb-res', m.el).addEventListener('change', (e) => {
    const trN = e.target.closest('tr[data-n]'), trD = e.target.closest('tr[data-d]');
    if (trN && e.target.matches('[data-tipo]')) { tipoNovo.set(trN.dataset.n, e.target.value); return; }
    if (e.target.type !== 'checkbox') return;
    const k = trN ? 'n|' + trN.dataset.n : trD ? 'd|' + trD.dataset.d : null; if (!k) return;
    e.target.checked ? aprov.add(k) : aprov.delete(k); botao();
  });
  const ler = async (files) => {
    if (!files.length) return;
    $('#nb-res', m.el).innerHTML = `<p class="small">Lendo ${files.length} arquivo(s)…</p>`;
    try {
      const textos = await lerArquivos(files);
      lidos = []; naoLidos = 0;
      for (const t of textos) { const r = participanteNFe(t.xml, cnpjEmp); if (r) lidos.push(r); else naoLidos++; }
      processar();
    } catch (err) { fail(err); $('#nb-res', m.el).innerHTML = ''; }
  };
  $('#arq-pasta', m.el).onchange = (e) => ler([...e.target.files]);
  $('#arq-xml', m.el).onchange = (e) => ler([...e.target.files]);
  // XML já lidos em outra tela (ex.: importação das notas fiscais): processa direto
  if (pre?.length) { lidos = []; naoLidos = 0; for (const t of pre) { const r = participanteNFe(t.xml, cnpjEmp); if (r) lidos.push(r); else naoLidos++; } processar(); }

  $('#nb-ok', m.el).onclick = async () => {
    const ok = $('#nb-ok', m.el); ok.disabled = true;
    const agora = new Date().toISOString();
    try {
      const novos = res.participantes.filter(p => p.sit === 'novo' && aprov.has('n|' + p.chave)).map(p => {
        const t = tipoNovo.get(p.chave) || p.papel; const { regime_normal, ...d } = p.dados;
        const cli = t !== 'FORNECEDORES';
        return { ...d, empresa_id: state.empresa.id, tipo: t, sigla: t === 'TERCEIROS - CLIENTES' ? 'TER' : SIGLA[t], ativo: true,
          contribuinte_icms: cli ? d.contribuinte_icms : null, consumidor_final: cli ? p.nfs.some(n => n.consumidorFinal) : false,
          observacao: `Cadastrado pela NF-e ${p.rec.numero} de ${dateBR(p.rec.emissao)}`, updated_at: agora };
      });
      // nomes repetidos no mesmo tipo (restrição empresa+tipo+nome): acrescenta o fim do CNPJ
      const usados = new Set(state.cad.favorecidos.map(f => `${f.tipo}|${f.nome}`));
      for (const r of novos) { let k = `${r.tipo}|${r.nome}`; if (usados.has(k)) r.nome = `${r.nome} (${String(r.documento).slice(-6)})`; usados.add(`${r.tipo}|${r.nome}`); }
      for (let i = 0; i < novos.length; i += 200) await q(sb.from('favorecidos').insert(novos.slice(i, i + 200)));
      let nUpd = 0;
      for (const p of res.participantes.filter(p => p.sit === 'dif')) {
        const patch = {}; for (const d of p.difs) if (aprov.has(`d|${p.chave}|${d.k}`)) patch[d.k] = d.novo;
        if (!Object.keys(patch).length) continue;
        if (patch.documento) patch.tipo_pessoa = p.dados.tipo_pessoa;
        patch.updated_at = agora;
        await q(sb.from('favorecidos').update(patch).eq('id', p.fav.id)); nUpd++;
      }
      await loadCadastros(true);
      toast(`${novos.length} cadastro(s) criado(s), ${nUpd} atualizado(s)`); m.close(); await onDone();
    } catch (err) { fail(String(err.message || err).includes('duplicate') ? new Error('Já existe um cadastro com esse tipo e nome: ' + (err.message || err)) : err); ok.disabled = false; }
  };
}

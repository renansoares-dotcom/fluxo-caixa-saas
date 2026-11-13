// DANFE (melhoria 3.5): o Documento Auxiliar da NF-e montado a partir do XML autorizado, em PDF, com o código de barras
// da chave de acesso (Code 128 conjunto C). A leitura do XML e o código de barras são puros (testados em Node);
// o desenho usa o jsPDF + autoTable já carregados na página.

// ---------------------------------------------------------------- Code 128 (conjunto C: pares de dígitos)
// larguras barra/espaço de cada símbolo (0 a 105) e a parada (106), na ordem da norma ISO/IEC 15417
const PADROES = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');
export const CODE128_PADROES = PADROES;

/** símbolos do Code 128C: início C (105), os pares, o dígito verificador (módulo 103) e a parada (106) */
export function code128c(digitos) {
  const d = String(digitos || '');
  if (!/^\d+$/.test(d) || d.length % 2) throw new Error('Code 128C precisa de uma quantidade par de dígitos');
  const v = [105];
  for (let i = 0; i < d.length; i += 2) v.push(+d.slice(i, i + 2));
  const soma = v.reduce((s, x, i) => s + x * (i || 1), 0);
  v.push(soma % 103, 106);
  return v;
}

/** larguras alternadas (barra, espaço, barra…) em módulos, prontas para desenhar */
export function code128Barras(digitos) {
  return code128c(digitos).flatMap(s => PADROES[s].split('').map(Number));
}

// ---------------------------------------------------------------- formatação
const so = (s) => String(s ?? '').replace(/\D/g, '');
export const fmtChave = (c) => so(c).replace(/(\d{4})(?=\d)/g, '$1 ');
export function fmtDoc(d) {
  const x = so(d);
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return d || '';
}
export const fmtCep = (c) => { const x = so(c); return x.length === 8 ? x.slice(0, 5) + '-' + x.slice(5) : (c || ''); };
export const fmtNum = (n) => so(n).padStart(9, '0').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1.$2.$3');
const br = (v, c = 2) => v == null || v === '' ? '' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const dataBR = (s) => s ? s.slice(0, 10).split('-').reverse().join('/') : '';
const horaBR = (s) => s && s.length > 15 ? s.slice(11, 19) : '';
export const CRT = { 1: '1 - SIMPLES NACIONAL', 2: '2 - SIMPLES NACIONAL (EXCESSO DE SUBLIMITE)', 3: '3 - REGIME NORMAL', 4: '4 - SIMPLES NACIONAL (MEI)' };
export const MOD_FRETE = { 0: '0-Por conta do Emitente', 1: '1-Por conta do Destinatário', 2: '2-Por conta de Terceiros', 3: '3-Próprio por conta do Remetente', 4: '4-Próprio por conta do Destinatário', 9: '9-Sem Ocorrência de Transporte' };

// ---------------------------------------------------------------- leitura do XML (sem DOM, para rodar também no Node)
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const desc = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const reTag = (tag) => new RegExp(`<(?:\\w+:)?${tag}(\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g');
const bloco = (s, tag) => { if (!s) return ''; const m = reTag(tag).exec(s); return m ? m[2] : ''; };
const todos = (s, tag) => s ? [...s.matchAll(reTag(tag))].map(m => ({ attr: m[1] || '', corpo: m[2] })) : [];
const tx = (s, tag) => { const b = bloco(s, tag); return b ? desc(b.replace(/<[^>]+>/g, '').trim()) : ''; };
const num = (s, tag) => { const v = tx(s, tag); return v === '' ? null : +v; };
// primeiro filho de um grupo (ICMS00, ICMS20, ICMSSN102…)
const filho = (s) => { const m = /<(\w+)[\s>]/.exec(s || ''); return m ? bloco(s, m[1]) : ''; };

/** dados da nota para a DANFE; null se o texto não for uma NF-e */
export function lerDanfe(xml) {
  const s = String(xml || '');
  const infM = /<(?:\w+:)?infNFe([^>]*)>([\s\S]*?)<\/(?:\w+:)?infNFe>/.exec(s);
  if (!infM) return null;
  const inf = infM[2], chave = so((/Id="NFe(\d{44})"/.exec(infM[1]) || [])[1] || tx(s, 'chNFe'));
  const ide = bloco(inf, 'ide'), emit = bloco(inf, 'emit'), dest = bloco(inf, 'dest'), tot = bloco(inf, 'ICMSTot'), transp = bloco(inf, 'transp'), prot = bloco(s, 'infProt');
  const end = (b) => ({ lgr: tx(b, 'xLgr'), nro: tx(b, 'nro'), cpl: tx(b, 'xCpl'), bairro: tx(b, 'xBairro'), mun: tx(b, 'xMun'), uf: tx(b, 'UF'), cep: tx(b, 'CEP'), fone: tx(b, 'fone') });
  const pessoa = (b, e) => ({ nome: tx(b, 'xNome'), fant: tx(b, 'xFant'), doc: tx(b, 'CNPJ') || tx(b, 'CPF'), ie: tx(b, 'IE'), iest: tx(b, 'IEST'), ...end(bloco(b, e)) });
  const vol = bloco(transp, 'vol'), tr = bloco(transp, 'transporta'), veic = bloco(transp, 'veicTransp');
  const itens = todos(inf, 'det').map(({ corpo }) => {
    const p = bloco(corpo, 'prod'), imp = bloco(corpo, 'imposto'), icms = filho(bloco(imp, 'ICMS')), ipi = bloco(imp, 'IPITrib');
    const orig = tx(icms, 'orig'), cst = tx(icms, 'CST') || tx(icms, 'CSOSN');
    // Reforma Tributária (grupo UB): com redução (gRed) vale a alíquota efetiva — NT 2026.010
    const ub = bloco(imp, 'IBSCBS'), gi = bloco(ub, 'gIBSCBS'), gUF = bloco(gi, 'gIBSUF'), gMun = bloco(gi, 'gIBSMun'), gCBS = bloco(gi, 'gCBS'), is = bloco(imp, 'IS');
    const aliq = (g, t) => num(bloco(g, 'gRed'), 'pAliqEfet') ?? num(g, t);
    const rtc = ub || is ? { classTrib: tx(ub, 'cClassTrib'), cst: tx(ub, 'CST'), bc: num(gi, 'vBC'), pIBSUF: aliq(gUF, 'pIBSUF'), vIBSUF: num(gUF, 'vIBSUF'), pIBSMun: aliq(gMun, 'pIBSMun'), vIBSMun: num(gMun, 'vIBSMun'),
      pCBS: aliq(gCBS, 'pCBS'), vCBS: num(gCBS, 'vCBS'), bcIS: num(is, 'vBCIS'), pIS: num(is, 'pIS'), vIS: num(is, 'vIS') } : null;
    return { rtc, cod: tx(p, 'cProd'), desc: tx(p, 'xProd'), ncm: tx(p, 'NCM'), cst: (orig || '') + (cst || ''), cfop: tx(p, 'CFOP'), un: tx(p, 'uCom'),
      qtd: num(p, 'qCom'), vun: num(p, 'vUnCom'), vtot: num(p, 'vProd'), bc: num(icms, 'vBC'), vicms: num(icms, 'vICMS'), picms: num(icms, 'pICMS'),
      bcst: num(icms, 'vBCST'), vst: num(icms, 'vICMSST'), vipi: num(ipi, 'vIPI'), pipi: num(ipi, 'pIPI'), info: tx(corpo, 'infAdProd') };
  });
  const issT = bloco(inf, 'ISSQNtot');
  const rt = bloco(inf, 'IBSCBSTot'), tIBS = bloco(rt, 'gIBS'), tMono = bloco(rt, 'gMono'), tIS = bloco(inf, 'ISTot');
  const totRtc = rt || tIS ? { cbs: num(bloco(rt, 'gCBS'), 'vCBS'), ibsUF: num(bloco(tIBS, 'gIBSUF'), 'vIBSUF'), ibsMun: num(bloco(tIBS, 'gIBSMun'), 'vIBSMun'), is: num(tIS, 'vIS'),
    ibsMono: num(tMono, 'vIBSMono'), cbsMono: num(tMono, 'vCBSMono'), ibsMonoRet: num(tMono, 'vIBSMonoReten'), cbsMonoRet: num(tMono, 'vCBSMonoReten') } : null;
  return {
    crt: tx(emit, 'CRT'), totRtc,
    chave, numero: tx(ide, 'nNF'), serie: tx(ide, 'serie'), tipo: tx(ide, 'tpNF'), natureza: tx(ide, 'natOp'), ambiente: tx(ide, 'tpAmb'),
    emissao: tx(ide, 'dhEmi') || tx(ide, 'dEmi'), saida: tx(ide, 'dhSaiEnt') || tx(ide, 'dSaiEnt'),
    emit: pessoa(emit, 'enderEmit'), dest: pessoa(dest, 'enderDest'),
    protocolo: tx(prot, 'nProt'), autorizada_em: tx(prot, 'dhRecbto'), cstat: tx(prot, 'cStat'),
    dups: todos(bloco(inf, 'cobr'), 'dup').map(({ corpo }) => ({ n: tx(corpo, 'nDup'), venc: tx(corpo, 'dVenc'), valor: num(corpo, 'vDup') })),
    tot: { bc: num(tot, 'vBC'), icms: num(tot, 'vICMS'), bcst: num(tot, 'vBCST'), st: num(tot, 'vST'), prod: num(tot, 'vProd'), frete: num(tot, 'vFrete'),
      seg: num(tot, 'vSeg'), desc: num(tot, 'vDesc'), outro: num(tot, 'vOutro'), ipi: num(tot, 'vIPI'), trib: num(tot, 'vTotTrib'), nf: num(tot, 'vNF'),
      fcp: num(tot, 'vFCP'), fcpST: num(tot, 'vFCPST'), ufDest: num(tot, 'vICMSUFDest'), fcpUFDest: num(tot, 'vFCPUFDest'), deson: num(tot, 'vICMSDeson'),
      mono: num(tot, 'vICMSMono'), monoReten: num(tot, 'vICMSMonoReten'), monoRet: num(tot, 'vICMSMonoRet') },
    iss: issT ? { im: tx(emit, 'IM'), serv: num(issT, 'vServ'), bc: num(issT, 'vBC'), iss: num(issT, 'vISS') } : null,
    transp: { mod: tx(transp, 'modFrete'), nome: tx(tr, 'xNome'), doc: tx(tr, 'CNPJ') || tx(tr, 'CPF'), ie: tx(tr, 'IE'), ender: tx(tr, 'xEnder'), mun: tx(tr, 'xMun'), uf: tx(tr, 'UF'),
      placa: tx(veic, 'placa'), placa_uf: tx(veic, 'UF'), qvol: tx(vol, 'qVol'), esp: tx(vol, 'esp'), marca: tx(vol, 'marca'), nvol: tx(vol, 'nVol'), pesoL: num(vol, 'pesoL'), pesoB: num(vol, 'pesoB') },
    infCpl: tx(bloco(inf, 'infAdic'), 'infCpl'), infFisco: tx(bloco(inf, 'infAdic'), 'infAdFisco'),
    itens,
  };
}

// ---------------------------------------------------------------- PDF
// as fontes padrão do jsPDF só têm Latin-1
const lat = (s) => String(s ?? '').replace(/[\u00b5\u03bc]/g, 'u').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[  ]/g, ' ').replace(/[^\x00-\xff]/g, '');

/** gera a DANFE (retrato, A4, leiaute da NT 2026.010) e devolve o documento jsPDF; d = lerDanfe(xml); o.logo = imagem (data URL) do emitente; o.marca = texto da marca-d'água (prévia) */
export function danfePDF(d, jsPDF, o = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 6, W = 210 - 2 * M;
  doc.setLineWidth(0.2); doc.setDrawColor(0); doc.setTextColor(0);
  // caixa com rótulo pequeno em cima e valor embaixo
  const cx = (x, y, w, h, rot, val, o = {}) => {
    if (o.fundo) { doc.setFillColor(232); doc.rect(x, y, w, h, 'FD'); } else doc.rect(x, y, w, h);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5); doc.text(lat(rot).toUpperCase(), x + 0.8, y + 2);
    doc.setFont('helvetica', o.negrito ? 'bold' : 'normal'); doc.setFontSize(o.tam || 7.5);
    const t = doc.splitTextToSize(lat(val), w - 1.6)[0] || '';
    doc.text(t, o.dir ? x + w - 0.8 : x + 0.8, y + h - 1.2, o.dir ? { align: 'right' } : undefined);
  };
  const sec = (y, t) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.text(lat(t), M, y - 0.6); };
  const linha = (y, h, campos) => { let x = M; const tot = campos.reduce((s, c) => s + c[0], 0); campos.forEach(([p, r, v, o]) => { const w = W * p / tot; cx(x, y, w, h, r, v, o); x += w; }); return y + h; };
  const nf = fmtNum(d.numero), sem = !d.protocolo;
  const enderEmit = [d.emit.lgr, d.emit.nro, d.emit.cpl].filter(Boolean).join(', ');

  // canhoto
  let y = M;
  doc.rect(M, y, W - 40, 8); doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
  doc.text(doc.splitTextToSize(lat(`RECEBEMOS DE ${d.emit.nome} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO. EMISSÃO: ${dataBR(d.emissao)} VALOR TOTAL: R$ ${br(d.tot.nf)} DESTINATÁRIO: ${d.dest.nome}`), W - 42), M + 0.8, y + 2.4);
  cx(M, y + 8, 40, 8, 'Data de recebimento', ''); cx(M + 40, y + 8, W - 80, 8, 'Identificação e assinatura do recebedor', '');
  doc.rect(M + W - 40, y, 40, 16); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('NF-e', M + W - 20, y + 5, { align: 'center' });
  doc.setFontSize(8); doc.text(`Nº ${nf}`, M + W - 20, y + 10, { align: 'center' }); doc.text(`Série ${d.serie}`, M + W - 20, y + 14, { align: 'center' });
  y += 18; doc.setLineDashPattern([1, 1], 0); doc.line(M, y - 1, M + W, y - 1); doc.setLineDashPattern([], 0);

  // emitente, DANFE e chave
  const he = 32, wE = 80, wD = 32, wC = W - wE - wD;
  doc.rect(M, y, wE, he); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  let comLogo = false;
  if (o.logo) { try { doc.addImage(o.logo, /^data:image\/jpe?g/i.test(o.logo) ? 'JPEG' : 'PNG', M + wE / 2 - 13, y + 1.5, 26, 9, undefined, 'FAST'); comLogo = true; } catch { /* logo inválida: segue sem */ } }
  doc.text(doc.splitTextToSize(lat(d.emit.nome), wE - 4).slice(0, comLogo ? 1 : 2), M + wE / 2, y + (comLogo ? 14 : 7), { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  [enderEmit, [d.emit.bairro, fmtCep(d.emit.cep)].filter(Boolean).join(' - '), `${d.emit.mun} - ${d.emit.uf}`, d.emit.fone ? `Fone: ${d.emit.fone}` : ''].filter(Boolean)
    .forEach((t, i) => doc.text(lat(t), M + wE / 2, y + 17 + i * 3.4, { align: 'center' }));
  doc.rect(M + wE, y, wD, he); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('DANFE', M + wE + wD / 2, y + 5, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
  doc.text(['Documento Auxiliar da', 'Nota Fiscal Eletrônica'].map(lat), M + wE + wD / 2, y + 8.5, { align: 'center' });
  doc.text(['0 - Entrada', '1 - Saída'], M + wE + 3, y + 15);
  doc.rect(M + wE + wD - 9, y + 12.5, 6, 5); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(d.tipo || '', M + wE + wD - 6, y + 16.4, { align: 'center' });
  doc.setFontSize(8); doc.text(`Nº ${nf}`, M + wE + wD / 2, y + 22, { align: 'center' }); doc.text(`Série ${d.serie}`, M + wE + wD / 2, y + 25.5, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.text('Folha 1/{fl}', M + wE + wD / 2, y + 29.5, { align: 'center' });
  const xc = M + wE + wD;
  doc.rect(xc, y, wC, 14);
  if (d.chave.length === 44) { // código de barras: 46 módulos de dados + início, verificador e parada
    const bar = code128Barras(d.chave), mods = bar.reduce((s, b) => s + b, 0), mw = (wC - 6) / mods;
    let bx = xc + 3; doc.setFillColor(0);
    bar.forEach((b, i) => { if (i % 2 === 0) doc.rect(bx, y + 1.5, b * mw, 11, 'F'); bx += b * mw; });
  }
  cx(xc, y + 14, wC, 7, 'Chave de acesso', fmtChave(d.chave), { negrito: true, tam: 7.5 });
  doc.rect(xc, y + 21, wC, he - 21); doc.setFontSize(6.5);
  doc.text(doc.splitTextToSize('Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora', wC - 4).map(lat), xc + wC / 2, y + 24.5, { align: 'center' });
  y += he;
  y = linha(y, 7, [[60, 'Natureza da operação', d.natureza], [40, 'Protocolo de autorização de uso', sem ? 'NÃO AUTORIZADA' : `${d.protocolo} - ${dataBR(d.autorizada_em)} ${horaBR(d.autorizada_em)}`]]);
  // NT 2026.010: código do regime tributário (CRT) e área reservada ao regime de apuração do IBS/CBS (sem conteúdo até a NT futura)
  y = linha(y, 7, [[31, 'Inscrição estadual', d.emit.ie], [36, 'Inscrição estadual do substituto tributário', d.emit.iest], [33, 'CNPJ / CPF', fmtDoc(d.emit.doc)]]);
  y = linha(y, 7, [[49, 'Código do regime tributário', CRT[d.crt] || d.crt || ''], [51, 'Tipo de regime de apuração do IBS e da CBS', '', { fundo: true }]]);

  // destinatário
  y += 3; sec(y, 'DESTINATÁRIO / REMETENTE');
  y = linha(y, 7, [[62, 'Nome / razão social', d.dest.nome], [23, 'CNPJ / CPF', fmtDoc(d.dest.doc)], [15, 'Data da emissão', dataBR(d.emissao)]]);
  y = linha(y, 7, [[47, 'Endereço', [d.dest.lgr, d.dest.nro, d.dest.cpl].filter(Boolean).join(', ')], [23, 'Bairro / distrito', d.dest.bairro], [15, 'CEP', fmtCep(d.dest.cep)], [15, 'Data da saída/entrada', dataBR(d.saida)]]);
  y = linha(y, 7, [[40, 'Município', d.dest.mun], [20, 'Fone / fax', d.dest.fone], [7, 'UF', d.dest.uf], [18, 'Inscrição estadual', d.dest.ie], [15, 'Hora da saída', horaBR(d.saida)]]);

  // fatura
  if (d.dups.length) {
    y += 3; sec(y, 'FATURA / DUPLICATAS');
    const por = 6, wd = W / por, hl = 9;
    d.dups.forEach((u, i) => {
      const x = M + (i % por) * wd, yy = y + Math.floor(i / por) * hl;
      doc.rect(x, yy, wd, hl); doc.setFontSize(6); doc.setFont('helvetica', 'normal');
      doc.text([`Nº ${lat(u.n)}`, `Venc. ${dataBR(u.venc)}`, `R$ ${br(u.valor)}`], x + 1, yy + 2.6);
    });
    y += Math.ceil(d.dups.length / por) * hl;
  }

  // totais no desenho do modelo da NT 2026.010: produtos e nota; ICMS / IPI; IBS / CBS / IS. Campos condicionais só quando existem no XML.
  const t = d.tot, R = { dir: true }, tem = (...v) => v.some(x => x != null && +x !== 0);
  y += 3; sec(y, 'TOTAL DOS PRODUTOS E TOTAL DA NOTA');
  y = linha(y, 7, [[1.3, 'Valor total dos produtos', br(t.prod), R], [1, 'Valor do frete', br(t.frete), R], [1, 'Valor do seguro', br(t.seg), R], [1, 'Desconto', br(t.desc), R], [1, 'Outras despesas', br(t.outro), R]]);
  y = linha(y, 7, [[1.3, 'Valor total da nota', br(t.nf), { dir: true, negrito: true }], [4, 'Valor aproximado dos tributos', br(t.trib)]]);
  y += 3; sec(y, 'TOTAL DO ICMS / IPI');
  y = linha(y, 7, [[1.3, 'Base de cálculo do ICMS', br(t.bc), R], [1, 'Valor do ICMS', br(t.icms), R], [1, 'Base de cálculo do ICMS ST', br(t.bcst), R], [1, 'Valor do ICMS ST', br(t.st), R], [1, 'Valor do IPI', br(t.ipi), R]]);
  if (tem(t.fcp, t.fcpST, t.ufDest, t.fcpUFDest))
    y = linha(y, 7, [[1, 'Valor do FCP', br(t.fcp), R], [1, 'Valor do FCP retido por ST', br(t.fcpST), R], [1, 'Valor do ICMS da UF de destino', br(t.ufDest), R], [1, 'Valor do FCP da UF de destino', br(t.fcpUFDest), R]]);
  if (tem(t.deson, t.mono, t.monoReten, t.monoRet))
    y = linha(y, 7, [[1, 'Valor do ICMS desonerado', br(t.deson), R], [1, 'Valor do ICMS monofásico', br(t.mono), R], [1, 'ICMS monofásico sujeito a retenção', br(t.monoReten), R], [1, 'ICMS monofásico retido anteriormente', br(t.monoRet), R]]);

  // NT 2026.010: bloco "Total do IBS/CBS/IS", logo depois do Total do ICMS/IPI. Só o que existir no XML é impresso.
  const z = d.totRtc || {}, vz = (v) => v == null ? '' : br(v);
  y += 3; sec(y, 'TOTAL DO IBS / CBS / IS');
  y = linha(y, 7, [[1, 'Valor da CBS', vz(z.cbs), R], [1, 'Valor do IBS UF', vz(z.ibsUF), R], [1, 'Valor do IBS Município', vz(z.ibsMun), R], [1, 'Valor do Imposto Seletivo', vz(z.is), R]]);
  if ([z.ibsMono, z.cbsMono, z.ibsMonoRet, z.cbsMonoRet].some(v => v != null))
    y = linha(y, 7, [[1, 'Valor do IBS monofásico', vz(z.ibsMono), R], [1, 'Valor da CBS monofásica', vz(z.cbsMono), R], [1, 'IBS monofásico por retenção', vz(z.ibsMonoRet), R], [1, 'CBS monofásica por retenção', vz(z.cbsMonoRet), R]]);

  if (d.iss) { y += 3; sec(y, 'CÁLCULO DO ISSQN');
    y = linha(y, 7, [[1, 'Inscrição municipal', d.iss.im], [1, 'Valor total dos serviços', br(d.iss.serv), R], [1, 'Base de cálculo do ISSQN', br(d.iss.bc), R], [1, 'Valor do ISSQN', br(d.iss.iss), R]]); }

  // transportador
  y += 3; sec(y, 'TRANSPORTADOR / VOLUMES TRANSPORTADOS'); const p = d.transp;
  y = linha(y, 7, [[34, 'Nome / razão social', p.nome], [18, 'Frete', MOD_FRETE[p.mod] || p.mod], [10, 'Código ANTT', ''], [10, 'Placa do veículo', p.placa], [5, 'UF', p.placa_uf], [23, 'CNPJ / CPF', fmtDoc(p.doc)]]);
  y = linha(y, 7, [[44, 'Endereço', p.ender], [28, 'Município', p.mun], [5, 'UF', p.uf], [23, 'Inscrição estadual', p.ie]]);
  y = linha(y, 7, [[12, 'Quantidade', p.qvol], [18, 'Espécie', p.esp], [18, 'Marca', p.marca], [18, 'Numeração', p.nvol], [17, 'Peso bruto', br(p.pesoB, 3), R], [17, 'Peso líquido', br(p.pesoL, 3), R]]);

  // produtos
  y += 3; sec(y, 'DADOS DOS PRODUTOS / SERVIÇOS');
  const topoFolha = (n) => { // folhas seguintes: identificação resumida
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text(lat(`DANFE - NF-e Nº ${nf} Série ${d.serie} - ${d.emit.nome}`), M, M + 3);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(`Chave ${fmtChave(d.chave)}`, M, M + 6.5); doc.text(`Folha ${n}/{fl}`, M + W, M + 3, { align: 'right' });
  };
  doc.autoTable({
    startY: y, margin: { left: M, right: M, top: M + 10, bottom: 34 }, theme: 'grid',
    styles: { font: 'helvetica', fontSize: 6, cellPadding: 0.7, lineColor: 0, lineWidth: 0.15, textColor: 0, overflow: 'linebreak' },
    headStyles: { fillColor: false, textColor: 0, fontStyle: 'bold', fontSize: 5.5, halign: 'center' },
    head: [['Descrição do produto / serviço', 'CST\nCFOP', 'Qtd.\nUn', 'Vlr. unit.', 'Vlr. total', 'Bases de cálculo', 'Alíquotas', 'Valor dos tributos']],
    // modelo da NT 2026.010: um item por linha, com as bases, as alíquotas e os valores de cada tributo empilhados
    body: d.itens.map(i => { const r = i.rtc || {}, pz = (v) => v == null ? '-' : br(v, 4).replace(/(,\d*?)0+$/, '$1').replace(/,$/, '') + '%', vv = (v) => v == null ? '-' : br(v);
      const par = (a, b) => `${a}   |   ${b}`;
      return [
        lat(i.desc + (i.info ? '\n' + i.info : '') + `\nCód. ${i.cod} · NCM ${i.ncm}${r.classTrib ? ' · cClassTrib ' + r.classTrib : ''}`),
        lat([`CST ${i.cst || '-'}`, r.cst ? `IBS/CBS ${r.cst}` : '', `CFOP ${i.cfop}`].filter(Boolean).join('\n')),
        `${br(i.qtd, 4)}\n${lat(i.un)}`, br(i.vun, 4), br(i.vtot),
        [`ICMS ${vv(i.bc)}`, tem(i.bcst) ? `ICMS ST ${vv(i.bcst)}` : '', `IBS/CBS ${vv(r.bc)}`, r.bcIS != null ? `IS ${vv(r.bcIS)}` : ''].filter(Boolean).join('\n'),
        [par(`ICMS ${pz(i.picms)}`, `CBS ${pz(r.pCBS)}`), par(`IBS UF ${pz(r.pIBSUF)}`, `IPI ${pz(i.pipi)}`), par(`IBS Mun. ${pz(r.pIBSMun)}`, `IS ${pz(r.pIS)}`)].join('\n'),
        [par(`ICMS ${vv(i.vicms)}`, `CBS ${vv(r.vCBS)}`), par(`IBS UF ${vv(r.vIBSUF)}`, `IPI ${vv(i.vipi)}`), par(`IBS Mun. ${vv(r.vIBSMun)}`, `IS ${vv(r.vIS)}`), tem(i.vst) ? `ICMS ST ${vv(i.vst)}` : ''].filter(Boolean).join('\n'),
      ]; }),
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 17 }, 2: { cellWidth: 15, halign: 'right' }, 3: { cellWidth: 15, halign: 'right' }, 4: { cellWidth: 16, halign: 'right' },
      5: { cellWidth: 25 }, 6: { cellWidth: 34 }, 7: { cellWidth: 38 } },
    didDrawPage: (h) => { if (h.pageNumber > 1) topoFolha(h.pageNumber); },
  });

  // dados adicionais (no rodapé da primeira folha, como no leiaute)
  doc.setPage(1);
  const ya = 297 - M - 26;
  sec(ya, 'DADOS ADICIONAIS');
  // espaço do QR Code como no modelo; o conteúdo depende de nota técnica futura, por isso fica vazio
  const wQ = 30, wA = W - wQ - 2, wI = wA * 0.6;
  doc.rect(M, ya, wI, 26); doc.rect(M + wI, ya, wA - wI, 26); doc.setFillColor(232); doc.rect(M + wA + 2, ya, wQ, 26, 'FD');
  doc.setFontSize(5); doc.text('INFORMAÇÕES COMPLEMENTARES', M + 0.8, ya + 2); doc.text('RESERVADO AO FISCO', M + wI + 0.8, ya + 2);
  doc.setFont('helvetica', 'bold'); doc.text('QR CODE', M + wA + 2 + wQ / 2, ya + 2.4, { align: 'center' }); doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const compl = [d.infCpl, d.infFisco].filter(Boolean).join(' ');
  doc.text(doc.splitTextToSize(lat(compl), wI - 2).slice(0, 9), M + 0.8, ya + 4.6);
  if (o.marca || sem || d.ambiente === '2') { // prévia, sem protocolo ou homologação: marca d'água
    const tot = doc.getNumberOfPages();
    for (let i = 1; i <= tot; i++) { doc.setPage(i); doc.setTextColor(200); doc.setFont('helvetica', 'bold'); doc.setFontSize(34);
      doc.text(lat(o.marca || (d.ambiente === '2' ? 'SEM VALOR FISCAL' : 'NÃO AUTORIZADA')), 105, 170, { align: 'center', angle: 30 }); doc.setTextColor(0); }
  }
  if (typeof doc.putTotalPages === 'function') doc.putTotalPages('{fl}');
  return doc;
}

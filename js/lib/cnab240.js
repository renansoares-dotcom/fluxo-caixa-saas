// Remessa de pagamentos CNAB 240 — padrão FEBRABAN (melhoria 3.6). Funções puras, testadas em tests/cnab240.test.js.
// Lotes por forma de lançamento: 01 crédito em conta (mesmo banco), 41 TED (outro banco), 45 Pix, 30/31 boletos
// (mesmo banco / outros bancos). Segmentos A+B (crédito, TED, Pix) e J (+J-52) para boletos.
// Cada banco tem particularidades: as versões de layout, a finalidade da TED e o J-52 são configuráveis na conta
// (contas.cnab_layout) e o primeiro arquivo deve ser homologado com o banco.

export const LAYOUT_PADRAO = { versao_arquivo: '103', versao_lote: '046', finalidade_ted: '00005', j52: true, pix_segmento_b: true };
export const FORMAS = { credito: { cod: '01', nome: 'Crédito em conta (mesmo banco)' }, ted: { cod: '41', nome: 'TED' }, pix: { cod: '45', nome: 'Pix' },
  boleto: { cod: '31', nome: 'Boleto' } };
export const BANCOS = { '001': 'BANCO DO BRASIL', '033': 'SANTANDER', '041': 'BANRISUL', '070': 'BRB', '077': 'INTER', '104': 'CAIXA', '133': 'CRESOL', '136': 'UNICRED',
  '208': 'BTG PACTUAL', '237': 'BRADESCO', '260': 'NU PAGAMENTOS', '336': 'C6', '341': 'ITAU', '422': 'SAFRA', '748': 'SICREDI', '756': 'SICOOB' };

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ');
/** campo alfanumérico: maiúsculas, sem acento, à esquerda com brancos */
export const A = (s, n) => semAcento(s).toUpperCase().slice(0, n).padEnd(n, ' ');
/** chave Pix: mantém maiúsculas e minúsculas (e-mail e chave aleatória) */
const K = (s, n) => semAcento(s).trim().slice(0, n).padEnd(n, ' ');
/** campo numérico: só dígitos, à direita com zeros */
export const N = (s, n) => { const d = String(s ?? '').replace(/\D/g, ''); return d.slice(-n).padStart(n, '0'); };
/** valor com 2 decimais sem vírgula */
export const V = (v, n) => N(Math.round(Math.abs(+v || 0) * 100), n);
const dataDMA = (iso) => (iso ? `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}` : '00000000');
const soDig = (s) => String(s ?? '').replace(/\D/g, '');

// ---------- boletos ----------
const mod10 = (s) => { let soma = 0, p = 2; for (let i = s.length - 1; i >= 0; i--) { let r = +s[i] * p; if (r > 9) r = Math.floor(r / 10) + (r % 10); soma += r; p = p === 2 ? 1 : 2; } const d = (10 - (soma % 10)) % 10; return d; };
const mod11Barras = (s) => { let soma = 0, p = 2; for (let i = s.length - 1; i >= 0; i--) { soma += +s[i] * p; p = p === 9 ? 2 : p + 1; } const r = 11 - (soma % 11); return r === 0 || r > 9 ? 1 : r; };

/** linha digitável (47) ou código de barras (44) → { barras, banco, vencimento, valor } ou { erro } */
export function lerBoleto(txt, hoje = new Date()) {
  const d = soDig(txt);
  if (d.length === 48 || d.startsWith('8')) return { erro: 'Conta de consumo / tributo (começa com 8) não é paga pelo segmento J. Pague pelo banco.' };
  let barras;
  if (d.length === 47) {
    for (const [ini, fim, dv] of [[0, 9, 9], [10, 20, 20], [21, 31, 31]]) if (mod10(d.slice(ini, fim)) !== +d[dv]) return { erro: 'Linha digitável com dígito verificador errado. Confira a digitação.' };
    barras = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  } else if (d.length === 44) barras = d;
  else return { erro: 'Informe a linha digitável (47 números) ou o código de barras (44).' };
  if (mod11Barras(barras.slice(0, 4) + barras.slice(5)) !== +barras[4]) return { erro: 'Código de barras com dígito verificador errado.' };
  const fator = +barras.slice(5, 9), valor = +barras.slice(9, 19) / 100;
  // fator de vencimento: base 07/10/1997 até o fator 9999 (21/02/2025); depois recomeça em 1000 = 22/02/2025.
  // Os dois calendários convivem: vale a data mais perto de hoje.
  let venc = null;
  if (fator) {
    const c1 = Date.UTC(1997, 9, 7) + fator * 864e5, c2 = Date.UTC(2025, 1, 22) + (fator - 1000) * 864e5, h = hoje.getTime();
    venc = new Date(fator >= 1000 && Math.abs(c2 - h) < Math.abs(c1 - h) ? c2 : c1).toISOString().slice(0, 10);
  }
  return { barras, banco: barras.slice(0, 3), vencimento: venc, valor };
}

// ---------- forma de pagamento de cada título ----------
/** decide a forma pelo que existe: boleto > Pix > crédito/TED pelos dados bancários */
export function formaSugerida(t, contaBanco) {
  if (t.codigo_barras) return 'boleto';
  const f = t.fav || {};
  if (f.pix && f.pix_tipo) return 'pix';
  if (f.banco_codigo && f.agencia && f.conta_numero) return f.banco_codigo === contaBanco ? 'credito' : 'ted';
  return null;
}
/** o que falta para pagar o título pela forma escolhida */
export function pendencias(t, forma) {
  const f = t.fav || {}, p = [];
  if (!(+t.valor > 0)) p.push('valor');
  if (forma === 'boleto') { const b = lerBoleto(t.codigo_barras); if (b.erro) p.push(b.erro); }
  else {
    if (!soDig(f.documento) || ![11, 14].includes(soDig(f.documento).length)) p.push('CPF/CNPJ do beneficiário');
    if (forma === 'pix') { if (!f.pix) p.push('chave Pix'); if (!f.pix_tipo) p.push('tipo da chave Pix'); }
    if (forma === 'credito' || forma === 'ted') { if (!f.banco_codigo) p.push('banco'); if (!f.agencia) p.push('agência'); if (!f.conta_numero) p.push('conta'); }
  }
  return p;
}

// ---------- registros ----------
const empresaCampos = (E, C) => {
  const doc = soDig(E.cnpj);
  return { tipo: doc.length === 11 ? '1' : '2', doc: N(doc, 14), convenio: A(C.convenio, 20), agencia: N(C.agencia, 5), agDv: A(C.agencia_dv, 1),
    conta: N(C.conta, 12), ctDv: A(C.conta_dv, 1), nome: A(E.nome, 30) };
};
const reg = (s) => { if (s.length !== 240) throw new Error(`registro com ${s.length} posições`); return s; };

function headerArquivo(E, C, L, nsa, agora) {
  const e = empresaCampos(E, C);
  return reg(N(C.banco, 3) + '0000' + '0' + ' '.repeat(9) + e.tipo + e.doc + e.convenio + e.agencia + e.agDv + e.conta + e.ctDv + ' ' + e.nome
    + A(BANCOS[C.banco] || 'BANCO', 30) + ' '.repeat(10) + '1' + agora.data + agora.hora + N(nsa, 6) + N(L.versao_arquivo, 3) + '00000'
    + ' '.repeat(20) + ' '.repeat(20) + ' '.repeat(29));
}
function headerLote(E, C, L, lote, forma) {
  const e = empresaCampos(E, C), servico = '20', fl = forma === 'boleto' ? (C.boletoMesmoBanco ? '30' : '31') : FORMAS[forma].cod;
  const versaoLote = forma === 'boleto' ? (L.versao_lote_j || '040') : L.versao_lote;
  return reg(N(C.banco, 3) + N(lote, 4) + '1' + 'C' + servico + fl + N(versaoLote, 3) + ' ' + e.tipo + e.doc + e.convenio + e.agencia + e.agDv + e.conta + e.ctDv + ' ' + e.nome
    + A('', 40) + A(E.logradouro, 30) + N('', 5) + A('', 15) + A(E.municipio, 20) + N(soDig(E.cep).slice(0, 5), 5) + N(soDig(E.cep).slice(5, 8), 3) + A(E.uf, 2)
    + '01' + ' '.repeat(6) + ' '.repeat(10));
}
function segA(C, L, lote, seq, t, forma, data) {
  const f = t.fav, camara = forma === 'ted' ? '018' : forma === 'pix' ? '009' : '000';
  const banco = forma === 'pix' && !f.banco_codigo ? '000' : N(f.banco_codigo, 3);
  return reg(N(C.banco, 3) + N(lote, 4) + '3' + N(seq, 5) + 'A' + '0' + '00' + camara + banco + N(forma === 'pix' && !f.agencia ? '' : f.agencia, 5) + A(f.agencia_dv, 1)
    + N(forma === 'pix' && !f.conta_numero ? '' : f.conta_numero, 12) + A(f.conta_dv, 1) + ' ' + A(f.nome, 30) + A(t.seu_numero, 20) + dataDMA(data) + 'BRL' + N('', 15) + V(t.valor, 15)
    + A('', 20) + N('', 8) + N('', 15) + A(t.descricao, 40) + A('', 2) + (forma === 'ted' ? N(L.finalidade_ted, 5) : A('', 5)) + A(f.conta_tipo === 'PP' ? 'PP' : forma === 'pix' ? '' : 'CC', 2) + A('', 3) + '0' + A('', 10));
}
const FORMA_PIX = { telefone: '01', email: '02', cpf_cnpj: '03', aleatoria: '04' };
function segB(C, L, lote, seq, t, forma) {
  const f = t.fav, doc = soDig(f.documento), tipo = doc.length === 11 ? '1' : '2';
  if (forma === 'pix' && L.pix_segmento_b) {
    // FEBRABAN 10.11 (Pix): forma de iniciação + chave na posição 128-226
    return reg(N(C.banco, 3) + N(lote, 4) + '3' + N(seq, 5) + 'B' + A(FORMA_PIX[f.pix_tipo] || '', 3) + tipo + N(doc, 14) + A('', 35) + A('', 60) + K(f.pix_tipo === 'cpf_cnpj' || f.pix_tipo === 'telefone' ? f.pix.replace(/[^\d+]/g, '') : f.pix, 99) + A('', 6) + N(f.ispb || '', 8));
  }
  return reg(N(C.banco, 3) + N(lote, 4) + '3' + N(seq, 5) + 'B' + A('', 3) + tipo + N(doc, 14) + A(f.logradouro, 30) + N('', 5) + A('', 15) + A('', 15) + A(f.municipio, 20)
    + N(soDig(f.cep).slice(0, 5), 5) + N(soDig(f.cep).slice(5, 8), 3) + A(f.uf, 2) + dataDMA(t.vencimento) + V(t.valor, 15) + N('', 15) + N('', 15) + N('', 15) + N('', 15)
    + A('', 15) + '0' + A('', 6) + N('', 8));
}
function segJ(C, lote, seq, t, data) {
  const b = lerBoleto(t.codigo_barras);
  return reg(N(C.banco, 3) + N(lote, 4) + '3' + N(seq, 5) + 'J' + '0' + '00' + b.barras + A(t.fav?.nome || t.favorecido, 30) + dataDMA(b.vencimento || t.vencimento)
    + V(b.valor || t.valor, 15) + V(t.desconto || 0, 15) + V(t.acrescimo || 0, 15) + dataDMA(data) + V(t.valor, 15) + N('', 15) + A(t.seu_numero, 20) + A('', 20) + '09' + A('', 6) + A('', 10));
}
function segJ52(E, C, lote, seq, t) {
  const pd = soDig(E.cnpj), bd = soDig(t.fav?.documento);
  return reg(N(C.banco, 3) + N(lote, 4) + '3' + N(seq, 5) + 'J' + '0' + '00' + '52' + (pd.length === 11 ? '1' : '2') + N(pd, 15) + A(E.razao_social || E.nome, 40)
    + (bd.length === 11 ? '1' : bd.length === 14 ? '2' : '0') + N(bd, 15) + A(t.fav?.nome || t.favorecido, 40) + '0' + N('', 15) + A('', 40) + A('', 53));
}
function trailerLote(C, lote, qtdReg, soma) {
  return reg(N(C.banco, 3) + N(lote, 4) + '5' + A('', 9) + N(qtdReg, 6) + V(soma, 18) + N('', 18) + N('', 6) + A('', 165) + A('', 10));
}
function trailerArquivo(C, lotes, regs) {
  return reg(N(C.banco, 3) + '9999' + '9' + A('', 9) + N(lotes, 6) + N(regs, 6) + N('', 6) + A('', 205));
}

/**
 * monta o arquivo. E = empresa {nome, razao_social, cnpj, logradouro, municipio, uf, cep}; C = conta {banco, agencia, agencia_dv,
 * conta, conta_dv, convenio, layout}; titulos = [{forma, valor, vencimento, seu_numero, descricao, codigo_barras, fav:{...}}]
 * Devolve { texto, linhas, lotes, total, nome }.
 */
export function gerarRemessa({ E, C, titulos, nsa, data, agora = new Date() }) {
  const L = { ...LAYOUT_PADRAO, ...(C.layout || {}) };
  const p2 = (n) => String(n).padStart(2, '0');
  const ag = { data: `${p2(agora.getDate())}${p2(agora.getMonth() + 1)}${agora.getFullYear()}`, hora: `${p2(agora.getHours())}${p2(agora.getMinutes())}${p2(agora.getSeconds())}` };
  const out = [headerArquivo(E, C, L, nsa, ag)];
  let lote = 0, total = 0;
  const grupos = {};
  for (const t of titulos) {
    const k = t.forma === 'boleto' ? (lerBoleto(t.codigo_barras).banco === C.banco ? 'boleto_mesmo' : 'boleto') : t.forma;
    (grupos[k] ||= []).push(t);
  }
  for (const k of ['credito', 'ted', 'pix', 'boleto_mesmo', 'boleto']) {
    const G = grupos[k]; if (!G?.length) continue;
    lote++; let seq = 0, soma = 0;
    const forma = k.startsWith('boleto') ? 'boleto' : k;
    out.push(headerLote(E, { ...C, boletoMesmoBanco: k === 'boleto_mesmo' }, L, lote, forma));
    for (const t of G) {
      if (forma === 'boleto') { out.push(segJ(C, lote, ++seq, t, data)); if (L.j52) out.push(segJ52(E, C, lote, ++seq, t)); }
      else { out.push(segA(C, L, lote, ++seq, t, forma, data)); out.push(segB(C, L, lote, ++seq, t, forma)); }
      soma += +t.valor;
    }
    out.push(trailerLote(C, lote, seq + 2, soma));
    total += soma;
  }
  out.push(trailerArquivo(C, lote, out.length + 1));
  return { texto: out.join('\r\n') + '\r\n', linhas: out, lotes: lote, total: Math.round(total * 100) / 100,
    nome: `PAG_${N(C.banco, 3)}_${data.replace(/-/g, '')}_${N(nsa, 6)}.REM` };
}

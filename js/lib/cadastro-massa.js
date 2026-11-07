// Estoque › Cadastro pelas Notas (SQL 085) — regras puras, sem acesso ao banco (tests/cadastro-massa.test.js).
// Cada item de compra sem de-para (CNPJ + código do fornecedor) recebe a família pelas regras de classificação, a unidade e o fator.
// Itens do mesmo material viram UM produto: resinas, master e tintas pelo grau (ex.: "2022N", "PL720N") e pelo NCM;
// os demais pela descrição limpa. Os grupos saem ordenados por valor, com o acumulado e a curva ABC.

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const norm = (s) => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();
const r2 = (v) => Math.round((+v + Number.EPSILON) * 100) / 100;

/** descrição limpa: sem quantidade da nota ("QTD. 98.00 MT"), sem códigos entre parênteses, sem embalagem no fim ("SC 25KG"), sem pontuação solta */
export function limpar(desc) {
  return norm(desc)
    .replace(/\bQTD\.?\s*[\d.,]+\s*[A-Z]{0,3}\b/g, ' ')
    .replace(/\([^)]*\d[^)]*\)/g, ' ')
    .replace(/\b(SC|SACO|BB|BAG|BIG ?BAG|CX|FD|LATA\d*|BOMB\d*|BALDE)\s*(C\/|DE|COM)?\s*[\d.,]+\s*(KG|L|LT|G)\b/g, ' ')
    .replace(/\s[-–]\s*$/g, ' ').replace(/[;:,]+/g, ' ').replace(/\s+-\s+/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[-.]$/, '').trim();
}

const UNID_MEDIDA = /^\d+([.,]\d+)?(KG|G|MG|L|LT|ML|MM|CM|M|MT|UN|PC|CX|KVA|W|V|HZ|MICRAS?|MIC|PCS)$/;
const QUIMICOS = new Set(['TIO2', 'CACO3', 'SIO2', 'ZNO2', 'AL2O3', 'FE2O3', 'H2O2', 'CO2', 'NH3']);   // fórmulas não são grau
/** grau / referência do material: 1º termo com letras e números (2022N, PL720N, HF0144, 4%-like ficam de fora) */
export function grau(desc) {
  for (const t of limpar(desc).split(/[\s/]+/)) {
    const x = t.replace(/[^A-Z0-9-]/g, '');
    if (x.length < 4 || x.length > 12) continue;
    if (!/[A-Z]/.test(x) || (x.match(/\d/g) || []).length < 2 || UNID_MEDIDA.test(x) || /^\d{1,2}[A-Z]$/.test(x) || QUIMICOS.has(x)) continue;
    return x;
  }
  return null;
}

/** a família de um item pelas regras (ordem crescente); regra sem NCM e sem palavras vale para tudo */
export function classificar(item, regras) {
  const ncm = String(item.ncm || '').replace(/\D/g, ''), d = ` ${norm(item.descricao)} `;   // espaços nas pontas: ' CA ' casa no começo e no fim
  const vu = +item.quantidade ? (+item.valor || 0) / +item.quantidade : +item.valor || 0;
  for (const r of [...regras].filter(x => x.ativo !== false).sort((a, b) => a.ordem - b.ordem)) {
    if (r.valor_unit_min != null && vu < +r.valor_unit_min) continue;
    const temN = (r.ncm_prefixos || []).length, temP = (r.palavras || []).length;
    if (!temN && !temP) return r.familia_id;
    if ((temN && r.ncm_prefixos.some(p => ncm.startsWith(p))) || (temP && r.palavras.some(p => d.includes(semAcento(p).toUpperCase())))) return r.familia_id;
  }
  return null;
}

/** unidade do produto e fator (1 unidade do fornecedor = fator unidades do produto) */
export function unidadeFator(item, familiaCod = '') {
  const u = norm(item.unidade).replace(/[^A-Z]/g, '') || 'UN', d = norm(item.descricao);
  const porPeso = ['RESINA', 'MASTER'].includes(familiaCod);
  const kg = d.match(/([\d]+(?:[.,]\d+)?)\s*KG\b/);
  const pesoEmb = kg ? +kg[1].replace(/\.(?=\d{3}\b)/, '').replace(',', '.') : null;
  if (['KG', 'KGS', 'QUILO', 'KILO', 'KILOS', 'QUILOS'].includes(u)) return { unidade: 'KG', fator: 1 };
  if (['TON', 'TN', 'T', 'TONELADA'].includes(u)) return { unidade: 'KG', fator: 1000 };
  if (u === 'G' || u === 'GR') return porPeso ? { unidade: 'KG', fator: 0.001 } : { unidade: 'G', fator: 1 };
  if (['SC', 'SACO', 'SAC', 'BB', 'BAG', 'BIGBAG', 'FD', 'CX', 'UN', 'UND', 'PC'].includes(u) && porPeso && pesoEmb > 0) return { unidade: 'KG', fator: pesoEmb };
  if (u === 'LT' || u === 'LTS' || u === 'LITRO') return { unidade: 'L', fator: 1 };
  if (['UND', 'UNID', 'UNIDADE', 'UNI'].includes(u)) return { unidade: 'UN', fator: 1 };
  if (['PCS', 'PECA', 'PC'].includes(u)) return { unidade: 'PC', fator: 1 };
  if (['MT', 'MTS', 'METRO', 'M'].includes(u)) return { unidade: 'M', fator: 1 };
  return { unidade: porPeso ? 'KG' : u, fator: 1, revisar: porPeso && u !== 'KG' };
}

/** monta os grupos (produtos propostos) a partir dos itens pendentes */
export function agrupar(itens, regras, familias, { porGrau = ['RESINA', 'MASTER', 'TINTA'] } = {}) {
  const fById = Object.fromEntries(familias.map(f => [f.id, f])), G = new Map();
  for (const it of itens) {
    const fid = classificar(it, regras), f = fById[fid], fc = f?.codigo || '';
    const g = porGrau.includes(fc) ? grau(it.descricao) : null, ncm4 = String(it.ncm || '').replace(/\D/g, '').slice(0, 4);
    // material sem grau na descrição ("POLIETILENO DE ALTA DENSIDADE") só junta dentro do mesmo fornecedor: em outro pode ser grau diferente
    const chave = fc === 'NAOEST' ? 'NAOEST' : g ? `${fc}|${ncm4}|${g}` : porGrau.includes(fc) ? `${fc}|${it.emit_doc}|${limpar(it.descricao)}` : `${fc}|${limpar(it.descricao)}`;
    const uf = unidadeFator(it, fc);
    if (!G.has(chave)) G.set(chave, { chave, familia_id: fid || null, familia: fc, grau: g, ncm: it.ncm || null, unidade: uf.unidade, itens: [], valor: 0, nao_estoque: fc === 'NAOEST' });
    const x = G.get(chave); x.itens.push({ ...it, fator: uf.fator, unidade_produto: uf.unidade, revisar: !!uf.revisar }); x.valor = r2(x.valor + (+it.valor || 0));
  }
  const total = [...G.values()].reduce((s, g) => s + g.valor, 0); let acum = 0;
  return [...G.values()].sort((a, b) => b.valor - a.valor).map(g => {
    const maior = [...g.itens].sort((a, b) => (+b.valor || 0) - (+a.valor || 0))[0];
    acum += g.valor; const pa = total ? acum / total : 1;
    const fornecedores = new Set(g.itens.map(i => i.emit_doc)).size;
    return { ...g, descricao: g.nao_estoque ? 'NÃO É ESTOQUE (ENERGIA, SERVIÇOS, OBRAS)' : limpar(maior.descricao), fornecedores, pct: total ? g.valor / total : 0, acumulado: pa,
             curva: pa - g.valor / (total || 1) < 0.8 ? 'A' : pa - g.valor / (total || 1) < 0.95 ? 'B' : 'C', revisar: g.itens.some(i => i.revisar) };
  });
}

/** produto existente mais parecido (palavras em comum, bônus para o mesmo grau e o mesmo NCM) */
export function parecido(grupo, produtos) {
  const pal = new Set(limpar(grupo.descricao).split(' ').filter(w => w.length > 1)); let best = null, bs = 0;
  for (const p of produtos) {
    if (p.ativo === false || p.tipo === 'produto_acabado' || p.codigo === 'NAO-ESTOQUE') continue;
    const w = limpar(p.descricao).split(' ').filter(x => x.length > 1);
    let s = w.filter(t => pal.has(t)).length / Math.max(pal.size, w.length, 1);
    if (grupo.grau && limpar(p.descricao).includes(grupo.grau)) s += 0.5;
    if (grupo.ncm && p.ncm === grupo.ncm) s += 0.2;
    if (s > bs) { bs = s; best = p; }
  }
  return bs >= 0.6 ? best : null;
}

/** o que vai para o banco (est_cadastro_massa) a partir dos grupos marcados */
export function payload(grupos) {
  return grupos.map(g => ({
    ...(g.produto_id ? { produto_id: g.produto_id } : g.nao_estoque ? { nao_estoque: true } : { descricao: g.descricao, unidade: g.unidade, ncm: g.ncm, familia_id: g.familia_id, codigo: g.codigo || null }),
    itens: g.itens.map(i => ({ emit_doc: i.emit_doc, codigo_fornecedor: i.codigo_fornecedor, descricao: i.descricao, unidade: i.unidade, fator: i.fator })),
  }));
}

/** resumo da prontidão: % do valor das notas que já movimentaria o estoque ou está decidido */
export function prontidao(r) {
  const res = r?.resumo || [], soma = (f) => res.filter(f).reduce((s, x) => s + +x.valor, 0), cnt = (f) => res.filter(f).reduce((s, x) => s + +x.itens, 0);
  const out = {};
  for (const s of ['entrada', 'saida']) {
    const tot = soma(x => x.sentido === s), pronto = soma(x => x.sentido === s && ['ok', 'nao_movimenta'].includes(x.resultado));
    out[s] = { total: tot, pronto, pct: tot ? pronto / tot : 1, itens: cnt(x => x.sentido === s),
      porMotivo: Object.fromEntries(['ok', 'nao_movimenta', 'sem_produto', 'sem_regra', 'sem_local'].map(m => [m, { itens: cnt(x => x.sentido === s && x.resultado === m), valor: soma(x => x.sentido === s && x.resultado === m) }])) };
  }
  return out;
}

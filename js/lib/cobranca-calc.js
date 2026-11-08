// Cobrança (melhoria 3.3): aging dos títulos em aberto por faixa de atraso, por cliente ou fornecedor.
// Funções puras (testes em tests/cobranca-calc.test.js).

export const FAIXAS = [
  { k: 'vencer', nome: 'A vencer', de: -Infinity, ate: 0 },
  { k: 'd15', nome: '1 a 15 dias', de: 1, ate: 15 },
  { k: 'd30', nome: '16 a 30', de: 16, ate: 30 },
  { k: 'd60', nome: '31 a 60', de: 31, ate: 60 },
  { k: 'd90', nome: '61 a 90', de: 61, ate: 90 },
  { k: 'm90', nome: 'Mais de 90', de: 91, ate: Infinity }];

export const diasAtraso = (venc, hoje) => Math.round((Date.parse(hoje + 'T12:00:00Z') - Date.parse(String(venc).slice(0, 10) + 'T12:00:00Z')) / 864e5);
export const faixaDe = (dias) => FAIXAS.find(f => dias >= f.de && dias <= f.ate).k;

/** títulos: {favorecido_id, favorecido_nome, data, valor}. Devolve totais por faixa, por pessoa (ordem: maior vencido) e indicadores. */
export function aging(titulos, hoje) {
  const tot = Object.fromEntries(FAIXAS.map(f => [f.k, 0])), pes = new Map();
  let somaDias = 0, vencido = 0;
  for (const t of titulos) {
    const d = diasAtraso(t.data, hoje), k = faixaDe(d), v = Math.abs(+t.valor || 0);
    tot[k] += v;
    if (d > 0) { vencido += v; somaDias += d * v; }
    const id = t.favorecido_id || 'sem';
    if (!pes.has(id)) pes.set(id, { id, nome: t.favorecido_nome || '(sem favorecido)', total: 0, vencido: 0, maior: 0, n: 0, ...Object.fromEntries(FAIXAS.map(f => [f.k, 0])) });
    const p = pes.get(id); p[k] += v; p.total += v; p.n++; if (d > 0) { p.vencido += v; p.maior = Math.max(p.maior, d); }
  }
  const total = Object.values(tot).reduce((a, b) => a + b, 0);
  return { faixas: FAIXAS.map(f => ({ ...f, valor: tot[f.k], pct: total ? tot[f.k] / total : 0 })), total, vencido,
    pctVencido: total ? vencido / total : 0, atrasoMedio: vencido ? somaDias / vencido : 0,
    pessoas: [...pes.values()].sort((a, b) => b.vencido - a.vencido || b.total - a.total) };
}

// ---------------------------------------------------------------- boleto (melhoria 3.5)
// conferência da linha digitável (dígitos verificadores) e leitura do vencimento e do valor
const soDig = (s) => String(s || '').replace(/\D/g, '');
export function mod10(n) {
  let s = 0, p = 2;
  for (let i = n.length - 1; i >= 0; i--) { let x = +n[i] * p; if (x > 9) x -= 9; s += x; p = p === 2 ? 1 : 2; }
  return (10 - s % 10) % 10;
}
// módulo 11 com pesos 2 a 9 da direita para a esquerda; "zero" é o dígito usado quando o resto dá 0, 10 ou 11
function mod11(n, bancario) {
  let s = 0, p = 2;
  for (let i = n.length - 1; i >= 0; i--) { s += +n[i] * p; p = p === 9 ? 2 : p + 1; }
  const r = s % 11;
  if (bancario) { const d = 11 - r; return d === 0 || d === 10 || d === 11 ? 1 : d; }
  return r === 0 || r === 1 ? 0 : 11 - r;
}
/** código de barras (44) a partir da linha digitável bancária (47) */
export const barrasDaLinha = (l) => l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
// fator de vencimento: dias desde 07/10/1997; a contagem voltou a 1000 em 22/02/2025 — fica a data mais perto da referência
export function vencimentoDoFator(f, ref = new Date()) {
  if (!f) return null;
  const d1 = new Date(Date.UTC(1997, 9, 7) + f * 864e5), d2 = new Date(Date.UTC(2025, 1, 22) + (f - 1000) * 864e5);
  const r = +ref; const d = f < 1000 ? d1 : Math.abs(+d1 - r) <= Math.abs(+d2 - r) ? d1 : d2;
  return d.toISOString().slice(0, 10);
}
/** { ok, tipo:'bancario'|'arrecadacao', erro?, vencimento?, valor? } para linha digitável (47/48) ou código de barras (44) */
export function lerBoleto(txt, ref = new Date()) {
  const l = soDig(txt);
  if (![44, 47, 48].includes(l.length)) return { ok: false, erro: 'A linha digitável tem 47 dígitos (48 em contas de consumo); o código de barras, 44' };
  if (l[0] === '8') { // arrecadação (concessionárias, tributos)
    const m = ['6', '7'].includes(l[2]) ? mod10 : ['8', '9'].includes(l[2]) ? (x) => mod11(x, false) : null;
    if (!m) return { ok: false, tipo: 'arrecadacao', erro: 'Código de arrecadação com identificador de valor inválido' };
    let barras = l;
    if (l.length === 48) {
      for (let i = 0; i < 4; i++) { const b = l.slice(i * 12, i * 12 + 11); if (m(b) !== +l[i * 12 + 11]) return { ok: false, tipo: 'arrecadacao', erro: `Dígito do bloco ${i + 1} não confere` }; }
      barras = [0, 1, 2, 3].map(i => l.slice(i * 12, i * 12 + 11)).join('');
    } else if (l.length !== 44) return { ok: false, tipo: 'arrecadacao', erro: 'Tamanho inválido' };
    if (m(barras.slice(0, 3) + barras.slice(4)) !== +barras[3]) return { ok: false, tipo: 'arrecadacao', erro: 'Dígito geral não confere' };
    return { ok: true, tipo: 'arrecadacao', valor: +barras.slice(4, 15) / 100 };
  }
  if (l.length === 48) return { ok: false, erro: 'Linha de 48 dígitos é de conta de consumo e começa com 8' };
  let barras = l;
  if (l.length === 47) {
    for (const [a, b, dv] of [[0, 9, 9], [10, 20, 20], [21, 31, 31]]) if (mod10(l.slice(a, b)) !== +l[dv]) return { ok: false, tipo: 'bancario', erro: 'Um dos dígitos dos campos não confere (confira a digitação)' };
    barras = barrasDaLinha(l);
  }
  if (mod11(barras.slice(0, 4) + barras.slice(5), true) !== +barras[4]) return { ok: false, tipo: 'bancario', erro: 'Dígito verificador geral não confere' };
  return { ok: true, tipo: 'bancario', vencimento: vencimentoDoFator(+barras.slice(5, 9), ref), valor: +barras.slice(9, 19) / 100 };
}

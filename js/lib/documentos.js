// Validação e formatação de CNPJ (numérico e alfanumérico, IN RFB 2.229/2024) e CPF
const limpa = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

export function cnpjValido(v) {
  const c = limpa(v);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\w)\1{13}$/.test(c)) return false;
  const val = (ch) => ch.charCodeAt(0) - 48; // dígito = valor; letra = ASCII − 48 (A=17…)
  const dv = (base) => { let s = 0, p = base.length - 7; for (const ch of base) { s += val(ch) * p; p = p === 2 ? 9 : p - 1; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(c.slice(0, 12)); const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

export function cpfValido(v) {
  const c = String(v || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +c[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +c[9] && dv(10) === +c[10];
}

/** { tipo: 'PJ'|'PF'|null, valido, formatado } */
export function analisaDocumento(v) {
  const c = limpa(v);
  if (!c) return { tipo: null, valido: false, formatado: '', vazio: true };
  if (c.length === 11 && /^\d+$/.test(c)) return { tipo: 'PF', valido: cpfValido(c), formatado: c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') };
  if (c.length === 14) return { tipo: 'PJ', valido: cnpjValido(c), formatado: c.replace(/(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})/, '$1.$2.$3/$4-$5') };
  return { tipo: null, valido: false, formatado: String(v || '').trim() };
}

export const somenteDoc = limpa;

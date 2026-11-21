// Leitor de código de barras (21/11/2026, ideia do Renan). O leitor USB ou Bluetooth funciona como um teclado: "digita" o código
// depressa e termina com Enter. Parte pura: reconhece o que foi lido (chave de NF-e/CT-e do DANFE, boleto) e separa a leitura do
// leitor da digitação de uma pessoa. As etiquetas de mercadoria e o inventário entram aqui nas próximas etapas.
const so = (s) => String(s ?? '').replace(/\D/g, '');
const UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
export const MODELOS = { 55: 'NF-e', 65: 'NFC-e', 57: 'CT-e', 58: 'MDF-e', 67: 'CT-e OS' };

/** dígito verificador da chave de acesso (módulo 11, pesos 2 a 9 da direita para a esquerda) */
export function dvChave(c43) {
  let s = 0, p = 2; for (let i = c43.length - 1; i >= 0; i--) { s += +c43[i] * p; p = p === 9 ? 2 : p + 1; }
  const r = s % 11; return r < 2 ? 0 : 11 - r;
}
/** abre a chave de 44 dígitos: UF, mês, emitente, modelo, série e número. `valida` = dígito, UF, mês e modelo conferem */
export function chaveNFe(txt) {
  const c = so(txt); if (c.length !== 44) return null;
  const uf = UF[+c.slice(0, 2)] || null, mes = +c.slice(4, 6), modelo = +c.slice(20, 22);
  return { chave: c, uf, ano: 2000 + +c.slice(2, 4), mes, cnpj: c.slice(6, 20), modelo, documento: MODELOS[modelo] || null, serie: String(+c.slice(22, 25)), numero: +c.slice(25, 34),
    valida: !!uf && mes >= 1 && mes <= 12 && !!MODELOS[modelo] && dvChave(c.slice(0, 43)) === +c[43] };
}
export const chaveFormatada = (c) => so(c).replace(/(\d{4})(?=\d)/g, '$1 ');
export const cnpjFormatado = (c) => { const d = so(c); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d; };

/** boleto pelo código de barras (44 dígitos): banco, valor e dígito geral (módulo 11); contas de consumo começam com 8 */
export function boleto(txt) {
  const c = so(txt); if (c.length !== 44) return null;
  if (c[0] === '8') return { codigo: c, arrecadacao: true, valor: +c.slice(4, 15) / 100, valida: true };
  let s = 0, p = 2; const r = c.slice(0, 4) + c.slice(5);
  for (let i = r.length - 1; i >= 0; i--) { s += +r[i] * p; p = p === 9 ? 2 : p + 1; }
  let dv = 11 - (s % 11); if (dv === 0 || dv === 10 || dv === 11) dv = 1;
  return { codigo: c, arrecadacao: false, banco: c.slice(0, 3), valor: +c.slice(9, 19) / 100, valida: c[3] === '9' && dv === +c[4] };
}

/** reconhece o que foi lido. Aceita o código puro, a chave com espaços e o endereço do QR da NFC-e (…?p=CHAVE|…) */
export function reconhecer(txt) {
  const bruto = String(txt ?? '').trim(); if (!bruto) return { tipo: 'vazio' };
  const candidatos = [so(bruto), ...(bruto.match(/\d{44}/g) || [])].filter(c => c.length === 44);
  for (const c of candidatos) { const k = chaveNFe(c); if (k?.valida) return { tipo: 'nfe', ...k }; }
  for (const c of candidatos) { const b = boleto(c); if (b?.valida) return { tipo: 'boleto', ...b }; }
  const d = so(bruto);
  if (d.length === 47 || d.length === 48) return { tipo: 'boleto', codigo: d, linha: true, valida: true };
  if (candidatos.length) return { tipo: 'invalido', codigo: candidatos[0], motivo: 'O código tem 44 dígitos, mas o dígito verificador não confere. Leia de novo.' };
  return { tipo: 'desconhecido', codigo: bruto };
}

/** separa a leitura do leitor da digitação: o leitor manda muitos caracteres em poucos milissegundos.
 *  uso: const d = detector(); d.tecla(caractere, agora) a cada tecla; d.fim(agora) no Enter ou na pausa → o código lido, ou null */
export function detector({ minimo = 20, intervalo = 45 } = {}) {
  let buf = '', t0 = 0, tUlt = 0;
  return {
    tecla(ch, agora) { if (buf && agora - tUlt > 250) buf = ''; if (!buf) t0 = agora; buf += ch; tUlt = agora; },
    fim() { const b = buf, dur = tUlt - t0; buf = ''; return b.length >= minimo && dur / (b.length - 1) <= intervalo ? b : null; },
    pendente() { return buf.length; },
    limpar() { buf = ''; },
  };
}

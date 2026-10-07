// Números, valores e datas por extenso (pt-BR) para duplicatas e notas promissórias
const UN = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function ate999(n) {
  if (n < 20) return UN[n];
  if (n < 100) return DEZ[Math.floor(n / 10)] + (n % 10 ? ' e ' + UN[n % 10] : '');
  if (n === 100) return 'cem';
  return CEM[Math.floor(n / 100)] + (n % 100 ? ' e ' + ate999(n % 100) : '');
}

/** Inteiro por extenso: 2026 → "dois mil e vinte e seis"; 1000000 → "um milhão". */
export function numeroExtenso(n) {
  n = Math.floor(Math.abs(n));
  if (n < 1000) return ate999(n);
  const grupos = []; let x = n;
  while (x > 0) { grupos.push(x % 1000); x = Math.floor(x / 1000); }
  const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões'], ['trilhão', 'trilhões']];
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i]; if (!g) continue;
    const txt = i === 1 && g === 1 ? 'mil' : `${ate999(g)}${i ? ' ' + nomes[i][g === 1 ? 0 : 1] : ''}`;
    partes.push({ txt, g, i });
  }
  // "e" antes do último grupo quando ele é < 100 ou centena redonda (ex.: mil e vinte, mil e quinhentos)
  return partes.map((p, k) => {
    if (k === 0) return p.txt;
    const ultimo = k === partes.length - 1;
    return (ultimo && (p.g < 100 || p.g % 100 === 0) ? ' e ' : ', ') + p.txt;
  }).join('');
}

/** Valor em reais por extenso: 137709.42 → "cento e trinta e sete mil, setecentos e nove reais e quarenta e dois centavos". */
export function valorExtenso(v) {
  const cent = Math.round(Math.abs(+v || 0) * 100); const r = Math.floor(cent / 100), c = cent % 100;
  const partes = [];
  if (r) {
    const milhoesRedondos = r >= 1e6 && r % 1e6 === 0;
    partes.push(`${numeroExtenso(r)}${milhoesRedondos ? ' de' : ''} ${r === 1 ? 'real' : 'reais'}`);
  }
  if (c) partes.push(`${numeroExtenso(c)} ${c === 1 ? 'centavo' : 'centavos'}`);
  return partes.length ? partes.join(' e ') : 'zero real';
}

/** Data por extenso: "2026-12-07" → "sete de dezembro de dois mil e vinte e seis"; com { dia: true } → "Aos sete dias do mês de dezembro do ano de …". */
export function dataExtenso(iso, { modelo = 'curto' } = {}) {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dia = d === 1 ? 'primeiro' : numeroExtenso(d);
  if (modelo === 'nota') return `${d === 1 ? 'No primeiro dia' : `Aos ${dia} dias`} do mês de ${MESES[m - 1]} do ano de ${numeroExtenso(a)}`;
  return `${dia} de ${MESES[m - 1]} de ${numeroExtenso(a)}`;
}

export const mesExtenso = (iso) => MESES[+iso.slice(5, 7) - 1];

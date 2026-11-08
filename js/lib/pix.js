// PIX copia e cola (BR Code estático do Banco Central, padrão EMV QRCPS-MPM) — melhoria 3.3.
// O mesmo cálculo existe no banco (pix_brcode, SQL 126) para o e-mail de cobrança; os testes conferem os dois.

const campo = (id, v) => id + String(v.length).padStart(2, '0') + v;
/** texto sem acento, em maiúsculas, só letras, números e espaço, até n caracteres */
export function txt(s, n) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
}
/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos */
export function crc16(s) {
  let crc = 0xFFFF;
  for (const b of new TextEncoder().encode(s)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
/** BR Code: chave, nome do recebedor (até 25), cidade (até 15), valor (opcional) e identificador (até 25, letras e números) */
export function brcode({ chave, nome, cidade, valor, txid }) {
  if (!chave) throw new Error('Chave PIX não cadastrada');
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', String(chave).trim());
  const id = String(txid || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const p = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986')
    + (+valor > 0 ? campo('54', (+valor).toFixed(2)) : '') + campo('58', 'BR') + campo('59', txt(nome, 25) || 'RECEBEDOR')
    + campo('60', txt(cidade, 15) || 'BRASIL') + campo('62', campo('05', id)) + '6304';
  return p + crc16(p);
}

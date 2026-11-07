// Leitura da balança pela porta serial (Web Serial: Chrome e Edge no computador, com a balança no USB/serial).
// Balanças de bancada (Toledo, Filizola, Urano, Marte…) mandam o peso como texto, de forma contínua ou a cada pedido.
// Lê por até 3 s e devolve o peso quando duas leituras seguidas iguais (estável) aparecem; senão, a última lida.
// Sem a API (celular, Firefox, Safari), o peso é digitado.
export const temBalanca = () => typeof navigator !== 'undefined' && 'serial' in navigator;
let porta = null;

/** extrai o peso em kg de uma linha da balança ("ST,GS,+  012.345kg", "P 12,345 kg", "1234 g") */
export function pesoDaLinha(linha) {
  const m = String(linha || '').replace(/\s+/g, ' ').match(/([+-]?\s?\d{1,6}(?:[.,]\d{1,4})?)\s?(kg|g)?\b/i);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(v)) return null;
  if ((m[2] || '').toLowerCase() === 'g') v = v / 1000;
  return Math.round(v * 10000) / 10000;
}

export async function lerBalanca({ baud = 9600, pedido = null, timeoutMs = 3000 } = {}) {
  if (!temBalanca()) throw new Error('Este navegador não lê a balança: use o Chrome ou o Edge no computador, ou digite o peso.');
  if (!porta) { const ja = await navigator.serial.getPorts(); porta = ja[0] || await navigator.serial.requestPort(); }
  if (!porta.readable) await porta.open({ baudRate: +baud || 9600 });
  if (pedido) { const w = porta.writable.getWriter(); await w.write(new TextEncoder().encode(pedido)); w.releaseLock(); }
  const leitor = porta.readable.getReader(), dec = new TextDecoder();
  let buf = '', ultimo = null, anterior = null;
  const fim = Date.now() + timeoutMs;
  try {
    while (Date.now() < fim) {
      const { value, done } = await Promise.race([leitor.read(), new Promise(r => setTimeout(() => r({ value: null, done: false }), 400))]);
      if (done) break;
      if (value) buf += dec.decode(value);
      const linhas = buf.split(/[\r\n\x02\x03]+/); buf = linhas.pop();
      for (const l of linhas) { const p = pesoDaLinha(l); if (p == null) continue; anterior = ultimo; ultimo = p; if (anterior === ultimo && ultimo > 0) return ultimo; }
    }
  } finally { try { await leitor.cancel(); } catch {} leitor.releaseLock(); }
  if (ultimo == null) throw new Error('A balança não mandou o peso. Confira o cabo, a velocidade (baud) nos parâmetros e se ela está em modo contínuo.');
  return ultimo;
}

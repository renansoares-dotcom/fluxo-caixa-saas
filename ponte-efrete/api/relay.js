// Ponte e-frete (Vercel, Node.js, região gru1). Repassa ao e-frete as chamadas da função "efrete" do Supabase.
// Por que existe: o servidor do e-frete pede o certificado de cliente por renegociação TLS depois de aberta a conexão,
// e o runtime do Supabase não aceita renegociação. O Node (OpenSSL) aceita, e daqui sai também o certificado A1.
// Segurança: só atende quem manda o cabeçalho x-ponte-chave igual a PONTE_CHAVE; só fala com os dois hosts do e-frete
// e só nos caminhos /Services/…; não guarda nada e não registra corpo de requisição (pode ter senha).
// Variáveis: PONTE_CHAVE (obrigatória), EFRETE_PFX_B64 + EFRETE_PFX_SENHA (opcionais: certificado A1 em base64).
const https = require('node:https');
const crypto = require('node:crypto');

const HOSTS = { homologacao: 'dev.efrete.com.br', producao: 'sistema.efrete.com.br' };

function igual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function chamar({ host, metodo, caminho, corpo }) {
  const pfx = process.env.EFRETE_PFX_B64 ? Buffer.from(process.env.EFRETE_PFX_B64, 'base64') : undefined;
  return new Promise((ok, falha) => {
    const ini = Date.now();
    const req = https.request({
      host, port: 443, method: metodo, path: caminho, servername: host,
      // TLS 1.2: o pedido de certificado por renegociação só existe até o TLS 1.2
      maxVersion: 'TLSv1.2', minVersion: 'TLSv1.2',
      ...(pfx ? { pfx, passphrase: process.env.EFRETE_PFX_SENHA || '' } : {}),
      agent: false,
      headers: { Accept: 'application/json', ...(corpo != null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } : {}) },
    }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => ok({ status: res.statusCode || 0, ms: Date.now() - ini, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('error', falha);
    req.setTimeout(45000, () => req.destroy(new Error('tempo esgotado (45 s)')));
    if (corpo != null) req.write(corpo);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ erro: 'use POST' })); }
  if (!process.env.PONTE_CHAVE || !igual(req.headers['x-ponte-chave'], process.env.PONTE_CHAVE)) {
    res.statusCode = 401; return res.end(JSON.stringify({ erro: 'não autorizado' }));
  }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  const ambiente = b?.ambiente === 'producao' ? 'producao' : 'homologacao';
  const metodo = b?.metodo === 'GET' ? 'GET' : 'POST';
  const caminho = String(b?.caminho || '');
  if (!/^\/Services\/[A-Za-z0-9_\/.]+(\?[^\s#]*)?$/.test(caminho)) { res.statusCode = 400; return res.end(JSON.stringify({ erro: 'caminho não permitido' })); }
  try {
    const r = await chamar({ host: HOSTS[ambiente], metodo, caminho, corpo: metodo === 'POST' ? JSON.stringify(b?.corpo ?? {}) : null });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...r, certificado: !!process.env.EFRETE_PFX_B64 }));
  } catch (e) {
    // só a mensagem, sem o endereço (que pode ter parâmetros)
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, erro: String(e && e.message || e).replace(/https?:\/\/\S+/g, (u) => u.split('?')[0]), codigo: e && e.code }));
  }
};

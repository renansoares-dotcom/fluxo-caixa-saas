// Crachás (Cadastros › Empresa — SQL 066): desenho do cartão, folha A4 para recortar e plastificar e tratamento da foto.
// Tamanho do cartão: padrão CR80, 85,6 × 54 mm. Na folha A4 cada linha tem a frente e o verso lado a lado, com a linha
// de dobra no meio: recorta o retângulo, dobra e plastifica — 5 crachás por folha.
import { esc } from './ui.js';

export const TIPOS = { colaborador: 'Colaborador', terceiro: 'Prestador de serviço', visitante: 'Visitante' };
export const COR_TIPO = { colaborador: null, terceiro: '#b26a00', visitante: '#c0352b' };   // null = cor da empresa
export const SITUACAO = { ativo: 'Ativo', devolvido: 'Devolvido', cancelado: 'Cancelado', extraviado: 'Extraviado' };
export const VERSO_PADRAO = 'Crachá de uso pessoal e intransferível. Uso obrigatório e visível nas dependências da empresa. Em caso de perda, comunique o RH.';
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/** endereço que o QR Code abre (página pública de verificação) */
export const urlVerificacao = (codigo, base = location.href) => new URL(`cracha.html?c=${encodeURIComponent(codigo)}`, new URL('./', base.split('#')[0])).href;

/** situação real: ativo, mas vencido ou de pessoa desligada → aparece como tal */
export function situacao(c, colab) {
  if (c.status !== 'ativo') return c.status;
  if (c.validade && c.validade < new Date().toISOString().slice(0, 10)) return 'vencido';
  if (colab && colab.situacao === 'desligado') return 'cancelar';
  return 'ativo';
}
/** validade padrão: hoje + meses da identidade (visitante: só o dia) */
export function validadePadrao(tipo, meses = 24, hoje = new Date()) {
  const d = new Date(hoje); if (tipo === 'visitante') return d.toISOString().slice(0, 10);
  d.setMonth(d.getMonth() + (+meses || 24)); return d.toISOString().slice(0, 10);
}

let qrLib = null;
export async function qrSvg(texto) {
  if (!qrLib) await new Promise((ok, err) => { const s = document.createElement('script'); s.src = new URL('../../vendor/qrcode-generator-1.4.4.js', import.meta.url).href; s.onload = ok; s.onerror = err; document.head.appendChild(s); }).then(() => { qrLib = window.qrcode; });
  const q = qrLib(0, 'M'); q.addData(texto); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

/** CSS do cartão (o mesmo na prévia da tela e na impressão) */
export function cssCracha(cor = '#2b5598') {
  return `.crc{width:85.6mm;height:54mm;box-sizing:border-box;position:relative;overflow:hidden;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;border:.2mm solid #bbb;border-radius:3mm}
  .crc .faixa{position:absolute;left:0;right:0;top:0;height:11mm;background:var(--crc,${cor});display:flex;align-items:center;gap:2mm;padding:0 3mm}
  .crc .faixa .lg{height:7.5mm;max-width:30mm;background:#fff;border-radius:1.2mm;padding:.6mm 1.2mm;box-sizing:border-box;display:flex;align-items:center}
  .crc .faixa .lg img{max-height:6.3mm;max-width:27mm}
  .crc .faixa .nm{color:#fff;font-weight:700;font-size:3.1mm;letter-spacing:.2mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .crc .ft{position:absolute;left:3mm;top:13.5mm;width:22mm;height:29.3mm;border-radius:1.5mm;background:#e9edf3 center/cover no-repeat;border:.3mm solid var(--crc,${cor})}
  .crc .ft.sem{display:flex;align-items:center;justify-content:center;color:#889;font-size:2.4mm;text-align:center}
  .crc .dd{position:absolute;left:28mm;right:3mm;top:13.8mm;line-height:1.25}
  .crc .dd .n{font-weight:700;font-size:3.7mm;text-transform:uppercase;line-height:1.12;max-height:8.6mm;overflow:hidden}
  .crc .dd .c{font-size:2.9mm;margin-top:1.4mm;text-transform:uppercase}
  .crc .dd .s{font-size:2.6mm;color:#444;margin-top:.6mm}
  .crc .dd .m{font-size:2.6mm;color:#444;margin-top:1.4mm}
  .crc .rod{position:absolute;left:0;right:0;bottom:0;height:7mm;background:var(--crt,var(--crc,${cor}));color:#fff;font-weight:700;font-size:3mm;letter-spacing:.6mm;display:flex;align-items:center;justify-content:center;text-transform:uppercase}
  .crc.vs .qr{position:absolute;left:4mm;top:7mm;width:25mm;height:25mm} .crc.vs .qr svg{width:100%;height:100%}
  .crc.vs .qrt{position:absolute;left:3mm;top:33mm;width:27mm;text-align:center;font-size:2.1mm;color:#444}
  .crc.vs .tx{position:absolute;left:33mm;right:4mm;top:7mm;font-size:2.55mm;line-height:1.35;color:#222}
  .crc.vs .vl{position:absolute;left:33mm;right:4mm;top:30mm;font-size:2.6mm;line-height:1.4}
  .crc.vs .ct{position:absolute;left:33mm;right:4mm;bottom:9mm;font-size:2.3mm;color:#444;line-height:1.3}`;
}

/** frente e verso de um crachá. imgs: { logo, foto } já como data: URL; qr: SVG pronto */
export function htmlCracha(c, id = {}, { logo = null, foto = null, qr = '' } = {}) {
  const cor = id.cor_primaria || '#2b5598', corTipo = COR_TIPO[c.tipo] || cor;
  const empresa = id.nome_exibicao || '';
  const frente = `<div class="crc fr" style="--crc:${esc(cor)};--crt:${esc(corTipo)}">
    <div class="faixa">${logo ? `<div class="lg"><img src="${logo}" alt=""></div>` : ''}<div class="nm">${esc(empresa)}</div></div>
    <div class="ft${foto ? '' : ' sem'}" style="${foto ? `background-image:url('${foto}')` : ''}">${foto ? '' : 'sem foto'}</div>
    <div class="dd"><div class="n">${esc(c.nome || '')}</div>
      ${c.tipo === 'colaborador' ? `<div class="c">${esc(c.cargo || '')}</div><div class="s">${esc(c.setor || '')}</div>${c.matricula ? `<div class="m">Matrícula ${esc(c.matricula)}</div>` : ''}`
        : `<div class="c">${esc(c.empresa_terceiro || '')}</div>${c.cargo ? `<div class="s">${esc(c.cargo)}</div>` : ''}`}</div>
    <div class="rod">${esc(TIPOS[c.tipo] || '')}</div></div>`;
  const verso = `<div class="crc vs" style="--crc:${esc(cor)};--crt:${esc(corTipo)}">
    <div class="qr">${qr}</div><div class="qrt">Aponte a câmera para verificar</div>
    <div class="tx">${esc(id.cracha_verso || VERSO_PADRAO)}</div>
    <div class="vl"><b>Validade:</b> ${c.validade ? dataBR(c.validade) : 'indeterminada'}<br><b>Via:</b> ${c.via || 1} · <b>Emissão:</b> ${dataBR(c.emitido_em)}</div>
    <div class="ct">${esc(empresa)}${id.telefone ? ` · ${esc(id.telefone)}` : ''}${id.site ? `<br>${esc(id.site)}` : ''}</div>
    <div class="rod">${esc(TIPOS[c.tipo] || '')}</div></div>`;
  return { frente, verso };
}

/** página de impressão: A4, 5 crachás por folha (frente | dobra | verso), com marcas de corte */
export function folhaImpressao(cartoes, cor) {
  const linhas = cartoes.map(({ frente, verso }) => `<div class="par">${frente}<div class="dobra"></div>${verso}</div>`);
  const folhas = []; for (let i = 0; i < linhas.length; i += 5) folhas.push(`<section class="folha">${linhas.slice(i, i + 5).join('')}</section>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Crachás para imprimir</title><style>
    @page{size:A4 portrait;margin:8mm} *{-webkit-print-color-adjust:exact;print-color-adjust:exact} body{margin:0;font-family:Arial,sans-serif}
    .ajuda{font-size:12px;color:#333;margin:0 0 4mm} @media print{.ajuda{display:none}}
    .folha{display:flex;flex-direction:column;align-items:center;gap:2.6mm;page-break-after:always}
    .par{display:flex;align-items:stretch;outline:.25mm dashed #888;outline-offset:1.2mm}
    .dobra{width:0;border-left:.3mm dashed #999;margin:0 .1mm}
    .par .crc{border-radius:0;border:none}
    ${cssCracha(cor)}</style></head><body>
    <p class="ajuda">Imprima em A4, tamanho real (100%, sem "ajustar à página"). Recorte na linha tracejada externa, dobre na linha do meio (frente e verso ficam de costas) e plastifique.</p>
    ${folhas.join('')}</body></html>`;
}

/** foto do crachá: recorta no centro em 3:4, reduz para 600 × 800 e grava em JPEG */
export async function prepararFoto(arquivoOuBlob) {
  const url = URL.createObjectURL(arquivoOuBlob);
  try {
    const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error('Imagem inválida')); i.src = url; });
    const W = 600, H = 800, r = W / H, ir = img.naturalWidth / img.naturalHeight;
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    if (ir > r) { sw = sh * r; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / r; sy = Math.max(0, (img.naturalHeight - sh) * 0.35); }   // rosto costuma ficar na parte de cima
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
  } finally { URL.revokeObjectURL(url); }
}
/** arquivo (blob: URL) → data: URL, para a janela de impressão */
export async function paraDataUrl(url) {
  if (!url) return null;
  const b = await (await fetch(url)).blob();
  return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
}

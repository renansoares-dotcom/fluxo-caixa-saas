// Etiqueta de mercadoria (SQL 175): parte pura — o que cada etiqueta mostra e o HTML de impressão.
// O código da etiqueta (L0000123 = lote, P0000456 = produto) sai em código de barras, em QR ou nos dois, conforme o parâmetro.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const PADRAO = { codigo: 'ambos', largura_mm: 100, altura_mm: 70, copias: 1, mostrar_fornecedor: true };
export const TIPOS_CODIGO = { ambos: 'Código de barras e QR', barras: 'Só código de barras', qr: 'Só QR' };

/** o texto lido é um código de etiqueta? devolve { codigo, alvo: 'lote' | 'produto' } ou null */
export function codigoEtiqueta(txt) {
  const t = String(txt ?? '').trim().toUpperCase();
  const m = /^([LP])(\d{7,12})$/.exec(t);
  return m ? { codigo: t, alvo: m[1] === 'L' ? 'lote' : 'produto' } : null;
}

/** uma etiqueta por volume: item com n cópias vira n etiquetas "Vol. i/n" (uma cópia só não leva o contador) */
export function expandir(itens) {
  const out = [];
  for (const it of itens || []) { const n = Math.max(1, Math.min(200, Math.round(+it.copias || 1))); for (let i = 1; i <= n; i++) out.push({ ...it, volume: n > 1 ? `${i}/${n}` : '' }); }
  return out;
}

/** CSS da etiqueta: tudo em milímetros, proporcional à altura (o desenho base é 100 × 70 mm) */
export function cssEtiquetas(cfg = PADRAO) {
  const W = +cfg.largura_mm || 100, H = +cfg.altura_mm || 70, u = Math.min(H / 70, W / 100), mm = (v) => (v * u).toFixed(2) + 'mm';
  return `@page{size:${W}mm ${H}mm;margin:0} *{box-sizing:border-box} html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000}
.etq{width:${W}mm;height:${H}mm;padding:${mm(3)};display:flex;flex-direction:column;overflow:hidden;page-break-after:always;break-after:page}
.etq:last-child{page-break-after:auto;break-after:auto}
.etq .topo{display:flex;justify-content:space-between;align-items:baseline;font-size:${mm(2.6)};border-bottom:.25mm solid #000;padding-bottom:${mm(0.8)}}
.etq .topo b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .etq .vol{font-weight:bold;white-space:nowrap;padding-left:${mm(2)}}
.etq .cod{font-size:${mm(7)};font-weight:bold;line-height:1.05;margin-top:${mm(1.2)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.etq .desc{font-size:${mm(3.6)};font-weight:bold;line-height:1.1;max-height:${mm(8.2)};overflow:hidden}
.etq .lin{font-size:${mm(3)};line-height:1.2;margin-top:${mm(0.9)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .etq .lin b{font-size:${mm(3.6)}}
.etq .base{margin-top:auto;display:flex;align-items:flex-end;gap:${mm(3)}}
.etq .bar{flex:1;min-width:0} .etq .bar svg{display:block;width:100%;height:${mm(13)}}
.etq .num{font-family:"Courier New",monospace;font-weight:bold;font-size:${mm(3.4)};letter-spacing:.3mm;margin-top:${mm(0.5)}}
.etq .qr{flex:0 0 ${mm(19)};width:${mm(19)}} .etq .qr svg{display:block;width:100%;height:auto}
.barra{position:fixed;top:6px;right:6px;font-family:system-ui,sans-serif} .barra button{padding:8px 14px;font-size:13px;cursor:pointer}
@media screen{body{background:#ddd;padding:12px} .etq{background:#fff;margin:0 auto 10px;box-shadow:0 1px 4px rgba(0,0,0,.3)}} @media print{.barra{display:none}}`;
}

/** uma etiqueta. e = { etiqueta, produto_codigo, descricao, lote, lote_fornecedor, fornecedor, nota, data, peso, volume }; svg = { barras, qr } já desenhados */
export function htmlEtiqueta(e, cfg = PADRAO, svg = {}, empresa = '') {
  const tipo = cfg.codigo || 'ambos', barras = tipo !== 'qr' && svg.barras, qr = tipo !== 'barras' && svg.qr;
  const origem = [e.nota ? `NF ${esc(e.nota)}` : '', cfg.mostrar_fornecedor !== false && e.fornecedor ? esc(e.fornecedor) : '', e.data ? esc(e.data) : ''].filter(Boolean).join(' · ');
  return `<div class="etq"><div class="topo"><b>${esc(empresa)}</b>${e.volume ? `<span class="vol">Vol. ${esc(e.volume)}</span>` : ''}</div>
    <div class="cod">${esc(e.produto_codigo)}</div><div class="desc">${esc(e.descricao)}</div>
    ${e.lote ? `<div class="lin">Lote <b>${esc(e.lote)}</b>${e.lote_fornecedor ? ` · lote do fornecedor ${esc(e.lote_fornecedor)}` : ''}</div>` : ''}
    ${origem ? `<div class="lin">${origem}</div>` : ''}${e.peso ? `<div class="lin">Conteúdo: <b>${esc(e.peso)}</b></div>` : ''}
    <div class="base"><div class="bar">${barras ? svg.barras : ''}<div class="num">${esc(e.etiqueta)}</div></div>${qr ? `<div class="qr">${svg.qr}</div>` : ''}</div></div>`;
}

/** documento de impressão: `lista` já expandida; `svgs` = { [código]: { barras, qr } } */
export function documentoEtiquetas(lista, cfg = PADRAO, svgs = {}, empresa = '', { auto = true } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas (${lista.length})</title><style>${cssEtiquetas(cfg)}</style></head><body>
    <div class="barra"><button onclick="print()">Imprimir</button></div>${lista.map(e => htmlEtiqueta(e, cfg, svgs[e.etiqueta] || {}, empresa)).join('')}
    ${auto ? '<script>window.onload=()=>setTimeout(()=>print(),400)</script>' : ''}</body></html>`;
}

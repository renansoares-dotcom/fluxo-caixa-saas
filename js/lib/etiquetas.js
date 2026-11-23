// Etiqueta de mercadoria (SQL 175): parte pura — o que cada etiqueta mostra e o HTML de impressão.
// O código da etiqueta (L0000123 = lote, P0000456 = produto, E0000789 = endereço de prateleira, SQL 193) sai em código de barras,
// em QR ou nos dois, conforme o parâmetro.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const PADRAO = { codigo: 'ambos', largura_mm: 100, altura_mm: 70, copias: 1, mostrar_fornecedor: true, end_largura_mm: 100, end_altura_mm: 40 };
export const TIPOS_CODIGO = { ambos: 'Código de barras e QR', barras: 'Só código de barras', qr: 'Só QR' };

/** o texto lido é um código de etiqueta? devolve { codigo, alvo: 'lote' | 'produto' | 'endereco' } ou null */
export function codigoEtiqueta(txt) {
  const t = String(txt ?? '').trim().toUpperCase();
  const m = /^([LPE])(\d{7,12})$/.exec(t);
  return m ? { codigo: t, alvo: { L: 'lote', P: 'produto', E: 'endereco' }[m[1]] } : null;
}

/** estantes digitadas: "A-F", "A, B, C", "1-12" ou uma mistura ("A-C, P"). Devolve a lista em maiúsculas, sem repetir, ou { erro } */
export function estantes(txt) {
  const out = [];
  for (const parte of String(txt ?? '').toUpperCase().split(/[,;\s]+/).filter(Boolean)) {
    const m = /^([A-Z]|\d{1,3})-([A-Z]|\d{1,3})$/.exec(parte);
    if (m) {
      const [a, b] = [m[1], m[2]], num = /^\d+$/.test(a);
      if (num !== /^\d+$/.test(b)) return { erro: `Intervalo "${parte}": use letras (A-F) ou números (1-12), sem misturar.` };
      const ini = num ? +a : a.charCodeAt(0), fim = num ? +b : b.charCodeAt(0);
      if (fim < ini) return { erro: `Intervalo "${parte}" ao contrário.` };
      if (fim - ini > 60) return { erro: `Intervalo "${parte}" grande demais (máximo 60 estantes por intervalo).` };
      for (let v = ini; v <= fim; v++) out.push(num ? String(v).padStart(Math.max(a.length, b.length), '0') : String.fromCharCode(v));
    } else if (/^[A-Z0-9]{1,6}$/.test(parte)) out.push(parte);
    else return { erro: `Estante "${parte}": use letras e números, até 6 caracteres.` };
  }
  const lista = [...new Set(out)];
  return lista.length ? { lista } : { erro: 'Informe as estantes (ex.: A-F).' };
}

/** os códigos que a geração vai criar (a mesma regra do SQL 193): A-01-1, A-01-2… ou A-01 sem nível */
export function codigosEndereco(lista, prateleiras, niveis, digitos = 2) {
  const out = [];
  for (const e of [...lista].sort()) for (let p = 1; p <= prateleiras; p++) for (let n = 1; n <= Math.max(niveis, 1); n++)
    out.push(`${e}-${String(p).padStart(digitos, '0')}${niveis > 0 ? '-' + n : ''}`);
  return out;
}

/** ordena pelo endereço (ordem do corredor); o que não tem endereço vai para o fim, por descrição */
export function porEndereco(a, b) {
  const oa = a.endereco_ordem ?? Infinity, ob = b.endereco_ordem ?? Infinity;
  return oa !== ob ? oa - ob : String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR');
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
    ${origem ? `<div class="lin">${origem}</div>` : ''}${e.peso ? `<div class="lin">Conteúdo: <b>${esc(e.peso)}</b></div>` : ''}${e.endereco ? `<div class="lin">Endereço <b>${esc(e.endereco)}</b></div>` : ''}
    <div class="base"><div class="bar">${barras ? svg.barras : ''}<div class="num">${esc(e.etiqueta)}</div></div>${qr ? `<div class="qr">${svg.qr}</div>` : ''}</div></div>`;
}

/** documento de impressão: `lista` já expandida; `svgs` = { [código]: { barras, qr } } */
export function documentoEtiquetas(lista, cfg = PADRAO, svgs = {}, empresa = '', { auto = true } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas (${lista.length})</title><style>${cssEtiquetas(cfg)}</style></head><body>
    <div class="barra"><button onclick="print()">Imprimir</button></div>${lista.map(e => htmlEtiqueta(e, cfg, svgs[e.etiqueta] || {}, empresa)).join('')}
    ${auto ? '<script>window.onload=()=>setTimeout(()=>print(),400)</script>' : ''}</body></html>`;
}

/** CSS da etiqueta de prateleira: uma tira, com o endereço grande (o desenho base é 100 × 40 mm) */
export function cssEnderecos(cfg = PADRAO) {
  const W = +cfg.end_largura_mm || 100, H = +cfg.end_altura_mm || 40, u = Math.min(H / 40, W / 100), mm = (v) => (v * u).toFixed(2) + 'mm';
  return `@page{size:${W}mm ${H}mm;margin:0} *{box-sizing:border-box} html,body{margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000}
.end{width:${W}mm;height:${H}mm;padding:${mm(2.5)};display:flex;gap:${mm(3)};align-items:stretch;overflow:hidden;page-break-after:always;break-after:page}
.end:last-child{page-break-after:auto;break-after:auto}
.end .txt{flex:1;min-width:0;display:flex;flex-direction:column}
.end .loc{font-size:${mm(2.6)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:.25mm solid #000;padding-bottom:${mm(0.6)}}
.end .cod{font-size:${mm(12)};font-weight:bold;line-height:1;margin-top:${mm(1.2)};white-space:nowrap;overflow:hidden;letter-spacing:.2mm}
.end .desc{font-size:${mm(2.8)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:${mm(0.6)}}
.end .bar{margin-top:auto} .end .bar svg{display:block;width:100%;height:${mm(8)}}
.end .num{font-family:"Courier New",monospace;font-weight:bold;font-size:${mm(2.8)};letter-spacing:.3mm}
.end .qr{flex:0 0 ${mm(30)};display:flex;align-items:center} .end .qr svg{display:block;width:100%;height:auto}
.barra{position:fixed;top:6px;right:6px;font-family:system-ui,sans-serif} .barra button{padding:8px 14px;font-size:13px;cursor:pointer}
@media screen{body{background:#ddd;padding:12px} .end{background:#fff;margin:0 auto 10px;box-shadow:0 1px 4px rgba(0,0,0,.3)}} @media print{.barra{display:none}}`;
}

/** uma etiqueta de prateleira. e = { etiqueta, codigo, local, descricao }; svg = { barras, qr } */
export function htmlEndereco(e, cfg = PADRAO, svg = {}, empresa = '') {
  const tipo = cfg.codigo || 'ambos', barras = tipo !== 'qr' && svg.barras, qr = tipo !== 'barras' && svg.qr;
  return `<div class="end"><div class="txt"><div class="loc">${esc(e.local || empresa)}</div>
    <div class="cod">${esc(e.codigo)}</div>${e.descricao ? `<div class="desc">${esc(e.descricao)}</div>` : ''}
    <div class="bar">${barras ? svg.barras : ''}<div class="num">${esc(e.etiqueta)}</div></div></div>${qr ? `<div class="qr">${svg.qr}</div>` : ''}</div>`;
}

/** documento de impressão das etiquetas de prateleira */
export function documentoEnderecos(lista, cfg = PADRAO, svgs = {}, empresa = '', { auto = true } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas de prateleira (${lista.length})</title><style>${cssEnderecos(cfg)}</style></head><body>
    <div class="barra"><button onclick="print()">Imprimir</button></div>${lista.map(e => htmlEndereco(e, cfg, svgs[e.etiqueta] || {}, empresa)).join('')}
    ${auto ? '<script>window.onload=()=>setTimeout(()=>print(),400)</script>' : ''}</body></html>`;
}

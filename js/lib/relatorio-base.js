// Parte "pura" do padrão de relatórios (sem acesso ao banco nem à tela): usada pela plataforma (relatorio.js) e pelo
// gerador dos manuais em PDF (tutoriais/gerar-pdf.mjs), para os dois saírem iguais.
export const EMPRESA_PADRAO = 'IPLAMM – INDÚSTRIA DE PLÁSTICOS LTDA.';
// nome no cabeçalho dos relatórios: vem da identidade da empresa (Cadastros › Empresa); sem ela, o padrão
export let EMPRESA_REL = EMPRESA_PADRAO;
export const definirEmpresaRel = (n) => { EMPRESA_REL = String(n || EMPRESA_PADRAO); };
const FONTE = "'Times New Roman',Times,'Liberation Serif',serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** folha de estilo do padrão; `extra` = regras próprias do relatório */
export function cssRelatorio({ paisagem = false, margem = '12mm', extra = '' } = {}) {
  return `<style>
    @page{size:A4 ${paisagem ? 'landscape' : 'portrait'};margin:${margem};@bottom-right{content:"Página " counter(page) " de " counter(pages);font-family:${FONTE};font-size:9px;color:#444}}
    *{box-sizing:border-box} body{font-family:${FONTE};font-size:10.5px;line-height:1.35;color:#111;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .rel-cab{display:flex;align-items:center;gap:14px;border-bottom:1px solid #111;padding-bottom:6px} .rel-cab img{height:34px}
    .rel-cab .t{font-weight:bold;font-size:11px} .rel-cab .d{margin-left:auto;text-align:right;font-size:10px;line-height:1.3}
    h1{text-align:center;font-size:16px;margin:14px 0 2px;text-transform:uppercase;letter-spacing:.02em} .sub{text-align:center;margin-bottom:10px;font-size:11px}
    h2{font-size:12px;margin:14px 0 4px} h3{font-size:11px;margin:10px 0 4px}
    p{margin:4px 0} .m,.muted{color:#555;font-size:9.5px} b,strong{font-weight:bold}
    table{width:100%;border-collapse:collapse;margin:2px 0 6px} thead{display:table-header-group} tr{page-break-inside:avoid}
    th{font-size:9.5px;text-align:left;font-weight:bold;border-top:1px solid #000;border-bottom:.6px solid #000;padding:3px 4px;background:none;color:#111}
    td{padding:3px 4px;border:0;border-bottom:.25px solid #bbb;vertical-align:top}
    tbody tr:last-child td{border-bottom:1px solid #000} td.n,th.n{text-align:right;white-space:nowrap}
    tr.tot td,tfoot td,tfoot th{font-weight:bold;border-top:.6px solid #000;border-bottom:1px solid #000;background:#f2f2f2}
    tr.gr td{font-weight:bold;background:#f2f2f2;border-bottom:.6px solid #000;padding-top:6px} tr.st td{font-weight:bold;border-bottom:.6px solid #000}
    .info{width:100%;border-collapse:collapse;margin:8px 0} .info td{border:0;border-bottom:.3px solid #999;padding:4px} .info tr:first-child td{border-top:1.2px solid #000} .info tr:last-child td{border-bottom:1.2px solid #000} .info td:first-child{font-weight:bold;width:24%}
    .ass{margin-top:46px;display:flex;gap:50px;justify-content:space-around} .ass div{border-top:.8px solid #111;padding-top:4px;min-width:200px;text-align:center}
    .rel-rod{margin-top:12px;font-size:9px;color:#444;border-top:.6px solid #111;padding-top:4px}
    .neg{color:#b00020} .pos{color:#1b5e20}
    @media screen{body{margin:20px auto;max-width:${paisagem ? '1100px' : '820px'};padding:0 16px}} @media print{.rel-bar{display:none}}
    ${extra}</style>`;
}

/** cabeçalho do padrão (logo · empresa · nome do relatório e emissão) */
export function cabecalhoRelatorio(nome, logo, sub = '') {
  const agora = new Date();
  return `<div class="rel-cab">${logo ? `<img src="${logo.data}" alt="">` : ''}<div class="t">${EMPRESA_REL}</div>
    <div class="d">${esc(nome)}<br>emitido em ${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${sub ? `<br>${esc(sub)}` : ''}</div></div>`;
}

/** documento HTML completo no padrão (janela de impressão da plataforma e PDF dos manuais) */
export function documentoRelatorio({ nome, titulo, subtitulo = '', corpo = '', rodape = '', paisagem = false, extraCss = '', margem, auto = false, logo = null, tituloPagina = '', barra = true }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(tituloPagina || nome || titulo)}</title>${cssRelatorio({ paisagem, margem, extra: extraCss })}</head><body>
    ${barra ? '<div class="rel-bar"><button onclick="print()">Imprimir / salvar PDF</button></div>' : ''}
    ${cabecalhoRelatorio(nome || titulo, logo)}
    ${titulo ? `<h1>${esc(titulo)}</h1>` : ''}${subtitulo ? `<div class="sub">${subtitulo}</div>` : ''}
    ${corpo}
    ${rodape ? `<div class="rel-rod">${rodape}</div>` : ''}
    ${auto ? '<script>window.onload=()=>setTimeout(()=>print(),300)</script>' : ''}</body></html>`;
}

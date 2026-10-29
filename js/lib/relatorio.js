// Padrão único dos relatórios para impressão (28/10/2026, Renan: "todos os relatórios no mesmo padrão de tipografia" do
// relatório de Fretes e CIOT): Times, cabeçalho com logo + "IPLAMM – INDÚSTRIA DE PLÁSTICOS LTDA." + nome do relatório e emissão
// à direita, título centralizado em maiúsculas, seções numeradas, tabelas com filete preto em cima e embaixo, rodapé com a base dos dados.
//  - abrirRelatorio(): janela de impressão (HTML)
//  - padronizarPDF(doc): PDFs gerados direto (jsPDF + autoTable) passam para Times e para as tabelas do padrão
import { state } from './data.js';
import { esc, toast, logoPNG } from './ui.js';

export const EMPRESA_REL = 'IPLAMM – INDÚSTRIA DE PLÁSTICOS LTDA.';
const FONTE = "'Times New Roman',Times,'Liberation Serif',serif";

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

/**
 * Abre a janela de impressão no padrão.
 * @param {object} o  { nome (cabeçalho), titulo (H1), subtitulo, corpo (HTML), rodape (texto), paisagem, extraCss, auto (imprime ao abrir) }
 */
export async function abrirRelatorio({ nome, titulo, subtitulo = '', corpo = '', rodape = '', paisagem = false, extraCss = '', margem, auto = true, janela = null }) {
  const w = janela || window.open('', '_blank'); if (!w) { toast('Libere as janelas pop-up para imprimir', true); return null; }
  const logo = await logoPNG().catch(() => null);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(nome || titulo)} — ${esc(state.empresa?.nome || '')}</title>${cssRelatorio({ paisagem, margem, extra: extraCss })}</head><body>
    <div class="rel-bar"><button onclick="print()">Imprimir / salvar PDF</button></div>
    ${cabecalhoRelatorio(nome || titulo, logo)}
    ${titulo ? `<h1>${esc(titulo)}</h1>` : ''}${subtitulo ? `<div class="sub">${subtitulo}</div>` : ''}
    ${corpo}
    ${rodape ? `<div class="rel-rod">${rodape}</div>` : ''}
    ${auto ? '<script>window.onload=()=>setTimeout(()=>print(),300)</script>' : ''}</body></html>`);
  w.document.close();
  return w;
}

// ---------------------------------------------------------------- PDFs gerados direto (jsPDF)
export const PRETO = [17, 17, 17];
/** as fontes padrão do jsPDF só têm Latin-1: troca travessões, sinais e espaços especiais */
export const pdfLimpo = (t) => String(t ?? '').normalize('NFC').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/×/g, 'x').replace(/[\u00a0\u202f]/g, ' ');
/** passa o documento jsPDF para o padrão: fonte Times em tudo e tabelas (autoTable) com filetes pretos, sem fundo colorido */
export function padronizarPDF(doc) {
  const sf = doc.setFont.bind(doc);
  doc.setFont = (fam, estilo, peso) => sf(!fam || /helvetica|arial|courier|sans/i.test(fam) ? 'times' : fam, estilo, peso);
  doc.setFont('times', 'normal');
  if (typeof doc.autoTable === 'function') {
    const at = doc.autoTable.bind(doc);
    doc.autoTable = (o = {}) => {
      const plain = o.theme === 'plain' && !o.head;   // quadro de indicadores (sem cabeçalho): só a fonte
      if (plain) return at({ ...o, styles: { ...o.styles, font: 'times' } });
      return at({ ...o, theme: 'plain', margin: { bottom: 16, ...o.margin },
        styles: { ...o.styles, font: 'times', textColor: PRETO, lineColor: [187, 187, 187], lineWidth: { top: 0, right: 0, left: 0, bottom: 0.1 } },
        headStyles: { ...o.headStyles, font: 'times', fillColor: false, textColor: PRETO, fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: { top: 0.35, right: 0, left: 0, bottom: 0.2 } },
        footStyles: { ...o.footStyles, font: 'times', fillColor: [242, 242, 242], textColor: PRETO, fontStyle: 'bold', lineColor: [0, 0, 0], lineWidth: { top: 0.2, right: 0, left: 0, bottom: 0.35 } },
        bodyStyles: { ...o.bodyStyles, font: 'times' }, alternateRowStyles: { fillColor: false } });
    };
  }
  return doc;
}
/** cabeçalho do padrão num PDF (topo da página atual, até y = 20 mm): logo e empresa à esquerda; nome do relatório, complemento e emissão à
 *  direita; filete preto. O conteúdo da página começa em y ≥ 23. */
export function pdfCabecalho(doc, nome, logo, { M = 14, sub = '' } = {}) {
  const W = doc.internal.pageSize.getWidth(), txt = pdfLimpo;
  if (logo) doc.addImage(logo.data, 'PNG', M, 7, 10 * logo.ratio, 10);
  doc.setFont('times', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...PRETO);
  doc.text(txt(EMPRESA_REL), M + (logo ? 10 * logo.ratio + 3 : 0), 13.5);
  doc.setFontSize(9.5); doc.text(txt(nome), W - M, 9.5, { align: 'right' });
  doc.setFont('times', 'normal'); doc.setFontSize(8);
  const subs = sub ? doc.splitTextToSize(txt(sub), (W - 2 * M) * 0.55).slice(0, 1) : [];
  if (subs.length) doc.text(subs[0], W - M, 13.5, { align: 'right' });
  doc.text(`emitido em ${new Date().toLocaleString('pt-BR')}`, W - M, subs.length ? 17.5 : 13.5, { align: 'right' });
  doc.setDrawColor(0); doc.setLineWidth(0.35); doc.line(M, 19.8, W - M, 19.8); doc.setTextColor(...PRETO);
}
/** título centralizado em maiúsculas (logo abaixo do cabeçalho, na 1ª página); devolve o y seguinte */
export function pdfTitulo(doc, titulo, y, sub = '') {
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('times', 'bold'); doc.setFontSize(13); doc.setTextColor(...PRETO); doc.text(pdfLimpo(titulo).toUpperCase(), W / 2, y, { align: 'center' });
  if (sub) { doc.setFont('times', 'normal'); doc.setFontSize(9); doc.text(pdfLimpo(sub), W / 2, y + 5, { align: 'center' }); y += 5; }
  doc.setFont('times', 'normal'); return y + 5;
}
/** rodapé do padrão em todas as páginas: filete, base dos dados à esquerda, "Página X de Y" à direita */
export function pdfRodapes(doc, texto = '', { M = 14 } = {}) {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setDrawColor(0); doc.setLineWidth(0.2); doc.line(M, H - 11, W - M, H - 11);
    doc.setFont('times', 'normal'); doc.setFontSize(8); doc.setTextColor(68);
    if (texto) doc.text(doc.splitTextToSize(pdfLimpo(texto), (W - 2 * M) * 0.8)[0], M, H - 7);
    doc.text(`Página ${i} de ${n}`, W - M, H - 7, { align: 'right' });
  }
}

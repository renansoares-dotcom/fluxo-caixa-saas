// Padrão único dos relatórios para impressão (28/10/2026, Renan: "todos os relatórios no mesmo padrão de tipografia" do
// relatório de Fretes e CIOT): Times, cabeçalho com logo + "IPLAMM – INDÚSTRIA DE PLÁSTICOS LTDA." + nome do relatório e emissão
// à direita, título centralizado em maiúsculas, seções numeradas, tabelas com filete preto em cima e embaixo, rodapé com a base dos dados.
//  - abrirRelatorio(): janela de impressão (HTML)
//  - padronizarPDF(doc): PDFs gerados direto (jsPDF + autoTable) passam para Times e para as tabelas do padrão
import { state } from './data.js';
import { esc, toast, logoPNG } from './ui.js';

export { EMPRESA_REL, cssRelatorio, cabecalhoRelatorio, documentoRelatorio } from './relatorio-base.js';
import { EMPRESA_REL, documentoRelatorio } from './relatorio-base.js';

/**
 * Abre a janela de impressão no padrão.
 * @param {object} o  { nome (cabeçalho), titulo (H1), subtitulo, corpo (HTML), rodape (texto), paisagem, extraCss, auto (imprime ao abrir) }
 */
export async function abrirRelatorio({ nome, titulo, subtitulo = '', corpo = '', rodape = '', paisagem = false, extraCss = '', margem, auto = true, janela = null }) {
  const w = janela || window.open('', '_blank'); if (!w) { toast('Libere as janelas pop-up para imprimir', true); return null; }
  const logo = await logoPNG().catch(() => null);
  w.document.write(documentoRelatorio({ nome, titulo, subtitulo, corpo, rodape, paisagem, extraCss, margem, auto, logo, tituloPagina: `${nome || titulo} — ${state.empresa?.nome || ''}` }));
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

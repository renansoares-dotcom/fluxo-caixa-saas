// Certificado de qualidade da NF-e (melhoria 6.6, SQL 128): as bobinas expedidas na nota, as OPs e os resultados das
// inspeções aprovadas, com a declaração e o responsável dos parâmetros da Qualidade. A montagem das linhas é pura
// (testada em Node); o PDF usa o jsPDF + autoTable carregados na página.
import { avaliar, ETAPAS } from './qualidade.js';

const nf = (v, c = 2) => v == null || v === '' ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
const dataBR = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('/') : '';
const tem = (v) => v != null && v !== '';
const espec = (c) => {
  if (c.tipo === 'atributo') return 'Sem defeito';
  const u = c.unidade ? ' ' + c.unidade : '';
  return tem(c.min) && tem(c.max) ? `${nf(c.min, 4)} a ${nf(c.max, 4)}${u}` : tem(c.min) ? `mín. ${nf(c.min, 4)}${u}` : tem(c.max) ? `máx. ${nf(c.max, 4)}${u}` : '—';
};

/** linhas do certificado: por OP, as bobinas e cada característica com a especificação e o resultado */
export function linhasCertificado(c) {
  return (c.ops || []).map(o => {
    const insp = (o.inspecoes || []).map(i => {
      const av = avaliar(i.caracteristicas || [], i.resultados || []);
      return { numero: i.numero, etapa: ETAPAS[i.etapa] || i.etapa, data: dataBR(i.data), inspetor: i.inspetor || '', plano: i.plano || '', concessao: i.situacao === 'aprovada_concessao',
        itens: av.linhas.map((l, k) => { const car = i.caracteristicas[k];
          return { nome: l.nome, espec: espec(car), resultado: l.tipo === 'atributo' ? `${l.defeitos} defeito(s)` : l.n ? `média ${nf(l.media, 3)} (mín. ${nf(l.min, 3)}, máx. ${nf(l.max, 3)}; n=${l.n})` : '—',
            conforme: l.ok == null ? null : l.ok }; }) };
    });
    return { op: `OP ${o.numero}${o.numero_iniflex ? ` (${o.numero_iniflex})` : ''}`, produto: o.produto || '', expedida: !!o.expedida,
      bobinas: o.bobinas || [], kg: (o.bobinas || []).reduce((s, b) => s + +b.peso_kg, 0), inspecoes: insp };
  });
}

const lat = (s) => String(s ?? '').replace(/[\u00b5\u03bc]/g, 'u').replace(/[–—]/g, '-').replace(/[  ]/g, ' ').replace(/[^\x00-\xff]/g, '');

/** PDF A4 retrato do certificado; c = qual_certificado / portal_certificado */
export function certificadoPDF(c, jsPDF) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' }), M = 16, W = 210 - 2 * M, L = linhasCertificado(c), n = c.nota || {};
  let y = M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(lat(c.empresa?.nome || ''), M, y + 4);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); if (c.empresa?.cnpj) doc.text(lat('CNPJ ' + c.empresa.cnpj), M, y + 9);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('CERTIFICADO DE QUALIDADE', 210 - M, y + 5, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(lat(`NF-e ${n.numero}${n.serie ? ' série ' + n.serie : ''} - emissão ${dataBR(n.emissao)}`), 210 - M, y + 10, { align: 'right' });
  y += 14; doc.setLineWidth(0.4); doc.line(M, y, 210 - M, y); y += 6;
  doc.setFontSize(9);
  [['Cliente', `${n.cliente || ''}${n.cliente_doc ? ' - ' + n.cliente_doc : ''}`], ['Chave de acesso', (n.chave || '').replace(/(\d{4})(?=\d)/g, '$1 ')], ['Expedido', `${c.bobinas} bobina(s), ${nf(c.kg, 1)} kg`]]
    .forEach(([k, v]) => { doc.setFont('helvetica', 'bold'); doc.text(lat(k + ':'), M, y); doc.setFont('helvetica', 'normal'); doc.text(lat(v), M + 30, y); y += 5; });
  y += 2;
  const tab = (o) => { doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.2, lineColor: 0, lineWidth: 0.15, textColor: 0 },
    headStyles: { fillColor: false, textColor: 0, fontStyle: 'bold' }, ...o }); y = doc.lastAutoTable.finalY + 5; };
  L.forEach(o => {
    if (y > 250) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(lat(`${o.op} - ${o.produto}`), M, y); y += 2;
    if (o.bobinas.length) tab({ head: [['Bobina', 'Peso (kg)', 'Metros', 'Lote da matéria-prima']], body: o.bobinas.map(b => [lat(b.codigo), nf(b.peso_kg, 1), b.metros ? nf(b.metros, 0) : '', lat(b.lote_materia || '')]),
      foot: [['Total', nf(o.kg, 1), '', '']], footStyles: { fillColor: false, textColor: 0, fontStyle: 'bold' }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } });
    else { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Bobina de origem (extrusão) das bobinas expedidas.', M, y + 3); y += 7; }
    if (!o.inspecoes.length) { doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.text('Sem inspeção aprovada registrada para esta OP.', M, y); y += 6; }
    o.inspecoes.forEach(i => tab({ head: [[{ content: lat(`Inspeção ${i.numero} - ${i.etapa}${i.plano ? ' - ' + i.plano : ''} - ${i.data}${i.inspetor ? ' - ' + i.inspetor : ''}${i.concessao ? ' (aprovada com concessão)' : ''}`), colSpan: 4 }],
      ['Característica', 'Especificação', 'Resultado', 'Avaliação']],
      body: i.itens.length ? i.itens.map(x => [lat(x.nome), lat(x.espec), lat(x.resultado), x.conforme == null ? '-' : x.conforme ? 'Conforme' : 'Não conforme']) : [[{ content: 'Inspeção visual aprovada.', colSpan: 4 }]] }));
  });
  if (y > 240) { doc.addPage(); y = M; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const txt = doc.splitTextToSize(lat(c.texto || ''), W); doc.text(txt, M, y + 2); y += txt.length * 4.5 + 18;
  doc.line(M + W / 2 - 40, y, M + W / 2 + 40, y);
  doc.setFont('helvetica', 'bold'); doc.text(lat(c.responsavel || 'Responsável pela Qualidade'), M + W / 2, y + 5, { align: 'center' });
  doc.setFont('helvetica', 'normal'); if (c.cargo) doc.text(lat(c.cargo), M + W / 2, y + 9.5, { align: 'center' });
  const tot = doc.getNumberOfPages();
  for (let p = 1; p <= tot; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(90);
    doc.text(lat(`Gerado em ${new Date(c.gerado_em || Date.now()).toLocaleString('pt-BR').slice(0, 17)} pela plataforma, a partir dos registros de produção e qualidade.`), M, 290);
    doc.text(`Página ${p}/${tot}`, 210 - M, 290, { align: 'right' }); doc.setTextColor(0); }
  return doc;
}

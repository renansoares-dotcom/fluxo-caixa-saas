// HTML do manual de uso no padrão dos relatórios — o mesmo na tela Tutoriais (Imprimir) e no PDF (tutoriais/gerar-pdf.mjs).
import { lerManual, mdParaHtml, CSS_MANUAL } from './markdown.js';
import { documentoRelatorio } from './relatorio-base.js';

export const dataBR = (iso) => (iso || '').split('-').reverse().join('/');
export function htmlManual(m, md, logo, { auto = false, barra = false } = {}) {
  const { dados, corpo } = lerManual(md);
  const tit = dados.titulo || m.titulo, ver = dados.versao || '1.0';
  return documentoRelatorio({ nome: 'Manual de uso da plataforma', titulo: `Manual — ${tit}`, logo, barra, auto, tituloPagina: `Manual — ${tit}`,
    subtitulo: `${dados.tela || m.area} · versão ${ver} · atualizado em ${dataBR(dados.atualizado)}`,
    corpo: `<div class="manual-corpo">${mdParaHtml(corpo)}</div>`, extraCss: CSS_MANUAL,
    rodape: `Manual de uso — ${tit} · versão ${ver} de ${dataBR(dados.atualizado)}.` });
}

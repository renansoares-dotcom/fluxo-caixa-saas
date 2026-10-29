// Leitor de PDF (pdf.js 4.10.38) servido pelo próprio site (vendor/), sem CDN externo.
// A versão 3.11 usada antes tinha a falha CVE-2024-4367 (PDF malicioso executando código); a 4.10 é a corrigida.
let P = null;
export function carregarPdfjs() {
  P ??= import(new URL('../../vendor/pdfjs-4.10.38.min.mjs', import.meta.url).href).then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs-4.10.38.worker.min.mjs', import.meta.url).href;
    return m;
  }).catch((e) => { P = null; throw new Error('Não foi possível carregar o leitor de PDF: ' + (e.message || e)); });
  return P;
}

// Padrão oficial dos relatórios à Diretoria (doc do projeto "padrao-relatorio-diretoria.md", modelo de 29/10/2026), na
// versão de navegador: abre uma janela com o documento e o diálogo de impressão (salvar em PDF). Cabeçalho e rodapé
// corridos pelas margens da página (@page), com "Página X de Y". Usado pelo Painel da Diretoria (melhoria 2.4).
//
// spec = { nome, rodape, empresa: { nome, nomeOficial, cnpj, endereco }, ident: [[rótulo, valor]], titulo, subtitulo,
//          secoes: [{ titulo, novaPagina, blocos: ['parágrafo' | { p } | { itens } | { tabela } | { fontes } | { deliberacao } | { assinaturas }] }] }
// Texto dos blocos aceita HTML simples (<b>, <i>) — escape o que vier do usuário antes.
import { toast } from './ui.js';

const FONTE = "'Times New Roman','Liberation Serif',Times,serif";
const amp = (s) => String(s ?? '').replace(/&(?![a-z#0-9]+;)/gi, '&amp;');
const css = (s) => String(s ?? '').replace(/["\\]/g, '\\$&');

export function cssDiretoria(s) {
  return `@page{size:A4;margin:24mm 20mm 22mm 20mm;
    @top-left{content:"${css(s.empresa.nome)}";font:bold 9.5pt ${FONTE};border-bottom:.8px solid #000;vertical-align:bottom;padding-bottom:2mm}
    @top-right{content:"${css(s.nome)}";font:9.5pt ${FONTE};border-bottom:.8px solid #000;vertical-align:bottom;padding-bottom:2mm}
    @bottom-left{content:"${css(s.rodape || 'Documento interno – para aprovação da Diretoria')}";font:9.5pt ${FONTE};border-top:.8px solid #000;vertical-align:top;padding-top:2mm}
    @bottom-right{content:"Página " counter(page) " de " counter(pages);font:9.5pt ${FONTE};border-top:.8px solid #000;vertical-align:top;padding-top:2mm}}
*{box-sizing:border-box} body{font-family:${FONTE};color:#111;font-size:11.5pt;line-height:1.38;margin:0}
.barra{position:fixed;top:8px;right:8px;font-family:system-ui,sans-serif} .barra button{padding:8px 14px;font-size:13px;cursor:pointer} @media print{.barra{display:none}}
.emp{text-align:center;margin-top:2mm} .emp .n{font-weight:bold;font-size:13pt} .emp .c{font-size:9.5pt} .emp .e{font-size:9pt}
table{width:100%;border-collapse:collapse}
.ident{margin:5mm 0 6mm;font-size:10pt} .ident td{padding:5px 6px;border-bottom:.4px solid #bbb;vertical-align:middle}
.ident tr:first-child td{border-top:1.4px solid #000} .ident tr:last-child td{border-bottom:1.4px solid #000} .ident td:first-child{font-weight:bold;width:27%}
h1{text-align:center;font-size:17pt;margin:4mm 0 0;letter-spacing:.01em} .sub{text-align:center;font-size:11pt;margin:0 0 5mm}
h2{font-size:13pt;margin:6mm 0 2.5mm;page-break-after:avoid}
.par{display:flex;margin:0 0 2.2mm;text-align:justify} .par .k{flex:0 0 13mm} .par .t{flex:1}
.ali{margin:0 0 2.2mm 20mm} .ali div{margin:0 0 1.2mm} .ali .l{display:inline-block;width:7mm}
.tb{margin:3mm 0} .tb .cap{font-weight:bold;font-size:9.5pt;text-decoration:underline;margin:0 0 0 1mm;break-after:avoid}
.tb table{font-size:9.2pt;line-height:1.25} .tb thead{display:table-header-group} .tb tr{page-break-inside:avoid}
.tb th{text-align:left;font-weight:bold;border-top:1.4px solid #000;border-bottom:.8px solid #000;padding:3px 5px}
.tb td{padding:3.5px 5px;border-bottom:.4px solid #c8c8c8;vertical-align:top} .tb tbody tr:last-child td{border-bottom:1.4px solid #000}
.tb .r{text-align:right} .tb tr.tot td{font-weight:bold} .tb .nota{font-style:italic;font-size:8.2pt;color:#555;margin:1mm 0 0 1mm}
.fon{font-size:9pt;line-height:1.3} .fon div{margin:0 0 1.6mm} .fon a{color:#1f4e9c;text-decoration:none;word-break:break-all}
.del td,.del th{font-size:10pt} .del th:nth-child(n+2),.del td:nth-child(n+2){width:17%}
.obs{margin:5mm 0 0} .obs .ln{border-bottom:.5px solid #999;height:9mm}
.ass{display:flex;justify-content:space-between;margin-top:14mm;page-break-inside:avoid} .ass>div{width:44%;text-align:center;border-top:.9px solid #000;padding-top:2mm}
.ass .d{font-size:10pt;margin-top:3mm} h2.np{page-break-before:always;margin-top:0}`;
}

export function htmlDiretoria(s, { barra = true, auto = true } = {}) {
  let sec = 0, tabN = 0; const out = [];
  out.push(`<div class="emp"><div class="n">${amp(s.empresa.nomeOficial || s.empresa.nome)}</div>${s.empresa.cnpj ? `<div class="c">CNPJ ${amp(s.empresa.cnpj)}</div>` : ''}${s.empresa.endereco ? `<div class="e">${amp(s.empresa.endereco)}</div>` : ''}</div>`);
  out.push(`<table class="ident">${s.ident.map(([a, b]) => `<tr><td>${amp(a)}</td><td>${amp(b)}</td></tr>`).join('')}</table>`);
  out.push(`<h1>${amp(String(s.titulo).toUpperCase())}</h1>${s.subtitulo ? `<div class="sub">${amp(s.subtitulo)}</div>` : ''}`);
  for (const se of s.secoes) {
    sec++; let par = 0;
    out.push(`<h2${se.novaPagina ? ' class="np"' : ''}>${sec}. ${amp(String(se.titulo).toUpperCase())}</h2>`);
    for (const b of se.blocos) {
      if (typeof b === 'string') { par++; out.push(`<div class="par"><span class="k">${sec}.${par}</span><span class="t">${amp(b)}</span></div>`); }
      else if (b.p != null) out.push(`<div class="par"><span class="t">${amp(b.p)}</span></div>`);
      else if (b.itens) out.push(`<div class="ali">${b.itens.map((x, i) => `<div><span class="l">${'abcdefghijklmnopqrstuvwxyz'[i]})</span>${amp(x)}</div>`).join('')}</div>`);
      else if (b.tabela) {
        const t = b.tabela; tabN++; const dir = new Set(t.dir || []);
        const col = t.larg ? `<colgroup>${t.larg.map(w => `<col style="width:${w}">`).join('')}</colgroup>` : '';
        out.push(`<div class="tb"><div class="cap">Tabela ${tabN} – ${amp(t.titulo)}</div><table>${col}<thead><tr>${t.cab.map((c, i) => `<th class="${dir.has(i) ? 'r' : ''}">${amp(c)}</th>`).join('')}</tr></thead><tbody>${
          t.linhas.map((l, li) => `<tr class="${t.total && li === t.linhas.length - 1 ? 'tot' : ''}">${l.map((c, i) => `<td class="${dir.has(i) ? 'r' : ''}">${amp(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${t.nota ? `<div class="nota">${amp(t.nota)}</div>` : ''}</div>`);
      } else if (b.fontes) out.push(`<div class="fon">${b.fontes.map(([t, u], i) => `<div>[${i + 1}] ${amp(t)}.${u ? ` <a href="${u}">${amp(u)}</a>` : ''}</div>`).join('')}</div>`);
      else if (b.assinaturas) out.push(`<div class="ass">${b.assinaturas.map(a => `<div>${amp(a)}<div class="d">Data: ____/____/______</div></div>`).join('')}</div>`);
      else if (b.deliberacao) {
        const d = b.deliberacao;
        out.push(`<div class="tb del"><table><thead><tr><th>Item</th><th>Aprovado</th><th>Não aprovado</th></tr></thead><tbody>${d.itens.map((x, i) => `<tr><td>${i + 1}. ${amp(x)}</td><td>( )</td><td>( )</td></tr>`).join('')}</tbody></table></div>`);
        out.push('<div class="obs">Observações:<div class="ln"></div><div class="ln"></div><div class="ln"></div></div>');
        out.push(`<div class="ass">${(d.assinaturas || ['Diretoria', 'Financeiro / Controladoria']).map(a => `<div>${amp(a)}<div class="d">Data: ____/____/______</div></div>`).join('')}</div>`);
      }
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${amp(s.arquivo || s.titulo)}</title><style>${cssDiretoria(s)}</style></head><body>
    ${barra ? '<div class="barra"><button onclick="print()">Imprimir / salvar PDF</button></div>' : ''}${out.join('\n')}
    ${auto ? '<script>window.onload=()=>setTimeout(()=>print(),400)</script>' : ''}</body></html>`;
}

export function abrirRelatorioDiretoria(s, opts) {
  const w = window.open('', '_blank'); if (!w) { toast('Libere as janelas pop-up para gerar o PDF', true); return null; }
  w.document.write(htmlDiretoria(s, opts)); w.document.close(); return w;
}

// data por extenso: "7 de novembro de 2026"
export const dataExtenso = (d = new Date()) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
// CNPJ formatado
export const cnpjFmt = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(c || ''); };

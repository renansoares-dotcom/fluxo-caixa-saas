// Padrão dos relatórios da plataforma (21/11/2026, Renan): leiaute de ERP, sóbrio — preto e cinza, Times, filetes, sem cor,
// sem fundo, sem ícone, só o nome da empresa (sem logotipo) — e com os filtros escolhidos impressos no bloco
// "Parâmetros do relatório", para o relatório poder ser repetido. Parte pura (sem banco nem tela): devolve o HTML.
// FASE 0 (modelo para aprovação): ainda não é usado por nenhuma tela. Ver scripts/relatorio-modelo/.
//
// spec = {
//   codigo: 'EST002-R01', nome: 'Kardex por produto' (cabeçalho corrido), titulo, subtitulo, paisagem,
//   empresa: { nome, cnpj },
//   emissao: { numero, quando: Date, usuario },
//   parametros: [[rótulo, valor]]            → todos os filtros, inclusive os deixados em "Todos", ordenação e agrupamento
//   resumo: [[rótulo, valor]]                → indicadores do relatório (quadro, sem cartões)
//   secoes: [{ titulo, nota, tabela }]       → numeradas 1., 2., …
//     tabela = { colunas: [{ t, n (alinha à direita), w ('12%') }], linhas: [[…]] | grupos: [{ titulo, linhas, subtotal: […] }], total: […] }
//   fonte: 'de onde vêm os dados' (rodapé corrido), registros: nº de registros listados
// }
// As células aceitam HTML simples; escape o que vier do usuário (esc).
const FONTE = "'Times New Roman','Liberation Serif',Times,serif";
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (s) => String(s ?? '').replace(/["\\]/g, '\\$&');

/** número no padrão do relatório: milhar com ponto, vírgula decimal, negativo com sinal de menos (nunca cor nem parênteses); nulo = vazio */
export function numero(v, casas = 2, { zero = true } = {}) {
  if (v == null || v === '' || Number.isNaN(+v)) return '';
  const x = Math.round(+v * 10 ** casas) / 10 ** casas;
  if (!x && !zero) return '';
  const [i, d] = Math.abs(x).toFixed(casas).split('.');
  return (x < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + d : '');
}
export const dataBR = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
export const dataHora = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const numeroEmissao = (n) => String(n ?? '').padStart(6, '0');

/** parâmetros em pares (rótulo, valor): filtro vazio vira "Todos" — o relatório sempre diz o que foi escolhido */
export function parametros(lista) {
  return (lista || []).filter(Boolean).map(([r, v]) => [r, v == null || v === '' || (Array.isArray(v) && !v.length) ? 'Todos' : Array.isArray(v) ? v.join(', ') : String(v)]);
}

export function cssPadrao(s) {
  const cab = 'font:9pt ' + FONTE + ';color:#000;vertical-align:bottom;padding-bottom:1.6mm;margin-bottom:2.5mm;border-bottom:.8px solid #000;white-space:pre';
  const rod = 'font:8pt ' + FONTE + ';color:#000;vertical-align:top;padding-top:1.4mm;border-top:.5px solid #000';
  return `@page{size:A4 ${s.paisagem ? 'landscape' : 'portrait'};margin:25mm 12mm 16mm 12mm;
    @top-left{content:"${css(s.empresa.nome)}" "\\A" "${css(s.empresa.cnpj ? 'CNPJ ' + s.empresa.cnpj : '')}";${cab};font-weight:bold;text-align:left}
    @top-right{content:"${css(s.codigo)} – ${css(s.nome)}" "\\A" "Emissão nº ${css(numeroEmissao(s.emissao.numero))} · ${css(dataHora(s.emissao.quando))} · ${css(s.emissao.usuario)}";${cab};text-align:right}
    @bottom-left{content:"${css(s.fonte || '')}";${rod};text-align:left}
    @bottom-right{content:"Página " counter(page) " de " counter(pages);${rod};text-align:right;width:32mm}}
*{box-sizing:border-box} body{font-family:${FONTE};color:#000;font-size:9pt;line-height:1.28;margin:0}
.barra{position:fixed;top:8px;right:8px;font-family:system-ui,sans-serif} .barra button{padding:8px 14px;font-size:13px;cursor:pointer} @media print{.barra{display:none}}
h1{text-align:center;font-size:13pt;margin:1mm 0 0;text-transform:uppercase;letter-spacing:.02em} .sub{text-align:center;font-size:9.5pt;margin:.5mm 0 3mm}
h2{font-size:10pt;margin:4.5mm 0 1.2mm;text-transform:uppercase;break-after:avoid}
table{width:100%;border-collapse:collapse} .tb{table-layout:fixed} .bl{break-inside:avoid} thead{display:table-header-group} tr{break-inside:avoid}
.q{margin:0 0 1mm} .q .rot{font-size:8pt;font-weight:bold;text-transform:uppercase;letter-spacing:.04em;margin:0 0 .8mm}
.par td{padding:1.1mm 1.5mm;border-bottom:.3px solid #999;vertical-align:top} .par tr:first-child td{border-top:1.2px solid #000} .par tr:last-child td{border-bottom:1.2px solid #000}
.par td.k{font-weight:bold;width:17%;white-space:nowrap} .par td.v{width:33%}
.res th{font-size:8pt;font-weight:normal;text-align:right;padding:1mm 1.5mm 0;border-top:1.2px solid #000} .res td{font-weight:bold;font-size:10.5pt;text-align:right;padding:0 1.5mm 1mm;border-bottom:1.2px solid #000;white-space:nowrap}
.res th:first-child,.res td:first-child{text-align:left}
.tb{font-size:8.3pt;line-height:1.22} .tb th{text-align:left;font-weight:bold;border-top:1.2px solid #000;border-bottom:.7px solid #000;padding:1mm 1.3mm;vertical-align:bottom}
.tb td{padding:.75mm 1.3mm;border-bottom:.3px solid #bbb;vertical-align:top} .tb .n{text-align:right;white-space:nowrap}
.tb tr.gr,.tb tr.sa{break-after:avoid} .tb tr.st,.tb tr.tot{break-before:avoid} .tb tr.gr td{font-weight:bold;border-bottom:.7px solid #000;padding-top:2.4mm} .tb tr.gr:first-child td{padding-top:1mm}
.tb tr.st td{font-weight:bold;border-top:.7px solid #000;border-bottom:.3px solid #000} .tb tr.sa td{font-style:italic}
.tb tr.tot td{font-weight:bold;border-top:.9px solid #000;border-bottom:1.2px solid #000} .tb tbody tr:last-child td{border-bottom:1.2px solid #000}
.nota{font-style:italic;font-size:7.8pt;margin:1mm 0 0 .5mm} .fim{margin:5mm 0 0;font-size:8pt;text-align:center;border-top:.5px solid #000;padding-top:1.2mm;break-inside:avoid}`;
}

const linha = (cols, l, cls = '') => {
  let i = 0; const tds = [];
  for (const c of l) {
    const o = c && typeof c === 'object' ? c : { v: c }; const span = o.span || 1;
    tds.push(`<td${span > 1 ? ` colspan="${span}"` : ''} class="${cols[i]?.n && span === 1 ? 'n' : ''}">${o.v ?? ''}</td>`); i += span;
  }
  return `<tr class="${cls}">${tds.join('')}</tr>`;
};

export function tabelaPadrao(t) {
  const cols = t.colunas;
  const corpo = [];
  if (t.grupos) for (const g of t.grupos) {
    corpo.push(`<tr class="gr"><td colspan="${cols.length}">${g.titulo}</td></tr>`);
    if (g.anterior) corpo.push(linha(cols, g.anterior, 'sa'));
    for (const l of g.linhas) corpo.push(linha(cols, l));
    if (g.subtotal) corpo.push(linha(cols, g.subtotal, 'st'));
  } else for (const l of t.linhas || []) corpo.push(linha(cols, l));
  if (t.total) corpo.push(linha(cols, t.total, 'tot'));
  return `<table class="tb"><colgroup>${cols.map(c => `<col${c.w ? ` style="width:${c.w}"` : ''}>`).join('')}</colgroup>
    <thead><tr>${cols.map(c => `<th class="${c.n ? 'n' : ''}">${c.t}</th>`).join('')}</tr></thead><tbody>${corpo.join('')}</tbody></table>${t.nota ? `<div class="nota">${t.nota}</div>` : ''}`;
}

export function htmlPadrao(s, { barra = false, auto = false } = {}) {
  const P = parametros(s.parametros), out = [];
  out.push(`<h1>${esc(s.titulo)}</h1>${s.subtitulo ? `<div class="sub">${esc(s.subtitulo)}</div>` : '<div class="sub"></div>'}`);
  // parâmetros: dois pares por linha
  const lin = []; for (let i = 0; i < P.length; i += 2) lin.push(`<tr><td class="k">${esc(P[i][0])}</td><td class="v">${esc(P[i][1])}</td>${P[i + 1] ? `<td class="k">${esc(P[i + 1][0])}</td><td class="v">${esc(P[i + 1][1])}</td>` : '<td class="k"></td><td class="v"></td>'}</tr>`);
  out.push(`<div class="q"><div class="rot">Parâmetros do relatório</div><table class="par">${lin.join('')}</table></div>`);
  if (s.resumo?.length) out.push(`<div class="q" style="margin-top:3mm"><div class="rot">Resumo</div><table class="res"><tr>${s.resumo.map(([r]) => `<th>${esc(r)}</th>`).join('')}</tr><tr>${s.resumo.map(([, v]) => `<td>${esc(v)}</td>`).join('')}</tr></table></div>`);
  (s.secoes || []).forEach((se, i) => {
    // tabela curta não se divide entre páginas; a longa quebra e repete o cabeçalho das colunas
    const n = se.tabela ? (se.tabela.linhas?.length || 0) + (se.tabela.grupos || []).reduce((a, g) => a + g.linhas.length + 3, 0) : 0;
    out.push(`<div class="${n <= 12 ? 'bl' : ''}"><h2>${i + 1}. ${esc(se.titulo)}</h2>${se.tabela ? tabelaPadrao(se.tabela) : ''}${se.nota ? `<div class="nota">${se.nota}</div>` : ''}</div>`);
  });
  out.push(`<div class="fim">Fim do relatório${s.registros != null ? ` · ${numero(s.registros, 0)} registro(s)` : ''} · ${esc(s.codigo)} · emissão nº ${numeroEmissao(s.emissao.numero)}</div>`);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(s.arquivo || `${s.codigo} ${s.nome}`)}</title><style>${cssPadrao(s)}</style></head><body>
    ${barra ? '<div class="barra"><button onclick="print()">Imprimir / salvar PDF</button></div>' : ''}${out.join('\n')}
    ${auto ? '<script>window.onload=()=>setTimeout(()=>print(),400)</script>' : ''}</body></html>`;
}

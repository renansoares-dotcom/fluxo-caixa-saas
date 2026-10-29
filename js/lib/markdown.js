// Markdown simples dos manuais (tutoriais/*.md) para HTML — sem bibliotecas, igual na tela e no PDF.
// Suporta: cabeçalho de dados entre "---", # ## ###, parágrafos, listas (- e 1.), **negrito**, *itálico*, `código`,
// tabelas com |, citações com > (viram quadros de destaque) e linha horizontal (---).
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** separa o cabeçalho de dados (chave: valor) do texto */
export function lerManual(md) {
  const txt = String(md || '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(txt);
  const dados = {};
  if (m) for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) dados[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return { dados, corpo: m ? txt.slice(m[0].length) : txt };
}

const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((#\/[^)\s]+|https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

/** converte o corpo do manual em HTML */
export function mdParaHtml(md) {
  const L = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const bloco = (re) => { const xs = []; while (i < L.length && re.test(L[i])) xs.push(L[i++]); return xs; };
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { const n = m[1].length; out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue; }
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) { const xs = bloco(/^\s*>/).map(x => x.replace(/^\s*>\s?/, '')); out.push(`<blockquote>${mdParaHtml(xs.join('\n'))}</blockquote>`); continue; }
    if (/^\s*\|/.test(l)) {
      const xs = bloco(/^\s*\|/).map(x => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      const sep = xs[1] && xs[1].every(c => /^:?-{2,}:?$/.test(c));
      const cab = sep ? xs[0] : null, linhas = sep ? xs.slice(2) : xs;
      out.push(`<table>${cab ? `<thead><tr>${cab.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${linhas.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
      const ord = /^\s*\d+[.)]\s+/.test(l), ini = ord ? parseInt(l.trim(), 10) : 1;
      const itens = [];
      while (i < L.length && (/^\s*([-*]|\d+[.)])\s+/.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && itens.length))) {
        if (/^\s*([-*]|\d+[.)])\s+/.test(L[i]) && !/^\s{2,}/.test(L[i])) itens.push([L[i].replace(/^\s*([-*]|\d+[.)])\s+/, '')]);
        else itens[itens.length - 1].push(L[i].trim().replace(/^([-*]|\d+[.)])\s+/, '• '));
        i++;
      }
      const tag = ord ? 'ol' : 'ul';
      out.push(`<${tag}${ord && ini > 1 ? ` start="${ini}"` : ''}>${itens.map(x => `<li>${x.map(inline).join('<br>')}</li>`).join('')}</${tag}>`);
      continue;
    }
    const ps = bloco(/^(?!\s*$)(?!#{1,4}\s)(?!\s*>)(?!\s*\|)(?!\s*([-*]|\d+[.)])\s+)(?!---+\s*$).*/);
    out.push(`<p>${ps.map(inline).join(' ')}</p>`);
  }
  return out.join('\n');
}

/** estilo dos manuais (tela e PDF), por cima do padrão dos relatórios */
export const CSS_MANUAL = `
  .manual-corpo{font-size:11px;line-height:1.45}
  .manual-corpo h2{font-size:12.5px;margin:16px 0 4px;padding-bottom:2px;border-bottom:.6px solid #111;page-break-after:avoid}
  .manual-corpo h3{font-size:11.5px;margin:10px 0 3px;page-break-after:avoid}
  .manual-corpo p{margin:4px 0 6px} .manual-corpo ul,.manual-corpo ol{margin:4px 0 8px;padding-left:22px} .manual-corpo li{margin:2px 0}
  .manual-corpo li,.manual-corpo blockquote,.manual-corpo table{page-break-inside:avoid}
  .manual-corpo blockquote{margin:8px 0;padding:6px 10px;border-left:2px solid #111;background:#f4f4f4}
  .manual-corpo blockquote p{margin:2px 0}
  .manual-corpo code{font-family:'Courier New',monospace;font-size:10px;background:#f0f0f0;padding:0 3px}
  .manual-corpo hr{border:0;border-top:.6px solid #111;margin:12px 0}
  .manual-corpo td,.manual-corpo th{font-size:10px}`;

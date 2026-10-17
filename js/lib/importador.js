// Leitura de planilha (Excel/CSV) com mapeamento de colunas automático e prévia — usado nas importações do Iniflex.
import { $, $$, esc } from './ui.js';
import { num } from './compras.js';

export async function lerPlanilha(file) {
  if (!window.XLSX) throw new Error('Biblioteca de Excel ainda carregando; tente de novo em instantes.');
  const buf = await file.arrayBuffer(); let wb;
  if (/\.(csv|txt)$/i.test(file.name)) {   // CSV: UTF-8 ou Windows-1252, separador ; ou ,
    let t; try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { t = new TextDecoder('windows-1252').decode(buf); }
    const l1 = t.split(/\r?\n/)[0] || '';
    wb = XLSX.read(t, { type: 'string', FS: (l1.match(/;/g) || []).length > (l1.match(/,/g) || []).length ? ';' : ',', raw: true });
  } else wb = XLSX.read(buf, { type: 'array', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
}

// campos: [{ k, t, re: /regex do cabeçalho/, obrig, tipo: 'texto'|'numero'|'data'|'datahora' }]
// monta o mapeamento dentro de `el`; devolve { linhas(): objetos convertidos, ok(): bool }
export function mapearColunas(el, aoa, campos) {
  let h = aoa.findIndex(r => r.filter(c => String(c).trim() && isNaN(+c)).length >= Math.min(3, campos.filter(c => c.obrig).length + 1)
    && campos.filter(c => c.obrig).every(c => r.some(x => c.re.test(String(x)))));
  if (h < 0) h = 0;
  const cab = aoa[h].map(c => String(c).trim()), dados = aoa.slice(h + 1).filter(r => r.some(c => String(c).trim() !== ''));
  const usado = new Set(), auto = {};
  for (const c of campos) { const i = cab.findIndex((x, j) => !usado.has(j) && c.re.test(x)); if (i >= 0) { auto[c.k] = i; usado.add(i); } }
  el.innerHTML = `<h3 style="margin:0 0 6px">Colunas do arquivo (${dados.length} linha(s))</h3><div class="grid-form">
    ${campos.map(c => `<label>${esc(c.t)}${c.obrig ? ' *' : ''}<select class="im-c" data-k="${c.k}"><option value="">—</option>${cab.map((x, i) => `<option value="${i}" ${auto[c.k] === i ? 'selected' : ''}>${esc(x || 'coluna ' + (i + 1))}</option>`).join('')}</select></label>`).join('')}</div>
    <div class="im-prev" style="margin-top:10px"></div>`;
  const mapa = () => Object.fromEntries($$('.im-c', el).map(s => [s.dataset.k, s.value === '' ? null : +s.value]));
  const conv = (v, tipo) => {
    if (v == null || String(v).trim() === '') return null;
    if (tipo === 'numero') return typeof v === 'number' ? v : num(v);
    if (tipo === 'data' || tipo === 'datahora') {
      if (v instanceof Date) return tipo === 'data' ? v.toISOString().slice(0, 10) : v.toISOString();
      if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return tipo === 'data' ? d.toISOString().slice(0, 10) : d.toISOString(); }
      const s = String(v).trim(), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        return tipo === 'data' ? d : `${d}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}-03:00`; }
      return s;
    }
    return String(v).trim();
  };
  const linhas = () => { const mp = mapa(); return dados.map(r => Object.fromEntries(campos.map(c => [c.k, mp[c.k] != null ? conv(r[mp[c.k]], c.tipo) : null]))); };
  const ok = () => { const mp = mapa(); return campos.filter(c => c.obrig).every(c => mp[c.k] != null); };
  const prev = () => { const L = linhas().slice(0, 6);
    $('.im-prev', el).innerHTML = ok() ? `<div class="table-wrap"><table><thead><tr>${campos.map(c => `<th>${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${L.map(r => `<tr>${campos.map(c => `<td>${esc(r[c.k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="small muted">Prévia das 6 primeiras linhas já convertidas.</p>`
      : '<p class="small warn">Escolha as colunas obrigatórias (*).</p>'; };
  el.onchange = prev; prev();
  return { linhas, ok };
}

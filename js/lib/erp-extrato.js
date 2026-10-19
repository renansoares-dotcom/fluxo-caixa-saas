// Leitura do relatório "Extrato de Contas por Quebra por Data Efetivação" (rotina RFLX036 do ERP) exportado
// em XLSX, XLS, ODS ou CSV. Serve para qualquer conta do ERP (FS, Caixa, Vortx, FIDCs...): o cabeçalho traz
// "Banco: 902 - FS (FIDC)", o período e o saldo anterior; cada linha traz data, operação, documento,
// emitente, observações, crédito, débito e saldo acumulado.
// Retorna no mesmo formato do lerOFX, para entrar no mesmo fluxo de importação/conciliação:
// { origem:'erp', banco, inicio, fim, saldoAnterior, saldo, saldoData, totalCred, totalDeb, totalGeral, saldosDia, itens:[{ fitid, data, valor, tipo, descricao, documento }] }
// Usa o SheetJS (global XLSX, carregado no index.html).

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const r2 = (v) => Math.round(v * 100) / 100;

function num(v) {
  if (typeof v === 'number') return v;
  let t = String(v ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!t) return NaN;
  let neg = false; if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t); return neg ? -n : n;
}
function data(v) {
  if (v instanceof Date && !isNaN(v)) {
    // datas sem hora do Excel chegam como meia-noite local; arredonda para o dia
    const d = new Date(v.getTime() + 12 * 3600e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 30000 && v < 80000) { // serial do Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10);
  }
  const m = String(v ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
const COLS = { emp: /^emp\.?$/, data: /^data$/, operacao: /^operacao$/, documento: /^documento$/, emitente: /^emitente$/, obs: /^observacoes$/, credito: /^credito$/, debito: /^debito$/, saldo: /^saldo$/ };

/** Lê o arquivo (ArrayBuffer) e devolve o extrato. `nome` decide CSV x planilha. */
export function lerRelatorioERP(buf, nome = '') {
  if (typeof XLSX === 'undefined') throw new Error('Leitor de planilhas não carregado: recarregue a página.');
  if (/\.pdf$/i.test(nome)) throw new Error('PDF não é aceito: no ERP, exporte o relatório em XLSX (ou CSV).');
  let wb;
  if (/\.(csv|txt)$/i.test(nome)) {
    const bytes = new Uint8Array(buf); let txt = new TextDecoder('utf-8').decode(bytes);
    if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(bytes);
    wb = XLSX.read(txt, { type: 'string', raw: true, FS: (txt.split('\n')[0].split(';').length > txt.split('\n')[0].split(',').length) ? ';' : ',' });
  } else wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const linhas = [];
  for (const sn of wb.SheetNames) linhas.push(...XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: false }));
  if (!linhas.length) throw new Error('Arquivo vazio');

  // cabeçalho do relatório: valor = primeira célula preenchida depois do rótulo
  const depois = (re) => { for (const r of linhas) for (let j = 0; j < r.length; j++) if (re.test(norm(r[j]))) { for (let k = j + 1; k < r.length; k++) if (r[k] != null && String(r[k]).trim() !== '') return r[k]; } return null; };
  const rot = norm(linhas.slice(0, 30).flat().filter(Boolean).join(' '));
  if (!/extrato de contas/.test(rot) && !/rflx036/.test(rot)) throw new Error('O arquivo não parece ser o relatório RFLX036 (Extrato de Contas) do ERP.');
  const banco = String(depois(/^banco:?$/) || '').trim() || null;
  const per = String(depois(/^periodo:?$/) || '').match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/);
  const saldoAnterior = num(depois(/^saldo anterior:?$/)); const sa = isFinite(saldoAnterior) ? r2(saldoAnterior) : 0;

  let idx = null; const itens = []; let totalGeral = null; let ult = null;
  const pega = (r, k) => { // valor da coluna k: primeira célula preenchida entre o início da coluna e o início da próxima
    const ini = idx[k]; if (ini == null) return null;
    const prox = Math.min(...Object.values(idx).filter(x => x != null && x > ini), r.length);
    for (let j = ini; j < prox; j++) if (r[j] != null && String(r[j]).trim() !== '') return r[j];
    return null;
  };
  for (const r of linhas) {
    const cel = r.map(norm);
    if (cel.includes('data') && cel.some(c => COLS.credito.test(c)) && cel.some(c => COLS.debito.test(c))) {
      idx = {}; for (const [k, re] of Object.entries(COLS)) { const j = cel.findIndex(c => re.test(c)); idx[k] = j >= 0 ? j : null; }
      continue;
    }
    const tg = cel.findIndex(c => /^total geral:?$/.test(c));
    if (tg >= 0) { const vs = r.slice(tg + 1).map(num).filter(isFinite); if (vs.length >= 2) totalGeral = { cred: r2(vs[0]), deb: r2(vs[1]) }; continue; }
    if (!idx || cel.some(c => /^total data efetivacao:?$/.test(c) || /^data efetivacao:?$/.test(c))) { ult = null; continue; }
    // cabeçalho repetido a cada página (título, rotina, data/hora, página, filtros): não é continuação de linha
    if (cel.some(c => /extrato de contas|^rotina:?$|^rflx036$|^pagina:?$|^data:$|^hora:?$|^primeira quebra|^periodo:?$|^saldo anterior|^grupo empresa|^classificacao:?$|^tipo movimentacao|^banco:?$/.test(c))) { ult = null; continue; }
    const d = data(pega(r, 'data'));
    const c = num(pega(r, 'credito')), db = num(pega(r, 'debito'));
    if (d && (isFinite(c) || isFinite(db))) {
      const s = num(pega(r, 'saldo'));
      ult = { data: d, cred: isFinite(c) ? r2(c) : 0, deb: isFinite(db) ? r2(db) : 0, saldo: isFinite(s) ? r2(s) : null,
        operacao: String(pega(r, 'operacao') ?? '').trim(), documento: String(pega(r, 'documento') ?? '').trim(),
        emitente: String(pega(r, 'emitente') ?? '').trim(), obs: String(pega(r, 'obs') ?? '').trim() };
      itens.push(ult);
    } else if (ult && !d) { // linha de continuação (texto quebrado em duas linhas no relatório)
      for (const k of ['operacao', 'documento', 'emitente', 'obs']) { const v = String(pega(r, k) ?? '').trim(); if (v) ult[k] = `${ult[k]} ${v}`.trim(); }
    }
  }
  if (!idx) throw new Error('Não encontrei a linha de títulos (Data / Operação / Crédito / Débito) no relatório.');

  // identificador estável: data + valor + documento + texto, contando repetições iguais no mesmo arquivo
  const vistos = {};
  const saida = itens.map(x => {
    const valor = r2(x.cred - x.deb);
    const descricao = [x.operacao, x.obs, x.emitente].filter((t, i, a) => t && a.indexOf(t) === i).join(' — ') || null;
    const base = `erp:${x.data}|${valor.toFixed(2)}|${x.documento}|${norm(descricao).replace(/[^a-z0-9]/g, '').slice(0, 60)}`;
    vistos[base] = (vistos[base] || 0) + 1;
    return { fitid: `${base}#${vistos[base]}`, data: x.data, valor, tipo: 'ERP', descricao, documento: x.documento || null, _saldo: x.saldo };
  }).filter(i => i.valor !== 0);

  const totalCred = r2(itens.reduce((s, x) => s + x.cred, 0)), totalDeb = r2(itens.reduce((s, x) => s + x.deb, 0));
  // saldo no fim de cada dia (saldo anterior + movimento acumulado)
  const saldosDia = {}; let acc = sa;
  for (const x of [...itens].sort((a, b) => a.data.localeCompare(b.data))) { acc = r2(acc + x.cred - x.deb); saldosDia[x.data] = acc; }
  const datas = saida.map(i => i.data).sort();
  const inicio = per ? data(per[1]) : datas[0] || null, fim = per ? data(per[2]) : datas[datas.length - 1] || null;
  return { origem: 'erp', banco, agencia: null, conta: null, inicio, fim, saldoAnterior: sa, saldo: r2(sa + totalCred - totalDeb), saldoData: fim,
    totalCred, totalDeb, totalGeral, confere: !totalGeral || (Math.abs(totalGeral.cred - totalCred) < 0.005 && Math.abs(totalGeral.deb - totalDeb) < 0.005),
    saldosDia, itens: saida.map(({ _saldo, ...i }) => i) };
}

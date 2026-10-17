// Produção: cadastros em cache (setores, máquinas, motivos, operadores), rótulos, cálculo de horas, necessidade de material
// e impressão de etiquetas de bobina com QR.
import { sb, state, q, fetchAll } from './data.js';
import { esc, dateBR } from './ui.js';

export const ST_OP = { planejada: ['Planejada', ''], liberada: ['Liberada', 'negoc'], em_producao: ['Em produção', 'aberto'], concluida: ['Concluída', 'pago'], cancelada: ['Cancelada', 'vencido'] };
export const ST_ET = { aguardando: ['Aguardando', ''], em_andamento: ['Em andamento', 'aberto'], concluida: ['Concluída', 'pago'] };
export const TIPOS_FERR = { cliche: 'Clichê', cilindro: 'Cilindro', faca: 'Faca', outro: 'Outro' };
export const podePCP = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
export const podeApontar = () => ['admin', 'financeiro', 'diretor', 'producao'].includes(state.papel);
export const horas = (a, b) => (a && b ? Math.max(0, (new Date(b) - new Date(a)) / 36e5) : 0);
export const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

let cache = null;
export async function cadProducao(force = false) {
  if (cache && cache.emp === state.empresa.id && !force) return cache;
  const e = state.empresa.id;
  const [setores, maquinas, motivos, operadores] = await Promise.all([
    q(sb.from('prod_setores').select('*').eq('empresa_id', e).order('ordem').order('nome')),
    q(sb.from('prod_maquinas').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('prod_motivos').select('*').eq('empresa_id', e).order('nome')),
    q(sb.from('prod_operadores').select('*').eq('empresa_id', e).order('nome'))]);
  const by = (a) => Object.fromEntries(a.map(x => [x.id, x]));
  cache = { emp: e, setores, maquinas, motivos, operadores, setorById: by(setores), maqById: by(maquinas), motById: by(motivos), opById: by(operadores) };
  return cache;
}
export const limparCadProducao = () => { cache = null; };

// necessidade de material da OP: estrutura do produto × quantidade (com perda) × saldo do último espelho do Iniflex
export async function necessidadeMaterial(op) {
  if (!op.produto_id) return { linhas: [], semEstrutura: true };
  const e = state.empresa.id;
  const [estr, [prodOp]] = await Promise.all([q(sb.from('produto_estrutura').select('*').eq('produto_id', op.produto_id)), q(sb.from('produtos').select('unidade').eq('id', op.produto_id))]);
  if (!estr.length) return { linhas: [], semEstrutura: true };
  // a estrutura é por unidade do produto; se a OP estiver em outra unidade (ex.: produto em MIL, OP em KG) não dá para calcular sem conversão
  if (prodOp?.unidade && String(prodOp.unidade).toUpperCase() !== String(op.unidade).toUpperCase()) return { linhas: [], unidadeDiferente: { produto: prodOp.unidade, op: op.unidade } };
  const ids = estr.map(x => x.componente_id);
  const [prods, esp] = await Promise.all([q(sb.from('produtos').select('id,codigo,descricao,unidade,ncm').in('id', ids)),
    q(sb.from('estoque_espelhos').select('id,data_ref').eq('empresa_id', e).order('data_ref', { ascending: false }).limit(1)).catch(() => [])]);
  let saldo = {};
  if (esp[0]) { const it = await fetchAll(() => sb.from('estoque_espelho_itens').select('produto_id,quantidade').eq('espelho_id', esp[0].id).in('produto_id', ids).order('id')).catch(() => []);
    for (const i of it) saldo[i.produto_id] = (saldo[i.produto_id] || 0) + +i.quantidade; }
  const linhas = estr.map(x => { const p = prods.find(pp => pp.id === x.componente_id) || {}; const nec = op.quantidade * x.quantidade / x.base / (1 - x.perda_pct / 100);
    const s = esp[0] ? (saldo[x.componente_id] || 0) : null; return { produto: p, necessario: nec, saldo: s, falta: s == null ? null : Math.max(nec - s, 0) }; });
  return { linhas, espelho: esp[0] || null };
}

// etiqueta de bobina com QR (código da bobina) — biblioteca qrcode-generator carregada só quando precisa
let qrLib = null;
async function qr() {
  if (qrLib) return qrLib;
  await new Promise((ok, err) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; s.onload = ok; s.onerror = err; document.head.appendChild(s); });
  qrLib = window.qrcode; return qrLib;
}
export async function imprimirEtiquetas(bobinas, op, maqNome = (id) => '') {
  let gerar = null;
  try { const lib = await qr(); gerar = (t) => { const c = lib(0, 'M'); c.addData(t); c.make(); return c.createSvgTag({ cellSize: 3, margin: 0 }); }; } catch { gerar = null; }
  const w = window.open('', '_blank'); if (!w) return alert('Libere as janelas pop-up para imprimir as etiquetas');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas — OP ${op.numero}</title><style>
    @page{size:100mm 70mm;margin:3mm} body{font-family:Arial,sans-serif;margin:0} .et{width:94mm;height:64mm;box-sizing:border-box;border:1px solid #000;padding:3mm;display:grid;grid-template-columns:1fr auto;gap:2mm;page-break-after:always}
    .et h1{font-size:15px;margin:0 0 1mm} .et .l{font-size:11px;line-height:1.35} .et .p{font-size:22px;font-weight:700;margin-top:1mm} .cod{font-family:monospace;font-size:13px;font-weight:700} .qr svg{width:30mm;height:30mm}</style></head><body>
    ${bobinas.map(b => `<div class="et"><div><h1>${esc(state.empresa.nome || '')}</h1>
      <div class="l"><b>OP ${op.numero}</b>${op.numero_iniflex ? ` · Iniflex ${esc(op.numero_iniflex)}` : ''}<br>${esc(op.codigo_produto || '')} ${esc(op.descricao || '')}<br>
      ${op.cliente ? `Cliente: ${esc(op.cliente)}<br>` : ''}Máquina: ${esc(maqNome(b.maquina_id))} · ${dateBR(String(b.criado_em || new Date().toISOString()).slice(0, 10))}${b.lote_materia ? `<br>Lote MP: ${esc(b.lote_materia)}` : ''}</div>
      <div class="p">${String(b.peso_kg).replace('.', ',')} kg${b.metros ? ` · ${b.metros} m` : ''}</div><div class="cod">${esc(b.codigo)}</div></div>
      <div class="qr">${gerar ? gerar(b.codigo) : ''}</div></div>`).join('')}
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

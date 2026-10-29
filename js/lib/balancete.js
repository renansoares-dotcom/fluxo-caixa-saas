import { carregarPdfjs } from './pdfjs.js';
// Leitura do balancete de verificação em PDF enviado pela contabilidade (layout GESTCONT/"BALANCETE").
// Funciona com o PDF assinado digitalmente: a camada de texto acrescentada pela assinatura
// (fonte maior, cinza) é ignorada e as colunas são identificadas pela posição na página.
// Nada aqui grava no banco: devolve as contas lidas e o resultado das conferências.

const RX_NUM = /^(\d{1,3}(?:\.\d{3})*,\d{2})([DC]?)$/;
const RX_CLASS = /^\d+(?:\.\d+)*$/;
const r2 = (v) => Math.round(v * 100) / 100;

// "1.234,56D" → 1234.56 ; "1.234,56C" → -1234.56 (devedor positivo, credor negativo)
export function valorBal(s) {
  const m = String(s || '').trim().match(RX_NUM);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  return m[2] === 'C' ? -v : v;
}

// natureza normal da conta pelo grupo: 1 Ativo, 3 Custos/Despesas e 5 Apuração são devedoras
export const naturezaGrupo = (classif) => (['1', '3', '5'].includes(String(classif)[0]) ? 'D' : 'C');

async function linhasDaPagina(page) {
  const { items } = await page.getTextContent();
  const its = items.filter(it => it.str && it.str.trim() && Math.abs(it.transform[0]) < 8)   // ignora a camada da assinatura (fonte ~8.9)
    .map(it => ({ x: it.transform[4], y: it.transform[5], w: it.width || 0, s: it.str.trim() }));
  const linhas = [];
  for (const it of its) {
    let l = linhas.find(l => Math.abs(l.y - it.y) < 1.2);
    if (!l) { l = { y: it.y, its: [] }; linhas.push(l); }
    l.its.push(it);
  }
  linhas.sort((a, b) => b.y - a.y);
  for (const l of linhas) l.its.sort((a, b) => a.x - b.x);
  return linhas;
}

// colunas de valores: borda direita dos títulos "Saldo Anterior", "Débito", "Crédito", "Saldo Atual"
function ancoras(linhas) {
  for (const l of linhas) {
    const f = (t) => l.its.find(i => i.s.toLowerCase().startsWith(t));
    const a = f('saldo anterior'), d = f('débito'), c = f('crédito'), s = f('saldo atual');
    if (a && d && c && s) return { cls: l.its.find(i => i.s.toLowerCase().startsWith('classifica'))?.x ?? 28, desc: l.its.find(i => i.s.toLowerCase().startsWith('descri'))?.x ?? 105, col: [a.x + a.w, d.x + d.w, c.x + c.w, s.x + s.w] };
  }
  return null;
}

export async function lerBalancete(doc) {
  const contas = [], resumo = {}, avisos = [];
  const cab = {};
  let anc = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const linhas = await linhasDaPagina(await doc.getPage(p));
    anc = ancoras(linhas) || anc;
    if (!anc) { avisos.push(`Página ${p}: cabeçalho de colunas não encontrado`); continue; }
    let noResumo = false;
    for (const l of linhas) {
      const txt = l.its.map(i => i.s).join(' ');
      if (!cab.empresa) { const m = txt.match(/Empresa:\s*(.+?)\s+Folha:/); if (m) cab.empresa = m[1].trim(); }
      if (!cab.cnpj) { const m = txt.match(/C\.N\.P\.J\.:\s*([\d./-]+)/); if (m) cab.cnpj = m[1]; }
      if (!cab.ini) { const m = txt.match(/Per[íi]odo:\s*(\d\d\/\d\d\/\d{4})\s*-\s*(\d\d\/\d\d\/\d{4})/); if (m) { cab.ini = m[1].split('/').reverse().join('-'); cab.fim = m[2].split('/').reverse().join('-'); } }
      if (/RESUMO DO BALANCETE/i.test(txt)) { noResumo = true; continue; }
      // valores: cada número vai para a coluna cuja borda direita está mais perto
      const nums = l.its.filter(i => RX_NUM.test(i.s));
      if (!nums.length) continue;
      const v = [null, null, null, null];
      for (const n of nums) {
        const dir = n.x + n.w; let k = 0;
        anc.col.forEach((c, i) => { if (Math.abs(c - dir) < Math.abs(anc.col[k] - dir)) k = i; });
        if (Math.abs(anc.col[k] - dir) < 12) v[k] = n.s;
      }
      const textos = l.its.filter(i => !RX_NUM.test(i.s));
      if (noResumo) {
        const nome = textos.map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
        if (nome) resumo[nome.toUpperCase()] = { ant: valorBal(v[0]) ?? 0, deb: valorBal(v[1]) ?? 0, cred: valorBal(v[2]) ?? 0, atu: valorBal(v[3]) ?? 0 };
        continue;
      }
      const cod = textos.find(i => i.x < anc.cls - 1 && /^\d+$/.test(i.s));
      const cls = textos.find(i => i.x >= anc.cls - 1 && i.x < anc.desc - 1 && RX_CLASS.test(i.s));
      if (!cls) continue;
      const desc = textos.filter(i => i.x >= anc.desc - 4 && i.x < anc.col[0] - 40).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
      const val = v.map(valorBal);
      if (val[3] === null && val[0] === null) continue;
      contas.push({ codigo: cod ? +cod.s : null, classificacao: cls.s, descricao: desc, nivel: cls.s.split('.').length,
        ant: val[0] ?? 0, deb: Math.abs(val[1] ?? 0), cred: Math.abs(val[2] ?? 0), atu: val[3] ?? 0, pagina: p });
    }
  }
  // hierarquia pela ordem do relatório: a mãe é a última conta de um nível acima
  const ult = [];
  for (const c of contas) {
    c.pai = c.nivel > 1 ? (ult[c.nivel - 1]?.classificacao ?? null) : null;
    ult[c.nivel] = c; ult.length = c.nivel + 1;
  }
  const temFilho = new Set(contas.map(c => c.pai).filter(Boolean));
  for (const c of contas) { c.tipo = temFilho.has(c.classificacao) ? 'S' : 'A'; c.natureza = naturezaGrupo(c.classificacao); }
  return { cab, contas, resumo, avisos, conferencia: conferir(contas, resumo) };
}

// provas: (1) anterior + débito − crédito = atual; (2) soma das filhas = mãe; (3) totais = resumo
export function conferir(contas, resumo = {}) {
  const erros = [];
  if (!contas.length) erros.push({ tipo: 'vazio', msg: 'Nenhuma conta encontrada: este PDF não parece ser um balancete de verificação.' });
  const by = new Map(contas.map(c => [c.classificacao, c]));
  const dup = contas.filter((c, i) => contas.findIndex(x => x.classificacao === c.classificacao) !== i);
  for (const c of dup) erros.push({ tipo: 'duplicada', classificacao: c.classificacao, msg: `Conta ${c.classificacao} aparece mais de uma vez` });
  for (const c of contas) {
    const dif = r2(c.ant + c.deb - c.cred - c.atu);
    if (Math.abs(dif) > 0.01) erros.push({ tipo: 'linha', classificacao: c.classificacao, msg: `${c.classificacao} ${c.descricao}: anterior + débito − crédito difere do saldo atual em ${dif.toFixed(2)}` });
  }
  const filhos = new Map();
  for (const c of contas) if (c.pai) (filhos.get(c.pai) || filhos.set(c.pai, []).get(c.pai)).push(c);
  for (const [pai, fs] of filhos) {
    const m = by.get(pai); if (!m) continue;
    for (const k of ['ant', 'deb', 'cred', 'atu']) {
      const s = r2(fs.reduce((a, f) => a + f[k], 0));
      if (Math.abs(s - m[k]) > 0.01) { erros.push({ tipo: 'grupo', classificacao: pai, campo: k, msg: `${pai} ${m.descricao}: soma das contas (${k}) difere em ${r2(m[k] - s).toFixed(2)} — falta ou sobra conta na leitura` }); break; }
    }
  }
  const raiz = (n) => by.get(n);
  const chaves = { '1': /^ATIVO$/, '2': /^PASSIVO$/ };
  for (const [cls, rx] of Object.entries(chaves)) {
    const k = Object.keys(resumo).find(n => rx.test(n)); const c = raiz(cls);
    if (k && c && Math.abs(r2(resumo[k].atu - c.atu)) > 0.01) erros.push({ tipo: 'resumo', classificacao: cls, msg: `Total ${k} do resumo difere da conta ${cls}` });
  }
  // o balancete fecha: soma das contas de primeiro nível = 0 (devedoras = credoras)
  const soma = r2(contas.filter(c => c.nivel === 1).reduce((a, c) => a + c.atu, 0));
  if (Math.abs(soma) > 0.01) erros.push({ tipo: 'fechamento', msg: `As contas de primeiro nível não fecham: diferença ${soma.toFixed(2)}` });
  return { ok: !erros.length, erros, contas: contas.length, analiticas: contas.filter(c => c.tipo === 'A').length };
}

export { carregarPdfjs };

export async function lerBalanceteArquivo(file) {
  const pdfjs = await carregarPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return lerBalancete(doc);
}

// Base comum das demonstrações contábeis (Balanço, DRE, DFC).
// Fontes: balancete oficial importado da contabilidade ou balancete feito pela plataforma
// (saldo de abertura + lançamentos contábeis gerados). Só leitura.
import { sb, state, q, fetchAll } from './data.js';
import { dateBR } from './ui.js';

export const MESN = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const fimMes = (m) => { const d = new Date(+m.slice(0, 4), +m.slice(5), 0); return `${m}-${String(d.getDate()).padStart(2, '0')}`; };

let cache = null;
// plano contábil, balancetes oficiais e datas de abertura; opções de período para as telas
export async function fontes(force = false) {
  if (cache && cache.emp === state.empresa.id && !force) return cache;
  const emp = state.empresa.id;
  const [contas, bals, abs] = await Promise.all([
    fetchAll(() => sb.from('contab_contas').select('id, codigo, classificacao, descricao, nivel, tipo, natureza, pai_id').eq('empresa_id', emp)),
    q(sb.from('contab_balancetes').select('id, data_ini, data_fim, arquivo_nome').eq('empresa_id', emp).order('data_fim', { ascending: false })),
    fetchAll(() => sb.from('contab_saldos_abertura').select('data').eq('empresa_id', emp)),
  ]);
  const datasAb = [...new Set(abs.map(a => a.data))].sort();
  const meses = [];
  if (datasAb.length) {
    const fim = new Date().toISOString().slice(0, 7);
    for (let d = new Date(datasAb[0] + 'T12:00:00'); ;) { d.setDate(1); d.setMonth(d.getMonth() + 1); const m = d.toISOString().slice(0, 7); if (m > fim) break; meses.push(m); }
  }
  cache = { emp, contas, bals, datasAb, meses: meses.reverse() };
  return cache;
}

// opções do seletor: meses da plataforma e balancetes da contabilidade
export function opcoes(f) {
  return [...f.meses.map(m => [`g:${m}`, `${MESN[+m.slice(5) - 1]}/${m.slice(0, 4)} (plataforma)`]),
          ...f.bals.map(b => [`b:${b.id}`, `${dateBR(b.data_ini)} a ${dateBR(b.data_fim)} (contabilidade)`])];
}

// período de uma opção: na plataforma, "acumulado" vai de 1º de janeiro até o fim do mês
export function periodo(sel, f, acumulado = true) {
  if (sel.startsWith('b:')) { const b = f.bals.find(x => x.id === sel.slice(2)); return { ini: b.data_ini, fim: b.data_fim, fonte: 'contabilidade' }; }
  const m = sel.slice(2);
  return { ini: acumulado ? `${m.slice(0, 4)}-01-01` : `${m}-01`, fim: fimMes(m), fonte: 'plataforma' };
}

// valores por conta (analíticas e, no balancete oficial, também as sintéticas)
export async function itens(sel, f, acumulado = true) {
  if (sel.startsWith('b:')) return fetchAll(() => sb.from('contab_balancete_itens').select('conta_id, saldo_anterior, debito, credito, saldo_atual').eq('balancete_id', sel.slice(2)));
  const { ini, fim } = periodo(sel, f, acumulado);
  return q(sb.rpc('contab_balancete_gerencial', { p_empresa: state.empresa.id, p_ini: ini, p_fim: fim }));
}

// árvore com saldos; na plataforma as sintéticas são somadas (própria + filhas)
export function arvore(contas, its, somar) {
  const by = new Map(contas.map(c => [c.id, { ...c, ant: 0, deb: 0, cred: 0, atu: 0, tem: false, filhos: [] }]));
  for (const it of its) { const c = by.get(it.conta_id); if (!c) continue; c.ant = +it.saldo_anterior; c.deb = +it.debito; c.cred = +it.credito; c.atu = +it.saldo_atual; c.tem = true; }
  for (const c of by.values()) if (c.pai_id && by.has(c.pai_id)) by.get(c.pai_id).filhos.push(c);
  const raizes = [...by.values()].filter(c => !c.pai_id || !by.has(c.pai_id));
  if (somar) {
    const sobe = (c) => { for (const x of c.filhos) { sobe(x); for (const k of ['ant', 'deb', 'cred', 'atu']) c[k] += x[k]; if (x.tem) c.tem = true; } };
    raizes.forEach(sobe);
  }
  const porCls = (a, b) => cmpClass(a.classificacao, b.classificacao);
  const ord = []; const desce = (c) => { ord.push(c); c.filhos.sort(porCls).forEach(desce); };
  raizes.sort(porCls).forEach(desce);
  const byCls = new Map(ord.map(c => [c.classificacao, c]));
  const g = (cls) => byCls.get(cls) || { ant: 0, deb: 0, cred: 0, atu: 0, filhos: [], descricao: '', classificacao: cls };
  return { ord, by, byCls, g, mov: (cls) => { const c = g(cls); return c.deb - c.cred; } };
}

export function cmpClass(a, b) {
  const x = a.split('.'), y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1; if (y[i] === undefined) return 1;
    if (x[i] !== y[i]) return x[i].localeCompare(y[i], undefined, { numeric: true });
  }
  return 0;
}

// conta está dentro do grupo? (pela cadeia de contas-mãe, não pelo texto da classificação)
export function dentro(byId, conta, grupoCls) {
  for (let c = conta; c; c = c.pai_id && byId.get(c.pai_id)) if (c.classificacao === grupoCls) return true;
  return false;
}

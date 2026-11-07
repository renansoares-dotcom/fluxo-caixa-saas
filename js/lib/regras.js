// Regras de classificação dos lançamentos (melhoria 3.1). Funções puras (sem banco), usadas pelo formulário do lançamento,
// pelo "Criar lançamento" da Conciliação, pelo "Aplicar regras" em lote e pelos testes.

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const norm = (s) => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();

// palavras que não identificam nada (banco, tipo de operação, razão social)
const GENERICAS = new Set(['PAGTO', 'PAGAMENTO', 'PAGTO.', 'TRANSF', 'TRANSFERENCIA', 'ENVIADO', 'RECEBIDO', 'PIX', 'TED', 'DOC', 'BOLETO', 'COBRANCA', 'TITULO',
  'LTDA', 'EIRELI', 'S/A', 'COMERCIO', 'INDUSTRIA', 'SERVICOS', 'DISTRIBUIDORA', 'REFERENTE', 'REF', 'NOTA', 'FISCAL', 'PARCELA', 'CONTA', 'VALOR', 'DEBITO',
  'CREDITO', 'ELETRON', 'ELETRONICO', 'DISPON', 'BANCO', 'LIQUIDACAO', 'DUPLICATA', 'DESPESA', 'DESPESAS', 'COMPRA', 'VENDA', 'EMPRESA', 'MENSAL', 'ENTRE', 'CONTAS']);
export const palavrasChave = (s) => [...new Set(norm(s).replace(/[^A-Z ]/g, ' ').split(' ').filter(w => w.length >= 4 && !GENERICAS.has(w)))];

/** o texto do lançamento visto por uma regra, conforme o campo */
const textoDo = (campo, a) => campo === 'descricao' ? a.descricao : campo === 'favorecido' ? a.favorecido : campo === 'documento' ? a.documento
  : [a.descricao, a.favorecido, a.documento].filter(Boolean).join(' ');

/** a regra vale para o lançamento? alvo = { descricao, favorecido, documento, valor, natureza:'E'|'S', conta_id } */
export function regraCasa(r, a) {
  if (!r || r.ativo === false) return false;
  if (r.natureza && a.natureza && r.natureza !== a.natureza) return false;
  if (r.conta_id && a.conta_id && r.conta_id !== a.conta_id) return false;
  const v = Math.abs(+a.valor || 0);
  if (r.valor_min != null && r.valor_min !== '' && v < +r.valor_min) return false;
  if (r.valor_max != null && r.valor_max !== '' && v > +r.valor_max) return false;
  const t = textoDo(r.campo || 'texto', a); if (!t) return false;
  if (r.operador === 'regex') { try { return new RegExp(r.texto, 'i').test(semAcento(t)); } catch { return false; } }
  const T = norm(t), x = norm(r.texto); if (!x) return false;
  return r.operador === 'igual' ? T === x : r.operador === 'comeca' ? T.startsWith(x) : T.includes(x);
}

/** primeira regra que casa (menor prioridade primeiro; empate: a mais antiga) */
export function aplicarRegras(regras, a) {
  const ord = [...(regras || [])].filter(r => r.ativo !== false).sort((x, y) => (+x.prioridade || 100) - (+y.prioridade || 100) || String(x.criado_em || '').localeCompare(String(y.criado_em || '')));
  return ord.find(r => regraCasa(r, a)) || null;
}

/**
 * propõe regras a partir do que já foi classificado: palavra do histórico (ou o favorecido) que, em pelo menos `minOcorr`
 * lançamentos, cai no mesmo plano em `minPct` dos casos. Não propõe o que uma regra existente já cobre.
 * lancs: [{ descricao, favorecido, favorecido_id, plano_id, centro_custo_id, natureza, valor }]
 */
export function sugerirRegras(lancs, { minOcorr = 3, minPct = 0.9, existentes = [], limite = 40 } = {}) {
  const grupos = new Map();
  const add = (k, campo, texto, l) => { const g = grupos.get(k) || { campo, texto, natureza: l.natureza, n: 0, planos: {}, ccs: {}, favs: {}, ex: [] }; g.n++;
    g.planos[l.plano_id] = (g.planos[l.plano_id] || 0) + 1; if (l.centro_custo_id) g.ccs[l.centro_custo_id] = (g.ccs[l.centro_custo_id] || 0) + 1;
    if (l.favorecido_id) g.favs[l.favorecido_id] = (g.favs[l.favorecido_id] || 0) + 1; if (g.ex.length < 3) g.ex.push(l.descricao || l.favorecido || ''); grupos.set(k, g); };
  for (const l of lancs) {
    if (!l.plano_id || !['E', 'S'].includes(l.natureza)) continue;
    if (l.favorecido) add(`F|${l.natureza}|${norm(l.favorecido)}`, 'favorecido', String(l.favorecido).trim().toUpperCase(), l);
    for (const w of palavrasChave(l.descricao)) add(`P|${l.natureza}|${w}`, 'descricao', w, l);
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const out = [];
  for (const g of grupos.values()) {
    if (g.n < minOcorr) continue;
    const [plano, np] = top(g.planos); if (np / g.n < minPct) continue;
    const [cc, nc] = top(g.ccs), [fav, nf] = top(g.favs);
    const prop = { campo: g.campo, operador: g.campo === 'favorecido' ? 'igual' : 'contem', texto: g.texto, natureza: g.natureza, plano_id: plano,
      centro_custo_id: nc / g.n >= minPct ? cc : null, favorecido_id: g.campo === 'descricao' && nf / g.n >= minPct ? fav : null,
      ocorrencias: g.n, acerto: np / g.n, exemplos: g.ex };
    // já coberta por uma regra existente que dá o mesmo plano
    const alvo = { descricao: g.campo === 'descricao' ? g.texto : '', favorecido: g.campo === 'favorecido' ? g.texto : '', natureza: g.natureza };
    const ja = aplicarRegras(existentes, alvo); if (ja && ja.plano_id === plano) continue;
    out.push(prop);
  }
  // favorecido antes de palavra; mais ocorrências antes; palavra que só repete o favorecido some
  out.sort((a, b) => (a.campo === 'favorecido' ? 0 : 1) - (b.campo === 'favorecido' ? 0 : 1) || b.ocorrencias - a.ocorrencias);
  const favs = out.filter(p => p.campo === 'favorecido');
  return out.filter(p => p.campo === 'favorecido' || !favs.some(f => f.plano_id === p.plano_id && norm(f.texto).split(' ').includes(p.texto) && f.ocorrencias >= p.ocorrencias)).slice(0, limite);
}

/** partes de um rateio para um valor: arredonda e joga a sobra dos centavos na maior parte */
export function partesDoRateio(valor, partes) {
  const v = Math.round(Math.abs(+valor) * 100);
  const out = partes.map(p => ({ centro_custo_id: p.centro_custo_id, valor: Math.floor(v * (+p.pct) / 100) }));
  const sobra = v - out.reduce((s, p) => s + p.valor, 0);
  if (out.length) { const i = partes.reduce((m, p, k) => (+p.pct > +partes[m].pct ? k : m), 0); out[i].valor += sobra; }
  return out.map(p => ({ ...p, valor: p.valor / 100 }));
}

// ---- recorrentes: próximas datas (o mesmo cálculo do banco, para a prévia na tela)
const PASSO = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
export function proximosVencimentos(r, qtd = 6, desde = null) {
  const out = []; const ini = new Date(r.inicio + 'T12:00:00Z'); let c = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth(), 1, 12));
  const fim = r.fim ? new Date(r.fim + 'T12:00:00Z') : null; const passo = PASSO[r.frequencia] || 1;
  for (let k = 0; k < 400 && out.length < qtd; k++) {
    if (fim && c > new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), 1, 12))) break;
    const ult = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 0, 12)).getUTCDate();
    const v = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), Math.min(+r.dia || 1, ult), 12));
    const dow = v.getUTCDay();   // 0 dom, 6 sáb
    if (dow === 6 || dow === 0) { if (r.ajuste_fds === 'postergar') v.setUTCDate(v.getUTCDate() + (dow === 6 ? 2 : 1)); else if (r.ajuste_fds === 'antecipar') v.setUTCDate(v.getUTCDate() - (dow === 6 ? 1 : 2)); }
    const iso = v.toISOString().slice(0, 10);
    if (v >= ini && (!desde || iso >= desde)) out.push({ competencia: c.toISOString().slice(0, 7), vencimento: iso });
    c = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + passo, 1, 12));
  }
  return out;
}

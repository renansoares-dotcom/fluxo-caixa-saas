// Condições de um fundo FIDC por grupo de sacados (SQL 050) e calendário de dias úteis. Puro (sem banco), para testar.
// Regra da FS (conferida em 161 borderôs jan–out/2026):
//   Grupo Total (CNPJ raiz informado na condição): taxa própria, vencimento + 3 dias corridos rolando p/ o próximo dia útil;
//   demais sacados: outra taxa, vencimento + 1 dia corrido rolando p/ o próximo dia útil;
//   o fundo nunca mistura as duas condições no mesmo borderô.

const iso = (d) => d.toISOString().slice(0, 10);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

// Páscoa (algoritmo de Meeus/Butcher)
function pascoa(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
const cacheFer = {};
/** Feriados bancários nacionais do ano (fixos + carnaval, Sexta-feira Santa e Corpus Christi) */
export function feriados(y) {
  if (cacheFer[y]) return cacheFer[y];
  const p = pascoa(y);
  const s = new Set(['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(md => `${y}-${md}`));
  for (const n of [-48, -47, -2, 60]) s.add(addDias(p, n));
  return (cacheFer[y] = s);
}
export const ehDiaUtil = (s) => { const dw = new Date(s + 'T12:00:00Z').getUTCDay(); return dw !== 0 && dw !== 6 && !feriados(+s.slice(0, 4)).has(s); };
export const proximoUtil = (s) => { let d = s; while (!ehDiaUtil(d)) d = addDias(d, 1); return d; };

const raiz = (cnpj) => String(cnpj || '').replace(/\D/g, '').slice(0, 8);
const vigente = (c, data) => c.ativo !== false && (!c.vigencia_ini || c.vigencia_ini <= data) && (!c.vigencia_fim || c.vigencia_fim >= data);

/** Condição do fundo para um sacado na data da operação: a do grupo (CNPJ raiz) ou a de "demais"; null = usar o fundo */
export function condicaoDe(conds, fundoId, cnpj, dataOp) {
  const cs = (conds || []).filter(c => c.fundo_id === fundoId && vigente(c, dataOp));
  if (!cs.length) return null;
  const r = raiz(cnpj);
  const doGrupo = r && cs.find(c => (c.sacados_raiz || []).includes(r));
  if (doGrupo) return doGrupo;
  // sacado de um grupo cuja condição saiu de vigência: não cai em "demais" (taxa errada) — devolve a última, marcada
  const todasDoGrupo = r ? (conds || []).filter(c => c.fundo_id === fundoId && c.ativo !== false && (c.sacados_raiz || []).includes(r)) : [];
  if (todasDoGrupo.length) {
    const ult = todasDoGrupo.sort((a, b) => String(b.vigencia_fim || '9999').localeCompare(String(a.vigencia_fim || '9999')))[0];
    return { ...ult, fora_vigencia: true };
  }
  return cs.find(c => !(c.sacados_raiz || []).length) || null;
}

/** Condição "legada" a partir dos campos do fundo (sem rolar dia útil, como era antes) */
export const condicaoDoFundo = (fu) => ({ id: `fundo:${fu.id}`, nome: fu.nome, legado: true, sacados_raiz: [], taxa_am: +fu.taxa_am || 0, metodo_desagio: fu.metodo_desagio || 'fator',
  dias_compensacao: +fu.dias_compensacao || 0, rola_dia_util: false, prazo_min_cobrado: null, tarifa_operacao: +fu.tarifa_operacao || 0, custo_assinatura: +fu.custo_assinatura || 0,
  tarifa_titulo: +fu.tarifa_titulo || 0, custo_consulta: +fu.custo_consulta || 0, ad_valorem_pct: +fu.ad_valorem_pct || 0, iof_pct: +fu.iof_pct || 0 });

/** Prazo (dias) e prazo cobrado de um título: vencimento + compensação, rolando para dia útil; respeita prazo mínimo cobrado */
export function prazos(cond, dataOp, venc) {
  const prazo = Math.max(1, diasEntre(dataOp, venc));
  let alvo = addDias(venc, +cond.dias_compensacao || 0);
  if (cond.rola_dia_util) alvo = proximoUtil(alvo);
  let pc = Math.max(1, diasEntre(dataOp, alvo));
  if (cond.prazo_min_cobrado) pc = Math.max(pc, +cond.prazo_min_cobrado);
  return { prazo, pc };
}

/** Deságio de um título pela condição */
export function desagioTitulo(cond, valor, pc) {
  const k = (+cond.taxa_am / 100) * pc / 30;
  return cond.metodo_desagio === 'simples' ? +valor * k : +valor * k / (1 + k);
}

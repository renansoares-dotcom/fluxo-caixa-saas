// Checklist do fechamento (melhoria 3.8): prazos em dia útil, situação das tarefas e "quanto falta para fechar".
// Funções puras, testadas em tests/fechamento-calc.test.js. O banco usa a mesma regra (_fech_prazo).
import { ehDiaUtil } from './fidc-condicoes.js';

const iso = (d) => d.toISOString().slice(0, 10);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const ultimoDiaMes = (mes) => { const [a, m] = mes.split('-').map(Number); return iso(new Date(Date.UTC(a, m, 0, 12))); };
const primeiroProx = (mes) => addDias(ultimoDiaMes(mes), 1);

export const ETAPAS_AUTO = { ext: 'Extratos conciliados', semconta: 'Pagos com conta', abertos: 'Nada vencido em aberto', notas: 'Notas de venda com financeiro',
  bord: 'Borderôs decididos', orc: 'Desvios justificados', contas: 'Contas travadas até o fim do mês' };
export const SITUACOES = { pendente: 'Pendente', feita: 'Feita', nao_aplica: 'Não se aplica' };
export const PAPEIS = { admin: 'Administrador', diretor: 'Diretor', financeiro: 'Financeiro', leitura: 'Leitura', compras: 'Compras', vendas: 'Vendas', producao: 'Produção' };

/** prazo de D+N do mês 'YYYY-MM': N-ésimo dia útil do mês seguinte; D+0 = último dia útil do próprio mês */
export function prazo(mes, n) {
  if (n <= 0) { let d = ultimoDiaMes(mes); while (!ehDiaUtil(d)) d = addDias(d, -1); return d; }
  let d = primeiroProx(mes), k = 0;
  for (;;) { if (ehDiaUtil(d)) { k++; if (k >= n) return d; } d = addDias(d, 1); }
}

/** em que D+ estamos hoje para o fechamento do mês (0 = ainda dentro do mês) */
export function diaUtilHoje(mes, hoje) {
  const ini = primeiroProx(mes); if (hoje < ini) return 0;
  let k = 0; for (let d = ini; d <= hoje; d = addDias(d, 1)) if (ehDiaUtil(d)) k++;
  return k;
}

/** situação efetiva da tarefa: as ligadas a uma conferência automática ficam prontas quando a conferência está ok */
export function situacao(t, autoOk = {}, hoje) {
  const auto = t.etapa_auto && t.etapa_auto in autoOk;
  const feita = t.situacao === 'feita' || t.situacao === 'nao_aplica' || (auto && autoOk[t.etapa_auto] === true);
  return { feita, auto, atrasada: !feita && t.prazo < hoje, hoje: !feita && t.prazo === hoje,
    rotulo: t.situacao === 'nao_aplica' ? 'Não se aplica' : feita ? (auto && t.situacao !== 'feita' ? 'Pronta (automática)' : 'Feita') : t.prazo < hoje ? 'Atrasada' : t.prazo === hoje ? 'Vence hoje' : 'Pendente' };
}

/** painel "quanto falta para fechar" */
export function progresso(tarefas, autoOk, hoje, metaDiaUtil, mes) {
  const S = tarefas.map(t => ({ t, s: situacao(t, autoOk, hoje) }));
  const total = S.length, feitas = S.filter(x => x.s.feita).length;
  const pend = S.filter(x => !x.s.feita);
  const porResp = {};
  for (const x of pend) { const k = x.t.responsavel || 'papel:' + (x.t.papel || '—'); (porResp[k] ||= { pend: 0, atras: 0, t: x.t }); porResp[k].pend++; if (x.s.atrasada) porResp[k].atras++; }
  const dataMeta = prazo(mes, metaDiaUtil);
  const ultimoPrazo = pend.reduce((a, x) => (x.t.prazo > a ? x.t.prazo : a), '');
  return { total, feitas, pct: total ? feitas / total : 0, pendentes: pend.length, atrasadas: pend.filter(x => x.s.atrasada).length,
    venceHoje: pend.filter(x => x.s.hoje).length, obrigPend: pend.filter(x => x.t.obrigatoria !== false).length,
    dHoje: diaUtilHoje(mes, hoje), dataMeta, metaDiaUtil, foraDaMeta: !!pend.length && hoje > dataMeta, ultimoPrazo: ultimoPrazo || null, porResp, itens: S };
}

/** o que a tela manda como pendência ao fechar: conferências automáticas não ok e tarefas obrigatórias ligadas a elas */
export function pendenciasAuto(etapas) {
  return etapas.filter(e => !e.ok).map(e => ({ k: e.k, titulo: e.titulo }));
}

export const fmtD = (n) => `D+${n}`;

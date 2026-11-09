// Central de Integrações (melhoria 1.6): rótulos, ordem por gravidade e textos (o cálculo é do banco, integ_painel).

export const SITUACOES = {
  atrasada: ['Atrasada', 'neg', 1], falha: ['Com falha', 'neg', 2], sem_dados: ['Sem importação', 'warn', 3],
  ok: ['Em dia', 'pos', 4], sem_uso: ['Sem uso', 'muted', 5], desligada: ['Não usada', 'muted', 6],
};

export const ordenar = (L) => [...(L || [])].sort((a, b) => (SITUACOES[a.situacao]?.[2] ?? 9) - (SITUACOES[b.situacao]?.[2] ?? 9));

export function resumo(L) {
  const c = (s) => (L || []).filter(x => x.situacao === s).length;
  return { atencao: c('atrasada') + c('falha'), atrasadas: c('atrasada'), falhas: c('falha'), ok: c('ok'), total: (L || []).filter(x => x.situacao !== 'desligada').length };
}

/** "há 3 horas", "há 2 dias", "agora" */
export function haQuanto(iso, agora = Date.now()) {
  if (!iso) return 'nunca';
  const s = Math.max(0, (agora - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

export function textoEsperado(x) {
  if (x.max_dias == null || x.max_dias === 0) return 'sem prazo';
  return x.max_dias === 1 ? 'todo dia útil' : `a cada ${x.max_dias} dias úteis`;
}

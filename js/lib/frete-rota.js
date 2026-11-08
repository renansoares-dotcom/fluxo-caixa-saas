// Frete próprio × terceirizado por rota (melhoria 7.2): rótulos e resumo do log_frete_comparativo (SQL 135).

export const SUGESTOES = {
  terceirizar: ['Terceirizar compensa', 'warn'], frota_propria: ['Frota própria compensa', 'pos'],
  equivalente: ['Custos equivalentes', ''], sem_base: ['Sem base para comparar', 'muted'],
};

export function resumo(rotas = []) {
  const soma = (f) => Math.round(rotas.reduce((t, r) => t + (+f(r) || 0), 0) * 100) / 100;
  const kp = soma(r => r.proprio?.peso_kg), kt = soma(r => r.terceiro?.peso_kg), cp = soma(r => r.proprio?.custo), ct = soma(r => r.terceiro?.custo);
  const cpk = soma(r => (r.proprio?.peso_kg > 0 ? r.proprio.custo : 0)), ctk = soma(r => (r.terceiro?.peso_kg > 0 ? r.terceiro.custo : 0));   // R$/t só com peso conhecido
  return {
    rotas: rotas.length,
    comparaveis: rotas.filter(r => r.sugestao !== 'sem_base').length,
    terceirizar: rotas.filter(r => r.sugestao === 'terceirizar').length,
    frota: rotas.filter(r => r.sugestao === 'frota_propria').length,
    economia: soma(r => r.economia),
    rs_t_proprio: kp > 0 ? Math.round(cpk / kp * 1000 * 100) / 100 : null,
    rs_t_terceiro: kt > 0 ? Math.round(ctk / kt * 1000 * 100) / 100 : null,
    custo_proprio: cp, custo_terceiro: ct,
  };
}

// texto curto da sugestão para a linha
export function textoSugestao(r) {
  if (r.sugestao === 'terceirizar') return `terceiro sai ${Math.abs(r.dif_pct).toLocaleString('pt-BR')}% mais barato por tonelada`;
  if (r.sugestao === 'frota_propria') return `frota própria sai ${Math.round((1 - r.proprio.rs_t / r.terceiro.rs_t) * 1000) / 10}% mais barata por tonelada`.replace('.', ',');
  if (r.sugestao === 'equivalente') return 'diferença abaixo do mínimo para trocar';
  return !r.proprio?.rs_t && !r.terceiro?.rs_t ? 'sem peso nas notas' : !r.proprio?.rs_t ? 'só terceiros nesta rota' : !r.terceiro?.rs_t ? 'só frota própria nesta rota' : 'pouco peso para comparar';
}

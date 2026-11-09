// Horas × folha (melhoria 8.3): horas pagas (contrato + extras) × horas apontadas, por pessoa e por setor, e o custo das horas sem apontamento.
const r2 = (v) => Math.round(((+v || 0) + Number.EPSILON) * 100) / 100;

export function porPessoa(p, horasMes = 220) {
  const pagas = r2((+p.horas_contrato || 0) + (+p.horas_extras || 0)), ap = +p.horas_apontadas || 0;
  const valorHora = (+p.salario || 0) / horasMes, ociosas = r2(Math.max(0, pagas - ap));
  return { ...p, pagas, apontadas: r2(ap), aproveitamento: pagas ? ap / pagas : null, ociosas, custoOcioso: r2(ociosas * valorHora), valorHora: r2(valorHora) };
}

/** agrupa por setor (do RH ou da produção) com totais e aproveitamento */
export function porSetor(pessoas, chave = 'setor', horasMes = 220) {
  const L = pessoas.map(p => porPessoa(p, horasMes)), g = new Map();
  for (const p of L) { const k = p[chave] || '—'; (g.get(k) || g.set(k, []).get(k)).push(p); }
  const linhas = [...g].map(([setor, ps]) => {
    const s = (k) => r2(ps.reduce((t, p) => t + (+p[k] || 0), 0));
    const pagas = s('pagas'), ap = s('apontadas');
    return { setor, pessoas: ps.length, semLigacao: ps.filter(p => !p.ligado).length, contrato: s('horas_contrato'), extras: s('horas_extras'), pagas, apontadas: ap,
      aproveitamento: pagas ? ap / pagas : null, ociosas: s('ociosas'), custoOcioso: s('custoOcioso'), lista: ps.sort((a, b) => (a.aproveitamento ?? 9) - (b.aproveitamento ?? 9)) };
  }).sort((a, b) => (a.aproveitamento ?? 9) - (b.aproveitamento ?? 9));
  const t = (k) => r2(linhas.reduce((x, l) => x + l[k], 0));
  const pagas = t('pagas'), ap = t('apontadas');
  return { linhas, total: { pessoas: L.length, pagas, apontadas: ap, extras: t('extras'), aproveitamento: pagas ? ap / pagas : null, ociosas: t('ociosas'), custoOcioso: t('custoOcioso') } };
}

// NF-e da SEFAZ (melhoria 9.1): rótulos, filtros e o prazo da manifestação conclusiva (180 dias da emissão).

export const SITUACOES = {
  resumo: ['Só o resumo', 'muted'], xml_disponivel: ['XML disponível', 'warn'], importada: ['Importada', 'pos'], ignorada: ['Ignorada', 'muted'],
};
export const MANIFESTACOES = { ciencia: 'Ciência da operação', confirmacao: 'Confirmação da operação', desconhecimento: 'Desconhecimento da operação', nao_realizada: 'Operação não realizada' };
const CONCLUSIVAS = new Set(['confirmacao', 'desconhecimento', 'nao_realizada']);

export function filtrar(L, f) {
  const l = L || [];
  if (f === 'pendentes') return l.filter(d => ['resumo', 'xml_disponivel'].includes(d.situacao) && d.situacao_nfe === 'autorizada');
  if (f === 'manifestar') return l.filter(d => d.situacao !== 'ignorada' && d.situacao_nfe === 'autorizada' && !CONCLUSIVAS.has(d.manifestacao));
  if (f === 'todas' || !f) return l;
  return l.filter(d => d.situacao === f);
}

/** prazo da manifestação conclusiva: 180 dias da emissão (null quando já conclusiva, cancelada ou ignorada) */
export function prazoConclusiva(d, hoje = new Date()) {
  if (!d?.emissao || CONCLUSIVAS.has(d.manifestacao) || d.situacao_nfe !== 'autorizada' || d.situacao === 'ignorada') return null;
  const ate = new Date(d.emissao + 'T12:00:00Z'); ate.setUTCDate(ate.getUTCDate() + 180);
  const dias = Math.ceil((ate - hoje) / 864e5);
  return { ate: ate.toISOString().slice(0, 10), dias };
}

export const podeManifestar = (d) => d?.situacao_nfe === 'autorizada' && !CONCLUSIVAS.has(d.manifestacao) && (prazoConclusiva(d)?.dias ?? 0) > 0;

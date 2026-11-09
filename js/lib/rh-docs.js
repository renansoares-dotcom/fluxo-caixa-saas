// Documentos do RH e SST (melhoria 8.2): casar o arquivo com o colaborador pelo nome do arquivo, rótulos e resumo da situação.

export const TIPOS_DOC = { holerite: 'Holerite', informe_rendimentos: 'Informe de rendimentos', aviso_ferias: 'Aviso/recibo de férias', contrato: 'Contrato e aditivos', certificado: 'Certificado de treinamento', aso: 'ASO', outro: 'Outro' };
export const CATEGORIAS = { aso: 'ASO (exame)', nr: 'NR', treinamento: 'Treinamento', outro: 'Outro' };
export const SITUACOES_SST = { vencido: ['Vencido', 'neg'], a_vencer: ['A vencer', 'warn'], pendente: ['Nunca feito', 'warn'], em_dia: ['Em dia', 'pos'] };
export const RESULTADOS = { apto: 'Apto', apto_restricao: 'Apto com restrição', inapto: 'Inapto', concluido: 'Concluído', reprovado: 'Reprovado' };

const so = (s) => String(s || '').replace(/\D/g, '');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * acha o colaborador pelo nome do arquivo: CPF (11 dígitos), depois matrícula como número isolado, depois o nome completo.
 * devolve { colab, por: 'cpf'|'matricula'|'nome' } ou null
 */
export function casarArquivo(arquivo, colabs) {
  const base = String(arquivo).replace(/\.[a-z0-9]+$/i, ''), dig = so(base), N = ' ' + norm(base) + ' ';
  for (const c of colabs) if (c.cpf && so(c.cpf).length === 11 && dig.includes(so(c.cpf))) return { colab: c, por: 'cpf' };
  const nums = (base.match(/\d+/g) || []).map(x => x.replace(/^0+/, ''));
  const porMat = colabs.filter(c => c.matricula && nums.includes(String(c.matricula).replace(/^0+/, '')));
  if (porMat.length === 1) return { colab: porMat[0], por: 'matricula' };
  const porNome = colabs.filter(c => c.nome && N.includes(' ' + norm(c.nome) + ' '));
  if (porNome.length === 1) return { colab: porNome[0], por: 'nome' };
  return null;
}

/** caminho no espaço rh-docs: <empresa>/<colaborador>/<aaaa-mm>-<tipo>-<arquivo limpo> */
export function caminhoDoc(empresa, colab, tipo, competencia, arquivo) {
  const limpo = String(arquivo).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  return `${empresa}/${colab}/${(competencia || 'sem-data').slice(0, 7)}-${tipo}-${Date.now().toString(36)}-${limpo}`;
}

export function resumoSST(Q) {
  const L = Q || [], c = (s) => L.filter(x => x.situacao === s && (s !== 'pendente' || x.obrigatorio)).length;
  return { vencido: c('vencido'), a_vencer: c('a_vencer'), pendente: c('pendente'), em_dia: c('em_dia'), pessoas: new Set(L.filter(x => ['vencido', 'a_vencer'].includes(x.situacao) || (x.situacao === 'pendente' && x.obrigatorio)).map(x => x.colaborador_id)).size };
}

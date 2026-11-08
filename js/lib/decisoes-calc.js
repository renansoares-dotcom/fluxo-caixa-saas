// Central de Decisões (melhoria 2.3, 07/11/2026): situação de cada alerta (resolvido, adiado, delegado) e o índice de
// saúde da empresa 0–100 por área. Puro (sem banco). Testes: tests/decisoes.test.js.

// área de cada origem de alerta e de cada indicador do Painel da Diretoria
export const AREAS = [
  { k: 'fin', nome: 'Financeiro', origens: ['Caixa', 'Conciliação', 'Crédito / FIDC', 'FIDC', 'Financeiro', 'Orçamento', 'Pagamentos', 'Contratos'], inds: ['caixa', 'margem', 'rj'] },
  { k: 'com', nome: 'Comercial', origens: ['Comercial', 'Pré-impressão'], inds: ['faturamento'] },
  { k: 'cmp', nome: 'Compras e estoque', origens: ['Estoque', 'Compras'], inds: [] },
  { k: 'prd', nome: 'Produção', origens: ['Manutenção', 'Casa de Tintas', 'Produção'], inds: ['producao', 'perdas'] },
  { k: 'qua', nome: 'Qualidade', origens: ['Qualidade'], inds: ['qualidade'] },
  { k: 'log', nome: 'Logística', origens: ['Logística'], inds: ['entregas'] },
  { k: 'fis', nome: 'Fiscal e contábil', origens: ['Fiscal', 'Contabilidade'], inds: [] },
  { k: 'gov', nome: 'Governança', origens: ['Auditoria', 'Cadastro', 'Privacidade e Acessos'], inds: [] },
];
export const PESOS_PADRAO = { alta: 20, media: 8, baixa: 3, fora_meta: 15, atencao: 5 };
export const areaDaOrigem = (o) => AREAS.find(a => a.origens.includes(o))?.k || 'fin';

/** assinatura curta do conteúdo do alerta: muda quando o alerta muda (número de itens, valores) */
export function assinatura(r) {
  const s = `${r.titulo || ''}|${r.desc || ''}`; let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + s.length;
}

/** o alerta aparece? e com que marca. atual = último registro da tratativa (ou nada) */
export function estado(r, atual, hoje) {
  if (!atual || atual.situacao === 'reaberto') return { aberto: true, k: 'aberto' };
  if (atual.situacao === 'resolvido') return atual.assinatura && atual.assinatura === assinatura(r)
    ? { aberto: false, k: 'resolvido', txt: `Resolvido por ${quem(atual)} em ${dataBR(atual.criado_em)}` }
    : { aberto: true, k: 'voltou', txt: `Voltou: mudou depois de resolvido em ${dataBR(atual.criado_em)}` };
  if (atual.situacao === 'adiado') return atual.ate > hoje
    ? { aberto: false, k: 'adiado', txt: `Adiado até ${dataBR(atual.ate)} por ${quem(atual)}` }
    : { aberto: true, k: 'venceu', txt: `O adiamento venceu em ${dataBR(atual.ate)}` };
  if (atual.situacao === 'delegado') return { aberto: true, k: 'delegado', txt: `Delegado a ${atual.delegado_nome || 'alguém'} em ${dataBR(atual.criado_em)}`, para: atual.delegado_para };
  return { aberto: true, k: 'aberto' };
}
const quem = (a) => String(a.por_email || 'alguém').split('@')[0];
const dataBR = (s) => String(s || '').slice(0, 10).split('-').reverse().join('/');

/**
 * índice de saúde por área: 100 − pesos dos alertas abertos (por urgência) − indicadores fora da meta / em atenção.
 * alertas = [{ origem, urg, titulo }] (só os abertos); inds = indicadores do Painel da Diretoria [{ k, nome, sit }].
 */
export function saude(alertas = [], inds = [], pesos = {}, pesosAreas = {}) {
  const P = { ...PESOS_PADRAO, ...pesos };
  const areas = AREAS.map(a => {
    const motivos = [];
    for (const r of alertas.filter(x => areaDaOrigem(x.origem) === a.k)) motivos.push({ txt: r.titulo, pontos: +P[r.urg] || 0, tipo: 'alerta', urg: r.urg });
    for (const i of inds.filter(x => a.inds.includes(x.k))) {
      if (i.sit === 'abaixo') motivos.push({ txt: `${i.nome} fora da meta`, pontos: +P.fora_meta || 0, tipo: 'indicador' });
      else if (i.sit === 'atencao') motivos.push({ txt: `${i.nome} em atenção`, pontos: +P.atencao || 0, tipo: 'indicador' });
    }
    motivos.sort((x, y) => y.pontos - x.pontos);
    const nota = Math.max(0, Math.round(100 - motivos.reduce((t, m) => t + m.pontos, 0)));
    return { ...a, nota, motivos, peso: pesosAreas[a.k] == null ? 1 : +pesosAreas[a.k] };
  });
  const somaP = areas.reduce((t, a) => t + a.peso, 0);
  const geral = somaP ? Math.round(areas.reduce((t, a) => t + a.nota * a.peso, 0) / somaP) : 100;
  return { areas, geral };
}

export const faixa = (nota, cfg = {}) => (nota >= (cfg.faixa_boa ?? 80) ? 'boa' : nota >= (cfg.faixa_atencao ?? 60) ? 'atencao' : 'critica');
export const FAIXA = { boa: { txt: 'Saudável', cor: 'var(--pos)', cls: 'pago' }, atencao: { txt: 'Atenção', cor: 'var(--warn)', cls: 'aberto' }, critica: { txt: 'Crítica', cor: 'var(--neg)', cls: 'vencido' } };

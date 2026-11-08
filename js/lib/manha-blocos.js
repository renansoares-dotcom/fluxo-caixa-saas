// Minha Manhã personalizada (melhoria 2.2, 07/11/2026): catálogo de blocos, padrão por papel e a ordem escolhida por
// cada pessoa. Puro (sem banco). Testes: tests/manha.test.js.

// pode(papel, temArea): quem pode ter o bloco
export const BLOCOS = [
  { k: 'situacao', nome: 'Situação do dia', desc: 'Saldo disponível, conferência, extratos e travas das contas.', largo: true, pode: (p, a) => a('fin') && !['compras', 'vendas', 'producao'].includes(p) },
  { k: 'diretoria', nome: 'Indicadores da diretoria', desc: 'Os indicadores do Painel da Diretoria do mês anterior, com a situação de cada um.', largo: true, pode: (p) => ['admin', 'diretor', 'financeiro', 'leitura'].includes(p) },
  { k: 'aprovacoes', nome: 'Minhas aprovações', desc: 'O que espera a sua decisão, de todos os módulos.', pode: () => true },
  { k: 'mudou', nome: 'O que mudou desde o seu último acesso', desc: 'Inclusões, alterações e exclusões feitas por outras pessoas nas suas áreas, notas importadas e avisos não lidos.', pode: () => true },
  { k: 'ontem', nome: 'Resumo do dia anterior', desc: 'Recebido e pago, faturamento, produção, entregas e não conformidades do último dia útil.', pode: () => true },
  { k: 'agenda', nome: 'Agenda de hoje', desc: 'Títulos a pagar e a receber de hoje, dos próximos 7 dias e vencidos.', pode: (p, a) => a('fin') && !['compras', 'vendas', 'producao'].includes(p) },
  { k: 'alertas', nome: 'Alertas', desc: 'Caixa abaixo do mínimo, contas negativas, títulos vencidos, extratos atrasados e conferência pendente.', pode: (p, a) => a('fin') && !['compras', 'vendas', 'producao'].includes(p) },
  { k: 'atalhos', nome: 'Meus atalhos', desc: 'As telas que você mais usa, a um clique.', pode: () => true },
];
export const BLOCO = Object.fromEntries(BLOCOS.map(b => [b.k, b]));

const PADRAO = {
  admin: ['diretoria', 'aprovacoes', 'situacao', 'mudou', 'ontem', 'alertas', 'agenda'],
  diretor: ['diretoria', 'aprovacoes', 'ontem', 'mudou', 'situacao', 'alertas'],
  financeiro: ['situacao', 'aprovacoes', 'agenda', 'alertas', 'ontem', 'mudou'],
  leitura: ['situacao', 'ontem', 'mudou', 'diretoria'],
  compras: ['aprovacoes', 'mudou', 'ontem', 'atalhos'],
  vendas: ['aprovacoes', 'mudou', 'ontem', 'atalhos'],
  producao: ['ontem', 'mudou', 'aprovacoes', 'atalhos'],
};

/** blocos disponíveis para a pessoa */
export const disponiveis = (papel, temArea = () => true) => BLOCOS.filter(b => b.pode(papel, temArea));

/** padrão do papel: ligados na ordem do papel, os demais disponíveis desligados no fim */
export function padrao(papel, temArea = () => true) {
  const disp = disponiveis(papel, temArea).map(b => b.k), on = (PADRAO[papel] || PADRAO.leitura).filter(k => disp.includes(k));
  return [...on.map(k => ({ k, on: true })), ...disp.filter(k => !on.includes(k)).map(k => ({ k, on: false }))];
}

/** junta a preferência salva com o que está disponível hoje: some o que não pode mais, entra desligado o que é novo */
export function aplicar(salvo, papel, temArea = () => true) {
  if (!Array.isArray(salvo) || !salvo.length) return padrao(papel, temArea);
  const disp = disponiveis(papel, temArea).map(b => b.k), vistos = new Set();
  const out = salvo.filter(x => disp.includes(x.k) && !vistos.has(x.k) && vistos.add(x.k)).map(x => ({ k: x.k, on: !!x.on }));
  for (const k of disp) if (!vistos.has(k)) out.push({ k, on: false });
  return out;
}

/** move o bloco i uma posição (d = -1 sobe, +1 desce) */
export function mover(lista, i, d) {
  const j = i + d; if (j < 0 || j >= lista.length) return lista;
  const n = [...lista]; [n[i], n[j]] = [n[j], n[i]]; return n;
}

// nomes legíveis dos módulos no "o que mudou"
const NOMES = { lancamentos: 'Lançamentos', paraquedas: 'Pagamentos antecipados', paraquedas_pagamentos: 'Pagamentos de PA', fidc_propostas: 'Propostas de borderô', contas: 'Contas bancárias',
  contas_travas: 'Travas de conta', conciliacoes: 'Conciliações', conferencias_dia: 'Conferência do dia', favorecidos: 'Beneficiários', plano_contas: 'Plano de contas', centros_custo: 'Centros de custo',
  orcamentos: 'Orçamento', autorizacoes: 'Autorizações de pagamento', creditos: 'Créditos', duplicatas: 'Duplicatas', contratos: 'Contratos', membros: 'Usuários e papéis',
  portal_prorrogacoes: 'Prorrogações do Portal', portal_usuarios: 'Acessos do Portal', compras_requisicoes: 'Requisições de compra', compras_pedidos: 'Pedidos de compra', compras_recebimentos: 'Recebimentos',
  compras_cotacoes: 'Cotações', produtos: 'Produtos', comercial_oportunidades: 'Oportunidades', comercial_propostas: 'Propostas comerciais', comercial_interacoes: 'Interações com clientes',
  pre_projetos: 'Artes', pre_versoes: 'Versões de arte', pre_decisoes: 'Decisões de arte', prod_ordens: 'Ordens de produção', prod_apontamentos: 'Apontamentos', prod_paradas: 'Paradas',
  prod_bobinas: 'Bobinas', man_ordens: 'Ordens de manutenção', man_equipamentos: 'Equipamentos', qual_inspecoes: 'Inspeções', qual_rnc: 'Não conformidades', tin_ordens: 'Ordens de tinta',
  tin_receitas: 'Receitas de tinta', tin_pesagens: 'Pesagens de tinta', log_cargas: 'Cargas', log_carga_notas: 'Entregas', log_fretes: 'Fretes', frota_manutencoes: 'Manutenção da frota',
  frota_multas: 'Multas', rh_colaboradores: 'Colaboradores', rh_folhas: 'Folha', af_bens: 'Imobilizado', crachas: 'Crachás' };
export const nomeTabela = (t) => NOMES[t] || String(t || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
export const ACAO = { incluiu: 'incluiu', alterou: 'alterou', excluiu: 'excluiu' };

/** frase do módulo: "3 inclusões, 1 alteração · 2 pessoas" */
export function fraseMudanca(x) {
  const p = (n, s, pl) => `${n} ${n === 1 ? s : pl}`;
  const partes = [];
  if (+x.incluiu) partes.push(p(+x.incluiu, 'inclusão', 'inclusões'));
  if (+x.alterou) partes.push(p(+x.alterou, 'alteração', 'alterações'));
  if (+x.excluiu) partes.push(p(+x.excluiu, 'exclusão', 'exclusões'));
  return `${partes.join(', ')}${+x.pessoas ? ` · ${p(+x.pessoas, 'pessoa', 'pessoas')}` : ''}`;
}

/** "desde ontem às 18:40" / "desde 03/11 às 09:12" */
export function textoDesde(iso, agora = new Date()) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const dia = (x) => x.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const ont = new Date(agora); ont.setDate(ont.getDate() - 1);
  if (dia(d) === dia(agora)) return `desde hoje às ${hh}`;
  if (dia(d) === dia(ont)) return `desde ontem às ${hh}`;
  return `desde ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} às ${hh}`;
}

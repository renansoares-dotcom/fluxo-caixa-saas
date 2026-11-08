// Meus Painéis (melhoria 2.5, 07/11/2026): catálogo de cartões e o painel padrão. Puro (sem banco). Testes: tests/paineis.test.js.
// tam: 1 = um terço da largura, 2 = dois terços, 3 = largura toda. dados: o que o cartão precisa carregar (compartilhado entre cartões).

export const CARTOES = [
  // Financeiro
  { t: 'kpi_saldo', nome: 'Saldo em bancos', desc: 'Saldo disponível hoje nas contas com recursos disponíveis.', area: 'fin', dados: ['fin'], tam: 1 },
  { t: 'kpi_entradas_saidas', nome: 'Entradas e saídas do ano', desc: 'Total pago no ano, com a receita bruta.', area: 'fin', dados: ['fin'], tam: 1 },
  { t: 'kpi_resultado', nome: 'EBITDA e resultado do ano', desc: 'EBITDA e resultado gerencial com as margens.', area: 'fin', dados: ['fin'], tam: 1 },
  { t: 'kpi_abertos', nome: 'A pagar e a receber', desc: 'Títulos em aberto e os vencidos.', area: 'fin', dados: ['fin'], tam: 1 },
  { t: 'graf_entradas_saidas', nome: 'Entradas × saídas e saldo', desc: 'Barras do ano por mês com a linha do saldo.', area: 'fin', dados: ['fin'], tam: 2 },
  { t: 'graf_composicao', nome: 'Composição das saídas', desc: 'As 7 maiores classes de saída do ano.', area: 'fin', dados: ['fin'], tam: 1 },
  { t: 'graf_dre', nome: 'Receita e EBITDA por mês', desc: 'Receita bruta, EBITDA e a margem da DRE Gerencial.', area: 'fin', dados: ['fin'], tam: 2 },
  { t: 'graf_necessidade', nome: 'Caixa projetado por semana', desc: 'Saldo projetado nas próximas semanas contra o caixa mínimo.', area: 'fin', dados: ['nec'], tam: 2 },
  { t: 'tab_saldos', nome: 'Saldos por conta', desc: 'Saldo, a receber e a pagar de cada conta.', area: 'fin', dados: ['fin'], tam: 2 },
  { t: 'tab_vencimentos', nome: 'Próximos vencimentos', desc: 'Os 12 próximos títulos em aberto.', area: 'fin', dados: ['fin'], tam: 1 },
  // Painel da Diretoria (um indicador por cartão)
  { t: 'ind_diretoria', nome: 'Indicador da diretoria', desc: 'Um dos oito indicadores do Painel da Diretoria, com a meta e 13 meses.', area: 'dir', dados: ['dir'], tam: 1, cfg: { k: 'faturamento' } },
  { t: 'resumo_diretoria', nome: 'Situação dos indicadores', desc: 'Os oito indicadores do mês anterior com a situação de cada um.', area: 'dir', dados: ['dir'], tam: 3 },
  // Operação
  { t: 'graf_faturamento', nome: 'Faturamento líquido por mês', desc: 'Vendas menos devoluções nas NF-e dos últimos 13 meses.', area: 'com', dados: ['dir'], tam: 2 },
  { t: 'graf_producao', nome: 'Produção e perdas por mês', desc: 'Quilos bons e o % de refugo dos últimos 13 meses.', area: 'prd', dados: ['dir'], tam: 2 },
  { t: 'graf_qualidade', nome: 'Não conformidades por mês', desc: 'RNC abertas no mês, as de clientes e as em aberto.', area: 'prd', dados: ['dir'], tam: 2 },
  { t: 'graf_entregas', nome: 'Entregas no prazo por mês', desc: '% de notas entregues no prazo e o total de entregas.', area: 'log', dados: ['dir'], tam: 2 },
];
export const CARTAO = Object.fromEntries(CARTOES.map(c => [c.t, c]));
export const AREAS_CARTAO = { fin: 'Financeiro', dir: 'Painel da Diretoria', com: 'Comercial', prd: 'Produção e qualidade', log: 'Logística' };

/** cartões que a pessoa pode usar (pelas áreas; Painel da Diretoria só para papéis de gestão) */
export const disponiveis = (temArea = () => true, papel = 'admin') => CARTOES.filter(c =>
  c.area === 'dir' ? ['admin', 'diretor', 'financeiro', 'leitura'].includes(papel) : temArea(c.area === 'fin' ? 'fin' : c.area));

// o Dashboard antigo: a visão do ano
export const PADRAO = [
  { t: 'kpi_saldo', tam: 1 }, { t: 'kpi_entradas_saidas', tam: 1 }, { t: 'kpi_resultado', tam: 1 },
  { t: 'graf_entradas_saidas', tam: 2 }, { t: 'kpi_abertos', tam: 1 },
  { t: 'graf_composicao', tam: 1 }, { t: 'tab_saldos', tam: 2 },
  { t: 'tab_vencimentos', tam: 3 },
];

/** limpa a lista salva: tira cartões que não existem mais ou que a pessoa não pode usar, corrige o tamanho */
export function validar(cartoes, temArea = () => true, papel = 'admin') {
  const ok = new Set(disponiveis(temArea, papel).map(c => c.t));
  return (Array.isArray(cartoes) ? cartoes : []).filter(c => c && ok.has(c.t)).slice(0, 40)
    .map(c => ({ t: c.t, tam: [1, 2, 3].includes(+c.tam) ? +c.tam : CARTAO[c.t].tam, ...(c.cfg || CARTAO[c.t].cfg ? { cfg: { ...(CARTAO[c.t].cfg || {}), ...(c.cfg || {}) } } : {}) }));
}

/** dados a carregar para um painel (sem repetir) */
export const dadosDe = (cartoes) => [...new Set(cartoes.flatMap(c => CARTAO[c.t]?.dados || []))];

export function mover(lista, i, d) { const j = i + d; if (j < 0 || j >= lista.length) return lista; const n = [...lista]; [n[i], n[j]] = [n[j], n[i]]; return n; }

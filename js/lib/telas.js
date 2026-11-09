// Códigos de tela (05/11/2026; Renan: "adicionar códigos para cada tela, assim facilita para pesquisa e comunicação
// interna, assim como funciona o Iniflex"). Formato: 3 letras da área + 3 dígitos (docs/design-system.md › 2).
// O código NUNCA muda nem é reaproveitado: tela nova pega o próximo número livre da área.
export const TELAS = {
  // Painéis
  'hoje': 'PAI001', 'decisao-dia': 'PAI002', 'decisoes': 'PAI003', 'executivo': 'PAI004', 'dashboard': 'PAI005', 'aprovacoes': 'PAI006', 'diretoria': 'PAI007', 'orcamento-cc': 'PAI008', 'perguntar': 'PAI009', 'relatorios': 'PAI010', 'portal': 'PAI011',
  // Financeiro
  'lancamentos': 'FIN001', 'conciliacao': 'FIN002', 'abertos': 'FIN003', 'creditos': 'FIN004', 'conta-fornecedor': 'FIN005', 'portal-clientes': 'FIN006',
  'autorizacao': 'FIN007', 'paraquedas': 'FIN008', 'conferencia': 'FIN009', 'fechamento': 'FIN010',
  'fluxo-mensal': 'FIN011', 'fluxo-diario': 'FIN012', 'necessidade-caixa': 'FIN013',
  'orcamento': 'FIN014', 'orcado-realizado': 'FIN015', 'controle-orcamento': 'FIN016',
  'fidc': 'FIN017', 'fidc-propostas': 'FIN018', 'fidc-carteira': 'FIN019', 'fidc-recompras': 'FIN021', 'duplicatas': 'FIN020', 'lanc-regras': 'FIN022', 'lanc-recorrentes': 'FIN023', 'cobranca': 'FIN024',
  // Comercial
  'comercial': 'COM001', 'comercial/carteira': 'COM002', 'comercial/funil': 'COM003', 'comercial/vendedores': 'COM004', 'comercial/mapa': 'COM007', 'comercial/comissoes': 'COM008', 'preimpressao': 'COM005', 'preimpressao/artes': 'COM006',
  // Compras
  'compras': 'CMP001', 'compras/requisicoes': 'CMP002', 'compras/pedidos': 'CMP003', 'compras/recebimentos': 'CMP004',
  // Estoque
  'estoque': 'EST001', 'estoque/kardex': 'EST002', 'estoque/produtos': 'EST003', 'estoque/depara': 'EST004', 'estoque/parametros': 'EST005', 'estoque/cadastro-notas': 'EST006', 'estoque/implantacao': 'EST007', 'estoque/reposicao': 'EST008', 'estoque/inventario': 'EST009',
  // Produção
  'producao/terminal': 'PRD001', 'producao': 'PRD002', 'producao/planta': 'PRD003', 'producao/ordens': 'PRD004', 'producao/programacao': 'PRD005', 'producao/sequenciamento': 'PRD024',
  'producao/cadastros': 'PRD006', 'producao/importar': 'PRD007', 'producao/oee': 'PRD019', 'producao/custos': 'PRD020', 'producao/rastreio': 'PRD021', 'manutencao/preventivas': 'PRD022', 'tintas/previsao': 'PRD023',
  'manutencao': 'PRD008', 'manutencao/ordens': 'PRD009', 'manutencao/equipamentos': 'PRD010', 'manutencao/celular': 'PRD011',
  'qualidade': 'PRD012', 'qualidade/inspecoes': 'PRD013', 'qualidade/nao-conformidades': 'PRD014', 'qualidade/planos': 'PRD015',
  'tintas': 'PRD016', 'tintas/ordens': 'PRD017', 'tintas/receitas': 'PRD018',
  // Logística
  'logistica': 'LOG001', 'logistica/fretes': 'LOG002', 'logistica/gestao-frota': 'LOG003', 'logistica/indicadores': 'LOG004', 'logistica/frota': 'LOG005', 'logistica/motorista': 'LOG006',
  // RH / Trabalhista
  'rh/colaboradores': 'RHT001', 'rh/folha': 'RHT002', 'rh/decimo': 'RHT003', 'rh/ferias': 'RHT004', 'rh/rescisoes': 'RHT005', 'rh/sst': 'RHT006', 'rh/documentos': 'RHT007', 'rh/horas': 'RHT008',
  // CPD › Fiscal
  'notas': 'FIS001', 'fiscal/apuracao': 'FIS002', 'fiscal/notas-debito': 'FIS003', 'notas/sefaz': 'FIS004',
  // Contabilidade
  'dre': 'CTB001', 'contab/balancete': 'CTB002', 'contab/balanco': 'CTB003', 'contab/dre': 'CTB004', 'contab/dfc': 'CTB005', 'contab/depara': 'CTB006',
  'contab/imobilizado': 'CTB007', 'contab/inventario': 'CTB008', 'contab/imobilizado-parametros': 'CTB009', 'contab/indices': 'CTB010', 'contab/fechamento': 'CTB011', 'contab/centros': 'CTB012',
  // Cadastros
  'cadastros/plano': 'CAD001', 'cadastros/contas': 'CAD002', 'cadastros/favorecidos': 'CAD003', 'cadastros/centros': 'CAD004', 'cadastros/empresa': 'CAD005',
  'contratos': 'CAD006', 'config': 'CAD007', 'auditoria': 'CAD008', 'config/email': 'CAD009', 'uso': 'CAD010', 'lgpd': 'CAD011', 'config/whatsapp': 'CAD012', 'integracoes': 'CAD013',
  // Ajuda e Comunicação
  'tutoriais': 'AJU001', 'conversas': 'AJU002', 'meus-avisos': 'AJU003',
};

const ROTA_DO_CODIGO = Object.fromEntries(Object.entries(TELAS).map(([r, c]) => [c, r]));

/** código da tela de uma rota (ou '') */
export const codigoDa = (rota) => TELAS[rota] || '';

/** rota de um código digitado: aceita "FIN019", "fin19", "fin 19", "FIN-019" */
export function rotaDoCodigo(txt) {
  const m = String(txt || '').trim().toUpperCase().match(/^([A-Z]{3})[\s-]*0*(\d{1,3})$/);
  return m ? ROTA_DO_CODIGO[`${m[1]}${m[2].padStart(3, '0')}`] || null : null;
}

/** grafia dos nomes de tela: palavras principais com maiúscula, conectivos em minúscula (menos a primeira palavra) */
const CONECTIVOS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'x', 'a', 'o', 'em', 'por', 'para', 'com', 'no', 'na']);
export function grafia(nome) {
  return String(nome).split(/(\s+)/).map((p, i) => (i > 0 && CONECTIVOS.has(p.toLowerCase()) ? p.toLowerCase() : p)).join('');
}

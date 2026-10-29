// Catálogo dos manuais de uso (pasta tutoriais/). Regra (28/10/2026, Renan): todo ajuste numa funcionalidade termina com o
// manual dela atualizado (texto em tutoriais/<id>.md, histórico de alterações e PDF em tutoriais/pdf/<id>.pdf).
// `rotas` liga o botão "?" do topo de cada tela ao manual dela.
export const MANUAIS = [
  { id: 'pagamentos-antecipados', titulo: 'Pagamentos Antecipados', area: 'Financeiro', rotas: ['paraquedas'],
    resumo: 'Pedir, aprovar, programar e pagar antes da nota fiscal; vários pagamentos e comprovantes; ligar a nota.' },
  { id: 'fretes-ciot', titulo: 'Fretes e CIOT', area: 'Logística', rotas: ['logistica/fretes'],
    resumo: 'Ficha do frete, transportadores, piso mínimo da ANTT, CIOT e MDF-e, conformidade do mês.' },
  { id: 'rh', titulo: 'RH — colaboradores, folha do mês e 13º', area: 'RH / Trabalhista', rotas: ['rh/colaboradores', 'rh/folha', 'rh/decimo'], rh: true,
    resumo: 'Cadastro e importação da relação, setor por cargo, previsão da folha e do 13º no fluxo de caixa.' },
  { id: 'compras', titulo: 'Compras — requisições, pedidos e recebimentos', area: 'Compras', rotas: ['compras', 'compras/requisicoes', 'compras/pedidos', 'compras/recebimentos'],
    resumo: 'Da requisição à cotação, do pedido à aprovação e do recebimento conferido com a nota.' },
];
export const manualDaRota = (rota) => MANUAIS.find(m => m.rotas.includes(rota)) || null;
export const manualPorId = (id) => MANUAIS.find(m => m.id === id) || null;

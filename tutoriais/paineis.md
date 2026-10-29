---
titulo: Painéis — Minha Manhã, Decisão do Dia, Decision Center e dashboards
tela: Painéis › Minha Manhã, Decisão do Dia, Decision Center, Dashboard Executivo e Dashboard
versao: 1.0
atualizado: 2026-10-28
---
## 1. Para que serve

Os painéis juntam, numa tela só, o que precisa de atenção e de decisão:

- **Minha Manhã**: a tela inicial. Mostra a situação do dia, a agenda, as decisões pendentes do seu perfil e os alertas.
- **Decisão do Dia**: o que entra e o que sai hoje (e nos próximos dias), com o saldo de cada banco. Serve para simular e registrar a decisão de pagamentos e antecipações do dia, que vai para o diretor aprovar.
- **Decision Center**: recomendações da semana, calculadas por regras explícitas sobre os dados da plataforma.
- **Dashboard Executivo**: a visão de um mês para a direção, com a nota de saúde financeira.
- **Dashboard**: o resumo do ano, com entradas e saídas, saldos por conta e próximos vencimentos.

## 2. Quem tem acesso

Os painéis fazem parte da área **Financeiro**. Na Decisão do Dia:

- o administrador e o financeiro registram e enviam a decisão;
- o diretor e o administrador aprovam ou rejeitam.

## 3. Minha Manhã

A tela abre com:

- **Situação do dia**: saldo, conferência, extratos e travas.
- **Agenda de hoje**: o que vence hoje, nos próximos 7 dias e o que está vencido.
- **Decisões pendentes**: o que espera por você conforme o seu perfil (por exemplo, para o diretor: pagamentos antecipados, propostas de borderô, autorizações).
- **Alertas**.

Cada item leva à tela certa. **Atualizar** recarrega os dados.

## 4. Decisão do Dia

### 4.1 Simular

1. Escolha o **dia**.
2. O **saldo de abertura** é o saldo dos bancos no fim do dia anterior.
3. As **Entradas** trazem:
   - os borderôs pendentes de aprovação (o líquido na conta de crédito);
   - os recebimentos em aberto;
   - o que já entrou.
4. As **Saídas** trazem:
   - as contas a pagar em aberto;
   - os pagamentos antecipados aguardando autorização;
   - o que já saiu.
5. **Desmarque** um item para simular adiar ou não fazer; **marque** para incluir. O saldo projetado no fim do dia, total e por banco, recalcula na hora.
   - Borderô em rascunho e títulos vencidos entram **desmarcados**.
   - As **transferências entre contas** não mudam o total, só o saldo de cada banco.
6. **Desfazer simulação** volta ao estado inicial.

A **Decisão sugerida** resume o que a plataforma propõe para o dia.

### 4.2 Registrar e aprovar

1. Escreva uma **observação** e clique em **Salvar rascunho** ou **Enviar para aprovação**.
2. O diretor abre a decisão e clica em **Aprovar** ou **Rejeitar**. Decisão aprovada pode ser **reaberta**: ela volta como rejeitada para ser refeita.
3. Passado o dia, o quadro **Decidido × realizado** compara o que foi decidido com o que aconteceu: lançamentos pagos, pagamentos antecipados, borderôs e o saldo real dos bancos.

**Imprimir** gera a decisão no padrão IPLAMM. **Copiar resumo (WhatsApp)** copia o texto pronto para colar na conversa.

## 5. Decision Center

As **Recomendações da semana** mostram, para cada uma, o motivo, o impacto estimado, a urgência, a **regra usada** e a ação, com o link para a tela certa. Exemplos:

- cobrir a falta de caixa prevista;
- identificar lançamentos pagos sem conta;
- cobrar os títulos vencidos de maior valor;
- reduzir a dependência dos maiores clientes;
- priorizar o fundo FIDC mais barato;
- rever as despesas acima do orçamento;
- investigar o aumento das recompras;
- importar os extratos parados;
- completar o CNPJ/CPF dos beneficiários;
- repor os itens abaixo do ponto de pedido.

Filtre por **urgência**. **Adiar 7 dias** esconde uma recomendação por uma semana, e **Trazer de volta** a mostra de novo. **Recalcular** refaz a lista.

As recomendações seguem regras fixas e mostram a regra que usaram; não há inteligência artificial nelas.

## 6. Dashboard Executivo

1. Escolha o **mês de referência**.
2. Os indicadores podem ser clicados para ver a composição:
   - saldo disponível hoje;
   - geração de caixa no mês;
   - a receber e a pagar em aberto;
   - a receber vencido;
   - saldo projetado em 30 dias.
3. A **Saúde financeira** é uma nota de 0 a 100 com seis fatores e pesos à vista:

   | Fator | Peso |
   |---|---|
   | Liquidez 30 dias | 25% |
   | Geração de caixa | 25% |
   | Inadimplência | 15% |
   | Dependência de antecipação | 15% |
   | Concentração de clientes | 10% |
   | Aderência ao orçamento | 10% |

4. Mais abaixo ficam as **Leituras do mês**, a evolução de 12 meses, o aging do a receber e do a pagar, os maiores clientes e os maiores pagamentos.
5. **Excel** exporta os números.

O painel usa só lançamentos com conta bancária, a mesma base dos saldos.

## 7. Dashboard

O resumo do ano mostra:

- o saldo em bancos disponível;
- as entradas e as saídas;
- o EBITDA e o resultado gerencial;
- o que está em aberto;
- o gráfico de entradas e saídas com o saldo;
- a composição das saídas;
- os saldos por conta;
- os próximos vencimentos.

## 8. Perguntas frequentes e erros comuns

**O saldo de abertura da Decisão do Dia não bate com o banco.** Falta lançar ou conciliar algo do dia anterior. Veja a Conferência do dia.

**Uma recomendação não faz sentido para nós.** Use **Adiar 7 dias**. Se a regra estiver errada para a IPLAMM, avise o administrador para ajustá-la.

## 9. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: Minha Manhã, Decisão do Dia com registro e aprovação, Decision Center, Dashboard Executivo e Dashboard. |

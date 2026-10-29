---
titulo: Compras — requisições, pedidos e recebimentos
tela: Compras › Painel, Requisições e cotações, Pedidos de compra e Recebimentos
versao: 1.1
atualizado: 2026-10-29
---
## 1. Para que serve

O módulo **Compras** organiza o caminho de uma compra, do pedido de quem precisa até a mercadoria entregue e conferida com a nota:

1. **Requisição**: quem precisa pede.
2. **Aprovação** da requisição pela direção.
3. **Cotação**: Compras pede preços aos fornecedores e compara no mapa de cotações.
4. **Pedido de compra**: gerado da cotação escolhida, aprovado conforme a alçada.
5. **Recebimento**: a entrega é conferida com a nota fiscal, e as parcelas da nota entram no contas a pagar.

O pedido aprovado já vira **previsão no contas a pagar**. No recebimento, a previsão é trocada pelos títulos reais da nota.

## 2. Quem tem acesso

| Perfil | O que faz |
|---|---|
| Compras | Cria requisições, cotações e pedidos; aprova pedidos até a alçada; registra recebimentos. Também usa Pagamentos Antecipados. |
| Administrador e diretor | Aprovam requisições e pedidos de qualquer valor; definem a alçada e os parâmetros. |

A **alçada** é o valor até o qual o próprio Compras aprova o pedido. O padrão é R$ 5.000,00. Acima disso, a aprovação é da direção. A alçada é definida em **Painel de Compras › Parâmetros**.

## 3. Painel de Compras

O painel mostra, em indicadores que podem ser clicados para ver a lista:

- requisições aguardando aprovação;
- pedidos aguardando aprovação;
- valor **comprometido a receber**;
- **entregas atrasadas** e as que **chegam em 7 dias**;
- **economia nas cotações** dos últimos 90 dias;
- **prazo médio de entrega**.

Embaixo ficam as entregas atrasadas e da semana e os **maiores fornecedores** dos últimos 90 dias.

## 4. Passo a passo

### 4.1 Fazer uma requisição

1. Em **Requisições e cotações**, clique em **Nova requisição**.
2. Informe o **solicitante**, o **setor** (centro de custo), a data em **Precisa até**, a **prioridade** e uma justificativa.
3. Em **Itens**, escolha o produto do cadastro na lista ou escreva livre. Informe a unidade, a **quantidade** e, se souber, o valor unitário estimado e o NCM. Use **+ Item** para mais linhas.
4. Clique em **Enviar para aprovação**.

### 4.2 Aprovar ou rejeitar a requisição

Abra a requisição (filtro **Aguardando aprovação**) e clique em **Aprovar** ou **Rejeitar**. Na rejeição, escreva o motivo: a requisição volta para quem pediu, que pode **Editar** e salvar para reenviar.

### 4.3 Cotar com os fornecedores

1. Abra a requisição aprovada (filtro **Aprovadas (cotar)**) e clique em **Nova cotação**.
2. Informe o **fornecedor**, o prazo de entrega em dias, as **parcelas** (por exemplo `28/56/84`), a condição de pagamento, o **frete**, a validade e o **preço unitário de cada item**.
3. Clique em **Salvar**. Repita para cada fornecedor.

A requisição mostra o **mapa comparativo de cotações**: o menor preço de cada item e o **menor total** ficam em verde. Cotação sem preço em algum item aparece como **incompleta**.

### 4.4 Gerar o pedido de compra

1. No mapa, clique em **Gerar pedido** na cotação escolhida. Se não houver cotação, use **Pedido sem cotação**: os preços estimados entram no pedido e podem ser ajustados no rascunho.
2. Confirme o **fornecedor do cadastro**. Se o fornecedor da cotação não estiver cadastrado, escolha o cadastro correspondente ou peça ao Financeiro para cadastrar.
3. O pedido nasce em **rascunho** e a requisição passa para **Virou pedido**.

Também dá para criar um pedido avulso, sem requisição, em **Pedidos de compra › Novo pedido**.

### 4.5 Completar e aprovar o pedido

1. Em **Pedidos de compra**, abra o pedido e clique em **Editar**.
2. Confira o fornecedor, a entrega prevista, as **parcelas (dias após a entrega)**, o frete, o desconto e os itens. Preencha a **classificação (plano de contas)**, obrigatória para aprovar, o centro de custo e o **nº do pedido no Iniflex**.
3. Salve e clique em:
   - **Aprovar**, se o valor estiver dentro da sua alçada (ou se você for diretor ou administrador);
   - **Enviar para aprovação**, se estiver acima. A direção aprova.
4. Depois de aprovado, clique em **Imprimir** para gerar o pedido no padrão IPLAMM, com campos de assinatura, e mande ao fornecedor. Clique em **Marcar como enviado**.

> **Pagamento antes da entrega:** o pedido aprovado tem o botão **Pagamento antecipado**, que abre o pedido de pagamento já preenchido (veja o manual de Pagamentos Antecipados).

### 4.6 Receber a mercadoria

1. Importe o XML da nota em **CPD › Notas Fiscais** (entradas).
2. Em **Recebimentos**, na lista **A receber**, clique em **Receber** no pedido. O botão **Receber** também aparece dentro do pedido.
3. Escolha a **nota fiscal**. Se a nota ainda não chegou, escolha **Sem nota**: é um recebimento físico, e a nota vem depois.
4. Confira a tabela **pedido × nota**: cada item do pedido é ligado ao item da nota, e você informa a quantidade **recebida agora**. A coluna **Conferência** aponta, por item:
   - quantidade acima do pedido;
   - entrega parcial;
   - nota diferente do recebido;
   - preço diferente do pedido, com a porcentagem;
   - item que não está na nota.
5. Confira as **parcelas da nota** e deixe marcada a opção de **lançar as parcelas no contas a pagar**, com a classificação do pedido.
6. Clique em **Registrar recebimento**.

Os recebimentos ficam em **Últimos recebimentos**, com as divergências encontradas. Se faltou algo, o pedido fica como **Recebido em parte** e a previsão é refeita pelo que ainda falta.

## 5. Regras e travas

- O pedido precisa de **classificação (plano de contas)** e valor para ser aprovado.
- Acima da **alçada**, só **diretor ou administrador** aprovam.
- Pedido aprovado **não muda** de fornecedor, frete ou desconto. Para mudar, use **Voltar para rascunho** (só sem recebimento) ou cancele.
- Cancelar exige **motivo**. Pedido já recebido não pode ser cancelado.
- Pedido com recebimento **não volta** para rascunho.
- A previsão no contas a pagar é refeita sempre que o pedido muda, e sai quando ele é recebido ou cancelado.

## 6. Perguntas frequentes e erros comuns

**A mensagem diz "acima da alçada: precisa de aprovação da direção".** Clique em **Enviar para aprovação** e avise o diretor.

**A mensagem diz "Defina a classificação (plano de contas)".** Edite o pedido e escolha o plano de contas antes de aprovar.

**A nota não aparece no recebimento.** Ela ainda não foi importada, ou foi emitida antes dos 30 dias anteriores ao pedido. Importe o XML em Notas Fiscais › Entradas.

**A nota veio em outra unidade (por exemplo, caixa em vez de unidade).** Cadastre o **de-para do fornecedor** em **Estoque › De-para de fornecedores**, com o fator de conversão. Os próximos recebimentos já convertem sozinhos.

**Errei o fornecedor de um pedido aprovado.** Use **Voltar para rascunho**, corrija e aprove de novo. Se já houver recebimento, cancele e faça outro pedido.

## 7. Conversa sobre o registro

No topo da janela do pedido de compra ficam dois botões das **Conversas**:

- **💬 Conversa** abre o bate-papo da equipe sobre este registro. Cada registro tem uma conversa só, e só entra quem consegue ver o registro.
- **↗ Enviar no chat** manda o registro como cartão numa conversa. Quem recebe clica no cartão e abre o registro.

Veja o manual **Conversas** para os detalhes.

## 8. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: painel, requisição, cotação e mapa comparativo, pedido com alçada e impressão, recebimento conferido com a nota. |
| 1.1 | 29/10/2026 | Botões **💬 Conversa** e **↗ Enviar no chat** do pedido de compra (Conversas, etapa 2). |

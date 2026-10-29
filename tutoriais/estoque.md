---
titulo: Estoque e produtos
tela: Compras › Posição de estoque, Produtos e De-para de fornecedores
versao: 1.0
atualizado: 2026-10-28
---
## 1. Para que serve

- **Posição de estoque**: o **espelho do estoque do Iniflex**, importado por arquivo. Mostra o valor a custo de reposição, a curva ABC e o que está abaixo do ponto de pedido, e gera a requisição de compra automática.
- **Produtos**: o cadastro dos produtos e insumos, com:
  - os atributos de plástico flexível e os parâmetros de estoque;
  - os códigos dos fornecedores;
  - a estrutura do produto, com o custo teórico;
  - as compras pelas NF-e e a posição no Iniflex.
- **De-para de fornecedores**: liga cada código de item que aparece nas notas de entrada (CNPJ do fornecedor + código dele) a um produto do cadastro. Com o de-para, a plataforma calcula o custo de compra e casa o recebimento sozinha.

> O estoque oficial continua no **Iniflex**. A plataforma lê o espelho para analisar e comprar melhor.

## 2. Quem tem acesso

| Perfil | O que faz |
|---|---|
| Administrador, diretor e financeiro | Importam e excluem espelhos, definem os parâmetros de custo, cadastram produtos e fazem o de-para. |
| Compras | Consulta a posição, gera a requisição automática e cadastra e edita produtos. |

## 3. Posição de estoque

### 3.1 Importar o espelho do Iniflex

1. No Iniflex, exporte o relatório de **saldo de estoque** em Excel ou CSV, com uma linha por produto e depósito.
2. Clique em **Importar espelho do Iniflex**, escolha o arquivo e informe a data em **Posição em**.
3. Confira a prévia das 8 primeiras linhas e ligue as **colunas do arquivo**: código, descrição, depósito, unidade, quantidade, custo unitário e valor total.
4. Clique em **Importar**. Nada é gravado antes disso.

**Espelhos** lista os espelhos importados. Excluir um espelho tira as linhas dele da plataforma; o Iniflex não muda.

### 3.2 Ler a posição

Os indicadores mostram:

- o valor **a custo de reposição**: a quantidade × o último custo líquido de compra (pelas NF-e de entrada e pelo de-para);
- quantos itens estão **abaixo do ponto de pedido**;
- os **códigos sem cadastro**;
- os itens com **saldo negativo no Iniflex**.

Filtre por **Todos**, **Abaixo do ponto de pedido**, **Curva A**, **Sem cadastro** e **Saldo negativo**. **Excel** baixa a lista.

### 3.3 Gerar a requisição automática

**Gerar requisição dos itens abaixo do ponto** cria uma requisição de compra com esses itens. A quantidade é o lote econômico; ou o necessário até o estoque máximo; ou até o ponto de pedido. A requisição segue o fluxo normal de Compras (veja o manual de Compras).

### 3.4 Parâmetros de custo

Em **Parâmetros de custo**, marque os impostos **recuperáveis** (que geram crédito).

> **Custo líquido** = produtos + frete + outras despesas − desconto + ST − os impostos recuperáveis.

Confirme com a contabilidade quais impostos marcar.

## 4. Produtos

### 4.1 Cadastrar

1. Clique em **Novo produto**.
2. Preencha o **tipo**, o **código (Iniflex)**, a **descrição**, a unidade, o NCM, o grupo e o subgrupo.
3. Em **Plástico flexível**, informe o material, a largura, a espessura, as faces, a cor e a solda.
4. Em **Estoque e compra**, informe o ponto de pedido, o lote econômico, o estoque máximo, a localização e a unidade de compra.
5. Clique em **Salvar**.

**Importar das notas de saída** cadastra de uma vez os códigos vendidos nas NF-e de saída que ainda não estão no cadastro. Eles entram como produto acabado, com a descrição, a unidade e o NCM da nota mais recente. Desmarque o que não for produto (sucata, serviço) e clique em **Cadastrar marcados**.

### 4.2 A ficha do produto

Clique no produto para ver:

- o **estoque no Iniflex**, por depósito;
- os **fornecedores**: o código dele na nota, o fator, o último custo e a última compra;
- a **estrutura**: os componentes que o produto consome, com a quantidade e a perda %, e o custo teórico. Use **+ Componente** para incluir;
- as **compras nos últimos 12 meses**, pelas NF-e de entrada.

## 5. De-para de fornecedores

1. Escolha **Notas desde** e, se quiser, o **fornecedor**.
2. A lista mostra os itens das notas de entrada **sem de-para**: o fornecedor, o código e a descrição no fornecedor, a unidade, o NCM, as notas, o total comprado, a última compra e a **sugestão** de produto.
3. Para cada item, escolha:
   - **Ligar a produto existente**: escolha o produto e informe o **fator**, que diz quantas unidades do produto há em 1 unidade da nota (por exemplo, uma caixa com 1.000 unidades = fator 1000);
   - **Criar produto novo**: com código, descrição, tipo e unidade.
4. **Criar produtos dos marcados** faz em lote: cria um insumo para cada item marcado sem sugestão e liga à sugestão os que têm.

> Se o item já tem código no Iniflex, use o código do Iniflex: é ele que liga o produto ao espelho do estoque.

## 6. Regras e travas

- O código e a descrição são obrigatórios no produto.
- O custo de reposição só existe para itens com de-para.
- A requisição automática só inclui itens com quantidade a comprar definida (lote econômico ou estoque máximo).

## 7. Perguntas frequentes e erros comuns

**O valor do estoque está zerado num item.** O item não tem de-para nem custo no Iniflex. Faça o de-para.

**A mensagem diz "Nenhum item com quantidade a comprar".** Defina o lote econômico ou o estoque máximo nos produtos.

**Importei o espelho errado.** Exclua em **Espelhos** e importe de novo.

## 8. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: espelho do Iniflex, curva ABC, ponto de pedido, requisição automática, parâmetros de custo, cadastro de produtos com estrutura e de-para de fornecedores. |

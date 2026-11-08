---
titulo: Comercial — painel, carteira, funil e metas
tela: Comercial › Painel Comercial (COM001), Carteira e Agenda (COM002), Funil e Propostas (COM003) e Representantes e Metas (COM004)
versao: 1.3
atualizado: 2026-11-05
---
## 1. Para que serve

O módulo **Comercial** é o CRM de vendas da IPLAMM. Ele vai **até a proposta**; o pedido de venda continua no **Iniflex**.

- **Painel Comercial**: o faturamento pelas notas de venda, comparado com a meta. Mostra também a carteira, os representantes, os estados, os produtos com preço médio e o funil.
- **Carteira e Agenda**: os clientes com a situação de cada um, a ficha do cliente e a agenda de próximos contatos.
- **Funil e Propostas**: as oportunidades por etapa e as propostas, com especificação técnica, calculadora de preço e PDF.
- **Representantes e Metas**: liga cada representante a um usuário e define as metas mensais.
- **Curva ABC, Mapa e Rotas**: a curva ABC dos clientes, o mapa por cidade, as visitas por rota e os parâmetros comerciais.

## 2. Quem tem acesso

| Perfil | O que faz |
|---|---|
| Vendas (representante) | Vê só a área Comercial e a **própria carteira**: registra contatos, oportunidades e propostas. Funciona no celular, em campo. |
| Administrador, diretor e financeiro | Veem todas as carteiras e configuram representantes e metas. |
| Administrador e diretor | Alteram os parâmetros comerciais (curva ABC, situação, visitas e rotas). |

## 3. Painel Comercial

![Figura 1 — Painel Comercial (dados fictícios)](img/comercial-1.jpg)

Escolha o **mês**. O painel mostra:

- **Faturado** e **meta**, com o gráfico dos 12 meses;
- **Ticket médio por nota**: o faturado no mês dividido pelo número de notas de venda;
- clientes **ativos** (90 dias), **esfriando** e **inativos** (180 dias ou mais);
- o **funil ponderado** (valor das oportunidades × probabilidade);
- os maiores clientes, o faturamento por representante, os produtos (com preço médio) e o faturamento por estado;
- a **Nota comercial**.

## 4. Carteira e Agenda

![Figura 2 — Carteira e Agenda: a situação de cada cliente (dados fictícios)](img/comercial-2.jpg)

### 4.1 A situação de cada cliente

| Situação | Quando |
|---|---|
| **Ativo** | Compra dentro do ritmo de costume. |
| **Novo** | A primeira compra foi há menos de 90 dias. |
| **Esfriando** | Está há mais tempo sem comprar do que o normal dele (mais de 1,5 vez o intervalo médio entre compras, e no mínimo 20 dias). |
| **Inativo** | Mais de 180 dias sem comprar. |

Os números da tabela são os padrões: cada empresa ajusta em **Curva ABC, Mapa e Rotas › Parâmetros** (item 7.4).

Filtre por representante e por situação. A lista mostra a classe **ABC** do cliente (item 7.1), a última compra, o intervalo médio, as compras em 12 meses, a variação e o próximo contato.

Cliente esfriando ou inativo sem contato agendado mostra a **ação sugerida** (💡). A ação depende da classe: visita para o cliente A, ligação para o B, WhatsApp para o C, com o prazo dos parâmetros. **Agendar** coloca o contato na Agenda, já com o tipo e a data, que você pode ajustar.

### 4.2 A ficha do cliente

Clique no cliente para ver:

- o **financeiro**: títulos em aberto e vencidos;
- os **produtos comprados** em 12 meses, com o preço médio;
- as últimas notas;
- as oportunidades e os **contatos**.

### 4.3 Registrar um contato

1. Na ficha, escolha o **tipo** (ligação, visita, WhatsApp…) e escreva **o que foi tratado**.
2. Marque o **próximo contato** e o assunto.
3. Clique em **Registrar**.

A aba **Agenda de contatos** lista os próximos contatos. Clique em **Feito** quando o contato acontecer.

## 5. Funil e Propostas

![Figura 3 — Funil e Propostas: as oportunidades por etapa (dados fictícios)](img/comercial-3.jpg)

### 5.1 Oportunidade

![Figura 4 — Nova oportunidade: Cliente e Oportunidade (dados fictícios)](img/comercial-4.jpg)

1. Clique em **Nova oportunidade**.
2. Em **Cliente**, escolha o **cliente da carteira**, ou escreva um **prospect** (quem ainda não tem cadastro), e informe o contato. Quem é da empresa escolhe também o **representante**.
3. Em **Oportunidade**, preencha **o que é** (obrigatório), o valor estimado, a **probabilidade %**, a previsão de fechamento e a observação.
4. Clique em **Salvar**.

As etapas são: **Contato → Qualificado → Proposta enviada → Ganha ou Perdida**. Ao marcar como perdida, informe o motivo (preço, prazo, qualidade, concorrente, desistência…). Ao marcar como ganha, informe o nº do pedido no Iniflex (pode ser depois).

### 5.2 Proposta

1. Na oportunidade, abra uma proposta.
2. Informe os **itens**: descrição, material, largura (mm), espessura (µm), comprimento (m), faces (2 = tubular ou saco), cores, quantidade, unidade e preço.
3. Use a **calculadora** (botão **calc** no item):
   - o peso teórico sai do material e das medidas;
   - informe o **custo do kg** (resina, aditivos, tinta e conversão) e a **margem desejada %**;
   - **preço = custo ÷ (1 − margem)**. Os impostos sobre a venda **não** estão no cálculo;
   - clique em **Usar o preço**.
4. Preencha a validade, o frete, a condição de pagamento, o prazo de entrega e a observação (que sai no PDF).
5. Clique em **Salvar**.

Depois:

- **PDF** gera a proposta no padrão IPLAMM, para mandar ao cliente.
- **Marcar enviada**, **Recusada** ou **Aceita** registra a resposta. A proposta aceita pergunta se a oportunidade vira ganha.

## 6. Representantes e Metas

![Figura 5 — Representantes e Metas, com o seletor de meses aberto (dados fictícios)](img/comercial-5.jpg)

1. Clique em **Novo representante**. Informe o **nome**, o **representante no cadastro** (que define a carteira dele) e o **usuário com perfil Vendas**. O usuário entra por convite em **Cadastros › Empresa e Usuários**.
2. Em **Metas de faturamento**, escolha o ano, preencha a meta de cada mês por representante e clique em **Salvar metas**.
3. A grade mostra **um semestre por vez** (o semestre atual), para os valores caberem na tela. O botão **Meses** troca: **1º semestre**, **2º semestre**, **Ano todo** (a grade rola para o lado, com o nome fixo) ou os meses que você marcar. A escolha fica guardada para você; **Restaurar padrão** volta ao semestre atual. O total do **Ano** e o **Salvar metas** consideram sempre os 12 meses, inclusive os ocultos.

Se a meta da empresa ficar em branco, o painel usa a soma das metas dos representantes.

## 7. Curva ABC, Mapa e Rotas

### 7.1 Curva ABC

![Figura 6 — Curva ABC: as classes, a curva de Pareto e a ação sugerida (dados fictícios)](img/comercial-6.jpg)

Os clientes são ordenados pelo faturamento das notas de venda nos últimos 12 meses:

- **A**: os maiores, que somam até 80% do faturamento;
- **B**: os seguintes, até 95%;
- **C**: o restante;
- cliente sem compra no período fica sem classe.

O cliente que cruza a faixa ainda entra nela. Exemplo: se os dois primeiros somam 78%, o terceiro ainda é A.

A tela mostra quantos clientes e quanto do faturamento cada classe tem, a curva de Pareto (barras com o faturamento e a linha do acumulado) e a lista com a situação, a cidade e a ação sugerida. Clique no cliente para abrir a ficha na Carteira. O filtro **Representante** vale para as três abas.

### 7.2 Mapa

![Figura 7 — Mapa dos clientes: faturamento por estado e por cidade, com a situação (dados fictícios)](img/comercial-7.jpg)

O mapa mostra:

- cada **estado**, mais escuro quanto maior o faturamento;
- cada **cidade** com clientes, como um círculo do tamanho do faturamento.

A cor do círculo segue a escolha em **Cor das cidades**:

- **Situação**: verde = clientes comprando; laranja = algum cliente A ou B esfriando ou inativo; vermelho = só inativos;
- **Curva ABC**: a melhor classe da cidade.

O mapa abre na região dos clientes. **Brasil inteiro** mostra o país todo. Clique num estado para aproximar e numa cidade para ver os clientes dela, com a ação sugerida.

A cidade do cliente vem da última NF-e emitida para ele ou da cidade e UF do cadastro. Se faltar a cidade de algum cliente, clique em **Localizar pela NF-e e cadastro**.

### 7.3 Visitas por rota

![Figura 8 — Visitas por rota: quem visitar, os dias de visita e os clientes longe demais (dados fictícios)](img/comercial-8.jpg)

A lista **Quem visitar** traz dois grupos:

- os clientes com a **visita vencida** pela frequência da classe (padrão: A a cada 30 dias, B 60, C 120). Vale a última interação do tipo **Visita** registrada na ficha;
- os clientes **A e B esfriando ou inativos**.

Para planejar:

1. Marque quem visitar. Os A e B já vêm marcados;
2. Escolha a data de início;
3. Clique em **Montar rota**.

A rota sai da cidade de saída e vai sempre ao cliente mais próximo. Cada dia fecha no limite de visitas ou de km, contando a volta. A ordem de cada dia é otimizada para rodar menos.

Clientes além do **raio da rota** ficam no quadro **Longe demais para a rota**, com **Agendar** um contato à distância. **Agendar as visitas** coloca cada visita na Agenda de contatos, no dia útil dela (sábados e domingos são pulados).

As distâncias são aproximadas: linha reta × fator da estrada.

### 7.4 Parâmetros

![Figura 9 — Parâmetros comerciais (dados fictícios)](img/comercial-9.jpg)

| Parâmetro | Padrão |
|---|---|
| Classe A até / Classe B até (% do faturamento) | 80% / 95% |
| Período da curva ABC | 12 meses |
| Esfriando: N× o intervalo normal, no mínimo X dias | 1,5× / 20 dias |
| Inativo depois de / Novo há menos de | 180 / 90 dias |
| Ação sugerida por classe | A visita, B ligação, C WhatsApp |
| Visitar a cada (A / B / C) | 30 / 60 / 120 dias |
| Prazo para o contato | 7 dias (A: até 3; inativo: o dobro) |
| Cidade de saída das rotas | a cidade da empresa |
| Visitas e km por dia | 5 visitas / 300 km |
| Fator da estrada / Raio da rota | 1,25 / 250 km |

## 8. Regras e travas

- O representante só vê os clientes da **própria carteira**.
- O faturamento vem das **NF-e de saída** importadas em Notas Fiscais.
- O pedido de venda continua no Iniflex: o Comercial vai até a proposta.
- Só administrador e diretor alteram os parâmetros comerciais. Os representantes veem o mapa e as rotas da própria carteira.

## 9. Perguntas frequentes e erros comuns

**A mensagem diz "Cliente fora da sua carteira".** O cliente pertence a outro representante. Fale com a direção.

**O faturamento do mês está baixo.** As notas de venda ainda não foram importadas. Veja em CPD › Notas Fiscais.

**Um cliente não aparece no mapa.** Falta a cidade: clique em **Localizar pela NF-e e cadastro**. Se continuar fora, preencha a cidade e a UF no cadastro do cliente.

**A rota não inclui um cliente marcado.** Ele está além do raio da rota (vai para "Longe demais") ou não tem cidade.

**A calculadora pede "Complete o cálculo".** Preencha o material, a largura e a espessura (e o comprimento, para saco ou sacola), o custo do kg e a margem.

## 10. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: painel, carteira com situação dos clientes, contatos e agenda, funil, propostas com calculadora e PDF, representantes e metas. |
| 1.1 | 29/10/2026 | Imagens das telas, com dados fictícios. |
| 1.2 | 05/11/2026 | Nomes das telas iguais aos do menu, com o código. Nova oportunidade em seções (Cliente e Oportunidade); metas um semestre por vez, com o seletor **Meses**. Figuras refeitas. |
| 1.3 | 08/11/2026 | Curva ABC, Mapa e Rotas (COM007): classes ABC, mapa por estado e cidade, visitas por rota com limite de visitas, km e raio, e parâmetros comerciais. Carteira com a classe e a ação sugerida (Agendar). |

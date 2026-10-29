---
titulo: Fretes e CIOT
tela: Logística › Fretes e CIOT
versao: 1.1
atualizado: 2026-10-29
---
## 1. Para que serve

A tela **Fretes e CIOT** registra cada frete contratado pela IPLAMM e confere se ele segue as regras da ANTT:

- **CIOT**: código da operação de transporte.
- **MDF-e**: manifesto da carga.
- **Piso mínimo do frete**: valor mínimo da tabela da ANTT.
- **Vale-pedágio**.
- **Pagamento**: ao autônomo, pela IPEF e na conta indicada por ele.

O registro de cada frete é a **ficha do frete**. A tela também guarda o cadastro dos **transportadores**, mostra a **conformidade do mês** e gera o relatório para a diretoria.

> **Por que importa:** desde maio de 2026 a ANTT exige CIOT em toda operação de transporte. Quem contrata autônomo gera o CIOT pela IPEF e paga por ela. Frete abaixo do piso pode gerar multa alta ao contratante. A partir de 23/11/2026 a SEFAZ recusa MDF-e sem CIOT.

## 2. Quem tem acesso

| Perfil | O que faz |
|---|---|
| Administrador, diretor e financeiro | Cadastram e editam fretes, transportadores e coeficientes; programam e ligam pagamentos; dispensam lançamentos. |
| Demais perfis com a área Logística | Consultam tudo, sem editar. |

## 3. As abas

- **Fretes**: os fretes do mês, com os indicadores (fretes no mês, com autônomo, autônomo com pendência, abaixo do piso).
- **Transportadores**: o cadastro de autônomos, transportadoras e cooperativas.
- **Conformidade do mês**: o resumo do mês, os fretes pagos sem ficha e o relatório para imprimir.
- **Piso mínimo**: os coeficientes da tabela da ANTT usados no cálculo.

## 4. Passo a passo

### 4.1 Cadastrar um transportador

1. Na aba **Transportadores**, clique em **Cadastrar**.
2. Preencha o **nome / razão social** e o **CPF / CNPJ**. O tipo é sugerido pelo documento: CPF vira autônomo e CNPJ vira transportadora.
3. Confira o **tipo**:
   - **Autônomo (TAC)**: pessoa física com RNTRC.
   - **Autônomo equiparado**: empresa com até 3 veículos no RNTRC (consulte o RNTRC na ANTT).
   - **Transportadora (ETC)**.
   - **Cooperativa (CTC)**.
4. Informe o **RNTRC** e a validade dele, e o **favorecido no cadastro** usado nos pagamentos.
5. Em **Veículos**, escreva uma linha por veículo, no formato `placa;eixos;tipo` (por exemplo `ABC1D23;5;carreta`).
6. Em **Conta para pagamento do frete**, informe banco, agência, conta ou Pix, o **titular** e de quem é a conta: do próprio autônomo, do cônjuge ou companheiro(a), ou de parente até 2º grau.
7. Informe a **IPEF usada** e a validade do contrato, e clique em **Salvar**.
8. Abra o transportador de novo e anexe o **contrato** em **Contrato e documentos**, com o tipo "Contrato".

> **Começando do zero:** o botão **Trazer dos fretes pagos em 2026** lista quem já recebeu no plano de fretes (2.06.01) e ainda não está cadastrado. Marque e clique em **Cadastrar marcados**. Depois complete o RNTRC, a conta e o contrato de cada um.

### 4.2 Criar a ficha de um frete

1. Na aba **Fretes**, clique em **Novo frete**.
2. Escolha o **transportador**. Se ele não existir, use **+ cadastrar transportador**.
3. Informe a **data da viagem**, a **carga da logística** (se houver), as **NF-e transportadas**, a origem e o destino.
4. Informe a **distância (km, ida)** e os **eixos carregados**, e marque se é **carga lotação** e se há **retorno vazio obrigatório** (com os km de retorno).
5. Informe o **valor do frete**. Logo abaixo, a ficha mostra o **piso mínimo** e se o frete está acima ou abaixo dele.
6. Preencha a placa, o motorista, o **CIOT** (e quem o gerou: a IPLAMM pela IPEF ou a transportadora), a **chave do MDF-e** (44 dígitos), a **chave do CT-e** e o **vale-pedágio**, ou marque **Rota sem pedágio**.
7. Clique em **Salvar**.
8. Abra a ficha de novo e anexe os documentos: CIOT, MDF-e, CT-e, vale-pedágio, contrato e comprovantes.

A ficha mostra na hora o que falta. Para autônomo aparece **Pagamento travado (autônomo): falta ...**; para transportadora, **Avisos: falta ...**.

### 4.3 Pagar o frete

Na ficha salva há dois botões:

- **Programar pagamento**: cria o lançamento **Em aberto** no plano de fretes, que entra no fluxo de caixa e na autorização de pagamentos.
- **Ligar a lançamento**: para quando o pagamento já foi lançado. A janela mostra os lançamentos de frete de 45 dias antes ou depois da viagem que ainda não têm ficha, com os do mesmo favorecido e valor mais próximo no topo.

> **Autônomo:** o pagamento deve sair pela **IPEF que gerou o CIOT**, na conta indicada pelo autônomo. Nunca pague autônomo pelo caixa, em dinheiro ou por Pix direto ao motorista.

### 4.4 Conferir o mês

1. Na aba **Conformidade do mês**, escolha o **mês**.
2. A primeira tabela resume os fretes com ficha, por tipo de transportador: sem CIOT, sem MDF-e, abaixo do piso e com pendência.
3. A lista **Fretes pagos sem ficha** mostra os lançamentos do plano de fretes sem ficha, com alertas como "pago pelo caixa", "pessoa física / autônomo?" e "sem favorecido". Para cada um:
   - **Criar ficha**: abre a ficha já com a data, o valor e o lançamento ligado.
   - **Dispensar**: para o que não precisa de ficha. Escolha o **motivo** (relação encerrada, contratado por terceiro com CT-e em nome da IPLAMM, não é frete rodoviário, ou outro) e escreva a **justificativa**. O lançamento não muda; só sai dos alertas, com registro de quem dispensou e quando. Os dispensados ficam em **Dispensados com justificativa** e podem ser desfeitos.
4. Clique em **Relatório (imprimir)** para gerar o relatório de conformidade do mês no padrão IPLAMM.

### 4.5 Atualizar o piso mínimo

Quando a ANTT reajustar a tabela, abra a aba **Piso mínimo** e clique em **Incluir coeficiente**. Informe a tabela, o tipo de carga, os eixos, o **CCD** (R$/km), o **CC** (R$), a **vigência** e a fonte.

Inclua sempre uma linha nova com a nova vigência, sem apagar a antiga: os fretes antigos continuam calculados pela tabela da época.

## 5. Regras e travas

- **Piso mínimo** = km × CCD + CC. Com retorno vazio obrigatório, soma 0,92 × CCD × km de retorno. Vale só para **carga lotação**; o pedágio é pago à parte, pelo vale-pedágio.
- **Autônomo** (TAC, equiparado ou cooperativa): o lançamento **não pode ser baixado como pago** enquanto houver pendência. É uma trava do sistema. Precisa ter:
  - CIOT;
  - MDF-e;
  - contrato anexado e dentro da validade;
  - RNTRC válido;
  - conta indicada pelo autônomo;
  - vale-pedágio (ou rota sem pedágio);
  - valor igual ou maior que o piso.
- **Transportadora**: as mesmas faltas aparecem como **aviso**, sem travar o pagamento. O CIOT e o MDF-e são gerados por ela; peça os números e anexe.
- A chave do MDF-e tem **44 dígitos**.
- Frete já pago não pode ser cancelado pela ficha.

## 6. Perguntas frequentes e erros comuns

**O piso não aparece.** Informe os km e os eixos e confira se **Carga lotação** está marcada. Se aparecer "sem coeficiente para esses eixos", inclua o coeficiente na aba Piso mínimo.

**Não consigo baixar o pagamento do autônomo.** Abra a ficha do frete e veja a linha **Pagamento travado**: ela diz o que falta.

**O frete foi contratado pelo fornecedor e o CT-e veio em nome da IPLAMM.** Na Conformidade do mês, use **Dispensar** com o motivo "Contratado por terceiro" e escreva a justificativa.

**Lancei uma despesa que não é frete no plano de fretes.** Dispense com o motivo "Não é frete rodoviário" e peça ao financeiro para reclassificar o lançamento.

**Cancelei um frete e o lançamento continua no fluxo.** O cancelamento não apaga o lançamento programado. Exclua o lançamento em Lançamentos, se for o caso.

## 7. Conversa sobre o registro

No topo da janela do frete ficam dois botões das **Conversas**:

- **💬 Conversa** abre o bate-papo da equipe sobre este registro. Cada registro tem uma conversa só, e só entra quem consegue ver o registro.
- **↗ Enviar no chat** manda o registro como cartão numa conversa. Quem recebe clica no cartão e abre o registro.

Veja o manual **Conversas** para os detalhes.

## 8. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: transportadores, ficha do frete, piso mínimo, pagamento com trava para autônomo, conformidade do mês com dispensa justificada e relatório. |
| 1.1 | 29/10/2026 | Botões **💬 Conversa** e **↗ Enviar no chat** do frete (Conversas, etapa 2). |

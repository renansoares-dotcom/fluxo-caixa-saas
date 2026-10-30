---
titulo: Contratos
tela: Cadastros › Contratos
versao: 1.0
atualizado: 2026-10-30
---
## 1. Para que serve

Guardar todos os contratos da empresa num só lugar e não perder nenhum prazo:

- **vigência** e **aviso prévio**: a plataforma avisa antes do fim do contrato e antes do último dia para avisar a outra parte;
- **reajuste**: na data-base, calcula o índice (IPCA, IGP-M ou INPC) e propõe o novo valor, que só vale depois de aprovado;
- **PDF assinado**: o contrato assinado no gov.br fica anexado, com os aditivos e termos;
- **fluxo de caixa**: as parcelas do contrato entram no fluxo como contas a pagar ou a receber.

## 2. Quem tem acesso

Só os **administradores** da empresa. Os outros perfis não veem o menu, os contratos, os valores nem os PDFs. As parcelas geradas aparecem no fluxo e nos lançamentos como qualquer conta em aberto.

## 3. Lista de contratos

![Figura 1 — Contratos vigentes com os alertas (dados fictícios)](img/contratos-1.jpg)

1. Abra **Cadastros › Contratos**.
2. No topo: quantos contratos estão vigentes, quanto eles somam por mês a pagar e a receber, quantos têm alerta e quantos estão sem o PDF assinado.
3. Use os filtros **Vigentes**, **Com alerta**, **Rascunhos**, **Encerrados** e **Todos**, e a busca por número, parte, objeto ou CNPJ.
4. A coluna **Situação** mostra os alertas de cada contrato:

| Alerta | Quando aparece |
|---|---|
| Vence em X dias | Faltam 90 dias ou menos para o fim, sem renovação automática. |
| Último dia para aviso prévio | Faltam 30 dias ou menos para o limite do aviso prévio. |
| Reajuste em / pendente | A data-base está a 30 dias ou menos (ou já passou) e o reajuste não foi calculado. |
| Reajuste para aprovar | Há um reajuste proposto esperando decisão. |
| Venceu / renovado automaticamente | O prazo terminou: renove, atualize a vigência ou encerre. |
| Sem o contrato assinado | Nenhum PDF do tipo "Contrato assinado" foi anexado. |

Os mesmos alertas aparecem no **Decision Center** para os administradores.

## 4. Cadastrar um contrato

![Figura 2 — Ficha do contrato: documentos, parcelas e reajuste (dados fictícios)](img/contratos-2.jpg)

1. Clique em **Novo contrato**.
2. Escolha o **tipo** (locação de veículo, prestação de serviços, transporte com autônomo, agregado, locação de imóvel, fornecimento etc.) e a **natureza**: a pagar, a receber ou sem valor (ex.: confidencialidade).
3. Em **Outra parte vem de**, escolha de onde buscar a parte: beneficiários, transportadores ou colaboradores. O nome e o CPF/CNPJ são preenchidos. Se a parte não estiver cadastrada, escolha **Digitar nome e documento**.
4. Em **Valor e vigência**: valor, periodicidade, dia do vencimento, início e fim (vazio = prazo indeterminado), dias de aviso prévio e se renova sozinho.
5. Em **Índice de reajuste**, escolha o índice e a **próxima data-base** (ao informar o início, a plataforma sugere um ano depois). Para percentual fixo, informe o percentual.
6. Em **Fluxo de caixa**, escolha a **conta do plano** (obrigatória para gerar parcelas), o centro de custo e a conta bancária.
7. Clique em **Salvar**. O contrato recebe um número sequencial e a ficha abre com as partes de documentos, parcelas e reajuste.

## 5. Contrato assinado (gov.br) e documentos

1. Gere ou receba a minuta em PDF.
2. Assine em **assinador.iti.br** com a conta gov.br (nível prata ou ouro) e envie o mesmo arquivo para a outra parte assinar.
3. Na ficha, em **Documentos**, escolha o tipo **Contrato assinado**, escreva uma descrição se quiser e clique em **Anexar arquivo**.
4. A plataforma confere se o PDF tem **assinatura digital**. Se não tiver, ela pergunta antes de anexar como assinado.
5. Anexe também **aditivos**, **termos de vistoria** e outros documentos. Arquivos até 15 MB (PDF, PNG ou JPG). Só administradores abrem os arquivos.

## 6. Parcelas no fluxo de caixa

1. Na ficha, em **Parcelas no fluxo**, escolha **Gerar até** (padrão: 12 meses) e clique em **Gerar parcelas que faltam**.
2. As parcelas entram como lançamentos **Em aberto**, com a descrição "Contrato nº …" e o documento "CT nº". Elas aparecem no fluxo, nos lançamentos e na autorização de pagamentos.
3. Pode clicar de novo quando quiser: só as parcelas que faltam são criadas, nunca em dobro.
4. Dia de vencimento 29, 30 ou 31 cai no último dia dos meses mais curtos.

## 7. Reajuste: proposta e aprovação

1. Quando a data-base chegar perto, abra a ficha e clique em **Calcular reajuste**.
2. A plataforma busca o índice acumulado em 12 meses no **Banco Central** (IPCA, IGP-M ou INPC), até o último mês já publicado. Se a busca falhar, informe o percentual e a fonte.
3. Confira e clique em **Propor reajuste**. Nada muda ainda.
4. Em **Reajustes**, clique em **Aprovar** ou **Recusar**:
   - **aprovado**: o valor do contrato e as parcelas em aberto a partir da data-base passam para o novo valor;
   - **recusado**: o valor continua o mesmo.
5. Nos dois casos, a próxima data-base passa para um ano depois.

## 8. Renovar, encerrar ou rescindir

- **Renovação automática**: quando o prazo termina, a ficha mostra **Renovar até …** (mesmo prazo do período anterior).
- **Encerrar / rescindir**: informe a situação, a data e o motivo. A plataforma oferece excluir as parcelas em aberto depois dessa data.

## 9. Dúvidas frequentes

**O botão Gerar parcelas está desligado.** O contrato precisa estar vigente, ter valor e ter a conta do plano escolhida. Salve a ficha depois de preencher.

**O índice não veio do Banco Central.** O site do Banco Central pode estar fora do ar ou o mês ainda não foi publicado. Informe o percentual acumulado e a fonte (ex.: tabela do IBGE ou da FGV).

**Assinei no gov.br e a plataforma diz que não tem assinatura digital.** Confira se anexou o arquivo baixado do assinador (o nome costuma terminar em "_assinado.pdf"), e não a minuta original.

**Os modelos de contrato prontos.** Vêm na segunda parte desta etapa: minutas de locação de veículo, prestação de serviços, transporte com autônomo e agregado, vistoria, responsabilidade do motorista, uso de imagem e confidencialidade, preenchidas com os cadastros.

## 10. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 30/10/2026 | Primeira versão: cadastro de contratos, PDF assinado com conferência de assinatura digital, alertas de vencimento, aviso prévio e reajuste, parcelas no fluxo e reajuste proposto e aprovado. |

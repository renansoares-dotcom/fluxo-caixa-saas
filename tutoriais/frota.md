---
titulo: Gestão da frota e motoristas
tela: Logística › Gestão da Frota (LOG003)
versao: 1.4
atualizado: 2026-11-08
---
## 1. Para que serve

Controlar tudo o que envolve os veículos e quem dirige:

- **documentos** dos veículos com validade (licenciamento, IPVA, seguro, tacógrafo, AET);
- **manutenção** preventiva por km ou por tempo e as corretivas, com a conta a pagar no fluxo;
- **abastecimento** com o consumo (km/l) e o aviso de consumo fora da média;
- **multas** com o prazo para indicar o condutor e o desconto em folha;
- **motoristas** com CNH, exame toxicológico, MOPP e termo de responsabilidade;
- **custo por veículo** no mês e o custo por km usado na montagem das cargas.

## 2. Quem tem acesso

Quem edita a logística: **administrador, financeiro e diretor**. Os demais perfis não veem a gestão da frota nem os dados dos motoristas. Os contratos de locação ligados aos veículos aparecem só para administradores.

## 3. Painel

![Figura 1 — Painel da frota: custo por veículo e alertas (dados fictícios)](img/frota-1.jpg)

1. Abra **Logística › Gestão da Frota**.
2. Escolha o **mês**. Para cada veículo aparecem:
   - km rodados (pelo hodômetro dos abastecimentos);
   - combustível, manutenção, **pneus** (as manutenções do tipo Pneus, separadas das demais), multas e locação (do contrato);
   - o total;
   - o **custo por km**, com a divisão embaixo: combustível · manutenção · pneus por km;
   - o consumo médio.
3. A coluna **Custo/km usado nas cargas** mostra o valor que a montagem de cargas usa hoje. Clique em **usar** para trocar pelo custo real do mês.
4. Em **Alertas**: documentos vencendo em até 60 dias, preventivas no limite, CNH, toxicológico e MOPP vencendo, consumo fora da média e multas com prazo de indicação perto. Os mesmos alertas aparecem no **Decision Center**.

### 3.1 Avisos de vencimento

Além dos alertas na tela, a plataforma **avisa todo dia às 7h40**, no sino e no celular, o que vai vencer:

- documentos do veículo (o mais recente de cada tipo, só de veículos ativos);
- CNH, exame toxicológico e curso MOPP dos motoristas ativos;
- preventivas, pela data ou pelo km (o que vier primeiro).

Cada item é avisado **uma vez ao entrar na antecedência** e **outra vez ao vencer**. Quem clicou em **Avisar agora** vê o resultado na tela e não recebe o aviso.

Clique em **Avisos de vencimento**, no painel, para configurar:

- ligar ou desligar o aviso diário;
- a **antecedência em dias** (padrão 30);
- para preventiva por km, avisar **faltando quantos km** (padrão 1.000);
- **quem recebe** (administrador, diretor, financeiro e/ou produção);
- as palavras que identificam combustível no extrato da VExpenses (seção 5).

A janela também lista o que está na antecedência agora. **Avisar agora** manda os itens que ainda não foram avisados.

![Figura 2 — Avisos de vencimento: antecedência, quem recebe, palavras do VExpenses e o que está vencendo (dados fictícios)](img/frota-4.jpg)

## 4. Veículos: documentos e preventivas

1. Na aba **Veículos**, clique no veículo.
2. Complete a identificação: marca e modelo, anos, RENAVAM, chassi e **propriedade** (próprio, locado ou agregado). Para locado e agregado, escolha o **contrato**: o valor mensal entra no custo do veículo.
3. Em **Documentos**, inclua cada documento com número, seguradora ou órgão, validade, valor e o arquivo (PDF ou foto).
4. Em **Manutenção preventiva**, cadastre os serviços com intervalo em **km**, em **meses** ou nos dois (vale o que vencer primeiro), com a última execução.
5. Capacidade, baú e parâmetros da montagem de cargas continuam em **Frota e Parâmetros**.

## 5. Abastecimento

![Figura 3 — Abastecimentos com o consumo de cada trecho (dados fictícios)](img/frota-2.jpg)

1. Na aba **Abastecimento**, preencha veículo, motorista, data, **km do hodômetro**, litros, valor, combustível e posto. Marque **Tanque cheio** quando completar o tanque.
2. A plataforma lembra o último veículo, motorista, combustível e posto, para agilizar a digitação.
3. O km atual do veículo é atualizado sozinho. Se o km digitado for menor que o último, a plataforma pergunta antes de gravar.
4. **Importar do VExpenses**: envie o PDF do **Extrato de Pagamentos** da VExpenses. A plataforma:
   - traz os gastos em posto, pelas palavras configuradas nos Avisos de vencimento;
   - sugere o **motorista** pelo nome do colaborador do cartão e o **veículo** pelo último abastecimento desse motorista;
   - escolhe o combustível pela descrição (ARLA, gasolina, etanol ou diesel).

   Informe o **km** e os **litros** do cupom e clique em **Registrar os marcados**. Um gasto já importado aparece marcado e não entra de novo.

   ![Figura 4 — Combustível do extrato da VExpenses: veículo e motorista sugeridos, km e litros do cupom (dados fictícios)](img/frota-5.jpg)
5. **Km/l** pelo método do tanque cheio: distância entre dois abastecimentos com tanque cheio ÷ litros colocados nesse intervalo (inclusive os parciais). Em vermelho, os trechos 15% piores que a média do veículo: pode ser vazamento, desvio de combustível, defeito ou erro de digitação.

## 6. Manutenção

1. Na aba **Manutenção**, clique em **Registrar manutenção**.
2. Escolha o veículo, o tipo e, se for preventiva, o **plano atendido**: a última execução do plano é atualizada sozinha.
3. Informe data, km, oficina (beneficiário cadastrado ou nome), serviço, valor e a nota.
4. Em **Conta a pagar no fluxo**, deixe marcado **Gerar lançamento em aberto**, escolha o vencimento e a conta do plano. O lançamento entra no fluxo e na autorização de pagamentos. A conta do plano escolhida fica lembrada para a próxima vez.

## 7. Multas

1. Na aba **Multas**, clique em **Registrar multa** e preencha veículo, condutor, data, auto, órgão, infração, código, pontos, valor, vencimento e o **prazo para indicar o condutor** (está na notificação).
2. **Indique o condutor dentro do prazo**: sem indicação, a empresa recebe outra multa por não identificar o infrator. O motorista assina o formulário de identificação do condutor.
3. Mude a **situação** conforme o andamento: indicar condutor, condutor indicado, em recurso, a pagar, paga, descontada em folha ou cancelada.
4. Marque **Descontar do motorista em folha** quando houver termo de responsabilidade assinado (art. 462, § 1º, da CLT) e a culpa do motorista.
5. A multa gera a conta a pagar no fluxo, como a manutenção.

## 8. Motoristas

![Figura 5 — Motoristas com CNH, toxicológico e alertas (dados fictícios)](img/frota-3.jpg)

1. Na aba **Motoristas**, clique em **Incluir motorista**. Se ele for empregado, escolha o **colaborador do RH**: nome e CPF vêm preenchidos.
2. Informe CNH (número, categoria, validade e se tem EAR), exame **toxicológico** (data e validade: a plataforma sugere 2 anos e 6 meses depois do exame; confira no laudo), **MOPP** (produtos perigosos, quando houver) e a data do **termo de responsabilidade** assinado.
3. Alertas: CNH, toxicológico e MOPP vencendo em até 60 dias; toxicológico não cadastrado para CNH C, D ou E; empregado sem termo de responsabilidade.
4. **Login do App do Motorista**: escolha o usuário com o perfil Motorista. Com o login, as cargas em que ele for escolhido aparecem no celular dele (veja o manual **App do Motorista**).
4. O **termo de responsabilidade pelo uso do veículo** sai em **Cadastros › Contratos**, na ficha do contrato, em **Minuta para assinatura**.

## 9. Dúvidas frequentes

**O km/l não aparece.** O cálculo precisa de dois abastecimentos com **tanque cheio** no mesmo veículo. Abastecimentos parciais entram no trecho seguinte.

**O custo por km do mês está alto.** Veja se faltou digitar abastecimentos (o km do mês sai do hodômetro) ou se houve uma manutenção grande no mês.

**Quero ver os contratos de locação.** Só administradores veem os contratos; os demais veem o custo da locação já somado no painel.

## 10. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 30/10/2026 | Primeira versão: painel de custos, documentos dos veículos, preventivas, manutenção e multas com conta a pagar, abastecimento com km/l e motoristas com CNH, toxicológico e MOPP. |
| 1.1 | 05/11/2026 | Nomes das telas iguais aos do menu, com o código da tela no cabeçalho. |
| 1.2 | 29/10/2026 | Imagens das telas, com dados fictícios. |
| 1.3 | 08/11/2026 | Ficha do motorista com o login do App do Motorista. |
| 1.4 | 08/11/2026 | Pneus em coluna própria e custo por km dividido (combustível, manutenção, pneus); avisos diários de vencimento (documentos, CNH/toxicológico/MOPP e preventivas) com antecedência, km e papéis configuráveis; importação do combustível do extrato da VExpenses. |

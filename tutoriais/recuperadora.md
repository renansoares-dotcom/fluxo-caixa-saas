---
titulo: Recuperadora — entradas pela balança, aparas internas e lotes
tela: Produção › Recuperadora (REC001, REC002, REC003, REC009)
versao: 1.0
atualizado: 2026-11-09
---
A Recuperadora controla o material plástico que entra para ser reprocessado (moído, lavado, aglutinado e granulado). Ela serve a três tipos de empresa:

- **só aparas internas**: a empresa reprocessa a apara da própria produção para o grão voltar à linha;
- **só compra de terceiros**: a empresa compra material reciclável de catadores, cooperativas e sucateiros;
- **as duas coisas**.

Esta é a parte 1 do módulo: a entrada do material, os fornecedores, os adiantamentos, a relação para a nota de entrada e os lotes. O processamento, o rendimento, a qualidade e o custo do grão vêm na parte 2. O balanço de massa, o controle ambiental e o fiscal vêm na parte 3.

## 1. Ligar e configurar (Parâmetros da Recuperadora)

Em **Produção › Recuperadora › Parâmetros da Recuperadora** (REC009), quem configura a produção (administrador, financeiro ou diretor) liga o módulo e define as regras. Com o módulo **desligado**, o menu da Recuperadora some para todos, menos os Parâmetros, que continuam visíveis para quem configura.

![Figura 1 — Parâmetros da Recuperadora: modo, aparas internas, balança, pagamento ao fornecedor e estoque](img/recuperadora-1.jpg)

### 1.1 Modo e regras gerais

| Parâmetro | O que faz |
|---|---|
| Modo | Desligada, só aparas internas, só compra de terceiros, ou aparas internas e compra de terceiros |
| Apara vira lote sozinha | O refugo apontado no encerramento da OP entra num lote de apara do dia (seção 6) |
| Material padrão da apara | Material usado quando nenhuma regra da apara se aplica |
| Valor do kg da apara interna | Custo de entrada do lote de apara. Use 0 se a apara já está no custo da OP |
| Tolerância (kg) | Diferença aceita entre a soma dos materiais e o peso líquido da balança |
| Desconto máximo sem aprovação (%) | Acima dele, só administrador, financeiro ou diretor fecha o ticket |
| Exigir foto da carga | O ticket só fecha com ao menos uma foto |
| Balança: velocidade (baud) | Velocidade da leitura direta da balança pelo Chrome ou pelo Edge |
| Conta da compra de reciclável | Conta do título a pagar gerado ao fechar o ticket. Vazia, o ticket não gera título |
| Prazo de pagamento (dias) | Vencimento do título, contado a partir da data da pesagem |
| Conta do adiantamento | Conta do título a pagar gerado pelo adiantamento a fornecedor |
| Abater o adiantamento | Ao fechar o ticket, o saldo de adiantamento do fornecedor abate a compra |
| Lançar a compra no Kardex | O material ligado a um produto entra no estoque, no local escolhido (padrão: aparas, APA) |
| Prefixos | Prefixo do código dos lotes de entrada (LE) e dos lotes de apara (AP) |

Na primeira vez, **Criar as classes padrão** cadastra três classes: A (limpo e seco, desconto de 2%), B (sujeira leve, 8%) e C (sujo ou úmido, 15%). Ajuste os percentuais depois.

### 1.2 Materiais

Cadastre cada tipo de material que entra na recuperadora. Para cada um, informe:

- o código;
- o nome;
- o polímero (PEBD, PEAD, PELBD, PP, BOPP, PET, PS, PVC, misto ou outro);
- a cor e a condição (limpo, sujo, impresso ou misto);
- o **NCM**, que sai na relação para a nota de entrada;
- o produto do Kardex, se a compra deve entrar no estoque.

Quando um material deixa de ser usado, marque-o como inativo. Os tickets antigos continuam com ele.

### 1.3 Classes e preços

A **classe** diz quanto o material está limpo e traz o **desconto padrão**: o percentual de umidade e impureza que sai do peso antes de pagar. No ticket, o desconto pode ser mudado item a item.

A **tabela de preços** guarda o R$/kg de cada material, com data de vigência:

- o preço de uma classe vence o preço geral do material (marcado "todas");
- para mudar o preço, lance uma nova vigência. O histórico fica guardado e os tickets já fechados não mudam;
- uma vigência futura aparece marcada "futuro" e passa a valer na data.

![Figura 2 — Classes de qualidade com o desconto padrão e a tabela de preços por vigência](img/recuperadora-2.jpg)

### 1.4 Regras da apara interna

Uma regra diz para qual material vai a apara de um setor, de uma máquina ou de um motivo de refugo. Se mais de uma regra vale para o mesmo apontamento, vence a mais específica: a da máquina vence a do motivo, que vence a do setor.

Escolha **não vai para a recuperadora** para o refugo que não volta para o processo, como o do próprio aglutinador ou a borra. **Refazer as aparas desde…** aplica as regras de novo aos apontamentos já encerrados a partir de uma data.

## 2. Painel da Recuperadora

O **Painel da Recuperadora** (REC001) mostra o mês escolhido:

- **Material comprado:** kg pesados nos tickets fechados;
- **Peso pago:** kg depois do desconto, com o desconto médio;
- **Valor das compras:** com o preço médio por kg pago;
- **Apara interna recebida:** kg vindos dos apontamentos da produção;
- **Tickets abertos;**
- **A pagar a fornecedores:** títulos em aberto das compras, com o saldo de adiantamentos.

Abaixo vêm o gráfico das entradas por dia, a tabela **por material** (comprado, valor, apara e saldo em lotes) e a tabela **fornecedores do mês** (peso, desconto, R$/kg pago e valor).

Um aviso amarelo aparece quando há apontamentos com refugo que não viraram lote. Isso acontece quando falta o material padrão da apara ou uma regra.

![Figura 3 — Painel da Recuperadora: compras, peso pago, apara interna, entradas por dia, materiais e fornecedores do mês](img/recuperadora-3.jpg)

## 3. Entradas e Balança: o ticket de pesagem

Em **Entradas e Balança** (REC002), a aba **Tickets da balança** lista as pesagens do período. Dá para filtrar pela situação (aberto, fechado, cancelado) e buscar pelo número, fornecedor, placa ou motorista. A marca **sem nota** aponta a compra fechada sem nota do fornecedor, que entra na relação para a nota de entrada (seção 4.3).

O operador da balança (perfil Produção) usa esta tela e a de Lotes da Recuperadora. Administrador, financeiro e diretor também.

![Figura 4 — Entradas e Balança: os tickets do mês, abertos e fechados, com o peso pago e o total](img/recuperadora-4.jpg)

### 3.1 Abrir o ticket

**+ Novo ticket** abre a ficha com estes campos:

- data e hora;
- **origem:** compra, doação ou transferência. No modo "só aparas internas" não há compra;
- fornecedor (obrigatório na compra), placa e motorista;
- **peso bruto** e **tara**. O botão ⚖ lê o peso direto da balança no Chrome ou no Edge do computador ligado a ela; nos outros aparelhos, o peso é digitado;
- **peso líquido**, calculado como bruto − tara. Sem balança de veículo, informe só o líquido;
- **frete pago à parte:** entra no custo dos lotes, dividido pelo peso.

### 3.2 Materiais, classe, desconto e preço

Uma carga pode ter vários materiais. Em cada linha, informe:

- o material e a classe;
- o **peso**;
- o **desconto %**. Vazio, vale o desconto padrão da classe, que aparece em cinza no campo;
- o **R$/kg**. Vazio, vale o preço da tabela na data da pesagem; "sem preço" quando o material não tem preço cadastrado.

O resumo abaixo da tabela confere a **soma dos materiais** contra o peso líquido. Verde está dentro da tolerância; vermelho mostra a diferença. O resumo também traz o **peso pago**, o **total da compra** e, se o fornecedor tiver adiantamento em aberto, quanto vai ser abatido e quanto fica a pagar.

![Figura 5 — Ticket aberto: pesagem, materiais com classe, desconto e preço da tabela, a conferência do peso e o adiantamento a abater](img/recuperadora-5.jpg)

**Salvar aberto** guarda o ticket para terminar depois. Um caso comum: a carga é descarregada e separada antes de pesar cada material.

### 3.3 Fechar o ticket

**Fechar ticket** confere tudo de novo no banco e, se estiver certo, faz cinco coisas:

1. Cria um **lote de entrada** por material, com o peso pago, o custo (valor mais o frete rateado) e o código LE + número do ticket + sequência (ex.: LE123-1).
2. Abate o **adiantamento** em aberto do fornecedor, se a opção estiver ligada, começando pelos mais antigos.
3. Gera o **título a pagar** do que sobrou, na conta e no prazo dos parâmetros, com o documento "REC" + número do ticket. Ele aparece nos Lançamentos e na Autorização de Pagamentos como qualquer conta a pagar.
4. Lança a entrada no **Kardex**, se a opção estiver ligada e o material tiver produto.
5. Trava o ticket: depois de fechado, só a nota e as fotos mudam.

O fechamento não acontece quando:

- falta o fornecedor da compra;
- a soma dos materiais passa da tolerância;
- falta a foto exigida;
- o desconto passa do máximo e quem fecha não é administrador, financeiro ou diretor.

### 3.4 Cancelar ou excluir

- **Ticket aberto:** pode ser excluído (some da lista) ou cancelado (fica guardado como cancelado, com o motivo).
- **Ticket fechado:** só administrador, financeiro ou diretor cancela, e só se os lotes ainda não foram usados no processamento e o título não foi pago. O cancelamento desfaz os lotes, o título em aberto, o abatimento do adiantamento e a entrada no Kardex.

### 3.5 Comprovante, fotos e nota

- **Comprovante:** imprime a pesagem com materiais, descontos, preços, total, abatimento e espaço para as assinaturas do fornecedor e do recebimento.
- **+ Foto:** anexa fotos da carga, tiradas pela câmera do celular ou escolhidas no computador. Ficam guardadas por empresa, com até 8 MB cada.
- **Salvar a nota:** no ticket fechado, informa o número e a chave da NF-e do fornecedor, ou da nota de entrada emitida pela empresa. Com a nota, o ticket sai da relação da seção 4.3.

### 3.6 Importar a planilha da balança

Se a balança tem sistema próprio, use **Importar planilha da balança** com o Excel ou CSV exportado por ele. A plataforma reconhece as colunas pelo nome e você confere antes de importar. As colunas aceitas são:

- data e hora, número do ticket na balança, placa e motorista;
- fornecedor, pelo CPF/CNPJ ou pelo nome;
- peso bruto, tara e peso líquido;
- material e classe;
- observação.

Cada linha vira um ticket **aberto** para conferir e fechar. A mesma linha não entra duas vezes. Linhas com fornecedor ou material não cadastrado voltam na lista de erros.

## 4. Fornecedores, adiantamentos e relação para a nota

### 4.1 Fornecedores de reciclável

Na aba **Fornecedores e adiantamentos**, **Classificar fornecedor** marca um beneficiário do cadastro como fornecedor de reciclável. Os tipos são:

- catador (pessoa física);
- cooperativa de catadores;
- associação de catadores;
- sucateiro ou aparista (empresa);
- indústria (apara de terceiros);
- outro.

Na mesma tela ficam a **chave PIX** e a marca de **coletor incentivado**.

**Coletor incentivado** é a pessoa física que coleta ou faz a triagem de resíduos e a associação ou cooperativa de catadores (Lei Complementar 214/2025, art. 170). A marca é sugerida pelo tipo. A compra de um coletor incentivado gera crédito presumido de IBS e CBS para a empresa do regime regular. A apuração desse crédito chega na parte 3 da Recuperadora.

A tabela mostra o comprado nos últimos 90 dias e o adiantamento em aberto de cada fornecedor.

![Figura 6 — Fornecedores de reciclável com o tipo, o coletor incentivado e os adiantamentos](img/recuperadora-6.jpg)

### 4.2 Adiantamentos

**+ Adiantamento** registra o vale ou adiantamento dado ao fornecedor, uma prática comum com catadores e sucateiros, e gera o título a pagar na conta dos parâmetros. Ao fechar o próximo ticket do fornecedor, o saldo abate a compra.

O adiantamento fica **quitado** quando o saldo zera. O cancelamento só vale para adiantamento que ainda não abateu nenhuma compra e não foi pago.

### 4.3 Relação para a nota de entrada

A aba **Relação para a nota de entrada** junta as compras fechadas sem nota do fornecedor no período, por fornecedor e material. A relação traz:

- CPF/CNPJ do fornecedor;
- tipo e a marca de coletor incentivado;
- NCM;
- números dos tickets;
- peso pago, R$/kg médio e valor.

**Excel** baixa a relação para emitir a nota de entrada no sistema fiscal.

![Figura 7 — Relação para a nota de entrada: compras sem nota por fornecedor e material, com o NCM](img/recuperadora-7.jpg)

## 5. Lotes e etiquetas

**Lotes da Recuperadora** (REC003) lista os lotes de entrada (da balança), os de apara interna e, na parte 2, os de grão. Para cada lote, a tabela mostra:

- material e classe;
- origem (fornecedor ou "apontamentos da produção");
- data;
- peso, saldo e R$/kg;
- situação: disponível, em processo, consumido, bloqueado, vendido ou cancelado.

O lote **bloqueado** não entra no processamento até ser liberado. Ao clicar num lote, você vê a origem, que pode ser o ticket com o desconto e o preço, ou a quantidade de apontamentos. Na mesma ficha dá para bloquear, liberar e anotar uma observação.

**Etiqueta** imprime a etiqueta de 100 × 70 mm com o código do lote em QR. Para imprimir várias, marque os lotes na lista e use **Etiquetas dos marcados**.

![Figura 8 — Lotes da Recuperadora: entradas da balança e aparas internas, com o saldo e o custo por kg](img/recuperadora-8.jpg)

## 6. Aparas internas

Nos modos "só aparas internas" e "aparas internas e compra de terceiros", cada apontamento encerrado com refugo no Terminal do Setor ou na importação do Iniflex manda o kg para um **lote de apara do dia**. O código do lote é AP + data + material, por exemplo AP-261106-AP-PEBD.

O material sai das regras da seção 1.4 ou do material padrão. O lote acompanha o apontamento:

- alterar o refugo, o motivo, a máquina ou o setor refaz a entrada;
- excluir o apontamento tira o kg do lote.

Quando o módulo é ligado depois, ou as regras mudam, use **Refazer as aparas desde…** nos Parâmetros.

## 7. Quem pode o quê

| Ação | Quem |
|---|---|
| Ver painel, tickets e lotes | Administrador, financeiro, diretor, leitura e produção |
| Abrir, editar, fechar e excluir ticket aberto; fotos; nota; importar planilha | Administrador, financeiro, diretor e produção |
| Fechar ticket com desconto acima do máximo | Administrador, financeiro e diretor |
| Cancelar ticket fechado; adiantamentos; classificar fornecedor | Administrador, financeiro e diretor |
| Bloquear e liberar lote | Administrador, financeiro e diretor |
| Parâmetros, materiais, classes, preços e regras da apara | Administrador, financeiro e diretor |

## 8. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 09/11/2026 | Primeira versão (Recuperadora, parte 1). Inclui modo do módulo, materiais, classes, preços por vigência, ticket da balança com leitura direta, fechamento com lotes, título a pagar e abatimento do adiantamento, cancelamento, comprovante, fotos, nota, importação da planilha da balança, fornecedores e coletor incentivado, adiantamentos, relação para a nota de entrada, lotes com etiqueta e aparas internas automáticas. |

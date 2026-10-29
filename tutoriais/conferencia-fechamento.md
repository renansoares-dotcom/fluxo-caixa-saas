---
titulo: Conferência do dia e Fechamento do mês
tela: Financeiro › Conferência do dia e Fechamento do mês
versao: 1.0
atualizado: 2026-10-28
---
## 1. Para que serve

As duas telas ajudam a deixar o caixa certo todos os dias e a fechar o mês com segurança:

- **Conferência do dia**: um mapa do mês com **uma linha por conta e uma coluna por dia**. Cada quadradinho diz se o dia bate com o extrato do banco. Clicando, você confere o dia e dá o **visto**.
- **Fechamento do mês**: um checklist que confere sozinho cada etapa do fechamento, o resumo do mês para a direção e a **trava** de cada conta.

Nenhuma das duas altera lançamentos. As correções são feitas nas telas de sempre (Lançamentos e Conciliação).

## 2. Quem tem acesso

| Perfil | O que faz |
|---|---|
| Administrador e financeiro | Dão e desfazem o visto na Conferência do dia. |
| Administrador | Fecha e destrava as contas no Fechamento do mês. |
| Diretor e leitura | Consultam e imprimem. |

## 3. Conferência do dia

### 3.1 O mapa do mês

Escolha o **mês** no topo. As cores de cada quadradinho:

- **Verde**: o saldo e o movimento do dia batem com o extrato.
- **Vermelho**: diverge. O primeiro dia mostra a diferença; os dias seguintes mostram "…" enquanto a mesma diferença continuar.
- **Amarelo**: algo para olhar.
- **Amarelo tracejado**: falta extrato. A conta tem movimento no dia, mas o extrato não foi importado.

**"Bate"** quer dizer que o movimento do dia e o saldo no fim do dia são iguais aos do extrato importado (OFX do banco ou relatório do ERP) e que não há linha pendente no extrato.

O que deixa um dia **amarelo**:

- **Possível duplicidade**: lançamentos iguais (mesmo valor, favorecido e descrição) até 3 dias de distância, ou o mesmo título do Iniflex lançado duas vezes.
- **Classificação suspeita**: por exemplo, um título de venda lançado como saída, ou uma nota de compra lançada como entrada.
- **Transferência sem a outra ponta** em outra conta.
- **Adiantamento sem favorecido**: ele não aparece no conta-corrente do fornecedor.

Os indicadores mostram quantos dias **divergem**, quantos têm **falta extrato**, quantos estão **para olhar** e quantos lançamentos estão **pagos sem conta** no mês.

### 3.2 Conferir um dia

1. Clique no quadradinho. Abre o dia da conta com os **lançamentos no sistema** e o **extrato** lado a lado, e o saldo inicial, as entradas, as saídas, o saldo final da plataforma e o saldo no banco.
2. Corrija o que for preciso, nas telas de Lançamentos ou de Conciliação.
3. Dê o **visto**:
   - **Dia que bate**: o visto é direto.
   - **Dia sem extrato** (caixa, cofre…): informe o **saldo real do dia**, pelo extrato em papel ou pela contagem do caixa. Se o saldo for diferente do da plataforma, a plataforma pergunta se você quer registrar mesmo assim; o dia fica vermelho até ser corrigido.
   - **Dia com pendência**: escreva a explicação na observação antes de dar o visto.
4. Use **‹ dia / dia ›** e **↑ conta / ↓ conta** para andar pelo mapa sem fechar a janela.

**Dar visto nos dias que batem** registra o visto de uma vez em todos os dias sem nenhuma diferença nem aviso. Fica registrado quem conferiu e quando, e cada visto pode ser desfeito no detalhe do dia (**Desfazer visto**).

### 3.3 Saldos da conta

A aba **Saldos da conta** mostra uma linha por dia de uma conta: saldo inicial, entradas, saídas, saldo final da plataforma, saldo no banco, **diferença** (banco menos plataforma) e situação. Isso ajuda a achar em que dia uma diferença começou.

**Imprimir / PDF** gera a tela no padrão IPLAMM.

## 4. Fechamento do mês

### 4.1 O checklist

Escolha o **mês**. Cada etapa é conferida sozinha:

1. **Extratos bancários conciliados**.
2. **Lançamentos pagos com conta bancária**: nenhum lançamento pago sem conta.
3. **Nada em aberto vencido** até o fim do mês.
4. **Notas de venda do mês ligadas ao financeiro**.
5. **Borderôs FIDC do mês aprovados**.
6. **Desvios do orçamento justificados**.

Verde quer dizer pronto; vermelho, falta resolver. O botão **Revisar e resolver** leva à tela certa. Enquanto houver etapa pendente, os números do resumo ainda podem mudar.

### 4.2 O resumo para a direção

O topo mostra a receita bruta realizada, o **EBITDA gerencial**, o resultado gerencial e o **saldo disponível** no fim do mês. Embaixo ficam os saldos de cada conta. **Imprimir / PDF** gera o relatório.

### 4.3 Fechar e travar as contas

Na tabela **Contas: conciliação e trava**, cada conta mostra o saldo, o movimento no extrato, o movimento no sistema e a situação. **Batendo** quer dizer: extrato importado até o fim do mês, nenhum movimento pendente e o movimento do extrato igual ao do sistema.

- **Conta com extrato**: clique em **Fechar / travar** e escolha até que dia a conta está fechada.
- **Conta sem extrato** (caixa, cofre…): use **Fechar com saldo informado**. Informe o saldo conferido na data; se ele bater com o da plataforma, a conta é travada.
- **Destravar**: libera de novo os lançamentos até a data. Fica registrado quem destravou e quando.

Cada conta pode ser fechada numa data diferente.

## 5. Regras e travas

- **Conta travada**: os lançamentos pagos dela até a data da trava não podem mudar data, valor, conta ou situação, nem ser incluídos ou excluídos. A classificação, a descrição e o centro de custo continuam livres.
- Só o **administrador** fecha e destrava as contas.
- **Caixa Carteira** (dinheiro em espécie) nunca pode terminar o dia negativa. As demais contas batem pelo extrato ou pelo visto.
- O visto não muda nenhum lançamento: só registra que o dia foi conferido, por quem e quando.

## 6. Perguntas frequentes e erros comuns

**O dia está vermelho, mas tudo parece certo.** Veja se a diferença vem de um dia anterior (mostrado como "…"). Abra **Saldos da conta** e procure o dia em que a diferença começa.

**Falta extrato num dia em que o banco não teve movimento.** Importe o extrato do período inteiro. Se a conta não tem extrato (caixa), informe o saldo real do dia para dar o visto.

**Não consigo alterar um lançamento antigo.** A conta está travada até aquela data. Peça ao administrador para destravar, corrija e trave de novo.

**A etapa "Notas de venda ligadas ao financeiro" está vermelha.** Abra Notas Fiscais e ligue as notas aos títulos, ou importe os XML em Lançamentos.

## 7. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: mapa do mês, visto por dia e em lote, saldos da conta, checklist do fechamento, resumo para a direção e trava por conta. |

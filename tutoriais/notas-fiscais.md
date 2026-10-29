---
titulo: Notas fiscais e apuração de impostos
tela: CPD › Notas Fiscais e Apuração de impostos
versao: 1.0
atualizado: 2026-10-28
---
## 1. Para que serve

- **Notas Fiscais**: importa os **XML das NF-e**, de entrada e de saída, com os itens, os impostos, as parcelas e os eventos. A tela também:
  - consulta as notas por período;
  - soma os impostos por CFOP;
  - liga as parcelas das notas aos recebimentos e pagamentos que já existem nos lançamentos;
  - liga os títulos dos borderôs FIDC às notas.
- **Apuração de impostos**: a memória de cálculo a partir dos itens das notas, com o livro por CFOP/CST e o resumo dos impostos destacados. Por enquanto é **só leitura e só prévia**.

## 2. Quem tem acesso

O administrador e o financeiro importam, ligam e desfazem. Quem tem a área CPD consulta.

## 3. Importar os XML

1. Clique em **Importar XML**.
2. Selecione a **pasta do mês** (por exemplo, "1.7 NF-e Saídas (XML)"), os arquivos XML ou um .zip.
3. A plataforma reconhece pelo próprio XML se a nota é de entrada ou de saída e mostra:
   - as notas novas, o valor das saídas e o das entradas;
   - as notas já importadas, que são ignoradas;
   - os eventos: cancelamento e carta de correção, que são aplicados.
4. Clique em **Importar**. Os lançamentos **não** são alterados.

Depois da importação, a plataforma oferece **conferir o cadastro** dos clientes e fornecedores dessas notas. Os cadastros novos e as diferenças aparecem para aprovação campo a campo; nada muda sem marcar. Use **Aprovar todas** ou **Só completar campos vazios**.

## 4. Consultar as notas

Use os filtros: o período (**Filtrar por** emissão ou vencimento, **até**), o **tipo** (entrada ou saída), o **financeiro** e a busca. As opções do filtro de financeiro são:

- vencidas sem nada ligado;
- sem nada ligado;
- recebidas em parte;
- com título a receber;
- antecipadas no FIDC;
- recebidas.

Os indicadores mostram as notas no período, os impostos (ICMS, IPI, PIS, COFINS, IBS e CBS), as parcelas vencendo, as que têm recebimento vinculado e as que estão em borderô FIDC.

Clique na nota para ver os **itens**, os impostos e as **parcelas, borderôs e recebimentos vinculados**. Na nota, os botões são:

- **Baixar XML**.
- **Usar crédito**: abate um crédito ou adiantamento do cliente ou fornecedor.
- **Marcar como cancelada**: a nota sai do faturamento, dos impostos e das contas a receber. O XML continua guardado e dá para desfazer.
- **Desfazer vínculos de recebimento** e **Desfazer ligação com borderô**.

## 5. As abas

### 5.1 Impostos por CFOP

Os valores das notas autorizadas no período (as canceladas ficam fora), por CFOP. É a base para a apuração.

### 5.2 Recebimentos × Notas (ou Pagamentos × Notas)

Liga cada parcela da nota ao lançamento de recebimento (nas saídas) ou de pagamento (nas entradas) que já existe, no mesmo modelo da Conciliação bancária:

1. Marque a parcela à esquerda. Os recebimentos mais prováveis (mesma NF citada, mesmo cliente, valor e data próximos) sobem para o topo.
2. Marque o recebimento à direita. Quando os totais batem, as linhas ficam verdes.
3. Clique em **Vincular**, ou em **Aceitar sugestões** para fazer em lote.

**Lançar contas a receber das notas** cria um título **Em aberto** (receita 1.01.01, com a data do vencimento e o documento NF-parcela) para cada parcela de venda que ainda não tem lançamento, já ligado à nota. Parcelas que já têm um lançamento da mesma NF e valor só são ligadas a ele.

### 5.3 Borderôs FIDC

Liga cada título dos borderôs (base FIDC) à parcela da nota de onde ele veio. Os casos verdes vêm marcados; os amarelos e vermelhos ficam para você conferir. Clique em **Ligar**.

Borderôs, títulos, lançamentos e notas não são alterados. A gestão dos borderôs fica em Propostas de borderô.

## 6. Apuração de impostos

1. Escolha o **mês** e a aba **Saídas** (notas emitidas) ou **Entradas** (compras e devoluções).
2. Escolha como **agrupar**: livro por CFOP / CST, resumo dos impostos, ou regras e parâmetros.
3. A tabela mostra o valor contábil, a base do ICMS, o ICMS, o ICMS-ST, o IPI, o PIS e o COFINS. **Exportar Excel** baixa a memória de cálculo.

> **Atenção:** os valores são a **soma do que está destacado nas notas**, ainda não o imposto a recolher. Faltam as regras de PRODEPE, FEEF, AD/DIPER, FECEP, os estornos e os créditos de PIS/COFINS pelas regras da empresa. Cada regra entra com fonte e vigência, conforme forem definidas com a contabilidade.

Nas notas de fornecedores, o CFOP e o CST são os do emitente.

## 7. Regras e travas

- Nota já importada (mesma chave) não entra de novo.
- Importar, ligar e desfazer vínculos nunca altera os lançamentos.
- Nota marcada como cancelada sai do faturamento, dos impostos e das contas a receber, mas o XML fica guardado.
- O cadastro de clientes e fornecedores só muda com a sua aprovação.

## 8. Perguntas frequentes e erros comuns

**Algumas notas foram ignoradas.** O resumo da importação diz o motivo: XML repetido, nota já importada ou arquivo que não é NF-e.

**A nota de venda não aparece nas contas a receber.** Use **Lançar contas a receber das notas** na aba Recebimentos × Notas, ou **Importar XML das NFs** em Lançamentos.

**No Fechamento do mês, "Notas de venda ligadas ao financeiro" está vermelho.** Ligue as parcelas aos recebimentos ou lance os títulos (item 5.2).

## 9. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: importação dos XML, conferência do cadastro, consulta, impostos por CFOP, recebimentos e pagamentos × notas, borderôs × notas e apuração (prévia). |

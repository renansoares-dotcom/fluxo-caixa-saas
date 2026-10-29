---
titulo: Autorização de pagamentos
tela: Financeiro › Autorização de pagamentos
versao: 1.0
atualizado: 2026-10-28
---
## 1. Para que serve

A **Autorização de pagamentos** monta a lista do que será pago e gera o **PDF para o diretor assinar**.

A lista mostra os títulos a pagar em aberto com a prioridade, o banco e o orçamento de cada um. Junto vêm o saldo em bancos e quanto sobra depois de pagar. Cada autorização recebe um número e fica no histórico, onde o diretor aprova ou rejeita.

## 2. Quem tem acesso

| Perfil | O que faz |
|---|---|
| Administrador e financeiro | Marcam os títulos e geram a autorização. |
| Administrador e diretor | Aprovam ou rejeitam as autorizações emitidas. |
| Leitura | Consulta. |

## 3. Passo a passo

### 3.1 Filtrar os títulos

Use os filtros: vencimento de / até, situação (vencidos ou a vencer), prioridade, banco, grupo, centro de custo e favorecido. Filtro em branco quer dizer todos.

Os indicadores mostram:

- o total em aberto;
- quanto é **obrigatório** e quanto é **negociável**;
- os vencidos;
- o **saldo em bancos** (contas com recursos disponíveis);
- o **saldo após pagar tudo**;
- o que está **acima do orçado**;
- o total **autorizado**.

### 3.2 Marcar o que será pago

- Use os atalhos **Marcar obrigatórios**, **Marcar vencidos**, **Marcar todos** e **Limpar**, ou marque um a um na coluna **Autoriza**.
- Para pagar só parte de um título, ajuste o **Valor autorizado**.
- Escreva uma **observação** quando precisar.

A **prioridade** (Obrigatório ou Negociável) vem da classificação do plano de contas (**Cadastros › Plano de contas**) ou do próprio lançamento.

### 3.3 Gerar a autorização

1. Confira o **Elaborado por**.
2. Clique em **Gerar autorização (PDF)**.
3. Se algum título marcado estiver numa conta **acima do orçado**, a plataforma pede a **justificativa de cada conta**. O pagamento não é bloqueado; a justificativa fica registrada no controle orçamentário e no PDF. Clique em **Continuar e gerar**.

O PDF sai no padrão IPLAMM, com:

- o nº da autorização;
- o total listado, o saldo em bancos, o total autorizado e o saldo após os pagamentos;
- a lista com SIM ou NÃO em cada título;
- os campos de assinatura do elaborador e do diretor.

### 3.4 Aprovar ou rejeitar

Em **Autorizações emitidas**, o diretor ou o administrador clica em **Aprovar** ou **Rejeitar** na autorização pendente. O botão **PDF** gera de novo o documento de qualquer autorização.

## 4. Regras e travas

- Só entram títulos **a pagar em aberto**.
- Pagamento acima do orçamento **não é bloqueado**, mas exige justificativa por conta.
- A autorização não baixa os títulos: depois de pagos, eles são baixados em Contas a pagar / receber ou pela Conciliação.

## 5. Perguntas frequentes e erros comuns

**A mensagem diz "Nenhum título listado".** Os filtros não trouxeram nada. Limpe os filtros.

**A mensagem diz "Escreva a justificativa de cada conta".** Há título marcado em conta acima do orçado. Preencha o motivo de cada conta da lista.

**O saldo em bancos parece baixo.** Só entram as contas marcadas como "Conta com recursos disponíveis" em **Cadastros › Contas bancárias**. Com filtro de banco, entra só o saldo dele.

## 6. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: filtros, marcação, valor parcial, justificativa de orçamento, PDF para assinatura e aprovação. |

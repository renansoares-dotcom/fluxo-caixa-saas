# Design System da plataforma IPLAMM

Regras de tela da plataforma. Valem para toda tela nova ou alterada, e o agente `design-sistema` (`.claude/agents/design-sistema.md`) audita por elas. Os valores vivem em `css/app.css` (variáveis em `:root`, com tema escuro em `[data-theme=dark]`).

## 1. Base
| Item | Valor |
|---|---|
| Fonte | Inter (tela). Relatórios de impressão em Times (`js/lib/relatorio.js`) |
| Tamanhos | 13–14 px no texto · 12,5 px nos rótulos · 11 px em trilha e selos · 20 px no título da tela |
| Cores da marca | `--brand-navy` #2a1f6f · `--brand-blue` #2b5598 · `--brand-cyan` #0a8ed3 |
| Semânticas | `--pos` (ok / recebido) · `--neg` (erro / vencido) · `--warn` (atenção) · `--primary-soft` (selecionado) |
| Cor por área | Financeiro azul · Comercial laranja · Compras roxo · Produção verde-petróleo · CPD turquesa · Contabilidade navy |
| Espaçamento | múltiplos de 4 px; 12 px entre campos; 16 px entre blocos; 20 px de margem da página |
| Cantos | 8 px (campos, botões) · 10 px (cartões) · 14 px (modais) |

## 2. Códigos de tela
Toda tela tem um código fixo, como no Iniflex, registrado em `js/lib/telas.js`: **3 letras da área + 3 dígitos**. Exemplos: `FIN014` Carteira Cedida, `CAD003` Beneficiários.
- O código aparece ao lado do título da tela e no menu, e a busca (Ctrl K) encontra a tela pelo código.
- O código **nunca muda** e não é reaproveitado. Uma tela nova pega o próximo número livre da área.
- **Nome oficial da tela = nome do menu.** O título do topo e o da aba do navegador vêm do item do menu (`js/app.js` lê o `data-nome`); `export const title` de cada tela fica igual a ele (teste em `tests/telas.test.js`). Nos manuais, a tela aparece com o nome do menu e, no cabeçalho, com o código: "Carteira Cedida (FIN019)".

| Prefixo | Área |
|---|---|
| PAI | Painéis |
| FIN | Financeiro |
| COM | Comercial |
| CMP | Compras |
| EST | Estoque |
| PRD | Produção |
| LOG | Logística |
| RHT | RH / Trabalhista |
| FIS | CPD › Fiscal |
| CTB | Contabilidade |
| CAD | Cadastros |
| AJU | Ajuda e Comunicação |

## 3. Menu lateral
- Áreas em acordeão: abre uma área por vez, a da tela atual abre sozinha, e dentro dela um grupo por vez.
- Cada área tem ícone e cor. Cada item mostra o código da tela, em cinza.
- Topo do menu: **busca no menu** (nome ou código), **Favoritos** (estrela em cada item) e **Recentes** (últimas 5 telas).
- Botão **recolher**: o menu fica só com os ícones (64 px) e abre por cima do conteúdo ao passar o mouse. A escolha fica salva.
- Grafia: palavras principais com maiúscula, conectivos em minúscula (de, do, da, dos, das, e, x, a, o, em, por, para).
- No celular: gaveta por cima do conteúdo, que fecha ao navegar, no fundo escuro ou no Esc.

## 4. Formulários
Use `<fieldset><legend>Seção</legend><div class="grid-form">…</div></fieldset>`. A grade se ajusta à **largura do container**, e não da janela:

| Largura do container | Colunas | Campo padrão | `xs` | `c4` (⅓) | `span2` | `c8` (⅔) | `full` |
|---|---|---|---|---|---|---|---|
| ≥ 820 px | 12 | 3 (4 por linha) | 2 | 4 | 6 | 8 | 12 |
| 520–819 px | 12 | 4 (3 por linha) | 3 | 4 | 8 | 8 | 12 |
| < 520 px | 1 | inteiro | inteiro | inteiro | inteiro | inteiro | inteiro |

- **`xs`** é para campo curto: UF, número, CEP, DDD, quantidade, %, datas e valores curtos. A grade já aplica sozinha a UF (`maxlength=2`), o número, o CEP e as caixas de seleção.
- **`span2`** é para texto médio: razão social, logradouro, plano de contas. **`full`** é para observação e texto longo.
- Obrigatório: `*` no rótulo e `required` no campo.
- Nenhuma linha deve ficar com mais de um terço vazio. Reordene os campos ou ajuste o tamanho. Texto livre que sobra sozinho na última linha (Observação) usa `full`.
- Ações no rodapé do modal: destrutiva à esquerda (`danger`), Cancelar e principal (`primary`) à direita.
- Tamanho do modal pelo número de campos: até 2 a 4 campos simples, `modal({ narrow: true })` (480 px, uma coluna); o padrão (760 px, 3 por linha) para formulários médios; `wide: true` (1100 px, 4 por linha) a partir de 7 ou 8 campos. `crud.js` já escolhe sozinho o pequeno (até 2 campos) e aceita `largo: true` e `cls` por campo.
- Caixa de seleção com texto longo (ex.: "Atende cliente que só recebe veículo pequeno") usa `class="chk span2"` (ou `full`); sem isso a grade a deixa do tamanho `xs`.
- Ficha só de leitura em modal largo (rótulo + valor, como a ficha do cliente): `grid-form dados5`, 5 dados por linha, para 9 ou 5 itens não sobrar um sozinho. Dado curto (data, situação, código) usa `xs`.
- Linha de inclusão dentro do modal (componente, consumo, contato): campo principal `c4`, números `xs` e o botão num `div.xs` alinhado embaixo, tudo na mesma linha.

## 5. Tabelas e listas
- Números à direita com `class="num"`, moeda com `money()` e datas com `dateBR()`.
- Coluna vazia em mais de 80 % das linhas: esconda ou mostre só ao filtrar (ex.: Prioridade só na aba A pagar).
- Lista longa: `.table-wrap` com cabeçalho fixo. Linha clicável: `class="clickable"`.
- **Nada rola para o lado em 1366.** Colunas secundárias (dias, conta, centro de custo, data, pagamento, recebido, emissão, NF / parcela, situação) vão para a 2ª linha da célula principal com `<div class="small muted">`, e o rótulo para a 2ª linha do cabeçalho com `<th>Plano de contas<div class="small">Conta</div></th>`. Texto que pode quebrar: `td.wrap` (descrição, 220 px) ou `td.wrap-m` (nome, plano de contas, 150 px). Vale para listas e para tabela em painel lado a lado (Propostas de Borderô).
- Toolbar: filtros à esquerda, ações à direita (Excel, Gerar relatório, ação principal por último).

### Seletor "Colunas" (`js/lib/colunas.js`)
Botão **Colunas** que abre uma lista de caixas para mostrar ou ocultar colunas, com **Restaurar padrão**. A escolha fica guardada por usuário e por tela no `localStorage` (com `try/catch`). Usado em Contas a Pagar / Receber, Lançamentos, Pedidos de Compra e Representantes e Metas (meses da meta, com atalhos 1º semestre, 2º semestre e Ano todo).

```js
import { seletorColunas } from '../lib/colunas.js';
const COLUNAS = [{ id: 'plano', nome: 'Plano de contas' }, { id: 'cc', nome: 'C. Custo', sub: true }, { id: 'obs', nome: 'Observação', padrao: false }];
// no HTML: um contêiner com data-colunas="<tela>"; cada célula ou 2ª linha que pode sumir leva data-col="<id>"
root.innerHTML = `…<div class="toolbar" id="tb">…<span class="spacer"></span></div><div class="table-wrap" data-colunas="lancamentos">
  <table><tr><th data-col="plano">Plano de contas<div class="small" data-col="cc">C. Custo</div></th>…`;
$('#tb', root).append(seletorColunas({ tela: 'lancamentos', colunas: COLUNAS }).botao);
```

- `id`: o mesmo do `data-col`. `padrao: false` deixa a coluna oculta até o usuário marcar. `sub: true` aparece recuada na lista (é a 2ª linha da coluna anterior).
- Opções: `rotulo` e `titulo` (ex.: "Meses" / "Mostrar meses"), `classe` do botão (padrão `btn small`, o da toolbar da tabela), `atalhos: [{ nome, colunas: [ids] }]`.
- A regra de ocultar vai num `<style>` da tela, então a tabela pode ser redesenhada (filtro, página, aba) sem chamar nada.
- Lugar do botão: na toolbar da tabela, à direita (ou ao lado do Excel no cabeçalho da tela, quando a tela não tem toolbar própria).
- **O Excel exporta todas as colunas**, mesmo as ocultas: monte a planilha pelos dados (`exportXLSX([[cabeçalho], ...linhas])`), não pela tabela da tela.
- Coluna só oculta cabe na regra dos 80 %; não use o seletor para esconder um problema de largura: primeiro a 2ª linha da célula.

### Celular
Tabela mais larga que a tela rola para o lado e **esmaece a borda** onde há mais colunas (`.table-wrap.rola-dir` / `.rola-esq`, marcadas por `js/app.js`; CSS só até 900 px). Não precisa fazer nada na tela.

## 6. Relatórios
Sempre por `abrirRelatorio()` de `js/lib/relatorio.js`. O padrão é o de Fretes e CIOT: Times, logo, título em maiúsculas, seções numeradas, filetes pretos e rodapé com a base dos dados.

## 7. Responsivo
Teste em 1366, 1920 e 390 px. Nada pode estourar a largura, e os alvos de toque têm no mínimo 40 px no celular.
- No celular (até 600 px), o título da tela desce para a 2ª linha do topo, e o cabeçalho de tela (`.mm-topo`) empilha o título e, embaixo, as ações. Não ponha largura fixa no título.

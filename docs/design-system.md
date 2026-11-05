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

## 5. Tabelas e listas
- Números à direita com `class="num"`, moeda com `money()` e datas com `dateBR()`.
- Coluna vazia em mais de 80 % das linhas: esconda ou mostre só ao filtrar.
- Lista longa: `.table-wrap` com cabeçalho fixo. Linha clicável: `class="clickable"`.
- Tabela em painel lado a lado (lista + painel, como em Propostas de Borderô): a coluna de valor tem de caber sem rolagem em 1366. Colunas secundárias (emissão, NF / parcela, situação) vão para a 2ª linha da célula principal com `<div class="small muted">`, e o rótulo para a 2ª linha do cabeçalho com `<div class="small">`.
- Toolbar: filtros à esquerda, ações à direita (Excel, Gerar relatório, ação principal por último).

## 6. Relatórios
Sempre por `abrirRelatorio()` de `js/lib/relatorio.js`. O padrão é o de Fretes e CIOT: Times, logo, título em maiúsculas, seções numeradas, filetes pretos e rodapé com a base dos dados.

## 7. Responsivo
Teste em 1366, 1920 e 390 px. Nada pode estourar a largura, e os alvos de toque têm no mínimo 40 px no celular.
- No celular (até 600 px), o título da tela desce para a 2ª linha do topo, e o cabeçalho de tela (`.mm-topo`) empilha o título e, embaixo, as ações. Não ponha largura fixa no título.

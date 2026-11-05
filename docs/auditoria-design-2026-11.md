# Auditoria de design: novembro de 2026

**Resumo.** Auditei as **72 telas** em 1366 × 768. Abri o formulário principal (modal de novo registro) das **20 telas** que têm botão "Novo". Em 390 × 844 (celular) conferi **25 telas principais** e **12 formulários**. O tema escuro foi conferido por amostra (Fretes e CIOT em 1366 e Pagamentos Antecipados em 390). Achei **31 problemas**: **4 de severidade alta**, **16 média** e **11 baixa**. Na rodada 1 corrigi **12**: as 4 altas e 8 médias, entre elas os 5 formulários pedidos. Na **rodada 2 (05/11/2026)** corrigi os outros **18** (8 médias e 10 baixas) e mais **7** achados nos modais de edição; fica só 1 item marcado como aceitável (CAD003).

- Ambiente: cópia com banco **simulado** e dados **fictícios** (`scripts/prints/montar.sh`, `seed.js`). Nenhum dado real.
- Prints em `/tmp/aud/`: `antes-1366-<rota>.png`, `antes-1366-<rota>-modal.png`, `depois-1366-<rota>(-form).png`, `cel-390-<rota>.png` (celular antes) e `celdepois-390-<rota>.png` (celular depois). Folhas de contato em `/tmp/aud/folhas/`.
- Medições automáticas em `/tmp/aud/*.json`: estouro horizontal da página, tabelas cortadas e linhas de formulário com mais de um terço vazio.
- `npm run verificar`: 77 de 77 testes passaram.

## Severidade alta

| Código | Tela | Problema | Correção | Status |
|---|---|---|---|---|
| Global (`grid-form`) | Todos os formulários em modal largo (CAD003, EST003, CMP002, CMP003, EST002, EST005, FIN004, FIN017, LOG002, PRD004, CAD006) | Havia um `}` sobrando no `css/app.css`, no bloco "Formulários v2", e por causa dele o navegador **descartava o bloco `@container (min-width:820px)` inteiro**. A grade de 4 campos por linha nunca valia: os modais de 1100 px ficavam com 3 campos por linha, com UF, CEP e números ocupando ⅓ da linha e linhas até 76 % vazias. Até o modelo (Beneficiários) estava assim. | Tirei a chave sobrando. A grade de 12 colunas passa a valer como está em `docs/design-system.md` › 4. | Corrigido |
| Global (celular) | As 72 telas em 390 px | No topo, o título da tela era espremido até sumir e o selo do código ficava **por cima do botão de busca**. | Com até 600 px, o título desce para a 2ª linha do topo, em largura inteira, e a trilha fica oculta. Só CSS. | Corrigido |
| FIN018 | Propostas de Borderô | Em 1366, a tabela "Títulos disponíveis" **cortava NF / parcela e Valor** (era preciso rolar para o lado). No painel da proposta, a "Comparação entre fundos" cortava Taxa efetiva e Dif. vs. + barato. | A tabela passou a ter 5 colunas: emissão fica na 2ª linha do vencimento e NF / parcela na 2ª linha do cliente (padrão `div.small.muted`). Divisão 5 : 6 entre a lista e o painel. Na comparação, os cabeçalhos quebram linha e o nome do fundo também. Com os valores fictícios, tudo cabe sem rolagem em 1366. Valores reais muito grandes ainda podem pedir alguns pixels de rolagem. | Corrigido |
| FIN020 | Duplicatas para Endosso | Mesmo caso da FIN018: em 1366, **Valor e Situação ficavam fora da área visível**. | NF / parcela e situação vão para a 2ª linha do cliente. A tabela ficou com 4 colunas e cabe inteira. | Corrigido |

## Severidade média

| Código | Tela | Problema | Correção | Status |
|---|---|---|---|---|
| FIN008 | Pagamentos Antecipados (modal Novo) | Usava `grid2` (2 colunas): valor, datas, agência e conta ocupavam meia linha, "Conta" ficava sozinha (50 % vazio) e não havia seções. | Três `fieldset` (Quem recebe, O pagamento, Classificação) com `grid-form`. Valor, datas, prioridade, nota, agência e conta em `xs`; razão social, descrição e plano em `span2`; chave Pix e anexo em `c4`. Todas as linhas cheias (0 a 8 % vazio). A ordem do Tab segue a de leitura. | Corrigido |
| EST003 | Produtos (modal Novo produto) | Sete linhas com mais de ⅓ vazio (até 67 %), seções em `h3` e o rótulo "Fator (1 un. de compra = ? un.)" quebrava em duas linhas. | Quatro `fieldset`. Unidade, NCM, densidade, largura, espessura e os 6 campos de estoque em `xs`; família, grupo e subgrupo em `c4`; solda em `c8`. O rótulo passou a "Fator de compra", com a explicação numa linha abaixo. | Corrigido. **Atualizar o manual** |
| CMP003 | Pedidos de Compra (modal Novo pedido) | "Observação" ficava sozinha numa linha. O aviso "obrigatória para aprovar" quebrava o rótulo e desalinhava o campo de classificação. | `fieldset` Pedido e Itens. Datas, nº do Iniflex, frete e desconto em `xs`; centro de custo e observação em `c4`. O aviso fica na mesma linha do rótulo. Três linhas de 12/12. | Corrigido |
| LOG002 | Fretes e CIOT (modal Novo frete) | `grid2` com cerca de 25 campos em meia linha cada, sem seções, e o aviso do piso solto numa linha. | Três `fieldset` (Viagem e piso mínimo, Veículo, CIOT e MDF-e, Pedágio e observação). O aviso do piso fica ao lado do valor do frete (`c8`) e as chaves do MDF-e e do CT-e lado a lado (`span2`). Ids e regras não mudaram. | Corrigido |
| CMP002 | Requisições e Cotações (modal Nova requisição) | Com a grade de 4 colunas valendo, "Observação / justificativa" (`span2`) sobrava sozinha na linha (51 % vazio). | `full`. | Corrigido |
| EST002 | Kardex (modal Novo movimento) | Mesmo caso: "Observação" sozinha (51 %). | `full`. | Corrigido |
| FIN017 | Análise FIDC (modal Novo borderô) | Mesmo caso: "Observação" sozinha (51 %). | `full`. | Corrigido |
| Global (celular) | 35 telas com cabeçalho `.mm-topo` (RHT001, EST001, EST003, CMP003, PRD004, LOG001, LOG002…) | Em 390 px, título e botões dividiam a mesma linha e o título ficava espremido em 3 ou 4 linhas. | Com até 600 px, o título ocupa a linha inteira e os botões descem para a linha de baixo. | Corrigido |
| Global | 40 de 54 itens do menu | O **título da tela não bate com o nome no menu**. Pode ser só a grafia ("Contas a pagar / receber" no título e "Contas a Pagar / Receber" no menu) ou o nome todo ("Logística — cargas" e "Cargas e Entregas"; "RH — colaboradores" e "Colaboradores"; "Empresa — identidade, regime tributário e crachás" e "Empresa: Identidade e Crachás"). | Usar o nome do menu (que já passa pela `grafia()`) como título, numa linha em `js/app.js`, mantendo `mod.title` como reserva. Exige decidir o nome oficial de cada tela e revisar os manuais. | Corrigido na rodada 2: o título do topo e o da aba do navegador usam o nome do menu (`js/app.js`); `export const title` das 72 telas igualado ao menu (teste novo em `tests/telas.test.js`); 21 títulos internos (`.mm-topo`) com a mesma grafia; manuais com o nome do menu e o código no cabeçalho |
| FIN003 | Contas a Pagar / Receber | Em 1366, a coluna Prioridade fica fora da área visível (rolagem lateral). | Juntar Plano de contas e Conta numa coluna de 2 linhas ou recolher Prioridade num selo na descrição. | Corrigido na rodada 2: Dias na 2ª linha do vencimento, Conta na 2ª linha do plano, Prioridade só na aba A pagar e seletor **Colunas**. Excel pelos dados, com todas as colunas |
| FIN001 | Lançamentos | Em 1366, a coluna Conta fica cortada. | Mesmo tratamento da FIN003 (2ª linha na célula). | Corrigido na rodada 2: C. Custo na 2ª linha do plano, Conta na 2ª linha do favorecido e seletor **Colunas** (Excel já saía com todas) |
| CMP003 | Pedidos de Compra (lista) | Em 1366, Situação fica fora da área visível; as colunas Recebido e Iniflex ficam vazias em quase todas as linhas. | Esconder Recebido e Iniflex quando vazias (regra dos 80 %) e trazer Situação para depois de Fornecedor. | Corrigido na rodada 2: 6 colunas (Nº/data/Iniflex, Fornecedor/pagamento, Situação, Itens, Entrega, Total/recebido) e seletor **Colunas**; Excel pelos dados, com as 10 colunas |
| COM004 | Representantes e Metas | A grade de metas tem 12 meses e só mostra até Ago; o resto rola. | Coluna do nome fixa (`sticky`) e campos de 90 px, ou dividir em semestres. | Corrigido na rodada 2: seletor **Meses** (um semestre por vez, atalhos 1º/2º semestre e Ano todo) e nome fixo na rolagem; total e salvar continuam com os 12 meses |
| LOG001 | Cargas e Entregas | Em 1366, os filtros "Dia das cargas / Notas de / até" ficam no cabeçalho, em duas linhas desalinhadas à direita do título. | Levar os filtros para uma `.card.toolbar` abaixo do cabeçalho, como nas outras telas. | Corrigido na rodada 2: filtros numa `.card.toolbar` abaixo do cabeçalho; "Frota e Parâmetros" à direita do título |
| COM003 | Funil e Propostas (modal Nova oportunidade) | Duas linhas com 34 % vazio: "Cliente da carteira" e "ou prospect" ficam em meia linha cada. | `fieldset` com cliente e prospect em `span2` lado a lado e o resto em `xs`. | Corrigido na rodada 2: `fieldset` Cliente (cliente `span2` + contato `c4`; prospect `span2` + representante `c4`) e Oportunidade (o que é `full`, valor, probabilidade e previsão `c4`, observação `full`) |
| Global (celular) | FIN003, FIN018, CMP003, PRD004, RHT001 | Tabelas largas rolam para o lado sem nenhum sinal de que há mais colunas. | Sombra na borda direita de `.table-wrap` quando há rolagem (regra geral no CSS). | Corrigido na rodada 2: regra geral; a borda da `.table-wrap` com mais colunas esmaece (`.rola-dir` / `.rola-esq`, até 900 px) |

## Severidade baixa

| Código | Tela | Problema | Correção | Status |
|---|---|---|---|---|
| CAD004 | Centros de Custo e Grupos (modal Novo) | Um campo e uma caixa de seleção num modal de 760 px (68 % vazio). | Modal estreito (480 px) para cadastro de um campo. | Corrigido na rodada 2: `modal({ narrow: true })` (480 px, uma coluna); `crud.js` usa o pequeno sozinho com até 2 campos |
| CAD001 | Plano de Contas (modal Nova classificação) | Linha com 42 % vazio. | Prioridade e Ativa na linha do tipo. | Corrigido na rodada 2: código `xs` + nome; tipo, natureza e Ativa; bloco da DRE `span2` + prioridade. Nova conta (3 campos) em modal pequeno |
| CAD002 | Contas Bancárias (modal Novo) | "Ativa" sozinha na última linha. | Levar "Ativa" para a linha de Disponibilidade. | Corrigido na rodada 2: modal largo; Ativa na linha da Disponibilidade e os 4 saldos numa linha |
| LOG001 | Cargas e Entregas (modal Nova carga) | Dois campos num modal de 760 px. | Modal estreito. | Corrigido na rodada 2: modal pequeno |
| EST005 | Parâmetros do Estoque (modal Novo local) | "Quem movimenta" fica fora da grade; a linha das caixas de seleção fica 34 % vazia. | Pôr "Quem movimenta" num `fieldset` próprio, com as caixas em linha. | Corrigido na rodada 2: "Quem movimenta" num `fieldset` com as caixas em linha; código e ordem `xs`; obrigatórios com `*` e `required` |
| CAD003 | Beneficiários (modal) | Seção Fiscal com 33 % vazio (2 selects e 1 caixa). | Aceitável; se nascer outro campo fiscal, ele entra aqui. | Pendente (aceitável) |
| CTB003 | Balanço Patrimonial | Sem balancete importado, aparece um cartão vazio à direita. | Mostrar só o aviso em largura inteira. | Corrigido na rodada 2: só o aviso, em largura inteira, com link para o Balancete |
| PRD002 | Painel de Produção | Sem apontamentos, o gráfico fica alto e vazio. | Trocar por um estado vazio de uma linha. | Corrigido na rodada 2: estado vazio de uma linha no lugar do gráfico |
| FIN008, LOG002, CMP003, EST003 | Formulários corrigidos | Os obrigatórios têm `*` no rótulo, mas não o atributo `required` (a regra pede os dois). | Acrescentar `required` (não muda a validação feita no JS). | Corrigido na rodada 2: `required` em 22 campos com `*` (a validação continua no JS) |
| LOG002 | Fretes e CIOT (modal) | "Pagamento" e "Anexos" continuam como `h3`, fora de `fieldset`. | Converter quando o modal de frete gravado for revisado (precisa de frete com anexo para testar). | Corrigido na rodada 2: `fieldset` Pagamento e Anexos (anexar em `grid-form`); chaves do MDF-e e do CT-e `c4` com "Quem emite" na mesma linha |
| LOG002 | Fretes e CIOT (celular) | O filtro "Mês" fica centralizado sozinho numa linha. | Pôr o rótulo e o campo à esquerda, como nas outras toolbars. | Corrigido na rodada 2: rótulo e campo em linha, à esquerda |

## Rodada 2 (05/11/2026)

Com as decisões aprovadas pelo Renan: nome oficial da tela = nome do menu; tabelas largas em 1366 com a 2ª linha da célula e o seletor **Colunas** (`js/lib/colunas.js`); os pendentes acima; e os **modais de edição** (não só os de Novo).

- Abri **45 modais** em 1366 (Novo e edição da 1ª linha de cada tela de cadastro e movimento) e medi as linhas da grade. Na 1ª medição, 9 tinham linha com mais de ⅓ vazio; depois das correções, **nenhum**. A medição passou a agrupar os campos pelo pé da linha (caixas de seleção e botões alinhados embaixo davam falso alerta).
- As **72 rotas** abriram sem erro de console (`pageerror`).
- `npm run verificar`: **78 de 78** testes.
- Prints em `/tmp/aud2/`: `antes-1366-<rota>.png`, `depois-1366-<rota>(-modal|-editar).png`, `depois-390-<rota>.png`, `depois-1366-abertos-escuro.png`, `depois-1920-<rota>.png`. Medições em `/tmp/aud2/medidas-depois.json`.

### Achados nos modais de edição

| Código | Tela (modal) | Problema | Correção | Status |
|---|---|---|---|---|
| COM002 | Carteira e Agenda (ficha do cliente) | Ficha de leitura com 9 e 5 dados em 4 colunas: "Ticket médio" e "Prazo padrão" sozinhos (76 %). | `grid-form dados5` (5 por linha). Contato: "Assunto do próximo" `c8` com o botão Registrar na mesma linha; "O que foi tratado" com `required`. | Corrigido |
| CMP003 | Pedidos de Compra (ficha do pedido) | "Centro de custo" e "Iniflex" sozinhos (50 %); "Aprovado em" sobrava numa linha. | Dados curtos em `xs`: duas linhas cheias; "aprovado em" na 2ª linha da situação. | Corrigido |
| EST003 / EST001 | Produtos (ficha do produto, estrutura) | "Perda %" e "+ Componente" numa 2ª linha (76 %). | Componente `c4`, quantidade, base e perda `xs` e o botão na mesma linha. | Corrigido |
| PRD004 | Ordens de Produção (consumo) | "+ Consumo" sozinho (76 %). | Material `c4`, quantidade `xs`, botão `xs` na mesma linha. | Corrigido |
| PRD006 | Cadastros de Produção (Setores, Motivos, Máquinas, Ferramentas) | "Ativo" sozinho (76 %); Observação sozinha nas máquinas. | Até 4 campos: modal pequeno; 7 ou mais: modal largo; Observação `span2`. | Corrigido |
| LOG005 | Frota e Parâmetros (veículo) | Situação e a caixa de texto longo em meia linha (42 %); a caixa ficava `xs` mesmo com `span2`. | Regra nova: `label.chk.span2` / `.full` valem para caixa de seleção. Situação + caixa `span2`; Observação `full`. | Corrigido |
| RHT001 | Colaboradores (ficha) | Observação sozinha (76 %); o `class="span2"` do nome caía no `input`, não no rótulo. | Nome `span2`, matrícula, CPF e situação `xs`; datas e salário `xs`, PIX `span2`; Observação `full`. | Corrigido |
| CAD003 | Beneficiários | Seção Fiscal com 33 % vazio. | Aceitável (igual à rodada 1). | Aceitável |

## Regras novas (registradas em `docs/design-system.md`)
- Formulário: campo de texto livre que sobra sozinho na última linha (Observação) usa `full`.
- Tabela em painel lado a lado: colunas secundárias (emissão, NF / parcela, situação) vão para a 2ª linha da célula principal (`<div class="small muted">`), com o rótulo também na 2ª linha do cabeçalho (`<div class="small">`), para a coluna de valor caber sem rolagem em 1366.
- Celular: o título da tela desce para a 2ª linha do topo, e o cabeçalho de tela (`.mm-topo`) empilha título e ações.

- Rodada 2: seletor **Colunas** e 2ª linha da célula em toda lista que não cabe em 1366 (› 5); tamanho do modal pelo número de campos (`narrow` / `wide`); caixa de seleção `span2` / `full`; ficha de leitura `dados5`; linha de inclusão na mesma linha; nome oficial da tela = nome do menu (› 2); borda esmaecida na tabela que rola no celular.

## Manuais (Ajuda › Tutoriais)
Rodada 2: figuras refeitas (capturar.mjs → inserir.mjs) de Pagamentos Antecipados, Estoque e Produtos, Compras, Fretes e CIOT, FIDC (Propostas de Borderô), Duplicatas para Endosso, Lançamentos e Contas a Pagar / Receber, Comercial e Logística, com 7 figuras novas dos formulários e do seletor Colunas. Texto ajustado ("Fator de compra", seções dos formulários, 2ª linha e Colunas). Nos 31 manuais, os nomes das telas passaram a ser os do menu, com o código no cabeçalho; por isso os 31 PDFs foram gerados de novo (versão e histórico atualizados). `inserir.mjs` agora numera as figuras na ordem do texto.

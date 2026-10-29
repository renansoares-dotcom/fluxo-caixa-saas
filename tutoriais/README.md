# Tutoriais — manuais de uso da plataforma

Um manual por funcionalidade, para quem usa a plataforma no dia a dia.

- Texto: `tutoriais/<id>.md`. É ele que se edita.
- PDF: `tutoriais/pdf/<id>.pdf`, gerado a partir do texto, no padrão dos relatórios IPLAMM.
- Catálogo: `js/lib/tutoriais.js`, com o título, a área e as telas (rotas) de cada manual. As rotas ligam o botão **?** do topo de cada tela ao manual dela.
- Na plataforma: **Ajuda › Tutoriais** lista os manuais. Cada um pode ser lido na tela, impresso ou baixado em PDF.

## Regra

**Todo ajuste numa funcionalidade termina com o manual dela atualizado, no mesmo commit:**

1. Atualize o texto em `tutoriais/<id>.md`: os passos, as regras e travas, e as perguntas frequentes.
2. Suba a `versao` e a data em `atualizado`, no cabeçalho do arquivo.
3. Acrescente uma linha no **Histórico de alterações**, dizendo o que mudou.
4. Gere o PDF de novo: `node tutoriais/gerar-pdf.mjs <id>`.

Funcionalidade nova ganha um manual novo: crie o `.md`, inclua no catálogo e gere o PDF.

## Formato de cada manual

1. Para que serve
2. Quem tem acesso
3. A tela, abas e indicadores (quando houver)
4. Passo a passo
5. Regras e travas
6. Perguntas frequentes e erros comuns
7. Histórico de alterações

O repositório é público. Os manuais **nunca** levam dados reais da empresa: nada de nomes de funcionários, salários, fornecedores, clientes ou valores reais. Os exemplos são fictícios.

## Gerar os PDFs

```
node tutoriais/gerar-pdf.mjs              # todos
node tutoriais/gerar-pdf.mjs rh compras   # só esses
```

O script precisa do Playwright com Chromium. Se o Playwright não estiver instalado no projeto, informe o caminho dele: `PLAYWRIGHT=/caminho/playwright/index.mjs`.

## Figuras

As imagens das telas ficam em `tutoriais/img/` e entram no texto numa linha só: `![Legenda](img/arquivo.jpg)`.
São tiradas sempre com **dados fictícios** (veja `scripts/prints/README.md`), nunca da empresa real.

# Fluxo de Caixa — SaaS

Sistema web de gestão financeira multiempresa, construído a partir da planilha **Fluxo de Caixa.xlsm**.
Front-end em HTML + JavaScript puro (sem build) e back-end no **Supabase** (Postgres + Auth + RLS).

## Módulos

| Tela | Equivale na planilha |
|---|---|
| Dashboard | 7.x Dashboards |
| Lançamentos | Abas 1 a 12 |
| Contas a pagar / receber | 5.1 a 5.5 (CAR/CAP, em aberto, inadimplentes) |
| Autorização de pagamentos (PDF) | 5.6 Aut. Pagamentos |
| Fluxo de caixa mensal / diário | 4.3 FC M / 4.1 FC D |
| DRE gerencial | DRE Mensal / Anual |
| Budget / Forecast | 6.1 / 6.2 |
| Orçado x Realizado | DRE Detalhada / 6.x TR |
| Análise FIDC | 5.7 / 5.8 |
| Cadastros | 201–207 (plano de contas, contas, favorecidos, CC, grupos) |

Todos os relatórios têm os mesmos filtros da planilha (Grupo, Conta, Centro de custo, Favorecido, Disponibilidade)
e visão **Realizado** (pago) ou **Projetado** (pago + em aberto), com exportação para Excel.

## Multiempresa e segurança

- Cada empresa é um *tenant*; todas as tabelas têm `empresa_id` e **Row Level Security**.
- Um usuário só vê empresas das quais é membro (`membros`).
- Papéis: `admin` (tudo + usuários), `financeiro` (lança/edita), `diretor` (consulta e aprova autorizações), `leitura`.
- A chave `anon` do Supabase fica no front-end por design; quem protege os dados é o RLS.

## Instalação

### 1. Supabase
1. Crie um projeto em <https://supabase.com>.
2. Abra **SQL Editor → New query**, cole o conteúdo de [`supabase/setup.sql`](supabase/setup.sql) e clique em **Run**.
3. Em **Authentication → URL Configuration**, coloque a URL do site (ex.: `https://SEU-USUARIO.github.io/fluxo-caixa-saas/`) em *Site URL* e *Redirect URLs*.
4. Em **Project Settings → API**, copie a *Project URL* e a chave *anon public*.

### 2. Configurar o front-end
Edite [`js/config.js`](js/config.js):

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

### 3. Publicar no GitHub Pages
1. Faça push deste repositório para o GitHub (branch `main`).
2. Em **Settings → Pages**, escolha *Source: GitHub Actions*. O workflow `.github/workflows/pages.yml` publica a cada push.

Para testar localmente: `npx serve .` (ou qualquer servidor estático) e abra `http://localhost:3000`.

### 4. Primeiro acesso e migração dos dados da planilha
1. Abra o site, clique em **Cadastre-se** e confirme o e-mail.
2. Crie a empresa (ela já vem com um plano de contas modelo).
3. Para trazer os dados da planilha: **Empresa e usuários → Importar base completa** e selecione o arquivo
   `iplamm_2026.json` (gerado a partir do `Fluxo de Caixa.xlsm`, **não versionado** neste repositório).
4. Adicione os demais usuários em **Empresa e usuários** (eles precisam criar a conta antes).

Lançamentos novos podem ser importados por Excel/CSV na mesma tela (layout das abas mensais).

## Estrutura

```
index.html            casca da aplicação
css/app.css           estilos (tema claro/escuro, responsivo)
js/config.js          URL e chave anon do Supabase
js/app.js             autenticação, seleção de empresa e rotas
js/lib/               cliente/estado, UI, formulário de lançamento, CRUD genérico
js/pages/             uma tela por arquivo
supabase/migrations/  schema, RLS e funções (RPC)
supabase/setup.sql    as migrations concatenadas, para colar no SQL Editor
```

## Regras de negócio herdadas da planilha

- Valor do lançamento é sempre positivo; o sinal vem da **natureza** do plano (entradas e 3.01 somam; saídas e 3.02 subtraem).
- Relatórios de caixa consideram apenas lançamentos com **conta bancária** (lançamentos sem conta, como cheques ainda não alocados, ficam fora — igual à planilha).
- DRE gerencial em regime de caixa, com blocos configuráveis por classificação (Cadastros › Plano de contas).
- Prioridade (Obrigatório/Negociável) definida por classificação, com exceção por lançamento.
- FIDC: taxa efetiva a.m. = custo ÷ (face − custo) ÷ prazo × 30; prazo médio ponderado pela face.

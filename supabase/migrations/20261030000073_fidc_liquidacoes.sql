-- =====================================================================
-- Liquidação dos títulos cedidos aos fundos (30/10/2026; Renan: "temos que ter também a liquidação do título quando o
-- cliente paga a FIDC"; "todos os fundos têm relatório"; "conferimos pelo relatório do fundo").
--  - Na aprovação do borderô o título já fica Pago na conta do fundo (a cessão). Esta tabela guarda o segundo momento:
--    o que o fundo informa no relatório de títulos pagos (quitação pelo cliente, recompra pela IPLAMM, depósito do sacado).
--  - Não gera lançamento: é o controle da coobrigação (o que ainda pode voltar como recompra).
--  - Uma linha por título do relatório (fundo + título + borderô); reimportar o mesmo relatório atualiza a linha.
--  - Leitura: membros da empresa. Gravação: administrador e financeiro (igual à base FIDC).
-- Migração ADITIVA; pode rodar mais de uma vez. Não altera nenhum dado existente.
-- =====================================================================
create table if not exists public.fidc_liquidacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fundo text not null,
  titulo text not null,                 -- como o fundo informa (36479-001; cheque 000144; NC 36-42)
  bordero text not null default '',
  fidc_titulo_id uuid references public.fidc_titulos(id) on delete set null,   -- título da base FIDC (nulo: borderô fora da base)
  vencimento date,
  quitacao date not null,
  sacado text,
  cnpj_sacado text,
  valor_face numeric(16,2) not null default 0,
  desconto numeric(16,2) not null default 0,
  mora numeric(16,2) not null default 0,
  valor_pago numeric(16,2) not null default 0,
  tipo text not null default 'normal' check (tipo in ('normal','recompra','deposito_sacado','outro')),
  tipo_fundo text,                      -- o texto do relatório (NORMAL, RECOMPRA, DEPÓSITO SACADO…)
  arquivo text,
  importado_em timestamptz not null default now(),
  importado_por uuid default auth.uid(),
  unique (empresa_id, fundo, titulo, bordero)
);
create index if not exists fidc_liquidacoes_titulo on public.fidc_liquidacoes(fidc_titulo_id);
create index if not exists fidc_liquidacoes_emp_quit on public.fidc_liquidacoes(empresa_id, quitacao);

alter table public.fidc_liquidacoes enable row level security;
do $$ declare a text; begin
  foreach a in array array['sel','ins','upd','del'] loop execute format('drop policy if exists fidc_liquidacoes_%s on public.fidc_liquidacoes', a); end loop;
end $$;
create policy fidc_liquidacoes_sel on public.fidc_liquidacoes for select to authenticated using (empresa_id in (select public.minhas_empresas()));
create policy fidc_liquidacoes_ins on public.fidc_liquidacoes for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fidc_liquidacoes_upd on public.fidc_liquidacoes for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy fidc_liquidacoes_del on public.fidc_liquidacoes for delete to authenticated using (public.pode_editar(empresa_id));

-- conferência: tabela = 1, políticas = 4
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'fidc_liquidacoes') as tabela,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fidc_liquidacoes') as politicas;

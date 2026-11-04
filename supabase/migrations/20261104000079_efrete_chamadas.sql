-- =====================================================================
-- e-frete: registro de todas as chamadas da plataforma à API do e-frete (04/11/2026).
--  - Gravado só pela função de servidor "efrete" (chave de serviço). Nunca guarda token, senha nem hash do integrador.
--  - Serve de trilha de auditoria do CIOT (o que foi pedido, quando, por quem, o que a ANTT/e-frete respondeu)
--    e de diagnóstico durante a homologação.
--  - Leitura: administradores da empresa (e as linhas sem empresa, de diagnóstico, só pelo SQL Editor).
-- Migração ADITIVA; pode rodar mais de uma vez.
-- =====================================================================
create table if not exists public.efrete_chamadas (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.empresas(id) on delete cascade,
  user_id uuid,
  acao text not null,
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  metodo text,
  ok boolean not null default false,
  http_status int,
  ms int,
  pedido jsonb,          -- o que foi enviado, sem credenciais
  resposta jsonb,        -- o que voltou (Sucesso, Excecao, CIOT, etc.)
  criado_em timestamptz not null default now()
);
create index if not exists efrete_chamadas_emp on public.efrete_chamadas(empresa_id, criado_em desc);

alter table public.efrete_chamadas enable row level security;
drop policy if exists efrete_chamadas_sel on public.efrete_chamadas;
create policy efrete_chamadas_sel on public.efrete_chamadas for select to authenticated using (empresa_id is not null and public.is_admin(empresa_id));
-- sem políticas de gravação: só a função de servidor grava
revoke insert, update, delete on public.efrete_chamadas from anon, authenticated;

-- conferência: tabela = 1, politicas = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'efrete_chamadas') as tabela,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'efrete_chamadas') as politicas;

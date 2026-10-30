-- =====================================================================
-- Reforma tributária: alíquotas de CBS e IBS por ano de vigência (30/10/2026; Renan: "Foi liberado pelo governo a nova taxa do CBS").
--  - A plataforma já traz a tabela padrão (2026 ano-teste; 2027 proposta do TCU de 11,3%; 2028–2033 estimativas).
--    Esta tabela guarda só o que a empresa ajustar (por exemplo, quando o Senado votar a resolução da alíquota de 2027).
--  - Usada no simulador de 2027 e na conferência de CBS/IBS das notas (CPD › Fiscal › Apuração de impostos).
--  - Leitura: membros da empresa. Gravação: administradores.
-- Migração ADITIVA; pode rodar mais de uma vez. Não altera nenhum dado existente.
-- =====================================================================
create table if not exists public.trib_aliquotas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ano int not null check (ano between 2026 and 2040),
  cbs numeric(8,4) not null default 0,          -- % CBS (federal)
  ibs_uf numeric(8,4) not null default 0,       -- % IBS estadual
  ibs_mun numeric(8,4) not null default 0,      -- % IBS municipal
  pis_cofins boolean not null default false,    -- PIS/Cofins ainda cobrados no ano
  icms_pct numeric(6,2) not null default 100,   -- % do ICMS que continua (100 até 2028; 90/80/70/60 de 2029 a 2032; 0 em 2033)
  situacao text not null default 'estimada' check (situacao in ('vigente','proposta','estimada')),
  fonte text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  unique (empresa_id, ano)
);

alter table public.trib_aliquotas enable row level security;
-- uma política por ação (padrão do SQL 063)
drop policy if exists trib_aliquotas_adm on public.trib_aliquotas;
do $$ declare a text; begin
  foreach a in array array['sel','ins','upd','del'] loop execute format('drop policy if exists trib_aliquotas_%s on public.trib_aliquotas', a); end loop;
end $$;
create policy trib_aliquotas_sel on public.trib_aliquotas for select to authenticated using (public.is_membro(empresa_id));
create policy trib_aliquotas_ins on public.trib_aliquotas for insert to authenticated with check (public.is_admin(empresa_id));
create policy trib_aliquotas_upd on public.trib_aliquotas for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy trib_aliquotas_del on public.trib_aliquotas for delete to authenticated using (public.is_admin(empresa_id));

-- conferência: tabela = 1, políticas = 4
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'trib_aliquotas') as tabela,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trib_aliquotas') as politicas;

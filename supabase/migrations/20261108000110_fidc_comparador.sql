-- =====================================================================
-- Melhoria contínua 3.11 — Comparador de fundos FIDC (08/11/2026)
-- Parâmetros do comparador: CDI de referência (com a data da última atualização), período de análise, faixas de prazo,
-- se a divisão sugerida respeita o limite disponível de cada fundo e a economia mínima para sugerir dividir o lote.
-- O cálculo é feito na tela, com os borderôs realizados (fidc_operacoes) e as condições cadastradas. Migração ADITIVA.
-- =====================================================================
create table if not exists public.fidc_comparador_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  cdi_aa numeric(7,4) not null default 13.65 check (cdi_aa >= 0 and cdi_aa < 100),   -- % ao ano
  cdi_data date,                                                                       -- quando o CDI foi atualizado
  periodo_meses smallint not null default 12 check (periodo_meses between 3 and 36),
  faixas_prazo int[] not null default array[30, 45, 60, 90],
  respeitar_limites boolean not null default true,
  economia_minima numeric(12,2) not null default 200 check (economia_minima >= 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.fidc_comparador_config enable row level security;
drop policy if exists fidc_comparador_config_sel on public.fidc_comparador_config;
drop policy if exists fidc_comparador_config_ins on public.fidc_comparador_config;
drop policy if exists fidc_comparador_config_upd on public.fidc_comparador_config;
create policy fidc_comparador_config_sel on public.fidc_comparador_config for select to authenticated using (public.is_membro(empresa_id));
create policy fidc_comparador_config_ins on public.fidc_comparador_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fidc_comparador_config_upd on public.fidc_comparador_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant select, insert, update on public.fidc_comparador_config to authenticated;
drop trigger if exists zz_auditoria on public.fidc_comparador_config;
create trigger zz_auditoria after insert or update or delete on public.fidc_comparador_config for each row execute function public._auditar();

-- conferência: tabela = 1
select count(*) as tabela from information_schema.tables where table_schema = 'public' and table_name = 'fidc_comparador_config';

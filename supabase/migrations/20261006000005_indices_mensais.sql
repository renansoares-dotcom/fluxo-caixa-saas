-- Índices de referência por mês (CDI a.m. em %), usados na Análise FIDC
create table if not exists public.indices_mensais (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ano int not null,
  mes smallint not null check (mes between 1 and 12),
  cdi numeric(8,4),            -- CDI do mês, em % a.m. (ex.: 1.0800 = 1,08%)
  updated_at timestamptz not null default now(),
  primary key (empresa_id, ano, mes)
);
comment on table public.indices_mensais is 'Índices de referência por mês (CDI a.m. em %), usados na Análise FIDC';
alter table public.indices_mensais enable row level security;
create policy indices_mensais_sel on public.indices_mensais for select to authenticated using (public.is_membro(empresa_id));
create policy indices_mensais_ins on public.indices_mensais for insert to authenticated with check (public.pode_editar(empresa_id));
create policy indices_mensais_upd on public.indices_mensais for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy indices_mensais_del on public.indices_mensais for delete to authenticated using (public.pode_editar(empresa_id));
revoke all on public.indices_mensais from anon;
grant select, insert, update, delete on public.indices_mensais to authenticated;

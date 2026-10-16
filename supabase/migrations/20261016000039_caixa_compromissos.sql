-- =====================================================================
-- Necessidade de caixa: compromissos programados (ex.: parcela mensal da Recuperação Judicial,
-- quando definida pelo Administrador Judicial). Só cria a tabela; nada existente é alterado.
-- =====================================================================
create table if not exists public.caixa_compromissos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  descricao text not null,
  natureza char(1) not null default 'S' check (natureza in ('S', 'E')),   -- S = saída, E = entrada
  valor numeric(16,2) not null check (valor > 0),
  dia smallint not null check (dia between 1 and 31),                      -- dia do mês (último dia se o mês for menor)
  inicio date not null,
  fim date,
  ativo boolean not null default true,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists caixa_compromissos_emp on public.caixa_compromissos(empresa_id);
alter table public.caixa_compromissos enable row level security;
drop policy if exists caixa_compromissos_sel on public.caixa_compromissos;
drop policy if exists caixa_compromissos_ins on public.caixa_compromissos;
drop policy if exists caixa_compromissos_upd on public.caixa_compromissos;
drop policy if exists caixa_compromissos_del on public.caixa_compromissos;
create policy caixa_compromissos_sel on public.caixa_compromissos for select to authenticated using (public.is_membro(empresa_id));
create policy caixa_compromissos_ins on public.caixa_compromissos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy caixa_compromissos_upd on public.caixa_compromissos for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy caixa_compromissos_del on public.caixa_compromissos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.caixa_compromissos to authenticated;

-- entra na auditoria (migração 038)
drop trigger if exists zz_auditoria on public.caixa_compromissos;
create trigger zz_auditoria after insert or update or delete on public.caixa_compromissos for each row execute function public._auditar();

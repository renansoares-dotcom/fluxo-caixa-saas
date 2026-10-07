-- Cancelamento de endosso (06/10): recusa do beneficiário ou desistência da IPLAMM.
-- O registro fica no histórico com status 'cancelada', data e motivo; os títulos ficam livres para novo endosso.
alter table public.duplicatas
  add column if not exists status text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por uuid default null,
  add column if not exists motivo_cancelamento text;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'duplicatas' and policyname = 'dup_upd') then
    create policy dup_upd on public.duplicatas for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
  end if;
end $$;

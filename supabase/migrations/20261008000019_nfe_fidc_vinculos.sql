-- Borderôs × notas (08/10): liga cada título da base FIDC (fidc_titulos) à nota / parcela de onde ele veio.
-- Só aditivo: nada em fidc_titulos, fidc_operacoes, lançamentos ou notas é alterado; o vínculo fica aqui e é gravado após aprovação.
create table if not exists public.nfe_fidc_vinculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  parcela_id uuid references public.nfe_parcelas(id) on delete cascade,
  fidc_titulo_id uuid not null references public.fidc_titulos(id) on delete cascade,
  tipo text not null check (tipo in ('exata','valor_diferente','manual')),
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (fidc_titulo_id)
);
create index if not exists nfe_fidc_vinculos_nota on public.nfe_fidc_vinculos(nota_id);
create index if not exists nfe_fidc_vinculos_parcela on public.nfe_fidc_vinculos(parcela_id);

alter table public.nfe_fidc_vinculos enable row level security;
create policy nfe_fidc_vinculos_sel on public.nfe_fidc_vinculos for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_fidc_vinculos_ins on public.nfe_fidc_vinculos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy nfe_fidc_vinculos_del on public.nfe_fidc_vinculos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, delete on public.nfe_fidc_vinculos to authenticated;

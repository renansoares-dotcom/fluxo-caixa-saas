-- =====================================================================
-- Conferência do dia: o "visto" de quem conferiu cada conta em cada dia
--  - um registro por conta e dia (dar visto de novo atualiza o registro)
--  - situacao: 'ok' (conferido, tudo certo) ou 'ressalva' (conferido, com pendência explicada na observação)
--  - saldo_informado: para conta sem extrato OFX (caixa, cartão, vale…), o saldo real conferido no dia
-- Só lê/grava o visto: nenhum lançamento é alterado por esta tabela.
-- =====================================================================
create table if not exists public.conferencias_dia (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete cascade,
  data date not null,
  situacao text not null default 'ok' check (situacao in ('ok', 'ressalva')),
  saldo_sistema numeric(16,2),
  saldo_informado numeric(16,2),
  observacao text,
  conferido_por uuid default auth.uid(),
  conferido_email text default (auth.jwt() ->> 'email'),
  conferido_em timestamptz not null default now(),
  unique (conta_id, data)
);
create index if not exists conferencias_dia_emp on public.conferencias_dia(empresa_id, data);

-- quem gravou e quando é sempre o usuário logado (não dá para assinar em nome de outro)
create or replace function public._conferencias_dia_autor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.conferido_por := auth.uid();
  new.conferido_email := auth.jwt() ->> 'email';
  new.conferido_em := now();
  return new;
end $$;
drop trigger if exists conferencias_dia_autor on public.conferencias_dia;
create trigger conferencias_dia_autor before insert or update on public.conferencias_dia
  for each row execute function public._conferencias_dia_autor();

alter table public.conferencias_dia enable row level security;
drop policy if exists conferencias_dia_sel on public.conferencias_dia;
drop policy if exists conferencias_dia_ins on public.conferencias_dia;
drop policy if exists conferencias_dia_upd on public.conferencias_dia;
drop policy if exists conferencias_dia_del on public.conferencias_dia;
create policy conferencias_dia_sel on public.conferencias_dia for select to authenticated using (public.is_membro(empresa_id));
create policy conferencias_dia_ins on public.conferencias_dia for insert to authenticated with check (public.pode_editar(empresa_id));
create policy conferencias_dia_upd on public.conferencias_dia for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy conferencias_dia_del on public.conferencias_dia for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.conferencias_dia to authenticated;

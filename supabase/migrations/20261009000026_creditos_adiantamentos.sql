-- Créditos e adiantamentos (09/10).
-- creditos: valor que o cliente tem a abater (adiantamento recebido antes da nota, crédito por devolução, desconto,
--           acordo) ou que a IPLAMM tem a abater com um fornecedor (adiantamento pago antes da nota de entrada).
-- creditos_usos: aplicação do crédito numa parcela de nota — a parcela conta como recebida/paga nesse valor,
--           sem movimento de caixa (o caixa entrou ou saiu quando o adiantamento foi recebido/pago).
-- Aditivo: não altera dados existentes.
create table if not exists public.creditos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id),
  natureza text not null check (natureza in ('cliente', 'fornecedor')),
  tipo text not null check (tipo in ('adiantamento', 'devolucao', 'desconto', 'acordo', 'outro')),
  data date not null,
  valor numeric(16,2) not null check (valor > 0),
  descricao text,
  lancamento_id uuid references public.lancamentos(id) on delete set null,   -- recebimento/pagamento do adiantamento
  nota_id uuid references public.nfe_notas(id) on delete set null,           -- nota de devolução que gerou o crédito
  cancelado boolean not null default false,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now()
);
create index if not exists creditos_fav on public.creditos(empresa_id, favorecido_id);

create table if not exists public.creditos_usos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  credito_id uuid not null references public.creditos(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  parcela_id uuid references public.nfe_parcelas(id) on delete cascade,
  data date not null,
  valor numeric(16,2) not null check (valor > 0),
  observacao text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now()
);
create index if not exists creditos_usos_credito on public.creditos_usos(credito_id);
create index if not exists creditos_usos_nota on public.creditos_usos(nota_id);

-- o total usado não pode passar do valor do crédito
create or replace function public._creditos_usos_limite() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cred numeric; v_usado numeric; v_canc boolean;
begin
  select valor, cancelado into v_cred, v_canc from creditos where id = new.credito_id for update;
  if v_canc then raise exception 'Este crédito está cancelado.'; end if;
  select coalesce(sum(valor), 0) into v_usado from creditos_usos where credito_id = new.credito_id and id <> new.id;
  if v_usado + new.valor > v_cred + 0.005 then
    raise exception 'O crédito tem saldo de R$ %, menor que o valor usado (R$ %).', to_char(v_cred - v_usado, 'FM999G999G990D00'), to_char(new.valor, 'FM999G999G990D00');
  end if;
  return new;
end $$;
drop trigger if exists creditos_usos_limite on public.creditos_usos;
create trigger creditos_usos_limite before insert or update on public.creditos_usos for each row execute function public._creditos_usos_limite();

alter table public.creditos enable row level security;
alter table public.creditos_usos enable row level security;
drop policy if exists creditos_sel on public.creditos;
drop policy if exists creditos_ins on public.creditos;
drop policy if exists creditos_upd on public.creditos;
drop policy if exists creditos_del on public.creditos;
create policy creditos_sel on public.creditos for select to authenticated using (public.is_membro(empresa_id));
create policy creditos_ins on public.creditos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy creditos_upd on public.creditos for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy creditos_del on public.creditos for delete to authenticated using (public.pode_editar(empresa_id));
drop policy if exists creditos_usos_sel on public.creditos_usos;
drop policy if exists creditos_usos_ins on public.creditos_usos;
drop policy if exists creditos_usos_del on public.creditos_usos;
create policy creditos_usos_sel on public.creditos_usos for select to authenticated using (public.is_membro(empresa_id));
create policy creditos_usos_ins on public.creditos_usos for insert to authenticated with check (public.pode_editar(empresa_id));
create policy creditos_usos_del on public.creditos_usos for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update, delete on public.creditos to authenticated;
grant select, insert, delete on public.creditos_usos to authenticated;

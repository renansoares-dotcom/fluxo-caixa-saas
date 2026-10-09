-- Trava de contas (09/10): depois que o banco bate com o extrato, o administrador trava a conta até uma data.
-- Lançamentos pagos da conta com data até a trava não podem mudar data, valor, conta nem situação, nem ser excluídos
-- ou incluídos; continuam livres classificação (mesma natureza), descrição, documento, centro de custo e favorecido.
-- Conciliações e itens de extrato do período também ficam travados. Destravar guarda quem e quando (histórico).
create table if not exists public.contas_travas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete cascade,
  ate date not null,
  saldo_sistema numeric(16,2), saldo_banco numeric(16,2),
  observacao text,
  ativo boolean not null default true,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  desfeito_por uuid, desfeito_em timestamptz
);
create unique index if not exists contas_travas_ativa on public.contas_travas(conta_id) where ativo;
create index if not exists contas_travas_emp on public.contas_travas(empresa_id, conta_id, criado_em desc);

alter table public.contas_travas enable row level security;
drop policy if exists contas_travas_sel on public.contas_travas;
drop policy if exists contas_travas_ins on public.contas_travas;
drop policy if exists contas_travas_upd on public.contas_travas;
create policy contas_travas_sel on public.contas_travas for select to authenticated using (public.is_membro(empresa_id));
create policy contas_travas_ins on public.contas_travas for insert to authenticated with check (public.is_admin(empresa_id));
create policy contas_travas_upd on public.contas_travas for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.contas_travas to authenticated;

create or replace function public.trava_ate(p_conta uuid) returns date
language sql stable security definer set search_path = public as $$
  select ate from contas_travas where conta_id = p_conta and ativo
$$;
grant execute on function public.trava_ate(uuid) to authenticated;

create or replace function public._trava_lancamentos() returns trigger
language plpgsql security definer set search_path = public as $$
declare t_old date; t_new date; nat_old text; nat_new text; nm text;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.conta_id is not null and old.status = 'Pago' then t_old := trava_ate(old.conta_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.conta_id is not null and new.status = 'Pago' then t_new := trava_ate(new.conta_id); end if;
  if tg_op = 'DELETE' then
    if t_old is not null and old.data <= t_old then
      select nome into nm from contas where id = old.conta_id;
      raise exception 'A conta % está travada até %: não é possível excluir o lançamento de %.', nm, to_char(t_old, 'DD/MM/YYYY'), to_char(old.data, 'DD/MM/YYYY');
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and t_old is not null and old.data <= t_old then
    if new.data is distinct from old.data or new.valor is distinct from old.valor or new.conta_id is distinct from old.conta_id or new.status is distinct from old.status then
      select nome into nm from contas where id = old.conta_id;
      raise exception 'A conta % está travada até %: data, valor, conta e situação dos lançamentos até essa data não podem mudar (classificação, descrição e centro de custo podem).', nm, to_char(t_old, 'DD/MM/YYYY');
    end if;
    if new.plano_id is distinct from old.plano_id then
      select natureza into nat_old from plano_contas where id = old.plano_id;
      select natureza into nat_new from plano_contas where id = new.plano_id;
      if nat_old is distinct from nat_new then
        select nome into nm from contas where id = old.conta_id;
        raise exception 'A conta % está travada até %: a nova classificação é de natureza diferente (entrada × saída) e mudaria o saldo.', nm, to_char(t_old, 'DD/MM/YYYY');
      end if;
    end if;
    return new;
  end if;
  if t_new is not null and new.data <= t_new then
    select nome into nm from contas where id = new.conta_id;
    raise exception 'A conta % está travada até %: não é possível lançar ou baixar lançamento com data de % nela.', nm, to_char(t_new, 'DD/MM/YYYY'), to_char(new.data, 'DD/MM/YYYY');
  end if;
  return new;
end $$;
drop trigger if exists trava_lancamentos on public.lancamentos;
create trigger trava_lancamentos before insert or update or delete on public.lancamentos for each row execute function public._trava_lancamentos();

-- extrato e conciliação do período travado
create or replace function public._trava_extrato() returns trigger
language plpgsql security definer set search_path = public as $$
declare t date; d date; c uuid; nm text;
begin
  if tg_table_name = 'conciliacoes' then
    select e.data, e.conta_id into d, c from extrato_itens e where e.id = coalesce(new.extrato_id, old.extrato_id);
  else
    d := old.data; c := old.conta_id;
    if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.grupo_id is not distinct from old.grupo_id then return new; end if;
  end if;
  t := trava_ate(c);
  if t is not null and d <= t then
    select nome into nm from contas where id = c;
    raise exception 'A conta % está travada até %: a conciliação e o extrato desse período não podem ser alterados.', nm, to_char(t, 'DD/MM/YYYY');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trava_conciliacoes on public.conciliacoes;
create trigger trava_conciliacoes before insert or delete on public.conciliacoes for each row execute function public._trava_extrato();
drop trigger if exists trava_extrato_itens on public.extrato_itens;
create trigger trava_extrato_itens before update or delete on public.extrato_itens for each row execute function public._trava_extrato();

-- Decisão do Dia — fase 2: registrar a decisão do dia (o que entra, o que sai, o que fica para depois),
-- enviar para aprovação do diretor e comparar depois o decidido com o realizado.
-- Rodar no SQL Editor do Supabase (projeto ceyzvhcpgokysgmpdalt). Pode rodar mais de uma vez.

create table if not exists public.decisoes_dia (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  numero        integer,
  data          date not null,
  status        text not null default 'Rascunho' check (status in ('Rascunho', 'Pendente', 'Aprovada', 'Rejeitada')),
  contas        uuid[] not null default '{}',
  minimo        numeric(14,2) not null default 0,
  abertura      numeric(14,2) not null default 0,
  entradas      numeric(14,2) not null default 0,
  saidas        numeric(14,2) not null default 0,
  saldo_fim     numeric(14,2) not null default 0,
  itens         jsonb not null default '[]'::jsonb,   -- [{key, fonte, ref, lanc, conta, valor, desc, fav, prio, decisao: 'incluir'|'adiar', fixo}]
  observacao    text,
  motivo        text,                                  -- do diretor, ao aprovar/rejeitar
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  enviado_em    timestamptz,
  decidido_por  uuid,
  decidido_em   timestamptz
);
create index if not exists decisoes_dia_emp_data on public.decisoes_dia (empresa_id, data desc);

-- número sequencial por empresa e data de atualização
create or replace function public._decisao_dia_regras() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(numero), 0) + 1 into new.numero from decisoes_dia where empresa_id = new.empresa_id;
    new.criado_por := coalesce(new.criado_por, auth.uid());
    if new.status not in ('Rascunho', 'Pendente') then new.status := 'Rascunho'; end if;
  else
    -- aprovar/rejeitar só pela função decidir_decisao_dia
    if new.status in ('Aprovada', 'Rejeitada') and new.status is distinct from old.status and current_setting('app.decidindo', true) is distinct from 'sim' then
      raise exception 'Use Aprovar/Rejeitar (somente diretor)';
    end if;
    -- depois de aprovada, a decisão não muda (só o diretor reabre rejeitando)
    if old.status = 'Aprovada' and current_setting('app.decidindo', true) is distinct from 'sim' then
      raise exception 'Decisão nº % já aprovada: não pode ser alterada', old.numero;
    end if;
    new.numero := old.numero; new.empresa_id := old.empresa_id; new.criado_por := old.criado_por; new.criado_em := old.criado_em;
  end if;
  if new.status = 'Pendente' and (tg_op = 'INSERT' or old.status is distinct from 'Pendente') then new.enviado_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;
revoke all on function public._decisao_dia_regras() from public, anon, authenticated;
drop trigger if exists decisao_dia_regras on public.decisoes_dia;
create trigger decisao_dia_regras before insert or update on public.decisoes_dia for each row execute function public._decisao_dia_regras();

-- aprovar / rejeitar (diretor ou admin)
create or replace function public.decidir_decisao_dia(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare d decisoes_dia;
begin
  select * into d from decisoes_dia where id = p_id for update;
  if not found then raise exception 'Decisão não encontrada'; end if;
  if not exists (select 1 from membros where empresa_id = d.empresa_id and user_id = auth.uid() and papel::text in ('diretor', 'admin')) then
    raise exception 'Somente o diretor pode aprovar ou rejeitar a decisão do dia';
  end if;
  if d.status <> 'Pendente' and not (d.status = 'Aprovada' and not p_aprovar) then
    raise exception 'A decisão nº % não está pendente (status: %)', d.numero, d.status;
  end if;
  perform set_config('app.decidindo', 'sim', true);
  update decisoes_dia set status = case when p_aprovar then 'Aprovada' else 'Rejeitada' end, motivo = p_motivo,
         decidido_por = auth.uid(), decidido_em = now() where id = p_id;
  return case when p_aprovar then 'Aprovada' else 'Rejeitada' end;
end $$;
revoke execute on function public.decidir_decisao_dia(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_decisao_dia(uuid, boolean, text) to authenticated;

-- acesso: membros leem; quem edita (financeiro/admin) cria, atualiza e exclui rascunhos; o diretor decide pela função
alter table public.decisoes_dia enable row level security;
drop policy if exists decisoes_dia_sel on public.decisoes_dia;
drop policy if exists decisoes_dia_ins on public.decisoes_dia;
drop policy if exists decisoes_dia_upd on public.decisoes_dia;
drop policy if exists decisoes_dia_del on public.decisoes_dia;
create policy decisoes_dia_sel on public.decisoes_dia for select to authenticated using (public.is_membro(empresa_id));
create policy decisoes_dia_ins on public.decisoes_dia for insert to authenticated with check (public.pode_editar(empresa_id));
create policy decisoes_dia_upd on public.decisoes_dia for update to authenticated
  using (public.pode_editar(empresa_id) and status in ('Rascunho', 'Pendente', 'Rejeitada'))
  with check (public.pode_editar(empresa_id) and status in ('Rascunho', 'Pendente'));
create policy decisoes_dia_del on public.decisoes_dia for delete to authenticated
  using (public.pode_editar(empresa_id) and status in ('Rascunho', 'Rejeitada'));
grant select, insert, update, delete on public.decisoes_dia to authenticated;

-- notificações: enviada → diretor(es); aprovada/rejeitada → quem montou
create or replace function public._decisao_dia_notifica() returns trigger
language plpgsql security definer set search_path = public as $$
declare dirs uuid[]; resumo text; fmt text;
begin
  if to_regprocedure('public._notificar(uuid,uuid[],text,text,text,text,uuid)') is null then return null; end if;
  fmt := 'R$ ' || translate(to_char(new.saldo_fim, 'FM999,999,999,990.00'), ',.', '.,');
  resumo := 'Dia ' || to_char(new.data, 'DD/MM') || ' · saldo projetado ' || fmt;
  if new.status = 'Pendente' and (tg_op = 'INSERT' or old.status is distinct from 'Pendente') then
    select array_agg(user_id) into dirs from membros where empresa_id = new.empresa_id and papel::text = 'diretor';
    perform _notificar(new.empresa_id, dirs, 'decisao_dia_nova', 'Decisão do dia nº ' || new.numero || ' aguardando aprovação', resumo, '#/decisao-dia?dia=' || new.data, new.id);
  elsif tg_op = 'UPDATE' and new.status in ('Aprovada', 'Rejeitada') and old.status is distinct from new.status then
    perform _notificar(new.empresa_id, array[new.criado_por], 'decisao_dia_' || lower(new.status),
      'Decisão do dia nº ' || new.numero || case when new.status = 'Aprovada' then ' aprovada' else ' rejeitada' end,
      resumo || coalesce(' · ' || new.motivo, ''), '#/decisao-dia?dia=' || new.data, new.id);
  end if;
  return null;
end $$;
revoke all on function public._decisao_dia_notifica() from public, anon, authenticated;
drop trigger if exists decisao_dia_notifica on public.decisoes_dia;
create trigger decisao_dia_notifica after insert or update on public.decisoes_dia for each row execute function public._decisao_dia_notifica();

-- auditoria (se a função de auditoria existir)
do $$ begin
  if to_regprocedure('public._auditar()') is not null then
    drop trigger if exists zz_auditoria on public.decisoes_dia;
    create trigger zz_auditoria after insert or update or delete on public.decisoes_dia for each row execute function public._auditar();
  end if;
end $$;

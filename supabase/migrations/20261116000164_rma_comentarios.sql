-- RMA: diário de comentários por documento do mês (pedido do Renan em 16/11/2026).
-- Cada documento do pacote aceita vários comentários, um embaixo do outro, com autor, data e hora. Uso interno da equipe:
-- não vai no pacote enviado. Continua aberto depois do envio do mês (serve para anotar o que o escritório devolveu). Aditivo.

create table if not exists public.rma_comentarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  entrega_id uuid not null references public.rma_entregas(id) on delete cascade,
  texto text not null check (btrim(texto) <> '' and length(texto) <= 4000),
  por uuid default auth.uid(),
  por_nome text,
  em timestamptz not null default now()
);
create index if not exists rma_comentarios_ent on public.rma_comentarios(entrega_id, em);

create or replace function public._rma_comentario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rma_entregas where id = new.entrega_id and empresa_id = new.empresa_id) then raise exception 'O documento não é desta empresa.'; end if;
  new.texto := btrim(new.texto); new.em := now();
  if auth.uid() is not null then new.por := auth.uid(); end if;                 -- o autor é sempre quem está logado
  if auth.uid() is not null then new.por_nome := (select nome from membros where empresa_id = new.empresa_id and user_id = new.por); end if;
  return new;
end $$;
drop trigger if exists rma_comentario_regras on public.rma_comentarios;
create trigger rma_comentario_regras before insert on public.rma_comentarios for each row execute function public._rma_comentario();

alter table public.rma_comentarios enable row level security;
drop policy if exists rma_comentarios_sel on public.rma_comentarios;
create policy rma_comentarios_sel on public.rma_comentarios for select to authenticated using (public.is_membro(empresa_id) or public.rma_pode(empresa_id));
drop policy if exists rma_comentarios_ins on public.rma_comentarios;
create policy rma_comentarios_ins on public.rma_comentarios for insert to authenticated with check (public.rma_pode(empresa_id));
drop policy if exists rma_comentarios_del on public.rma_comentarios;                -- só o autor ou o administrador apagam; não há edição
create policy rma_comentarios_del on public.rma_comentarios for delete to authenticated using (public.rma_pode(empresa_id) and (por = auth.uid() or public.is_admin(empresa_id)));
grant select, insert, delete on public.rma_comentarios to authenticated;
drop trigger if exists zz_auditoria on public.rma_comentarios;
create trigger zz_auditoria after insert or update or delete on public.rma_comentarios for each row execute function public._auditar();

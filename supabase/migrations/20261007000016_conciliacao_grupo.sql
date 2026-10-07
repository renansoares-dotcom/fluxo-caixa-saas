-- Conciliação N:N (07/10): vários movimentos do extrato ↔ vários lançamentos.
-- Todos os movimentos e vínculos do conjunto levam o mesmo grupo_id; os vínculos apontam para o primeiro movimento.
alter table public.extrato_itens add column if not exists grupo_id uuid;
alter table public.conciliacoes add column if not exists grupo_id uuid;
create index if not exists extrato_itens_grupo on public.extrato_itens(grupo_id) where grupo_id is not null;
create index if not exists conciliacoes_grupo on public.conciliacoes(grupo_id) where grupo_id is not null;

-- Se um vínculo some (ex.: lançamento excluído): item sem vínculo volta a pendente; num grupo, o grupo todo volta.
create or replace function public.tg_conciliacao_removida() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.grupo_id is not null then
    update extrato_itens set status = 'pendente', conciliado_em = null, conciliado_por = null, grupo_id = null
     where grupo_id = old.grupo_id and status = 'conciliado';
  else
    update extrato_itens set status = 'pendente', conciliado_em = null, conciliado_por = null
     where id = old.extrato_id and status = 'conciliado'
       and not exists (select 1 from conciliacoes c where c.extrato_id = old.extrato_id);
  end if;
  return old;
end $$;
revoke execute on function public.tg_conciliacao_removida() from public, anon, authenticated;

-- Lançamento conciliado com o extrato (07/10): não pode ser excluído e só aceita mudança nas descrições
-- (descrição e opcionais 1–4). Para alterar o resto, desfaça a conciliação antes.
-- Exclusões em cascata (ex.: exclusão da empresa) passam (pg_trigger_depth > 1).
create or replace function public.tg_lanc_conciliado() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if not exists (select 1 from conciliacoes c where c.lancamento_id = old.id) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'Lançamento conciliado com o extrato bancário: desfaça a conciliação antes de excluir';
  end if;
  if (new.data, new.valor, new.plano_id, new.conta_id, new.status, new.favorecido_id, new.centro_custo_id, new.prioridade, new.documento, new.emissao, new.empresa_id)
     is distinct from
     (old.data, old.valor, old.plano_id, old.conta_id, old.status, old.favorecido_id, old.centro_custo_id, old.prioridade, old.documento, old.emissao, old.empresa_id) then
    raise exception 'Lançamento conciliado com o extrato bancário: só a descrição e os opcionais podem ser alterados';
  end if;
  return new;
end $$;
revoke execute on function public.tg_lanc_conciliado() from public, anon, authenticated;
create trigger lanc_conciliado_upd before update on public.lancamentos for each row execute function public.tg_lanc_conciliado();
create trigger lanc_conciliado_del before delete on public.lancamentos for each row execute function public.tg_lanc_conciliado();

-- O admin também aprova/rejeita propostas de borderô FIDC (pedido do Renan em 21/10/2026).
-- Só muda a checagem de permissão de decidir_proposta_fidc (diretor OU admin); o resto da aprovação
-- continua em _aprovar_proposta_fidc, sem alteração. Pode rodar mais de uma vez.
create or replace function public.decidir_proposta_fidc(p_id uuid, p_aprovar boolean, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if not (is_diretor(pr.empresa_id) or exists (select 1 from membros where empresa_id = pr.empresa_id and user_id = auth.uid() and papel::text = 'admin')) then
    raise exception 'Somente o diretor ou o administrador pode aprovar ou rejeitar propostas';
  end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;
  if not p_aprovar then
    update fidc_propostas set status = 'Rejeitada', motivo = p_motivo, aprovado_por = auth.uid(), aprovado_em = now() where id = p_id;
    return 'Rejeitada';
  end if;
  return _aprovar_proposta_fidc(p_id, p_motivo, auth.uid());
end $$;
revoke execute on function public.decidir_proposta_fidc(uuid, boolean, text) from anon, public;
grant execute on function public.decidir_proposta_fidc(uuid, boolean, text) to authenticated;

-- conferência: deve mostrar "true"
select position('admin' in pg_get_functiondef('public.decidir_proposta_fidc(uuid,boolean,text)'::regprocedure)) > 0 as admin_aprova;

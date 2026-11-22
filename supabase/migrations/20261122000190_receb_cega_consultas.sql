-- 190 — conferência cega do recebimento também nas consultas de Compras e do cadastro
-- Enquanto uma nota está em conferência cega, quem pode conferir não a vê nas consultas privilegiadas que leem os itens da nota:
--   * por nota (compras de um produto, candidatos ao ativo imobilizado): a linha da nota em conferência some;
--   * agregadas (de-para pendente, compras por item do portal): ficam indisponíveis para essa pessoa até a conferência terminar.
-- Aditivo: nada é apagado.

create or replace function public._receb_conferindo() returns boolean language sql stable security definer set search_path = public as $$
  select cardinality(public._receb_notas_ocultas()) > 0;
$$;
grant execute on function public._receb_conferindo() to authenticated;

do $$
declare r record; v_args text; v_res text; v_names text; v_call text; v_base text;
begin
  for r in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('produto_compras', 'af_candidatos', 'produto_depara_pendente', 'portal_compras') loop
    v_base := '_' || r.proname || '_base';
    if exists (select 1 from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace where n2.nspname = 'public' and p2.proname = v_base) then continue; end if;
    v_args := pg_get_function_arguments(r.oid);
    v_res := pg_get_function_result(r.oid);
    select string_agg(format('%1$I => %1$I', a), ', ') into v_names from unnest((select proargnames from pg_proc where oid = r.oid)) a
     where a is not null and a <> '' and a not in (select unnest(proargnames[pronargs + 1:]) from pg_proc where oid = r.oid);
    v_call := format('public.%I(%s)', v_base, coalesce(v_names, ''));
    execute format('alter function public.%I(%s) rename to %I', r.proname, pg_get_function_identity_arguments(r.oid), v_base);
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', v_base, pg_get_function_identity_arguments(r.oid));
    if v_res like '%nota_id uuid%' then
      -- por nota: some a linha da nota que a pessoa pode estar conferindo às cegas
      execute format('create function public.%I(%s) returns %s language sql %s security definer set search_path = public as $f$ select b.* from %s b where not (b.nota_id = any(public._receb_notas_ocultas())) $f$',
                     r.proname, v_args, v_res, case (select provolatile from pg_proc where oid = r.oid) when 's' then 'stable' else 'volatile' end, v_call);
    else
      execute format('create function public.%I(%s) returns %s language plpgsql %s security definer set search_path = public as $f$ begin if public._receb_conferindo() then raise exception %L; end if; return query select * from %s; end $f$',
                     r.proname, v_args, v_res, case (select provolatile from pg_proc where oid = r.oid) when 's' then 'stable' else 'volatile' end,
                     'Há uma conferência cega de recebimento aberta: esta consulta fica indisponível para quem pode conferir até a conferência terminar.', v_call);
    end if;
    execute format('revoke all on function public.%I(%s) from public, anon', r.proname, pg_get_function_identity_arguments(r.oid));
    execute format('grant execute on function public.%I(%s) to authenticated', r.proname, pg_get_function_identity_arguments(r.oid));
  end loop;
end $$;

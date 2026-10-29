-- =====================================================================
-- Desempenho — fase 1 do diagnóstico de 28/10/2026.
-- 1) Índice em toda chave estrangeira (FK) do esquema público que ainda não tem um índice começando pelas colunas
--    dela (o Supabase apontou 135). Deixa mais rápidos os filtros, as junções e as exclusões em cascata.
--    Só cria índice; não muda dado nenhum.
-- 2) Política paraquedas_ins: auth.uid() passa a ser calculado uma vez por comando, não uma vez por linha.
-- Pode rodar mais de uma vez.
-- =====================================================================

-- 1) Índices das chaves estrangeiras ----------------------------------------------------------
do $$
declare r record; nome text; n int := 0;
begin
  for r in
    select c.conrelid, cl.relname as tabela, c.conname, c.conkey,
           string_agg(quote_ident(a.attname), ', ' order by k.ord) as colunas,
           string_agg(a.attname, '_' order by k.ord) as cols_nome
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f' and ns.nspname = 'public' and cl.relkind = 'r'
      and not exists (                         -- já existe índice que começa pelas colunas da FK
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey)
    group by c.conrelid, cl.relname, c.conname, c.conkey
  loop
    nome := left(r.tabela || '_' || r.cols_nome, 54) || '_fk_idx';
    execute format('create index if not exists %I on public.%I (%s)', nome, r.tabela, r.colunas);
    n := n + 1;
  end loop;
  raise notice 'índices criados: %', n;
end $$;

-- 2) paraquedas_ins com (select auth.uid()) --------------------------------------------------
drop policy if exists paraquedas_ins on public.paraquedas;
create policy paraquedas_ins on public.paraquedas for insert to authenticated
  with check (is_participante(empresa_id) and not exists (
    select 1 from membros m
    where m.empresa_id = paraquedas.empresa_id and m.user_id = (select auth.uid()) and m.papel::text = 'leitura'));

-- conferência (deve voltar: fks_sem_indice = 0)
select count(*) as fks_sem_indice
from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
where c.contype = 'f' and ns.nspname = 'public' and cl.relkind = 'r'
  and not exists (select 1 from pg_index i where i.indrelid = c.conrelid
                  and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
                  and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey);

-- =====================================================================
-- Segurança/desempenho — uma política por ação (29/10/2026). Aviso do Supabase "multiple_permissive_policies" (24 tabelas).
-- Várias tabelas tinham <t>_all (FOR ALL: quem edita) e <t>_sel (FOR SELECT: quem vê). No SELECT o Postgres avalia as duas
-- em cada linha. Aqui o _all vira três políticas (insert, update, delete) com a MESMA regra, e o _sel passa a ser
-- "(regra de ver) OR (regra de editar)": quem via continua vendo, quem editava continua editando. Nenhum acesso muda.
-- Também junta as duas políticas de leitura de empresas e de membros numa só (a regra é o OR das duas).
-- Pode rodar mais de uma vez: só mexe nas tabelas que ainda têm o par _all + _sel.
-- =====================================================================
do $$
declare r record; base text;
begin
  for r in
    select a.tablename t, a.policyname pa, a.qual aq, coalesce(a.with_check, a.qual) ac, s.policyname ps, s.qual sq
      from pg_policies a
      join pg_policies s on s.schemaname = a.schemaname and s.tablename = a.tablename and s.cmd = 'SELECT' and s.permissive = 'PERMISSIVE' and s.roles = a.roles
     where a.schemaname = 'public' and a.cmd = 'ALL' and a.permissive = 'PERMISSIVE' and a.roles = '{authenticated}'
       and (select count(*) from pg_policies x where x.schemaname = 'public' and x.tablename = a.tablename and x.cmd in ('ALL', 'SELECT')) = 2
  loop
    base := regexp_replace(r.pa, '_all$', '');
    execute format('drop policy %I on public.%I', r.pa, r.t);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', base || '_ins', r.t, r.ac);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', base || '_upd', r.t, r.aq, r.ac);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', base || '_del', r.t, r.aq);
    execute format('drop policy %I on public.%I', r.ps, r.t);
    execute format('create policy %I on public.%I for select to authenticated using ((%s) or (%s))', r.ps, r.t, r.sq, r.aq);
    raise notice 'políticas unificadas: %', r.t;
  end loop;
end $$;

-- empresas: membro ou participante (portal) veem a empresa
drop policy if exists empresas_sel_participante on public.empresas;
drop policy if exists empresas_sel on public.empresas;
create policy empresas_sel on public.empresas for select to authenticated using (is_membro(id) or is_participante(id));

-- membros: os membros da empresa e o próprio vínculo
drop policy if exists membros_sel_proprio on public.membros;
drop policy if exists membros_sel on public.membros;
create policy membros_sel on public.membros for select to authenticated using (is_membro(empresa_id) or user_id = (select auth.uid()));

-- conferência: sobrepostas = 0
select count(*) as sobrepostas from (
  select tablename, acao from (
    select tablename, unnest(case when cmd = 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] else array[cmd] end) acao
      from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and 'authenticated' = any(roles)) x
   group by tablename, acao having count(*) > 1) y;

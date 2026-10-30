-- =====================================================================
-- Desempenho — telas que não abriam (30/10/2026, "Muitas telas não abrem").
-- Causa: as regras de acesso das tabelas grandes chamavam is_membro(empresa_id) linha por linha. Com a verificação em
-- duas etapas (SQL 057), cada chamada ficou mais cara; com ~15 mil lançamentos, resumo_mensal, saldos_contas, saldo_em
-- e orcamento_movimento passavam de 8 s e o banco cancelava (statement timeout) — Dashboard, Fluxo, Decisão do Dia etc.
-- Correção: a regra passa a ser "empresa_id IN (SELECT minhas_empresas())". O Postgres calcula a lista das empresas do
-- usuário uma vez por consulta, em vez de uma vez por linha. A regra é a MESMA (mesmos papéis e mesma exigência de MFA):
-- ninguém ganha nem perde acesso. Teste no banco real: contagem dos lançamentos de 3,6 s para 6 ms.
-- Pode rodar mais de uma vez.
-- =====================================================================
create or replace function public.minhas_empresas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.empresa_id from membros m
   where m.user_id = auth.uid() and m.papel::text not in ('compras', 'vendas', 'producao') and public._mfa_ok(m.empresa_id);
$$;
revoke execute on function public.minhas_empresas() from public, anon;
grant execute on function public.minhas_empresas() to authenticated, service_role;

do $$
declare r record; novo_q text; novo_c text; n int := 0;
  de constant text := 'is_membro(empresa_id)';
  para constant text := '(empresa_id IN ( SELECT minhas_empresas() AS minhas_empresas))';
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and (position(de in coalesce(qual, '')) > 0 or position(de in coalesce(with_check, '')) > 0)
  loop
    novo_q := replace(r.qual, de, para); novo_c := replace(r.with_check, de, para);
    if r.qual is not null and r.with_check is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)', r.policyname, r.schemaname, r.tablename, novo_q, novo_c);
    elsif r.qual is not null then
      execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, novo_q);
    else
      execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, novo_c);
    end if;
    n := n + 1;
  end loop;
  raise notice 'regras atualizadas: %', n;
end $$;

-- conferência: restantes = 0 (nenhuma regra chama mais is_membro(empresa_id) linha a linha)
select count(*) as restantes from pg_policies
 where schemaname = 'public' and (coalesce(qual, '') like '%is_membro(empresa_id)%' or coalesce(with_check, '') like '%is_membro(empresa_id)%');

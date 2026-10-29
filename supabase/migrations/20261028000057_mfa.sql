-- =====================================================================
-- Verificação em duas etapas (MFA, aplicativo autenticador) — fase 1 do diagnóstico (28/10/2026).
-- empresas.mfa_obrigatorio: quando ligado (Empresa e usuários), administrador, financeiro e diretor só acessam os dados da
-- empresa depois de confirmar o código do autenticador (sessão "aal2"). A regra fica no BANCO: todas as funções de
-- permissão usadas pelas políticas (is_membro, pode_editar, is_admin…) passam a conferir _mfa_ok(empresa).
-- Desligado (padrão), nada muda. Os demais perfis (compras, vendas, produção, leitura) não são afetados.
-- Pode rodar mais de uma vez.
-- =====================================================================
alter table public.empresas add column if not exists mfa_obrigatorio boolean not null default false;

create or replace function public._mfa_ok(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null                                                     -- chamadas internas / service_role
      or not coalesce((select e.mfa_obrigatorio from empresas e where e.id = p_empresa), false)
      or not exists (select 1 from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid()
                     and m.papel::text in ('admin', 'financeiro', 'diretor'))
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
revoke execute on function public._mfa_ok(uuid) from public, anon;
grant execute on function public._mfa_ok(uuid) to authenticated, service_role;

-- para a tela saber, ANTES de abrir a empresa, se a pessoa precisa do segundo fator (empresas fica oculta sem ele)
create or replace function public.mfa_exigido() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros m join empresas e on e.id = m.empresa_id
                 where m.user_id = auth.uid() and e.mfa_obrigatorio and m.papel::text in ('admin', 'financeiro', 'diretor'));
$$;
revoke execute on function public.mfa_exigido() from public, anon;
grant execute on function public.mfa_exigido() to authenticated, service_role;

-- acrescenta "and _mfa_ok(p_empresa)" em todas as funções de permissão que consultam membros
do $$
declare r record; corpo text; novo text; def text;
begin
  for r in select p.oid, p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
           where n.nspname = 'public' and l.lanname = 'sql' and p.prorettype = 'bool'::regtype and p.proname <> '_mfa_ok'
             and 'p_empresa' = any(p.proargnames) and p.prosrc ilike '%from membros%' and p.prosrc not ilike '%_mfa_ok(%'
  loop
    corpo := btrim(r.prosrc, E' \t\r\n');
    corpo := regexp_replace(corpo, ';\s*$', '');
    if corpo !~* '^select\s' or position(';' in corpo) > 0 then raise notice 'pulada (formato): %', r.proname; continue; end if;
    novo := E'\n  select (' || regexp_replace(corpo, '^select\s+', '', 'i') || E')\n     and public._mfa_ok(p_empresa);\n';
    def := pg_get_functiondef(r.oid);
    if position(r.prosrc in def) = 0 then raise notice 'pulada (corpo): %', r.proname; continue; end if;
    execute replace(def, r.prosrc, novo);
    raise notice 'MFA na função %', r.proname;
  end loop;
end $$;

-- conferência: funções de permissão com a regra (deve dar 19)
select count(*) as funcoes_com_mfa from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ilike '%_mfa_ok(p_empresa)%';

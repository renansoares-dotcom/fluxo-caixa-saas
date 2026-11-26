\set ON_ERROR_STOP on
\o /dev/null
-- 191 — nenhuma função privilegiada fica ao alcance de quem não fez login, a não ser as páginas públicas de propósito
create temp table _pub as select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
do $$ begin
  if exists (select 1 from _pub where proname not in ('cotacao_link_abrir', 'cotacao_link_recusar', 'cotacao_link_responder', 'portal_ver_convite', 'ver_convite', 'cracha_verificar', 'pode_criar_empresa', 'cadq_link_abrir', 'cadq_link_responder')) then
    raise exception 'FALHOU: função privilegiada aberta sem login: %', (select string_agg(proname, ', ') from _pub where proname not in ('cotacao_link_abrir', 'cotacao_link_recusar', 'cotacao_link_responder', 'portal_ver_convite', 'ver_convite', 'cracha_verificar', 'pode_criar_empresa', 'cadq_link_abrir', 'cadq_link_responder'));
  end if;
  if has_function_privilege('authenticated', 'public._indices_gravar(text, jsonb)', 'execute') then raise exception 'FALHOU: índices econômicos graváveis por usuário'; end if;
  if not has_function_privilege('authenticated', 'public.imp_custo(uuid)', 'execute') then raise exception 'FALHOU: quem fez login perdeu acesso a uma função comum'; end if;
  if not has_function_privilege('anon', 'public.cotacao_link_abrir(text)', 'execute') then raise exception 'FALHOU: a cotação pelo link do fornecedor deixou de abrir sem login'; end if;
end $$;
-- os gatilhos continuam disparando (a função de gatilho não precisa de acesso direto)
set role authenticated;
select 1;
reset role;
\o
\echo b7_funcoes_publicas ok

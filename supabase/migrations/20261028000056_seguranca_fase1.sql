-- =====================================================================
-- Segurança — fase 1 do diagnóstico de 28/10/2026 (Renan: "1 - Aprovado").
-- 1) Backups saem do esquema público (que a API expõe) para o esquema "arquivo", sem acesso pela API. Nada é apagado.
-- 2) Funções: ninguém sem login executa função nenhuma, a não ser as duas que a tela de convite usa antes do login
--    (ver_convite e portal_ver_convite). Funções de gatilho (trigger) e auxiliares internas deixam de ser chamáveis
--    pela API também por quem está logado — os gatilhos continuam disparando normalmente (o Postgres não confere
--    EXECUTE ao disparar gatilho) e as funções que as usam rodam como dono (SECURITY DEFINER).
-- 3) search_path fixo nas 8 funções apontadas pelo Supabase.
-- 4) Funções criadas daqui para frente não ficam abertas para quem não está logado.
-- Pode rodar mais de uma vez.
-- =====================================================================

-- 1) Backups → esquema "arquivo" ------------------------------------------------------------
create schema if not exists arquivo;
revoke all on schema arquivo from public, anon, authenticated;
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and (c.relname like 'backup\_%' or c.relname like 'bkp\_%')
  loop
    execute format('alter table public.%I set schema arquivo', t);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'arquivo' and c.relkind = 'r'
  loop
    execute format('alter table arquivo.%I enable row level security', t);
    execute format('revoke all on arquivo.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- 2) EXECUTE das funções do esquema público ------------------------------------------------
do $$
declare r record; tinha_auth boolean;
  -- auxiliares internas: só são chamadas por outras funções do banco (que rodam como dono)
  internas text[] := array['_uuid_ou_nulo', 'custo_item_nfe', 'nf_parcela', '_compras_total_itens', '_compras_refazer_previsao',
                           '_aprovar_proposta_fidc', '_desfazer_um', '_iniciar_operacao', '_notificar', '_pode_operar', 'aplicar_plano_modelo'];
begin
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_function_result(p.oid) ret
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- funções de extensões ficam como estão
  loop
    tinha_auth := has_function_privilege('authenticated', r.oid, 'execute');
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    if r.ret = 'trigger' or r.proname = any(internas) then
      execute format('revoke execute on function public.%I(%s) from authenticated', r.proname, r.args);
    elsif tinha_auth then
      execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
    end if;
    execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
  end loop;
end $$;
-- usadas na tela de convite, antes do login
grant execute on function public.ver_convite(text) to anon;
grant execute on function public.portal_ver_convite(text) to anon;

-- 3) search_path fixo ------------------------------------------------------------------------
alter function public._uuid_ou_nulo(text) set search_path = public;
alter function public._compras_numero() set search_path = public;
alter function public.custo_item_nfe(public.nfe_itens, public.estoque_parametros) set search_path = public;
alter function public._comercial_op_regras() set search_path = public;
alter function public._comercial_int_vendedor() set search_path = public;
alter function public._log_carga_regras() set search_path = public;
alter function public._prod_ordem_regras() set search_path = public;
alter function public.tg_rh_colab_upd() set search_path = public;

-- 4) Funções novas não nascem abertas para quem não está logado --------------------------------
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- conferência (deve voltar: backups_no_publico = 0, funcoes_sem_login = 2)
select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and (c.relname like 'backup\_%' or c.relname like 'bkp\_%')) as backups_no_publico,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'arquivo' and c.relkind = 'r') as backups_no_arquivo,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')) as funcoes_sem_login;

-- =====================================================================
-- Auditoria: registra quem incluiu, alterou ou excluiu, quando, e os valores antes/depois
--  - só cria tabela, função e gatilhos (AFTER); não altera nenhum dado existente
--  - grava a partir de agora (o passado não é reconstruído)
--  - quem lê: administrador e diretor da empresa; ninguém grava/edita/apaga pela API
-- =====================================================================

create table if not exists public.auditoria (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid,                              -- null = rotina do sistema / importação
  user_email text,
  tabela text not null,
  registro_id text,
  acao text not null check (acao in ('incluiu', 'alterou', 'excluiu')),
  campos text[],                             -- campos alterados (só em "alterou")
  antes jsonb,
  depois jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists auditoria_emp_data on public.auditoria(empresa_id, criado_em desc);
create index if not exists auditoria_registro on public.auditoria(tabela, registro_id, criado_em desc);
create index if not exists auditoria_user on public.auditoria(empresa_id, user_id, criado_em desc);

alter table public.auditoria enable row level security;
drop policy if exists auditoria_sel on public.auditoria;
create policy auditoria_sel on public.auditoria for select to authenticated using (
  exists (select 1 from public.membros m where m.empresa_id = auditoria.empresa_id and m.user_id = (select auth.uid())
          and m.papel::text in ('admin', 'diretor')));
revoke all on public.auditoria from anon, authenticated;
grant select on public.auditoria to authenticated;

create or replace function public._auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(r_new, r_old);
  v_emp uuid := (r ->> 'empresa_id')::uuid;
  v_reg text := coalesce(r ->> 'id', r ->> 'plano_id', r ->> 'conta_bancaria_id',
                         (r ->> 'favorecido_id') || coalesce(':' || (r ->> 'papel'), ''), r ->> 'user_id');
  ign text[] := array['updated_at', 'created_at', 'atualizado_em', 'criado_em', 'xml'];
  k text; mudou text[] := '{}'; a jsonb := '{}'; d jsonb := '{}';
begin
  if v_emp is null then return null; end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(r_new) loop
      if k = any(ign) then continue; end if;
      if (r_old -> k) is distinct from (r_new -> k) then
        mudou := mudou || k; a := a || jsonb_build_object(k, r_old -> k); d := d || jsonb_build_object(k, r_new -> k);
      end if;
    end loop;
    if cardinality(mudou) = 0 then return null; end if;   -- update sem mudança real
    insert into auditoria(empresa_id, user_id, user_email, tabela, registro_id, acao, campos, antes, depois)
    values (v_emp, auth.uid(), auth.jwt() ->> 'email', tg_table_name, v_reg, 'alterou', mudou, a, d);
  else
    insert into auditoria(empresa_id, user_id, user_email, tabela, registro_id, acao, antes, depois)
    values (v_emp, auth.uid(), auth.jwt() ->> 'email', tg_table_name, v_reg,
            case tg_op when 'INSERT' then 'incluiu' else 'excluiu' end,
            case when tg_op = 'DELETE' then r_old - ign end, case when tg_op = 'INSERT' then r_new - ign end);
  end if;
  return null;
end $$;
revoke all on function public._auditar() from public, anon, authenticated;

-- liga a auditoria nas tabelas de movimento e de cadastro
do $$
declare t text;
begin
  foreach t in array array['lancamentos', 'contas', 'favorecidos', 'plano_contas', 'centros_custo', 'grupos', 'orcamentos',
                           'orcamento_rateio_cc', 'paraquedas', 'fidc_propostas', 'contas_travas', 'conciliacoes', 'conferencias_dia',
                           'membros', 'creditos', 'duplicatas', 'autorizacoes', 'nfe_vinculos',
                           'contab_depara_plano', 'contab_depara_conta', 'contab_depara_favorecido'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_auditoria on public.%I', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
    end if;
  end loop;
end $$;

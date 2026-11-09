-- Melhoria 10.1 — Qualidade do cadastro: duplicados (mesmo documento ou nome parecido, calculados na tela), "não é duplicado",
-- mesclar dois beneficiários (tudo o que aponta para o excluído passa para o que fica; campos vazios são completados),
-- situação da consulta do CNPJ na Receita (BrasilAPI) e os pesos do indicador de cadastro completo. Aditivo.

alter table public.favorecidos add column if not exists receita_situacao text;
alter table public.favorecidos add column if not exists receita_consultada_em timestamptz;
alter table public.favorecidos add column if not exists receita_dados jsonb;          -- CNAE, abertura, Simples/MEI (última consulta)

create table if not exists public.qc_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  similaridade numeric(4,3) not null default 0.85 check (similaridade between 0.5 and 1),
  pesos_fav jsonb not null default '{}'::jsonb,         -- {campo: peso}; vazio = padrão da tela
  pesos_prod jsonb not null default '{}'::jsonb,
  meta numeric(5,2) not null default 80 check (meta between 0 and 100),
  atualizado_em timestamptz not null default now()
);
create table if not exists public.qc_ignorados (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tabela text not null check (tabela in ('favorecidos', 'produtos')),
  a uuid not null, b uuid not null,
  marcado_por uuid default auth.uid(), marcado_em timestamptz not null default now(),
  primary key (empresa_id, tabela, a, b),
  check (a < b)
);
alter table public.qc_config enable row level security;
alter table public.qc_ignorados enable row level security;
drop policy if exists qc_config_sel on public.qc_config;
create policy qc_config_sel on public.qc_config for select to authenticated using (public.is_membro(empresa_id));
drop policy if exists qc_config_ins on public.qc_config;
create policy qc_config_ins on public.qc_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists qc_config_upd on public.qc_config;
create policy qc_config_upd on public.qc_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists qc_ign_sel on public.qc_ignorados;
create policy qc_ign_sel on public.qc_ignorados for select to authenticated using (public.is_membro(empresa_id));
drop policy if exists qc_ign_ins on public.qc_ignorados;
create policy qc_ign_ins on public.qc_ignorados for insert to authenticated with check (public.pode_editar(empresa_id));
drop policy if exists qc_ign_del on public.qc_ignorados;
create policy qc_ign_del on public.qc_ignorados for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update on public.qc_config to authenticated;
grant select, insert, delete on public.qc_ignorados to authenticated;

-- mesclar beneficiários: o que fica recebe tudo o que apontava para o excluído; campos vazios do que fica são completados
create or replace function public.mesclar_favorecidos(p_manter uuid, p_excluir uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a favorecidos; b favorecidos; fk record; n int; movidos jsonb := '{}'; v_op uuid; col text; v_set text := '';
begin
  if p_manter = p_excluir then raise exception 'Escolha dois cadastros diferentes'; end if;
  select * into a from favorecidos where id = p_manter for update;
  select * into b from favorecidos where id = p_excluir for update;
  if a.id is null or b.id is null then raise exception 'Cadastro não encontrado'; end if;
  if a.empresa_id <> b.empresa_id then raise exception 'Cadastros de empresas diferentes'; end if;
  if not public._pode_operar(a.empresa_id, array['admin', 'financeiro']) then raise exception 'Só o administrador e o financeiro mesclam cadastros'; end if;
  if nullif(regexp_replace(coalesce(a.documento, ''), '\D', '', 'g'), '') is distinct from nullif(regexp_replace(coalesce(b.documento, ''), '\D', '', 'g'), '')
     and nullif(regexp_replace(coalesce(a.documento, ''), '\D', '', 'g'), '') is not null and nullif(regexp_replace(coalesce(b.documento, ''), '\D', '', 'g'), '') is not null then
    raise exception 'Os documentos são diferentes: não são o mesmo cadastro';
  end if;
  v_op := public._iniciar_operacao('Mesclar beneficiários — mantém ' || a.nome || ', exclui ' || b.nome);
  -- tudo que aponta para o excluído
  for fk in select c.conrelid::regclass::text t, att.attname col
              from pg_constraint c join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
             where c.contype = 'f' and c.confrelid = 'public.favorecidos'::regclass and cardinality(c.conkey) = 1 loop
    begin
      execute format('update %s set %I = $1 where %I = $2', fk.t, fk.col, fk.col) using a.id, b.id;
      get diagnostics n = row_count;
      if n > 0 then movidos := movidos || jsonb_build_object(fk.t || '.' || fk.col, n); end if;
    exception when unique_violation then
      -- vínculo que só pode existir uma vez (ex.: de-para contábil): fica o do cadastro mantido
      execute format('delete from %s where %I = $1', fk.t, fk.col) using b.id;
      movidos := movidos || jsonb_build_object(fk.t || '.' || fk.col || ' (descartado, já existia no mantido)', 1);
    end;
  end loop;
  -- completa os campos vazios do que fica com os do excluído
  for col in select column_name from information_schema.columns where table_schema = 'public' and table_name = 'favorecidos'
              and column_name not in ('id', 'empresa_id', 'nome', 'tipo', 'ativo', 'updated_at') loop
    v_set := v_set || format('%1$I = coalesce(f.%1$I, x.%1$I), ', col);
  end loop;
  if v_set <> '' then
    execute format('update favorecidos f set %s updated_at = now() from favorecidos x where f.id = $1 and x.id = $2', v_set) using a.id, b.id;
  end if;
  delete from favorecidos where id = b.id;
  delete from qc_ignorados q where q.empresa_id = a.empresa_id and q.tabela = 'favorecidos' and (q.a = p_excluir or q.b = p_excluir);
  return jsonb_build_object('operacao', v_op, 'mantido', a.id, 'excluido', b.id, 'movidos', movidos);
end $$;
revoke all on function public.mesclar_favorecidos(uuid, uuid) from public, anon;
grant execute on function public.mesclar_favorecidos(uuid, uuid) to authenticated;

comment on table public.qc_ignorados is 'Pares marcados como "não é duplicado" na Qualidade do Cadastro (melhoria 10.1)';

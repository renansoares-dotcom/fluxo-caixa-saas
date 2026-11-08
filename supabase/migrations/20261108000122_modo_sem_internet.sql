-- Modo sem internet (melhoria 1.5 do plano de melhoria contínua) — 08/11/2026.
-- Aditivo. O aparelho guarda o que foi registrado sem sinal e manda quando a internet volta (js/lib/offline.js).
-- Inclusões vão com o id gerado no aparelho (repetir não duplica) e alterações vão pelo id. Para as funções que não
-- são repetíveis (a pesagem da Casa de Tintas), sync_rpc(chave, função, argumentos) executa uma vez só por chave:
-- se a resposta se perdeu no caminho e o aparelho manda de novo, devolve o resultado guardado.
-- Só funções da lista entram; quem executa é o próprio usuário (security invoker: as permissões da função valem).

create table if not exists public.sync_chaves (
  chave uuid primary key,
  user_id uuid not null default auth.uid(),
  nome text not null,
  resultado jsonb,
  criado_em timestamptz not null default now()
);
alter table public.sync_chaves enable row level security;
drop policy if exists sync_chaves_sel on public.sync_chaves;
drop policy if exists sync_chaves_ins on public.sync_chaves;
create policy sync_chaves_sel on public.sync_chaves for select to authenticated using (user_id = auth.uid());
create policy sync_chaves_ins on public.sync_chaves for insert to authenticated with check (user_id = auth.uid());
grant select, insert on public.sync_chaves to authenticated;
create index if not exists sync_chaves_data on public.sync_chaves(criado_em);

create or replace function public.sync_rpc(p_chave uuid, p_nome text, p_args jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r jsonb; v_args text;
begin
  if p_chave is null then raise exception 'Chave obrigatória.'; end if;
  if p_nome is null or p_nome not in ('tin_pesar') then raise exception 'Operação não permitida sem internet: %.', coalesce(p_nome, ''); end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then raise exception 'Argumentos inválidos.'; end if;
  select resultado into r from sync_chaves where chave = p_chave;
  if found then return r; end if;                         -- já executada: devolve o mesmo resultado
  select string_agg(format('%I => %s', k, quote_nullable(v #>> '{}')), ', ' order by k) into v_args
    from jsonb_each(p_args) as x(k, v) where k ~ '^p_[a-z_]+$';
  execute format('select to_jsonb(public.%I(%s))', p_nome, coalesce(v_args, '')) into r;
  insert into sync_chaves(chave, nome, resultado) values (p_chave, p_nome, r);
  return r;
end $$;
revoke all on function public.sync_rpc(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_rpc(uuid, text, jsonb) to authenticated;

-- horas da OS (id sequencial): o aparelho manda uma chave própria para a repetição não duplicar
alter table public.man_os_horas add column if not exists sync_id uuid;
create unique index if not exists man_os_horas_sync on public.man_os_horas(sync_id);

-- limpeza: chaves com mais de 90 dias
create or replace function public._sync_limpar() returns void language sql security definer set search_path = public as $$
  delete from sync_chaves where criado_em < now() - interval '90 days';
$$;
revoke all on function public._sync_limpar() from public, anon, authenticated;
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'sync-limpar';
  perform cron.schedule('sync-limpar', '17 4 * * 0', $job$ select public._sync_limpar(); $job$);
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

select (select count(*) from pg_proc where proname = 'sync_rpc') as funcoes;

-- =====================================================================
-- Melhoria contínua 1.4 — Uso da plataforma (07/11/2026)
-- A própria tela registra, em lote: as telas abertas e o tempo ativo em cada uma (aba em segundo plano não conta), os
-- formulários abertos e se foram concluídos (botão principal) ou abandonados, e os erros mostrados. Só o administrador
-- vê o relatório (Cadastros › Uso da Plataforma). Guardado por N dias (padrão 180) e apagado depois, todo dia.
-- Configurável: ligar/desligar, prazo de guarda e o tempo abaixo do qual a visita conta como "saiu logo".
-- Migração ADITIVA.
-- =====================================================================

create table if not exists public.uso_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default true,
  guardar_dias int not null default 180 check (guardar_dias between 30 and 730),
  rejeicao_segundos int not null default 10 check (rejeicao_segundos between 3 and 120),
  atualizado_por text default (auth.jwt() ->> 'email'), atualizado_em timestamptz not null default now()
);
create table if not exists public.uso_eventos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid default auth.uid(),
  papel text,
  tipo text not null check (tipo in ('tela', 'form', 'erro')),
  rota text not null,
  titulo text,                       -- formulário (título normalizado) ou mensagem de erro
  segundos int not null default 0 check (segundos between 0 and 86400),
  concluido boolean,                 -- formulário: o botão principal foi usado
  criado_em timestamptz not null default now()
);
create index if not exists uso_eventos_emp on public.uso_eventos(empresa_id, criado_em desc);

-- quem grava é o próprio usuário (papel preenchido pelo banco); ninguém lê direto (relatório só pela função)
create or replace function public._uso_evento() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is distinct from auth.uid() then raise exception 'Uso: usuário inválido.'; end if;
  select papel::text into new.papel from membros where empresa_id = new.empresa_id and user_id = auth.uid();
  if new.papel is null then raise exception 'Uso: não participa da empresa.'; end if;
  if exists (select 1 from uso_config where empresa_id = new.empresa_id and not ativo) then return null; end if;
  new.rota := left(new.rota, 80); new.titulo := left(new.titulo, 160); new.criado_em := least(coalesce(new.criado_em, now()), now());
  return new;
end $$;
drop trigger if exists uso_evento on public.uso_eventos;
create trigger uso_evento before insert on public.uso_eventos for each row execute function public._uso_evento();

alter table public.uso_config enable row level security;
alter table public.uso_eventos enable row level security;
drop policy if exists uso_config_sel on public.uso_config; drop policy if exists uso_config_ins on public.uso_config; drop policy if exists uso_config_upd on public.uso_config;
drop policy if exists uso_eventos_ins on public.uso_eventos;
create policy uso_config_sel on public.uso_config for select to authenticated using (public.is_participante(empresa_id));
create policy uso_config_ins on public.uso_config for insert to authenticated with check (public.is_admin(empresa_id));
create policy uso_config_upd on public.uso_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy uso_eventos_ins on public.uso_eventos for insert to authenticated with check (public.is_participante(empresa_id) and user_id = auth.uid());
grant select, insert, update on public.uso_config to authenticated;
grant insert on public.uso_eventos to authenticated;
grant usage on sequence public.uso_eventos_id_seq to authenticated;

/** relatório do período (só administrador) */
create or replace function public.uso_resumo(p_empresa uuid, p_de date, p_ate date, p_papel text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rej int; r jsonb;
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador vê o uso da plataforma.'; end if;
  rej := coalesce((select rejeicao_segundos from uso_config where empresa_id = p_empresa), 10);
  with e as (
    select x.*, coalesce(nullif(trim(m.nome), ''), nullif(trim(u.raw_user_meta_data ->> 'nome'), ''), split_part(u.email::text, '@', 1), 'Usuário') nome, u.email::text email
      from uso_eventos x left join auth.users u on u.id = x.user_id left join membros m on m.empresa_id = x.empresa_id and m.user_id = x.user_id
     where x.empresa_id = p_empresa and x.criado_em >= p_de and x.criado_em < p_ate + 1 and (p_papel is null or x.papel = p_papel)
  ), t as (select * from e where tipo = 'tela')
  select jsonb_build_object(
    'rejeicao_segundos', rej,
    'guardar_dias', coalesce((select guardar_dias from uso_config where empresa_id = p_empresa), 180),
    'kpis', jsonb_build_object(
      'usuarios', (select count(distinct user_id) from t),
      'membros', (select count(*) from membros where empresa_id = p_empresa and (p_papel is null or papel::text = p_papel)),
      'acessos', (select count(*) from t),
      'horas', round((select coalesce(sum(segundos), 0) from t) / 3600.0, 1),
      'dias_pessoa', (select count(distinct (user_id, criado_em::date)) from t),
      'forms', (select count(*) from e where tipo = 'form'),
      'abandonos', (select count(*) from e where tipo = 'form' and not coalesce(concluido, false)),
      'erros', (select count(*) from e where tipo = 'erro')),
    'telas', coalesce((select jsonb_agg(x order by x.acessos desc) from (
        select rota, count(*) acessos, count(distinct user_id) usuarios, sum(segundos) segundos, round(avg(segundos)) media,
               round(100.0 * count(*) filter (where segundos < rej) / count(*), 1) rejeicao
          from t group by rota) x), '[]'::jsonb),
    'perfis', coalesce((select jsonb_agg(x) from (select papel, rota, count(*) acessos, sum(segundos) segundos from t group by papel, rota) x), '[]'::jsonb),
    'pessoas', coalesce((select jsonb_agg(x order by x.segundos desc) from (
        select user_id, max(nome) nome, max(email) email, max(papel) papel, count(*) acessos, sum(segundos) segundos, count(distinct criado_em::date) dias,
               max(criado_em) ultimo, (array_agg(rota order by cnt desc))[1] tela_mais
          from (select t.*, count(*) over (partition by t.user_id, t.rota) cnt from t) z group by user_id) x), '[]'::jsonb),
    'forms', coalesce((select jsonb_agg(x order by x.abandonos desc, x.abertos desc) from (
        select rota, titulo, count(*) abertos, count(*) filter (where coalesce(concluido, false)) concluidos, count(*) filter (where not coalesce(concluido, false)) abandonos,
               round(avg(segundos) filter (where not coalesce(concluido, false))) seg_ate_desistir
          from e where tipo = 'form' group by rota, titulo having count(*) >= 2) x), '[]'::jsonb),
    'erros', coalesce((select jsonb_agg(x order by x.vezes desc) from (
        select rota, titulo, count(*) vezes, count(distinct user_id) usuarios, max(criado_em) ultimo from e where tipo = 'erro' group by rota, titulo limit 100) x), '[]'::jsonb),
    'dias', coalesce((select jsonb_agg(x order by x.dia) from (
        select criado_em::date dia, count(distinct user_id) usuarios, round(sum(segundos) / 3600.0, 1) horas from t group by 1) x), '[]'::jsonb),
    'sem_acesso', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nome', coalesce(nullif(trim(m.nome), ''), split_part(u.email::text, '@', 1)), 'email', u.email, 'papel', m.papel,
         'ultimo', (select max(criado_em) from uso_eventos y where y.empresa_id = p_empresa and y.user_id = m.user_id)))
        from membros m left join auth.users u on u.id = m.user_id
       where m.empresa_id = p_empresa and (p_papel is null or m.papel::text = p_papel)
         and not exists (select 1 from t where t.user_id = m.user_id)), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.uso_resumo(uuid, date, date, text) from public, anon;
grant execute on function public.uso_resumo(uuid, date, date, text) to authenticated;

-- guarda: apaga o que passou do prazo de cada empresa (todo dia, se houver pg_cron)
create or replace function public._uso_limpar() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from uso_eventos x where x.criado_em < now() - make_interval(days => coalesce((select guardar_dias from uso_config c where c.empresa_id = x.empresa_id), 180));
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public._uso_limpar() from public, anon, authenticated;
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'uso-limpar';
  perform cron.schedule('uso-limpar', '41 6 * * *', $job$ select public._uso_limpar(); $job$);
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- conferência: tabelas = 2, função = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('uso_config', 'uso_eventos')) as tabelas,
       (select count(*) from pg_proc where proname = 'uso_resumo') as funcao;

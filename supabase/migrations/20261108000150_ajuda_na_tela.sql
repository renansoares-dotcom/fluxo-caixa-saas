-- Melhoria 10.5 — Ajuda na tela: vídeos curtos por tela (link do YouTube/Drive cadastrado pela empresa), tour de boas-vindas
-- (quem já viu, por usuário e versão do tour) e a configuração (tour ligado). O trecho do manual é montado na tela. Aditivo.

create table if not exists public.ajuda_videos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  rota text not null,
  titulo text not null,
  url text not null check (url ~ '^https://'),
  ordem smallint not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists ajuda_videos_rota on public.ajuda_videos(empresa_id, rota);
create table if not exists public.ajuda_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  tour_ativo boolean not null default true,
  tour_versao smallint not null default 1,             -- aumentar a versão mostra o tour de novo para todos
  atualizado_em timestamptz not null default now()
);
create table if not exists public.ajuda_tour_vistos (
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  versao smallint not null,
  visto_em timestamptz not null default now(),
  primary key (user_id, empresa_id)
);

-- quem entra na empresa (qualquer papel) lê; administrador cadastra
create or replace function public._eh_da_empresa(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid())
$$;
alter table public.ajuda_videos enable row level security;
alter table public.ajuda_config enable row level security;
alter table public.ajuda_tour_vistos enable row level security;
drop policy if exists ajuda_videos_sel on public.ajuda_videos;
create policy ajuda_videos_sel on public.ajuda_videos for select to authenticated using (public._eh_da_empresa(empresa_id));
drop policy if exists ajuda_videos_ins on public.ajuda_videos;
create policy ajuda_videos_ins on public.ajuda_videos for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists ajuda_videos_upd on public.ajuda_videos;
create policy ajuda_videos_upd on public.ajuda_videos for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists ajuda_videos_del on public.ajuda_videos;
create policy ajuda_videos_del on public.ajuda_videos for delete to authenticated using (public.is_admin(empresa_id));
drop policy if exists ajuda_config_sel on public.ajuda_config;
create policy ajuda_config_sel on public.ajuda_config for select to authenticated using (public._eh_da_empresa(empresa_id));
drop policy if exists ajuda_config_ins on public.ajuda_config;
create policy ajuda_config_ins on public.ajuda_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists ajuda_config_upd on public.ajuda_config;
create policy ajuda_config_upd on public.ajuda_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists ajuda_tour_sel on public.ajuda_tour_vistos;
create policy ajuda_tour_sel on public.ajuda_tour_vistos for select to authenticated using (user_id = auth.uid());
drop policy if exists ajuda_tour_ins on public.ajuda_tour_vistos;
create policy ajuda_tour_ins on public.ajuda_tour_vistos for insert to authenticated with check (user_id = auth.uid() and public._eh_da_empresa(empresa_id));
drop policy if exists ajuda_tour_upd on public.ajuda_tour_vistos;
create policy ajuda_tour_upd on public.ajuda_tour_vistos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.ajuda_videos to authenticated;
grant select, insert, update on public.ajuda_config, public.ajuda_tour_vistos to authenticated;

-- o tour aparece? (ligado na empresa e a pessoa ainda não viu esta versão)
create or replace function public.ajuda_tour_pendente(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public._eh_da_empresa(p_empresa)
     and coalesce((select tour_ativo from ajuda_config where empresa_id = p_empresa), true)
     and not exists (select 1 from ajuda_tour_vistos v where v.user_id = auth.uid() and v.empresa_id = p_empresa
                      and v.versao >= coalesce((select tour_versao from ajuda_config where empresa_id = p_empresa), 1))
$$;
create or replace function public.ajuda_tour_visto(p_empresa uuid) returns void language sql security definer set search_path = public as $$
  insert into ajuda_tour_vistos(user_id, empresa_id, versao) select auth.uid(), p_empresa, coalesce((select tour_versao from ajuda_config where empresa_id = p_empresa), 1)
   where public._eh_da_empresa(p_empresa)
  on conflict (user_id, empresa_id) do update set versao = excluded.versao, visto_em = now()
$$;
revoke all on function public.ajuda_tour_pendente(uuid), public.ajuda_tour_visto(uuid) from public, anon;
grant execute on function public.ajuda_tour_pendente(uuid), public.ajuda_tour_visto(uuid) to authenticated;
revoke all on function public._eh_da_empresa(uuid) from public, anon;
grant execute on function public._eh_da_empresa(uuid) to authenticated;

comment on table public.ajuda_videos is 'Vídeos curtos de ajuda por tela, cadastrados pela empresa (melhoria 10.5)';

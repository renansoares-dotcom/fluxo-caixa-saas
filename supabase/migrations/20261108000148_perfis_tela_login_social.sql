-- Melhoria 10.2 — Perfis de acesso por tela, cópia de permissões e entrada com Google/Microsoft.
--  - acesso_perfis: conjunto de telas (rotas) que a pessoa enxerga no menu e pode abrir, além do papel e das áreas;
--    vale para os papéis financeiro, diretor e leitura (administrador vê tudo; compras, vendas, produção, motorista e colaborador já são fixos);
--    o que a pessoa pode ALTERAR continua definido pelo papel e pelas regras do banco.
--  - copiar_permissoes: papel, áreas e perfil de uma pessoa para outra (administrador).
--  - plataforma_login: quais formas de entrar aparecem na tela de login (e-mail e senha, Google, Microsoft); lida sem login.
-- Aditivo.

create table if not exists public.acesso_perfis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  descricao text,
  telas text[] not null default '{}',
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, nome)
);
alter table public.membros add column if not exists perfil_id uuid references public.acesso_perfis(id) on delete set null;

alter table public.acesso_perfis enable row level security;
drop policy if exists acesso_perfis_sel on public.acesso_perfis;
create policy acesso_perfis_sel on public.acesso_perfis for select to authenticated using (public.is_admin(empresa_id)
  or exists (select 1 from membros m where m.empresa_id = acesso_perfis.empresa_id and m.user_id = auth.uid() and m.perfil_id = acesso_perfis.id));
drop policy if exists acesso_perfis_ins on public.acesso_perfis;
create policy acesso_perfis_ins on public.acesso_perfis for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists acesso_perfis_upd on public.acesso_perfis;
create policy acesso_perfis_upd on public.acesso_perfis for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists acesso_perfis_del on public.acesso_perfis;
create policy acesso_perfis_del on public.acesso_perfis for delete to authenticated using (public.is_admin(empresa_id));
grant select, insert, update, delete on public.acesso_perfis to authenticated;
drop trigger if exists zz_auditoria on public.acesso_perfis;
create trigger zz_auditoria after insert or update or delete on public.acesso_perfis for each row execute function public._auditar();

-- perfil da mesma empresa e só nos papéis que usam o menu completo
create or replace function public._membro_perfil() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.perfil_id is not null then
    if (select empresa_id from acesso_perfis where id = new.perfil_id) is distinct from new.empresa_id then raise exception 'Perfil de outra empresa'; end if;
    if new.papel::text not in ('financeiro', 'diretor', 'leitura') then new.perfil_id := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists membro_perfil on public.membros;
create trigger membro_perfil before insert or update of perfil_id, papel on public.membros for each row execute function public._membro_perfil();

-- o perfil de cada membro (para a tela de usuários) e as telas de quem está logado
create or replace function public.membros_perfis(p_empresa uuid) returns table(user_id uuid, perfil_id uuid)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.perfil_id from membros m where m.empresa_id = p_empresa and public.is_admin(p_empresa)
$$;
create or replace function public.minhas_telas(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object('perfil', p.nome, 'telas', to_jsonb(p.telas)) end
    from membros m left join acesso_perfis p on p.id = m.perfil_id where m.empresa_id = p_empresa and m.user_id = auth.uid()
$$;

create or replace function public.copiar_permissoes(p_empresa uuid, p_de uuid, p_para uuid, p_papel boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare d membros;
begin
  if not public.is_admin(p_empresa) then raise exception 'Só o administrador copia permissões'; end if;
  if p_para = auth.uid() then raise exception 'Não dá para mudar as próprias permissões'; end if;
  select * into d from membros where empresa_id = p_empresa and user_id = p_de;
  if d.user_id is null or not exists (select 1 from membros where empresa_id = p_empresa and user_id = p_para) then raise exception 'Usuário não encontrado nesta empresa'; end if;
  if p_papel and d.papel::text = 'admin' then raise exception 'Para tornar alguém administrador, mude o papel diretamente'; end if;
  update membros set papel = case when p_papel then d.papel else papel end, areas = d.areas, perfil_id = d.perfil_id where empresa_id = p_empresa and user_id = p_para;
end $$;

-- ------------------------------------------------------------------ formas de entrar (tela de login)
create table if not exists public.plataforma_login (
  id smallint primary key default 1 check (id = 1),
  senha boolean not null default true,
  google boolean not null default false,
  microsoft boolean not null default false,
  aviso text,
  atualizado_por uuid, atualizado_em timestamptz not null default now()
);
insert into public.plataforma_login(id) values (1) on conflict do nothing;
alter table public.plataforma_login enable row level security;
drop policy if exists plataforma_login_sel on public.plataforma_login;
create policy plataforma_login_sel on public.plataforma_login for select to anon, authenticated using (true);
-- muda quem é administrador em alguma empresa (a plataforma é do grupo)
drop policy if exists plataforma_login_upd on public.plataforma_login;
create policy plataforma_login_upd on public.plataforma_login for update to authenticated
  using (exists (select 1 from membros where user_id = auth.uid() and papel::text = 'admin')) with check (exists (select 1 from membros where user_id = auth.uid() and papel::text = 'admin'));
grant select on public.plataforma_login to anon, authenticated;
grant update on public.plataforma_login to authenticated;
drop trigger if exists zz_auditoria on public.plataforma_login;

do $$ declare f text; begin
  foreach f in array array['membros_perfis(uuid)', 'minhas_telas(uuid)', 'copiar_permissoes(uuid, uuid, uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

comment on table public.acesso_perfis is 'Perfis de acesso por tela (rotas do menu), além do papel e das áreas (melhoria 10.2)';
comment on table public.plataforma_login is 'Formas de entrar na plataforma: e-mail e senha, Google, Microsoft (melhoria 10.2)';

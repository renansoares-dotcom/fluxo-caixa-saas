-- =====================================================================
-- Convites: link de cadastro que já entra na empresa com o papel definido
-- + bloqueio da criação de novas empresas (só libera quem tem acesso ao banco)
-- Migração aditiva: tabelas e funções novas; criar_empresa ganha só a checagem do bloqueio.
-- =====================================================================

-- ---------- Parâmetros da plataforma (não são de uma empresa) ----------
create table if not exists public.plataforma_parametros (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.plataforma_parametros enable row level security;
-- sem políticas: só as funções security definer leem; alterar só pelo SQL Editor
insert into public.plataforma_parametros(chave, valor)
values ('criar_empresa_liberado', 'false'::jsonb)
on conflict (chave) do nothing;

create or replace function public.pode_criar_empresa()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (valor #>> '{}')::boolean from plataforma_parametros where chave = 'criar_empresa_liberado'), false);
$$;

-- criar_empresa: mesmo corpo de antes, com o bloqueio no início
create or replace function public.criar_empresa(p_nome text, p_cnpj text default null, p_ano int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_ano int := coalesce(p_ano, extract(year from now())::int);
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not pode_criar_empresa() then
    raise exception 'A criação de novas empresas está bloqueada. Peça ao administrador um convite para a empresa.';
  end if;
  insert into empresas(nome, cnpj, ano_inicio) values (p_nome, p_cnpj, v_ano) returning id into v_emp;
  insert into membros(empresa_id, user_id, papel) values (v_emp, auth.uid(), 'admin');
  insert into grupos(empresa_id, nome) values (v_emp, 'MATRIZ');
  insert into centros_custo(empresa_id, nome)
    select v_emp, x from unnest(array['ADMINISTRATIVO','COMERCIAL','FINANCEIRO','PRODUÇÃO','LOGISTICA','DIREÇÃO']) x;
  perform aplicar_plano_modelo(v_emp);
  insert into forecast_status(empresa_id, ano, mes) select v_emp, v_ano, m from generate_series(1,12) m;
  return v_emp;
end $$;

-- ---------- Convites ----------
create table if not exists public.convites (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  email text not null,
  papel public.papel_membro not null default 'financeiro',
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '14 days',
  aceito_em timestamptz,
  aceito_por uuid,
  cancelado_em timestamptz
);
create unique index if not exists convites_pendente_uk
  on public.convites(empresa_id, lower(email)) where aceito_em is null and cancelado_em is null;
alter table public.convites enable row level security;
drop policy if exists convites_admin_sel on public.convites;
create policy convites_admin_sel on public.convites for select using (is_admin(empresa_id));
-- gravação só pelas funções abaixo

-- Admin convida: se a pessoa já tem conta, entra direto; senão gera (ou renova) o convite
create or replace function public.criar_convite(p_empresa uuid, p_email text, p_papel public.papel_membro default 'financeiro')
returns json language plpgsql security definer set search_path = public, auth as $$
declare v_email text := lower(trim(p_email)); v_uid uuid; v_token text;
begin
  if not is_admin(p_empresa) then raise exception 'Apenas administradores podem convidar usuários'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %', p_email; end if;
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is not null then
    insert into membros(empresa_id, user_id, papel) values (p_empresa, v_uid, p_papel)
      on conflict (empresa_id, user_id) do update set papel = excluded.papel;
    return json_build_object('tipo', 'membro');
  end if;
  update convites set papel = p_papel, expira_em = now() + interval '14 days', criado_por = auth.uid(), criado_em = now()
   where empresa_id = p_empresa and lower(email) = v_email and aceito_em is null and cancelado_em is null
  returning token into v_token;
  if v_token is null then
    insert into convites(empresa_id, email, papel) values (p_empresa, v_email, p_papel) returning token into v_token;
  end if;
  return json_build_object('tipo', 'convite', 'token', v_token);
end $$;

create or replace function public.cancelar_convite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from convites where id = p_id;
  if v_emp is null or not is_admin(v_emp) then raise exception 'Convite não encontrado'; end if;
  update convites set cancelado_em = now() where id = p_id and aceito_em is null and cancelado_em is null;
end $$;

-- Tela de cadastro: mostra para quem é o convite (só convite pendente e no prazo)
create or replace function public.ver_convite(p_token text)
returns table(empresa text, email text, papel public.papel_membro)
language sql stable security definer set search_path = public as $$
  select e.nome, c.email, c.papel
    from convites c join empresas e on e.id = c.empresa_id
   where c.token = p_token and c.aceito_em is null and c.cancelado_em is null and c.expira_em > now();
$$;

-- Depois do login: entra nas empresas dos convites pendentes do próprio e-mail (já confirmado)
create or replace function public.aceitar_convites()
returns int language plpgsql security definer set search_path = public, auth as $$
declare v_email text; v_conf timestamptz; r record; n int := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(email), email_confirmed_at into v_email, v_conf from auth.users where id = auth.uid();
  if v_email is null or v_conf is null then return 0; end if;
  for r in select * from convites
            where lower(email) = v_email and aceito_em is null and cancelado_em is null and expira_em > now()
  loop
    insert into membros(empresa_id, user_id, papel) values (r.empresa_id, auth.uid(), r.papel)
      on conflict (empresa_id, user_id) do update set papel = excluded.papel;
    update convites set aceito_em = now(), aceito_por = auth.uid() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.criar_convite(uuid, text, public.papel_membro) from public, anon;
revoke all on function public.cancelar_convite(uuid) from public, anon;
revoke all on function public.aceitar_convites() from public, anon;
grant execute on function public.criar_convite(uuid, text, public.papel_membro) to authenticated;
grant execute on function public.cancelar_convite(uuid) to authenticated;
grant execute on function public.aceitar_convites() to authenticated;
grant execute on function public.ver_convite(text) to anon, authenticated;
grant execute on function public.pode_criar_empresa() to anon, authenticated;

-- =====================================================================
-- Melhoria contínua 3.9 — Cenários de caixa (08/11/2026)
-- A Necessidade de Caixa passa a projetar por CENÁRIO (base, otimista, pessimista e personalizados). Cada cenário tem
-- premissas editáveis: quanto dos recebimentos entra e com quanto atraso, quanto dos pagamentos sai, quanto dos vencidos
-- entra, realização do forecast, compromissos programados, simulação do pagamento da Recuperação Judicial e eventos
-- pontuais. Os parâmetros da tela (caixa mínimo, horizonte, contas consideradas, cenário do alerta e quem recebe o aviso)
-- saem do navegador e ficam na empresa. Alerta de caixa mínimo projetado: um aviso por semana crítica.
-- Migração ADITIVA (requer o SQL 101, pela função _dir_pode).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_proc where proname = '_dir_pode') then
    raise exception 'Rode antes o SQL 101 (20261107000101_painel_diretoria.sql). Nada foi alterado.';
  end if;
end $$;

-- quem altera cenários e parâmetros: administrador, diretor e financeiro
create or replace function public._caixa_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public._dir_pode(p_empresa, array['admin', 'diretor', 'financeiro']);
$$;
revoke all on function public._caixa_pode(uuid) from public, anon;
grant execute on function public._caixa_pode(uuid) to authenticated;

create table if not exists public.caixa_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  caixa_minimo numeric(16,2) not null default 50000 check (caixa_minimo >= 0),
  horizonte_semanas smallint not null default 13 check (horizonte_semanas between 4 and 26),
  contas uuid[],                                   -- contas consideradas no saldo de hoje; null = todas, menos as de bloqueio
  cenario_alerta uuid,                             -- cenário que dispara o alerta; null = o cenário base
  avisar boolean not null default true,
  avisar_papeis text[] not null default array['admin', 'diretor', 'financeiro'],
  avisar_semanas smallint not null default 4 check (avisar_semanas between 1 and 26),  -- só avisa se a falta for nas N primeiras semanas
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

create table if not exists public.caixa_cenarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 60),
  tipo text not null default 'personalizado' check (tipo in ('base', 'otimista', 'pessimista', 'personalizado')),
  descricao text,
  cor text,
  ordem smallint not null default 0,
  premissas jsonb not null default '{}'::jsonb check (jsonb_typeof(premissas) = 'object'),
  ativo boolean not null default true,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists caixa_cenarios_nome on public.caixa_cenarios(empresa_id, lower(nome));
-- um só base, um só otimista e um só pessimista por empresa
create unique index if not exists caixa_cenarios_tipo on public.caixa_cenarios(empresa_id, tipo) where tipo <> 'personalizado';

-- semanas críticas já avisadas (um aviso por semana; volta a avisar se a falta piorar mais de 20%)
create table if not exists public.caixa_alertas (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  semana date not null,
  cenario text,
  falta numeric(16,2) not null,
  saldo numeric(16,2),
  avisado_em timestamptz not null default now(),
  primary key (empresa_id, semana)
);

alter table public.caixa_config enable row level security;
alter table public.caixa_cenarios enable row level security;
alter table public.caixa_alertas enable row level security;
drop policy if exists caixa_config_sel on public.caixa_config;
drop policy if exists caixa_config_ins on public.caixa_config;
drop policy if exists caixa_config_upd on public.caixa_config;
drop policy if exists caixa_cenarios_sel on public.caixa_cenarios;
drop policy if exists caixa_cenarios_ins on public.caixa_cenarios;
drop policy if exists caixa_cenarios_upd on public.caixa_cenarios;
drop policy if exists caixa_cenarios_del on public.caixa_cenarios;
drop policy if exists caixa_alertas_sel on public.caixa_alertas;
create policy caixa_config_sel on public.caixa_config for select to authenticated using (public.is_membro(empresa_id));
create policy caixa_config_ins on public.caixa_config for insert to authenticated with check (public._caixa_pode(empresa_id));
create policy caixa_config_upd on public.caixa_config for update to authenticated using (public._caixa_pode(empresa_id)) with check (public._caixa_pode(empresa_id));
create policy caixa_cenarios_sel on public.caixa_cenarios for select to authenticated using (public.is_membro(empresa_id));
create policy caixa_cenarios_ins on public.caixa_cenarios for insert to authenticated with check (public._caixa_pode(empresa_id));
create policy caixa_cenarios_upd on public.caixa_cenarios for update to authenticated using (public._caixa_pode(empresa_id)) with check (public._caixa_pode(empresa_id));
create policy caixa_cenarios_del on public.caixa_cenarios for delete to authenticated using (public._caixa_pode(empresa_id) and tipo = 'personalizado');
create policy caixa_alertas_sel on public.caixa_alertas for select to authenticated using (public.is_membro(empresa_id));
grant select, insert, update on public.caixa_config to authenticated;
grant select, insert, update, delete on public.caixa_cenarios to authenticated;
grant select on public.caixa_alertas to authenticated;

create or replace function public._caixa_atualizado() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists caixa_cenarios_atu on public.caixa_cenarios;
create trigger caixa_cenarios_atu before update on public.caixa_cenarios for each row execute function public._caixa_atualizado();

-- entram na auditoria (migração 038)
drop trigger if exists zz_auditoria on public.caixa_cenarios;
create trigger zz_auditoria after insert or update or delete on public.caixa_cenarios for each row execute function public._auditar();
drop trigger if exists zz_auditoria on public.caixa_config;
create trigger zz_auditoria after insert or update or delete on public.caixa_config for each row execute function public._auditar();

-- tipo de aviso
insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('caixa_minimo', 'Financeiro', 'Caixa abaixo do mínimo projetado', 'A projeção do cenário escolhido fica abaixo do caixa mínimo nas próximas semanas.', false, 15)
on conflict (codigo) do nothing;

/** a projeção é calculada na tela (Necessidade de Caixa, Minha Manhã ou Central de Decisões). Quando o cenário do alerta
    fica abaixo do mínimo, a tela chama esta função: avisa uma vez por semana crítica (e de novo se a falta piorar 20%). */
create or replace function public.caixa_registrar_alerta(p_empresa uuid, p_semana date, p_falta numeric, p_saldo numeric, p_cenario text)
returns boolean language plpgsql security definer set search_path = public as $$
declare c caixa_config; a caixa_alertas; v_users uuid[];
begin
  if not is_membro(p_empresa) then raise exception 'Sem acesso.'; end if;
  if p_falta is null or p_falta <= 0 or p_semana is null then return false; end if;
  select * into c from caixa_config where empresa_id = p_empresa;
  if c.empresa_id is null or not c.avisar then return false; end if;
  -- só a falta dentro da janela do aviso
  if p_semana > (current_date + (c.avisar_semanas * 7)) then return false; end if;
  select * into a from caixa_alertas where empresa_id = p_empresa and semana = p_semana;
  if a.empresa_id is not null and p_falta <= a.falta * 1.2 then return false; end if;
  insert into caixa_alertas(empresa_id, semana, cenario, falta, saldo) values (p_empresa, p_semana, p_cenario, round(p_falta, 2), round(p_saldo, 2))
    on conflict (empresa_id, semana) do update set falta = excluded.falta, saldo = excluded.saldo, cenario = excluded.cenario, avisado_em = now();
  v_users := _usuarios_papel(p_empresa, c.avisar_papeis);
  -- quem calculou também é avisado (o _notificar_u tira o próprio usuário; aqui o aviso é para todos os responsáveis)
  insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link)
  select p_empresa, u, 'caixa_minimo',
         'Caixa abaixo do mínimo na semana de ' || to_char(p_semana, 'DD/MM'),
         'Cenário ' || coalesce(p_cenario, 'base') || ': saldo projetado de R$ ' || to_char(round(p_saldo), 'FM999G999G999G990') ||
         ', faltam R$ ' || to_char(round(p_falta), 'FM999G999G999G990') || ' para o mínimo de R$ ' || to_char(round(c.caixa_minimo), 'FM999G999G999G990') || '.',
         '#/necessidade-caixa'
    from unnest(v_users) u;
  return true;
end $$;
revoke all on function public.caixa_registrar_alerta(uuid, date, numeric, numeric, text) from public, anon;
grant execute on function public.caixa_registrar_alerta(uuid, date, numeric, numeric, text) to authenticated;

-- conferência: tabelas = 3, função = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('caixa_config', 'caixa_cenarios', 'caixa_alertas')) as tabelas,
       (select count(*) from pg_proc where proname = 'caixa_registrar_alerta') as funcao;

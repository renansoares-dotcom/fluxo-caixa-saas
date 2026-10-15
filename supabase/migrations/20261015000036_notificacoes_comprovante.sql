-- =====================================================================
-- Notificações (sino na plataforma + aviso no computador/celular) e comprovante de pagamento do paraquedas
--  - só cria tabelas, funções e o espaço de arquivos; não altera lançamentos nem paraquedas existentes
--  - quem recebe "paraquedas lançado": quem autoriza (administrador, diretor, financeiro)
--  - quem lançou recebe: autorizado, recusado, pago, comprovante anexado, cancelado por outra pessoa
-- =====================================================================

-- 1) notificações por usuário
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  corpo text,
  link text,
  ref_id uuid,
  lida_em timestamptz,
  enviado_em timestamptz,                       -- quando o aviso foi para o computador/celular
  criado_em timestamptz not null default now()
);
create index if not exists notificacoes_user on public.notificacoes(user_id, criado_em desc);
create index if not exists notificacoes_pend on public.notificacoes(criado_em) where enviado_em is null;
alter table public.notificacoes enable row level security;
drop policy if exists notificacoes_sel on public.notificacoes;
drop policy if exists notificacoes_upd on public.notificacoes;
create policy notificacoes_sel on public.notificacoes for select to authenticated using (user_id = (select auth.uid()));
create policy notificacoes_upd on public.notificacoes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.notificacoes to authenticated;
grant update (lida_em) on public.notificacoes to authenticated;   -- o usuário só marca como lida

-- 2) aparelhos (navegadores) que aceitaram receber aviso
create table if not exists public.push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  aparelho text,
  criado_em timestamptz not null default now()
);
create index if not exists push_inscricoes_user on public.push_inscricoes(user_id);
alter table public.push_inscricoes enable row level security;
drop policy if exists push_inscricoes_sel on public.push_inscricoes;
create policy push_inscricoes_sel on public.push_inscricoes for select to authenticated using (user_id = (select auth.uid()));
grant select on public.push_inscricoes to authenticated;

-- o mesmo navegador pode trocar de usuário: a inscrição passa para quem está logado
create or replace function public.registrar_push(p_endpoint text, p_p256dh text, p_auth text, p_aparelho text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  delete from push_inscricoes where endpoint = p_endpoint;
  insert into push_inscricoes(user_id, endpoint, p256dh, auth, aparelho) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_aparelho, 200));
end $$;
create or replace function public.remover_push(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_inscricoes where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke all on function public.registrar_push(text, text, text, text), public.remover_push(text) from public, anon;
grant execute on function public.registrar_push(text, text, text, text), public.remover_push(text) to authenticated;

-- 3) comprovante de pagamento do paraquedas
alter table public.paraquedas add column if not exists comprovante_path text;
alter table public.paraquedas add column if not exists comprovante_nome text;
alter table public.paraquedas add column if not exists comprovante_em timestamptz;
alter table public.paraquedas add column if not exists comprovante_por text;

-- arquivos: paraquedas/<empresa>/<paraquedas>/<arquivo>; privado (só por link temporário)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('paraquedas', 'paraquedas', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public._uuid_ou_nulo(t text) returns uuid language sql immutable as $$
  select case when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid end;
$$;
drop policy if exists paraquedas_arq_sel on storage.objects;
drop policy if exists paraquedas_arq_ins on storage.objects;
drop policy if exists paraquedas_arq_del on storage.objects;
-- vê: quem é da empresa (menos compras) ou quem lançou o paraquedas
create policy paraquedas_arq_sel on storage.objects for select to authenticated using (
  bucket_id = 'paraquedas' and (
    public.is_membro(public._uuid_ou_nulo((storage.foldername(name))[1]))
    or exists (select 1 from public.paraquedas p where p.id = public._uuid_ou_nulo((storage.foldername(name))[2]) and p.criado_por = (select auth.uid()))));
-- anexa e remove: quem edita (financeiro/administrador)
create policy paraquedas_arq_ins on storage.objects for insert to authenticated with check (
  bucket_id = 'paraquedas' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy paraquedas_arq_del on storage.objects for delete to authenticated using (
  bucket_id = 'paraquedas' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- 4) gera as notificações dos paraquedas
create or replace function public._notificar(p_empresa uuid, p_users uuid[], p_tipo text, p_titulo text, p_corpo text, p_link text, p_ref uuid)
returns void language sql security definer set search_path = public as $$
  insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
  select p_empresa, u, p_tipo, p_titulo, p_corpo, p_link, p_ref from unnest(p_users) u
   where u is not null and u is distinct from auth.uid();          -- quem fez a ação não é avisado
$$;
revoke all on function public._notificar(uuid, uuid[], text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public._paraquedas_notifica() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  aprovadores uuid[]; v text; dt text; resumo text;
begin
  select array_agg(user_id) into aprovadores from membros where empresa_id = new.empresa_id and papel::text in ('admin', 'diretor', 'financeiro');
  v := 'R$ ' || translate(to_char(new.valor, 'FM999,999,999,990.00'), ',.', '.,');
  dt := to_char(new.data_pagamento, 'DD/MM');
  resumo := new.razao_social || ' — ' || v || ' · pagar em ' || dt;
  if tg_op = 'INSERT' or (new.status = 'aguardando' and old.status = 'rejeitado') then
    perform _notificar(new.empresa_id, aprovadores, 'paraquedas_novo',
      case when new.prioridade = 'urgente' then 'URGENTE · ' else '' end || 'Paraquedas nº ' || new.numero
        || case when tg_op = 'INSERT' then ' aguardando autorização' else ' reenviado para autorização' end,
      resumo, '#/paraquedas', new.id);
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'aprovado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_aprovado', 'Paraquedas nº ' || new.numero || ' autorizado', resumo, '#/paraquedas', new.id);
    elsif new.status = 'rejeitado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_rejeitado', 'Paraquedas nº ' || new.numero || ' recusado',
        coalesce(new.motivo, 'sem motivo informado') || ' · ' || resumo, '#/paraquedas', new.id);
    elsif new.status = 'pago' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_pago', 'Paraquedas nº ' || new.numero || ' pago', resumo, '#/paraquedas', new.id);
    elsif new.status = 'cancelado' then
      perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_cancelado', 'Paraquedas nº ' || new.numero || ' cancelado',
        coalesce(new.motivo, '') || ' · ' || resumo, '#/paraquedas', new.id);
    end if;
  end if;
  if new.comprovante_path is not null and new.comprovante_path is distinct from old.comprovante_path then
    perform _notificar(new.empresa_id, array[new.criado_por], 'paraquedas_comprovante', 'Comprovante do paraquedas nº ' || new.numero || ' anexado', resumo, '#/paraquedas', new.id);
  end if;
  return new;
end $$;
drop trigger if exists paraquedas_notifica on public.paraquedas;
create trigger paraquedas_notifica after insert or update on public.paraquedas for each row execute function public._paraquedas_notifica();

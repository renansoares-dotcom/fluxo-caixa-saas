-- =====================================================================
-- Melhoria contínua 1.10 — LGPD e revisão de acessos (07/11/2026)
-- 1) Termo de uso e aviso de privacidade no primeiro acesso (equipe e Portal do Cliente), com versão: publicar nova versão pede
--    novo aceite. O aceite fica registrado (quem, quando, qual versão).
-- 2) Revisão de acessos: último acesso de cada pessoa por empresa; quem passa N dias sem entrar (padrão 60) recebe aviso
--    N-7 dias antes e depois é suspenso (ou só avisado, conforme o parâmetro). Suspender guarda o papel e as áreas para reativar.
--    Revisão periódica (padrão a cada 6 meses): o administrador confirma "manter" ou "suspender" pessoa por pessoa.
-- 3) Dados pessoais por titular: busca por CPF, nome ou e-mail em usuários, Portal, beneficiários pessoa física, colaboradores,
--    motoristas, vendedores, transportadores e crachás; relatório com a base legal; anonimização sob pedido (também nas versões
--    guardadas na Auditoria). Registro das solicitações dos titulares com o prazo de resposta (15 dias, LGPD art. 19).
-- Tudo configurável na tela Cadastros › Privacidade e Acessos (CAD011). Migração ADITIVA.
-- =====================================================================

create table if not exists public.lgpd_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  inativos_dias int not null default 60 check (inativos_dias between 15 and 365),
  inativos_acao text not null default 'suspender' check (inativos_acao in ('suspender', 'avisar')),
  aviso_dias int not null default 7 check (aviso_dias between 0 and 30),
  incluir_admin boolean not null default false,
  incluir_portal boolean not null default true,
  revisao_meses int not null default 6 check (revisao_meses between 1 and 24),
  prazo_resposta_dias int not null default 15 check (prazo_resposta_dias between 1 and 60),
  encarregado_nome text, encarregado_email text,
  atualizado_por text default (auth.jwt() ->> 'email'), atualizado_em timestamptz not null default now()
);

create table if not exists public.lgpd_termos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  publico text not null check (publico in ('equipe', 'portal')),
  versao int not null,
  titulo text not null,
  texto text not null check (length(texto) between 50 and 60000),
  publicado_em timestamptz not null default now(),
  publicado_por text default (auth.jwt() ->> 'email'),
  unique (empresa_id, publico, versao)
);
create table if not exists public.lgpd_aceites (
  termo_id uuid not null references public.lgpd_termos(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  aceito_em timestamptz not null default now(),
  navegador text,
  primary key (termo_id, user_id)
);

-- último acesso por pessoa e empresa (fora de membros para não poluir a Auditoria)
create table if not exists public.membros_acessos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null,
  ultimo_acesso timestamptz not null default now(),
  avisado_em timestamptz,
  primary key (empresa_id, user_id)
);
create table if not exists public.acessos_suspensos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null,
  email text, nome text, papel text not null, areas text[],
  motivo text not null,
  automatico boolean not null default false,
  suspenso_em timestamptz not null default now(), suspenso_por text,
  reativado_em timestamptz, reativado_por text
);
create index if not exists acessos_suspensos_emp on public.acessos_suspensos(empresa_id, suspenso_em desc);
create table if not exists public.acessos_revisoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  revisado_em timestamptz not null default now(),
  revisado_por text default (auth.jwt() ->> 'email'),
  mantidos int not null default 0, suspensos int not null default 0,
  itens jsonb not null default '[]',
  observacao text
);
create table if not exists public.lgpd_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  titular_nome text not null, titular_documento text, titular_contato text,
  tipo text not null check (tipo in ('confirmacao', 'acesso', 'correcao', 'anonimizacao', 'portabilidade', 'informacao', 'revogacao', 'oposicao')),
  descricao text,
  recebida_em date not null default current_date,
  prazo date not null,
  status text not null default 'aberta' check (status in ('aberta', 'atendida', 'negada')),
  resposta text,
  atendida_em timestamptz, atendida_por text,
  registros jsonb not null default '[]',      -- o que foi anonimizado por esta solicitação
  criado_em timestamptz not null default now(), criado_por text default (auth.jwt() ->> 'email')
);
create index if not exists lgpd_solic_emp on public.lgpd_solicitacoes(empresa_id, status, prazo);

-- prazo padrão da solicitação = recebida + prazo dos parâmetros
create or replace function public._lgpd_solic_prazo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.prazo is null then new.prazo := new.recebida_em + coalesce((select prazo_resposta_dias from lgpd_config where empresa_id = new.empresa_id), 15); end if;
  if new.status <> 'aberta' and new.atendida_em is null then new.atendida_em := now(); new.atendida_por := auth.jwt() ->> 'email'; end if;
  return new;
end $$;
drop trigger if exists lgpd_solic_prazo on public.lgpd_solicitacoes;
create trigger lgpd_solic_prazo before insert or update on public.lgpd_solicitacoes for each row execute function public._lgpd_solic_prazo();

alter table public.lgpd_config enable row level security;
alter table public.lgpd_termos enable row level security;
alter table public.lgpd_aceites enable row level security;
alter table public.membros_acessos enable row level security;
alter table public.acessos_suspensos enable row level security;
alter table public.acessos_revisoes enable row level security;
alter table public.lgpd_solicitacoes enable row level security;
do $$ declare t text; begin
  foreach t in array array['lgpd_config', 'lgpd_termos', 'lgpd_aceites', 'membros_acessos', 'acessos_suspensos', 'acessos_revisoes', 'lgpd_solicitacoes'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s', t);
  end loop;
end $$;
-- leitura: termos e parâmetros para quem participa (o modal do termo e o encarregado aparecem para todos); o resto só administrador
create policy lgpd_config_sel on public.lgpd_config for select to authenticated using (public.is_participante(empresa_id));
create policy lgpd_config_ins on public.lgpd_config for insert to authenticated with check (public.is_admin(empresa_id));
create policy lgpd_config_upd on public.lgpd_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy lgpd_termos_sel on public.lgpd_termos for select to authenticated using (public.is_participante(empresa_id));
create policy lgpd_aceites_sel on public.lgpd_aceites for select to authenticated using (user_id = auth.uid() or public.is_admin(empresa_id));
create policy membros_acessos_sel on public.membros_acessos for select to authenticated using (public.is_admin(empresa_id));
create policy acessos_suspensos_sel on public.acessos_suspensos for select to authenticated using (public.is_admin(empresa_id));
create policy acessos_revisoes_sel on public.acessos_revisoes for select to authenticated using (public.is_admin(empresa_id));
create policy lgpd_solicitacoes_sel on public.lgpd_solicitacoes for select to authenticated using (public.is_admin(empresa_id));
create policy lgpd_solicitacoes_ins on public.lgpd_solicitacoes for insert to authenticated with check (public.is_admin(empresa_id));
create policy lgpd_solicitacoes_upd on public.lgpd_solicitacoes for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.lgpd_config, public.lgpd_solicitacoes to authenticated;
grant select on public.lgpd_termos, public.lgpd_aceites, public.membros_acessos, public.acessos_suspensos, public.acessos_revisoes to authenticated;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('lgpd', 'Sistema', 'Acessos e privacidade', 'Acesso que vai ser suspenso por falta de uso, acessos suspensos, revisão de acessos e solicitações de titulares com prazo.', false, 91)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------- termo de uso
-- termo vigente de um público (a maior versão)
create or replace function public._lgpd_termo_vigente(p_empresa uuid, p_publico text) returns public.lgpd_termos
language sql stable security definer set search_path = public as $$
  select * from lgpd_termos where empresa_id = p_empresa and publico = p_publico order by versao desc limit 1;
$$;

/** chamada ao entrar na empresa: grava o último acesso e devolve o termo a aceitar (ou null) */
create or replace function public.lgpd_entrar(p_empresa uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t lgpd_termos;
begin
  if not is_participante(p_empresa) then raise exception 'Sem acesso a esta empresa.'; end if;
  insert into membros_acessos(empresa_id, user_id, ultimo_acesso) values (p_empresa, auth.uid(), now())
    on conflict (empresa_id, user_id) do update set ultimo_acesso = now(), avisado_em = null;
  t := _lgpd_termo_vigente(p_empresa, 'equipe');
  if t.id is null or exists (select 1 from lgpd_aceites where termo_id = t.id and user_id = auth.uid()) then return null; end if;
  return jsonb_build_object('id', t.id, 'versao', t.versao, 'titulo', t.titulo, 'texto', t.texto, 'publicado_em', t.publicado_em,
    'anterior', exists (select 1 from lgpd_aceites a join lgpd_termos x on x.id = a.termo_id where x.empresa_id = p_empresa and x.publico = 'equipe' and a.user_id = auth.uid()));
end $$;

/** Portal do Cliente: o primeiro termo do portal ainda não aceito, entre as empresas em que a pessoa é cliente */
create or replace function public.portal_termo_pendente() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object('id', t.id, 'versao', t.versao, 'titulo', t.titulo, 'texto', t.texto, 'empresa', e.nome, 'publicado_em', t.publicado_em) into r
    from (select distinct empresa_id from portal_usuarios where user_id = auth.uid() and ativo) pu
    join empresas e on e.id = pu.empresa_id
    cross join lateral (select * from lgpd_termos x where x.empresa_id = pu.empresa_id and x.publico = 'portal' order by versao desc limit 1) t
   where not exists (select 1 from lgpd_aceites a where a.termo_id = t.id and a.user_id = auth.uid())
   order by e.nome limit 1;
  return r;
end $$;

create or replace function public.lgpd_aceitar(p_termo uuid, p_navegador text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t lgpd_termos;
begin
  select * into t from lgpd_termos where id = p_termo;
  if t.id is null then raise exception 'Termo não encontrado.'; end if;
  if not (is_participante(t.empresa_id) or exists (select 1 from portal_usuarios where user_id = auth.uid() and empresa_id = t.empresa_id and ativo)) then raise exception 'Sem acesso a esta empresa.'; end if;
  if t.id <> (_lgpd_termo_vigente(t.empresa_id, t.publico)).id then raise exception 'Há uma versão mais nova do termo. Recarregue a página.'; end if;
  insert into lgpd_aceites(termo_id, user_id, empresa_id, navegador) values (t.id, auth.uid(), t.empresa_id, left(p_navegador, 200)) on conflict do nothing;
end $$;

/** publica uma nova versão (só administrador): todos precisam aceitar de novo */
create or replace function public.lgpd_publicar_termo(p_empresa uuid, p_publico text, p_titulo text, p_texto text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador publica o termo.'; end if;
  if p_publico not in ('equipe', 'portal') then raise exception 'Público inválido.'; end if;
  if length(trim(coalesce(p_texto, ''))) < 50 then raise exception 'O texto do termo está curto demais.'; end if;
  v := coalesce((select max(versao) from lgpd_termos where empresa_id = p_empresa and publico = p_publico), 0) + 1;
  insert into lgpd_termos(empresa_id, publico, versao, titulo, texto) values (p_empresa, p_publico, v, coalesce(nullif(trim(p_titulo), ''), 'Termo de uso e aviso de privacidade'), trim(p_texto));
  -- o próprio administrador que publica já aceita
  insert into lgpd_aceites(termo_id, user_id, empresa_id, navegador)
    select id, auth.uid(), p_empresa, 'publicação' from lgpd_termos where empresa_id = p_empresa and publico = p_publico and versao = v and p_publico = 'equipe';
  return v;
end $$;

/** situação dos termos: versão vigente, aceites e quem falta (só administrador) */
create or replace function public.lgpd_termos_situacao(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb := '{}'; pub text; t lgpd_termos;
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador.'; end if;
  foreach pub in array array['equipe', 'portal'] loop
    t := _lgpd_termo_vigente(p_empresa, pub);
    r := r || jsonb_build_object(pub, case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'versao', t.versao, 'titulo', t.titulo, 'texto', t.texto, 'publicado_em', t.publicado_em, 'publicado_por', t.publicado_por,
      'pessoas', (select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'nome', p.nome, 'aceito_em', a.aceito_em) order by a.aceito_em nulls first, p.email), '[]')
          from (select m.user_id, u.email::text email, coalesce(nullif(trim(m.nome), ''), split_part(u.email::text, '@', 1)) nome from membros m join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa and pub = 'equipe'
                union all
                select distinct on (pu.user_id) pu.user_id, pu.email, f.nome from portal_usuarios pu join favorecidos f on f.id = pu.favorecido_id where pu.empresa_id = p_empresa and pu.ativo and pub = 'portal') p
          left join lgpd_aceites a on a.termo_id = t.id and a.user_id = p.user_id)) end);
  end loop;
  return r;
end $$;

-- ---------------------------------------------------------------- acessos
create or replace function public._lgpd_cfg(p_empresa uuid) returns public.lgpd_config
language sql stable security definer set search_path = public as $$
  select coalesce((select c from lgpd_config c where c.empresa_id = p_empresa), row(p_empresa, 60, 'suspender', 7, false, true, 6, 15, null, null, null, now())::lgpd_config);
$$;

-- último acesso efetivo: entrada registrada > uso registrado > data em que entrou na empresa
create or replace function public._lgpd_ultimo(p_empresa uuid, p_user uuid, p_desde timestamptz) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest((select ultimo_acesso from membros_acessos where empresa_id = p_empresa and user_id = p_user),
                  (select max(criado_em) from uso_eventos where empresa_id = p_empresa and user_id = p_user),
                  p_desde);
$$;

create or replace function public._lgpd_suspender(p_empresa uuid, p_user uuid, p_motivo text, p_auto boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m membros;
begin
  select * into m from membros where empresa_id = p_empresa and user_id = p_user;
  if m.user_id is null then return; end if;
  insert into acessos_suspensos(empresa_id, user_id, email, nome, papel, areas, motivo, automatico, suspenso_por)
    values (p_empresa, p_user, (select email::text from auth.users where id = p_user), m.nome, m.papel::text, m.areas, p_motivo, p_auto, coalesce(auth.jwt() ->> 'email', 'automático'));
  delete from membros where empresa_id = p_empresa and user_id = p_user;
end $$;
revoke all on function public._lgpd_suspender(uuid, uuid, text, boolean) from public, anon, authenticated;

/** painel da revisão de acessos (só administrador) */
create or replace function public.acessos_situacao(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c lgpd_config; r jsonb;
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador revisa os acessos.'; end if;
  c := _lgpd_cfg(p_empresa);
  with m as (
    select m.user_id, u.email::text email, coalesce(nullif(trim(m.nome), ''), split_part(u.email::text, '@', 1)) nome, m.papel::text papel, m.areas, m.created_at,
           _lgpd_ultimo(p_empresa, m.user_id, m.created_at) ultimo,
           (select avisado_em from membros_acessos a where a.empresa_id = p_empresa and a.user_id = m.user_id) avisado_em
      from membros m join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa
  )
  select jsonb_build_object(
    'config', to_jsonb(c),
    'membros', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'nome', nome, 'papel', papel, 'areas', areas, 'desde', created_at,
         'ultimo', ultimo, 'dias', floor(extract(epoch from now() - ultimo) / 86400), 'avisado_em', avisado_em,
         'protegido', papel = 'admin' and not c.incluir_admin, 'eu', user_id = auth.uid()) order by ultimo) from m), '[]'),
    'suspensos', coalesce((select jsonb_agg(to_jsonb(s) order by s.suspenso_em desc) from (select * from acessos_suspensos where empresa_id = p_empresa order by suspenso_em desc limit 100) s), '[]'),
    'portal', coalesce((select jsonb_agg(jsonb_build_object('id', pu.id, 'email', pu.email, 'cliente', f.nome, 'ativo', pu.ativo, 'ultimo', coalesce(pu.ultimo_acesso, pu.criado_em),
         'nunca', pu.ultimo_acesso is null, 'dias', floor(extract(epoch from now() - coalesce(pu.ultimo_acesso, pu.criado_em)) / 86400)) order by coalesce(pu.ultimo_acesso, pu.criado_em))
         from portal_usuarios pu join favorecidos f on f.id = pu.favorecido_id where pu.empresa_id = p_empresa), '[]'),
    'revisoes', coalesce((select jsonb_agg(to_jsonb(v) - 'itens' order by v.revisado_em desc) from (select * from acessos_revisoes where empresa_id = p_empresa order by revisado_em desc limit 20) v), '[]'),
    'ultima_revisao', (select max(revisado_em) from acessos_revisoes where empresa_id = p_empresa),
    'proxima_revisao', (select (coalesce(max(revisado_em), (select min(created_at) from membros where empresa_id = p_empresa)) + make_interval(months => c.revisao_meses))::date from acessos_revisoes where empresa_id = p_empresa)
  ) into r;
  return r;
end $$;

create or replace function public.acesso_suspender(p_empresa uuid, p_user uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador suspende acessos.'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode suspender o próprio acesso.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo.'; end if;
  perform _lgpd_suspender(p_empresa, p_user, trim(p_motivo), false);
end $$;

create or replace function public.acesso_reativar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s acessos_suspensos;
begin
  select * into s from acessos_suspensos where id = p_id;
  if s.id is null or not is_admin(s.empresa_id) then raise exception 'Só o administrador reativa acessos.'; end if;
  if s.reativado_em is not null then raise exception 'Este acesso já foi reativado.'; end if;
  insert into membros(empresa_id, user_id, papel, nome, areas) values (s.empresa_id, s.user_id, s.papel::papel_membro, s.nome, s.areas) on conflict do nothing;
  -- conta a partir de hoje, para não suspender de novo no dia seguinte
  insert into membros_acessos(empresa_id, user_id, ultimo_acesso) values (s.empresa_id, s.user_id, now()) on conflict (empresa_id, user_id) do update set ultimo_acesso = now(), avisado_em = null;
  update acessos_suspensos set reativado_em = now(), reativado_por = auth.jwt() ->> 'email' where id = p_id;
end $$;

/** revisão periódica: p_itens = [{user_id, decisao: 'manter'|'suspender', motivo}] */
create or replace function public.acessos_revisar(p_empresa uuid, p_itens jsonb, p_obs text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare i jsonb; man int := 0; sus int := 0; v_id uuid; det jsonb := '[]';
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador revisa os acessos.'; end if;
  for i in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    if (i ->> 'user_id')::uuid = auth.uid() then i := jsonb_set(i, '{decisao}', '"manter"'); end if;
    det := det || jsonb_build_array(i || jsonb_build_object('email', (select u.email::text from auth.users u where u.id = (i ->> 'user_id')::uuid),
             'papel', (select papel::text from membros where empresa_id = p_empresa and user_id = (i ->> 'user_id')::uuid)));
    if i ->> 'decisao' = 'suspender' then
      perform _lgpd_suspender(p_empresa, (i ->> 'user_id')::uuid, coalesce(nullif(trim(i ->> 'motivo'), ''), 'Revisão periódica de acessos'), false); sus := sus + 1;
    else man := man + 1; end if;
  end loop;
  if man + sus = 0 then raise exception 'Nenhuma pessoa na revisão.'; end if;
  insert into acessos_revisoes(empresa_id, mantidos, suspensos, itens, observacao) values (p_empresa, man, sus, det, nullif(trim(p_obs), '')) returning acessos_revisoes.id into v_id;
  return v_id;
end $$;

/** agendamento diário: avisa quem vai perder o acesso e suspende quem passou do prazo; Portal sem uso é bloqueado */
create or replace function public._lgpd_revisar_inativos() returns int
language plpgsql security definer set search_path = public as $$
declare e record; c lgpd_config; m record; n int := 0; adm uuid[]; lista text[]; port int;
begin
  for e in select id from empresas loop
    c := _lgpd_cfg(e.id); adm := _usuarios_papel(e.id, array['admin']); lista := '{}';
    for m in select x.*, floor(extract(epoch from now() - x.ultimo) / 86400) dias from (
        select mb.user_id, mb.papel::text papel, coalesce(nullif(trim(mb.nome), ''), split_part(u.email::text, '@', 1)) nome,
               _lgpd_ultimo(e.id, mb.user_id, mb.created_at) ultimo, a.avisado_em
          from membros mb join auth.users u on u.id = mb.user_id left join membros_acessos a on a.empresa_id = mb.empresa_id and a.user_id = mb.user_id
         where mb.empresa_id = e.id and (mb.papel <> 'admin' or (c.incluir_admin and (select count(*) from membros z where z.empresa_id = e.id and z.papel = 'admin') > 1))) x loop
      if m.dias >= c.inativos_dias then
        if c.inativos_acao = 'suspender' then
          perform _lgpd_suspender(e.id, m.user_id, format('Sem acesso há %s dias (automático)', m.dias), true);
          lista := lista || format('%s (suspenso)', m.nome); n := n + 1;
        elsif m.avisado_em is null then
          insert into membros_acessos(empresa_id, user_id, ultimo_acesso, avisado_em) values (e.id, m.user_id, m.ultimo, now())
            on conflict (empresa_id, user_id) do update set avisado_em = now();
          lista := lista || format('%s (%s dias sem acesso)', m.nome, m.dias); n := n + 1;
        end if;
      elsif m.dias >= c.inativos_dias - c.aviso_dias and m.avisado_em is null and c.inativos_acao = 'suspender' then
        insert into membros_acessos(empresa_id, user_id, ultimo_acesso, avisado_em) values (e.id, m.user_id, m.ultimo, now())
          on conflict (empresa_id, user_id) do update set avisado_em = now();
        perform _notificar_u(e.id, array[m.user_id], 'lgpd', 'Seu acesso vai ser suspenso por falta de uso',
          format('Você não entra na plataforma há %s dias. Entre até %s para manter o acesso.', m.dias, to_char(m.ultimo + make_interval(days => c.inativos_dias), 'DD/MM/YYYY')), '#/hoje', null, false);
        lista := lista || format('%s (será suspenso em %s dias)', m.nome, c.inativos_dias - m.dias); n := n + 1;
      end if;
    end loop;
    port := 0;
    if c.incluir_portal then
      update portal_usuarios set ativo = false where empresa_id = e.id and ativo and coalesce(ultimo_acesso, criado_em) < now() - make_interval(days => c.inativos_dias);
      get diagnostics port = row_count;
      if port > 0 then lista := lista || format('%s acesso(s) do Portal do Cliente bloqueado(s)', port); n := n + port; end if;
    end if;
    if cardinality(lista) > 0 then
      perform _notificar_u(e.id, adm, 'lgpd', 'Revisão automática de acessos', array_to_string(lista, '; '), '#/lgpd', null, false);
    end if;
  end loop;
  return n;
end $$;
revoke all on function public._lgpd_revisar_inativos() from public, anon, authenticated;

-- ---------------------------------------------------------------- dados pessoais por titular
create or replace function public._lgpd_dig(t text) returns text language sql immutable as $$ select nullif(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '') $$;

/** onde estão os dados de um titular (CPF, nome ou e-mail) — só administrador */
create or replace function public.lgpd_dados_titular(p_empresa uuid, p_busca text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b text := trim(coalesce(p_busca, '')); d text := _lgpd_dig(p_busca); txt text; r jsonb := '[]';
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador consulta os dados pessoais.'; end if;
  if length(b) < 3 then raise exception 'Digite ao menos 3 caracteres (CPF, nome ou e-mail).'; end if;
  if d is not null and length(d) < 6 then d := null; end if;      -- poucos dígitos: busca só pelo texto
  txt := '%' || b || '%';
  -- usuários da plataforma
  r := r || coalesce((select jsonb_agg(jsonb_build_object('origem', 'usuario', 'tabela', 'membros', 'id', m.user_id, 'nome', coalesce(nullif(trim(m.nome), ''), u.email::text),
      'campos', jsonb_build_object('E-mail', u.email, 'Papel', m.papel, 'Áreas', coalesce(array_to_string(m.areas, ', '), 'todas'), 'Na empresa desde', to_char(m.created_at, 'DD/MM/YYYY'),
         'Último acesso', to_char(_lgpd_ultimo(p_empresa, m.user_id, m.created_at), 'DD/MM/YYYY'),
         'Termos aceitos', (select string_agg(format('%s v%s em %s', case t.publico when 'equipe' then 'Termo de uso' else 'Portal' end, t.versao, to_char(a.aceito_em, 'DD/MM/YYYY')), '; ') from lgpd_aceites a join lgpd_termos t on t.id = a.termo_id where a.user_id = m.user_id and a.empresa_id = p_empresa),
         'Registros de uso', (select count(*) from uso_eventos x where x.empresa_id = p_empresa and x.user_id = m.user_id)),
      'base_legal', 'Execução do contrato de trabalho/prestação e legítimo interesse (controle de acesso e segurança)', 'ativo', true))
    from membros m join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa and (u.email ilike txt or m.nome ilike txt)), '[]');
  -- Portal do Cliente
  r := r || coalesce((select jsonb_agg(jsonb_build_object('origem', 'portal', 'tabela', 'portal_usuarios', 'id', pu.id, 'nome', pu.email,
      'campos', jsonb_build_object('E-mail', pu.email, 'Cliente', f.nome, 'Desde', to_char(pu.criado_em, 'DD/MM/YYYY'), 'Último acesso', coalesce(to_char(pu.ultimo_acesso, 'DD/MM/YYYY'), 'nunca'), 'Situação', case when pu.ativo then 'ativo' else 'bloqueado' end),
      'base_legal', 'Execução de contrato (acesso do cliente aos títulos, notas e artes)', 'ativo', pu.ativo))
    from portal_usuarios pu join favorecidos f on f.id = pu.favorecido_id where pu.empresa_id = p_empresa and pu.email ilike txt), '[]');
  -- beneficiários pessoa física (cliente, fornecedor, representante)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('origem', 'favorecido', 'tabela', 'favorecidos', 'id', f.id, 'nome', f.nome,
      'campos', jsonb_strip_nulls(jsonb_build_object('Tipo', f.tipo, 'CPF', f.documento, 'E-mail', f.email, 'Telefone', f.telefone, 'Pix', f.pix, 'Dados bancários', f.dados_bancarios,
         'Endereço', nullif(concat_ws(', ', f.logradouro, f.numero, f.complemento, f.bairro, f.municipio, f.uf, f.cep), ''), 'Observação', f.observacao,
         'Lançamentos ligados', (select count(*) from lancamentos l where l.favorecido_id = f.id))),
      'base_legal', 'Execução de contrato e obrigação legal (fiscal e contábil: os lançamentos e as notas ficam guardados)', 'ativo', f.ativo))
    from favorecidos f where f.empresa_id = p_empresa and (f.tipo_pessoa = 'PF' or length(_lgpd_dig(f.documento)) = 11)
      and ((d is not null and _lgpd_dig(f.documento) like '%' || d || '%') or f.nome ilike txt or f.email ilike txt)), '[]');
  -- colaboradores
  r := r || coalesce((select jsonb_agg(jsonb_build_object('origem', 'colaborador', 'tabela', 'rh_colaboradores', 'id', c.id, 'nome', c.nome,
      'campos', jsonb_strip_nulls(jsonb_build_object('CPF', c.cpf, 'Matrícula', c.matricula, 'Cargo', c.cargo, 'Setor', c.setor, 'Vínculo', c.vinculo, 'Situação', c.situacao,
         'Admissão', to_char(c.admissao, 'DD/MM/YYYY'), 'Desligamento', to_char(c.demissao, 'DD/MM/YYYY'), 'Salário', c.salario, 'Pix', c.pix,
         'Foto', case when c.foto_path is not null then 'sim' end, 'Autorização de imagem', to_char(c.autorizacao_imagem, 'DD/MM/YYYY'),
         'Histórico salarial', (select count(*) from rh_salarios s where s.colaborador_id = c.id))),
      'base_legal', 'Obrigação legal trabalhista e previdenciária (guarda mínima de 5 anos após o desligamento)', 'ativo', c.situacao <> 'desligado'))
    from rh_colaboradores c where c.empresa_id = p_empresa and ((d is not null and _lgpd_dig(c.cpf) like '%' || d || '%') or c.nome ilike txt)), '[]');
  -- motoristas
  r := r || coalesce((select jsonb_agg(jsonb_build_object('origem', 'motorista', 'tabela', 'frota_motoristas', 'id', x.id, 'nome', x.nome,
      'campos', jsonb_strip_nulls(jsonb_build_object('CPF', x.cpf, 'Vínculo', x.vinculo, 'CNH', nullif(concat_ws(' · ', x.cnh_numero, x.cnh_categoria, 'validade ' || to_char(x.cnh_validade, 'DD/MM/YYYY')), ''),
         'Toxicológico', to_char(x.toxicologico_validade, 'DD/MM/YYYY'), 'MOPP', to_char(x.mopp_validade, 'DD/MM/YYYY'), 'Observação', x.observacao)),
      'base_legal', 'Obrigação legal (Código de Trânsito e Lei 13.103/2015) e execução de contrato', 'ativo', x.ativo))
    from frota_motoristas x where x.empresa_id = p_empresa and ((d is not null and _lgpd_dig(x.cpf) like '%' || d || '%') or x.nome ilike txt)), '[]');
  -- vendedores
  r := r || coalesce((select jsonb_agg(jsonb_build_object('origem', 'vendedor', 'tabela', 'comercial_vendedores', 'id', v.id, 'nome', v.nome,
      'campos', jsonb_strip_nulls(jsonb_build_object('E-mail', v.email, 'Desde', to_char(v.criado_em, 'DD/MM/YYYY'))),
      'base_legal', 'Execução de contrato de representação', 'ativo', v.ativo))
    from comercial_vendedores v where v.empresa_id = p_empresa and (v.nome ilike txt or v.email ilike txt)), '[]');
  -- transportadores autônomos (CPF)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('origem', 'transportador', 'tabela', 'log_transportadores', 'id', t.id, 'nome', t.nome,
      'campos', jsonb_strip_nulls(jsonb_build_object('CPF', t.documento, 'RNTRC', t.rntrc, 'Conta', nullif(concat_ws(' ', t.conta_banco, t.conta_agencia, t.conta_numero), ''), 'Pix', t.conta_pix, 'Titular da conta', t.conta_titular)),
      'base_legal', 'Execução de contrato de transporte e obrigação legal (CIOT, ANTT)', 'ativo', t.ativo))
    from log_transportadores t where t.empresa_id = p_empresa and length(_lgpd_dig(t.documento)) = 11
      and ((d is not null and _lgpd_dig(t.documento) like '%' || d || '%') or t.nome ilike txt)), '[]');
  -- crachás de terceiros e visitantes (os dos colaboradores saem junto com o colaborador)
  r := r || coalesce((select jsonb_agg(jsonb_build_object('origem', 'cracha', 'tabela', 'crachas', 'id', k.id, 'nome', k.nome,
      'campos', jsonb_strip_nulls(jsonb_build_object('Tipo', k.tipo, 'Documento', k.documento, 'Empresa', k.empresa_terceiro, 'Emitido em', to_char(k.emitido_em, 'DD/MM/YYYY'), 'Foto', case when k.foto_path is not null then 'sim' end, 'Situação', k.status)),
      'base_legal', 'Legítimo interesse (segurança e controle de entrada)', 'ativo', k.status = 'ativo'))
    from crachas k where k.empresa_id = p_empresa and k.colaborador_id is null and ((d is not null and _lgpd_dig(k.documento) like '%' || d || '%') or k.nome ilike txt)), '[]');
  return r;
end $$;

-- troca os campos pessoais de uma versão guardada na Auditoria
create or replace function public._lgpd_mascarar(j jsonb) returns jsonb language sql immutable as $$
  select case when j is null then null else (
    select coalesce(jsonb_object_agg(k, case when k = any (array['nome', 'documento', 'cpf', 'email', 'telefone', 'pix', 'dados_bancarios', 'logradouro', 'numero', 'complemento', 'bairro', 'cep',
        'cnh_numero', 'observacao', 'conta_numero', 'conta_agencia', 'conta_pix', 'conta_titular', 'endereco', 'motoristas', 'foto_path', 'matricula', 'salario', 'autorizacao_imagem'])
        and v <> 'null'::jsonb then '"[anonimizado]"'::jsonb else v end), '{}'::jsonb) from jsonb_each(j) e(k, v)) end;
$$;

/** anonimização sob pedido do titular — só administrador; registros financeiros, fiscais e de folha continuam (obrigação legal) */
create or replace function public.lgpd_anonimizar(p_empresa uuid, p_origem text, p_id uuid, p_solicitacao uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare anon text := 'TITULAR ANONIMIZADO ' || upper(left(p_id::text, 8)); tab text; nome_ant text;
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador anonimiza dados pessoais.'; end if;
  case p_origem
  when 'favorecido' then
    tab := 'favorecidos';
    select nome into nome_ant from favorecidos where id = p_id and empresa_id = p_empresa;
    update favorecidos set nome = anon, sigla = null, nome_fantasia = null, documento = null, email = null, telefone = null, pix = null, dados_bancarios = null,
      logradouro = null, numero = null, complemento = null, bairro = null, cep = null, observacao = null, ativo = false
     where id = p_id and empresa_id = p_empresa;
    update portal_usuarios set ativo = false where favorecido_id = p_id and empresa_id = p_empresa;
  when 'colaborador' then
    tab := 'rh_colaboradores';
    select nome into nome_ant from rh_colaboradores where id = p_id and empresa_id = p_empresa;
    if exists (select 1 from rh_colaboradores where id = p_id and situacao <> 'desligado') then raise exception 'Colaborador ativo ou afastado: anonimize só depois do desligamento.'; end if;
    update rh_colaboradores set nome = anon, cpf = null, pix = null, foto_path = null, autorizacao_imagem = null, observacao = null where id = p_id and empresa_id = p_empresa;
    update crachas set nome = anon, documento = null, foto_path = null where colaborador_id = p_id and empresa_id = p_empresa;
    update frota_motoristas set nome = anon, cpf = null, cnh_numero = null, observacao = null, ativo = false where colaborador_id = p_id and empresa_id = p_empresa;
  when 'motorista' then
    tab := 'frota_motoristas';
    select nome into nome_ant from frota_motoristas where id = p_id and empresa_id = p_empresa;
    if exists (select 1 from frota_motoristas where id = p_id and ativo) then raise exception 'Motorista ativo: inative antes de anonimizar.'; end if;
    update frota_motoristas set nome = anon, cpf = null, cnh_numero = null, observacao = null where id = p_id and empresa_id = p_empresa;
  when 'vendedor' then
    tab := 'comercial_vendedores';
    select nome into nome_ant from comercial_vendedores where id = p_id and empresa_id = p_empresa;
    if exists (select 1 from comercial_vendedores where id = p_id and ativo) then raise exception 'Vendedor ativo: inative antes de anonimizar.'; end if;
    update comercial_vendedores set nome = anon, email = null where id = p_id and empresa_id = p_empresa;
  when 'transportador' then
    tab := 'log_transportadores';
    select nome into nome_ant from log_transportadores where id = p_id and empresa_id = p_empresa;
    if exists (select 1 from log_transportadores where id = p_id and ativo) then raise exception 'Transportador ativo: inative antes de anonimizar.'; end if;
    update log_transportadores set nome = anon, documento = null, conta_banco = null, conta_agencia = null, conta_numero = null, conta_pix = null, conta_titular = null,
      endereco = null, motoristas = '[]', observacao = null where id = p_id and empresa_id = p_empresa;
  when 'cracha' then
    tab := 'crachas';
    select nome into nome_ant from crachas where id = p_id and empresa_id = p_empresa and colaborador_id is null;
    update crachas set nome = anon, documento = null, foto_path = null, empresa_terceiro = null, status = case when status = 'ativo' then 'cancelado' else status end
     where id = p_id and empresa_id = p_empresa and colaborador_id is null;
  when 'portal' then
    tab := 'portal_usuarios';
    select email into nome_ant from portal_usuarios where id = p_id and empresa_id = p_empresa;
    update portal_usuarios set ativo = false, email = anon where id = p_id and empresa_id = p_empresa;
  else raise exception 'Origem inválida: %. Usuários da plataforma: suspenda o acesso na Revisão de acessos.', p_origem;
  end case;
  if nome_ant is null then raise exception 'Registro não encontrado nesta empresa.'; end if;
  -- as versões guardadas na Auditoria (inclusive a desta alteração) também perdem os dados pessoais
  update auditoria set antes = _lgpd_mascarar(antes), depois = _lgpd_mascarar(depois) where tabela = tab and registro_id = p_id::text;
  if tab = 'rh_colaboradores' then
    update auditoria a set antes = _lgpd_mascarar(antes), depois = _lgpd_mascarar(depois)
     where a.tabela in ('crachas', 'frota_motoristas') and a.registro_id in (select id::text from crachas where colaborador_id = p_id union all select id::text from frota_motoristas where colaborador_id = p_id);
  end if;
  update audit_alertas set detalhe = replace(detalhe, nome_ant, anon) where empresa_id = p_empresa and detalhe like '%' || nome_ant || '%';
  if p_solicitacao is not null then
    update lgpd_solicitacoes set registros = registros || jsonb_build_array(jsonb_build_object('origem', p_origem, 'id', p_id, 'em', now(), 'por', auth.jwt() ->> 'email'))
     where id = p_solicitacao and empresa_id = p_empresa;
  end if;
  return anon;
end $$;

do $$ declare f text; begin
  foreach f in array array['lgpd_entrar(uuid)', 'portal_termo_pendente()', 'lgpd_aceitar(uuid, text)', 'lgpd_publicar_termo(uuid, text, text, text)', 'lgpd_termos_situacao(uuid)',
    'acessos_situacao(uuid)', 'acesso_suspender(uuid, uuid, text)', 'acesso_reativar(uuid)', 'acessos_revisar(uuid, jsonb, text)', 'lgpd_dados_titular(uuid, text)', 'lgpd_anonimizar(uuid, text, uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_lgpd_termo_vigente(uuid, text)', '_lgpd_cfg(uuid)', '_lgpd_ultimo(uuid, uuid, timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- agendamento diário (se houver pg_cron)
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'lgpd-acessos';
  perform cron.schedule('lgpd-acessos', '47 9 * * *', $job$ select public._lgpd_revisar_inativos(); $job$);
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- conferência: tabelas = 7, funções = 11
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('lgpd_config', 'lgpd_termos', 'lgpd_aceites', 'membros_acessos', 'acessos_suspensos', 'acessos_revisoes', 'lgpd_solicitacoes')) as tabelas,
       (select count(*) from pg_proc where proname in ('lgpd_entrar', 'portal_termo_pendente', 'lgpd_aceitar', 'lgpd_publicar_termo', 'lgpd_termos_situacao', 'acessos_situacao', 'acesso_suspender', 'acesso_reativar', 'acessos_revisar', 'lgpd_dados_titular', 'lgpd_anonimizar')) as funcoes;

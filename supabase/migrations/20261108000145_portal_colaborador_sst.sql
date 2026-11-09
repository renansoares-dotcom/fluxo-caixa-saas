-- Melhoria 8.2 — Portal do colaborador e SST:
--  - perfil novo "colaborador": entra só no Meu Portal (holerites e documentos, férias, treinamentos e ASO dele);
--  - documentos do RH por colaborador (holerite, informe de rendimentos, aviso de férias…) no espaço privado rh-docs, com ciência;
--  - SST e treinamentos: tipos (ASO, NR, treinamento) com validade, obrigatoriedade por cargo/setor e antecedência do aviso;
--    registros por pessoa, situação (em dia, a vencer, vencido, pendente) e aviso diário ao RH.
-- Aditivo (o enum ganha um valor; is_membro e minhas_empresas passam a excluir também o colaborador).

alter type public.papel_membro add value if not exists 'colaborador';

-- o colaborador não é membro "pleno" (mesma regra de compras, vendas, produção e motorista)
create or replace function public.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text not in ('compras', 'vendas', 'producao', 'motorista', 'colaborador')))
     and public._mfa_ok(p_empresa);
$$;
create or replace function public.minhas_empresas()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.empresa_id from membros m
   where m.user_id = auth.uid() and m.papel::text not in ('compras', 'vendas', 'producao', 'motorista', 'colaborador') and public._mfa_ok(m.empresa_id);
$$;

alter table public.rh_colaboradores add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists rh_colab_user on public.rh_colaboradores(empresa_id, user_id) where user_id is not null;

-- o colaborador ligado ao usuário (na empresa)
create or replace function public._meu_colaborador(p_empresa uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from rh_colaboradores where empresa_id = p_empresa and user_id = auth.uid() limit 1
$$;
revoke all on function public._meu_colaborador(uuid) from public, anon;
grant execute on function public._meu_colaborador(uuid) to authenticated;

-- ------------------------------------------------------------------ configuração do portal e do SST
create table if not exists public.rh_portal_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default true,
  mostrar_ferias boolean not null default true,
  mostrar_sst boolean not null default true,
  mensagem text,
  sst_avisar boolean not null default true,
  sst_avisar_colaborador boolean not null default true,
  atualizado_em timestamptz not null default now()
);

-- ------------------------------------------------------------------ documentos
create table if not exists public.rh_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  colaborador_id uuid not null references public.rh_colaboradores(id) on delete cascade,
  tipo text not null default 'holerite' check (tipo in ('holerite', 'informe_rendimentos', 'aviso_ferias', 'contrato', 'certificado', 'aso', 'outro')),
  competencia date,
  titulo text not null,
  path text not null,
  tamanho bigint,
  publicado boolean not null default true,
  visto_em timestamptz,
  enviado_por uuid default auth.uid(), enviado_em timestamptz not null default now()
);
create index if not exists rh_docs_colab on public.rh_documentos(colaborador_id, competencia desc);

-- ------------------------------------------------------------------ SST e treinamentos
create table if not exists public.rh_sst_tipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  categoria text not null default 'treinamento' check (categoria in ('aso', 'nr', 'treinamento', 'outro')),
  validade_meses smallint check (validade_meses is null or validade_meses between 1 and 120),   -- null = não vence
  antecedencia_dias smallint not null default 30 check (antecedencia_dias between 0 and 180),
  todos boolean not null default false,            -- obrigatório para todos os CLT
  cargos text[] not null default '{}',             -- obrigatório para cargos que contenham estes termos
  setores text[] not null default '{}',
  ativo boolean not null default true,
  unique (empresa_id, nome)
);
create table if not exists public.rh_sst_registros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  colaborador_id uuid not null references public.rh_colaboradores(id) on delete cascade,
  tipo_id uuid not null references public.rh_sst_tipos(id) on delete cascade,
  realizado_em date not null,
  vence_em date,
  resultado text check (resultado is null or resultado in ('apto', 'inapto', 'apto_restricao', 'concluido', 'reprovado')),
  carga_horaria numeric(6,1),
  instrutor text,
  documento_id uuid references public.rh_documentos(id) on delete set null,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists rh_sst_reg_colab on public.rh_sst_registros(colaborador_id, tipo_id, realizado_em desc);
create table if not exists public.rh_sst_avisos_enviados (empresa_id uuid not null references public.empresas(id) on delete cascade, dia date not null, primary key (empresa_id, dia));

do $$ declare t text; begin
  foreach t in array array['rh_portal_config', 'rh_documentos', 'rh_sst_tipos', 'rh_sst_registros'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_rh(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.edita_rh(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.edita_rh(empresa_id)) with check (public.edita_rh(empresa_id))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.edita_rh(empresa_id))', t || '_del', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
alter table public.rh_sst_avisos_enviados enable row level security;

-- vencimento pelo tipo; colaborador e tipo da mesma empresa
create or replace function public._rh_sst_antes() returns trigger language plpgsql security definer set search_path = public as $$
declare v_t rh_sst_tipos;
begin
  select * into v_t from rh_sst_tipos where id = new.tipo_id;
  if v_t.empresa_id is distinct from new.empresa_id or (select empresa_id from rh_colaboradores where id = new.colaborador_id) is distinct from new.empresa_id then
    raise exception 'Colaborador ou tipo de outra empresa';
  end if;
  if new.vence_em is null or tg_op = 'UPDATE' and (new.realizado_em is distinct from old.realizado_em or new.tipo_id is distinct from old.tipo_id) then
    new.vence_em := case when v_t.validade_meses is null then null else (new.realizado_em + make_interval(months => v_t.validade_meses))::date end;
  end if;
  return new;
end $$;
drop trigger if exists rh_sst_antes on public.rh_sst_registros;
create trigger rh_sst_antes before insert or update on public.rh_sst_registros for each row execute function public._rh_sst_antes();

create or replace function public._rh_doc_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rh_colaboradores where id = new.colaborador_id) is distinct from new.empresa_id then raise exception 'Colaborador de outra empresa'; end if;
  if split_part(new.path, '/', 1) <> new.empresa_id::text or split_part(new.path, '/', 2) <> new.colaborador_id::text then raise exception 'Caminho do arquivo fora da pasta do colaborador'; end if;
  return new;
end $$;
drop trigger if exists rh_doc_antes on public.rh_documentos;
create trigger rh_doc_antes before insert or update of path, colaborador_id, empresa_id on public.rh_documentos for each row execute function public._rh_doc_antes();

-- ------------------------------------------------------------------ arquivos: rh-docs/<empresa>/<colaborador>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rh-docs', 'rh-docs', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function public._rh_doc_pode_ler(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select public.ve_rh(public._uuid_ou_nulo(split_part(p_name, '/', 1)))
      or exists (select 1 from rh_colaboradores c join rh_documentos d on d.colaborador_id = c.id and d.path = p_name and d.publicado
                  where c.id = public._uuid_ou_nulo(split_part(p_name, '/', 2)) and c.user_id = auth.uid())
$$;
revoke all on function public._rh_doc_pode_ler(text) from public, anon;
grant execute on function public._rh_doc_pode_ler(text) to authenticated;
drop policy if exists rhdocs_sel on storage.objects;
drop policy if exists rhdocs_ins on storage.objects;
drop policy if exists rhdocs_upd on storage.objects;
drop policy if exists rhdocs_del on storage.objects;
create policy rhdocs_sel on storage.objects for select to authenticated using (bucket_id = 'rh-docs' and public._rh_doc_pode_ler(name));
create policy rhdocs_ins on storage.objects for insert to authenticated with check (bucket_id = 'rh-docs' and public.edita_rh(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy rhdocs_upd on storage.objects for update to authenticated using (bucket_id = 'rh-docs' and public.edita_rh(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy rhdocs_del on storage.objects for delete to authenticated using (bucket_id = 'rh-docs' and public.edita_rh(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- ------------------------------------------------------------------ situação do SST
-- cada pessoa ativa × tipo que se aplica a ela (todos, cargo ou setor) ou que ela já fez: último registro e situação
create or replace function public._rh_sst_quadro(p_empresa uuid, p_hoje date, p_colab uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with col as (
    select * from rh_colaboradores where empresa_id = p_empresa and situacao <> 'desligado' and (p_colab is null or id = p_colab)
  ), t as (select * from rh_sst_tipos where empresa_id = p_empresa and ativo),
  ult as (
    select distinct on (r.colaborador_id, r.tipo_id) r.* from rh_sst_registros r where r.empresa_id = p_empresa order by r.colaborador_id, r.tipo_id, r.realizado_em desc
  ), par as (
    select c.id cid, c.nome, c.cargo, c.setor, t.id tid, t.nome tnome, t.categoria, t.antecedencia_dias, t.validade_meses, u.realizado_em, u.vence_em, u.resultado,
           (t.todos and c.vinculo in ('clt', 'aprendiz')) or exists (select 1 from unnest(t.cargos) k where c.cargo ilike '%' || k || '%')
             or exists (select 1 from unnest(t.setores) k where c.setor ilike '%' || k || '%') obrigatorio
      from col c cross join t left join ult u on u.colaborador_id = c.id and u.tipo_id = t.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('colaborador_id', cid, 'nome', nome, 'cargo', cargo, 'setor', setor, 'tipo_id', tid, 'tipo', tnome, 'categoria', categoria,
      'realizado_em', realizado_em, 'vence_em', vence_em, 'resultado', resultado, 'obrigatorio', obrigatorio,
      'situacao', case when realizado_em is null then 'pendente' when vence_em is null then 'em_dia' when vence_em < p_hoje then 'vencido'
                       when vence_em <= p_hoje + antecedencia_dias then 'a_vencer' else 'em_dia' end,
      'dias', case when vence_em is not null then vence_em - p_hoje end) order by nome, tnome), '[]')
    from par where obrigatorio or realizado_em is not null
$$;
revoke all on function public._rh_sst_quadro(uuid, date, uuid) from public, anon, authenticated;

create or replace function public.rh_sst_situacao(p_empresa uuid, p_hoje date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ve_rh(p_empresa) then raise exception 'Sem acesso ao RH'; end if;
  return public._rh_sst_quadro(p_empresa, p_hoje);
end $$;

-- ------------------------------------------------------------------ portal
create or replace function public.portal_meus_dados(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c rh_colaboradores; cfg rh_portal_config;
begin
  select * into v_c from rh_colaboradores where empresa_id = p_empresa and user_id = auth.uid() limit 1;
  if v_c.id is null then return jsonb_build_object('ligado', false); end if;
  select * into cfg from rh_portal_config where empresa_id = p_empresa;
  if cfg.empresa_id is not null and not cfg.ativo then return jsonb_build_object('ligado', true, 'ativo', false); end if;
  return jsonb_build_object('ligado', true, 'ativo', true, 'mensagem', cfg.mensagem,
    'colaborador', jsonb_build_object('id', v_c.id, 'nome', v_c.nome, 'cargo', v_c.cargo, 'setor', v_c.setor, 'matricula', v_c.matricula, 'admissao', v_c.admissao, 'vinculo', v_c.vinculo),
    'documentos', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'competencia', d.competencia, 'titulo', d.titulo, 'path', d.path, 'visto_em', d.visto_em, 'enviado_em', d.enviado_em)
        order by coalesce(d.competencia, d.enviado_em::date) desc), '[]') from rh_documentos d where d.colaborador_id = v_c.id and d.publicado),
    'ferias', case when coalesce(cfg.mostrar_ferias, true) then (select coalesce(jsonb_agg(jsonb_build_object('aquisitivo_ini', f.aquisitivo_ini, 'gozo_ini', f.gozo_ini, 'dias', f.dias, 'abono_dias', f.abono_dias,
        'situacao', f.situacao, 'pagamento', f.pagamento) order by f.gozo_ini desc), '[]') from rh_ferias f where f.colaborador_id = v_c.id and f.situacao <> 'cancelada') end,
    'sst', case when coalesce(cfg.mostrar_sst, true) then public._rh_sst_quadro(p_empresa, current_date, v_c.id) end);
end $$;

create or replace function public.portal_doc_visto(p_doc uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update rh_documentos d set visto_em = coalesce(visto_em, now())
   where d.id = p_doc and d.publicado and exists (select 1 from rh_colaboradores c where c.id = d.colaborador_id and c.user_id = auth.uid());
  if not found then raise exception 'Documento não encontrado'; end if;
end $$;

-- usuários com o perfil colaborador, para ligar ao cadastro (RH)
create or replace function public.rh_usuarios_portal(p_empresa uuid) returns table(user_id uuid, email text, colaborador_id uuid)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, c.id from membros m join auth.users u on u.id = m.user_id left join rh_colaboradores c on c.empresa_id = m.empresa_id and c.user_id = m.user_id
   where m.empresa_id = p_empresa and m.papel::text = 'colaborador' and public.edita_rh(p_empresa) order by u.email
$$;

-- ------------------------------------------------------------------ aviso diário de vencimentos
insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('rh_sst', 'RH', 'ASO, NR e treinamentos a vencer', 'Exames e treinamentos obrigatórios vencidos, a vencer ou pendentes (RH › SST e Treinamentos).', false, 96)
on conflict (codigo) do nothing;

create or replace function public._rh_sst_avisar(p_empresa uuid, p_hoje date) returns int language plpgsql security definer set search_path = public as $$
declare cfg rh_portal_config; Q jsonb; v_venc int; v_av int; v_pend int; v_rh uuid[]; x record; n int := 0;
begin
  select * into cfg from rh_portal_config where empresa_id = p_empresa;
  if cfg.empresa_id is not null and not cfg.sst_avisar then return 0; end if;
  if not public._eh_dia_util(p_hoje) then return 0; end if;
  insert into rh_sst_avisos_enviados(empresa_id, dia) values (p_empresa, p_hoje) on conflict do nothing;
  if not found then return 0; end if;
  Q := public._rh_sst_quadro(p_empresa, p_hoje);
  select count(*) filter (where q1 ->> 'situacao' = 'vencido'), count(*) filter (where q1 ->> 'situacao' = 'a_vencer'), count(*) filter (where q1 ->> 'situacao' = 'pendente' and (q1 ->> 'obrigatorio')::boolean)
    into v_venc, v_av, v_pend from jsonb_array_elements(Q) q1;
  if v_venc + v_av + v_pend = 0 then return 0; end if;
  select coalesce(array_agg(user_id), '{}') into v_rh from membros where empresa_id = p_empresa and (papel::text = 'admin' or 'rh' = any(coalesce(areas, '{}')));
  perform public._notificar_u(p_empresa, v_rh, 'rh_sst', 'SST e treinamentos: ' || (v_venc + v_av + v_pend) || ' pendência(s)',
    concat_ws(' · ', nullif(v_venc || ' vencido(s)', '0 vencido(s)'), nullif(v_av || ' a vencer', '0 a vencer'), nullif(v_pend || ' nunca feito(s)', '0 nunca feito(s)')), '#/rh/sst', null, v_venc > 0);
  n := 1;
  -- o próprio colaborador (com usuário) recebe o aviso do que é dele
  if coalesce(cfg.sst_avisar_colaborador, true) then
    for x in select (e ->> 'colaborador_id')::uuid cid, string_agg(e ->> 'tipo' || case when e ->> 'situacao' = 'vencido' then ' (vencido)' else ' (vence em ' || to_char((e ->> 'vence_em')::date, 'DD/MM') || ')' end, ', ') txt
               from jsonb_array_elements(Q) e where e ->> 'situacao' in ('vencido', 'a_vencer') group by 1 loop
      perform public._notificar_u(p_empresa, array(select user_id from rh_colaboradores where id = x.cid and user_id is not null), 'rh_sst', 'Seus exames e treinamentos', x.txt, '#/portal', null, false);
    end loop;
  end if;
  return n;
end $$;
revoke all on function public._rh_sst_avisar(uuid, date) from public, anon, authenticated;
create or replace function public._rh_sst_avisos() returns void language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  for e in select distinct empresa_id from rh_sst_tipos where ativo loop perform public._rh_sst_avisar(e, (now() at time zone 'America/Recife')::date); end loop;
end $$;
revoke all on function public._rh_sst_avisos() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('rh-sst-avisos') where exists (select 1 from cron.job where jobname = 'rh-sst-avisos');
    perform cron.schedule('rh-sst-avisos', '25 11 * * 1-5', 'select public._rh_sst_avisos()');
  end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['rh_sst_situacao(uuid, date)', 'portal_meus_dados(uuid)', 'portal_doc_visto(uuid)', 'rh_usuarios_portal(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

comment on table public.rh_documentos is 'Documentos do RH por colaborador (holerite, informe, aviso de férias…), vistos no Meu Portal (melhoria 8.2)';
comment on table public.rh_sst_tipos is 'Tipos de ASO, NR e treinamentos com validade e obrigatoriedade (melhoria 8.2)';

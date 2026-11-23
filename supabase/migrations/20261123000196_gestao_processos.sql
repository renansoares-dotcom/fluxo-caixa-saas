-- 196 — Gestão de Processos: mapa dos processos e POPs (23/11/2026, Renan: "Na plataforma temos uma ferramenta de gestão de
-- processo?" › "Inicialmente 1 e 2", isto é, mapear e padronizar). Decisões: o fluxograma é gerado das etapas; o POP é aprovado
-- pelo dono do processo; a plataforma sugere os processos que ela própria executa e o Renan revisa.
--   1. Macroprocessos e processos com dono, objetivo, entradas, saídas e clientes; processo crítico pede também a Diretoria no POP.
--   2. Etapas em ordem: início, atividade, decisão (sim/não) e fim, com o responsável (a raia do fluxograma), o prazo e a tela da
--      plataforma onde a etapa acontece. O fluxograma é desenhado na tela a partir delas.
--   3. POP com código, ligado ao processo e às etapas; versões rascunho › em aprovação › vigente › obsoleta. Quem elabora não
--      aprova (exceção por parâmetro, desligada). Se o dono elaborou, aprova a Diretoria.
--   4. Revisão periódica (parâmetro, padrão 12 meses) com aviso antes do vencimento e cobrança semanal depois.
--   5. Leitura obrigatória por perfil ou pessoa, com confirmação registrada; cada versão nova pede nova leitura; cobrança semanal.
-- Aditivo.

-- ------------------------------------------------------------ parâmetros
create table if not exists public.proc_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  papeis_gestor text[] not null default '{admin,diretor}',                                     -- mantêm o mapa (processos, donos, etapas)
  papeis_ve text[] not null default '{admin,financeiro,diretor,compras,producao,vendas,leitura}', -- consultam o mapa e os POPs
  papeis_elabora text[] not null default '{admin,financeiro,diretor,compras,producao,vendas}',    -- escrevem POPs
  papeis_diretoria text[] not null default '{diretor}',                                         -- aprovam no lugar do dono e nos processos críticos
  criticos_diretoria boolean not null default true,     -- processo crítico: depois do dono, a Diretoria também aprova
  autoaprovacao boolean not null default false,         -- EXCEÇÃO: quem elabora pode aprovar o próprio POP
  revisao_meses int not null default 12 check (revisao_meses between 1 and 60),
  aviso_revisao_dias int not null default 30 check (aviso_revisao_dias between 0 and 120),
  leitura_dias int not null default 7 check (leitura_dias between 1 and 60),
  cobrar_leitura boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create or replace function public._proc_cfg(p_empresa uuid) returns public.proc_config
language sql stable security definer set search_path = public as $$
  select coalesce((select c from proc_config c where c.empresa_id = p_empresa),
    row(p_empresa, '{admin,diretor}', '{admin,financeiro,diretor,compras,producao,vendas,leitura}', '{admin,financeiro,diretor,compras,producao,vendas}',
        '{diretor}', true, false, 12, 30, 7, true, now())::proc_config);
$$;
create or replace function public._proc_papel(p_empresa uuid) returns text
language sql stable security definer set search_path = public as $$
  select papel::text from membros where empresa_id = p_empresa and user_id = auth.uid() limit 1;
$$;
create or replace function public._proc_ve(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public._proc_papel(p_empresa) = any((public._proc_cfg(p_empresa)).papeis_ve || (public._proc_cfg(p_empresa)).papeis_gestor), false);
$$;
create or replace function public._proc_gestor(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public._proc_papel(p_empresa) = any((public._proc_cfg(p_empresa)).papeis_gestor), false);
$$;
create or replace function public._proc_elabora(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public._proc_gestor(p_empresa) or public._proc_papel(p_empresa) = any((public._proc_cfg(p_empresa)).papeis_elabora), false);
$$;
-- quem aprova pela Diretoria: os perfis do parâmetro; se a empresa não tem ninguém nesses perfis, o administrador
create or replace function public._proc_dir_users(p_empresa uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(public._usuarios_papel(p_empresa, (public._proc_cfg(p_empresa)).papeis_diretoria), '{}'), public._usuarios_papel(p_empresa, '{admin}'));
$$;
create or replace function public._proc_diretoria(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() = any(public._proc_dir_users(p_empresa)), false);
$$;
create or replace function public._proc_nome(p_empresa uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim((select m.nome from membros m where m.empresa_id = p_empresa and m.user_id = p_user)), ''),
                  (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user));
$$;

-- ------------------------------------------------------------ mapa
create table if not exists public.proc_macros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null check (codigo ~ '^[A-Z]{2,5}$'),
  nome text not null check (length(nome) between 2 and 60),
  ordem int not null default 0,
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);
create table if not exists public.proc_processos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  macro_id uuid not null references public.proc_macros(id),
  codigo text not null check (codigo ~ '^[A-Z]{2,5}-[0-9]{2,3}$'),
  nome text not null check (length(nome) between 3 and 80),
  objetivo text check (length(objetivo) <= 500),
  entradas text check (length(entradas) <= 500),
  saidas text check (length(saidas) <= 500),
  clientes text check (length(clientes) <= 300),          -- quem recebe o resultado (interno ou externo)
  dono_id uuid,
  critico boolean not null default false,
  sugerido boolean not null default false,               -- veio da sugestão da plataforma e ainda não foi revisado
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  atualizado_por uuid, atualizado_nome text, atualizado_em timestamptz,
  unique (empresa_id, codigo)
);
create index if not exists proc_processos_macro on public.proc_processos (macro_id);
create table if not exists public.proc_etapas (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.proc_processos(id) on delete cascade,
  empresa_id uuid not null,
  n int not null check (n between 1 and 60),
  tipo text not null check (tipo in ('inicio', 'atividade', 'decisao', 'fim')),
  responsavel text not null check (length(responsavel) between 1 and 40),   -- a raia do fluxograma (setor ou função)
  o_que text not null check (length(o_que) between 2 and 160),
  detalhe text check (length(detalhe) <= 500),
  prazo text check (length(prazo) <= 40),
  tela text check (tela ~ '^[a-z0-9][a-z0-9/-]{1,40}$'),       -- rota da tela da plataforma onde a etapa acontece
  ir int check (ir between 1 and 60),                          -- atividade: próxima etapa quando não é a seguinte
  sim int check (sim between 1 and 60),                        -- decisão: para onde vai no "sim" (vazio = a seguinte)
  nao int check (nao between 1 and 60),                        -- decisão: para onde vai no "não"
  unique (processo_id, n)
);

-- ------------------------------------------------------------ POPs
create table if not exists public.proc_pops (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  processo_id uuid not null references public.proc_processos(id),
  codigo text not null check (codigo ~ '^POP-[A-Z]{2,5}-[0-9]{3}$'),
  titulo text not null check (length(titulo) between 3 and 120),
  versao_vigente int,
  revisar_em date,                                  -- próxima revisão obrigatória da versão vigente
  revisao_avisada_em date, revisao_cobrada_em date,
  ativo boolean not null default true,
  obsoleto_motivo text check (length(obsoleto_motivo) <= 300),
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists proc_pops_processo on public.proc_pops (processo_id);
create table if not exists public.proc_versoes (
  id uuid primary key default gen_random_uuid(),
  pop_id uuid not null references public.proc_pops(id) on delete cascade,
  empresa_id uuid not null,
  versao int not null check (versao between 1 and 999),
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'em_aprovacao', 'vigente', 'obsoleta')),
  objetivo text check (length(objetivo) <= 1000),
  aplicacao text check (length(aplicacao) <= 1000),             -- onde e a quem se aplica
  responsabilidades text check (length(responsabilidades) <= 2000),
  materiais text check (length(materiais) <= 1000),             -- materiais, equipamentos e EPI
  procedimento text check (length(procedimento) <= 20000),      -- o passo a passo
  registros text check (length(registros) <= 1000),             -- o que fica registrado e onde
  referencias text check (length(referencias) <= 1000),
  etapas int[] not null default '{}',                           -- etapas do processo que o POP cobre
  motivo text check (length(motivo) <= 500),                    -- o que mudou nesta versão
  publico text[] not null default '{}',                         -- perfis que precisam ler
  leitores uuid[] not null default '{}',                        -- pessoas que precisam ler, além dos perfis
  anexo_caminho text, anexo_nome text check (length(anexo_nome) <= 120),
  elaborado_por uuid, elaborado_nome text, elaborado_em timestamptz not null default now(),
  enviado_em timestamptz,
  fase smallint check (fase in (1, 2)),                        -- em aprovação: 1 = dono (ou Diretoria no lugar dele), 2 = Diretoria (processo crítico)
  aprovador_tipo text check (aprovador_tipo in ('dono', 'diretoria')),
  aprovado_por uuid, aprovado_nome text, aprovado_em timestamptz,
  diretoria_por uuid, diretoria_nome text, diretoria_em timestamptz,
  recusa_motivo text check (length(recusa_motivo) <= 500), recusado_nome text, recusado_em timestamptz,
  vigente_desde date, obsoleta_em date,
  leitura_cobrada_em date,
  unique (pop_id, versao)
);
create unique index if not exists proc_versoes_aberta on public.proc_versoes (pop_id) where situacao in ('rascunho', 'em_aprovacao');
create unique index if not exists proc_versoes_vigente on public.proc_versoes (pop_id) where situacao = 'vigente';
create table if not exists public.proc_leituras (
  versao_id uuid not null references public.proc_versoes(id) on delete cascade,
  empresa_id uuid not null,
  user_id uuid not null,
  nome text,
  lido_em timestamptz not null default now(),
  primary key (versao_id, user_id)
);

-- ------------------------------------------------------------ acesso: leitura por política; escrita só pelas funções
do $$ declare t text; begin
  foreach t in array array['proc_config', 'proc_macros', 'proc_processos', 'proc_etapas', 'proc_pops', 'proc_versoes', 'proc_leituras'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public._proc_ve(empresa_id))', t || '_ler', t);
  end loop;
end $$;

-- anexo do POP (PDF ou imagem): <empresa>/<pop>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('processos', 'processos', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function public._proc_anexo_ok(p_nome text, p_gravar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select array_length(storage.foldername(p_nome), 1) = 2 and (storage.foldername(p_nome))[1] = p.empresa_id::text
                          and case when p_gravar then public._proc_elabora(p.empresa_id) else public._proc_ve(p.empresa_id) end
                     from proc_pops p where p.id = public._uuid_ou_nulo((storage.foldername(p_nome))[2])), false);
$$;
drop policy if exists processos_sel on storage.objects;
drop policy if exists processos_ins on storage.objects;
create policy processos_sel on storage.objects for select to authenticated using (bucket_id = 'processos' and public._proc_anexo_ok(name, false));
create policy processos_ins on storage.objects for insert to authenticated with check (bucket_id = 'processos' and public._proc_anexo_ok(name, true));

-- ------------------------------------------------------------ o que a tela precisa saber de quem está usando
create or replace function public.proc_acesso(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ve', public._proc_ve(p_empresa), 'gestor', public._proc_gestor(p_empresa), 'elabora', public._proc_elabora(p_empresa),
    'diretoria', public._proc_diretoria(p_empresa), 'admin', public._proc_papel(p_empresa) = 'admin');
$$;

create or replace function public.proc_pessoas(p_empresa uuid)
returns table (user_id uuid, nome text, papel text) language plpgsql stable security definer set search_path = public as $$
begin
  if not public._proc_ve(p_empresa) then raise exception 'Sem acesso à gestão de processos.'; end if;
  return query select m.user_id, public._proc_nome(p_empresa, m.user_id)::text, m.papel::text from membros m
    where m.empresa_id = p_empresa and m.papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao', 'vendas', 'leitura') order by 2;
end $$;

-- ------------------------------------------------------------ parâmetros
create or replace function public.proc_config_salvar(p_empresa uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_pap text[] := array['admin', 'financeiro', 'diretor', 'compras', 'producao', 'vendas', 'leitura']; c proc_config := public._proc_cfg(p_empresa);
  g text[] := case when p ? 'papeis_gestor' then array(select jsonb_array_elements_text(p->'papeis_gestor')) else c.papeis_gestor end;
  v text[] := case when p ? 'papeis_ve' then array(select jsonb_array_elements_text(p->'papeis_ve')) else c.papeis_ve end;
  el text[] := case when p ? 'papeis_elabora' then array(select jsonb_array_elements_text(p->'papeis_elabora')) else c.papeis_elabora end;
  d text[] := case when p ? 'papeis_diretoria' then array(select jsonb_array_elements_text(p->'papeis_diretoria')) else c.papeis_diretoria end;
  v_rev int := coalesce((p->>'revisao_meses')::int, c.revisao_meses); v_av int := coalesce((p->>'aviso_revisao_dias')::int, c.aviso_revisao_dias);
  v_le int := coalesce((p->>'leitura_dias')::int, c.leitura_dias);
begin
  if public._proc_papel(p_empresa) is distinct from 'admin' then raise exception 'Só o administrador muda os parâmetros da gestão de processos.'; end if;
  if not (g <@ v_pap and v <@ v_pap and el <@ v_pap and d <@ v_pap) then raise exception 'Perfil inválido.'; end if;
  if not ('admin' = any(g)) then raise exception 'O administrador precisa continuar mantendo o mapa (inclua Administrador em quem mantém).'; end if;
  if cardinality(d) = 0 or not (d <@ array['admin', 'diretor']) then raise exception 'A Diretoria é o diretor ou o administrador (escolha pelo menos um).'; end if;
  if v_rev not between 1 and 60 then raise exception 'Revisão do POP: de 1 a 60 meses.'; end if;
  if v_av not between 0 and 120 then raise exception 'Aviso antes da revisão: de 0 a 120 dias.'; end if;
  if v_le not between 1 and 60 then raise exception 'Prazo para ler o POP: de 1 a 60 dias.'; end if;
  insert into proc_config (empresa_id, papeis_gestor, papeis_ve, papeis_elabora, papeis_diretoria, criticos_diretoria, autoaprovacao, revisao_meses, aviso_revisao_dias, leitura_dias, cobrar_leitura)
    values (p_empresa, g, v, el, d, coalesce((p->>'criticos_diretoria')::boolean, c.criticos_diretoria), coalesce((p->>'autoaprovacao')::boolean, c.autoaprovacao),
            v_rev, v_av, v_le, coalesce((p->>'cobrar_leitura')::boolean, c.cobrar_leitura))
  on conflict (empresa_id) do update set papeis_gestor = excluded.papeis_gestor, papeis_ve = excluded.papeis_ve, papeis_elabora = excluded.papeis_elabora,
    papeis_diretoria = excluded.papeis_diretoria, criticos_diretoria = excluded.criticos_diretoria, autoaprovacao = excluded.autoaprovacao,
    revisao_meses = excluded.revisao_meses, aviso_revisao_dias = excluded.aviso_revisao_dias, leitura_dias = excluded.leitura_dias,
    cobrar_leitura = excluded.cobrar_leitura, atualizado_em = now();
end $$;

-- ------------------------------------------------------------ macroprocessos
create or replace function public.proc_macro_salvar(p_empresa uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_cod text := upper(btrim(coalesce(p->>'codigo', '')));
begin
  if not public._proc_gestor(p_empresa) then raise exception 'Só quem mantém o mapa cadastra macroprocessos.'; end if;
  if length(btrim(coalesce(p->>'nome', ''))) < 2 then raise exception 'Informe o nome do macroprocesso.'; end if;
  if v_id is null then
    if v_cod !~ '^[A-Z]{2,5}$' then raise exception 'Código do macroprocesso: de 2 a 5 letras (ex.: SUP).'; end if;
    if exists (select 1 from proc_macros where empresa_id = p_empresa and codigo = v_cod) then raise exception 'Já existe o macroprocesso %.', v_cod; end if;
    insert into proc_macros (empresa_id, codigo, nome, ordem) values (p_empresa, v_cod, btrim(p->>'nome'),
      coalesce((p->>'ordem')::int, (select coalesce(max(ordem), 0) + 10 from proc_macros where empresa_id = p_empresa))) returning id into v_id;
  else
    if not coalesce((p->>'ativo')::boolean, true) and exists (select 1 from proc_processos where macro_id = v_id and ativo) then
      raise exception 'O macroprocesso tem processos ativos. Desative ou mude os processos antes.'; end if;
    update proc_macros set nome = btrim(p->>'nome'), ordem = coalesce((p->>'ordem')::int, ordem), ativo = coalesce((p->>'ativo')::boolean, ativo)
     where id = v_id and empresa_id = p_empresa;   -- o código não muda: está nos códigos dos processos e dos POPs
    if not found then raise exception 'Macroprocesso não encontrado.'; end if;
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------ processos e etapas
-- confere as etapas (o fluxograma precisa fechar): tipos, textos, destinos dentro do processo
create or replace function public._proc_etapas_ok(p_etapas jsonb) returns void
language plpgsql immutable as $$
declare e jsonb; k int := 0; n int; t text;
begin
  if jsonb_typeof(coalesce(p_etapas, '[]')) <> 'array' then raise exception 'Etapas inválidas.'; end if;
  n := jsonb_array_length(coalesce(p_etapas, '[]'));
  if n > 60 then raise exception 'No máximo 60 etapas por processo. Divida em subprocessos.'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_etapas, '[]')) loop
    k := k + 1; t := e->>'tipo';
    if t is null or t not in ('inicio', 'atividade', 'decisao', 'fim') then raise exception 'Etapa %: escolha o tipo.', k; end if;
    if length(btrim(coalesce(e->>'o_que', ''))) < 2 then raise exception 'Etapa %: descreva o que é feito.', k; end if;
    if length(btrim(coalesce(e->>'o_que', ''))) > 160 then raise exception 'Etapa %: descrição longa demais (até 160 letras; detalhe no POP).', k; end if;
    if length(btrim(coalesce(e->>'responsavel', ''))) < 1 then raise exception 'Etapa %: informe o responsável (setor ou função).', k; end if;
    if nullif(e->>'tela', '') is not null and (e->>'tela') !~ '^[a-z0-9][a-z0-9/-]{1,40}$' then raise exception 'Etapa %: tela inválida.', k; end if;
    if t = 'decisao' then
      if nullif(e->>'nao', '') is null then raise exception 'Etapa % (decisão): informe para qual etapa vai no "não".', k; end if;
      if (e->>'nao')::int not between 1 and n or (e->>'nao')::int = k then raise exception 'Etapa % (decisão): o "não" precisa ir para outra etapa do processo (1 a %).', k, n; end if;
      if nullif(e->>'sim', '') is not null and ((e->>'sim')::int not between 1 and n or (e->>'sim')::int = k) then raise exception 'Etapa % (decisão): o "sim" precisa ir para outra etapa (1 a %).', k, n; end if;
      if nullif(e->>'sim', '') is null and k = n then raise exception 'Etapa % (decisão) é a última: informe para onde vai no "sim".', k; end if;
    elsif nullif(e->>'ir', '') is not null and t <> 'fim' and ((e->>'ir')::int not between 1 and n or (e->>'ir')::int = k) then
      raise exception 'Etapa %: "vai para" precisa ser outra etapa do processo (1 a %).', k, n;
    end if;
  end loop;
end $$;

-- p = { id?, macro_id, codigo?, nome, objetivo, entradas, saidas, clientes, dono_id, critico, ativo, etapas?: [...] }
-- (as etapas, quando vêm, substituem as anteriores). Quem mantém o mapa cria e altera tudo; o dono altera o próprio processo
-- (menos o dono e o "crítico").
create or replace function public.proc_salvar(p_empresa uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare x proc_processos; v_id uuid := nullif(p->>'id', '')::uuid; m proc_macros; v_cod text := upper(btrim(coalesce(p->>'codigo', '')));
  v_dono uuid := nullif(p->>'dono_id', '')::uuid; g boolean := public._proc_gestor(p_empresa);
begin
  if v_id is not null then
    select * into x from proc_processos where id = v_id and empresa_id = p_empresa for update;
    if not found then raise exception 'Processo não encontrado.'; end if;
    if not (g or (coalesce(x.dono_id = auth.uid(), false) and public._proc_ve(p_empresa))) then raise exception 'Só quem mantém o mapa ou o dono altera o processo.'; end if;
    if not g then v_dono := x.dono_id; end if;
  elsif not g then raise exception 'Só quem mantém o mapa cadastra processos.';
  end if;
  select * into m from proc_macros where id = coalesce(nullif(p->>'macro_id', '')::uuid, x.macro_id) and empresa_id = p_empresa;
  if not found then raise exception 'Escolha o macroprocesso.'; end if;
  if length(btrim(coalesce(p->>'nome', ''))) < 3 then raise exception 'Informe o nome do processo.'; end if;
  if v_dono is not null and not exists (select 1 from membros where empresa_id = p_empresa and user_id = v_dono and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'producao', 'vendas')) then
    raise exception 'O dono precisa ser uma pessoa da empresa (perfil que não seja só de leitura).'; end if;
  if p ? 'etapas' then perform public._proc_etapas_ok(p->'etapas'); end if;
  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('proc_cod:' || p_empresa::text));
    if v_cod = '' then
      v_cod := m.codigo || '-' || lpad((select coalesce(max(split_part(codigo, '-', 2)::int), 0) + 1 from proc_processos where empresa_id = p_empresa and codigo like m.codigo || '-%')::text, 2, '0');
    elsif v_cod !~ ('^' || m.codigo || '-[0-9]{2,3}$') then raise exception 'Código do processo: % seguido de traço e número (ex.: %-01).', m.codigo, m.codigo;
    end if;
    if exists (select 1 from proc_processos where empresa_id = p_empresa and codigo = v_cod) then raise exception 'Já existe o processo %.', v_cod; end if;
    insert into proc_processos (empresa_id, macro_id, codigo, nome, objetivo, entradas, saidas, clientes, dono_id, critico, ordem, atualizado_por, atualizado_nome, atualizado_em)
      values (p_empresa, m.id, v_cod, btrim(p->>'nome'), nullif(btrim(coalesce(p->>'objetivo', '')), ''), nullif(btrim(coalesce(p->>'entradas', '')), ''),
              nullif(btrim(coalesce(p->>'saidas', '')), ''), nullif(btrim(coalesce(p->>'clientes', '')), ''), v_dono, coalesce((p->>'critico')::boolean, false),
              (select coalesce(max(ordem), 0) + 10 from proc_processos where macro_id = m.id), auth.uid(), public._proc_nome(p_empresa, auth.uid()), now())
      returning id into v_id;
  else
    if m.id <> x.macro_id and not g then raise exception 'Só quem mantém o mapa muda o processo de macroprocesso.'; end if;
    if m.id <> x.macro_id and exists (select 1 from proc_pops where processo_id = v_id) then raise exception 'O processo já tem POP: o macroprocesso (e o código) não muda mais.'; end if;
    if not coalesce((p->>'ativo')::boolean, true) and exists (select 1 from proc_pops where processo_id = v_id and ativo) then
      raise exception 'O processo tem POP em uso. Torne os POPs obsoletos antes de desativar o processo.'; end if;
    update proc_processos set macro_id = m.id,
           codigo = case when m.id <> x.macro_id then m.codigo || '-' || split_part(x.codigo, '-', 2) else codigo end,
           nome = btrim(p->>'nome'), objetivo = nullif(btrim(coalesce(p->>'objetivo', '')), ''),
           entradas = nullif(btrim(coalesce(p->>'entradas', '')), ''), saidas = nullif(btrim(coalesce(p->>'saidas', '')), ''),
           clientes = nullif(btrim(coalesce(p->>'clientes', '')), ''), dono_id = v_dono,
           critico = case when g then coalesce((p->>'critico')::boolean, critico) else critico end,
           ativo = coalesce((p->>'ativo')::boolean, ativo), sugerido = false,
           atualizado_por = auth.uid(), atualizado_nome = public._proc_nome(p_empresa, auth.uid()), atualizado_em = now()
     where id = v_id;
    if m.id <> x.macro_id and exists (select 1 from proc_processos where empresa_id = p_empresa and codigo = m.codigo || '-' || split_part(x.codigo, '-', 2) and id <> v_id) then
      raise exception 'Já existe o processo %-% no macroprocesso escolhido.', m.codigo, split_part(x.codigo, '-', 2); end if;
  end if;
  if p ? 'etapas' then
    delete from proc_etapas where processo_id = v_id;
    insert into proc_etapas (processo_id, empresa_id, n, tipo, responsavel, o_que, detalhe, prazo, tela, ir, sim, nao)
    select v_id, p_empresa, o::int, e->>'tipo', btrim(e->>'responsavel'), btrim(e->>'o_que'), nullif(btrim(coalesce(e->>'detalhe', '')), ''),
           nullif(btrim(coalesce(e->>'prazo', '')), ''), nullif(e->>'tela', ''),
           case when e->>'tipo' in ('inicio', 'atividade') then nullif(e->>'ir', '')::int end,
           case when e->>'tipo' = 'decisao' then nullif(e->>'sim', '')::int end, case when e->>'tipo' = 'decisao' then nullif(e->>'nao', '')::int end
      from jsonb_array_elements(p->'etapas') with ordinality t(e, o);
  end if;
  return v_id;
end $$;

-- excluir um processo que ainda não tem POP (o que tem POP é desativado)
create or replace function public.proc_excluir(p_processo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare x proc_processos;
begin
  select * into x from proc_processos where id = p_processo;
  if not found or not public._proc_gestor(x.empresa_id) then raise exception 'Só quem mantém o mapa exclui processos.'; end if;
  if exists (select 1 from proc_pops where processo_id = p_processo) then raise exception 'O processo % tem POP: desative-o em vez de excluir (o histórico fica).', x.codigo; end if;
  delete from proc_processos where id = p_processo;
end $$;

-- ------------------------------------------------------------ POP: criar, escrever, enviar, decidir, revisar, ler
create or replace function public._proc_pode_escrever(v proc_versoes) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public._proc_gestor(v.empresa_id) or (public._proc_elabora(v.empresa_id) and v.elaborado_por = auth.uid())
    or exists (select 1 from proc_pops p join proc_processos x on x.id = p.processo_id where p.id = v.pop_id and coalesce(x.dono_id = auth.uid(), false)), false);
$$;

create or replace function public.proc_pop_criar(p_processo uuid, p_titulo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare x proc_processos; m proc_macros; v_pop uuid; v_cod text;
begin
  select * into x from proc_processos where id = p_processo;
  if not found or not public._proc_ve(x.empresa_id) then raise exception 'Processo não encontrado.'; end if;
  if not (public._proc_elabora(x.empresa_id) or (coalesce(x.dono_id = auth.uid(), false))) then raise exception 'Seu perfil não escreve POPs (o administrador libera em Parâmetros).'; end if;
  if not x.ativo then raise exception 'O processo % está desativado.', x.codigo; end if;
  if length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'Informe o título do POP.'; end if;
  select * into m from proc_macros where id = x.macro_id;
  perform pg_advisory_xact_lock(hashtext('proc_pop:' || x.empresa_id::text));
  v_cod := 'POP-' || m.codigo || '-' || lpad((select coalesce(max(split_part(codigo, '-', 3)::int), 0) + 1 from proc_pops where empresa_id = x.empresa_id and codigo like 'POP-' || m.codigo || '-%')::text, 3, '0');
  insert into proc_pops (empresa_id, processo_id, codigo, titulo) values (x.empresa_id, x.id, v_cod, btrim(p_titulo)) returning id into v_pop;
  insert into proc_versoes (pop_id, empresa_id, versao, objetivo, publico, elaborado_por, elaborado_nome)
    values (v_pop, x.empresa_id, 1, x.objetivo, '{}', auth.uid(), public._proc_nome(x.empresa_id, auth.uid()));
  return v_pop;
end $$;

-- p = { titulo?, objetivo, aplicacao, responsabilidades, materiais, procedimento, registros, referencias, etapas: [n], motivo,
--       publico: [perfis], leitores: [user_id], anexo_caminho, anexo_nome }
create or replace function public.proc_versao_salvar(p_versao uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v proc_versoes; v_pap text[] := array['admin', 'financeiro', 'diretor', 'compras', 'producao', 'vendas', 'leitura'];
  pub text[] := case when p ? 'publico' then array(select jsonb_array_elements_text(p->'publico')) else null end;
  lei uuid[] := case when p ? 'leitores' then array(select (jsonb_array_elements_text(p->'leitores'))::uuid) else null end;
  et int[] := case when p ? 'etapas' then array(select (jsonb_array_elements_text(p->'etapas'))::int) else null end;
  v_anx text := nullif(p->>'anexo_caminho', '');
begin
  select * into v from proc_versoes where id = p_versao for update;
  if not found or not public._proc_ve(v.empresa_id) then raise exception 'Versão não encontrada.'; end if;
  if v.situacao <> 'rascunho' then raise exception 'Só o rascunho pode ser alterado (versão % está %).', v.versao, replace(v.situacao, '_', ' '); end if;
  if not public._proc_pode_escrever(v) then raise exception 'Só quem elaborou o rascunho, o dono do processo ou quem mantém o mapa altera o POP.'; end if;
  if pub is not null and not pub <@ v_pap then raise exception 'Perfil inválido em quem precisa ler.'; end if;
  if lei is not null and exists (select 1 from unnest(lei) u where not exists (select 1 from membros m where m.empresa_id = v.empresa_id and m.user_id = u)) then
    raise exception 'Pessoa que não é da empresa em quem precisa ler.'; end if;
  if et is not null and exists (select 1 from unnest(et) k(num) where not exists (select 1 from proc_etapas e join proc_pops pp on pp.processo_id = e.processo_id where pp.id = v.pop_id and e.n = k.num)) then
    raise exception 'Etapa que não existe no processo.'; end if;
  if v_anx is not null and v_anx is distinct from v.anexo_caminho and not exists (select 1 from storage.objects o where o.bucket_id = 'processos' and o.name = v_anx and (storage.foldername(o.name))[2] = v.pop_id::text) then
    raise exception 'O anexo não foi enviado. Envie o arquivo de novo.'; end if;
  if p ? 'titulo' then
    if length(btrim(coalesce(p->>'titulo', ''))) < 3 then raise exception 'Informe o título do POP.'; end if;
    update proc_pops set titulo = btrim(p->>'titulo') where id = v.pop_id;
  end if;
  update proc_versoes set objetivo = nullif(btrim(coalesce(p->>'objetivo', '')), ''), aplicacao = nullif(btrim(coalesce(p->>'aplicacao', '')), ''),
         responsabilidades = nullif(btrim(coalesce(p->>'responsabilidades', '')), ''), materiais = nullif(btrim(coalesce(p->>'materiais', '')), ''),
         procedimento = nullif(btrim(coalesce(p->>'procedimento', '')), ''), registros = nullif(btrim(coalesce(p->>'registros', '')), ''),
         referencias = nullif(btrim(coalesce(p->>'referencias', '')), ''), motivo = nullif(btrim(coalesce(p->>'motivo', '')), ''),
         etapas = coalesce((select array_agg(distinct k.num order by k.num) from unnest(et) k(num)), case when et is null then etapas else '{}' end),
         publico = coalesce(pub, publico), leitores = coalesce(lei, leitores),
         anexo_caminho = case when p ? 'anexo_caminho' then v_anx else anexo_caminho end,
         anexo_nome = case when p ? 'anexo_caminho' then case when v_anx is null then null else left(nullif(btrim(coalesce(p->>'anexo_nome', '')), ''), 120) end else anexo_nome end
   where id = p_versao;
end $$;

-- quem aprova a fase atual de uma versão em aprovação
create or replace function public._proc_aprovadores(v proc_versoes) returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when v.fase = 1 and v.aprovador_tipo = 'dono' then array[x.dono_id] else public._proc_dir_users(v.empresa_id) end
    from proc_pops p join proc_processos x on x.id = p.processo_id where p.id = v.pop_id;
$$;

create or replace function public.proc_versao_enviar(p_versao uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v proc_versoes; pp proc_pops; x proc_processos; v_tipo text; c proc_config;
begin
  select * into v from proc_versoes where id = p_versao for update;
  if not found or not public._proc_ve(v.empresa_id) then raise exception 'Versão não encontrada.'; end if;
  if v.situacao <> 'rascunho' then raise exception 'Só o rascunho é enviado para aprovação.'; end if;
  if not public._proc_pode_escrever(v) then raise exception 'Só quem elaborou o rascunho, o dono do processo ou quem mantém o mapa envia para aprovação.'; end if;
  if length(btrim(coalesce(v.procedimento, ''))) < 20 then raise exception 'Escreva o procedimento (o passo a passo) antes de enviar.'; end if;
  if v.versao > 1 and length(btrim(coalesce(v.motivo, ''))) < 5 then raise exception 'Informe o que mudou nesta versão.'; end if;
  if cardinality(v.publico) = 0 and cardinality(v.leitores) = 0 then raise exception 'Informe quem precisa ler o POP (perfis ou pessoas).'; end if;
  select * into pp from proc_pops where id = v.pop_id;
  select * into x from proc_processos where id = pp.processo_id;
  c := public._proc_cfg(v.empresa_id);
  -- o dono aprova; se não há dono, ou o dono escreveu o POP (e a exceção está desligada), aprova a Diretoria
  v_tipo := case when x.dono_id is not null and (x.dono_id is distinct from v.elaborado_por or c.autoaprovacao) then 'dono' else 'diretoria' end;
  update proc_versoes set situacao = 'em_aprovacao', enviado_em = now(), fase = 1, aprovador_tipo = v_tipo,
         recusa_motivo = null, recusado_nome = null, recusado_em = null where id = p_versao;
  select * into v from proc_versoes where id = p_versao;
  perform public._notificar_u(v.empresa_id, public._proc_aprovadores(v), 'processo', 'POP para aprovar: ' || pp.codigo || ' v' || v.versao,
    pp.titulo || ' — processo ' || x.codigo || ' ' || x.nome, '#/processos?pop=' || pp.id, v.id, false);
  return v_tipo;
end $$;

-- aprovar ou recusar a fase atual. Recusa volta para rascunho com o motivo.
create or replace function public.proc_versao_decidir(p_versao uuid, p_aprovar boolean, p_motivo text)
returns text language plpgsql security definer set search_path = public as $$
declare v proc_versoes; pp proc_pops; x proc_processos; c proc_config; v_quem text; v_leitores uuid[];
begin
  select * into v from proc_versoes where id = p_versao for update;
  if not found or not public._proc_ve(v.empresa_id) then raise exception 'Versão não encontrada.'; end if;
  if v.situacao <> 'em_aprovacao' then raise exception 'Esta versão não está em aprovação.'; end if;
  c := public._proc_cfg(v.empresa_id); v_quem := public._proc_nome(v.empresa_id, auth.uid());
  if not coalesce(auth.uid() = any(public._proc_aprovadores(v)), false) then
    raise exception '%', case when v.fase = 1 and v.aprovador_tipo = 'dono' then 'Quem aprova este POP é o dono do processo.' else 'Quem aprova esta fase é a Diretoria.' end; end if;
  if v.elaborado_por = auth.uid() and not c.autoaprovacao then raise exception 'Quem elaborou o POP não aprova (exceção desligada nos parâmetros).'; end if;
  if v.fase = 2 and v.aprovado_por = auth.uid() then raise exception 'Você já aprovou como dono: a fase da Diretoria precisa de outra pessoa.'; end if;
  select * into pp from proc_pops where id = v.pop_id;
  select * into x from proc_processos where id = pp.processo_id;
  if not p_aprovar then
    if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da recusa.'; end if;
    update proc_versoes set situacao = 'rascunho', fase = null, aprovador_tipo = null, aprovado_por = null, aprovado_nome = null, aprovado_em = null,
           recusa_motivo = btrim(p_motivo), recusado_nome = v_quem, recusado_em = now() where id = p_versao;
    perform public._notificar_u(v.empresa_id, array[v.elaborado_por], 'processo', 'POP recusado: ' || pp.codigo || ' v' || v.versao, left(btrim(p_motivo), 200), '#/processos?pop=' || pp.id, v.id, false);
    return 'recusado';
  end if;
  if v.fase = 1 then
    update proc_versoes set aprovado_por = auth.uid(), aprovado_nome = v_quem, aprovado_em = now() where id = p_versao;
    -- processo crítico aprovado pelo dono: falta a Diretoria
    if v.aprovador_tipo = 'dono' and x.critico and c.criticos_diretoria then
      update proc_versoes set fase = 2 where id = p_versao;
      select * into v from proc_versoes where id = p_versao;
      perform public._notificar_u(v.empresa_id, public._proc_aprovadores(v), 'processo', 'POP de processo crítico para aprovar: ' || pp.codigo || ' v' || v.versao,
        pp.titulo || ' — aprovado pelo dono (' || v_quem || ')', '#/processos?pop=' || pp.id, v.id, false);
      return 'diretoria';
    end if;
  else
    update proc_versoes set diretoria_por = auth.uid(), diretoria_nome = v_quem, diretoria_em = now() where id = p_versao;
  end if;
  -- em vigor: a anterior fica obsoleta e começa a contar a revisão
  update proc_versoes set situacao = 'obsoleta', obsoleta_em = current_date where pop_id = v.pop_id and situacao = 'vigente';
  update proc_versoes set situacao = 'vigente', vigente_desde = current_date, fase = null, leitura_cobrada_em = null where id = p_versao;
  update proc_pops set versao_vigente = v.versao, ativo = true, obsoleto_motivo = null, revisar_em = (current_date + make_interval(months => c.revisao_meses))::date,
         revisao_avisada_em = null, revisao_cobrada_em = null where id = pp.id;
  select coalesce(array_agg(distinct m.user_id), '{}') into v_leitores from membros m
   where m.empresa_id = v.empresa_id and (m.papel::text = any(v.publico) or m.user_id = any(v.leitores));
  perform public._notificar_u(v.empresa_id, v_leitores || array[v.elaborado_por], 'processo', 'POP em vigor: ' || pp.codigo || ' v' || v.versao || ' — leia e confirme',
    pp.titulo || '. Prazo para confirmar a leitura: ' || to_char(current_date + c.leitura_dias, 'DD/MM/YYYY') || '.', '#/processos?pop=' || pp.id, v.id, false);
  return 'vigente';
end $$;

-- nova revisão: copia a versão vigente para um rascunho (uma só versão aberta por POP)
create or replace function public.proc_pop_revisar(p_pop uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pp proc_pops; v proc_versoes; x proc_processos; v_id uuid;
begin
  select * into pp from proc_pops where id = p_pop for update;
  if not found or not public._proc_ve(pp.empresa_id) then raise exception 'POP não encontrado.'; end if;
  select * into x from proc_processos where id = pp.processo_id;
  if not (public._proc_elabora(pp.empresa_id) or coalesce(x.dono_id = auth.uid(), false)) then raise exception 'Seu perfil não escreve POPs.'; end if;
  if exists (select 1 from proc_versoes where pop_id = p_pop and situacao in ('rascunho', 'em_aprovacao')) then raise exception 'Já existe uma versão em elaboração ou em aprovação deste POP.'; end if;
  select * into v from proc_versoes where pop_id = p_pop order by versao desc limit 1;
  insert into proc_versoes (pop_id, empresa_id, versao, objetivo, aplicacao, responsabilidades, materiais, procedimento, registros, referencias, etapas, publico, leitores,
                            anexo_caminho, anexo_nome, elaborado_por, elaborado_nome)
    values (p_pop, pp.empresa_id, v.versao + 1, v.objetivo, v.aplicacao, v.responsabilidades, v.materiais, v.procedimento, v.registros, v.referencias, v.etapas, v.publico, v.leitores,
            v.anexo_caminho, v.anexo_nome, auth.uid(), public._proc_nome(pp.empresa_id, auth.uid()))
    returning id into v_id;
  return v_id;
end $$;

-- descartar um rascunho (o POP que só tinha o rascunho é excluído)
create or replace function public.proc_versao_descartar(p_versao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v proc_versoes;
begin
  select * into v from proc_versoes where id = p_versao for update;
  if not found or not public._proc_ve(v.empresa_id) then raise exception 'Versão não encontrada.'; end if;
  if v.situacao <> 'rascunho' then raise exception 'Só o rascunho pode ser descartado.'; end if;
  if not public._proc_pode_escrever(v) then raise exception 'Sem permissão para descartar o rascunho.'; end if;
  delete from proc_versoes where id = p_versao;
  if not exists (select 1 from proc_versoes where pop_id = v.pop_id) then delete from proc_pops where id = v.pop_id; end if;
end $$;

-- tornar o POP obsoleto (deixa de valer; o histórico fica)
create or replace function public.proc_pop_obsoletar(p_pop uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare pp proc_pops; x proc_processos;
begin
  select * into pp from proc_pops where id = p_pop for update;
  if not found or not public._proc_ve(pp.empresa_id) then raise exception 'POP não encontrado.'; end if;
  select * into x from proc_processos where id = pp.processo_id;
  if not (public._proc_gestor(pp.empresa_id) or coalesce(x.dono_id = auth.uid(), false)) then raise exception 'Só quem mantém o mapa ou o dono do processo torna o POP obsoleto.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo.'; end if;
  if exists (select 1 from proc_versoes where pop_id = p_pop and situacao = 'em_aprovacao') then raise exception 'Há uma versão em aprovação: decida-a antes.'; end if;
  delete from proc_versoes where pop_id = p_pop and situacao = 'rascunho';
  update proc_versoes set situacao = 'obsoleta', obsoleta_em = current_date where pop_id = p_pop and situacao = 'vigente';
  update proc_pops set ativo = false, versao_vigente = null, revisar_em = null, obsoleto_motivo = btrim(p_motivo) where id = p_pop;
end $$;

-- confirmar a leitura da versão vigente
create or replace function public.proc_ler(p_versao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v proc_versoes;
begin
  select * into v from proc_versoes where id = p_versao;
  if not found or not public._proc_ve(v.empresa_id) then raise exception 'Versão não encontrada.'; end if;
  if v.situacao <> 'vigente' then raise exception 'Só a versão em vigor tem a leitura confirmada.'; end if;
  insert into proc_leituras (versao_id, empresa_id, user_id, nome) values (v.id, v.empresa_id, auth.uid(), public._proc_nome(v.empresa_id, auth.uid()))
  on conflict (versao_id, user_id) do nothing;
end $$;

-- quem precisa ler a versão (perfis e pessoas) e quem já leu
create or replace function public.proc_leitores(p_versao uuid)
returns table (user_id uuid, nome text, papel text, obrigatorio boolean, lido_em timestamptz) language plpgsql stable security definer set search_path = public as $$
declare v proc_versoes;
begin
  select * into v from proc_versoes where id = p_versao;
  if not found or not public._proc_ve(v.empresa_id) then raise exception 'Versão não encontrada.'; end if;
  return query select m.user_id, public._proc_nome(v.empresa_id, m.user_id)::text, m.papel::text,
      (m.papel::text = any(v.publico) or m.user_id = any(v.leitores)), l.lido_em
    from membros m left join proc_leituras l on l.versao_id = v.id and l.user_id = m.user_id
   where m.empresa_id = v.empresa_id and (m.papel::text = any(v.publico) or m.user_id = any(v.leitores) or l.user_id is not null)
   order by (l.lido_em is null) desc, 2;
end $$;

-- ------------------------------------------------------------ avisos (cron diário)
-- revisão: aviso N dias antes, cobrança no dia seguinte ao vencimento e depois toda segunda-feira;
-- leitura: depois do prazo, cobrança a quem ainda não leu (uma vez e depois toda segunda-feira)
create or replace function public._proc_avisos()
returns int language plpgsql security definer set search_path = public as $$
declare r record; hoje date := (now() at time zone 'America/Recife')::date; n int := 0; v_pend uuid[];
begin
  for r in select pp.*, x.dono_id, x.codigo as pcod, v.elaborado_por, c.aviso_revisao_dias as av
             from proc_pops pp join proc_processos x on x.id = pp.processo_id join proc_versoes v on v.pop_id = pp.id and v.situacao = 'vigente'
             cross join lateral (select (public._proc_cfg(pp.empresa_id)).*) c
            where pp.ativo and pp.revisar_em is not null loop
    if r.revisar_em >= hoje and r.revisar_em - hoje <= r.av and r.revisao_avisada_em is null then
      insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
      select r.empresa_id, u, 'processo', 'Revisão do ' || r.codigo || ' vence em ' || to_char(r.revisar_em, 'DD/MM/YYYY'), r.titulo || ' — processo ' || r.pcod, '#/processos?pop=' || r.id, r.id
        from (select distinct unnest(array[r.dono_id, r.elaborado_por]) u) z where u is not null;
      update proc_pops set revisao_avisada_em = hoje where id = r.id; n := n + 1;
    elsif r.revisar_em < hoje and (r.revisao_cobrada_em is null or (extract(isodow from hoje) = 1 and r.revisao_cobrada_em < hoje)) then
      insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
      select r.empresa_id, u, 'processo', 'Revisão do ' || r.codigo || ' vencida há ' || (hoje - r.revisar_em) || ' dia(s)', r.titulo || ' — revise ou confirme sem mudanças', '#/processos?pop=' || r.id, r.id
        from (select distinct unnest(array[r.dono_id, r.elaborado_por]) u) z where u is not null;
      update proc_pops set revisao_cobrada_em = hoje where id = r.id; n := n + 1;
    end if;
  end loop;
  for r in select v.*, pp.codigo, pp.titulo, c.leitura_dias as ld, c.cobrar_leitura as cobra
             from proc_versoes v join proc_pops pp on pp.id = v.pop_id cross join lateral (select (public._proc_cfg(v.empresa_id)).*) c
            where v.situacao = 'vigente' and pp.ativo loop
    continue when not r.cobra or r.vigente_desde + r.ld >= hoje;
    continue when r.leitura_cobrada_em is not null and not (extract(isodow from hoje) = 1 and r.leitura_cobrada_em < hoje);
    select coalesce(array_agg(m.user_id), '{}') into v_pend from membros m
     where m.empresa_id = r.empresa_id and (m.papel::text = any(r.publico) or m.user_id = any(r.leitores))
       and not exists (select 1 from proc_leituras l where l.versao_id = r.id and l.user_id = m.user_id);
    if cardinality(v_pend) > 0 then
      insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
      select r.empresa_id, u, 'processo', 'Leitura pendente: ' || r.codigo || ' v' || r.versao, r.titulo || ' — abra e confirme a leitura', '#/processos?pop=' || r.pop_id, r.id from unnest(v_pend) u;
      n := n + 1;
    end if;
    update proc_versoes set leitura_cobrada_em = hoje where id = r.id;
  end loop;
  return n;
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('processos-avisos') where exists (select 1 from cron.job where jobname = 'processos-avisos');
    perform cron.schedule('processos-avisos', '29 10 * * *', 'select public._proc_avisos()');   -- 07:29 em Recife, todos os dias
  end if;
end $$;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('processo', 'Gestão', 'Processos e POPs', 'POP para aprovar, recusado ou em vigor para ler; leitura pendente; revisão do POP chegando ou vencida.', false, 45)
on conflict (codigo) do nothing;

-- ------------------------------------------------------------ sugestão: os processos que a plataforma executa
-- Idempotente: só cria o macroprocesso e o processo que faltam (pelo código). Os processos vêm marcados como sugeridos e sem dono.
create or replace function public.proc_configurar(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record; v_macro uuid; v_id uuid;
begin
  if not public._proc_gestor(p_empresa) then raise exception 'Só quem mantém o mapa prepara os processos sugeridos.'; end if;
  insert into proc_macros (empresa_id, codigo, nome, ordem) values
    (p_empresa, 'GES', 'Gestão e melhoria', 10), (p_empresa, 'COM', 'Comercial e faturamento', 20), (p_empresa, 'SUP', 'Suprimentos e estoque', 30),
    (p_empresa, 'QUA', 'Qualidade', 40), (p_empresa, 'FIN', 'Financeiro e controladoria', 50), (p_empresa, 'ADM', 'Administrativo', 60)
  on conflict (empresa_id, codigo) do nothing;
  for r in select * from (values
    ('SUP', 'SUP-01', 'Compras de materiais e serviços', 'Comprar o que a empresa precisa, no prazo, com cotação e dentro da alçada.', 'Requisição de compra do setor', 'Pedido de compra enviado ao fornecedor', 'Setor solicitante; Almoxarifado',
     '[{"tipo":"inicio","responsavel":"Solicitante","o_que":"Necessidade de material ou serviço"},
       {"tipo":"atividade","responsavel":"Solicitante","o_que":"Abrir a requisição de compra","tela":"compras/requisicoes"},
       {"tipo":"atividade","responsavel":"Compras","o_que":"Cotar com os fornecedores","prazo":"2 dias úteis","tela":"compras"},
       {"tipo":"decisao","responsavel":"Compras","o_que":"Acima da alçada de Compras?","nao":6},
       {"tipo":"atividade","responsavel":"Diretoria","o_que":"Aprovar a compra","prazo":"1 dia útil","tela":"aprovacoes"},
       {"tipo":"atividade","responsavel":"Compras","o_que":"Emitir o pedido e enviar ao fornecedor","tela":"compras/pedidos"},
       {"tipo":"atividade","responsavel":"Compras","o_que":"Acompanhar o prazo de entrega","tela":"compras/pedidos"},
       {"tipo":"fim","responsavel":"Compras","o_que":"Entrega: segue no Recebimento (SUP-02)"}]'),
    ('SUP', 'SUP-02', 'Recebimento de notas e mercadorias', 'Receber somente o que foi comprado, conferido em quantidade e qualidade, com a nota fiscal válida.', 'Mercadoria e nota fiscal do fornecedor', 'Estoque atualizado e título a pagar', 'Almoxarifado; Financeiro; Produção',
     '[{"tipo":"inicio","responsavel":"Portaria","o_que":"Mercadoria chega com a nota"},
       {"tipo":"atividade","responsavel":"Fiscal","o_que":"Conferir a nota na SEFAZ e manifestar","tela":"notas/sefaz"},
       {"tipo":"atividade","responsavel":"Almoxarifado","o_que":"Conferir produto e quantidade com o leitor","tela":"estoque/recebimento"},
       {"tipo":"decisao","responsavel":"Almoxarifado","o_que":"Divergência ou defeito?","nao":7},
       {"tipo":"atividade","responsavel":"Qualidade","o_que":"Registrar a não conformidade","tela":"qualidade/nao-conformidades"},
       {"tipo":"atividade","responsavel":"Compras","o_que":"Tratar com o fornecedor (devolução ou abatimento)","tela":"compras/recebimentos"},
       {"tipo":"atividade","responsavel":"Almoxarifado","o_que":"Dar entrada no estoque e guardar no endereço","tela":"estoque/recebimento"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Conferir o título a pagar","tela":"abertos"},
       {"tipo":"fim","responsavel":"Financeiro","o_que":"Mercadoria recebida"}]'),
    ('SUP', 'SUP-03', 'Requisição de material do almoxarifado', 'Entregar ao setor o material pedido, com aprovação e baixa no estoque.', 'Necessidade do setor', 'Material entregue e baixado no Kardex', 'Setores da fábrica',
     '[{"tipo":"inicio","responsavel":"Setor","o_que":"Setor precisa de material"},
       {"tipo":"atividade","responsavel":"Setor","o_que":"Pedir o material","tela":"almoxarifado"},
       {"tipo":"atividade","responsavel":"Chefe do setor","o_que":"Aprovar a requisição","tela":"almoxarifado"},
       {"tipo":"atividade","responsavel":"Almoxarifado","o_que":"Separar pela rota de endereços e entregar","tela":"almoxarifado"},
       {"tipo":"atividade","responsavel":"Setor","o_que":"Confirmar o recebimento","tela":"almoxarifado"},
       {"tipo":"fim","responsavel":"Almoxarifado","o_que":"Baixa no estoque"}]'),
    ('SUP', 'SUP-04', 'Inventário do estoque', 'Garantir que o estoque do sistema é o estoque físico.', 'Data do inventário (geral ou rotativo)', 'Estoque ajustado e acuracidade medida', 'Controladoria; Diretoria',
     '[{"tipo":"inicio","responsavel":"Almoxarifado","o_que":"Data do inventário"},
       {"tipo":"atividade","responsavel":"Almoxarifado","o_que":"Abrir o inventário e imprimir as guias","tela":"estoque/inventario-geral"},
       {"tipo":"atividade","responsavel":"Contadores","o_que":"Contar por endereço com o leitor","tela":"estoque/inventario-geral"},
       {"tipo":"decisao","responsavel":"Almoxarifado","o_que":"Diferença acima da tolerância?","nao":6},
       {"tipo":"atividade","responsavel":"Contadores","o_que":"Recontar os itens com diferença","tela":"estoque/inventario-geral"},
       {"tipo":"atividade","responsavel":"Controladoria","o_que":"Aprovar os ajustes","tela":"estoque/inventario-geral"},
       {"tipo":"fim","responsavel":"Controladoria","o_que":"Estoque ajustado no Kardex"}]'),
    ('COM', 'COM-01', 'Venda e faturamento', 'Transformar o pedido do cliente em produto entregue e faturado, com crédito aprovado.', 'Pedido ou proposta do cliente', 'NF-e emitida, entrega e título a receber', 'Cliente; Financeiro',
     '[{"tipo":"inicio","responsavel":"Cliente","o_que":"Pedido do cliente"},
       {"tipo":"atividade","responsavel":"Comercial","o_que":"Registrar a proposta ou o pedido","tela":"comercial/funil"},
       {"tipo":"decisao","responsavel":"Financeiro","o_que":"Crédito do cliente aprovado?","sim":5,"nao":4},
       {"tipo":"atividade","responsavel":"Comercial","o_que":"Negociar garantia ou pagamento antecipado","tela":"creditos"},
       {"tipo":"atividade","responsavel":"PCP","o_que":"Programar a produção","tela":"producao/programacao"},
       {"tipo":"atividade","responsavel":"Faturamento","o_que":"Emitir a NF-e","tela":"notas/emissao"},
       {"tipo":"atividade","responsavel":"Logística","o_que":"Expedir e entregar","tela":"logistica/fretes"},
       {"tipo":"fim","responsavel":"Financeiro","o_que":"Título a receber gerado"}]'),
    ('QUA', 'QUA-01', 'Inspeção e não conformidade', 'Liberar só o que atende ao plano de inspeção e tratar o que não atende.', 'Lote produzido ou recebido', 'Lote liberado ou bloqueado com RNC', 'Produção; Expedição; Compras',
     '[{"tipo":"inicio","responsavel":"Produção","o_que":"Lote pronto para inspeção"},
       {"tipo":"atividade","responsavel":"Qualidade","o_que":"Inspecionar pelo plano de inspeção","tela":"qualidade/inspecoes"},
       {"tipo":"decisao","responsavel":"Qualidade","o_que":"Lote aprovado?","sim":5,"nao":4},
       {"tipo":"atividade","responsavel":"Qualidade","o_que":"Bloquear o lote e abrir a RNC","tela":"qualidade/nao-conformidades","ir":6},
       {"tipo":"atividade","responsavel":"Qualidade","o_que":"Liberar o lote","tela":"qualidade/inspecoes"},
       {"tipo":"fim","responsavel":"Qualidade","o_que":"Lote com destino definido"}]'),
    ('FIN', 'FIN-01', 'Contas a pagar', 'Pagar no vencimento só o que foi conferido e aprovado, com o centro de custo certo.', 'Nota, contrato, folha ou guia', 'Pagamento feito e conciliado', 'Fornecedores; Contabilidade',
     '[{"tipo":"inicio","responsavel":"Financeiro","o_que":"Título a pagar chega"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Lançar com centro de custo e vencimento","tela":"abertos"},
       {"tipo":"decisao","responsavel":"Financeiro","o_que":"Acima da alçada?","nao":5},
       {"tipo":"atividade","responsavel":"Diretoria","o_que":"Autorizar o pagamento","tela":"autorizacao"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Pagar no vencimento (remessa ao banco)","tela":"abertos"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Conciliar com o extrato","tela":"conciliacao"},
       {"tipo":"fim","responsavel":"Financeiro","o_que":"Título baixado"}]'),
    ('FIN', 'FIN-02', 'Contas a receber e cobrança', 'Receber no prazo e cobrar logo o que atrasou.', 'NF-e emitida', 'Recebimento conciliado', 'Clientes; Comercial',
     '[{"tipo":"inicio","responsavel":"Financeiro","o_que":"Título a receber gerado"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Registrar o boleto ou a duplicata","tela":"duplicatas"},
       {"tipo":"decisao","responsavel":"Financeiro","o_que":"Pago no vencimento?","sim":5,"nao":4},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Cobrar e negociar","prazo":"no dia seguinte ao vencimento","tela":"cobranca"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Baixar e conciliar","tela":"conciliacao"},
       {"tipo":"fim","responsavel":"Financeiro","o_que":"Título recebido"}]'),
    ('FIN', 'FIN-03', 'Fechamento mensal', 'Fechar o mês com os números conferidos e apresentados à Diretoria.', 'Movimento do mês', 'DRE, fluxo de caixa, RMA e reunião de resultados', 'Diretoria; Contabilidade; Recuperação judicial',
     '[{"tipo":"inicio","responsavel":"Financeiro","o_que":"Fim do mês"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Conciliar todas as contas","prazo":"até o 3º dia útil","tela":"conciliacao"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Conferir o fechamento","tela":"conferencia"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Fechar o mês","tela":"fechamento"},
       {"tipo":"atividade","responsavel":"Contabilidade","o_que":"Fechamento contábil (balancete e DRE)","tela":"contab/fechamento"},
       {"tipo":"atividade","responsavel":"Financeiro","o_que":"Preparar o RMA","tela":"rma"},
       {"tipo":"atividade","responsavel":"Diretoria","o_que":"Reunião mensal de resultados","tela":"diretoria"},
       {"tipo":"fim","responsavel":"Diretoria","o_que":"Mês fechado"}]'),
    ('ADM', 'ADM-01', 'Arquivo morto', 'Guardar os documentos encerrados pelo prazo legal, achar rápido e descartar com termo.', 'Documentos encerrados nos setores', 'Caixas guardadas, retiradas controladas e descarte com termo', 'Todos os setores; Contabilidade; Jurídico',
     '[{"tipo":"inicio","responsavel":"Setor","o_que":"Documentos encerrados"},
       {"tipo":"atividade","responsavel":"Setor","o_que":"Montar a caixa e registrar o conteúdo","tela":"arquivo"},
       {"tipo":"atividade","responsavel":"Arquivo","o_que":"Etiquetar e guardar na prateleira","tela":"arquivo"},
       {"tipo":"atividade","responsavel":"Arquivo","o_que":"Registrar retiradas e devoluções","tela":"arquivo"},
       {"tipo":"atividade","responsavel":"Arquivo","o_que":"Propor o descarte do que venceu","tela":"arquivo"},
       {"tipo":"atividade","responsavel":"Diretoria","o_que":"Aprovar o descarte","tela":"arquivo"},
       {"tipo":"atividade","responsavel":"Arquivo","o_que":"Descartar e emitir o termo","tela":"arquivo"},
       {"tipo":"fim","responsavel":"Arquivo","o_que":"Documentos descartados"}]'),
    ('GES', 'GES-01', 'Tratamento de problemas e melhoria', 'Achar a causa dos problemas, agir e mudar o processo para não repetir.', 'Problema, reclamação ou não conformidade', 'Causa tratada e POP atualizado', 'Todos os setores',
     '[{"tipo":"inicio","responsavel":"Qualquer setor","o_que":"Problema identificado"},
       {"tipo":"atividade","responsavel":"Qualquer setor","o_que":"Abrir o problema","tela":"problemas"},
       {"tipo":"atividade","responsavel":"Responsável","o_que":"Analisar a causa (Pareto, Ishikawa, 5 Porquês)","tela":"problemas"},
       {"tipo":"atividade","responsavel":"Responsável","o_que":"Montar o plano de ação (5W2H)","tela":"problemas"},
       {"tipo":"atividade","responsavel":"Responsável","o_que":"Executar as ações","tela":"problemas"},
       {"tipo":"decisao","responsavel":"Responsável","o_que":"As ações resolveram?","nao":3},
       {"tipo":"atividade","responsavel":"Dono do processo","o_que":"Atualizar o processo e o POP","tela":"processos"},
       {"tipo":"fim","responsavel":"Dono do processo","o_que":"Problema encerrado"}]')
  ) s(mac, cod, nome, obj, ent, sai, cli, etapas) loop
    continue when exists (select 1 from proc_processos where empresa_id = p_empresa and codigo = r.cod);
    select id into v_macro from proc_macros where empresa_id = p_empresa and codigo = r.mac;
    perform public._proc_etapas_ok(r.etapas::jsonb);
    insert into proc_processos (empresa_id, macro_id, codigo, nome, objetivo, entradas, saidas, clientes, sugerido, ordem)
      values (p_empresa, v_macro, r.cod, r.nome, r.obj, r.ent, r.sai, r.cli, true, split_part(r.cod, '-', 2)::int * 10) returning id into v_id;
    insert into proc_etapas (processo_id, empresa_id, n, tipo, responsavel, o_que, prazo, tela, ir, sim, nao)
    select v_id, p_empresa, o::int, e->>'tipo', e->>'responsavel', e->>'o_que', e->>'prazo', e->>'tela', (e->>'ir')::int, (e->>'sim')::int, (e->>'nao')::int
      from jsonb_array_elements(r.etapas::jsonb) with ordinality t(e, o);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ------------------------------------------------------------ permissões
revoke all on function public._proc_cfg(uuid), public._proc_papel(uuid), public._proc_nome(uuid, uuid), public._proc_dir_users(uuid), public._proc_diretoria(uuid),
  public._proc_gestor(uuid), public._proc_elabora(uuid), public._proc_etapas_ok(jsonb), public._proc_pode_escrever(proc_versoes), public._proc_aprovadores(proc_versoes),
  public._proc_avisos() from public, anon, authenticated;
revoke all on function public._proc_ve(uuid), public._proc_anexo_ok(text, boolean) from public, anon;
grant execute on function public._proc_ve(uuid), public._proc_anexo_ok(text, boolean) to authenticated;   -- usadas nas políticas de leitura
do $$ declare f text; begin
  foreach f in array array['public.proc_acesso(uuid)', 'public.proc_pessoas(uuid)', 'public.proc_config_salvar(uuid, jsonb)', 'public.proc_macro_salvar(uuid, jsonb)',
    'public.proc_salvar(uuid, jsonb)', 'public.proc_excluir(uuid)', 'public.proc_pop_criar(uuid, text)', 'public.proc_versao_salvar(uuid, jsonb)',
    'public.proc_versao_enviar(uuid)', 'public.proc_versao_decidir(uuid, boolean, text)', 'public.proc_pop_revisar(uuid)', 'public.proc_versao_descartar(uuid)',
    'public.proc_pop_obsoletar(uuid, text)', 'public.proc_ler(uuid)', 'public.proc_leitores(uuid)', 'public.proc_configurar(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

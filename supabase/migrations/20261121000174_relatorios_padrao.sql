-- 174 — Padrão de relatórios, fase 1 (21/11/2026, pedido do Renan): relatório de ERP, com os filtros impressos e a
-- possibilidade de repetir. Este SQL guarda:
--   1. o CATÁLOGO dos relatórios (código estável por tela: EST002-R01, FIS002-R01 …), igual para todas as empresas;
--   2. o HISTÓRICO das emissões por empresa (número sequencial, quem, quando, parâmetros impressos e os filtros para repetir);
--   3. as VARIANTES: conjuntos de filtros salvos com nome, do usuário ou públicas;
--   4. os parâmetros por empresa (guardar o histórico por N meses, registrar ou não, quem publica variante).
-- Toda gravação passa pelas funções (as tabelas só têm política de leitura). Aditivo.

-- 1) quem gerencia (vê o histórico de todos, publica variante, muda parâmetros): administrador e diretor
create or replace function public.relp_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid());
$$;
create or replace function public.relp_gerencia(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor'));
$$;
revoke all on function public.relp_membro(uuid), public.relp_gerencia(uuid) from public, anon;
grant execute on function public.relp_membro(uuid), public.relp_gerencia(uuid) to authenticated;

-- 2) parâmetros por empresa (sem linha = padrões abaixo)
create table if not exists public.relp_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  registrar boolean not null default true,                                          -- grava cada emissão no histórico (desligado: o relatório sai sem número)
  meses_historico int not null default 24 check (meses_historico between 1 and 120), -- emissões mais antigas são apagadas
  variante_publica text not null default 'gerencia' check (variante_publica in ('gerencia', 'todos')),   -- quem pode publicar variante para a empresa
  cnpj_cabecalho boolean not null default true,                                     -- CNPJ abaixo do nome da empresa no cabeçalho
  atualizado_em timestamptz not null default now()
);

-- 3) catálogo: um código por relatório de cada tela (global — o mesmo código em todas as empresas)
create table if not exists public.relp_catalogo (
  id bigint generated always as identity primary key,
  tela text not null,                    -- código da tela (EST002) ou 'GER' quando a tela não tem código
  seq int not null,
  codigo text not null unique,           -- EST002-R01
  nome text not null,
  rota text,
  criado_em timestamptz not null default now(),
  unique (tela, seq)
);
create unique index if not exists relp_catalogo_nome on public.relp_catalogo (tela, lower(nome));

-- 4) histórico das emissões
create table if not exists public.relp_emissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  codigo text not null, nome text not null, tela text not null, rota text,
  formato text not null default 'pdf' check (formato in ('pdf', 'xlsx')),
  tipo text not null default 'relatorio' check (tipo in ('relatorio', 'documento')),   -- documento = pedido, ordem, laudo… (não tem filtro)
  parametros jsonb not null default '[]'::jsonb,   -- [[rótulo, valor]] como saiu impresso
  filtros jsonb,                                   -- estado dos filtros da tela, para o botão Repetir
  usuario_id uuid default auth.uid(), usuario_nome text,
  emitido_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists relp_emissoes_quando on public.relp_emissoes (empresa_id, emitido_em desc);
create index if not exists relp_emissoes_usuario on public.relp_emissoes (empresa_id, usuario_id, emitido_em desc);

-- 5) variantes de filtro
create table if not exists public.relp_variantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tela text not null, rota text not null,
  nome text not null check (length(trim(nome)) between 2 and 60),
  parametros jsonb not null default '[]'::jsonb,
  filtros jsonb not null,
  publica boolean not null default false,
  usuario_id uuid default auth.uid(), usuario_nome text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create unique index if not exists relp_variantes_nome on public.relp_variantes (empresa_id, rota, usuario_id, lower(nome));
create index if not exists relp_variantes_rota on public.relp_variantes (empresa_id, rota);

alter table public.relp_config enable row level security;
alter table public.relp_catalogo enable row level security;
alter table public.relp_emissoes enable row level security;
alter table public.relp_variantes enable row level security;
drop policy if exists relp_config_ler on public.relp_config;
create policy relp_config_ler on public.relp_config for select to authenticated using (public.relp_membro(empresa_id));
drop policy if exists relp_catalogo_ler on public.relp_catalogo;
create policy relp_catalogo_ler on public.relp_catalogo for select to authenticated using (true);
drop policy if exists relp_emissoes_ler on public.relp_emissoes;
create policy relp_emissoes_ler on public.relp_emissoes for select to authenticated
  using (public.relp_gerencia(empresa_id) or (usuario_id = auth.uid() and public.relp_membro(empresa_id)));
drop policy if exists relp_variantes_ler on public.relp_variantes;
create policy relp_variantes_ler on public.relp_variantes for select to authenticated
  using (public.relp_membro(empresa_id) and (publica or usuario_id = auth.uid()));
revoke all on public.relp_config, public.relp_catalogo, public.relp_emissoes, public.relp_variantes from anon;
revoke insert, update, delete on public.relp_config, public.relp_catalogo, public.relp_emissoes, public.relp_variantes from authenticated;
grant select on public.relp_config, public.relp_catalogo, public.relp_emissoes, public.relp_variantes to authenticated;

create or replace function public._relp_nome(p_empresa uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(m.nome), ''), (select split_part(u.email, '@', 1) from auth.users u where u.id = auth.uid())) from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid();
$$;
revoke all on function public._relp_nome(uuid) from public, anon, authenticated;

-- 6) registrar a emissão: devolve o código do relatório, o número da emissão, o nome de quem emitiu e os dados do cabeçalho
create or replace function public.relp_emitir(p_empresa uuid, p_tela text, p_nome text, p_rota text default null, p_formato text default 'pdf',
  p_tipo text default 'relatorio', p_parametros jsonb default '[]'::jsonb, p_filtros jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tela text := upper(coalesce(nullif(regexp_replace(coalesce(p_tela, ''), '[^A-Za-z0-9]', '', 'g'), ''), 'GER'));
  v_nome text := left(trim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g')), 80);
  v_cat relp_catalogo; v_cfg relp_config; v_num int; v_quem text; v_seq int;
  v_par jsonb := coalesce(p_parametros, '[]'::jsonb); v_fil jsonb := p_filtros;
begin
  if not public.relp_membro(p_empresa) then raise exception 'Sem acesso a esta empresa'; end if;
  if length(v_tela) > 12 then raise exception 'Código de tela inválido'; end if;
  if length(v_nome) < 3 then raise exception 'Informe o nome do relatório'; end if;
  if p_formato not in ('pdf', 'xlsx') then raise exception 'Formato inválido'; end if;
  if p_tipo not in ('relatorio', 'documento') then raise exception 'Tipo inválido'; end if;
  if jsonb_typeof(v_par) <> 'array' or pg_column_size(v_par) > 16000 then v_par := '[]'::jsonb; end if;
  if v_fil is not null and pg_column_size(v_fil) > 16000 then v_fil := null; end if;
  -- catálogo: o código nasce na primeira emissão e não muda mais
  select * into v_cat from relp_catalogo where tela = v_tela and lower(nome) = lower(v_nome);
  if not found then
    perform pg_advisory_xact_lock(hashtext('relp_catalogo:' || v_tela));
    select * into v_cat from relp_catalogo where tela = v_tela and lower(nome) = lower(v_nome);
    if not found then
      select coalesce(max(seq), 0) + 1 into v_seq from relp_catalogo where tela = v_tela;
      insert into relp_catalogo (tela, seq, codigo, nome, rota) values (v_tela, v_seq, v_tela || '-R' || lpad(v_seq::text, 2, '0'), v_nome, left(p_rota, 120)) returning * into v_cat;
    end if;
  end if;
  select * into v_cfg from relp_config where empresa_id = p_empresa;
  v_quem := public._relp_nome(p_empresa);
  if coalesce(v_cfg.registrar, true) then
    perform pg_advisory_xact_lock(hashtext('relp_emissoes:' || p_empresa::text));
    select coalesce(max(numero), 0) + 1 into v_num from relp_emissoes where empresa_id = p_empresa;
    insert into relp_emissoes (empresa_id, numero, codigo, nome, tela, rota, formato, tipo, parametros, filtros, usuario_id, usuario_nome)
      values (p_empresa, v_num, v_cat.codigo, v_nome, v_tela, left(p_rota, 120), p_formato, p_tipo, v_par, v_fil, auth.uid(), v_quem);
  end if;
  return jsonb_build_object('codigo', v_cat.codigo, 'numero', v_num, 'usuario', v_quem, 'emitido_em', now(),
    'cnpj', case when coalesce(v_cfg.cnpj_cabecalho, true) then (select cnpj from empresas where id = p_empresa) end);
end $$;

-- 7) variantes
create or replace function public.relp_variante_salvar(p_empresa uuid, p_id uuid, p_tela text, p_rota text, p_nome text, p_filtros jsonb, p_parametros jsonb default '[]'::jsonb, p_publica boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v relp_variantes; v_cfg relp_config; v_id uuid; v_nome text := trim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
begin
  if not public.relp_membro(p_empresa) then raise exception 'Sem acesso a esta empresa'; end if;
  if length(v_nome) < 2 or length(v_nome) > 60 then raise exception 'Dê um nome à variante (2 a 60 letras)'; end if;
  if p_filtros is null or jsonb_typeof(p_filtros) <> 'object' or pg_column_size(p_filtros) > 16000 then raise exception 'Filtros inválidos'; end if;
  if coalesce(p_rota, '') = '' then raise exception 'Tela não informada'; end if;
  select * into v_cfg from relp_config where empresa_id = p_empresa;
  if coalesce(p_publica, false) and coalesce(v_cfg.variante_publica, 'gerencia') = 'gerencia' and not public.relp_gerencia(p_empresa) then
    raise exception 'Só o administrador ou o diretor publica variante para a empresa';
  end if;
  if p_id is not null then
    select * into v from relp_variantes where id = p_id and empresa_id = p_empresa;
    if not found then raise exception 'Variante não encontrada'; end if;
    if v.usuario_id is distinct from auth.uid() and not public.relp_gerencia(p_empresa) then raise exception 'Esta variante é de outra pessoa'; end if;
    update relp_variantes set nome = v_nome, filtros = p_filtros, parametros = coalesce(p_parametros, '[]'::jsonb), publica = coalesce(p_publica, false), atualizado_em = now() where id = p_id;
    return p_id;
  end if;
  if exists (select 1 from relp_variantes where empresa_id = p_empresa and rota = p_rota and usuario_id = auth.uid() and lower(nome) = lower(v_nome)) then
    raise exception 'Você já tem uma variante com este nome nesta tela';
  end if;
  insert into relp_variantes (empresa_id, tela, rota, nome, filtros, parametros, publica, usuario_id, usuario_nome)
    values (p_empresa, upper(coalesce(nullif(p_tela, ''), 'GER')), left(p_rota, 120), v_nome, p_filtros, coalesce(p_parametros, '[]'::jsonb), coalesce(p_publica, false), auth.uid(), public._relp_nome(p_empresa))
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.relp_variante_excluir(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v relp_variantes;
begin
  select * into v from relp_variantes where id = p_id;
  if not found or not public.relp_membro(v.empresa_id) then raise exception 'Variante não encontrada'; end if;
  if v.usuario_id is distinct from auth.uid() and not public.relp_gerencia(v.empresa_id) then raise exception 'Esta variante é de outra pessoa'; end if;
  delete from relp_variantes where id = p_id;
end $$;

-- 8) parâmetros (administrador e diretor)
create or replace function public.relp_config_salvar(p_empresa uuid, p_registrar boolean, p_meses int, p_variante_publica text, p_cnpj boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.relp_gerencia(p_empresa) then raise exception 'Só o administrador ou o diretor muda os parâmetros dos relatórios'; end if;
  if p_meses is null or p_meses < 1 or p_meses > 120 then raise exception 'Guarde o histórico por 1 a 120 meses'; end if;
  if p_variante_publica not in ('gerencia', 'todos') then raise exception 'Opção inválida'; end if;
  insert into relp_config (empresa_id, registrar, meses_historico, variante_publica, cnpj_cabecalho)
    values (p_empresa, coalesce(p_registrar, true), p_meses, p_variante_publica, coalesce(p_cnpj, true))
  on conflict (empresa_id) do update set registrar = excluded.registrar, meses_historico = excluded.meses_historico,
    variante_publica = excluded.variante_publica, cnpj_cabecalho = excluded.cnpj_cabecalho, atualizado_em = now();
end $$;

revoke all on function public.relp_emitir(uuid, text, text, text, text, text, jsonb, jsonb), public.relp_variante_salvar(uuid, uuid, text, text, text, jsonb, jsonb, boolean),
  public.relp_variante_excluir(uuid), public.relp_config_salvar(uuid, boolean, int, text, boolean) from public, anon;
grant execute on function public.relp_emitir(uuid, text, text, text, text, text, jsonb, jsonb), public.relp_variante_salvar(uuid, uuid, text, text, text, jsonb, jsonb, boolean),
  public.relp_variante_excluir(uuid), public.relp_config_salvar(uuid, boolean, int, text, boolean) to authenticated;

-- 9) limpeza do histórico antigo (todo dia 1º, 03:23 em Recife)
create or replace function public._relp_limpar()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from relp_emissoes e where e.emitido_em < now() - make_interval(months => coalesce((select c.meses_historico from relp_config c where c.empresa_id = e.empresa_id), 24));
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public._relp_limpar() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('relatorios-limpar') where exists (select 1 from cron.job where jobname = 'relatorios-limpar');
    perform cron.schedule('relatorios-limpar', '23 6 1 * *', 'select public._relp_limpar()');
  end if;
end $$;

-- =====================================================================
-- Fluxo de Caixa SaaS — schema multiempresa (Supabase / PostgreSQL)
-- Cada empresa (tenant) só enxerga os próprios dados via RLS.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tenants e membros
-- ---------------------------------------------------------------------
create table public.empresas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cnpj          text,
  ano_inicio    int  not null default extract(year from now())::int,
  mes_inicio_fiscal int not null default 1 check (mes_inicio_fiscal between 1 and 12),
  elaborado_por text,
  created_at    timestamptz not null default now()
);

create type public.papel_membro as enum ('admin','financeiro','diretor','leitura');

create table public.membros (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  papel      public.papel_membro not null default 'financeiro',
  nome       text,
  created_at timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index on public.membros(user_id);

-- Funções auxiliares de autorização (security definer evita recursão de RLS)
create or replace function public.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid());
$$;

create or replace function public.pode_editar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and papel in ('admin','financeiro'));
$$;

create or replace function public.is_admin(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and papel = 'admin');
$$;

create or replace function public.pode_autorizar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid()
                and papel in ('admin','financeiro','diretor'));
$$;

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create table public.grupos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  unique (empresa_id, nome)
);

create table public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

-- Plano de contas em 2 níveis: classificação (1.01) e conta (1.01.01)
-- tipo: E = entrada, S = saída, T = transferência
-- natureza: C = soma no caixa, D = subtrai do caixa
-- dre_secao: em qual bloco da DRE gerencial a classificação entra
-- prioridade: (só saídas) Obrigatório / Negociável — usada na Autorização de Pagamentos
create table public.plano_contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  tipo char(1) not null check (tipo in ('E','S','T')),
  natureza char(1) not null check (natureza in ('C','D')),
  nivel smallint not null check (nivel in (1,2)),
  pai_id uuid references public.plano_contas(id) on delete cascade,
  dre_secao text check (dre_secao in ('receita_bruta','custos_diretos','despesas_operacionais',
                                      'receitas_financeiras','despesas_financeiras','tributos',
                                      'nao_operacionais','capital_giro')),
  prioridade text check (prioridade in ('Obrigatório','Negociável')),
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);
create index on public.plano_contas(empresa_id, nivel);

create table public.favorecidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null default 'FORNECEDORES',
  sigla text,
  nome text not null,
  segmento text,
  documento text,
  forma_pagamento text,
  dados_bancarios text,
  periodicidade text,
  ativo boolean not null default true,
  unique (empresa_id, tipo, nome)
);
create index on public.favorecidos(empresa_id, nome);

create table public.contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text,
  tipo text,
  nome text not null,
  grupo_id uuid references public.grupos(id) on delete set null,
  disponibilidade text not null default 'Conta com recursos disponíveis'
    check (disponibilidade in ('Conta com recursos disponíveis','Conta com recursos bloqueados')),
  saldo_inicial numeric(16,2) not null default 0,
  saldo_inicial_aberto numeric(16,2) not null default 0,
  saldo_budget numeric(16,2) not null default 0,
  saldo_forecast numeric(16,2) not null default 0,
  instituicao text,
  agencia text,
  numero text,
  ativo boolean not null default true,
  unique (empresa_id, nome)
);

-- ---------------------------------------------------------------------
-- Lançamentos (equivalente às abas 1 a 12)
-- valor sempre positivo; o sinal vem da natureza do plano de contas.
-- status: Pago (realizado) | Em aberto (a pagar / a receber)
-- ---------------------------------------------------------------------
create table public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null,
  plano_id uuid not null references public.plano_contas(id),
  descricao text,
  opc1 text, opc2 text, opc3 text, opc4 text,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  status text not null default 'Pago' check (status in ('Pago','Em aberto')),
  conta_id uuid references public.contas(id) on delete restrict,
  valor numeric(16,2) not null check (valor >= 0),
  prioridade text check (prioridade in ('Obrigatório','Negociável')),
  origem text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.lancamentos(empresa_id, data);
create index on public.lancamentos(empresa_id, status, data);
create index on public.lancamentos(plano_id);
create index on public.lancamentos(conta_id);
create index on public.lancamentos(favorecido_id);

create or replace function public.tg_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger lancamentos_updated before update on public.lancamentos
  for each row execute function public.tg_updated_at();

-- Garante que plano/conta/favorecido/CC pertencem à mesma empresa do lançamento
create or replace function public.tg_lanc_mesma_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from plano_contas where id = new.plano_id and empresa_id = new.empresa_id and nivel = 2) then
    raise exception 'Plano de contas inválido para esta empresa (use uma conta de nível 2)';
  end if;
  if new.conta_id is not null and not exists (select 1 from contas where id = new.conta_id and empresa_id = new.empresa_id) then
    raise exception 'Conta bancária inválida para esta empresa';
  end if;
  if new.favorecido_id is not null and not exists (select 1 from favorecidos where id = new.favorecido_id and empresa_id = new.empresa_id) then
    raise exception 'Favorecido inválido para esta empresa';
  end if;
  if new.centro_custo_id is not null and not exists (select 1 from centros_custo where id = new.centro_custo_id and empresa_id = new.empresa_id) then
    raise exception 'Centro de custo inválido para esta empresa';
  end if;
  return new;
end $$;
create trigger lancamentos_check before insert or update on public.lancamentos
  for each row execute function public.tg_lanc_mesma_empresa();

-- ---------------------------------------------------------------------
-- Budget / Forecast (formato longo: 1 linha por conta x mês)
-- ---------------------------------------------------------------------
create table public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cenario text not null check (cenario in ('budget','forecast')),
  ano int not null,
  mes smallint not null check (mes between 1 and 12),
  plano_id uuid not null references public.plano_contas(id) on delete cascade,
  centro_custo_id uuid references public.centros_custo(id) on delete cascade,
  valor numeric(16,2) not null default 0
);
create unique index orcamentos_uk on public.orcamentos
  (empresa_id, cenario, ano, mes, plano_id, coalesce(centro_custo_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Status do forecast por mês: Realizado usa o caixa real; Prev. Ajustada usa o forecast; Prev. Inicial usa o budget
create table public.forecast_status (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ano int not null,
  mes smallint not null check (mes between 1 and 12),
  status text not null default 'Prev. Ajustada' check (status in ('Realizado','Prev. Ajustada','Prev. Inicial')),
  primary key (empresa_id, ano, mes)
);

-- ---------------------------------------------------------------------
-- Autorização de pagamentos (aba 5.6)
-- ---------------------------------------------------------------------
create table public.autorizacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  emissao date not null default current_date,
  elaborado_por text,
  status text not null default 'Pendente' check (status in ('Pendente','Aprovada','Rejeitada')),
  aprovado_por uuid references auth.users(id),
  aprovado_em timestamptz,
  total_listado numeric(16,2) not null default 0,
  total_autorizado numeric(16,2) not null default 0,
  saldo_bancos numeric(16,2),
  filtros jsonb,
  observacao text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (empresa_id, numero)
);

create table public.autorizacao_itens (
  id uuid primary key default gen_random_uuid(),
  autorizacao_id uuid not null references public.autorizacoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  vencimento date,
  favorecido text,
  descricao text,
  plano text,
  centro_custo text,
  conta text,
  prioridade text,
  valor numeric(16,2) not null,
  autoriza boolean not null default false,
  valor_autorizado numeric(16,2) not null default 0,
  observacao text
);
create index on public.autorizacao_itens(autorizacao_id);

create or replace function public.tg_autorizacao_numero() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null or new.numero = 0 then
    select coalesce(max(numero),0) + 1 into new.numero from autorizacoes where empresa_id = new.empresa_id;
  end if;
  return new;
end $$;
create trigger autorizacoes_numero before insert on public.autorizacoes
  for each row execute function public.tg_autorizacao_numero();

-- ---------------------------------------------------------------------
-- FIDC (abas 5.7 / 5.8)
-- ---------------------------------------------------------------------
create table public.fidc_operacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fundo text not null,
  data date not null,
  bordero text not null,
  arquivo text,
  conta_id uuid references public.contas(id) on delete set null,
  qtd_titulos int not null default 0,
  valor_face numeric(16,2) not null default 0,
  desagio numeric(16,2) not null default 0,
  ad_valorem numeric(16,2) not null default 0,
  tarifas numeric(16,2) not null default 0,
  iof numeric(16,2) not null default 0,
  encargos numeric(16,2) not null default 0,
  recompra numeric(16,2) not null default 0,
  desc_sacado numeric(16,2) not null default 0,
  liquido numeric(16,2) not null default 0,
  prazo_medio numeric(10,2) not null default 0,
  observacao text,
  custo_total numeric(16,2) generated always as (desagio + ad_valorem + tarifas + iof + encargos) stored,
  unique (empresa_id, fundo, bordero)
);
create index on public.fidc_operacoes(empresa_id, data);

create table public.fidc_titulos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  operacao_id uuid references public.fidc_operacoes(id) on delete cascade,
  fundo text,
  bordero text,
  data_operacao date,
  titulo text,
  vencimento date,
  valor numeric(16,2) not null default 0,
  cnpj_sacado text,
  sacado text,
  sacado_agrupado text
);
create index on public.fidc_titulos(empresa_id, operacao_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.empresas          enable row level security;
alter table public.membros           enable row level security;
alter table public.grupos            enable row level security;
alter table public.centros_custo     enable row level security;
alter table public.plano_contas      enable row level security;
alter table public.favorecidos       enable row level security;
alter table public.contas            enable row level security;
alter table public.lancamentos       enable row level security;
alter table public.orcamentos        enable row level security;
alter table public.forecast_status   enable row level security;
alter table public.autorizacoes      enable row level security;
alter table public.autorizacao_itens enable row level security;
alter table public.fidc_operacoes    enable row level security;
alter table public.fidc_titulos      enable row level security;

create policy empresas_sel on public.empresas for select to authenticated using (public.is_membro(id));
create policy empresas_upd on public.empresas for update to authenticated using (public.is_admin(id));

create policy membros_sel on public.membros for select to authenticated using (public.is_membro(empresa_id));
create policy membros_ins on public.membros for insert to authenticated with check (public.is_admin(empresa_id));
create policy membros_upd on public.membros for update to authenticated using (public.is_admin(empresa_id));
create policy membros_del on public.membros for delete to authenticated using (public.is_admin(empresa_id) and user_id <> (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['grupos','centros_custo','plano_contas','favorecidos','contas',
                           'lancamentos','orcamentos','forecast_status','fidc_operacoes','fidc_titulos']
  loop
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_membro(empresa_id))', t);
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_editar(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_editar(empresa_id))', t);
  end loop;
end $$;

-- Autorizações: financeiro cria; diretor também pode aprovar/rejeitar
create policy autorizacoes_sel on public.autorizacoes for select to authenticated using (public.is_membro(empresa_id));
create policy autorizacoes_ins on public.autorizacoes for insert to authenticated with check (public.pode_editar(empresa_id));
create policy autorizacoes_upd on public.autorizacoes for update to authenticated using (public.pode_autorizar(empresa_id));
create policy autorizacoes_del on public.autorizacoes for delete to authenticated using (public.is_admin(empresa_id));
create policy autorizacao_itens_sel on public.autorizacao_itens for select to authenticated using (public.is_membro(empresa_id));
create policy autorizacao_itens_ins on public.autorizacao_itens for insert to authenticated with check (public.pode_editar(empresa_id));
create policy autorizacao_itens_upd on public.autorizacao_itens for update to authenticated using (public.pode_autorizar(empresa_id));
create policy autorizacao_itens_del on public.autorizacao_itens for delete to authenticated using (public.pode_editar(empresa_id));

-- ---------------------------------------------------------------------
-- View de lançamentos com nomes e valor com sinal (respeita RLS)
-- ---------------------------------------------------------------------
create or replace view public.v_lancamentos with (security_invoker = true) as
select l.*,
       extract(year from l.data)::int  as ano,
       extract(month from l.data)::int as mes,
       case when p.natureza = 'C' then l.valor else -l.valor end as valor_sinal,
       p.codigo as plano_codigo, p.nome as plano_nome, p.tipo,
       c1.id as classe_id, c1.codigo as classe_codigo, c1.nome as classe_nome,
       coalesce(c1.prioridade,'Negociável') as prioridade_classe,
       coalesce(l.prioridade, c1.prioridade, 'Negociável') as prioridade_efetiva,
       f.nome as favorecido_nome, f.sigla as favorecido_sigla,
       cc.nome as centro_custo_nome,
       ct.nome as conta_nome, ct.grupo_id, ct.disponibilidade,
       g.nome as grupo_nome
from public.lancamentos l
join public.plano_contas p on p.id = l.plano_id
left join public.plano_contas c1 on c1.id = p.pai_id
left join public.favorecidos f on f.id = l.favorecido_id
left join public.centros_custo cc on cc.id = l.centro_custo_id
left join public.contas ct on ct.id = l.conta_id
left join public.grupos g on g.id = ct.grupo_id;

-- Permissões de tabela (o Supabase já concede por padrão; explícito por segurança — o RLS continua valendo)
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke execute on function public.is_membro(uuid), public.pode_editar(uuid), public.is_admin(uuid), public.pode_autorizar(uuid) from anon, public;
grant execute on function public.is_membro(uuid), public.pode_editar(uuid), public.is_admin(uuid), public.pode_autorizar(uuid) to authenticated;

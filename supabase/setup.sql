-- ============================================================
-- SETUP COMPLETO — cole tudo no SQL Editor do Supabase e clique em Run
-- (equivale a aplicar os arquivos de supabase/migrations em ordem)
-- ============================================================
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

create policy empresas_sel on public.empresas for select using (public.is_membro(id));
create policy empresas_upd on public.empresas for update using (public.is_admin(id));

create policy membros_sel on public.membros for select using (public.is_membro(empresa_id));
create policy membros_ins on public.membros for insert with check (public.is_admin(empresa_id));
create policy membros_upd on public.membros for update using (public.is_admin(empresa_id));
create policy membros_del on public.membros for delete using (public.is_admin(empresa_id) and user_id <> auth.uid());

do $$
declare t text;
begin
  foreach t in array array['grupos','centros_custo','plano_contas','favorecidos','contas',
                           'lancamentos','orcamentos','forecast_status','fidc_operacoes','fidc_titulos']
  loop
    execute format('create policy %1$s_sel on public.%1$s for select using (public.is_membro(empresa_id))', t);
    execute format('create policy %1$s_ins on public.%1$s for insert with check (public.pode_editar(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete using (public.pode_editar(empresa_id))', t);
  end loop;
end $$;

-- Autorizações: financeiro cria; diretor também pode aprovar/rejeitar
create policy autorizacoes_sel on public.autorizacoes for select using (public.is_membro(empresa_id));
create policy autorizacoes_ins on public.autorizacoes for insert with check (public.pode_editar(empresa_id));
create policy autorizacoes_upd on public.autorizacoes for update using (public.pode_autorizar(empresa_id));
create policy autorizacoes_del on public.autorizacoes for delete using (public.is_admin(empresa_id));
create policy autorizacao_itens_sel on public.autorizacao_itens for select using (public.is_membro(empresa_id));
create policy autorizacao_itens_ins on public.autorizacao_itens for insert with check (public.pode_editar(empresa_id));
create policy autorizacao_itens_upd on public.autorizacao_itens for update using (public.pode_autorizar(empresa_id));
create policy autorizacao_itens_del on public.autorizacao_itens for delete using (public.pode_editar(empresa_id));

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
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- =====================================================================
-- Funções (RPC) usadas pelo front-end
-- =====================================================================

-- ---------------------------------------------------------------------
-- Onboarding: cria a empresa, torna o usuário admin e aplica um plano de contas modelo
-- ---------------------------------------------------------------------
create or replace function public.criar_empresa(p_nome text, p_cnpj text default null, p_ano int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_ano int := coalesce(p_ano, extract(year from now())::int);
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  insert into empresas(nome, cnpj, ano_inicio) values (p_nome, p_cnpj, v_ano) returning id into v_emp;
  insert into membros(empresa_id, user_id, papel) values (v_emp, auth.uid(), 'admin');
  insert into grupos(empresa_id, nome) values (v_emp, 'MATRIZ');
  insert into centros_custo(empresa_id, nome)
    select v_emp, x from unnest(array['ADMINISTRATIVO','COMERCIAL','FINANCEIRO','PRODUÇÃO','LOGISTICA','DIREÇÃO']) x;
  perform aplicar_plano_modelo(v_emp);
  insert into forecast_status(empresa_id, ano, mes) select v_emp, v_ano, m from generate_series(1,12) m;
  return v_emp;
end $$;

create or replace function public.aplicar_plano_modelo(p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_pai uuid;
begin
  for r in select * from (values
    ('1.01','Receita de vendas','E','C','receita_bruta',null, array['Receita com vendas de produtos','Receita com serviços','Adiantamento de clientes']),
    ('1.02','Receitas financeiras','E','C','receitas_financeiras',null, array['Rendimentos de aplicações','Juros recebidos','Antecipação de recebíveis (FIDC/Factoring)']),
    ('1.03','Devoluções','E','C','receita_bruta',null, array['Devolução de fornecedores']),
    ('1.04','Outras entradas','E','C','receita_bruta',null, array['Venda de ativos','Outras receitas']),
    ('2.01','Despesa com insumos','S','D','custos_diretos','Negociável', array['Matéria-prima','Embalagens','Materiais diretos']),
    ('2.02','Despesa com serviços','S','D','custos_diretos','Negociável', array['Serviços de terceiros na produção']),
    ('2.03','Despesa com pessoal','S','D','despesas_operacionais','Obrigatório', array['Salários','Férias','13º salário','FGTS','INSS','Vale-transporte','Plano de saúde','Rescisões']),
    ('2.04','Despesas comerciais','S','D','despesas_operacionais','Negociável', array['Comissões de vendas','Marketing','Brindes e doações']),
    ('2.05','Despesas administrativas','S','D','despesas_operacionais','Negociável', array['Contabilidade','Aluguel','Energia elétrica','Água','Internet e telefone','Material de expediente','Sistemas e software','Manutenção']),
    ('2.06','Despesas com logística','S','D','despesas_operacionais','Negociável', array['Fretes','Combustível','Manutenção de veículos','IPVA e licenciamento']),
    ('2.07','Despesas financeiras','S','D','despesas_financeiras','Obrigatório', array['Juros','Tarifas bancárias','IOF','Deságio de antecipação']),
    ('2.08','Tributos','S','D','tributos','Obrigatório', array['Simples Nacional / DAS','PIS e COFINS','ICMS','ISS','IRPJ e CSLL','Parcelamentos']),
    ('2.09','Investimentos','S','D','nao_operacionais','Negociável', array['Máquinas e equipamentos','Obras e instalações']),
    ('2.10','Retirada de sócios','S','D','nao_operacionais','Negociável', array['Pró-labore','Distribuição de lucros']),
    ('2.11','Outras saídas','S','D','despesas_operacionais','Negociável', array['Outras despesas']),
    ('2.12','Empréstimos','S','D','nao_operacionais','Obrigatório', array['Amortização de empréstimos']),
    ('2.13','Adiantamentos','S','D','capital_giro','Negociável', array['Adiantamento a fornecedores']),
    ('2.14','Não operacionais','S','D','nao_operacionais','Negociável', array['Despesas não operacionais']),
    ('3.01','Transferências (crédito)','T','C',null,null, array['Transferência entre contas']),
    ('3.02','Transferências (débito)','T','D',null,null, array['Transferência entre contas'])
  ) as t(codigo,nome,tipo,nat,dre,prio,filhos)
  loop
    insert into plano_contas(empresa_id,codigo,nome,tipo,natureza,nivel,dre_secao,prioridade)
      values (p_empresa, r.codigo, r.nome, r.tipo, r.nat, 1, r.dre, r.prio)
      on conflict (empresa_id,codigo) do nothing
      returning id into v_pai;
    if v_pai is not null then
      insert into plano_contas(empresa_id,codigo,nome,tipo,natureza,nivel,pai_id)
        select p_empresa, r.codigo || '.' || lpad(i::text,2,'0'), upper(r.filhos[i]), r.tipo, r.nat, 2, v_pai
        from generate_subscripts(r.filhos,1) i;
    end if;
  end loop;
end $$;

-- Adiciona um usuário já cadastrado (pelo e-mail) como membro da empresa
create or replace function public.adicionar_membro(p_empresa uuid, p_email text, p_papel public.papel_membro default 'financeiro')
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not is_admin(p_empresa) then raise exception 'Apenas administradores podem adicionar membros'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'Usuário % não encontrado. Peça para ele criar a conta primeiro.', p_email; end if;
  insert into membros(empresa_id,user_id,papel) values (p_empresa, v_uid, p_papel)
    on conflict (empresa_id,user_id) do update set papel = excluded.papel;
end $$;

create or replace function public.listar_membros(p_empresa uuid)
returns table(user_id uuid, email text, papel public.papel_membro, created_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.papel, m.created_at
  from membros m join auth.users u on u.id = m.user_id
  where m.empresa_id = p_empresa and is_membro(p_empresa)
  order by m.created_at;
$$;

-- ---------------------------------------------------------------------
-- Filtro padrão dos relatórios (equivalente aos filtros C. Custo / Favorecido / Grupo / Conta / Disponibilidade)
-- ---------------------------------------------------------------------
create or replace function public._lanc_filtrados(
  p_empresa uuid, p_de date, p_ate date, p_status text[],
  p_conta uuid, p_grupo uuid, p_cc uuid, p_favorecido uuid, p_disp text)
returns table(id uuid, data date, plano_id uuid, classe_id uuid, valor_sinal numeric, status text, conta_id uuid)
language sql stable set search_path = public as $$
  select l.id, l.data, l.plano_id, p.pai_id,
         case when p.natureza = 'C' then l.valor else -l.valor end,
         l.status, l.conta_id
  from lancamentos l
  join plano_contas p on p.id = l.plano_id
  join contas ct on ct.id = l.conta_id
  where l.empresa_id = p_empresa
    and is_membro(p_empresa)
    and l.data between p_de and p_ate
    and l.status = any(p_status)
    and (p_conta is null or l.conta_id = p_conta)
    and (p_grupo is null or ct.grupo_id = p_grupo)
    and (p_cc is null or l.centro_custo_id = p_cc)
    and (p_favorecido is null or l.favorecido_id = p_favorecido)
    and (p_disp is null or ct.disponibilidade = p_disp);
$$;

-- Totais por conta do plano x mês (base do FC mensal, DRE e Orçado x Realizado)
create or replace function public.resumo_mensal(
  p_empresa uuid, p_ano int, p_status text[] default array['Pago'],
  p_conta uuid default null, p_grupo uuid default null, p_cc uuid default null,
  p_favorecido uuid default null, p_disp text default null)
returns table(plano_id uuid, classe_id uuid, mes int, total numeric, qtd bigint)
language sql stable set search_path = public as $$
  select plano_id, classe_id, extract(month from data)::int, sum(valor_sinal), count(*)
  from _lanc_filtrados(p_empresa, make_date(p_ano,1,1), make_date(p_ano,12,31), p_status,
                       p_conta, p_grupo, p_cc, p_favorecido, p_disp)
  group by 1,2,3;
$$;

-- Totais por dia x classificação (FC diário)
create or replace function public.resumo_diario(
  p_empresa uuid, p_ano int, p_mes int, p_status text[] default array['Pago'],
  p_conta uuid default null, p_grupo uuid default null, p_cc uuid default null,
  p_favorecido uuid default null, p_disp text default null)
returns table(dia date, classe_id uuid, total numeric)
language sql stable set search_path = public as $$
  select data, classe_id, sum(valor_sinal)
  from _lanc_filtrados(p_empresa, make_date(p_ano,p_mes,1),
                       (make_date(p_ano,p_mes,1) + interval '1 month - 1 day')::date, p_status,
                       p_conta, p_grupo, p_cc, p_favorecido, p_disp)
  group by 1,2;
$$;

-- Saldo de abertura de uma data (saldos iniciais das contas + movimentos anteriores)
create or replace function public.saldo_em(
  p_empresa uuid, p_data date, p_status text[] default array['Pago'],
  p_conta uuid default null, p_grupo uuid default null, p_cc uuid default null,
  p_favorecido uuid default null, p_disp text default null)
returns numeric language sql stable set search_path = public as $$
  select coalesce((select sum(ct.saldo_inicial + case when 'Em aberto' = any(p_status) then ct.saldo_inicial_aberto else 0 end)
                   from contas ct
                   where ct.empresa_id = p_empresa and is_membro(p_empresa)
                     and p_cc is null and p_favorecido is null
                     and (p_conta is null or ct.id = p_conta)
                     and (p_grupo is null or ct.grupo_id = p_grupo)
                     and (p_disp is null or ct.disponibilidade = p_disp)),0)
       + coalesce((select sum(valor_sinal)
                   from _lanc_filtrados(p_empresa, date '1900-01-01', p_data - 1, p_status,
                                        p_conta, p_grupo, p_cc, p_favorecido, p_disp)),0);
$$;

-- Saldos atuais por conta bancária (realizado e projetado)
create or replace function public.saldos_contas(p_empresa uuid, p_ate date default current_date)
returns table(conta_id uuid, nome text, grupo text, disponibilidade text, saldo_pago numeric, a_receber numeric, a_pagar numeric)
language sql stable set search_path = public as $$
  select ct.id, ct.nome, g.nome, ct.disponibilidade,
         ct.saldo_inicial + coalesce(sum(case when l.status='Pago' and l.data <= p_ate then
                                   case when p.natureza='C' then l.valor else -l.valor end end),0),
         coalesce(sum(case when l.status='Em aberto' and p.natureza='C' then l.valor end),0),
         coalesce(sum(case when l.status='Em aberto' and p.natureza='D' then l.valor end),0)
  from contas ct
  left join grupos g on g.id = ct.grupo_id
  left join lancamentos l on l.conta_id = ct.id
  left join plano_contas p on p.id = l.plano_id
  where ct.empresa_id = p_empresa and is_membro(p_empresa) and ct.ativo
  group by ct.id, ct.nome, g.nome, ct.disponibilidade, ct.saldo_inicial
  order by ct.codigo nulls last, ct.nome;
$$;

-- Baixa em lote (marca como Pago)
create or replace function public.baixar_lancamentos(p_ids uuid[], p_data date default null)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  update lancamentos set status = 'Pago', data = coalesce(p_data, data)
   where id = any(p_ids) and pode_editar(empresa_id);
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema public to authenticated;
revoke execute on function public._lanc_filtrados(uuid,date,date,text[],uuid,uuid,uuid,uuid,text) from anon;
